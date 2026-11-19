/** PR-B：approval/request 的 allow/deny 接管（ask 必须交回宿主原生卡）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApprovalService } from '../lib/approval/index.mjs'
import { approvalOutcome, TOOL_NAME_TO_CLASS } from '../lib/index.js'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'approval-takeover-'))
  const service = createApprovalService({ stateDir: dir, home: dir })
  return { dir, service }
}

test('工具名映射覆盖宿主常见工具', () => {
  assert.equal(TOOL_NAME_TO_CLASS.bash, 'exec')
  assert.equal(TOOL_NAME_TO_CLASS.read, 'fs.read')
  assert.equal(TOOL_NAME_TO_CLASS.write, 'fs.write')
  assert.equal(TOOL_NAME_TO_CLASS.web_fetch, 'net')
})

test('只读档：写类工具被接管为 rejected 并写审计', async () => {
  const { dir, service } = harness()
  const doc = await service.get()
  await service.set({ runMode: 'readonly' }, doc.version)
  const outcome = await approvalOutcome(service, { toolName: 'write', agent: { session: { id: 's1' } } })
  assert.equal(outcome, 'rejected')
  const audit = await service.audit({ limit: 10 })
  assert.ok(audit.some((row) => row.sessionId === 's1' && row.decision === 'deny'))
  rmSync(dir, { recursive: true, force: true })
})

test('显式 allow：fs.read 在只读档返回 allowed-once', async () => {
  const { dir, service } = harness()
  const outcome = await approvalOutcome(service, { toolName: 'read', agent: { session: { id: 's2' } } })
  assert.equal(outcome, 'allowed-once')
  rmSync(dir, { recursive: true, force: true })
})

test('ask（如 exec 默认）返回 null = 交回宿主原生卡，不接管', async () => {
  const { dir, service } = harness()
  const outcome = await approvalOutcome(service, { toolName: 'bash', agent: { session: { id: 's3' } } })
  assert.equal(outcome, null)
  rmSync(dir, { recursive: true, force: true })
})

test('未知工具名也返回 null（不乱接管）', async () => {
  const { dir, service } = harness()
  assert.equal(await approvalOutcome(service, { toolName: 'unknown-tool' }), null)
  rmSync(dir, { recursive: true, force: true })
})
