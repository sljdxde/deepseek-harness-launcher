package app

// panelaction.go routes the panel's HTTP callbacks. The page posts an
// action name and an id; everything runs on the launcher side, where the
// state actually lives.

import (
	"net/http"
	"strconv"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

// handlePanelAction runs one action requested by the panel page. The
// response writer travels with the request so settings actions can answer
// with JSON (the new frequency, the effective switch state).
func handlePanelAction(action, id string, w http.ResponseWriter, r *http.Request) {
	applog.Logf("panel action: %s (id=%q)", action, id)
	switch action {
	case "act":
		(&PanelService{ctl: panel.ctl}).Act(id)
	case "jump":
		if panel.ctl != nil {
			panel.Hide()
			panel.ctl.jumpToSession(id)
		}
	case "hide":
		panel.Hide()
	case "open":
		panel.Hide()
		if panel.ctl != nil {
			go panel.ctl.Open()
		}
	case "theme":
		// the page already applied the colour scheme locally; persist it
		if panel.ctl != nil {
			panel.ctl.setTheme(id)
		}
	case "freq":
		if panel.ctl == nil {
			return
		}
		// The stepper sends dir=-1/1 (and the plan's names is up/down);
		// accept both rather than silently stepping the wrong way.
		dir := r.FormValue("dir")
		if dir == "" {
			dir = id
		}
		switch dir {
		case "1", "+", "up":
			dir = "up"
		case "-1", "-", "down":
			dir = "down"
		}
		hours := panel.ctl.stepFrequency(dir)
		writeActionJSON(w, `{"ok":true,"hours":`+strconv.FormatFloat(hours, 'f', -1, 64)+`}`)
		return
	case "sw":
		if panel.ctl == nil || r == nil {
			return
		}
		key := r.FormValue("key")
		on := r.FormValue("on") == "1"
		applog.Logf("panel setting: %s = %v", key, on)
		var eff bool
		switch key {
		case "openOnReady":
			panel.ctl.setOpenOnReady(on)
			eff = on
		case "sidebarDeck":
			panel.ctl.setSidebarDeck(on)
			eff = on
		case "launchAtLogin":
			eff = panel.ctl.setLaunchAtLoginSetting(on)
		case "autoCheckUpdates":
			panel.ctl.setAutoCheckUpdates(on)
			eff = on
		case "autoUpdate":
			panel.ctl.setAutoUpdate(on)
			eff = on
		case "mirror":
			panel.ctl.setMirror(on)
			eff = on
		case "autoCheckPluginUpdates":
			panel.ctl.setAutoCheckPluginUpdates(on)
			eff = on
		case "notifyOnComplete":
			panel.ctl.setNotifyOnComplete(on)
			eff = on
		default:
			applog.Logf("panel setting: unknown key %q", key)
			return
		}
		writeActionJSON(w, `{"ok":true,"on":`+boolJSON(eff)+`}`)
		return
	case "refresh":
		// the page spins its icon; kick the checks without toasts
		if panel.ctl != nil {
			go func() {
				panel.ctl.checkUpdates(false)
				refreshOpenPanel()
			}()
		}
	default:
		applog.Logf("panel action: unknown %q", action)
	}
}

func writeActionJSON(w http.ResponseWriter, body string) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	_, _ = w.Write([]byte(body))
}

func boolJSON(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
