import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyPluginUpdate,
  checkPluginUpdates,
  classifyPluginSource,
  collectPluginSources,
  comparePluginVersions,
  decidePluginUpdate,
  fetchRemotePackageVersion,
  parseLockCommit,
  parsePluginVersion,
  pluginMajorVersion,
  probeGitHead,
  pruneSourceBackups,
  readUpdateCache,
  readUpdateProgress,
  writeUpdateCache,
  runUpdateCheck,
  summarizeUpdateInventory,
  updatePlugin
} from '../lib/index.js';

// 「已安装插件版本检测与更新」的离线单测：所有联网动作（pnpm view / git ls-remote /
// raw.githubusercontent）都通过注入的假 probe 或假 clone 替掉，测试不访问网络。

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 轮询等待条件成立（用于等后台刷新跑完），超时返回 false。 */
async function waitFor(predicate, { timeout = 3000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

/** 在临时 DSH_HOME 下跑测试（跑完恢复原值并删掉临时目录）。 */
async function withTempDshHome(prefix, fn) {
  const previousHome = process.env.DSH_HOME;
  const home = await mkdtemp(join(tmpdir(), prefix));
  process.env.DSH_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 用例 1：版本号解析与比较
// ---------------------------------------------------------------------------

test('用例1 parsePluginVersion / comparePluginVersions 遵循 npm 语义', () => {
  // 数字段按数值比较，不是字典序
  assert.equal(comparePluginVersions('1.2.0', '1.10.0'), -1);
  assert.equal(comparePluginVersions('1.10.0', '1.2.0'), 1);
  assert.equal(comparePluginVersions('1.2.0', '2.0.0'), -1);
  // 同 base 下预发布低于正式版
  assert.equal(comparePluginVersions('1.2.0-rc.1', '1.2.0'), -1);
  // 预发布标识按段比较
  assert.equal(comparePluginVersions('1.2.0-alpha.2', '1.2.0-beta.1'), -1);
  assert.equal(comparePluginVersions('1.2.0-rc.2', '1.2.0-rc.10'), -1);
  // 相同版本 / build 元数据不参与比较 / 前缀 v 被忽略
  assert.equal(comparePluginVersions('1.2.0', '1.2.0'), 0);
  assert.equal(comparePluginVersions('1.2.0+build.7', '1.2.0'), 0);
  assert.equal(comparePluginVersions('v1.2.0', '1.2.0'), 0);

  // 解析结构：base 数字段 + 预发布标识（build 元数据被丢弃）
  assert.deepEqual(parsePluginVersion('v1.2.0+build.7'), { base: [1, 2, 0], pre: null });
  assert.deepEqual(parsePluginVersion('1.2.0-rc.2'), { base: [1, 2, 0], pre: ['rc', '2'] });

  assert.equal(pluginMajorVersion('2.0.0-rc.1'), 2);
  assert.equal(pluginMajorVersion('1.2.0'), 1);
});

// ---------------------------------------------------------------------------
// 用例 2：pnpm-lock.yaml 里解析 git 依赖的 commit
// ---------------------------------------------------------------------------

// 真实形态的 lock 片段：importers 里 `specifier:` 与下一行 `version:` 同行出现，
// version 指向 codeload 的 tar.gz（新写法）或 resolution 里的 commit（老写法）。
const LOCK_TEXT = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      dsh-notify:
        specifier: ^1.2.3
        version: 1.2.3
      TokenLedger:
        specifier: github:zh667/TokenLedger
        version: https://codeload.github.com/zh667/TokenLedger/tar.gz/438d3086249d427e7185a69c5453cb1553c84f0b
      OpenViking:
        specifier: github:volcengine/OpenViking#examples/dsh-memory-plugin
        version: https://codeload.github.com/volcengine/OpenViking/tar.gz/ABCDEF0123456789ABCDEF0123456789ABCDEF01

packages:
  github.com/zh667/TokenLedger/438d3086249d427e7185a69c5453cb1553c84f0b:
    resolution: {tarball: https://codeload.github.com/zh667/TokenLedger/tar.gz/438d3086249d427e7185a69c5453cb1553c84f0b}
`;

test('用例2 parseLockCommit 从 tar.gz 形态的 version 里取出小写 sha', () => {
  assert.equal(parseLockCommit(LOCK_TEXT, 'github:zh667/TokenLedger'), '438d3086249d427e7185a69c5453cb1553c84f0b');
  // 带 #subdir 的 spec 也能取到（窗口从该 specifier 开始）
  assert.equal(parseLockCommit(LOCK_TEXT, 'github:volcengine/OpenViking#examples/dsh-memory-plugin'), 'abcdef0123456789abcdef0123456789abcdef01');
  // 不在 lock 里的 spec → null
  assert.equal(parseLockCommit(LOCK_TEXT, 'github:someone/else'), null);
  // 空输入 / 空 spec → null
  assert.equal(parseLockCommit('', 'github:zh667/TokenLedger'), null);
  assert.equal(parseLockCommit(LOCK_TEXT, null), null);
});

test('用例2 parseLockCommit 也认 resolution 里的 commit 写法（并统一转小写）', () => {
  const lockText = `lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      dsh-legacy:
        specifier: github:owner/legacy
        version: 1.0.0
packages:
  github.com/owner/legacy/0123456789ABCDEF0123456789ABCDEF01234567:
    resolution: {commit: 0123456789ABCDEF0123456789ABCDEF01234567}
`;
  assert.equal(parseLockCommit(lockText, 'github:owner/legacy'), '0123456789abcdef0123456789abcdef01234567');
  // 另一条 spec 不匹配时仍是 null
  assert.equal(parseLockCommit(lockText, 'github:owner/other'), null);
});

// ---------------------------------------------------------------------------
// 用例 3：已安装插件 → 来源归类
// ---------------------------------------------------------------------------

test('用例3 classifyPluginSource 裸名/范围归 npm', () => {
  // 没有依赖记录（手工放进 node_modules 的 npm 包）：仍按同名 npm 包处理
  const bare = classifyPluginSource({ name: 'dsh-notify' });
  assert.equal(bare.kind, 'npm');
  assert.deepEqual(bare.remote, { type: 'npm', package: 'dsh-notify' });
  assert.equal(bare.spec, null);

  // 带范围/标签的 spec 也归到 registry 上的同名包
  const ranged = classifyPluginSource({ name: 'dsh-notify', spec: '^1.2.3', installedVersion: '1.2.3' });
  assert.equal(ranged.kind, 'npm');
  assert.equal(ranged.remote.package, 'dsh-notify');
  assert.equal(ranged.installedVersion, '1.2.3');

  const tagged = classifyPluginSource({ name: '@scope/pkg', spec: 'latest' });
  assert.equal(tagged.kind, 'npm');
  assert.equal(tagged.remote.package, '@scope/pkg');
});

test('用例3 classifyPluginSource 识别 github: / git+https 依赖', () => {
  const gh = classifyPluginSource({ name: 'dsh-notify', spec: 'github:zhengjy01/dsh-notify', installedVersion: '1.2.0' });
  assert.equal(gh.kind, 'git');
  assert.equal(gh.remote.type, 'git');
  assert.equal(gh.remote.author, 'zhengjy01');
  assert.equal(gh.remote.repo, 'dsh-notify');
  assert.equal(gh.remote.subdir, null);
  assert.equal(gh.remote.dir, null);
  assert.equal(gh.remote.url, 'https://github.com/zhengjy01/dsh-notify.git');

  const sub = classifyPluginSource({ name: 'dsh-memory', spec: 'github:owner/repo#packages/foo' });
  assert.equal(sub.kind, 'git');
  assert.equal(sub.remote.author, 'owner');
  assert.equal(sub.remote.repo, 'repo');
  assert.equal(sub.remote.subdir, 'packages/foo');

  const httpsGit = classifyPluginSource({ name: 'ledger', spec: 'git+https://github.com/o/r.git' });
  assert.equal(httpsGit.kind, 'git');
  assert.equal(httpsGit.remote.author, 'o');
  assert.ok(httpsGit.remote.url.startsWith('https://github.com/o/'));
});

test('用例3 classifyPluginSource 用来源标记（.dsh-source.json）反推远端与已装 commit', () => {
  const marker = {
    author: 'owner',
    repo: 'repo',
    subdir: 'packages/foo',
    url: 'https://github.com/owner/repo.git',
    commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  };
  const source = classifyPluginSource({
    name: 'foo',
    spec: 'file:/opt/dsh/plugin-sources/owner-repo-foo',
    installedVersion: '1.0.0',
    installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    marker
  });
  assert.equal(source.kind, 'git');
  assert.equal(source.remote.author, 'owner');
  assert.equal(source.remote.repo, 'repo');
  assert.equal(source.remote.subdir, 'packages/foo');
  assert.equal(source.remote.dir, '/opt/dsh/plugin-sources/owner-repo-foo');
  // marker 里的 commit 优先于 lock 里解析出来的
  assert.equal(source.installedCommit, marker.commit);
});

test('用例3 classifyPluginSource：老克隆目录靠市场索引反推远端，反推不出才算 local', () => {
  const dir = '/opt/dsh/plugin-sources/volcengine-OpenViking-dsh-memory-plugin';
  const marketNames = new Set(['volcengine/openviking-dsh-memory-plugin']);
  const inferred = classifyPluginSource({
    name: 'dsh-memory',
    spec: `file:${dir}`,
    installedVersion: '1.0.0',
    marketNames
  });
  assert.equal(inferred.kind, 'git');
  assert.equal(inferred.remote.author, 'volcengine');
  assert.equal(inferred.remote.repo, 'OpenViking-dsh-memory-plugin');
  assert.equal(inferred.remote.subdir, null);
  assert.equal(inferred.remote.url, 'https://github.com/volcengine/OpenViking-dsh-memory-plugin.git');
  assert.equal(inferred.remote.dir, dir);

  // 市场索引里有目录名但没有可用候选（名字里连 `-` 都没有）→ 本地来源
  const noCandidate = classifyPluginSource({
    name: 'handmade',
    spec: 'file:/opt/dsh/plugin-sources/localplugin',
    installedVersion: '0.1.0',
    marketNames: new Set(['someone/other'])
  });
  assert.equal(noCandidate.kind, 'local');
  assert.equal(noCandidate.remote, null);

  // 市场索引匹配不上时不敢乱猜 author/repo（`tt-a1i/xxx` 会被拆错）→ 本地来源
  const notMatched = classifyPluginSource({
    name: 'dsh-memory',
    spec: `file:${dir}`,
    installedVersion: '1.0.0',
    marketNames: new Set(['someone/other'])
  });
  assert.equal(notMatched.kind, 'local');
  assert.equal(notMatched.remote, null);

  // 没有市场索引（空集）时同样判本地
  const noMarket = classifyPluginSource({
    name: 'dsh-memory',
    spec: `file:${dir}`,
    installedVersion: '1.0.0',
    marketNames: new Set()
  });
  assert.equal(noMarket.kind, 'local');
  assert.equal(noMarket.remote, null);

  // 旧目录仍可被 collectPluginSources → discoverSourceMarker 用 ls-remote 补标记，
  // 这个过程由 discoverSourceMarker 自己负责，不在 classifyPluginSource 里联网。
});

// ---------------------------------------------------------------------------
// 用例 4：是否需要更新
// ---------------------------------------------------------------------------

test('用例4 decidePluginUpdate：小版本/跨大版本/有新提交/ahead/failed/local', () => {
  const minor = decidePluginUpdate({
    kind: 'npm',
    installedVersion: '1.2.0',
    installedCommit: null,
    remote: { version: '1.3.0', channel: 'latest' }
  });
  assert.equal(minor.status, 'update-available');
  assert.equal(minor.latestVersion, '1.3.0');
  assert.equal(minor.channel, 'latest');
  assert.equal(minor.major, false);
  assert.equal(minor.error, null);

  // 跨大版本仍提示，但带上 major 标注
  const major = decidePluginUpdate({
    kind: 'npm',
    installedVersion: '1.9.0',
    installedCommit: null,
    remote: { version: '2.0.0' }
  });
  assert.equal(major.status, 'update-available');
  assert.equal(major.latestVersion, '2.0.0');
  assert.equal(major.major, true);

  // 版本号没变、只是远端有新 commit → 不算可更新，只附注一句
  const commitOnly = decidePluginUpdate({
    kind: 'git',
    installedVersion: '1.2.0',
    installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    remote: { version: '1.2.0', commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
  });
  assert.equal(commitOnly.status, 'up-to-date');
  assert.equal(commitOnly.latestVersion, '1.2.0');
  assert.match(commitOnly.note, /新提交/);

  // 已装的比远端还新
  const ahead = decidePluginUpdate({
    kind: 'npm',
    installedVersion: '1.3.0',
    installedCommit: null,
    remote: { version: '1.2.0' }
  });
  assert.equal(ahead.status, 'ahead');
  assert.equal(ahead.latestVersion, '1.2.0');

  // 探测失败：error 原样带出
  const failed = decidePluginUpdate({
    kind: 'npm',
    installedVersion: '1.2.0',
    installedCommit: null,
    remote: { error: 'registry 不可用：ETIMEDOUT' }
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'registry 不可用：ETIMEDOUT');
  assert.equal(failed.latestVersion, null);

  // 本地来源：不检测，也不报失败
  const local = decidePluginUpdate({ kind: 'local', installedVersion: null, installedCommit: null, remote: null });
  assert.equal(local.status, 'unknown');
  assert.equal(local.error, null);
});

test('用例4 decidePluginUpdate：装正式版时远端只有预发布就不提示', () => {
  const quiet = decidePluginUpdate({
    kind: 'npm',
    installedVersion: '1.2.0',
    installedCommit: null,
    remote: { version: '1.3.0-beta.1', channel: 'latest' }
  });
  assert.equal(quiet.status, 'up-to-date');
  assert.equal(quiet.latestVersion, '1.3.0-beta.1');
  // note 要说明“远端只有预发布版本”
  assert.match(quiet.note, /预发布/);

  // 已装的就是预发布时，预发布之间正常比较
  const prerelease = decidePluginUpdate({
    kind: 'npm',
    installedVersion: '1.3.0-beta.1',
    installedCommit: null,
    remote: { version: '1.3.0-beta.2' }
  });
  assert.equal(prerelease.status, 'update-available');
  assert.equal(prerelease.latestVersion, '1.3.0-beta.2');
  assert.equal(prerelease.major, false);
});

// ---------------------------------------------------------------------------
// 用例 5：清单汇总
// ---------------------------------------------------------------------------

test('用例5 summarizeUpdateInventory 统计各状态条数', () => {
  const summary = summarizeUpdateInventory([
    { status: 'update-available' },
    { status: 'update-available' },
    { status: 'up-to-date' },
    { status: 'ahead' },
    { status: 'failed' },
    { status: 'unknown' }
  ]);
  assert.deepEqual(summary, { total: 6, updateAvailable: 2, failed: 1, unknown: 1 });

  // 空清单 / 非数组入参都不抛错
  assert.deepEqual(summarizeUpdateInventory([]), { total: 0, updateAvailable: 0, failed: 0, unknown: 0 });
  assert.deepEqual(summarizeUpdateInventory(null), { total: 0, updateAvailable: 0, failed: 0, unknown: 0 });
});

// ---------------------------------------------------------------------------
// 用例 6：一轮检测（runUpdateCheck，注入假 probe）
// ---------------------------------------------------------------------------

function sampleSources() {
  return [
    { name: 'dsh-notify', kind: 'npm', spec: '^1.2.3', installedVersion: '1.2.0', installedCommit: null, remote: { type: 'npm', package: 'dsh-notify' } },
    { name: 'TokenLedger', kind: 'git', spec: 'github:zh667/TokenLedger', installedVersion: '1.0.0', installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', remote: { type: 'git', url: 'https://github.com/zh667/TokenLedger.git', author: 'zh667', repo: 'TokenLedger', subdir: null, dir: null } },
    { name: 'handmade', kind: 'local', spec: null, installedVersion: null, installedCommit: null, remote: null }
  ];
}

test('用例6 runUpdateCheck 按来源分派探测并逐条给状态', async () => {
  const calls = { npm: [], git: [] };
  const entries = await runUpdateCheck(sampleSources(), {
    npm: async name => { calls.npm.push(name); return { version: '2.0.0', channel: 'latest' }; },
    git: async remote => { calls.git.push(remote.url); return { version: '1.1.0', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }; }
  });

  // npm 探测收到包名，git 探测收到远端（不会去探测 local）
  assert.deepEqual(calls.npm, ['dsh-notify']);
  assert.deepEqual(calls.git, ['https://github.com/zh667/TokenLedger.git']);

  assert.equal(entries.length, 3);
  const [npmEntry, gitEntry, localEntry] = entries;

  assert.equal(npmEntry.name, 'dsh-notify');
  assert.equal(npmEntry.status, 'update-available');
  assert.equal(npmEntry.latestVersion, '2.0.0');
  assert.equal(npmEntry.major, true); // 1.2.0 → 2.0.0

  assert.equal(gitEntry.status, 'update-available');
  assert.equal(gitEntry.latestVersion, '1.1.0');
  assert.equal(gitEntry.major, false);
  // 远端 commit 与已装 commit 相同 → 不该出现“有新提交”的附注
  assert.equal(gitEntry.note, null);

  // 本地来源没有远端 → unknown（不是 failed）
  assert.equal(localEntry.status, 'unknown');
  assert.equal(localEntry.latestVersion, null);
  assert.equal(localEntry.error, null);
});

test('用例6 runUpdateCheck：单条探测抛错/返回 error 只影响该条', async () => {
  // 一条抛异常、一条正常：抛异常由 mapWithConcurrency 兜底，整条结果被替换成
  // `{error}`（不经过 decidePluginUpdate，所以没有 status），这里只断言错误被带出、
  // 且同批的其它条目不受影响。真实 probe（probeNpmDistTags / probeGitHead）自己
  // 就把异常收成 `{error}` 返回，走的是下面那条路径。
  const mixed = await runUpdateCheck(sampleSources().slice(0, 2), {
    npm: async () => { throw new Error('registry 不可用'); },
    git: async () => ({ version: '1.1.0', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
  });
  assert.match(mixed[0].error, /registry 不可用/);
  // 兜底结果当前没有 status（summary 也不会把它计进 failed）；将来若补成
  // status: 'failed' 这个断言同样成立。
  assert.ok(mixed[0].status === undefined || mixed[0].status === 'failed');
  assert.equal(mixed[1].status, 'update-available');
  assert.equal(mixed[1].latestVersion, '1.1.0');

  // 一条返回 {error}、一条正常
  const withError = await runUpdateCheck(sampleSources().slice(0, 2), {
    npm: async () => ({ version: '2.0.0' }),
    git: async () => ({ error: 'git ls-remote 失败' })
  });
  assert.equal(withError[0].status, 'update-available');
  assert.equal(withError[0].latestVersion, '2.0.0');
  assert.equal(withError[1].status, 'failed');
  assert.equal(withError[1].error, 'git ls-remote 失败');
  assert.equal(withError[1].latestVersion, null);
});

test('用例6 探测函数缺少远端信息时直接返回 error（不联网）', async () => {
  // 只覆盖参数校验分支，不触发任何网络访问
  assert.match((await probeGitHead({})).error, /缺少远端地址/);
  assert.match((await fetchRemotePackageVersion({})).error, /缺少仓库信息/);
  assert.match((await fetchRemotePackageVersion({ author: 'owner' })).error, /缺少仓库信息/);
});

// ---------------------------------------------------------------------------
// 用例 7：执行更新（applyPluginUpdate，注入 check/command/clone）
// ---------------------------------------------------------------------------

const UPDATE_AVAILABLE = [{ status: 'update-available', latestVersion: '2.0.0' }];

test('用例7 applyPluginUpdate：npm 来源执行 `add <name>@<latest>`', async () => {
  const commands = [];
  const source = {
    name: 'dsh-notify',
    kind: 'npm',
    spec: '^1.2.3',
    installedVersion: '1.2.0',
    installedCommit: null,
    remote: { type: 'npm', package: 'dsh-notify' }
  };
  const result = await applyPluginUpdate(source, {
    check: async () => [{ status: 'update-available', latestVersion: '2.0.0' }],
    command: async args => { commands.push(args); return { note: 'ok' }; }
  });

  assert.deepEqual(commands, [['add', 'dsh-notify@2.0.0']]);
  assert.equal(result.ok, true);
  assert.equal(result.updatedTo, '2.0.0');
  assert.equal(result.restartRequired, true);
});

test('用例7 applyPluginUpdate：github: 来源按原 spec 重新解析', async () => {
  const commands = [];
  const source = {
    name: 'TokenLedger',
    kind: 'git',
    spec: 'github:zh667/TokenLedger',
    installedVersion: '1.0.0',
    installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    remote: { type: 'git', url: 'https://github.com/zh667/TokenLedger.git', author: 'zh667', repo: 'TokenLedger', subdir: null, dir: null }
  };
  const result = await applyPluginUpdate(source, {
    check: async () => UPDATE_AVAILABLE,
    command: async args => { commands.push(args); }
  });

  assert.deepEqual(commands, [['add', 'github:zh667/TokenLedger']]);
  assert.equal(result.ok, true);
  assert.equal(result.updatedTo, '2.0.0');
  assert.equal(result.restartRequired, true);
});

test('用例7 applyPluginUpdate：file: 克隆来源先备份、clone 重建、再 add file:<新目录>', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-apply-'));
  try {
    const sourcesDir = join(home, 'plugin-sources');
    const dir = join(sourcesDir, 'owner-repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.js'), '// 旧版本', 'utf8');

    const commands = [];
    const cloneCalls = [];
    const source = {
      name: 'repo',
      kind: 'git',
      spec: `file:${dir}`,
      installedVersion: '1.0.0',
      installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      remote: { type: 'git', url: 'https://github.com/owner/repo.git', author: 'owner', repo: 'repo', subdir: null, dir }
    };

    const result = await applyPluginUpdate(source, {
      check: async () => [{ status: 'update-available', latestVersion: '1.1.0' }],
      command: async args => { commands.push(args); },
      clone: async (ref, subdir) => {
        cloneCalls.push({ ref, subdir });
        // 模拟 clone 成功：把目标目录重建出来并写入新内容
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'index.js'), '// 新版本', 'utf8');
        return { ok: true, dest: dir, packageName: 'repo' };
      }
    });

    // 传给 clone 的引用信息正确
    assert.deepEqual(cloneCalls, [
      { ref: { author: 'owner', repo: 'repo', subdir: null, full: 'owner/repo' }, subdir: null }
    ]);

    // (b) 新目录由 clone 重建
    assert.equal(await readFile(join(dir, 'index.js'), 'utf8'), '// 新版本');
    // (a) 旧目录被改名成 <dir>.bak-<时间戳>，旧内容还在
    const backups = (await readdir(sourcesDir)).filter(name => name.startsWith('owner-repo.bak-'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^owner-repo\.bak-\d{14}$/);
    assert.equal(await readFile(join(sourcesDir, backups[0], 'index.js'), 'utf8'), '// 旧版本');
    // (c) pnpm 记录的是新目录
    assert.deepEqual(commands, [['add', `file:${dir}`]]);

    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '1.1.0');
    assert.equal(result.restartRequired, true);
    assert.match(result.note, /owner-repo\.bak-/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('用例7 applyPluginUpdate：clone 失败时回滚备份（原目录恢复、无 .bak 残留）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-apply-fail-'));
  try {
    const sourcesDir = join(home, 'plugin-sources');
    const dir = join(sourcesDir, 'owner-repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.js'), '// 旧版本', 'utf8');

    const commands = [];
    const source = {
      name: 'repo',
      kind: 'git',
      spec: `file:${dir}`,
      installedVersion: '1.0.0',
      installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      remote: { type: 'git', url: 'https://github.com/owner/repo.git', author: 'owner', repo: 'repo', subdir: null, dir }
    };

    // 当前实现是在 applyPluginUpdate 层直接 throw（由 updatePlugin 兜成 {ok:false}），
    // 所以两种“失败”形态都接受，重点是回滚结果一致。
    let outcome = null;
    try {
      outcome = await applyPluginUpdate(source, {
        check: async () => [{ status: 'update-available', latestVersion: '1.1.0' }],
        command: async args => { commands.push(args); },
        clone: async () => ({ ok: false, error: 'boom' })
      });
    } catch (error) {
      outcome = error;
    }
    if (outcome instanceof Error) assert.match(outcome.message, /boom/);
    else assert.equal(outcome.ok, false);

    // 备份被回滚：原目录内容恢复，且没有 .bak-* 残留
    assert.equal(await readFile(join(dir, 'index.js'), 'utf8'), '// 旧版本');
    assert.deepEqual((await readdir(sourcesDir)).filter(name => name.includes('.bak-')), []);
    // clone 失败时不应去改 pnpm 依赖
    assert.deepEqual(commands, []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('用例7 updatePlugin：clone 失败时公开接口返回 ok:false 且旧目录完好', async () => {
  await withTempDshHome('dsh-pm-update-fail-', async home => {
    const profileDir = join(home, 'profiles', 'web');
    const sourceDir = join(profileDir, 'plugin-sources', 'owner-repo');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, 'index.js'), '// 旧版本', 'utf8');
    await writeFile(join(sourceDir, '.dsh-source.json'), JSON.stringify({
      author: 'owner',
      repo: 'repo',
      subdir: null,
      url: 'https://github.com/owner/repo.git',
      commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }), 'utf8');
    await mkdir(join(profileDir, 'node_modules', 'repo'), { recursive: true });
    await writeFile(join(profileDir, 'node_modules', 'repo', 'package.json'), JSON.stringify({ name: 'repo', version: '1.0.0' }), 'utf8');
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-web-profile',
      dsh: { profile: { bundles: ['repo'] } },
      dependencies: { repo: `file:${sourceDir}` }
    }), 'utf8');

    // 先确认 profile 里的这条依赖被识别成 git 克隆来源
    const sources = await collectPluginSources();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].kind, 'git');
    assert.equal(sources[0].remote.dir, sourceDir);
    assert.equal(sources[0].installedCommit, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    const result = await updatePlugin('repo', {
      check: async () => [{ status: 'update-available', latestVersion: '1.1.0' }],
      command: async () => {},
      clone: async () => ({ ok: false, error: 'boom' })
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /boom/);
    assert.equal(await readFile(join(sourceDir, 'index.js'), 'utf8'), '// 旧版本');
  });
});

test('用例7 applyPluginUpdate：local 来源与“没有可更新版本”都返回 ok:false', async () => {
  const localSource = {
    name: 'handmade',
    kind: 'local',
    spec: 'file:/opt/dsh/plugin-sources/localplugin',
    installedVersion: '0.1.0',
    installedCommit: null,
    remote: null
  };
  const commands = [];
  const local = await applyPluginUpdate(localSource, {
    check: async () => UPDATE_AVAILABLE,
    command: async args => { commands.push(args); }
  });
  assert.equal(local.ok, false);
  assert.equal(local.error, '该插件来源无法自动更新');
  assert.deepEqual(commands, []);

  // 检测结论不是 update-available 时，不带换代动作直接返回失败
  const upToDate = await applyPluginUpdate(localSource, {
    check: async () => [{ status: 'up-to-date', latestVersion: '0.1.0' }]
  });
  assert.equal(upToDate.ok, false);
  assert.equal(upToDate.status, 'up-to-date');
  assert.equal(upToDate.error, '没有检测到可更新的版本');

  // 探测失败时把 error 带出来
  const failed = await applyPluginUpdate(localSource, {
    check: async () => [{ status: 'failed', error: 'registry 不可用' }]
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'registry 不可用');
});

// ---------------------------------------------------------------------------
// 用例 8：备份清理
// ---------------------------------------------------------------------------

test('用例8 pruneSourceBackups 只保留最新的一个备份', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-prune-'));
  try {
    const sourcesDir = join(home, 'plugin-sources');
    const name = 'owner-repo';
    await mkdir(sourcesDir, { recursive: true });
    await mkdir(join(sourcesDir, name), { recursive: true });
    await mkdir(join(sourcesDir, `${name}.bak-1`), { recursive: true });
    await mkdir(join(sourcesDir, `${name}.bak-2`), { recursive: true });

    const removed = await pruneSourceBackups(join(sourcesDir, name));
    assert.deepEqual(removed, [`${name}.bak-1`]);
    const left = (await readdir(sourcesDir)).filter(entry => entry.startsWith(`${name}.bak-`));
    assert.deepEqual(left, [`${name}.bak-2`]);
    assert.ok(await exists(join(sourcesDir, name)));

    // 再来一次没有可删的 → 返回空列表
    assert.deepEqual(await pruneSourceBackups(join(sourcesDir, name)), []);
    // 目录不存在也不抛错
    assert.deepEqual(await pruneSourceBackups(join(home, 'nope', name)), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 用例 9：checkPluginUpdates 的缓存语义（临时 DSH_HOME，跑完恢复）
// ---------------------------------------------------------------------------

test('用例9 checkPluginUpdates：缓存新鲜不联网、force 才重新探测', async () => {
  await withTempDshHome('dsh-pm-updates-', async home => {
    // 空 profile：没有任何可检测的插件来源
    assert.deepEqual(await collectPluginSources(), []);
    // 还没有检测过 → 没有缓存
    assert.equal(await readUpdateCache(), null);

    // 造一个 npm 来源的已装插件（只读本地文件，不联网）
    const profileDir = join(home, 'profiles', 'web');
    await mkdir(join(profileDir, 'node_modules', 'dsh-notify'), { recursive: true });
    await writeFile(join(profileDir, 'node_modules', 'dsh-notify', 'package.json'), JSON.stringify({ name: 'dsh-notify', version: '1.2.0' }), 'utf8');
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-web-profile',
      dsh: { profile: { bundles: ['dsh-notify'] } },
      dependencies: { 'dsh-notify': '^1.2.3' }
    }), 'utf8');

    const sources = await collectPluginSources();
    assert.equal(sources.length, 1);
    assert.equal(sources[0].kind, 'npm');
    assert.equal(sources[0].installedVersion, '1.2.0');

    let probeCalls = 0;
    const probe = {
      npm: async name => {
        probeCalls += 1;
        assert.equal(name, 'dsh-notify');
        await sleep(10); // 让两次刷新的 checkedAt 一定不同
        return { version: '2.0.0', channel: 'latest' };
      },
      git: async () => { throw new Error('npm 来源不应触发 git 探测'); }
    };

    // 首次：没有缓存 → 触发一轮检测。当前实现不阻塞响应（立刻回 refreshing: true），
    // 结果由后台写盘；这里等缓存落盘后再断言内容（对"等结果"的旧形态同样成立）。
    const first = await checkPluginUpdates({ probe });
    assert.equal(typeof first.refreshing, 'boolean');
    assert.ok(Array.isArray(first.inventory));
    assert.ok(await waitFor(async () => (await readUpdateCache())?.inventory?.length === 1), '首次检测应把结果写进缓存');
    assert.equal(probeCalls, 1);

    // 缓存落盘到 profile 下的 .plugin-updates.json，内容与返回结构一致
    const cacheFile = join(profileDir, '.plugin-updates.json');
    assert.ok(await exists(cacheFile));
    const firstCache = await readUpdateCache();
    assert.ok(firstCache.checkedAt);
    const onDisk = JSON.parse(await readFile(cacheFile, 'utf8'));
    assert.equal(onDisk.checkedAt, firstCache.checkedAt);
    const cachedEntry = firstCache.inventory[0];
    assert.equal(cachedEntry.name, 'dsh-notify');
    assert.equal(cachedEntry.status, 'update-available');
    assert.equal(cachedEntry.latestVersion, '2.0.0');

    // 第二次：缓存新鲜且未 force → 不再探测，直接回缓存
    const second = await checkPluginUpdates({ probe });
    assert.equal(probeCalls, 1);
    assert.equal(second.refreshing, false);
    assert.equal(second.checkedAt, firstCache.checkedAt);
    assert.deepEqual(second.summary, { total: 1, updateAvailable: 1, failed: 0, unknown: 0 });
    assert.equal(second.inventory[0].latestVersion, '2.0.0');

    // 等后台那轮彻底收尾（inFlight 清空），再验证 force
    await sleep(20);

    // force：即使缓存新鲜也重新探测，先回旧缓存并在后台改写
    const forced = await checkPluginUpdates({ force: true, probe });
    assert.equal(forced.refreshing, true);
    assert.ok(await waitFor(() => probeCalls === 2), 'force 后应重新探测一次');
    // 等后台把新缓存写完，再还原 DSH_HOME，避免后台写进真实的 ~/.dsh
    assert.ok(await waitFor(async () => (await readUpdateCache())?.checkedAt !== firstCache.checkedAt), '后台应写入新的 checkedAt');
    assert.equal(probeCalls, 2);
  });
});

// ---------------------------------------------------------------------------
// 回归：联调/自测阶段发现的三处缺陷 + 更新进度状态
// ---------------------------------------------------------------------------

test('回归 1：探测函数抛错也要计入 failed（不能只留一个没有 status 的条目）', async () => {
  const entries = await runUpdateCheck([
    { name: 'dsh-notify', kind: 'npm', spec: '^1.2.3', installedVersion: '1.2.0', installedCommit: null, remote: { type: 'npm', package: 'dsh-notify' } }
  ], { npm: async () => { throw new Error('registry 不可用'); } });
  assert.equal(entries[0].status, 'failed');
  assert.match(entries[0].error, /registry 不可用/);
  assert.deepEqual(summarizeUpdateInventory(entries), { total: 1, updateAvailable: 0, failed: 1, unknown: 0 });
});

test('回归 2：`git+https://…/repo.git` 的仓库名不重复 .git 后缀', () => {
  const source = classifyPluginSource({ name: 'demo', spec: 'git+https://github.com/o/r.git', installedVersion: '1.0.0' });
  assert.equal(source.kind, 'git');
  assert.equal(source.remote.repo, 'r');
  assert.equal(source.remote.url, 'https://github.com/o/r.git');
});

test('回归 3：npm spec 不会误取相邻 git 依赖的 commit', () => {
  const sha = 'b'.repeat(40);
  const lock = [
    '  foo:',
    '    specifier: ^1.2.3',
    '    version: 1.2.3',
    '  bar:',
    '    specifier: github:o/r',
    `    version: https://codeload.github.com/o/r/tar.gz/${sha}`
  ].join('\n');
  assert.equal(parseLockCommit(lock, '^1.2.3'), null);
  assert.equal(parseLockCommit(lock, 'github:o/r'), sha);
});

test('进度：单插件更新走 准备 → 步骤 → 完成，并保留结果', async () => {
  await withTempDshHome('dsh-pm-progress-', async home => {
    const profile = join(home, 'profiles', 'web');
    await mkdir(join(profile, 'node_modules', 'demo-plugin'), { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'web', private: true,
      dependencies: { 'demo-plugin': 'github:o/demo-plugin' },
      dsh: { profile: { bundles: ['demo-plugin'] } }
    }));
    await writeFile(join(profile, 'node_modules', 'demo-plugin', 'package.json'), JSON.stringify({ name: 'demo-plugin', version: '1.0.0' }));

    // 进度是模块级状态（同一个插件进程里会一直保留）：这里不假设它是空的，
    // 只要求这次更新自己走完一轮（finishedAt 变化 + 结果只含本次的插件）。
    const before = readUpdateProgress();
    const seen = [];
    const result = await updatePlugin('demo-plugin', {
      check: async sources => sources.map(item => ({ name: item.name, status: 'update-available', latestVersion: '2.0.0', error: null })),
      command: async args => { seen.push({ args, step: readUpdateProgress()?.step, done: readUpdateProgress()?.done }); }
    });
    assert.equal(result.ok, true);
    assert.equal(result.updatedTo, '2.0.0');
    assert.equal(result.restartRequired, true);
    // GitHub 依赖走"重新解析原 spec"，执行命令时进度已经进入这一步
    assert.deepEqual(seen.map(entry => entry.args), [['add', 'github:o/demo-plugin']]);
    assert.match(seen[0].step, /正在重新解析/);
    assert.equal(seen[0].done, 0);

    const progress = readUpdateProgress();
    assert.equal(progress.active, false);
    assert.equal(progress.kind, 'single');
    assert.equal(progress.total, 1);
    assert.equal(progress.done, 1);
    assert.equal(progress.step, '已完成');
    assert.ok(progress.finishedAt);
    assert.notEqual(progress.finishedAt, before?.finishedAt);
    assert.deepEqual(progress.results.map(item => [item.name, item.ok]), [['demo-plugin', true]]);
  });
});

test('进度：批量更新共用一个进度对象（total/done 累加）', async () => {
  await withTempDshHome('dsh-pm-progress-batch-', async home => {
    const profile = join(home, 'profiles', 'web');
    for (const name of ['plugin-a', 'plugin-b']) {
      await mkdir(join(profile, 'node_modules', name), { recursive: true });
      await writeFile(join(profile, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    }
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'web', private: true,
      dependencies: { 'plugin-a': 'github:o/plugin-a', 'plugin-b': 'github:o/plugin-b' },
      dsh: { profile: { bundles: ['plugin-a', 'plugin-b'] } }
    }));

    const { updatePlugins, readLastBatchUpdate } = await import('../lib/index.js');
    const snapshot = [];
    const summary = await updatePlugins(['plugin-a', 'plugin-b'], {
      check: async sources => sources.map(item => ({ name: item.name, status: 'update-available', latestVersion: '3.0.0', error: null })),
      command: async () => { const p = readUpdateProgress(); snapshot.push({ total: p.total, done: p.done, current: p.current }); }
    });
    assert.equal(summary.updated, 2);
    assert.equal(summary.failed, 0);
    assert.deepEqual(snapshot.map(item => [item.total, item.done]), [[2, 0], [2, 1]]);
    assert.deepEqual(snapshot.map(item => item.current), ['plugin-a', 'plugin-b']);
    const progress = readUpdateProgress();
    assert.equal(progress.active, false);
    assert.equal(progress.kind, 'batch');
    assert.equal(progress.done, 2);
    assert.equal(readLastBatchUpdate().updated, 2);
  });
});

// ---------------------------------------------------------------------------
// 回归：缓存必须校验（畸形条目曾让调用方直接崩），且测试不能写进真实 profile
// ---------------------------------------------------------------------------

test('回归 4：读缓存时丢弃畸形条目，整份没用就当作没有缓存', async () => {
  await withTempDshHome('dsh-pm-cache-sanity-', async home => {
    const cacheFile = join(home, 'cache.json');
    // 缺 name/status 的条目（历史上由探测异常落盘）必须被丢掉
    await writeUpdateCache({ checkedAt: new Date().toISOString(), inventory: [{ error: 'boom' }] }, cacheFile);
    assert.equal(await readUpdateCache({ cacheFile }), null);

    // 同一份里既有合法又有畸形：只留合法的
    await writeUpdateCache({
      checkedAt: new Date().toISOString(),
      inventory: [
        { name: 'ok-plugin', status: 'up-to-date', installedVersion: '1.0.0' },
        { error: 'boom' },
        { name: '', status: 'failed' },
        { name: 'no-status' }
      ]
    }, cacheFile);
    const sanitized = await readUpdateCache({ cacheFile });
    assert.deepEqual(sanitized.inventory.map(item => item.name), ['ok-plugin']);

    // checkedAt 缺失/非法 → 当作过期，但条目仍可用
    await writeUpdateCache({ inventory: [{ name: 'p', status: 'up-to-date' }] }, cacheFile);
    const noStamp = await readUpdateCache({ cacheFile });
    assert.equal(noStamp.inventory.length, 1);
    assert.equal(noStamp.checkedAt, null);
  });
});

test('回归 5：探测抛错时落盘的条目也必须带 name/status（供面板/启动器安全消费）', async () => {
  await withTempDshHome('dsh-pm-cache-write-', async home => {
    const profile = join(home, 'profiles', 'web');
    await mkdir(join(profile, 'node_modules', 'p'), { recursive: true });
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'web', private: true,
      dependencies: { p: 'github:o/p' },
      dsh: { profile: { bundles: ['p'] } }
    }));
    await writeFile(join(profile, 'node_modules', 'p', 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0' }));
    const cacheFile = join(home, 'cache.json');

    // 注入会抛错的 git 探测：这条要落成 failed，而不是没有 name/status 的裸条目
    await checkPluginUpdates({ force: true, cacheFile, probe: { git: async () => { throw new Error('registry 不可用'); } } });
    for (let i = 0; i < 100 && !(await readUpdateCache({ cacheFile })); i += 1) await sleep(30);
    const cached = await readUpdateCache({ cacheFile });
    assert.ok(cached, '应当写出一份缓存');
    assert.equal(cached.inventory.length, 1);
    assert.equal(cached.inventory[0].name, 'p');
    assert.equal(cached.inventory[0].status, 'failed');
    assert.match(cached.inventory[0].error, /registry 不可用/);
    assert.equal(cached.inventory[0].spec, 'github:o/p', '条目要能反查回原始 spec，面板才画得出更新按钮');
  });
});

test('回归 6：缓存文件里的畸形 JSON 不能让调用方崩', async () => {
  await withTempDshHome('dsh-pm-cache-broken-', async home => {
    const cacheFile = join(home, 'cache.json');
    await writeFile(cacheFile, '{ this is not json');
    assert.equal(await readUpdateCache({ cacheFile }), null);
    await writeFile(cacheFile, JSON.stringify({ checkedAt: 'not-a-date', inventory: 'nope' }));
    assert.equal(await readUpdateCache({ cacheFile }), null);
  });
});
