package app

// Tests for the global-hotkey plumbing. The 2026-11-12 "Ctrl+R does
// nothing" bug was a thread-affinity mistake: RegisterHotKey binds a chord
// to the CALLING thread and Windows posts WM_HOTKEY only there, while the
// pump ran on a different LockOSThread goroutine — so every chord was
// registered against a thread nobody drained. These tests pin the
// invariant that fixed it: work submitted through onHotkeyThread really
// runs on the pump's OS thread.

import (
	"testing"
	"time"
)

// The pump thread must publish a thread id, and onHotkeyThread must run
// the callback on that exact thread — not on the caller's goroutine.
func TestOnHotkeyThreadRunsOnPumpThread(t *testing.T) {
	// a fresh pump for this test; the globals are process-wide
	startHotkeyPump()
	select {
	case <-hotkeyReady:
	case <-time.After(3 * time.Second):
		t.Fatal("hotkey pump never became ready")
	}

	hotkeyMu.Lock()
	pumpID := hotkeyThreadID
	hotkeyMu.Unlock()
	if pumpID == 0 {
		t.Fatal("pump published thread id 0")
	}

	var ranOn uint32
	var ran bool
	onHotkeyThread(func() {
		id, _, _ := procGetCurrentThreadId.Call()
		ranOn = uint32(id)
		ran = true
	})
	if !ran {
		t.Fatal("onHotkeyThread never ran the callback")
	}
	if ranOn != pumpID {
		t.Errorf("callback ran on thread %d, want the pump thread %d", ranOn, pumpID)
	}
}

// A second startHotkeyPump must not spawn a second pump: two pumps would
// mean two threads claiming chords and half the messages going nowhere.
func TestStartHotkeyPumpIsIdempotent(t *testing.T) {
	startHotkeyPump()
	select {
	case <-hotkeyReady:
	case <-time.After(3 * time.Second):
		t.Fatal("hotkey pump never became ready")
	}

	hotkeyMu.Lock()
	idBefore := hotkeyThreadID
	hotkeyMu.Unlock()

	startHotkeyPump() // must be a no-op
	time.Sleep(50 * time.Millisecond)

	hotkeyMu.Lock()
	idAfter := hotkeyThreadID
	hotkeyMu.Unlock()
	if idAfter != idBefore {
		t.Errorf("a second startHotkeyPump replaced the pump thread (%d → %d)", idBefore, idAfter)
	}
}

// drainHotkeyRequests must run every queued callback, in order, and stop
// when the queue is empty — the pump calls it on each wake message.
func TestDrainHotkeyRequestsRunsQueue(t *testing.T) {
	hotkeyMu.Lock()
	hotkeyRequests = make(chan func(), 8)
	hotkeyMu.Unlock()

	var order []int
	for i := 0; i < 3; i++ {
		n := i
		hotkeyMu.Lock()
		ch := hotkeyRequests
		hotkeyMu.Unlock()
		ch <- func() { order = append(order, n) }
	}

	drainHotkeyRequests()
	if len(order) != 3 {
		t.Fatalf("drained %d callbacks, want 3", len(order))
	}
	for i, got := range order {
		if got != i {
			t.Errorf("callback %d ran out of order (%v)", i, order)
		}
	}

	// draining an empty queue must return rather than block
	done := make(chan struct{})
	go func() { drainHotkeyRequests(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("drainHotkeyRequests blocked on an empty queue")
	}
}

// The panel chords the launcher promises in its own docs must all parse;
// an unparseable chord is logged and silently never registered.
func TestPanelChordsParse(t *testing.T) {
	for _, chord := range []string{
		"Ctrl+O", "Ctrl+R", "Ctrl+L", "Ctrl+Q", "Ctrl+Alt+L",
	} {
		mods, vk, ok := parseHotkey(chord)
		if !ok {
			t.Errorf("%q does not parse, so its hotkey would never register", chord)
			continue
		}
		if mods == 0 {
			t.Errorf("%q parsed with no modifier bits", chord)
		}
		if vk == 0 {
			t.Errorf("%q parsed with no virtual key", chord)
		}
	}
}
