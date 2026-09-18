window.__ModuleLoader__.load({ id: "dsh-session-notify", factory: () => {
  const COMMANDS_URL = '/dsh-session-notify/commands'
  const CLAIM_URL = '/dsh-session-notify/commands/claim'
  const ACK_URL = '/dsh-session-notify/commands/ack'
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
          const feed = await readJSON(COMMANDS_URL)
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
            try {
              focusPage()
              ctx.sessions.open(command.sessionId)
              focusPage()
            } catch {
              // An old or external Harness can lack the session runtime. The
              // launcher has already opened the page, so silently finish here.
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
      void poll()
      return () => {
        disposed = true
        clearInterval(timer)
        unsubscribe?.()
      }
    }, 'dsh-session-notify: open session commands')
  }

  return { inject: ['sessions'], apply }
}})
