/** PR-B 客户端封装：URL/方法/失败策略（注入 fetch，不发真请求）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApprovalClient, shouldPoll } from '../lib/approval-client.mjs'

function recorder(payload = { ok: true }) {
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => payload } }
  return { calls, client: createApprovalClient({ fetchImpl }) }
}

test('get/set/audit/decide/pending 打到约定路径与方法', async () => {
  const { calls, client } = recorder()
  await client.get()
  await client.set({ runMode: 'ask' }, 3)
  await client.audit({ limit: 10, decision: 'ask' })
  await client.decide('r1', 'deny')
  await client.pending()
  assert.deepEqual(calls.map((c) => [c.url, c.init?.method ?? 'GET']), [
    ['/dsh-approval/policy', 'GET'],
    ['/dsh-approval/policy', 'POST'],
    ['/dsh-approval/audit?limit=10&decision=ask', 'GET'],
    ['/dsh-approval/decide', 'POST'],
    ['/dsh-approval/pending', 'GET'],
  ])
  assert.deepEqual(JSON.parse(calls[1].init.body), { patch: { runMode: 'ask' }, ifVersion: 3 })
})

test('非 2xx 抛错（调用方据此计失败次数）', async () => {
  const client = createApprovalClient({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) })
  await assert.rejects(() => client.pending(), /HTTP 503/)
})

test('shouldPoll：隐藏停、失败到 3 次停、可见且未超限继续', () => {
  assert.equal(shouldPoll({ visibility: 'hidden' }), false)
  assert.equal(shouldPoll({ visibility: 'visible', failures: 3 }), false)
  assert.equal(shouldPoll({ visibility: 'visible', failures: 2 }), true)
})
