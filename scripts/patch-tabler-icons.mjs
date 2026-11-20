// 把 DSHPluginManager/client/client.js 的图标换成 Tabler 图标（MIT，tabler.io/icons）：
//   1. ICONS 的图形数据换成 Tabler outline + 光学归一（内容包围盒统一缩放并居中）
//   2. icon() 的展开器支持 <g> 包裹，属性名转 React 的 camelCase
//   3. CATEGORY_ICONS / NAME_ICON_RULES 换成按语义挑的图标（工程向，不用拟物图标）
//   4. 图标块去掉分类染色：整套图标只有「墨色」一档，白天近黑 / 夜晚近白
// 运行：node scripts/patch-tabler-icons.mjs [--src <@tabler/icons 的 icons/outline 目录>]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KEY_TO_TABLER, loadNormalized } from './lib/tabler-icons.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js')

const arg = process.argv.indexOf('--src')
const SRC = arg > 0
  ? path.resolve(process.argv[arg + 1])
  : path.join(os.tmpdir(), 'icon-research/tabler/package/icons/outline')

const ICONS = loadNormalized(SRC)

// ── 分类 → 键（语义优先，工程向）──
const CATEGORY_ICONS = {
  official: 'shield', ui: 'panel', panel: 'panel', theme: 'palette', market: 'store',
  session: 'session', memory: 'library', notify: 'bellring', tools: 'wrench', tool: 'wrench',
  dev: 'code', cli: 'terminal', skill: 'sparkle', search: 'search', workflow: 'workflow',
  auto: 'zap', mcp: 'plug', agent: 'robot', gateway: 'network', prompt: 'note',
  data: 'chart', storage: 'database', usage: 'gauge', model: 'cpu', browser: 'globe',
  docs: 'file', vision: 'eye', git: 'branch', voice: 'voice', image: 'image',
  identity: 'key', security: 'shield', remote: 'cloud', fun: 'flame', wsl: 'terminal',
  agi: 'orbit', network: 'network', web: 'globe', plugin: 'puzzle', other: 'puzzle',
}

// ── 插件名关键词 → 键（工程向，不使用拟物图标）──
const NAME_ICON_RULES = [
  ['sidebar|panel|deck|dock|popout|layout', 'panel'],
  ['terminal|tui|tty|shell|console', 'terminal'],
  ['token|usage|quota|context|meter|gauge', 'gauge'],
  ['cost|billing|ledger|price|pay|wallet|budget', 'coins'],
  ['memory|recall|hindsight|viking|misaka|notebook', 'library'],
  ['theme|skin|appearance|genui|paint|palette|color', 'palette'],
  ['image|vision|visual|screenshot|ocr|photo|camera', 'image'],
  ['git|commit|branch|merge', 'branch'],
  ['export|markdown|note|doc|file|archive|report', 'file'],
  ['import|registry|market|store', 'store'],
  ['share', 'share'],
  ['key|auth|identity|sso', 'key'],
  ['\bmcp\b', 'plug'],
  ['voice|audio|tts|speech|sing|music', 'audio'],
  ['browser|web|http|url|crawl|scrap', 'globe'],
  ['database|\bdbo?\b|sql|postgres|mysql|sqlite|redis', 'database'],
  ['workflow|flow|pipeline|n8n|orchestrat', 'workflow'],
  ['agent|team|crew|kingdom|swarm|multi', 'robot'],
  ['notify|pet|push|remind|alert|webhook', 'bellring'],
  ['search|serp|find|rag|retriev|query', 'search'],
  ['code|script|develop|compile|build|lint|debug', 'code'],
  ['timer|schedule|cron|interval', 'timer'],
  ['novel|writer|story|essay|writing', 'notes'],
  ['vault|password|secret|encrypt', 'shield'],
  ['monitor|watch|observ|metric|log|trace', 'eye'],
  ['translate|i18n|language|locale', 'map'],
  ['cloud|remote|tunnel|ssh|deploy', 'cloud'],
  ['proxy|network|route|gateway|dns', 'network'],
  ['docker|container|k8s|kubernetes|pod|helm', 'container'],
  ['dashboard|prometheus|grafana', 'chartbar'],
  ['sql|table|tableau|sheet', 'table'],
  ['keyboard|shortcut|hotkey|keybind', 'note'],
  ['timeline|history|journal|log', 'tree'],
]

let source = fs.readFileSync(CLIENT, 'utf8')

// 0) 键位完整性：调用点用到的键必须在表里
const usedKeys = new Set()
for (const m of source.matchAll(/icon\('([a-zA-Z0-9_-]+)'/g)) usedKeys.add(m[1])
for (const m of source.matchAll(/ICONS\.([a-zA-Z0-9_-]+)/g)) usedKeys.add(m[1])
const missing = [...usedKeys].filter((k) => !KEY_TO_TABLER[k])
if (missing.length) {
  console.error('键表缺少调用点用到的键：' + missing.join(', '))
  process.exit(1)
}

// 1) ICONS 表
const entries = Object.entries(KEY_TO_TABLER)
  .map(([key, tabler]) => `    ${key}: ${JSON.stringify(ICONS[tabler])},`)
  .join('\n')
const iconsBlock = `  /* Tabler 线性图标集（MIT 许可，https://tabler.io/icons）：24 网格 / 2 描边 /
     currentColor。每个图标都做了光学归一（按内容包围盒统一缩放并居中），因此各图标的
     视觉大小与线宽一致、在图标块里真正居中。path 数据由 @tabler/icons 的 icons/outline
     提取（scripts/patch-tabler-icons.mjs），键名沿用调用点旧名。 */
  const ICONS = {
${entries}
  }`
// ICONS 块整体替换（正则非贪婪匹配到 map 的收尾 '  }'，容忍其后粘连的注释）
const mapRe = /const ICONS = \{[\s\S]*?\n  \}[ \t]*/
if (!mapRe.test(source)) throw new Error('ICONS 块未找到')
source = source.replace(mapRe, 'const ICONS = {\n' + entries + '\n  }\n')

// 2) icon() 的展开器：支持 <g> 包裹 + React camelCase 属性
const oldExpand = `        ...(function expand() {
          // 极简形状展开器：lucide 的 path/circle/rect/line/polyline/polygon 转 vnode。
          const nodes = []
          const tokenRe = /<(path|rect|circle|line|polyline|polygon|ellipse)\\b([^>]*)\\/?>/g
          let m
          const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
          while ((m = tokenRe.exec(path))) {
            const attrs = {}
            let a
            while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2]
            nodes.push(h(m[1], { key: nodes.length, ...attrs }))
          }
          return nodes
        })()))`
const newExpand = `        ...(function expand() {
          /* 极简 SVG 展开器：图标数据形如 <g transform="…" stroke-width="…">…形状…</g>，
             展开成 vnode 而不是 innerHTML（避免 React 告警与注入面）。
             属性名转 React 的 camelCase（stroke-width → strokeWidth）。 */
          const SVG_ATTR = { 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin' }
          const nodes = []
          const groupRe = /^<g\\s([^>]*)>([\\s\\S]*)<\\/g>$/
          const shapeRe = /<(path|rect|circle|line|polyline|polygon|ellipse)\\b([^>]*?)\\/?>/g
          const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
          const group = path.match(groupRe)
          const groupAttrs = {}
          let ga
          while ((ga = attrRe.exec(group[1]))) groupAttrs[SVG_ATTR[ga[1]] || ga[1]] = ga[2]
          let m
          while ((m = shapeRe.exec(group[2]))) {
            const attrs = {}
            let a
            while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2]
            nodes.push(h(m[1], { key: nodes.length, ...attrs }))
          }
          return [h('g', { key: 'g', ...groupAttrs }, ...nodes)]
        })()))`
if (source.includes(oldExpand)) source = source.replace(oldExpand, newExpand)
else if (!source.includes('const SVG_ATTR')) throw new Error('icon() 展开器未找到')

// 3) CATEGORY_ICONS
const catStart = source.indexOf('  const CATEGORY_ICONS = {')
const catEnd = source.indexOf('\n  }', catStart)
if (catStart < 0 || catEnd < 0) throw new Error('CATEGORY_ICONS 未找到')
source = source.slice(0, catStart) + '  const CATEGORY_ICONS = {\n' +
  Object.entries(CATEGORY_ICONS).map(([k, v]) => `    ${k}: '${v}',`).join('\n') +
  source.slice(catEnd)

// 4) NAME_ICON_RULES
const rulesStart = source.indexOf('  const NAME_ICON_RULES = [')
const rulesEnd = source.indexOf('\n  ]', rulesStart)
if (rulesStart < 0 || rulesEnd < 0) throw new Error('NAME_ICON_RULES 未找到')
source = source.slice(0, rulesStart) + '  const NAME_ICON_RULES = [\n' +
  NAME_ICON_RULES.map(([p, n]) => `    ['${p}', '${n}'],`).join('\n') +
  source.slice(rulesEnd)

// 5) 去掉分类染色（幂等：打过补丁的文件里 hue 段已不存在，直接跳过）
const hueStart = source.indexOf('  /* 分类 → 色相（v3 配色）')
if (hueStart >= 0) {
  const hueEnd = source.indexOf('  const PAGE_SIZE', hueStart)
  if (hueEnd < 0) throw new Error('CATEGORY_HUES 未找到')
  source = source.slice(0, hueStart) +
    '  /* 图标不再按分类染色：整套图标只有「墨色」一档（继承 label-primary），白天近黑、夜晚近白。 */\n' +
    source.slice(hueEnd)
  source = source.replace(/  const categoryHue = category => 'dsh-pm-hue-' \+ \(CATEGORY_HUES\[category\] \|\| 'neutral'\)\n/, '')
  source = source.replace(/^\.dsh-pm-icon-tile\.dsh-pm-hue-.*\n/gm, '')
  source = source.replace(/\$\{categoryHue\([^)]*\)\}/g, '')
  source = source.replace(/\$\{hue\}/g, '')
  source = source.replace(/  const hue = categoryHue\(plugin\.category\)\n/, '')
  source = source.replace(/className: `dsh-pm-icon-tile dsh-pm-icon-md `/g, "className: 'dsh-pm-icon-tile dsh-pm-icon-md'")
  source = source.replace(/className: `dsh-pm-card-chip `/g, "className: 'dsh-pm-card-chip'")
  source = source.replace(/className: `dsh-pm-icon-tile dsh-pm-icon-sm `/g, "className: 'dsh-pm-icon-tile dsh-pm-icon-sm'")
  source = source.replace(/className: `dsh-pm-icon-tile dsh-pm-icon-lg `/g, "className: 'dsh-pm-icon-tile dsh-pm-icon-lg'")
}

// 6) 分类注释与图标块/chip 的文字色固定为中性（幂等：已带 color 就不再注入）
source = source.replace('/* 分类 → 图标与展示名（与 magpie 的 kind chip 同思路：图标着色区分类型）。 */',
  '/* 分类 → 图标与展示名：图标只有「墨色」一档，不按分类着色。 */')
source = source.replace(/\/\* 分类 → 图标与展示名：图标只有「墨色」一档，不按分类着色。 \*\/\n  const CATEGORY_ICONS = \{\n(?!)/,
  '/* 分类 → 图标与展示名：图标只有「墨色」一档，不按分类着色。 */\n  const CATEGORY_ICONS = {\n')
if (!source.includes('.dsh-pm-icon-tile{align-items:center;color:var(--dsw-alias-label-primary);')) {
  source = source.replace('.dsh-pm-icon-tile{align-items:center;',
    '.dsh-pm-icon-tile{align-items:center;color:var(--dsw-alias-label-primary);')
}
if (!source.includes('.dsh-pm-card-chip{align-items:center;color:var(--dsw-alias-label-secondary);')) {
  source = source.replace('.dsh-pm-card-chip{align-items:center;',
    '.dsh-pm-card-chip{align-items:center;color:var(--dsw-alias-label-secondary);')
}

fs.writeFileSync(CLIENT, source, 'utf8')
console.log('patched client.js:', Object.keys(KEY_TO_TABLER).length, 'icons,',
  Object.keys(CATEGORY_ICONS).length, 'categories,', NAME_ICON_RULES.length, 'name rules')

// ── 归档管理插件：同一套图标，避免同一产品里混两套图标体系 ──
const ARCHIVE = path.join(ROOT, 'Plugins/DSHArchiveManager/client/client.js')
if (fs.existsSync(ARCHIVE)) {
  let arch = fs.readFileSync(ARCHIVE, 'utf8')
  const archKeys = { search: 'search', archive: 'archive', restore: 'rotate-clockwise' }
  const archIcons = loadNormalized(SRC, Object.values(archKeys))
  const archMissing = Object.values(archKeys).filter((n) => !archIcons[n])
  if (archMissing.length) throw new Error('归档插件缺少图标: ' + archMissing.join(', '))

  const archBlock = `  // Tabler 线性图标（MIT 许可，https://tabler.io/icons）：24 网格 / 2 描边，
  // 与插件管理同一套体系；每个图标都做了光学归一（内容包围盒统一缩放并居中）。
  const ICON_PATHS = {
${Object.entries(archKeys).map(([k, n]) => `    ${k}: ${JSON.stringify(archIcons[n])},`).join('\n')}
  }`
  // 注释 + ICON_PATHS 块整体替换（允许连续注释行；匹配到收尾 '  }'，容忍其后粘连）
  const archMapRe = /  \/\/ (?:Lucide|Tabler) 线性图标[^\n]*\n(?:  \/\/[^\n]*\n)*  const ICON_PATHS = \{[\s\S]*?\n  \}[ \t]*/
  if (!archMapRe.test(arch)) throw new Error('归档插件 ICON_PATHS 块未找到')
  arch = arch.replace(archMapRe, archBlock + '\n')

  const oldArchExpand = `    const nodes = []
    const tokenRe = /<(path|rect|circle)\\b([^>]*)\\/?>/g
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
    let m
    while ((m = tokenRe.exec(path))) {
      const attrs = {}
      let a
      while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2]
      nodes.push(h(m[1], { key: nodes.length, ...attrs }))
    }`
  const newArchExpand = `    const nodes = []
    // 图标数据形如 <g transform="…" stroke-width="…">…形状…</g>（光学归一）；属性名转 React camelCase
    const SVG_ATTR = { 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin' }
    const groupRe = /^(?:<g\\s([^>]*)>)?([\\s\\S]*?)(?:<\\/g>)?$/
    const tokenRe = /<(path|rect|circle|line|polyline|polygon|ellipse)\\b([^>]*?)\\/?>/g
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
    const group = String(path).match(groupRe)
    const groupAttrs = {}
    let ga
    while ((ga = attrRe.exec(group[1]))) groupAttrs[SVG_ATTR[ga[1]] || ga[1]] = ga[2]
    let m
    const shapes = []
    while ((m = tokenRe.exec(group[2]))) {
      const attrs = {}
      let a
      while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2]
      shapes.push(h(m[1], { key: shapes.length, ...attrs }))
    }
    nodes.push(h('g', { key: 'g', ...groupAttrs }, ...shapes))`
  if (arch.includes(oldArchExpand)) arch = arch.replace(oldArchExpand, newArchExpand)
  else if (!arch.includes("nodes.push(h('g'")) throw new Error('归档插件展开器未找到')

  fs.writeFileSync(ARCHIVE, arch, 'utf8')
  console.log('patched archive client:', Object.keys(archKeys).length, 'icons')
}
