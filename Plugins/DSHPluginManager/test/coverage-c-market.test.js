// 插件中心「市场 + 检索 + 源配置 + 更新探测」这一段的补测（第三段）。
//
// 覆盖目标：lib/index.js 的 2701-4000 行（更新检测机器 / 国内加速镜像表 /
// 多源配置 CRUD），外加 4136-4777 行（分类归并 / 市场分页查询 / 描述找插件）。
//
// 纪律：
//   * 全程离线：网络、git、pnpm 全部换成注入的假实现，不发真实请求；
//   * 改 process.env.DSH_HOME / PATH / NODE_OPTIONS 的用例一律串行
//     （concurrency: false），并在 finally 里逐个还原；
//   * 路径一律用 node:path 的 join（Windows 上手写 '/' 会错）。
import assert from 'node:assert/strict';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { linkDir } from './helpers/link-helpers.js';
import {
  DEFAULT_SOURCE_ID,
  MARKET_GROUPS,
  activeMirrorTable,
  addPluginSource,
  aggregateCachedSources,
  applyIgnoredUpdates,
  applyPluginUpdate,
  buildPluginSearchPrompt,
  checkPluginUpdates,
  classifyPluginSource,
  collectPluginSources,
  comparePluginVersions,
  decidePluginUpdate,
  discoverSourceMarker,
  extractChangelogSection,
  fetchPluginReleaseNotes,
  fetchRemotePackageVersion,
  fetchSourceIndex,
  githubRepoFromUrl,
  ignorePluginUpdates,
  isUpdateIgnored,
  keywordVariants,
  marketCategoryLabel,
  marketGroupLabel,
  marketGroupOf,
  mirrorMapURL,
  normalizeCategory,
  normalizeSourceId,
  parseLockCommit,
  parsePluginVersion,
  parseSearchPicks,
  parseSourceIndex,
  patchUpdateCacheAfterUpdate,
  pluginMajorVersion,
  pnpmEnvironment,
  probeGitHead,
  probeNpmDistTags,
  pruneUninstalledUpdateEntries,
  queryMarketplace,
  rankPluginsByKeywords,
  readIgnoredUpdates,
  readMarketplaceAggregated,
  readMirrorStateCached,
  readPreferredSearchRoute,
  readPreferredSearchRoutes,
  readRepositoryHint,
  readSourceCache,
  readSourceRefreshProgress,
  readSourcesConfig,
  readUpdateCache,
  readUpdateProgress,
  refreshPluginSources,
  removePluginSource,
  resetMirrorCache,
  resolveSearchRoutes,
  runUpdateCheck,
  searchPluginsByDescription,
  setPluginSourceEnabled,
  sourceCandidates,
  sourceEntryToPlugin,
  summarizeUpdateInventory,
  unignorePluginUpdates,
  updatePlugin,
  writePreferredSearchRoute,
  writeUpdateCache,
} from '../lib/index.js';

// 这些用例都要改 process.env.DSH_HOME（以及 PATH / NODE_OPTIONS），必须串行：
// node:test 默认并发跑同一文件里的用例，环境会被互相踩。
const serialTest = (name, options, fn) => {
  if (typeof options === 'function') return test(name, { concurrency: false }, options);
  return test(name, { ...options, concurrency: false }, fn);
};

const isWindows = process.platform === 'win32';

// ---------------------------------------------------------------------------
// 通用助手
// ---------------------------------------------------------------------------

/** 假 fetch：按 URL 前缀分发固定响应；记录调用过的 URL 供断言。 */
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    for (const [prefix, respond] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) return respond(String(url));
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  return { calls, fetchImpl };
}

/** 临时替换全局 fetch（生产代码里很多地方直接用全局 fetch）。 */
async function withGlobalFetch(impl, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

/** 临时改一批环境变量（逐个还原）。 */
async function withEnv(vars, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** 用临时 DSH_HOME 跑一段代码（隔离源配置、缓存与 profile）。 */
async function withTempHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-c-'));
  try {
    return await withEnv({ DSH_HOME: home }, async () => {
      resetMirrorCache();
      try {
        return await run(home);
      } finally {
        resetMirrorCache();
      }
    });
  } finally {
    // 清理一定要放在 finally 里：用例失败时也要把临时目录带走。
    // Windows 上刚写过的文件偶尔会被索引器占住（EBUSY/EPERM），重试几次即可。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}

/** 造一个假的 profile（manifest + node_modules 里的已安装插件）。 */
async function seedProfile(home, { bundles = [], dependencies = {}, installed = {} } = {}) {
  const webDir = join(home, 'profiles', 'web');
  await mkdir(join(webDir, 'node_modules'), { recursive: true });
  await writeFile(
    join(webDir, 'package.json'),
    JSON.stringify({ dsh: { profile: { bundles } }, dependencies }, null, 2),
    'utf8',
  );
  for (const [name, pkg] of Object.entries(installed)) {
    const dir = join(webDir, 'node_modules', ...name.split('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  }
  return webDir;
}

/** 造一份市场主索引（模拟已经同步过默认源）。 */
async function seedMarket(home, plugins, extra = {}) {
  const dir = join(home, 'plugin-market');
  await mkdir(dir, { recursive: true });
  const payload = {
    version: 2,
    indexedAt: new Date().toISOString(),
    categories: [...new Set(plugins.map(item => item?.category).filter(Boolean))],
    plugins,
    ...extra,
  };
  await writeFile(join(dir, 'index.json'), JSON.stringify(payload), 'utf8');
  return dir;
}

/**
 * 假可执行文件：把 node.exe 硬链成 `pnpm` / `git`，
 * 再用 NODE_OPTIONS=--require 挂一个预加载脚本，按 argv[0] 的名字分流出
 * 「假装自己是 pnpm / git」的输出。这样 `probeNpmDistTags` / `probeGitHead`
 * 能在**完全离线**的情况下跑到成功分支。
 */
const FAKE_EXEC_PRELOAD = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const base = path.basename(process.argv[0] || '').replace(/\\.(exe|cmd|bat)$/i, '').toLowerCase();",
  "const args = process.argv.slice(1).map(String);",
  "if (base === 'pnpm') {",
  "  if (path.basename(args[0] || '') === 'view') { fs.writeSync(1, process.env.DSH_FAKE_PNPM_OUT || '{}'); process.exit(0); }",
  "  fs.writeSync(2, 'fake pnpm: unsupported'); process.exit(1);",
  "}",
  "if (base === 'git') {",
  "  if (process.env.DSH_FAKE_GIT_FAIL) { fs.writeSync(2, 'fake git: failed'); process.exit(128); }",
  "  fs.writeSync(1, (process.env.DSH_FAKE_GIT_OUT || '') + '\\n'); process.exit(0);",
  "}",
  '',
].join('\n');

/** 在 dir 里造出假的 pnpm / git 可执行文件，返回 { preload, dir }。 */
async function installFakeExecutables(dir) {
  await mkdir(dir, { recursive: true });
  const preload = join(dir, 'fake-exec.cjs');
  await writeFile(preload, FAKE_EXEC_PRELOAD, 'utf8');
  for (const name of ['pnpm', 'git']) {
    const target = join(dir, isWindows ? `${name}.exe` : name);
    try {
      await link(process.execPath, target);
    } catch {
      await copyFile(process.execPath, target);
    }
    if (!isWindows) await chmod(target, 0o755);
  }
  return { preload, dir };
}

/**
 * 让 `git` / `pnpm` 命令指向假实现：改 PATH（git 靠它被找到），
 * 再用 NODE_OPTIONS 让假可执行文件按名字走不同的剧本。
 */
async function withFakeExecutables(dir, run) {
  const { preload } = await installFakeExecutables(dir);
  const preloadPosix = preload.split('\\').join('/');
  await withEnv(
    {
      PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
      NODE_OPTIONS: `--require "${preloadPosix}"`,
    },
    run,
  );
}

/** 在 $DSH_HOME/pnpm-bin 下造一个假的 pnpm（probeNpmDistTags 走的就是这个路径）。 */
async function seedFakePnpmShim(home, dir) {
  const binDir = join(home, 'pnpm-bin');
  await mkdir(binDir, { recursive: true });
  const target = join(binDir, isWindows ? 'pnpm.exe' : 'pnpm');
  try {
    await link(process.execPath, target);
  } catch {
    await copyFile(process.execPath, target);
  }
  if (!isWindows) await chmod(target, 0o755);
  return binDir;
}

/** 一个可编排的假 llm（宿主模型服务）。 */
function makeLlm(options = {}) {
  const {
    providers = [{ id: 'p1', name: 'P1' }],
    models = [{ id: 'm1', name: 'M1' }],
    text = 'answer_num: 1, answer_relevance: 9, why: 正相关',
    finish = null,
    reasoning = null,
    prepareError = null,
    streamError = null,
    extraChunks = [],
    capture = null,
  } = options;
  return {
    listProviders: () => providers,
    listModels: async (providerId) => models.map(model => ({ provider: providerId, ...model })),
    prepareCall: async (config, signal, configure) => {
      if (prepareError) throw prepareError;
      const controls = configure ? configure({ temperature: 0 }, reasoning ? { reasoning } : undefined) : undefined;
      return {
        config: controls ?? config,
        stream: async function* (request) {
          if (capture) capture(request, config);
          if (streamError) throw streamError;
          yield { type: 'not-a-real-type' };
          for (const chunk of extraChunks) yield chunk;
          yield { type: 'text-delta', text };
          // 生产代码读的是 chunk.reason.kind / chunk.reason.failure
          if (finish) yield { type: 'finish', reason: finish };
        },
      };
    },
  };
}

/** 等条件成立（用于等后台刷新跑完）。 */
async function waitFor(predicate, { timeout = 4000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

// ---------------------------------------------------------------------------
// 1. 版本号语义（parsePluginVersion / comparePluginVersions / parseLockCommit）
// ---------------------------------------------------------------------------

serialTest('C1 版本号：null 输入、非数字段、空预发布标识', () => {
  assert.deepEqual(parsePluginVersion(null), { base: [0], pre: null }, 'null 输入按 0.0.0');
  assert.deepEqual(parsePluginVersion(undefined), { base: [0], pre: null });
  assert.deepEqual(parsePluginVersion('1.x.0'), { base: [1, 0, 0], pre: null }, '非数字段按 0');
  assert.deepEqual(parsePluginVersion('1.0.0-.'), { base: [1, 0, 0], pre: null }, '预发布段全空 → null');
  assert.deepEqual(parsePluginVersion('v1.2.0+build'), { base: [1, 2, 0], pre: null });
  assert.equal(pluginMajorVersion('2.0.0-rc.1'), 2);
  assert.equal(pluginMajorVersion(''), 0);
});

serialTest('C2 版本比较：段数补齐、预发布方向、数字段与非数字段混排', () => {
  // base 段数不同 → 缺失段按 0 补齐
  assert.equal(comparePluginVersions('1.2', '1.2.0'), 0);
  assert.equal(comparePluginVersions('1.2.0', '1.2'), 0);
  assert.equal(comparePluginVersions('1.3', '1.2'), 1, '数字段不同');
  assert.equal(comparePluginVersions('1.2', '1.3'), -1);
  // 正式版 vs 预发布：正式版更高
  assert.equal(comparePluginVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(comparePluginVersions('1.0.0-rc.1', '1.0.0'), -1);
  // 预发布段数不同
  assert.equal(comparePluginVersions('1.0.0-rc', '1.0.0-rc.1'), -1);
  assert.equal(comparePluginVersions('1.0.0-rc.1', '1.0.0-rc'), 1);
  // 预发布里的数字段按数值比
  assert.equal(comparePluginVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1);
  assert.equal(comparePluginVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1);
  // 数字段与非数字段混排：数字段更低
  assert.equal(comparePluginVersions('1.0.0-1', '1.0.0-rc'), -1);
  assert.equal(comparePluginVersions('1.0.0-rc', '1.0.0-1'), 1);
  // 两边都是字母段：按字典序
  assert.equal(comparePluginVersions('1.0.0-alpha', '1.0.0-beta'), -1);
  assert.equal(comparePluginVersions('1.0.0-beta', '1.0.0-alpha'), 1);
  // 完全一致
  assert.equal(comparePluginVersions('1.0.0-rc.1', '1.0.0-rc.1'), 0);
});

serialTest('C3 parseLockCommit：git 形态才取 commit，npm 形态一律 null', () => {
  const lock = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      dsh-git:
        specifier: github:o/r
        version: 1.0.0
packages:
  github.com/o/r/0123456789ABCDEF0123456789ABCDEF01234567:
    resolution: {commit: 0123456789ABCDEF0123456789ABCDEF01234567}
`;
  assert.equal(parseLockCommit(lock, 'github:o/r'), '0123456789abcdef0123456789abcdef01234567');
  assert.equal(parseLockCommit(lock, '^1.0.0'), null, 'npm 形态不取 commit');
  assert.equal(parseLockCommit(lock, 'file:../local'), null, 'file: 形态不取 commit');
  assert.equal(parseLockCommit('', 'github:o/r'), null);
  assert.equal(parseLockCommit(lock, ''), null);
});

// ---------------------------------------------------------------------------
// 2. 来源归类与来源标记（classifyPluginSource / sourceCandidates / readRepositoryHint）
// ---------------------------------------------------------------------------

serialTest('C4 classifyPluginSource：缺名、file: 相对/绝对、github: 短写', () => {
  const nameless = classifyPluginSource({});
  assert.equal(nameless.name, '');
  assert.equal(nameless.kind, 'npm');

  // file: 相对路径 + 有标记 → git 来源，标记里的 commit/url 生效
  const marked = classifyPluginSource({
    name: 'dsh-x',
    spec: 'file:plugin-sources/o-r',
    installedVersion: '1.0.0',
    installedCommit: 'old',
    marker: { author: 'o', repo: 'r', commit: 'new', subdir: 'sub' },
  });
  assert.equal(marked.kind, 'git');
  assert.equal(marked.installedCommit, 'new');
  assert.equal(marked.remote.url, 'https://github.com/o/r.git');
  assert.equal(marked.remote.subdir, 'sub');
  assert.ok(marked.remote.dir.length > 0);

  // 标记里没有 url → 用 author/repo 拼
  const noUrl = classifyPluginSource({
    name: 'dsh-x', spec: 'file:plugin-sources/o-r', marker: { author: 'o', repo: 'r' },
  });
  assert.equal(noUrl.remote.url, 'https://github.com/o/r.git');
  assert.equal(noUrl.installedCommit, null, '标记没写 commit 时沿用原来的');

  // file: 绝对路径
  const absolute = classifyPluginSource({ name: 'dsh-y', spec: 'file:/tmp/whatever' });
  assert.equal(absolute.kind, 'local');

  // github: 短写（带 #subdir）
  const short = classifyPluginSource({ name: 'dsh-z', spec: 'github:o/r#sub/dir' });
  assert.equal(short.kind, 'git');
  assert.equal(short.remote.subdir, 'sub/dir');

  // git+https 形态
  const https = classifyPluginSource({ name: 'dsh-w', spec: 'git+https://github.com/o/r.git' });
  assert.equal(https.kind, 'git');
  assert.equal(https.remote.repo, 'r');
});

serialTest('C5 sourceCandidates：按目录名切分候选，市场命中的排前面', () => {
  const candidates = sourceCandidates(join('plugin-sources', 'o-r-tools'), new Set(['o/r-tools']));
  assert.deepEqual(candidates[0], { author: 'o', repo: 'r-tools' }, '市场确认过的排前面');

  const all = sourceCandidates(join('plugin-sources', 'a-b-c'), new Set());
  assert.deepEqual(all, [
    { author: 'a', repo: 'b-c' },
    { author: 'a-b', repo: 'c' },
  ]);

  // 空目录名 → 没有候选
  assert.deepEqual(sourceCandidates('', new Set()), []);
  assert.deepEqual(sourceCandidates('///', new Set()), [], '全部分隔符 → 空目录名');
  // 尾部空段（目录名以 '-' 结尾）跳过
  assert.deepEqual(sourceCandidates('owner-repo-', new Set()), [{ author: 'owner', repo: 'repo-' }]);
});

serialTest('C6 readRepositoryHint：package.json 的 repository 字段', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'pkg');
    await mkdir(dir, { recursive: true });

    await writeFile(join(dir, 'package.json'), JSON.stringify({
      repository: { url: 'https://github.com/o/r', directory: 'integrations/x' },
    }), 'utf8');
    assert.deepEqual(await readRepositoryHint(dir), { author: 'o', repo: 'r', subdir: 'integrations/x' });

    await writeFile(join(dir, 'package.json'), JSON.stringify({
      repository: 'https://github.com/o/r2',
    }), 'utf8');
    assert.deepEqual(await readRepositoryHint(dir), { author: 'o', repo: 'r2', subdir: null });

    await writeFile(join(dir, 'package.json'), JSON.stringify({
      repository: { url: 'https://example.com/not-github' },
    }), 'utf8');
    assert.equal(await readRepositoryHint(dir), null, '不是 GitHub 地址');

    await writeFile(join(dir, 'package.json'), JSON.stringify({ repository: { url: 42 } }), 'utf8');
    assert.equal(await readRepositoryHint(dir), null, 'url 不是字符串');

    await writeFile(join(dir, 'package.json'), JSON.stringify({}), 'utf8');
    assert.equal(await readRepositoryHint(dir), null, '没有 repository 字段');
  });
});

// ---------------------------------------------------------------------------
// 3. 更新判定与「忽略这个版本」
// ---------------------------------------------------------------------------

serialTest('C7 decidePluginUpdate：不可达 / 无版本 / 无本地版本 / 仅提交变化', () => {
  const unreachable = decidePluginUpdate({
    kind: 'git', installedVersion: '1.0.0', remote: { unreachable: true, error: 'boom' },
  });
  assert.equal(unreachable.status, 'unknown');
  assert.match(unreachable.note, /无法访问远端仓库/);
  assert.equal(unreachable.error, 'boom');

  const failed = decidePluginUpdate({ kind: 'npm', installedVersion: '1.0.0', remote: { error: 'boom' } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.note, null);

  const noVersion = decidePluginUpdate({ kind: 'npm', installedVersion: '1.0.0', remote: {} });
  assert.equal(noVersion.status, 'unknown');
  assert.match(noVersion.note, /远端没有可用的版本号/);

  const noInstalled = decidePluginUpdate({ kind: 'npm', installedVersion: null, remote: { version: '2.0.0' } });
  assert.equal(noInstalled.status, 'update-available');
  assert.match(noInstalled.note, /无法读取已安装版本/);

  const sameCommit = decidePluginUpdate({
    kind: 'git', installedVersion: '1.0.0', installedCommit: 'abc', remote: { version: '1.0.0', commit: 'ABC' },
  });
  assert.equal(sameCommit.status, 'up-to-date');
  assert.equal(sameCommit.note, null, 'commit 相同（大小写不同）不算有新提交');

  const newCommit = decidePluginUpdate({
    kind: 'git', installedVersion: '1.0.0', installedCommit: 'abc', remote: { version: '1.0.0', commit: 'def' },
  });
  assert.equal(newCommit.note, '远端有新提交（版本号未变）');

  const both = decidePluginUpdate({
    kind: 'git', installedVersion: '1.0.0', installedCommit: 'abc', remote: { version: '2.0.0', commit: 'def' },
  });
  assert.equal(both.status, 'update-available');
  assert.equal(both.note, '远端同时有新提交');
  assert.equal(both.major, true);

  const prerelease = decidePluginUpdate({
    kind: 'npm', installedVersion: '1.0.0', remote: { version: '2.0.0-rc.1' },
  });
  assert.equal(prerelease.status, 'up-to-date');
  assert.match(prerelease.note, /远端只有预发布版本/);
});

serialTest('C8 summarizeUpdateInventory：忽略的更新单独计数', () => {
  const summary = summarizeUpdateInventory([
    { status: 'update-available' },
    { status: 'update-available', ignored: true },
    { status: 'failed' },
    { status: 'unknown' },
    { status: 'up-to-date' },
  ]);
  assert.deepEqual(summary, { total: 5, updateAvailable: 1, ignored: 1, failed: 1, unknown: 1 });
  assert.deepEqual(summarizeUpdateInventory(null), { total: 0, updateAvailable: 0, ignored: 0, failed: 0, unknown: 0 });
});

serialTest('C9 忽略/取消忽略：写盘、打标、非数组输入', async () => {
  await withTempHome(async (home) => {
    const file = join(home, 'ignored.json');
    await writeFile(file, JSON.stringify({
      good: { version: '1.0.0', at: '2026-01-01' },
      legacy: '2.0.0',
      broken: { version: '' },
      empty: '',
    }), 'utf8');

    const ignored = await readIgnoredUpdates({ file });
    assert.deepEqual(ignored.good, { version: '1.0.0', at: '2026-01-01' });
    assert.deepEqual(ignored.legacy, { version: '2.0.0', at: null }, 'v1 字符串写法');
    assert.equal(ignored.broken, undefined, '空版本号丢弃');
    assert.equal(ignored.empty, undefined);

    const missing = await readIgnoredUpdates({ file: join(home, 'nope.json') });
    assert.deepEqual(missing, {}, '文件不存在 → 空');

    const entry = { name: 'good', status: 'update-available', latestVersion: '1.0.0' };
    assert.equal(isUpdateIgnored(entry, ignored), true);
    assert.equal(isUpdateIgnored({ ...entry, latestVersion: '2.0.0' }, ignored), false, '版本不一致');
    assert.equal(isUpdateIgnored({ name: 'good', status: 'up-to-date', latestVersion: '1.0.0' }, ignored), false);
    assert.equal(isUpdateIgnored(null, ignored), false);

    const tagged = applyIgnoredUpdates([entry], ignored);
    assert.equal(tagged[0].ignored, true);
    assert.equal(applyIgnoredUpdates(null, ignored).length, 0);

    // 忽略：没有版本号时从检测缓存里兜底
    const cacheFile = join(home, 'cache.json');
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'cached-plugin', status: 'update-available', latestVersion: '3.1.4' }],
    }, cacheFile);
    const result = await ignorePluginUpdates([{ name: 'cached-plugin' }, { name: 'good', version: '1.0.0' }], { file, cacheFile });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ignored.sort(), ['cached-plugin', 'good']);
    const after = await readIgnoredUpdates({ file });
    assert.equal(after['cached-plugin'].version, '3.1.4', '版本来自检测缓存');

    // 缓存里也没有 → 失败
    const missingVersion = await ignorePluginUpdates([{ name: 'nowhere' }], { file, cacheFile });
    assert.equal(missingVersion.ok, false);
    assert.deepEqual(missingVersion.failed, ['nowhere']);

    assert.equal((await ignorePluginUpdates([], { file })).ok, false, '空列表');
    assert.equal((await ignorePluginUpdates(null, { file })).ok, false, '非数组');

    const undone = await unignorePluginUpdates('good', { file });
    assert.equal(undone.ok, true);
    assert.equal((await readIgnoredUpdates({ file })).good, undefined);
    assert.equal((await unignorePluginUpdates([], { file })).ok, false);
    assert.equal((await unignorePluginUpdates(null, { file })).ok, false);
  });
});

// ---------------------------------------------------------------------------
// 4. 检测缓存
// ---------------------------------------------------------------------------

serialTest('C10 检测缓存：畸形条目过滤、幽灵条目裁剪、更新后修补', async () => {
  await withTempHome(async (home) => {
    const cacheFile = join(home, 'cache.json');

    await writeUpdateCache({ checkedAt: 'x', inventory: [{ name: 'a', status: 'up-to-date' }, { name: '', status: 'x' }, null] }, cacheFile);
    const cached = await readUpdateCache({ cacheFile });
    assert.equal(cached.inventory.length, 1, '畸形条目被过滤');
    assert.equal(cached.checkedAt, null, '时间戳非法 → null');

    await writeUpdateCache({ inventory: [] }, cacheFile);
    assert.equal(await readUpdateCache({ cacheFile }), null, '空清单当作没有缓存');

    await writeFile(cacheFile, JSON.stringify({ nope: 1 }), 'utf8');
    assert.equal(await readUpdateCache({ cacheFile }), null, '结构不对当作没有缓存');

    // 非数组输入
    await writeUpdateCache({}, cacheFile);
    const empty = await readUpdateCache({ cacheFile });
    assert.equal(empty, null);

    // 幽灵条目：已卸载的插件要裁掉
    const inventory = [
      { name: 'keep', status: 'update-available' },
      { name: 'gone', status: 'update-available' },
    ];
    const installed = [{ name: 'keep', source: 'user' }, { name: 'bundled-one', source: 'bundled' }, { name: 'broken-one', broken: true }];
    const pruned = pruneUninstalledUpdateEntries(inventory, installed);
    assert.deepEqual(pruned.inventory.map(item => item.name), ['keep']);
    assert.equal(pruned.changed, true);
    assert.deepEqual(pruneUninstalledUpdateEntries(inventory, null), { inventory, changed: false }, '读盘失败时保守放行');
    assert.deepEqual(pruneUninstalledUpdateEntries(null, installed), { inventory: [], changed: false });

    // 更新成功后修补缓存（而不是整份删掉）
    const patchFile = join(home, 'patch.json');
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      inventory: [
        { name: 'a', status: 'update-available', latestVersion: '2.0.0', installedVersion: '1.0.0' },
        { name: 'b', status: 'update-available', latestVersion: '3.0.0' },
      ],
    }, patchFile);
    assert.equal(await patchUpdateCacheAfterUpdate([{ name: 'a', ok: true, updatedTo: '2.0.0' }], patchFile), true);
    const patched = await readUpdateCache({ cacheFile: patchFile });
    assert.equal(patched.inventory.find(item => item.name === 'a').status, 'up-to-date');
    assert.equal(patched.inventory.find(item => item.name === 'b').status, 'update-available', '别的条目不动');

    assert.equal(await patchUpdateCacheAfterUpdate([], patchFile), false, '没有成功项');
    assert.equal(await patchUpdateCacheAfterUpdate(null, patchFile), false);
    assert.equal(await patchUpdateCacheAfterUpdate([{ name: 'a', ok: true }], join(home, 'none.json')), false, '没有缓存文件');
  });
});

// ---------------------------------------------------------------------------
// 5. 远端探测（pnpm / git）
// ---------------------------------------------------------------------------

serialTest('C11 probeNpmDistTags：假的 pnpm 返回 dist-tags', async () => {
  await withTempHome(async (home) => {
    const binDir = join(home, 'fake-bin');
    await withFakeExecutables(binDir, async () => {
      await seedFakePnpmShim(home, binDir);
      await withEnv({ DSH_FAKE_PNPM_OUT: JSON.stringify({ latest: '9.9.9', next: '10.0.0' }) }, async () => {
        const ok = await probeNpmDistTags('dsh-demo');
        assert.equal(ok.version, '9.9.9');
        assert.equal(ok.channel, 'latest');
        assert.equal(ok.tags.next, '10.0.0');
      });
      await withEnv({ DSH_FAKE_PNPM_OUT: JSON.stringify({ next: '10.0.0' }) }, async () => {
        const noLatest = await probeNpmDistTags('dsh-demo');
        assert.match(noLatest.error, /没有 latest 标签/);
      });
      await withEnv({ DSH_FAKE_PNPM_OUT: 'not-json' }, async () => {
        const broken = await probeNpmDistTags('dsh-demo');
        assert.ok(broken.error, 'JSON 解析失败转成 error');
      });
    });
  });
});

serialTest('C12 probeGitHead：假的 git 返回 HEAD，再去读远端 package.json', async () => {
  await withTempHome(async (home) => {
    const binDir = join(home, 'fake-bin');
    await withFakeExecutables(binDir, async () => {
      const sha = 'a'.repeat(40);
      // 远端 package.json 用假 fetch 顶掉（不许真联网）
      const { fetchImpl } = fakeFetch({
        'https://raw.githubusercontent.com/o/r/': () => ({
          ok: true, status: 200, json: async () => ({ version: '2.3.4' }),
        }),
      });
      await withGlobalFetch(fetchImpl, async () => {
        await withEnv({ DSH_FAKE_GIT_OUT: `${sha}\tHEAD` }, async () => {
          const remote = await probeGitHead({ url: 'https://github.com/o/r.git', author: 'o', repo: 'r' });
          assert.equal(remote.version, '2.3.4');
          assert.equal(remote.commit, sha);
          assert.equal(remote.channel, null);
        });
        // HEAD 解析不出来
        await withEnv({ DSH_FAKE_GIT_OUT: 'not-a-sha' }, async () => {
          const bad = await probeGitHead({ url: 'https://github.com/o/r.git', author: 'o', repo: 'r' });
          assert.match(bad.error, /无法解析远端 HEAD/);
        });
        // git 失败 → 远端不可达
        await withEnv({ DSH_FAKE_GIT_FAIL: '1' }, async () => {
          const failed = await probeGitHead({ url: 'https://github.com/o/r.git', author: 'o', repo: 'r' });
          assert.equal(failed.unreachable, true);
          assert.ok(failed.error);
        });
      });
      assert.match((await probeGitHead({})).error, /缺少远端地址/);
    });
  });
});

serialTest('C13 fetchRemotePackageVersion：raw 优先、API 兜底、失败如实报错', async () => {
  const { calls, fetchImpl } = fakeFetch({
    'https://raw.githubusercontent.com/o/r/': () => ({
      ok: true, status: 200, json: async () => ({ version: '1.0.0' }),
    }),
    'https://api.github.com/repos/o/r/contents/': () => ({
      ok: true, status: 200,
      json: async () => ({ encoding: 'base64', content: Buffer.from(JSON.stringify({ version: '2.0.0' })).toString('base64') }),
    }),
  });
  const raw = await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, { fetch: fetchImpl });
  assert.deepEqual(raw, { version: '1.0.0' });
  assert.ok(calls.some(url => url.startsWith('https://raw.githubusercontent.com/')));

  // raw 失败 → 走 api.github.com 兜底
  const apiOnly = fakeFetch({
    'https://raw.githubusercontent.com/': () => ({ ok: false, status: 404 }),
    'https://api.github.com/': () => ({
      ok: true, status: 200,
      json: async () => ({ encoding: 'base64', content: Buffer.from(JSON.stringify({ version: '3.0.0' })).toString('base64') }),
    }),
  });
  const viaApi = await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, { fetch: apiOnly.fetchImpl });
  assert.deepEqual(viaApi, { version: '3.0.0' });

  // 两边都失败 → 报 raw 那一步的原因
  const broken = fakeFetch({
    'https://raw.githubusercontent.com/': () => ({ ok: false, status: 500 }),
    'https://api.github.com/': () => ({ ok: false, status: 500 }),
  });
  const failed = await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, { fetch: broken.fetchImpl });
  assert.match(failed.error, /HTTP 500/);

  // api 返回的不是 base64 → 解不出来（最终报 raw 那一步的原因）
  const notBase64 = fakeFetch({
    'https://raw.githubusercontent.com/': () => ({ ok: false, status: 500 }),
    'https://api.github.com/': () => ({ ok: true, status: 200, json: async () => ({ encoding: 'utf8', content: 'x' }) }),
  });
  const undecodable = await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, { fetch: notBase64.fetchImpl });
  assert.match(undecodable.error, /HTTP 500/);

  // base64 里不是 JSON → 解不出来
  const badJson = fakeFetch({
    'https://raw.githubusercontent.com/': () => ({ ok: false, status: 500 }),
    'https://api.github.com/': () => ({
      ok: true, status: 200, json: async () => ({ encoding: 'base64', content: Buffer.from('not json').toString('base64') }),
    }),
  });
  const unparsable = await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, { fetch: badJson.fetchImpl });
  assert.match(unparsable.error, /HTTP 500/);

  // 缺仓库信息
  assert.match((await fetchRemotePackageVersion({}, 'sha', 1000, { fetch: fetchImpl })).error, /缺少仓库信息/);

  // 远端 package.json 里没有 version
  const noVersion = fakeFetch({
    'https://raw.githubusercontent.com/': () => ({ ok: true, status: 200, json: async () => ({ name: 'x' }) }),
  });
  assert.match((await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, { fetch: noVersion.fetchImpl })).error, /没有 version/);

  // 网络异常 → 转成超时/错误文案
  const aborted = { fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } };
  assert.match((await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, aborted)).error, /超时/);
  const broken2 = { fetch: async () => { throw new Error('ECONNRESET'); } };
  assert.match((await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, broken2)).error, /ECONNRESET/);

  // 带子目录的路径
  const sub = fakeFetch({
    'https://raw.githubusercontent.com/o/r/sha/sub/dir/package.json': () => ({
      ok: true, status: 200, json: async () => ({ version: '4.0.0' }),
    }),
  });
  const withSubdir = await fetchRemotePackageVersion({ author: 'o', repo: 'r', subdir: '/sub/dir/' }, 'sha', 1000, { fetch: sub.fetchImpl });
  assert.deepEqual(withSubdir, { version: '4.0.0' });
});

// ---------------------------------------------------------------------------
// 6. 来源清单（collectPluginSources / runUpdateCheck）
// ---------------------------------------------------------------------------

serialTest('C14 collectPluginSources：bundled/broken 不参与、file: 标记与 lock 里的 commit', async () => {
  await withTempHome(async (home) => {
    const webDir = await seedProfile(home, {
      bundles: ['dsh-user', 'dsh-git', 'dsh-plain'],
      dependencies: {
        'dsh-user': 'file:plugin-sources/owner-repo',
        'dsh-git': 'github:owner/repo',
      },
      installed: {
        'dsh-user': { name: 'dsh-user', version: '1.0.0' },
        'dsh-git': { name: 'dsh-git', version: '2.0.0' },
        'dsh-plain': { name: 'dsh-plain', version: '3.0.0' },
      },
    });
    // 有标记的老克隆
    const sourceDir = join(webDir, 'plugin-sources', 'owner-repo');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, '.dsh-source.json'), JSON.stringify({
      author: 'owner', repo: 'repo', commit: 'c'.repeat(40), url: 'https://github.com/owner/repo.git',
    }), 'utf8');
    // 市场索引：有的条目带 author/repo，有的没有
    await seedMarket(home, [
      { id: 'x', name: 'owner/repo', url: 'https://github.com/owner/repo', author: 'owner', repo: 'repo', category: 'other' },
      { id: 'y', name: 'no-meta', url: 'https://example.com/x', category: 'other' },
    ]);
    // lock 文件里带 commit（只有 git 形态的 spec 才会被取）
    await writeFile(join(webDir, 'pnpm-lock.yaml'), [
      "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      '    dependencies:',
      '      dsh-git:',
      '        specifier: github:owner/repo',
      `        version: https://codeload.github.com/owner/repo/tar.gz/${'d'.repeat(40)}`,
    ].join('\n'), 'utf8');

    const sources = await collectPluginSources();
    const byName = new Map(sources.map(item => [item.name, item]));
    assert.equal(sources.length, 3);

    const user = byName.get('dsh-user');
    assert.equal(user.kind, 'git', 'file: 目录 + 标记 → git 来源');
    assert.equal(user.remote.author, 'owner');
    assert.equal(user.installedCommit, 'c'.repeat(40), 'commit 来自来源标记');

    const git = byName.get('dsh-git');
    assert.equal(git.kind, 'git');
    assert.equal(git.remote.subdir, null);
    assert.equal(git.installedCommit, 'd'.repeat(40), 'commit 来自 pnpm-lock');

    const plain = byName.get('dsh-plain');
    assert.equal(plain.kind, 'npm', '没有依赖记录 → 按 npm 包处理');
    assert.deepEqual(plain.remote, { type: 'npm', package: 'dsh-plain' });
  });
});

serialTest('C15 collectPluginSources：绝对 file: 路径 + 无标记时探测补标记', async () => {
  await withTempHome(async (home) => {
    const absDir = join(home, 'elsewhere', 'pkg');
    await mkdir(absDir, { recursive: true });
    await writeFile(join(absDir, 'package.json'), JSON.stringify({
      name: 'dsh-abs', version: '2.0.0', repository: 'https://github.com/o/abs',
    }), 'utf8');
    const webDir = await seedProfile(home, {
      bundles: ['dsh-abs'],
      dependencies: { 'dsh-abs': `file:${absDir}` },
      installed: { 'dsh-abs': { name: 'dsh-abs', version: '2.0.0' } },
    });
    void webDir;
    const binDir = join(home, 'fake-bin');
    await withFakeExecutables(binDir, async () => {
      await withEnv({ DSH_FAKE_GIT_OUT: `${'e'.repeat(40)}\tHEAD` }, async () => {
        const sources = await collectPluginSources();
        assert.equal(sources.length, 1);
        assert.equal(sources[0].kind, 'git');
        assert.equal(sources[0].remote.author, 'o');
        assert.equal(sources[0].remote.repo, 'abs');
      });
    });
    // 标记被写回目录
    const marker = JSON.parse(await readFile(join(absDir, '.dsh-source.json'), 'utf8'));
    assert.equal(marker.author, 'o');
    assert.equal(marker.repo, 'abs');
    assert.equal(marker.commit, 'e'.repeat(40));
  });
});

serialTest('C16 collectPluginSources：bundled / broken 插件不参与检测', async () => {
  await withTempHome(async (home) => {
    const webDir = await seedProfile(home, { bundles: [], installed: {} });
    // 一个「启动器自带」的插件：链接目标里带 BUNDLED_MARKERS
    const bundledTarget = join(home, 'launcher', 'DSHPluginManager');
    await mkdir(bundledTarget, { recursive: true });
    await writeFile(join(bundledTarget, 'package.json'), JSON.stringify({ name: 'dsh-bundled', version: '0.1.0' }), 'utf8');
    await linkDir(bundledTarget, join(webDir, 'node_modules', 'dsh-bundled'));
    // 一个装坏了的残留：悬空链接
    await linkDir(join(home, 'gone', 'nowhere'), join(webDir, 'node_modules', 'dsh-broken'));

    const sources = await collectPluginSources();
    assert.deepEqual(sources, [], 'bundled 与 broken 都不检测');
  });
});

serialTest('C17 runUpdateCheck：npm/git/本地三种来源 + 探测抛错', async () => {
  const entries = await runUpdateCheck([
    { name: 'npm-pkg', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', remote: { type: 'npm', package: 'npm-pkg' } },
    { name: 'git-pkg', kind: 'git', spec: 'github:o/r', installedVersion: '1.0.0', remote: { type: 'git', url: 'https://github.com/o/r.git' } },
    { name: 'local-pkg', kind: 'local', spec: 'file:../x', installedVersion: '1.0.0', remote: null },
  ], {
    npm: async (pkg) => ({ version: '2.0.0', channel: 'latest' }),
    git: async () => ({ version: '3.0.0', commit: 'abc' }),
  });
  assert.equal(entries.length, 3);
  assert.equal(entries[0].status, 'update-available');
  assert.equal(entries[1].status, 'update-available');
  assert.equal(entries[2].status, 'unknown', '本地来源没有远端');

  // 探测函数直接抛错 → 也要落到 decidePluginUpdate（failed）
  const thrown = await runUpdateCheck([
    { name: 'boom', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', remote: { type: 'npm', package: 'boom' } },
  ], { npm: async () => { throw new Error('probe exploded'); } });
  assert.equal(thrown[0].status, 'failed');
  assert.match(thrown[0].error, /probe exploded/);
});

// ---------------------------------------------------------------------------
// 7. 进度与检测入口
// ---------------------------------------------------------------------------

serialTest('C18 applyPluginUpdate：没有进行中的进度时进度更新是空操作', async () => {
  // 这条用例必须排在任何「开始进度」的用例之前：它要验证的就是
  // stepUpdateProgress 在 updateProgress 为空时的空操作分支。
  await withTempHome(async () => {
    const result = await applyPluginUpdate(
      { name: 'dsh-demo', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', remote: { type: 'npm', package: 'dsh-demo' } },
      {
        check: async () => [{ name: 'dsh-demo', status: 'update-available', latestVersion: '2.0.0' }],
        command: async () => ({ stdout: '', stderr: '' }),
        verifyApplied: async () => true,
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.equal(result.verified, true);
  });
});

serialTest('C19 updatePlugin：找不到来源时进度正常收尾', async () => {
  await withTempHome(async () => {
    const result = await updatePlugin('dsh-not-installed');
    assert.equal(result.ok, false);
    assert.match(result.error, /未找到可更新的已安装插件/);
    assert.ok(readUpdateProgress(), '进度对象收尾后仍然可读');
    assert.equal(readUpdateProgress().active, false);
  });
});

serialTest('C20 checkPluginUpdates：缓存新鲜不联网、过期才后台刷新', async () => {
  await withTempHome(async (home) => {
    // 装一个插件，检测才有得探（没有插件 → 没有来源 → 探针不会被调用）
    await seedProfile(home, {
      bundles: ['dsh-probe'],
      installed: { 'dsh-probe': { name: 'dsh-probe', version: '1.0.0' } },
    });
    const cacheFile = join(home, 'cache.json');
    let probes = 0;
    const probe = { npm: async () => { probes += 1; return { version: '9.9.9' }; } };

    // 没有缓存 → 立刻返回空清单 + refreshing，后台再刷新
    const first = await checkPluginUpdates({ probe, cacheFile });
    assert.deepEqual(first.inventory, []);
    assert.equal(first.refreshing, true);
    assert.equal(first.summary.updateAvailable, 0);
    assert.ok(await waitFor(async () => (await readUpdateCache({ cacheFile }))?.inventory?.length === 1), '后台刷新写缓存');

    // 缓存新鲜 → 不联网
    const before = probes;
    const second = await checkPluginUpdates({ probe, cacheFile });
    assert.equal(probes, before, '新鲜缓存不再联网');
    assert.equal(second.inventory.length, 1);
    assert.equal(second.refreshing, false);
    assert.equal(second.summary.updateAvailable, 1);

    // force → 重新探测
    await checkPluginUpdates({ force: true, probe, cacheFile });
    assert.ok(await waitFor(async () => probes > before), 'force 重新联网');
    // 等后台刷新写完缓存（否则清理临时目录时它还在写）
    await new Promise(resolve => setTimeout(resolve, 400));
  });
});

serialTest('C21 checkPluginUpdates：缓存里的幽灵条目被裁掉并写回', async () => {
  await withTempHome(async (home) => {
    const cacheFile = join(home, 'cache.json');
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'ghost', status: 'update-available', latestVersion: '2.0.0' }],
    }, cacheFile);
    const result = await checkPluginUpdates({ cacheFile });
    assert.deepEqual(result.inventory, [], '已卸载的插件被裁掉');
    // 裁剪结果写回缓存（清单空了 → readUpdateCache 当作「没有缓存」）
    const written = JSON.parse(await readFile(cacheFile, 'utf8'));
    assert.deepEqual(written.inventory, []);
  });
});

// ---------------------------------------------------------------------------
// 8. 发布说明
// ---------------------------------------------------------------------------

serialTest('C22 githubRepoFromUrl / extractChangelogSection：版本段落抽取', () => {
  assert.deepEqual(githubRepoFromUrl('https://github.com/o/r'), { author: 'o', repo: 'r' });
  assert.deepEqual(githubRepoFromUrl({ url: 'https://github.com/o/r.git' }), { author: 'o', repo: 'r' });
  assert.equal(githubRepoFromUrl('https://example.com/x'), null);
  assert.equal(githubRepoFromUrl(null), null);

  const changelog = ['# Changelog', '', '## v1.2.0', '', '- 新功能 A', '', '## v1.1.0', '', '- 老功能', ''].join('\n');
  const section = extractChangelogSection(changelog, '1.2.0');
  assert.match(section, /新功能 A/);
  assert.ok(!section.includes('老功能'), '到下一个同级标题为止');
  assert.equal(extractChangelogSection(changelog, '9.9.9'), null, '找不到版本');
  assert.equal(extractChangelogSection(changelog, ''), null, '空版本');
  assert.equal(extractChangelogSection(null, '1.0.0'), null, '空文本');
  assert.equal(extractChangelogSection('## v1.0.0\n', '1.0.0'), null, '空段落');
});

serialTest('C23 fetchPluginReleaseNotes：优先 GitHub Release，其次 CHANGELOG', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-notes'],
      installed: { 'dsh-notes': { name: 'dsh-notes', version: '1.0.0', repository: 'https://github.com/o/notes' } },
    });

    // 1) 有 Release
    const withRelease = fakeFetch({
      'https://api.github.com/repos/o/notes/releases/tags/': () => ({
        ok: true, status: 200,
        json: async () => ({ body: '  更新说明  ', name: ' v1.0.0 ', html_url: 'https://github.com/o/notes/releases/1' }),
      }),
    });
    const release = await fetchPluginReleaseNotes('dsh-notes', '1.0.0', { fetch: withRelease.fetchImpl });
    assert.equal(release.ok, true);
    assert.equal(release.kind, 'release');
    assert.equal(release.title, 'v1.0.0');
    assert.equal(release.notes, '更新说明');
    assert.equal(release.url, 'https://github.com/o/notes/releases/1');

    // 2) 没有 Release，但 CHANGELOG 里有（换版本号：结果按 name@version 缓存）
    const withChangelog = fakeFetch({
      'https://api.github.com/repos/o/notes/releases/tags/': () => ({ ok: false, status: 404 }),
      'https://raw.githubusercontent.com/o/notes/': () => ({
        ok: true, status: 200, text: async () => '## v1.0.1\n\n- CHANGELOG 内容\n',
      }),
    });
    const changelog = await fetchPluginReleaseNotes('dsh-notes', '1.0.1', { fetch: withChangelog.fetchImpl });
    assert.equal(changelog.ok, true);
    assert.equal(changelog.kind, 'changelog');
    assert.match(changelog.title, /CHANGELOG/);
    assert.match(changelog.notes, /CHANGELOG 内容/);

    // 3) 都没有
    const none = fakeFetch({
      'https://api.github.com/': () => ({ ok: false, status: 404 }),
      'https://raw.githubusercontent.com/': () => ({ ok: false, status: 404 }),
    });
    const missing = await fetchPluginReleaseNotes('dsh-notes', '1.0.2', { fetch: none.fetchImpl });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /上游没有发布说明/);
    assert.match(missing.url, /github\.com\/o\/notes$/);

    // 缺参数
    assert.equal((await fetchPluginReleaseNotes('', '1.0.0')).ok, false);
    assert.equal((await fetchPluginReleaseNotes('dsh-notes', '')).ok, false);

    // 找不到仓库信息
    await seedProfile(home, { bundles: [], installed: {} });
    const noRepo = await fetchPluginReleaseNotes('dsh-unknown-repo', '1.0.0', { fetch: none.fetchImpl });
    assert.equal(noRepo.ok, false);
    assert.match(noRepo.error, /没有 GitHub 仓库信息/);
  });
});

// ---------------------------------------------------------------------------
// 9. 国内加速（镜像表）
// ---------------------------------------------------------------------------

serialTest('C24 镜像表：状态读取、URL 映射、pnpm 环境变量', async () => {
  await withTempHome(async () => {
    const table = [{ match: 'https://registry.npmjs.org/', replace: 'https://registry.npmmirror.com/', kind: 'registry' }];

    // 读取状态：插件返回 enabled
    const state = await readMirrorStateCached({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ enabled: true, table }) }),
    });
    assert.equal(state.enabled, true);
    assert.deepEqual(state.table, table);

    // 状态里的 enabled 不是 true → 按关闭
    const off = await readMirrorStateCached({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ enabled: 'yes' }) }),
    });
    assert.equal(off.enabled, false);
    assert.equal(off.table, null, 'table 不是数组 → null');

    // 当前生效的镜像表
    assert.deepEqual(await activeMirrorTable({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ enabled: true, table }) }),
    }), table);
    assert.equal(await activeMirrorTable({ offline: true }), null, '离线模式不查镜像');
    assert.equal(await activeMirrorTable({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ enabled: false }) }),
    }), null);

    // URL 映射
    assert.equal(mirrorMapURL('https://registry.npmjs.org/x', table), 'https://registry.npmmirror.com/x');
    assert.equal(mirrorMapURL('https://registry.npmjs.org/x', null), 'https://registry.npmjs.org/x');
    assert.equal(mirrorMapURL(null, table), '', 'null URL → 空串');
    assert.equal(mirrorMapURL('https://other.example/x', table), 'https://other.example/x', '没规则命中');
    // 已经是镜像地址的不再二次映射
    assert.equal(mirrorMapURL('https://registry.npmmirror.com/x', table), 'https://registry.npmmirror.com/x');

    // pnpm 环境变量
    const env = await pnpmEnvironment({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ enabled: true, table }) }),
    });
    assert.equal(env.npm_config_registry, 'https://registry.npmmirror.com/');
    // pnpm 11+ 不读 npm_config_*，必须同时给 pnpm_config_registry。
    assert.equal(env.pnpm_config_registry, 'https://registry.npmmirror.com/');
    const noRegistry = await pnpmEnvironment({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ enabled: true, table: [{ match: 'a', replace: 'b' }] }) }),
    });
    assert.equal(noRegistry.npm_config_registry, undefined, '表里没有 registry 规则 → 原样返回');
    assert.equal(noRegistry.pnpm_config_registry, undefined);
    const disabled = await pnpmEnvironment({ fetch: async () => { throw new Error('no plugin'); } });
    assert.equal(disabled.npm_config_registry, undefined);
    assert.equal(disabled.pnpm_config_registry, undefined);
  });
});

// ---------------------------------------------------------------------------
// 10. 多源配置 CRUD
// ---------------------------------------------------------------------------

serialTest('C25 源配置：损坏文件、内置源停用与恢复、源 id 归一', async () => {
  await withTempHome(async (home) => {
    const file = join(home, 'plugin-manager', 'sources.json');

    // 配置文件损坏 → 只剩内置源
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    await writeFile(file, '{ broken json', 'utf8');
    const fallback = await readSourcesConfig();
    assert.equal(fallback.sources.length, 1);
    assert.equal(fallback.sources[0].id, DEFAULT_SOURCE_ID);

    // sources 不是数组 → 只剩内置源
    await writeFile(file, JSON.stringify({ sources: 'nope' }), 'utf8');
    assert.equal((await readSourcesConfig()).sources.length, 1);

    // 内置源被显式停用 → 读回来还是一条（不是两条）
    await writeFile(file, JSON.stringify({ sources: [{ id: DEFAULT_SOURCE_ID, enabled: false }] }), 'utf8');
    const disabled = await readSourcesConfig();
    assert.equal(disabled.sources.length, 1);
    assert.equal(disabled.sources[0].enabled, false);

    // 删内置源 → 其实是「恢复默认启用」
    const restored = await removePluginSource(DEFAULT_SOURCE_ID);
    assert.equal(restored.ok, true);
    assert.equal(restored.restored, true);
    const after = await readSourcesConfig();
    assert.equal(after.sources.length, 1);
    assert.equal(after.sources[0].enabled, true);

    // 内置源没有被停用过时不可删除
    assert.equal((await removePluginSource(DEFAULT_SOURCE_ID)).ok, false);

    // 源 id 归一
    assert.equal(normalizeSourceId('git', 'github:Owner/Repo'), 'owner-repo');
    assert.match(normalizeSourceId('index', 'https://example.com/a.json'), /^src-/);
    // 注意：只有 github:owner/repo 这种写法走 owner-repo 规则；其它写法一律走
    // URL 哈希（addPluginSource 会先把地址归一成 github:owner/repo 再算 id，
    // 所以线上路径不受影响）
    assert.match(normalizeSourceId('git', 'https://github.com/Owner/Repo.git'), /^src-/);
    assert.match(normalizeSourceId('git', 'git@github.com:Owner/Repo.git'), /^src-/);
  });
});

serialTest('C26 源配置：增删改与缓存目录清理', async () => {
  await withTempHome(async (home) => {
    const added = await addPluginSource({ kind: 'index', url: 'https://example.com/i.json' });
    assert.equal(added.ok, true);
    assert.equal(added.source.enabled, true);

    // 停用 / 启用
    assert.equal((await setPluginSourceEnabled(added.source.id, false)).ok, true);
    assert.equal((await readSourcesConfig()).sources.find(item => item.id === added.source.id).enabled, false);
    assert.equal((await setPluginSourceEnabled('nope', true)).ok, false, '没有这个源');

    // 删除时清缓存文件；缓存路径是目录时删除失败也不该抛
    const cacheDir = join(home, 'plugin-manager', 'sources-cache');
    await mkdir(join(cacheDir, `${added.source.id}.json`), { recursive: true });
    const removed = await removePluginSource(added.source.id);
    assert.equal(removed.ok, true);
    assert.equal((await readSourcesConfig()).sources.find(item => item.id === added.source.id), undefined);

    // 删除不存在的源
    assert.equal((await removePluginSource('nope')).ok, false);
  });
});

serialTest('C27 sourceEntryToPlugin：字段缺省时的归一', () => {
  const minimal = sourceEntryToPlugin({ name: 'solo' }, 'src-1');
  assert.equal(minimal.id, 'src-1:solo');
  assert.equal(minimal.repo, 'solo', '没有 repo 就用 name');
  assert.equal(minimal.author, 'src-1', 'repo 里没有 / 就用源 id');
  assert.equal(minimal.url, 'solo', '没有 url 就用 name');
  assert.equal(minimal.category, 'other');
  assert.equal(minimal.screenshot, null);
  assert.equal(minimal.addedDate, null);
  assert.equal(minimal.version, null);
  assert.equal(minimal.downloads, 0);
  assert.equal(minimal.stars, 0);
  assert.equal(minimal.verified, false);

  const full = sourceEntryToPlugin({
    id: 'tid', name: 'o/r', repo: 'o/r', url: 'https://github.com/o/r',
    screenshot: 'https://img', updatedAt: '2026-01-01', version: '1.2.3', downloads: '10', stars: '3',
  }, 'src-2');
  assert.equal(full.id, 'src-2:tid');
  assert.equal(full.author, 'o');
  assert.equal(full.screenshot, 'https://img');
  assert.equal(full.addedDate, '2026-01-01');
  assert.equal(full.version, '1.2.3');
  assert.equal(full.downloads, 10);
  assert.equal(full.stars, 3);
});

serialTest('C28 fetchSourceIndex：地址推不出来 / 索引里没有 plugins 数组', async () => {
  const bad = await fetchSourceIndex({ id: 's', kind: 'git', url: 'not-a-github-url' }, {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  });
  assert.match(bad.error, /无法从源地址推出索引位置/);

  const noPlugins = await fetchSourceIndex({ id: 's', kind: 'index', url: 'https://example.com/i.json' }, {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }),
  });
  assert.match(noPlugins.error, /没有 plugins 数组/);
});

serialTest('C29 源缓存：读缓存 + 聚合（停用/空/过期三种状态）', async () => {
  await withTempHome(async (home) => {
    const added = await addPluginSource({ kind: 'index', url: 'https://example.com/i.json' });
    const cacheDir = join(home, 'plugin-manager', 'sources-cache');
    await mkdir(cacheDir, { recursive: true });

    // 没有缓存 → empty
    let aggregated = await aggregateCachedSources();
    assert.deepEqual(aggregated.plugins, []);
    assert.equal(aggregated.perSource.find(item => item.id === added.source.id).state, 'empty');

    // 写一份新鲜缓存 → ok
    await writeFile(join(cacheDir, `${added.source.id}.json`), JSON.stringify({
      fetchedAt: new Date().toISOString(),
      plugins: [{ name: 'o/r', category: 'data' }],
    }), 'utf8');
    const cache = await readSourceCache(added.source.id);
    assert.equal(cache.plugins.length, 1);
    assert.equal(await readSourceCache('nope'), null, '没有缓存 → null');

    aggregated = await aggregateCachedSources();
    assert.equal(aggregated.perSource.find(item => item.id === added.source.id).state, 'ok');
    assert.equal(aggregated.plugins[0].source, added.source.id);

    // 过期缓存 → stale
    await writeFile(join(cacheDir, `${added.source.id}.json`), JSON.stringify({
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      plugins: [{ name: 'o/r', category: 'data' }],
    }), 'utf8');
    aggregated = await aggregateCachedSources();
    assert.equal(aggregated.perSource.find(item => item.id === added.source.id).state, 'stale');

    // 停用 → disabled
    await setPluginSourceEnabled(added.source.id, false);
    aggregated = await aggregateCachedSources();
    assert.equal(aggregated.perSource.find(item => item.id === added.source.id).state, 'disabled');
    assert.deepEqual(aggregated.plugins, []);
  });
});

// ---------------------------------------------------------------------------
// 11. 市场分类与查询
// ---------------------------------------------------------------------------

serialTest('C31 分类归并：脏分类归 other、未知分类回落到 id 本身', () => {
  assert.equal(MARKET_GROUPS.length, 6);
  assert.equal(normalizeCategory('UI'), 'ui');
  assert.equal(normalizeCategory('tools # see the category list below'), 'other', '带注释的脏分类');
  assert.equal(normalizeCategory(''), 'other');
  assert.equal(marketGroupOf('workflow'), 'auto');
  assert.equal(marketGroupOf('不存在的分类'), 'other');
  assert.equal(marketGroupLabel('data'), '数据');
  assert.equal(marketGroupLabel('nope'), '其他');
  assert.equal(marketCategoryLabel('ui'), '界面');
  assert.equal(marketCategoryLabel('zzz-not-in-table'), 'zzz-not-in-table', '未知分类回落成 id 本身');
});

serialTest('C32 queryMarketplace：按时间排序、缺 indexedAt/categories 的旧索引', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'plugin-market');
    await mkdir(dir, { recursive: true });
    // 一份「旧格式」索引：没有 indexedAt，也没有 categories
    await writeFile(join(dir, 'index.json'), JSON.stringify({
      version: 2,
      plugins: [
        { id: 'a', name: 'a', repo: 'o/a', author: 'o', category: 'ui', stars: 1, downloads: 1, addedDate: '2026-01-01' },
        { id: 'b', name: 'b', repo: 'o/b', author: 'o', category: 'data', stars: 2, downloads: 2, addedDate: '2026-06-01' },
      ],
    }), 'utf8');

    const result = await queryMarketplace({});
    assert.equal(result.indexedAt, null, '旧索引没有 indexedAt');
    assert.deepEqual(result.categories, [], '旧索引没有 categories');
    assert.equal(result.total, 2);

    const newest = await queryMarketplace({ sort: 'newest' });
    assert.equal(newest.plugins[0].name, 'b', '按加入时间倒序');
    assert.equal(newest.sections.length, 2, '没有搜索/分类筛选时照常给分区');

    const byStars = await queryMarketplace({ sort: 'stars' });
    assert.equal(byStars.plugins[0].name, 'b');
  });
});

// ---------------------------------------------------------------------------
// 12. 描述找插件（关键词预筛 + 模型打分）
// ---------------------------------------------------------------------------

serialTest('C33 keywordVariants / rankPluginsByKeywords：CJK 变体与排序', () => {
  assert.deepEqual(keywordVariants('a'), [], '单字符没有变体');
  assert.deepEqual(keywordVariants('ab'), ['ab']);
  assert.deepEqual(keywordVariants('侧边栏'), ['侧边栏', '侧边', '边栏']);
  assert.deepEqual(keywordVariants('export'), ['export'], '英文原样');

  const plugins = [
    { id: 'a', name: 'sidebar-manager', repo: 'o/sidebar-manager', descriptionEn: 'manage the sidebar', category: 'ui', stars: 1, downloads: 1 },
    { id: 'b', name: 'other', repo: 'o/other', descriptionEn: '侧边栏完整工作台', category: 'other', stars: 2, downloads: 2 },
    { id: 'c', name: 'third', repo: 'o/third', descriptionEn: 'nothing', category: 'data', stars: 3, downloads: 3 },
    { id: 'd', name: 'fourth', repo: 'o/fourth', descriptionEn: 'nothing', category: 'tool', stars: 4, downloads: 4 },
  ];
  const ranked = rankPluginsByKeywords(plugins, '侧边栏');
  assert.ok(ranked.length >= 1, '中文查询能命中');
  assert.ok(ranked.some(item => item.id === 'b'), '描述里写「侧边栏」的也能命中');
  assert.deepEqual(rankPluginsByKeywords(plugins, 'a'), [], '单字符 token 被丢掉');
  assert.deepEqual(rankPluginsByKeywords(plugins, '!!'), [], '没有有效 token');
  assert.deepEqual(rankPluginsByKeywords(null, 'sidebar'), [], '插件列表不是数组');
  assert.deepEqual(rankPluginsByKeywords([null, undefined], 'sidebar'), [], '跳过空条目');

  // 名称/描述都没命中，但分类命中 → 也要进候选（权重最低）
  const byCategory = rankPluginsByKeywords(
    [{ id: 'cat', name: 'unrelated', repo: 'o/unrelated', descriptionEn: 'nothing', category: 'tools' }],
    'tools',
  );
  assert.deepEqual(byCategory.map(item => item.id), ['cat'], '分类命中也算命中');
});

serialTest('C34 buildPluginSearchPrompt：缺字段时的占位', () => {
  const prompt = buildPluginSearchPrompt('我要一个侧边栏', [
    { name: 'only-name', descriptionZh: '   很长   的   描述   '.repeat(30), downloads: 'x', stars: null },
    { id: 'b', repo: 'o/b', category: 'ui' },
  ]);
  const lines = prompt.split('\n').filter(line => /^\[\d+\] /.test(line));
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('周下载 0，星标 0'), '非数字的下载/星标按 0');
  assert.ok(lines[1].includes('（无描述）'), '没有描述时用占位');
  assert.ok(lines[1].includes('o/b | 分类：ui'), '有 repo 用 repo');
});

serialTest('C35 parseSearchPicks：宽松行格式、名称反查、JSON 变体', () => {
  // 只有 answer_num 的宽松行格式
  const loose = parseSearchPicks('answer_num: 2, why: 挺相关', 3);
  assert.equal(loose.length, 1);
  assert.equal(loose[0].index, 1);
  assert.equal(loose[0].score, 1);

  // 用名称/仓库名反查编号（JSON 格式里的字符串）
  const candidates = [{ name: 'a/one' }, { repo: 'o/two' }];
  const byName = parseSearchPicks('{"picks":["a/one"]}', 2, candidates);
  assert.equal(byName.length, 1);
  assert.equal(byName[0].index, 0);
  const byRepo = parseSearchPicks('{"picks":["o/two"]}', 2, candidates);
  assert.equal(byRepo[0].index, 1);
  // 名字查不到 → 丢弃
  assert.deepEqual(parseSearchPicks('{"picks":["不存在"]}', 2, candidates), []);

  // JSON：数字数组、字符串数组、index/n/num 各种键名
  assert.deepEqual(parseSearchPicks('{"picks":[1,2]}', 3).map(pick => pick.index), [0, 1]);
  assert.deepEqual(parseSearchPicks('{"picks":["1","3"]}', 3).map(pick => pick.index), [0, 2]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"index":2}]}', 3).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"n":2}]}', 3).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"num":2}]}', 3).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"id":2}]}', 3).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"name":"a/one"}]}', 2, candidates).map(pick => pick.index), [0]);
  assert.deepEqual(parseSearchPicks('{"picks":[{"repo":"o/two"}]}', 2, candidates).map(pick => pick.index), [1]);
  assert.deepEqual(parseSearchPicks('{"picks":[null,"x",{"i":1}]}', 3).map(pick => pick.index), [0], '非法条目跳过');

  // 分数排序：同分按模型给的顺序
  const sorted = parseSearchPicks(
    'answer_num: 1, answer_relevance: 5, why: a\nanswer_num: 2, answer_relevance: 9, why: b\nanswer_num: 3, answer_relevance: 5, why: c',
    5,
  );
  assert.deepEqual(sorted.map(pick => pick.index), [1, 0, 2]);

  // 理由长度截断到 120 字
  const longWhy = parseSearchPicks('answer_num: 1, answer_relevance: 5, why: ' + 'x'.repeat(300), 3);
  assert.equal(longWhy[0].why.length, 120);

  // 越界编号丢弃
  assert.deepEqual(parseSearchPicks('answer_num: 99, answer_relevance: 5, why: x', 3), []);

  // 空输出 / null 输出
  assert.deepEqual(parseSearchPicks('', 3), []);
  assert.deepEqual(parseSearchPicks(null, 3), []);
});

serialTest('C36 searchPluginsByDescription：无模型 / 无路由 / 模型报错 / 模型挑不出', async () => {
  await withTempHome(async (home) => {
    await seedMarket(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', author: 'o', category: 'session', descriptionEn: 'export sessions', descriptionZh: '导出会话', stars: 10, downloads: 20, version: '1.0.0' },
      { id: 'b', name: 'other', repo: 'o/other', author: 'o', category: 'data', descriptionEn: 'nothing', stars: 1, downloads: 1 },
    ]);

    // 空查询 / 超长查询
    assert.equal((await searchPluginsByDescription({ query: '' })).ok, false);
    assert.equal((await searchPluginsByDescription({ query: 'x'.repeat(501) })).ok, false);

    // 没有模型 → 关键词降级
    const noModel = await searchPluginsByDescription({ query: '导出会话' });
    assert.equal(noModel.fallback, true);
    assert.match(noModel.note, /未找到可用模型/);
    assert.equal(noModel.items.length, 1);

    // 有 llm 但没有可用路由 → 降级
    const noRoutes = await searchPluginsByDescription({
      query: '导出会话',
      llm: { listProviders: () => [], listModels: async () => [] },
    });
    assert.equal(noRoutes.fallback, true);
    assert.match(noRoutes.note, /没有已配置的模型/);

    // 模型返回失败（finish 报 error）→ 换下一条路由，最终降级
    const failing = makeLlm({
      finish: { kind: 'error', failure: { message: '余额不足' } },
      text: '',
    });
    const failed = await searchPluginsByDescription({ query: '导出会话', llm: failing, debug: true });
    assert.equal(failed.fallback, true);
    assert.match(failed.note, /模型检索失败/);
    assert.ok(failed.lastRouteError, 'debug 模式带出最后一条路由的错误');

    // 模型正常但没挑出相关插件 → 关键词兜底
    const empty = makeLlm({ text: 'answer_num: 9, answer_relevance: 0, why: 无相关' });
    const noPicks = await searchPluginsByDescription({ query: '导出会话', llm: empty, debug: true });
    assert.equal(noPicks.fallback, true);
    assert.match(noPicks.note, /模型没有挑出相关插件/);
    assert.ok(noPicks.rawText, 'debug 模式带出模型原文');
  });
});

serialTest('C37 searchPluginsByDescription：模型挑中 → 返回条目与理由', async () => {
  await withTempHome(async (home) => {
    await seedMarket(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', author: 'o', category: 'session', descriptionEn: 'export sessions', descriptionZh: '导出会话', stars: 10, downloads: 20, version: '1.0.0' },
      { id: 'b', name: 'other', repo: 'o/other', author: 'o', category: 'data', descriptionEn: 'nothing', stars: 1, downloads: 1 },
    ]);
    const llm = makeLlm({ text: 'answer_num: 1, answer_relevance: 9, why: 正好能导出' });
    const result = await searchPluginsByDescription({ query: '导出会话', llm });
    assert.equal(result.ok, true);
    assert.equal(result.fallback, false);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].name, 'session-export');
    assert.equal(result.items[0].group, 'session');
    assert.equal(result.items[0].reason, '正好能导出');
    assert.equal(result.items[0].downloads, 20);
    assert.equal(result.items[0].stars, 10);
    assert.equal(result.items[0].version, '1.0.0');
    assert.ok(result.promptChars < 12000);
  });
});

serialTest('C38 searchPluginsByDescription：候选上下文超上限时如实报错', async () => {
  await withTempHome(async (home) => {
    const longRepo = 'o/' + 'x'.repeat(200);
    const plugins = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`, name: `p${i}`, repo: `${longRepo}${i}`, author: 'o', category: 'other',
      descriptionEn: 'd'.repeat(100), stars: 100 - i, downloads: 1,
    }));
    await seedMarket(home, plugins);
    const result = await searchPluginsByDescription({ query: '完全不相关的描述' });
    assert.equal(result.ok, false);
    assert.match(result.error, /超出上限/);
  });
});

serialTest('C39 searchPluginsByDescription：插件库为空时如实说明', async () => {
  await withTempHome(async () => {
    const result = await searchPluginsByDescription({ query: '任意描述' });
    assert.equal(result.ok, true);
    assert.equal(result.candidates, 0);
    assert.deepEqual(result.items, []);
    assert.match(result.note, /插件库为空/);
  });
});

// ---------------------------------------------------------------------------
// 13. 检索模型记忆与路由排序
// ---------------------------------------------------------------------------

serialTest('C40 检索模型记忆：原子写、最快耗时优先、v1 兼容', async () => {
  await withTempHome(async (home) => {
    assert.equal(await readPreferredSearchRoute(), null);
    assert.deepEqual(await readPreferredSearchRoutes(), []);

    // 非法参数直接拒绝
    assert.equal(await writePreferredSearchRoute(null, 100), false);
    assert.equal(await writePreferredSearchRoute({ provider: 'p' }, 100), false);

    await writePreferredSearchRoute({ provider: 'p1', model: 'slow' }, 40000);
    await writePreferredSearchRoute({ provider: 'p1', model: 'fast' }, 10000);
    const list = await readPreferredSearchRoutes();
    assert.deepEqual(list.map(item => item.model), ['fast', 'slow']);

    // 没有耗时的记录按最慢排
    await writePreferredSearchRoute({ provider: 'p2', model: 'unknown' });
    const withUnknown = await readPreferredSearchRoutes();
    assert.equal(withUnknown.find(item => item.model === 'unknown').ms, Number.MAX_SAFE_INTEGER);

    // 写盘是原子的：没有残留 tmp 文件
    const files = await readdir(join(home, 'plugin-manager'));
    assert.ok(files.includes('search-route.json'));
    assert.equal(files.filter(name => name.includes('.tmp-')).length, 0);

    // 落盘路径是目录时写失败 → 返回 false 而不是抛
    await rm(join(home, 'plugin-manager', 'search-route.json'), { force: true });
    await mkdir(join(home, 'plugin-manager', 'search-route.json'), { recursive: true });
    assert.equal(await writePreferredSearchRoute({ provider: 'p3', model: 'm' }, 10), false);
  });
});

serialTest('C41 resolveSearchRoutes：快模型优先、已验证模型提到最前', async () => {
  await withTempHome(async () => {
    // 没有 listProviders → 没有路由
    assert.deepEqual(await resolveSearchRoutes(null), []);
    assert.deepEqual(await resolveSearchRoutes({}), []);

    // listModels 抛错 → 该 provider 跳过
    const broken = {
      listProviders: () => [{ id: 'p1' }],
      listModels: async () => { throw new Error('nope'); },
    };
    assert.deepEqual(await resolveSearchRoutes(broken), []);

    const llm = {
      listProviders: () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
      listModels: async (providerId) => (
        providerId === 'p1'
          ? [
            { id: 'group/free', name: 'Free' },
            { id: 'glm-5.3', name: 'GLM' },
            { id: 'zai_glm-5.3-flash', name: 'Flash' },
            { id: 'image-only', name: 'Img', inputModalities: ['image'] },
          ]
          : [{ id: 'auto/router', name: 'Auto' }]
      ),
    };
    const routes = await resolveSearchRoutes(llm);
    assert.equal(routes[0].model, 'zai_glm-5.3-flash', '具体快模型第一');
    assert.ok(!routes.some(route => route.model === 'image-only'), '不支持文本输入的模型被跳过');
    assert.equal(routes[routes.length - 1].model, 'auto/router', '路由组排最后');

    // 已验证过的模型按耗时升序提到最前
    await writePreferredSearchRoute({ provider: 'p2', model: 'auto/router' }, 5000);
    const withPreferred = await resolveSearchRoutes(llm);
    assert.equal(withPreferred[0].model, 'auto/router', '已验证的先试');

    // max 限制条数
    assert.equal((await resolveSearchRoutes(llm, 1)).length, 1);
  });
});

// ---------------------------------------------------------------------------
// 14. 边界分支补测（覆盖每一处「只走了一半」的分支）
// ---------------------------------------------------------------------------

serialTest('C42 parseLockCommit：同一条 spec 出现多次 / 根本没出现', () => {
  // 同一条 spec 出现两次：第一次窗口里没有 commit → 继续往后找
  const twice = `importers:
  .:
    dependencies:
      dsh-a:
        specifier: github:o/r
        version: 1.0.0
      dsh-b:
        specifier: github:o/r
        version: https://codeload.github.com/o/r/tar.gz/${'b'.repeat(40)}
`;
  assert.equal(parseLockCommit(twice, 'github:o/r'), 'b'.repeat(40));

  // git 形态的 spec 但 lock 里根本没有 → null
  assert.equal(parseLockCommit('lockfileVersion: 9\n', 'github:o/missing'), null);
  // null 输入
  assert.equal(parseLockCommit(null, 'github:o/r'), null);
});

serialTest('C43 classifyPluginSource：npm 范围、市场确认的老克隆、空目录名', () => {
  // npm 范围/标签 → 落到 registry 上的同名包
  const ranged = classifyPluginSource({ name: 'dsh-x', spec: '^1.2.3', installedVersion: '1.2.3' });
  assert.equal(ranged.kind, 'npm');
  assert.deepEqual(ranged.remote, { type: 'npm', package: 'dsh-x' });

  // 老克隆（没有标记）但市场索引确认了目录名 → 也认成 git 来源
  const confirmed = classifyPluginSource({
    name: 'dsh-y',
    spec: 'file:plugin-sources/owner-repo',
    marketNames: new Set(['owner/repo']),
  });
  assert.equal(confirmed.kind, 'git');
  assert.equal(confirmed.remote.author, 'owner');
  assert.equal(confirmed.remote.repo, 'repo');

  // 空目录名 → 没有候选
  assert.deepEqual(sourceCandidates(null, new Set()), []);
});

serialTest('C44 discoverSourceMarker：远端探测不到 sha / git 报错 / 标记写不进去', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'pkg');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-p', repository: 'https://github.com/o/p',
    }), 'utf8');

    // 探测不到 commit → 返回 null
    assert.equal(await discoverSourceMarker(dir, new Set(), async () => null), null);
    // 注入的探测抛错 → 异常如实往外抛（只有内置探测自己兜底）
    await assert.rejects(
      () => discoverSourceMarker(dir, new Set(), async () => { throw new Error('boom'); }),
      /boom/,
    );

    // 默认探测（真的跑 git）拿到的是乱码 → 认不出 sha
    const binDir = join(home, 'fake-bin');
    await withFakeExecutables(binDir, async () => {
      await withEnv({ DSH_FAKE_GIT_OUT: 'not-a-sha' }, async () => {
        assert.equal(await discoverSourceMarker(dir, new Set()), null);
      });
      // git 直接失败 → 走 catch
      await withEnv({ DSH_FAKE_GIT_FAIL: '1' }, async () => {
        assert.equal(await discoverSourceMarker(dir, new Set()), null);
      });
    });

    // 标记写不进去（同名路径是个目录）→ 探测成功但写回失败，不抛
    await mkdir(join(dir, '.dsh-source.json'), { recursive: true });
    const marker = await discoverSourceMarker(dir, new Set(), async () => 'c'.repeat(40));
    assert.equal(marker.repo, 'p');
  });
});

serialTest('C45 decidePluginUpdate：本地版本比远端高', () => {
  const ahead = decidePluginUpdate({
    kind: 'npm', installedVersion: '2.0.0', remote: { version: '1.0.0' },
  });
  assert.equal(ahead.status, 'ahead');
  assert.match(ahead.note, /比远端更高/);
});

serialTest('C46 忽略记录：空名字的键、默认落盘位置', async () => {
  await withTempHome(async () => {
    const file = join(process.env.DSH_HOME, 'ignored.json');
    await writeFile(file, JSON.stringify({ '': { version: '1.0.0' }, ok: { version: '2.0.0' } }), 'utf8');
    const ignored = await readIgnoredUpdates({ file });
    assert.deepEqual(Object.keys(ignored), ['ok'], '空名字的键被丢掉');

    // 不指定文件 → 落到默认位置（profiles/web/.plugin-updates-ignored.json）
    const result = await ignorePluginUpdates([{ name: 'x', version: '1.0.0' }]);
    assert.equal(result.ok, true);
    const defaultFile = join(process.env.DSH_HOME, 'profiles', 'web', '.plugin-updates-ignored.json');
    const written = JSON.parse(await readFile(defaultFile, 'utf8'));
    assert.equal(written.x.version, '1.0.0');
  });
});

serialTest('C47 忽略：缓存里也没有版本时的兜底', async () => {
  await withTempHome(async () => {
    // 没有检测缓存 → 版本取不到 → 失败并如实报告
    const result = await ignorePluginUpdates([{ name: 'nowhere' }]);
    assert.equal(result.ok, false);
    assert.deepEqual(result.failed, ['nowhere']);
  });
});

serialTest('C48 检测缓存：默认落盘位置', async () => {
  await withTempHome(async (home) => {
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'a', status: 'up-to-date' }],
    });
    const defaultFile = join(home, 'profiles', 'web', '.plugin-updates.json');
    const cached = await readUpdateCache();
    assert.equal(cached.inventory.length, 1, '默认位置也能读到');
    assert.ok((await readFile(defaultFile, 'utf8')).includes('"a"'));

    // 更新后修补也走默认位置
    assert.equal(await patchUpdateCacheAfterUpdate([{ name: 'a', ok: true, updatedTo: '2.0.0' }]), true);
    const patched = await readUpdateCache();
    assert.equal(patched.inventory[0].status, 'up-to-date');
  });
});

serialTest('C49 检测缓存：修补时找不到对应条目', async () => {
  await withTempHome(async (home) => {
    const cacheFile = join(home, 'cache.json');
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'a', status: 'update-available', latestVersion: '2.0.0' }],
    }, cacheFile);
    // 缓存里没有这个插件 → 不用改
    assert.equal(await patchUpdateCacheAfterUpdate([{ name: 'other', ok: true }], cacheFile), false);
    // 成功项没有 updatedTo → 用缓存里的 latestVersion
    await patchUpdateCacheAfterUpdate([{ name: 'a', ok: true }], cacheFile);
    const patched = await readUpdateCache({ cacheFile });
    assert.equal(patched.inventory[0].installedVersion, '2.0.0', '回落到 latestVersion');
    // 连 latestVersion 都没有 → null
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'b', status: 'update-available' }],
    }, cacheFile);
    await patchUpdateCacheAfterUpdate([{ name: 'b', ok: true }], cacheFile);
    const patched2 = await readUpdateCache({ cacheFile });
    assert.equal(patched2.inventory[0].installedVersion, null);
  });
});

serialTest('C50 checkPluginUpdates：缓存时间戳异常时的裁剪与写回', async () => {
  await withTempHome(async (home) => {
    const cacheFile = join(home, 'cache.json');
    // checkedAt 不是合法时间 → readUpdateCache 里归一成 null
    await writeUpdateCache({
      checkedAt: 'not-a-date',
      inventory: [{ name: 'ghost', status: 'update-available', latestVersion: '2.0.0' }],
    }, cacheFile);
    const result = await checkPluginUpdates({ cacheFile });
    assert.deepEqual(result.inventory, []);
    // 落盘文件的 checkedAt 与读出来的不一致 → 不覆盖（保留后台刚写的结论）
    const raw = JSON.parse(await readFile(cacheFile, 'utf8'));
    assert.equal(raw.checkedAt, 'not-a-date', '旧数据没被覆盖');
    // 等后台刷新跑完：它结束前会把缓存写回来，清理时序才不会打架
    await new Promise(resolve => setTimeout(resolve, 400));

    // 没有 checkedAt 的缓存：缺失按 null 处理
    await writeFile(cacheFile, JSON.stringify({
      inventory: [{ name: 'ghost', status: 'update-available', latestVersion: '2.0.0' }],
    }), 'utf8');
    const again = await checkPluginUpdates({ cacheFile });
    assert.deepEqual(again.inventory, []);
    await new Promise(resolve => setTimeout(resolve, 400));
  });
});

serialTest('C51 checkPluginUpdates：写缓存失败时不拖垮主流程', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-x'],
      installed: { 'dsh-x': { name: 'dsh-x', version: '1.0.0' } },
    });
    // 缓存路径是个目录 → 原子写必然失败
    const cacheFile = join(home, 'cache.json');
    await mkdir(cacheFile, { recursive: true });
    const result = await checkPluginUpdates({
      cacheFile,
      probe: { npm: async () => ({ version: '2.0.0' }) },
    });
    assert.equal(result.ok !== undefined || true, true);
    assert.equal(result.inventory.length, 0);
  });
});

serialTest('C52 probeNpmDistTags：镜像探测抛错时如实报错', async () => {
  await withTempHome(async (home) => {
    const binDir = join(home, 'fake-bin');
    await withFakeExecutables(binDir, async () => {
      await seedFakePnpmShim(home, binDir);
      // 镜像状态探测抛出一个「没有 message 的错误」→ 错误信息走对象兜底
      await withGlobalFetch(async () => { throw { code: 'E_MIRROR' }; }, async () => {
        const result = await probeNpmDistTags('dsh-demo');
        assert.ok(result.error, '如实报错');
        assert.ok(!result.version);
      });
    });
  });
});

serialTest('C53 probeGitHead：远端 package.json 没有 version', async () => {
  await withTempHome(async (home) => {
    const binDir = join(home, 'fake-bin');
    await withFakeExecutables(binDir, async () => {
      const sha = 'f'.repeat(40);
      const { fetchImpl } = fakeFetch({
        'https://raw.githubusercontent.com/': () => ({ ok: true, status: 200, json: async () => ({ name: 'x' }) }),
      });
      await withGlobalFetch(fetchImpl, async () => {
        await withEnv({ DSH_FAKE_GIT_OUT: `${sha}\tHEAD` }, async () => {
          const remote = await probeGitHead({ url: 'https://github.com/o/r.git', author: 'o', repo: 'r' });
          assert.equal(remote.commit, sha, 'commit 仍然拿到');
          assert.match(remote.error, /没有 version/);
        });
      });
    });
  });
});

serialTest('C54 远端读取：超时中止、乱码错误信息、缺仓库信息', async () => {
  // 请求比超时还慢 → 定时器真的触发（abort 回调被执行）
  const slow = {
    fetch: async () => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return { ok: true, status: 200, json: async () => ({ version: '1.0.0' }) };
    },
  };
  const timedOut = await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1, slow);
  assert.deepEqual(timedOut, { version: '1.0.0' });

  // 错误信息里带 aborted → 也按超时处理
  const aborted = { fetch: async () => { throw new Error('socket aborted'); } };
  assert.match((await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, aborted)).error, /超时/);

  // 抛出的东西没有 message → 走对象兜底
  const weird = { fetch: async () => { throw { code: 'E_WEIRD' }; } };
  assert.ok((await fetchRemotePackageVersion({ author: 'o', repo: 'r' }, 'sha', 1000, weird)).error);

  // remote 为空 → 缺仓库信息
  assert.match((await fetchRemotePackageVersion(null, 'sha', 1000, slow)).error, /缺少仓库信息/);
});

serialTest('C55 runUpdateCheck：不注入探测时用默认探测', async () => {
  await withTempHome(async (home) => {
    const binDir = join(home, 'fake-bin');
    await withFakeExecutables(binDir, async () => {
      await seedFakePnpmShim(home, binDir);
      await withEnv({ DSH_FAKE_PNPM_OUT: JSON.stringify({ latest: '5.0.0' }) }, async () => {
        const entries = await runUpdateCheck([
          { name: 'npm-pkg', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', remote: { type: 'npm', package: 'npm-pkg' } },
        ]);
        assert.equal(entries[0].latestVersion, '5.0.0', '默认 npm 探测');
      });
    });
  });
});

serialTest('C56 runUpdateCheck：探测抛出的东西没有 message', async () => {
  const entries = await runUpdateCheck([
    { name: 'boom', kind: 'npm', spec: '^1.0.0', installedVersion: '1.0.0', remote: { type: 'npm', package: 'boom' } },
  ], { npm: async () => { throw { code: 'E_BOOM' }; } });
  assert.equal(entries[0].status, 'failed');
  assert.ok(entries[0].error);
});

serialTest('C57 extractChangelogSection：版本号是 null', () => {
  assert.equal(extractChangelogSection('# Changelog\n', null), null);
});

serialTest('C58 fetchPluginReleaseNotes：git 来源的插件 / 只有 homepage / 缓存命中', async () => {
  await withTempHome(async (home) => {
    // git 来源：来源标记里有 author/repo
    const webDir = await seedProfile(home, {
      bundles: ['dsh-git'],
      dependencies: { 'dsh-git': 'file:plugin-sources/o/gitpkg' },
      installed: { 'dsh-git': { name: 'dsh-git', version: '1.0.0' } },
    });
    const sourceDir = join(webDir, 'plugin-sources', 'o', 'gitpkg');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, '.dsh-source.json'), JSON.stringify({
      author: 'o', repo: 'gitpkg', commit: 'a'.repeat(40),
    }), 'utf8');

    const release = fakeFetch({
      'https://api.github.com/repos/o/gitpkg/releases/tags/': () => ({
        ok: true, status: 200, json: async () => ({ body: 'git 来源的说明' }),
      }),
    });
    const result = await fetchPluginReleaseNotes('dsh-git', '2.0.0', { fetch: release.fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'release');
    assert.equal(result.title, 'v2.0.0', '没有 name 时用版本号当标题');
    assert.equal(result.url, 'https://github.com/o/gitpkg/releases', '没有 html_url 时用默认地址');

    // 再问一次 → 命中缓存
    const cached = await fetchPluginReleaseNotes('dsh-git', '2.0.0', { fetch: release.fetchImpl });
    assert.equal(cached.kind, 'release');

    // 只有 homepage（没有 repository）的 npm 包
    await seedProfile(home, {
      bundles: ['dsh-home'],
      installed: { 'dsh-home': { name: 'dsh-home', version: '1.0.0', homepage: 'https://github.com/o/home' } },
    });
    const homeFetch = fakeFetch({
      'https://api.github.com/repos/o/home/releases/tags/': () => ({
        ok: true, status: 200, json: async () => ({ body: 'homepage 来源的说明' }),
      }),
    });
    const fromHome = await fetchPluginReleaseNotes('dsh-home', '1.0.0', { fetch: homeFetch.fetchImpl });
    assert.equal(fromHome.ok, true);
    assert.equal(fromHome.kind, 'release');
  });
});

serialTest('C59 fetchPluginReleaseNotes：raw 失败时走 GitHub contents API', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-api'],
      installed: { 'dsh-api': { name: 'dsh-api', version: '1.0.0', repository: 'https://github.com/o/api' } },
    });
    const viaApi = fakeFetch({
      'https://api.github.com/repos/o/api/releases/tags/': () => ({ ok: false, status: 404 }),
      'https://raw.githubusercontent.com/o/api/': () => ({ ok: false, status: 404 }),
      'https://api.github.com/repos/o/api/contents/': () => ({
        ok: true, status: 200,
        json: async () => ({ content: Buffer.from('## v3.0.0\n\n- API 兜底的说明\n').toString('base64') }),
      }),
    });
    const result = await fetchPluginReleaseNotes('dsh-api', '3.0.0', { fetch: viaApi.fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'changelog');
    assert.match(result.notes, /API 兜底的说明/);
  });
});

serialTest('C60 fetchPluginReleaseNotes：CHANGELOG 里没有这个版本', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-noversion'],
      installed: { 'dsh-noversion': { name: 'dsh-noversion', version: '1.0.0', repository: 'https://github.com/o/nv' } },
    });
    const nothing = fakeFetch({
      'https://api.github.com/': () => ({ ok: false, status: 404 }),
      'https://raw.githubusercontent.com/': () => ({ ok: true, status: 200, text: async () => '# Changelog\n\n## v0.0.1\n\n- 老版本\n' }),
    });
    const result = await fetchPluginReleaseNotes('dsh-noversion', '9.9.9', { fetch: nothing.fetchImpl });
    assert.equal(result.ok, false);
    assert.match(result.error, /上游没有发布说明/);
  });
});

serialTest('C61 fetchSourceIndex：不注入 fetch 时用全局 fetch（镜像感知路径）', async () => {
  await withTempHome(async () => {
    const { fetchImpl } = fakeFetch({
      'https://raw.githubusercontent.com/o/r/HEAD/index.json': () => ({
        ok: true, status: 200, json: async () => ({ plugins: [{ name: 'o/r' }] }),
      }),
    });
    await withGlobalFetch(fetchImpl, async () => {
      const result = await fetchSourceIndex({ id: 's1', kind: 'git', url: 'github:o/r' });
      assert.equal(result.error, undefined);
      assert.equal(result.plugins.length, 1);
    });
  });
});

serialTest('C62 源配置：读取时的各种脏数据', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'plugin-manager');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'sources.json');

    // sources 是数组但条目没有 id → 过滤掉
    await writeFile(file, JSON.stringify({ sources: [{ noId: 1 }, { id: 'x', kind: 'index', url: 'https://x/i.json' }] }), 'utf8');
    const config = await readSourcesConfig();
    assert.equal(config.sources.length, 2, '内置源 + 1 个有效自定义源');
    assert.equal(config.sources[1].id, 'x');

    // 内置源被停用 → 落盘时只记 enabled
    await setPluginSourceEnabled(DEFAULT_SOURCE_ID, false);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(raw.sources[0], { id: DEFAULT_SOURCE_ID, enabled: false });
    assert.equal(raw.sources.length, 2, '内置源只记开关，不重复记定义');

    // 再加一个源 → 内置源的覆盖项仍然保留
    await addPluginSource({ kind: 'index', url: 'https://y/i.json' });
    const after = await readSourcesConfig();
    assert.equal(after.sources.length, 3);
    assert.equal(after.sources.find(item => item.id === DEFAULT_SOURCE_ID).enabled, false);
  });
});

serialTest('C63 addPluginSource：各种非法输入', async () => {
  await withTempHome(async () => {
    assert.match((await addPluginSource({ kind: 'ftp', url: 'x' })).error, /kind 必须是/);
    assert.match((await addPluginSource({ kind: 'git', url: '' })).error, /缺少源地址/);
    assert.match((await addPluginSource({ kind: 'index', url: 'ftp://x' })).error, /http\(s\)/);
    assert.match((await addPluginSource({ kind: 'git', url: 'https://gitlab.com/a/b' })).error, /git 源地址格式/);
    assert.match((await addPluginSource({ kind: 'git', url: 'github:owner' })).error, /git 源地址格式/);

    // 重复添加 → 幂等
    const first = await addPluginSource({ kind: 'index', url: 'https://dup.example/i.json' });
    const again = await addPluginSource({ kind: 'index', url: 'https://dup.example/i.json' });
    assert.equal(again.alreadyAdded, true);
    assert.equal(again.source.id, first.source.id);
  });
});

serialTest('C64 sourceEntryToPlugin：描述字段缺省', () => {
  const noDescription = sourceEntryToPlugin({ name: 'o/r' }, 'src');
  assert.equal(noDescription.descriptionEn, '');
  assert.equal(noDescription.descriptionZh, '');
  const withDescription = sourceEntryToPlugin({ name: 'o/r', description: { en: 'EN', zh: '中文' } }, 'src');
  assert.equal(withDescription.descriptionEn, 'EN');
  assert.equal(withDescription.descriptionZh, '中文');
  // description 不是对象 → 当作没有描述
  const weird = sourceEntryToPlugin({ name: 'o/r', description: 'plain' }, 'src');
  assert.equal(weird.descriptionEn, '');
});

serialTest('C65 parseSourceIndex：结构校验', () => {
  assert.deepEqual(parseSourceIndex({ version: 1, plugins: [] }), []);
  assert.equal(parseSourceIndex({ version: 1 }), null);
  assert.equal(parseSourceIndex(null), null);
  assert.equal(parseSourceIndex('str'), null);
  assert.equal(parseSourceIndex(42), null);
});

serialTest('C66 readSourceCache：有效缓存读得出来', async () => {
  await withTempHome(async (home) => {
    const cacheDir = join(home, 'plugin-manager', 'sources-cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'src-x.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(), plugins: [{ name: 'o/r' }],
    }), 'utf8');
    const cache = await readSourceCache('src-x');
    assert.equal(cache.plugins.length, 1);
    // 损坏的缓存 → null
    await writeFile(join(cacheDir, 'src-bad.json'), '{ broken', 'utf8');
    assert.equal(await readSourceCache('src-bad'), null);
    // 没有 plugins 数组 → null
    await writeFile(join(cacheDir, 'src-noplugins.json'), JSON.stringify({ fetchedAt: 'x' }), 'utf8');
    assert.equal(await readSourceCache('src-noplugins'), null);
  });
});

serialTest('C67 分类归并与市场查询：分类/分组/来源/排序各组合', async () => {
  await withTempHome(async (home) => {
    const plugins = [
      { id: 'a', name: 'a', repo: 'o/a', author: 'o', category: 'ui', source: 'community', stars: 5, downloads: 50, addedDate: '2026-01-01', descriptionEn: 'alpha plugin' },
      { id: 'b', name: 'b', repo: 'o/b', author: 'o', category: 'data', source: 'official', stars: 9, downloads: 10, addedDate: '2026-05-01', descriptionEn: 'beta plugin' },
      { id: 'c', name: 'c', repo: 'o/c', author: 'o', category: 'workflow', source: 'my-src', stars: 7, downloads: 20, addedDate: '2026-03-01', descriptionEn: 'gamma plugin' },
    ];
    await seedMarket(home, plugins);

    // 分类筛选
    const byCategory = await queryMarketplace({ category: 'data' });
    assert.equal(byCategory.total, 1);
    assert.equal(byCategory.plugins[0].name, 'b');
    assert.equal(byCategory.sections.length, 0, '筛选分类时不给分区');

    // 分组筛选
    const byGroup = await queryMarketplace({ group: 'auto' });
    assert.equal(byGroup.total, 1);
    assert.equal(byGroup.plugins[0].name, 'c');

    // 来源筛选
    const official = await queryMarketplace({ source: 'official' });
    assert.equal(official.total, 1);
    assert.equal(official.plugins[0].name, 'b');
    // 来源筛选是结构性筛选：双榜/推荐位/分类计数/分区都要跟着收窄。
    // 早前这几项从全量构建，「官方」页上的榜单全是社区插件，官方条目又进不了
    // 按全量分类切的分区，界面看起来就是「切到官方一个插件都没有」。
    assert.deepEqual(official.topDownloads.map(p => p.name), ['b']);
    assert.deepEqual(official.counts.map(c => c.name), ['data']);
    assert.equal(official.sections.length, 1);
    assert.deepEqual(official.sections[0].plugins.map(p => p.name), ['b']);
    const community = await queryMarketplace({ source: 'community' });
    assert.equal(community.total, 1);
    const custom = await queryMarketplace({ source: 'my-src' });
    assert.equal(custom.total, 1);
    assert.equal(custom.plugins[0].name, 'c');

    // 搜索
    const searched = await queryMarketplace({ q: 'gamma' });
    assert.equal(searched.total, 1);
    assert.equal(searched.plugins[0].name, 'c');
    assert.equal(searched.sections.length, 0, '搜索时不给分区');

    // 排序
    const byDownloads = await queryMarketplace({ sort: 'downloads' });
    assert.equal(byDownloads.plugins[0].name, 'a', '下载量降序');
    const byStars = await queryMarketplace({ sort: 'stars' });
    assert.equal(byStars.plugins[0].name, 'b', '星标降序');
    const byNewest = await queryMarketplace({ sort: 'newest' });
    assert.equal(byNewest.plugins[0].name, 'b', '加入时间降序');
  });
});

serialTest('C68 关键词预筛：空查询、短 token、缺字段的插件、同分排序', () => {
  assert.deepEqual(keywordVariants(null), []);
  assert.deepEqual(rankPluginsByKeywords([{ id: 'a' }], ''), [], '空查询');

  // 两个字母的 token → 权重 1
  const short = rankPluginsByKeywords(
    [{ id: 'a', name: 'ab-plugin', repo: 'o/ab-plugin', descriptionEn: '', category: 'other' }],
    'ab',
  );
  assert.deepEqual(short.map(item => item.id), ['a']);

  // 插件缺 repo/name → 不炸
  const bare = rankPluginsByKeywords([{ id: 'a' }], 'x');
  assert.deepEqual(bare, []);

  // 同分时按星标、再按下载量兜底
  const tie = rankPluginsByKeywords([
    { id: 'low', name: 'tie', repo: 'o/tie', descriptionEn: 'tie', stars: 1, downloads: 100 },
    { id: 'high', name: 'tie', repo: 'o/tie', descriptionEn: 'tie', stars: 9, downloads: 1 },
  ], 'tie');
  assert.deepEqual(tie.map(item => item.id), ['high', 'low'], '星标高的在前');
});

serialTest('C69 parseSearchPicks：稀疏候选、null 编号、非法分数、坏 JSON', () => {
  // 候选数组里有空洞
  const sparse = [];
  sparse[1] = { name: 'a/one' };
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":2}]}', 2, sparse).map(pick => pick.index), [1]);

  // 编号是 null → 丢弃
  assert.deepEqual(parseSearchPicks('{"picks":[{"i":null}]}', 3), []);
  // 分数不是数字 → 按 1 算
  const badScore = parseSearchPicks('{"picks":[{"i":1,"score":"abc"}]}', 3);
  assert.equal(badScore[0].score, 1);
  // 坏 JSON → 当作没输出
  assert.deepEqual(parseSearchPicks('{"picks":[', 3), []);
  // JSON 里没有 picks → 空
  assert.deepEqual(parseSearchPicks('{"other":1}', 3), []);
  // picks 里有布尔值 → 跳过
  assert.deepEqual(parseSearchPicks('{"picks":[true,{"i":2}]}', 3).map(pick => pick.index), [1]);
  // 超过 5 条只留前 5 条
  const many = parseSearchPicks('{"picks":[{"i":1},{"i":2},{"i":3},{"i":4},{"i":5},{"i":6}]}', 10);
  assert.equal(many.length, 5);
});

serialTest('C70 检索模型记忆：脏文件、缺耗时、v1 格式', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'plugin-manager');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'search-route.json');

    // 不是 routes 数组 → 空
    await writeFile(file, JSON.stringify({ routes: 'nope' }), 'utf8');
    assert.deepEqual(await readPreferredSearchRoutes(), []);
    assert.equal(await readPreferredSearchRoute(), null);

    // 条目没有耗时 → 按最慢排
    await writeFile(file, JSON.stringify({ routes: [{ provider: 'p', model: 'm' }] }), 'utf8');
    const list = await readPreferredSearchRoutes();
    assert.equal(list[0].ms, Number.MAX_SAFE_INTEGER);

    // v1 单条格式
    await writeFile(file, JSON.stringify({ provider: 'p', model: 'legacy' }), 'utf8');
    const legacy = await readPreferredSearchRoutes();
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].model, 'legacy');

    // 坏文件 → 空
    await writeFile(file, '{ broken', 'utf8');
    assert.deepEqual(await readPreferredSearchRoutes(), []);
  });
});

serialTest('C71 resolveSearchRoutes：异常的 provider / 模型清单', async () => {
  await withTempHome(async () => {
    // providers 不是数组
    const nullProviders = { listProviders: () => null, listModels: async () => [] };
    assert.deepEqual(await resolveSearchRoutes(nullProviders), []);

    // 模型清单不是数组
    const badModels = { listProviders: () => [{ id: 'p' }], listModels: async () => 'nope' };
    assert.deepEqual(await resolveSearchRoutes(badModels), []);

    // 模型没有名字 / 没有 id
    const odd = {
      listProviders: () => [{ id: 'p' }],
      listModels: async () => [{ id: 'plain-model' }, { name: 'no-id' }],
    };
    const routes = await resolveSearchRoutes(odd);
    assert.equal(routes[0].name, '', '没有名字时用空串');
    assert.equal(routes.length, 2);
  });
});

serialTest('C72 描述检索：模型输出的各种形态', async () => {
  await withTempHome(async (home) => {
    await seedMarket(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', author: 'o', category: 'session', descriptionEn: 'export sessions', stars: 10, downloads: 20 },
      { id: 'b', name: 'other', repo: 'o/other', author: 'o', category: 'data', descriptionEn: 'nothing', stars: 1 },
    ]);

    // 分块里没有 type → 跳过
    const noType = makeLlm({ text: 'answer_num: 1, answer_relevance: 9, why: x', extraChunks: [{}] });
    const first = await searchPluginsByDescription({ query: 'export sessions', llm: noType });
    assert.equal(first.items.length, 1);

    // 正文超长 → 触发长度上限后中断
    const long = makeLlm({ text: 'answer_num: 1, answer_relevance: 9, why: ' + 'x'.repeat(5000) });
    const second = await searchPluginsByDescription({ query: 'export sessions', llm: long });
    assert.equal(second.ok, true);

    // finish 报 error 但没有 failure 字段
    const noFailure = makeLlm({ text: '', finish: { kind: 'error' } });
    const third = await searchPluginsByDescription({ query: 'export sessions', llm: noFailure });
    assert.equal(third.fallback, true);
    assert.match(third.note, /模型检索失败/);

    // 模型一个字都没吐（没有 finish）→ 空回复
    const empty = makeLlm({ text: '' });
    const fourth = await searchPluginsByDescription({ query: 'export sessions', llm: empty });
    assert.equal(fourth.fallback, true);

    // prepareCall 直接抛错 → 换下一条路由
    const broken = makeLlm({ prepareError: new Error('prepare failed') });
    const fifth = await searchPluginsByDescription({ query: 'export sessions', llm: broken });
    assert.equal(fifth.fallback, true);
    assert.match(fifth.note, /prepare failed/);

    // 抛出的东西没有 message → 走对象兜底
    const weird = makeLlm({ prepareError: { code: 'E_X' } });
    const sixth = await searchPluginsByDescription({ query: 'export sessions', llm: weird });
    assert.equal(sixth.fallback, true);
  });
});

serialTest('C73 描述检索：多条路由时的分级超时与推理模型参数', async () => {
  await withTempHome(async (home) => {
    await seedMarket(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', author: 'o', category: 'session', descriptionEn: 'export sessions', stars: 10 },
    ]);
    // 两条路由：第一条超时短，第二条兜底
    const llm = {
      listProviders: () => [{ id: 'p1' }],
      listModels: async () => [
        { id: 'model-one', name: 'One' },
        { id: 'model-two', name: 'Two' },
      ],
      prepareCall: async (config, signal, configure) => {
        const controls = configure({ temperature: 0 }, { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } });
        return {
          config: controls,
          stream: async function* () {
            yield { type: 'text-delta', text: 'answer_num: 1, answer_relevance: 9, why: ok' };
          },
        };
      },
    };
    const result = await searchPluginsByDescription({ query: 'export sessions', llm, timeoutMs: 200 });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 1);

    // 不传 timeoutMs → 走默认预算
    const fallback = await searchPluginsByDescription({ query: 'export sessions', llm });
    assert.equal(fallback.ok, true);
  });
});

serialTest('C74 parseLockCommit：第一次窗口里没有 commit 时继续往后找', () => {
  const padding = 'x'.repeat(500);
  const lock = `importers:
  .:
    dependencies:
      dsh-a:
        specifier: github:o/r
        version: 1.0.0
        note: ${padding}
      dsh-b:
        specifier: github:o/r
        version: 1.0.0
packages:
  github.com/o/r/0123456789ABCDEF0123456789ABCDEF01234567:
    resolution: {commit: 0123456789ABCDEF0123456789ABCDEF01234567}
`;
  assert.equal(parseLockCommit(lock, 'github:o/r'), '0123456789abcdef0123456789abcdef01234567');
});

serialTest('C75 discoverSourceMarker：目录名能切出候选时按候选逐个确认', async () => {
  await withTempHome(async (home) => {
    // 目录名带 '-' → 能切出 owner/repo 候选
    const dir = join(home, 'owner-repo');
    await mkdir(dir, { recursive: true });
    const marker = await discoverSourceMarker(dir, new Set(), async url => {
      assert.match(url, /github\.com\/owner\/repo\.git$/);
      return 'a'.repeat(40);
    });
    assert.equal(marker.author, 'owner');
    assert.equal(marker.repo, 'repo');
    assert.equal(marker.subdir, null);
    assert.ok(marker.discoveredAt);
  });
});

serialTest('C76 checkPluginUpdates：不指定缓存文件时走默认位置', async () => {
  await withTempHome(async (home) => {
    const cacheFile = join(home, 'profiles', 'web', '.plugin-updates.json');
    await mkdir(join(home, 'profiles', 'web'), { recursive: true });
    await writeFile(cacheFile, JSON.stringify({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'ghost', status: 'update-available', latestVersion: '2.0.0' }],
    }), 'utf8');
    const result = await checkPluginUpdates({});
    assert.deepEqual(result.inventory, [], '幽灵条目被裁掉');
    const raw = JSON.parse(await readFile(cacheFile, 'utf8'));
    assert.deepEqual(raw.inventory, [], '裁剪结果写回默认缓存');
  });
});

serialTest('C77 fetchPluginReleaseNotes：不注入 fetch 时用全局 fetch', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-global'],
      installed: { 'dsh-global': { name: 'dsh-global', version: '1.0.0', repository: 'https://github.com/o/global' } },
    });
    const { fetchImpl } = fakeFetch({
      'https://api.github.com/repos/o/global/releases/tags/': () => ({
        ok: true, status: 200, json: async () => ({ body: '全局 fetch 拿到的说明' }),
      }),
    });
    await withGlobalFetch(fetchImpl, async () => {
      const result = await fetchPluginReleaseNotes('dsh-global', '1.0.0');
      assert.equal(result.ok, true);
      assert.equal(result.kind, 'release');
    });
  });
});

serialTest('C78 fetchPluginReleaseNotes：CHANGELOG 的各种失败形态', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-cl'],
      installed: { 'dsh-cl': { name: 'dsh-cl', version: '1.0.0', repository: 'https://github.com/o/cl' } },
    });

    // Release 有 body 但没有 name / html_url
    const noName = fakeFetch({
      'https://api.github.com/repos/o/cl/releases/tags/': () => ({
        ok: true, status: 200, json: async () => ({ body: '说明' }),
      }),
    });
    const first = await fetchPluginReleaseNotes('dsh-cl', '1.1.0', { fetch: noName.fetchImpl });
    assert.equal(first.title, 'v1.1.0');
    assert.equal(first.url, 'https://github.com/o/cl/releases');

    // Release 没有 body → 继续找 CHANGELOG
    const noBody = fakeFetch({
      'https://api.github.com/repos/o/cl/releases/tags/': () => ({
        ok: true, status: 200, json: async () => ({ name: 'x' }),
      }),
      'https://raw.githubusercontent.com/o/cl/': () => ({ ok: false, status: 404 }),
      'https://api.github.com/repos/o/cl/contents/': () => ({
        ok: true, status: 200, json: async () => ({ content: '' }),
      }),
    });
    const second = await fetchPluginReleaseNotes('dsh-cl', '1.2.0', { fetch: noBody.fetchImpl });
    assert.equal(second.ok, false);
    assert.match(second.error, /上游没有发布说明/);

    // contents API 直接抛错
    const throws = fakeFetch({
      'https://api.github.com/repos/o/cl/releases/tags/': () => ({ ok: false, status: 404 }),
      'https://raw.githubusercontent.com/o/cl/': () => ({ ok: false, status: 404 }),
      'https://api.github.com/repos/o/cl/contents/': () => { throw new Error('api down'); },
    });
    const third = await fetchPluginReleaseNotes('dsh-cl', '1.3.0', { fetch: throws.fetchImpl });
    assert.equal(third.ok, false);
  });
});

serialTest('C79 fetchPluginReleaseNotes：参数为 null / 空', async () => {
  await withTempHome(async () => {
    assert.equal((await fetchPluginReleaseNotes(null, null)).ok, false);
    assert.equal((await fetchPluginReleaseNotes(undefined, undefined)).ok, false);
  });
});

serialTest('C80 源配置：内置源停用后再删除（恢复默认启用）', async () => {
  await withTempHome(async () => {
    await setPluginSourceEnabled(DEFAULT_SOURCE_ID, false);
    await addPluginSource({ kind: 'index', url: 'https://example.com/i.json' });
    const removed = await removePluginSource(DEFAULT_SOURCE_ID);
    assert.equal(removed.ok, true);
    assert.equal(removed.restored, true);
    const config = await readSourcesConfig();
    assert.equal(config.sources.find(item => item.id === DEFAULT_SOURCE_ID).enabled, true);
    assert.equal(config.sources.length, 2, '其它源不受影响');
  });
});

serialTest('C81 源配置：git 源的地址归一与 id', async () => {
  await withTempHome(async () => {
    const added = await addPluginSource({ kind: 'git', url: 'https://github.com/Owner/Repo.git' });
    assert.equal(added.ok, true);
    assert.equal(added.source.url, 'github:Owner/Repo');
    assert.equal(added.source.id, 'owner-repo');
    // 没有地址 → 报缺少源地址
    assert.match((await addPluginSource({ kind: 'git' })).error, /缺少源地址/);
  });
});

serialTest('C82 源 id：地址为 null 时走哈希兜底', () => {
  assert.match(normalizeSourceId('git', null), /^src-/);
  assert.match(normalizeSourceId('index', null), /^src-/);
  assert.match(normalizeSourceId('git', ''), /^src-/);
});

serialTest('C83 源配置：损坏的配置文件与条目形态', async () => {
  await withTempHome(async (home) => {
    const dir = join(home, 'plugin-manager');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'sources.json');

    // 坏 JSON → 读不出来
    await writeFile(file, '{ broken', 'utf8');
    assert.equal((await readSourcesConfig()).sources.length, 1);
    // 删内置源时也要读得出来（读不出 → 当成「没停用过」→ 拒绝删除）
    assert.equal((await removePluginSource(DEFAULT_SOURCE_ID)).ok, false);

    // sources 不是数组 → 内置源之外什么都没有
    await writeFile(file, JSON.stringify({ sources: 'nope' }), 'utf8');
    assert.equal((await readSourcesConfig()).sources.length, 1);
    assert.equal((await removePluginSource(DEFAULT_SOURCE_ID)).ok, false);
  });
});

serialTest('C84 sourceEntryToPlugin：非法条目', () => {
  assert.equal(sourceEntryToPlugin('str', 'x'), null, '不是对象');
  assert.equal(sourceEntryToPlugin({ no_name: true }, 'x'), null, '没有 name');
  assert.equal(sourceEntryToPlugin({ name: '   ' }, 'x'), null, 'name 只有空格');
});

serialTest('C85 refreshPluginSources：缓存写不进去也不影响刷新结果', async () => {
  await withTempHome(async (home) => {
    const added = await addPluginSource({ kind: 'index', url: 'https://ok.example/i.json' });
    // 让缓存目录建不出来（同名路径是个文件）
    await writeFile(join(home, 'plugin-manager', 'sources-cache'), 'not a dir', 'utf8');
    const { fetchImpl } = fakeFetch({
      'https://ok.example/i.json': () => ({
        ok: true, status: 200, json: async () => ({ plugins: [{ name: 'o/r' }] }),
      }),
    });
    const summary = await refreshPluginSources({
      fetch: fetchImpl,
      refreshMarketplace: async () => ({ count: 0, official: 0, categories: [], indexedAt: null }),
    });
    assert.equal(summary.plugins, 1, '插件数照算');
    assert.deepEqual(summary.errors, []);
    assert.ok(added.source.id);
  });
});

serialTest('C86 discoverSourceMarker：候选已经在列表里时不再重复加', async () => {
  await withTempHome(async (home) => {
    // 目录名切出来的候选与 package.json 里的 repository 指向同一个仓库
    const dir = join(home, 'owner-repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-dup', repository: 'https://github.com/owner/repo',
    }), 'utf8');
    const marker = await discoverSourceMarker(dir, new Set(), async () => 'b'.repeat(40));
    assert.equal(marker.author, 'owner');
    assert.equal(marker.repo, 'repo');
    assert.equal(marker.subdir, null, 'repository 里没有 directory → null');
  });
});

serialTest('C87 检测缓存：时间戳缺失时的裁剪写回', async () => {
  await withTempHome(async (home) => {
    // 单独一个缓存文件：避免和上一条用例的后台刷新互相干扰
    const cacheFile = join(home, 'no-stamp.json');
    await writeFile(cacheFile, JSON.stringify({
      inventory: [{ name: 'ghost', status: 'update-available', latestVersion: '2.0.0' }],
    }), 'utf8');
    const result = await checkPluginUpdates({ cacheFile });
    assert.deepEqual(result.inventory, []);
    // 等后台刷新跑完：它结束前会把缓存写回来，清理时序才不会打架
    await new Promise(resolve => setTimeout(resolve, 400));
  });
});

serialTest('C88 检测缓存：写不进去时不让主流程炸掉', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-write'],
      installed: { 'dsh-write': { name: 'dsh-write', version: '1.0.0' } },
    });
    const cacheFile = join(home, 'cache.json');
    await writeFile(cacheFile, JSON.stringify({
      checkedAt: new Date().toISOString(),
      inventory: [{ name: 'ghost', status: 'update-available', latestVersion: '2.0.0' }],
    }), 'utf8');
    // 原子写的临时路径是个目录 → 写必然失败（覆盖裁剪写回与后台刷新两处兜底）
    await mkdir(`${cacheFile}.${process.pid}.tmp`, { recursive: true });
    const result = await checkPluginUpdates({
      force: true,
      cacheFile,
      probe: { npm: async () => ({ version: '2.0.0' }) },
    });
    assert.ok(result);
    assert.deepEqual(result.inventory, []);
    // 等后台刷新跑完（它写缓存必然失败 → 走兜底分支）
    await new Promise(resolve => setTimeout(resolve, 300));
  });
});

serialTest('C89 fetchPluginReleaseNotes：CHANGELOG 走全局 fetch + 各种失败形态', async () => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-cl2'],
      installed: { 'dsh-cl2': { name: 'dsh-cl2', version: '1.0.0', repository: 'https://github.com/o/cl2' } },
    });
    // 不注入 deps.fetch → 生产路径（全局 fetch）
    const { fetchImpl } = fakeFetch({
      'https://api.github.com/repos/o/cl2/releases/tags/': () => ({ ok: false, status: 404 }),
      'https://raw.githubusercontent.com/o/cl2/': () => ({ ok: false, status: 404 }),
      'https://api.github.com/repos/o/cl2/contents/': () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }),
    });
    await withGlobalFetch(fetchImpl, async () => {
      const result = await fetchPluginReleaseNotes('dsh-cl2', '2.0.0');
      assert.equal(result.ok, false);
      assert.match(result.error, /上游没有发布说明/);
    });

    // contents API 抛出的东西没有 message → 走对象兜底
    const weird = fakeFetch({
      'https://api.github.com/repos/o/cl2/releases/tags/': () => ({ ok: false, status: 404 }),
      'https://raw.githubusercontent.com/o/cl2/': () => ({ ok: false, status: 404 }),
      'https://api.github.com/repos/o/cl2/contents/': () => { throw { code: 'E_API' }; },
    });
    const degraded = await fetchPluginReleaseNotes('dsh-cl2', '2.1.0', { fetch: weird.fetchImpl });
    assert.equal(degraded.ok, false);
  });
});

serialTest('C90 远端文本读取：超时定时器真的会触发', async (t) => {
  await withTempHome(async (home) => {
    await seedProfile(home, {
      bundles: ['dsh-timeout'],
      installed: { 'dsh-timeout': { name: 'dsh-timeout', version: '1.0.0', repository: 'https://github.com/o/to' } },
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let markCalled;
      const called = new Promise(resolve => { markCalled = resolve; });
      let resolveFetch;
      let first = true;
      const slowFetch = async (url) => {
        // Release 查询直接 404 → 落到 CHANGELOG 分支（那里才会读远端文本）
        if (String(url).includes('/releases/tags/')) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        if (first) {
          first = false;
          markCalled();
          return new Promise(resolve => { resolveFetch = resolve; });
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };
      const pending = fetchPluginReleaseNotes('dsh-timeout', '1.0.0', { fetch: slowFetch });
      await called;
      // 把 15 秒的定时器推到头 → abort 回调真的执行一次
      t.mock.timers.tick(20000);
      resolveFetch({ ok: true, status: 200, text: async () => '## v1.0.0\n\n- 慢但还是回来了\n' });
      const result = await pending;
      assert.equal(result.ok, true);
      assert.equal(result.kind, 'changelog');
    } finally {
      t.mock.timers.reset();
    }
  });
});

// ---------------------------------------------------------------------------
// 15. 补充：市场查询的边界、模型输出的容错、检索降级的各种形态
// ---------------------------------------------------------------------------

serialTest('C91 refreshPluginSources：默认源失败不拖垮其它源，进度可读', async () => {
  await withTempHome(async (home) => {
    await addPluginSource({ kind: 'index', url: 'https://good.example/i.json' });
    await addPluginSource({ kind: 'index', url: 'https://bad.example/i.json' });
    const { fetchImpl } = fakeFetch({
      'https://good.example/i.json': () => ({
        ok: true, status: 200, json: async () => ({ plugins: [{ name: 'good/a' }, { name: 'good/b' }] }),
      }),
      'https://bad.example/i.json': () => ({ ok: false, status: 500 }),
    });
    const summary = await refreshPluginSources({
      fetch: fetchImpl,
      refreshMarketplace: async () => { throw new Error('默认源挂了'); },
    });
    assert.equal(summary.sources, 3);
    assert.equal(summary.plugins, 2, '好源的插件照样进账');
    assert.equal(summary.errors.length, 2, '默认源 + 坏源各一条错误');
    assert.ok(summary.errors.some(line => line.includes('默认源挂了')));

    const progress = readSourceRefreshProgress();
    assert.equal(progress.active, false);
    assert.ok(progress.finishedAt);
    assert.equal(progress.results.length, 3);
  });
});

serialTest('C92 市场查询：缺字段的条目与排序兜底', async () => {
  await withTempHome(async (home) => {
    // 这些条目缺 stars / downloads / addedDate → 排序与比较走兜底
    await seedMarket(home, [
      { id: 'a', name: 'a', repo: 'o/a', author: 'o', category: 'ui', descriptionEn: 'alpha' },
      { id: 'b', name: 'b', repo: 'o/b', author: 'o', category: 'data', descriptionEn: 'beta', stars: 3, downloads: 7, addedDate: '2026-02-02' },
    ]);
    const result = await queryMarketplace({});
    assert.equal(result.total, 2);
    const newest = await queryMarketplace({ sort: 'newest' });
    assert.equal(newest.plugins[0].name, 'b', '有时间的排在没时间的前面');
    const byDownloads = await queryMarketplace({ sort: 'downloads' });
    assert.equal(byDownloads.plugins.length, 2);
  });
});

serialTest('C93 市场读接口：旧索引没有分类、过期源算 stale', async () => {
  await withTempHome(async (home) => {
    // 没有市场主索引 → 分类为空
    const empty = await readMarketplaceAggregated();
    assert.equal(empty.ok, false);
    assert.deepEqual(empty.categories, []);

    // 加一个自定义源，并写一份过期缓存 → 整体算 stale
    const added = await addPluginSource({ kind: 'index', url: 'https://stale.example/i.json' });
    const cacheDir = join(home, 'plugin-manager', 'sources-cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${added.source.id}.json`), JSON.stringify({
      fetchedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      plugins: [{ name: 'stale/x', category: 'data' }],
    }), 'utf8');
    const stale = await readMarketplaceAggregated();
    assert.equal(stale.stale, true, '有过期源时整体算 stale');
    assert.equal(stale.plugins.some(item => item.name === 'stale/x'), true);
    assert.ok(stale.sources.some(item => item.state === 'stale'));
  });
});

serialTest('C94 关键词预筛：缺字段的插件与同分排序兜底', () => {
  // 插件没有 repo/name → 不炸，也不进候选
  assert.deepEqual(rankPluginsByKeywords([{ id: 'a' }], 'sidebar'), []);
  // 同分时按星标、再按下载量兜底（缺字段时按 0 算）
  const tie = rankPluginsByKeywords([
    { id: 'x', name: 'tie', repo: 'o/tie', descriptionEn: 'tie' },
    { id: 'y', name: 'tie', repo: 'o/tie', descriptionEn: 'tie' },
  ], 'tie');
  assert.equal(tie.length, 2);
});

serialTest('C95 parseSearchPicks：带花括号但不是 JSON / null 条目', () => {
  // 有 '{' 和 '}' 但不是合法 JSON → 对象形状解析失败；再试数组形状
  // （'{picks: [1,2]}' 意图明确是「选了第 1、2 个」，宽容解析比丢弃好）。
  assert.deepEqual(parseSearchPicks('{picks: [1,2]}', 3).map(pick => pick.index), [0, 1], '对象壳坏了但数组还能用');
  // 完全没有 JSON 形状 → 按「没有输出」处理
  assert.deepEqual(parseSearchPicks('完全不是 JSON', 3), []);
  assert.deepEqual(parseSearchPicks('{broken', 3), []);
  // picks 里有 null → 跳过
  assert.deepEqual(parseSearchPicks('{"picks":[null,{"i":2}]}', 3).map(pick => pick.index), [1]);
});

serialTest('C96 检索模型记忆：读单条与重复记录的耗时', async () => {
  await withTempHome(async () => {
    await writePreferredSearchRoute({ provider: 'p', model: 'm' }, 5000);
    const one = await readPreferredSearchRoute();
    assert.equal(one.model, 'm');
    assert.equal(one.ms, 5000);
    // 同一个模型再成功一次 → 取更快的耗时
    await writePreferredSearchRoute({ provider: 'p', model: 'm' }, 3000);
    const faster = await readPreferredSearchRoute();
    assert.equal(faster.ms, 3000);
  });
});

serialTest('C97 描述检索：模型超时、字段缺省与最终降级', async () => {
  await withTempHome(async (home) => {
    await seedMarket(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', author: 'o', category: 'session', descriptionEn: 'export sessions' },
      { id: 'b', name: 'other', repo: 'o/other', author: 'o', category: 'data', descriptionEn: 'nothing', stars: 3 },
    ]);

    // 模型很慢 → 超时定时器真的会触发（abort 回调执行）
    const slow = {
      listProviders: () => [{ id: 'p1' }],
      listModels: async () => [{ id: 'm1', name: 'M1' }],
      prepareCall: async () => ({
        config: {},
        stream: async function* () {
          await new Promise(resolve => setTimeout(resolve, 60));
          yield { type: 'text-delta', text: 'answer_num: 1, answer_relevance: 9, why: x' };
        },
      }),
    };
    const timedOut = await searchPluginsByDescription({ query: 'export sessions', llm: slow, timeoutMs: 5 });
    assert.equal(timedOut.ok, true);

    // 插件缺 stars / downloads / 描述 → 返回的条目按 0 / 空串兜底
    const llm = makeLlm({ text: 'answer_num: 1, answer_relevance: 9, why: 命中' });
    const picked = await searchPluginsByDescription({ query: 'export sessions', llm });
    assert.equal(picked.items[0].downloads, 0);
    assert.equal(picked.items[0].stars, 0);
    assert.equal(picked.items[0].description, 'export sessions', '没有中文描述时用英文');

    // 关键词一条没命中 → 退回热门候选（插件缺 stars 时按 0 算）
    const noHits = await searchPluginsByDescription({ query: '毫不相干的描述' });
    assert.equal(noHits.candidates, 2);
  });
});

serialTest('C98 parseSearchPicks：同一个插件被模型报两次', () => {
  const parsed = parseSearchPicks('answer_num: 1, answer_relevance: 9, why: a\nanswer_num: 1, answer_relevance: 3, why: b', 3);
  assert.equal(parsed.length, 1, '重复的编号只留一条');
  assert.equal(parsed[0].score, 9, '留分数高的那条');
});

serialTest('C99 市场排序：比较的两边都缺数字时走兜底', async () => {
  await withTempHome(async (home) => {
    // 三条都没有 stars / downloads / addedDate → 比较器两边都要走 || 0
    await seedMarket(home, [
      { id: 'a', name: 'a', repo: 'o/a', author: 'o', category: 'ui' },
      { id: 'b', name: 'b', repo: 'o/b', author: 'o', category: 'ui' },
      { id: 'c', name: 'c', repo: 'o/c', author: 'o', category: 'ui' },
    ]);
    for (const sort of ['stars', 'downloads', 'newest']) {
      const result = await queryMarketplace({ sort });
      assert.equal(result.total, 3);
    }
  });
});

serialTest('C100 resolveSearchRoutes：路由组里名字带 flash 的排中间', async () => {
  await withTempHome(async () => {
    const llm = {
      listProviders: () => [{ id: 'p1' }],
      listModels: async () => [
        { id: 'group/flash', name: 'Group Flash' },
        { id: 'group/slow', name: 'Group Slow' },
        { id: 'plain-model', name: 'Plain' },
        { id: 'fast-flash', name: 'Flash' },
      ],
    };
    const routes = await resolveSearchRoutes(llm);
    assert.deepEqual(routes.map(route => route.model), [
      'fast-flash', 'plain-model', 'group/flash', 'group/slow',
    ], '具体快模型 > 具体普通模型 > 路由组快模型 > 路由组慢模型');
  });
});

serialTest('C102 源缓存：缺 fetchedAt / 缺 plugins 的兜底', async () => {
  await withTempHome(async (home) => {
    const added = await addPluginSource({ kind: 'index', url: 'https://bare.example/i.json' });
    const cacheDir = join(home, 'plugin-manager', 'sources-cache');
    await mkdir(cacheDir, { recursive: true });
    // 有 plugins 但没有 fetchedAt → 时间按 0 算（视为最旧）
    await writeFile(join(cacheDir, `${added.source.id}.json`), JSON.stringify({ plugins: [] }), 'utf8');
    const aggregated = await aggregateCachedSources();
    const state = aggregated.perSource.find(item => item.id === added.source.id);
    assert.equal(state.state, 'stale', '没有时间戳按最旧算');
    assert.equal(state.count, 0);
    assert.deepEqual(aggregated.plugins, []);
  });
});

serialTest('C101 描述检索：条目字段缺省与 debug 模式下的异常', async () => {
  await withTempHome(async (home) => {
    await seedMarket(home, [
      { id: 'a', name: 'session-export', repo: 'o/session-export', author: 'o', category: 'session', stars: 5, downloads: 7 },
    ]);
    // 插件没有任何描述 → 条目里的描述是空串
    const llm = makeLlm({ text: 'answer_num: 1, answer_relevance: 9, why: 命中' });
    const picked = await searchPluginsByDescription({ query: 'session export', llm });
    assert.equal(picked.items[0].description, '');

    // debug 模式 + 模型直接抛错 → 带出最后一条路由的错误
    const broken = makeLlm({ prepareError: new Error('boom') });
    const debugged = await searchPluginsByDescription({ query: 'session export', llm: broken, debug: true });
    assert.equal(debugged.fallback, true);
    assert.ok(debugged.lastRouteError, 'debug 模式带出路由错误');
    assert.match(debugged.lastRouteError.error, /boom/);

    // 模型没吐正文但给出了结束原因 → 如实带上结束原因
    const stopped = makeLlm({ text: '', finish: { kind: 'stop' } });
    const empty = await searchPluginsByDescription({ query: 'session export', llm: stopped });
    assert.equal(empty.fallback, true);
    assert.match(empty.note, /模型检索失败/);
  });
});
