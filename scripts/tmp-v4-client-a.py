# One-shot: client — raw-category bar with collapse, varied icons per plugin,
# stack spacing (inner wrapper), AI bar prominence, rank icon tiles.
import io

p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# ── 1) 分类条：原始分类，带数量，>8 个折叠，点「全部 N 类」在位展开 ────────
rep(u"""    // 分类条：服务端已把 30+ 个原始分类折成 6 组（counts 里带 label），这里直接按
    // 数量排序平铺——不再有「更多分类」展开（用户明确不要横向展开）。
    const orderedCategories = React.useMemo(
      () => [...categoryCounts.keys()].filter(Boolean).sort((a, b) => (categoryCounts.get(b) || 0) - (categoryCounts.get(a) || 0)),
      [categoryCounts]
    )
    const groupLabel = (id) => {
      const hit = Array.isArray(market?.counts) ? market.counts.find(item => item.name === id) : null
      return (hit && hit.label) || categoryLabel(id)
    }""",
u"""    // 分类条：原始分类按数量降序；超过 8 个时只平铺前 8 个，其余收进
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
    }""",
   'ordered categories')

# 分类条渲染：折叠按钮 + 展开区。
old_bar = u"""    const categoryBar = h('div', { className: 'dsh-pm-catbar' },
      h('div', { className: 'dsh-pm-segs' },
        categorySeg('all', '全部', market && market.allTotal ? market.allTotal : marketTotal, category === 'all'),
        orderedCategories.map(name => categorySeg(name, groupLabel(name), categoryCounts.get(name) || 0, category === name))),"""
new_bar = u"""    const categoryBar = h('div', { className: 'dsh-pm-catbar' },
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
            }, catExpanded ? '收起分类' : `全部 ${orderedCategories.length} 类`, icon('chev', 11)),
          : null),
      catExpanded ? h('div', { className: 'dsh-pm-segs dsh-pm-segs-open' },
        tailCategories.map(name => categorySeg(name, groupLabel(name), categoryCounts.get(name) || 0, category === name))) : null,"""
rep(old_bar, new_bar, 'category bar')

# 选中一个折叠里的分类后自动展开（否则选中态看不到）。
rep(u"""      onClick: () => setCategory(active ? 'all' : name),
      title: active ? '再点一次回到全部' : `只看「${label}」`,""",
u"""      onClick: () => setCategory(active ? 'all' : name),
      // 选中的分类若在折叠区里，自动展开折叠区让选中态可见。
      onMouseDown: () => { if (active === false && tailCategories.includes(name)) setCatExpanded(true) },
      title: active ? '再点一次回到全部' : `只看「${label}」`,""",
   'auto expand')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('category bar: raw + collapse')
