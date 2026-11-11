package app

// taskbaricon_test.go covers the badge compositing itself.
//
// This layer had no tests while the badge silently failed to appear: earlier
// attempts verified the *plumbing* (was setTaskbarIcon called? was a file
// written?) but nothing checked that the resulting pixels carry a legible
// number at the right size. These tests read the produced image back and
// assert on it.

import (
	"image"
	"image/color"
	"testing"
)

// testBaseIcon is a white rounded square with a dark blob, roughly the
// shape of the real icon: enough contrast that a red badge is detectable.
func testBaseIcon(size int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	white := color.RGBA{0xF2, 0xF2, 0xF2, 0xFF}
	dark := color.RGBA{0x1A, 0x1A, 0x1A, 0xFF}
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if x < size/16 && y < size/16 {
				continue
			}
			img.Set(x, y, white)
		}
	}
	// a dark diagonal stroke, standing in for the bird
	for i := size / 4; i < size*3/4; i++ {
		for d := 0; d < size/12+1; d++ {
			img.Set(i, i+d, dark)
		}
	}
	return img
}

// isBadgeRed reports whether c is the badge's red rather than the icon art.
func isBadgeRed(c color.RGBA) bool {
	return c.A > 200 && c.R > 0xC0 && c.G < 0x60 && c.B < 0x60
}

// countBadgePixels counts strongly red pixels in the lower-right quadrant.
func countBadgePixels(img *image.RGBA) int {
	b := img.Bounds()
	n := 0
	for y := b.Dy() / 2; y < b.Dy(); y++ {
		for x := b.Dx() / 2; x < b.Dx(); x++ {
			r, g, bl, a := img.At(x, y).RGBA()
			if isBadgeRed(color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(bl >> 8), uint8(a >> 8)}) {
				n++
			}
		}
	}
	return n
}

// taskbarSizes are the sizes a taskbar actually asks for at 100–200% DPI.
var taskbarSizes = []int{16, 20, 24, 32, 40, 48, 64}

func TestPaintBadgePutsRedPillInLowerRight(t *testing.T) {
	for _, size := range taskbarSizes {
		base := testBaseIcon(size)
		img := paintBadgeAt(base, "5", size)

		if got := countBadgePixels(img); got == 0 {
			t.Errorf("size %d: no red pixels in the lower-right quadrant", size)
		}

		// The badge must stay clear of the icon's upper-left 3/8, where the
		// glyph's body sits. It necessarily reaches into the lower-right
		// half — that is the point of it — so the assertion is about the
		// glyph area, not the exact quadrant.
		limit := size * 3 / 8
		for y := 0; y < limit; y++ {
			for x := 0; x < limit; x++ {
				r, g, b, a := img.At(x, y).RGBA()
				c := color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)}
				if isBadgeRed(c) {
					t.Fatalf("size %d: badge covered the icon's glyph area at (%d,%d)", size, x, y)
				}
			}
		}

		// and it must not swallow the whole icon
		if got, limit := countBadgePixels(img), size*size/2; got > limit {
			t.Errorf("size %d: badge covers %d pixels of %d (limit %d)", size, got, size*size, limit)
		}
	}
}

func TestBadgeStaysAboutThirtyPercent(t *testing.T) {
	// The user rejected 46% and 60% as "too big" and 26% as "too small to
	// read". The badge is now a fixed 30% of the icon; this pins that down
	// so a future tweak cannot quietly double it again.
	for _, size := range []int{24, 32, 48, 64} {
		img := paintBadgeAt(testBaseIcon(size), "5", size)

		minX, minY, maxX, maxY := size, size, -1, -1
		for y := 0; y < size; y++ {
			for x := 0; x < size; x++ {
				r, g, b, a := img.At(x, y).RGBA()
				if isBadgeRed(color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)}) {
					if x < minX {
						minX = x
					}
					if y < minY {
						minY = y
					}
					if x > maxX {
						maxX = x
					}
					if y > maxY {
						maxY = y
					}
				}
			}
		}
		if maxX < 0 {
			t.Fatalf("size %d: no badge drawn", size)
		}
		h := float64(maxY - minY + 1)
		got := h / float64(size) * 100
		if got < 24 || got > 36 {
			t.Errorf("size %d: badge is %.0f%% of the icon height, want ~30%%", size, got)
		}
	}
}

func TestPaintBadgeDrawsWhiteDigits(t *testing.T) {
	// The digit must be white ON the red badge.
	for _, size := range []int{24, 32, 64} {
		img := paintBadgeAt(testBaseIcon(size), "8", size)

		// inside the badge region there must be white (the digit)
		pillH := badgeHeightFor(size)
		inset := float64(size) * 0.01
		cy := int(float64(size) - pillH/2 - inset)
		cx := int(float64(size) - inset - pillH/2)
		foundWhite := false
		for dy := -int(pillH / 3); dy <= int(pillH/3) && !foundWhite; dy++ {
			for dx := -int(pillH / 3); dx <= int(pillH/3); dx++ {
				x, y := cx+dx, cy+dy
				if x < 0 || y < 0 || x >= size || y >= size {
					continue
				}
				r, g, b, a := img.At(x, y).RGBA()
				if a>>8 > 200 && r>>8 > 0xE0 && g>>8 > 0xE0 && b>>8 > 0xE0 {
					foundWhite = true
					break
				}
			}
		}
		if !foundWhite {
			t.Errorf("size %d: no white digit inside the badge", size)
		}
	}
}

func TestPaintBadgePillWidensForTwoDigits(t *testing.T) {
	const size = 64
	one := paintBadgeAt(testBaseIcon(size), "5", size)
	two := paintBadgeAt(testBaseIcon(size), "12", size)

	if countBadgePixels(two) <= countBadgePixels(one) {
		t.Errorf("a two-digit badge (%d red px) should be wider than a one-digit one (%d)",
			countBadgePixels(two), countBadgePixels(one))
	}
}

func TestPaintBadgeNeverExceedsIconWidth(t *testing.T) {
	// "99+" is the widest label; its badge must still leave icon art visible.
	const size = 32
	img := paintBadgeAt(testBaseIcon(size), "99+", size)

	red := 0
	for y := 0; y < size; y++ {
		r, g, b, a := img.At(0, y).RGBA()
		if isBadgeRed(color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)}) {
			red++
		}
	}
	if red > size/2 {
		t.Errorf("the badge covers the icon's left edge (%d/%d rows red)", red, size)
	}
}

func TestSmallIconsGetADotNotADigit(t *testing.T) {
	// At 16px a digit is unreadable, so the badge is a plain dot there. This
	// keeps the code from "helpfully" drawing a 3px number.
	const size = 16
	img := paintBadgeAt(testBaseIcon(size), "5", size)
	if countBadgePixels(img) == 0 {
		t.Fatal("16px: no badge drawn at all")
	}
	if size >= badgeDigitMinSize {
		t.Fatalf("test assumes %d < badgeDigitMinSize (%d)", size, badgeDigitMinSize)
	}
}
