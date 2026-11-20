// 归档管理服务端（lib/index.js）的全分支场景集合。
//
// 为什么这些场景放在共享 helper 里、并且每个 import 了 lib/index.js 的测试
// 文件都要跑一遍：
//   scripts/coverage-check.mjs 把 NODE_V8_COVERAGE 里各测试进程的 V8 数据
//   按「同名函数的 range 拼在一起」合并，而 count=0 的 range（没走到的分支）
//   会被算成未覆盖 —— 也就是**跨进程取交集**：只要有任何一个加载了
//   lib/index.js 的测试进程没走到某条分支，合并后那条分支就算未覆盖。
//   node --test 每个测试文件都是独立进程，所以凡是 import 了 lib/index.js 的
//   测试文件，都必须把全部分支走一遍（runArchiveScenarios）。
//
// 场景本身不碰网络、不碰真实用户数据：DSH_HOME 指向临时目录，故障用
// 「给 fs.promises 打临时补丁」的方式注入（用完立刻恢复）。
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import {
  apply,
  deleteTrees,
  listArchives,
  patchWorkspaceDeleteForAutoArchive,
  restoreArchives,
  workspaceAutoArchiveIds,
} from '../../lib/index.js';

/** 临时 DSH_HOME：跑完恢复原值（测试文件内串行执行，不与别的文件互相踩）。 */
export async function withTempHome(run) {
  const previous = process.env.DSH_HOME;
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-'));
  process.env.DSH_HOME = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}

/** 给 fs.promises 打临时补丁注入故障，跑完恢复。补丁函数的第一个参数是原实现。 */
export async function withFsPatch(patch, run) {
  const originals = new Map();
  for (const name of Object.keys(patch)) originals.set(name, fs[name]);
  for (const [name, impl] of Object.entries(patch)) {
    const original = originals.get(name);
    fs[name] = (...args) => impl(original, ...args);
  }
  try {
    return await run();
  } finally {
    for (const [name, impl] of originals) fs[name] = impl;
  }
}

/** 写一份 workspace.json。 */
async function writeWorkspaceFile(home, state) {
  await mkdir(join(home, 'storages'), { recursive: true });
  await writeFile(join(home, 'storages', 'workspace.json'), JSON.stringify(state, null, 2), 'utf8');
}

/** 建一个会话目录并写入首行 header。 */
async function writeSession(home, dir, name, header, options = {}) {
  const target = join(home, 'sessions', dir, name);
  await mkdir(target, { recursive: true });
  const line = JSON.stringify(header) + '\n';
  if (options.zstd) await writeFile(join(target, options.fileName || 'session.jsonl.zstd'), zstdCompressSync(Buffer.from(line)));
  else await writeFile(join(target, options.fileName || 'session.jsonl'), line, 'utf8');
  return target;
}

/** 一个只认得归档列表的假服务集合。 */
const servicesWith = (headers, options = {}) => ({
  sessionPersistence: { list: async () => headers },
  get: name => (name === 'sessionQuery' ? options.sessionQuery : undefined),
});

/** cordis 形状的最小宿主：注册路由并返回可调用的 handler。 */
export function makeHarness({ workspaceRegistry, sessionPersistence } = {}) {
  const routes = new Map();
  const teardown = [];
  const host = {
    webServer: {
      register: route => {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
    workspaceRegistry: workspaceRegistry || { delete: async () => 'deleted', archiveSession: async () => {} },
    // sessionPersistence: null → 模拟「服务不可用」（重接口应当报 500 / 409）
    sessionPersistence: sessionPersistence === null ? undefined : (sessionPersistence || { list: async () => [] }),
    // 没有 sessionQuery 服务：标题回退成会话 id
    get: () => undefined,
    effect: setup => { teardown.push(setup()); },
  };
  const ctx = { inject: (deps, callback) => { callback(host); }, logger: { warn() {} } };
  const call = async (path, { method = 'GET', body } = {}) => {
    const handler = routes.get(path);
    assert.ok(handler, `路由 ${path} 已注册`);
    let status = 0;
    let headers = null;
    let responseBody = '';
    const res = {
      writeHead: (code, extra) => { status = code; headers = extra || {}; },
      end: payload => { responseBody = payload ?? ''; },
    };
    const request = { method, url: path };
    if (body !== undefined) {
      request[Symbol.asyncIterator] = async function* () { yield Buffer.from(body); };
    }
    await handler(request, res);
    return { status, headers, body: responseBody, json: () => JSON.parse(responseBody) };
  };
  return { ctx, call, routes, dispose: () => teardown.forEach(fn => fn()) };
}

export const scenarios = [];
const scenario = (name, run) => { scenarios.push({ name, run }); };

// ── 历史格式会话的磁盘兜底 ────────────────────────────────────────────────
scenario('历史格式会话：从磁盘兜底读回 header，坏数据一律不认', async () => {
  await withTempHome(async home => {
    // v0 + zstd（0.1.x 时代最常见）
    await writeSession(home, 'project', 'session-zstd', { type: 'session', version: 0, id: 'session-zstd', createdAt: 11 }, { zstd: true });
    // v0 + 纯 JSONL，且引用同样在磁盘上的父会话
    await writeSession(home, 'project', 'session-child', { type: 'session', version: 0, id: 'session-child', createdAt: 22, parentSession: 'session-zstd' });
    // 首行不是合法 JSON
    const broken = join(home, 'sessions', 'project', 'session-broken');
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, 'session.jsonl'), 'not json at all\n', 'utf8');
    // 首行 JSON 合法但没有字符串 id
    await writeSession(home, 'project', 'session-noid', { type: 'session', version: 0 });
    // 首行是 null（header 为空对象 → 可选链短路）
    const nullHeader = join(home, 'sessions', 'project', 'session-null');
    await mkdir(nullHeader, { recursive: true });
    await writeFile(join(nullHeader, 'session.jsonl'), 'null\n', 'utf8');
    // 空文件（读不到首行）
    const empty = join(home, 'sessions', 'project', 'session-empty');
    await mkdir(empty, { recursive: true });
    await writeFile(join(empty, 'session.jsonl'), '', 'utf8');
    // .zstd 但内容不是 zstd（解码失败 → 按「读不到 header」处理）
    const badZstd = join(home, 'sessions', 'project', 'session-badzstd');
    await mkdir(badZstd, { recursive: true });
    await writeFile(join(badZstd, 'session.jsonl.zstd'), 'this is not zstd', 'utf8');
    // 同一目录里有多代日志 → 取版本最高的那代；另有不匹配正则的文件与子目录
    const multi = join(home, 'sessions', 'project', 'session-multi');
    await mkdir(multi, { recursive: true });
    await writeFile(join(multi, 'session.jsonl'), JSON.stringify({ type: 'session', id: 'session-multi', createdAt: 1 }) + '\n', 'utf8');
    await writeFile(join(multi, 'session.v3.jsonl'), JSON.stringify({ type: 'session', id: 'session-multi', createdAt: 2 }) + '\n', 'utf8');
    await writeFile(join(multi, 'notes.txt'), 'ignore me\n', 'utf8');
    await mkdir(join(multi, 'sub'), { recursive: true });
    // 深层嵌套（超过四层就不再往下走了）
    await mkdir(join(home, 'sessions', 'a', 'b', 'c', 'd', 'e', 'session-deep'), { recursive: true });
    await writeFile(join(home, 'sessions', 'a', 'b', 'c', 'd', 'e', 'session-deep', 'session.jsonl'),
      JSON.stringify({ type: 'session', id: 'session-deep' }) + '\n', 'utf8');

    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: ['session-zstd', 'session-child', 'session-broken', 'session-noid', 'session-null', 'session-empty', 'session-badzstd', 'session-multi'] },
      tables: { workspaces: {} },
    });

    const items = await listArchives(servicesWith([], { sessionQuery: undefined }));
    const ids = items.map(item => item.id).sort();
    assert.deepEqual(ids, ['session-child', 'session-multi', 'session-zstd'], '只认合法的 header');
    const byId = new Map(items.map(item => [item.id, item]));
    assert.equal(byId.get('session-zstd').createdAt, 11);
    assert.equal(byId.get('session-child').createdAt, 22);
    assert.equal(byId.get('session-multi').createdAt, 2, '多代日志取版本最高的那一代');
    // 子会话的父会话在磁盘上 → 树关系完整
    assert.deepEqual(byId.get('session-zstd').tree, ['session-zstd', 'session-child']);
    assert.equal(byId.get('session-zstd').descendants, 1);
    assert.equal(byId.get('session-child').descendants, 0);
    // 没有标题服务时标题回退成会话 id
    assert.equal(byId.get('session-zstd').title, 'session-zstd');
  });
});

scenario('历史格式会话：父会话不在归档列表里时也会被补进会话表', async () => {
  await withTempHome(async home => {
    // 三层链：爷爷 → 爸爸 → 儿子。归档列表里只有儿子。
    await writeSession(home, 'project', 'session-grandpa', { type: 'session', id: 'session-grandpa', createdAt: 1 });
    await writeSession(home, 'project', 'session-parent', { type: 'session', id: 'session-parent', createdAt: 2, parentSession: 'session-grandpa' });
    await writeSession(home, 'project', 'session-kid', { type: 'session', id: 'session-kid', createdAt: 3, parentSession: 'session-parent' });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: ['session-kid'] }, tables: { workspaces: {} } });

    const items = await listArchives(servicesWith([]));
    assert.deepEqual(items.map(item => item.id), ['session-kid'], '列表只出归档里的会话');
    assert.deepEqual(items[0].tree, ['session-kid'], '树里是它自己和后代');

    // 关键：爸爸/爷爷的 header 虽然没被选中，也会顺着 parentSession 被读出来，
    // 于是「选中的儿子 + 选中的爷爷」能认出儿子有已选中的祖先 → 儿子不再单独成根。
    const result = await deleteTrees(servicesWith([]), ['session-kid', 'session-grandpa']);
    assert.deepEqual(result.roots, ['session-grandpa'], '有已选中的祖先时儿子不再单独成根');
    assert.deepEqual(result.deleted, ['session-grandpa', 'session-parent', 'session-kid'], '整条链一起删');
  });
});

scenario('归档列表：标题、工作区、cwd 与查询失败时的回退', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: ['a', 'b', 'ghost'] },
      tables: { workspaces: { w1: { title: '项目', sessionIds: ['a'] }, w2: { title: '其它', sessionIds: [] } } },
    });
    const sessionQuery = {
      readTitle: async id => {
        if (id === 'a') return { title: '标题 A' };
        throw new Error('标题服务挂了');
      },
    };
    const headers = [{ id: 'a', createdAt: 1, cwd: '/repo' }, { id: 'b', createdAt: 2 }];
    const items = await listArchives(servicesWith(headers, { sessionQuery }));
    const byId = new Map(items.map(item => [item.id, item]));
    assert.equal(items.length, 2, '归档列表里没有的会话不出现');
    assert.equal(byId.get('a').title, '标题 A', '标题来自 sessionQuery');
    assert.equal(byId.get('a').workspace, '项目', '工作区名来自工作区表');
    assert.equal(byId.get('a').cwd, '/repo');
    assert.equal(byId.get('b').title, 'b', '标题查询失败时回退成会话 id');
    assert.equal(byId.get('b').workspace, '未分组', '不属于任何工作区时是「未分组」');
    assert.equal(byId.get('b').cwd, '', '没有 cwd 时是空串');

    // workspace.json 里没有 tables → 标题同样兜底成「未分组」
    await writeWorkspaceFile(home, { global: { archivedSessionIds: ['a'] } });
    const bare = await listArchives(servicesWith(headers, { sessionQuery }));
    assert.equal(bare[0].workspace, '未分组', '工作区表缺失时不报错');
  });
});

// ── 删除 ────────────────────────────────────────────────────────────────
scenario('删除：连同后代一起删，并从工作区里摘掉', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await mkdir(join(home, 'sessions', 'project', 'child'), { recursive: true });
    await mkdir(join(home, 'sessions', 'project', 'other'), { recursive: true });
    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: [] },
      tables: { workspaces: { project: { title: '项目', sessionIds: ['root', 'child', 'other'] } } },
    });
    const headers = [{ id: 'root' }, { id: 'child', parentSession: 'root' }, { id: 'other' }];
    const result = await deleteTrees(servicesWith(headers), ['root']);
    assert.deepEqual(result.roots, ['root']);
    assert.deepEqual(result.deleted, ['root', 'child'], '后代跟着一起删');
    assert.equal(result.directories, 2);
    assert.equal(result.cleanupPending, false);
    const left = await readdir(join(home, 'sessions', 'project'));
    assert.deepEqual(left, ['other'], '只删掉选中的会话目录');
    const workspace = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'));
    assert.deepEqual(workspace.tables.workspaces.project.sessionIds, ['other'], '工作区里的会话列表也更新了');
  });
});

scenario('删除：选中集里含后代时，后代不会单独成为删除根', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await mkdir(join(home, 'sessions', 'project', 'child'), { recursive: true });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const headers = [{ id: 'root' }, { id: 'child', parentSession: 'root' }];
    const result = await deleteTrees(servicesWith(headers), ['root', 'child']);
    assert.deepEqual(result.roots, ['root'], '有祖先被选中时后代不再是根');
    assert.deepEqual(result.deleted, ['root', 'child']);
  });
});

scenario('删除：写盘失败时回滚已移动的目录并抛错', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await mkdir(join(home, 'sessions', 'project', 'child'), { recursive: true });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const headers = [{ id: 'root' }, { id: 'child', parentSession: 'root' }];
    await withFsPatch({
      writeFile: async () => { throw new Error('磁盘满了'); },
    }, async () => {
      await assert.rejects(() => deleteTrees(servicesWith(headers), ['root']), /磁盘满了/);
    });
    const left = await readdir(join(home, 'sessions', 'project'));
    assert.deepEqual(left.sort(), ['child', 'root'], '删除失败后目录被搬回原位');
    const trash = (await readdir(join(home, 'sessions'))).filter(name => name.startsWith('.dsh-archive-trash-'));
    assert.deepEqual(trash, [], '回收目录被清理掉');
  });
});

scenario('删除：清理回收目录失败时标记 cleanupPending，索引仍然一致', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const headers = [{ id: 'root' }];
    const result = await withFsPatch({
      rm: async (original, target, options) => {
        if (String(target).includes('.dsh-archive-trash-')) throw new Error('文件被占用');
        return original(target, options);
      },
    }, () => deleteTrees(servicesWith(headers), ['root']));
    assert.equal(result.cleanupPending, true, '清理失败要标记出来');
    assert.match(result.cleanupError, /文件被占用/);
    assert.deepEqual(result.deleted, ['root'], '索引照样是删掉了');
  });
});

scenario('删除：移动会话目录失败时不留下回收目录', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const headers = [{ id: 'root' }];
    await withFsPatch({
      rename: async (original, from, to) => {
        if (String(to).includes('.dsh-archive-trash-')) throw new Error('移动失败');
        return original(from, to);
      },
    }, async () => {
      await assert.rejects(() => deleteTrees(servicesWith(headers), ['root']), /移动失败/);
    });
    const trash = (await readdir(join(home, 'sessions'))).filter(name => name.startsWith('.dsh-archive-trash-'));
    assert.deepEqual(trash, [], '回收目录被清理掉');
    assert.deepEqual(await readdir(join(home, 'sessions', 'project')), ['root'], '会话目录留在原地');
  });
});

scenario('删除：移动失败且回收目录也删不掉时保留原始错误', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const headers = [{ id: 'root' }];
    await withFsPatch({
      rename: async (original, from, to) => {
        if (String(to).includes('.dsh-archive-trash-')) throw new Error('移动失败');
        return original(from, to);
      },
      rm: async (original, target, options) => {
        if (String(target).includes('.dsh-archive-trash-')) throw new Error('回收目录删不掉');
        return original(target, options);
      },
    }, async () => {
      // 清理失败不能盖住最初那个错误
      await assert.rejects(() => deleteTrees(servicesWith(headers), ['root']), /移动失败/);
    });
  });
});

scenario('删除：回滚也失败时保留原始错误，不掩盖现场', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const headers = [{ id: 'root' }];
    await withFsPatch({
      writeFile: async () => { throw new Error('磁盘满了'); },
      rename: async (original, from, to) => {
        // 只有「搬回原位」（目标不是回收目录）会失败
        if (!String(to).includes('.dsh-archive-trash-')) throw new Error('搬不回去');
        return original(from, to);
      },
      rm: async (original, target, options) => {
        if (String(target).includes('.dsh-archive-trash-')) throw new Error('回收目录删不掉');
        return original(target, options);
      },
    }, async () => {
      // 抛出的仍然是最初那个错误（磁盘满了），不是回滚/清理时的次生错误
      await assert.rejects(() => deleteTrees(servicesWith(headers), ['root']), /磁盘满了/);
    });
  });
});

scenario('删除：清理失败时错误信息里没有 message 也能读出来', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const headers = [{ id: 'root' }];
    const result = await withFsPatch({
      rm: async () => { throw '回收目录被占用'; },
    }, () => deleteTrees(servicesWith(headers), ['root']));
    assert.equal(result.cleanupPending, true);
    assert.equal(result.cleanupError, '回收目录被占用', '不是 Error 对象的异常也能变成可读信息');
  });
});

// ── 还原 ────────────────────────────────────────────────────────────────
scenario('还原：先走 registry.unarchiveSession，孤儿按 cwd 挂回工作区', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: ['a'] },
      tables: { workspaces: { w1: { title: '项目', path: '/repo', sessionIds: [] } } },
    });
    const calls = { unarchived: [], attached: [] };
    const registry = {
      unarchiveSession: async id => { calls.unarchived.push(id); },
      resolveByPath: async cwd => {
        assert.equal(cwd, '/repo');
        return { attachSession: async id => { calls.attached.push(id); } };
      },
    };
    const result = await restoreArchives({ ...servicesWith([{ id: 'a', cwd: '/repo' }]), workspaceRegistry: registry }, ['a']);
    assert.deepEqual(result.roots, ['a']);
    assert.deepEqual(calls.unarchived, ['a'], '先让 registry 取消归档');
    assert.equal(result.restored, 1, '归档标记少了一个');
    assert.deepEqual(result.attached, ['a'], '孤儿按 cwd 挂回工作区');
    assert.deepEqual(calls.attached, ['a'], 'registry 的 attachSession 被调用');
    const workspace = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'));
    assert.deepEqual(workspace.global.archivedSessionIds, [], '归档标记被清掉');
  });
});

scenario('还原：registry 不可用时回落到文件级归组', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: ['a'] },
      tables: { workspaces: { w1: { title: '项目', path: '/repo', sessionIds: [] } } },
    });
    const registry = {
      unarchiveSession: async () => { throw new Error('registry 挂了'); },
    };
    const result = await restoreArchives({ ...servicesWith([{ id: 'a', cwd: '/repo' }]), workspaceRegistry: registry }, ['a']);
    assert.deepEqual(result.attached, ['a'], '文件级兜底也把会话挂回工作区');
    const workspace = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'));
    assert.deepEqual(workspace.tables.workspaces.w1.sessionIds, ['a'], '工作区表里补上了会话');
    assert.deepEqual(workspace.global.archivedSessionIds, [], '归档标记被清掉');
  });
});

scenario('还原：没有可用 registry 且找不到匹配工作区时留在未分组', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: ['a'] },
      tables: { workspaces: { w1: { title: '项目', path: '/别的目录', sessionIds: [] } } },
    });
    const result = await restoreArchives({ ...servicesWith([{ id: 'a', cwd: '/repo' }]), workspaceRegistry: {} }, ['a']);
    assert.deepEqual(result.attached, [], '挂不上就留在未分组');
    assert.equal(result.restored, 1, '归档标记照样被清掉');
  });
});

scenario('还原：会话已经在工作区里、或没有 cwd 时不重复归组', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: ['a', 'b'] },
      tables: { workspaces: { w1: { title: '项目', path: '/repo', sessionIds: ['a'] } } },
    });
    const result = await restoreArchives({
      ...servicesWith([{ id: 'a', cwd: '/repo' }, { id: 'b' }]),
      workspaceRegistry: {},
    }, ['a', 'b']);
    assert.deepEqual(result.attached, [], '已归组与没有 cwd 的会话都不再处理');
    const workspace = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'));
    assert.deepEqual(workspace.tables.workspaces.w1.sessionIds, ['a'], '原有归组没被动过');
  });
});

scenario('还原：挂载失败时不中断整个还原', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, {
      global: { archivedSessionIds: ['a'] },
      tables: { workspaces: { w1: { title: '项目', path: '/repo', sessionIds: [] } } },
    });
    const registry = {
      resolveByPath: async () => ({ attachSession: async () => { throw new Error('挂载失败'); } }),
    };
    const result = await restoreArchives({ ...servicesWith([{ id: 'a', cwd: '/repo' }]), workspaceRegistry: registry }, ['a']);
    assert.deepEqual(result.attached, [], '挂载失败不算挂上');
    assert.equal(result.restored, 1, '归档标记照样被清掉');
  });
});

// ── 临时文件与原子写 ────────────────────────────────────────────────────
scenario('临时文件：清掉已退出进程留下的半截文件，留着还活着的那些', async () => {
  await withTempHome(async home => {
    const dir = join(home, 'storages');
    await mkdir(dir, { recursive: true });
    const base = join(dir, 'workspace.json');
    const stale = `${base}.dsh-archive-tmp-2147480000`;   // 不存在的 pid → 已退出
    const alive = `${base}.dsh-archive-tmp-${process.ppid}`; // 父进程还活着
    const mine = `${base}.dsh-archive-tmp-${process.pid}`;   // 自己
    const other = `${base}.not-a-staging-file`;
    await writeFile(stale, 'x', 'utf8');
    await writeFile(alive, 'x', 'utf8');
    await writeFile(mine, 'x', 'utf8');
    await writeFile(other, 'x', 'utf8');
    await mkdir(join(dir, 'sub-dir'), { recursive: true });

    await deleteTrees(servicesWith([]), []);
    const left = await readdir(dir);
    assert.ok(left.includes('workspace.json'), 'workspace.json 写出来了');
    assert.ok(left.includes('sub-dir'), '同目录下的其他东西不受影响');
    assert.ok(left.includes(basename(alive)), '活着的进程的临时文件保留');
    assert.ok(!left.includes(basename(stale)), '已退出进程留下的临时文件被清掉');
    assert.ok(left.includes('workspace.json.not-a-staging-file'), '不匹配的临时文件保留');
  });
});

scenario('写盘失败：临时文件被清理并把错误抛出去', async () => {
  await withTempHome(async home => {
    const dir = join(home, 'storages');
    await mkdir(dir, { recursive: true });
    // 临时文件路径被一个目录占住 → 写入失败，清理也失败（目录删不掉）
    await mkdir(join(dir, `workspace.json.dsh-archive-tmp-${process.pid}`), { recursive: true });
    await mkdir(join(home, 'sessions', 'project', 'root'), { recursive: true });
    await assert.rejects(
      () => deleteTrees(servicesWith([{ id: 'root' }]), ['root']),
      /EISDIR|EACCES|EPERM|illegal operation/i,
    );
  });
});

// ── 工作区删除时自动归档 ────────────────────────────────────────────────
scenario('删除工作区前自动归档：失败不阻塞删除，dispose 还原原方法', async () => {
  const state = () => ({
    global: { archivedSessionIds: ['already'] },
    tables: { workspaces: { ws1: { title: '项目', sessionIds: ['a', 'already', 'b'] } } },
  });
  const archived = [];
  const deleted = [];
  const registry = {
    archiveSession: async id => { archived.push(id); },
    delete: async id => { deleted.push(id); return 'ok'; },
  };
  const dispose = patchWorkspaceDeleteForAutoArchive(registry, async () => state());
  assert.equal(await registry.delete('ws1'), 'ok');
  assert.deepEqual(archived, ['a', 'b'], '只归档尚未归档的会话');
  assert.deepEqual(deleted, ['ws1']);
  dispose();
  assert.equal(typeof registry.delete, 'function', 'dispose 后自有 delete 被还原成原实现');
  assert.equal(await registry.delete('ws1'), 'ok', '还原后不再走自动归档');

  // 类原型上的 delete（不是自有属性）→ dispose 后还原成原型方法
  class Registry { async delete(id) { this.deleted = id; return 'original'; } }
  const inherited = new Registry();
  const disposeInherited = patchWorkspaceDeleteForAutoArchive(inherited, async () => state());
  await inherited.delete('ws1');
  assert.equal(inherited.deleted, 'ws1');
  disposeInherited();
  assert.equal(Object.prototype.hasOwnProperty.call(inherited, 'delete'), false);
  assert.equal(await inherited.delete('ws2'), 'original', '原型方法没被换掉');

  // 单个会话归档失败不影响其余会话
  const failed = [];
  const flaky = {
    archiveSession: async id => { if (id === 'a') throw new Error('unknown'); failed.push(id); },
    delete: async id => { failed.push('delete:' + id); return true; },
  };
  const disposeFlaky = patchWorkspaceDeleteForAutoArchive(flaky, async () => state());
  await flaky.delete('ws1');
  assert.deepEqual(failed, ['b', 'delete:ws1'], '一个会话归档失败不影响其余会话');
  disposeFlaky();

  // 读状态失败：直接删除，不抛错
  const broken = { archiveSession: async () => {}, delete: async id => { broken.deleted = id; return true; } };
  const disposeBroken = patchWorkspaceDeleteForAutoArchive(broken, async () => { throw new Error('磁盘故障'); });
  await assert.doesNotReject(() => broken.delete('ws1'));
  assert.equal(broken.deleted, 'ws1');
  disposeBroken();

  // registry 缺 delete / archiveSession → 不打补丁
  assert.doesNotThrow(() => patchWorkspaceDeleteForAutoArchive({}, async () => state())());
  assert.doesNotThrow(() => patchWorkspaceDeleteForAutoArchive({ delete: async () => {} }, async () => state())());
  assert.doesNotThrow(() => patchWorkspaceDeleteForAutoArchive(null, async () => state())());
});

scenario('workspaceAutoArchiveIds：只列尚未归档的会话', () => {
  const state = {
    global: { archivedSessionIds: ['already'] },
    tables: { workspaces: { ws1: { sessionIds: ['a', 'already', 'b'] } } },
  };
  assert.deepEqual(workspaceAutoArchiveIds(state, 'ws1'), ['a', 'b']);
  assert.deepEqual(workspaceAutoArchiveIds(state, 'missing'), []);
  assert.deepEqual(workspaceAutoArchiveIds({ global: {} }, 'ws1'), []);
});

// ── HTTP 路由 ──────────────────────────────────────────────────────────
scenario('路由：方法守卫、成功响应与错误码', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const harness = makeHarness();
    apply(harness.ctx);

    const health = await harness.call('/dsh-archive-manager/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.json(), { ok: true });
    const healthPost = await harness.call('/dsh-archive-manager/health', { method: 'POST' });
    assert.equal(healthPost.status, 405);
    assert.equal(healthPost.headers.allow, 'GET');

    const archives = await harness.call('/dsh-archive-manager/archives');
    assert.equal(archives.status, 200);
    assert.deepEqual(archives.json(), { items: [] });
    const archivesPost = await harness.call('/dsh-archive-manager/archives', { method: 'POST' });
    assert.equal(archivesPost.status, 405);
    assert.equal(archivesPost.headers.allow, 'GET');

    const del = await harness.call('/dsh-archive-manager/delete', { method: 'POST', body: JSON.stringify({ sessionIds: [] }) });
    assert.equal(del.status, 200);
    assert.deepEqual(del.json().deleted, []);
    const delGet = await harness.call('/dsh-archive-manager/delete');
    assert.equal(delGet.status, 405);
    assert.equal(delGet.headers.allow, 'POST');
    // 单个 sessionId（不是数组）也认
    const single = await harness.call('/dsh-archive-manager/delete', { method: 'POST', body: JSON.stringify({ sessionId: 'x' }) });
    assert.equal(single.status, 200);
    assert.deepEqual(single.json().roots, ['x']);
    // 空 body → 解析成 {}
    const empty = await harness.call('/dsh-archive-manager/delete', { method: 'POST', body: '' });
    assert.equal(empty.status, 200);

    const restore = await harness.call('/dsh-archive-manager/restore', { method: 'POST', body: JSON.stringify({ sessionIds: [] }) });
    assert.equal(restore.status, 200);
    const restoreGet = await harness.call('/dsh-archive-manager/restore');
    assert.equal(restoreGet.status, 405);
    assert.equal(restoreGet.headers.allow, 'POST');

    harness.dispose();
    assert.equal(harness.routes.has('/dsh-archive-manager/health'), false, 'dispose 后路由注销');
    assert.equal(harness.routes.has('/dsh-archive-manager/archives'), false);
  });
});

scenario('路由：服务端出错时返回 500 / 409', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    // sessionPersistence 不可用 → 三个重接口都要报错
    const harness = makeHarness({ sessionPersistence: null });
    apply(harness.ctx);
    const list = await harness.call('/dsh-archive-manager/archives');
    assert.equal(list.status, 500, '列表接口出错返回 500');
    assert.ok(list.json().error, '500 响应带错误信息');
    const del = await harness.call('/dsh-archive-manager/delete', { method: 'POST', body: '{}' });
    assert.equal(del.status, 409, '删除接口出错返回 409');
    assert.ok(del.json().error, '409 响应带错误信息');
    const restore = await harness.call('/dsh-archive-manager/restore', { method: 'POST', body: '{}' });
    assert.equal(restore.status, 409, '还原接口出错返回 409');
    assert.ok(restore.json().error, '409 响应带错误信息');
  });
});

// ── 读取时的 IO 故障（目录读不到） ─────────────────────────────────────
scenario('IO 故障：会话目录读不到时按「没有历史会话」处理', async () => {
  await withTempHome(async home => {
    await writeSession(home, 'project', 'session-a', { type: 'session', id: 'session-a', createdAt: 1 });
    await writeWorkspaceFile(home, { global: { archivedSessionIds: ['session-a'] }, tables: { workspaces: {} } });
    const items = await withFsPatch({
      readdir: async (original, dir, options) => {
        if (String(dir).includes('session-a')) throw new Error('目录读不了');
        return original(dir, options);
      },
    }, () => listArchives(servicesWith([])));
    assert.deepEqual(items, [], '读不到目录时该会话不出现，也不抛错');
  });
});

// ── DSH_HOME 兜底 ──────────────────────────────────────────────────────
scenario('DSH_HOME 没设时回落到用户目录下的 .dsh', async () => {
  const previous = process.env.DSH_HOME;
  const previousProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'dsh-archive-home-'));
  try {
    delete process.env.DSH_HOME;
    // 把「用户目录」指到临时目录：os.homedir() 读 USERPROFILE/HOME
    process.env.USERPROFILE = home;
    process.env.HOME = home;
    await mkdir(join(home, '.dsh', 'storages'), { recursive: true });
    await writeFile(join(home, '.dsh', 'storages', 'workspace.json'),
      JSON.stringify({ global: { archivedSessionIds: ['x'] }, tables: { workspaces: {} } }), 'utf8');
    const items = await listArchives(servicesWith([{ id: 'x', createdAt: 1 }]));
    assert.equal(items.length, 1, '没设 DSH_HOME 时读 ~/.dsh');
    assert.equal(items[0].id, 'x');
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

// ── 状态不完整与杂项 ────────────────────────────────────────────────────
scenario('工作区状态不完整：缺 global / 缺 tables / 行里没有 sessionIds 都不报错', async () => {
  await withTempHome(async home => {
    // 没有 global；工作区行里也没有 sessionIds
    await writeWorkspaceFile(home, { tables: { workspaces: { w1: { title: '空行' } } } });
    const items = await listArchives(servicesWith([]));
    assert.deepEqual(items, [], '没有归档标记时列表为空');

    const deleted = await deleteTrees(servicesWith([]), []);
    assert.deepEqual(deleted.deleted, []);
    const after = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'));
    assert.deepEqual(after.global, { archivedSessionIds: [] }, 'global 被补齐');

    // 连 tables 都没有
    await writeWorkspaceFile(home, {});
    assert.deepEqual(await listArchives(servicesWith([])), []);
    const restored = await restoreArchives(servicesWith([]), []);
    assert.deepEqual(restored.attached, []);
    assert.equal(restored.restored, 0);
    // 有会话但没有工作区表：既挂不上工作区，也不报错
    const orphan = await restoreArchives(servicesWith([{ id: 'a', cwd: '/repo' }]), ['a']);
    assert.deepEqual(orphan.attached, [], '没有工作区表就挂不上');
    assert.equal(orphan.restored, 0);
    // 删除时同样要能处理没有工作区表的状态
    const deletedBare = await deleteTrees(servicesWith([]), []);
    assert.deepEqual(deletedBare.deleted, []);

    // 工作区行有 path 但没有 sessionIds → 归组时按空列表处理
    await writeWorkspaceFile(home, { tables: { workspaces: { w1: { path: '/repo' } } } });
    const attached = await restoreArchives(servicesWith([{ id: 'a', cwd: '/repo' }]), ['a']);
    assert.deepEqual(attached.attached, ['a'], '按 path 挂回工作区');
    const written = JSON.parse(await readFile(join(home, 'storages', 'workspace.json'), 'utf8'));
    assert.deepEqual(written.tables.workspaces.w1.sessionIds, ['a'], 'sessionIds 被补上');

    assert.deepEqual(workspaceAutoArchiveIds({}, 'w1'), [], '缺表时返回空');
    assert.deepEqual(workspaceAutoArchiveIds({ tables: { workspaces: { w1: {} } } }, 'w1'), [], '行里没有 sessionIds 时返回空');
    assert.deepEqual(
      workspaceAutoArchiveIds({ global: { archivedSessionIds: ['x'] }, tables: { workspaces: { w1: { sessionIds: ['x', 'y'] } } } }, 'w1'),
      ['y'],
      '已归档的不再重复列出',
    );
  });
});

scenario('会话目录里的散落文件不会被当成会话', async () => {
  await withTempHome(async home => {
    await mkdir(join(home, 'sessions'), { recursive: true });
    await writeFile(join(home, 'sessions', 'readme.txt'), '不是会话目录\n', 'utf8');
    await mkdir(join(home, 'sessions', 'session-ok'), { recursive: true });
    await writeFile(join(home, 'sessions', 'session-ok', 'session.jsonl'),
      JSON.stringify({ type: 'session', id: 'session-ok', createdAt: 7 }) + '\n', 'utf8');
    await writeWorkspaceFile(home, { global: { archivedSessionIds: ['session-ok'] }, tables: { workspaces: {} } });
    const items = await listArchives(servicesWith([]));
    assert.deepEqual(items.map(item => item.id), ['session-ok'], '只有真的会话目录算数');
    const result = await deleteTrees(servicesWith([]), ['session-ok']);
    assert.deepEqual(result.directories, 1, '删除时也只认会话目录');
  });
});

scenario('临时文件：目录读不到或删不掉时不阻塞写盘', async () => {
  await withTempHome(async home => {
    const dir = join(home, 'storages');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `workspace.json.dsh-archive-tmp-2147480000`), 'x', 'utf8');
    // 目录读不到 → 当作没有临时文件
    const readFail = await withFsPatch({
      readdir: async (original, target, options) => {
        if (String(target).includes('storages')) throw new Error('目录读不了');
        return original(target, options);
      },
    }, () => deleteTrees(servicesWith([]), []));
    assert.deepEqual(readFail.deleted, [], '读不到目录也照样写盘');
    // 临时文件删不掉 → 不影响写盘
    const rmFail = await withFsPatch({
      rm: async (original, target, options) => {
        if (String(target).includes('.dsh-archive-tmp-')) throw new Error('删不掉');
        return original(target, options);
      },
    }, () => deleteTrees(servicesWith([]), []));
    assert.deepEqual(rmFail.deleted, [], '临时文件删不掉也不影响写盘');
    assert.ok((await readdir(dir)).includes('workspace.json'), 'workspace.json 还是写出来了');
  });
});

scenario('路由：服务抛出的不是 Error 对象时错误信息照样可读', async () => {
  await withTempHome(async home => {
    await writeWorkspaceFile(home, { global: { archivedSessionIds: [] }, tables: { workspaces: {} } });
    const harness = makeHarness({
      sessionPersistence: { list: async () => { throw '服务不可用'; } },
    });
    apply(harness.ctx);
    const list = await harness.call('/dsh-archive-manager/archives');
    assert.equal(list.status, 500);
    assert.equal(list.json().error, '服务不可用', '没有 message 的异常也能变成可读信息');
    const del = await harness.call('/dsh-archive-manager/delete', { method: 'POST', body: '{}' });
    assert.equal(del.status, 409);
    assert.equal(del.json().error, '服务不可用');
    const restore = await harness.call('/dsh-archive-manager/restore', { method: 'POST', body: '{}' });
    assert.equal(restore.status, 409);
    assert.equal(restore.json().error, '服务不可用');
  });
});

scenario('自动归档补丁：delete 来自原型时 dispose 把它摘掉', async () => {
  class Registry {
    async delete(id) { this.deleted = id; return 'original'; }
    async archiveSession(id) { this.archived = id; }
  }
  const registry = new Registry();
  const dispose = patchWorkspaceDeleteForAutoArchive(registry, async () => ({
    global: { archivedSessionIds: [] },
    tables: { workspaces: { ws1: { sessionIds: ['a'] } } },
  }));
  await registry.delete('ws1');
  assert.equal(registry.archived, 'a', '删除前先归档');
  assert.equal(registry.deleted, 'ws1');
  dispose();
  assert.equal(Object.prototype.hasOwnProperty.call(registry, 'delete'), false, '自己的 delete 被摘掉');
  assert.equal(await registry.delete('ws2'), 'original', '原型方法还在');
});

/** 把全部分支场景跑一遍（覆盖率合并要求每个加载 lib 的进程都跑）。 */
export async function runArchiveScenarios() {
  for (const item of scenarios) await item.run();
}