// #region module-id
// 本段由 tools/sync-contract.mjs 从 package.json 的 name 生成，勿手改。
const MODULE_ID = "@deepseek-ai/dsh-client-ui-layout"
// #endregion module-id

window.__ModuleLoader__.load({ id: MODULE_ID, factory: (require) => {
  const React = require('react')
  const h = React.createElement

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
    return h('div', { className: 'launcher-shell', 'data-shell': 'launcher' },
      h('div', { className: 'launcher-rail', role: 'navigation', 'aria-label': 'launcher rail' },
        renderSlot('shell.leading', {}),
        RAIL_ENTRIES.map((entry) => h('button', {
          key: entry.id,
          type: 'button',
          className: `launcher-rail__entry${props.activeRail === entry.id ? ' on' : ''}`,
          title: entry.label,
          'aria-label': entry.label,
          'aria-pressed': props.activeRail === entry.id,
          onClick: () => props.onRail?.(entry.id),
        }, entry.label.slice(0, 1)))),
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
          paneKeys.map((key) => h('div', { key, className: 'launcher-pane', 'data-pane': key },
            renderSlot('main', key))))),
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

  function apply(ctx) {
    ensureStyle()
    // 本实现的运行时标记：verify 用它 + [data-shell] 双特征判"现在装的是哪一版 layout"，
    // 不靠容易在两侧都出现的槽标记（实测 [data-slot="sidebar"] 两态都有）。
    window.__DSH_LAUNCHER_SHELL__ = true
    // 验证句柄：真机上从 console 调 ctx.layout.selectPanel(null) 等（技术负责人 W1 尾判据第 1 条）。
    // 只读暴露，不改行为；卸载时清掉。
    window.__DSH_LAUNCHER_CTX__ = ctx
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
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
    }
  }

  // 只 inject slots：ctx.reflect 是上下文自带的属性，不是可注入的服务——
  // 把 reflect 写进 inject 会让插件等一个不存在的服务，连带 ui-sidebar/ui-chat 全 pending
  // （真机实测：`web boot: 3 required entries did not activate … waiting for service: reflect`）。
  return { inject: ['slots'], apply }
} })
