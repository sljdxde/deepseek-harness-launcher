# One-shot: finish the roomier-spacing pass (remaining rules).
import io

p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

rep(u'.dsh-pm-rank-row{align-items:center;display:flex;gap:10px;min-height:44px;padding:7px 14px}',
    u'.dsh-pm-rank-row{align-items:center;display:flex;gap:12px;min-height:58px;padding:10px 18px}',
    'rank row')

rep(u'.dsh-pm-rank .rhead{display:flex;align-items:baseline;gap:8px;padding:11px 14px 9px}',
    u'.dsh-pm-rank .rhead{display:flex;align-items:baseline;gap:8px;padding:14px 18px 10px}',
    'rank head')

rep(u'.dsh-pm-hero{align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;display:flex;gap:14px;padding:18px 20px;background:radial-gradient(120% 150% at 100% 0%,color-mix(in srgb,var(--pm-accent) 11%,transparent),transparent 58%),radial-gradient(90% 120% at 0% 100%,color-mix(in srgb,#7c5cd6 7%,transparent),transparent 60%),var(--dsw-alias-bg-layer-1)}',
    u'.dsh-pm-hero{align-items:flex-start;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;display:flex;gap:20px;padding:24px 26px;background:radial-gradient(120% 150% at 100% 0%,color-mix(in srgb,var(--pm-accent) 11%,transparent),transparent 58%),radial-gradient(90% 120% at 0% 100%,color-mix(in srgb,#7c5cd6 7%,transparent),transparent 60%),var(--dsw-alias-bg-layer-1)}',
    'hero')

rep(u'.dsh-pm-hero-stats{gap:30px;margin-top:12px}',
    u'.dsh-pm-hero-stats{gap:40px;margin-top:16px}',
    'hero stats')

rep(u'.dsh-pm-catbar{align-items:center;display:flex;flex-wrap:wrap;gap:10px;padding-top:2px}',
    u'.dsh-pm-catbar{align-items:center;display:flex;flex-wrap:wrap;gap:12px;padding-top:4px}',
    'catbar')

rep(u'.dsh-pm-seg{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:15px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font:inherit;font-size:12px;gap:5px;height:30px;padding:0 10px}',
    u'.dsh-pm-seg{align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;font:inherit;font-size:12.5px;gap:6px;height:32px;padding:0 13px}',
    'seg')

rep(u'.dsh-pm-mainhead h2{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:700;margin:0;letter-spacing:-.01em}',
    u'.dsh-pm-mainhead h2{color:var(--dsw-alias-label-primary);font-size:18px;font-weight:700;margin:0;letter-spacing:-.01em}',
    'mainhead')

# 全屏切换：图标 + 状态 + 按钮
rep(u"    chev: '<path d=\"m6 3.5 4.5 4.5L6 12.5\"/>',",
    u"    chev: '<path d=\"m6 3.5 4.5 4.5L6 12.5\"/>',\n    expand: '<path d=\"M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10\"/>',\n    collapse: '<path d=\"M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5\"/>',",
    'icons')

rep(u"""    // 「更多分类」在原位展开（替代旧的下拉）；来源筛选：all | official | community | 自定义源 id。
    const [catExpanded, setCatExpanded] = React.useState(false)
    const [source, setSource] = React.useState('all')""",
    u"""    // 「更多分类」在原位展开（替代旧的下拉）；来源筛选：all | official | community | 自定义源 id。
    const [catExpanded, setCatExpanded] = React.useState(false)
    const [source, setSource] = React.useState('all')
    // 全屏：面板铺满窗口（记住上次选择；localStorage 不可用时静默降级）。
    const [fullscreen, setFullscreen] = React.useState(() => {
      try { return window.localStorage.getItem('dsh-plugin-manager:fullscreen') === '1' } catch { return false }
    })
    const toggleFullscreen = () => setFullscreen(value => {
      const next = !value
      try { window.localStorage.setItem('dsh-plugin-manager:fullscreen', next ? '1' : '0') } catch { /* 无 localStorage 就不记 */ }
      return next
    })""",
    'fullscreen state')

rep(u"""      h('div', { className: 'dsh-pm-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件中心' },
        h(Toasts, { store: toastStore }),
        h('div', { className: 'dsh-pm-header' },
          h('button', { className: 'dsh-pm-back', onClick: () => { if (closable) onClose() }, 'aria-label': '返回' }, '← 返回'),
          h('strong', null, '插件中心'),
          h('div', { className: 'dsh-pm-header-spacer' }),""",
    u"""      h('div', { className: `dsh-pm-page${fullscreen ? ' dsh-pm-full' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件中心' },
        h(Toasts, { store: toastStore }),
        h('div', { className: 'dsh-pm-header' },
          h('button', { className: 'dsh-pm-back', onClick: () => { if (closable) onClose() }, 'aria-label': '返回' }, '← 返回'),
          h('strong', null, '插件中心'),
          h('div', { className: 'dsh-pm-header-spacer' }),
          h('button', {
            className: 'dsh-pm-tool', onClick: toggleFullscreen,
            'aria-label': fullscreen ? '退出全屏' : '全屏显示',
            title: fullscreen ? '退出全屏' : '全屏显示（铺满窗口）',
          }, icon(fullscreen ? 'collapse' : 'expand', 14)),""",
    'fullscreen button')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('remaining spacing + fullscreen toggle done')
