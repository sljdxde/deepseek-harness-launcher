/**
 * 56 图标栏的条目模型（W2 / FR-03）。
 *
 * 图标栏是外壳自绘、不走槽；这里只回答"有哪些入口、哪个是当前、角标多少"，
 * 渲染与排布留给 client。入口不许静默消失：审批入口一直在，只是角标变化（FR-31 同一条精神）。
 */

/** 入口表，顺序即图标栏从上到下的顺序（业务入口在前，设置与更多垫底）。 */
export const RAIL_ENTRIES = Object.freeze([
  { id: 'conversation', label: '会话', icon: 'message-circle' },
  { id: 'plugins', label: '插件', icon: 'puzzle' },
  { id: 'schedules', label: '计划任务', icon: 'calendar' },
  { id: 'approvals', label: '待审批', icon: 'shield-check' },
  { id: 'settings', label: '设置', icon: 'settings' },
])

/**
 * 图标栏状态：当前项与两个角标。
 * @param {{ activeKey?: string, pendingApprovals?: number, runningCount?: number }} [input] - 当前 main key 与两组计数。
 * @returns {Array<{ id: string, label: string, icon: string, active: boolean, badge: number }>} 渲染用的条目。
 */
export function railState({ activeKey, pendingApprovals = 0, runningCount = 0 } = {}) {
  const approvals = Math.max(0, Math.round(Number(pendingApprovals) || 0))
  const running = Math.max(0, Math.round(Number(runningCount) || 0))
  return RAIL_ENTRIES.map((entry) => ({
    ...entry,
    active: entry.id === activeKey,
    badge: entry.id === 'approvals' ? approvals : (entry.id === 'schedules' ? running : 0),
  }))
}

/** main key → 图标栏高亮项（`plugin:<id>` 与 `page:<name>` 都归到「插件」）。 */
export function railEntryFor(key) {
  if (typeof key !== 'string' || key.length === 0) return 'conversation'
  if (key.startsWith('plugin:') || key.startsWith('page:')) return 'plugins'
  return RAIL_ENTRIES.some((entry) => entry.id === key) ? key : 'conversation'
}
