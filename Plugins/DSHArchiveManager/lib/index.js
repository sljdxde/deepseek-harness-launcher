import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createZstdDecompress } from 'node:zlib';

const home = () => process.env.DSH_HOME || join(homedir(), '.dsh');
const workspaceFile = () => join(home(), 'storages', 'workspace.json');
const sessionRoot = () => join(home(), 'sessions');

// dsh 0.1.5-rc.2 起会话格式为 v3（session.v3.jsonl[.zstd]），其
// sessionPersistence.list() 会静默跳过无法识别的历史格式；0.1.x 时代写入的
// generation 0 会话（session.jsonl[.zstd]，header.version === 0）因此从列表
// 消失，归档管理随之显示为空。这里的兜底直接扫描磁盘上的会话目录，读取
// generation 文件首行的 header（zstd 用 node:zlib 原生解码），把旧格式会话
// 补回列表；数据本身不做任何改动。
const LEGACY_LOG_FILENAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/u;

async function readFirstLine(filePath, isZstd) {
  return await new Promise((resolve) => {
    const file = createReadStream(filePath);
    let source = file;
    if (isZstd) {
      const decoder = createZstdDecompress();
      file.pipe(decoder);
      source = decoder;
    }
    let buffer = '';
    const finish = (value) => {
      source.destroy();
      file.close();
      resolve(value);
    };
    source.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline >= 0) finish(buffer.slice(0, newline));
    });
    source.on('end', () => finish(buffer || null));
    source.on('error', () => finish(null));
  });
}

/** 目录里版本最高的 generation 日志；不存在返回 null。 */
async function latestGeneration(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
  let best = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = LEGACY_LOG_FILENAME.exec(entry.name);
    if (!match) continue;
    const version = match[1] === undefined ? 0 : Number(match[1]);
    if (best === null || version > best.version) best = { path: join(dir, entry.name), isZstd: match[2] === '.zstd', version };
  }
  return best;
}

/** 读取一个会话目录的 header；文件缺失或首行不是合法 JSON 时返回 null。 */
async function readSessionHeader(dir) {
  const generation = await latestGeneration(dir);
  if (!generation) return null;
  const first = await readFirstLine(generation.path, generation.isZstd);
  if (!first) return null;
  try {
    const header = JSON.parse(first);
    if (typeof header?.id !== 'string') return null;
    return header;
  } catch { return null; }
}

/**
 * persistence.list() 的合并视图：当前格式会话以 persistence 为准，再对
 * `wantedIds` 里 persistence 看不到的会话做磁盘兜底扫描（dsh 官方列表会
 * 跳过历史格式）。`wantedIds` 为空或全部已见时零额外 IO。
 */
async function listHeaders(persistence, wantedIds = []) {
  const headers = await persistence.list();
  const merged = headers.map(header => ({ ...header, id: String(header.id) }));
  const seen = new Set(merged.map(header => header.id));
  const need = new Set([...new Set(wantedIds.map(String))].filter(id => !seen.has(id)));
  if (need.size === 0) return merged;
  // 先收集磁盘上的候选会话目录；历史 header 可能携带 parentSession，为让
  // 树关系完整，被引用的父会话也一并读取（最多四层，防深链）。
  const candidates = [];
  async function walk(dir, depth) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name.startsWith('session-')) { candidates.push({ path, name: entry.name }); continue; }
      if (depth < 4) await walk(path, depth + 1);
    }
  }
  await walk(sessionRoot(), 0);
  for (let pass = 0; pass < 4 && need.size > 0; pass += 1) {
    const round = [...need];
    need.clear();
    for (const candidate of candidates) {
      if (!round.includes(candidate.name)) continue;
      const header = await readSessionHeader(candidate.path);
      if (!header) continue;
      const id = String(header.id);
      if (seen.has(id)) continue;
      merged.push({ ...header, id });
      seen.add(id);
      const parent = header.parentSession === undefined ? undefined : String(header.parentSession);
      if (parent !== undefined && !seen.has(parent)) need.add(parent);
    }
  }
  return merged;
}

async function readWorkspace() {
  try { return JSON.parse(await fs.readFile(workspaceFile(), 'utf8')); }
  catch { return { global: { archivedSessionIds: [] }, tables: { workspaces: {} } }; }
}

function descendants(headers, rootId) {
  const byParent = new Map();
  for (const header of headers) {
    if (!header.parentSession) continue;
    const children = byParent.get(String(header.parentSession)) || [];
    children.push(String(header.id));
    byParent.set(String(header.parentSession), children);
  }
  const out = []; const queue = [String(rootId)];
  while (queue.length) {
    const id = queue.shift(); out.push(id);
    for (const child of byParent.get(id) || []) queue.push(child);
  }
  return out;
}

function workspaceTitle(workspace, sessionId) {
  return Object.values(workspace.tables?.workspaces || {}).find(row => row.sessionIds?.includes(sessionId))?.title || '未分组';
}

export async function listArchives(services) {
  const workspace = await readWorkspace();
  const archived = new Set((workspace.global?.archivedSessionIds || []).map(String));
  const headers = await listHeaders(services.sessionPersistence, [...archived]);
  const byId = new Map(headers.map(header => [String(header.id), header]));
  const query = services.get('sessionQuery');
  return await Promise.all([...archived].filter(id => byId.has(id)).map(async id => {
    const header = byId.get(id); const tree = descendants(headers, id);
    let title = id;
    try { title = (await query?.readTitle?.(id))?.title || id; } catch { /* title fallback is intentionally harmless */ }
    return { id, title, createdAt: header.createdAt, cwd: header.cwd || '', workspace: workspaceTitle(workspace, id), descendants: tree.length - 1, tree };
  }));
}

async function findSessionDirectories(ids) {
  const wanted = new Set(ids); const found = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (!entry.isDirectory()) continue;
      if (wanted.has(entry.name)) { found.push(path); continue; }
      await walk(path);
    }
  }
  await walk(sessionRoot());
  return found;
}

async function writeWorkspace(state) {
  const file = workspaceFile();
  await fs.mkdir(join(home(), 'storages'), { recursive: true });
  const tmp = `${file}.dsh-archive-tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

async function updateWorkspace(ids) {
  const state = await readWorkspace();
  const remove = new Set(ids.map(String));
  state.global = state.global || {};
  state.global.archivedSessionIds = (state.global.archivedSessionIds || []).filter(id => !remove.has(String(id)));
  for (const row of Object.values(state.tables?.workspaces || {})) row.sessionIds = (row.sessionIds || []).filter(id => !remove.has(String(id)));
  await writeWorkspace(state);
}

async function stageDirectories(directories) {
  const root = join(sessionRoot(), `.dsh-archive-trash-${process.pid}-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const moves = [];
  try {
    for (let index = 0; index < directories.length; index += 1) {
      const source = directories[index];
      const target = join(root, String(index));
      await fs.rename(source, target);
      moves.push({ source, target });
    }
    return { root, moves };
  } catch (error) {
    await rollbackMoves(moves);
    try { await fs.rm(root, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
    throw error;
  }
}

async function rollbackMoves(moves) {
  for (const { source, target } of [...moves].reverse()) {
    try { await fs.rename(target, source); } catch { /* preserve the original error */ }
  }
}

function hasSelectedAncestor(headers, rootId, selected) {
  const byId = new Map(headers.map(header => [String(header.id), header]));
  let parent = byId.get(String(rootId))?.parentSession;
  while (parent) {
    if (selected.has(String(parent))) return true;
    parent = byId.get(String(parent))?.parentSession;
  }
  return false;
}

export async function deleteTrees(services, rootIds) {
  const headers = await listHeaders(services.sessionPersistence, rootIds);
  const requested = [...new Set(rootIds.map(String).filter(Boolean))];
  const selected = new Set(requested);
  const roots = requested.filter(root => !hasSelectedAncestor(headers, root, selected));
  const ids = [...new Set(roots.flatMap(root => descendants(headers, root)))];
  const directories = await findSessionDirectories(ids);
  const staged = await stageDirectories(directories);
  try {
    await updateWorkspace(ids);
  } catch (error) {
    await rollbackMoves(staged.moves);
    try { await fs.rm(staged.root, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
    throw error;
  }
  try {
    await fs.rm(staged.root, { recursive: true, force: true });
  } catch (error) {
    // The index is already consistent; leave the trash directory for manual cleanup.
    return { roots, deleted: ids, directories: directories.length, cleanupPending: true, cleanupError: String(error?.message || error) };
  }
  return { roots, deleted: ids, directories: directories.length, cleanupPending: false };
}

/**
 * Whether session `id` is currently accounted by any workspace row.
 */
function sessionHasWorkspace(state, id) {
  return Object.values(state.tables?.workspaces || {}).some(row => (row.sessionIds || []).includes(id));
}

/**
 * Restore archived sessions back to the normal session list. Two steps:
 *   1. Drop each id from the global archive set — dsh core's archive keeps
 *      the workspace `sessionIds` slot, so sessions that still belong to a
 *      workspace reappear in place. Prefer the registry's own
 *      `unarchiveSession` (it serializes through the workspace write chain);
 *      fall back to editing workspace.json directly.
 *   2. Sessions that belong to NO workspace (orphans, e.g. sessions created
 *      before their workspace accounted them) would stay invisible after
 *      step 1. Re-attach each one to the workspace whose path matches the
 *      session header's `cwd`; sessions with no matching workspace are left
 *      alone (they show up nowhere by design).
 * Descendants of an archived root are restored together with the root.
 */
export async function restoreArchives(services, rootIds) {
  const headers = await listHeaders(services.sessionPersistence, rootIds);
  const requested = [...new Set(rootIds.map(String).filter(Boolean))];
  const selected = new Set(requested);
  const roots = requested.filter(root => !hasSelectedAncestor(headers, root, selected));
  const ids = [...new Set(roots.flatMap(root => descendants(headers, root)))];
  const byId = new Map(headers.map(header => [String(header.id), header]));
  const registry = services.workspaceRegistry;

  // Step 1: remove from the archive set through the registry when available.
  if (registry && typeof registry.unarchiveSession === 'function') {
    for (const id of ids) { try { await registry.unarchiveSession(id); } catch { /* fall through to file edit */ } }
  }

  let state = await readWorkspace();
  const archivedBefore = new Set((state.global?.archivedSessionIds || []).map(String));
  const stillArchived = ids.filter(id => archivedBefore.has(id));
  if (stillArchived.length) {
    state.global = state.global || {};
    state.global.archivedSessionIds = (state.global.archivedSessionIds || []).filter(id => !ids.includes(id));
    await writeWorkspace(state);
    state = await readWorkspace();
  }
  const restored = archivedBefore.size - new Set((state.global?.archivedSessionIds || []).map(String)).size;

  // Step 2: re-attach orphan sessions to the workspace matching their cwd.
  const attached = [];
  for (const id of ids) {
    if (sessionHasWorkspace(state, id)) continue;
    const cwd = byId.get(id)?.cwd;
    if (!cwd) continue;
    try {
      if (registry && typeof registry.resolveByPath === 'function') {
        const workspace = await registry.resolveByPath(cwd);
        if (workspace && typeof workspace.attachSession === 'function') {
          await workspace.attachSession(id);
          attached.push(id);
          continue;
        }
      }
      // File-level fallback: find the workspace row by (normalized) path.
      const row = Object.entries(state.tables?.workspaces || {}).find(([, value]) => value.path === cwd);
      if (row) {
        row[1].sessionIds = [id, ...(row[1].sessionIds || [])];
        await writeWorkspace(state);
        state = await readWorkspace();
        attached.push(id);
      }
    } catch { /* an un-attachable orphan stays ungrouped rather than failing the whole restore */ }
  }

  return { roots, restored, attached };
}

/**
 * Sessions that should be auto-archived when the workspace `workspaceId` is
 * deleted: everything still listed in that workspace row and not yet in the
 * global archive set. Pure so it can be unit-tested without a registry.
 */
export function workspaceAutoArchiveIds(state, workspaceId) {
  const row = state.tables?.workspaces?.[String(workspaceId)];
  if (!row) return [];
  const archived = new Set((state.global?.archivedSessionIds || []).map(String));
  return (row.sessionIds || []).map(String).filter(id => !archived.has(id));
}

/**
 * Wrap `workspaceRegistry.delete` so deleting a workspace archives its
 * remaining sessions instead of dropping them into the ungrouped bucket.
 * dsh core keeps `global.archivedSessionIds` across workspace deletion, so
 * the sessions land in the archive view as soon as the workspace is gone —
 * the user no longer has to archive them one by one afterwards. Archiving
 * is best-effort: any failure (unknown session, storage fault) falls back to
 * the stock "becomes ungrouped" behavior and never blocks the delete itself.
 * @param {object} registry - the injected workspaceRegistry service.
 * @returns {() => void} disposer restoring the original method.
 */
export function patchWorkspaceDeleteForAutoArchive(registry, readState = readWorkspace) {
  if (!registry || typeof registry.delete !== 'function' || typeof registry.archiveSession !== 'function') {
    return () => {};
  }
  const original = registry.delete;
  const hadOwn = Object.prototype.hasOwnProperty.call(registry, 'delete');
  const bound = original.bind(registry);
  registry.delete = async function deleteWithAutoArchive(id, ...rest) {
    try {
      const ids = workspaceAutoArchiveIds(await readState(), String(id));
      for (const sessionId of ids) {
        try { await registry.archiveSession(sessionId); } catch { /* unknown sessions keep the ungrouped fallback */ }
      }
    } catch { /* archiving must never block the delete */ }
    return await bound(id, ...rest);
  };
  return () => {
    if (hadOwn) registry.delete = original;
    else delete registry.delete;
  };
}

function json(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf8' });
  response.end(JSON.stringify(value));
}

async function body(request) {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export const name = 'dsh-archive-manager';
export function apply(ctx) {
  ctx.inject(['webServer', 'sessionPersistence', 'workspaceRegistry'], host => {
    host.effect(() => {
      const disposers = [
        // 删除工作区前先把其会话转入归档区（见 patchWorkspaceDeleteForAutoArchive）。
        patchWorkspaceDeleteForAutoArchive(host.workspaceRegistry),
        host.webServer.register({ kind: 'exact', path: '/dsh-archive-manager/archives', handler: async (req, res) => {
          if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
          try { json(res, 200, { items: await listArchives(host) }); } catch (error) { json(res, 500, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-archive-manager/delete', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const sessionIds = Array.isArray(value.sessionIds) ? value.sessionIds : [value.sessionId];
            json(res, 200, await deleteTrees(host, sessionIds));
          }
          catch (error) { json(res, 409, { error: String(error?.message || error) }); }
        }}),
        host.webServer.register({ kind: 'exact', path: '/dsh-archive-manager/restore', handler: async (req, res) => {
          if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
          try {
            const value = await body(req);
            const sessionIds = Array.isArray(value.sessionIds) ? value.sessionIds : [value.sessionId];
            json(res, 200, await restoreArchives(host, sessionIds));
          }
          catch (error) { json(res, 409, { error: String(error?.message || error) }); }
        }})
      ];
      return () => disposers.forEach(dispose => dispose());
    }, 'dsh-archive-manager: routes');
  });
}
