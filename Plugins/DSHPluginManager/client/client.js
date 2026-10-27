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
.dsh-pm-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.dsh-pm-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:0 0 auto;font:inherit;font-size:12px;line-height:18px;padding:4px 12px}
.dsh-pm-chip:hover{background:var(--dsw-alias-button-ghost-active-fill)}
.dsh-pm-chip-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
/* 尾部分类的下拉：平铺放不下的分类收进来（带数量），不用横拉去找 */
.dsh-pm-cat-more{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:4px 8px}
.dsh-pm-cat-more-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-pm-sort{margin-left:auto}
/* 单容器行列表（magpie 式）：一张卡片、行间发丝线，替代逐卡描边堆叠 */
.dsh-pm-list{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dsh-pm-row{align-items:center;display:flex;gap:12px;padding:11px 14px}
.dsh-pm-row + .dsh-pm-row{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-pm-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-pm-row-main{flex:1;min-width:0}
.dsh-pm-row-title{font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-row-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-badge{border:1px solid var(--dsw-alias-border-l3);border-radius:4px;color:var(--dsw-alias-label-secondary);flex:none;font-size:11px;line-height:16px;padding:1px 6px}
.dsh-pm-row-action{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-state-error-primary);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:5px 10px}
.dsh-pm-row-action:hover{background:rgba(220,50,47,.1)}
.dsh-pm-row-action:disabled{cursor:not-allowed;opacity:.5}
/* 渐进披露：magpie「Show 21 more」式居中文字按钮，替代一次渲染全部卡片 */
.dsh-pm-more{background:transparent;border:0;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:10px 0;text-align:center;width:100%}
.dsh-pm-more:hover{color:var(--dsw-alias-label-primary)}
/* 安装队列状态条：一行小字说明整体进度，安静、不抢焦点、不打断继续点按 */
.dsh-pm-queue{align-items:center;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;font-size:12px;gap:8px;line-height:18px;margin-bottom:10px;padding:6px 10px}
.dsh-pm-queue-dot{animation:dsh-pm-spin 1s linear infinite;flex:none}
.dsh-pm-queue-text{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-queue-text strong{color:var(--dsw-alias-label-primary);font-weight:600}
@keyframes dsh-pm-spin{to{transform:rotate(360deg)}}
/* 市场行：与已安装行同一套单容器样式；描述只留一行，完整描述在详情抽屉 */
.dsh-pm-grid{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dsh-pm-card{align-items:center;box-sizing:border-box;cursor:pointer;display:flex;gap:12px;padding:11px 14px;width:100%}
.dsh-pm-card + .dsh-pm-card{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-pm-card:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-pm-card-icon{align-items:center;background:var(--dsw-alias-bg-module-platform);border-radius:8px;display:flex;flex:0 0 32px;font-size:15px;height:32px;justify-content:center;width:32px}
.dsh-pm-card-main{flex:1;min-width:0}
.dsh-pm-card-title{font-size:13px;font-weight:600;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-card-author{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-card-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin:3px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-card-side{align-items:center;display:flex;flex:0 0 auto;gap:12px}
.dsh-pm-card-meta{align-items:center;color:var(--dsw-alias-label-tertiary);display:flex;flex-direction:column;font-size:11px;gap:0;line-height:16px;text-align:right}
.dsh-pm-card-actions{display:flex;gap:8px;align-items:center}
.dsh-pm-install{box-sizing:border-box;background:var(--dsw-alias-button-primary-fill);border:0;border-radius:8px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:6px 14px;white-space:nowrap}
.dsh-pm-install:hover{background:var(--dsw-alias-button-primary-hover)}
.dsh-pm-install:disabled{cursor:not-allowed;opacity:.6}
.dsh-pm-installed-tag{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px;white-space:nowrap}
.dsh-pm-cat{color:var(--dsw-alias-label-tertiary);font-size:11px}
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
/* 已忽略：同样的位置、灰掉的观感——提醒已经处理过了，但版本信息还看得到。 */
.dsh-pm-update-pill-ignored{background:transparent;border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary)}
.dsh-pm-update{box-sizing:border-box;background:var(--dsw-alias-button-primary-fill);border:0;border-radius:8px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:5px 12px}
.dsh-pm-update:hover{background:var(--dsw-alias-button-primary-hover)}
.dsh-pm-update:disabled{cursor:not-allowed;opacity:.6}
/* 「忽略/取消忽略」不是破坏性动作，用中性色（.dsh-pm-row-action 的红色留给卸载）。 */
.dsh-pm-ignore{color:var(--dsw-alias-label-secondary)}
.dsh-pm-ignore:hover{background:var(--dsw-alias-button-ghost-active-fill);color:inherit}
/* 多选：工具栏计数、行内进度、橡皮筋框选覆盖层。 */
.dsh-pm-selected-count{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}
.dsh-pm-selectarea{min-height:52px;position:relative}
.dsh-pm-band{background:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px;opacity:.22;pointer-events:none;position:absolute;z-index:3}
.dsh-pm-row-progress{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-row-selectable{cursor:pointer}
.dsh-pm-notes-page{max-width:640px}
.dsh-pm-notes-body{flex:1;overflow-y:auto;padding:14px 18px 22px}
.dsh-pm-notes-title{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-bottom:8px}
.dsh-pm-notes-text{font:inherit;font-size:12px;line-height:20px;margin:0;white-space:pre-wrap;word-break:break-word}
.dsh-pm-notes-error{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;margin-bottom:10px}
.dsh-pm-notes-link{font-size:12px}
/* 更新内容 markdown：CHANGELOG 实际用到的语法（标题/列表/行内代码/加粗/链接），
   其余按纯文本段落兜底，不引入外部渲染器 */
.dsh-pm-notes-md .dsh-pm-md-h{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px;margin:14px 0 6px}
.dsh-pm-notes-md .dsh-pm-md-p{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;margin:6px 0}
.dsh-pm-notes-md .dsh-pm-md-ul{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;margin:6px 0;padding-left:18px}
.dsh-pm-notes-md .dsh-pm-md-ul li{margin:3px 0}
.dsh-pm-notes-md .dsh-pm-md-code{background:var(--dsw-alias-bg-layer-2);border-radius:4px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;padding:1px 5px}`
  const CATEGORY_EMOJI = { official: '🛡️', browser: '🌐', tool: '🛠️', ui: '🎨', storage: '🗄️', workflow: '🔀', agent: '🤖', search: '🔍', data: '📊', network: '🌍', dev: '💻', other: '🧩' }
  // 市场分类显示名：官方来源是服务端合成的 'official' 分类，其余分类沿用远端给的原词。
  const CATEGORY_LABELS = { official: '官方' }
  const categoryLabel = category => CATEGORY_LABELS[category] || category || '其他'
  /** 市场列表首屏与每次「显示更多」的行数（渐进披露，性能关键路径）。 */
  const PAGE_SIZE = 60

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
  /// 成功/提示 3.2s 自动消失，失败 6s（读清错误需要更长时间）；
  /// 栈上限 3 条，超出时最早的先消失，连续批量操作不会糊满屏幕。
  const TOAST_STACK_LIMIT = 3
  function createToastStore(schedule = (fn, ms) => setTimeout(fn, ms)) {
    let nextId = 0
    let items = []
    const listeners = new Set()
    const emit = () => { for (const notify of listeners) notify(items) }
    return {
      push(kind, text) {
        const id = ++nextId
        items = [...items, { id, kind, text }]
        if (items.length > TOAST_STACK_LIMIT) items = items.slice(items.length - TOAST_STACK_LIMIT)
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
  /// /updates 的两类响应要合并：后台重检进行中时服务端可能先返回空 inventory（缓存刚
  /// 失效那一刻），直接 apply 会把面板上所有「可更新」标记和角标一起抹掉、按钮因为
  /// count=0 全变灰（用户实测：更新一个插件后剩下的更新全消失，手动刷新才回来）。
  /// 空 inventory 不覆盖旧数据；「接口不可用」(null/false) 仍然照实降级。
  function mergeUpdates(previous, next) {
    if (!next) return next
    if (!previous || previous === false || !Array.isArray(previous.inventory)) return next
    const incoming = Array.isArray(next.inventory) ? next.inventory : []
    if (incoming.length > 0 || previous.inventory.length === 0) return next
    return {
      ...next,
      inventory: previous.inventory,
      summary: next.summary && Number(next.summary.total) > 0 ? next.summary : previous.summary,
      checkedAt: next.checkedAt || previous.checkedAt,
      lastBatch: next.lastBatch || previous.lastBatch,
      progress: next.progress !== undefined ? next.progress : previous.progress,
    }
  }

  function createUpdatesStore(initial = null) {
    let value = initial
    // 已经提示过的批量更新批次完成时间：60 秒轮询、面板重开、强制检测都会重复读到
    // 同一个 lastBatch，靠它保证汇总 toast 只弹一次。
    let announcedBatch = null
    const listeners = new Set()
    const emit = () => { for (const notify of listeners) notify(value) }
    return {
      snapshot: () => value,
      apply(next) { value = (next ? mergeUpdates(value, next) : next) || false; emit() },
      subscribe(listener) { listeners.add(listener); listener(value); return () => listeners.delete(listener) },
      /// 这个批次完成时间是否需要提示？是则记下来并返回 true。
      claimBatchFinish(finishedAt) {
        if (!finishedAt || finishedAt === announcedBatch) return false
        announcedBatch = finishedAt
        return true
      },
    }
  }

  /// 待更新数量：优先信服务端 summary（服务端已把「已忽略」排除在外），没有这个字段时
  /// 退化成数 inventory（同样跳过 ignored，所以本地打了标也立刻归零）。
  function updatesAvailableCount(updates) {
    if (!updates || typeof updates !== 'object') return 0
    const reported = updates.summary && typeof updates.summary.updateAvailable === 'number' ? updates.summary.updateAvailable : null
    if (reported !== null) return Math.max(reported, 0)
    if (Array.isArray(updates.inventory)) return updates.inventory.filter(entry => entry && entry.status === 'update-available' && !entry.ignored).length
    return 0
  }

  /// 与服务端同口径的计数（本地把条目改成「已是最新」后要重算角标）。
  /// 已忽略的条目不算「可更新」——这正是点「忽略」之后角标要消失的原因。
  function summarizeUpdates(inventory) {
    const items = Array.isArray(inventory) ? inventory : []
    const available = items.filter(item => item && item.status === 'update-available')
    return {
      total: items.length,
      updateAvailable: available.filter(item => !item.ignored).length,
      ignored: available.filter(item => item.ignored).length,
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
    if (entry.status === 'update-available') {
      if (entry.ignored) return '已忽略这个版本：远端出了更高的版本会再提醒'
      return entry.installedVersion ? null : String(entry.note || '无法读取已安装版本')
    }
    return null
  }

  /// 橙色胶囊文案：跨大版本时换成更重的措辞；已忽略时改成中性的「已忽略 vX」。
  function updatePillText(entry) {
    const latest = entry && entry.latestVersion ? `v${entry.latestVersion}` : '新版本'
    if (entry && entry.ignored) return `已忽略 ${latest}`
    return `${entry && entry.major ? '跨大版本' : '可更新到'} ${latest}`
  }

  function updateSuccessText(name, value) {
    const detail = (value && value.note) || (value && value.updatedTo ? `已更新到 v${value.updatedTo}` : '更新成功')
    return `${name} ${detail}${value && value.restartRequired ? '，重启 dsh 后生效' : ''}`
  }

  /// 「全部更新」要提交的名字：只取 status === 'update-available' 且**没被忽略**的条目
  /// （忽略就是"这个版本别再问我要不要更新了"）。
  function updatableNames(updates) {
    // 「忽略」只屏蔽角标与自动提醒；全部更新是用户的显式动作，包含已忽略项
    //（与行内「更新」可强更已忽略项同一语义）。否则唯一的可更新插件被忽略后，
    // 这个按钮永远禁用，用户只会觉得它坏了（实测两轮反馈）。
    if (!updates || !Array.isArray(updates.inventory)) return []
    return updates.inventory
      .filter(entry => entry && entry.status === 'update-available' && entry.name)
      .map(entry => entry.name)
  }

  /// 「忽略选中」要提交的条目：选中、可更新、且还没被忽略的插件 + 它们的目标版本。
  function ignorableEntries(updates, selected) {
    if (!updates || !Array.isArray(updates.inventory) || !selected) return []
    return updates.inventory
      .filter(entry => entry && entry.status === 'update-available' && !entry.ignored && entry.name && selected.has(entry.name))
      .map(entry => ({ name: entry.name, version: entry.latestVersion || null }))
  }

  /// 批量更新批次（lastBatch）结束后的汇总 toast：finishedAt 为空表示后台还在跑，不提示。
  /// 有失败时点名失败的插件（只报一句「N 个失败」用户不知道该找谁），并区分
  /// 「已更新但没复核上」的条目——那是重启 dsh 后才生效，不是失败。
  function batchToast(batch) {
    if (!batch || !batch.finishedAt) return null
    const results = Array.isArray(batch.results) ? batch.results : []
    const updated = Number(batch.updated) || 0
    const failed = Number(batch.failed) || 0
    const pending = results.filter(result => result && result.ok && result.verified === false).length
    const pendingNote = pending > 0 ? `（${pending} 个需重启 dsh 后确认生效）` : ''
    if (failed === 0) return { kind: 'success', text: `已更新 ${updated} 个插件${pendingNote}，重启 dsh 后生效` }
    const failures = results.filter(result => result && !result.ok)
    const names = failures.map(result => result.name).filter(Boolean)
    const shown = names.length > 3 ? `${names.slice(0, 3).join('、')} 等 ${names.length} 个` : names.join('、')
    const reason = truncateNote((failures[0] && failures[0].error) || '未知错误')
    const base = shown ? `${updated} 个更新成功、${failed} 个失败（${shown}）` : `${updated} 个更新成功、${failed} 个失败`
    return { kind: 'error', text: `${base}：${reason}${pending > 0 ? `；另有 ${pending} 个待重启确认` : ''}` }
  }

  /// 异步批次是否收尾：优先看 lastBatch.finishedAt 与进度字段的 active；
  /// 老服务端没有 progress 时退回「已经没有待更新项」。
  function batchSettled(value) {
    if (!value || typeof value !== 'object') return false
    if (value.lastBatch && value.lastBatch.finishedAt) return true
    if (value.progress && typeof value.progress === 'object') return value.progress.active !== true
    return updatesAvailableCount(value) === 0
  }

  /// 「更新选中」提交的名字：选中集合与 update-available 的交集，**同样跳过已忽略的条目**。
  /// 「全部更新」已经排除忽略项；这里不排除的话，勾选一个「已忽略 vX」的行再点
  /// 「更新选中」会把这个被忽略的版本更新掉，和胶囊上的「已忽略」自相矛盾。
  function selectedUpdatableNames(updates, selected) {
    // 与全部更新同一语义：显式动作包含已忽略项（见 updatableNames）。
    if (!updates || !Array.isArray(updates.inventory) || !selected) return []
    return updates.inventory
      .filter(entry => entry && entry.status === 'update-available' && entry.name && selected.has(entry.name))
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

  /// 批次进度文案（工具栏按钮）：只在服务端进度里能读出总数时才带「k/n」。
  function batchProgressLabel(progress) {
    if (!progress || progress.active !== true) return null
    const total = Number(progress.total)
    if (!Number.isFinite(total) || total <= 0) return null
    const done = Math.max(Number(progress.done) || 0, 0)
    return `更新中… ${Math.min(done + 1, total)}/${total}`
  }

  /// 因「已忽略」而不会进这批更新的条数：全部更新 / 更新选中都拿它补一句说明，
  /// 否则用户看着两行都可更新、点了却只更新 1 个，会以为漏更新了。
  function ignoredUpdatableCount(updates) {
    if (!updates || !Array.isArray(updates.inventory)) return 0
    return updates.inventory
      .filter(entry => entry && entry.status === 'update-available' && entry.ignored && entry.name)
      .length
  }

  /// 选中集合里因已忽略被排除的条数（「更新选中」用）。
  function selectedIgnoredCount(updates, selected) {
    if (!updates || !Array.isArray(updates.inventory) || !selected) return 0
    return updates.inventory
      .filter(entry => entry && entry.status === 'update-available' && entry.ignored && entry.name && selected.has(entry.name))
      .length
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
  /// verified === false 的结果不算「已是最新」：源码换了但 node_modules 还是旧版本，
  /// 那是「重启 dsh 后确认」的状态——先标成已最新，下一次检测又会把胶囊亮回来，用户
  /// 只会看到「更新完还能更新」。
  function markPluginsUpdated(payload, results) {
    if (!payload || !Array.isArray(payload.inventory)) return payload
    const done = new Map((results || [])
      .filter(result => result && result.ok && result.verified !== false && result.name)
      .map(result => [result.name, result.updatedTo || null]))
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

  /// 行内 markdown 片段：`code`、**加粗**、[文字](链接)。React 文本节点天然安全，
  /// 不用 innerHTML，也就不需要转义层。
  function mdInline(text, keyBase) {
    const nodes = []
    let rest = String(text ?? '')
    let i = 0
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/
    while (rest) {
      const match = rest.match(pattern)
      if (!match) { nodes.push(h('span', { key: keyBase + 't' + i }, rest)); break }
      if (match.index > 0) nodes.push(h('span', { key: keyBase + 'p' + i }, rest.slice(0, match.index)))
      const token = match[0]
      if (token.startsWith('`')) nodes.push(h('code', { key: keyBase + 'c' + i, className: 'dsh-pm-md-code' }, token.slice(1, -1)))
      else if (token.startsWith('**')) nodes.push(h('strong', { key: keyBase + 'b' + i }, token.slice(2, -2)))
      else {
        const link = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
        if (link) nodes.push(h('a', { key: keyBase + 'a' + i, href: link[2], target: '_blank', rel: 'noreferrer' }, link[1]))
        else nodes.push(h('span', { key: keyBase + 'f' + i }, token))
      }
      rest = rest.slice(match.index + token.length)
      i += 1
    }
    return nodes
  }

  /// 极简 markdown：标题 / 无序列表 / 段落，覆盖 CHANGELOG 实际用到的语法；
  /// 认不出的行按段落兜底，绝不因为陌生语法渲染成空白。
  function renderMarkdown(text) {
    const blocks = []
    let list = null
    let para = []
    const flushPara = () => { if (para.length) { const key = 'p' + blocks.length; blocks.push(h('p', { key, className: 'dsh-pm-md-p' }, mdInline(para.join(' '), key))); para = [] } }
    const flushList = () => { if (list) { const key = 'l' + blocks.length; blocks.push(h('ul', { key, className: 'dsh-pm-md-ul' }, list)); list = null } }
    for (const rawLine of String(text ?? '').split('\n')) {
      const line = rawLine.replace(/\s+$/, '')
      if (!line.trim()) { flushPara(); flushList(); continue }
      const heading = line.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        flushPara(); flushList()
        const key = 'h' + blocks.length
        blocks.push(h('div', { key, className: 'dsh-pm-md-h' }, mdInline(heading[2], key)))
        continue
      }
      const bullet = line.match(/^\s*[-*]\s+(.*)$/)
      if (bullet) {
        flushPara()
        if (!list) list = []
        list.push(h('li', { key: 'li' + list.length }, mdInline(bullet[1], 'li' + blocks.length + '-' + list.length)))
        continue
      }
      flushList()
      para.push(line)
    }
    flushPara(); flushList()
    return blocks
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
    // 「更新内容」弹窗：{name, version, loading, data}
    const [notes, setNotes] = React.useState(null)
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
      .then(r => r.json()).then(v => {
        if (v.error) throw Error(v.error)
        setMarket(v)
        setError('')
        // 索引过期、或还是旧版索引（没有官方插件来源）时自动重建一次，别让用户手动找按钮。
        if (v.stale && !autoRefreshed.current) { autoRefreshed.current = true; refreshMarket() }
      })
      .catch(e => {
        // 无本地索引时自动刷新一次，避免用户手动找「刷新市场」
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
        .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); toast('success', v.official > 0 ? `市场已刷新：${v.count} 个插件（含 ${v.official} 个 DeepSeek 官方）` : `市场已刷新：${v.count} 个插件`); return loadMarket() })
        .catch(e => toast('error', `刷新市场失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }
    // 安装队列：点按立即入队、顺序执行（magpie 式——进度是一条安静的
    // 状态条，全部结束后才给一条汇总 toast）。installStatus 记录每个
    // 插件的排队/执行态，供按钮文案与禁用使用。
    const installQueueRef = React.useRef([])
    const installRunningRef = React.useRef(false)
    const installTotalRef = React.useRef(0)
    const [installStatus, setInstallStatus] = React.useState({})
    const [queueView, setQueueView] = React.useState([])
    /// 单个安装请求；返回 'ok' | 'already' | 'fail'。失败当场 toast（读错误需要时间）。
    const installOne = async (plugin) => {
      try {
        const r = await fetch('/dsh-plugin-manager/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: plugin.url, name: plugin.name }) })
        const v = await r.json()
        if (v.error) throw Error(v.error)
        if (!v.ok) throw Error(v.error || '安装失败')
        return v.alreadyInstalled ? 'already' : 'ok'
      } catch (e) {
        toast('error', `安装失败：${plugin.repo || plugin.name} — ${String(e.message || e)}`)
        return 'fail'
      }
    }
    const pumpInstalls = async () => {
      if (installRunningRef.current) return
      installRunningRef.current = true
      const installedNames = []
      while (installQueueRef.current.length > 0) {
        const plugin = installQueueRef.current[0]
        setInstallStatus(s => ({ ...s, [plugin.id]: 'installing' }))
        const outcome = await installOne(plugin)
        installQueueRef.current = installQueueRef.current.slice(1)
        setQueueView([...installQueueRef.current])
        setInstallStatus(s => { const next = { ...s }; delete next[plugin.id]; return next })
        if (outcome === 'ok') installedNames.push(plugin.repo || plugin.name)
        else if (outcome === 'already') toast('info', `${plugin.repo || plugin.name} 已安装过，无需重复安装`)
      }
      installRunningRef.current = false
      installTotalRef.current = 0
      if (installedNames.length > 0) {
        setDetail(null)
        await loadInstalled()
        // 验收回读：接口说 ok 不等于插件真的出现在已安装列表（magpie 的规矩）。
        // 缺席的点名报错，别让汇总 toast 替命令退出码背书。
        let listing = []
        try {
          const r = await fetch('/dsh-plugin-manager/installed', { cache: 'no-store' })
          listing = (await r.json()).items || []
        } catch { /* 列表读不到就不做缺席判定，保留成功汇总 */ }
        const present = new Set(listing.map(item => String(item.name).toLowerCase()))
        const missing = installedNames.filter(name => {
          const repo = String(name).toLowerCase()
          return !present.has(repo) && ![...present].some(n => n.endsWith('/' + repo))
        })
        if (missing.length > 0) {
          toast('error', `安装未生效（已安装列表里没有出现）：${missing.join('、')}。请重启 dsh 后重试`)
        } else {
          toast('success', installedNames.length === 1 ? '已安装，重启 dsh 后生效' : `已安装 ${installedNames.length} 个插件，重启 dsh 后生效`)
        }
      }
    }
    const install = (plugin) => {
      if (installStatus[plugin.id] || batchRunning || busyOther) return
      installTotalRef.current += 1
      installQueueRef.current = [...installQueueRef.current, plugin]
      setQueueView([...installQueueRef.current])
      setInstallStatus(s => ({ ...s, [plugin.id]: 'queued' }))
      void pumpInstalls()
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
    // dev-linked（本地开发目录链接的）插件点「更新」后：服务端拒绝自动更新，
    // 这里给出二选一的显式确认块（magpie 式——动用户目录的决定必须显式发起）。
    const [devLinkedChoice, setDevLinkedChoice] = React.useState(null)
    const updateOne = (item, mode) => {
      setBusy('update-' + item.name)
      fetch('/dsh-plugin-manager/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: item.name, mode }) })
        .then(r => r.json()).then(v => {
          if (v.error && v.status !== 'dev-linked') throw Error(v.error)
          if (v.status === 'dev-linked') {
            // 服务端要求用户显式选择更新方式；确认块本身就是反馈，不再叠 error toast。
            setDevLinkedChoice({ name: item.name, error: v.error })
            return null
          }
          if (!v.ok) throw Error(v.error || '更新失败')
          setDevLinkedChoice(null)
          // 验收未过（node_modules 版本没跟上）不是成功：用中性提示如实说，
          // 别让绿色 toast 把「需重启确认」装饰成「已完成」。
          toast(v.verified === false ? 'info' : 'success', updateSuccessText(item.name, v))
          settleUpdates([{ name: item.name, ok: true, updatedTo: v.updatedTo }])
          return loadInstalled()
        })
        .catch(e => toast('error', `更新 ${item.name} 失败：${String(e.message || e)}`))
        .finally(() => setBusy(''))
    }
    /// 「这个版本改了什么」：行内入口按需拉一次发布说明（服务端缓存 30 分钟，失败也给仓库链接）。
    const openNotes = (item, entry) => {
      const version = entry && entry.latestVersion ? entry.latestVersion : null
      if (!version) return
      setNotes({ name: item.name, version, loading: true, data: null })
      fetch('/dsh-plugin-manager/release-notes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: item.name, version }),
      })
        .then(r => r.json())
        .then(data => setNotes(current => (current && current.name === item.name ? { ...current, loading: false, data } : current)))
        .catch(error => setNotes(current => (current && current.name === item.name
          ? { ...current, loading: false, data: { ok: false, error: String(error.message || error) } }
          : current)))
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
    /// 批量更新的来源（「全部更新」/「更新选中」）：进度条上必须写明，
    /// 否则任何批次看起来都像全部更新干的（用户实测：选中 2 个点了更新，
    /// 进度却显示 1/3，无法分辨点的是哪个按钮）。
    const batchSourceRef = React.useRef('')
    const [batchSource, setBatchSource] = React.useState('')
    /// 「全部更新」与「更新选中」共用：提交 names 后走异步受理流程。
    const startBatch = (names, ignored = 0, source = '全部更新') => {
      if (!names || names.length === 0) return
      batchSourceRef.current = source
      setBatchSource(source)
      setBusy('update-many')
      fetch('/dsh-plugin-manager/update-many', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '批量更新失败')
          // 202：更新在服务端后台顺序执行。受理 toast 点名清单（≤3 个全列），
          // 让「更新的是谁」在第一秒就没有歧义。
          const count = Number(v.accepted) || names.length
          const listed = names.length <= 3 ? `：${names.join('、')}` : `：${names.slice(0, 3).join('、')} 等 ${names.length} 个`
          toast('info', ignored > 0
            ? `已开始更新 ${count} 个插件${listed}（另有 ${ignored} 个已忽略，未更新）`
            : `已开始更新 ${count} 个插件${listed}`)
          return waitForBatch()
        })
        .then(() => loadInstalled())
        .catch(e => toast('error', `批量更新失败：${String(e.message || e)}`))
        .finally(() => { setBusy(''); setBatchSource('') })
    }
    const updateAll = () => startBatch(updatableNames(updates), 0, '全部更新')
    const updateSelected = () => startBatch(selectedUpdatableNames(updates, selected), 0, '更新选中')
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

    /// 忽略一批更新：只忽略传进去的版本，远端出了更高的版本会重新提醒。服务端的忽略
    /// 记录发生在"读检测结果"的时候，所以这里重新读一次 /updates 就能看到效果，不必重测。
    const ignoreEntries = (entries) => {
      if (!entries || entries.length === 0) return
      setBusy('ignore')
      fetch('/dsh-plugin-manager/ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: entries }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '忽略失败')
          const names = Array.isArray(v.ignored) ? v.ignored : []
          toast('success', names.length > 1 ? `已忽略 ${names.length} 个更新` : `已忽略 ${names[0] || entries[0].name} 的更新提示`)
          return loadUpdates().then(applyUpdates)
        })
        .catch(e => toast('error', `忽略失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }
    const ignoreOne = (item, entry) => ignoreEntries([{ name: item.name, version: (entry && entry.latestVersion) || null }])
    /// 取消忽略：恢复这个插件的更新提醒（本地重新读一次检测结果即可，无需联网）。
    const unignoreOne = (item) => {
      setBusy('ignore')
      fetch('/dsh-plugin-manager/unignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names: [item.name] }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '取消忽略失败')
          toast('info', `已恢复 ${item.name} 的更新提醒`)
          return loadUpdates().then(applyUpdates)
        })
        .catch(e => toast('error', `取消忽略失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }

    const manageable = installed.filter(item => !item.broken && item.source !== 'bundled')
    const selectedNames = manageable.filter(item => selected.has(item.name)).map(item => item.name)
    // 服务端进程进度（启动器的进度窗口读同一个字段）：当前处理的行显示步骤，其余待更新行「等待中」。
    const progress = updates && updates.progress && typeof updates.progress === 'object' ? updates.progress : null
    const progressActive = Boolean(progress && progress.active === true)
    const progressCurrent = progress && typeof progress.current === 'string' ? progress.current : null
    // 「有批次在跑」：自己点的（busy）或服务端进程里别人的批次（progress.active）。
    // 行内按钮/卸载/安装都要读它，所以必须在渲染行之前声明。
    const updatingAll = busy === 'update-many'
    const batchRunning = updatingAll || progressActive
    // 任何更新动作进行中都不再并发开新的（pnpm 会写同一个 profile）。
    const busyAny = busy !== ''
    // 「检测中」只占住检查按钮：它不写 profile，整条工具栏跟着变灰会让用户以为坏掉了。
    const busyOther = busyAny && busy !== 'check-updates'
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

    // 渐进披露（magpie「Show more」式）：市场索引可能数千条，一次性渲染
    // 全部 DOM 是面板卡顿的主因；首屏只渲染 PAGE_SIZE 行，往下翻再加载。
    const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
    React.useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search, category])
    // 已安装索引：一次构建，市场卡片与详情抽屉只查数组（此前每卡片每次
    // render 都重扫 installed 并做字符串包含）。
    const installedIndex = React.useMemo(
      () => installed.filter(item => !item.broken).map(item => normalizeText(item.name)),
      [installed]
    )
    const isInstalledPlugin = plugin => installedIndex.some(name => {
      const repo = normalizeText(plugin.repo)
      return name === repo || name.endsWith('/' + repo) || (plugin.url && normalizeText(plugin.url).includes(name))
    })
    // 筛选 + 排序只在输入变化时计算（此前每次 render 都全量 filter + sort）。
    const marketPlugins = market?.plugins || []
    const plugins = React.useMemo(() => {
      const term = normalizeText(search)
      const out = marketPlugins.filter(plugin => {
        const inTerm = !term || normalizeText(plugin.name + ' ' + plugin.repo + ' ' + plugin.descriptionEn + ' ' + plugin.descriptionZh).includes(term)
        const inCategory = category === 'all' || plugin.category === category
        return inTerm && inCategory
      })
      if (sort === 'downloads') out.sort((a, b) => (b.downloads || 0) - (a.downloads || 0))
      else if (sort === 'newest') out.sort((a, b) => String(b.addedDate || '').localeCompare(String(a.addedDate || '')))
      else out.sort((a, b) => (b.stars || 0) - (a.stars || 0))
      return out
    }, [marketPlugins, search, category, sort])
    // 分类展示：市场近 30 个分类，全部平铺是三排 chip 墙、横拉又要拖动（用户都嫌）。
    // 按插件数量取前 10 平铺，其余收进带数量的「更多分类」下拉，两下都能到。
    const categoryCounts = React.useMemo(() => {
      const counts = new Map()
      for (const plugin of marketPlugins) counts.set(plugin.category, (counts.get(plugin.category) || 0) + 1)
      return counts
    }, [marketPlugins])
    const topCategories = React.useMemo(() =>
      [...(market?.categories || [])].sort((a, b) => (categoryCounts.get(b) || 0) - (categoryCounts.get(a) || 0)).slice(0, 10),
    [market, categoryCounts])
    const tailCategories = React.useMemo(() =>
      (market?.categories || []).filter(cat => !topCategories.includes(cat)),
    [market, topCategories])

    const installedRows = installed.map((item, index) => {
      const selectable = !item.broken && item.source !== 'bundled'
      // 更新检测结果按插件名对齐已安装列表；接口不可用时 entry 恒为 null，整行退回原样。
      const entry = updateEntryFor(updates, item.name)
      const updatable = Boolean(entry && entry.status === 'update-available')
      // 「已忽略」只是不再计入角标与「全部更新」，行内仍留着更新入口（用户随时可以反悔）。
      const ignored = Boolean(updatable && entry.ignored)
      // 已忽略的条目不在这一批里，别跟着显示「等待中」。
      const progressNote = progressNoteFor(entry, progress, updatable && !ignored)
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
          updatable ? h('span', { className: `dsh-pm-update-pill${entry.major && !ignored ? ' dsh-pm-update-pill-major' : ''}${ignored ? ' dsh-pm-update-pill-ignored' : ''}` }, updatePillText(entry)) : null,
          updatable
            ? h('button', {
                className: 'dsh-pm-row-action dsh-pm-notes-link',
                disabled: busyOther || batchRunning,
                onClick: event => { event.stopPropagation(); openNotes(item, entry) },
                title: `看看 v${entry.latestVersion} 改了什么`,
              }, '更新内容')
            : null,
          updatable
            ? h('button', { className: 'dsh-pm-update', disabled: updating || batchRunning || busyOther, onClick: () => updateOne(item), title: progressActive && !updating ? '批量更新进行中，等它结束再更新这个插件' : `更新 ${item.name} 到 v${entry.latestVersion}` }, updating ? '更新中…' : '更新')
            : null,
          updatable
            ? h('button', {
                className: 'dsh-pm-row-action dsh-pm-ignore',
                disabled: busyOther,
                onClick: () => (ignored ? unignoreOne(item) : ignoreOne(item, entry)),
                title: ignored ? '恢复这个版本的更新提醒' : `不再提醒 ${item.name} 的 v${entry.latestVersion}（远端出更高版本时会再提醒）`,
              }, ignored ? '取消忽略' : '忽略')
            : null),
        item.source === 'bundled' ? h('span', { className: 'dsh-pm-badge' }, '内置') : null,
        item.broken ? h('span', { className: 'dsh-pm-badge', style: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' } }, '损坏') : null,
        item.broken
          ? h('button', { className: 'dsh-pm-row-action', disabled: busy === 'cleanup-' + item.name || batchRunning || busyOther, onClick: () => cleanupBroken(item), title: batchRunning ? '批量更新进行中，等它结束后再清理' : '清理损坏的安装残留' }, busy === 'cleanup-' + item.name ? '清理中…' : '清理')
          : item.source === 'bundled'
            ? h('button', { className: 'dsh-pm-row-action', disabled: true, title: '内置插件不可卸载' }, '—')
            : h('button', { className: 'dsh-pm-row-action', disabled: busy === 'uninstall' || busy === 'uninstall-many' || batchRunning || busyOther, onClick: () => requestUninstall(item), title: batchRunning ? '批量更新进行中，等它结束后再卸载' : '卸载' }, '卸载'))
    })

    const marketCards = plugins.slice(0, visibleCount).map(plugin => {
      const isInstalled = isInstalledPlugin(plugin)
      const status = installStatus[plugin.id]
      return h('div', { className: 'dsh-pm-card', key: plugin.id, onClick: () => setDetail(plugin) },
        h('div', { className: 'dsh-pm-card-icon' }, CATEGORY_EMOJI[plugin.category] || '🧩'),
        h('div', { className: 'dsh-pm-card-main' },
          h('div', { className: 'dsh-pm-card-title' }, plugin.repo || plugin.name),
          h('div', { className: 'dsh-pm-card-author' }, `${plugin.author || plugin.name} · ${categoryLabel(plugin.category)}`),
          h('div', { className: 'dsh-pm-card-desc' }, descOf(plugin, true) || descOf(plugin))),
        h('div', { className: 'dsh-pm-card-side' },
          h('div', { className: 'dsh-pm-card-meta' },
            h('span', null, `★ ${formatNumber(plugin.stars)}`),
            h('span', null, `↓ ${formatNumber(plugin.downloads)}`)),
          isInstalled
            ? h('span', { className: 'dsh-pm-installed-tag' }, '✓ 已安装')
            : h('button', {
                className: 'dsh-pm-install',
                disabled: batchRunning || busyOther || Boolean(status),
                onClick: (e) => { e.stopPropagation(); install(plugin) },
                title: batchRunning ? '批量更新进行中，等它结束再安装' : status === 'queued' ? '已加入安装队列' : status === 'installing' ? '正在安装' : undefined,
              }, status === 'queued' ? '排队中…' : status === 'installing' ? '安装中…' : '安装')))
    })

    const notesModal = notes ? h('div', {
      className: 'dsh-pm-backdrop',
      onClick: () => setNotes(null),
    },
      h('div', { className: 'dsh-pm-page dsh-pm-notes-page', onClick: event => event.stopPropagation() },
        h('div', { className: 'dsh-pm-header' },
          h('strong', null, `${notes.name} ${notes.version ? `v${notes.version}` : ''} 的更新内容`),
          h('div', { className: 'dsh-pm-header-spacer' }),
          h('button', { className: 'dsh-pm-tool dsh-pm-close', onClick: () => setNotes(null), 'aria-label': '关闭' }, '×')),
        h('div', { className: 'dsh-pm-notes-body' },
          notes.loading
            ? h('div', { className: 'dsh-pm-empty' }, '正在读取发布说明…')
            : notes.data && notes.data.ok
              ? h('div', null,
                  h('div', { className: 'dsh-pm-notes-title' }, notes.data.title || ''),
                  h('div', { className: 'dsh-pm-notes-md' }, renderMarkdown(notes.data.notes || '')),
                  notes.data.url ? h('a', { className: 'dsh-pm-drawer-link', href: notes.data.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上查看 ↗') : null)
              : h('div', null,
                  h('div', { className: 'dsh-pm-notes-error' }, (notes.data && notes.data.error) || '读取发布说明失败'),
                  notes.data && notes.data.url ? h('a', { className: 'dsh-pm-drawer-link', href: notes.data.url, target: '_blank', rel: 'noreferrer' }, '打开插件仓库 ↗') : null)))) : null
    const drawer = detail ? h('div', { className: 'dsh-pm-drawer' },
      h('div', { className: 'dsh-pm-drawer-head' },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'dsh-pm-drawer-title' }, detail.repo || detail.name),
          h('div', { className: 'dsh-pm-drawer-meta' }, `${detail.author || detail.name} · ${categoryLabel(detail.category)}`)),
        h('button', { className: 'dsh-pm-drawer-close', onClick: () => setDetail(null), 'aria-label': '关闭' }, '×')),
      h('div', { className: 'dsh-pm-drawer-desc' }, descOf(detail, true) || descOf(detail) || '暂无描述'),
      h('div', { className: 'dsh-pm-drawer-stats' },
        h('span', null, `★ ${detail.stars || 0}`),
        h('span', null, `下载 ${detail.downloads || 0}`),
        detail.addedDate ? h('span', null, `添加于 ${detail.addedDate}`) : null),
      h('div', { className: 'dsh-pm-drawer-actions' },
        installStatus[detail.id]
          ? h('span', { className: 'dsh-pm-badge' }, installStatus[detail.id] === 'installing' ? '安装中…' : '排队中…')
          : isInstalledPlugin(detail)
            ? h('span', { className: 'dsh-pm-installed-tag' }, '✓ 已安装')
            : h('button', { className: 'dsh-pm-install', disabled: batchRunning || busyOther, onClick: () => install(detail), title: batchRunning ? '批量更新进行中，等它结束再安装' : undefined }, '安装')),
      detail.url ? h('a', { className: 'dsh-pm-drawer-link', href: detail.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上查看 ↗') : null)
      : null

    // 队列状态条：只在有安装任务时出现；完成后随 installRunningRef 清零消失。
    const installingNow = installTotalRef.current - queueView.length + 1
    const queueStrip = queueView.length > 0
      ? h('div', { className: 'dsh-pm-queue', role: 'status' },
          h('span', { className: 'dsh-pm-queue-dot', 'aria-hidden': true }, '◌'),
          h('span', { className: 'dsh-pm-queue-text' },
            h('strong', null, `正在安装 ${installingNow}/${installTotalRef.current}`),
            ` · ${queueView[0].repo || queueView[0].name}`,
            queueView.length > 1 ? `，还有 ${queueView.length - 1} 个排队` : ''))
      : null

    const marketTab = h('div', null,
      market === null ? h('div', { className: 'dsh-pm-empty' }, '加载中…') :
      market === false ? h('div', { className: 'dsh-pm-empty' }, '市场数据未就绪') :
      h('div', null,
        queueStrip,
        h('div', { className: 'dsh-pm-toolbar' },
          h('input', { className: 'dsh-pm-search', placeholder: '搜索插件 / 作者 / 描述…', value: search, onChange: (e) => setSearch(e.target.value) }),
          h('div', { className: 'dsh-pm-chips' },
            h('button', { key: 'all', className: `dsh-pm-chip${category === 'all' ? ' dsh-pm-chip-active' : ''}`, onClick: () => setCategory('all') }, '全部'),
            topCategories.map(cat => h('button', { key: cat, className: `dsh-pm-chip${category === cat ? ' dsh-pm-chip-active' : ''}`, onClick: () => setCategory(cat) }, categoryLabel(cat))),
            tailCategories.length > 0
              ? h('select', {
                  key: 'cat-more',
                  className: `dsh-pm-cat-more${tailCategories.includes(category) ? ' dsh-pm-cat-more-active' : ''}`,
                  value: tailCategories.includes(category) ? category : '',
                  onChange: (e) => { if (e.target.value) setCategory(e.target.value) },
                  title: '其余分类（按插件数量）',
                },
                h('option', { value: '' }, '更多分类…'),
                tailCategories.map(cat => h('option', { key: cat, value: cat }, `${categoryLabel(cat)} · ${categoryCounts.get(cat) || 0}`)))
              : null),
          h('select', { className: 'dsh-pm-sort', value: sort, onChange: (e) => setSort(e.target.value), style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: '12px', padding: '5px 8px' } },
            h('option', { value: 'stars' }, '按 ★ 排序'),
            h('option', { value: 'downloads' }, '按下载量'),
            h('option', { value: 'newest' }, '按最新'))),
        market.plugins.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '暂无插件') :
        marketCards.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '没有匹配的插件') :
        h('div', null,
          h('div', { className: 'dsh-pm-grid' }, marketCards),
          plugins.length > visibleCount
            ? h('button', { className: 'dsh-pm-more', onClick: () => setVisibleCount(c => c + PAGE_SIZE) },
                `显示更多（还有 ${plugins.length - visibleCount} 个）`)
            : h('div', { className: 'dsh-pm-more', style: { cursor: 'default' } }, `已显示全部 ${plugins.length} 个`))))

    // 更新工具栏：接口不可用（updates === false）时整条不渲染，静默降级成原来的已安装页。
    const clock = formatCheckedClock(updates && updates.checkedAt)
    const checking = busy === 'check-updates'
    const selectedUpdatable = selectedUpdatableNames(updates, selected)
    const selectedIgnorable = ignorableEntries(updates, selected)
    // 检测/批量更新都在后台跑，面板要能关掉（批量更新可能几分钟）；安装/卸载仍锁住。
    // 忽略只是写一次本地记录，不该把「关闭」也锁上。
    const closable = !busy || checking || updatingAll || busy === 'ignore'
    // 批量进度条：进度独立于按钮展示（magpie 式——按钮只表达「下一步动作」，
    // 进行中的事由一条状态条说明）。来源 + 进度 + 当前插件一起给出，
    // 杜绝「选中 2 个却更新 3 个」的来源歧义。
    // 全部更新的候选：inventory 里全部 update-available（含已忽略）。summary 是
    // 角标口径（排除已忽略），用它会让按钮在「有胶囊但按不动」时归零。
    const updateAllCount = updates && Array.isArray(updates.inventory)
      ? updates.inventory.filter(entry => entry && entry.status === 'update-available').length
      : 0
    const batchStrip = batchRunning
      ? h('div', { className: 'dsh-pm-queue', role: 'status' },
          h('span', { className: 'dsh-pm-queue-dot', 'aria-hidden': true }, '◌'),
          h('span', { className: 'dsh-pm-queue-text' },
            h('strong', null, batchProgressLabel(progress) || '更新中…'),
            ` · 来源：${batchSource || '批量更新'}`,
            progressCurrent ? ` · ${progressCurrent}` : ''))
      : null
    // 「全部更新」的哑按钮要有解释：可更新项全部被忽略时按钮必然禁用，
    // 不写明原因用户只会觉得「按钮坏了」（实测：唯一的可更新插件被忽略后，
    // 全部更新/更新选中全部灰掉且无提示）。已忽略的项仍可用行内「更新」强更。
    // 「全部更新」计全部可更新项（含已忽略）：忽略只屏蔽角标与自动提醒，
    // 不拦用户的显式动作（行内「更新」本就如此）。这样按钮永远不会在「明明有
    // 胶囊却按不动」的状态下出现（用户两轮实测反馈）。
    const ignoredUpdatable = ignoredUpdatableCount(updates)
    const updateAllHint = ignoredUpdatable > 0
      ? `更新所有可更新的插件（含已忽略的 ${ignoredUpdatable} 个；忽略只屏蔽提醒，不拦显式更新）`
      : '更新所有可更新的插件'
    const updatesBar = updates === false ? null : h('div', { className: 'dsh-pm-toolbar' },
      h('button', { className: 'dsh-pm-tool', disabled: checking || batchRunning || busyOther, onClick: checkUpdates, title: '联网检测每个已安装插件的远端版本' }, checking ? '检测中…' : '检查更新'),
      h('button', {
        className: 'dsh-pm-tool',
        disabled: updateAllCount === 0 || batchRunning || busyOther,
        onClick: updateAll,
        title: updateAllHint,
      }, updateAllCount > 0 ? `全部更新 (${updateAllCount})` : '全部更新'),
      h('button', { className: 'dsh-pm-tool', disabled: selectedUpdatable.length === 0 || batchRunning || busyOther, onClick: updateSelected, title: '只更新选中且可更新的插件' }, `更新选中 (${selectedUpdatable.length})`),
      h('button', { className: 'dsh-pm-tool', disabled: selectedIgnorable.length === 0 || batchRunning || busyOther, onClick: () => ignoreEntries(selectedIgnorable), title: '不再提醒选中插件的当前版本（远端出更高版本时会再提醒）' }, `忽略选中 (${selectedIgnorable.length})`),
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
          devLinkedChoice && h('div', { className: 'dsh-pm-confirm' },
            h('div', { className: 'dsh-pm-confirm-title' }, `选择 ${devLinkedChoice.name} 的更新方式`),
            h('div', { className: 'dsh-pm-confirm-copy' },
              '这个插件链接到你的本地开发目录，自动更新不会擅动它。两种方式二选一：',
              h('br'), '· 更新本地目录：在目录里 git pull、装依赖并重新构建（会改动该目录，本地有未推送提交时会被拒绝）；',
              h('br'), '· 切换为 npm 发行版：改用发布的版本，完全不碰本地目录。'),
            h('div', { className: 'dsh-pm-confirm-actions' },
              h('button', { className: 'dsh-pm-confirm-cancel', onClick: () => setDevLinkedChoice(null), disabled: busy === 'update-' + devLinkedChoice.name }, '取消'),
              h('button', {
                className: 'dsh-pm-confirm-cancel',
                disabled: Boolean(busy),
                onClick: () => updateOne({ name: devLinkedChoice.name }, 'switch-release'),
                title: '改用 npm 上发布的版本，本地目录保持原样',
              }, '切换为发行版'),
              h('button', {
                className: 'dsh-pm-confirm-primary',
                disabled: Boolean(busy),
                onClick: () => updateOne({ name: devLinkedChoice.name }, 'pull-local'),
                title: '在本地目录里 git pull + 装依赖 + 重新构建',
              }, '更新本地目录'))),
          tab === 'installed'
            ? h('div', null,
                updatesBar,
                batchStrip,
                installed.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '还没有已安装的插件，去插件市场看看吧')
                  : h('div', null,
                      h('div', { className: 'dsh-pm-bulkbar' },
                        h('button', { className: 'dsh-pm-tool', onClick: toggleSelectAll }, manageable.length > 0 && selectedNames.length === manageable.length ? '取消全选' : '全选'),
                        h('button', { className: 'dsh-pm-tool', onClick: toggleInvert }, '反选'),
                        h('button', { className: 'dsh-pm-tool', disabled: selectedNames.length === 0 || busy === 'uninstall-many' || batchRunning || busyOther, onClick: () => setConfirmBatch(true), style: selectedNames.length > 0 ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined }, `批量卸载${selectedNames.length ? ` (${selectedNames.length})` : ''}`)),
                      // 拖拽框选：在这块区域按下并拖动，实时把相交的行选上。
                      h('div', { className: 'dsh-pm-selectarea', ref: listAreaRef, onMouseDown: startBand },
                        h('div', { className: 'dsh-pm-list' }, installedRows),
                        band ? h('div', { className: 'dsh-pm-band', style: { height: `${band.height}px`, left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px` } }) : null)))
            : marketTab,
          drawer,
          notesModal)))
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
    ignorableEntries,
    batchToast,
    batchSettled,
    selectedUpdatableNames,
    progressStepText,
    progressNoteFor,
    batchProgressLabel,
    ignoredUpdatableCount,
    selectedIgnoredCount,
    bandRect,
    rectsIntersect,
    namesInBand,
    bandSelection,
    rangeSelection,
    markPluginsUpdated,
    mergeUpdates,
    summarizeUpdates,
    formatCheckedClock,
    loadUpdates,
    pollUpdates,
  }
}})
