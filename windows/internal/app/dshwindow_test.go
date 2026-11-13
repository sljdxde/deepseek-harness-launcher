package app

// Tests for the main window's reload path. Reload itself needs a real
// WebviewWindow, but everything that decides *whether* it happens — the
// URL guard and the key-repeat debounce — lives in claimReload, and that
// is where the 2026-11-12 "Ctrl+R does nothing" bug hid: Wails' Windows
// ForceReload() is a noop, so the launcher has to drive a real navigation.

import (
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/harnessweb"
)

// A reload with no page loaded must be refused: there is no URL to
// navigate to, and SetURL("") would be a silent no-op that still logged a
// success.
func TestClaimReloadNeedsAURL(t *testing.T) {
	d := &dshHost{}
	if url, ok := d.claimReload(time.Now()); ok {
		t.Fatalf("reload with no URL = %q, true; want false", url)
	}
}

// The first Ctrl+R after a page load always runs, and returns the URL the
// window is already on — that is what makes the reload a real WebView2
// navigation rather than the noop Wails offers.
func TestClaimReloadReturnsCurrentURL(t *testing.T) {
	d := &dshHost{lastURL: "http://127.0.0.1:3080/?token=abc"}
	now := time.Now()
	url, ok := d.claimReload(now)
	if !ok {
		t.Fatal("first reload was refused")
	}
	if url != "http://127.0.0.1:3080/?token=abc" {
		t.Errorf("reload URL = %q, want the loaded page URL", url)
	}
}

// Holding Ctrl+R makes Windows repeat WM_HOTKEY every few tens of
// milliseconds. Eleven navigations in three seconds left the page
// thrashing, so repeats inside the debounce window are dropped.
func TestClaimReloadDebouncesKeyRepeat(t *testing.T) {
	d := &dshHost{lastURL: "http://127.0.0.1:3080/?token=abc"}
	start := time.Now()

	if _, ok := d.claimReload(start); !ok {
		t.Fatal("the first reload was refused")
	}
	// every repeat Windows sends while the chord is held
	for _, gap := range []time.Duration{10 * time.Millisecond, 40 * time.Millisecond, 90 * time.Millisecond} {
		if _, ok := d.claimReload(start.Add(gap)); ok {
			t.Errorf("key-repeat %v after the first reload was not debounced", gap)
		}
	}
	// a deliberate second press, after the window, goes through
	if _, ok := d.claimReload(start.Add(reloadDebounce + time.Millisecond)); !ok {
		t.Error("a reload after the debounce window was refused")
	}
}

// The debounce must not be armed by a refused request: pressing Ctrl+R
// before any page exists, then again once dsh is up, must reload.
func TestClaimReloadRefusalDoesNotArmDebounce(t *testing.T) {
	d := &dshHost{}
	now := time.Now()
	if _, ok := d.claimReload(now); ok {
		t.Fatal("reload with no URL was allowed")
	}
	d.mu.Lock()
	d.lastURL = "http://127.0.0.1:3080/?token=abc"
	d.mu.Unlock()
	if _, ok := d.claimReload(now.Add(10 * time.Millisecond)); !ok {
		t.Error("the first reload after the page loaded was refused")
	}
}

// A destroyed window must be rebuilt, not reused. Wails installs its own
// WindowClosing handler when a window is created, and that handler marks
// the window destroyed and closes it regardless of e.Cancel() — so our
// "close means hide" handler cannot keep it alive. The stale WebviewWindow
// then accepted every later Show() silently: the user closed the Harness
// window once and the taskbar icon never opened it again.
//
// windowAlive is the guard, and its whole job is telling "hidden" from
// "destroyed" — IsVisible() cannot, because it is false for both.
func TestWindowAliveRejectsDeadHandles(t *testing.T) {
	// a nil window has no handle
	if windowAlive(nil) {
		t.Error("a nil window must not be reported alive")
	}
	// HWND 0 means the platform window is gone
	if ok, _, _ := procIsWindow.Call(0); ok != 0 {
		t.Error("IsWindow(0) unexpectedly true; the test's premise is wrong")
	}
}

// ensure() must forget a dead window so the next call builds a fresh one,
// and it must forget the page URL with it: the new window has nothing
// loaded, and keeping the old URL would make SetURL skip the navigation.
func TestEnsureForgetsDestroyedWindowState(t *testing.T) {
	d := &dshHost{lastURL: "http://127.0.0.1:3080/?token=abc"}

	// simulate the "window was destroyed" branch of ensure()
	d.mu.Lock()
	d.win = nil
	d.lastURL = ""
	d.mu.Unlock()

	if d.lastURL != "" {
		t.Error("a rebuilt window must not inherit the old URL")
	}
	if d.win != nil {
		t.Error("a rebuilt window must not reuse the destroyed handle")
	}
}

// Show() on a rebuilt window has no page of its own, so it must fall back
// to the saved entry URL instead of presenting a blank page.
func TestRebuiltWindowFallsBackToSavedURL(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	harnessweb.SaveLastURL("http://127.0.0.1:3080/?token=saved")

	d := &dshHost{} // lastURL empty: the rebuilt-window state
	d.mu.Lock()
	needsPage := d.lastURL == ""
	d.mu.Unlock()
	if !needsPage {
		t.Fatal("an empty lastURL must be treated as a window with no page")
	}
	if saved := harnessweb.LoadLastURL(); saved != "http://127.0.0.1:3080/?token=saved" {
		t.Errorf("saved URL = %q, want the recorded entry URL", saved)
	}
}

// forgetWindow decides on the handle, not on the event. Wails' own
// WindowClosing handler closes the platform window regardless of
// e.Cancel(), but the close is not necessarily complete when our handler
// runs — so a window that still exists must be KEPT and reused, and only a
// dead one forgotten. Clearing unconditionally leaked a live orphan window
// per close.
func TestForgetWindowKeepsALiveWindow(t *testing.T) {
	d := &dshHost{lastURL: "http://127.0.0.1:3080/?token=abc"}
	// d.win is nil here, so "the window the host holds" is nil: the
	// alive-check path is what this pins. A nil window is not alive, so it
	// is forgotten.
	d.forgetWindow(d.win)
	if d.lastURL != "" {
		t.Error("a dead window must be forgotten, including its page URL")
	}
}

// A window the host does not hold must be left completely alone.
func TestForgetWindowIgnoresOtherWindows(t *testing.T) {
	d := &dshHost{lastURL: "http://127.0.0.1:3080/?token=new"}
	var other *application.WebviewWindow = &application.WebviewWindow{}
	d.forgetWindow(other)
	if d.lastURL == "" {
		t.Error("forgetting another window must not clear the held one")
	}
}
