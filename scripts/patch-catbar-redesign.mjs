// 分类选择区彻底重构（依据 Material Design / UX Patterns 规范调研）：
//   规范要点：segmented 只适合 2–5 个互斥选项；8+ 分类应用 chips 流（无大容器底色）。
//   1. 分类 → chips 流：去掉大灰轨道，未选中纯文字，选中 = accent 淡底（唯一强调）
//   2. 计数 → 10.5px 更淡（不再和标签争视觉）
//   3. 来源/排序 → 保留 segmented（2–3 选项正是它的场景），但轨道压到几乎不可见
//   4. 清理文件里 3 处互相覆盖的重复规则，只留一份权威定义
//   5. 间距/圆角落到 4px 网格与 8px 圆角阶梯
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let s = fs.readFileSync(p, 'utf8')

// ── A. 删除末尾追加的两批重复块（分类条 segmented + 收起胶囊）──
const dropBlocks = [
  ['/* ── 原型复刻：分类条 segmented（灰轨道 + 白 thumb 浮块）── */', '/* ── 原型复刻：卡片效果更明显'],
  ['/* ── 分类条：展开态的「收起」与原型的 .opt.xall 一致（accent 淡底 + 阴影）── */', '`\n  /* Tabler 线性图标集'],
]
for (const [startMark, endMark] of dropBlocks) {
  const a = s.indexOf(startMark)
  const b = s.indexOf(endMark)
  if (a < 0 || b < 0 || b < a) { console.error('FAIL: 块未找到', startMark.slice(0, 20)); process.exit(1) }
  s = s.slice(0, a) + s.slice(b)
}

// ── B. 主位置的旧规则整体替换成新设计 ──
const startMark = '.dsh-pm-catbar{'
const endMark = '.dsh-pm-segf.on{'
const a = s.indexOf(startMark)
const b = s.indexOf(endMark)
if (a < 0 || b < 0) { console.error('FAIL: 主规则块未找到'); process.exit(1) }

const NEW = `/* 分类选择区（依据 Material / UX Patterns 规范）：
   分类是 8+ 个互斥选项 → 用 chips 流，容器无底色，选中项是唯一强调；
   来源/排序是 2–3 个视图切换 → 保留 segmented，但轨道压到几乎不可见。
   间距全部落在 4px 网格，圆角统一 8px（thumb 6px）。 */
.dsh-pm-catbar{display:flex;flex-direction:column;gap:8px;padding:0}
.dsh-pm-catrow{align-items:center;display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.dsh-pm-segs{display:inline-flex;flex:0 1 auto;flex-wrap:nowrap;gap:2px;min-width:0;overflow:hidden;padding:0}
.dsh-pm-segs.xp{flex:1 1 0;flex-wrap:wrap;overflow:visible;row-gap:2px}
.dsh-pm-seg{align-items:center;background:transparent;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;flex:none;font:inherit;font-size:12px;gap:4px;height:28px;padding:0 8px;transition:background .14s ease,color .14s ease;white-space:nowrap}
.dsh-pm-seg:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}
.dsh-pm-seg.on{background:color-mix(in srgb,var(--pm-accent) 12%,transparent);color:var(--pm-accent);font-weight:600}
.dsh-pm-seg .n{color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-variant-numeric:tabular-nums}
.dsh-pm-seg.on .n{color:color-mix(in srgb,var(--pm-accent) 72%,transparent)}
/* 「全部 N 类」：比分类更低存在感，不抢选中态 */
.dsh-pm-seg.more{color:var(--dsw-alias-label-tertiary)}
.dsh-pm-seg.more:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}
/* 展开态「收起」：accent 淡底，与选中 chip 同族但语义不同（有箭头提示收起） */
.dsh-pm-seg.xall{background:color-mix(in srgb,var(--pm-accent) 12%,transparent);color:var(--pm-accent);font-weight:600}
.dsh-pm-seg.xall:hover{background:color-mix(in srgb,var(--pm-accent) 20%,transparent);color:var(--pm-accent)}
.dsh-pm-filters{align-items:center;display:flex;flex:none;gap:8px;margin-left:auto}
.dsh-pm-segs.mini{background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);border-radius:10px;flex:none;gap:1px;padding:2px}
.dsh-pm-segf{align-items:center;background:transparent;border:0;border-radius:8px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;flex:none;font:inherit;font-size:11.5px;height:24px;padding:0 8px;transition:background .14s ease,color .14s ease;white-space:nowrap}
.dsh-pm-segf:hover{color:var(--dsw-alias-label-primary)}
`
s = s.slice(0, a) + NEW + s.slice(a)
// 旧的 .dsh-pm-segf.on / select 规则：先删旧 segf.on 定义（保留语义在新块里）
const oldOn = '.dsh-pm-seg.on,.dsh-pm-segf.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.08);color:var(--dsw-alias-label-primary);font-weight:600}'
if (s.includes(oldOn)) s = s.replace(oldOn, '.dsh-pm-segf.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.12),0 0 0 .5px rgba(0,0,0,.06);color:var(--dsw-alias-label-primary);font-weight:600}')
// 旧的合并规则（13px/32px 高）删掉，避免覆盖新设计
const oldCombo = '.dsh-pm-seg,.dsh-pm-segf{align-items:center;background:transparent;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;flex:none;font:inherit;font-size:13px;gap:6px;height:32px;padding:0 10px;transition:background .12s ease,color .12s ease;white-space:nowrap}'
if (s.includes(oldCombo)) s = s.replace(oldCombo, '')
// 旧的 seg:hover 规则
const oldHover = '.dsh-pm-seg:hover{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}'
if (s.includes(oldHover)) s = s.replace(oldHover, '')
// 旧的 .dsh-pm-seg.on / .n 规则
const oldOn2 = '.dsh-pm-seg.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.08);color:var(--dsw-alias-label-primary);font-weight:600}'
if (s.includes(oldOn2)) s = s.replace(oldOn2, '')
const oldN = '.dsh-pm-seg .n{color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-variant-numeric:tabular-nums}'
if (s.includes(oldN)) s = s.replace(oldN, '')
const oldN2 = '.dsh-pm-seg.on .n{color:var(--pm-accent);font-weight:600}'
if (s.includes(oldN2)) s = s.replace(oldN2, '')
const oldMini = '.dsh-pm-segs.mini{flex:none}'
if (s.includes(oldMini)) s = s.replace(oldMini, '')
const oldMiniInner = '.dsh-pm-segs.mini .dsh-pm-seg,.dsh-pm-segs.mini .dsh-pm-segf{font-size:11.5px;height:22px;padding:0 9px}'
if (s.includes(oldMiniInner)) s = s.replace(oldMiniInner, '')
const oldSegs = '.dsh-pm-segs{display:flex;flex:1 1 auto;flex-wrap:wrap;gap:2px;min-width:0}'
if (s.includes(oldSegs)) s = s.replace(oldSegs, '')

fs.writeFileSync(p, s, 'utf8')

// 自检：关键规则各只剩一份
const count = (needle) => (s.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
console.log('分类规则重复数:', {
  catrow: count('.dsh-pm-catrow{'),
  segs: count('.dsh-pm-segs{'),
  seg: count('.dsh-pm-seg{'),
  mini: count('.dsh-pm-segs.mini{'),
  segf: count('.dsh-pm-segf{'),
})
