package app

// downloadwindow.go is the launcher-update download window, the
// counterpart of UpdateDownloadWindowController on macOS.
//
// Why it exists: without it, 确定 started an invisible download. The old
// flow went straight from the confirm dialog to installLauncherUpdate,
// which blocked inside http.Client.Do with a ten-minute timeout — on a
// connection that stalls (github.com asset downloads regularly do) the
// user saw nothing at all for ten minutes, no bytes on disk and no
// feedback, which reads as "确定 did nothing". The window shows the phase,
// the byte counter and the percentage, and its 取消 button aborts the
// request through the context.
//
// The page is served from the asset handler (/dhl-download); progress is
// read by polling /dhl-download-state, so no ExecJS push is needed and a
// late-loading page cannot miss an update.

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
)

const (
	downloadPageURL = "/dhl-download"

	downloadWinWidth  = 480
	downloadWinHeight = 200
)

// download phases, in the order the UI sees them.
const (
	downloadConnecting = "connecting"
	downloadRunning    = "downloading"
	downloadDone       = "done"
	downloadCancelled  = "cancelled"
	downloadFailed     = "failed"
)

// downloadHost keeps the progress window and the transfer's counters.
type downloadHost struct {
	mu      sync.Mutex
	app     *application.App
	win     *application.WebviewWindow
	version string
	written int64
	total   int64
	phase   string
	detail  string
	cancel  context.CancelFunc
	active  bool
}

var downloadUI = &downloadHost{}

// begin resets the state and shows the window. It returns false when a
// download is already in flight — the caller then leaves it alone instead
// of starting a second transfer over the same file.
func (d *downloadHost) begin(app *application.App, version string) bool {
	if app == nil {
		return false
	}
	d.mu.Lock()
	if d.active {
		w := d.win
		d.mu.Unlock()
		if w != nil {
			w.Show()
			w.Focus()
			raiseTopmost(windowHWND(w))
		}
		return false
	}
	d.app = app
	d.version = version
	d.written = 0
	d.total = 0
	d.phase = downloadConnecting
	d.detail = ""
	d.cancel = nil
	d.active = true
	d.mu.Unlock()

	w := d.ensure(app)
	if w == nil {
		d.mu.Lock()
		d.active = false
		d.mu.Unlock()
		return false
	}
	// reload so the page paints the new version
	w.SetURL(downloadPageURL)
	d.place(app, w)
	w.Show()
	w.Focus()
	raiseTopmost(windowHWND(w))
	applog.Logf("download window: downloading v%s", version)
	return true
}

// setCancel stores the function the 取消 button calls.
func (d *downloadHost) setCancel(cancel context.CancelFunc) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.cancel = cancel
}

// progress records the transfer's counters.
func (d *downloadHost) progress(written, total int64) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.phase = downloadRunning
	d.written = written
	if total > 0 {
		d.total = total
	}
}

// finish marks a terminal phase.
func (d *downloadHost) finish(phase, detail string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.phase = phase
	d.detail = detail
	d.active = false
	if phase == downloadDone && d.total > 0 {
		d.written = d.total
	}
}

// cancelDownload hands the request's cancel function to the page's button.
func (d *downloadHost) cancelDownload() {
	d.mu.Lock()
	cancel := d.cancel
	active := d.active
	d.mu.Unlock()
	if !active || cancel == nil {
		return
	}
	applog.Logf("download window: cancelled by user")
	cancel()
}

// close takes the window down and clears the transfer state.
func (d *downloadHost) close() {
	d.mu.Lock()
	w := d.win
	d.win = nil
	d.active = false
	d.cancel = nil
	d.mu.Unlock()
	if w != nil {
		w.Close()
	}
}

// versionOf is the version the page shows in its title row.
func (d *downloadHost) versionOf() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.version
}

// stateJSON is what /dhl-download-state answers; the page polls it.
func (d *downloadHost) stateJSON() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return fmt.Sprintf(`{"active":%v,"phase":%q,"written":%d,"total":%d,"pct":%.1f,"text":%q}`,
		d.active, d.phase, d.written, d.total,
		downloadPercent(d.written, d.total),
		downloadStatusText(d.phase, d.written, d.total, d.detail))
}

// ensure creates the progress window on first use.
func (d *downloadHost) ensure(app *application.App) *application.WebviewWindow {
	d.mu.Lock()
	if d.win != nil {
		w := d.win
		d.mu.Unlock()
		return w
	}
	d.mu.Unlock()

	var created *application.WebviewWindow
	application.InvokeSync(func() {
		d.mu.Lock()
		defer d.mu.Unlock()
		if d.win != nil {
			created = d.win
			return
		}
		w := app.Window.NewWithOptions(application.WebviewWindowOptions{
			Name:           "dhl-download",
			Title:          "正在下载更新",
			Width:          downloadWinWidth,
			Height:         downloadWinHeight,
			Frameless:      true,
			AlwaysOnTop:    true,
			BackgroundType: application.BackgroundTypeSolid,
			DisableResize:  true,
			Windows:        application.WindowsWindow{HiddenOnTaskbar: true},
			URL:            downloadPageURL,
		})
		d.win = w
		created = w
	})
	return created
}

// place centres the window in the work area.
func (d *downloadHost) place(app *application.App, w *application.WebviewWindow) {
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
	x, y := centeredRect(work.X, work.Y, work.Width, work.Height, downloadWinWidth, downloadWinHeight)
	w.SetPosition(x, y)
}

// centeredRect places a w×h box in the middle of a work area, clamped so
// it can never leave the screen on a small or oddly placed display.
func centeredRect(workX, workY, workW, workH, w, h int) (x, y int) {
	if workW < w {
		w = workW
	}
	if workH < h {
		h = workH
	}
	x = workX + (workW-w)/2
	y = workY + (workH-h)/2
	x = clamp(x, workX, workX+workW-w)
	y = clamp(y, workY, workY+workH-h)
	return x, y
}

// downloadPercent is the bar's position; 0 when the server did not send a
// length (the page then shows the spinner state instead of a bar width).
func downloadPercent(written, total int64) float64 {
	if total <= 0 || written <= 0 {
		return 0
	}
	pct := float64(written) / float64(total) * 100
	if pct < 0 {
		return 0
	}
	if pct > 100 {
		return 100
	}
	return pct
}

// downloadStatusText is the line above the bar, matching the macOS
// wording ("正在下载 30%（12 MB/40 MB）").
func downloadStatusText(phase string, written, total int64, detail string) string {
	switch phase {
	case downloadConnecting:
		return "正在连接下载服务器…"
	case downloadRunning, downloadDone:
		if total > 0 {
			return fmt.Sprintf("正在下载 %s / %s", humanBytes(written), humanBytes(total))
		}
		return fmt.Sprintf("正在下载…（已完成 %s）", humanBytes(written))
	case downloadCancelled:
		return "已取消下载"
	case downloadFailed:
		if detail != "" {
			return "下载失败：" + detail
		}
		return "下载失败"
	}
	return "正在下载…"
}

// humanBytes formats a byte count the way the download line reads.
func humanBytes(n int64) string {
	if n < 0 {
		n = 0
	}
	const (
		kb = 1024
		mb = 1024 * kb
		gb = 1024 * mb
	)
	switch {
	case n >= gb:
		return fmt.Sprintf("%.2f GB", float64(n)/gb)
	case n >= mb:
		return fmt.Sprintf("%.1f MB", float64(n)/mb)
	case n >= kb:
		return fmt.Sprintf("%.0f KB", float64(n)/kb)
	}
	return fmt.Sprintf("%d B", n)
}

// downloadPage bakes the version being fetched into the progress page.
func downloadPage(version string) string {
	return strings.ReplaceAll(downloadPageHTML, "__VERSION__", "v"+esc(version))
}

// downloadPageHTML is the progress page. Polling keeps the page dumb: no
// binding, no ExecJS push, and the first poll after load immediately shows
// whatever already happened.
const downloadPageHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
:root{color-scheme:light dark}
body{
  margin:0;font:13px/1.5 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",
       "Microsoft YaHei",system-ui,sans-serif;
  padding:18px 20px;user-select:none;overflow:hidden;
  background:light-dark(#f4f4f6,#1a1a1e);color:light-dark(#1c1c21,#ededf1);
  border:1px solid light-dark(#e3e3e8,#333339);
}
.t{display:flex;align-items:baseline;gap:8px;font-size:13.5px;font-weight:600}
.t .v{font-size:12px;font-weight:400;color:light-dark(#4b4b53,#b9b9c1);
  font-variant-numeric:tabular-nums}
#text{margin:10px 0 9px;font-size:12px;color:light-dark(#4b4b53,#b9b9c1);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.bar{height:8px;background:light-dark(#e3e3e8,#333339);overflow:hidden;border-radius:0}
.fill{height:100%;width:0%;background:light-dark(#4f46e5,#a5b4fc);transition:width .2s ease}
.meta{display:flex;justify-content:space-between;margin-top:7px;font-size:11px;
  color:light-dark(#85858d,#8b8b94);font-variant-numeric:tabular-nums}
.ft{margin-top:14px}
button{font:inherit;font-size:12px;height:28px;padding:0 12px;border-radius:0;
  border:1px solid light-dark(#e3e3e8,#333339);background:light-dark(#fff,#232327);
  color:inherit;cursor:default}
button:hover{background:light-dark(#ececf1,#303036)}
button:disabled{opacity:.5}
.spin{display:none;width:9px;height:9px;border-radius:50%;
  background:light-dark(#4f46e5,#a5b4fc);animation:p 1s ease-in-out infinite}
@keyframes p{0%,100%{opacity:.25}50%{opacity:1}}
</style>
</head>
<body>
  <div class="t" style="--wails-draggable:drag"><span class="spin" id="spin"></span>正在下载更新<span class="v">__VERSION__</span></div>
  <div id="text">正在连接下载服务器…</div>
  <div class="bar"><div class="fill" id="fill"></div></div>
  <div class="meta"><span id="bytes"></span><span id="pct"></span></div>
  <div class="ft"><button id="cancel">取消下载</button></div>
<script>
(function () {
  var answered = false;
  var timer = null;
  var fill = document.getElementById('fill');
  var text = document.getElementById('text');
  var pct = document.getElementById('pct');
  var spin = document.getElementById('spin');
  var cancel = document.getElementById('cancel');
  function paint(s) {
    text.textContent = s.text;
    var known = s.total > 0;
    fill.style.width = known ? s.pct + '%' : '100%';
    fill.style.opacity = known ? '1' : '0.25';
    pct.textContent = known ? s.pct.toFixed(1) + '%' : '';
    spin.style.display = (s.phase === 'connecting') ? 'inline-block' : 'none';
    if (s.phase === 'done' || s.phase === 'cancelled' || s.phase === 'failed') {
      cancel.disabled = true;
      cancel.textContent = s.phase === 'cancelled' ? '已取消' : '关闭';
    }
  }
  function tick() {
    fetch('/dhl-download-state', { cache: 'no-store' }).then(function (r) {
      return r.json();
    }).then(function (s) {
      paint(s);
      if (s.active) {
        timer = setTimeout(tick, 200);
      }
    }).catch(function () {
      timer = setTimeout(tick, 500);
    });
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
        body: 'action=download-cancel'
      });
    } catch (e) {}
  };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !answered) cancel.onclick();
  });
  tick();
})();
</script>
</body>
</html>`
