package app

// panelpage.go carries the tray panel: the approved prototype
// (dhl-tray-panel-proposal) implemented directly — same markup, classes,
// CSS and interaction flow, with the live model baked in server-side.
//
// Data path: the model is baked into the document before first paint
// (no binding, no race); actions travel back over POST /dhl-action; the
// host pushes fresh state over ExecJS window.__dhlPanel while open.

import (
	"fmt"
	"strings"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

const panelHTMLSrc = `<!doctype html>
<html lang="zh-CN"__THEME_ATTR__>
<head>
<meta charset="utf-8">
<style>
/* ---- magpie 色板；主题由 html[data-theme] 与系统偏好（无属性=跟随系统）驱动 ---- */
:root{
  --bg:#f4f4f6; --line:#e3e3e8; --line-2:#ececf0; --fg:#1c1c21; --fg-2:#4b4b53;
  --muted:#85858d; --faint:#b9b9c2; --ctl:#63636b; --pill:#f1f1f4; --pill-h:#e9e9ee;
  --accent:#4f46e5; --accent-soft:#eeedfd; --ok:#189a58; --bad:#d64545;
  --card:#ffffff; --hover:#ffffff; --seg:#e6e6eb;
}
:root[data-theme="dark"]{
  --bg:#1a1a1e; --line:#333339; --line-2:#2c2c32; --fg:#ededf1; --fg-2:#b9b9c1;
  --muted:#8b8b94; --faint:#56565f; --ctl:#a1a1aa; --pill:#2d2d33; --pill-h:#36363d;
  --accent:#a5b4fc; --accent-soft:#2b2c47; --ok:#6fd99b; --bad:#f28b82;
  --card:#3a3a42; --hover:#232327; --seg:rgba(255,255,255,.035);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]):not([data-theme="dark"]){
    --bg:#1a1a1e; --line:#333339; --line-2:#2c2c32; --fg:#ededf1; --fg-2:#b9b9c1;
    --muted:#8b8b94; --faint:#56565f; --ctl:#a1a1aa; --pill:#2d2d33; --pill-h:#36363d;
    --accent:#a5b4fc; --accent-soft:#2b2c47; --ok:#6fd99b; --bad:#f28b82;
    --card:#3a3a42; --hover:#232327; --seg:rgba(255,255,255,.035);
  }
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:var(--bg)}
body{
  font:12.5px/1.45 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",
       "Microsoft YaHei",system-ui,sans-serif;
  color:var(--fg);letter-spacing:-.05px;
  -webkit-font-smoothing:antialiased;user-select:none;
}
.panel{height:100%;display:flex;flex-direction:column;
  background:var(--bg);border:1px solid var(--line);border-radius:0;overflow:hidden}
/* ── 顶栏 ─────────────────────────────────────────── */
.hd{flex:none;padding:10px 13px 9px;border-bottom:1px solid var(--line-2)}
.hd .t{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;letter-spacing:.01em}
.hd .dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--faint)}
.hd .dot.on{background:var(--ok)}
.hd .tools{margin-left:auto;display:flex;gap:2px}
.hd .icon{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;
  background:transparent;border:0;border-radius:0;color:var(--muted);cursor:default;
  transition:background .12s,color .12s}
.hd .icon:hover{background:var(--pill);color:var(--fg)}
.hd .icon svg{width:15px;height:15px}
.hd .icon.spin svg{animation:dhl-spin .9s linear infinite}
@keyframes dhl-spin{to{transform:rotate(360deg)}}
.hd .st{margin-top:4px;font-size:11px;color:var(--muted);display:flex;justify-content:space-between}
.hd .ver{font-variant-numeric:tabular-nums}
/* ── 分段 tab：无灰色轨道，只有活动白块（直角） ────────────── */
.seg{flex:none;position:relative;display:flex;margin:8px 10px 0;padding:2px;background:var(--seg)}
.seg .thumb{position:absolute;top:2px;bottom:2px;width:calc((100% - 4px)/3);left:2px;
  background:var(--card);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.08);
  /* the JS moves left/width, so those are what must animate — with an
     overshoot so the thumb lands with a little spring */
  transition:left .34s cubic-bezier(.34,1.56,.64,1),
             width .34s cubic-bezier(.34,1.56,.64,1)}
.seg button{position:relative;z-index:1;flex:1;height:26px;background:none;border:0;
  border-radius:0;font-size:12.5px;color:var(--ctl);cursor:default;
  transition:color .15s,transform .18s cubic-bezier(.34,1.56,.64,1)}
.seg button:active{transform:scale(.94)}
.seg button.on{color:var(--fg);font-weight:500}
.seg button:hover:not(.on){color:var(--fg-2)}
.seg .count{margin-left:5px;padding:0 4px;font-size:10px;line-height:15px;color:#fff;background:var(--bad)}
.seg .hasdot{position:absolute;top:4px;right:6px;width:5px;height:5px;border-radius:50%;background:var(--accent)}
/* ── 内容区 ───────────────────────────────────────── */
.body{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--faint) transparent}
.body::-webkit-scrollbar{width:6px}
.body::-webkit-scrollbar-button{display:none;height:0;width:0}
.body::-webkit-scrollbar-track{background:transparent}
.body::-webkit-scrollbar-thumb{background:var(--line)}
.body::-webkit-scrollbar-thumb:hover{background:var(--faint)}
.pane{padding:4px 13px 8px;animation:dhl-pane-in .22s ease both}
@keyframes dhl-pane-in{from{opacity:.4;transform:translateY(3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.seg .thumb,.seg button,.pane{transition:none;animation:none}}
.sec{padding:12px 0 6px;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:8px}
.pane .sec:first-child{padding-top:6px}
.sec .n{color:var(--bad)}
.linkbtn{margin-left:auto;background:none;border:0;padding:0;font-size:11px;color:var(--accent);cursor:default}
.linkbtn:hover{color:var(--fg)}
.actbtn{background:none;border:0;padding:0;font-size:11px;color:var(--accent);cursor:default}
.actbtn:hover{color:var(--fg)}
/* 会话行（可点：打开并清除该条提醒） */
.row{display:flex;align-items:center;gap:8px;width:100%;height:32px;
  background:none;border:0;border-bottom:1px solid var(--line-2);border-radius:0;
  font-size:12px;color:var(--fg);text-align:left;padding:0 2px;cursor:default}
.row:hover{background:var(--hover)}
.row.read{color:var(--muted)}
.row.read .rdot{background:transparent;box-shadow:inset 0 0 0 1px var(--faint)}
.rdot{width:6px;height:6px;border-radius:50%;flex:none}
.rdot.ok{background:var(--ok)}
.rdot.bad{background:var(--bad)}
.tm{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;flex:none}
.nm{flex:1;min-width:0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs{font-size:11px;color:var(--muted);flex:none}
.go{display:none;font-size:10px;color:var(--accent);font-weight:500;flex:none}
.row:hover .go{display:inline}
.row:hover .rs{display:none}
.empty{padding:26px 10px;text-align:center;font-size:11px;color:var(--muted)}
/* 更新行（可点展开说明） */
.urow{display:flex;flex-direction:column;gap:0;width:100%;padding:8px 2px;
  background:none;border:0;border-bottom:1px solid var(--line-2);border-radius:0;
  font-size:12px;color:var(--fg);text-align:left;cursor:default}
.urow:hover{background:var(--hover)}
.uhead{display:flex;justify-content:space-between;align-items:center}
.unote{margin-top:5px;font-size:11px;line-height:1.5;color:var(--fg-2)}
.pill{font-size:10px;padding:1px 6px;color:var(--accent);background:var(--accent-soft)}
.muted{font-size:11px;color:var(--muted)}
/* 设置行 */
.setrow{display:flex;align-items:center;justify-content:space-between;gap:10px;
  min-height:36px;border-bottom:1px solid var(--line-2);font-size:12px}
.setlabel{min-width:0}
.host{display:block;font-size:10.5px;color:var(--muted);margin-top:1px}
/* magpie 开关（轨道全圆是开关本身的形态，不属于框） */
.sw{position:relative;flex:none;width:32px;height:19px;border-radius:10px;
  background:var(--line);border:0;padding:0;cursor:default;transition:background .2s}
.sw::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;
  border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);
  transition:transform .22s}
.sw.on{background:var(--fg)}
.sw.on::after{transform:translateX(13px)}
:root[data-theme="dark"] .sw.on::after{background:var(--bg)}
/* 步进器 / 主题分段 */
.step{display:inline-flex;align-items:center;gap:2px}
.step .stbtn{width:22px;height:22px;background:var(--pill);border:0;border-radius:0;
  color:var(--fg-2);font-size:13px;line-height:1;cursor:default}
.step .stbtn:hover{background:var(--pill-h);color:var(--fg)}
.step .val{min-width:64px;text-align:center;font-size:11.5px;color:var(--fg-2)}
.themeseg{display:inline-flex;border:1px solid var(--line)}
.themeseg button{background:none;border:0;border-right:1px solid var(--line);
  padding:4px 9px;font-size:11px;color:var(--ctl);cursor:default}
.themeseg button:last-child{border-right:0}
.themeseg button[aria-checked="true"]{background:var(--card);color:var(--fg);
  font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.12)}
/* ── 页脚 ─────────────────────────────────────────── */
.ft{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:7px 13px 8px;border-top:1px solid var(--line-2)}
.stamp{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.acts{display:flex;align-items:center;gap:16px;flex:none}
.act{background:none;border:0;padding:2px 0;font-size:12px;color:var(--ctl);
  border-radius:0;cursor:default;white-space:nowrap}
.act:hover{color:var(--fg)}
.act.primary{color:var(--fg);font-weight:500}
.act.confirm{color:var(--bad);font-weight:500}
</style>
</head>
<body>
<div class="panel">
  <div class="hd">
    <div class="t"><span class="dot__DOT_ON__"></span>Deepseek Harness Launcher
      <span class="tools">
        <button type="button" class="icon" id="refreshBtn" data-refresh aria-label="刷新信息" data-tooltip="刷新信息"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5V5h-2.5"/></svg></button>
        <button type="button" class="icon" id="themeBtn" aria-label="切换白天夜间" data-tooltip="白天 / 夜晚">__THEME_ICON__</button>
      </span>
    </div>
    <div class="st"><span id="status">__STATUS__</span><span class="ver" id="ver">__VER__</span></div>
  </div>
  <div class="seg" role="tablist" aria-label="面板分区">
    <span class="thumb" id="thumb"></span>
    <button type="button" class="on" id="tab1" role="tab" aria-controls="pane1" aria-selected="true" data-tab="1">会话__UNREAD_BADGE_SPAN__</button>
    <button type="button" id="tab2" role="tab" aria-controls="pane2" aria-selected="false" data-tab="2">更新<span class="hasdot" id="updDot" style="__UPD_DOT_STYLE__"></span></button>
    <button type="button" id="tab3" role="tab" aria-controls="pane3" aria-selected="false" data-tab="3">设置</button>
  </div>
  <div class="body" id="body">
    <div class="pane" id="pane1" role="tabpanel">
      <div class="sec"><span>会话记录</span><span class="n" id="unreadLabel" style="__UNREAD_LABEL_STYLE__">__UNREAD_LABEL__</span>__CLEAR_BTN__</div>
      <div id="sessions">__SESSIONS__</div>
    </div>
    <div class="pane" id="pane2" role="tabpanel" hidden>
      <div class="sec"><span>可用更新</span><button type="button" class="linkbtn" id="checkNow">立即检查</button></div>
      __UPDROWS__
      <div class="sec">更新设置</div>
      <div class="setrow"><span class="setlabel">自动检查更新</span><button type="button" class="sw__SW_AUTOCHK__" role="switch" aria-checked="__SW_AUTOCHK_ARIA__" data-key="autoCheckUpdates"></button></div>
      <div class="setrow"><span class="setlabel">检查频率</span><span class="step"><button type="button" class="stbtn" data-step="-1" aria-label="减小">−</button><span class="val" id="freq">__FREQ__</span><button type="button" class="stbtn" data-step="1" aria-label="增大">＋</button></span></div>
      <div class="setrow"><span class="setlabel">自动下载并安装更新</span><button type="button" class="sw__SW_AUTOUPD__" role="switch" aria-checked="__SW_AUTOUPD_ARIA__" data-key="autoUpdate"></button></div>
      <div class="setrow"><span class="setlabel">国内镜像源<span class="host">registry.npmmirror.com</span></span><button type="button" class="sw__SW_MIRROR__" role="switch" aria-checked="__SW_MIRROR_ARIA__" data-key="mirror"></button></div>
    </div>
    <div class="pane" id="pane3" role="tabpanel" hidden>
      <div class="sec">外观</div>
      <div class="setrow"><span class="setlabel">主题</span><span class="themeseg" role="radiogroup" aria-label="主题">__THEME_SEG__</span></div>
      <div class="sec">启动</div>
      <div class="setrow"><span class="setlabel">登录 Windows 时自动启动</span><button type="button" class="sw__SW_AUTOSTART__" role="switch" aria-checked="__SW_AUTOSTART_ARIA__" data-key="launchAtLogin"></button></div>
      <div class="setrow"><span class="setlabel">就绪后自动打开主窗口</span><button type="button" class="sw__SW_OPENREADY__" role="switch" aria-checked="__SW_OPENREADY_ARIA__" data-key="openOnReady"></button></div>
      <div class="sec">提醒</div>
      <div class="setrow"><span class="setlabel">会话完成时弹出通知</span><button type="button" class="sw__SW_NOTIFY__" role="switch" aria-checked="__SW_NOTIFY_ARIA__" data-key="notifyOnComplete"></button></div>
      <div class="sec">关于</div>
      <div class="setrow"><span class="setlabel">Deepseek Harness Launcher</span><span class="muted">__VER__</span></div>
    </div>
  </div>
  <div class="ft">
    <span class="stamp" id="stamp" role="status" aria-live="polite">刚刚更新</span>
    <span class="acts">
      <button type="button" class="act primary" id="openBtn" data-act="open">打开主窗口</button>
      <button type="button" class="act" id="restartBtn" data-act="restart">重启</button>
      <button type="button" class="act" data-act="quit">退出</button>
    </span>
  </div>
</div>
<script>
window.addEventListener('error', function (e) {
  const b = document.getElementById('body');
  if (b) b.textContent = 'script error: ' + (e.message || e);
});
let unread = __UNREAD_COUNT__;

// 面板的按钮走 HTTP 回调：页面由自定义 handler 提供，拿不到 Wails 的
// window.go 运行时对象，用绑定就会抛错。
function post(action, params) {
  const body = new URLSearchParams(params || {});
  body.set('action', action);
  return fetch('/dhl-action', { method: 'POST', body: body })
    .then(function (r) { return r.json(); })
    .catch(function () { return null; });
}

// 宿主推新鲜状态（ExecJS）：只更新动态部位，保留 tab/展开/确认状态。
window.__dhlPanel = function (next) {
  if (!next) return;
  // The badge/label elements only exist while something is unread, so a
  // push that clears the count must not assume they are in the DOM.
  const badge = document.getElementById('unreadBadge');
  const label = document.getElementById('unreadLabel');
  const n = next.unreadAll || 0;
  if (badge) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = n > 0 ? '' : 'none';
  }
  if (label) {
    label.textContent = n > 0 ? '未读 ' + n : '';
    label.style.display = n > 0 ? '' : 'none';
  }
  const list = document.getElementById('sessions');
  if (list && next.sessions) list.innerHTML = sessionsHTML(next.sessions);
  const la = next.launcher || {}, ds = next.dsh || {}, pl = next.plugins || 0;
  const pending = !!(la.pending || ds.pending) || pl > 0;
  document.getElementById('updDot').style.display = pending ? '' : 'none';
};

// 与 Go 侧 session.ReasonLabel 一致的措辞
const REASONS = {
  'completed': '已完成', 'error': '出错', 'aborted': '已中止',
  'max-tokens': '达到 token 上限', 'blocked': '被阻塞'
};
function reasonLabel(r) { return REASONS[r] || '已结束'; }
function isBadReason(r) { return r === 'error' || r === 'blocked' || r === 'max-tokens'; }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sessionsHTML(rows) {
  let h = '';
  for (const r of rows) {
    const bad = isBadReason(r.reason);
    h += '<div class="row' + (r.unread ? '' : ' read') + '" data-sid="' + esc(r.id) + '" data-unread="' + (r.unread ? '1' : '0') + '">' +
      '<span class="rdot ' + (bad ? 'bad' : 'ok') + '"></span>' +
      '<span class="tm">' + timeLabel(r.at) + '</span>' +
      '<span class="nm" title="' + esc(r.label) + '">' + esc(r.label || '') + '</span>' +
      '<span class="rs">' + esc(reasonLabel(r.reason)) + '</span></div>';
  }
  if (!rows.length) h = '<div class="empty">没有会话记录</div>';
  return h;
}

function timeLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() &&
                  d.getMonth() === now.getMonth() &&
                  d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return hh + ':' + mm;
  return String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0') + ' ' + hh + ':' + mm;
}

function sessionsHTML(rows) {
  let h = '';
  for (const r of rows) {
    const bad = isBadReason(r.reason);
    h += '<div class="row' + (r.unread ? '' : ' read') + '" data-sid="' + esc(r.id) + '" data-unread="' + (r.unread ? '1' : '0') + '">' +
      '<span class="rdot ' + (bad ? 'bad' : 'ok') + '"></span>' +
      '<span class="tm">' + timeLabel(r.at) + '</span>' +
      '<span class="nm" title="' + esc(r.label) + '">' + esc(r.label || '') + '</span>' +
      '<span class="rs">' + esc(reasonLabel(r.reason)) + '</span></div>';
  }
  if (!rows.length) h = '<div class="empty">没有会话记录</div>';
  return h;
}

/* ── 交互 ─────────────────────────────────────────── */
let stampTimer = null;
function say(text) {
  const st = document.getElementById('stamp');
  st.textContent = text;
  clearTimeout(stampTimer);
  stampTimer = setTimeout(function () { st.textContent = '刚刚更新'; }, 2200);
}

let restartArmed = false, restartTimer = null;
// 运行状态看的是标题栏那个状态点：它是 <span class="dot on">，没有 id
// （之前按 id 取，取到 null 就抛异常，重启按钮点了完全没反应）。
function isRunning() {
  const d = document.querySelector('.hd .dot');
  return !!(d && d.classList.contains('on'));
}
function doRestart(btn) {
  const running = isRunning();
  if (running && !restartArmed) {
    restartArmed = true;
    btn.classList.add('confirm');
    btn.textContent = '确认重启？';
    say('再次点击以确认重启');
    restartTimer = setTimeout(function () { resetRestart(btn); }, 2600);
    return;
  }
  resetRestart(btn);
  if (running) say('正在重启 DeepSeek Harness…');
  post('act', { id: 'restart' });
}
function resetRestart(btn) {
  restartArmed = false;
  clearTimeout(restartTimer);
  if (btn) { btn.classList.remove('confirm'); btn.textContent = '重启'; }
}

/* 主题：跟随系统 / 白天 / 夜晚（html 属性 + 设置持久化） */
function applyTheme(mode) {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  document.querySelectorAll('[data-theme-set]').forEach(function (b) {
    b.setAttribute('aria-checked', b.getAttribute('data-theme-set') === mode ? 'true' : 'false');
  });
  const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.getElementById('themeBtn').innerHTML =
    '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    (dark ? '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"/>'
          : '<path d="M12.8 9.5A5.2 5.2 0 0 1 6.5 3.2a5.2 5.2 0 1 0 6.3 6.3z"/>') +
    '</svg>';
}
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'system';
}
function toggleTheme() {
  const dark = currentTheme() === 'dark' ||
    (currentTheme() === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  say(next === 'dark' ? '已切换到夜晚' : '已切换到白天');
  post('theme', { id: next });
}
function setTheme(mode) {
  applyTheme(mode);
  say('主题：' + (mode === 'system' ? '跟随系统' : mode === 'light' ? '白天' : '夜晚'));
  post('theme', { id: mode });
}

/* 刷新：真正触发一轮检查（无 toast），图标转一圈 */
function doRefresh(btn) {
  if (btn.classList.contains('spin')) return;
  btn.classList.add('spin');
  say('正在刷新…');
  post('refresh', {}).then(function () {
    btn.classList.remove('spin');
    const d = new Date();
    say('更新于 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
  });
}

/* 开关：乐观切换 + 服务端确认回弹 */
function toggleSw(el) {
  const key = el.getAttribute('data-key');
  const on = !el.classList.contains('on');
  el.classList.toggle('on', on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
  say(key + '：' + (on ? '开' : '关'));
  post('sw', { key: key, on: on ? '1' : '0' }).then(function (resp) {
    if (resp && typeof resp.on === 'boolean') {
      el.classList.toggle('on', resp.on);
      el.setAttribute('aria-checked', resp.on ? 'true' : 'false');
    }
  });
}

/* 频率步进：服务端计算新档位 */
const FREQS = [1, 3, 6, 12, 24, 48];
function stepFreq(dir) {
  post('freq', { dir: dir }).then(function (resp) {
    if (resp && resp.hours) {
      const h = resp.hours % 1 === 0 ? resp.hours : resp.hours.toFixed(1);
      document.getElementById('freq').textContent = '每 ' + h + ' 小时';
      say('检查频率：每 ' + h + ' 小时');
    }
  });
}

/* 事件委托：一次绑定，行内容重绘后依然有效 */
document.addEventListener('click', function (e) {
  const t = e.target;
  let el;
  if ((el = t.closest('[data-tab]'))) {
    document.querySelectorAll('.seg [data-tab]').forEach(function (b) {
      const on = b === el;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        const th = document.getElementById('thumb');
        th.style.left = (b.offsetLeft - 2) + 'px';
        th.style.width = b.offsetWidth + 'px';
      }
    });
    document.querySelectorAll('.pane').forEach(function (p) {
      p.hidden = p.id !== 'pane' + el.getAttribute('data-tab');
    });
    return;
  }
  if ((el = t.closest('#themeBtn'))) { toggleTheme(); return; }
  if ((el = t.closest('[data-theme-set]'))) { setTheme(el.getAttribute('data-theme-set')); return; }
  if ((el = t.closest('[data-refresh]'))) { doRefresh(el); return; }
  if ((el = t.closest('.sw'))) { toggleSw(el); return; }
  if ((el = t.closest('[data-step]'))) { stepFreq(el.getAttribute('data-step')); return; }
  if ((el = t.closest('#clearAll'))) {
    post('act', { id: 'clear-unread' }).then(function () { say('已清除完成提醒'); });
    return;
  }
  if ((el = t.closest('#checkNow'))) {
    say('正在检查更新…');
    post('act', { id: 'check-updates' }).then(function () { say('检查完成'); });
    return;
  }
  if ((el = t.closest('[data-jump]'))) { post('jump', { id: el.getAttribute('data-jump') }); return; }
  if ((el = t.closest('#openBtn'))) { post('act', { id: 'open' }); return; }
  if ((el = t.closest('#restartBtn'))) { doRestart(el); return; }
  if ((el = t.closest('[data-act="quit"]'))) { post('act', { id: 'quit' }); return; }
  // 更新行按钮：之前没有任何处理器，点了没反应（更新 tab 的全部动作）。
  if ((el = t.closest('[data-act="update-launcher"]'))) {
    say('正在检查启动器更新…');
    post('act', { id: 'update-launcher' });
    return;
  }
  if ((el = t.closest('[data-act="update-dsh"]'))) {
    say('正在检查 DeepSeek Harness 更新…');
    post('act', { id: 'update-dsh' });
    return;
  }
  if ((el = t.closest('[data-act="open"]'))) { post('act', { id: 'open' }); return; }
  if ((el = t.closest('[data-expand]'))) {
    const id = el.getAttribute('data-expand');
    const note = el.querySelector('.unote');
    if (note) note.hidden = !note.hidden;
    return;
  }
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') post('hide', {});
});
</script>
</body>
</html>`

// panelHTML bakes the live model into the approved prototype page.
func panelHTML(model panelModel) string {
	dotOn := ""
	if model.Running {
		dotOn = " on"
	}
	theme := model.Settings.Theme
	if theme == "" {
		theme = "system"
	}
	themeAttr := ""
	themeIcon := moonSVG()
	if theme == "dark" {
		themeAttr = ` data-theme="dark"`
		themeIcon = sunSVG()
	} else if theme == "light" {
		themeAttr = ` data-theme="light"`
	}

	unread := model.UnreadAll
	// With nothing unread the badge element is omitted entirely: an empty
	// span with a red background still paints a red block, which reads as
	// "there is something unread" when there is not.
	badgeSpan := ""
	if unread > 0 {
		badgeSpan = `<span class="count" id="unreadBadge">` + session.BadgeText(unread) + `</span>`
	}
	unreadLabel, unreadLabelStyle := "", "display:none"
	if unread > 0 {
		unreadLabel = fmt.Sprintf("未读 %d", unread)
	}
	clearBtn := ""
	if unread > 0 {
		clearBtn = `<button type="button" class="linkbtn" id="clearAll">清除完成提醒</button>`
	}
	updDot := "display:none"
	if model.Launcher.Pending != "" || model.DSH.Pending != "" || model.Plugins > 0 {
		updDot = ""
	}

	return strings.NewReplacer(
		"__THEME_ATTR__", themeAttr,
		"__THEME_ICON__", themeIcon,
		"__DOT_ON__", dotOn,
		"__STATUS__", esc(model.Status),
		"__VER__", "v"+esc(model.Version),
		"__UNREAD_BADGE_SPAN__", badgeSpan,
		"__UNREAD_LABEL__", unreadLabel,
		"__UNREAD_LABEL_STYLE__", unreadLabelStyle,
		"__CLEAR_BTN__", clearBtn,
		"__UNREAD_COUNT__", fmt.Sprint(unread),
		"__SESSIONS__", sessionsHTML(model.Sessions),
		"__UPD_DOT_STYLE__", updDot,
		"__UPDROWS__", updateRowsHTML(model),
		"__FREQ__", fmt.Sprintf("每 %s 小时", fmtHours(model.Settings.Freq)),
		"__SW_AUTOCHK__", swOn(model.Settings.AutoCheckUpdates),
		"__SW_AUTOCHK_ARIA__", aria(model.Settings.AutoCheckUpdates),
		"__SW_AUTOUPD__", swOn(model.Settings.AutoUpdate),
		"__SW_AUTOUPD_ARIA__", aria(model.Settings.AutoUpdate),
		"__SW_MIRROR__", swOn(model.Settings.Mirror),
		"__SW_MIRROR_ARIA__", aria(model.Settings.Mirror),
		"__SW_OPENREADY__", swOn(model.Settings.OpenOnReady),
		"__SW_OPENREADY_ARIA__", aria(model.Settings.OpenOnReady),
		"__SW_NOTIFY__", swOn(model.Settings.NotifyOnComplete),
		"__SW_NOTIFY_ARIA__", aria(model.Settings.NotifyOnComplete),
		"__SW_AUTOSTART__", swOn(model.Settings.LaunchAtLogin),
		"__SW_AUTOSTART_ARIA__", aria(model.Settings.LaunchAtLogin),
		"__THEME_SEG__", themeSegHTML(model.Settings.Theme),
	).Replace(panelHTMLSrc)
}

// esc escapes a plain-text value for interpolation into the page's HTML.
func esc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return strings.ReplaceAll(s, `"`, "&quot;")
}

func swOn(on bool) string {
	if on {
		return " on"
	}
	return ""
}

func aria(on bool) string {
	if on {
		return "true"
	}
	return "false"
}

func moonSVG() string {
	return `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 9.5A5.2 5.2 0 0 1 6.5 3.2a5.2 5.2 0 1 0 6.3 6.3z"/></svg>`
}

func sunSVG() string {
	return `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.6"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"/></svg>`
}

func themeSegHTML(cur string) string {
	b := func(mode, label string) string {
		on := ""
		if cur == mode || (cur == "" && mode == "system") {
			on = ` aria-checked="true"`
		} else {
			on = ` aria-checked="false"`
		}
		return `<button type="button" role="radio` + `"` + on + ` data-theme-set="` + mode + `">` + label + `</button>`
	}
	return b("system", "跟随系统") + b("light", "白天") + b("dark", "夜晚")
}

// sessionsHTML renders the 会话 rows (the approved prototype's markup).
func sessionsHTML(rows []sessionRow) string {
	var b strings.Builder
	for _, r := range rows {
		bad := r.Reason == "error" || r.Reason == "blocked" || r.Reason == "max-tokens"
		dot := "ok"
		if bad {
			dot = "bad"
		}
		read := ""
		if !r.Unread {
			read = " read"
		}
		b.WriteString(`<div class="row` + read + `" data-sid="` + esc(r.SessionID) +
			`" data-unread="` + boolOn(r.Unread) + `">` +
			`<span class="rdot ` + dot + `"></span>` +
			`<span class="tm">` + session.TimeLabel(r.AtMillis, time.Now()) + `</span>` +
			`<span class="nm" title="` + esc(r.Label) + `">` + esc(r.Label) + `</span>` +
			`<span class="rs">` + esc(session.ReasonLabel(r.Reason)) + `</span></div>`)
	}
	if b.Len() == 0 {
		return `<div class="empty">没有会话记录</div>`
	}
	return b.String()
}

func boolOn(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

// updateRowsHTML renders the three update rows (the prototype's markup).
func updateRowsHTML(model panelModel) string {
	la := model.Launcher
	ds := model.DSH
	plugins := model.Plugins

	laSub := "当前 v" + orDash(la.Current)
	laPill, laNote := "", ""
	if la.Pending != "" {
		laPill = "v" + la.Pending
		laNote = "可更新到 v" + la.Pending + "，安装期间启动器会重启。"
	} else {
		laNote = "当前已是最新版本。"
	}
	laRow := updateRowHTML("launcher", "启动器更新", laSub, laPill, laNote)
	dsSub := "当前 "
	if ds.Current != "" {
		dsSub += "v" + ds.Current
	} else {
		dsSub += "未检测"
	}
	if ds.Pending != "" {
		if ds.Label != "" {
			dsSub += "，可更新到 v" + ds.Pending + "（" + ds.Label + "）"
		} else {
			dsSub += "，可更新到 v" + ds.Pending
		}
	}
	dsPill, dsNote := "", ""
	if ds.Pending != "" {
		dsPill = "v" + ds.Pending
	}
	dsRow := updateRowHTML("dsh", "Deepseek Harness 更新", dsSub, dsPill, dsNote)
	plSub := "插件已是最新。"
	plPill := ""
	if plugins > 0 {
		plSub = fmt.Sprintf("%d 个插件有更新，在 Harness 的插件管理里处理。", plugins)
		plPill = fmt.Sprintf("%d 个", plugins)
	}
	plRow := updateRowHTML("plugins", "插件更新", plSub, plPill, "")
	return laRow + dsRow + plRow
}

func updateRowHTML(id, title, sub string, pill, note string) string {
	head := `<span class="uhead"><span>` + esc(title) + `</span>`
	if pill != "" {
		head += `<span class="pill">` + esc(pill) + `</span>`
	}
	head += `</span>`
	action := ""
	switch id {
	case "launcher":
		if pill != "" {
			action = ` <button type="button" class="actbtn" data-act="update-launcher">下载并安装</button>`
		}
	case "dsh":
		if pill != "" {
			action = ` <button type="button" class="actbtn" data-act="update-dsh">更新</button>`
		}
	case "plugins":
		if pill != "" {
			action = ` <button type="button" class="actbtn" data-act="open">打开 Harness</button>`
		}
	}
	body := `<span class="unote" hidden>` + esc(sub) + note + action + `</span>`
	return `<div class="urow" data-expand="` + id + `" role="button">` + head + body + `</div>`
}

func fmtHours(h float64) string {
	if h == float64(int(h)) {
		return fmt.Sprint(int(h))
	}
	return fmt.Sprintf("%.1f", h)
}

func orDash(v string) string {
	if v == "" {
		return "—"
	}
	return v
}
