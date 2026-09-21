import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import test from 'node:test';
import { listArchives } from '../lib/index.js';

// dsh 0.1.5-rc.2 的 sessionPersistence.list() 会跳过历史格式（generation 0）
// 的会话；归档管理必须从磁盘兜底读取这些会话的 header，否则归档列表为空。
test('归档列表从磁盘兜底读取 persistence 跳过的历史格式会话', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-archive-legacy-'));
  process.env.DSH_HOME = dshHome;

  try {
    const project = join(dshHome, 'sessions', 'project');
    // v0 + zstd：0.1.x 时代最常见的归档会话形态
    await mkdir(join(project, 'session-aaa'), { recursive: true });
    await writeFile(
      join(project, 'session-aaa', 'session.jsonl.zstd'),
      zstdCompressSync(Buffer.from(
        JSON.stringify({ type: 'session', version: 0, id: 'session-aaa', createdAt: 111 }) + '\n' +
        JSON.stringify({ type: 'turn/started', seq: 0 }) + '\n'
      ))
    );
    // v0 + 纯 JSONL，且引用同样停留在磁盘上的 v0 父会话
    await mkdir(join(project, 'session-bbb'), { recursive: true });
    await writeFile(
      join(project, 'session-bbb', 'session.jsonl'),
      JSON.stringify({ type: 'session', version: 0, id: 'session-bbb', createdAt: 222, parentSession: 'session-aaa' }) + '\n'
    );
    // 当前格式会话由 persistence 提供，磁盘上不存在也不应报错
    const persisted = [{ id: 'session-ccc', version: 3, createdAt: 333, cwd: '/tmp' }];

    await mkdir(join(dshHome, 'storages'), { recursive: true });
    await writeFile(join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
      global: { archivedSessionIds: ['session-aaa', 'session-bbb'] },
      tables: { workspaces: {} }
    }));

    const services = {
      sessionPersistence: { list: async () => persisted },
      get: () => undefined
    };
    const items = await listArchives(services);
    const byId = new Map(items.map(item => [item.id, item]));

    assert.deepEqual([...byId.keys()].sort(), ['session-aaa', 'session-bbb']);
    assert.equal(byId.get('session-aaa').createdAt, 111);
    // bbb 的 parentSession 指向 aaa，且父会话 aaa 已通过兜底进入 headers，
    // 子树计数正确（自身除外）
    assert.equal(byId.get('session-aaa').descendants, 1);
    assert.deepEqual(byId.get('session-aaa').tree, ['session-aaa', 'session-bbb']);
    assert.equal(byId.get('session-bbb').descendants, 0);
    // 标题查询服务不可用时回退为会话 ID
    assert.equal(byId.get('session-aaa').title, 'session-aaa');
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

// persistence 能看到的会话不触发磁盘扫描路径；wantlist 全部可见时直接返回。
test('persistence 可见时归档列表与原行为一致', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-archive-current-'));
  process.env.DSH_HOME = dshHome;

  try {
    await mkdir(join(dshHome, 'storages'), { recursive: true });
    await writeFile(join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
      global: { archivedSessionIds: ['session-live'] },
      tables: { workspaces: { w: { title: '工作区', sessionIds: ['session-live'] } } }
    }));

    const items = await listArchives({
      sessionPersistence: { list: async () => [{ id: 'session-live', version: 3, createdAt: 42, cwd: '/repo' }] },
      get: () => ({ readTitle: async () => ({ title: '活的会话' }) })
    });

    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'session-live');
    assert.equal(items[0].title, '活的会话');
    assert.equal(items[0].workspace, '工作区');
    assert.equal(items[0].descendants, 0);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});
