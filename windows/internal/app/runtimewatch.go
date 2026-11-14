package app

// runtimewatch.go keeps "is dsh still serving that port?" under watch for
// the whole time the launcher believes dsh is up.
//
// Why this exists: the launcher used to learn about a dead dsh only from
// the process it started itself (launchInstalled's exit watcher). An
// ADOPTED instance — one that already answered on the port when we
// started — has no such watcher of its own, and even an owned process can
// stay alive while its listener stops answering. In both cases c.state
// stays stateRunning and c.port points at a corpse, so every 打开/刷新
// navigates the main window to a port nothing listens on. The user sees
// WebView2's "无法访问此页面 / ERR_CONNECTION_REFUSED" and cannot get back
// in: the URL never changes, so nothing ever re-probes or relaunches.
// This is the Windows counterpart of the macOS launcher's runtime
// watchdog (Sources/RuntimeHealthSupport.swift).

import (
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/launch"
)

const (
	// runtimeProbeInterval is how often the served port is re-probed.
	runtimeProbeInterval = 5 * time.Second
	// adoptedFailureThreshold tolerates a slow moment: a dsh busy with a
	// long turn can miss a probe without being gone.
	adoptedFailureThreshold = 3
	// hungFailureThreshold applies when the process is still alive but the
	// port keeps refusing. A dsh that cannot answer its own front page is
	// unusable to the user, but restarting it too eagerly would kill a
	// running turn, so it gets a longer budget than a dead process.
	hungFailureThreshold = 6
)

// shouldRestartRuntime decides whether consecutive probe failures mean
// "stop believing this port is served". owned selects the budget: a dead
// adopted instance is confirmed in 3 failures, a live-but-hung process in 6.
func shouldRestartRuntime(failures int, owned bool) bool {
	if failures <= 0 {
		return false
	}
	if owned {
		return failures >= hungFailureThreshold
	}
	return failures >= adoptedFailureThreshold
}

// watchRuntime polls port until the launcher stops serving it, and
// recovers when the port stops answering. owned means the dsh on that
// port is the child process this launcher started.
func (c *controller) watchRuntime(port int, owned bool) {
	failures := 0
	for {
		time.Sleep(runtimeProbeInterval)
		c.mu.Lock()
		same := c.port == port && c.state == stateRunning
		c.mu.Unlock()
		if !same {
			return // a restart or a newer instance replaced it
		}
		if launch.Reuse(port) {
			failures = 0
			continue
		}
		failures++
		if !shouldRestartRuntime(failures, owned) {
			continue
		}
		c.recoverDeadRuntime(port, owned, failures)
		return
	}
}

// recoverDeadRuntime clears the dead port and brings dsh back. Clearing
// c.port first matters: until the relaunch finishes, 打开/刷新 must not
// navigate the window to the corpse again.
func (c *controller) recoverDeadRuntime(port int, owned bool, failures int) {
	if owned {
		applog.Logf("dsh on port %d stopped answering after %d probes (process alive); restarting", port, failures)
	} else {
		applog.Logf("adopted instance on port %d stopped answering after %d probes; launching our own", port, failures)
	}
	c.mu.Lock()
	c.reused = false
	c.port = 0
	c.mu.Unlock()
	c.stopSessionMonitor()
	c.setState(stateStopped, "未运行")
	if owned {
		// Restart owns stopping the hung tree; its exit watcher stands down
		// because restarting is set, so the relaunch is not double-fired.
		c.Restart()
		return
	}
	go c.Start()
}
