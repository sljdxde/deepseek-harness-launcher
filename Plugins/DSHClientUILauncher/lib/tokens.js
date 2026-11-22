/**
 * 设计令牌（票 30）：日夜两套基础色 + 外壳尺寸 + 生成 CSS。
 *
 * 为什么独立成模块：颜色是「单测能验、视觉能对」的纯数据，放进 client 里就没法在
 * Node 侧跑 WCAG 门禁。这里只产出数据和 CSS 字符串，落地交给 client 的 ensureStyle。
 *
 * 色值基线来自 docs/ui-rebuild/prototype/dsh-ui-merged-v17.html（人类确认版），
 * 只搬基础色板，不搬业务组件样式（那些是 31-34 的活）。
 */

/** 日夜两套令牌。键名即 CSS 变量 `--l-<key>`。 */
export const LAUNCHER_TOKENS = Object.freeze({
  light: Object.freeze({
    bg: '#f4f1e9',
    bg2: '#eeeae0',
    panel: '#faf8f3',
    surface: '#fffdf8',
    surface2: '#f1ede3',
    surface3: '#e6e1d3',
    line: 'rgba(27,28,25,.10)',
    line2: 'rgba(27,28,25,.18)',
    ink: '#1b1c19',
    ink2: '#4c4d46',
    ink3: '#615f56',
    ink4: '#67645a',
    accent: '#3a55c8',
    accentSoft: 'rgba(58,85,200,.10)',
    onAccent: '#ffffff',
    hover: 'rgba(27,28,25,.055)',
    hover2: 'rgba(27,28,25,.09)',
    tip: '#2c2c2e',
    tipInk: '#ffffff',
    amber: '#7a4d12',
    green: '#2c7458',
    greenSoft: '#dcebe3',
    red: '#ab3f36',
  }),
  dark: Object.freeze({
    bg: '#121316',
    bg2: '#15171a',
    panel: '#17191e',
    surface: '#1b1d21',
    surface2: '#22252a',
    surface3: '#2b2e34',
    line: 'rgba(255,255,255,.08)',
    line2: 'rgba(255,255,255,.15)',
    ink: '#edebe3',
    ink2: '#b8b6ac',
    ink3: '#a5a399',
    ink4: '#9a978c',
    accent: '#93a8ff',
    accentSoft: 'rgba(147,168,255,.13)',
    onAccent: '#101216',
    hover: 'rgba(255,255,255,.06)',
    hover2: 'rgba(255,255,255,.10)',
    tip: '#33363c',
    tipInk: '#f4f2ec',
    amber: '#f0bd85',
    green: '#5ec9a6',
    greenSoft: '#1e3a31',
    red: '#f18c81',
  }),
})

/** 外壳尺寸（v17 冻结值）：图标栏 56、预置侧栏 280、状态条 26、行高 32。 */
export const SHELL_METRICS = Object.freeze({
  rail: 56,
  sidebar: 280,
  status: 26,
  row: 32,
  radiusXs: 6,
  radiusSm: 8,
  radius: 10,
  radiusMd: 12,
  iconStroke: 1.7,
})

/**
 * 要过 AA 的文字/底色组合。正文（ink）与次要（ink2/ink3）都要 ≥ 4.5:1。
 * 名称用于报告，fg/bg 是 LAUNCHER_TOKENS 的键。
 */
export const TEXT_PAIRS = Object.freeze([
  Object.freeze({ name: '正文', fg: 'ink', bg: 'bg' }),
  Object.freeze({ name: '正文（面板）', fg: 'ink', bg: 'panel' }),
  Object.freeze({ name: '次要文字', fg: 'ink2', bg: 'bg' }),
  Object.freeze({ name: '次要文字（面板）', fg: 'ink2', bg: 'panel' }),
  Object.freeze({ name: '弱化文字', fg: 'ink3', bg: 'bg2' }),
  Object.freeze({ name: '弱化文字（面板）', fg: 'ink3', bg: 'panel' }),
  Object.freeze({ name: '正文（卡片）', fg: 'ink', bg: 'surface' }),
  Object.freeze({ name: '弱化文字（浅底）', fg: 'ink3', bg: 'bg' }),
  Object.freeze({ name: '辅助文字', fg: 'ink4', bg: 'bg' }),
  Object.freeze({ name: '辅助文字（面板）', fg: 'ink4', bg: 'panel' }),
  Object.freeze({ name: '强调文字', fg: 'accent', bg: 'bg' }),
  Object.freeze({ name: '强调文字（面板）', fg: 'accent', bg: 'panel' }),
  Object.freeze({ name: '主按钮文字', fg: 'onAccent', bg: 'accent' }),
  Object.freeze({ name: '提示冒泡文字', fg: 'tipInk', bg: 'tip' }),
  Object.freeze({ name: '计划完成态', fg: 'green', bg: 'greenSoft' }),
  Object.freeze({ name: '审批强调', fg: 'amber', bg: 'surface' }),
  Object.freeze({ name: '危险文字', fg: 'red', bg: 'surface' }),
])

/** WCAG AA 正文最小对比度。 */
export const CONTRAST_MIN = 4.5

/** 取某个模式的令牌表；非法模式退回 light（渲染不能因为一个坏字符串白屏）。 */
export function themeTokens(mode) {
  return mode === 'dark' ? LAUNCHER_TOKENS.dark : LAUNCHER_TOKENS.light
}

/**
 * 解析 #rrggbb / #rgb 为 [r,g,b]；其它格式（rgba/命名色）返回 null。
 * @param {string} value - 颜色字面量。
 * @returns {[number, number, number] | null} 分量，或不可解析。
 */
export function parseColor(value) {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  if (hex.length === 3) {
    return hex.split('').map((ch) => parseInt(ch + ch, 16))
  }
  if (hex.length === 6) {
    return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16))
  }
  return null
}

/** WCAG 相对亮度。 */
export function relativeLuminance(color) {
  const rgb = Array.isArray(color) ? color : parseColor(color)
  if (rgb === null || rgb !== undefined && rgb.some((c) => !Number.isFinite(c))) {
    return Number.NaN
  }
  const channel = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

/** 两色对比度（1..21）。任一不可解析返回 NaN。 */
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * 某模式的对比度报告。
 * @param {'light'|'dark'} [mode] - 模式。
 * @returns {Array<{ name: string, fg: string, bg: string, ratio: number, pass: boolean }>} 每组的比值与是否过 AA。
 */
export function contrastReport(mode = 'light') {
  const tokens = themeTokens(mode)
  return TEXT_PAIRS.map((pair) => {
    const ratio = contrastRatio(tokens[pair.fg], tokens[pair.bg])
    return { name: pair.name, fg: tokens[pair.fg], bg: tokens[pair.bg], ratio, pass: ratio >= CONTRAST_MIN }
  })
}

/** 单个模式的变量声明（不含选择器）。 */
function declarations(tokens) {
  const lines = []
  for (const [key, value] of Object.entries(tokens)) {
    lines.push(`--l-${key}:${value}`)
  }
  lines.push(`--l-rail:${SHELL_METRICS.rail}px`)
  lines.push(`--l-sidebar:${SHELL_METRICS.sidebar}px`)
  lines.push(`--l-status:${SHELL_METRICS.status}px`)
  lines.push(`--l-row:${SHELL_METRICS.row}px`)
  lines.push(`--l-radius-xs:${SHELL_METRICS.radiusXs}px`)
  lines.push(`--l-radius-sm:${SHELL_METRICS.radiusSm}px`)
  lines.push(`--l-radius:${SHELL_METRICS.radius}px`)
  lines.push(`--l-radius-md:${SHELL_METRICS.radiusMd}px`)
  lines.push(`--l-icon-stroke:${SHELL_METRICS.iconStroke}`)
  return lines.join(';')
}

/**
 * 作用域令牌 CSS：基础（light）+ 显式 light/dark 两个选择器。
 * 全部挂在 `.launcher-shell` 上，不碰宿主 html/body。
 * @returns {string} CSS 文本。
 */
export function tokensCss() {
  return [
    `.launcher-shell{${declarations(LAUNCHER_TOKENS.light)}}`,
    `.launcher-shell[data-theme="light"]{${declarations(LAUNCHER_TOKENS.light)}}`,
    `.launcher-shell[data-theme="dark"]{${declarations(LAUNCHER_TOKENS.dark)}}`,
  ].join('\n')
}

/**
 * 外壳骨架样式（v17）：图标栏、状态条、主区/侧栏/右栏的发丝边与底色。
 * 只搬骨架的版式与颜色，不搬业务面板内部。选择器全部带 `.launcher-` 外壳作用域。
 * @returns {string} CSS 文本。
 */
export function skeletonCss() {
  return [
    // 外壳：整页铺满、无横向溢出
    '.launcher-shell{background:var(--l-bg);color:var(--l-ink);overflow:hidden}',
    // 图标栏（56px）：底色 bg2、右侧发丝边
    '.launcher-rail{background:var(--l-bg2);border-right:1px solid var(--l-line);gap:2px;padding:10px 0 8px;align-items:center}',
    '.launcher-rail__logo{width:30px;height:30px;border-radius:50%;background:var(--l-ink);color:var(--l-bg);display:grid;place-items:center;margin-bottom:8px;border:0;cursor:pointer}',
    '.launcher-rail__logo svg{width:16px;height:16px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-rail__entry{position:relative;width:38px;height:38px;border-radius:var(--l-radius);color:var(--l-ink3);display:grid;place-items:center;background:transparent;border:0;cursor:pointer}',
    '.launcher-rail__entry:hover{background:var(--l-hover);color:var(--l-ink)}',
    '.launcher-rail__entry.on{background:var(--l-surface3);color:var(--l-ink)}',
    '.launcher-rail__entry.on::before{content:\'\';position:absolute;left:-9px;top:10px;bottom:10px;width:2px;border-radius:2px;background:var(--l-accent)}',
    '.launcher-rail__entry svg{width:20px;height:20px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-rail__entry[aria-disabled="true"]{opacity:.4;cursor:not-allowed}',
    '.launcher-rail__badge{position:absolute;top:4px;right:4px;min-width:15px;height:15px;border-radius:8px;background:var(--l-accent);color:var(--l-onAccent);font-size:11px;line-height:15px;text-align:center;padding:0 3px}',
    '.launcher-rail__tip{position:absolute;left:calc(100% + 9px);top:50%;transform:translateY(-50%);padding:4px 8px;border-radius:var(--l-radius-xs);background:var(--l-tip);color:var(--l-tipInk);font-size:11px;white-space:nowrap;opacity:0;pointer-events:none;z-index:90}',
    '.launcher-rail__entry:hover .launcher-rail__tip,.launcher-rail__entry:focus-visible .launcher-rail__tip{opacity:1}',
    '.launcher-rail__spacer{flex:1}',
    '.launcher-rail__action{width:38px;height:38px;border-radius:var(--l-radius);color:var(--l-ink3);display:grid;place-items:center;background:transparent;border:0;cursor:pointer}',
    '.launcher-rail__action:hover{background:var(--l-hover);color:var(--l-ink)}',
    '.launcher-rail__action svg{width:20px;height:20px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    // 侧栏/主区/右栏：底色与发丝边
    '.launcher-sidebar{background:var(--l-bg);border-right:1px solid var(--l-line)}',
    '.launcher-main{background:var(--l-bg)}',
    '.launcher-dock{background:var(--l-panel);border-left:1px solid var(--l-line)}',
    // 状态条（26px）：底色 bg2、上发丝边、弱化文字
    '.launcher-statusbar{background:var(--l-bg2);border-top:1px solid var(--l-line);color:var(--l-ink3);height:var(--l-status);gap:12px;padding:0 12px;font-size:11px}',
    '.launcher-statusbar__page{color:var(--l-ink2)}',
    // 焦点可见（票 37）：全站兜底，键盘 Tab 到的任何控件都有 2px accent 焦点环。
    // 具体面板的 :focus-visible 规则（侧栏/右栏/设置）保留并覆盖本条。
    '.launcher-shell :focus-visible{outline:2px solid var(--l-accent);outline-offset:2px}',
  ].join('\n')
}
