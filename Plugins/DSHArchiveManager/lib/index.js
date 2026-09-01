import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const home = () => process.env.DSH_HOME || join(homedir(), '.dsh');
const workspaceFile = () => join(home(), 'storages', 'workspace.json');
const sessionRoot = () => join(home(), 'sessions');

async function readWorkspace() {
  try { return JSON.parse(await fs.readFile(workspaceFile(), 'utf8')); }
  catch { return { global: { archivedSessionIds: [] }, tables: { workspaces: {} } }; }
}

async function listHeaders(persistence) {
  const headers = await persistence.list();
  return headers.map(header => ({ ...header, id: String(header.id) }));
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

async function listArchives(services) {
  const [workspace, headers] = await Promise.all([readWorkspace(), listHeaders(services.sessionPersistence)]);
  const archived = new Set((workspace.global?.archivedSessionIds || []).map(String));
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
  const headers = await listHeaders(services.sessionPersistence);
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

function json(response, status, value) {
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
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
        }})
      ];
      return () => disposers.forEach(dispose => dispose());
    }, 'dsh-archive-manager: routes');
  });
}
