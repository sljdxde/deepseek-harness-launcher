package app

// updatedialog.go owns the launcher's update dialog window: creation,
// placement, and turning the page's answer into an action.
//
// The page (updatedialogpage.go) is served from the asset handler at
// /dhl-update because the WebviewWindow HTML option is ignored on Windows
// and window.go bindings are absent from asset-served pages. The model is
// baked in at request time and the page answers with a POST /dhl-action,
// exactly like the tray panel.
//
// Replaces the Win32 MessageBoxW the flow used before, which could not
// draw Markdown and truncated the body at 900 runes.

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshupdate"
)

// updateDialogURL is the page the dialog window loads.
const updateDialogURL = "/dhl-update"

// updateDialogHost keeps the dialog's window and the answer it is waiting
// for. A dialog is shown one at a time; showing another replaces it.
type updateDialogHost struct {
	mu      sync.Mutex
	win     *application.WebviewWindow
	model   updateDialogModel
	release *launcherRelease // set for kind "launcher"
	version string           // set for kind "dsh"
	ctl     *controller
}

var updateDialog = &updateDialogHost{}

// pageModel returns the model the /dhl-update handler bakes in. The model
// is the authority, not the window handle: a reload racing a close must
// still render the prompt instead of the "already handled" page.
func (d *updateDialogHost) pageModel() (updateDialogModel, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.model.Kind == "" {
		return updateDialogModel{}, false
	}
	return d.model, true
}

// showLauncherUpdateDialog presents a launcher release. It is the
// counterpart of presentUpdate(manifest:) on macOS.
func (c *controller) showLauncherUpdateDialog(release *launcherRelease) {
	if release == nil {
		return
	}
	c.mu.Lock()
	skipped := c.skippedLauncherVersion != "" && c.skippedLauncherVersion == release.Version
	c.mu.Unlock()
	model := launcherUpdateDialogModel(release, c.version, c.currentTheme(), skipped)
	updateDialog.show(c, model, release, "")
}

// showDSHUpdateDialog presents a dsh candidate with its Markdown notes.
func (c *controller) showDSHUpdateDialog(candidate *dshupdate.Candidate, current string) {
	if candidate == nil {
		return
	}
	c.mu.Lock()
	skipped := c.skippedDSHVersion != "" && c.skippedDSHVersion == candidate.Version
	c.mu.Unlock()
	model := dshUpdateDialogModel(candidate.Version, candidate.LabelFor(), candidate.Notes,
		current, c.currentTheme(), skipped)
	updateDialog.show(c, model, nil, candidate.Version)
}

// currentTheme is the panel's 外观 setting: "system", "light" or "dark".
func (c *controller) currentTheme() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.theme == "" {
		return "system"
	}
	return c.theme
}

// show bakes the model into the page and opens the window.
func (d *updateDialogHost) show(c *controller, model updateDialogModel, release *launcherRelease, version string) {
	if c == nil || c.app == nil {
		return
	}
	d.mu.Lock()
	d.model = model
	d.release = release
	d.version = version
	d.ctl = c
	d.mu.Unlock()

	w := d.ensure(c.app)
	if w == nil {
		applog.Logf("update dialog: window unavailable")
		return
	}
	// Reload so the handler rebuilds the page with this model baked in.
	// This is the whole data path: no binding, no push, no race.
	w.SetURL(updateDialogURL)
	w.SetTitle(model.Title)
	d.place(c.app, w)
	w.Show()
	w.Focus()
	raiseTopmost(windowHWND(w))
	applog.Logf("update dialog: showing %s v%s (current v%s)", model.Kind, model.Target, model.Current)
}

// take consumes the pending answer — the model, what it points at, and the
// window showing it — and closes that window. Taking and closing happen
// under one lock so a prompt opened concurrently cannot be closed by a
// stale answer.
func (d *updateDialogHost) take() (ctl *controller, model updateDialogModel, release *launcherRelease, version string) {
	d.mu.Lock()
	ctl, model, release, version = d.ctl, d.model, d.release, d.version
	win := d.win
	d.model = updateDialogModel{}
	d.release = nil
	d.version = ""
	d.win = nil
	d.ctl = nil
	d.mu.Unlock()
	if win != nil {
		win.Close()
	}
	return ctl, model, release, version
}

// ensure creates the dialog window on first use. Creation is marshalled
// (an off-thread WebView2 window never shows); Show/SetURL must not be
// wrapped — they marshal themselves and nesting them deadlocks.
func (d *updateDialogHost) ensure(app *application.App) *application.WebviewWindow {
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
			Name:      "dhl-update-dialog",
			Title:     "更新",
			Width:     620,
			Height:    660,
			Frameless: true,
			// An update prompt must not hide behind the Harness window.
			AlwaysOnTop:    true,
			BackgroundType: application.BackgroundTypeSolid,
			DisableResize:  true,
			// The dialog is transient and draws its own header; staying off the
			// taskbar keeps 稍后/下载 from adding a button that outlives the
			// prompt.
			Windows: application.WindowsWindow{HiddenOnTaskbar: true},
			URL:     updateDialogURL,
		})
		// Closing from the page (or programmatically) destroys the window;
		// drop the handle so the next prompt builds a fresh one.
		w.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
			d.forgetWindow(w)
		})
		d.win = w
		created = w
	})
	return created
}

// forgetWindow drops a window handle that is going away.
func (d *updateDialogHost) forgetWindow(w *application.WebviewWindow) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.win == w {
		d.win = nil
	}
	d.ctl = nil
}

// place centres the dialog in the work area, clamped so its own title bar
// and footer buttons always stay on screen.
func (d *updateDialogHost) place(app *application.App, w *application.WebviewWindow) {
	screens := app.Screen.GetAll()
	if len(screens) == 0 {
		w.Center()
		return
	}
	work := screens[0].WorkArea
	for _, s := range screens {
		if s.IsPrimary {
			work = s.WorkArea
			break
		}
	}
	width, height := updateDialogGeometry(work.Width, work.Height)
	x := work.X + (work.Width-width)/2
	y := work.Y + (work.Height-height)/2
	x = clamp(x, work.X, work.X+work.Width-width)
	y = clamp(y, work.Y, work.Y+work.Height-height)
	w.SetSize(width, height)
	w.SetPosition(x, y)
	applog.Logf("update dialog placed at (%d,%d) size %dx%d, work area (%d,%d) %dx%d",
		x, y, width, height, work.X, work.Y, work.Width, work.Height)
}

// handleUpdateDialogAction runs one answer from the dialog page. It is
// called from the HTTP handler, which has no window context of its own.
func handleUpdateDialogAction(action string) {
	ctl, model, release, version := updateDialog.take()
	if ctl == nil {
		applog.Logf("update dialog action %q with no controller", action)
		return
	}
	switch action {
	case "update-confirm":
		switch model.Kind {
		case "launcher":
			if release != nil {
				go ctl.installLauncherUpdate(release, false)
			}
		case "dsh":
			if version != "" {
				go ctl.updateDSHTo(version)
			}
		default:
			applog.Logf("update dialog: confirm for unknown kind %q", model.Kind)
		}
	case "update-later":
		applog.Logf("update dialog: %s v%s deferred", model.Kind, model.Target)
	case "update-skip":
		ctl.skipUpdateVersion(model.Kind, model.Target)
	case "update-unskip":
		ctl.unskipUpdateVersion(model.Kind)
	default:
		applog.Logf("update dialog: unknown action %q", action)
	}
}

// skipUpdateVersion records 跳过此版本 so the monitor stops announcing it.
func (c *controller) skipUpdateVersion(kind, version string) {
	if version == "" {
		return
	}
	c.mu.Lock()
	switch kind {
	case "launcher":
		c.skippedLauncherVersion = version
		if c.pendingLauncherUpdate != nil && c.pendingLauncherUpdate.Version == version {
			c.pendingLauncherUpdate = nil
		}
	case "dsh":
		c.skippedDSHVersion = version
		if c.pendingDSHUpdate != nil && c.pendingDSHUpdate.Version == version {
			c.pendingDSHUpdate = nil
		}
	}
	c.mu.Unlock()
	saveSettings()
	c.refreshBadgeAndMenu()
	application.InvokeSync(refreshOpenPanel)
	applog.Logf("update skipped: %s v%s", kind, version)
}

// unskipUpdateVersion clears 跳过此版本 (the dialog's third button toggles).
func (c *controller) unskipUpdateVersion(kind string) {
	c.mu.Lock()
	switch kind {
	case "launcher":
		c.skippedLauncherVersion = ""
		c.lastAutoVersion = ""
	case "dsh":
		c.skippedDSHVersion = ""
	}
	c.mu.Unlock()
	saveSettings()
	c.refreshBadgeAndMenu()
	application.InvokeSync(refreshOpenPanel)
	applog.Logf("update skip cleared: %s", kind)
}
