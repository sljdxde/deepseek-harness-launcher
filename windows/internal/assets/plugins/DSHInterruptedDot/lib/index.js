/**
 * dsh-interrupted-dot — 本地 DSH 插件（宿主半边）。
 *
 * 目的：Harness 侧栏的会话状态点只有「已完成」（绿）/「进行中」/「待审批」
 * 三种，分不出「本轮正常收尾」和「本轮异常结束」。这里把每个主会话**最后
 * 一轮的结局**记在内存里，供浏览器半边把绿点染红。
 *
 * 正常收尾（不标红）：`completed`；用户按停止 / 宿主回收：`aborted`；上限
 * 截断 `max-tokens`；`blocked`、`forked` 都不算失败。
 * 异常结束（标红）：`error`（模型/网络/工具报错）、`interrupted`（进程在
 * 本轮完成前退出，宿主恢复时补写的收尾标记）。
 *
 *   GET /dsh-interrupted-dot/state
 *     → { revision, failed: [sessionId, ...] }
 *       `failed` 是「最后一轮以异常收尾」的主会话；新一轮 `turn/start` 立即
 *       清掉（会话又开始干活了），所以红点不会盖住下一次正常完成。
 *
 * 内存态只覆盖「本进程活着时发生的失败」。DSH 重启后失败记录清零；跨重启的
 * 崩溃由浏览器半边用重连窗口判定，两者在客户端合并。
 *
 * @module dsh-interrupted-dot
 */

/** 插件名（cordis 用）。 */
export const name = 'dsh-interrupted-dot'

/** 只有这两种结局算「异常结束」。 */
const FAILED_REASONS = new Set(['error', 'interrupted'])

/** 记住的会话上限；超出按插入顺序丢最旧的。 */
const DEFAULT_LIMIT = 200

/**
 * 主会话 id：子智能体会话的回合收尾不算用户眼里的「会话」。
 * @param session - `session/event` 带回的 Session 对象。
 * @returns 主会话 id；子智能体 / 缺 id 时返回空串。
 */
export function rootSessionId(session) {
  if (session?.header?.origin === 'subagent') return ''
  const id = session?.header?.id ?? session?.id
  return typeof id === 'string' && id.length > 0 ? id : ''
}

/**
 * 「最后一轮结局」索引：纯状态机，便于单独测试。
 * @param limit - 最多记住多少个失败会话。
 * @returns 记录事件、读快照的句柄。
 */
export function createFailureIndex(limit = DEFAULT_LIMIT) {
  /** sessionId → { reason, at } */
  const failed = new Map()
  let revision = 0

  return {
    /**
     * 吃一个 `session/event`。
     * @param session - Session 对象。
     * @param event - 会话事件。
     * @param now - 事件时间（测试可注入）。
     * @returns 失败集合是否发生变化。
     */
    record(session, event, now = Date.now()) {
      const sessionId = rootSessionId(session)
      if (sessionId === '' || typeof event?.type !== 'string') return false
      // 新一轮开始 = 这个会话又在干活：上一次失败不再是「最后结局」。
      if (event.type === 'turn/start') {
        if (!failed.delete(sessionId)) return false
        revision += 1
        return true
      }
      if (event.type !== 'turn/end') return false
      const reason = typeof event.data?.reason?.kind === 'string' ? event.data.reason.kind : ''
      if (FAILED_REASONS.has(reason)) {
        failed.set(sessionId, { reason, at: now })
        while (failed.size > limit) failed.delete(failed.keys().next().value)
        revision += 1
        return true
      }
      // 正常收尾：清掉这个会话之前挂着的失败。
      if (!failed.delete(sessionId)) return false
      revision += 1
      return true
    },

    /**
     * 当前快照。
     * @returns { revision, failed: string[] }
     */
    state() {
      return { revision, failed: [...failed.keys()] }
    },
  }
}

/**
 * 插件入口。
 * @param ctx - cordis 上下文。
 */
export function apply(ctx) {
  const index = createFailureIndex()

  ctx.on('session/event', (session, event) => {
    try {
      index.record(session, event)
    } catch (error) {
      // 记录失败绝不能影响会话本身。
      ctx.logger?.warn?.(`[dsh-interrupted-dot] record failed: ${String(error)}`)
    }
  })

  ctx.inject(['webServer'], host => {
    host.effect(() => {
      const dispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-interrupted-dot/state',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(index.state()))
        },
      })
      return () => dispose()
    }, 'dsh-interrupted-dot: state route')
  })
}
