import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

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
    const value = line.slice(colon + 1).trim();
    if (key === 'description') { section = 'description'; continue; }
    if (section === 'description') {
      if (key === 'en' || key === 'zh') out.description[key] = value;
      continue;
    }
    if (key === 'url' || key === 'name' || key === 'category') out[key] = value;
  }
  return out;
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
 * @returns {Promise<Array<{name:string,version:string|null,description:string,source:'bundled'|'user'|'broken',broken?:boolean}>>}
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
      out.push({ name: meta.name, version: meta.version, description: meta.description, source });
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
        out.push({ name: meta.name, version: meta.version, description: meta.description, source: 'bundled' });
      }
    }
  }

  // 3) Broken leftovers: dangling symlinks that do not back a real bundle.
  for (const entry of entries) {
    if (!entry.isLink || seen.has(entry.package)) continue;
    const meta = await readPackageMeta(entry.path);
    if (!meta?.name) {
      seen.add(entry.package);
      out.push({ name: entry.package, version: null, description: '安装不完整或已损坏，可清理后重新安装', source: 'broken', broken: true });
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
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
    await fs.writeFile(workspacePath, `${content.replace(/\n*$/, '')}\ndangerouslyAllowAllBuilds: true\n`, 'utf8');
  } catch {
    await fs.mkdir(profilesWebDir(), { recursive: true });
    await fs.writeFile(workspacePath, 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\ndangerouslyAllowAllBuilds: true\n', 'utf8');
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
  const name = entry.name || '';
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
  try {
    await ensurePnpmPath();
    const cli = join(dshHome(), 'pnpm-bin', 'pnpm');
    await run(cli, ['view', name, 'version'], { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
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
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(src, dest, { recursive: true });
    // 记下来源与 commit：更新检测靠它反推远端、判断"远端是否只是有新提交"。
    const head = await run('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], { timeout: 30000 })
      .then(result => String(result.stdout).trim().toLowerCase())
      .catch(() => null);
    await fs.writeFile(join(dest, SOURCE_MARKER_NAME), JSON.stringify({
      author: ref.author,
      repo: ref.repo,
      subdir: subdir ?? null,
      url: repoUrl,
      commit: /^[0-9a-f]{40}$/.test(head ?? '') ? head : null,
      clonedAt: new Date().toISOString()
    }, null, 2), 'utf8').catch(() => {});
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
 * @param {{author:string,repo:string,subdir:string,full:string}} ref
 * @param {Set<string>} installedNames - lower-cased names already present.
 * @returns {Promise<{ok:boolean,alreadyInstalled?:boolean,installedAs?:string,packageName?:string,note?:string,error?:string}>}
 */
async function installSubdirPlugin(ref, installedNames) {
  const src = await cloneToSources(ref, ref.subdir);
  if (!src.ok) return src;
  if (installedNames.has(src.packageName.toLowerCase())) {
    return { ok: true, alreadyInstalled: true, installedAs: src.packageName, packageName: src.packageName };
  }
  try {
    const result = await pluginCommand(['add', `file:${src.dest}`]);
    return { ok: true, installedAs: `file:${src.dest}`, packageName: src.packageName, note: result.note };
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
export async function installPlugin(entry) {
  const { candidates, repoRef } = installCandidates(entry);
  const installed = await listInstalledPlugins();
  const installedNames = new Set(installed.filter(item => !item.broken).map(item => item.name.toLowerCase()));

  // Subdirectory plugins cannot be addressed by npm name; route them to the
  // sparse-clone installer (which does its own idempotence check).
  if (repoRef?.subdir) {
    return installSubdirPlugin(repoRef, installedNames);
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
    if (!probes[i]) { lastError = `npm 包 ${candidates[i]} 不存在`; continue; }
    try {
      const result = await pluginCommand(['add', candidates[i]]);
      return { ok: true, installedAs: candidates[i], packageName: candidates[i], note: result.note };
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
        const result = await pluginCommand(['add', `file:${src.dest}`]);
        return { ok: true, installedAs: `file:${src.dest}`, packageName: src.packageName, note: result.note };
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

export async function uninstallPlugin(name) {
  const before = await readProfileManifest();
  try {
    const result = await pluginCommand(['remove', name]);
    const removedSources = await cleanupPluginSources(before, [name]);
    const note = removedSources.length > 0 ? `${result.note}；已清理插件源码目录` : result.note;
    return { ok: true, note, removedSources };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/** Uninstall several plugins, reporting the outcome of each. */
export async function uninstallPlugins(names) {
  const results = [];
  for (const name of names) {
    try {
      const result = await uninstallPlugin(name);
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
export async function updatePlugin(name, options = {}) {
  if (typeof name !== 'string' || !/^[@a-zA-Z0-9._/-]+$/.test(name) || name.includes('..')) {
    return { ok: false, error: '非法的插件名' };
  }
  const ownsProgress = options.batch !== true;
  if (ownsProgress) beginUpdateProgress('single', [name]);
  try {
    const sources = await collectPluginSources();
    const source = sources.find(item => item.name === name);
    if (!source) {
      const failure = { ok: false, status: 'unknown', error: '未找到可更新的已安装插件' };
      if (ownsProgress) { recordUpdateProgress({ name, ...failure }); finishUpdateProgress(); }
      return failure;
    }
    const result = await applyPluginUpdate(source, options);
    if (ownsProgress) {
      recordUpdateProgress({ name, ...result });
      finishUpdateProgress();
    }
    return result;
  } catch (error) {
    const failure = { ok: false, error: String(error?.message || error) };
    if (ownsProgress) { recordUpdateProgress({ name, ...failure }); finishUpdateProgress(); }
    return failure;
  }
}

/**
 * 按来源分派更新动作：
 * - npm：`pnpm add <name>@<latest>`（显式指定版本，插件记录里就是新版本号）；
 * - `github:` 依赖：按原 spec 重新解析（pnpm 会拉到默认分支最新 commit）；
 * - plugin-sources 的克隆：先备份成 `.bak-<时间戳>` 再重新 clone 覆盖，失败回滚。
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

  if (source.kind === 'npm') {
    stepUpdateProgress(source.name, `正在下载并安装 v${target}…`);
    await command(['add', `${source.name}@${target}`]);
    stepUpdateProgress(source.name, `正在同步 profile…`);
    return { ok: true, updatedTo: target, restartRequired: true, note: `已更新到 v${target}` };
  }

  if (source.kind === 'git' && remote) {
    if (remote.dir) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const backup = `${remote.dir}.bak-${stamp}`;
      await fs.rm(backup, { recursive: true, force: true }).catch(() => {});
      await fs.rename(remote.dir, backup).catch(() => {});
      try {
        stepUpdateProgress(source.name, '正在重新克隆源码…');
        const cloned = await clone(
          { author: remote.author, repo: remote.repo, subdir: remote.subdir ?? null, full: `${remote.author}/${remote.repo}` },
          remote.subdir ?? null
        );
        if (!cloned.ok) throw new Error(cloned.error || '重新克隆失败');
        stepUpdateProgress(source.name, '正在同步 profile…');
        await command(['add', `file:${cloned.dest}`]);
      } catch (error) {
        await fs.rm(remote.dir, { recursive: true, force: true }).catch(() => {});
        await fs.rename(backup, remote.dir).catch(() => {});
        throw error;
      }
      await pruneSourceBackups(remote.dir);
      return { ok: true, updatedTo: target, restartRequired: true, note: `已更新到 v${target}（旧版本保留为 ${backup.split('/').pop()}）` };
    }
    stepUpdateProgress(source.name, `正在重新解析 ${source.spec ?? `github:${remote.author}/${remote.repo}`}…`);
    await command(['add', source.spec ?? `github:${remote.author}/${remote.repo}`]);
    return { ok: true, updatedTo: target, restartRequired: true, note: `已更新到 v${target}` };
  }

  return { ok: false, error: '该插件来源无法自动更新' };
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
  for (const stale of backups.slice(1)) {
    await fs.rm(join(dir, stale), { recursive: true, force: true }).catch(() => {});
    removed.push(stale);
  }
  return removed;
}

/** 批量更新（面板的「全部更新」）：逐个来，单个失败不影响其它。 */
let lastBatchUpdate = null;

/** 最近一次批量更新的结果（客户端轮询 `/updates` 时读它来汇总提示）。 */
export function readLastBatchUpdate() {
  return lastBatchUpdate;
}

export async function updatePlugins(names, options = {}) {
  const startedAt = new Date().toISOString();
  lastBatchUpdate = { startedAt, finishedAt: null, updated: 0, failed: 0, results: [] };
  beginUpdateProgress('batch', names);
  const results = [];
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop -- 顺序更新避免 pnpm 并发写同一个 profile
    const result = await updatePlugin(name, { ...options, batch: true });
    recordUpdateProgress({ name, ...result });
    results.push({ name, ...result });
  }
  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    updated: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results
  };
  lastBatchUpdate = summary;
  finishUpdateProgress();
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
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
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

/**
 * Rebuild the local marketplace index from awesome-dsh-plugin's data/.
 * @returns {Promise<{count:number,categories:string[],indexedAt:string}>}
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
  const plugins = [];
  for (const file of files) {
    if (!file.endsWith('.yml')) continue;
    const raw = await fs.readFile(join(pluginsDir, file), 'utf8');
    const parsed = parsePluginYml(raw);
    if (!parsed.url) continue;
    const url = parsed.url;
    plugins.push({
      id: file.replace(/\.yml$/, ''),
      url,
      name: parsed.name || url,
      author: (parsed.name || '').split('/')[0] || '',
      repo: (parsed.name || '').split('/')[1] || '',
      category: parsed.category || 'other',
      descriptionEn: parsed.description?.en || '',
      descriptionZh: parsed.description?.zh || '',
      downloads: downloads[url]?.downloads ?? 0,
      stars: stars[url]?.stars ?? 0,
      screenshot: screenshots[url] ?? null,
      addedDate: addedDates[url] ?? null
    });
  }

  const categories = [...new Set(plugins.map(plugin => plugin.category))].sort();
  await fs.mkdir(marketRoot(), { recursive: true });
  const index = { version: 1, indexedAt: new Date().toISOString(), categories, plugins };
  const tmp = `${marketIndexFile()}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(index), 'utf8');
  await fs.rename(tmp, marketIndexFile());
  return { count: plugins.length, categories, indexedAt: index.indexedAt };
}

export async function readMarketplace() {
  try {
    const index = JSON.parse(await fs.readFile(marketIndexFile(), 'utf8'));
    const stale = Date.now() - new Date(index.indexedAt).getTime() > CACHE_MAX_AGE_MS;
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

/** 汇总面板/菜单要用的计数。 */
export function summarizeUpdateInventory(inventory) {
  const items = Array.isArray(inventory) ? inventory : [];
  return {
    total: items.length,
    updateAvailable: items.filter(item => item?.status === 'update-available').length,
    failed: items.filter(item => item?.status === 'failed').length,
    unknown: items.filter(item => item?.status === 'unknown').length
  };
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

export async function readUpdateCache() {
  const cached = await readJsonQuiet(UPDATES_CACHE_FILE());
  if (!cached || !Array.isArray(cached.inventory)) return null;
  return cached;
}

async function writeUpdateCache(value) {
  await fs.mkdir(profilesWebDir(), { recursive: true });
  await fs.writeFile(UPDATES_CACHE_FILE(), JSON.stringify(value, null, 2), 'utf8');
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

/** 远端 package.json 的 version：raw.githubusercontent 一次 GET，无需 API token。 */
export async function fetchRemotePackageVersion(remote, commit, timeoutMs = PROBE_TIMEOUT_MS) {
  const { author, repo, subdir } = remote ?? {};
  if (!author || !repo) return { error: '缺少仓库信息' };
  const path = subdir ? `${subdir.replace(/^\/+|\/+$/g, '')}/package.json` : 'package.json';
  const url = `https://raw.githubusercontent.com/${author}/${repo}/${commit}/${path}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } });
    clearTimeout(timer);
    if (!response.ok) return { error: `远端 package.json HTTP ${response.status}` };
    const pkg = await response.json();
    return typeof pkg?.version === 'string' && pkg.version ? { version: pkg.version } : { error: '远端 package.json 没有 version' };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
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

/** 当前更新进度（没有进行中的更新时是 null）。 */
export function readUpdateProgress() {
  return updateProgress;
}


/**
 * 缓存优先的检测入口（面板与启动器都走这里）。
 * - 缓存新鲜（< 6h）且未 force → 直接返回缓存，不联网；
 * - 否则返回当前缓存（可能为空）并**在后台**刷新，`refreshing: true` 表示还在跑。
 */
export async function checkPluginUpdates({ force = false, probe = {} } = {}) {
  const cached = await readUpdateCache();
  const fresh = cached && Date.now() - Date.parse(cached.checkedAt ?? 0) < UPDATES_TTL_MS;
  const needsRefresh = force || !fresh;

  if (needsRefresh && !updateCheckInFlight) {
    updateCheckInFlight = (async () => {
      try {
        const sources = await collectPluginSources();
        const inventory = await runUpdateCheck(sources, probe);
        const payload = { checkedAt: new Date().toISOString(), inventory };
        await writeUpdateCache(payload);
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
  return {
    ...current,
    summary: summarizeUpdateInventory(current.inventory),
    refreshing: Boolean(needsRefresh && updateCheckInFlight),
    progress: updateProgress,
    lastBatch: lastBatchUpdate
  };
}

function json(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
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
          try {
            const value = await body(req);
            if (!value || (!value.url && !value.name)) { json(res, 400, { error: '缺少插件标识' }); return; }
            json(res, 200, await installPlugin({ url: value.url, name: value.name }));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
                host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/uninstall', handler: async (req, res) => {
                if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
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
                  json(res, 200, await updatePlugin(value.name));
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
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/update-many', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          res.on('error', () => {});
          try {
            const value = await body(req);
            const names = Array.isArray(value?.names) ? value.names.filter(item => typeof item === 'string' && item) : [];
            if (names.length === 0) { json(res, 400, { error: '缺少要更新的插件' }); return; }
            // 批量更新可能跑几分钟：先回已受理，进度由客户端刷新列表/检测结果体现。
            json(res, 202, { ok: true, accepted: names.length, names });
            void updatePlugins(names).catch(() => {});
          } catch (error) { try { json(res, 500, { error: String(error?.message || error) }); } catch { /* 客户端已断开 */ } }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/uninstall-many', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const names = Array.isArray(value?.names) ? value.names.filter(name => typeof name === 'string' && name) : [];
            if (names.length === 0) { json(res, 400, { error: '缺少要卸载的插件' }); return; }
            json(res, 200, await uninstallPlugins(names));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-plugin-manager/cleanup', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            if (!value?.name) { json(res, 400, { error: '缺少插件名' }); return; }
            json(res, 200, await cleanupBrokenPlugin(value.name));
          } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }})
      ];
      return () => disposers.forEach(dispose => dispose());
    }, 'dsh-plugin-manager: routes');
  });
}
