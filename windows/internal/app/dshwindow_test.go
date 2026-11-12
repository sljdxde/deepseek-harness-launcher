package app

// Tests for the main window's reload path. Reload itself needs a real
// WebviewWindow, but everything that decides *whether* it happens — the
// URL guard and the key-repeat debounce — lives in claimReload, and that
// is where the 2026-11-12 "Ctrl+R does nothing" bug hid: Wails' Windows
// ForceReload() is a noop, so the launcher has to drive a real navigation.

import (
	"testing"
	"time"
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
