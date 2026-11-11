package app

// helpers.go is the small glue the actions and the monitor share.

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"syscall"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt/progress"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/probe"
)

func marshalJSON(v any) ([]byte, error) { return json.MarshalIndent(v, "", "  ") }

func unmarshalJSON(data []byte, v any) error { return json.Unmarshal(data, v) }

// postJSON fires a loopback JSON command; 0 means it did not get through.
func postJSON(port int, path, payload string) int {
	return probe.PostJSON(fmt.Sprintf("http://127.0.0.1:%d%s", port, path), payload, 1500*time.Millisecond)
}

func newProgress() *progress.Tracker { return progress.NewTracker() }

func contextWithCancel() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}

// detach starts a command outside this process's console group so the
// updater script survives our exit.
func detach(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= 0x00000008 // DETACHED_PROCESS
}
