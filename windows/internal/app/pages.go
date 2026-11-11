package app

// pages.go serves the panel page through Wails' asset server.
//
// Why a server instead of the HTML window option: in Wails beta.24 the
// HTML option is only honoured on darwin and linux, and the Windows
// setHTML implementation merely rewrites
// document.documentElement.innerHTML — which does nothing when the window
// has no document yet. The result was a correctly positioned window with a
// blank grey body. Loading a URL is the path that actually renders on
// Windows.
//
// Both pages are self-contained (inline CSS and JS, no external assets), so
// the handler only needs to return them by path.

import (
	"net/http"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

// pageHandler routes the launcher's own pages. The main Harness window
// loads the real dsh page over plain http (see dshwindow.go); the asset
// server only serves the panel, its action endpoint, and the placeholder
// shown while dsh is starting.
func pageHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writePage(w, dshLoadingHTML)
	})
	mux.HandleFunc("/dhl-panel", func(w http.ResponseWriter, r *http.Request) {
		// the model is baked in at request time, so each open shows
		// current state without needing a binding or a push
		var model panelModel
		if panel.ctl != nil {
			model = panel.ctl.buildPanelModel()
		}
		writePage(w, panelHTML(model))
	})
	// Panel actions go through HTTP, not through a Wails binding: a page
	// served by a custom asset handler does not get the window.go runtime
	// object, so every binding call from the page threw and a click on a
	// completed session produced an error instead of a jump.
	mux.HandleFunc("/dhl-action", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		action := r.FormValue("action")
		id := r.FormValue("id")
		applog.Logf("panel http: action=%q id=%q", action, id)
		// settings actions answer with their own JSON (new frequency,
		// effective switch state); everything else gets {"ok":true}
		handlePanelAction(action, id, w, r)
	})

	// a deliberately trivial page: if this renders and the real panel does
	// not, the problem is in the panel markup rather than the plumbing
	mux.HandleFunc("/dhl-probe", func(w http.ResponseWriter, r *http.Request) {
		writePage(w, `<!doctype html><html><body style="margin:0;background:#c00;color:#fff;font:24px sans-serif;padding:20px">PROBE OK</body></html>`)
	})
	return mux
}

func writePage(w http.ResponseWriter, html string) {
	w.Header().Set("content-type", "text/html; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	_, _ = w.Write([]byte(html))
}

// dshLoadingHTML is the main window's first paint: dsh takes a few
// seconds to boot (a cold first install much longer), and a blank white
// WebView looks broken. The window reloads to the real Harness URL once
// the token line appears on stdout.
const dshLoadingHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;
    color:#4a4a52;background:#fafafd}
  .box{text-align:center}
  .dot{width:10px;height:10px;margin:0 auto 14px;border-radius:50%;
    background:#0a68f5;animation:p 1.2s ease-in-out infinite}
  @keyframes p{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
</style></head><body><div class="box">
  <div class="dot"></div>正在启动 DeepSeek Harness…<br>
  <small>首次使用需要安装运行环境，请稍候</small>
</div></body></html>`
