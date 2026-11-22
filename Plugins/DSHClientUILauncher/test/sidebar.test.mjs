/**
 * 侧栏三段卡片（票 31）：纯数据变换 + 渲染结构的 Node 单测（S2 缝）。
 *
 * 只测对外可观察的行为：计数合计、工作区/任务分组、三张卡片的头部与箭头位置、
 * 工作区行与会话行标题同一左端、折叠来自 state、键盘可达（可点元素都是 button）、
 * 以及样式作用域。不测内部函数调用次数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  SIDEBAR_METRICS, rowTitleLeftX, needSummary, groupSessions, normalizeSessions,
  buildSidebarState, renderSidebar, sidebarCss, SIDEBAR_ICONS,
} from '../lib/sidebar.js'

/** 最小假 createElement：产出可断言的 vnode 树。 */
function makeH() {
  return (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
}

/** 深度优先找所有满足条件的节点。 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  for (const child of node.children ?? []) findAll(child, predicate, out)
  return out
}

const SESSIONS = [
  { id: 's1', displayTitle: '整理数据', cwd: '/Users/me/proj-a', updatedAt: 5 },
  { id: 's2', displayTitle: '写文档', cwd: '/Users/me/proj-a', updatedAt: 4 },
  { id: 's3', displayTitle: '临时问一句', cwd: '', updatedAt: 3 },
  { id: 'blank', displayTitle: '新会话', cwd: '/Users/me/proj-a', blank: true },
  { id: 'sub', displayTitle: '子代理', cwd: '', origin: 'subagent' },
]

function fullState(overrides = {}) {
  const groups = groupSessions(normalizeSessions(SESSIONS))
  return {
    available: true,
    need: needSummary({ pending: [{ id: 'n1', title: '批准部署' }], done: [{ id: 'n2', title: '跑完回归' }] }),
    workspaces: groups.workspaces,
    tasks: groups.tasks,
    open: { need: true, workspaces: true, tasks: true },
    activeId: 's2',
    ...overrides,
  }
}

test('needSummary：合计 = 待我处理 + 已完成未查看（不读硬编码）', () => {
  const summary = needSummary({ pending: [{}, {}, {}], done: [{}, {}] })
  assert.equal(summary.pending.length, 3)
  assert.equal(summary.done.length, 2)
  assert.equal(summary.total, 5)
  assert.equal(needSummary(undefined).total, 0)
  assert.equal(needSummary({}).total, 0)
})

test('normalizeSessions：吃 { ids, byId } 快照与数组，按输入顺序、丢无 id', () => {
  const snapshot = { ids: ['a', 'b'], byId: { a: { id: 'a', displayTitle: 'A', cwd: '/x' }, b: { id: 'b', title: 'B' } } }
  assert.deepEqual(normalizeSessions(snapshot).map((s) => s.id), ['a', 'b'])
  assert.equal(normalizeSessions(snapshot)[1].title, 'B')
  assert.deepEqual(normalizeSessions([{ id: 'z' }, { title: 'no-id' }, null]).map((s) => s.id), ['z'])
  assert.deepEqual(normalizeSessions(null), [])
})

test('groupSessions：按绑定目录归工作区，未绑定归任务，blank/subagent 不入列表', () => {
  const groups = groupSessions(normalizeSessions(SESSIONS))
  assert.equal(groups.workspaces.length, 1)
  assert.equal(groups.workspaces[0].name, 'proj-a')
  assert.deepEqual(groups.workspaces[0].sessions.map((s) => s.id), ['s1', 's2'])
  assert.deepEqual(groups.tasks.map((s) => s.id), ['s3'])
})

test('buildSidebarState：显式 state 直接可用；宿主快照按数据量决定是否接管', () => {
  const explicit = buildSidebarState({ state: { need: { pending: [], done: [] }, workspaces: [], tasks: [] } })
  assert.equal(explicit.available, true, '显式状态永远接管')
  const emptyEnabled = buildSidebarState({ sessions: [], enabled: true })
  assert.equal(emptyEnabled.available, false, '没有会话也没有待办时不抢宿主空态')
  const withSessions = buildSidebarState({ sessions: SESSIONS, enabled: true })
  assert.equal(withSessions.available, true)
  assert.equal(withSessions.tasks.length, 1)
  assert.equal(buildSidebarState({ sessions: SESSIONS, enabled: false }).available, false, '宿主没会话钩子就不接管')
})

test('几何：行高 32、圆角 12；工作区行与会话行标题用同一左端 x', () => {
  assert.equal(SIDEBAR_METRICS.rowHeight, 32)
  assert.equal(SIDEBAR_METRICS.radius, 12)
  assert.equal(rowTitleLeftX(), SIDEBAR_METRICS.rowPaddingLeft + SIDEBAR_METRICS.leadWidth + SIDEBAR_METRICS.gap)
})

test('三段卡片：三张卡都存在，头部结构与箭头都在最右（同一 card-hd 布局）', () => {
  const h = makeH()
  const tree = renderSidebar(h, fullState(), {})
  const sections = findAll(tree, (n) => n.type === 'section')
  assert.deepEqual(sections.map((s) => s.props['aria-label']), ['需要你', '工作区', '任务'])
  const headers = findAll(tree, (n) => n.props.className === 'card-hd')
  assert.equal(headers.length, 3)
  for (const header of headers) {
    const kids = header.children
    // 箭头是卡片头最后一个子节点（flex + margin-left:auto → 永远最右）
    assert.equal(kids[kids.length - 1].props.className, 'card-chev')
    // 箭头与标题折叠是同一个按钮动作（aria-expanded 同步）
    const chev = kids[kids.length - 1]
    const toggle = kids.find((k) => k.props.className === 'card-toggle')
    assert.equal(chev.props['aria-expanded'], toggle.props['aria-expanded'])
  }
})

test('需要你：两组计数显示，头部数字 = 两组之和', () => {
  const h = makeH()
  const state = fullState({ need: needSummary({ pending: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], done: [{ id: 'c', title: 'C' }] }) })
  const tree = renderSidebar(h, state, {})
  const need = findAll(tree, (n) => n.props['aria-label'] === '需要你')[0]
  const headN = findAll(need, (n) => n.props.className === 'n wait')[0]
  assert.equal(headN.children[0], '3')
  const subs = findAll(need, (n) => n.props.className === 'need-sub')
  assert.deepEqual(subs.map((s) => s.children[0]), ['待我处理', '已完成未查看'])
  assert.equal(findAll(need, (n) => n.props.className === 'ndot wait').length, 2)
  assert.equal(findAll(need, (n) => n.props.className === 'ndot ok').length, 1)
})

test('工作区层级：工作区行 + 其会话子行，二者标题容器结构一致（同一 .lead/.ttl）', () => {
  const h = makeH()
  const tree = renderSidebar(h, fullState(), {})
  const wsCard = findAll(tree, (n) => n.props['aria-label'] === '工作区')[0]
  const wsRow = findAll(wsCard, (n) => n.props.className === 'row ws-row open')[0]
  assert.ok(wsRow, '工作区行存在且展开')
  const wsMain = findAll(wsRow, (n) => n.props.className === 'row-main')[0]
  assert.equal(wsMain.children[0].props.className, 'lead')
  assert.equal(wsMain.children[1].props.className, 'ttl')
  const childRow = findAll(wsCard, (n) => n.props.className === 'row child')[0]
  const childMain = findAll(childRow, (n) => n.props.className === 'row-main')[0]
  assert.equal(childMain.children[0].props.className, 'lead')
  assert.equal(childMain.children[1].props.className, 'ttl')
})

test('任务卡：未绑定目录的会话进任务，激活态标 is-on', () => {
  const h = makeH()
  const tree = renderSidebar(h, fullState(), {})
  const taskCard = findAll(tree, (n) => n.props['aria-label'] === '任务')[0]
  const rowMains = findAll(taskCard, (n) => n.props.className === 'row-main')
  assert.equal(rowMains.length, 1, '一条未绑定目录的会话')
  assert.equal(rowMains[0].props['data-session-id'], 's3')
  const on = findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className.split(' ').includes('is-on'))
  assert.equal(on.length, 1, '仅激活会话一行高亮')
  assert.match(on[0].props.className, /row child is-on/, '激活的 s2 是工作区子行')
})

test('折叠来自 state：收起后卡片仍在，只是不渲染 body；滚动容器始终只有一个', () => {
  const h = makeH()
  const open = renderSidebar(h, fullState(), {})
  const closed = renderSidebar(h, fullState({ open: { need: false, workspaces: false, tasks: false } }), {})
  for (const tree of [open, closed]) {
    assert.equal(findAll(tree, (n) => n.props.className === 'side-scroll').length, 1, '滚动容器稳定存在')
    assert.equal(findAll(tree, (n) => n.type === 'section').length, 3, '三张卡始终存在')
    assert.equal(findAll(tree, (n) => n.props.className === 'card-chev').length, 3)
  }
  for (const chev of findAll(closed, (n) => n.props.className === 'card-chev')) {
    assert.equal(chev.props['aria-expanded'], false, '收起态箭头 aria-expanded=false')
  }
  for (const chev of findAll(open, (n) => n.props.className === 'card-chev')) {
    assert.equal(chev.props['aria-expanded'], true, '展开态箭头 aria-expanded=true')
  }
  assert.equal(findAll(closed, (n) => n.props.className === 'card-body').length, 0, '全收起时没有 body')
  assert.equal(findAll(open, (n) => n.props.className === 'card-body').length, 3)
  // 卡片顺序在开合两态一致 → 折叠不会重排卡片位置
  assert.deepEqual(
    findAll(closed, (n) => n.type === 'section').map((s) => s.props['aria-label']),
    findAll(open, (n) => n.type === 'section').map((s) => s.props['aria-label']),
  )
})

test('键盘可达：所有带 onClick 的元素都是 button type=button（Tab 可达）', () => {
  const h = makeH()
  const tree = renderSidebar(h, fullState(), { onToggle: () => {}, onOpenSession: () => {}, onToggleWorkspace: () => {}, onCollapse: () => {} })
  const clickable = findAll(tree, (n) => typeof n.props.onClick === 'function')
  assert.ok(clickable.length > 0)
  for (const node of clickable) {
    assert.equal(node.type, 'button', `可点元素必须是 button：${node.props.className}`)
    assert.equal(node.props.type, 'button')
  }
})

test('样式作用域：全部选择器以 .launcher-sidebar 开头，含行高/圆角与焦点可见', () => {
  const css = sidebarCss()
  for (const rule of css.split('\n')) {
    const selector = rule.slice(0, rule.indexOf('{'))
    assert.match(selector.trim(), /^\.launcher-sidebar/, `选择器必须作用域在侧栏：${selector}`)
  }
  assert.match(css, /height:32px/)
  assert.match(css, /border-radius:12px/)
  assert.match(css, /\.row\.child\{padding:0 8px 0 9px\}/, '子行与工作区行同 padding')
  assert.match(css, /\.card-chev\{margin-left:auto/)
  assert.match(css, /:focus-visible/)
})

test('图标：chevronRight/chevronDown 有字形，sidebarIcon 由 renderCardHeader 使用', () => {
  assert.match(SIDEBAR_ICONS.chevronRight, /M9 6l6 6/)
  const h = makeH()
  const tree = renderSidebar(h, fullState(), {})
  const svgs = findAll(tree, (n) => n.type === 'svg')
  assert.ok(svgs.length > 0)
  assert.ok(svgs.every((s) => s.props['aria-hidden'] === 'true'))
})
