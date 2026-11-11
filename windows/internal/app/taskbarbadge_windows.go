package app

// taskbarbadge_windows.go draws the unread count on the taskbar button —
// the Windows counterpart of the macOS menu bar badge.
//
// The badge is an overlay icon: Windows draws a small image at the
// button's lower-right corner. It cannot draw text, so the count is
// rendered into a bitmap here and handed over through
// ITaskbarList3::SetOverlayIcon. Overlay icons exist on Windows 7 and
// later; a shell that refuses the call leaves the tray badge as the
// fallback.

import (
	"image"
	"image/color"
	"strconv"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

var (
	ole32dll         = syscall.NewLazyDLL("ole32.dll")
	procCoInitEx     = ole32dll.NewProc("CoInitializeEx")
	procCoCreateInst = ole32dll.NewProc("CoCreateInstance")

	procCreateIconIndirect = user32.NewProc("CreateIconIndirect")
	procDestroyIcon        = user32.NewProc("DestroyIcon")
)

// CLSID_TaskbarList {56FDF344-FD6D-11d0-958A-006097C9A090}
var clsidTaskbarList = guid{
	0x56FDF344, 0xFD6D, 0x11d0,
	[8]byte{0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90},
}

// IID_ITaskbarList3 {EA1AFB91-9E28-4B86-90E9-9E9F8A5EEA84}
var iidTaskbarList3 = guid{
	0xEA1AFB91, 0x9E28, 0x4B86,
	[8]byte{0x90, 0xE9, 0x9E, 0x9F, 0x8A, 0x5E, 0xEA, 0x84},
}

type guid struct {
	Data1 uint32
	Data2 uint16
	Data3 uint16
	Data4 [8]byte
}

// itaskbarList3Vtbl mirrors the interface's vtable. Field order is the
// declaration order; unused entries are padding so the indices line up.
type itaskbarList3Vtbl struct {
	QueryInterface        uintptr
	AddRef                uintptr
	Release               uintptr
	HrInit                uintptr // ITaskbarList
	AddTab                uintptr
	DeleteTab             uintptr
	ActivateTab           uintptr
	SetActiveAlt          uintptr
	MarkFullscreen        uintptr // ITaskbarList2
	SetProgressValue      uintptr // ITaskbarList3
	SetProgressState      uintptr
	RegisterTab           uintptr
	UnregisterTab         uintptr
	SetTabOrder           uintptr
	SetTabActive          uintptr
	ThumbBarAddButtons    uintptr
	ThumbBarUpdateButtons uintptr
	ThumbBarSetImageList  uintptr
	SetOverlayIcon        uintptr // the one this file uses
	SetStatus             uintptr
}

type taskbarBadge struct {
	mu     sync.Mutex
	vtbl   *itaskbarList3Vtbl
	self   uintptr
	hwnd   syscall.Handle
	last   string
	icon   uintptr // overlay icon currently installed
	inited bool
	// overlayOK says whether the shell gave us ITaskbarList3. When false
	// the window title carries the count instead (see setTaskbarBadge).
	overlayOK bool
}

var badge = &taskbarBadge{}

// initTaskbarBadge binds to the shell's taskbar object for hwnd and
// registers the button. It must run on the GUI thread: Wails initialises
// COM there, and ITaskbarList3 is only available from the thread's own
// apartment. Safe to call more than once.
func initTaskbarBadge(hwnd syscall.Handle) {
	if hwnd == 0 {
		return
	}
	application.InvokeSync(func() {
		initTaskbarBadgeOnGUIThread(hwnd)
	})
}

func initTaskbarBadgeOnGUIThread(hwnd syscall.Handle) {
	badge.mu.Lock()
	defer badge.mu.Unlock()
	badge.hwnd = hwnd
	if badge.inited {
		return
	}

	// ITaskbarList3 needs an STA. If something already initialised COM as
	// MTA the call returns RPC_E_CHANGED_MODE and the interface is not
	// available, so the mode is logged rather than assumed.
	hrInit, _, _ := procCoInitEx.Call(0, 0x2) // COINIT_APARTMENTTHREADED
	applog.Logf("taskbar badge: CoInitializeEx hr=0x%x", hrInit)

	var obj unsafe.Pointer
	hr, _, _ := procCoCreateInst.Call(
		uintptr(unsafe.Pointer(&clsidTaskbarList)),
		0,
		0x1|0x4, // CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER
		uintptr(unsafe.Pointer(&iidTaskbarList3)),
		uintptr(unsafe.Pointer(&obj)),
	)
	if hr != 0 || obj == nil {
		// This shell does not expose ITaskbarList3. Keep going: the
		// window title carries the count instead, which needs no COM.
		badge.inited = true
		badge.overlayOK = false
		applog.Logf("taskbar badge: ITaskbarList3 unavailable (hr=0x%x); "+
			"falling back to the taskbar button title", hr)
		return
	}
	self := uintptr(obj)
	vtbl := *(**itaskbarList3Vtbl)(obj)
	callCOM(vtbl.HrInit, self)
	// AddTab is what gives a hidden window its button
	callCOM(vtbl.AddTab, self, uintptr(hwnd))

	badge.vtbl = vtbl
	badge.self = self
	badge.inited = true
	badge.overlayOK = true
	applog.Logf("taskbar badge ready (hwnd=%d)", hwnd)
}

// callCOM invokes one vtable entry with the this-pointer first.
func callCOM(fn uintptr, self uintptr, args ...uintptr) uintptr {
	if fn == 0 {
		return 1
	}
	all := append([]uintptr{self}, args...)
	ret, _, _ := syscall.SyscallN(fn, all...)
	return ret
}

// taskbarBadgeReset forgets the last painted text, forcing the next
// setTaskbarBadge call to repaint.
func taskbarBadgeReset() {
	badge.mu.Lock()
	badge.last = "\x00forget"
	badge.mu.Unlock()
}

// setTaskbarBadge paints count on the taskbar button; 0 clears it. The
// overlay is rebuilt only when the text changes, since the shell keeps a
// reference to the icon handle.
func setTaskbarBadge(count int) {
	badge.mu.Lock()
	defer badge.mu.Unlock()
	// NOTE: no early return when vtbl is nil. The overlay interface is
	// optional — the title and the painted icon work without it, and an
	// early return here is what kept the count off the taskbar button on
	// shells that do not expose ITaskbarList3.
	text := taskbarBadgeText(count)
	// Before the badge is bound to a window there is nowhere to paint, and
	// recording the text here would make the next (post-bind) call think it
	// was already drawn — that is why the count never reached the taskbar
	// icon. Skip recording until a handle exists, so the later call
	// repaints.
	bound := badge.hwnd != 0
	if bound && text == badge.last {
		return
	}
	if bound {
		badge.last = text
	}

	// the button title always reflects the count: it is the only badge
	// available when the overlay interface is missing, and it doubles as
	// the tooltip on shells that do have it
	if text == "" {
		setTaskbarTitle("DeepSeek Harness")
	} else {
		setTaskbarTitle("(" + text + ") DeepSeek Harness")
	}

	// the icon itself carries the count. This is the PRIMARY path, not a
	// fallback: on shells where SetOverlayIcon fails (this machine's returns
	// E_FAIL even though ITaskbarList4 can be created) it is the only thing
	// that puts a number on the button.
	if hwnd := badge.hwnd; hwnd != 0 {
		setTaskbarIcon(uintptr(hwnd), count)
	}

	if !badge.overlayOK {
		return
	}

	// The overlay is a nicety: the shell draws it crisper at every scale. It
	// is attempted after the painted icon so a failure here cannot leave the
	// button blank — and a failure permanently disables the attempt, because
	// a shell that refuses once refuses every time.
	if badge.icon != 0 {
		procDestroyIcon.Call(badge.icon)
		badge.icon = 0
	}
	if text == "" {
		hr := callCOM(badge.vtbl.SetOverlayIcon, badge.self, uintptr(badge.hwnd), 0, 0)
		if hr != 0 {
			badge.overlayOK = false
			applog.Logf("taskbar badge: clearing the overlay failed (hr=0x%x); "+
				"the painted icon carries the count", hr)
		}
		return
	}
	hicon := renderBadgeIcon(text)
	if hicon == 0 {
		return
	}
	desc, _ := syscall.UTF16PtrFromString(text + " 个会话未读")
	hr := callCOM(badge.vtbl.SetOverlayIcon, badge.self, uintptr(badge.hwnd),
		hicon, uintptr(unsafe.Pointer(desc)))
	if hr != 0 {
		// E_FAIL here means the shell will not draw overlays at all. Drop the
		// icon and stop trying; the painted icon is already in place.
		procDestroyIcon.Call(hicon)
		badge.overlayOK = false
		applog.Logf("taskbar badge: SetOverlayIcon failed (hr=0x%x); "+
			"the painted icon carries the count from now on", hr)
		return
	}
	badge.icon = hicon
}

// taskbarBadgeText is the badge label: blank for none, digits to 99,
// "99+" above (the macOS BadgeText rule).
func taskbarBadgeText(count int) string {
	if count <= 0 {
		return ""
	}
	if count > 99 {
		return "99+"
	}
	return strconv.Itoa(count)
}

// renderBadgeIcon draws the red pill with the count into an HICON.
// Windows scales overlay icons to the button's corner, so the art is drawn
// large and centred.
func renderBadgeIcon(text string) uintptr {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))

	pillH := float64(size) * 0.66
	textW := float64(len([]rune(text))) * 6.2
	pillW := pillH
	if textW+8 > pillW {
		pillW = textW + 8
	}
	x := (float64(size) - pillW) / 2
	y := (float64(size) - pillH) / 2
	fillPill(img, x, y, pillW, pillH, color.RGBA{0xE5, 0x34, 0x2E, 0xFF})

	face := basicfont.Face7x13
	w := font.MeasureString(face, text).Round()
	baseline := int(y+pillH/2) + face.Metrics().Ascent.Round()/2
	(&font.Drawer{
		Dst:  img,
		Src:  image.NewUniform(color.White),
		Face: face,
		Dot:  fixed.P((size-w)/2, baseline),
	}).DrawString(text)

	return rgbaToHICON(img)
}

var (
	gdi32dll               = syscall.NewLazyDLL("gdi32.dll")
	procGetDC              = user32.NewProc("GetDC")
	procReleaseDC          = user32.NewProc("ReleaseDC")
	procCreateCompatibleDC = gdi32dll.NewProc("CreateCompatibleDC")
	procDeleteDC           = gdi32dll.NewProc("DeleteDC")
	procCreateDIBSection   = gdi32dll.NewProc("CreateDIBSection")
	procCreateBitmap       = gdi32dll.NewProc("CreateBitmap")
	procDeleteObject       = gdi32dll.NewProc("DeleteObject")
)

// rgbaToHICON converts the drawn image into an HICON through a 32-bit DIB.
// CreateIconIndirect needs a colour bitmap and a mask; the mask is all
// zeros because the alpha channel already carries the shape.
func rgbaToHICON(img *image.RGBA) uintptr {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()

	const (
		biBitfields = 3
		hdrSize     = 40 + 16
	)
	hdr := make([]byte, hdrSize)
	putU32(hdr, 0, uint32(hdrSize))
	putI32(hdr, 4, int32(w))
	putI32(hdr, 8, int32(h)) // bottom-up
	putU16(hdr, 12, 1)       // planes
	putU16(hdr, 14, 32)      // bits
	putU32(hdr, 16, biBitfields)
	putU32(hdr, 20, uint32(w*h*4))
	putU32(hdr, 40, 0x00FF0000)
	putU32(hdr, 44, 0x0000FF00)
	putU32(hdr, 48, 0x000000FF)
	putU32(hdr, 52, 0xFF000000)

	pixels := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		src := img.Pix[(h-1-y)*img.Stride:]
		dst := pixels[y*w*4:]
		for x := 0; x < w; x++ {
			dst[x*4+0] = src[x*4+2]
			dst[x*4+1] = src[x*4+1]
			dst[x*4+2] = src[x*4+0]
			dst[x*4+3] = src[x*4+3]
		}
	}

	hdcScreen, _, _ := procGetDC.Call(0)
	hdcMem, _, _ := procCreateCompatibleDC.Call(hdcScreen)
	var bits unsafe.Pointer
	hbmColor, _, _ := procCreateDIBSection.Call(hdcMem, uintptr(unsafe.Pointer(&hdr[0])),
		0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	procDeleteDC.Call(hdcMem)
	procReleaseDC.Call(0, hdcScreen)
	if hbmColor == 0 || bits == nil {
		return 0
	}
	copy(unsafe.Slice((*byte)(bits), len(pixels)), pixels)

	// The mask marks pixels that are NOT drawn: 1 = transparent, 0 =
	// opaque. A zero mask therefore makes every pixel opaque, and the
	// colour bitmap's alpha decides the shape. Getting this backwards (an
	// all-ones mask) makes the whole icon vanish.
	maskStride := ((w + 15) / 16) * 2
	mask := make([]byte, maskStride*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			// transparent where the source is fully transparent
			if img.Pix[(h-1-y)*img.Stride+x*4+3] == 0 {
				mask[y*maskStride+x/8] |= 1 << (7 - uint(x%8))
			}
		}
	}
	hbmMask, _, _ := procCreateBitmap.Call(uintptr(w), uintptr(h), 1, 1,
		uintptr(unsafe.Pointer(&mask[0])))

	type iconInfo struct {
		fIcon    int32
		xHotspot uint32
		yHotspot uint32
		hbmMask  syscall.Handle
		hbmColor syscall.Handle
	}
	info := iconInfo{fIcon: 1, hbmMask: syscall.Handle(hbmMask), hbmColor: syscall.Handle(hbmColor)}
	hicon, _, _ := procCreateIconIndirect.Call(uintptr(unsafe.Pointer(&info)))

	procDeleteObject.Call(hbmColor)
	procDeleteObject.Call(hbmMask)
	return hicon
}

func putU32(b []byte, off int, v uint32) {
	b[off] = byte(v)
	b[off+1] = byte(v >> 8)
	b[off+2] = byte(v >> 16)
	b[off+3] = byte(v >> 24)
}

func putI32(b []byte, off int, v int32) { putU32(b, off, uint32(v)) }

func putU16(b []byte, off int, v uint16) {
	b[off] = byte(v)
	b[off+1] = byte(v >> 8)
}
