package app

// actions.go holds the menu-driven actions and the small helpers the
// monitor and the menu share: opening the page, the two update flows,
// the settings file, and the unread menu section.

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt/progress"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshupdate"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/launch"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/nodeenv"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

// openIntent is what Open does for the current state, decided without
// touching a window so it can be tested.
type openIntent int

const (
	openNow      openIntent = iota // dsh is serving: show the page
	openQueued                     // dsh is starting: remember the request
	openStarting                   // nothing running: start, then show
)

// decideOpen reads the launcher state and says what a 打开 should do. It
// also records a deferred open when dsh is not serving yet: a click that
// arrives while dsh is booting used to be dropped here, and nothing on the
// ready path ever showed the window — the "taskbar click sometimes does
// nothing" report.
func (c *controller) decideOpen() openIntent {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state == stateRunning && c.port != 0 {
		return openNow
	}
	// dsh is not serving yet, so this click has to survive until it is.
	c.openWhenReady = true
	if c.starting {
		return openQueued
	}
	return openStarting
}

// Open is the 打开 Harness row and the hotkey action: start dsh if
// needed, then bring the page up. Running already means "just open the
// browser".
func (c *controller) Open() {
	switch c.decideOpen() {
	case openNow:
		c.mu.Lock()
		port, launcher := c.port, c.launcher
		c.mu.Unlock()
		c.openBrowser(port, launcher)
	case openQueued:
		// a start is already in flight; its ready path opens the page
		// (see prepareHarnessURLFor / the adopt path)
	default:
		c.Start()
	}
}

// consumeOpenWhenReady reports whether a click asked for the page while
// dsh was still starting, clearing the flag. The ready path calls it once
// so one click opens the window exactly once.
func (c *controller) consumeOpenWhenReady() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	want := c.openWhenReady
	c.openWhenReady = false
	return want
}

// requeueOpenWhenReady puts the request back after the startup minimise
// path looked at it: that path only inspects the flag to decide whether to
// minimise, and the page still has to be shown once dsh is ready.
func (c *controller) requeueOpenWhenReady() {
	c.mu.Lock()
	c.openWhenReady = true
	c.mu.Unlock()
}

// openDSHUpdate runs a dsh update check on demand and, when one exists,
// offers it. A manual click always shows the dialog even for a skipped
// version (the dialog can un-skip).
func (c *controller) openDSHUpdate() {
	applog.Logf("menu: check dsh update")
	if !dshrt.IsInstalled() {
		warn("Deepseek Harness 更新", "dsh 尚未安装，先在菜单里打开 Deepseek Harness 完成首次安装。")
		return
	}
	current := dshVersionOf(nodeEnvironment())
	report := dshupdate.Check(current, npmPathForCheck(), nodeenv.Environment(nodeEnvironment()))
	if len(report.Candidates) == 0 {
		warn("Deepseek Harness 更新", "没有取到任何已发布版本。\n"+strings.Join(report.Warnings, "\n"))
		return
	}
	choices := dshupdate.SelectableUpdates(report, 10)
	if len(choices) == 0 {
		warn("Deepseek Harness 更新", fmt.Sprintf("已是最新版本（v%s）。", report.Current))
		return
	}
	best := choices[0]
	// The notes are Markdown; the dialog renders them (the old native
	// MessageBox showed the raw "## …" text).
	bringToFront()
	c.showDSHUpdateDialog(&best, report.Current)
}

// updateDSHTo installs a specific dsh version, stopping dsh first and
// keeping the old runtime as a rollback snapshot.
func (c *controller) updateDSHTo(version string) {
	// stop the running instance: npm replaces the runtime it is using
	c.mu.Lock()
	launcher := c.launcher
	wasActive := c.state == stateRunning || c.state == stateChecking
	c.mu.Unlock()
	// state goes to checking unconditionally, and before Start is ever
	// reached again: the update is followed by a relaunch, and a launcher
	// still claiming stateRunning would make that relaunch a no-op. An
	// adopted instance has no launcher, so the Running() test alone missed
	// exactly that case.
	c.setState(stateChecking, "正在停止…")
	if launcher != nil && launcher.Running() {
		launcher.Stop()
		c.mu.Lock()
		c.launcher = nil
		c.mu.Unlock()
	}
	c.mu.Lock()
	c.port = 0
	c.mu.Unlock()
	c.stopSessionMonitor()

	env := nodeEnvironment()
	npm := npmPathForCheck()
	if npm == "" {
		warn("Deepseek Harness 更新", "未找到 npm，无法更新运行环境。")
		return
	}
	tracker := newProgressWindow(c.app, "正在更新 Deepseek Harness")
	defer tracker.Close()
	progress := progress.NewTracker()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := dshrt.Install(ctx, dshrt.InstallOptions{
		NpmPath:     npm,
		Environment: env,
		Force:       true,
		PackageSpec: "@deepseek-ai/dsh@" + version,
		OnOutput: func(chunk string) {
			snapshot := progress.Consume(chunk)
			tracker.Update(snapshot.Detail, snapshot.Percentage)
		},
	})
	if err != nil {
		tracker.Finish(false)
		applog.Logf("dsh update failed: %v", err)
		c.setState(stateFailed, "更新失败")
		bringToFront()
		if err == dshrt.ErrCancelled {
			tracker.Cancelled()
			warn("Deepseek Harness 更新", "已取消更新")
		} else {
			warn("Deepseek Harness 更新", "更新失败："+err.Error())
		}
		return
	}
	tracker.Finish(true)
	c.mu.Lock()
	c.skippedDSHVersion = ""
	c.pendingDSHUpdate = nil
	c.dshVersion = version
	c.mu.Unlock()
	saveSettings()
	applog.Logf("dsh updated to %s", version)
	if !wasActive {
		// dsh was not running when the user asked for the update, so it
		// stays stopped: starting a server the user had shut down is not
		// what 更新 means (macOS keeps the same distinction through
		// relaunchAfterInstall).
		c.setState(stateStopped, "未运行")
		applog.Logf("dsh not running before the update; leaving it stopped")
		return
	}
	c.Start()
}

// openLauncherUpdate checks the launcher's releases on demand.
func (c *controller) openLauncherUpdate() {
	applog.Logf("menu: check launcher update")
	info, err := checkLauncherRelease()
	if err != nil {
		warn("启动器（DHL）更新", "检查失败："+err.Error())
		return
	}
	if info == nil {
		warn("启动器（DHL）更新", "还没有发布过启动器版本。")
		return
	}
	if compareRelease(info.Version, c.version) <= 0 {
		warn("启动器（DHL）更新", fmt.Sprintf("已是最新版本（v%s）。", c.version))
		return
	}
	// Render the Markdown release notes in the dialog's scroll pane, the
	// way macOS does — a native MessageBox showed them as raw text.
	bringToFront()
	c.showLauncherUpdateDialog(info)
}

// registerNotifier wires the Windows Toast service. It must run before
// App.Run: Wails refuses services registered once the loop is going.
func (c *controller) registerNotifier() {
	svc := notifications.New()
	c.notifier = svc
	// RegisterService takes a wrapped Service value, not the raw pointer
	c.app.RegisterService(application.NewService(svc))

	// the settings page calls back into Go through this service
	bridge := &settingsBridge{ctl: c}
	c.app.RegisterService(application.NewServiceWithOptions(bridge, application.ServiceOptions{Name: "SettingsBridge"}))

	// the launcher panel's actions
	panel.ctl = c
	c.app.RegisterService(application.NewServiceWithOptions(
		&PanelService{ctl: c}, application.ServiceOptions{Name: "PanelService"}))
}

// startUpdateSchedule starts the periodic checks, restores the unread
// rows, and paints the first badge.
func (c *controller) startUpdateSchedule() {
	restoreSessionUnread()
	// the summon chord plus the panel's own shortcuts, all on one pump
	setHotkeyActions(map[int]func(){
		hotkeySummon:  func() { go c.Open() },
		hotkeyOpen:    func() { go c.Open() },
		hotkeyRefresh: func() { go c.RefreshPage() },
		hotkeyLog: func() {
			if h != nil {
				go h.openLog()
			}
		},
		hotkeyQuit: func() { c.Quit() },
		hotkeyPanel: func() {
			if h != nil {
				h.openPanel()
			}
		},
	})
	startHotkeyPump()
	applyGlobalHotKey(c.globalHotKeyEnabled, c.globalHotKey)
	applyPanelHotkeys()
	c.scheduleUpdateChecks()
	c.startPluginUpdatePoll()
	c.refreshBadgeAndMenu()
}

// --- menu section -----------------------------------------------------------

// refreshOpenPanel re-renders the panel if it is on screen. The panel
// builds its model on every open, so nothing needs rebuilding while it is
// closed — this only keeps an open panel live as state changes.
func refreshOpenPanel() {
	panel.mu.Lock()
	visible := panel.visible
	ctl := panel.ctl
	panel.mu.Unlock()
	if !visible || ctl == nil || panel.win == nil {
		return
	}
	model := ctl.buildPanelModel()
	panel.win.ExecJS("window.__dhlPanel(" + panelPayload(model) + ")")
}

// openSession opens the Harness page and asks the plugin to switch to the
// session, then clears that row's unread.
func (c *controller) openSession(sessionID string) {
	c.mu.Lock()
	port := c.port
	launcher := c.launcher
	c.mu.Unlock()
	if port == 0 {
		return
	}
	c.openBrowser(port, launcher)
	// the plugin queues a page navigation command the web client claims.
	// requireEmbedded keeps a background browser tab from claiming it
	// first (its document.hasFocus() lies): the command then switches
	// sessions inside an invisible window — 「点了没反应」.
	payload, ok := launch.OpenSessionPayload(sessionID, true)
	if !ok {
		return
	}
	status := postJSON(port, "/dsh-session-notify/open", payload)
	applog.Logf("session open %s -> HTTP %d", sessionID, status)
	sessionStore.MarkRead(sessionID)
	persistSessionUnread()
	c.refreshBadgeAndMenu()
}

// jumpToSession is the flyout's row click: open the page, ask the plugin
// to switch to that session, and clear its reminder. Same work as the tray
// menu's row, reached from a second surface.
func (c *controller) jumpToSession(sessionID string) {
	c.openSession(sessionID)
}

// --- helpers -------------------------------------------------------------

func nodeEnvironment() map[string]string {
	return nodeenv.NodeEnvironment(nodeDir(), nil)
}

// npmPathForCheck resolves npm for update checks.
func npmPathForCheck() string {
	env := nodeEnvironment()
	if dir := nodeDir(); dir != "" {
		candidate := filepath.Join(dir, "npm.cmd")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	if path, ok := nodeenv.FindExecutable("npm", env); ok {
		return path
	}
	return ""
}

// dshVersionOf asks the installed runtime for its version.
func dshVersionOf(env map[string]string) string {
	entry := dshrt.ExecutablePath()
	if _, err := os.Stat(entry); err != nil {
		return ""
	}
	return dshupdate.RunVersion(entry, nodeenv.Environment(env))
}

// settingsFile is the persisted launcher settings (the counterpart of
// macOS UserDefaults).
type settingsFile struct {
	UpdateIntervalHours    float64 `json:"updateIntervalHours,omitempty"`
	AutoCheckPluginUpdates bool    `json:"autoCheckPluginUpdates"`
	OpenBrowserOnReady     bool    `json:"openBrowserOnReady"`
	// SidebarDeck enables the experimental takeover sidebar (DSHSidebarDeck).
	// Zero value false = default off while the deck is still being tuned.
	SidebarDeck         bool   `json:"sidebarDeck,omitempty"`
	LaunchAtLogin       bool   `json:"launchAtLogin"`
	GlobalHotKeyEnabled bool   `json:"globalHotKeyEnabled"`
	GlobalHotKey        string `json:"globalHotKey,omitempty"`
	DesktopShortcut     bool   `json:"desktopShortcut,omitempty"`
	// NpmRegistry is the chosen install source; empty means "use the
	// default chain" (China mirror first, official second).
	NpmRegistry            string          `json:"npmRegistry,omitempty"`
	SkippedDSHVersion      string          `json:"skippedDSHVersion,omitempty"`
	SkippedLauncherVersion string          `json:"skippedLauncherVersion,omitempty"`
	UnreadEvents           []session.Event `json:"sessionNotifyUnreadEvents,omitempty"`
	// Theme is the panel colour scheme: ""/"system", "light", "dark".
	Theme string `json:"theme,omitempty"`
	// AutoUpdate downloads and installs launcher updates without asking.
	AutoUpdate bool `json:"autoUpdate,omitempty"`
	// NotifyOnComplete shows a Windows toast when a session finishes.
	// Default on: the pointer keeps an explicit "off" distinguishable from
	// a settings file written before the switch existed.
	NotifyOnComplete *bool `json:"notifyOnComplete,omitempty"`
	// AutoCheckUpdates gates the periodic launcher/dsh update checks. A
	// pointer so a stored explicit "off" survives the zero-value problem:
	// nil means the default (on).
	AutoCheckUpdates *bool `json:"autoCheckUpdates,omitempty"`
}

// lastSettingsData is the last payload actually written. Callers persist the
// whole settings file (including the unread rows) and several run on timers,
// so an unchanged payload must not touch the disk at all.
var (
	settingsWriteMu  sync.Mutex
	lastSettingsData []byte
)

// writeSettings persists a settings value set directly (the settings page
// path), then repaints the badge.
func writeSettings(settings settingsFile) {
	data, err := marshalJSON(settings)
	if err != nil {
		return
	}
	writeSettingsData(data)
}

// writeSettingsData writes one payload unless it is byte-identical to the last
// successful write (the Windows counterpart of macOS's persistIfChanged).
func writeSettingsData(data []byte) {
	settingsWriteMu.Lock()
	defer settingsWriteMu.Unlock()
	if bytes.Equal(data, lastSettingsData) {
		return
	}
	if err := os.MkdirAll(paths.SettingsDir(), 0o755); err != nil {
		return
	}
	tmp := paths.SettingsFile() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	if err := os.Rename(tmp, paths.SettingsFile()); err != nil {
		return
	}
	lastSettingsData = append(lastSettingsData[:0], data...)
}

func saveSettings() {
	if h == nil {
		return
	}
	c := h.ectx
	c.mu.Lock()
	settings := settingsFile{
		UpdateIntervalHours:    c.updateIntervalHours,
		AutoCheckPluginUpdates: c.autoCheckPluginUpdates,
		OpenBrowserOnReady:     c.openBrowserOnReady,
		SidebarDeck:            c.sidebarDeck,
		LaunchAtLogin:          launchAtLoginEnabled(),
		GlobalHotKeyEnabled:    c.globalHotKeyEnabled,
		GlobalHotKey:           c.globalHotKey,
		DesktopShortcut:        c.desktopShortcut,
		NpmRegistry:            c.npmRegistry,
		SkippedDSHVersion:      c.skippedDSHVersion,
		SkippedLauncherVersion: c.skippedLauncherVersion,
		UnreadEvents:           realUnreadEvents(),
		Theme:                  c.theme,
		AutoUpdate:             c.autoUpdate,
		AutoCheckUpdates:       &c.autoCheckUpdates,
		NotifyOnComplete:       &c.notifyOnComplete,
	}
	c.mu.Unlock()
	data, err := marshalJSON(settings)
	if err != nil {
		return
	}
	writeSettingsData(data)
}

func loadSettings() settingsFile {
	var settings settingsFile
	data, err := os.ReadFile(paths.SettingsFile())
	if err != nil {
		return settings
	}
	_ = unmarshalJSON(data, &settings)
	return settings
}

// persistSessionUnread writes the unread rows through the settings file so
// a launcher restart keeps the menu rows, not just the count.
func persistSessionUnread() { saveSettings() }

// realUnreadEvents drops the synthetic sessions the dev seed creates.
func realUnreadEvents() []session.Event {
	return filterRealEvents(sessionStore.UnreadEvents())
}

// filterRealEvents keeps events whose session ids look like real dsh
// sessions; the test seed uses the `test-` prefix.
func filterRealEvents(events []session.Event) []session.Event {
	out := make([]session.Event, 0, len(events))
	for _, e := range events {
		if strings.HasPrefix(e.SessionID, "test-") {
			continue
		}
		out = append(out, e)
	}
	return out
}

func restoreSessionUnread() {
	settings := loadSettings()
	if h != nil {
		h.ectx.mu.Lock()
		h.ectx.skippedDSHVersion = settings.SkippedDSHVersion
		h.ectx.skippedLauncherVersion = settings.SkippedLauncherVersion
		if settings.UpdateIntervalHours > 0 {
			h.ectx.updateIntervalHours = settings.UpdateIntervalHours
		}
		h.ectx.autoCheckPluginUpdates = settings.AutoCheckPluginUpdates
		h.ectx.openBrowserOnReady = settings.OpenBrowserOnReady
		h.ectx.sidebarDeck = settings.SidebarDeck
		h.ectx.globalHotKeyEnabled = settings.GlobalHotKeyEnabled
		h.ectx.globalHotKey = settings.GlobalHotKey
		h.ectx.desktopShortcut = settings.DesktopShortcut
		h.ectx.npmRegistry = settings.NpmRegistry
		h.ectx.theme = settings.Theme
		h.ectx.autoUpdate = settings.AutoUpdate
		if settings.AutoCheckUpdates != nil {
			h.ectx.autoCheckUpdates = *settings.AutoCheckUpdates
		}
		// absent (an older settings file) means on: the toast is the
		// feature users expect from a tray launcher.
		if settings.NotifyOnComplete != nil {
			h.ectx.notifyOnComplete = *settings.NotifyOnComplete
		}
		h.ectx.mu.Unlock()
	}
	// Only real completions are restored. The dev seed (--seed /
	// InjectTestEvents) writes synthetic `test-…` sessions; dsh never
	// retracts those, so once persisted they would pin the badge at their
	// count forever — the "always shows 4" report.
	if real := filterRealEvents(settings.UnreadEvents); len(real) > 0 {
		sessionStore.Restore(real)
	}
	// The Harness page's theme lives in dsh's own settings document, which
	// this launcher rewrites. Re-apply it on every start: dsh normalises
	// that file on boot and drops keys it considers unset, so the value can
	// be missing even though the user chose it.
	if applyDSHTheme(settings.Theme) > 0 {
		applog.Logf("dsh theme re-applied from launcher settings")
	}
}
