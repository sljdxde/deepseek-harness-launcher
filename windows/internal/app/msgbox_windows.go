package app

import (
	"os"
	"syscall"
	"unsafe"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

// Win32 MessageBox is the confirm dialog of record here, the counterpart
// of AlertDesign.run on macOS. Long bodies are capped the way
// AlertBoundary caps them: a shell dump never makes a dialog taller than
// the screen.
const (
	maxMessageBoxChars = 1500

	mbOK          = 0x00000000
	mbOKCancel    = 0x00000001
	mbIconInfo    = 0x00000040
	mbIconWarning = 0x00000030
	mbTopMost     = 0x00040000

	idOK     = 1
	idCancel = 2
)

var (
	user32                  = syscall.NewLazyDLL("user32.dll")
	procMessageBoxW         = user32.NewProc("MessageBoxW")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
)

// confirm asks an OK/Cancel question; true means the user agreed.
func confirm(title, text string) bool {
	// DHL_AUTO_CONFIRM=1 answers every confirm for automated runs, the
	// way the macOS installer's tests use DHL_STOP_SCOPE. A dev/test
	// hook only; never set it on a machine that matters.
	if os.Getenv("DHL_AUTO_CONFIRM") == "1" {
		applog.Logf("auto-confirm (DHL_AUTO_CONFIRM=1): %s", title)
		return true
	}
	return messageBox(title, text, mbOKCancel|mbIconInfo|mbTopMost) == idOK
}

// warn shows an OK-only warning.
func warn(title, text string) {
	messageBox(title, text, mbOK|mbIconWarning|mbTopMost)
}

func messageBox(title, text string, flags uint32) int {
	if runes := []rune(text); len(runes) > maxMessageBoxChars {
		text = string(runes[:maxMessageBoxChars]) + "\n…"
	}
	titlePtr, err := syscall.UTF16PtrFromString(title)
	if err != nil {
		return idCancel
	}
	textPtr, err := syscall.UTF16PtrFromString(text)
	if err != nil {
		return idCancel
	}
	applog.Logf("dialog: %s", title)
	ret, _, _ := procMessageBoxW.Call(0, uintptr(unsafe.Pointer(textPtr)), uintptr(unsafe.Pointer(titlePtr)), uintptr(flags))
	return int(ret)
}

// bringToFront puts the launcher in front before showing a dialog from a
// background goroutine (without it, a tray app's dialog can appear
// behind).
func bringToFront() {
	_, _, _ = procSetForegroundWindow.Call(0)
}
