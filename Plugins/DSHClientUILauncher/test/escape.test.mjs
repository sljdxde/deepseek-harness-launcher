/**
 * Esc 优先级链（04-A2 · D1）与计量提示文案（D2）的单测。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ESCAPE_ORDER, nextEscapeTarget, escapeOutcome } from '../lib/escape.js'
import { meterHint } from '../lib/composer.js'

test('Esc 顺序写死：划词 → find → plus/slash → palette → modal → 计量', () => {
  assert.deepEqual([...ESCAPE_ORDER], ['selection', 'find', 'composer', 'palette', 'modal', 'meter'])
})

test('多层同开时只关最上面那层，计量排最后不抢划词', () => {
  assert.equal(nextEscapeTarget(['meter', 'selection']), 'selection')
  assert.equal(nextEscapeTarget(['meter', 'find', 'composer']), 'find')
  assert.equal(nextEscapeTarget(['meter', 'palette']), 'palette')
  assert.equal(nextEscapeTarget(['modal', 'meter']), 'modal')
  assert.equal(nextEscapeTarget(['meter']), 'meter')
})

test('没有任何层打开时 Esc 交还宿主', () => {
  assert.equal(nextEscapeTarget([]), null)
  assert.deepEqual(escapeOutcome(null), { closed: null, focus: null })
})

test('关计量面板焦点还给环；关 find 焦点回输入框（FR-06，原型这里落到发送键是缺陷）', () => {
  assert.deepEqual(escapeOutcome('meter'), { closed: 'meter', focus: 'meter-ring' })
  assert.deepEqual(escapeOutcome('find'), { closed: 'find', focus: 'composer-input' })
  assert.deepEqual(escapeOutcome('selection'), { closed: 'selection', focus: null })
  assert.deepEqual(escapeOutcome('palette'), { closed: 'palette', focus: null })
})

test('计量提示按定稿三句：数字实时、85/95 阈值、只有文案不带强度字段', () => {
  assert.equal(meterHint(59), '上下文占用 59% · 点开看拆分')
  assert.equal(meterHint(84), '上下文占用 84% · 点开看拆分')
  assert.equal(meterHint(85), '上下文占用 85%，该压缩了 · 点开压到 40%')
  assert.equal(meterHint(94), '上下文占用 94%，该压缩了 · 点开压到 40%')
  assert.equal(meterHint(95), '上下文占用 95%，快满了 · 点开压到 40%')
  assert.equal(meterHint(97), '上下文占用 97%，快满了 · 点开压到 40%')
  assert.equal(meterHint(Number.NaN), '上下文占用 0% · 点开看拆分')
  assert.equal(meterHint(140), '上下文占用 100%，快满了 · 点开压到 40%')
})
