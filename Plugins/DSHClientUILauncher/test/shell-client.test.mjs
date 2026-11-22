// source-assert-allow-file: 仅用于 region 标记切块与生成块求值（CODING_STANDARDS §1 允许的三类不变量）
/**
 * 壳层接线（票 30）：确认 client.js 真的用上了拆分出的模块，且单文件工厂能在桩环境求值。
 *
 * 这是「渲染拆成模块」的静态侧证据：Node 单测覆盖纯逻辑，这里兜住「改了 lib 却没接进 client」
 * 与「内联块求值即崩（TDZ / 未定义引用）」两类回归。真浏览器视觉仍由 S3 canary 兜底。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { withShellBlock, shellBlock } from '../tools/sync-contract.mjs'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

test('client 接线：日夜令牌、图标栏/状态条渲染、四列几何都来自生成模块', () => {
  // 生成块与源一致 = client 就是 lib 的产物（手改会被这里挡住）
  assert.equal(withShellBlock(SOURCE), SOURCE, '壳层块由 sync 生成，别手改')
  const block = shellBlock()
  for (const name of ['renderRail', 'renderStatusbar', 'shellColumns', 'TOKENS_CSS']) {
    assert.ok(block.includes(name), `壳层生成块应包含 ${name}`)
  }
  // 手写接线（data-theme 挂根、ensureStyle 组装）由 factory 求值 + S3 canary 覆盖，不在此断言源码文本
})

test('client 单文件工厂可在桩环境求值（无 TDZ / 未定义引用）', () => {
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
  assert.deepEqual(mod?.inject, ['slots', 'shortcuts', 'theme'])
})

test('生成的壳层块可独立求值：shellColumns 默认参数不依赖外部常量，renderRail 可渲染', () => {
  const start = SOURCE.indexOf('  // #region shell-from-lib')
  const end = SOURCE.indexOf('  // #endregion shell-from-lib')
  assert.ok(start >= 0 && end > start, '找不到壳层块')
  const block = SOURCE.slice(start, end)
  // 在独立作用域里求值：若内联函数引用了没一起内联的模块级常量，这里会抛 ReferenceError
  const factory = new Function(
    `${block}\nreturn { shellColumns, shellIcon, renderRail, renderStatusbar, TOKENS_CSS, SKELETON_CSS, SHELL_ICONS }`,
  )
  const api = factory()
  // 关键：不传 drawerBreakpoint 也要能算（默认值必须已内联，而不是引用模块常量）
  const columns = api.shellColumns({ viewportWidth: 1440, dockWidth: 380 })
  assert.equal(columns.total, 1440)
  assert.equal(columns.dock, 380)
  assert.match(api.TOKENS_CSS, /--l-ink:/)
  assert.match(api.SKELETON_CSS, /launcher-rail__entry/)
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
  const tree = api.renderRail(h, { entries: [{ id: 'conversation', label: '会话', icon: 'conversation', active: true, badge: 0 }], theme: 'light' })
  assert.equal(tree.type, 'nav')
  assert.equal(api.renderStatusbar(h, { page: 'P', mode: 'M', running: '' }).type, 'footer')
})
