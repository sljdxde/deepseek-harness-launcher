import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyPluginUpdate,
  findPeerIncompatibilities,
  satisfiesPluginRange
} from '../lib/index.js';

// 插件升级前的兼容性门禁（见 lib/index.js 的 satisfiesPluginRange / findPeerIncompatibilities）。
// 口径与 Swift 侧 Sources/PluginCompatibilitySupport.swift 一致：dsh 更新很频繁，装上一个
// peer 不满足的插件版本会让整个 Harness 起不来，所以这里必须「宁可挡住，不可放行」。

const RANGE_CASES = [
  // 真实声明：@openviking/dsh-memory-plugin 0.5.0 就是这么写 peer 的
  ['0.1.5-rc.2', '>=0.1.0-rc.6 <0.2.0 || ^0.1.5-rc.1', true],
  ['0.1.0-rc.1', '>=0.1.0-rc.6 <0.2.0', false],
  ['0.1.0-rc.6', '>=0.1.0-rc.6 <0.2.0', true],
  ['0.1.0-rc.10', '>=0.1.0-rc.6', true],
  ['0.2.0-rc.9', '>=0.1.0-rc.6 <0.2.0', false],
  ['0.1.5-rc.2', '>=0.1.0 <0.2.0', true],
  ['1.5.0', '>= 0.1.0', true],
  ['0.1.4', '0.1.x', true],
  ['0.2.0', '0.1.x', false],
  ['1.9.9', '1.x', true],
  ['0.0.4', '^0.0.3', false],
  ['0.0.3', '^0.0.3', true],
  ['1.5.0', '^1.2.0', true],
  ['2.0.0', '^1.2.0', false],
  ['1.2.9', '~1.2.0', true],
  ['1.3.0', '~1.2.0', false],
  ['1.0.0', '*', true],
  ['1.0.0', '', true]
];

for (const [version, range, expected] of RANGE_CASES) {
  test(`区间求值 ${version} ~ ${JSON.stringify(range)} = ${expected}`, () => {
    assert.equal(satisfiesPluginRange(version, range), expected);
  });
}

test('peer 表里读不到版本的条目跳过判定（宁可不判，不误伤）', () => {
  assert.deepEqual(
    findPeerIncompatibilities({ '@deepseek-ai/dsh-llm': '>=0.2.0', '@deepseek-ai/dsh-session': '^0.1.0' }, { '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }),
    [{ peer: '@deepseek-ai/dsh-llm', range: '>=0.2.0', installed: '0.1.5-rc.2' }]
  );
  assert.deepEqual(findPeerIncompatibilities({ '@a/b': '>=1.0.0' }, {}), []);
  assert.deepEqual(findPeerIncompatibilities({}, { '@a/b': '1.0.0' }), []);
});

/** 临时 DSH_HOME，runtime 里按 peers 铺好已装组件版本。 */
async function withRuntime(peers, fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-peer-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    for (const [peer, version] of Object.entries(peers)) {
      const dir = join(home, 'runtime', 'node_modules', ...peer.split('/'));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: peer, version }), 'utf8');
    }
    return await fn(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

const npmSource = {
  name: 'dsh-foo',
  kind: 'npm',
  spec: '^1.0.0',
  installedVersion: '1.0.0',
  installedCommit: null,
  remote: { type: 'npm', package: 'dsh-foo' }
};

test('目标版本 peer 不满足当前 dsh：直接阻断，一条 pnpm 命令都不执行', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.2.0' })
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'peer-incompatible');
    assert.match(result.error, /@deepseek-ai\/dsh-llm >=0\.2\.0（当前 0\.1\.5-rc\.2）/);
    assert.match(result.error, /已阻止升级/);
    assert.match(result.error, /检查 Deepseek Harness 更新/);
    assert.deepEqual(commands, [], '被挡住的升级不能碰 profile');
  });
});

test('目标版本 peer 满足：照常执行更新（真实 openviking 多分支写法）', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.1.0-rc.6 <0.2.0 || ^0.1.5-rc.1' })
    });
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
  });
});

test('探测不到 peer 声明时不阻断（门禁不能变成新的故障源）', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      peerProbe: async () => { throw new Error('registry 不可达'); }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
    assert.match(result.note ?? '', /没能确认 v2\.0\.0 的 dsh 版本要求/);
    assert.match(result.note ?? '', /registry 不可达/);
  });
});

// ---------------------------------------------------------------------------
// 门禁判的是「这次升级有没有让环境更差」：已装版本同样不满足的 peer 只提示、不阻止。
// 线上实例：运行时 @earendil-works/pi-ai 是 1.1.0，而 dsh-connect-workbuddy 从 4.3.1
// 到 4.4.2 都声明 `>=0.85.0 <0.88.0`——挡住它只会让用户卡在一个再也升不动的版本上。
// ---------------------------------------------------------------------------

/** 临时 DSH_HOME 里除了 runtime 版本，再铺一个"已装版本"的 peer 声明。 */
async function withRuntimeAndInstalled(peers, installed, fn) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-peer-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    for (const [peer, version] of Object.entries(peers)) {
      const dir = join(home, 'runtime', 'node_modules', ...peer.split('/'));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: peer, version }), 'utf8');
    }
    const installedDir = join(home, 'profiles', 'web', 'node_modules', ...npmSource.name.split('/'));
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, 'package.json'), JSON.stringify({ name: npmSource.name, version: '1.0.0', peerDependencies: installed }), 'utf8');
    return await fn(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

test('已装版本同样不满足的 peer：放过升级，只带一句提示', async () => {
  const runtimeHasNewerPiAi = { '@earendil-works/pi-ai': '1.1.0' };
  await withRuntimeAndInstalled(runtimeHasNewerPiAi, { '@earendil-works/pi-ai': '>=0.85.0 <0.88.0' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      peerProbe: async () => ({ '@earendil-works/pi-ai': '>=0.85.0 <0.88.0' })
    });
    assert.equal(result.ok, true, '升级前的版本本来就不满足，挡住它只会把用户卡死');
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
    assert.match(result.note ?? '', /升级前的版本也是这么声明的/);
  });
});

test('目标版本新增的不兼容 peer：仍然阻断，一条 pnpm 命令都不执行', async () => {
  // 已装版本要求宽松（运行时满足），目标版本收紧到装不下的区间 → 这是这次升级新引入的问题
  await withRuntimeAndInstalled({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, { '@deepseek-ai/dsh-llm': '>=0.1.0' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.2.0' })
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'peer-incompatible');
    assert.deepEqual(commands, [], '被挡住的升级不能碰 profile');
  });
});

test('已装版本没声明这个 peer 时，目标版本的不兼容照样挡住', async () => {
  await withRuntimeAndInstalled({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, { '@deepseek-ai/other': '^1.0.0' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.2.0' })
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'peer-incompatible');
    assert.deepEqual(commands, []);
  });
});

test('已装版本不满足、目标版本满足：升级放行且没有多余提示', async () => {
  await withRuntimeAndInstalled({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, { '@deepseek-ai/dsh-llm': '>=0.3.0' }, async () => {
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {},
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.1.0' })
    });
    assert.equal(result.ok, true);
    assert.doesNotMatch(result.note ?? '', /升级前的版本也是这么声明的/);
  });
});
