package app

// Tests for the runtime watchdog: the launcher must stop believing a port
// is served once the service behind it is gone, and it must not restart a
// healthy dsh because one probe was slow.

import "testing"

// A dead port is confirmed after three failures; a live-but-hung process
// gets a longer budget so a long turn is not killed for one slow probe.
func TestShouldRestartRuntimeBudgets(t *testing.T) {
	cases := []struct {
		failures int
		owned    bool
		want     bool
	}{
		{0, false, false}, // no failure yet
		{0, true, false},
		{1, false, false}, // one slow probe is tolerated
		{2, false, false},
		{3, false, true}, // adopted instance confirmed dead
		{5, true, false}, // owned process still inside its longer budget
		{6, true, true},  // owned process confirmed hung
		{3, true, false}, // a dead-child exit is the exit watcher's job
		{-1, false, false},
	}
	for _, c := range cases {
		if got := shouldRestartRuntime(c.failures, c.owned); got != c.want {
			t.Errorf("shouldRestartRuntime(%d, owned=%v) = %v, want %v", c.failures, c.owned, got, c.want)
		}
	}
}

// The hung-process budget must stay strictly longer than the dead-process
// one: equal budgets would restart a healthy dsh mid-turn.
func TestHungBudgetIsLongerThanAdopted(t *testing.T) {
	if hungFailureThreshold <= adoptedFailureThreshold {
		t.Fatalf("hungFailureThreshold %d must exceed adoptedFailureThreshold %d",
			hungFailureThreshold, adoptedFailureThreshold)
	}
}

// The watchdog must notice a port dying quickly enough to be useful, but
// not so often that an idle launcher wakes constantly.
func TestRuntimeProbeIntervalIsSane(t *testing.T) {
	if runtimeProbeInterval < 2*1e9 || runtimeProbeInterval > 30*1e9 {
		t.Fatalf("runtimeProbeInterval = %v, want 2s-30s", runtimeProbeInterval)
	}
}
