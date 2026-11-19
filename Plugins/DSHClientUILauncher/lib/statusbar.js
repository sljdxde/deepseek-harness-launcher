/**
 * 底状态条（W2 / FR-05）：全宽一条，26px，三段——当前页 / 运行模式 / 在跑任务数。
 *
 * 运行模式的文案与 T4 的策略枚举一一对应；状态条只显示，不改策略（那是设置页的事）。
 * 与左栏同一个计数来源（`runningCount`），避免"左栏 3、底栏 2"这种两套真值。
 */

/** 运行模式文案（05-§7.1 的四个档位）。 */
export const MODE_LABELS = Object.freeze({
  readonly: '只读',
  ask: '每次询问',
  'auto-safe': '自动批准安全命令',
  full: '全自动',
})

/**
 * 状态条三段。
 * @param {{ page?: string, mode?: string, running?: number, queued?: number }} [input] - 页面名、运行模式、在跑任务数、排队消息数。
 * @returns {{ page: string, mode: string, running: string }} 三段文本；running 段在没有任务时不占位。
 */
export function statusText({ page, mode, running = 0, queued = 0 } = {}) {
  const runs = Math.max(0, Math.round(Number(running) || 0))
  const waiting = Math.max(0, Math.round(Number(queued) || 0))
  const parts = []
  if (runs > 0) parts.push(`${runs} 个任务在跑`)
  if (waiting > 0) parts.push(`排队 ${waiting}`)
  return {
    page: typeof page === 'string' && page.length > 0 ? page : '会话',
    mode: MODE_LABELS[mode] ?? MODE_LABELS['auto-safe'],
    running: parts.join(' · '),
  }
}
