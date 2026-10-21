import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../lib/index.js';

/**
 * Minimal cordis-shaped harness: `ctx.inject` hands out a `webServer.register`
 * facade, so we can prove the plugin's routes are actually registered (and
 * disposed) instead of only matching source text.
 */
function makeHarness() {
  const routes = new Map();
  const teardown = [];
  const host = {
    webServer: {
      register: route => {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
    workspaceRegistry: { delete: async () => {}, archiveSession: async () => {} },
    effect: setup => { teardown.push(setup()); },
  };
  const ctx = {
    inject: (deps, callback) => { callback(host); },
    logger: { warn() {} },
  };
  const call = async (path, method = 'GET') => {
    const handler = routes.get(path);
    assert.ok(handler, `route ${path} registered`);
    let status = 0;
    let responseBody = '';
    const res = {
      writeHead: code => { status = code; },
      end: payload => { responseBody = payload ?? ''; },
    };
    await handler({ method, url: path }, res);
    return { status, json: () => JSON.parse(responseBody) };
  };
  return { ctx, call, hasRoute: path => routes.has(path), dispose: () => teardown.forEach(fn => fn()) };
}

test('health 探针：零成本、200、与重接口同一 effect，dispose 后消失', async () => {
  const harness = makeHarness();
  apply(harness.ctx);

  const response = await harness.call('/dsh-archive-manager/health');
  assert.equal(response.status, 200);
  assert.equal(response.json().ok, true);

  // 启动器把 health 当「插件是否随 dsh 加载」的探针；它必须和重接口注册在同一个
  // effect 里，这样「能探到 health」才等价于「归档路由真的挂上了」。
  assert.ok(harness.hasRoute('/dsh-archive-manager/archives'));
  assert.ok(harness.hasRoute('/dsh-archive-manager/delete'));
  assert.ok(harness.hasRoute('/dsh-archive-manager/restore'));

  harness.dispose();
  assert.equal(harness.hasRoute('/dsh-archive-manager/health'), false);
  assert.equal(harness.hasRoute('/dsh-archive-manager/archives'), false);
});
