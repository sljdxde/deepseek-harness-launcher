package app

// panel_dismiss_windows.go closes the panel when the user clicks anywhere
// outside it.
//
// The obvious implementation — listen for WindowLostFocus — does not work
// here. The panel is frameless, AlwaysOnTop and hidden from the taskbar,
// and this shell stops delivering focus-loss events for it once it has
// shown: the log shows exactly one WindowLostFocus, the one inside the
// show grace window. The user's report is the consequence: the panel only
// closes when the tray icon is clicked again.
//
// So the click itself is watched instead, with a low-level mouse hook
// (WH_MOUSE_LL). It is the same mechanism Windows' own flyouts use, it
// needs no focus, and it sees clicks on other applications — which is
// precisely what "click anywhere" means.
//
// The hook callback runs on the thread that installed it and must return
// fast; it only reads the cursor position, tests it against the panel
// rectangle, and posts the hide to another goroutine. Never block there.

import (
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

var (
	procSetWindowsHookExW = user32.NewProc("SetWindowsHookExW")
	procCallNextHookEx    = user32.NewProc("CallNextHookEx")
	procGetCursorPos      = user32.NewProc("GetCursorPos")
	procWindowFromPoint   = user32.NewProc("WindowFromPoint")
	procGetAncestor       = user32.NewProc("GetAncestor")
	procIsChild           = user32.NewProc("IsChild")
)

const (
	whMouseLL     = 14
	wmLButtonDown = 0x0201
	wmRButtonDown = 0x0204
	wmMButtonDown = 0x0207
	wmXButtonDown = 0x020B
	gaRoot        = 2
)

// pointStruct mirrors POINT.
type pointStruct struct{ x, y int32 }

var (
	mouseHookMu     sync.Mutex
	mouseHookHandle uintptr
	// panelRect caches the panel's screen rectangle so the callback does no
	// window queries of its own (it must be fast).
	panelRect struct {
		mu                       sync.Mutex
		left, top, right, bottom int32
		valid                    bool
	}
)

// startPanelDismissHook installs the click-outside hook, once.
func startPanelDismissHook() {
	mouseHookMu.Lock()
	if mouseHookHandle != 0 {
		mouseHookMu.Unlock()
		return
	}
	mouseHookMu.Unlock()

	go func() {
		runtimeLockOSThread()
		tid, _, _ := procGetCurrentThreadId.Call()

		// The callback is a real syscall.NewCallback so Windows can call
		// into Go; it must stay reachable for the life of the hook.
		cb := syscall.NewCallback(func(nCode int32, wParam uintptr, lParam uintptr) uintptr {
			if nCode >= 0 && isOutsideClick(wParam) {
				// Hide on another goroutine: panel.Hide touches the window,
				// and the hook thread must return immediately.
				panelHideFromHookAt.Store(time.Now().UnixNano())
				applog.Logf("panel dismiss hook: click outside, hiding")
				go panel.Hide()
			}
			ret, _, _ := procCallNextHookEx.Call(0, uintptr(nCode), wParam, lParam)
			return ret
		})

		handle, _, err := procSetWindowsHookExW.Call(
			uintptr(whMouseLL), cb, 0, 0)
		if handle == 0 {
			applog.Logf("panel dismiss hook: SetWindowsHookEx failed: %v", err)
			return
		}
		mouseHookMu.Lock()
		mouseHookHandle = handle
		mouseHookMu.Unlock()
		applog.Logf("panel dismiss hook installed (thread %d)", tid)

		// A low-level hook is delivered through this thread's message
		// queue, so it has to pump. This is the same pump shape the global
		// hotkeys use.
		var msg msgStruct
		for {
			ret, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
			if ret == 0 || ret == ^uintptr(0) {
				return
			}
			procTransMsg.Call(uintptr(unsafe.Pointer(&msg)))
			procDispatch.Call(uintptr(unsafe.Pointer(&msg)))
		}
	}()
}

// setPanelRect records the panel's screen rectangle for the hook callback.
func setPanelRect(hwnd uintptr) {
	if hwnd == 0 {
		clearPanelRect()
		return
	}
	var r struct{ left, top, right, bottom int32 }
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 {
		clearPanelRect()
		return
	}
	panelRect.mu.Lock()
	panelRect.left, panelRect.top = r.left, r.top
	panelRect.right, panelRect.bottom = r.right, r.bottom
	panelRect.valid = true
	panelRect.mu.Unlock()
}

func clearPanelRect() {
	panelRect.mu.Lock()
	panelRect.valid = false
	panelRect.mu.Unlock()
}

// panelHideFromHookAt is when the click-outside hook last dismissed the
// panel. A click on the tray icon arrives as BOTH a hook event and a tray
// callback: the hook hides the panel, then openPanel sees a hidden panel
// and shows it again — the panel would blink and stay up. openPanel
// consults this stamp to recognise that second half.
var panelHideFromHookAt atomic.Int64

// hookHideWindow is how long after a hook-dismiss a tray toggle is treated
// as the same click.
const hookHideWindow = 250 * time.Millisecond

// panelWasJustDismissed reports whether the click-outside hook closed the
// panel so recently that a tray toggle now arriving is the same physical
// click. See panelHideFromHookAt.
func panelWasJustDismissed(now time.Time) bool {
	dismissed := panelHideFromHookAt.Load()
	if dismissed == 0 {
		return false
	}
	return now.Sub(time.Unix(0, dismissed)) < hookHideWindow
}

// rectContains reports whether (x,y) is inside the half-open rectangle.
// Half-open on the right/bottom edges so two adjacent rectangles never both
// claim the boundary pixel.
func rectContains(left, top, right, bottom, x, y int32) bool {
	return x >= left && x < right && y >= top && y < bottom
}

// isOutsideClick reports whether this hook message is a mouse-down that
// did not land on the panel.
//
// The cursor position is queried with GetCursorPos rather than read out of
// the MSLLHOOKSTRUCT that Windows passes in lParam. Dereferencing lParam
// would mean converting a uintptr to a pointer, which `go vet` flags as
// possible misuse — and this repo's CI runs `go vet ./...`. GetCursorPos
// reports the same coordinates (a WH_MOUSE_LL callback runs before the
// click is dispatched, so the cursor is already where the click lands) and
// needs no unsafe pointer arithmetic.
func isOutsideClick(wParam uintptr) bool {
	switch uint32(wParam) {
	case wmLButtonDown, wmRButtonDown, wmMButtonDown, wmXButtonDown:
	default:
		return false
	}
	if !panelIsVisible() {
		return false
	}
	var pt pointStruct
	if ok, _, _ := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt))); ok == 0 {
		return false
	}

	panelRect.mu.Lock()
	valid := panelRect.valid
	left, top, right, bottom := panelRect.left, panelRect.top, panelRect.right, panelRect.bottom
	panelRect.mu.Unlock()

	if valid {
		if rectContains(left, top, right, bottom, pt.x, pt.y) {
			return false // inside the panel: the page handles it
		}
		return true
	}

	// No rectangle recorded (the panel moved since): fall back to asking
	// the shell which window is under the cursor.
	hwnd := panelHWND()
	if hwnd == 0 {
		return false
	}
	under, _, _ := procWindowFromPoint.Call(uintptr(unsafe.Pointer(&pt)))
	if under == 0 {
		return true
	}
	if under == hwnd {
		return false
	}
	// the panel's webview lives in a child window of the panel
	if ok, _, _ := procIsChild.Call(hwnd, under); ok != 0 {
		return false
	}
	root, _, _ := procGetAncestor.Call(under, gaRoot)
	return root != hwnd
}

// panelIsVisible reports the panel's visibility without taking the lock
// the hide path needs (the hook must not deadlock against a Hide).
func panelIsVisible() bool {
	panel.mu.Lock()
	visible := panel.visible
	panel.mu.Unlock()
	return visible
}

// panelHWND returns the panel's native handle, 0 when it has none yet.
func panelHWND() uintptr {
	panel.mu.Lock()
	w := panel.win
	panel.mu.Unlock()
	return windowHWND(w)
}
