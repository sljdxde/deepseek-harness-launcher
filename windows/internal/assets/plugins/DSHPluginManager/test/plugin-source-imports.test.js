import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyPluginUpdate, findUnresolvableLocalImports, missingPackageEntries, prepareClonedSource } from '../lib/index.js';

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
async function withFileSourceUpdate(fixtureFiles, body, applyOptions = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pm-apply-'));
  const previousHome = process.env.DSH_HOME;
  // DSH_HOME 也指到临时目录：收尾的版本复核会读 node_modules，不能碰真实 profile。
  process.env.DSH_HOME = home;
  try {
    // 与真实布局一致：file: 克隆来源在 $DSH_HOME/profiles/web/plugin-sources，
    // dev-linked 守卫（applyPluginUpdate）只放行这里的目录。
    const sourcesDir = join(home, 'profiles', 'web', 'plugin-sources');
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
        },
        ...applyOptions
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

// ---------------------------------------------------------------------------
// 入口文件（main / exports['./client']）校验与「缺构建产物先构建」：
// 用户实测 dsh-genui 从 git 源码装进来缺 lib/index.js，dsh 启动时整条 entry
// 加载失败，dsh-ui 围栏退化成普通代码块，而插件管理里还显示「已安装」。
// ---------------------------------------------------------------------------

test('missingPackageEntries：main / exports["./client"] 指向的文件缺了就报，出界入口不报', async () => {
  await withFixture({
    'package.json': JSON.stringify({
      name: 'demo',
      main: 'lib/index.js',
      exports: { './client': { types: './lib/client.d.ts', default: './lib/client.js' } }
    })
  }, async root => {
    assert.deepEqual(await missingPackageEntries(root), ['lib/index.js', './lib/client.js']);
    await mkdir(join(root, 'lib'), { recursive: true });
    await writeFile(join(root, 'lib', 'index.js'), 'export default 1\n', 'utf8');
    // client 用 .mjs 也应按 node 解析规则认（不误报）
    await writeFile(join(root, 'lib', 'client.mjs'), 'export default 1\n', 'utf8');
    assert.deepEqual(await missingPackageEntries(root), ['./lib/client.js'],
      '声明的路径不存在就报，哪怕同目录另有 .mjs');
    // 出界入口不是包自己的文件，不归这里管
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', main: '../outside/index.js' }), 'utf8');
    assert.deepEqual(await missingPackageEntries(root), []);
  });
});

test('prepareClonedSource：入口缺失先构建；构建后仍缺就拒绝（绝不装进 profile）', async () => {
  await withFixture({
    'package.json': JSON.stringify({ name: 'demo', main: 'lib/index.js', exports: { './client': { default: './lib/client.js' } } }),
    'src/index.ts': 'export const a = 1;\n'
  }, async root => {
    // 构建没产出入口 → 拒绝，错误要点名缺失文件
    const refused = await prepareClonedSource(root, { runBuild: async () => ({ ok: true }) });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /仍缺入口文件/);
    assert.match(refused.error, /lib\/index\.js/);

    // 构建失败 → 如实上报失败原因
    const failed = await prepareClonedSource(root, { runBuild: async () => ({ ok: false, error: 'tsc 报错' }) });
    assert.equal(failed.ok, false);
    assert.match(failed.error, /构建失败/);
    assert.match(failed.error, /tsc 报错/);

    // 构建产出入口 → 放行并标记 built
    const accepted = await prepareClonedSource(root, {
      runBuild: async () => {
        await mkdir(join(root, 'lib'), { recursive: true });
        await writeFile(join(root, 'lib', 'index.js'), 'export default 1\n', 'utf8');
        await writeFile(join(root, 'lib', 'client.js'), 'export default 1\n', 'utf8');
        return { ok: true };
      }
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.built, true);

    // 入口已经齐了就不再构建（避免每次都装一遍 devDependencies）
    let builds = 0;
    const skipped = await prepareClonedSource(root, { runBuild: async () => { builds += 1; return { ok: true }; } });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.built, false);
    assert.equal(builds, 0);
  });
});

test('applyPluginUpdate：克隆源码声明了 main 但缺构建产物 → 先构建再 pnpm add file:', async () => {
  await withFileSourceUpdate({
    'package.json': JSON.stringify({ name: 'repo', version: '1.1.0', main: 'lib/index.js' })
  }, async ({ dir, commands, apply }) => {
    const result = await apply();
    assert.equal(result.ok, true);
    assert.deepEqual(commands, [['add', `file:${dir}`]]);
  }, {
    prepare: async preparedDir => {
      await mkdir(join(preparedDir, 'lib'), { recursive: true });
      await writeFile(join(preparedDir, 'lib', 'index.js'), 'export default 1\n', 'utf8');
      return { ok: true, built: true };
    }
  });
});

test('applyPluginUpdate：构建后仍缺入口 → 不 pnpm add、回滚旧源码、错误说明', async () => {
  await withFileSourceUpdate({
    'package.json': JSON.stringify({ name: 'repo', version: '1.1.0', main: 'lib/index.js' })
  }, async ({ dir, sourcesDir, commands, apply }) => {
    let error = null;
    try { await apply(); } catch (thrown) { error = thrown; }
    assert.ok(error, '缺入口的包不能装进 profile');
    assert.match(error.message, /缺入口文件/);
    // profile 一行都没动：没跑 pnpm add，旧源码原样回来，没有 .bak 残留
    assert.deepEqual(commands, []);
    assert.equal(await readFile(join(dir, 'index.js'), 'utf8'), '// 旧版本');
    assert.deepEqual((await readdir(sourcesDir)).filter(name => name.includes('.bak-')), []);
  }, {
    prepare: async () => ({ ok: false, error: '插件构建后仍缺入口文件 lib/index.js，已拒绝安装' })
  });
});

test('missingPackageEntries：只声明 exports（无 main）的包也要校验，嵌套 condition 能取到目标', async () => {
  await withFixture({
    'package.json': JSON.stringify({ name: 'demo', exports: { '.': { types: './lib/index.d.ts', node: { import: './lib/index.js' } } } })
  }, async root => {
    assert.deepEqual(await missingPackageEntries(root), ['./lib/index.js'], 'exports["."] 缺入口同样要报');
    await mkdir(join(root, 'lib'), { recursive: true });
    await writeFile(join(root, 'lib', 'index.js'), 'export default 1\n', 'utf8');
    assert.deepEqual(await missingPackageEntries(root), []);
    // 顶层字符串 exports 等价于 exports["."]
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'demo', exports: './main.js' }), 'utf8');
    assert.deepEqual(await missingPackageEntries(root), ['./main.js']);
  });
});
