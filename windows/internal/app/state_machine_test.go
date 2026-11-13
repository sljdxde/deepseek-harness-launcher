package app

// State-machine tests for the launcher's open paths.
//
// The user's route is: tray click -> panel -> close the Harness window ->
// taskbar click. Several bugs lived in the seams between the pieces that
// route touches, so this file pins the couplings rather than the pieces:
//
//   decideOpen   reads (state, port, starting)
//   beginStart   reads (state, restarting, starting) — note it does NOT
//                read port
//   Start        acts on beginStart's answer
//
// The two disagree when state==running and port==0, which is exactly the
// window between "dsh died" and "the exit watcher noticed".

import (
	"testing"
)

// decideOpen and beginStart must agree on what "already running" means.
// decideOpen requires a port; beginStart does not. When they disagree the
// click is dropped: decideOpen asks Start() to run, Start() sees
// state==running and just calls openBrowserForCurrent(), which returns
// immediately because port==0.
func TestRunningWithoutPortIsNotServing(t *testing.T) {
	c := &controller{state: stateRunning, port: 0}

	// decideOpen is right: no port means nothing to show.
	if got := c.decideOpen(); got != openStarting {
		t.Errorf("decideOpen = %v, want openStarting (no port to serve)", got)
	}

	// beginStart must agree. It used to answer startShowBrowser here,
	// which made Start() a no-op and swallowed the click.
	if got := c.beginStart(); got != startProceed {
		t.Errorf("beginStart = %v, want startProceed: state==running with no port "+
			"is not a serving launcher, and treating it as one drops the click", got)
	}
}

// A running launcher WITH a port is the only "just show it" case.
func TestRunningWithPortShowsBrowser(t *testing.T) {
	c := &controller{state: stateRunning, port: 3080}
	if got := c.decideOpen(); got != openNow {
		t.Errorf("decideOpen = %v, want openNow", got)
	}
	if got := c.beginStart(); got != startShowBrowser {
		t.Errorf("beginStart = %v, want startShowBrowser", got)
	}
}

// A start already in flight wins over everything: two Start() calls would
// fight over the same port and the second would clobber the first's
// launcher.
func TestStartLatchWinsOverRunning(t *testing.T) {
	c := &controller{state: stateRunning, port: 3080, starting: true}
	// decideOpen looks at the port, not the latch: it says "show".
	if got := c.decideOpen(); got != openNow {
		t.Errorf("decideOpen = %v, want openNow", got)
	}
	// beginStart must still refuse a second start.
	if got := c.beginStart(); got != startInFlight {
		t.Errorf("beginStart = %v, want startInFlight", got)
	}
}

// The restart guard outranks the state: during a user-initiated restart the
// old process is gone but the new one is not up, and a click must not start
// a second launcher on top of the restart flow.
func TestRestartGuardOutranksRunning(t *testing.T) {
	c := &controller{state: stateStopped, restarting: true}
	if got := c.beginStart(); got != startShowBrowser {
		t.Errorf("beginStart = %v, want startShowBrowser (restart owns the transition)", got)
	}
}

// The user's exact route, walked as a state machine:
//
//	tray click (panel) -> close the Harness window -> taskbar click
//
// Each step used to be able to swallow the next one, so the whole sequence
// is asserted rather than the pieces.
func TestUserRouteCloseThenReopen(t *testing.T) {
	c := &controller{state: stateRunning, port: 3080}

	// --- step 1: the Harness window is open and serving -------------------
	if got := c.decideOpen(); got != openNow {
		t.Fatalf("serving launcher: decideOpen = %v, want openNow", got)
	}
	if c.openWhenReady {
		t.Error("a click with dsh serving must not queue anything")
	}

	// --- step 2: the window is closed -------------------------------------
	// The window host forgets the handle and the page together when the
	// platform window is really gone (see forgetWindow).

	// --- step 3: the taskbar click arrives --------------------------------
	// dsh is still serving, so the click shows the page immediately.
	if got := c.decideOpen(); got != openNow {
		t.Fatalf("after close: decideOpen = %v, want openNow (dsh still serves)", got)
	}
	if c.openWhenReady {
		t.Error("after close: the click must not be queued; dsh is serving")
	}
}

// The same route, but dsh died while the window was closed. The click must
// queue and start, not report "running" and do nothing.
func TestUserRouteCloseThenDshDied(t *testing.T) {
	c := &controller{state: stateRunning, port: 3080}

	// dsh exits: the watcher clears the port first, then flips the state.
	// Model the awkward intermediate: state still running, port already 0.
	c.mu.Lock()
	c.port = 0
	c.mu.Unlock()

	if got := c.decideOpen(); got != openStarting {
		t.Fatalf("decideOpen = %v, want openStarting (no port to serve)", got)
	}
	if !c.openWhenReady {
		t.Error("the click must be queued so the ready path can show the page")
	}
	// and Start() must actually start, not think it is already up
	if got := c.beginStart(); got != startProceed {
		t.Errorf("beginStart = %v, want startProceed", got)
	}
}

// Two taskbar clicks in quick succession during startup must queue once and
// open once, not start twice.
func TestDoubleClickDuringStartup(t *testing.T) {
	c := &controller{state: stateChecking, starting: true}

	for i := 0; i < 3; i++ {
		if got := c.decideOpen(); got != openQueued {
			t.Fatalf("click %d: decideOpen = %v, want openQueued", i, got)
		}
		if got := c.beginStart(); got != startInFlight {
			t.Fatalf("click %d: beginStart = %v, want startInFlight", i, got)
		}
	}

	// the ready path opens exactly once
	if !c.consumeOpenWhenReady() {
		t.Fatal("the queued request was lost")
	}
	if c.consumeOpenWhenReady() {
		t.Error("three clicks must not produce more than one open")
	}
}

// A restart owns the transition: a click during it must not start a second
// launcher, and must not be lost either.
func TestClickDuringRestart(t *testing.T) {
	c := &controller{state: stateStopped, restarting: true}
	if got := c.decideOpen(); got != openStarting {
		t.Errorf("decideOpen = %v, want openStarting", got)
	}
	// the click is remembered for the restart's ready path
	if !c.openWhenReady {
		t.Error("a click during a restart must be queued")
	}
	// but Start must not run a second launcher on top of the restart
	if got := c.beginStart(); got != startShowBrowser {
		t.Errorf("beginStart = %v, want startShowBrowser (restart owns it)", got)
	}
}
