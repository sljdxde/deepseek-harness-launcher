// lib/index.js + lib/atomic.js 的最后几处未覆盖分支：
//
//   1) installPlugin：npm 探测抛错 → 记成 'unreachable' 继续（不让整个安装崩掉）
//   2) installPlugin：repository 查询抛错 → 跳过这个候选（宁可不装也不装错包）
//   3) installPlugin：clone 抛错 → 如实报失败（不让异常穿透成 500）
//   4) discoverPluginRowIds：dump 成功与 dump 失败各走一遍
//   5) applyPluginUpdate：dev-linked 插件显式选择「切换为 npm 发行版」
//   6) atomic.readJsonFile：正常 JSON 与损坏 JSON 各走一遍
//
// 为什么单独一个文件：这六条都是**降级/兜底**分支，正常路径的用例碰不到；
// 而它们各自又依赖不同的注入点（npmProbe / npmRepository / clone / execFile），
// 放在一起最省事，也避免在已有的大文件里塞太多不相干的用例。
//
// 三条硬约束（与本仓库其它测试一致）：
//   1) 不联网、不跑真实子进程：lib/index.js 里的 `run` 是 `promisify(execFile)`，
//      模块加载时就绑定了。所以在 import lib/index.js **之前**替换 node:child_process
//      的 execFile（用 createRequire 拿到 CJS exports 改），run() 就全部落到本文件
//      的假实现上——dsh CLI / pnpm / git 全是假的。
//   2) 不改生产代码：lib/index.js 与 lib/atomic.js 一个字节都不动。
//   3) 环境变量（DSH_HOME）每个用例都要改，所以全部串行（concurrency: false）
//      并在 finally 里恢复。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach } from 'node:test';

// ---------------------------------------------------------------------------
// 假子进程：dsh CLI / pnpm / git 全走这里，不联网也不碰真实程序
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');

/** 记录所有被拦截的子进程调用（断言用）。 */
const execLog = [];
/** 当前生效的子进程假实现：(call) => {stdout?, stderr?} | {error} */
let execHook = null;

/** 构造一个「子进程失败」的错误，形态对齐 node 的 execFile。 */
function execError(message, { stdout = '', stderr = '', code = 1 } = {}) {
  const error = new Error(message);
  error.code = code;
  error.stdout = stdout;
  error.stderr = stderr;
  return error;
}

childProcess.execFile = function fakeExecFile(file, args, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const call = {
    file: String(file),
    args: Array.isArray(args) ? [...args] : [],
    options: options && typeof options === 'object' ? options : {}
  };
  execLog.push(call);
  (async () => {
    let outcome = null;
    try {
      outcome = execHook ? await execHook(call) : null;
    } catch (error) {
      outcome = { error };
    }
    if (!outcome) {
      done(null, { stdout: '', stderr: '' });
      return;
    }
    if (outcome.error) {
      done(outcome.error);
      return;
    }
    done(null, { stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '' });
  })().catch(() => done(execError('fake execFile failed')));
};

// 假 HTTP：国内加速状态走 127.0.0.1，不许真连
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
afterEach(() => { execHook = null; });

// 必须在替换 execFile 之后再 import：lib/index.js 顶层就会 promisify(execFile)。
const lib = await import('../lib/index.js');
const { applyPluginUpdate, discoverPluginRowIds, installPlugin } = lib;
const { readJsonFile } = await import('../lib/atomic.js');

// ---------------------------------------------------------------------------
// 通用助手
// ---------------------------------------------------------------------------

const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

/** 临时 DSH_HOME（跑完恢复环境变量并删目录）。 */
async function withTempHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-h-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

/** 写一份 profile 布局（manifest + node_modules 里的包）。 */
async function writeProfile(home, { dependencies = {}, bundles = [], packages = {} } = {}) {
  const profile = join(home, 'profiles', 'web');
  await mkdir(join(profile, 'node_modules'), { recursive: true });
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'web',
    private: true,
    dependencies,
    dsh: { profile: { bundles } }
  }, null, 2), 'utf8');
  for (const [name, pkg] of Object.entries(packages)) {
    const dir = join(profile, 'node_modules', ...name.split('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf8');
  }
  return profile;
}

/** 真实 dump-config 的形状（顶层行 + 来源节 + 缩进子行）。 */
const DUMP_FIXTURE = [
  '# == @alice/dsh-own-plugin',
  '- id: alice-row',
  "  name: '@alice/dsh-own-plugin'",
  ''
].join('\n');

/**
 * 造一个「用户自己的开发 checkout」（link: 依赖 + 来源标记）。
 * 没有来源标记时来源会被判成 local（remote 为 null），就地更新拿不到目录。
 */
async function makeDevCheckout(home, { name = 'demo', version = '1.0.0', dir = 'my-checkout' } = {}) {
  const checkout = join(home, dir);
  await mkdir(checkout, { recursive: true });
  await writeFile(join(checkout, 'package.json'), JSON.stringify({ name, version }), 'utf8');
  await writeFile(join(checkout, '.dsh-source.json'), JSON.stringify({
    author: 'o', repo: name, subdir: null, url: `https://github.com/o/${name}.git`, commit: 'a'.repeat(40)
  }), 'utf8');
  await writeProfile(home, {
    dependencies: { [name]: `link:${checkout}` },
    bundles: [name],
    packages: { [name]: { name, version } }
  });
  return checkout;
}

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    try {
      await readdir(path);
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// 1) installPlugin：npm 探测抛错
// ---------------------------------------------------------------------------

serialTest('installPlugin：npm 探测抛错时不崩，记成 unreachable 后如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const probed = [];
    const result = await installPlugin({ name: 'plain' }, async () => ({}), {
      verifyPresent: async () => true,
      // 探测抛错 = registry 整个探不通（网络断了 / pnpm 挂了）。
      npmProbe: async (name) => {
        probed.push(name);
        throw new Error('registry 超时');
      }
    });

    assert.deepEqual(probed, ['plain'], '每个候选都要探一次');
    assert.equal(result.ok, false, '探不通装不上，但不能把异常穿透出去');
    assert.match(result.error, /registry 超时/);
  });
});

serialTest('installPlugin：npm 探测抛错时降级到 git 源码，不因为探测失败就不装', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const cloned = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({}), {
      verifyPresent: async () => true,
      npmProbe: async () => { throw new Error('registry 超时'); },
      clone: async (ref) => {
        cloned.push(ref);
        return { ok: false, error: 'clone 失败' };
      }
    });

    assert.equal(cloned.length, 1, '探测失败后仍然走 git 源码那条路');
    assert.equal(cloned[0].repo, 'Repo');
    assert.equal(result.ok, false);
    assert.match(result.error, /clone 失败/);
  });
});

// ---------------------------------------------------------------------------
// 2) installPlugin：repository 查询抛错
// ---------------------------------------------------------------------------

serialTest('installPlugin：repository 查询抛错时跳过该候选，不装可能装错人的包', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const added = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      added.push(args);
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      // '@owner/repo' 在 npm 上不存在，裸名 'repo' 存在 → 裸名候选要核对 repository。
      npmProbe: async (name) => name === 'repo',
      npmRepository: async () => { throw new Error('repository 查询失败'); },
      clone: async () => ({ ok: false, error: 'clone 失败' })
    });

    assert.deepEqual(added, [], 'repository 查不到就不能 add 那个同名包');
    assert.equal(result.ok, false);
    assert.match(result.error, /clone 失败/);
  });
});

serialTest('installPlugin：repository 对不上时跳过该候选（宁可不装也不装错人的包）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const added = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      added.push(args);
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      npmProbe: async (name) => name === 'repo',
      // npm 上的 'repo' 是别人发布的 → 仓库对不上，必须跳过。
      npmRepository: async () => ({ url: 'https://github.com/someone-else/repo' }),
      clone: async () => ({ ok: false, error: 'clone 失败' })
    });

    assert.deepEqual(added, [], 'repository 对不上就不能 add 那个同名包');
    assert.equal(result.ok, false);
    assert.match(result.error, /clone 失败/);
  });
});

// ---------------------------------------------------------------------------
// 3) installPlugin：clone 抛错
// ---------------------------------------------------------------------------

serialTest('installPlugin：clone 抛错时如实报失败，不让异常穿透成 500', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({}), {
      verifyPresent: async () => true,
      // npm 上没有 → 只能走 git 源码；clone 真失败（磁盘满 / git 崩了）。
      npmProbe: async () => false,
      clone: async () => { throw new Error('磁盘满'); }
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /磁盘满/);
  });
});

// ---------------------------------------------------------------------------
// 4) discoverPluginRowIds：dump 成功与失败
// ---------------------------------------------------------------------------

serialTest('discoverPluginRowIds：dump 成功时按行 id 解析，dump 失败时按空处理', async () => {
  await withTempHome(async home => {
    await writeProfile(home);

    // dump 成功：dsh web --dump-config 有输出 → 解析出顶层行 id
    execHook = (call) => (call.args[0] === 'web' ? { stdout: DUMP_FIXTURE, stderr: '' } : { stdout: '', stderr: '' });
    const rows = await discoverPluginRowIds({ force: true, fingerprint: 'h-ok' });
    assert.ok(rows.has('@alice/dsh-own-plugin'), 'dump 成功时能定位到插件的行 id');

    // dump 失败：命令报错 → 按空处理，不让整条链路挂掉
    execHook = (call) => {
      if (call.args[0] === 'web') throw execError('dsh web --dump-config 失败');
      return { stdout: '', stderr: '' };
    };
    const failed = await discoverPluginRowIds({ force: true, fingerprint: 'h-bad' });
    assert.equal(failed.size, 0, 'dump 失败时按空清单处理');
  });
});

// ---------------------------------------------------------------------------
// 5) applyPluginUpdate：dev-linked 插件显式切换为 npm 发行版
// ---------------------------------------------------------------------------

serialTest('applyPluginUpdate：指向用户目录的插件显式切换为 npm 发行版（本地目录不动）', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home);
    // pnpm view <name> version --json 的假输出
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"2.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `link:${checkout}`, installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: checkout }
    }, {
      mode: 'switch-release',
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); }
    });

    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.deepEqual(commands, [['add', 'demo@2.0.0']], '切发行版只装 npm 包，不动用户目录');
    assert.equal(await exists(join(checkout, 'package.json')), true, '用户自己的 checkout 没被动过');
  });
});

// ---------------------------------------------------------------------------
// 6) applyPluginUpdate：dev-linked 插件没给 mode 时默认拒绝自动更新
// ---------------------------------------------------------------------------

serialTest('applyPluginUpdate：指向用户目录的插件没给 mode 时默认拒绝自动更新', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home);
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `link:${checkout}`, installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: checkout }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); }
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.deepEqual(commands, [], '没显式选动作之前不许动用户目录');
  });
});

// ---------------------------------------------------------------------------
// 7) atomic.readJsonFile：正常 JSON 与损坏 JSON
// ---------------------------------------------------------------------------

serialTest('readJsonFile：正常 JSON 原样返回，损坏 JSON 改名留档后返回 fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pm-h-atomic-'));
  try {
    const good = join(dir, 'good.json');
    await writeFile(good, '{"version":1,"ok":true}', 'utf8');
    assert.deepEqual(await readJsonFile(good, { version: 0 }), { version: 1, ok: true });

    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{ broken json', 'utf8');
    assert.deepEqual(await readJsonFile(bad, { version: 1 }), { version: 1 });

    const names = await readdir(dir);
    assert.ok(!names.includes('bad.json'), '坏文件被挪走了，不会反复读到坏状态');
    const corrupt = names.find(name => name.startsWith('bad.json.corrupt-'));
    assert.ok(corrupt, '坏文件留在旁边供事后排查');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


// ---------------------------------------------------------------------------
// 7) discoverPluginRowIds：指纹相同就吃缓存（不重新 dump）
// ---------------------------------------------------------------------------

serialTest('discoverPluginRowIds：指纹相同就不重新 dump，走缓存', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { bundles: ['demo'], packages: { demo: { name: 'demo', version: '1.0.0' } } });
    let dumps = 0;
    execHook = (call) => {
      if (call.args[0] === 'web') { dumps += 1; return { stdout: DUMP_FIXTURE, stderr: '' }; }
      return { stdout: '', stderr: '' };
    };
    const first = await discoverPluginRowIds({ profileDir: join(home, 'profiles', 'web') });
    assert.ok(first instanceof Map, '返回 bundle → 行 id 的映射');
    const afterFirst = dumps;
    assert.ok(afterFirst >= 1, '第一次确实 dump 了');
    const second = await discoverPluginRowIds({ profileDir: join(home, 'profiles', 'web') });
    assert.deepEqual([...second.entries()], [...first.entries()], '第二次拿到同样的行 id');
    assert.equal(dumps, afterFirst, '指纹相同就不再 dump 一次');
  });
});

// ---------------------------------------------------------------------------
// 8) installPlugin：repository 查询抛错 → 跳过该候选，不整个崩掉
// ---------------------------------------------------------------------------

serialTest('installPlugin：repository 查询抛错时跳过该候选并继续', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { repo: { name: 'repo', version: '1.0.0' } } });
    const commands = [];
    // repositoryOf 是注入点：这里让它抛错（真实实现 npmRepositoryOf 自己吞异常返回
    // null，所以这条分支只有注入实现抛错才会走到 —— 正是要守住的降级行为）。
    // 候选不带 @ 才会走 repository 核对（带 scope 的官方包不走这条）。
    const result = await installPlugin({ name: 'owner/repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      // 第一个候选（@owner/repo）探测失败 → 走到第二个候选 repo（不带 @，要核对来源）
      npmProbe: async (name) => name !== '@owner/repo',
      npmRepository: async () => { throw new Error('registry 断了'); },
      // git 兜底也注入假实现：既不碰真实 git，也不让 clone 的原因盖掉核对失败。
      clone: async () => ({ ok: false, error: 'clone 失败' })
    });
    // 核对抛错 → 该候选被跳过（不会装成 npm 版），随后走 git 源码回退。
    process.stderr.write('DBG commands=' + JSON.stringify(commands) + String.fromCharCode(10));
    assert.ok(!commands.some(args => args[0] === 'add' && args[1] === 'repo'), '没核对上就不装 npm 版：' + JSON.stringify(commands));
    assert.match(result.error, /clone 失败/, 'git 兜底也失败时如实报最后一步的原因');
  });
});

// ---------------------------------------------------------------------------
// 9) applyPluginUpdate：mode=switch-release 切到 npm 发行版
// ---------------------------------------------------------------------------

serialTest('applyPluginUpdate：mode=switch-release 改用 npm 发行版', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home, { name: 'demo', version: '1.0.0' });
    await writeProfile(home, {
      dependencies: { demo: `link:${checkout}` },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '2.0.0' } },
    });
    const commands = [];
    execHook = (call) => {
      if (call.args[0] === 'view') return { stdout: '"3.0.0"', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `git+https://github.com/o/demo.git`, installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: checkout },
    }, {
      mode: 'switch-release',
      check: async () => [{ status: 'update-available', latestVersion: '3.0.0' }],
      command: async (args) => { commands.push(args); },
    });
    assert.equal(result.ok, true, '切换到发行版成功：' + JSON.stringify(result));
    assert.ok(commands.some(args => args[0] === 'add' && args[1] === 'demo@3.0.0'), '装的是 npm 发行版：' + JSON.stringify(commands));
  });
});
