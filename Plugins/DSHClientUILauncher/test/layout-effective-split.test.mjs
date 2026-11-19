/** 窄窗误降档回归：800/860 侧栏是抽屉，不该扣 280。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveSplitFor } from '../lib/layout.js'

test('800 宽：侧栏抽屉 → 主区 744，2 块放得下', () => {
  const result = effectiveSplitFor({ requested: 2, viewportWidth: 800, height: 800 })
  assert.equal(result.mainWidth, 744)
  assert.equal(result.mode, 2)
  assert.equal(result.reason, null)
})

test('860 宽：侧栏抽屉 → 主区 804，2 块放得下', () => {
  const result = effectiveSplitFor({ requested: 2, viewportWidth: 860, height: 800 })
  assert.equal(result.mainWidth, 804)
  assert.equal(result.mode, 2)
})

test('900 宽：侧栏 static 占 280 → 主区 564，2 块放不下而降 1', () => {
  const result = effectiveSplitFor({ requested: 2, viewportWidth: 900, height: 800 })
  assert.equal(result.mainWidth, 564)
  assert.equal(result.mode, 1)
  assert.equal(result.reason, 'too-narrow')
})

test('收起侧栏时任何宽度都不扣 280', () => {
  assert.equal(effectiveSplitFor({ requested: 1, viewportWidth: 1200, collapsed: true }).mainWidth, 1144)
})
