import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, mapURL, unmapURL, mirrorURLTable, readMirrorState, writeMirrorEnabled } from '../lib/index.js';

/**
 * 极简 cordis harness（与 session-notify 的测试同款）：`ctx.inject` 发出
 * webServer.register 门面，逐路由收集 handler，用假 req/res 直接调用。
 */
function makeHarness(env) {
  const prev = { ...process.env };
  if (env) for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const routes = new Map();
  const teardown = [];
  const host = {
    webServer: {
      register: route => {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
    effect: setup => { teardown.push(setup()); },
    logger: { info() {}, warn() {} },
  };
  const ctx = {
    inject: (deps, callback) => { assert.deepEqual(deps, ['webServer']); callback(host); },
    logger: host.logger,
  };
  const call = async (path, { method = 'GET', body } = {}) => {
    const handler = routes.get(path);
    assert.ok(handler, `route ${path} registered`);
    let status = 0;
    let responseBody = null;
    const res = {
      writeHead: code => { status = code; },
      end: payload => { responseBody = payload ?? ''; },
    };
    const request = { method, url: path };
    if (body !== undefined) {
      request[Symbol.asyncIterator] = async function* () { yield Buffer.from(body); };
    }
    await handler(request, res);
    return { status, body: responseBody, json: () => JSON.parse(responseBody) };
  };
  return {
    ctx,
    call,
    hasRoute: path => routes.has(path),
    dispose: () => teardown.forEach(fn => fn()),
    restore: () => { process.env = prev; },
  };
}

test('镜像规则表：四类地址各有规则且顺序在前的是更具体的', () => {
  const table = mirrorURLTable();
  assert.ok(table.length >= 4);
  assert.deepEqual(table.map(rule => rule.kind).sort(), ['git', 'git', 'raw', 'registry']);
  // codeload（更具体）排在 github.com 前面，否则会被 github.com 规则截胡。
  const kinds = table.map(rule => rule.match);
  assert.ok(kinds.indexOf('https://codeload.github.com/') < kinds.indexOf('https://github.com/'));
});

test('mapURL：registry / raw / git / codeload 各自映射', () => {
  const table = mirrorURLTable();
  assert.equal(mapURL('https://registry.npmjs.org/react', table), 'https://registry.npmmirror.com/react');
  assert.equal(
    mapURL('https://raw.githubusercontent.com/a/b/main/package.json', table),
    'https://raw.gitmirror.com/a/b/main/package.json',
  );
  assert.equal(mapURL('https://github.com/a/b.git', table), 'https://ghfast.top/https://github.com/a/b.git');
  assert.equal(
    mapURL('https://codeload.github.com/a/b/tar.gz/main', table),
    'https://ghfast.top/https://codeload.github.com/a/b/tar.gz/main',
  );
});

test('mapURL：api.github.com 与无关地址保持直连', () => {
  const table = mirrorURLTable();
  assert.equal(mapURL('https://api.github.com/repos/a/b/contents/x', table), 'https://api.github.com/repos/a/b/contents/x');
  assert.equal(mapURL('https://example.com/index.json', table), 'https://example.com/index.json');
  assert.equal(mapURL('', table), '');
  assert.equal(mapURL(null, table), '');
});

test('mapURL：已是镜像地址的 URL 幂等返回，不套两层前缀', () => {
  const table = mirrorURLTable();
  const once = mapURL('https://github.com/a/b.git', table);
  assert.equal(mapURL(once, table), once);
});

test('unmapURL：把映射过的地址还原回原始 URL', () => {
  const table = mirrorURLTable();
  assert.equal(unmapURL('https://registry.npmmirror.com/react', table), 'https://registry.npmjs.org/react');
  assert.equal(unmapURL('https://ghfast.top/https://github.com/a/b.git', table), 'https://github.com/a/b.git');
  // 未映射的 URL 原样返回。
  assert.equal(unmapURL('https://example.com/x', table), 'https://example.com/x');
});

test('状态默认关闭：没有状态文件时读回 enabled=false 与完整规则表', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'dsh-mirror-'));
  const isolated = makeHarness({ DSH_HOME: home });
  try {
    isolated.ctx.inject; // harness ready
    apply(isolated.ctx);
    const { status, json } = await isolated.call('/dsh-china-mirror/state');
    assert.equal(status, 200);
    assert.equal(json().enabled, false);
    assert.ok(json().table.length >= 4);
    assert.equal(json().updatedAt, null);
  } finally {
    isolated.dispose();
    isolated.restore();
    await import('node:fs/promises').then(fs => fs.rm(home, { recursive: true, force: true }));
  }
});

test('POST /enabled 写盘生效并读回，GET state 路由保持 405 守卫', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'dsh-mirror-'));
  const harness = makeHarness({ DSH_HOME: home });
  try {
    apply(harness.ctx);
    assert.ok(harness.hasRoute('/dsh-china-mirror/state'));
    assert.ok(harness.hasRoute('/dsh-china-mirror/enabled'));

    const bad = await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: '{}' });
    assert.equal(bad.status, 400);
    assert.match(bad.json().error, /enabled/);

    const on = await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: '{"enabled":true}' });
    assert.equal(on.status, 200);
    assert.equal(on.json().enabled, true);
    assert.ok(on.json().updatedAt);

    // 再读一次 state：开关是持久的（跨调用），规则表随响应返回。
    const state = await harness.call('/dsh-china-mirror/state');
    assert.equal(state.json().enabled, true);
    assert.ok(state.json().table.length >= 4);

    const off = await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: '{"enabled":false}' });
    assert.equal(off.json().enabled, false);

    // GET 只允许 GET；POST 到 state 被 405 拒绝。
    const wrong = await harness.call('/dsh-china-mirror/state', { method: 'POST' });
    assert.equal(wrong.status, 405);
  } finally {
    harness.dispose();
    harness.restore();
    await import('node:fs/promises').then(fs => fs.rm(home, { recursive: true, force: true }));
  }
});

test('状态文件写的是原子替换（tmp + rename），目录自动创建', async () => {
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'dsh-mirror-'));
  const harness = makeHarness({ DSH_HOME: home });
  try {
    apply(harness.ctx);
    await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: '{"enabled":true}' });
    const files = await readdir(join(home, 'china-mirror'));
    assert.deepEqual(files.filter(f => f.endsWith('.json')), ['state.json']);
    // 没有残留的 .tmp 文件。
    assert.equal(files.filter(f => f.includes('.tmp-')).length, 0);
  } finally {
    harness.dispose();
    harness.restore();
    await import('node:fs/promises').then(fs => fs.rm(home, { recursive: true, force: true }));
  }
});
