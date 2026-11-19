// #region module-id
// 本段由 tools/sync-contract.mjs 从 package.json 的 name 生成，勿手改。
const MODULE_ID = "@deepseek-ai/dsh-client-ui-layout"
// #endregion module-id

window.__ModuleLoader__.load({ id: MODULE_ID, factory: (require) => {
  const React = require('react')
  const h = React.createElement
  let CURRENT_CTX = null

  // #region children-from-contract
  // 本段由 tools/sync-contract.mjs 从 lib/contract.js 生成，勿手改；
  // 漂移由 test/contract.test.mjs 的同步检查挡住。
  const CHILDREN = {
    "sidebar": { kind: "single", scope: 'root' },
    "main": { kind: "keyed", scope: 'root' },
    "rightbar": { kind: "single", scope: 'root' },
    "shell.bottom": { kind: "single", scope: 'root' },
    "shell.overlay": { kind: "list", scope: 'root' },
    "shell.leading": { kind: "single", scope: 'root' },
  }
  const LAYOUT_FACE_MEMBERS = ["panelInfo","selectPanel","beginNavigation","toggleSidebar","openRightbar","closeRightbar"]
  const RAIL_ENTRIES = [{"id":"conversation","label":"会话","icon":"message-circle"},{"id":"plugins","label":"插件","icon":"puzzle"},{"id":"schedules","label":"计划任务","icon":"calendar"},{"id":"approvals","label":"待审批","icon":"shield-check"},{"id":"settings","label":"设置","icon":"settings"}]
  const MODE_LABELS = {"readonly":"只读","ask":"每次询问","auto-safe":"自动批准安全命令","full":"全自动"}
  const statusText = function statusText({ page, mode, running = 0, queued = 0 } = {}) {
  const runs = Math.max(0, Math.round(Number(running) || 0))
  const waiting = Math.max(0, Math.round(Number(queued) || 0))
  const parts = []
  if (runs > 0) parts.push(`${runs} 个任务在跑`)
  if (waiting > 0) parts.push(`排队 ${waiting}`)
  return {
    page: typeof page === 'string' && page.length > 0 ? page : '会话',
    mode: MODE_LABELS[mode] ?? MODE_LABELS['auto-safe'],
    running: parts.join(' · '),
  }
}
  // #endregion children-from-contract

  const CSS = `
.launcher-shell{--launcher-rail:56px;--launcher-sidebar:280px;--launcher-status:26px;--launcher-dock:0px;
  background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary);
  display:grid;grid-template-rows:1fr var(--launcher-status);
  grid-template-columns:var(--launcher-rail) var(--launcher-sidebar) minmax(0,1fr) var(--launcher-dock);
  grid-template-areas:"rail sidebar main dock" "status status status status";
  height:100vh;width:100vw;overflow:hidden}
.launcher-rail{grid-area:rail;align-items:center;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));display:flex;flex-direction:column;gap:6px;padding:8px 0;min-height:0}
.launcher-rail__entry{align-items:center;background:transparent;border:0;border-radius:10px;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;display:flex;flex:none;font:inherit;font-size:13px;height:36px;justify-content:center;width:36px}
.launcher-rail__entry:hover{background:var(--dsw-alias-button-floating-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary)}
.launcher-rail__entry.on{background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.18));color:var(--dsw-alias-label-primary)}
.launcher-sidebar{grid-area:sidebar;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));min-height:0;overflow:hidden}
.launcher-main{container-type:inline-size;display:flex;flex-direction:column;min-width:0;min-height:0;grid-area:main;container-type:inline-size;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.launcher-dock{position:relative;grid-area:dock;border-left:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));min-height:0;overflow:hidden;display:flex;flex-direction:column}
.launcher-splitbar{display:flex;gap:2px;padding:2px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.launcher-splitbar__mode{font:inherit;font-size:11px;padding:1px 6px;border-radius:4px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;opacity:.7}
.launcher-splitbar__mode.on{opacity:1;border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.launcher-panes{flex:1;min-height:0;display:grid;gap:1px;grid-template-columns:repeat(var(--split-cols,1),minmax(0,1fr));grid-template-rows:repeat(var(--split-rows,1),minmax(0,1fr))}
.launcher-pane{min-width:0;min-height:0;overflow:auto}
@container (max-width: 760px){.launcher-panes{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:repeat(var(--split-rows,1),minmax(0,1fr))}}
.launcher-palette{position:fixed;inset-inline:0;top:12vh;margin:auto;width:min(560px,92vw);max-height:60vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-1,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);z-index:50;overflow:hidden}
.launcher-palette__input{font:inherit;padding:10px 12px;border:0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));outline:none;background:transparent;color:inherit}
.launcher-palette__list{list-style:none;margin:0;padding:4px;overflow:auto}
.launcher-palette__item{display:flex;justify-content:space-between;gap:12px;padding:6px 10px;border-radius:6px;cursor:pointer}
.launcher-palette__item.off{opacity:.45;cursor:not-allowed}
.launcher-palette__item.on{background:var(--dsw-alias-bg-2,rgba(127,127,127,.12))}
.launcher-palette__hint{opacity:.6;font-size:11px}
.launcher-shell[data-code-wrap="off"] pre, .launcher-shell[data-code-wrap="off"] pre code{white-space:pre!important;overflow-x:auto}
.launcher-shell[data-code-wrap="on"] pre code{white-space:pre-wrap!important;word-break:break-word}
.launcher-diag{position:fixed;right:16px;bottom:40px;width:min(340px,90vw);background:var(--dsw-alias-bg-1,#fff);color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;box-shadow:0 10px 28px rgba(0,0,0,.18);z-index:45}
.launcher-diag__head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.launcher-diag__list{margin:0;padding:8px 10px;display:grid;gap:6px;font-size:12px}
.launcher-diag__list div{display:flex;justify-content:space-between;gap:12px}
.launcher-diag__list dt{opacity:.7}
.launcher-diag__list dd{margin:0}
.launcher-dock__handle{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;background:transparent;z-index:2}
.launcher-dock__handle:hover{background:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.launcher-statusbar{grid-area:status;align-items:center;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));display:flex;font-size:11px;gap:10px;padding:0 10px;color:var(--dsw-alias-label-secondary)}
.launcher-overlay{position:fixed;inset:0;pointer-events:none;z-index:40}
.launcher-overlay>*{pointer-events:auto}
.launcher-conflict{border-bottom:1px solid var(--dsw-alias-state-warn-border,#d9a441);background:var(--dsw-alias-state-warn-fill,#fff6e0);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;padding:6px 12px;position:sticky;top:0;z-index:50}
`

  function ensureStyle() {
    if (document.getElementById('dsh-launcher-style') !== null) return
    const tag = document.createElement('style')
    tag.id = 'dsh-launcher-style'
    tag.textContent = CSS
    document.head.appendChild(tag)
  }

  /** 面板选中的最小观测面（ui-sidebar 的 usePanelInfo 读它决定哪条高亮）。 */
  function createPanelInfo() {
    let snapshot = { activePanelId: null }
    const listeners = new Set()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set: (id) => {
        const next = { activePanelId: id === undefined ? null : id }
        if (next.activePanelId === snapshot.activePanelId) return
        snapshot = next
        for (const listener of listeners) listener()
      },
    }
  }

  /**
   * 从宿主命令源枚举命令（05 §6.5 要求动态枚举，不许硬编码）。接口形状不保证稳定，
   * 取不到就返回空表，面板显示「未接入命令源」。
   * @param {object} ctx - 客户端上下文。
   * @returns {{ id: string, label: string, hint?: string, run?: Function, command?: string }[]} 命令清单。
   */
  /**
   * 我们自己的 catalog 行（与 lib/command-palette.js 的 ownCatalogRows 同口径）。
   * client 是 loader 形态不能 import lib，这里内联同一套规则；单测在 lib 侧覆盖。
   * @param {object} ctx - 客户端上下文。
   * @returns {object[]} catalog 行。
   */
  /**
   * 按候选 key 解析 main 面板真 key（05 写死口径）：`ctx.slots.entries('main')` 里第一个命中的。
   * 解析不到返回 null —— 调用方置灰，不许 throw。
   * @param {object} ctx - 客户端上下文。
   * @param {string[]} candidates - 候选 key。
   * @returns {string|null} 真 key。
   */
  function resolveMainKey(ctx, candidates) {
    try {
      const entries = ctx?.slots?.entries?.('main') ?? []
      const keys = entries.map((entry) => entry?.options?.key).filter((key) => typeof key === 'string')
      for (const key of candidates) if (keys.includes(key)) return key
    } catch {
      /* 解析失败按未解析处理 */
    }
    return null
  }

  // 调宿主命令 resolve 用普通上下文：插件 ctx 是代理，读未 inject 的属性会抛
  // `cannot get property "target" without inject`（实测）
  const MENU_CONTEXT = { region: 'page', modal: null, source: 'menu' }

  const RAIL_CANDIDATES = {
    conversation: ['conversation'],
    schedules: ['dsh-schedule', 'schedule', 'schedules'],
    approvals: ['dsh-approvals', 'approvals'],
    settings: ['dsh-settings', 'settings'],
    plugins: ['dsh-plugin-manager', 'plugin-manager'],
  }

  /** FR-43 #7：代码块自动换行开关（根属性 + localStorage，不改宿主接口）。 */
  const CODE_WRAP_KEY = 'dsh.launcher.codeWrap'
  function codeWrapOn() {
    try {
      return window.localStorage.getItem(CODE_WRAP_KEY) === 'off' ? false : true
    } catch {
      return true
    }
  }
  function applyCodeWrap(on) {
    try {
      window.localStorage.setItem(CODE_WRAP_KEY, on ? 'on' : 'off')
    } catch {
      /* 无 localStorage 时只影响本次会话 */
    }
  }
  function setCodeWrapPref(on) {
    try {
      window.localStorage.setItem(CODE_WRAP_KEY, on ? 'on' : 'off')
    } catch {
      /* 无 localStorage 时只影响本次会话 */
    }
  }

  /**
   * FR-39/42/43：把三个动作注册进真槽（`conversation.chat.assistant-actions` / `conversation.chat.turnTail`）。
   * 用 `ctx.slots.inject(槽名, () => register(...))`：槽在才注册、返回同步 dispose。
   * 渲染验证需要有会话的环境，这里只做注册（按钮点了派发事件，由宿主/外壳后续接）。
   * @param {object} ctx - 客户端上下文。
   * @returns {Function[]} dispose 列表。
   */
  /**
   * FR-39/42/43：三个会话动作（真槽注册）。
   * **默认不注册**：等有会话环境的真渲染验证过再开（`window.__DSH_LAUNCHER_TURN_ACTIONS__ === true`）。
   * 按钮必须真有行为，否则就是"假执行"（05 §6.5：假执行比不提供更糟）。
   */
  function registerTurnActions(ctx) {
    if (typeof window === 'undefined' || window.__DSH_LAUNCHER_TURN_ACTIONS__ !== true) return []
    const disposers = []

    // 导出：生成 Markdown 并触发下载（不依赖宿主接口）
    const downloadExport = (turn) => {
      const index = Number.isFinite(turn?.turnIndex) && turn.turnIndex > 0 ? Math.trunc(turn.turnIndex) : 1
      const text = typeof turn?.text === 'string' && turn.text.length > 0 ? turn.text : '（这一轮没有可导出的文本）'
      const body = `## ${turn?.role === 'assistant' ? '助手' : '用户'}\n\n${text}\n`
      try {
        const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `turn-${index}-${Date.now()}.md`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 导出失败', error)
      }
    }

    // 上下文查看：有锚点就滚过去高亮；没有就固定文案告知（不静默）
    const viewInContext = (turn) => {
      const anchor = turn?.anchorId === undefined ? null : document.getElementById(String(turn.anchorId))
      if (anchor !== null) {
        anchor.scrollIntoView({ block: 'center', behavior: 'smooth' })
        anchor.classList.add('launcher-turn-highlight')
        setTimeout(() => anchor.classList.remove('launcher-turn-highlight'), 1600)
        return
      }
      window.dispatchEvent(new CustomEvent('launcher:turn-action', { detail: { id: 'launcher.viewInContext', message: '上下文视图暂无该轮锚点，已停留在当前会话' } }))
    }

    const rows = [
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.export', order: 20, label: '导出本轮', onClick: downloadExport },
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.viewInContext', order: 30, label: '在上下文视图中查看此轮', onClick: viewInContext },
      { slot: 'conversation.chat.turnTail', id: 'launcher.usage', order: 40, label: '每轮用量', usage: true },
    ]

    for (const row of rows) {
      try {
        const Component = (slotProps) => {
          const turn = slotProps?.turn ?? {}
          if (row.usage === true) {
            // 每轮用量：取不到 tokens 就不渲染（不显示空壳）
            const tokens = slotProps?.usage?.tokens ?? slotProps?.tokens
            if (!Number.isFinite(tokens)) return null
            return h('span', { className: 'launcher-turn-action launcher-turn-action--usage' }, `${tokens} tokens`)
          }
          return h('button', {
            type: 'button',
            className: 'launcher-turn-action',
            'data-action': row.id,
            title: row.label,
            onClick: () => row.onClick(turn),
          }, row.label)
        }
        if (typeof ctx?.slots?.inject === 'function') {
          disposers.push(ctx.slots.inject(row.slot, () => ctx.slots.register({
            name: row.slot,
            id: row.id,
            order: row.order,
            inject: () => ({}),
          }, Component)))
        }
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 注册会话动作失败', row.id, error)
      }
    }
    return disposers.filter((d) => typeof d === 'function')
  }


  function ownCatalogRowsFor(ctx) {
    // 判定放在 resolve() 里现算：注册时 `ctx.slots.entries('main')` 里目标面板可能还没注册
    const currentPage = () => {
      try {
        return ctx?.layout?.panelInfo?.getSnapshot?.().activePanelId ?? 'conversation'
      } catch {
        return 'conversation'
      }
    }
    const onPage = () => {
      const page = currentPage()
      return page === null || page === undefined || page === 'conversation' || page === 'plugins'
    }
    const keyReady = () => resolveMainKey(ctx, RAIL_CANDIDATES.plugins) !== null
    const runWorkbench = () => {
      const key = resolveMainKey(ctx, RAIL_CANDIDATES.plugins)
      if (key !== null) ctx.layout?.selectPanel?.(key)
    }
    const resolveWorkbench = () => (onPage() && keyReady() ? { status: 'handled', run: runWorkbench } : { status: 'pass' })
    const wrapReady = () => onPage()
    return [
      { id: 'launcher.contextDiagnostics', label: '上下文诊断', hint: '只读：外壳与上下文状态', regions: ['page'], aliases: [], resolve: () => (wrapReady() ? { status: 'handled', run: () => window.dispatchEvent(new CustomEvent('launcher:open-diagnostics')) } : { status: 'pass' }) },
      { id: 'launcher.codeWrap.toggle', label: '切换代码块自动换行', hint: '开/关长代码横向滚动', regions: ['page', 'editable'], aliases: [], resolve: () => (wrapReady() ? { status: 'handled', run: () => window.dispatchEvent(new CustomEvent('launcher:toggle-code-wrap')) } : { status: 'pass' }) },
      { id: 'launcher.pluginWorkbench', label: '打开插件工作台', hint: '插件页（plugin:<id>）', regions: ['page', 'editable'], aliases: [], resolve: resolveWorkbench },
    ]
  }


  function collectCommands(ctx) {
    // 05 §6.5 实测口径：条目源 = ctx.shortcuts.registry.commands（Map）。
    // catalog.getSnapshot() 只是键位展示（无 regions/resolve），不能用。
    const registry = ctx?.shortcuts?.registry
    const map = registry?.commands
    if (!(map instanceof Map)) return []
    const out = []
    const seen = new Set()
    for (const cmd of map.values()) {
      if (cmd === null || typeof cmd !== 'object') continue
      const id = cmd.id
      if (typeof id !== 'string' || id.length === 0) continue
      const rawLabel = typeof cmd.label === 'function' ? cmd.label() : cmd.label
      const label = typeof rawLabel === 'string' ? rawLabel : id
      const regions = Array.isArray(cmd.regions) ? cmd.regions : []
      if (!regions.some((region) => region === 'page' || region === 'editable')) continue
      const modals = Array.isArray(cmd.modals) ? cmd.modals : []
      if (modals.length > 0 && regions.length === 0) continue
      if (seen.has(id)) continue
      seen.add(id)
      let disabled = false
      try {
        const verdict = cmd.resolve?.(MENU_CONTEXT)
        disabled = !(verdict === 'handled' || verdict?.status === 'handled')
      } catch {
        disabled = true
      }
      out.push({ id, label, hint: typeof cmd.hint === 'string' ? cmd.hint : cmd.description, disabled, command: cmd })
    }
    return out
  }




  /** 外壳本体：56 图标栏 + 侧栏列 + 主区 + 右栏轨道 + 底状态条 + 浮层。 */
  function LauncherRoot(props) {
    const renderSlot = props.renderSlot
    const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
    // 标准 props 是选择器钩子（SnapshotSelectorHook），必须带 selector 调用，
    // 直接 useDockOpen() 会报 `selector is not a function` 并把 root 整个打崩。
    const dockOpen = props.useDockOpen === undefined ? false : props.useDockOpen((open) => open)
    const status = () => statusText({ page: props.statusPage, mode: props.statusMode, running: props.statusRunning, queued: props.statusQueued })
    // W3：拖拽把手 + canShow 接线。宽度只改 CSS 变量，不重绘右栏内容。
    const [dragWidth, setDragWidth] = React.useState(DOCK_WIDTH)
    const [splitMode, setSplitMode] = React.useState(1)
    // 宿主 MainPanel 的口径：面板 key 是 renderSlot 的第三参 `{ entryKey }`，
    // 当前面板从 usePanelInfo 选择器钩子取（我们自己在 inject 里提供了这个钩子）。
    const hostPolicy = (() => {
      try {
        return ctx?.permissions?.getSnapshot?.()?.filePolicy ?? ctx?.policy?.getSnapshot?.()?.filePolicy
      } catch {
        return undefined
      }
    })()
    const permissionLabel = (() => {
      const level = ['danger-full-access', 'workspace-write', 'read'].includes(hostPolicy) ? hostPolicy : 'workspace-write'
      return { 'danger-full-access': '完全权限', 'workspace-write': '工作区内修改', read: '仅可查看' }[level]
    })()
    const activePanelId = props.usePanelInfo === undefined
      ? null
      : props.usePanelInfo((info) => info.activePanelId)
    const ctx = CURRENT_CTX
    const commands = collectCommands(ctx)
    const [paletteOpen, setPaletteOpen] = React.useState(false)
    const [diagOpen, setDiagOpen] = React.useState(false)
    const [wrapOn, setWrapOn] = React.useState(codeWrapOn)
    // #1 焦点回位：打开面板时记住当时的活动元素，Esc 时优先还给它（选择器只作兜底）
    const openerRef = React.useRef(null)
    React.useEffect(() => {
      const open = () => setDiagOpen(true)
      const flip = () => setWrapOn((on) => { setCodeWrapPref(!on); return !on })
      window.addEventListener('launcher:open-diagnostics', open)
      window.addEventListener('launcher:toggle-code-wrap', flip)
      return () => {
        window.removeEventListener('launcher:open-diagnostics', open)
        window.removeEventListener('launcher:toggle-code-wrap', flip)
      }
    }, [])
    const onDiagKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setDiagOpen(false) }
    }
    const [paletteIndex, setPaletteIndex] = React.useState(0)
    const [query, setQuery] = React.useState('')
    const shown = commands.filter((cmd) => query === '' || String(cmd.label).includes(query))
    const [cols, rows] = SPLIT_GRID[splitMode] ?? SPLIT_GRID[1]
    const paneKeys = Array.from({ length: splitMode }, (_, i) => (i === 0 ? 'conversation' : `conversation#${i + 1}`))
    const dockCanShow = dockOpen && viewportWidth >= DOCK_HIDE_BELOW
    const dockWidth = dockCanShow ? dragWidth : 0
    const startDrag = (event) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = dragWidth
      const move = (e) => setDragWidth(clampDock(startWidth - (e.clientX - startX)))
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    const collapsed = props.sidebarCollapsed === true
    const runCommand = (cmd) => {
      setPaletteOpen(false)
      setQuery('')
      try {
        const verdict = cmd.command?.resolve?.(MENU_CONTEXT)
        if (verdict !== 'handled' && verdict?.status !== 'handled') return
        const run = verdict?.run ?? cmd.command?.run
        if (typeof run === 'function') run()
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 命令执行失败', error)
      }
    }
    const onKeyDown = (event) => {
      const isPaletteKey = (event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k'
      if (isPaletteKey) {
        event.preventDefault()
        if (!paletteOpen) openerRef.current = document.activeElement
        setPaletteOpen((open) => !open)
        setPaletteIndex(0)
        return
      }
      if (!paletteOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setPaletteOpen(false)
        // Esc 焦点回位：UX 口径是回到 composer 输入框（05-§4.2 / FR-06）
        requestAnimationFrame(() => {
          const opener = openerRef.current
          if (opener !== null && opener.isConnected !== false && typeof opener.focus === 'function') {
            opener.focus()
            return
          }
          // 兜底：composer 可能是 input / textarea / contenteditable，别只猜 textarea
          const fallback = document.querySelector(
            '[data-slot="main"] textarea, [data-slot="main"] input, [data-slot="main"] [contenteditable="true"], .launcher-main textarea, .launcher-main input, .launcher-main [contenteditable="true"]',
          )
          fallback?.focus?.()
        })
        return
      }
      if (event.key === 'ArrowDown') { event.preventDefault(); setPaletteIndex((i) => (shown.length === 0 ? 0 : (i + 1) % shown.length)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setPaletteIndex((i) => (shown.length === 0 ? 0 : (i - 1 + shown.length) % shown.length)) }
      if (event.key === 'Enter' && shown[paletteIndex] !== undefined) { event.preventDefault(); runCommand(shown[paletteIndex]) }
    }
    return h('div', {
      className: 'launcher-shell',
      'data-shell': 'launcher',
      // 05 §6.3-7：属性挂外壳根，不挂 documentElement（避免改到宿主自己的代码块）
      'data-code-wrap': wrapOn ? 'on' : 'off',
      onKeyDown,
    },
      h('div', { className: 'launcher-rail', role: 'navigation', 'aria-label': 'launcher rail' },
        renderSlot('shell.leading', {}),
        RAIL_ENTRIES.map((entry) => {
          const railKey = entry.id === 'conversation'
            ? 'conversation'
            : resolveMainKey(ctx, RAIL_CANDIDATES[entry.id] ?? [entry.id])
          return h('button', {
          key: entry.id,
          type: 'button',
          className: `launcher-rail__entry${props.activeRail === entry.id ? ' on' : ''}`,
          title: entry.label,
          'aria-label': entry.label,
          'aria-pressed': props.activeRail === entry.id,
          // 05 口径：点击前先 resolveMainKey(候选)；解析不到 → 置灰（aria-disabled + title），不许 throw
        'aria-disabled': railKey === null,
        title: entry.id === 'plugins'
          ? (railKey === null ? '插件工作台本版未接' : '插件工作台')
          : (railKey === null
            ? (entry.id === 'approvals' ? '见 设置 → 审批与权限' : '本版未接')
            : entry.label),
        onClick: () => {
          if (railKey === null) return
          try {
            ctx?.layout?.selectPanel?.(entry.id === 'conversation' ? null : railKey)
          } catch (error) {
            console.warn('dsh-client-ui-launcher: 导航失败', error)
          }
        },
        }, entry.label.slice(0, 1))
        })),
      h('aside', { className: 'launcher-sidebar' },
        collapsed ? null : renderSlot('sidebar', { collapsed, width: 280, drawer: false })),
      h('main', {
        className: 'launcher-main',
        'data-split': splitMode,
        style: { '--split-cols': cols, '--split-rows': rows },
      },
        h('div', { className: 'launcher-splitbar', role: 'toolbar', 'aria-label': '分屏档位' },
          SPLIT_MODES.map((mode) => h('button', {
            key: mode,
            type: 'button',
            className: `launcher-splitbar__mode${splitMode === mode ? ' on' : ''}`,
            'aria-pressed': splitMode === mode,
            onClick: () => setSplitMode(mode),
          }, String(mode)))),
        h('div', { className: 'launcher-panes' },
          paneKeys.map((key, index) => h('div', {
            key,
            className: 'launcher-pane',
            // 第一格反映真实 entryKey（断言用），其余格是分屏占位 key
            'data-pane': index === 0 ? (activePanelId ?? 'conversation') : key,
          },
            index === 0
              ? renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })
              : renderSlot('main', {}, { entryKey: key }))))),
      h('aside', {
        className: 'launcher-dock',
        style: { '--launcher-dock': `${dockWidth}px` },
        'data-dock-width': dockWidth,
      },
        dockWidth > 0
          ? [
            h('div', {
              key: 'handle',
              className: 'launcher-dock__handle',
              role: 'separator',
              'aria-orientation': 'vertical',
              'aria-label': '右栏宽度（拖拽 320–520）',
              onPointerDown: startDrag,
              onDoubleClick: () => setDragWidth(DOCK_WIDTH),
            }),
            renderSlot('rightbar', { width: dockWidth, viewportWidth, canShow: dockCanShow }),
          ]
          : null),
      h('footer', { className: 'launcher-statusbar' },
        h('span', { className: 'launcher-statusbar__page' }, status().page),
        h('span', { className: 'launcher-statusbar__mode' }, status().mode),
        h('span', { className: 'launcher-statusbar__running' }, status().running),
        renderSlot('shell.bottom', {})),
      h('div', { className: 'launcher-overlay' },
        renderSlot('shell.overlay', {})),
      diagOpen ? h('div', { className: 'launcher-diag', role: 'dialog', 'aria-label': '上下文诊断', onKeyDown: onDiagKeyDown },
        h('header', { className: 'launcher-diag__head' },
          h('span', null, '上下文诊断'),
          h('button', { type: 'button', onClick: () => setDiagOpen(false), 'aria-label': '关闭诊断' }, '✕')),
        h('dl', { className: 'launcher-diag__list' },
          h('div', null, h('dt', null, '当前面板'), h('dd', null, String(activePanelId ?? 'conversation'))),
          h('div', null, h('dt', null, '分屏档位'), h('dd', null, String(splitMode))),
          h('div', null, h('dt', null, '右栏宽度'), h('dd', null, `${dockWidth}px${dockCanShow ? '' : '（隐藏）'}`)),
          h('div', null, h('dt', null, '代码块换行'), h('dd', null, codeWrapOn() ? '开' : '关')),
          h('div', null, h('dt', null, '权限范围'), h('dd', null, permissionLabel)))) : null,
      paletteOpen ? h('div', { className: 'launcher-palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' },
        h('input', {
          className: 'launcher-palette__input',
          placeholder: '搜索命令…',
          autoFocus: true,
          onKeyDown,
          value: query,
          onChange: (e) => { setQuery(e.target.value); setPaletteIndex(0) },
          'aria-controls': 'launcher-palette-list',
        }),
        h('ul', { id: 'launcher-palette-list', role: 'listbox', className: 'launcher-palette__list' },
          shown.length === 0 ? h('li', { className: 'launcher-palette__empty' }, '未接入命令源（宿主命令表待接线）') : null,
          shown.map((cmd, index) => h('li', {
            key: cmd.id,
            role: 'option',
            'aria-selected': index === paletteIndex,
            className: `launcher-palette__item${index === paletteIndex ? ' on' : ''}${cmd.disabled ? ' off' : ''}`,
            'aria-disabled': cmd.disabled === true,
            onClick: () => { if (cmd.disabled !== true) runCommand(cmd) },
            onMouseEnter: () => setPaletteIndex(index),
          }, h('span', { className: 'launcher-palette__label' }, cmd.label),
             h('span', { className: 'launcher-palette__hint' }, cmd.hint))))) : null,
    )
  }

  /** 已有声明方时的一条页内提示（§4.2-2：最坏是原生界面 + 提示，不是白屏）。 */
  function showConflict(detail) {
    if (typeof document === 'undefined' || document.body === null) return
    const existing = document.getElementById('launcher-conflict')
    if (existing !== null) return
    const bar = document.createElement('div')
    bar.id = 'launcher-conflict'
    bar.className = 'launcher-conflict'
    bar.textContent = '检测到 ui-layout 仍在启用，新外壳未接管（界面为原生布局）。' + (detail === undefined ? '' : `（${detail}）`)
    document.body.prepend(bar)
  }

  const DOCK_WIDTH = 380
  // 与 lib/layout.js 的 DOCK 保持一致（client 侧不 import，避免加载顺序耦合）
  const DOCK_MIN = 320
  const DOCK_MAX = 520
  const DOCK_HIDE_BELOW = 1020
  const clampDock = (w) => Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(w)))
  // 与 lib/panes.js 的 GRID 一致：1/2/4/6 档 → 行列
  const SPLIT_GRID = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2] }
  const SPLIT_MODES = [1, 2, 4, 6]
  // W5 命令清单**动态枚举**：由接线方（clientRoot 包装层）从宿主命令源取；取不到就是空表，
  // 面板显示「未接入命令源」——不拿硬编码清单充数（05 §6.5 TC-16-3/16-6）。

  function apply(ctx) {
    ensureStyle()
    // 本实现的运行时标记：verify 用它 + [data-shell] 双特征判"现在装的是哪一版 layout"，
    // 不靠容易在两侧都出现的槽标记（实测 [data-slot="sidebar"] 两态都有）。
    window.__DSH_LAUNCHER_SHELL__ = true
    // 验证句柄：真机上从 console 调 ctx.layout.selectPanel(null) 等（技术负责人 W1 尾判据第 1 条）。
    // 只读暴露，不改行为；卸载时清掉。
    window.__DSH_LAUNCHER_CTX__ = ctx
    CURRENT_CTX = ctx
    // FR-39/42/43：会话流动作（真槽，槽在才注册）
    const turnDisposers = registerTurnActions(ctx)
    // FR-16：我们自己的动作也注册进同一个 catalog（与宿主条目同权）
    const OWN_ROWS_REGISTERED = Symbol.for('dsh.launcher.catalogRows')
    if (typeof ctx?.shortcuts?.register === 'function') {
      const rows = ownCatalogRowsFor(ctx)
      try {
        const register = ctx.shortcuts?.register
        if (typeof register === 'function') {
          rows.forEach((row) => register.call(ctx.shortcuts, {
            ...row,
            label: typeof row.label === 'function' ? row.label : () => row.label,
            aliases: [],
            modals: [],
            defaults: {},
          }))
          window.__DSH_LAUNCHER_OWN_ROWS__ = rows.length
        }
      } catch (error) {
        console.warn('dsh-client-ui-launcher: 注册 catalog 行失败', error)
      }
    }
    const panelInfo = createPanelInfo()
    // 右栏轨道宽度是外壳的活，但显隐由 ctx.layout.openRightbar/closeRightbar 记账
    // （ui-sidebar-right 用这两个动作），所以它得是一个能订阅的小观测面。
    let dockOpen = false
    const dockListeners = new Set()
    const dockHook = {
      getSnapshot: () => dockOpen,
      subscribe: (listener) => {
        dockListeners.add(listener)
        return () => dockListeners.delete(listener)
      },
    }
    const setDockOpen = (next) => {
      if (next === dockOpen) return
      dockOpen = next
      for (const listener of dockListeners) listener()
    }
    // 上游 AppFrame 注册时带 foldedLandscape（窄窗折起），占据者可能会取 useFoldedLandscape；
    // 不 provide 会留下"required 未激活"的下一个坑，所以照带。
    let foldedLandscape = typeof window !== 'undefined' && window.innerWidth < 900
    const foldedListeners = new Set()
    const foldedHook = {
      getSnapshot: () => foldedLandscape,
      subscribe: (listener) => {
        foldedListeners.add(listener)
        return () => foldedListeners.delete(listener)
      },
    }
    const syncFolded = () => {
      const next = typeof window !== 'undefined' && window.innerWidth < 900
      if (next === foldedLandscape) return
      foldedLandscape = next
      for (const listener of foldedListeners) listener()
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', syncFolded)
    }
    const disposers = []
    try {
      // 面板选中的观测面：ui-sidebar 用 usePanelInfo(info => info.activePanelId === id) 决定高亮。
      disposers.push(ctx.slots.provideRoot({ hooks: { panelInfo } }))
      // 服务的对外面：本仓插件 inject 'layout' 并调用 selectPanel(null)。
      // 同一个 panelInfo 对象同时喂 provideRoot 与 ctx.layout：两份源会出现"切了面板侧栏不亮"。
      const face = {
        panelInfo,
        // 只接受已注册的 main key；未注册 throw 且保留原选择；null 永远合法。
        selectPanel: (id) => {
          if (id === null || id === undefined) {
            panelInfo.set(null)
            return
          }
          const registered = ctx.slots.entries('main').some((entry) => entry?.options?.key === id)
          if (!registered) throw new Error(`launcher: main key 未注册：${String(id)}`)
          panelInfo.set(id)
        },
        beginNavigation: () => new AbortController().signal,
        // 不碰列宽：侧栏的收起/展开与列宽求解是外壳自己的事（W2），布局服务面只暴露动作。
        toggleSidebar: () => {},
        // 由右栏占据者调用（track=false 表示全屏覆盖，不占主区轨道）
        openRightbar: (track) => setDockOpen(track !== false),
        closeRightbar: () => setDockOpen(false),
      }
      if (face.panelInfo !== panelInfo) throw new Error('launcher: panelInfo 必须是同一个对象')
      disposers.push(ctx.reflect.provide('layout', face))
      disposers.push(ctx.slots.register({
        name: 'root',
        children: CHILDREN,
        inject: () => ({ hooks: { dockOpen: dockHook, foldedLandscape: foldedHook } }),
      }, LauncherRoot))
    } catch (error) {
      // 不带半个服务面接管：服务面任一步失败就整段撤销、不注册 root，退回原生外壳 + 提示条。
      // 半个服务面会让 plugin-manager / archive-manager 静默消失（10、11c 专查这一条）。
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch { /* 撤销期的失败不再向上抛 */ }
      }
      disposers.length = 0
      const detail = String(error?.message ?? error).slice(0, 160)
      showConflict(detail.includes('already') ? detail : `layout 服务未接管，已回原生外壳（${detail}）`)
      console.warn('dsh-client-ui-launcher: 未接管 root 槽', error)
    }
    return () => {
      window.__DSH_LAUNCHER_SHELL__ = false
      if (window.__DSH_LAUNCHER_CTX__ === ctx) delete window.__DSH_LAUNCHER_CTX__
      if (typeof window.removeEventListener === 'function') window.removeEventListener('resize', syncFolded)
      // 会话动作的 dispose 只释放一次（之前被外层循环重复调用）
      for (const turnDispose of turnDisposers) {
        try { turnDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
    }
  }

  // 只 inject slots：ctx.reflect 是上下文自带的属性，不是可注入的服务——
  // 把 reflect 写进 inject 会让插件等一个不存在的服务，连带 ui-sidebar/ui-chat 全 pending
  // （真机实测：`web boot: 3 required entries did not activate … waiting for service: reflect`）。
  return { inject: ['slots', 'shortcuts'], apply }
} })
