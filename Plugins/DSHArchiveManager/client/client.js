window.__ModuleLoader__.load({ id: "dsh-archive-manager", factory: (require) => {
  const React = require('react')
  const h = React.createElement
  const NS = 'dsh-archive-manager'
  const css = `.dsh-archive-trigger{align-items:center;appearance:none;background:transparent;border:0;border-radius:8px;color:inherit;cursor:pointer;display:flex;font:inherit;font-size:14px;gap:8px;line-height:22px;margin:4px -2px;min-height:42px;padding:0 10px 0 8px;text-align:left;width:100%}.dsh-archive-trigger:hover{background:var(--dsw-alias-button-ghost-active-fill)}.dsh-archive-trigger-icon{border:1.75px solid currentColor;border-radius:4px;box-sizing:border-box;display:inline-block;flex:0 0 16px;height:16px;position:relative;width:16px}.dsh-archive-trigger-icon:before{border-top:1.75px solid currentColor;content:"";left:2px;position:absolute;right:2px;top:5px}.dsh-archive-trigger-icon:after{border:1.75px solid currentColor;border-bottom:0;border-radius:3px 3px 0 0;box-sizing:border-box;content:"";height:4px;left:3px;position:absolute;top:-5px;width:7px}.dsh-archive-backdrop{background:rgba(15,18,24,.32);inset:0;position:fixed;z-index:2147483000}.dsh-archive-modal{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;font-size:13px;gap:12px;left:50%;max-height:80vh;max-width:680px;overflow:auto;padding:18px;position:fixed;top:50%;transform:translate(-50%,-50%);width:min(680px,calc(100vw - 32px));z-index:2147483001}.dsh-archive-header{align-items:center;display:flex;gap:10px}.dsh-archive-header strong{font-size:16px;line-height:22px}.dsh-archive-header-spacer{flex:1}.dsh-archive-close{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:18px;height:28px;line-height:24px;width:28px}.dsh-archive-close:hover{background:var(--dsw-alias-button-ghost-active-fill);color:inherit}.dsh-archive-toolbar{align-items:center;border-bottom:1px solid var(--dsw-alias-border-l2);display:flex;gap:8px;min-height:28px;padding:0 10px 10px}.dsh-archive-select-all{align-items:center;display:inline-flex;flex:0 0 auto;gap:8px;line-height:20px}.dsh-archive-select-all input{accent-color:var(--dsw-alias-brand-primary);flex:0 0 auto;height:16px;margin:0;width:16px}.dsh-archive-toolbar-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-right:auto}.dsh-archive-tool{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:4px 8px}.dsh-archive-tool:hover{background:var(--dsw-alias-button-ghost-active-fill);color:inherit}.dsh-archive-tool-danger{color:var(--dsw-alias-state-error-primary)}.dsh-archive-tool:disabled{cursor:not-allowed;opacity:.45}.dsh-archive-row{align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;gap:10px;padding:10px}.dsh-archive-row:hover{background:var(--dsw-alias-bg-layer-2)}.dsh-archive-row input{accent-color:var(--dsw-alias-brand-primary);flex:0 0 auto;height:16px;margin:0;width:16px}.dsh-archive-row-main{flex:1;min-width:0}.dsh-archive-row-title{font-size:14px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-archive-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-archive-row-delete{background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-state-error-primary);cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:4px 8px}.dsh-archive-row-delete:hover{background:rgba(220,50,47,.1)}.dsh-archive-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:24px 0;text-align:center}.dsh-archive-error{background:rgba(220,50,47,.08);border-radius:6px;color:var(--dsw-alias-state-error-primary);font-size:12px;padding:8px 10px}.dsh-archive-confirm{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:14px}.dsh-archive-confirm-title{font-size:13px;font-weight:600;line-height:20px}.dsh-archive-confirm-copy{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;margin-top:6px}.dsh-archive-confirm-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.dsh-archive-confirm-actions button{border:0;border-radius:6px;cursor:pointer;font:inherit;font-size:13px;line-height:20px;padding:4px 12px}.dsh-archive-confirm-cancel{background:var(--dsw-alias-button-ghost-fill);color:inherit}.dsh-archive-confirm-delete{background:var(--dsw-alias-state-error-primary);color:#fff}.dsh-archive-confirm-actions button:disabled{cursor:not-allowed;opacity:.5}`

  function ensureStyles() {
    if (document.getElementById(NS + '-style')) return
    const style = document.createElement('style')
    style.id = NS + '-style'
    style.textContent = css
    document.head.appendChild(style)
  }

  function ArchivePanel({ wide }) {
    ensureStyles()
    const [open, setOpen] = React.useState(false)
    const [items, setItems] = React.useState([])
    const [selectedIds, setSelectedIds] = React.useState([])
    const [confirmIds, setConfirmIds] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const selectAllRef = React.useRef(null)
    const load = () => fetch('/dsh-archive-manager/archives', { cache: 'no-store' })
      .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setItems(v.items || []); setSelectedIds([]); setError('') })
      .catch(e => setError(String(e.message || e)))
    React.useEffect(() => { if (open) load() }, [open])
    React.useEffect(() => {
      if (selectAllRef.current) selectAllRef.current.indeterminate = selectedIds.length > 0 && selectedIds.length < items.length
    }, [items.length, selectedIds.length])

    const allSelected = items.length > 0 && selectedIds.length === items.length
    const toggle = (id) => setSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
    const toggleAll = () => setSelectedIds(allSelected ? [] : items.map(item => item.id))
    const requestDelete = (ids) => { if (ids.length > 0) { setError(''); setConfirmIds(ids) } }
    const confirmDelete = () => {
      if (!confirmIds?.length) return
      setBusy(true)
      fetch('/dsh-archive-manager/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionIds: confirmIds }) })
        .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setItems(current => current.filter(x => !confirmIds.includes(x.id))); setSelectedIds(current => current.filter(x => !confirmIds.includes(x))); setConfirmIds(null) })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(false))
    }

    const rows = items.length === 0
      ? h('div', { className: 'dsh-archive-empty' }, '暂无归档会话')
      : items.map(item => h('div', { className: 'dsh-archive-row', key: item.id },
          h('input', { type: 'checkbox', checked: selectedIds.includes(item.id), onChange: () => toggle(item.id), 'aria-label': `选择 ${item.title}` }),
          h('div', { className: 'dsh-archive-row-main' },
            h('div', { className: 'dsh-archive-row-title' }, item.title),
            h('div', { className: 'dsh-archive-meta' }, `${item.workspace} · ${item.descendants} 个后代`)),
          h('button', { className: 'dsh-archive-row-delete', disabled: busy, onClick: () => requestDelete([item.id]) }, '删除')))

    const confirmItems = items.filter(item => confirmIds?.includes(item.id))
    return h(React.Fragment, null,
      h('button', { type: 'button', className: 'dsh-archive-trigger', onClick: () => setOpen(true), title: '归档管理', 'aria-label': '归档管理' },
        h('span', { className: 'dsh-archive-trigger-icon', 'aria-hidden': true }), wide && h('span', null, '归档')),
      open && h(React.Fragment, null,
        h('div', { className: 'dsh-archive-backdrop', onClick: () => !busy && setOpen(false) }),
        h('div', { className: 'dsh-archive-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '归档管理' },
          h('div', { className: 'dsh-archive-header' },
            h('strong', null, '归档管理'),
            h('span', { className: 'dsh-archive-header-spacer' }),
            h('button', { className: 'dsh-archive-close', onClick: () => !busy && setOpen(false), 'aria-label': '关闭' }, '×')),
          h('div', { className: 'dsh-archive-toolbar' },
            h('label', { className: 'dsh-archive-select-all' },
              h('input', { ref: selectAllRef, type: 'checkbox', checked: allSelected, onChange: toggleAll, disabled: items.length === 0 || busy, 'aria-label': allSelected ? '取消全选' : '全选' }),
              h('span', null, '全选')),
            h('span', { className: 'dsh-archive-toolbar-meta' }, `${items.length} 个归档会话${selectedIds.length ? ` · 已选 ${selectedIds.length}` : ''}`),
            h('button', { className: 'dsh-archive-tool dsh-archive-tool-danger', onClick: () => requestDelete(selectedIds), disabled: selectedIds.length === 0 || busy }, '删除选中')),
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
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: NS, order: 50, label: '归档管理' }, ArchivePanel))
  }
  return { inject: ['slots', 'locale'], apply }
}})
