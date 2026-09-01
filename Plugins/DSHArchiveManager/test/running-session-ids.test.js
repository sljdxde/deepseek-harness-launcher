import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deleteTrees } from '../lib/index.js';

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
