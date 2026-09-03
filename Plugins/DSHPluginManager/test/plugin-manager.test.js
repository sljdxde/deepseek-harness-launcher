import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile, readFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parsePluginYml, installCandidates, listInstalledPlugins, ensurePnpmPath, hasCommandOnPath } from '../lib/index.js';

test('parsePluginYml 解析 awesome-dsh-plugin 的插件条目格式', () => {
  const text = `url: https://github.com/1624318455/dsh-plugin-tavily
name: 1624318455/dsh-plugin-tavily
category: browser
description:
  en: Tavily-backed web search provider.
  zh: 基于 Tavily 的网页搜索提供方。
`;
  const parsed = parsePluginYml(text);
  assert.equal(parsed.url, 'https://github.com/1624318455/dsh-plugin-tavily');
  assert.equal(parsed.name, '1624318455/dsh-plugin-tavily');
  assert.equal(parsed.category, 'browser');
  assert.equal(parsed.description.en, 'Tavily-backed web search provider.');
  assert.equal(parsed.description.zh, '基于 Tavily 的网页搜索提供方。');
});

test('parsePluginYml 忽略注释与空行，容忍 url 中的冒号', () => {
  const text = `# a comment

url: https://github.com/a/b
name: a/b
category: tool
description:
  en: Has: a colon inside.
`;
  const parsed = parsePluginYml(text);
  assert.equal(parsed.url, 'https://github.com/a/b');
  assert.equal(parsed.description.en, 'Has: a colon inside.');
});

test('installCandidates 先生成 npm 包名、再提供 git 回退', () => {
  const { candidates, git } = installCandidates({ name: '1624318455/dsh-plugin-tavily', url: 'https://github.com/1624318455/dsh-plugin-tavily' });
  assert.deepEqual(candidates, ['@1624318455/dsh-plugin-tavily', 'dsh-plugin-tavily']);
  assert.equal(git, 'https://github.com/1624318455/dsh-plugin-tavily.git');
});

test('listInstalledPlugins 只收录 node_modules 下有 package.json 的条目并标记内置来源', async () => {
  const previousHome = process.env.DSH_HOME;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-list-'));
  process.env.DSH_HOME = dshHome;

  try {
    const modules = join(dshHome, 'profiles', 'web', 'node_modules');
    await mkdir(modules, { recursive: true });
    // bundled plugin: symlink whose target names a launcher bundle marker
    const bundled = join(modules, 'dsh-archive-manager');
    await symlink('/Applications/Deepseek Harness Launcher.app/Contents/Resources/DSHArchiveManager', bundled);
    // user plugin: a real directory with package.json
    const user = join(modules, 'dsh-community-tool');
    await mkdir(user, { recursive: true });
    await writeFile(join(user, 'package.json'), JSON.stringify({ name: 'dsh-community-tool', version: '1.2.3', description: 'A community tool' }));
    // non-plugin: directory without package.json — must be skipped
    const junk = join(modules, 'junk-dir');
    await mkdir(junk, { recursive: true });

    const items = await listInstalledPlugins();
    const bundledItem = items.find(item => item.name === 'dsh-archive-manager');
    const userItem = items.find(item => item.name === 'dsh-community-tool');
    assert.equal(bundledItem.source, 'bundled');
    assert.equal(userItem.source, 'user');
    assert.equal(userItem.version, '1.2.3');
    assert.equal(items.some(item => item.name === 'junk-dir'), false);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('ensurePnpmPath 在 PATH 已有 pnpm 时保持原 PATH', async () => {
  const previousHome = process.env.DSH_HOME;
  const previousPath = process.env.PATH;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-pnpm-'));
  process.env.DSH_HOME = dshHome;
  const bin = join(dshHome, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'pnpm'), '#!/bin/sh\n', { mode: 0o755 });
  process.env.PATH = bin;
  try {
    const [pathWithPnpm, note] = await ensurePnpmPath();
    assert.equal(pathWithPnpm, bin);
    assert.match(note, /found pnpm/);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    process.env.PATH = previousPath;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('ensurePnpmPath 无 pnpm 有 corepack 时创建转发 shim', async () => {
  const previousHome = process.env.DSH_HOME;
  const previousPath = process.env.PATH;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-pnpm2-'));
  process.env.DSH_HOME = dshHome;
  const bin = join(dshHome, 'fake-bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'corepack'), '#!/bin/sh\n', { mode: 0o755 });
  process.env.PATH = bin;
  try {
    const [pathWithPnpm, note] = await ensurePnpmPath();
    assert.match(note, /pnpm shim/);
    assert.ok(pathWithPnpm.startsWith(join(dshHome, 'pnpm-bin') + ':'));
    const shim = join(dshHome, 'pnpm-bin', 'pnpm');
    await access(shim);
    const content = await readFile(shim, 'utf8');
    assert.match(content, /corepack/);
    const stat = await import('node:fs').then(m => m.statSync(shim));
    assert.ok(stat.mode & 0o111);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    process.env.PATH = previousPath;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('ensurePnpmPath 无 pnpm 无 corepack 时保持原 PATH', async () => {
  const previousHome = process.env.DSH_HOME;
  const previousPath = process.env.PATH;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-pnpm3-'));
  process.env.DSH_HOME = dshHome;
  const bin = join(dshHome, 'empty-bin');
  await mkdir(bin, { recursive: true });
  process.env.PATH = bin;
  try {
    const [pathWithPnpm, note] = await ensurePnpmPath();
    assert.equal(pathWithPnpm, bin);
    assert.match(note, /pnpm unavailable/);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    process.env.PATH = previousPath;
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('hasCommandOnPath 只认可可执行文件', async () => {
  const previousPath = process.env.PATH;
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-pm-has-'));
  const bin = join(dshHome, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'executable-tool'), '#!/bin/sh\n', { mode: 0o755 });
  await writeFile(join(bin, 'non-executable-tool'), '#!/bin/sh\n');
  try {
    const hit = await hasCommandOnPath('executable-tool', bin);
    assert.equal(hit, join(bin, 'executable-tool'));
    assert.equal(await hasCommandOnPath('non-executable-tool', bin), null);
    assert.equal(await hasCommandOnPath('missing-tool', bin), null);
  } finally {
    process.env.PATH = previousPath;
    await rm(dshHome, { recursive: true, force: true });
  }
});
