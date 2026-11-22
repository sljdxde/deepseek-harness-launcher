/**
 * 右栏五面板 + 设置六分组（票 33）。
 *
 * 为什么独立成模块：client/client.js 是被加载器加载的单文件、不能 import，只能由
 * tools/sync-contract.mjs 把这里的内联进独立 region（不与 rail/sidebar/main 的生成区冲突）。
 * 这里只产出「数据 + vnode + CSS 字符串」，全部纯函数：Node 侧用假 h 就能断言结构与可访问性，
 * 真正落地（挂事件、改状态）由 client 的 LauncherRoot 负责。
 *
 * 视觉基线：docs/ui-rebuild/prototype/dsh-ui-merged-v17.html（DOCK_TABS / pageSettings / SET_GROUPS）。
 */

import { shellColumns } from './shell-layout.js'

// ---------- 右栏五面板 ----------

/** 五个内置面板，顺序即标签栏顺序（与 v17 DOCK_TABS 一致）。 */
export const DOCK_TABS = Object.freeze([
  Object.freeze({ id: 'review', label: '审阅', icon: 'file', badge: 3 }),
  Object.freeze({ id: 'files', label: '文件', icon: 'folder', badge: 0 }),
  Object.freeze({ id: 'term', label: '终端', icon: 'terminal', badge: 0 }),
  Object.freeze({ id: 'tasks', label: '任务', icon: 'target', badge: 2 }),
  Object.freeze({ id: 'side', label: '侧聊', icon: 'message', badge: 0 }),
])

/** 面板 id 列表（切面板时校验用）。 */
export const DOCK_TAB_IDS = Object.freeze(DOCK_TABS.map((tab) => tab.id))

/**
 * 造一个右栏面板状态。
 * @param {string} [initial] - 初始面板 id；非法值退回审阅。
 * @returns {{ tab: string }} 面板状态。
 */
export function createDockState(initial) {
  return { tab: DOCK_TAB_IDS.includes(initial) ? initial : 'review' }
}

/**
 * 切换面板；非法 id 保持原状（返回新对象，不改入参）。
 * @param {{ tab: string }} state - 面板状态。
 * @param {string} id - 目标面板 id。
 * @returns {{ tab: string }} 新状态。
 */
export function setDockTab(state, id) {
  const current = state?.tab ?? 'review'
  return { tab: DOCK_TAB_IDS.includes(id) ? id : current }
}

/** 右栏宽度区间与隐藏阈值（与 lib/layout.js 的 DOCK 同口径，内联到 client 时不 import）。 */
export const DOCK_WIDTHS = Object.freeze({ min: 320, max: 520, default: 380, hideBelow: 1020 })

/**
 * 右栏此刻的**有效宽度**：收起或窄于阈值给 0，否则夹在 [min, max] 并受视口预算约束。
 * 收起→0、展开→固定值，这一步只改一列宽度，主区由 grid 的 minmax(0,1fr) 吸收，不会跳。
 * @param {{ viewportWidth?: number, requestedWidth?: number, open?: boolean, min?: number, max?: number, hideBelow?: number }} [input]
 * @returns {number} 有效宽度（px）。
 */
export function dockWidthFor({ viewportWidth, requestedWidth, open = true, min = DOCK_WIDTHS.min, max = DOCK_WIDTHS.max, hideBelow = DOCK_WIDTHS.hideBelow } = {}) {
  const viewport = Number(viewportWidth)
  const vw = Number.isFinite(viewport) && viewport > 0 ? viewport : 1440
  if (open !== true || vw < hideBelow) return 0
  // 视口预算：给主区至少留 816（1440 参考下 56+280+480+380=1196，余量给间距）
  const maxFor = Math.max(min, Math.min(max, Math.round(vw - 816)))
  const wanted = Number.isFinite(Number(requestedWidth)) ? Math.round(Number(requestedWidth)) : DOCK_WIDTHS.default
  return Math.max(min, Math.min(maxFor, wanted))
}

/**
 * 四列几何（含右栏）。与 lib/shell-layout.js 的 shellColumns 同一条公式，
 * 保证「合计恒等于视口」——收起/展开右栏都不会把整页撑出横向滚动。
 * @param {{ viewportWidth?: number, dockWidth?: number, sidebarCollapsed?: boolean }} [input] - 视口、右栏有效宽度、侧栏是否收起。
 * @returns {ReturnType<typeof shellColumns>} 四列宽度与是否抽屉模式。
 */
export function dockColumnsFor({ viewportWidth, dockWidth = 0, sidebarCollapsed = false } = {}) {
  return shellColumns({ viewportWidth, dockWidth, sidebarCollapsed })
}

// ---------- 面板演示数据（与 v17 一致） ----------

/** v17 右栏五面板的演示数据（端口只搬数据，不搬渲染）。 */
export const DOCK_DEMO = Object.freeze({
  diff: Object.freeze([
    Object.freeze({
      file: 'dsh-ui-merged.html',
      add: 218,
      del: 0,
      staged: false,
      lines: Object.freeze([
        Object.freeze(['', '  <!doctype html>']),
        Object.freeze(['', '  <html lang="zh-CN" data-theme="dark">']),
        Object.freeze(['+', '  <link rel="stylesheet" href="tokens.css">']),
        Object.freeze(['+', '  <script src="shell.js"></script>']),
        Object.freeze(['', '  </html>']),
      ]),
    }),
    Object.freeze({
      file: 'tokens.css',
      add: 64,
      del: 12,
      staged: false,
      lines: Object.freeze([
        Object.freeze(['-', '  --bg:#eeeae0;']),
        Object.freeze(['+', '  --bg:#121316;']),
        Object.freeze(['-', '  --accent:#3a55c8;']),
        Object.freeze(['+', '  --accent:#93a8ff;']),
      ]),
    }),
  ]),
  files: Object.freeze([
    Object.freeze({ d: 0, n: 'dsh-launcher', t: 'dir' }),
    Object.freeze({ d: 1, n: 'dsh-ui-merged.html', t: 'file', chg: true }),
    Object.freeze({ d: 1, n: 'tokens.css', t: 'file', chg: true }),
    Object.freeze({ d: 1, n: 'shell.js', t: 'file' }),
    Object.freeze({ d: 1, n: 'notes', t: 'dir' }),
    Object.freeze({ d: 2, n: 'fusion.md', t: 'file', chg: true }),
  ]),
  fileSel: 0,
  term: Object.freeze([
    Object.freeze(['p', 'yuzhou@mac-mini  ~/Pod']),
    Object.freeze(['o', 'git status --short']),
    Object.freeze(['o', ' M dsh-ui-merged.html']),
    Object.freeze(['o', ' M tokens.css']),
    Object.freeze(['ok', '✓ 42 passing（演示）']),
  ]),
  tasks: Object.freeze([
    Object.freeze({ id: 't1', t: '左栏按工作区 / 会话分组', who: 'UI-UX 设计师', col: 'doing', sub: '等用户点头' }),
    Object.freeze({ id: 't2', t: '融合版：对话流组件移植', who: '研发工程师', col: 'doing', sub: '接口已定' }),
    Object.freeze({ id: 't3', t: '图标声明表与兜底链', who: 'UI-UX 设计师', col: 'todo', sub: '没声明的用兜底' }),
    Object.freeze({ id: 't4', t: '日夜两套对比度校对', who: 'UI-UX 设计师', col: 'done', sub: '已交付' }),
  ]),
  side: Object.freeze([
    Object.freeze({ me: false, t: '这个侧聊是独立上下文的，不会污染主会话。' }),
    Object.freeze({ me: true, t: '右栏审阅的 diff 卡片按文件分块，头行带 +N。' }),
  ]),
})

/**
 * 汇总 diff：文件数 / 新增行 / 删除行。
 * @param {Array<{ add?: number, del?: number }>} [diff] - diff 文件列表。
 * @returns {{ n: number, a: number, d: number }} 汇总。
 */
export function diffSummary(diff) {
  const list = Array.isArray(diff) ? diff : []
  let a = 0
  let d = 0
  for (const file of list) {
    a += Number(file?.add) || 0
    d += Number(file?.del) || 0
  }
  return { n: list.length, a, d }
}

// ---------- 设置：六分组 ----------

/** 六个设置分组，顺序即标签顺序（与 v17 SET_GROUPS 一致）。 */
export const SET_GROUPS = Object.freeze([
  Object.freeze({ id: 'general', label: '常用' }),
  Object.freeze({ id: 'model', label: '模型' }),
  Object.freeze({ id: 'ext', label: '扩展' }),
  Object.freeze({ id: 'conn', label: '连接' }),
  Object.freeze({ id: 'data', label: '数据' }),
  Object.freeze({ id: 'adv', label: '高级' }),
])

/** 分组 id 列表。 */
export const SET_GROUP_IDS = Object.freeze(SET_GROUPS.map((group) => group.id))

/** 密度两档（general 分组用）。 */
export const DENSITY_MODES = Object.freeze([
  Object.freeze({ id: 'cozy', label: '舒适' }),
  Object.freeze({ id: 'compact', label: '紧凑' }),
])

/** 快捷键说明（general 分组「快捷键」小节）。 */
export const SET_SHORTCUTS = Object.freeze([
  Object.freeze({ keys: '⌘K', label: '命令面板' }),
  Object.freeze({ keys: '⌘J', label: '右栏' }),
  Object.freeze({ keys: '⌘D', label: '分屏' }),
  Object.freeze({ keys: '⌘⇧L', label: '日间 / 夜间' }),
  Object.freeze({ keys: '⌘,', label: '设置' }),
  Object.freeze({ keys: 'Esc', label: '关掉浮层' }),
])

const SHORTCUT_ROWS = SET_SHORTCUTS.map((item, index) => ({
  id: `shortcut-${index}`,
  label: item.label,
  control: { type: 'kbd', value: item.keys },
}))

/**
 * 六个分组的内容（每组分若干小节，每小节若干行，行带一个控件描述）。
 * 控件是纯数据：segmented / toggle / switch / static / kbd / nav / danger / disabled。
 * 全部可 JSON 序列化，供 sync 内联。
 */
export const SET_SECTIONS = Object.freeze({
  general: Object.freeze([
    Object.freeze({
      title: '外观',
      rows: Object.freeze([
        Object.freeze({
          id: 'theme',
          label: '主题',
          hint: '日夜两套对比度都过 AA',
          control: Object.freeze({ type: 'segmented', key: 'theme', options: Object.freeze([Object.freeze({ id: 'light', label: '日间' }), Object.freeze({ id: 'dark', label: '夜间' })]) }),
        }),
        Object.freeze({
          id: 'density',
          label: '密度',
          hint: '紧凑省 6px 行高，适合长对话',
          control: Object.freeze({ type: 'segmented', key: 'density', options: DENSITY_MODES }),
        }),
        Object.freeze({
          id: 'dock',
          label: '右栏',
          hint: '审阅、文件、终端、任务、侧聊',
          control: Object.freeze({ type: 'toggle', key: 'dock', onLabel: '关右栏', offLabel: '开右栏' }),
        }),
      ]),
    }),
    Object.freeze({ title: '快捷键', rows: Object.freeze(SHORTCUT_ROWS) }),
  ]),
  model: Object.freeze([
    Object.freeze({
      title: '模型',
      rows: Object.freeze([
        Object.freeze({ id: 'model', label: '模型', control: Object.freeze({ type: 'static', key: 'model', value: 'deepseek · routing group' }) }),
        Object.freeze({ id: 'reason', label: '推理等级', control: Object.freeze({ type: 'static', key: 'reason', value: 'Default' }) }),
        Object.freeze({ id: 'team', label: '启用智能体团队协作', hint: '允许多个子代理分工协作，主代理汇总', control: Object.freeze({ type: 'switch', key: 'team' }) }),
      ]),
    }),
    Object.freeze({
      title: '其他',
      rows: Object.freeze([
        Object.freeze({ id: 'submodel', label: '子代理模型', hint: '拆活时用哪条路由', control: Object.freeze({ type: 'static', value: '同主模型' }) }),
        Object.freeze({ id: 'compact', label: '上下文压缩', hint: '到 85% 提醒、95% 强制', control: Object.freeze({ type: 'static', value: '自动' }) }),
      ]),
    }),
  ]),
  ext: Object.freeze([
    Object.freeze({
      title: '扩展',
      rows: Object.freeze([
        Object.freeze({ id: 'skill', label: 'Skill 管理', hint: '装好的 Skill、从 GitHub 或文件夹安装', control: Object.freeze({ type: 'nav', target: 'ext-skill', label: '打开' }) }),
        Object.freeze({ id: 'mcp', label: 'MCP 管理', hint: '服务器、工具数、连接状态', control: Object.freeze({ type: 'nav', target: 'ext-mcp', label: '打开' }) }),
        Object.freeze({ id: 'ssh', label: 'SSH 管理', hint: '主机、端口转发', control: Object.freeze({ type: 'nav', target: 'ext-ssh', label: '打开' }) }),
        Object.freeze({ id: 'archive', label: '归档管理', hint: '归档的会话与任务', control: Object.freeze({ type: 'nav', target: 'ext-archive', label: '打开' }) }),
      ]),
    }),
  ]),
  conn: Object.freeze([
    Object.freeze({
      title: '连接',
      rows: Object.freeze([
        Object.freeze({ id: 'net', label: '网络', hint: '直连，未设代理', control: Object.freeze({ type: 'static', value: '正常' }) }),
        Object.freeze({ id: 'proxy', label: '代理', hint: 'HTTP / SOCKS 代理', control: Object.freeze({ type: 'static', value: '未设置' }) }),
        Object.freeze({ id: 'ssh', label: 'SSH 主机', hint: '已保存 3 台', control: Object.freeze({ type: 'nav', target: 'ext-ssh', label: '管理' }) }),
      ]),
    }),
  ]),
  data: Object.freeze([
    Object.freeze({
      title: '数据',
      rows: Object.freeze([
        Object.freeze({ id: 'whitelist', label: '目录白名单', hint: '白名单内不触发审批', control: Object.freeze({ type: 'static', value: '~/Pod · ~/Pod/tasks' }) }),
        Object.freeze({ id: 'archive', label: '归档', hint: '归档的会话与任务', control: Object.freeze({ type: 'nav', target: 'ext-archive', label: '打开' }) }),
        Object.freeze({ id: 'plugindata', label: '插件数据', hint: '插件自己的设置与缓存', control: Object.freeze({ type: 'static', value: '随插件管理' }) }),
      ]),
    }),
  ]),
  adv: Object.freeze([
    Object.freeze({
      title: '高级',
      rows: Object.freeze([
        Object.freeze({ id: 'revert', label: '回退原生 UI', hint: '移除 profile 依赖并重启；审批与审计不丢', control: Object.freeze({ type: 'rollback', key: 'revertNative' }) }),
        Object.freeze({ id: 'contract', label: '契约自检', hint: '接管前比对宿主版本与槽集合', control: Object.freeze({ type: 'static', value: '宿主 rc.4 / 声明 rc.5' }) }),
        Object.freeze({ id: 'update', label: '检查更新', hint: '本版不接更新通道', control: Object.freeze({ type: 'disabled', label: '检查', reason: '本版不接更新通道' }) }),
      ]),
    }),
  ]),
})

/**
 * 造一个设置状态。
 * @param {string} [initial] - 初始分组；非法值退回常用。
 * @returns {{ group: string }} 设置状态。
 */
export function createSettingsState(initial) {
  return { group: SET_GROUP_IDS.includes(initial) ? initial : 'general' }
}

/**
 * 切换设置分组；非法 id 保持原状。
 * @param {{ group: string }} state - 设置状态。
 * @param {string} id - 目标分组 id。
 * @returns {{ group: string }} 新状态。
 */
export function setSettingsGroup(state, id) {
  const current = state?.group ?? 'general'
  return { group: SET_GROUP_IDS.includes(id) ? id : current }
}

/**
 * 设置动作 → 新取值 + 副作用描述（纯函数，副作用由 client 执行）。
 * 取值先归一化，避免 UI 传进奇怪值把外观打乱。
 * @param {{ theme?: string, density?: string, dockOpen?: boolean, team?: boolean }} values - 当前取值。
 * @param {{ type: string, key?: string, value?: any, target?: string } | null} [action] - 动作。
 * @returns {{ values: object, effect: object|null }} 新取值与要执行的副作用（theme/density/dock/team/nav/danger）。
 */
export function applySetting(values, action) {
  const base = values ?? {}
  const next = {
    theme: base.theme === 'dark' ? 'dark' : 'light',
    density: base.density === 'compact' ? 'compact' : 'cozy',
    dockOpen: base.dockOpen === true,
    team: base.team === true,
  }
  if (action === null || typeof action !== 'object') return { values: next, effect: null }
  if (action.type === 'segmented') {
    if (action.key === 'theme') {
      const value = action.value === 'dark' ? 'dark' : 'light'
      return { values: { ...next, theme: value }, effect: { type: 'theme', value } }
    }
    if (action.key === 'density') {
      const value = action.value === 'compact' ? 'compact' : 'cozy'
      return { values: { ...next, density: value }, effect: { type: 'density', value } }
    }
    return { values: next, effect: null }
  }
  if (action.type === 'toggle' && action.key === 'dock') {
    const value = !next.dockOpen
    return { values: { ...next, dockOpen: value }, effect: { type: 'dock', value } }
  }
  if (action.type === 'switch' && action.key === 'team') {
    const value = !next.team
    return { values: { ...next, team: value }, effect: { type: 'team', value } }
  }
  if (action.type === 'nav') return { values: next, effect: { type: 'nav', target: String(action.target ?? '') } }
  if (action.type === 'copyRollback') return { values: next, effect: { type: 'copyRollback' } }
  if (action.type === 'danger') return { values: next, effect: { type: 'danger', key: String(action.key ?? '') } }
  return { values: next, effect: null }
}

// ---------- 图标（只搬右栏/设置用到的少量 Tabler 线性图标） ----------

/** 24×24 视野下的图标主体（描边由 CSS 控制）。 */
export const DOCK_ICONS = Object.freeze({
  file: '<path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />',
  folder: '<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2" />',
  terminal: '<path d="M8 9l3 3l-3 3" /><path d="M13 15l3 0" /><path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />',
  target: '<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0" /><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />',
  message: '<path d="M8 9h8" /><path d="M8 13h6" /><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z" />',
  git: '<path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M12 3l7 7l-7 7l-7 -7z" />',
  check: '<path d="M5 12l5 5l10 -10" />',
  plus: '<path d="M12 5l0 14" /><path d="M5 12l14 0" />',
  x: '<path d="M18 6l-12 12" /><path d="M6 6l12 12" />',
})

/**
 * 生成一个 24×24 线性图标节点（未知名字给空体，不 throw）。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {string} name - DOCK_ICONS 的键。
 * @returns {any} SVG vnode。
 */
export function dockIcon(h, name) {
  const body = DOCK_ICONS[name] ?? ''
  return h('svg', {
    viewBox: '0 0 24 24',
    className: 'launcher-ic',
    'aria-hidden': 'true',
    focusable: 'false',
    dangerouslySetInnerHTML: { __html: body },
  })
}

// ---------- 渲染：右栏 ----------

/**
 * 右栏标签栏：五个面板 + 收起按钮。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {{ tabs?: object[], active?: string, onSelect?: (id: string) => void, onCollapse?: () => void }} [options] - 标签与回调。
 * @returns {any} tablist vnode。
 */
export function renderDockTabs(h, options) {
  const opts = options ?? {}
  const tabs = Array.isArray(opts.tabs) ? opts.tabs : []
  const children = []
  for (const tab of tabs) {
    const badge = Number(tab.badge) > 0 ? String(tab.badge) : ''
    children.push(h('button', {
      key: tab.id,
      type: 'button',
      role: 'tab',
      className: `launcher-dock-tab${tab.id === opts.active ? ' on' : ''}`,
      'data-dock-tab': tab.id,
      'aria-selected': tab.id === opts.active,
      title: tab.label,
      onClick: () => { if (typeof opts.onSelect === 'function') opts.onSelect(tab.id) },
    },
    dockIcon(h, tab.icon),
    h('span', { className: 'launcher-dock-tab__label' }, tab.label),
    badge === '' ? null : h('span', { className: 'launcher-dock-tab__n' }, badge)))
  }
  children.push(h('span', { key: 'grow', className: 'launcher-dock-tabs__grow' }))
  children.push(h('button', {
    key: 'collapse',
    type: 'button',
    className: 'launcher-dock-tab launcher-dock-tab--icon',
    'data-dock-action': 'collapse',
    'aria-label': '收起右栏',
    title: '收起 ⌘J',
    onClick: () => { if (typeof opts.onCollapse === 'function') opts.onCollapse() },
  }, dockIcon(h, 'x')))
  return h('div', { className: 'launcher-dock-tabs', role: 'tablist', 'aria-label': '右栏面板' }, ...children)
}

/**
 * 右栏某面板的内容（审阅 / 文件 / 终端 / 任务 / 侧聊）。未知 tab 回退审阅，不 throw。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {{ tab?: string, data?: object, onAction?: (action: object) => void }} [options] - 面板、数据、动作回调。
 * @returns {any} tabpanel vnode。
 */
export function renderDockPanel(h, options) {
  const opts = options ?? {}
  const data = opts.data ?? {}
  const requested = opts.tab
  const tab = DOCK_TAB_IDS.includes(requested) ? requested : 'review'
  const emit = (action) => { if (typeof opts.onAction === 'function') opts.onAction(action) }
  const body = []

  const summary = diffSummary(data.diff)
  const sum = (icon, title, note, extra) => h('div', { className: 'launcher-dock-sum', key: 'sum' },
    dockIcon(h, icon),
    h('b', null, title),
    h('span', { className: 'launcher-dock-sum__g' }, note),
    extra ?? null)

  if (tab === 'review') {
    body.push(sum('git', '未提交的改动', `${summary.n} 个文件`,
      h('span', { className: 'launcher-dock-sum__cg' },
        h('span', { className: 'launcher-git-add' }, `+${summary.a}`),
        h('span', { className: 'launcher-git-del' }, `−${summary.d}`))))
    const diff = Array.isArray(data.diff) ? data.diff : []
    if (diff.length === 0) {
      body.push(h('div', { className: 'launcher-dock-empty', key: 'empty' }, '都提交了', h('p', null, '再看一遍 diff 就点上面的「文件」。')))
    }
    for (const file of diff) {
      const head = h('div', { className: 'launcher-diff-h', key: `h-${file.file}` },
        dockIcon(h, 'file'),
        h('span', { className: 'launcher-diff-h__f', title: file.file }, file.file),
        h('span', { className: 'launcher-diff-h__a' }, `+${file.add}`),
        h('span', { className: 'launcher-diff-h__d' }, `−${file.del}`),
        file.staged === true ? h('span', { className: 'launcher-tag ok', style: { marginLeft: 'auto' } }, '已暂存') : null)
      const lines = (file.lines ?? []).map((line, index) => h('div', {
        key: `l-${index}`,
        className: `launcher-diff-line${line[0] === '+' ? ' add' : (line[0] === '-' ? ' del' : '')}`,
      },
      h('span', { className: 'launcher-diff-line__ln' }, String(index + 1)),
      h('span', { className: 'launcher-diff-line__sg' }, line[0] || ' '),
      h('span', { className: 'launcher-diff-line__cd' }, String(line[1] ?? '').trim())))
      body.push(h('div', { className: 'launcher-diff', key: `d-${file.file}` }, head, ...lines))
    }
    body.push(h('div', { className: 'launcher-dock-foot', key: 'foot' },
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'stage' }) }, '全部暂存'),
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'revert' }) }, '还原'),
      h('span', { className: 'launcher-dock-foot__grow' }),
      h('button', { type: 'button', className: 'launcher-seg launcher-seg--primary', onClick: () => emit({ type: 'commit' }) }, '提交…')))
  } else if (tab === 'files') {
    const files = Array.isArray(data.files) ? data.files : []
    const sel = Number.isFinite(Number(data.fileSel)) ? Number(data.fileSel) : 0
    body.push(sum('folder', 'dsh-launcher', `${files.filter((file) => file.chg === true).length} 处改动`))
    body.push(h('div', { className: 'launcher-tree', key: 'tree' },
      files.map((file, index) => h('button', {
        key: `f-${index}`,
        type: 'button',
        className: `launcher-tree-row${sel === index ? ' on' : ''}`,
        style: { paddingLeft: `${6 + file.d * 12}px` },
        title: file.n,
        onClick: () => emit({ type: 'fileSel', index }),
      },
      dockIcon(h, file.t === 'dir' ? 'folder' : 'file'),
      h('span', { className: 'launcher-tree-row__n' }, file.n),
      file.chg === true ? h('span', { className: 'launcher-tree-row__d' }, 'M') : null))))
    const selected = files[sel] ?? files[0]
    const preview = ['<!doctype html>', '<html lang="zh-CN">', '  <link rel="stylesheet">', '</html>']
    body.push(h('div', { className: 'launcher-diff', key: 'preview' },
      h('div', { className: 'launcher-diff-h' }, dockIcon(h, 'file'), h('span', { className: 'launcher-diff-h__f' }, selected?.n ?? '—')),
      preview.map((line, index) => h('div', { key: `p-${index}`, className: `launcher-diff-line${index === 2 ? ' add' : ''}` },
        h('span', { className: 'launcher-diff-line__ln' }, String(index + 1)),
        h('span', { className: 'launcher-diff-line__sg' }, index === 2 ? '+' : ' '),
        h('span', { className: 'launcher-diff-line__cd' }, line)))))
  } else if (tab === 'term') {
    const lines = Array.isArray(data.term) ? data.term : []
    body.push(h('pre', { className: 'launcher-term', key: 'out' },
      lines.map((line, index) => h('span', { key: `t-${index}`, className: `launcher-term__${line[0] ?? 'o'}` }, `${line[1] ?? ''}\n`))))
    body.push(h('div', { className: 'launcher-term-in', key: 'in' },
      h('span', { className: 'launcher-term-in__prompt' }, '$'),
      h('input', {
        className: 'launcher-term-in__input',
        'aria-label': '终端输入',
        placeholder: '敲命令，Enter 执行（演示）',
        value: data.termIn ?? '',
        onChange: (event) => emit({ type: 'termIn', value: event?.target?.value }),
      }),
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'termRun' }) }, '执行')))
  } else if (tab === 'tasks') {
    const tasks = Array.isArray(data.tasks) ? data.tasks : []
    body.push(sum('target', '任务', `${tasks.length} 个`))
    for (const task of tasks) {
      body.push(h('div', { className: 'launcher-mini', key: task.id },
        h('div', { className: 'launcher-mini__t' }, task.t),
        h('div', { className: 'launcher-mini__s' },
          h('span', { className: 'launcher-mini__who' }, task.who),
          h('span', { className: `launcher-tag ${task.col === 'done' ? 'ok' : (task.col === 'doing' ? 'acc' : '')}` }, task.col === 'done' ? '完成' : (task.col === 'doing' ? '在做' : '待办'))),
        h('div', { className: 'launcher-mini__s' }, task.sub)))
    }
    body.push(h('div', { className: 'launcher-dock-foot', key: 'foot' },
      h('button', { type: 'button', className: 'launcher-seg', onClick: () => emit({ type: 'newTask' }) }, '新建任务'),
      h('span', { className: 'launcher-dock-foot__grow' }),
      h('span', { className: 'launcher-dock-foot__note' }, `${tasks.filter((task) => task.col === 'doing').length} 个在做`)))
  } else {
    const messages = Array.isArray(data.side) ? data.side : []
    body.push(h('div', { className: 'launcher-chat-mini', key: 'chat' },
      messages.map((message, index) => h('div', { key: `b-${index}`, className: `launcher-bub${message.me === true ? ' me' : ''}` }, message.t))))
    body.push(h('div', { className: 'launcher-term-in', key: 'in' },
      h('input', {
        className: 'launcher-term-in__input',
        'aria-label': '侧聊输入',
        placeholder: '在这个分支里问…（上下文独立）',
        value: data.sideIn ?? '',
        onChange: (event) => emit({ type: 'sideIn', value: event?.target?.value }),
      }),
      h('button', { type: 'button', className: 'launcher-seg launcher-seg--primary', onClick: () => emit({ type: 'sideSend' }) }, '发')))
  }

  return h('div', { className: 'launcher-dock__panel', role: 'tabpanel', 'data-dock-tab': tab }, ...body)
}

// ---------- 渲染：设置 ----------

/**
 * 设置页：六个分组标签 + 当前分组内容。所有控件是有可读标签的原生 button/input/role=switch。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {{ groups?: object[], sections?: object, shortcuts?: object[], active?: string, values?: object, onGroup?: (id: string) => void, onAction?: (action: object) => void, onClose?: () => void }} [options] - 分组、内容、当前取值与回调。
 * @returns {any} dialog vnode。
 */
export function renderSettings(h, options) {
  const opts = options ?? {}
  const groups = Array.isArray(opts.groups) ? opts.groups : []
  const sectionsMap = opts.sections ?? {}
  const values = opts.values ?? {}
  const groupIds = groups.map((group) => group.id)
  const resolved = groupIds.includes(opts.active) ? opts.active : (groupIds[0] ?? 'general')
  const onGroup = typeof opts.onGroup === 'function' ? opts.onGroup : () => {}
  const onAction = typeof opts.onAction === 'function' ? opts.onAction : () => {}
  const onClose = typeof opts.onClose === 'function' ? opts.onClose : () => {}

  function renderControl(row) {
    const control = row.control ?? {}
    if (control.type === 'rollback') {
      // 回退入口：说明 + 三步命令 + 复制按钮。命令/说明/步骤都来自 rollbackSurface（单一真源），
      // 这里只负责把它们排成可读、可复制的块，不另抄一份命令字符串。
      const model = opts.rollback ?? {}
      const steps = Array.isArray(model.steps) ? model.steps : []
      const copied = model.copied === true
      return h('div', { key: control.key ?? 'rollback', className: 'launcher-rollback', 'data-rollback': control.key ?? 'revertNative' },
        h('p', { className: 'launcher-rollback__note', key: 'note' }, String(model.note ?? '')),
        h('ol', { className: 'launcher-rollback__steps', key: 'steps' },
          ...steps.map((step, index) => h('li', { key: `step-${index}` }, String(step)))),
        h('pre', { className: 'launcher-rollback__cmd', key: 'cmd', 'data-rollback-command': '' }, String(model.command ?? '')),
        h('div', { className: 'launcher-rollback__actions', key: 'actions' },
          h('button', {
            type: 'button',
            className: `launcher-seg${copied ? ' on' : ''}`,
            'data-copy-rollback': '',
            'aria-label': copied ? '回退命令已复制' : '复制回退命令',
            onClick: () => onAction({ type: 'copyRollback' }),
          }, copied ? (model.copiedLabel ?? '已复制') : (model.copyLabel ?? '复制命令')),
          h('span', { className: 'launcher-rollback__status', role: 'status', 'aria-live': 'polite' }, copied ? '已复制到剪贴板' : '')),
        h('p', { className: 'launcher-rollback__runbook', key: 'runbook' },
          '完整三态步骤与预期见 runbook：',
          h('code', null, String(model.runbook ?? ''))))
    }
    if (control.type === 'segmented') {
      const options = Array.isArray(control.options) ? control.options : []
      return options.map((option) => h('button', {
        key: option.id,
        type: 'button',
        className: `launcher-seg${values[control.key] === option.id ? ' on' : ''}`,
        'aria-pressed': values[control.key] === option.id,
        'data-control': control.key,
        'data-value': option.id,
        onClick: () => onAction({ type: 'segmented', key: control.key, value: option.id }),
      }, option.label))
    }
    if (control.type === 'toggle') {
      const on = control.key === 'dock' ? values.dockOpen === true : values[control.key] === true
      return h('button', {
        key: control.key,
        type: 'button',
        className: `launcher-seg${on ? ' on' : ''}`,
        'aria-pressed': on,
        'data-control': control.key,
        onClick: () => onAction({ type: 'toggle', key: control.key }),
      }, on ? (control.onLabel ?? '关') : (control.offLabel ?? '开'))
    }
    if (control.type === 'switch') {
      const on = values[control.key] === true
      return h('button', {
        key: control.key,
        type: 'button',
        role: 'switch',
        'aria-checked': on,
        'aria-label': row.label,
        className: `launcher-switch${on ? ' on' : ''}`,
        'data-control': control.key,
        onClick: () => onAction({ type: 'switch', key: control.key }),
      }, h('span', { className: 'launcher-switch__dot' }))
    }
    if (control.type === 'static') {
      // 票 34：静态条目可绑定 values[key]（模型/推理等级读真实状态），没绑定就用固定文案。
      const bound = control.key !== undefined && Object.prototype.hasOwnProperty.call(values, control.key) ? values[control.key] : control.value
      return h('span', { className: 'launcher-static' }, String(bound ?? ''))
    }
    if (control.type === 'kbd') return h('kbd', { className: 'launcher-kbd' }, String(control.value ?? ''))
    if (control.type === 'nav') {
      return h('button', { key: 'nav', type: 'button', className: 'launcher-seg', 'data-target': control.target, onClick: () => onAction({ type: 'nav', target: control.target }) }, control.label ?? '打开')
    }
    if (control.type === 'danger') {
      return h('button', { key: 'danger', type: 'button', className: 'launcher-seg launcher-seg--danger', onClick: () => onAction({ type: 'danger', key: control.key }) }, control.label ?? '回退')
    }
    if (control.type === 'disabled') {
      return h('button', { key: 'disabled', type: 'button', className: 'launcher-seg', disabled: true, 'aria-disabled': 'true', title: control.reason ?? '' }, control.label ?? '检查')
    }
    return null
  }

  function renderRow(row, index) {
    const block = row.control?.type === 'rollback'
    return h('div', { className: `launcher-set-row${block ? ' launcher-set-row--block' : ''}`, key: row.id ?? `row-${index}` },
      h('span', { className: 'launcher-set-row__lbl' },
        h('span', { className: 'launcher-set-row__label' }, row.label),
        row.hint === undefined || row.hint === null ? null : h('span', { className: 'launcher-set-row__hint' }, row.hint)),
      h('span', { className: 'launcher-set-row__ctl' }, renderControl(row)))
  }

  const tabs = groups.map((group) => h('button', {
    key: group.id,
    type: 'button',
    role: 'tab',
    className: `launcher-settings__tab${group.id === resolved ? ' on' : ''}`,
    'aria-selected': group.id === resolved,
    'data-group': group.id,
    onClick: () => onGroup(group.id),
  }, group.label))

  const sectionsForGroup = Array.isArray(sectionsMap[resolved]) ? sectionsMap[resolved] : []
  const body = sectionsForGroup.map((section, sectionIndex) => {
    const rows = Array.isArray(section.rows) ? section.rows : []
    return h('section', { className: 'launcher-settings__card', key: `section-${sectionIndex}` },
      section.title === undefined || section.title === null ? null : h('div', { className: 'launcher-settings__colh' }, section.title),
      ...rows.map((row, index) => renderRow(row, index)))
  })

  return h('div', { className: 'launcher-settings', role: 'dialog', 'aria-modal': 'true', 'aria-label': '设置' },
    h('header', { className: 'launcher-settings__head' },
      h('h2', { className: 'launcher-settings__title' }, '设置'),
      h('button', { type: 'button', className: 'launcher-settings__close', 'aria-label': '关闭设置', title: '关闭', onClick: () => onClose() }, '✕')),
    h('div', { className: 'launcher-settings__tabs', role: 'tablist', 'aria-label': '设置分组' }, ...tabs),
    h('div', { className: 'launcher-settings__body' }, ...body))
}

// ---------- 样式 ----------

/**
 * 右栏五面板 + 设置页的样式（全部挂在 `.launcher-` 外壳作用域，不碰宿主）。
 * @returns {string} CSS 文本。
 */
export function dockSettingsCss() {
  return [
    // 右栏：标签栏 / 面板 / 底栏
    '.launcher-dock-tabs{display:flex;align-items:center;gap:1px;padding:4px 8px 0;border-bottom:1px solid var(--l-line);overflow-x:auto;scrollbar-width:none;flex:0 0 auto}',
    '.launcher-dock-tabs__grow{flex:1}',
    '.launcher-dock-tab{display:inline-flex;align-items:center;gap:4px;padding:8px 7px;font:inherit;font-size:12px;color:var(--l-ink3);background:transparent;border:0;border-bottom:2px solid transparent;white-space:nowrap;cursor:pointer}',
    '.launcher-dock-tab:hover{color:var(--l-ink)}',
    '.launcher-dock-tab.on{color:var(--l-ink);border-bottom-color:var(--l-accent);font-weight:500}',
    '.launcher-dock-tab:focus-visible{outline:2px solid var(--l-accent);outline-offset:-2px}',
    '.launcher-dock-tab svg{width:15px;height:15px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-dock-tab__n{font-size:11px;line-height:1;background:var(--l-surface3);border-radius:4px;padding:2px 3px;color:var(--l-ink3)}',
    '.launcher-dock-tab--icon{margin-left:2px}',
    '.launcher-dock__panel{flex:1;min-height:0;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
    '.launcher-dock__host{display:none}',
    '.launcher-dock-sum{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--l-ink2);padding:2px 2px 4px}',
    '.launcher-dock-sum svg{width:14px;height:14px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-dock-sum__g{font-size:11px;color:var(--l-ink4)}',
    '.launcher-dock-sum__cg{margin-left:auto;display:flex;gap:6px;font-size:11px}',
    '.launcher-git-add{color:var(--l-green)}',
    '.launcher-git-del{color:var(--l-red)}',
    '.launcher-dock-empty{display:grid;gap:4px;place-items:center;padding:18px 8px;border:1px dashed var(--l-line2);border-radius:var(--l-radius-md);color:var(--l-ink3);font-size:12px}',
    '.launcher-dock-foot{border-top:1px solid var(--l-line);padding:8px 2px 2px;display:flex;gap:6px;align-items:center;margin-top:auto}',
    '.launcher-dock-foot__grow{flex:1}',
    '.launcher-dock-foot__note{font-size:11px;color:var(--l-ink4)}',
    '.launcher-diff{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-surface);overflow:hidden}',
    '.launcher-diff-h{display:flex;align-items:center;gap:6px;padding:6px 9px;background:var(--l-surface2);font-size:12px}',
    '.launcher-diff-h svg{width:13px;height:13px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-diff-h__f{font-family:var(--font-mono,monospace);font-size:11px;color:var(--l-ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.launcher-diff-h__a{color:var(--l-green);font-size:11px;margin-left:auto}',
    '.launcher-diff-h__d{color:var(--l-red);font-size:11px}',
    '.launcher-diff-line{display:grid;grid-template-columns:26px 12px minmax(0,1fr);font-family:var(--font-mono,monospace);font-size:11px;line-height:1.7}',
    '.launcher-diff-line__ln{text-align:right;color:var(--l-ink4);padding-right:6px;user-select:none}',
    '.launcher-diff-line__sg{text-align:center;user-select:none}',
    '.launcher-diff-line__cd{overflow:hidden;text-overflow:ellipsis;white-space:pre;padding-right:8px}',
    '.launcher-diff-line.add{background:var(--l-accentSoft);color:var(--l-ink)}',
    '.launcher-diff-line.del{background:var(--l-surface2);color:var(--l-ink3)}',
    '.launcher-tree{display:grid;gap:1px;font-size:12px}',
    '.launcher-tree-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:var(--l-radius-xs);color:var(--l-ink2);width:100%;text-align:left;background:transparent;border:0;cursor:pointer;font:inherit}',
    '.launcher-tree-row:hover{background:var(--l-hover)}',
    '.launcher-tree-row.on{background:var(--l-surface3);color:var(--l-ink)}',
    '.launcher-tree-row:focus-visible{outline:2px solid var(--l-accent);outline-offset:-2px}',
    '.launcher-tree-row svg{width:14px;height:14px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-tree-row__n{font-family:var(--font-mono,monospace);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.launcher-tree-row__d{margin-left:auto;font-size:11px;color:var(--l-ink4)}',
    '.launcher-term{background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-md);padding:9px 10px;font-family:var(--font-mono,monospace);font-size:12px;line-height:1.7;min-height:150px;max-height:340px;overflow:auto;white-space:pre-wrap;color:var(--l-ink2);margin:0}',
    '.launcher-term__p{color:var(--l-accent)}',
    '.launcher-term__ok{color:var(--l-green)}',
    '.launcher-term__er{color:var(--l-red)}',
    '.launcher-term-in{display:flex;gap:6px;margin-top:7px;align-items:center}',
    '.launcher-term-in__prompt{color:var(--l-accent);font-family:var(--font-mono,monospace)}',
    '.launcher-term-in__input{flex:1;min-width:0;background:var(--l-surface);border:1px solid var(--l-line);border-radius:var(--l-radius-sm);padding:0 8px;height:28px;font-family:var(--font-mono,monospace);font-size:12px;outline:none;color:var(--l-ink)}',
    '.launcher-term-in__input:focus{border-color:var(--l-accent)}',
    '.launcher-chat-mini{display:grid;gap:7px}',
    '.launcher-bub{max-width:88%;padding:6px 10px;border-radius:var(--l-radius-md);font-size:12px;line-height:1.5;background:var(--l-surface2);border:1px solid var(--l-line);color:var(--l-ink)}',
    '.launcher-bub.me{justify-self:end;background:var(--l-accent);color:var(--l-onAccent);border-color:transparent}',
    '.launcher-mini{background:var(--l-surface);border:1px solid var(--l-line);border-radius:var(--l-radius-md);padding:9px 10px;display:grid;gap:2px}',
    '.launcher-mini__t{font-size:13px;line-height:1.4}',
    '.launcher-mini__s{font-size:11px;color:var(--l-ink3);display:flex;gap:5px;align-items:center;flex-wrap:wrap}',
    '.launcher-tag{font-size:11px;border-radius:4px;padding:0 4px;background:var(--l-surface3);color:var(--l-ink3)}',
    '.launcher-tag.ok{background:var(--l-accentSoft);color:var(--l-green)}',
    '.launcher-tag.acc{background:var(--l-accentSoft);color:var(--l-accent)}',
    // 通用小按钮
    '.launcher-seg{height:24px;padding:0 8px;border:1px solid var(--l-line);border-radius:var(--l-radius-xs);font:inherit;font-size:12px;color:var(--l-ink2);background:var(--l-surface);cursor:pointer}',
    '.launcher-seg:hover{border-color:var(--l-line2);color:var(--l-ink)}',
    '.launcher-seg:focus-visible{outline:2px solid var(--l-accent);outline-offset:1px}',
    '.launcher-seg.on{background:var(--l-accentSoft);border-color:transparent;color:var(--l-accent);font-weight:500}',
    '.launcher-seg--primary{background:var(--l-accent);border-color:transparent;color:var(--l-onAccent)}',
    '.launcher-seg--danger{color:var(--l-red);border-color:var(--l-red)}',
    '.launcher-seg[disabled]{opacity:.5;cursor:not-allowed}',
    // 设置页
    '.launcher-settings{position:fixed;inset:0;z-index:46;background:var(--l-bg);color:var(--l-ink);display:flex;flex-direction:column;overflow:hidden}',
    '.launcher-settings__head{display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--l-line);background:var(--l-bg2)}',
    '.launcher-settings__title{font-size:15px;font-weight:600;margin:0}',
    '.launcher-settings__close{margin-left:auto;border:0;background:transparent;color:var(--l-ink3);font-size:16px;cursor:pointer;width:28px;height:28px;border-radius:var(--l-radius-xs)}',
    '.launcher-settings__close:hover{background:var(--l-hover);color:var(--l-ink)}',
    '.launcher-settings__close:focus-visible{outline:2px solid var(--l-accent)}',
    '.launcher-settings__tabs{display:flex;gap:2px;padding:0 14px;border-bottom:1px solid var(--l-line);overflow-x:auto;background:var(--l-bg)}',
    '.launcher-settings__tab{padding:8px 10px;font:inherit;font-size:12px;color:var(--l-ink3);background:transparent;border:0;border-bottom:2px solid transparent;white-space:nowrap;cursor:pointer}',
    '.launcher-settings__tab:hover{color:var(--l-ink)}',
    '.launcher-settings__tab.on{color:var(--l-ink);border-bottom-color:var(--l-accent);font-weight:500}',
    '.launcher-settings__tab:focus-visible{outline:2px solid var(--l-accent);outline-offset:-2px}',
    '.launcher-settings__body{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;max-width:720px;width:100%;margin:0 auto}',
    '.launcher-settings__card{border:1px solid var(--l-line);border-radius:var(--l-radius-md);background:var(--l-panel);padding:4px 12px}',
    '.launcher-settings__colh{font-size:11px;letter-spacing:.04em;color:var(--l-ink4);text-transform:uppercase;padding:8px 0 4px}',
    '.launcher-set-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--l-line);font-size:13px}',
    '.launcher-set-row:last-child{border-bottom:0}',
    '.launcher-set-row__lbl{display:grid;gap:1px;min-width:0}',
    '.launcher-set-row__hint{font-size:11px;color:var(--l-ink3)}',
    '.launcher-set-row__ctl{margin-left:auto;display:flex;gap:4px;align-items:center;flex:none}',
    '.launcher-static{font-size:12px;color:var(--l-ink3)}',
    '.launcher-kbd{font-family:var(--font-mono,monospace);font-size:11px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:4px;padding:1px 5px;color:var(--l-ink2)}',
    '.launcher-switch{width:38px;height:22px;border-radius:11px;border:1px solid var(--l-line2);background:var(--l-surface3);position:relative;cursor:pointer;padding:0}',
    '.launcher-switch.on{background:var(--l-accent);border-color:transparent}',
    '.launcher-switch:focus-visible{outline:2px solid var(--l-accent);outline-offset:1px}',
    '.launcher-switch__dot{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--l-surface);transition:left .12s ease}',
    '.launcher-switch.on .launcher-switch__dot{left:18px}',
    // 回退原生 UI 入口（票 35）：整块铺开，命令可选中、可复制
    '.launcher-set-row--block{flex-direction:column;align-items:stretch;gap:4px}',
    '.launcher-set-row--block .launcher-set-row__ctl{margin-left:0;display:block}',
    '.launcher-rollback{display:grid;gap:7px;padding:2px 0 6px}',
    '.launcher-rollback__note{margin:0;font-size:12px;color:var(--l-ink2);line-height:1.5}',
    '.launcher-rollback__steps{margin:0;padding-left:18px;display:grid;gap:2px;font-size:12px;color:var(--l-ink3)}',
    '.launcher-rollback__cmd{margin:0;padding:8px 10px;background:var(--l-surface2);border:1px solid var(--l-line);border-radius:var(--l-radius-sm);font-family:var(--font-mono,monospace);font-size:11px;line-height:1.6;color:var(--l-ink);white-space:pre-wrap;word-break:break-all;user-select:all}',
    '.launcher-rollback__actions{display:flex;align-items:center;gap:8px}',
    '.launcher-rollback__status{font-size:11px;color:var(--l-green)}',
    '.launcher-rollback__runbook{margin:0;font-size:11px;color:var(--l-ink4)}',
    '.launcher-rollback__runbook code{font-family:var(--font-mono,monospace);font-size:11px;background:var(--l-surface2);border-radius:4px;padding:1px 4px}',
    // 密度：紧凑档收紧右栏/设置页的行距与内边距（主题/右栏靠属性与列宽，密度靠这里）
    '.launcher-shell[data-density="compact"]{--l-row:26px}',
    '.launcher-shell[data-density="compact"] .launcher-dock__panel{gap:5px;padding:7px 10px}',
    '.launcher-shell[data-density="compact"] .launcher-set-row{padding:6px 0}',
    '.launcher-shell[data-density="compact"] .launcher-mini{padding:6px 8px}',
  ].join('\n')
}
