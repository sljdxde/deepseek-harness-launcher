import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

/**
 * 更新检测相关的纯逻辑单测：沿用 client-toasts.test.js 的 vm 加载模式，
 * 从 `window.__ModuleLoader__.load` 里取出 factory 返回的插件对象，
 * 只对导出的纯函数断言（宿主只消费 inject/apply）。
 */
async function loadPlugin(globals = {}) {
  const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8');
  let plugin;
  const window = {
    __ModuleLoader__: {
      load(record) { plugin = record.factory(requireLike); },
    },
  };
  const requireLike = (name) => {
    if (name === 'react') {
      return { createElement: () => null, Fragment: 'fragment', useState: () => [null, () => {}], useMemo: fn => fn(), useEffect: () => {}, useRef: v => ({ current: v }) };
    }
    throw new Error('unexpected require: ' + name);
  };
  vm.runInNewContext(source, {
    window,
    document: { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ set textContent(v) {} }) },
    setTimeout: fn => { fn(); return 0 },
    setInterval: () => 0,
    clearInterval: () => {},
    ...globals,
  });
  assert.ok(plugin, 'client factory 必须返回插件对象');
  return plugin;
}

/** vm realm 里的对象/数组原型与宿主不同，结构比较前先过一遍 JSON。 */
const plain = value => JSON.parse(JSON.stringify(value));
const sorted = value => Array.from(value).sort();

// ---------- 1. 计数 ----------

test('summarizeUpdates：混合状态只统计 total/update-available/failed/unknown', async () => {
  const plugin = await loadPlugin();
  const summary = plain(plugin.summarizeUpdates([
    { name: 'a', status: 'update-available' },
    { name: 'b', status: 'up-to-date' },
    { name: 'c', status: 'unknown' },
    { name: 'd', status: 'failed' },
    { name: 'e', status: 'ahead' },
    { name: 'f', status: 'update-available' },
  ]));
  assert.deepEqual(summary, { total: 6, updateAvailable: 2, failed: 1, unknown: 1 });
});

test('summarizeUpdates：空清单与 null 入参都不抛错', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(plain(plugin.summarizeUpdates([])), { total: 0, updateAvailable: 0, failed: 0, unknown: 0 });
  assert.deepEqual(plain(plugin.summarizeUpdates(null)), { total: 0, updateAvailable: 0, failed: 0, unknown: 0 });
  assert.deepEqual(plain(plugin.summarizeUpdates(undefined)), { total: 0, updateAvailable: 0, failed: 0, unknown: 0 });
  assert.deepEqual(plain(plugin.summarizeUpdates([null, { name: 'x' }])), { total: 2, updateAvailable: 0, failed: 0, unknown: 0 }, '坏条目不算进任何状态');
});

test('updatesAvailableCount：优先信 summary，缺字段时数 inventory，降级算 0', async () => {
  const plugin = await loadPlugin();
  const inventory = [{ name: 'a', status: 'update-available' }, { name: 'b', status: 'up-to-date' }, { name: 'c', status: 'update-available' }];
  assert.equal(plugin.updatesAvailableCount({ summary: { updateAvailable: 1 }, inventory }), 1);
  assert.equal(plugin.updatesAvailableCount({ inventory }), 2);
  assert.equal(plugin.updatesAvailableCount(null), 0);
  assert.equal(plugin.updatesAvailableCount(undefined), 0);
  assert.equal(plugin.updatesAvailableCount(false), 0, '接口不可用（降级）');
});

// ---------- 2. 侧边栏角标 ----------

test('updatesBadgeText：0/负数不显示，个位数照常，超过 99 收成 99+', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updatesBadgeText(0), '');
  assert.equal(plugin.updatesBadgeText(undefined), '');
  assert.equal(plugin.updatesBadgeText(null), '');
  assert.equal(plugin.updatesBadgeText(-3), '');
  assert.equal(plugin.updatesBadgeText(1), '1');
  assert.equal(plugin.updatesBadgeText(9), '9');
  assert.equal(plugin.updatesBadgeText(99), '99');
  assert.equal(plugin.updatesBadgeText(100), '99+');
  assert.equal(plugin.updatesBadgeText(1234), '99+');
});

// ---------- 3. 行内状态文案 ----------

test('updatePillText：普通可更新与跨大版本两种措辞', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updatePillText({ status: 'update-available', latestVersion: '0.6.0', major: false }), '可更新到 v0.6.0');
  assert.equal(plugin.updatePillText({ status: 'update-available', latestVersion: '1.0.0', major: true }), '跨大版本 v1.0.0');
  assert.equal(plugin.updatePillText({ status: 'update-available', major: true }), '跨大版本 新版本', '远端缺版本号时的兜底');
});

test('updateStatusNote：每种 status 的中文小字文案', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updateStatusNote({ status: 'up-to-date', note: '远端有新提交（版本号未变）' }), '远端有新提交（版本号未变）');
  assert.equal(plugin.updateStatusNote({ status: 'up-to-date', note: null }), null, '已是最新且无 note 就不显示小字');
  assert.equal(plugin.updateStatusNote({ status: 'unknown', note: null }), '本地来源，无法检测');
  assert.equal(plugin.updateStatusNote({ status: 'unknown', note: '远端没有可用的版本号' }), '远端没有可用的版本号', '服务端 note 优先');
  assert.equal(plugin.updateStatusNote({ status: 'ahead', note: null }), '已安装版本比远端更高');
  assert.equal(plugin.updateStatusNote({ status: 'ahead', note: '已安装版本比远端更高' }), '已安装版本比远端更高');
  assert.equal(plugin.updateStatusNote({ status: 'failed', error: 'git ls-remote 超时' }), '检测失败：git ls-remote 超时');
  assert.equal(plugin.updateStatusNote({ status: 'failed', error: null }), '检测失败：未知原因');
  assert.equal(plugin.updateStatusNote({ status: 'failed', error: 'x'.repeat(200) }), `检测失败：${'x'.repeat(80)}…`, '错误摘要截断到 80 字');
  assert.equal(plugin.updateStatusNote({ status: 'update-available', installedVersion: '0.5.1', note: null }), null, '有胶囊时不再重复提示');
  assert.equal(plugin.updateStatusNote(null), null, '接口不可用时没有任何标记');
  assert.equal(plugin.updateStatusNote(undefined), null);
});

test('updateVersionLabel / installedVersionOf：没有版本显示 —，降级时退回已安装列表', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updateVersionLabel('0.5.1'), 'v0.5.1');
  assert.equal(plugin.updateVersionLabel(null), '—');
  assert.equal(plugin.updateVersionLabel(''), '—');
  assert.equal(plugin.installedVersionOf({ installedVersion: '0.5.1' }, { version: '0.4.0' }), '0.5.1', 'inventory 优先');
  assert.equal(plugin.installedVersionOf(null, { version: '0.4.0' }), '0.4.0');
  assert.equal(plugin.installedVersionOf(false, { version: '0.4.0' }), '0.4.0', '降级时用已安装列表的 version');
  assert.equal(plugin.installedVersionOf(null, { name: 'x' }), null);
});

test('updateEntryFor / updatableNames：按名字对齐 inventory', async () => {
  const plugin = await loadPlugin();
  const updates = { inventory: [{ name: 'dsh-notify', status: 'update-available' }, { name: 'b', status: 'up-to-date' }] };
  assert.equal(plugin.updateEntryFor(updates, 'dsh-notify').status, 'update-available');
  assert.equal(plugin.updateEntryFor(updates, 'nope'), null);
  assert.equal(plugin.updateEntryFor(false, 'dsh-notify'), null);
  assert.equal(plugin.updateEntryFor(null, 'dsh-notify'), null);
  assert.deepEqual(Array.from(plugin.updatableNames(updates)), ['dsh-notify']);
  assert.deepEqual(Array.from(plugin.updatableNames(false)), []);
  assert.deepEqual(Array.from(plugin.updatableNames(null)), []);
});

// ---------- 4. 多选：Shift 区间选择 ----------

const rowsFixture = [
  { name: 'a', version: '1.0.0' },
  { name: 'b', version: '1.0.0' },
  { name: 'c', version: '1.0.0' },
  { name: 'd', version: '1.0.0' },
  { name: 'bundled', version: '1.0.0', source: 'bundled' },
  { name: 'broken', version: '1.0.0', broken: true },
];

test('rangeSelection：正向区间把中间行全部选上（不可管理行跳过）', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, 0, 2, new Set())), ['a', 'b', 'c']);
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, 1, 3, new Set())), ['b', 'c', 'd']);
});

test('rangeSelection：反向区间与锚点为空的情况', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, 3, 1, new Set())), ['b', 'c', 'd'], '反向拖动等价于正向');
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, 4, 0, new Set())), ['a', 'b', 'c', 'd'], '区间里的内置/损坏行被跳过');
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, null, 2, new Set())), ['c'], '没有上次点击位置时只选当前行');
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, undefined, 0, new Set())), ['a']);
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, 0, 99, new Set())), ['a', 'b', 'c', 'd'], '越界索引只取存在的行');
});

test('rangeSelection：在已有选择上追加，不丢原有选择', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, 1, 2, new Set(['d']))), ['b', 'c', 'd']);
  assert.deepEqual(sorted(plugin.rangeSelection(rowsFixture, 0, 1, null)), ['a', 'b'], 'selected 为 null 也不抛错');
});

// ---------- 5. 多选：橡皮筋框选与相交判定 ----------

const bandFixture = [
  { name: 'a', selectable: true, rect: { left: 0, top: 0, right: 200, bottom: 40 } },
  { name: 'b', selectable: true, rect: { left: 0, top: 44, right: 200, bottom: 84 } },
  { name: 'c', selectable: true, rect: { left: 0, top: 88, right: 200, bottom: 128 } },
  { name: 'builtin', selectable: false, rect: { left: 0, top: 0, right: 200, bottom: 40 } },
  { name: 'empty', selectable: true, rect: null },
];

test('bandRect：两点规范化为矩形（含反向与零面积）', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(plain(plugin.bandRect({ x: 30, y: 40 }, { x: 10, y: 10 })), { left: 10, top: 10, width: 20, height: 30 });
  assert.deepEqual(plain(plugin.bandRect({ x: 10, y: 10 }, { x: 30, y: 40 })), { left: 10, top: 10, width: 20, height: 30 });
  assert.deepEqual(plain(plugin.bandRect({ x: 5, y: 5 }, { x: 5, y: 5 })), { left: 5, top: 5, width: 0, height: 0 });
  assert.equal(plugin.bandRect(null, { x: 1, y: 1 }), null);
});

test('namesInBand：部分相交也算，空矩形选不到任何行', async () => {
  const plugin = await loadPlugin();
  // 只压住第一行一半 + 第二行上半部分
  assert.deepEqual(Array.from(plugin.namesInBand({ left: 100, top: 20, right: 300, bottom: 60 }, bandFixture)), ['a', 'b']);
  // 空矩形（刚按下还没拖动）选不到任何行
  assert.deepEqual(Array.from(plugin.namesInBand(plugin.bandRect({ x: 10, y: 10 }, { x: 10, y: 10 }), bandFixture)), []);
  assert.deepEqual(Array.from(plugin.namesInBand({ left: 500, top: 500, right: 600, bottom: 600 }, bandFixture)), []);
  assert.deepEqual(Array.from(plugin.namesInBand(null, bandFixture)), []);
  assert.deepEqual(Array.from(plugin.namesInBand({ left: 0, top: 0, right: 200, bottom: 200 }, bandFixture)), ['a', 'b', 'c'], '内置行与没有 rect 的行跳过');
});

test('rectsIntersect：只碰到边不算相交', async () => {
  const plugin = await loadPlugin();
  const band = { left: 0, top: 0, right: 100, bottom: 100 };
  assert.equal(plugin.rectsIntersect(band, { left: 50, top: 50, right: 150, bottom: 150 }), true);
  assert.equal(plugin.rectsIntersect(band, { left: 100, top: 0, right: 200, bottom: 50 }), false);
  assert.equal(plugin.rectsIntersect(band, { left: 0, top: 100, right: 50, bottom: 200 }), false);
  assert.equal(plugin.rectsIntersect(band, null), false);
  assert.equal(plugin.rectsIntersect(null, band), false);
});

test('bandSelection：普通拖动替换选择，Shift 拖动追加', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(sorted(plugin.bandSelection(new Set(['z']), ['a', 'b'], false)), ['a', 'b'], '替换');
  assert.deepEqual(sorted(plugin.bandSelection(new Set(['z']), ['a', 'b'], true)), ['a', 'b', 'z'], '追加');
  assert.deepEqual(sorted(plugin.bandSelection(new Set(['z']), [], true)), ['z'], 'Shift 拖动到空白处保留原选择');
  assert.deepEqual(sorted(plugin.bandSelection(new Set(['z']), [], false)), [], '普通拖动到空白处清空选择');
  assert.deepEqual(sorted(plugin.bandSelection(null, ['a'], false)), ['a']);
});

// ---------- 6. 批量更新：受理、汇总与去重 ----------

test('selectedUpdatableNames：只提交选中且 update-available 的名字', async () => {
  const plugin = await loadPlugin();
  const updates = { inventory: [
    { name: 'a', status: 'update-available' },
    { name: 'b', status: 'up-to-date' },
    { name: 'c', status: 'update-available' },
  ] };
  assert.deepEqual(Array.from(plugin.selectedUpdatableNames(updates, new Set(['a', 'b', 'zzz']))), ['a']);
  assert.deepEqual(Array.from(plugin.selectedUpdatableNames(updates, new Set())), []);
  assert.deepEqual(Array.from(plugin.selectedUpdatableNames(updates, null)), []);
  assert.deepEqual(Array.from(plugin.selectedUpdatableNames(false, new Set(['a']))), []);
  assert.deepEqual(Array.from(plugin.updatableNames(updates)), ['a', 'c'], '「全部更新」提交所有可更新项');
});

test('batchToast：failed === 0 走成功文案（含重启提示）', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(plain(plugin.batchToast({ finishedAt: 't2', updated: 2, failed: 0, results: [{ name: 'a', ok: true }, { name: 'b', ok: true }] })),
    { kind: 'success', text: '已更新 2 个插件，重启 dsh 后生效' });
  assert.equal(plugin.batchToast(null), null, '没有批次');
  assert.equal(plugin.batchToast({ startedAt: 't1', finishedAt: null, updated: 0, failed: 0, results: [] }), null, '后台还在跑');
});

test('batchToast：有失败时是错误文案并带第一个失败插件的 error', async () => {
  const plugin = await loadPlugin();
  assert.deepEqual(plain(plugin.batchToast({
    finishedAt: 't3', updated: 1, failed: 2,
    results: [{ name: 'a', ok: true }, { name: 'b', ok: false, error: 'git ls-remote 超时' }, { name: 'c', ok: false, error: '另一个错误' }],
  })), { kind: 'error', text: '1 个更新成功、2 个失败：git ls-remote 超时' });
  assert.deepEqual(plain(plugin.batchToast({ finishedAt: 't4', updated: 0, failed: 1, results: [{ name: 'b', ok: false }] })),
    { kind: 'error', text: '0 个更新成功、1 个失败：未知错误' }, '失败结果缺少 error 时兜底');
});

test('同一批次只提示一次：finishedAt 相同就不再认领', async () => {
  const plugin = await loadPlugin();
  const store = plugin.createUpdatesStore();
  const shown = [];
  // 模拟面板里的 announceBatchFinish
  const announce = batch => {
    const summary = plugin.batchToast(batch);
    if (!summary) return;
    if (!store.claimBatchFinish(batch.finishedAt)) return;
    shown.push(summary.text);
  };
  announce({ finishedAt: '2026-09-22T11:02:05.000Z', updated: 2, failed: 0, results: [] });
  announce({ finishedAt: '2026-09-22T11:02:05.000Z', updated: 2, failed: 0, results: [] });
  assert.equal(shown.length, 1, '60 秒轮询/重开面板读到同一批次不再提示');
  announce({ finishedAt: '2026-09-22T11:20:00.000Z', updated: 1, failed: 0, results: [] });
  assert.equal(shown.length, 2, '新批次照常提示');
  assert.equal(store.claimBatchFinish(null), false, 'lastBatch: null 不认领');
});

test('batchSettled：批次收尾判定优先 finishedAt / progress.active', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.batchSettled(null), false);
  assert.equal(plugin.batchSettled({ lastBatch: null, progress: null, summary: { updateAvailable: 2 }, inventory: [] }), false, '没有进度字段时看还有没有待更新项');
  assert.equal(plugin.batchSettled({ lastBatch: null, progress: null, summary: { updateAvailable: 0 }, inventory: [] }), true, '老服务端：没有待更新项即结束');
  assert.equal(plugin.batchSettled({ lastBatch: { startedAt: 't', finishedAt: null }, progress: { active: true, current: 'a' }, inventory: [] }), false, '后台还在跑');
  assert.equal(plugin.batchSettled({ lastBatch: { startedAt: 't', finishedAt: null }, progress: { active: false }, summary: { updateAvailable: 3 } }), true, '进度说停了就停，哪怕 summary 还没刷新');
  assert.equal(plugin.batchSettled({ lastBatch: { startedAt: 't', finishedAt: 't2' }, progress: { active: true } }), true, 'finishedAt 优先');
});

// ---------- 7. 进度文案 ----------

const progressFixture = { active: true, kind: 'npm', total: 2, done: 0, current: 'dsh-notify', step: '正在下载并安装' };

test('progressStepText：正在更新的那行显示服务端 step（并补上目标版本）', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.progressStepText({ name: 'dsh-notify', latestVersion: '0.6.0' }, progressFixture), '正在下载并安装 v0.6.0…');
  assert.equal(plugin.progressStepText({ name: 'x', latestVersion: null }, progressFixture), '正在下载并安装…', '没有目标版本就不拼版本号');
  assert.equal(plugin.progressStepText({ name: 'x', latestVersion: '0.6.0' }, { active: true, step: '正在下载并安装 v0.6.0' }), '正在下载并安装 v0.6.0…', 'step 已含版本号不重复拼');
  assert.equal(plugin.progressStepText({ name: 'x', latestVersion: '0.6.0' }, { active: true }), '正在下载并安装 v0.6.0…', 'step 缺失时的兜底文案');
  assert.equal(plugin.progressStepText({ name: 'x', latestVersion: '0.6.0' }, { active: false, step: '正在下载并安装' }), null, 'active: false 时不显示');
  assert.equal(plugin.progressStepText({ name: 'x' }, null), null);
});

test('progressNoteFor：当前行显示步骤，其余待更新行显示「等待中」', async () => {
  const plugin = await loadPlugin();
  const current = { name: 'dsh-notify', latestVersion: '0.6.0' };
  assert.equal(plugin.progressNoteFor(current, progressFixture, true), '正在下载并安装 v0.6.0…');
  assert.equal(plugin.progressNoteFor({ name: 'dsh-other', latestVersion: '2.0.0' }, progressFixture, true), '等待中');
  assert.equal(plugin.progressNoteFor({ name: 'dsh-done' }, progressFixture, false), null, '不在待更新队列里的行不显示进度');
  assert.equal(plugin.progressNoteFor(current, { active: false, current: 'dsh-notify', step: '正在下载并安装' }, true), null, '批次结束回到普通状态');
  assert.equal(plugin.progressNoteFor(current, null, true), null);
  assert.equal(plugin.progressNoteFor(null, progressFixture, true), '等待中');
});

// ---------- 8. markPluginsUpdated / 成功文案 / 接口读取 ----------

test('markPluginsUpdated：成功的条目本地变「已是最新」并重算 summary', async () => {
  const plugin = await loadPlugin();
  const payload = plain({
    checkedAt: '2026-09-22T11:00:00.000Z',
    refreshing: false,
    lastBatch: null,
    summary: { total: 2, updateAvailable: 2, failed: 0, unknown: 0 },
    inventory: [
      { name: 'dsh-notify', status: 'update-available', installedVersion: '0.5.1', latestVersion: '0.6.0', major: false, note: null, error: null },
      { name: 'dsh-foo', status: 'update-available', installedVersion: '1.0.0', latestVersion: '2.0.0', major: true, note: null, error: null },
    ],
  });
  const next = plain(plugin.markPluginsUpdated(payload, [{ name: 'dsh-notify', ok: true, updatedTo: '0.6.0' }]));
  assert.equal(next.summary.updateAvailable, 1);
  assert.equal(next.summary.total, 2);
  assert.equal(next.inventory[0].status, 'up-to-date');
  assert.equal(next.inventory[0].installedVersion, '0.6.0');
  assert.equal(next.inventory[0].major, false);
  assert.equal(next.inventory[1].status, 'update-available', '失败的条目保持原样');
  assert.equal(plugin.updateStatusNote(next.inventory[0]), null, '更新后不再显示标记');
  assert.equal(payload.inventory[0].status, 'update-available', '不改写原 payload');
  assert.equal(plugin.markPluginsUpdated(payload, []), payload, '没有成功条目时原样返回同一引用');
  assert.equal(plugin.markPluginsUpdated(false, [{ name: 'a', ok: true }]), false, '降级时保持降级');
});

test('updateSuccessText：单条更新的 toast 文案', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updateSuccessText('dsh-notify', { ok: true, updatedTo: '0.6.0', restartRequired: true, note: '已更新到 v0.6.0' }), 'dsh-notify 已更新到 v0.6.0，重启 dsh 后生效');
  assert.equal(plugin.updateSuccessText('dsh-notify', { ok: true, updatedTo: '0.6.0', note: '已更新到 v0.6.0（旧版本保留为 x.bak）' }), 'dsh-notify 已更新到 v0.6.0（旧版本保留为 x.bak）');
  assert.equal(plugin.updateSuccessText('dsh-notify', { ok: true, updatedTo: '0.6.0', restartRequired: true }), 'dsh-notify 已更新到 v0.6.0，重启 dsh 后生效');
});

test('formatCheckedClock：本地 HH:mm，空值/非法值交给调用方显示「尚未检测」', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.formatCheckedClock(new Date(2026, 8, 22, 9, 5).toISOString()), '09:05');
  assert.equal(plugin.formatCheckedClock('2026-09-22T11:00:00.000Z').length, 5);
  assert.equal(plugin.formatCheckedClock(null), '');
  assert.equal(plugin.formatCheckedClock(''), '');
  assert.equal(plugin.formatCheckedClock('not-a-date'), '');
});

test('createUpdatesStore：角标与面板共用一份数据，apply(null) 表示接口不可用', async () => {
  const plugin = await loadPlugin();
  const store = plugin.createUpdatesStore();
  assert.equal(store.snapshot(), null, '初始为「尚未读到」');
  const seen = [];
  const unsubscribe = store.subscribe(value => seen.push(value === false ? 'down' : value === null ? 'none' : 'ok'));
  store.apply({ summary: { updateAvailable: 2 }, inventory: [] });
  store.apply(null);
  assert.deepEqual(seen, ['none', 'ok', 'down'], '订阅者立刻收到当前值，之后每次 apply 都通知');
  assert.equal(store.snapshot(), false);
  unsubscribe();
  store.apply({ summary: { updateAvailable: 0 }, inventory: [] });
  assert.equal(seen.length, 3, '退订后不再通知');
});

test('loadUpdates 静默降级：404 / error / 网络异常统一得到 null', async () => {
  const script = [
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
    () => Promise.resolve({ ok: true, status: 200, json: async () => ({ error: '接口挂了' }) }),
    () => Promise.resolve({ ok: true, status: 200, json: async () => ({ checkedAt: 'x', refreshing: false, lastBatch: null, summary: { updateAvailable: 0 }, inventory: [] }) }),
  ];
  const calls = [];
  const plugin = await loadPlugin({ fetch: (...args) => { calls.push(args); return script.shift()(); } });
  assert.equal(await plugin.loadUpdates(), null, '网络异常');
  assert.equal(await plugin.loadUpdates({ refresh: true }), null, '404（外部 Harness 实例没有这个接口）');
  assert.equal(await plugin.loadUpdates(), null, '业务 error');
  assert.equal((await plugin.loadUpdates({ refresh: true })).checkedAt, 'x', '正常响应原样返回');
  assert.equal(calls[0][0], '/dsh-plugin-manager/updates');
  assert.equal(calls[1][0], '/dsh-plugin-manager/updates?refresh=1');
  assert.equal(calls[3][0], '/dsh-plugin-manager/updates?refresh=1');
});

test('pollUpdates：refreshing=true 时每 1.5s 重试，最多 20 次', async () => {
  const delays = [];
  let hits = 0;
  const plugin = await loadPlugin({
    fetch: () => {
      hits += 1;
      const refreshing = hits <= 3;
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ checkedAt: 't', refreshing, lastBatch: null, summary: { updateAvailable: 0 }, inventory: [] }) });
    },
    setTimeout: (fn, ms) => { delays.push(ms); fn(); return delays.length },
  });
  const value = await plugin.pollUpdates({ refresh: true });
  assert.equal(value.refreshing, false);
  assert.equal(hits, 4);
  assert.deepEqual(Array.from(delays), [1500, 1500, 1500], '重试间隔 1.5s');

  let stuck = 0;
  const stuckPlugin = await loadPlugin({
    fetch: () => { stuck += 1; return Promise.resolve({ ok: true, status: 200, json: async () => ({ refreshing: true, summary: { updateAvailable: 0 }, inventory: [] }) }); },
    setTimeout: fn => { fn(); return 0 },
  });
  assert.equal((await stuckPlugin.pollUpdates({ refresh: true })).refreshing, true, '到上限后返回最后一次结果');
  assert.equal(stuck, 21, '首请求 + 最多 20 次重试');
});

test('apply 仍然只注册 sidebar.footer.action（宿主契约不变）', async () => {
  const plugin = await loadPlugin();
  const registered = [];
  const ctx = { slots: { inject(name, callback) { assert.equal(name, 'sidebar.footer.action'); callback(); }, register(spec, component) { registered.push({ spec: plain(spec), component }); } } };
  plugin.apply(ctx);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].spec, { name: 'sidebar.footer.action', id: 'dsh-plugin-manager', order: 60, label: '插件管理' });
  assert.equal(typeof registered[0].component, 'function');
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale']);
});
