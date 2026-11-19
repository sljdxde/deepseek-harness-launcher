/** W2 纯逻辑：图标栏条目与底状态条（FR-03 / FR-05）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { RAIL_ENTRIES, railEntryFor, railState } from '../lib/rail.js'
import { MODE_LABELS, statusText } from '../lib/statusbar.js'

test('图标栏：五个入口恒定存在，审批入口不会消失', () => {
  const idle = railState()
  assert.deepEqual(idle.map((entry) => entry.id), RAIL_ENTRIES.map((entry) => entry.id))
  assert.ok(idle.some((entry) => entry.id === 'approvals'), '没有待审批也要有入口')
  assert.equal(idle.find((entry) => entry.id === 'approvals').badge, 0)
})

test('图标栏：当前项与两个角标', () => {
  const state = railState({ activeKey: 'plugins', pendingApprovals: 3, runningCount: 2 })
  assert.equal(state.find((entry) => entry.id === 'plugins').active, true)
  assert.equal(state.find((entry) => entry.id === 'approvals').badge, 3)
  assert.equal(state.find((entry) => entry.id === 'schedules').badge, 2)
  assert.equal(railState({ pendingApprovals: -5 }).find((entry) => entry.id === 'approvals').badge, 0)
})

test('图标栏：key 归到入口（插件页归「插件」，未知归会话）', () => {
  assert.equal(railEntryFor('plugin:plugin-manager'), 'plugins')
  assert.equal(railEntryFor('page:about'), 'plugins')
  assert.equal(railEntryFor('schedules'), 'schedules')
  assert.equal(railEntryFor('whatever'), 'conversation')
  assert.equal(railEntryFor(''), 'conversation')
})

test('状态条：三个档位文案，缺省 auto-safe', () => {
  assert.equal(statusText({ mode: 'readonly' }).mode, '只读')
  assert.equal(statusText({ mode: 'ask' }).mode, '每次询问')
  assert.equal(statusText({ mode: 'full' }).mode, '全自动')
  assert.equal(statusText({}).mode, MODE_LABELS['auto-safe'])
})

test('状态条：运行段没任务不占位，有任务与排队都给数', () => {
  assert.deepEqual(statusText({ page: '插件管理', running: 0 }), { page: '插件管理', mode: '自动批准安全命令', running: '' })
  assert.equal(statusText({ running: 2, queued: 1 }).running, '2 个任务在跑 · 排队 1')
  assert.equal(statusText({ running: 0, queued: 1 }).running, '排队 1')
  assert.equal(statusText({ running: -3 }).running, '')
  assert.equal(statusText({ page: '' }).page, '会话')
})
