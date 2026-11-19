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
