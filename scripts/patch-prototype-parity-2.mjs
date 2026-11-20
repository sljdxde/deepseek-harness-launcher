// 原型复刻 #2：分类条 / 来源 / 排序 segmented 化 + 卡片效果加强
//   1. 分类条：灰轨道 + 白 thumb 浮块（iOS segmented，原型 .segs 口径）
//   2. 来源 / 排序：select 下拉 → 原型 segs.mini 按钮组（不再有 ▼ 下拉）
//   3. 「全部 N 类」去掉 chevron（原型同款）
//   4. 卡片效果更明显：内容区灰底衬托 + 卡片静影 + hover 阴影加强（原型口径）
// 同步更新 client-render.smoke.mjs 的 select 断言。
// 运行：node scripts/patch-prototype-parity-2.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js')
const SMOKE = path.join(ROOT, 'Plugins/DSHPluginManager/test/client-render.smoke.mjs')

let source = fs.readFileSync(CLIENT, 'utf8')
let n = 0
const rep = (oldStr, newStr, msg) => {
  if (!source.includes(oldStr)) { console.error('FAIL(锚点缺失): ' + msg); process.exit(1) }
  source = source.split(oldStr).join(newStr)
  n++
}

// ── 1. 「全部 N 类」去 chevron（原型同款纯文字）──
rep(
  "}, `全部 ${orderedCategories.length} 类`, icon('chev', 11))",
  "}, `全部 ${orderedCategories.length} 类`)",
  '全部 N 类去 chevron')

// ── 2. 来源 / 排序：select 下拉 → segs.mini 按钮组 ──
rep(
  `        h('div', { className: 'dsh-pm-filters' },
          h('select', { className: 'dsh-pm-select', value: source, onChange: (e) => setSource(e.target.value), title: '按插件来源过滤', 'aria-label': '按来源过滤' },
            h('option', { value: 'all' }, '来源：全部'),
            h('option', { value: 'official' }, '来源：官方'),
            h('option', { value: 'community' }, '来源：社区'),
            (Array.isArray(sources) ? sources : []).filter(item => !item.builtin).map(item => h('option', { key: item.id, value: item.id }, '来源：' + shortSourceLabel(item.url)))),
          h('select', { className: 'dsh-pm-select', value: sort, onChange: (e) => setSort(e.target.value), title: '排序', 'aria-label': '排序' },
            h('option', { value: 'stars' }, '排序：星标'),
            h('option', { value: 'downloads' }, '排序：下载量'),
            h('option', { value: 'newest' }, '排序：最新')))),`,
  `        h('div', { className: 'dsh-pm-filters' },
          h('div', { className: 'dsh-pm-segs mini', role: 'group', 'aria-label': '按来源过滤' },
            [['all', '来源：全部'], ['official', '官方'], ['community', '社区']]
              .concat((Array.isArray(sources) ? sources : []).filter(item => !item.builtin).map(item => [item.id, '来源：' + shortSourceLabel(item.url)]))
              .map(([value, label]) => h('button', {
                key: 'src-' + value,
                className: \`dsh-pm-seg\${source === value ? ' on' : ''}\`,
                onClick: () => setSource(value),
                title: label,
              }, label))),
          h('div', { className: 'dsh-pm-segs mini', role: 'group', 'aria-label': '排序' },
            [['stars', '排序：星标'], ['downloads', '排序：下载量'], ['newest', '排序：最新']]
              .map(([value, label]) => h('button', {
                key: 'sort-' + value,
                className: \`dsh-pm-seg\${sort === value ? ' on' : ''}\`,
                onClick: () => setSort(value),
                title: label,
              }, label))))),`,
  '来源/排序 select → segs.mini')

// ── 3. CSS：segmented 轨道 + 白 thumb + mini + 卡片效果（追加到 css 模板末尾，顶层生效）──
const tplStart = source.indexOf('const css = `') + 'const css = `'.length
const tplClose = source.indexOf('`', tplStart)
if (tplClose < 0) { console.error('FAIL: css 模板收尾未找到'); process.exit(1) }
const cssAdd = `
/* ── 原型复刻：分类条 segmented（灰轨道 + 白 thumb 浮块）── */
.dsh-pm-segs{background:var(--dsw-alias-bg-layer-2);border-radius:7px;display:inline-flex;flex:0 1 auto;flex-wrap:nowrap;gap:2px;min-width:0;overflow-x:auto;padding:2px}
.dsh-pm-segs.dsh-pm-segs-open{display:flex;flex-wrap:wrap;overflow:visible}
.dsh-pm-seg{align-items:center;background:transparent;border:0;border-radius:5px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;flex:none;font:inherit;font-size:12px;gap:5px;height:24px;padding:0 11px;transition:color .18s cubic-bezier(.2,.8,.2,1);white-space:nowrap}
.dsh-pm-seg:hover{color:var(--dsw-alias-label-secondary)}
.dsh-pm-seg.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.08);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-pm-seg .n{font-size:11px;font-variant-numeric:tabular-nums}
.dsh-pm-seg.on .n{color:var(--pm-accent);font-weight:600}
.dsh-pm-segs.mini{flex:none}
.dsh-pm-segs.mini .dsh-pm-seg{font-size:11.5px;height:22px;padding:0 9px}
/* ── 原型复刻：卡片效果更明显（内容区灰底衬托 + 静影 + hover 提亮）── */
.dsh-pm-body{background:var(--dsw-alias-bg-layer-2)}
.dsh-pm-card{border-radius:12px;box-shadow:0 1px 3px rgba(20,22,30,.06),0 0 0 .5px rgba(20,22,30,.03);gap:8px;padding:12px 12px 11px 13px}
.dsh-pm-card:hover{box-shadow:0 4px 14px rgba(20,22,30,.12)}
`
source = source.slice(0, tplClose) + cssAdd + source.slice(tplClose)
n++

fs.writeFileSync(CLIENT, source, 'utf8')
console.log('client.js patched:', n, '处')

// ── 测试同步：select 断言 → segs.mini 断言 ──
let smoke = fs.readFileSync(SMOKE, 'utf8')
const oldAssert = "  assert.equal(findAll(filters, node => node.type === 'select').length, 2, '筛选组里是来源 + 排序两个 select');"
if (!smoke.includes(oldAssert)) { console.error('FAIL(测试锚点缺失): select 断言'); process.exit(1) }
smoke = smoke.replace(
  oldAssert,
  `  const filterSegs = findAll(filters, node => node.type === 'button' && /(^| )dsh-pm-seg( |$)/.test(String(node.props.className || '')));
  assert.ok(filterSegs.length >= 5, '筛选组是来源 + 排序的 segmented 按钮组（不再 select 下拉）');`)
fs.writeFileSync(SMOKE, smoke, 'utf8')
console.log('smoke test patched')
