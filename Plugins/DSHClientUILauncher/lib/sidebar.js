import { SIDEBAR_ICONS, iconEl } from './icons.js'
export { SIDEBAR_ICONS } from './icons.js'

/**
 * 侧栏（票 31）：v17「需要你 / 工作区 / 任务」三段统一卡片。
 *
 * 与 shell-render 同一套路：纯数据变换 + 传入 h 的纯渲染函数。
 * 浏览器半区是宿主模块加载器加载的单文件、不能 import，所以这里用 toString 内联；
 * 好处是 Node 侧用假 h 就能断言结构（行高/圆角/层级/计数/键盘可达），不必依赖真浏览器。
 *
 * 约束：被内联的函数只能引用**同一生成块里**也被内联的常量/函数
 * （SIDEBAR_METRICS / SIDEBAR_ICONS / 同块内其它 render*），不要引用 Node 模块。
 */

/** 侧栏几何（v17 冻结值）：行高 32、卡片圆角 12、卡片头 40、行内 lead 16 / gap 6。 */
export const SIDEBAR_METRICS = Object.freeze({
  rowHeight: 32,
  radius: 12,
  cardRadius: 12,
  cardHeaderHeight: 40,
  rowPaddingLeft: 9,
  rowPaddingRight: 8,
  leadWidth: 16,
  gap: 6,
  chevronButton: 28,
  scrollPadding: 8,
})

/** v17 行内标题的左端 x（相对行盒）：工作区行与会话行共用同一算式，故左端对齐。 */
export function rowTitleLeftX() {
  return SIDEBAR_METRICS.rowPaddingLeft + SIDEBAR_METRICS.leadWidth + SIDEBAR_METRICS.gap
}

/** 侧栏用到的 Tabler 线性图标（1.7 描边由 CSS 控制），从 v17 原型搬字形。 */

/**
 * 生成 24×24 线性图标节点（未知名字给空体，不 throw）。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {string} name - SIDEBAR_ICONS 的键。
 * @returns {any} SVG vnode。
 */
export function sidebarIcon(h, name) {
  return iconEl(h, SIDEBAR_ICONS, name)
}

/** 单条会话归一化；缺 id 的丢弃。 */
export function normalizeSession(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const id = String(raw.id ?? '')
  if (id === '') return null
  return {
    id,
    title: String(raw.displayTitle ?? raw.title ?? raw.name ?? id),
    cwd: typeof raw.cwd === 'string' && raw.cwd.length > 0 ? raw.cwd : '',
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    blank: raw.blank === true,
    origin: raw.origin,
  }
}

/**
 * 归一化会话来源：既吃宿主 `useSessions` 的 `{ ids, byId }` 快照，也吃普通数组。
 * @param {any} snapshot - 会话快照或数组。
 * @returns {Array<{ id: string, title: string, cwd: string, updatedAt: number, blank: boolean, origin?: string }>} 会话行（按输入顺序）。
 */
export function normalizeSessions(snapshot) {
  if (Array.isArray(snapshot)) return snapshot.map(normalizeSession).filter((item) => item !== null)
  if (snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.ids) && snapshot.byId !== null && typeof snapshot.byId === 'object') {
    return snapshot.ids.map((id) => normalizeSession(snapshot.byId[id])).filter((item) => item !== null)
  }
  return []
}

/** 目录 → 工作区显示名：取最后一段非空路径；没有就给「未命名目录」。 */
export function workspaceName(cwd) {
  const parts = String(cwd ?? '').split('/').filter((part) => part !== '')
  return parts.length === 0 ? '未命名目录' : parts[parts.length - 1]
}

/**
 * 按绑定目录把会话归到工作区，未绑定目录的归到「任务」。
 * 空会话（blank）与 subagent 派生行不入列表（宿主侧栏也不把它们当常规行）。
 * @param {Array<object>} sessions - normalizeSessions 的结果。
 * @returns {{ workspaces: Array<{ id: string, name: string, cwd: string, sessions: object[] }>, tasks: object[] }}
 */
export function groupSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : []
  const workspaces = []
  const index = new Map()
  const tasks = []
  for (const session of list) {
    if (session === null || session === undefined) continue
    if (session.blank === true || session.origin === 'subagent') continue
    if (session.cwd === '') {
      tasks.push(session)
      continue
    }
    let group = index.get(session.cwd)
    if (group === undefined) {
      group = { id: session.cwd, name: workspaceName(session.cwd), cwd: session.cwd, sessions: [] }
      index.set(session.cwd, group)
      workspaces.push(group)
    }
    group.sessions.push(session)
  }
  return { workspaces, tasks }
}

/**
 * 「需要你」两组合计：头部数字 = 待我处理 + 已完成未查看。
 * @param {{ pending?: object[], done?: object[] }} [need] - 两组行。
 * @returns {{ pending: object[], done: object[], total: number }} 计数永远由本函数现算，不读硬编码。
 */
export function needSummary(need) {
  const pending = need !== null && need !== undefined && Array.isArray(need.pending) ? need.pending : []
  const done = need !== null && need !== undefined && Array.isArray(need.done) ? need.done : []
  return { pending, done, total: pending.length + done.length }
}

/** 折叠态归一化：缺省展开（与 v17 一致）。 */
export function normalizeOpen(open) {
  return {
    need: open === null || open === undefined || open.need !== false,
    workspaces: open === null || open === undefined || open.workspaces !== false,
    tasks: open === null || open === undefined || open.tasks !== false,
  }
}

/**
 * 组装侧栏状态（纯数据）。两种入口：
 * ① 显式传入已归一化的 `state`（测试 / 上层面板直接给）；
 * ② 从宿主 `useSessions` 快照 + need 现算（真实宿主）。
 * `available` 只在真有数据时置真，好让 client 在无会话时回退到宿主侧栏（不抢空态）。
 * @param {{ state?: object, sessions?: any, need?: object, open?: object, activeId?: string|null, enabled?: boolean }} [input]
 * @returns {{ available: boolean, need: {pending: object[], done: object[], total: number}, workspaces: object[], tasks: object[], open: {need: boolean, workspaces: boolean, tasks: boolean}, activeId: string|null }}
 */
export function buildSidebarState({ state, sessions, need, open, activeId, enabled } = {}) {
  if (state !== null && state !== undefined && typeof state === 'object') {
    return {
      available: true,
      need: needSummary(state.need),
      workspaces: Array.isArray(state.workspaces) ? state.workspaces : [],
      tasks: Array.isArray(state.tasks) ? state.tasks : [],
      open: normalizeOpen(state.open ?? open),
      activeId: state.activeId ?? activeId ?? null,
    }
  }
  const list = normalizeSessions(sessions)
  const groups = groupSessions(list)
  const summary = needSummary(need)
  return {
    available: enabled === true && (list.length > 0 || summary.total > 0),
    need: summary,
    workspaces: groups.workspaces,
    tasks: groups.tasks,
    open: normalizeOpen(open),
    activeId: activeId ?? null,
  }
}

/**
 * 统一卡片头：点标题折叠、箭头永远在最右（`margin-left:auto`）。
 * 三张卡片共用这一个函数，所以头部尺寸与箭头右端天然一致。
 * @param {Function} h - createElement。
 * @param {{ key?: string, label: string, dot?: string, count: number|string, open: boolean, onToggle?: Function, acts?: any[] }} options
 * @returns {any} 卡片头 vnode。
 */
export function renderCardHeader(h, options) {
  const opts = options ?? {}
  const key = String(opts.key ?? opts.label ?? '')
  const open = opts.open !== false
  const acts = Array.isArray(opts.acts) ? opts.acts : []
  const children = [
    h('button', {
      key: 'toggle',
      type: 'button',
      className: 'card-toggle',
      'aria-expanded': open,
      'data-side-toggle': key,
      onClick: opts.onToggle,
    },
    h('span', { className: `dot ${opts.dot ?? 'muted'}`, 'aria-hidden': 'true' }),
    h('b', null, String(opts.label ?? '')),
    h('span', { className: `n ${opts.dot ?? 'muted'}` }, String(opts.count ?? 0))),
  ]
  if (acts.length > 0) children.push(h('span', { key: 'acts', className: 'acts' }, ...acts))
  // 箭头必须最后渲染：flex 下 margin-left:auto 把它顶到最右
  children.push(h('button', {
    key: 'chev',
    type: 'button',
    className: 'card-chev',
    'aria-expanded': open,
    'aria-label': open ? '收起' : '展开',
    'data-side-toggle-chev': key,
    onClick: opts.onToggle,
  }, sidebarIcon(h, open ? 'chevronDown' : 'chevronRight')))
  return h('div', { className: 'card-hd' }, ...children)
}

/** 需要你：一行一个待办，lead 用状态点。 */
export function renderNeedRow(h, item, kind, onOpen) {
  const row = item ?? {}
  return h('div', { key: String(row.id ?? row.title ?? ''), className: 'row flat' },
    h('button', {
      type: 'button',
      className: 'row-main',
      title: String(row.title ?? ''),
      'data-side-item': String(row.id ?? ''),
      onClick: onOpen === undefined ? undefined : () => onOpen(row.id),
    },
    h('span', { className: 'lead' }, h('i', { className: `ndot ${kind === 'done' ? 'ok' : 'wait'}`, 'aria-hidden': 'true' })),
    h('span', { className: 'ttl' }, String(row.title ?? '')),
    h('span', { className: 'meta' }, String(row.meta ?? ''))))
}

/** 需要你卡片：两组（待我处理 / 已完成未查看），头部数字 = 两组合计。 */
export function renderNeedCard(h, state, opts) {
  const options = opts ?? {}
  const need = state?.need ?? needSummary(undefined)
  const open = state?.open?.need !== false
  const children = [renderCardHeader(h, {
    key: 'need',
    label: '需要你',
    dot: 'wait',
    count: need.total,
    open,
    onToggle: options.onToggle === undefined ? undefined : () => options.onToggle('need'),
  })]
  if (open) {
    const body = []
    if (need.pending.length > 0) {
      body.push(h('div', { key: 'sub-pending', className: 'need-sub' }, '待我处理', h('span', { className: 'n' }, String(need.pending.length))))
      for (const item of need.pending) body.push(renderNeedRow(h, item, 'wait', options.onOpenNeed))
    }
    if (need.done.length > 0) {
      body.push(h('div', { key: 'sub-done', className: 'need-sub' }, '已完成未查看', h('span', { className: 'n' }, String(need.done.length))))
      for (const item of need.done) body.push(renderNeedRow(h, item, 'done', options.onOpenNeed))
    }
    if (need.total === 0) body.push(h('div', { key: 'empty', className: 'side-empty' }, '暂时没有等你处理的事'))
    children.push(h('div', { key: 'body', className: 'card-body' }, ...body))
  }
  return h('section', { className: 'side-card side-card--need', 'aria-label': '需要你' }, ...children)
}

/** 会话行：工作区子行（child）与任务行共用同一渲染，故标题左端同一 x。 */
export function renderSessionRow(h, session, opts) {
  const options = opts ?? {}
  const row = session ?? {}
  const active = row.id !== undefined && row.id === options.activeId
  return h('div', { key: String(row.id ?? ''), className: `row${options.child === true ? ' child' : ''}${active ? ' is-on' : ''}` },
    h('button', {
      type: 'button',
      className: 'row-main',
      title: String(row.title ?? ''),
      'data-session-id': String(row.id ?? ''),
      onClick: options.onOpenSession === undefined ? undefined : () => options.onOpenSession(row.id),
    },
    h('span', { className: 'lead' }),
    h('span', { className: 'ttl' }, String(row.title ?? ''))),
    h('span', { className: 'meta' }, h('span', { className: 'when' }, String(row.meta ?? ''))))
}

/** 工作区行：folder 图标 + 名称，点它展开/收起下面的会话。 */
export function renderWorkspaceRow(h, workspace, opts) {
  const options = opts ?? {}
  const ws = workspace ?? {}
  const open = options.open !== false
  return h('div', { className: `row ws-row${open ? ' open' : ''}` },
    h('button', {
      type: 'button',
      className: 'row-main',
      'aria-expanded': open,
      title: String(ws.cwd ?? ws.name ?? ''),
      'data-workspace-id': String(ws.id ?? ''),
      onClick: options.onToggleWorkspace === undefined ? undefined : () => options.onToggleWorkspace(ws.id),
    },
    h('span', { className: 'lead' }, sidebarIcon(h, open ? 'folderOpen' : 'folder')),
    h('span', { className: 'ttl' }, String(ws.name ?? ws.cwd ?? ''))))
}

/** 工作区卡片：工作区行 → 会话子行（层级可辨）。 */
export function renderWorkspaceCard(h, state, opts) {
  const options = opts ?? {}
  const workspaces = Array.isArray(state?.workspaces) ? state.workspaces : []
  const open = state?.open?.workspaces !== false
  const collapsedIds = options.collapsedWorkspaces ?? {}
  const children = [renderCardHeader(h, {
    key: 'workspaces',
    label: '工作区',
    dot: 'accent',
    count: workspaces.length,
    open,
    onToggle: options.onToggle === undefined ? undefined : () => options.onToggle('workspaces'),
  })]
  if (open) {
    const body = []
    if (workspaces.length === 0) body.push(h('div', { key: 'empty', className: 'side-empty' }, '还没有绑定目录的工作区'))
    for (const workspace of workspaces) {
      const wsOpen = collapsedIds[workspace.id] !== true
      const rows = [renderWorkspaceRow(h, workspace, {
        open: wsOpen,
        onToggleWorkspace: options.onToggleWorkspace,
      })]
      if (wsOpen) {
        for (const session of workspace.sessions ?? []) {
          rows.push(renderSessionRow(h, session, { child: true, activeId: state?.activeId, onOpenSession: options.onOpenSession }))
        }
      }
      body.push(h('div', { key: String(workspace.id ?? ''), className: 'ws-group' }, ...rows))
    }
    children.push(h('div', { key: 'body', className: 'card-body' }, ...body))
  }
  return h('section', { className: 'side-card side-card--workspaces', 'aria-label': '工作区' }, ...children)
}

/** 任务卡片：未绑定目录的临时会话。 */
export function renderSidebarTaskCard(h, state, opts) {
  const options = opts ?? {}
  const tasks = Array.isArray(state?.tasks) ? state.tasks : []
  const open = state?.open?.tasks !== false
  const children = [renderCardHeader(h, {
    key: 'tasks',
    label: '任务',
    dot: 'muted',
    count: tasks.length,
    open,
    onToggle: options.onToggle === undefined ? undefined : () => options.onToggle('tasks'),
  })]
  if (open) {
    const body = []
    if (tasks.length === 0) body.push(h('div', { key: 'empty', className: 'side-empty' }, '临时会话放这里，不绑目录。'))
    for (const session of tasks) {
      body.push(renderSessionRow(h, session, { activeId: state?.activeId, onOpenSession: options.onOpenSession }))
    }
    children.push(h('div', { key: 'body', className: 'card-body' }, ...body))
  }
  return h('section', { className: 'side-card side-card--tasks', 'aria-label': '任务' }, ...children)
}

/**
 * 侧栏整体：会话头 + 一个稳定的滚动容器 + 三段卡片。
 * 滚动容器在展开/收起前后是同一个节点（只增删卡片 body 的子节点），所以 scrollTop 不会被重置。
 * @param {Function} h - createElement。
 * @param {object} state - buildSidebarState 的返回。
 * @param {{ onToggle?: Function, onOpenSession?: Function, onOpenNeed?: Function, onToggleWorkspace?: Function, collapsedWorkspaces?: object, onCollapse?: Function }} [options]
 * @returns {any} 侧栏 vnode。
 */
export function renderSidebar(h, state, options) {
  const opts = options ?? {}
  const head = [
    h('h2', { key: 'title' }, '会话'),
    opts.onCollapse === undefined
      ? null
      : h('button', {
        key: 'collapse',
        type: 'button',
        className: 'icon-btn side-collapse',
        'aria-label': '收起侧栏',
        'data-side-action': 'collapse',
        onClick: opts.onCollapse,
      }, sidebarIcon(h, 'sidebar')),
  ].filter((node) => node !== null)
  return h('div', { className: 'launcher-sidebar__inner' },
    h('div', { className: 'side-h' }, ...head),
    h('div', { className: 'side-scroll', 'data-side-scroll': 'true' },
      renderNeedCard(h, state, opts),
      renderWorkspaceCard(h, state, opts),
      renderSidebarTaskCard(h, state, opts)))
}

/**
 * 侧栏样式（v17 冻结）：全部作用域在 `.launcher-sidebar` 下，不裸命中宿主元素。
 * 行高 32、圆角 12、卡片头 40、箭头最右、工作区行与会话行同一左端。
 * @returns {string} CSS 文本。
 */
export function sidebarCss() {
  return [
    '.launcher-sidebar__inner{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--l-ink)}',
    '.launcher-sidebar .side-h{display:flex;align-items:center;gap:8px;padding:12px 12px 6px 16px;min-height:44px}',
    '.launcher-sidebar .side-h h2{font-size:14px;font-weight:600;letter-spacing:.2px;margin:0}',
    '.launcher-sidebar .side-h .side-collapse{margin-left:auto;display:grid;place-items:center;width:28px;height:28px;border:0;background:none;border-radius:8px;color:var(--l-ink3);cursor:pointer}',
    '.launcher-sidebar .side-h .side-collapse:hover{background:var(--l-hover);color:var(--l-ink)}',
    '.launcher-sidebar .side-h .side-collapse svg{width:16px;height:16px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-sidebar .side-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:2px 8px 12px;display:flex;flex-direction:column;gap:0}',
    '.launcher-sidebar .side-card{border:1px solid var(--l-line);border-radius:12px;background:var(--l-surface);overflow:hidden;margin:0 0 8px;flex:0 0 auto}',
    '.launcher-sidebar .side-card:last-child{margin-bottom:0}',
    '.launcher-sidebar .card-hd{display:flex;align-items:center;gap:4px;height:40px;padding:0 6px 0 10px}',
    '.launcher-sidebar .card-toggle{display:flex;align-items:center;gap:6px;flex:1;min-width:0;height:28px;padding:0 6px;border:0;border-radius:8px;background:none;font:inherit;text-align:left;color:inherit;cursor:pointer}',
    '.launcher-sidebar .card-toggle:hover{background:var(--l-hover)}',
    '.launcher-sidebar .card-toggle .dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto}',
    '.launcher-sidebar .card-toggle .dot.wait{background:var(--l-amber)}',
    '.launcher-sidebar .card-toggle .dot.accent{background:var(--l-accent)}',
    '.launcher-sidebar .card-toggle .dot.muted{background:var(--l-ink4)}',
    '.launcher-sidebar .card-toggle b{font-size:13px;font-weight:600;color:var(--l-ink);white-space:nowrap}',
    '.launcher-sidebar .card-toggle .n{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 6px;border-radius:6px;background:var(--l-surface2);color:var(--l-ink3)}',
    '.launcher-sidebar .card-toggle .n.wait{background:var(--l-accentSoft);color:var(--l-amber)}',
    '.launcher-sidebar .card-toggle .n.accent{background:var(--l-accentSoft);color:var(--l-accent)}',
    '.launcher-sidebar .card-hd .acts{display:flex;gap:2px;margin-left:2px}',
    '.launcher-sidebar .card-chev{margin-left:auto;width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:none;color:var(--l-ink4);cursor:pointer;flex:0 0 auto}',
    '.launcher-sidebar .card-chev:hover{background:var(--l-hover);color:var(--l-ink2)}',
    '.launcher-sidebar .card-chev svg{width:14px;height:14px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-sidebar .card-body{display:flex;flex-direction:column;gap:2px;padding:0 4px 6px}',
    '.launcher-sidebar .row{position:relative;display:flex;align-items:center;height:32px;padding:0 8px 0 9px;border-radius:12px;width:100%;box-sizing:border-box}',
    '.launcher-sidebar .row:hover{background:var(--l-hover)}',
    '.launcher-sidebar .row.is-on{background:var(--l-accentSoft)}',
    '.launcher-sidebar .row-main{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;height:100%;background:none;border:0;padding:0;font:inherit;color:var(--l-ink);text-align:left;cursor:pointer}',
    '.launcher-sidebar .row .lead{flex:0 0 auto;width:16px;height:20px;display:grid;place-items:center;color:var(--l-ink4)}',
    '.launcher-sidebar .row .lead svg{width:16px;height:16px;stroke-width:var(--l-icon-stroke);fill:none;stroke:currentColor}',
    '.launcher-sidebar .row .ttl{flex:1 1 auto;min-width:0;font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--l-ink)}',
    '.launcher-sidebar .row .meta{flex:0 0 auto;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--l-ink4);display:flex;align-items:center;gap:5px}',
    // 子行与工作区行共用同一 padding-left / lead 宽度 → 标题左端同一 x（层级靠右侧竖线，不靠缩进）
    '.launcher-sidebar .row.child{padding:0 8px 0 9px}',
    '.launcher-sidebar .row.child .ttl{color:var(--l-ink2)}',
    '.launcher-sidebar .ws-group{display:flex;flex-direction:column;gap:2px}',
    '.launcher-sidebar .ws-row .lead{color:var(--l-ink4)}',
    '.launcher-sidebar .need-sub{display:flex;align-items:center;gap:6px;height:28px;padding:0 12px;font-size:11px;font-weight:600;letter-spacing:.2px;color:var(--l-ink3);background:var(--l-surface2);border-top:1px solid var(--l-line)}',
    '.launcher-sidebar .need-sub .n{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--l-ink4)}',
    '.launcher-sidebar .row.flat{border-radius:0}',
    '.launcher-sidebar .ndot{width:6px;height:6px;border-radius:50%;display:inline-block}',
    '.launcher-sidebar .ndot.wait{background:var(--l-amber)}',
    '.launcher-sidebar .ndot.ok{background:var(--l-green)}',
    '.launcher-sidebar .side-empty{padding:8px 10px;font-size:12px;color:var(--l-ink3);line-height:1.5}',
    '.launcher-sidebar :focus-visible{outline:2px solid var(--l-accent);outline-offset:1px;border-radius:8px}',
  ].join('\n')
}
