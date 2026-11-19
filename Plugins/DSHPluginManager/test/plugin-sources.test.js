// 多插件源 + 国内加速的后端单测：全部走注入的假 fetch / 临时 DSH_HOME，
// 不发真实网络请求。test.sh 会跑（node --test）。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
// 这些测试都要改 process.env.DSH_HOME 并写同一个临时目录布局，必须串行：
// node:test 默认并发跑同一文件里的用例，环境会被互相踩（本文件独占 env，
// 其余测试文件不受影响）。
//
// serialTest 同时接受 (name, fn) 和 (name, options, fn)。
// 之前它只写成 (name, options, fn)，而下面 21 处调用全是 (name, fn)：
// 于是 options 收到了函数、fn 是 undefined，展开函数得到 {}，
// test(name, { concurrency: false }, undefined) 建出一个**没有函数体**的空测试，
// 直接秒过 —— 全部断言从未执行过（分类 bug 长期没被测出来就是这个原因）。
const serialTest = (name, options, fn) => {
  if (typeof options === 'function') return test(name, { concurrency: false }, options);
  return test(name, { ...options, concurrency: false }, fn);
};
import {
  DEFAULT_SOURCE_ID,
  queryMarketplace,
  marketGroupOf,
  marketGroupLabel,
  rankPluginsByKeywords,
  buildPluginSearchPrompt,
  parseSearchPicks,
  searchPluginsByDescription,
  readPreferredSearchRoute,
  readPreferredSearchRoutes,
  writePreferredSearchRoute,
  resolveSearchRoutes,
  readSourcesConfig,
  addPluginSource,
  removePluginSource,
  setPluginSourceEnabled,
  sourceEntryToPlugin,
  parseSourceIndex,
  fetchSourceIndex,
  aggregateCachedSources,
  refreshPluginSources,
  readSourceRefreshProgress,
  readMarketplaceAggregated,
  readMirrorStateCached,
  resetMirrorCache,
  mirrorMapURL,
  pnpmEnvironment,
} from '../lib/index.js';

/** 假 fetch：按 URL 前缀分发固定响应；记录调用过的 URL 供断言。 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    for (const [prefix, respond] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return respond(String(url));
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

/** 用临时 DSH_HOME 跑一段代码（隔离源配置与缓存）。 */
async function withTempHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-sources-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  resetMirrorCache();
  try {
    return await run(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    resetMirrorCache();
    await rm(home, { recursive: true, force: true });
  }
}

serialTest('源配置：默认只有内置源，内置源不可删除但可停用', async () => {
  await withTempHome(async () => {
    const config = await readSourcesConfig();
    assert.equal(config.sources.length, 1);
    assert.equal(config.sources[0].id, DEFAULT_SOURCE_ID);
    assert.equal(config.sources[0].builtin, true);

    const removed = await removePluginSource(DEFAULT_SOURCE_ID);
    assert.equal(removed.ok, false, '默认源拒绝删除');

    const disabled = await setPluginSourceEnabled(DEFAULT_SOURCE_ID, false);
    assert.equal(disabled.ok, true);
    const after = await readSourcesConfig();
    assert.equal(after.sources.find(item => item.id === DEFAULT_SOURCE_ID).enabled, false);
  });
});

serialTest('添加源：git/index 校验、URL 归一、重复幂等', async () => {
  await withTempHome(async () => {
    const badKind = await addPluginSource({ kind: 'ftp', url: 'x' });
    assert.equal(badKind.ok, false);
    const badIndex = await addPluginSource({ kind: 'index', url: 'ftp://x' });
    assert.equal(badIndex.ok, false);
    const badGit = await addPluginSource({ kind: 'git', url: 'https://gitlab.com/a/b' });
    assert.equal(badGit.ok, false);

    const added = await addPluginSource({ kind: 'git', url: 'https://github.com/Community/Registry.git' });
    assert.equal(added.ok, true);
    assert.equal(added.source.url, 'github:Community/Registry', 'https 地址归一为 github: 短写');
    assert.equal(added.source.id, 'community-registry');

    const again = await addPluginSource({ kind: 'git', url: 'github:community/registry' });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyAdded, true, '重复 URL 幂等');

    const addedIndex = await addPluginSource({ kind: 'index', url: 'https://example.com/dsh/index.json' });
    assert.equal(addedIndex.ok, true);
    assert.match(addedIndex.source.id, /^src-/);

    const config = await readSourcesConfig();
    assert.equal(config.sources.length, 3, '内置 + 2 个自定义');
  });
});

serialTest('删除用户源：删配置也删缓存文件', async () => {
  await withTempHome(async (home) => {
    const added = await addPluginSource({ kind: 'index', url: 'https://example.com/a.json' });
    const cacheDir = join(home, 'plugin-manager', 'sources-cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${added.source.id}.json`), JSON.stringify({ fetchedAt: 't', plugins: [] }));
    const removed = await removePluginSource(added.source.id);
    assert.equal(removed.ok, true);
    const config = await readSourcesConfig();
    assert.equal(config.sources.find(item => item.id === added.source.id), undefined);
    await assert.rejects(readFile(join(cacheDir, `${added.source.id}.json`)), '缓存文件也删掉');
  });
});

serialTest('sourceEntryToPlugin：合法条目归一 + 缺 name 拒绝', () => {
  const plugin = sourceEntryToPlugin({
    id: 'tokenledger', name: 'yumc/dsh-tokenledger', category: 'data',
    description: { en: 'tokens', zh: '记账' }, stars: '540', downloads: 165000, verified: true,
  }, 'my-src');
  assert.equal(plugin.id, 'my-src:tokenledger');
  assert.equal(plugin.source, 'my-src');
  assert.equal(plugin.author, 'yumc');
  assert.equal(plugin.stars, 540);
  assert.equal(plugin.verified, true);
  assert.equal(plugin.descriptionZh, '记账');
  assert.equal(sourceEntryToPlugin({ no_name: true }, 'x'), null);
  assert.equal(sourceEntryToPlugin(null, 'x'), null);
});

serialTest('parseSourceIndex：结构校验', () => {
  assert.deepEqual(parseSourceIndex({ version: 1, plugins: [{}] }), [{}]);
  assert.equal(parseSourceIndex({ no_plugins: true }), null);
  assert.equal(parseSourceIndex(null), null);
  assert.equal(parseSourceIndex('str'), null);
});

serialTest('fetchSourceIndex：git 源依次尝试 HEAD/main/master，index 源直接取 URL', async () => {
  const { calls, fetchImpl } = fakeFetch({
    'https://raw.githubusercontent.com/o/r/HEAD/index.json': () => ({ ok: false, status: 404 }),
    'https://raw.githubusercontent.com/o/r/main/index.json': () => ({
      ok: true, status: 200, json: async () => ({ version: 1, plugins: [{ name: 'a/b' }] }),
    }),
  });
  const git = await fetchSourceIndex({ id: 's1', kind: 'git', url: 'github:o/r' }, { fetch: fetchImpl });
  assert.equal(git.error, undefined);
  assert.equal(git.plugins.length, 1);
  assert.ok(calls.includes('https://raw.githubusercontent.com/o/r/HEAD/index.json'), '先试 HEAD');
  assert.ok(calls.includes('https://raw.githubusercontent.com/o/r/main/index.json'), 'HEAD 失败再试 main');

  const direct = await fetchSourceIndex({ id: 's2', kind: 'index', url: 'https://mirror.example/i.json' }, {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ plugins: [] }) }),
  });
  assert.deepEqual(direct.plugins, []);

  const broken = await fetchSourceIndex({ id: 's3', kind: 'index', url: 'https://mirror.example/bad.json' }, {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }),
  });
  assert.match(broken.error, /plugins/);
});

serialTest('aggregateCachedSources + refreshPluginSources：缓存聚合、失败隔离、进度收尾', async () => {
  await withTempHome(async () => {
    await addPluginSource({ kind: 'index', url: 'https://good.example/i.json' });
    const bad = await addPluginSource({ kind: 'index', url: 'https://bad.example/i.json' });
    const { fetchImpl } = fakeFetch({
      'https://good.example/i.json': () => ({
        ok: true, status: 200,
        json: async () => ({ version: 1, plugins: [{ name: 'good/a', category: 'tool' }, { name: 'good/b' }] }),
      }),
      'https://bad.example/i.json': () => ({ ok: false, status: 500 }),
    });
    // 内置默认源会 clone 整个 awesome-dsh-plugin 仓库——单测里必须替换掉，
    // 否则测试会发真实网络请求并挂住（之前就是这样卡住的）。
    const refreshMarketplace = async () => ({ count: 0, official: 0, categories: [], indexedAt: null });

    const summary = await refreshPluginSources({ fetch: fetchImpl, refreshMarketplace });
    assert.equal(summary.sources, 3, '默认源 + 2 个自定义');
    assert.equal(summary.plugins, 2);
    assert.ok(summary.errors.some(line => line.startsWith('bad.example') || line.includes('src-')), '坏源单独报错');
    const progress = readSourceRefreshProgress();
    assert.equal(progress.active, false, '刷新结束进度收尾');
    assert.ok(progress.finishedAt);
    assert.equal(progress.results.length, 3);

    // 坏源失败不写缓存；好源聚合可见。
    const aggregated = await aggregateCachedSources();
    assert.deepEqual(aggregated.plugins.map(item => item.name), ['good/a', 'good/b']);
    const states = new Map(aggregated.perSource.map(item => [item.id, item.state]));
    assert.equal(states.get(bad.source.id), 'empty', '失败的源没有缓存，状态 empty');

    // 聚合读接口：默认源离线（无主索引）仍 ok=false，但自定义源插件在列。
    const market = await readMarketplaceAggregated();
    assert.equal(market.ok, false);
    assert.equal(market.plugins.some(item => item.name === 'good/a'), true);
    assert.equal(market.sources.length, 2);
  });
});

serialTest('setPluginSourceEnabled=false 后：聚合跳过该源', async () => {
  await withTempHome(async () => {
    const added = await addPluginSource({ kind: 'index', url: 'https://off.example/i.json' });
    const { fetchImpl } = fakeFetch({
      'https://off.example/i.json': () => ({
        ok: true, status: 200, json: async () => ({ plugins: [{ name: 'off/x' }] }),
      }),
    });
    await refreshPluginSources({ fetch: fetchImpl, refreshMarketplace: async () => ({ count: 0, official: 0, categories: [], indexedAt: null }) });
    await setPluginSourceEnabled(added.source.id, false);
    const aggregated = await aggregateCachedSources();
    assert.deepEqual(aggregated.plugins, [], '停用的源不参与聚合');
    assert.equal(aggregated.perSource.find(item => item.id === added.source.id).state, 'disabled');
  });
});

serialTest('mirrorMapURL：null 表直连、registry 映射、幂等', () => {
  assert.equal(mirrorMapURL('https://registry.npmjs.org/x', null), 'https://registry.npmjs.org/x');
  const table = [{ match: 'https://registry.npmjs.org/', replace: 'https://registry.npmmirror.com/' }];
  assert.equal(mirrorMapURL('https://registry.npmjs.org/x', table), 'https://registry.npmmirror.com/x');
  assert.equal(mirrorMapURL('https://registry.npmmirror.com/x', table), 'https://registry.npmmirror.com/x');
});

serialTest('pnpmEnvironment：关闭时原 env，打开时同时注入 npm/pnpm 两个前缀的 registry', async () => {
  const previous = process.env.DSH_PORT;
  process.env.DSH_PORT = '3999';
  try {
    const { fetchImpl } = fakeFetch({
      // 镜像插件不存在：fetch 抛错 → 按「关闭」处理
    });
    const off = await pnpmEnvironment({ fetch: async () => { throw new Error('no plugin'); } });
    assert.equal(off.npm_config_registry, undefined);
    assert.equal(off.pnpm_config_registry, undefined);

    const on = await pnpmEnvironment({
      fetch: async () => ({
        ok: true, status: 200,
        json: async () => ({ enabled: true, table: [{ match: 'https://registry.npmjs.org/', replace: 'https://registry.npmmirror.com/', kind: 'registry' }] }),
      }),
    });
    assert.equal(on.npm_config_registry, 'https://registry.npmmirror.com/');
    // pnpm 11+ 只认 pnpm_config_*：只给 npm 的那个前缀时，pnpm install 仍然直连 npmjs。
    assert.equal(on.pnpm_config_registry, 'https://registry.npmmirror.com/');
  } finally {
    if (previous === undefined) delete process.env.DSH_PORT;
    else process.env.DSH_PORT = previous;
    resetMirrorCache();
  }
});

serialTest('readMirrorStateCached：镜像插件不可用按关闭；注入 fetch 时不缓存', async () => {
  resetMirrorCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('refused');
  };
  const first = await readMirrorStateCached({ fetch: fetchImpl });
  assert.equal(first.enabled, false);
  assert.equal(first.table, null);
  const second = await readMirrorStateCached({ fetch: fetchImpl });
  assert.equal(second.enabled, false);
  // 注入 fetch 时每次都真发请求：缓存是给生产路径省往返的，
  // 注入方（单测）要的是自己那份确定答案，不能被上一个用例缓存的状态污染。
  assert.equal(calls, 2, '注入 fetch 时不走缓存');
  resetMirrorCache();
});

serialTest('queryMarketplace：服务端分页 + 搜索 + 分类 + 排序 + 榜单', async () => {
  await withTempHome(async (home) => {
    // 直接写市场主索引（模拟已同步过默认源）。
    const marketDir = join(home, 'plugin-market');
    await mkdir(marketDir, { recursive: true });
    const plugins = []
    for (let i = 0; i < 130; i++) {
      plugins.push({
        id: 'p' + i, name: 'pkg-' + i, repo: 'o/pkg-' + i, author: 'o',
        category: i % 2 === 0 ? 'tool' : 'data',
        descriptionEn: i === 7 ? 'unique needle plugin' : 'plugin ' + i,
        stars: i, downloads: 1000 - i, addedDate: '2026-01-01',
      })
    }
    await writeFile(join(marketDir, 'index.json'), JSON.stringify({
      version: 2, indexedAt: new Date().toISOString(), categories: ['tool', 'data'], plugins,
    }))

    // 第一页：默认 60 条、按星标降序、总数是全量。
    const page1 = await queryMarketplace({});
    assert.equal(page1.total, 130);
    assert.equal(page1.plugins.length, 60);
    assert.equal(page1.plugins[0].name, 'pkg-129', '默认按星标降序');
    assert.equal(page1.counts.find(item => item.name === 'tool').count, 65);

    // 第二页：offset 生效且不与第一页重叠。
    const page2 = await queryMarketplace({ offset: 60 });
    assert.equal(page2.plugins[0].name, 'pkg-69');
    assert.ok(!page1.plugins.some(item => item.id === page2.plugins[0].id), '两页不重叠');

    // 分类过滤 + 下载排序。
    const dataOnly = await queryMarketplace({ category: 'data', sort: 'downloads' });
    assert.equal(dataOnly.total, 65);
    assert.ok(dataOnly.plugins.every(item => item.category === 'data'));
    assert.equal(dataOnly.plugins[0].name, 'pkg-1', '下载量最高的是 pkg-1（1000-1）');

    // 搜索：命中描述里的 needle。
    const search = await queryMarketplace({ q: 'needle' });
    assert.equal(search.total, 1);
    assert.equal(search.plugins[0].name, 'pkg-7');

    // 榜单与推荐位始终来自全量（不受当前筛选影响）。
    assert.equal(search.topDownloads.length, 5);
    assert.equal(search.topDownloads[0].name, 'pkg-0', '下载榜第一是 pkg-0（1000）');
    assert.equal(search.topStars[0].name, 'pkg-129', '星标榜第一是 pkg-129');
    assert.equal(search.featured.length, 5);
  })
})

serialTest('marketGroupOf：30+ 个原始分类折成 6 组，未命中的归 other', () => {
  const cases = {
    ui: 'ui', panel: 'ui', theme: 'ui', market: 'ui',
    session: 'session', memory: 'session', notify: 'session',
    tools: 'tools', tool: 'tools', dev: 'tools', cli: 'tools', skill: 'tools', search: 'tools',
    workflow: 'auto', auto: 'auto', mcp: 'auto', agent: 'auto', gateway: 'auto', prompt: 'auto',
    data: 'data', storage: 'data', usage: 'data', model: 'data',
    browser: 'other', web: 'other', image: 'other', voice: 'other', official: 'other',
    '': 'other', undefined: 'other',
  };
  for (const [category, group] of Object.entries(cases)) {
    assert.equal(marketGroupOf(category), group, `category=${String(category)}`);
  }
  assert.equal(marketGroupLabel('ui'), '界面');
  assert.equal(marketGroupLabel('nope'), '其他');
});

serialTest('queryMarketplace：分类条的数字必须等于点进去看到的数量', async () => {
  await withTempHome(async (home) => {
    const marketDir = join(home, 'plugin-market');
    await mkdir(marketDir, { recursive: true });
    const plugins = [];
    const add = (category, n) => {
      for (let i = 0; i < n; i++) {
        plugins.push({
          id: `${category}-${i}`, name: `${category}-plugin-${i}`, repo: `o/${category}-${i}`,
          author: 'o', category, descriptionEn: `${category} plugin ${i}`,
          stars: 10 - i, downloads: 100 - i, addedDate: '2026-01-01',
        });
      }
    };
    // 故意混着「既是原始分类、又是分组 id」的 ui/tools/session，和只在原始分类里
    // 出现的 workflow/dev/usage —— 后者正是用户报 bug 的那批：胶囊上写着数字，
    // 点进去却一个都没有。
    add('ui', 8); add('session', 5); add('tools', 3); add('workflow', 4); add('dev', 2); add('usage', 1);
    await writeFile(join(marketDir, 'index.json'), JSON.stringify({
      version: 2, indexedAt: new Date().toISOString(), categories: ['ui', 'session', 'tools', 'workflow', 'dev', 'usage'], plugins,
    }));

    const all = await queryMarketplace({});
    const counts = new Map(all.counts.map(item => [item.name, item.count]));
    assert.equal(counts.get('ui'), 8, 'ui 的计数');
    assert.equal(counts.get('workflow'), 4, 'workflow 的计数（原始分类）');
    assert.equal(counts.get('usage'), 1, 'usage 的计数');

    // ── 核心不变量：胶囊上写 N，点进去就必须是 N 个 ──
    for (const [name, count] of counts) {
      const filtered = await queryMarketplace({ category: name });
      assert.equal(filtered.total, count, `分类 ${name}：计数 ${count} 与筛选结果一致`);
      assert.equal(filtered.plugins.length, Math.min(count, 60), `分类 ${name}：首页返回数量一致`);
    }

    // 分类视图（分组）同样要能筛出东西：group=auto 覆盖 workflow 等原始分类。
    const autoOnly = await queryMarketplace({ group: 'auto' });
    assert.equal(autoOnly.total, 4, 'group=auto 命中 workflow');
    assert.ok(autoOnly.plugins.every(plugin => marketGroupOf(plugin.category) === 'auto'));

    // 未知分类返回 0 而不是报错（前端会显示「暂无插件」）。
    const unknown = await queryMarketplace({ category: 'no-such-category' });
    assert.equal(unknown.total, 0, '未知分类返回 0 个');
    assert.equal(unknown.error, undefined, '未知分类不是错误');
  });
});

serialTest('queryMarketplace：分组过滤 + 按组计数 + 分区（每区 6 个）', async () => {
  await withTempHome(async (home) => {
    const marketDir = join(home, 'plugin-market');
    await mkdir(marketDir, { recursive: true });
    const plugins = [];
    const add = (category, n) => {
      for (let i = 0; i < n; i++) {
        plugins.push({
          id: `${category}-${i}`, name: `${category}-plugin-${i}`, repo: `o/${category}-${i}`,
          author: 'o', category, descriptionEn: `${category} plugin ${i}`,
          stars: 10 - i, downloads: 100 - i, addedDate: '2026-01-01',
        });
      }
    };
    add('ui', 8); add('session', 5); add('tools', 3); add('browser', 2);
    await writeFile(join(marketDir, 'index.json'), JSON.stringify({
      version: 2, indexedAt: new Date().toISOString(), categories: ['ui', 'session', 'tools', 'browser'], plugins,
    }));

    const all = await queryMarketplace({});
    const counts = new Map(all.counts.map(item => [item.name, item.count]));
    assert.equal(counts.get('ui'), 8, 'ui 的计数');
    assert.equal(counts.get('session'), 5, 'session 的计数');
    assert.equal(counts.get('browser'), 2, 'browser 归 other');
    assert.equal(all.counts.length, 4, '只有出现过的分类');
    assert.deepEqual(all.sections.map(section => section.category), ['ui', 'session', 'tools'], '分区按数量取前三类');
    assert.ok(all.sections.every(section => section.plugins.length <= 6), '每区最多 6 个');
    assert.equal(all.sections[0].label, '界面', '分区带中文名');

    const uiOnly = await queryMarketplace({ group: 'ui' });
    assert.equal(uiOnly.total, 8, 'group 过滤生效');
    assert.ok(uiOnly.plugins.every(plugin => marketGroupOf(plugin.category) === 'ui'));

    const otherOnly = await queryMarketplace({ group: 'other' });
    assert.equal(otherOnly.total, 2, 'other 组包含未映射分类');

    const searching = await queryMarketplace({ q: 'ui-plugin-1' });
    assert.equal(searching.sections.length, 0, '搜索时不返回分区（省 payload）');
  });
});

serialTest('rankPluginsByKeywords：名称命中优先于描述，无命中返回空', () => {
  const plugins = [
    { id: 'a', name: 'session-export', repo: 'o/session-export', descriptionEn: 'export sessions', stars: 10, downloads: 100 },
    { id: 'b', name: 'random-tool', repo: 'o/random-tool', descriptionEn: 'export sessions to markdown', stars: 99, downloads: 900 },
    { id: 'c', name: 'unrelated', repo: 'o/unrelated', descriptionEn: 'nothing here', stars: 1, downloads: 1 },
  ];
  const ranked = rankPluginsByKeywords(plugins, 'export');
  assert.deepEqual(ranked.map(plugin => plugin.id), ['a', 'b'], '名称命中排在描述命中之前');
  assert.deepEqual(rankPluginsByKeywords(plugins, 'zzz'), [], '无命中返回空');
  assert.deepEqual(rankPluginsByKeywords(plugins, ''), [], '空查询返回空');
});

serialTest('buildPluginSearchPrompt：候选与描述都有上限（上下文受控）', () => {
  const longDesc = '很长的描述'.repeat(200);
  const candidates = Array.from({ length: 40 }, (_, i) => ({
    id: 'p' + i, name: 'pkg-' + i, repo: 'o/pkg-' + i, category: 'ui',
    descriptionZh: longDesc, downloads: 1000 + i, stars: i,
  }));
  const prompt = buildPluginSearchPrompt('把会话导出成 markdown', candidates);
  assert.ok(prompt.length < 12000, 'prompt 长度受控：' + prompt.length);
  // 候选行格式：[编号] 名称 | 分类 | 描述 | 周下载，星标
  const lines = prompt.split('\n').filter(line => /^\[\d+\] /.test(line));
  assert.equal(lines.length, 40, '候选全部列出');
  for (const line of lines) {
    const parts = line.split(' | ');
    assert.equal(parts.length, 4, '候选行四段：' + line.slice(0, 40));
    assert.ok(parts[2].length <= 100, '单条描述截断到 100 字：' + parts[2].length);
  }
  assert.ok(prompt.includes('用户需求：把会话导出成 markdown'));
  // listwise 精排：逐行打分格式 + 允许 0 分退出 + few-shot 示例。
  assert.ok(prompt.includes('answer_num:'), '要求模型按行输出编号');
  assert.ok(prompt.includes('answer_relevance:'), '要求模型给相关度分数');
  assert.ok(prompt.includes('完全无关的插件给 0 分'), '允许 0 分作为「没有相关」的出口');
});

serialTest('parseSearchPicks：容忍围栏/废话、去重、越界丢弃、最多 5 个', () => {
  // 当前协议是逐行打分（answer_num / answer_relevance / why），同时兼容旧的 JSON。
  const lines = 'answer_num: 2, answer_relevance: 9, why: 直接导出\nanswer_num: 1, answer_relevance: 7, why: 部分相关';
  const parsed = parseSearchPicks(lines, 3);
  assert.equal(parsed.length, 2, '两行都解析出来');
  assert.equal(parsed[0].index, 1, '编号按 1-based 转成 0-based');
  assert.equal(parsed[0].score, 9, '带相关度分数');
  assert.equal(parsed[0].why, '直接导出');
  assert.equal(parsed[1].index, 0);
  assert.equal(parsed[1].score, 7);

  const fenced = '好的，结果如下：\n```json\n{"picks":[{"i":2,"why":"a"},{"i":1,"why":"b"}]}\n```';
  assert.deepEqual(parseSearchPicks(fenced, 3).map(pick => pick.index), [0, 1], '围栏 + JSON 也能解析');
  const noisy = '{"picks":[{"i":1},{"i":1},{"i":9},{"i":0}]}';
  assert.deepEqual(parseSearchPicks(noisy, 3).map(pick => pick.index), [0], '去重 + 越界丢弃');
  const many = '{"picks":[{"i":1},{"i":2},{"i":3},{"i":4},{"i":5},{"i":6}]}';
  assert.equal(parseSearchPicks(many, 10).length, 5, '最多 5 个');
  assert.deepEqual(parseSearchPicks('不是 JSON', 3), []);
});

serialTest('searchPluginsByDescription：模型在预筛候选里挑；无模型降级', async () => {
  await withTempHome(async (home) => {
    const marketDir = join(home, 'plugin-market');
    await mkdir(marketDir, { recursive: true });
    const plugins = [
      { id: 'a', name: 'session-export', repo: 'o/session-export', author: 'o', category: 'session', descriptionEn: 'export sessions to markdown', descriptionZh: '把会话导出成 Markdown', stars: 210, downloads: 5200, version: '1.2.0' },
      { id: 'b', name: 'session-replay', repo: 'o/session-replay', author: 'o', category: 'session', descriptionEn: 'replay sessions', descriptionZh: '会话回放', stars: 120, downloads: 3100, version: '0.5.0' },
      { id: 'c', name: 'tokenledger', repo: 'o/tokenledger', author: 'o', category: 'data', descriptionEn: 'token usage', descriptionZh: 'token 用量', stars: 540, downloads: 9000, version: '1.1.0' },
    ];
    await writeFile(join(marketDir, 'index.json'), JSON.stringify({
      version: 2, indexedAt: new Date().toISOString(), categories: ['session', 'data'], plugins,
    }));

    // 假 llm：只支持一个 provider，返回「选第 1 个」。
    let seenPrompt = '';
    const llm = {
      listProviders: () => [{ id: 'magpie', name: 'Magpie' }],
      listModels: async () => [{ provider: 'magpie', id: 'group/free', name: 'Free' }],
      prepareCall: async (config) => ({
        config: { ...config },
        stream: async function* (options) {
          seenPrompt = options.messages[0].content[0].text;
          yield { type: 'text-delta', text: '{"picks":[{"i":1,"why":"导出会话正是这个用途"}]}' };
        },
      }),
    };
    const result = await searchPluginsByDescription({ query: '把会话导出成 markdown', llm });
    assert.equal(result.ok, true);
    assert.equal(result.fallback, false);
    assert.equal(result.candidates, 2, '只把命中的 2 个候选给模型');
    assert.ok(result.promptChars < 12000, 'prompt 受控');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, 'session-export');
    assert.equal(result.items[0].group, 'session');
    assert.equal(result.items[0].reason, '导出会话正是这个用途');
    assert.equal(result.items[0].downloads, 5200);
    assert.ok(seenPrompt.includes('session-export'), '模型确实拿到了候选');
    assert.ok(!seenPrompt.includes('tokenledger'), '无关插件不进上下文');

    // 无模型：关键词降级，并说明原因。
    const fallback = await searchPluginsByDescription({ query: '把会话导出成 markdown', llm: null });
    assert.equal(fallback.fallback, true);
    assert.match(fallback.note, /关键词/);
    assert.equal(fallback.items[0].name, 'session-export', '降级仍给最相关的一个');

    // 模型抛错：同样降级，不把错误抛给 UI。
    const broken = {
      listProviders: () => [{ id: 'p', name: 'P' }],
      listModels: async () => [{ provider: 'p', id: 'm', name: 'M' }],
      prepareCall: async () => { throw new Error('boom'); },
    };
    const degraded = await searchPluginsByDescription({ query: '会话导出', llm: broken });
    assert.equal(degraded.fallback, true);
    assert.match(degraded.note, /模型检索失败/);

    // 关键词一条都没命中：不能硬凑空结果——退化成「最热门的候选」交给模型判断
    // （用户描述与插件措辞不同是常态，全落空时更需要一个兜底而不是空列表）。
    const none = await searchPluginsByDescription({ query: '完全无关的词汇xyz', llm });
    assert.equal(none.candidates, 3, '无关键词命中时退回热门候选');
    assert.equal(none.items.length, 1, '模型在热门候选里挑了 1 个');
    assert.equal(none.items[0].name, 'tokenledger', '热门候选按星标降序，tokenledger 星标最高');
  });
});

serialTest('检索模型记忆：按上次耗时排序，最快的排第一', async () => {
  await withTempHome(async () => {
    assert.equal(await readPreferredSearchRoute(), null, '默认没有记录');

    // 慢的成功过，后记；快的也成功过，先记——读回要按耗时升序，不能按写入顺序。
    await writePreferredSearchRoute({ provider: 'p1', model: 'slow-group/model' }, 41000);
    await writePreferredSearchRoute({ provider: 'p1', model: 'fast-flash' }, 19000);
    const list = await readPreferredSearchRoutes();
    assert.deepEqual(list.map(r => r.model), ['fast-flash', 'slow-group/model'], '快的在前');
    assert.equal(list[0].ms, 19000);

    const saved = await readPreferredSearchRoute();
    assert.equal(saved.provider, 'p1');
    assert.equal(saved.model, 'fast-flash', '兼容接口返回最快的那条');

    // resolveSearchRoutes 把已验证模型按耗时顺序提到最前。
    const llm = {
      listProviders: () => [{ id: 'p1', name: 'P1' }],
      listModels: async () => [
        { provider: 'p1', id: 'slow-group/model', name: 'Slow' },
        { provider: 'p1', id: 'fast-flash', name: 'Fast' },
        { provider: 'p1', id: 'untested', name: 'Untested' },
      ],
    };
    const routes = await resolveSearchRoutes(llm);
    assert.equal(routes[0].model, 'fast-flash', '已验证最快的排第一');
    assert.equal(routes[1].model, 'slow-group/model', '已验证较慢的排第二');
    assert.equal(routes[2].model, 'untested', '未验证的排后面');

    // 同一模型再成功一次取更快的耗时，不会重复入表。
    await writePreferredSearchRoute({ provider: 'p1', model: 'slow-group/model' }, 12000);
    const refreshed = await readPreferredSearchRoutes();
    assert.equal(refreshed.length, 2, '同模型不重复记录');
    assert.equal(refreshed[0].model, 'slow-group/model', '耗时刷新后排到最前');
    assert.equal(refreshed[0].ms, 12000);

    // 抖动变慢不能把最快记录覆盖掉（22s → 60s 那次抖动就是这么坑的）。
    await writePreferredSearchRoute({ provider: 'p1', model: 'slow-group/model' }, 60000);
    const jitter = await readPreferredSearchRoutes();
    assert.equal(jitter[0].ms, 12000, '保留最快的一次，不被慢的抖动覆盖');

    // 记录一个不存在的模型时不影响排序（仍然按快慢）。
    await writePreferredSearchRoute({ provider: 'p9', model: 'gone' }, 1000);
    const fallback = await resolveSearchRoutes(llm);
    assert.equal(fallback[0].model, 'slow-group/model', '记忆里不存在的路由被跳过，剩余按耗时排');
  })
})

serialTest('检索模型记忆：兼容 v1 单条格式', async () => {
  await withTempHome(async (home) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = join(home, 'plugin-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'search-route.json'),
      JSON.stringify({ provider: 'p1', model: 'legacy-model', at: '2026-01-01T00:00:00.000Z' }), 'utf8');
    const list = await readPreferredSearchRoutes();
    assert.equal(list.length, 1, 'v1 记录能读出来');
    assert.equal(list[0].model, 'legacy-model');
    assert.equal(list[0].ms, Number.MAX_SAFE_INTEGER, '没有耗时按最慢排，仍会先试它');

    // 再成功一次就升级成 v2，耗时可比。
    await writePreferredSearchRoute({ provider: 'p1', model: 'legacy-model' }, 8000);
    const upgraded = await readPreferredSearchRoutes();
    assert.equal(upgraded.length, 1);
    assert.equal(upgraded[0].ms, 8000);
  })
})

serialTest('检索模型记忆：原子写、无临时文件残留', async () => {
  await withTempHome(async (home) => {
    await writePreferredSearchRoute({ provider: 'p', model: 'm' });
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(join(home, 'plugin-manager'));
    assert.ok(files.includes('search-route.json'));
    assert.equal(files.filter(f => f.includes('.tmp-')).length, 0, '没有残留 tmp 文件');
  })
})

serialTest('parseSearchPicks：JSON 分支也认裸数组（模型给 [1,2] 时不能被静默忽略）', () => {
  // 裸数组没有 '{'，早前只用 indexOf('{') 找边界 → 数组分支永远进不去，
  // 下面 typeof pick === 'number' 那条路成了死代码。
  assert.deepEqual(parseSearchPicks('[1,3]', 5).map(pick => pick.index), [0, 2], '裸编号数组能解析');
  assert.deepEqual(parseSearchPicks('[{"i":2,"why":"x"}]', 5).map(pick => pick.index), [1], '数组里带对象也能解析');
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":2},{"i":1}]}', 5).map(pick => pick.index), [0, 1], '对象格式照旧');
  assert.deepEqual(parseSearchPicks('[1,99]', 5).map(pick => pick.index), [0], '越界丢弃');
});
