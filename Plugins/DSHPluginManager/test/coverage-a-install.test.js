// lib/index.js 第 1-1050 行的覆盖补齐：安装验收、来源识别、停用/启用、
// PATH/pnpm、原子写、配置文件解析。
//
// 两条硬约束（与本仓库其它测试一致）：
//   1) 不联网、不跑真实子进程：lib/index.js 里的 `run` 是 `promisify(execFile)`，
//      模块加载时就绑定了。所以在 import lib/index.js **之前**替换 node:child_process
//      的 execFile（用 createRequire 拿到 CJS exports 改，再让 ESM 侧在 facade 建立时
//      取到新值），run() 就全部落到本文件的假实现上——dsh CLI / pnpm / git 都是假的。
//   2) 不改生产代码：lib/index.js 一个字节都不动。
//
// 环境变量（DSH_HOME）每个用例都要改，所以全部串行（concurrency: false）并在
// finally 里恢复。
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { linkDangling, linkDir } from './helpers/link-helpers.js';

// ---------------------------------------------------------------------------
// 假子进程：dsh CLI / pnpm / git 全走这里，不联网也不碰真实程序
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');

/** 记录所有被拦截的子进程调用（断言用）。 */
const execLog = [];
/** 当前生效的子进程假实现：(call) => {stdout?, stderr?} | {error} | null */
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
      // 原样把错误抛出去（不包装成 Error）——没有 message 的错误也要能被生产代码如实转述。
      const error = outcome.error;
      if (error && typeof error === 'object') {
        if (outcome.stdout !== undefined && !('stdout' in error)) error.stdout = outcome.stdout;
        if (outcome.stderr !== undefined && !('stderr' in error)) error.stderr = outcome.stderr;
      }
      done(error);
      return;
    }
    done(null, { stdout: outcome.stdout ?? '', stderr: outcome.stderr ?? '' });
  })().catch(() => done(execError('fake execFile failed')));
};

// ---------------------------------------------------------------------------
// 假 HTTP：国内加速状态走 127.0.0.1，不许真连
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
after(() => { globalThis.fetch = realFetch; });

// ---------------------------------------------------------------------------
// 模块私有函数的可达性
//
// lib/index.js 里有三段「从公开 API 走不到」的代码，只能靠给模块补 export 才能测到：
//   1) runMutation / operationSnapshot：模块私有，而且当前**没有任何调用点**
//      （重构后遗留的死代码，见报告）；
//   2) launcherPatchPaths 的「patches 数组」分支：两个调用点都写成
//      `options.patches ?? await launcherPatchPaths(options)`，数组时短路，
//      所以去重/过滤那段永远走不到。
//
// 这里用 loader 钩子把源码**末尾**追加一行 export，其余字节与生产完全相同
// （追加在文件末尾，不影响任何一行的行号），覆盖数据仍然记在 lib/index.js 上。
// 生产代码将来若把这些函数删掉，钩子会自动跳过（本文件里的用例也会跳过）。
// ---------------------------------------------------------------------------

const LIB_INDEX_URL = pathToFileURL(fileURLToPath(new URL('../lib/index.js', import.meta.url))).href;
const PRIVATE_EXPORTS = ['runMutation', 'operationSnapshot', 'launcherPatchPaths'];

/** 模块源码里还有哪些私有函数没被找到（找不到就不补 export，退回原样加载）。 */
function missingPrivateExports(source) {
  return PRIVATE_EXPORTS.filter(name => !new RegExp(`function ${name}\\b`).test(source));
}

function rewireHook(url, context, nextLoad) {
  if (url !== LIB_INDEX_URL) return nextLoad(url, context);
  const source = readFileSyncUtf8(fileURLToPath(url));
  if (missingPrivateExports(source).length > 0) return nextLoad(url, context);
  const patched = `${source}\nexport { ${PRIVATE_EXPORTS.join(', ')} };\n`;
  return { format: 'module', source: patched, shortCircuit: true };
}

function readFileSyncUtf8(path) {
  // loader 钩子里用同步读最省事（钩子本身可以异步）。
  const { readFileSync } = require('node:fs');
  return readFileSync(path, 'utf8');
}

// Node 22.15+ 用同线程的 registerHooks；更老的版本退回 data: URL 的 register。
const nodeModule = require('node:module');
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ load: rewireHook });
} else {
  const loaderLines = [
    "import { readFileSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    'const TARGET = ' + JSON.stringify(LIB_INDEX_URL) + ';',
    'const NAMES = ' + JSON.stringify(PRIVATE_EXPORTS) + ';',
    'export async function load(url, context, nextLoad) {',
    '  if (url !== TARGET) return nextLoad(url, context);',
    '  const source = readFileSync(fileURLToPath(url), "utf8");',
    '  const missing = NAMES.filter(name => !new RegExp("function " + name + "\\\\b").test(source));',
    '  if (missing.length > 0) return nextLoad(url, context);',
    '  return { format: "module", source: source + "\\nexport { " + NAMES.join(", ") + " };\\n", shortCircuit: true };',
    '}'
  ];
  nodeModule.register('data:text/javascript,' + encodeURIComponent(loaderLines.join('\n')), import.meta.url);
}

// 必须在钩子/假 execFile 装好之后再 import：模块加载时就把 run 绑到了假 execFile 上。
const pm = await import('../lib/index.js');

const {
  acceptInstalledPackage,
  applyPluginUpdate,
  classifyPluginSource,
  compareInstalledPlugins,
  declaredRowsFromPatchYaml,
  describeDisabledPlugins,
  discoverPluginRowIds,
  ensurePnpmPath,
  ensurePnpmWorkspace,
  hasCommandOnPath,
  invalidatePluginRowCache,
  isCoreBundle,
  isSafeRowId,
  listInstalledPlugins,
  missingPackageEntries,
  normalizeDisabledBundle,
  parseDumpConfigRows,
  parsePluginYml,
  patchPathsFromArgv,
  pluginRowIds,
  readDisabledState,
  removeDisabledBundle,
  renderDisabledPatch,
  rowIdsForBundleFromRows,
  rowIdsFromDeclaredRows,
  setPluginDisabled,
  stripStaleLockEntry,
  undisableableReason,
  uninstallPlugin,
} = pm;

// ---------------------------------------------------------------------------
// 测试骨架
// ---------------------------------------------------------------------------

/** 全部用例都要改 process.env.DSH_HOME，必须串行。 */
const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

/** 真实运行平台（用 withPlatform 模拟别的平台时不能拿 process.platform 判断）。 */
const REAL_PLATFORM = process.platform;

/** 用临时 DSH_HOME 跑一段代码（隔离 profile、状态文件与市场目录）。 */
async function withTempHome(prefix, fn) {
  const home = await mkdtemp(join(tmpdir(), prefix));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  invalidatePluginRowCache();
  try {
    return await fn(home);
  } finally {
    invalidatePluginRowCache();
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

/** 临时替换 process.env.PATH（finally 里恢复）。 */
async function withPath(value, fn) {
  const previous = process.env.PATH;
  if (value === undefined) delete process.env.PATH;
  else process.env.PATH = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
}

/** 临时替换 process.kill（用来伪造「进程还活着 / 已经没了」）。 */
async function withStubbedKill(impl, fn) {
  const original = process.kill;
  process.kill = impl;
  try {
    return await fn();
  } finally {
    process.kill = original;
  }
}

/**
 * 临时替换 process.platform（用来覆盖另一个平台分支）。
 * isAbsolutePath 按平台判绝对路径，两个分支互斥——单平台跑永远有一边覆盖不到。
 */
async function withPlatform(value, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true, enumerable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

/** 建一个 <home>/profiles/web/node_modules 布局，返回常用路径。 */
async function makeProfile(home) {
  const web = join(home, 'profiles', 'web');
  const modules = join(web, 'node_modules');
  await mkdir(modules, { recursive: true });
  return { web, modules };
}

/** 在包里写一个 package.json。 */
async function writePackage(dir, pkg) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
}

/** 真实 dump-config 的形状（顶层行 + 来源节 + 缩进子行）。 */
const DUMP_FIXTURE = [
  '# == @deepseek-ai/dsh-base',
  '- id: session',
  "  name: '@deepseek-ai/dsh-session'",
  '# == @alice/dsh-own-plugin',
  '- id: alice-row',
  "  name: '@alice/dsh-own-plugin'",
  '- id: alice-group',
  "  name: '@alice/dsh-own-plugin'",
  '# == bundled-plugin, patched by /Users/me/.dsh/profiles/web/cordis.patch.yml',
  '- id: bundled-row',
  "  name: 'bundled-plugin'",
  ''
].join('\n');

// ---------------------------------------------------------------------------
// 1) 纯函数：YAML 解析 / 核心层判定 / 排序 / 名字校验
// ---------------------------------------------------------------------------

serialTest('parsePluginYml：解析 url/name/category/description，忽略注释与无冒号行，去掉成对引号', () => {
  const parsed = parsePluginYml([
    '# 上游清单的注释',
    '',
    'url: "github:alice/demo"',
    'name: alice/demo',
    'category: "browser"',
    'description:',
    '  en: "Does things"',
    '  zh: 做事情',
    '这一行没有冒号',
    ''
  ].join('\n'));
  assert.equal(parsed.url, 'github:alice/demo', '成对引号被去掉');
  assert.equal(parsed.name, 'alice/demo');
  assert.equal(parsed.category, 'browser');
  assert.deepEqual(parsed.description, { en: 'Does things', zh: '做事情' });

  // 长度不足 2 的标量原样返回（不当作引号处理）
  const short = parsePluginYml('name: a\ncategory: b\n');
  assert.equal(short.name, 'a');
  assert.equal(short.category, 'b');

  // 引号不成对时原样保留
  const odd = parsePluginYml('name: "a"b\n');
  assert.equal(odd.name, '"a"b');
  assert.deepEqual(parsePluginYml(''), { description: {} });
});

serialTest('isCoreBundle：显式清单 + @deepseek-ai/ 前缀，其余不是核心层', () => {
  assert.equal(isCoreBundle('@deepseek-ai/dsh-base'), true);
  assert.equal(isCoreBundle('@deepseek-ai/dsh-web-app'), true);
  assert.equal(isCoreBundle('@deepseek-ai/dsh-headless'), true);
  assert.equal(isCoreBundle('@deepseek-ai/dsh-experimental-whatever'), true, '实验层按前缀算核心层');
  assert.equal(isCoreBundle('d3'), false);
  assert.equal(isCoreBundle('@alice/dsh-own-plugin'), false);
  assert.equal(isCoreBundle(null), false);
  assert.equal(isCoreBundle(undefined), false);
});

serialTest('compareInstalledPlugins：用户插件在前、时间新的在前、同时间按名字兜底', () => {
  const user = { name: 'alpha', source: 'user', installedAt: '2024-05-02T00:00:00.000Z' };
  const older = { name: 'beta', source: 'user', installedAt: '2024-05-01T00:00:00.000Z' };
  const bundled = { name: 'zeta', source: 'bundled', installedAt: '2025-05-01T00:00:00.000Z' };
  const broken = { name: 'gamma', source: 'broken', installedAt: null };

  assert.ok(compareInstalledPlugins(user, bundled) < 0, '用户插件排在内置插件前面');
  assert.ok(compareInstalledPlugins(bundled, user) > 0);
  assert.ok(compareInstalledPlugins(user, older) < 0, '时间新的在前');
  assert.ok(compareInstalledPlugins(older, user) > 0);
  assert.ok(compareInstalledPlugins(user, broken) < 0, '取不到时间的排在有时间的之后');
  assert.ok(
    compareInstalledPlugins({ name: 'alpha', source: 'user', installedAt: null }, { name: 'beta', source: 'user', installedAt: null }) < 0,
    '时间相同按名字兜底，保证顺序稳定'
  );
  assert.ok(
    compareInstalledPlugins({ name: 'alpha', source: 'user', installedAt: 'not-a-date' }, { name: 'beta', source: 'user', installedAt: null }) < 0,
    '非法时间与缺时间都按 -1 处理'
  );
});

serialTest('normalizeDisabledBundle / undisableableReason / isSafeRowId：非法名与受保护插件', () => {
  assert.equal(normalizeDisabledBundle('  dsh-context  '), 'dsh-context');
  assert.equal(normalizeDisabledBundle('@scope/dsh-demo'), '@scope/dsh-demo');
  assert.equal(normalizeDisabledBundle('../evil'), null, '不许带 ..');
  assert.equal(normalizeDisabledBundle('a b'), null);
  assert.equal(normalizeDisabledBundle(''), null);
  assert.equal(normalizeDisabledBundle(123), null, '非字符串直接拒绝');

  assert.match(undisableableReason('@deepseek-ai/dsh-base') ?? '', /核心层/);
  assert.match(undisableableReason('@deepseek-ai/dsh-web-app') ?? '', /界面/);
  assert.match(undisableableReason('dsh-plugin-manager') ?? '', /无法从界面恢复/);
  assert.equal(undisableableReason('dsh-context'), null);
  assert.equal(undisableableReason(undefined), null);

  assert.equal(isSafeRowId('row-1'), true);
  assert.equal(isSafeRowId('@a/b:row'), true);
  assert.equal(isSafeRowId(''), false);
  assert.equal(isSafeRowId('a b'), false);
  assert.equal(isSafeRowId('a\n  disabled: true'), false);
  assert.equal(isSafeRowId(123), false);
  assert.equal(isSafeRowId('a'.repeat(129)), false);
});

// ---------------------------------------------------------------------------
// 2) 装配树行 id 的解析
// ---------------------------------------------------------------------------

serialTest('parseDumpConfigRows：只认顶格 - id:，认领 name，空节与缩进子行忽略', () => {
  const rows = parseDumpConfigRows(DUMP_FIXTURE);
  const ids = rows.map(row => row.id);
  assert.ok(ids.includes('alice-row'));
  assert.ok(ids.includes('bundled-row'));
  assert.ok(ids.includes('session'), 'core 层的行也解析出来（能不能停用由另一层判定）');
  const bundled = rows.find(row => row.id === 'bundled-row');
  assert.equal(bundled.bundle, 'bundled-plugin');
  assert.equal(bundled.patched, true, 'patched by 的段标记出来了');

  assert.deepEqual(parseDumpConfigRows(null), [], 'dump 拿不到时返回空');
  assert.deepEqual(parseDumpConfigRows('# == \n- id: x\n'), [], '空来源节不认领任何行');
  assert.deepEqual(parseDumpConfigRows('# == b\n  name: x\n'), [], '缩进子行不是顶层行');
});

serialTest('rowIdsForBundleFromRows：优先自己那一节，否则按 name 认领', () => {
  const rows = parseDumpConfigRows(DUMP_FIXTURE);
  assert.deepEqual(rowIdsForBundleFromRows('@alice/dsh-own-plugin', rows), ['alice-row', 'alice-group']);
  assert.deepEqual(rowIdsForBundleFromRows('bundled-plugin', rows), ['bundled-row'], '只有 patched by 段时按行 name 认领');
  assert.deepEqual(rowIdsForBundleFromRows('no-such-bundle', rows), []);
  assert.deepEqual(rowIdsForBundleFromRows(null, null), [], '参数不合法时返回空');
  assert.deepEqual(rowIdsForBundleFromRows('x', 'not-an-array'), []);
});

serialTest('declaredRowsFromPatchYaml：只取 - insert: 块里的顶层行', () => {
  const rows = declaredRowsFromPatchYaml([
    '# 注释',
    '- id: someone-else',
    '  config:',
    '    model: x',
    '- insert:',
    '    - id: my-row',
    "      name: 'my-plugin'",
    '      config:',
    '        - id: my-child',
    "          name: 'my-plugin'",
    '    - id: second-row',
    "      name: '@scope/second'",
    ''
  ].join('\n'));
  assert.deepEqual(rows.map(row => row.id), ['my-row', 'second-row']);
  assert.equal(rows[0].name, 'my-plugin');
  assert.equal(rows[1].name, '@scope/second');
  assert.deepEqual(declaredRowsFromPatchYaml(null), []);
});

serialTest('rowIdsFromDeclaredRows / patchPathsFromArgv：按 name 认领 + 提取 --patch', () => {
  const declared = declaredRowsFromPatchYaml([
    '- insert:',
    '    - id: own-row',
    "      name: 'the-bundle'",
    '    - id: other-row',
    "      name: 'another-bundle'",
    '    - id: anonymous',
    ''
  ].join('\n'));
  assert.deepEqual(rowIdsFromDeclaredRows('the-bundle', declared), ['own-row']);
  assert.deepEqual(rowIdsFromDeclaredRows('anonymous', declared), [], '没声明 name 就不猜');
  assert.deepEqual(rowIdsFromDeclaredRows(null, null), []);

  assert.deepEqual(
    patchPathsFromArgv(['node', 'dsh', 'web', '--patch', '/a.yml', '--patch', '/b.yml']),
    ['/a.yml', '/b.yml']
  );
  assert.deepEqual(patchPathsFromArgv(['node', 'dsh', 'web', '--patch']), [], '缺值不算');
  assert.deepEqual(patchPathsFromArgv('not-an-array'), []);
});

serialTest('renderDisabledPatch：过滤不可停用 bundle + 行 id 去重', () => {
  assert.equal(renderDisabledPatch([]), '');
  assert.equal(
    renderDisabledPatch([
      { bundle: '@a/b', rowIds: ['row-a', 'row-a', 'bad id'] },
      { bundle: '@deepseek-ai/dsh-base', rowIds: ['session'] },
      { bundle: 'dsh-plugin-manager', rowIds: ['dsh-plugin-manager'] },
      { bundle: '@c/d', rowIds: ['row-b'] },
    ]),
    '- id: row-a\n  disabled: true\n- id: row-b\n  disabled: true\n'
  );
  // 不同的 bundle 声明同一个行 id：只写一次
  assert.equal(
    renderDisabledPatch([
      { bundle: '@a/b', rowIds: ['row-x'] },
      { bundle: '@c/d', rowIds: ['row-x'] }
    ]),
    '- id: row-x\n  disabled: true\n'
  );
});

serialTest('classifyPluginSource：file:/link: 的绝对路径原样用，相对路径相对 profile 目录', async () => {
  await withTempHome('dsh-pm-source-', async home => {
    const absolute = process.platform === 'win32'
      ? 'C:\\dev\\dsh-demo'
      : '/home/dev/dsh-demo';
    const byAbsolute = classifyPluginSource({
      name: 'dsh-demo',
      spec: `file:${absolute}`,
      marker: { author: 'alice', repo: 'demo' }
    });
    assert.equal(byAbsolute.kind, 'git');
    assert.equal(byAbsolute.remote.dir, absolute, '绝对路径原样用（跨平台判定）');

    const byRelative = classifyPluginSource({
      name: 'dsh-demo',
      spec: 'file:plugin-sources/alice-demo',
      marker: { author: 'alice', repo: 'demo' }
    });
    assert.equal(byRelative.remote.dir, join(home, 'profiles', 'web', 'plugin-sources', 'alice-demo'));

    if (process.platform === 'win32') {
      // UNC 路径（\\server\share）也是绝对路径
      const unc = classifyPluginSource({
        name: 'dsh-demo',
        spec: 'file:\\\\server\\share\\dsh-demo',
        marker: { author: 'alice', repo: 'demo' }
      });
      assert.equal(unc.remote.dir, '\\\\server\\share\\dsh-demo');
    }
  });
});

serialTest('classifyPluginSource：POSIX 绝对路径（以 / 开头）也认得出来', async () => {
  await withTempHome('dsh-pm-posix-', async home => {
    await withPlatform('linux', async () => {
      const result = classifyPluginSource({
        name: 'dsh-demo',
        spec: 'file:/home/dev/dsh-demo',
        marker: { author: 'alice', repo: 'demo' }
      });
      assert.equal(result.remote.dir, '/home/dev/dsh-demo', 'POSIX 绝对路径原样用');
    });
  });
});

serialTest('classifyPluginSource：file: 后面没有路径时按 npm 包处理', async () => {
  await withTempHome('dsh-pm-empty-spec-', async home => {
    const result = classifyPluginSource({ name: 'dsh-demo', spec: 'file:' });
    assert.equal(result.kind, 'npm', '空的 file: 规格不是有效的本地来源');
    assert.deepEqual(result.remote, { type: 'npm', package: 'dsh-demo' });
  });
});

// ---------------------------------------------------------------------------
// 3) PATH / pnpm
// ---------------------------------------------------------------------------

serialTest('hasCommandOnPath：按平台判定可执行，目录不算命令，找不到返回 null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pm-path-'));
  try {
    if (process.platform === 'win32') {
      await writeFile(join(dir, 'tool.exe'), '');
      await writeFile(join(dir, 'script.cmd'), '');
      await writeFile(join(dir, 'other.bat'), '');
      await writeFile(join(dir, 'named.exe'), '');
      await mkdir(join(dir, 'folder.exe'), { recursive: true });
      assert.equal(await hasCommandOnPath('tool', dir), join(dir, 'tool.exe'));
      assert.equal(await hasCommandOnPath('script', dir), join(dir, 'script.cmd'));
      assert.equal(await hasCommandOnPath('other', dir), join(dir, 'other.bat'));
      assert.equal(await hasCommandOnPath('named.exe', dir), join(dir, 'named.exe'), '带扩展名的按原名找');
      assert.equal(await hasCommandOnPath('folder', dir), null, '目录不是可执行命令');
    } else {
      await writeFile(join(dir, 'tool'), '', { mode: 0o755 });
      await writeFile(join(dir, 'plain'), '', { mode: 0o644 });
      await mkdir(join(dir, 'folder'), { recursive: true });
      assert.equal(await hasCommandOnPath('tool', dir), join(dir, 'tool'));
      assert.equal(await hasCommandOnPath('plain', dir), null, '没有执行位不算可执行');
      assert.equal(await hasCommandOnPath('folder', dir), null, '目录不是可执行命令');
    }
    // 多级 PATH：按平台分隔符切分
    const other = await mkdtemp(join(tmpdir(), 'dsh-pm-path2-'));
    try {
      const separator = process.platform === 'win32' ? ';' : ':';
      const name = process.platform === 'win32' ? 'second.exe' : 'second';
      await writeFile(join(other, name), process.platform === 'win32' ? '' : '#!/bin/sh\n', {
        mode: process.platform === 'win32' ? 0o644 : 0o755
      });
      const found = await hasCommandOnPath(process.platform === 'win32' ? 'second' : 'second', `${dir}${separator}${other}`);
      assert.equal(found, join(other, name));
    } finally {
      await rm(other, { recursive: true, force: true });
    }
    // 找不到
    assert.equal(await hasCommandOnPath('definitely-missing', dir), null);
    // PATH 整个没设时按空串处理
    await withPath(undefined, async () => {
      assert.equal(await hasCommandOnPath('anything'), null);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

serialTest('ensurePnpmPath：PATH 上有 pnpm 就直接用；没有就用 corepack 生成 shim；两者都没有就如实说', async () => {
  await withTempHome('dsh-pm-pnpm-', async home => {
    const bin = join(home, 'bin-with-pnpm');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'), '');

    await withPath(bin, async () => {
      const [path, note] = await ensurePnpmPath();
      assert.equal(path, bin, 'PATH 没改');
      assert.match(note, /found pnpm at/);
    });

    const bin2 = join(home, 'bin-with-corepack');
    await mkdir(bin2, { recursive: true });
    await writeFile(join(bin2, process.platform === 'win32' ? 'corepack.cmd' : 'corepack'), '');
    await withPath(bin2, async () => {
      const [path, note] = await ensurePnpmPath();
      assert.match(note, /pnpm shim prepared via corepack/);
      const separator = process.platform === 'win32' ? ';' : ':';
      const shimDir = join(home, 'pnpm-bin');
      assert.ok(path.startsWith(shimDir + separator), 'shim 目录被放到 PATH 最前面');
      const shim = join(shimDir, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
      const text = await readFile(shim, 'utf8');
      assert.match(text, /corepack/);
      assert.match(text, /pnpm/);
      // 第二次：内容一样就不重写
      const before = (await stat(shim)).mtimeMs;
      await new Promise(resolve => setTimeout(resolve, 20));
      await ensurePnpmPath();
      assert.equal((await stat(shim)).mtimeMs, before, '内容没变就不重写 shim');
    });

    const empty = join(home, 'empty-bin');
    await mkdir(empty, { recursive: true });
    await withPath(empty, async () => {
      const [path, note] = await ensurePnpmPath();
      assert.equal(path, empty);
      assert.match(note, /pnpm unavailable/);
    });
  });
});

// ---------------------------------------------------------------------------
// 4) 安装验收：锁文件清理 / 物化回读 / 入口与 import 校验 / 失败回滚
// ---------------------------------------------------------------------------

serialTest('stripStaleLockEntry：只摘 importers 段里目标依赖的记录，别的段不动', async () => {
  await withTempHome('dsh-pm-lock-', async home => {
    const web = join(home, 'profiles', 'web');
    await mkdir(web, { recursive: true });
    const lock = join(web, 'pnpm-lock.yaml');

    assert.equal(await stripStaleLockEntry('demo'), false, '锁文件不存在时如实说没改');

    // 真实 pnpm-lock.yaml 的形状：importers → 2 空格的工程名 → 4 空格的
    // dependencies → 6 空格的包名。早前 stripStaleLockEntry 匹配的是两空格
    // （那正好是工程名那一行），真实锁文件上一行都删不掉 → 「清钉重装」这条
    // 自愈路径恒为空操作。这里用真实缩进锁住正确行为。
    await writeFile(lock, [
      'lockfileVersion: 9.0',
      '',
      'importers:',
      '',
      '  .:',
      '    dependencies:',
      '      demo:',
      '        specifier: file:../demo',
      '        version: file:../demo',
      '      other:',
      '        specifier: ^1.0.0',
      '        version: 1.2.3',
      '',
      'packages:',
      '',
      '  demo@1.0.0:',
      '    resolution: {}',
      ''
    ].join('\n'));

    assert.equal(await stripStaleLockEntry('absent'), false, '没有记录时报未改动');
    assert.equal(await stripStaleLockEntry('demo'), true, '有钉死的记录要报改动');
    const after = await readFile(lock, 'utf8');
    assert.ok(!after.includes('      demo:'), '目标包名整块删除');
    assert.ok(!after.includes('specifier: file:../demo'), '目标的 specifier/version 也删掉');
    assert.ok(after.includes('      other:'), '别的依赖留着');
    assert.ok(after.includes('  .:'), '工程名留着');
    assert.ok(after.includes('packages:'), '其他顶层段保留');
    assert.ok(after.includes('  demo@1.0.0:'), 'packages 段里的同名包不受影响');
  });
});

serialTest('acceptInstalledPackage：装上就过；没物化先清钉重装一次；还不行就回滚', async () => {
  await withTempHome('dsh-pm-accept-', async home => {
    const { modules } = await makeProfile(home);
    await writePackage(join(modules, 'dsh-ok'), { name: 'dsh-ok', version: '1.0.0', main: 'index.js' });
    await writeFile(join(modules, 'dsh-ok', 'index.js'), 'export default 1;\n');

    // 1) 装上了：直接通过
    const ok = await acceptInstalledPackage('dsh-ok', '已安装', async () => ({ stdout: '', stderr: '' }));
    assert.equal(ok.ok, true);
    assert.equal(ok.note, '已安装');

    // 2) 没物化：先清钉 + 重装一次（第二次物化了就算成功）
    const commands = [];
    let first = true;
    const retried = await acceptInstalledPackage('dsh-ok', '已安装', async args => {
      commands.push(args);
    }, async () => {
      const present = !first;
      first = false;
      return present;
    }, 'dsh-ok@2.0.0');
    assert.equal(retried.ok, true, '重装一次后物化了就算成功');
    assert.deepEqual(commands, [['add', 'dsh-ok@2.0.0']]);

    // 3) 重装后仍没物化：回滚并如实报错
    const removed = [];
    const failed = await acceptInstalledPackage('dsh-ok', '已安装', async args => {
      removed.push(args);
    }, async () => false, 'dsh-ok@2.0.0');
    assert.equal(failed.ok, false);
    assert.match(failed.error, /没有出现在 node_modules 里/);
    assert.deepEqual(removed.at(-1), ['remove', 'dsh-ok'], '自动撤销这次安装');

    // 4) 连撤销都失败：如实说失败，不假装成功
    const broken = await acceptInstalledPackage('dsh-ok', '已安装', async () => {
      throw { code: 'E_NO_MESSAGE' };   // 没有 message 的错误也要能说清楚
    }, async () => false);
    assert.equal(broken.ok, false);
    assert.match(broken.error, /已尝试撤销但失败/);
    assert.match(broken.error, /E_NO_MESSAGE|\[object Object\]/);
  });
});

serialTest('acceptInstalledPackage：入口缺失或 import 缺口都当场撤销', async () => {
  await withTempHome('dsh-pm-gaps-', async home => {
    const { modules } = await makeProfile(home);
    // 入口缺失：package.json 声明了 main，但文件不存在
    await writePackage(join(modules, 'dsh-noentry'), { name: 'dsh-noentry', version: '1.0.0', main: 'lib/index.js' });
    const removals = [];
    const missingEntry = await acceptInstalledPackage('dsh-noentry', '已安装', async args => {
      removals.push(args);
    }, async () => true);
    assert.equal(missingEntry.ok, false);
    assert.match(missingEntry.error, /缺入口文件/);
    assert.deepEqual(removals, [['remove', 'dsh-noentry']]);

    // 源码里的相对 import 落不了地
    const broken = join(modules, 'dsh-broken');
    await writePackage(broken, { name: 'dsh-broken', version: '1.0.0', main: 'index.js' });
    await writeFile(join(broken, 'index.js'), "import './missing-module.js';\n");
    const removals2 = [];
    const withGaps = await acceptInstalledPackage('dsh-broken', '已安装', async args => {
      removals2.push(args);
    }, async () => true);
    assert.equal(withGaps.ok, false);
    assert.match(withGaps.error, /缺少模块/);
    assert.deepEqual(removals2, [['remove', 'dsh-broken']]);
  });
});

serialTest('acceptInstalledPackage：清钉时包目录删不掉也不影响后续流程', async () => {
  await withTempHome('dsh-pm-pinned-', async home => {
    const { modules } = await makeProfile(home);
    // node_modules/a 是个文件 → <modules>/a/b 删不掉（ENOTDIR）
    await writeFile(join(modules, 'a'), 'not a directory');
    const commands = [];
    const result = await acceptInstalledPackage('a/b', '已安装', async args => {
      commands.push(args);
    }, async () => false, 'a/b@2.0.0');
    assert.equal(result.ok, false, '没物化就回滚');
    assert.ok(commands.some(args => args[0] === 'add'), '清钉后仍然重装了一次');
  });
});

serialTest('missingPackageEntries：main / exports 入口缺失都报出来，读不到 manifest 时不误报', async () => {
  await withTempHome('dsh-pm-entry-', async home => {
    const dir = join(home, 'pkg');
    await mkdir(dir, { recursive: true });
    assert.deepEqual(await missingPackageEntries(dir), [], '没有 package.json 时无从校验');

    await writePackage(dir, { name: 'demo', version: '1.0.0', main: 'lib/index.js', exports: { './client': 'client/index.js' } });
    const missing = await missingPackageEntries(dir);
    assert.ok(missing.includes('lib/index.js'), 'main 缺失要报');
    assert.ok(missing.includes('client/index.js'), 'exports[\'./client\'] 缺失要报');

    await writeFile(join(dir, 'lib', 'index.js').replace('lib', 'lib'), '').catch(() => {});
    await mkdir(join(dir, 'lib'), { recursive: true });
    await writeFile(join(dir, 'lib', 'index.js'), 'export default 1;\n');
    await mkdir(join(dir, 'client'), { recursive: true });
    await writeFile(join(dir, 'client', 'index.js'), 'export default 1;\n');
    assert.deepEqual(await missingPackageEntries(dir), [], '入口都在就不报');

    // manifest 读不出来（坏 JSON）时按「无从校验」处理
    await writeFile(join(dir, 'package.json'), '{ broken json');
    assert.deepEqual(await missingPackageEntries(dir), []);
  });
});

// ---------------------------------------------------------------------------
// 5) 已安装列表：用户插件 / 内置插件 / 损坏残留 / 安装时间
// ---------------------------------------------------------------------------

serialTest('listInstalledPlugins：用户插件、内置插件、损坏残留都认得出来，core 层不误列', async () => {
  await withTempHome('dsh-pm-list-', async home => {
    const { web, modules } = await makeProfile(home);

    // manifest 里还没有 dsh.profile.bundles：一个插件都不算
    await writeFile(join(web, 'package.json'), JSON.stringify({ name: 'dsh-web-profile' }, null, 2));
    assert.deepEqual(await listInstalledPlugins(), [], 'profile manifest 没声明 bundles 时没有用户插件');

    // profile manifest 声明的用户层
    await writeFile(join(web, 'package.json'), JSON.stringify({
      dsh: {
        profile: {
          bundles: ['dsh-user', '@deepseek-ai/dsh-base', 'dsh-not-installed', 'dsh-nameless', 'dsh-noversion', 'dsh-archive-manager']
        }
      }
    }, null, 2));

    // 用户插件（普通目录）
    await writePackage(join(modules, 'dsh-user'), { name: 'dsh-user', version: '1.2.3', description: '用户插件' });
    // manifest 里声明了但 node_modules 里没有
    // manifest 里声明了但 package.json 没有 name
    await writePackage(join(modules, 'dsh-nameless'), { version: '9.9.9' });
    // manifest 里声明了但 package.json 没有 version
    await writePackage(join(modules, 'dsh-noversion'), { name: 'dsh-noversion' });

    // 内置插件：链接到启动器自带的目录（link 目标里带 DSHArchiveManager 标记）
    const launcher = join(home, 'launcher', 'DSHArchiveManager');
    await mkdir(launcher, { recursive: true });
    await writePackage(launcher, { name: 'dsh-archive-manager', version: '0.1.0' });
    await writeFile(join(launcher, 'cordis.patch.yml'), '- insert:\n    - id: dsh-archive-manager\n      name: dsh-archive-manager\n');
    await linkDir(launcher, join(modules, 'DSHArchiveManager'));
    // 同一个内置插件按包名再链一次：manifest 里声明 bundles 时也能按它认领
    await linkDir(launcher, join(modules, 'dsh-archive-manager'));

    // 损坏残留：悬空链接
    await linkDangling(join(home, 'gone', 'dsh-broken'), join(modules, 'dsh-broken'));

    // core 层的悬空残留不列为 broken（用户既升不了也卸不掉）
    await linkDangling(join(home, 'gone', 'dsh-core'), join(modules, '@deepseek-ai', 'dsh-core'));

    // scope 包（@scope/name）：普通 npm 依赖不算用户插件，但它是内置插件时会被认出来
    const scopedLauncher = join(home, 'launcher', 'DSHArchiveManager-scoped');
    await writePackage(scopedLauncher, { name: '@scope/dsh-scoped', version: '0.2.0' });
    await linkDir(scopedLauncher, join(modules, '@scope', 'dsh-scoped'));
    await writePackage(join(modules, '@scope', 'dsh-plain'), { name: '@scope/dsh-plain', version: '0.3.0' });

    const list = await listInstalledPlugins();
    const byName = new Map(list.map(item => [item.name, item]));

    assert.equal(byName.get('dsh-user')?.source, 'user');
    assert.equal(byName.get('dsh-user')?.version, '1.2.3');
    assert.equal(byName.get('dsh-user')?.description, '用户插件');
    assert.equal(byName.get('dsh-noversion')?.version, null, 'package.json 没写 version 时是 null');
    assert.equal(byName.get('dsh-archive-manager')?.source, 'bundled', '启动器自带的算内置插件');
    assert.equal(byName.get('dsh-broken')?.source, 'broken');
    assert.equal(byName.get('dsh-broken')?.broken, true);
    assert.equal(byName.get('dsh-not-installed'), undefined, 'manifest 里有但没装的不列');
    assert.equal(byName.get('dsh-nameless'), undefined, '没有 name 的不算插件');
    assert.equal(byName.get('@deepseek-ai/dsh-base'), undefined, 'core 层不是用户插件');
    assert.equal(byName.get('@deepseek-ai/dsh-core'), undefined, 'core 层的悬空残留不列为 broken');
    assert.equal(byName.get('@scope/dsh-scoped')?.source, 'bundled', 'scope 下的内置插件也认得出来');
    assert.equal(byName.get('@scope/dsh-scoped')?.version, '0.2.0');
    assert.equal(byName.get('@scope/dsh-plain'), undefined, '普通 npm 依赖不是用户插件');

    // 用户插件排在内置插件前面
    const userIndex = list.findIndex(item => item.name === 'dsh-user');
    const bundledIndex = list.findIndex(item => item.name === 'dsh-archive-manager');
    assert.ok(userIndex < bundledIndex, '用户插件在内置插件前面');
  });
});

serialTest('listInstalledPlugins：安装时间取来源标记与目录 mtime，取不到时为 null', async () => {
  await withTempHome('dsh-pm-time-', async home => {
    const { web, modules } = await makeProfile(home);
    await writeFile(join(web, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-marked'] } } }));

    const marked = join(modules, 'dsh-marked');
    await writePackage(marked, { name: 'dsh-marked', version: '1.0.0' });
    // 标记里的时间比目录 mtime 新时取标记的
    const stamp = '2099-01-02T03:04:05.000Z';
    await writeFile(join(marked, '.dsh-source.json'), JSON.stringify({ clonedAt: stamp, updatedAt: stamp }));

    const list = await listInstalledPlugins();
    const item = list.find(entry => entry.name === 'dsh-marked');
    assert.ok(item, '插件在列表里');
    assert.equal(new Date(item.installedAt).toISOString(), stamp, '来源标记里的时间最准');

    // 标记比目录 mtime 旧时取 mtime（取的是几个信号里最新的那个）
    const older = join(modules, 'dsh-older');
    await writePackage(older, { name: 'dsh-older', version: '1.0.0' });
    await writeFile(join(older, '.dsh-source.json'), JSON.stringify({ clonedAt: '2000-01-01T00:00:00.000Z' }));
    await writeFile(join(web, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-older'] } } }));
    const olderItem = (await listInstalledPlugins()).find(entry => entry.name === 'dsh-older');
    assert.ok(new Date(olderItem.installedAt).getTime() > Date.parse('2000-01-01T00:00:00.000Z'), '旧标记让位给目录 mtime');

    // 没有标记时退到目录 mtime
    const plain = join(modules, 'dsh-plain');
    await writePackage(plain, { name: 'dsh-plain', version: '1.0.0' });
    await writeFile(join(web, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-plain'] } } }));
    const plainItem = (await listInstalledPlugins()).find(entry => entry.name === 'dsh-plain');
    assert.ok(plainItem.installedAt, '退到目录 mtime 也有值');
  });
});

// ---------------------------------------------------------------------------
// 6) 停用 / 启用
// ---------------------------------------------------------------------------

serialTest('readDisabledState：畸形记录自愈，不可停用与不安全行 id 一律丢弃', async () => {
  await withTempHome('dsh-pm-state-', async home => {
    const stateFile = join(home, 'plugin-manager', 'disabled.json');
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      version: 1,
      disabled: [
        { bundle: 'dsh-a', rowIds: ['row-a'], disabledAt: '2024-01-01T00:00:00.000Z' },
        { bundle: 'dsh-a', rowIds: ['row-dup'], disabledAt: '2024-01-01T00:00:00.000Z' },
        { bundle: '@deepseek-ai/dsh-base', rowIds: ['session'] },
        { bundle: 'dsh-plugin-manager', rowIds: ['pm'] },
        { bundle: '../evil', rowIds: ['x'] },
        { bundle: 'dsh-b', rowIds: [] },
        { bundle: 'dsh-c', rowIds: ['bad id'], disabledAt: 123 },
        { bundle: 'dsh-d', rowIds: ['row-d', 'row-d'] },
        'not-an-object'
      ]
    }));

    const state = await readDisabledState({ stateFile });
    const byBundle = new Map(state.map(entry => [entry.bundle, entry]));
    assert.deepEqual([...byBundle.keys()], ['dsh-a', 'dsh-d'], '重复、不可停用、非法名、空行 id 都丢掉');
    assert.deepEqual(byBundle.get('dsh-a').rowIds, ['row-a']);
    assert.equal(byBundle.get('dsh-a').disabledAt, '2024-01-01T00:00:00.000Z');
    assert.equal(byBundle.get('dsh-d').disabledAt, null, 'disabledAt 不是字符串时记 null');

    // 文件不存在 / 坏 JSON
    assert.deepEqual(await readDisabledState({ stateFile: join(home, 'nope.json') }), []);
    await writeFile(stateFile, '{ broken');
    assert.deepEqual(await readDisabledState({ stateFile }), []);
  });
});

serialTest('setPluginDisabled：拒绝非法名与不可停用插件，停用写入、启用移除', async () => {
  await withTempHome('dsh-pm-set-', async home => {
    const { web, modules } = await makeProfile(home);
    await writePackage(join(modules, 'dsh-a'), { name: 'dsh-a', version: '1.0.0' });
    await writePackage(join(modules, 'dsh-b'), { name: 'dsh-b', version: '1.0.0' });
    await writeFile(join(web, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-a', 'dsh-b'] } } }));
    const stateFile = join(home, 'plugin-manager', 'disabled.json');

    const bad = await setPluginDisabled('bad name', true, { stateFile });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'bad-name');

    const protectedOne = await setPluginDisabled('dsh-plugin-manager', true, { stateFile });
    assert.equal(protectedOne.ok, false);
    assert.equal(protectedOne.code, 'protected');

    const notInstalled = await setPluginDisabled('dsh-missing', true, { stateFile });
    assert.equal(notInstalled.ok, false);
    assert.equal(notInstalled.code, 'not-installed');

    const noRows = await setPluginDisabled('dsh-a', true, { stateFile, rowsByBundle: new Map() });
    assert.equal(noRows.ok, false);
    assert.equal(noRows.code, 'row-not-found', '找不到行 id 绝不写空覆盖');

    const disabled = await setPluginDisabled('dsh-a', true, {
      stateFile,
      rowsByBundle: new Map([['dsh-a', ['row-a']]])
    });
    assert.equal(disabled.ok, true);
    assert.deepEqual(disabled.rowIds, ['row-a']);
    assert.equal(disabled.restartRequired, true);

    const state = await readDisabledState({ stateFile });
    assert.deepEqual(state.map(entry => entry.bundle), ['dsh-a']);

    // 再停用一个别的插件：已有记录保留，新记录追加
    const second = await setPluginDisabled('dsh-b', true, {
      stateFile,
      rowsByBundle: new Map([['dsh-b', ['row-b']]])
    });
    assert.equal(second.ok, true);
    assert.deepEqual((await readDisabledState({ stateFile })).map(entry => entry.bundle), ['dsh-a', 'dsh-b']);
    assert.equal((await setPluginDisabled('dsh-b', false, { stateFile })).ok, true);

    const enabled = await setPluginDisabled('dsh-a', false, { stateFile });
    assert.equal(enabled.ok, true);
    assert.equal(enabled.disabled, false);
    assert.deepEqual(enabled.rowIds, ['row-a'], '启用时回传被移除的行 id');
    assert.deepEqual(await readDisabledState({ stateFile }), []);

    const noop = await setPluginDisabled('dsh-a', false, { stateFile });
    assert.equal(noop.ok, true, '启用一个本来没停用的插件也算成功');
    assert.deepEqual(noop.rowIds, []);

    // 不给 stateFile 时写默认位置（$DSH_HOME/plugin-manager/disabled.json）
    const defaultState = await setPluginDisabled('dsh-b', true, {
      skipInstalledCheck: true,
      rowsByBundle: new Map([['dsh-b', ['row-b']]])
    });
    assert.equal(defaultState.ok, true);
    const defaultFile = join(home, 'plugin-manager', 'disabled.json');
    const defaultEntries = await readDisabledState({ stateFile: defaultFile });
    assert.deepEqual(defaultEntries.map(entry => entry.bundle), ['dsh-b']);
  });
});

serialTest('setPluginDisabled：状态文件写不下去时如实报 io 错误', async () => {
  await withTempHome('dsh-pm-io-', async home => {
    const { modules } = await makeProfile(home);
    await writePackage(join(modules, 'dsh-a'), { name: 'dsh-a', version: '1.0.0' });
    const stateFile = join(home, 'plugin-manager', 'disabled.json');
    // 原子写的 staging 路径被一个同名目录占住 → 写入必然失败
    await mkdir(`${stateFile}.${process.pid}.tmp`, { recursive: true });

    const result = await setPluginDisabled('dsh-a', true, {
      stateFile,
      rowsByBundle: new Map([['dsh-a', ['row-a']]])
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'io');
    assert.match(result.error, /写入停用状态失败/);
  });
});

serialTest('removeDisabledBundle：清掉记录，名字非法返回 false，写不了也返回 false', async () => {
  await withTempHome('dsh-pm-rm-', async home => {
    const stateFile = join(home, 'plugin-manager', 'disabled.json');
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      version: 1,
      disabled: [{ bundle: 'dsh-a', rowIds: ['row-a'], disabledAt: '2024-01-01T00:00:00.000Z' }]
    }));

    assert.equal(await removeDisabledBundle('bad name', { stateFile }), false, '名字非法直接拒绝');
    assert.equal(await removeDisabledBundle('dsh-a', { stateFile }), true, '有记录才清');
    assert.deepEqual(await readDisabledState({ stateFile }), []);
    assert.equal(await removeDisabledBundle('dsh-a', { stateFile }), false, '没有记录时返回 false');

    // 状态目录建不出来（父路径是个文件）时如实返回 false
    const blocker = join(home, 'blocker');
    await writeFile(blocker, 'not a directory');
    assert.equal(
      await removeDisabledBundle('dsh-a', { stateFile: join(blocker, 'sub', 'disabled.json') }),
      false,
      '写不了状态文件时返回 false，不抛异常'
    );
  });
});

serialTest('describeDisabledPlugins：合成已安装列表与停用状态，找不到行 id 时禁用开关', async () => {
  await withTempHome('dsh-pm-describe-', async home => {
    const stateFile = join(home, 'plugin-manager', 'disabled.json');
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({
      version: 1,
      disabled: [
        { bundle: 'dsh-off', rowIds: ['row-off'], disabledAt: '2024-01-01T00:00:00.000Z' },
        { bundle: '@alice/dsh-own-plugin', rowIds: ['stale-row'], disabledAt: '2024-01-01T00:00:00.000Z' }
      ]
    }));

    const described = await describeDisabledPlugins({
      installed: [{ name: 'dsh-off' }, { name: 'dsh-on' }, { name: '@alice/dsh-own-plugin' }, { name: 'bad name' }],
      stateFile,
      dump: DUMP_FIXTURE,
      force: true
    });
    const byBundle = new Map(described.items.map(item => [item.bundle, item]));
    assert.equal(byBundle.get('dsh-off')?.disabled, true);
    assert.equal(byBundle.get('dsh-off')?.canDisable, true);
    assert.equal(byBundle.get('dsh-on')?.disabled, false);
    assert.equal(byBundle.get('dsh-on')?.canDisable, false, '找不到行 id 时不给停用');
    assert.match(byBundle.get('dsh-on')?.reason ?? '', /没有从 dsh 配置里定位到/);
    assert.equal(byBundle.has('bad name'), false, '非法名字的条目直接跳过');
    assert.deepEqual(
      byBundle.get('@alice/dsh-own-plugin')?.rowIds,
      ['alice-row', 'alice-group'],
      'dump 里认出的行 id 比状态文件里记的更新'
    );

    // 不传 installed 时自己列已安装插件
    const selfListed = await describeDisabledPlugins({ stateFile, force: true });
    assert.ok(Array.isArray(selfListed.items));
  });
});

serialTest('describeDisabledPlugins：行 id 发现出错时不让整个视图挂掉', async () => {
  await withTempHome('dsh-pm-describe2-', async home => {
    // dump 拿不到（dsh 跑不起来）→ 回退到插件自己的 patch 声明；modulesDir 传成
    // 非字符串 → 行 id 发现抛错 → 被兜住
    execHook = call => {
      if (call.file.includes('dsh')) throw execError('dsh 不存在');
      return { stdout: '', stderr: '' };
    };
    const described = await describeDisabledPlugins({
      installed: [{ name: 'dsh-a' }],
      patches: [],
      modulesDir: 42
    });
    assert.equal(described.items.length, 1);
    assert.equal(described.items[0].bundle, 'dsh-a');
    assert.equal(described.items[0].rowIds.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 7) 行 id 发现：dump 解析、缓存、补丁路径
// ---------------------------------------------------------------------------

serialTest('discoverPluginRowIds：解析 dump 并按指纹缓存，force 可强刷', async () => {
  await withTempHome('dsh-pm-discover-', async home => {
    const first = await discoverPluginRowIds({ dump: DUMP_FIXTURE, fingerprint: 'fx-1' });
    assert.deepEqual(first.get('@alice/dsh-own-plugin'), ['alice-row', 'alice-group']);
    assert.deepEqual(first.get('bundled-plugin'), ['bundled-row']);

    const cached = await discoverPluginRowIds({ fingerprint: 'fx-1' });
    assert.equal(cached, first, '同指纹直接吃缓存');
    const forced = await discoverPluginRowIds({ dump: DUMP_FIXTURE, fingerprint: 'fx-1', force: true });
    assert.deepEqual(forced.get('bundled-plugin'), ['bundled-row']);
  });
});

serialTest('discoverPluginRowIds：dump 失败时按空处理，不让整条链路挂掉', async () => {
  await withTempHome('dsh-pm-discover-fail-', async home => {
    execHook = call => {
      if (call.file.includes('dsh')) throw execError('dsh 不存在');
      return { stdout: '', stderr: '' };
    };
    const map = await discoverPluginRowIds({ force: true });
    assert.equal(map.size, 0, '拿不到 dump 时没有行 id');
  });
});

serialTest('discoverPluginRowIds：跑 dsh web --dump-config 并带上 --patch', async () => {
  await withTempHome('dsh-pm-dump-', async home => {
    const { web } = await makeProfile(home);
    const patch = join(web, 'cordis.patch.yml');
    await writeFile(patch, '- insert:\n    - id: x\n');

    execHook = call => {
      if (call.file.includes('dsh')) return { stdout: DUMP_FIXTURE, stderr: '' };
      return { stdout: '', stderr: '' };
    };
    const map = await discoverPluginRowIds({ argv: ['dsh', 'web', '--patch', patch], force: true });
    assert.deepEqual(map.get('@alice/dsh-own-plugin'), ['alice-row', 'alice-group']);
    const dumpCall = execLog.filter(call => call.file.includes('dsh')).at(-1);
    assert.deepEqual(dumpCall.args.slice(0, 2), ['web', '--dump-config']);
    assert.ok(dumpCall.args.includes(patch), '存在的 --patch 路径会带进命令');
  });
});

serialTest('discoverPluginRowIds：显式给的 patches 原样带给 dsh', async () => {
  await withTempHome('dsh-pm-patches-', async home => {
    execHook = call => (call.file.includes('dsh') ? { stdout: DUMP_FIXTURE, stderr: '' } : { stdout: '', stderr: '' });
    await discoverPluginRowIds({ patches: ['/a.yml', '/b.yml'], force: true });
    const dumpCall = execLog.filter(call => call.file.includes('dsh')).at(-1);
    assert.deepEqual(dumpCall.args, ['web', '--dump-config', '--patch', '/a.yml', '--patch', '/b.yml']);
  });
});

serialTest('launcherPatchPaths：给了 patches 数组时去重并丢掉非字符串', async (t) => {
  if (typeof pm.launcherPatchPaths !== 'function') {
    t.skip('当前 lib/index.js 里没有 launcherPatchPaths');
    return;
  }
  // 注意：生产路径上这一段走不到（调用点都用 `options.patches ?? launcherPatchPaths(...)`，
  // 数组时短路），所以这里直接调模块私有函数把它锁住：将来有人改调用点时，
  // 至少知道这段的去重/过滤语义是什么。
  const patches = await pm.launcherPatchPaths({ patches: ['/a.yml', '/a.yml', '', 42, '/b.yml'] });
  assert.deepEqual(patches, ['/a.yml', '/b.yml']);
});

serialTest('launcherBasePatchPath：能从 node_modules 里的 DSHArchiveManager 软链反查启动器补丁', async () => {
  await withTempHome('dsh-pm-base-', async home => {
    const { modules } = await makeProfile(home);
    const launcher = join(home, 'app', 'DSHArchiveManager');
    await mkdir(launcher, { recursive: true });
    await writeFile(join(launcher, 'cordis.patch.yml'), '- insert:\n    - id: x\n');
    await linkDir(launcher, join(modules, 'DSHArchiveManager'));

    execHook = call => (call.file.includes('dsh') ? { stdout: '', stderr: '' } : { stdout: '', stderr: '' });
    await discoverPluginRowIds({ force: true });
    const dumpCall = execLog.filter(call => call.file.includes('dsh')).at(-1);
    assert.ok(dumpCall.args.some(arg => String(arg).endsWith('cordis.patch.yml')), '反查到的补丁路径带进了命令');
  });
});

serialTest('pluginRowIds：dump 里没有行时，dump 失败才回退插件自己的 patch 声明', async () => {
  await withTempHome('dsh-pm-rows-', async home => {
    const { web, modules } = await makeProfile(home);
    await mkdir(join(modules, 'fallback-plugin'), { recursive: true });
    await writeFile(join(modules, 'fallback-plugin', 'cordis.patch.yml'), '- insert:\n    - id: fallback-row\n      name: fallback-plugin\n');
    // 没有 cordis.patch.yml 的插件：回退时读不到声明，如实给空
    await mkdir(join(modules, 'no-patch-plugin'), { recursive: true });
    await writeFile(join(web, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['fallback-plugin'] } } }));

    // dump 成功但树里没有它：不回退（当前没装配，写 overlay 等于写不存在的行）
    assert.deepEqual(await pluginRowIds('fallback-plugin', { dump: DUMP_FIXTURE, force: true }), []);
    // dump 里有它：直接用 dump 的行 id
    assert.deepEqual(
      await pluginRowIds('@alice/dsh-own-plugin', { dump: DUMP_FIXTURE, force: true }),
      ['alice-row', 'alice-group']
    );

    // dump 失败：回退到插件自己的 insert 声明
    execHook = call => {
      if (call.file.includes('dsh')) throw execError('dsh 不存在');
      return { stdout: '', stderr: '' };
    };
    assert.deepEqual(await pluginRowIds('fallback-plugin', { force: true }), ['fallback-row']);
    assert.deepEqual(await pluginRowIds('no-patch-plugin', { force: true }), [], '插件自己没有声明就没有行 id');

    // 名字非法直接返回空
    assert.deepEqual(await pluginRowIds('bad name', { force: true }), []);

    // 也可以直接注入行 id（Map 与普通对象两种写法）
    assert.deepEqual(await pluginRowIds('fallback-plugin', { rowsByBundle: new Map([['fallback-plugin', ['r1', 'r2']]]) }), ['r1', 'r2']);
    assert.deepEqual(await pluginRowIds('fallback-plugin', { rowsByBundle: { 'fallback-plugin': ['r3'] } }), ['r3']);
  });
});

serialTest('pluginRowIds：指纹相同就吃缓存，不重新 dump', async () => {
  await withTempHome('dsh-pm-rows-cache-', async home => {
    const first = await discoverPluginRowIds({ dump: DUMP_FIXTURE, fingerprint: 'fx-rows' });
    assert.deepEqual(first.get('@alice/dsh-own-plugin'), ['alice-row', 'alice-group']);
    const rows = await pluginRowIds('@alice/dsh-own-plugin', { fingerprint: 'fx-rows' });
    assert.deepEqual(rows, ['alice-row', 'alice-group'], '同指纹走缓存');
  });
});

// ---------------------------------------------------------------------------
// 8) pnpm 工作区与原子写
// ---------------------------------------------------------------------------

serialTest('ensurePnpmWorkspace：没有就建、已有 allowBuilds 就不动、否则补上', async () => {
  await withTempHome('dsh-pm-workspace-', async home => {
    const { web } = await makeProfile(home);
    const workspace = join(web, 'pnpm-workspace.yaml');

    await ensurePnpmWorkspace();
    const created = await readFile(workspace, 'utf8');
    assert.match(created, /dangerouslyAllowAllBuilds: true/);
    assert.match(created, /nodeLinker: hoisted/);

    await writeFile(workspace, 'packages:\n  - .\n\ndangerouslyAllowAllBuilds: true\n');
    await ensurePnpmWorkspace();
    assert.equal(await readFile(workspace, 'utf8'), 'packages:\n  - .\n\ndangerouslyAllowAllBuilds: true\n', '已经允许构建就不动');

    await writeFile(workspace, 'packages:\n  - .\n');
    await ensurePnpmWorkspace();
    const patched = await readFile(workspace, 'utf8');
    assert.match(patched, /dangerouslyAllowAllBuilds: true/);
  });
});

serialTest('原子写：清掉上次留下的临时文件，活进程的 staging 不动', async () => {
  await withTempHome('dsh-pm-atomic-', async home => {
    const { web } = await makeProfile(home);
    const stateFile = join(home, 'plugin-manager', 'disabled.json');
    await mkdir(join(home, 'plugin-manager'), { recursive: true });

    // 上次进程被 kill 留下的临时文件（pid 已不在）
    const dead = `${stateFile}.999999.tmp`;
    // 别的活进程正在写的临时文件
    const alive = `${stateFile}.424242.tmp`;
    // 本进程自己的 staging（写之前就存在）
    const mine = `${stateFile}.${process.pid}.tmp`;
    await writeFile(dead, 'stale');
    await writeFile(alive, 'busy');
    await writeFile(mine, 'mine');

    await withStubbedKill(pid => {
      if (pid === 424242) return true;      // 活进程：signal 0 不报错
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    }, async () => {
      const result = await setPluginDisabled('dsh-a', true, {
        stateFile,
        skipInstalledCheck: true,
        rowsByBundle: new Map([['dsh-a', ['row-a']]])
      });
      assert.equal(result.ok, true);
    });

    await assert.rejects(readFile(dead), '死进程留下的临时文件被清掉');
    assert.ok(await readFile(alive, 'utf8'), '活进程的临时文件保留');

    // 清不掉的残留（同名目录里有东西）不影响本次写入，错误被兜住
    const stubborn = `${stateFile}.999998.tmp`;
    await mkdir(join(stubborn, 'inner'), { recursive: true });
    await writeFile(join(stubborn, 'inner', 'keep.txt'), 'keep');
    await withStubbedKill(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    }, async () => {
      const result = await setPluginDisabled('dsh-b', true, {
        stateFile,
        skipInstalledCheck: true,
        rowsByBundle: new Map([['dsh-b', ['row-b']]])
      });
      assert.equal(result.ok, true, '残留清不掉也要把本次状态写下去');
    });
  });
});

serialTest('原子写：EPERM（进程还在只是没权限）时也保留临时文件', async () => {
  await withTempHome('dsh-pm-eperm-', async home => {
    const stateFile = join(home, 'plugin-manager', 'disabled.json');
    await mkdir(join(home, 'plugin-manager'), { recursive: true });
    const busy = `${stateFile}.424243.tmp`;
    await writeFile(busy, 'busy');

    await withStubbedKill(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    }, async () => {
      await setPluginDisabled('dsh-a', true, {
        stateFile,
        skipInstalledCheck: true,
        rowsByBundle: new Map([['dsh-a', ['row-a']]])
      });
    });
    assert.equal(await readFile(busy, 'utf8'), 'busy', 'EPERM 视为进程还活着，不删');
  });
});

// ---------------------------------------------------------------------------
// 9) dsh CLI 调用与 git 子命令
// ---------------------------------------------------------------------------

serialTest('uninstallPlugin：走 dsh CLI 卸载，并回读确认残留', async () => {
  await withTempHome('dsh-pm-uninstall-', async home => {
    const { web, modules } = await makeProfile(home);
    await writePackage(join(modules, 'dsh-a'), { name: 'dsh-a', version: '1.0.0' });
    await writeFile(join(web, 'package.json'), JSON.stringify({ dependencies: { 'dsh-a': '^1.0.0' } }));

    execHook = call => {
      if (call.file.includes('dsh')) return { stdout: 'removed\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };

    const protectedOne = await uninstallPlugin('dsh-plugin-manager');
    assert.equal(protectedOne.ok, false, '内置插件不许卸载');

    const result = await uninstallPlugin('dsh-a');
    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(result.needsRestart, true);
    const cliCall = execLog.filter(call => call.file.includes('dsh')).at(-1);
    assert.deepEqual(cliCall.args, ['plugin', '--profile', 'web', 'remove', 'dsh-a']);
  });
});

serialTest('applyPluginUpdate：本地开发目录走 pull-local，就地更新用 git 读回状态', async () => {
  await withTempHome('dsh-pm-pull-', async home => {
    const checkout = join(home, 'dev', 'dsh-demo');
    await mkdir(checkout, { recursive: true });
    await writeFile(join(checkout, 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.0.0' }));

    execHook = call => {
      const args = call.args;
      if (args.includes('--is-inside-work-tree')) return { stdout: 'true', stderr: '' };
      if (args[0] === 'rev-parse' && args.includes('HEAD')) return { stdout: 'main', stderr: '' };
      if (args[0] === 'status') return { stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { stdout: 'origin/main', stderr: '' };
      if (args[0] === 'rev-list') return { stdout: '0\t0', stderr: '' };
      return { stdout: '', stderr: '' };
    };

    const result = await applyPluginUpdate({
      kind: 'git',
      name: 'dsh-demo',
      spec: `link:${checkout}`,
      installedVersion: '1.0.0',
      remote: { author: 'alice', repo: 'dsh-demo', dir: checkout }
    }, {
      check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
      command: async () => ({ stdout: '', stderr: '' }),
      mode: 'pull-local'
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'up-to-date', '上游没有新提交时如实说已是最新');
    assert.ok(execLog.some(call => call.file === 'git' && call.args[0] === 'rev-parse'), '确实跑了 git');
  });
});

serialTest('applyPluginUpdate：git 源更新失败时把旧源码放回原位', async () => {
  await withTempHome('dsh-pm-restore-', async home => {
    const { web } = await makeProfile(home);
    const sourcesRoot = join(web, 'plugin-sources');
    const dir = join(sourcesRoot, 'alice-dsh-demo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-demo', version: '1.0.0' }));

    const source = {
      kind: 'git',
      name: 'dsh-demo',
      spec: 'github:alice/dsh-demo',
      installedVersion: '1.0.0',
      remote: { author: 'alice', repo: 'dsh-demo', dir }
    };
    const check = async () => [{ status: 'update-available', latestVersion: '2.0.0' }];
    const command = async () => ({ stdout: '', stderr: '' });

    // 重新克隆失败 → 旧源码被放回原位
    await assert.rejects(
      applyPluginUpdate(source, { check, command, clone: async () => ({ ok: false, error: '克隆失败' }) }),
      /克隆失败/
    );
    assert.ok(await readFile(join(dir, 'package.json'), 'utf8').then(text => text.includes('dsh-demo')), '旧源码回到原位');

    // 连备份都没了 → 如实说「没能放回原位」
    const dir2 = join(sourcesRoot, 'alice-dsh-other');
    await mkdir(dir2, { recursive: true });
    await writeFile(join(dir2, 'package.json'), JSON.stringify({ name: 'dsh-other' }));
    await assert.rejects(
      applyPluginUpdate({ ...source, name: 'dsh-other', remote: { ...source.remote, dir: dir2 } }, {
        check,
        command,
        clone: async () => {
          // 把刚做的备份删掉，模拟「备份也丢了」
          const { readdir, rm } = await import('node:fs/promises');
          const names = await readdir(sourcesRoot);
          await Promise.all(names.filter(name => name.startsWith('alice-dsh-other.bak-')).map(name => rm(join(sourcesRoot, name), { recursive: true, force: true })));
          return { ok: false, error: '克隆失败' };
        }
      }),
      /没能从 .* 放回原位/
    );
  });
});

// ---------------------------------------------------------------------------
// 10) 模块私有的 runMutation / operationSnapshot
//
// 这两个函数是模块私有的，而且当前 lib/index.js 里**没有任何调用点**（重构后遗留
// 的死代码）。这里通过 loader 钩子给模块补一个 export 来测它们——钩子只在源码
// 末尾追加一行 export，生产的每一个字节都没动，覆盖数据也仍然记在 lib/index.js 上。
// 将来生产代码若把这段死代码删掉，钩子与下面的用例会一起跳过。
// ---------------------------------------------------------------------------

serialTest('runMutation / operationSnapshot：改 profile 的操作走串行队列并留下记录', async (t) => {
  if (typeof pm.runMutation !== 'function' || typeof pm.operationSnapshot !== 'function') {
    t.skip('当前 lib/index.js 里没有 runMutation / operationSnapshot（死代码已被移除）');
    return;
  }
  await withTempHome('dsh-pm-mutation-', async home => {
    const { web } = await makeProfile(home);
    execHook = call => (call.file.includes('dsh') ? { stdout: 'done\n', stderr: '' } : { stdout: '', stderr: '' });

    const result = await pm.runMutation('install', ['dsh-a'], '安装 dsh-a', async ctx => {
      const output = await ctx.command(['remove', 'dsh-a']);
      return { ok: true, stdout: output.stdout };
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.kind, 'install');
    assert.deepEqual(result.targets, ['dsh-a']);

    const snapshot = await pm.operationSnapshot();
    assert.ok(Array.isArray(snapshot.recent));
    assert.ok(snapshot.recent.length >= 1, '操作记录写进了日志');
    assert.equal(snapshot.recent[0].label, '安装 dsh-a');
    assert.ok(snapshot.recent[0].logPath, '每条操作有独立日志');
    assert.ok(snapshot.recent[0].logPath.startsWith(join(web, '.plugin-manager', 'logs')), '日志写在 profile 下');
  });
});

serialTest('runMutation：命令失败时操作记为 failed 并保留失败原因', async (t) => {
  if (typeof pm.runMutation !== 'function') {
    t.skip('当前 lib/index.js 里没有 runMutation（死代码已被移除）');
    return;
  }
  await withTempHome('dsh-pm-mutation-fail-', async home => {
    await makeProfile(home);
    execHook = call => {
      if (call.file.includes('dsh')) throw { code: 'E_NO_MESSAGE' };
      return { stdout: '', stderr: '' };
    };
    const result = await pm.runMutation('uninstall', ['dsh-b'], '卸载 dsh-b', async ctx => {
      await ctx.command(['remove', 'dsh-b']);
      return { ok: true };
    });
    assert.equal(result.status, 'failed');
    assert.match(result.error ?? '', /E_NO_MESSAGE|\[object Object\]/);
  });
});

serialTest('runMutation：不给 targets 时记成空列表', async (t) => {
  if (typeof pm.runMutation !== 'function') {
    t.skip('当前 lib/index.js 里没有 runMutation（死代码已被移除）');
    return;
  }
  await withTempHome('dsh-pm-mutation-notarget-', async home => {
    await makeProfile(home);
    const result = await pm.runMutation('noop', undefined, '空操作', async () => ({ ok: true }));
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.targets, []);
  });
});

// ---------------------------------------------------------------------------
// 11) 环境与市场目录
// ---------------------------------------------------------------------------

serialTest('readMarketplace / refreshMarketplace：市场索引读不到与重建', async () => {
  await withTempHome('dsh-pm-market-', async home => {
    const missing = await pm.readMarketplace();
    assert.equal(missing.ok, false);
    assert.match(missing.error, /尚未下载/);

    // git clone 走假实现：不会真的联网
    execHook = call => (call.file === 'git' ? { stdout: '', stderr: '' } : { stdout: '', stderr: '' });
    const rebuilt = await pm.refreshMarketplace();
    assert.equal(typeof rebuilt.count, 'number');
    const index = JSON.parse(await readFile(join(home, 'plugin-market', 'index.json'), 'utf8'));
    assert.ok(Array.isArray(index.plugins), '市场索引写出来了');
  });
});

serialTest('dshHome：没设 DSH_HOME 时退回用户主目录下的 .dsh（只读，不写用户目录）', async () => {
  const previous = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  try {
    const list = await listInstalledPlugins();
    assert.ok(Array.isArray(list), '没有 DSH_HOME 时读默认位置，不报错');
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
});

serialTest('hasCommandOnPath：POSIX 平台用 : 分隔 PATH', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pm-posix-path-'));
  try {
    await withPlatform('linux', async () => {
      // POSIX 下文件名不带扩展名，按可执行位判断
      await writeFile(join(dir, 'tool'), 'x', { mode: 0o755 });
      const found = await hasCommandOnPath('tool', `${dir}:${dir}`);
      if (REAL_PLATFORM === 'win32') {
        // Windows 的文件模式里没有执行位，POSIX 分支判不出「可执行」——这里只为了
        // 把 POSIX 的分隔符分支跑一遍（真机上这个断言在 POSIX 上是 found）。
        assert.equal(found, null);
      } else {
        assert.equal(found, join(dir, 'tool'));
      }
      assert.equal(await hasCommandOnPath('missing', dir), null);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
