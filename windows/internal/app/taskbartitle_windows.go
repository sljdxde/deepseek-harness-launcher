package app

// taskbartitle_windows.go sets the main window's title. The taskbar
// button shows it as a tooltip and in Alt+Tab, which is the fallback
// badge on shells that do not expose ITaskbarList3.

import (
	"syscall"
	"unsafe"
)

var (
	procSetWindowTextW    = user32.NewProc("SetWindowTextW")
	procSetWindowPos      = user32.NewProc("SetWindowPos")
	procGetWindowLongPt   = user32.NewProc("GetWindowLongPtrW")
	procSetWindowLongPt   = user32.NewProc("SetWindowLongPtrW")
	procIsZoomed          = user32.NewProc("IsZoomed")
	procShowWindowCmd     = user32.NewProc("ShowWindow")
	procGetWindowRect     = user32.NewProc("GetWindowRect")
	procMonitorFromWindow = user32.NewProc("MonitorFromWindow")
	procGetMonitorInfo    = user32.NewProc("GetMonitorInfoW")
)

const (
	gwlStyle      = ^uintptr(15) // -16
	wsCaption     = 0x00C00000
	wsSysMenu     = 0x00080000
	wsThickFrame  = 0x00040000
	wsMinimizeBox = 0x00020000
	wsMaximizeBox = 0x00010000
	swMaximize    = 3

	swpNoSize       = 0x0001
	swpNoMove       = 0x0002
	swpNoZOrder     = 0x0004
	swpFrameChanged = 0x0020
)

const monitorDefaultToNearest = 2

// monitorInfo mirrors MONITORINFO.
type monitorInfo struct {
	cbSize    uint32
	rcMonitor struct{ left, top, right, bottom int32 }
	rcWork    struct{ left, top, right, bottom int32 }
	dwFlags   uint32
}

// ensureStandardFrame makes sure the window really carries the native
// title bar with its minimise / maximise / close buttons.
//
// The symptom it fixes: a window maximised to (-13,-43)-(1933,1063) — 43px
// above the screen — leaves the whole caption bar off-screen, so the
// buttons exist but cannot be seen or clicked. Re-applying the caption
// bits and letting the shell re-maximise snaps it back to the normal
// maximised rectangle.
func ensureStandardFrame(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	style, _, _ := procGetWindowLongPt.Call(hwnd, gwlStyle)
	want := style | wsCaption | wsSysMenu | wsThickFrame | wsMinimizeBox | wsMaximizeBox
	if want != style {
		procSetWindowLongPt.Call(hwnd, gwlStyle, want)
		procSetWindowPos.Call(hwnd, 0, 0, 0, 0, 0,
			swpNoSize|swpNoMove|swpNoZOrder|swpFrameChanged)
	}
	// A window placed with its top edge above the monitor has its whole
	// caption bar off-screen: the buttons exist but cannot be reached.
	// Pulling it back onto the monitor's work area is what makes them
	// visible again (this machine's window sat at y=-43).
	clampIntoMonitor(hwnd)
}

// clampIntoMonitor moves a window that starts above/left of its monitor
// back inside the work area, keeping its size.
func clampIntoMonitor(hwnd uintptr) {
	var r struct{ left, top, right, bottom int32 }
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 {
		return
	}
	mon, _, _ := procMonitorFromWindow.Call(hwnd, monitorDefaultToNearest)
	if mon == 0 {
		return
	}
	var mi monitorInfo
	mi.cbSize = uint32(unsafe.Sizeof(mi))
	if ok, _, _ := procGetMonitorInfo.Call(mon, uintptr(unsafe.Pointer(&mi))); ok == 0 {
		return
	}
	workW := mi.rcWork.right - mi.rcWork.left
	workH := mi.rcWork.bottom - mi.rcWork.top
	w, h := r.right-r.left, r.bottom-r.top
	// A window wider or taller than the work area has its caption's right
	// end (where the buttons live) and its bottom edge off-screen. Shrink
	// to the work area, which is exactly what a proper maximise would do.
	resize := false
	if w > workW {
		w, resize = workW, true
	}
	if h > workH {
		h, resize = workH, true
	}
	x, y := r.left, r.top
	if y < mi.rcWork.top {
		y = mi.rcWork.top
	}
	if x < mi.rcWork.left {
		x = mi.rcWork.left
	}
	if x+w > mi.rcWork.right {
		x = mi.rcWork.right - w
	}
	if y+h > mi.rcWork.bottom {
		y = mi.rcWork.bottom - h
	}
	if x == r.left && y == r.top && !resize {
		return
	}
	const swpNoZOrder = 0x0004
	procSetWindowPos.Call(hwnd, 0, uintptr(x), uintptr(y), uintptr(w), uintptr(h), swpNoZOrder)
}

func setTaskbarTitle(title string) {
	if badge.hwnd == 0 {
		return
	}
	ptr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return
	}
	procSetWindowTextW.Call(uintptr(badge.hwnd), uintptr(unsafe.Pointer(ptr)))
}

// raiseTopmost pushes a window above every other window. Wails beta.24's
// AlwaysOnTop did not hold on this machine once the Harness window was
// maximised, which left the panel hidden behind it; this is the same
// HWND_TOPMOST the shell itself uses.
func raiseTopmost(hwnd uintptr) {
	if hwnd == 0 {
		return
	}
	const (
		hwndTopmost   = ^uintptr(0) // (HWND)-1
		swpNoSize     = 0x0001
		swpNoMove     = 0x0002
		swpShowWindow = 0x0040
	)
	procSetWindowPos.Call(hwnd, hwndTopmost, 0, 0, 0, 0, swpNoSize|swpNoMove|swpShowWindow)
}
