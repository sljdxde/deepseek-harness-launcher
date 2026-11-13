package app

// Boundary tests for the panel's geometry and the launcher's value-level
// helpers.
//
// The panel is a fixed-size flyout pinned above the tray corner, so the
// interesting cases are all edges: a work area smaller than the panel, a
// secondary monitor with negative origin, a taskbar on the top or left.
// Getting these wrong puts the panel partly off-screen — the same class of
// bug as the maximised Harness window whose caption sat at y=-43.

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// A work area that starts at a negative origin (a monitor left of or above
// the primary one) must still anchor to ITS corner, not to 0,0.
func TestTrayCornerNegativeOrigin(t *testing.T) {
	work := application.Rect{X: -1920, Y: -200, Width: 1920, Height: 1080}
	x, y := trayCorner(work)
	wantX := -1920 + 1920 - panelWidth - 4
	wantY := -200 + 1080 - panelHeight - 4
	if x != wantX || y != wantY {
		t.Errorf("trayCorner = (%d,%d), want (%d,%d)", x, y, wantX, wantY)
	}
	// and the result must be inside the work area
	if x < work.X || x+panelWidth > work.X+work.Width {
		t.Errorf("x=%d puts the panel outside the work area", x)
	}
}

// The clamp the position code applies must handle a work area smaller than
// the panel: there is no valid position, so it must pick the origin rather
// than a negative offset that hides the top-left.
func TestClampWorkAreaSmallerThanPanel(t *testing.T) {
	work := application.Rect{X: 0, Y: 0, Width: 200, Height: 200}

	// the raw tray corner would be negative
	rawX, rawY := trayCorner(work)
	if rawX >= 0 || rawY >= 0 {
		t.Fatalf("expected a negative raw corner, got (%d,%d)", rawX, rawY)
	}

	x := clamp(rawX, work.X, work.X+work.Width-panelWidth)
	y := clamp(rawY, work.Y, work.Y+work.Height-panelHeight)
	// hi < lo here, so clamp pins to lo — the panel's top-left lands on the
	// work area's origin and as much of it as possible stays visible
	if x != work.X {
		t.Errorf("x = %d, want the work area origin %d", x, work.X)
	}
	if y != work.Y {
		t.Errorf("y = %d, want the work area origin %d", y, work.Y)
	}
}

// clamp is inclusive at both ends and tolerant of an inverted range.
func TestClampEdges(t *testing.T) {
	cases := []struct {
		v, lo, hi, want int
	}{
		{5, 0, 10, 5},
		{0, 0, 10, 0},
		{10, 0, 10, 10},
		{-1, 0, 10, 0},
		{11, 0, 10, 10},
		{7, 10, 0, 10}, // inverted range: hi is raised to lo
		{-5, -10, -1, -5},
	}
	for _, c := range cases {
		if got := clamp(c.v, c.lo, c.hi); got != c.want {
			t.Errorf("clamp(%d,%d,%d) = %d, want %d", c.v, c.lo, c.hi, got, c.want)
		}
	}
}

// The panel never collapses: its height is a constant, and the model's row
// count must not drive it (a tall list once made the window grow past the
// screen). It also has to fit the smallest common laptop screen.
func TestPanelHeightFitsTheSmallestScreen(t *testing.T) {
	if panelHeight <= 0 {
		t.Errorf("panelHeight = %d, must be positive", panelHeight)
	}
	// the panel must fit a 1024x768 work area (the smallest common laptop)
	if panelHeight > 768-40 {
		t.Errorf("panel height %d does not fit a 768px-tall screen", panelHeight)
	}
	if panelWidth > 1024-40 {
		t.Errorf("panel width %d does not fit a 1024px-wide screen", panelWidth)
	}
}
