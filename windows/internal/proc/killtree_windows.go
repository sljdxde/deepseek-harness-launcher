package proc

import (
	"os/exec"
	"unsafe"

	"golang.org/x/sys/windows"
)

// cancelTree has a command's context ending kill what the command started
// as well as the command. The descendants are found by their parent at
// the kill, since a job is joined only once it has started.
func cancelTree(cmd *exec.Cmd) {
	cmd.Cancel = func() error {
		killDescendants(cmd.Process.Pid)
		return cmd.Process.Kill()
	}
}

// killDescendants ends every process started under pid, at any depth. A
// pid Windows has given again to a later process is told apart by its
// start: a child starts after its parent.
func killDescendants(pid int) { killAll(descendants(uint32(pid))) }

// EndTree ends pid, with every process pid started ended too.
// TerminateProcess ends pid alone, where a SIGTERM lets a program end
// its children first: dsh's node children, ended so the launcher starts
// dsh again, would otherwise be left running with no parent, one set
// more for every restart. Its descendants are listed while it is alive,
// as descendants needs it to be.
func EndTree(pid int) error {
	kids := descendants(uint32(pid))
	if err := end(pid); err != nil {
		return err
	}
	killAll(kids)
	return nil
}

// end ends pid alone.
func end(pid int) error {
	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(h)
	return windows.TerminateProcess(h, 1)
}

func killAll(pids []uint32) {
	for _, d := range pids {
		h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, d)
		if err != nil {
			continue
		}
		_ = windows.TerminateProcess(h, 1)
		_ = windows.CloseHandle(h)
	}
}

// descendants lists the processes under pid, nearest first.
func descendants(pid uint32) []uint32 {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	kids := map[uint32][]uint32{}
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if e.ProcessID != e.ParentProcessID {
			kids[e.ParentProcessID] = append(kids[e.ParentProcessID], e.ProcessID)
		}
	}
	var out []uint32
	seen := map[uint32]bool{pid: true}
	queue := []uint32{pid}
	for len(queue) > 0 {
		p := queue[0]
		queue = queue[1:]
		born, ok := started(p)
		if !ok {
			continue
		}
		for _, k := range kids[p] {
			if seen[k] {
				continue
			}
			if t, ok := started(k); !ok || t < born {
				// the parent's pid is another, older process's
				continue
			}
			seen[k] = true
			out = append(out, k)
			queue = append(queue, k)
		}
	}
	return out
}

// started is when pid started, in 100ns since 1601.
func started(pid uint32) (int64, bool) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0, false
	}
	defer windows.CloseHandle(h)
	var c, x, k, u windows.Filetime
	if err := windows.GetProcessTimes(h, &c, &x, &k, &u); err != nil {
		return 0, false
	}
	return int64(c.HighDateTime)<<32 | int64(c.LowDateTime), true
}
