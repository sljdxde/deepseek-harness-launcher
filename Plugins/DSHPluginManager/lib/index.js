import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh');
const profilesWebModules = () => join(dshHome(), 'profiles', 'web', 'node_modules');
const marketRoot = () => join(dshHome(), 'plugin-market');
const marketIndexFile = () => join(marketRoot(), 'index.json');
const marketRepoDir = () => join(marketRoot(), 'repo');

const MARKET_REPO_URL = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git';
/** Bundle the launcher ships with; symlink targets contain one of these names. */
const BUNDLED_MARKERS = ['DSHArchiveManager', 'DSHPluginManager'];
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

/**
 * List the plugins actually present in the web profile's node_modules.
 * Entries whose package.json cannot be read (e.g. a dangling symlink left by a
 * failed install) are reported as `broken` so the UI can offer a cleanup,
 * instead of being silently skipped.
 * @returns {Promise<Array<{name:string,version:string|null,description:string,source:'bundled'|'user'|'broken',broken?:boolean}>>}
 */
export async function listInstalledPlugins() {
  const entries = await listScopedModules(profilesWebModules());
  const out = [];
  for (const entry of entries) {
    const meta = await readPackageMeta(entry.path);
    if (meta?.name) {
      const target = await linkTarget(entry.path);
      const source = target && BUNDLED_MARKERS.some(marker => target.includes(marker)) ? 'bundled' : 'user';
      out.push({ name: meta.name, version: meta.version, description: meta.description, source });
    } else if (entry.isLink) {
      // A dangling symlink left by a failed install: report it so the UI can
      // offer a cleanup, instead of silently skipping it.
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
 * Install a plugin that lives in a git repo subdirectory (`author/repo#subdir`).
 * Such plugins are not npm packages, so they cannot go through `pnpm add <pkg>`.
 * We shallow-clone the repo, copy the subdirectory into a persistent source
 * folder under the profile, and add it as a `file:` dependency so pnpm records
 * it in the profile manifest and node_modules (and dsh reconciles its bundle).
 * @param {{author:string,repo:string,subdir:string}} ref
 * @param {Set<string>} installedNames - lower-cased names already present.
 * @returns {Promise<{ok:boolean,alreadyInstalled?:boolean,installedAs?:string,packageName?:string,note?:string,error?:string}>}
 */
async function installSubdirPlugin(ref, installedNames) {
  const repoUrl = `https://github.com/${ref.author}/${ref.repo}.git`;
  const tmpRoot = await fs.mkdtemp(join(tmpdir(), 'dsh-pm-'));
  const cloneDir = join(tmpRoot, 'repo');
  let note = '';
  try {
    await run('git', ['clone', '--depth', '1', repoUrl, cloneDir], { timeout: 300000 });
    const src = join(cloneDir, ref.subdir);
    const meta = await readPackageMeta(src);
    if (!meta?.name) {
      return { ok: false, error: `仓库 ${ref.full} 的子目录 ${ref.subdir} 没有 package.json，无法作为插件安装` };
    }
    if (installedNames.has(meta.name.toLowerCase())) {
      return { ok: true, alreadyInstalled: true, installedAs: meta.name, packageName: meta.name };
    }
    // Persistent source folder inside the profile keeps the file: dependency
    // stable across restarts; a safe folder name avoids path tricks.
    const sourcesDir = join(profilesWebModules(), '..', 'plugin-sources');
    const safeName = ref.subdir.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '-') || 'plugin';
    const dest = join(sourcesDir, `${ref.author}-${ref.repo}-${safeName}`);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(src, dest, { recursive: true });
    const result = await pluginCommand(['add', `file:${dest}`]);
    note = result.note;
    return { ok: true, installedAs: `file:${dest}`, packageName: meta.name, note };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Install a market entry. Pure `author/repo` plugins are installed through the
 * npm candidates first, falling back to a git URL. `author/repo#subdir`
 * plugins are installed from their git subdirectory. Both paths are idempotent:
 * an already-installed package is reported as `alreadyInstalled` instead of
 * being reinstalled.
 * @param {{name?:string,url?:string}} entry
 * @returns {Promise<{ok:boolean,alreadyInstalled?:boolean,installedAs?:string,packageName?:string,note?:string,error?:string}>}
 */
export async function installPlugin(entry) {
  const { candidates, git, repoRef } = installCandidates(entry);
  const installed = await listInstalledPlugins();
  const installedNames = new Set(installed.filter(item => !item.broken).map(item => item.name.toLowerCase()));

  // Subdirectory plugins cannot be addressed by npm name; route them to the
  // git-subdirectory installer (which also does its own idempotence check).
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
  for (const candidate of candidates) {
    try {
      const result = await pluginCommand(['add', candidate]);
      return { ok: true, installedAs: candidate, packageName: candidate, note: result.note };
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  if (git) {
    try {
      const result = await pluginCommand(['add', `git+${git}`]);
      return { ok: true, installedAs: `git+${git}`, note: result.note };
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  return { ok: false, error: lastError || '安装失败' };
}

export async function uninstallPlugin(name) {
  try {
    const result = await pluginCommand(['remove', name]);
    return { ok: true, note: result.note };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

/**
 * Remove a leftover of a failed install (dangling symlink / partial checkout)
 * from the profile's node_modules. Only a bare package path (optionally under
 * an `@scope` directory) is accepted, so the path cannot escape the modules
 * directory.
 * @param {string} name - module name, e.g. `foo` or `@scope/foo`.
 * @returns {Promise<{ok:boolean}>}
 */
export async function cleanupBrokenPlugin(name) {
  if (typeof name !== 'string' || !/^[@a-zA-Z0-9._/-]+$/.test(name) || name.includes('..')) {
    throw new Error('非法的插件名');
  }
  const target = join(profilesWebModules(), name);
  await fs.rm(target, { recursive: true, force: true });
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
