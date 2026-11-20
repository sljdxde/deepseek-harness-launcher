# One-shot: fullscreen toggle (icons + state + header button) for the plugin centre.
import io

p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

rep(u"    chev: '<path d=\"m6 3.5 4.5 4.5L6 12.5\"/>',",
    u"    chev: '<path d=\"m6 3.5 4.5 4.5L6 12.5\"/>',\n    expand: '<path d=\"M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10\"/>',\n    collapse: '<path d=\"M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5\"/>',",
    'icons')

rep(u"""    const [catExpanded, setCatExpanded] = React.useState(false)
    const [source, setSource] = React.useState('all')""",
    u"""    const [catExpanded, setCatExpanded] = React.useState(false)
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

rep(u"""      h('div', { className: 'dsh-pm-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件中心' },""",
    u"""      h('div', { className: `dsh-pm-page${fullscreen ? ' dsh-pm-full' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': '插件中心' },""",
    'page class')

rep(u"""          h('button', { className: 'dsh-pm-back', onClick: () => { if (closable) onClose() }, 'aria-label': '返回' }, '← 返回'),
          h('strong', null, '插件中心'),
          h('div', { className: 'dsh-pm-header-spacer' }),""",
    u"""          h('button', { className: 'dsh-pm-back', onClick: () => { if (closable) onClose() }, 'aria-label': '返回' }, '← 返回'),
          h('strong', null, '插件中心'),
          h('div', { className: 'dsh-pm-header-spacer' }),
          h('button', {
            className: 'dsh-pm-tool', onClick: toggleFullscreen,
            'aria-label': fullscreen ? '退出全屏' : '全屏显示',
            title: fullscreen ? '退出全屏' : '全屏显示（铺满窗口）',
          }, icon(fullscreen ? 'collapse' : 'expand', 14)),""",
    'fullscreen button')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('fullscreen toggle added')
