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

/** 自动发出的那条在会话流里的标记文案（FR-10 V2 定稿，逐字） */
export const AUTO_SENT_LABEL = '排队后自动发送'

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
  return { pct, level: levelOf(pct) }
}

/**
 * 百分比对应的档位（FR-09 两档阈值：≥85 琥珀、≥95 红）。
 * @param {number} pct - 0–100 的百分比。
 * @returns {'normal'|'warn'|'hot'} 档位。
 */
export function levelOf(pct) {
  const value = Number(pct)
  if (!Number.isFinite(value)) return 'normal'
  if (value >= METER_HOT) return 'hot'
  if (value >= METER_WARN) return 'warn'
  return 'normal'
}

/**
 * 计量环的提示文案（04-A2 · D2，2026-11-19 设计定稿三句）。
 *
 * `title` 与 `aria-label` 用同一句；数字取实时值；拆分面板顶不加文字。
 * 颜色不走这里——琥珀/红由 `levelOf(pct)` 决定（FR-09 的 85/95 两档），文案只负责说话：
 *   `<85%`  `上下文占用 59% · 点开看拆分`
 *   `≥85%`  `上下文占用 88%，该压缩了 · 点开压到 40%`
 *   `≥95%`  `上下文占用 97%，快满了 · 点开压到 40%`
 * @param {number} pct - 0–100 的实时百分比。
 * @returns {string} 给 title 与 aria-label 的那一句。
 */
export function meterHint(pct) {
  const value = Number.isFinite(Number(pct)) ? Math.min(100, Math.max(0, Math.round(Number(pct)))) : 0
  const level = levelOf(value)
  if (level === 'hot') return `上下文占用 ${value}%，快满了 · 点开压到 40%`
  if (level === 'warn') return `上下文占用 ${value}%，该压缩了 · 点开压到 40%`
  return `上下文占用 ${value}% · 点开看拆分`
}

/**
 * 上下文面板的标题行（04-A2 留给 T3 的 D2 尾巴）：h5 除百分比还要给输入规模。
 * 例：`上下文占用 88% · 输入 1308 字 · 2 个附件`。
 * @param {{ pct: number, chars: number, attachments: number }} input - 百分比、输入字数、附件数。
 * @returns {string} h5 那一行；没有附件时不写附件段，有附件才写。
 */
export function contextPanelTitle({ pct, chars, attachments } = {}) {
  const value = Number.isFinite(Number(pct)) ? Math.min(100, Math.max(0, Math.round(Number(pct)))) : 0
  const count = Number.isFinite(Number(chars)) ? Math.max(0, Math.round(Number(chars))) : 0
  const files = Number.isFinite(Number(attachments)) ? Math.max(0, Math.round(Number(attachments))) : 0
  const tail = files > 0 ? ` · ${files} 个附件` : ''
  return `上下文占用 ${value}% · 输入 ${count} 字${tail}`
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
  let interrupted = false
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
    /**
     * 一轮**正常结束**后自动出队首条（FR-10 第 1 条）。中断后不自动发（第 2 条）：
     * 由调用方在用户点中断时先 `markInterrupted()`，直到下一次正常结束前 drain 都不动队列。
     * 自动发出的那条带 `auto: true`，界面据此标「排队后自动发送」（第 3 条）。
     * @returns {Promise<{ ok: true, item: object } | { ok: false, reason: 'empty'|'interrupted' }>} 结果。
     */
    async drain() {
      if (interrupted) return { ok: false, reason: 'interrupted' }
      const item = items[0]
      if (item === undefined) return { ok: false, reason: 'empty' }
      const sessionId = sessionOf.get(item.id) ?? ''
      items.shift()
      sessionOf.delete(item.id)
      await send(sessionId, { text: item.text, attachments: item.attachments, auto: true })
      return { ok: true, item: { ...item, auto: true } }
    },
    /** 用户点了中断：下一条不许替他自动发（FR-10 第 2 条）。 */
    markInterrupted() {
      interrupted = true
    },
    /** 有新的正常结束后解除中断标记。 */
    resume() {
      interrupted = false
    },
    clear() {
      items.length = 0
      sessionOf.clear()
      interrupted = false
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

/** 权限范围三档（FR-35 / 05 §6.3-⑥）：从宽到严。 */
export const PERMISSION_LEVELS = ['danger-full-access', 'workspace-write', 'read']

/** 指路句（浮层/提示用，逐字对应 05 §6.3-⑥）。 */
export const PERMISSION_HINTS = {
  'danger-full-access': '完全权限：可读写工作区外的路径；危险命令仍然会先问',
  'workspace-write': '工作区内修改：出工作区的写入一律拒绝',
  read: '仅可查看：不改任何文件',
}

/** 审批模式对应的权限上限：互不改文案，但取更严的那条。 */
const MODE_CAP = { readonly: 'read', ask: 'workspace-write', 'auto-safe': 'workspace-write', full: 'danger-full-access' }

/**
 * 计算权限范围 pill 的当前档（FR-35）。
 * 默认跟随宿主当前文件策略；读不到或值非法时兜底 `workspace-write`，**绝不用 `danger-full-access` 兜底**。
 * 与审批模式取更严：档位不得宽于模式允许的上限。
 * @param {{ hostPolicy?: string, approvalMode?: string }} [input] - 宿主文件策略与当前审批模式。
 * @returns {{ level: string, hint: string, fallbackUsed: boolean, cappedByMode: boolean }} pill 状态。
 */
export function permissionPill({ hostPolicy, approvalMode } = {}) {
  const valid = PERMISSION_LEVELS.includes(hostPolicy)
  const fallbackUsed = !valid
  const level = valid ? hostPolicy : 'workspace-write'
  const cap = MODE_CAP[approvalMode]
  let effective = level
  let cappedByMode = false
  if (cap !== undefined && PERMISSION_LEVELS.indexOf(cap) > PERMISSION_LEVELS.indexOf(level)) {
    effective = cap
    cappedByMode = true
  }
  return { level: effective, hint: PERMISSION_HINTS[effective], fallbackUsed, cappedByMode }
}
