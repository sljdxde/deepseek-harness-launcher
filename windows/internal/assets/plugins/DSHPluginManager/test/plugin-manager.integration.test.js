import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply, updatePlugins, isBatchUpdateRunning } from '../lib/index.js';

function makeRes() {
  const calls = [];
  return {
    calls,
    writeHead(status, headers) { calls.push(['writeHead', status, headers]); },
    end(body) { calls.push(['end', body]); }
  };
}

/** A request that `body()` can iterate (empty body) but with a settable method. */
function makeReq(method) {
  return {
    method,
    [Symbol.asyncIterator]() { return { next: async () => ({ done: true, value: undefined }) }; }
  };
}

/** Same, but with a JSON body the route's `body()` helper can read. */
function makeReqWithBody(method, value) {
  const chunks = [Buffer.from(JSON.stringify(value), 'utf8')];
  return {
    method,
    [Symbol.asyncIterator]() {
      let index = 0;
      return { next: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }) };
    }
  };
}

function boot() {
  const routes = [];
  const webServer = { register(route) { routes.push(route); } };
  const host = {
    webServer,
    effect(fn) { return fn(); }
  };
  let injected = null;
  apply({ inject(deps, callback) { injected = callback(host); } });
  return { routes, host };
}

test('apply 注册全部插件管理路由', () => {
  const { routes } = boot();
  const paths = routes.map(route => route.path).sort();
  assert.deepEqual(paths, [
    '/dsh-plugin-manager/cleanup',
    '/dsh-plugin-manager/ignore',
    '/dsh-plugin-manager/install',
    '/dsh-plugin-manager/installed',
    '/dsh-plugin-manager/marketplace',
    '/dsh-plugin-manager/refresh',
    '/dsh-plugin-manager/release-notes',
    '/dsh-plugin-manager/restart',
    '/dsh-plugin-manager/unignore',
    '/dsh-plugin-manager/uninstall',
    '/dsh-plugin-manager/uninstall-many',
    '/dsh-plugin-manager/update',
    '/dsh-plugin-manager/update-many',
    '/dsh-plugin-manager/updates'
  ]);
  assert.ok(routes.every(route => route.kind === 'exact'));
});

test('installed 路由在临时 DSH_HOME 下返回空列表', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-route-'));
  process.env.DSH_HOME = dshHome;
  try {
    const { routes } = boot();
    const installed = routes.find(route => route.path === '/dsh-plugin-manager/installed');
    const res = makeRes();
    await installed.handler(makeReq('GET'), res);
    const writeHeadCall = res.calls.find(call => call[0] === 'writeHead');
    const writeHeadStatus = writeHeadCall[1];
    const payload = JSON.parse(res.calls.find(call => call[0] === 'end')[1]);
    assert.equal(writeHeadStatus, 200);
    assert.deepEqual(payload.items, []);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('install 路由拒绝缺失插件标识的请求', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-route2-'));
  process.env.DSH_HOME = dshHome;
  try {
    const { routes } = boot();
    const install = routes.find(route => route.path === '/dsh-plugin-manager/install');
    const res = makeRes();
    await install.handler(makeReq('POST'), res);
    const writeHeadCall = res.calls.find(call => call[0] === 'writeHead');
    const writeHeadStatus = writeHeadCall[1];
    const payload = JSON.parse(res.calls.find(call => call[0] === 'end')[1]);
    assert.equal(writeHeadStatus, 400);
    assert.match(payload.error, /缺少/);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('marketplace 路由在无缓存时返回未就绪提示', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-route3-'));
  process.env.DSH_HOME = dshHome;
  try {
    const { routes } = boot();
    const marketplace = routes.find(route => route.path === '/dsh-plugin-manager/marketplace');
    const res = makeRes();
    await marketplace.handler(makeReq('GET'), res);
    const payload = JSON.parse(res.calls.find(call => call[0] === 'end')[1]);
    assert.equal(payload.ok, false);
    assert.match(payload.error, /刷新市场/);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('uninstall 路由拒绝缺失插件名的请求', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-route4-'));
  process.env.DSH_HOME = dshHome;
  try {
    const { routes } = boot();
    const uninstall = routes.find(route => route.path === '/dsh-plugin-manager/uninstall');
    const res = makeRes();
    await uninstall.handler(makeReq('POST'), res);
    const payload = JSON.parse(res.calls.find(call => call[0] === 'end')[1]);
    assert.equal(payload.error.includes('缺少') || payload.error.includes('不存在'), true);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('uninstall-many 路由拒绝空插件列表', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-route5-'));
  process.env.DSH_HOME = dshHome;
  try {
    const { routes } = boot();
    const route = routes.find(r => r.path === '/dsh-plugin-manager/uninstall-many');
    const res = makeRes();
    await route.handler(makeReq('POST', {}), res);
    const payload = JSON.parse(res.calls.find(call => call[0] === 'end')[1]);
    assert.equal(payload.error.includes('缺少'), true);
    const res2 = makeRes();
    await route.handler(makeReq('POST', { names: [] }), res2);
    const payload2 = JSON.parse(res2.calls.find(call => call[0] === 'end')[1]);
    assert.equal(payload2.error.includes('缺少'), true);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('ignore / unignore 路由：写记录、拒绝空请求、取消后记录消失', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-route6-'));
  process.env.DSH_HOME = dshHome;
  try {
    const { routes } = boot();
    const ignore = routes.find(route => route.path === '/dsh-plugin-manager/ignore');
    const unignore = routes.find(route => route.path === '/dsh-plugin-manager/unignore');
    const jsonBody = res => JSON.parse(res.calls.find(call => call[0] === 'end')[1]);
    const status = res => res.calls.find(call => call[0] === 'writeHead')[1];

    const empty = makeRes();
    await ignore.handler(makeReq('POST'), empty);
    assert.equal(status(empty), 400);
    assert.match(jsonBody(empty).error, /缺少/);

    const ok = makeRes();
    await ignore.handler(makeReqWithBody('POST', { items: [{ name: 'dsh-notify', version: '2.0.0' }] }), ok);
    assert.equal(status(ok), 200);
    assert.deepEqual(jsonBody(ok), { ok: true, ignored: ['dsh-notify'], failed: [] });
    const recordFile = join(dshHome, 'profiles', 'web', '.plugin-updates-ignored.json');
    assert.equal(JSON.parse(await readFile(recordFile, 'utf8'))['dsh-notify'].version, '2.0.0');

    const bad = makeRes();
    await unignore.handler(makeReq('POST'), bad);
    assert.equal(status(bad), 400);

    const removed = makeRes();
    await unignore.handler(makeReqWithBody('POST', { names: ['dsh-notify'] }), removed);
    assert.deepEqual(jsonBody(removed), { ok: true, unignored: ['dsh-notify'] });
    assert.deepEqual(JSON.parse(await readFile(recordFile, 'utf8')), {});
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

// 单条更新与批量更新都会写同一个 profile：批量在跑时 /update 必须拒绝，否则 pnpm 并发。
test('update 路由在批量更新进行中返回 409', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-route-409-'));
  process.env.DSH_HOME = dshHome;
  try {
    const profile = join(dshHome, 'profiles', 'web');
    await mkdir(join(profile, 'node_modules', 'demo'), { recursive: true });
    await writeFile(join(profile, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'web', private: true,
      dependencies: { demo: 'github:o/demo' },
      dsh: { profile: { bundles: ['demo'] } }
    }), 'utf8');

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const running = updatePlugins(['demo'], {
      check: async sources => sources.map(item => ({ name: item.name, status: 'update-available', latestVersion: '2.0.0', error: null })),
      peerProbe: async () => ({}),
      command: async () => { await gate; }
    });
    // 等批次真正进入执行（/update 路由读的是同一个互斥标志）。
    for (let i = 0; i < 300 && !isBatchUpdateRunning(); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(isBatchUpdateRunning(), true, '批次应当已经在跑');

    const { routes } = boot();
    const update = routes.find(route => route.path === '/dsh-plugin-manager/update');
    const res = makeRes();
    await update.handler(makeReqWithBody('POST', { name: 'demo' }), res);
    const status = res.calls.find(call => call[0] === 'writeHead')[1];
    const payload = JSON.parse(res.calls.find(call => call[0] === 'end')[1]);
    assert.equal(status, 409);
    assert.match(payload.error, /批量更新/);

    // 其它会写 profile 的路由同样要拒绝：它们和批量更新都调 pnpm 改同一个 profile。
    const guarded = [
      ['/dsh-plugin-manager/install', { name: 'demo' }],
      ['/dsh-plugin-manager/uninstall', { name: 'demo' }],
      ['/dsh-plugin-manager/uninstall-many', { names: ['demo'] }],
      ['/dsh-plugin-manager/cleanup', { name: 'demo' }]
    ];
    for (const [path, body] of guarded) {
      const route = routes.find(item => item.path === path);
      const blocked = makeRes();
      await route.handler(makeReqWithBody('POST', body), blocked);
      const blockedStatus = blocked.calls.find(call => call[0] === 'writeHead')[1];
      const blockedPayload = JSON.parse(blocked.calls.find(call => call[0] === 'end')[1]);
      assert.equal(blockedStatus, 409, path + ' 在批量更新期间必须拒绝');
      assert.match(blockedPayload.error, /批量更新/, path);
    }

    release();
    await running;
    assert.equal(isBatchUpdateRunning(), false, '批次结束后要放行');
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('release-notes 路由拒绝缺少插件名或版本号的请求', async () => {
  const { routes } = boot();
  const route = routes.find(item => item.path === '/dsh-plugin-manager/release-notes');
  assert.ok(route, '路由已注册');
  const missingVersion = makeRes();
  await route.handler(makeReqWithBody('POST', { name: 'dsh-notify' }), missingVersion);
  assert.equal(missingVersion.calls.find(call => call[0] === 'writeHead')[1], 400);
  assert.match(JSON.parse(missingVersion.calls.find(call => call[0] === 'end')[1]).error, /缺少/);
  const missingName = makeRes();
  await route.handler(makeReqWithBody('POST', { version: '2.0.0' }), missingName);
  assert.equal(missingName.calls.find(call => call[0] === 'writeHead')[1], 400);
});
