// Package app assembles the launcher's shell: a tray icon with the same
// menu the macOS NSStatusItem offers, one instance at a time. The dsh
// lifecycle behind the menu lives in the launch and dshrt packages; this
// file keeps to the tray, the menu, and the log.
package app

import (
	_ "embed"
	"sync"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/selfinstall"
)

// trayICO is the tray's tile, at the sizes the tray asks for. The Mac's
// menu bar tints a black template itself; Windows draws what it is given,
// so the tray carries the app icon in full color, as tray neighbours do.
//
//go:embed tray.ico
var trayICO []byte

// h is the one shell, reachable from the menu actions and the monitors
// (Wails menus and tray events carry no user data through to their
// closures).
var h *Host

// Host holds the shell pieces the menus reach back into: the app, the
// tray, and the menu rows that change as dsh comes and goes.
type Host struct {
	app     *application.App
	tray    *application.SystemTray
	version string
	ectx    *controller
}

// Run builds the shell and blocks on the app's event loop. Version is
// the build's Resources/Info.plist version, injected by build.ps1.
func Run(version string) error {
	if err := applog.Init(); err != nil {
		// a launcher that cannot log still runs; every Logf after this
		// says nothing
		applog.Close()
	}

	// The exe is its own installer: a run from a download-ish folder
	// installs (or forwards to) %LOCALAPPDATA%\Programs\DHL and exits.
	// That hand-off must happen before anything builds — the process is
	// about to be replaced, so no tray icon may flash into existence.
	if selfinstall.Settle(version) {
		applog.Close()
		return nil
	}

	h = &Host{version: version}
	h.ectx = newController(nil)
	h.ectx.version = version

	h.app = application.New(application.Options{
		// Name is the toast AppID on Windows, not a display string: Wails
		// hands cfg.Name to wintoast.SetAppData, which registers
		// HKCU\Software\Classes\AppUserModelId\<Name>. Using the friendly
		// title there created a SECOND app identity beside the process's
		// real AUMID — Start-menu search then listed "Deepseek Harness
		// Launcher" twice, and the auto-generated entry carried Windows'
		// own unread badge (the "5" that survived every icon-cache
		// rebuild). Every window sets its own Title, so nothing here is a
		// display string.
		Name:        appUserModelID,
		Description: "Deepseek Harness 的菜单栏启动器",
		// the panel and the flyout are served as real pages: on Windows the
		// HTML window option is ignored and SetHTML only rewrites an
		// existing document, so a URL is the only thing that renders
		Assets: application.AssetOptions{Handler: pageHandler()},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.local.dhl-launcher.windows",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				// A second launch means the user clicked a pinned taskbar
				// button, a shortcut, or ran DHL.exe with an action flag.
				// The arguments decide what to open; with none, the page.
				SetStartupAction(data.Args)
				// a second launch with no flag is a taskbar-button click
				runStartupAction(defaultSecondInstanceAction)
			},
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
			// No forced device scale factor: 0.85 on a 150% display gives
			// 1.275 physical px per CSS px, and every glyph lands on a
			// fractional pixel — the text renders visibly blurry. WebView2's
			// default (follow the monitor DPI) rasterises at whole pixels.
			// Sizing is handled in the pages themselves instead.
		},
		ErrorHandler: func(err error) { applog.Logf("wails: %v", err) },
	})

	h.tray = h.app.SystemTray.New()
	h.tray.SetTooltip("Deepseek Harness Launcher")
	initTrayBase(trayICO)
	h.tray.SetIcon(trayICO)
	h.ectx.app = h.app
	// The tray icon is the launcher's dashboard: both clicks open the
	// panel (the macOS menu content — sessions, updates, settings —
	// rebuilt as one tabbed window). The taskbar button belongs to the
	// main Harness window and is handled entirely by Windows: click to
	// restore, click again to minimise. The two surfaces are independent.
	h.tray.OnClick(func() { h.openPanel() })
	h.tray.OnRightClick(func() { h.openPanel() })

	// the process identity must be set BEFORE the toast backend is created:
	// Windows builds its toast notifier from it, and an empty ID makes
	// CreateToastNotifier fail with 参数错误
	setAppUserModelID()

	// the shortcuts carry the same AppUserModelID, so a button pinned from
	// one of them opens this app; the desktop copy is written when the
	// setting asks for it
	ensureShortcuts(loadSettings().DesktopShortcut)
	// a freshly installed binary gets one Explorer icon-cache rebuild, so
	// Start-menu search stops showing the previous build's art
	flushIconCache()

	// the notifier must be registered before Run: Wails refuses services
	// added once the loop is going
	h.ectx.registerNotifier()

	// the startup flow waits for the event loop: InvokeSync panics
	// before Run has the main-thread dispatcher up
	var startOnce sync.Once
	// Windows emits its own ApplicationStarted (1206), not the Common one
	// (1025) — listening to Common here never fires on this platform.
	h.app.Event.OnApplicationEvent(events.Windows.ApplicationStarted, func(*application.ApplicationEvent) {
		startOnce.Do(func() {
			// Wails registers the toast identity from the app Name (which
			// is the AUMID, see Options.Name) and uses that same string as
			// the toast's DisplayName. Give the registration the friendly
			// title instead: the AUMID stays correct, the toast and the
			// notification settings page read "Deepseek Harness Launcher".
			fixToastDisplayName()
			// The main window IS the taskbar button. It starts visible
			// (showing a loading placeholder) and is minimised right away,
			// which keeps the button while leaving the desktop quiet. From
			// here on Windows itself handles every taskbar click: an
			// inactive button restores the window, an active one minimises
			// it. No foreground hooks, no click detection, no debounce.
			// ensure/Show/Minimise each marshal themselves; wrapping them
			// in another InvokeSync would deadlock the GUI thread.
			go func() {
				dshWin.ensure(h.app)
				if w := dshWin.win; w != nil {
					w.UnMaximise()
					w.Show()
					// Minimise only if no 打开 click arrived in the
					// meantime: a click in the first moments of a launch
					// (the taskbar button is already there) asks for the
					// window, and minimising it right after would swallow
					// that click — the "sometimes the click does nothing"
					// half of the report. The flag is put back so the ready
					// path still shows the page once dsh is up.
					if h.ectx.consumeOpenWhenReady() {
						h.ectx.requeueOpenWhenReady()
					} else {
						w.Minimise()
					}
				}
				if hwnd := dshWin.HWND(); hwnd != 0 {
					initTaskbarBadge(syscall.Handle(hwnd))
					// The first badge refresh often runs before this bind;
					// forget that paint and repaint now that the button has
					// somewhere to draw.
					taskbarBadgeReset()
					h.ectx.refreshBadgeAndMenu()
				}
			}()
			// the notifier, the persisted unread rows and the periodic
			// checks all need the event loop up (InvokeSync panics
			// before Run has the main-thread dispatcher)
			h.ectx.startControlServer()
			h.ectx.startUpdateSchedule()
			go h.ectx.Start()
			// a first launch only acts on an explicit flag: a plain start
			// must not open anything by itself
			runStartupAction("")
		})
	})

	applog.Logf("launcher started (version %s)", version)
	return h.app.Run()
}

// openLog shows the log file selected in Explorer, the counterpart of the
// Mac's activateFileViewerSelecting.
func (h *Host) openLog() {
	cmd := proc.Command("explorer.exe", "/select,"+applog.Path())
	if err := cmd.Start(); err != nil {
		applog.Logf("open log: %v", err)
	}
	_ = cmd.Wait()
}
