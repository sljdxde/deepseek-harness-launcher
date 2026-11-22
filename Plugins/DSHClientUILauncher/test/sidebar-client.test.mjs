/**
 * 侧栏接线（票 31）：确认 client.js 真的用上了 lib/sidebar.js 的生成块，
 * 且单文件工厂能在桩环境求值（无 TDZ / 未定义引用）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { withSidebarBlock, sidebarBlock } from '../tools/sync-contract.mjs'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

test('client 接线：侧栏三段卡片走 lib/sidebar.js 的生成块', () => {
  assert.match(SOURCE, /#region sidebar-from-lib/, '必须有生成的侧栏块')
  assert.match(SOURCE, /renderSidebar\(h, sidebarState, \{/, '侧栏用 renderSidebar')
  assert.match(SOURCE, /buildSidebarState\(\{/, '侧栏状态由 buildSidebarState 组装')
  assert.match(SOURCE, /\$\{SIDEBAR_CSS\}/, '侧栏样式要注入 ensureStyle')
  assert.match(SOURCE, /props\.useSessions/, '会话行来自宿主 useSessions')
})

test('client 的侧栏块是生成的，手改就会红', () => {
  assert.equal(withSidebarBlock(SOURCE), SOURCE, '跑 node tools/sync-contract.mjs 更新，别手改')
})

test('侧栏块包含几何、图标、CSS 与三段渲染函数', () => {
  const block = sidebarBlock()
  assert.match(block, /\/\/ #region sidebar-from-lib/)
  assert.match(block, /const SIDEBAR_METRICS = \{/)
  assert.match(block, /const SIDEBAR_CSS = "/)
  assert.match(block, /const renderSidebar = function renderSidebar/)
  assert.match(block, /const buildSidebarState = function buildSidebarState/)
  assert.match(block, /const renderNeedCard = function renderNeedCard/)
})

test('生成的侧栏块可独立求值：不依赖未一起内联的模块常量', () => {
  const start = SOURCE.indexOf('  // #region sidebar-from-lib')
  const end = SOURCE.indexOf('  // #endregion sidebar-from-lib')
  assert.ok(start >= 0 && end > start, '找不到侧栏块')
  const block = SOURCE.slice(start, end)
  const factory = new Function(`${block}\nreturn { SIDEBAR_METRICS, SIDEBAR_CSS, buildSidebarState, renderSidebar, rowTitleLeftX }`)
  const api = factory()
  assert.equal(api.SIDEBAR_METRICS.rowHeight, 32)
  assert.match(api.SIDEBAR_CSS, /launcher-sidebar \.side-card/)
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
  const state = api.buildSidebarState({ state: { need: { pending: [], done: [] }, workspaces: [], tasks: [] } })
  assert.equal(api.renderSidebar(h, state, {}).type, 'div')
})

test('client 单文件工厂可在桩环境求值（加入侧栏块后无 TDZ）', () => {
  let id = null
  let mod = null
  function requireStub(name) {
    if (name === 'react') {
      return { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) }
    }
    throw new Error('unexpected require: ' + name)
  }
  const windowStub = { __ModuleLoader__: { load: (options) => { id = options.id; mod = options.factory(requireStub) } } }
  const tagStub = { style: {}, setAttribute() {}, appendChild() {} }
  const documentStub = {
    getElementById: () => null,
    createElement: () => tagStub,
    head: { appendChild() {} },
    querySelector: () => null,
  }
  const run = new Function('window', 'document', 'require', SOURCE)
  assert.doesNotThrow(() => run(windowStub, documentStub, requireStub))
  assert.equal(id, '@deepseek-ai/dsh-client-ui-layout')
  assert.equal(typeof mod?.apply, 'function')
})
