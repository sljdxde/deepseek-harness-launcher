/**
 * 空会话首屏（W2 尾 / FR-36 / 05-§6.4）：这半边是我们自己的。
 *
 * 只做三件纯逻辑，渲染在 client/：
 * - 起手式：整句填入并聚焦，**不发送**（与 §6.3-① 的 `/` 命令同一条纪律）；
 * - 空态判据：宿主已有空态就返回 null（不许双空态）；
 * - 运行条快照：以 sessionId 为键，新会话全 0，切回旧会话按 id 还原。
 *
 * 不做（归宿主）：左栏「＋ 新建会话」入口、首条消息起标题、宿主键位（截图是 ⌥⌘N）。
 */

/** 四个起手式；`text` 是整句，点击只填入不发送。 */
export const STARTERS = Object.freeze([
  Object.freeze({ id: 'explore', label: '看仓库结构', text: '帮我看一下这个仓库的结构，先说值得注意的地方。' }),
  Object.freeze({ id: 'test', label: '跑一遍测试', text: '跑一遍测试，失败的和跳过的分开说。' }),
  Object.freeze({ id: 'split-tasks', label: '拆成任务卡', text: '把这件事拆成几张能并行的任务卡，写清依赖顺序。' }),
  Object.freeze({ id: 'resume', label: '接着上次的活', text: '接着上次没做完的活继续，先说上次停在哪。' }),
])

/** 空态卡片的尺寸与排版（05-§6.4）：宽上限 440、最小高 46vh（≤760 宽降到 36vh）。 */
export const CARD = Object.freeze({
  width: 440,
  contentWidth: 390,
  minHeightVh: 46,
  narrowMinHeightVh: 36,
  narrowWidth: 760,
  titleSize: 19,
  bodySize: 12.5,
  hintSize: 11,
  starterHeight: 36,
  themeSize: 40,
})

/** 运行条 / 上下文计量的零值：新会话必须显示这几个数，不许继承上一条会话。 */
export const RUNBAR_ZERO = Object.freeze({ rounds: 0, steps: 0, tokens: 0, cacheHit: 0, contextPct: 0 })

/**
 * 按 id 取起手式。
 * @param {string} kind - 起手式 id。
 * @returns {object|null} 条目；未知 id 返回 null。
 */
export function starterOf(kind) {
  return STARTERS.find((item) => item.id === kind) ?? null
}

/**
 * 点击起手式：给出「填入什么、要不要聚焦」，调用方负责写进输入框。
 * @param {string} kind - 起手式 id。
 * @returns {{ok: true, kind: string, text: string, focus: true, send: false} | {ok: false, send: false}} 结果。
 */
export function applyStarter(kind) {
  const starter = starterOf(kind)
  if (starter === null) return { ok: false, send: false }
  // send 永远 false：起手式只填入，发送是用户自己的动作。
  return { ok: true, kind: starter.id, text: starter.text, focus: true, send: false }
}

/**
 * 把起手式交给 composer face（W6）：只调 `fill(text)` + `focus()`，不写 DOM、不自造输入框。
 * face 还没落地（W6 之前）时返回 `no-composer`，调用方只做普通回调。
 * @param {{fill?: Function, focus?: Function}|null|undefined} face - ctx 里的 composer face。
 * @param {string} kind - 起手式 id。
 * @returns {{ok: true, kind: string, filled: true, focused: true} | {ok: false, reason: 'unknown-starter'|'no-composer', send: false}} 结果。
 */
export function applyStarterThrough(face, kind) {
  const applied = applyStarter(kind)
  if (applied.ok !== true) return { ok: false, reason: 'unknown-starter', send: false }
  if (face === null || face === undefined || typeof face.fill !== 'function') {
    return { ok: false, reason: 'no-composer', send: false }
  }
  face.fill(applied.text)
  if (typeof face.focus === 'function') face.focus()
  return { ok: true, kind: applied.kind, filled: true, focused: true }
}

/**
 * 空态判据：只有「选中了会话、没有消息、宿主没给空态」三条同时成立才该画我们的卡片。
 *
 * `hostEmptyState` 是**显式注入**的布尔（接线方在 `main` 的 conversation 面里传），
 * 不做 DOM 嗅探——宿主结构一变就误判，这条踩过（2026-11-19 口径）。
 * @param {{ selectedSessionId?: string|null, messageCount?: number, hostEmptyState?: boolean, force?: 'auto'|'on'|'off' }} [input] - 当前会话状态。
 * @returns {{render: boolean, reason: string}} 是否渲染与原因（开发期看得见为什么）。
 */
export function emptyStateDecision({
  selectedSessionId = null,
  messageCount = 0,
  hostEmptyState = false,
  force = 'auto',
} = {}) {
  // 开发期开关：真机上两个态各看一遍（`window.__DSH_LAUNCHER_EMPTY__ = 'on' | 'off'`）。
  if (force === 'off') return { render: false, reason: 'forced-off' }
  if (selectedSessionId === null || selectedSessionId === undefined || selectedSessionId === '') {
    return { render: false, reason: 'no-session' }
  }
  if (force === 'on') return { render: true, reason: 'forced-on' }
  // 宿主已经画了空态就不再画第二张（§6.4：不许双空态）。
  if (hostEmptyState === true) return { render: false, reason: 'host-empty-state' }
  const messages = Number(messageCount)
  if ((Number.isFinite(messages) ? messages : 0) > 0) return { render: false, reason: 'has-messages' }
  return { render: true, reason: 'ok' }
}

/**
 * 只要布尔的老入口，内部走 `emptyStateDecision`。
 * @param {object} [input] - 同 `emptyStateDecision`。
 * @returns {boolean} 是否渲染。
 */
export function shouldRenderEmptyState(input = {}) {
  return emptyStateDecision(input).render
}

/**
 * 空态卡片的布局量：宽度上限、最小高、起手式列数。
 * @param {{ width?: number, height?: number }} [viewport] - 视口宽高。
 * @returns {{ width: number, minHeight: number, columns: 1|2, narrow: boolean }} 布局。
 */
export function cardLayout({ width = 1440, height = 900 } = {}) {
  const viewportWidth = Number(width) > 0 ? Number(width) : 1440
  const viewportHeight = Number(height) > 0 ? Number(height) : 900
  const narrow = viewportWidth <= CARD.narrowWidth
  return {
    width: Math.min(CARD.width, viewportWidth),
    minHeight: Math.round((viewportHeight * (narrow ? CARD.narrowMinHeightVh : CARD.minHeightVh)) / 100),
    columns: narrow ? 1 : 2,
    narrow,
  }
}

/**
 * 取某个会话的运行条快照；没有记录就给全 0（新会话不带上一条会话的数）。
 * @param {Record<string, object>} snapshots - 以 sessionId 为键的快照表。
 * @param {string} sessionId - 会话 id。
 * @returns {{rounds: number, steps: number, tokens: number, cacheHit: number, contextPct: number}} 快照。
 */
export function runbarFor(snapshots, sessionId) {
  const saved = snapshots === null || snapshots === undefined ? undefined : snapshots[sessionId]
  if (saved === undefined || saved === null) return { ...RUNBAR_ZERO }
  return {
    rounds: Math.max(0, Math.round(Number(saved.rounds) || 0)),
    steps: Math.max(0, Math.round(Number(saved.steps) || 0)),
    tokens: Math.max(0, Math.round(Number(saved.tokens) || 0)),
    cacheHit: Math.max(0, Math.round(Number(saved.cacheHit) || 0)),
    contextPct: Math.min(100, Math.max(0, Number(saved.contextPct) || 0)),
  }
}

/**
 * 从宿主的 usage 取某个会话的运行条：拿不到就给 0，并标 `usageAvailable:false`
 * （调用方据此打一条「usage 不可用」）。外壳**不自己累计**——上一版自己记数把 51 轮带进新会话。
 * @param {Record<string, object>|null|undefined} usage - 宿主/session 事件给的计量表。
 * @param {string} sessionId - 会话 id。
 * @returns {{snapshot: object, usageAvailable: boolean}} 快照与宿主数据是否可用。
 */
export function runbarFromHost(usage, sessionId) {
  const entry = usage === null || usage === undefined ? undefined : usage[sessionId]
  if (entry === undefined || entry === null) {
    return { snapshot: { ...RUNBAR_ZERO }, usageAvailable: false }
  }
  return { snapshot: runbarFor(usage, sessionId), usageAvailable: true }
}

/**
 * 记一条会话的运行条快照（不改入参，返回新对象）。
 * @param {Record<string, object>} snapshots - 原快照表。
 * @param {string} sessionId - 会话 id。
 * @param {object} patch - 本轮要更新的字段。
 * @returns {Record<string, object>} 新快照表。
 */
export function recordRunbar(snapshots, sessionId, patch) {
  const base = snapshots === null || snapshots === undefined ? {} : snapshots
  // 写的时候也过一遍 runbarFor：负轮数、>100% 的上下文这类脏值在入口就夹住，读侧才是最后一道。
  const merged = { ...runbarFor(base, sessionId), ...patch }
  return { ...base, [sessionId]: runbarFor({ [sessionId]: merged }, sessionId) }
}

/**
 * 外壳浮层（⌘K / `shell.overlay` 任一层）开着时，⌘N 不抢。
 * @param {{ overlayOpen?: boolean }} [input] - 浮层是否开着。
 * @returns {boolean} true 表示让路。
 */
export function yieldsToOverlay({ overlayOpen = false } = {}) {
  return overlayOpen === true
}
