package app

// updatedialogpage.go is the update dialog's page: version rows, the
// Markdown-rendered release notes, and the three choices macOS offers
// (下载 / 稍后 / 跳过此版本). It is served from the asset handler and
// posts its answer to /dhl-action, the same contract the panel uses —
// neither the HTML window option nor window.go bindings work on Windows
// (see pages.go).
//
// The dialog itself (creation, placement, action routing) lives in
// updatedialog.go.

import "strings"

// updateDialogModel is everything the dialog page renders.
type updateDialogModel struct {
	Kind        string // "launcher" or "dsh"
	Title       string // window/frame title, e.g. 启动器更新
	Current     string // installed version
	Target      string // the version on offer
	TargetLabel string // 最新版本 / 可更新到
	Channel     string // e.g. 候选版; "" when the release is stable
	NotesHTML   string // releaseNotesHTML output, "" when the release has no notes
	PrimaryText string // the confirm button, e.g. 下载并安装
	Skipped     bool   // this version is currently on the skip list
	Theme       string // "system", "light", "dark"
}

// updateDialogHTML bakes the model into the dialog document.
func updateDialogHTML(model updateDialogModel) string {
	themeAttr := ""
	switch model.Theme {
	case "dark":
		themeAttr = ` data-theme="dark"`
	case "light":
		themeAttr = ` data-theme="light"`
	}

	channel := ""
	if model.Channel != "" {
		channel = ` <span class="chip">` + esc(model.Channel) + `</span>`
	}

	notes := `<div class="none">该版本未提供更新说明。</div>`
	if model.NotesHTML != "" {
		notes = model.NotesHTML
	}

	skipLabel := "跳过此版本"
	skipAction := "update-skip"
	if model.Skipped {
		skipLabel = "取消跳过此版本"
		skipAction = "update-unskip"
	}

	skipBlock := `<button type="button" class="quiet" data-act="` + skipAction + `">` +
		esc(skipLabel) + `</button>`

	return strings.NewReplacer(
		"__THEME_ATTR__", themeAttr,
		"__TITLE__", esc(model.Title),
		"__CURRENT__", "v"+esc(model.Current),
		"__TARGET__", "v"+esc(model.Target),
		"__TARGET_LABEL__", esc(model.TargetLabel),
		"__CHANNEL__", channel,
		"__NOTES__", notes,
		"__SKIP__", skipBlock,
		"__PRIMARY__", esc(model.PrimaryText),
	).Replace(updateDialogSrc)
}

const updateDialogSrc = `<!doctype html>
<html lang="zh-CN"__THEME_ATTR__>
<head>
<meta charset="utf-8">
<style>
/* magpie 色板，与托盘面板一致：直角、细边框、浅灰底 */
:root{
  --bg:#f4f4f6; --line:#e3e3e8; --line-2:#ececf0; --fg:#1c1c21; --fg-2:#4b4b53;
  --muted:#85858d; --card:#ffffff; --accent:#4f46e5; --accent-fg:#ffffff;
  --quota:#f1f1f4; --hover:#ececf1; --code:#f6f6f8;
}
:root[data-theme="dark"]{
  --bg:#1a1a1e; --line:#333339; --line-2:#2c2c32; --fg:#ededf1; --fg-2:#b9b9c1;
  --muted:#8b8b94; --card:#232327; --accent:#a5b4fc; --accent-fg:#191927;
  --quota:#2d2d33; --hover:#303036; --code:#1d1d21;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]):not([data-theme="dark"]){
    --bg:#1a1a1e; --line:#333339; --line-2:#2c2c32; --fg:#ededf1; --fg-2:#b9b9c1;
    --muted:#8b8b94; --card:#232327; --accent:#a5b4fc; --accent-fg:#191927;
    --quota:#2d2d33; --hover:#303036; --code:#1d1d21;
  }
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:var(--bg)}
body{
  font:12.5px/1.5 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",
       "Microsoft YaHei",system-ui,sans-serif;
  color:var(--fg);letter-spacing:-.05px;user-select:none;
  -webkit-font-smoothing:antialiased;
}
.dlg{height:100%;display:flex;flex-direction:column;border:1px solid var(--line);background:var(--bg)}
/* ── 标题栏 ── */
.hd{flex:none;display:flex;align-items:center;gap:8px;padding:13px 14px 10px;
  border-bottom:1px solid var(--line-2)}
.hd .t{font-size:14.5px;font-weight:600}
.hd .x{margin-left:auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;
  background:none;border:0;color:var(--muted);font-size:16px;line-height:1;cursor:default}
.hd .x:hover{background:var(--quota);color:var(--fg)}
/* ── 版本行 ── */
.vers{flex:none;padding:10px 14px 4px;display:flex;flex-direction:column;gap:4px}
.vers .row{display:flex;align-items:center;gap:8px;font-size:12px;min-height:20px}
.vers .k{color:var(--muted);width:64px;flex:none}
.vers .v{font-variant-numeric:tabular-nums;color:var(--fg-2)}
.vers .v.now{color:var(--fg)}
.chip{font-size:10.5px;padding:0 5px;line-height:15px;background:var(--quota);color:var(--fg-2)}
/* ── 更新说明 ── */
.sec{flex:none;display:flex;align-items:baseline;gap:8px;padding:10px 14px 6px;
  font-size:11px;color:var(--muted)}
.notes{flex:1;min-height:0;margin:0 14px 10px;padding:11px 13px;overflow-y:auto;
  background:var(--card);border:1px solid var(--line-2);
  scrollbar-width:thin;scrollbar-color:var(--line) transparent;
  font-size:12.5px;line-height:1.62;color:var(--fg-2);user-select:text}
.notes::-webkit-scrollbar{width:6px}
.notes::-webkit-scrollbar-thumb{background:var(--line)}
.notes::-webkit-scrollbar-track{background:transparent}
.notes h1,.notes h2,.notes h3,.notes h4,.notes h5,.notes h6{
  color:var(--fg);font-weight:600;line-height:1.4;margin:14px 0 6px}
.notes h1{font-size:15.5px}
.notes h2{font-size:14px}
.notes h3,.notes h4,.notes h5,.notes h6{font-size:12.8px}
.notes h1:first-child,.notes h2:first-child,.notes p:first-child,.notes ul:first-child,
.notes ol:first-child,.notes pre:first-child{margin-top:0}
.notes p{margin:0 0 7px}
.notes ul,.notes ol{margin:0 0 8px;padding-left:19px}
.notes li{margin:2px 0}
.notes code{font-family:"Cascadia Mono","Consolas",monospace;font-size:11.8px;
  background:var(--code);padding:1px 4px;color:var(--fg)}
.notes pre{margin:0 0 9px;padding:9px 11px;background:var(--code);
  border:1px solid var(--line-2);overflow-x:auto}
.notes pre code{background:none;padding:0;font-size:11.8px;white-space:pre}
.notes hr{border:0;border-top:1px solid var(--line-2);margin:12px 0}
.notes blockquote{margin:0 0 9px;padding:1px 0 1px 11px;border-left:3px solid var(--line);
  color:var(--muted)}
.notes a{color:var(--accent);text-decoration:none}
.notes a:hover{text-decoration:underline}
.notes strong{font-weight:600;color:var(--fg)}
.notes em{font-style:italic}
.notes .none{color:var(--muted)}
/* ── 按钮区 ── */
.ft{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px 13px;
  border-top:1px solid var(--line-2)}
.ft .spacer{flex:1}
.ft button{font:inherit;font-size:12px;height:30px;padding:0 14px;border:1px solid var(--line);
  background:var(--card);color:var(--fg);cursor:default;border-radius:0}
.ft button:hover{background:var(--hover)}
.ft button.pri{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);font-weight:500}
.ft button.pri:hover{filter:brightness(1.06)}
.ft button.quiet{border:0;background:none;color:var(--muted);padding:0 4px}
.ft button.quiet:hover{color:var(--fg-2);background:none}
.ft button:disabled{opacity:.5}
</style>
</head>
<body>
<div class="dlg">
  <div class="hd"><span class="t" style="--wails-draggable:drag">__TITLE__</span>
    <button type="button" class="x" data-act="update-later" title="稍后">×</button></div>
  <div class="vers">
    <div class="row"><span class="k">当前版本</span><span class="v now">__CURRENT__</span></div>
    <div class="row"><span class="k">__TARGET_LABEL__</span><span class="v">__TARGET__</span>__CHANNEL__</div>
  </div>
  <div class="sec">更新说明</div>
  <div class="notes">__NOTES__</div>
  <div class="ft">
    __SKIP__
    <span class="spacer"></span>
    <button type="button" data-act="update-later">稍后</button>
    <button type="button" class="pri" data-act="update-confirm">__PRIMARY__</button>
  </div>
</div>
<script>
(function () {
  var answered = false;
  function post(action) {
    if (answered) return;
    answered = true;
    var body = 'action=' + encodeURIComponent(action);
    try {
      fetch('/dhl-action', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body
      });
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    post(el.getAttribute('data-act'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') post('update-later');
  });
})();
</script>
</body>
</html>`

// launcherUpdateDialogModel builds the launcher dialog's model. Pulled out
// of the window code so the page contract is testable without a WebView.
func launcherUpdateDialogModel(release *launcherRelease, current, theme string, skipped bool) updateDialogModel {
	notes := ""
	if release != nil {
		notes = releaseNotesHTML(release.Notes)
	}
	target := ""
	if release != nil {
		target = release.Version
	}
	return updateDialogModel{
		Kind:        "launcher",
		Title:       "启动器更新",
		Current:     current,
		Target:      target,
		TargetLabel: "最新版本",
		NotesHTML:   notes,
		PrimaryText: "下载并安装",
		Skipped:     skipped,
		Theme:       theme,
	}
}

// dshUpdateDialogModel builds the dsh dialog's model. The dsh notes come
// from the same Markdown release body, so they render through the same
// pipeline instead of a MessageBox.
func dshUpdateDialogModel(target, label, notesMarkdown, current, theme string, skipped bool) updateDialogModel {
	title := "Deepseek Harness 更新"
	return updateDialogModel{
		Kind:        "dsh",
		Title:       title,
		Current:     current,
		Target:      target,
		TargetLabel: "可更新到",
		Channel:     label,
		NotesHTML:   releaseNotesHTML(notesMarkdown),
		PrimaryText: "立即更新",
		Skipped:     skipped,
		Theme:       theme,
	}
}

// updateDialogGeometry sizes the dialog to the work area it will land in.
// Kept pure: the machine that reported work area 1280×680 would put a
// fixed 660-high dialog under the taskbar, so the height has to derive
// from the screen it lands on.
func updateDialogGeometry(workW, workH int) (width, height int) {
	const (
		wantW = 620
		wantH = 660
		minW  = 420
		minH  = 400
	)
	width, height = wantW, wantH
	if workW > 0 && width > workW-32 {
		width = workW - 32
	}
	if workH > 0 && height > workH-48 {
		height = workH - 48
	}
	if width < minW {
		width = minW
	}
	if height < minH {
		height = minH
	}
	return width, height
}
