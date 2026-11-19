/**
 * 插件工作台容器（W7 / FR-28~FR-30；容器规范 §1.2 §1.3 §4）。
 *
 * 一个「插件」一级入口 + 二级菜单（固定 / 更多 / 图钉）+ `plugin:<id>` 面板 + 页头回链 + 降级矩阵。
 * 这里只算菜单结构与降级判定，渲染与图标留给 client；所有失败都返回结果对象，不 throw。
 */

/** `plugin:<id>` 的 key 前缀。 */
export const PLUGIN_PREFIX = 'plugin:'

/** 拼一个 main 槽的插件 key。 */
export function pluginKey(id) {
  return `${PLUGIN_PREFIX}${String(id)}`
}

/**
 * 从 main key 里取插件 id。
 * @param {string} key - main 的 key。
 * @returns {string|null} 插件 id；不是插件 key 时 null。
 */
export function pluginIdOf(key) {
  if (typeof key !== 'string' || !key.startsWith(PLUGIN_PREFIX)) return null
  const id = key.slice(PLUGIN_PREFIX.length)
  return id.length > 0 ? id : null
}

/**
 * 二级菜单：固定的留在主菜单，其余进「更多」；固定列表里已不存在的 id 丢掉并报出来。
 * @param {{ id: string, label: string, pinned?: boolean }[]} plugins - 已发现插件。
 * @param {string[]} pinned - 用户固定的 id 顺序（容器规范 §1.2）。
 * @returns {{ primary: object[], more: object[], dropped: string[] }} 两级菜单与失效固定项。
 */
export function buildPluginMenu(plugins, pinned = []) {
  const known = new Map((plugins ?? []).map((plugin) => [plugin.id, plugin]))
  const pinnedOrder = []
  const dropped = []
  for (const id of Array.isArray(pinned) ? pinned : []) {
    if (known.has(id) && !pinnedOrder.includes(id)) pinnedOrder.push(id)
    else if (!known.has(id)) dropped.push(id)
  }
  const primary = pinnedOrder.map((id) => ({ ...known.get(id), pinned: true }))
  const more = [...known.values()].filter((plugin) => !pinnedOrder.includes(plugin.id)).map((plugin) => ({ ...plugin, pinned: false }))
  return { primary, more, dropped }
}

/**
 * 图钉开关：保持被固定的顺序（新固定的追加到末尾）。
 * @param {string[]} pinned - 现有固定顺序。
 * @param {string} id - 要切换的插件 id。
 * @returns {string[]} 新的固定顺序。
 */
export function togglePinned(pinned, id) {
  const list = Array.isArray(pinned) ? [...pinned] : []
  const index = list.indexOf(id)
  if (index >= 0) list.splice(index, 1)
  else list.push(id)
  return list
}

/**
 * 插件图标：没有自带图标时用首字母兜底（容器规范 §1.3 的 pluginGlyph）。
 * @param {{ id: string, label?: string, icon?: string }} plugin - 插件。
 * @returns {{ kind: 'icon', name: string } | { kind: 'letter', text: string }} 图标或兜底字母。
 */
export function pluginGlyph(plugin) {
  if (typeof plugin?.icon === 'string' && plugin.icon.length > 0) return { kind: 'icon', name: plugin.icon }
  const label = typeof plugin?.label === 'string' && plugin.label.length > 0 ? plugin.label : String(plugin?.id ?? '?')
  return { kind: 'letter', text: [...label][0].toUpperCase() }
}

/**
 * 打开一个插件页。
 * @param {string} id - 插件 id。
 * @param {{ id: string }[]} plugins - 已发现插件。
 * @param {{ containerEnabled?: boolean }} [options] - R2 的 ui.shell.pluginContainer 开关。
 * @returns {{ ok: true, key: string } | { ok: false, reason: 'plugin.unknown'|'container.off' }} 结果。
 */
export function openPluginPage(id, plugins, { containerEnabled = true } = {}) {
  if (!containerEnabled) return { ok: false, reason: 'container.off' }
  if (!(plugins ?? []).some((plugin) => plugin.id === id)) return { ok: false, reason: 'plugin.unknown' }
  return { ok: true, key: pluginKey(id) }
}

/**
 * 页头回链目标：插件页回「插件」一级入口，其它页回会话。
 * @param {string} key - 当前 main key。
 * @returns {{ label: string, key: string }} 返回目标。
 */
export function backLinkOf(key) {
  const id = pluginIdOf(key)
  if (id !== null) return { label: '插件', key: 'plugins' }
  return { label: '会话', key: 'conversation' }
}

/**
 * 降级矩阵（容器规范 §4）：分屏下只留 canvas；容器关掉显示占位；窄窗收 rail 但入口还在。
 * @param {{ splitMode?: number, containerEnabled?: boolean, containerWidth?: number }} [input] - 分屏档位、开关、容器宽。
 * @returns {{ rail: 'show'|'hide', panel: 'show'|'hide', canvas: 'show', placeholder: boolean }} 降级后的可见性。
 */
export function degradationOf({ splitMode = 1, containerEnabled = true, containerWidth = Infinity } = {}) {
  if (!containerEnabled) return { rail: 'hide', panel: 'hide', canvas: 'show', placeholder: true }
  if (splitMode > 1) return { rail: 'hide', panel: 'hide', canvas: 'show', placeholder: false }
  if (containerWidth < 560) return { rail: 'hide', panel: 'hide', canvas: 'show', placeholder: false }
  return { rail: 'show', panel: 'show', canvas: 'show', placeholder: false }
}
