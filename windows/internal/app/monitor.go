package app

// monitor.go runs the two background loops the macOS launcher keeps:
// the 3.5s session-completion poll (which lights the tray badge, shows a
// Windows toast, and fills the menu's unread section) and the periodic
// update check (dsh releases + the launcher's own GitHub releases).

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshupdate"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/launch"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/nodeenv"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/probe"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

// Poll interval for the completion feed, the macOS launcher's 3.5s.
const sessionPollInterval = 3500 * time.Millisecond

// store is the launcher-wide session store, persisted with the settings
// file so a restart keeps the unread rows.
// 200 keeps the 99+ badge reachable: with a 50-entry ring the count
// could never exceed 50, so "99+" was dead code.
var sessionStore = session.NewStore(200)

// startSessionMonitor polls the bundled plugin's events endpoint while
// dsh is up. A generation counter keeps a stopped/restarted monitor from
// writing into the next one's state.
func (c *controller) startSessionMonitor() {
	c.mu.Lock()
	c.monitorGen++
	gen := c.monitorGen
	c.mu.Unlock()
	go c.pollSessionEvents(gen)
}

func (c *controller) stopSessionMonitor() {
	c.mu.Lock()
	c.monitorGen++
	c.mu.Unlock()
}

// lastPaintedUnread is the count the badge was last drawn with; it lets an
// idle poll skip the repaint.
var lastPaintedUnread = -1

func (c *controller) pollSessionEvents(gen int) {
	// the first poll after start has no cursor: the plugin's feed replays
	// only what the launcher has not seen, and a fresh dsh boots with
	// seq 0, so ask for everything after 0
	after := sessionStore.PollAfterSeq()
	for {
		c.mu.Lock()
		if c.monitorGen != gen {
			c.mu.Unlock()
			return
		}
		port := c.port
		c.mu.Unlock()
		if port == 0 {
			time.Sleep(sessionPollInterval)
			continue
		}
		body := probe.Body(fmt.Sprintf("%s?after=%d", launch.SessionEventsURL(port), after), 1500*time.Millisecond)
		if body == "" {
			c.mu.Lock()
			polls := c.pollFailures + 1
			c.pollFailures = polls
			c.mu.Unlock()
			if polls == 1 || polls%20 == 0 {
				applog.Logf("session poll: no response from port %d (attempt %d)", port, polls)
			}
		} else {
			c.mu.Lock()
			c.pollFailures = 0
			c.mu.Unlock()
			if feed := session.ParseFeed(body); feed != nil {
				ingest := sessionStore.Ingest(feed)
				after = sessionStore.PollAfterSeq()
				if !ingest.IsEmpty() {
					applog.Logf("session poll: %d new completions, %d resumed, %d viewed (unread=%d)",
						len(ingest.Completions), len(ingest.Resumed), len(ingest.Viewed), sessionStore.UnreadCount())
					c.applySessionIngest(ingest)
				} else if unread := sessionStore.UnreadCount(); unread != lastPaintedUnread {
					// A `viewed` record retracts a reminder the store had
					// already counted, and Ingest reports it as empty on the
					// second sighting. The badge still has to follow the
					// store, or the number never goes down when the user
					// reads a session in Harness. The comparison keeps the
					// icon from being rebuilt on every idle poll.
					lastPaintedUnread = unread
					c.refreshBadgeAndMenu()
				}
			}
		}
		time.Sleep(sessionPollInterval)
	}
}

// applySessionIngest updates the badge, the menu section and shows toasts
// for the new completions.
func (c *controller) applySessionIngest(ingest session.Ingest) {
	index := sessionWorkspaceIndex()
	for _, event := range ingest.Completions {
		label := session.MenuLabel(index[event.SessionID], event.Title, event.SessionID)
		title := session.MenuTitle(event, label, time.Now())
		applog.Logf("session completion: %s", title)
		c.mu.Lock()
		wantToast := c.notifyOnComplete
		c.mu.Unlock()
		if wantToast {
			c.notify("会话完成", label, session.ReasonLabel(event.Reason)+" · 点击打开 DeepSeek Harness")
		}
	}
	c.refreshBadgeAndMenu()
}

// refreshBadgeAndMenu redraws the tray icon and rebuilds the unread menu
// section from the store.
func (c *controller) refreshBadgeAndMenu() {
	unread := sessionStore.UnreadCount()
	state := badgeState{Unread: unread}
	c.mu.Lock()
	state.Update = c.pendingDSHUpdate != nil || c.pendingLauncherUpdate != nil
	c.mu.Unlock()
	h.setTrayIcon(state)
	// the taskbar overlay shows the same count as the tray badge
	setTaskbarBadge(unread)
	refreshOpenPanel()
	persistSessionUnread()
}

// notify shows a Windows toast. A machine where toasts are unavailable
// still runs: the failure is logged and the badge/menu carry the news.
func (c *controller) notify(title, body, detail string) {
	svc := c.notifier
	if svc == nil {
		return
	}
	err := svc.SendNotification(notifications.NotificationOptions{
		ID:    fmt.Sprintf("dhl-%d", time.Now().UnixNano()),
		Title: title,
		Body:  body + "\n" + detail,
	})
	if err != nil {
		applog.Logf("toast failed: %v", err)
	}
}

// sessionWorkspaceIndex maps session id → workspace title from
// ~/.dsh/storages/workspace.json (the archive plugin reads the same file).
func sessionWorkspaceIndex() map[string]string {
	path := filepath.Join(paths.DSHHome(), "storages", "workspace.json")
	return session.WorkspaceIndexFromFile(path)
}

// --- plugin updates ---------------------------------------------------------

// startPluginUpdatePoll asks the bundled plugin manager how many plugins
// can be updated: every 10s while idle, every 1s while an update runs,
// with one `?refresh=1` after 15s to make the plugin refresh its cache.
// Ported from the macOS monitorPluginUpdates.
func (c *controller) startPluginUpdatePoll() {
	go func() {
		refreshed := false
		elapsed := 0
		// 上次真正刷新的摘要。轮询每 10 s 都会重读一次，但只有数字变了才
		// 重绘角标 / 面板并落盘，避免空闲时反复写 settings.json。
		lastSignature := "\x00"
		for {
			c.mu.Lock()
			port := c.port
			enabled := c.autoCheckPluginUpdates
			c.mu.Unlock()
			if port == 0 || !enabled {
				time.Sleep(10 * time.Second)
				elapsed += 10
				continue
			}
			if !refreshed && elapsed >= 15 {
				probe.Body(fmt.Sprintf("http://127.0.0.1:%d/dsh-plugin-manager/updates?refresh=1", port), 3*time.Second)
				refreshed = true
			}
			body := probe.Body(fmt.Sprintf("http://127.0.0.1:%d/dsh-plugin-manager/updates", port), 2*time.Second)
			summary, active := parsePluginUpdates(body)
			c.mu.Lock()
			c.pluginUpdates = summary
			c.mu.Unlock()
			signature := fmt.Sprintf("%d/%d/%d/%t", summary.Available, summary.Ignored, summary.Failed, active)
			if signature != lastSignature {
				lastSignature = signature
				c.refreshBadgeAndMenu()
			}
			if active {
				time.Sleep(1 * time.Second)
				elapsed++
			} else {
				time.Sleep(10 * time.Second)
				elapsed += 10
			}
		}
	}()
}

// pluginUpdateSummary is the count the menu and badge show.
type pluginUpdateSummary struct {
	Available int
	Ignored   int
	Failed    int
}

// parsePluginUpdates reads the plugin manager's /updates response.
func parsePluginUpdates(body string) (pluginUpdateSummary, bool) {
	var payload struct {
		Summary struct {
			UpdateAvailable int `json:"updateAvailable"`
			Ignored         int `json:"ignored"`
			Failed          int `json:"failed"`
		} `json:"summary"`
		Refreshing bool `json:"refreshing"`
		Progress   any  `json:"progress"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return pluginUpdateSummary{}, false
	}
	active := payload.Refreshing || payload.Progress != nil
	return pluginUpdateSummary{
		Available: payload.Summary.UpdateAvailable,
		Ignored:   payload.Summary.Ignored,
		Failed:    payload.Summary.Failed,
	}, active
}

// --- update checks ----------------------------------------------------------

// checkUpdates looks for a newer dsh release and a newer launcher release,
// shows a toast and lights the badge when one exists. The macOS launcher
// runs this on a 6h timer plus 8s after start; Windows keeps the same
// shape.
func (c *controller) checkUpdates(announce bool) {
	// dsh: npm dist-tags + GitHub release feed, both already ported
	installed := dshrt.IsInstalled()
	if installed {
		report := dshupdate.Check(installedDSHVersionForCheck(), npmPathForCheck(), nodeenv.Environment(nodeEnvironment()))
		c.mu.Lock()
		if report.Current != "" {
			c.dshVersion = report.Current
		}
		announceable := dshupdate.BestAnnounceable(report, c.skippedDSHVersion)
		if announceable != nil {
			c.pendingDSHUpdate = announceable
		} else {
			c.pendingDSHUpdate = nil
		}
		c.mu.Unlock()
		if announceable != nil {
			applog.Logf("dsh update available: v%s (%s)", announceable.Version, announceable.LabelFor())
			if announce {
				c.notify("DeepSeek Harness 更新可用",
					fmt.Sprintf("v%s（%s）", announceable.Version, announceable.LabelFor()),
					"点击托盘菜单「检查 Deepseek Harness 更新」")
			}
		}
	}
	// launcher: GitHub Releases, the same endpoint the macOS updater uses
	if info, err := checkLauncherRelease(); err == nil && info != nil {
		c.mu.Lock()
		// A release only counts when it is NEWER than what is installed.
		// Without this guard an older published tag (0.3.10 while running
		// 0.3.11-1.1) was announced as "可更新到 v0.3.10".
		newer, skipped := launcherReleaseAction(info.Version, c.version, c.skippedLauncherVersion)
		installed := c.version
		auto := false
		if newer && !skipped {
			c.pendingLauncherUpdate = info
			// 自动下载并安装更新: one install per release, without asking.
			auto = c.autoUpdate && c.lastAutoVersion != info.Version
			if auto {
				c.lastAutoVersion = info.Version
			}
		} else {
			c.pendingLauncherUpdate = nil
		}
		c.mu.Unlock()

		switch {
		case !newer:
			applog.Logf("launcher update: release v%s is not newer than v%s; ignoring", info.Version, installed)
		case skipped:
			applog.Logf("launcher update: v%s is skipped by the user", info.Version)
		case auto:
			applog.Logf("launcher update: auto-install enabled; installing v%s", info.Version)
			go c.installLauncherUpdate(info, true)
		case announce:
			c.notify("启动器更新可用", "v"+info.Version,
				"点击托盘菜单「检测启动器（DHL）更新」下载")
		}
	}
	c.refreshBadgeAndMenu()
	application.InvokeSync(refreshOpenPanel)
}

// launcherReleaseAction decides whether a published release is worth
// announcing: it must be newer than the installed build and not the
// version the user skipped.
func launcherReleaseAction(releaseVersion, installedVersion, skippedVersion string) (newer, skipped bool) {
	newer = compareRelease(releaseVersion, installedVersion) > 0
	skipped = skippedVersion != "" && compareRelease(skippedVersion, releaseVersion) == 0
	return
}

func installedDSHVersionForCheck() string {
	env := nodeEnvironment()
	return dshVersionOf(env)
}

// updateIntervalHoursValue reads the current check interval in hours.
func (c *controller) updateIntervalHoursValue() float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.updateIntervalHours <= 0 {
		return 6
	}
	return c.updateIntervalHours
}

// scheduleUpdateChecks runs the first check 8s after start and then every
// updateIntervalHours (6h by default), the macOS cadence. The master
// 自动检查更新 switch gates every tick, and the interval is re-read each
// cycle so a settings change takes effect without a restart.
func (c *controller) scheduleUpdateChecks() {
	go func() {
		time.Sleep(8 * time.Second)
		if c.autoCheckEnabled() {
			c.checkUpdates(true)
		}
		for {
			hours := c.updateIntervalHoursValue()
			if hours < 1 {
				hours = 6
			}
			deadline := time.Now().Add(time.Duration(hours * float64(time.Hour)))
			// sleep in half-hour slices so a settings change (frequency or
			// the master switch) is picked up without waiting out a 24h nap
			for time.Now().Before(deadline) {
				time.Sleep(30 * time.Minute)
			}
			if c.autoCheckEnabled() {
				c.checkUpdates(true)
			}
		}
	}()
}
