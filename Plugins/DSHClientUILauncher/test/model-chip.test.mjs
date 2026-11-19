/** FR-44 模型 chip 三态。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelChipText, NO_REASONING_LABEL } from '../lib/model-chip.js'

test('有等级：模型名 · 等级', () => {
  assert.deepEqual(modelChipText({ name: 'Mock 1', reasoningLevel: 'high' }), { label: 'Mock 1 · high', state: 'level' })
})

test('确认无等级：显式说明，不静默', () => {
  assert.deepEqual(modelChipText({ name: 'Mock 1', metadataKnown: true }), { label: `Mock 1 · ${NO_REASONING_LABEL}`, state: 'none' })
})

test('读不到元数据：只显示模型名；没有模型名不渲染', () => {
  assert.deepEqual(modelChipText({ name: 'Mock 1' }), { label: 'Mock 1', state: 'unknown' })
  assert.equal(modelChipText({}), null)
  assert.equal(modelChipText(), null)
})
