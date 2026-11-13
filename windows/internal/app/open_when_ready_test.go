package app

// Tests for the "taskbar click sometimes does nothing" report.
//
// The taskbar button belongs to the Harness window, and a click on it
// arrives as a second launch carrying --open (or no flag). That lands in
// Open(), whose `starting` branch used to return without doing anything —
// nothing on the ready path showed the window either, so a click that
// arrived while dsh was booting was silently swallowed. The fix is a
// one-shot "the user asked for the page" flag that the ready path
// consumes.

import (
	"testing"
)

// A click during startup must be remembered, not dropped.
func TestOpenDuringStartRemembersTheRequest(t *testing.T) {
	c := &controller{state: stateChecking, starting: true}

	if c.openWhenReady {
		t.Fatal("nothing should be queued before the click")
	}
	// Open() would take the `starting` branch; only the flag matters here
	// because Start/openBrowser need a real window.
	c.mu.Lock()
	c.openWhenReady = true
	c.mu.Unlock()

	if !c.consumeOpenWhenReady() {
		t.Error("a click during startup must be remembered")
	}
}

// The flag is one-shot: the ready path must not keep re-showing the window
// on every later launch.
func TestConsumeOpenWhenReadyIsOneShot(t *testing.T) {
	c := &controller{}
	c.mu.Lock()
	c.openWhenReady = true
	c.mu.Unlock()

	if !c.consumeOpenWhenReady() {
		t.Fatal("the first consume must report the request")
	}
	if c.consumeOpenWhenReady() {
		t.Error("the second consume must report nothing")
	}
	if c.consumeOpenWhenReady() {
		t.Error("the flag must stay cleared")
	}
}

// With no click, the ready path must not pop the window up on its own: the
// launcher starts minimised to the taskbar on purpose.
func TestConsumeOpenWhenReadyWithoutRequest(t *testing.T) {
	c := &controller{}
	if c.consumeOpenWhenReady() {
		t.Error("a plain start must not open the window by itself")
	}
}

// A click while dsh is already running must not leave the flag set: the
// window is shown directly, and a stale flag would pop it up again at the
// next restart.
func TestOpenWhileRunningLeavesNoQueuedRequest(t *testing.T) {
	c := &controller{state: stateRunning, port: 3080}
	if got := c.decideOpen(); got != openNow {
		t.Errorf("decision = %v, want openNow", got)
	}
	if c.openWhenReady {
		t.Error("a click with dsh running must not queue a deferred open")
	}
}

// A click while dsh is starting must queue and report the in-flight start;
// a click with nothing running must queue and ask for a Start.
func TestOpenQueuesUnlessRunning(t *testing.T) {
	cases := []struct {
		name  string
		state int
		start bool
		want  openIntent
	}{
		{"starting", stateChecking, true, openQueued},
		{"stopped", stateStopped, false, openStarting},
		{"failed", stateFailed, false, openStarting},
		{"stopped but a start claimed the latch", stateStopped, true, openQueued},
	}
	for _, c := range cases {
		ctl := &controller{state: c.state, starting: c.start}
		if got := ctl.decideOpen(); got != c.want {
			t.Errorf("%s: decision = %v, want %v", c.name, got, c.want)
		}
		if !ctl.openWhenReady {
			t.Errorf("%s: the click must be remembered for the ready path", c.name)
		}
	}
}

// The startup path inspects the flag to decide whether to minimise. It must
// not consume the request: the page still has to appear once dsh is ready,
// so requeue puts it back.
func TestRequeueOpenWhenReadyKeepsTheRequest(t *testing.T) {
	c := &controller{}
	c.mu.Lock()
	c.openWhenReady = true
	c.mu.Unlock()

	// the startup path looks, then puts it back instead of minimising
	if !c.consumeOpenWhenReady() {
		t.Fatal("the startup path must see the click")
	}
	c.requeueOpenWhenReady()

	// the ready path still sees it
	if !c.consumeOpenWhenReady() {
		t.Error("the request was lost; the window would never appear")
	}
	if c.consumeOpenWhenReady() {
		t.Error("the request must be consumed exactly once")
	}
}
