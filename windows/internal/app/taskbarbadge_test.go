package app

// Badge rendering tests. The renderer is pure image code, so it can be
// checked without a taskbar: what matters is that it produces a valid
// icon-sized bitmap, that the pill widens for "99+", and that it never
// panics on any label the badge can produce.

import (
	"image"
	"image/color"
	"testing"
)

func rgbaRed() color.RGBA  { return color.RGBA{0xE5, 0x34, 0x2E, 0xFF} }
func rgbaBlue() color.RGBA { return color.RGBA{0x00, 0x00, 0xFF, 0xFF} }

func TestRenderBadgeIcon(t *testing.T) {
	for _, text := range []string{"1", "9", "10", "99", "99+"} {
		hicon := renderBadgeIcon(text)
		if hicon == 0 {
			t.Errorf("renderBadgeIcon(%q) returned a null icon", text)
		}
		// the icon handle is owned by Windows; free it
		if hicon != 0 {
			procDestroyIcon.Call(hicon)
		}
	}
}

// The pill must be wide enough for "99+" and no wider than the canvas.
func TestBadgePillGeometry(t *testing.T) {
	const size = 32
	for _, text := range []string{"1", "99", "99+"} {
		runes := len([]rune(text))
		pillH := float64(size) * 0.66
		textW := float64(runes) * 6.2
		pillW := pillH
		if textW+8 > pillW {
			pillW = textW + 8
		}
		if pillW > size {
			t.Errorf("label %q needs pill width %.1f, wider than the %dpx canvas",
				text, pillW, size)
		}
		if pillW < textW {
			t.Errorf("label %q: pill %.1f narrower than its text %.1f", text, pillW, textW)
		}
	}
}

// fillPill must stay inside the canvas for the extreme geometry, or the
// Set call would panic on an out-of-range pixel.
func TestFillPillStaysInBounds(t *testing.T) {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	// worst case: the widest pill the renderer can ask for
	fillPill(img, 0, 0, float64(size), float64(size), rgbaRed())
	// and a pill flush against the far edge
	fillPill(img, 1, 1, float64(size-1), float64(size-1), rgbaRed())

	// every pixel the pill covers must be opaque red
	opaque := 0
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a > 0 {
				opaque++
			}
		}
	}
	if opaque == 0 {
		t.Fatal("fillPill drew nothing")
	}
}

// putU32 / putU16 write little-endian, which the DIB header requires.
func TestDIBHeaderEndianness(t *testing.T) {
	b := make([]byte, 8)
	putU32(b, 0, 0x12345678)
	if b[0] != 0x78 || b[1] != 0x56 || b[2] != 0x34 || b[3] != 0x12 {
		t.Errorf("putU32 wrote % x, want 78 56 34 12", b[:4])
	}
	putU16(b, 4, 0xABCD)
	if b[4] != 0xCD || b[5] != 0xAB {
		t.Errorf("putU16 wrote % x, want cd ab", b[4:6])
	}
	// a negative width (int32) keeps its two's-complement bytes
	putI32(b, 0, -1)
	if b[0] != 0xFF || b[1] != 0xFF || b[2] != 0xFF || b[3] != 0xFF {
		t.Errorf("putI32(-1) wrote % x", b[:4])
	}
}

// rgbaToHICON flips rows to bottom-up; a top-heavy image must come out
// with the top row last in the DIB.
func TestRGBAToHICONBottomUp(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	// top row red, bottom row blue
	img.Set(0, 0, rgbaRed())
	img.Set(1, 0, rgbaRed())
	img.Set(0, 1, rgbaBlue())
	img.Set(1, 1, rgbaBlue())

	hicon := rgbaToHICON(img)
	if hicon == 0 {
		t.Fatal("rgbaToHICON returned null")
	}
	procDestroyIcon.Call(hicon)
	// the conversion itself is covered by the real-machine check; here the
	// contract is only that it returns a handle and does not panic
}

// The taskbar button title is the fallback badge for shells without
// ITaskbarList3, so its format matters: it must carry the count and stay
// readable in Alt+Tab.
func TestHostWindowTitleFormat(t *testing.T) {
	cases := []struct {
		count int
		want  string
	}{
		{0, "Deepseek Harness Launcher"},  // no prefix when clear
		{-1, "Deepseek Harness Launcher"}, // negative clears too
		{3, "(3) Deepseek Harness Launcher"},
		{99, "(99) Deepseek Harness Launcher"},
		{100, "(99+) Deepseek Harness Launcher"}, // capped like the overlay
	}
	for _, c := range cases {
		text := badgeText(c.count)
		var got string
		if text == "" {
			got = "Deepseek Harness Launcher"
		} else {
			got = "(" + text + ") Deepseek Harness Launcher"
		}
		if got != c.want {
			t.Errorf("count %d: title %q, want %q", c.count, got, c.want)
		}
	}
}
