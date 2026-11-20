import io
p = 'Plugins/DSHPluginManager/lib/index.js'
s = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, label):
    global s
    assert s.count(old) == 1, label + ' not unique: ' + str(s.count(old))
    s = s.replace(old, new)

# 1) 不再硬设 reasoningEffort：只在模型真的支持时才压到最低档。
#    上一版对所有路由硬写 'low'，导致 3/4 个模型直接报
#    "does not support reasoning effort low"。
rep(u'''async function streamSearchCompletion(llm, route, prompt, signal, onChunk) {
  // 推理型模型（如 group/free）会把 maxTokens 全花在思考上，正文 0 字符。
  // 这里显式把推理强度压到最低，并把输出上限提到 2000，保证 JSON 正文有空间。
  const call = await llm.prepareCall(
    { provider: route.provider, model: route.model, maxTokens: 2000 },
    signal,
    controls => ({ ...controls, reasoningEffort: 'low', maxTokens: 2000 }),
  );''',
u'''async function streamSearchCompletion(llm, route, prompt, signal, onChunk) {
  // 推理型模型会把 maxTokens 花在思考上、正文为空；但**不能对所有模型硬写
  // reasoningEffort**——不支持该参数的模型会直接报错（实测 4 个路由里 3 个如此）。
  // 这里用 configure 回调读模型元数据，只在它声明了 efforts 时才选最低档。
  const call = await llm.prepareCall(
    { provider: route.provider, model: route.model, maxTokens: 3000 },
    signal,
    (controls, model) => {
      const efforts = model && model.reasoning && Array.isArray(model.reasoning.efforts)
        ? model.reasoning.efforts
        : [];
      const lowest = efforts.length > 0 ? (efforts[0] && efforts[0].id) : undefined;
      return lowest === undefined
        ? { ...controls, maxTokens: 3000 }
        : { ...controls, reasoningEffort: lowest, maxTokens: 3000 };
    },
  );''',
   'prepareCall efforts')

rep(u'''    system: '你是插件检索排序器，只输出 JSON 对象，不输出任何其它文字。',
    maxTokens: 2000,''',
u'''    system: '你是插件检索排序器，按指定行格式输出，不要输出任何解释文字。',
    maxTokens: 3000,''',
   'stream maxTokens')

# 2) 超时 30s → 75s：推理模型首个正文 token 常常要 20-40 秒。
rep(u'''    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 30000);''',
u'''    const controller = new AbortController();
    // 推理模型的首个正文 token 常要 20-40 秒（思考过程不计入输出），
    // 30 秒会把还在思考的模型直接 abort 掉（实测 group/free 就是这样）。
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 75000);''',
   'timeout')

rep(u'''            await searchPluginsByDescriptionStream({ query: value?.query, llm: hostLlm, timeoutMs: Number(value?.timeoutMs) || 30000, onEvent: send });''',
u'''            await searchPluginsByDescriptionStream({ query: value?.query, llm: hostLlm, timeoutMs: Number(value?.timeoutMs) || 75000, onEvent: send });''',
   'route timeout')

# 3) 空正文（finish=aborted/max-tokens）换下一条路由时，事件里说明白。
rep(u'''      if (outcome.error) {
        lastError = outcome.error;
        emit('model-error', { model: `${route.provider}/${route.model}`, error: outcome.error });
        continue;
      }''',
u'''      if (outcome.error) {
        lastError = outcome.error;
        emit('model-error', {
          model: `${route.provider}/${route.model}`,
          error: outcome.error,
          finish: outcome.finish && outcome.finish.reason ? outcome.finish.reason.kind : null,
          next: ri + 1 < routes.length ? `换用下一个模型` : '所有模型都不可用',
        });
        continue;
      }''',
   'model-error detail')

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('reasoning + timeout fixed')
