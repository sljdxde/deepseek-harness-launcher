import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deleteTrees } from '../lib/index.js';
import { runArchiveScenarios } from './helpers/archive-scenarios.js';

test('确认删除后直接清理运行分支，不读取 Agent 状态或归档标记', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-archive-delete-'));
  process.env.DSH_HOME = dshHome;

  try {
    await mkdir(join(dshHome, 'storages'), { recursive: true });
    await mkdir(join(dshHome, 'sessions', 'project', 'root'), { recursive: true });
    await mkdir(join(dshHome, 'sessions', 'project', 'child'), { recursive: true });
    await writeFile(join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
      global: { archivedSessionIds: [] },
      tables: { workspaces: { project: { title: '项目', sessionIds: ['root', 'child'] } } }
    }));

    const result = await deleteTrees({
      sessionPersistence: { list: async () => [{ id: 'root' }, { id: 'child', parentSession: 'root' }] },
      get: () => { throw new Error('删除不应读取 Agent 运行状态'); }
    }, ['root', 'child']);

    assert.deepEqual(result.roots, ['root']);
    assert.deepEqual(result.deleted, ['root', 'child']);
    assert.equal(result.cleanupPending, false);
    await assert.rejects(access(join(dshHome, 'sessions', 'project', 'root')));
    await assert.rejects(access(join(dshHome, 'sessions', 'project', 'child')));
    const workspace = JSON.parse(await readFile(join(dshHome, 'storages', 'workspace.json'), 'utf8'));
    assert.deepEqual(workspace.global.archivedSessionIds, []);
    assert.deepEqual(workspace.tables.workspaces.project.sessionIds, []);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

// 覆盖率合并是**跨进程取交集**（见 helpers/archive-scenarios.js 顶部的说明）：
// 只要有一个加载了 lib/index.js 的测试进程没走到某条分支，合并后那条分支就
// 算未覆盖。所以每个 import 了 lib/index.js 的测试文件都要把全部分支走一遍。
test('全分支扫描：所有分支在这个进程里都走到', async () => {
  await runArchiveScenarios();
});
