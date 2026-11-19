/** ⌘K 面板纯逻辑（05 §6.5）的单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { EMPTY_SOURCE_HINT, PALETTE_REGIONS, catalogCommands, executeCommand, filterCommands, moveIndex, normalizeCommands } from '../lib/command-palette.js'

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

test('执行：handled 才跑 run；pass 不跑；异常记 failed', () => {
  const calls = []
  const handled = { row: { resolve: () => 'handled', run: () => calls.push('ran') } }
  assert.equal(executeCommand(handled), 'ran')
  assert.deepEqual(calls, ['ran'])
  const pass = { row: { resolve: () => 'pass', run: () => calls.push('nope') } }
  assert.equal(executeCommand(pass), 'pass')
  const throwing = { row: { resolve: () => 'handled', run: () => { throw new Error('boom') } } }
  assert.equal(executeCommand(throwing), 'failed')
  assert.equal(executeCommand(null), 'failed')
})

test('resolve 抛异常的行：置灰而不是把面板打崩', () => {
  const rows = catalogCommands([{ id: 'bad', label: '坏', regions: ['page'], resolve: () => { throw new Error('x') } }])
  assert.equal(rows[0].disabled, true)
})
