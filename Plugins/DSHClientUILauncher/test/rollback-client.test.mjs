/**
 * 回退面接线（票 35）：确认 client.js 的设置页真的用上 lib/rollback.js 的 rollbackSurface，
 * 复制走剪贴板 + 反馈、Esc 关闭可用；生成的契约块能独立求值（兜住 TDZ / 未内联常量）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

/** 截取 children-from-contract 生成区（含 rollbackCommand / rollbackSurface）。 */
function contractBlock() {
  const start = SOURCE.indexOf('  // #region children-from-contract')
  const end = SOURCE.indexOf('  // #endregion children-from-contract')
  assert.ok(start >= 0 && end > start, '找不到 children-from-contract 生成区')
  return SOURCE.slice(start, end)
}

test('client 接线：设置页回退入口命令来自 rollbackSurface，复制走剪贴板并给反馈', () => {
  assert.match(SOURCE, /rollback: rollbackSurface\(/, '设置页要传 rollback 模型')
  assert.match(SOURCE, /rollbackSurface\(\{ profile: launcherProfile\(\), copied: rollbackCopied \}\)/, '命令/说明取自 rollbackSurface')
  assert.match(SOURCE, /effect\.type === 'copyRollback'/, '复制动作有处理分支')
  assert.match(SOURCE, /navigator\.clipboard\?\.writeText\?\.\(/, '复制要写剪贴板')
  assert.match(SOURCE, /setRollbackCopied\(true\)/, '复制后要有反馈状态')
})

test('client 接线：Esc 关闭设置页（window 监听，焦点不在面板上也能关）', () => {
  assert.match(SOURCE, /settingsOpen[\s\S]{0,600}?key !== 'Escape'[\s\S]{0,200}?setSettingsOpen\(false\)/, 'Esc 关闭设置页')
})

test('生成契约块可独立求值：rollbackSurface 只引用已内联常量（无 ReferenceError）', () => {
  const factory = new Function(
    `${contractBlock()}\nreturn { rollbackSurface, rollbackCommand, ROLLBACK_NOTE, RUNBOOK_PATH, PACKAGE_NAME }`,
  )
  const api = factory()
  const surface = api.rollbackSurface({ copied: true })
  assert.equal(surface.command, api.rollbackCommand(), '命令与 rollbackCommand 同源')
  assert.equal(surface.copyLabel, '已复制')
  assert.equal(surface.runbook, api.RUNBOOK_PATH)
  assert.match(api.ROLLBACK_NOTE, /数据目录/)
  assert.equal(api.PACKAGE_NAME, '@deepseek-ai/dsh-client-ui-layout')
})
