/** 回退命令生成（票 29 供横幅复用，票 35 设置面板复用）：固定 remove → install → 重启。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { rollbackCommand, rollbackSurface, PACKAGE_NAME, RUNBOOK_PATH } from '../lib/rollback.js'

test('默认 profile：remove → install → 重启，三条按序、包名固定', () => {
  const lines = rollbackCommand().split('\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0], `dsh plugin --profile web remove ${PACKAGE_NAME}`)
  assert.equal(lines[1], 'dsh plugin --profile web install')
  assert.match(lines[2], /重启/)
  assert.equal(PACKAGE_NAME, '@deepseek-ai/dsh-client-ui-layout')
})

test('profile 可替换（staging / 空值回落 web）', () => {
  assert.match(rollbackCommand('staging'), /--profile staging remove/)
  assert.match(rollbackCommand(''), /--profile web remove/)
  assert.match(rollbackCommand(undefined), /--profile web remove/)
})

test('命令里不出现危险的一键执行/force 写法（人可复制，不代跑）', () => {
  const command = rollbackCommand()
  assert.doesNotMatch(command, /--force|rm -rf|sudo/)
})

// ---------- 票 35：设置页回退入口的界面模型（命令仍来自 rollbackCommand 单一真源） ----------

test('rollbackSurface：入口模型字段齐全，命令与 rollbackCommand 逐字一致（不复制字符串）', () => {
  const surface = rollbackSurface()
  assert.equal(surface.command, rollbackCommand(), '命令必须来自 rollbackCommand 单一真源')
  const lines = surface.command.split('\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /remove/)
  assert.match(lines[1], /install/)
  assert.match(lines[2], /重启/)
  assert.equal(surface.steps.length, 3)
  assert.match(surface.steps[0], /移除|remove/)
  assert.match(surface.steps[1], /重装|install/)
  assert.match(surface.steps[2], /重启/)
  assert.match(surface.note, /数据目录/)
  assert.match(surface.note, /不动/)
  assert.match(surface.note, /\.dsh\/state/)
  assert.equal(surface.copyLabel, '复制命令')
  assert.equal(surface.copied, false)
  assert.equal(surface.runbook, RUNBOOK_PATH)
  assert.match(RUNBOOK_PATH, /runbook-回退\.md$/)
})

test('rollbackSurface：copied 切「已复制」、profile 透传、仍不含危险一键执行写法', () => {
  const copied = rollbackSurface({ profile: 'staging', copied: true })
  assert.equal(copied.copyLabel, '已复制')
  assert.equal(copied.copied, true)
  assert.match(copied.command, /--profile staging remove/)
  assert.doesNotMatch(copied.command, /--force|rm -rf|sudo/)
})
