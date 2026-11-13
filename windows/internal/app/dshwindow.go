package app

// dshwindow.go is the launcher's MAIN window: a real, taskbar-pinnable
// WebView window that shows the Harness web UI. This is the Windows
// counterpart of "open Harness" — instead of handing a URL to the
// system browser and then trying to detect that browser's window, the
// page lives in our own window, and Windows itself handles the taskbar
// button: click activates/restores the window, clicking an active
// button minimises it. No foreground hooks, no debounce, no guessing.
//
// The dsh page is served by dsh itself (http://127.0.0.1:PORT/?token=…),
// with the bundled plugins injected through the patch file — so what is
// rendered here is the SAME page the browser showed, not a second UI.

import (
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/harnessweb"
)

const (
	dshWindowName = "dsh-main"
	// Brand casing matches the macOS launcher's HarnessWindowSupport
	// windowTitle ("Deepseek Harness") — the window title is the shared
	// brand surface across platforms.
	dshWindowTitle = "Deepseek Harness"
)

// dshHost keeps the main window.
type dshHost struct {
	mu      sync.Mutex
	win     *application.WebviewWindow
	lastURL string
	// lastReload debounces the reload chord: holding Ctrl+R makes Windows
	// repeat WM_HOTKEY every few tens of milliseconds, and eleven
	// navigations in three seconds leaves the page thrashing.
	lastReload time.Time
}

// reloadDebounce is the minimum gap between two page reloads.
const reloadDebounce = 700 * time.Millisecond

var dshWin = &dshHost{}

// procIsWindow answers "does this HWND still exist", which is the only
// reliable way to tell a hidden window from a destroyed one here.
var procIsWindow = user32.NewProc("IsWindow")

// windowAlive reports whether the WebviewWindow still has a live native
// window. Wails offers no public IsDestroyed, and its IsVisible() returns
// false for both "hidden" and "destroyed" — which is exactly the
// distinction that matters here, so the HWND is checked directly.
func windowAlive(w *application.WebviewWindow) bool {
	hwnd := windowHWND(w)
	if hwnd == 0 {
		return false
	}
	ok, _, _ := procIsWindow.Call(hwnd)
	return ok != 0
}

// forgetWindow drops the handle and the loaded-page record when w is the
// window the host currently holds.
//
// Whether the platform window is really gone depends on Wails' own
// WindowClosing handler, which closes it regardless of e.Cancel(); the
// close has not necessarily completed by the time this runs. So the
// decision is made on the handle, not on the event: a window that still
// exists is KEPT (the next open reuses it), and only a dead one is
// forgotten. Clearing unconditionally leaked a live orphan window per
// close — three close/open cycles left three Harness windows behind.
func (d *dshHost) forgetWindow(w *application.WebviewWindow) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.win != w {
		return // a newer window took over; leave it alone
	}
	if windowAlive(w) {
		// Still alive: Wails' close has not taken effect (or was
		// cancelled). Keep the handle so the next open reuses the window
		// instead of leaving this one orphaned on screen.
		return
	}
	applog.Logf("dsh window: closed; a new window is built on the next open")
	d.win = nil
	d.lastURL = ""
}

// ensureDshWindow creates the window once. It starts hidden; the caller
// shows it once dsh is up and the token URL is known.
//
// A window that is gone gets rebuilt. The close button really does destroy
// the window: Wails registers its own WindowClosing handler when the
// window is created, and that handler marks the window destroyed and calls
// the platform close regardless of e.Cancel(). Our handler (which cancels
// and hides) therefore cannot keep it alive, and the stale WebviewWindow
// left behind accepted every later Show() silently — the "after closing
// the Harness window, the taskbar icon never opens it again" report.
func (d *dshHost) ensure(app *application.App) *application.WebviewWindow {
	d.mu.Lock()
	if w := d.win; w != nil {
		if windowAlive(w) {
			d.mu.Unlock()
			return w
		}
		applog.Logf("dsh window: previous window was destroyed; recreating")
		d.win = nil
		d.lastURL = ""
	}
	d.mu.Unlock()

	var created *application.WebviewWindow
	application.InvokeSync(func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.win != nil {
			created = d.win
			return
		}
		w := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:   dshWindowName,
			Title:  dshWindowTitle,
			Width:  1440,
			Height: 900,
			// The macOS launcher refuses to shrink below 960×600
			// (minimumWindowSize): the Harness layout is a three-column
			// design that collapses below that.
			MinWidth:  960,
			MinHeight: 600,
			// A normal framed window: it owns the taskbar button, can be
			// pinned, and Windows handles activate/restore/minimise for us.
			Frameless:       false,
			InitialPosition: application.WindowCentered,
			URL:             "/",
			// The native title-bar buttons must be explicitly enabled: with
			// Wails beta.24 a window created while the app has no visible
			// window can otherwise come up without them.
			MinimiseButtonState: application.ButtonEnabled,
			MaximiseButtonState: application.ButtonEnabled,
			CloseButtonState:    application.ButtonEnabled,
			DisableResize:       false,
			// Hidden would remove the taskbar button entirely; a window
			// that starts visible and is minimised right away keeps it.
			Hidden: false,
		})
		// Closing destroys this window: Wails installs its own
		// WindowClosing handler when the window is created, and that
		// handler marks the window destroyed and closes the platform
		// window regardless of e.Cancel(). Our handler therefore cannot
		// keep it alive — ensure() rebuilds it on the next open, which is
		// what makes the taskbar button work after a close.
		//
		// Forget the handle right here rather than waiting for ensure() to
		// notice: the two destruction timings observed on this shell (the
		// window is sometimes gone by the time the handler returns and
		// sometimes survives a moment longer) both leave d.win pointing at
		// something that must not be reused.
		w.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
			e.Cancel()
			d.forgetWindow(w)
			applog.Logf("dsh window: closed; a new window is built on the next open")
		})
		// Give the window the real native frame (caption + the three
		// buttons); Wails sometimes creates it without a visible one.
		ensureStandardFrame(windowHWND(w))
		d.win = w
		created = w
	})
	return created
}

// SetURL records (and loads) the Harness page URL without showing the
// window. The page lives in our own WebView, so it is warm and ready the
// moment the user restores the window from the taskbar.
func (d *dshHost) SetURL(app *application.App, url string) {
	w := d.ensure(app)
	if w == nil || url == "" {
		return
	}
	d.mu.Lock()
	same := url == d.lastURL
	if !same {
		w.SetURL(url)
		d.lastURL = url
	}
	d.mu.Unlock()
	if !same {
		applog.Logf("dsh window: URL set to %s", url)
	}
}

// Show reveals the main window. Pass a URL to also (re)load the page; an
// empty URL keeps whatever is already loaded — except on a freshly rebuilt
// window, which has no page yet and would come up blank.
func (d *dshHost) Show(app *application.App, url string) {
	w := d.ensure(app)
	if w == nil {
		return
	}
	if url != "" {
		d.SetURL(app, url)
	} else {
		// A rebuilt window has nothing loaded: ensure() cleared lastURL, so
		// the caller's "show what is already there" would present a blank
		// page. Fall back to the saved entry URL, which is the page the
		// user was on.
		d.mu.Lock()
		needsPage := d.lastURL == ""
		d.mu.Unlock()
		if needsPage {
			if saved := harnessweb.LoadLastURL(); saved != "" {
				d.SetURL(app, saved)
			}
		}
	}
	// Windows remembers a maximised state across runs; a maximised
	// Wails window can push its native title bar (and its minimise /
	// maximise / close buttons) out of view behind the page.
	w.UnMaximise()
	w.Show()
	ensureStandardFrame(windowHWND(w))
	w.Focus()
	applog.Logf("dsh window: shown")
}

// Reload refreshes the loaded page without touching dsh — the counterpart
// of the macOS launcher's ⌘R「刷新 Harness 页面」.
//
// Wails cannot do this on Windows: WebviewWindow.ForceReload() is a noop
// there, and Reload() goes through window.location.reload() via ExecJS,
// which does nothing on a dsh-served page (the same reason the launcher
// stopped injecting scripts into it). What does work is a real WebView2
// navigation, so reload re-navigates to the URL the window is already on —
// and re-navigates unconditionally, because SetURL's "same URL, skip"
// shortcut would swallow exactly this case.
func (d *dshHost) Reload(app *application.App) {
	w := d.ensure(app)
	if w == nil {
		return
	}
	url, ok := d.claimReload(time.Now())
	if !ok {
		return
	}
	w.SetURL(url)
	applog.Logf("dsh window: page reloaded (%s)", url)
}

// claimReload decides whether a reload should run now, and records it.
// It returns the URL to navigate to, and false when the request is either
// too early (a key-repeat while Ctrl+R is held) or there is no page yet.
// Split out from Reload so the debounce and the "nothing loaded" guard are
// testable without a real window.
func (d *dshHost) claimReload(now time.Time) (string, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.lastURL == "" {
		return "", false
	}
	if now.Sub(d.lastReload) < reloadDebounce {
		return "", false // a key-repeat, not a new request
	}
	d.lastReload = now
	return d.lastURL, true
}

// FailurePage points the EXISTING main window at the readable failure
// card (the macOS failureHTML design). A window that was never opened
// stays untouched: a dead dsh must not pop a window up on its own. The
// next successful prepareHarnessURL replaces the card with the live page.
func (d *dshHost) FailurePage(message, detail string) {
	d.mu.Lock()
	w := d.win
	if w == nil {
		d.mu.Unlock()
		return
	}
	url := harnessweb.FailureDataURL(message, detail)
	same := url == d.lastURL
	if !same {
		d.lastURL = url
	}
	d.mu.Unlock()
	if !same {
		w.SetURL(url)
		applog.Logf("dsh window: failure page shown (%s)", message)
	}
}

// Hide minimises the main window (the shell does this itself too).
func (d *dshHost) Hide() {
	d.mu.Lock()
	w := d.win
	d.mu.Unlock()
	if w != nil {
		w.Hide()
	}
}

// HWND is the main window's native handle, for the taskbar badge.
// NativeWindow touches the platform impl directly and panics if the
// window was destroyed, so it is guarded.
func (d *dshHost) HWND() (result uintptr) {
	defer func() {
		if recover() != nil {
			result = 0
		}
	}()
	d.mu.Lock()
	w := d.win
	d.mu.Unlock()
	if w == nil {
		return 0
	}
	nw := w.NativeWindow()
	if nw == nil {
		return 0
	}
	return uintptr(nw)
}
