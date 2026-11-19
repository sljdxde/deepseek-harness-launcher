/**
 * ⌘K 命令面板的纯逻辑（05 §6.5 / TC-16-3、16-4、16-6）。
 *
 * 命令**只能**来自宿主命令源，这里做三件事：容错归一化、按输入过滤、键盘选中移动。
 * 面板 UI 在 client 里，逻辑全在这，单测覆盖「形状怪 / 空表 / 过滤 / ↑↓」四种情形。
 */

/** 空表时面板显示的提示（不是"没有命令"，而是"没接上命令源"）。 */
export const EMPTY_SOURCE_HINT = '未接入命令源（宿主命令表待接线）'

/**
 * 把宿主命令源返回的任意形状归一化成 { id, label, hint, command }。
 * @param {unknown} source - `ctx.commandUi`（或它的 list/directory/commands）。
 * @returns {{ id: string, label: string, hint?: string, command?: string }[]} 归一化后的命令。
 */
export function normalizeCommands(source) {
  if (source === null || source === undefined) return []
  let list = source
  if (!Array.isArray(list)) {
    try {
      list = source.list?.() ?? source.directory?.list?.() ?? source.commands ?? []
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  const rows = []
  const seen = new Set()
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const id = item.id ?? item.name ?? item.command
    const label = item.label ?? item.title ?? item.name
    if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string' || label.length === 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    rows.push({ id, label, hint: typeof item.hint === 'string' ? item.hint : item.description, command: item.name ?? id })
  }
  return rows
}

/**
 * 按输入过滤（子串、大小写不敏感，匹配 label 或 hint）。
 * @param {{ id: string, label: string, hint?: string }[]} commands - 归一化后的命令。
 * @param {string} query - 输入框内容。
 * @returns {object[]} 过滤后的命令。
 */
export function filterCommands(commands, query) {
  const rows = Array.isArray(commands) ? commands : []
  const q = String(query ?? '').trim().toLowerCase()
  if (q.length === 0) return rows
  return rows.filter((cmd) => {
    const label = String(cmd.label ?? '').toLowerCase()
    const hint = String(cmd.hint ?? '').toLowerCase()
    return label.includes(q) || hint.includes(q)
  })
}

/**
 * ↑/↓ 移动选中项（到头回绕；空表恒为 0）。
 * @param {number} index - 当前下标。
 * @param {number} length - 列表长度。
 * @param {number} delta - +1 / -1。
 * @returns {number} 新下标。
 */
export function moveIndex(index, length, delta) {
  if (!Number.isInteger(length) || length <= 0) return 0
  const next = (Math.trunc(index) + delta) % length
  return next < 0 ? next + length : next
}

/** 调宿主命令 resolve 用的普通上下文（不能传插件 ctx：代理禁止读未 inject 的属性）。 */
export const MENU_CONTEXT = { region: 'page', modal: null, source: 'menu' }

/** 面板取条目时允许的 region（05 §6.5：只有 page / editable 的行进面板）。 */
export const PALETTE_REGIONS = ['page', 'editable']

/**
 * 从 `ctx.shortcuts.registry.commands`（Map）建面板条目（05 §6.5 定稿口径）。
 * 规则：`regions` 含 `page` 或 `editable` 的才进；`modals` 专属行不进；`label()` 是函数就调用取文案、`id` 作唯一键。
 * 每行执行前先 `resolve(context)`：返回 `{status:'handled'}` 才可执行，`pass` 置灰（**不隐藏**）。
 * @param {unknown} source - Map / 数组 / 带 `commands` 的对象。
 * @param {object} [context] - 传给 `resolve` 的上下文。
 * @returns {{ id: string, label: string, hint?: string, disabled: boolean, command: object }[]} 面板条目。
 */
export function catalogCommands(source, context = MENU_CONTEXT) {
  let rows = source
  if (rows instanceof Map) rows = [...rows.values()]
  else if (rows !== null && typeof rows === 'object' && !Array.isArray(rows)) {
    if (rows.commands instanceof Map) rows = [...rows.commands.values()]
    else if (Array.isArray(rows.commands)) rows = rows.commands
    else {
      try {
        rows = rows.rows ?? rows.list?.() ?? []
      } catch {
        rows = []
      }
    }
  }
  if (!Array.isArray(rows)) return []
  const out = []
  const seen = new Set()
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const id = row.id
    const rawLabel = typeof row.label === 'function' ? row.label() : row.label
    const label = typeof rawLabel === 'string' ? rawLabel : id
    if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string' || label.length === 0) continue
    const regions = Array.isArray(row.regions) ? row.regions : []
    if (!regions.some((region) => PALETTE_REGIONS.includes(region))) continue
    const modals = Array.isArray(row.modals) ? row.modals : []
    if (modals.length > 0 && regions.length === 0) continue
    if (seen.has(id)) continue
    seen.add(id)
    let disabled = false
    try {
      const verdict = row.resolve?.(context)
      disabled = !(verdict === 'handled' || verdict?.status === 'handled')
    } catch {
      disabled = true
    }
    out.push({ id, label, hint: typeof row.hint === 'string' ? row.hint : row.description, disabled, command: row })
  }
  return out
}

/**
 * 执行面板条目：`resolve(context)` 返回 `{status:'handled', run}` 才跑它带回的 `run()`；
 * 命令对象本身没有 `run`（实测），所以必须用 resolve 的结果。
 * @param {{ command: object }} entry - `catalogCommands` 产出的条目。
 * @param {object} [context] - 传给 `resolve` 的上下文。
 * @returns {'ran'|'pass'|'failed'} 执行结果。
 */
export function executeCommand(entry, context = MENU_CONTEXT) {
  const command = entry?.command
  if (command === null || typeof command !== 'object') return 'failed'
  try {
    const verdict = command.resolve?.(context)
    if (verdict === 'handled') {
      const run = entry.run ?? command.run
      if (typeof run === 'function') { run(); return 'ran' }
      return 'ran'
    }
    if (verdict?.status !== 'handled') return 'pass'
    const run = verdict.run ?? command.run
    if (typeof run === 'function') run()
    return 'ran'
  } catch {
    return 'failed'
  }
}

/** 我们自己的动作要注册进同一个 catalog（FR-16）：只注册宿主没有的三条，「新建会话」用宿主 session.new。 */
export const OWN_CATALOG_ROWS = [
  { id: 'launcher.pluginWorkbench', label: '打开插件工作台', hint: '插件页（plugin:<id>）', regions: ['page', 'editable'] },
  { id: 'launcher.settings', label: '打开设置', hint: '设置面板', regions: ['page', 'editable'] },
]

/**
 * 造出我们自己的 catalog 行（带 resolve/run），供 client 注册进 `ctx.shortcuts.catalog`。
 * `resolve` 按上下文判定：不在页面级 / 没有会话时返回 `pass`（置灰），不一律 handled。
 * @param {{ hasSession?: boolean, currentPage?: string }} [ctx] - 最小上下文。
 * @param {{ onOpenWorkbench?: Function, onToggleShell?: Function, onOpenSettings?: Function }} [actions] - 执行回调。
 * @returns {object[]} catalog 行。
 */
export function ownCatalogRows(ctx = {}, actions = {}) {
  const onPage = ctx.currentPage === undefined || ctx.currentPage === 'conversation' || ctx.currentPage === 'plugins'
  const hasSession = ctx.hasSession !== false
  // 与宿主同形态：resolve(ctx) → { status: 'handled', run } | { status: 'pass' }
  const guard = (enabled, run) => ({ resolve: () => (enabled ? { status: 'handled', run } : { status: 'pass' }) })
  return [
    { ...OWN_CATALOG_ROWS[0], ...guard(onPage, () => actions.onOpenWorkbench?.()) },
    { ...OWN_CATALOG_ROWS[1], ...guard(onPage && hasSession, () => actions.onOpenSettings?.()) },
  ]
}
