/**
 * 右栏 dock 的注册与显隐（05-§6.1 / FR-12 / FR-13）。
 *
 * 五个内置标签 + 插件可注册的标签；宽度与"放不放得下"交给 lib/layout.js（setDockWidth/dockCanShow），
 * 这里只管注册表与打开/关闭的语义，错误一律返回结果对象（渲染层不能因一个标签抛错整页崩）。
 */

import { setDockWidth } from './layout.js'
import { DOCK_TAB_IDS } from './dock-settings.js'

/** 拖动把手的命中宽度（px）。 */
export const DOCK_HANDLE_HIT = 6

/** 内置标签：唯一真源是 lib/dock-settings.js 的 DOCK_TAB_IDS（只 5 个，不再带越界的 browser）。 */
const BUILTIN_TABS = DOCK_TAB_IDS

/**
 * 拖拽把手算新宽度（FR-13）：把手在右栏左缘，往左拖变宽；宽度夹紧交给 layout.setDockWidth。
 * @param {{ startWidth: number, deltaX: number, edge?: 'inner'|'outer' }} input - 起始宽、指针位移、把手在哪条边。
 * @returns {{ ok: boolean, width: number, reason?: 'min'|'max' }} 夹紧后的宽度。
 */
export function dragDockWidth({ startWidth, deltaX, edge = 'inner' } = {}) {
  const direction = edge === 'outer' ? 1 : -1
  const raw = Number(startWidth) + direction * Number(deltaX || 0)
  return setDockWidth(raw)
}

/**
 * 造一个 dock 注册表。
 * @param {{ canShow?: () => boolean }} [deps] - canShow 由外壳按视口宽提供。
 * @returns {object} dock 面：tabs/register/open/close/toggle/active/list。
 */
export function createDock(deps = {}) {
  const canShow = deps.canShow ?? (() => true)
  const tabs = new Map(BUILTIN_TABS.map((id) => [id, { id, label: id, badge: 0 }]))
  let current = null

  return {
    /** 已注册标签（内置在前，插件按注册顺序）。 */
    tabs: () => [...tabs.values()].map((tab) => ({ ...tab })),
    active: () => current,
    /**
     * 注册一个标签；同 id 第二次被拒并保留前者。
     * @param {{ id: string, label: string, badge?: number }} tab - 标签定义。
     * @returns {() => void | { ok: false, reason: 'tab.dup' }} 注销函数，或重复注册的失败结果。
     */
    register(tab) {
      if (tabs.has(tab.id)) return { ok: false, reason: 'tab.dup' }
      tabs.set(tab.id, { ...tab, badge: tab.badge ?? 0 })
      return () => { tabs.delete(tab.id); if (current === tab.id) current = null }
    },
    /**
     * 打开某标签（缺省开当前或第一个）。
     * @param {string} [id] - 标签 id。
     * @returns {{ ok: true, active: string } | { ok: false, reason: 'dock.hidden'|'tab.unknown' }} 结果。
     */
    open(id) {
      if (!canShow()) return { ok: false, reason: 'dock.hidden' }
      const wanted = id ?? current ?? BUILTIN_TABS[0]
      if (!tabs.has(wanted)) return { ok: false, reason: 'tab.unknown' }
      current = wanted
      return { ok: true, active: wanted }
    },
    close() {
      current = null
    },
    /**
     * ⌘J：开着就关，关着就开。
     * @param {string} [id] - 要开/关的标签。
     * @returns {{ ok: true, active: string|null } | { ok: false, reason: 'dock.hidden'|'tab.unknown' }} 结果。
     */
    toggle(id) {
      if (current !== null && (id === undefined || id === current)) {
        current = null
        return { ok: true, active: null }
      }
      return this.open(id)
    },
    /** 待办数 >0 才显示的角标。 */
    setBadge(id, badge) {
      const tab = tabs.get(id)
      if (tab === undefined) return false
      tab.badge = Math.max(0, Math.round(Number(badge) || 0))
      return true
    },
  }
}
