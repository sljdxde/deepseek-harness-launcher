import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../lib/index.js';

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
    '/dsh-plugin-manager/install',
    '/dsh-plugin-manager/installed',
    '/dsh-plugin-manager/marketplace',
    '/dsh-plugin-manager/refresh',
    '/dsh-plugin-manager/uninstall'
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
