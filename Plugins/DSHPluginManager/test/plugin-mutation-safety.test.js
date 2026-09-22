import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyPluginUpdate,
  cleanupBrokenPlugin,
  pruneSourceBackups,
  uninstallPlugin,
  writeUpdateCache
} from '../lib/index.js';

// 插件写操作「不许把 profile 弄成起不来」的离线单测：
// 装/升出一个 import 落不了地的版本时必须当场撤销并退回原版本；备份/回滚本身
// 不许吞错；内置与必需组件不许被卸载或清理。所有 pnpm 动作都走注入的假 command，
// DSH_HOME 指到临时目录，绝不碰真实 profile。

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

/** 临时 DSH_HOME + 一个 web profile，返回路径与已装包目录构造器。 */
async function withProfile(prefix, fn) {
  const home = await mkdtemp(join(tmpdir(), prefix));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const profileDir = join(home, 'profiles', 'web');
    await mkdir(join(profileDir, 'node_modules'), { recursive: true });
    return await fn({ home, profileDir, modules: join(profileDir, 'node_modules') });
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

/** 在 node_modules 里铺一个包；missing 为真时它 import 一个不存在的模块。 */
async function seedPackage(modules, name, { version, missing, healthy = false } = {}) {
  const dir = join(modules, ...name.split('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version }), 'utf8');
  await writeFile(
    join(dir, 'index.mjs'),
    missing ? "import { x } from './shared/gone.mjs';\nexport const a = x;\n"
      : healthy ? "import { x } from './shared/here.mjs';\nexport const a = x;\n" : "export const a = 1;\n",
    'utf8'
  );
  if (healthy) {
    await mkdir(join(dir, 'shared'), { recursive: true });
    await writeFile(join(dir, 'shared/here.mjs'), 'export const x = 1;\n', 'utf8');
  }
  return dir;
}

const npmSource = (name, installedVersion) => ({
  name,
  kind: 'npm',
  spec: `^${installedVersion}`,
  installedVersion,
  installedCommit: null,
  remote: { type: 'npm', package: name }
});

// ---------------------------------------------------------------------------
// 用例组：npm / github: 升级装出坏版本 → 撤销并退回
// ---------------------------------------------------------------------------

test('npm 升级到坏版本：不报成功，自动 add 回原版本并点名缺失模块', async () => {
  await withProfile('dsh-ms-npm-bad-', async ({ modules }) => {
    await seedPackage(modules, 'dsh-foo', { version: '2.0.0', missing: true });
    const commands = [];
    const result = await applyPluginUpdate(npmSource('dsh-foo', '1.4.0'), {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); }
    });
    assert.equal(result.ok, false, '装坏了不能算更新成功');
    assert.match(result.error, /\.\/shared\/gone\.mjs/);
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0'], ['add', 'dsh-foo@1.4.0']], '必须退回升级前那个版本');
    assert.match(result.error, /已退回原版本 v1\.4\.0/);
  });
});

test('npm 升级到坏版本且退回也失败：如实说明要手动处理', async () => {
  await withProfile('dsh-ms-npm-rollback-fail-', async ({ modules }) => {
    await seedPackage(modules, 'dsh-foo', { version: '2.0.0', missing: true });
    const commands = [];
    const result = await applyPluginUpdate(npmSource('dsh-foo', '1.4.0'), {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => {
        commands.push(args);
        if (args[1] === 'dsh-foo@1.4.0') throw new Error('registry 502');
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /退回 v1\.4\.0 也失败/);
    assert.match(result.error, /registry 502/);
  });
});

test('npm 升级没有版本可退回时如实说不知道，而不是假装成功', async () => {
  await withProfile('dsh-ms-npm-noop-', async ({ modules }) => {
    await seedPackage(modules, 'dsh-foo', { version: '2.0.0', missing: true });
    const result = await applyPluginUpdate(npmSource('dsh-foo', null), {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {}
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /不知道/);
  });
});

test('npm 升级到好版本：照常成功，不做任何撤销动作', async () => {
  await withProfile('dsh-ms-npm-good-', async ({ modules }) => {
    await seedPackage(modules, 'dsh-foo', { version: '2.0.0', healthy: true });
    const commands = [];
    const result = await applyPluginUpdate(npmSource('dsh-foo', '1.4.0'), {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async args => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.deepEqual(commands, [['add', 'dsh-foo@2.0.0']]);
  });
});

test('github: 来源升级装坏：退回原 commit', async () => {
  await withProfile('dsh-ms-git-src-bad-', async ({ modules }) => {
    await seedPackage(modules, 'dsh-bar', { version: '0.2.0', missing: true });
    const commands = [];
    const source = {
      name: 'dsh-bar',
      kind: 'git',
      spec: 'github:someone/dsh-bar',
      installedVersion: '0.1.0',
      installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      remote: { type: 'git', url: 'https://github.com/someone/dsh-bar.git', author: 'someone', repo: 'dsh-bar', subdir: null, dir: null }
    };
    const result = await applyPluginUpdate(source, {
      check: async () => [{ status: 'update-available', latestVersion: '0.2.0' }],
      command: async args => { commands.push(args); }
    });
    assert.equal(result.ok, false);
    assert.deepEqual(commands, [
      ['add', 'github:someone/dsh-bar'],
      ['add', 'github:someone/dsh-bar#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']
    ]);
    assert.match(result.error, /已退回原 commit aaaaaaaa/);
  });
});

// ---------------------------------------------------------------------------
// 用例组：file: 克隆来源的备份与回滚
// ---------------------------------------------------------------------------

const fileSource = dir => ({
  name: 'repo',
  kind: 'git',
  spec: `file:${dir}`,
  installedVersion: '1.0.0',
  installedCommit: 'b'.repeat(40),
  remote: { type: 'git', url: 'https://github.com/owner/repo.git', author: 'owner', repo: 'repo', subdir: 'examples/repo', dir }
});

test('clone 被校验拒绝时，错误要说明原有源码没被动过', async () => {
  await withProfile('dsh-ms-clone-refuse-', async ({ home }) => {
    const dir = join(home, 'plugin-sources', 'owner-repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.js'), '// 旧版本', 'utf8');
    const commands = [];
    let error = null;
    try {
      await applyPluginUpdate(fileSource(dir), {
        check: async () => [{ status: 'update-available', latestVersion: '1.1.0' }],
        command: async args => { commands.push(args); },
        clone: async () => ({ ok: false, error: '插件源码缺少模块 ./shared/x.mjs；原有源码未改动' })
      });
    } catch (thrown) { error = thrown; }
    assert.match(String(error?.message), /原有源码未改动/);
    assert.equal(await readFileText(join(dir, 'index.js')), '// 旧版本');
    assert.deepEqual(commands, []);
  });
});

test('node_modules 重装失败时用更新前的源码副本兜底，并上报失败', async () => {
  await withProfile('dsh-ms-finalize-restore-', async ({ home, modules }) => {
    const dir = join(home, 'plugin-sources', 'owner-repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'repo', version: '1.1.0' }), 'utf8');
    // node_modules 里版本停在 1.0.0 → 复核不过 → 走「删包重装」这条路。
    await seedPackage(modules, 'repo', { version: '1.0.0' });
    // applyPluginUpdate 自己会建一个 .bak-<时间戳>；这里只断言"重装用的是 .bak 目录"。
    const commands = [];
    let addToFile = 0;
    const result = await applyPluginUpdate(fileSource(dir), {
      check: async () => [{ status: 'update-available', latestVersion: '1.1.0' }],
      command: async args => {
        if (String(args[1]).startsWith('file:')) addToFile += 1;
        commands.push(args);
        if (String(args[1]).startsWith('file:') && addToFile === 2) throw new Error('pnpm 被中断');
      },
      clone: async () => ({ ok: true, dest: dir, packageName: 'repo' })
    });
    assert.equal(result.ok, false, '包没装上不能报成功');
    const spec = String(result.error ?? '');
    assert.match(spec, /pnpm 被中断/);
    const restores = commands.filter(args => /\.bak-/.test(String(args[1])));
    assert.equal(restores.length, 1, '应该改用更新前的 .bak 源码副本重装一次');
  });
});

test('重装成功但源码仍残缺：不许留下坏包，退回更新前的源码副本', async () => {
  await withProfile('dsh-ms-finalize-gaps-', async ({ home, modules }) => {
    const dir = join(home, 'plugin-sources', 'owner-repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'repo', version: '1.1.0' }), 'utf8');
    await seedPackage(modules, 'repo', { version: '1.0.0' });
    const commands = [];
    let addToFile = 0;
    const result = await applyPluginUpdate(fileSource(dir), {
      check: async () => [{ status: 'update-available', latestVersion: '1.1.0' }],
      command: async args => {
        commands.push(args);
        if (!String(args[1]).startsWith('file:')) return;
        addToFile += 1;
        // 第二次（finalize 的删包重装）才把残缺源码物化进 node_modules：版本对了，
        // 但 import 落不了地——正是那次事故的形状。
        if (addToFile === 2) {
          // 真实的 pnpm 会自己把包目录建回来（finalize 之前把它删过）。
          await mkdir(join(modules, 'repo'), { recursive: true });
          await writeFile(join(modules, 'repo', 'index.mjs'), "import { x } from './shared/gone.mjs';\nexport const a = x;\n", 'utf8');
          await writeFile(join(modules, 'repo', 'package.json'), JSON.stringify({ name: 'repo', version: '1.1.0' }), 'utf8');
        }
      },
      clone: async () => ({ ok: true, dest: dir, packageName: 'repo' })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /\.\/shared\/gone\.mjs/);
    assert.ok(commands.some(args => /\.bak-/.test(String(args[1]))), '应退回更新前的源码副本');
  });
});

test('pruneSourceBackups 顺手清掉中断留下的 .staged-* 副本', async () => {
  await withProfile('dsh-ms-prune-', async ({ home }) => {
    const sources = join(home, 'plugin-sources');
    const dir = join(sources, 'owner-repo');
    await mkdir(dir, { recursive: true });
    for (const stale of ['owner-repo.staged-1-100', 'owner-repo.bak-20260101000000', 'owner-repo.bak-20260201000000', 'other.staged-9']) {
      await mkdir(join(sources, stale), { recursive: true });
    }
    const removed = await pruneSourceBackups(dir);
    assert.ok(removed.includes('owner-repo.staged-1-100'), '暂存副本要被清掉');
    assert.ok(removed.includes('owner-repo.bak-20260101000000'), '只保留最近一个备份');
    assert.ok(await exists(join(sources, 'owner-repo.bak-20260201000000')), '最近的备份不能动');
    assert.ok(await exists(join(sources, 'other.staged-9')), '别的插件的目录不能动');
  });
});

// ---------------------------------------------------------------------------
// 用例组：必需组件不许被拆 + 状态文件原子写
// ---------------------------------------------------------------------------

for (const name of ['dsh-plugin-manager', 'dsh-archive-manager', 'dsh-session-notify']) {
  test(`内置插件 ${name} 不许卸载`, async () => {
    await withProfile('dsh-ms-protect-', async () => {
      const result = await uninstallPlugin(name);
      assert.equal(result.ok, false);
      assert.match(result.error, /内置插件/);
    });
  });
}

test('清理坏安装不许拆掉 dsh 必需组件', async () => {
  await withProfile('dsh-ms-protect-core-', async () => {
    await assert.rejects(() => cleanupBrokenPlugin('@deepseek-ai/dsh-web-app'), /必需组件/);
    await assert.rejects(() => cleanupBrokenPlugin('dsh-plugin-manager'), /必需组件/);
  });
});

test('更新缓存写盘是原子的：不留 .tmp 残片，目录不存在也能写', async () => {
  await withProfile('dsh-ms-cache-atomic-', async ({ profileDir }) => {
    const target = join(profileDir, 'nested', '.plugin-updates.json');
    await writeUpdateCache({ checkedAt: 'now', inventory: [{ name: 'a', status: 'up-to-date' }, { name: '', status: 'x' }] }, target);
    assert.deepEqual((await readdir(join(profileDir, 'nested'))).filter(entry => entry.includes('.tmp')), []);
    const written = JSON.parse(await readFileText(target));
    assert.equal(written.inventory.length, 1, '畸形条目仍然被过滤');
  });
});

const readFileText = path => readFile(path, 'utf8');
