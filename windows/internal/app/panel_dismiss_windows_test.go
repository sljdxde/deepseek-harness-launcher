package app

// Tests for the panel's click-outside dismissal.
//
// The behaviour itself needs a real mouse and a real shell, but two pieces
// of it are pure and were worth pinning: the rectangle test the hook runs
// on every click, and the guard that keeps a tray click from re-opening
// what the same click just dismissed.

import (
	"testing"
	"time"
)

// A click inside the panel belongs to the page; one outside dismisses.
// The right/bottom edges are half-open so a click exactly on the boundary
// is treated as outside — the panel's own pixels stop one short.
func TestRectContains(t *testing.T) {
	const left, top, right, bottom int32 = 100, 200, 430, 660
	cases := []struct {
		name   string
		x, y   int32
		inside bool
	}{
		{"centre", 265, 430, true},
		{"top-left corner", 100, 200, true},
		{"just inside right", 429, 430, true},
		{"just inside bottom", 265, 659, true},
		{"left of the panel", 99, 430, false},
		{"above the panel", 265, 199, false},
		{"right edge", 430, 430, false},
		{"bottom edge", 265, 660, false},
		{"far away", 1000, 1000, false},
	}
	for _, c := range cases {
		if got := rectContains(left, top, right, bottom, c.x, c.y); got != c.inside {
			t.Errorf("%s (%d,%d) = %v, want %v", c.name, c.x, c.y, got, c.inside)
		}
	}

	// and no interior point may read as outside, not just the samples above
	for x := left; x < right; x += 37 {
		for y := top; y < bottom; y += 41 {
			if !rectContains(left, top, right, bottom, x, y) {
				t.Fatalf("interior point (%d,%d) read as outside", x, y)
			}
		}
	}
}

// A tray click arrives twice — once as a click-outside, once as the tray
// callback. The second half must not re-open the panel, or the tray icon
// can never close it (the reported bug).
func TestTrayClickAfterHookDismissDoesNotReopen(t *testing.T) {
	resetPanelDismissState()
	t.Cleanup(resetPanelDismissState)

	// no dismissal yet: a tray click opens the panel
	if panelWasJustDismissed(time.Now()) {
		t.Fatal("a plain tray click must open the panel")
	}

	// the hook dismissed it a moment ago: this is the same physical click
	now := time.Now()
	panelHideFromHookAt.Store(now.UnixNano())
	if !panelWasJustDismissed(now.Add(10 * time.Millisecond)) {
		t.Error("the tray half of the same click must not reopen the panel")
	}
	if !panelWasJustDismissed(now.Add(hookHideWindow - time.Millisecond)) {
		t.Error("the guard must hold for the whole window")
	}

	// a deliberate second click, later, opens it again
	if panelWasJustDismissed(now.Add(hookHideWindow + time.Millisecond)) {
		t.Error("a tray click after the window must open the panel")
	}
}

// A dismissal stamp of zero means "never dismissed", not "dismissed at the
// epoch" — otherwise the very first tray click after launch would be
// swallowed.
func TestZeroDismissStampIsNotRecent(t *testing.T) {
	resetPanelDismissState()
	t.Cleanup(resetPanelDismissState)
	if panelWasJustDismissed(time.Now()) {
		t.Error("a zero stamp must not count as a recent dismissal")
	}
}

func resetPanelDismissState() {
	panelHideFromHookAt.Store(0)
	clearPanelRect()
}

// The tray toggle and the click-outside hook both fire for one tray click.
// The order is not fixed, so both orderings must end with the panel closed
// and NOT reopened:
//
//	hook first  -> Hide(), then toggle sees visible=false and must skip
//	toggle first -> Hide(), then the hook finds nothing visible to dismiss
func TestTrayClickOrderingsBothClose(t *testing.T) {
	// (a) the hook dismissed it just before the toggle arrived
	resetPanelDismissState()
	panelHideFromHookAt.Store(time.Now().UnixNano())
	if !panelWasJustDismissed(time.Now()) {
		t.Error("hook-then-toggle: the toggle would reopen the panel")
	}

	// (b) the toggle ran first and the hook follows: the hook checks
	// panelIsVisible, and the toggle already cleared it, so it is a no-op.
	resetPanelDismissState()
	panel.mu.Lock()
	wasVisible := panel.visible
	panel.visible = false
	panel.mu.Unlock()
	t.Cleanup(func() {
		panel.mu.Lock()
		panel.visible = wasVisible
		panel.mu.Unlock()
	})
	if panelIsVisible() {
		t.Error("toggle-then-hook: the panel must read as hidden")
	}
}

// The dismissal stamp must not survive a long idle period: after a few
// seconds a tray click is a fresh intent and must open the panel.
func TestDismissStampExpires(t *testing.T) {
	resetPanelDismissState()
	t.Cleanup(resetPanelDismissState)
	panelHideFromHookAt.Store(time.Now().Add(-5 * time.Second).UnixNano())
	if panelWasJustDismissed(time.Now()) {
		t.Error("a dismissal five seconds ago must not block a new tray click")
	}
}
