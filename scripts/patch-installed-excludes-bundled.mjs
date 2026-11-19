// 已安装页剔除内置插件（内置只在「内置」页出现，与原型一致）
//   installedRows 里 return null 跳过 bundled，保留原数组下标（行选择/框选按 installed[] 索引）
//   空态判断改为「非内置且有内容」
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let s = fs.readFileSync(p, 'utf8')

// 1) installedRows 跳过 bundled（放在 map 回调最前，保持 index 语义）
const oldHead = `    const installedRows = installed.map((item, index) => {
      const selectable = !item.broken && item.source !== 'bundled'`
const newHead = `    /* 已安装页只列用户装的插件：内置插件（bundled）单独在「内置」页，不在这里重复出现。
       return null 而不是提前 filter：行选择/框选按 installed[] 的原下标工作。 */
    const installedRows = installed.map((item, index) => {
      if (item.source === 'bundled') return null
      const selectable = !item.broken && item.source !== 'bundled'`
if (!s.includes(oldHead)) { console.error('FAIL: installedRows 锚点缺失'); process.exit(1) }
s = s.replace(oldHead, newHead)

// 2) 空态按非内置数量判断
const oldEmpty = `        installed.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '还没有已安装的插件，去「发现」看看吧')`
const newEmpty = `        installed.filter(item => item.source !== 'bundled').length === 0 ? h('div', { className: 'dsh-pm-empty' }, '还没有已安装的插件，去「发现」看看吧')`
if (!s.includes(oldEmpty)) { console.error('FAIL: 空态锚点缺失'); process.exit(1) }
s = s.replace(oldEmpty, newEmpty)

fs.writeFileSync(p, s, 'utf8')
console.log('已安装页已剔除内置插件')
