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
const { applyPluginUpdate, discoverPluginRowIds, installPlugin, parseVersionRejection, allowPluginVersion, resetMirrorCache, gitCloneUrlChain } = lib;
const { readJsonFile } = await import('../lib/atomic.js');

// ---------------------------------------------------------------------------
// 通用助手
// ---------------------------------------------------------------------------

const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

/** 在假 clone 目标里铺一棵最小文件树（package.json 等）。 */
async function writeTree(root, tree) {
  const { mkdir: mk, writeFile: wf } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  for (const [relative, content] of Object.entries(tree || {})) {
    const target = join(root, ...relative.split('/'));
    await mk(dirname(target), { recursive: true });
    await wf(target, content, 'utf8');
  }
}

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

// ---------------------------------------------------------------------------
// 0) git clone 的 URL 候选链：镜像挂了不能把安装一起带走
// ---------------------------------------------------------------------------

serialTest('gitCloneUrlChain：镜像开启时镜像在前，关闭时直连在前，ssh 永远兜底', () => {
  const ref = { author: 'vectorize-io', repo: 'hindsight' };
  const mirrorTable = [{ match: 'https://github.com/', replace: 'https://ghfast.top/https://github.com/', kind: 'git' }];
  const withMirror = gitCloneUrlChain(ref, mirrorTable);
  assert.deepEqual(withMirror, [
    'https://ghfast.top/https://github.com/vectorize-io/hindsight.git',
    'https://github.com/vectorize-io/hindsight.git',
    'git@github.com:vectorize-io/hindsight.git',
  ]);
  const withoutMirror = gitCloneUrlChain(ref, null);
  assert.deepEqual(withoutMirror, [
    'https://github.com/vectorize-io/hindsight.git',
    'git@github.com:vectorize-io/hindsight.git',
  ]);
});

serialTest('cloneToSources：镜像连不上时自动落到直连，装完不误报', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const previousPort = process.env.DSH_PORT;
    process.env.DSH_PORT = '3999';
    const realFetch = globalThis.fetch;
    // 镜像开启：第一个候选是 ghfast 前缀；让它失败，直连应当顶上。
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ enabled: true, table: [{ match: 'https://github.com/', replace: 'https://ghfast.top/https://github.com/', kind: 'git' }] }),
    });
    resetMirrorCache();
    const cloneTargets = [];
    const writeRepo = dest => writeTree(dest, {
      'package.json': JSON.stringify({ name: 'hindsight-plugin', version: '1.0.0' }),
    });
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        const url = call.args[call.args.length - 2];
        const dest = call.args[call.args.length - 1];
        cloneTargets.push(url);
        // 第一个（镜像）候选连不上；后面的候选成功。
        return cloneTargets.length === 1
          ? Promise.reject(execError("Command failed: git clone\nfatal: unable to access 'https://ghfast.top/…': Could not connect to server"))
          : writeRepo(dest).then(() => ({ stdout: '', stderr: '' }));
      }
      if (call.args.includes('rev-parse')) return { stdout: 'b'.repeat(40), stderr: '' };
      return { stdout: '', stderr: '' };
    };
    try {
      const result = await installPlugin(
        { name: 'vectorize-io/hindsight', url: 'https://github.com/vectorize-io/hindsight' },
        async () => ({}),
        { verifyPresent: async () => true, npmProbe: async () => false, repositoryOf: async () => null },
      );
      assert.equal(result.ok, true, '镜像失败后直连装上：' + (result.error || ''));
      assert.ok(cloneTargets[0].startsWith('https://ghfast.top/'), '第一个候选走镜像');
      assert.equal(cloneTargets[1], 'https://github.com/vectorize-io/hindsight.git', '第二个候选直连');
      // marker 里记的是实际生效的 URL，更新检测靠它反推远端。
      const marker = JSON.parse(await readFile(join(home, 'profiles', 'web', 'plugin-sources', 'vectorize-io-hindsight', '.dsh-source.json'), 'utf8'));
      assert.equal(marker.url, 'https://github.com/vectorize-io/hindsight.git');
    } finally {
      globalThis.fetch = realFetch;
      if (previousPort === undefined) delete process.env.DSH_PORT;
      else process.env.DSH_PORT = previousPort;
      resetMirrorCache();
    }
  });
});

serialTest('cloneToSources：全部候选都失败时聚合报错（镜像 → 直连 → ssh 各试一遍）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const previousPort = process.env.DSH_PORT;
    process.env.DSH_PORT = '3999';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ enabled: true, table: [{ match: 'https://github.com/', replace: 'https://ghfast.top/https://github.com/', kind: 'git' }] }),
    });
    resetMirrorCache();
    const cloneTargets = [];
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        cloneTargets.push(call.args[call.args.length - 2]);
        return Promise.reject(execError('fatal: unable to access: Could not connect to server'));
      }
      return { stdout: '', stderr: '' };
    };
    try {
      const result = await installPlugin(
        { name: 'vectorize-io/hindsight', url: 'https://github.com/vectorize-io/hindsight' },
        async () => ({}),
        { verifyPresent: async () => true, npmProbe: async () => false, repositoryOf: async () => null },
      );
      assert.equal(result.ok, false);
      assert.match(result.error, /clone 失败（3 个地址都试过了：镜像 → GitHub 直连 → ssh）/);
      assert.match(result.error, /Could not connect to server/, '带最后一次的原始错误');
      assert.equal(cloneTargets.length, 3, '三个候选都尝试过');
      assert.ok(cloneTargets[2].startsWith('git@github.com:'), 'ssh 是最后一个候选');
    } finally {
      globalThis.fetch = realFetch;
      if (previousPort === undefined) delete process.env.DSH_PORT;
      else process.env.DSH_PORT = previousPort;
      resetMirrorCache();
    }
  });
});

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

serialTest('installPlugin：两个 npm 候选并行探测，不串行等满两次超时', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    let started = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = installPlugin({ name: 'Owner/Repo' }, async () => ({}), {
      verifyPresent: async () => true,
      // 探测挂起，直到两条都发出（串行实现里第二条永远不会发出）。
      npmProbe: async () => {
        started += 1;
        await gate;
        return false;
      },
      clone: async () => ({ ok: false, error: 'clone 失败' })
    });
    // 轮询等待两条探测都发出（固定 sleep 在并行跑测试时会被机器负载拖慢）。
    const deadline = Date.now() + 3000;
    while (started < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(started, 2, '第二个候选在第一个返回前就已发出');
    release();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.error, /clone 失败/);
  });
});

serialTest('installPlugin：dsh 版本拒绝时立即上报并给出豁免信息，不再白跑构建', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const adds = [];
    const cloned = [];
    let prepared = false;
    const raw = 'dsh: installation rejected: Plugin @a/b@1.2.3 is incompatible with dsh 0.2.2-rc.2: '
      + 'requirements {"@deepseek-ai/dsh-fs":"0.2.0-rc.2","@deepseek-ai/dsh-shell":"0.2.0-rc.2"}. '
      + 'Running it may cause crashes or data loss.';
    const result = await installPlugin({ name: 'a/b' }, async (args) => {
      adds.push(args);
      throw new Error('Command failed: dsh.cmd plugin add @a/b\n' + raw);
    }, {
      verifyPresent: async () => true,
      npmProbe: async () => true,
      clone: async (ref) => { cloned.push(ref); return { ok: true, dest: 'X:/clone', packageName: '@a/b' }; },
      prepare: async () => { prepared = true; return { ok: true, built: true, missing: [] }; }
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.allowVersion, {
      name: '@a/b', version: '1.2.3', dshVersion: '0.2.2-rc.2',
      requirements: '{"@deepseek-ai/dsh-fs":"0.2.0-rc.2","@deepseek-ai/dsh-shell":"0.2.0-rc.2"}'
    });
    assert.match(result.error, /接受风险并安装/);
    assert.match(result.error, /0\.2\.2-rc\.2/, '错误里带当前 dsh 版本');
    assert.equal(adds.length, 1, '拒绝后不再尝试第二个候选名');
    assert.equal(cloned.length, 0, '拒绝后不再克隆源码');
    assert.equal(prepared, false, '拒绝后不再源码构建');
  });
});

serialTest('installPlugin：子目录插件源装 npm 发行版被拒时同样立即上报（不白跑构建）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    let prepared = false;
    const raw = 'dsh: installation rejected: Plugin @a/sub@2.0 is incompatible with dsh 9.9.9: '
      + 'requirements {"@deepseek-ai/dsh-fs":"9.8.0"}. Running it may cause crashes or data loss.';
    const result = await installPlugin({ name: 'a/b#c', url: 'https://github.com/a/b/tree/main/packages/c' }, async () => {
      throw new Error('Command failed: dsh.cmd\n' + raw);
    }, {
      verifyPresent: async () => true,
      npmProbe: async () => true,
      clone: async () => ({ ok: true, dest: 'X:/clone-c', packageName: '@a/sub' }),
      prepare: async () => { prepared = true; return { ok: true, built: true, missing: [] }; }
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.allowVersion, {
      name: '@a/sub', version: '2.0', dshVersion: '9.9.9', requirements: '{"@deepseek-ai/dsh-fs":"9.8.0"}'
    });
    assert.equal(prepared, false, '拒绝后不再源码构建');
  });
});

serialTest('parseVersionRejection：认识 dsh 的钉死拒绝原文，别的错误不误报', () => {
  const parsed = parseVersionRejection(
    'dsh: installation rejected: Plugin @struktoai/mirage-dsh@0.0.8 is incompatible with dsh 0.2.2-rc.2: '
    + 'requirements {"@deepseek-ai/dsh-fs":"0.2.0-rc.2"}. Running it may cause crashes.'
  );
  assert.deepEqual(parsed, {
    name: '@struktoai/mirage-dsh', version: '0.0.8', dshVersion: '0.2.2-rc.2',
    requirements: '{"@deepseek-ai/dsh-fs":"0.2.0-rc.2"}'
  });
  assert.equal(parseVersionRejection('dsh: nothing was installed.'), null, '普通失败不是版本拒绝');
  assert.equal(parseVersionRejection(''), null);
  // requirements 缺省也能解析出三元组
  const bare = parseVersionRejection('Plugin x/y@2.0 is incompatible with dsh 1.2.3.');
  assert.deepEqual({ ...bare, requirements: null }, { name: 'x/y', version: '2.0', dshVersion: '1.2.3', requirements: null });
});

serialTest('allowPluginVersion：参数原样透传给 dsh CLI；坏参数与拒绝都如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const seen = [];
    execHook = call => {
      seen.push(call);
      return { stdout: 'exemption granted for @a/b@1.2.3' };
    };
    const ok = await allowPluginVersion({ name: '@a/b', version: '1.2.3', dshVersion: '0.2.2-rc.2' });
    assert.equal(ok.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].file.includes('dsh'), true, '走 dsh CLI');
    // Windows 上必须是 dsh.cmd（execFile 跑无扩展名的 sh 脚本会 ENOENT）；
    // POSIX 上就是 .bin/dsh 本身。
    const dshBin = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
    assert.ok(seen[0].file.endsWith(dshBin), `dsh CLI 文件名以 ${dshBin} 结尾：${seen[0].file}`);
    assert.deepEqual(seen[0].args, [
      'plugin', '--profile', 'web', 'allow-version', '@a/b@1.2.3',
      '--dsh-version', '0.2.2-rc.2', '--accept-risk'
    ]);

    // 坏参数直接拒绝，不落子进程
    seen.length = 0;
    const bad = await allowPluginVersion({ name: 'a b; rm', version: '1', dshVersion: 'v' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /参数不合法/);
    assert.equal(seen.length, 0, '坏参数不碰 dsh CLI');

    // dsh 仍拒绝（比如豁免格式不对）→ ok:false 带原文
    execHook = () => ({ stdout: '', stderr: 'dsh: installation rejected: bad exemption' });
    const rejected = await allowPluginVersion({ name: '@a/b', version: '1', dshVersion: 'v' });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /installation rejected/);
  });
});

serialTest('pluginCommand：国内加速打开时，dsh CLI 子进程 env 注入两个 registry 变量', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const previousPort = process.env.DSH_PORT;
    process.env.DSH_PORT = '3999';
    const realFetch = globalThis.fetch;
    // 镜像插件在线：返回注册表映射 → 期望子进程 env 带上 npm/pnpm 两个前缀。
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ enabled: true, table: [{ match: 'https://registry.npmjs.org/', replace: 'https://registry.npmmirror.com/', kind: 'registry' }] }),
    });
    const seen = [];
    execHook = call => { seen.push(call); return { stdout: 'allowed' }; };
    try {
      // 前面的用例可能刚把「镜像关闭」缓存进内存（TTL 10s），先清掉再跑。
      resetMirrorCache();
      await allowPluginVersion({ name: '@a/b', version: '1.2.3', dshVersion: '0.2.2-rc.2' });
      const dshCall = seen.find(call => call.file.includes('dsh'));
      assert.ok(dshCall, 'dsh CLI 被调用');
      // 这是「安装提速」的核心回归点：pnpm 11 只认 pnpm_config_registry，
      // 只注入 npm 的那个等于没加速，pnpm install 会直连 npmjs 直到超时。
      assert.equal(dshCall.options.env.pnpm_config_registry, 'https://registry.npmmirror.com/');
      assert.equal(dshCall.options.env.npm_config_registry, 'https://registry.npmmirror.com/');
    } finally {
      globalThis.fetch = realFetch;
      if (previousPort === undefined) delete process.env.DSH_PORT;
      else process.env.DSH_PORT = previousPort;
      resetMirrorCache();
    }
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
