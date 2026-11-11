import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceAutoArchiveIds, patchWorkspaceDeleteForAutoArchive } from '../lib/index.js';

const state = () => ({
  global: { archivedSessionIds: ['already-archived'] },
  tables: { workspaces: { ws1: { title: '项目', sessionIds: ['a', 'already-archived', 'b'] } } }
});

test('workspaceAutoArchiveIds：列出工作区里尚未归档的会话', () => {
  assert.deepEqual(workspaceAutoArchiveIds(state(), 'ws1'), ['a', 'b']);
});

test('workspaceAutoArchiveIds：已全部归档或工作区不存在时为空', () => {
  const all = state();
  all.tables.workspaces.ws1.sessionIds = ['already-archived'];
  assert.deepEqual(workspaceAutoArchiveIds(all, 'ws1'), []);
  assert.deepEqual(workspaceAutoArchiveIds(state(), 'missing'), []);
});

function fakeRegistry({ archiveError } = {}) {
  const calls = { archived: [], deleted: [] };
  return {
    calls,
    async archiveSession(id) {
      if (archiveError) throw archiveError;
      calls.archived.push(String(id));
    },
    async delete(id) { calls.deleted.push(String(id)); return true; }
  };
}

test('删除工作区前先把未归档会话归档，再执行删除', async () => {
  const registry = fakeRegistry();
  const readState = async () => state();
  const dispose = patchWorkspaceDeleteForAutoArchive(registry, readState);
  try {
    const ok = await registry.delete('ws1');
    assert.equal(ok, true);
    assert.deepEqual(registry.calls.archived, ['a', 'b']);
    assert.deepEqual(registry.calls.deleted, ['ws1']);
  } finally { dispose(); }
});

test('单个会话归档失败不影响其余会话，也不阻塞删除', async () => {
  const registry = fakeRegistry();
  let first = true;
  registry.archiveSession = async id => {
    if (first) { first = false; throw new Error('unknown session'); }
    registry.calls.archived.push(String(id));
  };
  const dispose = patchWorkspaceDeleteForAutoArchive(registry, async () => state());
  try {
    await registry.delete('ws1');
    assert.deepEqual(registry.calls.archived, ['b']);
    assert.deepEqual(registry.calls.deleted, ['ws1']);
  } finally { dispose(); }
});

test('读取工作区状态失败时直接删除，不抛错', async () => {
  const registry = fakeRegistry();
  const dispose = patchWorkspaceDeleteForAutoArchive(registry, async () => { throw new Error('disk fault'); });
  try {
    await assert.doesNotReject(registry.delete('ws1'));
    assert.deepEqual(registry.calls.deleted, ['ws1']);
  } finally { dispose(); }
});

test('dispose 后恢复原始 delete；类原型方法也能正确还原', async () => {
  class Registry {
    async delete(id) { this.deleted = String(id); return 'original'; }
  }
  const registry = new Registry();
  const dispose = patchWorkspaceDeleteForAutoArchive(registry, async () => state());
  await registry.delete('ws1');
  assert.equal(registry.deleted, 'ws1');
  dispose();
  assert.equal(Object.prototype.hasOwnProperty.call(registry, 'delete'), false);
  assert.equal(await registry.delete('ws2'), 'original');
});

test('registry 缺少 delete/archiveSession 时不打补丁，disposer 为空操作', () => {
  const dispose = patchWorkspaceDeleteForAutoArchive({}, async () => state());
  assert.doesNotThrow(dispose);
});
