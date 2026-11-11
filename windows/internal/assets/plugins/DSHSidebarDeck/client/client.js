window.__ModuleLoader__.load({ id: "dsh-sidebar-deck", factory: (require) => { try {
  const React = require('react')
  const h = React.createElement
  const NS = 'dsh-sidebar-deck'

  /* ────────────────────────── 样式 ──────────────────────────
     只依赖 --dsw-alias-* 设计令牌（官方别名层），不碰内部 CSS module 哈希类名。 */
  const CSS = `
/* 排版纪律：字号只有四档，每档一个职责（L0 品牌 / L1 分组标题 / L2 行文字 / L3 辅助信息）。
   颜色只有三级文字（墨 / 中灰 / 浅灰），强调色只给运行中的状态点。
   只依赖 --dsw-alias-* 官方别名令牌，不碰内部 CSS module 哈希类名。 */
.dsh-deck-root{
  --dk-line:var(--dsw-alias-border-l2,#e3e3e8);
  --dk-line2:color-mix(in srgb,var(--dk-line) 55%,transparent);
  --dk-card:var(--dsw-alias-bg-layer-1,#fff);
  --dk-ink:var(--dsw-alias-label-primary,#1c1c21);
  --dk-ink2:var(--dsw-alias-label-secondary,#4b4b53);
  --dk-ink3:var(--dsw-alias-label-tertiary,#8c8c95);
  --dk-hov:color-mix(in srgb,var(--dk-ink) 4.5%,transparent);
  --dk-sel:color-mix(in srgb,var(--dk-ink) 6.5%,transparent);
  --dk-accent:var(--dsw-alias-brand-primary,#4f46e5);
  --dk-bg:color-mix(in srgb,var(--dk-ink) 3.4%,var(--dk-card));
  --fs-l0:15px; --fs-l1:14px; --fs-l2:12px; --fs-l3:11px;
  height:100%;width:100%;display:flex;flex-direction:column;min-height:0;overflow:hidden;
  padding:0;box-sizing:border-box;color:var(--dk-ink2);
  background:var(--dk-bg);
  font:13px/1.45 var(--dsh-font-family-text-default,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif);
  -webkit-font-smoothing:antialiased;
}
.dsh-deck-root *{box-sizing:border-box}
.dsh-deck-root button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:left}
.dsh-deck-root button:focus-visible{outline:2px solid var(--dk-accent);outline-offset:-2px;border-radius:6px}
@media (prefers-reduced-motion: reduce){
  .dsh-deck-root *{transition:none!important;animation:none!important}
}
/* 品牌 */
.dsh-deck-brand{display:flex;align-items:center;gap:8px;height:46px;padding:0 8px 0 6px;flex:none}
.dsh-deck-mark{display:flex;align-items:center;gap:7px;flex:1;min-width:0;cursor:default}
.dsh-deck-name{font-size:var(--fs-l0);font-weight:650;letter-spacing:-.012em;color:var(--dk-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-deck-badge{font-size:var(--fs-l3);font-weight:700;letter-spacing:.05em;color:var(--dk-card);background:var(--dk-ink);border-radius:4px;padding:1.5px 4px;line-height:1;flex:none}
.dsh-deck-iconbtn{width:26px;height:26px;border-radius:6px;display:grid;place-items:center;color:var(--dk-ink3);flex:none;transition:background .15s,color .15s}
.dsh-deck-iconbtn:hover{background:var(--dk-hov);color:var(--dk-ink)}
.dsh-deck-iconbtn svg{width:15px;height:15px;display:block}
.dsh-deck-iconbtn.sm{width:22px;height:22px}
.dsh-deck-iconbtn.sm svg{width:13px;height:13px}
.dsh-deck-root .dsh-deck-new{flex:none;display:flex;align-items:center;justify-content:center;gap:7px;height:32px;margin:2px 10px 14px;border-radius:8px;background:var(--dk-card);box-shadow:0 1px 2px rgba(0,0,0,.05),0 0 0 .5px color-mix(in srgb,var(--dk-ink) 8%,transparent);font-size:var(--fs-l2);font-weight:500;color:var(--dk-ink);letter-spacing:-.005em;transition:box-shadow .15s}
.dsh-deck-root .dsh-deck-new:hover{box-shadow:0 1px 3px rgba(0,0,0,.1),0 0 0 .5px color-mix(in srgb,var(--dk-ink) 13%,transparent)}
.dsh-deck-root .dsh-deck-new svg{width:15px;height:15px;color:var(--dk-ink3);display:block}
/* 区块 */
.dsh-deck-stack{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;padding:0 10px 12px;scrollbar-width:none}
.dsh-deck-stack::-webkit-scrollbar{width:0;height:0}
.dsh-deck-block{position:relative;display:flex;flex-direction:column;min-width:0}
.dsh-deck-block[data-dragging="true"]{opacity:.35}
.dsh-deck-block[data-deck-block="workspace"]{flex:1;min-height:150px;overflow:hidden}
.dsh-deck-block:not([data-deck-block="workspace"]){flex:none}
.dsh-deck-hd{display:flex;align-items:center;gap:8px;height:30px;margin-top:16px;user-select:none}
.dsh-deck-block:first-child .dsh-deck-hd{margin-top:2px}
.dsh-deck-grip{width:16px;height:20px;display:grid;place-items:center;color:var(--dk-ink3);opacity:0;cursor:grab;touch-action:none;border-radius:5px;font-size:var(--fs-l2);line-height:1;flex:none}
.dsh-deck-block:hover .dsh-deck-grip,.dsh-deck-chip:hover .dsh-deck-grip{opacity:.7}
.dsh-deck-grip:hover{background:var(--dk-hov);color:var(--dk-ink);opacity:1}
.dsh-deck-grip:active{cursor:grabbing}
.dsh-deck-root .dsh-deck-title{display:flex;align-items:center;gap:6px;flex:none;height:30px;font-size:var(--fs-l1);font-weight:700;letter-spacing:-.014em;color:var(--dk-ink);text-align:left;white-space:nowrap}
.dsh-deck-root .dsh-deck-title:hover{color:var(--dk-ink)}
.dsh-deck-caret{width:12px;height:12px;display:grid;place-items:center;opacity:.8;flex:none;color:var(--dk-ink3);margin-left:-2px}
.dsh-deck-caret svg{width:11px;height:11px;display:block}
.dsh-deck-count{font-size:var(--fs-l3);font-weight:600;color:var(--dk-ink3);font-variant-numeric:tabular-nums;flex:none}
.dsh-deck-rule{flex:1;height:.5px;background:var(--dk-line);border-radius:1px;min-width:8px}
.dsh-deck-hdacts{display:flex;align-items:center;gap:0;flex:none}
.dsh-deck-bd{padding:0 0 10px;min-width:0}
.dsh-deck-block[data-deck-block="workspace"] .dsh-deck-bd{flex:1;display:flex;flex-direction:column;min-height:0;padding-bottom:4px}
/* 行 */
.dsh-deck-row{flex:none;display:flex;align-items:center;gap:7px;height:25px;padding:0 8px;border-radius:6px;cursor:default;min-width:0;color:var(--dk-ink2);transition:background .15s,color .15s}
.dsh-deck-row:hover{background:var(--dk-hov);color:var(--dk-ink)}
.dsh-deck-row .dsh-deck-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-l2);line-height:1.4}
.dsh-deck-row .dsh-deck-m{font-size:var(--fs-l3);font-weight:500;color:var(--dk-ink3);flex:none;font-variant-numeric:tabular-nums;line-height:1.4}
.dsh-deck-row.is-current{background:var(--dk-sel);color:var(--dk-ink)}
.dsh-deck-row.is-current .dsh-deck-t{font-weight:500}
.dsh-deck-plugrow{width:100%;cursor:pointer}
.dsh-deck-plugrow .dsh-deck-m{color:var(--dk-ink3)}
.dsh-deck-dot{width:5px;height:5px;border-radius:50%;flex:none;background:transparent}
.dsh-deck-dot.run{background:var(--dk-accent);animation:dsh-deck-pulse 1.8s infinite}
.dsh-deck-dot.on{background:var(--dk-ink)}
@keyframes dsh-deck-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dk-accent) 35%,transparent)}70%{box-shadow:0 0 0 4px transparent}100%{box-shadow:0 0 0 0 transparent}}
/* 面板：白卡 + 发丝分隔 + 折叠行 + 管理浮层 */
.dsh-deck-panelcard{position:relative}
.dsh-deck-panelrows{display:flex;flex-direction:column;max-height:min(26vh,220px);overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dk-line) transparent}
.dsh-deck-panelrows::-webkit-scrollbar{width:4px}
.dsh-deck-panelrows::-webkit-scrollbar-thumb{background:var(--dk-line);border-radius:4px}
.dsh-deck-root .dsh-deck-panelrow{flex:none;display:flex;align-items:center;gap:9px;height:29px;padding:0 9px 0 10px;min-width:0;font-size:var(--fs-l2);color:var(--dk-ink2);width:100%;position:relative;transition:background .15s,color .15s;border-radius:7px}
.dsh-deck-root .dsh-deck-panelrow + .dsh-deck-panelrow:before{content:"";position:absolute;left:10px;right:10px;top:0;height:.5px;background:var(--dk-line2)}
.dsh-deck-root .dsh-deck-panelrow:hover{background:var(--dk-hov);color:var(--dk-ink)}
.dsh-deck-root .dsh-deck-panelrow .dsh-deck-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-deck-root .dsh-deck-panelrow>div[data-slot]{display:contents}
.dsh-deck-root .dsh-deck-panelrow svg{width:15px;height:15px;display:block;flex:none;color:var(--dk-ink3)}
/* 选中态：浅墨底 + 左侧 2px 竖条，比加粗字更安静也更容易扫 */
.dsh-deck-root .dsh-deck-panelrow.is-active{color:var(--dk-ink);background:var(--dk-sel)}
.dsh-deck-root .dsh-deck-panelrow.is-active:before{content:"";position:absolute;left:2px;top:6px;bottom:6px;width:2px;border-radius:2px;background:var(--dk-ink)}
.dsh-deck-root .dsh-deck-panelrow.is-active svg{color:var(--dk-ink2)}
.dsh-deck-root .dsh-deck-panelfold{flex:none;display:flex;align-items:center;justify-content:center;height:28px;width:100%;margin-top:2px;font-size:var(--fs-l3);font-weight:500;color:var(--dk-ink3);transition:background .15s,color .15s}
.dsh-deck-root .dsh-deck-panelfold span{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;background:var(--dk-hov);transition:background .15s,color .15s}
.dsh-deck-root .dsh-deck-panelfold:hover span{background:var(--dk-sel);color:var(--dk-ink2)}
.dsh-deck-root .dsh-deck-panelfold svg{width:11px;height:11px;display:block}
.dsh-deck-panelmanage{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:40;background:var(--dk-card);border-radius:11px;box-shadow:0 16px 44px rgba(20,22,30,.16),0 2px 8px rgba(20,22,30,.06),0 0 0 .5px color-mix(in srgb,var(--dk-ink) 9%,transparent);padding:5px;max-height:300px;overflow:auto}
.dsh-deck-pmhd{display:flex;align-items:center;gap:8px;padding:7px 7px 8px 9px;font-size:var(--fs-l3);font-weight:650;letter-spacing:.02em;color:var(--dk-ink2)}
.dsh-deck-pmall{margin-left:auto;display:flex;align-items:center;gap:10px;font-size:var(--fs-l3);font-weight:500;color:var(--dk-ink3)}
.dsh-deck-pmall button{font-size:var(--fs-l3);font-weight:500;color:var(--dk-ink3)}
.dsh-deck-pmall button:hover{color:var(--dk-ink)}
.dsh-deck-pmhd .x{margin-left:auto;width:20px;height:20px;border-radius:5px;display:grid;place-items:center;color:var(--dk-ink3)}
.dsh-deck-pmhd .x:hover{background:var(--dk-hov);color:var(--dk-ink)}
.dsh-deck-pmhd .x svg{width:11px;height:11px;display:block}
.dsh-deck-pmrow{display:flex;align-items:center;gap:9px;height:31px;padding:0 9px;border-radius:8px;font-size:var(--fs-l2);color:var(--dk-ink2)}
.dsh-deck-pmrow:hover{background:var(--dk-hov);color:var(--dk-ink)}
.dsh-deck-pmrow svg{width:15px;height:15px;color:var(--dk-ink3);flex:none}
.dsh-deck-pmrow .dsh-deck-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-deck-sw{flex:none;width:28px;height:16px;border-radius:999px;background:var(--dk-line);position:relative;transition:background .16s;cursor:pointer}
.dsh-deck-sw:after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.22);transition:transform .16s}
.dsh-deck-sw.on{background:var(--dk-ink)}
.dsh-deck-sw.on:after{transform:translateX(12px)}
/* 官方插槽内的列表 */
.dsh-deck-slot{min-height:0;overflow:hidden;display:flex;flex-direction:column}
.dsh-deck-slot>*{min-width:0;min-height:0;flex:1}
.dsh-deck-slot [class*="sectionHeader"]{position:absolute;top:2px;right:2px;height:24px;min-height:24px;width:auto;display:flex;align-items:center;gap:0;padding:0;z-index:2}
.dsh-deck-slot [class*="sectionHeader"]>span[class*="sectionLabel"]{display:none}
.dsh-deck-slot [class*="iconButton"]{width:24px;height:24px;border-radius:6px;color:var(--dk-ink3)}
.dsh-deck-slot [class*="iconButton"]:hover{background:var(--dk-hov);color:var(--dk-ink)}
.dsh-deck-slot [role="treeitem"]{height:26px;min-height:26px;padding:0 8px;border-radius:6px;font-size:var(--fs-l2);color:var(--dk-ink2)}
.dsh-deck-slot [role="treeitem"] span{font-size:var(--fs-l2)}
.dsh-deck-slot [role="treeitem"] [class*="time"]{font-size:var(--fs-l3)}
.dsh-deck-slot [role="treeitem"]:hover{background:var(--dk-hov);color:var(--dk-ink)}
.dsh-deck-slot [role="treeitem"][class*="selected"]{background:var(--dk-sel);color:var(--dk-ink);font-weight:500}
.dsh-deck-slot [role="tree"]{padding:0 0 6px}
/* 底部 */
.dsh-deck-dock{flex:none;position:relative;display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-top:.5px solid var(--dk-line2)}
.dsh-deck-dock.is-empty{align-items:center}
.dsh-deck-dock.is-empty:before{content:attr(data-hint);font-size:var(--fs-l3);font-weight:500;color:var(--dk-ink3);padding:2px 0}
.dsh-deck-chip{display:flex;align-items:center;gap:3px;height:24px;padding:0 10px 0 2px;border:1px solid var(--dk-line);border-radius:999px;background:var(--dk-card);font-size:var(--fs-l3);font-weight:500;color:var(--dk-ink2)}
.dsh-deck-chip:hover{border-color:color-mix(in srgb,var(--dk-ink) 22%,transparent);color:var(--dk-ink)}
.dsh-deck-chip .dsh-deck-grip{width:14px;opacity:.4}
.dsh-deck-root .dsh-deck-chip .dsh-deck-title{flex:none;white-space:nowrap;font-size:var(--fs-l3);font-weight:500;letter-spacing:0;color:inherit;height:auto}
.dsh-deck-dockpop{position:absolute;left:10px;right:10px;bottom:calc(100% - 2px);z-index:30;background:var(--dk-card);border:.5px solid var(--dk-line);border-radius:10px;box-shadow:0 16px 44px rgba(20,22,30,.16),0 2px 8px rgba(20,22,30,.06),0 0 0 .5px rgba(20,22,30,.1);padding:6px;max-height:min(54vh,420px);overflow:auto}
.dsh-deck-pop-hd{padding:6px 8px 8px;font-size:var(--fs-l3);font-weight:500;letter-spacing:.03em;color:var(--dk-ink3)}
.dsh-deck-foot{flex:none;border-top:.5px solid var(--dk-line2);padding:6px 10px 8px}
.dsh-deck-marker{flex:none;border-radius:6px;border:1.5px dashed color-mix(in srgb,var(--dk-accent) 40%,transparent);background:color-mix(in srgb,var(--dk-accent) 4%,transparent);margin:2px 0}
.dsh-deck-stack>.dsh-deck-marker{height:26px}
.dsh-deck-dock>.dsh-deck-marker{height:24px;width:80px;margin:0}
.dsh-deck-zone-on{background:color-mix(in srgb,var(--dk-accent) 3%,transparent);outline:1.5px dashed color-mix(in srgb,var(--dk-accent) 26%,transparent);outline-offset:2px;border-radius:8px}
.dsh-deck-clone{position:fixed;z-index:2147483200;pointer-events:none;background:var(--dk-bg);border:.5px solid var(--dk-line);border-radius:8px;box-shadow:0 16px 44px rgba(20,22,30,.16),0 2px 8px rgba(20,22,30,.06);padding:2px 4px;overflow:hidden}
.dsh-deck-clone .dsh-deck-grip{opacity:.6}
.dsh-deck-dragging,.dsh-deck-dragging *{cursor:grabbing!important;user-select:none!important}
.dsh-deck-rail{height:100%;width:100%;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0 10px;overflow:hidden}
.dsh-deck-rail .dsh-deck-iconbtn{width:34px;height:32px;border-radius:8px}
.dsh-deck-railsep{width:18px;height:1px;background:var(--dk-line2);margin:2px 0;flex:none}
.dsh-deck-railspacer{flex:1}
`
  function ensureStyles() {
    if (document.getElementById(NS + '-style')) return
    const style = document.createElement('style')
    style.id = NS + '-style'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  /* ────────────────────────── 常量 / 布局状态 ────────────────────────── */
  /* 只声明 sidebar 自己的子插槽；plugins.* 是根作用域插槽，只读不声明（声明会和官方插件管理页冲突）。 */
  const CHILDREN = {
    'sidebar.brand.mark': { kind: 'single', scope: 'root' },
    'sidebar.brand.name': { kind: 'single', scope: 'root' },
    'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
    'sidebar.panellist.actions': { kind: 'list', scope: 'root' },
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.footer.action': { kind: 'list', scope: 'root' }
  }
  const BLOCK_TITLES = { recent: '最近会话', workspace: '工作区', panels: '面板', plugins: '插件' }
  const BLOCKS = ['recent', 'workspace', 'panels', 'plugins']
  const LKEY = 'dsh-sidebar-deck-layout-v1'

  function defaultLayout() { return { stack: BLOCKS.slice(), dock: [], collapsed: {}, panelsHidden: {}, panelsExpanded: false } }
  function readLayout() {
    try {
      const raw = localStorage.getItem(LKEY)
      if (!raw) return defaultLayout()
      const value = JSON.parse(raw)
      if (!value || !Array.isArray(value.stack) || !Array.isArray(value.dock)) return defaultLayout()
      const seen = new Set()
      const stack = value.stack.filter((id) => BLOCKS.includes(id) && !seen.has(id) && (seen.add(id), true))
      const dock = value.dock.filter((id) => BLOCKS.includes(id) && !seen.has(id) && (seen.add(id), true))
      for (const id of BLOCKS) if (!seen.has(id)) stack.push(id)
      const collapsed = value.collapsed && typeof value.collapsed === 'object' ? value.collapsed : {}
      const panelsHidden = value.panelsHidden && typeof value.panelsHidden === 'object' ? value.panelsHidden : {}
      return { stack, dock, collapsed, panelsHidden, panelsExpanded: !!value.panelsExpanded }
    } catch (e) { return defaultLayout() }
  }
  let layoutValue = null
  const layoutSubs = new Set()
  function getLayout() { if (!layoutValue) layoutValue = readLayout(); return layoutValue }
  function setLayout(next) {
    layoutValue = next
    try { localStorage.setItem(LKEY, JSON.stringify(next)) } catch (e) { /* 允许失败 */ }
    for (const fn of layoutSubs) fn()
  }
  function useLayout() {
    const subscribe = React.useCallback((fn) => { layoutSubs.add(fn); return () => layoutSubs.delete(fn) }, [])
    return React.useSyncExternalStore(subscribe, getLayout, getLayout)
  }

  /* ────────────────────────── 小工具 ────────────────────────── */
  function relativeTime(ts) {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
    const diff = Date.now() - ts
    if (diff < 45e3) return '刚刚'
    if (diff < 36e5) return Math.max(1, Math.round(diff / 6e4)) + '分钟'
    if (diff < 864e5) return Math.max(1, Math.round(diff / 36e5)) + '小时'
    if (diff < 30 * 864e5) return Math.max(1, Math.round(diff / 864e5)) + '天'
    try { return new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) } catch (e) { return '' }
  }
  function icon(name) {
    const paths = {
      plus: 'M8 3v10M3 8h10',
      panelLeft: 'M13.5 1.5h-11a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-11a1 1 0 0 0-1-1ZM5.5 1.5v13',
      chevronDown: 'M4 6l4 4 4-4',
      chevronRight: 'M6 4l4 4-4 4',
      chevronUp: 'M4 10l4-4 4 4',
      reset: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3.2h-3.2',
      filter: 'M2 4h12M4.5 8h7M6.5 12h3',
      close: 'M4 4l8 8M12 4l-8 8'
    }
    return h('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d: paths[name] || '' }))
  }
  function useSnapshot(store, select) {
    const subscribe = React.useCallback((fn) => (store && store.subscribe ? store.subscribe(fn) : () => {}), [store])
    const snapshot = React.useSyncExternalStore(subscribe, () => (store && store.getSnapshot ? store.getSnapshot() : undefined), () => undefined)
    return React.useMemo(() => select(snapshot), [snapshot, select])
  }

  /* ────────────────────────── 数据 hooks ────────────────────────── */
  const RECENT_LIMIT = 12
  function useSessions(deck) {
    const store = sessionStore(deck)
    return useSnapshot(store, React.useCallback((snap) => {
      if (!snap || !snap.byId) return []
      const ids = Array.isArray(snap.ids) && snap.ids.length ? snap.ids : Object.keys(snap.byId)
      const rows = []
      for (const id of ids) {
        const row = snap.byId[id]
        if (!row || row.blank || row.origin === 'subagent') continue
        rows.push(row)
      }
      rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      return rows.slice(0, RECENT_LIMIT)
    }, []))
  }
  let resolveSlotLabel = null
  try { resolveSlotLabel = require('@deepseek-ai/dsh-client-ui-slots').resolveSlotLabel } catch (e) { resolveSlotLabel = null }
  const PANEL_LABELS = { plugins: '插件', schedules: '自动化任务', context: '上下文洞察', 'guizang-design': '歸藏设计' }
  function resolveLabel(label, id) {
    try {
      if (typeof resolveSlotLabel === 'function') {
        const value = resolveSlotLabel(label)
        if (typeof value === 'string' && value) return value
      }
    } catch (e) { /* 版本漂移时退回 id */ }
    if (typeof label === 'string' && label && !label.includes('.')) return label
    return PANEL_LABELS[id] || id
  }
  function usePanels(deck) {
    const slots = deck.slots
    const [rows, setRows] = React.useState([])
    React.useEffect(() => {
      if (!slots) return
      const read = () => {
        const entries = slots.entriesOfSlot('sidebar.panellist') || []
        const next = entries.map(({ options }) => ({ id: options && options.id, order: (options && options.order) || 0, label: resolveLabel(options && options.label, options && options.id) }))
          .filter((row) => row.id)
          .sort((a, b) => a.order - b.order)
        setRows(next)
      }
      read()
      return slots.subscribe('sidebar.panellist', read)
    }, [slots])
    return rows
  }

  /* 已安装插件：优先读插件管理面板的 /installed 清单（真实安装的插件），
     读不到时退回 plugins.item 插槽（官方设置项）。两条路都失败则只显示入口。 */
  function pluginLabel(item) {
    const desc = String((item && item.description) || '').split(/[·：:]/)[0].trim()
    if (desc && desc.length <= 14 && !/^dsh-/i.test(desc)) return desc
    const name = String((item && item.name) || '')
    return name.replace(/^@[^/]+\//, '').replace(/^dsh-/, '')
  }
  function useInstalledPlugins(deck) {
    const slots = deck.slots
    const [rows, setRows] = React.useState([])
    React.useEffect(() => {
      let alive = true
      const fallback = () => {
        if (!slots || !slots.entries) return
        try {
          const items = slots.entries('plugins.item') || []
          const next = items.map((entry) => {
            const options = (entry && entry.options) || {}
            const id = options.id || ''
            return { id, name: id, label: resolveLabel(options.label, id) }
          }).filter((row) => row.id)
          if (alive) setRows((current) => (current.length ? current : next))
        } catch (e) { /* 没有该插槽时忽略 */ }
      }
      const read = () => {
        fetch('/dsh-plugin-manager/installed').then((response) => (response.ok ? response.json() : null)).then((data) => {
          if (!alive) return
          if (!data || !Array.isArray(data.items)) { fallback(); return }
          const next = data.items
            .filter((item) => item && item.name && !item.broken)
            .map((item) => ({ id: item.name, name: item.name, label: pluginLabel(item), version: item.version }))
          setRows(next)
        }).catch(() => fallback())
      }
      read()
      fallback()
      const timer = setInterval(read, 20000)
      return () => { alive = false; clearInterval(timer) }
    }, [slots])
    return rows
  }
  function openPluginConfig(deck, id) {
    try {
      const nav = service(deck.ctx, 'pluginNavigation')
      if (nav && typeof nav.openBundle === 'function') { nav.openBundle(id); return true }
    } catch (e) { /* 回落 */ }
    try { selectPanel(deck, 'plugins'); return true } catch (e) { return false }
  }

  /* ────────────────────────── 区块 ────────────────────────── */
  function BlockHeader({ id, layout, onGripDown, count, actions }) {
    const collapsed = !!(layout.collapsed && layout.collapsed[id])
    return h('div', { className: 'dsh-deck-hd' },
      h('button', {
        className: 'dsh-deck-title',
        onClick: () => {
          const current = getLayout()
          setLayout({ ...current, collapsed: { ...(current.collapsed || {}), [id]: !collapsed } })
        },
        title: collapsed ? '展开' : '收起'
      },
        h('span', null, BLOCK_TITLES[id]),
        h('span', { className: 'dsh-deck-caret' }, icon(collapsed ? 'chevronRight' : 'chevronDown'))
      ),
      count || null,
      h('span', { className: 'dsh-deck-rule' }),
      actions || null,
      h('span', { className: 'dsh-deck-hdacts' },
        h('span', { className: 'dsh-deck-grip', title: '拖动排序', onPointerDown: (event) => onGripDown(event, id) }, '≡')
      )
    )
  }
  function PanelsCount({ deck, layout }) {
    const rows = usePanels(deck)
    const hidden = (layout && layout.panelsHidden) || {}
    const visible = rows.filter((row) => !hidden[row.id]).length
    return visible ? h('span', { className: 'dsh-deck-count' }, String(visible)) : null
  }
  function PluginsCount({ deck }) {
    const rows = useInstalledPlugins(deck)
    return rows.length ? h('span', { className: 'dsh-deck-count' }, String(rows.length)) : null
  }
  function RecentCount({ deck }) {
    const rows = useSessions(deck)
    return rows.length ? h('span', { className: 'dsh-deck-count' }, String(rows.length)) : null
  }
  function WorkspaceCount({ useWorkspaces }) {
    const list = useWorkspaces ? useWorkspaces((value) => value) : null
    const count = Array.isArray(list) ? list.length : 0
    return count ? h('span', { className: 'dsh-deck-count' }, String(count)) : null
  }
  function BlockBody({ id, layout, deck, renderSlot, usePanelInfo, useWorkspaces, onGripDown, embedded, manageOpen, onToggleManage, onTogglePanel }) {
    const collapsed = !!(layout.collapsed && layout.collapsed[id])
    let body = null
    if (!collapsed) {
      if (id === 'recent') body = h(RecentBody, { deck })
      else if (id === 'workspace') body = h(SlotBody, { renderSlot, name: 'sidebar.workspaces', props: { wide: true, expandSidebar: () => toggleSidebar(deck) } })
      else if (id === 'panels') body = h(PanelsBody, { deck, renderSlot, usePanelInfo, layout, manageOpen, onToggleManage, onTogglePanel })
      else if (id === 'plugins') body = h(PluginsBody, { deck })
      else if (id === 'tools') body = h(SlotBody, { renderSlot, name: 'sidebar.footer.action', props: { wide: true } })
    }
    if (embedded) return h('div', { className: 'dsh-deck-bd' }, body)
    return h('section', { className: 'dsh-deck-block', 'data-deck-block': id, 'data-collapsed': collapsed ? 'true' : 'false' },
      h(BlockHeader, {
        id,
        layout,
        onGripDown,
        count: id === 'recent' ? h(RecentCount, { deck }) : id === 'workspace' ? h(WorkspaceCount, { useWorkspaces }) : id === 'panels' ? h(PanelsCount, { deck, layout }) : id === 'plugins' ? h(PluginsCount, { deck }) : null,
        actions: id === 'panels' ? h('button', {
          className: 'dsh-deck-iconbtn sm',
          title: '管理面板',
          onClick: () => onToggleManage()
        }, icon('filter')) : null
      }),
      !collapsed && h('div', { className: 'dsh-deck-bd' + (id === 'workspace' || id === 'tools' ? ' dsh-deck-slot' : '') }, body)
    )
  }
  function RecentBody({ deck }) {
    const rows = useSessions(deck)
    if (!rows.length) return h('div', { className: 'dsh-deck-row', style: { color: 'var(--dk-ink3)', cursor: 'default' } }, h('span', { className: 'dsh-deck-t' }, '还没有会话'))
    return rows.map((row) => {
      const current = row.retainedBy && row.retainedBy.mainView > 0
      return h('div', {
        key: row.id,
        className: 'dsh-deck-row' + (current ? ' is-current' : ''),
        title: row.displayTitle || row.title || row.id,
        onClick: () => openSession(deck, row.id)
      },
        h('span', { className: 'dsh-deck-dot' + (row.running ? ' run' : current ? ' on' : '') }),
        h('span', { className: 'dsh-deck-t' }, row.displayTitle || row.title || row.id),
        h('span', { className: 'dsh-deck-m' }, relativeTime(row.updatedAt))
      )
    })
  }
  function SlotBody({ renderSlot, name, props }) {
    return renderSlot(name, props)
  }
  function PanelsBody({ deck, renderSlot, usePanelInfo, layout, manageOpen, onToggleManage, onTogglePanel }) {
    const all = usePanels(deck)
    const panelInfo = usePanelInfo ? usePanelInfo((info) => info) : null
    const active = panelInfo && panelInfo.activePanelId
    const hidden = (layout && layout.panelsHidden) || {}
    const visible = all.filter((row) => !hidden[row.id])
    const expanded = !!(layout && layout.panelsExpanded)
    const canFold = visible.length > 4
    const rows = canFold && !expanded ? visible.slice(0, 4) : visible
    return h('div', { className: 'dsh-deck-panelcard' },
      h('div', { className: 'dsh-deck-panelrows' }, rows.map((row) =>
        h('button', {
          key: row.id,
          className: 'dsh-deck-panelrow' + (row.id === active ? ' is-active' : ''),
          title: row.label,
          onClick: () => selectPanel(deck, row.id)
        },
          renderSlot('sidebar.panellist', { size: 15, active: row.id === active }, { only: row.id }),
          h('span', { className: 'dsh-deck-label' }, row.label)
        )
      )),
      canFold ? h('button', {
        className: 'dsh-deck-panelfold',
        onClick: () => {
          const current = getLayout()
          setLayout({ ...current, panelsExpanded: !expanded })
        }
      },
        h('span', null, expanded ? '收起' : '显示其余 ' + (visible.length - 4) + ' 个'),
        icon(expanded ? 'chevronUp' : 'chevronDown')
      ) : null,
      manageOpen ? h('div', { className: 'dsh-deck-panelmanage' },
        h('div', { className: 'dsh-deck-pmhd' },
          h('span', null, '管理面板'),
          h('span', { className: 'dsh-deck-pmall' },
            h('button', { onClick: () => setPanelsVisibility(all, false) }, '全部隐藏'),
            h('button', { onClick: () => setPanelsVisibility(all, true) }, '全部显示'),
            h('button', { className: 'x', title: '关闭', onClick: () => onToggleManage() }, icon('close'))
          )
        ),
        all.map((row) => h('div', { key: row.id, className: 'dsh-deck-pmrow' },
          renderSlot('sidebar.panellist', { size: 15, active: false }, { only: row.id }),
          h('span', { className: 'dsh-deck-label' }, row.label),
          h('button', {
            className: 'dsh-deck-sw' + (hidden[row.id] ? '' : ' on'),
            role: 'switch',
            'aria-checked': !hidden[row.id],
            'aria-label': row.label,
            title: hidden[row.id] ? '显示' : '隐藏',
            onClick: () => onTogglePanel(row.id)
          })
        ))
      ) : null
    )
  }

  function PluginsBody({ deck }) {
    const rows = useInstalledPlugins(deck)
    if (!rows.length) {
      return h('div', { className: 'dsh-deck-row' },
        h('span', { className: 'dsh-deck-t' }, '未读取到已安装插件'),
        h('span', { className: 'dsh-deck-m' }, '插件管理')
      )
    }
    return rows.map((row) => h('button', {
      key: row.id,
      className: 'dsh-deck-row dsh-deck-plugrow',
      title: row.label + (row.version ? ' · ' + row.version : ''),
      onClick: () => openPluginConfig(deck, row.id)
    },
      h('span', { className: 'dsh-deck-t' }, row.label),
      row.version ? h('span', { className: 'dsh-deck-m' }, row.version) : null
    ))
  }

  /* 服务全部按需取：deck 只 inject slots，其余服务缺失时降级而不是让侧栏起不来。 */
  function service(ctx, name) {
    try { return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined } catch (e) { return undefined }
  }
  function sessionStore(deck) { const sessions = service(deck.ctx, 'sessions'); return sessions && sessions.list ? sessions.list : undefined }
  function startSession(deck) { try { const nav = service(deck.ctx, 'uiWorkspace'); if (nav && nav.startSession) nav.startSession() } catch (e) {} }
  function openSession(deck, id) { try { const nav = service(deck.ctx, 'uiWorkspace'); if (nav && nav.openSession) nav.openSession(id) } catch (e) {} }
  function toggleSidebar(deck) { try { const layout = deck.layout || service(deck.ctx, 'layout'); if (layout && layout.toggleSidebar) layout.toggleSidebar() } catch (e) {} }
  function selectPanel(deck, id) { try { const layout = deck.layout || service(deck.ctx, 'layout'); if (layout && layout.selectPanel) layout.selectPanel(id) } catch (e) {} }
  /* 批量设置面板显隐：全部显示 = 清空 hidden，全部隐藏 = 全部标记 hidden。 */
  function setPanelsVisibility(rows, visible) {
    const current = getLayout()
    const hidden = { ...(current.panelsHidden || {}) }
    for (const row of rows || []) {
      if (visible) delete hidden[row.id]
      else hidden[row.id] = true
    }
    setLayout({ ...current, panelsHidden: hidden })
  }

  /* ────────────────────────── Deck ────────────────────────── */
  function Deck(props) {
    const { deck, collapsed, drawer, renderSlot, usePanelInfo, useWorkspaces } = props
    ensureStyles()
    const layout = useLayout()
    const stackRef = React.useRef(null)
    const dockRef = React.useRef(null)
    const dragRef = React.useRef(null)
    const handlersRef = React.useRef({})
    const [openDock, setOpenDock] = React.useState(null)
    const [manageOpen, setManageOpen] = React.useState(false)

    function toggleManage() { setManageOpen((value) => !value) }
    function togglePanel(id) {
      const current = getLayout()
      const hidden = { ...(current.panelsHidden || {}) }
      if (hidden[id]) delete hidden[id]
      else hidden[id] = true
      setLayout({ ...current, panelsHidden: hidden })
    }

    /* 拖动：处理器只建一次，startDrag 时挂到 window 上 */
    React.useEffect(() => {
      function onMove(event) {
        const drag = dragRef.current
        if (!drag) return
        if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) < 4) return
        drag.moved = true
        drag.ghost.style.left = event.clientX - drag.offX + 'px'
        drag.ghost.style.top = event.clientY - drag.offY + 'px'
        const zones = []
        if (stackRef.current) zones.push({ zone: 'stack', el: stackRef.current })
        if (dockRef.current) zones.push({ zone: 'dock', el: dockRef.current })
        let hit = null
        for (const zone of zones) {
          const rect = zone.el.getBoundingClientRect()
          if (event.clientX >= rect.left - 4 && event.clientX <= rect.right + 4 && event.clientY >= rect.top - 4 && event.clientY <= rect.bottom + 4) { hit = zone; break }
        }
        if (!hit) return
        const horizontal = hit.zone === 'dock'
        const kids = [...hit.el.querySelectorAll('[data-deck-block]')].filter((el) => el !== drag.source)
        let before = null
        for (const kid of kids) {
          const rect = kid.getBoundingClientRect()
          if (horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2) { before = kid; break }
        }
        hit.el.insertBefore(drag.marker, before)
        if (drag.zoneEl && drag.zoneEl !== hit.el) drag.zoneEl.classList.remove('dsh-deck-zone-on')
        hit.el.classList.add('dsh-deck-zone-on')
        drag.zoneEl = hit.el
      }
      function onUp() {
        const drag = dragRef.current
        if (!drag) return
        dragRef.current = null
        window.removeEventListener('pointermove', handlersRef.current.move)
        window.removeEventListener('pointerup', handlersRef.current.up)
        window.removeEventListener('pointercancel', handlersRef.current.up)
        document.body.classList.remove('dsh-deck-dragging')
        drag.ghost.remove()
        drag.source.removeAttribute('data-dragging')
        if (drag.zoneEl) drag.zoneEl.classList.remove('dsh-deck-zone-on')
        if (!drag.moved) { drag.marker.remove(); return }
        const host = drag.marker.parentElement
        if (!host) { drag.marker.remove(); return }
        const zone = host === dockRef.current ? 'dock' : 'stack'
        const children = [...host.children]
        const markerIndex = children.indexOf(drag.marker)
        if (markerIndex < 0) { drag.marker.remove(); return }
        let count = 0
        for (let i = 0; i < markerIndex; i += 1) {
          const child = children[i]
          if (child === drag.source) continue
          if (child.getAttribute && child.getAttribute('data-deck-block')) count += 1
        }
        drag.marker.remove()
        const current = getLayout()
        const stack = current.stack.filter((id) => id !== drag.id)
        const dock = current.dock.filter((id) => id !== drag.id)
        const target = zone === 'dock' ? dock : stack
        target.splice(Math.min(count, target.length), 0, drag.id)
        if (stack.length === 0) { stack.push(drag.id); const at = dock.indexOf(drag.id); if (at >= 0) dock.splice(at, 1) }
        setLayout({ ...current, stack, dock })
      }
      handlersRef.current = { move: onMove, up: onUp }
      return () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
    }, [])

    function startDrag(event, id) {
      if (event.button !== 0) return
      const source = event.currentTarget.closest('[data-deck-block]')
      if (!source) return
      event.preventDefault()
      const rect = source.getBoundingClientRect()
      const ghost = source.cloneNode(true)
      ghost.classList.add('dsh-deck-clone')
      ghost.style.width = rect.width + 'px'
      ghost.style.left = rect.left + 'px'
      ghost.style.top = rect.top + 'px'
      document.body.appendChild(ghost)
      const marker = document.createElement('div')
      marker.className = 'dsh-deck-marker'
      source.setAttribute('data-dragging', 'true')
      document.body.classList.add('dsh-deck-dragging')
      dragRef.current = {
        id, source, ghost, marker, moved: false,
        startX: event.clientX, startY: event.clientY,
        offX: event.clientX - rect.left, offY: event.clientY - rect.top,
        zoneEl: null
      }
      window.addEventListener('pointermove', handlersRef.current.move)
      window.addEventListener('pointerup', handlersRef.current.up)
      window.addEventListener('pointercancel', handlersRef.current.up)
    }

    const wide = !collapsed
    const settingsSeat = renderSlot('sidebar.settings', { wide })

    if (!wide) {
      return h('div', { className: 'dsh-deck-root' },
        h('div', { className: 'dsh-deck-rail' },
          h('button', { className: 'dsh-deck-iconbtn', title: '展开侧栏', onClick: () => { toggleSidebar(deck) } },
            renderSlot('sidebar.brand.mark', { size: 22 }, { fallback: icon('panelLeft') })),
          h('span', { className: 'dsh-deck-railsep' }),
          h('button', { className: 'dsh-deck-iconbtn', title: '新会话', onClick: () => { startSession(deck) } }, icon('plus')),
          h('span', { className: 'dsh-deck-railspacer' }),
          settingsSeat
        )
      )
    }

    const bodyProps = { deck, layout, renderSlot, usePanelInfo, useWorkspaces, manageOpen, onToggleManage: toggleManage, onTogglePanel: togglePanel }
    return h('div', { className: 'dsh-deck-root' + (drawer ? ' is-drawer' : '') },
      h('div', { className: 'dsh-deck-brand' },
        h('div', { className: 'dsh-deck-mark' },
          renderSlot('sidebar.brand.mark', { size: 22 }, { fallback: null }),
          h('span', { className: 'dsh-deck-name' }, 'deepseek'),
          h('span', { className: 'dsh-deck-badge' }, 'HARNESS')
        ),
        h('button', { className: 'dsh-deck-iconbtn', title: '重置布局', onClick: () => setLayout(defaultLayout()) }, icon('reset')),
        h('button', { className: 'dsh-deck-iconbtn', title: '收起侧栏', onClick: () => { toggleSidebar(deck) } }, icon('panelLeft'))
      ),
      h('button', { className: 'dsh-deck-new', onClick: () => { startSession(deck) } }, icon('plus'), '新会话'),
      h('div', { className: 'dsh-deck-stack', ref: stackRef },
        layout.stack.map((id) => h(BlockBody, { key: id, id, ...bodyProps, onGripDown: startDrag }))
      ),
      h('div', {
        className: 'dsh-deck-dock' + (layout.dock.length ? '' : ' is-empty'),
        ref: dockRef,
        'data-hint': '拖动区块到这里可收成入口'
      },
        layout.dock.map((id) => h('div', { key: id, className: 'dsh-deck-chip', 'data-deck-block': id },
          h('span', { className: 'dsh-deck-grip', title: '拖动排序', onPointerDown: (event) => startDrag(event, id) }, '≡'),
          h('button', { className: 'dsh-deck-title', onClick: () => setOpenDock(openDock === id ? null : id) }, BLOCK_TITLES[id])
        )),
        openDock && layout.dock.includes(openDock) && h('div', { className: 'dsh-deck-dockpop' },
          h('div', { className: 'dsh-deck-pop-hd' }, BLOCK_TITLES[openDock]),
          h(BlockBody, { id: openDock, ...bodyProps, onGripDown: startDrag, embedded: true })
        )
      ),
      h('div', { className: 'dsh-deck-foot' }, settingsSeat)
    )
  }

  /* ────────────────────────── 插件入口 ────────────────────────── */
  function apply(ctx) {
    try {
    ensureStyles()
    const deck = { ctx, slots: ctx.slots }
    ctx.slots.inject('sidebar', () => ctx.slots.register({
      name: 'sidebar',
      children: CHILDREN,
      inject: () => ({ deck })
    }, Deck))
    } catch (err) {
      try { console.error('[dsh-sidebar-deck] apply failed', err && (err.stack || err.message) || err) } catch (e) {}
      throw err
    }
  }

  return { inject: ['slots'], apply }
  } catch (err) {
    try { console.error('[dsh-sidebar-deck] factory failed', err && (err.stack || err.message) || err) } catch (e) {}
    throw err
  }
}})
