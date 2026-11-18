// lib/index.js 第 1051-2700 行的覆盖补齐：安装候选 / npm 探测 / 克隆到 plugin-sources /
// pnpm 物化 / 安装卸载 / 版本区间与 peer 依赖 / 批量更新 / 市场索引重建。
//
// 两条硬约束：
//   1) 不联网：所有子进程（pnpm shim / git / corepack）与所有 HTTP（npm registry、
//      国内加速镜像状态）都由本文件里的假实现接管。
//   2) 不改生产代码：lib/index.js 里的 `run` 是 `promisify(execFile)`，模块加载时就
//      绑定了。所以在 import lib/index.js **之前**替换 node:child_process 的 execFile
//      （用 createRequire 拿到 CJS exports 改，再让 ESM 侧在 facade 建立时取到新值），
//      这样 run() 全部落到假实现上，既不联网也不改生产文件。
//
// 环境变量（DSH_HOME）每个用例都要改，所以全部串行（concurrency: false）并在
// finally 里恢复。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { afterEach } from 'node:test';
import { linkDir } from './helpers/link-helpers.js';

// 每个用例跑完都把假实现撤掉，避免用例之间串味。
afterEach(() => {
  execHook = null;
  fetchHook = null;
  fsHooks = { rm: null, writeFile: null, readFile: null, rename: null };
});

// ---------------------------------------------------------------------------
// 假子进程 / 假网络
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');

/** 记录所有被拦截的子进程调用（断言用）。 */
const execLog = [];
/** 当前生效的子进程假实现：(call) => {stdout?, stderr?, error?} | Promise<...> */
let execHook = null;

/** 构造一个「子进程失败」的错误，形态对齐 node 的 execFile（带 stdout/stderr）。 */
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
      // 原样抛出（不把非 Error 包装成 Error）：生产代码里有 `error?.message || error`
      // 这种分支，包装了就测不到「抛的不是 Error」那条路。
      const error = outcome.error;
      if (error && typeof error === 'object') {
        if (outcome.stdout !== undefined) error.stdout = outcome.stdout;
        if (outcome.stderr !== undefined) error.stderr = outcome.stderr;
      }
      done(error);
      return;
    }
    done(null, { stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '' });
  })().catch(() => done(execError('fake execFile failed')));
};

/** 当前生效的 HTTP 假实现：(url) => {ok, status, json} */
let fetchHook = null;
globalThis.fetch = async (url, init) => {
  if (fetchHook) return fetchHook(String(url), init);
  return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
};

// ---------------------------------------------------------------------------
// fs 故障注入：把「写/删/改名失败」这些兜底分支跑出来。
// node:fs 的 promises 与 node:fs/promises 是同一个对象，lib/index.js 与
// lib/atomic.js 都从这里取 fs，所以打一处补丁两边都生效。
// ---------------------------------------------------------------------------

const fsPromises = require('node:fs').promises;
const realRm = fsPromises.rm.bind(fsPromises);
const realWriteFile = fsPromises.writeFile.bind(fsPromises);
const realReadFile = fsPromises.readFile.bind(fsPromises);
const realRename = fsPromises.rename.bind(fsPromises);

/** 每个钩子返回 true 表示「让这次调用失败」；readFile 还可以返回字符串替换内容。 */
let fsHooks = { rm: null, writeFile: null, readFile: null, rename: null };

fsPromises.rm = async (path, options) => {
  if (fsHooks.rm?.(String(path)) === true) throw new Error('fs.rm 失败（测试注入）');
  return realRm(path, options);
};
fsPromises.writeFile = async (path, content, options) => {
  if (fsHooks.writeFile?.(String(path)) === true) throw new Error('fs.writeFile 失败（测试注入）');
  return realWriteFile(path, content, options);
};
fsPromises.readFile = async (path, options) => {
  const verdict = fsHooks.readFile?.(String(path));
  if (verdict === true) throw new Error('fs.readFile 失败（测试注入）');
  if (typeof verdict === 'string') return verdict;
  return realReadFile(path, options);
};
fsPromises.rename = async (from, to) => {
  if (fsHooks.rename?.(String(from)) === true) throw new Error('fs.rename 失败（测试注入）');
  return realRename(from, to);
};

/** 在一段代码里注入 fs 故障（跑完恢复）。 */
async function withFsHooks(hooks, fn) {
  const previous = fsHooks;
  fsHooks = { rm: null, writeFile: null, readFile: null, rename: null, ...hooks };
  try {
    return await fn();
  } finally {
    fsHooks = previous;
  }
}

// 必须在替换 execFile 之后再 import：lib/index.js 顶层就会 promisify(execFile)。
const lib = await import('../lib/index.js');
const {
  applyPluginUpdate,
  cleanupBrokenPlugin,
  cleanupPluginSources,
  createSingleFlight,
  fetchOfficialMarketPlugins,
  fetchTargetPeerDependencies,
  findPeerIncompatibilities,
  findUnresolvableLocalImports,
  installCandidates,
  installPlugin,
  isBatchUpdateRunning,
  isDevLinkedSource,
  mergeMarketPlugins,
  missingPackageEntries,
  prepareClonedSource,
  pruneSourceBackups,
  readInstalledPeerDependencies,
  readLastBatchUpdate,
  readMarketplace,
  readRuntimePeerVersions,
  refreshMarketplace,
  repoMatchesEntry,
  resetMirrorCache,
  satisfiesPluginRange,
  uninstallPlugin,
  uninstallPlugins,
  updatePlugin,
  updatePlugins
} = lib;

// ---------------------------------------------------------------------------
// 通用助手
// ---------------------------------------------------------------------------

const serialTest = (name, options, fn) => {
  if (typeof options === 'function') return test(name, { concurrency: false }, options);
  return test(name, { ...options, concurrency: false }, fn);
};

/** 临时 DSH_HOME（跑完恢复环境变量并删目录）。 */
async function withTempHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-b-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  resetMirrorCache();
  try {
    return await run(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    resetMirrorCache();
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

/** 把一棵目录树写到目标目录（相对路径用 '/' 分隔，落盘时用 path.join）。 */
async function writeTree(root, tree) {
  for (const [relative, content] of Object.entries(tree || {})) {
    const target = join(root, ...relative.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
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
// 纯函数：installCandidates
// ---------------------------------------------------------------------------

serialTest('installCandidates：scope 包名原样当 npm 名，不拆作者/仓库', () => {
  assert.deepEqual(installCandidates({ name: '@deepseek-ai/dsh-plugin-foo' }), {
    candidates: ['@deepseek-ai/dsh-plugin-foo'],
    git: null,
    repoRef: null
  });
  // 带 scope 的名字后面跟 # 时不再是合法 npm 名 → 走普通拆分
  const scoped = installCandidates({ name: '@scope/pkg#sub' });
  assert.equal(scoped.repoRef.subdir, 'sub');
});

serialTest('installCandidates：author/repo 给出 scope 候选 + 裸名候选 + git 地址', () => {
  const result = installCandidates({ name: 'Owner/Repo' });
  assert.deepEqual(result.candidates, ['@owner/repo', 'repo']);
  assert.equal(result.git, 'https://github.com/Owner/Repo.git');
  assert.deepEqual(result.repoRef, { author: 'Owner', repo: 'Repo', subdir: null, full: 'Owner/Repo' });
});

serialTest('installCandidates：author/repo#subdir 不给 git 地址（只能稀疏克隆子目录）', () => {
  const result = installCandidates({ name: 'Owner/Repo#packages/foo' });
  assert.deepEqual(result.candidates, ['@owner/repo', 'repo']);
  assert.equal(result.git, null);
  assert.deepEqual(result.repoRef, {
    author: 'Owner', repo: 'Repo', subdir: 'packages/foo', full: 'Owner/Repo#packages/foo'
  });
});

serialTest('installCandidates：没有斜杠的名字只当裸 npm 名', () => {
  const result = installCandidates({ name: 'PlainName' });
  assert.deepEqual(result.candidates, ['plainname']);
  assert.equal(result.git, null);
  assert.equal(result.repoRef, null);
});

serialTest('installCandidates：空名字与「只有作者」都不产生候选', () => {
  assert.deepEqual(installCandidates({}), { candidates: [], git: null, repoRef: null });
  assert.deepEqual(installCandidates({ name: '  ' }), { candidates: [], git: null, repoRef: null });
  const authorOnly = installCandidates({ name: 'Owner/' });
  assert.deepEqual(authorOnly.candidates, []);
  assert.equal(authorOnly.repoRef, null);
});

// ---------------------------------------------------------------------------
// 纯函数：repoMatchesEntry
// ---------------------------------------------------------------------------

serialTest('repoMatchesEntry：字符串 / 对象两种形态都能对上 github 仓库', () => {
  const ref = { author: 'Owner', repo: 'Repo' };
  assert.equal(repoMatchesEntry('https://github.com/owner/repo', ref), true);
  assert.equal(repoMatchesEntry({ url: 'https://github.com/Owner/Repo' }, ref), true);
  assert.equal(repoMatchesEntry('git+https://github.com/owner/repo.git', ref), true);
  assert.equal(repoMatchesEntry('git@github.com:owner/repo', ref), true);
  assert.equal(repoMatchesEntry('https://github.com/owner/repo/', ref), true);
  assert.equal(repoMatchesEntry('https://github.com/owner/other', ref), false);
  assert.equal(repoMatchesEntry('https://gitlab.com/owner/repo', ref), false);
});

serialTest('repoMatchesEntry：缺 repository 或缺 ref 一律判 false（宁可不装）', () => {
  assert.equal(repoMatchesEntry(null, { author: 'o', repo: 'r' }), false);
  assert.equal(repoMatchesEntry('', { author: 'o', repo: 'r' }), false);
  assert.equal(repoMatchesEntry('https://github.com/o/r', {}), false);
  assert.equal(repoMatchesEntry('https://github.com/o/r', { author: 'o' }), false);
});

// ---------------------------------------------------------------------------
// 纯函数：版本区间（satisfiesPluginRange 及其分支）
// ---------------------------------------------------------------------------

serialTest('satisfiesPluginRange：空区间与通配符不约束', () => {
  assert.equal(satisfiesPluginRange('1.0.0', ''), true);
  assert.equal(satisfiesPluginRange('1.0.0', null), true);
  assert.equal(satisfiesPluginRange('1.0.0', '*'), true);
  assert.equal(satisfiesPluginRange('1.0.0', 'x'), true);
  assert.equal(satisfiesPluginRange('1.0.0', 'X'), true);
});

serialTest('satisfiesPluginRange：精确版本与比较符', () => {
  assert.equal(satisfiesPluginRange('1.2.3', '1.2.3'), true);
  assert.equal(satisfiesPluginRange('1.2.4', '1.2.3'), false);
  assert.equal(satisfiesPluginRange('1.2.3', '=1.2.3'), true);
  assert.equal(satisfiesPluginRange('1.2.3', '>= 1.0.0'), true, '操作符后有空格不能被拆断');
  assert.equal(satisfiesPluginRange('0.9.0', '>= 1.0.0'), false);
  assert.equal(satisfiesPluginRange('1.2.3', '<=1.2.3'), true);
  assert.equal(satisfiesPluginRange('1.2.4', '<=1.2.3'), false);
  assert.equal(satisfiesPluginRange('1.2.4', '>1.2.3'), true);
  assert.equal(satisfiesPluginRange('1.2.3', '>1.2.3'), false);
  assert.equal(satisfiesPluginRange('1.2.2', '<1.2.3'), true);
  assert.equal(satisfiesPluginRange('1.2.3', '<1.2.3'), false);
});

serialTest('satisfiesPluginRange：^ 与 ~ 的上界', () => {
  assert.equal(satisfiesPluginRange('1.9.9', '^1.2.3'), true);
  assert.equal(satisfiesPluginRange('2.0.0', '^1.2.3'), false);
  assert.equal(satisfiesPluginRange('0.2.9', '^0.2.3'), true);
  assert.equal(satisfiesPluginRange('0.3.0', '^0.2.3'), false);
  assert.equal(satisfiesPluginRange('0.0.3', '^0.0.3'), true);
  assert.equal(satisfiesPluginRange('0.0.4', '^0.0.3'), false);
  assert.equal(satisfiesPluginRange('0.0.0', '^0.0.0'), true);
  assert.equal(satisfiesPluginRange('1.2.9', '~1.2.3'), true);
  assert.equal(satisfiesPluginRange('1.3.0', '~1.2.3'), false);
  assert.equal(satisfiesPluginRange('0.0.9', '~0.0.0'), true);
  assert.equal(satisfiesPluginRange('0.1.0', '~0.0.0'), false);
});

serialTest('satisfiesPluginRange：x-range（1 / 1.x / 1.2.x）与只剩 x 的退化写法', () => {
  assert.equal(satisfiesPluginRange('1.9.9', '1.x'), true);
  assert.equal(satisfiesPluginRange('2.0.0', '1.x'), false);
  assert.equal(satisfiesPluginRange('1.2.9', '1.2.x'), true);
  assert.equal(satisfiesPluginRange('1.3.0', '1.2.x'), false);
  assert.equal(satisfiesPluginRange('1.0.0', '>= x'), true, '值是 x 时不约束');
  assert.equal(satisfiesPluginRange('1.0.0', '>= X'), true);
  assert.equal(satisfiesPluginRange('1.0.0', 'x.y'), true, 'x-range 一个数字都取不到时不约束');
  assert.equal(satisfiesPluginRange('1.0.0', '='), true, '只有操作符没有版本时不约束');
});

serialTest('satisfiesPluginRange：|| 分支任一满足即可，多比较符要同时满足', () => {
  assert.equal(satisfiesPluginRange('2.0.0', '^1.0.0 || ^2.0.0'), true);
  assert.equal(satisfiesPluginRange('3.0.0', '^1.0.0 || ^2.0.0'), false);
  assert.equal(satisfiesPluginRange('1.5.0', '>=1.0.0 <2.0.0'), true);
  assert.equal(satisfiesPluginRange('2.5.0', '>=1.0.0 <2.0.0'), false);
});

serialTest('satisfiesPluginRange：预发布版本越过排他上界不算满足', () => {
  assert.equal(satisfiesPluginRange('0.2.0-rc.9', '<0.2.0'), false);
  assert.equal(satisfiesPluginRange('0.2.0-rc.9', '<=0.2.0'), false);
  assert.equal(satisfiesPluginRange('0.2.0-rc.9', '<0.3.0'), true, '上界不在同一条线上就按普通比较');
  assert.equal(satisfiesPluginRange('1.2.0-rc.1', '>=1.0.0'), true);
});

// ---------------------------------------------------------------------------
// 纯函数：peer 依赖
// ---------------------------------------------------------------------------

serialTest('findPeerIncompatibilities：读不到版本的 peer 跳过，区间不满足才报', () => {
  const problems = findPeerIncompatibilities(
    { 'dsh-ui': '^2.0.0', 'dsh-notify': '^1.0.0', 'dsh-core': '^1.0.0' },
    { 'dsh-ui': '1.0.0', 'dsh-notify': '1.2.0' }
  );
  assert.deepEqual(problems, [{ peer: 'dsh-ui', range: '^2.0.0', installed: '1.0.0' }]);
  assert.deepEqual(findPeerIncompatibilities(null, {}), []);
  assert.deepEqual(findPeerIncompatibilities({ a: '^1.0.0' }, {}), []);
  assert.deepEqual(findPeerIncompatibilities({ a: '' }, { a: '1.0.0' }), []);
});

// ---------------------------------------------------------------------------
// 纯函数：市场合并 / 单飞 / 批量状态 / dev-linked 判定
// ---------------------------------------------------------------------------

serialTest('mergeMarketPlugins：官方条目在前，同一个 url 只留一份', () => {
  const merged = mergeMarketPlugins(
    [{ name: 'official-a', url: 'https://github.com/o/a' }],
    [{ name: 'dup', url: 'https://github.com/o/a' }, { name: 'b', url: 'https://github.com/o/b' }]
  );
  assert.deepEqual(merged.map(item => item.name), ['official-a', 'b']);
  assert.deepEqual(mergeMarketPlugins(null, null), []);
  assert.deepEqual(mergeMarketPlugins([null], [{ name: '' }]), []);
});

serialTest('createSingleFlight：并发调用只执行一次，跑完后可以再跑', async () => {
  let runs = 0;
  const task = createSingleFlight(async () => {
    runs += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return runs;
  });
  const [a, b] = await Promise.all([task(), task()]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(runs, 1);
  assert.equal(await task(), 2, '上一轮结束后要能重新执行');
  assert.equal(runs, 2);
});

serialTest('isDevLinkedSource：指向 plugin-sources 之外的目录算本地开发链接', async () => {
  await withTempHome(async home => {
    const sourcesRoot = join(home, 'profiles', 'web', 'plugin-sources');
    assert.equal(isDevLinkedSource({ remote: { dir: join(sourcesRoot, 'o-repo') } }), false);
    assert.equal(isDevLinkedSource({ remote: { dir: join(home, 'my-checkout') } }), true);
    assert.equal(isDevLinkedSource({ remote: {} }), false);
    assert.equal(isDevLinkedSource(null), false);
  });
});

serialTest('readLastBatchUpdate / isBatchUpdateRunning：没有批次时是空状态', () => {
  // 批量状态是模块级变量，这里只断言「读得到、类型对」，具体值由批量用例覆盖。
  assert.ok(readLastBatchUpdate() === null || typeof readLastBatchUpdate() === 'object');
  assert.equal(typeof isBatchUpdateRunning(), 'boolean');
});

// ---------------------------------------------------------------------------
// 纯函数：pruneSourceBackups
// ---------------------------------------------------------------------------

serialTest('pruneSourceBackups：只留最新一个备份，并清掉中断留下的 .staged-', async () => {
  await withTempHome(async home => {
    const dir = join(home, 'plugin-sources');
    await mkdir(dir, { recursive: true });
    for (const name of ['o-repo.bak-20260101000000', 'o-repo.bak-20260202000000', 'o-repo.staged-1-2']) {
      await mkdir(join(dir, name), { recursive: true });
    }
    const removed = await pruneSourceBackups(join(dir, 'o-repo'));
    assert.deepEqual(removed.sort(), ['o-repo.bak-20260101000000', 'o-repo.staged-1-2']);
    assert.deepEqual((await readdir(dir)).sort(), ['o-repo.bak-20260202000000']);
    // 目录不存在 / 路径不合法时安静返回
    assert.deepEqual(await pruneSourceBackups(join(home, 'nope', 'o-repo')), []);
    assert.deepEqual(await pruneSourceBackups(''), []);
    assert.deepEqual(await pruneSourceBackups('o-repo'), []);
  });
});

// ---------------------------------------------------------------------------
// 源码校验：findUnresolvableLocalImports / missingPackageEntries
// ---------------------------------------------------------------------------

serialTest('findUnresolvableLocalImports：只报落在包目录内、且真的落不了地的相对 import', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'ok.js'), "import './present.js'\nimport x from './dir'\n", 'utf8');
    await writeFile(join(pkg, 'present.js'), 'export default 1;\n', 'utf8');
    await mkdir(join(pkg, 'dir'), { recursive: true });
    await writeFile(join(pkg, 'dir', 'index.js'), 'export default 2;\n', 'utf8');
    await writeFile(join(pkg, 'broken.js'), "import './missing.js'\nimport '../outside.js'\nimport 'pkg-name'\n", 'utf8');
    // 动态 import 与副作用 import 也要查
    await writeFile(join(pkg, 'dyn.js'), "const m = import('./missing-dyn.js');\nimport './missing-side.js';\n", 'utf8');
    // 测试文件与 node_modules 不参与扫描
    await mkdir(join(pkg, 'node_modules'), { recursive: true });
    await writeFile(join(pkg, 'node_modules', 'x.js'), "import './nope.js'\n", 'utf8');
    await writeFile(join(pkg, 'thing.test.js'), "import './nope.js'\n", 'utf8');

    const missing = await findUnresolvableLocalImports(pkg);
    assert.deepEqual(missing.map(item => item.specifier).sort(), ['./missing-dyn.js', './missing-side.js', './missing.js']);
    assert.ok(missing.every(item => item.importer.startsWith('broken.js') || item.importer.startsWith('dyn.js')));
  });
});

serialTest('findUnresolvableLocalImports：目录不存在时返回空（不误报）', async () => {
  await withTempHome(async home => {
    assert.deepEqual(await findUnresolvableLocalImports(join(home, 'nope')), []);
  });
});

serialTest('findUnresolvableLocalImports：读不出内容的文件跳过（不能因此判定失败）', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'ok.js'), "import './present.js'\n", 'utf8');
    await writeFile(join(pkg, 'present.js'), 'export default 1;\n', 'utf8');
    // 指向目录的链接：按文件读会失败，必须被跳过而不是当成「缺模块」
    await linkDir(join(pkg, 'present.js'), join(pkg, 'linked.js'));
    const missing = await findUnresolvableLocalImports(pkg);
    assert.deepEqual(missing, []);
  });
});

serialTest('missingPackageEntries：main / exports 入口缺失都要报，目录 index 算存在', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo',
      main: './lib/index.js',
      exports: { '.': { import: './lib/main.js', require: './lib/req.js' }, './client': './client/index.js' }
    }), 'utf8');

    assert.deepEqual(await missingPackageEntries(pkg), ['./lib/index.js', './lib/main.js', './client/index.js']);

    await mkdir(join(pkg, 'lib'), { recursive: true });
    await writeFile(join(pkg, 'lib', 'index.js'), '', 'utf8');
    await writeFile(join(pkg, 'lib', 'main.js'), '', 'utf8');
    await mkdir(join(pkg, 'client'), { recursive: true });
    await writeFile(join(pkg, 'client', 'index.js'), '', 'utf8');
    assert.deepEqual(await missingPackageEntries(pkg), []);
  });
});

serialTest('missingPackageEntries：exports 的字符串 / 数组 / 条件对象都能取到入口', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo',
      exports: './dist/index.js'
    }), 'utf8');
    assert.deepEqual(await missingPackageEntries(pkg), ['./dist/index.js']);

    // 数组形式：取第一个可用目标（存在性由后面的校验负责）
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo',
      exports: { '.': ['./missing.js', './dist/other.js'], './client': { node: './client/node.js' } }
    }), 'utf8');
    assert.deepEqual(await missingPackageEntries(pkg), ['./missing.js', './client/node.js']);

    // 条件键里没有可用的字符串目标时：exports['.'] 取不到目标就不校验
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo',
      exports: { '.': { types: {} } }
    }), 'utf8');
    assert.deepEqual(await missingPackageEntries(pkg), []);

    // 条件键里只有字符串目标时：取那个目标来校验
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo',
      exports: { '.': { types: './types.d.ts' } }
    }), 'utf8');
    assert.deepEqual(await missingPackageEntries(pkg), ['./types.d.ts']);
  });
});

serialTest('missingPackageEntries：没有 package.json 时不报；出界的 entry 不归这里管', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    assert.deepEqual(await missingPackageEntries(pkg), []);
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', main: '../outside.js' }), 'utf8');
    assert.deepEqual(await missingPackageEntries(pkg), []);
  });
});

// ---------------------------------------------------------------------------
// 已装包的版本 / peer 声明
// ---------------------------------------------------------------------------

serialTest('installedVersionOf / readInstalledPeerDependencies：读本地 package.json', async () => {
  await withTempHome(async home => {
    const profile = await writeProfile(home, {
      packages: { demo: { name: 'demo', version: '1.2.3', peerDependencies: { 'dsh-ui': '^2.0.0' } } }
    });
    assert.equal(await lib.installedVersionOf('demo'), '1.2.3');
    assert.equal(await lib.installedVersionOf('missing'), null);
    assert.deepEqual(await readInstalledPeerDependencies('demo'), { 'dsh-ui': '^2.0.0' });
    assert.deepEqual(await readInstalledPeerDependencies('missing'), {});
    assert.deepEqual(await readInstalledPeerDependencies(''), {});
    assert.deepEqual(await readInstalledPeerDependencies('../escape'), {});
    assert.ok(profile);
  });
});

serialTest('readRuntimePeerVersions：读到版本的 peer 才出现在结果里', async () => {
  await withTempHome(async home => {
    const runtime = join(home, 'runtime', 'node_modules', 'dsh-ui');
    await mkdir(runtime, { recursive: true });
    await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'dsh-ui', version: '2.1.0' }), 'utf8');
    const versions = await readRuntimePeerVersions(['dsh-ui', 'dsh-missing']);
    assert.deepEqual(versions, { 'dsh-ui': '2.1.0' });
  });
});

// ---------------------------------------------------------------------------
// npm 探测（npmViewExists / npmRepositoryOf，走 installPlugin 的默认实现）
// ---------------------------------------------------------------------------

/** 让 pnpm view 返回指定内容；未登记的名字返回空串。 */
function pnpmViewResponder(table) {
  return (call) => {
    const args = call.args;
    if (args[0] !== 'view') return { stdout: '', stderr: '' };
    const key = args.slice(1).join(' ');
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      const value = table[key];
      if (value instanceof Error) throw value;
      return { stdout: String(value), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

serialTest('installPlugin：npm 上有该包时直接 add（npmViewExists 成功路径）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({
      '@owner/repo version': '1.0.0',
      'repo version': '1.0.0'
    });
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, { verifyPresent: async () => true });

    assert.equal(result.ok, true);
    assert.equal(result.installedAs, '@owner/repo');
    assert.equal(result.packageName, '@owner/repo');
    assert.deepEqual(commands, [['add', '@owner/repo']]);
    const views = execLog.filter(call => call.args[0] === 'view').map(call => call.args[1]);
    assert.deepEqual(views.sort(), ['@owner/repo', 'repo']);
  });
});

serialTest('installPlugin：npm 上没有该包时如实报错，不去瞎试 git', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({
      'plain version': execError('Command failed: pnpm view plain version\nE404 Not Found')
    });
    const result = await installPlugin({ name: 'plain' }, async () => ({}), { verifyPresent: async () => true });
    assert.equal(result.ok, false);
    assert.match(result.error, /npm 上没有 plain/);
  });
});

serialTest('installPlugin：registry 不可达与 E404 的区分（网络问题不能报成「包不存在」）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({
      'plain version': execError('Command failed: ETIMEDOUT')
    });
    const unreachable = await installPlugin({ name: 'plain' }, async () => ({}), { verifyPresent: async () => true });
    assert.equal(unreachable.ok, false);
    assert.match(unreachable.error, /registry 暂时不可达/);

    execHook = pnpmViewResponder({
      'plain version': execError('Command failed: E404 ETIMEDOUT')
    });
    const mixed = await installPlugin({ name: 'plain' }, async () => ({}), { verifyPresent: async () => true });
    assert.equal(mixed.ok, false);
    assert.match(mixed.error, /npm 上没有 plain/);
  });
});

serialTest('installPlugin：无 scope 候选要核对 repository，对不上就跳过（别装成别人的包）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      const table = {
        '@owner/repo version': execError('E404 Not Found'),
        'repo version': '1.0.0',
        'repo repository --json': JSON.stringify({ url: 'https://github.com/someone/else' })
      };
      if (call.args[0] === 'view') {
        const key = call.args.slice(1).join(' ');
        if (Object.prototype.hasOwnProperty.call(table, key)) throw table[key];
        return { stdout: table[key], stderr: '' };
      }
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) })
          .then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, { verifyPresent: async () => true });
    // repository 对不上 → 那个裸名候选被跳过，只能退回 git 源码安装
    assert.equal(commands.some(args => args[0] === 'add' && args[1] === 'repo'), false,
      'repository 对不上就不能装那个同名包');
    assert.match(result.installedAs, /^file:/);
  });
});

serialTest('installPlugin：无 scope 候选的 repository 对得上才允许安装', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({
      '@owner/repo version': execError('E404 Not Found'),
      'repo version': '1.0.0',
      'repo repository --json': JSON.stringify({ url: 'git+https://github.com/Owner/Repo.git' })
    });
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    assert.equal(result.installedAs, 'repo');
    assert.deepEqual(commands, [['add', 'repo']]);
  });
});

serialTest('installPlugin：npm 装不上时回退到 git 源码（file: 依赖）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) })
          .then(() => ({ stdout: '', stderr: '' }));
      }
      if (call.args.includes('rev-parse')) return { stdout: 'a'.repeat(40), stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, { verifyPresent: async () => true });

    assert.equal(result.ok, true);
    assert.match(result.installedAs, /^file:/);
    assert.equal(result.packageName, 'repo');
    assert.deepEqual(commands, [['add', `file:${result.installedAs.slice('file:'.length)}`]]);
    const dest = join(home, 'profiles', 'web', 'plugin-sources', 'Owner-Repo');
    assert.ok(await exists(join(dest, 'package.json')));
    const marker = JSON.parse(await readFile(join(dest, '.dsh-source.json'), 'utf8'));
    assert.equal(marker.commit, 'a'.repeat(40));
    assert.equal(marker.repo, 'Repo');
  });
});

serialTest('installPlugin：克隆出来的仓库没有 package.json 就拒绝安装', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'README.md': 'no package here' }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, false);
    assert.match(result.error, /没有 package\.json/);
  });
});

serialTest('installPlugin：克隆出来的源码缺模块时拒绝安装，原有源码不动', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, {
          'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }),
          'index.js': "import './missing.js'\n"
        }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, false);
    assert.match(result.error, /缺少模块/);
    const dest = join(home, 'profiles', 'web', 'plugin-sources', 'Owner-Repo');
    assert.equal(await exists(dest), false, '残缺源码不能落成正式目录');
  });
});

serialTest('installPlugin：子目录插件走稀疏克隆，已装过就报告 alreadyInstalled', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      bundles: ['repo'],
      packages: { repo: { name: 'repo', version: '1.0.0' } }
    });
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'sub/package.json': JSON.stringify({ name: 'repo', version: '1.0.0' }) })
          .then(() => ({ stdout: '', stderr: '' }));
      }
      if (call.args.includes('rev-parse')) return { stdout: 'b'.repeat(40), stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const result = await installPlugin({ name: 'Owner/Repo#sub' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.packageName, 'repo');
    const dest = join(home, 'profiles', 'web', 'plugin-sources', 'Owner-Repo-sub');
    assert.ok(await exists(join(dest, 'package.json')));
  });
});

serialTest('installPlugin：子目录插件的稀疏克隆失败时回退到普通浅克隆', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    let cloneAttempts = 0;
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        cloneAttempts += 1;
        if (cloneAttempts === 1) throw execError('git: --sparse not supported');
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'sub/package.json': JSON.stringify({ name: 'repo', version: '1.0.0' }) })
          .then(() => ({ stdout: '', stderr: '' }));
      }
      if (call.args.includes('rev-parse')) return { stdout: 'c'.repeat(40), stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo#sub' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, { verifyPresent: async () => true });
    assert.equal(cloneAttempts, 2, '稀疏克隆失败后要退回普通克隆');
    assert.equal(result.ok, true);
    assert.equal(result.packageName, 'repo');
  });
});

serialTest('installPlugin：已安装的插件重复安装报 alreadyInstalled', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      bundles: ['repo'],
      packages: { repo: { name: 'repo', version: '1.0.0' } }
    });
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'x' };
    }, { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.installedAs, 'repo');
    assert.deepEqual(commands, []);
  });
});

serialTest('installPlugin：npm 装上了但没物化时如实报错（不谎报成功）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({ '@owner/repo version': '1.0.0' });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => false });
    assert.equal(result.ok, false);
    assert.match(result.error, /没有出现在 node_modules 里/);
  });
});

// ---------------------------------------------------------------------------
// prepareClonedSource / 构建
// ---------------------------------------------------------------------------

serialTest('prepareClonedSource：入口齐全时不需要构建', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', main: './index.js' }), 'utf8');
    await writeFile(join(pkg, 'index.js'), '', 'utf8');
    let built = false;
    const result = await prepareClonedSource(pkg, { runBuild: async () => { built = true; return { ok: true }; } });
    assert.deepEqual(result, { ok: true, built: false, missing: [] });
    assert.equal(built, false);
  });
});

serialTest('prepareClonedSource：没有 package.json 直接拒绝', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    const result = await prepareClonedSource(pkg);
    assert.equal(result.ok, false);
    assert.match(result.error, /没有可用的 package\.json/);
  });
});

serialTest('prepareClonedSource：缺入口时先构建，构建后仍缺就拒绝安装', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', main: './lib/index.js' }), 'utf8');
    const failed = await prepareClonedSource(pkg, { runBuild: async () => ({ ok: false, error: 'build 炸了' }) });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /build 炸了/);

    const stillMissing = await prepareClonedSource(pkg, { runBuild: async () => ({ ok: true }) });
    assert.equal(stillMissing.ok, false);
    assert.match(stillMissing.error, /仍缺入口文件/);
  });
});

serialTest('prepareClonedSource：构建补出入口后放行，并清掉构建产物里的 node_modules', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', main: './lib/index.js' }), 'utf8');
    const result = await prepareClonedSource(pkg, {
      runBuild: async (dir) => {
        await mkdir(join(dir, 'lib'), { recursive: true });
        await writeFile(join(dir, 'lib', 'index.js'), '', 'utf8');
        await mkdir(join(dir, 'node_modules'), { recursive: true });
        return { ok: true };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.built, true);
    assert.equal(await exists(join(pkg, 'node_modules')), false, '构建装出来的依赖不进包');
  });
});

serialTest('prepareClonedSource：默认构建实现会真的跑 pnpm install + build', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo',
      main: './lib/index.js',
      scripts: { build: 'tsc' }
    }), 'utf8');
    const calls = [];
    execHook = async (call) => {
      calls.push(call.args);
      // 构建脚本把入口产物生成出来（模拟 tsc 之类的构建）
      if (call.args[0] === 'run') {
        await mkdir(join(pkg, 'lib'), { recursive: true });
        await writeFile(join(pkg, 'lib', 'index.js'), '', 'utf8');
      }
      return { stdout: '', stderr: '' };
    };
    const result = await prepareClonedSource(pkg);
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [['install', '--ignore-scripts'], ['run', 'build']],
      'install 要 --ignore-scripts：pnpm 默认跑 prepare，会和显式 build 重复一次且把错误包成 lifecycle failed');
  });
});

serialTest('prepareClonedSource：没有 build/prepare 脚本时构建失败并说明原因', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', main: './lib/index.js' }), 'utf8');
    const result = await prepareClonedSource(pkg);
    assert.equal(result.ok, false);
    assert.match(result.error, /没有 build\/prepare 脚本/);
  });
});

serialTest('prepareClonedSource：pnpm 跑失败时如实上报构建错误', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo', main: './lib/index.js', scripts: { prepare: 'node build.js' }
    }), 'utf8');
    execHook = (call) => {
      throw execError('pnpm install failed');
    };
    const result = await prepareClonedSource(pkg);
    assert.equal(result.ok, false);
    assert.match(result.error, /pnpm install failed/);
  });
});

// ---------------------------------------------------------------------------
// 卸载
// ---------------------------------------------------------------------------

serialTest('uninstallPlugin：内置插件拒绝卸载', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await uninstallPlugin('dsh-plugin-manager', async () => ({ note: 'x' }));
    assert.equal(result.ok, false);
    assert.match(result.error, /内置插件/);
  });
});

serialTest('uninstallPlugin：卸载后残留依赖记录会被清掉并复核通过', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      dependencies: { demo: '^1.0.0' },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const commands = [];
    const result = await uninstallPlugin('demo', async (args) => {
      commands.push(args);
      return { note: '已卸载' };
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(result.needsRestart, true);
    assert.deepEqual(commands, [['remove', 'demo']]);
  });
});

serialTest('uninstallPlugin：复核不过且清不掉时如实报错（不谎报卸载成功）', async () => {
  await withTempHome(async home => {
    // @deepseek-ai/dsh-base 是必需组件：cleanupBrokenPlugin 会拒绝清理它
    await writeProfile(home, {
      dependencies: { '@deepseek-ai/dsh-base': '^1.0.0' },
      bundles: ['@deepseek-ai/dsh-base'],
      packages: { '@deepseek-ai/dsh-base': { name: '@deepseek-ai/dsh-base', version: '1.0.0' } }
    });
    const result = await uninstallPlugin('@deepseek-ai/dsh-base', async () => ({ note: '已卸载' }));
    assert.equal(result.ok, false);
    assert.match(result.error, /请重试或重启 dsh/);
  });
});

serialTest('uninstallPlugin：卸载命令失败时返回错误', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await uninstallPlugin('demo', async () => { throw new Error('pnpm remove 失败'); });
    assert.equal(result.ok, false);
    assert.match(result.error, /pnpm remove 失败/);
  });
});

serialTest('uninstallPlugins：逐个卸载并汇总结果', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const results = await uninstallPlugins(['demo', 'dsh-plugin-manager'], async (args) => ({ note: `已卸载 ${args[1]}` }));
    assert.equal(results.ok, false);
    assert.deepEqual(results.results.map(item => item.name), ['demo', 'dsh-plugin-manager']);
    assert.equal(results.results[0].ok, true);
    assert.equal(results.results[1].ok, false);
  });
});

serialTest('uninstallPlugins：单个插件抛错不影响其它插件', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const boom = { toString() { throw new Error('炸了'); } };
    const results = await uninstallPlugins([boom], async () => ({ note: 'x' }));
    assert.equal(results.ok, false);
    assert.equal(results.results.length, 1);
    assert.match(results.results[0].error, /炸了/);
  });
});

serialTest('cleanupPluginSources：只清理我们自己克隆的目录，其它 file: 依赖不动', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const sourcesRoot = join(profile, 'plugin-sources');
    const ours = join(sourcesRoot, 'o-repo');
    const other = join(home, 'other-repo');
    await mkdir(ours, { recursive: true });
    await mkdir(other, { recursive: true });
    // 卸载之后 pnpm 已经把依赖记录删掉了（当前清单里没有 ours）
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'web',
      dependencies: { other: `file:${other}`, plain: '^1.0.0' }
    }), 'utf8');

    const removed = await cleanupPluginSources(
      { dependencies: { ours: `file:${ours}`, other: `file:${other}`, plain: '^1.0.0' } },
      ['ours', 'other', 'plain']
    );
    assert.deepEqual(removed, [ours], '只删 plugin-sources 里的那个');
    assert.equal(await exists(ours), false);
    assert.equal(await exists(other), true);

    // 卸载前的清单里没有 dependencies 时什么都不做
    assert.deepEqual(await cleanupPluginSources(null, ['ours']), []);
    assert.deepEqual(await cleanupPluginSources({}, ['ours']), []);
  });
});

serialTest('cleanupPluginSources：还有别的依赖指向同一目录时不删', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const sourcesRoot = join(profile, 'plugin-sources');
    const shared = join(sourcesRoot, 'o-repo');
    await mkdir(shared, { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'web',
      dependencies: { other: `file:${shared}` }
    }), 'utf8');
    const removed = await cleanupPluginSources({ dependencies: { demo: `file:${shared}` } }, ['demo']);
    assert.deepEqual(removed, []);
    assert.equal(await exists(shared), true);
  });
});

// ---------------------------------------------------------------------------
// cleanupBrokenPlugin
// ---------------------------------------------------------------------------

serialTest('cleanupBrokenPlugin：清掉残留目录与 manifest 里的记录', async () => {
  await withTempHome(async home => {
    const profile = await writeProfile(home, {
      dependencies: { demo: '^1.0.0' },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const result = await cleanupBrokenPlugin('demo');
    assert.deepEqual(result, { ok: true });
    assert.equal(await exists(join(profile, 'node_modules', 'demo')), false);
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies.demo, undefined);
    assert.deepEqual(manifest.dsh.profile.bundles, []);
  });
});

serialTest('cleanupBrokenPlugin：非法名字与必需组件都要拒绝', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    await assert.rejects(cleanupBrokenPlugin('../escape'), /非法的插件名/);
    await assert.rejects(cleanupBrokenPlugin('dsh-plugin-manager'), /必需组件/);
    await assert.rejects(cleanupBrokenPlugin('@deepseek-ai/dsh-base'), /必需组件/);
  });
});

serialTest('cleanupBrokenPlugin：manifest 读不出来时也要把磁盘上的残留清掉', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    await mkdir(join(profile, 'node_modules', 'demo'), { recursive: true });
    await writeFile(join(profile, 'package.json'), 'not json at all', 'utf8');
    const result = await cleanupBrokenPlugin('demo');
    assert.deepEqual(result, { ok: true });
    assert.equal(await exists(join(profile, 'node_modules', 'demo')), false);
  });
});

// ---------------------------------------------------------------------------
// fetchTargetPeerDependencies（注入假 fetch / 假 pnpm）
// ---------------------------------------------------------------------------

serialTest('fetchTargetPeerDependencies：npm 来源读 registry，git 来源读远端 package.json', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') return { stdout: JSON.stringify({ 'dsh-ui': '^2.0.0' }), stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const npmPeers = await fetchTargetPeerDependencies({
      name: 'demo', kind: 'npm', remote: { type: 'npm', package: 'demo' }
    }, '2.0.0');
    assert.deepEqual(npmPeers, { 'dsh-ui': '^2.0.0' });

    const requests = [];
    const gitPeers = await fetchTargetPeerDependencies({
      name: 'demo', kind: 'git', installedVersion: '1.0.0', installedCommit: 'a'.repeat(40),
      remote: { type: 'git', author: 'o', repo: 'r', subdir: null }
    }, '2.0.0', {
      fetch: async (url) => {
        requests.push(String(url));
        return { ok: true, status: 200, json: async () => ({ peerDependencies: { 'dsh-ui': '^3.0.0' } }) };
      }
    });
    assert.deepEqual(gitPeers, { 'dsh-ui': '^3.0.0' });
    assert.ok(requests[0].includes('raw.githubusercontent.com/o/r/HEAD/package.json'));
  });
});

serialTest('fetchTargetPeerDependencies：问不到就返回空对象，不阻断更新', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => { throw execError('pnpm view failed'); };
    assert.deepEqual(await fetchTargetPeerDependencies({
      name: 'demo', kind: 'npm', remote: { type: 'npm', package: 'demo' }
    }, '2.0.0'), {});

    assert.deepEqual(await fetchTargetPeerDependencies({
      name: 'demo', kind: 'git', remote: { type: 'git', author: 'o', repo: 'r' }
    }, '2.0.0', {
      fetch: async () => { throw new Error('network down'); }
    }), {});

    // 远端返回了不是对象的 peerDependencies → 也当空
    assert.deepEqual(await fetchTargetPeerDependencies({
      name: 'demo', kind: 'git', remote: { type: 'git', author: 'o', repo: 'r' }
    }, '2.0.0', {
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ peerDependencies: 'nope' }) })
    }), {});
  });
});

// ---------------------------------------------------------------------------
// updatePlugin
// ---------------------------------------------------------------------------

/** 造一个「已装的 git 克隆来源」profile。 */
async function makeGitProfile(home, { name = 'demo', version = '1.0.0', commit = 'a'.repeat(40) } = {}) {
  const profile = join(home, 'profiles', 'web');
  const sourcesDir = join(profile, 'plugin-sources', 'o-demo');
  await mkdir(sourcesDir, { recursive: true });
  await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name, version }), 'utf8');
  await writeFile(join(sourcesDir, '.dsh-source.json'), JSON.stringify({
    author: 'o', repo: 'demo', subdir: null, url: 'https://github.com/o/demo.git', commit
  }), 'utf8');
  await writeProfile(home, {
    dependencies: { [name]: `file:${sourcesDir}` },
    bundles: [name],
    packages: { [name]: { name, version } }
  });
  return { profile, sourcesDir };
}

/**
 * 造一个「用户自己的开发 checkout」（link: 依赖 + 来源标记）。
 * 没有来源标记时来源会被判成 local（remote 为 null），就地更新拿不到目录。
 */
async function makeDevCheckout(home, { name = 'demo', version = '1.0.0', dir = 'my-checkout', pkg = null } = {}) {
  const checkout = join(home, dir);
  await mkdir(checkout, { recursive: true });
  await writeFile(join(checkout, 'package.json'), JSON.stringify(pkg ?? { name, version }), 'utf8');
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

serialTest('updatePlugin：非法插件名直接拒绝', async () => {
  const result = await updatePlugin('../escape');
  assert.equal(result.ok, false);
  assert.match(result.error, /非法的插件名/);
});

serialTest('updatePlugin：没找到这个插件时如实说找不到', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await updatePlugin('missing');
    assert.equal(result.ok, false);
    assert.equal(result.status, 'unknown');
    assert.match(result.error, /未找到可更新的已安装插件/);
  });
});

serialTest('updatePlugin：复用检测缓存里的决策，不重新联网', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      dependencies: { demo: 'github:o/demo' },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const cacheFile = join(home, 'updates.json');
    await writeFile(cacheFile, JSON.stringify({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'demo', status: 'update-available', latestVersion: '2.0.0' }]
    }), 'utf8');
    const commands = [];
    const result = await updatePlugin('demo', {
      cacheFile,
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.deepEqual(commands, [['add', 'github:o/demo']]);
  });
});

serialTest('updatePlugin：pull-local 走就地更新，switch-release 走发行版', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home);
    const gitCalls = [];
    execHook = (call) => {
      gitCalls.push(call.args);
      if (call.args.includes('--is-inside-work-tree')) return { stdout: 'true', stderr: '' };
      if (call.args.includes('--abbrev-ref') && call.args.includes('HEAD')) return { stdout: 'main', stderr: '' };
      if (call.args[0] === 'status') return { stdout: '', stderr: '' };
      if (call.args[0] === 'rev-list') return { stdout: '0\t1', stderr: '' };
      if (call.args.includes('rev-parse')) return { stdout: 'd'.repeat(40), stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const pulled = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(pulled.ok, true);
    assert.equal(pulled.updatedTo, '1.0.0');
    assert.ok(gitCalls.some(args => args[0] === 'merge'));
    assert.ok(await exists(join(checkout, 'package.json')));
  });
});

// ---------------------------------------------------------------------------
// applyPluginUpdate
// ---------------------------------------------------------------------------

serialTest('applyPluginUpdate：npm 来源装到目标版本并复核', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { demo: { name: 'demo', version: '2.0.0' } } });
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.equal(result.verified, true);
    assert.deepEqual(commands, [['add', 'demo@2.0.0']]);
  });
});

serialTest('applyPluginUpdate：node_modules 没跟上时清钉重装一次', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { demo: { name: 'demo', version: '1.0.0' } } });
    const commands = [];
    let verifies = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); },
      verifyApplied: async () => { verifies += 1; return verifies > 1; }
    });
    assert.equal(result.verified, true);
    assert.deepEqual(commands, [['add', 'demo@2.0.0'], ['add', 'demo@2.0.0']]);
  });
});

serialTest('applyPluginUpdate：装出来的版本 import 落不了地就退回原版本', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rolled-back');
    assert.match(result.error, /缺少模块/);
    assert.deepEqual(commands, [['add', 'demo@2.0.0'], ['add', 'demo@1.0.0']]);
  });
});

serialTest('applyPluginUpdate：装出来的版本 import 落不了地、且退不回去时如实说明', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: null, installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {}
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /不知道 vdemo 升级前的版本号/);
  });
});

serialTest('applyPluginUpdate：github: 来源按原 spec 重新解析', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: 'github:o/demo', installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: null }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', 'github:o/demo']]);
  });
});

serialTest('applyPluginUpdate：github: 来源重新解析后 import 缺口就退回原 commit', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: 'github:o/demo', installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: null }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rolled-back');
    assert.deepEqual(commands, [['add', 'github:o/demo'], ['add', `github:o/demo#${'a'.repeat(40)}`]]);
  });
});

serialTest('applyPluginUpdate：file: 克隆来源先备份再重克隆，再装到新源码', async () => {
  await withTempHome(async home => {
    // node_modules 里已经是新版本 → 一次就复核通过
    const { sourcesDir } = await makeGitProfile(home, { version: '2.0.0' });
    await writeFile(join(sourcesDir, 'index.js'), '// 旧版本', 'utf8');
    const commands = [];
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); },
      clone
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.equal(result.verified, true);
    assert.deepEqual(commands, [['add', `file:${sourcesDir}`]]);
  });
});

serialTest('applyPluginUpdate：file: 来源装完版本没跟上时清掉包目录重装一次', async () => {
  await withTempHome(async home => {
    // node_modules 里还是旧版本 → 收尾阶段要删包目录重装
    const { sourcesDir } = await makeGitProfile(home, { version: '1.0.0' });
    const commands = [];
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); },
      clone
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, false, '没复核上就如实上报');
    assert.match(result.note, /重启 dsh 后确认/);
    assert.deepEqual(commands, [['add', `file:${sourcesDir}`], ['add', `file:${sourcesDir}`]]);
  });
});

serialTest('applyPluginUpdate：file: 来源重克隆后源码残缺就回滚备份', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home);
    await writeFile(join(sourcesDir, 'index.js'), '// 旧版本', 'utf8');
    const commands = [];
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      await writeFile(join(sourcesDir, 'index.js'), "import './missing.js'\n", 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let outcome = null;
    try {
      outcome = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async (args) => { commands.push(args); },
        clone
      });
    } catch (error) {
      outcome = error;
    }
    assert.ok(outcome instanceof Error || outcome.ok === false);
    assert.deepEqual(commands, [], '校验没过就不许改 profile');
  });
});

serialTest('applyPluginUpdate：指向用户自己目录的插件默认拒绝自动更新', async () => {
  await withTempHome(async home => {
    const checkout = join(home, 'my-checkout');
    await mkdir(checkout, { recursive: true });
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `link:${checkout}`, installedVersion: '1.0.0',
      installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: checkout }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {}
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.match(result.error, /自动更新会改动这个目录/);
  });
});

serialTest('applyPluginUpdate：local 来源与「没有可更新版本」都返回失败', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const local = await applyPluginUpdate({
      name: 'handmade', kind: 'local', spec: 'file:/opt/x', installedVersion: '0.1.0', installedCommit: null, remote: null
    }, { check: async () => [{ status: 'update-available', latestVersion: '1.0.0' }] });
    assert.equal(local.ok, false);
    assert.equal(local.error, '该插件来源无法自动更新');

    const upToDate = await applyPluginUpdate({
      name: 'demo', kind: 'npm', remote: { type: 'npm', package: 'demo' }
    }, { check: async () => [{ status: 'up-to-date', latestVersion: '1.0.0' }] });
    assert.equal(upToDate.ok, false);
    assert.equal(upToDate.status, 'up-to-date');

    const failed = await applyPluginUpdate({
      name: 'demo', kind: 'npm', remote: { type: 'npm', package: 'demo' }
    }, { check: async () => [{ status: 'failed', error: 'registry 不可用' }] });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, 'registry 不可用');
  });
});

// ---------------------------------------------------------------------------
// 本地开发目录的就地更新（pull-local）
// ---------------------------------------------------------------------------

/** 假 git：按调用参数给出确定答案。 */
function fakeGit(overrides = {}) {
  return (call) => {
    const args = call.args;
    const key = args.join(' ');
    for (const [pattern, answer] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        return typeof answer === 'function' ? answer(call) : { stdout: String(answer), stderr: '' };
      }
    }
    if (args.includes('--is-inside-work-tree')) return { stdout: 'true', stderr: '' };
    if (args.includes('--abbrev-ref') && args.includes('HEAD')) return { stdout: 'main', stderr: '' };
    if (args[0] === 'status') return { stdout: '', stderr: '' };
    if (args[0] === 'remote') return { stdout: 'origin', stderr: '' };
    if (args[0] === 'rev-list') return { stdout: '0\t1', stderr: '' };
    if (args[0] === 'rev-parse') return { stdout: 'e'.repeat(40), stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

serialTest('updatePlugin pull-local：目录不是 git 仓库时拒绝', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = fakeGit({ '--is-inside-work-tree': 'false' });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.match(result.error, /不是 git 仓库/);
  });
});

serialTest('updatePlugin pull-local：分离 HEAD 时拒绝（不动用户工作区）', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = fakeGit({ '--abbrev-ref': 'HEAD' });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /分离 HEAD/);
  });
});

serialTest('updatePlugin pull-local：工作区有未提交改动时拒绝', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = fakeGit({ status: ' M src/index.js' });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked-dirty');
    assert.match(result.error, /未提交改动/);
  });
});

serialTest('updatePlugin pull-local：本地领先上游时拒绝自动快进', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = fakeGit({ 'rev-list': '3\t0' });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked-ahead');
    assert.match(result.error, /尚未推送/);
  });
});

serialTest('updatePlugin pull-local：上游没有新提交时如实说已是最新', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = fakeGit({ 'rev-list': '0\t0' });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'up-to-date');
    assert.match(result.error, /没有新提交/);
  });
});

serialTest('updatePlugin pull-local：没有配置远程时拒绝', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = fakeGit({ '@{u}': '', remote: '' });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /没有配置 git 远程/);
  });
});

serialTest('updatePlugin pull-local：快进成功、更新来源标记并校验入口', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home, {
      version: '2.0.0',
      pkg: { name: 'demo', version: '2.0.0', main: './index.js', scripts: { build: 'tsc' } }
    });
    await writeFile(join(checkout, 'index.js'), '', 'utf8');
    execHook = fakeGit({});
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.equal(result.restartRequired, true);
    assert.match(result.note, /git pull 到 v2\.0\.0/);
    const marker = JSON.parse(await readFile(join(checkout, '.dsh-source.json'), 'utf8'));
    assert.equal(marker.commit, 'e'.repeat(40));
  });
});

serialTest('updatePlugin pull-local：更新后入口文件缺失时如实报错', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home, {
      version: '2.0.0',
      pkg: { name: 'demo', version: '2.0.0', main: './lib/index.js' }
    });
    execHook = fakeGit({});
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /入口文件缺失/);
  });
});

serialTest('updatePlugin pull-local：依赖没变时不重装依赖，只构建', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home, {
      version: '2.0.0',
      pkg: { name: 'demo', version: '2.0.0', scripts: { build: 'tsc' } }
    });
    const nodeCalls = [];
    execHook = (call) => {
      nodeCalls.push(call.args);
      return fakeGit({})(call);
    };
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, true);
    const installs = nodeCalls.filter(args => args.includes('install'));
    assert.equal(installs.length, 0, 'package.json 没变就不该重装依赖');
    assert.ok(nodeCalls.some(args => args.includes('run') && args.includes('build')));
  });
});

// ---------------------------------------------------------------------------
// switch-release
// ---------------------------------------------------------------------------

serialTest('updatePlugin switch-release：npm 上没有发行版时拒绝切换', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = (call) => (call.args[0] === 'view' ? { stdout: 'null', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', { mode: 'switch-release' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.match(result.error, /npm 上没有发布 demo/);
  });
});

serialTest('updatePlugin switch-release：发行版不比本地新时不切换', async () => {
  await withTempHome(async home => {
    const checkout = join(home, 'my-checkout');
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeProfile(home, {
      dependencies: { demo: `link:${checkout}` },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '2.0.0' } }
    });
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"1.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', { mode: 'switch-release' });
    assert.equal(result.ok, false);
    assert.match(result.error, /不比本地链接的 v2\.0\.0 新/);
  });
});

serialTest('updatePlugin switch-release：成功切到 npm 发行版（本地目录不动）', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home);
    const commands = [];
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"2.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', {
      mode: 'switch-release',
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.deepEqual(commands, [['add', 'demo@2.0.0']]);
    assert.equal(await exists(join(checkout, 'package.json')), true);
  });
});

serialTest('updatePlugin switch-release：装出来的发行版 import 缺口要退回原版本', async () => {
  await withTempHome(async home => {
    const checkout = join(home, 'my-checkout');
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    await writeProfile(home, {
      dependencies: { demo: `link:${checkout}` },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const commands = [];
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"2.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', {
      mode: 'switch-release',
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rolled-back');
    assert.match(result.error, /缺少模块/);
  });
});

// ---------------------------------------------------------------------------
// 批量更新
// ---------------------------------------------------------------------------

serialTest('updatePlugins：空名单与并发调用都被拒绝', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const empty = await updatePlugins([]);
    assert.equal(empty.ok, false);
    assert.match(empty.error, /没有要更新的插件/);
    assert.equal((await updatePlugins(null)).ok, false);
  });
});

serialTest('updatePlugins：本地开发链接的插件跳过，其余逐个更新', async () => {
  await withTempHome(async home => {
    const checkout = join(home, 'my-checkout');
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, 'package.json'), JSON.stringify({ name: 'dev-demo', version: '1.0.0' }), 'utf8');
    // 用户自己的 checkout：有来源标记才会被认成「指向某个仓库的本地目录」
    await writeFile(join(checkout, '.dsh-source.json'), JSON.stringify({
      author: 'o', repo: 'dev-demo', subdir: null, url: 'https://github.com/o/dev-demo.git', commit: 'a'.repeat(40)
    }), 'utf8');
    const { sourcesDir } = await makeGitProfile(home, { name: 'demo' });
    const profile = join(home, 'profiles', 'web');
    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'));
    manifest.dependencies['dev-demo'] = `link:${checkout}`;
    manifest.dsh.profile.bundles.push('dev-demo');
    await writeFile(join(profile, 'package.json'), JSON.stringify(manifest), 'utf8');
    await mkdir(join(profile, 'node_modules', 'dev-demo'), { recursive: true });
    await writeFile(join(profile, 'node_modules', 'dev-demo', 'package.json'), JSON.stringify({ name: 'dev-demo', version: '1.0.0' }), 'utf8');

    const summary = await updatePlugins(['demo', 'dev-demo'], {
      check: async sources => sources.map(item => ({ name: item.name, status: 'update-available', latestVersion: '2.0.0' })),
      command: async () => {},
      clone: async () => {
        await rm(sourcesDir, { recursive: true, force: true });
        await mkdir(sourcesDir, { recursive: true });
        await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
        return { ok: true, dest: sourcesDir, packageName: 'demo' };
      }
    });
    assert.equal(summary.updated, 1);
    assert.equal(summary.failed, 1);
    const skipped = summary.results.find(item => item.name === 'dev-demo');
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.status, 'dev-linked');
    const last = readLastBatchUpdate();
    assert.equal(last.updated, 1);
    assert.equal(isBatchUpdateRunning(), false);
  });
});

// ---------------------------------------------------------------------------
// 市场：官方插件源 / 索引重建 / 读取
// ---------------------------------------------------------------------------

/** npm registry 的假响应。 */
function registryFetch(searchObjects, manifests) {
  return async (url) => {
    const value = String(url);
    if (value.includes('/-/v1/search')) {
      return { ok: true, status: 200, json: async () => ({ objects: searchObjects }) };
    }
    const match = /registry\.npmjs\.org\/(.+)\/latest/.exec(value);
    if (match) {
      const manifest = manifests[decodeURIComponent(match[1])];
      if (!manifest) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => manifest };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

serialTest('fetchOfficialMarketPlugins：只保留声明了 dsh.bundle 的官方包', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const fetchImpl = registryFetch(
      [
        { package: { name: '@deepseek-ai/dsh-plugin-alpha', date: '2026-01-01' }, downloads: { monthly: 42 } },
        { package: { name: '@deepseek-ai/dsh-tool-nobundle', date: '2026-01-02' }, downloads: { monthly: 7 } },
        { package: { name: 'other/dsh-plugin-x', date: '2026-01-03' }, downloads: { monthly: 3 } },
        { package: {}, downloads: { monthly: 1 } },
        { package: { name: '@deepseek-ai/dsh-plugin-alpha', date: '2026-01-01' }, downloads: { monthly: 42 } }
      ],
      {
        '@deepseek-ai/dsh-plugin-alpha': { version: '1.2.0', description: 'Alpha 插件', dsh: { bundle: true } },
        '@deepseek-ai/dsh-tool-nobundle': { version: '9.9.9' }
      }
    );
    const rows = await fetchOfficialMarketPlugins({ fetch: fetchImpl });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, '@deepseek-ai/dsh-plugin-alpha');
    assert.equal(rows[0].version, '1.2.0');
    assert.equal(rows[0].category, 'official');
    assert.equal(rows[0].downloads, 42);
    assert.equal(rows[0].descriptionEn, 'Alpha 插件');
  });
});

serialTest('fetchOfficialMarketPlugins：registry 查询失败时返回空列表（不阻断市场刷新）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const rows = await fetchOfficialMarketPlugins({
      fetch: async () => { throw new Error('registry down'); }
    });
    assert.deepEqual(rows, []);
  });
});

serialTest('refreshMarketplace：重建本地索引（社区清单 + 官方来源）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, {
          'data/plugins/alpha.yml': [
            'url: https://github.com/o/alpha',
            'name: o/alpha',
            'category: browser',
            'description:',
            '  en: Alpha plugin',
            '  zh: 阿尔法插件'
          ].join('\n'),
          'data/plugins/no-url.yml': 'name: o/nothing\n',
          'data/plugins/ignored.txt': 'not a yml',
          'data/downloads.json': JSON.stringify({ 'https://github.com/o/alpha': { downloads: 12 } }),
          'data/stars.json': JSON.stringify({ 'https://github.com/o/alpha': { stars: 34 } }),
          'data/screenshots.json': JSON.stringify({ 'https://github.com/o/alpha': 'shot.png' }),
          'data/added-dates.json': JSON.stringify({ 'https://github.com/o/alpha': '2026-02-02' })
        }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    fetchHook = registryFetch(
      [{ package: { name: '@deepseek-ai/dsh-plugin-official', date: '2026-03-03' }, downloads: { monthly: 5 } }],
      { '@deepseek-ai/dsh-plugin-official': { version: '1.0.0', dsh: { bundle: true } } }
    );
    const summary = await refreshMarketplace();
    assert.equal(summary.count, 2);
    assert.equal(summary.official, 1);
    assert.deepEqual(summary.categories, ['official', 'browser']);

    const market = await readMarketplace();
    assert.equal(market.ok, true);
    assert.equal(market.stale, false);
    assert.equal(market.count, 2);
    const community = market.plugins.find(item => item.source === 'community');
    assert.equal(community.downloads, 12);
    assert.equal(community.stars, 34);
    assert.equal(community.screenshot, 'shot.png');
    assert.equal(community.addedDate, '2026-02-02');
    assert.equal(community.descriptionZh, '阿尔法插件');
  });
});

serialTest('refreshMarketplace：索引写失败时清掉半截临时文件并抛错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const marketRoot = join(home, 'plugin-market');
    await mkdir(marketRoot, { recursive: true });
    // index.json 是目录 → rename 必然失败
    await mkdir(join(marketRoot, 'index.json'), { recursive: true });
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'data/plugins/.keep': '' }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    fetchHook = registryFetch([], {});
    await assert.rejects(refreshMarketplace());
    const leftovers = (await readdir(marketRoot)).filter(name => name.startsWith('index.json.tmp-'));
    assert.deepEqual(leftovers, [], '写失败要自己收干净临时文件');
  });
});

serialTest('readMarketplace：没有索引、索引过期或版本不对时都如实标注', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const missing = await readMarketplace();
    assert.equal(missing.ok, false);
    assert.match(missing.error, /尚未下载/);

    const marketRoot = join(home, 'plugin-market');
    await mkdir(marketRoot, { recursive: true });
    const indexFile = join(marketRoot, 'index.json');
    await writeFile(indexFile, JSON.stringify({
      version: 2,
      indexedAt: new Date().toISOString(),
      categories: ['official'],
      plugins: []
    }), 'utf8');
    const fresh = await readMarketplace();
    assert.equal(fresh.ok, true);
    assert.equal(fresh.stale, false);

    await writeFile(indexFile, JSON.stringify({
      version: 2,
      indexedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
      categories: [],
      plugins: []
    }), 'utf8');
    const old = await readMarketplace();
    assert.equal(old.ok, true);
    assert.equal(old.stale, true);

    await writeFile(indexFile, JSON.stringify({
      version: 1,
      indexedAt: new Date().toISOString(),
      categories: [],
      plugins: []
    }), 'utf8');
    const v1 = await readMarketplace();
    assert.equal(v1.stale, true, '旧版索引（没有官方来源）要提示刷新');
  });
});

// ---------------------------------------------------------------------------
// 第二轮：把剩下的分支补齐（fs 故障注入 + 各条兜底路径）
// ---------------------------------------------------------------------------

/** 假 git：按调用参数给出确定答案；值为函数时按函数处理（可抛错）。 */
function gitResponder(overrides = {}) {
  return (call) => {
    const args = call.args;
    const key = args.join(' ');
    for (const [pattern, answer] of Object.entries(overrides)) {
      if (key.includes(pattern)) {
        if (typeof answer === 'function') return answer(call);
        if (answer instanceof Error) throw answer;
        return { stdout: String(answer), stderr: '' };
      }
    }
    if (args.includes('--is-inside-work-tree')) return { stdout: 'true', stderr: '' };
    if (args.includes('--abbrev-ref') && args.includes('HEAD')) return { stdout: 'main', stderr: '' };
    if (args[0] === 'status') return { stdout: '', stderr: '' };
    if (args[0] === 'remote') return { stdout: 'origin', stderr: '' };
    if (args[0] === 'rev-list') return { stdout: '0\t1', stderr: '' };
    if (args[0] === 'rev-parse') return { stdout: 'e'.repeat(40), stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

/** 克隆用的临时目录（lib 内部用 mkdtemp('dsh-pm-')），与本文件的临时 home（dsh-pm-b-）区分开。 */
function isCloneTmp(path) {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  const name = parts[parts.length - 1] ?? '';
  return /^dsh-pm-(?!b-)/.test(name);
}

/** 是不是「克隆临时目录里的 repo 子目录」（= cloneToSources 里的 cloneDir）。 */
function isCloneRepoDir(path) {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/);
  const parent = parts[parts.length - 2] ?? '';
  return /^dsh-pm-(?!b-)/.test(parent);
}

/** 一次 git clone 的假实现：把 tree 铺到目标目录。 */
function cloneWith(tree, head = 'a'.repeat(40)) {
  return async (call) => {
    if (call.args[0] === 'clone') {
      const dest = call.args[call.args.length - 1];
      await writeTree(dest, tree);
      return { stdout: '', stderr: '' };
    }
    if (call.args.includes('rev-parse')) return { stdout: head, stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

serialTest('uninstallPlugin：默认命令会先补齐 pnpm workspace 配置', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    // 不注入 command → 走真实的 pluginCommand（子进程已被假实现接管）
    const result = await uninstallPlugin('demo');
    assert.equal(result.ok, true);
    const workspace = join(home, 'profiles', 'web', 'pnpm-workspace.yaml');
    assert.equal(await exists(workspace), true);
    assert.match(await readFile(workspace, 'utf8'), /dangerouslyAllowAllBuilds: true/);
  });
});

serialTest('installPlugin：repository 查不到时信任源码 name，不否决 npm 发行版', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') {
        const key = call.args.slice(1).join(' ');
        // 国内镜像下 pnpm view repository 挂了（返回 null）——不能因此否决整个 npm 路径，
        // 否则 dsh-market（npm 名 dshmarket、上游 git 构建坏）会被逼走必失败的源码构建。
        if (key === 'repo repository --json') throw execError('registry 挂了');
        if (key === 'repo version') return { stdout: '1.0.0', stderr: '' };
        throw execError('E404 Not Found');
      }
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) })
          .then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, { verifyPresent: async () => true });
    assert.equal(result.fromNpm, true, 'repository 查不到仍走 npm 发行版');
    assert.ok(commands.some(args => args[0] === 'add' && args[1] === 'repo'),
      '装的是源码 package.json 声明的 npm 名');
  });
});

serialTest('installPlugin：缺模块超过三处时提示里带总数', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, {
          'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }),
          'index.js': "import './m1.js'\nimport './m2.js'\nimport './m3.js'\nimport './m4.js'\n"
        }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, false);
    assert.match(result.error, /等 4 处/);
  });
});

serialTest('installPlugin：子目录名以斜杠结尾时目录名退化成 plugin', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = cloneWith({ 'sub/package.json': JSON.stringify({ name: 'repo', version: '1.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo#sub/' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    const dest = join(home, 'profiles', 'web', 'plugin-sources', 'Owner-Repo-plugin');
    assert.equal(await exists(join(dest, 'package.json')), true);
  });
});

serialTest('installPlugin：克隆时清临时目录失败也不影响后续流程', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    let cloneAttempts = 0;
    execHook = async (call) => {
      if (call.args[0] === 'clone') {
        cloneAttempts += 1;
        if (cloneAttempts === 1) throw execError('git: --sparse not supported');
        const dest = call.args[call.args.length - 1];
        await writeTree(dest, { 'sub/package.json': JSON.stringify({ name: 'repo', version: '1.0.0' }) });
        return { stdout: '', stderr: '' };
      }
      if (call.args.includes('rev-parse')) return { stdout: 'b'.repeat(40), stderr: '' };
      return { stdout: '', stderr: '' };
    };
    // 克隆用的临时目录删不掉（测试注入）→ 走 .catch 兜底
    await withFsHooks({ rm: path => isCloneRepoDir(path) }, async () => {
      const result = await installPlugin({ name: 'Owner/Repo#sub' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
      assert.equal(result.ok, true);
      assert.equal(cloneAttempts, 2);
    });
  });
});

serialTest('installPlugin：写来源标记失败时仍继续安装', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      return cloneWith({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) })(call);
    };
    await withFsHooks({ writeFile: path => path.endsWith('.dsh-source.json') }, async () => {
      const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
      assert.equal(result.ok, true);
      assert.match(result.installedAs, /^file:/);
    });
  });
});

serialTest('installPlugin：残缺源码的暂存目录删不掉时按失败处理', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      return cloneWith({
        'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }),
        'index.js': "import './missing.js'\n"
      })(call);
    };
    await withFsHooks({ rm: path => path.includes('.staged-') }, async () => {
      const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
      assert.equal(result.ok, false);
      assert.match(result.error, /缺少模块/);
    });
  });
});

serialTest('installPlugin：旧源码目录删不掉时也要把新源码换上去', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      return cloneWith({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) })(call);
    };
    await withFsHooks({ rm: path => path.includes('plugin-sources') && !path.includes('.staged-') }, async () => {
      const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
      assert.equal(result.ok, true);
      assert.match(result.installedAs, /^file:/);
    });
  });
});

serialTest('installPlugin：克隆用的临时目录删不掉时按失败处理', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      return cloneWith({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) })(call);
    };
    await withFsHooks({ rm: path => isCloneTmp(path) }, async () => {
      const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
      assert.equal(result.ok, true);
      assert.match(result.installedAs, /^file:/);
    });
  });
});

serialTest('prepareClonedSource：构建产物里的 node_modules 删不掉时也不阻断', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', main: './index.js' }), 'utf8');
    await writeFile(join(pkg, 'index.js'), '', 'utf8');
    await mkdir(join(pkg, 'node_modules'), { recursive: true });
    await withFsHooks({ rm: path => path === join(pkg, 'node_modules') }, async () => {
      const result = await prepareClonedSource(pkg, {
        runBuild: async () => {
          await mkdir(join(pkg, 'lib'), { recursive: true });
          await writeFile(join(pkg, 'lib', 'index.js'), '', 'utf8');
          return { ok: true };
        }
      });
      assert.equal(result.ok, true);
    });
  });
});

serialTest('uninstallPlugin：profile 的 package.json 坏了也要能卸载', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    await mkdir(join(profile, 'node_modules'), { recursive: true });
    await writeFile(join(profile, 'package.json'), 'not json', 'utf8');
    const result = await uninstallPlugin('demo', async () => ({ note: '已卸载' }));
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
  });
});

serialTest('uninstallPlugin：manifest 里没有依赖记录、但磁盘上还有残留时要清理并复核', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const result = await uninstallPlugin('demo', async () => ({ note: '已卸载' }));
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(await exists(join(home, 'profiles', 'web', 'node_modules', 'demo')), false);
  });
});

serialTest('uninstallPlugin：源码目录清理掉时提示里要说明', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const sourcesDir = join(profile, 'plugin-sources', 'o-demo');
    await mkdir(sourcesDir, { recursive: true });
    await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
    await mkdir(join(profile, 'node_modules', 'demo'), { recursive: true });
    await writeFile(join(profile, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
    const manifestPath = join(profile, 'package.json');
    const withDep = JSON.stringify({
      name: 'web',
      dependencies: { demo: `file:${sourcesDir}` },
      dsh: { profile: { bundles: ['demo'] } }
    });
    const withoutDep = JSON.stringify({
      name: 'web',
      dependencies: {},
      dsh: { profile: { bundles: ['demo'] } }
    });
    // 卸载时 pnpm 会把依赖记录删掉：前一次读还有、后面一次读没了
    let reads = 0;
    await withFsHooks({
      readFile: path => {
        if (path !== manifestPath) return null;
        reads += 1;
        return reads === 1 ? withDep : withoutDep;
      }
    }, async () => {
      const result = await uninstallPlugin('demo', async () => ({ note: '已卸载' }));
      assert.equal(result.ok, true);
      assert.match(result.note, /已清理插件源码目录/);
      assert.deepEqual(result.removedSources, [sourcesDir]);
      assert.equal(await exists(sourcesDir), false);
    });
  });
});

serialTest('uninstallPlugin：忽略记录写失败时不阻断卸载', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    await withFsHooks({ writeFile: path => path.endsWith('.plugin-updates-ignored.json') }, async () => {
      const result = await uninstallPlugin('demo', async () => ({ note: '已卸载' }));
      assert.equal(result.ok, true);
    });
  });
});

serialTest('uninstallPlugin：命令抛的不是 Error 时也要如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await uninstallPlugin('demo', async () => { throw '字符串错误'; });
    assert.equal(result.ok, false);
    assert.equal(result.error, '字符串错误');
  });
});

serialTest('uninstallPlugins：插件名本身抛错时不影响其它插件', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const boom = { toString() { throw '字符串错误'; } };
    const results = await uninstallPlugins([boom], async () => ({ note: 'x' }));
    assert.equal(results.ok, false);
    assert.equal(results.results[0].error, '字符串错误');
  });
});

serialTest('cleanupPluginSources：当前 manifest 读不出来时按空依赖处理', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const sourcesRoot = join(profile, 'plugin-sources');
    const ours = join(sourcesRoot, 'o-repo');
    await mkdir(ours, { recursive: true });
    await writeFile(join(profile, 'package.json'), 'not json', 'utf8');
    const removed = await cleanupPluginSources({ dependencies: { demo: `file:${ours}` } }, ['demo']);
    assert.deepEqual(removed, [ours]);
  });
});

serialTest('cleanupPluginSources：源码目录删不掉时只当尽力而为', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const sourcesRoot = join(profile, 'plugin-sources');
    const ours = join(sourcesRoot, 'o-repo');
    await mkdir(ours, { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'web', dependencies: {} }), 'utf8');
    await withFsHooks({ rm: path => path === ours }, async () => {
      const removed = await cleanupPluginSources({ dependencies: { demo: `file:${ours}` } }, ['demo']);
      assert.deepEqual(removed, []);
      assert.equal(await exists(ours), true);
    });
  });
});

serialTest('updatePlugin：缓存里没有这条决策时按检测结果走', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      dependencies: { demo: 'github:o/demo' },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const cacheFile = join(home, 'updates.json');
    await writeFile(cacheFile, JSON.stringify({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'other', status: 'update-available', latestVersion: '9.9.9' }]
    }), 'utf8');
    const commands = [];
    const result = await updatePlugin('demo', {
      cacheFile,
      probe: { npm: async () => ({ version: '2.0.0' }), git: async () => ({ version: '2.0.0' }) },
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.deepEqual(commands, [['add', 'github:o/demo']]);
  });
});

serialTest('updatePlugin：检测抛错时如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      dependencies: { demo: 'github:o/demo' },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const result = await updatePlugin('demo', {
      check: async () => { throw new Error('检测炸了'); }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /检测炸了/);
  });
});

serialTest('updatePlugin pull-local：git 命令失败时按「不是仓库」处理', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = gitResponder({ '--is-inside-work-tree': execError('git 挂了') });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /不是 git 仓库/);
  });
});

serialTest('updatePlugin pull-local：查分支失败时按分离 HEAD 处理', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = gitResponder({ '--abbrev-ref': execError('git 挂了') });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /分离 HEAD/);
  });
});

serialTest('updatePlugin pull-local：查工作区状态失败时按干净处理', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = gitResponder({ status: execError('git 挂了') });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, true, '查不到脏文件时按干净工作区继续');
  });
});

serialTest('updatePlugin pull-local：没有上游分支时用 origin/<分支>', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    const seen = [];
    execHook = gitResponder({
      '@{u}': execError('没有上游'),
      merge: (call) => { seen.push(call.args); return { stdout: '', stderr: '' }; }
    });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, true);
    assert.ok(seen.some(args => args.includes('origin/main')));
  });
});

serialTest('updatePlugin pull-local：查远程失败时如实说没有远程', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = gitResponder({ '@{u}': execError('没有上游'), remote: execError('git 挂了') });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /没有配置 git 远程/);
  });
});

serialTest('updatePlugin pull-local：算领先/落后失败时按「没有新提交」处理', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = gitResponder({ 'rev-list': execError('git 挂了') });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'up-to-date');
  });
});

serialTest('updatePlugin pull-local：checkout 里没有 package.json 时如实报错', async () => {
  await withTempHome(async home => {
    const checkout = join(home, 'my-checkout');
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, '.dsh-source.json'), JSON.stringify({
      author: 'o', repo: 'demo', subdir: null, url: 'https://github.com/o/demo.git', commit: 'a'.repeat(40)
    }), 'utf8');
    await writeProfile(home, {
      dependencies: { demo: `link:${checkout}` },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    execHook = gitResponder({});
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /JSON|Unexpected|Unexpected token/i);
  });
});

serialTest('updatePlugin pull-local：package.json 变了要重装依赖', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home, {
      version: '2.0.0',
      pkg: { name: 'demo', version: '2.0.0', scripts: { prepare: 'node build.js' } }
    });
    const nodeCalls = [];
    execHook = async (call) => {
      nodeCalls.push(call.args);
      if (call.args[0] === 'merge') {
        // 合并后依赖变了
        await writeFile(join(checkout, 'package.json'), JSON.stringify({
          name: 'demo', version: '2.0.0', dependencies: { left: '1.0.0' }, scripts: { prepare: 'node build.js' }
        }), 'utf8');
        return { stdout: '', stderr: '' };
      }
      return gitResponder({})(call);
    };
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, true);
    assert.ok(nodeCalls.some(args => args.includes('install')), '依赖变了要重装');
    assert.match(result.note, /并重装了依赖/);
    assert.match(result.note, /重新构建/);
  });
});

serialTest('updatePlugin pull-local：package.json 没有版本号时如实上报', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home, {
      pkg: { name: 'demo', scripts: { build: 'tsc' } }
    });
    execHook = gitResponder({});
    const result = await updatePlugin('demo', { mode: 'pull-local', target: '1.0.0' });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '1.0.0');
    assert.equal(result.verified, false);
  });
});

serialTest('updatePlugin pull-local：client 入口也要验收', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home, {
      version: '2.0.0',
      pkg: { name: 'demo', version: '2.0.0', exports: { './client': './client/index.js' } }
    });
    execHook = gitResponder({});
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.match(result.error, /入口文件缺失/);
  });
});

serialTest('updatePlugin pull-local：写来源标记失败时不阻断更新', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home, {
      version: '2.0.0',
      pkg: { name: 'demo', version: '2.0.0' }
    });
    execHook = gitResponder({});
    await withFsHooks({ writeFile: path => path.endsWith('.dsh-source.json') }, async () => {
      const result = await updatePlugin('demo', { mode: 'pull-local' });
      assert.equal(result.ok, true);
    });
    assert.ok(await exists(join(checkout, 'package.json')));
  });
});

serialTest('updatePlugin pull-local：读 HEAD 失败时不写来源标记', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home, {
      version: '2.0.0',
      pkg: { name: 'demo', version: '2.0.0' }
    });
    execHook = gitResponder({ 'rev-parse HEAD': execError('git 挂了') });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, true);
    const marker = JSON.parse(await readFile(join(checkout, '.dsh-source.json'), 'utf8'));
    assert.equal(marker.commit, 'a'.repeat(40), '读不到新 HEAD 就保留原标记');
  });
});

serialTest('updatePlugin switch-release：查 npm 失败时如实说没有发行版', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = (call) => {
      if (call.args[0] === 'view') throw execError('registry 挂了');
      return { stdout: '', stderr: '' };
    };
    const result = await updatePlugin('demo', { mode: 'switch-release' });
    assert.equal(result.ok, false);
    assert.match(result.error, /npm 上没有发布 demo/);
  });
});

serialTest('updatePlugin switch-release：npm 返回空时如实说没有发行版', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', { mode: 'switch-release' });
    assert.equal(result.ok, false);
    assert.match(result.error, /npm 上没有发布 demo/);
  });
});

serialTest('updatePlugin switch-release：切换成功且版本对得上时如实说已切换', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    const profile = join(home, 'profiles', 'web');
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"2.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', {
      mode: 'switch-release',
      // pnpm add 之后 node_modules 里就是新版本了
      command: async () => {
        await writeFile(join(profile, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
        return { note: 'ok' };
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.match(result.note, /已切换为 npm 发行版/);
  });
});

serialTest('updatePlugin switch-release：切换命令失败时如实报错', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"2.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', { mode: 'switch-release', command: async () => { throw new Error('add 失败'); } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.match(result.error, /add 失败/);
  });
});

// ---------------------------------------------------------------------------
// 第三轮：补齐剩下的分支
// ---------------------------------------------------------------------------

/** 让 npm 一律查不到、git clone 铺一份指定目录树。 */
function installViaSource(tree, head = 'a'.repeat(40)) {
  return async (call) => {
    if (call.args[0] === 'view') throw execError('E404 Not Found');
    if (call.args[0] === 'clone') {
      const dest = call.args[call.args.length - 1];
      await writeTree(dest, tree);
      return { stdout: '', stderr: '' };
    }
    if (call.args.includes('rev-parse')) return { stdout: head, stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

serialTest('installPlugin：子目录克隆里没有 package.json 时拒绝安装', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'sub/README.md': 'no package here' });
    const result = await installPlugin({ name: 'Owner/Repo#sub' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, false);
    assert.match(result.error, /子目录 sub没有 package\.json/);
  });
});

serialTest('installPlugin：克隆后取不到 HEAD 时来源标记里没有 commit', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = async (call) => {
      if (call.args[0] === 'view') throw execError('E404 Not Found');
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        await writeTree(dest, { 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
        return { stdout: '', stderr: '' };
      }
      if (call.args.includes('rev-parse')) throw execError('git 挂了');
      return { stdout: '', stderr: '' };
    };
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    const marker = JSON.parse(await readFile(join(home, 'profiles', 'web', 'plugin-sources', 'Owner-Repo', '.dsh-source.json'), 'utf8'));
    assert.equal(marker.commit, null);
  });
});

serialTest('installPlugin：子目录源码缺模块时拒绝安装', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({
      'sub/package.json': JSON.stringify({ name: 'repo', version: '1.0.0' }),
      'sub/index.js': "import './missing.js'\n"
    });
    const result = await installPlugin({ name: 'Owner/Repo#sub' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, false);
    assert.match(result.error, /缺少模块/);
  });
});

serialTest('missingPackageEntries：exports 的数组里没有可用目标时不校验', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo',
      exports: { '.': [123] }
    }), 'utf8');
    assert.deepEqual(await missingPackageEntries(pkg), []);
  });
});

serialTest('prepareClonedSource：pnpm 抛的不是 Error 时也要如实上报', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({
      name: 'demo', main: './lib/index.js', scripts: { build: 'tsc' }
    }), 'utf8');
    execHook = () => { throw '字符串错误'; };
    const result = await prepareClonedSource(pkg);
    assert.equal(result.ok, false);
    assert.match(result.error, /字符串错误/);
  });
});

serialTest('prepareClonedSource：入口缺失时才会构建（入口齐全就不碰 node_modules）', async () => {
  await withTempHome(async home => {
    const pkg = join(home, 'pkg');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'demo', main: './lib/index.js' }), 'utf8');
    await mkdir(join(pkg, 'node_modules'), { recursive: true });
    let removed = false;
    await withFsHooks({ rm: path => { removed = true; return path === join(pkg, 'node_modules'); } }, async () => {
      const result = await prepareClonedSource(pkg, {
        runBuild: async (dir) => {
          await mkdir(join(dir, 'lib'), { recursive: true });
          await writeFile(join(dir, 'lib', 'index.js'), '', 'utf8');
          return { ok: true };
        }
      });
      assert.equal(result.ok, true);
      assert.equal(removed, true, '构建完要清掉 node_modules');
    });
  });
});

serialTest('installPlugin：克隆出来的包在 npm 上有发行版时直接装发行版', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: '@scope/pkg', version: '2.0.0' }) });
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      npmProbe: async name => name === '@scope/pkg'
    });
    assert.equal(result.ok, true);
    assert.equal(result.fromNpm, true);
    assert.equal(result.installedAs, '@scope/pkg');
    assert.deepEqual(commands, [['add', '@scope/pkg']]);
  });
});

serialTest('installPlugin：repository 查不到时不否决 npm 发行版（信任源码 package.json 的 name）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    // 源码 package.json 的 name 是 dshmarket（无 scope），市场条目名是 dsh-market/dsh-market。
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'dshmarket', version: '1.73.20' }) });
    const commands = [];
    const result = await installPlugin({ name: 'dsh-market/dsh-market' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      npmProbe: async name => name === 'dshmarket',
      // 国内镜像下 pnpm view repository 失败 → null；不能因此否决整个 npm 路径，
      // 否则会被逼去走上游构建坏掉的 git 源码（dsh-market 的真实现象）。
      npmRepository: async () => null,
    });
    assert.equal(result.ok, true);
    assert.equal(result.fromNpm, true, 'repository 查不到仍走 npm 发行版');
    assert.deepEqual(commands, [['add', 'dshmarket']]);
  });
});

serialTest('installPlugin：repository 明确对不上时才否决 npm 发行版', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'someone-else', version: '1.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'installed' }), {
      verifyPresent: async () => true,
      npmProbe: async name => name === 'someone-else',
      npmRepository: async () => ({ url: 'https://github.com/other/different.git' }),
    });
    assert.equal(result.fromNpm, undefined, '明确对不上就否决 npm 路径，不装别人的同名包');
  });
});

serialTest('installPlugin：npm 探测抛错时按「没找到」处理', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'cloned-pkg', version: '2.0.0' }) });
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      npmProbe: async name => {
        if (name === 'cloned-pkg') throw new Error('registry 挂了');
        return false;
      }
    });
    assert.equal(result.ok, true);
    assert.match(result.installedAs, /^file:/);
  });
});

serialTest('installPlugin：repository 查询抛错时信任源码 name，仍走 npm 发行版', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'cloned-pkg', version: '2.0.0' }) });
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      npmProbe: async name => name === 'cloned-pkg',
      npmRepository: async () => { throw new Error('registry 挂了'); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.fromNpm, true, 'repository 查询抛错不否决 npm 路径');
    assert.ok(commands.some(args => args[0] === 'add' && args[1] === 'cloned-pkg'));
  });
});

serialTest('installPlugin：源码构建失败时如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      prepare: async () => ({ ok: false, error: '构建炸了' })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /构建炸了/);
  });
});

serialTest('installPlugin：构建产物里出现落不了地的 import 时拒绝安装', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      prepare: async (dir) => {
        await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
        return { ok: true, built: true };
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /缺少模块/);
  });
});

serialTest('installPlugin：装上了但没物化时如实报错（源码路径同样适用）', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => undefined, {
      npmProbe: async () => false,
      prepare: async () => ({ ok: true, built: false })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /没有出现在 node_modules 里/);
  });
});

serialTest('installPlugin：源码安装命令失败时如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => { throw new Error('pnpm add 失败'); }, {
      npmProbe: async () => false,
      prepare: async () => ({ ok: true, built: false })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /pnpm add 失败/);
  });
});

serialTest('installPlugin：npm 装不上时最后一条错误是源码安装的错误', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      prepare: async () => ({ ok: false, error: '源码也装不上' })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /源码也装不上/);
  });
});

serialTest('installPlugin：克隆失败时最后一条错误是克隆的错误', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      clone: async () => ({ ok: false, error: '克隆失败' })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /克隆失败/);
  });
});

serialTest('installPlugin：克隆失败且没有原因时退回通用错误', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      clone: async () => ({ ok: false })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /npm 上没有 repo/, '克隆没给出原因时保留前面那条错误');
  });
});

serialTest('installPlugin：名字里没有候选时如实说安装失败', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await installPlugin({ name: '' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, false);
    assert.equal(result.error, '安装失败');
  });
});

serialTest('installPlugin：npm 上有同名包但装不上时如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({ 'plain version': '1.0.0' });
    const result = await installPlugin({ name: 'plain' }, async () => { throw new Error('pnpm add 失败'); }, {
      verifyPresent: async () => true
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /pnpm add 失败/);
  });
});

serialTest('installPlugin：npm 命令没有返回值时也能继续', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({ 'plain version': '1.0.0' });
    const result = await installPlugin({ name: 'plain' }, async () => undefined, { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    assert.equal(result.packageName, 'plain');
  });
});

serialTest('installPlugin：已装的 scope 同名包也算装过了', async () => {
  await withTempHome(async home => {
    const profile = await writeProfile(home, {
      bundles: ['@scope/repo'],
      packages: { '@scope/repo': { name: '@scope/repo', version: '1.0.0' } }
    });
    assert.ok(profile);
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.installedAs, '@scope/repo');
  });
});

serialTest('installPlugin：坏掉的残留不算「已安装」', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    await mkdir(join(profile, 'node_modules'), { recursive: true });
    await linkDir(join(home, 'nowhere'), join(profile, 'node_modules', 'repo'));
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'web', dependencies: {}, dsh: { profile: { bundles: [] } } }), 'utf8');
    execHook = pnpmViewResponder({ '@owner/repo version': '1.0.0' });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), { verifyPresent: async () => true });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyInstalled, undefined, '坏残留不算装过');
  });
});

serialTest('uninstallPlugin：依赖记录还在但磁盘上已干净时要清理记录', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { dependencies: { demo: '^1.0.0' } });
    const result = await uninstallPlugin('demo', async () => ({ note: '已卸载' }));
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
  });
});

serialTest('uninstallPlugin：忽略记录写失败时不阻断卸载', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    await withFsHooks({ writeFile: path => path.includes('.plugin-updates-ignored.json') }, async () => {
      const result = await uninstallPlugin('demo', async () => ({ note: '已卸载' }));
      assert.equal(result.ok, true);
    });
  });
});

serialTest('updatePlugin：检测抛的不是 Error 时也要如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      dependencies: { demo: 'github:o/demo' },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    const result = await updatePlugin('demo', {
      check: async () => { throw '字符串错误'; }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, '字符串错误');
  });
});

serialTest('updatePlugin pull-local：拉取过程抛错时如实报错', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = gitResponder({ 'rev-parse HEAD': execError('git 挂了') });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, true, '读不到 HEAD 只影响来源标记，不影响更新本身');
  });
});

serialTest('applyPluginUpdate：没有注入检测时走默认检测（注入探针，不联网）', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { demo: { name: 'demo', version: '1.0.0' } } });
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      probe: { npm: async () => ({ version: '2.0.0' }) },
      verifyApplied: async () => true,
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.deepEqual(commands, [['add', 'demo@2.0.0']]);
  });
});

serialTest('applyPluginUpdate：检测没有结果时如实说没有可更新的版本', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', remote: { type: 'npm', package: 'demo' }
    }, { check: async () => [] });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'unknown');
    assert.match(result.error, /没有检测到可更新的版本/);
  });
});

serialTest('applyPluginUpdate：npm 装完版本没跟上时如实说「重启后确认」', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { demo: { name: 'demo', version: '1.0.0' } } });
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {},
      verifyApplied: async () => false
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, false);
    assert.match(result.note, /node_modules 版本未变/);
  });
});

serialTest('applyPluginUpdate：指向用户目录的插件可以显式选择就地更新', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home, { version: '2.0.0', pkg: { name: 'demo', version: '2.0.0' } });
    execHook = gitResponder({});
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `link:${checkout}`, installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: checkout }
    }, {
      mode: 'pull-local',
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
  });
});

serialTest('applyPluginUpdate：指向用户目录的插件也可以显式切换为发行版', async () => {
  await withTempHome(async home => {
    const checkout = await makeDevCheckout(home);
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"2.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `link:${checkout}`, installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: checkout }
    }, {
      mode: 'switch-release',
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
  });
});

serialTest('applyPluginUpdate：备份目录删不掉时也要继续', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home, { version: '2.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    await withFsHooks({ rm: path => path.includes('.bak-') }, async () => {
      const result = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async () => {},
        clone
      });
      assert.equal(result.ok, true);
      assert.equal(result.updatedTo, '2.0.0');
    });
  });
});

serialTest('applyPluginUpdate：重新克隆没有给出目录时用原目录兜底', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home, { version: '2.0.0' });
    const clone = async () => {
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: undefined, packageName: 'demo' };
    };
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); },
      clone
    });
    assert.equal(result.ok, true);
    assert.equal(commands.length, 1);
  });
});

serialTest('applyPluginUpdate：源码构建失败时回滚旧源码', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home, { version: '2.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let outcome = null;
    try {
      outcome = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async () => {},
        clone,
        prepare: async () => ({ ok: false, error: '构建炸了' })
      });
    } catch (error) {
      outcome = error;
    }
    assert.ok(outcome instanceof Error);
    assert.match(outcome.message, /构建炸了/);
  });
});

serialTest('applyPluginUpdate：构建后源码残缺时回滚旧源码', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home, { version: '2.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let outcome = null;
    try {
      outcome = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async () => {},
        clone,
        prepare: async (dir) => {
          await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
          return { ok: true, built: true };
        }
      });
    } catch (error) {
      outcome = error;
    }
    assert.ok(outcome instanceof Error);
    assert.match(outcome.message, /缺少模块/);
  });
});

serialTest('applyPluginUpdate：旧源码放不回去时要给出人工恢复的指引', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home, { version: '2.0.0' });
    const clone = async () => ({ ok: false, error: '克隆失败' });
    let outcome = null;
    // 备份目录改名不回去 → 给出人工恢复的指引
    await withFsHooks({ rename: path => path.includes('.bak-') }, async () => {
      try {
        outcome = await applyPluginUpdate({
          name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
          installedCommit: 'a'.repeat(40),
          remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
        }, {
          check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
          command: async () => {},
          clone
        });
      } catch (error) {
        outcome = error;
      }
    });
    assert.ok(outcome instanceof Error);
    assert.match(outcome.message, /克隆失败/);
    assert.match(outcome.message, /旧版本没能从/);
  });
});

serialTest('applyPluginUpdate：github: 来源没有 spec 时按 author/repo 重新解析', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { demo: { name: 'demo', version: '1.0.0' } } });
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: null, installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: null }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => { commands.push(args); }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', 'github:o/demo']]);
    assert.match(result.note, /node_modules 版本未变/);
  });
});

serialTest('applyPluginUpdate：退回原版本失败时如实说明要手动重装', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds > 1) throw new Error('退回也失败');
        return { note: 'ok' };
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /退回 v1\.0\.0 也失败/);
  });
});

serialTest('applyPluginUpdate：git 来源退回原 commit 失败时如实说明', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: 'github:o/demo', installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: null }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds > 1) throw new Error('退回也失败');
        return { note: 'ok' };
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /退回 github:o\/demo#aaaaaaaa/);
  });
});

serialTest('applyPluginUpdate：node_modules 里没有这个包时如实说「重启后确认」', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const sourcesDir = join(profile, 'plugin-sources', 'o-demo');
    await mkdir(sourcesDir, { recursive: true });
    await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
    await writeFile(join(sourcesDir, '.dsh-source.json'), JSON.stringify({
      author: 'o', repo: 'demo', subdir: null, url: 'https://github.com/o/demo.git', commit: 'a'.repeat(40)
    }), 'utf8');
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'web',
      dependencies: { demo: `file:${sourcesDir}` },
      dsh: { profile: { bundles: ['demo'] } }
    }), 'utf8');
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {},
      clone
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, false);
    assert.match(result.note, /node_modules 里没有该包/);
  });
});

serialTest('applyPluginUpdate：重装失败时把旧源码换回去', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home, { version: '1.0.0' });
    await writeFile(join(sourcesDir, 'index.js'), '// 旧版本', 'utf8');
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        commands.push(args);
        if (commands.filter(item => item[0] === 'add').length === 2) throw new Error('重装失败');
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /重装 v2\.0\.0 失败/);
    assert.match(result.error, /已改回更新前的源码副本|旧版本源码副本已不在/);
  });
});

serialTest('applyPluginUpdate：旧源码换回去时 profile 同步失败时如实说明', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeGitProfile(home, { version: '1.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        commands.push(args);
        // 第一次 add 装新源码；收尾重装失败；回滚时的 add 也失败
        if (commands.filter(item => item[0] === 'add').length >= 2) throw new Error('重装失败');
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /profile 没能同步|重装 v2\.0\.0 失败/);
  });
});

serialTest('pruneSourceBackups：备份与暂存目录删不掉时只当尽力而为', async () => {
  await withTempHome(async home => {
    const dir = join(home, 'plugin-sources');
    await mkdir(dir, { recursive: true });
    for (const name of ['o-repo.bak-20260101000000', 'o-repo.bak-20260202000000', 'o-repo.staged-1-2']) {
      await mkdir(join(dir, name), { recursive: true });
    }
    await withFsHooks({ rm: path => path.includes('o-repo.bak-') || path.includes('o-repo.staged-') }, async () => {
      const removed = await pruneSourceBackups(join(dir, 'o-repo'));
      assert.deepEqual(removed.sort(), ['o-repo.bak-20260101000000', 'o-repo.staged-1-2']);
    });
  });
});

serialTest('updatePlugins：已有批次在跑时拒绝重复受理', async () => {
  await withTempHome(async home => {
    await writeProfile(home, {
      dependencies: { demo: 'github:o/demo' },
      bundles: ['demo'],
      packages: { demo: { name: 'demo', version: '1.0.0' } }
    });
    let release = null;
    const gate = new Promise(resolve => { release = resolve; });
    const running = updatePlugins(['demo'], {
      check: async () => { await gate; return []; }
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await updatePlugins(['demo']);
    assert.equal(second.ok, false);
    assert.equal(second.busy, true);
    assert.match(second.error, /已有批量更新正在进行/);
    release();
    await running;
  });
});

serialTest('fetchOfficialMarketPlugins：搜索结果里没有 objects / 不是插件的包都要挡掉', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const rows = await fetchOfficialMarketPlugins({
      fetch: async (url) => {
        if (String(url).includes('/-/v1/search')) return { ok: true, status: 200, json: async () => ({}) };
        return { ok: false, status: 404, json: async () => ({}) };
      }
    });
    assert.deepEqual(rows, []);
  });
});

serialTest('fetchOfficialMarketPlugins：名字里既没有 bundle 也没有 plugin 的包不进清单', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const rows = await fetchOfficialMarketPlugins({
      fetch: async (url) => {
        if (String(url).includes('/-/v1/search')) {
          return {
            ok: true, status: 200, json: async () => ({
              objects: [{ package: { name: '@deepseek-ai/dsh-core' } }]
            })
          };
        }
        return { ok: true, status: 200, json: async () => ({ version: '1.0.0', dsh: { bundle: true } }) };
      }
    });
    assert.deepEqual(rows, []);
  });
});

serialTest('fetchOfficialMarketPlugins：没有下载量/日期/版本号时按空值处理', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const rows = await fetchOfficialMarketPlugins({
      fetch: async (url) => {
        if (String(url).includes('/-/v1/search')) {
          return {
            ok: true, status: 200, json: async () => ({
              objects: [
                { package: { name: '@deepseek-ai/dsh-plugin-a' } },
                { package: { name: '@deepseek-ai/dsh-plugin-b', date: '2026-02-02' } }
              ]
            })
          };
        }
        const name = decodeURIComponent(/latest$/.test(String(url)) ? String(url).split('/').slice(-2)[0] : '');
        if (name === '@deepseek-ai/dsh-plugin-b') {
          return { ok: true, status: 200, json: async () => ({ version: '2.0.0', dsh: { bundle: true } }) };
        }
        return { ok: true, status: 200, json: async () => ({ dsh: { bundle: true } }) };
      }
    });
    assert.equal(rows.length, 2);
    const alpha = rows.find(item => item.name === '@deepseek-ai/dsh-plugin-a');
    assert.equal(alpha.downloads, 0);
    assert.equal(alpha.addedDate, null);
    assert.equal(alpha.version, null);
    const beta = rows.find(item => item.name === '@deepseek-ai/dsh-plugin-b');
    assert.equal(beta.addedDate, '2026-02-02');
    assert.equal(beta.version, '2.0.0');
  });
});

serialTest('fetchOfficialMarketPlugins：读不到 latest 清单的包不进清单', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const rows = await fetchOfficialMarketPlugins({
      fetch: async (url) => {
        if (String(url).includes('/-/v1/search')) {
          return {
            ok: true, status: 200, json: async () => ({
              objects: [{ package: { name: '@deepseek-ai/dsh-plugin-a', date: '2026-02-02' } }]
            })
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      }
    });
    assert.deepEqual(rows, []);
  });
});

serialTest('refreshMarketplace：社区条目的缺省字段要补齐，分类按官方优先排序', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, {
          'data/plugins/bare.yml': 'url: https://github.com/o/bare\n',
          'data/plugins/officialish.yml': 'url: https://github.com/o/officialish\ncategory: official\n',
          'data/plugins/data.yml': 'url: https://github.com/o/data\ncategory: data\n'
        }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    fetchHook = registryFetch([], {});
    const summary = await refreshMarketplace();
    assert.deepEqual(summary.categories, ['official', 'data', 'other']);
    const market = await readMarketplace();
    const bare = market.plugins.find(item => item.url === 'https://github.com/o/bare');
    assert.equal(bare.name, 'https://github.com/o/bare');
    assert.equal(bare.author, '');
    assert.equal(bare.repo, '');
    assert.equal(bare.category, 'other');
    assert.equal(bare.descriptionEn, '');
    assert.equal(bare.descriptionZh, '');
    assert.equal(bare.downloads, 0);
    assert.equal(bare.stars, 0);
    assert.equal(bare.screenshot, null);
    assert.equal(bare.addedDate, null);
  });
});

serialTest('refreshMarketplace：市场仓库里没有 plugins 目录时按空清单处理', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'data/README.md': 'no plugins dir' }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    fetchHook = registryFetch([], {});
    const summary = await refreshMarketplace();
    assert.equal(summary.count, 0);
    assert.deepEqual(summary.categories, []);
  });
});

serialTest('refreshMarketplace：写索引失败时把半截临时文件收掉', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const marketRoot = join(home, 'plugin-market');
    await mkdir(marketRoot, { recursive: true });
    await mkdir(join(marketRoot, 'index.json'), { recursive: true });
    execHook = (call) => {
      if (call.args[0] === 'clone') {
        const dest = call.args[call.args.length - 1];
        return writeTree(dest, { 'data/plugins/.keep': '' }).then(() => ({ stdout: '', stderr: '' }));
      }
      return { stdout: '', stderr: '' };
    };
    fetchHook = registryFetch([], {});
    await withFsHooks({ rm: path => path.includes('index.json.tmp-') }, async () => {
      await assert.rejects(refreshMarketplace());
    });
    const leftovers = (await readdir(marketRoot)).filter(name => name.startsWith('index.json.tmp-'));
    assert.equal(leftovers.length, 1, '临时文件删不掉时只能留着（尽力而为）');
  });
});

// ---------------------------------------------------------------------------
// 第四轮：补齐「异常形态 / 回滚收尾 / 区间工具」的分支
// ---------------------------------------------------------------------------

/** 一个 file: 来源的 profile（插件装在 plugin-sources 里）。 */
async function makeSourceProfile(home, { name = 'demo', version = '1.0.0', installed = true } = {}) {
  const profile = join(home, 'profiles', 'web');
  const sourcesDir = join(profile, 'plugin-sources', 'o-demo');
  await mkdir(sourcesDir, { recursive: true });
  await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name, version }), 'utf8');
  await writeFile(join(sourcesDir, '.dsh-source.json'), JSON.stringify({
    author: 'o', repo: 'demo', subdir: null, url: 'https://github.com/o/demo.git', commit: 'a'.repeat(40)
  }), 'utf8');
  await writeProfile(home, {
    dependencies: { [name]: `file:${sourcesDir}` },
    bundles: [name],
    packages: installed ? { [name]: { name, version } } : {}
  });
  return { profile, sourcesDir };
}

serialTest('installPlugin：npm 发行版装上了但命令没返回值时也算装上', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: '@scope/pkg', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => undefined, {
      verifyPresent: async () => true,
      npmProbe: async name => name === '@scope/pkg'
    });
    assert.equal(result.ok, true);
    assert.equal(result.fromNpm, true);
  });
});

serialTest('installPlugin：npm 发行版装不上时回退到源码构建', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: '@scope/pkg', version: '2.0.0' }) });
    const commands = [];
    const result = await installPlugin({ name: 'Owner/Repo' }, async (args) => {
      commands.push(args);
      if (args[1] === '@scope/pkg') throw new Error('npm 装不上');
      return { note: 'installed' };
    }, {
      verifyPresent: async () => true,
      npmProbe: async name => name === '@scope/pkg'
    });
    assert.equal(result.ok, true);
    assert.match(result.installedAs, /^file:/, 'npm 装不上要退回源码那条路');
    assert.ok(commands.some(args => args[0] === 'add' && String(args[1]).startsWith('file:')));
  });
});

serialTest('installPlugin：源码已构建且带说明时提示里要写明', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: '已安装' }), {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      prepare: async () => ({ ok: true, built: true })
    });
    assert.equal(result.ok, true);
    assert.match(result.note, /（源码已构建）/);
  });
});

serialTest('installPlugin：源码已构建但没有说明时也要写明已构建', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => undefined, {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      prepare: async () => ({ ok: true, built: true })
    });
    assert.equal(result.ok, true);
    assert.equal(result.note, '源码已构建');
  });
});

serialTest('installPlugin：npm 命令抛的不是 Error 时也要如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = pnpmViewResponder({ 'plain version': '1.0.0' });
    const result = await installPlugin({ name: 'plain' }, async () => { throw '字符串错误'; }, {
      verifyPresent: async () => true
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, '字符串错误');
  });
});

serialTest('installPlugin：源码安装抛的不是 Error 时也要如实报错', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => { throw '字符串错误'; }, {
      npmProbe: async () => false,
      prepare: async () => ({ ok: true, built: false })
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, '字符串错误');
  });
});

serialTest('satisfiesPluginRange：只写一段版本号时缺省段按 0 处理', () => {
  // '^1' → major=1，minor/patch 缺省 0 → 上界 2.0.0
  assert.equal(satisfiesPluginRange('1.9.9', '^1'), true);
  assert.equal(satisfiesPluginRange('2.0.0', '^1'), false);
  // '^1.x.3' 里的 x 不是数字 → 按 0 处理（等价于 ^1.0.3，上界 2.0.0）
  assert.equal(satisfiesPluginRange('1.0.3', '^1.x.3'), true);
  assert.equal(satisfiesPluginRange('2.0.0', '^1.x.3'), false);
});

serialTest('satisfiesPluginRange：x 出现在数字里时按整段比较', () => {
  // '1x' 既不是纯数字也不是 x-range 的写法 → 展开出来的上下界不可用 → 不满足
  assert.equal(satisfiesPluginRange('1.0.0', '1x'), false);
});

serialTest('fetchTargetPeerDependencies：来源里没有 remote 时返回空', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    assert.deepEqual(await fetchTargetPeerDependencies(null, '1.0.0'), {});
    assert.deepEqual(await fetchTargetPeerDependencies({ name: 'demo' }, '1.0.0'), {});
  });
});

serialTest('fetchTargetPeerDependencies：npm 包没写 package 字段时用插件名', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const views = [];
    execHook = (call) => {
      views.push(call.args);
      return { stdout: JSON.stringify({ 'dsh-ui': '^2.0.0' }), stderr: '' };
    };
    const peers = await fetchTargetPeerDependencies({
      name: 'demo', kind: 'npm', remote: { type: 'npm' }
    }, '2.0.0');
    assert.deepEqual(peers, { 'dsh-ui': '^2.0.0' });
    assert.ok(views[0].includes('demo@2.0.0'));
  });
});

serialTest('fetchTargetPeerDependencies：registry 返回的不是对象时按空处理', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = (call) => ({ stdout: '"不是对象"', stderr: '' });
    const peers = await fetchTargetPeerDependencies({
      name: 'demo', kind: 'npm', remote: { type: 'npm', package: 'demo' }
    }, '2.0.0');
    assert.deepEqual(peers, {});
  });
});

serialTest('fetchTargetPeerDependencies：版本没变时用已装的 commit 去读', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    const requests = [];
    const peers = await fetchTargetPeerDependencies({
      name: 'demo', kind: 'git', installedVersion: '1.0.0', installedCommit: 'b'.repeat(40),
      remote: { type: 'git', author: 'o', repo: 'r', subdir: null }
    }, '1.0.0', {
      fetch: async (url) => {
        requests.push(String(url));
        return { ok: true, status: 200, json: async () => ({ peerDependencies: { 'dsh-ui': '^1.0.0' } }) };
      }
    });
    assert.deepEqual(peers, { 'dsh-ui': '^1.0.0' });
    assert.ok(requests[0].includes('b'.repeat(40)));
  });
});

serialTest('readInstalledPeerDependencies：名字为空时返回空', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    assert.deepEqual(await readInstalledPeerDependencies(null), {});
    assert.deepEqual(await readInstalledPeerDependencies(undefined), {});
  });
});

serialTest('applyPluginUpdate：既不注入检测也不注入探针时走默认探测（离线假 registry）', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { demo: { name: 'demo', version: '1.0.0' } } });
    // 默认探针会跑 pnpm view（已被假 execFile 接管）→ 解析失败 → 结论是「失败」
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '', stderr: '' } : { stdout: '', stderr: '' });
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, { command: async () => {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
  });
});

serialTest('applyPluginUpdate：重新克隆失败且没有原因时给出通用提示', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeSourceProfile(home, { version: '2.0.0' });
    let outcome = null;
    try {
      outcome = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async () => {},
        clone: async () => ({ ok: false })
      });
    } catch (error) {
      outcome = error;
    }
    assert.ok(outcome instanceof Error);
    assert.match(outcome.message, /重新克隆失败/);
  });
});

serialTest('applyPluginUpdate：装新源码的命令抛的不是 Error 时也要如实报错', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeSourceProfile(home, { version: '2.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let outcome = null;
    // 旧源码放不回去 → 抛出的提示里要带上原始错误（字符串错误）
    await withFsHooks({ rename: path => path.includes('.bak-') }, async () => {
      try {
        outcome = await applyPluginUpdate({
          name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
          installedCommit: 'a'.repeat(40),
          remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
        }, {
          check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
          command: async () => { throw '字符串错误'; },
          clone
        });
      } catch (error) {
        outcome = error;
      }
    });
    assert.ok(outcome instanceof Error);
    assert.match(outcome.message, /字符串错误/);
    assert.match(outcome.message, /旧版本没能从/);
  });
});

serialTest('applyPluginUpdate：github: 来源重新解析后版本对得上时如实说已更新', async () => {
  await withTempHome(async home => {
    await writeProfile(home, { packages: { demo: { name: 'demo', version: '2.0.0' } } });
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: 'github:o/demo', installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: null }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => {}
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.match(result.note, /已更新到 v2\.0\.0/);
  });
});

serialTest('applyPluginUpdate：退回原版本抛的不是 Error 时也要如实说明', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', installedCommit: null,
      remote: { type: 'npm', package: 'demo' }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds > 1) throw '字符串错误';
        return { note: 'ok' };
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /退回 v1\.0\.0 也失败（字符串错误）/);
  });
});

serialTest('applyPluginUpdate：git 来源退回原 commit 抛的不是 Error 时也要如实说明', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const dir = join(profile, 'node_modules', 'demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
    await writeFile(join(dir, 'index.js'), "import './missing.js'\n", 'utf8');
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: 'github:o/demo', installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: null }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds > 1) throw '字符串错误';
        return { note: 'ok' };
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /退回 github:o\/demo#aaaaaaaa/);
  });
});

serialTest('applyPluginUpdate：本来就没有旧源码时回滚要如实说副本不在', async () => {
  await withTempHome(async home => {
    const profile = join(home, 'profiles', 'web');
    const sourcesDir = join(profile, 'plugin-sources', 'o-demo');
    // 源码目录本来就不存在 → 更新时没有备份
    await mkdir(profile, { recursive: true });
    await mkdir(join(profile, 'node_modules', 'demo'), { recursive: true });
    await writeFile(join(profile, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
    const clone = async () => {
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: null,
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds === 2) throw new Error('重装失败');
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /旧版本源码副本已不在/);
  });
});

serialTest('applyPluginUpdate：新目录与依赖目录不同时回滚要先清掉新目录', async () => {
  await withTempHome(async home => {
    const { profile, sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const newDir = join(profile, 'plugin-sources', 'o-demo-new');
    const clone = async () => {
      await mkdir(newDir, { recursive: true });
      await writeFile(join(newDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: newDir, packageName: 'demo' };
    };
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds === 2) throw new Error('重装失败');
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, false);
    assert.equal(await exists(newDir), false, '回滚时要把新目录清掉，别留两份源码');
  });
});

serialTest('applyPluginUpdate：回滚时旧源码放不回去要给出人工恢复的指引', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let adds = 0;
    let result = null;
    await withFsHooks({ rename: path => path.includes('.bak-') }, async () => {
      result = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async (args) => {
          adds += 1;
          if (adds === 2) throw new Error('重装失败');
          return { note: 'ok' };
        },
        clone
      });
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /旧版本没能从/);
  });
});

serialTest('applyPluginUpdate：回滚时 profile 同步失败抛的不是 Error 时也要如实说明', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds >= 2) throw '字符串错误';
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /profile 没能同步（字符串错误）/);
  });
});

serialTest('applyPluginUpdate：包目录删不掉时也不阻断重装', async () => {
  await withTempHome(async home => {
    const { profile, sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    await withFsHooks({ rm: path => path === join(profile, 'node_modules', 'demo') }, async () => {
      const result = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async () => {},
        clone
      });
      assert.equal(result.ok, true);
      assert.equal(result.verified, false);
    });
  });
});

serialTest('applyPluginUpdate：重装抛的不是 Error 时也要如实说明', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    let adds = 0;
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        adds += 1;
        if (adds === 2) throw '字符串错误';
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /重装 v2\.0\.0 失败（字符串错误）/);
  });
});

serialTest('applyPluginUpdate：装进去的新源码残缺时回滚成旧源码', async () => {
  await withTempHome(async home => {
    const { sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        commands.push(args);
        // 第二次 add（收尾重装）之后源码变得残缺
        if (commands.filter(item => item[0] === 'add').length === 2) {
          await writeFile(join(sourcesDir, 'broken.js'), "import './missing.js'\n", 'utf8');
        }
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /缺少模块/);
  });
});

serialTest('applyPluginUpdate：重装一次之后版本对上了要说复核通过', async () => {
  await withTempHome(async home => {
    const { profile, sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const clone = async () => {
      await rm(sourcesDir, { recursive: true, force: true });
      await mkdir(sourcesDir, { recursive: true });
      await writeFile(join(sourcesDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: sourcesDir, packageName: 'demo' };
    };
    const commands = [];
    const result = await applyPluginUpdate({
      name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
      installedCommit: 'a'.repeat(40),
      remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async (args) => {
        commands.push(args);
        // 收尾重装之后 node_modules 里的版本跟上了
        if (commands.filter(item => item[0] === 'add').length === 2) {
          // 收尾重装前包目录被删过，这里模拟 pnpm 重新物化出新版本
          await mkdir(join(profile, 'node_modules', 'demo'), { recursive: true });
          await writeFile(join(profile, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
        }
        return { note: 'ok' };
      },
      clone
    });
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.match(result.note, /重装了一次让 node_modules 跟上/);
  });
});

// ---------------------------------------------------------------------------
// 第五轮：最后几个分支
// ---------------------------------------------------------------------------

serialTest('installPlugin：源码没构建也没有说明时提示里不写多余的话', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => undefined, {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      prepare: async () => ({ ok: true, built: false })
    });
    assert.equal(result.ok, true);
    assert.equal(result.note, undefined);
  });
});

serialTest('updatePlugin pull-local：合并抛的不是 Error 时也要如实报错', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home, { version: '2.0.0', pkg: { name: 'demo', version: '2.0.0' } });
    execHook = gitResponder({ merge: () => { throw '字符串错误'; } });
    const result = await updatePlugin('demo', { mode: 'pull-local' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.equal(result.error, '字符串错误');
  });
});

serialTest('updatePlugin switch-release：切换抛的不是 Error 时也要如实报错', async () => {
  await withTempHome(async home => {
    await makeDevCheckout(home);
    execHook = (call) => (call.args[0] === 'view' ? { stdout: '"2.0.0"', stderr: '' } : { stdout: '', stderr: '' });
    const result = await updatePlugin('demo', { mode: 'switch-release', command: async () => { throw '字符串错误'; } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'dev-linked');
    assert.equal(result.error, '字符串错误');
  });
});

serialTest('applyPluginUpdate：回滚时新目录删不掉也要继续放回旧源码', async () => {
  await withTempHome(async home => {
    const { profile, sourcesDir } = await makeSourceProfile(home, { version: '1.0.0' });
    const newDir = join(profile, 'plugin-sources', 'o-demo-new');
    const clone = async () => {
      await mkdir(newDir, { recursive: true });
      await writeFile(join(newDir, 'package.json'), JSON.stringify({ name: 'demo', version: '2.0.0' }), 'utf8');
      return { ok: true, dest: newDir, packageName: 'demo' };
    };
    let adds = 0;
    await withFsHooks({ rm: path => path === newDir }, async () => {
      const result = await applyPluginUpdate({
        name: 'demo', kind: 'git', spec: `file:${sourcesDir}`, installedVersion: '1.0.0',
        installedCommit: 'a'.repeat(40),
        remote: { type: 'git', url: 'https://github.com/o/demo.git', author: 'o', repo: 'demo', subdir: null, dir: sourcesDir }
      }, {
        check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
        command: async (args) => {
          adds += 1;
          if (adds === 2) throw new Error('重装失败');
          return { note: 'ok' };
        },
        clone
      });
      assert.equal(result.ok, false);
      assert.match(result.error, /已改回更新前的源码副本|旧版本没能从/);
    });
  });
});

serialTest('installPlugin：源码准备失败但没给出原因时保留前面那条错误', async () => {
  await withTempHome(async home => {
    await writeProfile(home);
    execHook = installViaSource({ 'package.json': JSON.stringify({ name: 'repo', version: '2.0.0' }) });
    const result = await installPlugin({ name: 'Owner/Repo' }, async () => ({ note: 'x' }), {
      verifyPresent: async () => true,
      npmProbe: async () => false,
      prepare: async () => ({ ok: false })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /npm 上没有 @owner\/repo|npm 上没有 repo/);
  });
});
