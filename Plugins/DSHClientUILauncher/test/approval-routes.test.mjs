/** PR-B host 半区：审批端点的手续与参数解析（不启 HTTP 服务，直接调 handler）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createApprovalService } from '../lib/approval/index.mjs'
import { auditQuery, registerApprovalRoutes } from '../lib/index.js'

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'approval-routes-'))
  const service = createApprovalService({ stateDir: dir, home: dir })
  const routes = new Map()
  const server = { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path) } }
  registerApprovalRoutes(server, service)
  const call = async (path, { method = 'GET', url = path, body } = {}) => {
    const handler = routes.get(path)
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = { method, url, [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c } }
    let status = 200
    let payload = ''
    const res = {
      writeHead: (code) => { status = code; return res },
      end: (text) => { payload = text },
    }
    await handler(req, res)
    return { status, body: payload === '' ? undefined : JSON.parse(payload) }
  }
  return { dir, service, call, routes }
}

test('四个端点都注册了', () => {
  const { routes, dir } = harness()
  assert.deepEqual([...routes.keys()].sort(), ['/dsh-approval/audit', '/dsh-approval/decide', '/dsh-approval/policy'])
  rmSync(dir, { recursive: true, force: true })
})

test('GET policy 返回默认文档；POST 非法 patch 走 invalid 而不是 500', async () => {
  const { call, dir } = harness()
  const got = await call('/dsh-approval/policy')
  assert.equal(got.status, 200)
  assert.equal(typeof got.body.version, 'number')
  const bad = await call('/dsh-approval/policy', { method: 'POST', body: { patch: { runMode: 'nope' }, ifVersion: got.body.version } })
  assert.equal(bad.status, 200)
  assert.equal(bad.body.ok, false)
  assert.equal(bad.body.reason, 'invalid')
  const wrongMethod = await call('/dsh-approval/policy', { method: 'DELETE' })
  assert.equal(wrongMethod.status, 405)
  rmSync(dir, { recursive: true, force: true })
})

test('auditQuery 只接受合法值（非法 limit/tool/decision 被忽略）', () => {
  assert.deepEqual(auditQuery('/dsh-approval/audit?limit=abc&decision=maybe'), {})
  assert.deepEqual(auditQuery('/dsh-approval/audit?limit=10&decision=ask&tool=shell&from=a&to=b'), { from: 'a', to: 'b', limit: 10, tool: 'shell', decision: 'ask' })
})

test('decide 未知 requestId 返回 ok:false 而不是抛错', async () => {
  const { call, dir } = harness()
  const res = await call('/dsh-approval/decide', { method: 'POST', body: { requestId: 'nope', choice: 'deny' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, false)
  rmSync(dir, { recursive: true, force: true })
})
