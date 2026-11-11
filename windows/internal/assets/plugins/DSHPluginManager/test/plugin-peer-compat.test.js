import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  acceptInstalledPackage,
  applyPluginUpdate,
  isDevLinkedSource,
  stripStaleLockEntry,
  findPeerIncompatibilities,
  satisfiesPluginRange
} from '../lib/index.js';

// 兼容性门禁已移除：更新、安装、启动都不再判插件 peer 区间。这里保留两类用例：
// 1) npm 区间语义（satisfiesPluginRange / findPeerIncompatibilities）仍锁住规则；
// 2) applyPluginUpdate 在注入 peerProbe 时也不调用它、不阻断、不夹带兼容性文案。

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

test('兼容性门禁已移除：目标版本 peer 不满足也照常安装，不再探测 registry', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async () => {
    const commands = [];
    let probed = false;
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      verifyApplied: async () => true,
      peerProbe: async () => { probed = true; return { '@deepseek-ai/dsh-llm': '>=0.2.0' }; }
    });
    assert.equal(result.ok, true, '不再因为 peer 区间不满足而挡住升级');
    assert.notEqual(result.status, 'peer-incompatible');
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
    assert.equal(probed, false, '不该再联网拉目标版本的 peerDependencies');
    assert.doesNotMatch(result.error ?? '', /已阻止升级/);
  });
});

test('目标版本 peer 满足：照常执行更新（真实 openviking 多分支写法）', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      verifyApplied: async () => true,
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.1.0-rc.6 <0.2.0 || ^0.1.5-rc.1' })
    });
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
  });
});

test('兼容性探测整体停用：注入的 peerProbe 不会被调用，也不产生告警文案', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async () => {
    const commands = [];
    let probed = false;
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      verifyApplied: async () => true,
      peerProbe: async () => { probed = true; throw new Error('registry 不可达'); }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
    assert.equal(probed, false, '连探测都不该发起');
    assert.doesNotMatch(result.note ?? '', /没能确认|兼容性|不兼容/);
  });
});

// ---------------------------------------------------------------------------
// 回归保护：确保兼容性门禁不会悄悄回来 —— 即使调用方仍注入 peerProbe，更新也
// 不探测、不阻断、不夹带任何兼容性文案。
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

test('兼容性提示已移除：升级结果里不再夹带 peer 区间说明', async () => {
  const runtimeHasNewerPiAi = { '@earendil-works/pi-ai': '1.1.0' };
  await withRuntimeAndInstalled(runtimeHasNewerPiAi, { '@earendil-works/pi-ai': '>=0.85.0 <0.88.0' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      verifyApplied: async () => true,
      peerProbe: async () => ({ '@earendil-works/pi-ai': '>=0.85.0 <0.88.0' })
    });
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
    assert.doesNotMatch(result.note ?? '', /升级前的版本也是这么声明的|兼容性|不兼容/);
  });
});

test('兼容性门禁已移除：目标版本新引入的不满足 peer 也照常放行', async () => {
  await withRuntimeAndInstalled({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, { '@deepseek-ai/dsh-llm': '>=0.1.0' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      verifyApplied: async () => true,
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.2.0' })
    });
    assert.equal(result.ok, true, '不再因为「新引入的不兼容」挡住升级');
    assert.notEqual(result.status, 'peer-incompatible');
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
  });
});

test('兼容性门禁已移除：已装版本没声明的 peer 也不再参与判定', async () => {
  await withRuntimeAndInstalled({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, { '@deepseek-ai/other': '^1.0.0' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate(npmSource, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      verifyApplied: async () => true,
      peerProbe: async () => ({ '@deepseek-ai/dsh-llm': '>=0.2.0' })
    });
    assert.equal(result.ok, true);
    assert.notEqual(result.status, 'peer-incompatible');
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
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

test('link: 指向用户开发目录时拒绝自动更新：绝不改名/克隆用户的目录', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async () => {
    const commands = [];
    const result = await applyPluginUpdate({
      name: '@changfenhuang/dsh-genui',
      kind: 'git',
      spec: 'link:/Users/x/dev/dsh-genui',
      installedVersion: '0.12.0',
      installedCommit: null,
      remote: {
        type: 'git',
        url: 'https://github.com/changfenhuang/dsh-genui.git',
        author: 'changfenhuang', repo: 'dsh-genui', subdir: null,
        dir: '/Users/x/dev/dsh-genui'
      }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '0.15.0' }],
      command: async args => { commands.push(args); },
      verifyApplied: async () => true,
      clone: async () => { throw new Error('clone 不该被调用：用户目录不能动'); },
      peerProbe: async () => ({})
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.match(result.error, /链接到本地目录/);
    assert.match(result.error, /git pull/);
    assert.deepEqual(commands, [], '被拒绝的更新不能碰 profile');
  });
});

test('plugin-sources 内的克隆目录照常走重克隆更新（守卫不误伤）', async () => {
  await withRuntime({ '@deepseek-ai/dsh-llm': '0.1.5-rc.2' }, async home => {
    const dir = join(home, 'profiles', 'web', 'plugin-sources', 'a-b');
    await mkdir(dir, { recursive: true });
    const commands = [];
    let cloned = false;
    const result = await applyPluginUpdate({
      name: '@a/b', kind: 'git', spec: `file:${dir}`,
      installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/a/b.git', author: 'a', repo: 'b', subdir: null, dir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); },
      clone: async () => {
        cloned = true;
        // 真 cloneToSources 一定会把 package.json 落进目标目录；假 clone 也一样，
        // 否则「入口校验/构建」这道门会（正确地）拒绝一个不存在的源码包。
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@a/b', version: '2.0.0' }), 'utf8');
        return { ok: true, dest: dir, packageName: '@a/b' };
      },
      peerProbe: async () => ({})
    });
    assert.notEqual(result.status, 'dev-linked', 'plugin-sources 内的目录不触发守卫');
    assert.equal(cloned, true, '守卫放行后应继续重克隆流程');
  });
});


test('安装验收：包没物化进 node_modules → 不算成功，自动撤销并如实上报', async () => {
  const commands = [];
  const result = await acceptInstalledPackage('dsh-foo', 'pnpm 说 ok', async args => { commands.push(args); }, async () => null);
  assert.equal(result.ok, false);
  assert.match(result.error, /dsh-foo 没有出现在 node_modules 里（未生效）/);
  assert.match(result.error, /已自动撤销这次安装/);
  assert.deepEqual(commands, [['remove', 'dsh-foo']], '验收不过要自动撤销这次安装');
});

test('安装验收：包已物化且 import 可落地 → 通过', async () => {
  const commands = [];
  const result = await acceptInstalledPackage('dsh-foo', 'pnpm 说 ok', async args => { commands.push(args); }, async () => '2.0.0');
  assert.equal(result.ok, true);
  assert.equal(result.note, 'pnpm 说 ok');
  assert.deepEqual(commands, [], '验收通过不做任何撤销');
});

test('isDevLinkedSource：plugin-sources 之外的开发目录识别为 dev-linked', async () => {
  await withRuntime({}, async home => {
    const inSources = { kind: 'git', remote: { dir: join(home, 'profiles', 'web', 'plugin-sources', 'a-b') } };
    const outside = { kind: 'git', remote: { dir: '/Users/x/dev/dsh-genui' } };
    const npmSource = { kind: 'npm', remote: { type: 'npm' } };
    assert.equal(isDevLinkedSource(inSources), false, 'plugin-sources 内的克隆目录不算');
    assert.equal(isDevLinkedSource(outside), true, '用户目录应识别为 dev-linked');
    assert.equal(isDevLinkedSource(npmSource), false, 'npm 来源没有 dir，不算');
    assert.equal(isDevLinkedSource(null), false);
  });
});

test('stripStaleLockEntry：只删目标包的 importers 记录，别的条目与其他段不动', async () => {
  await withRuntime({}, async home => {
    const lockPath = join(home, 'profiles', 'web', 'pnpm-lock.yaml');
    await mkdir(join(home, 'profiles', 'web'), { recursive: true });
    await writeFile(lockPath, [
      'lockfileVersion: 9.0',
      '', 'importers:', '',
      "  '@changfenhuang/dsh-genui':",
      '    specifier: file:/Users/x/dev/dsh-genui',
      '    version: link:../../../004个人代码仓库/dsh-genui',
      '', "  dsh-notify:", '    specifier: github:zhengjy01/dsh-notify',
      '    version: github:zhengjy01/dsh-notify', '',
      'packages:', "  dsh-notify@1.0.0:", '    resolution: {integrity: sha512-x}',
    ].join('\n'), 'utf8');
    const changed = await stripStaleLockEntry('@changfenhuang/dsh-genui');
    assert.equal(changed, true, '有钉死的记录要报改动');
    const after = await readFile(lockPath, 'utf8');
    assert.equal(after.includes('dsh-genui'), false, '目标记录整块删除');
    assert.ok(after.includes('dsh-notify'), '别的 importers 条目保留');
    assert.ok(after.includes('packages:'), '其他顶层段保留');
    assert.equal(await stripStaleLockEntry('not-in-lock'), false, '没有记录时报未改动');
  });
});

test('安装验收：第一次没物化 → 清钉重装一次 → 物化了就算成功，不回滚', async () => {
  const commands = [];
  let first = true;
  const result = await acceptInstalledPackage('dsh-foo', 'pnpm 说 ok', async args => {
    commands.push(args);
  }, async () => {
    const present = !first; first = false; return present;
  }, 'dsh-foo@2.0.0');
  assert.equal(result.ok, true, '重装后物化了就别报失败');
  // 直接调用验收时，第一次「没物化」发生在任何命令之前；重试只补一次 add
  assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']], '重试恰好多跑一次 add');
  assert.equal(commands.some(args => args[0] === 'remove'), false, '成功路径不回滚');
});

test('安装验收：重装后仍未物化 → 回滚并如实上报', async () => {
  const commands = [];
  const result = await acceptInstalledPackage('dsh-foo', 'pnpm 说 ok', async args => {
    commands.push(args);
  }, async () => null, 'dsh-foo@2.0.0');
  assert.equal(result.ok, false);
  assert.match(result.error, /没有出现在 node_modules 里/);
  assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0'], ['remove', 'dsh-foo']],
    '重试一次仍失败才回滚（重试的 add + 撤销的 remove）');
});
