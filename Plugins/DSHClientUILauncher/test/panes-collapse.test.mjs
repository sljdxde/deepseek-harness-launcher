/** FR-15 单块收起/恢复的纯逻辑。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridForCount, toggleCollapsed, visibleIndices } from '../lib/panes.js'

test('gridForCount：按可见块数重排，不留空洞', () => {
  assert.deepEqual(gridForCount(1), { columns: 1, rows: 1 })
  assert.deepEqual(gridForCount(2), { columns: 2, rows: 1 })
  assert.deepEqual(gridForCount(3), { columns: 2, rows: 2 })
  assert.deepEqual(gridForCount(4), { columns: 2, rows: 2 })
  assert.deepEqual(gridForCount(6), { columns: 3, rows: 2 })
  assert.equal(gridForCount(0).rows, 1)
})

test('toggleCollapsed：可收起也能恢复，且不改入参', () => {
  const base = new Set([1])
  const added = toggleCollapsed(base, 2)
  assert.deepEqual([...added], [1, 2])
  assert.deepEqual([...base], [1], '入参不能被修改')
  assert.deepEqual([...toggleCollapsed(added, 2)], [1])
})

test('visibleIndices：过滤收起块并保持原顺序', () => {
  assert.deepEqual(visibleIndices([0, 1, 2, 3], new Set([1, 2])), [0, 3])
  assert.deepEqual(visibleIndices([0, 1], new Set()), [0, 1])
  assert.deepEqual(visibleIndices([0, 1], new Set([0, 1])), [])
})
