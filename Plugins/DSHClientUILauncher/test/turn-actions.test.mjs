/** FR-39/42/43 纯逻辑单测（渲染验证待有会话环境）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { TURN_ACTIONS, TURN_SLOTS, buildTurnExport, exportFileName, exportTurnMarkdown } from '../lib/turn-actions.js'

test('三个动作的槽名/id/order 与 05 §6.5 一致', () => {
  assert.equal(TURN_SLOTS.assistantActions, 'conversation.chat.assistant-actions')
  assert.equal(TURN_SLOTS.turnTail, 'conversation.chat.turnTail')
  assert.deepEqual(TURN_ACTIONS.map((a) => [a.id, a.order, a.slot]), [
    ['launcher.export', 20, TURN_SLOTS.assistantActions],
    ['launcher.viewInContext', 30, TURN_SLOTS.assistantActions],
    ['launcher.usage', 40, TURN_SLOTS.turnTail],
  ])
})

test('导出文件名：序号非法退 1，时间戳缺省 0', () => {
  assert.equal(exportFileName(3, 1700000000000), 'turn-3-1700000000000.md')
  assert.equal(exportFileName(0, 1), 'turn-1-1.md')
  assert.equal(exportFileName('x', undefined), 'turn-1-0.md')
})

test('导出内容非空：缺文本给占位，角色缺省按用户', () => {
  assert.equal(exportTurnMarkdown({ role: 'assistant', text: 'hi' }), '## 助手\n\nhi\n')
  assert.equal(exportTurnMarkdown({}), '## 用户\n\n（这一轮没有可导出的文本）\n')
})

test('只给 messageId、取不到正文时不得产出占位文件（真机空文件就是这个错）', () => {
  assert.equal(buildTurnExport({ messageId: 'm-1' }), null)
  assert.equal(buildTurnExport({}), null)
  assert.equal(buildTurnExport({ messageId: 'm-1', text: '   ' }), null)
})

test('有正文时按轮次与时间戳出文件名', () => {
  const built = buildTurnExport({ text: 'hello', role: 'assistant', turnIndex: 2, stamp: 123 })
  assert.deepEqual(built, { fileName: 'turn-2-123.md', body: '## 助手\n\nhello\n' })
})
