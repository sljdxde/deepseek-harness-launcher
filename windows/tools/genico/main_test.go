package main

// Tests for the icon ladder. The soft-icon report was a coverage problem,
// not a drawing problem: Windows asks for 20/24/40/48 as well, and an .ico
// that only carries 16/32/64/128/256 makes the shell rescale. These tests
// pin the ladder, the downscale-only rule, and the ICO container the shell
// has to parse.

import (
	"image"
	"image/color"
	"testing"
)

// Every size Windows actually requests must be in the ladder. 48 and 24
// are the ones that were missing (SM_CXICON / SM_CXSMICON at 100%/125%).
func TestIconLadderCoversShellSizes(t *testing.T) {
	want := map[int]bool{16: false, 20: false, 24: false, 32: false, 40: false, 48: false, 64: false, 128: false, 256: false}
	for _, size := range iconLadder {
		if _, ok := want[size]; ok {
			want[size] = true
		}
	}
	for size, found := range want {
		if !found {
			t.Errorf("the ladder is missing %dpx, so the shell would rescale that box", size)
		}
	}
	// and nothing absurd: Windows ignores entries above 256
	for _, size := range iconLadder {
		if size > 256 {
			t.Errorf("ladder carries %dpx; Windows only reads up to 256", size)
		}
	}
}

// nearestLarger must pick the smallest source that still covers the
// target: downscaling 256→48 loses far more detail than 64→48.
func TestNearestLargerPicksTightestSource(t *testing.T) {
	bySize := map[int]image.Image{
		16: solid(16), 32: solid(32), 64: solid(64), 256: solid(256),
	}
	sizes := []int{16, 32, 64, 256}
	cases := []struct{ target, want int }{
		{20, 32}, {24, 32}, {40, 64}, {48, 64}, {64, 64}, {128, 256},
	}
	for _, c := range cases {
		img, ok := nearestLarger(bySize, sizes, c.target)
		if !ok {
			t.Errorf("target %d: no source found", c.target)
			continue
		}
		if got := img.Bounds().Dx(); got != c.want {
			t.Errorf("target %d picked the %dpx source, want %dpx", c.target, got, c.want)
		}
	}
	// a target larger than every source has nothing to downscale from
	if _, ok := nearestLarger(bySize, sizes, 512); ok {
		t.Error("target 512 found a source; sizes above the largest input must be skipped")
	}
}

// scale must produce exactly the requested square, or the ICO directory
// entry would disagree with the payload.
func TestScaleProducesExactSize(t *testing.T) {
	for _, size := range []int{16, 20, 24, 40, 48} {
		img := scale(solid(64), size)
		if got := img.Bounds().Dx(); got != size {
			t.Errorf("scale to %d produced %dpx wide", size, got)
		}
		if got := img.Bounds().Dy(); got != size {
			t.Errorf("scale to %d produced %dpx tall", size, got)
		}
	}
}

// buildICO must write a container the shell can parse: the ICONDIR magic,
// one 16-byte entry per image, and offsets that land on each payload.
func TestBuildICOLaysOutDirectory(t *testing.T) {
	entries := []icoEntry{
		{width: 16, height: 16, data: []byte("a")},
		{width: 48, height: 48, data: []byte("bb")},
		{width: 256, height: 256, data: []byte("ccc")},
	}
	ico := buildICO(entries)

	if ico[0] != 0 || ico[1] != 0 {
		t.Errorf("reserved bytes = %v, want 0,0", ico[:2])
	}
	if ico[2] != 1 || ico[3] != 0 {
		t.Errorf("type = %d, want 1 (icon)", ico[2])
	}
	if got := int(ico[4]); got != len(entries) {
		t.Errorf("count = %d, want %d", got, len(entries))
	}

	// the directory's dimension byte: 256 is encoded as 0
	wantDims := []byte{16, 48, 0}
	for i, want := range wantDims {
		if got := ico[6+i*16]; got != want {
			t.Errorf("entry %d dimension byte = %d, want %d", i, got, want)
		}
	}

	// every offset must point at its payload
	offset := 6 + 16*len(entries)
	for i, e := range entries {
		at := 6 + i*16 + 12
		got := int(ico[at]) | int(ico[at+1])<<8 | int(ico[at+2])<<16 | int(ico[at+3])<<24
		if got != offset {
			t.Errorf("entry %d offset = %d, want %d", i, got, offset)
		}
		if string(ico[got:got+len(e.data)]) != string(e.data) {
			t.Errorf("entry %d payload mismatch", i)
		}
		offset += len(e.data)
	}
}

// solid returns a size×size opaque image, enough for the geometry tests.
func solid(size int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, color.NRGBA{R: 0x10, G: 0x20, B: 0x30, A: 0xff})
		}
	}
	return img
}
