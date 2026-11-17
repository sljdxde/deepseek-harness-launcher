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
.dsh-pm-page{--pm-accent:#3b82f6;--pm-accent-fg:#ffffff;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.30);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;font-size:13px;height:min(920px,calc(100vh - 64px));left:50%;max-height:none;max-width:1240px;position:fixed;top:50%;transform:translate(-50%,-50%);width:min(1240px,calc(100vw - 64px));z-index:2147483001}
/* 全屏：铺满窗口（无圆角、无边框）；内容区仍限宽居中，避免大屏上文字行长过长 */
.dsh-pm-page.dsh-pm-full{inset:0;border:0;border-radius:0;height:100vh;left:0;max-height:none;max-width:none;top:0;transform:none;width:100vw}
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
.dsh-pm-check{accent-color:var(--pm-accent);cursor:pointer;flex:0 0 16px;height:16px;margin:0;width:16px}
.dsh-pm-bulkbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.dsh-pm-bulkbar .dsh-pm-tool{font-size:12px;padding:4px 10px}
.dsh-pm-find{display:flex;align-items:center;gap:6px;height:30px;width:min(240px,46%);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);padding:0 10px;transition:box-shadow .14s ease,background .14s ease}
.dsh-pm-find:focus-within{background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--pm-accent),0 0 0 3px color-mix(in srgb,var(--pm-accent) 18%,transparent)}
.dsh-pm-find input{flex:1;min-width:0;border:0;outline:none;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px}
.dsh-pm-find input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dsh-pm-search{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:8px;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;flex:1 1 220px;min-width:180px;padding:7px 12px}
.dsh-pm-search:focus{border-color:var(--pm-accent);outline:none}
.dsh-pm-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.dsh-pm-chip{border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:0 0 auto;font:inherit;font-size:12px;line-height:18px;padding:4px 12px}
.dsh-pm-chip:hover{background:var(--dsw-alias-button-ghost-active-fill)}
.dsh-pm-chip-active{background:var(--pm-accent);border-color:var(--pm-accent);color:var(--dsw-alias-label-primary-foreground)}
/* 尾部分类的下拉：平铺放不下的分类收进来（带数量），不用横拉去找 */
.dsh-pm-cat-more{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:18px;padding:4px 8px}
.dsh-pm-cat-more-active{background:var(--pm-accent);border-color:var(--pm-accent);color:var(--dsw-alias-label-primary-foreground)}
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
.dsh-pm-badge-disabled{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
/* 停用/启用开关：轨道 + 圆点用纯 CSS，避免再引一套组件库；禁用态由 title 说明原因 */
.dsh-pm-switch{align-items:center;cursor:pointer;display:flex;flex:none;gap:6px;user-select:none}
.dsh-pm-switch-input{height:1px;margin:-1px;opacity:0;overflow:hidden;position:absolute;width:1px}
/* 开关视觉：启用 = 开启状态、墨色轨道（浅色主题下即黑）；停用 = 关闭状态、浅色轨道。
   轨道/圆点用语义令牌（label-primary / bg-module-platform），深色主题自动反色。 */
.dsh-pm-switch-track{background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l3);border-radius:999px;box-sizing:border-box;display:inline-block;flex:none;height:18px;position:relative;transition:background .15s ease,border-color .15s ease;width:32px}
.dsh-pm-switch-track:after{background:var(--dsw-alias-label-primary);border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.28);content:"";height:14px;left:1px;position:absolute;top:1px;transition:transform .15s ease,background .15s ease;width:14px}
.dsh-pm-switch-input:checked + .dsh-pm-switch-track{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}
.dsh-pm-switch-input:checked + .dsh-pm-switch-track:after{background:var(--dsw-alias-label-primary-foreground);transform:translateX(14px)}
.dsh-pm-switch-input:focus-visible + .dsh-pm-switch-track{outline:2px solid var(--pm-accent);outline-offset:2px}
.dsh-pm-switch-input:disabled + .dsh-pm-switch-track{cursor:not-allowed;opacity:.45}
.dsh-pm-switch-text{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.dsh-pm-switch:has(.dsh-pm-switch-input:disabled){cursor:not-allowed}
.dsh-pm-row-off .dsh-pm-row-title{opacity:.62}
.dsh-pm-row-off .dsh-pm-row-meta{opacity:.82}
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
/* 市场卡片：竖版（magpie pm-card）——图标+名称+安装按钮一行、两行摘要、一行元信息 */
.dsh-pm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
.dsh-pm-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px 17px 15px;transition:border-color .16s ease,box-shadow .16s ease}
.dsh-pm-card:hover{border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 16%,var(--dsw-alias-border-l2));box-shadow:0 4px 14px rgba(20,22,30,.08)}
.dsh-pm-card-top{align-items:center;display:flex;gap:10px;min-width:0}
.dsh-pm-card-icon{align-items:center;background:var(--dsw-alias-bg-layer-2);border-radius:10px;color:var(--dsw-alias-label-secondary);display:flex;flex:0 0 36px;height:36px;justify-content:center;width:36px}
.dsh-pm-card-who{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
.dsh-pm-card-name{color:var(--dsw-alias-label-primary);font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-card-by{align-items:center;color:var(--dsw-alias-label-tertiary);display:flex;font-size:11px;gap:4px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-card-sum{-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--dsw-alias-label-secondary);display:-webkit-box;font-size:12.5px;line-height:1.5;margin:0;min-height:3em;overflow:hidden}
.dsh-pm-card-meta{align-items:center;color:var(--dsw-alias-label-tertiary);display:flex;flex-wrap:wrap;font-size:11px;font-variant-numeric:tabular-nums;gap:8px;min-height:18px}
.dsh-pm-card-ver{font-family:ui-monospace,SFMono-Regular,monospace;font-size:10.5px}
.dsh-pm-card-meta .dsh-pm-chip{align-items:center;background:var(--dsw-alias-bg-layer-2);border:0;border-radius:5px;color:var(--dsw-alias-label-secondary);display:inline-flex;font-size:10.5px;gap:3px;height:17px;padding:0 6px}
.dsh-pm-install{box-sizing:border-box;background:var(--pm-accent);border:0;border-radius:8px;color:var(--pm-accent-fg);cursor:pointer;flex:none;font:inherit;font-size:12px;font-weight:600;line-height:18px;padding:6px 14px;white-space:nowrap}
.dsh-pm-install:hover:not(:disabled){filter:brightness(1.06)}
.dsh-pm-install:disabled{cursor:not-allowed;opacity:.6}
.dsh-pm-installed-tag{color:var(--dsw-alias-state-success-primary);flex:none;font-size:12px;line-height:18px;white-space:nowrap}
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
.dsh-pm-drawer-link{color:var(--pm-accent);font-size:12px;line-height:18px;text-decoration:none;display:inline-block;margin-top:12px}
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
.dsh-pm-notes-md .dsh-pm-md-code{background:var(--dsw-alias-bg-layer-2);border-radius:4px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;padding:1px 5px}
/* ── 方案 B 布局：页面内左栏（发现/内置/已安装/插件源）＋ 双列内容区 ──
   颜色全部走宿主语义 token，深浅主题自动跟随。窄窗口（<860px）左栏收成
   顶部一行、右列折到主列下方。 */
.dsh-pm-frame{display:flex;flex:1;min-height:0}
.dsh-pm-rail{flex:none;width:172px;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:16px 10px;display:flex;flex-direction:column;gap:3px;overflow-y:auto}
.dsh-pm-rail-title{font-size:10.5px;font-weight:600;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary);padding:6px 10px 4px;text-transform:uppercase}
.dsh-pm-rail-item{align-items:center;background:none;border:0;border-radius:9px;box-sizing:border-box;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;flex:0 0 auto;font:inherit;font-size:13px;gap:10px;height:38px;padding:0 12px;text-align:left;width:100%}
.dsh-pm-rail-item:hover{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}
.dsh-pm-rail-item.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.12),0 0 0 .5px rgba(0,0,0,.06);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-pm-rail-item .n{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums;margin-left:auto}
.dsh-pm-rail-item.dsh-pm-rail-updates{color:var(--pm-accent)}
.dsh-pm-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:20px;margin:0 auto;max-width:1360px;overflow-y:auto;padding:24px 28px 32px;width:100%}
/* SVG 线性图标：16 网格 / 1.5 描边 / currentColor，替代 emoji。 */
.dsh-pm-ic{display:inline-flex;flex:none}
/* 主列头部：标题 + 日期 + 搜索 + 刷新。 */
.dsh-pm-mainhead{align-items:center;display:flex;gap:10px;flex:0 0 auto;flex-wrap:wrap}
.dsh-pm-mainhead h2{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:700;margin:0;letter-spacing:-.01em}
.dsh-pm-mainhead .date{color:var(--dsw-alias-label-tertiary);font-size:12px}
/* 推荐位（左）＋ 右列（下载榜/星标榜/待更新）。 */
.dsh-pm-cols{align-items:start;display:grid;grid-template-columns:minmax(0,1.6fr) minmax(240px,1fr);gap:14px;flex:0 0 auto}
.dsh-pm-hero{background:radial-gradient(120% 140% at 0% 0%,color-mix(in srgb,var(--pm-accent) 9%,transparent),transparent 55%),var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;gap:12px;padding:14px}
.dsh-pm-hero .who{flex:1;min-width:0}
.dsh-pm-hero-tag{color:var(--pm-accent);font-size:11px;font-weight:600}
.dsh-pm-hero-name{align-items:center;color:var(--dsw-alias-label-primary);display:flex;flex-wrap:wrap;gap:7px;font-size:14.5px;font-weight:700}
.dsh-pm-hero-desc{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:4px 0 8px}
.dsh-pm-hero-stats{color:var(--dsw-alias-label-tertiary);display:flex;flex-wrap:wrap;gap:12px;font-size:11px;font-variant-numeric:tabular-nums}
/* 榜单卡：标题行 + 行列表（名次着色）。 */
.dsh-pm-rank{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}
.dsh-pm-rank-head{align-items:baseline;display:flex;gap:8px;padding:12px 16px 8px}
.dsh-pm-rank-head h3{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:650;margin:0}
.dsh-pm-rank-head .sub{color:var(--dsw-alias-label-tertiary);font-size:11px}
.dsh-pm-rank-row{align-items:center;display:flex;gap:12px;min-height:48px;padding:8px 16px}
.dsh-pm-rank-row + .dsh-pm-rank-row{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-pm-rank-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-pm-rank-row .rk{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;text-align:center;width:16px}
.dsh-pm-rank-row:nth-child(-n+3) .rk{color:var(--dsw-alias-state-warn-primary)}
.dsh-pm-rank-row .who{flex:1;min-width:0}
.dsh-pm-rank-row .nm{color:var(--dsw-alias-label-primary);font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-rank-row .sub{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* 分类分区：标题 + 查看全部。 */
.dsh-pm-sechead{align-items:baseline;display:flex;flex-wrap:wrap;gap:8px;margin-bottom:9px}
.dsh-pm-sechead h3{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:650;margin:0}
.dsh-pm-sechead .sub{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dsh-pm-sechead .viewall{color:var(--pm-accent);cursor:pointer;font-size:12px;margin-left:auto}
.dsh-pm-sechead .viewall:hover{text-decoration:underline}
/* 已验证 / 来源徽章。 */
.dsh-pm-verified{align-items:center;color:var(--dsw-alias-state-success-primary);display:inline-flex;flex:none;gap:3px;font-size:11px;font-weight:550}
.dsh-pm-repl{background:none;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-weight:400}
/* 待更新横条（右列底部）。 */
.dsh-pm-updatestrip{background:var(--dsw-alias-brand-soft,var(--dsw-alias-state-business-tertiary,rgba(59,130,246,.12)));border:1px solid color-mix(in srgb,var(--pm-accent) 28%,transparent);border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:9px;font-size:12px}
.dsh-pm-updatestrip .grow{color:var(--dsw-alias-label-secondary);flex:1;min-width:0}
/* 插件源页行。 */
.dsh-pm-srcrow{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;display:flex;gap:11px;padding:10px 13px}
.dsh-pm-srcrow:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-pm-srcrow .who{flex:1;min-width:0}
.dsh-pm-srcrow .nm{align-items:center;color:var(--dsw-alias-label-primary);display:flex;gap:7px;font-size:13px;font-weight:600}
.dsh-pm-srcrow .spec{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-srcrow .meta{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:2px}
.dsh-pm-srcadd{display:flex;gap:8px;align-items:center}
.dsh-pm-srcadd .inp{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-sizing:border-box;color:var(--dsw-alias-label-primary);flex:1;font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;height:30px;min-width:160px;outline:none;padding:0 10px}
.dsh-pm-srcadd .inp:focus{border-color:var(--pm-accent)}
.dsh-pm-footnote{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:1.5}
/* 内置页说明行（magpie feat-say 式）。 */
.dsh-pm-featsay{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;margin:0 0 10px}
/* 国内加速开关（顶栏内联，magpie pm-mirror 式）。 */
.dsh-pm-mirror{align-items:center;background:none;border:0;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;flex:none;font:inherit;font-size:12px;gap:7px;padding:2px 0;white-space:nowrap}
.dsh-pm-mirror:hover,.dsh-pm-mirror.on{color:var(--dsw-alias-label-primary)}
.dsh-pm-mirror:disabled{cursor:default;opacity:.6}
.dsh-pm-mirror .track{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3);border-radius:999px;box-sizing:border-box;display:inline-block;flex:none;height:16px;position:relative;transition:background .15s,width .15s;width:28px}
.dsh-pm-mirror .track:after{background:var(--dsw-alias-label-tertiary);border-radius:50%;content:"";height:12px;left:1px;position:absolute;top:1px;transition:transform .15s,background .15s;width:12px}
.dsh-pm-mirror.on .track{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}
.dsh-pm-mirror.on .track:after{background:var(--dsw-alias-bg-layer-1);transform:translateX(12px)}
/* ── v3：色彩体系 ────────────────────────────────────────────────────────
   分类色 = 6 组固定色相 + 品牌蓝；图标块/分类 chip 用 13% 透明底 + 同色字，
   深色主题下透明底自然叠在深底上，文字用 color-mix 往 label-primary 靠一点，
   两套主题都不刺眼。状态色仍走宿主的 success / warn / brand 语义 token。 */
.dsh-pm-card-icon.dsh-pm-hue-brand,.dsh-pm-card-chip.dsh-pm-hue-brand{background:color-mix(in srgb,var(--pm-accent) 13%,transparent);color:var(--pm-accent)}
.dsh-pm-card-icon.dsh-pm-hue-ok,.dsh-pm-card-chip.dsh-pm-hue-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);color:var(--dsw-alias-state-success-primary)}
.dsh-pm-card-icon.dsh-pm-hue-warn,.dsh-pm-card-chip.dsh-pm-hue-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dsh-pm-card-icon.dsh-pm-hue-violet,.dsh-pm-card-chip.dsh-pm-hue-violet{background:color-mix(in srgb,#7c5cd6 14%,transparent);color:color-mix(in srgb,#7c5cd6 78%,var(--dsw-alias-label-primary))}
.dsh-pm-card-icon.dsh-pm-hue-teal,.dsh-pm-card-chip.dsh-pm-hue-teal{background:color-mix(in srgb,#0f8f86 14%,transparent);color:color-mix(in srgb,#0f8f86 80%,var(--dsw-alias-label-primary))}
.dsh-pm-card-icon.dsh-pm-hue-rose,.dsh-pm-card-chip.dsh-pm-hue-rose{background:color-mix(in srgb,#c2467a 13%,transparent);color:color-mix(in srgb,#c2467a 80%,var(--dsw-alias-label-primary))}
.dsh-pm-card-icon.dsh-pm-hue-cyan,.dsh-pm-card-chip.dsh-pm-hue-cyan{background:color-mix(in srgb,#1b7fa8 13%,transparent);color:color-mix(in srgb,#1b7fa8 80%,var(--dsw-alias-label-primary))}
.dsh-pm-card-icon.dsh-pm-hue-indigo,.dsh-pm-card-chip.dsh-pm-hue-indigo{background:color-mix(in srgb,#4f63d2 13%,transparent);color:color-mix(in srgb,#4f63d2 80%,var(--dsw-alias-label-primary))}
.dsh-pm-card-chip{align-items:center;border-radius:5px;display:inline-flex;font-size:10.5px;font-weight:600;gap:3px;height:17px;padding:0 6px}
/* 分类条：带数量的分段胶囊（服务端已归并成 6 组，直接平铺，无展开/无下拉） */
.dsh-pm-catbar{align-items:center;display:flex;flex-wrap:wrap;gap:12px;padding-top:4px}
.dsh-pm-segs{display:inline-flex;flex:1 1 0;flex-wrap:nowrap;gap:5px;min-width:0;overflow-x:auto;scrollbar-width:none}
.dsh-pm-segs::-webkit-scrollbar{display:none}
.dsh-pm-seg{flex:none}
.dsh-pm-seg{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font:inherit;font-size:12.5px;gap:6px;height:32px;padding:0 13px}
.dsh-pm-seg:hover{border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-primary)}
.dsh-pm-seg.on{background:var(--pm-accent);border-color:var(--pm-accent);color:var(--pm-accent-fg);font-weight:600}
.dsh-pm-seg .n{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-pm-seg.on .n{color:color-mix(in srgb,var(--pm-accent-fg) 75%,transparent)}
.dsh-pm-seg.more{background:color-mix(in srgb,var(--pm-accent) 8%,transparent);border-color:color-mix(in srgb,var(--pm-accent) 30%,transparent);border-style:dashed;color:var(--pm-accent)}
.dsh-pm-catbar-sp{flex:0 0 auto;width:0}
.dsh-pm-select{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;height:30px;padding:0 8px}
.dsh-pm-select:hover{border-color:var(--dsw-alias-label-tertiary)}
/* 分区：标题行 + 三列栅格（每区 6 张 = 两整行）+ 分区尾部入口 */
.dsh-pm-sec2{display:flex;flex-direction:column;gap:12px}
.dsh-pm-sechead2{align-items:baseline;display:flex;flex-wrap:wrap;gap:8px;padding:0 2px}
.dsh-pm-sechead2 h3{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:700;margin:0}
.dsh-pm-sechead2 .n{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dsh-pm-sechead2 .viewall{align-items:center;color:var(--pm-accent);cursor:pointer;display:inline-flex;font-size:12px;font-weight:600;gap:3px;margin-left:auto}
.dsh-pm-sechead2 .viewall:hover{text-decoration:underline}
.dsh-pm-morelink{display:flex;justify-content:center;padding:2px 0 4px}
.dsh-pm-morelink button{align-items:center;background:none;border:0;border-radius:8px;color:var(--pm-accent);cursor:pointer;display:inline-flex;font:inherit;font-size:12.5px;font-weight:600;gap:4px;padding:6px 14px}
.dsh-pm-morelink button:hover{background:color-mix(in srgb,var(--pm-accent) 10%,transparent)}
/* 分类视图：面包屑 + 分页 */
.dsh-pm-crumbs{align-items:center;color:var(--dsw-alias-label-tertiary);display:flex;font-size:12px;gap:6px}
.dsh-pm-crumbs-back{align-items:center;background:none;border:0;border-radius:6px;color:var(--pm-accent);cursor:pointer;display:inline-flex;font:inherit;font-size:12px;font-weight:600;gap:4px;padding:2px 6px}
.dsh-pm-crumbs-back:hover{background:color-mix(in srgb,var(--pm-accent) 10%,transparent)}
/* 描述找插件：一条虚线检索行 + 结果面板（top5，带理由/下载/星标/版本） */
.dsh-pm-ai-bar{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-tertiary);display:flex;gap:10px;height:46px;padding:0 8px 0 14px;transition:border-color .15s ease,box-shadow .15s ease}
/* 主搜索入口：聚焦时整条边框变品牌色并外发光 */
.dsh-pm-ai-bar:focus-within{border-color:var(--pm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-accent) 14%,transparent)}
.dsh-pm-ai-bar .spark{color:var(--pm-accent)}
.dsh-pm-ai-badge{background:color-mix(in srgb,var(--pm-accent) 12%,transparent);border-radius:5px;color:var(--pm-accent);flex:none;font-size:10.5px;font-weight:700;height:18px;line-height:18px;padding:0 6px}
.dsh-pm-ai-bar .inp{background:none;border:0;color:var(--dsw-alias-label-primary);flex:1;font:inherit;font-size:13.5px;min-width:0;outline:none}
.dsh-pm-ai-bar .inp::placeholder{color:var(--dsw-alias-label-secondary)}
.dsh-pm-ai-go{background:var(--pm-accent);border:0;border-radius:10px;color:var(--pm-accent-fg);cursor:pointer;flex:none;font:inherit;font-size:13px;font-weight:650;height:34px;padding:0 20px;white-space:nowrap}
.dsh-pm-ai-go:hover:not(:disabled){filter:brightness(1.06)}
.dsh-pm-ai-go:disabled{cursor:default;opacity:.55}
.dsh-pm-ai{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;flex-direction:column;gap:10px;padding:16px 18px}
.dsh-pm-ai-head{align-items:baseline;display:flex;flex-wrap:wrap;gap:10px}
.dsh-pm-ai-head h3{color:var(--dsw-alias-label-primary);font-size:13.5px;font-weight:700;margin:0}
.dsh-pm-ai-head .meta{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dsh-pm-ai-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}
.dsh-pm-ai-note.bad{color:var(--dsw-alias-state-error-primary)}
.dsh-pm-ai-list{border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column}
.dsh-pm-ai-row{align-items:center;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;gap:12px;padding:11px 2px}
.dsh-pm-ai-row .rk{color:var(--pm-accent);flex:none;font-size:12px;font-weight:800;text-align:center;width:16px}
.dsh-pm-ai-row .who{flex:1;min-width:0}
.dsh-pm-ai-row .nm{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-ai-row .why{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pm-ai-row .meta{color:var(--dsw-alias-label-tertiary);display:flex;flex:none;font-size:11px;font-variant-numeric:tabular-nums;gap:10px}
.dsh-pm-pager{align-items:center;display:flex;gap:10px;justify-content:center;padding:6px 0 2px}
.dsh-pm-pager .more{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font:inherit;font-size:12.5px;font-weight:600;gap:6px;height:32px;padding:0 18px}
.dsh-pm-pager .more:hover{border-color:var(--pm-accent);color:var(--pm-accent)}
.dsh-pm-pager .meta{color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-variant-numeric:tabular-nums}
/* 推荐位改成整行：描述限宽、统计独立一行 */
.dsh-pm-hero{align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;gap:14px;padding:18px 20px;background:radial-gradient(120% 150% at 100% 0%,color-mix(in srgb,var(--pm-accent) 11%,transparent),transparent 58%),radial-gradient(90% 120% at 0% 100%,color-mix(in srgb,#7c5cd6 7%,transparent),transparent 60%),var(--dsw-alias-bg-layer-1)}
.dsh-pm-hero-name{font-size:18px;letter-spacing:-.01em}
.dsh-pm-hero-desc{font-size:13px;max-width:760px}
.dsh-pm-hero-stats{gap:40px;margin-top:16px}
.dsh-pm-hero-stats .s b{display:block;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.dsh-pm-hero-stats .s span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
/* 两列榜单 */
.dsh-pm-cols2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
/* 三列卡片栅格（发现页分区 / 分类视图共用） */
.dsh-pm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
@media (max-width:900px){.dsh-pm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dsh-pm-cols2{grid-template-columns:1fr}}
/* 窄窗口：左栏收成顶部一行（内容区 < 860px 由容器查询兜不住时媒体查询兜底）。 */
@media (max-width:860px){
  .dsh-pm-frame{flex-direction:column}
  .dsh-pm-rail{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2);flex-direction:row;overflow-x:auto;padding:8px 10px;width:100%}
  .dsh-pm-rail-title{display:none}
  .dsh-pm-rail-item{flex:1 0 auto;justify-content:center;width:auto}
  .dsh-pm-rail-item .n{margin-left:3px}
  .dsh-pm-cols{grid-template-columns:1fr}
}`
  /* SVG 线性图标集（16 网格 / 1.5 描边 / currentColor）：分类、榜单与工具按钮
     全部用矢量图标，不用 emoji（跨平台字形不一致、与宿主设计语言不搭）。 */
  const ICON_PATHS = {
    search: '<circle cx="6.5" cy="6.5" r="4.5"/><path d="m10.2 10.2 3.8 3.8"/>',
    refresh: '<path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/>',
    plus: '<path d="M8 3.5v9M3.5 8h9"/>',
    check: '<path d="m3.5 8.5 3 3 6-7"/>',
    shield: '<path d="M8 1.5 13.5 3.5v4c0 3.6-2.3 6-5.5 7-3.2-1-5.5-3.4-5.5-7v-4Z"/><path d="m5.8 7.7 1.6 1.6 2.8-3"/>',
    x: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
    chev: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
    expand: '<path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10"/>',
    collapse: '<path d="M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5"/>',
    back: '<path d="M10 3.5 5.5 8 10 12.5"/>',
    sparkle: '<path d="M8 1.8l1.1 2.9 2.9 1.1-2.9 1.1L8 9.8 6.9 6.9 4 5.8l2.9-1.1Z"/><path d="M12.4 10.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6Z"/>',
    download: '<path d="M8 2.5v7.5M8 10l2.8-2.8M8 10 5.2 7.2"/><path d="M2.5 13.5h11"/>',
    star: '<path d="M8 2.2l1.7 3.6 3.9.5-2.8 2.7.7 3.9L8 11l-3.5 1.9.7-3.9L2.4 6.3l3.9-.5Z"/>',
    cube: '<path d="M8 1.8 13.8 4.8v6.4L8 14.2 2.2 11.2V4.8Z"/><path d="M2.2 4.8 8 7.8l5.8-3M8 7.8v6.4"/>',
    compass: '<circle cx="8" cy="8" r="6"/><path d="M10.8 5.2 9.2 9.2 5.2 10.8 6.8 6.8Z"/>',
    bell: '<path d="M8 2.2a4 4 0 0 0-4 4v2.6L2.6 11h10.8L12 8.8V6.2a4 4 0 0 0-4-4Z"/><path d="m6.2 13.2a1.9 1.9 0 0 0 3.6 0"/>',
    globe: '<circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2c2.2 2.4 2.2 9.6 0 12-2.2-2.4-2.2-9.6 0-12Z"/>',
    chart: '<path d="M3 13.5V9.5M8 13.5V4M13 13.5V6.5"/>',
    zap: '<path d="M9.2 1.8 4 9h3.6L6.8 14.2 12 7H8.4Z"/>',
    hdd: '<path d="M2.5 9.5h11v3.5h-11Z"/><path d="M2.5 9.5 4.2 4h7.6l1.7 5.5"/><path d="M5 11.2h.01"/>',
    layers: '<path d="M8 2.2 13.8 5 8 7.8 2.2 5Z"/><path d="m2.2 8 5.8 2.8L13.8 8"/><path d="m2.2 10.5 5.8 2.8 5.8-2.8"/>',
    server: '<rect x="2.5" y="2.5" width="11" height="4.5" rx="1.2"/><rect x="2.5" y="9" width="11" height="4.5" rx="1.2"/><path d="M5 4.75h.01M5 11.25h.01M10 4.75h1.5M10 11.25h1.5"/>',
    puzzle: '<path d="M6 2.5h4v2.2a1.3 1.3 0 1 0 2.6 0V2.5H13.5v4h-2.2a1.3 1.3 0 1 0 0 2.6h2.2v4.4h-4v-2.2a1.3 1.3 0 1 0-2.6 0v2.2H2.5V9h2.2a1.3 1.3 0 1 0 0-2.6H2.5V2.5H6Z"/>',
    archive: '<rect x="2" y="3" width="12" height="3" rx=".8"/><path d="M3.2 6v6.5A1.5 1.5 0 0 0 4.7 14h6.6a1.5 1.5 0 0 0 1.5-1.5V6"/><path d="M6.5 8.5h3"/>',
    branch: '<circle cx="5" cy="3.5" r="1.7"/><circle cx="5" cy="12.5" r="1.7"/><circle cx="11.5" cy="5" r="1.7"/><path d="M5 5.2v5.6M11.5 6.7c0 3-2.9 4.8-6.5 4.8"/>',
    message: '<path d="M2.5 3h11a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H7.5L4.5 13.5v-2.5h-2a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5Z"/>',
    palette: '<circle cx="8" cy="8" r="6"/><circle cx="6" cy="6" r="1"/><circle cx="10" cy="6" r="1"/><path d="M8 14c0-2 1.5-2.5 3-2.5"/>',
    workflow: '<path d="M3 2.5v6a2 2 0 0 0 2 2h8"/><rect x="9" y="8.5" width="4.5" height="4.5" rx="1"/><circle cx="3" cy="11" r="1.5"/>',
    robot: '<rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 2.5V5M6.5 9h.01M9.5 9h.01M6 11h4"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.9 3.9l1.4 1.4M10.7 10.7l1.4 1.4M12.1 3.9l-1.4 1.4M5.3 10.7l-1.4 1.4"/>',
  }
  /**
   * 渲染一个线性 SVG 图标节点。name 是 ICON_PATHS 的键；size 是像素边长。
   * aria-hidden 恒真：图标永远伴随可见文字或 aria-label，不单独承载语义。
   */
  function icon(name, size = 14) {
    const path = ICON_PATHS[name] || ICON_PATHS.puzzle
    return h('span', { className: 'dsh-pm-ic', 'aria-hidden': true },
      h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', dangerouslySetInnerHTML: undefined },
        // h() 是 createElement：path 内容直接用 dangerouslySetInnerHTML 会带来
        // React 告警；这里 path 是本文件写死的字符串，用 <g> 包一层
        // 或干脆用 innerHTML 都可以，但为了走 createElement，展开成子节点：
        ...(function expand() {
          // 极简 path 展开器：把 ICON_PATHS 的 d/rect/circle 标记转成 vnode 数组。
          const nodes = []
          const tokenRe = /<(path|rect|circle)\b([^>]*)\/?>|<path\b([^>]*)\/>/g
          let m
          const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
          while ((m = tokenRe.exec(path))) {
            const tag = m[1]
            const attrs = {}
            let a
            const attrText = m[2] ?? m[3] ?? ''
            while ((a = attrRe.exec(attrText))) attrs[a[1]] = a[2]
            nodes.push(h(tag, { key: nodes.length, ...attrs }))
          }
          return nodes
        })()))
  }

  /* 分类 → 图标与展示名（与 magpie 的 kind chip 同思路：图标着色区分类型）。 */
  const CATEGORY_ICONS = {
    official: 'shield', browser: 'globe', tool: 'gear', ui: 'palette', storage: 'hdd',
    workflow: 'workflow', agent: 'robot', search: 'search', data: 'chart',
    network: 'globe', dev: 'cube', panel: 'layers', notify: 'bell', auto: 'zap',
    message: 'message', store: 'archive', other: 'puzzle',
  }
  const CATEGORY_LABELS = {
    official: '官方', ui: '界面', panel: '界面', tools: '工具', tool: '工具', session: '会话',
    workflow: '工作流', auto: '自动化', dev: '开发', usage: '用量', model: '模型',
    memory: '记忆', theme: '主题', skill: '技能', notify: '通知', browser: '浏览器',
    storage: '存储', data: '数据', search: '搜索', network: '网络', agent: '智能体', other: '其他',
    market: '市场', mcp: 'MCP', prompt: '提示词', web: '网页', image: '图像', voice: '语音', cli: '命令行', gateway: '网关', plugin: '插件',
  }
  const categoryLabel = category => CATEGORY_LABELS[category] || category || '其他'
  const categoryIcon = category => CATEGORY_ICONS[category] || 'puzzle'
  /* 分类 → 色相（v3 配色）：品牌蓝 / 青 / 紫 / 琥珀 / 绿 / 玫 / 靛，未命中的中性灰。 */
  const CATEGORY_HUES = {
    official: 'indigo', ui: 'brand', panel: 'brand', tools: 'teal', tool: 'teal',
    session: 'violet', notify: 'ok', workflow: 'warn', auto: 'warn', dev: 'indigo',
    usage: 'violet', model: 'cyan', memory: 'rose', theme: 'rose', skill: 'teal',
    browser: 'cyan', storage: 'rose', data: 'ok', search: 'cyan', network: 'cyan',
    agent: 'violet', other: 'neutral',
    market: 'brand', mcp: 'teal', prompt: 'violet', web: 'cyan', image: 'rose',
    voice: 'rose', cli: 'indigo', gateway: 'teal', plugin: 'brand',
  }
  const categoryHue = category => 'dsh-pm-hue-' + (CATEGORY_HUES[category] || 'neutral')
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
    const skipped = results.filter(result => result && result.skipped === true).length
    const skippedNote = skipped > 0 ? `；${skipped} 个为本地开发链接，请在其行内「更新」中选择更新方式` : ''
    if (failed === 0) return { kind: skipped > 0 ? 'info' : 'success', text: `已更新 ${updated} 个插件${pendingNote}${skippedNote}，重启 dsh 后生效` }
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

  /// 市场刷新是**后台任务**：请求发出后 UI 不等它，进行中也不占 busy。
  /// 放在模块级（而不是组件里）是因为面板关掉再打开是新的组件实例；同一页面里
  /// 仍只该有一个在途请求——否则两个请求会同时删/clone 市场仓库
  ///（服务端 refreshMarketRepo 先 rm 再 clone，并发必然互相踩）。
  let marketRefreshFlight = null
  function startMarketRefresh() {
    if (marketRefreshFlight === null) {
      marketRefreshFlight = fetch('/dsh-plugin-manager/refresh', { method: 'POST' })
        .finally(() => { marketRefreshFlight = null })
    }
    return marketRefreshFlight
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
    // 方案 B：默认落在「发现」（magpie 同构——打开插件页就是逛市场），
    // 已安装/内置/插件源经左栏切换。tabs: discover | builtin | installed | sources
    const [tab, setTab] = React.useState('discover')
    // 插件源清单：GET /sources（builtin 默认源 + 用户自定义源，带每源缓存状态）。
    const [sources, setSources] = React.useState(null)
    // 国内加速状态：{ enabled, pluginPresent }；null = 还没读到。
    const [mirror, setMirror] = React.useState(null)
    const [mirrorSaving, setMirrorSaving] = React.useState(false)
    const [installed, setInstalled] = React.useState([])
    const [market, setMarket] = React.useState(null)
    const [search, setSearch] = React.useState('')
    const [manualSpec, setManualSpec] = React.useState('')
    const [category, setCategory] = React.useState('all')
    const [sort, setSort] = React.useState('stars')
    // 分类条折叠：超过 8 个分类时其余收进「全部 N 类」按钮，点击在位展开。
    const [catExpanded, setCatExpanded] = React.useState(false)
    // 来源筛选：all | official | community | 自定义源 id。
    const [source, setSource] = React.useState('all')
    // 描述找插件（模型检索）：输入、加载、结果。
    const [aiQuery, setAiQuery] = React.useState('')
    const [aiLoading, setAiLoading] = React.useState(false)
    const [aiResult, setAiResult] = React.useState(null)
    // 全屏：面板铺满窗口（记住上次选择；localStorage 不可用时静默降级）。
    const [fullscreen, setFullscreen] = React.useState(() => {
      try { return window.localStorage.getItem('dsh-plugin-manager:fullscreen') === '1' } catch { return false }
    })
    const toggleFullscreen = () => setFullscreen(value => {
      const next = !value
      try { window.localStorage.setItem('dsh-plugin-manager:fullscreen', next ? '1' : '0') } catch { /* 无 localStorage 就不记 */ }
      return next
    })
    const [detail, setDetail] = React.useState(null)
    const [busy, setBusy] = React.useState('')
    // 市场刷新是后台任务，独立于 busy：进行中只锁「刷新市场」按钮本身，不锁关闭、
    // 不锁安装/卸载等其它操作（用户报告：刷新期间点关闭关不上，只能干等）。
    const [refreshing, setRefreshing] = React.useState(false)
    const refreshingRef = React.useRef(false)
    // 面板可能在刷新途中被关掉：卸载后的 setState / toast 一律跳过，让刷新真正只
    // 依赖后台请求，不要求面板还活着。
    const aliveRef = React.useRef(true)
    React.useEffect(() => () => { aliveRef.current = false }, [])
    const [confirmUninstall, setConfirmUninstall] = React.useState(null)
    const [selected, setSelected] = React.useState(new Set())
    const [confirmBatch, setConfirmBatch] = React.useState(false)
    // 重启确认框：{ title, copy }。卸载/停用/启用共用一个确认流程。
    const [restartPrompt, setRestartPrompt] = React.useState(null)
    // 插件停用状态：bundle -> { rowIds, disabled, canDisable, reason }。
    // 由 GET /dsh-plugin-manager/disabled 提供；接口失败时开关保持禁用（不猜状态）。
    const [disabledPlugins, setDisabledPlugins] = React.useState({})
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
      .then(() => loadDisabled())
      .catch(e => setError(String(e.message || e)))
    /// 停用状态与已安装列表分开读：接口失败时只让开关不可用，不拖垮整个面板。
    const loadDisabled = () => fetch('/dsh-plugin-manager/disabled', { cache: 'no-store' })
      .then(r => r.json()).then(v => {
        if (v.error) throw Error(v.error)
        const map = {}
        for (const item of (Array.isArray(v.items) ? v.items : [])) {
          if (!item || typeof item.bundle !== 'string') continue
          map[item.bundle] = {
            bundle: item.bundle,
            rowIds: Array.isArray(item.rowIds) ? item.rowIds : [],
            disabled: item.disabled === true,
            canDisable: item.canDisable === true,
            reason: typeof item.reason === 'string' && item.reason ? item.reason : null,
          }
        }
        setDisabledPlugins(map)
      })
      .catch(e => { if (aliveRef.current) toast('error', `读取插件停用状态失败：${String(e.message || e)}`) })
    /// 市场查询（服务端分页）。overrides 用于「显示更多」按当前条件续页。
    const marketQueryURL = (overrides = {}) => {
      const params = [
        ['limit', PAGE_SIZE],
        ['offset', overrides.offset ?? 0],
        ['q', overrides.q ?? search],
        ['group', overrides.group ?? category],
        ['source', overrides.source ?? source],
        ['sort', overrides.sort ?? sort],
      ]
      return '/dsh-plugin-manager/marketplace/query?' + params
        .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
        .join('&')
    }
    const loadMarket = (overrides = {}) => fetch(marketQueryURL(overrides), { cache: 'no-store' })
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
    /// 「显示更多」：按当前条件续一页并追加（服务端 total 决定还有没有）。
    const loadMoreMarket = () => {
      if (loadingMore || !market || market === false) return
      if (marketPlugins.length >= marketTotal) return
      setLoadingMore(true)
      fetch(marketQueryURL({ offset: marketPlugins.length }), { cache: 'no-store' })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          setMarket(current => current && current !== false
            ? { ...current, plugins: [...(current.plugins || []), ...(v.plugins || [])], total: v.total ?? current.total }
            : v)
        })
        .catch(e => toast('error', `加载更多失败：${String(e.message || e)}`))
        .finally(() => setLoadingMore(false))
    }
    // loadInstalled 成功后顺带刷新停用状态，避免打开面板时重复请求 /disabled。
    React.useEffect(() => { loadInstalled() }, [])
    React.useEffect(() => { if (tab === 'discover') loadMarket() }, [tab])
    // 搜索/分类/排序变化 → 重新查询（搜索防抖 250ms，避免逐字符打服务端）。
    React.useEffect(() => {
      if (tab !== 'discover') return undefined
      const timer = setTimeout(() => { loadMarket() }, 250)
      return () => clearTimeout(timer)
    }, [search, category, sort, source])
    // 打开面板立刻读一次更新缓存；服务端若正在后台刷新（首轮检测），就等它跑完再显示。
    React.useEffect(() => { pollUpdates().then(applyUpdates) }, [])
    /// 插件源清单与国内加速状态：打开面板读一次；源页操作后重读。
    const loadSources = () => fetch('/dsh-plugin-manager/sources', { cache: 'no-store' })
      .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setSources(v.sources || []) })
      .catch(e => { if (aliveRef.current) setSources([]) })
    const loadMirror = () => fetch('/dsh-plugin-manager/china-mirror', { cache: 'no-store' })
      .then(r => r.json()).then(v => setMirror({ enabled: v.enabled === true, pluginPresent: v.pluginPresent !== false }))
      .catch(() => setMirror({ enabled: false, pluginPresent: false }))
    React.useEffect(() => { loadSources(); loadMirror() }, [])
    React.useEffect(() => { if (tab === 'sources') loadSources() }, [tab])
    /// 国内加速开关：转发给镜像插件（写盘立即生效），失败时如实说插件不可用。
    const toggleMirror = () => {
      if (mirrorSaving || !mirror) return
      setMirrorSaving(true)
      const next = !(mirror && mirror.enabled)
      fetch('/dsh-plugin-manager/china-mirror/set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: next }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          setMirror({ enabled: v.enabled === true, pluginPresent: true })
          toast('info', v.enabled ? '国内加速已开启：npm 与 GitHub 下载走国内镜像' : '国内加速已关闭：恢复直连')
        })
        .catch(e => toast('error', `切换国内加速失败：${String(e.message || e)}`))
        .finally(() => setMirrorSaving(false))
    }
    /// 添加/删除/启停插件源：写完重读清单并刷新一次聚合索引（后台，不阻塞）。
    const addSource = (kind, url) => {
      setBusy('source-add')
      fetch('/dsh-plugin-manager/sources/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, url }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          toast('success', v.alreadyAdded ? '这个源已经添加过了' : `已添加源 ${v.source.url}，正在拉取索引…`)
          startMarketRefresh().catch(() => {})
          return loadSources()
        })
        .catch(e => toast('error', `添加源失败：${String(e.message || e)}`))
        .finally(() => setBusy(''))
    }
    const removeSource = (id) => {
      setBusy('source-remove')
      fetch('/dsh-plugin-manager/sources/remove', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          toast('success', '已删除源（已安装的插件不受影响）')
          return loadSources()
        })
        .catch(e => toast('error', `删除源失败：${String(e.message || e)}`))
        .finally(() => setBusy(''))
    }
    const toggleSource = (source) => {
      setBusy('source-toggle-' + source.id)
      fetch('/dsh-plugin-manager/sources/set-enabled', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: source.id, enabled: !(source.enabled !== false) }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          return loadSources()
        })
        .catch(e => toast('error', `切换源状态失败：${String(e.message || e)}`))
        .finally(() => setBusy(''))
    }
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

    /// 刷新市场：后台任务。不占用 busy，因此刷新期间面板能关、安装/卸载/切 tab
    /// 照常可用；只有「刷新市场」按钮本身置灰并显示「刷新中…」。面板在途中被关掉
    /// 也不取消请求——结果照常落到本地索引，下次打开就是新的。
    /// 服务端是**异步受理**（202 + /sources/progress），所以这里必须轮询进度到
    /// 收尾再重读索引：此前按同步响应读 v.count，toast 显示「undefined 个插件」，
    /// 列表也没刷新（用户实测）。
    const refreshMarket = () => {
      if (refreshingRef.current) return
      refreshingRef.current = true
      if (aliveRef.current) setRefreshing(true)
      startMarketRefresh()
        .then(r => r.json())
        .then(v => {
          if (v.error) throw Error(v.error)
          return waitForSourceRefresh()
        })
        .then(progress => {
          if (!aliveRef.current) return
          const results = Array.isArray(progress?.results) ? progress.results : []
          const total = results.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
          const failed = results.filter(item => item && item.ok === false)
          if (failed.length > 0) {
            toast('info', `插件源已同步：${total} 个插件（${failed.length} 个源失败，见插件源页）`)
          } else {
            toast('success', `插件源已同步：${total} 个插件`)
          }
          return loadMarket()
        })
        .catch(e => { if (aliveRef.current) toast('error', `刷新插件源失败：${String(e.message || e)}`) })
        .finally(() => {
          refreshingRef.current = false
          if (aliveRef.current) setRefreshing(false)
        })
    }
    /// 轮询源刷新进度直到收尾（active=false）。最多约 3 分钟，超时就把最后一次
    /// 读到的进度交回去（刷新仍会在后台跑完，索引下次读取就是新的）。
    const waitForSourceRefresh = (attempt = 0) => fetch('/dsh-plugin-manager/sources/progress', { cache: 'no-store' })
      .then(r => r.json())
      .then(v => {
        const progress = v && v.progress
        if (progress && progress.active === true && attempt < 120) {
          return delay(1500).then(() => waitForSourceRefresh(attempt + 1))
        }
        return progress || null
      })
      .catch(() => null)
    // 安装队列：点按立即入队、顺序执行（magpie 式——进度是一条安静的
    // 状态条，全部结束后才给一条汇总 toast）。installStatus 记录每个
    // 插件的排队/执行态，供按钮文案与禁用使用。
    const installQueueRef = React.useRef([])
    const installRunningRef = React.useRef(false)
    const installTotalRef = React.useRef(0)
    const [installStatus, setInstallStatus] = React.useState({})
    const [queueView, setQueueView] = React.useState([])
    // 更新队列：与安装队列共用同一把串行锁（都要跑 pnpm，并发写同一 profile
    // 会互相踩）。点多个「更新」依次排队，排队期间还能继续点其他的。
    const updateQueueRef = React.useRef([])
    const [updateStatus, setUpdateStatus] = React.useState({}) // name -> 'queued' | 'updating'
    const [updateQueueView, setUpdateQueueView] = React.useState([])
    const updateTotalRef = React.useRef(0)
    const mutationRunningRef = React.useRef(false)
    const [mutationActive, setMutationActive] = React.useState(false)
    const busyRef = React.useRef('')
    busyRef.current = busy
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
    /// 单条更新请求；成功返回 {name, updatedTo, verified}，失败返回 null（已 toast）。
    const updateOneRequest = async (name, mode) => {
      try {
        const r = await fetch('/dsh-plugin-manager/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mode }) })
        const v = await r.json()
        if (v.error && v.status !== 'dev-linked') throw Error(v.error)
        if (v.status === 'dev-linked') {
          // 服务端要求用户显式选择更新方式；确认块本身就是反馈，不再叠 error toast。
          setDevLinkedChoice({ name, error: v.error })
          return null
        }
        if (!v.ok) throw Error(v.error || '更新失败')
        setDevLinkedChoice(null)
        // 验收未过（node_modules 版本没跟上）不是成功：用中性提示如实说，
        // 别让绿色 toast 把「需重启确认」装饰成「已完成」。
        toast(v.verified === false ? 'info' : 'success', updateSuccessText(name, v))
        return { name, updatedTo: v.updatedTo, verified: v.verified !== false }
      } catch (e) {
        toast('error', `更新 ${name} 失败：${String(e.message || e)}`)
        return null
      }
    }
    const updateOne = (item, mode) => {
      // 入队即返回：更新走与安装同一把串行锁，点多个依次执行，互不阻塞。
      if (updateStatus[item.name] || batchRunning) return
      updateTotalRef.current += 1
      updateQueueRef.current = [...updateQueueRef.current, { item, mode }]
      setUpdateQueueView([...updateQueueRef.current])
      setUpdateStatus(s => ({ ...s, [item.name]: 'queued' }))
      void pumpMutations()
    }
    /// 统一串行泵：更新与安装共用（都要跑 pnpm，并发写同一 profile 会互相踩）。
    /// 队列非空就持续处理；卸载/清理这类非排队操作进行中时先让行。
    const waitWhileDestructive = async () => {
      while (/^(uninstall|uninstall-many|cleanup-)/.test(busyRef.current)) {
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    }
    const runOneUpdate = async (task) => {
      await waitWhileDestructive()
      setUpdateStatus(s => ({ ...s, [task.item.name]: 'updating' }))
      const outcome = await updateOneRequest(task.item.name, task.mode)
      updateQueueRef.current = updateQueueRef.current.slice(1)
      setUpdateQueueView([...updateQueueRef.current])
      setUpdateStatus(s => { const next = { ...s }; delete next[task.item.name]; return next })
      if (outcome) {
        settleUpdates([{ name: outcome.name, ok: true, updatedTo: outcome.updatedTo }])
        return outcome
      }
      return null
    }
    const runOneInstall = async (plugin) => {
      await waitWhileDestructive()
      setInstallStatus(s2 => ({ ...s2, [plugin.id]: 'installing' }))
      const outcome = await installOne(plugin)
      installQueueRef.current = installQueueRef.current.slice(1)
      setQueueView([...installQueueRef.current])
      setInstallStatus(s2 => { const next = { ...s2 }; delete next[plugin.id]; return next })
      return { outcome, name: plugin.repo || plugin.name }
    }
    const pumpMutations = async () => {
      if (mutationRunningRef.current) return
      mutationRunningRef.current = true
      setMutationActive(true)
      try {
        const installedNames = []
        const updatedRecords = []
        let sawInstall = false
        let sawUpdate = false
        while (updateQueueRef.current.length > 0 || installQueueRef.current.length > 0) {
          while (updateQueueRef.current.length > 0) {
            sawUpdate = true
            const outcome = await runOneUpdate(updateQueueRef.current[0])
            if (outcome) updatedRecords.push(outcome)
          }
          while (installQueueRef.current.length > 0) {
            sawInstall = true
            const { outcome, name } = await runOneInstall(installQueueRef.current[0])
            if (outcome === 'ok') installedNames.push(name)
          }
        }
        if (sawInstall && installedNames.length > 0) {
          setDetail(null)
          await loadInstalled()
          // 验收回读：接口说 ok 不等于插件真的出现在已安装列表（magpie 的规矩）。
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
        if (sawUpdate && updatedRecords.length > 0) await loadInstalled()
      } finally {
        mutationRunningRef.current = false
        installTotalRef.current = 0
        updateTotalRef.current = 0
        setMutationActive(false)
      }
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
    /// 卸载成功后立刻重读一次检测结果：服务端会把已卸载插件的条目裁掉，侧边栏角标与
    /// 「全部更新 (n)」不必等下一轮 60 秒轮询才归一。
    const reloadUpdatesAfterUninstall = () => loadUpdates().then(value => { if (value) applyUpdates(value) })
    const confirmUninstallGo = () => {
      if (!confirmUninstall) return
      const name = confirmUninstall.name
      setBusy('uninstall'); setConfirmUninstall(null)
      fetch('/dsh-plugin-manager/uninstall', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '卸载失败')
          if (v.needsRestart) setRestartPrompt({ title: `已卸载 ${name}`, copy: '侧边栏入口会在重启 dsh 后消失。是否立即重启？' })
          else toast('success', `已卸载 ${name}`)
          return loadInstalled().then(reloadUpdatesAfterUninstall)
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

    /// 停用/启用一个插件：写的是启动器的 --patch 覆盖层，重启 dsh 后生效。
    /// 先乐观切换开关（用户点了就该有反馈），失败再回滚原状态并 toast——
    /// 服务端才是最后一道闸（不可停用/找不到行 id 的插件会在那里被拒）。
    const togglePluginDisabled = (item, nextDisabled) => {
      if (!item || !item.name || item.broken) return
      const name = item.name
      const previous = disabledPlugins[name] || null
      if (busy !== '' || previous && previous.canDisable === false) return
      setDisabledPlugins(current => ({
        ...current,
        [name]: {
          bundle: name,
          rowIds: (previous && previous.rowIds) || [],
          disabled: nextDisabled,
          canDisable: true,
          reason: null,
        },
      }))
      setBusy('disable-' + name)
      fetch('/dsh-plugin-manager/set-disabled', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundle: name, disabled: nextDisabled }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '设置失败')
          setDisabledPlugins(current => ({
            ...current,
            [name]: {
              bundle: name,
              rowIds: Array.isArray(v.rowIds) ? v.rowIds : ((current[name] && current[name].rowIds) || []),
              disabled: v.disabled === true,
              canDisable: true,
              reason: null,
            },
          }))
          if (!aliveRef.current) return
          const verb = nextDisabled ? '停用' : '启用'
          toast('info', `已${verb} ${name}，重启 dsh 后生效`)
          setRestartPrompt({ title: `已${verb} ${name}`, copy: '重启 dsh 后生效。是否立即重启？' })
        })
        .catch(e => {
          // 回到原状态：没读到过就删掉，本来就有就恢复。
          setDisabledPlugins(current => {
            const next = { ...current }
            if (previous) next[name] = previous
            else delete next[name]
            return next
          })
          if (aliveRef.current) toast('error', `${nextDisabled ? '停用' : '启用'} ${name} 失败：${String(e.message || e)}`)
        })
        .finally(() => setBusy(''))
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
            setRestartPrompt({ title: `已卸载 ${selectedNames.length} 个插件`, copy: '侧边栏入口会在重启 dsh 后消失。是否立即重启？' })
          } else {
            toast('error', `卸载失败：${failed.map(f => f.name).join('、')}`)
            const done = selectedNames.filter(name => !failed.some(f => f.name === name))
            if (done.length > 0) {
              toast('success', `已卸载 ${done.length} 个插件`)
              setRestartPrompt({ title: `已卸载 ${done.length} 个插件`, copy: '侧边栏入口会在重启 dsh 后消失。是否立即重启？' })
            }
          }
          setSelected(new Set())
          return loadInstalled().then(reloadUpdatesAfterUninstall)
        })
        .catch(e => toast('error', `批量卸载失败：${String(e.message || e)}`)).finally(() => setBusy(''))
    }

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
    // 市场查询走服务端分页（/marketplace/query）：社区清单 1.1 万条时整包 9.6MB，
    // webview 每次打开都要下载解析一遍，表现为长时间「加载中…」。服务端按
    // q/category/sort 过滤并只回一页，同时带回分类计数与两张榜。
    const [loadingMore, setLoadingMore] = React.useState(false)
    const marketPlugins = market?.plugins || []
    // 分类与榜单：服务端返回 counts/topDownloads/topStars；旧响应没有时从当前页推导
    //（测试与旧服务端兼容）。
    const categoryCounts = React.useMemo(() => {
      const counts = new Map()
      if (Array.isArray(market?.counts) && market.counts.length > 0) {
        for (const item of market.counts) counts.set(item.name, item.count)
        return counts
      }
      for (const plugin of marketPlugins) counts.set(plugin.category, (counts.get(plugin.category) || 0) + 1)
      return counts
    }, [market, marketPlugins])
    // 分类条：原始分类按数量降序；超过 8 个时只平铺前 8 个，其余收进
    // 「全部 N 类」按钮，点击在分类条下方换行展开全部（不做下拉、不做横向滚动）。
    const orderedCategories = React.useMemo(
      () => [...categoryCounts.keys()].filter(Boolean).sort((a, b) => (categoryCounts.get(b) || 0) - (categoryCounts.get(a) || 0)),
      [categoryCounts]
    )
    const pinnedCategories = orderedCategories.slice(0, 8)
    const tailCategories = orderedCategories.slice(8)
    const groupLabel = (id) => {
      const hit = Array.isArray(market?.counts) ? market.counts.find(item => item.name === id) : null
      return (hit && hit.label) || categoryLabel(id)
    }
    const marketTotal = Number(market?.total ?? marketPlugins.length) || 0
    const marketFeatured = Array.isArray(market?.featured) && market.featured.length > 0
      ? market.featured
      : [...marketPlugins].sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 5)
    const marketTopDownloads = Array.isArray(market?.topDownloads) && market.topDownloads.length > 0
      ? market.topDownloads
      : [...marketPlugins].sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 5)
    const marketTopStars = Array.isArray(market?.topStars) && market.topStars.length > 0
      ? market.topStars
      : [...marketPlugins].sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 5)

    const installedRows = installed.map((item, index) => {
      const selectable = !item.broken && item.source !== 'bundled'
      // 停用状态来自服务端（GET /disabled）；读不到时开关置灰，不猜测。
      const disableInfo = disabledPlugins[item.name] || null
      const pluginOff = Boolean(disableInfo && disableInfo.disabled)
      // 开关方向按通行约定：ON = 插件正在生效（启用），OFF = 已停用。
      // 状态未知（读不到 /disabled）时显示 OFF 且置灰，不假装启用。
      const pluginOn = Boolean(disableInfo && disableInfo.disabled === false)
      const switchPending = busy === 'disable-' + item.name
      const switchDisabled = !disableInfo || !disableInfo.canDisable || switchPending || busyOther || batchRunning
      const switchTitle = !disableInfo ? '停用状态读取失败，重新打开面板再试'
        : !disableInfo.canDisable ? (disableInfo.reason || '这个插件不支持停用')
        : pluginOn ? '停用这个插件（重启 dsh 后生效）'
        : '启用这个插件（重启 dsh 后生效）'
      // 开关旁边的常驻状态文字：禁用原因只写在 title 里不够，旁边直接说清楚。
      const switchText = switchPending ? '切换中…'
        : !disableInfo ? '状态未知'
        : !disableInfo.canDisable ? '不可停用'
        : pluginOn ? '已启用' : '已停用'
      const switchNode = item.broken ? null : h('label', { className: 'dsh-pm-switch', title: switchTitle },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          className: 'dsh-pm-switch-input',
          checked: pluginOn,
          disabled: switchDisabled,
          title: switchTitle,
          'aria-label': (pluginOn ? '停用 ' : '启用 ') + item.name,
          // 点击即切换：启用中 → 请求停用；已停用 → 请求启用。
          onChange: () => togglePluginDisabled(item, pluginOn),
        }),
        h('span', { className: 'dsh-pm-switch-track', 'aria-hidden': true }),
        h('span', { className: 'dsh-pm-switch-text' }, switchText))
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
        className: `dsh-pm-row${selectable ? ' dsh-pm-row-selectable' : ''}${pluginOff ? ' dsh-pm-row-off' : ''}`,
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
            ? h('button', {
                className: 'dsh-pm-update',
                disabled: batchRunning || Boolean(updateStatus[item.name]),
                onClick: () => updateOne(item),
                title: batchRunning ? '批量更新进行中，等它结束再更新这个插件'
                  : updateStatus[item.name] === 'queued' ? '已加入更新队列'
                  : updateStatus[item.name] === 'updating' ? '正在更新'
                  : `更新 ${item.name} 到 v${entry.latestVersion}`,
              }, updateStatus[item.name] === 'updating' || updating ? '更新中…'
                : updateStatus[item.name] === 'queued' ? (updateQueueView.length > 1 ? '排队中…' : '更新中…')
                : '更新')
            : null,
          updatable
            ? h('button', {
                className: 'dsh-pm-row-action dsh-pm-ignore',
                disabled: busyOther,
                onClick: () => (ignored ? unignoreOne(item) : ignoreOne(item, entry)),
                title: ignored ? '恢复这个版本的更新提醒' : `不再提醒 ${item.name} 的 v${entry.latestVersion}（远端出更高版本时会再提醒）`,
              }, ignored ? '取消忽略' : '忽略')
            : null),
        switchNode,
        item.source === 'bundled' ? h('span', { className: 'dsh-pm-badge' }, '内置') : null,
        pluginOff ? h('span', { className: 'dsh-pm-badge dsh-pm-badge-disabled' }, '已停用') : null,
        item.broken ? h('span', { className: 'dsh-pm-badge', style: { borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' } }, '损坏') : null,
        item.broken
          ? h('button', { className: 'dsh-pm-row-action', disabled: busy === 'cleanup-' + item.name || batchRunning || busyOther, onClick: () => cleanupBroken(item), title: batchRunning ? '批量更新进行中，等它结束后再清理' : '清理损坏的安装残留' }, busy === 'cleanup-' + item.name ? '清理中…' : '清理')
          : item.source === 'bundled'
            ? h('button', { className: 'dsh-pm-row-action', disabled: true, title: '内置插件不可卸载' }, '—')
            : h('button', { className: 'dsh-pm-row-action', disabled: busy === 'uninstall' || busy === 'uninstall-many' || batchRunning || busyOther || mutationActive, onClick: () => requestUninstall(item), title: mutationActive ? '安装/更新进行中，结束后再卸载' : batchRunning ? '批量更新进行中，等它结束后再卸载' : '卸载' }, '卸载'))
    })

    const cardNode = (plugin) => {
      const isInstalled = isInstalledPlugin(plugin)
      const status = installStatus[plugin.id]
      const hue = categoryHue(plugin.category)
      // 卡片竖版（v3）：着色图标块 + 名称/作者 + 安装按钮一行，两行摘要，彩色分类 chip 一行。
      return h('div', { className: 'dsh-pm-card', key: plugin.id, onClick: () => setDetail(plugin) },
        h('div', { className: 'dsh-pm-card-top' },
          h('div', { className: `dsh-pm-card-icon ${hue}` }, icon(categoryIcon(plugin.category), 17)),
          h('div', { className: 'dsh-pm-card-who' },
            h('div', { className: 'dsh-pm-card-name' }, plugin.repo || plugin.name),
            h('div', { className: 'dsh-pm-card-by' },
              plugin.category === 'official'
                ? h('span', { className: 'dsh-pm-verified' }, icon('shield', 11), 'dsh 官方')
                : h('span', null, plugin.author || plugin.name))),
          isInstalled
            ? h('span', { className: 'dsh-pm-installed-tag' }, '✓ 已安装')
            : h('button', {
                className: 'dsh-pm-install',
                disabled: batchRunning || Boolean(status),
                onClick: (e) => { e.stopPropagation(); install(plugin) },
                title: batchRunning ? '批量更新进行中，等它结束再安装' : status === 'queued' ? '已加入安装队列' : status === 'installing' ? '正在安装' : undefined,
              }, status === 'queued' ? '排队中…' : status === 'installing' ? '安装中…' : '安装')),
        h('p', { className: 'dsh-pm-card-sum' }, descOf(plugin, true) || descOf(plugin) || '暂无描述'),
        h('div', { className: 'dsh-pm-card-meta' },
          h('span', { className: `dsh-pm-card-chip ${hue}` }, icon(categoryIcon(plugin.category), 10), categoryLabel(plugin.category)),
          h('span', null, `★ ${formatNumber(plugin.stars)}`),
          h('span', null, `↓ ${formatNumber(plugin.downloads)}`),
          plugin.version ? h('span', { className: 'dsh-pm-card-ver' }, `v${plugin.version}`) : null))
    }
    const marketCards = marketPlugins.map(cardNode)

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

    // ── 发现页：推荐位 + 双榜（右列）+ 分类筛选 + 卡片栅格 + sticky 手动安装行 ──
    // 推荐位从服务端的「下载最多前 5」里挑第一个未安装的；两榜直接用服务端榜单。
    const heroCandidates = marketFeatured.filter(p => p && !isInstalledPlugin(p) && !installStatus[p.id])
    const hero = heroCandidates[0] || marketFeatured[0] || null
    const topDownloads = marketTopDownloads
    const topStars = marketTopStars
    const rankRow = (plugin, rank) => {
      const isInstalled = isInstalledPlugin(plugin)
      const status = installStatus[plugin.id]
      return h('div', { className: 'dsh-pm-rank-row', key: plugin.id },
        h('span', { className: 'rk', 'aria-hidden': true }, String(rank)),
        h('div', { className: `dsh-pm-card-icon ${categoryHue(plugin.category)}`, style: { flex: 'none', width: '28px', height: '28px', borderRadius: '8px' } }, icon(categoryIcon(plugin.category), 14)),
        h('div', { className: 'who' },
          h('div', { className: 'nm' }, plugin.repo || plugin.name),
          h('div', { className: 'sub' }, `${categoryLabel(plugin.category)} · ↓ ${formatNumber(plugin.downloads)}/周 · ★ ${formatNumber(plugin.stars)}`)),
        isInstalled
          ? h('span', { className: 'dsh-pm-installed-tag' }, '✓ 已安装')
          : h('button', {
              className: 'dsh-pm-install',
              disabled: batchRunning || Boolean(status),
              onClick: (e) => { e.stopPropagation(); install(plugin) },
              title: status === 'queued' ? '已加入安装队列' : status === 'installing' ? '正在安装' : undefined,
            }, status === 'queued' ? '排队中…' : status === 'installing' ? '安装中…' : '安装'))
    }
    const rankCard = (title, sub, list, keyPrefix) => h('div', { className: 'dsh-pm-rank', key: keyPrefix },
      h('div', { className: 'dsh-pm-rank-head' }, h('h3', null, title), h('span', { className: 'sub' }, sub)),
      list.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '暂无数据') : list.map((p, i) => rankRow(p, i + 1)))
    const heroCard = hero
      ? h('div', { className: 'dsh-pm-hero' },
          h('div', { className: `dsh-pm-card-icon ${categoryHue(hero.category)}`, style: { flex: 'none', width: '52px', height: '52px', borderRadius: '14px' } }, icon(categoryIcon(hero.category), 26)),
          h('div', { className: 'who' },
            h('div', { className: 'dsh-pm-hero-tag' }, '今日推荐'),
            h('div', { className: 'dsh-pm-hero-name' }, hero.repo || hero.name,
              h('span', { className: 'dsh-pm-verified' }, icon('shield', 12), hero.category === 'official' ? 'dsh 官方' : 'dsh 社区')),
            h('p', { className: 'dsh-pm-hero-desc' }, descOf(hero, true) || descOf(hero) || '暂无描述'),
            h('div', { className: 'dsh-pm-hero-stats' },
              h('div', { className: 's' }, h('b', null, `${formatNumber(hero.downloads)}/周`), h('span', null, '上周下载')),
              h('div', { className: 's' }, h('b', null, formatNumber(hero.stars)), h('span', null, '星标')),
              h('div', { className: 's' }, h('b', null, categoryLabel(hero.category)), h('span', null, '类型')),
              hero.version ? h('div', { className: 's' }, h('b', null, `v${hero.version}`), h('span', null, '版本')) : null),
            h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' } },
              h('button', {
                className: 'dsh-pm-install',
                disabled: batchRunning || Boolean(installStatus[hero.id]),
                onClick: () => install(hero),
              }, installStatus[hero.id] === 'queued' ? '排队中…' : installStatus[hero.id] === 'installing' ? '安装中…' : '安装'),
              h('button', { className: 'dsh-pm-tool', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '15px', padding: '6px 16px' }, onClick: () => setDetail(hero) }, '详情'))))
      : null
    // 扁平栅格（分类视图 / 搜索结果）：服务端分页，当前页已全部渲染；还有更多时按钮续页。
    const discoverGrid = marketTotal === 0 ? h('div', { className: 'dsh-pm-empty' }, '暂无插件')
      : marketCards.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '没有匹配的插件')
      : h('div', null,
          h('div', { className: 'dsh-pm-grid' }, marketCards),
          h('div', { className: 'dsh-pm-pager' },
            marketPlugins.length < marketTotal
              ? h('button', { className: 'more', disabled: loadingMore, onClick: loadMoreMarket },
                  loadingMore ? '加载中…' : '显示更多', icon('chev', 12))
              : h('span', { className: 'meta' }, '已全部显示'),
            h('span', { className: 'meta' }, `已显示 ${marketPlugins.length} / ${marketTotal}`)))
    // 描述找插件：把自然语言描述交给服务端（关键词预筛 ≤40 条 → 模型挑 top5）。
    const runAiSearch = () => {
      const query = aiQuery.trim()
      if (!query || aiLoading) return
      setAiLoading(true)
      setAiResult(null)
      fetch('/dsh-plugin-manager/ai-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
        .then(r => r.json())
        .then(value => {
          if (value.error) throw Error(value.error)
          setAiResult(value)
        })
        .catch(error => setAiResult({ ok: false, error: String(error.message || error), items: [] }))
        .finally(() => setAiLoading(false))
    }
    const aiRow = (item, index) => {
      const isInstalled = isInstalledPlugin(item)
      return h('div', { className: 'dsh-pm-ai-row', key: item.id },
        h('span', { className: 'rk', 'aria-hidden': true }, String(index + 1)),
        h('div', { className: `dsh-pm-card-icon ${categoryHue(item.category)}`, style: { flex: 'none', width: '32px', height: '32px', borderRadius: '9px' } }, icon(categoryIcon(item.category), 16)),
        h('div', { className: 'who' },
          h('div', { className: 'nm' }, item.repo || item.name),
          item.reason ? h('div', { className: 'why' }, item.reason) : h('div', { className: 'why' }, item.description || '')),
        h('div', { className: 'meta' },
          h('span', null, `↓ ${formatNumber(item.downloads)}/周`),
          h('span', null, `★ ${formatNumber(item.stars)}`),
          item.version ? h('span', null, `v${item.version}`) : null),
        isInstalled
          ? h('span', { className: 'dsh-pm-installed-tag' }, '✓ 已安装')
          : h('button', { className: 'dsh-pm-install', onClick: () => install({ ...item, category: item.category }) }, '安装'))
    }
    const aiPanel = (aiLoading || aiResult)
      ? h('div', { className: 'dsh-pm-ai' },
          h('div', { className: 'dsh-pm-ai-head' },
            h('h3', null, '描述检索'),
            h('span', { className: 'meta' },
              aiLoading ? '正在检索…'
                : aiResult && aiResult.ok
                  ? `${aiResult.items.length} 个结果 · 从 ${aiResult.candidates} 个候选中选出${aiResult.fallback ? ' · 关键词降级' : ''}`
                  : ''),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'dsh-pm-tool', onClick: () => { setAiResult(null); setAiQuery('') }, 'aria-label': '关闭描述检索结果' }, icon('x', 13))),
          aiResult && aiResult.error ? h('div', { className: 'dsh-pm-ai-note bad' }, aiResult.error) : null,
          aiResult && aiResult.note ? h('div', { className: 'dsh-pm-ai-note' }, aiResult.note) : null,
          aiResult && aiResult.items && aiResult.items.length > 0
            ? h('div', { className: 'dsh-pm-ai-list' }, aiResult.items.map(aiRow))
            : null)
      : null
    const aiSearchBar = h('form', {
      className: 'dsh-pm-ai-bar',
      onSubmit: (event) => { event.preventDefault(); runAiSearch() },
    },
      h('span', { className: 'spark' }, icon('sparkle', 16)),
      h('span', { className: 'dsh-pm-ai-badge' }, 'AI 搜索'),
      h('input', {
        className: 'inp', value: aiQuery, onChange: (event) => setAiQuery(event.target.value),
        placeholder: '描述你想要的插件，例如「把会话导出成 Markdown」',
        'aria-label': '描述你想要的插件',
      }),
      h('button', { type: 'submit', className: 'dsh-pm-ai-go', disabled: aiLoading || !aiQuery.trim() }, aiLoading ? '检索中…' : '找插件'))

    // sticky 手动安装行：npm 包名 / GitHub 仓库 / 本地文件夹（走现有 install 接口）。
    const manualRow = h('form', {
      className: 'dsh-pm-queue', style: { marginTop: '2px' },
      onSubmit: (e) => {
        e.preventDefault()
        const spec = manualSpec.trim()
        if (!spec || busy !== '' || batchRunning) return
        install({ id: 'manual:' + spec, url: spec, name: spec, repo: spec, category: 'other' })
        setManualSpec('')
      },
    },
      h('span', { className: 'dsh-pm-footnote', style: { flex: 'none' } }, '已有想装的？'),
      h('input', {
        className: 'dsh-pm-srcadd-inp', value: manualSpec,
        onChange: e => setManualSpec(e.target.value),
        placeholder: 'npm 包名、GitHub 仓库（github:owner/repo）或本地文件夹',
        style: { flex: 1, minWidth: '160px', height: '28px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'ui-monospace,SFMono-Regular,monospace 12px', padding: '0 10px', outline: 'none' },
        'aria-label': '手动安装插件',
      }),
      h('button', { type: 'submit', className: 'dsh-pm-install', disabled: busy !== '' || batchRunning }, '安装'))

    // ── 发现页（v3）：本周推荐整行 → 双榜两列 → 分类条 → 分类分区 / 分类视图 ──
    const searchTerm = search.trim()
    const isCategoryView = category !== 'all'
    const marketSections = Array.isArray(market?.sections) ? market.sections : []

    const categorySeg = (name, label, count, active) => h('button', {
      key: 'seg-' + name,
      className: `dsh-pm-seg${active ? ' on' : ''}`,
      onClick: () => setCategory(active ? 'all' : name),
      // 选中的分类若在折叠区里，先展开折叠区让选中态可见。
      onMouseDown: () => { if (!active && tailCategories.includes(name)) setCatExpanded(true) },
      title: active ? '再点一次回到全部' : `只看「${label}」`,
    }, label, count != null ? h('span', { className: 'n' }, String(count)) : null)

    const categoryBar = h('div', { className: 'dsh-pm-catbar' },
      h('div', { className: 'dsh-pm-segs' },
        categorySeg('all', '全部', market && market.allTotal ? market.allTotal : marketTotal, category === 'all'),
        pinnedCategories.map(name => categorySeg(name, groupLabel(name), categoryCounts.get(name) || 0, category === name)),
        tailCategories.length > 0
          ? h('button', {
              key: 'seg-more',
              className: `dsh-pm-seg more${catExpanded ? ' expanded' : ''}`,
              onClick: () => setCatExpanded(value => !value),
              'aria-expanded': catExpanded ? 'true' : 'false',
              title: catExpanded ? '收起分类' : `还有 ${tailCategories.length} 个分类`,
            }, catExpanded ? '收起分类' : `全部 ${orderedCategories.length} 类`, icon('chev', 11))
          : null),
      catExpanded ? h('div', { className: 'dsh-pm-segs dsh-pm-segs-open' },
        tailCategories.map(name => categorySeg(name, groupLabel(name), categoryCounts.get(name) || 0, category === name))) : null,
      h('span', { className: 'dsh-pm-catbar-sp' }),
      h('select', { className: 'dsh-pm-select', value: source, onChange: (e) => setSource(e.target.value), title: '按插件来源过滤', 'aria-label': '按来源过滤' },
        h('option', { value: 'all' }, '来源：全部'),
        h('option', { value: 'official' }, '来源：官方'),
        h('option', { value: 'community' }, '来源：社区'),
        (Array.isArray(sources) ? sources : []).filter(item => !item.builtin).map(item => h('option', { key: item.id, value: item.id }, '来源：' + item.url))),
      h('select', { className: 'dsh-pm-select', value: sort, onChange: (e) => setSort(e.target.value), title: '排序', 'aria-label': '排序' },
        h('option', { value: 'stars' }, '排序：星标'),
        h('option', { value: 'downloads' }, '排序：下载量'),
        h('option', { value: 'newest' }, '排序：最新')))

    // 分类分区：每区 6 张（三列两整行），分区头/尾各一个「查看全部 N 个」。
    const sectionView = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
      marketSections.map(section => {
        const id = section.group || section.category
        const label = section.label || groupLabel(id)
        return h('div', { className: 'dsh-pm-sec2', key: 'sec-' + id },
          h('div', { className: 'dsh-pm-sechead2' },
            h('h3', null, label),
            h('span', { className: 'n' }, `${section.count} 个插件`),
            h('span', { className: 'viewall', role: 'button', tabIndex: 0, onClick: () => setCategory(id) },
              `查看全部 ${section.count} 个`, icon('chev', 12))),
          h('div', { className: 'dsh-pm-grid' }, section.plugins.map(cardNode)),
          h('div', { className: 'dsh-pm-morelink' },
            h('button', { onClick: () => setCategory(id) },
              `查看全部 ${section.count} 个${label}插件`, icon('chev', 12))))
      }))

    // 分类视图：面包屑返回 + 该分类全量列表（服务端分页）+ 分类条保留。
    const categoryView = h('div', null,
      h('div', { className: 'dsh-pm-crumbs' },
        h('button', { className: 'dsh-pm-crumbs-back', onClick: () => setCategory('all') }, icon('back', 12), '返回发现'),
        h('span', { className: 'sep' }, '/'),
        h('span', null, groupLabel(category))),
      h('div', { className: 'dsh-pm-mainhead' },
        h('h2', null, groupLabel(category)),
        h('span', { className: 'date' }, `${marketTotal} 个插件`),
        h('span', { style: { flex: 1 } }),
        refreshing ? h('span', { className: 'dsh-pm-footnote' }, '刷新中…') : null,
        h('button', { className: 'dsh-pm-tool', disabled: refreshing, onClick: refreshMarket, title: '重新拉取全部插件源的索引' }, icon('refresh', 13)),
        h('label', { className: 'dsh-pm-find' }, icon('search', 13),
          h('input', { placeholder: `在「${groupLabel(category)}」里搜索…`, value: search, onChange: (e) => setSearch(e.target.value), 'aria-label': '在当前分类里搜索' }))),
      categoryBar,
      discoverGrid,
      manualRow)

    // 发现页首屏：推荐位 + 双榜 + 分类条 + 分区（搜索时退化成扁平结果）。
    const discoverAllView = h('div', null,
      h('div', { className: 'dsh-pm-mainhead' },
        h('h2', null, '本周推荐'), h('span', { className: 'date' }, '每周日更新推荐位'),
        h('span', { style: { flex: 1 } }),
        refreshing ? h('span', { className: 'dsh-pm-footnote' }, '刷新中…') : null,
        h('button', { className: 'dsh-pm-tool', disabled: refreshing, onClick: refreshMarket, title: '重新拉取全部插件源的索引' }, icon('refresh', 13)),
        h('label', { className: 'dsh-pm-find' }, icon('search', 13),
          h('input', { placeholder: '搜索插件和作者…', value: search, onChange: (e) => setSearch(e.target.value), 'aria-label': '搜索插件' }))),
      aiSearchBar,
      aiPanel,
      heroCard,
      h('div', { className: 'dsh-pm-cols2' },
        rankCard('下载最多', 'npm 上周', marketTopDownloads, 'dl'),
        rankCard('星标最多', 'GitHub 上', marketTopStars, 'st')),
      categoryBar,
      searchTerm ? discoverGrid : (marketSections.length > 0 ? sectionView : discoverGrid),
      manualRow)

    const discoverTab = h('div', null,
      market === null ? h('div', { className: 'dsh-pm-empty' }, '加载中…') :
      market === false ? h('div', { className: 'dsh-pm-empty' },
        h('div', null, '市场索引还没有下载'),
        h('button', { className: 'dsh-pm-install', style: { marginTop: '8px' }, disabled: refreshing, onClick: refreshMarket }, refreshing ? '同步中…' : '立即同步')) :
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, queueStrip, isCategoryView ? categoryView : discoverAllView))

    // ── 内置页：开关列表（无可搜索/联网需求）。 ──
    const builtinItems = installed.filter(item => item.source === 'bundled' && !item.broken)
    const builtinTab = h('div', null,
      h('p', { className: 'dsh-pm-featsay' }, '随启动器分发的内置插件。关掉一个，它的侧栏入口与页面就离开 dsh；dsh 本身不受影响。'),
      builtinItems.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '没有内置插件') : h('div', { className: 'dsh-pm-list' },
        builtinItems.map(item => {
          const disableInfo = disabledPlugins[item.name] || null
          const pluginOn = Boolean(disableInfo && disableInfo.disabled === false)
          const switchDisabled = !disableInfo || !disableInfo.canDisable || busy === 'disable-' + item.name || busyOther || batchRunning
          const switchTitle = !disableInfo ? '停用状态读取失败，重新打开面板再试'
            : !disableInfo.canDisable ? (disableInfo.reason || '这个插件不支持停用')
            : pluginOn ? '停用这个插件（重启 dsh 后生效）' : '启用这个插件（重启 dsh 后生效）'
          const switchText = busy === 'disable-' + item.name ? '切换中…' : !disableInfo ? '状态未知' : pluginOn ? '已启用' : '已停用'
          return h('div', { className: `dsh-pm-row${pluginOn === false && disableInfo ? ' dsh-pm-row-off' : ''}`, key: item.name },
            h('div', { className: 'dsh-pm-card-icon' }, icon('puzzle', 16)),
            h('div', { className: 'dsh-pm-row-main' },
              h('div', { className: 'dsh-pm-row-title' }, item.name),
              h('div', { className: 'dsh-pm-row-meta' }, item.description || '内置插件')),
            h('span', { className: 'dsh-pm-badge' }, '内置'),
            disableInfo && !disableInfo.canDisable ? null
              : h('label', { className: 'dsh-pm-switch', title: switchTitle },
                  h('input', {
                    type: 'checkbox', role: 'switch', className: 'dsh-pm-switch-input',
                    checked: pluginOn, disabled: switchDisabled, title: switchTitle,
                    'aria-label': (pluginOn ? '停用 ' : '启用 ') + item.name,
                    onChange: () => togglePluginDisabled(item, pluginOn),
                  }),
                  h('span', { className: 'dsh-pm-switch-track', 'aria-hidden': true }),
                  h('span', { className: 'dsh-pm-switch-text' }, switchText)))
        })))

    // ── 插件源页：预设源一键加入 + 自定义 git/index 源 + 每源开关/删除。 ──
    const [sourceInput, setSourceInput] = React.useState('')
    const sourcesTab = h('div', null,
      h('div', { className: 'dsh-pm-mainhead' },
        h('h2', null, '插件源'),
        h('span', { className: 'date' }, sources ? `${sources.length} 个源` : ''),
        h('span', { style: { flex: 1 } }),
        h('button', { className: 'dsh-pm-tool', disabled: refreshing, onClick: refreshMarket, title: '重新拉取全部插件源的索引' }, icon('refresh', 13), '全部同步')),
      h('p', { className: 'dsh-pm-footnote' }, '源是一个含 index.json 的插件索引仓库（github:owner/repo）或直接的索引 JSON 地址。关闭一个源不会卸载已安装的插件。'),
      sources === null ? h('div', { className: 'dsh-pm-empty' }, '加载中…') :
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        sources.map(source => h('div', { className: 'dsh-pm-srcrow', key: source.id },
          h('div', { className: 'dsh-pm-card-icon' }, icon(source.builtin ? 'shield' : 'server', 16)),
          h('div', { className: 'who' },
            h('div', { className: 'nm' },
              source.builtin ? 'awesome-dsh 社区清单（内置默认源）' : source.url,
              source.builtin ? h('span', { className: 'dsh-pm-badge' }, '内置') : null,
              source.enabled === false ? h('span', { className: 'dsh-pm-badge' }, '已停用') : null),
            h('div', { className: 'spec' }, source.url),
            h('div', { className: 'meta' }, source.cache && source.cache.state !== 'disabled' && source.cache.state !== 'empty'
              ? `${source.cache.count} 个插件 · ${source.cache.state === 'stale' ? '索引已过期' : '已同步'}` : '尚未同步')),
          h('label', { className: 'dsh-pm-switch', title: source.enabled === false ? '启用这个源' : '停用这个源（已装插件不受影响）' },
            h('input', {
              type: 'checkbox', role: 'switch', className: 'dsh-pm-switch-input',
              checked: source.enabled !== false,
              disabled: busy === 'source-toggle-' + source.id,
              'aria-label': (source.enabled === false ? '启用源 ' : '停用源 ') + source.url,
              onChange: () => toggleSource(source),
            }),
            h('span', { className: 'dsh-pm-switch-track', 'aria-hidden': true })),
          source.builtin ? null
            : h('button', { className: 'dsh-pm-row-action', disabled: busy === 'source-remove', 'aria-label': '删除源 ' + source.url, title: '删除这个源' , onClick: () => removeSource(source.id) }, icon('x', 13)))),
        h('div', { className: 'dsh-pm-srcadd' },
          h('input', {
            className: 'inp', value: sourceInput,
            onChange: e => setSourceInput(e.target.value),
            placeholder: 'github:owner/repo 或 https://…/index.json',
            'aria-label': '插件源地址',
          }),
          h('button', {
            className: 'dsh-pm-install', disabled: busy === 'source-add' || !sourceInput.trim(),
            onClick: () => {
              const value = sourceInput.trim()
              const kind = /^https?:\/\//i.test(value) ? 'index' : 'git'
              addSource(kind, value)
              setSourceInput('')
            },
          }, icon('plus', 13), '添加源')),
        h('div', { className: 'dsh-pm-footnote' }, '添加 git 源后会拉取仓库根目录的 index.json；添加 index 源则直接拉取该地址。')))

    // 更新工具栏：接口不可用（updates === false）时整条不渲染，静默降级成原来的已安装页。

    // 更新工具栏：接口不可用（updates === false）时整条不渲染，静默降级成原来的已安装页。
    const clock = formatCheckedClock(updates && updates.checkedAt)
    const checking = busy === 'check-updates'
    const selectedUpdatable = selectedUpdatableNames(updates, selected)
    const selectedIgnorable = ignorableEntries(updates, selected)
    // 检测/批量更新/忽略都在后台跑，面板要能关掉（批量更新可能几分钟）；
    // 安装/卸载仍锁住。忽略只是写一次本地记录，不该把「关闭」也锁上。
    // 市场刷新是后台任务（见 refreshMarket），根本不进 busy，所以不会锁关闭；
    // 此前它占 busy 时 × / 返回 / 点背景会静默失效（用户实测点关闭关不上）。
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
    // 更新队列状态条：与批量条同一形态；正在更新谁 + 还剩几个排队。
    const updateNowIndex = updateTotalRef.current - updateQueueView.length + 1
    const updateQueueStrip = updateQueueView.length > 0
      ? h('div', { className: 'dsh-pm-queue', role: 'status' },
          h('span', { className: 'dsh-pm-queue-dot', 'aria-hidden': true }, '◌'),
          h('span', { className: 'dsh-pm-queue-text' },
            h('strong', null, `正在更新 ${updateNowIndex}/${updateTotalRef.current}`),
            ` · ${updateQueueView[0].item.name}`,
            updateQueueView.length > 1 ? `，还有 ${updateQueueView.length - 1} 个排队` : ''))
      : null
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

    // ── 方案 B 外壳：顶部工具行（国内加速 + 关闭）+ 左栏四项 + 内容区。 ──
    const builtinCount = installed.filter(item => item.source === 'bundled' && !item.broken).length
    const updatableCount = updatesAvailableCount(updates)
    const railItems = [
      { id: 'discover', label: '发现', iconName: 'compass' },
      { id: 'builtin', label: '内置', iconName: 'cube', count: builtinCount || null },
      { id: 'installed', label: '已安装', iconName: 'download', count: installed.length || null },
      { id: 'sources', label: '插件源', iconName: 'server', count: Array.isArray(sources) ? sources.length : null },
    ]
    const viewBody = tab === 'installed' ? h('div', null,
        updatesBar,
        updateQueueStrip,
        batchStrip,
        installed.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '还没有已安装的插件，去「发现」看看吧')
          : h('div', null,
              h('div', { className: 'dsh-pm-bulkbar' },
                h('button', { className: 'dsh-pm-tool', onClick: toggleSelectAll }, manageable.length > 0 && selectedNames.length === manageable.length ? '取消全选' : '全选'),
                h('button', { className: 'dsh-pm-tool', onClick: toggleInvert }, '反选'),
                h('button', { className: 'dsh-pm-tool', disabled: selectedNames.length === 0 || busy === 'uninstall-many' || batchRunning || busyOther, onClick: () => setConfirmBatch(true), style: selectedNames.length > 0 ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined }, `批量卸载${selectedNames.length ? ` (${selectedNames.length})` : ''}`)),
              // 拖拽框选：在这块区域按下并拖动，实时把相交的行选上。
              h('div', { className: 'dsh-pm-selectarea', ref: listAreaRef, onMouseDown: startBand },
                h('div', { className: 'dsh-pm-list' }, installedRows),
                band ? h('div', { className: 'dsh-pm-band', style: { height: `${band.height}px`, left: `${band.left}px`, top: `${band.top}px`, width: `${band.width}px` } }) : null)))
      : tab === 'discover' ? discoverTab
      : tab === 'builtin' ? builtinTab
      : sourcesTab

    return h('div', null,
      h('div', { className: 'dsh-pm-backdrop', onClick: () => { if (closable) { onClose() } } }),
      h('div', { className: 'dsh-pm-page' + (fullscreen ? ' dsh-pm-full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件管理' },
        h(Toasts, { store: toastStore }),
        h('div', { className: 'dsh-pm-header' },
          h('button', { className: 'dsh-pm-back', onClick: () => { if (closable) onClose() }, 'aria-label': '返回' }, '← 返回'),
          h('strong', null, '插件中心'),
          h('div', { className: 'dsh-pm-header-spacer' }),
          h('button', {
            className: 'dsh-pm-tool', onClick: toggleFullscreen,
            'aria-label': fullscreen ? '退出全屏' : '全屏显示',
            title: fullscreen ? '退出全屏' : '全屏显示（铺满窗口）',
          }, icon(fullscreen ? 'collapse' : 'expand', 14)),
          // 国内加速开关（magpie pm-mirror 式）：插件不存在时整枚隐藏。
          mirror && mirror.pluginPresent
            ? h('button', {
                className: `dsh-pm-mirror${mirror.enabled ? ' on' : ''}`,
                role: 'switch', 'aria-checked': mirror.enabled ? 'true' : 'false',
                disabled: mirrorSaving, onClick: toggleMirror,
                title: '开启后 npm registry、GitHub raw 与 git clone 走国内镜像，立即生效',
                'aria-label': '国内加速',
              }, '国内加速', h('span', { className: 'track', 'aria-hidden': true }))
            : null,
          h('button', { className: 'dsh-pm-tool dsh-pm-close', onClick: () => { if (closable) onClose() }, 'aria-label': '关闭' }, '×')),
        error && tab !== 'installed' && tab !== 'discover' ? h('div', { className: 'dsh-pm-error', style: { margin: '10px 18px 0' } }, error) : null,
        h('div', { className: 'dsh-pm-frame' },
          h('nav', { className: 'dsh-pm-rail', 'aria-label': '插件中心导航' },
            h('div', { className: 'dsh-pm-rail-title' }, '插件中心'),
            railItems.map(item => h('button', {
              key: item.id,
              className: `dsh-pm-rail-item${tab === item.id ? ' on' : ''}`,
              onClick: () => setTab(item.id),
              'aria-current': tab === item.id ? 'page' : undefined,
            }, icon(item.iconName, 15), item.label, item.count ? h('span', { className: 'n' }, String(item.count)) : null)),
            updatableCount > 0
              ? h('button', { className: 'dsh-pm-rail-item dsh-pm-rail-updates', onClick: () => setTab('installed') },
                  icon('download', 15), `${updatableCount} 个可更新`)
              : null),
          h('div', { className: 'dsh-pm-main' },
            error && (tab === 'installed' || tab === 'discover') ? h('div', { className: 'dsh-pm-error' }, error) : null,
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
              h('div', { className: 'dsh-pm-confirm-title' }, restartPrompt.title),
              h('div', { className: 'dsh-pm-confirm-copy' }, restartPrompt.copy),
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
            viewBody)),
        drawer,
        notesModal))
  }

  // 插件管理面板常驻挂载在 body 上，由「更多」菜单打开；侧边栏 footer
  // 不再为它留一行（三个入口并列时 footer 太挤）。
  const OPEN_EVENT = 'dsh-plugin-manager:open'

  function mountPanel(ctx) {
    ensureStyles()
    if (document.getElementById(NS + '-root')) return null
    const host = document.createElement('div')
    host.id = NS + '-root'
    document.body.appendChild(host)

    let setOpenRef = null
    const store = createUpdatesStore()

    function Root() {
      const [open, setOpen] = React.useState(false)
      setOpenRef = setOpen
      React.useEffect(() => {
        const onOpen = () => setOpen(true)
        window.addEventListener(OPEN_EVENT, onOpen)
        return () => window.removeEventListener(OPEN_EVENT, onOpen)
      }, [])
      if (!open) return null
      return h(PluginManagerPage, {
        wide: true,
        t: (key, vars) => (vars && vars.name ? key + ' ' + vars.name : key),
        onClose: () => setOpen(false),
        store,
      })
    }

    let ReactDOM = null
    try { ReactDOM = require('react-dom/client') } catch { /* older host */ }
    if (ReactDOM && typeof ReactDOM.createRoot === 'function') {
      ReactDOM.createRoot(host).render(h(Root))
    } else {
      require('react-dom').render(h(Root), host)
    }
    return () => { if (setOpenRef) setOpenRef(true) }
  }


  function apply(ctx) {
    ensureStyles()
    const openPanel = mountPanel(ctx)

    // 侧栏图标只负责“选中面板”；真正的页面必须注册到 main slot。
    // 旧版 DSH 的 sidebar.panellist 会直接用组件渲染页面，新版只渲染图标，
    // 不注册 main 时点击图标会 silent no-op（本次用户报的“点不开”）。
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: NS, locale: NS,
    }, function PluginManagerMain() {
      return h(PluginManagerPage, {
        wide: true,
        t: (k, v) => (v && v.name ? k + ' ' + v.name : k),
        onClose: () => ctx.layout.selectPanel(null),
      })
    }))

    // Registered in dsh's own sidebar panel list, so the entry shows up in
    // the sidebar and in dsh's "更多" menu — no extra footer row, which is
    // what was squeezing the workspace list.
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: NS, order: 100, label: '插件管理',
    }, function PluginManagerEntry() {
      return h('span', { className: 'dsh-pm-trigger-icon', 'aria-hidden': true })
    }))
  }

  // createToastStore / createUpdatesStore 与更新检测的纯函数仅为单测导出（vm 加载后可取用），
  // 宿主只消费 inject/apply。
  return {
    inject: ['slots', 'locale', 'layout'],
    apply,
    // 渲染冒烟需要直接挂载侧边栏入口（角标/打开面板的行为只在这个组件里）；
    // 宿主只消费 inject/apply，导出不改变运行时契约。
    PluginTrigger,
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
