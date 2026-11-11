package app

import (
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// progressWindow is the install/update progress dialog, the counterpart
// of DSHInstallWindowController: one small window, a stage line and a
// percentage, driven by ExecJS from the npm output pump. The window's
// 取消 button cancels the running install through the registered
// ProgressBridge service.
type progressWindow struct {
	mu     sync.Mutex
	window *application.WebviewWindow
	lastJS string
}

func newProgressWindow(a *application.App, title string) *progressWindow {
	p := &progressWindow{}
	w := a.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:           title,
		Width:           460,
		Height:          190,
		DisableResize:   true,
		AlwaysOnTop:     true,
		InitialPosition: application.WindowCentered,
		HTML:            progressHTML,
	})
	p.window = w
	return p
}

// Update pushes a new stage line and percentage into the page.
func (p *progressWindow) Update(detail string, percentage float64) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.window == nil {
		return
	}
	js := fmt.Sprintf("window.__dhlUpdate(%q, %.1f);", detail, percentage)
	if js == p.lastJS {
		return
	}
	p.lastJS = js
	p.window.ExecJS(js)
}

// Finish labels the bar done; the caller closes shortly after.
func (p *progressWindow) Finish(ok bool) {
	text := "安装完成"
	if !ok {
		text = "安装失败"
	}
	p.Update(text, 100)
}

// Cancelled labels the bar stopped-by-user; the caller closes shortly
// after.
func (p *progressWindow) Cancelled() {
	p.Update("已取消", 100)
}

// Close takes the window down for good.
func (p *progressWindow) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.window != nil {
		p.window.Close()
		p.window = nil
	}
}

// progressHTML is the whole page: no framework, no asset server, one
// function the host calls. The bar uses a plain accent color rather
// than the Windows theme accent — matching it needs a WebView2 bridge
// the first install does not need.
const progressHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 13px; padding: 18px 20px;
    background: light-dark(#ffffff, #202020);
    color: light-dark(#1a1a1a, #f2f2f2);
    user-select: none; overflow: hidden;
  }
  #detail { margin-bottom: 12px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; opacity: .92; }
  .bar { height: 8px; border-radius: 4px;
    background: light-dark(#e6e6e6, #3a3a3a); overflow: hidden; }
  .fill { height: 100%; width: 0%;
    background: light-dark(#0f6cbd, #4cc2ff); border-radius: 4px;
    transition: width .25s ease; }
  #pct { margin-top: 8px; font-variant-numeric: tabular-nums;
    opacity: .7; font-size: 12px; }
  #cancelbtn { margin-top: 12px; padding: 5px 14px; border-radius: 5px;
    border: 1px solid light-dark(#c8c8c8, #555);
    background: light-dark(#fafafa, #333); color: inherit; cursor: pointer;
    font-size: 12px; }
  #cancelbtn:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
  <div id="detail">准备安装…</div>
  <div class="bar"><div class="fill" id="fill"></div></div>
  <div id="pct">0.0%</div>
  <button id="cancelbtn">取消安装</button>
  <script>
    window.__dhlUpdate = function (detail, pct) {
      document.getElementById('detail').textContent = detail;
      document.getElementById('fill').style.width = Math.max(0, Math.min(100, pct)) + '%';
      document.getElementById('pct').textContent = pct.toFixed(1) + '%';
    };
    document.getElementById('cancelbtn').onclick = function () {
      this.disabled = true;
      this.textContent = '正在取消…';
      try { window.go.app.ProgressBridge.Cancel(); } catch (e) {}
    };
  </script>
</body>
</html>`
