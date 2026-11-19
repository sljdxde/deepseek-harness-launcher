/** 分屏状态机（FR-14/FR-15）与右栏 dock（FR-12/FR-13）的单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CONVERSATION, assignPane, collapsePane, createSplit, focusPane, restorePane, setSplitMode, visiblePanes, zoomPane } from '../lib/panes.js'
import { BUILTIN_TABS, createDock } from '../lib/dock.js'

test('分屏：初始 1 块会话，切档位补空 pane、降档丢尾部', () => {
  const one = createSplit()
  assert.equal(one.mode, 1)
  assert.equal(one.panes[0].key, CONVERSATION)
  const six = setSplitMode(one, 6)
  assert.equal(six.mode, 6)
  assert.equal(six.panes.length, 6)
  assert.equal(six.panes[0].key, CONVERSATION)
  assert.equal(six.panes[5].key, null, '新块等 assign')
  const two = setSplitMode(six, 2)
  assert.equal(two.panes.length, 2)
  assert.equal(one.panes.length, 1, '不改入参')
})

test('分屏：assign / focus / 收起可恢复', () => {
  let state = setSplitMode(createSplit(), 4)
  state = assignPane(state, 1, 'plugin:plugin-manager')
  assert.equal(state.panes[1].key, 'plugin:plugin-manager')
  state = focusPane(state, 1)
  assert.equal(state.active, 1)
  state = collapsePane(state, 1)
  assert.equal(visiblePanes(state).length, 3, '收起后不可见但保留')
  state = restorePane(state, 1)
  assert.equal(visiblePanes(state).length, 4)
})

test('分屏：放大单块折叠其余，再点恢复', () => {
  const state = setSplitMode(createSplit(), 4)
  const zoomed = zoomPane(state, 2)
  assert.equal(visiblePanes(zoomed).length, 1)
  assert.equal(zoomed.panes[2].collapsed, false)
  assert.equal(zoomed.active, 2)
  const restored = zoomPane(zoomed, 2)
  assert.equal(visiblePanes(restored).length, 4, '同一块再点恢复')
})

test('分屏：越界索引不改状态', () => {
  const state = createSplit()
  assert.equal(assignPane(state, 9, 'x'), state)
  assert.equal(focusPane(state, -1), state)
  assert.equal(collapsePane(state, 9), state)
  assert.equal(restorePane(state, 9), state)
  assert.equal(zoomPane(state, 9), state)
})

test('dock：六个内置标签、重复注册被拒并保留前者', () => {
  const dock = createDock()
  assert.deepEqual(dock.tabs().map((tab) => tab.id), [...BUILTIN_TABS])
  const dispose = dock.register({ id: 'review', label: '审阅（插件）' })
  assert.deepEqual(dispose, { ok: false, reason: 'tab.dup' })
  assert.equal(dock.tabs().find((tab) => tab.id === 'review').label, 'review')
})

test('dock：open/toggle 的三种失败与 ⌘J 语义', () => {
  let canShow = true
  const dock = createDock({ canShow: () => canShow })
  assert.deepEqual(dock.open('terminal'), { ok: true, active: 'terminal' })
  dock.close()
  assert.equal(dock.active(), null, 'close 收起右栏')
  assert.deepEqual(dock.open('terminal'), { ok: true, active: 'terminal' })
  assert.deepEqual(dock.toggle(), { ok: true, active: null }, '⌘J 关')
  assert.deepEqual(dock.toggle('files'), { ok: true, active: 'files' }, '⌘J 开')
  assert.deepEqual(dock.open('nope'), { ok: false, reason: 'tab.unknown' })
  canShow = false
  assert.deepEqual(dock.open('files'), { ok: false, reason: 'dock.hidden' })
})

test('dock：插件标签可注销，角标只对已注册标签生效', () => {
  const dock = createDock()
  const dispose = dock.register({ id: 'plugin:ledger', label: '台账' })
  assert.equal(typeof dispose, 'function')
  assert.equal(dock.setBadge('plugin:ledger', 3), true)
  assert.equal(dock.tabs().find((tab) => tab.id === 'plugin:ledger').badge, 3)
  assert.equal(dock.setBadge('nope', 1), false)
  dispose()
  assert.equal(dock.tabs().some((tab) => tab.id === 'plugin:ledger'), false)
  assert.equal(dock.active(), null)
})

test('dock：注销当前打开的标签时右栏同时收起', () => {
  const dock = createDock()
  const dispose = dock.register({ id: 'plugin:x', label: 'X' })
  dock.open('plugin:x')
  assert.equal(dock.active(), 'plugin:x')
  dispose()
  assert.equal(dock.active(), null, '被注销的标签不能继续是活动标签')
})
