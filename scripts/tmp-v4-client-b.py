# One-shot: varied icons per plugin name, stack spacing, AI bar prominence, and
# richer icon vocabulary.
import io

p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# ── 1) 图标词汇扩充 ──────────────────────────────────────────────────────
rep(u"    collapse: '<path d=\"M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5\"/>',",
u"""    collapse: '<path d="M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5"/>',
    palette: '<circle cx="8" cy="8" r="6"/><circle cx="6" cy="6" r="1"/><circle cx="10" cy="6" r="1"/><path d="M8 14c0-2 1.5-2.5 3-2.5"/>',
    file: '<path d="M4 1.5h5.5L13 5v9.5H4Z"/><path d="M9.5 1.5V5H13"/>',
    terminal: '<path d="m3 4.5 3.5 3.5L3 11.5"/><path d="M8 12h5"/>',
    shieldCheck: '<path d="M8 1.5 13.5 3.5v4c0 3.6-2.3 6-5.5 7-3.2-1-5.5-3.4-5.5-7v-4Z"/><path d="m5.8 7.7 1.6 1.6 2.8-3"/>',
    clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
    link: '<path d="M6.5 9.5 9.5 6.5"/><path d="M7 4.5 8.8 2.7a2.4 2.4 0 0 1 3.4 3.4L10.4 7.9"/><path d="M9 11.5 7.2 13.3a2.4 2.4 0 0 1-3.4-3.4L5.6 8.1"/>',
    wand: '<path d="M4 12 12 4"/><path d="M13 3.5 12.5 3 12 2.5"/><path d="M3.5 13 3 12.5 2.5 12"/>',
    book: '<path d="M2.5 3.5c1.8-1 3.7-1 5.5 0 1.8-1 3.7-1 5.5 0v9c-1.8-1-3.7-1-5.5 0-1.8-1-3.7-1-5.5 0Z"/><path d="M8 3.5v9"/>',
    share: '<circle cx="12" cy="4" r="1.8"/><circle cx="4" cy="8" r="1.8"/><circle cx="12" cy="12" r="1.8"/><path d="m5.6 7.1 4.8-2.4M5.6 8.9l4.8 2.4"/>',
    database: '<ellipse cx="8" cy="3.5" rx="5.5" ry="2"/><path d="M2.5 3.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9"/><path d="M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>',
    eye: '<path d="M1.5 8S3.8 3.8 8 3.8 14.5 8 14.5 8 12.2 12.2 8 12.2 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.8"/>',""",
   'icons')

# ── 2) 每个插件按名字派生图标（同插件恒定；未知分类才回落 puzzle） ────────
rep(u"""  const categoryHue = category => 'dsh-pm-hue-' + (CATEGORY_HUES[category] || 'neutral')""",
u"""  const categoryHue = category => 'dsh-pm-hue-' + (CATEGORY_HUES[category] || 'neutral')
  /* 插件名 → 图标关键词：命中哪个词就用哪个图标，让同一屏的图标不再千篇一律。
     顺序有意义：更具体的词（如 git / token / share）排在宽泛词前面。 */
  const NAME_ICON_RULES = [
    ['git', 'branch'], ['snapshot', 'branch'], ['repo', 'branch'],
    ['token', 'chart'], ['usage', 'chart'], ['cost', 'chart'], ['ledger', 'chart'],
    ['share', 'share'], ['export', 'share'], ['publish', 'share'],
    ['memory', 'book'], ['knowledge', 'book'], ['doc', 'book'], ['note', 'book'], ['wiki', 'book'],
    ['session', 'message'], ['chat', 'message'], ['chat', 'message'],
    ['search', 'search'], ['find', 'search'], ['query', 'search'],
    ['theme', 'palette'], ['color', 'palette'], ['style', 'palette'], ['skin', 'palette'],
    ['ui', 'palette'], ['sidebar', 'layers'], ['panel', 'layers'], ['deck', 'layers'],
    ['terminal', 'terminal'], ['shell', 'terminal'], ['exec', 'terminal'],
    ['browser', 'globe'], ['web', 'globe'], ['net', 'globe'], ['url', 'globe'], ['http', 'globe'],
    ['time', 'clock'], ['cron', 'clock'], ['schedule', 'clock'], ['timer', 'clock'],
    ['backup', 'archive'], ['snapshot', 'archive'], ['history', 'clock'],
    ['notify', 'bell'], ['notify', 'bell'], ['remind', 'bell'], ['alert', 'bell'],
    ['security', 'shieldCheck'], ['auth', 'shieldCheck'], ['secret', 'shieldCheck'], ['pass', 'shieldCheck'],
    ['vault', 'shieldCheck'], ['encrypt', 'shieldCheck'],
    ['data', 'database'], ['db', 'database'], ['sql', 'database'], ['store', 'database'],
    ['image', 'eye'], ['vision', 'eye'], ['photo', 'eye'], ['screenshot', 'eye'], ['preview', 'eye'],
    ['link', 'link'], ['folder', 'folder'], ['file', 'file'], ['workspace', 'folder'],
    ['voice', 'bell'], ['audio', 'bell'], ['speech', 'bell'],
    ['agent', 'robot'], ['bot', 'robot'], ['assistant', 'robot'],
    ['markdown', 'file'], ['md', 'file'], ['export', 'share'], ['import', 'download'],
    ['tool', 'gear'], ['kit', 'gear'], ['util', 'gear'],
  ]
  /** 名称/仓库按规则表派生图标；都不命中再按分类回落。 */
  const pluginIcon = (plugin) => {
    const text = `${plugin && plugin.repo ? plugin.repo : ''} ${plugin && plugin.name ? plugin.name : ''}`.toLowerCase()
    for (const [keyword, iconName] of NAME_ICON_RULES) {
      if (text.includes(keyword)) return iconName
    }
    return categoryIcon(plugin && plugin.category)
  }""",
   'plugin icon')

# ── 3) 卡片/榜单/AI 行/hero 全部走 pluginIcon ───────────────────────────
rep(u"""      return h('div', { className: 'dsh-pm-card', key: plugin.id, onClick: () => setDetail(plugin) },
        h('div', { className: 'dsh-pm-card-top' },
          h('div', { className: `dsh-pm-card-icon ${hue}` }, icon(categoryIcon(plugin.category), 17)),""",
u"""      return h('div', { className: 'dsh-pm-card', key: plugin.id, onClick: () => setDetail(plugin) },
        h('div', { className: 'dsh-pm-card-top' },
          h('div', { className: `dsh-pm-card-icon ${hue}` }, icon(pluginIcon(plugin), 17)),""",
   'card icon')

rep(u"""        h('p', { className: 'dsh-pm-card-sum' }, descOf(plugin, true) || descOf(plugin) || '暂无描述'),
        h('div', { className: 'dsh-pm-card-meta' },
          h('span', { className: `dsh-pm-card-chip ${hue}` }, icon(categoryIcon(plugin.category), 10), categoryLabel(plugin.category)),""",
u"""        h('p', { className: 'dsh-pm-card-sum' }, descOf(plugin, true) || descOf(plugin) || '暂无描述'),
        h('div', { className: 'dsh-pm-card-meta' },
          h('span', { className: `dsh-pm-card-chip ${hue}` }, icon(pluginIcon(plugin), 10), categoryLabel(plugin.category)),""",
   'card chip')

rep(u"""        h('div', { className: `dsh-pm-card-icon ${categoryHue(plugin.category)}`, style: { flex: 'none', width: '28px', height: '28px', borderRadius: '8px' } }, icon(categoryIcon(plugin.category), 14)),""",
u"""        h('div', { className: `dsh-pm-card-icon ${categoryHue(plugin.category)}`, style: { flex: 'none', width: '28px', height: '28px', borderRadius: '8px' } }, icon(pluginIcon(plugin), 14)),""",
   'rank icon')

rep(u"""        h('div', { className: `dsh-pm-card-icon ${categoryHue(hero.category)}`, style: { flex: 'none', width: '52px', height: '52px', borderRadius: '14px' } }, icon(categoryIcon(hero.category), 26)),""",
u"""        h('div', { className: `dsh-pm-card-icon ${categoryHue(hero.category)}`, style: { flex: 'none', width: '52px', height: '52px', borderRadius: '14px' } }, icon(pluginIcon(hero), 26)),""",
   'hero icon')

rep(u"""        h('div', { className: `dsh-pm-card-icon ${categoryHue(item.category)}`, style: { flex: 'none', width: '32px', height: '32px', borderRadius: '9px' } }, icon(categoryIcon(item.category), 16)),""",
u"""        h('div', { className: `dsh-pm-card-icon ${categoryHue(item.category)}`, style: { flex: 'none', width: '32px', height: '32px', borderRadius: '9px' } }, icon(pluginIcon(item), 16)),""",
   'ai row icon')

# 内置页的 puzzle 图标也换 pluginIcon（builtins 有名字可派生）。
rep(u"""          return h('div', { className: `dsh-pm-row${pluginOn === false && disableInfo ? ' dsh-pm-row-off' : ''}`, key: item.name },
            h('div', { className: 'dsh-pm-card-icon' }, icon('puzzle', 16)),""",
u"""          return h('div', { className: `dsh-pm-row${pluginOn === false && disableInfo ? ' dsh-pm-row-off' : ''}`, key: item.name },
            h('div', { className: 'dsh-pm-card-icon' }, icon(pluginIcon(item), 16)),""",
   'builtin icon')

# ── 4) 栈内层留白：视图内容不再贴死 .dsh-pm-main 的边缘 ─────────────────
rep(u"""          h('div', null, queueStrip, isCategoryView ? categoryView : discoverAllView))""",
u"""          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px', paddingTop: 2 } },
            queueStrip, isCategoryView ? categoryView : discoverAllView))""",
   'stack wrapper')

# ── 5) 检索行更醒目：实线边框 + 聚焦环 + 占位符写清动作 ──────────────────
rep(u'.dsh-pm-ai-bar{align-items:center;background:color-mix(in srgb,var(--pm-accent) 5%,transparent);border:1px dashed color-mix(in srgb,var(--pm-accent) 35%,transparent);border-radius:12px;color:var(--pm-accent);display:flex;gap:10px;padding:11px 14px}',
u'.dsh-pm-ai-bar{align-items:center;background:color-mix(in srgb,var(--pm-accent) 6%,transparent);border:1.5px solid color-mix(in srgb,var(--pm-accent) 45%,transparent);border-radius:14px;box-shadow:0 2px 10px color-mix(in srgb,var(--pm-accent) 10%,transparent);color:var(--pm-accent);display:flex;gap:10px;padding:13px 16px;transition:box-shadow .15s ease,border-color .15s ease}\n.dsh-pm-ai-bar:focus-within{border-color:var(--pm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-accent) 16%,transparent)}',
   'ai bar style')

# 分类条样式：折叠按钮 + 展开区第二行缩进。
rep(u'.dsh-pm-seg.more{background:color-mix(in srgb,var(--pm-accent) 8%,transparent);border-color:color-mix(in srgb,var(--pm-accent) 30%,transparent);border-style:dashed;color:var(--pm-accent)}',
u'.dsh-pm-seg.more{background:color-mix(in srgb,var(--pm-accent) 8%,transparent);border-color:color-mix(in srgb,var(--pm-accent) 40%,transparent);color:var(--pm-accent);font-weight:550}\n.dsh-pm-seg.more.expanded{background:var(--pm-accent);border-color:var(--pm-accent);color:var(--pm-accent-fg)}\n.dsh-pm-seg.more.expanded .n{color:var(--pm-accent-fg)}\n.dsh-pm-segs-open{padding:0 0 2px 10px;width:100%}',
   'seg more style')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('icons + spacing + ai bar done')
