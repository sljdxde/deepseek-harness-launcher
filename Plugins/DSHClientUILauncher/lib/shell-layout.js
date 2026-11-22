/**
 * 壳/板布局几何（票 30）：视口 → rail / sidebar / main / dock 四列。
 *
 * 与 lib/layout.js 的分屏几何分开：那支回答「主区里放几块」，这支回答「外壳四列各多宽」。
 * 纯函数，渲染层只按结果排版；1100-2000 无横向溢出这条验收就落在这里。
 */

import { SHELL_METRICS } from './tokens.js'

/** ≤ 这个宽度侧栏塌成抽屉（列宽 0），与 client 的窄窗阈值一致。 */
export const DRAWER_BREAKPOINT = 860

/**
 * 算外壳四列宽度。
 * @param {{ viewportWidth?: number, sidebarCollapsed?: boolean, dockWidth?: number, rail?: number, sidebar?: number, drawerBreakpoint?: number }} [input]
 *   视口、侧栏是否收起、右栏此刻的有效宽度（已含显隐判定）、各固定列宽。
 * @returns {{ rail: number, sidebar: number, main: number, dock: number, total: number, drawer: boolean }}
 *   四列宽、合计（恒等于视口，故不会横向溢出）、是否抽屉模式。
 */
export function shellColumns({
  viewportWidth,
  sidebarCollapsed = false,
  dockWidth = 0,
  rail = SHELL_METRICS.rail,
  sidebar = SHELL_METRICS.sidebar,
  drawerBreakpoint = DRAWER_BREAKPOINT,
} = {}) {
  const width = Number(viewportWidth)
  const viewport = Number.isFinite(width) && width > 0 ? Math.round(width) : 1440
  const drawer = viewport <= Number(drawerBreakpoint)
  const side = drawer || sidebarCollapsed === true ? 0 : Math.round(Number(sidebar) || 0)
  const dockRaw = Number(dockWidth)
  const dock = drawer || !Number.isFinite(dockRaw) ? 0 : Math.max(0, Math.round(dockRaw))
  const railWidth = Math.max(0, Math.round(Number(rail) || 0))
  const main = Math.max(0, viewport - railWidth - side - dock)
  return { rail: railWidth, sidebar: side, main, dock, total: railWidth + side + main + dock, drawer }
}

/**
 * 四列轨道模板（CSS grid-template-columns）。
 * 主区用 minmax(0,1fr) 吸收剩余宽度，避免内容把网格撑出横向滚动。
 * @param {{ rail: number, sidebar: number, dock: number }} columns - 列宽。
 * @returns {string} 形如 `56px 280px minmax(0,1fr) 380px`。
 */
export function gridTemplate(columns) {
  const rail = Math.max(0, Math.round(Number(columns?.rail) || 0))
  const sidebar = Math.max(0, Math.round(Number(columns?.sidebar) || 0))
  const dock = Math.max(0, Math.round(Number(columns?.dock) || 0))
  return `${rail}px ${sidebar}px minmax(0,1fr) ${dock}px`
}
