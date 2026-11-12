package app

// panel.go is the launcher panel: everything the macOS status-item menu
// carried, rebuilt as one HTML window with tabs (会话 / 更新 / 设置).
//
// Why a window and not a native menu: a Win32 menu cannot draw unread
// pills, update badges, per-row hover state, or tab strips. A frameless
// always-on-top WebView window is what actually renders all of that on
// Windows.
//
// Data path (no bindings, no push races): the page is served from the
// asset server with the model JSON baked in at request time, and actions
// travel back as POST /dhl-action. See pages.go and panelpage.go.

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

const (
	// 330 DIPs fits the tab strip, an update row with its version pill, and
	// a session row of the form "14:02 ·「工作区」 已完成" without ellipsis.
	panelWidth = 330
	// The tab contents vary in length, so the window keeps one height and
	// the body scrolls inside it. Growing the window per tab (magpie's
	// fit-glide) reads nicer but adds a resize failure mode this panel does
	// not need; a fixed window also never jumps when a background poll
	// refreshes an open panel.
	panelHeightWanted = 460

	// sessionRowsInModel is how many records the model carries: enough
	// history to feel like a list, few enough to keep the payload small.
	sessionRowsInModel = 100
)

// panelHost keeps the panel window.
type panelHost struct {
	mu      sync.Mutex
	win     *application.WebviewWindow
	visible bool
	ctl     *controller
}

var panel = &panelHost{}

// lastPanelShowAt is when Show last put the panel on screen. The
// click-outside dismissal needs it: a frameless tool window over the
// taskbar often cannot take focus right away, and WindowLostFocus then
// fires the instant the window appears — which hid the panel the moment
// it showed (the reported "click does nothing"). Events within the grace
// window are that artefact; a focus loss after it is the user clicking
// somewhere else.
var lastPanelShowAt atomic.Int64

const panelFocusGrace = 1200 * time.Millisecond

// panelDismissedOutside closes the panel when the user clicks anywhere
// else — the Windows flyout convention, and the way the macOS menu
// closes too.
func panelDismissedOutside() {
	shown := time.Unix(0, lastPanelShowAt.Load())
	if time.Since(shown) < panelFocusGrace {
		applog.Logf("panel: ignoring focus loss inside the grace window")
		return
	}
	panel.Hide()
}

// sessionRow is one row the 会话 tab draws.
type sessionRow struct {
	SessionID string
	Label     string // workspace name, else title, else short id
	Reason    string // the turn-end reason kind
	AtMillis  float64
	Unread    bool
}

// updateRow is one update channel's state for the 更新 tab.
type updateRow struct {
	Current string // the installed version; "" when not known yet
	Pending string // the version waiting to be installed; "" when none
	Label   string // the pending version's channel label (候选版 etc.)
}

// settingsModel carries the live settings the panel's 设置/更新 tabs
// edit directly. Every field is wired to a POST /dhl-action action.
type settingsModel struct {
	Theme                  string  // "system" (""), "light", "dark"
	Freq                   float64 // update check interval, hours
	AutoUpdate             bool    // download and install launcher updates unattended
	Mirror                 bool    // installs prefer registry.npmmirror.com
	AutoCheckUpdates       bool    // the periodic launcher/dsh checks run
	AutoCheckPluginUpdates bool
	OpenOnReady            bool // show the main window when dsh is ready
	SidebarDeck            bool // experimental takeover sidebar, default off
	LaunchAtLogin          bool
}

// panelModel is everything the panel renders.
type panelModel struct {
	Status    string // e.g. "运行中 · 端口 3080（已接管）"
	Running   bool
	Version   string // the launcher's own version
	Sessions  []sessionRow
	UnreadAll int
	Launcher  updateRow
	DSH       updateRow
	Plugins   int // installed plugins with updates available
	Settings  settingsModel
}

// buildPanelModel snapshots the launcher's state for the page.
func (c *controller) buildPanelModel() panelModel {
	c.ensureDSHVersion()

	c.mu.Lock()
	state := c.state
	port := c.port
	reused := c.reused
	dshPending := c.pendingDSHUpdate
	launcherPending := c.pendingLauncherUpdate
	version := c.version
	autoOpen := c.openBrowserOnReady
	sidebarDeck := c.sidebarDeck
	interval := c.updateIntervalHours
	dshCurrent := c.dshVersion
	plugins := c.pluginUpdates
	theme := c.theme
	autoUpdate := c.autoUpdate
	autoCheckUpdates := c.autoCheckUpdates
	autoCheckPluginUpdates := c.autoCheckPluginUpdates
	registry := c.npmRegistry
	c.mu.Unlock()
	launchAtLogin := launchAtLoginEnabled()

	model := panelModel{Running: state == stateRunning, Version: version}
	switch state {
	case stateRunning:
		model.Status = fmt.Sprintf("运行中 · 端口 %d", port)
		if reused {
			model.Status += "（已接管）"
		}
	case stateChecking:
		model.Status = "正在启动…"
	default:
		model.Status = "未运行"
	}

	// The 会话 tab lists history, not just the reminders: a row the user
	// has already read stays visible (dimmed) and clickable, so the tab is
	// a record of what finished — the unread count lives in the badge.
	events := sessionStore.Rows(sessionRowsInModel)
	index := sessionWorkspaceIndex()
	model.Sessions = make([]sessionRow, 0, len(events))
	for _, row := range events {
		model.Sessions = append(model.Sessions, sessionRow{
			SessionID: row.SessionID,
			Label:     session.MenuLabel(index[row.SessionID], row.Title, row.SessionID),
			Reason:    row.Reason,
			AtMillis:  row.At,
			Unread:    row.Unread,
		})
	}
	model.UnreadAll = sessionStore.UnreadCount()

	model.Launcher = updateRow{Current: version}
	if launcherPending != nil {
		model.Launcher.Pending = launcherPending.Version
	}
	model.DSH = updateRow{Current: dshCurrent}
	if dshPending != nil {
		model.DSH.Pending = dshPending.Version
		model.DSH.Label = dshPending.LabelFor()
	}
	model.Plugins = plugins.Available

	themeOut := theme
	if themeOut == "" {
		themeOut = "system"
	}
	mirror := registry == "" || strings.Contains(registry, "npmmirror")
	model.Settings = settingsModel{
		Theme:                  themeOut,
		Freq:                   interval,
		AutoUpdate:             autoUpdate,
		Mirror:                 mirror,
		AutoCheckUpdates:       autoCheckUpdates,
		AutoCheckPluginUpdates: autoCheckPluginUpdates,
		OpenOnReady:            autoOpen,
		SidebarDeck:            sidebarDeck,
		LaunchAtLogin:          launchAtLogin,
	}
	return model
}

// openPanel shows the launcher panel, or closes it if already open. It is
// the single entry behind the tray clicks and --panel. The taskbar-click
// hook excludes the panel's own activation by window handle (panelHWND),
// so no time-based suppression is needed here.
func (h *Host) openPanel() {
	applog.Logf("panel click -> openPanel")
	panel.ctl = h.ectx
	// Wails' Show() marshals itself (InvokeSync(w.impl.show)), so the call
	// must NOT be wrapped in another InvokeSync — nesting it deadlocks the
	// GUI thread and the window stays hidden. Only the window *creation*
	// needs the GUI thread, and ensure() handles that.
	go panel.toggle(h.app)
}

// toggle opens or closes the panel.
func (p *panelHost) toggle(app *application.App) {
	p.mu.Lock()
	visible := p.visible
	hasWin := p.win != nil
	p.mu.Unlock()
	applog.Logf("panel toggle: visible=%v hasWindow=%v", visible, hasWin)
	if visible {
		p.Hide()
		return
	}
	p.Show(app)
}

// Show renders the current state and displays the panel.
func (p *panelHost) Show(app *application.App) {
	w := p.ensure(app)
	model := p.ctl.buildPanelModel()
	height := panelHeight()

	lastPanelHeight = height
	w.SetSize(panelWidth, height)
	// Reload so the asset handler rebuilds the page with current state
	// baked in. This is the whole data path: no binding, no push, no race.
	w.SetURL("/dhl-panel")
	p.position(w, app)
	lastPanelShowAt.Store(time.Now().UnixNano())
	w.Show()
	w.Focus()
	// A maximised Harness window otherwise covers the panel: Wails'
	// AlwaysOnTop does not always survive that on beta.24.
	raiseTopmost(windowHWND(w))

	p.mu.Lock()
	p.visible = true
	p.mu.Unlock()
	applog.Logf("panel shown: %d sessions, %d unread", len(model.Sessions), model.UnreadAll)
}

// windowHWND is a Wails window's native handle, 0 when unavailable.
func windowHWND(w *application.WebviewWindow) uintptr {
	if w == nil {
		return 0
	}
	nw := w.NativeWindow()
	if nw == nil {
		return 0
	}
	return uintptr(nw)
}

// Hide dismisses the panel.
func (p *panelHost) Hide() {
	p.mu.Lock()
	w := p.win
	p.mu.Unlock()
	if w == nil {
		return
	}
	w.Hide()
	p.mu.Lock()
	p.visible = false
	p.mu.Unlock()
}

// ensure creates the panel window on first use.
func (p *panelHost) ensure(app *application.App) *application.WebviewWindow {
	p.mu.Lock()
	if p.win != nil {
		w := p.win
		p.mu.Unlock()
		return w
	}
	p.mu.Unlock()

	// Creating a WebView2 window off the GUI thread yields a window that
	// never shows — Wails does not hop threads for window creation. So the
	// creation is marshalled and the result handed back. Note that Show()
	// marshals itself, so it must NOT be called from inside this block.
	var created *application.WebviewWindow
	application.InvokeSync(func() {
		p.mu.Lock()
		defer p.mu.Unlock()
		if p.win != nil {
			created = p.win
			return
		}
		w := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:        "dhl-panel",
			Title:       "Deepseek Harness Launcher",
			Width:       panelWidth,
			Height:      panelHeight(),
			Frameless:   true,
			AlwaysOnTop: true,
			// Translucent renders nothing on Windows 10: the layered-window
			// path Wails uses cannot host WebView2 content, so the window is
			// created and positioned but stays blank. A solid background with
			// the glass look drawn inside the page is what actually shows.
			BackgroundType:  application.BackgroundTypeSolid,
			DisableResize:   true,
			InitialPosition: application.WindowXY,
			Windows: application.WindowsWindow{
				HiddenOnTaskbar: true,
			},
			// The HTML option is only honoured on darwin/linux in Wails
			// beta.24, and SetHTML on Windows merely rewrites
			// document.documentElement.innerHTML — which does nothing when
			// there is no document yet. Loading a real URL through the
			// asset server is what actually renders on Windows.
			URL: "/dhl-panel",
		})
		// Dismissal: Escape, clicking a row, clicking anywhere outside
		// (the WindowLostFocus handler below), or toggling the panel
		// again. The focus-loss path carries its own grace window —
		// registering the handler is what got the click-outside
		// behaviour back without the "panel vanishes as it appears" bug.
		w.OnWindowEvent(events.Common.WindowLostFocus, func(*application.WindowEvent) {
			panelDismissedOutside()
		})
		p.win = w
		created = w
	})
	return created
}

// position places the panel above what the user just clicked. A taskbar
// click leaves its cursor position behind, so the panel drops onto that
// button; stale or missing anchors fall back to the tray corner of the
// work area, where the tray icon lives.
//
// Coordinates here are DIPs, not physical pixels: Wails' SetPosition works
// in the same space as the window size, and on a scaled display (150% is
// common) a physical-pixel calculation lands off-screen entirely. The
// screen's WorkArea already excludes the taskbar and is expressed in that
// space, so it is the right input.
func (p *panelHost) position(w *application.WebviewWindow, app *application.App) {
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

	x, y := trayCorner(work)
	// clamp into the work area (multi-monitor / moved taskbar)
	x = clamp(x, work.X, work.X+work.Width-panelWidth)
	y = clamp(y, work.Y, work.Y+work.Height-lastPanelHeight)
	w.SetPosition(x, y)
	applog.Logf("panel positioned at (%d,%d) size %dx%d, work area (%d,%d) %dx%d",
		x, y, panelWidth, lastPanelHeight, work.X, work.Y, work.Width, work.Height)
}

// trayCorner is where the panel sits when there is no better anchor: the
// tray is at the far right of the taskbar, so the panel hugs the same
// corner. A 4 DIP gap keeps it visually attached to the icon.
func trayCorner(work application.Rect) (int, int) {
	return work.X + work.Width - panelWidth - 4, work.Y + work.Height - lastPanelHeight - 4
}

// clamp keeps v inside [lo, hi] (hi is inclusive-minus-size callers pass).
func clamp(v, lo, hi int) int {
	if hi < lo {
		hi = lo
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// lastPanelHeight is the height Show last asked for; kept out of the
// struct so position() stays free of locking.
var lastPanelHeight = panelHeight()

// panelHeight is fixed: the tab content scrolls inside the window, so the
// height does not chase the model. It is clamped to the space above the
// taskbar so the bottom edge never hides behind it.
func panelHeight() int {
	return panelHeightWanted
}

// panelModelMap is the model in the shape Wails serialises for a bound
// method call. The page fetches this on load as a fallback to the baked
// HTML, which cannot race the document the way a pushed ExecJS can.
func panelModelMap(model panelModel) map[string]any {
	rows := make([]map[string]any, 0, len(model.Sessions))
	for _, r := range model.Sessions {
		rows = append(rows, map[string]any{
			"id": r.SessionID, "label": r.Label, "reason": r.Reason,
			"at": r.AtMillis, "unread": r.Unread,
		})
	}
	return map[string]any{
		"status": model.Status, "running": model.Running, "version": model.Version,
		"sessions": rows, "unreadAll": model.UnreadAll,
		"launcher": map[string]any{
			"current": model.Launcher.Current, "pending": model.Launcher.Pending,
			"label": model.Launcher.Label,
		},
		"dsh": map[string]any{
			"current": model.DSH.Current, "pending": model.DSH.Pending,
			"label": model.DSH.Label,
		},
		"plugins": model.Plugins,
		"settings": map[string]any{
			"theme": model.Settings.Theme, "freq": model.Settings.Freq,
			"autoUpdate": model.Settings.AutoUpdate, "mirror": model.Settings.Mirror,
			"autoCheckUpdates":       model.Settings.AutoCheckUpdates,
			"autoCheckPluginUpdates": model.Settings.AutoCheckPluginUpdates,
			"openOnReady":            model.Settings.OpenOnReady,
			"sidebarDeck":            model.Settings.SidebarDeck,
			"launchAtLogin":          model.Settings.LaunchAtLogin,
		},
	}
}

// panelPayload renders the model as the JSON the page consumes.
func panelPayload(model panelModel) string {
	rows := make([]string, 0, len(model.Sessions))
	for _, r := range model.Sessions {
		rows = append(rows, fmt.Sprintf(
			`{"id":%q,"label":%q,"reason":%q,"at":%v,"unread":%v}`,
			r.SessionID, r.Label, r.Reason, r.AtMillis, r.Unread))
	}
	return fmt.Sprintf(
		`{"status":%q,"running":%v,"version":%q,`+
			`"sessions":[%s],"unreadAll":%d,`+
			`"launcher":{"current":%q,"pending":%q,"label":%q},`+
			`"dsh":{"current":%q,"pending":%q,"label":%q},`+
			`"plugins":%d,`+
			`"settings":{"theme":%q,"freq":%v,"autoUpdate":%v,"mirror":%v,`+
			`"autoCheckUpdates":%v,"autoCheckPluginUpdates":%v,`+
			`"openOnReady":%v,"sidebarDeck":%v,"launchAtLogin":%v}}`,
		model.Status, model.Running, model.Version,
		joinStrings(rows, ","), model.UnreadAll,
		model.Launcher.Current, model.Launcher.Pending, model.Launcher.Label,
		model.DSH.Current, model.DSH.Pending, model.DSH.Label,
		model.Plugins,
		model.Settings.Theme, model.Settings.Freq, model.Settings.AutoUpdate,
		model.Settings.Mirror, model.Settings.AutoCheckUpdates,
		model.Settings.AutoCheckPluginUpdates, model.Settings.OpenOnReady,
		model.Settings.SidebarDeck, model.Settings.LaunchAtLogin)
}

func joinStrings(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}
