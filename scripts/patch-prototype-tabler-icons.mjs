// 把插件中心 HTML 原型的图标切成 Tabler 光学归一化图标集（MIT）
//   node scripts/patch-prototype-tabler-icons.mjs [--src <@tabler/icons 的 icons/outline 目录>]
// 说明：
//   - 键名与插件管理器共用一套词汇（scripts/lib/tabler-icons.mjs）
//   - 光学归一化：按内容包围盒统一缩放并精确居中，各图标视觉大小/线宽一致
//   - 分类与插件名的语义映射在这里集中维护
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { KEY_TO_TABLER, loadNormalized } from './lib/tabler-icons.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = path.join(ROOT, 'windows/docs/plugin-center-restyle-prototype.html')

const arg = process.argv.indexOf('--src')
const SRC = arg > 0
  ? path.resolve(process.argv[arg + 1])
  : path.join(os.tmpdir(), 'icon-research/tabler/package/icons/outline')

const ICONS = loadNormalized(SRC)

// ── 原型里的插件 → 键（语义优先，工程向）──
const PLUGIN_ICONS = {
  'dsh-market': 'store',
  'modlens': 'sliders',
  'DSH-better-sidebar': 'panel',
  'dsh-TUI': 'terminal',
  'archify#integrations': 'archive',
  'dsh-agent-settings': 'gear',
  'dsh-session-export': 'file',
  'dsh-theme-sync': 'palette',
  'dsh-global-hotkey': 'key',
  'dsh-log-viewer': 'notes',
  'OpenViking#examples': 'library',
  'hindsight#coding-agents': 'tree',
  'DSHPluginManager': 'puzzle',
  'DSHChinaMirror': 'route',
  'dsh-welcome': 'rocket',
  'dsh-update-check': 'refresh',
  'dsh-quick-open': 'zap',
}

// ── 静态占位符 → 键（旧的 Tabler 图标名 → 共享键名）──
const STATIC_ICONS = {
  'arrows-maximize': 'expand', 'sun-moon': 'sun', 'compass': 'compass', 'package': 'cube',
  'download': 'install', 'book-2': 'book', 'bulb': 'sparkle', 'search': 'search',
  'building-store': 'store', 'rosette-discount-check': 'shield', 'color-picker': 'palette',
  'layout-sidebar-left-expand': 'panel', 'library': 'library', 'timeline': 'tree',
  'archive': 'archive', 'terminal-2': 'terminal', 'adjustments': 'sliders',
  'external-link': 'external', 'plus': 'plus', 'confetti': 'rocket',
}

// ── 静态占位符的尺寸（与内置/已安装同一视觉比例）──
const SIZE = {
  expand: 14, sun: 14, compass: 16, cube: 16, install: 12, book: 16,
  sparkle: 16, search: 13, store: 16, shield: 12, palette: 16, panel: 16,
  library: 16, tree: 16, archive: 16, terminal: 16, sliders: 16, external: 12, plus: 12,
}

let h = fs.readFileSync(TARGET, 'utf8')

// 1) ICONS 表
const entries = Object.entries(KEY_TO_TABLER)
  .map(([key, tabler]) => `  ${key}: ${JSON.stringify(ICONS[tabler])},`)
  .join('\n')
const block = `/* Tabler 线性图标集（MIT 许可，https://tabler.io/icons）：24 网格 / 2 描边 / currentColor。
   每个图标都做了光学归一化（内容包围盒统一缩放并居中），因此各图标的视觉大小一致、
   在图标块里真正居中；键名与插件管理器共用一套词汇，两边可机械对齐。 */
const ICONS = {
${entries}
};`
h = h.replace(/const ICONS = \{[\s\S]*?\n\};/, block)

// 2) 静态占位符换键 + 尺寸
h = h.replace(/data-ic="([a-z0-9-]+)" data-size="(\d+)"/g, (m, name, size) => {
  const to = STATIC_ICONS[name]
  if (!to) return m
  return `data-ic="${to}" data-size="${SIZE[to] ?? size}"`
})

// 3) 演示数据的 iconKey 换键
for (const [name, key] of Object.entries(PLUGIN_ICONS)) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(\\{name:"${esc}",[^}]*?iconKey:")[a-z0-9-]+(")`)
  if (!re.test(h)) { console.log('  ! 未匹配:', name); continue }
  h = h.replace(re, `$1${key}$2`)
}

// 4) 手动安装占位插件的图标
h = h.replace(/by:"手动安装",cat:"其他",iconKey:"[a-z0-9-]+"/, 'by:"手动安装",cat:"其他",iconKey:"pkg"')

// 5) 主题按钮用的 sun / moon 键
h = h.replace(/ICONS\[dark\?"sun":"moon"\]\|\|ICONS\["[a-z0-9-]+"\]/, 'ICONS[dark?"moon":"sun"]')

// 6) 发现页图标块比例：卡片 36px 块 + 21px 图标、推荐位 44px 块 + 26px 图标
//    （与内置/已安装的 28px 块 + 16px 图标同一视觉比例，图标不再在块里发飘）
h = h.replace(/(<span class="logo"><span class="ic" data-ic="[a-z0-9-]+" data-size=")\d+(")/g, '$121$2')
h = h.replace(/(<span class="logo big"><span class="ic" data-ic="[a-z0-9-]+" data-size=")\d+(")/g, '$126$2')
h = h.replace('<span class="logo">${icon(p,19)}</span>', '<span class="logo">${icon(p,21)}</span>')

fs.writeFileSync(TARGET, h, 'utf8')
console.log('prototype icons:', Object.keys(KEY_TO_TABLER).length, 'keys (normalized)')
