import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  declaredRowsFromPatchYaml,
  describeDisabledPlugins,
  discoverPluginRowIds,
  invalidatePluginRowCache,
  isSafeRowId,
  normalizeDisabledBundle,
  parseDumpConfigRows,
  patchPathsFromArgv,
  pluginRowIds,
  readDisabledState,
  removeDisabledBundle,
  renderDisabledPatch,
  rowIdsForBundleFromRows,
  rowIdsFromDeclaredRows,
  setPluginDisabled,
  undisableableReason,
} from '../lib/index.js';

/**
 * 插件停用（--patch overlay）相关的纯逻辑与状态文件单测。
 *
 * 覆盖四条链路：dump-config 行 id 发现（含内置插件的按 name 认领）→ patch 文本
 * 渲染（过滤不可停用 + 去重）→ set 写入/启用移除 → 状态文件读回时的自愈。
 * 不启动 dsh：dump 输出用 fixture 注入，状态文件写进临时 DSH_HOME。
 */

/** 真实 dump 的形状：自己那一节 / 被用户 patch 改过的节 / 启动器补丁插入的内置插件 / 嵌套子行。 */
const DUMP_FIXTURE = `
# == @deepseek-ai/dsh-base
- id: session
  name: '@deepseek-ai/dsh-session'
- id: storage
  name: '@deepseek-ai/dsh-storage'
  config:
    - id: nested-child
      name: '@deepseek-ai/dsh-nested'
# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app
- id: agent
  name: '@deepseek-ai/dsh-agent'
# == @alice/dsh-own-plugin
- id: alice-row
  name: '@alice/dsh-own-plugin'
- id: alice-group
  name: '@deepseek-ai/cordis-plugin-group'
  config:
    - id: alice-child
      name: '@alice/dsh-own-plugin'
# == bundled-plugin, patched by /Users/me/.dsh/profiles/web/cordis.patch.yml
- id: bundled-row
  name: 'bundled-plugin'
# == /Applications/DSH.app/Contents/Resources/DSHArchiveManager/cordis.patch.yml
- id: dsh-archive-manager
  name: 'dsh-archive-manager'
- id: dsh-plugin-manager
  name: 'dsh-plugin-manager'
- id: dsh-session-notify
  name: 'dsh-session-notify'
- id: bad id with spaces
  name: 'unsafe-plugin'
`;

const withTempHome = async (prefix, fn) => {
  const previousHome = process.env.DSH_HOME;
  const home = await mkdtemp(join(tmpdir(), prefix));
  process.env.DSH_HOME = home;
  invalidatePluginRowCache();
  try {
    return await fn(home);
  } finally {
    invalidatePluginRowCache();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
};

test('parseDumpConfigRows：只取顶格行，带来源节与 name，缩进子行/不安全 id 丢弃', () => {
  const rows = parseDumpConfigRows(DUMP_FIXTURE);
  const ids = rows.map(row => row.id);
  assert.ok(ids.includes('session'));
  assert.ok(ids.includes('alice-row'));
  assert.ok(ids.includes('bundled-row'));
  assert.ok(!ids.includes('nested-child'), '缩进子行由父行连带 disabled，不能单独取');
  assert.ok(!ids.includes('alice-child'), '嵌套子行不取');
  assert.ok(!ids.includes('bad id with spaces'), '不安全 id 直接丢弃（要写进 YAML）');
  const bundled = rows.find(row => row.id === 'bundled-row');
  assert.equal(bundled.bundle, 'bundled-plugin');
  assert.equal(bundled.patched, true);
  assert.equal(bundled.name, 'bundled-plugin');
});

test('rowIdsForBundleFromRows：自己那一节优先；patched by 段按 name 认领；未知 bundle 返回空', () => {
  const rows = parseDumpConfigRows(DUMP_FIXTURE);
  assert.deepEqual(rowIdsForBundleFromRows('@alice/dsh-own-plugin', rows), ['alice-row', 'alice-group']);
  assert.deepEqual(rowIdsForBundleFromRows('bundled-plugin', rows), ['bundled-row'], '只有 patched by 段时按行 name 认领');
  assert.deepEqual(rowIdsForBundleFromRows('dsh-plugin-manager', rows), ['dsh-plugin-manager'], '启动器补丁段的行也认得出来');
  assert.deepEqual(rowIdsForBundleFromRows('no-such-bundle', rows), [], '找不到行 id 返回空，交给上层报错');
  assert.deepEqual(rowIdsForBundleFromRows('@deepseek-ai/dsh-base', rows), ['session', 'storage'], 'core bundle 自己的行也照实返回（是否允许停用由另一层判定）');
});

test('rowIdsForBundleFromRows：同一 bundle 的重复行 id 去重', () => {
  const dump = `
# == @a/b
- id: row-1
  name: '@a/b'
# == @a/b, patched by /x.yml
- id: row-1
  name: '@a/b'
`;
  assert.deepEqual(rowIdsForBundleFromRows('@a/b', parseDumpConfigRows(dump)), ['row-1']);
});

test('declaredRowsFromPatchYaml：只认 insert 块里的顶格行，不碰改别人行的补丁，坏 id 丢弃', () => {
  const yaml = `
# 注释
- id: someone-else
  config:
    model: x
- insert:
    - id: my-row
      name: 'my-plugin'
      config:
        - id: my-child
          name: 'my-plugin'
    - id: second-row
      name: '@scope/second'
- insert:
    - id: unsafe\\nid
      name: 'bad'
`;
  const rows = declaredRowsFromPatchYaml(yaml);
  assert.deepEqual(rows.map(row => row.id), ['my-row', 'second-row']);
  assert.equal(rows[0].name, 'my-plugin');
  assert.equal(rows[1].name, '@scope/second');
});

test('rowIdsFromDeclaredRows：按 name 认领，name 缺省时不猜', () => {
  const declared = declaredRowsFromPatchYaml(`
- insert:
    - id: own-row
      name: 'the-bundle'
    - id: other-row
      name: 'another-bundle'
    - id: anonymous
`);
  assert.deepEqual(rowIdsFromDeclaredRows('the-bundle', declared), ['own-row']);
  assert.deepEqual(rowIdsFromDeclaredRows('anonymous', declared), [], '没声明 name 就不猜，宁可报错');
});

test('patchPathsFromArgv：按出现顺序取 --patch 的值，缺值/重复都处理好', () => {
  assert.deepEqual(
    patchPathsFromArgv(['node', 'dsh', 'web', '--patch', '/a.yml', '--no-open', '--patch', '/b.yml', '--port', '3080']),
    ['/a.yml', '/b.yml']
  );
  assert.deepEqual(patchPathsFromArgv(['node', 'dsh', 'web', '--patch']), []);
  assert.deepEqual(patchPathsFromArgv(['node', 'dsh', 'web', '--no-open']), []);
});

test('renderDisabledPatch：过滤不可停用 bundle、去重、空列表渲染空串', () => {
  assert.equal(renderDisabledPatch([]), '', '没有停用项时不产出任何 patch 行（启动器据此不传 --patch）');
  assert.equal(
    renderDisabledPatch([
      { bundle: '@a/b', rowIds: ['row-a', 'row-a', 'bad\nid'] },
      { bundle: '@deepseek-ai/dsh-base', rowIds: ['session'] },
      { bundle: 'dsh-plugin-manager', rowIds: ['dsh-plugin-manager'] },
      { bundle: '@c/d', rowIds: ['row-b'] },
    ]),
    '- id: row-a\n  disabled: true\n- id: row-b\n  disabled: true\n',
    '不可停用的 bundle 被过滤、重复 id 只写一次、不安全 id 丢弃'
  );
});

test('isSafeRowId / normalizeDisabledBundle / undisableableReason 的边界', () => {
  assert.equal(isSafeRowId('openviking-memory'), true);
  assert.equal(isSafeRowId('@a/b:row'), true);
  assert.equal(isSafeRowId(''), false);
  assert.equal(isSafeRowId('a\n  disabled: true'), false);
  assert.equal(isSafeRowId('id with spaces'), false);
  assert.equal(isSafeRowId('a'.repeat(129)), false);

  assert.equal(normalizeDisabledBundle('  dsh-context  '), 'dsh-context');
  assert.equal(normalizeDisabledBundle('../evil'), null);
  assert.equal(normalizeDisabledBundle('a b'), null);
  assert.equal(normalizeDisabledBundle(''), null);

  assert.match(undisableableReason('@deepseek-ai/dsh-base') ?? '', /核心层/);
  assert.match(undisableableReason('@deepseek-ai/dsh-web-app') ?? '', /界面/);
  assert.match(undisableableReason('dsh-plugin-manager') ?? '', /无法从界面恢复/);
  assert.equal(undisableableReason('dsh-context'), null);
});

test('discoverPluginRowIds：dump 一次解析、按指纹缓存、force 可强刷', async () => {
  await withTempHome('dsh-pm-discover-', async () => {
    const options = { dump: DUMP_FIXTURE, fingerprint: 'fixture-1' };
    const first = await discoverPluginRowIds(options);
    assert.deepEqual(first.get('@alice/dsh-own-plugin'), ['alice-row', 'alice-group']);
    // 指纹相同 → 直接吃缓存（不再调用 dump 也一样能命中）
    const cached = await discoverPluginRowIds({ fingerprint: 'fixture-1' });
    assert.equal(cached, first, '同指纹应返回同一个 Map（没有重新 dump）');
    const forced = await discoverPluginRowIds({ dump: DUMP_FIXTURE, fingerprint: 'fixture-1', force: true });
    assert.deepEqual(forced.get('bundled-plugin'), ['bundled-row']);
  });
});

test('pluginRowIds：dump 里没有行时，dump 失败才回退插件自己的 patch 声明', async () => {
  await withTempHome('dsh-pm-rows-', async (home) => {
    const modules = join(home, 'profiles', 'web', 'node_modules');
    await mkdir(join(modules, 'fallback-plugin'), { recursive: true });
    await writeFile(join(modules, 'fallback-plugin', 'cordis.patch.yml'), '- insert:\n    - id: fallback-row\n      name: fallback-plugin\n');
    const profile = join(home, 'profiles', 'web', 'package.json');
    await writeFile(profile, JSON.stringify({ dsh: { profile: { bundles: ['fallback-plugin'] } } }));

    // dump 成功但树里没有它：不回退（说明当前没装配，写 overlay 等于写不存在的行）
    assert.deepEqual(await pluginRowIds('fallback-plugin', { dump: DUMP_FIXTURE, force: true }), []);
    invalidatePluginRowCache();
    // dump 失败（临时 DSH_HOME 里没有 dsh CLI）：回退到插件自己的 insert 声明
    assert.deepEqual(await pluginRowIds('fallback-plugin', { force: true }), ['fallback-row']);
  });
});

test('setPluginDisabled：不可停用拒绝、行 id 找不到拒绝、停用写入、启用移除', async () => {
  await withTempHome('dsh-pm-set-', async (home) => {
    const modules = join(home, 'profiles', 'web', 'node_modules');
    for (const name of ['dsh-context', 'dsh-other']) {
      await mkdir(join(modules, name), { recursive: true });
      await writeFile(join(modules, name, 'cordis.patch.yml'), `- insert:\n    - id: ${name}-row\n      name: ${name}\n`);
    }
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-context', 'dsh-other', '@deepseek-ai/dsh-base'] } } }));
    const stateFile = join(home, 'plugin-manager', 'disabled.json');

    const protectedResult = await setPluginDisabled('dsh-plugin-manager', true);
    assert.equal(protectedResult.ok, false);
    assert.equal(protectedResult.code, 'protected');
    assert.match(protectedResult.error, /不能停用/);

    const missing = await setPluginDisabled('not-installed', true);
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'not-installed');

    const noRows = await setPluginDisabled('dsh-other', true, { rowsByBundle: new Map() });
    assert.equal(noRows.ok, false);
    assert.equal(noRows.code, 'row-not-found', '找不到行 id 必须报错，绝不写空覆盖');
    assert.deepEqual(await readDisabledState({ stateFile }), [], '失败时不应留下状态');

    const disabled = await setPluginDisabled('dsh-context', true);
    assert.equal(disabled.ok, true);
    assert.deepEqual(disabled.rowIds, ['dsh-context-row']);
    assert.equal(disabled.restartRequired, true);

    const document = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.equal(document.version, 1);
    assert.match(document.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(document.disabled.map(entry => entry.bundle), ['dsh-context']);
    assert.deepEqual(document.disabled[0].rowIds, ['dsh-context-row']);

    const state = await readDisabledState({ stateFile });
    assert.deepEqual(state.map(entry => entry.bundle), ['dsh-context']);

    // 再停用一次：幂等，不重复
    await setPluginDisabled('dsh-context', true);
    assert.deepEqual((await readDisabledState({ stateFile })).map(entry => entry.bundle), ['dsh-context']);

    const enabled = await setPluginDisabled('dsh-context', false);
    assert.equal(enabled.ok, true);
    assert.equal(enabled.disabled, false);
    assert.deepEqual(enabled.rowIds, ['dsh-context-row'], '启用回传被移除的行 id 便于界面提示');
    assert.deepEqual(await readDisabledState({ stateFile }), []);

    // 启用一个本来没停用的插件也算成功（幂等）
    const noop = await setPluginDisabled('dsh-context', false);
    assert.equal(noop.ok, true);
    assert.deepEqual(noop.rowIds, []);
  });
});

test('readDisabledState：畸形/手改状态自愈，不可停用与不安全行 id 一律丢弃', async () => {
  await withTempHome('dsh-pm-state-', async (home) => {
    const stateFile = join(home, 'plugin-manager', 'disabled.json');
    await mkdir(join(home, 'plugin-manager'), { recursive: true });

    assert.deepEqual(await readDisabledState({ stateFile }), [], '文件不存在按未停用处理');

    await writeFile(stateFile, '[not json');
    assert.deepEqual(await readDisabledState({ stateFile }), [], '畸形 JSON 不能让面板/启动器变成故障源');

    await writeFile(stateFile, JSON.stringify({
      version: 1,
      disabled: [
        { bundle: 'ok-plugin', rowIds: ['ok-row', 'bad\nid'], disabledAt: 't' },
        { bundle: 'dsh-plugin-manager', rowIds: ['dsh-plugin-manager'], disabledAt: 't' },
        { bundle: '@deepseek-ai/dsh-base', rowIds: ['session'], disabledAt: 't' },
        { bundle: 'empty-rows', rowIds: [], disabledAt: 't' },
        { bundle: '../evil', rowIds: ['x'], disabledAt: 't' },
        { bundle: 'ok-plugin', rowIds: ['duplicate'], disabledAt: 't' },
      ],
    }));
    const state = await readDisabledState({ stateFile });
    assert.deepEqual(state, [{ bundle: 'ok-plugin', rowIds: ['ok-row'], disabledAt: 't' }], '只留合法、去重、不带不安全行 id 的记录');
  });
});

test('removeDisabledBundle：卸载插件时清掉停用记录', async () => {
  await withTempHome('dsh-pm-remove-', async (home) => {
    const modules = join(home, 'profiles', 'web', 'node_modules');
    await mkdir(join(modules, 'dsh-context'), { recursive: true });
    await writeFile(join(modules, 'dsh-context', 'cordis.patch.yml'), '- insert:\n    - id: dsh-context-row\n      name: dsh-context\n');
    await writeFile(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['dsh-context'] } } }));
    const stateFile = join(home, 'plugin-manager', 'disabled.json');

    await setPluginDisabled('dsh-context', true);
    assert.equal((await readDisabledState({ stateFile })).length, 1);
    assert.equal(await removeDisabledBundle('dsh-context', { stateFile }), true);
    assert.deepEqual(await readDisabledState({ stateFile }), []);
    assert.equal(await removeDisabledBundle('dsh-context', { stateFile }), false, '本来就没记录时返回 false');
  });
});

test('describeDisabledPlugins：合成 installed + 停用状态 + 行 id/不可停用原因', async () => {
  await withTempHome('dsh-pm-describe-', async () => {
    const installed = [
      { name: 'bundled-plugin', source: 'bundled' },
      { name: 'dsh-plugin-manager', source: 'bundled' },
      { name: 'missing-plugin', source: 'user' },
    ];
    const payload = await describeDisabledPlugins({ installed, dump: DUMP_FIXTURE, fingerprint: 'fixture-describe', force: true });
    const byName = new Map(payload.items.map(item => [item.bundle, item]));
    assert.deepEqual(byName.get('bundled-plugin'), {
      bundle: 'bundled-plugin', rowIds: ['bundled-row'], disabled: false, canDisable: true, reason: null,
    });
    assert.equal(byName.get('dsh-plugin-manager').canDisable, false);
    assert.match(byName.get('dsh-plugin-manager').reason, /无法从界面恢复/);
    assert.equal(byName.get('missing-plugin').canDisable, false);
    assert.match(byName.get('missing-plugin').reason, /行 id/);

    // 已停用的插件：disabled 为 true，仍可启用
    const stateFile = join(process.env.DSH_HOME, 'plugin-manager', 'disabled.json');
    await mkdir(join(process.env.DSH_HOME, 'plugin-manager'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ version: 1, updatedAt: 't', disabled: [{ bundle: 'bundled-plugin', rowIds: ['bundled-row'], disabledAt: 't' }] }));
    const withState = await describeDisabledPlugins({ installed, dump: DUMP_FIXTURE, fingerprint: 'fixture-describe', force: true });
    const item = withState.items.find(entry => entry.bundle === 'bundled-plugin');
    assert.equal(item.disabled, true);
    assert.equal(item.canDisable, true);
  });
});
