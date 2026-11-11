package app

// uninstall_windows.go is the Windows counterpart of scripts/uninstall.sh:
// the uninstall the Add/Remove Programs entry and the settings window
// both reach. The rule it inherits from the macOS script: remove the
// launcher's own artifacts, keep every byte of ~/.dsh (sessions,
// credentials, runtime, user-installed plugins).
//
// Two-phase, because a running exe cannot delete itself (and Windows
// keeps the node tree mapped while the launcher lives):
//
//	--uninstall        the interactive entry: confirm, stop dsh, stage a
//	                   detached runner copy in %TEMP%, quit
//	--uninstall-run N  the runner: wait for pid N to exit, then clean up
//
// main.go intercepts --uninstall-run before anything app-side runs: the
// runner works without Wails, a tray, or a window.

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/selfinstall"
)

// HandleUninstallRunner reports whether args ask for the cleanup phase
// (--uninstall-run <pid>) and runs it when they do. It must be called
// before app.Run: the runner has no UI.
func HandleUninstallRunner(args []string) bool {
	pid, ok := uninstallRunnerPid(args)
	if !ok {
		return false
	}
	runUninstallFinisher(pid)
	return true
}

// uninstallRunnerPid parses the runner flag. The second return value is
// "claimed": once --uninstall-run appears, this exe must never fall
// through to the normal startup — running the full app out of a %TEMP%
// copy is worse than a malformed pid. Pure so tests can pin the parsing
// without launching a cleanup.
func uninstallRunnerPid(args []string) (pid int, claimed bool) {
	for i, arg := range args {
		if arg != "--uninstall-run" {
			continue
		}
		if i+1 >= len(args) {
			return 0, true
		}
		value, err := strconv.Atoi(args[i+1])
		if err != nil {
			return 0, true
		}
		return value, true
	}
	return 0, false
}

// BeginUninstall is the interactive path: confirm, stop dsh, stage the
// runner, quit. Both the startup action and the settings window land
// here.
func BeginUninstall(c *controller) {
	const title = "卸载 Deepseek Harness Launcher"
	if !confirm(title,
		"将停止正在运行的 DeepSeek Harness（dsh）并移除启动器。\n\n"+
			"~/.dsh 里的会话、凭据与运行环境会保留，重新安装后可继续使用。\n\n现在卸载吗？") {
		return
	}
	StopAll()
	runner, err := stageUninstallRunner()
	if err != nil {
		warn(title, "无法准备卸载："+err.Error())
		return
	}
	if err := spawnRunner(runner, os.Getpid()); err != nil {
		warn(title, "无法启动清理进程："+err.Error())
		return
	}
	applog.Logf("uninstall: runner staged at %s; quitting", runner)
	if c != nil && c.app != nil {
		c.app.Quit()
		return
	}
	os.Exit(0)
}

// stageUninstallRunner copies this exe into a fresh %TEMP% directory; that
// copy outlives the launcher and does the deleting once the original is
// gone.
func stageUninstallRunner() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("dhl-uninstall-%d", time.Now().UnixNano()))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, selfinstall.ExeName)
	if err := copyFileForUninstall(exe, dst); err != nil {
		return "", err
	}
	return dst, nil
}

func spawnRunner(runnerExe string, pid int) error {
	cmd := proc.Command(runnerExe, "--uninstall-run", strconv.Itoa(pid))
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

// runUninstallFinisher is the runner's whole job.
func runUninstallFinisher(pid int) {
	if err := applog.Init(); err == nil {
		applog.Logf("uninstall: finisher running (waiting for pid %d)", pid)
	}
	waitForPidExit(pid, 120*time.Second)
	// a dsh tree can outlive its parent: sweep whatever is left before
	// touching the directories it reads from
	StopAll()
	removeUninstallArtifacts()
	// the runner's own copy goes last, via a detached cmd: a process
	// cannot delete the file it is executing
	scheduleSelfDelete()
	applog.Logf("uninstall: finished")
	// The log file lives inside the directory being deleted and its open
	// handle blocked the sweep above; release it, then remove the rest.
	applog.Close()
	_ = os.RemoveAll(filepath.Join(os.Getenv("LOCALAPPDATA"), "DHL"))
}

// waitForPidExit blocks until the process is gone or the timeout passes.
// PID reuse is out of scope at this timescale: the pid was live seconds
// ago, and a reuse within two minutes would be an extraordinary
// coincidence on a desktop.
func waitForPidExit(pid int, timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !pidAlive(pid) {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
	applog.Logf("uninstall: pid %d still alive after %v; continuing anyway", pid, timeout)
}

var (
	procOpenProcess = kernel32.NewProc("OpenProcess")
	procCloseHandle = kernel32.NewProc("CloseHandle")
)

// pidAlive probes the pid with OpenProcess. A failing open after the
// process existed means it exited (ERROR_INVALID_PARAMETER).
func pidAlive(pid int) bool {
	const processQueryLimitedInformation = 0x1000
	h, _, _ := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if h == 0 {
		return false
	}
	procCloseHandle.Call(h)
	return true
}

// removeUninstallArtifacts deletes everything the launcher owns. The
// order matters: registry and links first (cheap, reversible), then the
// directories that hold the running exe's files.
func removeUninstallArtifacts() {
	// autostart + the uninstall entry
	_ = deleteRunValue()
	clearApprovedMarker()
	if err := selfinstall.RemoveARP(); err != nil {
		applog.Logf("uninstall: ARP key: %v", err)
	}
	// shortcuts (Start menu, desktop, the pinned taskbar copy)
	for _, lnk := range shortcutPaths() {
		if err := os.Remove(lnk); err == nil {
			applog.Logf("uninstall: removed %s", lnk)
		}
	}
	// app data: logs + the extracted plugin copies
	appData := filepath.Join(os.Getenv("LOCALAPPDATA"), "DHL")
	if err := os.RemoveAll(appData); err == nil {
		applog.Logf("uninstall: removed %s", appData)
	}
	// plugin junctions that point into the app data we just removed
	removeOwnPluginLinks()
	// the program directory and its install siblings
	prog := selfinstall.InstallDir()
	parent := filepath.Dir(prog)
	if err := os.RemoveAll(prog); err == nil {
		applog.Logf("uninstall: removed %s", prog)
	}
	entries, _ := os.ReadDir(parent)
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "DHL.") {
			continue
		}
		if strings.HasPrefix(name, "DHL.backup-") || strings.HasPrefix(name, "DHL.installing") ||
			strings.HasSuffix(name, ".old") {
			_ = os.RemoveAll(filepath.Join(parent, name))
		}
	}
}

// removeOwnPluginLinks deletes profile node_modules links whose target is
// our extracted plugins directory. Anything else in there — a plugin the
// user installed themselves — is preserved, the same rule the macOS
// uninstall script applies.
func removeOwnPluginLinks() {
	profiles := filepath.Join(paths.DSHHome(), "profiles")
	entries, err := os.ReadDir(profiles)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			continue
		}
		removeDHLLinks(filepath.Join(profiles, entry.Name(), "node_modules"))
	}
	// ~/.dsh/profiles/node_modules itself (the shared runtime link farm)
	removeDHLLinks(filepath.Join(profiles, "node_modules"))
}

func removeDHLLinks(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		link := filepath.Join(dir, entry.Name())
		target, err := os.Readlink(link)
		if err != nil {
			continue // a real directory (a user-installed plugin): keep
		}
		if isOurPluginTarget(target) {
			if err := os.Remove(link); err == nil {
				applog.Logf("uninstall: removed plugin link %s", link)
			}
		}
	}
}

// isOurPluginTarget reports whether a link target is one of the plugin
// copies the launcher extracted into %LOCALAPPDATA%\DHL\plugins. Anything
// else — a plugin the user installed from their own disk — belongs to
// them, not to us.
func isOurPluginTarget(target string) bool {
	normalized := strings.ToLower(filepath.ToSlash(target))
	return strings.Contains(normalized, "/dhl/plugins/") ||
		strings.HasSuffix(normalized, "/dhl/plugins")
}

// scheduleSelfDelete removes the staged runner directory a few seconds
// from now, from a detached cmd so this process can exit first.
func scheduleSelfDelete() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	dir := filepath.Dir(exe)
	script := filepath.Join(os.TempDir(), fmt.Sprintf("dhl-uninstall-selfdel-%d.cmd", time.Now().UnixNano()))
	body := strings.Join([]string{
		"@echo off",
		"rem deletes the staged uninstaller copy once its process exited",
		"timeout /t 3 /nobreak >nul",
		`rd /s /q "` + dir + `"`,
		"del /q \"%~f0\"",
	}, "\r\n")
	if err := os.WriteFile(script, []byte(body), 0o644); err != nil {
		return
	}
	cmd := proc.Command("cmd.exe", "/c", script)
	_ = cmd.Start()
	go func() { _ = cmd.Wait() }()
}

// copyFileForUninstall is a plain copy (no atomic rename needed: the
// destination is a fresh temp path).
func copyFileForUninstall(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0o755)
}
