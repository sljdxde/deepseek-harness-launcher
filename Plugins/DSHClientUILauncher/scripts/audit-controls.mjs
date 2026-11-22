#!/usr/bin/env node
/**
 * 票 37：死控件巡检与可访问性静态验收。
 *
 * 巡检对象是**生成后的浏览器产物** `client/client.js`（lib/*.js 经 tools/sync-contract.mjs
 * 内联进它的 #region 生成区，所以不重复计数）。脚本输出：
 *   1) 机器可读 JSON（docs/ui-rebuild/audit-controls.json）
 *   2) 人类可读汇总（stdout）
 * dead 数为 0 且其余检查全过时退出 0，否则退出 1。
 *
 * 判定（与票 27 验收线一致）：可点元素满足「有处理函数 / 显式 disabled / 说明性
 * title 或 aria-label」任一即非死控件；另检查可访问名、点击目标 ≥24px、焦点环、AA 对比度。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { mainCss } from '../lib/main-view.js'
import { dockSettingsCss } from '../lib/dock-settings.js'
import { sidebarCss } from '../lib/sidebar.js'
import { modelCss } from '../lib/model-surface.js'
import { tokensCss, skeletonCss, contrastReport } from '../lib/tokens.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const REPO_ROOT = join(ROOT, '..', '..')
const CLIENT_FILE = join(ROOT, 'client', 'client.js')
const JSON_OUT = join(REPO_ROOT, 'docs', 'ui-rebuild', 'audit-controls.json')

/** 原生可聚焦/可点标签。 */
export const CONTROL_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a', 'summary'])
/** 交互型 ARIA role（不具备原生语义时也要当控件巡检）。 */
export const CONTROL_ROLES = new Set([
  'switch', 'radio', 'checkbox', 'tab', 'option', 'menuitem', 'menuitemradio', 'button', 'link',
  // 可拖拽的分隔条（右栏宽度）也是指针目标，按控件巡检尺寸。
  'separator',
])

const HANDLER_KEYS = new Set([
  'onClick', 'onChange', 'onInput', 'onPointerDown', 'onPointerUp', 'onDoubleClick', 'onKeyDown',
])

/**
 * 单个控件的判定。
 * @param {{ tag?: string, role?: string, hasHandler?: boolean, disabled?: boolean, label?: string, hasText?: boolean }} input
 * @returns {{ dead: boolean, missingName: boolean, reasons: string[] }}
 */
export function classifyControl(input) {
  const hasHandler = input?.hasHandler === true
  const disabled = input?.disabled === true
  const label = typeof input?.label === 'string' && input.label.trim() !== ''
  const hasText = input?.hasText === true
  const reasons = []
  if (!hasHandler && !disabled && !label) {
    reasons.push('no-handler')
    if (!hasText) reasons.push('no-label')
  }
  const missingName = !label && !hasText
  return { dead: reasons.length > 0, missingName, reasons }
}

/** 跳过一个字符串/模板/注释后的下一个字符位置。 */
function skipQuoted(source, index) {
  const quote = source[index]
  let i = index + 1
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue }
    if (source[i] === quote) return i + 1
    i += 1
  }
  return i
}

/**
 * 从 start（指向 open 字符）找到配对的 close，跳过字符串/模板/注释。
 * @returns {number} close 的下标；找不到返回 -1。
 */
export function findMatching(source, start, open, close) {
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuoted(source, i) - 1; continue }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i)
      if (nl < 0) return -1
      i = nl
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end < 0) return -1
      i = end + 1
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 按顶层逗号切分（跳过字符串/注释/括号嵌套）。 */
export function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let last = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipQuoted(text, i) - 1; continue }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(last, i))
      last = i + 1
    }
  }
  parts.push(text.slice(last))
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

/** 去掉成对的引号。 */
function unquote(text) {
  const value = String(text ?? '').trim()
  if (value.length >= 2 && ((value[0] === "'" && value.at(-1) === "'") || (value[0] === '"' && value.at(-1) === '"') || (value[0] === '`' && value.at(-1) === '`'))) {
    return value.slice(1, -1)
  }
  return value
}

/** 解析对象字面量里的顶层 `key: value`。 */
export function parseProps(text) {
  const props = {}
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return props
  const body = text.trim().slice(1, -1)
  for (const entry of splitTopLevel(body)) {
    let depth = 0
    let colon = -1
    for (let i = 0; i < entry.length; i += 1) {
      const ch = entry[i]
      if (ch === "'" || ch === '"' || ch === '`') { i = skipQuoted(entry, i) - 1; continue }
      if (ch === '(' || ch === '{' || ch === '[') depth += 1
      else if (ch === ')' || ch === '}' || ch === ']') depth -= 1
      else if (ch === ':' && depth === 0) { colon = i; break }
    }
    if (colon < 0) continue
    const key = unquote(entry.slice(0, colon).trim())
    const value = entry.slice(colon + 1).trim()
    if (key === '' || key.startsWith('[')) continue
    props[key] = value
  }
  return props
}

/** 值是否是「明确关闭」的字面量。 */
function isFalsyLiteral(value) {
  return value === undefined || /^(undefined|null|false)$/.test(String(value).trim())
}

/** 子节点里是否含可见文字（字符串 / 模板 / 变量名 / 嵌套元素文字 / spread）。 */
export function childrenHaveText(childArgs) {
  for (const argText of childArgs) {
    const arg = String(argText ?? '').trim()
    if (arg === '' || arg === 'null' || arg === 'undefined' || arg === 'false') continue
    if (arg.startsWith('...')) return true
    const first = arg[0]
    if (first === "'" || first === '"' || first === '`') {
      const literal = unquote(arg)
      // 纯符号（×、✕、⋯）不算可访问名；含文字/字母/数字/CJK 才算
      if (/[A-Za-z0-9\u4e00-\u9fff]/.test(literal)) return true
      continue
    }
    if (/\b(String|label|title|name|hint|text)\b/.test(arg)) return true
    // 三元/表达式里的字面量文案（如 `open ? '收起' : '展开'`）；但 h(...) 调用的 props
    // 里也有引号（className），不能据此判成有文字，交给上面的递归分支。
    if (!arg.startsWith('h(') && !arg.includes('className:') && /['"][^'"]*[A-Za-z0-9\u4e00-\u9fff][^'"]*['"]/.test(arg)) return true
    if (arg.startsWith('h(')) {
      const open = arg.indexOf('(')
      const end = findMatching(arg, open, '(', ')')
      if (end > open) {
        const inner = splitTopLevel(arg.slice(open + 1, end))
        let start = 1
        if (inner[1] !== undefined && inner[1].startsWith('{')) start = 2
        if (childrenHaveText(inner.slice(start))) return true
      }
    }
  }
  return false
}

/**
 * 静态扫描 `h('tag', {...}, ...children)` 形式的控件。
 * @param {string} source - 模块源码。
 * @returns {Array<object>} 控件描述清单。
 */
export function extractControls(source) {
  const controls = []
  const matcher = /\bh\(\s*'([A-Za-z][\w-]*)'/g
  let match
  while ((match = matcher.exec(source)) !== null) {
    const tag = match[1]
    const openParen = source.indexOf('(', match.index)
    const closeParen = findMatching(source, openParen, '(', ')')
    if (closeParen < 0) continue
    const args = splitTopLevel(source.slice(openParen + 1, closeParen))
    const propsText = args[1] !== undefined && args[1].startsWith('{') ? args[1] : ''
    const props = parseProps(propsText)
    const role = props.role === undefined ? '' : unquote(props.role)
    const isNative = CONTROL_TAGS.has(tag)
    const hasDataAct = props['data-act'] !== undefined || props['data-action'] !== undefined
    const isControl = isNative || hasDataAct || (role !== '' && CONTROL_ROLES.has(role))
    if (!isControl) continue

    const childArgs = args.slice(propsText === '' ? 1 : 2)
    const hasHandler = Object.keys(props).some((key) => HANDLER_KEYS.has(key))
    const disabled = (props.disabled !== undefined && !isFalsyLiteral(props.disabled))
      || (props['aria-disabled'] !== undefined && !isFalsyLiteral(props['aria-disabled']))
    const labelRaw = props['aria-label'] ?? props.title ?? props['aria-labelledby']
    const label = labelRaw === undefined ? '' : unquote(labelRaw)
    const hasText = isNative && ['input', 'select', 'textarea'].includes(tag) ? false : childrenHaveText(childArgs)
    const verdict = classifyControl({ tag, role, hasHandler, disabled, label, hasText })
    const className = props.className === undefined ? '' : unquote(props.className)
    controls.push({
      line: source.slice(0, match.index).split('\n').length,
      kind: 'vnode',
      tag,
      role,
      className,
      hasHandler,
      disabled,
      label,
      hasText,
      ...verdict,
    })
  }
  controls.push(...extractDomControls(source))
  return controls
}

/**
 * 静态扫描 `document.createElement('button')` 这类 DOM 直建控件（HostGuard 横幅等
 * 不在 React 渲染树里，h() 扫描覆盖不到）。窗口内看 `.addEventListener('click')`
 * 与 `.textContent` / `setAttribute('aria-label')`。
 * @param {string} source
 */
export function extractDomControls(source) {
  const controls = []
  const matcher = /document\.createElement\(\s*'([A-Za-z][\w-]*)'\s*\)/g
  let match
  while ((match = matcher.exec(source)) !== null) {
    const tag = match[1]
    if (!CONTROL_TAGS.has(tag)) continue
    const windowText = source.slice(match.index, match.index + 900)
    // 程序化下载用的 <a download>（创建→click→remove）不是界面控件，跳过。
    if (tag === 'a' && /\.download\s*=/.test(windowText)) continue
    const hasHandler = /addEventListener\(\s*'(?:click|change|input)'/.test(windowText)
    const disabled = /\.disabled\s*=\s*true/.test(windowText) || /\.setAttribute\(\s*'aria-disabled'\s*,\s*'true'/.test(windowText)
    const ariaLabel = /\.setAttribute\(\s*'aria-label'\s*,\s*(['"`])([\s\S]*?)\1/.exec(windowText)
    const textAssign = /\.textContent\s*=\s*([^\n]+)/.exec(windowText)
    const label = ariaLabel === null ? '' : ariaLabel[2]
    const textValue = textAssign === null ? '' : textAssign[1].trim()
    const hasText = textValue !== '' && textValue !== 'null' && textValue !== 'undefined' && !textValue.startsWith('document.')
    const className = (/\.className\s*=\s*'([^']*)'/.exec(windowText) ?? [])[1] ?? ''
    const verdict = classifyControl({ tag, role: '', hasHandler, disabled, label, hasText })
    controls.push({
      line: source.slice(0, match.index).split('\n').length,
      kind: 'dom',
      tag,
      role: '',
      className,
      hasHandler,
      disabled,
      label,
      hasText,
      ...verdict,
    })
  }
  return controls
}

/**
 * 汇总控件清单。
 * @param {Array<object>} controls
 */
export function auditControls(controls) {
  const list = Array.isArray(controls) ? controls : []
  const dead = list.filter((control) => control.dead === true)
  const missingName = list.filter((control) => control.missingName === true)
  return {
    controlCount: list.length,
    deadCount: dead.length,
    missingNameCount: missingName.length,
    dead: dead.map((control) => ({
      line: control.line,
      tag: control.tag,
      role: control.role,
      className: control.className,
      reasons: control.reasons,
    })),
    missingName: missingName.map((control) => ({
      line: control.line,
      tag: control.tag,
      role: control.role,
      className: control.className,
    })),
  }
}

/** 把 CSS 文本解析成 [{ selector, decls }]。 */
export function parseCssRules(css) {
  const rules = []
  const matcher = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = matcher.exec(String(css ?? ''))) !== null) {
    const decls = {}
    for (const raw of match[2].split(';')) {
      const index = raw.indexOf(':')
      if (index < 0) continue
      const key = raw.slice(0, index).trim()
      const value = raw.slice(index + 1).trim()
      if (key !== '' && !key.startsWith('--')) decls[key] = value
    }
    rules.push({ selector: match[1].trim().replace(/\s+/g, ' '), decls })
  }
  return rules
}

/** 选择器的主语（最后一段复合选择器）是否带该类。 */
export function ruleSubjectHasClass(selector, className) {
  for (const part of String(selector).split(',')) {
    const cleaned = part.trim().replace(/::?[a-z-]+(\([^)]*\))?/g, '')
    const compounds = cleaned.split(/\s+|>/).filter(Boolean)
    const last = compounds.at(-1) ?? ''
    if (last.split(/(?=[.#])/).some((token) => token === '.' + className)) return true
  }
  return false
}

/** 解析 px 值；非 px 返回 null。 */
function px(value) {
  return typeof value === 'string' && /^\d+(\.\d+)?px$/.test(value.trim()) ? parseFloat(value) : null
}

/**
 * 估算控件盒尺寸（px）。有显式 height/min-height 用显式值；否则「行高 × 字号 + 垂直内边距」。
 * 宽度同理；文本按钮宽度取决于内容，未显式声明时记 null（不判违规）。
 */
export function computeTargetSize(decls) {
  const d = decls ?? {}
  const fontSize = px(d['font-size']) ?? 13
  const lineHeightRaw = d['line-height']
  const lineHeight = px(lineHeightRaw) ?? (lineHeightRaw !== undefined && /^\d+(\.\d+)?$/.test(lineHeightRaw) ? Number(lineHeightRaw) * fontSize : fontSize * 1.4)
  const padding = String(d.padding ?? '').trim().split(/\s+/).filter(Boolean)
  const paddingPx = (index, fallback) => {
    const raw = padding[index] ?? padding[0] ?? fallback
    return px(raw) ?? 0
  }
  const paddingV = (padding.length > 0 ? paddingPx(0, '0') * 2 : (px(d['padding-top']) ?? 0) + (px(d['padding-bottom']) ?? 0))
  const paddingH = (padding.length > 0 ? paddingPx(1, padding[0]) * 2 : (px(d['padding-left']) ?? 0) + (px(d['padding-right']) ?? 0))
  const height = px(d.height) ?? px(d['min-height']) ?? lineHeight + paddingV
  const explicitWidth = px(d.width) ?? px(d['min-width'])
  const width = explicitWidth ?? paddingH + fontSize
  return {
    height: Math.round(height * 10) / 10,
    width: explicitWidth === null ? null : Math.round(width * 10) / 10,
    below24: height < 24 || (explicitWidth !== null && explicitWidth < 24),
  }
}

/** 允许的例外（WCAG 2.5.8 拖动/必要例外），报告里明示。 */
const TARGET_EXEMPT = new Map([
  ['launcher-dock__handle', '右栏拖拽分隔条：连续拖动目标，按 WCAG 2.5.8 essential 例外记录'],
])

/** 控件 className 里的 launcher-* 类名。 */
function classTokens(className) {
  return [...new Set(String(className ?? '').match(/launcher-[a-z0-9_-]+/g) ?? [])]
}

/** 选择器某个逗号分支的主语复合选择器上的全部类名。 */
function subjectClasses(selectorPart) {
  const cleaned = String(selectorPart).trim().replace(/::?[a-z-]+(\([^)]*\))?/g, '')
  const compounds = cleaned.split(/\s+|>/).filter(Boolean)
  const last = compounds.at(-1) ?? ''
  return last.split(/(?=[.#])/).filter((token) => token.startsWith('.')).map((token) => token.slice(1))
}

/** 规则是否作用于「恰好这些类」的元素（主体的每个类都必须在控件类集合里）。 */
export function ruleAppliesTo(selector, classSet) {
  for (const part of String(selector).split(',')) {
    const classes = subjectClasses(part)
    if (classes.length > 0 && classes.every((name) => classSet.has(name))) return true
  }
  return false
}

/**
 * 逐「类名组合」检查点击目标（同一组合的控件尺寸相同）。
 * @param {Array<object>} controls
 * @param {string} css
 */
export function auditTargetSizes(controls, css) {
  const rules = parseCssRules(css)
  const signatures = new Map()
  for (const control of controls ?? []) {
    const tokens = classTokens(control.className)
    if (tokens.length === 0) continue
    const key = [...tokens].sort().join(' ')
    if (!signatures.has(key)) signatures.set(key, tokens)
  }
  const results = []
  for (const [key, tokens] of signatures) {
    const classSet = new Set(tokens)
    const merged = {}
    for (const rule of rules) {
      if (!ruleAppliesTo(rule.selector, classSet)) continue
      Object.assign(merged, rule.decls)
    }
    const size = computeTargetSize(merged)
    const exemptClass = tokens.find((name) => TARGET_EXEMPT.has(name))
    const exempt = exemptClass !== undefined
    results.push({
      className: key,
      height: size.height,
      width: size.width,
      below24: size.below24 && !exempt,
      exempt,
      note: exempt ? TARGET_EXEMPT.get(exemptClass) : '',
    })
  }
  return results
}

/**
 * 焦点可见性：是否有全站兜底规则，以及各交互类是否有显式 :focus-visible。
 * @param {string} css
 */
export function auditFocus(css) {
  const text = String(css ?? '')
  const globalRule = /\.launcher-shell\s*:focus-visible/.test(text)
  const rules = parseCssRules(text)
  const explicit = rules.filter((rule) => /:focus(-visible)?\b/.test(rule.selector))
  return { globalRule, explicit: explicit.length, missing: globalRule ? [] : ['global'] }
}

/**
 * 组装归档报告（字段固定）。
 * @param {{ controls: Array<object>, targetSizes: Array<object>, focus: object, contrast: object, generatedAt: string, source: string }} input
 */
export function buildReport(input) {
  const audit = auditControls(input.controls)
  const targetViolations = (input.targetSizes ?? []).filter((item) => item.below24 === true)
  const contrastItems = [...(input.contrast?.light ?? []), ...(input.contrast?.dark ?? [])]
  const contrastFailed = contrastItems.filter((item) => item.pass !== true)
  const checks = [
    { id: 'dead-controls', label: '死控件 = 0', pass: audit.deadCount === 0, detail: `${audit.deadCount} dead` },
    { id: 'accessible-name', label: '控件有可访问名', pass: audit.missingNameCount === 0, detail: `${audit.missingNameCount} 缺名` },
    { id: 'target-size', label: '点击目标 ≥ 24px（或例外）', pass: targetViolations.length === 0, detail: `${targetViolations.length} 个 <24px` },
    { id: 'focus-visible', label: '焦点环可见', pass: input.focus?.globalRule === true || (input.focus?.missing ?? []).length === 0, detail: input.focus?.globalRule === true ? '全站兜底规则' : '缺失' },
    { id: 'contrast-aa', label: '文字对比度 AA（日夜）', pass: contrastFailed.length === 0, detail: `${contrastFailed.length} 组未过` },
  ]
  return {
    generatedAt: input.generatedAt,
    source: input.source,
    controls: input.controls ?? [],
    controlCount: audit.controlCount,
    deadCount: audit.deadCount,
    missingNameCount: audit.missingNameCount,
    dead: audit.dead,
    missingName: audit.missingName,
    targetSize: input.targetSizes ?? [],
    focus: input.focus ?? { globalRule: false, explicit: 0, missing: [] },
    contrast: input.contrast ?? { light: [], dark: [] },
    checks,
    pass: checks.every((check) => check.pass === true),
  }
}

/** 取 client.js 里手写 CSS 块（`const CSS = \`...\``）。 */
function clientCss(source) {
  const match = /const CSS = `([\s\S]*?)`\n\n  function ensureStyle/.exec(source)
  return match === null ? '' : match[1]
}

/** CSS 语料：各 lib 生成块 + client 手写块。 */
export function collectCss(source) {
  return [tokensCss(), skeletonCss(), mainCss(), dockSettingsCss(), sidebarCss(), modelCss(), clientCss(source)].join('\n')
}

/** CLI 主流程。 */
export function runAudit({ sourcePath = CLIENT_FILE, now = new Date().toISOString() } = {}) {
  const source = readFileSync(sourcePath, 'utf8')
  const css = collectCss(source)
  const report = buildReport({
    controls: extractControls(source),
    targetSizes: auditTargetSizes(extractControls(source), css),
    focus: auditFocus(css),
    contrast: { light: contrastReport('light'), dark: contrastReport('dark') },
    generatedAt: now,
    source: 'client/client.js',
  })
  return report
}

function printHuman(report) {
  const lines = []
  lines.push('死控件巡检与可访问性验收（票 37）')
  lines.push(`生成时间：${report.generatedAt}`)
  lines.push(`巡检对象：${report.source}`)
  lines.push('')
  lines.push(`控件总数：${report.controlCount}`)
  lines.push(`dead：${report.deadCount}`)
  lines.push(`缺可访问名：${report.missingNameCount}`)
  lines.push(`点击目标 <24px（非例外）：${report.targetSize.filter((item) => item.below24).length}`)
  lines.push(`焦点兜底规则：${report.focus.globalRule ? '有' : '无'}（显式 :focus-visible 规则 ${report.focus.explicit} 条）`)
  const contrast = [...report.contrast.light.map((item) => ({ ...item, mode: '日间' })), ...report.contrast.dark.map((item) => ({ ...item, mode: '夜间' }))]
  const failed = contrast.filter((item) => !item.pass)
  lines.push(`对比度：${contrast.length} 组，未过 ${failed.length} 组`)
  lines.push('')
  lines.push('检查项：')
  for (const check of report.checks) lines.push(`  ${check.pass ? 'PASS' : 'FAIL'}  ${check.label}（${check.detail}）`)
  if (report.dead.length > 0) {
    lines.push('')
    lines.push('死控件：')
    for (const item of report.dead) lines.push(`  line ${item.line} <${item.tag}> ${item.className} ${item.reasons.join(',')}`)
  }
  if (report.missingName.length > 0) {
    lines.push('')
    lines.push('缺可访问名：')
    for (const item of report.missingName) lines.push(`  line ${item.line} <${item.tag}> ${item.className}`)
  }
  const small = report.targetSize.filter((item) => item.below24)
  if (small.length > 0) {
    lines.push('')
    lines.push('点击目标 <24px：')
    for (const item of small) lines.push(`  ${item.className} h=${item.height} w=${item.width}`)
  }
  lines.push('')
  lines.push(report.pass ? '结论：PASS（dead = 0）' : '结论：FAIL（见上）')
  return lines.join('\n')
}

function main() {
  const report = runAudit()
  mkdirSync(dirname(JSON_OUT), { recursive: true })
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(printHuman(report))
  console.log(`\nJSON: ${JSON_OUT}`)
  process.exit(report.pass ? 0 : 1)
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) main()
