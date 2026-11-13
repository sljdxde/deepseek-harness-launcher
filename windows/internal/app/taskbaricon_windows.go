package app

// taskbaricon_windows.go draws the unread count straight into the taskbar
// button's icon.
//
// The first plan was ITaskbarList3::SetOverlayIcon, which is the "proper"
// API — but it is not available on every shell (this machine's returns
// E_NOINTERFACE for that interface while accepting the older ones), and a
// fallback that only rewrites the window title is easy to miss: a taskbar
// button shows an icon, not a title.
//
// So the count is composited into the icon itself: the brand glyph with a
// red pill in the corner. That works on every Windows version, needs no
// COM, and is visible at a glance exactly like the macOS menu-bar badge.
// When the overlay API *is* available it is still used, because the shell
// draws it crisper at every scale — this is the path that always works.

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"sync"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

var (
	procSendMessageW     = user32.NewProc("SendMessageW")
	procGetSystemMetrics = user32.NewProc("GetSystemMetrics")
)

const (
	wmSetIcon = 0x0080
	iconSmall = 0
	iconBig   = 1
)

// taskbarIconCache holds the last painted icon so an unchanged count does
// not rebuild (and re-destroy) HICONs on every poll.
var taskbarIconMu sync.Mutex

var taskbarIconState struct {
	last       string
	hicon      uintptr // the ICON_BIG handle, kept for the size check
	hiconBig   uintptr
	hiconSmall uintptr
}

// System metrics for the two icon boxes a window is asked for.
const (
	smCxIcon   = 11 // SM_CXICON: large icon width
	smCxSmIcon = 49 // SM_CXSMICON: small icon width
)

// setTaskbarIcon paints count onto the app icon and installs it on the
// host window. count <= 0 restores the plain icon.
//
// The window icon is the path that actually reaches the taskbar: setting
// the .ico file to solid green and re-reading it left the button unchanged,
// so the shell draws WM_SETICON's HICON, not the shortcut's file.
//
// Two sizes are installed because the taskbar asks for a specific one and
// scales whatever it gets. ICON_BIG must be drawn at the taskbar's own icon
// box (36px at 100% DPI, measured from a screenshot), otherwise Windows
// upscales a 32px image and the badge grows with it — which is why the
// badge kept coming out at 56% of the icon instead of the 25% it was drawn
// at.
func setTaskbarIcon(hwnd uintptr, count int) {
	taskbarIconMu.Lock()
	defer taskbarIconMu.Unlock()

	label := badgeText(count)
	if label == taskbarIconState.last && taskbarIconState.hicon != 0 {
		return
	}
	taskbarIconState.last = label

	for _, h := range []uintptr{taskbarIconState.hiconBig, taskbarIconState.hiconSmall} {
		if h != 0 {
			procDestroyIcon.Call(h)
		}
	}
	taskbarIconState.hiconBig, taskbarIconState.hiconSmall = 0, 0
	taskbarIconState.hicon = 0

	// ICON_BIG: the taskbar button's icon box.
	//
	// The size comes from the system, not from a constant. SM_CXICON is what
	// the shell asks a window for when it draws a large icon, and hard-coding
	// 36 produced a soft, stair-stepped edge on a taskbar that actually
	// wanted 48: Windows upscaled our bitmap. Querying the metric and drawing
	// at that exact size is what makes the icon crisp.
	// ICON_BIG: the taskbar button's icon box.
	box := iconBoxPx()
	bigBase := baseAppIconFor(box)
	if bigBase == nil {
		applog.Logf("taskbar icon: no base icon to paint on")
		return
	}
	hiconBig := rgbaToHICON(iconFor(bigBase, label, box))

	// ICON_SMALL: the title bar and Alt+Tab.
	small := smallIconPx()
	smallBase := baseAppIconFor(small)
	if smallBase == nil {
		smallBase = bigBase
	}
	hiconSmall := rgbaToHICON(iconFor(smallBase, label, small))

	if hiconBig == 0 || hiconSmall == 0 {
		applog.Logf("taskbar icon: rgbaToHICON failed")
		return
	}
	applog.Logf("taskbar icon: painted %q (big=%dpx small=%dpx, badge=%.1fpx)",
		label, box, small, badgeHeightFor(box))
	taskbarIconState.hiconBig = hiconBig
	taskbarIconState.hiconSmall = hiconSmall
	taskbarIconState.hicon = hiconBig
	procSendMessageW.Call(hwnd, wmSetIcon, uintptr(iconBig), hiconBig)
	procSendMessageW.Call(hwnd, wmSetIcon, uintptr(iconSmall), hiconSmall)

	// NOTE: the shortcuts are deliberately NOT repointed at a badged .ico.
	//
	// An earlier version rewrote every shortcut's IconLocation to a file
	// containing the count. That is wrong in two ways the user sees at once:
	//
	//   - the pinned button then shows a count even when the app is closed,
	//     because the shortcut's icon is static art;
	//   - Explorer caches shortcut icons aggressively, so the number that
	//     sticks is whatever happened to be written first — it stops
	//     matching the real unread count.
	//
	// The badge belongs to the RUNNING window only (WM_SETICON above), which
	// is also how a badge is supposed to behave: it disappears with the
	// process. Shortcuts keep pointing at the exe's own icon.
}

// iconBoxPx is the pixel size the shell asks a window for when it draws a
// large icon (SM_CXICON). The taskbar button uses this box; drawing at any
// other size means the shell rescales, which is what made the icon look
// soft and stair-stepped.
func iconBoxPx() int {
	n, _, _ := procGetSystemMetrics.Call(smCxIcon)
	if n < 16 || n > 256 {
		return 32 // a sane fallback if the metric is unavailable
	}
	return int(n)
}

// smallIconPx is SM_CXSMICON: the title-bar / Alt+Tab size.
func smallIconPx() int {
	n, _, _ := procGetSystemMetrics.Call(smCxSmIcon)
	if n < 8 || n > 128 {
		return 16
	}
	return int(n)
}

// baseAppIcon decodes the exe's own icon into an image the badge can be
// painted on. Cached after the first call.
var baseIconCache = map[int]image.Image{}

// baseAppIconFor decodes the embedded art entry nearest to target, so a
// 48px button is painted from the 48px art rather than downscaled from
// 256 — one resample less, and visibly sharper edges.
func baseAppIconFor(target int) image.Image {
	if img, ok := baseIconCache[target]; ok {
		return img
	}
	entries, err := icoEntries(trayICO)
	if err != nil || len(entries) == 0 {
		return nil
	}
	var best icoImage
	found := false
	for _, e := range entries {
		if e.width >= target {
			best, found = e, true
			break
		}
	}
	if !found {
		best = entries[0]
		for _, e := range entries {
			if e.width > best.width {
				best = e
			}
		}
	}
	img, err := png.Decode(bytes.NewReader(best.data))
	if err != nil {
		return nil
	}
	baseIconCache[target] = img
	return img
}

// toRGBA normalises any decoded image to *image.RGBA.
func toRGBA(src image.Image) *image.RGBA {
	if rgba, ok := src.(*image.RGBA); ok {
		return rgba
	}
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), src, b.Min, draw.Src)
	return dst
}

// badgeRatio is the badge's height as a fraction of the icon.
//
// 30% is the size the user settled on: at 60% and 46% it covered the bird
// glyph, and below ~28% a digit stops being legible. Keeping it a ratio
// (rather than a pixel count) is correct here because every .ico entry is
// drawn at its own resolution and the shell picks the closest one — so the
// badge must scale with the art, not with a device pixel count.
const badgeRatio = 0.30

// badgeDigitMinSize is the smallest icon size where a digit is drawn at
// all. Below it the badge is a plain dot: at 16px a digit would be 3px of
// white on red, which is measurable but not readable. 20px is the first
// size where the count survives at 1×; a 100% DPI taskbar asks for 16px
// (dot) and a 125–150% one for 20–24px (digit).
const badgeDigitMinSize = 20

// badgeHeightFor is the badge's height at a given icon size.
func badgeHeightFor(size int) float64 {
	return float64(size) * badgeRatio
}

// iconFor is the icon to install for one size: the art scaled to that box,
// with the count painted on when there is one. paintBadgeAt already scales,
// so the no-badge case is the only one that needs a bare resize.
func iconFor(base image.Image, label string, size int) *image.RGBA {
	if label == "" {
		return resizeRGBA(toRGBA(base), size)
	}
	return paintBadgeAt(base, label, size)
}

// paintBadgeAt paints the badge onto base scaled to `size`, so each .ico
// entry is drawn at its native resolution instead of downscaling one large
// render (which blurs the digit into a smudge).
//
// Below badgeDigitMinSize the badge is a plain dot: at 16px a digit would
// be 3px of white on red, measurable but unreadable. A dot still says
// "something is waiting", which is the whole job at that size — the same
// trade macOS makes in its menu-bar badge.
func paintBadgeAt(base image.Image, label string, size int) *image.RGBA {
	dst := resizeRGBA(toRGBA(base), size)

	withDigit := size >= badgeDigitMinSize

	// fixed device size, clamped so it never dominates a small icon
	pillH := badgeHeightFor(size)
	// width grows with the digit count so the text is never squashed
	digits := float64(len([]rune(label)))
	pillW := pillH
	if withDigit {
		if w := pillH*0.55*digits + float64(size)*0.05; w > pillW {
			pillW = w
		}
	}
	if maxW := float64(size) * 0.88; pillW > maxW {
		pillW = maxW
	}
	inset := float64(size) * 0.01
	x := float64(size) - pillW - inset
	y := float64(size) - pillH - inset

	// A corner radius of 28% of the height, NOT a full capsule: a capsule's
	// semicircular ends eat the top and bottom rows of the digit area at
	// small sizes. This still reads as a rounded badge.
	radius := pillH * 0.28

	// A thin rim keeps the badge readable over the icon's white glyph. It is
	// kept to a single pixel: a thicker rim inflated the badge's apparent
	// size more than the badge itself.
	rim := 1.0
	fillRoundRect(dst, x-rim, y-rim, pillW+2*rim, pillH+2*rim, radius+rim,
		color.RGBA{0xFF, 0xFF, 0xFF, 0xFF})
	fillRoundRect(dst, x, y, pillW, pillH, radius,
		color.RGBA{0xE5, 0x34, 0x2E, 0xFF})

	if withDigit {
		drawBadgeText(dst, label, x, y, pillW, pillH)
	}
	return dst
}

// fillRoundRect draws a rectangle with rounded corners.
func fillRoundRect(dst *image.RGBA, x, y, w, h, radius float64, c color.RGBA) {
	if w <= 0 || h <= 0 {
		return
	}
	if radius > h/2 {
		radius = h / 2
	}
	if radius < 0 {
		radius = 0
	}
	for py := 0; py < int(h); py++ {
		for px := 0; px < int(w); px++ {
			fx := float64(px) + 0.5
			fy := float64(py) + 0.5
			cx := math.Min(math.Max(fx, radius), w-radius)
			cy := math.Min(math.Max(fy, radius), h-radius)
			if math.Hypot(fx-cx, fy-cy) <= radius {
				px2, py2 := int(x)+px, int(y)+py
				if image.Pt(px2, py2).In(dst.Bounds()) {
					dst.Set(px2, py2, c)
				}
			}
		}
	}
}

// digitGlyphs are the digits as 3×5 bitmaps, one bit per pixel, row-major.
//
// Minimal on purpose: the badge is a corner marker on a 16–32px taskbar
// icon. A 5×7 face forced the badge to grow to 60% of the icon before the
// digit fit, which read as a slab covering the art; even 4×5 needed 46%.
// 3×5 fits a 38% badge and still tells the digits apart at 1×.
var digitGlyphs = [10][5]uint8{
	{0b111, 0b101, 0b101, 0b101, 0b111}, // 0
	{0b010, 0b110, 0b010, 0b010, 0b111}, // 1
	{0b111, 0b001, 0b111, 0b100, 0b111}, // 2
	{0b111, 0b001, 0b111, 0b001, 0b111}, // 3
	{0b101, 0b101, 0b111, 0b001, 0b001}, // 4
	{0b111, 0b100, 0b111, 0b001, 0b111}, // 5
	{0b111, 0b100, 0b111, 0b101, 0b111}, // 6
	{0b111, 0b001, 0b010, 0b010, 0b010}, // 7
	{0b111, 0b101, 0b111, 0b101, 0b111}, // 8
	{0b111, 0b101, 0b111, 0b001, 0b111}, // 9
}

// plusGlyph is the "+" in "99+", also 3×5.
var plusGlyph = [5]uint8{
	0b000, 0b010, 0b111, 0b010, 0b000,
}

// drawBadgeText centres label in the badge using the bitmaps above. The
// glyphs are scaled by an integer factor so no pixel is half-lit; when even
// 1× does not fit, the red badge alone carries the signal (a bare red dot
// still reads as "unread"). The tray tile draws through this too, so the
// two badges can never disagree on glyph shapes or spacing.
func drawBadgeText(dst *image.RGBA, label string, x, y, w, h float64) {
	runes := []rune(label)
	if len(runes) == 0 {
		return
	}

	// pick the largest integer scale whose text still fits the badge
	const glyphW, glyphH = 3, 5
	const tracking = 1 // blank columns between glyphs
	totalCols := len(runes)*glyphW + (len(runes)-1)*tracking
	scale := 0
	for s := 1; s <= 8; s++ {
		if float64(totalCols*s) <= w-1 && float64(glyphH*s) <= h-1 {
			scale = s
		}
	}
	if scale == 0 {
		return
	}

	textW := float64(totalCols * scale)
	textH := float64(glyphH * scale)
	startX := int(x + (w-textW)/2)
	startY := int(y + (h-textH)/2)

	for i, r := range runes {
		var rows [5]uint8
		switch {
		case r >= '0' && r <= '9':
			rows = digitGlyphs[r-'0']
		case r == '+':
			rows = plusGlyph
		default:
			continue
		}
		ox := startX + i*(glyphW+tracking)*scale
		for gy := 0; gy < glyphH; gy++ {
			for gx := 0; gx < glyphW; gx++ {
				// bit 2 is the leftmost column
				if rows[gy]&(1<<uint(glyphW-1-gx)) == 0 {
					continue
				}
				for sy := 0; sy < scale; sy++ {
					for sx := 0; sx < scale; sx++ {
						px, py := ox+gx*scale+sx, startY+gy*scale+sy
						if image.Pt(px, py).In(dst.Bounds()) {
							dst.Set(px, py, color.White)
						}
					}
				}
			}
		}
	}
}

// fillPill draws a rounded rectangle with fully rounded ends (a circle
// when w == h). It is the badge's shape, so it is spelled as the
// degenerate case of fillRoundRect rather than as a second copy of the
// same pixel loop.
func fillPill(dst *image.RGBA, x, y, w, h float64, c color.RGBA) {
	fillRoundRect(dst, x, y, w, h, h/2, c)
}

// resizeRGBA scales src to size×size with a box filter, which is what a
// downscale needs: nearest-neighbour drops strokes, and the icon art is
// mostly thin lines.
func resizeRGBA(src *image.RGBA, size int) *image.RGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		y0 := y * sh / size
		y1 := (y + 1) * sh / size
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := 0; x < size; x++ {
			x0 := x * sw / size
			x1 := (x + 1) * sw / size
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var r, g, bl, a, n uint32
			for sy := y0; sy < y1 && sy < sh; sy++ {
				for sx := x0; sx < x1 && sx < sw; sx++ {
					i := sy*src.Stride + sx*4
					pa := uint32(src.Pix[i+3])
					r += uint32(src.Pix[i]) * pa
					g += uint32(src.Pix[i+1]) * pa
					bl += uint32(src.Pix[i+2]) * pa
					a += pa
					n++
				}
			}
			if a == 0 || n == 0 {
				continue
			}
			i := y*dst.Stride + x*4
			dst.Pix[i] = uint8(r / a)
			dst.Pix[i+1] = uint8(g / a)
			dst.Pix[i+2] = uint8(bl / a)
			dst.Pix[i+3] = uint8(a / n)
		}
	}
	return dst
}
