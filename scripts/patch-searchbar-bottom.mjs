import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (a, b, m) => {
  if (!s.includes(a)) { console.error('FAIL: ' + m); process.exit(1) }
  s = s.replace(a, b); n++
}

// 1. 分类视图顶部搜索框删除（mainhead 的其余 children 保留）
rep(
  `        h('label', { className: 'dsh-pm-find' }, icon('search', 13),
          h('input', { placeholder: \`在「\${groupLabel(category)}」里搜索…\`, value: search, onChange: (e) => setSearch(e.target.value), 'aria-label': '在当前分类里搜索' }))),
      categoryBar,`,
  `      categoryBar,`,
  '分类视图顶部搜索框')

// 2. 发现页顶部工具栏搜索框删除（refresh 按钮成为 mainhead 最后一个 child）
rep(
  `        h('label', { className: 'dsh-pm-find' }, icon('search', 13),
          h('input', { placeholder: '搜索插件和作者…', value: search, onChange: (e) => setSearch(e.target.value), 'aria-label': '搜索插件' }))),`,
  `        )),`,
  '发现页顶部搜索框')

// 3. 底部固定搜索栏：插在 viewBody 之后、drawer 之前
rep(
  `            viewBody)),
        drawer,`,
  `            viewBody)),
        tab === 'discover' ? h('div', { className: 'dsh-pm-searchbar' },
          h('label', { className: 'dsh-pm-find' }, icon('search', 13),
            h('input', {
              placeholder: category !== 'all' ? \`在「\${groupLabel(category)}」里搜索…\` : '搜索插件和作者…',
              value: search, onChange: (e) => setSearch(e.target.value),
              'aria-label': '搜索插件和作者',
            }))) : null,
        drawer,`,
  '底部固定搜索栏')

// 4. CSS：底部搜索栏 + find 宽度适配（追加到 css 模板末尾）
const tplStart = s.indexOf('const css = `') + 'const css = `'.length
const tplClose = s.indexOf('`', tplStart)
if (tplClose < 0) { console.error('FAIL: css 模板未找到'); process.exit(1) }
const cssAdd = `
/* ── 底部固定搜索栏：不随内容滚动，任何位置都能直接输入 ── */
.dsh-pm-searchbar{background:var(--dsw-alias-bg-layer-2);border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex:none;justify-content:center;padding:10px 18px}
.dsh-pm-searchbar .dsh-pm-find{height:34px;width:min(560px,100%)}
`
s = s.slice(0, tplClose) + cssAdd + s.slice(tplClose)
n++

fs.writeFileSync(p, s, 'utf8')
console.log('搜索框移到底部固定栏:', n, '处')
