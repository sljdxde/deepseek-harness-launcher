// 分类条布局重构（对齐原型）：
//   1. 展开的分类与「收起」合并进同一个 segs 容器（.xp 换行），不再另起一块
//   2. 筛选组（来源/排序）恒定钉在第一行右侧，不再被分类挤到第二行
//   3. 轨道背景降到极轻（label-primary 4%），选中项靠白 thumb + 阴影区分
//   4. 「收起」用原型的 accent 淡底胶囊，不再是孤立的文字 + 箭头
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b, m) => {
  if (!s.includes(a)) { console.error('FAIL: ' + m); process.exit(1) }
  s = s.replace(a, b); n++
}

// ── 1. JSX：分类 + 收起同一容器；删除第二块 ──
rep(
  `        h('div', { className: 'dsh-pm-segs' },
          pinnedCategories.map(name => categorySeg(name, groupLabel(name), categoryCounts.get(name) || 0, category === name)),
          // 「全部 N 类」只在收起态显示：展开后它自己消失，用户要收起时
          // 用展开分类行末尾那个低调的文字「收起」（不再是醒目的胶囊按钮）。
          tailCategories.length > 0 && !catExpanded
            ? h('button', {
                key: 'seg-more',
                className: 'dsh-pm-seg more',
                onClick: () => setCatExpanded(true),
                'aria-expanded': 'false',
                title: \`还有 \${tailCategories.length} 个分类，点击展开\`,
              }, \`全部 \${orderedCategories.length} 类\`)
            : null),`,
  `        /* 分类条：收起态显示前 8 个 + 「全部 N 类」；展开态在同一个容器里换行平铺
           全部分类，末尾「收起」。筛选组永远钉在这一行右侧（原型的 .grow 分隔同效）。 */
        h('div', { className: 'dsh-pm-segs' + (catExpanded ? ' xp' : '') },
          (catExpanded ? orderedCategories : pinnedCategories)
            .map(name => categorySeg(name, groupLabel(name), categoryCounts.get(name) || 0, category === name)),
          tailCategories.length > 0 && !catExpanded
            ? h('button', {
                key: 'seg-more',
                className: 'dsh-pm-seg more',
                onClick: () => setCatExpanded(true),
                'aria-expanded': 'false',
                title: \`还有 \${tailCategories.length} 个分类，点击展开\`,
              }, \`全部 \${orderedCategories.length} 类\`)
            : null,
          catExpanded
            ? h('button', {
                key: 'seg-collapse',
                className: 'dsh-pm-seg xall',
                onClick: () => setCatExpanded(false),
                title: '收起分类',
              }, '收起')
            : null),`,
  '分类条合并收起')

// 删除旧的第二块 segs-open
rep(
  `      catExpanded ? h('div', { className: 'dsh-pm-segs dsh-pm-segs-open' },
        tailCategories.map(name => categorySeg(name, groupLabel(name), categoryCounts.get(name) || 0, category === name)),
        // 收起入口：低调文字，不再是「全部 N 类」胶囊，也不抢占分类视觉。
        h('button', {
          key: 'seg-collapse',
          className: 'dsh-pm-collapse',
          onClick: () => setCatExpanded(false),
          'aria-label': '收起分类',
        }, '收起', icon('back', 11))) : null)`,
  `      )`,
  '删除第二块')

// ── 2. CSS：轨道更淡 + 默认不换行 + .xp 换行 + 收起胶囊 ──
rep(
  '.dsh-pm-segs{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,var(--dsw-alias-bg-layer-2));border-radius:7px;display:inline-flex;flex:0 1 auto;flex-wrap:wrap;gap:2px;min-width:0;padding:2px}',
  '.dsh-pm-segs{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,var(--dsw-alias-bg-layer-2));border-radius:7px;display:inline-flex;flex:0 1 auto;flex-wrap:nowrap;gap:2px;min-width:0;overflow:hidden;padding:2px}',
  '轨道更淡 + 默认不换行')
rep(
  '.dsh-pm-segs.dsh-pm-segs-open{display:flex;flex-wrap:wrap;overflow:visible}',
  '.dsh-pm-segs.xp{flex-wrap:wrap;overflow:visible;row-gap:2px}',
  '展开态换行')
rep(
  '.dsh-pm-catrow{align-items:center;display:flex;flex-wrap:wrap;gap:10px;min-width:0}',
  '.dsh-pm-catrow{align-items:center;display:flex;flex-wrap:wrap;gap:10px;min-width:0}',
  'catrow 保持 wrap')

// 收起胶囊（原型 .opt.xall 口径）+ 全部 N 类保持低调
const cssAdd = `
/* ── 分类条：展开态的「收起」与原型的 .opt.xall 一致（accent 淡底 + 阴影）── */
.dsh-pm-seg.xall{background:color-mix(in srgb,var(--pm-accent) 14%,transparent);box-shadow:0 0 0 .5px color-mix(in srgb,var(--pm-accent) 22%,transparent);color:var(--pm-accent);font-weight:650}
.dsh-pm-seg.xall:hover{background:color-mix(in srgb,var(--pm-accent) 22%,transparent);color:var(--pm-accent)}
/* 「全部 N 类」保持低调文字，不抢分类视觉 */
.dsh-pm-seg.more{color:var(--dsw-alias-label-secondary)}
`
const tplStart = s.indexOf('const css = `') + 'const css = `'.length
const tplClose = s.indexOf('`', tplStart)
if (tplClose < 0) { console.error('FAIL: css 模板未找到'); process.exit(1) }
s = s.slice(0, tplClose) + cssAdd + s.slice(tplClose)
n++

fs.writeFileSync(p, s, 'utf8')
console.log('分类条布局重构:', n, '处')
