// 原型复刻（fidelity）：把 plugin-center-restyle-prototype.html 的组件样式逐字搬进
// DSHPluginManager/client/client.js。不再意译：
//   1. 配色：面板 accent 换成原型的靛蓝 #4f46e5（含 accent-fg）
//   2. AI 搜索条：原型 aibar 的常态流光描边（锥形渐变 + 白色彗头，只描边不填充），
//      外层容器去掉重复的底/边框
//   3. 安装按钮：原型 act.get（accent-soft 底 + accent 字，hover 实心）；busy 用双环
//   4. 已安装：纯绿字（act.done）
//   5. 详情浮窗：原型 drawer 的精确样式（360px / r12 / shadow-pop / 四段分隔线），
//      标题行内联「· 作者 · 分类」（原型同款）
// 运行：node scripts/patch-prototype-fidelity.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js')
let source = fs.readFileSync(CLIENT, 'utf8')
let n = 0
const rep = (oldStr, newStr, msg) => {
  if (!source.includes(oldStr)) { console.error('FAIL(锚点缺失): ' + msg); process.exit(1) }
  source = source.split(oldStr).join(newStr)
  n++
}

// ── 1. 配色：accent 换成原型靛蓝 ──
rep('--pm-accent:#3b82f6;--pm-accent-fg:#ffffff;', '--pm-accent:#4f46e5;--pm-accent-fg:#ffffff;', '面板 accent')

// ── 2. AI 搜索条：aibar 流光描边（原型逐字）──
// 2a. 外层容器去掉重复的底/边框（原型里 aibar 直接坐在页面上）
rep(
  ".dsh-pm-ai{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;flex-direction:column;gap:12px;padding:16px 18px}",
  ".dsh-pm-ai{background:none;border:0;border-radius:0;box-shadow:none;display:flex;flex-direction:column;gap:12px;padding:0}",
  'AI 外层容器')
// 2b. 搜索条本体：pill 底 + r10 + 52px + 相对定位（流光的包含块）
rep(
  ".dsh-pm-ai-bar{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 1px 2px rgba(15,17,21,.04);color:var(--dsw-alias-label-tertiary);cursor:text;display:flex;flex:0 0 auto;gap:11p",
  ".dsh-pm-ai-bar{align-items:center;background:var(--dsw-alias-bg-layer-2);border-radius:10px;color:var(--dsw-alias-label-tertiary);cursor:text;display:flex;flex:0 0 auto;gap:11p",
  'AI 搜索条本体（前半）')
// 2c. hover/focus：原型口径（focus = 白底 + accent 双环光晕）
rep(
  ".dsh-pm-ai-bar:hover{border-color:color-mix(in srgb,var(--fg) 18%,var(--dsw-alias-border-l2))}",
  ".dsh-pm-ai-bar:hover{border-color:transparent}",
  'AI 搜索条 hover')
rep(
  ".dsh-pm-ai-bar:focus-within{background:var(--dsw-alias-bg-layer-1);border-color:var(--pm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-accent) 13%,transparent)}",
  ".dsh-pm-ai-bar:focus-within{background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-accent) 22%,transparent),0 0 16px color-mix(in srgb,var(--pm-accent) 18%,transparent)}",
  'AI 搜索条 focus')
// 2d. 流光描边 + @property + keyframes：追加到 css 末尾
const cssEnd = source.indexOf('\n}`', source.indexOf('const css = `'))
if (cssEnd < 0) { console.error('FAIL: css 结束未找到'); process.exit(1) }
const sweepCss = `
/* ── 原型复刻：AI 搜索条常态流光描边（锥形渐变 + 白色彗头，只描边不填充）── */
@property --aib-ang{syntax:"<angle>";inherits:false;initial-value:0deg}
@keyframes aib-sweep{to{--aib-ang:360deg}}
.dsh-pm-ai-bar::before{animation:aib-sweep 3.4s linear infinite;background:conic-gradient(from var(--aib-ang,0deg),transparent 0deg,color-mix(in srgb,var(--pm-accent) 65%,transparent) 24deg,var(--pm-accent) 48deg,#fff 58deg,var(--pm-accent) 68deg,color-mix(in srgb,var(--pm-accent) 55%,transparent) 95deg,transparent 135deg,transparent 250deg,color-mix(in srgb,var(--pm-accent) 60%,transparent) 296deg,color-mix(in srgb,var(--pm-accent) 30%,transparent) 330deg,transparent 350deg);border-radius:inherit;content:"";inset:0;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;padding:2px;pointer-events:none;position:absolute}
`
source = source.slice(0, cssEnd) + sweepCss + source.slice(cssEnd)
n++

// ── 3. 安装按钮：原型 act.get（accent-soft 底 + accent 字，hover 实心）；busy 双环 ──
// 3a. 三态共用的几何：r13 胶囊、无固定宽度（原型 act 口径）
rep(
  ".dsh-pm-install,.dsh-pm-installed-tag{align-items:center;border-radius:7px;box-sizing:border-box;display:inline-flex;flex:none;font:inherit;font-size:11.5px;font-weight:600;gap:5px;height:26px;justify-content:center;line-height:1;white-space:nowrap;width:68px;",
  ".dsh-pm-install,.dsh-pm-installed-tag{align-items:center;border-radius:13px;box-sizing:border-box;display:inline-flex;flex:none;font:inherit;font-size:12px;font-weight:600;gap:5px;height:26px;justify-content:center;line-height:1;min-width:64px;white-space:nowrap;",
  '安装按钮几何')
// 3b. 安装态：accent-soft 底 + accent 字（原型 act.get）
rep(
  ".dsh-pm-install{background:transparent;border:1px solid color-mix(in srgb,var(--pm-accent) 55%,var(--dsw-alias-border-l2));color:var(--pm-accent);cursor:pointer;transition:background .14s ease,border-color .14s ease,color .14s ease}",
  ".dsh-pm-install{background:var(--pm-accent-soft,#eeedfd);border:0;color:var(--pm-accent);cursor:pointer;transition:background .14s cubic-bezier(.2,.8,.2,1),color .14s cubic-bezier(.2,.8,.2,1)}",
  '安装态底色')
rep(
  ".dsh-pm-install:hover:not(:disabled){background:color-mix(in srgb,var(--pm-accent) 10%,transparent);border-color:var(--pm-accent)}",
  ".dsh-pm-install:hover:not(:disabled){background:var(--pm-accent);color:#fff}",
  '安装态 hover')
rep(
  ".dsh-pm-install:active:not(:disabled){background:color-mix(in srgb,var(--pm-accent) 18%,transparent)}",
  ".dsh-pm-install:active:not(:disabled){background:color-mix(in srgb,var(--pm-accent) 88%,#000)}",
  '安装态 active')
rep(
  ".dsh-pm-install.busy{background:color-mix(in srgb,var(--pm-accent) 8%,transparent);border-color:color-mix(in srgb,var(--pm-accent) 25%,var(--dsw-alias-border-l2));color:var(--dsw-alias-label-secondary);cursor:default}",
  ".dsh-pm-install.busy{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);cursor:default}",
  'busy 底色')
// 3c. busy 转圈：双环（原型 .dual）
rep("h('span', { className: 'spin', 'aria-hidden': true })", "h('span', { className: 'dual', 'aria-hidden': true })", 'busy 双环')
rep(
  ".dsh-pm-install .spin::after{animation:none;border-top-color:transparent;border-right-color:transparent}",
  ".dsh-pm-install .dual::after{animation:dsh-pm-spin .7s linear infinite;border-top-color:transparent;border-right-color:transparent}",
  '双环旋转')
rep(
  ".dsh-pm-install .spin{animation:dsh-pm-spin .7s linear infinite;display:inline-block;height:12px;position:relative;width:12px}",
  ".dsh-pm-install .dual{display:inline-block;height:12px;position:relative;width:12px}",
  '双环容器')

// ── 4. 已安装：纯绿字（原型 act.done）──
rep(
  ".dsh-pm-installed-tag{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,transparent);color:var(--dsw-alias-state-success-primary)}",
  ".dsh-pm-installed-tag{background:none;border:0;color:var(--dsw-alias-state-success-primary);min-width:0;padding:0 8px}",
  '已安装纯绿字')

// ── 5. 详情浮窗：原型 drawer 精确样式 ──
rep(
  ".dsh-pm-drawer{background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-sizing:border-box;display:flex;flex-direction:column;height:100%;max-width:420px;min-width:300px;padding:18px;position:absolute;right:0;top:0;width:40%;z-index:2147483002}",
  ".dsh-pm-mask{background:rgba(20,22,30,.18);inset:0;position:absolute;z-index:2147483001}\n.dsh-pm-drawer{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 44px rgba(20,22,30,.16),0 2px 8px rgba(20,22,30,.06),0 0 0 .5px rgba(20,22,30,.1);box-sizing:border-box;display:flex;flex-direction:column;height:auto;left:50%;max-height:calc(100% - 24px);overflow:auto;padding:0;position:absolute;top:50%;transform:translate(-50%,-50%);width:360px;z-index:2147483002}",
  '浮窗容器')
rep(
  ".dsh-pm-drawer-title{font-size:16px;font-weight:600;line-height:22px}",
  ".dsh-pm-drawer-title{font-size:14.5px;font-weight:650;line-height:1.3}",
  '浮窗标题')
rep(
  ".dsh-pm-drawer-close{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px;height:28px;line-height:24px;width:28px}",
  ".dsh-pm-drawer-close{background:none;border:0;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:15px;height:26px;width:26px}",
  '浮窗关闭')
rep(
  ".dsh-pm-drawer-close:hover{background:var(--dsw-alias-button-ghost-active-fill)}",
  ".dsh-pm-drawer-close:hover{background:var(--dsw-alias-bg-layer-2)}",
  '浮窗关闭 hover')
rep(
  ".dsh-pm-drawer-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:6px}",
  ".dsh-pm-drawer-meta{color:var(--dsw-alias-label-tertiary);display:inline;font-size:11.5px;font-weight:400}",
  '浮窗 meta 行内')
rep(
  ".dsh-pm-drawer-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:14px 0}",
  ".dsh-pm-drawer-desc{border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0;padding:11px 16px}",
  '浮窗描述段')
rep(
  ".dsh-pm-drawer-stats{display:flex;gap:14px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
  ".dsh-pm-drawer-stats{border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;line-height:18px;margin:0;padding:9px 16px}",
  '浮窗统计段')
rep(
  ".dsh-pm-drawer-actions{display:flex;gap:8px;margin-top:16px}",
  ".dsh-pm-drawer-actions{align-items:center;border-top:1px solid var(--dsw-alias-border-l2);display:flex;gap:10px;margin:0;padding:10px 16px 12px}",
  '浮窗操作段')
rep(
  ".dsh-pm-drawer-link{color:var(--pm-accent);font-size:12px;line-height:18px;text-decoration:none;display:inline-block;margin-top:12px}",
  ".dsh-pm-drawer-link{color:var(--pm-accent);cursor:pointer;display:inline-block;font-size:11.5px;line-height:18px;margin:0 0 0 auto;text-decoration:none}",
  '浮窗链接右对齐')

// ── 6. 抽屉 JSX：标题行内联「· 作者 · 分类」（原型同款结构）──
rep(
  "h('div', { className: 'dsh-pm-drawer-title' }, detail.repo || detail.name),\n            h('div', { className: 'dsh-pm-drawer-meta' }, `${detail.author || detail.name} · ${categoryLabel(detail.category)}`)),",
  "h('div', { className: 'dsh-pm-drawer-title' }, detail.repo || detail.name,\n            h('span', { className: 'dsh-pm-drawer-meta' }, ` · ${detail.author || detail.name} · ${categoryLabel(detail.category)}`))),",
  '浮窗标题内联 meta')

fs.writeFileSync(CLIENT, source, 'utf8')
console.log('fidelity patch done:', n, '处')
