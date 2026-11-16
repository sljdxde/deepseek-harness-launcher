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
test.options ??= {};
const serialTest = (name, options, fn) => test(name, { ...options, concurrency: false }, fn);
import {
  DEFAULT_SOURCE_ID,
  queryMarketplace,
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

    const summary = await refreshPluginSources({ fetch: fetchImpl });
    assert.equal(summary.sources, 3, '默认源 + 2 个自定义（默认源不在 fakeFetch 里会失败并被记录）');
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
    await refreshPluginSources({ fetch: fetchImpl });
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

serialTest('pnpmEnvironment：关闭时原 env，打开时注入 npm_config_registry', async () => {
  const previous = process.env.DSH_PORT;
  process.env.DSH_PORT = '3999';
  try {
    const { fetchImpl } = fakeFetch({
      // 镜像插件不存在：fetch 抛错 → 按「关闭」处理
    });
    const off = await pnpmEnvironment({ fetch: async () => { throw new Error('no plugin'); } });
    assert.equal(off.npm_config_registry, undefined);

    const on = await pnpmEnvironment({
      fetch: async () => ({
        ok: true, status: 200,
        json: async () => ({ enabled: true, table: [{ match: 'https://registry.npmjs.org/', replace: 'https://registry.npmmirror.com/', kind: 'registry' }] }),
      }),
    });
    assert.equal(on.npm_config_registry, 'https://registry.npmmirror.com/');
  } finally {
    if (previous === undefined) delete process.env.DSH_PORT;
    else process.env.DSH_PORT = previous;
    resetMirrorCache();
  }
});

serialTest('readMirrorStateCached：镜像插件不可用按关闭，短缓存生效', async () => {
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
  assert.equal(calls, 1, '10 秒内只请求一次');
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
