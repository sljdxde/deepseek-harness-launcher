package proc

import (
	"os/exec"
	"syscall"
)

const createNoWindow = 0x08000000 // CREATE_NO_WINDOW

// hide gives the child a console that has no window, ALWAYS.
//
// An earlier version skipped this when the launcher itself had a console,
// on the theory that the child could share it. In practice that made a
// console window appear: any launch path that leaves the process attached
// to a console (a debugger, a wrapper, a service) then let cmd.exe create
// a visible one for the dsh batch. A launcher must never flash a console;
// the child's output is piped back, which a windowless console does not
// change.
func hide(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= createNoWindow
	cmd.SysProcAttr.HideWindow = true
}
