// 筛选口径修复：source/category 筛选后，counts / sections / featured / 双榜
// 仍然从「未筛选全量」构建——切「官方」后页面上的推荐位/双榜/分区卡全是社区插件，
// 真正的官方插件被分区视图挡住，表现为「没有任何插件」。
// 统一改为从筛选后的列表（filtered）构建。
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/lib/index.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b, m) => {
  if (!s.includes(a)) { console.error('FAIL: ' + m); process.exit(1) }
  s = s.replace(a, b); n++
}

// 1) 分类计数：筛选后的列表
rep(
  `  const counts = new Map();
  for (const plugin of all) {
    const id = normalizeCategory(plugin.category);
    counts.set(id, (counts.get(id) || 0) + 1);
  }`,
  `  const counts = new Map();
  for (const plugin of filtered) {
    const id = normalizeCategory(plugin.category);
    counts.set(id, (counts.get(id) || 0) + 1);
  }`,
  '分类计数')

// 2) 双榜与推荐位
rep(
  `  const topDownloads = all.slice().sort(byDownloads).slice(0, 5);
  const topStars = all.slice().sort(byStars).slice(0, 5);`,
  `  const topDownloads = filtered.slice().sort(byDownloads).slice(0, 5);
  const topStars = filtered.slice().sort(byStars).slice(0, 5);`,
  '双榜')


fs.writeFileSync(p, s, 'utf8')
console.log('筛选口径统一:', n, '处')
