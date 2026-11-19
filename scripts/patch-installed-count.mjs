// 左栏「已安装」计数与列表口径一致：只数非内置插件（内置的 5 个在「内置」页计）。
//   此前 count 用 installed.length（含 bundled），列表剔除内置后两边对不上（7 vs 2）。
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let s = fs.readFileSync(p, 'utf8')

const old = "{ id: 'installed', label: '已安装', iconName: 'download', count: installed.length || null },"
const neu = "{ id: 'installed', label: '已安装', iconName: 'download', count: userInstalledCount || null },"
if (!s.includes(old)) { console.error('FAIL: 计数锚点缺失'); process.exit(1) }
s = s.replace(old, neu)

// userInstalledCount 在 builtinCount 旁定义（同一次 useMemo/render 作用域）
const anchor = 'const builtinCount = installed.filter(item => item.source === \'bundled\' && !item.broken).length'
if (!s.includes(anchor)) { console.error('FAIL: builtinCount 锚点缺失'); process.exit(1) }
s = s.replace(anchor, anchor + '\n    // 已安装页只列用户插件（内置不重复出现），计数与列表口径一致\n    const userInstalledCount = installed.length - builtinCount')

fs.writeFileSync(p, s, 'utf8')
console.log('计数口径已统一')
