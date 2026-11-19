/** FR-38 用量纯计算（真机真实形状）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextAdvice, contextUsageOf } from '../lib/context-usage.js'

test('真实形状：projectedTokens/contextWindow 算百分比，files 不存在就 null', () => {
  const usage = contextUsageOf({
    pressure: { pressureTokens: 20, projectedTokens: 111, contextWindow: 32768 },
    breakdown: { systemTokens: 1485, toolsTokens: 7659, messageTokens: 3815 },
  })
  assert.equal(usage.pct, 0)
  assert.equal(usage.system, 1485)
  assert.equal(usage.tools, 7659)
  assert.equal(usage.chat, 3815)
  assert.equal(usage.files, null, '宿主不给 files 就不硬编')
})

test('退回 pressureTokens / 比例形态；算不出就 null', () => {
  assert.equal(contextUsageOf({ pressure: { pressureTokens: 16384, contextWindow: 32768 } }).pct, 50)
  assert.equal(contextUsageOf({ pressure: { ratio: 0.93 } }).pct, 93)
  assert.equal(contextUsageOf({ pressure: {} }), null)
  assert.equal(contextUsageOf({}), null)
})

test('建议文案三档', () => {
  assert.equal(contextAdvice(50), '占用正常')
  assert.equal(contextAdvice(85), '该压缩了：建议压缩到 40%')
  assert.equal(contextAdvice(96), '快满了：建议压缩到 40%')
})
