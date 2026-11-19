window.__ModuleLoader__.load({ id: 'dsh-client-ui-launcher', factory: (require) => {
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
  // #endregion children-from-contract

  const CSS = `
.launcher-shell{--launcher-rail:56px;--launcher-sidebar:280px;--launcher-status:26px;--launcher-dock:0px;
  background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary);
  display:grid;grid-template-rows:1fr var(--launcher-status);
  grid-template-columns:var(--launcher-rail) var(--launcher-sidebar) minmax(0,1fr) var(--launcher-dock);
  grid-template-areas:"rail sidebar main dock" "status status status status";
  height:100vh;width:100vw;overflow:hidden}
.launcher-rail{grid-area:rail;align-items:center;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));display:flex;flex-direction:column;gap:6px;padding:8px 0;min-height:0}
.launcher-sidebar{grid-area:sidebar;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));min-height:0;overflow:hidden}
.launcher-main{grid-area:main;container-type:inline-size;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
.launcher-dock{grid-area:dock;border-left:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));min-height:0;overflow:hidden;display:flex;flex-direction:column}
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
    const dockOpen = props.useDockOpen === undefined ? false : props.useDockOpen()
    const dockWidth = dockOpen ? DOCK_WIDTH : 0
    const collapsed = props.sidebarCollapsed === true
    return h('div', { className: 'launcher-shell', 'data-shell': 'launcher' },
      h('div', { className: 'launcher-rail', role: 'navigation', 'aria-label': 'launcher rail' },
        renderSlot('shell.leading', {})),
      h('aside', { className: 'launcher-sidebar' },
        collapsed ? null : renderSlot('sidebar', { collapsed, width: 280, drawer: false })),
      h('main', { className: 'launcher-main' },
        renderSlot('main', 'conversation')),
      h('aside', { className: 'launcher-dock' },
        dockWidth > 0 ? renderSlot('rightbar', { width: dockWidth, viewportWidth, canShow: true }) : null),
      h('footer', { className: 'launcher-statusbar' },
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

  function apply(ctx) {
    ensureStyle()
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
    const disposers = []
    try {
      // 面板选中的观测面：ui-sidebar 用 usePanelInfo(info => info.activePanelId === id) 决定高亮。
      disposers.push(ctx.slots.provideRoot({ hooks: { panelInfo } }))
      // 服务的对外面：本仓插件 inject 'layout' 并调用 selectPanel(null)。
      disposers.push(ctx.reflect.provide('layout', {
        panelInfo,
        selectPanel: (id) => panelInfo.set(id ?? null),
        beginNavigation: () => new AbortController().signal,
        toggleSidebar: () => {},
        // track=false 表示全屏覆盖，不占主区轨道；两种都不改变主区宽度以外的排版
        openRightbar: (track) => setDockOpen(track !== false),
        closeRightbar: () => setDockOpen(false),
      }))
      disposers.push(ctx.slots.register({
        name: 'root',
        children: CHILDREN,
        inject: () => ({ hooks: { dockOpen: dockHook } }),
      }, LauncherRoot))
    } catch (error) {
      // 两个声明方同时注册 root：不抛白屏，退回原生界面 + 一条提示。
      showConflict(String(error?.message ?? error).slice(0, 160))
      console.warn('dsh-client-ui-launcher: 未接管 root 槽', error)
    }
    return () => {
      for (const dispose of disposers.reverse()) {
        try { dispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
    }
  }

  return { inject: ['slots', 'reflect'], apply }
} })
