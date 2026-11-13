package app

// progress_window.go is the install/update progress dialog, the
// counterpart of DSHInstallWindowController: one small window, a stage line
// and a percentage, driven by the npm output pump.
//
// The page is served from the asset handler (/dhl-progress) and reads its
// state by polling, for the same reason the panel is: the WebviewWindow
// HTML option is ignored on Windows, so an HTML-option window renders
// nothing, and its window.go binding (the old 取消 button) does not exist
// on asset-served pages either. Cancel therefore travels over
// POST /dhl-action like every other launcher page action.

import (
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const progressPageURL = "/dhl-progress"

// progressState is what /dhl-progress-state answers.
type progressState struct {
	mu         sync.Mutex
	detail     string
	percentage float64
	finished   bool
	cancelled  bool
}

var installProgress = &progressState{detail: "准备安装…"}

func (s *progressState) set(detail string, percentage float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.detail = detail
	s.percentage = percentage
}

func (s *progressState) finish(detail string, cancelled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.detail = detail
	s.percentage = 100
	s.finished = true
	s.cancelled = cancelled
}

func (s *progressState) reset(detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.detail = detail
	s.percentage = 0
	s.finished = false
	s.cancelled = false
}

func (s *progressState) stateJSON() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	pct := s.percentage
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return fmt.Sprintf(`{"detail":%q,"pct":%.1f,"finished":%v,"cancelled":%v}`,
		s.detail, pct, s.finished, s.cancelled)
}

// progressWindow is the window handle plus its close.
type progressWindow struct {
	window *application.WebviewWindow
}

func newProgressWindow(a *application.App, title string) *progressWindow {
	installProgress.reset("准备安装…")
	var created *application.WebviewWindow
	application.InvokeSync(func() {
		created = a.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:           "dhl-progress",
			Title:          title,
			Width:          460,
			Height:         190,
			Frameless:      true,
			AlwaysOnTop:    true,
			DisableResize:  true,
			BackgroundType: application.BackgroundTypeSolid,
			URL:            progressPageURL,
		})
	})
	p := &progressWindow{window: created}
	// Show marshals itself, so it must stay outside the InvokeSync block
	// above (nesting the two deadlocks the GUI thread).
	if created != nil {
		created.Center()
		created.Show()
		raiseTopmost(windowHWND(created))
	}
	return p
}

// Update pushes a new stage line and percentage into the page.
func (p *progressWindow) Update(detail string, percentage float64) {
	installProgress.set(detail, percentage)
}

// Finish labels the bar done; the caller closes shortly after.
func (p *progressWindow) Finish(ok bool) {
	text := "安装完成"
	if !ok {
		text = "安装失败"
	}
	installProgress.finish(text, false)
}

// Cancelled labels the bar stopped-by-user; the caller closes shortly
// after.
func (p *progressWindow) Cancelled() {
	installProgress.finish("已取消", true)
}

// Close takes the window down for good.
func (p *progressWindow) Close() {
	if p.window != nil {
		p.window.Close()
		p.window = nil
	}
}

// progressPage is the served progress document.
const progressPage = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
:root{color-scheme:light dark}
body{
  margin:0;padding:18px 20px;overflow:hidden;user-select:none;
  font:13px/1.5 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",
       "Microsoft YaHei",system-ui,sans-serif;
  background:light-dark(#f4f4f6,#1a1a1e);color:light-dark(#1c1c21,#ededf1);
  border:1px solid light-dark(#e3e3e8,#333339);
}
#detail{margin-bottom:12px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;font-size:12px;color:light-dark(#4b4b53,#b9b9c1)}
.bar{height:8px;background:light-dark(#e3e3e8,#333339);overflow:hidden}
.fill{height:100%;width:0%;background:light-dark(#4f46e5,#a5b4fc);
  transition:width .25s ease}
#pct{margin-top:8px;font-size:12px;font-variant-numeric:tabular-nums;
  color:light-dark(#85858d,#8b8b94)}
button{margin-top:12px;font:inherit;font-size:12px;height:28px;padding:0 12px;
  border:1px solid light-dark(#e3e3e8,#333339);border-radius:0;
  background:light-dark(#fff,#232327);color:inherit;cursor:default}
button:hover{background:light-dark(#ececf1,#303036)}
button:disabled{opacity:.5}
</style>
</head>
<body>
  <div id="detail" style="--wails-draggable:drag">准备安装…</div>
  <div class="bar"><div class="fill" id="fill"></div></div>
  <div id="pct">0.0%</div>
  <button id="cancelbtn">取消安装</button>
<script>
(function () {
  var answered = false;
  var fill = document.getElementById('fill');
  var detail = document.getElementById('detail');
  var pct = document.getElementById('pct');
  var cancel = document.getElementById('cancelbtn');
  function paint(s) {
    detail.textContent = s.detail;
    fill.style.width = s.pct + '%';
    pct.textContent = s.pct.toFixed(1) + '%';
    if (s.finished) {
      cancel.disabled = true;
      cancel.textContent = s.cancelled ? '已取消' : '请稍候…';
    }
  }
  function tick() {
    fetch('/dhl-progress-state', { cache: 'no-store' }).then(function (r) {
      return r.json();
    }).then(paint).catch(function () {});
    setTimeout(tick, 200);
  }
  cancel.onclick = function () {
    if (answered) return;
    answered = true;
    cancel.disabled = true;
    cancel.textContent = '正在取消…';
    try {
      fetch('/dhl-action', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'action=progress-cancel'
      });
    } catch (e) {}
  };
  tick();
})();
</script>
</body>
</html>`
