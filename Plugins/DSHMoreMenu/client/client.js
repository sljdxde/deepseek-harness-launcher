/**
 * dsh-more-menu — 把低频的侧边栏入口收进一个「更多」菜单。
 *
 * 问题：侧边栏 footer 现在挂着「归档管理」「启动器设置」「插件管理」三行，
 * 每行都占 42px，把「设置」挤到最下面，且三个入口并列时侧边栏显得很挤。
 *
 * 做法：本插件注册**一个** footer 入口「更多」，把愿意折叠进来的插件收进
 * 它的弹出菜单。子插件不再自己注册 footer，而是调用：
 *
 *     window.__dshMoreMenu.register({ id, label, icon, order, open })
 *
 * 其中 `open()` 是子插件用来打开自己面板的回调。子插件自己渲染面板，
 * 本插件只负责菜单与调用，不碰子插件的业务。
 *
 * 子插件先注册、本插件后挂载也成立：注册表在 window 上，双方都只是读写它。
 */
window.__ModuleLoader__.load({ id: 'dsh-more-menu', factory: (require) => {
  const React = require('react')
  const h = React.createElement
  const NS = 'dsh-more-menu'

  // ── 共享注册表 ────────────────────────────────────────────────────────
  // 挂在 window 上而不是模块作用域：各插件是独立的 ModuleLoader 工厂，
  // 互相看不到对方的作用域，window 是它们唯一共享的通道。
  const REGISTRY_KEY = '__dshMoreMenuRegistry'
  if (!window[REGISTRY_KEY]) {
    window[REGISTRY_KEY] = { entries: new Map(), listeners: new Set() }
  }
  const registry = window[REGISTRY_KEY]

  function notify() {
    for (const fn of registry.listeners) {
      try { fn() } catch { /* 一个订阅者出错不影响其它 */ }
    }
  }

  /**
   * 子插件调用：把自己登记进「更多」。
   * 重复登记同一 id 时后写的覆盖先写的（热重载安全）。
   */
  window.__dshMoreMenu = {
    register(entry) {
      if (!entry || !entry.id || typeof entry.open !== 'function') return
      registry.entries.set(entry.id, {
        order: typeof entry.order === 'number' ? entry.order : 100,
        label: entry.label || entry.id,
        icon: entry.icon || 'dot',
        open: entry.open,
        badge: entry.badge || '',
      })
      notify()
    },
    unregister(id) {
      if (registry.entries.delete(id)) notify()
    },
    /** 供面板轮询角标用：让「更多」上的数字跟着更新。 */
    refresh() { notify() },
  }

  const css = `
.${NS}-trigger{align-items:center;appearance:none;background:transparent;border:0;border-radius:8px;box-sizing:border-box;color:inherit;cursor:pointer;display:flex;flex:0 0 100%;font:inherit;font-size:14px;gap:8px;line-height:22px;margin:4px -2px;min-height:42px;min-width:0;padding:0 10px 0 8px;text-align:left;position:relative}
.${NS}-trigger:hover{background:var(--dsw-alias-button-ghost-active-fill)}
.${NS}-trigger.${NS}-rail{border-radius:50%;corner-shape:round;flex:none;height:36px;justify-content:center;margin:4px 0;min-height:36px;padding:0;width:36px}
.${NS}-trigger.${NS}-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${NS}-dots{display:inline-flex;flex-direction:column;gap:2.5px;flex:0 0 16px;align-items:center}
.${NS}-dots i{background:currentColor;border-radius:50%;display:block;height:3px;opacity:.75;width:3px}
.${NS}-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${NS}-badge{background:var(--dsw-alias-brand-primary);border-radius:9px;color:#fff;font-size:10px;font-weight:600;line-height:16px;min-width:16px;padding:0 5px;text-align:center}
div:has(> [data-slot='sidebar.footer.action']){flex-wrap:wrap}

.${NS}-menu{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.26);display:flex;flex-direction:column;min-width:184px;padding:5px;position:fixed;z-index:2147483000}
.${NS}-item{align-items:center;appearance:none;background:transparent;border:0;border-radius:7px;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;font:inherit;font-size:13px;gap:9px;line-height:20px;padding:8px 10px;text-align:left;width:100%}
.${NS}-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.${NS}-item-icon{color:var(--dsw-alias-label-secondary);display:flex;flex:0 0 16px;height:16px;width:16px}
.${NS}-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${NS}-item-badge{background:var(--dsw-alias-bg-layer-3);border-radius:9px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:600;padding:1px 6px}
.${NS}-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:10px 12px;text-align:center}
`

  function ensureStyles() {
    if (document.getElementById(NS + '-style')) return
    const style = document.createElement('style')
    style.id = NS + '-style'
    style.textContent = css
    document.head.appendChild(style)
  }

  // 每个入口一个 16×16 的线性图标，颜色跟随 currentColor
  const ICONS = {
    dot: 'M8 3v10',
    gear: 'M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6M8 2v1.4M8 12.6V14M2 8h1.4M12.6 8H14M3.8 3.8l1 1M11.2 11.2l1 1M12.2 3.8l-1 1M4.8 11.2l-1 1',
    puzzle: 'M3 6.5h2.2a1.3 1.3 0 1 1 2.6 0H10v2.2a1.3 1.3 0 1 0 0 2.6V13H3z',
    archive: 'M2.5 4.5h11v2h-11zM3.5 6.5h9V13h-9zM6.5 8.5h3',
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.5')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', ICONS[name] || ICONS.dot)
    svg.appendChild(path)
    return svg
  }

  function MoreTrigger({ wide }) {
    ensureStyles()
    const [open, setOpen] = React.useState(false)
    const [entries, setEntries] = React.useState([])
    const [pos, setPos] = React.useState({ left: 0, top: 0 })
    const btnRef = React.useRef(null)

    // 订阅注册表：子插件增减入口时立刻重画
    React.useEffect(() => {
      const sync = () => {
        const list = [...registry.entries.entries()]
          .map(([id, e]) => ({ id, ...e }))
          .sort((a, b) => a.order - b.order)
        setEntries(list)
      }
      registry.listeners.add(sync)
      sync()
      return () => registry.listeners.delete(sync)
    }, [])

    // 点外部关闭
    React.useEffect(() => {
      if (!open) return
      const onDown = (e) => {
        if (e.target.closest(`.${NS}-menu`) || e.target.closest(`.${NS}-trigger`)) return
        setOpen(false)
      }
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
      document.addEventListener('mousedown', onDown, true)
      document.addEventListener('keydown', onKey, true)
      return () => {
        document.removeEventListener('mousedown', onDown, true)
        document.removeEventListener('keydown', onKey, true)
      }
    }, [open])

    const toggle = () => {
      if (!open && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect()
        // 菜单贴在按钮上方（footer 在最底部）
        const menuH = Math.min(320, entries.length * 38 + 12)
        setPos({ left: r.left, top: Math.max(8, r.top - menuH - 6) })
      }
      setOpen(v => !v)
    }

    const rail = wide === false
    const label = '更多'
    return h(React.Fragment, null,
      h('button', {
        ref: btnRef,
        type: 'button',
        className: rail ? `${NS}-trigger ${NS}-rail` : `${NS}-trigger`,
        onClick: toggle,
        title: label,
        'aria-label': label,
        'aria-expanded': open,
      },
        h('span', { className: `${NS}-dots` }, h('i'), h('i'), h('i')),
        rail ? null : h('span', { className: `${NS}-label` }, label)),

      open && h('div', {
        className: `${NS}-menu`,
        style: { left: `${pos.left}px`, top: `${pos.top}px` },
        role: 'menu',
      }, entries.length === 0
        ? h('div', { className: `${NS}-empty` }, '没有更多入口')
        : entries.map(entry => h('button', {
            key: entry.id,
            type: 'button',
            role: 'menuitem',
            className: `${NS}-item`,
            onClick: () => { setOpen(false); entry.open() },
          },
            h('span', { className: `${NS}-item-icon` }, icon(entry.icon)),
            h('span', { className: `${NS}-item-label` }, entry.label),
            entry.badge ? h('span', { className: `${NS}-item-badge` }, entry.badge) : null
          ))
      ))
  }

  function apply(ctx) {
    ensureStyles()
    // dsh owns the "更多" menu: it lists every entry registered in
    // sidebar.panellist. A second, self-built menu was a duplicate button
    // at the bottom of the sidebar, which is what the user rejected.
    // This plugin therefore registers nothing; it stays only so existing
    // installs keep loading (the registry it exposes is still used by the
    // panels that were written against it).
  }

  return { inject: ['slots', 'locale'], apply }
}})
