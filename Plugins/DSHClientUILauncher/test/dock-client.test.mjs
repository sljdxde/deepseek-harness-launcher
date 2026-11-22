/**
 * 右栏/设置接线（票 33）：确认 client.js 真的用上了 lib/dock-settings.js，
 * 且生成块能在桩作用域独立求值（兜住「内联函数引用了没一起内联的常量」这类 TDZ 回归）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

/** 截取两个生成区（shell + dock-settings），拼在一起求值。 */
function regionBlock() {
  const s1 = SOURCE.indexOf('  // #region shell-from-lib')
  const e1 = SOURCE.indexOf('  // #endregion shell-from-lib')
  const s2 = SOURCE.indexOf('  // #region dock-settings-from-lib')
  const e2 = SOURCE.indexOf('  // #endregion dock-settings-from-lib')
  assert.ok(s1 >= 0 && e1 > s1, '找不到 shell 生成区')
  assert.ok(s2 >= 0 && e2 > s2, '找不到 dock-settings 生成区')
  return `${SOURCE.slice(s1, e1)}\n${SOURCE.slice(s2, e2)}`
}

test('client 接线：右栏五面板 / 设置页 / 有效宽度都来自 lib/dock-settings.js', () => {
  assert.match(SOURCE, /#region dock-settings-from-lib/, '必须有生成的右栏/设置块')
  assert.match(SOURCE, /renderDockTabs\(h, \{/, '右栏标签栏用 renderDockTabs')
  assert.match(SOURCE, /renderDockPanel\(h, \{ tab: dockTab/, '右栏内容用 renderDockPanel')
  assert.match(SOURCE, /renderSettings\(h, \{/, '设置页用 renderSettings')
  assert.match(SOURCE, /dockWidthFor\(\{ viewportWidth/, '右栏有效宽度用 dockWidthFor')
  assert.match(SOURCE, /dockColumnsFor\(\{ viewportWidth/, '四列几何用 dockColumnsFor')
  assert.match(SOURCE, /DOCK_SETTINGS_CSS/, '样式要铺 DOCK_SETTINGS_CSS')
  assert.match(SOURCE, /setSettingsOpen\(true\)/, 'rail 设置入口要能打开设置页')
})

test('生成块可独立求值：渲染函数只引用已内联的常量（无 ReferenceError）', () => {
  const factory = new Function(
    `${regionBlock()}\nreturn { dockWidthFor, dockColumnsFor, applySetting, renderDockTabs, renderDockPanel, renderSettings, DOCK_TABS, DOCK_DEMO, SET_GROUPS, SET_SECTIONS, DOCK_SETTINGS_CSS }`,
  )
  const api = factory()
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined) })

  // 默认参数里引用了 DOCK_WIDTHS，若没内联这里会 ReferenceError
  const width = api.dockWidthFor({ viewportWidth: 1440, requestedWidth: 384, open: true })
  assert.equal(width, 384)
  const columns = api.dockColumnsFor({ viewportWidth: 1440, dockWidth: width })
  assert.equal(columns.total, 1440)

  const tabs = api.renderDockTabs(h, { tabs: api.DOCK_TABS, active: 'files' })
  assert.equal(tabs.props.className, 'launcher-dock-tabs')
  assert.equal(tabs.children.filter((node) => node.props.role === 'tab').length, 5)

  const panel = api.renderDockPanel(h, { tab: 'tasks', data: api.DOCK_DEMO })
  assert.equal(panel.props['data-dock-tab'], 'tasks')

  const settings = api.renderSettings(h, {
    groups: api.SET_GROUPS,
    sections: api.SET_SECTIONS,
    active: 'general',
    values: { theme: 'dark', density: 'compact', dockOpen: true, team: false },
  })
  assert.equal(settings.children[1].children.length, 6, '六个分组标签')
  assert.match(api.DOCK_SETTINGS_CSS, /launcher-dock-tabs/)
  assert.deepEqual(api.applySetting({ theme: 'light', dockOpen: false }, { type: 'toggle', key: 'dock' }).effect, { type: 'dock', value: true })
})
