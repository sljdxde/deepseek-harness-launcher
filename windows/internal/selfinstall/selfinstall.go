// Package selfinstall makes the exe its own installer, the way magpie
// ships: one file, no MSI, no setup wizard. Running it from a
// download-ish folder (Downloads, Desktop, Temp) installs it to
// %LOCALAPPDATA%\Programs\DHL and hands over to the installed copy; the
// installed copy runs normally and keeps its Add/Remove Programs entry
// fresh. Uninstall is `DHL.exe --uninstall` (wired into the ARP key and
// the settings window; see internal/app/uninstall_windows.go).
//
// The bundled Node rides inside the exe (assets/node.zip, kept in sync by
// build.ps1), so the single file installs a launcher that needs nothing
// else on the machine.
package selfinstall

import (
	"os"
	"path/filepath"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/ver"
)

// Action is what Settle decided to do with this run.
type Action int

const (
	// None means "run in place": the exe sits outside the download
	// folders (a dev build directory, or the install directory itself).
	ActionNone Action = iota
	// Forward means an installed copy exists and this run adds nothing
	// (same version, older, or unreadable): launch it and exit. Double
	// clicking the same downloaded exe twice must not install twice.
	ActionForward
	// Install means no installed copy exists yet.
	ActionInstall
	// Upgrade means the installed copy is older than this exe.
	ActionUpgrade
)

// ExeName is the file name the install directory uses.
const ExeName = "DHL.exe"

// InstallDir is the per-user install target. Per-user on purpose: the
// whole install works without admin rights.
func InstallDir() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "DHL")
}

// InstalledExe is the install target's exe path.
func InstalledExe() string { return filepath.Join(InstallDir(), ExeName) }

// Input carries everything Decide weighs. It exists so the decision is
// testable without a real filesystem (the tests feed temp paths).
type Input struct {
	SelfPath         string // this run's exe
	SelfVersion      string
	InstalledExe     string // "" = nothing installed
	InstalledVersion string // "" = installed but unreadable
	DownloadsLike    bool   // the exe sits in Downloads/Desktop/Temp
	Portable         bool   // .portable marker / DHL_NO_INSTALL=1
}

// Decide picks the action for this run. Dev and installed copies are
// never touched: only a download-ish folder is an installer.
func Decide(in Input) Action {
	if in.Portable {
		return ActionNone
	}
	if !in.DownloadsLike {
		return ActionNone
	}
	if samePath(in.SelfPath, in.InstalledExe) {
		return ActionNone
	}
	if in.InstalledExe == "" {
		return ActionInstall
	}
	// An unreadable installed version (a copy laid down by install.ps1
	// before version markers existed) must not be "upgraded" blindly:
	// launching the installed copy is the safe, boring answer, and the
	// launcher's own updater still handles version bumps.
	if in.InstalledVersion == "" || in.SelfVersion == "" || in.SelfVersion == "dev" {
		return ActionForward
	}
	if compareVersions(in.SelfVersion, in.InstalledVersion) > 0 {
		return ActionUpgrade
	}
	return ActionForward
}

// compareVersions uses the release-cycle comparator — launcher versions
// are x.y.z[-a.b[-SNAPSHOT]], not npm semver.
func compareVersions(a, b string) int {
	return ver.CycleCompare(ver.NormalizeRelease(a), ver.NormalizeRelease(b))
}

// samePath is a case-insensitive, extension-aware equality for two exe
// paths. filepath.Clean first: the two sides can differ in separators.
func samePath(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if filepath.Clean(a) == filepath.Clean(b) {
		return true
	}
	la, lb := filepath.Clean(a), filepath.Clean(b)
	if len(la) != len(lb) {
		return false
	}
	for i := 0; i < len(la); i++ {
		ca, cb := la[i], lb[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}

// Settle runs the installer decision and reports whether the caller
// should exit (the exe either installed itself and handed over, or
// forwarded to an installed copy). It runs before any window is built:
// a double click from Downloads must end in the installed app, never in
// a second tray icon.
func Settle(version string) bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	installed := InstalledExe()
	installedVersion := ""
	// The path string always exists; the install only counts when the
	// file does. Without this check a fresh machine reads as "installed
	// but unreadable" and forwards to nothing — the click did nothing.
	if _, err := os.Stat(installed); err == nil {
		installedVersion = exeVersion(installed)
	} else {
		installed = ""
	}
	in := Input{
		SelfPath:         exe,
		SelfVersion:      version,
		InstalledExe:     installed,
		InstalledVersion: installedVersion,
		DownloadsLike:    isDownloadLike(exe),
		Portable:         isPortable(exe),
	}
	switch Decide(in) {
	case ActionNone:
		// The installed copy keeps its own ARP entry fresh on every
		// start; a dev build (or a portable run) must not register.
		if samePath(exe, InstalledExe()) {
			if err := RegisterARP(InstalledExe(), version); err != nil {
				applog.Logf("selfinstall: ARP refresh failed: %v", err)
			}
		}
		return false
	case ActionForward:
		applog.Logf("selfinstall: installed copy already at %s; forwarding", in.InstalledExe)
		if startInstalled(in.InstalledExe) {
			return true
		}
		// the installed copy would not start: run here rather than
		// dying quietly (a click that does nothing is the worst answer)
		applog.Logf("selfinstall: forwarding failed; continuing in place")
		return false
	case ActionInstall:
		applog.Logf("selfinstall: installing %s -> %s", version, InstallDir())
		if err := install(exe, version); err != nil {
			applog.Logf("selfinstall: install failed: %v", err)
			// A failed install leaves the machine unchanged (staging is
			// renamed into place atomically); run in place rather than
			// dying silently.
			return false
		}
		startInstalled(InstalledExe())
		return true
	case ActionUpgrade:
		applog.Logf("selfinstall: upgrading %s -> %s", in.InstalledVersion, version)
		if err := upgrade(exe, version, in.InstalledExe); err != nil {
			applog.Logf("selfinstall: upgrade failed: %v", err)
			return false
		}
		return true
	}
	return false
}
