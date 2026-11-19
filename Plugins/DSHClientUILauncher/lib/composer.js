/**
 * composer 四件里的纯逻辑：`/` 命令匹配、附件条规则、上下文计量、排队消息状态机。
 *
 * 渲染层（client/）只负责画；这里的每个函数都能在 node:test 里直接断言，
 * 对应 05-设计 §6.3 的接口与 §10-6/13/14 的断言口径。
 */

/** `/` 查询上限（含），超过就关菜单。 */
export const SLASH_QUERY_LIMIT = 24

/** 附件的类型与上限（ref 不去重）。 */
export const ATTACH_LIMIT = 5

/** 计量阈值：<85 正常、≥85 提醒、≥95 告警。 */
export const METER_WARN = 85
export const METER_HOT = 95

/** 引用单条上限（字符）。 */
export const QUOTE_LIMIT = 8000

/** 词首分隔符（第二档匹配用）。 */
const WORD_SEPARATORS = new Set(['-', '_', ':', '/', '.', ' '])

/**
 * 光标前的文本是否正在触发 `/` 菜单；是则返回查询串。
 * 规则：行首的 `/`，其后不含空白与第二个 `/`，长度 ≤ 24；`/usr/bin` 与 `/ ` 都不开。
 * @param {string} textBeforeCaret - 光标前的整段文本。
 * @returns {string|null} 查询串（可为空串）；不触发返回 null。
 */
export function slashQueryOf(textBeforeCaret) {
  const text = typeof textBeforeCaret === 'string' ? textBeforeCaret : ''
  const lineStart = text.lastIndexOf('\n') + 1
  const line = text.slice(lineStart)
  const match = /^\/([^\s/]*)$/.exec(line)
  if (match === null) return null
  const query = match[1]
  if (query.length > SLASH_QUERY_LIMIT) return null
  return query
}

/** 匹配档位：0 名字前缀、1 词首、2 任意位置；不匹配返回 -1。 */
function tierOf(name, query) {
  const lowerName = String(name).toLowerCase()
  if (lowerName.startsWith(query)) return 0
  for (let index = 0; index < lowerName.length; index += 1) {
    if (!WORD_SEPARATORS.has(lowerName[index])) continue
    if (lowerName.startsWith(query, index + 1)) return 1
  }
  return lowerName.includes(query) ? 2 : -1
}

/**
 * `/` 菜单过滤：三档匹配，同档按名字排；空查询返回全部（按名字）。
 * @param {Array<{ name: string }>} items - 已注册的条目。
 * @param {string} query - 光标后的查询串。
 * @returns {Array<{ name: string }>} 过滤并排序后的条目。
 */
export function filterSlash(items, query) {
  const list = Array.isArray(items) ? items : []
  const needle = String(query ?? '').toLowerCase()
  if (needle.length > SLASH_QUERY_LIMIT) return []
  if (needle.length === 0) {
    return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  }
  const scored = []
  for (const item of list) {
    const tier = tierOf(String(item.name), needle)
    if (tier >= 0) scored.push({ item, tier })
  }
  scored.sort((a, b) => a.tier - b.tier || String(a.item.name).localeCompare(String(b.item.name)))
  return scored.map((entry) => entry.item)
}

/**
 * 附件条：上限 5、同 kind+name 去重（ref 不去重）、失败返回原因。
 * @param {Array<{ id: string, kind: string, name: string }>} items - 现有条目。
 * @param {{ kind: string, name: string }} next - 要加的一条（还没有 id）。
 * @param {() => string} [makeId] - id 生成器（测试注入）。
 * @returns {{ ok: true, item: object, items: object[] } | { ok: false, reason: 'dup'|'limit', message: string, items: object[] }} 结果与新的完整列表。
 */
export function addAttachment(items, next, makeId = () => `att-${Math.random().toString(36).slice(2, 10)}`) {
  const list = Array.isArray(items) ? items : []
  if (list.length >= ATTACH_LIMIT) {
    return { ok: false, reason: 'limit', message: `最多 ${ATTACH_LIMIT} 个附件`, items: list }
  }
  const duplicate = next.kind !== 'ref'
    && list.some((item) => item.kind === next.kind && item.name === next.name)
  if (duplicate) {
    return { ok: false, reason: 'dup', message: '已经加过同名附件', items: list }
  }
  const item = { ...next, id: makeId() }
  return { ok: true, item, items: [...list, item] }
}

/**
 * 上下文计量：真机口径 = round(used / window * 100)，不用原型的"每 200 字 +1%"。
 * @param {{ used: number, window: number }} input - 已用与窗口 token。
 * @returns {{ pct: number, level: 'normal'|'warn'|'hot' }} 百分比与档位。
 */
export function meterOf({ used, window } = {}) {
  const total = Number(window)
  const spent = Number(used)
  const raw = Number.isFinite(total) && total > 0 && Number.isFinite(spent)
    ? Math.round((spent / total) * 100)
    : 0
  const pct = Math.min(100, Math.max(0, raw))
  const level = pct >= METER_HOT ? 'hot' : (pct >= METER_WARN ? 'warn' : 'normal')
  return { pct, level }
}

/**
 * 计量状态的提示文案（04-A2 · D2，口径来自 v4-变更与分工 §2）：
 * `≥85%` 的 tooltip 提示「该压缩了」；`≥95%` 是同一句话的更强呈现（红档 + role=alert，
 * 由渲染层决定），不另起文案——设计师若给了 ≥95 的原话，改这一个常量即可。
 * @param {'normal'|'warn'|'hot'} level - meterOf 的档位。
 * @returns {{ text: string, urgency: 'none'|'warn'|'alert' }} tooltip 文案与告警强度。
 */
export function meterHint(level) {
  if (level === 'hot') return { text: '该压缩了', urgency: 'alert' }
  if (level === 'warn') return { text: '该压缩了', urgency: 'warn' }
  return { text: '', urgency: 'none' }
}

/**
 * 四项拆分：按最大余数法取整，保证四项之和 === 显示的 pct（§10-14 的断言）。
 * @param {{ system: number, chat: number, files: number, tools: number }} raw - 四项原始占比（同口径的任意正数）。
 * @param {number} pct - 要凑到的总百分比（meterOf 的结果）。
 * @returns {{ system: number, chat: number, files: number, tools: number }} 取整后的四项。
 */
export function breakdownOf(raw, pct) {
  const keys = ['system', 'chat', 'files', 'tools']
  const total = Number(pct)
  if (!Number.isFinite(total) || total <= 0) return { system: 0, chat: 0, files: 0, tools: 0 }
  const values = keys.map((key) => Math.max(0, Number(raw?.[key]) || 0))
  const sum = values.reduce((acc, value) => acc + value, 0)
  const exact = sum > 0 ? values.map((value) => (value / sum) * total) : values.map(() => total / keys.length)
  const floors = exact.map((value) => Math.floor(value))
  let remainder = Math.round(total) - floors.reduce((acc, value) => acc + value, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const entry of order) {
    if (remainder <= 0) break
    floors[entry.index] += 1
    remainder -= 1
  }
  return { system: floors[0], chat: floors[1], files: floors[2], tools: floors[3] }
}

/**
 * 排队消息：只在"正在发送"时入队；`fire` 按会话串行、3s 等 run 结束、超时留在队列；
 * 同一 id 二次 `fire` 返回 `gone`，不重复发一条（§6.3-④、§10-6）。
 * @param {{
 *   isSending?: (sessionId: string) => boolean,
 *   abort?: (sessionId: string) => void,
 *   waitForRunEnd?: (sessionId: string, timeoutMs: number) => Promise<boolean>,
 *   send?: (sessionId: string, message: { text: string, attachments: object[] }) => void | Promise<void>,
 *   makeId?: () => string,
 *   now?: () => number,
 * }} [deps] - 外部能力，测试可注入。
 * @returns {object} 队列服务面：enqueue/list/edit/remove/fire/count/clear。
 */
export function createQueue(deps = {}) {
  const isSending = deps.isSending ?? (() => true)
  const abort = deps.abort ?? (() => {})
  const waitForRunEnd = deps.waitForRunEnd ?? (async () => true)
  const send = deps.send ?? (() => {})
  const makeId = deps.makeId ?? (() => `q-${Math.random().toString(36).slice(2, 10)}`)
  const now = deps.now ?? (() => Date.now())
  const items = []
  const inFlight = new Set()
  const sessionOf = new Map()

  const find = (id) => items.find((item) => item.id === id) ?? null

  return {
    /** 入队（仅 sending 时）；否则返回 not-sending，调用方直接发送。 */
    enqueue(message, sessionId = '') {
      if (!isSending(sessionId)) {
        return { ok: false, reason: 'not-sending', message: '当前没有在发送，直接发这条' }
      }
      const item = {
        id: makeId(),
        text: String(message?.text ?? ''),
        attachments: Array.isArray(message?.attachments) ? [...message.attachments] : [],
        createdAt: now(),
      }
      items.push(item)
      sessionOf.set(item.id, sessionId)
      return { ok: true, item }
    },
    list: () => items.map((item) => ({ ...item })),
    count: () => items.length,
    /** 取回输入框并从队列移除。 */
    edit(id) {
      const item = find(id)
      if (item === null) return null
      items.splice(items.indexOf(item), 1)
      sessionOf.delete(id)
      return { ...item }
    },
    remove(id) {
      const item = find(id)
      if (item === null) return false
      items.splice(items.indexOf(item), 1)
      sessionOf.delete(id)
      return true
    },
    /**
     * 立刻发一条排队消息：abort 当前 run → 等 run 结束（≤3s）→ 出队 → 发送。
     * @param {string} id - 队列条目 id。
     * @returns {Promise<{ ok: true } | { ok: false, reason: 'abort-timeout'|'gone'|'busy' }>} 结果。
     */
    async fire(id) {
      if (inFlight.has(id)) return { ok: false, reason: 'busy' }
      const item = find(id)
      if (item === null) return { ok: false, reason: 'gone' }
      const sessionId = sessionOf.get(id) ?? ''
      inFlight.add(id)
      try {
        abort(sessionId)
        const ended = await waitForRunEnd(sessionId, 3000)
        if (ended !== true) return { ok: false, reason: 'abort-timeout' }
        if (find(id) === null) return { ok: false, reason: 'gone' }
        items.splice(items.indexOf(item), 1)
        sessionOf.delete(id)
        await send(sessionId, { text: item.text, attachments: item.attachments })
        return { ok: true }
      } finally {
        inFlight.delete(id)
      }
    },
    clear() {
      items.length = 0
      sessionOf.clear()
    },
  }
}

/**
 * 引用插入：每行前置 `> `，追加到输入框末尾（隔一个空行），单条 ≤ 8000 字。
 * @param {string} text - 引用原文。
 * @returns {{ ok: true, block: string, lines: number } | { ok: false, reason: 'empty'|'too-long', message: string }} 结果。
 */
export function quoteBlockOf(text) {
  const raw = typeof text === 'string' ? text.replace(/\r\n/g, '\n') : ''
  if (raw.trim().length === 0) return { ok: false, reason: 'empty', message: '没有可引用的内容' }
  if (raw.length > QUOTE_LIMIT) return { ok: false, reason: 'too-long', message: `单条引用最多 ${QUOTE_LIMIT} 字` }
  const lines = raw.split('\n')
  return { ok: true, block: lines.map((line) => `> ${line}`.trimEnd()).join('\n'), lines: lines.length }
}
