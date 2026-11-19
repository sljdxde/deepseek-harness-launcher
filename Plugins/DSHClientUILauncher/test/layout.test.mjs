/**
 * 几何求解单测：右栏宽度区间、隐藏阈值、2/4/6 降档、宽度预算。
 * 口径来自 05-设计 §4.4 / §6.1 / §6.2 / §10-5。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DOCK, PANE_MIN_WIDTH, setDockWidth, dockCanShow, maxSplit, resolveSplit, mainAreaWidth, widthBudget, collapseComposerBar } from '../lib/layout.js'

test('右栏宽度：区间内原样、越界夹回并报原因', () => {
  assert.deepEqual(setDockWidth(380), { ok: true, width: 380 })
  assert.deepEqual(setDockWidth(319), { ok: false, reason: 'min', width: DOCK.min })
  assert.deepEqual(setDockWidth(521), { ok: false, reason: 'max', width: DOCK.max })
  assert.deepEqual(setDockWidth(Number.NaN), { ok: false, reason: 'min', width: DOCK.min })
  assert.deepEqual(setDockWidth(380.4), { ok: true, width: 380 })
})

test('右栏 <1020 视口自隐，功能开关关掉也自隐', () => {
  assert.equal(dockCanShow({ viewportWidth: 1440 }), true)
  assert.equal(dockCanShow({ viewportWidth: 1019 }), false)
  assert.equal(dockCanShow({ viewportWidth: 1020 }), true)
  assert.equal(dockCanShow({ viewportWidth: 1440, enabled: false }), false)
})

test('主区宽度扣掉图标栏、侧栏与右栏，且不会为负', () => {
  assert.equal(mainAreaWidth({ viewportWidth: 1440, rail: 56, sidebar: 280, dock: 380 }), 724)
  assert.equal(mainAreaWidth({ viewportWidth: 320, rail: 56, sidebar: 280, dock: 380 }), 0)
})

test('分屏：宽度够 3 列就上 6 块，不够就降档而不是裁切', () => {
  assert.equal(maxSplit({ availableWidth: 1200 }), 6)
  assert.equal(maxSplit({ availableWidth: 800 }), 4)
  assert.equal(maxSplit({ availableWidth: 760 }), 4)
  assert.equal(maxSplit({ availableWidth: PANE_MIN_WIDTH * 2 + 12 - 1 }), 1, '差 1px 放不下 2 块就退到 1')
  assert.equal(maxSplit({ availableWidth: 200 }), 1, '连一块都放不下也只给 1（不裁切）')
})

test('分屏：高度不够时 4/6 也降档', () => {
  assert.equal(maxSplit({ availableWidth: 1200, availableHeight: 700 }), 6)
  assert.equal(maxSplit({ availableWidth: 1200, availableHeight: 500 }), 6, '两行各 244px 仍够 240')
  assert.equal(maxSplit({ availableWidth: 1200, availableHeight: 480 }), 2, '两行不足 240，退回一行两块')
  assert.equal(maxSplit({ availableWidth: 1200, availableHeight: 300 }), 2)
})

test('resolveSplit 报 too-narrow 并给实际档位', () => {
  assert.deepEqual(resolveSplit(6, { availableWidth: 800 }), { mode: 4, requested: 6, max: 4, reason: 'too-narrow' })
  assert.deepEqual(resolveSplit(2, { availableWidth: 1600 }), { mode: 2, requested: 2, max: 6, reason: null })
  assert.deepEqual(resolveSplit(3, { availableWidth: 1600 }), { mode: 1, requested: 1, max: 6, reason: null })
})

test('1440 参考视口：宽度预算放得下主区 480', () => {
  assert.deepEqual(widthBudget({ viewportWidth: 1440 }), { main: 724, total: 1440, fits: true })
  assert.equal(widthBudget({ viewportWidth: 1020 }).fits, false)
})

test('composer 工具条：320 下改成图标 + 收进 + 菜单，发送键永远在（FR-31）', () => {
  assert.deepEqual(collapseComposerBar(320), { labels: 'icon', extras: 'menu', sendVisible: true })
  assert.deepEqual(collapseComposerBar(399), { labels: 'icon', extras: 'menu', sendVisible: true })
  assert.deepEqual(collapseComposerBar(420), { labels: 'icon', extras: 'inline', sendVisible: true })
  assert.deepEqual(collapseComposerBar(600), { labels: 'full', extras: 'inline', sendVisible: true })
  assert.deepEqual(collapseComposerBar(Number.NaN), { labels: 'icon', extras: 'menu', sendVisible: true })
})
