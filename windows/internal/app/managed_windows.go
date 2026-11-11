package app

// managed_windows.go finds every dsh process this launcher is responsible
// for, the Windows counterpart of managedDSHPIDs in Sources/main.swift.
//
// Why it exists: a launcher that only remembers the child it started cannot
// stop the one it adopted from a previous run, nor the one an interrupted
// update left behind. The macOS launcher scans the process table and
// matches by the runtime path and the patch file it injects; this does the
// same through a Toolhelp snapshot plus each process's command line.

import (
	"strconv"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

// managedPIDs lists the processes that belong to this launcher's dsh.
//
// A process is ours when its command line points at the installed runtime's
// dsh, or at the runtime directory together with the patch file we inject,
// or at an interrupted install's staging directory. Matching on the patch
// path is what catches an adopted instance: it was started by a previous
// launcher, but it carries our patch.
func managedPIDs() []int {
	runtimeDir := strings.ToLower(dshrt.RuntimeDir())
	entry := strings.ToLower(dshrt.ExecutablePath())

	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)

	// candidate pids first: only node-ish processes can be dsh, and asking
	// WMI for every process on the machine is wasteful
	var candidates []uint32
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		pid := e.ProcessID
		if pid <= 4 { // System Idle / System
			continue
		}
		name := strings.ToLower(windows.UTF16ToString(e.ExeFile[:]))
		if strings.Contains(name, "node") || strings.Contains(name, "dsh") ||
			strings.Contains(name, "npm") {
			candidates = append(candidates, pid)
		}
	}
	if len(candidates) == 0 {
		return nil
	}

	// dsh runs as `node <runtime>/node_modules/.../dsh.js web …`, so the
	// executable is the bundled node, NOT a file inside the runtime. The
	// command line is what carries the runtime path — matching on the image
	// path alone finds nothing, which is why a quit once left the server up.
	commandLines := processCommandLines()
	var out []int
	for _, pid := range candidates {
		lower := strings.ToLower(commandLines[pid])
		if lower == "" {
			continue
		}
		if strings.Contains(lower, runtimeDir) ||
			strings.Contains(lower, entry) ||
			strings.Contains(lower, "runtime.installing-") {
			out = append(out, int(pid))
		}
	}
	return out
}

// processCommandLines maps pid → command line for every process WMI will
// report. One query is far cheaper than one call per process, and it avoids
// reading another process's PEB (which needs unsafe and trips vet).
//
// WMI is the documented way to get command lines on Windows; tasklist has
// no such column.
func processCommandLines() map[uint32]string {
	out := map[uint32]string{}
	script := `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ` +
		`ForEach-Object { "$($_.ProcessId)" + [char]9 + $_.CommandLine }`
	cmd := proc.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	data, err := cmd.Output()
	if err != nil {
		applog.Logf("managed processes: WMI query failed: %v", err)
		return out
	}
	for _, line := range strings.Split(string(data), "\n") {
		tab := strings.IndexByte(line, '\t')
		if tab <= 0 {
			continue
		}
		pid, err := strconv.ParseUint(strings.TrimSpace(line[:tab]), 10, 32)
		if err != nil {
			continue
		}
		out[uint32(pid)] = strings.TrimSpace(line[tab+1:])
	}
	return out
}

// StopAll stops every dsh process this launcher owns, the counterpart of
// the macOS launcher's stopDHL walking managedDSHPIDs.
func StopAll() {
	pids := managedPIDs()
	if len(pids) == 0 {
		return
	}
	applog.Logf("stopping %d managed dsh process(es): %v", len(pids), pids)
	for _, pid := range pids {
		_ = proc.EndTree(pid)
	}
}
