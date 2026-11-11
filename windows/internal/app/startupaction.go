package app

// startupaction.go lets a second launch ask the running launcher to open
// something. It exists for two reasons:
//
//   - the single-instance hand-off already forwards arguments, so
//     `DHL.exe --panel` is the natural way for a shortcut or a script to
//     reach the running app;
//   - it gives the tray/taskbar paths a testable entry: the click handlers
//     call the same functions, so a broken window show can be reproduced
//     from a terminal instead of only by clicking.
//
// Recognised actions:
//
//	--panel      open the launcher panel (the tray/taskbar click action)
//	--flyout     legacy alias for --panel (pre-tab shortcuts may carry it)
//	--open       open Harness in the browser
//	--settings   open the settings panel
//	--uninstall  the Add/Remove Programs / settings-window uninstall
//
// Anything else (including no argument) means "just start".

import (
	"strings"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

// startupAction is the action a launch asked for. It starts empty: a plain
// start must not open anything by itself (the startup flow already opens
// the page when the setting says so).
var startupAction string

// defaultSecondInstanceAction is what a second launch does when it carries
// no recognised flag. A taskbar button click — the pinned shortcut or a
// bare second launch — must land in Harness directly, the way the macOS
// menu's 打开 does: one click, the page is up. The panel stays on the
// tray icon.
const defaultSecondInstanceAction = "open"

// SetStartupAction records the requested action before Run.
func SetStartupAction(args []string) {
	for _, arg := range args {
		action := strings.TrimSpace(strings.ToLower(arg))
		action = strings.TrimPrefix(action, "--")
		switch action {
		case "panel", "flyout", "open", "settings", "seed", "uninstall":
			startupAction = action
			return
		}
	}
}

// runStartupAction runs the recorded action, if any. fallback is used when
// no flag was recognised.
func runStartupAction(fallback string) {
	if h == nil {
		return
	}
	action := startupAction
	if action == "" {
		action = fallback
	}
	startupAction = ""
	if action == "" {
		return
	}
	applog.Logf("startup action: %s", action)

	switch action {
	case "panel", "flyout":
		// The panel is the tray icon's surface (--flyout is a legacy alias
		// for it). It is not what a taskbar click opens.
		h.openPanel()
	case "open":
		// The taskbar shortcut's argument and the default for a bare second
		// launch: straight to the Harness page, no menu in between. The
		// panel closes with it — the click said "go", not "look at this".
		panel.Hide()
		go h.ectx.Open()
	case "settings":
		go h.ectx.openSettings()
	case "seed":
		// dev aid: put a few unread completions in place so the badge and
		// the panel can be checked without a real dsh turn
		(&PanelService{ctl: h.ectx}).InjectTestEvents(5)
	case "uninstall":
		// the ARP UninstallString and the settings window's 卸载 button
		// both land here; BeginUninstall quits the app when confirmed
		BeginUninstall(h.ectx)
	}
}
