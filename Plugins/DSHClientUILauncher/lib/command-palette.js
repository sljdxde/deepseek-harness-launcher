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

/** 面板取条目时允许的 region（05 §6.5：只有 page / editable 的行进面板）。 */
export const PALETTE_REGIONS = ['page', 'editable']

/**
 * 从 `ctx.shortcuts.catalog` 建面板条目（05 §6.5 定稿口径）。
 * 规则：`regions` 含 `page` 或 `editable` 的才进；`modals` 专属行不进；`label` 作标题、`id` 作唯一键。
 * 每行执行前先 `resolve(context)`：返回 `handled` 才可执行，返回 `pass` 置灰（**不隐藏**）。
 * @param {unknown} catalog - `ctx.shortcuts.catalog`（数组，或带 `rows`/`list()` 的对象）。
 * @param {object} [context] - 传给 `resolve` 的上下文。
 * @returns {{ id: string, label: string, hint?: string, disabled: boolean, row: object }[]} 面板条目。
 */
export function catalogCommands(catalog, context = {}) {
  let rows = catalog
  if (rows !== null && typeof rows === 'object' && !Array.isArray(rows)) {
    try {
      rows = rows.rows ?? rows.list?.() ?? []
    } catch {
      rows = []
    }
  }
  if (!Array.isArray(rows)) return []
  const out = []
  const seen = new Set()
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const id = row.id
    const label = row.label
    if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string' || label.length === 0) continue
    const regions = Array.isArray(row.regions) ? row.regions : []
    if (!regions.some((region) => PALETTE_REGIONS.includes(region))) continue
    const modals = Array.isArray(row.modals) ? row.modals : []
    const onlyModals = modals.length > 0 && regions.length === 0
    if (onlyModals) continue
    if (seen.has(id)) continue
    seen.add(id)
    let disabled = false
    try {
      const verdict = row.resolve?.(context)
      disabled = verdict !== 'handled'
    } catch {
      disabled = true
    }
    out.push({ id, label, hint: typeof row.hint === 'string' ? row.hint : row.description, disabled, row })
  }
  return out
}

/**
 * 执行面板条目：`resolve` 返回 handled 才跑 `run()`；pass/异常都不执行。
 * @param {{ row: object }} entry - `catalogCommands` 产出的条目。
 * @param {object} [context] - 传给 `resolve`/`run` 的上下文。
 * @returns {'ran'|'pass'|'failed'} 执行结果。
 */
export function executeCommand(entry, context = {}) {
  const row = entry?.row
  if (row === null || typeof row !== 'object') return 'failed'
  try {
    if (row.resolve?.(context) !== 'handled') return 'pass'
    row.run?.(context)
    return 'ran'
  } catch {
    return 'failed'
  }
}

/** 我们自己的动作要注册进同一个 catalog（FR-16：面板能搜到并执行）。 */
export const OWN_CATALOG_ROWS = [
  { id: 'launcher.workbench.open', label: '打开插件工作台', hint: '插件页（plugin:<id>）', regions: ['page', 'editable'] },
  { id: 'launcher.shell.toggle', label: '切换外壳', hint: '新外壳 ↔ 原生外壳', regions: ['page'] },
  { id: 'launcher.session.new', label: '新建会话', hint: '与左栏「＋ 新建会话」同效', regions: ['page', 'editable'] },
  { id: 'launcher.session.search', label: '搜索会话', hint: '按标题/内容过滤', regions: ['page'] },
]

/**
 * 造出我们自己的 catalog 行（带 resolve/run），供 client 注册进 `ctx.shortcuts.catalog`。
 * `resolve` 按上下文判定：不在页面级 / 没有可工作的面板时返回 `pass`（置灰），不一律 handled。
 * @param {{ hasSession?: boolean, currentPage?: string }} [ctx] - 最小上下文。
 * @param {{ onOpenWorkbench?: Function, onToggleShell?: Function, onNewSession?: Function, onSearchSessions?: Function }} [actions] - 执行回调。
 * @returns {object[]} catalog 行。
 */
export function ownCatalogRows(ctx = {}, actions = {}) {
  const onPage = ctx.currentPage === undefined || ctx.currentPage === 'conversation' || ctx.currentPage === 'plugins'
  const hasSession = ctx.hasSession !== false
  const guard = (enabled, run) => ({
    resolve: () => (enabled ? 'handled' : 'pass'),
    run,
  })
  return [
    { ...OWN_CATALOG_ROWS[0], ...guard(onPage, () => actions.onOpenWorkbench?.()) },
    { ...OWN_CATALOG_ROWS[1], ...guard(onPage, () => actions.onToggleShell?.()) },
    { ...OWN_CATALOG_ROWS[2], ...guard(onPage && hasSession, () => actions.onNewSession?.()) },
    { ...OWN_CATALOG_ROWS[3], ...guard(onPage, () => actions.onSearchSessions?.()) },
  ]
}
