/** 回退命令生成（票 29 供横幅复用，票 35 设置面板复用）：固定 remove → install → 重启。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { rollbackCommand, PACKAGE_NAME } from '../lib/rollback.js'

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
