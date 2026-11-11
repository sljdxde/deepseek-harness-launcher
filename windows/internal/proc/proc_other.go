//go:build !windows

package proc

import "os/exec"

// hide is nothing off Windows: a child there shares the launcher's
// terminal, and no terminal makes no window.
func hide(cmd *exec.Cmd) {}

// batch is nothing off Windows: a .cmd there is nothing anyone runs.
func batch(cmd *exec.Cmd) {}
