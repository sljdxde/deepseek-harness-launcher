// 搜索模糊匹配：q 按空白拆成多个词，所有词分别命中（AND）即匹配——
// 此前把整个查询串当连续子串找，「终端 导出」这类多词查询永远搜不到。
// 同时 UI 排序选项去掉「最新」（数据源 5% 覆盖，语义不可靠）。
import fs from 'node:fs'

const LIB = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/lib/index.js'
let lib = fs.readFileSync(LIB, 'utf8')
const oldMatch = `    if (!q) return true;
    return [plugin.name, plugin.repo, plugin.author, plugin.descriptionEn, plugin.descriptionZh]
      .filter(Boolean).join(' ').toLowerCase().includes(q);`
const newMatch = `    if (!q) return true;
    /* 模糊匹配：q 按空白拆成多个词（如「终端 导出」），每个词分别命中即可。
       q 已在上方统一 toLowerCase，字段也 join 成小写串，大小写不敏感。 */
    const haystack = [plugin.name, plugin.repo, plugin.author, plugin.descriptionEn, plugin.descriptionZh]
      .filter(Boolean).join(' ').toLowerCase();
    return q.split(/\\s+/).every((term) => haystack.includes(term));`
if (!lib.includes(oldMatch)) { console.error('FAIL: match 锚点缺失'); process.exit(1) }
lib = lib.replace(oldMatch, newMatch)
fs.writeFileSync(LIB, lib, 'utf8')
console.log('lib/index.js: 搜索改多词 AND 模糊匹配')

// client.js：排序选项去掉「最新」
const CLIENT = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let client = fs.readFileSync(CLIENT, 'utf8')
const oldSort = `[['stars', '排序：星标'], ['downloads', '排序：下载量'], ['newest', '排序：最新']]`
if (!client.includes(oldSort)) { console.error('FAIL: 排序选项锚点缺失'); process.exit(1) }
client = client.replace(oldSort, `[['stars', '排序：星标'], ['downloads', '排序：下载量']]`)
fs.writeFileSync(CLIENT, client, 'utf8')
console.log('client.js: 排序选项已去掉「最新」')
