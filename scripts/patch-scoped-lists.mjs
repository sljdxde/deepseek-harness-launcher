// 榜单/推荐位/分类计数口径：
//   来源/分类筛选（结构性）→ 跟随筛选（修复「切官方后页面全是社区插件」的 bug）
//   纯搜索 → 榜单保持市场全量（搜索结果列表已展示命中项，榜单是市场概况）
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/lib/index.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b, m) => {
  if (!s.includes(a)) { console.error('FAIL: ' + m); process.exit(1) }
  s = s.replace(a, b); n++
}

rep(
  `  const counts = new Map();
  for (const plugin of all) {
    const id = normalizeCategory(plugin.category);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const topDownloads = filtered.slice().sort(byDownloads).slice(0, 5);
  const topStars = filtered.slice().sort(byStars).slice(0, 5);`,
  `  const counts = new Map();
  /* 榜单/推荐位/分类计数的口径：结构性筛选（来源/分类）跟随；纯搜索保持市场全量
     （搜索结果列表已经展示命中项，榜单是市场整体概况，不该被搜索词清空）。 */
  const scoped = source !== 'all' || category !== 'all' || group !== 'all' ? filtered : all;
  for (const plugin of scoped) {
    const id = normalizeCategory(plugin.category);
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const topDownloads = scoped.slice().sort(byDownloads).slice(0, 5);
  const topStars = scoped.slice().sort(byStars).slice(0, 5);`,
  'counts 与双榜口径')

// sections 的分区插件：scoped 口径
rep(
  '          plugins: filtered.filter(plugin => plugin && normalizeCategory(plugin.category) === id).sort(sortedCompare).slice(0, MARKET_SECTION_CARDS),',
  '          plugins: scoped.filter(plugin => plugin && normalizeCategory(plugin.category) === id).sort(sortedCompare).slice(0, MARKET_SECTION_CARDS),',
  '分区卡插件')

fs.writeFileSync(p, s, 'utf8')
console.log('口径统一:', n, '处')
