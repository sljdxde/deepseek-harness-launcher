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

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

const (
	dshWindowName  = "dsh-main"
	dshWindowTitle = "DeepSeek Harness"
)

// dshHost keeps the main window.
type dshHost struct {
	mu      sync.Mutex
	win     *application.WebviewWindow
	lastURL string
}

var dshWin = &dshHost{}

// ensureDshWindow creates the window once. It starts hidden; the caller
// shows it once dsh is up and the token URL is known.
func (d *dshHost) ensure(app *application.App) *application.WebviewWindow {
	d.mu.Lock()
	if d.win != nil {
		w := d.win
		d.mu.Unlock()
		return w
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
		// Closing is hiding: the launcher lives in the tray, and quitting
		// the window must not quit dsh.
		w.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
			e.Cancel()
			w.Hide()
			applog.Logf("dsh window: close -> hide")
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
// empty URL just shows whatever is already loaded.
func (d *dshHost) Show(app *application.App, url string) {
	w := d.ensure(app)
	if w == nil {
		return
	}
	if url != "" {
		d.SetURL(app, url)
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
// of the macOS launcher's ⌘R「刷新 Harness 页面」. ForceReload bypasses the
// webview cache, so the reload always picks up the current server state.
func (d *dshHost) Reload(app *application.App) {
	w := d.ensure(app)
	if w == nil {
		return
	}
	w.ForceReload()
	applog.Logf("dsh window: page reloaded")
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
