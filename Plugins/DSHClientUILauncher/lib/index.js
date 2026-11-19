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

import { decide } from './approval/decision.mjs'
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

/** 宿主工具名 → T4 的 6 类工具（只覆盖 allow/deny 接管需要的映射）。 */
export const TOOL_NAME_TO_CLASS = Object.freeze({
  bash: 'exec',
  pwsh: 'exec',
  read: 'fs.read',
  glob: 'fs.read',
  grep: 'fs.read',
  read_image: 'fs.read',
  write: 'fs.write',
  edit: 'fs.write',
  apply_patch: 'fs.write',
  web_fetch: 'net',
  web_search: 'net',
  browser: 'browser',
})

/**
 * 在 approval/request 上**只接管 deny**（R-1/R-2 复审后收窄）：
 * - 宿主请求里不带 command/paths（实测字段只有 toolName/callId/reason/agent），
 *   带空 command 去 evaluate() 会绕过「危险命令一律 ask」并给 fs.write 放行；
 * - 因此先用纯 `decide()` 算一遍：只有 deny 才接管（runMode/tool-policy 与命令无关，安全），
 *   allow / ask 一律 `next()`（ask 交宿主原生卡，同时不产生 pending、不写「问过没人答」的审计）。
 * @param {object} service - createApprovalService 实例。
 * @param {{ toolName?: string, callId?: string, agent?: object }} request - 宿主请求。
 * @returns {Promise<'rejected'|null>} `rejected` 或 null（不接管）。
 */
export async function approvalOutcome(service, request) {
  const tool = TOOL_NAME_TO_CLASS[String(request?.toolName ?? '')]
  if (tool === undefined) return null
  const policy = await service.get()
  const cwd = request?.agent?.session?.cwd ?? ''
  const home = process.env.HOME ?? '/'
  // 纯函数先判（无副作用）：只有 deny 才能安全接管
  const pure = decide(policy, { tool, command: '', cwd, paths: [] }, { home })
  if (pure.decision !== 'deny') return null
  // deny 才走 evaluate，让 T4 写审计（不会产生 pending）
  const verdict = await service.evaluate(
    { tool, command: '', cwd, toolCallId: request?.callId },
    { sessionId: request?.agent?.session?.id ?? '', requestId: request?.callId },
  )
  return verdict?.decision?.decision === 'deny' ? 'rejected' : null
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
    path: '/dsh-approval/pending',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        jsonStatus(res, 405, { error: 'GET only' })
        return
      }
      // 轮询只回小结构：count + latest；详情由 /pending/detail 按 requestId 取
      const list = service.pendingSnapshot()
      const latest = list.length === 0 ? null : (({ requestId, command, sessionId, turn }) => ({ requestId, command, sessionId, turn }))(list[0])
      json(res, { count: list.length, latest })
    },
  }))
  disposers.push(server.register({
    kind: 'exact',
    path: '/dsh-approval/pending/detail',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        jsonStatus(res, 405, { error: 'GET only' })
        return
      }
      const params = new URL(req.url, 'http://127.0.0.1').searchParams
      const requestId = params.get('requestId') ?? ''
      const detail = service.pendingDetail(requestId)
      if (detail === null) {
        jsonStatus(res, 404, { error: 'not pending' })
        return
      }
      json(res, detail)
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
        const ALLOWED_CHOICES = ['allow-once', 'allow-always', 'deny']
        if (!ALLOWED_CHOICES.includes(value?.choice)) {
          jsonStatus(res, 400, { ok: false, reason: 'invalid-choice' })
          return
        }
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
  // allow/deny 接管：策略真的影响宿主工具审批；ask 交回宿主原生卡（避免双卡）
  ctx.on('approval/request', async (request, next) => {
    // 顺序取证：waterfall 按注册序执行；若 api-remotes 的转发先注册，原生卡会先被问，
    // 只有它 pass 才轮到我们。用 DSH_APPROVAL_TRACE=1 时打日志钉死先后。
    const trace = process.env.DSH_APPROVAL_TRACE === '1'
    if (trace) console.error('[approval-takeover] handler entered', request?.toolName, request?.callId, Object.keys(request ?? {}))
    try {
      const outcome = await approvalOutcome(service, request)
      if (trace) console.error('[approval-takeover] outcome', outcome)
      if (outcome === null) return next()
      return outcome
    } catch (error) {
      if (trace) console.error('[approval-takeover] fallback to native', String(error?.message ?? error))
      return next()
    }
  })
  ctx.inject(['webServer'], (host) => {
    host.effect(() => {
      const disposers = registerApprovalRoutes(host.webServer, service)
      return () => { for (const dispose of disposers) dispose?.() }
    })
  })
  return service
}
