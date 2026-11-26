// 客户端（client/client.js）纯函数的边界补测。
//
// client.js 把一批纯函数导出给单测用（见文件末尾的 return 块）：
// 更新检测的计数与文案、选区计算等。这些函数原来只被冒烟测试间接碰到几条路径，
// 边界分支（空清单、非法输入、极端值）没人测。
//
// 这里只测**导出的纯函数**，不碰渲染：渲染由 client-render.smoke.mjs 负责。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE_PATH = fileURLToPath(new URL('../client/client.js', import.meta.url));

async function loadPlugin(globals = {}) {
  const source = await readFile(SOURCE_PATH, 'utf8');
  let plugin;
  const window = {
    __ModuleLoader__: {
      load(record) { plugin = record.factory(requireLike); },
    },
  };
  const requireLike = (name) => {
    if (name === 'react') {
      return {
        createElement: () => null,
        Fragment: 'fragment',
        useState: () => [null, () => {}],
        useMemo: fn => fn(),
        useEffect: () => {},
        useRef: v => ({ current: v }),
      };
    }
    if (name === 'react-dom/client') return { createRoot: () => ({ render() {} }) };
    if (name === 'react-dom') return { render() {} };
    throw new Error('unexpected require: ' + name);
  };
  vm.runInNewContext(source, {
    window,
    document: {
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ set textContent(v) {} }),
    },
    setTimeout: fn => { fn(); return 0 },
    setInterval: () => 0,
    clearInterval: () => {},
    ...globals,
  }, { filename: SOURCE_PATH });
  assert.ok(plugin, 'client factory 必须返回插件对象');
  return plugin;
}

/** vm realm 里的对象原型与宿主不同，结构比较前先过一遍 JSON。 */
const plain = value => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------
// 1. mergeUpdates：新响应没有 inventory 时沿用旧清单
// ---------------------------------------------------------------------------

test('mergeUpdates：新响应带 inventory 就整份替换', async () => {
  const plugin = await loadPlugin();
  const previous = { inventory: [{ name: 'a', status: 'update-available' }], summary: { total: 1 }, checkedAt: 'x' };
  const next = { inventory: [{ name: 'b', status: 'up-to-date' }], summary: { total: 1 }, checkedAt: 'y' };
  const merged = plain(plugin.mergeUpdates(previous, next));
  assert.equal(merged.inventory.length, 1);
  assert.equal(merged.inventory[0].name, 'b', '新清单整体替换');
  assert.equal(merged.checkedAt, 'y');
});

test('mergeUpdates：新响应没有 inventory 时保留旧清单与旧汇总', async () => {
  const plugin = await loadPlugin();
  const previous = {
    inventory: [{ name: 'a', status: 'update-available' }],
    summary: { total: 7, updateAvailable: 2 },
    checkedAt: 'old-checked',
    lastBatch: { finishedAt: 'old-batch' },
    progress: { active: true },
  };
  const merged = plain(plugin.mergeUpdates(previous, { inventory: [], summary: { total: 0 }, checkedAt: '', lastBatch: null, progress: undefined }));
  assert.equal(merged.inventory.length, 1, '旧清单保留');
  assert.equal(merged.inventory[0].name, 'a');
  assert.deepEqual(merged.summary, { total: 7, updateAvailable: 2 }, '空汇总不覆盖旧汇总');
  assert.equal(merged.checkedAt, 'old-checked', '空 checkedAt 沿用旧值');
  assert.deepEqual(merged.lastBatch, { finishedAt: 'old-batch' }, '空批次沿用旧值');
  assert.deepEqual(merged.progress, { active: true }, 'progress 未定义时沿用旧值');
});

test('mergeUpdates：新响应带非空汇总时覆盖旧汇总', async () => {
  const plugin = await loadPlugin();
  const previous = { inventory: [], summary: { total: 1 }, checkedAt: 'old' };
  const merged = plain(plugin.mergeUpdates(previous, { inventory: [], summary: { total: 9 }, checkedAt: 'new' }));
  assert.deepEqual(merged.summary, { total: 9 }, '新汇总有效时覆盖');
  assert.equal(merged.checkedAt, 'new');
});

test('mergeUpdates：没有旧状态 / 旧状态不是对象时直接用新响应', async () => {
  const plugin = await loadPlugin();
  const next = { inventory: [{ name: 'a' }] };
  assert.deepEqual(plain(plugin.mergeUpdates(null, next)), next, '旧状态为 null');
  assert.deepEqual(plain(plugin.mergeUpdates(false, next)), next, '旧状态为 false');
  assert.deepEqual(plain(plugin.mergeUpdates({ checkedAt: 'x' }, next)), next, '旧状态没有 inventory 字段');
  assert.equal(plugin.mergeUpdates({ inventory: [] }, null), null, '新响应为空时原样返回');
});

// ---------------------------------------------------------------------------
// 2. updatesAvailableCount：服务端 summary 优先，退化到数 inventory
// ---------------------------------------------------------------------------

test('updatesAvailableCount：有 summary 时以它为准（负数收敛到 0）', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updatesAvailableCount({ summary: { updateAvailable: 5 }, inventory: [] }), 5);
  assert.equal(plugin.updatesAvailableCount({ summary: { updateAvailable: -3 } }), 0, '负数收敛到 0');
});

test('updatesAvailableCount：没有 summary 时数 inventory（跳过已忽略）', async () => {
  const plugin = await loadPlugin();
  const count = plugin.updatesAvailableCount({
    inventory: [
      { name: 'a', status: 'update-available' },
      { name: 'b', status: 'update-available', ignored: true },
      { name: 'c', status: 'up-to-date' },
      null,
    ],
  });
  assert.equal(count, 1);
});

test('updatesAvailableCount：空输入返回 0', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updatesAvailableCount(null), 0);
  assert.equal(plugin.updatesAvailableCount(undefined), 0);
  assert.equal(plugin.updatesAvailableCount('not-an-object'), 0);
  assert.equal(plugin.updatesAvailableCount({}), 0);
  assert.equal(plugin.updatesAvailableCount({ inventory: 'not-array' }), 0);
});

// ---------------------------------------------------------------------------
// 3. selectedIgnoredCount：选中集合里被忽略的条数
// ---------------------------------------------------------------------------

test('selectedIgnoredCount：只数选中集合里「可更新且已忽略」的条目', async () => {
  const plugin = await loadPlugin();
  const updates = {
    inventory: [
      { name: 'a', status: 'update-available', ignored: true },
      { name: 'b', status: 'update-available', ignored: true },
      { name: 'c', status: 'update-available' },
      { name: 'd', status: 'failed', ignored: true },
    ],
  };
  assert.equal(plugin.selectedIgnoredCount(updates, new Set(['a', 'c', 'd'])), 1, '只有 a 同时满足三个条件');
  assert.equal(plugin.selectedIgnoredCount(updates, new Set(['a', 'b'])), 2);
  assert.equal(plugin.selectedIgnoredCount(updates, new Set()), 0, '空选中');
});

test('selectedIgnoredCount：输入不合法返回 0', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.selectedIgnoredCount(null, new Set(['a'])), 0);
  assert.equal(plugin.selectedIgnoredCount({ inventory: [] }, null), 0);
  assert.equal(plugin.selectedIgnoredCount({ inventory: 'x' }, new Set(['a'])), 0);
  assert.equal(plugin.selectedIgnoredCount({ inventory: [null] }, new Set(['a'])), 0, '清单里的空项跳过');
});

// ---------------------------------------------------------------------------
// 4. updateStatusNote：各类状态的说明文案
// ---------------------------------------------------------------------------

test('updateStatusNote：不同状态给出对应说明', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updateStatusNote({ status: 'up-to-date' }), null, '已是最新没有说明');
  assert.equal(plugin.updateStatusNote({ status: 'up-to-date', note: '已是 2.0.0' }), '已是 2.0.0');
  assert.match(plugin.updateStatusNote({ status: 'unknown' }), /无法检测/);
  assert.match(plugin.updateStatusNote({ status: 'failed', error: '网络不通' }), /检测失败.*网络不通/);
  assert.match(plugin.updateStatusNote({ status: 'ahead' }), /更高/);
  assert.match(plugin.updateStatusNote({ status: 'update-available', ignored: true }), /已忽略/);
  assert.equal(plugin.updateStatusNote({ status: 'update-available', installedVersion: '1.0.0' }), null, '能读到已装版本就不啰嗦');
  assert.match(plugin.updateStatusNote({ status: 'update-available' }), /无法读取已安装版本/);
  assert.match(plugin.updateStatusNote({ status: 'update-available', note: '读不到版本号' }), /读不到版本号/);
  assert.equal(plugin.updateStatusNote(null), null, '空条目返回 null');
  assert.equal(plugin.updateStatusNote({ status: 'weird' }), null, '未知状态返回 null');
});

// ---------------------------------------------------------------------------
// 5. 选区计算：bandRect / rectsIntersect / namesInBand / bandSelection / rangeSelection
// ---------------------------------------------------------------------------

test('bandRect：两点规范成矩形（宽高取绝对值）', async () => {
  const plugin = await loadPlugin();
  const rect = plain(plugin.bandRect({ x: 40, y: 30 }, { x: 5, y: 10 }));
  assert.equal(rect.left, 5);
  assert.equal(rect.top, 10);
  assert.equal(rect.width, 35, '宽覆盖两个角点');
  assert.equal(rect.height, 20);
  assert.equal(plugin.bandRect(null, { x: 1, y: 1 }), null, '缺起点返回 null');
  assert.equal(plugin.bandRect({ x: 1, y: 1 }, null), null, '缺终点返回 null');
});

test('rectsIntersect：重叠才相交（边界相接不算）', async () => {
  const plugin = await loadPlugin();
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.equal(plugin.rectsIntersect(a, { left: 5, top: 5, right: 15, bottom: 15 }), true, '有重叠');
  assert.equal(plugin.rectsIntersect(a, { left: 20, top: 20, right: 30, bottom: 30 }), false, '完全分开');
  assert.equal(plugin.rectsIntersect(a, { left: 10, top: 0, right: 20, bottom: 10 }), false, '边界相接不算相交');
  assert.equal(plugin.rectsIntersect(null, a), false);
  assert.equal(plugin.rectsIntersect(a, null), false);
});

test('namesInBand：只取与选区相交且可管理的行', async () => {
  const plugin = await loadPlugin();
  const rows = [
    { name: 'a', rect: { left: 0, top: 0, right: 10, bottom: 10 } },
    { name: 'b', rect: { left: 100, top: 100, right: 110, bottom: 110 } },
    { name: 'c', rect: { left: 1, top: 1, right: 5, bottom: 5 }, selectable: false },
    { name: 'd', rect: null },
  ];
  const band = { left: 0, top: 0, right: 50, bottom: 50 };
  assert.deepEqual(plain(plugin.namesInBand(band, rows)), ['a'], '不可管理的行与无 rect 的行都跳过');
  assert.deepEqual(plain(plugin.namesInBand(null, rows)), [], '没有选区返回空');
  assert.deepEqual(plain(plugin.namesInBand(band, 'not-array')), [], '清单不是数组返回空');
});

test('bandSelection：加选与替换两种语义', async () => {
  const plugin = await loadPlugin();
  const existing = new Set(['x']);
  const additive = plain([...plugin.bandSelection(existing, ['y'], true)]).sort();
  assert.deepEqual(additive, ['x', 'y'], '加选保留原有');
  const replace = plain([...plugin.bandSelection(existing, ['y'], false)]);
  assert.deepEqual(replace, ['y'], '替换丢掉原有');
  assert.deepEqual(plain([...plugin.bandSelection(null, ['y'], true)]), ['y'], '原集合为空也能加选');
  assert.deepEqual(plain([...plugin.bandSelection(existing, null, true)]), ['x'], '命中为空时加选不丢原有');
});

test('rangeSelection：连点一段（从锚点到目标）', async () => {
  const plugin = await loadPlugin();
  const items = [
    { name: 'a', broken: false, source: 'user' },
    { name: 'b', broken: false, source: 'user' },
    { name: 'c', broken: true, source: 'user' },
    { name: 'd', broken: false, source: 'bundled' },
    { name: 'e', broken: false, source: 'user' },
  ];
  // 没有锚点：只选中当前这一条（且要可选）
  assert.deepEqual(plain([...plugin.rangeSelection(items, null, 0, new Set())]), ['a'], '无锚点时只选当前');
  assert.deepEqual(plain([...plugin.rangeSelection(items, null, 2, new Set())]), [], '损坏的条目不可选');
  assert.deepEqual(plain([...plugin.rangeSelection(items, null, 3, new Set())]), [], '内置条目不可选');

  // 有锚点：从锚点到目标之间的可选条目
  const range = plain([...plugin.rangeSelection(items, 0, 4, new Set())]).sort();
  assert.deepEqual(range, ['a', 'b', 'e'], '区间内跳过不可选的');
  // 锚点在后面：方向反了也要取同一段
  const reverse = plain([...plugin.rangeSelection(items, 4, 0, new Set())]).sort();
  assert.deepEqual(reverse, ['a', 'b', 'e'], '反向区间取同一段');
  // 已有选择要保留（并集）
  const merged = plain([...plugin.rangeSelection(items, 0, 1, new Set(['z']))]).sort();
  assert.deepEqual(merged, ['a', 'b', 'z'], '连选是并集');
  assert.deepEqual(plain([...plugin.rangeSelection('not-array', 0, 1, new Set())]), [], '清单不是数组返回空');
});

test('rangeSelection：锚点越界时只取当前条目', async () => {
  const plugin = await loadPlugin();
  const items = [{ name: 'a', broken: false, source: 'user' }];
  const result = plain([...plugin.rangeSelection(items, 99, 0, new Set())]);
  assert.deepEqual(result, ['a']);
});

// ---------------------------------------------------------------------------
// 6. 批量与进度文案
// ---------------------------------------------------------------------------

test('batchSettled：批量任务的终态判定', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.batchSettled({ lastBatch: { finishedAt: '2026-01-01' } }), true, '批次有完成时间即结束');
  assert.equal(plugin.batchSettled({ progress: { active: false } }), true, '进度不再活动即结束');
  assert.equal(plugin.batchSettled({ progress: { active: true } }), false, '进度还在跑');
  assert.equal(plugin.batchSettled({ inventory: [] }), true, '没有可更新的就算结束');
  assert.equal(plugin.batchSettled({ inventory: [{ status: 'update-available' }] }), false, '还有可更新的就不算结束');
  assert.equal(plugin.batchSettled(null), false, '空值不算结束');
});

test('batchToast：批量结果按成功/失败汇总', async () => {
  const plugin = await loadPlugin();
  const ok = plugin.batchToast({ finishedAt: '2026-01-01', updated: 3, failed: 0, results: [] });
  assert.equal(ok.kind, 'success');
  assert.match(ok.text, /已更新 3 个插件/);

  const failed = plugin.batchToast({
    finishedAt: '2026-01-01', updated: 1, failed: 2,
    results: [{ name: 'x', ok: false }, { name: 'y', ok: false }],
  });
  assert.equal(failed.kind, 'error');
  assert.match(failed.text, /x、y/);

  const pending = plugin.batchToast({
    finishedAt: '2026-01-01', updated: 1, failed: 0,
    results: [{ name: 'p', ok: true, verified: false }],
  });
  assert.match(pending.text, /需重启 dsh 后确认生效/);

  const skipped = plugin.batchToast({
    finishedAt: '2026-01-01', updated: 0, failed: 0,
    results: [{ name: 'dev', ok: true, skipped: true }],
  });
  assert.equal(skipped.kind, 'info', '本地开发链接是提示不是成功');
  assert.match(skipped.text, /本地开发链接/);

  assert.equal(plugin.batchToast(null), null, '没有批次不弹 toast');
  assert.equal(plugin.batchToast({}), null, '没有完成时间不弹 toast');
});

test('progressStepText：只在进度活动时给文案', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.progressStepText({ latestVersion: '2.0.0' }, null), null, '没有进度返回 null');
  assert.equal(plugin.progressStepText({ latestVersion: '2.0.0' }, { active: false }), null, '进度不活动返回 null');
  const text = plugin.progressStepText({ latestVersion: '2.0.0' }, { active: true, step: '正在下载' });
  assert.match(text, /正在下载/);
  assert.match(text, /v2\.0\.0/);
  assert.match(plugin.progressStepText({}, { active: true }), /正在下载并安装/, '没给 step 用默认文案');
});

test('progressNoteFor：当前条目给进度文案，其余按可否更新给「等待中」', async () => {
  const plugin = await loadPlugin();
  const entry = { name: 'a', latestVersion: '2.0.0' };
  const progress = { active: true, step: '正在下载', current: 'a' };
  assert.match(plugin.progressNoteFor(entry, progress, true), /正在下载/, '当前条目显示进度');
  assert.match(plugin.progressNoteFor(entry, progress, false), /正在下载/, '当前条目不受「可否更新」影响');
  assert.equal(plugin.progressNoteFor({ name: 'b' }, progress, true), '等待中', '别的条目排队中');
  assert.equal(plugin.progressNoteFor({ name: 'b' }, progress, false), null, '不可更新的条目不提示');
  assert.equal(plugin.progressNoteFor(entry, null, true), null, '没有进度返回 null');
});

test('batchProgressLabel：只在能读出总数时带 k/n', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.batchProgressLabel(null), null);
  assert.equal(plugin.batchProgressLabel({ active: false }), null, '不活动返回 null');
  assert.equal(plugin.batchProgressLabel({ active: true }), null, '读不出总数返回 null');
  assert.equal(plugin.batchProgressLabel({ active: true, total: 0, done: 0 }), null, '总数为 0 返回 null');
  assert.equal(plugin.batchProgressLabel({ active: true, total: 4, done: 1 }), '更新中… 2/4');
  assert.equal(plugin.batchProgressLabel({ active: true, total: 4, done: 9 }), '更新中… 4/4', 'done 超过 total 时收敛');
});

// ---------------------------------------------------------------------------
// 7. 其余导出纯函数的空/非法输入
// ---------------------------------------------------------------------------

test('导出的纯函数在空输入下都不抛错', async () => {
  const plugin = await loadPlugin();
  const emptyCases = [
    ['updatesBadgeText', [null]],
    ['updateEntryFor', [null, 'a']],
    ['installedVersionOf', [null, null]],
    ['updateVersionLabel', [null]],
    ['updateStatusNote', [null]],
    ['updatePillText', [null]],
    ['updateSuccessText', ['a', null]],
    ['updatableNames', [null]],
    ['ignorableEntries', [null, new Set()]],
    ['batchToast', [null]],
    ['batchSettled', [null]],
    ['selectedUpdatableNames', [null, new Set()]],
    ['progressStepText', [null, null]],
    ['progressNoteFor', [null, null, false]],
    ['batchProgressLabel', [null]],
    ['ignoredUpdatableCount', [null]],
    ['selectedIgnoredCount', [null, new Set()]],
    ['namesInBand', [null, []]],
    ['bandSelection', [new Set(), null, true]],
    ['markPluginsUpdated', [null, []]],
    ['formatCheckedClock', [null]],
    ['summarizeUpdates', [null]],
    ['mergeUpdates', [null, null]],
    ['updatesAvailableCount', [null]],
  ];
  for (const [name, args] of emptyCases) {
    assert.equal(typeof plugin[name], 'function', `${name} 必须导出`);
    assert.doesNotThrow(() => plugin[name](...args), `${name} 空输入不抛错`);
  }
});

test('updateVersionLabel：无版本时用占位符', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.updateVersionLabel('1.2.3'), 'v1.2.3');
  assert.equal(plugin.updateVersionLabel(''), '—');
  assert.equal(plugin.updateVersionLabel(null), '—');
});

// updatableNames：空清单走的是「提前返回」那条路，正常清单的过滤分支
// （只取 status === 'update-available' 且有名字的条目）也必须走到——
// 「全部更新」按钮的禁用状态就靠它。
test('updatableNames：只取可更新且有名字的条目', async () => {
  const plugin = await loadPlugin();
  const names = plain(plugin.updatableNames({
    inventory: [
      { name: 'a', status: 'update-available' },
      { name: 'b', status: 'update-available' },
      { name: 'c', status: 'up-to-date' },
      { name: '', status: 'update-available' },
      { status: 'update-available' },
      null
    ]
  }));
  assert.deepEqual(names, ['a', 'b'], '只有可更新且有名字的条目算进去');
  assert.deepEqual(plain(plugin.updatableNames({ inventory: 'not-array' })), [], '清单不是数组时按空处理');
});

test('formatCheckedClock：非法时间串返回空串', async () => {
  const plugin = await loadPlugin();
  assert.equal(plugin.formatCheckedClock('not-a-date'), '');
  assert.equal(plugin.formatCheckedClock(null), '');
  assert.ok(plugin.formatCheckedClock('2026-01-01T00:00:00.000Z').length > 0);
});

test('markPluginsUpdated：把已更新的条目标成已是最新并重算汇总', async () => {
  const plugin = await loadPlugin();
  const payload = {
    inventory: [
      { name: 'a', status: 'update-available' },
      { name: 'b', status: 'update-available' },
    ],
  };
  const results = [{ name: 'a', ok: true, updatedTo: '2.0.0', verified: true }];
  const next = plain(plugin.markPluginsUpdated(payload, results));
  const a = next.inventory.find(entry => entry.name === 'a');
  assert.equal(a.status, 'up-to-date');
  assert.equal(a.installedVersion, '2.0.0');
  assert.equal(a.latestVersion, '2.0.0');
  assert.equal(next.summary.updateAvailable, 1, 'b 仍然是可更新');
});

test('markPluginsUpdated：未成功的条目保持原状', async () => {
  const plugin = await loadPlugin();
  const payload = { inventory: [{ name: 'a', status: 'update-available' }] };
  const next = plain(plugin.markPluginsUpdated(payload, [{ name: 'a', ok: true, updatedTo: '2.0.0', verified: false }]));
  assert.equal(next.inventory[0].status, 'update-available', '复核没通过就不算更新成功');
  // 结果里没有 ok:true 的条目一律不算更新
  const notOk = plain(plugin.markPluginsUpdated(payload, [{ name: 'a', updatedTo: '2.0.0' }]));
  assert.equal(notOk.inventory[0].status, 'update-available', '没有 ok 标记不算更新成功');
});


test('mergeLiveStatsIntoMarket：补查值覆盖卡片与榜单，缺字段保持快照', async () => {
  const plugin = await loadPlugin();
  const urlA = 'https://github.com/o/alpha';
  const urlB = 'https://github.com/o/beta';
  const snapshot = () => ({
    plugins: [{ url: urlA, stars: 0, downloads: 0 }, { url: urlB, stars: 0, downloads: 5 }],
    featured: [{ url: urlA, stars: 0, downloads: 0 }],
    topDownloads: [{ url: urlA, stars: 0, downloads: 0 }],
    topStars: [{ url: urlA, stars: 0, downloads: 0 }],
    sections: [{ category: 'ui', plugins: [{ url: urlA, stars: 0, downloads: 0 }] }],
  });
  const merged = plugin.mergeLiveStatsIntoMarket(snapshot(), {
    [urlA]: { stars: 3, downloads: 42 },
    [urlB]: { downloads: 77 }, // star 没查到 → 保持快照
  });
  assert.equal(merged.plugins[0].stars, 3);
  assert.equal(merged.plugins[0].downloads, 42);
  assert.equal(merged.plugins[1].stars, 0, '没查到的字段保持快照值');
  assert.equal(merged.plugins[1].downloads, 77);
  assert.equal(merged.featured[0].stars, 3);
  assert.equal(merged.topDownloads[0].downloads, 42);
  assert.equal(merged.topStars[0].stars, 3);
  assert.equal(merged.sections[0].plugins[0].downloads, 42, '分类分区里的同一插件也要更新');
});

test('mergeLiveStatsIntoMarket：非法输入、无 url、无命中、全空都原样返回', async () => {
  const plugin = await loadPlugin();
  const stats = { 'https://github.com/o/alpha': { stars: 3 } };
  assert.equal(plugin.mergeLiveStatsIntoMarket(null, stats), null);
  assert.deepEqual(plugin.mergeLiveStatsIntoMarket([], stats), [], '数组不是市场对象');
  assert.deepEqual(plain(plugin.mergeLiveStatsIntoMarket({}, null)), {}, '不存在补查结果时原样返回');

  const noUrl = { plugins: [{ stars: 0 }] };
  assert.deepEqual(plain(plugin.mergeLiveStatsIntoMarket(noUrl, stats)), { plugins: [{ stars: 0 }] }, '没有 url 的条目原样返回');

  const noHit = { plugins: [{ url: 'https://github.com/o/beta', stars: 0 }] };
  assert.deepEqual(plain(plugin.mergeLiveStatsIntoMarket(noHit, stats)), { plugins: [{ url: 'https://github.com/o/beta', stars: 0 }] });

  // 命中但两个值都不是数字 → 条目不替换（同一引用）
  const empty = { plugins: [{ url: 'https://github.com/o/alpha', stars: 0 }] };
  const merged = plugin.mergeLiveStatsIntoMarket(empty, { 'https://github.com/o/alpha': {} });
  assert.equal(merged.plugins[0], empty.plugins[0]);

  // 榜单/分区不是数组时原样带过去
  const odd = { plugins: 'nope', featured: null, topDownloads: undefined, topStars: 'x', sections: 'y' };
  const kept = plugin.mergeLiveStatsIntoMarket(odd, stats);
  assert.equal(kept.plugins, 'nope');
  assert.equal(kept.featured, null);
  assert.equal(kept.topDownloads, undefined);
  assert.equal(kept.topStars, 'x');
  assert.equal(kept.sections, 'y');
});
