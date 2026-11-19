/**
 * 分屏状态机（05-§6.2 / FR-14 / FR-15）。
 *
 * 外壳自己持有 pane 列表，每块 pane 里 renderSlot('main', pane.key)。这里只管"有几块、谁在前、
 * 谁被放大或收起"，宽度够不够交给 lib/layout.js 的 resolveSplit 判——两块职责不混。
 * 规则：单块放大时其余折叠但保留；收起后仍可恢复；切档位不改已分配的 key。
 */

/** 每档的行列（原型：2 块左右并排、4 块 2×2、6 块 3×2）。 */
export const GRID = Object.freeze({ 1: { columns: 1, rows: 1 }, 2: { columns: 2, rows: 1 }, 4: { columns: 2, rows: 2 }, 6: { columns: 3, rows: 2 } })

/** main 的保留键。 */
export const CONVERSATION = 'conversation'

/**
 * 造一个分屏状态。
 * @param {'chat'|'plugin'|'tool'} [kind] - pane 类型，默认会话。
 * @returns {{ mode: number, panes: object[], active: number }} 初始状态（1 块 conversation）。
 */
export function createSplit(kind = 'chat') {
  return {
    mode: 1,
    panes: [{ key: CONVERSATION, kind, title: '会话', collapsed: false }],
    active: 0,
  }
}

/**
 * 切档位。调用方先用 layout.resolveSplit 拿到实际档位再进来，避免这里重复算宽度。
 * 新档位比原来多时补空 pane（key 为 null，等 assign）；少时保留前 N 块。
 * @param {object} state - createSplit 的状态。
 * @param {number} mode - 目标档位（1/2/4/6）。
 * @returns {object} 新状态（不改入参）。
 */
export function setSplitMode(state, mode) {
  const next = { ...state, panes: state.panes.map((pane) => ({ ...pane })) }
  next.mode = mode
  while (next.panes.length > mode) next.panes.pop()
  while (next.panes.length < mode) {
    next.panes.push({ key: null, kind: 'plugin', title: `分屏 ${next.panes.length + 1}`, collapsed: false })
  }
  if (next.active >= next.panes.length) next.active = next.panes.length - 1
  return next
}

/**
 * 给某块分配 main key（'conversation' | 'plugin:<id>' | 'page:<name>'）。
 * @param {object} state - 分屏状态。
 * @param {number} index - 块序号。
 * @param {string} key - main 的 key。
 * @returns {object} 新状态。
 */
export function assignPane(state, index, key) {
  if (index < 0 || index >= state.panes.length) return state
  const panes = state.panes.map((pane, position) => (position === index ? { ...pane, key } : { ...pane }))
  return { ...state, panes }
}

/** 设活动块（1px --accent 描边的那块）。 */
export function focusPane(state, index) {
  if (index < 0 || index >= state.panes.length) return state
  return { ...state, active: index }
}

/**
 * 放大单块：其余折叠但保留；再点同一块恢复。
 * @param {object} state - 分屏状态。
 * @param {number} index - 块序号。
 * @returns {object} 新状态。
 */
export function zoomPane(state, index) {
  if (index < 0 || index >= state.panes.length) return state
  const zoomed = state.panes.every((pane, position) => position === index || pane.collapsed === true)
  const panes = state.panes.map((pane, position) => ({
    ...pane,
    collapsed: !zoomed && position !== index,
  }))
  return { ...state, panes, active: index }
}

/**
 * 收起单块（列表保留，可恢复）。
 * @param {object} state - 分屏状态。
 * @param {number} index - 块序号。
 * @returns {object} 新状态。
 */
export function collapsePane(state, index) {
  if (index < 0 || index >= state.panes.length) return state
  const panes = state.panes.map((pane, position) => (position === index ? { ...pane, collapsed: true } : { ...pane }))
  return { ...state, panes }
}

/**
 * 恢复某块（收起的或放大时被折叠的）。
 * @param {object} state - 分屏状态。
 * @param {number} index - 块序号。
 * @returns {object} 新状态。
 */
export function restorePane(state, index) {
  if (index < 0 || index >= state.panes.length) return state
  const panes = state.panes.map((pane, position) => (position === index ? { ...pane, collapsed: false } : { ...pane }))
  return { ...state, panes }
}

/**
 * 档位对应的网格（外壳用它铺 grid-template；非法档位按 1）。
 * @param {number} mode - 档位。
 * @returns {{ columns: number, rows: number }} 行列数。
 */
export function gridOf(mode) {
  return GRID[mode] ?? GRID[1]
}

/** 当前可见的块（未收起）。 */
export function visiblePanes(state) {
  return state.panes.filter((pane) => pane.collapsed !== true)
}
