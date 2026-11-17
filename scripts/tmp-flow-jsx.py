import io
p = 'Plugins/DSHPluginManager/client/client.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# 1) 过程区：只渲染最近 3 条，单行（步骤名 + 详情），更早的淡化
rep(u'''          // 时间线：每一步一行，模型输出单独用等宽字体展示。
          aiLog.length > 0
            ? h('div', {
                className: 'dsh-pm-ai-steps', role: 'log', 'aria-live': 'polite',
                ref: node => { aiLogRef.current = node; if (node) node.scrollTop = node.scrollHeight },
              }, aiLog.map((entry, i) => h('div', { key: i, className: `dsh-pm-ai-step ${stepState(entry, i)}` },
                h('span', { className: 'dot', 'aria-hidden': true }),
                h('div', { className: 'body' },
                  h('h4', { className: 'name' }, AI_STEP_LABELS[entry.step] || entry.step),
                  h('div', { className: `detail${entry.step === 'model-output' || entry.step === 'model-delta' ? ' mono' : ''}` }, entry.text)))))
            : null,''',
u'''          // 逐条流动：只渲染最近 3 条（更早的淡出，不堆叠占空间），
          // 每条单行显示「步骤名 + 详情」，详情省略、hover 看全文。
          aiLog.length > 0
            ? h('div', { className: 'dsh-pm-ai-steps', role: 'log', 'aria-live': 'polite' },
                aiLog.slice(-3).map((entry, i, arr) => h('div', {
                  key: aiLog.length - arr.length + i,
                  className: `dsh-pm-ai-step ${stepState(entry, aiLog.length - arr.length + i)}${i < arr.length - 1 ? ' old' : ''}`,
                },
                  h('span', { className: 'dot', 'aria-hidden': true }),
                  h('div', { className: 'line' },
                    h('span', { className: 'name' }, AI_STEP_LABELS[entry.step] || entry.step),
                    h('span', {
                      className: `detail${entry.step === 'model-output' || entry.step === 'model-delta' ? ' mono' : ''}`,
                      title: entry.text,
                    }, entry.text)))))
            : null,''',
   'steps jsx')

# 2) 搜索按钮：检索中显示转圈 + 文案
rep(u'''      h('button', { type: 'submit', className: 'dsh-pm-ai-go', disabled: aiLoading || !aiQuery.trim() }, aiLoading ? '检索中…' : '找插件'))''',
u'''      h('button', { type: 'submit', className: 'dsh-pm-ai-go', disabled: aiLoading || !aiQuery.trim() },
        aiLoading ? h(React.Fragment, null, h('span', { className: 'spin', 'aria-hidden': true }), '检索中') : h(React.Fragment, null, icon('search', 13), '找插件')))''',
   'search button')

# 3) stepState 不再需要最后一条判定（用索引即可）——保持原样但兼容
rep(u'''    const stepState = (entry, index) => {
      if (entry.step === 'error' || entry.step === 'model-error') return 'bad'
      if (entry.step === 'fallback') return 'warn'
      if (aiLoading && index === aiLog.length - 1) return 'live'
      return 'ok'
    }''',
u'''    const stepState = (entry, index) => {
      if (entry.step === 'error' || entry.step === 'model-error') return 'bad'
      if (entry.step === 'fallback') return 'warn'
      // 最后一条且仍在检索 → 呼吸态（表示「正在做这件事」）
      if (aiLoading && index === aiLog.length - 1) return 'live'
      return 'ok'
    }''',
   'stepState')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('flow jsx done')
