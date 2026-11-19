/**
 * 服务面用例：evaluate + 审计落库、decide 幂等、超时 fail-closed，
 * 以及三条安全用例（TC-19-2 / 22-1 / 23-2）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createApprovalService } from '../lib/approval/index.mjs'

/**
 * 造一个临时环境。
 * @returns {Promise<{service: object, home: string, cwd: string}>} 环境。
 */
async function sandbox() {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'approval-service-'))
  const stateDir = path.join(home, '.dsh', 'state')
  const service = createApprovalService({ stateDir, home })
  return { service, home, cwd: path.join(home, 'Pod') }
}

test('Remote 面：get / set / audit / decide 四个方法都在，set 冲突返回 conflict', async () => {
  const { service } = await sandbox()
  const doc = await service.get()
  assert.equal(doc.version, 1)
  const updated = await service.set({ runMode: 'full' }, 1)
  assert.equal(updated.ok, true)
  const stale = await service.set({ runMode: 'readonly' }, 1)
  assert.equal(stale.reason, 'conflict')
  assert.deepEqual(await service.audit(), [])
  assert.deepEqual(await service.decide({ requestId: 'nope', choice: 'deny' }), { ok: false })
})

test('evaluate 写审计：allow 也要有一条，decidedBy 记录命中步', async () => {
  const { service, cwd } = await sandbox()
  const result = await service.evaluate({ tool: 'fs.read', command: 'cat a.md', cwd })
  assert.equal(result.decision.decision, 'allow')
  assert.equal(result.decision.decidedBy, 'tool-policy')
  const records = await service.audit()
  assert.equal(records.length, 1)
  assert.equal(records[0].decision, 'allow')
  assert.equal(records[0].policyVersion, 1)
  assert.equal(records[0].runModeAtDecision, 'auto-safe')
  assert.equal(result.audit.ok, true)
})

test('decide：用户作答落一条收尾行，重复作答不写第二条', async () => {
  const { service, cwd } = await sandbox()
  const evaluated = await service.evaluate({ tool: 'fs.write', command: 'write a.md', cwd })
  assert.equal(evaluated.decision.decision, 'ask')
  assert.equal(service.pendingCount(), 1)

  const answered = await service.decide({ requestId: evaluated.requestId, choice: 'allow-once' })
  assert.deepEqual(answered, { ok: true })
  assert.equal(service.pendingCount(), 0)

  const records = await service.audit()
  assert.equal(records.length, 2, '判定行 + 收尾行，追加式事件流')
  assert.deepEqual([records[0].decision, records[0].decidedBy], ['ask', 'tool-policy'])
  assert.deepEqual([records[1].decision, records[1].decidedBy], ['allow', 'user'])
  assert.equal(records[1].userChoice, 'allow-once')
  assert.equal(records[1].relatedId, records[0].id, '收尾行用 relatedId 指回判定行')
  assert.notEqual(records[1].id, records[0].id)

  const again = await service.decide({ requestId: evaluated.requestId, choice: 'deny' })
  assert.deepEqual(again, { ok: true }, '重复调用返回首次结果')
  assert.equal((await service.audit()).length, 2, '幂等：重复作答不追加记录')
})

test('expire：超时记 deny / timeout / userChoice=timeout（fail-closed）', async () => {
  const { service, cwd } = await sandbox()
  const evaluated = await service.evaluate({ tool: 'exec', command: 'make build', cwd })
  assert.equal(evaluated.decision.decision, 'ask')

  assert.deepEqual(await service.expire(evaluated.requestId), { ok: true })
  const records = await service.audit()
  assert.equal(records.length, 2)
  const record = records[1]
  assert.equal(record.decision, 'deny')
  assert.equal(record.decidedBy, 'timeout')
  assert.equal(record.userChoice, 'timeout')
  assert.equal(record.relatedId, records[0].id)
  assert.equal(service.pendingCount(), 0)
})

test('TC-19-2：readonly 档不放过写类，且审计里有这条 deny', async () => {
  const { service, cwd } = await sandbox()
  await service.set({ runMode: 'readonly' }, 1)

  const write = await service.evaluate({ tool: 'fs.write', command: 'echo x > a.md', cwd })
  const exec = await service.evaluate({ tool: 'exec', command: 'npm test', cwd })
  assert.deepEqual([write.decision.decision, write.decision.decidedBy], ['deny', 'runmode'])
  assert.deepEqual([exec.decision.decision, exec.decision.decidedBy], ['deny', 'runmode'])

  const denied = await service.audit({ decision: 'deny' })
  assert.equal(denied.length, 2)
  assert.equal(denied[0].tool, 'fs.write')
})

test('TC-22-1：full 档仍要问危险命令', async () => {
  const { service, cwd } = await sandbox()
  await service.set({ runMode: 'full' }, 1)

  const dangerous = await service.evaluate({ tool: 'exec', command: 'sudo rm -rf /tmp/x', cwd })
  const harmless = await service.evaluate({ tool: 'exec', command: 'ls', cwd })
  assert.deepEqual([dangerous.decision.decision, dangerous.decision.decidedBy], ['ask', 'danger-guard'])
  assert.equal(dangerous.decision.matchedRule, 'danger:rm -rf')
  assert.deepEqual([harmless.decision.decision, harmless.decision.decidedBy], ['allow', 'runmode'])
})

test('TC-23-2：永久允许不泛化——只放行同一条命令，不生成同类规则', async () => {
  const { service, cwd } = await sandbox()
  const first = await service.evaluate({ tool: 'exec', command: 'rm tmp.txt', cwd })
  assert.equal(first.decision.decision, 'ask')

  const answered = await service.decide({ requestId: first.requestId, choice: 'allow-always' })
  assert.deepEqual(answered, { ok: true, permanentAllow: true })
  assert.equal((await service.get()).permanentAllows.length, 1)

  const same = await service.evaluate({ tool: 'exec', command: 'rm   tmp.txt ', cwd })
  const other = await service.evaluate({ tool: 'exec', command: 'rm other.txt', cwd })
  assert.deepEqual([same.decision.decision, same.decision.decidedBy], ['allow', 'permanent'])
  assert.equal(other.decision.decision, 'ask', '换个文件必须重新问')
  assert.equal((await service.get()).permanentAllows.length, 1)

  const piped = await service.evaluate({ tool: 'exec', command: 'rm a | rm b', cwd })
  const blocked = await service.decide({ requestId: piped.requestId, choice: 'allow-always' })
  assert.deepEqual(blocked, { ok: true }, '带元字符只能当次允许')
  assert.equal((await service.get()).permanentAllows.length, 1, '不写泛化规则，也不写这条')
})

test('审计失败不影响判定：返回结果照旧，health 能看到积压', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'approval-service-bad-'))
  const stateDir = path.join(home, '.dsh', 'state')
  await fsp.mkdir(stateDir, { recursive: true })
  const service = createApprovalService({ stateDir, home })

  // 目录只读：策略还能读（不存在 → 默认值），审计写不进去。
  await fsp.chmod(stateDir, 0o500)
  try {
    const result = await service.evaluate({ tool: 'fs.read', command: 'cat a', cwd: home })
    assert.equal(result.decision.decision, 'allow')
    assert.equal(result.audit.ok, false)
    assert.equal(service.auditHealth().failedWrites, 1)
    assert.ok(typeof service.auditHealth().lastError === 'string')
  } finally {
    await fsp.chmod(stateDir, 0o700)
  }
})

test('B3：并发 decide 同一 requestId 只收尾一次、返回同一结果', async () => {
  const { service, cwd } = await sandbox()
  const evaluated = await service.evaluate({ tool: 'exec', command: 'rm tmp.txt', cwd })

  const [first, second] = await Promise.all([
    service.decide({ requestId: evaluated.requestId, choice: 'allow-always' }),
    service.decide({ requestId: evaluated.requestId, choice: 'deny' }),
  ])
  assert.deepEqual(first, second, '两次调用拿到同一个结果')
  assert.deepEqual(first, { ok: true, permanentAllow: true })
  assert.equal(service.pendingCount(), 0)

  const records = await service.audit()
  assert.equal(records.length, 2, '判定行 + 唯一一条收尾行，不能写两条矛盾收尾')
  assert.equal(records.filter((record) => record.relatedId !== undefined).length, 1)
  assert.equal((await service.get()).permanentAllows.length, 1, '只建一条永久允许')
})

test('B3：decide 与 expire 并发也只收尾一次', async () => {
  const { service, cwd } = await sandbox()
  const evaluated = await service.evaluate({ tool: 'fs.write', command: 'write a.md', cwd })

  const [answered, expired] = await Promise.all([
    service.decide({ requestId: evaluated.requestId, choice: 'allow-once' }),
    service.expire(evaluated.requestId),
  ])
  assert.deepEqual(answered, expired, '两个入口共享同一个占位结果')
  const records = await service.audit()
  assert.equal(records.length, 2)
  assert.equal(records[1].decidedBy, 'user', '先到的 decide 收尾，expire 不再写 timeout 行')
})

test('V31-1：收尾抛错时条目放回 pending，重试能成功且只补一条收尾行', async () => {
  const { service, cwd } = await sandbox()
  const evaluated = await service.evaluate({ tool: 'exec', command: 'rm tmp.txt', cwd })

  // 把永久允许的写入打成异常，模拟 addPermanentAllow 的 IO 失败。
  const original = service.policyStore.addPermanentAllow.bind(service.policyStore)
  let boom = true
  service.policyStore.addPermanentAllow = async (...args) => {
    if (boom) {
      boom = false
      throw new Error('disk on fire')
    }
    return original(...args)
  }

  await assert.rejects(service.decide({ requestId: evaluated.requestId, choice: 'allow-always' }))
  assert.equal(service.pendingCount(), 1, '失败后条目要放回 pending，不能丢')
  assert.equal((await service.audit()).length, 1, '失败时不该写收尾行')

  const retry = await service.decide({ requestId: evaluated.requestId, choice: 'allow-once' })
  assert.deepEqual(retry, { ok: true })
  assert.equal(service.pendingCount(), 0)
  const records = await service.audit()
  assert.equal(records.length, 2, '重试后补上唯一一条收尾行')
  assert.equal(records[1].decidedBy, 'user')
  assert.equal(records[1].userChoice, 'allow-once')
})

test('V32-1：危险命令选 allow-always 不落永久允许，当次也不放行', async () => {
  const { service, cwd } = await sandbox()
  const evaluated = await service.evaluate({ tool: 'exec', command: 'rm -rf /tmp/x', cwd })
  assert.deepEqual([evaluated.decision.decision, evaluated.decision.decidedBy], ['ask', 'danger-guard'])

  const answered = await service.decide({ requestId: evaluated.requestId, choice: 'allow-always' })
  assert.deepEqual(answered, { ok: true }, '不给 permanentAllow 标记')
  assert.equal((await service.get()).permanentAllows.length, 0, '死键不该落盘')

  const again = await service.evaluate({ tool: 'exec', command: 'rm -rf /tmp/x', cwd })
  assert.equal(again.decision.decision, 'ask', '下次仍然要问')
})

test('S8：作答收尾行 actor=user，超时收尾行 actor=policy', async () => {
  const { service, cwd } = await sandbox()
  const answered = await service.evaluate({ tool: 'fs.write', command: 'write a.md', cwd })
  await service.decide({ requestId: answered.requestId, choice: 'allow-once' })
  const timedOut = await service.evaluate({ tool: 'fs.write', command: 'write b.md', cwd })
  await service.expire(timedOut.requestId)

  const records = await service.audit()
  assert.deepEqual(records.map((record) => record.actor), ['policy', 'user', 'policy', 'policy'])
  assert.equal(records[1].decidedBy, 'user')
  assert.equal(records[3].decidedBy, 'timeout')
})
