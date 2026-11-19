/**
 * host 半区：把 T4 的审批服务（`lib/approval/index.mjs`）接到宿主 HTTP 面上，
 * 客户端通过 `/dsh-approval/*` 四个端点访问 §7.4 冻结的 `ApprovalRemote`：
 *   GET  /dsh-approval/policy        → PolicyDoc
 *   POST /dsh-approval/policy        → { patch, ifVersion } → { ok } | { ok:false, reason }
 *   GET  /dsh-approval/audit?…       → AuditRecord[]
 *   POST /dsh-approval/decide        → { requestId, choice } → { ok }
 *
 * 判定/审计/存储全部走 T4 实现，这里不改判定逻辑、不在客户端另记一份。
 */

import { createApprovalService } from './approval/index.mjs'

export const name = 'dsh-client-ui-launcher'

function json(response, value) {
  response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function jsonStatus(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** 审计查询参数（from/to/limit/tool/decision），非法值忽略而不是 500。 */
export function auditQuery(url) {
  const params = new URL(url, 'http://127.0.0.1').searchParams
  const query = {}
  const from = params.get('from')
  const to = params.get('to')
  const limit = Number(params.get('limit'))
  const tool = params.get('tool')
  const decision = params.get('decision')
  if (typeof from === 'string' && from.length > 0) query.from = from
  if (typeof to === 'string' && to.length > 0) query.to = to
  if (Number.isFinite(limit) && limit > 0) query.limit = Math.trunc(limit)
  if (typeof tool === 'string' && tool.length > 0) query.tool = tool
  if (decision === 'allow' || decision === 'ask' || decision === 'deny') query.decision = decision
  return query
}

/**
 * 注册审批相关路由；返回 dispose 列表（由调用方的 effect 统一回收）。
 * @param {{ register: Function }} server - webServer 面。
 * @param {object} service - createApprovalService 的实例。
 * @returns {Function[]} dispose 列表。
 */
export function registerApprovalRoutes(server, service) {
  const disposers = []
  disposers.push(server.register({
    kind: 'exact',
    path: '/dsh-approval/policy',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        json(res, await service.get())
        return
      }
      if (req.method !== 'POST') {
        jsonStatus(res, 405, { error: 'GET or POST only' })
        return
      }
      try {
        const value = await readBody(req)
        json(res, await service.set(value?.patch ?? {}, Number(value?.ifVersion)))
      } catch (error) {
        jsonStatus(res, 400, { ok: false, reason: 'invalid', message: String(error?.message ?? error) })
      }
    },
  }))
  disposers.push(server.register({
    kind: 'exact',
    path: '/dsh-approval/audit',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        jsonStatus(res, 405, { error: 'GET only' })
        return
      }
      json(res, await service.audit(auditQuery(req.url)))
    },
  }))
  disposers.push(server.register({
    kind: 'exact',
    path: '/dsh-approval/decide',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        jsonStatus(res, 405, { error: 'POST only' })
        return
      }
      try {
        const value = await readBody(req)
        json(res, await service.decide({ requestId: String(value?.requestId ?? ''), choice: value?.choice }))
      } catch (error) {
        jsonStatus(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }))
  return disposers
}

/**
 * 挂载点：造审批服务实例，等 webServer 就绪后注册四个端点。
 * @param {object} ctx - cordis 上下文。
 */
export function apply(ctx) {
  const service = createApprovalService()
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposers = registerApprovalRoutes(host.webServer, service)
      return () => { for (const dispose of disposers) dispose?.() }
    })
  })
  return service
}
