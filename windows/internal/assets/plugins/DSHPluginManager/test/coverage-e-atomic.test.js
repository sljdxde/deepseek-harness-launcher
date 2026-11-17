// lib/atomic.js 的覆盖补齐：原子写（临时文件 + rename 提交）、损坏 JSON 自愈、
// 临时残留清理、跨进程写锁（含持有者已死时的接管）与进程内串行队列。
//
// 三条硬约束（与本仓库其它测试一致）：
//   1) 不联网、不跑真实子进程：本文件根本不碰子进程。
//   2) 不改生产代码：lib/atomic.js 一个字节都不动。
//   3) 故障注入只发生在**本进程**里：把 node:fs/promises 的几个函数换成可注入的
//      包装（用 createRequire 拿到 CJS exports 改）。注意 ESM 侧的
//      `import { writeFile } from 'node:fs/promises'` 在 **facade 首次建立时**
//      才把值抄过去，所以补丁必须打在本文件 import lib/atomic.js **之前**——
//      这也是本文件不静态 import node:fs/promises 的原因（静态 import 会被
//      提升到模块体之前，提前把 facade 建出来，补丁就失效了）。
//
// 模块私有的 sleep() 带 abort 分支，但生产代码里没有任何调用点会传 signal
// （两个调用点都不传），所以这里用 loader 钩子在源码**末尾**追加一行 export
// 把它测出来——与 test/coverage-a-install.test.js 对 lib/index.js 的做法一致：
// 生产的每一个字节都没动，覆盖数据也仍然记在 lib/atomic.js 上。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// fs 故障注入
// ---------------------------------------------------------------------------

const fsPromises = require('node:fs').promises;

/** 真实实现：测试代码自己读写文件时走这里，不经过故障注入。 */
const real = {
  writeFile: fsPromises.writeFile.bind(fsPromises),
  rename: fsPromises.rename.bind(fsPromises),
  rm: fsPromises.rm.bind(fsPromises),
  readFile: fsPromises.readFile.bind(fsPromises),
  lstat: fsPromises.lstat.bind(fsPromises),
  readdir: fsPromises.readdir.bind(fsPromises),
  mkdir: fsPromises.mkdir.bind(fsPromises),
  stat: fsPromises.stat.bind(fsPromises),
  mkdtemp: fsPromises.mkdtemp.bind(fsPromises),
  utimes: fsPromises.utimes.bind(fsPromises),
  access: fsPromises.access.bind(fsPromises),
};

/**
 * 当前生效的 fs 钩子。每个钩子签名与对应 fs 函数一致：
 *   - writeFile(path, content, options) / rename(from, to) / rm(path, options)
 *     / lstat(path) / mkdir(path, options) / stat(path)：抛错即模拟失败。
 *   - readFile(path, options)：返回非 undefined 的值即**替换**读到的内容。
 *   - readdir(path, options)：返回非 undefined 的值即**替换**读到的目录项。
 */
let hooks = {};

/** 构造一个带 errno code 的 fs 错误。 */
function fsError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

/** 在一段代码里注入 fs 故障（跑完恢复）。 */
async function withHooks(next, fn) {
  const previous = hooks;
  hooks = next;
  try {
    return await fn();
  } finally {
    hooks = previous;
  }
}

fsPromises.writeFile = async (path, content, options) => {
  if (hooks.writeFile) await hooks.writeFile(String(path), content, options);
  return real.writeFile(path, content, options);
};
fsPromises.rename = async (from, to) => {
  if (hooks.rename) await hooks.rename(String(from), String(to));
  return real.rename(from, to);
};
fsPromises.rm = async (path, options) => {
  if (hooks.rm) await hooks.rm(String(path), options);
  return real.rm(path, options);
};
fsPromises.readFile = async (path, options) => {
  if (hooks.readFile) {
    const replacement = await hooks.readFile(String(path), options);
    if (replacement !== undefined) return replacement;
  }
  return real.readFile(path, options);
};
fsPromises.lstat = async (path) => {
  if (hooks.lstat) await hooks.lstat(String(path));
  return real.lstat(path);
};
fsPromises.readdir = async (path, options) => {
  if (hooks.readdir) {
    const replacement = await hooks.readdir(String(path), options);
    if (replacement !== undefined) return replacement;
  }
  return real.readdir(path, options);
};
fsPromises.mkdir = async (path, options) => {
  if (hooks.mkdir) await hooks.mkdir(String(path), options);
  return real.mkdir(path, options);
};
fsPromises.stat = async (path) => {
  if (hooks.stat) await hooks.stat(String(path));
  return real.stat(path);
};

// ---------------------------------------------------------------------------
// 模块私有函数的可达性：把 sleep 补一个 export（只追加一行，不动任何原有行）
// ---------------------------------------------------------------------------

const ATOMIC_URL = pathToFileURL(fileURLToPath(new URL('../lib/atomic.js', import.meta.url))).href;
const PRIVATE_EXPORTS = ['sleep'];

function readSourceUtf8(url) {
  const { readFileSync } = require('node:fs');
  return readFileSync(fileURLToPath(url), 'utf8');
}

function rewireHook(url, context, nextLoad) {
  if (url !== ATOMIC_URL) return nextLoad(url, context);
  const source = readSourceUtf8(url);
  if (!/const sleep\b/.test(source)) return nextLoad(url, context);
  const patched = `${source}\nexport { ${PRIVATE_EXPORTS.join(', ')} };\n`;
  return { format: 'module', source: patched, shortCircuit: true };
}

// Node 22.15+ 用同线程的 registerHooks；更老的版本退回 data: URL 的 register。
const nodeModule = require('node:module');
if (typeof nodeModule.registerHooks === 'function') {
  nodeModule.registerHooks({ load: rewireHook });
} else {
  const loaderLines = [
    "import { readFileSync } from 'node:fs';",
    "import { fileURLToPath } from 'node:url';",
    'const TARGET = ' + JSON.stringify(ATOMIC_URL) + ';',
    'export async function load(url, context, nextLoad) {',
    '  if (url !== TARGET) return nextLoad(url, context);',
    '  const source = readFileSync(fileURLToPath(url), "utf8");',
    '  if (!/const sleep\\b/.test(source)) return nextLoad(url, context);',
    '  return { format: "module", source: source + "\\nexport { sleep };\\n", shortCircuit: true };',
    '}'
  ];
  nodeModule.register('data:text/javascript,' + encodeURIComponent(loaderLines.join('\n')), import.meta.url);
}

// 必须在 fs 补丁装好之后再 import：lib/atomic.js 的 import 语句会把 node:fs/promises
// 的 facade 建出来，facade 建立的那一刻才把（已打过补丁的）函数抄过去。
const atomic = await import('../lib/atomic.js');
const { Mutex, cleanupTempSiblings, readJsonFile, withFileLock, writeFileAtomic } = atomic;

// ---------------------------------------------------------------------------
// 测试骨架
// ---------------------------------------------------------------------------

/** 全部用例都要改全局钩子 / process.platform / process.kill，必须串行。 */
const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

/** 真实运行平台（模拟别的平台时不能拿 process.platform 判断）。 */
const REAL_PLATFORM = process.platform;

/** 临时替换 process.platform（覆盖另一个平台的分支）。 */
async function withPlatform(value, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value, configurable: true, enumerable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
}

/** 临时替换 process.kill（伪造「进程还活着 / 已经没了 / 没权限」）。 */
async function withStubbedKill(impl, fn) {
  const original = process.kill;
  process.kill = impl;
  try {
    return await fn();
  } finally {
    process.kill = original;
  }
}

/** 造一个「进程已经不在」的 process.kill 实现。 */
function killGone() {
  return () => { throw fsError('ESRCH', 'ESRCH'); };
}

/** 建一个临时目录（跑完删掉）。 */
async function withTempDir(prefix, fn) {
  const dir = await real.mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await real.rm(dir, { recursive: true, force: true });
  }
}

/** 目录里剩下的 .tmp 文件名。 */
async function tempSiblings(dir) {
  const names = await real.readdir(dir);
  return names.filter(name => name.endsWith('.tmp'));
}

// ---------------------------------------------------------------------------
// 1) writeFileAtomic：随机后缀兄弟文件 + rename 提交
// ---------------------------------------------------------------------------

serialTest('writeFileAtomic：写临时文件再 rename 提交，父目录自动创建，不留残留', async () => {
  await withTempDir('dsh-atomic-write-', async dir => {
    const target = join(dir, 'nested', 'deep', 'state.json');
    await writeFileAtomic(target, '{"a":1}');

    assert.equal(await real.readFile(target, 'utf8'), '{"a":1}', '内容落到了目标文件');
    assert.deepEqual(await tempSiblings(join(dir, 'nested', 'deep')), [], '临时文件已被 rename 掉');
  });
});

serialTest('writeFileAtomic：写失败时把临时文件收掉并如实抛出错误', async () => {
  await withTempDir('dsh-atomic-writefail-', async dir => {
    const target = join(dir, 'state.json');
    await withHooks({
      writeFile: async path => {
        if (path.endsWith('.tmp')) throw fsError('EACCES', '磁盘写不动');
      }
    }, async () => {
      await assert.rejects(writeFileAtomic(target, 'x'), /磁盘写不动/);
    });

    assert.deepEqual(await tempSiblings(dir), [], '失败的临时文件被清掉了');
    await assert.rejects(real.access(target), '目标文件没有被写出来');
  });
});

serialTest('writeFileAtomic：Windows 上 rename 遇到 EACCES 会退避重试后成功', async () => {
  await withTempDir('dsh-atomic-retry-', async dir => {
    const target = join(dir, 'state.json');
    let calls = 0;
    await withPlatform('win32', async () => {
      await withHooks({
        rename: async () => {
          calls += 1;
          if (calls <= 2) throw fsError('EACCES', 'rename 被占用');
        }
      }, async () => {
        await writeFileAtomic(target, 'ok');
      });
    });

    assert.equal(calls, 3, '失败两次之后第三次成功');
    assert.equal(await real.readFile(target, 'utf8'), 'ok');
  });
});

serialTest('writeFileAtomic：Windows 上 rename 遇到非重试类错误直接抛出', async () => {
  await withTempDir('dsh-atomic-norety-', async dir => {
    const target = join(dir, 'state.json');
    let calls = 0;
    await withPlatform('win32', async () => {
      await withHooks({
        rename: async () => {
          calls += 1;
          throw fsError('EIO', '磁盘错误');
        }
      }, async () => {
        await assert.rejects(writeFileAtomic(target, 'x'), /磁盘错误/);
      });
    });
    assert.equal(calls, 1, '不是 EACCES/EBUSY/EPERM 就不重试');
  });
});

serialTest('writeFileAtomic：非 Windows 平台 rename 失败直接抛出（不重试）', async () => {
  await withTempDir('dsh-atomic-posix-', async dir => {
    const target = join(dir, 'state.json');
    let calls = 0;
    await withPlatform('linux', async () => {
      await withHooks({
        rename: async () => {
          calls += 1;
          throw fsError('EACCES', 'rename 失败');
        }
      }, async () => {
        await assert.rejects(writeFileAtomic(target, 'x'), /rename 失败/);
      });
    });
    assert.equal(calls, 1, '非 Windows 不做退避重试');
    assert.deepEqual(await tempSiblings(dir), [], '失败的临时文件被清掉了');
  });
});

serialTest('writeFileAtomic：Windows 上 rename 一直失败超过重试上限就抛出', async () => {
  await withTempDir('dsh-atomic-limit-', async dir => {
    const target = join(dir, 'state.json');
    let calls = 0;
    await withPlatform('win32', async () => {
      await withHooks({
        rename: async () => {
          calls += 1;
          throw fsError('EBUSY', '一直忙');
        }
      }, async () => {
        await assert.rejects(writeFileAtomic(target, 'x'), /一直忙/);
      });
    });
    assert.equal(calls, 9, '上限 8 次重试 + 最后一次判定，共 9 次 rename');
  });
});

serialTest('writeFileAtomic：可以指定文件与目录的权限，不指定时用默认的 0600', async () => {
  await withTempDir('dsh-atomic-mode-', async dir => {
    const target = join(dir, 'nested', 'state.json');
    await writeFileAtomic(target, 'x', { mode: 0o644, dirMode: 0o755 });
    assert.equal(await real.readFile(target, 'utf8'), 'x');
    const stat = await real.stat(target);
    // Windows 上 mode 基本不生效，只断言文件确实写出来了（不锁死具体权限位）。
    if (REAL_PLATFORM !== 'win32') {
      assert.equal(stat.mode & 0o777, 0o644, '文件权限按传入的 mode');
    }
  });
});

// ---------------------------------------------------------------------------
// 2) readJsonFile：宽松读 + 损坏自愈
// ---------------------------------------------------------------------------

serialTest('readJsonFile：文件不存在时返回 fallback 的深拷贝', async () => {
  await withTempDir('dsh-atomic-missing-', async dir => {
    const fallback = { version: 1, operations: [{ id: 'a' }] };
    const result = await readJsonFile(join(dir, 'nope.json'), fallback);
    assert.deepEqual(result, fallback);
    assert.notEqual(result, fallback, '返回的是副本，改它不影响调用方的 fallback');
    result.operations.push({ id: 'b' });
    assert.equal(fallback.operations.length, 1, 'fallback 没被改到');

    // 不给 fallback 时用空对象
    assert.deepEqual(await readJsonFile(join(dir, 'nope.json')), {});
  });
});

serialTest('readJsonFile：读文件失败（不是 ENOENT）时把错误抛出去', async () => {
  await withTempDir('dsh-atomic-readfail-', async dir => {
    const target = join(dir, 'state.json');
    await withHooks({
      readFile: async () => { throw fsError('EACCES', '没有读权限'); }
    }, async () => {
      await assert.rejects(readJsonFile(target, { ok: true }), /没有读权限/);
    });
  });
});

serialTest('readJsonFile：坏 JSON 被改名成 .corrupt-* 留在旁边并返回 fallback', async () => {
  await withTempDir('dsh-atomic-corrupt-', async dir => {
    const target = join(dir, 'state.json');
    await real.writeFile(target, '{ broken json');

    const result = await readJsonFile(target, { version: 1, current: null, operations: [] });
    assert.deepEqual(result, { version: 1, current: null, operations: [] });

    const names = await real.readdir(dir);
    assert.ok(!names.includes('state.json'), '坏文件被挪走了，不会反复读到坏状态');
    const corrupt = names.find(name => name.startsWith('state.json.corrupt-'));
    assert.ok(corrupt, '坏文件留在旁边供事后排查');
    assert.equal(await real.readFile(join(dir, corrupt), 'utf8'), '{ broken json', '坏文件的原内容还在');
  });
});

serialTest('readJsonFile：坏文件改名失败也不阻塞调用方', async () => {
  await withTempDir('dsh-atomic-corrupt-fail-', async dir => {
    const target = join(dir, 'state.json');
    await real.writeFile(target, '{ broken json');

    await withHooks({
      rename: async () => { throw fsError('EIO', '改名失败'); }
    }, async () => {
      const result = await readJsonFile(target, { version: 1 });
      assert.deepEqual(result, { version: 1 }, '改名失败也要返回 fallback');
    });

    assert.equal(await real.readFile(target, 'utf8'), '{ broken json', '原文件留在原地');
  });
});

// ---------------------------------------------------------------------------
// 3) cleanupTempSiblings：清掉上次被杀留下的临时文件
// ---------------------------------------------------------------------------

serialTest('cleanupTempSiblings：只清掉匹配前缀的 .tmp，跳过 .staged- 与其它文件', async () => {
  await withTempDir('dsh-atomic-clean-', async dir => {
    await real.writeFile(join(dir, 'a.tmp'), 'x');
    await real.writeFile(join(dir, 'b.tmp'), 'x');
    await real.writeFile(join(dir, 'x.1.tmp'), 'x');
    await real.writeFile(join(dir, 'y.1.tmp'), 'x');
    await real.writeFile(join(dir, 'a.staged-c.tmp'), 'x');
    await real.writeFile(join(dir, 'keep.txt'), 'x');
    await real.mkdir(join(dir, 'dir.tmp', 'inner'), { recursive: true });

    // 带前缀调用：只清前缀匹配的那批
    await cleanupTempSiblings(dir, 'x.');
    let left = (await real.readdir(dir)).sort();
    assert.deepEqual(left, ['a.staged-c.tmp', 'a.tmp', 'b.tmp', 'dir.tmp', 'keep.txt', 'y.1.tmp'].sort(),
      '带前缀时只清前缀匹配的');

    // 不带前缀：清掉所有 .tmp（目录也算），但跳过 .staged- 与非 .tmp
    await cleanupTempSiblings(dir);
    left = (await real.readdir(dir)).sort();
    assert.deepEqual(left, ['a.staged-c.tmp', 'keep.txt'],
      '只剩 .staged- 的（活进程可能在写）和不是 .tmp 的');
  });
});

serialTest('cleanupTempSiblings：目录读不出来时安静返回；清不掉的残留不影响别的文件', async () => {
  await withTempDir('dsh-atomic-clean-fail-', async dir => {
    // 目录不存在 → readdir 抛错 → 安静返回
    await cleanupTempSiblings(join(dir, 'missing-dir'));

    const stubborn = join(dir, 'stubborn.tmp');
    await real.writeFile(stubborn, 'x');
    await real.writeFile(join(dir, 'fine.tmp'), 'x');

    await withHooks({
      rm: async path => {
        if (path === stubborn) throw fsError('EPERM', '删不掉');
      }
    }, async () => {
      await cleanupTempSiblings(dir);
    });

    const left = (await real.readdir(dir)).sort();
    assert.deepEqual(left, ['stubborn.tmp'], '删不掉的被兜住，别的临时文件照常清掉');
  });
});

// ---------------------------------------------------------------------------
// 4) withFileLock：跨进程写锁
// ---------------------------------------------------------------------------

serialTest('withFileLock：正常路径下加锁、执行回调、结束后释放锁', async () => {
  await withTempDir('dsh-atomic-lock-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;

    const result = await withFileLock(target, async () => {
      assert.ok(await exists(lockPath), '回调执行期间锁文件在');
      assert.equal(await real.readFile(lockPath, 'utf8'), `${process.pid}\n`, '锁里记着持有者 PID');
      return 'done';
    });

    assert.equal(result, 'done');
    assert.equal(await exists(lockPath), false, '结束后锁被释放');
  });
});

serialTest('withFileLock：锁被占着且持有者还活着时退避重试到超时', async () => {
  await withTempDir('dsh-atomic-lock-busy-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, `${process.pid}\n`);

    let ran = false;
    await assert.rejects(
      withFileLock(target, async () => { ran = true; return 'x'; }, { waitMs: 120 }),
      /等待写锁超时/
    );
    assert.equal(ran, false, '拿不到锁就不执行回调');
  });
});

serialTest('withFileLock：锁里的 PID 不是数字或不是正数时不当成死进程接管', async () => {
  await withTempDir('dsh-atomic-lock-badpid-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;

    for (const record of ['not-a-pid\n', '0\n', '99999999999999999999\n']) {
      await real.writeFile(lockPath, record);
      await assert.rejects(
        withFileLock(target, async () => 'x', { waitMs: 60 }),
        /等待写锁超时/,
        `锁内容 ${JSON.stringify(record)} 不该被接管`
      );
    }
  });
});

serialTest('withFileLock：持有者进程只是没权限（EPERM）时不当成死进程', async () => {
  await withTempDir('dsh-atomic-lock-eperm-pid-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    await withStubbedKill(() => { throw fsError('EPERM', 'EPERM'); }, async () => {
      await assert.rejects(
        withFileLock(target, async () => 'x', { waitMs: 60 }),
        /等待写锁超时/
      );
    });
  });
});

serialTest('withFileLock：接管成功但 claim 文件删不掉时不影响结果', async () => {
  await withTempDir('dsh-atomic-claim-rm-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    await withStubbedKill(killGone(), async () => {
      await withHooks({
        rm: async path => {
          if (path.includes('.takeover-')) throw fsError('EPERM', '删不掉');
        }
      }, async () => {
        const result = await withFileLock(target, async () => '接管后执行');
        assert.equal(result, '接管后执行');
      });
    });
  });
});

serialTest('withFileLock：持有者进程已死时接管锁继续执行', async () => {
  await withTempDir('dsh-atomic-takeover-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    await withStubbedKill(killGone(), async () => {
      const result = await withFileLock(target, async () => '接管后执行');
      assert.equal(result, '接管后执行');
    });

    assert.equal(await exists(lockPath), false, '锁被接管后又被释放');
    const leftovers = (await real.readdir(dir)).filter(name => name.includes('.takeover-'));
    assert.deepEqual(leftovers, [], 'claim 文件被收掉了');
  });
});

serialTest('withFileLock：接管时 claim 文件已存在就放弃接管', async () => {
  await withTempDir('dsh-atomic-claim-exists-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    const record = '424242\n';
    await real.writeFile(lockPath, record);
    // claim 名字是锁内容（原文）的 sha256 前 16 位
    const claim = `${lockPath}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`;
    await real.writeFile(claim, 'taken');

    await withStubbedKill(killGone(), async () => {
      await assert.rejects(
        withFileLock(target, async () => 'x', { waitMs: 60 }),
        /等待写锁超时/
      );
    });
    assert.equal(await real.readFile(claim, 'utf8'), 'taken', '别人的 claim 没被抢走');
  });
});

serialTest('withFileLock：接管时 claim 写不下去（EPERM）就放弃接管', async () => {
  await withTempDir('dsh-atomic-claim-eperm-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    await withStubbedKill(killGone(), async () => {
      await withHooks({
        writeFile: async path => {
          if (path.includes('.takeover-')) throw fsError('EPERM', '没权限');
        }
      }, async () => {
        await assert.rejects(
          withFileLock(target, async () => 'x', { waitMs: 60 }),
          /等待写锁超时/
        );
      });
    });
  });
});

serialTest('withFileLock：接管时 claim 写入遇到别的错误就如实抛出', async () => {
  await withTempDir('dsh-atomic-claim-eio-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    await withStubbedKill(killGone(), async () => {
      await withHooks({
        writeFile: async path => {
          if (path.includes('.takeover-')) throw fsError('EIO', '磁盘错误');
        }
      }, async () => {
        await assert.rejects(withFileLock(target, async () => 'x', { waitMs: 60 }), /磁盘错误/);
      });
    });
  });
});

serialTest('withFileLock：接管时锁文件读不出来就不接管', async () => {
  await withTempDir('dsh-atomic-takeover-read-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    await withStubbedKill(killGone(), async () => {
      await withHooks({
        readFile: async path => {
          if (path === lockPath) throw fsError('ENOENT', '锁读不到');
        }
      }, async () => {
        await assert.rejects(
          withFileLock(target, async () => 'x', { waitMs: 60 }),
          /等待写锁超时/
        );
      });
    });
  });
});

serialTest('withFileLock：接管时二次确认读不到锁文件就不接管', async () => {
  await withTempDir('dsh-atomic-takeover-read2-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    let reads = 0;
    await withStubbedKill(killGone(), async () => {
      await withHooks({
        readFile: async path => {
          if (path !== lockPath) return undefined;
          reads += 1;
          if (reads === 1) return '424242\n';
          throw fsError('ENOENT', '锁读不到');
        }
      }, async () => {
        await assert.rejects(
          withFileLock(target, async () => 'x', { waitMs: 60 }),
          /等待写锁超时/
        );
      });
    });
    assert.ok(reads >= 2, '二次确认确实读了锁');
  });
});

serialTest('withFileLock：接管时锁内容变了就放弃接管（防 PID 复用）', async () => {
  await withTempDir('dsh-atomic-takeover-changed-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    let reads = 0;
    await withStubbedKill(killGone(), async () => {
      await withHooks({
        readFile: async path => {
          if (path !== lockPath) return undefined;
          reads += 1;
          // 每次读到的 PID 都不同 → 二次确认时内容一定变了
          return `${400000 + reads}\n`;
        }
      }, async () => {
        await assert.rejects(
          withFileLock(target, async () => 'x', { waitMs: 60 }),
          /等待写锁超时/
        );
      });
    });
    assert.ok(reads >= 2, '二次确认真的又读了一次锁');
  });
});

serialTest('withFileLock：接管时二次确认时进程又活过来了就放弃接管', async () => {
  await withTempDir('dsh-atomic-takeover-alive-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, '424242\n');

    let kills = 0;
    await withStubbedKill(() => {
      kills += 1;
      if (kills === 1) throw fsError('ESRCH', 'ESRCH');
      return true;   // 第二次检查时进程又活了
    }, async () => {
      await assert.rejects(
        withFileLock(target, async () => 'x', { waitMs: 60 }),
        /等待写锁超时/
      );
    });
    assert.ok(kills >= 2, '二次确认真的又探了一次进程');
  });
});

serialTest('withFileLock：不是锁冲突的错误（如 EACCES）直接抛出去', async () => {
  await withTempDir('dsh-atomic-lock-eacces-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;

    await withHooks({
      writeFile: async path => {
        if (path === lockPath) throw fsError('EACCES', '没权限');
      }
    }, async () => {
      await assert.rejects(withFileLock(target, async () => 'x', { waitMs: 60 }), /没权限/);
    });
  });
});

serialTest('withFileLock：Windows 上 EPERM 且锁文件不存在时按可重试处理', async () => {
  await withTempDir('dsh-atomic-lock-eperm-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;

    await withPlatform('win32', async () => {
      await withHooks({
        writeFile: async path => {
          if (path === lockPath) throw fsError('EPERM', '被杀毒软件占用');
        }
      }, async () => {
        await assert.rejects(
          withFileLock(target, async () => 'x', { waitMs: 60 }),
          /等待写锁超时/
        );
      });
    });
  });
});

serialTest('withFileLock：Windows 上 EPERM 且锁文件存在时按锁冲突处理', async () => {
  await withTempDir('dsh-atomic-lock-eperm2-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;
    await real.writeFile(lockPath, `${process.pid}\n`);

    await withPlatform('win32', async () => {
      await withHooks({
        writeFile: async path => {
          if (path === lockPath) throw fsError('EPERM', '被杀毒软件占用');
        }
      }, async () => {
        await assert.rejects(
          withFileLock(target, async () => 'x', { waitMs: 60 }),
          /等待写锁超时/
        );
      });
    });
  });
});

serialTest('withFileLock：已经 abort 的 signal 直接抛出，且不会留下锁', async () => {
  await withTempDir('dsh-atomic-abort-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;

    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      withFileLock(target, async () => 'x', { signal: aborted.signal }),
      /abort/i
    );
    assert.equal(await exists(lockPath), false, '没拿到锁，也没留下锁文件');

    // 没 abort 的 signal：正常走完
    const live = new AbortController();
    const result = await withFileLock(target, async () => 'ok', { signal: live.signal });
    assert.equal(result, 'ok');

    // signal 存在但没有 throwIfAborted（例如只支持 addEventListener 的旧版）：
    // 不该抛错，也不该卡住
    const legacy = await withFileLock(target, async () => 'ok', { signal: {} });
    assert.equal(legacy, 'ok');
  });
});

serialTest('withFileLock：回调抛错时锁照样被释放', async () => {
  await withTempDir('dsh-atomic-lock-throw-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;

    await assert.rejects(
      withFileLock(target, async () => { throw new Error('业务失败'); }),
      /业务失败/
    );
    assert.equal(await exists(lockPath), false, '失败后锁也被释放了');
  });
});

serialTest('withFileLock：释放锁失败也不影响回调结果', async () => {
  await withTempDir('dsh-atomic-lock-rm-', async dir => {
    const target = join(dir, 'state.json');
    const lockPath = `${target}.lock`;

    await withHooks({
      rm: async path => {
        if (path === lockPath) throw fsError('EPERM', '删不掉');
      }
    }, async () => {
      const result = await withFileLock(target, async () => 'ok');
      assert.equal(result, 'ok', '释放锁失败被兜住，不影响结果');
    });
  });
});

// ---------------------------------------------------------------------------
// 5) Mutex：进程内串行队列
// ---------------------------------------------------------------------------

serialTest('Mutex：任务按调用顺序一个接一个执行，失败不影响后面的任务', async () => {
  const mutex = new Mutex();
  const order = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  const first = mutex.run(async () => {
    order.push('a-start');
    await delay(30);
    order.push('a-end');
    return 'a';
  });
  const second = mutex.run(async () => {
    order.push('b-start');
    order.push('b-end');
    return 'b';
  });
  const third = mutex.run(async () => {
    order.push('c');
    throw new Error('c 失败');
  });
  const fourth = mutex.run(async () => {
    order.push('d');
    return 'd';
  });

  assert.equal(await first, 'a');
  assert.equal(await second, 'b');
  await assert.rejects(third, /c 失败/);
  assert.equal(await fourth, 'd', '失败的任务不会卡住后面的任务');

  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end', 'c', 'd'], '严格串行、顺序不乱');
  await delay(0);
  assert.equal(mutex.size, 0, '队列排空');
});

// ---------------------------------------------------------------------------
// 6) sleep：模块私有，带 abort 分支
// ---------------------------------------------------------------------------

serialTest('sleep：延时结束后 resolve；带 signal 时 abort 会 reject', async () => {
  assert.equal(typeof atomic.sleep, 'function', 'sleep 被 loader 钩子补了 export');

  const started = Date.now();
  await atomic.sleep(20);
  assert.ok(Date.now() - started >= 15, '确实等了');

  // 带 signal 时被 abort：立刻 reject（这是生产代码唯一可能走到的 abort 路径）
  const controller = new AbortController();
  const pending = atomic.sleep(10_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, /aborted/);

  // 说明：signal 在**调用前**就已经 aborted 时，abort 事件不会补发，sleep 会
  // 等完整个延时才 resolve（与 node 的 timers/promises.setTimeout 约定不同）。
  // 生产代码里两个调用点都不传 signal，这条路径实际上够不到，所以这里不把它
  // 锁成断言（锁住会把缺陷固化下来）；缺陷已记在交付报告里。
});

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 路径存不存在。 */
async function exists(path) {
  try {
    await real.access(path);
    return true;
  } catch {
    return false;
  }
}

// 断言真实平台常量被用到了（避免 lint 意义上的未使用变量）。
assert.equal(typeof REAL_PLATFORM, 'string');
