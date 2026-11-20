# One-shot: bigger panel, fullscreen toggle, roomier spacing.
import io

p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# ── 1) 面板尺寸 + 全屏态 ─────────────────────────────────────────────────
rep(u'.dsh-pm-page{--pm-accent:#3b82f6;--pm-accent-fg:#ffffff;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 20px 70px rgba(0,0,0,.28);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;font-size:13px;left:50%;max-height:86vh;max-width:1040px;position:fixed;top:50%;transform:translate(-50%,-50%);width:min(1040px,calc(100vw - 48px));z-index:2147483001}',
u'.dsh-pm-page{--pm-accent:#3b82f6;--pm-accent-fg:#ffffff;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.30);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;font-size:13px;height:min(920px,calc(100vh - 64px));left:50%;max-height:none;max-width:1240px;position:fixed;top:50%;transform:translate(-50%,-50%);width:min(1240px,calc(100vw - 64px));z-index:2147483001}\n/* 全屏：铺满窗口（无圆角、无边框），左右栏与内容按大屏留白 */\n.dsh-pm-page.dsh-pm-full{inset:0;border:0;border-radius:0;height:100vh;left:0;max-height:none;max-width:none;top:0;transform:none;width:100vw}',
   'page size')

# ── 2) 留白：左栏 / 内容区 / 卡片 / 分区 / 榜单 / 分类条 ────────────────
rep(u'.dsh-pm-rail{flex:none;width:150px;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:12px 8px;display:flex;flex-direction:column;gap:2px;overflow-y:auto}',
u'.dsh-pm-rail{flex:none;width:172px;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:16px 10px;display:flex;flex-direction:column;gap:3px;overflow-y:auto}',
   'rail')

rep(u'.dsh-pm-rail-item{align-items:center;background:none;border:0;border-radius:8px;box-sizing:border-box;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;flex:0 0 auto;font:inherit;font-size:12.5px;gap:9px;height:34px;padding:0 10px;text-align:left;width:100%}',
u'.dsh-pm-rail-item{align-items:center;background:none;border:0;border-radius:9px;box-sizing:border-box;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;flex:0 0 auto;font:inherit;font-size:13px;gap:10px;height:38px;padding:0 12px;text-align:left;width:100%}',
   'rail item')

rep(u'.dsh-pm-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;overflow-y:auto;padding:16px 18px 22px}',
u'.dsh-pm-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:20px;margin:0 auto;max-width:1360px;overflow-y:auto;padding:24px 28px 32px;width:100%}',
   'main padding')

rep(u'.dsh-pm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
u'.dsh-pm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
   'grid gap')

rep(u'.dsh-pm-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:8px;min-width:0;padding:12px 13px 11px;transition:border-color .16s ease,box-shadow .16s ease}',
u'.dsh-pm-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px 17px 15px;transition:border-color .16s ease,box-shadow .16s ease}',
   'card padding')

rep(u'.dsh-pm-card-sum{-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--dsw-alias-label-secondary);display:-webkit-box;font-size:12px;line-height:1.45;margin:0;min-height:2.9em;overflow:hidden}',
u'.dsh-pm-card-sum{-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--dsw-alias-label-secondary);display:-webkit-box;font-size:12.5px;line-height:1.5;margin:0;min-height:3em;overflow:hidden}',
   'card sum')

rep(u'.dsh-pm-card-name{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
u'.dsh-pm-card-name{color:var(--dsw-alias-label-primary);font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
   'card name')

rep(u'.dsh-pm-sec2{display:flex;flex-direction:column;gap:10px}',
u'.dsh-pm-sec2{display:flex;flex-direction:column;gap:12px}',
   'section gap')

rep(u'.dsh-pm-sechead2 h3{color:var(--dsw-alias-label-primary);font-size:13.5px;font-weight:700;margin:0}',
u'.dsh-pm-sechead2 h3{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:700;margin:0}',
   'section title')

rep(u'.dsh-pm-cols2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
u'.dsh-pm-cols2{display:grid;grid-template-columns:1fr 1fr;gap:16px}',
   'cols2 gap')

rep(u'.dsh-pm-rank-row{align-items:center;display:flex;gap:10px;min-height:52px;padding:7px 14px}',
u'.dsh-pm-rank-row{align-items:center;display:flex;gap:12px;min-height:58px;padding:10px 18px}',
   'rank row')

rep(u'.dsh-pm-rank .rhead{display:flex;align-items:baseline;gap:8px;padding:12px 16px 10px}',
u'.dsh-pm-rank .rhead{display:flex;align-items:baseline;gap:8px;padding:14px 18px 10px}',
   'rank head')

rep(u'.dsh-pm-hero{align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;gap:14px;padding:18px 20px;',
u'.dsh-pm-hero{align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;display:flex;gap:18px;padding:24px 26px;',
   'hero padding')

rep(u'.dsh-pm-hero-stats{gap:30px;margin-top:12px}',
u'.dsh-pm-hero-stats{gap:40px;margin-top:16px}',
   'hero stats')

rep(u'.dsh-pm-catbar{align-items:center;display:flex;flex-wrap:wrap;gap:10px;padding-top:2px}',
u'.dsh-pm-catbar{align-items:center;display:flex;flex-wrap:wrap;gap:12px;padding-top:4px}',
   'catbar gap')

rep(u'.dsh-pm-seg{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:15px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font:inherit;font-size:12px;gap:5px;height:30px;padding:0 10px}',
u'.dsh-pm-seg{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font:inherit;font-size:12.5px;gap:6px;height:32px;padding:0 13px}',
   'seg size')

rep(u'.dsh-pm-mainhead h2{color:var(--dsw-alias-label-primary);font-size:17px;font-weight:700;margin:0;letter-spacing:-.01em}',
u'.dsh-pm-mainhead h2{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:700;margin:0;letter-spacing:-.01em}',
   'main head')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('spacing + page size done')
