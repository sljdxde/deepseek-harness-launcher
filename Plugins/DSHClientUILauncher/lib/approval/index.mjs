/**
 * 审批服务的对外面：Remote 的 `get / set / audit / decide`（§7.4 冻结签名），
 * 外加 host 侧判定入口 `evaluate()` 与超时入口 `expire()`。
 *
 * `evaluate()` 不在 Remote 面上：PR-B 的接线只在真正发生工具调用时用它，
 * 一次调用 = 一次判定 = 一条审计（allow 也写，§7.3）。
 */

import os from 'node:os'
import path from 'node:path'

import { AuditLog, truncateCommand } from './audit.mjs'
import { decide, normalizeCommand, normalizePath } from './decision.mjs'
import { PolicyStore } from './policy-store.mjs'
import { ulid } from './ulid.mjs'

/**
 * 造一个审批服务实例。
 * @param {{ stateDir?: string, home?: string, now?: () => Date, maxBytes?: number }} [options] - 存储目录、主目录、时钟、审计单片上限（测试用）。
 * @returns {object} 服务对象。
 */
export function createApprovalService(options = {}) {
  const home = options.home ?? os.homedir()
  const now = options.now ?? (() => new Date())
  const stateDir = options.stateDir ?? path.join(home, '.dsh', 'state')
  const store = new PolicyStore({ stateDir, home, now })
  const log = new AuditLog({ stateDir, home, now, maxBytes: options.maxBytes })
  /** requestId → { record, call }，等用户作答的那批。 */
  const pending = new Map()
  /** requestId → 首次作答的结果，`decide` / `expire` 幂等用（重复调用不写第二行）。 */
  const answered = new Map()

  /**
   * 对一次工具调用做判定并写审计。
   * @param {{ tool: string, command?: string, cwd?: string, paths?: string[], toolCallId?: string }} call - 工具调用。
   * @param {{ sessionId?: string, runId?: string, requestId?: string, startedAt?: number, toolCallId?: string }} [ctx] - 会话上下文。
   * @returns {Promise<{requestId: string, decision: object, record: object, audit: object}>} 判定结果。
   */
  async function evaluate(call, ctx = {}) {
    const policy = await store.get()
    const startedAt = typeof ctx.startedAt === 'number' ? ctx.startedAt : Date.now()
    const verdict = decide(policy, call, { home })
    const rawCommand = typeof call?.command === 'string' ? call.command : ''
    const requestId = ctx.requestId ?? call?.requestId ?? call?.toolCallId ?? ulid(now().getTime())
    const record = {
      id: ulid(now().getTime()),
      ts: now().toISOString(),
      sessionId: ctx.sessionId ?? '',
      runId: ctx.runId ?? '',
      toolCallId: ctx.toolCallId ?? call?.toolCallId ?? '',
      actor: 'policy',
      tool: call?.tool,
      command: truncateCommand(rawCommand),
      cwd: normalizePath(typeof call?.cwd === 'string' && call.cwd.length > 0 ? call.cwd : home, home),
      decision: verdict.decision,
      decidedBy: verdict.decidedBy,
      matchedRule: verdict.matchedRule,
      policyVersion: policy.version,
      runModeAtDecision: policy.runMode,
      durationMs: Math.max(Date.now() - startedAt, 0),
    }
    const audit = await log.append(record)
    if (verdict.decision === 'ask') {
      pending.set(requestId, { record, call: { ...call, command: rawCommand } })
    }
    return { requestId, decision: verdict, record, audit }
  }

  /**
   * 收尾一条待审批：写收尾行（新 id + relatedId），`allow-always` 时再落永久允许。
   * @param {object} entry - pending 里的判定。
   * @param {'allow-once'|'allow-always'|'deny'} choice - 用户选择。
   * @returns {Promise<{ok: boolean, permanentAllow?: boolean}>} 结果。
   */
  async function finalizeDecision(entry, choice) {
    let permanentAllow = false
    if (choice === 'allow-always') {
      const added = await store.addPermanentAllow(entry.call)
      permanentAllow = added.ok === true
    }
    const final = {
      ...entry.record,
      id: ulid(now().getTime()),
      relatedId: entry.record.id,
      ts: now().toISOString(),
      // 收尾行是人的操作：actor 记 user，按 actor 取证才拿得到（审查 S8）。
      actor: 'user',
      decision: choice === 'deny' ? 'deny' : 'allow',
      decidedBy: 'user',
      userChoice: choice,
      durationMs: Math.max(Date.now() - Date.parse(entry.record.ts), 0),
    }
    await log.append(final)
    return permanentAllow ? { ok: true, permanentAllow: true } : { ok: true }
  }

  /**
   * 收尾一条超时的待审批：fail-closed 记 deny / timeout。
   * @param {object} entry - pending 里的判定。
   * @returns {Promise<{ok: true}>} 结果。
   */
  async function finalizeExpire(entry) {
    const final = {
      ...entry.record,
      id: ulid(now().getTime()),
      relatedId: entry.record.id,
      ts: now().toISOString(),
      // 超时不是任何人做的：actor 保持 policy（§7.3 的 actor 联合类型里没有 timeout）。
      actor: 'policy',
      decision: 'deny',
      decidedBy: 'timeout',
      userChoice: 'timeout',
      durationMs: Math.max(Date.now() - Date.parse(entry.record.ts), 0),
    }
    await log.append(final)
    return { ok: true }
  }

  /**
   * 摘掉 pending 并把这次的收尾 promise 记进 answered。
   *
   * 判在与 await 之间没有空隙：后续同 requestId 的调用拿到同一个 promise，
   * 不会出现「两次都 ok、审计里两条矛盾收尾行」（审查 B3）。
   * @param {string} requestId - 待审批请求。
   * @param {object} entry - pending 里的判定。
   * @param {() => Promise<object>} task - 真正做收尾的异步函数。
   * @returns {Promise<object>} 收尾结果。
   */
  function claim(requestId, entry, task) {
    pending.delete(requestId)
    const running = task().catch((error) => {
      // 收尾失败（如 addPermanentAllow 的 IO 异常）要把条目放回 pending，
      // 否则这条审批永远答不了：审计只剩判定行、用户答案永久丢失（审查 V31-1）。
      answered.delete(requestId)
      pending.set(requestId, entry)
      throw error
    })
    answered.set(requestId, running)
    return running
  }

  /**
   * 用户作答。同一个 requestId 只收尾一次，重复 / 并发的调用都拿第一次的结果。
   * @param {{ requestId: string, choice: 'allow-once'|'allow-always'|'deny' }} req - 作答。
   * @returns {Promise<{ok: boolean, permanentAllow?: boolean}>} 结果。
   */
  async function takeDecision(req) {
    const requestId = req?.requestId
    if (typeof requestId !== 'string' || requestId.length === 0) return { ok: false }
    const inFlight = answered.get(requestId)
    if (inFlight !== undefined) return inFlight
    const entry = pending.get(requestId)
    if (entry === undefined) return { ok: false }
    return claim(requestId, entry, () => finalizeDecision(entry, req.choice))
  }

  /**
   * 等用户作答超时：fail-closed 记一条 deny，别让「问了没人应」在审计里留白。
   * 与 decide 共用同一个占位，两个入口并发也只收尾一次。
   * @param {string} requestId - 待审批请求。
   * @returns {Promise<{ok: boolean}>} 结果。
   */
  async function expire(requestId) {
    const inFlight = answered.get(requestId)
    if (inFlight !== undefined) return inFlight
    const entry = pending.get(requestId)
    if (entry === undefined) return { ok: false }
    return claim(requestId, entry, () => finalizeExpire(entry))
  }

  return {
    // Remote 面（签名冻结，PR-B 只调这四个）。
    get: () => store.get(),
    set: (patch, ifVersion) => store.set(patch, ifVersion),
    audit: (query) => log.read(query),
    decide: (req) => takeDecision(req),
    // host 侧入口。
    evaluate,
    expire,
    auditHealth: () => log.health(),
    pendingCount: () => pending.size,
    // 自检可用的内部句柄（不接线、不暴露给 client）。
    policyStore: store,
    auditLog: log,
    normalizeCommand,
  }
}
