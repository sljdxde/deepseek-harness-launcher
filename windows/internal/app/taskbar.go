package app

// taskbar.go makes the launcher reachable from the taskbar. Two facts
// shape it:
//
//   - A tray-only app has no taskbar button of its own, so there is
//     nothing to right-click and pin while it runs.
//   - Windows pins a taskbar button by AppUserModelID, and the process
//     must set the same ID it was launched under for the pinned button to
//     open this app rather than a lookalike.
//
// So the launcher writes shortcuts (Start menu, and the desktop on
// request) that carry the ID and launch the exe. Pinning one of those is
// the supported path; clicking the pinned button then starts the exe, the
// single-instance hand-off forwards it to the running launcher, and the
// running launcher opens the Harness page — which is exactly what the
// user asked a pinned icon to do.

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

// appUserModelID is the identity the shortcuts and the running process
// share; Windows groups a pinned button by it.
const appUserModelID = "com.local.dhl-launcher.windows"

const shortcutName = "Deepseek Harness Launcher.lnk"

var shell32 = syscall.NewLazyDLL("shell32.dll")

// setAppUserModelID tells Windows which identity this process belongs to.
func setAppUserModelID() {
	ptr := mustUTF16(appUserModelID)
	shell32.NewProc("SetCurrentProcessExplicitAppUserModelID").Call(uintptr(unsafe.Pointer(&ptr[0])))
}

// startMenuDir is %APPDATA%\Microsoft\Windows\Start Menu\Programs.
func startMenuDir() string {
	return filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs")
}

// desktopDir is the user's Desktop, honoring a redirected one.
func desktopDir() string {
	if profile := os.Getenv("USERPROFILE"); profile != "" {
		candidate := filepath.Join(profile, "Desktop")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	if appdata := os.Getenv("APPDATA"); appdata != "" {
		return filepath.Join(appdata, "..", "Desktop")
	}
	return ""
}

// shortcutPaths lists every .lnk the launcher owns: the Start-menu one, the
// desktop one, and — most importantly for the badge — the copy Windows made
// when the user pinned the app. The pinned copy is what the taskbar button
// draws, so leaving it out means the count never shows there.
func shortcutPaths() []string {
	var out []string
	if dir := startMenuDir(); dir != "" {
		out = append(out, filepath.Join(dir, shortcutName))
	}
	if dir := desktopDir(); dir != "" {
		out = append(out, filepath.Join(dir, shortcutName))
	}
	if dir := taskbarPinnedDir(); dir != "" {
		out = append(out, filepath.Join(dir, shortcutName))
	}
	return out
}

// taskbarPinnedDir is where Windows keeps the shortcuts behind taskbar
// buttons.
func taskbarPinnedDir() string {
	if appdata := os.Getenv("APPDATA"); appdata != "" {
		return filepath.Join(appdata, "Microsoft", "Internet Explorer",
			"Quick Launch", "User Pinned", "TaskBar")
	}
	return ""
}

// ensureShortcuts refreshes every shortcut the launcher owns, including the
// one Windows created when the user pinned a taskbar button.
//
// The pinned copy matters most: it is what a taskbar click actually runs.
// Leaving it out is why a click on the pinned button did nothing after an
// install — the shortcut still pointed at the old build\DHL.exe (which the
// install had replaced) and carried no --open, so it either failed to start
// or started a second process that exited immediately.
func ensureShortcuts(wantDesktop bool) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	// Start menu and the pinned button are not optional: one is how the app
	// is found, the other is how it is clicked.
	for _, dir := range []string{startMenuDir(), taskbarPinnedDir()} {
		if dir != "" {
			writeShortcut(filepath.Join(dir, shortcutName), exe)
		}
	}
	if wantDesktop {
		if dir := desktopDir(); dir != "" {
			writeShortcut(filepath.Join(dir, shortcutName), exe)
		}
	}
}

// writeShortcut creates or refreshes a .lnk pointing at exe. PowerShell's
// WScript.Shell is the dependable way to write one without a COM binding
// library; it runs at most a few times per start.
func writeShortcut(link, exe string) {
	// IconLocation is checked too, not just the target: an older build
	// repointed it at a badged .ico, which made a CLOSED app's button show a
	// stale unread count. Restoring it to the exe's own icon is what makes
	// the badge disappear with the process.
	iconWanted := exe + ",0"
	if existing, ok := shortcutTarget(link); ok && strings.EqualFold(existing, exe) &&
		strings.TrimSpace(shortcutArgs(link)) == "--open" &&
		strings.EqualFold(strings.TrimSpace(shortcutIcon(link)), iconWanted) {
		return // already points here, with the right arguments and icon
	}
	// The shortcut launches the exe with --open: clicking a pinned taskbar
	// button goes straight to the Harness page, no menu in between. Without
	// the argument a click would only start a second process that
	// immediately exits.
	const launchArgs = "--open"
	if err := os.MkdirAll(filepath.Dir(link), 0o755); err != nil {
		return
	}
	script := `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('` + escapeSingle(link) + `');` +
		`$s.TargetPath='` + escapeSingle(exe) + `';` +
		`$s.Arguments='` + escapeSingle(launchArgs) + `';` +
		`$s.WorkingDirectory='` + escapeSingle(filepath.Dir(exe)) + `';` +
		`$s.IconLocation='` + escapeSingle(iconWanted) + `';` +
		`$s.Description='Deepseek Harness Launcher';` +
		`$s.Save()`
	cmd := proc.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	if err := cmd.Run(); err != nil {
		applog.Logf("shortcut %s: %v", link, err)
		return
	}
	applog.Logf("shortcut written: %s", link)
	// Tell the shell the icon may have changed. Without this Explorer keeps
	// serving the cached bitmap for that .lnk — the reason a rebuilt app
	// with a corrected icon still showed the old art (a stale unread count
	// burned into it) in Start-menu search.
	notifyShellIconChanged(link)
}

// shcneAssocChanged / shcnfPathW: "this file's icon is out of date".
const (
	shcneAssocChanged = 0x08000000
	shcnfPathW        = 0x0005
)

// notifyShellIconChanged asks Explorer to re-read link's icon.
func notifyShellIconChanged(link string) {
	ptr := mustUTF16(link)
	shell32.NewProc("SHChangeNotify").Call(
		uintptr(shcneAssocChanged), uintptr(shcnfPathW),
		uintptr(unsafe.Pointer(&ptr[0])), 0)
}

// shortcutIcon reads a .lnk's IconLocation, or "".
func shortcutIcon(link string) string {
	info, err := os.Stat(link)
	if err != nil || info.Size() == 0 {
		return ""
	}
	script := `(New-Object -ComObject WScript.Shell).CreateShortcut('` + escapeSingle(link) + `').IconLocation`
	cmd := proc.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// shortcutArgs reads a .lnk's arguments, or "".
func shortcutArgs(link string) string {
	info, err := os.Stat(link)
	if err != nil || info.Size() == 0 {
		return ""
	}
	script := `(New-Object -ComObject WScript.Shell).CreateShortcut('` + escapeSingle(link) + `').Arguments`
	cmd := proc.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// shortcutTarget reads a .lnk's target path, or ("", false).
func shortcutTarget(link string) (string, bool) {
	info, err := os.Stat(link)
	if err != nil || info.Size() == 0 {
		return "", false
	}
	script := `(New-Object -ComObject WScript.Shell).CreateShortcut('` + escapeSingle(link) + `').TargetPath`
	cmd := proc.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	out, err := cmd.Output()
	if err != nil {
		return "", false
	}
	target := strings.TrimSpace(string(out))
	return target, target != ""
}

// escapeSingle makes a path safe inside a PowerShell single-quoted string
// (a quote is doubled).
func escapeSingle(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func mustUTF16(s string) []uint16 {
	ptr, err := syscall.UTF16FromString(s)
	if err != nil {
		return []uint16{0}
	}
	return ptr
}
