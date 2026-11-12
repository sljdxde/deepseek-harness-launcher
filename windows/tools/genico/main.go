// genico builds a Windows .ico out of PNG files, one directory entry per
// PNG. Entries are stored as PNG (Vista and later read them), so the
// input PNGs go in untouched — no re-encode, no quality lost.
//
// Usage: go run ./tools/genico -out assets/tray.ico a.png b.png …
//
// The inputs are used as-is, and the standard Windows icon ladder is
// filled in for any size they do not cover. Windows asks a window for
// SM_CXICON (48px at 100%, 60px at 125%) and SM_CXSMICON (24px at 125%),
// so an .ico carrying only 16/32/64/128/256 makes the shell rescale
// 64→48 and 32→24 — and that rescale is what made the tray and taskbar
// art look soft. Filling the ladder means the shell finds an exact size
// and never resamples.
package main

import (
	"bytes"
	"flag"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"sort"

	xdraw "golang.org/x/image/draw"
)

// iconLadder is the set of sizes Windows actually asks for: the classic
// 100% boxes, the 125%/150% shell boxes, and the large-art entries.
var iconLadder = []int{16, 20, 24, 32, 40, 48, 64, 128, 256}

func main() {
	out := flag.String("out", "tray.ico", "the .ico to write")
	pngDir := flag.String("pngdir", "", "also write the ladder as <dir>/icon-<size>.png (for winres, which reads PNGs, not .ico)")
	flag.Parse()
	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "genico: give at least one png")
		os.Exit(2)
	}

	// decode every input once, keyed by its pixel size
	bySize := map[int]image.Image{}
	var srcSizes []int
	for _, path := range flag.Args() {
		data, err := os.ReadFile(path)
		if err != nil {
			fail("%s: %v", path, err)
		}
		w, h, err := pngSize(data)
		if err != nil {
			fail("%s: %v", path, err)
		}
		if w != h {
			fail("%s: not square (%dx%d)", path, w, h)
		}
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			fail("%s: %v", path, err)
		}
		if _, dup := bySize[w]; !dup {
			bySize[w] = img
			srcSizes = append(srcSizes, w)
		}
	}
	sort.Ints(srcSizes)
	largest := srcSizes[len(srcSizes)-1]

	var entries []icoEntry
	for _, size := range iconLadder {
		if img, ok := bySize[size]; ok {
			// exact art: keep the supplied pixels
			entries = append(entries, icoEntry{width: size, height: size, data: encodePNG(img)})
			continue
		}
		// Nothing at this size. Downscaling from the nearest larger source
		// is the good direction; sizes above the largest input are skipped
		// rather than invented from a small image.
		src, ok := nearestLarger(bySize, srcSizes, size)
		if !ok {
			continue
		}
		entries = append(entries, icoEntry{width: size, height: size, data: encodePNG(scale(src, size))})
	}
	if len(entries) == 0 {
		fail("no usable sizes (largest input is %dpx)", largest)
	}
	if err := os.WriteFile(*out, buildICO(entries), 0o644); err != nil {
		fail("write %s: %v", *out, err)
	}
	if *pngDir != "" {
		if err := os.MkdirAll(*pngDir, 0o755); err != nil {
			fail("mkdir %s: %v", *pngDir, err)
		}
		for _, e := range entries {
			path := filepath.Join(*pngDir, fmt.Sprintf("icon-%d.png", e.width))
			if err := os.WriteFile(path, e.data, 0o644); err != nil {
				fail("write %s: %v", path, err)
			}
		}
	}
}

// nearestLarger returns the smallest source image that is still at least
// size px, so a downscale never travels further than it must.
func nearestLarger(bySize map[int]image.Image, sizes []int, size int) (image.Image, bool) {
	for _, s := range sizes {
		if s >= size {
			return bySize[s], true
		}
	}
	return nil, false
}

// scale resamples src to size×size with CatmullRom — the filter icon art
// is normally resampled with, and far cleaner than a box filter.
func scale(src image.Image, size int) image.Image {
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), xdraw.Over, nil)
	return dst
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		fail("encode png: %v", err)
	}
	return buf.Bytes()
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "genico: "+format+"\n", args...)
	os.Exit(1)
}

// pngSize reads an IHDR's width and height, the only bits the directory
// entry wants.
func pngSize(data []byte) (int, int, error) {
	// PNG signature (8) + IHDR length/type (8), then width and height,
	// each a big-endian uint32 at fixed offsets
	const ihdrWidth = 16
	const ihdrHeight = 20
	if len(data) < 24 {
		return 0, 0, fmt.Errorf("png too short (%d bytes)", len(data))
	}
	sig := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	for i, b := range sig {
		if data[i] != b {
			return 0, 0, fmt.Errorf("not a png")
		}
	}
	w := int(uint32(data[ihdrWidth])<<24 | uint32(data[ihdrWidth+1])<<16 | uint32(data[ihdrWidth+2])<<8 | uint32(data[ihdrWidth+3]))
	h := int(uint32(data[ihdrHeight])<<24 | uint32(data[ihdrHeight+1])<<16 | uint32(data[ihdrHeight+2])<<8 | uint32(data[ihdrHeight+3]))
	return w, h, nil
}

type icoEntry struct {
	width, height int
	data          []byte
}

// buildICO assembles ICONDIR + one ICONDIRENTRY per image + the images.
// A dimension byte of 0 means 256.
func buildICO(entries []icoEntry) []byte {
	var b []byte
	b = append(b, 0, 0)                  // reserved
	b = append(b, 1, 0)                  // type: icon
	b = append(b, byte(len(entries)), 0) // count
	offset := 6 + 16*len(entries)
	for _, e := range entries {
		b = append(b, dirByte(e.width), dirByte(e.height))
		b = append(b, 0, 0)  // color count, reserved
		b = append(b, 1, 0)  // planes
		b = append(b, 32, 0) // bits per pixel
		n := len(e.data)
		b = append(b, byte(n), byte(n>>8), byte(n>>16), byte(n>>24))
		b = append(b, byte(offset), byte(offset>>8), byte(offset>>16), byte(offset>>24))
		offset += n
	}
	for _, e := range entries {
		b = append(b, e.data...)
	}
	return b
}

// dirByte folds a pixel size into the entry's one byte: 256 is written 0.
func dirByte(size int) byte {
	if size >= 256 {
		return 0
	}
	return byte(size)
}
