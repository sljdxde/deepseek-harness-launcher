/**
 * 主区渲染与状态（票 32）：对话流 + 各类卡片 + 输入行 + 命令面板。
 *
 * 与 shell 同一条纪律：浏览器半区是宿主加载器加载的单文件，不能 import；
 * 这里的渲染函数统一「传 h」，状态变换都是纯函数，所以 Node 侧用假 h 就能断言，
 * 再由 tools/sync-contract.mjs 用 toString 内联进 client.js 的 main-from-lib 标记区。
 *
 * 视觉基线：docs/ui-rebuild/prototype/dsh-ui-merged-v17.html（人类确认版）。
 * 只搬主区（流 / 卡片 / 输入行 / 命令面板），不碰 rail / sidebar / dock / settings。
 */

/** 审批三态（顺序即按钮顺序）。tone 用于按钮配色，icon 用于按钮图标。 */
const MAIN_APPROVAL_CHOICES = Object.freeze({
  allow: Object.freeze({ label: '允许一次', tone: 'primary', icon: 'check' }),
  always: Object.freeze({ label: '总是允许这类', tone: '', icon: '' }),
  deny: Object.freeze({ label: '拒绝', tone: 'ghost danger', icon: 'x' }),
})

/** 命令面板的演示命令（真实命令由宿主命令源接入，这里只保证可搜/可选/可执行）。 */
const MAIN_DEMO_COMMANDS = Object.freeze([
  Object.freeze({ id: 'conversation', label: '回到会话', hint: '⌘1' }),
  Object.freeze({ id: 'settings', label: '打开设置', hint: 'settings · ⌘,' }),
  Object.freeze({ id: 'theme', label: '切换日间 / 夜间', hint: '⌘⇧L' }),
  Object.freeze({ id: 'dock', label: '开关右栏', hint: '⌘J' }),
])

/**
 * 主区演示线程：一轮完整对话（用户 / 助手折叠+工具+计划+改动 / 任务卡 / 审批卡 / 汇报卡 / 用户）。
 * 供外壳的「主区外观预览」和单测使用；真实会话仍由宿主 main 槽渲染。
 */
const MAIN_DEMO_THREAD = Object.freeze([
  Object.freeze({
    k: 'user',
    id: 'u1',
    t: '把 dsh 界面整套换掉：以现在这版原型为骨架，把仿工作台那版的密度和组件拿过来。任务卡、汇报卡不能变样。',
    at: '14:02',
  }),
  Object.freeze({
    k: 'bot',
    id: 'b1',
    fold: Object.freeze({ dur: '6 分 12 秒', files: 14, cmds: 5 }),
    tx: Object.freeze([
      '按骨架 + 组件两层拆：外壳与信息架构沿用现有原型，对话流与右栏沿用工作台那版（运行摘要折叠、工具行、任务卡、汇报卡、改动卡、审批卡）。',
      '配色只保留一套基准：日间暖纸 + 夜间近黑，对比度按 WCAG AA 校过一遍。',
    ]),
    tools: Object.freeze([
      Object.freeze({ k: 'Read', c: 'dsh-ui-proto-v2.html', d: '0.2 s' }),
      Object.freeze({ k: 'Read', c: 'dsh-ui-prototype.html', d: '0.2 s' }),
      Object.freeze({ k: 'Bash', c: 'ls tasks/*/frozen/*.html', d: '0.4 s' }),
      Object.freeze({ k: 'Grep', c: '插件｜扩展管理｜归档', d: '0.1 s' }),
      Object.freeze({ k: 'Write', c: 'dsh-ui-merged.html', d: '1.1 s' }),
    ]),
    plan: Object.freeze([
      Object.freeze({ s: '对齐两版的信息架构差异', st: 'done' }),
      Object.freeze({ s: '对话流与右栏组件移植', st: 'done' }),
      Object.freeze({ s: '日夜两套 + 窄窗校对', st: 'doing' }),
      Object.freeze({ s: '接线到 dsh 插件槽位', st: 'next' }),
    ]),
    chg: Object.freeze([
      Object.freeze({ f: 'dsh-ui-merged.html', add: 218, del: 0 }),
      Object.freeze({ f: 'notes/fusion.md', add: 64, del: 12 }),
    ]),
  }),
  Object.freeze({
    k: 'task',
    id: 't1',
    who: '任务卡 · dsh-bot',
    title: '融合版原型（现有 + 工作台）',
    assignee: 'UI-UX 设计师',
    pct: 62,
    rows: Object.freeze([
      Object.freeze({ t: '外壳与导航（图标栏 / 侧栏 / 顶栏）', st: 'done' }),
      Object.freeze({ t: '对话流：运行摘要、工具行、任务卡、汇报卡', st: 'done' }),
      Object.freeze({ t: '右栏审阅：改动卡 + 提交', st: 'doing' }),
      Object.freeze({ t: '窄窗 320 与键盘走查', st: 'doing' }),
    ]),
    dyn: '14:31 外壳完成 · 14:38 对话流完成 · 14:52 右栏完成',
  }),
  Object.freeze({
    k: 'approval',
    id: 'a1',
    cwd: '~/Pod',
    cmd: 'npm run build -- --watch',
    why: '会写 dist/ 并常驻一个进程。批准后同一条命令不再问。',
  }),
  Object.freeze({
    k: 'report',
    id: 'r1',
    status: 'READY',
    title: '融合版能点了',
    body: '骨架全是现有原型那套，换掉的是密度：对话流有运行摘要折叠、工具行、任务卡、汇报卡、改动卡、审批卡；右栏审阅带 diff 和提交。日 / 夜、320 窄窗、键盘焦点都过了一遍。',
    links: Object.freeze(['dsh-ui-merged.html', '图标声明表']),
    dyn: '评测：数据是演示数据，写操作只改本地状态。',
  }),
  Object.freeze({ k: 'user', id: 'u2', t: '先看夜间的密度够不够，不够就再压一档。', at: '14:56' }),
])

/** 对外别名（测试与调用方用短名字；浏览器生成块里用 MAIN_ 前缀避免与既有常量撞名）。 */
export const APPROVAL_CHOICES = MAIN_APPROVAL_CHOICES
export const DEMO_COMMANDS = MAIN_DEMO_COMMANDS
export const DEMO_THREAD = MAIN_DEMO_THREAD

/** 主区用到的 Tabler 线性图标体（1.7 描边由 CSS 控制）。 */
export const MAIN_ICONS = Object.freeze({
  caret: '<path d="M9 6l6 6l-6 6" />',
  chevronDown: '<path d="M6 9l6 6l6 -6" />',
  chevronRight: '<path d="M9 6l6 6l-6 6" />',
  check: '<path d="M5 12l5 5l10 -10" />',
  x: '<path d="M18 6l-12 12" /><path d="M6 6l12 12" />',
  alert: '<path d="M12 9v4" /><path d="M12 17l.01 0" /><path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18" />',
  terminal: '<path d="M5 7l5 5l-5 5" /><path d="M12 19l7 0" />',
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />',
  eye: '<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />',
  target: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0" /><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
  sparkles: '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" />',
  copy: '<path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" /><path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2" />',
  doc: '<path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />',
  git: '<path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" /><path d="M12 3v6" /><path d="M12 15v6" />',
  bot: '<path d="M6 6m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z" /><path d="M9 12l.01 0" /><path d="M15 12l.01 0" />',
  arrowUp: '<path d="M12 5l0 14" /><path d="M16 9l-4 -4l-4 4" />',
  search: '<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" /><path d="M21 21l-6 -6" />',
  message: '<path d="M8 9h8" /><path d="M8 13h6" /><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z" />',
  plus: '<path d="M12 5l0 14" /><path d="M5 12l14 0" />',
})

/**
 * 生成一个 24×24 线性图标节点（未知名字给空体，不 throw）。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {string} name - MAIN_ICONS 的键。
 * @returns {any} SVG vnode。
 */
export function mainIcon(h, name) {
  const body = MAIN_ICONS[name] ?? ''
  return h('svg', {
    viewBox: '0 0 24 24',
    className: 'launcher-ic',
    'aria-hidden': 'true',
    focusable: 'false',
    dangerouslySetInnerHTML: { __html: body },
  })
}

/* ============ 纯状态变换 ============ */

/**
 * 写审批决策（允许 / 总是允许 / 拒绝）。非法 choice 不改任何东西。
 * @param {Record<string, string>} [state] - 当前 cardId → choice 表。
 * @param {string} cardId - 审批卡 id。
 * @param {string} choice - allow / always / deny。
 * @returns {Record<string, string>} 新表（不修改入参）。
 */
export function applyApproval(state, cardId, choice) {
  if (!Object.prototype.hasOwnProperty.call(MAIN_APPROVAL_CHOICES, choice)) return { ...(state ?? {}) }
  return { ...(state ?? {}), [cardId]: choice }
}

/**
 * 撤销一条审批决策。
 * @param {Record<string, string>} [state] - 当前表。
 * @param {string} cardId - 审批卡 id。
 * @returns {Record<string, string>} 新表。
 */
export function resetApproval(state, cardId) {
  const next = { ...(state ?? {}) }
  delete next[cardId]
  return next
}

/**
 * 读一条审批状态，缺省 pending。
 * @param {Record<string, string>|undefined} state - 当前表。
 * @param {string} cardId - 审批卡 id。
 * @returns {string} allow / always / deny / pending。
 */
export function approvalOf(state, cardId) {
  return state?.[cardId] ?? 'pending'
}

/**
 * 线程里仍待批的审批卡。
 * @param {Record<string, string>} [state] - 当前表。
 * @param {any[]} [thread] - 会话线程。
 * @returns {any[]} 待批卡列表（按线程顺序）。
 */
export function pendingApprovals(state, thread) {
  const list = Array.isArray(thread) ? thread : []
  return list.filter((m) => m?.k === 'approval' && approvalOf(state, m.id) === 'pending')
}

/** 线程里是否有待批卡（决定输入框上方是否出审批停靠条）。 */
export function isApprovalPending(state, thread) {
  return pendingApprovals(state, thread).length > 0
}

/** 输入行能否发送：trim 后非空才可发（空内容发送键 disabled）。 */
export function composerCanSend(text) {
  return String(text ?? '').trim() !== ''
}

/**
 * Enter / Shift+Enter 语义。
 * @param {{ key?: string, shiftKey?: boolean, canSend?: boolean }} [input] - 键事件摘要。
 * @returns {'send'|'newline'|'none'} 该做什么。
 */
export function composerKeyDown({ key, shiftKey = false, canSend = false } = {}) {
  if (key !== 'Enter') return 'none'
  if (shiftKey) return 'newline'
  return canSend ? 'send' : 'none'
}

/**
 * 命令面板过滤（label + hint，大小写不敏感）。
 * @param {any[]} [commands] - 命令表。
 * @param {string} [query] - 搜索词。
 * @returns {any[]} 过滤后的命令。
 */
export function paletteFilter(commands, query) {
  const list = Array.isArray(commands) ? commands : []
  const q = String(query ?? '').trim().toLowerCase()
  if (q === '') return list.slice()
  return list.filter((cmd) => `${cmd?.label ?? ''} ${cmd?.hint ?? ''}`.toLowerCase().includes(q))
}

/**
 * 选中项移动（循环）。空表返回 0。
 * @param {number} index - 当前下标。
 * @param {number} delta - +1 / -1。
 * @param {number} length - 列表长度。
 * @returns {number} 新下标。
 */
export function paletteStep(index, delta, length) {
  const len = Number.isInteger(length) ? length : 0
  if (len <= 0) return 0
  const base = Number.isInteger(index) ? index : 0
  return ((base + delta) % len + len) % len
}

/**
 * 命令面板键位语义。
 * @param {{ key?: string, hasSelection?: boolean }} [input] - 键与是否有选中项。
 * @returns {'close'|'next'|'prev'|'run'|'none'} 该做什么。
 */
export function paletteCommand({ key, hasSelection = false } = {}) {
  if (key === 'Escape') return 'close'
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'prev'
  if (key === 'Enter' && hasSelection) return 'run'
  return 'none'
}

/**
 * 切换一张卡片的展开态。
 * @param {Record<string, boolean>} [map] - 展开表。
 * @param {string} key - 卡片键。
 * @returns {Record<string, boolean>} 新表。
 */
export function toggleExpanded(map, key) {
  const next = { ...(map ?? {}) }
  if (next[key] === true) delete next[key]
  else next[key] = true
  return next
}

/**
 * 消息滚动是否跟随到底：贴底（差距 ≤ threshold）才跟随，用户往上翻就不打扰。
 * @param {{ scrollTop?: number, clientHeight?: number, scrollHeight?: number, threshold?: number }} [input] - 滚动几何。
 * @returns {boolean} 是否跟随。
 */
export function shouldFollowScroll({ scrollTop, clientHeight, scrollHeight, threshold = 48 } = {}) {
  const top = Number(scrollTop) || 0
  const client = Number(clientHeight) || 0
  const height = Number(scrollHeight) || 0
  const gap = Number(threshold) || 0
  return height - (top + client) <= gap
}

/* ============ 纯渲染 ============ */

/** 用户消息。 */
export function renderUserMessage(h, msg) {
  const m = msg ?? {}
  return h('div', { className: 'launcher-turn' },
    h('div', { className: 'launcher-msg-user' },
      h('span', { className: 'launcher-msg-user__text' }, String(m.t ?? '')),
      m.at ? h('div', { className: 'launcher-stamp' }, String(m.at)) : null))
}

/** 运行摘要折叠行（已处理 X · 读了 N 个文件 · 运行 M 条命令）。 */
export function renderFoldSummary(h, fold, opts = {}) {
  const f = fold ?? {}
  const open = opts.open === true
  return h('button', {
    type: 'button',
    className: `launcher-fold${open ? ' open' : ''}`,
    'aria-expanded': open,
    'data-fold': opts.id ?? '',
    onClick: () => opts.onToggle?.(opts.id),
  },
  mainIcon(h, 'caret'),
  h('span', null, `已处理 ${f.dur ?? ''} · 读了 ${f.files ?? 0} 个文件 · 运行 ${f.cmds ?? 0} 条命令`))
}

/** 工具行列表（可展开 / 收起）。 */
export function renderTools(h, tools, opts = {}) {
  const list = Array.isArray(tools) ? tools : []
  const open = opts.open === true
  const children = [
    h('button', {
      type: 'button',
      className: 'launcher-tools__h',
      'aria-expanded': open,
      onClick: () => opts.onToggle?.(opts.id),
    },
    mainIcon(h, 'terminal'),
    h('span', null, `这一轮跑了 ${list.length} 步`),
    h('span', { className: 'launcher-tools__n' }, open ? '收起' : '展开'),
    h('span', { className: 'launcher-main-grow' }),
    mainIcon(h, open ? 'chevronDown' : 'chevronRight')),
  ]
  if (open) {
    for (const t of list) {
      children.push(h('div', { className: `launcher-tool-row${t?.bad === true ? ' bad' : ''}` },
        mainIcon(h, t?.k === 'Bash' ? 'terminal' : t?.k === 'Write' ? 'file' : 'eye'),
        h('span', { className: 'launcher-tool-row__k' }, String(t?.k ?? '')),
        h('span', { className: 'launcher-tool-row__c', title: String(t?.c ?? '') }, String(t?.c ?? '')),
        h('span', { className: 'launcher-tool-row__d' }, String(t?.d ?? ''))))
    }
  }
  return h('div', { className: 'launcher-tools', 'aria-expanded': open }, ...children)
}

/** 实现计划卡（步骤 + 进度计数）。 */
export function renderPlan(h, plan) {
  const list = Array.isArray(plan) ? plan : []
  const done = list.filter((p) => p?.st === 'done').length
  return h('div', { className: 'launcher-plan' },
    h('div', { className: 'launcher-plan__h' },
      mainIcon(h, 'target'),
      h('span', null, '实现计划'),
      h('span', { className: 'launcher-main-kbd' }, `${done} / ${list.length}`)),
    list.map((p, idx) => h('div', { className: `launcher-plan-step ${p?.st ?? ''}` },
      h('span', { className: 'launcher-plan-step__no' }, p?.st === 'done' ? '✓' : String(idx + 1)),
      h('span', { className: 'launcher-plan-step__nm' }, String(p?.s ?? '')),
      h('span', { className: 'launcher-main-tag' }, p?.st === 'done' ? '完成' : p?.st === 'doing' ? '进行中' : '待排期'))))
}

/** 任务卡（勾选项）。 */
export function renderTaskCard(h, card, opts = {}) {
  const c = card ?? {}
  const rows = Array.isArray(c.rows) ? c.rows : []
  const crit = opts.crit ?? {}
  return h('div', { className: 'launcher-bcard', 'data-card': 'task' },
    h('div', { className: 'launcher-bcard__h' },
      mainIcon(h, 'target'),
      h('span', { className: 'launcher-bcard__who' }, String(c.who ?? '')),
      h('span', { className: 'launcher-main-tag acc' }, String(c.assignee ?? '')),
      h('span', { className: 'launcher-bcard__r' }, h('span', { className: 'launcher-main-tag' }, `覆盖 ${rows.length} 项`))),
    h('div', { className: 'launcher-bcard__b' },
      h('h4', { className: 'launcher-card-t' }, String(c.title ?? '')),
      h('div', { className: 'launcher-sub' }, '做完一项勾一项，勾完即算过。'),
      h('div', { className: 'launcher-prog-row' },
        h('span', null, `${Number(c.pct) || 0}%`),
        h('div', { className: 'launcher-bar' }, h('i', { style: { width: `${Number(c.pct) || 0}%` } }))),
      h('div', { className: 'launcher-crit' }, rows.map((r, idx) => {
        const key = `${c.title ?? ''}${idx}`
        const on = crit[key] === true
        return h('label', { className: 'launcher-crit-row' },
          h('input', { type: 'checkbox', checked: on, 'data-crit-key': key, onChange: () => opts.onToggleCrit?.(key) }),
          h('span', { className: on ? 'on' : '' }, String(r?.t ?? '')),
          h('span', { className: 'launcher-crit__who' }, r?.st === 'done' ? '完成' : r?.st === 'doing' ? '在做' : '待办'))
      })),
      c.dyn ? h('div', { className: 'launcher-dyn' }, h('b', null, '动态'), h('span', null, String(c.dyn))) : null))
}

/** 汇报卡（展开动态）。 */
export function renderReportCard(h, card, opts = {}) {
  const c = card ?? {}
  const open = opts.open === true
  const links = Array.isArray(c.links) ? c.links : []
  return h('div', { className: 'launcher-bcard', 'data-card': 'report' },
    h('div', { className: 'launcher-bcard__h' },
      mainIcon(h, 'sparkles'),
      h('span', { className: 'launcher-bcard__who' }, '汇报卡 · dsh-bot'),
      h('span', { className: 'launcher-report-tag' }, String(c.status ?? '')),
      h('span', { className: 'launcher-bcard__r' },
        h('button', { type: 'button', className: 'launcher-btn sm ghost', onClick: () => opts.onToggle?.(c.title) }, open ? '收起动态' : '展开动态'))),
    h('div', { className: 'launcher-bcard__b' },
      h('h4', { className: 'launcher-card-t' }, String(c.title ?? '')),
      h('div', { className: 'launcher-sub' }, String(c.body ?? '')),
      links.length
        ? h('div', { className: 'launcher-main-tags' }, links.map((l) => h('span', { className: 'launcher-main-tag acc' }, mainIcon(h, 'file'), String(l))))
        : null,
      open === true ? h('div', { className: 'launcher-dyn' }, h('b', null, '动态'), h('span', null, String(c.dyn ?? ''))) : null))
}

/** 改动卡（文件行 + 去审阅）。 */
export function renderChangedCard(h, chg, opts = {}) {
  const list = Array.isArray(chg) ? chg : []
  return h('div', { className: 'launcher-bcard', 'data-card': 'changed' },
    h('div', { className: 'launcher-bcard__h' },
      mainIcon(h, 'file'),
      h('span', { className: 'launcher-bcard__who' }, '改动'),
      h('span', { className: 'launcher-chg-sum' }, `${list.length} 个文件`),
      h('span', { className: 'launcher-bcard__r' },
        h('button', { type: 'button', className: 'launcher-btn sm ghost', onClick: () => opts.onReview?.() }, '去审阅', mainIcon(h, 'chevronRight')))),
    h('div', { className: 'launcher-bcard__b' }, list.map((f) => h('div', { className: 'launcher-chg-row' },
      mainIcon(h, 'file'),
      h('span', { className: 'launcher-chg-row__f', title: String(f?.f ?? '') }, String(f?.f ?? '')),
      h('span', { className: 'launcher-chg-sum' },
        h('span', { className: 'launcher-main-git-add' }, `+${f?.add ?? 0}`),
        ' ',
        h('span', { className: 'launcher-main-git-del' }, `−${f?.del ?? 0}`))))))
}

/** 审批卡：pending 三态按钮；决策后显示 done + 撤销。 */
export function renderApprovalCard(h, card, opts = {}) {
  const c = card ?? {}
  const state = opts.state ?? 'pending'
  if (state !== 'pending') {
    return h('div', { className: 'launcher-appr done', 'data-approval': state },
      h('div', { className: 'launcher-appr__h' },
        mainIcon(h, state === 'deny' ? 'x' : 'check'),
        h('span', null, state === 'deny' ? '已拒绝' : state === 'always' ? '已总是允许' : '已允许 · 本次')),
      h('div', { className: 'launcher-appr__b' },
        h('div', { className: 'launcher-appr__cmd' }, String(c.cmd ?? '')),
        h('div', { className: 'launcher-appr__hint' },
          state === 'deny' ? '没有执行。想改主意可以点下面的按钮。' : '已写进本地状态，宿主那边会记成同一种决策。',
          h('button', { type: 'button', className: 'launcher-btn sm ghost', onClick: () => opts.onReset?.(c.id) }, '撤销'))))
  }
  return h('div', { className: 'launcher-appr', 'data-approval': 'pending' },
    h('div', { className: 'launcher-appr__h' }, mainIcon(h, 'alert'), h('span', null, '需要你批准 · 运行命令')),
    h('div', { className: 'launcher-appr__b' },
      h('div', { className: 'launcher-appr__why' }, '将在 ', h('span', { className: 'launcher-codec' }, String(c.cwd ?? '~/Pod')), ' 运行下面这条。'),
      h('div', { className: 'launcher-appr__cmd' }, String(c.cmd ?? '')),
      h('div', { className: 'launcher-appr__why' }, String(c.why ?? '')),
      h('div', { className: 'launcher-appr__acts' },
        Object.entries(MAIN_APPROVAL_CHOICES).map(([choice, meta]) => h('button', {
          type: 'button',
          className: `launcher-btn ${meta.tone}`.trim(),
          'data-choice': choice,
          onClick: () => opts.onChoose?.(choice),
        }, meta.icon ? mainIcon(h, meta.icon) : null, meta.label)),
        h('span', { className: 'launcher-appr__hint' }, '输入框空着按 Enter 也能允许'))))
}

/** 审批停靠条（钉在输入框上方，待批时出现）。 */
export function renderApprovalDock(h, card, opts = {}) {
  const c = card ?? {}
  return h('div', { className: 'launcher-approval-dock' },
    mainIcon(h, 'alert'),
    h('div', { className: 'launcher-approval-dock__main' },
      h('b', null, '需要你批准 · 运行命令'),
      h('code', null, String(c.cmd ?? ''))),
    h('div', { className: 'launcher-approval-dock__acts' },
      Object.entries(MAIN_APPROVAL_CHOICES).map(([choice, meta]) => h('button', {
        type: 'button',
        className: `launcher-btn sm ${meta.tone}`.trim(),
        'data-choice': choice,
        onClick: () => opts.onChoose?.(c.id, choice),
      }, meta.label))))
}

/** 助手一轮（折叠摘要 + 正文 + 工具行 + 计划 + 改动卡 + 回合动作）。 */
export function renderBotMessage(h, msg, opts = {}) {
  const m = msg ?? {}
  const idx = opts.index ?? 0
  const expanded = opts.expanded ?? {}
  const tx = Array.isArray(m.tx) ? m.tx : []
  const children = [
    h('div', { className: 'launcher-msg-bot__hd' }, h('b', null, 'DeepSeek Harness'), h('span', null, '刚刚')),
  ]
  if (m.fold) {
    children.push(renderFoldSummary(h, m.fold, {
      id: `fold:${idx}`,
      open: expanded[`fold:${idx}`] === true,
      onToggle: opts.onToggleFold,
    }))
  }
  if (tx.length) children.push(h('div', { className: 'launcher-tx' }, tx.map((p) => h('p', null, String(p)))))
  if (m.tools?.length) {
    children.push(renderTools(h, m.tools, {
      id: `tools:${idx}`,
      open: expanded[`tools:${idx}`] === true,
      onToggle: opts.onToggleTools,
    }))
  }
  if (m.plan?.length) children.push(renderPlan(h, m.plan))
  if (m.chg?.length) children.push(renderChangedCard(h, m.chg, { onReview: opts.onReview }))
  children.push(h('div', { className: 'launcher-msg-acts' },
    ['copy', 'doc', 'target', 'git'].map((name) => h('button', {
      key: name,
      type: 'button',
      className: 'launcher-icon-btn',
      title: name,
      'aria-label': name,
      onClick: () => opts.onAction?.(name),
    }, mainIcon(h, name)))))
  return h('div', { className: 'launcher-turn' },
    h('div', { className: 'launcher-msg-bot' },
      h('span', { className: 'launcher-msg-bot__who' }, mainIcon(h, 'bot')),
      h('div', { className: 'launcher-msg-bot__bd' }, ...children)))
}

/** 整条会话流。待批卡不重复出现在流里（由停靠条负责）。 */
export function renderThread(h, thread, opts = {}) {
  const list = Array.isArray(thread) ? thread : []
  const approvals = opts.approvals ?? {}
  const expanded = opts.expanded ?? {}
  const children = []
  list.forEach((m, idx) => {
    if (m === null || typeof m !== 'object') return
    if (m.k === 'user') children.push(renderUserMessage(h, m))
    else if (m.k === 'bot') children.push(renderBotMessage(h, m, { ...opts, index: idx, expanded }))
    else if (m.k === 'task') {
      children.push(h('div', { className: 'launcher-turn' }, renderTaskCard(h, m, { crit: opts.crit, onToggleCrit: opts.onToggleCrit })))
    } else if (m.k === 'report') {
      children.push(h('div', { className: 'launcher-turn' }, renderReportCard(h, m, {
        open: expanded[`report:${m.title}`] === true,
        onToggle: opts.onToggleReport,
      })))
    } else if (m.k === 'approval') {
      const state = approvalOf(approvals, m.id)
      if (state !== 'pending') {
        children.push(h('div', { className: 'launcher-turn' }, renderApprovalCard(h, m, {
          state,
          onChoose: () => {},
          onReset: opts.onApprovalReset,
        })))
      }
    }
  })
  return h('div', { className: 'launcher-thread' }, ...children)
}

/** 输入行：空内容发送键 disabled；Enter 发送、Shift+Enter 换行。 */
export function renderComposer(h, opts = {}) {
  const value = String(opts.value ?? '')
  const canSend = opts.canSend === true
  return h('div', { className: 'launcher-composer' },
    h('div', { className: 'launcher-cm-box' },
      h('textarea', {
        className: 'launcher-cm-input',
        rows: 2,
        value,
        placeholder: '给 dsh 发消息…（Enter 发送，Shift+Enter 换行）',
        'aria-label': '输入消息',
        onChange: (event) => opts.onInput?.(event?.target?.value ?? ''),
        onKeyDown: (event) => {
          const action = composerKeyDown({ key: event.key, shiftKey: event.shiftKey === true, canSend })
          if (action === 'send') {
            event.preventDefault()
            opts.onSend?.()
          } else if (action === 'none' && event.key === 'Enter') {
            event.preventDefault()
          }
        },
      }),
      h('div', { className: 'launcher-cm-row' },
        h('span', { className: 'launcher-cm-meta' }, canSend ? 'Enter 发送' : '⌘↵ 发送'),
        // 票 34：模型/等级触发按钮由 client 传入（lib/model-surface.js），没传就不渲染。
        opts.extras ?? null,
        h('button', {
          type: 'button',
          className: 'launcher-send',
          'aria-label': '发送',
          'aria-disabled': !canSend,
          disabled: !canSend,
          onClick: () => { if (canSend) opts.onSend?.() },
        }, mainIcon(h, 'arrowUp')))))
}

/** 命令面板（⌘K）：开时可搜 / 可选中 / Enter 执行 / Esc 关。 */
export function renderCommandPalette(h, opts = {}) {
  if (opts.open !== true) return null
  const commands = Array.isArray(opts.commands) ? opts.commands : []
  const shown = paletteFilter(commands, opts.query)
  const index = Number.isInteger(opts.index) ? opts.index : 0
  const onKeyDown = (event) => {
    const action = paletteCommand({ key: event.key, hasSelection: shown.length > 0 })
    if (action === 'close') {
      event.preventDefault()
      opts.onClose?.()
      return
    }
    if (action === 'next') {
      event.preventDefault()
      opts.onMove?.(1)
      return
    }
    if (action === 'prev') {
      event.preventDefault()
      opts.onMove?.(-1)
      return
    }
    if (action === 'run') {
      event.preventDefault()
      opts.onRun?.(shown[Math.min(index, shown.length - 1)])
    }
  }
  return h('div', { className: 'launcher-palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' },
    h('div', { className: 'launcher-palette__in' },
      mainIcon(h, 'search'),
      h('input', {
        className: 'launcher-palette__input',
        placeholder: '搜命令、页面、动作…',
        value: String(opts.query ?? ''),
        'aria-label': '搜索命令',
        autoFocus: true,
        onChange: (event) => opts.onQuery?.(event?.target?.value ?? ''),
        onKeyDown,
      }),
      h('span', { className: 'launcher-main-kbd' }, 'Esc')),
    h('ul', { className: 'launcher-palette__list', id: 'launcher-palette-list' },
      shown.length === 0 ? h('li', { className: 'launcher-palette__empty' }, '没有匹配的命令') : null,
      shown.map((cmd, i) => h('li', {
        key: cmd.id,
        role: 'option',
        'aria-selected': i === index,
        className: `launcher-palette__row${i === index ? ' sel' : ''}${cmd.disabled === true ? ' off' : ''}`,
      }, h('button', {
        type: 'button',
        className: 'launcher-palette__btn',
        onClick: () => { if (cmd.disabled !== true) opts.onRun?.(cmd) },
      }, cmd.label, cmd.hint ? h('span', { className: 'launcher-palette__hint' }, cmd.hint) : null)))),
    h('div', { className: 'launcher-palette__foot' },
      h('span', null, '↑↓ 选择'),
      h('span', null, 'Enter 执行'),
      h('span', null, 'Esc 关闭')))
}

/**
 * 整个主区：滚动流 + 待批停靠条 + 输入行 + 命令面板。
 * @param {Function} h - createElement。
 * @param {object} [opts] - thread/approvals/expanded/composer/palette 与回调。
 * @returns {any} 主区 vnode。
 */
export function renderMainView(h, opts = {}) {
  const thread = Array.isArray(opts.thread) ? opts.thread : []
  const approvals = opts.approvals ?? {}
  const expanded = opts.expanded ?? {}
  const composer = opts.composer ?? {}
  const palette = opts.palette ?? {}
  const pending = pendingApprovals(approvals, thread)
  return h('div', { className: 'launcher-mainview', 'data-mainview': 'v17', onKeyDown: opts.onKeyDown },
    h('div', { className: 'launcher-thread-wrap', ref: opts.threadRef },
      renderThread(h, thread, { ...opts, approvals, expanded })),
    pending.length
      ? renderApprovalDock(h, pending[0], { onChoose: (id, choice) => opts.onApproval?.(id, choice) })
      : null,
    renderComposer(h, {
      value: composer.value,
      canSend: composer.canSend === true,
      extras: opts.composerExtras,
      onInput: opts.onCompose,
      onSend: opts.onSend,
    }),
    renderCommandPalette(h, {
      open: palette.open === true,
      query: palette.query,
      commands: palette.commands,
      index: palette.index,
      onQuery: opts.onPaletteQuery,
      onMove: opts.onPaletteMove,
      onRun: opts.onPaletteRun,
      onClose: opts.onPaletteClose,
    }))
}

/**
 * 主区样式（v17 冻结版式）：滚动流、卡片、审批、输入行、命令面板。
 * 选择器全部 `launcher-` 前缀；主区与线程都 `min-width:0` + `overflow-x:hidden`，
 * 1100-2000 宽与 320 窄窗都不产生横向溢出（票 32 验收）。
 * @returns {string} CSS 文本。
 */
export function mainCss() {
  return [
    '.launcher-ic{width:14px;height:14px;stroke-width:1.7;fill:none;stroke:currentColor;flex:none}',
    '.launcher-mainview{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:hidden;background:var(--l-bg);color:var(--l-ink);font-size:13px}',
    '.launcher-mainview *{box-sizing:border-box}',
    '.launcher-thread-wrap{flex:1 1 auto;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;padding:14px 0 8px;scrollbar-gutter:stable}',
    '.launcher-thread{max-width:740px;min-width:0;margin:0 auto;padding:0 20px;display:grid;gap:14px}',
    '.launcher-turn{display:grid;gap:10px;min-width:0}',
    '.launcher-msg-user{justify-self:end;max-width:82%;min-width:0;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-md) var(--l-radius-md) 4px var(--l-radius-md);padding:9px 13px;font-size:13px;line-height:1.5;overflow-wrap:anywhere;white-space:pre-wrap}',
    '.launcher-stamp{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4);margin-top:5px;text-align:right}',
    '.launcher-msg-bot{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;min-width:0}',
    '.launcher-msg-bot__who{width:22px;height:22px;border-radius:50%;background:var(--l-ink);color:var(--l-bg);display:grid;place-items:center;margin-top:1px}',
    '.launcher-msg-bot__bd{min-width:0;overflow-wrap:anywhere}',
    '.launcher-msg-bot__hd{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--l-ink3);margin-bottom:4px}',
    '.launcher-msg-bot__hd b{color:var(--l-ink2);font-weight:600}',
    '.launcher-tx{font-size:13px;line-height:1.5;color:var(--l-ink)}',
    '.launcher-tx p{margin:0}.launcher-tx p+p{margin-top:8px}',
    '.launcher-msg-acts{display:flex;gap:2px;margin-top:4px;opacity:0;transition:opacity .12s ease}',
    '.launcher-msg-bot:hover .launcher-msg-acts,.launcher-msg-bot:focus-within .launcher-msg-acts{opacity:1}',
    '.launcher-icon-btn{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--l-ink3);cursor:pointer}',
    '.launcher-icon-btn:hover{background:var(--l-hover);color:var(--l-ink)}',
    '.launcher-fold{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;color:var(--l-ink3);padding:3px 7px;border:0;border-radius:var(--l-radius-xs);background:transparent;margin:2px 0 2px -2px;cursor:pointer;text-align:left}',
    '.launcher-fold:hover{background:var(--l-hover);color:var(--l-ink2)}',
    '.launcher-fold svg{transition:transform .12s ease}.launcher-fold.open svg{transform:rotate(90deg)}',
    '.launcher-tools{margin:6px 0 2px;border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);overflow:hidden}',
    '.launcher-tools__h{display:flex;align-items:center;gap:7px;padding:7px 10px;font:inherit;font-size:12px;color:var(--l-ink2);width:100%;text-align:left;border:0;background:transparent;cursor:pointer}',
    '.launcher-tools__h:hover{background:var(--l-hover)}',
    '.launcher-tools__n{color:var(--l-ink4);font-family:var(--font-mono,ui-monospace);font-size:11px}',
    '.launcher-main-grow{flex:1}',
    '.launcher-tool-row{display:grid;grid-template-columns:18px 52px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid var(--l-line);font-size:12px;min-width:0}',
    '.launcher-tool-row__k{color:var(--l-ink3);font-family:var(--font-mono,ui-monospace);font-size:11px}',
    '.launcher-tool-row__c{font-family:var(--font-mono,ui-monospace);font-size:12px;color:var(--l-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.launcher-tool-row__d{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}',
    '.launcher-tool-row.bad .launcher-tool-row__c{color:var(--l-red)}',
    '.launcher-plan{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);padding:11px 12px;margin:8px 0 0}',
    '.launcher-plan__h{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--l-ink2);margin-bottom:8px}',
    '.launcher-main-kbd{margin-left:auto;font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}',
    '.launcher-plan-step{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:center;padding:5px 0;font-size:13px}',
    '.launcher-plan-step__no{width:18px;height:18px;border-radius:50%;border:1px solid var(--l-line2);display:grid;place-items:center;font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink3)}',
    '.launcher-plan-step.done .launcher-plan-step__no{background:var(--l-green-soft);border-color:transparent;color:var(--l-green)}',
    '.launcher-plan-step.doing .launcher-plan-step__no{background:var(--l-accentSoft);border-color:transparent;color:var(--l-accent)}',
    '.launcher-plan-step__nm{color:var(--l-ink2);min-width:0;overflow-wrap:anywhere}',
    '.launcher-bcard{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);overflow:hidden;margin:2px 0;min-width:0}',
    '.launcher-bcard__h{display:flex;align-items:center;gap:7px;padding:8px 12px;border-bottom:1px solid var(--l-line);font-size:12px;color:var(--l-ink3);flex-wrap:wrap;min-width:0}',
    '.launcher-bcard__who{color:var(--l-ink2);font-weight:600;white-space:nowrap}',
    '.launcher-bcard__r{margin-left:auto;display:flex;gap:5px;align-items:center}',
    '.launcher-bcard__b{padding:11px 12px;min-width:0}',
    '.launcher-card-t{font-size:14px;font-weight:600;margin:0 0 4px;overflow-wrap:anywhere}',
    '.launcher-sub{font-size:12px;color:var(--l-ink3);line-height:1.7;overflow-wrap:anywhere}',
    '.launcher-main-tag{display:inline-flex;align-items:center;gap:3px;font:11px/1 var(--font-mono,ui-monospace);border:1px solid var(--l-line);border-radius:4px;padding:2px 5px;color:var(--l-ink3);background:transparent}',
    '.launcher-main-tag.acc{color:var(--l-accent);background:var(--l-accentSoft);border-color:transparent}',
    '.launcher-report-tag{font:11px/1 var(--font-mono,ui-monospace);letter-spacing:.4px;color:var(--l-accent);background:var(--l-accentSoft);border-radius:4px;padding:3px 5px}',
    '.launcher-prog-row{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11px;color:var(--l-ink3)}',
    '.launcher-bar{flex:1;height:6px;border-radius:3px;background:var(--l-surface3);overflow:hidden}',
    '.launcher-bar i{display:block;height:100%;background:var(--l-accent)}',
    '.launcher-crit{display:grid;gap:2px;margin-top:9px;padding-top:9px;border-top:1px solid var(--l-line)}',
    '.launcher-crit-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:center;min-height:32px;padding:2px 0;font-size:12px;color:var(--l-ink2);cursor:pointer;min-width:0}',
    '.launcher-crit-row input{appearance:none;width:18px;height:18px;border:1.5px solid var(--l-line2);border-radius:4px;display:grid;place-items:center;margin:0}',
    '.launcher-crit-row input:checked{background:var(--l-accent);border-color:transparent}',
    '.launcher-crit-row span.on{color:var(--l-ink4);text-decoration:line-through}',
    '.launcher-crit__who{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}',
    '.launcher-dyn{margin-top:9px;padding-top:8px;border-top:1px solid var(--l-line);font-size:12px;color:var(--l-ink3);display:grid;gap:3px;min-width:0}',
    '.launcher-dyn b{color:var(--l-ink4);font:11px/1 var(--font-mono,ui-monospace);font-weight:500}',
    '.launcher-chg-row{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 0;font-size:12px;border-bottom:1px solid var(--l-line);min-width:0}',
    '.launcher-chg-row:last-child{border-bottom:0}',
    '.launcher-chg-row__f{font-family:var(--font-mono,ui-monospace);font-size:12px;color:var(--l-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.launcher-chg-sum{font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4);white-space:nowrap}',
    '.launcher-main-git-add{color:var(--l-green)}.launcher-main-git-del{color:var(--l-red)}',
    '.launcher-main-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}',
    '.launcher-appr{border:1px solid var(--l-line2);background:var(--l-surface);border-radius:var(--l-radius-md);overflow:hidden;min-width:0}',
    '.launcher-appr__h{display:flex;align-items:center;gap:7px;padding:8px 12px;font-size:12px;color:var(--l-amber);font-weight:600;border-bottom:1px solid var(--l-line)}',
    '.launcher-appr__b{padding:11px 12px;min-width:0}',
    '.launcher-appr__cmd{font-family:var(--font-mono,ui-monospace);font-size:12px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-sm);padding:8px 10px;margin:7px 0;overflow-x:auto;white-space:pre;color:var(--l-ink)}',
    '.launcher-appr__why{font-size:12px;color:var(--l-ink2);line-height:1.5;overflow-wrap:anywhere}',
    '.launcher-appr__hint{font-size:11px;color:var(--l-ink4);margin-top:8px;display:inline-flex;align-items:center;gap:8px}',
    '.launcher-appr__acts{display:flex;gap:6px;align-items:center;margin-top:9px;flex-wrap:wrap}',
    '.launcher-appr.done{background:var(--l-surface);border-color:var(--l-line)}',
    '.launcher-appr.done .launcher-appr__h{color:var(--l-green);border-color:var(--l-line)}',
    '.launcher-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;border:1px solid var(--l-line2);border-radius:var(--l-radius-sm);background:transparent;color:var(--l-ink2);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}',
    '.launcher-btn:hover{background:var(--l-hover);color:var(--l-ink)}',
    '.launcher-btn.primary{background:var(--l-accent);border-color:transparent;color:var(--l-onAccent)}',
    '.launcher-btn.primary:hover{filter:brightness(1.08);color:var(--l-onAccent)}',
    '.launcher-btn.ghost{border-color:transparent;background:transparent}',
    '.launcher-btn.danger{color:var(--l-red)}',
    '.launcher-btn.sm{height:26px;padding:0 8px}',
    '.launcher-codec{font-family:var(--font-mono,ui-monospace);font-size:12px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:6px;padding:1px 5px}',
    '.launcher-composer{padding:8px 14px 12px;border-top:1px solid var(--l-line);background:var(--l-bg);flex:0 0 auto;min-width:0}',
    '.launcher-cm-box{border:1px solid var(--l-line2);border-radius:var(--l-radius-md);background:var(--l-surface);padding:9px 10px 8px;min-width:0}',
    '.launcher-cm-box:focus-within{border-color:var(--l-accent);box-shadow:0 0 0 3px var(--l-accentSoft)}',
    '.launcher-cm-input{width:100%;max-width:100%;border:0;background:transparent;resize:none;font:inherit;font-size:13px;line-height:1.5;min-height:40px;max-height:160px;outline:none;display:block;padding:2px 2px 6px;color:var(--l-ink)}',
    '.launcher-cm-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}',
    '.launcher-cm-meta{margin-left:auto;font:11px/1 var(--font-mono,ui-monospace);color:var(--l-ink4)}',
    '.launcher-send{width:30px;height:30px;border:0;border-radius:var(--l-radius-sm);background:var(--l-accent);color:var(--l-onAccent);display:grid;place-items:center;cursor:pointer}',
    '.launcher-send[disabled]{opacity:.38;cursor:not-allowed}',
    '.launcher-approval-dock{border-top:1px solid var(--l-amber);background:var(--l-surface2);padding:8px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;flex:0 0 auto;min-width:0}',
    '.launcher-approval-dock__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.launcher-approval-dock__main b{font-size:12px;color:var(--l-amber)}',
    '.launcher-approval-dock__main code{font-family:var(--font-mono,ui-monospace);font-size:11px;background:var(--l-surface);border:1px solid var(--l-line);border-radius:6px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.launcher-approval-dock__acts{display:flex;gap:4px;flex-wrap:wrap}',
    '.launcher-palette{position:fixed;left:50%;top:14vh;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));max-width:100%;max-height:60vh;display:flex;flex-direction:column;background:var(--l-panel);color:var(--l-ink);border:1px solid var(--l-line2);border-radius:var(--l-radius-md);box-shadow:0 14px 34px rgba(0,0,0,.18);z-index:50;overflow:hidden}',
    '.launcher-palette__in{display:flex;align-items:center;gap:8px;padding:11px 12px;border-bottom:1px solid var(--l-line)}',
    '.launcher-palette__input{flex:1;min-width:0;border:0;background:transparent;outline:none;font:inherit;font-size:14px;color:var(--l-ink)}',
    '.launcher-palette__list{list-style:none;margin:0;padding:4px;overflow:auto;min-height:0}',
    '.launcher-palette__row{display:block;padding:0;border-radius:6px;cursor:pointer}',
    '.launcher-palette__row.sel{background:var(--l-accentSoft)}',
    '.launcher-palette__row.off{opacity:.45;cursor:not-allowed}',
    '.launcher-palette__btn{display:flex;justify-content:space-between;gap:12px;width:100%;padding:8px 10px;border:0;border-radius:6px;background:transparent;color:var(--l-ink2);font:inherit;font-size:13px;text-align:left;cursor:pointer}',
    '.launcher-palette__row.sel .launcher-palette__btn{color:var(--l-ink)}',
    '.launcher-palette__hint{color:var(--l-ink4);font:11px/1 var(--font-mono,ui-monospace)}',
    '.launcher-palette__empty{padding:10px;font-size:12px;color:var(--l-ink3)}',
    '.launcher-palette__foot{display:flex;gap:10px;padding:7px 12px;border-top:1px solid var(--l-line);font-size:11px;color:var(--l-ink4);font-family:var(--font-mono,ui-monospace)}',
  ].join('\n')
}
