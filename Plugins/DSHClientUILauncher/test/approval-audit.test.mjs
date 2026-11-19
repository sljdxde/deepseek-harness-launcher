/**
 * 审计用例：每次判定都写、轮转命名、跨文件读、过滤、截断、同 id 收尾（05-设计 §7.3、§10-9）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { AuditLog, COMMAND_BYTES_LIMIT, truncateCommand } from '../lib/approval/audit.mjs'
import { ulid } from '../lib/approval/ulid.mjs'

/**
 * 造一个审计日志实例，时钟按调用次数递增，保证 ts 可比较。
 * @param {{ maxBytes?: number }} [options] - 单片上限。
 * @returns {Promise<{log: AuditLog, dir: string}>} 环境。
 */
async function sandbox(options = {}) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'approval-audit-'))
  const dir = path.join(home, '.dsh', 'state')
  let tick = 0
  const now = () => new Date(Date.parse('2026-11-19T12:00:00.000Z') + tick++ * 1000)
  const log = new AuditLog({ stateDir: dir, home, now, maxBytes: options.maxBytes })
  return { log, dir }
}

/**
 * 造一条合法审计记录。
 * @param {object} [patch] - 覆盖字段。
 * @returns {object} AuditRecord。
 */
function recordOf(patch = {}) {
  return {
    id: ulid(),
    ts: '2026-11-19T12:00:00.000Z',
    sessionId: 'session-1',
    runId: 'run-1',
    toolCallId: 'call-1',
    actor: 'policy',
    tool: 'fs.read',
    command: 'cat a.md',
    cwd: '/Users/tester/Pod',
    decision: 'allow',
    decidedBy: 'tool-policy',
    policyVersion: 1,
    runModeAtDecision: 'auto-safe',
    durationMs: 2,
    ...patch,
  }
}

test('allow / ask / deny 三条都写进审计，读出来按时间升序', async () => {
  const { log } = await sandbox()
  await log.append(recordOf({ decision: 'allow', decidedBy: 'tool-policy' }))
  await log.append(recordOf({ decision: 'ask', decidedBy: 'danger-guard', matchedRule: 'danger:sudo' }))
  await log.append(recordOf({ decision: 'deny', decidedBy: 'runmode' }))

  const records = await log.read()
  assert.deepEqual(records.map((item) => item.decision), ['allow', 'ask', 'deny'])
  for (let index = 1; index < records.length; index += 1) {
    assert.ok(records[index - 1].id < records[index].id, 'ulid 必须单调递增')
  }
})

test('超过单片上限就轮转：.1 = 最近一次，当前文件从头写', async () => {
  const { log, dir } = await sandbox({ maxBytes: 800 })
  for (let index = 0; index < 6; index += 1) {
    await log.append(recordOf({ toolCallId: `call-${index}`, command: 'x'.repeat(40) }))
  }
  const names = await fsp.readdir(dir)
  assert.ok(names.includes('approval-audit.jsonl'))
  assert.ok(names.includes('approval-audit.1.jsonl'), '轮转件要按 .1 命名')
  assert.ok(!names.includes('approval-audit.6.jsonl'), '只保留 5 片')

  const currentSize = (await fsp.stat(path.join(dir, 'approval-audit.jsonl'))).size
  assert.ok(currentSize <= 800, '当前文件不应超过单片上限')
})

test('audit() 跨文件读：轮转后的老记录也查得到', async () => {
  const { log } = await sandbox({ maxBytes: 800 })
  const ids = []
  for (let index = 0; index < 8; index += 1) {
    const record = recordOf({ command: 'y'.repeat(40), toolCallId: `call-${index}` })
    ids.push(record.id)
    await log.append(record)
  }
  const records = await log.read({ limit: 100 })
  assert.equal(records.length, 8, '当前文件 + 轮转件里的记录都要读出来')
  const got = new Set(records.map((item) => item.id))
  for (const id of ids) assert.ok(got.has(id), `缺了 ${id}`)
})

test('audit() 过滤：tool / decision / from / to / limit', async () => {
  const { log } = await sandbox()
  await log.append(recordOf({ tool: 'fs.read', decision: 'allow', ts: '2026-11-19T10:00:00.000Z' }))
  await log.append(recordOf({ tool: 'exec', decision: 'ask', ts: '2026-11-19T11:00:00.000Z' }))
  await log.append(recordOf({ tool: 'exec', decision: 'deny', ts: '2026-11-19T12:00:00.000Z' }))

  assert.equal((await log.read({ tool: 'exec' })).length, 2)
  assert.equal((await log.read({ decision: 'deny' })).length, 1)
  const windowed = await log.read({ from: '2026-11-19T10:30:00.000Z', to: '2026-11-19T11:30:00.000Z' })
  assert.deepEqual(windowed.map((item) => item.decision), ['ask'])
  const limited = await log.read({ limit: 2 })
  assert.deepEqual(limited.map((item) => item.decision), ['ask', 'deny'], 'limit 取最近的 N 条')
})

test('追加式事件流：收尾行是新 id + relatedId，两行都读得到（不去重）', async () => {
  const { log } = await sandbox()
  const base = recordOf({ decision: 'ask', decidedBy: 'tool-policy' })
  await log.append(base)
  const closing = recordOf({ decision: 'deny', decidedBy: 'user', userChoice: 'deny', relatedId: base.id })
  await log.append(closing)
  const records = await log.read()
  assert.equal(records.length, 2, '判定行和收尾行都要保留')
  assert.equal(records[0].id, base.id)
  assert.equal(records[0].decision, 'ask')
  assert.equal(records[1].relatedId, base.id, '收尾行指回判定行')
  assert.notEqual(records[1].id, base.id, '收尾行必须换新 id')
})

test('command 超过 4096 字节按字节截断并加标记', async () => {
  const long = 'a'.repeat(COMMAND_BYTES_LIMIT + 500)
  const cut = truncateCommand(long)
  assert.ok(cut.endsWith('…[truncated]'))
  assert.ok(Buffer.byteLength(cut, 'utf8') <= COMMAND_BYTES_LIMIT + Buffer.byteLength('…[truncated]'))
  assert.equal(truncateCommand('short'), 'short')

  const { log } = await sandbox()
  await log.append(recordOf({ command: long }))
  const [record] = await log.read()
  assert.ok(record.command.endsWith('…[truncated]'))
})

test('写失败不抛错：计数 + health 能看到，判定不受影响', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'approval-audit-bad-'))
  const blocked = path.join(home, 'not-a-dir')
  await fsp.writeFile(blocked, 'file', 'utf8')
  const log = new AuditLog({ stateDir: blocked, home })
  const result = await log.append(recordOf())
  assert.equal(result.ok, false)
  assert.equal(log.health().failedWrites, 1)
  assert.ok(typeof log.health().lastError === 'string')
})
