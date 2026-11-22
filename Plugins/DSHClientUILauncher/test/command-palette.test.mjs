/** ⌘K 面板纯逻辑（05 §6.5）的单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { EMPTY_SOURCE_HINT, OWN_CATALOG_ROWS, PALETTE_REGIONS, catalogCommands, executeCommand, filterCommands, moveIndex, normalizeCommands, ownCatalogRows } from '../lib/command-palette.js'

test('归一化：容忍 list()/directory.list()/commands 三种形状，坏项与重复 id 丢掉', () => {
  assert.deepEqual(normalizeCommands([{ id: 'a', label: 'A' }]), [{ id: 'a', label: 'A', hint: undefined, command: 'a' }])
  assert.deepEqual(normalizeCommands({ list: () => [{ name: 'plan', title: '计划' }] }), [{ id: 'plan', label: '计划', hint: undefined, command: 'plan' }])
  assert.deepEqual(normalizeCommands({ directory: { list: () => [{ command: 'x', label: 'X' }] } }), [{ id: 'x', label: 'X', hint: undefined, command: 'x' }])
  assert.deepEqual(normalizeCommands({ commands: [{ id: 'b', label: 'B' }, { id: 'b', label: 'B2' }, { nope: 1 }, null] }), [{ id: 'b', label: 'B', hint: undefined, command: 'b' }])
  assert.deepEqual(normalizeCommands(null), [])
  assert.deepEqual(normalizeCommands({ list: () => { throw new Error('boom') } }), [])
  assert.deepEqual(normalizeCommands({ list: () => 'nope' }), [])
})

test('过滤：空查询全给、子串命中 label 或 hint、大小写不敏感', () => {
  const cmds = [
    { id: 'new', label: '新建会话', hint: '与左栏同效' },
    { id: 'search', label: '搜索会话', hint: '按标题过滤' },
  ]
  assert.equal(filterCommands(cmds, '').length, 2)
  assert.deepEqual(filterCommands(cmds, '会话').map((c) => c.id), ['new', 'search'])
  assert.deepEqual(filterCommands(cmds, '标题').map((c) => c.id), ['search'])
  assert.deepEqual(filterCommands(cmds, 'NOPE'), [])
  assert.deepEqual(filterCommands(undefined, 'x'), [])
})

test('↑↓ 移动：回绕、空表恒 0、越界容错', () => {
  assert.equal(moveIndex(0, 3, 1), 1)
  assert.equal(moveIndex(2, 3, 1), 0)
  assert.equal(moveIndex(0, 3, -1), 2)
  assert.equal(moveIndex(5, 0, 1), 0)
  assert.equal(moveIndex(5, -1, 1), 0)
})

test('空表提示文案固定（面板不能假装有命令）', () => {
  assert.equal(EMPTY_SOURCE_HINT, '未接入命令源（宿主命令表待接线）')
})

test('catalog 来源：只取 page/editable 行，modals 专属不进，label 作标题 id 作键', () => {
  const catalog = [
    { id: 'session.new', label: '新建会话', regions: ['page'], resolve: () => 'handled' },
    { id: 'session.search', label: '搜索会话', regions: ['editable', 'page'], resolve: () => 'pass' },
    { id: 'modal.only', label: '弹窗专用', regions: [], modals: ['settings'] },
    { id: 'no.region', label: '没 region' },
    { id: '', label: '坏 id', regions: ['page'] },
  ]
  const rows = catalogCommands(catalog)
  assert.deepEqual(rows.map((r) => r.id), ['session.new', 'session.search'])
  assert.equal(rows[0].disabled, false)
  assert.equal(rows[1].disabled, true, 'pass 置灰但不隐藏')
  assert.deepEqual(PALETTE_REGIONS, ['page', 'editable'])
})

test('catalog 形状容错：{rows} / list() / 非数组', () => {
  assert.equal(catalogCommands({ rows: [{ id: 'a', label: 'A', regions: ['page'] }] }).length, 1)
  assert.equal(catalogCommands({ list: () => [{ id: 'b', label: 'B', regions: ['page'] }] }).length, 1)
  assert.deepEqual(catalogCommands(null), [])
  assert.deepEqual(catalogCommands({ list: () => { throw new Error('x') } }), [])
})

test('执行：resolve 返回 {status:handled,run} 才跑；pass 不跑；异常记 failed', () => {
  const calls = []
  const handled = { command: { resolve: () => ({ status: 'handled', run: () => calls.push('ran') }) } }
  assert.equal(executeCommand(handled), 'ran')
  assert.deepEqual(calls, ['ran'])
  const pass = { command: { resolve: () => ({ status: 'pass' }), run: () => calls.push('nope') } }
  assert.equal(executeCommand(pass), 'pass')
  const throwing = { command: { resolve: () => ({ status: 'handled', run: () => { throw new Error('boom') } }) } }
  assert.equal(executeCommand(throwing), 'failed')
  assert.equal(executeCommand(null), 'failed')
  // resolve 直接返回裸字符串 'handled'、又没有 run：仍算已执行（不抛错）
  assert.equal(executeCommand({ command: { resolve: () => 'handled' } }), 'ran')
})

test('resolve 抛异常的行：置灰而不是把面板打崩', () => {
  const rows = catalogCommands([{ id: 'bad', label: '坏', regions: ['page'], resolve: () => { throw new Error('x') } }])
  assert.equal(rows[0].disabled, true)
})

test('自己注册的行：能进 catalogCommands 且能执行（FR-16）', () => {
  const calls = []
  const rows = ownCatalogRows({}, {
    onOpenWorkbench: () => calls.push('bench'),
  })
  const entries = catalogCommands(rows)
  assert.deepEqual(entries.map((e) => e.id), ['launcher.pluginWorkbench'])
  assert.equal(entries.every((e) => e.disabled === false), true)
  assert.equal(executeCommand(entries[0]), 'ran')
  assert.deepEqual(calls, ['bench'])
})

test('自己注册的行：没有会话/不在页面级时 resolve 返回 pass（置灰）', () => {
  const rows = ownCatalogRows({ hasSession: false, currentPage: 'settings' })
  const entries = catalogCommands(rows)
  assert.equal(entries.every((e) => e.disabled === true), true)
  assert.equal(executeCommand(entries[0]), 'pass')
})

test('resolve 返回对象形态（{status}）：handled 可执行、pass 置灰（宿主 catalog 口径）', () => {
  const rows = catalogCommands([
    { id: 'h', label: 'H', regions: ['page'], resolve: () => ({ status: 'handled' }) },
    { id: 'p', label: 'P', regions: ['page'], resolve: () => ({ status: 'pass' }) },
  ])
  assert.equal(rows[0].disabled, false)
  assert.equal(rows[1].disabled, true)
  const calls = []
  assert.equal(executeCommand({ command: { resolve: () => ({ status: 'handled', run: () => calls.push(1) }) } }), 'ran')
  assert.equal(executeCommand({ command: { resolve: () => ({ status: 'pass' }) } }), 'pass')
  assert.deepEqual(calls, [1])
})

test('registry.commands（Map）：label() 函数、regions 过滤、resolve 对象判定', () => {
  const run = []
  const registry = new Map([
    ['session.new', { id: 'session.new', label: () => '新建会话', regions: ['page'], modals: [], resolve: () => ({ status: 'handled', run: () => run.push('new') }) }],
    ['session.search', { id: 'session.search', label: () => '搜索会话', regions: ['editable'], resolve: () => ({ status: 'pass' }) }],
    ['modal.only', { id: 'modal.only', label: '弹窗', regions: [], modals: ['settings'] }],
  ])
  const entries = catalogCommands({ commands: registry })
  assert.deepEqual(entries.map((e) => e.id), ['session.new', 'session.search'])
  assert.deepEqual(entries.map((e) => e.label), ['新建会话', '搜索会话'])
  assert.equal(entries[0].disabled, false)
  assert.equal(entries[1].disabled, true)
  assert.equal(executeCommand(entries[0]), 'ran')
  assert.deepEqual(run, ['new'])
  assert.equal(executeCommand(entries[1]), 'pass')
})

test('自有行：actions 缺省时 run 不抛（可选回调）', () => {
  const rows = ownCatalogRows({}, {})
  const entries = catalogCommands(rows)
  assert.equal(entries.every((e) => e.disabled === false), true)
  assert.equal(executeCommand(entries[0]), 'ran')
})

test('执行：字符串 handled 且 entry 自带 run 时也执行（兼容旧形态）', () => {
  const calls = []
  const entry = { command: { resolve: () => 'handled' }, run: () => calls.push('x') }
  assert.equal(executeCommand(entry), 'ran')
  assert.deepEqual(calls, ['x'])
})

test('自有行：注册时 key 还不在、调用时才有 → handled（惰性判定）', () => {
  let ready = false
  const rows = ownCatalogRows({}, { resolveMainKey: () => (ready ? 'dsh-plugin-manager' : null), onOpenWorkbench: () => {} })
  assert.equal(catalogCommands(rows)[0].disabled, true, '注册时无 key → 先置灰')
  ready = true
  const after = catalogCommands(rows)
  assert.equal(after[0].disabled, false, '调用时有 key → 可执行')
  assert.equal(executeCommand(after[0]), 'ran')
})

test('自有行：页面级判定取实时状态（不是注册时快照）', () => {
  let page = 'settings'
  const rows = ownCatalogRows({ currentPage: () => page }, { onOpenWorkbench: () => {} })
  assert.equal(catalogCommands(rows)[0].disabled, true)
  page = 'conversation'
  assert.equal(catalogCommands(rows)[0].disabled, false)
})
