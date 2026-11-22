/**
 * 壳层渲染（票 30）：图标栏 / 状态条 → vnode。
 *
 * 约束：这些函数会被 tools/sync-contract.mjs 用 toString 内联进浏览器单文件，
 * 所以只能引用本文件之外**同样被内联**的常量（SHELL_ICONS / DSH_LOGO），不能引用 Node 模块。
 * 好处是 Node 侧用假 h 就能断言结构，渲染逻辑不必依赖真浏览器。
 */

import { SHELL_ICONS, DSH_LOGO } from './icons.js'

/**
 * 生成一个 24×24 线性图标节点。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {string} name - SHELL_ICONS 的键；未知键给空体（不 throw）。
 * @returns {any} SVG vnode。
 */
export function shellIcon(h, name) {
  const body = SHELL_ICONS[name] ?? ''
  return h('svg', {
    viewBox: '0 0 24 24',
    className: 'launcher-ic',
    'aria-hidden': 'true',
    focusable: 'false',
    dangerouslySetInnerHTML: { __html: body },
  })
}

/**
 * 图标栏。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {object} [options] - entries/leading/activeKey/theme/窄窗与回调。
 * @returns {any} nav vnode。
 */
export function renderRail(h, options) {
  const opts = options ?? {}
  const entries = Array.isArray(opts.entries) ? opts.entries : []
  const theme = opts.theme === 'dark' ? 'dark' : 'light'
  const children = []

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__logo',
    title: 'dsh · 回到会话',
    'aria-label': 'dsh 首页',
    'data-rail-action': 'home',
    onClick: opts.onHome,
  }, h('svg', {
    viewBox: DSH_LOGO.viewBox,
    className: 'launcher-rail__mark',
    'aria-hidden': 'true',
    focusable: 'false',
    dangerouslySetInnerHTML: { __html: DSH_LOGO.body },
  })))

  if (opts.leading !== undefined && opts.leading !== null) children.push(opts.leading)

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__action',
    'data-rail-action': 'dock',
    'aria-label': '开关右栏',
    'aria-pressed': opts.dockOpen === true,
    title: '开关右栏（宽度 320–520）',
    onClick: opts.onToggleDock,
  }, shellIcon(h, 'panel')))

  if (opts.narrow === true) {
    children.push(h('button', {
      type: 'button',
      className: 'launcher-rail__action',
      'data-rail-action': 'drawer',
      'aria-label': '开关侧栏',
      'aria-expanded': opts.drawerOpen === true,
      onClick: opts.onToggleDrawer,
    }, shellIcon(h, 'sidebar')))
  }

  for (const entry of entries) {
    const badge = Number(entry.badge) > 0 ? String(entry.badge) : ''
    const disabled = entry.disabled === true
    const title = entry.title ?? entry.label
    children.push(h('button', {
      type: 'button',
      className: `launcher-rail__entry${entry.active === true ? ' on' : ''}`,
      title,
      'aria-label': entry.label,
      'aria-pressed': entry.active === true,
      'aria-disabled': disabled,
      'data-rail-key': entry.id,
      onClick: disabled ? undefined : entry.onSelect,
    },
    h('span', { className: 'launcher-rail__tip' }, title),
    shellIcon(h, entry.icon),
    badge === '' ? null : h('span', { className: 'launcher-rail__badge' }, badge)))
  }

  children.push(h('div', { className: 'launcher-rail__spacer' }))

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__action',
    'data-rail-action': 'theme',
    'aria-label': theme === 'dark' ? '切换到日间' : '切换到夜间',
    'aria-pressed': theme === 'dark',
    title: theme === 'dark' ? '当前：深色，点击切浅色' : '当前：浅色，点击切深色',
    onClick: opts.onToggleTheme,
  }, shellIcon(h, theme === 'dark' ? 'sun' : 'moon')))

  children.push(h('button', {
    type: 'button',
    className: 'launcher-rail__action',
    'data-rail-action': 'palette',
    'aria-label': '命令面板',
    title: '命令面板 ⌘K',
    onClick: opts.onOpenPalette,
  }, shellIcon(h, 'command')))

  return h('nav', { className: 'launcher-rail', role: 'navigation', 'aria-label': 'launcher rail' }, ...children)
}

/**
 * 底状态条：页面 / 运行模式 / 在跑任务 三段 + 宿主底部槽位。
 * @param {(type: string, props?: object, ...children: any[]) => any} h - createElement。
 * @param {{ page?: string, mode?: string, running?: string }} [status] - statusText 的返回值。
 * @param {{ bottom?: any }} [options] - 宿主 shell.bottom 槽位节点。
 * @returns {any} footer vnode。
 */
export function renderStatusbar(h, status, options) {
  const s = status ?? {}
  const opts = options ?? {}
  const children = [
    h('span', { className: 'launcher-statusbar__page' }, String(s.page ?? '会话')),
    h('span', { className: 'launcher-statusbar__mode' }, String(s.mode ?? '')),
    h('span', { className: 'launcher-statusbar__running' }, String(s.running ?? '')),
  ]
  if (opts.bottom !== undefined && opts.bottom !== null) children.push(opts.bottom)
  return h('footer', { className: 'launcher-statusbar' }, ...children)
}
