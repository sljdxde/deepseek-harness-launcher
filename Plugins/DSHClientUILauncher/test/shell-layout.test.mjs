/**
 * 壳/板布局几何（票 30）：把视口换算成 rail/sidebar/main/dock 四列，并保证
 * 1100-2000 宽无横向溢出（列宽合计 = 视口、主区恒为正）。
 *
 * 只测外部行为：给视口与状态 → 得到列宽对象 / grid 模板串。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shellColumns, gridTemplate, DRAWER_BREAKPOINT } from '../lib/shell-layout.js'
import { SHELL_METRICS } from '../lib/tokens.js'

test('默认 1440 视口：四列合计等于视口，主区为正', () => {
  const c = shellColumns({ viewportWidth: 1440 })
  assert.equal(c.rail, SHELL_METRICS.rail)
  assert.equal(c.sidebar, SHELL_METRICS.sidebar)
  assert.equal(c.dock, 0)
  assert.equal(c.total, 1440)
  assert.equal(c.main, 1440 - SHELL_METRICS.rail - SHELL_METRICS.sidebar)
  assert.ok(c.main > 0)
  assert.equal(c.drawer, false)
})

test('1100-2000 全区间：无横向溢出（合计=视口且主区>0），dock=380 时也成立', () => {
  for (let width = 1100; width <= 2000; width += 50) {
    for (const dockWidth of [0, 320, 380, 520]) {
      const c = shellColumns({ viewportWidth: width, dockWidth })
      assert.equal(c.total, width, `${width}/dock${dockWidth} 列宽合计必须等于视口`)
      assert.ok(c.main > 0, `${width}/dock${dockWidth} 主区必须为正，实际 ${c.main}`)
      assert.ok(c.sidebar === 0 || c.sidebar === SHELL_METRICS.sidebar)
    }
  }
})

test('侧栏收起 → 列宽 0；≤阈值转抽屉 → 侧栏 0 且 dock 0', () => {
  assert.equal(shellColumns({ viewportWidth: 1440, sidebarCollapsed: true }).sidebar, 0)
  const drawer = shellColumns({ viewportWidth: DRAWER_BREAKPOINT, dockWidth: 380 })
  assert.equal(drawer.drawer, true)
  assert.equal(drawer.sidebar, 0)
  assert.equal(drawer.dock, 0)
  assert.equal(drawer.total, DRAWER_BREAKPOINT)
  assert.ok(drawer.main > 0)
})

test('异常输入有确定兜底：非数视口按 1440、负 dock 夹 0', () => {
  const bad = shellColumns({ viewportWidth: Number.NaN })
  assert.equal(bad.total, 1440)
  assert.ok(bad.main > 0)
  const neg = shellColumns({ viewportWidth: 1440, dockWidth: -50 })
  assert.equal(neg.dock, 0)
  assert.equal(shellColumns({}).total, 1440)
})

test('gridTemplate 输出四列轨道，末列用固定 px 防止主区被挤', () => {
  const tpl = gridTemplate({ rail: 56, sidebar: 280, dock: 380 })
  assert.equal(tpl, '56px 280px minmax(0,1fr) 380px')
  assert.match(gridTemplate({ rail: 56, sidebar: 0, dock: 0 }), /^56px 0px minmax\(0,1fr\) 0px$/)
})
