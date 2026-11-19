// 把原型定稿的交互落到真实插件管理器（Plugins/DSHPluginManager/client/client.js）：
//   1. 删除「详情」按钮：榜单行 / 今日推荐整块可点，点哪弹哪（浮窗以点击点为中心）
//   2. 详情抽屉 → 紧凑小浮窗：360 宽自适应高、四段分隔线、GitHub 链接并入操作行
//   3. 已安装插件浮窗不再重复出现安装按钮（状态已由列表行表达）
//   4. 「✓ 已安装」胶囊 → 纯绿字「已安装」（无对勾无底色）
//   5. 安装按钮换轻量下载图形（arrow-bar-to-down，不再是大箭头+托盘）
//   6. AI 搜索条常态流光描边（只描边，不填充输入区）
// 同步更新 client-render.smoke.mjs 的对应断言。
// 运行：node scripts/patch-prototype-parity.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNormalized } from './lib/tabler-icons.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js')
const SMOKE = path.join(ROOT, 'Plugins/DSHPluginManager/test/client-render.smoke.mjs')
const SRC = path.join(os.tmpdir(), 'icon-research/tabler/package/icons/outline')

let source = fs.readFileSync(CLIENT, 'utf8')
let patchCount = 0
const must = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1) } ; patchCount++ }
const replaceOnce = (oldStr, newStr, msg) => {
  if (!source.includes(oldStr)) { console.error('FAIL(锚点缺失): ' + msg); process.exit(1) }
  source = source.replace(oldStr, newStr)
  patchCount++
}

// ── 1. setDetail 包装：记录点击坐标（面板内），供浮窗跟手定位 ──
replaceOnce(
  `    const [detail, setDetail] = React.useState(null)`,
  `    const [detail, setDetailState] = React.useState(null)
    const [detailPos, setDetailPos] = React.useState(null)
    const panelRef = React.useRef(null)
    /* 详情浮窗跟手：打开时把点击点换算成面板内坐标；无坐标（键盘路径）时居中兜底。 */
    const setDetail = (plugin, e) => {
      setDetailState(plugin)
      const pr = (e && panelRef.current && panelRef.current.getBoundingClientRect) ? panelRef.current.getBoundingClientRect() : null
      setDetailPos(e && Number.isFinite(e.clientX) && pr ? { x: e.clientX - pr.left, y: e.clientY - pr.top } : null)
    }`,
  'setDetail 包装')

// ── 2. 面板根节点挂 ref（坐标换算的基准）──
replaceOnce(
  `    return h('div', null,
      h('div', { className: 'dsh-pm-backdrop', onClick: () => { if (closable) { onClose() } } }),
      h('div', { className: 'dsh-pm-page' + (fullscreen ? ' dsh-pm-full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件管理' },`,
  `    return h('div', null,
      h('div', { className: 'dsh-pm-backdrop', onClick: () => { if (closable) { onClose() } } }),
      h('div', { className: 'dsh-pm-page' + (fullscreen ? ' dsh-pm-full' : ''), ref: panelRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件管理' },`,
  '面板根节点挂 ref')

// ── 3. 榜单行：删「详情」按钮，整行可点 ──
const rankRowOld = `        installButton(plugin, { status, disabled: batchRunning }),
        // 详情入口：榜单行此前整行没有任何点击处理，用户点名字没反应。
        // 用独立按钮（和 hero 的「详情」一致），避免整行点击与「安装」按钮冲突。
        h('button', {
          className: 'dsh-pm-rank-detail',
          onClick: () => setDetail(plugin),
          title: \`查看 \${plugin.repo || plugin.name} 的详情\`,
          'aria-label': \`查看 \${plugin.repo || plugin.name} 的详情\`,
        }, '详情'))`
const rankRowNew = `        installButton(plugin, { status, disabled: batchRunning }))`
replaceOnce(rankRowOld, rankRowNew, '榜单详情按钮块删除')
replaceOnce(
  `      return h('div', { className: 'dsh-pm-rank-row', key: plugin.id },`,
  `      return h('div', { className: 'dsh-pm-rank-row', key: plugin.id, onClick: (e) => setDetail(plugin, e) },`,
  '榜单行可点')
// rank-detail 的 CSS 规则一并清掉
source = source.replace(/\n\/\* 榜单行的「详情」：[^\n]*\n\.dsh-pm-rank-detail\{[^}]*\}/, '')

// ── 4. 今日推荐：删「详情」按钮，整块可点 ──
replaceOnce(
  `              h('button', { className: 'dsh-pm-tool', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '15px', padding: '6px 16px' }, onClick: () => setDetail(hero) }, '详情'))`,
  `              )`,
  'hero 详情按钮删除')
// hero 根节点可点（安装按钮自带 stopPropagation，不会误触）
replaceOnce(
  `      ? h('div', { className: 'dsh-pm-hero' },`,
  `      ? h('div', { className: 'dsh-pm-hero', onClick: (e) => setDetail(hero, e) },`,
  'hero 可点')

// ── 5. 卡片点击带坐标 ──
must(source.includes(`onClick: () => setDetail(plugin)`), '卡片 onClick 锚点')
source = source.split(`onClick: () => setDetail(plugin)`).join(`onClick: (e) => setDetail(plugin, e)`)

// ── 6. 详情抽屉 → 跟手小浮窗（遮罩 + 紧凑分段 + 链接并入操作行 + 已安装不重复按钮）──
const drawerOldStart = source.indexOf(`    const drawer = detail ? h('div', { className: 'dsh-pm-drawer' },`)
const drawerOldEnd = source.indexOf("\n      : null", drawerOldStart)
if (drawerOldStart < 0 || drawerOldEnd < 0) { console.error('FAIL: drawer 块未找到'); process.exit(1) }
const drawerNew = `    /* 详情小浮窗：贴点击处弹出；已安装插件的状态已由列表行表达，浮窗里不再重复按钮。 */
    const drawer = detail ? [
      h('div', { className: 'dsh-pm-mask', onClick: () => setDetail(null), 'aria-hidden': true }),
      h('div', { className: 'dsh-pm-drawer', style: detailPos ? { left: detailPos.x + 'px', top: detailPos.y + 'px' } : null },
        h('div', { className: 'dsh-pm-drawer-head' },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'dsh-pm-drawer-title' }, detail.repo || detail.name),
            h('div', { className: 'dsh-pm-drawer-meta' }, \`\${detail.author || detail.name} · \${categoryLabel(detail.category)}\`)),
          h('button', { className: 'dsh-pm-drawer-close', onClick: () => setDetail(null), 'aria-label': '关闭' }, '×')),
        h('div', { className: 'dsh-pm-drawer-desc' }, descOf(detail, true) || descOf(detail) || '暂无描述'),
        h('div', { className: 'dsh-pm-drawer-stats' },
          h('span', null, \`★ \${detail.stars || 0}\`),
          h('span', null, \`下载 \${detail.downloads || 0}\`),
          detail.addedDate ? h('span', null, \`添加于 \${detail.addedDate}\`) : null),
        h('div', { className: 'dsh-pm-drawer-actions' },
          isInstalledPlugin(detail) || installStatus[detail.id] ? null : installButton(detail, { status: installStatus[detail.id], disabled: batchRunning || busyOther }),
          detail.url ? h('a', { className: 'dsh-pm-drawer-link', href: detail.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上查看 ↗') : null))] : null`
source = source.slice(0, drawerOldStart) + drawerNew + source.slice(drawerOldEnd)

// ── 7. 「✓ 已安装」胶囊 → 纯绿字 ──
replaceOnce(
  "return h('span', { className: `dsh-pm-installed-tag ${extraClass}`.trim() },\n          icon('check', 12), '已安装')",
  "return h('span', { className: `dsh-pm-installed-tag ${extraClass}`.trim() }, '已安装')",
  '已安装去对勾')

// ── 8. 安装按钮换轻量下载图形 ──
must(source.includes("icon('download', 12)"), '安装按钮图标锚点')
source = source.split("icon('download', 12)").join("icon('install', 12)")

// ── 9. ICONS 表补 install 键（arrow-bar-to-down，光学归一）──
if (!source.includes('"install":')) {
  const ICONS = loadNormalized(SRC, ['arrow-bar-to-down'])
  const mapRe = /const ICONS = \{/
  if (!mapRe.test(source)) { console.error('FAIL: ICONS 表未找到'); process.exit(1) }
  source = source.replace(mapRe, 'const ICONS = {\n    "install": ' + JSON.stringify(ICONS['arrow-bar-to-down']) + ',')
}

// ── 10. CSS：小浮窗 / 遮罩 / 已安装纯字 / AI 流光 / 行指针 ──
const cssEnd = source.indexOf('\n}`', source.indexOf('const css = `'))
if (cssEnd < 0) { console.error('FAIL: css 模板结束未找到'); process.exit(1) }
const cssAdd = `
/* ── 详情小浮窗：紧凑卡片贴点击处弹出（替代侧边抽屉）── */
.dsh-pm-drawer{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.30);height:auto;left:50%;max-height:calc(100% - 24px);overflow:auto;padding:0;top:50%;transform:translate(-50%,-50%);width:360px}
.dsh-pm-drawer-head{align-items:center;padding:13px 16px 11px}
.dsh-pm-drawer-desc{border-top:1px solid var(--dsw-alias-border-l2);margin:0;padding:11px 16px}
.dsh-pm-drawer-stats{border-top:1px solid var(--dsw-alias-border-l2);margin:0;padding:9px 16px}
.dsh-pm-drawer-actions{align-items:center;border-top:1px solid var(--dsw-alias-border-l2);margin:0;padding:10px 16px 12px}
.dsh-pm-drawer-link{margin:0 0 0 auto}
.dsh-pm-mask{background:rgba(0,0,0,.18);inset:0;position:absolute;z-index:2147483001}
/* ── 已安装：纯绿字（无对勾无底色）── */
.dsh-pm-installed-tag{background:none;border:0;height:auto;padding:0;width:auto}
/* ── AI 搜索条：常态流光描边（只描边，不填充输入区）── */
.dsh-pm-ai{position:relative}
.dsh-pm-ai::before{animation:aib-sweep 3.4s linear infinite;background:conic-gradient(from var(--aib-ang,0deg),transparent 0deg,color-mix(in srgb,var(--pm-accent) 65%,transparent) 24deg,var(--pm-accent) 48deg,#fff 58deg,var(--pm-accent) 68deg,color-mix(in srgb,var(--pm-accent) 55%,transparent) 95deg,transparent 135deg,transparent 250deg,color-mix(in srgb,var(--pm-accent) 60%,transparent) 296deg,color-mix(in srgb,var(--pm-accent) 30%,transparent) 330deg,transparent 350deg);border-radius:inherit;content:"";inset:0;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask-composite:xor;padding:2px;pointer-events:none;position:absolute}
@property --aib-ang{syntax:"<angle>";inherits:false;initial-value:0deg}
@keyframes aib-sweep{to{--aib-ang:360deg}}
/* 可点区域 */
.dsh-pm-rank-row{cursor:pointer}
.dsh-pm-hero{cursor:pointer}
`
source = source.slice(0, cssEnd) + cssAdd + source.slice(cssEnd)

fs.writeFileSync(CLIENT, source, 'utf8')
console.log('client.js patched:', patchCount, '处改动')

// ── 测试同步 ──
let smoke = fs.readFileSync(SMOKE, 'utf8')
let sc = 0
const smokeOnce = (oldStr, newStr, msg) => {
  if (!smoke.includes(oldStr)) { console.error('FAIL(测试锚点缺失): ' + msg); process.exit(1) }
  smoke = smoke.replace(oldStr, newStr); sc++
}

// 推荐位：详情按钮已删
smokeOnce(
  `  const heroButtons = findAll(runtime.tree, node => node.type === 'button' && (textOf(node) === '安装' || textOf(node) === '详情'));
  assert.ok(heroButtons.length >= 2, '推荐位有安装与详情按钮');`,
  `  const heroButtons = findAll(runtime.tree, node => node.type === 'button' && textOf(node) === '安装');
  assert.ok(heroButtons.length >= 1, '推荐位有安装按钮（详情改为整块点击弹出）');`,
  '推荐位断言')

// 榜单行：详情按钮已删 → 点行弹浮窗
smokeOnce(
  `  // 榜单行可以查看详情（此前整行没有任何点击处理，点名字没反应）。
  const detailBtn = findAll(installedRow, node => node.type === 'button'
    && /(^| )dsh-pm-rank-detail( |$)/.test(String(node.props.className || '')))[0];
  assert.ok(detailBtn, '榜单行有「详情」按钮');
  detailBtn.props.onClick();`,
  `  // 榜单行整行可点（详情按钮已删，点哪都在点击处弹浮窗）。
  assert.ok(!findAll(installedRow, node => node.type === 'button'
    && /(^| )dsh-pm-rank-detail( |$)/.test(String(node.props.className || ''))).length, '榜单行没有「详情」按钮');
  installedRow.props.onClick({ clientX: 400, clientY: 300 });`,
  '榜单行触发方式')

// 已安装插件的抽屉不再出现安装按钮
smokeOnce(
  `  assert.ok(textOf(drawer2).includes('已安装'), '已安装的插件显示已安装标记');
  assert.ok(textOf(drawer2).includes('Installed'), '没有中文描述时回退到英文描述');`,
  `  assert.equal(findAll(drawer2, node => node.type === 'button' && textOf(node).trim() === '安装').length, 0,
    '已安装插件的浮窗不再重复出现安装按钮');
  assert.ok(textOf(drawer2).includes('Installed'), '没有中文描述时回退到英文描述');`,
  '已安装抽屉断言')

fs.writeFileSync(SMOKE, smoke, 'utf8')
console.log('smoke test patched:', sc, '处断言')
