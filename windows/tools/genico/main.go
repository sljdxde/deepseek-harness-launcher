// genico builds a Windows .ico out of PNG files, one directory entry per
// PNG. Entries are stored as PNG (Vista and later read them), so the
// input PNGs go in untouched — no re-encode, no quality lost.
//
// Usage: go run ./tools/genico -out assets/tray.ico a.png b.png …
//
// The iconset's sizes are the source of truth; the tool takes whatever
// sizes it is given, and Windows picks the nearest one it wants.
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	out := flag.String("out", "tray.ico", "the .ico to write")
	flag.Parse()
	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "genico: give at least one png")
		os.Exit(2)
	}
	var entries []icoEntry
	for _, path := range flag.Args() {
		data, err := os.ReadFile(path)
		if err != nil {
			fail("%s: %v", path, err)
		}
		w, h, err := pngSize(data)
		if err != nil {
			fail("%s: %v", path, err)
		}
		entries = append(entries, icoEntry{width: w, height: h, data: data})
	}
	if err := os.WriteFile(*out, buildICO(entries), 0o644); err != nil {
		fail("write %s: %v", *out, err)
	}
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
