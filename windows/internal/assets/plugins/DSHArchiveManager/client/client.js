window.__ModuleLoader__.load({ id: "dsh-archive-manager", factory: (require) => {
  const React = require('react')
  const h = React.createElement
  const NS = 'dsh-archive-manager'
  /* 视觉语言与插件中心（方案 B）一致：页头（标题 + 数量 + 搜索）→ 工具栏
     （全选 / 已选计数 / 还原选中 / 删除选中）→ 单容器行列表（复选框 + 图标块 +
     标题 + 元信息 + 右侧「还原」胶囊 / 危险文字按钮）→ 就地删除确认 → 空态。
     颜色全部走宿主语义 token，深浅主题跟随 dsh。侧栏触发按钮的排版规则保持
     原样（宿主把该 slot 渲染成一行 nowrap，两个占位者会互相挤出侧栏）。 */
  const css = `div:has(> [data-slot='sidebar.footer.action']){flex-wrap:wrap}.dsh-archive-trigger{align-items:center;appearance:none;background:transparent;border:0;border-radius:8px;box-sizing:border-box;color:inherit;cursor:pointer;display:flex;flex:0 0 100%;font:inherit;font-size:14px;gap:8px;line-height:22px;margin:4px -2px;min-height:42px;min-width:0;padding:0 10px 0 8px;text-align:left}.dsh-archive-trigger:hover{background:var(--dsw-alias-button-ghost-active-fill)}.dsh-archive-trigger.dsh-archive-trigger-rail{border-radius:50%;corner-shape:round;flex:none;height:36px;justify-content:center;margin:4px 0;min-height:36px;padding:0;width:36px}.dsh-archive-trigger.dsh-archive-trigger-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}.dsh-archive-trigger-icon{border:1.75px solid currentColor;border-radius:4px;box-sizing:border-box;display:inline-block;flex:0 0 16px;height:16px;position:relative;width:16px}.dsh-archive-trigger-icon:before{border-top:1.75px solid currentColor;content:"";left:2px;position:absolute;right:2px;top:5px}.dsh-archive-trigger-icon:after{border:1.75px solid currentColor;border-bottom:0;border-radius:3px 3px 0 0;box-sizing:border-box;content:"";height:4px;left:3px;position:absolute;top:-5px;width:7px}
/* 弹层（main slot 里以居中面板呈现，与插件中心同一形态） */
.dsh-archive-backdrop{background:rgba(15,18,24,.32);inset:0;position:fixed;z-index:2147483000}
.dsh-archive-modal{--pm-accent:#3b82f6;--pm-accent-fg:#ffffff;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 20px 70px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;font-size:13px;gap:12px;left:50%;max-height:82vh;max-width:720px;overflow:auto;padding:16px 18px 18px;position:fixed;top:50%;transform:translate(-50%,-50%);width:min(720px,calc(100vw - 32px));z-index:2147483001}
.dsh-archive-close{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px;height:28px;line-height:24px;width:28px}
.dsh-archive-close:hover{background:var(--dsw-alias-button-ghost-active-fill);color:inherit}
/* 页头 */
.dsh-archive-head{align-items:center;display:flex;flex-wrap:wrap;gap:12px;padding:0}
.dsh-archive-head h2{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:700;letter-spacing:-.01em;margin:0}
.dsh-archive-count{color:var(--dsw-alias-label-tertiary);font-size:11.5px}
.dsh-archive-find{align-items:center;background:var(--dsw-alias-bg-layer-2);border-radius:8px;color:var(--dsw-alias-label-tertiary);display:flex;gap:6px;height:30px;margin-left:auto;padding:0 10px;width:min(240px,46%);transition:box-shadow .14s ease,background .14s ease}
.dsh-archive-find:focus-within{background:var(--dsw-alias-bg-layer-1);box-shadow:inset 0 0 0 1px var(--pm-accent),0 0 0 3px color-mix(in srgb,var(--pm-accent) 18%,transparent)}
.dsh-archive-find input{background:none;border:0;color:var(--dsw-alias-label-primary);flex:1;font:inherit;font-size:12.5px;min-width:0;outline:none}
.dsh-archive-find input::placeholder{color:var(--dsw-alias-label-tertiary)}
/* 工具栏 */
.dsh-archive-toolbar{align-items:center;display:flex;flex-wrap:wrap;gap:8px;min-height:28px;padding:0 2px}
.dsh-archive-select-all{align-items:center;color:var(--dsw-alias-label-secondary);display:inline-flex;flex:0 0 auto;font-size:12.5px;gap:8px;line-height:20px}
.dsh-archive-select-all input{accent-color:var(--pm-accent);flex:0 0 auto;height:15px;margin:0;width:15px}
.dsh-archive-toolbar-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-right:auto}
.dsh-archive-tool{background:none;border:0;border-radius:7px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px;line-height:20px;padding:4px 9px}
.dsh-archive-tool:hover:not(:disabled){background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}
.dsh-archive-tool:disabled{cursor:not-allowed;opacity:.5}
.dsh-archive-tool-danger{color:var(--dsw-alias-state-error-primary)}
.dsh-archive-tool-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
/* 「还原选中」：与安装/还原胶囊同一份强调色 */
.dsh-archive-tool-primary{background:color-mix(in srgb,var(--pm-accent) 12%,transparent);border-radius:14px;color:var(--pm-accent);font-weight:600;padding:4px 12px}
.dsh-archive-tool-primary:hover:not(:disabled){background:var(--pm-accent);color:var(--dsw-alias-label-primary-foreground)}
/* 行列表：单容器 + 发丝分隔（与插件中心的行列表同构） */
.dsh-archive-list{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dsh-archive-row{align-items:center;display:flex;gap:11px;min-height:54px;padding:8px 13px;transition:background .14s ease}
.dsh-archive-row:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-archive-row + .dsh-archive-row{border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-archive-row input[type=checkbox]{accent-color:var(--pm-accent);flex:0 0 auto;height:15px;margin:0;width:15px}
.dsh-archive-icon{align-items:center;background:color-mix(in srgb,var(--pm-accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--pm-accent) 32%,transparent);border-radius:9px;box-sizing:border-box;color:var(--pm-accent);display:flex;flex:0 0 32px;height:32px;justify-content:center;width:32px}
.dsh-archive-row-main{flex:1;min-width:0}
.dsh-archive-row-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:550;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-archive-meta{align-items:center;color:var(--dsw-alias-label-tertiary);display:flex;flex-wrap:wrap;font-size:11.5px;gap:2px 7px;line-height:18px;margin-top:2px;min-width:0}
.dsh-archive-meta .sep{color:var(--dsw-alias-label-tertiary);opacity:.6}
/* 「还原」：强调胶囊（与插件安装按钮同一份样式语言） */
.dsh-archive-row-restore{background:color-mix(in srgb,var(--pm-accent) 12%,transparent);border:0;border-radius:13px;color:var(--pm-accent);cursor:pointer;flex:none;font:inherit;font-size:12px;font-weight:600;height:26px;line-height:26px;padding:0 12px;white-space:nowrap}
.dsh-archive-row-restore:hover:not(:disabled){background:var(--pm-accent);color:var(--dsw-alias-label-primary-foreground)}
.dsh-archive-row-restore:disabled{cursor:not-allowed;opacity:.55}
.dsh-archive-row-delete{background:none;border:0;border-radius:7px;color:var(--dsw-alias-state-error-primary);cursor:pointer;flex:none;font:inherit;font-size:12px;line-height:20px;padding:4px 9px;white-space:nowrap}
.dsh-archive-row-delete:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.dsh-archive-row-delete:disabled{cursor:not-allowed;opacity:.5}
/* 空态：虚线图标盒 + 主句 + 说明（与插件中心空态同构） */
.dsh-archive-empty{align-items:center;color:var(--dsw-alias-label-tertiary);display:flex;flex-direction:column;gap:8px;padding:44px 16px;text-align:center}
.dsh-archive-empty .ico{align-items:center;border:1px dashed var(--dsw-alias-border-l3);border-radius:12px;color:var(--dsw-alias-label-tertiary);display:flex;height:44px;justify-content:center;width:44px}
.dsh-archive-empty b{color:var(--dsw-alias-label-primary);font-size:13.5px;font-weight:600;margin-top:4px}
.dsh-archive-empty p{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5;margin:0 0 6px;max-width:320px}
.dsh-archive-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);border-radius:8px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;padding:8px 10px}
/* 就地删除确认 */
.dsh-archive-confirm{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:14px}
.dsh-archive-confirm-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dsh-archive-confirm-copy{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:6px}
.dsh-archive-confirm-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.dsh-archive-confirm-actions button{border:0;border-radius:7px;cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:5px 14px}
.dsh-archive-confirm-cancel{background:var(--dsw-alias-button-ghost-fill);color:var(--dsw-alias-label-primary)}
.dsh-archive-confirm-delete{background:var(--dsw-alias-state-error-primary);color:#fff}
.dsh-archive-confirm-actions button:disabled{cursor:not-allowed;opacity:.5}`

  function ensureStyles() {
    if (document.getElementById(NS + '-style')) return
    const style = document.createElement('style')
    style.id = NS + '-style'
    style.textContent = css
    document.head.appendChild(style)
  }

  /* 线性 SVG 图标（16 网格 / 1.5 描边 / currentColor）：与插件中心同一套画法，
     不用 emoji（跨平台字形不一致，也和宿主设计语言不搭）。 */
  // Tabler 线性图标（MIT 许可，https://tabler.io/icons）：24 网格 / 2 描边，
  // 与插件管理同一套体系；每个图标都做了光学归一（内容包围盒统一缩放并居中）。
  const ICON_PATHS = {
    search: "<g transform=\"translate(-2.333 -2.333) scale(1.1944)\" stroke-width=\"1.674\"><path d=\"M0 0h24v24H0z\" fill=\"none\" stroke=\"none\"/><path d=\"M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\"/><path d=\"M21 21l-6 -6\"/></g>",
    archive: "<g transform=\"translate(-2.333 -2.333) scale(1.1944)\" stroke-width=\"1.674\"><path d=\"M0 0h24v24H0z\" fill=\"none\" stroke=\"none\"/><path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2\"/><path d=\"M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-10\"/><path d=\"M10 12l4 0\"/></g>",
    restore: "<g transform=\"translate(-4.187 -4.192) scale(1.3471)\" stroke-width=\"1.485\"><path d=\"M0 0h24v24H0z\" fill=\"none\" stroke=\"none\"/><path d=\"M4.05 11a8 8 0 1 1 .5 4m-.5 5v-5h5\"/></g>",
  }




  function icon(name, size = 14) {
    // 图标名都是本文件里的字面量（archive / search），不设兜底：名字写错
    // 会立刻渲染成空图标，一眼能看出问题。原来的 `|| ICON_PATHS.archive`
    // 永远走不到，却会把拼写错误悄悄变成「显示成 archive 图标」。
    const path = ICON_PATHS[name]
    const nodes = []
    // 图标数据形如 <g transform="…" stroke-width="…">…形状…</g>（光学归一）；属性名转 React camelCase
    const SVG_ATTR = { 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin' }
    const groupRe = /^(?:<g\s([^>]*)>)?([\s\S]*?)(?:<\/g>)?$/
    const tokenRe = /<(path|rect|circle|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/g
    const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
    const group = String(path).match(groupRe)
    const groupAttrs = {}
    let ga
    while ((ga = attrRe.exec(group[1]))) groupAttrs[SVG_ATTR[ga[1]] || ga[1]] = ga[2]
    let m
    const shapes = []
    while ((m = tokenRe.exec(group[2]))) {
      const attrs = {}
      let a
      while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2]
      shapes.push(h(m[1], { key: shapes.length, ...attrs }))
    }
    nodes.push(h('g', { key: 'g', ...groupAttrs }, ...shapes))
    return h('span', { className: 'dsh-archive-ic', 'aria-hidden': true, style: { display: 'inline-flex', flex: 'none' } },
      h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, ...nodes))
  }

  function ArchivePanel({ wide, autoOpen = false, onClose }) {
    ensureStyles()
    const [open, setOpen] = React.useState(autoOpen)
    const [items, setItems] = React.useState([])
    const [selectedIds, setSelectedIds] = React.useState([])
    const [confirmIds, setConfirmIds] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [query, setQuery] = React.useState('')
    const selectAllRef = React.useRef(null)
    const load = () => fetch('/dsh-archive-manager/archives', { cache: 'no-store' })
      .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setItems(v.items || []); setSelectedIds([]); setError('') })
      .catch(e => setError(String(e.message || e)))
    React.useEffect(() => { if (open) load() }, [open])
    React.useEffect(() => {
      if (selectAllRef.current) selectAllRef.current.indeterminate = selectedIds.length > 0 && selectedIds.length < items.length
    }, [items.length, selectedIds.length])

    // 本地搜索：按标题 / 工作区过滤（数据量小，不发请求）。
    const term = query.trim().toLowerCase()
    const visible = term
      ? items.filter(item => `${item.title} ${item.workspace}`.toLowerCase().includes(term))
      : items
    const allSelected = visible.length > 0 && visible.every(item => selectedIds.includes(item.id))
    const toggle = (id) => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
    const toggleAll = () => setSelectedIds(allSelected ? [] : visible.map(item => item.id))
    const requestDelete = (ids) => { if (ids.length > 0) { setError(''); setConfirmIds(ids) } }
    const confirmDelete = () => {
      // 确认块只在 confirmIds 非空时渲染（requestDelete 也只收非空列表），
      // 所以这里不需要再判空。
      setBusy(true)
      fetch('/dsh-archive-manager/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionIds: confirmIds }) })
        .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setItems(current => current.filter(x => !confirmIds.includes(x.id))); setSelectedIds(current => current.filter(x => !confirmIds.includes(x))); setConfirmIds(null) })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(false))
    }
    const restore = (ids) => {
      const list = Array.isArray(ids) ? ids : [ids]
      if (!list.length) return
      setBusy(true); setError('')
      fetch('/dsh-archive-manager/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionIds: list }) })
        .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setItems(current => current.filter(x => !list.includes(x.id))); setSelectedIds(current => current.filter(x => !list.includes(x))) })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(false))
    }

    const rows = visible.length === 0
      ? h('div', { className: 'dsh-archive-empty' },
          h('span', { className: 'ico' }, icon('archive', 20)),
          h('b', null, term ? '没有匹配的归档会话' : '暂无归档会话'),
          h('p', null, term ? '换个关键词试试，或清空搜索看全部归档。' : '在会话列表里归档的会话会出现在这里，随时可以还原或删除。'))
      : h('div', { className: 'dsh-archive-list' }, visible.map(item => h('div', { className: 'dsh-archive-row', key: item.id },
          h('input', { type: 'checkbox', checked: selectedIds.includes(item.id), onChange: () => toggle(item.id), 'aria-label': `选择 ${item.title}` }),
          h('span', { className: 'dsh-archive-icon' }, icon('archive', 17)),
          h('div', { className: 'dsh-archive-row-main' },
            h('div', { className: 'dsh-archive-row-title' }, item.title),
            h('div', { className: 'dsh-archive-meta' },
              h('span', null, item.workspace),
              h('span', { className: 'sep' }, '·'),
              h('span', null, `${item.descendants} 个后代`))),
          h('button', { className: 'dsh-archive-row-restore', disabled: busy, onClick: () => restore(item.id), title: '取消归档，回到会话列表' }, '还原'),
          h('button', { className: 'dsh-archive-row-delete', disabled: busy, onClick: () => requestDelete([item.id]) }, '删除'))))

    const close = () => { if (onClose) onClose(); else setOpen(false) }
    const confirmItems = items.filter(item => confirmIds?.includes(item.id))
    return h(React.Fragment, null,
      !autoOpen && h('button', { type: 'button', className: wide === false ? 'dsh-archive-trigger dsh-archive-trigger-rail' : 'dsh-archive-trigger', onClick: () => setOpen(true), title: '归档管理', 'aria-label': '归档管理' },
        h('span', { className: 'dsh-archive-trigger-icon', 'aria-hidden': true }), wide && h('span', null, '归档')),
      open && h(React.Fragment, null,
        h('div', { className: 'dsh-archive-backdrop', onClick: () => !busy && close() }),
        h('div', { className: 'dsh-archive-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '归档管理' },
          h('div', { className: 'dsh-archive-head' },
            h('h2', null, '归档管理'),
            h('span', { className: 'dsh-archive-count' }, items.length > 0
              ? `${items.length} 个归档会话${term ? ` · 匹配 ${visible.length} 个` : ''}`
              : '0 个归档会话'),
            h('label', { className: 'dsh-archive-find' }, icon('search', 13),
              h('input', { placeholder: '搜索标题或工作区…', value: query, onChange: e => setQuery(e.target.value), 'aria-label': '搜索归档会话' })),
            h('button', { className: 'dsh-archive-close', onClick: () => !busy && close(), 'aria-label': '关闭' }, '×')),
          h('div', { className: 'dsh-archive-toolbar' },
            h('label', { className: 'dsh-archive-select-all' },
              h('input', { ref: selectAllRef, type: 'checkbox', checked: allSelected, onChange: toggleAll, disabled: visible.length === 0 || busy, 'aria-label': allSelected ? '取消全选' : '全选' }),
              h('span', null, '全选')),
            h('span', { className: 'dsh-archive-toolbar-meta' }, selectedIds.length ? `已选 ${selectedIds.length} 个` : ''),
            h('button', { className: 'dsh-archive-tool dsh-archive-tool-primary', onClick: () => restore(selectedIds), disabled: selectedIds.length === 0 || busy }, `还原选中${selectedIds.length ? ` (${selectedIds.length})` : ''}`),
            h('button', { className: 'dsh-archive-tool dsh-archive-tool-danger', onClick: () => requestDelete(selectedIds), disabled: selectedIds.length === 0 || busy }, `删除选中${selectedIds.length ? ` (${selectedIds.length})` : ''}`)),
          error && h('div', { className: 'dsh-archive-error' }, error),
          confirmIds && h('div', { className: 'dsh-archive-confirm' },
            h('div', { className: 'dsh-archive-confirm-title' }, `确认删除 ${confirmIds.length} 个归档会话？`),
            h('div', { className: 'dsh-archive-confirm-copy' }, `将永久删除所选会话及其后代（共 ${confirmItems.reduce((sum, item) => sum + item.descendants + 1, 0)} 个会话），此操作无法撤销。`),
            h('div', { className: 'dsh-archive-confirm-actions' },
              h('button', { className: 'dsh-archive-confirm-cancel', onClick: () => setConfirmIds(null), disabled: busy }, '取消'),
              h('button', { className: 'dsh-archive-confirm-delete', onClick: confirmDelete, disabled: busy }, busy ? '删除中…' : '确认删除'))),
          rows)))
  }

  function apply(ctx) {
    ensureStyles()
    // 新版 DSH 的 sidebar.panellist 只渲染图标，页面必须注册到 main slot；
    // 只注册 sidebar.panellist 会让点击图标变成静默 no-op（本次 bug）。
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: NS, locale: NS,
    }, function ArchiveMain() {
      return h(ArchivePanel, {
        wide: true,
        autoOpen: true,
        onClose: () => ctx.layout.selectPanel(null),
      })
    }))
    // Registered in dsh's own sidebar panel list: the entry appears in the
    // sidebar and in dsh's "更多" menu, and takes no room from the workspace
    // list the way a footer row did.
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: NS, order: 300, label: '归档管理',
    }, function ArchiveEntry() {
      return h('span', { className: 'dsh-archive-trigger-icon', 'aria-hidden': true })
    }))
  }
  return { inject: ['slots', 'locale', 'layout'], apply }
}})
