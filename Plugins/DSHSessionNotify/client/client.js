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
   * 用户此刻正在看的会话：主视图里 `retainedBy.mainView > 0` 的那一个（宿主 UI
   * 判断「当前会话」用的也是这个字段），并且只在本页面可见且有焦点时才算数——
   * 甩到后台的标签页不该把它当年看过的会话钉成已读。
   * @param snapshot - `ctx.sessions.list` 的快照。
   * @returns 会话 id；没有在看任何会话时返回空串。
   */
  function viewingSession(snapshot) {
    if (!pageIsVisible() || !pageHasFocus()) return ''
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
          const feed = await readJSON(`${COMMANDS_URL}?clientId=${encodeURIComponent(id)}&viewing=${encodeURIComponent(viewingSession(snapshot))}`)
          if (disposed || !Array.isArray(feed?.items)) return
          for (const item of feed.items) {
            if (!item?.commandId || !item.sessionId || !hasSession(ctx.sessions.list.getSnapshot(), item.sessionId)) continue
            const claimed = await readJSON(CLAIM_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ commandId: item.commandId, clientId: id, visible: pageIsVisible() }),
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
      void poll()
      return () => {
        disposed = true
        clearInterval(timer)
        unsubscribe?.()
        if (canListen) {
          window.removeEventListener('pagehide', markBye)
          window.removeEventListener('beforeunload', markBye)
        }
      }
    }, 'dsh-session-notify: open session commands')
  }

  return { inject: ['sessions'], apply }
}})
