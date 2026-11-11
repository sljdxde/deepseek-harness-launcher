// Package proc makes the commands the launcher runs: dsh, npm, node, the
// probes. Every one is made here rather than with os/exec, so that on
// Windows none of them opens a window.
//
// The launcher on Windows is linked as a GUI program and has no console.
// A console program it starts (npm.cmd, node, dsh) is given a new console
// by Windows, and with it a window, one for every run; so a child of a
// launcher with no console is started with CREATE_NO_WINDOW, which gives
// it a console without one. A launcher run in a terminal during
// development lets its children share that console as before. Nothing the
// launcher starts reads or writes the terminal itself: its output is
// piped back, which a hidden console doesn't change.
//
// The window-hiding and batch-file quoting follow yetone/magpie's
// internal/proc (MIT), which worked these problems out in production.
package proc

import (
	"context"
	"os/exec"
	"time"
)

// Command is exec.Command, with no window of its own on Windows.
func Command(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	batch(cmd)
	hide(cmd)
	return cmd
}

// CommandContext is exec.CommandContext, with no window of its own on
// Windows.
func CommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	// the context ending kills the command, but not what it started: dsh
	// is a node script that leaves node holding the output, and a waiter
	// waited for it however long it took — its pipes are closed a moment
	// after instead
	cmd.WaitDelay = waitDelay
	// on Windows what it started is killed with it
	cancelTree(cmd)
	batch(cmd)
	hide(cmd)
	return cmd
}

var waitDelay = 2 * time.Second
