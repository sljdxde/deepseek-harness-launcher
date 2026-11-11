window.__ModuleLoader__.load({ id: "dsh-session-notify", factory: () => {
  const COMMANDS_URL = '/dsh-session-notify/commands'
  const CLAIM_URL = '/dsh-session-notify/commands/claim'
  const ACK_URL = '/dsh-session-notify/commands/ack'
  const BYE_URL = '/dsh-session-notify/presence/bye'
  const POLL_MS = 750

  function clientId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    return `dsh-session-notify-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  async function readJSON(url, options = {}) {
    try {
      const response = await fetch(url, { cache: 'no-store', ...options })
      if (!response.ok) return null
      return await response.json()
    } catch {
      return null
    }
  }

  function hasSession(snapshot, sessionId) {
    if (!snapshot || (snapshot.phase !== undefined && snapshot.phase !== 'ready')) return false
    if (Array.isArray(snapshot.ids)) return snapshot.ids.includes(sessionId)
    return Boolean(snapshot.byId && Object.prototype.hasOwnProperty.call(snapshot.byId, sessionId))
  }

  function focusPage() {
    // The launcher can activate the browser app without selecting a tab. A
    // background Harness page is therefore still allowed to consume its
    // command and may ask the browser to focus this page. Browsers can reject
    // that request; the session navigation remains useful either way.
    try {
      if (typeof window?.focus === 'function') window.focus()
    } catch {
      // Focusing a background tab is best-effort and must never break polling.
    }
  }

  function pageIsVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  }

  /** 页面是否真的在用户眼前（可见且拿到焦点）。 */
  function pageHasFocus() {
    if (typeof document === 'undefined') return true
    if (typeof document.hasFocus === 'function') return document.hasFocus()
    return pageIsVisible()
  }

  /**
   * 这个页面是不是启动器的内置 WKWebView（或 Safari 这类非 Chromium 浏览器）。
   *
   * 主要靠 UA：WKWebView 是 Safari 风格（AppleWebKit，无 Chrome/Chromium），
   * Chrome 系（包括 chrome-devtools-mcp 拉起的自动化实例）UA 一定带 Chrome/。
   * 若页面注册了 WK 消息处理器也直接认。区分它是因为 `document.hasFocus()`
   * 在 macOS 上对「后面的 Chrome 窗口」会撒谎：实测启动器在最前时，后台
   * Chrome 页面仍报 hasFocus true，于是它冒充「用户正在看」，把菜单栏的
   * 完成提醒瞬间撤销。
   */
  function pageLooksEmbedded() {
    try {
      if (typeof window === 'undefined') return false
      if (window.__DHL_EMBEDDED__ === true) return true
      if (window.webkit && window.webkit.messageHandlers) return true
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
      return /AppleWebKit/.test(ua) && !/Chrome\//.test(ua) && !/Chromium\//.test(ua)
    } catch {
      return false
    }
  }

  /**
   * 外部浏览器页面的「最近真实用户操作」时间戳。
   *
   * 只认 `isTrusted` 的指针/键盘/滚轮/触摸事件：自动化脚本（Runtime.evaluate、
   * 合成事件）不会刷新它。后台自动化标签页因此不能把用户的完成提醒标成已读。
   */
  const GESTURE_TRUST_MS = 10 * 60 * 1000
  /**
   * 领取「打开会话」命令的信任窗口：比「正在看」更短。点菜单栏里的完成提醒时，
   * 用户的手在启动器上，后台 Chrome 标签页不该抢走跳转命令——否则命令被执行在
   * 看不见的窗口里，用户看到的就是「点了没反应」。
   */
  const CLAIM_GESTURE_TRUST_MS = 2 * 60 * 1000
  let lastUserGestureAt = 0
  function markUserGesture(event) {
    if (event && event.isTrusted) lastUserGestureAt = Date.now()
  }
  const GESTURE_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']

  /**
   * 用户此刻正在看的会话：主视图里 `retainedBy.mainView > 0` 的那一个（宿主 UI
   * 判断「当前会话」用的也是这个字段），并且只在本页面可见且有焦点时才算数——
   * 甩到后台的标签页不该把它当年看过的会话钉成已读。
   *
   * 外部浏览器（非 WKWebView）还要求最近 10 分钟内有真实用户操作：单靠
   * `document.hasFocus()` 挡不住后台的自动化 Chrome 标签页（见 pageLooksEmbedded）。
   * @param snapshot - `ctx.sessions.list` 的快照。
   * @returns 会话 id；没有在看任何会话时返回空串。
   */
  /**
   * 这个页面有没有资格领取跳转命令。
   *
   * 内置 WKWebView 永远有资格（它就是用户面前的 Harness 窗口）。外部 Chrome
   * 页面必须最近有真实用户操作：`document.hasFocus()` 会谎报（后台 Chrome
   * 窗口也返回 true），只靠它会让自动化标签页抢走跳转命令。
   */
  function canClaimCommands() {
    if (pageLooksEmbedded()) return true
    return Date.now() - lastUserGestureAt <= CLAIM_GESTURE_TRUST_MS
  }

  function viewingSession(snapshot) {
    if (!pageIsVisible() || !pageHasFocus()) return ''
    if (!pageLooksEmbedded() && Date.now() - lastUserGestureAt > GESTURE_TRUST_MS) return ''
    for (const row of Object.values(snapshot?.byId ?? {})) {
      if (row && typeof row.id === 'string' && (row.retainedBy?.mainView ?? 0) > 0) return row.id
    }
    return ''
  }

  /** Diagnostics only: a failed jump must leave a trace instead of vanishing. */
  function warn(...args) {
    try {
      globalThis.console?.warn?.(...args)
    } catch {
      // Logging must never break polling.
    }
  }

  /**
   * Select a Session in the Harness UI — the same action as clicking that
   * session's sidebar row, which brings its Conversation (and Workspace) to the
   * main view. The Session controller (`ctx.sessions`) has no navigation entry
   * point at all: the Workspace controller service `uiWorkspace` owns the
   * action (`openSession(target)`). It is looked up through `ctx.get` because a
   * dynamic client package may reach a service it did not declare in `inject`.
   * @param ctx - client plugin context.
   * @param sessionId - target Session identity.
   * @returns whether a navigation was requested.
   */
  function openSession(ctx, sessionId) {
    const workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
    if (!workspace || typeof workspace.openSession !== 'function') return false
    workspace.openSession(sessionId)
    return true
  }

  function apply(ctx) {
    const id = clientId()
    ctx.effect(() => {
      let disposed = false
      let polling = false

      const poll = async () => {
        if (disposed || polling) return
        const snapshot = ctx.sessions.list.getSnapshot()
        if (!snapshot || (snapshot.phase !== undefined && snapshot.phase !== 'ready')) return
        polling = true
        try {
          // The clientId doubles as a presence heartbeat: the server marks
          // this page alive on every poll so the launcher can tell "browser
          // has a keep-alive socket" apart from "a Harness page is open".
          // `viewing` piggybacks on the same poll: the launcher retracts the
          // completion reminder of whatever session the user is looking at
          // ("看过即已读"), without a second request per 750ms.
          // `visible` tells the launcher whether this tab is on screen: when
          // AppleScript cannot address the connected browser instance (another
          // Chrome instance was launched later), "bring the browser forward"
          // alone does nothing if the user switched to another tab — the
          // launcher must open a new tab in that instance instead.
          const visibility = pageIsVisible() ? 1 : 0
          const feed = await readJSON(`${COMMANDS_URL}?clientId=${encodeURIComponent(id)}&viewing=${encodeURIComponent(viewingSession(snapshot))}&visible=${visibility}&embedded=${pageLooksEmbedded() ? 1 : 0}`)
          if (disposed || !Array.isArray(feed?.items)) return
          // 不是用户正在操作的外部 Chrome 页面：不要领取跳转命令，留给内置窗口。
          if (!canClaimCommands()) return
          for (const item of feed.items) {
            if (!item?.commandId || !item.sessionId || !hasSession(ctx.sessions.list.getSnapshot(), item.sessionId)) continue
            const claimed = await readJSON(CLAIM_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              // `focused`：命令刚入队的一小段窗口里只允许焦点页面领取。另一个
              // 浏览器实例里的 Harness 页面可能也「可见」（窗口在后面），但它
              // 没有焦点——让它先领走，会话就会切在用户看不见的窗口里，表现
              // 成「浏览器前置了却还是旧会话」。
              body: JSON.stringify({ commandId: item.commandId, clientId: id, visible: pageIsVisible(), focused: pageHasFocus(), embedded: pageLooksEmbedded() }),
            })
            const command = claimed?.command
            if (!command || disposed) continue
            let navigated = false
            try {
              focusPage()
              navigated = openSession(ctx, command.sessionId)
              focusPage()
            } catch (error) {
              // Swallowing this is what made a broken jump look exactly like a
              // successful one: the command was acknowledged and the page
              // stayed on its old session, with nothing written anywhere.
              warn('[dsh-session-notify] 打开会话失败', command.sessionId, error)
            }
            if (!navigated) {
              warn('[dsh-session-notify] 当前 Harness 客户端没有会话跳转入口，未能定位', command.sessionId)
            }
            await readJSON(ACK_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ commandId: command.commandId, clientId: id }),
            })
            break
          }
        } finally {
          polling = false
        }
      }

      const timer = setInterval(() => { void poll() }, POLL_MS)
      const unsubscribe = ctx.sessions.list.subscribe(() => { void poll() })
      // Tell the launcher instantly when this page goes away (tab/window
      // closed, navigation). Presence also expires through the poll TTL, so
      // a hard-killed browser cannot block fresh page opens for long.
      const markBye = () => {
        try {
          navigator.sendBeacon(BYE_URL, new Blob([JSON.stringify({ clientId: id })], { type: 'application/json' }))
        } catch {
          // Best-effort: presence also expires through the poll TTL.
        }
      }
      // Real browsers always provide these; guard anyway so constrained
      // environments (test sandboxes) still get the polling behavior.
      const canListen = typeof window?.addEventListener === 'function'
      if (canListen) {
        window.addEventListener('pagehide', markBye)
        window.addEventListener('beforeunload', markBye)
      }
      // Report tab visibility changes immediately instead of waiting for the
      // next 750ms tick (and, once backgrounded, for the browser's timer
      // throttling): the launcher decides at click time whether a new tab is
      // needed, so a stale "visible" would make it just activate the browser
      // and leave the user on the wrong tab.
      const canWatchVisibility = typeof document?.addEventListener === 'function'
      const onVisibilityChange = () => { void poll() }
      if (canWatchVisibility) document.addEventListener('visibilitychange', onVisibilityChange)
      // 真实用户操作心跳：外部浏览器页面只有最近操作过才允许上报「正在看」。
      if (canWatchVisibility) {
        for (const type of GESTURE_EVENTS) document.addEventListener(type, markUserGesture, { capture: true, passive: true })
      }
      void poll()
      return () => {
        disposed = true
        clearInterval(timer)
        unsubscribe?.()
        if (canWatchVisibility) {
          document.removeEventListener('visibilitychange', onVisibilityChange)
          for (const type of GESTURE_EVENTS) document.removeEventListener(type, markUserGesture, { capture: true, passive: true })
        }
        if (canListen) {
          window.removeEventListener('pagehide', markBye)
          window.removeEventListener('beforeunload', markBye)
        }
      }
    }, 'dsh-session-notify: open session commands')
  }

  return { inject: ['sessions'], apply }
}})
