# One-shot: make the AI search row a real search input, tighten hero/rank blocks,
# unify spacing.
import io

p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# ── 1) AI 检索行：白底真搜索框 ───────────────────────────────────────────
rep(u'''.dsh-pm-ai-bar{align-items:center;background:color-mix(in srgb,var(--pm-accent) 6%,transparent);border:1.5px solid color-mix(in srgb,var(--pm-accent) 45%,transparent);border-radius:14px;box-shadow:0 2px 10px color-mix(in srgb,var(--pm-accent) 10%,transparent);color:var(--pm-accent);display:flex;gap:10px;padding:13px 16px;transition:box-shadow .15s ease,border-color .15s ease}
.dsh-pm-ai-bar:focus-within{border-color:var(--pm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-accent) 16%,transparent)}''',
u'''.dsh-pm-ai-bar{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-tertiary);display:flex;gap:10px;height:46px;padding:0 8px 0 14px;transition:border-color .15s ease,box-shadow .15s ease}
/* 主搜索入口：聚焦时整条边框变品牌色并外发光，一眼能认出这是输入区 */
.dsh-pm-ai-bar:focus-within{border-color:var(--pm-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-accent) 14%,transparent);color:var(--pm-accent)}
.dsh-pm-ai-bar .spark{color:var(--pm-accent)}
.dsh-pm-ai-badge{background:color-mix(in srgb,var(--pm-accent) 12%,transparent);border-radius:5px;color:var(--pm-accent);flex:none;font-size:10.5px;font-weight:700;height:18px;line-height:18px;padding:0 6px}''',
   'ai bar restyle')

rep(u'''.dsh-pm-ai-bar .inp{background:none;border:0;color:var(--dsw-alias-label-primary);flex:1;font:inherit;font-size:13px;min-width:0;outline:none}
.dsh-pm-ai-bar .inp::placeholder{color:var(--dsw-alias-label-tertiary)}''',
u'''.dsh-pm-ai-bar .inp{background:none;border:0;color:var(--dsw-alias-label-primary);flex:1;font:inherit;font-size:13.5px;min-width:0;outline:none}
.dsh-pm-ai-bar .inp::placeholder{color:var(--dsw-alias-label-secondary)}''',
   'ai input')

# 按钮：实心品牌蓝、常蓝（空输入时降不透明度但仍是蓝色），高度撑满搜索框。
rep(u'''.dsh-pm-ai-go{background:var(--pm-accent);border:0;border-radius:15px;color:var(--pm-accent-fg);cursor:pointer;flex:none;font:inherit;font-size:12.5px;font-weight:600;height:30px;padding:0 16px;white-space:nowrap}
.dsh-pm-ai-go:hover:not(:disabled){filter:brightness(1.06)}
.dsh-pm-ai-go:disabled{cursor:default;opacity:.55}''',
u'''.dsh-pm-ai-go{background:var(--pm-accent);border:0;border-radius:10px;color:var(--pm-accent-fg);cursor:pointer;flex:none;font:inherit;font-size:13px;font-weight:650;height:34px;padding:0 20px;white-space:nowrap}
.dsh-pm-ai-go:hover:not(:disabled){filter:brightness(1.06)}
.dsh-pm-ai-go:disabled{cursor:default;opacity:.45}''',
   'ai go button')

# ── 2) hero 收紧：去重复浅蓝、padding 降一档 ─────────────────────────────
rep(u'.dsh-pm-hero{align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;display:flex;gap:20px;padding:24px 26px;background:radial-gradient(120% 150% at 100% 0%,color-mix(in srgb,var(--pm-accent) 11%,transparent),transparent 58%),radial-gradient(90% 120% at 0% 100%,color-mix(in srgb,#7c5cd6 7%,transparent),transparent 60%),var(--dsw-alias-bg-layer-1)}',
u'.dsh-pm-hero{align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;gap:18px;padding:20px 22px;background:radial-gradient(120% 150% at 100% 0%,color-mix(in srgb,var(--pm-accent) 9%,transparent),transparent 58%),var(--dsw-alias-bg-layer-1)}',
   'hero')

rep(u'.dsh-pm-hero-stats{gap:40px;margin-top:16px}',
u'.dsh-pm-hero-stats{gap:32px;margin-top:14px}',
   'hero stats')

# ── 3) 榜单行收紧 ───────────────────────────────────────────────────────
rep(u'.dsh-pm-rank-row{align-items:center;display:flex;gap:12px;min-height:58px;padding:10px 18px}',
u'.dsh-pm-rank-row{align-items:center;display:flex;gap:12px;min-height:48px;padding:8px 16px}',
   'rank row')

rep(u'.dsh-pm-rank-head{align-items:baseline;display:flex;gap:8px;padding:14px 18px 10px}',
u'.dsh-pm-rank-head{align-items:baseline;display:flex;gap:8px;padding:12px 16px 8px}',
   'rank head')

rep(u'.dsh-pm-cols2{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
u'.dsh-pm-cols2{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
   'cols2')

# ── 4) AI 结果面板同步收紧 + 与检索行贴合（margin-top 负值贴合边框） ─────
rep(u'.dsh-pm-ai{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;flex-direction:column;gap:10px;padding:16px 18px}',
u'.dsh-pm-ai{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;display:flex;flex-direction:column;gap:10px;padding:14px 16px}',
   'ai panel')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('search row + spacing restyled')
