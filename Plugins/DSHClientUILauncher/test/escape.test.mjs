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

test('关计量面板时焦点还给环，其它层不动焦点', () => {
  assert.deepEqual(escapeOutcome('meter'), { closed: 'meter', focus: 'meter-ring' })
  assert.deepEqual(escapeOutcome('selection'), { closed: 'selection', focus: null })
})

test('计量提示：≥85 才有「该压缩了」，≥95 是更强的告警强度', () => {
  assert.deepEqual(meterHint('normal'), { text: '', urgency: 'none' })
  assert.deepEqual(meterHint('warn'), { text: '该压缩了', urgency: 'warn' })
  assert.deepEqual(meterHint('hot'), { text: '该压缩了', urgency: 'alert' })
})
