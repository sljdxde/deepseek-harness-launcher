window.__ModuleLoader__.load({ id: 'dsh-interrupted-dot', factory: () => {
  /**
   * dsh-interrupted-dot — 本地 DSH 插件（浏览器半边）。
   *
   * Harness 侧栏的「已完成」状态点只看 `running: true → false`，分不出「本轮
   * 正常收尾」和「本轮异常结束」：DSH 进程中途退出后重启，同一个会话照样点亮
   * 绿点，看起来像成功。这个插件**不新增第二个点**，只把 DSH 自己那个点的
   * `data-state` 从 `done` 改成 `error`（组件自带红色），语义变成：
   *
   *   绿点 = 本轮正常结束；红点 = 本轮异常结束（崩溃 / 本轮报错）。
   *
   * 两个异常来源在客户端合并：
   * 1. 本轮报错：宿主半边（lib/index.js）从 `turn/end` 的 reason 里认
   *    `error` / `interrupted`，客户端轮询 `/dsh-interrupted-dot/state` 取。
   * 2. 进程崩溃：宿主已经死了，没人能记录。靠连接代次判定——一次真实重连
   *    （`connection/reset`）前后几秒内，某会话从运行中变成不运行，说明
   *    DSH 在这中间死过，这一轮不可能正常收尾。正常收尾不会跨重连：它一定
   *    在当前连接里先把 running 置 false。
   *
   * 红点跟 DSH 自己的点同生命周期：打开会话（DSH 撤掉完成点）或会话重新开跑
   * 就恢复，不额外记「已读」。
   */

  const STATE_URL = '/dsh-interrupted-dot/state'
  /** 轮询宿主状态 + 重画。侧栏点不需要更实时。 */
  const POLL_MS = 1500
  /** 重连与 running→false 之间允许的偏差；跨过它就不是同一次重启。 */
  const RESET_WINDOW_MS = 3000
  /** 红点悬停说明。 */
  const TITLE = '异常结束：本轮没有正常收尾'

  async function readJSON(url) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  }

  /** 测试环境没有 document：DOM 相关操作一律安全跳过。 */
  function hasDom() {
    return typeof document !== 'undefined' && typeof document.querySelector === 'function'
  }

  /**
   * 侧栏里属于这个会话的那一行（搜索结果行没有这个属性）。
   * @param sessionId - 会话 id。
   * @returns 行元素，找不到时为 null。
   */
  function sessionRow(sessionId) {
    if (!hasDom()) return null
    try {
      return document.querySelector(`[data-row-key="session:${sessionId}"]`)
    } catch {
      return null
    }
  }

  /**
   * 行首那一格里 DSH 自己画的状态点。`StateDot` 在 dot 形态下是带
   * `data-state` 的 span（进行中是带 `data-state` 的 svg），这一格只有它
   * 和给读屏器看的隐藏文字。
   * @param row - 会话行元素。
   * @returns 状态点元素，没有时为 null。
   */
  function statusDot(row) {
    const cell = row?.firstElementChild
    const children = cell?.children
    if (!children) return null
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]
      if (typeof child?.getAttribute !== 'function') continue
      if (child.getAttribute('data-state') !== null) return child
    }
    return null
  }

  function apply(ctx) {
    /** 被染红的点 → 原来的 data-state（DSH 重渲染换掉元素时自然不会命中）。 */
    const originalState = new WeakMap()
    /** 本页见过 running=true 的会话。 */
    const runningSeen = new Set()
    /** 判定为「进程崩溃导致本轮中断」的会话。 */
    const crashMarks = new Set()
    /** 已经染过红的会话，用来恢复。 */
    const painted = new Set()
    /** 宿主报告的「最后一轮失败」会话。 */
    let hostFailed = new Set()
    /** 最近一次连接代次建立的时间。 */
    let lastResetAt = 0
    let disposed = false
    /** 侧栏会话树的变更观察器：React 换掉状态点后立即重画，不留一秒绿。 */
    let observer = null

    /** 当前会话列表快照。 */
    const readSnapshot = () => ctx.sessions.list.getSnapshot()

    /**
     * 监听侧栏会话树的节点变化（React 重渲染会换掉状态点元素，把染红丢掉）。
     * 只观察 childList：我们自己改的 `data-state` 是属性变更，不会触发回环。
     * @param onChange - 有变化时调用。
     */
    function watchTree(onChange) {
      if (observer !== null || typeof MutationObserver !== 'function' || !hasDom()) return
      const root = document.querySelector('[role="tree"]')
      if (root === null) return
      observer = new MutationObserver(() => onChange())
      observer.observe(root, { childList: true, subtree: true })
    }

    /**
     * 把一个会话的状态点染红 / 恢复。
     * @param sessionId - 会话 id。
     * @param interrupted - true 染红，false 恢复。
     */
    function paintDot(sessionId, interrupted) {
      const dot = statusDot(sessionRow(sessionId))
      if (!dot) return
      if (interrupted) {
        // 只改 DSH 的「已完成」绿点：进行中 / 待审批 / 其它状态比完成更优先。
        if (dot.getAttribute('data-state') !== 'done') return
        if (!originalState.has(dot)) originalState.set(dot, 'done')
        dot.setAttribute('data-state', 'error')
        dot.setAttribute('title', TITLE)
        return
      }
      if (!originalState.has(dot)) return
      originalState.delete(dot)
      if (dot.getAttribute('data-state') === 'error') dot.setAttribute('data-state', 'done')
      dot.removeAttribute('title')
    }

    /**
     * 把列表快照、宿主状态合成一次「谁该是红点」，并落到 DOM。
     * @param snapshot - `ctx.sessions.list` 快照。
     */
    function reconcile(current) {
      const rows = current?.byId ?? {}
      const now = Date.now()
      for (const sessionId of Object.keys(rows)) {
        const row = rows[sessionId]
        if (row?.running === true) {
          runningSeen.add(sessionId)
          crashMarks.delete(sessionId)
          // 又开跑了：上一轮的失败已经过期。宿主也会在 turn/start 时清，但宿主
          // 轮询有 1.5s 延迟，这里先清掉，免得新一轮正常完成时被旧标记染红。
          hostFailed.delete(sessionId)
          continue
        }
        // 运行中 → 不运行：只有跨过一次重连才可能是「进程中途退出」。
        if (runningSeen.delete(sessionId)
          && lastResetAt > 0
          && Math.abs(now - lastResetAt) <= RESET_WINDOW_MS) {
          crashMarks.add(sessionId)
        }
        if ((row?.retainedBy?.mainView ?? 0) > 0) crashMarks.delete(sessionId)
      }
      for (const sessionId of [...crashMarks]) {
        if (rows[sessionId] === undefined) crashMarks.delete(sessionId)
      }

      const wanted = new Set([...hostFailed, ...crashMarks])
      for (const sessionId of wanted) {
        if (rows[sessionId] === undefined) continue
        paintDot(sessionId, true)
        painted.add(sessionId)
      }
      for (const sessionId of [...painted]) {
        if (wanted.has(sessionId)) continue
        paintDot(sessionId, false)
        painted.delete(sessionId)
      }
      // 树节点变了（React 换了状态点元素）就近重画一次。
      watchTree(() => reconcile(readSnapshot()))
    }

    ctx.effect(() => {
      const pollHost = async () => {
        if (disposed) return
        const state = await readJSON(STATE_URL)
        if (disposed || !state || !Array.isArray(state.failed)) return
        hostFailed = new Set(state.failed.filter(sessionId => typeof sessionId === 'string'))
        reconcile(readSnapshot())
      }

      const timer = setInterval(() => {
        if (disposed) return
        reconcile(readSnapshot())
        void pollHost()
      }, POLL_MS)

      const unsubscribe = ctx.sessions.list.subscribe(() => { reconcile(readSnapshot()) })
      // 新连接代次 = 宿主重启过（首次连接也走这里；那时 runningSeen 是空的，
      // 不会误判）。三秒窗口留给紧随其后的列表刷新。
      const offReset = typeof ctx.on === 'function'
        ? ctx.on('connection/reset', () => { lastResetAt = Date.now() })
        : undefined

      reconcile(readSnapshot())
      void pollHost()

      return () => {
        disposed = true
        clearInterval(timer)
        unsubscribe?.()
        offReset?.()
        observer?.disconnect()
        observer = null
      }
    }, 'dsh-interrupted-dot: paint sidebar status dots')
  }

  return { inject: ['sessions'], apply }
}})
