import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { readJsonFile, withFileLock } from './atomic.js';
import { getOperationQueue, readOperationLog, pruneOperationLogs } from './operations.js';

const run = promisify(execFile);

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh');
const profilesWebModules = () => join(dshHome(), 'profiles', 'web', 'node_modules');
const profilesWebDir = () => join(dshHome(), 'profiles', 'web');
const marketRoot = () => join(dshHome(), 'plugin-market');
const marketIndexFile = () => join(marketRoot(), 'index.json');
const marketRepoDir = () => join(marketRoot(), 'repo');

const MARKET_REPO_URL = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git';
/** Bundle the launcher ships with; symlink targets contain one of these names. */
const BUNDLED_MARKERS = ['DSHArchiveManager', 'DSHPluginManager', 'DSHSessionNotify'];
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Parse the tiny plugin YAML format used by awesome-dsh-plugin's data/plugins.
 * Every entry is flat `key: value` lines, with `description:` holding two
 * indented `en:` / `zh:` lines. No external YAML dependency needed.
 * @param {string} text - raw .yml content.
 * @returns {{url:string,name:string,category:string,description:{en?:string,zh?:string}}}
 */
export function parsePluginYml(text) {
  const out = { description: {} };
  let section = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const value = unquoteYamlScalar(line.slice(colon + 1).trim());
    if (key === 'description') { section = 'description'; continue; }
    if (section === 'description') {
      if (key === 'en' || key === 'zh') out.description[key] = value;
      continue;
    }
    if (key === 'url' || key === 'name' || key === 'category') out[key] = value;
  }
  return out;
}

/**
 * 去掉 YAML 标量两端的引号：上游列表里有 `category: "browser"` 这种写法，不去掉
 * 分类会变成带引号的 `"browser"`，市场分类按钮和卡片上就会显示引号。
 * 只处理两端成对且同种引号的情况，正文里的引号原样保留。
 */
function unquoteYamlScalar(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' || first === "'") && last === first) return value.slice(1, -1);
  return value;
}

/** Read a package.json's name/version/description defensively. */
async function readPackageMeta(directory) {
  try {
    const raw = await fs.readFile(join(directory, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    return { name: pkg.name || null, version: pkg.version || null, description: pkg.description || '' };
  } catch { return null; }
}

async function linkTarget(path) {
  try { return await fs.readlink(path); } catch { return null; }
}

async function listScopedModules(modulesDir) {
  const entries = [];
  let names = [];
  try { names = await fs.readdir(modulesDir, { withFileTypes: true }); } catch { return entries; }
  for (const entry of names) {
    const path = join(modulesDir, entry.name);
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      let scoped = [];
      try { scoped = await fs.readdir(path, { withFileTypes: true }); } catch { continue; }
      for (const item of scoped) {
        entries.push({ package: `${entry.name}/${item.name}`, path: join(path, item.name), isDir: item.isDirectory() || item.isSymbolicLink(), isLink: item.isSymbolicLink() });
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      entries.push({ package: entry.name, path, isDir: true, isLink: entry.isSymbolicLink() });
    }
  }
  return entries;
}

/** Official core profile layers that ship with dsh and are not user plugins. */
const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless']);

/**
 * 启动器随包自带的内置插件。它们不是"用户插件"，但会出现在已安装列表里；
 * 卸掉 dsh-plugin-manager 等于把插件管理界面自己拆了，之后再也无法从界面恢复。
 * 客户端按钮只是 gating，真正的拦截必须放在服务端这一层。
 */
const PROTECTED_PLUGINS = new Set(['dsh-plugin-manager', 'dsh-archive-manager', 'dsh-session-notify']);

async function pathExists(path) {
  try { await fs.access(path); return true; } catch { return false; }
}

/**
 * 收掉同一个文件上次留下的临时文件：原子写只在**本次调用**出错时删自己的 staging，
 * 进程被 kill（dsh 重启、插件升级、断电）留下的 `<file>.<pid>.tmp` 会一直躺在目录里
 * （实测 `~/.dsh/profiles/web/.plugin-updates.json.11800.tmp` 就是 13:39 那次 dsh
 * 重启截断写入留下的）。写同一个文件前顺手清理同前缀、**进程已不在**的那些。
 *
 * 判活用 `kill(pid, 0)`：EPERM 说明进程还在、只是没权限，照样保留——宁可与一个
 * 活进程的 staging 并存，也不能删掉别人正在写的文件。
 */
async function reapStaleStaging(path) {
  const dir = dirname(path);
  const escaped = path.slice(dir.length + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\.(\\d+)\\.tmp$`);
  const names = await fs.readdir(dir).catch(() => []);
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid) continue;
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (error) { alive = error?.code === 'EPERM'; }
    if (alive) continue;
    await fs.rm(join(dir, name), { force: true }).catch(() => {});
  }
}

/**
 * 临时文件 + rename 的原子写。半截 JSON（磁盘满、进程被杀）会被读回来，
 * 让 profile 的状态比不写更糟；原子写至少保证读到的要么是旧内容要么是完整新内容。
 */
async function writeTextAtomic(path, text) {
  await fs.mkdir(join(path, '..'), { recursive: true });
  const staging = `${path}.${process.pid}.tmp`;
  await reapStaleStaging(path);
  try {
    await fs.writeFile(staging, text, 'utf8');
    await fs.rename(staging, path);
  } catch (error) {
    await fs.rm(staging, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * 已经装进 node_modules 的那份能不能被 import。
 *
 * 光校验克隆源码不够：npm／`github:` 来源根本不经过 plugin-sources，pnpm 也可能在
 * 物化时漏文件。装完立刻按包自己的 import 图查一遍，坏就当场退回，别等用户重启
 * dsh 才发现整个 Harness 起不来。包目录不存在时返回空（外部 profile 或已被移走，
 * 无从校验，也不该因此判定失败）。
 */
async function installedImportGaps(name) {
  const resolved = await resolveModule(profilesWebModules(), String(name));
  if (!resolved) return [];
  return findUnresolvableLocalImports(resolved.path);
}

async function restoreSourceBackup(backup, dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(backup, dir);
    return true;
  } catch { return false; }
}

/** 装坏之后的退路：把包从 profile 里摘掉，恢复到动手之前。 */
async function rollbackFailedInstall(name, command) {
  try {
    await command(['remove', name]);
    return '已自动撤销这次安装';
  } catch (error) {
    return `已尝试撤销但失败（${String(error?.message || error)}），重启 dsh 前请先手动卸载 ${name}`;
  }
}

/**
 * 清掉 pnpm 对某个包的「钉死」状态：node_modules 里的残留目录/链接 + 锁文件
 * importers 里该包的记录。pnpm 对 file:/link: 依赖经常「退出码 0 但不重新
 * 物化」——锁文件还钉着旧解析（实测：link: 切 file: 后两次 add 都是 added 0，
 * node_modules 里的旧符号链接原样保留），不拆掉这些残留，重装多少次都没用。
 * @returns {Promise<boolean>} 锁文件是否被改动。
 */
async function clearPinnedPackage(name) {
  const packageDir = join(profilesWebModules(), ...String(name).split('/'));
  await fs.rm(packageDir, { recursive: true, force: true }).catch(() => {});
  return stripStaleLockEntry(name);
}

/** 从锁文件 importers 段删除一个顶层依赖的记录（名字行 + specifier/version 行）。 */
export async function stripStaleLockEntry(name) {
  const lockPath = join(profilesWebDir(), 'pnpm-lock.yaml');
  let text;
  try { text = await fs.readFile(lockPath, 'utf8'); } catch { return false; }
  const lines = text.split('\n');
  const out = [];
  let inImporters = false;
  let skipping = false;
  let changed = false;
  for (const line of lines) {
    if (/^importers:/.test(line)) { inImporters = true; out.push(line); continue; }
    if (inImporters && /^[^\s#]/.test(line)) { inImporters = false; skipping = false; } // 下一个顶层段
    if (inImporters) {
      // importers 下的条目键是两空格缩进；specifier/version 等子行缩进更深
      if (/^ {2}[^ ]/.test(line)) skipping = line.includes(name);
      if (skipping) { changed = true; continue; }
    }
    out.push(line);
  }
  if (changed) await fs.writeFile(lockPath, out.join('\n'), 'utf8');
  return changed;
}

/** 安装后验收：装进来的包 import 落不了地就当场撤销，绝不留给下一次 dsh 启动去炸。 */
export async function acceptInstalledPackage(name, note, command = pluginCommand, verifyPresent, spec, allowRetry = true) {
  // `pnpm add` 退出码 0 不等于装上了：依赖可能没物化（node_modules 里根本没有这个包）。
  // 先回读真实状态（magpie 的规矩：操作后回读，而不是转述命令退出码），再说 import。
  const present = verifyPresent ?? (async () => (await installedVersionOf(name)) !== null);
  if (!(await present(name))) {
    // 没物化的常见根因是 pnpm 把 file:/link: 的旧解析钉在锁文件里。自动
    // 「清钉 + 重装一次」再验收；还不行才回滚报错（重试是机制，不是碰运气）。
    if (allowRetry && spec) {
      await clearPinnedPackage(name);
      await command(['add', spec]);
      return acceptInstalledPackage(name, note, command, verifyPresent, spec, false);
    }
    const rollback = await rollbackFailedInstall(name, command);
    return { ok: false, error: `安装命令已执行，但 ${name} 没有出现在 node_modules 里（未生效）；${rollback}` };
  }
  const gaps = await installedImportGaps(name);
  if (!gaps.length) return { ok: true, note };
  const rollback = await rollbackFailedInstall(name, command);
  return { ok: false, error: `${describeUnresolvableImports(gaps)}；${rollback}` };
}

/** Resolve a package name (`name` or `@scope/name`) inside a modules dir. */
async function resolveModule(modulesDir, packageName) {
  const path = join(modulesDir, packageName);
  try { await fs.access(path); return { path, package: packageName }; } catch { return null; }
}

/**
 * List the plugins a user can manage. A plugin is either a user bundle listed
 * in the profile manifest's `dsh.profile.bundles` (dsh's own notion of a
 * plugin layer), one of the launcher's bundled plugins, or a broken leftover
 * of a failed install. Ordinary npm dependencies (d3, lodash, …) that happen
 * to sit in node_modules are NOT plugins and must never be listed.
 * @returns {Promise<Array<{name:string,version:string|null,description:string,source:'bundled'|'user'|'broken',installedAt:string|null,broken?:boolean}>>}
 */
export async function listInstalledPlugins() {
  const modulesDir = profilesWebModules();
  // 1) User plugin layer: read the profile manifest's bundle list.
  const manifestPath = join(modulesDir, '..', 'package.json');
  let bundles = [];
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    bundles = manifest.dsh?.profile?.bundles ?? [];
  } catch { /* no manifest yet */ }

  const out = [];
  const seen = new Set();
  const seenBundles = new Set();
  for (const bundleName of bundles) {
    if (CORE_BUNDLES.has(bundleName)) continue;
    seenBundles.add(bundleName);
    const entry = await resolveModule(modulesDir, bundleName);
    if (!entry) continue;
    const meta = await readPackageMeta(entry.path);
    if (meta?.name) {
      const target = await linkTarget(entry.path);
      const source = target && BUNDLED_MARKERS.some(marker => target.includes(marker)) ? 'bundled' : 'user';
      seen.add(meta.name);
      out.push({ name: meta.name, version: meta.version, description: meta.description, source, installedAt: await pluginInstalledAtIso(entry.path) });
    }
  }

  // 2) Launcher-bundled plugins (symlinked into node_modules, not in bundles).
  const entries = await listScopedModules(modulesDir);
  for (const entry of entries) {
    const target = await linkTarget(entry.path);
    if (target && BUNDLED_MARKERS.some(marker => target.includes(marker))) {
      const meta = await readPackageMeta(entry.path);
      if (meta?.name && !seen.has(meta.name)) {
        seen.add(meta.name);
        out.push({ name: meta.name, version: meta.version, description: meta.description, source: 'bundled', installedAt: await pluginInstalledAtIso(entry.path) });
      }
    }
  }

  // 3) Broken leftovers: dangling symlinks that do not back a real bundle.
  for (const entry of entries) {
    if (!entry.isLink || seen.has(entry.package)) continue;
    const meta = await readPackageMeta(entry.path);
    if (!meta?.name) {
      seen.add(entry.package);
      out.push({ name: entry.package, version: null, description: '安装不完整或已损坏，可清理后重新安装', source: 'broken', installedAt: null, broken: true });
    }
  }

  out.sort(compareInstalledPlugins);
  return out;
}

/**
 * 已安装列表的排序：用户插件在上面并按「最近安装/更新」倒序（越新越靠上），
 * 启动器自带的内置插件固定垫底（它们永远不能卸载、版本恒为 0.1.0，排在
 * 中间只会挤占视线）。损坏残留（source 恒为 broken）属于用户层的残留，与用户
 * 插件同档，但它取不到时间，天然落在该档末尾。档内时间越新越靠前，时间相同按名字兜底，
 * 保证顺序稳定可复现。
 */
export function compareInstalledPlugins(left, right) {
  const rank = item => (item.source === 'bundled' ? 1 : 0);
  const byRank = rank(left) - rank(right);
  if (byRank !== 0) return byRank;
  const byTime = stampMs(right.installedAt) - stampMs(left.installedAt);
  if (byTime !== 0) return byTime;
  return String(left.name).localeCompare(String(right.name));
}

/** ISO 时间串转毫秒；取不到（null / 非法值）返回 -1，永远排在有时间的之后。 */
function stampMs(value) {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : -1;
}

/**
 * 插件「最近一次安装/更新」的时刻，取以下几个信号里最新的那个：
 * - 来源标记 `.dsh-source.json` 的 clonedAt / updatedAt（本插件在克隆或本地
 *   pull 时写入，语义最准，且不受文件系统时间戳语义差异影响）；
 * - 插件目录的 mtime（node_modules 里指向 plugin-sources 的软链先解析真实路径）。
 *   只用目录 mtime：安装必然新建目录，更新会增删其中的文件；package.json 这类
 *   文件的 mtime 会保留打包时间、不可信；birthtime 不用——复制/迁移目录会把它
 *   刷成当下，比 mtime 更会骗人。
 * 全都取不到时返回 null（例如悬空软链的损坏残留）。
 * @returns {Promise<string|null>}
 */
async function pluginInstalledAtIso(directory) {
  const real = await fs.realpath(directory).catch(() => directory);
  let best = -1;
  const marker = await readJsonQuiet(join(real, SOURCE_MARKER_NAME));
  for (const value of [marker?.clonedAt, marker?.updatedAt]) {
    const ms = stampMs(value);
    if (ms > best) best = ms;
  }
  const info = await fs.stat(real).catch(() => null);
  if (info && Number.isFinite(info.mtimeMs) && info.mtimeMs > best) best = info.mtimeMs;
  return best >= 0 ? new Date(best).toISOString() : null;
}

const dshCli = () => join(dshHome(), 'runtime', 'node_modules', '.bin', 'dsh');

/** Is a command resolvable on the given PATH? */
export async function hasCommandOnPath(name, path) {
  const pathValue = path ?? process.env.PATH ?? '';
  const directories = pathValue.split(':').filter(Boolean);
  for (const directory of directories) {
    try {
      const candidate = join(directory, name);
      const stat = await fs.stat(candidate);
      if (stat.isFile() && (stat.mode & 0o111)) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * dsh forwards plugin installs to `pnpm`, which is often absent from a user's
 * PATH. When that happens we prepare a local shim that forwards to the pnpm
 * shipped by node's corepack, and prepend its directory to the PATH we hand to
 * the dsh CLI. Nothing outside ~/.dsh is modified.
 * @returns {Promise<[string, string]>} [child PATH, note]
 */
export async function ensurePnpmPath() {
  const existing = await hasCommandOnPath('pnpm');
  if (existing) return [process.env.PATH, `found pnpm at ${existing}`];
  const corepack = await hasCommandOnPath('corepack');
  if (!corepack) return [process.env.PATH, 'pnpm unavailable: no pnpm and no corepack on PATH'];
  const binDir = join(dshHome(), 'pnpm-bin');
  await fs.mkdir(binDir, { recursive: true });
  const shim = join(binDir, 'pnpm');
  const forwarded = `#!/bin/sh\nexec "${process.execPath}" "${corepack}" pnpm "$@"\n`;
  if (await fs.readFile(shim, 'utf8').catch(() => '') !== forwarded) {
    await fs.writeFile(shim, forwarded, { mode: 0o755 });
  }
  return [`${binDir}:${process.env.PATH}`, `pnpm shim prepared via corepack at ${binDir}`];
}

async function pluginCommand(args) {
  await ensurePnpmWorkspace();
  const cli = dshCli();
  const [pathWithPnpm, note] = await ensurePnpmPath();
  const { stdout, stderr } = await run(cli, ['plugin', '--profile', 'web', ...args], {
    timeout: 240000,
    env: { ...process.env, PATH: pathWithPnpm },
    cwd: dshHome()
  });
  return { stdout, stderr, note };
}

/** 本地 git 命令（dev-linked 插件的就地更新用），统一带交互关闭与超时。 */
async function gitInDir(cwd, args, timeoutMs = 60000) {
  const { stdout, stderr } = await run('git', args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/true' }
  });
  return { stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
}

/**
 * 所有改 profile 的操作（安装/更新/卸载/批量）都走这一条串行队列：
 * 状态落盘到 .plugin-manager/operations.json（界面重开/宿主重启后仍能看到结果），
 * 每条操作的命令输出写到独立日志。
 * @returns {Promise<object>} 终态操作记录（含 result / error）
 */
async function runMutation(kind, targets, label, task, options = {}) {
  const queue = getOperationQueue(profilesWebDir());
  const profileDir = profilesWebDir();
  const lockPath = join(profileDir, '.plugin-manager', 'profile-mutation.lock');
  return queue.run({ kind, targets: targets ?? [], label, from: options.from ?? null, to: options.to ?? null }, async ctx => {
    await ctx.appendLog(`[${new Date().toISOString()}] ${kind} ${(targets ?? []).join(', ')}\n`);
    // 跨进程锁：即便另一个进程（或终端里的 dsh plugin）也在改 profile，也排队等待。
    return withFileLock(lockPath, () => task({
      ...ctx,
      /** 执行 dsh plugin 命令并把输出写进本操作日志。 */
      command: async args => {
        await ctx.appendLog(`$ dsh plugin ${args.join(' ')}\n`);
        try {
          const result = await pluginCommand(args);
          await ctx.appendLog([result.stdout, result.stderr].filter(Boolean).join('\n'));
          return result;
        } catch (error) {
          await ctx.appendLog(`${String(error?.message || error)}\n`);
          throw error;
        }
      }
    }), { waitMs: 300_000 });
  });
}

/** 操作结果快照（HTTP /operations 用）。 */
async function operationSnapshot() {
  const queue = getOperationQueue(profilesWebDir());
  const snapshot = await queue.journal.snapshot(30);
  await pruneOperationLogs(profilesWebDir()).catch(() => {});
  return snapshot;
}

/**
 * pnpm 10+ blocks dependency build scripts unless approved, and `pnpm add`
 * hard-fails with ERR_PNPM_IGNORED_BUILDS when a dependency (e.g. a native
 * addon like node-pty) has a build script that was not approved. The shipped
 * dsh profile workspace only sets `autoInstallPeers: false`, so a plugin with
 * native deps cannot be installed. Approve dependency builds on the web
 * profile so such plugins install cleanly.
 */
export async function ensurePnpmWorkspace() {
  const workspacePath = join(profilesWebDir(), 'pnpm-workspace.yaml');
  try {
    const content = await fs.readFile(workspacePath, 'utf8');
    if (content.includes('dangerouslyAllowAllBuilds') || content.includes('allowBuilds')) return;
    await writeTextAtomic(workspacePath, `${content.replace(/\n*$/, '')}\ndangerouslyAllowAllBuilds: true\n`);
  } catch {
    await fs.mkdir(profilesWebDir(), { recursive: true });
    await writeTextAtomic(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\ndangerouslyAllowAllBuilds: true\n');
  }
}

/**
 * npm package candidates for a market entry (`author/repo`, or
 * `author/repo#subdir` for a plugin living in a repo subdirectory), then a git
 * URL for whole-repo installs. A `#subdir` spec has no valid npm package name
 * and no whole-repo git URL — it must be installed from the git subdirectory,
 * so we surface it as `repoRef.subdir` for the caller.
 * @param {{name?:string,url?:string}} entry
 * @returns {{candidates:string[],git:string|null,repoRef:{author:string,repo:string,subdir:string|null,full:string}|null}}
 */
export function installCandidates(entry) {
  const name = String(entry.name || '').trim();
  // `@scope/name` 本身就是一个 npm 包名，不能再按「作者/仓库」拆：拆出来会拼成
  // `@@scope/name` 这种不存在的包名，还配一个 `github.com/@scope/…` 的假仓库。
  // 官方插件（@deepseek-ai/…）全走这条。
  if (/^@[^/@\s]+\/[^/@\s#]+$/.test(name)) {
    return { candidates: [name], git: null, repoRef: null };
  }
  const slash = name.indexOf('/');
  const author = slash >= 0 ? name.slice(0, slash) : '';
  const rest = slash >= 0 ? name.slice(slash + 1) : name;
  const hash = rest.indexOf('#');
  const repo = hash >= 0 ? rest.slice(0, hash) : rest;
  const subdir = hash >= 0 ? rest.slice(hash + 1) : null;
  const candidates = [];
  if (author && repo) candidates.push(`@${author.toLowerCase()}/${repo.toLowerCase()}`);
  if (repo) candidates.push(repo.toLowerCase());
  const git = author && repo && !subdir ? `https://github.com/${author}/${repo}.git` : null;
  return {
    candidates,
    git,
    repoRef: author && repo ? { author, repo, subdir, full: `${author}/${repo}${subdir ? '#' + subdir : ''}` } : null
  };
}

/**
 * Fast existence probe against the npm registry. `pnpm add <name>` on a
 * package that does not exist makes pnpm wait on network round-trips before
 * failing; probing first (≈0.2–1.5s) lets us skip straight to a name that
 * actually resolves, or move on to git quickly. Returns false when the name
 * does not resolve, or when the registry is unavailable / times out.
 *
 * Uses the launcher-owned pnpm shim (never the system `npm`, which is usually
 * absent from a GUI-launched app's PATH), so it resolves over the same
 * registry/network stack pnpm install uses.
 * @param {string} name - npm package name.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function npmViewExists(name, timeoutMs = 8000) {
  /// true = 包存在；false = 确认不存在（404）；'unreachable' = registry 暂时
  /// 连不上（超时/DNS/拒连）。把「连不上」误报成「包不存在」会误导用户去排查
  /// 一个不存在的包名，真实的网络问题反而被掩盖。
  try {
    await ensurePnpmPath();
    const cli = join(dshHome(), 'pnpm-bin', 'pnpm');
    await run(cli, ['view', name, 'version'], { timeout: timeoutMs });
    return true;
  } catch (error) {
    const message = [error?.message, error?.stderr, error?.stdout].filter(Boolean).join(' ');
    if (/E404|404\s|not found/i.test(message) && !/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|timed out/i.test(message)) return false;
    if (/E404/i.test(message)) return false;
    return 'unreachable';
  }
}

/** 一条 import 语句里的模块说明符，覆盖静态、动态与副作用三种写法。 */
const LOCAL_IMPORT_RES = [
  /(?:^|[\s;(=])(?:import|export)\b[^;'"]*?from\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /(?:^|[\s;])import\s*["']([^"']+)["']/g
];

/** Node 允许省扩展名时补齐的后缀（含 TS：有的插件带 loader 跑 .mts）。 */
const LOCAL_MODULE_EXTENSIONS = ['', '.mjs', '.js', '.cjs', '.mts', '.ts', '.cts'];

/** 不参与 import 校验的目录：不是这个包的运行时代码。 */
const UNSCANNED_PACKAGE_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '__tests__', 'fixtures', 'coverage']);

function localImportSpecifiers(source) {
  const found = new Set();
  for (const re of LOCAL_IMPORT_RES) {
    for (const match of source.matchAll(re)) found.add(match[1]);
  }
  return [...found];
}

async function listPackageModuleFiles(dir, out = []) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // node_modules 里的东西不归这个包负责；测试与覆盖率目录 dsh 启动时不加载，而插件
      // 仓库的 test/ 引用到仓库里的 fixture 是常态，报出来全是误报。
      if (UNSCANNED_PACKAGE_DIRS.has(entry.name)) continue;
      await listPackageModuleFiles(path, out);
    } else if (/\.(?:mjs|cjs|js|mts|cts)$/.test(entry.name) && !/\.(?:test|spec)\.(?:mjs|cjs|js|mts|cts)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

async function resolvesAsLocalModule(target) {
  for (const extension of LOCAL_MODULE_EXTENSIONS) {
    try { if ((await fs.stat(`${target}${extension}`)).isFile()) return true; } catch { /* 换下一个候选 */ }
  }
  for (const extension of LOCAL_MODULE_EXTENSIONS.slice(1)) {
    try { if ((await fs.stat(join(target, `index${extension}`))).isFile()) return true; } catch { /* 换下一个候选 */ }
  }
  return false;
}

/**
 * 装之前先问源码自己：你 import 的相对路径都在吗？
 *
 * 一些上游把公共模块移出 git、改成 pack 时生成（OpenViking 的 `shared/` 就是
 * `prepack: node ../memory-plugin-shared/sync.mjs` 的产物），而子目录插件的安装方式是
 * 「sparse clone 那个子目录 + `pnpm add file:`」：既不会跑 prepack，也拿不到兄弟目录，
 * 于是装出来的源码缺一整批模块。版本复核（verifyUpdateApplied）只看 package.json 的
 * version，对此毫无察觉——真正炸的时机是用户下次重启 dsh，而且一炸整个 Harness 起不来。
 *
 * 只查解析后仍落在包目录内的相对路径：`../` 出界的部分在 pnpm 的 node_modules 布局里
 * 另有解析规则，报出来只会是误报。
 * @param {string} dir - 待校验的包目录（克隆出来的 plugin-sources 副本）。
 * @returns {Promise<Array<{importer:string,specifier:string}>>} 落不了地的 import，按引用方排序。
 */
export async function findUnresolvableLocalImports(dir) {
  const root = resolve(dir);
  const missing = [];
  for (const file of await listPackageModuleFiles(root)) {
    const source = await fs.readFile(file, 'utf8').catch(() => null);
    if (source === null) continue;
    for (const specifier of localImportSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      if (!target.startsWith(root + sep)) continue;
      if (!(await resolvesAsLocalModule(target))) {
        missing.push({ importer: relative(root, file), specifier });
      }
    }
  }
  return missing.sort((a, b) => `${a.importer}${a.specifier}`.localeCompare(`${b.importer}${b.specifier}`));
}

/** 缺失模块要说人话：点名前三个模块和它们的引用方，再说清为什么缺。 */
function describeUnresolvableImports(missing) {
  const shown = missing.slice(0, 3)
    .map(item => `${item.specifier}（由 ${item.importer} 引用）`)
    .join('、');
  const rest = missing.length > 3 ? ` 等 ${missing.length} 处` : '';
  return `插件源码缺少模块 ${shown}${rest}：上游大概只在 npm 打包时才生成这些文件，从 git 目录装出来就是残缺的，装上会让 dsh 起不来`;
}

/**
 * Clone `author/repo` into a persistent source folder under the profile and
 * return the resolved plugin's package.json name. When `subdir` is given, only
 * that subdirectory is materialized via a `blob:none` sparse checkout (a few
 * MB / a few seconds instead of a full-repo clone); older git falls back to a
 * plain shallow clone. The source folder is stable across restarts, so the
 * `file:` dependency installed from it does not break.
 * @param {{author:string,repo:string,subdir:string|null,full:string}} ref
 * @param {string|null} subdir - subdirectory to materialize, or null for root.
 * @returns {Promise<{ok:boolean,dest?:string,packageName?:string,error?:string}>}
 */
async function cloneToSources(ref, subdir) {
  const repoUrl = `https://github.com/${ref.author}/${ref.repo}.git`;
  const sourcesDir = join(profilesWebModules(), '..', 'plugin-sources');
  const safeName = ((subdir ? subdir.split('/').pop() : ref.repo) || 'plugin').replace(/[^a-zA-Z0-9._-]/g, '-');
  const dest = join(sourcesDir, `${ref.author}-${ref.repo}${subdir ? '-' + safeName : ''}`);
  const tmpRoot = await fs.mkdtemp(join(tmpdir(), 'dsh-pm-'));
  const cloneDir = join(tmpRoot, 'repo');
  try {
    if (subdir) {
      // Sparse checkout materializes only the subdirectory — a few MB instead
      // of the whole repo. Fall back to a plain shallow clone on older git.
      try {
        await run('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', repoUrl, cloneDir], { timeout: 300000 });
        await run('git', ['-C', cloneDir, 'sparse-checkout', 'set', subdir], { timeout: 120000 });
      } catch {
        await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});
        await run('git', ['clone', '--depth', '1', repoUrl, cloneDir], { timeout: 300000 });
      }
    } else {
      // Whole-repo plugin: a plain shallow clone (sparse would drop the
      // subdirectories the plugin source depends on).
      await run('git', ['clone', '--depth', '1', repoUrl, cloneDir], { timeout: 300000 });
    }
    const src = subdir ? join(cloneDir, subdir) : cloneDir;
    const meta = await readPackageMeta(src);
    if (!meta?.name) {
      return { ok: false, error: `仓库 ${ref.full}${subdir ? ' 的子目录 ' + subdir : ' 根目录'}没有 package.json，无法作为插件安装` };
    }
    // 先落一份同目录下的暂存副本、验过再换掉旧源码。原来的「先 rm 再 cp」意味着
    // 只要后面任何一步失败（包括校验拒绝、pnpm 失败），上一个能用的版本就已经没了。
    const staging = `${dest}.staged-${process.pid}-${Date.now()}`;
    await fs.mkdir(join(dest, '..'), { recursive: true });
    await fs.cp(src, staging, { recursive: true });
    // 记下来源与 commit：更新检测靠它反推远端、判断"远端是否只是有新提交"。
    const head = await run('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], { timeout: 30000 })
      .then(result => String(result.stdout).trim().toLowerCase())
      .catch(() => null);
    await fs.writeFile(join(staging, SOURCE_MARKER_NAME), JSON.stringify({
      author: ref.author,
      repo: ref.repo,
      subdir: subdir ?? null,
      url: repoUrl,
      commit: /^[0-9a-f]{40}$/.test(head ?? '') ? head : null,
      clonedAt: new Date().toISOString()
    }, null, 2), 'utf8').catch(() => {});
    const gaps = await findUnresolvableLocalImports(staging);
    if (gaps.length) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      return { ok: false, error: `${describeUnresolvableImports(gaps)}；原有源码未改动` };
    }
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    await fs.rename(staging, dest);
    return { ok: true, dest, packageName: meta.name };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Install a plugin that lives in a git repo subdirectory (`author/repo#subdir`).
 * Such plugins are not npm packages, so they cannot go through `pnpm add <pkg>`.
 * We sparse-clone the repo, copy the subdirectory into a persistent source
 * folder under the profile, and add it as a `file:` dependency so pnpm records
 * it in the profile manifest and node_modules (and dsh reconciles its bundle).
 * A clone whose own relative imports don't land is refused here rather than
 * linked into the profile (see findUnresolvableLocalImports).
 * @param {{author:string,repo:string,subdir:string,full:string}} ref
 * @param {Set<string>} installedNames - lower-cased names already present.
 * @returns {Promise<{ok:boolean,alreadyInstalled?:boolean,installedAs?:string,packageName?:string,note?:string,error?:string}>}
 */
async function installSubdirPlugin(ref, installedNames, command = pluginCommand, options = {}) {
  const verifyPresent = options.verifyPresent;
  const src = await cloneToSources(ref, ref.subdir);
  if (!src.ok) return src;
  const missing = await findUnresolvableLocalImports(src.dest);
  if (missing.length) return { ok: false, error: describeUnresolvableImports(missing) };
  if (installedNames.has(src.packageName.toLowerCase())) {
    return { ok: true, alreadyInstalled: true, installedAs: src.packageName, packageName: src.packageName };
  }
  try {
    const result = await command(['add', `file:${src.dest}`]);
    const accepted = await acceptInstalledPackage(src.packageName, result.note, command, verifyPresent, `file:${src.dest}`);
    if (!accepted.ok) return accepted;
    return { ok: true, installedAs: `file:${src.dest}`, packageName: src.packageName, note: accepted.note };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * Install a market entry. Pure `author/repo` plugins are installed through the
 * npm candidates first (probed fast via `npm view`), falling back to a shallow
 * clone added as a `file:` dependency. `author/repo#subdir` plugins are
 * installed from their git subdirectory via a sparse clone. Both paths are
 * idempotent: an already-installed package is reported as `alreadyInstalled`
 * instead of being reinstalled.
 * @param {{name?:string,url?:string}} entry
 * @returns {Promise<{ok:boolean,alreadyInstalled?:boolean,installedAs?:string,packageName?:string,note?:string,error?:string}>}
 */
export async function installPlugin(entry, command = pluginCommand, options = {}) {
  const verifyPresent = options.verifyPresent;
  const { candidates, repoRef } = installCandidates(entry);
  const installed = await listInstalledPlugins();
  const installedNames = new Set(installed.filter(item => !item.broken).map(item => item.name.toLowerCase()));

  // Subdirectory plugins cannot be addressed by npm name; route them to the
  // sparse-clone installer (which does its own idempotence check).
  if (repoRef?.subdir) {
    return installSubdirPlugin(repoRef, installedNames, command, options);
  }

  // Idempotence for whole-repo plugins: any candidate or repo name already
  // present in node_modules counts as installed.
  if (repoRef) {
    const existing = installed.find(item => {
      if (item.broken) return false;
      const n = item.name.toLowerCase();
      return candidates.includes(n) || n === repoRef.repo.toLowerCase() || n.endsWith('/' + repoRef.repo.toLowerCase());
    });
    if (existing) return { ok: true, alreadyInstalled: true, installedAs: existing.name, packageName: existing.name };
  }

  let lastError = '';
  // Probe candidates in parallel first: only `pnpm add` a name that really
  // exists, so a missing name never makes pnpm wait on a network failure.
  const probes = await Promise.all(candidates.map(name => npmViewExists(name)));
  for (let i = 0; i < candidates.length; i++) {
    if (probes[i] === 'unreachable') { lastError = `npm registry 暂时不可达，无法确认 ${candidates[i]}（网络恢复后会自动重试 git 源）`; continue; }
    if (!probes[i]) { lastError = `npm 上没有 ${candidates[i]}`; continue; }
    try {
      const result = await command(['add', candidates[i]]);
      const accepted = await acceptInstalledPackage(candidates[i], result.note, command, verifyPresent, candidates[i]);
      if (!accepted.ok) return accepted;
      return { ok: true, installedAs: candidates[i], packageName: candidates[i], note: accepted.note };
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  // Git fallback: shallow-clone into a persistent source folder and add as a
  // file: dependency — faster and more predictable than `pnpm add git+…`,
  // which clones the whole repo without a depth limit.
  if (repoRef && !repoRef.subdir) {
    const src = await cloneToSources(repoRef, null);
    if (src.ok) {
      try {
        const result = await command(['add', `file:${src.dest}`]);
        const accepted = await acceptInstalledPackage(src.packageName, result.note, command, verifyPresent, `file:${src.dest}`);
        if (!accepted.ok) return accepted;
        return { ok: true, installedAs: `file:${src.dest}`, packageName: src.packageName, note: accepted.note };
      } catch (error) {
        lastError = String(error?.message || error);
      }
    } else {
      lastError = src.error || lastError;
    }
  }
  return { ok: false, error: lastError || '安装失败' };
}

async function readProfileManifest() {
  const manifestPath = join(profilesWebModules(), '..', 'package.json');
  try { return JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { return null; }
}

/**
 * 卸载后清理 git 安装路径留下的源码目录：`author/repo`（回退）与
 * `author/repo#subdir` 插件会被克隆到 `~/.dsh/profiles/web/plugin-sources/`
 * 并以 `file:` 依赖安装；`pnpm remove` 只删 node_modules 与依赖记录，
 * 源码目录会永远留在磁盘上。这里在卸载成功后删除对应目录——仅当它是
 * 本次卸载的依赖原样引用、且没有其他依赖仍指向同一目录时。
 * @param {object|null} before - 卸载前读到的 profile manifest。
 * @param {string[]} names - 刚刚卸载的包名列表。
 * @returns {Promise<string[]>} 实际删除的目录（用于提示与测试）。
 */
export async function cleanupPluginSources(before, names) {
  const removed = [];
  if (!before?.dependencies) return removed;
  const root = resolve(join(profilesWebModules(), '..', 'plugin-sources'));
  const after = await readProfileManifest();
  const remainingSpecs = new Set(Object.values(after?.dependencies ?? {}).map(String));
  for (const name of names) {
    const spec = String(before.dependencies[name] ?? '');
    if (!spec.startsWith('file:')) continue;
    const dir = resolve(spec.slice('file:'.length));
    if (!dir.startsWith(root + sep)) continue; // 只清理我们自己克隆的目录，防止误删任意 file: 依赖
    if (remainingSpecs.has(spec)) continue;    // 其他依赖仍引用同一目录
    try {
      await fs.rm(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch { /* 清理尽力而为，不影响卸载结果 */ }
  }
  return removed;
}

/**
 * 卸载后验收：依赖记录与 node_modules 都要真的没了。pnpm 偶尔返回成功但
 * 物化没删干净（断链/目录残留），界面却提示「已卸载」——用户再看它还在，
 * 就会觉得「也不知道卸没卸成功」。
 */
async function verifyUninstalled(name) {
  const manifest = await readProfileManifest();
  const fields = [manifest?.dependencies, manifest?.devDependencies, manifest?.optionalDependencies];
  const stillInManifest = fields.some(group => group && Object.prototype.hasOwnProperty.call(group, name));
  const packageDir = join(profilesWebModules(), name);
  const stillOnDisk = await pathExists(packageDir);
  if (stillInManifest || stillOnDisk) {
    const leftovers = [
      stillInManifest ? 'package.json 里仍有依赖记录' : null,
      stillOnDisk ? `node_modules/${name} 仍在磁盘上` : null
    ].filter(Boolean).join('；');
    return { ok: false, leftovers };
  }
  return { ok: true };
}

export async function uninstallPlugin(name, command = pluginCommand) {
  if (PROTECTED_PLUGINS.has(String(name))) {
    return { ok: false, error: `${name} 是启动器随包自带的内置插件，卸载它会连插件管理界面一起失去，启动器会在下次启动时重新链接它` };
  }
  const before = await readProfileManifest();
  try {
    const result = await command(['remove', name]);
    const removedSources = await cleanupPluginSources(before, [name]);
    // 卸载后「忽略记录」没有意义了：留着只会让用户重新装上时对不上号。
    await unignorePluginUpdates([name]).catch(() => {});
    // 验收：pnpm 说成功不等于真的卸掉。残留就如实上报并再试一次手动清理。
    const verification = await verifyUninstalled(name);
    if (!verification.ok) {
      await cleanupBrokenPlugin(name).catch(() => {});
      const second = await verifyUninstalled(name);
      if (!second.ok) {
        return { ok: false, error: `卸载命令已执行，但 ${verification.leftovers}；请重试或重启 dsh 后再卸载` };
      }
    }
    const note = removedSources.length > 0 ? `${result.note}；已清理插件源码目录` : result.note;
    // 插件已从 node_modules 移除，但当前 dsh 进程仍在内存里加载着它（侧边栏
    // slot、事件监听都还在）。返回 needsRestart 让前端引导用户重启 dsh。
    return { ok: true, note, removedSources, needsRestart: true, verified: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/** Uninstall several plugins, reporting the outcome of each. */
export async function uninstallPlugins(names, command = pluginCommand) {
  const results = [];
  for (const name of names) {
    try {
      const result = await uninstallPlugin(name, command);
      results.push({ name, ok: result.ok, error: result.error, note: result.note });
    } catch (error) {
      results.push({ name, ok: false, error: String(error?.message || error) });
    }
  }
  return { ok: results.every(result => result.ok), results };
}

/**
 * Upgrade one installed plugin to its latest version via `dsh plugin update`.
 * @param {string} name - package name as listed by listInstalledPlugins.
 * @returns {Promise<{ok:boolean,note?:string,error?:string}>}
 */
/**
 * 缓存里这条插件的更新决策（更新按钮 / 批量更新直接复用，不再每点一次都重新联网探测：
 * git ls-remote 实测要十几秒甚至超时，界面表现为「点更新卡很久」）。
 * 只接受状态明确、带目标版本的条目；拿不到就返回 null（调用方再走联网探测）。
 */
async function cachedDecisionFor(name, cacheFile) {
  const cached = await readUpdateCache({ cacheFile }).catch(() => null);
  const entry = cached?.inventory?.find(item => item.name === name) ?? null;
  if (entry && entry.status === 'update-available' && entry.latestVersion) return entry;
  return null;
}

export async function updatePlugin(name, options = {}) {
  if (typeof name !== 'string' || !/^[@a-zA-Z0-9._/-]+$/.test(name) || name.includes('..')) {
    return { ok: false, error: '非法的插件名' };
  }
  const ownsProgress = options.batch !== true;
  if (ownsProgress) {
    beginUpdateProgress('single', [name]);
    // 检测远端版本要联网，可能好几秒：先把「当前插件 + 正在检查」写进进度，
    // 否则面板这几秒里只显示「等待中」，看不出到底在更新谁。
    stepUpdateProgress(name, '正在检查远端最新版本');
  }
  const finish = async result => {
    if (ownsProgress) {
      recordUpdateProgress({ name, ...result });
      finishUpdateProgress();
      if (result.ok) await patchUpdateCacheAfterUpdate([{ name, ...result }], options.cacheFile);
    }
    return result;
  };
  try {
    const sources = await collectPluginSources();
    const source = sources.find(item => item.name === name);
    if (!source) {
      return finish({ ok: false, status: 'unknown', error: '未找到可更新的已安装插件' });
    }
    // 开发链接的两个显式动作不需要远端版本决策：
    // pull-local 直接在用户 checkout 里拉最新；switch-release 自己查 npm。
    if (options.mode === 'pull-local') {
      stepUpdateProgress(name, '正在更新本地开发目录…');
      return finish(await pullLocalUpdate(source, options.target ?? null).catch(error => ({
        ok: false, status: 'dev-linked', error: String(error?.message || error)
      })));
    }
    if (options.mode === 'switch-release') {
      stepUpdateProgress(name, '正在切换为 npm 发行版…');
      return finish(await switchToRelease(source, options.command ?? pluginCommand).catch(error => ({
        ok: false, status: 'dev-linked', error: String(error?.message || error)
      })));
    }
    // 复用检测缓存里的决策（面板列出的可更新版本就是它）；缺失 / 强制重测时才联网。
    const cached = options.check ? null : await cachedDecisionFor(name, options.cacheFile);
    const checkOverride = cached ? { check: async () => [cached] } : {};
    if (cached) stepUpdateProgress(name, `正在更新到 v${cached.latestVersion}…`);
    // 门禁探测只在真实入口（菜单/面板/批量）里跑；单测直接调 applyPluginUpdate 时默认不做，
    // 免得离线测试去连 registry。
    const result = await applyPluginUpdate(source, {
      peerProbe: fetchTargetPeerDependencies, ...checkOverride, ...options
    });
    return finish(result);
  } catch (error) {
    return finish({ ok: false, error: String(error?.message || error) });
  }
}

/**
 * 已安装包在 node_modules 里的实际版本（复核用）。
 * @returns {Promise<string|null>}
 */
export async function installedVersionOf(name) {
  const meta = await readPackageMeta(join(profilesWebModules(), ...String(name).split('/')));
  return meta?.version ?? null;
}

/**
 * 复核更新是否真的落到 node_modules：`file:` 依赖换了源码之后，pnpm 有时不会重新
 * 物化（版本停在旧值），界面就会一直显示"可更新"。没生效就删掉包目录重装一次。
 * @returns {Promise<boolean>} 版本已达到目标
 */
async function verifyUpdateApplied(name, target) {
  const installed = await installedVersionOf(name);
  if (!installed || !target) return false;
  return comparePluginVersions(installed, target) >= 0;
}

/**
 * 区间求值：与 `Sources/PluginCompatibilitySupport.swift` 共用同一套规则，两边各自解释。
 *
 * 支持 `*`/`x`-range、`^`、`~`、`>= 0.1.0`（操作符后有空格）、`||` 分支，比较用
 * `comparePluginVersions`（npm 语义，`rc.1 < rc.6`）。刻意**不**照搬 npm 默认的预发布
 * 门控：dsh 生态常态就是装 rc runtime，套上去会把所有只写正式区间的插件一律报成不兼容。
 * 保留的只有一条安全边界：越过排他上界的预发布不算满足（`<0.2.0` 不接受 `0.2.0-rc.9`）。
 */
export function satisfiesPluginRange(version, range) {
  return String(range ?? '').split('||').some(branch => {
    const comparators = joinSplitComparators(branch);
    if (!comparators.length) return true;
    return comparators.every(comparator => satisfiesPluginComparator(version, comparator));
  });
}

const RANGE_OPERATORS = new Set(['>=', '<=', '>', '<', '=', '^', '~']);

/** `>= 0.1.0` 这种写法不能被拆成两段：拆断后 `>=` 会退化成「必须精确等于」。 */
function joinSplitComparators(branch) {
  const tokens = String(branch ?? '').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (RANGE_OPERATORS.has(tokens[i]) && i + 1 < tokens.length) {
      out.push(tokens[i] + tokens[i + 1]);
      i += 1;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

function versionBase(value) {
  return String(value).replace(/^v(?=\d)/i, '').split('-')[0];
}

function hasPrerelease(value) {
  return String(value).replace(/^v(?=\d)/i, '').split('+')[0].includes('-');
}

/** `^`/`~`/x-range 展开成 `>=` + `<` 上下界；空串与 `*` 是不约束。 */
function expandPluginComparator(comparator) {
  const trimmed = String(comparator).trim();
  if (!trimmed || trimmed === '*' || trimmed === 'x' || trimmed === 'X') return [];
  if (trimmed[0] === '^' || trimmed[0] === '~') return caretOrTildeAtoms(trimmed.slice(1), trimmed[0] === '^');
  const match = /^(>=|<=|>|<|=)?\s*(.*)$/.exec(trimmed);
  const op = match[1] ?? '=';
  const value = match[2];
  if (!value || value === 'x' || value === 'X') return [];
  if (/[xX]/.test(value)) return xRangeAtoms(value);
  return [{ op, value }];
}

function caretOrTildeAtoms(base, caret) {
  const parts = base.split('.').map(part => (/^\d+$/.test(part) ? Number(part) : 0));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  let upper;
  if (!caret) upper = `${major}.${minor + 1}.0`;
  else if (major > 0) upper = `${major + 1}.0.0`;
  else if (minor > 0) upper = `0.${minor + 1}.0`;
  else upper = `0.0.${patch + 1}`;
  return [{ op: '>=', value: base }, { op: '<', value: upper }];
}

function xRangeAtoms(value) {
  const tokens = value.split('.');
  const wildcard = tokens.findIndex(token => token === 'x' || token === 'X' || token === '');
  const numbers = tokens.slice(0, wildcard < 0 ? tokens.length : wildcard).map(Number);
  if (!numbers.length) return [];
  if (numbers.length === 1) return [{ op: '>=', value: `${numbers[0]}.0.0` }, { op: '<', value: `${numbers[0] + 1}.0.0` }];
  return [{ op: '>=', value: `${numbers[0]}.${numbers[1]}.0` }, { op: '<', value: `${numbers[0]}.${numbers[1] + 1}.0` }];
}

function satisfiesPluginComparator(version, comparator) {
  return expandPluginComparator(comparator).every(atom => {
    // 越界的预发布：插件写 `<0.2.0` 排除的就是 0.2 这条线，rc 只是它的更早快照。
    if ((atom.op === '<' || atom.op === '<=') && hasPrerelease(version)
      && !hasPrerelease(atom.value) && versionBase(version) === versionBase(atom.value)) return false;
    const order = comparePluginVersions(version, atom.value);
    if (atom.op === '>=') return order >= 0;
    if (atom.op === '<=') return order <= 0;
    if (atom.op === '>') return order > 0;
    if (atom.op === '<') return order < 0;
    return order === 0;
  });
}

/** peer 声明 vs 已装的 dsh 组件版本：返回不满足的条目。读不到版本的 peer 跳过（宁可不判，不误伤）。 */
export function findPeerIncompatibilities(peers, installedVersions) {
  const problems = [];
  for (const [peer, range] of Object.entries(peers ?? {})) {
    const installed = installedVersions?.[peer];
    if (!installed || !range) continue;
    if (!satisfiesPluginRange(installed, range)) problems.push({ peer, range, installed });
  }
  return problems;
}

/** 目标版本声明的 peerDependencies：npm 走 registry，git 走远端 package.json。失败返回空（不阻断）。 */
export async function fetchTargetPeerDependencies(source, version, deps = {}) {
  const remote = source?.remote ?? {};
  try {
    if (remote.type === 'npm') {
      await ensurePnpmPath();
      const cli = join(dshHome(), 'pnpm-bin', 'pnpm');
      const { stdout } = await run(cli, ['view', `${remote.package ?? source.name}@${version}`, 'peerDependencies', '--json'], { timeout: PROBE_TIMEOUT_MS });
      const parsed = JSON.parse(stdout);
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
    if (remote.type === 'git' && remote.author && remote.repo) {
      const commit = source.installedCommit && version === source.installedVersion ? source.installedCommit : 'HEAD';
      // 与更新检测共用同一条 raw → api.github.com 兜底：raw 在国内网络常被限速/断流，
      // 以前这里静默返回 {}，等于门禁在那种网络下根本不生效。
      const result = await fetchRepoJSON(
        { author: remote.author, repo: remote.repo, subdir: remote.subdir, commit }, PROBE_TIMEOUT_MS, deps
      );
      if (result.error) return {};
      const peers = result.value?.peerDependencies;
      return peers && typeof peers === 'object' ? peers : {};
    }
  } catch { /* 问不到就不阻断更新：预检是加分项，不是新故障源 */ }
  return {};
}

/** 已装 dsh 各组件的版本（peer 都指向它们）。读不到的键直接缺席，交由上层跳过判定。 */
export async function readRuntimePeerVersions(peers) {
  const base = join(dshHome(), 'runtime', 'node_modules');
  const out = {};
  for (const peer of peers) {
    const meta = await readPackageMeta(join(base, peer));
    if (meta?.version) out[peer] = meta.version;
  }
  return out;
}

/**
 * **升级前**装着的那份插件声明的 peer（本地读 package.json，不联网）。
 *
 * 门禁要靠它回答"这次升级有没有让兼容性变差"：目标版本与已装版本都不满足同一个
 * peer 时，挡住升级并不能让环境更兼容（那个版本本来就跑着），只会把用户永远卡在
 * 一个升不动的版本上。读不到就是空表，门禁退回"只看目标版本"的老口径。
 */
export async function readInstalledPeerDependencies(name) {
  const safe = String(name ?? '');
  if (!safe || safe.includes('..')) return {};
  const meta = await readJsonQuiet(join(profilesWebModules(), ...safe.split('/'), 'package.json'));
  const peers = meta?.peerDependencies;
  return peers && typeof peers === 'object' ? peers : {};
}

/** 升级前的兼容门禁说明（写进界面错误里，用户要能看懂该干什么）。 */
function describePeerProblems(problems, target) {
  const detail = problems.map(item => `${item.peer} ${item.range}（当前 ${item.installed}）`).join('；');
  return `目标版本 v${target} 要求 ${detail}，与当前 dsh 运行时不兼容，已阻止升级：先更新 dsh 本体（菜单栏「检查 Deepseek Harness 更新」）再升这个插件`;
}

/** 「这次升级新引入的 peer 问题」之外的既有问题：如实写进成功提示，不静默吞掉。 */
function describePeerCarryOver(problems) {
  if (!problems.length) return null;
  const detail = problems.map(item => `${item.peer} ${item.range}（当前 ${item.installed}）`).join('；');
  return `注意：${detail} 与当前运行时不符，但升级前的版本也是这么声明的，本次升级没有让兼容性变差`;
}

/**
 * 就地更新「link: 到用户自己 checkout」的开发链接插件（用户明确点了更新才会走这里，
 * 默认仍然拒绝——见 applyPluginUpdate 里的 dev-linked 分支）。
 *
 * 流程：工作区干净门禁 → fetch → 快进合并 → 依赖变化时 pnpm install → 重新构建 →
 * 版本与入口验收。绝不改用户分支、绝不 reset/丢弃本地提交。
 * @returns 更新结果（与 applyPluginUpdate 同形状）
 */
async function pullLocalUpdate(source, target) {
  const dir = resolve(source.remote.dir);
  const inside = await gitInDir(dir, ['rev-parse', '--is-inside-work-tree'], 10000).catch(() => null);
  if (!inside || !/true/.test(inside.stdout)) {
    return { ok: false, status: 'dev-linked', error: `目录 ${dir} 不是 git 仓库，无法就地更新` };
  }
  const branch = (await gitInDir(dir, ['rev-parse', '--abbrev-ref', 'HEAD'], 10000).catch(() => null))?.stdout.trim();
  if (!branch || branch === 'HEAD') {
    return { ok: false, status: 'dev-linked', error: `${dir} 处于分离 HEAD 状态，为避免动你的工作区，请先切回分支再更新` };
  }
  // 工作区有未提交改动时直接拒绝（忽略 untracked：node_modules、.dsh-source.json 都是）。
  const dirty = await gitInDir(dir, ['status', '--porcelain', '--untracked-files=no'], 10000).catch(() => ({ stdout: '' }));
  if (dirty.stdout.trim()) {
    return {
      ok: false,
      status: 'dev-linked-dirty',
      error: `目录 ${dir} 有未提交改动，为避免覆盖你的工作请先提交或暂存：\n${dirty.stdout.trim().slice(0, 600)}`
    };
  }
  // 上游分支：优先跟踪的 @{u}，否则 origin/<当前分支>。
  let upstream = (await gitInDir(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], 10000)
    .catch(() => null))?.stdout.trim() || '';
  if (!upstream) {
    const remotes = await gitInDir(dir, ['remote'], 10000).catch(() => ({ stdout: '' }));
    const remoteName = remotes.stdout.split(/\s+/).find(item => item === 'origin') || remotes.stdout.split(/\s+/)[0];
    if (!remoteName) return { ok: false, status: 'dev-linked', error: `目录 ${dir} 没有配置 git 远程，无法更新` };
    upstream = `${remoteName}/${branch}`;
  }
  await gitInDir(dir, ['fetch', '--all', '--prune'], 120000);
  // 本地领先于上游就不自动合并，避免把用户的提交搞乱。
  const aheadBehind = await gitInDir(dir, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`], 15000)
    .catch(() => ({ stdout: '0\t0' }));
  const [ahead = 0, behind = 0] = aheadBehind.stdout.trim().split(/\s+/).map(Number);
  if (ahead > 0) {
    return {
      ok: false,
      status: 'dev-linked-ahead',
      error: `目录 ${dir} 有 ${ahead} 个本地提交尚未推送到 ${upstream}，自动快进会丢掉它们；请先自行处理本地提交`
    };
  }
  if (behind === 0) {
    return { ok: false, status: 'up-to-date', error: `${upstream} 没有新提交` };
  }
  const manifestBefore = await fs.readFile(join(dir, 'package.json'), 'utf8').catch(() => '');
  await gitInDir(dir, ['merge', '--ff-only', upstream], 120000);
  const manifestAfter = await fs.readFile(join(dir, 'package.json'), 'utf8').catch(() => '');
  const depsChanged = manifestBefore !== manifestAfter;
  // package.json 变了：先在 checkout 里装依赖（link 依赖不会自动装子目录的依赖）。
  if (depsChanged) {
    await ensurePnpmPath();
    const [pathWithPnpm] = await ensurePnpmPath();
    const corepack = await hasCommandOnPath('corepack');
    const pnpmArgs = ['pnpm', 'install'];
    await run(process.execPath, [corepack, ...pnpmArgs], {
      cwd: dir, timeout: 300000, env: { ...process.env, PATH: pathWithPnpm }
    });
  }
  // 构建：很多插件（dsh-genui 等）需要 build 后才生成 dist 与 client 产物。
  const meta = JSON.parse(manifestAfter);
  const script = meta?.scripts?.build ? 'build' : (meta?.scripts?.prepare ? 'prepare' : null);
  if (script) {
    await ensurePnpmPath();
    const [pathWithPnpm] = await ensurePnpmPath();
    const corepack = await hasCommandOnPath('corepack');
    await run(process.execPath, [corepack, 'pnpm', 'run', script], {
      cwd: dir, timeout: 300000, env: { ...process.env, PATH: pathWithPnpm }
    });
  }
  // 验收：版本号与入口文件。
  const version = meta?.version || null;
  const entryChecks = [
    meta?.main ? join(dir, meta.main) : null,
    meta?.exports?.['./client'] ? join(dir, meta.exports['./client']) : null
  ].filter(Boolean);
  for (const file of entryChecks) {
    if (!(await pathExists(file))) {
      return { ok: false, status: 'dev-linked', error: `更新后入口文件缺失：${file}；构建可能失败，请在 ${dir} 里查看` };
    }
  }
  // 把来源标记里的 commit 更新到新 HEAD，下次检测才知道现在装的是哪个版本。
  const head = await gitInDir(dir, ['rev-parse', 'HEAD'], 10000).catch(() => ({ stdout: '' }));
  const commit = head.stdout.trim().toLowerCase();
  if (/^[0-9a-f]{40}$/.test(commit)) {
    await fs.writeFile(join(dir, SOURCE_MARKER_NAME), JSON.stringify({
      author: source.remote.author,
      repo: source.remote.repo,
      subdir: source.remote.subdir ?? null,
      url: source.remote.url,
      commit,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8').catch(() => {});
  }
  return {
    ok: true,
    updatedTo: version || target,
    verified: Boolean(version && (!target || comparePluginVersions(version, target) >= 0)),
    restartRequired: true,
    note: `已在本地目录 git pull 到 ${version ? `v${version}` : upstream}${depsChanged ? '（并重装了依赖）' : ''}${script ? '、重新构建' : ''}，重启 dsh 后生效`
  };
}

/**
 * 放弃本地开发链接，改用 npm 上的发行版（dev-linked 插件的第二条出路）。
 * 用户的本地 checkout 不动：pnpm add 会把 package.json 里的 link: 规格换成 npm 包。
 */
async function switchToRelease(source, command) {
  await ensurePnpmPath();
  const cli = join(dshHome(), 'pnpm-bin', 'pnpm');
  const [pathWithPnpm] = await ensurePnpmPath();
  const view = await run(cli, ['view', source.name, 'version', '--json'], {
    timeout: PROBE_TIMEOUT_MS, env: { ...process.env, PATH: pathWithPnpm }
  }).catch(() => null);
  const npmVersion = view ? JSON.parse(String(view.stdout).trim() || 'null') : null;
  if (!npmVersion) {
    return { ok: false, status: 'dev-linked', error: `npm 上没有发布 ${source.name}，无法切换为发行版；可在本地目录 git pull 更新` };
  }
  if (source.installedVersion && comparePluginVersions(npmVersion, source.installedVersion) <= 0) {
    return {
      ok: false,
      status: 'dev-linked',
      error: `npm 上最新发行版是 v${npmVersion}，不比本地链接的 v${source.installedVersion} 新，切换没有意义`
    };
  }
  stepUpdateProgress(source.name, `正在从 npm 安装发行版 v${npmVersion}…`);
  await command(['add', `${source.name}@${npmVersion}`]);
  const gaps = await installedImportGaps(source.name);
  if (gaps.length) {
    return {
      ok: false,
      status: 'rolled-back',
      restartRequired: true,
      error: `${describeUnresolvableImports(gaps)}；${await restorePreviousVersion(source, command)}`
    };
  }
  const applied = await verifyUpdateApplied(source.name, npmVersion);
  return {
    ok: true,
    updatedTo: npmVersion,
    verified: applied,
    restartRequired: true,
    note: applied
      ? `已切换为 npm 发行版 v${npmVersion}（本地目录 ${source.remote.dir} 未动），重启 dsh 后生效`
      : `已安装 npm 发行版 v${npmVersion}，但 node_modules 版本未变，重启 dsh 后确认`
  };
}

/**
 * 按来源分派更新动作：
 * - npm：`pnpm add <name>@<latest>`（显式指定版本，插件记录里就是新版本号）；
 * - `github:` 依赖：按原 spec 重新解析（pnpm 会拉到默认分支最新 commit）；
 * - plugin-sources 的克隆：先备份成 `.bak-<时间戳>` 再重新 clone 覆盖，失败回滚。
 *   克隆出来的源码若自己的相对 import 都落不了地，同样算失败并回滚——残缺源码装进
 *   profile 之后版本号是对的，只有重启 dsh 才会炸。
 * - link: 指向用户开发 checkout：默认拒绝；用户显式选择 mode=pull-local（就地
 *   git pull + 构建）或 mode=switch-release（换成 npm 发行版）后才执行。
 * 服务端插件代码要重启 dsh 才生效，所以统一回 `restartRequired: true`。
 */
export async function applyPluginUpdate(source, options = {}) {
  const check = options.check ?? (sources => runUpdateCheck(sources, options.probe ?? {}));
  const command = options.command ?? pluginCommand;
  const clone = options.clone ?? cloneToSources;
  const [entry] = await check([source]);
  if (!entry || entry.status !== 'update-available') {
    return { ok: false, status: entry?.status ?? 'unknown', error: entry?.error ?? '没有检测到可更新的版本' };
  }
  const target = entry.latestVersion;
  const remote = source.remote;
  stepUpdateProgress(source.name, `正在解析最新版本 v${target}…`);

  // 升级前的兼容门禁：目标版本声明的 peer 与当前 dsh 运行时不满足就当场挡住。
  // 插件升级失败最多是插件不生效，但装上不兼容的版本会让 dsh 起不来。
  // 探测本身失败（registry 不通、仓库改名）时放行：判不了不等于不兼容，而装坏还有
  // 装后验收 + 自动退回 + 启动隔离三层兜着。门禁只负责"知道不兼容时别装"。
  let declaredPeers = {};
  let peerProbeWarning = null;
  try {
    declaredPeers = await (options.peerProbe ?? (async () => ({})))(source, target) ?? {};
  } catch (error) {
    peerProbeWarning = `没能确认 v${target} 的 dsh 版本要求（${String(error?.message || error)}）`;
  }
  // 门禁判的是"这次升级会不会让环境更糟"，所以要把**已装版本**的 peer 声明一起摆上桌。
  // 实测的卡死案例：运行时 @earendil-works/pi-ai 已经是 1.1.0，而插件从 4.3.1 到 4.4.2
  // 都声明 `>=0.85.0 <0.88.0`——目标版本"不满足"的正是**装着的那个版本**也一直不满足的
  // 同一个 peer，挡住它只会让用户卡在一个再也升不动的版本上（插件自己还专门写了 1.x 的
  // 适配分支）。这类"继承而来的"问题因此只提示、不阻止；只有目标版本**新引入**的不兼容
  // （已装版本满足、目标版本不满足）才继续挡。
  const installedPeers = await (options.installedPeers ?? readInstalledPeerDependencies)(source.name);
  const runtimeVersions = await readRuntimePeerVersions(
    [...new Set([...Object.keys(declaredPeers), ...Object.keys(installedPeers)])]
  );
  const peerProblems = findPeerIncompatibilities(declaredPeers, runtimeVersions);
  const inheritedPeers = new Set(findPeerIncompatibilities(installedPeers, runtimeVersions).map(item => item.peer));
  const blockingProblems = peerProblems.filter(item => !inheritedPeers.has(item.peer));
  if (blockingProblems.length) {
    return { ok: false, status: 'peer-incompatible', error: describePeerProblems(blockingProblems, target) };
  }
  const peerCarryOver = describePeerCarryOver(peerProblems);
  const withCarryOver = result => peerCarryOver
    ? { ...result, note: [result.note, peerCarryOver].filter(Boolean).join('；') }
    : result;

  if (source.kind === 'npm') {
    stepUpdateProgress(source.name, `正在下载并安装 v${target}…`);
    await command(['add', `${source.name}@${target}`]);
    const gaps = await installedImportGaps(source.name);
    if (gaps.length) {
      return {
        ok: false,
        status: 'rolled-back',
        restartRequired: true,
        error: `${describeUnresolvableImports(gaps)}；${await restorePreviousVersion(source, command)}`
      };
    }
    stepUpdateProgress(source.name, `正在同步 profile…`);
    // verifyApplied 可注入：离线单测没有真实 node_modules 物化，注入固定结论。
    const verify = options.verifyApplied ?? verifyUpdateApplied;
    let applied = await verify(source.name, target);
    if (!applied) {
      // pnpm 对既有包的版本更新常不重新物化（退出 0、node_modules 停在旧值）：
      // 清掉包目录与锁文件记录再装一次，能掰回来就不把「重启确认」推给用户。
      await clearPinnedPackage(source.name);
      await command(['add', `${source.name}@${target}`]);
      applied = await verify(source.name, target);
    }
    return withCarryOver({
      ok: true,
      updatedTo: target,
      restartRequired: true,
      verified: applied,
      note: [applied ? `已更新到 v${target}` : `已安装 v${target}，但 node_modules 版本未变，重启 dsh 后确认`, peerProbeWarning]
        .filter(Boolean).join('；')
    });
  }

  if (source.kind === 'git' && remote) {
    if (remote.dir) {
      // 数据安全红线：备份-改名-重克隆流程只允许动 plugin-sources 里由启动器克隆的
      // 目录。link:/file: 指向用户自己的开发 checkout（如 ~/项目/dsh-genui）时，
      // 这套流程会把用户的目录改名成 .bak——实测已经把一个本地目录这么挪走过。
      // 对用户目录一律拒绝自动更新，并给出明确出路。
      const sourcesRoot = resolve(join(profilesWebModules(), '..', 'plugin-sources'));
      if (!resolve(remote.dir).startsWith(sourcesRoot + sep)) {
        // 用户自己的开发 checkout：默认绝不擅动。界面拿到 dev-linked 后会给出
        // 两个明确动作，二选一、且必须用户显式发起：
        //   - mode=pull-local：在用户目录里 git pull + 装依赖 + 重新构建（pullLocalUpdate）
        //   - mode=switch-release：改用 npm 发行版，不碰用户目录（switchToRelease）
        if (options.mode === 'pull-local') {
          stepUpdateProgress(source.name, '正在更新本地开发目录…');
          return await pullLocalUpdate(source, target);
        }
        if (options.mode === 'switch-release') {
          stepUpdateProgress(source.name, '正在切换为 npm 发行版…');
          return await switchToRelease(source, command);
        }
        return {
          ok: false,
          status: 'dev-linked',
          error: `该插件链接到本地目录（${remote.dir}），自动更新会改动这个目录，已被拒绝。可在界面上选择「更新本地目录」（git pull + 重新构建）或「切换为 npm 发行版」；也可在目录内自行 git pull 后重启 dsh`
        };
      }
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backup = `${remote.dir}.bak-${stamp}`;
      const hadSource = await pathExists(remote.dir);
      if (hadSource) {
        await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
        // 备份这一步以前是 .catch(() => {})：备份没做成和"本来就没有旧目录"长得一模一样，
        // 后面 clone 一失败就能把唯一能用的源码 rm 掉。现在让它如实抛错，此时还没动过任何东西。
        await fs.rename(remote.dir, backup);
      }
      let clonedDest = null;
      try {
        stepUpdateProgress(source.name, '正在重新克隆源码…');
        const cloned = await clone(
          { author: remote.author, repo: remote.repo, subdir: remote.subdir ?? null, full: `${remote.author}/${remote.repo}` },
          remote.subdir ?? null
        );
        if (!cloned.ok) throw new Error(cloned.error || '重新克隆失败');
        clonedDest = cloned.dest ?? null;
        // 校验放在 pnpm add 之前：源码残缺就 throw 出去，让下面的 catch 把 .bak 换回来，
        // profile 一行都不动。
        stepUpdateProgress(source.name, '正在校验插件源码…');
        const missing = await findUnresolvableLocalImports(clonedDest ?? remote.dir);
        if (missing.length) throw new Error(describeUnresolvableImports(missing));
        stepUpdateProgress(source.name, '正在同步 profile…');
        await command(['add', `file:${cloned.dest}`]);
      } catch (error) {
        if (hadSource && !(await restoreSourceBackup(backup, remote.dir))) {
          throw new Error(`${String(error?.message || error)}；旧版本没能从 ${backup.split('/').pop()} 放回原位，`
            + `dsh 可能已经起不来，请按日志里的路径手工恢复该目录`);
        }
        throw error;
      }
      await pruneSourceBackups(remote.dir);
      return {
        ok: true,
        updatedTo: target,
        restartRequired: true,
        ...(withCarryOver(await finalizeFileSourceUpdate(
          source.name, target, clonedDest ?? remote.dir, command, backup, remote.dir
        )))
      };
    }
    stepUpdateProgress(source.name, `正在重新解析 ${source.spec ?? `github:${remote.author}/${remote.repo}`}…`);
    await command(['add', source.spec ?? `github:${remote.author}/${remote.repo}`]);
    const gaps = await installedImportGaps(source.name);
    if (gaps.length) {
      return {
        ok: false,
        status: 'rolled-back',
        restartRequired: true,
        error: `${describeUnresolvableImports(gaps)}；${await restorePreviousVersion(source, command)}`
      };
    }
    const parsed = await verifyUpdateApplied(source.name, target);
    return withCarryOver({
      ok: true,
      updatedTo: target,
      restartRequired: true,
      verified: parsed,
      note: parsed ? `已更新到 v${target}` : `已重新解析依赖，但 node_modules 版本未变，重启 dsh 后确认`
    });
  }

  return { ok: false, error: '该插件来源无法自动更新' };
}

/**
 * 升级装出来一个 import 落不了地的版本时，把 profile 退回升级**之前**的那一份。
 * 退不回去就如实说，别把用户留在"看起来更新成功、其实起不来"的状态。
 */
async function restorePreviousVersion(source, command) {
  const previous = source.installedVersion;
  if (source.kind === 'npm') {
    if (!previous) return `无法自动退回：不知道 v${source.name} 升级前的版本号，请在插件管理里手动重装`;
    try {
      await command(['add', `${source.name}@${previous}`]);
      return `已退回原版本 v${previous}，重启 dsh 后生效`;
    } catch (error) {
      return `退回 v${previous} 也失败（${String(error?.message || error)}），该插件现在需要手动重装或卸载`;
    }
  }
  const remote = source.remote ?? {};
  if (source.kind === 'git' && remote.author && remote.repo && source.installedCommit) {
    const spec = `github:${remote.author}/${remote.repo}#${source.installedCommit}`;
    try {
      await command(['add', spec]);
      return `已退回原 commit ${String(source.installedCommit).slice(0, 8)}，重启 dsh 后生效`;
    } catch (error) {
      return `退回 ${spec} 失败（${String(error?.message || error)}），该插件现在需要手动重装或卸载`;
    }
  }
  return '没有足够的版本信息自动退回，请在插件管理里手动重装或卸载该插件';
}

/**
 * 收尾阶段（已经 `pnpm add` 过新源码）的回滚：把更新前的源码**换回依赖指向的那个目录**，
 * 再让 pnpm 指回它。
 *
 * 以前这里是 `pnpm add file:<.bak 目录>`——把 package.json 的依赖改成指向备份目录。
 * 于是下一次更新把 `.bak-…` 当成"当前源码"，又给它套一层 `.bak-…`；用户实测的
 * `…bak-20261021090041.bak-20261021090348.bak-20261021090644` 就是这么滚出来的，
 * 依赖永远指在一个名字带 `.bak` 的目录上，更新再也回不到正轨。
 */
async function rollbackFileSourceUpdate(name, command, backup, sourceDir, dest) {
  if (!backup || !(await pathExists(backup))) {
    return `旧版本源码副本已不在（${backup ?? '无备份'}），请在插件管理里重装或卸载 ${name}`;
  }
  // 新克隆出来的目录和依赖目录不是同一个时先清掉，别把两份源码同时留着。
  if (resolve(dest) !== resolve(sourceDir)) await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
  if (!(await restoreSourceBackup(backup, sourceDir))) {
    return `旧版本没能从 ${backup.split('/').pop()} 放回 ${sourceDir}，请按日志里的路径手工恢复该目录`;
  }
  try {
    await command(['add', `file:${sourceDir}`]);
    return `已改回更新前的源码副本（${backup.split('/').pop()}），重启 dsh 后确认`;
  } catch (error) {
    return `旧源码已放回 ${sourceDir}，但 profile 没能同步（${String(error?.message || error)}），重启 dsh 前请确认该插件`;
  }
}

/**
 * `file:` 来源更新后的收尾：复核 node_modules 里的版本，没跟上就删掉包目录重装一次
 * 再复核。pnpm 对未变化的 `file:` 依赖有时不会重新物化，这一步能把它掰回来；
 * 仍然不生效就如实上报 verified=false，让界面提示用户重启 dsh。
 * @param {string} dest - 这次装进去的新源码目录。
 * @param {string} backup - 更新前源码的备份目录（`<sourceDir>.bak-<时间戳>`）。
 * @param {string} sourceDir - 依赖记录指向的源码目录（回滚时内容要换回这里）。
 */
async function finalizeFileSourceUpdate(name, target, dest, command, backup, sourceDir = dest) {
  const backupNote = `（旧版本保留为 ${backup.split('/').pop()}）`;
  if (await verifyUpdateApplied(name, target)) {
    return { verified: true, note: `已更新到 v${target}${backupNote}` };
  }
  // node_modules 里压根没有这个包（例如手工删过）：重装也复核不出结果，如实上报。
  if (!(await installedVersionOf(name))) {
    return { verified: false, note: `源码已更新到 v${target}${backupNote}，node_modules 里没有该包，重启 dsh 后确认` };
  }
  const packageDir = join(profilesWebModules(), ...String(name).split('/'));
  await fs.rm(packageDir, { recursive: true, force: true }).catch(() => {});
  await stripStaleLockEntry(name);
  try {
    await command(['add', `file:${dest}`]);
  } catch (error) {
    // 包目录已经删了、重装又失败：profile 正处于"这个包不存在"的半坏状态，先把旧源码换回去。
    const detail = `重装 v${target} 失败（${String(error?.message || error)}）；`
      + await rollbackFileSourceUpdate(name, command, backup, sourceDir, dest);
    return { ok: false, verified: false, error: detail, note: detail };
  }
  // 重装成功不等于装对了：pnpm 的 file: 链接会原样反映源码目录，源码残缺时版本复核
  // 照样通过（那次事故就是这样）。所以只校验**这次装进去的那份新源码** `dest`——以前
  // 查的是 node_modules 解析出来的目录，pnpm 没重新物化时会把旧目录原有的缺口当成本次
  // 更新的问题：用户实测 qoder 插件卡在 0.5.0，每点一次更新都把它 0.5.0 开发目录里的
  // 老缺口报成"新源码残缺"，回滚一次名字就多一层 `.bak-`，永远升不上去。
  const gaps = await findUnresolvableLocalImports(dest);
  if (gaps.length) {
    const detail = `${describeUnresolvableImports(gaps)}；`
      + await rollbackFileSourceUpdate(name, command, backup, sourceDir, dest);
    return { ok: false, verified: false, error: detail, note: detail };
  }
  if (await verifyUpdateApplied(name, target)) {
    return { verified: true, note: `已更新到 v${target}${backupNote}（重装了一次让 node_modules 跟上）` };
  }
  // 源码已经是新版、只是 node_modules 还没跟上：这是"重启 dsh 后确认"的状态，不算失败，
  // 更不能拿旧目录的缺口再回滚一次（那正是老代码的死循环）。
  return {
    verified: false,
    note: `源码已更新到 v${target}${backupNote}，但 node_modules 里还是旧版本（可能仍链到旧目录），重启 dsh 后确认`
  };
}

/** 只保留最近一个 `.bak-*` 备份，避免 plugin-sources 越滚越大。 */
export async function pruneSourceBackups(dest) {
  const dir = dest.replace(/\/[^/]+$/, '');
  const name = dest.split('/').filter(Boolean).pop();
  if (!dir || !name) return [];
  let entries = [];
  try { entries = await fs.readdir(dir); } catch { return []; }
  const backups = entries.filter(entry => entry.startsWith(`${name}.bak-`)).sort().reverse();
  const removed = [];
  // 被 Ctrl+C 或崩溃打断的克隆会把 `.staged-*` 留在原地，下次更新用不到它。
  for (const stale of entries.filter(entry => entry.startsWith(`${name}.staged-`))) {
    await fs.rm(join(dir, stale), { recursive: true, force: true }).catch(() => {});
    removed.push(stale);
  }
  for (const stale of backups.slice(1)) {
    await fs.rm(join(dir, stale), { recursive: true, force: true }).catch(() => {});
    removed.push(stale);
  }
  return removed;
}

/** 批量更新（面板的「全部更新」）：逐个来，单个失败不影响其它。 */
let lastBatchUpdate = null;
// 同一时间只允许一个批次。更新是顺序执行的（pnpm 只写一个 profile），两个批次撞在
// 一起会互相覆盖进度、并发写同一个 profile：界面卡在「更新中…」，汇总数字也对不上。
let batchUpdateRunning = false;

/** 最近一次批量更新的结果（客户端轮询 `/updates` 时读它来汇总提示）。 */
export function readLastBatchUpdate() {
  return lastBatchUpdate;
}

/** 是否有批量更新正在执行（`/update-many` 用它拒绝重复受理）。 */
export function isBatchUpdateRunning() {
  return batchUpdateRunning;
}

/**
 * link:/file: 依赖指向 plugin-sources 之外的目录 = 用户自己的开发 checkout
 *（批量更新对它们只能跳过：动用户目录是红线，见 applyPluginUpdate 的守卫）。
 */
export function isDevLinkedSource(source) {
  const dir = source?.remote?.dir;
  if (!dir) return false;
  const sourcesRoot = resolve(join(profilesWebModules(), '..', 'plugin-sources'));
  return !resolve(dir).startsWith(sourcesRoot + sep);
}

export async function updatePlugins(names, options = {}) {
  if (batchUpdateRunning) {
    return { ok: false, busy: true, error: '已有批量更新正在进行，请等它结束后再试' };
  }
  const list = (Array.isArray(names) ? names : []).filter(name => typeof name === 'string' && name);
  if (list.length === 0) return { ok: false, error: '没有要更新的插件' };
  batchUpdateRunning = true;
  const startedAt = new Date().toISOString();
  lastBatchUpdate = { startedAt, finishedAt: null, updated: 0, failed: 0, results: [] };
  beginUpdateProgress('batch', list);
  const results = [];
  const summary = { startedAt, finishedAt: null, updated: 0, failed: 0, results };
  try {
    // 一次解析来源，逐个判断：dev-linked（本地开发目录链接）的插件批量跳过——
    // 默认模式会拒绝它们（实测：全部更新每跑一次就报一次失败，用户以为坏了），
    // 正确出路是行内「更新」的二选一确认块。
    const sources = await collectPluginSources();
    const byName = new Map(sources.map(item => [item.name, item]));
    for (const name of list) {
      // 轮到谁就把「当前插件 + 正在检查」写进进度：从受理到联网探测完的这几秒里，
      // 面板要能显示正在检查谁，而不是全列「等待中」。
      stepUpdateProgress(name, '正在检查远端最新版本');
      if (isDevLinkedSource(byName.get(name))) {
        const skipped = {
          name, ok: false, skipped: true, status: 'dev-linked',
          error: '本地开发目录链接的插件不走批量更新；请在行内「更新」里选择「更新本地目录」或「切换为发行版」',
        };
        recordUpdateProgress({ ...skipped });
        results.push(skipped);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop -- 顺序更新避免 pnpm 并发写同一个 profile
      const result = await updatePlugin(name, { ...options, batch: true });
      recordUpdateProgress({ name, ...result });
      results.push({ name, ...result });
    }
  } finally {
    // 中途抛错也要把进度收尾，否则面板/启动器会一直显示「更新中…」。
    summary.finishedAt = new Date().toISOString();
    summary.updated = results.filter(item => item.ok).length;
    summary.failed = results.filter(item => !item.ok).length;
    lastBatchUpdate = summary;
    finishUpdateProgress();
    batchUpdateRunning = false;
  }
  // 有一个成功就失效，让面板/启动器马上看到真实状态。
  await patchUpdateCacheAfterUpdate(results, options.cacheFile);
  return { ok: results.every(item => item.ok), ...summary };
}

/**
 * Remove a leftover of a failed install (dangling symlink / partial checkout)
 * from the profile's node_modules. Only a bare package path (optionally under
 * an `@scope` directory) is accepted, so the path cannot escape the modules
 * directory. Also drops any matching entry from the profile's package.json
 * dependencies, so a stale `link:`/`file:` record cannot resurrect the broken
 * symlink on the next `pnpm add`.
 * @param {string} name - module name, e.g. `foo` or `@scope/foo`.
 * @returns {Promise<{ok:boolean}>}
 */
export async function cleanupBrokenPlugin(name) {
  if (typeof name !== 'string' || !/^[@a-zA-Z0-9._/-]+$/.test(name) || name.includes('..')) {
    throw new Error('非法的插件名');
  }
  // 清理坏安装的手段本身不能用来拆掉必需组件：内置插件与 core bundle 一旦被删，
  // dsh 会直接缺服务，而 UI 的 gating 挡不住直接打接口的调用。
  if (PROTECTED_PLUGINS.has(name) || CORE_BUNDLES.has(name)) {
    throw new Error(`${name} 是启动器/dsh 的必需组件，不能清理`);
  }
  const target = join(profilesWebModules(), name);
  await fs.rm(target, { recursive: true, force: true });
  // Also drop any stale dependency / bundle record from the profile manifest
  // so the broken entry cannot come back on the next install.
  const manifestPath = join(profilesWebModules(), '..', 'package.json');
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    let changed = false;
    if (manifest.dependencies && Object.prototype.hasOwnProperty.call(manifest.dependencies, name)) {
      delete manifest.dependencies[name];
      changed = true;
    }
    if (manifest.dsh?.profile?.bundles && manifest.dsh.profile.bundles.includes(name)) {
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(entry => entry !== name);
      changed = true;
    }
    if (changed) {
      await writeTextAtomic(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    }
  } catch { /* no manifest to clean */ }
  return { ok: true };
}

async function refreshMarketRepo() {
  await fs.rm(marketRepoDir(), { recursive: true, force: true });
  await fs.mkdir(marketRoot(), { recursive: true });
  await run('git', ['clone', '--depth', '1', MARKET_REPO_URL, marketRepoDir()], { timeout: 300000 });
  return marketRepoDir();
}

async function readJsonIfExists(path) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// 官方插件源：DeepSeek 官方没有维护「第三方插件清单」仓库，也没有内置 index.json
//（官方文档明确写「DSH 不内置任何索引源」），官方插件就是 npm 上 @deepseek-ai scope
// 发布的插件 bundle。所以官方来源直接查 npm registry：
//   1) 用两个名字查询把候选包捞出来（bundle 名字带 dsh-experimental-*-bundle，
//      插件名带 dsh-plugin-*）；
//   2) 逐个读 latest 清单，只保留声明了 `dsh.bundle` 的包 —— 那才是能装进 profile
//      的插件 bundle；dsh-fs / dsh-plugin-manager 这类框架包装了没有意义。
// 任何一个请求失败都只让官方来源变空，社区清单照常可用。
// ---------------------------------------------------------------------------

const OFFICIAL_MARKET_SCOPE = '@deepseek-ai';
const OFFICIAL_MARKET_CATEGORY = 'official';
const OFFICIAL_MARKET_QUERIES = ['@deepseek-ai/dsh-experimental-bundle', '@deepseek-ai/dsh-plugin'];
const OFFICIAL_MARKET_SEARCH_SIZE = 60;
const OFFICIAL_MARKET_INDEX_VERSION = 2;

/** 从 npm registry 拉官方插件 bundle 列表（联网；失败返回空数组）。 */
export async function fetchOfficialMarketPlugins(deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const found = new Map();
  for (const query of OFFICIAL_MARKET_QUERIES) {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${OFFICIAL_MARKET_SEARCH_SIZE}`;
    const result = await readRemoteJSON(url, PROBE_TIMEOUT_MS, doFetch).catch(() => ({ error: 'registry 搜索失败' }));
    if (result.error) continue;
    for (const object of result.value?.objects ?? []) {
      const meta = object?.package;
      const name = typeof meta?.name === 'string' ? meta.name : '';
      if (!name.startsWith(`${OFFICIAL_MARKET_SCOPE}/`)) continue;
      // 名字里没有 bundle/plugin 的一定不是插件（框架、工具库），先挡掉省掉逐个读清单。
      if (!/bundle|plugin/i.test(name)) continue;
      if (!found.has(name)) {
        found.set(name, {
          downloads: Number(object?.downloads?.monthly) || 0,
          addedDate: typeof meta.date === 'string' ? meta.date : null
        });
      }
    }
  }
  const rows = await mapWithConcurrency([...found.keys()], PROBE_CONCURRENCY, async name => {
    const url = `https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`;
    const result = await readRemoteJSON(url, PROBE_TIMEOUT_MS, doFetch);
    const manifest = result.error ? null : result.value;
    if (!manifest?.dsh?.bundle) return null;
    const meta = found.get(name) ?? {};
    return {
      id: name,
      url: name,
      name,
      author: OFFICIAL_MARKET_SCOPE,
      repo: name.slice(OFFICIAL_MARKET_SCOPE.length + 1),
      category: OFFICIAL_MARKET_CATEGORY,
      source: 'official',
      version: typeof manifest.version === 'string' ? manifest.version : null,
      descriptionEn: typeof manifest.description === 'string' ? manifest.description : '',
      descriptionZh: null,
      downloads: meta.downloads ?? 0,
      stars: 0,
      screenshot: null,
      addedDate: meta.addedDate ?? null
    };
  });
  return rows
    .filter(row => row && !row.error && row.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 官方条目排前面，按 url（或包名）去重；社区清单里同一个插件不重复出现。 */
export function mergeMarketPlugins(official, community) {
  const seen = new Set();
  const merged = [];
  for (const plugin of [...(official ?? []), ...(community ?? [])]) {
    if (!plugin) continue;
    const key = String(plugin.url || plugin.name || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(plugin);
  }
  return merged;
}

/** 分类排序：官方固定第一位，其余按字母。 */
function sortMarketCategories(categories) {
  return [...new Set(categories)].sort((left, right) => {
    if (left === OFFICIAL_MARKET_CATEGORY) return -1;
    if (right === OFFICIAL_MARKET_CATEGORY) return 1;
    return left.localeCompare(right);
  });
}

/**
 * Rebuild the local marketplace index from awesome-dsh-plugin's data/ plus the
 * official `@deepseek-ai` plugin bundles published on npm.
 * @returns {Promise<{count:number,official:number,categories:string[],indexedAt:string}>}
 */
export async function refreshMarketplace() {
  const repoDir = await refreshMarketRepo();
  const pluginsDir = join(repoDir, 'data', 'plugins');
  const downloads = await readJsonIfExists(join(repoDir, 'data', 'downloads.json'));
  const stars = await readJsonIfExists(join(repoDir, 'data', 'stars.json'));
  const screenshots = await readJsonIfExists(join(repoDir, 'data', 'screenshots.json'));
  const addedDates = await readJsonIfExists(join(repoDir, 'data', 'added-dates.json'));

  let files = [];
  try { files = await fs.readdir(pluginsDir); } catch { files = []; }
  const community = [];
  for (const file of files) {
    if (!file.endsWith('.yml')) continue;
    const raw = await fs.readFile(join(pluginsDir, file), 'utf8');
    const parsed = parsePluginYml(raw);
    if (!parsed.url) continue;
    const url = parsed.url;
    community.push({
      id: file.replace(/\.yml$/, ''),
      url,
      name: parsed.name || url,
      author: (parsed.name || '').split('/')[0] || '',
      repo: (parsed.name || '').split('/')[1] || '',
      category: parsed.category || 'other',
      source: 'community',
      descriptionEn: parsed.description?.en || '',
      descriptionZh: parsed.description?.zh || '',
      downloads: downloads[url]?.downloads ?? 0,
      stars: stars[url]?.stars ?? 0,
      screenshot: screenshots[url] ?? null,
      addedDate: addedDates[url] ?? null
    });
  }

  // 官方来源走网络查询；拿不到就只少这一块，不能让整个市场刷新失败。
  const official = await fetchOfficialMarketPlugins().catch(() => []);
  const plugins = mergeMarketPlugins(official, community);
  const categories = sortMarketCategories(plugins.map(plugin => plugin.category));
  await fs.mkdir(marketRoot(), { recursive: true });
  const index = { version: OFFICIAL_MARKET_INDEX_VERSION, indexedAt: new Date().toISOString(), categories, plugins };
  const tmp = `${marketIndexFile()}.tmp-${process.pid}`;
  // 写失败/被杀同样会留下半截 market/index.json.tmp-<pid>，所以出错要自己收干净
  // （其它 tmp 命名走 writeTextAtomic 那一套的清理）。
  try {
    await fs.writeFile(tmp, JSON.stringify(index), 'utf8');
    await fs.rename(tmp, marketIndexFile());
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
  return { count: plugins.length, official: official.length, categories, indexedAt: index.indexedAt };
}

export async function readMarketplace() {
  try {
    const index = JSON.parse(await fs.readFile(marketIndexFile(), 'utf8'));
    const tooOld = Date.now() - new Date(index.indexedAt).getTime() > CACHE_MAX_AGE_MS;
    // 旧索引（version 1）没有官方来源：让 UI 提示刷新一次，别让用户以为官方插件不存在。
    const stale = tooOld || index.version !== OFFICIAL_MARKET_INDEX_VERSION;
    return { ok: true, stale, count: index.plugins.length, categories: index.categories, indexedAt: index.indexedAt, plugins: index.plugins };
  } catch {
    return { ok: false, error: '市场数据尚未下载，请先点击“刷新市场”。' };
  }
}

// ---------------------------------------------------------------------------
// 插件更新检测（已安装插件 → 来源 → 远端最新 → 是否需要更新）
//
// 与用户确认过的口径：
//   * npm 来源：只跟 registry 的 dist-tags 比；跨大版本会提示但标注。
//   * git 来源（`github:` 依赖、以及我们自己 clone 到 plugin-sources 的 `file:`）：
//     以"远端 package.json 的 version 变高"为准；只有 commit 变了而版本号没变时，
//     附注一句"远端有新提交"，不当作可更新（避免 README/CI 提交造成噪声）。
//   * 本地来源（用户手工放进 node_modules 的目录）与 bundled 插件不检测；
//     broken 的插件沿用现有的"清理/重装"提示。
//   * 预发布不参与：装的是正式版就只跟 latest 比。
// 结果缓存到 profile 下，默认 6 小时内不重复联网。
// ---------------------------------------------------------------------------

/** 克隆到 plugin-sources 时写入的来源标记（用于反推远端与已装 commit）。 */
const SOURCE_MARKER_NAME = '.dsh-source.json';
const UPDATES_CACHE_FILE = () => join(profilesWebDir(), '.plugin-updates.json');
const UPDATES_TTL_MS = 6 * 60 * 60 * 1000;
const PROBE_TIMEOUT_MS = 15000;
const PROBE_CONCURRENCY = 4;

/** 解析版本号：base 数字段 + 预发布标识（npm 语义，和启动器里的实现保持一致）。 */
export function parsePluginVersion(raw) {
  const value = String(raw ?? '').trim().replace(/^v(?=\d)/i, '');
  const withoutBuild = value.split('+')[0];
  const dash = withoutBuild.indexOf('-');
  const basePart = dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild;
  const prePart = dash >= 0 ? withoutBuild.slice(dash + 1) : '';
  const base = basePart.split('.').map(part => (/^\d+$/.test(part) ? Number(part) : 0));
  const pre = prePart ? prePart.split('.').filter(Boolean).map(part => part.toLowerCase()) : null;
  return { base: base.length > 0 ? base : [0], pre: pre && pre.length > 0 ? pre : null };
}

/**
 * 比较两个版本号（npm 语义：同 base 下预发布低于正式版，数字段按数值、字母段按字典序，
 * 前缀相同则标识更多的一方更高）。返回 -1 / 0 / 1。
 */
export function comparePluginVersions(left, right) {
  const a = parsePluginVersion(left);
  const b = parsePluginVersion(right);
  for (let i = 0; i < Math.max(a.base.length, b.base.length); i += 1) {
    const x = a.base[i] ?? 0;
    const y = b.base[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    if (i >= a.pre.length) return -1;
    if (i >= b.pre.length) return 1;
    const x = a.pre[i];
    const y = b.pre[i];
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
      continue;
    }
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** 主版本号，用于标注"跨大版本"。 */
export function pluginMajorVersion(raw) {
  return parsePluginVersion(raw).base[0] ?? 0;
}

/** pnpm-lock.yaml 里 `github:` / git 依赖解析出的 commit（没有就返回 null）。 */
export function parseLockCommit(lockText, spec) {
  const text = String(lockText ?? '');
  if (!text || !spec) return null;
  // 只有 git 形态的 spec 才有 commit；npm spec（`^1.2.3`）在 lock 里的下一条依赖
  // 可能正好是 git 依赖，窗口扫下去会取到别人的 sha。
  if (!/^(?:github:|git\+|git@|https?:)/i.test(spec)) return null;
  let index = text.indexOf(`specifier: ${spec}`);
  while (index >= 0) {
    const window = text.slice(index, index + 400);
    const tarball = window.match(/tar\.gz\/([0-9a-f]{40})/i);
    if (tarball) return tarball[1].toLowerCase();
    const resolution = window.match(/commit:\s*([0-9a-f]{40})/i);
    if (resolution) return resolution[1].toLowerCase();
    index = text.indexOf(`specifier: ${spec}`, index + 1);
  }
  return null;
}

/**
 * 把一个已安装插件归到某个来源。
 * @param {{name:string,spec:string|null,installedVersion:string|null,installedCommit?:string|null,marker?:object|null,marketNames?:Set<string>}} input
 * @returns {{name:string,spec:string|null,kind:'npm'|'git'|'local',remote:object|null,installedVersion:string|null,installedCommit:string|null}}
 */
export function classifyPluginSource(input) {
  const name = String(input?.name ?? '');
  const spec = typeof input?.spec === 'string' ? input.spec : null;
  const installedVersion = input?.installedVersion ?? null;
  const base = { name, spec, installedVersion, installedCommit: input?.installedCommit ?? null, remote: null };

  if (!spec) return { ...base, kind: 'npm', remote: { type: 'npm', package: name } };

  const fileMatch = spec.match(/^(?:file|link):(.+)$/);
  if (fileMatch) {
    const raw = fileMatch[1];
    const dir = raw.startsWith('/') ? raw : join(profilesWebDir(), raw);
    const marker = input?.marker;
    if (marker?.author && marker?.repo) {
      return {
        ...base,
        installedCommit: marker.commit ?? base.installedCommit,
        kind: 'git',
        remote: {
          type: 'git',
          url: marker.url || `https://github.com/${marker.author}/${marker.repo}.git`,
          author: marker.author,
          repo: marker.repo,
          subdir: marker.subdir ?? null,
          dir
        }
      };
    }
    // 老版本 clone 出来的目录没有标记：只有在市场索引里能确认的候选才敢认（调用方
    // 还会先用 ls-remote 探测并写回标记）；按位置乱猜会把 `tt-a1i/xxx` 拆成
    // `tt/a1i-xxx`，指向一个不存在的仓库。
    const confirmed = sourceCandidates(dir, input?.marketNames)
      .find(candidate => input?.marketNames?.has(`${candidate.author}/${candidate.repo}`.toLowerCase()));
    if (confirmed) {
      return { ...base, kind: 'git', remote: { type: 'git', url: `https://github.com/${confirmed.author}/${confirmed.repo}.git`, ...confirmed, subdir: null, dir } };
    }
    return { ...base, kind: 'local' };
  }

  if (spec.startsWith('github:')) {
    const body = spec.slice('github:'.length);
    const hash = body.indexOf('#');
    const repoPart = (hash >= 0 ? body.slice(0, hash) : body).replace(/\.git$/, '');
    const [author, repo] = repoPart.split('/');
    if (author && repo) {
      return {
        ...base,
        kind: 'git',
        remote: {
          type: 'git',
          url: `https://github.com/${author}/${repo}.git`,
          author,
          repo,
          subdir: hash >= 0 ? body.slice(hash + 1) : null,
          dir: null
        }
      };
    }
  }

  const gitUrl = spec.match(/^(?:git\+)?(?:https?:\/\/|git@)github\.com[:/]([^/]+)\/([^/#]+)(?:\.git)?(?:#(.+))?$/i);
  if (gitUrl) {
    const [, author, repoPart, subdir] = gitUrl;
    // `…/repo.git` 的 `.git` 后缀要先剥掉，否则拼出来的 URL 会变成 `repo.git.git`。
    const repo = repoPart.replace(/\.git$/i, '');
    return {
      ...base,
      kind: 'git',
      remote: { type: 'git', url: `https://github.com/${author}/${repo}.git`, author, repo, subdir: subdir ?? null, dir: null }
    };
  }

  // npm 包名，可能带范围/标签（`^1.2.3`、`latest`、`1.2.3`）——都归到 registry 上的包。
  return { ...base, kind: 'npm', remote: { type: 'npm', package: name } };
}

/**
 * 从 plugin-sources 的 `<author>-<repo>` 目录名列出可能的远端候选，按可信度排序：
 * 市场索引里能查到的排前面，其余按 `-` 的切分顺序（`cloneToSources` 的命名规则是
 * `${author}-${repo}`，但 author 本身也可能含 `-`，所以只能给候选、由调用方探测确认）。
 * @returns {Array<{author:string,repo:string}>}
 */
export function sourceCandidates(dir, marketNames) {
  const base = String(dir ?? '').split('/').filter(Boolean).pop() ?? '';
  if (!base) return [];
  const parts = base.split('-');
  const matches = [];
  const rest = [];
  for (let i = 1; i < parts.length; i += 1) {
    const author = parts.slice(0, i).join('-');
    const repo = parts.slice(i).join('-');
    if (!author || !repo) continue;
    const entry = { author, repo };
    if (marketNames?.has(`${author}/${repo}`.toLowerCase())) matches.push(entry);
    else rest.push(entry);
  }
  return [...matches, ...rest];
}

/**
 * 从插件自己的 package.json 读真实上游：很多插件是"大仓库的子目录"（例如
 * `@tt-a1i/archify-dsh` 来自 `tt-a1i/archify` 的 `integrations/deepseek-harness`），
 * 靠 plugin-sources 的目录名根本推不出来，而 `repository.url` + `repository.directory`
 * 是权威信息。
 */
export async function readRepositoryHint(dir) {
  const pkg = await readJsonQuiet(join(dir, 'package.json'));
  const repository = pkg?.repository;
  const url = typeof repository === 'string' ? repository : repository?.url;
  const subdir = repository && typeof repository === 'object' && typeof repository.directory === 'string'
    ? repository.directory
    : null;
  const match = typeof url === 'string' ? url.match(/github\.com[:/]([^/]+)\/([^/#]+?)(?:\.git)?(?:#.*)?$/i) : null;
  if (!match) return null;
  return { author: match[1], repo: match[2], subdir };
}

/**
 * 没有来源标记的目录（本次改动之前装的）：按权威度依次探测候选，命中后把标记写回
 * 目录——之后检测就是精确的，也能拿到准确的 commit。
 * 顺序：package.json 的 repository → 市场索引确认的目录名 → 目录名切分候选。
 */
export async function discoverSourceMarker(dir, marketNames, probe) {
  const head = probe ?? (async url => {
    try {
      const { stdout } = await run('git', ['ls-remote', url, 'HEAD'], {
        timeout: 8000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/true' }
      });
      const sha = String(stdout).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    } catch { return null; }
  });
  const candidates = [];
  const hint = await readRepositoryHint(dir).catch(() => null);
  if (hint) candidates.push(hint);
  for (const candidate of sourceCandidates(dir, marketNames)) {
    if (!candidates.some(item => item.author === candidate.author && item.repo === candidate.repo)) candidates.push(candidate);
  }
  for (const candidate of candidates) {
    const url = `https://github.com/${candidate.author}/${candidate.repo}.git`;
    // eslint-disable-next-line no-await-in-loop -- 逐个确认，命中即停
    const commit = await head(url);
    if (!commit) continue;
    const marker = {
      author: candidate.author,
      repo: candidate.repo,
      subdir: candidate.subdir ?? null,
      url,
      commit,
      discoveredAt: new Date().toISOString()
    };
    await fs.writeFile(join(dir, SOURCE_MARKER_NAME), JSON.stringify(marker, null, 2), 'utf8').catch(() => {});
    return marker;
  }
  return null;
}

/**
 * 判定一个插件要不要更新。远端探测结果 `remote` 形如
 * `{version, commit, tags?}`，探测失败时给 `{error}`。
 * @returns {{status:'update-available'|'up-to-date'|'ahead'|'unknown'|'failed',latestVersion:string|null,channel:string|null,major:boolean,note:string|null,error:string|null}}
 */
export function decidePluginUpdate({ kind, installedVersion, installedCommit, remote }) {
  const unknown = (note, status = 'unknown') => ({ status, latestVersion: null, channel: null, major: false, note, error: null });
  // 本地来源先判定：它本来就没有远端，报"检测失败"会让用户以为出错了。
  if (kind === 'local') return unknown('未识别到可检测的远端来源（本地插件或私有仓库）');
  // git 远端不可达（私有仓库 / 已删除 / 改名）：判定不了，但也不该报成"检测失败"，
  // 面板上写清楚原因即可，技术细节留在 error 里供日志排查。
  if (remote?.unreachable) {
    return { status: 'unknown', latestVersion: null, channel: null, major: false, note: '无法访问远端仓库（可能是私有仓库或已删除）', error: String(remote.error) };
  }
  if (remote?.error) return { status: 'failed', latestVersion: null, channel: null, major: false, note: null, error: String(remote.error) };
  if (!remote?.version) return unknown('远端没有可用的版本号');
  const latestVersion = String(remote.version);
  const channel = typeof remote.channel === 'string' ? remote.channel : null;
  if (!installedVersion) {
    return { status: 'update-available', latestVersion, channel, major: false, note: '无法读取已安装版本', error: null };
  }
  const order = comparePluginVersions(installedVersion, latestVersion);
  if (order > 0) return { status: 'ahead', latestVersion, channel, major: false, note: '已安装版本比远端更高', error: null };
  // 预发布不参与：装的是正式版时，远端只有 rc/beta/alpha 就保持安静（用户确认的口径）。
  const installedIsPrerelease = parsePluginVersion(installedVersion).pre !== null;
  const latestIsPrerelease = parsePluginVersion(latestVersion).pre !== null;
  if (latestIsPrerelease && !installedIsPrerelease) {
    return { status: 'up-to-date', latestVersion, channel, major: false, note: `远端只有预发布版本 v${latestVersion}，暂不提示`, error: null };
  }
  const commitDiffers = Boolean(remote.commit && installedCommit && String(remote.commit).toLowerCase() !== String(installedCommit).toLowerCase());
  if (order === 0) {
    return { status: 'up-to-date', latestVersion, channel, major: false, note: commitDiffers ? '远端有新提交（版本号未变）' : null, error: null };
  }
  return {
    status: 'update-available',
    latestVersion,
    channel,
    major: pluginMajorVersion(installedVersion) !== pluginMajorVersion(latestVersion),
    note: commitDiffers ? '远端同时有新提交' : null,
    error: null
  };
}

/** 汇总面板/菜单要用的计数。已忽略的更新单独计数，不进 updateAvailable（角标/菜单据此归零）。 */
export function summarizeUpdateInventory(inventory) {
  const items = Array.isArray(inventory) ? inventory : [];
  const available = items.filter(item => item?.status === 'update-available');
  return {
    total: items.length,
    updateAvailable: available.filter(item => !item.ignored).length,
    ignored: available.filter(item => item.ignored).length,
    failed: items.filter(item => item?.status === 'failed').length,
    unknown: items.filter(item => item?.status === 'unknown').length
  };
}

// ---------------------------------------------------------------------------
// 「忽略这个版本」：用户不想被某个插件的某个版本反复提醒时的出口。
//
// 只忽略**一个版本**（name + latestVersion 精确匹配）：远端出了更高的版本就重新提醒，
// 所以忽略不会让插件永远停在旧版本上。记录写在 profile 下的
// `.plugin-updates-ignored.json`；检测缓存本身保持原样——忽略只在"读的时候打标"，
// 取消忽略立刻恢复显示，不需要再联网重测一轮（清理缓存会让角标先闪一下）。
// ---------------------------------------------------------------------------

const IGNORED_UPDATES_FILE = () => join(profilesWebDir(), '.plugin-updates-ignored.json');

/**
 * 已忽略的更新记录：`{ "<name>": { version, at } }`。
 * 手工改坏 / 半截写入都会被过滤掉（读不出 version 的记录直接丢），不能让它变成新的故障源。
 * @param {{file?:string}} [options] 单测可指定文件，避免写到真实 profile。
 */
export async function readIgnoredUpdates(options = {}) {
  const raw = await readJsonQuiet(options.file ?? IGNORED_UPDATES_FILE());
  const out = {};
  for (const [name, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!name) continue;
    if (typeof value === 'string') {
      if (value) out[name] = { version: value, at: null };
      continue;
    }
    if (value && typeof value === 'object' && typeof value.version === 'string' && value.version) {
      out[name] = { version: value.version, at: typeof value.at === 'string' ? value.at : null };
    }
  }
  return out;
}

async function writeIgnoredUpdates(value, file) {
  await writeTextAtomic(file ?? IGNORED_UPDATES_FILE(), JSON.stringify(value, null, 2));
}

/** 这条检测结果是否被用户忽略：只有 name 与目的版本（latestVersion）都对齐才算。 */
export function isUpdateIgnored(entry, ignored) {
  if (!entry || entry.status !== 'update-available' || !entry.name || !entry.latestVersion) return false;
  const record = ignored?.[entry.name];
  return Boolean(record?.version) && String(record.version) === String(entry.latestVersion);
}

/** 给检测结果打上 `ignored` 标记（汇总、角标、面板、启动器菜单都读这一个字段）。 */
export function applyIgnoredUpdates(inventory, ignored) {
  return (Array.isArray(inventory) ? inventory : [])
    .map(entry => (isUpdateIgnored(entry, ignored) ? { ...entry, ignored: true } : entry));
}

/** 缓存里这个插件当前的目的版本：客户端没带版本号时靠它兜住，免得忽略变成一次静默空操作。 */
async function cachedLatestVersion(name, options = {}) {
  const cached = await readUpdateCache(options);
  const entry = (cached?.inventory ?? []).find(item => item.name === name);
  return entry?.latestVersion ?? null;
}

/**
 * 记录「忽略这些插件的这些版本」。
 * @param {Array<{name:string,version?:string|null}>} entries
 * @returns {Promise<{ok:boolean,ignored?:string[],failed?:string[],error?:string}>}
 */
export async function ignorePluginUpdates(entries, options = {}) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter(item => item && typeof item.name === 'string' && item.name);
  if (list.length === 0) return { ok: false, error: '缺少要忽略的插件' };
  const ignored = await readIgnoredUpdates(options);
  const at = new Date().toISOString();
  const done = [];
  const failed = [];
  for (const item of list) {
    const version = item.version ? String(item.version) : await cachedLatestVersion(item.name, options);
    if (!version) { failed.push(item.name); continue; }
    ignored[item.name] = { version, at };
    done.push(item.name);
  }
  if (done.length > 0) await writeIgnoredUpdates(ignored, options.file);
  return { ok: failed.length === 0, ignored: done, failed };
}

/** 取消忽略：记录不存在也算成功，界面不必区分"本来就忽略着"和"这次才取消"。 */
export async function unignorePluginUpdates(names, options = {}) {
  const list = (Array.isArray(names) ? names : [names]).filter(name => typeof name === 'string' && name);
  if (list.length === 0) return { ok: false, error: '缺少要取消忽略的插件' };
  const ignored = await readIgnoredUpdates(options);
  for (const name of list) delete ignored[name];
  await writeIgnoredUpdates(ignored, options.file);
  return { ok: true, unignored: list };
}

/** 并发上限内跑完一批探测，保证单个插件卡住不会拖死整轮检测。 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index).catch(error => ({ error: String(error?.message || error) }));
    }
  });
  await Promise.all(runners);
  return results;
}

async function readJsonQuiet(path) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return null; }
}

/**
 * 读缓存并**校验**：只保留结构完整的条目（name + status）。探测异常、手工改坏、
 * 半截写入都可能留下畸形条目，而面板与启动器都直接消费这份数据——历史上一条
 * `{error}` 就能让调用方读到 undefined。整份没有可用条目就当作"没有缓存"。
 * @param {{cacheFile?:string}} [options] 单测可指定文件，避免写到真实 profile。
 */
export async function readUpdateCache(options = {}) {
  const cached = await readJsonQuiet(options.cacheFile ?? UPDATES_CACHE_FILE());
  if (!cached || !Array.isArray(cached.inventory)) return null;
  const inventory = cached.inventory.filter(item => item && typeof item.name === 'string' && item.name && typeof item.status === 'string' && item.status);
  if (inventory.length === 0) return null;
  const checkedAt = typeof cached.checkedAt === 'string' && !Number.isNaN(Date.parse(cached.checkedAt)) ? cached.checkedAt : null;
  return { ...cached, checkedAt, inventory };
}

/** 写缓存（同样过滤畸形条目，避免把坏数据落盘后又被读回来）。 */
export async function writeUpdateCache(value, cacheFile) {
  const inventory = (Array.isArray(value?.inventory) ? value.inventory : [])
    .filter(item => item && typeof item.name === 'string' && item.name && typeof item.status === 'string' && item.status);
  const target = cacheFile ?? UPDATES_CACHE_FILE();
  await writeTextAtomic(target, JSON.stringify({ ...value, inventory }, null, 2));
}

/** npm 包的 dist-tags（走 pnpm shim，和安装链路同一个 registry/网络栈）。 */
export async function probeNpmDistTags(packageName, timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    await ensurePnpmPath();
    const cli = join(dshHome(), 'pnpm-bin', 'pnpm');
    const { stdout } = await run(cli, ['view', packageName, 'dist-tags', '--json'], { timeout: timeoutMs });
    const tags = JSON.parse(stdout);
    const latest = typeof tags?.latest === 'string' ? tags.latest : null;
    if (!latest) return { error: 'registry 没有 latest 标签' };
    return { version: latest, channel: 'latest', tags };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}

/** git 远端 HEAD：ls-remote 不需要 token，也不受 GitHub API 匿名限流影响。 */
export async function probeGitHead(remote, timeoutMs = PROBE_TIMEOUT_MS) {
  const url = remote?.url;
  if (!url) return { error: '缺少远端地址' };
  try {
    // GIT_TERMINAL_PROMPT=0：私有或不存在的仓库会要求输入用户名，关掉交互让它在
    // 超时前就失败（否则检测会卡在这里）。
    const { stdout } = await run('git', ['ls-remote', url, 'HEAD'], {
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/true' }
    });
    const sha = String(stdout).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!/^[0-9a-f]{40}$/.test(sha)) return { error: '无法解析远端 HEAD' };
    const version = await fetchRemotePackageVersion(remote, sha, timeoutMs);
    if (version.error) return { commit: sha, error: version.error };
    return { version: version.version, commit: sha, channel: null };
  } catch (error) {
    return { error: String(error?.message || error), unreachable: true };
  }
}

/**
 * 一次 GET + JSON 解析，带超时。`decode` 用于把 API 的包装响应还原成实际文档。
 * 超时/网络错误一律转成 error 字段（调用方据此决定要不要走兜底）。
 */
async function readRemoteJSON(url, timeoutMs, doFetch, decode = payload => payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } });
    if (!response.ok) return { error: `远端 package.json HTTP ${response.status}` };
    const value = decode(await response.json());
    if (!value) return { error: '远端 package.json 无法解析' };
    return { value };
  } catch (error) {
    const message = error?.name === 'AbortError' || /aborted/i.test(String(error?.message ?? ''))
      ? `拉取远端 package.json 超时（${Math.round(timeoutMs / 1000)} 秒）`
      : String(error?.message || error);
    return { error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** api.github.com 的 contents 响应（base64）还原成文档。 */
function decodeAPIContent(payload) {
  if (!payload || payload.encoding !== 'base64' || typeof payload.content !== 'string') return null;
  try { return JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')); } catch { return null; }
}

/**
 * 读 GitHub 仓库某次提交里的一个 JSON 文件（默认 package.json）。
 *
 * 先走 raw.githubusercontent（不需要 token）；**实测国内网络对 raw 限速严重：
 * 14～60 秒且会中途断流**，15 秒超时正好卡在边缘——于是 git 来源的插件检测永远显示
 * 「失败」（点更新还会被回一句「没有检测到可更新的版本」），更新前的 peer 门禁也静默
 * 拿不到目标版本的声明。这一步失败时改用 api.github.com 兜一次：同一台机器上它
 * 0.75 秒就回。只在 raw 失败时才走 API——检测最多 6 小时一轮、git 插件数量有限，
 * 匿名限流（60/小时）够用，常规路径仍然不碰 API。
 * @param spec - `{ author, repo, subdir, commit, file }`。
 * @param deps - 测试注入：`{ fetch }` 替换网络调用。
 * @returns `{ value }`（解析后的文档）或 `{ error }`（raw 那一步的原因更好对号）。
 */
async function fetchRepoJSON(spec, timeoutMs = PROBE_TIMEOUT_MS, deps = {}) {
  const { author, repo, subdir, commit, file = 'package.json' } = spec ?? {};
  if (!author || !repo) return { error: '缺少仓库信息' };
  const path = subdir ? `${String(subdir).replace(/^\/+|\/+$/g, '')}/${file}` : file;
  const doFetch = deps.fetch ?? fetch;
  const raw = await readRemoteJSON(`https://raw.githubusercontent.com/${author}/${repo}/${commit}/${path}`, timeoutMs, doFetch);
  if (!raw.error) return raw;
  const viaAPI = await readRemoteJSON(
    `https://api.github.com/repos/${author}/${repo}/contents/${path}?ref=${commit}`, timeoutMs, doFetch, decodeAPIContent
  );
  return viaAPI.error ? raw : viaAPI;
}

/** 远端 package.json 的 version（git 来源的更新检测用）。 */
export async function fetchRemotePackageVersion(remote, commit, timeoutMs = PROBE_TIMEOUT_MS, deps = {}) {
  const result = await fetchRepoJSON({ ...(remote ?? {}), commit }, timeoutMs, deps);
  if (result.error) return { error: result.error };
  const version = result.value?.version;
  return typeof version === 'string' && version ? { version } : { error: '远端 package.json 没有 version' };
}

/** profile 里所有可检测插件的来源清单（bundled / broken 不参与）。 */
export async function collectPluginSources() {
  const installed = await listInstalledPlugins();
  const manifest = await readProfileManifest();
  const dependencies = manifest?.dependencies ?? {};
  const lockText = await fs.readFile(join(profilesWebDir(), 'pnpm-lock.yaml'), 'utf8').catch(() => '');
  const market = await readJsonQuiet(marketIndexFile());
  const marketNames = new Set((market?.plugins ?? [])
    .map(entry => (entry?.author && entry?.repo ? `${entry.author}/${entry.repo}` : null))
    .filter(Boolean)
    .map(value => value.toLowerCase()));

  const sources = [];
  for (const item of installed) {
    if (item.broken || item.source === 'bundled') continue;
    const spec = Object.prototype.hasOwnProperty.call(dependencies, item.name) ? dependencies[item.name] : null;
    const markerDir = typeof spec === 'string' && /^(?:file|link):/.test(spec)
      ? (spec.replace(/^(?:file|link):/, '').startsWith('/')
        ? spec.replace(/^(?:file|link):/, '')
        : join(profilesWebDir(), spec.replace(/^(?:file|link):/, '')))
      : null;
    let marker = markerDir ? await readJsonQuiet(join(markerDir, SOURCE_MARKER_NAME)) : null;
    if (!marker && markerDir) {
      // 老克隆（本次改动之前装的）：探测确认远端并写回标记，之后检测就是精确的。
      marker = await discoverSourceMarker(markerDir, marketNames).catch(() => null);
    }
    const installedCommit = spec ? parseLockCommit(lockText, spec) : null;
    sources.push(classifyPluginSource({
      name: item.name,
      spec,
      installedVersion: item.version,
      installedCommit,
      marker,
      marketNames
    }));
  }
  return sources;
}

/** 真正跑一轮检测（联网）。 */
export async function runUpdateCheck(sources, probe = {}) {
  const npmProbe = probe.npm ?? probeNpmDistTags;
  const gitProbe = probe.git ?? probeGitHead;
  const entries = await mapWithConcurrency(sources, PROBE_CONCURRENCY, async source => {
    let remote;
    try {
      remote = source.remote?.type === 'npm'
        ? await npmProbe(source.remote.package)
        : source.remote?.type === 'git'
          ? await gitProbe(source.remote)
          : { error: '没有远端来源' };
    } catch (error) {
      // 探测函数抛错（网络栈直接抛、注入的假 probe 抛）也要落到 decidePluginUpdate，
      // 否则这条没有 status，汇总里既不计 failed 也不计 unknown。
      remote = { error: String(error?.message || error) };
    }
    return {
      name: source.name,
      kind: source.kind,
      spec: source.spec,
      installedVersion: source.installedVersion,
      installedCommit: source.installedCommit,
      remote,
      ...decidePluginUpdate({
        kind: source.kind,
        installedVersion: source.installedVersion,
        installedCommit: source.installedCommit,
        remote
      })
    };
  });
  return entries;
}

let updateCheckInFlight = null;

// 更新进度：面板与启动器的进度窗口都读它（启动器轮询 /updates 时带上）。
let updateProgress = null;

function beginUpdateProgress(kind, names) {
  updateProgress = {
    active: true,
    kind,
    total: names.length,
    done: 0,
    current: null,
    step: '正在准备…',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    results: []
  };
  return updateProgress;
}

function stepUpdateProgress(current, step) {
  if (!updateProgress) return;
  updateProgress.current = current;
  updateProgress.step = step;
}

function recordUpdateProgress(result) {
  if (!updateProgress) return;
  updateProgress.done += 1;
  updateProgress.results.push(result);
}

function finishUpdateProgress() {
  if (!updateProgress) return;
  updateProgress.active = false;
  updateProgress.current = null;
  updateProgress.finishedAt = new Date().toISOString();
  updateProgress.step = '已完成';
}

/**
 * 更新成功后**修补**检测缓存里对应的条目，而不是删掉整份缓存。
 *
 * 以前这里删缓存，下一次 GET /updates 立刻返回空 inventory：面板上其它插件的
 * 「可更新」胶囊凭空消失、角标归零、按钮因为 count=0 全部变灰（用户实测：更新
 * 一个插件后剩下的更新都不见了，手动刷新才回来，回来按钮还是灰的）。其它插件的
 * 已装版本没变，缓存里它们的结论仍然有效，只需要把刚更新的那几条改成「已是最新」。
 * @param {{name:string,ok?:boolean,updatedTo?:string|null}[]} results
 * @returns {Promise<boolean>} 是否真的修补了缓存
 */
export async function patchUpdateCacheAfterUpdate(results, cacheFile) {
  const target = cacheFile ?? UPDATES_CACHE_FILE();
  const done = new Map((results || [])
    .filter(result => result && result.ok !== false && result.name)
    .map(result => [result.name, result.updatedTo || null]));
  if (done.size === 0) return false;
  const cached = await readJsonQuiet(target);
  const inventory = Array.isArray(cached?.inventory) ? cached.inventory : null;
  if (!inventory) return false;
  let changed = false;
  const next = inventory.map(entry => {
    if (!entry || !done.has(entry.name)) return entry;
    const version = done.get(entry.name) || entry.latestVersion || entry.installedVersion || null;
    changed = true;
    return {
      ...entry,
      status: 'up-to-date',
      installedVersion: version,
      latestVersion: version,
      major: false,
      note: null,
      error: null
    };
  });
  if (!changed) return false;
  await writeUpdateCache({ ...cached, inventory: next }, target);
  return true;
}

/** 当前更新进度（没有进行中的更新时是 null）。 */
export function readUpdateProgress() {
  return updateProgress;
}


/**
 * 缓存优先的检测入口（面板与启动器都走这里）。
 * - 缓存新鲜（< 6h）且未 force → 直接返回缓存，不联网；
 * - 否则返回当前缓存（可能为空）并**在后台**刷新，`refreshing: true` 表示还在跑。
 * 返回的 inventory 已经按「已忽略」打过标：缓存文件存的是原始检测结论，忽略是读时
 * 叠加的，所以取消忽略不需要联网重测。
 */
export async function checkPluginUpdates({ force = false, probe = {}, cacheFile, ignoredFile } = {}) {
  const cached = await readUpdateCache({ cacheFile });
  const fresh = cached && Date.now() - Date.parse(cached.checkedAt ?? 0) < UPDATES_TTL_MS;
  const needsRefresh = force || !fresh;

  if (needsRefresh && !updateCheckInFlight) {
    updateCheckInFlight = (async () => {
      try {
        const sources = await collectPluginSources();
        const inventory = await runUpdateCheck(sources, probe);
        const payload = { checkedAt: new Date().toISOString(), inventory };
        await writeUpdateCache(payload, cacheFile);
        return payload;
      } finally {
        updateCheckInFlight = null;
      }
    })().catch(() => null);
  }

  // 永不阻塞 HTTP 响应：首次检测也要几秒，而客户端（启动器只等 2 秒）会先断开，
  // 服务端再往已关闭的 socket 写响应会抛异常。统一"立刻返回当前缓存 + refreshing"，
  // 由调用方轮询。
  const current = cached ?? { checkedAt: null, inventory: [] };
  const inventory = applyIgnoredUpdates(current.inventory, await readIgnoredUpdates({ file: ignoredFile }));
  return {
    ...current,
    inventory,
    summary: summarizeUpdateInventory(inventory),
    refreshing: Boolean(needsRefresh && updateCheckInFlight),
    progress: updateProgress,
    lastBatch: lastBatchUpdate
  };
}

// ---------------------------------------------------------------------------
// 「这个版本改了什么」：从 GitHub Releases 或仓库里的 CHANGELOG 摘出目标版本的段落。
// 插件更新前最想知道的就是这个；上游多半有 release notes，没有就用 changelog 兜底，
// 都没有就如实说没有（并给出仓库链接让用户自己看）。
// ---------------------------------------------------------------------------

const RELEASE_NOTES_TTL_MS = 30 * 60 * 1000;
const RELEASE_NOTES_MAX_CHARS = 20000;
const RELEASE_NOTES_FILES = ['CHANGELOG.zh.md', 'CHANGELOG.md', 'CHANGES.md', 'RELEASES.md', 'HISTORY.md'];
const RELEASE_NOTES_REFS = ['main', 'master'];
const releaseNotesCache = new Map();

/** 从 package.json 的 repository/homepage 字段认出 GitHub owner/repo。 */
export function githubRepoFromUrl(value) {
  const raw = typeof value === 'string' ? value : value?.url;
  if (!raw) return null;
  const match = String(raw).match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i);
  if (!match) return null;
  return { author: match[1], repo: match[2].replace(/\.git$/i, '') };
}

/**
 * 从 CHANGELOG 文本里摘出版本段落：找标题里带这个版本号的 heading，取到下一个
 * 同级或更高级 heading 为止。找不到返回 null。
 */
export function extractChangelogSection(text, version) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const wanted = String(version ?? '').trim().replace(/^v/i, '');
  if (!wanted) return null;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const needle = new RegExp(`(^|[^0-9A-Za-z.])v?${escaped}([^0-9A-Za-z.]|$)`);
  const heading = /^(#{1,6})\s+(.*)$/;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = heading.exec(lines[i]);
    if (!match) continue;
    if (needle.test(match[2])) { start = i; level = match[1].length; break; }
  }
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = heading.exec(lines[i]);
    if (match && match[1].length <= level) break;
    body.push(lines[i]);
  }
  const section = body.join('\n').replace(/\n\s*-{3,}\s*$/g, '').trim();
  return section || null;
}

/** 读远端文本文件：raw 优先，被墙/超大时走 GitHub contents API（base64）。 */
async function readRemoteText(author, repo, ref, path, timeoutMs, doFetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const raw = await doFetch(`https://raw.githubusercontent.com/${author}/${repo}/${ref}/${path}`, {
      signal: controller.signal, headers: { 'cache-control': 'no-cache' }
    });
    if (raw.ok) return { text: await raw.text() };
    const api = await doFetch(`https://api.github.com/repos/${author}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, {
      signal: controller.signal, headers: { 'cache-control': 'no-cache' }
    });
    if (!api.ok) return { error: `HTTP ${api.status}` };
    const value = await api.json();
    const encoded = typeof value?.content === 'string' ? value.content.replace(/\s+/g, '') : '';
    if (!encoded) return { error: '远端文件内容为空' };
    return { text: Buffer.from(encoded, 'base64').toString('utf8') };
  } catch (error) {
    return { error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchReleaseFromGitHub(repoRef, version, doFetch) {
  const tags = [`v${version}`, String(version)];
  for (const tag of tags) {
    const url = `https://api.github.com/repos/${repoRef.author}/${repoRef.repo}/releases/tags/${encodeURIComponent(tag)}`;
    const result = await readRemoteJSON(url, PROBE_TIMEOUT_MS, doFetch);
    if (result.error) continue;
    const release = result.value;
    const notes = typeof release?.body === 'string' ? release.body.trim() : '';
    if (!notes) continue;
    return {
      ok: true,
      kind: 'release',
      version: String(version),
      title: typeof release?.name === 'string' && release.name.trim() ? release.name.trim() : `v${version}`,
      notes: notes.slice(0, RELEASE_NOTES_MAX_CHARS),
      url: typeof release?.html_url === 'string' ? release.html_url : `https://github.com/${repoRef.author}/${repoRef.repo}/releases`
    };
  }
  return null;
}

async function fetchChangelogSection(repoRef, version, refs, doFetch) {
  for (const ref of refs) {
    for (const file of RELEASE_NOTES_FILES) {
      const result = await readRemoteText(repoRef.author, repoRef.repo, ref, file, PROBE_TIMEOUT_MS, doFetch);
      if (result.error) continue;
      const section = extractChangelogSection(result.text, version);
      if (!section) continue;
      return {
        ok: true,
        kind: 'changelog',
        version: String(version),
        title: `${file} · v${version}`,
        notes: section.slice(0, RELEASE_NOTES_MAX_CHARS),
        url: `https://github.com/${repoRef.author}/${repoRef.repo}/blob/${ref}/${file}`
      };
    }
  }
  return null;
}

/**
 * 查一个已安装插件某个版本的更新说明。
 * @param {string} name - 包名。
 * @param {string} version - 目标版本。
 * @returns {Promise<{ok:boolean,kind?:string,version?:string,title?:string,notes?:string,url?:string,error?:string}>}
 */
export async function fetchPluginReleaseNotes(name, version, deps = {}) {
  const safeName = String(name ?? '').trim();
  const safeVersion = String(version ?? '').trim().replace(/^v/i, '');
  if (!safeName || !safeVersion) return { ok: false, error: '缺少插件名或版本号' };
  const cacheKey = `${safeName}@${safeVersion}`;
  const hit = releaseNotesCache.get(cacheKey);
  if (hit && Date.now() - hit.at < RELEASE_NOTES_TTL_MS) return hit.value;

  const doFetch = deps.fetch ?? fetch;
  const sources = await collectPluginSources().catch(() => []);
  const source = sources.find(item => item.name === safeName) ?? null;
  const remote = source?.remote ?? {};
  let repoRef = remote.type === 'git' && remote.author && remote.repo
    ? { author: remote.author, repo: remote.repo }
    : null;
  if (!repoRef) {
    // npm 来源：装好的包 package.json 里通常有 repository 字段。
    const meta = await readJsonQuiet(join(profilesWebModules(), ...safeName.split('/'), 'package.json'));
    repoRef = githubRepoFromUrl(meta?.repository) ?? githubRepoFromUrl(meta?.homepage);
  }
  if (!repoRef) {
    const value = { ok: false, error: '这个插件的来源里没有 GitHub 仓库信息，看不到发布说明' };
    releaseNotesCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  let value = await fetchReleaseFromGitHub(repoRef, safeVersion, doFetch).catch(() => null);
  if (!value) {
    const refs = [source?.installedCommit, ...RELEASE_NOTES_REFS].filter(item => typeof item === 'string' && item);
    value = await fetchChangelogSection(repoRef, safeVersion, [...new Set(refs)], doFetch).catch(() => null);
  }
  if (!value) {
    value = {
      ok: false,
      error: '上游没有发布说明（没有对应的 GitHub Release，也没在 CHANGELOG 里找到这个版本）',
      url: `https://github.com/${repoRef.author}/${repoRef.repo}`
    };
  }
  releaseNotesCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

function json(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

/**
 * 批量更新在跑时，其它会写 profile 的操作（安装/卸载/清理/单条更新）一律拒绝：
 * 它们和更新都会调用 pnpm 改同一个 profile，并发会互相踩出坏状态。
 * @returns {boolean} 已经回了 409 就返回 true，调用方直接收尾。
 */
function rejectWhileBatchRunning(response) {
  if (!isBatchUpdateRunning()) return false;
  json(response, 409, { error: '批量更新进行中，请等它结束后再试' });
  return true;
}

async function body(request) {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/**
 * 忽略请求体归一成 `[{name, version}]`，三种写法都认：
 * 单条 `{name, version}`、批量 `{items:[{name, version}]}`、只给名字 `{names:[…]}`
 * （缺版本号时服务端从检测缓存里补，避免忽略变成一次静默空操作）。
 */
export function ignoreEntriesFromBody(value) {
  const entries = [];
  const push = (name, version) => {
    if (typeof name === 'string' && name) entries.push({ name, version: version ? String(version) : null });
  };
  for (const item of Array.isArray(value?.items) ? value.items : []) push(item?.name, item?.version);
  push(value?.name, value?.version);
  for (const name of Array.isArray(value?.names) ? value.names : []) push(name, null);
  return entries;
}

export const name = 'dsh-plugin-manager';
export function apply(ctx) {
  ctx.inject(['webServer'], host => {
    host.effect(() => {
      const disposers = [
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/installed', handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          try { json(res, 200, { items: await listInstalledPlugins() }); } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/marketplace', handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          try { json(res, 200, await readMarketplace()); } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/refresh', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try { json(res, 200, await refreshMarketplace()); } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/install', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          if (rejectWhileBatchRunning(res)) return;
          try {
            const value = await body(req);
            if (!value || (!value.url && !value.name)) { json(res, 400, { error: '缺少插件标识' }); return; }
            json(res, 200, await installPlugin({ url: value.url, name: value.name }));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
                host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/uninstall', handler: async (req, res) => {
                if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
                if (rejectWhileBatchRunning(res)) return;
                try {
                  const value = await body(req);
                  if (!value?.name) { json(res, 400, { error: '缺少插件名' }); return; }
                  json(res, 200, await uninstallPlugin(value.name));
                } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
              }}),
                host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/update', handler: async (req, res) => {
                if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
                try {
                  const value = await body(req);
                  if (!value?.name) { json(res, 400, { error: '缺少插件名' }); return; }
                  // 批量更新正在跑时不让单条更新插进来：两者都写同一个 profile，并发会互相踩。
                  if (rejectWhileBatchRunning(res)) return;
                  // dev-linked 插件的显式动作由前端二选一传入（pull-local / switch-release）。
                  const mode = value.mode === 'pull-local' || value.mode === 'switch-release' ? value.mode : undefined;
                  json(res, 200, await updatePlugin(value.name, { mode }));
                } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
              }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/updates', handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          res.on('error', () => {});
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1');
            const payload = await checkPluginUpdates({ force: url.searchParams.get('refresh') === '1' });
            try { json(res, 200, payload); } catch { /* 客户端可能已断开（刷新要几秒） */ }
          } catch (error) { try { json(res, 500, { error: String(error?.message || error) }); } catch { /* 同上 */ } }
        }}),
        // 「这个版本改了什么」：面板行内的「更新内容」入口调它。
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/release-notes', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const name = typeof value?.name === 'string' ? value.name.trim() : '';
            const version = typeof value?.version === 'string' ? value.version.trim() : '';
            if (!name || !version) { json(res, 400, { error: '缺少插件名或版本号' }); return; }
            json(res, 200, await fetchPluginReleaseNotes(name, version));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/ignore', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const entries = ignoreEntriesFromBody(await body(req));
            if (entries.length === 0) { json(res, 400, { error: '缺少要忽略的插件' }); return; }
            json(res, 200, await ignorePluginUpdates(entries));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/unignore', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const names = Array.isArray(value?.names) ? value.names : [value?.name];
            const list = names.filter(name => typeof name === 'string' && name);
            if (list.length === 0) { json(res, 400, { error: '缺少要取消忽略的插件' }); return; }
            json(res, 200, await unignorePluginUpdates(list));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/update-many', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          res.on('error', () => {});
          try {
            const value = await body(req);
            const names = Array.isArray(value?.names) ? value.names.filter(item => typeof item === 'string' && item) : [];
            if (names.length === 0) { json(res, 400, { error: '缺少要更新的插件' }); return; }
            // 两个批次并发会互相覆盖进度、并发写同一个 profile（界面卡在「更新中…」）。
            if (isBatchUpdateRunning()) {
              json(res, 409, { error: '已有批量更新正在进行，请等它结束后再试' });
              return;
            }
            // 批量更新可能跑几分钟：先回已受理，进度由客户端刷新列表/检测结果体现。
            json(res, 202, { ok: true, accepted: names.length, names });
            void updatePlugins(names).catch(() => {});
          } catch (error) { try { json(res, 500, { error: String(error?.message || error) }); } catch { /* 客户端已断开 */ } }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/uninstall-many', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          if (rejectWhileBatchRunning(res)) return;
          try {
            const value = await body(req);
            const names = Array.isArray(value?.names) ? value.names.filter(name => typeof name === 'string' && name) : [];
            if (names.length === 0) { json(res, 400, { error: '缺少要卸载的插件' }); return; }
            json(res, 200, await uninstallPlugins(names));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/cleanup', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          if (rejectWhileBatchRunning(res)) return;
          try {
            const value = await body(req);
            if (!value?.name) { json(res, 400, { error: '缺少插件名' }); return; }
            json(res, 200, await cleanupBrokenPlugin(value.name));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        // 前端在卸载插件后调用：先回 200，再优雅退出 dsh 进程。启动器（DHL）
        // 监听到 dsh 以 exit 0 退出时会自动拉起新进程，侧边栏 slot 随之刷新。
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/restart', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          json(res, 200, { ok: true, restarting: true });
          setTimeout(() => { process.exit(0); }, 150);
        }})
      ];
      return () => disposers.forEach(dispose => dispose());
    }, 'dsh-plugin-manager: routes');
  });
}
