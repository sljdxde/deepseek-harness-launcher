/**
 * 会话流上的三个动作（FR-39/42/43，05 §6.5 真槽）——纯逻辑部分：
 * 槽名、id、order、按钮文案、导出文件名/内容拼装。渲染在 client，注册走 slots.inject。
 */

/** 动作挂载的槽名（技负确认过的真槽）。 */
export const TURN_SLOTS = {
  assistantActions: 'conversation.chat.assistant-actions',
  turnTail: 'conversation.chat.turnTail',
}

/** 三个动作的描述（id / order / 文案），顺序即 order 升序。 */
export const TURN_ACTIONS = [
  { id: 'launcher.export', slot: TURN_SLOTS.assistantActions, order: 20, label: '导出本轮', title: '把这一轮导出为 Markdown' },
  { id: 'launcher.viewInContext', slot: TURN_SLOTS.assistantActions, order: 30, label: '在上下文视图中查看此轮', title: '定位到上下文视图里的这一轮' },
  { id: 'launcher.usage', slot: TURN_SLOTS.turnTail, order: 40, label: '每轮用量', title: '本轮的 token 用量' },
]

/**
 * 导出文件名：`turn-<序号>-<时间戳>.md`，序号从 1 起、非法值退 1。
 * @param {number} turnIndex - 轮次序号。
 * @param {number} stamp - 时间戳（毫秒）。
 * @returns {string} 文件名。
 */
export function exportFileName(turnIndex, stamp) {
  const index = Number.isFinite(turnIndex) && turnIndex > 0 ? Math.trunc(turnIndex) : 1
  const ts = Number.isFinite(stamp) ? Math.trunc(stamp) : 0
  return `turn-${index}-${ts}.md`
}

/**
 * 导出内容：角色标题 + 正文（缺省给占位，不要空文件）。
 * @param {{ role?: string, text?: string }} [turn] - 一轮消息。
 * @returns {string} Markdown 文本。
 */
export function exportTurnMarkdown(turn = {}) {
  const role = turn.role === 'assistant' ? '助手' : '用户'
  const text = typeof turn.text === 'string' && turn.text.length > 0 ? turn.text : '（这一轮没有可导出的文本）'
  return `## ${role}\n\n${text}\n`
}
