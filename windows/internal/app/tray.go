package app

// tray.go draws the tray icon's badge and wires the click that opens the
// Harness page — the Windows counterpart of the macOS StatusBadgeSupport
// composition and the status item's click behaviour.
//
// Windows draws the tray icon as given, so the badge is composited into
// a bitmap here rather than drawn by the system (macOS tints a template
// icon itself).

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"sort"
	"strconv"
	"sync"
)

// badgeState is what the tray icon currently shows.
type badgeState struct {
	Unread int
	Update bool
}

var (
	badgeMu     sync.Mutex
	trayEntries []icoImage // the embedded art at every size, smallest first
	lastBadge   badgeState
)

// setTrayIcon renders the icon with the given badge and hands it to the
// tray. Cheap enough to call on every poll: only a change redraws.
func (h *Host) setTrayIcon(state badgeState) {
	badgeMu.Lock()
	if state == lastBadge && len(trayEntries) > 0 {
		badgeMu.Unlock()
		return
	}
	lastBadge = state
	ready := len(trayEntries) > 0
	badgeMu.Unlock()

	if !ready {
		return
	}
	// A multi-size ICO, not one big PNG: Wails hands a PNG to
	// CreateIconFromResourceEx at the tray's small-icon size, so a 256px
	// master is rescaled by the shell on every repaint and comes out
	// blurry. An ICO lets the shell pick the entry that already matches
	// the current DPI exactly.
	ico := buildBadgeICO(state)
	if len(ico) == 0 {
		return
	}
	h.tray.SetIcon(ico)
}

// initTrayBase decodes every PNG inside the embedded .ico and keeps them
// sorted by size, so the badge can be composed at the exact size the tray
// asks for instead of downscaling one 256px master.
func initTrayBase(ico []byte) {
	entries, err := icoEntries(ico)
	if err != nil || len(entries) == 0 {
		return
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].width < entries[j].width })
	badgeMu.Lock()
	trayEntries = entries
	badgeMu.Unlock()
}

// artFor picks the embedded image nearest to size (the smallest one that
// is still at least that large, else the largest available).
func artFor(size int) image.Image {
	var best icoImage
	found := false
	for _, e := range trayEntries {
		if e.width >= size {
			best, found = e, true
			break
		}
	}
	if !found {
		best = trayEntries[len(trayEntries)-1]
	}
	img, err := png.Decode(bytes.NewReader(best.data))
	if err != nil {
		return nil
	}
	return img
}

// buildBadgeICO composes the icon at every size the tray may ask for and
// packs the results into one ICO.
func buildBadgeICO(state badgeState) []byte {
	sizes := []int{16, 20, 24, 32, 40, 48, 64}
	imgs := make([]icoImage, 0, len(sizes))
	for _, size := range sizes {
		art := artFor(size)
		if art == nil {
			continue
		}
		img := composeBadgeAt(art, state, size)
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			continue
		}
		imgs = append(imgs, icoImage{width: size, height: size, data: buf.Bytes()})
	}
	return packICO(imgs)
}

// packICO writes the ICO container (PNG payloads, Vista+).
func packICO(imgs []icoImage) []byte {
	if len(imgs) == 0 {
		return nil
	}
	header := make([]byte, 6+16*len(imgs))
	header[2] = 1 // type: icon
	header[4] = byte(len(imgs))
	offset := len(header)
	for i, im := range imgs {
		p := 6 + i*16
		w := im.width
		if w >= 256 {
			w = 0
		}
		header[p] = byte(w)
		header[p+1] = byte(w)
		header[p+2] = 0
		header[p+3] = 0
		putU16(header, p+4, 1)  // planes
		putU16(header, p+6, 32) // bits
		putU32(header, p+8, uint32(len(im.data)))
		putU32(header, p+12, uint32(offset))
		offset += len(im.data)
	}
	out := make([]byte, 0, offset)
	out = append(out, header...)
	for _, im := range imgs {
		out = append(out, im.data...)
	}
	return out
}

type icoImage struct {
	width, height int
	data          []byte
}

// icoEntries lists the images in an .ico whose payloads are PNGs.
func icoEntries(ico []byte) ([]icoImage, error) {
	if len(ico) < 6 {
		return nil, errShortICO
	}
	count := int(ico[4])
	var out []icoImage
	for i := 0; i < count; i++ {
		off := 6 + i*16
		if off+16 > len(ico) {
			break
		}
		w := int(ico[off])
		if w == 0 {
			w = 256
		}
		h := int(ico[off+1])
		if h == 0 {
			h = 256
		}
		size := int(ico[off+8]) | int(ico[off+9])<<8 | int(ico[off+10])<<16 | int(ico[off+11])<<24
		start := int(ico[off+12]) | int(ico[off+13])<<8 | int(ico[off+14])<<16 | int(ico[off+15])<<24
		if start+size > len(ico) || size <= 0 {
			continue
		}
		out = append(out, icoImage{width: w, height: h, data: ico[start : start+size]})
	}
	return out, nil
}

// composeBadge draws the unread pill (bottom right) and the update disc
// (top right) onto the icon, mirroring StatusBadgeSupport.
func composeBadgeAt(base image.Image, state badgeState, px int) image.Image {
	scaled := resizeRGBA(toRGBA(base), px)
	dst := scaled
	size := float64(px)
	if state.Update {
		// blue disc with an up arrow, top right
		disc := size * 0.46
		drawDisc(dst, size-disc*0.62, disc*0.30, disc, color.RGBA{0x2E, 0x8B, 0xF0, 0xFF})
		drawUpArrow(dst, size-disc*0.62, disc*0.30, disc, color.RGBA{0xFF, 0xFF, 0xFF, 0xFF})
	}
	if state.Unread > 0 {
		// red pill with the count, bottom right
		text := badgeText(state.Unread)
		pillH := size * 0.44
		pillW := pillH
		if len(text) > 1 {
			pillW = pillH * (0.55 + 0.30*float64(len(text)))
		}
		x := size - pillW*0.90
		y := size - pillH*1.02
		drawPill(dst, x, y, pillW, pillH, color.RGBA{0xE5, 0x3E, 0x3E, 0xFF})
		drawBadgeDigits(dst, text, x, y, pillW, pillH)
	}
	return dst
}

func drawDisc(dst *image.RGBA, x, y, d float64, c color.RGBA) {
	drawPill(dst, x, y, d, d, c)
}

// drawPill fills a rounded rectangle (a full circle when w == h).
func drawPill(dst *image.RGBA, x, y, w, h float64, c color.RGBA) {
	r := h / 2
	for py := 0; py < int(h); py++ {
		for px := 0; px < int(w); px++ {
			fx := float64(px) + 0.5
			fy := float64(py) + 0.5
			cx := math.Min(math.Max(fx, r), w-r)
			cy := math.Min(math.Max(fy, r), h-r)
			if math.Hypot(fx-cx, fy-cy) <= r {
				dst.Set(int(x)+px, int(y)+py, c)
			}
		}
	}
}

func drawUpArrow(dst *image.RGBA, x, y, d float64, c color.RGBA) {
	cx := x + d/2
	// shaft
	shaftW := d * 0.16
	for py := int(y + d*0.34); py < int(y+d*0.76); py++ {
		for px := int(cx - shaftW/2); px < int(cx+shaftW/2); px++ {
			dst.Set(px, py, c)
		}
	}
	// head: a triangle from the tip down to the shaft top
	tip := y + d*0.22
	base := y + d*0.46
	for py := int(tip); py < int(base); py++ {
		t := (float64(py) - tip) / (base - tip)
		halfW := (d * 0.30) * t
		for px := int(cx - halfW); px <= int(cx+halfW); px++ {
			dst.Set(px, py, c)
		}
	}
}

// drawCenteredText draws the badge count with the built-in bitmap face,
// which needs no font file on disk.
// drawBadgeDigits draws the count with the 3x5 bitmaps the taskbar badge
// already uses. The old 7x13 text face could not fit a 10px pill (it
// overflowed and left a smudge), and a scaled bitmap font is exactly the
// blur the user reported; whole-pixel glyphs stay legible at 20px and up.
func drawBadgeDigits(dst *image.RGBA, label string, x, y, w, h float64) {
	runes := []rune(label)
	if len(runes) == 0 {
		return
	}
	const glyphW, glyphH, tracking = 3, 5, 1
	cols := len(runes)*glyphW + (len(runes)-1)*tracking
	scale := 0
	for s := 1; s <= 6; s++ {
		if float64(cols*s) <= w-2 && float64(glyphH*s) <= h-2 {
			scale = s
		}
	}
	if scale == 0 {
		return // no room: the red pill alone carries the signal
	}
	startX := int(x + (w-float64(cols*scale))/2)
	startY := int(y + (h-float64(glyphH*scale))/2)
	white := color.RGBA{0xFF, 0xFF, 0xFF, 0xFF}
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
				if rows[gy]&(1<<uint(glyphW-1-gx)) == 0 {
					continue
				}
				for sy := 0; sy < scale; sy++ {
					for sx := 0; sx < scale; sx++ {
						px, py := ox+gx*scale+sx, startY+gy*scale+sy
						if image.Pt(px, py).In(dst.Bounds()) {
							dst.Set(px, py, white)
						}
					}
				}
			}
		}
	}
}

// badgeText is the tray tile's label: blank for none, digits to 99, then
// "99+"; the same rule the taskbar overlay follows, so the two badges
// never disagree.
func badgeText(count int) string {
	if count <= 0 {
		return ""
	}
	if count > 99 {
		return "99+"
	}
	return strconv.Itoa(count)
}

var errShortICO = errICOTooShort{}

type errICOTooShort struct{}

func (errICOTooShort) Error() string { return "ico too short" }
