window.__ModuleLoader__.load({ id: 'dsh-plugin-manager', factory: (require) => {
  const React = require('react')
  const h = React.createElement
  const NS = 'dsh-plugin-manager'
  const css = `
/* dsh sidebar footer actions: stack vertically so archive / plugin manager /
   future entries appear one per row instead of side by side */
[class$="_footerActions"]{flex-direction:column}
[class$="_footerActions"]>*{width:100%}
.dsh-pm-trigger{align-items:center;appearance:none;background:transparent;border:0;border-radius:8px;color:inherit;cursor:pointer;display:flex;font:inherit;font-size:14px;gap:8px;line-height:22px;margin:4px -2px;min-height:42px;padding:0 10px 0 8px;text-align:left;width:100%}
.dsh-pm-trigger:hover{background:var(--dsw-alias-button-ghost-active-fill)}
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
.dsh-pm-notice{background:rgba(82,196,26,.08);border-radius:6px;color:var(--dsw-alias-state-success-primary);font-size:12px;margin-bottom:10px;padding:8px 10px}
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
.dsh-pm-confirm-actions button:disabled{cursor:not-allowed;opacity:.5}`
  const CATEGORY_EMOJI = { browser: '🌐', tool: '🛠️', ui: '🎨', storage: '🗄️', workflow: '🔀', agent: '🤖', search: '🔍', data: '📊', network: '🌍', dev: '💻', other: '🧩' }

  function ensureStyles() {
    if (document.getElementById(NS + '-style')) return
    const style = document.createElement('style')
    style.id = NS + '-style'
    style.textContent = css
    document.head.appendChild(style)
  }

  function normalizeText(value) { return (value || '').toLowerCase() }
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

  /// Sidebar entry: a button that opens the plugin manager page on click.
  /// The slot renders this component in the sidebar footer, so the page itself
  /// must NOT be registered directly (it would render the full-screen modal on
  /// load and its close button would not work).
  function PluginTrigger({ wide, t, onClose }) {
    const [open, setOpen] = React.useState(false)
    return h(React.Fragment, null,
      h('button', { type: 'button', className: 'dsh-pm-trigger', onClick: () => setOpen(true), title: '插件管理', 'aria-label': '插件管理' },
        h('span', { className: 'dsh-pm-trigger-icon', 'aria-hidden': true }),
        h('span', null, '插件管理')),
      open ? h(PluginManagerPage, { wide, t, onClose: () => setOpen(false) }) : null)
  }

  function PluginManagerPage({ wide, t, onClose }) {
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
    const [error, setError] = React.useState('')
    const [notice, setNotice] = React.useState('')
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

    const refreshMarket = () => {
      setBusy('refresh')
      fetch('/dsh-plugin-manager/refresh', { method: 'POST' })
        .then(r => r.json()).then(v => { if (v.error) throw Error(v.error); setNotice(`市场已刷新：${v.count} 个插件`); return loadMarket() })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(''))
    }
    const install = (plugin) => {
      setBusy(plugin.id); setError(''); setNotice('')
      fetch('/dsh-plugin-manager/install', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: plugin.url, name: plugin.name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '安装失败')
          setNotice(v.alreadyInstalled ? `${plugin.name} 已在已安装列表中` : `已安装 ${plugin.name}，重启 dsh 后生效`)
          setDetail(null)
          return loadInstalled()
        })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(''))
    }
    const cleanupBroken = (item) => {
      setBusy('cleanup-' + item.name); setError(''); setNotice('')
      fetch('/dsh-plugin-manager/cleanup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: item.name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '清理失败')
          setNotice(`已清理损坏的安装 ${item.name}`)
          return loadInstalled()
        })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(''))
    }
    const requestUninstall = (item) => { setError(''); setNotice(''); setConfirmUninstall(item) }
    const confirmUninstallGo = () => {
      if (!confirmUninstall) return
      setBusy('uninstall'); setConfirmUninstall(null)
      fetch('/dsh-plugin-manager/uninstall', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: confirmUninstall.name }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          if (!v.ok) throw Error(v.error || '卸载失败')
          setNotice(`已卸载 ${confirmUninstall.name}，重启 dsh 后生效`)
          return loadInstalled()
        })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(''))
    }

    const manageable = installed.filter(item => !item.broken && item.source !== 'bundled')
    const selectedNames = manageable.filter(item => selected.has(item.name)).map(item => item.name)
    const toggleSelect = (name) => {
      const next = new Set(selected)
      if (next.has(name)) next.delete(name); else next.add(name)
      setSelected(next)
    }
    const toggleSelectAll = () => {
      if (manageable.length > 0 && selectedNames.length === manageable.length) setSelected(new Set())
      else setSelected(new Set(manageable.map(item => item.name)))
    }
    const toggleInvert = () => {
      const next = new Set(selected)
      manageable.forEach(item => { if (next.has(item.name)) next.delete(item.name); else next.add(item.name) })
      setSelected(next)
    }
    const uninstallManyGo = () => {
      if (selectedNames.length === 0) return
      setBusy('uninstall-many'); setConfirmBatch(false); setError(''); setNotice('')
      fetch('/dsh-plugin-manager/uninstall-many', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ names: selectedNames }) })
        .then(r => r.json()).then(v => {
          if (v.error) throw Error(v.error)
          const failed = (v.results || []).filter(r => !r.ok)
          setNotice(failed.length === 0 ? `已卸载 ${selectedNames.length} 个插件，重启 dsh 后生效` : `部分卸载失败：${failed.map(f => f.name).join('、')}`)
          setSelected(new Set())
          return loadInstalled()
        })
        .catch(e => setError(String(e.message || e))).finally(() => setBusy(''))
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

    const installedRows = installed.map(item => {
      const selectable = !item.broken && item.source !== 'bundled'
      return h('div', { className: 'dsh-pm-row', key: item.name },
        selectable
          ? h('input', { type: 'checkbox', className: 'dsh-pm-check', checked: selected.has(item.name), onChange: () => toggleSelect(item.name), 'aria-label': '选择 ' + item.name })
          : h('span', { className: 'dsh-pm-check', 'aria-hidden': true }),
        h('div', { className: 'dsh-pm-row-main' },
          h('div', { className: 'dsh-pm-row-title' }, item.name),
          h('div', { className: 'dsh-pm-row-meta' }, `${item.description || '无描述'}${item.version ? ` · v${item.version}` : ''}`)),
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

    return h('div', null,
      h('div', { className: 'dsh-pm-backdrop', onClick: () => { if (!busy) { onClose() } } }),
      h('div', { className: 'dsh-pm-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件管理' },
        h('div', { className: 'dsh-pm-header' },
          h('button', { className: 'dsh-pm-back', onClick: () => { if (!busy) onClose() }, 'aria-label': '返回' }, '← 返回'),
          h('strong', null, '插件管理'),
          h('div', { className: 'dsh-pm-tabs' },
            h('button', { className: `dsh-pm-tab${tab === 'installed' ? ' dsh-pm-tab-active' : ''}`, onClick: () => setTab('installed') }, `已安装${installed.length ? ` (${installed.length})` : ''}`),
            h('button', { className: `dsh-pm-tab${tab === 'market' ? ' dsh-pm-tab-active' : ''}`, onClick: () => setTab('market') }, '插件市场')),
          h('div', { className: 'dsh-pm-header-spacer' }),
          tab === 'market' ? h('button', { className: 'dsh-pm-tool', disabled: busy === 'refresh', onClick: refreshMarket }, busy === 'refresh' ? '刷新中…' : '刷新市场') : null,
          h('button', { className: 'dsh-pm-tool dsh-pm-close', onClick: () => { if (!busy) onClose() }, 'aria-label': '关闭' }, '×')),
        h('div', { className: 'dsh-pm-body' },
          error && h('div', { className: 'dsh-pm-error' }, error),
          notice && h('div', { className: 'dsh-pm-notice' }, notice),
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
          tab === 'installed'
            ? (installed.length === 0 ? h('div', { className: 'dsh-pm-empty' }, '还没有已安装的插件，去插件市场看看吧')
               : h('div', null,
                   h('div', { className: 'dsh-pm-bulkbar' },
                     h('button', { className: 'dsh-pm-tool', onClick: toggleSelectAll }, manageable.length > 0 && selectedNames.length === manageable.length ? '取消全选' : '全选'),
                     h('button', { className: 'dsh-pm-tool', onClick: toggleInvert }, '反选'),
                     h('button', { className: 'dsh-pm-tool', disabled: selectedNames.length === 0 || busy === 'uninstall-many', onClick: () => setConfirmBatch(true), style: selectedNames.length > 0 ? { color: 'var(--dsw-alias-state-error-primary)' } : undefined }, `批量卸载${selectedNames.length ? ` (${selectedNames.length})` : ''}`)),
                   h('div', { className: 'dsh-pm-list' }, installedRows)))
            : marketTab,
          drawer)))
  }

  function apply(ctx) {
    ensureStyles()
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: NS, order: 60, label: '插件管理' }, PluginTrigger))
  }
  return { inject: ['slots', 'locale'], apply }
}})
