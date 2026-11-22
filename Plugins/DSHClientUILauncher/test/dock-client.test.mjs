// source-assert-allow-file: 仅用于 region 标记切块与生成块求值（CODING_STANDARDS §1 允许的三类不变量）
/**
 * 右栏/设置接线（票 33）：确认 client.js 真的用上了 lib/dock-settings.js，
 * 且生成块能在桩作用域独立求值（兜住「内联函数引用了没一起内联的常量」这类 TDZ 回归）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { withDockSettingsBlock } from '../tools/sync-contract.mjs'

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

test('右栏/设置块是 lib/dock-settings.js 的生成物（手改即红）', () => {
  // 不变量：生成区必须与「从 lib 重新生成」逐字节一致——改 lib 不改 client 会在这里红。
  assert.ok(SOURCE.includes('// #region dock-settings-from-lib'), '必须有生成的右栏/设置块')
  assert.equal(withDockSettingsBlock(SOURCE), SOURCE, '跑 node tools/sync-contract.mjs 更新，别手改生成区')
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
