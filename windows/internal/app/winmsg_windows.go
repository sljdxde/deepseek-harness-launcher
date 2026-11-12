package app

// winmsg_windows.go holds the Win32 message-loop primitives shared by
// the global-hotkey pump. They used to live in hostpump_windows.go,
// deleted with the invisible-host-window click-detection hack.

const wmQuit = 0x0012

type msgStruct struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

var (
	procGetMessage = user32.NewProc("GetMessageW")
	procPeekMessage = user32.NewProc("PeekMessageW")
	procTransMsg   = user32.NewProc("TranslateMessage")
	procDispatch   = user32.NewProc("DispatchMessageW")
	procPostQuit   = user32.NewProc("PostQuitMessage")
	// procPostThreadMessage wakes a thread parked in GetMessage: the
	// hotkey pump needs it to run queued registrations on its own thread.
	procPostThreadMessage  = user32.NewProc("PostThreadMessageW")
	procGetCurrentThreadId = kernel32.NewProc("GetCurrentThreadId")
)
