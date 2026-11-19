/** 插件工作台容器（FR-28~FR-30 / 容器规范 §1.2 §1.3 §4）的单测。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PLUGIN_PREFIX, backLinkOf, buildPluginMenu, degradationOf, openPluginPage, pluginGlyph, pluginIdOf, pluginKey, togglePinned } from '../lib/plugins.js'

const plugins = [
  { id: 'plugin-manager', label: '插件管理', icon: 'puzzle' },
  { id: 'ledger', label: '台账' },
  { id: 'archive', label: '归档' },
]

test('plugin key 的拼与解', () => {
  assert.equal(pluginKey('ledger'), 'plugin:ledger')
  assert.equal(pluginIdOf('plugin:ledger'), 'ledger')
  assert.equal(pluginIdOf('plugin:'), null)
  assert.equal(pluginIdOf('conversation'), null)
  assert.equal(PLUGIN_PREFIX, 'plugin:')
})

test('两级菜单：固定的进主菜单并保序，其余进更多，失效固定项报出来', () => {
  const menu = buildPluginMenu(plugins, ['archive', 'gone', 'ledger'])
  assert.deepEqual(menu.primary.map((item) => item.id), ['archive', 'ledger'])
  assert.deepEqual(menu.more.map((item) => item.id), ['plugin-manager'])
  assert.deepEqual(menu.dropped, ['gone'])
  assert.equal(menu.primary[0].pinned, true)
})

test('图钉开关：加在末尾、再点取消', () => {
  const once = togglePinned(['a'], 'b')
  assert.deepEqual(once, ['a', 'b'])
  assert.deepEqual(togglePinned(once, 'a'), ['b'])
  assert.deepEqual(togglePinned(undefined, 'x'), ['x'])
})

test('图标：有 icon 用 icon，没有用首字母兜底', () => {
  assert.deepEqual(pluginGlyph({ id: 'x', icon: 'puzzle' }), { kind: 'icon', name: 'puzzle' })
  assert.deepEqual(pluginGlyph({ id: 'ledger', label: '台账' }), { kind: 'letter', text: '台' })
  assert.deepEqual(pluginGlyph({}), { kind: 'letter', text: '?' })
})

test('打开插件页：未知 id 与容器关闭都给结果对象', () => {
  assert.deepEqual(openPluginPage('ledger', plugins), { ok: true, key: 'plugin:ledger' })
  assert.deepEqual(openPluginPage('nope', plugins), { ok: false, reason: 'plugin.unknown' })
  assert.deepEqual(openPluginPage('ledger', plugins, { containerEnabled: false }), { ok: false, reason: 'container.off' })
})

test('页头回链：插件页回「插件」，其它回会话', () => {
  assert.deepEqual(backLinkOf('plugin:ledger'), { label: '插件', key: 'plugins' })
  assert.deepEqual(backLinkOf('conversation'), { label: '会话', key: 'conversation' })
})

test('降级矩阵：分屏只留 canvas、容器关掉给占位、窄容器收 rail', () => {
  assert.deepEqual(degradationOf({ splitMode: 4 }), { rail: 'hide', panel: 'hide', canvas: 'show', placeholder: false })
  assert.deepEqual(degradationOf({ containerEnabled: false }), { rail: 'hide', panel: 'hide', canvas: 'show', placeholder: true })
  assert.deepEqual(degradationOf({ containerWidth: 480 }), { rail: 'hide', panel: 'hide', canvas: 'show', placeholder: false })
  assert.deepEqual(degradationOf({}), { rail: 'show', panel: 'show', canvas: 'show', placeholder: false })
})
