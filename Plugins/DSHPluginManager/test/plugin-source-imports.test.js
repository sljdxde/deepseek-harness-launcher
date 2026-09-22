import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyPluginUpdate, findUnresolvableLocalImports } from '../lib/index.js';

// 「装之前先校验插件源码自己的 import 能不能落地」的离线单测。
// 起因：上游 OpenViking 把 dsh-memory-plugin 的 shared/ 改成 pack 时生成（不在 git 里），
// 子目录插件的 sparse clone 拿不到它，版本号复核看不出问题，用户下次重启 dsh 才整个起不来。

/** 在临时目录里铺一套插件源码：files 是 { 相对路径: 内容 }。 */
async function withFixture(files, fn) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pm-imports-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const abs = join(root, path);
      await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const described = missing => missing.map(item => `${item.importer} -> ${item.specifier}`);

test('源码自己的相对 import 都在时不报（含子目录与 ../ 回到包内的写法）', async () => {
  await withFixture({
    'package.json': '{"name":"p","version":"1.0.0"}',
    'client.mjs': `import { createOvHttp } from "./shared/ov-http.mjs";\nexport class C { f = createOvHttp }\n`,
    'shared/ov-http.mjs': 'export function createOvHttp() { return null }\n',
    'index.mjs': `import './client.mjs';\nimport { createOvHttp } from './shared/ov-http.mjs';\nexport default createOvHttp;\n`,
    'servers/mcp.mjs': `import '../shared/debug-log.mjs';\nexport const server = 1;\n`,
    'shared/debug-log.mjs': 'export const log = () => {}\n'
  }, async root => {
    assert.deepEqual(await findUnresolvableLocalImports(root), []);
  });
});

test('缺整个 shared/ 时逐条报出，引用方是包内相对路径（0.5.0 那次的真实形状）', async () => {
  await withFixture({
    'package.json': '{"name":"p","version":"0.5.0"}',
    'client.mjs': `import { createOvHttp } from "./shared/ov-http.mjs";\nexport const c = createOvHttp;\n`,
    'runtime.mjs': `import { isCaptureEnabled } from "./shared/capture-utils.mjs";\nimport { buildRecallBlock } from "./shared/recall-core.mjs";\nexport const r = [isCaptureEnabled, buildRecallBlock];\n`
  }, async root => {
    const missing = await findUnresolvableLocalImports(root);
    assert.deepEqual(described(missing), [
      'client.mjs -> ./shared/ov-http.mjs',
      'runtime.mjs -> ./shared/capture-utils.mjs',
      'runtime.mjs -> ./shared/recall-core.mjs'
    ]);
  });
});

test('静态 from、re-export、动态 import、裸副作用 import 四种写法都查', async () => {
  await withFixture({
    'a.mjs': `import { x } from './missing-a.mjs';\nexport const a = x;\n`,
    'b.mjs': `export { y } from './missing-b.mjs';\n`,
    'c.mjs': `const load = () => import('./missing-c.mjs');\nexport const c = load;\n`,
    'd.mjs': `import './missing-d.mjs';\nexport const d = 1;\n`
  }, async root => {
    assert.deepEqual(described(await findUnresolvableLocalImports(root)), [
      'a.mjs -> ./missing-a.mjs',
      'b.mjs -> ./missing-b.mjs',
      'c.mjs -> ./missing-c.mjs',
      'd.mjs -> ./missing-d.mjs'
    ]);
  });
});

test('不报的不是漏洞：裸包名、指向包外的相对路径、node: 内置', async () => {
  await withFixture({
    'index.mjs': [
      `import { LLM } from '@deepseek-ai/dsh-llm';`,
      `import { helper } from '../../outside-pkg/helper.mjs';`,
      `import { readFileSync } from 'node:fs';`,
      `export const all = [LLM, helper, readFileSync];`
    ].join('\n')
  }, async root => {
    assert.deepEqual(await findUnresolvableLocalImports(root), []);
  });
});

test('省略扩展名与目录 index 都能解析出来，不误报', async () => {
  await withFixture({
    'index.mjs': `import { a } from './lib/a.mjs';\nimport { b } from './lib/b';\nimport { c } from './lib/c/';\nexport const all = [a, b, c];\n`,
    'lib/a.mjs': 'export const a = 1\n',
    'lib/b.js': 'export const b = 1\n',
    'lib/c/index.ts': 'export const c = 1\n'
  }, async root => {
    assert.deepEqual(await findUnresolvableLocalImports(root), []);
  });
});

test('测试文件与 node_modules 里的缺失不拦更新（dsh 启动不加载它们）', async () => {
  await withFixture({
    'index.mjs': `import { a } from './a.mjs';\nexport const all = a;\n`,
    'a.mjs': 'export const a = 1\n',
    'index.test.mjs': `import { a } from './a.mjs';\nimport { fix } from './test-fixtures/missing.mjs';\nvoid [a, fix];\n`,
    'test/missing-side.mjs': `import { gone } from './gone.mjs';\nvoid gone;\n`,
    'node_modules/dep/index.mjs': `import { nope } from './nope.mjs';\nvoid nope;\n`
  }, async root => {
    assert.deepEqual(await findUnresolvableLocalImports(root), []);
  });
});

test('目录不存在或为空时返回空列表（不把更新误判成失败）', async () => {
  assert.deepEqual(await findUnresolvableLocalImports(join(tmpdir(), 'dsh-pm-no-such-dir')), []);
  await withFixture({ 'package.json': '{}' }, async root => {
    assert.deepEqual(await findUnresolvableLocalImports(root), []);
  });
});

// ---------------------------------------------------------------------------
// 更新流程接线：残缺克隆必须在 pnpm add 之前失败，并把 .bak 换回去
// ---------------------------------------------------------------------------

const BROKEN_SOURCE = {
  'package.json': '{"name":"repo","version":"1.1.0"}',
  'client.mjs': `import { createOvHttp } from './shared/ov-http.mjs';\nexport const c = createOvHttp;\n`
};

/** 铺一个 file: 克隆来源的更新现场（旧版本已装在 dir），在临时目录被清掉之前跑 body。 */
async function withFileSourceUpdate(fixtureFiles, body) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-apply-'));
  const previousHome = process.env.DSH_HOME;
  // DSH_HOME 也指到临时目录：收尾的版本复核会读 node_modules，不能碰真实 profile。
  process.env.DSH_HOME = home;
  try {
    const sourcesDir = join(home, 'plugin-sources');
    const dir = join(sourcesDir, 'owner-repo');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.js'), '// 旧版本', 'utf8');

    const commands = [];
    const source = {
      name: 'repo',
      kind: 'git',
      spec: `file:${dir}`,
      installedVersion: '1.0.0',
      installedCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      remote: { type: 'git', url: 'https://github.com/owner/repo.git', author: 'owner', repo: 'repo', subdir: 'examples/repo', dir }
    };
    await body({
      source,
      dir,
      sourcesDir,
      commands,
      apply: () => applyPluginUpdate(source, {
        check: async () => [{ status: 'update-available', latestVersion: '1.1.0' }],
        command: async args => { commands.push(args); },
        // 假 clone：按 fixture 把新源码目录重建出来（真 cloneToSources 要联网）。
        clone: async () => {
          await mkdir(dir, { recursive: true });
          for (const [path, content] of Object.entries(fixtureFiles)) {
            const abs = join(dir, path);
            await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
            await writeFile(abs, content, 'utf8');
          }
          return { ok: true, dest: dir, packageName: 'repo' };
        }
      })
    });
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
}

test('applyPluginUpdate：克隆出的源码缺模块 → 不 pnpm add、回滚旧版本、错误点名缺失模块', async () => {
  await withFileSourceUpdate(BROKEN_SOURCE, async ({ dir, sourcesDir, commands, apply }) => {
    let error = null;
    try {
      await apply();
    } catch (thrown) {
      error = thrown;
    }
    assert.ok(error, '残缺源码必须让更新失败');
    assert.match(error.message, /\.\/shared\/ov-http\.mjs/);
    assert.match(error.message, /client\.mjs/);
    assert.match(error.message, /dsh 起不来/);
    // profile 一行都没动：没跑 pnpm，旧源码原样回来，没有 .bak 残留
    assert.deepEqual(commands, []);
    assert.equal(await readFile(join(dir, 'index.js'), 'utf8'), '// 旧版本');
    assert.deepEqual((await readdir(sourcesDir)).filter(name => name.includes('.bak-')), []);
  });
});

test('applyPluginUpdate：克隆出的源码完整 → 照常同步 profile', async () => {
  await withFileSourceUpdate({
    ...BROKEN_SOURCE,
    'shared/ov-http.mjs': 'export function createOvHttp() { return null }\n'
  }, async ({ dir, commands, apply }) => {
    const result = await apply();
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', `file:${dir}`]]);
  });
});
