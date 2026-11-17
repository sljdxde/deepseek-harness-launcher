# One-shot: restructure the client so every discover block is a DIRECT child of
# .dsh-pm-main (gap 24px). Currently a wrapper div swallows the gap — the real
# cause of "blocks stuck together". Replace the discover shell accordingly.
import io

p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# ── 1) CSS：.dsh-pm-main gap 24px；区块内部自己控制间距 ───────────────────
rep(u'.dsh-pm-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:20px;margin:0 auto;max-width:1360px;overflow-y:auto;padding:24px 28px 32px;width:100%}',
u'.dsh-pm-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:24px;margin:0 auto;max-width:1360px;overflow-y:auto;padding:26px 30px 40px;width:100%}',
   'main gap')

rep(u'.dsh-pm-catbar{align-items:center;display:flex;flex-wrap:wrap;gap:12px;padding-top:4px}',
u'.dsh-pm-catbar{align-items:flex-start;display:flex;flex-wrap:wrap;gap:12px;padding:0}',
   'catbar')

rep(u'.dsh-pm-segs{display:inline-flex;flex:1 1 0;flex-wrap:nowrap;gap:5px;min-width:0;overflow-x:auto;scrollbar-width:none}',
u'.dsh-pm-segs{display:flex;flex-wrap:wrap;gap:8px;min-width:0;flex:1 1 auto;row-gap:8px}',
   'segs wrap')

rep(u'.dsh-pm-segs::-webkit-scrollbar{display:none}\n', u'', 'scrollbar rule')

rep(u'.dsh-pm-seg{flex:none}',
u'.dsh-pm-seg{flex:none;height:34px;padding:0 14px;border-radius:17px}',
   'seg size')

rep(u'.dsh-pm-segs-open{padding:0 0 2px 10px;width:100%}',
u'.dsh-pm-segs-open{padding:0;width:100%;margin-top:2px}',
   'segs open')

rep(u'.dsh-pm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
u'.dsh-pm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}',
   'grid auto')

# ── 2) 结构：把 discoverTab 的「中间 wrapper」改成 Fragment ──────────────
rep(u"""      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, queueStrip, isCategoryView ? categoryView : discoverAllView))""",
u"""      h(React.Fragment, null, queueStrip, isCategoryView ? categoryView : discoverAllView))""",
   'fragment')

# ── 3) discoverAllView / categoryView 的外层 div 也改成 Fragment ─────────
rep(u"""    const discoverAllView = h('div', null,
      h('div', { className: 'dsh-pm-mainhead' },""",
u"""    const discoverAllView = h(React.Fragment, null,
      h('div', { className: 'dsh-pm-mainhead' },""",
   'discover fragment')

rep(u"""    const categoryView = h('div', null,
      h('div', { className: 'dsh-pm-crumbs' },""",
u"""    const categoryView = h(React.Fragment, null,
      h('div', { className: 'dsh-pm-crumbs' },""",
   'category fragment')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('structure fixed: blocks are direct children')
