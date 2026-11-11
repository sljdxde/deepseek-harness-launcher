//go:build !windows

package proc

import (
	"errors"
	"os"
)

// cancelTree off Windows leaves exec's own kill: a context ending kills
// the process group the command was started with, children included.
func cancelTree(cmd *exec.Cmd) {}

// killDescendants is Windows-only tree keeping.
func killDescendants(pid int) {}

// End is Kill off Windows.
func end(pid int) error {
	return errors.New("proc.End is Windows-only")
}

// EndTree off Windows is Kill: the command's process group ends with it.
func EndTree(pid int) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}
