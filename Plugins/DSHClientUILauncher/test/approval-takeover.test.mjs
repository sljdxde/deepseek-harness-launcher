/** PR-B：approval/request 接管——只接管 deny（危险命令/无路径写不得被放行）。 */
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

test('危险命令不得被判 allowed-once：exec 默认 ask → 返回 null（交宿主）', async () => {
  const { dir, service } = harness()
  const outcome = await approvalOutcome(service, { toolName: 'bash', agent: { session: { id: 's2' } } })
  assert.equal(outcome, null)
  rmSync(dir, { recursive: true, force: true })
})

test('tools.exec=allow 也不接管（无命令可判，不能放行）', async () => {
  const { dir, service } = harness()
  const doc = await service.get()
  await service.set({ tools: { ...doc.tools, exec: 'allow' } }, doc.version)
  const outcome = await approvalOutcome(service, { toolName: 'bash', agent: { session: { id: 's3' } } })
  assert.equal(outcome, null, 'allow 一律 next()，避免绕过危险命令 ask')
  rmSync(dir, { recursive: true, force: true })
})

test('无 paths 的 fs.write 不得返回 allowed-once', async () => {
  const { dir, service } = harness()
  const doc = await service.get()
  await service.set({ tools: { ...doc.tools, 'fs.write': 'allow' }, runMode: 'full' }, doc.version)
  const outcome = await approvalOutcome(service, { toolName: 'write', agent: { session: { id: 's4' } } })
  assert.equal(outcome, null)
  rmSync(dir, { recursive: true, force: true })
})

test('ask 不留 pending、不写审计（pendingCount 归零）', async () => {
  const { dir, service } = harness()
  const before = (await service.audit({ limit: 100 })).length
  const outcome = await approvalOutcome(service, { toolName: 'bash', agent: { session: { id: 's5' } } })
  assert.equal(outcome, null)
  assert.equal(service.pendingCount(), 0)
  assert.equal((await service.audit({ limit: 100 })).length, before, 'ask 不应该落审计行')
  rmSync(dir, { recursive: true, force: true })
})

test('未知工具名返回 null（不乱接管）', async () => {
  const { dir, service } = harness()
  assert.equal(await approvalOutcome(service, { toolName: 'unknown-tool' }), null)
  rmSync(dir, { recursive: true, force: true })
})
