package app

// hotkeys_windows.go registers the launcher's global shortcuts.
//
// Windows delivers WM_HOTKEY to the thread that called RegisterHotKey, so
// the registration and the message pump must share a thread. The pump runs
// on its own locked OS thread (see hotkeyLoop) and dispatches by hotkey id.
//
// Two groups exist:
//   - the user's "summon Harness" chord (configurable in settings, default
//     Ctrl+Alt+D) — the macOS launcher's ⌃⌥D;
//   - the panel's own shortcuts (Ctrl+O / Ctrl+, / Ctrl+R / Ctrl+L /
//     Ctrl+Q), which the panel labels. They are registered globally so
//     they work even when the panel is closed, matching the macOS menu's
//     ⌘-equivalents.

import (
	"fmt"
	"sync"
	"time"
	"unsafe"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

var (
	procRegisterHotKey   = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey = user32.NewProc("UnregisterHotKey")
)

const (
	wmHotkey   = 0x0312
	modAlt     = 0x0001
	modControl = 0x0002
	modShift   = 0x0004
	modWin     = 0x0008
)

// hotkey ids. 1 is the user's summon chord; the rest are the panel's.
// 3 is 刷新 Harness 页面 (Ctrl+R) — the macOS launcher moved ⌘R from
// 重启 to reload-the-page, and the panel's 重启 button keeps no chord.
const (
	hotkeySummon  = 1
	hotkeyOpen    = 2
	hotkeyRefresh = 3
	hotkeyLog     = 4
	hotkeyQuit    = 5
	hotkeyPanel   = 6
)

var (
	hotkeyMu   sync.Mutex
	registered = map[int]string{} // id → chord currently held
	// hotkeyActions is filled in by the shell: id → what to do
	hotkeyActions = map[int]func(){}
	// hotkeyThreadStarted guards the one pump goroutine
	hotkeyThreadStarted bool
	// hotkeyThreadID is the OS thread the pump runs on. RegisterHotKey
	// binds a chord to the CALLING thread and Windows posts WM_HOTKEY to
	// that thread only, so every registration must be executed there —
	// calling it from the Wails goroutine registered the chords against a
	// thread nobody pumps, and no global shortcut ever fired.
	hotkeyThreadID uint32
	// hotkeyRequests carries work from callers to the pump thread.
	hotkeyRequests chan func()
	// hotkeyReady is closed once the pump thread has published its id.
	hotkeyReady = make(chan struct{})
)

// setHotkeyActions installs what each id should do. Called once at start.
func setHotkeyActions(actions map[int]func()) {
	hotkeyMu.Lock()
	defer hotkeyMu.Unlock()
	hotkeyActions = actions
}

// onHotkeyThread runs fn on the hotkey pump thread, which is the only
// thread Windows will deliver WM_HOTKEY to. It blocks until fn has run so
// callers keep the old synchronous contract (a refused chord is logged
// before the caller returns).
func onHotkeyThread(fn func()) {
	startHotkeyPump()
	<-hotkeyReady
	hotkeyMu.Lock()
	tid := hotkeyThreadID
	ch := hotkeyRequests
	hotkeyMu.Unlock()
	done := make(chan struct{})
	select {
	case ch <- func() { fn(); close(done) }:
	case <-time.After(2 * time.Second):
		applog.Logf("hotkey: request queue full")
		return
	}
	// The pump is parked in GetMessage; a channel send alone does not wake
	// it, so post the wake message to its thread.
	procPostThreadMessage.Call(uintptr(tid), wmHotkeyWake, 0, 0)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		applog.Logf("hotkey: pump thread did not answer within 2s")
	}
}

// registerHotkey binds one chord to an id, replacing any earlier binding.
// The RegisterHotKey call itself happens on the pump thread (see
// hotkeyThreadID); this function may be called from any goroutine.
func registerHotkey(id int, chord string) {
	mods, vk, ok := parseHotkey(chord)
	if !ok {
		applog.Logf("hotkey %d: cannot parse %q", id, chord)
		return
	}
	onHotkeyThread(func() {
		hotkeyMu.Lock()
		if _, held := registered[id]; held {
			procUnregisterHotKey.Call(0, uintptr(id))
			delete(registered, id)
		}
		hotkeyMu.Unlock()

		ret, _, _ := procRegisterHotKey.Call(0, uintptr(id), uintptr(mods), uintptr(vk))
		if ret == 0 {
			// another app owns the chord; say which one failed rather than
			// silently losing it
			applog.Logf("hotkey %d: RegisterHotKey(%s) refused (already taken)", id, chord)
			return
		}
		hotkeyMu.Lock()
		registered[id] = chord
		hotkeyMu.Unlock()
		applog.Logf("hotkey %d registered: %s", id, chord)
	})
}

// unregisterHotkey releases one id.
func unregisterHotkey(id int) {
	onHotkeyThread(func() {
		hotkeyMu.Lock()
		_, held := registered[id]
		delete(registered, id)
		hotkeyMu.Unlock()
		if held {
			procUnregisterHotKey.Call(0, uintptr(id))
		}
	})
}

// applyGlobalHotKey registers the user's summon chord and the panel's
// fixed shortcuts. Called at start and whenever settings change.
func applyGlobalHotKey(enabled bool, chord string) {
	if enabled && chord != "" {
		registerHotkey(hotkeySummon, chord)
	} else {
		unregisterHotkey(hotkeySummon)
	}
}

// applyPanelHotkeys registers the panel's own shortcuts. They are not
// user-configurable, so this runs once.
func applyPanelHotkeys() {
	registerHotkey(hotkeyOpen, "Ctrl+O")
	registerHotkey(hotkeyRefresh, "Ctrl+R")
	registerHotkey(hotkeyLog, "Ctrl+L")
	registerHotkey(hotkeyQuit, "Ctrl+Q")
	registerHotkey(hotkeyPanel, "Ctrl+Alt+L")
}

// startHotkeyPump starts the message pump for WM_HOTKEY on its own thread,
// once.
func startHotkeyPump() {
	hotkeyMu.Lock()
	if hotkeyThreadStarted {
		hotkeyMu.Unlock()
		return
	}
	hotkeyThreadStarted = true
	hotkeyRequests = make(chan func(), 8)
	hotkeyMu.Unlock()
	go hotkeyLoop()
}

// wmHotkeyWake wakes the pump thread so it drains queued registrations.
// It has to be a posted thread message rather than a channel select: the
// pump blocks in GetMessage, and GetMessage returns only for messages.
const wmHotkeyWake = 0x0400 + 17 // WM_APP + 17

// hotkeyLoop drains this thread's queue and dispatches WM_HOTKEY. It is
// the only thread allowed to call RegisterHotKey — Windows binds a chord
// to the registering thread and posts WM_HOTKEY there, so a registration
// made anywhere else is a chord nothing will ever hear.
func hotkeyLoop() {
	runtimeLockOSThread()
	// GetCurrentThreadId, not the goroutine: the Win32 thread is what
	// RegisterHotKey and PostThreadMessage care about.
	tid, _, _ := procGetCurrentThreadId.Call()
	// A thread's message queue does not exist until something asks for it,
	// and PostThreadMessage to a queue-less thread fails outright. PeekMessage
	// with PM_NOREMOVE creates the queue, so the id published below is one
	// wake messages can actually reach.
	const pmNoRemove = 0x0000
	procPeekMessage.Call(0, 0, 0, 0, pmNoRemove)
	hotkeyMu.Lock()
	hotkeyThreadID = uint32(tid)
	hotkeyMu.Unlock()
	close(hotkeyReady)
	applog.Logf("hotkey pump: running on its own thread")

	var msg msgStruct
	for {
		ret, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if ret == 0 || ret == ^uintptr(0) {
			return // WM_QUIT or error
		}
		if msg.message == wmHotkeyWake {
			drainHotkeyRequests()
			continue
		}
		if msg.message == wmHotkey {
			hotkeyMu.Lock()
			action := hotkeyActions[int(msg.wParam)]
			hotkeyMu.Unlock()
			if action != nil {
				go action()
			}
		}
		procTransMsg.Call(uintptr(unsafe.Pointer(&msg)))
		procDispatch.Call(uintptr(unsafe.Pointer(&msg)))
	}
}

// drainHotkeyRequests runs everything queued for the pump thread.
func drainHotkeyRequests() {
	for {
		hotkeyMu.Lock()
		ch := hotkeyRequests
		hotkeyMu.Unlock()
		select {
		case fn := <-ch:
			fn()
		default:
			return
		}
	}
}

// parseHotkey reads "Ctrl+Alt+D" into Win32 modifiers and a virtual-key
// code.
func parseHotkey(chord string) (mods int, vk int, ok bool) {
	parts := splitChord(chord)
	if len(parts) == 0 {
		return 0, 0, false
	}
	for _, part := range parts {
		switch part {
		case "CTRL", "CONTROL":
			mods |= modControl
			continue
		case "ALT":
			mods |= modAlt
			continue
		case "SHIFT":
			mods |= modShift
			continue
		case "WIN", "WINDOWS":
			mods |= modWin
			continue
		}
		if len(part) == 1 {
			c := part[0]
			if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
				vk = int(c)
				continue
			}
		}
		if len(part) >= 2 && len(part) <= 3 && part[0] == 'F' {
			if n, err := parseSmallInt(part[1:]); err == nil && n >= 1 && n <= 24 {
				vk = 0x6F + n // VK_F1 = 0x70
				continue
			}
		}
		return 0, 0, false
	}
	if vk == 0 {
		return 0, 0, false
	}
	// A global hotkey with no modifier would swallow that key everywhere:
	// RegisterHotKey("R") eats every R the user types into any application.
	// The macOS launcher's recorder always includes a modifier for the same
	// reason. Reject it here so the settings page reports the format error
	// instead of installing a chord that breaks typing system-wide.
	if mods == 0 {
		return 0, 0, false
	}
	return mods, vk, true
}

// splitChord uppercases and trims the parts of a chord, dropping empties.
func splitChord(chord string) []string {
	var out []string
	current := ""
	flush := func() {
		trimmed := trimSpaceASCII(current)
		if trimmed != "" {
			out = append(out, upperASCII(trimmed))
		}
		current = ""
	}
	for _, r := range chord {
		if r == '+' {
			flush()
			continue
		}
		current += string(r)
	}
	flush()
	return out
}

func trimSpaceASCII(s string) string {
	start, end := 0, len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t') {
		end--
	}
	return s[start:end]
}

func upperASCII(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 'a' - 'A'
		}
	}
	return string(b)
}

func parseSmallInt(s string) (int, error) {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("not a number")
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}
