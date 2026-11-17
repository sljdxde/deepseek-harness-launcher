// 路由层（lib/index.js 的 apply(ctx) 与其周边的请求/响应工具）的后端单测。
//
// 覆盖范围：apply() 注册的 26 条 HTTP 路由（正常路径 + 方法不对 405 + 参数缺失 +
// 下游抛错/响应写不出去的 500），以及它们用到的市场索引、AI 检索、检索模型记忆
// 这些模块级函数（queryMarketplace、searchPluginsByDescription(Stream)、
// refreshPluginSources、parseSearchPicks、resolveSearchRoutes 等）。
//
// 约定：
//   * 全部走注入的假 host（boot() 收集 webServer.register 的路由），逐个调用 handler
//     并断言响应体；
//   * 所有会碰网络/git/pnpm 的路径都被挡在「不可用」的确定分支上（临时 DSH_HOME
//     里没有 dsh CLI、没有 node_modules，源索引/镜像插件走本机假 HTTP 服务）；
//   * 本文件会改 process.env.DSH_HOME / DSH_PORT，必须串行跑；
//   * 用例会临时替换 globalThis.fetch / process.exit（模拟「客户端断开」与
//     「优雅退出 dsh」），并在 finally 里恢复；
//   * 其中一个用例要走满 AI 检索的 20 秒对冲窗口（上次成功的模型太慢时要并发
//     其它模型），所以整个文件跑完约 30 秒。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  aggregateCachedSources,
  apply,
  buildPluginSearchPrompt,
  ignoreEntriesFromBody,
  invalidatePluginRowCache,
  isBatchUpdateRunning,
  keywordVariants,
  marketCategoryLabel,
  marketGroupLabel,
  marketGroupOf,
  normalizeCategory,
  parseSearchPicks,
  queryMarketplace,
  rankPluginsByKeywords,
  readMarketplaceAggregated,
  readPreferredSearchRoute,
  readPreferredSearchRoutes,
  readSourceCache,
  readSourceRefreshProgress,
  readSourcesConfig,
  refreshPluginSources,
  resetMirrorCache,
  resolveSearchRoutes,
  searchPluginsByDescription,
  searchPluginsByDescriptionStream,
  updatePlugins,
  writePreferredSearchRoute,
} from '../lib/index.js';

// 本文件独占 process.env（DSH_HOME / DSH_PORT），必须串行。
const serialTest = (name, options, fn) => {
  if (typeof options === 'function') return test(name, { concurrency: false }, options);
  return test(name, { ...options, concurrency: false }, fn);
};

// ---------------------------------------------------------------------------
// 假 host / 假请求 / 假响应
// ---------------------------------------------------------------------------

/** 收集宿主注册的全部路由（并保留 effect 的注销函数）。 */
function boot(llm = null) {
  const routes = [];
  const webServer = { register(route) { routes.push(route); return () => {}; } };
  let dispose = null;
  const host = { webServer, llm, effect(fn) { dispose = fn(); return dispose; } };
  apply({ inject(deps, callback) { callback(host); } });
  return { routes, host, dispose };
}

const routeOf = (routes, path) => {
  const found = routes.find(route => route.path === path);
  assert.ok(found, `路由未注册：${path}`);
  return found;
};

/**
 * 假响应：记录 writeHead/write/end。
 *   failWrite      - 第一次 writeHead 抛出的值（模拟「客户端已断开」）
 *   failWriteAlways- 每次 writeHead 都抛出的值
 *   failWriteLine  - 每次 write() 都抛出的值
 */
function makeRes(options = {}) {
  const calls = [];
  let writeHeads = 0;
  return {
    calls,
    status: null,
    headers: null,
    body: null,
    chunks: [],
    writeHead(status, headers) {
      calls.push(['writeHead', status, headers]);
      this.status = status;
      this.headers = headers;
      writeHeads += 1;
      if (options.failWriteAlways !== undefined) throw options.failWriteAlways;
      if (options.failWrite !== undefined && writeHeads === 1) throw options.failWrite;
    },
    write(chunk) {
      calls.push(['write', chunk]);
      this.chunks.push(String(chunk));
      if (options.failWriteLine !== undefined) throw options.failWriteLine;
    },
    end(body) {
      calls.push(['end', body]);
      this.body = body;
      // 真机上 socket 报错会触发 res.on('error')；这里在收尾时补一次，
      // 让「注册了错误监听」的路由能走到那个回调。
      if (this.errorHandler) this.errorHandler(new Error('socket closed'));
    },
    on(event, handler) {
      if (event === 'error') this.errorHandler = handler;
      return this;
    },
  };
}

/**
 * 假请求：method + url + 可选的 JSON/原始 body。
 *   bodyThrows - body 迭代时抛出的值（模拟请求体读取失败）
 *   throwOnUrl - 读取 url 时抛出的值（模拟请求行不可解析）
 */
function makeReq(method, options = {}) {
  const { body } = options;
  const chunks = [];
  if (body !== undefined) {
    chunks.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'));
  }
  const req = {
    method,
    url: options.url === undefined ? '/' : options.url,
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: async () => {
          if (options.bodyThrows !== undefined) throw options.bodyThrows;
          return index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined };
        },
      };
    },
  };
  if (options.throwOnUrl !== undefined) {
    Object.defineProperty(req, 'url', { get() { throw options.throwOnUrl; }, configurable: true });
  }
  return req;
}

/** 响应体（JSON）。 */
function jsonOf(res) {
  const end = res.calls.filter(call => call[0] === 'end').pop();
  assert.ok(end, '响应没有 end()');
  return JSON.parse(end[1]);
}

const statusOf = res => res.calls.filter(call => call[0] === 'writeHead').pop()[1];

/** NDJSON 响应：拆成逐行 JSON。 */
function ndjsonOf(res) {
  return res.chunks.join('').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// 临时 DSH_HOME
// ---------------------------------------------------------------------------

async function withTempHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-routes-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  resetMirrorCache();
  invalidatePluginRowCache();
  try {
    return await run(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    resetMirrorCache();
    invalidatePluginRowCache();
    await removeHome(home);
  }
}

/**
 * 删临时目录。Windows 上刚写过的目录偶尔会被索引器/杀毒软件占着，
 * 报 EBUSY：重试几次，别让清理失败把用例结果带崩。
 */
async function removeHome(home) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(home, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

/** 写一份市场主索引（模拟「已经同步过默认源」）。 */
async function writeMarketIndex(home, plugins, extra = {}) {
  const dir = join(home, 'plugin-market');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.json'), JSON.stringify({
    version: 2,
    indexedAt: new Date().toISOString(),
    categories: [...new Set(plugins.map(plugin => plugin.category).filter(Boolean))],
    plugins,
    ...extra,
  }), 'utf8');
}

/** 装一个「已安装」的插件（node_modules + profile 清单里的 bundles）。 */
async function writeInstalledPlugin(home, name, options = {}) {
  const modules = join(home, 'profiles', 'web', 'node_modules');
  await mkdir(join(modules, name), { recursive: true });
  await writeFile(join(modules, name, 'package.json'), JSON.stringify({
    name, version: options.version ?? '1.0.0', description: options.description ?? '',
  }), 'utf8');
  if (options.rows !== false) {
    await writeFile(join(modules, name, 'cordis.patch.yml'),
      `- insert:\n    - id: ${name}-row\n      name: ${name}\n`, 'utf8');
  }
  return modules;
}

/** 本机假 HTTP 服务：给源索引 / 镜像插件路由用（不出网）。 */
async function startLocalServer(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    url: path => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

/** 轮询直到条件成立（后台任务收尾用）。 */
async function waitFor(predicate, { timeoutMs = 5000, stepMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, stepMs));
  }
  return false;
}

// ---------------------------------------------------------------------------
// 假模型（宿主 ctx.llm）
// ---------------------------------------------------------------------------

/**
 * 假 llm。models 里每个模型可以单独配行为：
 *   { id, name, inputModalities, text, chunks, finish, prepareError,
 *     reasoning: { efforts: [{ id }] }, delayMs, hangMs }
 */
function fakeLlm(options = {}) {
  const models = options.models ?? [{ id: 'p1/flash-model', name: 'Flash' }];
  const byModel = new Map(models.map(model => [model.id, model]));
  return {
    listProviders: options.providers === undefined
      ? () => [{ id: 'p1', name: 'P1' }]
      : options.providers,
    listModels: options.modelsError
      ? async () => { throw options.modelsError; }
      : async () => models,
    prepareCall: async (config, signal, configure) => {
      const model = byModel.get(config.model) ?? {};
      if (model.prepareError) throw model.prepareError;
      const controls = typeof configure === 'function'
        ? configure({}, { reasoning: model.reasoning })
        : {};
      return {
        config: { ...config, ...controls },
        stream: async function* stream() {
          if (model.hangMs) await new Promise(resolve => setTimeout(resolve, model.hangMs));
          const chunks = model.chunks ?? (model.text === undefined
            ? []
            : [{ type: 'text-delta', text: model.text }]);
          for (const chunk of chunks) {
            if (model.delayMs) await new Promise(resolve => setTimeout(resolve, model.delayMs));
            yield chunk;
          }
          if (model.finish) yield model.finish;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// 路由表与 405 守卫
// ---------------------------------------------------------------------------

const ROUTES = [
  ['/dsh-plugin-manager/installed', 'GET'],
  ['/dsh-plugin-manager/disabled', 'GET'],
  ['/dsh-plugin-manager/set-disabled', 'POST'],
  ['/dsh-plugin-manager/marketplace', 'GET'],
  ['/dsh-plugin-manager/marketplace/query', 'GET'],
  ['/dsh-plugin-manager/refresh', 'POST'],
  ['/dsh-plugin-manager/ai-search', 'POST'],
  ['/dsh-plugin-manager/ai-search/stream', 'POST'],
  ['/dsh-plugin-manager/sources', 'GET'],
  ['/dsh-plugin-manager/sources/add', 'POST'],
  ['/dsh-plugin-manager/sources/remove', 'POST'],
  ['/dsh-plugin-manager/sources/set-enabled', 'POST'],
  ['/dsh-plugin-manager/sources/progress', 'GET'],
  ['/dsh-plugin-manager/china-mirror', 'GET'],
  ['/dsh-plugin-manager/china-mirror/set', 'POST'],
  ['/dsh-plugin-manager/install', 'POST'],
  ['/dsh-plugin-manager/uninstall', 'POST'],
  ['/dsh-plugin-manager/update', 'POST'],
  ['/dsh-plugin-manager/updates', 'GET'],
  ['/dsh-plugin-manager/release-notes', 'POST'],
  ['/dsh-plugin-manager/ignore', 'POST'],
  ['/dsh-plugin-manager/unignore', 'POST'],
  ['/dsh-plugin-manager/update-many', 'POST'],
  ['/dsh-plugin-manager/uninstall-many', 'POST'],
  ['/dsh-plugin-manager/cleanup', 'POST'],
  ['/dsh-plugin-manager/restart', 'POST'],
];

serialTest('apply 注册全部路由，且方法不对时一律 405', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    assert.deepEqual(routes.map(route => route.path).sort(), ROUTES.map(([path]) => path).sort());
    assert.ok(routes.every(route => route.kind === 'exact'));

    for (const [path, method] of ROUTES) {
      const res = makeRes();
      await routeOf(routes, path).handler(makeReq(method === 'GET' ? 'POST' : 'GET'), res);
      assert.equal(statusOf(res), 405, `${path} 方法不对要回 405`);
      assert.equal(res.headers.allow, method, `${path} 要声明允许的方法`);
    }
  });
});

// ---------------------------------------------------------------------------
// /installed、/disabled、/set-disabled
// ---------------------------------------------------------------------------

serialTest('/installed：返回已安装插件清单', async () => {
  await withTempHome(async home => {
    await writeInstalledPlugin(home, 'dsh-demo', { version: '2.1.0', description: 'demo 插件' });
    await mkdir(join(home, 'profiles', 'web'), { recursive: true });
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({
      name: 'web', private: true, dsh: { profile: { bundles: ['dsh-demo'] } },
    }), 'utf8');

    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/installed').handler(makeReq('GET'), res);
    assert.equal(statusOf(res), 200);
    const payload = jsonOf(res);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].name, 'dsh-demo');
    assert.equal(payload.items[0].version, '2.1.0');
  });
});

serialTest('/installed：响应写不出去时回 500（客户端断开也算失败）', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes({ failWrite: '客户端已断开' });
    await routeOf(routes, '/dsh-plugin-manager/installed').handler(makeReq('GET'), res);
    const statuses = res.calls.filter(call => call[0] === 'writeHead').map(call => call[1]);
    assert.deepEqual(statuses, [200, 500], '成功响应写不出去时要改回 500');
    assert.equal(jsonOf(res).error, '客户端已断开');
  });
});

serialTest('/disabled：列出可停用状态；refresh=1 强制重算', async () => {
  await withTempHome(async home => {
    await writeInstalledPlugin(home, 'dsh-demo');
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['dsh-demo'] } },
    }), 'utf8');

    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/disabled').handler(makeReq('GET'), res);
    assert.equal(statusOf(res), 200);
    const payload = jsonOf(res);
    const item = payload.items.find(entry => entry.bundle === 'dsh-demo');
    assert.ok(item, '已安装插件要出现在停用视图里');
    assert.deepEqual(item.rowIds, ['dsh-demo-row']);
    assert.equal(item.canDisable, true);
    assert.equal(item.disabled, false);

    const forced = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/disabled')
      .handler(makeReq('GET', { url: '/dsh-plugin-manager/disabled?refresh=1' }), forced);
    assert.equal(statusOf(forced), 200);
    assert.equal(jsonOf(forced).items.find(entry => entry.bundle === 'dsh-demo').canDisable, true);
  });
});

serialTest('/disabled：URL 非法时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/disabled')
      .handler(makeReq('GET', { url: 'http://[bad' }), res);
    assert.equal(statusOf(res), 500);
    assert.ok(jsonOf(res).error);
  });
});

serialTest('/set-disabled：缺参数 / 不可停用 / 停用 / 启用', async () => {
  await withTempHome(async home => {
    await writeInstalledPlugin(home, 'dsh-demo');
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['dsh-demo'] } },
    }), 'utf8');

    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/set-disabled');

    const missing = makeRes();
    await route.handler(makeReq('POST', { body: { bundle: 'dsh-demo' } }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /disabled/);

    const protectedRes = makeRes();
    await route.handler(makeReq('POST', { body: { bundle: 'dsh-plugin-manager', disabled: true } }), protectedRes);
    assert.equal(statusOf(protectedRes), 400);
    assert.equal(jsonOf(protectedRes).code, 'protected');

    const notInstalled = makeRes();
    await route.handler(makeReq('POST', { body: { bundle: 'dsh-absent', disabled: true } }), notInstalled);
    assert.equal(statusOf(notInstalled), 400);
    assert.equal(jsonOf(notInstalled).code, 'not-installed');

    const disabled = makeRes();
    await route.handler(makeReq('POST', { body: { bundle: 'dsh-demo', disabled: true } }), disabled);
    assert.equal(statusOf(disabled), 200);
    assert.equal(jsonOf(disabled).disabled, true);
    assert.deepEqual(jsonOf(disabled).rowIds, ['dsh-demo-row']);

    const state = JSON.parse(await readFile(join(home, 'plugin-manager', 'disabled.json'), 'utf8'));
    assert.deepEqual(state.disabled.map(entry => entry.bundle), ['dsh-demo']);

    const enabled = makeRes();
    await route.handler(makeReq('POST', { body: { bundle: 'dsh-demo', disabled: false } }), enabled);
    assert.equal(statusOf(enabled), 200);
    assert.equal(jsonOf(enabled).disabled, false);
    assert.deepEqual(JSON.parse(await readFile(join(home, 'plugin-manager', 'disabled.json'), 'utf8')).disabled, []);
  });
});

serialTest('/set-disabled：请求体不是合法 JSON 时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/set-disabled')
      .handler(makeReq('POST', { body: '{不是 json' }), res);
    assert.equal(statusOf(res), 500);
    assert.ok(jsonOf(res).error);
  });
});

// ---------------------------------------------------------------------------
// /marketplace 与 /marketplace/query
// ---------------------------------------------------------------------------

serialTest('/marketplace：返回聚合后的市场清单', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui', stars: 10, downloads: 100, source: 'community' },
      { id: 'b', name: 'pkg-b', repo: 'o/pkg-b', category: 'tool', stars: 5, downloads: 50, source: 'community' },
    ]);

    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/marketplace').handler(makeReq('GET'), res);
    assert.equal(statusOf(res), 200);
    const payload = jsonOf(res);
    assert.equal(payload.ok, true);
    assert.equal(payload.count, 2);
    assert.deepEqual(payload.plugins.map(item => item.name).sort(), ['pkg-a', 'pkg-b']);
    assert.deepEqual(payload.categories.sort(), ['tool', 'ui']);
  });
});

serialTest('/marketplace：响应写不出去时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes({ failWrite: '客户端已断开' });
    await routeOf(routes, '/dsh-plugin-manager/marketplace').handler(makeReq('GET'), res);
    assert.deepEqual(res.calls.filter(call => call[0] === 'writeHead').map(call => call[1]), [200, 500]);
    assert.equal(jsonOf(res).error, '客户端已断开');
  });
});

serialTest('/marketplace/query：参数透传（q/category/group/source/sort/limit/offset）', async () => {
  await withTempHome(async home => {
    const plugins = [
      { id: 'ui1', name: 'ui-one', repo: 'o/ui-one', category: 'ui', stars: 1, downloads: 900, source: 'community', descriptionEn: 'panel thing' },
      { id: 'ui2', name: 'ui-two', repo: 'o/ui-two', category: 'ui', stars: 30, downloads: 10, source: 'community' },
      { id: 'tool1', name: 'tool-one', repo: 'o/tool-one', category: 'tool', stars: 20, downloads: 800, source: 'official' },
      { id: 'wf1', name: 'wf-one', repo: 'o/wf-one', category: 'workflow', stars: 5, downloads: 5, source: 'community' },
    ];
    await writeMarketIndex(home, plugins);

    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/marketplace/query');

    const all = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query' }), all);
    assert.equal(statusOf(all), 200);
    assert.equal(jsonOf(all).total, 4);

    const searched = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?q=panel' }), searched);
    assert.equal(jsonOf(searched).total, 1);
    assert.equal(jsonOf(searched).plugins[0].name, 'ui-one');

    const byCategory = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?category=ui' }), byCategory);
    assert.equal(jsonOf(byCategory).total, 2);

    const byGroup = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?group=auto' }), byGroup);
    assert.equal(jsonOf(byGroup).total, 1, 'workflow 归 auto 组');
    assert.equal(jsonOf(byGroup).plugins[0].name, 'wf-one');

    const byOfficial = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?source=official' }), byOfficial);
    assert.equal(jsonOf(byOfficial).total, 1);
    assert.equal(jsonOf(byOfficial).plugins[0].name, 'tool-one');

    const byCommunity = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?source=community' }), byCommunity);
    assert.equal(jsonOf(byCommunity).total, 3);

    const byCustom = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?source=my-src' }), byCustom);
    assert.equal(jsonOf(byCustom).total, 0, '没有这个来源的插件');

    const byDownloads = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?sort=downloads' }), byDownloads);
    assert.equal(jsonOf(byDownloads).plugins[0].name, 'ui-one', '按下载量排序（900 > 800）');

    const paged = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?limit=2&offset=1' }), paged);
    const page = jsonOf(paged);
    assert.equal(page.plugins.length, 2);
    assert.equal(page.total, 4, '分页不影响总数');
    assert.equal(page.plugins[0].name, 'tool-one', '按星标降序后取第二页');

    const clamped = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/marketplace/query?limit=9999' }), clamped);
    assert.equal(jsonOf(clamped).plugins.length, 4, 'limit 被夹到上限');
  });
});

serialTest('/marketplace/query：URL 非法时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/marketplace/query')
      .handler(makeReq('GET', { url: 'http://[bad' }), res);
    assert.equal(statusOf(res), 500);
  });
});

// ---------------------------------------------------------------------------
// /refresh 与 /sources/progress
// ---------------------------------------------------------------------------

serialTest('/sources/progress：没有刷新时 progress 为 null', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/sources/progress').handler(makeReq('GET'), res);
    assert.equal(statusOf(res), 200);
    assert.equal(jsonOf(res).progress, null);
  });
});

serialTest('/refresh：异步受理，刷新进行中时幂等返回 alreadyRunning', async () => {
  await withTempHome(async home => {
    // 本机假源服务：延迟响应，让刷新保持 active 一小会儿。
    const server = await startLocalServer((req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ version: 1, plugins: [{ name: 'local/one', category: 'tool' }] }));
      }, 150);
    });
    try {
      // 内置默认源显式停用：刷新它要 clone 整个仓库（联网），单测里必须躲开。
      await mkdir(join(home, 'plugin-manager'), { recursive: true });
      await writeFile(join(home, 'plugin-manager', 'sources.json'), JSON.stringify({
        version: 1,
        sources: [
          { id: 'awesome-dsh', enabled: false },
          { id: 'local-src', kind: 'index', url: server.url('/index.json'), enabled: true, addedAt: '2026-01-01T00:00:00.000Z' },
        ],
      }), 'utf8');

      const { routes } = boot();
      const route = routeOf(routes, '/dsh-plugin-manager/refresh');

      const accepted = makeRes();
      await route.handler(makeReq('POST'), accepted);
      assert.equal(statusOf(accepted), 202);
      assert.deepEqual(jsonOf(accepted), { ok: true, accepted: true });

      const running = await waitFor(() => readSourceRefreshProgress()?.active === true);
      assert.equal(running, true, '刷新应当进入进行中状态');

      const again = makeRes();
      await route.handler(makeReq('POST'), again);
      assert.equal(statusOf(again), 202);
      assert.deepEqual(jsonOf(again), { ok: true, alreadyRunning: true });

      const finished = await waitFor(() => readSourceRefreshProgress()?.active === false);
      assert.equal(finished, true, '刷新要收尾');

      const progressRes = makeRes();
      await routeOf(routes, '/dsh-plugin-manager/sources/progress').handler(makeReq('GET'), progressRes);
      assert.equal(statusOf(progressRes), 200);
      const progress = jsonOf(progressRes).progress;
      assert.equal(progress.active, false);
      assert.equal(progress.done, 1);
      assert.equal(progress.results.length, 1);
      assert.equal(progress.results[0].ok, true);

      // 刷新结果落进每源缓存，聚合时能看到。
      const cache = await readSourceCache('local-src');
      assert.equal(cache.plugins.length, 1);
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// /sources、/sources/add、/sources/remove、/sources/set-enabled
// ---------------------------------------------------------------------------

serialTest('/sources：列出源与每源缓存状态', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    await writeFile(join(home, 'plugin-manager', 'sources.json'), JSON.stringify({
      version: 1,
      sources: [
        { id: 'awesome-dsh', enabled: false },
        { id: 'good-src', kind: 'index', url: 'https://good.example/i.json', enabled: true },
      ],
    }), 'utf8');
    await mkdir(join(home, 'plugin-manager', 'sources-cache'), { recursive: true });
    await writeFile(join(home, 'plugin-manager', 'sources-cache', 'good-src.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(), plugins: [{ name: 'good/a', category: 'tool' }],
    }), 'utf8');

    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/sources').handler(makeReq('GET'), res);
    assert.equal(statusOf(res), 200);
    const payload = jsonOf(res);
    assert.equal(payload.ok, true);
    const byId = new Map(payload.sources.map(source => [source.id, source]));
    assert.equal(byId.get('awesome-dsh').enabled, false);
    assert.equal(byId.get('awesome-dsh').cache, null, '内置默认源不走每源缓存');
    assert.equal(byId.get('good-src').cache.state, 'ok');
    assert.equal(byId.get('good-src').cache.count, 1);
  });
});

serialTest('/sources：响应写不出去时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes({ failWrite: '客户端已断开' });
    await routeOf(routes, '/dsh-plugin-manager/sources').handler(makeReq('GET'), res);
    assert.deepEqual(res.calls.filter(call => call[0] === 'writeHead').map(call => call[1]), [200, 500]);
    assert.equal(jsonOf(res).error, '客户端已断开');
  });
});

serialTest('/sources/add：校验 kind/url，重复添加幂等', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/sources/add');

    const badKind = makeRes();
    await route.handler(makeReq('POST', { body: { kind: 'ftp', url: 'x' } }), badKind);
    assert.equal(statusOf(badKind), 400);
    assert.match(jsonOf(badKind).error, /kind/);

    const noUrl = makeRes();
    await route.handler(makeReq('POST', { body: { kind: 'index' } }), noUrl);
    assert.equal(statusOf(noUrl), 400);
    assert.match(jsonOf(noUrl).error, /地址/);

    const badIndex = makeRes();
    await route.handler(makeReq('POST', { body: { kind: 'index', url: 'ftp://x/i.json' } }), badIndex);
    assert.equal(statusOf(badIndex), 400);

    const badGit = makeRes();
    await route.handler(makeReq('POST', { body: { kind: 'git', url: 'https://gitlab.com/a/b' } }), badGit);
    assert.equal(statusOf(badGit), 400);

    const added = makeRes();
    await route.handler(makeReq('POST', { body: { kind: 'git', url: 'https://github.com/O/R.git' } }), added);
    assert.equal(statusOf(added), 200);
    assert.equal(jsonOf(added).source.id, 'o-r');
    assert.equal(jsonOf(added).source.url, 'github:O/R');

    const again = makeRes();
    await route.handler(makeReq('POST', { body: { kind: 'git', url: 'github:o/r' } }), again);
    assert.equal(statusOf(again), 200);
    assert.equal(jsonOf(again).alreadyAdded, true);
  });
});

serialTest('/sources/remove：缺 id / 不存在 / 删除成功 / 默认源不可删', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/sources/add');
    const remove = routeOf(routes, '/dsh-plugin-manager/sources/remove');

    const missing = makeRes();
    await remove.handler(makeReq('POST', { body: {} }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /源 id/);

    const unknown = makeRes();
    await remove.handler(makeReq('POST', { body: { id: 'nope' } }), unknown);
    assert.equal(statusOf(unknown), 400);
    assert.equal(jsonOf(unknown).ok, false);

    const added = makeRes();
    await route.handler(makeReq('POST', { body: { kind: 'index', url: 'https://example.com/i.json' } }), added);
    const id = jsonOf(added).source.id;

    const removed = makeRes();
    await remove.handler(makeReq('POST', { body: { id } }), removed);
    assert.equal(statusOf(removed), 200);
    assert.equal(jsonOf(removed).removed, id);

    const builtin = makeRes();
    await remove.handler(makeReq('POST', { body: { id: 'awesome-dsh' } }), builtin);
    assert.equal(statusOf(builtin), 400);
    assert.match(jsonOf(builtin).error, /默认源/);
  });
});

serialTest('/sources/set-enabled：参数校验与启停', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const add = routeOf(routes, '/dsh-plugin-manager/sources/add');
    const setEnabled = routeOf(routes, '/dsh-plugin-manager/sources/set-enabled');

    const missingId = makeRes();
    await setEnabled.handler(makeReq('POST', { body: { enabled: true } }), missingId);
    assert.equal(statusOf(missingId), 400);
    assert.match(jsonOf(missingId).error, /源 id/);

    const missingEnabled = makeRes();
    await setEnabled.handler(makeReq('POST', { body: { id: 'x' } }), missingEnabled);
    assert.equal(statusOf(missingEnabled), 400);

    const unknown = makeRes();
    await setEnabled.handler(makeReq('POST', { body: { id: 'nope', enabled: true } }), unknown);
    assert.equal(statusOf(unknown), 400);
    assert.equal(jsonOf(unknown).ok, false);

    const added = makeRes();
    await add.handler(makeReq('POST', { body: { kind: 'index', url: 'https://example.com/i.json' } }), added);
    const id = jsonOf(added).source.id;

    const disabled = makeRes();
    await setEnabled.handler(makeReq('POST', { body: { id, enabled: false } }), disabled);
    assert.equal(statusOf(disabled), 200);
    assert.equal(jsonOf(disabled).source.enabled, false);

    const config = await readSourcesConfig();
    assert.equal(config.sources.find(source => source.id === id).enabled, false);
  });
});

serialTest('/sources/*：请求体非法 JSON 时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    for (const path of [
      '/dsh-plugin-manager/sources/add',
      '/dsh-plugin-manager/sources/remove',
      '/dsh-plugin-manager/sources/set-enabled',
    ]) {
      const res = makeRes();
      await routeOf(routes, path).handler(makeReq('POST', { body: 'not-json' }), res);
      assert.equal(statusOf(res), 500, path);
    }
  });
});

// ---------------------------------------------------------------------------
// /china-mirror 与 /china-mirror/set
// ---------------------------------------------------------------------------

serialTest('/china-mirror：读镜像插件状态；插件不在时按关闭处理', async () => {
  await withTempHome(async () => {
    const previousPort = process.env.DSH_PORT;
    const server = await startLocalServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ enabled: true, table: [{ match: 'https://registry.npmjs.org/', replace: 'https://registry.npmmirror.com/' }] }));
    });
    process.env.DSH_PORT = String(server.port);
    try {
      const { routes } = boot();
      const res = makeRes();
      await routeOf(routes, '/dsh-plugin-manager/china-mirror').handler(makeReq('GET'), res);
      assert.equal(statusOf(res), 200);
      const payload = jsonOf(res);
      assert.equal(payload.ok, true);
      assert.equal(payload.enabled, true);
      assert.equal(payload.pluginPresent, true);
      assert.equal(payload.table.length, 1);
    } finally {
      await server.close();
      if (previousPort === undefined) delete process.env.DSH_PORT;
      else process.env.DSH_PORT = previousPort;
    }
  });
});

serialTest('/china-mirror：响应写不出去时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes({ failWrite: '客户端已断开' });
    await routeOf(routes, '/dsh-plugin-manager/china-mirror').handler(makeReq('GET'), res);
    assert.deepEqual(res.calls.filter(call => call[0] === 'writeHead').map(call => call[1]), [200, 500]);
    assert.equal(jsonOf(res).error, '客户端已断开');
  });
});

serialTest('/china-mirror/set：缺 enabled / 镜像插件不在 / 正常写入', async () => {
  await withTempHome(async () => {
    const previousPort = process.env.DSH_PORT;
    let served = false;
    const server = await startLocalServer((req, res) => {
      if (!served) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '镜像插件没装' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ enabled: true, table: [] }));
    });
    process.env.DSH_PORT = String(server.port);
    try {
      const { routes } = boot();
      const route = routeOf(routes, '/dsh-plugin-manager/china-mirror/set');

      const missing = makeRes();
      await route.handler(makeReq('POST', { body: {} }), missing);
      assert.equal(statusOf(missing), 400);
      assert.match(jsonOf(missing).error, /enabled/);

      const unavailable = makeRes();
      await route.handler(makeReq('POST', { body: { enabled: true } }), unavailable);
      assert.equal(statusOf(unavailable), 502);
      assert.match(jsonOf(unavailable).error, /镜像插件/);

      served = true;
      const ok = makeRes();
      await route.handler(makeReq('POST', { body: { enabled: true } }), ok);
      assert.equal(statusOf(ok), 200);
      assert.equal(jsonOf(ok).ok, true);
      assert.equal(jsonOf(ok).enabled, true);
    } finally {
      await server.close();
      if (previousPort === undefined) delete process.env.DSH_PORT;
      else process.env.DSH_PORT = previousPort;
    }
  });
});

// ---------------------------------------------------------------------------
// /install、/uninstall、/uninstall-many、/update、/update-many、/cleanup
// ---------------------------------------------------------------------------

serialTest('/install：缺插件标识回 400；标识不全时返回安装失败', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/install');

    const missing = makeRes();
    await route.handler(makeReq('POST', { body: {} }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /缺少/);

    // 没有 name 时不会去探测 npm / clone 源码（那是联网路径），直接失败。
    const failed = makeRes();
    await route.handler(makeReq('POST', { body: { url: 'https://example.com/x' } }), failed);
    assert.equal(statusOf(failed), 200);
    assert.equal(jsonOf(failed).ok, false);
    assert.ok(jsonOf(failed).error);
  });
});

serialTest('/uninstall：缺插件名回 400；内置插件拒绝；普通插件走命令失败', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/uninstall');

    const missing = makeRes();
    await route.handler(makeReq('POST', { body: {} }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /缺少/);

    const protectedRes = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-plugin-manager' } }), protectedRes);
    assert.equal(statusOf(protectedRes), 200);
    assert.equal(jsonOf(protectedRes).ok, false);
    assert.match(jsonOf(protectedRes).error, /内置插件/);

    // 临时 home 里没有 dsh CLI，卸载命令必然失败：失败要如实回给前端。
    const failed = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-demo' } }), failed);
    assert.equal(statusOf(failed), 200);
    assert.equal(jsonOf(failed).ok, false);
    assert.ok(jsonOf(failed).error);
  });
});

serialTest('/uninstall-many：空列表回 400；逐个给结果', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/uninstall-many');

    const missing = makeRes();
    await route.handler(makeReq('POST', { body: {} }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /缺少/);

    const empty = makeRes();
    await route.handler(makeReq('POST', { body: { names: [] } }), empty);
    assert.equal(statusOf(empty), 400);

    const many = makeRes();
    await route.handler(makeReq('POST', { body: { names: ['dsh-a', 'dsh-plugin-manager'] } }), many);
    assert.equal(statusOf(many), 200);
    const payload = jsonOf(many);
    assert.equal(payload.ok, false);
    assert.equal(payload.results.length, 2);
    assert.equal(payload.results[1].ok, false, '内置插件卸载失败');
  });
});

serialTest('/update：缺插件名回 400；未安装的插件如实回报', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/update');

    const missing = makeRes();
    await route.handler(makeReq('POST', { body: {} }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /缺少/);

    const unknown = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-demo' } }), unknown);
    assert.equal(statusOf(unknown), 200);
    assert.equal(jsonOf(unknown).ok, false);
    assert.equal(jsonOf(unknown).status, 'unknown');

    // dev-linked 的两种显式动作也要能被透传（这里同样落在「没找到插件」）。
    const pullLocal = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-demo', mode: 'pull-local' } }), pullLocal);
    assert.equal(statusOf(pullLocal), 200);
    assert.equal(jsonOf(pullLocal).ok, false);
  });
});

serialTest('/update-many：空列表回 400；受理后返回 202 并在后台跑', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/update-many');

    const missing = makeRes();
    await route.handler(makeReq('POST', { body: {} }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /缺少/);

    const accepted = makeRes();
    await route.handler(makeReq('POST', { body: { names: ['dsh-demo'] } }), accepted);
    assert.equal(statusOf(accepted), 202);
    assert.deepEqual(jsonOf(accepted), { ok: true, accepted: 1, names: ['dsh-demo'] });

    const done = await waitFor(() => isBatchUpdateRunning() === false);
    assert.equal(done, true, '后台批量更新要收尾');
  });
});

serialTest('/cleanup：缺插件名回 400；必需组件拒绝清理；普通插件清理成功', async () => {
  await withTempHome(async home => {
    await writeInstalledPlugin(home, 'dsh-broken');
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/cleanup');

    const missing = makeRes();
    await route.handler(makeReq('POST', { body: {} }), missing);
    assert.equal(statusOf(missing), 400);
    assert.match(jsonOf(missing).error, /缺少/);

    const protectedRes = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-plugin-manager' } }), protectedRes);
    assert.equal(statusOf(protectedRes), 500, '必需组件清理失败要回 500');

    const ok = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-broken' } }), ok);
    assert.equal(statusOf(ok), 200);
    assert.deepEqual(jsonOf(ok), { ok: true });
  });
});

serialTest('批量更新进行中：install/uninstall/uninstall-many/cleanup/update/update-many 一律 409', async () => {
  await withTempHome(async home => {
    await writeInstalledPlugin(home, 'dsh-demo');
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['dsh-demo'] } },
    }), 'utf8');

    // 用一个「卡住」的批次把互斥标志按住：check/command 都是注入的假实现，不碰网络。
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const running = updatePlugins(['dsh-demo'], {
      check: async () => [{ name: 'dsh-demo', status: 'update-available', latestVersion: '2.0.0', error: null }],
      command: async () => { await gate; },
    });
    const started = await waitFor(() => isBatchUpdateRunning() === true);
    assert.equal(started, true, '批次应当在跑');

    const { routes } = boot();
    const guarded = [
      ['/dsh-plugin-manager/install', { url: 'https://example.com/x' }],
      ['/dsh-plugin-manager/uninstall', { name: 'dsh-demo' }],
      ['/dsh-plugin-manager/uninstall-many', { names: ['dsh-demo'] }],
      ['/dsh-plugin-manager/cleanup', { name: 'dsh-demo' }],
      ['/dsh-plugin-manager/update', { name: 'dsh-demo' }],
    ];
    for (const [path, body] of guarded) {
      const res = makeRes();
      await routeOf(routes, path).handler(makeReq('POST', { body }), res);
      assert.equal(statusOf(res), 409, path + ' 在批量更新期间必须拒绝');
      assert.match(jsonOf(res).error, /批量更新/, path);
    }

    const many = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/update-many')
      .handler(makeReq('POST', { body: { names: ['dsh-demo'] } }), many);
    assert.equal(statusOf(many), 409);
    assert.match(jsonOf(many).error, /批量更新/);

    release();
    await running;
    assert.equal(isBatchUpdateRunning(), false, '批次结束后要放行');
  });
});

// ---------------------------------------------------------------------------
// /updates、/release-notes、/ignore、/unignore、/restart
// ---------------------------------------------------------------------------

serialTest('/updates：返回检测结果与进度', async () => {
  await withTempHome(async home => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/updates');

    const res = makeRes();
    await route.handler(makeReq('GET'), res);
    assert.equal(statusOf(res), 200);
    const payload = jsonOf(res);
    assert.ok(Array.isArray(payload.inventory));
    assert.ok(payload.summary);

    const forced = makeRes();
    await route.handler(makeReq('GET', { url: '/dsh-plugin-manager/updates?refresh=1' }), forced);
    assert.equal(statusOf(forced), 200);
    assert.ok(Array.isArray(jsonOf(forced).inventory));

    // 检测是后台跑的（接口不阻塞），等它把缓存写完再收尾：
    // 否则它会写进下一个用例的临时目录。
    const written = await waitFor(async () => {
      try {
        await readFile(join(home, 'profiles', 'web', '.plugin-updates.json'), 'utf8');
        return true;
      } catch { return false; }
    }, { timeoutMs: 10000 });
    assert.equal(written, true, '后台检测要写出缓存');
  });
});

serialTest('/updates：URL 非法时回 500；客户端断开时不炸', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/updates');

    const bad = makeRes();
    await route.handler(makeReq('GET', { url: 'http://[bad' }), bad);
    assert.equal(statusOf(bad), 500);
    assert.ok(jsonOf(bad).error);

    const broken = makeRes({ failWrite: '客户端已断开' });
    await route.handler(makeReq('GET'), broken);
    assert.deepEqual(broken.calls.filter(call => call[0] === 'writeHead').map(call => call[1]), [200]);
  });
});

serialTest('/release-notes：缺参数回 400；没有仓库信息时如实回报', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/release-notes');

    const missingName = makeRes();
    await route.handler(makeReq('POST', { body: { version: '2.0.0' } }), missingName);
    assert.equal(statusOf(missingName), 400);
    assert.match(jsonOf(missingName).error, /缺少/);

    const missingVersion = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-demo' } }), missingVersion);
    assert.equal(statusOf(missingVersion), 400);

    const unknown = makeRes();
    await route.handler(makeReq('POST', { body: { name: 'dsh-demo', version: '2.0.0' } }), unknown);
    assert.equal(statusOf(unknown), 200);
    assert.equal(jsonOf(unknown).ok, false);
    assert.match(jsonOf(unknown).error, /GitHub/);
  });
});

serialTest('/ignore 与 /unignore：写记录 / 取消忽略 / 空请求拒绝', async () => {
  await withTempHome(async home => {
    const { routes } = boot();
    const ignore = routeOf(routes, '/dsh-plugin-manager/ignore');
    const unignore = routeOf(routes, '/dsh-plugin-manager/unignore');

    const empty = makeRes();
    await ignore.handler(makeReq('POST', { body: {} }), empty);
    assert.equal(statusOf(empty), 400);
    assert.match(jsonOf(empty).error, /缺少/);

    const ok = makeRes();
    await ignore.handler(makeReq('POST', { body: { items: [{ name: 'dsh-demo', version: '2.0.0' }] } }), ok);
    assert.equal(statusOf(ok), 200);
    assert.deepEqual(jsonOf(ok), { ok: true, ignored: ['dsh-demo'], failed: [] });
    const record = JSON.parse(await readFile(join(home, 'profiles', 'web', '.plugin-updates-ignored.json'), 'utf8'));
    assert.equal(record['dsh-demo'].version, '2.0.0');

    const badUnignore = makeRes();
    await unignore.handler(makeReq('POST', { body: {} }), badUnignore);
    assert.equal(statusOf(badUnignore), 400);
    assert.match(jsonOf(badUnignore).error, /缺少/);

    const removed = makeRes();
    await unignore.handler(makeReq('POST', { body: { names: ['dsh-demo'] } }), removed);
    assert.deepEqual(jsonOf(removed), { ok: true, unignored: ['dsh-demo'] });
    assert.deepEqual(JSON.parse(await readFile(join(home, 'profiles', 'web', '.plugin-updates-ignored.json'), 'utf8')), {});
  });
});

serialTest('/restart：先回 200，再优雅退出 dsh 进程', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const originalExit = process.exit;
    let exitCode = null;
    process.exit = (code) => { exitCode = code; };
    try {
      const res = makeRes();
      await routeOf(routes, '/dsh-plugin-manager/restart').handler(makeReq('POST'), res);
      assert.equal(statusOf(res), 200);
      assert.deepEqual(jsonOf(res), { ok: true, restarting: true });
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.equal(exitCode, 0, '要退出进程让启动器拉起新的 dsh');
    } finally {
      process.exit = originalExit;
    }
  });
});

// ---------------------------------------------------------------------------
// /ai-search 与 /ai-search/stream
// ---------------------------------------------------------------------------

serialTest('/ai-search：没有模型时按关键词降级；查询为空回 400', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '把会话导出成 Markdown', stars: 10, downloads: 20 },
    ]);
    const { routes } = boot();
    const route = routeOf(routes, '/dsh-plugin-manager/ai-search');

    const empty = makeRes();
    await route.handler(makeReq('POST', { body: {} }), empty);
    assert.equal(statusOf(empty), 400);
    assert.match(jsonOf(empty).error, /描述/);

    const fallback = makeRes();
    await route.handler(makeReq('POST', { body: { query: '把会话导出成 markdown' } }), fallback);
    assert.equal(statusOf(fallback), 200);
    const payload = jsonOf(fallback);
    assert.equal(payload.ok, true);
    assert.equal(payload.fallback, true);
    assert.equal(payload.items[0].name, 'session-export');
  });
});

serialTest('/ai-search：有模型时由模型在候选里挑', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '把会话导出成 Markdown', stars: 10, downloads: 20 },
      { id: 'b', name: 'token-ledger', repo: 'o/token-ledger', category: 'data', descriptionZh: 'token 记账', stars: 99, downloads: 900 },
    ]);
    const llm = fakeLlm({
      models: [{ id: 'p1/flash-model', name: 'Flash', text: 'answer_num: 1, answer_relevance: 9, why: 正好是导出会话\n' }],
    });
    const { routes } = boot(llm);
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/ai-search')
      .handler(makeReq('POST', { body: { query: '把会话导出成 markdown' } }), res);
    assert.equal(statusOf(res), 200);
    const payload = jsonOf(res);
    assert.equal(payload.fallback, false);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].name, 'session-export');
    assert.equal(payload.items[0].reason, '正好是导出会话');
  });
});

serialTest('/ai-search：请求体非法 JSON 时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/ai-search')
      .handler(makeReq('POST', { body: '{oops' }), res);
    assert.equal(statusOf(res), 500);
  });
});

serialTest('/ai-search/stream：NDJSON 逐行输出，每行都是合法 JSON', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '把会话导出成 Markdown', stars: 10, downloads: 20 },
    ]);
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/ai-search/stream')
      .handler(makeReq('POST', { body: { query: '把会话导出成 markdown' } }), res);
    assert.equal(statusOf(res), 200);
    assert.match(res.headers['content-type'], /ndjson/);
    const events = ndjsonOf(res);
    assert.ok(events.length >= 4);
    for (const event of events) {
      assert.equal(typeof event.step, 'string');
      assert.ok('data' in event);
      assert.equal(typeof event.at, 'number');
    }
    const steps = events.map(event => event.step);
    assert.deepEqual(steps[0], 'start');
    assert.ok(steps.includes('index'));
    assert.ok(steps.includes('candidates'));
    assert.equal(steps[steps.length - 1], 'done');
    const done = events[events.length - 1];
    assert.equal(done.data.ok, true);
    assert.equal(done.data.fallback, true);
  });
});

serialTest('/ai-search/stream：请求体非法 JSON 时写一行 error 事件', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/ai-search/stream')
      .handler(makeReq('POST', { body: '{oops' }), res);
    const events = ndjsonOf(res);
    assert.equal(events.length, 1);
    assert.equal(events[0].step, 'error');
    assert.ok(events[0].data.error);
  });
});
// ---------------------------------------------------------------------------
// 路由层的错误分支：下游抛错 / 响应写不出去，一律回 500 而不是把异常抛出去
// ---------------------------------------------------------------------------

serialTest('读请求体的路由：请求体读失败时回 500 并如实回出原因', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const bodyRoutes = [
      '/dsh-plugin-manager/set-disabled',
      '/dsh-plugin-manager/ai-search',
      '/dsh-plugin-manager/sources/add',
      '/dsh-plugin-manager/sources/remove',
      '/dsh-plugin-manager/sources/set-enabled',
      '/dsh-plugin-manager/china-mirror/set',
      '/dsh-plugin-manager/install',
      '/dsh-plugin-manager/uninstall',
      '/dsh-plugin-manager/update',
      '/dsh-plugin-manager/release-notes',
      '/dsh-plugin-manager/ignore',
      '/dsh-plugin-manager/unignore',
      '/dsh-plugin-manager/update-many',
      '/dsh-plugin-manager/uninstall-many',
      '/dsh-plugin-manager/cleanup',
    ];
    for (const path of bodyRoutes) {
      const res = makeRes();
      await routeOf(routes, path).handler(makeReq('POST', { bodyThrows: '请求体读失败' }), res);
      assert.equal(statusOf(res), 500, path);
      assert.equal(jsonOf(res).error, '请求体读失败', path);
    }
  });
});

serialTest('解析请求行的路由：URL 读不出来时回 500', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    for (const path of [
      '/dsh-plugin-manager/disabled',
      '/dsh-plugin-manager/marketplace/query',
      '/dsh-plugin-manager/updates',
    ]) {
      const res = makeRes();
      await routeOf(routes, path).handler(makeReq('GET', { throwOnUrl: '请求行不可解析' }), res);
      assert.equal(statusOf(res), 500, path);
      assert.equal(jsonOf(res).error, '请求行不可解析', path);
    }
  });
});

serialTest('/ai-search/stream：请求体读失败时写一行 error 事件', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/ai-search/stream')
      .handler(makeReq('POST', { bodyThrows: '请求体读失败' }), res);
    const events = ndjsonOf(res);
    assert.equal(events.length, 1);
    assert.equal(events[0].step, 'error');
    assert.equal(events[0].data.error, '请求体读失败');
  });
});

serialTest('/ai-search/stream：客户端断开时事件写不出去也不能把流程带崩', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 1 },
    ]);
    const { routes } = boot();
    const res = makeRes({ failWriteLine: '客户端已断开' });
    await routeOf(routes, '/dsh-plugin-manager/ai-search/stream')
      .handler(makeReq('POST', { body: { query: '导出' } }), res);
    assert.ok(res.chunks.length > 0, '事件确实尝试写过');
    assert.ok(res.calls.some(call => call[0] === 'end'), '流程要正常收尾');
  });
});

serialTest('/ai-search/stream：错误事件也写不出去时不能把异常抛出去', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes({ failWriteLine: '客户端已断开' });
    await routeOf(routes, '/dsh-plugin-manager/ai-search/stream')
      .handler(makeReq('POST', { bodyThrows: '请求体读失败' }), res);
    assert.ok(res.chunks.length > 0);
  });
});

serialTest('/updates：500 也写不出去时不能把异常抛出去', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes({ failWriteAlways: '写不出去' });
    await routeOf(routes, '/dsh-plugin-manager/updates')
      .handler(makeReq('GET', { throwOnUrl: '请求行不可解析' }), res);
    assert.ok(res.calls.length > 0);
  });
});

serialTest('没有请求体的 POST：按空 JSON 处理（缺参数走 400 而不是崩）', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes();
    await routeOf(routes, '/dsh-plugin-manager/install').handler(makeReq('POST'), res);
    assert.equal(statusOf(res), 400);
    assert.match(jsonOf(res).error, /缺少/);
  });
});

// ---------------------------------------------------------------------------
// 源缓存与聚合
// ---------------------------------------------------------------------------

serialTest('源缓存：文件缺失/坏掉/结构不对都读成 null，正常索引原样读出', async () => {
  await withTempHome(async home => {
    const cacheDir = join(home, 'plugin-manager', 'sources-cache');
    await mkdir(cacheDir, { recursive: true });

    assert.equal(await readSourceCache('missing'), null, '文件不存在');
    await writeFile(join(cacheDir, 'broken.json'), '{不是 json', 'utf8');
    assert.equal(await readSourceCache('broken'), null, '坏 JSON');
    await writeFile(join(cacheDir, 'shape.json'), JSON.stringify({ nope: 1 }), 'utf8');
    assert.equal(await readSourceCache('shape'), null, '没有 plugins 数组');

    await writeFile(join(cacheDir, 'ok.json'), JSON.stringify({
      fetchedAt: '2026-01-01T00:00:00.000Z', plugins: [{ name: 'a/b', category: 'tool' }],
    }), 'utf8');
    const cache = await readSourceCache('ok');
    assert.equal(cache.plugins.length, 1);
    assert.equal(cache.plugins[0].name, 'a/b');
  });
});

serialTest('聚合：停用的源、没有缓存的源、过期缓存、坏条目都各有各的状态', async () => {
  await withTempHome(async home => {
    const manager = join(home, 'plugin-manager');
    const cacheDir = join(manager, 'sources-cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(manager, 'sources.json'), JSON.stringify({
      version: 1,
      sources: [
        { id: 'awesome-dsh', enabled: true },
        { id: 'off-src', kind: 'index', url: 'https://off.example/i.json', enabled: false },
        { id: 'empty-src', kind: 'index', url: 'https://empty.example/i.json', enabled: true },
        { id: 'stale-src', kind: 'index', url: 'https://stale.example/i.json', enabled: true },
        { id: 'nofetched-src', kind: 'index', url: 'https://nofetched.example/i.json', enabled: true },
        { id: 'noplugins-src', kind: 'index', url: 'https://noplugins.example/i.json', enabled: true },
        { id: 'ok-src', kind: 'index', url: 'https://ok.example/i.json', enabled: true },
      ],
    }), 'utf8');
    await writeFile(join(cacheDir, 'stale-src.json'), JSON.stringify({
      fetchedAt: '2020-01-01T00:00:00.000Z', plugins: [{ name: 'stale/a' }],
    }), 'utf8');
    await writeFile(join(cacheDir, 'nofetched-src.json'), JSON.stringify({
      plugins: [{ name: 'nofetched/a' }],
    }), 'utf8');
    await writeFile(join(cacheDir, 'noplugins-src.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(),
    }), 'utf8');
    await writeFile(join(cacheDir, 'ok-src.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(),
      plugins: [{ name: 'ok/a', category: 'tool' }, { noName: true }],
    }), 'utf8');

    const aggregated = await aggregateCachedSources();
    const states = new Map(aggregated.perSource.map(item => [item.id, item]));
    assert.equal(states.get('off-src').state, 'disabled');
    assert.equal(states.get('empty-src').state, 'empty');
    assert.equal(states.get('stale-src').state, 'stale');
    assert.equal(states.get('nofetched-src').state, 'stale', '没有 fetchedAt 的缓存按过期算');
    assert.equal(states.get('noplugins-src').state, 'empty', '没有 plugins 数组的缓存不可用');
    assert.equal(states.get('noplugins-src').count, 0);
    assert.equal(states.get('ok-src').state, 'ok');
    assert.equal(states.get('ok-src').count, 1, '没有名字的条目要被丢掉');
    assert.equal(states.get('awesome-dsh'), undefined, '内置默认源走市场主索引，不参与每源聚合');
    assert.deepEqual(aggregated.plugins.map(item => item.name).sort(), ['nofetched/a', 'ok/a', 'stale/a']);
  });
});

serialTest('refreshPluginSources：默认源与自定义源的成功/失败都要如实记账', async () => {
  await withTempHome(async home => {
    const manager = join(home, 'plugin-manager');
    await mkdir(manager, { recursive: true });
    await writeFile(join(manager, 'sources.json'), JSON.stringify({
      version: 1,
      sources: [
        { id: 'awesome-dsh', enabled: true },
        { id: 'good-src', kind: 'index', url: 'https://good.example/i.json', enabled: true },
        { id: 'bad-src', kind: 'index', url: 'https://bad.example/i.json', enabled: true },
      ],
    }), 'utf8');

    const fetchImpl = async (url) => (String(url).startsWith('https://good.example')
      ? { ok: true, status: 200, json: async () => ({ version: 1, plugins: [{ name: 'good/a', category: 'tool' }] }) }
      : { ok: false, status: 500, json: async () => ({}) });

    // 默认源刷新失败：不能拖垮其它源。
    const failed = await refreshPluginSources({
      fetch: fetchImpl,
      refreshMarketplace: async () => { throw new Error('clone 失败'); },
    });
    assert.equal(failed.sources, 3);
    assert.equal(failed.plugins, 1, '只有好源贡献了插件');
    assert.ok(failed.errors.some(line => line.includes('awesome-dsh')));
    assert.ok(failed.errors.some(line => line.includes('bad-src')));
    let progress = readSourceRefreshProgress();
    assert.equal(progress.active, false);
    assert.notEqual(progress.finishedAt, null);
    assert.equal(progress.results.length, 3);
    assert.equal(progress.results.find(item => item.id === 'good-src').ok, true);

    // 默认源刷新成功：计数要加上。
    const ok = await refreshPluginSources({
      fetch: fetchImpl,
      refreshMarketplace: async () => ({ count: 7, official: 0, categories: [], indexedAt: null }),
    });
    assert.equal(ok.plugins, 8);
    assert.equal(ok.errors.length, 1, '只有坏源失败');
    assert.ok(ok.errors[0].includes('bad-src'));
    progress = readSourceRefreshProgress();
    assert.equal(progress.results.find(item => item.id === 'awesome-dsh').count, 7);

    // 好源的索引落进缓存，聚合时能看到。
    const cache = await readSourceCache('good-src');
    assert.equal(cache.plugins.length, 1);
  });
});

serialTest('refreshPluginSources：缓存写失败不影响刷新结果', async () => {
  await withTempHome(async home => {
    const manager = join(home, 'plugin-manager');
    await mkdir(manager, { recursive: true });
    // 缓存目录被一个同名文件占住：写缓存必然失败，但刷新本身要成功。
    await writeFile(join(manager, 'sources-cache'), 'not a directory', 'utf8');
    await writeFile(join(manager, 'sources.json'), JSON.stringify({
      version: 1,
      sources: [{ id: 'good-src', kind: 'index', url: 'https://good.example/i.json', enabled: true }],
    }), 'utf8');

    const summary = await refreshPluginSources({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ plugins: [{ name: 'good/a' }] }) }),
      refreshMarketplace: async () => ({ count: 0 }),
    });
    assert.deepEqual(summary.errors, [], '缓存写失败不算源失败');
    assert.equal(summary.plugins, 1);
  });
});

// ---------------------------------------------------------------------------
// 分类归并
// ---------------------------------------------------------------------------

serialTest('分类归并：脏分类归 other，未知分类回落到分类 id 本身', async () => {
  assert.equal(normalizeCategory(''), 'other');
  assert.equal(normalizeCategory(undefined), 'other');
  assert.equal(normalizeCategory('tools # 见下方分类列表'), 'other', '模板注释不是分类');
  assert.equal(normalizeCategory('official 9'), 'other');
  assert.equal(normalizeCategory('UI'), 'ui');
  assert.equal(marketGroupOf('browser'), 'other');
  assert.equal(marketGroupOf('ui'), 'ui');
  assert.equal(marketGroupLabel('ui'), '界面');
  assert.equal(marketGroupLabel('nope'), '其他');
  assert.equal(marketCategoryLabel('ui'), '界面');
  assert.equal(marketCategoryLabel('zzz'), 'zzz', '没登记过的分类回落到分类 id 本身');
});

// ---------------------------------------------------------------------------
// 市场查询
// ---------------------------------------------------------------------------

serialTest('queryMarketplace：参数类型不对要回落默认值，排序与分页都要生效', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui', addedDate: '2026-01-01' },
      { id: 'b', name: 'pkg-b', repo: 'o/pkg-b', category: 'ui', addedDate: '2026-02-01', stars: 3, downloads: 4 },
    ]);
    // 参数不是字符串 → 走默认值。
    const fallback = await queryMarketplace({ category: 1, group: 2, source: 3, sort: 4 });
    assert.equal(fallback.total, 2);

    // sort=newest：按加入日期降序。
    const newest = await queryMarketplace({ sort: 'newest' });
    assert.equal(newest.plugins[0].name, 'pkg-b');
    assert.equal(newest.plugins[1].name, 'pkg-a');

    // 没有星标/下载量的条目按 0 算，不能崩。
    assert.equal(newest.plugins.length, 2);

    // limit/offset 越界要被夹住。
    const clamped = await queryMarketplace({ limit: 0, offset: -5 });
    assert.equal(clamped.plugins.length, 2, 'limit 下限是 1');
    assert.equal(clamped.total, 2);
  });
});

serialTest('queryMarketplace：索引缺字段时要有兜底，3 秒内的重复查询走缓存', async () => {
  await withTempHome(async home => {
    const dir = join(home, 'plugin-market');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.json'), JSON.stringify({
      version: 2, plugins: [{ id: 'a', name: 'pkg-a', category: 'ui' }],
    }), 'utf8');

    const first = await queryMarketplace({});
    assert.equal(first.total, 1);
    assert.equal(first.indexedAt, null, '索引没有 indexedAt 时回落到 null');
    assert.deepEqual(first.categories, [], '索引没有 categories 时回落到空数组');
    assert.deepEqual(first.sources, []);

    // 同一 home 的第二次查询命中 3 秒缓存。
    const second = await queryMarketplace({});
    assert.equal(second.total, 1);
  });
});

serialTest('readMarketplaceAggregated：官方索引缺失时也能把自定义源的插件聚进来', async () => {
  await withTempHome(async home => {
    const manager = join(home, 'plugin-manager');
    const cacheDir = join(manager, 'sources-cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(manager, 'sources.json'), JSON.stringify({
      version: 1,
      sources: [{ id: 'my-src', kind: 'index', url: 'https://my.example/i.json', enabled: true }],
    }), 'utf8');
    await writeFile(join(cacheDir, 'my-src.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(), plugins: [{ name: 'my/a', category: 'data' }],
    }), 'utf8');

    const market = await readMarketplaceAggregated();
    assert.equal(market.ok, false, '没有官方索引时如实说未就绪');
    assert.equal(market.plugins.length, 1);
    assert.equal(market.plugins[0].name, 'my/a');
    assert.equal(market.count, 1);
    assert.deepEqual(market.categories, ['data']);
    assert.equal(market.sources.length, 1);
    assert.equal(market.sources[0].id, 'my-src');
  });
});

// ---------------------------------------------------------------------------
// 关键词预筛与提示词
// ---------------------------------------------------------------------------

serialTest('keywordVariants 与 rankPluginsByKeywords：空输入与脏字段都要兜住', async () => {
  assert.deepEqual(keywordVariants(''), []);
  assert.deepEqual(keywordVariants('a'), []);
  assert.deepEqual(keywordVariants('ab'), ['ab']);
  assert.deepEqual(keywordVariants('侧边栏'), ['侧边栏', '侧边', '边栏']);

  assert.deepEqual(rankPluginsByKeywords([], 'anything'), []);
  assert.deepEqual(rankPluginsByKeywords(null, 'anything'), [], '插件列表不是数组');
  assert.deepEqual(rankPluginsByKeywords([{ name: 'a' }], ''), [], '空查询');
  assert.deepEqual(rankPluginsByKeywords([{ name: 'a' }], '   '), [], '空白查询');
  assert.deepEqual(rankPluginsByKeywords([{ name: 'a' }], '!!!'), [], '全是符号，没有 token');
  assert.deepEqual(rankPluginsByKeywords([null, { name: 'a' }], 'zzz'), [], '空条目要跳过');

  // 分类命中、描述命中、名称命中的权重不同。
  const ranked = rankPluginsByKeywords([
    { name: 'alpha', repo: 'o/alpha', descriptionEn: 'nothing', category: 'other' },
    { name: 'beta', repo: 'o/beta', descriptionEn: 'alpha helper', category: 'other' },
    { name: 'gamma', repo: 'o/gamma', descriptionEn: 'nothing', category: 'alpha-tools' },
  ], 'alpha');
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].name, 'alpha', '名称命中权重最高');
});

serialTest('buildPluginSearchPrompt：缺字段的候选也要能拼成候选行', async () => {
  const prompt = buildPluginSearchPrompt('我要什么', [
    { name: 'no-repo', category: '', descriptionZh: '', downloads: 'x', stars: null },
  ]);
  const line = prompt.split('\n').find(item => item.startsWith('[1] '));
  assert.ok(line, '候选行要存在');
  assert.ok(line.includes('（无描述）'));
  assert.ok(line.includes('other'), '分类缺失时归 other');
});

serialTest('parseSearchPicks：行格式、宽松格式、JSON 格式与名称反查都要认', () => {
  const candidates = [{ name: 'a/one', repo: 'a/one' }, { name: 'b/two', repo: 'b/two' }];

  // 行格式。
  const lines = parseSearchPicks('answer_num: 2, answer_relevance: 9, why: 很合适', 2, candidates);
  assert.deepEqual(lines.map(pick => pick.index), [1]);
  assert.equal(lines[0].score, 9);
  assert.equal(lines[0].why, '很合适');

  // 只有编号的宽松格式。
  const loose = parseSearchPicks('answer_num: 1', 2, candidates);
  assert.deepEqual(loose.map(pick => pick.index), [0]);
  assert.equal(loose[0].score, 1);

  // JSON 格式：picks 数组、纯数字数组、名称反查。
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":2,"why":"x"}]}', 2, candidates).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"index":1}]}', 2, candidates).map(pick => pick.index), [0]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"n":1}]}', 2, candidates).map(pick => pick.index), [0]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"num":1}]}', 2, candidates).map(pick => pick.index), [0]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"id":1}]}', 2, candidates).map(pick => pick.index), [0]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"name":"b/two"}]}', 2, candidates).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"repo":"b/two"}]}', 2, candidates).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[1]}', 2, candidates).map(pick => pick.index), [0]);
  assert.deepEqual(parseSearchPicks('{"picks":["2"]}', 2, candidates).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[null,"x",{"i":1}]}', 2, candidates).map(pick => pick.index), [0]);

  // 越界与非法编号要丢掉。
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":9},{"i":0}]}', 2, candidates), []);
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":"不是编号"}]}', 2, candidates), []);

  // 完全解析不出来。
  assert.deepEqual(parseSearchPicks('模型说没有', 2, candidates), []);
  assert.deepEqual(parseSearchPicks('{坏 json}', 2, candidates), []);

  // 重复的编号只留最高分的那条，最多 5 条。
  const many = parseSearchPicks('answer_num: 1, answer_relevance: 3\nanswer_num: 1, answer_relevance: 8', 2, candidates);
  assert.equal(many.length, 1);
  assert.equal(many[0].score, 8);
});

// ---------------------------------------------------------------------------
// 检索模型记忆
// ---------------------------------------------------------------------------

serialTest('检索模型记忆：写、读、排序、兼容旧格式与写失败', async () => {
  await withTempHome(async home => {
    assert.deepEqual(await readPreferredSearchRoutes(), [], '没有记录时是空列表');
    assert.equal(await readPreferredSearchRoute(), null);

    assert.equal(await writePreferredSearchRoute(null, 10), false, '没有路由信息不写');
    assert.equal(await writePreferredSearchRoute({ provider: 'p1' }, 10), false);

    assert.equal(await writePreferredSearchRoute({ provider: 'p1', model: 'slow' }, 41000), true);
    assert.equal(await writePreferredSearchRoute({ provider: 'p1', model: 'fast' }, 19000), true);
    const list = await readPreferredSearchRoutes();
    assert.deepEqual(list.map(item => item.model), ['fast', 'slow'], '按耗时升序');
    assert.equal((await readPreferredSearchRoute()).model, 'fast');

    // 同一模型再成功一次取更快的那次。
    await writePreferredSearchRoute({ provider: 'p1', model: 'slow' }, 12000);
    const refreshed = await readPreferredSearchRoutes();
    assert.equal(refreshed.find(item => item.model === 'slow').ms, 12000);

    // 坏记录要被过滤掉。
    const dir = join(home, 'plugin-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'search-route.json'), JSON.stringify({
      routes: [{ provider: 'p2', model: 'm2' }, { provider: 1 }, null],
    }), 'utf8');
    const filtered = await readPreferredSearchRoutes();
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].model, 'm2');

    // 旧版单条格式也能读。
    await writeFile(join(dir, 'search-route.json'), JSON.stringify({
      provider: 'p3', model: 'legacy', at: '2026-01-01T00:00:00.000Z',
    }), 'utf8');
    const legacy = await readPreferredSearchRoutes();
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].ms, Number.MAX_SAFE_INTEGER);

    // 文件坏掉 → 空列表。
    await writeFile(join(dir, 'search-route.json'), '{不是 json', 'utf8');
    assert.deepEqual(await readPreferredSearchRoutes(), []);

    // 写不动（目录被同名文件占住）→ 返回 false，不抛。
    await rm(dir, { recursive: true, force: true });
    await writeFile(dir, 'not a directory', 'utf8');
    assert.equal(await writePreferredSearchRoute({ provider: 'p4', model: 'm4' }, 100), false);
  });
});

serialTest('resolveSearchRoutes：按「快模型优先」排序，已验证的模型排最前', async () => {
  await withTempHome(async () => {
    const llm = fakeLlm({
      models: [
        { id: 'group/plain', name: 'Group' },
        { id: 'plain-model', name: 'Plain' },
        { id: 'group/flash-model', name: 'GroupFlash' },
        { id: 'some-flash-model', name: 'Flash' },
        { id: 'image-only', name: 'Image', inputModalities: ['image'] },
      ],
    });
    const routes = await resolveSearchRoutes(llm);
    assert.deepEqual(routes.map(route => route.model), [
      'some-flash-model', 'plain-model', 'group/flash-model', 'group/plain',
    ], '具体快模型 > 其他具体模型 > 路由组快模型 > 路由组');

    // 不支持文本输入的模型不参与检索。
    assert.ok(!routes.some(route => route.model === 'image-only'));

    // 没有 listProviders 的宿主 → 没有路由。
    assert.deepEqual(await resolveSearchRoutes({}), []);
    assert.deepEqual(await resolveSearchRoutes(null), []);

    // listModels 失败 → 该 provider 没有模型。
    const broken = fakeLlm({ modelsError: new Error('炸了') });
    assert.deepEqual(await resolveSearchRoutes(broken), []);

    // 已验证过的模型排到最前。
    await writePreferredSearchRoute({ provider: 'p1', model: 'plain-model' }, 100);
    const preferred = await resolveSearchRoutes(llm);
    assert.equal(preferred[0].model, 'plain-model');
  });
});

// ---------------------------------------------------------------------------
// 描述找插件（非流式）
// ---------------------------------------------------------------------------

serialTest('searchPluginsByDescription：参数校验与空索引', async () => {
  await withTempHome(async () => {
    assert.deepEqual(await searchPluginsByDescription(), { ok: false, error: '请描述你想要的插件' });
    assert.deepEqual(await searchPluginsByDescription({ query: '  ' }), { ok: false, error: '请描述你想要的插件' });
    const tooLong = await searchPluginsByDescription({ query: 'x'.repeat(501) });
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.error, /描述太长/);

    // 插件库为空：如实说「先同步插件源」。
    const empty = await searchPluginsByDescription({ query: '任意描述' });
    assert.equal(empty.ok, true);
    assert.equal(empty.candidates, 0);
    assert.equal(empty.fallback, true);
    assert.match(empty.note, /插件库为空/);
  });
});

serialTest('searchPluginsByDescription：候选太多导致上下文超限时直接拒绝', async () => {
  await withTempHome(async home => {
    const many = [];
    for (let i = 0; i < 60; i += 1) {
      many.push({ id: `p${i}`, name: `p${i}`, repo: 'o/'.concat('r'.repeat(200)), category: 'ui', descriptionZh: '很长的描述'.repeat(20), stars: i });
    }
    await writeMarketIndex(home, many);
    const overflow = await searchPluginsByDescription({ query: '很长的描述' });
    assert.equal(overflow.ok, false);
    assert.match(overflow.error, /上下文超出上限/);
  });
});

serialTest('searchPluginsByDescription：模型挑不出/报错都要如实降级', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '把会话导出成 Markdown', stars: 10, downloads: 20 },
      { id: 'b', name: 'other', repo: 'o/other', category: 'data', descriptionZh: '别的', stars: 1, downloads: 2 },
    ]);

    // 没有模型 → 关键词降级。
    const noModel = await searchPluginsByDescription({ query: '把会话导出成 markdown' });
    assert.equal(noModel.fallback, true);
    assert.match(noModel.note, /未找到可用模型/);

    // 有宿主但没有可用模型 → 关键词降级。
    const emptyLlm = fakeLlm({ providers: [] });
    const noRoutes = await searchPluginsByDescription({ query: '把会话导出成 markdown', llm: emptyLlm });
    assert.equal(noRoutes.fallback, true);
    assert.match(noRoutes.note, /没有已配置的模型/);

    // 模型路由挂掉（listProviders 抛错）→ 同样降级。
    const brokenLlm = { listProviders() { throw new Error('宿主炸了'); } };
    const broken = await searchPluginsByDescription({ query: '把会话导出成 markdown', llm: brokenLlm });
    assert.equal(broken.fallback, true);
    assert.match(broken.note, /没有已配置的模型/);

    // 模型挑不出插件 → 关键词兜底并说明原因。
    const silent = fakeLlm({ models: [{ id: 'p1/m', text: '没有相关插件' }] });
    const silentResult = await searchPluginsByDescription({ query: '把会话导出成 markdown', llm: silent, debug: true });
    assert.equal(silentResult.fallback, true);
    assert.match(silentResult.note, /模型没有挑出相关插件/);
    assert.ok(Array.isArray(silentResult.routes), 'debug 要带上路由清单');

    // 模型调用报错 → 换路由，最后降级并带上原因。
    const failing = fakeLlm({ models: [{ id: 'p1/m', prepareError: new Error('余额不足') }] });
    const failed = await searchPluginsByDescription({ query: '把会话导出成 markdown', llm: failing, debug: true });
    assert.equal(failed.fallback, true);
    assert.match(failed.note, /模型检索失败/);
    assert.ok(failed.lastRouteError, 'debug 要带上最后一次的路由错误');
  });
});

serialTest('searchPluginsByDescription：模型报错要换下一条路由，而不是直接降级', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '把会话导出成 markdown', stars: 10 },
    ]);
    const llm = fakeLlm({
      models: [
        { id: 'p1/aaa-flash-model', finish: { type: 'finish', reason: { kind: 'error', failure: { message: '路由不可用' } } } },
        { id: 'p1/bbb-flash-model', text: 'answer_num: 1, answer_relevance: 9, why: 正好\n' },
      ],
    });
    const result = await searchPluginsByDescription({ query: '把会话导出成 markdown', llm, debug: true });
    assert.equal(result.fallback, false, '第一条路由坏了要换下一条');
    assert.equal(result.items[0].name, 'session-export');
    assert.equal(result.model.model, 'p1/bbb-flash-model');
  });
});

serialTest('searchPluginsByDescription：超时预算到点要真的中止请求', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    // 模型比超时预算慢：预算到点后必须调 abort（否则请求会一直挂着）。
    const slow = fakeLlm({ models: [{ id: 'p1/slow-model', text: 'answer_num: 1, answer_relevance: 5, why: 慢\n', delayMs: 120 }] });
    const result = await searchPluginsByDescription({ query: '导出', llm: slow, timeoutMs: 30 });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
  });
});

serialTest('searchPluginsByDescription：模型正文为空要当成失败而不是「没有相关插件」', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    const empty = fakeLlm({ models: [{ id: 'p1/m', chunks: [{ type: 'text-delta', text: '' }] }] });
    const result = await searchPluginsByDescription({ query: '导出', llm: empty, debug: true });
    assert.equal(result.fallback, true);
    assert.match(result.note, /模型检索失败/);
    assert.match(result.lastRouteError.error, /模型没有返回正文/);
  });
});

serialTest('searchPluginsByDescription：模型只回非文本块时要忽略，正文过长要截断', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    const noisy = fakeLlm({
      models: [{
        id: 'p1/m',
        chunks: [
          null,
          { type: 123 },
          { type: 'text-delta', text: 'answer_num: 1, answer_relevance: 9, why: 命中\n' },
        ],
      }],
    });
    const ok = await searchPluginsByDescription({ query: '导出', llm: noisy });
    assert.equal(ok.fallback, false, '非文本块要跳过，正文照常解析');
    assert.equal(ok.items[0].name, 'session-export');

    const huge = fakeLlm({ models: [{ id: 'p1/m', text: 'y'.repeat(5000) }] });
    const long = await searchPluginsByDescription({ query: '导出', llm: huge, debug: true });
    assert.equal(long.ok, true);
    assert.ok(long.rawLength <= 5000);
  });
});

serialTest('searchPluginsByDescription：支持推理档位的模型要带上 reasoningEffort', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    let seen = null;
    const llm = {
      listProviders: () => [{ id: 'p1', name: 'P1' }],
      listModels: async () => [{ id: 'p1/reasoning-model', name: 'R' }],
      prepareCall: async (config, signal, configure) => {
        const controls = configure({}, { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } });
        seen = controls;
        return {
          config: { ...config, ...controls },
          stream: async function* () { yield { type: 'text-delta', text: 'answer_num: 1, answer_relevance: 9, why: x\n' }; },
        };
      },
    };
    const result = await searchPluginsByDescription({ query: '导出', llm });
    assert.equal(result.ok, true);
    assert.equal(seen.reasoningEffort, 'low', '要挑最低档的推理强度');
    assert.equal(seen.maxTokens, 3000);
  });
});

// ---------------------------------------------------------------------------
// 描述找插件（流式）
// ---------------------------------------------------------------------------

serialTest('searchPluginsByDescriptionStream：参数校验与空索引', async () => {
  await withTempHome(async () => {
    const events = [];
    const empty = await searchPluginsByDescriptionStream({ query: '', onEvent: (step, data) => events.push([step, data]) });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, '请描述你想要的插件');
    assert.equal(events.length, 0, '空描述直接返回，不发事件');

    const tooLong = await searchPluginsByDescriptionStream({ query: 'x'.repeat(501) });
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.error, /描述太长/);

    const noIndex = await searchPluginsByDescriptionStream({ query: '任意描述' });
    assert.equal(noIndex.ok, true);
    assert.equal(noIndex.candidates, 0);
    assert.match(noIndex.note, /插件库为空/);
  });
});

serialTest('searchPluginsByDescriptionStream：没有模型时按关键词降级并逐步发事件', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '把会话导出成 markdown', stars: 10 },
    ]);
    const events = [];
    const result = await searchPluginsByDescriptionStream({
      query: '把会话导出成 markdown',
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.ok, true);
    assert.equal(result.fallback, true);
    const steps = events.map(([step]) => step);
    assert.deepEqual(steps, ['start', 'index', 'candidates', 'prompt', 'fallback', 'done']);
    assert.equal(events[1][1].total, 1);
    assert.equal(events[2][1].count, 1);
    assert.equal(events[2][1].names[0], 'o/session-export');
    const fallback = events.find(([step]) => step === 'fallback');
    assert.equal(fallback[1].reason, '没有模型服务');
  });
});

serialTest('searchPluginsByDescriptionStream：宿主没有可用模型时降级', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    const events = [];
    const result = await searchPluginsByDescriptionStream({
      query: '导出',
      llm: fakeLlm({ providers: [] }),
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, true);
    const fallback = events.find(([step]) => step === 'fallback');
    assert.equal(fallback[1].reason, '没有已配置的模型');
  });
});

serialTest('searchPluginsByDescriptionStream：模型挑出插件时要记住这个模型', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '把会话导出成 markdown', stars: 10 },
      { id: 'b', name: 'other', repo: 'o/other', category: 'data', descriptionZh: '别的', stars: 1 },
    ]);
    const events = [];
    const llm = fakeLlm({
      models: [{ id: 'p1/flash-model', text: 'answer_num: 1, answer_relevance: 9, why: 正好\n' }],
    });
    const result = await searchPluginsByDescriptionStream({
      query: '把会话导出成 markdown',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, false);
    assert.equal(result.items[0].name, 'session-export');
    const steps = events.map(([step]) => step);
    assert.ok(steps.includes('routes'));
    assert.ok(steps.includes('model-try'));
    assert.ok(steps.includes('model-first-token'));
    assert.ok(steps.includes('model-delta'));
    assert.ok(steps.includes('model-output'));
    assert.ok(steps.includes('parsed'));
    assert.ok(steps.includes('preferred'));
    assert.equal(steps[steps.length - 1], 'done');
    // 记住这次成功的模型，下次直接用它。
    const saved = await readPreferredSearchRoute();
    assert.equal(saved.model, 'p1/flash-model');
  });
});

serialTest('searchPluginsByDescriptionStream：模型报错与挑不出插件都要降级', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    const events = [];
    const failing = fakeLlm({ models: [{ id: 'p1/m', prepareError: new Error('炸了') }] });
    const result = await searchPluginsByDescriptionStream({
      query: '导出',
      llm: failing,
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, true);
    assert.match(result.note, /模型检索失败/);
    assert.ok(events.some(([step]) => step === 'model-error'));

    const events2 = [];
    const silent = fakeLlm({ models: [{ id: 'p1/m', text: '没有相关插件' }] });
    const result2 = await searchPluginsByDescriptionStream({
      query: '导出',
      llm: silent,
      onEvent: (step, data) => events2.push([step, data]),
    });
    assert.equal(result2.fallback, true);
    assert.equal(result2.items.length, 1, '降级也要给出关键词结果');
  });
});

serialTest('searchPluginsByDescriptionStream：上次验证过的模型要先单独试', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    await writePreferredSearchRoute({ provider: 'p1', model: 'flash-model' }, 900);
    const events = [];
    const llm = fakeLlm({
      models: [{ id: 'flash-model', text: 'answer_num: 1, answer_relevance: 9, why: 命中\n' }],
    });
    const result = await searchPluginsByDescriptionStream({
      query: '导出',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, false);
    const hit = events.find(([step]) => step === 'preferred-hit');
    assert.ok(hit, '要先试上次成功的模型');
    assert.equal(hit[1].model, 'p1/flash-model');
    assert.equal(hit[1].ms, 900);  });
});
// ---------------------------------------------------------------------------
// 第三批：把剩下的可达分支补齐
// ---------------------------------------------------------------------------

serialTest('apply 的 effect 会返回注销函数，注销时要把所有路由的 disposer 都跑掉', async () => {
  await withTempHome(async () => {
    const { routes, dispose } = boot();
    assert.equal(routes.length, 26);
    assert.equal(typeof dispose, 'function');
    dispose(); // 不抛异常就算过
  });
});

serialTest('refreshPluginSources：默认源抛的不是 Error 时也要如实回出原因', async () => {
  await withTempHome(async home => {
    const manager = join(home, 'plugin-manager');
    await mkdir(manager, { recursive: true });
    await writeFile(join(manager, 'sources.json'), JSON.stringify({
      version: 1, sources: [{ id: 'awesome-dsh', enabled: true }],
    }), 'utf8');
    const summary = await refreshPluginSources({
      refreshMarketplace: async () => { throw 'clone 失败'; },
    });
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0], 'awesome-dsh: clone 失败');
    const progress = readSourceRefreshProgress();
    assert.equal(progress.results[0].ok, false);
    assert.equal(progress.results[0].error, 'clone 失败');
  });
});

serialTest('queryMarketplace：缺星标/下载量/加入日期的条目要能排序', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui' },
      { id: 'b', name: 'pkg-b', repo: 'o/pkg-b', category: 'ui' },
    ]);
    const byStars = await queryMarketplace({});
    assert.equal(byStars.total, 2);
    const byNewest = await queryMarketplace({ sort: 'newest' });
    assert.equal(byNewest.total, 2);
    const byDownloads = await queryMarketplace({ sort: 'downloads' });
    assert.equal(byDownloads.total, 2);
  });
});

serialTest('rankPluginsByKeywords：没有名字/描述的脏条目不能把排序搞崩', async () => {
  const ranked = rankPluginsByKeywords([
    { id: 'x', category: 'other' },
    { id: 'y', repo: 'o/yy', name: 'yy', descriptionEn: 'yy', descriptionZh: 'yy', category: 'other' },
    { id: 'z', repo: 'o/yy', name: 'yy', descriptionEn: 'yy', descriptionZh: 'yy', category: 'other' },
  ], 'yy');
  assert.equal(ranked.length, 2);
  // 同分同星标时要比下载量，下载量也没有时按 0 算。
  assert.deepEqual(ranked.map(plugin => plugin.id).sort(), ['y', 'z']);
});

serialTest('parseSearchPicks：空文本、空候选与各种缺字段的挑选都要兜住', () => {
  assert.deepEqual(parseSearchPicks(undefined, 0), [], '没有文本');
  assert.equal(parseSearchPicks('answer_num: 1', 1, [null]).length, 1, '候选里有空洞也不能崩');
  assert.deepEqual(parseSearchPicks('{"picks":[{"why":"没有编号"}]}', 2), [], '没有编号的挑选');
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":1,"score":"不是数字"}]}', 2)[0].score, 1, '分数不是数字时按 1 算');
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":1,"reason":"理由"}]}', 2)[0].why, '理由');

  // 多个挑选要按相关度排序，重复的只留一条，最多 5 条。
  const many = parseSearchPicks([
    'answer_num: 1, answer_relevance: 3, why: 一',
    'answer_num: 2, answer_relevance: 9, why: 二',
    'answer_num: 3, answer_relevance: 7, why: 三',
    'answer_num: 1, answer_relevance: 5, why: 重复',
  ].join('\n'), 6);
  assert.deepEqual(many.map(pick => pick.index), [1, 2, 0]);
  assert.equal(many[0].score, 9);

  const six = parseSearchPicks([
    'answer_num: 1, answer_relevance: 6',
    'answer_num: 2, answer_relevance: 6',
    'answer_num: 3, answer_relevance: 6',
    'answer_num: 4, answer_relevance: 6',
    'answer_num: 5, answer_relevance: 6',
    'answer_num: 6, answer_relevance: 6',
  ].join('\n'), 6);
  assert.equal(six.length, 5, '最多留 5 条');
});

serialTest('resolveSearchRoutes：宿主返回奇怪数据时要有兜底', async () => {
  await withTempHome(async () => {
    // listProviders 返回空值。
    const noProviders = fakeLlm({ providers: () => undefined });
    assert.deepEqual(await resolveSearchRoutes(noProviders), []);

    // listModels 返回的不是数组。
    const badModels = { listProviders: () => [{ id: 'p1' }], listModels: async () => null };
    assert.deepEqual(await resolveSearchRoutes(badModels), []);

    // 模型没有 id：排序时按空串算，不能崩。
    const noId = fakeLlm({ models: [{ name: '没有 id 的模型' }] });
    const routes = await resolveSearchRoutes(noId);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].model, undefined);
    assert.equal(routes[0].name, '没有 id 的模型');
  });
});

serialTest('searchPluginsByDescription：模型以 error 结束但没带原因时要说清失败', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    const llm = fakeLlm({
      models: [{ id: 'p1/m', finish: { type: 'finish', reason: { kind: 'error' } } }],
    });
    const result = await searchPluginsByDescription({ query: '导出', llm, debug: true });
    assert.equal(result.fallback, true);
    assert.match(result.lastRouteError.error, /模型调用失败/);
  });
});

serialTest('searchPluginsByDescription：抛的不是 Error 时也要如实回出原因', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    const llm = fakeLlm({ models: [{ id: 'p1/m', prepareError: '余额不足' }] });
    const result = await searchPluginsByDescription({ query: '导出', llm, debug: true });
    assert.equal(result.fallback, true);
    assert.match(result.note, /模型检索失败/);
    assert.match(result.lastRouteError.error, /余额不足/);
  });
});

serialTest('searchPluginsByDescriptionStream：候选太多导致上下文超限时直接拒绝', async () => {
  await withTempHome(async home => {
    const many = [];
    for (let i = 0; i < 60; i += 1) {
      many.push({ id: `p${i}`, name: `p${i}`, repo: 'o/'.concat('r'.repeat(200)), category: 'ui', descriptionZh: '很长的描述'.repeat(20), stars: i });
    }
    await writeMarketIndex(home, many);
    const events = [];
    const result = await searchPluginsByDescriptionStream({
      query: '很长的描述',
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /上下文超出上限/);
    assert.equal(events[events.length - 1][0], 'done');
  });
});

serialTest('searchPluginsByDescriptionStream：上次成功的模型太慢时要同时并发其它模型', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    // 记一个「上次成功、其实很慢」的模型：对冲窗口（20 秒）过后要并发其它模型。
    await writePreferredSearchRoute({ provider: 'p1', model: 'slow-model' }, 900);
    const llm = fakeLlm({
      models: [
        { id: 'slow-model', hangMs: 26000, text: 'answer_num: 1, answer_relevance: 9, why: 慢\n' },
        { id: 'fast-model', text: 'answer_num: 1, answer_relevance: 9, why: 快\n' },
      ],
    });
    const events = [];
    const result = await searchPluginsByDescriptionStream({
      query: '导出',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    const miss = events.find(([step]) => step === 'preferred-miss');
    assert.ok(miss, '慢模型超时要发 preferred-miss');
    assert.equal(miss[1].model, 'slow');
    assert.equal(result.fallback, false, '并发起来的快模型要接上');
    assert.equal(result.items[0].name, 'session-export');
    // 等慢模型那次真的结束（超时预算到点会中止它），别让收尾跑到用例外面。
    await new Promise(resolve => setTimeout(resolve, 7000));
  });
});

serialTest('ignoreEntriesFromBody：三种请求体写法都归一成 name/version 列表', () => {
  assert.deepEqual(ignoreEntriesFromBody(null), []);
  assert.deepEqual(ignoreEntriesFromBody({}), []);
  assert.deepEqual(ignoreEntriesFromBody({ name: 'a', version: '1.0.0' }), [{ name: 'a', version: '1.0.0' }]);
  assert.deepEqual(ignoreEntriesFromBody({ name: 'a' }), [{ name: 'a', version: null }], '缺版本号时记 null');
  assert.deepEqual(ignoreEntriesFromBody({ items: [{ name: 'a', version: 2 }] }), [{ name: 'a', version: '2' }]);
  assert.deepEqual(ignoreEntriesFromBody({ items: [{ noName: true }] }), [], '没有名字的条目要丢掉');
  assert.deepEqual(ignoreEntriesFromBody({ names: ['a', 'b'] }), [
    { name: 'a', version: null }, { name: 'b', version: null },
  ]);
});

serialTest('/ignore：三种写法都要认（单条 / 批量 / 只给名字）', async () => {
  await withTempHome(async home => {
    const { routes } = boot();
    const ignore = routeOf(routes, '/dsh-plugin-manager/ignore');
    const record = join(home, 'profiles', 'web', '.plugin-updates-ignored.json');

    const single = makeRes();
    await ignore.handler(makeReq('POST', { body: { name: 'dsh-single', version: '1.0.0' } }), single);
    assert.equal(statusOf(single), 200);
    assert.deepEqual(jsonOf(single).ignored, ['dsh-single']);

    // 没给版本号时要去检测缓存里补，补不到就如实说「没忽略成」。
    const batch = makeRes();
    await ignore.handler(makeReq('POST', { body: { items: [{ name: 'dsh-batch' }] } }), batch);
    assert.equal(statusOf(batch), 200);
    assert.deepEqual(jsonOf(batch).ignored, []);
    assert.deepEqual(jsonOf(batch).failed, ['dsh-batch']);

    const names = makeRes();
    await ignore.handler(makeReq('POST', { body: { names: ['dsh-named'] } }), names);
    assert.equal(statusOf(names), 200);
    assert.deepEqual(jsonOf(names).ignored, []);
    assert.deepEqual(jsonOf(names).failed, ['dsh-named']);

    const stored = JSON.parse(await readFile(record, 'utf8'));
    assert.equal(stored['dsh-single'].version, '1.0.0');
    assert.equal(stored['dsh-batch'], undefined, '没给版本号又补不到时不落盘');
  });
});

serialTest('请求行里没有 url 时要按根路径处理', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    for (const path of [
      '/dsh-plugin-manager/disabled',
      '/dsh-plugin-manager/marketplace/query',
      '/dsh-plugin-manager/updates',
    ]) {
      const res = makeRes();
      await routeOf(routes, path).handler(makeReq('GET', { url: null }), res);
      assert.equal(statusOf(res), 200, path);
    }
  });
});

serialTest('/china-mirror/set：DSH_PORT 没设时走默认端口 3080，连不上镜像插件时回 502', async () => {
  await withTempHome(async () => {
    const previous = process.env.DSH_PORT;
    const originalFetch = globalThis.fetch;
    const seen = [];
    delete process.env.DSH_PORT;
    // 假 fetch：只记录 URL 然后失败——不碰本机真跑着的 dsh。
    globalThis.fetch = async (url) => { seen.push(String(url)); throw new Error('连不上'); };
    try {
      const { routes } = boot();
      const res = makeRes();
      await routeOf(routes, '/dsh-plugin-manager/china-mirror/set')
        .handler(makeReq('POST', { body: { enabled: true } }), res);
      assert.equal(statusOf(res), 502);
      assert.match(jsonOf(res).error, /镜像插件不可用/);
      assert.ok(seen.some(url => url.includes(':3080/dsh-china-mirror/enabled')), '默认端口是 3080');
    } finally {
      globalThis.fetch = originalFetch;
      if (previous === undefined) delete process.env.DSH_PORT;
      else process.env.DSH_PORT = previous;
    }
  });
});

serialTest('/china-mirror/set：镜像插件没回 table 时回 null', async () => {
  await withTempHome(async () => {
    const previousPort = process.env.DSH_PORT;
    const server = await startLocalServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ enabled: true }));
    });
    process.env.DSH_PORT = String(server.port);
    try {
      const { routes } = boot();
      const res = makeRes();
      await routeOf(routes, '/dsh-plugin-manager/china-mirror/set')
        .handler(makeReq('POST', { body: { enabled: true } }), res);
      assert.equal(statusOf(res), 200);
      assert.equal(jsonOf(res).table, null);
    } finally {
      await server.close();
      if (previousPort === undefined) delete process.env.DSH_PORT;
      else process.env.DSH_PORT = previousPort;
    }
  });
});

serialTest('/update-many：连 500 都写不出去时不能把异常抛出去', async () => {
  await withTempHome(async () => {
    const { routes } = boot();
    const res = makeRes({ failWriteAlways: '写不出去' });
    await routeOf(routes, '/dsh-plugin-manager/update-many')
      .handler(makeReq('POST', { bodyThrows: '请求体读失败' }), res);
    assert.ok(res.calls.length > 0);
  });
});
// ---------------------------------------------------------------------------
// 第四批：把剩下的可达分支补齐（模型异常 / 脏数据 / 排序回退）
// ---------------------------------------------------------------------------

serialTest('resolveSearchRoutes：模型没有 id 时排序也要能算', async () => {
  await withTempHome(async () => {
    const llm = fakeLlm({
      models: [
        { id: 'flash-model', name: 'Flash' },
        { name: '没有 id 的模型' },
      ],
    });
    const routes = await resolveSearchRoutes(llm);
    assert.equal(routes.length, 2);
    assert.ok(routes.some(route => route.model === undefined));
  });
});

serialTest('searchPluginsByDescription：正文为空但模型给了 finish 时要说清 finish 是什么', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', category: 'session', descriptionZh: '导出', stars: 10 },
    ]);
    const llm = fakeLlm({
      models: [{
        id: 'p1/m',
        chunks: [
          { type: 'text-delta', text: '' },
          { type: 'finish', reason: { kind: 'max-tokens' } },
        ],
      }],
    });
    const result = await searchPluginsByDescription({ query: '导出', llm, debug: true });
    assert.equal(result.fallback, true);
    assert.match(result.lastRouteError.error, /finish=max-tokens/);
  });
});

serialTest('searchPluginsByDescription：缺星标/下载量/描述的条目要能进结果', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'bare-plugin', repo: 'o/bare-plugin', category: 'ui', stars: 0, downloads: 0 },
    ]);
    const result = await searchPluginsByDescription({ query: 'bare-plugin' });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].description, '', '没有描述时给空串');
    assert.equal(result.items[0].downloads, 0);
    assert.equal(result.items[0].stars, 0);
  });
});

serialTest('searchPluginsByDescription：关键词一条都没命中时按热门排序兜底', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui' },
      { id: 'b', name: 'pkg-b', repo: 'o/pkg-b', category: 'ui', stars: 9 },
      { id: 'c', name: 'pkg-c', repo: 'o/pkg-c', category: 'ui' },
    ]);
    const result = await searchPluginsByDescription({ query: '完全无关的词xyz' });
    assert.equal(result.ok, true);
    assert.equal(result.candidates, 3, '三条都进候选');
    assert.equal(result.items[0].name, 'pkg-b', '按星标降序');
  });
});

serialTest('searchPluginsByDescriptionStream：关键词一条都没命中时按热门排序兜底', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui' },
      { id: 'b', name: 'pkg-b', repo: 'o/pkg-b', category: 'ui', stars: 9 },
      { id: 'c', name: 'pkg-c', repo: 'o/pkg-c', category: 'ui' },
    ]);
    const events = [];
    const result = await searchPluginsByDescriptionStream({
      query: '完全无关的词xyz',
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.candidates, 3);
    const candidates = events.find(([step]) => step === 'candidates');
    assert.equal(candidates[1].keywordHits, 0);
    assert.equal(result.items[0].name, 'pkg-b');
  });
});

serialTest('searchPluginsByDescriptionStream：宿主炸了时按没有模型处理', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui', stars: 1 },
    ]);
    const events = [];
    const result = await searchPluginsByDescriptionStream({
      query: 'pkg-a',
      llm: { listProviders() { throw new Error('宿主炸了'); } },
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, true);
    const fallback = events.find(([step]) => step === 'fallback');
    assert.equal(fallback[1].reason, '没有已配置的模型');
  });
});

serialTest('searchPluginsByDescriptionStream：模型以 error 结束时要发 model-error', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui', stars: 1 },
    ]);
    const events = [];
    const llm = fakeLlm({
      models: [{ id: 'p1/m', finish: { type: 'finish', reason: { kind: 'error', failure: { message: '路由挂了' } } } }],
    });
    const result = await searchPluginsByDescriptionStream({
      query: 'pkg-a',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, true);
    const error = events.find(([step]) => step === 'model-error');
    assert.ok(error, '要发 model-error');
    assert.match(error[1].error, /路由挂了/);
  });
});

serialTest('searchPluginsByDescriptionStream：模型调用抛的不是 Error 时也要如实回出原因', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui', stars: 1 },
    ]);
    const events = [];
    const llm = fakeLlm({ models: [{ id: 'p1/m', prepareError: '余额不足' }] });
    const result = await searchPluginsByDescriptionStream({
      query: 'pkg-a',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, true);
    const error = events.find(([step]) => step === 'model-error');
    assert.ok(error);
    assert.match(error[1].error, /余额不足/);
  });
});

serialTest('searchPluginsByDescriptionStream：推理型模型要走更长的超时预算', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui', stars: 1 },
    ]);
    const events = [];
    const llm = fakeLlm({
      models: [{
        id: 'group/glm-model',
        text: 'answer_num: 1, answer_relevance: 9, why: 命中\n',
        finish: { type: 'finish', reason: { kind: 'stop' } },
      }],
    });
    const result = await searchPluginsByDescriptionStream({
      query: 'pkg-a',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.fallback, false);
    const output = events.find(([step]) => step === 'model-output');
    assert.ok(output);
    assert.equal(output[1].finish, 'stop', 'finish 的 kind 要透出来');
  });
});

serialTest('searchPluginsByDescriptionStream：模型没有 id 时也不能崩', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'pkg-a', repo: 'o/pkg-a', category: 'ui', stars: 1 },
    ]);
    const events = [];
    const llm = fakeLlm({
      models: [{ name: '没有 id 的模型', text: 'answer_num: 1, answer_relevance: 9, why: 命中\n' }],
    });
    const result = await searchPluginsByDescriptionStream({
      query: 'pkg-a',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    assert.equal(result.ok, true);
    const tryEvent = events.find(([step]) => step === 'model-try');
    assert.ok(tryEvent);
  });
});

serialTest('searchPluginsByDescriptionStream：候选没有仓库名时要退回插件名', async () => {
  await withTempHome(async home => {
    await writeMarketIndex(home, [
      { id: 'a', name: 'only-name', category: 'ui', stars: 1, descriptionZh: '只有名字' },
    ]);
    const events = [];
    const llm = fakeLlm({
      models: [{ id: 'flash-model', text: 'answer_num: 1, answer_relevance: 9, why: 命中\n' }],
    });
    const result = await searchPluginsByDescriptionStream({
      query: 'only-name',
      llm,
      onEvent: (step, data) => events.push([step, data]),
    });
    const candidates = events.find(([step]) => step === 'candidates');
    assert.deepEqual(candidates[1].names, ['only-name'], '没有仓库名时退回插件名');
    const parsed = events.find(([step]) => step === 'parsed');
    assert.equal(parsed[1].picks[0].name, 'only-name');
  });
});
