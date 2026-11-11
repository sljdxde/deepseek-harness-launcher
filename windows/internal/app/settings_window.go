package app

// settings_window.go is the settings window, the counterpart of
// SettingsWindowController: one WebView page with the same four cards
// (update interval, plugin-update checks, open browser on ready, launch
// at login) plus the global hotkey. Values round-trip through the
// settings file, so a restart keeps them.

import (
	"fmt"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

var settingsWin *application.WebviewWindow

// settingsBridge is the object the page calls into. Wails exposes its
// exported methods to the page's window namespace.
type settingsBridge struct {
	ctl *controller
	win *application.WebviewWindow
}

// ApplySettings is called by the page's save button.
func (b *settingsBridge) ApplySettings(values map[string]string) {
	b.ctl.applySettings(values)
	if b.win != nil {
		b.win.Close()
		settingsWin = nil
	}
}

// CloseSettings is the cancel button.
func (b *settingsBridge) CloseSettings() {
	if b.win != nil {
		b.win.Close()
		settingsWin = nil
	}
}

// Uninstall is the 卸载 button: the window goes away first (the uninstall
// confirms over its own dialog), then the shared uninstall flow runs —
// confirm, stop dsh, stage the runner, quit.
func (b *settingsBridge) Uninstall() {
	if b.win != nil {
		b.win.Close()
		settingsWin = nil
	}
	BeginUninstall(b.ctl)
}

// openSettings shows the settings window (created once).
func (c *controller) openSettings() {
	application.InvokeSync(func() {
		if settingsWin != nil {
			settingsWin.Show()
			settingsWin.Focus()
			return
		}
		bridge := &settingsBridge{ctl: c}
		bridge.win = nil
		w := c.app.Window.NewWithOptions(application.WebviewWindowOptions{
			Title:           "设置 — Deepseek Harness Launcher",
			Width:           620,
			Height:          560,
			DisableResize:   true,
			InitialPosition: application.WindowCentered,
			HTML:            settingsHTML(loadSettings(), c.version),
		})
		bridge.win = w
		settingsWin = w
		w.Show()
	})
}

// applySettings writes what the page reported and reacts to the changes
// that need action (the auto-start entry, the hotkey).
func (c *controller) applySettings(values map[string]string) {
	settings := loadSettings()
	if v, ok := values["updateIntervalHours"]; ok {
		if hours, err := parseFloat(v); err == nil {
			if hours < 1 {
				hours = 1
			}
			settings.UpdateIntervalHours = hours
		}
	}
	if v, ok := values["launchAtLogin"]; ok {
		enabled := v == "1"
		if err := setLaunchAtLogin(enabled); err != nil {
			applog.Logf("launch at login: %v", err)
		}
		settings.LaunchAtLogin = enabled
	}
	if v, ok := values["autoCheckPluginUpdates"]; ok {
		settings.AutoCheckPluginUpdates = v == "1"
	}
	if v, ok := values["openBrowserOnReady"]; ok {
		settings.OpenBrowserOnReady = v == "1"
	}
	if v, ok := values["globalHotKeyEnabled"]; ok {
		settings.GlobalHotKeyEnabled = v == "1"
	}
	if v, ok := values["globalHotKey"]; ok {
		settings.GlobalHotKey = strings.TrimSpace(v)
	}
	writeSettings(settings)
	applyGlobalHotKey(settings.GlobalHotKeyEnabled, settings.GlobalHotKey)
	applog.Logf("settings saved: %+v", settings)
}

func parseFloat(value string) (float64, error) {
	var f float64
	_, err := fmt.Sscanf(value, "%g", &f)
	return f, err
}

// settingsHTML renders the settings page. It is a plain page with no
// framework: the launcher ships no asset pipeline, and a settings form
// does not need one.
func settingsHTML(s settingsFile, version string) string {
	checked := func(b bool) string {
		if b {
			return " checked"
		}
		return ""
	}
	return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8">
<style>
 :root { color-scheme: light dark; }
 body { margin:0; font-family:"Segoe UI","Microsoft YaHei",sans-serif; font-size:13px;
   background: light-dark(#f6f6f6,#1f1f1f); color: light-dark(#1a1a1a,#f2f2f2); padding:16px; }
 .card { background: light-dark(#fff,#2a2a2a); border:1px solid light-dark(#e0e0e0,#3a3a3a);
   border-radius:8px; padding:14px 16px; margin-bottom:12px; }
 .card h3 { margin:0 0 10px; font-size:14px; font-weight:600; }
 .row { display:flex; align-items:center; justify-content:space-between; padding:6px 0; }
 .row label { flex:1; }
 .hint { opacity:.6; font-size:12px; margin-top:4px; }
 input[type=number], input[type=text] { width:110px; padding:4px 6px; border-radius:4px;
   border:1px solid light-dark(#c8c8c8,#555); background: light-dark(#fff,#1f1f1f); color:inherit; }
 input[type=checkbox] { width:16px; height:16px; }
 footer { display:flex; justify-content:flex-end; gap:8px; margin-top:8px; }
 button { padding:6px 16px; border-radius:6px; border:1px solid light-dark(#c8c8c8,#555);
   background: light-dark(#fafafa,#333); color:inherit; cursor:pointer; }
 button.primary { background:#0f6cbd; border-color:#0f6cbd; color:#fff; }
 button.dangerbtn { border-color: light-dark(#d13438,#c50f1f); color: light-dark(#d13438,#ff9a8d); }
 .ver { opacity:.55; font-size:12px; margin-top:2px; }
</style></head>
<body>
 <div class="card">
   <h3>更新</h3>
   <div class="row"><label>检查频率（小时）<div class="hint">启动器与 Deepseek Harness 的更新检查间隔，最小 1 小时</div></label>
     <input type="number" id="updateIntervalHours" min="1" step="1" value="` + fmtInterval(s.UpdateIntervalHours) + `"></div>
   <div class="row"><label>自动检测插件更新<div class="hint">让内置插件管理器在后台检查已装插件的版本</div></label>
     <input type="checkbox" id="autoCheckPluginUpdates"` + checked(s.AutoCheckPluginUpdates) + `></div>
 </div>
 <div class="card">
   <h3>启动</h3>
   <div class="row"><label>就绪后自动打开浏览器<div class="hint">dsh 启动完成后自动打开 Harness 页面</div></label>
     <input type="checkbox" id="openBrowserOnReady"` + checked(s.OpenBrowserOnReady) + `></div>
   <div class="row"><label>登录 Windows 时自动启动<div class="hint">写入当前用户的启动项，不需要管理员权限</div></label>
     <input type="checkbox" id="launchAtLogin"` + checked(s.LaunchAtLogin) + `></div>
 </div>
 <div class="card">
   <h3>全局快捷呼出</h3>
   <div class="row"><label>启用全局快捷键<div class="hint">任意程序中按下即可呼出 Harness 窗口</div></label>
     <input type="checkbox" id="globalHotKeyEnabled"` + checked(s.GlobalHotKeyEnabled) + `></div>
   <div class="row"><label>快捷键<div class="hint">形如 Ctrl+Alt+D</div></label>
     <input type="text" id="globalHotKey" value="` + s.GlobalHotKey + `"></div>
 </div>
 <div class="card">
   <h3>关于</h3>
   <div class="row"><label>Deepseek Harness Launcher</label><span>v` + version + `</span></div>
   <div class="ver">Windows 版 · 与 macOS 版功能对等</div>
   <div class="row" style="margin-top:10px"><label>卸载启动器<div class="hint">~/.dsh 里的会话与数据会保留</div></label>
     <button class="dangerbtn" onclick="window.go.app.SettingsBridge.Uninstall()">卸载启动器</button></div>
 </div>
 <footer>
   <button onclick="window.go.app.SettingsBridge.CloseSettings()">取消</button>
   <button class="primary" onclick="save()">保存</button>
 </footer>
<script>
 function save() {
   const v = {
     updateIntervalHours: document.getElementById('updateIntervalHours').value,
     autoCheckPluginUpdates: document.getElementById('autoCheckPluginUpdates').checked ? '1' : '0',
     openBrowserOnReady: document.getElementById('openBrowserOnReady').checked ? '1' : '0',
     launchAtLogin: document.getElementById('launchAtLogin').checked ? '1' : '0',
     globalHotKeyEnabled: document.getElementById('globalHotKeyEnabled').checked ? '1' : '0',
     globalHotKey: document.getElementById('globalHotKey').value,
   };
   window.go.app.SettingsBridge.ApplySettings(v);
 }
</script>
</body></html>`
}

func fmtInterval(hours float64) string {
	if hours <= 0 {
		hours = 6
	}
	if hours == float64(int(hours)) {
		return fmt.Sprint(int(hours))
	}
	return fmt.Sprintf("%.1f", hours)
}
