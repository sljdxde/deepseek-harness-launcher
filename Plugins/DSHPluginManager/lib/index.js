import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
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
        entries.push({ package: `${entry.name}/${item.name}`, path: join(path, item.name), isDir: item.isDirectory() || item.isSymbolicLink() });
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      entries.push({ package: entry.name, path, isDir: true });
    }
  }
  return entries;
}

/**
 * List the plugins actually present in the web profile's node_modules.
 * @returns {Promise<Array<{name:string,version:string,description:string,source:'bundled'|'user'|'unknown'}>>}
 */
export async function listInstalledPlugins() {
  const entries = await listScopedModules(profilesWebModules());
  const out = [];
  for (const entry of entries) {
    const meta = await readPackageMeta(entry.path);
    if (!meta?.name) continue;
    const target = await linkTarget(entry.path);
    const source = target && BUNDLED_MARKERS.some(marker => target.includes(marker)) ? 'bundled' : 'user';
    out.push({ name: meta.name, version: meta.version, description: meta.description, source });
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

/** npm package candidates for a market entry (`author/repo`), then a git URL. */
export function installCandidates(entry) {
  const slash = (entry.name || '').indexOf('/');
  const author = slash >= 0 ? entry.name.slice(0, slash) : '';
  const repo = slash >= 0 ? entry.name.slice(slash + 1) : entry.name;
  const candidates = [];
  if (author && repo) candidates.push(`@${author.toLowerCase()}/${repo.toLowerCase()}`);
  if (repo) candidates.push(repo.toLowerCase());
  return { candidates, git: entry.url ? entry.url.replace(/\/$/, '') + '.git' : null };
}

export async function installPlugin(entry) {
  const { candidates, git } = installCandidates(entry);
  let lastError = '';
  for (const candidate of candidates) {
    try {
      const result = await pluginCommand(['add', candidate]);
      return { ok: true, installedAs: candidate, note: result.note };
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
        }})
      ];
      return () => disposers.forEach(dispose => dispose());
    }, 'dsh-plugin-manager: routes');
  });
}
