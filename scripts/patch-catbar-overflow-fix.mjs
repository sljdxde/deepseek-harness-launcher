// 修复分类条被筛选组挤压/折叠：
//   1. 筛选按钮去掉「来源：」「排序：」前缀（长度从 ~630px 降到 ~340px），语义放 aria-label/title
//   2. 分类条允许换行（chips 流），不再 nowrap 溢出被盖住
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b, m) => {
  if (!s.includes(a)) { console.error('FAIL: ' + m); process.exit(1) }
  s = s.replace(a, b); n++
}

// 1) 分类条可换行（收起/展开都用 chips 流，溢出时换行而不是被裁）
rep(
  '.dsh-pm-segs{display:flex;flex:1 1 0;flex-wrap:nowrap;gap:2px;min-width:0;padding:0}',
  '.dsh-pm-segs{display:flex;flex:1 1 0;flex-wrap:wrap;gap:2px;min-width:0;row-gap:2px}',
  '分类条换行')
rep('.dsh-pm-segs.xp{flex-wrap:wrap;row-gap:2px}', '.dsh-pm-segs.xp{row-gap:2px}', '去掉冗余 xp 规则')

// 2) 筛选按钮文案紧凑化（前缀进 aria-label / title）
rep(
  `            [['all', '来源：全部'], ['official', '官方'], ['community', '社区']]`,
  `            [['all', '全部'], ['official', '官方'], ['community', '社区']]`,
  '来源组文案')
rep(
  `              .map(([value, label]) => h('button', {
                key: 'src-' + value,
                className: \`dsh-pm-segf\${source === value ? ' on' : ''}\`,
                onClick: () => setSource(value),
                title: label,
              }, label))),`,
  `              .map(([value, label]) => h('button', {
                key: 'src-' + value,
                className: \`dsh-pm-segf\${source === value ? ' on' : ''}\`,
                onClick: () => setSource(value),
                title: '按来源过滤：' + label,
                'aria-label': '来源：' + label,
              }, label))),`,
  '来源组 title/aria')
rep(
  `            [['stars', '排序：星标'], ['downloads', '排序：下载量'], ['newest', '排序：最新']]`,
  `            [['stars', '星标'], ['downloads', '下载量'], ['newest', '最新']]`,
  '排序组文案')
rep(
  `              .map(([value, label]) => h('button', {
                key: 'sort-' + value,
                className: \`dsh-pm-segf\${sort === value ? ' on' : ''}\`,
                onClick: () => setSort(value),
                title: label,
              }, label))))),`,
  `              .map(([value, label]) => h('button', {
                key: 'sort-' + value,
                className: \`dsh-pm-segf\${sort === value ? ' on' : ''}\`,
                onClick: () => setSort(value),
                title: '排序：' + label,
                'aria-label': '排序：' + label,
              }, label))))),`,
  '排序组 title/aria')

fs.writeFileSync(p, s, 'utf8')
console.log('修复完成:', n, '处')
