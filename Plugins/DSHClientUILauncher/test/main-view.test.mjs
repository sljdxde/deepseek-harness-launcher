/**
 * 主区渲染与状态（票 32）：对话流、任务卡、汇报卡、工具行、审批卡、改动卡、
 * 输入行与命令面板，全部是「传 h 的纯渲染 + 纯状态变换」，Node 侧用假 h 断言。
 *
 * 为什么放 lib：浏览器半区是宿主加载器加载的单文件，不能 import；纯函数在这里
 * 既能单测，也能被 tools/sync-contract.mjs 用 toString 内联进 client.js（main-from-lib）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  APPROVAL_CHOICES,
  DEMO_THREAD,
  DEMO_COMMANDS,
  MAIN_ICONS,
  mainCss,
  mainIcon,
  applyApproval,
  resetApproval,
  approvalOf,
  pendingApprovals,
  isApprovalPending,
  composerCanSend,
  composerKeyDown,
  paletteFilter,
  paletteStep,
  paletteCommand,
  toggleExpanded,
  shouldFollowScroll,
  renderFoldSummary,
  renderTools,
  renderPlan,
  renderTaskCard,
  renderReportCard,
  renderChangedCard,
  renderApprovalCard,
  renderApprovalDock,
  renderBotMessage,
  renderThread,
  renderComposer,
  renderCommandPalette,
  renderMainView,
} from '../lib/main-view.js'

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

/** 按 className 找节点。 */
function byClass(tree, className) {
  return findAll(tree, (n) => typeof n.props.className === 'string' && n.props.className.split(/\s+/).includes(className))
}

/** 造一个可记录的键盘事件。 */
function keyEvent(key, shiftKey = false) {
  return { key, shiftKey, prevented: false, preventDefault() { this.prevented = true } }
}

const botTurn = DEMO_THREAD.find((m) => m.k === 'bot' && m.fold && m.tools && m.plan)
const taskTurn = DEMO_THREAD.find((m) => m.k === 'task')
const reportTurn = DEMO_THREAD.find((m) => m.k === 'report')
const approvalTurn = DEMO_THREAD.find((m) => m.k === 'approval')

test('DEMO_THREAD 覆盖一轮完整对话：用户 / 助手（折叠+工具+计划+改动）/ 任务卡 / 审批卡 / 汇报卡', () => {
  const kinds = DEMO_THREAD.map((m) => m.k)
  for (const kind of ['user', 'bot', 'task', 'approval', 'report']) assert.ok(kinds.includes(kind), `缺少 ${kind}`)
  assert.ok(botTurn.fold && botTurn.tools.length > 0 && botTurn.plan.length > 0 && botTurn.chg.length > 0)
  assert.ok(taskTurn.rows.length > 0)
  assert.ok(approvalTurn.cmd && approvalTurn.why)
  assert.ok(reportTurn.title && reportTurn.body)
  assert.ok(DEMO_COMMANDS.length > 0)
  assert.ok(typeof MAIN_ICONS.sparkles === 'string')
})

test('renderThread：用户/助手消息、任务卡、汇报卡、工具行、改动卡都能渲染', () => {
  const h = makeH()
  const tree = renderThread(h, DEMO_THREAD, { approvals: { [approvalTurn.id]: 'allow' }, expanded: { 'tools:1': true } })
  assert.ok(byClass(tree, 'launcher-msg-user').length >= 1)
  assert.ok(byClass(tree, 'launcher-msg-bot').length >= 1)
  assert.ok(byClass(tree, 'launcher-bcard').length >= 2, '任务卡/汇报卡/改动卡')
  assert.ok(byClass(tree, 'launcher-tool-row').length >= 1)
  assert.ok(byClass(tree, 'launcher-appr').length >= 1)
  // 任务卡标题与汇报卡状态
  const text = JSON.stringify(tree)
  assert.ok(text.includes(taskTurn.title), '任务卡标题')
  assert.match(text, /汇报卡/)
  assert.match(text, /READY/)
})

test('renderThread：待批卡不在流里重复（钉在输入框上方），已决策后以 done 卡出现', () => {
  const h = makeH()
  const pending = renderThread(h, DEMO_THREAD, { approvals: {}, expanded: {} })
  assert.equal(findAll(pending, (n) => n.props['data-approval'] === 'pending').length, 0)
  const decided = renderThread(h, DEMO_THREAD, { approvals: { [approvalTurn.id]: 'allow' }, expanded: {} })
  assert.equal(findAll(decided, (n) => n.props['data-approval'] === 'allow').length, 1)
  assert.match(JSON.stringify(decided), /已允许/)
})

test('renderFoldSummary / renderTools：可展开收起，点击回传 id', () => {
  const h = makeH()
  const calls = []
  const closed = renderFoldSummary(h, botTurn.fold, { id: 'f1', open: false, onToggle: (id) => calls.push(id) })
  assert.equal(closed.props['aria-expanded'], false)
  const foldBtn = findAll(closed, (n) => n.type === 'button')[0]
  foldBtn.props.onClick()
  assert.deepEqual(calls, ['f1'])

  const hidden = renderTools(h, botTurn.tools, { id: 't1', open: false, onToggle: () => {} })
  assert.equal(byClass(hidden, 'launcher-tool-row').length, 0)
  const shown = renderTools(h, botTurn.tools, { id: 't1', open: true, onToggle: () => {} })
  assert.equal(byClass(shown, 'launcher-tool-row').length, botTurn.tools.length)
  assert.equal(shown.props['aria-expanded'], true)
})

test('renderPlan：计划步骤状态与计数', () => {
  const h = makeH()
  const tree = renderPlan(h, botTurn.plan)
  assert.equal(byClass(tree, 'launcher-plan-step').length, botTurn.plan.length)
  assert.match(JSON.stringify(tree), new RegExp(`${botTurn.plan.length}`))
})

test('renderTaskCard：勾选项反映 crit 状态并可回传 key', () => {
  const h = makeH()
  const checkedKey = `${taskTurn.title}0`
  const calls = []
  const tree = renderTaskCard(h, taskTurn, { crit: { [checkedKey]: true }, onToggleCrit: (key) => calls.push(key) })
  const boxes = findAll(tree, (n) => n.type === 'input')
  assert.equal(boxes.length, taskTurn.rows.length)
  assert.equal(boxes[0].props.checked, true)
  assert.equal(boxes[1].props.checked, false)
  boxes[0].props.onChange()
  assert.deepEqual(calls, [checkedKey])
})

test('renderReportCard：展开动态开关回传标题', () => {
  const h = makeH()
  const calls = []
  const closed = renderReportCard(h, reportTurn, { open: false, onToggle: (key) => calls.push(key) })
  assert.equal(byClass(closed, 'launcher-dyn').length, 0)
  findAll(closed, (n) => n.type === 'button')[0].props.onClick()
  assert.deepEqual(calls, [reportTurn.title])
  const open = renderReportCard(h, reportTurn, { open: true, onToggle: () => {} })
  assert.equal(byClass(open, 'launcher-dyn').length, 1)
})

test('renderChangedCard：改动文件行与「去审阅」回调', () => {
  const h = makeH()
  let reviewed = 0
  const tree = renderChangedCard(h, botTurn.chg, { onReview: () => { reviewed += 1 } })
  assert.equal(byClass(tree, 'launcher-chg-row').length, botTurn.chg.length)
  findAll(tree, (n) => n.type === 'button')[0].props.onClick()
  assert.equal(reviewed, 1)
})

test('renderApprovalCard：三态按钮、点击回传 choice、决策后显示 done 与撤销', () => {
  const h = makeH()
  const chosen = []
  const pending = renderApprovalCard(h, approvalTurn, { state: 'pending', onChoose: (choice) => chosen.push(choice), onReset: () => {} })
  const buttons = findAll(pending, (n) => n.type === 'button')
  assert.deepEqual(buttons.map((b) => b.props['data-choice']).sort(), ['allow', 'always', 'deny'])
  assert.deepEqual(buttons.map((b) => b.props['data-choice']).sort(), Object.keys(APPROVAL_CHOICES).sort())
  buttons.find((b) => b.props['data-choice'] === 'always').props.onClick()
  assert.deepEqual(chosen, ['always'])
  assert.equal(findAll(pending, (n) => n.props['data-approval'] === 'pending').length, 1)

  const done = renderApprovalCard(h, approvalTurn, { state: 'deny', onChoose: () => {}, onReset: () => {} })
  assert.equal(findAll(done, (n) => n.props['data-approval'] === 'deny').length, 1)
  assert.match(JSON.stringify(done), /已拒绝/)
  const reset = findAll(done, (n) => n.type === 'button')
  assert.equal(reset.length, 1)
  assert.match(JSON.stringify(done), /撤销/)
})

test('审批状态变换：applyApproval 三态、非法值不生效、reset/approvalOf/pending/isPending', () => {
  const s0 = {}
  assert.deepEqual(applyApproval(s0, 'a1', 'allow'), { a1: 'allow' })
  assert.deepEqual(applyApproval(s0, 'a1', 'always'), { a1: 'always' })
  assert.deepEqual(applyApproval(s0, 'a1', 'deny'), { a1: 'deny' })
  assert.deepEqual(applyApproval(s0, 'a1', 'bogus'), {})
  assert.deepEqual(s0, {}, '不修改入参')
  assert.equal(approvalOf({ a1: 'deny' }, 'a1'), 'deny')
  assert.equal(approvalOf({}, 'a1'), 'pending')
  assert.equal(approvalOf(undefined, 'a1'), 'pending')
  assert.deepEqual(resetApproval({ a1: 'allow', a2: 'deny' }, 'a1'), { a2: 'deny' })
  const thread = [{ k: 'approval', id: 'a1' }, { k: 'approval', id: 'a2' }, { k: 'bot' }]
  assert.deepEqual(pendingApprovals({ a1: 'allow' }, thread).map((m) => m.id), ['a2'])
  assert.equal(isApprovalPending({ a1: 'allow' }, thread), true)
  assert.equal(isApprovalPending({ a1: 'allow', a2: 'deny' }, thread), false)
})

test('输入行：空内容禁用发送；Enter 发送、Shift+Enter 换行', () => {
  assert.equal(composerCanSend(''), false)
  assert.equal(composerCanSend('   '), false)
  assert.equal(composerCanSend(undefined), false)
  assert.equal(composerCanSend('你好'), true)
  assert.equal(composerKeyDown({ key: 'Enter', shiftKey: false, canSend: true }), 'send')
  assert.equal(composerKeyDown({ key: 'Enter', shiftKey: true, canSend: true }), 'newline')
  assert.equal(composerKeyDown({ key: 'Enter', shiftKey: false, canSend: false }), 'none')
  assert.equal(composerKeyDown({ key: 'a', shiftKey: false, canSend: true }), 'none')
})

test('renderComposer：空内容发送键 disabled；Enter 触发发送、空 Enter 不发送', () => {
  const h = makeH()
  const empty = renderComposer(h, { value: '', canSend: false, onSend: () => {} })
  const send = findByClass(empty, 'launcher-send')
  assert.equal(send.props.disabled, true)
  assert.equal(send.props['aria-disabled'], true)
  const text = renderComposer(h, { value: 'hi', canSend: true, onSend: () => {} })
  assert.equal(findByClass(text, 'launcher-send').props.disabled, false)

  const sent = []
  const live = renderComposer(h, { value: 'hi', canSend: true, onSend: () => sent.push('send') })
  const ta = findAll(live, (n) => n.type === 'textarea')[0]
  const e1 = keyEvent('Enter')
  ta.props.onKeyDown(e1)
  assert.equal(e1.prevented, true)
  assert.deepEqual(sent, ['send'])
  const e2 = keyEvent('Enter', true)
  ta.props.onKeyDown(e2)
  assert.equal(e2.prevented, false, 'Shift+Enter 交给浏览器换行')
  assert.deepEqual(sent, ['send'])

  const blocked = renderComposer(h, { value: '', canSend: false, onSend: () => sent.push('oops') })
  const emptyTa = findAll(blocked, (n) => n.type === 'textarea')[0]
  const e3 = keyEvent('Enter')
  emptyTa.props.onKeyDown(e3)
  assert.equal(e3.prevented, true)
  assert.deepEqual(sent, ['send'])
})

test('命令面板：过滤 / 选中移动 / 键位语义', () => {
  const all = paletteFilter(DEMO_COMMANDS, '')
  assert.equal(all.length, DEMO_COMMANDS.length)
  const filtered = paletteFilter(DEMO_COMMANDS, '设置')
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].id, 'settings')
  assert.equal(paletteFilter(DEMO_COMMANDS, 'SETTINGS').length, 1, '大小写不敏感')
  assert.equal(paletteFilter(DEMO_COMMANDS, '没有这个').length, 0)
  assert.deepEqual(paletteFilter(null, ''), [])
  assert.deepEqual(paletteFilter(DEMO_COMMANDS, undefined).length, DEMO_COMMANDS.length)

  assert.equal(paletteStep(0, 1, 3), 1)
  assert.equal(paletteStep(2, 1, 3), 0)
  assert.equal(paletteStep(0, -1, 3), 2)
  assert.equal(paletteStep(0, 1, 0), 0)
  assert.equal(paletteStep(undefined, 1, 3), 1)

  assert.equal(paletteCommand({ key: 'Escape', hasSelection: true }), 'close')
  assert.equal(paletteCommand({ key: 'ArrowDown', hasSelection: true }), 'next')
  assert.equal(paletteCommand({ key: 'ArrowUp', hasSelection: true }), 'prev')
  assert.equal(paletteCommand({ key: 'Enter', hasSelection: true }), 'run')
  assert.equal(paletteCommand({ key: 'Enter', hasSelection: false }), 'none')
  assert.equal(paletteCommand({ key: 'a', hasSelection: true }), 'none')
})

test('renderCommandPalette：开时输入框+行+键位脚注；Esc 关、Enter 执行、↑↓ 移动', () => {
  const h = makeH()
  assert.equal(renderCommandPalette(h, { open: false }), null)
  const calls = []
  const tree = renderCommandPalette(h, {
    open: true,
    query: '',
    commands: DEMO_COMMANDS,
    index: 0,
    onQuery: (v) => calls.push(['q', v]),
    onMove: (d) => calls.push(['m', d]),
    onRun: (cmd) => calls.push(['run', cmd.id]),
    onClose: () => calls.push(['close']),
  })
  assert.equal(byClass(tree, 'launcher-palette').length, 1)
  assert.equal(byClass(tree, 'launcher-palette__row').length, DEMO_COMMANDS.length)
  const input = findAll(tree, (n) => n.type === 'input' && n.props.className === 'launcher-palette__input')[0]
  input.props.onChange({ target: { value: '设置' } })
  assert.deepEqual(calls, [['q', '设置']])
  const ev = keyEvent('Escape')
  input.props.onKeyDown(ev)
  assert.equal(ev.prevented, true)
  assert.deepEqual(calls.at(-1), ['close'])
  const enter = keyEvent('Enter')
  input.props.onKeyDown(enter)
  assert.deepEqual(calls.at(-1), ['run', DEMO_COMMANDS[0].id])
})

test('mainIcon：命中名字内联 SVG，未知名字空体不抛', () => {
  const h = makeH()
  const known = mainIcon(h, 'sparkles')
  assert.equal(known.type, 'svg')
  assert.ok(known.props.dangerouslySetInnerHTML.__html.includes(MAIN_ICONS.sparkles.slice(0, 24)))
  const unknown = mainIcon(h, 'nope')
  assert.equal(unknown.props.dangerouslySetInnerHTML.__html, '')
})

test('滚动跟随：贴底跟随、离底不跟随', () => {
  assert.equal(shouldFollowScroll({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }), true)
  assert.equal(shouldFollowScroll({ scrollTop: 100, clientHeight: 100, scrollHeight: 1000 }), false)
  assert.equal(shouldFollowScroll({ scrollTop: 850, clientHeight: 100, scrollHeight: 1000, threshold: 60 }), true)
  assert.equal(shouldFollowScroll({}), true)
})

test('toggleExpanded：开→关、关→开，不改入参', () => {
  const s0 = { a: true }
  assert.deepEqual(toggleExpanded(s0, 'a'), {})
  assert.deepEqual(toggleExpanded(s0, 'b'), { a: true, b: true })
  assert.deepEqual(s0, { a: true })
  assert.deepEqual(toggleExpanded(undefined, 'b'), { b: true })
})

test('主区 CSS：无横向溢出、消息区滚动、发送键禁用态', () => {
  const css = mainCss()
  assert.match(css, /\.launcher-mainview\{[^}]*min-width:0/)
  assert.match(css, /\.launcher-mainview\{[^}]*overflow:hidden/)
  assert.match(css, /\.launcher-thread-wrap\{[^}]*overflow-x:hidden/)
  assert.match(css, /\.launcher-thread-wrap\{[^}]*overflow-y:auto/)
  assert.match(css, /\.launcher-send\[disabled\]\{[^}]*cursor:not-allowed/)
  assert.match(css, /\.launcher-palette\{[^}]*max-width:100%/)
})

test('renderMainView：整屏（流 + 待批停靠条 + 输入行 + 命令面板）且无横向溢出容器', () => {
  const h = makeH()
  const tree = renderMainView(h, {
    thread: DEMO_THREAD,
    approvals: {},
    expanded: {},
    composer: { value: '', canSend: false },
    palette: { open: true, query: '', commands: DEMO_COMMANDS, index: 0 },
    onApproval: () => {},
    onApprovalReset: () => {},
    onToggleFold: () => {},
    onToggleTools: () => {},
    onToggleReport: () => {},
    onToggleCrit: () => {},
    onCompose: () => {},
    onSend: () => {},
    onPaletteQuery: () => {},
    onPaletteMove: () => {},
    onPaletteRun: () => {},
    onPaletteClose: () => {},
    onKeyDown: () => {},
  })
  assert.equal(tree.props.className, 'launcher-mainview')
  assert.equal(byClass(tree, 'launcher-thread-wrap').length, 1)
  assert.equal(byClass(tree, 'launcher-approval-dock').length, 1, '有待批卡时钉在输入框上方')
  assert.equal(byClass(tree, 'launcher-composer').length, 1)
  assert.equal(byClass(tree, 'launcher-palette').length, 1)
  assert.equal(byClass(tree, 'launcher-send')[0].props.disabled, true)
})

/** 单个 className 查找（只取第一个）。 */
function findByClass(tree, className) {
  return byClass(tree, className)[0]
}

test('命令面板：↑↓ 移动、点行执行、禁用行不执行', () => {
  const h = makeH()
  const calls = []
  const tree = renderCommandPalette(h, {
    open: true,
    query: '',
    commands: [...DEMO_COMMANDS, { id: 'off', label: '禁用项', disabled: true }],
    index: 0,
    onMove: (d) => calls.push(['m', d]),
    onRun: (cmd) => calls.push(['run', cmd.id]),
    onClose: () => calls.push(['close']),
  })
  const input = findAll(tree, (n) => n.type === 'input')[0]
  const down = keyEvent('ArrowDown')
  input.props.onKeyDown(down)
  const up = keyEvent('ArrowUp')
  input.props.onKeyDown(up)
  assert.deepEqual(calls, [['m', 1], ['m', -1]])
  assert.equal(down.prevented, true)
  assert.equal(up.prevented, true)
  const rows = findAll(tree, (n) => n.props.role === 'option')
  // 票 37：option 行本身可点（不再在 option 内嵌 button，避免交互元素嵌套）。
  rows[0].props.onClick()
  rows.at(-1).props.onClick()
  assert.equal(rows.at(-1).props['aria-disabled'], true, '禁用行显式标 aria-disabled')
  assert.deepEqual(calls.slice(2), [['run', 'conversation']], '禁用行点击不执行')
})

test('输入行发送键：可发时点击触发 onSend，空内容点击不触发', () => {
  const h = makeH()
  const calls = []
  const live = renderComposer(h, { value: 'hi', canSend: true, onSend: () => calls.push('send') })
  findAll(live, (n) => n.props.className === 'launcher-send')[0].props.onClick()
  const empty = renderComposer(h, { value: '', canSend: false, onSend: () => calls.push('oops') })
  findAll(empty, (n) => n.props.className === 'launcher-send')[0].props.onClick()
  assert.deepEqual(calls, ['send'])
})

test('助手回合动作：点击回传动作名；审批停靠条按钮回传 id 与 choice', () => {
  const h = makeH()
  const actions = []
  const bot = renderBotMessage(h, botTurn, { index: 1, onAction: (name) => actions.push(name) })
  const actionButtons = findAll(bot, (n) => n.props.className === 'launcher-icon-btn')
  assert.equal(actionButtons.length, 4)
  actionButtons[0].props.onClick()
  assert.deepEqual(actions, ['copy'])

  const chosen = []
  const dock = renderApprovalDock(h, approvalTurn, { onChoose: (id, choice) => chosen.push([id, choice]) })
  findAll(dock, (n) => n.type === 'button').find((b) => b.props['data-choice'] === 'deny').props.onClick()
  assert.deepEqual(chosen, [[approvalTurn.id, 'deny']])
})
