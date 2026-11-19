// #region module-id
// 本段由 tools/sync-contract.mjs 从 package.json 的 name 生成，勿手改。
const MODULE_ID = "@deepseek-ai/dsh-client-ui-layout"
// #endregion module-id

window.__ModuleLoader__.load({ id: MODULE_ID, factory: (require) => {
  const React = require('react')
  const h = React.createElement
  // 由 tools/sync-contract.mjs 按 package.json 版本 + git 短 sha 生成（页面 data-build 用它）
  const BUILD_STAMP = "0.2.2-rc.5+0ebe6ae"
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

  // 与 lib/new-session.js 的 STARTERS 逐条对齐（text 是整句：只填入、不发送）；
  // 漂移由 test/new-session.test.mjs 的同步检查挡住。
  const STARTERS = [
    { id: 'explore', label: '看仓库结构', text: '帮我看一下这个仓库的结构，先说值得注意的地方。' },
    { id: 'test', label: '跑一遍测试', text: '跑一遍测试，失败的和跳过的分开说。' },
    { id: 'split-tasks', label: '拆成任务卡', text: '把这件事拆成几张能并行的任务卡，写清依赖顺序。' },
    { id: 'resume', label: '接着上次的活', text: '接着上次没做完的活继续，先说上次停在哪。' },
  ]

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
.launcher-pane{min-width:0;min-height:0;overflow:auto;display:flex;flex-direction:column}
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
.launcher-ctx{position:relative;display:inline-flex}
.launcher-ctx__entry{height:26px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:13px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.launcher-ctx__entry[data-pct^="9"]{border-color:var(--dsw-alias-warning,#d97706)}
.launcher-ctx__pop{min-width:200px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-1,#fff);z-index:1000;box-shadow:0 10px 28px rgba(0,0,0,.18)}
.launcher-ctx__head{font-size:12px;margin-bottom:6px}
.launcher-ctx__list{margin:0;padding:0;display:grid;gap:4px;font-size:12px}
.launcher-ctx__list div{display:flex;justify-content:space-between;gap:12px}
.launcher-ctx__list dt{opacity:.7}
.launcher-ctx__list dd{margin:0}
.launcher-perm{position:relative;display:inline-flex;align-items:center}
.launcher-perm__pill{height:26px;display:inline-flex;align-items:center;gap:4px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:13px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.launcher-perm__pill[disabled]{opacity:.6;cursor:not-allowed}
.launcher-perm__menu{position:absolute;bottom:calc(100% + 6px);left:0;min-width:180px;padding:4px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:8px;background:var(--dsw-alias-bg-1,#fff);z-index:40}
.launcher-perm__item{display:block;width:100%;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.launcher-perm__item.on{background:var(--dsw-alias-bg-2,rgba(127,127,127,.12))}
@container (max-width: 640px){.launcher-perm__text{display:none}.launcher-perm__pill{padding:0 6px}}
.launcher-dock-summary{font-size:12px;opacity:.75}
.launcher-model-chip{font-size:12px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:10px;opacity:.85}
.launcher-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:rgba(20,20,20,.9);color:#fff;font-size:12px;z-index:60;pointer-events:none}
.launcher-turn-action{display:inline-flex;align-items:center;gap:4px;height:28px;max-width:100%;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;border-radius:6px;padding:0 8px;font:inherit;font-size:12px;cursor:pointer}
.launcher-turn-action__label{white-space:nowrap}
@media (max-width: 420px){.launcher-turn-action{padding:0 6px;min-width:24px;justify-content:center}.launcher-turn-action__label{display:none}}
.launcher-turn-highlight{outline:2px solid var(--dsw-alias-accent,#4c8dff);outline-offset:2px;border-radius:6px}
.launcher-diag__list{margin:0;padding:8px 10px;display:grid;gap:6px;font-size:12px}
.launcher-diag__list div{display:flex;justify-content:space-between;gap:12px}
.launcher-diag__list dt{opacity:.7}
.launcher-diag__list dd{margin:0}
.launcher-dock__handle{position:absolute;left:0;top:0;bottom:0;width:8px;cursor:col-resize;background:transparent;z-index:30;touch-action:none}
.launcher-dock__handle:hover{background:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.launcher-statusbar{grid-area:status;align-items:center;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));display:flex;font-size:11px;gap:10px;padding:0 10px;color:var(--dsw-alias-label-secondary)}
.launcher-overlay{position:fixed;inset:0;pointer-events:none;z-index:40}
.launcher-overlay>*{pointer-events:auto}
.launcher-pane{position:relative;display:flex;flex-direction:column;min-height:0}
@media (max-width: 860px){
  .launcher-shell{grid-template-columns:var(--launcher-rail) 0 minmax(0,1fr) 0}
  .launcher-sidebar{position:fixed;left:var(--launcher-rail);top:0;bottom:var(--launcher-status);width:280px;z-index:30;background:var(--dsw-alias-bg-base,var(--dsw-alias-bg-layer-1,#fff));border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));box-shadow:0 0 0 100vmax rgba(0,0,0,.001)}
  .launcher-sidebar[data-drawer="closed"]{display:none}
  .launcher-shell .launcher-rail__drawer{display:inline-flex}
  .launcher-main{min-width:0}
}
.launcher-theme-chip{margin-left:auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:transparent;color:inherit;border-radius:6px;font-size:12px;line-height:1;padding:2px 6px;cursor:pointer}
.launcher-rail__dock{display:inline-flex;align-items:center;justify-content:center;width:100%;height:32px;border:0;background:transparent;color:inherit;cursor:pointer;font-size:15px}
.launcher-rail__drawer{display:none;align-items:center;justify-content:center;width:100%;height:32px;border:0;background:transparent;color:inherit;cursor:pointer;font-size:15px}
.launcher-panel-back{flex:0 0 auto;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}
.launcher-panel-back__btn{border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;opacity:.8}
.launcher-empty{position:static;flex:0 0 auto;z-index:auto;align-items:center;display:flex;justify-content:center;min-height:0;max-height:260px;overflow:auto;padding:16px 16px 8px;background:transparent}
.launcher-pane__host{display:flex;flex:1 1 0;min-height:0;flex-direction:column;overflow:hidden}
.launcher-empty__card{display:flex;flex-direction:column;gap:10px;margin:auto;width:100%}
.launcher-empty__theme{align-items:center;background:var(--dsw-alias-interactive-bg-hover-solid,rgba(127,127,127,.14));border-radius:12px;color:var(--dsw-alias-label-secondary,#666);display:flex;font-size:13px;font-weight:600;height:40px;justify-content:center;width:40px}
.launcher-empty__title{font-size:19px;font-weight:600;line-height:1.4;margin:2px 0 0}
.launcher-empty__body{color:var(--dsw-alias-label-secondary,#666);font-size:12.5px;line-height:1.7;margin:0}
.launcher-empty__starters{display:grid;gap:8px;grid-template-columns:repeat(2,minmax(0,1fr));margin-top:6px}
.launcher-empty__starters[data-columns="1"]{grid-template-columns:minmax(0,1fr)}
.launcher-empty__starter{align-items:center;background:var(--dsw-alias-button-floating-fill,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;color:inherit;cursor:pointer;display:flex;font:inherit;font-size:13px;height:36px;justify-content:center;padding:0 10px}
.launcher-empty__hint{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11px;margin:4px 0 0}
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
  /** 打开插件工作台：宿主 pluginNavigation.openList() 优先，退 selectPanel 真 key。 */
  function openPluginWorkbench(ctx) {
    try {
      if (typeof ctx?.pluginNavigation?.openList === 'function') {
        ctx.pluginNavigation.openList()
        return true
      }
    } catch {
      /* 落到 selectPanel */
    }
    const key = resolveMainKey(ctx, RAIL_CANDIDATES.plugins)
    if (key !== null) return selectPanel(key)
    return false
  }

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

  /** 宿主面板里「自己不带返回」的那些——由外壳补一条回链（插件页自带，不重复）。 */
  const PANELS_NEEDING_BACK = ['dsh-archive-manager']

  /**
   * 让宿主自己展开/收起右栏（不要再拿本地 sticky 冒充展开态）：
   * ① 宿主服务 sidebarRight：commandTarget(null) + toggleExpanded()；
   * ② 退宿主命令 `sidebar.right.toggle`；
   * ③ 都不行才用本地轨道（仅兜底，轨道开了内容不一定开）。
   * @returns {boolean} 是否成功让宿主切换。
   */
  function toggleRightbarHost() {
    try {
      const svc = CURRENT_CTX?.get?.('sidebarRight')
      if (svc !== null && svc !== undefined && typeof svc.toggleExpanded === 'function') {
        svc.commandTarget?.(null)
        svc.toggleExpanded()
        return true
      }
    } catch {
      /* 落到命令 */
    }
    try {
      const rows = CURRENT_CTX?.shortcuts?.registry?.commands
      const row = rows?.get?.('sidebar.right.toggle')
      if (row !== undefined) {
        const verdict = row.resolve?.({ region: 'page', modal: null, source: 'menu' })
        if (verdict?.status === 'handled' && typeof verdict.run === 'function') {
          verdict.run()
          return true
        }
      }
    } catch {
      /* 落到本地兜底 */
    }
    return false
  }

  /** 回会话页：宿主 selectPanel(null) 不生效时退到 'conversation' 真 key。 */
  function goConversation(ctx) {
    try {
      ctx?.layout?.selectPanel?.(null)
      if (ctx?.layout?.panelInfo?.getSnapshot?.().activePanelId === null) return true
    } catch {
      /* 落到真 key */
    }
    return selectPanel('conversation')
  }

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
   * 恒定注册（0.2.0 范围内）；回滚是代码级/构建级的——不注入这两个槽条目即可，不用运行时开关。
   * 按钮必须真有行为，否则就是"假执行"（05 §6.5：假执行比不提供更糟）。
   */
  /** 外壳的可见反馈条（失败/结果都要看得见，别只 console）。 */
  function showLauncherToast(text) {
    try {
      const node = document.createElement('div')
      node.className = 'launcher-toast'
      node.textContent = text
      document.body.appendChild(node)
      setTimeout(() => node.remove(), 2600)
    } catch {
      console.warn('dsh-client-ui-launcher:', text)
    }
  }

  /**
   * FR-35 权限范围 pill（05 §6.3-⑥）：挂 `conversation.composer.bar`，26px、`+` 右侧、模型 chip 左侧。
   * 默认不注册：宿主是否在槽 props 里给「当前权限 + 设置回调」尚未确认，没有回调时按钮点了就是假执行。
   * 开闸：`window.__DSH_LAUNCHER_PERMISSION_PILL__ === true`。读不到宿主策略时显示 `workspace-write`，绝不显示 full。
   * @param {object} ctx - 客户端上下文。
   * @returns {Function[]} dispose 列表。
   */
  /**
   * FR-38 上下文诊断：入口 + 浮层都在 `conversation.session.header.actions`（session scope）。
   * root 是 root scope，拿不到 useProjection；硬读 ctx.tokenMeter 会把整页打崩（df1f865 事故）。
   * 数据只用宿主投影 `contextPressure` / `contextBreakdown`；读不到整条不渲染（不置假数据）。
   */
  function registerContextDiagnostics(ctx) {
    const Component = (slotProps) => {
      // hooks 必须无条件、顺序稳定：全部放在组件最顶部（React #310 的根因就是放在了 early return 之后）
      const [open, setOpen] = React.useState(false)
      const entryRef = React.useRef(null)
      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setOpen(false)
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [open])
      const readProjection = (name) => {
        try {
          const hook = slotProps?.useProjection
          if (typeof hook !== 'function') return null
          const value = hook(name)
          return typeof value === 'function' ? value((v) => v) : value
        } catch {
          return null
        }
      }
      const pressure = readProjection('contextPressure')
      const breakdown = readProjection('contextBreakdown')
      if (typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEBUG__ === true) {
        // 一次把「这个槽到底给了什么」打全：props 键、useProjection 类型、两条真实返回值
        const readSafe = (name) => {
          try {
            const hook = slotProps?.useProjection
            return typeof hook === 'function' ? hook(name) : 'no-hook'
          } catch (error) {
            return `throw:${String(error?.message ?? error).slice(0, 60)}`
          }
        }
        console.info('launcher:ctx props', JSON.stringify({
          keys: Object.keys(slotProps ?? {}),
          useProjection: typeof slotProps?.useProjection,
          contextPressure: readSafe('contextPressure'),
          contextBreakdown: readSafe('contextBreakdown'),
          tokenUsage: readSafe('tokenUsage'),
        }).slice(0, 600))
      }
      const num = (value, keys) => {
        if (value === null || value === undefined) return null
        if (typeof value === 'number') return Number.isFinite(value) ? value : null
        for (const key of keys) {
          const n = Number(value[key])
          if (Number.isFinite(n)) return n
        }
        return null
      }
      // 实测形状：{pressureTokens, projectedTokens, contextWindow}
      // 实测：{pressureTokens, projectedTokens, contextWindow}；占用优先 projectedTokens
      const used = num(pressure, ['projectedTokens', 'pressureTokens', 'used', 'usedTokens', 'tokens', 'surfaceTokens'])
      const limit = num(pressure, ['contextWindow', 'limit', 'limitTokens', 'windowTokens', 'max'])
      const ratio = num(pressure, ['ratio', 'pct', 'percent', 'pressure'])
      let pct = null
      if (used !== null && limit !== null && limit > 0) pct = Math.min(100, Math.round((used / limit) * 100))
      else if (ratio !== null) pct = ratio <= 1 ? Math.round(ratio * 100) : Math.round(ratio)
      const system = num(breakdown, ['systemTokens', 'system'])
      const chat = num(breakdown, ['messageTokens', 'chat'])
      const files = num(breakdown, ['filesTokens', 'files'])
      const tools = num(breakdown, ['toolsTokens', 'tools'])

      const unavailable = pct === null && system === null && chat === null && tools === null
      // 浮层挂 document.body：header 的 mask 会裁掉 position:fixed 的后代（实测）
      React.useEffect(() => {
        if (!open || unavailable) return undefined
        const rect = entryRef.current?.getBoundingClientRect?.()
        const node = document.createElement('div')
        node.className = 'launcher-ctx__pop launcher-ctxdiag__pop'
        node.setAttribute('role', 'dialog')
        node.setAttribute('aria-label', '上下文诊断')
        node.setAttribute('data-launcher-overlay', '')
        node.style.position = 'fixed'
        node.style.zIndex = '1000'
        node.style.top = `${(rect?.bottom ?? 0) + 6}px`
        node.style.left = `${Math.max(8, rect?.left ?? 8)}px`
        const head = document.createElement('header')
        head.className = 'launcher-ctx__head'
        head.textContent = pct === null ? '上下文占用 —' : `上下文占用 ${pct}%`
        node.appendChild(head)
        const list = document.createElement('dl')
        list.className = 'launcher-ctx__list'
        for (const [label, value] of [['系统提示', system], ['会话消息', chat], ['文件', files], ['工具', tools]]) {
          if (value === null || value === undefined) continue
          const row = document.createElement('div')
          const dt = document.createElement('dt')
          dt.textContent = label
          const dd = document.createElement('dd')
          dd.textContent = String(value)
          row.append(dt, dd)
          list.appendChild(row)
        }
        node.appendChild(list)
        document.body.appendChild(node)
        const onOutside = (event) => {
          if (node.contains(event.target)) return
          if (entryRef.current?.contains?.(event.target)) return
          setOpen(false)
        }
        document.addEventListener('pointerdown', onOutside, true)
        return () => {
          document.removeEventListener('pointerdown', onOutside, true)
          node.remove()
          entryRef.current?.focus?.()
        }
      }, [open, unavailable, pct, system, chat, files, tools])

      return h('div', { className: 'launcher-ctx launcher-ctxdiag', onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false) } },
        h('button', {
          ref: entryRef,
          type: 'button',
          className: 'launcher-ctx__entry',
          'data-pct': pct === null ? '' : pct,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-disabled': unavailable,
          disabled: unavailable,
          title: unavailable ? '上下文用量不可用' : `上下文占用 ${pct}% · 点开看拆分`,
          onClick: () => {
            if (unavailable) return
            setOpen((v) => !v)
          },
        }, unavailable ? '上下文 —' : `上下文 ${pct}%`))
    }
    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      const dispose = ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions',
        id: 'launcher.contextDiagnostics',
        order: 10,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册上下文诊断失败', error)
      return []
    }
  }


  /**
   * C 方案：`conversation.composer.dock`（list，session）只挂**只读镜像**——排队数量。
   * 不抢宿主状态、不重复渲染同一数字：宿主管生一条，我们只在「有排队且宿主没给这条」时显示；
   * 拿不到就整条不渲染。
   */
  function registerComposerDock(ctx) {
    /** composer 容器（把取值限定在会话 composer 内，避免误读命令面板/改名弹窗的可编辑元素）。 */
    const composerRoot = () => {
      const bySlot = document.querySelector('[data-slot="conversation.composer"]')
      if (bySlot !== null) return bySlot
      const editable = document.querySelector('[contenteditable="true"]')
      return editable?.closest('[class*="composer"]') ?? null
    }

    /** DOM 读数（宿主给 dock 槽传的是空对象，slotProps 里没有输入/附件）。 */
    const readDockSummary = () => {
      try {
        const root = composerRoot()
        if (root === null) return { chars: 0, attachments: 0 }
        const editable = root.querySelector('[contenteditable="true"]')
        // Lexical 空编辑器保留一个换行：先去首尾空白再数字符，否则清空后仍会显示「输入 1 字」
        const chars = editable === null ? 0 : [...(editable.innerText ?? '').trim()].length
        const attachments = root.querySelectorAll('[data-attachment-id], [class*="attachmentChip"], [class*="attachment-chip"]').length
        return { chars, attachments }
      } catch {
        return { chars: 0, attachments: 0 }
      }
    }

    const Component = () => {
      const [summary, setSummary] = React.useState(readDockSummary)
      React.useEffect(() => {
        let frame = 0
        const update = () => {
          // rAF 合并：生成中每个 token 都触发也只算一次；数值没变不 setState
          if (frame !== 0) return
          frame = requestAnimationFrame(() => {
            frame = 0
            const next = readDockSummary()
            setSummary((prev) => (prev.chars === next.chars && prev.attachments === next.attachments ? prev : next))
          })
        }
        const root = composerRoot()
        document.addEventListener('input', update, true)
        const observer = new MutationObserver(update)
        // 只观察 composer 子树；拿不到容器时不观察（宁可不动，也不盯全页）
        if (root !== null) observer.observe(root, { childList: true, subtree: true, characterData: true })
        const timer = setInterval(update, 800)
        return () => {
          if (frame !== 0) cancelAnimationFrame(frame)
          document.removeEventListener('input', update, true)
          observer.disconnect()
          clearInterval(timer)
        }
      }, [])
      const parts = []
      if (summary.chars > 0) parts.push(`输入 ${summary.chars} 字`)
      if (summary.attachments > 0) parts.push(`${summary.attachments} 个附件`)
      if (parts.length === 0) return null
      return h('span', {
        className: 'launcher-dock-summary',
        title: parts.join(' · '),
        'data-dock-chars': summary.chars,
        'data-dock-attachments': summary.attachments,
      }, parts.join(' · '))
    }

    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      const dispose = ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'launcher.composerDock',
        order: 10,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册 composer.dock 摘要失败', error)
      return []
    }
  }


  /** FR-44 三态（与 lib/model-chip.js 同口径）。 */
  function modelChipText(model = {}) {
    const name = typeof model.name === 'string' ? model.name.trim() : ''
    if (name.length === 0) return null
    const level = typeof model.reasoningLevel === 'string' ? model.reasoningLevel.trim() : ''
    if (level.length > 0) return { label: `${name} · ${level}`, state: 'level' }
    if (model.metadataKnown === true) return { label: `${name} · 无推理等级`, state: 'none' }
    return { label: name, state: 'unknown' }
  }

  /** FR-44 模型 chip（只显示不切换）：三态见 lib/model-chip.js；没有模型元数据就不渲染。 */
  function registerModelChip(ctx) {
    const Component = (slotProps) => {
      const text = modelChipText({
        name: slotProps?.model?.name ?? slotProps?.modelName,
        reasoningLevel: slotProps?.model?.reasoningLevel ?? slotProps?.reasoningLevel,
        metadataKnown: slotProps?.model?.metadataKnown === true || slotProps?.metadataKnown === true,
      })
      if (text === null) return null
      return h('span', { className: 'launcher-model-chip', 'data-model-state': text.state, title: text.label }, text.label)
    }
    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      // composer.bar 若是 single 槽，注册会打断 required 插件激活：先确认它是 list 再注册
      const spec = ctx.slots.spec?.('conversation.composer.bar')
      if (spec === undefined || spec === null || spec.kind !== 'list') return []
      const dispose = ctx.slots.inject('conversation.composer.bar', () => ctx.slots.register({
        name: 'conversation.composer.bar',
        id: 'launcher.modelChip',
        order: 20,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册模型 chip 失败', error)
      return []
    }
  }

  function registerPermissionPill(ctx) {
    if (typeof window === 'undefined' || window.__DSH_LAUNCHER_PERMISSION_PILL__ !== true) return []
    const LEVELS = [
      { id: 'read', label: '仅可查看', short: '阅' },
      { id: 'workspace-write', label: '工作区内修改', short: '改' },
      { id: 'danger-full-access', label: '完全权限', short: '全' },
    ]
    const Component = (slotProps) => {
      const scope = LEVELS.some((l) => l.id === slotProps?.permission?.scope) ? slotProps.permission.scope : 'workspace-write'
      const canChange = typeof slotProps?.onSetPermission === 'function'
      const current = LEVELS.find((l) => l.id === scope) ?? LEVELS[1]
      const [open, setOpen] = React.useState(false)
      return h('div', { className: 'launcher-perm' },
        h('button', {
          type: 'button',
          className: 'launcher-perm__pill',
          'data-scope': current.id,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          title: current.label,
          disabled: !canChange,
          onClick: () => canChange && setOpen((v) => !v),
        }, h('span', { className: 'launcher-perm__icon', 'aria-hidden': 'true' }, current.short),
           h('span', { className: 'launcher-perm__text' }, current.label)),
        open && canChange ? h('div', { className: 'launcher-perm__menu', role: 'menu' },
          LEVELS.map((level) => h('button', {
            key: level.id,
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': level.id === current.id,
            className: `launcher-perm__item${level.id === current.id ? ' on' : ''}`,
            onClick: () => { slotProps.onSetPermission(level.id); setOpen(false) },
          }, level.label))) : null)
    }
    try {
      if (typeof ctx?.slots?.inject !== 'function') return []
      // M1：composer.bar 在 rc.5 是 single 槽，注册会打断 required 激活（同模型 chip 的坑）
      const spec = ctx.slots.spec?.('conversation.composer.bar')
      if (spec === undefined || spec === null || spec.kind !== 'list') return []
      const dispose = ctx.slots.inject('conversation.composer.bar', () => ctx.slots.register({
        name: 'conversation.composer.bar',
        id: 'launcher.permissionPill',
        order: 10,
        inject: () => ({}),
      }, Component))
      return typeof dispose === 'function' ? [dispose] : []
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 注册权限 pill 失败', error)
      return []
    }
  }



  function registerTurnActions(ctx) {
    const disposers = []

    /**
     * 按宿主真实结构取「这一轮」：按钮在 `[data-chat-flow-kind="turn-tail"]` 里，
     * 正文取它前面最近的 `assistant-step`（助手）或 `user`（用户），轮次 = tail 在会话里的序号。
     * @param {Element|null} node - 触发按钮或包含按钮的节点。
     * @returns {{ text: string, role: string, turnIndex: number }} 这一轮的数据。
     */
    /**
     * 取消息正文并把代码块还原成围栏：宿主把 ``` 渲染成 `pre>code`，`innerText` 会丢掉反引号。
     * @param {Element} root - 消息节点。
     * @returns {string} 带围栏的正文。
     */
    const textWithFences = (root) => {
      // 按文档顺序拼：遇到 PRE 一次拼「```lang + 代码 + ```」；
      // 宿主的代码块常带一个「语言标签」节点（如 <span>js</span>）紧挨在 PRE 前，要跳过它并把语言带进围栏。
      const parts = []
      const labelOf = (node) => {
        const text = (node?.textContent ?? '').trim()
        return /^[A-Za-z0-9+#._-]{1,12}$/.test(text) ? text.toLowerCase() : ''
      }
      const pushPre = (pre, lang) => {
        const code = pre.querySelector('code')
        // 语言三处依次取：code 的 language-* class → pre 的 language-* class → data-language → 传入的标签文本
        const codeLang = ((code?.className ?? '').match(/language-([\w-]+)/)?.[1]
          ?? (pre.className ?? '').match(/language-([\w-]+)/)?.[1]
          ?? pre.getAttribute?.('data-language')
          ?? '')
        const body = (code?.textContent ?? pre.textContent ?? '').replace(/\n$/, '')
        parts.push(`\n\n\`\`\`${codeLang || lang}\n${body}\n\`\`\`\n\n`)
      }
      const walk = (node) => {
        if (node === null || node === undefined) return
        if (node.nodeType === 3) {
          parts.push(node.nodeValue ?? '')
          return
        }
        if (node.nodeType !== 1) return
        if (node.tagName === 'PRE') {
          pushPre(node, '')
          return
        }
        // 宿主的代码块容器（.md-code-block / 含横幅）里有 pre：只取 pre 的代码与语言，
        // 绝不把横幅里的语言名、复制按钮带进正文。
        if (typeof node.querySelector === 'function' && node.querySelector('pre') !== null) {
          const langEl = node.querySelector('[class*="language"], [data-language]')
          const lang = (langEl?.textContent ?? '').trim().toLowerCase()
          pushPre(node.querySelector('pre'), lang)
          return
        }
        const children = [...node.childNodes]
        for (const child of children) walk(child)
      }
      walk(root)
      return parts.join('').replace(/\n{3,}/g, '\n\n').trim()
    }



    const readTurnFromNode = (node) => {
      const tail = node?.closest?.('[data-chat-flow-kind="turn-tail"]') ?? null
      if (tail === null) return { text: '', role: 'assistant', turnIndex: 1 }
      // 轮次：只看「当前会话里」的 turn-tail（不是全文档），否则多会话页面永远算成 1
      const tailScope = (() => {
        let scope = tail.parentElement
        while (scope !== null && scope !== document.body) {
          if (scope.querySelectorAll('[data-chat-flow-kind="turn-tail"]').length > 1) return scope
          scope = scope.parentElement
        }
        return tail.parentElement ?? document.body
      })()
      const tails = [...tailScope.querySelectorAll('[data-chat-flow-kind="turn-tail"]')]
      const turnIndex = Math.max(1, tails.indexOf(tail) + 1)
      // 正文：在「同时包含 tail 的祖先」里找 tail 之前最近的 assistant-step / user（不跨消息容器）
      const nearestBefore = (kind) => {
        let scope = tail.parentElement
        while (scope !== null && scope !== document.body) {
          const found = [...scope.querySelectorAll(`[data-chat-flow-kind="${kind}"]`)]
            .filter((el) => el.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING)
          if (found.length > 0) return found[found.length - 1]
          scope = scope.parentElement
        }
        return null
      }
      const assistant = nearestBefore('assistant-step')
      if (assistant !== null) return { text: textWithFences(assistant), role: 'assistant', turnIndex }
      const user = nearestBefore('user')
      return { text: (user?.innerText ?? user?.textContent ?? '').trim(), role: 'user', turnIndex }
    }



    // 导出：生成 Markdown 并触发下载（不依赖宿主接口）
    const downloadExport = (turn) => {
      const text = typeof turn?.text === 'string' ? turn.text.trim() : ''
      if (text.length === 0) {
        // 取不到正文就不产占位文件（真机空文件事故）
        showLauncherToast('导出失败：取不到这一轮的正文')
        return
      }
      const index = Number.isFinite(turn?.turnIndex) && turn.turnIndex > 0 ? Math.trunc(turn.turnIndex) : 1
      const body = `## ${turn?.role === 'assistant' ? '助手' : '用户'}\n\n${text}\n`
      try {
        const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `turn-${index}-${Date.now()}.md`
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
        showLauncherToast(`已导出 ${link.download}`)
      } catch (error) {
        showLauncherToast(`导出失败：${String(error?.message ?? error).slice(0, 60)}`)
      }
    }

    // 上下文查看：有锚点就滚过去高亮；没有就固定文案告知（不静默）
    const viewInContext = (turn, event) => {
      const anchor = event?.currentTarget?.closest?.('[data-chat-flow-kind="turn-tail"]') ?? null
      if (anchor !== null) {
        anchor.scrollIntoView({ block: 'center', behavior: 'smooth' })
        anchor.classList.add('launcher-turn-highlight')
        setTimeout(() => anchor.classList.remove('launcher-turn-highlight'), 1600)
        return
      }
      const tab = [...document.querySelectorAll('[role="tab"]')].find((node) => /上下文/.test(node.textContent ?? ''))
      if (tab !== null) tab.click()
      showLauncherToast(`第 ${turn?.turnIndex ?? 1} 轮暂无锚点，已停留在当前会话`)
      window.dispatchEvent(new CustomEvent('launcher:turn-action', { detail: { id: 'launcher.viewInContext' } }))
    }

    /**
     * FR-41 降级版：新建会话并把该轮正文以 `> ` 引用块填进 composer，明确告知「未复制上下文」。
     * 不碰原会话内容：只读 DOM 取正文 + 走宿主 session.new。
     */
    const branchToNewSession = async (turn) => {
      const quote = typeof turn?.text === 'string' ? turn.text.trim() : ''
      if (quote.length === 0) {
        showLauncherToast('分支失败：取不到这一轮的正文')
        return
      }
      const quoted = quote.split('\n').map((line) => (line.length === 0 ? '>' : `> ${line}`)).join('\n')
      let created = false
      try {
        const rows = CURRENT_CTX?.shortcuts?.registry?.commands
        const row = rows?.get?.('session.new')
        if (row !== undefined) {
          const verdict = row.resolve?.({ region: 'page', modal: null, source: 'menu' })
          if (verdict?.status === 'handled' && typeof verdict.run === 'function') {
            verdict.run()
            created = true
          }
        }
      } catch {
        created = false
      }
      if (!created && typeof CURRENT_CTX?.layout?.selectPanel === 'function') {
        try {
          CURRENT_CTX.layout.selectPanel('conversation')
          created = true
        } catch {
          created = false
        }
      }
      if (!created) {
        showLauncherToast('分支失败：无法新建会话')
        return
      }
      // 等「新会话的 composer」出现再填：旧 composer 一直在 DOM 里，
      // 判据必须是元素身份变了（旧节点被卸载、新节点挂上），而不是「存在即可」。
      const before = document.querySelector('[contenteditable="true"], textarea')
      const started = Date.now()
      const waitForComposer = () => {
        const now = document.querySelector('[contenteditable="true"], textarea')
        const replaced = now !== null && now !== before
        if (replaced || Date.now() - started > 2500) {
          fillComposerByDom(quoted)
          showLauncherToast('已新建会话并引用该轮，未复制上下文')
          return
        }
        setTimeout(waitForComposer, 150)
      }
      waitForComposer()
    }

    const rows = [
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.export', order: 20, label: '导出本轮', icon: '⤓', onClick: downloadExport },
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.viewInContext', order: 30, label: '在上下文视图中查看此轮', icon: '◎', onClick: viewInContext },
      { slot: 'conversation.chat.assistant-actions', id: 'launcher.branch', order: 40, label: '在新对话中分支', icon: '⑂', onClick: branchToNewSession },
    ]

    for (const row of rows) {
      try {
        const Component = (slotProps) => {
          const turn = readTurnFromNode(slotProps?.anchorNode ?? null)
          return h('button', {
            type: 'button',
            className: 'launcher-turn-action',
            'data-action': row.id,
            title: row.label,
            'aria-label': row.label,
            onClick: (event) => row.onClick(readTurnFromNode(event?.currentTarget), event),
          },
            h('span', { className: 'launcher-turn-action__icon', 'aria-hidden': 'true' }, row.icon ?? '·'),
            h('span', { className: 'launcher-turn-action__label' }, row.label))
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


  /**
   * FR-38：从宿主取上下文用量（system / chat / files / tools + 百分比 + 建议）。
   * 读不到返回 null —— 调用方整项不显示、入口置灰，不许拿外壳状态顶替。
   * @param {object} ctx - 客户端上下文。
   * @returns {{ system:number, chat:number, files:number, tools:number, used:number, limit:number, pct:number }|null} 用量。
   */
  function readContextUsage(ctx) {
    // 插件 ctx 是代理：读未 inject 的属性会在 **get 阶段** throw，`?.` 拦不住。
    // 所以每个候选都单独 try/catch；服务没声明就拿不到，返回 null（入口置灰，不造假数据）。
    const safe = (fn) => {
      try {
        return fn()
      } catch {
        return null
      }
    }
    const candidates = [
      safe(() => ctx?.tokenMeter?.getSnapshot?.()),
      safe(() => ctx?.tokenMeter?.snapshot?.()),
      safe(() => ctx?.contextMeter?.getSnapshot?.()),
      safe(() => ctx?.composer?.meter?.()),
    ]
    for (const raw of candidates) {
      if (raw === null || raw === undefined || typeof raw !== 'object') continue
      const breakdown = raw.breakdown ?? raw
      const system = Number(breakdown.systemTokens ?? breakdown.system ?? 0)
      const tools = Number(breakdown.toolsTokens ?? breakdown.tools ?? 0)
      const chat = Number(breakdown.messageTokens ?? breakdown.chat ?? 0)
      const files = Number(breakdown.filesTokens ?? breakdown.files ?? 0)
      const used = Number(raw.surfaceTokens ?? raw.used ?? system + tools + chat + files)
      const limit = Number(raw.limit ?? raw.contextLimit ?? raw.windowTokens ?? 0)
      if (!Number.isFinite(used) || used <= 0 || !Number.isFinite(limit) || limit <= 0) continue
      const pct = Math.min(100, Math.round((used / limit) * 100))
      return { system, chat, files, tools, used, limit, pct }
    }
    return null
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
      ...(typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEV_PANEL__ === true
        ? [{ id: 'launcher.devPanel', label: '外壳调试面板', hint: '开发用：面板/分屏/右栏宽度/codeWrap/权限', regions: ['page'], aliases: [], resolve: () => ({ status: 'handled', run: () => window.dispatchEvent(new CustomEvent('launcher:open-dev-panel')) }) }]
        : []),
      { id: 'launcher.theme.toggle', label: '切换主题', hint: '浅色 / 深色（⌘⇧L）', regions: ['page'], aliases: [], resolve: () => ({ status: 'handled', run: () => window.dispatchEvent(new CustomEvent('launcher:toggle-theme')) }) },
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




  /**
   * 起手式的 DOM 兜底填充：优先 contenteditable（execCommand insertText），其次 textarea（原生 setter + input 事件）。
   * 只填入、不发发送键，不提交任何请求。
   * @param {string} text - 要填入的整句。
   * @returns {boolean} 是否填成功。
   */
  function fillComposerByDom(text) {
    try {
      const root = document.querySelector('[data-slot="conversation.composer"]')
        ?? document.querySelector('[contenteditable="true"]')?.closest('[class*="composer"]')
        ?? null
      const editable = root?.querySelector('[contenteditable="true"]') ?? null
      if (editable !== null) {
        editable.focus()
        const selection = window.getSelection()
        const range = document.createRange()
        // 起手式是「填一个建议」：先全选清空再填，不做追加（09 已记口径）
        range.selectNodeContents(editable)
        selection?.removeAllRanges()
        selection?.addRange(range)
        if (document.execCommand('delete')) {
          range.selectNodeContents(editable)
          range.collapse(false)
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
        // Lexical 类 composer：用 paste 事件写入（insertText 的 \n 会被吞，insertParagraph 无效）
        if (String(text).includes('\n')) {
          try {
            const data = new DataTransfer()
            data.setData('text/plain', String(text))
            // defaultPrevented = Lexical 接住了 paste；未被接住则继续走逐行插入（别报假成功）
            const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
            editable.dispatchEvent(event)
            if (event.defaultPrevented) return true
          } catch {
            /* 退逐行插入 */
          }
        }
        const lines = String(text).split('\n')
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (line.length > 0) document.execCommand('insertText', false, line)
          if (index < lines.length - 1) document.execCommand('insertParagraph')
        }
        // 光标放到文末，别留全选
        const endRange = document.createRange()
        endRange.selectNodeContents(editable)
        endRange.collapse(false)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(endRange)
        return true
      }
      const textarea = document.querySelector('textarea')
      if (textarea !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(textarea, text)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.focus()
        return true
      }
    } catch {
      return false
    }
    return false
  }

  /**
   * 主题落地器（原宿主 layout 的 apply(snapshot)，随同名替换一起搬回来）：
   * 写 colorScheme / data-ds-theme-source / body[data-ds-theme-dark] / 字体变量。
   * 不做这一步，setTheme 只改 preference，页面不变色。
   */
  const appliedThemeTokens = []

  function applyThemeDom() {
    try {
      const snapshot = CURRENT_CTX?.theme?.getTheme?.()
      if (snapshot === null || snapshot === undefined) return
      const scheme = snapshot.active?.colorScheme ?? 'light'
      const root = document.documentElement
      root.style.colorScheme = scheme
      root.setAttribute('data-ds-theme-source', snapshot.preference === 'system' ? 'system' : scheme)
    root.removeAttribute('data-ds-theme-dark')
      const body = document.body
      if (body === null) return
      // 宿主 palette 认这个属性名（DARK_ATTRIBUTE = 'data-ds-dark-theme'）
      if (scheme === 'dark') body.setAttribute('data-ds-dark-theme', '')
      else body.removeAttribute('data-ds-dark-theme')
      // 主题自带 tokens 写成内联变量：先撤上一轮自己写的，别覆盖别人写的
      for (const name of appliedThemeTokens) body.style.removeProperty(name)
      appliedThemeTokens.length = 0
      for (const [name, value] of Object.entries(snapshot.active?.tokens ?? {})) {
        if (typeof value !== 'string') continue
        body.style.setProperty(name, value)
        appliedThemeTokens.push(name)
      }
      // meta[name=theme-color] 按 body 计算背景更新
      try {
        const meta = document.querySelector('meta[name="theme-color"]')
        if (meta !== null) meta.setAttribute('content', getComputedStyle(body).backgroundColor)
      } catch {
        /* 没有 meta 就跳过 */
      }
      for (const [role, px] of Object.entries(snapshot.fontSizes ?? {})) {
        if (Number.isFinite(px)) body.style.setProperty(`--dsw-font-size-${role}`, `${px}px`)
      }
      for (const [role, family] of Object.entries(snapshot.fontFamilies ?? {})) {
        if (typeof family === 'string' && family.length > 0) body.style.setProperty(`--dsw-font-family-${role}`, family)
        else body.style.removeProperty(`--dsw-font-family-${role}`)
      }
    } catch (error) {
      console.warn('dsh-client-ui-launcher: 主题落地失败', error)
    }
  }

  /** 空态判据（与 lib/new-session.js 的 emptyStateDecision 同口径）。 */
  function emptyStateDecision(input) {
    const force = input.force ?? (typeof window !== 'undefined' ? window.__DSH_LAUNCHER_EMPTY__ : undefined)
    // 开发期开关放最前面：否则没有会话时永远走不到 forced-on
    if (force === 'off') return { render: false, reason: 'forced-off' }
    if (force === 'on') return { render: true, reason: 'forced-on' }
    // 不在会话页（面板已切到插件/归档等）就不画
    if (input.activePanelId !== null && input.activePanelId !== undefined) return { render: false, reason: 'other-panel' }
    // 宿主自己画了空态就不画（不许双空态）
    if (input.hostEmptyState === true) return { render: false, reason: 'host-empty-state' }
    // 有消息就不画
    const messages = Number(input.messageCount)
    if (Number.isFinite(messages) && messages > 0) return { render: false, reason: 'has-messages' }
    // root 拿不到 sessionId：只要当前在会话页、宿主没画空态、没有消息，就用我们的卡片
    return { render: true, reason: 'ok' }
  }


  /** 卡片布局量（与 lib/new-session.js 的 cardLayout 同口径）。 */
  function cardLayout(width, height) {
    const narrow = width <= 760
    return {
      width: Math.min(440, width),
      // 空态要给宿主 hero+composer 让地方：卡片最高 260px（内部滚动），不要把 composer 顶出视口
      minHeight: Math.min(260, Math.round((height * (narrow ? 36 : 46)) / 100)),
      columns: narrow ? 1 : 2,
    }
  }

  /** 空会话首屏（FR-36）：主题标 + 标题 + 说明 + 四个起手式；点起手式只填入不发送。 */
  function EmptyStateCard(props) {
    const layout = props.layout
    const onStarter = (id) => {
      const item = STARTERS.find((entry) => entry.id === id)
      if (item === undefined) return
      const ctx = CURRENT_CTX
      // DOM 填充优先：ctx.composer.fill 存在但可能是 no-op（实测填不进去），不能当成功
      let filled = fillComposerByDom(item.text)
      if (!filled) {
        try {
          if (typeof ctx?.composer?.fill === 'function') {
            ctx.composer.fill(item.text)
            ctx.composer.focus?.()
            filled = true
          }
        } catch {
          filled = false
        }
      }
      if (!filled) showLauncherToast('起手式填不进去：没找到输入框')
      if (filled && typeof props.onFilled === 'function') props.onFilled()
      window.dispatchEvent(new CustomEvent('launcher:starter', { detail: { id, text: item.text, filled } }))
    }
    return h('div', { className: 'launcher-empty', 'data-launcher-empty': 'our' },
      h('div', { className: 'launcher-empty__card', style: { maxWidth: `${layout.width}px`, minHeight: `${layout.minHeight}px` } },
        h('div', { className: 'launcher-empty__theme', 'aria-hidden': 'true' }, 'dsh'),
        h('h2', { className: 'launcher-empty__title' }, '从一个问题开始'),
        h('p', { className: 'launcher-empty__body' }, '选一个起手式，或直接在下面输入；起手式只会填进输入框，不会替你发送。'),
        h('div', { className: 'launcher-empty__starters', 'data-columns': String(layout.columns) },
          STARTERS.map((item) => h('button', {
            key: item.id,
            type: 'button',
            className: 'launcher-empty__starter',
            onClick: () => onStarter(item.id),
          }, item.label))),
        h('p', { className: 'launcher-empty__hint' }, '提示：⌘K 打开命令面板')))
  }

  /** 外壳本体：56 图标栏 + 侧栏列 + 主区 + 右栏轨道 + 底状态条 + 浮层。 */
  function LauncherRoot(props) {
    const renderSlot = props.renderSlot
    const [viewportWidth, setViewportWidth] = React.useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
    React.useEffect(() => {
      const onResize = () => setViewportWidth(window.innerWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [])
    // 标准 props 是选择器钩子（SnapshotSelectorHook），必须带 selector 调用，
    // 直接 useDockOpen() 会报 `selector is not a function` 并把 root 整个打崩。
    const dockOpenHook = props.useDockOpen === undefined ? false : props.useDockOpen((open) => open)
    const [dockOpenEvent, setDockOpenEvent] = React.useState(() => {
      try { return window.__DSH_LAUNCHER_DOCK__ === true } catch { return false }
    })
    React.useEffect(() => {
      const onDock = (event) => setDockOpenEvent(event?.detail?.open === true)
      window.addEventListener('launcher:dock', onDock)
      return () => window.removeEventListener('launcher:dock', onDock)
    }, [])
    const dockOpen = dockOpenHook || dockOpenEvent
    const status = () => statusText({ page: props.statusPage, mode: props.statusMode, running: props.statusRunning, queued: props.statusQueued })
    // W3：拖拽把手 + canShow 接线。宽度只改 CSS 变量，不重绘右栏内容。
    // 03 FR-13：宽度按会话记忆（localStorage['dsh.launcher.dockWidth']），刷新后右栏默认收起、重开回该值
    const [dragWidth, setDragWidth] = React.useState(() => {
      try {
        const saved = Number(window.localStorage.getItem('dsh.launcher.dockWidth'))
        if (!Number.isFinite(saved)) return DOCK_WIDTH
        const max = Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(window.innerWidth - 816)))
        return saved >= DOCK_MIN && saved <= max ? Math.round(saved) : DOCK_WIDTH
      } catch {
        return DOCK_WIDTH
      }
    })
    const [splitMode, setSplitMode] = React.useState(1)
    // ≤860：侧栏转抽屉（默认收起），与 rail 互斥；主区从 rail 后起算
    const [drawerOpen, setDrawerOpen] = React.useState(false)
    const [themeMode, setThemeMode] = React.useState(() => {
      try {
        const pref = CURRENT_CTX?.theme?.getTheme?.()?.preference
        if (pref === 'dark' || pref === 'light') return pref
      } catch {
        /* 读不到就用 DOM 兜底 */
      }
      try {
        return document.documentElement.dataset.dsTheme === 'dark' ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    })
    const applyTheme = (next) => {
      setThemeMode(next)
      try {
        const ctx = CURRENT_CTX
        if (typeof ctx?.theme?.setTheme === 'function') {
          ctx.theme.setTheme(next)
          applyThemeDom()
          // 宿主没写标记时补写（便于断言；不覆盖宿主自己的值）
          const root = document.documentElement
          if (root.dataset.dsThemeSource === undefined || root.dataset.dsThemeSource === 'system') {
            root.dataset.dsThemeSource = next
          }
          return
        }
      } catch (error) {
        console.warn('dsh-client-ui-launcher: setTheme 失败，转 DOM 兜底', error)
      }
      try {
        document.documentElement.dataset.dsTheme = next
        document.documentElement.dataset.dsThemeSource = 'user'
      } catch {
        /* 忽略 */
      }
    }
    const toggleTheme = () => applyTheme(themeMode === 'dark' ? 'light' : 'dark')
    /** 右栏开关：宿主 sidebarRight/命令 + 外壳轨道，两条入口（rail ▤ / ⌘⇧B）共用同一份状态。 */
    const toggleDock = () => {
      const hostOk = toggleRightbarHost()
      if (!hostOk) {
        setTimeout(() => {
          const width = document.querySelector('.launcher-dock')?.getBoundingClientRect().width ?? 0
          if (width < 10) showLauncherToast('先打开一个会话再展开右栏')
        }, 350)
      }
    }
    const narrow = viewportWidth <= 860
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
    const [hostHasMessages, setHostHasMessages] = React.useState(false)
    const [starterFilled, setStarterFilled] = React.useState(false)
    React.useEffect(() => {
      applyThemeDom()
      // 测试钩子：debug 开关下暴露 composer 填充器，便于无会话环境验多行插入
      if (typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEBUG__ === true) {
        window.__DSH_LAUNCHER_FILL__ = fillComposerByDom
      }
    }, [])
    // 空态覆盖层要给 composer 让位：按 composer 实际高度算，不用固定 150px
    const [composerHeight, setComposerHeight] = React.useState(150)
    React.useEffect(() => {
      const measure = () => {
        const editable = document.querySelector('[contenteditable="true"]')
        if (editable === null) return
        // 从输入框往上找「composer 本体」：class 含 composer 或 _root，且高度 < 200（不要拿到整块会话区）
        let node = editable
        let height = Math.round(editable.getBoundingClientRect().height)
        while (node !== null && node !== document.body) {
          const rect = node.getBoundingClientRect()
          const cls = String(node.className ?? '')
          if (rect.height > 0 && rect.height < 200 && /composer|_root/.test(cls)) {
            height = Math.round(rect.height)
            break
          }
          node = node.parentElement
        }
        setComposerHeight(height + 24)
      }

      measure()
      const observer = new MutationObserver(measure)
      observer.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('resize', measure)
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', measure)
      }
    }, [])
    React.useEffect(() => {
      const check = () => setHostHasMessages(document.querySelector('[data-chat-flow-kind]') !== null)
      check()
      const observer = new MutationObserver(check)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }, [])
    const emptyDecision = emptyStateDecision({
      selectedSessionId: props.selectedSessionId ?? props.sessionId ?? null,
      messageCount: props.messageCount,
      hostEmptyState: props.hostEmptyState,
      messageCount: hostHasMessages ? 1 : props.messageCount,
      activePanelId: props.usePanelInfo === undefined ? null : props.usePanelInfo((info) => info.activePanelId),
    })
    const activePanelId = props.usePanelInfo === undefined
      ? null
      : props.usePanelInfo((info) => info.activePanelId)
    const ctx = CURRENT_CTX
    const commands = collectCommands(ctx)
    const [paletteOpen, setPaletteOpen] = React.useState(false)
    const paletteWasOpen = React.useRef(false)
    React.useEffect(() => {
      if (paletteWasOpen.current && !paletteOpen) {
        requestAnimationFrame(() => {
          const opener = openerRef.current
          if (opener !== null && opener.isConnected !== false && typeof opener.focus === 'function') {
            opener.focus()
            return
          }
          const fallback = document.querySelector('[data-slot="main"] textarea, [data-slot="main"] input, [data-slot="main"] [contenteditable="true"], .launcher-main textarea, .launcher-main input, .launcher-main [contenteditable="true"]')
          fallback?.focus?.()
        })
      }
      paletteWasOpen.current = paletteOpen
    }, [paletteOpen])
    const paneScrollRef = React.useRef(0)
    const [devOpen, setDevOpen] = React.useState(false)
    const [wrapOn, setWrapOn] = React.useState(codeWrapOn)
    // #1 焦点回位：打开面板时记住当时的活动元素，Esc 时优先还给它（选择器只作兜底）
    const openerRef = React.useRef(null)
    React.useEffect(() => {
      const openDev = () => setDevOpen(true)
      const flip = () => setWrapOn((on) => { setCodeWrapPref(!on); return !on })
      window.addEventListener('launcher:open-dev-panel', openDev)
      window.addEventListener('launcher:toggle-code-wrap', flip)
      const onThemeToggle = () => applyTheme((CURRENT_CTX?.theme?.getTheme?.()?.preference === 'dark') ? 'light' : 'dark')
      window.addEventListener('launcher:toggle-theme', onThemeToggle)
      return () => {
        window.removeEventListener('launcher:open-dev-panel', openDev)
        window.removeEventListener('launcher:toggle-code-wrap', flip)
        window.removeEventListener('launcher:toggle-theme', onThemeToggle)
      }
    }, [])
    const onDiagKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); setDiagOpen(false) }
    }
    const [paletteIndex, setPaletteIndex] = React.useState(0)
    const [query, setQuery] = React.useState('')
    const shown = commands.filter((cmd) => query === '' || String(cmd.label).includes(query))
    const mainWidth = Math.max(0, viewportWidth - 56 - (props.sidebarCollapsed === true ? 0 : 280) - dockWidth)
    const effectiveSplit = resolveSplit(splitMode, mainWidth, (typeof window === 'undefined' ? 900 : window.innerHeight) - 26)
    const [cols, rows] = SPLIT_GRID[effectiveSplit] ?? SPLIT_GRID[1]
    const paneKeys = Array.from({ length: effectiveSplit }, (_, i) => (i === 0 ? 'conversation' : `conversation#${i + 1}`))
    const dockCanShow = dockOpen && viewportWidth >= DOCK_HIDE_BELOW
    const dockWidth = dockCanShow ? Math.max(DOCK_MIN, dragWidth) : 0
    const lastPointerRef = React.useRef({ time: 0, x: 0 })
    const startDrag = (event) => {
      event.preventDefault()
      const now = Date.now()
      const last = lastPointerRef.current
      // 双击复位：两次 pointerdown 间隔 <300ms 且位移 <4px（preventDefault 后不会再收到 dblclick）
      if (now - last.time < 300 && Math.abs(event.clientX - last.x) < 4) {
        lastPointerRef.current = { time: 0, x: 0 }
        setDragWidth(DOCK_WIDTH)
        return
      }
      lastPointerRef.current = { time: now, x: event.clientX }
      const startX = event.clientX
      const startWidth = dragWidth
      const move = (e) => {
        const next = clampDock(startWidth - (e.clientX - startX), window.innerWidth)
        setDragWidth(next)
        try { window.localStorage.setItem('dsh.launcher.dockWidth', String(next)) } catch { /* 忽略 */ }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    }
    const collapsed = props.sidebarCollapsed === true
    const runCommand = (cmd) => {
      setPaletteOpen(false)
      requestAnimationFrame(() => { const pane = document.querySelector('.launcher-pane'); if (pane !== null) pane.scrollTop = paneScrollRef.current })
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
      const isDockKey = (event.metaKey || event.ctrlKey) && event.shiftKey && String(event.key).toLowerCase() === 'b'
      if (isDockKey) {
        event.preventDefault()
        event.stopPropagation()
        toggleDock()
        return
      }
      const isThemeKey = (event.metaKey || event.ctrlKey) && event.shiftKey && String(event.key).toLowerCase() === 'l'
      if (isThemeKey) {
        event.preventDefault()
        toggleTheme()
        return
      }
      if (isPaletteKey) {
        event.preventDefault()
        if (!paletteOpen) {
          openerRef.current = document.activeElement
          paneScrollRef.current = document.querySelector('.launcher-pane')?.scrollTop ?? 0
        }
        setPaletteOpen((open) => !open)
        setPaletteIndex(0)
        return
      }
      if (!paletteOpen) return
      if (event.key === 'Escape') {
        const target = nextEscapeTarget([paletteOpen ? 'palette' : null, devOpen ? 'meter' : null].filter(Boolean))
        if (target === null) return
        event.preventDefault()
        setPaletteOpen(false)
        requestAnimationFrame(() => { const pane = document.querySelector('.launcher-pane'); if (pane !== null) pane.scrollTop = paneScrollRef.current })
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
    const onRootKeyDown = (event) => {
      if (event?.target?.closest?.('.launcher-palette') !== null && event?.target?.closest?.('.launcher-palette') !== undefined) return
      onKeyDown(event)
    }
    return h('div', {
      className: 'launcher-shell',
      'data-drawer': narrow ? (drawerOpen ? 'open' : 'closed') : 'static',
      'data-shell': 'launcher',
      // 05 §6.3-7：属性挂外壳根，不挂 documentElement（避免改到宿主自己的代码块）
      'data-code-wrap': wrapOn ? 'on' : 'off',
      style: { '--launcher-composer-h': `${composerHeight}px`, '--launcher-dock': `${dockWidth}px` },
      'data-build': BUILD_STAMP,
      onKeyDown: onRootKeyDown,
    },
      h('div', { className: 'launcher-rail', role: 'navigation', 'aria-label': 'launcher rail' },
        renderSlot('shell.leading', {}),
        h('button', {
          type: 'button',
          className: 'launcher-rail__dock',
          'aria-label': '开关右栏',
          'aria-pressed': dockOpen,
          title: '开关右栏（宽度 320–520）',
          onClick: () => {
            // 双管：宿主命令切它自己的 expanded 状态；轨道由外壳保证（否则内容开、列宽不开）
            const hostOk = toggleRightbarHost()
            setDockSticky((open) => !open)
            // 空态没有会话时宿主命令会被 blocked：给出可见提示，别让用户以为按钮坏了
            if (!hostOk) {
              setTimeout(() => {
                const width = document.querySelector('.launcher-dock')?.getBoundingClientRect().width ?? 0
                if (width < 10) showLauncherToast('先打开一个会话再展开右栏')
              }, 350)
            }
          },
        }, '▤'),
        h('button', {
          type: 'button',
          className: 'launcher-rail__drawer',
          'aria-label': '开关侧栏',
          'aria-expanded': narrow ? drawerOpen : true,
          onClick: () => setDrawerOpen((open) => !open),
        }, '≡'),
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
      h('aside', { className: 'launcher-sidebar', 'data-drawer': narrow ? (drawerOpen ? 'open' : 'closed') : 'static' },
        collapsed ? null : renderSlot('sidebar', { collapsed, width: 280, drawer: narrow })),
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
          }, String(mode))),
          h('button', {
            type: 'button',
            className: 'launcher-theme-chip',
            'aria-label': '切换日夜模式',
            'aria-pressed': themeMode === 'dark',
            title: themeMode === 'dark' ? '当前：深色，点击切浅色' : '当前：浅色，点击切深色',
            'data-theme-mode': themeMode,
            onClick: toggleTheme,
          }, themeMode === 'dark' ? '🌙' : '☀️')),
        h('div', { className: 'launcher-panes' },
          paneKeys.map((key, index) => h('div', {
            key,
            className: 'launcher-pane',
            // 第一格反映真实 entryKey（断言用），其余格是分屏占位 key
            'data-pane': index === 0 ? (activePanelId ?? 'conversation') : key,
          },
            index === 0
              ? [
                emptyDecision.render && !starterFilled
                  ? h(EmptyStateCard, { key: 'empty', layout: cardLayout(viewportWidth, typeof window === 'undefined' ? 900 : window.innerHeight), onFilled: () => setStarterFilled(true) })
                  : null,
                activePanelId !== null && PANELS_NEEDING_BACK.includes(activePanelId)
                  ? h('div', { key: 'panel-back', className: 'launcher-panel-back' },
                    h('button', { type: 'button', className: 'launcher-panel-back__btn', onClick: () => goConversation(CURRENT_CTX) }, '← 返回会话'))
                  : null,
                // 宿主子树（含 composer）必须照常渲染：卡片不能顶掉输入框
                h('div', { key: 'host-main', className: 'launcher-pane__host' }, renderSlot('main', {}, { entryKey: activePanelId ?? 'conversation' })),
              ]
              : renderSlot('main', {}, { entryKey: key }))))),
      h('aside', {
        className: 'launcher-dock',
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
              onDoubleClick: () => { setDragWidth(DOCK_WIDTH); try { window.localStorage.setItem('dsh.launcher.dockWidth', String(DOCK_WIDTH)) } catch { /* 忽略 */ } },
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
      devOpen ? h('div', { className: 'launcher-diag', role: 'dialog', 'aria-label': '外壳调试面板', onKeyDown: onDiagKeyDown },
        h('header', { className: 'launcher-diag__head' },
          h('span', null, '外壳调试面板（开发用）'),
          h('button', { type: 'button', onClick: () => setDevOpen(false), 'aria-label': '关闭调试面板' }, '✕')),
        h('dl', { className: 'launcher-diag__list' },
          h('div', null, h('dt', null, '当前面板'), h('dd', null, String(activePanelId ?? 'conversation'))),
          h('div', null, h('dt', null, '分屏档位'), h('dd', null, String(splitMode))),
          h('div', null, h('dt', null, '右栏宽度'), h('dd', null, `${dockWidth}px${dockCanShow ? '' : '（隐藏）'}`)),
          h('div', null, h('dt', null, '代码块换行'), h('dd', null, wrapOn ? '开' : '关')),
          h('div', null, h('dt', null, '权限范围'), h('dd', null, permissionLabel)))) : null,
      paletteOpen ? h('div', { className: 'launcher-palette', 'data-index': paletteIndex, role: 'dialog', 'aria-modal': 'true', 'aria-label': '命令面板' },
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
    // M6：整份 cordis ctx 只在 DEBUG 下暴露，发布版不挂（同 __DSH_LAUNCHER_FILL__）
    if (typeof window !== 'undefined' && window.__DSH_LAUNCHER_DEBUG__ === true) {
      window.__DSH_LAUNCHER_CTX__ = ctx
    }
    CURRENT_CTX = ctx
    // FR-39/42/43：会话流动作（真槽，槽在才注册）
    const turnDisposers = registerTurnActions(ctx)
    const permDisposers = registerPermissionPill(ctx)
    const modelDisposers = registerModelChip(ctx)
    const diagDisposers = registerContextDiagnostics(ctx)
    const dockDisposers = registerComposerDock(ctx)
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
    // M2：禁止时间窗。按 05-§6.3.0，只在「本次 open 之后」忽略占位者那一次 close（一次），
    // 之后的任何 close（含用户主动关）一律生效。
    let dockCloseGuardArmed = false
    let dockCloseGuardUsed = true
    const setDockOpen = (next) => {
      if (next === true) {
        dockCloseGuardArmed = true
        dockCloseGuardUsed = false
      }
      if (next === false && dockCloseGuardArmed && !dockCloseGuardUsed) {
        dockCloseGuardUsed = true
        return
      }
      dockOpen = next
      try { window.__DSH_LAUNCHER_DOCK__ = dockOpen } catch { /* 忽略 */ }
      for (const listener of dockListeners) listener()
      try {
        window.dispatchEvent(new CustomEvent('launcher:dock', { detail: { open: dockOpen } }))
      } catch {
        /* 事件派发失败不影响状态 */
      }
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
      for (const dockDispose of dockDisposers) {
        try { dockDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const modelDispose of modelDisposers) {
        try { modelDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const diagDispose of diagDisposers) {
        try { diagDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
      for (const permDispose of permDisposers) {
        try { permDispose?.() } catch { /* 卸载期的失败不再向上抛 */ }
      }
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
  return { inject: ['slots', 'shortcuts', 'theme'], apply }
} })
