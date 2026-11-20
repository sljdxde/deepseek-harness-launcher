import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, mapURL, unmapURL, mirrorURLTable, readMirrorState, writeMirrorEnabled } from '../lib/index.js';

/**
 * 极简 cordis harness（与 session-notify 的测试同款）：`ctx.inject` 发出
 * webServer.register 门面，逐路由收集 handler，用假 req/res 直接调用。
 */
function makeHarness(env) {
  // 只备份/恢复自己改过的变量：整块替换 process.env 会让 os.homedir() 不再
  // 跟随 USERPROFILE（Windows 上它会退回真实用户目录），后面的用例就管不到
  // 「DSH_HOME 没设」的路径了。
  const prev = {};
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      prev[k] = process.env[k];
      process.env[k] = v;
    }
  }
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
  const call = async (path, { method = 'GET', body, failOn } = {}) => {
    const handler = routes.get(path);
    assert.ok(handler, `route ${path} registered`);
    let status = 0;
    let responseBody = null;
    const res = {
      writeHead: code => {
        // failOn：模拟响应链路在写这个状态码时断掉（抛的不是 Error 对象，
        // 好让路由里「没有 message 的异常」那条分支也被走到）
        if (failOn === code) throw `写出 ${code} 失败`;
        status = code;
      },
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
    restore: () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
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

// ── 状态文件读写与边界 ──────────────────────────────────────────────────

/** 建一个隔离的 DSH_HOME，返回 { home, cleanup }。 */
async function tempHome() {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = await mkdtemp(join(tmpdir(), 'dsh-mirror-'));
  return { home, cleanup: () => import('node:fs/promises').then(fs => fs.rm(home, { recursive: true, force: true })) };
}

/** 往 DSH_HOME/china-mirror/state.json 写一份状态。 */
async function writeState(home, raw) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(join(home, 'china-mirror'), { recursive: true });
  await writeFile(join(home, 'china-mirror', 'state.json'), raw, 'utf8');
}

test('状态文件损坏：读回默认关闭，不抛错', async () => {
  const { home, cleanup } = await tempHome();
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    await writeState(home, '{ 这不是 json');
    const state = await readMirrorState();
    assert.equal(state.enabled, false, '坏文件按关闭处理');
    assert.equal(state.updatedAt, null);
    assert.ok(state.table.length >= 4, '规则表照样给全');
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await cleanup();
  }
});

test('状态文件字段不合法：enabled 只认布尔值，updatedAt 只认字符串', async () => {
  const { home, cleanup } = await tempHome();
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    await writeState(home, JSON.stringify({ enabled: 'yes', updatedAt: 123 }));
    const state = await readMirrorState();
    assert.equal(state.enabled, false, '非布尔值不算打开');
    assert.equal(state.updatedAt, null, '非字符串时间戳按没有处理');

    await writeState(home, 'null');
    const nullState = await readMirrorState();
    assert.equal(nullState.enabled, false, '整个文件是 null 也按关闭处理');
    assert.equal(nullState.updatedAt, null);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await cleanup();
  }
});

test('DSH_HOME 没设时读用户目录下的 .dsh/china-mirror/state.json', async () => {
  const { join } = await import('node:path');
  const { home, cleanup } = await tempHome();
  const previousHome = process.env.DSH_HOME;
  const previousProfile = process.env.USERPROFILE;
  const previousUserHome = process.env.HOME;
  try {
    delete process.env.DSH_HOME;
    // 把「用户目录」指到临时目录：os.homedir() 读 USERPROFILE / HOME
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    // 没设 DSH_HOME 时状态文件在 <用户目录>/.dsh/china-mirror/state.json
    await writeState(join(home, '.dsh'), JSON.stringify({ enabled: true, updatedAt: '2026-01-01T00:00:00.000Z' }));
    const state = await readMirrorState();
    assert.equal(state.enabled, true, '没设 DSH_HOME 时读 ~/.dsh 下的状态');
    assert.equal(state.updatedAt, '2026-01-01T00:00:00.000Z');
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
    if (previousUserHome === undefined) delete process.env.HOME; else process.env.HOME = previousUserHome;
    await cleanup();
  }
});

test('unmapURL：null / undefined / 空串都安全', () => {
  assert.equal(unmapURL(null), '');
  assert.equal(unmapURL(undefined), '');
  assert.equal(unmapURL(''), '');
  assert.equal(unmapURL('https://example.com/x'), 'https://example.com/x');
});

test('GET /enabled 被 405 拒绝', async () => {
  const { home, cleanup } = await tempHome();
  const harness = makeHarness({ DSH_HOME: home });
  try {
    apply(harness.ctx);
    const wrong = await harness.call('/dsh-china-mirror/enabled', { method: 'GET' });
    assert.equal(wrong.status, 405);
  } finally {
    harness.dispose();
    harness.restore();
    await cleanup();
  }
});

test('POST /enabled 的 body 不是 JSON 时返回 400', async () => {
  const { home, cleanup } = await tempHome();
  const harness = makeHarness({ DSH_HOME: home });
  try {
    apply(harness.ctx);
    const bad = await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: 'enabled=true' });
    assert.equal(bad.status, 400);
    assert.match(bad.json().error, /enabled/);
    // 空 body 同样按「缺少 enabled」处理
    const empty = await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: '' });
    assert.equal(empty.status, 400);
  } finally {
    harness.dispose();
    harness.restore();
    await cleanup();
  }
});

test('写状态失败（目录被文件占住）时返回 500', async () => {
  const { home, cleanup } = await tempHome();
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  // china-mirror 目录被一个同名文件占住 → 建目录失败
  await writeFile(join(home, 'china-mirror'), 'not a directory', 'utf8');
  const harness = makeHarness({ DSH_HOME: home });
  try {
    apply(harness.ctx);
    const response = await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: '{"enabled":true}' });
    assert.equal(response.status, 500);
    assert.ok(response.json().error, '500 响应带错误信息');
  } finally {
    harness.dispose();
    harness.restore();
    await cleanup();
  }
});

test('写状态失败时错误信息里没有 message 也能读出来', async () => {
  const { home, cleanup } = await tempHome();
  const { promises: fs } = await import('node:fs');
  const original = fs.mkdir;
  // 模拟建目录时抛出的不是 Error 对象
  fs.mkdir = async () => { throw '磁盘只读'; };
  const harness = makeHarness({ DSH_HOME: home });
  try {
    apply(harness.ctx);
    const response = await harness.call('/dsh-china-mirror/enabled', { method: 'POST', body: '{"enabled":true}' });
    assert.equal(response.status, 500);
    assert.equal(response.json().error, '磁盘只读', '不是 Error 对象的异常也能变成可读信息');
  } finally {
    fs.mkdir = original;
    harness.dispose();
    harness.restore();
    await cleanup();
  }
});

test('响应写不出去时 /state 返回 500', async () => {
  const { home, cleanup } = await tempHome();
  const harness = makeHarness({ DSH_HOME: home });
  try {
    apply(harness.ctx);
    // 模拟响应链路在写 200 时断掉（writeHead 抛错）→ 路由应回落到 500
    const broken = await harness.call('/dsh-china-mirror/state', { failOn: 200 });
    assert.equal(broken.status, 500);
    assert.ok(broken.json().error, '500 响应带错误信息');
  } finally {
    harness.dispose();
    harness.restore();
    await cleanup();
  }
});
