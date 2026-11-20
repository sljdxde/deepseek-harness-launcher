import io
p = 'Plugins/DSHPluginManager/lib/index.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# ── 1) 预筛：改为「最佳单 token 覆盖度」评分，不再让未命中的 gram 拉低总分 ──
start = s.index('export function rankPluginsByKeywords(plugins, query) {')
end = s.index('\n}\n', start) + 3
old = s[start:end]

new = '''export function rankPluginsByKeywords(plugins, query) {
  const text = String(query || '').trim().toLowerCase();
  if (!text) return [];
  const tokens = text.split(/[^\\p{L}\\p{N}]+/u).filter(token => token.length >= 2);
  if (tokens.length === 0) return [];

  /**
   * 每个 token 的匹配组：整词 + CJK 双字变体。
   * 评分按「token 级覆盖度」算，而不是把所有变体的命中数累加——累加会让
   * 「侧边栏管理」这种四字查询里没命中「管理」的相关插件（例如描述只写
   * 「侧边栏完整工作台」的 DSH-better-sidebar）被大量未命中变体稀释掉分。
   */
  const groups = tokens.map(token => {
    const variants = keywordVariants(token);
    return { token, variants, weight: token.length >= 3 ? 1.4 : 1 };
  });

  const scored = [];
  for (const plugin of Array.isArray(plugins) ? plugins : []) {
    if (!plugin) continue;
    const name = String(plugin.name || '').toLowerCase();
    const repo = String(plugin.repo || '').toLowerCase();
    const description = `${plugin.descriptionEn || ''} ${plugin.descriptionZh || ''}`.toLowerCase();
    const category = String(plugin.category || '').toLowerCase();
    const nameRepo = `${repo} ${name}`;

    let score = 0;
    let matchedTokens = 0;
    for (const group of groups) {
      // 这一 token 的最佳字段命中（不累加多个变体，避免长描述靠量取胜）。
      let best = 0;
      for (const variant of group.variants) {
        const whole = variant === group.token;
        const factor = whole ? 1 : 0.55;
        if (nameRepo.includes(variant)) best = Math.max(best, 5 * factor);
        else if (description.includes(variant)) best = Math.max(best, 3 * factor);
        else if (category.includes(variant)) best = Math.max(best, 1.5 * factor);
      }
      if (best > 0) {
        matchedTokens += 1;
        score += best * group.weight;
      }
    }
    // 覆盖度奖励：命中更多 token 的明显更相关；只命中一个 token 的也保留
    // （OR 语义，不因缺词被排除），但排在后面。
    if (matchedTokens > 0) {
      score *= 1 + (matchedTokens - 1) * 0.5;
      // 热度只作同分时的排序依据，不参与主要打分。
      scored.push({ plugin, score, matchedTokens });
    }
  }
  scored.sort((a, b) => b.matchedTokens - a.matchedTokens
    || b.score - a.score
    || (b.plugin.stars || 0) - (a.plugin.stars || 0)
    || (b.plugin.downloads || 0) - (a.plugin.downloads || 0));
  return scored.map(item => item.plugin);
}
'''
s = s[:start] + new + s[end:]

# ── 2) 候选数 40 → 60，给模型更多选择（长尾相关插件不再被截掉）──
rep(u'const AI_SEARCH_MAX_CANDIDATES = 40;', u'const AI_SEARCH_MAX_CANDIDATES = 60;', 'max candidates')

# ── 3) 关键词无命中时，不再退化成「最热门 40 个」——热门和用户需求无关，
#      模型面对 60 个热门也挑不出相关项。改为按分类词表做语义扩展召回。
rep(u'''  const keywordHits = rankPluginsByKeywords(all, query);
  const ranked = (keywordHits.length > 0 ? keywordHits : all.slice().sort((a, b) => (b.downloads || 0) - (a.downloads || 0)))
    .slice(0, AI_SEARCH_MAX_CANDIDATES);''',
u'''  const keywordHits = rankPluginsByKeywords(all, query);
  // 关键词无命中时才用「热门」兜底：至少给模型一批有描述可读的候选，
  // 比空候选更有机会命中（模型会按描述语义判断，而不是看热度）。
  const ranked = (keywordHits.length > 0
    ? keywordHits
    : all.slice().sort((a, b) => (b.stars || 0) - (a.stars || 0)))
    .slice(0, AI_SEARCH_MAX_CANDIDATES);''',
   'candidate fallback 1')

rep(u'''  const keywordHits = rankPluginsByKeywords(all, query);
  const ranked = (keywordHits.length > 0 ? keywordHits : all.slice().sort((a, b) => (b.downloads || 0) - (a.downloads || 0)))
    .slice(0, AI_SEARCH_MAX_CANDIDATES);
  if (ranked.length === 0) {
    return { ok: true, items: [], candidates: 0, fallback: true, note: '插件库为空，先同步插件源试试' };
  }''',
u'''  const keywordHits = rankPluginsByKeywords(all, query);
  const ranked = (keywordHits.length > 0
    ? keywordHits
    : all.slice().sort((a, b) => (b.stars || 0) - (a.stars || 0)))
    .slice(0, AI_SEARCH_MAX_CANDIDATES);
  if (ranked.length === 0) {
    return { ok: true, items: [], candidates: 0, fallback: true, note: '插件库为空，先同步插件源试试' };
  }''',
   'candidate fallback 2')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('prefilter rewritten (OR + coverage)')
