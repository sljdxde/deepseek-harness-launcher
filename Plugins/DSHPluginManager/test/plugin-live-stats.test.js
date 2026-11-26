// 市场条目统计补查（star / npm 下载量）的后端单测。
//
// 背景：社区清单里的 stars / downloads 是上游快照，新收录的条目在快照里没有键，
// 面板只能显示 0。这里覆盖「按需补查 + 落盘缓存 + 叠加到列表」的全部分支：
// 命中缓存不发请求、失败负缓存、npm 候选名 404 换下一个、GitHub 403 限流、
// 缓存文件坏掉/写不进去都只降级。
//
// 约定：全部走注入的假 fetch 与临时 DSH_HOME，不发真实网络请求；本文件独占
// process.env.DSH_HOME，必须串行跑（同 plugin-sources.test.js 的理由）。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  LIVE_STATS_MAX,
  apply,
  applyLiveStats,
  invalidateLiveStatsCache,
  loadPluginLiveStats,
  npmNameCandidates,
  parseLiveStatsURLs,
  readMarketplaceAggregated,
  resetMirrorCache,
} from '../lib/index.js';

const serialTest = (name, options, fn) => {
  if (typeof options === 'function') return test(name, { concurrency: false }, options);
  return test(name, { ...options, concurrency: false }, fn);
};

/** 假响应：status 决定 ok（404/403 这类非 2xx 的分支靠它）。 */
function respondJSON(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** 记录调用并按 URL 前缀分发的假 fetch；未命中的前缀回 404。 */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    for (const [prefix, respond] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return respond(String(url));
    }
    return respondJSON({}, 404);
  };
  return { calls, impl };
}

async function withTempHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-stats-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  resetMirrorCache();
  invalidateLiveStatsCache();
  try {
    return await run(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    invalidateLiveStatsCache();
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}

const statsFile = home => join(home, 'plugin-manager', 'stats-cache.json');
const URL_A = 'https://github.com/o/alpha';
const URL_B = 'https://github.com/o/beta';
const NPM_A = 'https://api.npmjs.org/downloads/point/last-month/alpha';
const NPM_A_SCOPED = 'https://api.npmjs.org/downloads/point/last-month/@o/alpha';
const NPM_B = 'https://api.npmjs.org/downloads/point/last-month/beta';
const GH_A = 'https://api.github.com/repos/o/alpha';
const GH_B = 'https://api.github.com/repos/o/beta';

/** 收集 apply() 注册的路由（路由层用例用）。 */
function boot() {
  const routes = [];
  const webServer = { register(route) { routes.push(route); return () => {}; } };
  const host = { webServer, llm: null, effect(fn) { return fn(); } };
  apply({ inject(deps, callback) { callback(host); } });
  return routes;
}

const routeOf = (routes, path) => {
  const found = routes.find(route => route.path === path);
  assert.ok(found, `路由未注册：${path}`);
  return found;
};

/** 极简假请求/响应（只够 /marketplace/stats 用）。 */
function makeReq(method, url = '/') {
  return { method, url };
}

function makeRes() {
  const calls = [];
  return {
    calls,
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { calls.push(['writeHead', status, headers]); this.status = status; this.headers = headers; },
    end(body) { calls.push(['end', body]); this.body = body; },
  };
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

test('parseLiveStatsURLs：去重、丢掉非 http、按上限截断', () => {
  assert.deepEqual(parseLiveStatsURLs(''), []);
  assert.deepEqual(parseLiveStatsURLs([URL_A, URL_A, 'ftp://x', URL_B].join(',')), [URL_A, URL_B]);
  // 数组入参与逗号分隔等价
  assert.deepEqual(parseLiveStatsURLs([URL_A, '', null]), [URL_A]);
  const many = Array.from({ length: LIVE_STATS_MAX + 5 }, (_, index) => `https://github.com/o/p${index}`);
  assert.equal(parseLiveStatsURLs(many).length, LIVE_STATS_MAX, '超过上限要截断');
});

test('npmNameCandidates：先仓库名，再 @作者/仓库', () => {
  assert.deepEqual(npmNameCandidates('Owner', 'Dsh-Clipchat'), ['dsh-clipchat', '@owner/dsh-clipchat']);
  assert.deepEqual(npmNameCandidates('', 'dsh-clipchat'), ['dsh-clipchat']);
  assert.deepEqual(npmNameCandidates('owner', ''), []);
});

test('applyLiveStats：只覆盖确实查到的数值', () => {
  const plugins = [
    { id: 'a', url: URL_A, stars: 0, downloads: 0 },
    { id: 'b', url: URL_B, stars: 0, downloads: 0 },
    { id: 'c', stars: 1, downloads: 2 },
  ];
  // 非数组 / 没有缓存 → 原样返回（同一引用）
  assert.equal(applyLiveStats(plugins, null), plugins);
  assert.equal(applyLiveStats(null, {}), null);
  const merged = applyLiveStats(plugins, {
    [URL_A]: { stars: 56, downloads: 1679 },
    [URL_B]: { stars: 3 }, // 下载量没查到 → 保持快照值
  });
  assert.equal(merged[0].stars, 56);
  assert.equal(merged[0].downloads, 1679);
  assert.equal(merged[1].stars, 3);
  assert.equal(merged[1].downloads, 0, '缺的字段保持快照');
  assert.equal(merged[2], plugins[2], '没有 url 的条目原样返回');
});

// ---------------------------------------------------------------------------
// 补查主流程
// ---------------------------------------------------------------------------

serialTest('loadPluginLiveStats：查到后落盘，第二次直接命中缓存', async () => {
  await withTempHome(async home => {
    const { calls, impl } = fakeFetch({
      [GH_A]: () => respondJSON({ stargazers_count: 56 }),
      [GH_B]: () => respondJSON({ stargazers_count: 3 }),
      // alpha 的无 scope 包不存在 → 换 @o/alpha
      [NPM_A]: () => respondJSON({}, 404),
      [NPM_A_SCOPED]: () => respondJSON({ downloads: 1679 }),
      [NPM_B]: () => respondJSON({ downloads: 12 }),
    });
    const first = await loadPluginLiveStats([URL_A, URL_B], { fetch: impl });
    assert.deepEqual(first.errors, []);
    assert.deepEqual(first.stats[URL_A], { stars: 56, downloads: 1679, npm: '@o/alpha' });
    assert.deepEqual(first.stats[URL_B], { stars: 3, downloads: 12, npm: 'beta' });
    const saved = JSON.parse(await readFile(statsFile(home), 'utf8'));
    assert.equal(saved.version, 1);
    assert.equal(saved.entries[URL_A].stars, 56);
    assert.ok(saved.entries[URL_A].starsAt, 'star 要记录抓取时间');
    assert.ok(saved.entries[URL_A].downloadsAt, '下载量要记录抓取时间');

    const before = calls.length;
    const second = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(calls.length, before, '缓存未过期时不该再发请求');
    assert.equal(second.stats[URL_A].stars, 56);
    assert.equal(second.stats[URL_A].downloads, 1679);
  });
});

serialTest('loadPluginLiveStats：单个来源失败只降级并负缓存', async () => {
  await withTempHome(async () => {
    const { calls, impl } = fakeFetch({
      [GH_A]: () => respondJSON({ message: 'rate limited' }, 403),
      [NPM_A]: () => respondJSON({}, 500),
    });
    const first = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(first.stats[URL_A].stars, null);
    assert.equal(first.stats[URL_A].downloads, null);
    assert.equal(first.errors.length, 1);
    assert.match(first.errors[0], /GitHub 接口限流/);
    assert.match(first.errors[0], /npm 下载量 HTTP 500/);

    const before = calls.length;
    const second = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(calls.length, before, '15 分钟负缓存内不重复打上游');
    assert.deepEqual(second.errors, []);
    assert.equal(second.stats[URL_A].stars, null);
  });
});

serialTest('loadPluginLiveStats：一边成功一边失败时保留成功的那半边', async () => {
  await withTempHome(async () => {
    const { impl } = fakeFetch({
      [GH_A]: () => respondJSON({ stargazers_count: 9 }),
      [NPM_A]: () => respondJSON({}, 500),
    });
    const result = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(result.stats[URL_A].stars, 9);
    assert.equal(result.stats[URL_A].downloads, null);
    assert.match(result.errors[0], /下载量：npm 下载量 HTTP 500/);
  });
});

serialTest('loadPluginLiveStats：npm 两个候选都 404 → 确认没有包，也要缓存', async () => {
  await withTempHome(async () => {
    const { calls, impl } = fakeFetch({
      [GH_A]: () => respondJSON({ stargazers_count: 1 }),
    });
    const first = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.deepEqual(first.errors, []);
    assert.equal(first.stats[URL_A].downloads, null);
    assert.equal(first.stats[URL_A].npm, null);

    const before = calls.length;
    await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(calls.length, before, '「没有 npm 包」是确定结论，别再重试');
  });
});

serialTest('loadPluginLiveStats：响应结构不对时按失败处理', async () => {
  await withTempHome(async () => {
    const { impl } = fakeFetch({
      [GH_A]: () => respondJSON({ full_name: 'o/alpha' }), // 缺 stargazers_count
      [NPM_A]: () => respondJSON({ package: 'alpha', downloads: 'many' }),
    });
    const result = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(result.stats[URL_A].stars, null);
    assert.equal(result.stats[URL_A].downloads, null);
    assert.match(result.errors[0], /GitHub 仓库信息缺少 star 数/);
    assert.match(result.errors[0], /npm 下载量响应异常/);
  });
});

serialTest('loadPluginLiveStats：非 GitHub 地址直接报错，不发请求', async () => {
  await withTempHome(async () => {
    const { calls, impl } = fakeFetch({});
    const result = await loadPluginLiveStats('https://example.com/not-a-repo', { fetch: impl });
    assert.equal(calls.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /不是 GitHub 仓库地址/);
  });
});

serialTest('loadPluginLiveStats：过期缓存会重新查', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    const stale = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await writeFile(statsFile(home), JSON.stringify({
      version: 1,
      entries: { [URL_A]: { stars: 1, starsAt: stale, downloads: 5, downloadsAt: stale, npm: 'alpha' } },
    }), 'utf8');
    const { impl } = fakeFetch({
      [GH_A]: () => respondJSON({ stargazers_count: 77 }),
      [NPM_A]: () => respondJSON({ downloads: 900 }),
    });
    const result = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(result.stats[URL_A].stars, 77);
    assert.equal(result.stats[URL_A].downloads, 900);
  });
});

serialTest('loadPluginLiveStats：缓存文件坏掉时当空处理', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    await writeFile(statsFile(home), '{不是 json', 'utf8');
    const { impl } = fakeFetch({
      [GH_A]: () => respondJSON({ stargazers_count: 2 }),
      [NPM_A]: () => respondJSON({ downloads: 3 }),
    });
    const result = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(result.stats[URL_A].stars, 2);
    assert.equal(result.stats[URL_A].downloads, 3);
    // 结构合法但没有 entries 也算空
    await writeFile(statsFile(home), JSON.stringify({ version: 1 }), 'utf8');
    invalidateLiveStatsCache();
    const again = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(again.stats[URL_A].stars, 2);
  });
});

serialTest('loadPluginLiveStats：缓存写不进去也不影响返回', async () => {
  await withTempHome(async home => {
    // 用同名普通文件占住目录位：mkdir 必然失败，写入走 catch 分支。
    await writeFile(join(home, 'blocked'), 'not a directory', 'utf8');
    const file = join(home, 'blocked', 'stats-cache.json');
    const { impl } = fakeFetch({
      [GH_A]: () => respondJSON({ stargazers_count: 4 }),
      [NPM_A]: () => respondJSON({ downloads: 6 }),
    });
    const result = await loadPluginLiveStats(URL_A, { fetch: impl, file });
    assert.equal(result.stats[URL_A].stars, 4);
    assert.equal(result.stats[URL_A].downloads, 6);
  });
});

serialTest('loadPluginLiveStats：3 秒内的第二次调用读内存缓存', async () => {
  await withTempHome(async home => {
    const { impl } = fakeFetch({
      [GH_A]: () => respondJSON({ stargazers_count: 8 }),
      [NPM_A]: () => respondJSON({ downloads: 9 }),
    });
    await loadPluginLiveStats(URL_A, { fetch: impl });
    await rm(statsFile(home), { force: true }); // 删盘后仍能读到内存副本
    const result = await loadPluginLiveStats(URL_A, { fetch: impl });
    assert.equal(result.stats[URL_A].stars, 8);
  });
});

// ---------------------------------------------------------------------------
// 叠加到市场索引
// ---------------------------------------------------------------------------

serialTest('readMarketplaceAggregated：补查缓存叠加到条目上', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'plugin-market'), { recursive: true });
    await writeFile(join(home, 'plugin-market', 'index.json'), JSON.stringify({
      version: 3,
      indexedAt: new Date().toISOString(),
      categories: ['ui'],
      plugins: [
        { id: 'a', url: URL_A, name: 'o/alpha', repo: 'alpha', author: 'o', category: 'ui', source: 'community', stars: 0, downloads: 0 },
        { id: 'b', url: URL_B, name: 'o/beta', repo: 'beta', author: 'o', category: 'ui', source: 'community', stars: 0, downloads: 0 },
      ],
    }), 'utf8');
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    await writeFile(statsFile(home), JSON.stringify({
      version: 1,
      entries: { [URL_A]: { stars: 56, downloads: 1679, npm: 'alpha' } },
    }), 'utf8');
    invalidateLiveStatsCache();
    const market = await readMarketplaceAggregated();
    const alpha = market.plugins.find(item => item.url === URL_A);
    const beta = market.plugins.find(item => item.url === URL_B);
    assert.equal(alpha.stars, 56);
    assert.equal(alpha.downloads, 1679);
    assert.equal(beta.stars, 0, '没有补查记录的条目保持快照值');
  });
});

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

serialTest('/marketplace/stats：GET 返回补查结果，POST 405', async () => {
  await withTempHome(async () => {
    const routes = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/marketplace/stats');
    assert.equal(route.kind, 'exact');

    const rejected = makeRes();
    await route.handler(makeReq('POST'), rejected);
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.allow, 'GET');

    const res = makeRes();
    await route.handler(makeReq('GET', '/dsh-plugin-manager/marketplace/stats?urls=' + encodeURIComponent('https://example.com/nope')), res);
    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.errors.length, 1);
    assert.match(payload.errors[0], /不是 GitHub 仓库地址/);
  });
});
