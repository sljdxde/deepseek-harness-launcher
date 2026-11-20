// 把 Lucide 图标集接进 DSHPluginManager/client.js：
//   1. ICON_PATHS（手绘 16 网格）→ ICONS（lucide 24 网格原始 path 数据）
//   2. icon() 改 24 viewBox / 描边 2（lucide 官方口径），解析器支持全部形状标签
//   3. CATEGORY_ICONS 换成更丰富的 lucide 映射
//   4. 新增 NAME_ICON_RULES + pluginIcon：按插件名称关键词给专属图标（magpie 式）
//   5. 卡片渲染点从 categoryIcon(plugin.category) 改 pluginIcon(plugin)
// 运行：node scripts/patch-lucide-icons.js
const fs = require('fs')

const clientPath = 'Plugins/DSHPluginManager/client/client.js'
const icons = JSON.parse(fs.readFileSync('windows/docs/lucide-icons.json', 'utf8'))

// 调用点沿用旧键名，值换成 lucide 图标；新增更丰富的键供分类/名称规则用。
const KEY_MAP = {
  search: 'search', refresh: 'refresh-cw', plus: 'plus', check: 'check',
  shield: 'shield-check', x: 'x', chev: 'chevron-right', expand: 'maximize-2',
  collapse: 'minimize-2', back: 'chevron-left', sparkle: 'sparkles',
  download: 'download', star: 'star', cube: 'box', compass: 'compass',
  bell: 'bell', globe: 'globe', chart: 'chart-column', zap: 'zap',
  hdd: 'hard-drive', layers: 'layers', server: 'server', puzzle: 'puzzle',
  archive: 'archive', branch: 'git-branch', message: 'message-square',
  palette: 'palette', workflow: 'workflow', robot: 'bot', gear: 'settings',
  // 新增（分类映射与名称规则用）
  panel: 'layout-panel-left', terminal: 'square-terminal', cpu: 'cpu',
  brain: 'brain', database: 'database', code: 'square-code', brackets: 'brackets',
  gauge: 'gauge', store: 'store', plug: 'plug', network: 'network',
  wrench: 'wrench', book: 'book-open', key: 'key-round', share: 'share-2',
  eye: 'eye', eyeoff: 'eye-off', image: 'image', mic: 'mic', coins: 'coins',
  folder: 'folder-open', pkg: 'package', file: 'file-text', activity: 'activity',
  flame: 'flame', rocket: 'rocket', bulb: 'lightbulb', cloud: 'cloud-upload',
  timer: 'timer', user: 'user-round', session: 'messages-square',
  audio: 'audio-lines', cable: 'cable', scan: 'scan-eye', voice: 'mic-vocal',
  notes: 'notebook-pen', tree: 'folder-tree', commit: 'git-commit-horizontal',
  route: 'route', waypoints: 'waypoints', map: 'map', paint: 'paintbrush',
  note: 'sticky-note', orbit: 'orbit', blocks: 'blocks', todo: 'list-todo',
  bellring: 'bell-ring', table: 'table', sliders: 'sliders-horizontal',
  filter: 'list-filter', info: 'info', warn: 'triangle-alert',
}

const entries = Object.entries(KEY_MAP).map(([key, lucide]) => {
  const markup = icons[lucide]
  if (!markup) throw new Error('lucide icon missing: ' + lucide)
  return `    ${key}: ${JSON.stringify(markup)},`
}).join('\n')

const ICONS_BLOCK = `  /* Lucide 线性图标集（ISC 许可，https://lucide.dev）：24 网格 / 2 描边 /
     currentColor。path 数据由 lucide-static v1.74.0 提取（scripts/patch-lucide-icons.js），
     键名沿用调用点旧名（chev/back/...），新增更丰富的键供分类与名称规则用。 */
  const ICONS = {
${entries}
  }`

let source = fs.readFileSync(clientPath, 'utf8')

// 1) 替换 ICON_PATHS 块（注释 + 对象）
const startMarker = '  /* SVG 线性图标集（16 网格 / 1.5 描边 / currentColor）：分类、榜单与工具按钮'
const endMarker = '    gear: \'<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.9 3.9l1.4 1.4M10.7 10.7l1.4 1.4M12.1 3.9l-1.4 1.4M5.3 10.7l-1.4 1.4"/>\',\n  }'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker)
if (start < 0 || end < 0) throw new Error('ICON_PATHS block not found')
source = source.slice(0, start) + ICONS_BLOCK + source.slice(end + endMarker.length)

// 2) 重写 icon()：24 网格 / 描边 2 / 全形状标签
const oldIconFn = `  /**
   * 渲染一个线性 SVG 图标节点。name 是 ICON_PATHS 的键；size 是像素边长。
   * aria-hidden 恒真：图标永远伴随可见文字或 aria-label，不单独承载语义。
   */
  function icon(name, size = 14) {
    const path = ICON_PATHS[name] || ICON_PATHS.puzzle
    return h('span', { className: 'dsh-pm-ic', 'aria-hidden': true },
      h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', dangerouslySetInnerHTML: undefined },
        // h() 是 createElement：path 内容直接用 dangerouslySetInnerHTML 会带来
        // React 告警；这里 path 是本文件写死的字符串，用 <g> 包一层
        // 或干脆用 innerHTML 都可以，但为了走 createElement，展开成子节点：
        ...(function expand() {
          // 极简 path 展开器：把 ICON_PATHS 的 d/rect/circle 标记转成 vnode 数组。
          const nodes = []
          const tokenRe = /<(path|rect|circle)\\b([^>]*)\\/?>|<path\\b([^>]*)\\/>/g
          let m
          const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
          while ((m = tokenRe.exec(path))) {
            const tag = m[1]
            const attrs = {}
            let a
            const attrText = m[2] ?? m[3] ?? ''
            while ((a = attrRe.exec(attrText))) attrs[a[1]] = a[2]
            nodes.push(h(tag, { key: nodes.length, ...attrs }))
          }
          return nodes
        })()))
  }`
const newIconFn = `  /**
   * 渲染一个线性 SVG 图标节点。name 是 ICONS 的键（lucide 图标名）；
   * size 是像素边长。aria-hidden 恒真：图标永远伴随可见文字或 aria-label。
   */
  function icon(name, size = 14) {
    const path = ICONS[name] || ICONS.puzzle
    return h('span', { className: 'dsh-pm-ic', 'aria-hidden': true },
      h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        // h() 是 createElement：path 内容是本文件写死的 lucide 数据字符串，
        // 展开成子节点而不是 innerHTML（避免 React 告警与注入面）：
        ...(function expand() {
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
        })()))
  }`
if (!source.includes(oldIconFn)) throw new Error('icon() block not found')
source = source.replace(oldIconFn, newIconFn)

// 3) CATEGORY_ICONS 换成 lucide 映射（更丰富、每个分类都有辨识度）
const oldCats = `  const CATEGORY_ICONS = {
    official: 'shield', browser: 'globe', tool: 'gear', ui: 'palette', storage: 'hdd',
    workflow: 'workflow', agent: 'robot', search: 'search', data: 'chart',
    network: 'globe', dev: 'cube', panel: 'layers', notify: 'bell', auto: 'zap',
    message: 'message', store: 'archive', other: 'puzzle',
  }`
const newCats = `  const CATEGORY_ICONS = {
    official: 'shield', ui: 'panel', panel: 'panel', theme: 'palette', market: 'store',
    session: 'session', memory: 'brain', notify: 'bellring', tools: 'wrench', tool: 'wrench',
    dev: 'code', cli: 'terminal', skill: 'sparkle', search: 'search', workflow: 'workflow',
    auto: 'zap', mcp: 'plug', agent: 'robot', gateway: 'network', prompt: 'note',
    data: 'chart', storage: 'database', usage: 'gauge', model: 'cpu', browser: 'globe',
    docs: 'file', vision: 'eye', git: 'branch', voice: 'audio', image: 'image',
    identity: 'key', security: 'shield', remote: 'cloud', fun: 'flame', wsl: 'terminal',
    agi: 'orbit', network: 'network', web: 'globe', plugin: 'puzzle', other: 'puzzle',
  }`
if (!source.includes(oldCats)) throw new Error('CATEGORY_ICONS block not found')
source = source.replace(oldCats, newCats)

// 4) 名称 → 专属图标（magpie 式：每行一个有辨识度的图标），插在 categoryIcon 之后
const catIconLine = `  const categoryIcon = category => CATEGORY_ICONS[category] || 'puzzle'`
const nameRules = `${catIconLine}
  /* 插件名关键词 → 专属图标：卡片图标不再只看分类（同分类全是一个图标），
     按名称给有辨识度的那个（sidebar→侧栏、terminal→终端、token→仪表盘…），
     没命中再回落分类图标。规则按特异性排序，先命中先用。 */
  const NAME_ICON_RULES = [
    ['sidebar|panel|deck|dock|popout', 'panel'],
    ['terminal|tui|tty|shell', 'terminal'],
    ['token|usage|quota|context|meter', 'gauge'],
    ['cost|billing|ledger|price|pay|wallet', 'coins'],
    ['memory|recall|hindsight|viking|misaka', 'brain'],
    ['theme|skin|appearance|genui|paint', 'palette'],
    ['image|vision|visual|screenshot|ocr|photo', 'image'],
    ['git|commit', 'branch'],
    ['export|markdown|note|doc|file|archive', 'file'],
    ['import|registry|market|store', 'store'],
    ['share', 'share'],
    ['key|auth|identity|sso', 'key'],
    ['\\bmcp\\b', 'plug'],
    ['voice|audio|tts|speech|sing', 'audio'],
    ['browser|web|http', 'globe'],
    ['database|\\bdbo?\\b|sql', 'database'],
    ['workflow|flow|pipeline|n8n', 'workflow'],
    ['agent|team|crew|kingdom|swarm|multi', 'robot'],
    ['notify|pet|push|remind', 'bellring'],
    ['search|serp|find|rag', 'search'],
    ['code|script|develop', 'code'],
    ['timer|schedule|cron|remind', 'timer'],
    ['novel|writer|story|essay', 'notes'],
    ['vault|password|safe', 'shield'],
    ['monitor|watch|observ', 'eye'],
    ['translate|i18n', 'map'],
    ['cloud|remote|tunnel', 'cloud'],
    ['proxy|network|route', 'network'],
  ]
  const pluginIcon = plugin => {
    const text = (String(plugin?.repo || '') + ' ' + String(plugin?.name || '')).toLowerCase()
    for (const [pattern, name] of NAME_ICON_RULES) {
      if (new RegExp(pattern).test(text)) return name
    }
    return categoryIcon(plugin?.category)
  }`
if (!source.includes(catIconLine)) throw new Error('categoryIcon line not found')
source = source.replace(catIconLine, nameRules)

// 5) 卡片图标点换 pluginIcon（chip 是分类标签，保持 categoryIcon）
const callSites = [
  ["h('div', { className: `dsh-pm-card-icon ${hue}` }, icon(categoryIcon(plugin.category), 17)),",
   "h('div', { className: `dsh-pm-card-icon ${hue}` }, icon(pluginIcon(plugin), 18)),"],
  ["h('div', { className: `dsh-pm-card-icon ${categoryHue(plugin.category)}`, style: { flex: 'none', width: '28px', height: '28px', borderRadius: '8px' } }, icon(categoryIcon(plugin.category), 14)),",
   "h('div', { className: `dsh-pm-card-icon ${categoryHue(plugin.category)}`, style: { flex: 'none', width: '28px', height: '28px', borderRadius: '8px' } }, icon(pluginIcon(plugin), 16)),"],
  ["h('div', { className: `dsh-pm-card-icon ${categoryHue(hero.category)}`, style: { flex: 'none', width: '52px', height: '52px', borderRadius: '14px' } }, icon(categoryIcon(hero.category), 26)),",
   "h('div', { className: `dsh-pm-card-icon ${categoryHue(hero.category)}`, style: { flex: 'none', width: '52px', height: '52px', borderRadius: '14px' } }, icon(pluginIcon(hero), 30)),"],
  ["h('div', { className: `dsh-pm-card-icon ${categoryHue(item.category)}`, style: { flex: 'none', width: '32px', height: '32px', borderRadius: '9px' } }, icon(categoryIcon(item.category), 16)),",
   "h('div', { className: `dsh-pm-card-icon ${categoryHue(item.category)}`, style: { flex: 'none', width: '32px', height: '32px', borderRadius: '9px' } }, icon(pluginIcon(item), 18)),"],
]
for (const [oldCall, newCall] of callSites) {
  if (!source.includes(oldCall)) throw new Error('call site not found: ' + oldCall.slice(0, 60))
  source = source.replace(oldCall, newCall)
}

fs.writeFileSync(clientPath, source)
console.log('client.js icon system rewritten: ICONS', Object.keys(KEY_MAP).length, 'keys')
