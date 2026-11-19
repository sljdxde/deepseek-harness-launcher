/** FR-14 分屏 key：只认真实 key，凑不满给 null，不自造。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assignPaneKeys } from '../lib/panes.js'

test('按固定顺序取前 N 块', () => {
  const keys = ['schedules', 'dsh-archive-manager', 'conversation', 'dsh-plugin-manager']
  assert.deepEqual(assignPaneKeys(keys, 4), ['conversation', 'dsh-plugin-manager', 'dsh-archive-manager', 'schedules'])
})

test('凑不满返回 null（调用方给「本版未接」占位）', () => {
  assert.deepEqual(assignPaneKeys(['conversation'], 2), ['conversation', null])
})

test('不出现自造 key：conversation#2 这种不在可用集合里就不可能被返回', () => {
  const result = assignPaneKeys(['conversation'], 4)
  assert.deepEqual(result, ['conversation', null, null, null])
  assert.ok(!result.includes('conversation#2'))
})
