// 修复：把复刻 CSS 块移出 @media (max-width:860px){...}（此前嵌在内部导致桌面宽度下全部失效）
// 运行：node scripts/fix-css-media-nesting.mjs
// 前置：Plugins/ 与 windows/internal/ 两份 client.js 同步且含复刻块。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = [
  path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js'),
  path.join(ROOT, 'windows/internal/assets/plugins/DSHPluginManager/client/client.js'),
]

const BLOCK_HEAD = '/* ── 详情小浮窗：紧凑卡片贴点击处弹出（替代侧边抽屉）── */'
const BLOCK_TAIL = '@keyframes aib-sweep{to{--aib-ang:360deg}}'
const MEDIA_OPEN = '@media (max-width:860px){'

for (const p of TARGETS) {
  let s = fs.readFileSync(p, 'utf8')
  const cssStart = s.indexOf('const css = `') + 'const css = `'.length
  const tplEnd = s.indexOf('}`', cssStart)          // 模板收尾：'}' 紧贴反引号
  if (cssStart < 13 || tplEnd < 0) { console.error(p, ': css 模板定位失败'); process.exit(1) }
  const css = s.slice(cssStart, tplEnd + 1)          // 含收尾 '}'

  // 已修复过就跳过：复刻块应在 @media 之后（顶层）
  const mediaIdx = css.indexOf(MEDIA_OPEN)
  const blockIdx = css.indexOf(BLOCK_HEAD)
  if (mediaIdx < 0 || blockIdx < 0) { console.error(p, ': 定位失败'); process.exit(1) }
  if (blockIdx > mediaIdx && css.indexOf(BLOCK_HEAD, tplEnd) !== -1) {
    console.log(p, ': 已是顶层，跳过')
    continue
  }

  // 抽出复刻块（从块头到流光 keyframes 收尾）
  const bStart = css.indexOf(BLOCK_HEAD)
  const bTail = css.indexOf(BLOCK_TAIL, bStart)
  if (bTail < 0) { console.error(p, ': 复刻块收尾未找到'); process.exit(1) }
  // 块尾 = 流光 ::before 规则的收尾 'position:absolute}'
  const bRuleEnd = css.indexOf('position:absolute}', bTail)
  if (bRuleEnd < 0) { console.error(p, ': 流光规则收尾未找到'); process.exit(1) }
  const bEnd = bRuleEnd + 'position:absolute}'.length
  const blocks = css.slice(bStart, bEnd)
  if (!blocks.includes('dsh-pm-mask') || !blocks.includes('dsh-pm-ai-bar::before')) {
    console.error(p, ': 复刻块内容不完整'); process.exit(1)
  }

  // 从原位置剔除块；@media 块自带收尾（'\n}' + 模板尾 '}'）
  let body = css.slice(0, bStart) + css.slice(bEnd)
  // 模板收尾 '}'（闭合 @media）此刻在 body 末尾。把复刻块放到它之后（顶层）。
  const mediaClose = body.lastIndexOf('}')
  if (mediaClose < 0) { console.error(p, ': @media 收尾未找到'); process.exit(1) }
  const fixed = body.slice(0, mediaClose + 1) + '\n' + blocks + body.slice(mediaClose + 1)

  // 自检：新 css 括号配平、块在 @media 之后、块完整
  let open = 0
  for (const ch of fixed) { if (ch === '{') open++; if (ch === '}') open-- }
  const newMediaIdx = fixed.indexOf(MEDIA_OPEN)
  const newBlockIdx = fixed.indexOf(BLOCK_HEAD)
  if (open !== 0 || newBlockIdx < newMediaIdx || !fixed.includes('dsh-pm-ai-bar::before')) {
    console.error(p, ': 自检失败', { open, newMediaIdx, newBlockIdx }); process.exit(1)
  }

  s = s.slice(0, cssStart) + fixed + s.slice(tplEnd + 1)
  fs.writeFileSync(p, s)
  console.log(p, ': 复刻块已移到顶层 ✓')
}
