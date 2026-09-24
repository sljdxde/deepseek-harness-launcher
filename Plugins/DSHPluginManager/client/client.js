window.__ModuleLoader__.load({ id: 'dsh-plugin-manager', factory: (require) => {
  const React = require('react')
  const h = React.createElement
  const NS = 'dsh-plugin-manager'
  const css = `
/* dsh sidebar footer actions: the shell renders this slot as ONE nowrap row
   beside Settings, and every occupant claims a full width. With two occupants
   the second is laid out past the sidebar's right edge — visible in the DOM,
   clipped on screen — and the 56px rail would put them side by side. So each
   action claims its own wrapped line instead: the container wraps, every entry
   is a full-width row when the sidebar is wide, and a 36px icon button in the
   rail. Reached through the slot marker with :has() rather than the container's
   hashed CSS-module class, which is not ours to depend on; dsh-tokenledger
   states the same wrap rule, and identical declarations do not fight. */
div:has(> [data-slot='sidebar.footer.action']){flex-wrap:wrap}
.dsh-pm-trigger{align-items:center;appearance:none;background:transparent;border:0;border-radius:8px;box-sizing:border-box;color:inherit;cursor:pointer;display:flex;flex:0 0 100%;font:inherit;font-size:14px;gap:8px;line-height:22px;margin:4px -2px;min-height:42px;min-width:0;padding:0 10px 0 8px;position:relative;text-align:left}
.dsh-pm-trigger:hover{background:var(--dsw-alias-button-ghost-active-fill)}
/* Rail (56px): the shell centres every control and its own icons are 36px
   circles, so the label goes away and the button becomes one too. */
.dsh-pm-trigger.dsh-pm-trigger-rail{border-radius:50%;corner-shape:round;flex:none;height:36px;justify-content:center;margin:4px 0;min-height:36px;padding:0;width:36px}
.dsh-pm-trigger.dsh-pm-trigger-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-pm-trigger-icon{display:inline-block;flex:0 0 16px;height:16px;position:relative;width:16px}
.dsh-pm-trigger-icon:before{background:repeating-linear-gradient(0deg,currentColor 0 2px,transparent 2px 4px);border:1.75px solid currentColor;border-radius:4px;content:"";inset:0;position:absolute}
.dsh-pm-backdrop{background:rgba(15,18,24,.32);inset:0;position:fixed;z-index:2147483000}
.dsh-pm-page{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 20px 70px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;font-size:13px;left:50%;max-height:82vh;max-width:720px;position:fixed;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 32px));z-index:2147483001}
.dsh-pm-header{align-items:center;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;gap:10px;padding:0 16px;height:52px;flex:none}
.dsh-pm-back{background:transparent;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:20px;margin-left:-8px;padding:6px 10px}
.dsh-pm-back:hover{background:var(--dsw-alias-button-ghost-active-fill);color:inherit}
.dsh-pm-header strong{font-size:15px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-pm-tabs{display:flex;gap:4px;margin-left:6px}
.dsh-pm-tab{background:transparent;border:0;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:6px 12px}
.dsh-pm-tab:hover{background:var(--dsw-alias-button-ghost-active-fill)}
.dsh-pm-tab-active{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dsh-pm-header-spacer{flex:1}
.dsh-pm-tool{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:5px 10px}
.dsh-pm-tool:hover{background:var(--dsw-alias-button-ghost-active-fill);color:inherit}
.dsh-pm-tool:disabled{cursor:not-allowed;opacity:.5}
.dsh-pm-close{font-size:20px;line-height:20px}
.dsh-pm-body{flex:1;overflow-y:auto;padding:16px 18px 28px}
.dsh-pm-error{background:rgba(220,50,47,.08);border-radius:6px;color:var(--dsw-alias-state-error-primary);font-size:12px;margin-bottom:10px;padding:8px 10px}
.dsh-pm-toasts{display:flex;flex-direction:column;gap:8px;left:50%;max-width:min(520px,calc(100% - 48px));pointer-events:none;position:absolute;top:62px;transform:translateX(-50%);z-index:2147483003}
.dsh-pm-toast{align-items:flex-start;animation:dsh-pm-toast-in .18s ease-out;border-radius:10px;box-shadow:0 10px 34px rgba(0,0,0,.28);box-sizing:border-box;color:#fff;display:flex;font-size:13px;gap:10px;line-height:20px;padding:10px 14px;pointer-events:auto}
.dsh-pm-toast-success{background:#2f9e44}
.dsh-pm-toast-error{background:#d6333c}
.dsh-pm-toast-info{background:#3a6ea8}
.dsh-pm-toast-icon{flex:none;font-weight:700}
.dsh-pm-toast-text{flex:1;min-width:0;word-break:break-word}
.dsh-pm-toast-close{background:transparent;border:0;border-radius:6px;color:rgba(255,255,255,.85);cursor:pointer;font:inherit;font-size:14px;line-height:20px;padding:0 2px}
.dsh-pm-toast-close:hover{color:#fff}
@keyframes dsh-pm-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.dsh-pm-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:40px 0;text-align:center}
.dsh-pm-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.dsh-pm-check{accent-color:var(--dsw-alias-brand-primary);cursor:pointer;flex:0 0 16px;height:16px;margin:0;width:16px}
.dsh-pm-bulkbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.dsh-pm-bulkbar .dsh-pm-tool{font-size:12px;padding:4px 10px}
.dsh-pm-search{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;flex:1 1 220px;min-width:180px;padding:7px 12px}
.dsh-pm-search:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.dsh-pm-chips{display:flex;gap:6px;flex-wrap:wrap}
.dsh-pm-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:4px 12px}
.dsh-pm-chip:hover{background:var(--dsw-alias-button-ghost-active-fill)}
.dsh-pm-chip-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-pm-sort{margin-left:auto}
.dsh-pm-grid{display:flex;flex-direction:column;gap:10px}
.dsh-pm-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;cursor:pointer;display:flex;gap:12px;padding:12px 14px;width:100%}
.dsh-pm-card:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l3)}
.dsh-pm-card-icon{flex:0 0 36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:17px;background:var(--dsw-alias-bg-module-platform)}
.dsh-pm-card-main{flex:1;min-width:0}
.dsh-pm-card-title{font-size:13px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-card-author{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-card-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:6px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dsh-pm-card-side{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.dsh-pm-card-meta{display:flex;gap:10px;align-items:center;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dsh-pm-card-actions{display:flex;gap:8px;align-items:center}
.dsh-pm-install{box-sizing:border-box;background:var(--dsw-alias-button-primary-fill);border:0;border-radius:8px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:6px 14px}
.dsh-pm-install:hover{background:var(--dsw-alias-button-primary-hover)}
.dsh-pm-install:disabled{cursor:not-allowed;opacity:.6}
.dsh-pm-installed-tag{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
.dsh-pm-cat{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-pm-list{display:flex;flex-direction:column;gap:8px}
.dsh-pm-row{align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;display:flex;gap:12px;padding:12px 14px}
.dsh-pm-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-pm-row-main{flex:1;min-width:0}
.dsh-pm-row-title{font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-row-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-badge{border:1px solid var(--dsw-alias-border-l3);border-radius:4px;color:var(--dsw-alias-label-secondary);flex:none;font-size:11px;line-height:16px;padding:1px 6px}
.dsh-pm-row-action{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-state-error-primary);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:5px 10px}
.dsh-pm-row-action:hover{background:rgba(220,50,47,.1)}
.dsh-pm-row-action:disabled{cursor:not-allowed;opacity:.5}
.dsh-pm-drawer{background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-sizing:border-box;display:flex;flex-direction:column;height:100%;max-width:420px;min-width:300px;padding:18px;position:absolute;right:0;top:0;width:40%;z-index:2147483002}
.dsh-pm-drawer-head{display:flex;gap:10px;align-items:center}
.dsh-pm-drawer-title{font-size:16px;font-weight:600;line-height:22px}
.dsh-pm-drawer-close{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px;height:28px;line-height:24px;width:28px}
.dsh-pm-drawer-close:hover{background:var(--dsw-alias-button-ghost-active-fill)}
.dsh-pm-drawer-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:6px}
.dsh-pm-drawer-desc{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;margin:14px 0}
.dsh-pm-drawer-stats{display:flex;gap:14px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-pm-drawer-actions{display:flex;gap:8px;margin-top:16px}
.dsh-pm-drawer-link{color:var(--dsw-alias-brand-primary);font-size:12px;line-height:18px;text-decoration:none;display:inline-block;margin-top:12px}
.dsh-pm-confirm{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px;margin-bottom:10px}
.dsh-pm-confirm-title{font-size:13px;font-weight:600;line-height:20px}
.dsh-pm-confirm-copy{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:6px}
.dsh-pm-confirm-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.dsh-pm-confirm-actions button{border:0;border-radius:6px;cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:4px 12px}
.dsh-pm-confirm-cancel{background:var(--dsw-alias-button-ghost-fill);color:inherit}
.dsh-pm-confirm-danger{background:var(--dsw-alias-state-error-primary);color:#fff}
.dsh-pm-confirm-primary{background:var(--dsw-alias-color-accent-primary,#0a84ff);color:#fff}
.dsh-pm-confirm-actions button:disabled{cursor:not-allowed;opacity:.5}
/* 更新检测：侧边栏角标、已安装页工具栏、行内版本号/胶囊/更新按钮。
   橙色用宿主的 warn 语义色（浅色 amber-100 底 + amber-600 字，深色 amber-900 底），
   与 cordis 面板的状态胶囊同一套 token，深浅主题都不刺眼。 */
.dsh-pm-trigger-badge{align-items:center;background:var(--dsw-alias-state-warn-tertiary);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:999px;box-sizing:border-box;color:var(--dsw-alias-state-warn-label);display:inline-flex;flex:none;font-size:11px;font-variant-numeric:tabular-nums;height:16px;justify-content:center;line-height:16px;margin-left:auto;min-width:16px;padding:0 4px}
/* 56px 窄栏：角标缩到 15px 并钉在按钮右上角，按钮本身仍是 36px，不撑破轨道。 */
.dsh-pm-trigger-rail .dsh-pm-trigger-badge{font-size:10px;height:15px;margin:0;min-width:15px;padding:0 3px;position:absolute;right:0;top:0}
.dsh-pm-updates-time{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-left:auto;white-space:nowrap}
.dsh-pm-row-side{align-items:center;display:flex;flex:none;gap:8px}
.dsh-pm-row-version{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums;line-height:18px;white-space:nowrap}
.dsh-pm-row-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-update-pill{background:var(--dsw-alias-state-warn-tertiary);border:1px solid transparent;border-radius:999px;color:var(--dsw-alias-state-warn-label);flex:none;font-size:11px;line-height:16px;padding:2px 8px;white-space:nowrap}
.dsh-pm-update-pill-major{border-color:var(--dsw-alias-state-warn-primary)}
.dsh-pm-update{box-sizing:border-box;background:var(--dsw-alias-button-primary-fill);border:0;border-radius:8px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:5px 12px}
.dsh-pm-update:hover{background:var(--dsw-alias-button-primary-hover)}
.dsh-pm-update:disabled{cursor:not-allowed;opacity:.6}
/* 多选：工具栏计数、行内进度、橡皮筋框选覆盖层。 */
.dsh-pm-selected-count{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}
.dsh-pm-selectarea{min-height:52px;position:relative}
.dsh-pm-band{background:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;opacity:.22;pointer-events:none;position:absolute;z-index:3}
.dsh-pm-row-progress{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-row-selectable{cursor:pointer}`
  const CATEGORY_EMOJI = { browser: '🌐', tool: '🛠️', ui: '🎨', storage: '🗄️', workflow: '🔀', agent: '🤖', search: '🔍', data: '📊', network: '🌍', dev: '💻', other: '🧩' }

  function ensureStyles() {
    if (document.getElementById(NS + '-style')) return
    const style = document.createElement('style')
    style.id = NS + '-style'
    style.textContent = css
    document.head.appendChild(style)
  }

  function normalizeText(value) { return (value || '').toLowerCase() }

  /// Toast 队列：安装/卸载/清理/刷新等操作结果用浮层提示呈现并自动消失。
  /// 纯逻辑（计时器通过 schedule 注入），与 React 解耦，可直接单测：
  /// 成功/提示 3.2s 自动消失，失败 6s（读清错误需要更长时间）。
  function createToastStore(schedule = (fn, ms) => setTimeout(fn, ms)) {
    let nextId = 0
    let items = []
    const listeners = new Set()
    const emit = () => { for (const notify of listeners) notify(items) }
    return {
      push(kind, text) {
        const id = ++nextId
        items = [...items, { id, kind, text }]
        emit()
        schedule(() => { items = items.filter(toast => toast.id !== id); emit() }, kind === 'error' ? 6000 : 3200)
        return id
      },
      dismiss(id) { items = items.filter(toast => toast.id !== id); emit() },
      subscribe(listener) { listeners.add(listener); listener(items); return () => listeners.delete(listener) },
      snapshot: () => items,
    }
  }

  const TOAST_ICON = { success: '✓', error: '✕', info: 'ⓘ' }

  function Toasts({ store }) {
    const [items, setItems] = React.useState(store.snapshot())
    React.useEffect(() => store.subscribe(setItems), [store])
    if (items.length === 0) return null
    return h('div', { className: 'dsh-pm-toasts', role: 'status', 'aria-live': 'polite' },
      items.map(toast => h('div', { key: toast.id, className: `dsh-pm-toast dsh-pm-toast-${toast.kind}` },
        h('span', { className: 'dsh-pm-toast-icon', 'aria-hidden': true }, TOAST_ICON[toast.kind] || 'ⓘ'),
        h('span', { className: 'dsh-pm-toast-text' }, toast.text),
        h('button', { className: 'dsh-pm-toast-close', onClick: () => store.dismiss(toast.id), 'aria-label': '关闭提示' }, '×'))))
  }
  function formatNumber(value) {
    if (!value) return '0'
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
    return String(value)
  }
  function installedKey(plugin, installed) {
    const repo = normalizeText(plugin.repo)
    return installed.some(item => {
      if (item.broken) return false
      const name = normalizeText(item.name)
      return name === repo || name.endsWith('/' + repo) || (plugin.url && normalizeText(plugin.url).includes(normalizeText(item.name)))
    })
  }
  function descOf(plugin, zh) {
    if (zh && plugin.descriptionZh) return plugin.descriptionZh
    return plugin.descriptionEn || plugin.descriptionZh || ''
  }

  const UPDATES_POLL_MS = 60000
  const UPDATES_RETRY_MS = 1500
  const UPDATES_MAX_RETRIES = 20
  // 批量更新是异步受理（202）：每 2 秒读一次 /updates，最多轮询约 5 分钟。
  const UPDATES_BATCH_POLL_MS = 2000
  const UPDATES_BATCH_MAX_POLLS = 150
  const NOTE_MAX = 80

  /// 读一次更新接口。404 / 业务 error / 网络异常统一返回 null：外部 Harness 实例没有
  /// 这个接口，面板必须静默降级（不显示任何更新标记、不弹错误），而不是整个面板报错。
  function loadUpdates(options = {}) {
    return fetch(`/dsh-plugin-manager/updates${options.refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      .then(response => { if (!response.ok) throw Error(`HTTP ${response.status}`); return response.json() })
      .then(value => { if (!value || value.error) throw Error(String(value?.error || '无效响应')); return value })
      .catch(() => null)
  }

  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

  /// 读更新接口并等出结论：服务端 `refreshing: true`（首轮联网检测 / 缓存过期后台刷新）
  /// 时每 1.5s 重试一次，最多 20 次，之后拿到什么就返回什么。
  function pollUpdates(options = {}, attempt = 0) {
    return loadUpdates(options).then(value => {
      if (value && value.refreshing && attempt < UPDATES_MAX_RETRIES) return delay(UPDATES_RETRY_MS).then(() => pollUpdates(options, attempt + 1))
      return value
    })
  }

  /// 更新检测结果的小 store：侧边栏角标（PluginTrigger）与面板（PluginManagerPage）
  /// 共用同一份数据，避免两处各请求一次后互相矛盾。
  /// null = 还没读到；false = 接口不可用（降级）；对象 = 服务端返回体。
  function createUpdatesStore(initial = null) {
    let value = initial
    // 已经提示过的批量更新批次完成时间：60 秒轮询、面板重开、强制检测都会重复读到
    // 同一个 lastBatch，靠它保证汇总 toast 只弹一次。
    let announcedBatch = null
    const listeners = new Set()
    const emit = () => { for (const notify of listeners) notify(value) }
    return {
      snapshot: () => value,
      apply(next) { value = next || false; emit() },
      subscribe(listener) { listeners.add(listener); listener(value); return () => listeners.delete(listener) },
      /// 这个批次完成时间是否需要提示？是则记下来并返回 true。
      claimBatchFinish(finishedAt) {
        if (!finishedAt || finishedAt === announcedBatch) return false
        announcedBatch = finishedAt
        return true
      },
    }
  }

  /// 待更新数量：优先信服务端 summary，缺字段时退化成数 inventory。
  function updatesAvailableCount(updates) {
    if (!updates || typeof updates !== 'object') return 0
    const reported = Number(updates.summary && updates.summary.updateAvailable)
    if (reported > 0) return reported
    if (Array.isArray(updates.inventory)) return updates.inventory.filter(entry => entry && entry.status === 'update-available').length
    return 0
  }

  /// 与服务端同口径的计数（本地把条目改成「已是最新」后要重算角标）。
  function summarizeUpdates(inventory) {
    const items = Array.isArray(inventory) ? inventory : []
    return {
      total: items.length,
      updateAvailable: items.filter(item => item && item.status === 'update-available').length,
      failed: items.filter(item => item && item.status === 'failed').length,
      unknown: items.filter(item => item && item.status === 'unknown').length,
    }
  }

  /// 侧边栏角标文案：没有可更新就不渲染，超过 99 收成 99+。
  function updatesBadgeText(count) {
    const value = Number(count)
    if (!value || value <= 0) return ''
    return value > 99 ? '99+' : String(value)
  }

  function updateEntryFor(updates, name) {
    if (!updates || !Array.isArray(updates.inventory)) return null
    return updates.inventory.find(entry => entry && entry.name === name) || null
  }

  /// 已安装版本：以 /updates 的 inventory 为准，接口不可用时退回已安装列表里的 version。
  function installedVersionOf(entry, item) {
    return (entry && entry.installedVersion) || (item && item.version) || null
  }

  function updateVersionLabel(version) { return version ? `v${version}` : '—' }

  function truncateNote(text, max = NOTE_MAX) {
    const value = String(text || '')
    return value.length > max ? `${value.slice(0, max)}…` : value
  }

  /// 行内小字（次要色）：只在没有胶囊的情况下补充说明，避免同一行两处重复。
  function updateStatusNote(entry) {
    if (!entry) return null
    if (entry.status === 'up-to-date') return entry.note ? String(entry.note) : null
    if (entry.status === 'unknown') return String(entry.note || '本地来源，无法检测')
    if (entry.status === 'failed') return `检测失败：${truncateNote(entry.error || '未知原因')}`
    if (entry.status === 'ahead') return String(entry.note || '已安装版本比远端更高')
    if (entry.status === 'update-available') return entry.installedVersion ? null : String(entry.note || '无法读取已安装版本')
    return null
  }

  /// 橙色胶囊文案：跨大版本时换成更重的措辞。
  function updatePillText(entry) {
    const latest = entry && entry.latestVersion ? `v${entry.latestVersion}` : '新版本'
    return `${entry && entry.major ? '跨大版本' : '可更新到'} ${latest}`
  }

  function updateSuccessText(name, value) {
    const detail = (value && value.note) || (value && value.updatedTo ? `已更新到 v${value.updatedTo}` : '更新成功')
    return `${name} ${detail}${value && value.restartRequired ? '，重启 dsh 后生效' : ''}`
  }

  /// 「全部更新」要提交的名字：只取 status === 'update-available' 的条目。
  function updatableNames(updates) {
    if (!updates || !Array.isArray(updates.inventory)) return []
    return updates.inventory
      .filter(entry => entry && entry.status === 'update-available' && entry.name)
      .map(entry => entry.name)
  }

  /// 批量更新批次（lastBatch）结束后的汇总 toast：finishedAt 为空表示后台还在跑，不提示。
  function batchToast(batch) {
    if (!batch || !batch.finishedAt) return null
    const updated = Number(batch.updated) || 0
    const failed = Number(batch.failed) || 0
    if (failed === 0) return { kind: 'success', text: `已更新 ${updated} 个插件，重启 dsh 后生效` }
    const first = (Array.isArray(batch.results) ? batch.results : []).find(result => result && !result.ok)
    return { kind: 'error', text: `${updated} 个更新成功、${failed} 个失败：${(first && first.error) || '未知错误'}` }
  }

  /// 异步批次是否收尾：优先看 lastBatch.finishedAt 与进度字段的 active；
  /// 老服务端没有 progress 时退回「已经没有待更新项」。
  function batchSettled(value) {
    if (!value || typeof value !== 'object') return false
    if (value.lastBatch && value.lastBatch.finishedAt) return true
    if (value.progress && typeof value.progress === 'object') return value.progress.active !== true
    return updatesAvailableCount(value) === 0
  }

  /// 「更新选中」提交的名字：选中集合与 update-available 的交集。
  function selectedUpdatableNames(updates, selected) {
    if (!updates || !Array.isArray(updates.inventory) || !selected) return []
    return updates.inventory
      .filter(entry => entry && entry.status === 'update-available' && selected.has(entry.name))
      .map(entry => entry.name)
  }

  /// 正在更新的那行文案：优先用服务端的 progress.step，缺省回落到「正在下载并安装 vX…」。
  function progressStepText(entry, progress) {
    if (!progress || progress.active !== true) return null
    const step = typeof progress.step === 'string' && progress.step.trim() ? progress.step.trim() : '正在下载并安装'
    const version = entry && entry.latestVersion ? `v${entry.latestVersion}` : ''
    return `${step}${version && !step.includes(version) ? ` ${version}` : ''}…`
  }

  /// 行内进度：当前处理的那行显示步骤，其余还能更新的行显示「等待中」。
  function progressNoteFor(entry, progress, updatable) {
    if (!progress || progress.active !== true) return null
    if (entry && progress.current && progress.current === entry.name) return progressStepText(entry, progress)
    return updatable ? '等待中' : null
  }

  /// 两点 → 规范化矩形（橡皮筋框选的本地坐标）。
  function bandRect(from, to) {
    if (!from || !to) return null
    return {
      left: Math.min(from.x, to.x),
      top: Math.min(from.y, to.y),
      width: Math.abs(to.x - from.x),
      height: Math.abs(to.y - from.y),
    }
  }

  /// 两个矩形是否相交（只碰到边不算）。
  function rectsIntersect(a, b) {
    if (!a || !b) return false
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  }

  /// 橡皮筋命中的插件名：矩形与行相交即可，不可管理的行（内置/损坏）跳过。
  function namesInBand(band, rows) {
    if (!band) return []
    return (Array.isArray(rows) ? rows : [])
      .filter(row => row && row.selectable !== false && rectsIntersect(band, row.rect))
      .map(row => row.name)
  }

  /// 框选结果：Shift 拖动是与按下前的选择取并集，否则整体替换。
  function bandSelection(selected, hits, additive) {
    return additive ? new Set([...(selected || []), ...(hits || [])]) : new Set(hits || [])
  }

  /// Shift 连选：把 anchor..index 区间（可反向）内的可管理插件并入选中集合；
  /// anchor 为空时等价于「从当前行开始」，只加当前行。
  function rangeSelection(items, anchor, index, selected) {
    const list = Array.isArray(items) ? items : []
    const next = new Set(selected || [])
    const selectable = item => Boolean(item) && !item.broken && item.source !== 'bundled'
    if (anchor === null || anchor === undefined) {
      const only = list[index]
      if (selectable(only)) next.add(only.name)
      return next
    }
    const from = Math.min(Number(anchor), Number(index))
    const to = Math.max(Number(anchor), Number(index))
    for (let i = from; i <= to; i++) if (selectable(list[i])) next.add(list[i].name)
    return next
  }

  /// 更新成功后本地先把条目改成「已是最新」：角标/胶囊立刻归零，不用等服务端重新联网。
  /// 之后会再跑一次强制检测，用服务端结论覆盖这份乐观结果。
  function markPluginsUpdated(payload, results) {
    if (!payload || !Array.isArray(payload.inventory)) return payload
    const done = new Map((results || []).filter(result => result && result.ok && result.name).map(result => [result.name, result.updatedTo || null]))
    if (done.size === 0) return payload
    const inventory = payload.inventory.map(entry => {
      if (!entry || !done.has(entry.name)) return entry
      const updatedTo = done.get(entry.name) || entry.latestVersion || entry.installedVersion || null
      return { ...entry, status: 'up-to-date', installedVersion: updatedTo, latestVersion: updatedTo, major: false, note: null, error: null }
    })
    return { ...payload, inventory, summary: summarizeUpdates(inventory) }
  }

  /// 「上次检测：HH:mm」；checkedAt 为空或非法时返回空串，由调用方显示「尚未检测」。
  function formatCheckedClock(iso) {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const pad = value => String(value).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }

  /// Sidebar entry: a button that opens the plugin manager page on click.
  /// The slot renders this component in the sidebar footer, so the page itself
  /// must NOT be registered directly (it would render the full-screen modal on
  /// load and its close button would not work).
  function PluginTrigger({ wide, t, onClose }) {
    const [open, setOpen] = React.useState(false)
    // 更新结论与面板共用一份：注入后立刻读一次，之后每 60 秒读缓存刷新角标。
    const updatesStore = React.useMemo(() => createUpdatesStore(), [])
    const [updates, setUpdates] = React.useState(updatesStore.snapshot())
    React.useEffect(() => updatesStore.subscribe(setUpdates), [updatesStore])
    React.useEffect(() => {
      let alive = true
      const pull = () => loadUpdates().then(value => { if (alive) updatesStore.apply(value) })
      pull()
      const timer = setInterval(pull, UPDATES_POLL_MS)
      return () => { alive = false; clearInterval(timer) }
    }, [updatesStore])
    // Only a definite `false` is the rail: during the collapse animation the
    // shell still reports `wide`, and the row must not flip mid-flight.
    const rail = wide === false
    const count = updatesAvailableCount(updates)
    const badge = updatesBadgeText(count)
    const label = count > 0 ? `插件管理（${count} 个可更新）` : '插件管理'
    return h(React.Fragment, null,
      h('button', { type: 'button', className: rail ? 'dsh-pm-trigger dsh-pm-trigger-rail' : 'dsh-pm-trigger', onClick: () => setOpen(true), title: label, 'aria-label': label },
        h('span', { className: 'dsh-pm-trigger-icon', 'aria-hidden': true }),
        !rail && h('span', null, '插件管理'),
        badge ? h('span', { className: 'dsh-pm-trigger-badge', 'aria-hidden': true }, badge) : null),
      open ? h(PluginManagerPage, { wide, t, onClose: () => setOpen(false), store: updatesStore }) : null)
  }

  function PluginManagerPage({ wide, t, onClose, store }) {
    ensureStyles()
    const [tab, setTab] = React.useState('installed')
    const [installed, setInstalled] = React.useState([])
    const [market, setMarket] = React.useState(null)
    const [search, setSearch] = React.useState('')
    const [category, setCategory] = React.useState('all')
    const [sort, setSort] = React.useState('stars')
    const [detail, setDetail] = React.useState(null)
    const [busy, setBusy] = React.useState('')
    const [confirmUninstall, setConfirmUninstall] = React.useState(null)
    const [selected, setSelected] = React.useState(new Set())
    const [confirmBatch, setConfirmBatch] = React.useState(false)
    // 卸载成功后暂存插件名，非 null 时弹「是否立即重启 dsh」确认框。
    const [restartPrompt, setRestartPrompt] = React.useState(null)
    const [error, setError] = React.useState('')
    // 更新检测：从 PluginTrigger 注入的 store 读取（角标与面板同源）；单独渲染时自建一个。
    const updatesStore = React.useMemo(() => store || createUpdatesStore(), [store])
    const [updates, setUpdates] = React.useState(updatesStore.snapshot())
    React.useEffect(() => updatesStore.subscribe(setUpdates), [updatesStore])
    const applyUpdates = (value) => updatesStore.apply(value)
    // 多选/框选要用的宿主引用：行节点、列表区域、上次点击位置、拖拽状态。
    const [band, setBand] = React.useState(null)
    const listAreaRef = React.useRef(null)
    const rowsRef = React.useRef(new Map())
    const bandRef = React.useRef(null)
    const suppressClickRef = React.useRef(false)
    const lastIndexRef = React.useRef(null)
    const progressPollsRef = React.useRef(0)
    const installedRef = React.useRef(installed)
    installedRef.current = installed
    const toastStore = React.useMemo(() => createToastStore(), [])
    const toast = (kind, text) => toastStore.push(kind, text)
    const autoRefreshed = React.useRef(false)
    const loadInstalled = () => fetch('/dsh-plugin-manager/installed', { cache: 'no-store' })
      .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setInstalled(v.items || []); setError('') })
      .catch(e => setError(String(e.message || e)))
    const loadMarket = () => fetch('/dsh-plugin-manager/marketplace', { cache: 'no-store' })
      .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setMarket(v); setError('') })
      .catch(e => {
        // 无本地索引/索引过期时自动刷新一次，避免用户手动找「刷新市场」
        if (!autoRefreshed.current) { autoRefreshed.current = true; return refreshMarket() }
        setError(String(e.message || e)); setMarket(false)
      })
    React.useEffect(() => { loadInstalled() }, [])
    React.useEffect(() => { if (tab === 'market') loadMarket() }, [tab])
    // 打开面板立刻读一次更新缓存；服务端若正在后台刷新（首轮检测），就等它跑完再显示。
    React.useEffect(() => { pollUpdates().then(applyUpdates) }, [])
    // 异步批量更新结束（lastBatch.finishedAt）后弹一条汇总 toast；轮询、重开面板、
    // 强制检测都会重复读到同一批次，去重交给 store 的水印。
    React.useEffect(() => { if (updates && updates.lastBatch) announceBatchFinish(updates.lastBatch) }, [updates])
    // 面板在别人的批量更新中途打开（启动器或另一客户端发起）时跟随进度；
    // 自己发起的批次由 waitForBatch 轮询，这里不重复请求。最多跟 5 分钟，避免批次卡死时一直轮询。
    React.useEffect(() => {
      if (busy !== '' || !updates || !updates.progress || updates.progress.active !== true) { progressPollsRef.current = 0; return undefined }
      if (progressPollsRef.current >= UPDATES_BATCH_MAX_POLLS) return undefined
      const timer = setTimeout(() => { progressPollsRef.current += 1; loadUpdates().then(applyUpdates) }, UPDATES_BATCH_POLL_MS)
      return () => clearTimeout(timer)
    }, [updates, busy])
    // 关掉面板时结束可能还挂着的拖拽监听。
    React.useEffect(() => () => { if (bandRef.current && bandRef.current.stop) bandRef.current.stop() }, [])

    const refreshMarket = () => {
      setBusy('refresh')
      fetch('/dsh-plugin-manager/refresh', { method: 'POST' })
        .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); toast('success', `市场已刷新：${v.count} 个插件`); return loadMarket() })
        .catch(e => toast('error', `刷新市场失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }
    const install = (plugin) => {
      setBusy(plugin.id)
      fetch('/dsh-plugin-manager/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: plugin.url, name: plugin.name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '安装失败')
          if (v.alreadyInstalled) toast('info', `${plugin.name} 已安装过，无需重复安装`)
          else toast('success', `已安装 ${plugin.name}，重启 dsh 后生效`)
          setDetail(null)
          return loadInstalled()
        })
        .catch(e => toast('error', `安装失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }
    const cleanupBroken = (item) => {
      setBusy('cleanup-' + item.name)
      fetch('/dsh-plugin-manager/cleanup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: item.name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '清理失败')
          toast('success', `已清理损坏的安装 ${item.name}`)
          return loadInstalled()
        })
        .catch(e => toast('error', `清理失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }
    /// 检查更新：强制联网检测，并轮询到服务端 refreshing=false（首轮每个插件都要联网，可能几秒）。
    const checkUpdates = () => {
      setBusy('check-updates')
      pollUpdates({ refresh: true })
        .then(value => {
          applyUpdates(value)
          if (!value) return
          const count = updatesAvailableCount(value)
          toast(count > 0 ? 'info' : 'success', count > 0 ? `检测完成：${count} 个插件可更新` : '检测完成：所有插件均为最新')
        })
        .finally(() => setBusy(''))
    }
    /// 更新成功后：先本地把条目改成「已是最新」（角标/胶囊立刻归零），再跑一次强制检测，
    /// 用服务端结论覆盖——服务端缓存里还是旧结论，直接读缓存会把「可更新」又亮回来。
    const settleUpdates = (results) => {
      const ok = (results || []).filter(result => result && result.ok)
      if (ok.length === 0) return
      applyUpdates(markPluginsUpdated(updatesStore.snapshot(), ok))
      pollUpdates({ refresh: true }).then(value => { if (value) applyUpdates(value) })
    }
    /// 批量更新的汇总 toast：60 秒轮询/面板重开/强制检测都会重复读到同一个 lastBatch，
    /// 用 store 里的水印保证只弹一次。
    const announceBatchFinish = (batch) => {
      const summary = batchToast(batch)
      if (!summary) return
      if (!updatesStore.claimBatchFinish(batch.finishedAt)) return
      toast(summary.kind, summary.text)
    }
    const updateOne = (item) => {
      setBusy('update-' + item.name)
      fetch('/dsh-plugin-manager/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: item.name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '更新失败')
          toast('success', updateSuccessText(item.name, v))
          settleUpdates([{ name: item.name, ok: true, updatedTo: v.updatedTo }])
          return loadInstalled()
        })
        .catch(e => toast('error', `更新 ${item.name} 失败：${String(e.message || e)}`))
        .finally(() => setBusy(''))
    }
    /// 批量更新被异步受理：每 2 秒读一次 /updates，直到批次收尾（lastBatch/progress），最多约 5 分钟。
    /// 批次结束时把 results 里成功的条目本地改成「已是最新」，角标与胶囊立刻归零。
    const waitForBatch = (attempt = 0) => loadUpdates().then(value => {
      if (!value) { applyUpdates(null); return null }
      const batch = value.lastBatch
      const next = batch && batch.finishedAt ? markPluginsUpdated(value, (batch.results || []).filter(result => result && result.ok)) : value
      applyUpdates(next)
      if (batchSettled(value)) return next
      if (attempt >= UPDATES_BATCH_MAX_POLLS) return next
      return delay(UPDATES_BATCH_POLL_MS).then(() => waitForBatch(attempt + 1))
    })
    /// 「全部更新」与「更新选中」共用：提交 names 后走异步受理流程。
    const startBatch = (names) => {
      if (!names || names.length === 0) return
      setBusy('update-many')
      fetch('/dsh-plugin-manager/update-many', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '批量更新失败')
          // 202：更新在服务端后台顺序执行，先回「已开始」，结束后由 lastBatch 汇总。
          toast('info', `已开始更新 ${Number(v.accepted) || names.length} 个插件`)
          return waitForBatch()
        })
        .then(() => loadInstalled())
        .catch(e => toast('error', `批量更新失败：${String(e.message || e)}`))
        .finally(() => setBusy(''))
    }
    const updateAll = () => startBatch(updatableNames(updates))
    const updateSelected = () => startBatch(selectedUpdatableNames(updates, selected))
    const requestUninstall = (item) => { setError(''); setConfirmUninstall(item) }
    const confirmUninstallGo = () => {
      if (!confirmUninstall) return
      const name = confirmUninstall.name
      setBusy('uninstall'); setConfirmUninstall(null)
      fetch('/dsh-plugin-manager/uninstall', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '卸载失败')
          if (v.needsRestart) setRestartPrompt(name)
          else toast('success', `已卸载 ${name}`)
          return loadInstalled()
        })
        .catch(e => toast('error', `卸载失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }
    const restartNow = () => {
      setRestartPrompt(null)
      setBusy('restart')
      // dsh 退出后启动器会自动拉起新进程，页面随后重连。
      fetch('/dsh-plugin-manager/restart', { method: 'POST' }).catch(() => {})
      setTimeout(() => {
        toast('info', '正在重启 Deepseek Harness，页面即将自动刷新…')
        setBusy('')
      }, 400)
    }

    const manageable = installed.filter(item => !item.broken && item.source !== 'bundled')
    const selectedNames = manageable.filter(item => selected.has(item.name)).map(item => item.name)
    // 服务端进程进度（启动器的进度窗口读同一个字段）：当前处理的行显示步骤，其余待更新行「等待中」。
    const progress = updates && updates.progress && typeof updates.progress === 'object' ? updates.progress : null
    const progressActive = Boolean(progress && progress.active === true)
    const progressCurrent = progress && typeof progress.current === 'string' ? progress.current : null
    // 任何更新动作进行中都不再并发开新的（pnpm 会写同一个 profile）。
    const busyAny = busy !== ''
    const toggleSelect = (name) => {
      const next = new Set(selected)
      if (next.has(name)) next.delete(name); else next.add(name)
      setSelected(next)
    }
    const isSelectable = (item) => Boolean(item) && !item.broken && item.source !== 'bundled'
    /// 行/复选框点击：普通点击切换一个；Shift 点击按上次点击位置区间选中（追加）。
    const selectRow = (index, range) => {
      if (!isSelectable(installed[index])) return
      if (range) setSelected(rangeSelection(installed, lastIndexRef.current, index, selected))
      else toggleSelect(installed[index].name)
      lastIndexRef.current = index
    }
    /// 行的点击：按钮/复选框/链接自己处理；刚拖过橡皮筋时不再顺带切换/展开。
    const onRowClick = (event, index) => {
      if (suppressClickRef.current) return
      const target = event && event.target
      if (target && typeof target.closest === 'function' && target.closest('button, input, a')) return
      selectRow(index, Boolean(event && event.shiftKey))
    }
    /// 橡皮筋框选：在列表区域按下并拖动，实时把与矩形相交的行选上（Shift 追加而不是替换）。
    const startBand = (event) => {
      if (!event || (event.button !== undefined && event.button !== 0)) return
      const target = event.target
      if (target && typeof target.closest === 'function' && target.closest('button, input, a')) return
      const area = listAreaRef.current
      if (!area || typeof area.getBoundingClientRect !== 'function') return
      if (typeof event.preventDefault === 'function') event.preventDefault()
      const drag = {
        origin: { x: event.clientX, y: event.clientY },
        additive: Boolean(event.shiftKey),
        base: new Set(selected),
        moved: false,
      }
      const move = (moveEvent) => {
        const current = bandRef.current
        const rect = area.getBoundingClientRect()
        if (!current || !rect) return
        const box = bandRect(
          { x: current.origin.x - rect.left, y: current.origin.y - rect.top },
          { x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top })
        if (!box) return
        current.moved = current.moved || box.width > 3 || box.height > 3
        setBand(box)
        const viewport = { left: rect.left + box.left, top: rect.top + box.top, right: rect.left + box.left + box.width, bottom: rect.top + box.top + box.height }
        const rows = installedRef.current.map(item => {
          const node = rowsRef.current.get(item.name)
          return { name: item.name, selectable: isSelectable(item), rect: node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : null }
        })
        const hits = namesInBand(viewport, rows)
        setSelected(bandSelection(current.base, hits, current.additive))
      }
      const stop = () => {
        const current = bandRef.current
        bandRef.current = null
        setBand(null)
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', stop)
        // 拖过一次就不让 mouseup 顺带触发行的点击/展开；没拖动的按下等价于普通点击。
        if (current && current.moved) {
          suppressClickRef.current = true
          setTimeout(() => { suppressClickRef.current = false }, 0)
        }
      }
      drag.stop = stop
      bandRef.current = drag
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', stop)
    }
    const toggleSelectAll = () => {
      if (manageable.length > 0 && selectedNames.length === manageable.length) setSelected(new Set())
      else setSelected(new Set(manageable.map(item => item.name)))
      lastIndexRef.current = null
    }
    const toggleInvert = () => {
      const next = new Set(selected)
      manageable.forEach(item => { if (next.has(item.name)) next.delete(item.name); else next.add(item.name) })
      setSelected(next)
      lastIndexRef.current = null
    }
    const uninstallManyGo = () => {
      if (selectedNames.length === 0) return
      setBusy('uninstall-many'); setConfirmBatch(false)
      fetch('/dsh-plugin-manager/uninstall-many', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names: selectedNames }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          const failed = (v.results || []).filter(r => !r.ok)
          if (failed.length === 0) {
            toast('success', `已卸载 ${selectedNames.length} 个插件`)
            setRestartPrompt(`${selectedNames.length} 个插件`)
          } else {
            toast('error', `卸载失败：${failed.map(f => f.name).join('、')}`)
            const done = selectedNames.filter(name => !failed.some(f => f.name === name))
            if (done.length > 0) {
              toast('success', `已卸载 ${done.length} 个插件`)
              setRestartPrompt(`${done.length} 个插件`)
            }
          }
          setSelected(new Set())
          return loadInstalled()
        })
        .catch(e => toast('error', `批量卸载失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }

    const plugins = (market?.plugins || []).filter(plugin => {
      const term = normalizeText(search)
      const inTerm = !term || normalizeText(plugin.name + ' ' + plugin.repo + ' ' + plugin.descriptionEn + ' ' + plugin.descriptionZh).includes(term)
      const inCategory = category === 'all' || plugin.category === category
      return inTerm && inCategory
    })
    if (sort === 'downloads') plugins.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
    else if (sort === 'newest') plugins.sort((a, b) => String(b.addedDate || '').localeCompare(String(a.addedDate || '')))
    else plugins.sort((a, b) => (b.stars || 0) - (a.stars || 0))

    const installedRows = installed.map((item, index) => {
      const selectable = !item.broken && item.source !== 'bundled'
      // 更新检测结果按插件名对齐已安装列表；接口不可用时 entry 恒为 null，整行退回原样。
      const entry = updateEntryFor(updates, item.name)
      const updatable = Boolean(entry && entry.status === 'update-available')
      const progressNote = progressNoteFor(entry, progress, updatable)
      const note = progressNote || updateStatusNote(entry)
      const updating = busy === 'update-' + item.name || (progressActive && progressCurrent === item.name)
      return h('div', {
        className: `dsh-pm-row${selectable ? ' dsh-pm-row-selectable' : ''}`,
        key: item.name,
        ref: node => { if (node) rowsRef.current.set(item.name, node); else rowsRef.current.delete(item.name) },
        onClick: event => onRowClick(event, index),
      },
        selectable
          ? h('input', { type: 'checkbox', className: 'dsh-pm-check', checked: selected.has(item.name), onChange: event => selectRow(index, Boolean(event && event.shiftKey)), 'aria-label': '选择 ' + item.name })
          : h('span', { className: 'dsh-pm-check', 'aria-hidden': true }),
        h('div', { className: 'dsh-pm-row-main' },
          h('div', { className: 'dsh-pm-row-title' }, item.name),
          h('div', { className: 'dsh-pm-row-meta' }, item.description || '无描述'),
          note ? h('div', { className: progressNote ? 'dsh-pm-row-progress' : 'dsh-pm-row-note' }, note) : null),
        h('div', { className: 'dsh-pm-row-side' },
          h('span', { className: 'dsh-pm-row-version' }, updateVersionLabel(installedVersionOf(entry, item))),
          updatable ? h('span', { className: `dsh-pm-update-pill${entry.major ? ' dsh-pm-update-pill-major' : ''}` }, updatePillText(entry)) : null,
          updatable
            ? h('button', { className: 'dsh-pm-update', disabled: updating || busyAny, onClick: () => updateOne(item), title: `更新 ${item.name} 到 v${entry.latestVersion}` }, updating ? '更新中…' : '更新')
            : null),
        item.source === 'bundled' ? h('span', { className: 'dsh-pm-badge' }, '内置') : null,
        item.broken ? h('span', { className: 'dsh-pm-badge', style: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' } }, '损坏') : null,
        item.broken
          ? h('button', { className: 'dsh-pm-row-action', disabled: busy === 'cleanup-' + item.name, onClick: () => cleanupBroken(item), title: '清理损坏的安装残留' }, busy === 'cleanup-' + item.name ? '清理中…' : '清理')
          : item.source === 'bundled'
            ? h('button', { className: 'dsh-pm-row-action', disabled: true, title: '内置插件不可卸载' }, '—')
            : h('button', { className: 'dsh-pm-row-action', disabled: busy === 'uninstall' || busy === 'uninstall-many', onClick: () => requestUninstall(item), title: '卸载' }, '卸载'))
    })

    const marketCards = plugins.map(plugin => {
      const isInstalled = installedKey(plugin, installed)
      return h('div', { className: 'dsh-pm-card', key: plugin.id, onClick: () => setDetail(plugin) },
        h('div', { className: 'dsh-pm-card-icon' }, CATEGORY_EMOJI[plugin.category] || '🧩'),
        h('div', { className: 'dsh-pm-card-main' },
          h('div', { className: 'dsh-pm-card-title' }, plugin.repo || plugin.name),
          h('div', { className: 'dsh-pm-card-author' }, plugin.author || plugin.name),
          h('div', { className: 'dsh-pm-card-desc' }, descOf(plugin, true) || descOf(plugin))),
        h('div', { className: 'dsh-pm-card-side' },
          h('div', { className: 'dsh-pm-card-meta' },
            h('span', null, `★ ${formatNumber(plugin.stars)}`),
            h('span', null, `↓ ${formatNumber(plugin.downloads)}`),
            h('span', { className: 'dsh-pm-cat' }, plugin.category)),
          isInstalled
            ? h('span', { className: 'dsh-pm-installed-tag' }, '✓ 已安装')
            : h('button', { className: 'dsh-pm-install', disabled: busy === plugin.id, onClick: (e) => { e.stopPropagation(); install(plugin) } }, busy === plugin.id ? '安装中…' : '安装')))
    })

    const drawer = detail ? h('div', { className: 'dsh-pm-drawer' },
      h('div', { className: 'dsh-pm-drawer-head' },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'dsh-pm-drawer-title' }, detail.repo || detail.name),
          h('div', { className: 'dsh-pm-drawer-meta' }, `${detail.author || detail.name} · ${detail.category}`)),
        h('button', { className: 'dsh-pm-drawer-close', onClick: () => setDetail(null), 'aria-label': '关闭' }, '×')),
      h('div', { className: 'dsh-pm-drawer-desc' }, descOf(detail, true) || descOf(detail) || '暂无描述'),
      h('div', { className: 'dsh-pm-drawer-stats' },
        h('span', null, `★ ${detail.stars || 0}`),
        h('span', null, `下载 ${detail.downloads || 0}`),
        detail.addedDate ? h('span', null, `添加于 ${detail.addedDate}`) : null),
      h('div', { className: 'dsh-pm-drawer-actions' },
        installedKey(detail, installed)
          ? h('span', { className: 'dsh-pm-installed-tag' }, '✓ 已安装')
          : h('button', { className: 'dsh-pm-install', disabled: busy === detail.id, onClick: () => install(detail) }, busy === detail.id ? '安装中…' : '安装')),
      detail.url ? h('a', { className: 'dsh-pm-drawer-link', href: detail.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上查看 ↗') : null)
      : null

    const marketTab = h('div', null,
      market === null ? h('div', { className: 'dsh-pm-empty' }, '加载中…') :
      market === false ? h('div', { className: 'dsh-pm-empty' }, '市场数据未就绪') :
      h('div', null,
        h('div', { className: 'dsh-pm-toolbar' },
          h('input', { className: 'dsh-pm-search', placeholder: '搜索插件 / 作者 / 描述…', value: search, onChange: (e) => setSearch(e.target.value) }),
          h('div', { className: 'dsh-pm-chips' },
            ['all', ...(market.categories || [])].map(cat => h('button', { key: cat, className: `dsh-pm-chip${category === cat ? ' dsh-pm-chip-active' : ''}`, onClick: () => setCategory(cat) }, cat === 'all' ? '全部' : cat))),
          h('select', { className: 'dsh-pm-sort', value: sort, onChange: (e) => setSort(e.target.value), style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '12px', padding: '5px 8px' } },
            h('option', { value: 'stars' }, '按 ★ 排序'),
            h('option', { value: 'downloads' }, '按下载量'),
            h('option', { value: 'newest' }, '按最新'))),
        market.plugins.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '暂无插件') :
        marketCards.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '没有匹配的插件') :
        h('div', { className: 'dsh-pm-grid' }, marketCards)))

    // 更新工具栏：接口不可用（updates === false）时整条不渲染，静默降级成原来的已安装页。
    const clock = formatCheckedClock(updates && updates.checkedAt)
    const checking = busy === 'check-updates'
    const updatingAll = busy === 'update-many'
    // 服务端进程也在跑批次（别人的批量更新）时，按钮同样进入「更新中…」并禁用。
    const batchRunning = updatingAll || progressActive
    const selectedUpdatable = selectedUpdatableNames(updates, selected)
    // 检测/批量更新都在后台跑，面板要能关掉（批量更新可能几分钟）；安装/卸载仍锁住。
    const closable = !busy || checking || updatingAll
    const updatesBar = updates === false ? null : h('div', { className: 'dsh-pm-toolbar' },
      h('button', { className: 'dsh-pm-tool', disabled: checking || batchRunning || busyAny && !checking, onClick: checkUpdates, title: '联网检测每个已安装插件的远端版本' }, checking ? '检测中…' : '检查更新'),
      h('button', { className: 'dsh-pm-tool', disabled: updatesAvailableCount(updates) === 0 || batchRunning || checking || busyAny, onClick: updateAll, title: '更新所有可更新的插件' }, batchRunning ? '更新中…' : '全部更新'),
      h('button', { className: 'dsh-pm-tool', disabled: selectedUpdatable.length === 0 || batchRunning || checking || busyAny, onClick: updateSelected, title: '只更新选中且可更新的插件' }, '更新选中'),
      h('span', { className: 'dsh-pm-selected-count' }, `已选 ${selectedNames.length} 个`),
      h('button', { className: 'dsh-pm-tool', disabled: selectedNames.length === 0, onClick: () => { setSelected(new Set()); lastIndexRef.current = null }, title: '清空选择' }, '取消选择'),
      h('span', { className: 'dsh-pm-updates-time' }, clock ? `上次检测：${clock}` : '尚未检测'))

    return h('div', null,
      h('div', { className: 'dsh-pm-backdrop', onClick: () => { if (closable) { onClose() } } }),
      h('div', { className: 'dsh-pm-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件管理' },
        h(Toasts, { store: toastStore }),
        h('div', { className: 'dsh-pm-header' },
          h('button', { className: 'dsh-pm-back', onClick: () => { if (closable) onClose() }, 'aria-label': '返回' }, '← 返回'),
          h('strong', null, '插件管理'),
          h('div', { className: 'dsh-pm-tabs' },
            h('button', { className: `dsh-pm-tab${tab === 'installed' ? ' dsh-pm-tab-active' : ''}`, onClick: () => setTab('installed') }, `已安装${installed.length ? ` (${installed.length})` : ''}`),
            h('button', { className: `dsh-pm-tab${tab === 'market' ? ' dsh-pm-tab-active' : ''}`, onClick: () => setTab('market') }, '插件市场')),
          h('div', { className: 'dsh-pm-header-spacer' }),
          tab === 'market' ? h('button', { className: 'dsh-pm-tool', disabled: busy === 'refresh', onClick: refreshMarket }, busy === 'refresh' ? '刷新中…' : '刷新市场') : null,
          h('button', { className: 'dsh-pm-tool dsh-pm-close', onClick: () => { if (closable) onClose() }, 'aria-label': '关闭' }, '×')),
        h('div', { className: 'dsh-pm-body' },
          error && h('div', { className: 'dsh-pm-error' }, error),
          confirmUninstall && h('div', { className: 'dsh-pm-confirm' },
            h('div', { className: 'dsh-pm-confirm-title' }, `确认卸载 ${confirmUninstall.name}？`),
            h('div', { className: 'dsh-pm-confirm-copy' }, '卸载后需要重启 dsh 才能生效。'),
            h('div', { className: 'dsh-pm-confirm-actions' },
              h('button', { className: 'dsh-pm-confirm-cancel', onClick: () => setConfirmUninstall(null), disabled: busy === 'uninstall' }, '取消'),
              h('button', { className: 'dsh-pm-confirm-danger', onClick: confirmUninstallGo, disabled: busy === 'uninstall' }, busy === 'uninstall' ? '卸载中…' : '确认卸载'))),
          confirmBatch && h('div', { className: 'dsh-pm-confirm' },
            h('div', { className: 'dsh-pm-confirm-title' }, `确认卸载选中的 ${selectedNames.length} 个插件？`),
            h('div', { className: 'dsh-pm-confirm-copy' }, '卸载后需要重启 dsh 才能生效。'),
            h('div', { className: 'dsh-pm-confirm-actions' },
              h('button', { className: 'dsh-pm-confirm-cancel', onClick: () => setConfirmBatch(false), disabled: busy === 'uninstall-many' }, '取消'),
              h('button', { className: 'dsh-pm-confirm-danger', onClick: uninstallManyGo, disabled: busy === 'uninstall-many' }, busy === 'uninstall-many' ? '卸载中…' : '确认卸载'))),
          restartPrompt && h('div', { className: 'dsh-pm-confirm' },
            h('div', { className: 'dsh-pm-confirm-title' }, `已卸载 ${restartPrompt}`),
            h('div', { className: 'dsh-pm-confirm-copy' }, '侧边栏入口会在重启 dsh 后消失。是否立即重启？'),
            h('div', { className: 'dsh-pm-confirm-actions' },
              h('button', { className: 'dsh-pm-confirm-cancel', onClick: () => setRestartPrompt(null) }, '稍后'),
              h('button', { className: 'dsh-pm-confirm-primary', onClick: restartNow, disabled: busy === 'restart' }, busy === 'restart' ? '重启中…' : '立即重启'))),
          tab === 'installed'
            ? h('div', null,
                updatesBar,
                installed.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '还没有已安装的插件，去插件市场看看吧')
                  : h('div', null,
                      h('div', { className: 'dsh-pm-bulkbar' },
                        h('button', { className: 'dsh-pm-tool', onClick: toggleSelectAll }, manageable.length > 0 && selectedNames.length === manageable.length ? '取消全选' : '全选'),
                        h('button', { className: 'dsh-pm-tool', onClick: toggleInvert }, '反选'),
                        h('button', { className: 'dsh-pm-tool', disabled: selectedNames.length === 0 || busy === 'uninstall-many', onClick: () => setConfirmBatch(true), style: selectedNames.length > 0 ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined }, `批量卸载${selectedNames.length ? ` (${selectedNames.length})` : ''}`)),
                      // 拖拽框选：在这块区域按下并拖动，实时把相交的行选上。
                      h('div', { className: 'dsh-pm-selectarea', ref: listAreaRef, onMouseDown: startBand },
                        h('div', { className: 'dsh-pm-list' }, installedRows),
                        band ? h('div', { className: 'dsh-pm-band', style: { height: `${band.height}px`, left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px` } }) : null)))
            : marketTab,
          drawer)))
  }

  function apply(ctx) {
    ensureStyles()
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: NS, order: 60, label: '插件管理' }, PluginTrigger))
  }
  // createToastStore / createUpdatesStore 与更新检测的纯函数仅为单测导出（vm 加载后可取用），
  // 宿主只消费 inject/apply。
  return {
    inject: ['slots', 'locale'],
    apply,
    createToastStore,
    createUpdatesStore,
    updatesAvailableCount,
    updatesBadgeText,
    updateEntryFor,
    installedVersionOf,
    updateVersionLabel,
    updateStatusNote,
    updatePillText,
    updateSuccessText,
    updatableNames,
    batchToast,
    batchSettled,
    selectedUpdatableNames,
    progressStepText,
    progressNoteFor,
    bandRect,
    rectsIntersect,
    namesInBand,
    bandSelection,
    rangeSelection,
    markPluginsUpdated,
    summarizeUpdates,
    formatCheckedClock,
    loadUpdates,
    pollUpdates,
  }
}})
