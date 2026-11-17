// lib/operations.js 的覆盖补齐：操作记录仓库（落盘 / 读改写 / 崩溃恢复）与
// 串行操作队列（登记 → 执行 → 收尾 → 日志）。
//
// 三条硬约束（与本仓库其它测试一致）：
//   1) 不联网、不跑真实子进程：本文件根本不碰子进程。
//   2) 不改生产代码：lib/operations.js 与 lib/atomic.js 一个字节都不动。
//   3) 故障注入只发生在**本进程**里：把 node:fs/promises 的几个函数换成可注入的
//      包装（用 createRequire 拿到 CJS exports 改）。ESM 侧
//      `import { rm } from 'node:fs/promises'` 在 **facade 首次建立时**才把值
//      抄过去，所以补丁必须打在本文件 import lib/operations.js **之前**——
//      这也是本文件不静态 import node:fs/promises 的原因（静态 import 会被提升
//      到模块体之前，提前把 facade 建出来，补丁就失效了）。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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
 * 当前生效的 fs 钩子。钩子签名与对应 fs 函数一致：
 *   - rm(path, options) / mkdir(path, options) / stat(path) / readdir(path, options)
 *     / writeFile(path, content, options)：抛错即模拟失败。
 *   - readdir 返回非 undefined 的值即**替换**读到的目录项。
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

// 必须在 fs 补丁装好之后再 import：lib/operations.js 的 import 语句会把
// node:fs/promises 的 facade 建出来，facade 建立的那一刻才把（已打过补丁的）
// 函数抄过去。
const ops = await import('../lib/operations.js');
const {
  OperationJournal,
  OperationQueue,
  TERMINAL_STATUS,
  getOperationQueue,
  pruneOperationLogs,
  readOperationLog,
  resetOperationQueues,
} = ops;

// ---------------------------------------------------------------------------
// 测试骨架
// ---------------------------------------------------------------------------

/** 全部用例都要改全局钩子 / process.kill，必须串行。 */
const serialTest = (name, fn) => test(name, { concurrency: false }, fn);

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

/** 建一个临时目录（跑完删掉）。 */
async function withTempDir(prefix, fn) {
  const dir = await real.mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await real.rm(dir, { recursive: true, force: true });
  }
}

/** profile 目录下的状态文件路径。 */
function stateFileOf(profileDir) {
  return join(profileDir, '.plugin-manager', 'operations.json');
}

/** 直接写一份操作记录（绕过 journal 的 API，模拟「上次宿主被杀留下的状态」）。 */
async function seedJournal(profileDir, data) {
  await seedJournalRaw(profileDir, `${JSON.stringify(data, null, 2)}\n`);
}

/** 直接写原始文本（用来喂「内容不是对象」的畸形 JSON）。 */
async function seedJournalRaw(profileDir, text) {
  const stateFile = stateFileOf(profileDir);
  await real.mkdir(join(profileDir, '.plugin-manager'), { recursive: true });
  await real.writeFile(stateFile, text);
}

/** 读回一份操作记录。 */
async function readJournal(profileDir) {
  return JSON.parse(await real.readFile(stateFileOf(profileDir), 'utf8'));
}

// ---------------------------------------------------------------------------
// 1) 记录读取：畸形数据自愈
// ---------------------------------------------------------------------------

serialTest('OperationJournal.read：记录文件不存在 / 内容畸形时都按空记录处理', async () => {
  await withTempDir('dsh-ops-read-', async profileDir => {
    const journal = new OperationJournal(profileDir);

    // 文件不存在
    const empty = await journal.read();
    assert.equal(empty.version, 1);
    assert.equal(empty.current, null);
    assert.deepEqual(empty.operations, []);

    // 内容是 JSON null / 数字 / 字符串 / 布尔 → 当成空记录
    for (const raw of ['null', '123', '"文本"', 'true']) {
      await seedJournalRaw(profileDir, raw);
      const data = await journal.read();
      assert.deepEqual(data, { version: 1, current: null, operations: [] }, `${raw} 当成空记录`);
    }

    // operations 不是数组 / current 不是字符串 → 归位
    await seedJournal(profileDir, { operations: 'not-an-array', current: 7 });
    const fixed = await journal.read();
    assert.deepEqual(fixed.operations, [], 'operations 不是数组时归位成空数组');
    assert.equal(fixed.current, null, 'current 不是字符串时归位成 null');

    // 正常记录原样读回
    await seedJournal(profileDir, { version: 1, current: 'op_a', operations: [{ id: 'op_a' }] });
    const good = await journal.read();
    assert.equal(good.current, 'op_a');
    assert.equal(good.operations.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 2) 登记 / 更新 / 收尾
// ---------------------------------------------------------------------------

serialTest('OperationJournal.begin：登记一条 queued 操作并落盘，缺省字段有兜底', async () => {
  await withTempDir('dsh-ops-begin-', async profileDir => {
    const journal = new OperationJournal(profileDir);

    const op = await journal.begin({ kind: 'install', targets: ['dsh-a'], label: '安装 dsh-a', from: 'v1', to: 'v2' });
    assert.match(op.id, /^op_\d{8}-\d{6}_[0-9a-f]{6}$/, '没给 id 时自动生成带时间戳的 id');
    assert.equal(op.kind, 'install');
    assert.deepEqual(op.targets, ['dsh-a']);
    assert.equal(op.label, '安装 dsh-a');
    assert.equal(op.status, 'queued');
    assert.equal(op.phase, 'queued');
    assert.equal(op.startedAt, null);
    assert.equal(op.finishedAt, null);
    assert.equal(op.pid, process.pid);
    assert.equal(op.from, 'v1');
    assert.equal(op.to, 'v2');
    assert.equal(op.result, null);
    assert.equal(op.error, null);
    assert.equal(op.logPath, null);

    // 落盘了
    const stored = await readJournal(profileDir);
    assert.equal(stored.operations.length, 1);
    assert.equal(stored.operations[0].id, op.id);
    assert.equal(stored.current, op.id, '第一条操作成为当前操作');

    // 缺省字段
    const plain = await journal.begin({ id: 'op_fixed' });
    assert.equal(plain.id, 'op_fixed');
    assert.equal(plain.kind, 'operation', '没给 kind 时兜底成 operation');
    assert.deepEqual(plain.targets, [], 'targets 不是数组时兜底成空数组');
    assert.equal(plain.label, '');
    assert.equal(plain.from, null, 'from 缺失时兜底成 null');
    assert.equal(plain.to, null);

    const odd = await journal.begin({ id: 'op_odd', targets: 'not-an-array', from: undefined, to: 5 });
    assert.deepEqual(odd.targets, []);
    assert.equal(odd.from, null, 'from 是 undefined 时也兜底成 null');
    assert.equal(odd.to, 5, 'to 保留原值');

    // 已有当前操作时，begin 不抢 current
    const stored2 = await readJournal(profileDir);
    assert.equal(stored2.current, op.id, 'current 不会被后来的登记抢走');
  });
});

serialTest('OperationJournal.begin：记录最多保留 60 条', async () => {
  await withTempDir('dsh-ops-cap-', async profileDir => {
    const operations = Array.from({ length: 65 }, (_, index) => ({
      id: `op_old_${index}`, kind: 'operation', targets: [], label: '', status: 'succeeded',
      phase: 'succeeded', createdAt: '2024-01-01T00:00:00.000Z', startedAt: null,
      finishedAt: null, pid: 1, from: null, to: null, result: null, error: null, logPath: null
    }));
    await seedJournal(profileDir, { version: 1, current: 'op_old_0', operations });

    const journal = new OperationJournal(profileDir);
    const op = await journal.begin({ kind: 'install' });
    const stored = await readJournal(profileDir);
    assert.equal(stored.operations.length, 60, '超出上限的旧记录被丢掉');
    assert.equal(stored.operations[0].id, op.id, '最新的一条排在最前面');
  });
});

serialTest('OperationJournal.update：更新字段、running 补 startedAt、终态清掉 current', async () => {
  await withTempDir('dsh-ops-update-', async profileDir => {
    const journal = new OperationJournal(profileDir);
    const op = await journal.begin({ kind: 'install', label: '安装' });

    await journal.update(op.id, { status: 'running', phase: 'downloading' });
    let stored = await readJournal(profileDir);
    let record = stored.operations.find(item => item.id === op.id);
    assert.equal(record.status, 'running');
    assert.equal(record.phase, 'downloading');
    assert.ok(record.startedAt, '转 running 时补上 startedAt');

    const firstStartedAt = record.startedAt;
    await journal.update(op.id, { status: 'running' });
    stored = await readJournal(profileDir);
    record = stored.operations.find(item => item.id === op.id);
    assert.equal(record.startedAt, firstStartedAt, '已有 startedAt 时不覆盖');

    // 终态：补 finishedAt 并清掉 current
    await journal.update(op.id, { status: 'succeeded', result: { ok: true } });
    stored = await readJournal(profileDir);
    record = stored.operations.find(item => item.id === op.id);
    assert.ok(record.finishedAt, '终态补上 finishedAt');
    assert.equal(stored.current, null, '当前操作收尾后被清空');

    // 找不到的操作：什么都不做，也不报错
    const before = await readJournal(profileDir);
    await journal.update('op_not_exist', { status: 'failed' });
    const after = await readJournal(profileDir);
    assert.deepEqual(after.operations, before.operations, '找不到的操作时记录不变');
  });
});

serialTest('OperationJournal.markRunning / finish / get：状态推进与查询', async () => {
  await withTempDir('dsh-ops-lifecycle-', async profileDir => {
    const journal = new OperationJournal(profileDir);
    const op = await journal.begin({ kind: 'install', label: '安装' });

    await journal.markRunning(op.id, 'installing');
    let stored = await readJournal(profileDir);
    let record = stored.operations.find(item => item.id === op.id);
    assert.equal(record.status, 'running');
    assert.equal(record.phase, 'installing');
    assert.ok(record.startedAt);
    assert.equal(stored.current, op.id, 'running 的操作成为当前操作');

    await journal.finish(op.id, { status: 'succeeded', result: { ok: true } });
    stored = await readJournal(profileDir);
    record = stored.operations.find(item => item.id === op.id);
    assert.equal(record.status, 'succeeded');
    assert.equal(record.phase, 'succeeded', '没给 phase 时用 status');
    assert.deepEqual(record.result, { ok: true });
    assert.equal(record.error, null);
    assert.ok(record.finishedAt);
    assert.equal(stored.current, null);

    // 查询
    assert.equal((await journal.get(op.id)).id, op.id);
    assert.equal(await journal.get('op_not_exist'), null, '查不到时返回 null');

    // 不存在的操作 markRunning / finish 都不报错
    await journal.markRunning('op_not_exist');
    await journal.finish('op_not_exist', { status: 'failed', error: 'x' });
  });
});

// ---------------------------------------------------------------------------
// 3) recover：上次宿主被杀留下的记录如实标记 interrupted
// ---------------------------------------------------------------------------

serialTest('OperationJournal.recover：持有者已死的 queued/running 操作标记 interrupted', async () => {
  await withTempDir('dsh-ops-recover-', async profileDir => {
    await seedJournal(profileDir, {
      version: 1,
      current: 'op_done',
      operations: [
        { id: 'op_dead', status: 'queued', pid: 999999, error: null, finishedAt: null },
        { id: 'op_zero', status: 'running', pid: 0, error: null, finishedAt: null },
        { id: 'op_self', status: 'running', pid: process.pid, error: null, finishedAt: null },
        { id: 'op_protected', status: 'running', pid: 4242, error: null, finishedAt: null },
        { id: 'op_alive', status: 'running', pid: 5151, error: null, finishedAt: null },
        { id: 'op_done', status: 'succeeded', pid: 6060, error: null, finishedAt: '2024-01-01T00:00:00.000Z' }
      ]
    });

    const journal = new OperationJournal(profileDir);
    await withStubbedKill(pid => {
      if (pid === 999999) throw fsError('ESRCH', 'ESRCH');   // 进程已经不在
      if (pid === 4242) throw fsError('EPERM', 'EPERM');      // 是别人的进程，算活着
      return true;                                             // 其它进程还活着
    }, async () => {
      await journal.recover();
    });

    const stored = await readJournal(profileDir);
    const byId = new Map(stored.operations.map(item => [item.id, item]));

    assert.equal(byId.get('op_dead').status, 'interrupted', '进程已经没了 → 标记 interrupted');
    assert.ok(byId.get('op_dead').finishedAt, 'interrupted 时补上 finishedAt');
    assert.match(byId.get('op_dead').error, /结果未知/, '如实说明结果未知');

    assert.equal(byId.get('op_zero').status, 'interrupted', 'PID 非法（不是正整数）也算拿不住');
    assert.equal(byId.get('op_self').status, 'running', '当前进程自己写的 running 不被误标');
    assert.equal(byId.get('op_protected').status, 'running', 'EPERM 说明进程还在（别人的进程）');
    assert.equal(byId.get('op_alive').status, 'running', '还活着的进程不动');
    assert.equal(byId.get('op_done').status, 'succeeded', '终态不动');

    assert.equal(stored.current, null, 'current 指向已终态的操作时清空');
  });
});

serialTest('OperationJournal.recover：current 指向不存在的操作时也清空', async () => {
  await withTempDir('dsh-ops-recover-cur-', async profileDir => {
    await seedJournal(profileDir, {
      version: 1,
      current: 'op_gone',
      operations: [{ id: 'op_other', status: 'succeeded', pid: 1, error: null }]
    });
    const journal = new OperationJournal(profileDir);
    await journal.recover();
    const stored = await readJournal(profileDir);
    assert.equal(stored.current, null, 'current 指向查不到的操作时清空');
  });
});

serialTest('OperationJournal.recover：current 指向还活着的 running 操作时保留', async () => {
  await withTempDir('dsh-ops-recover-keep-', async profileDir => {
    await seedJournal(profileDir, {
      version: 1,
      current: 'op_alive',
      operations: [{ id: 'op_alive', status: 'running', pid: 5151, error: null, finishedAt: null }]
    });
    const journal = new OperationJournal(profileDir);
    await withStubbedKill(() => true, async () => {
      await journal.recover();
    });
    const stored = await readJournal(profileDir);
    assert.equal(stored.current, 'op_alive', '还在跑的操作不动 current');
    assert.equal(stored.operations[0].status, 'running');
  });
});

serialTest('OperationJournal.snapshot：返回当前操作与最近记录，current 查不到时为 null', async () => {
  await withTempDir('dsh-ops-snapshot-', async profileDir => {
    const journal = new OperationJournal(profileDir);
    const first = await journal.begin({ kind: 'install', label: '一' });
    const second = await journal.begin({ kind: 'update', label: '二' });

    const snapshot = await journal.snapshot();
    assert.ok(snapshot.current, '有当前操作');
    assert.equal(snapshot.current.id, first.id, 'current 是最早登记的那条（后来的 begin 不抢 current）');
    assert.equal(snapshot.recent.length, 2);
    assert.deepEqual(snapshot.recent.map(item => item.id), [second.id, first.id], '最近登记的排在前面');

    // limit
    const limited = await journal.snapshot(1);
    assert.equal(limited.recent.length, 1, 'recent 按 limit 截断');

    // 没有 current 时为 null
    await seedJournal(profileDir, { version: 1, current: null, operations: [] });
    const none = await journal.snapshot();
    assert.equal(none.current, null);
    assert.deepEqual(none.recent, []);

    // current 指向一条不存在的记录时也是 null
    await seedJournal(profileDir, {
      version: 1,
      current: 'op_gone',
      operations: [{ id: 'op_a', status: 'succeeded', pid: 1, error: null }]
    });
    const orphan = await journal.snapshot();
    assert.equal(orphan.current, null, 'current 指向查不到的操作时是 null');
    assert.equal(orphan.recent.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 4) 队列：登记 → 执行 → 收尾 → 日志
// ---------------------------------------------------------------------------

serialTest('OperationQueue.run：成功执行，状态机与日志都落盘', async () => {
  await withTempDir('dsh-ops-run-', async profileDir => {
    const queue = new OperationQueue(profileDir);
    let seen = null;

    const op = await queue.run({ kind: 'install', targets: ['dsh-a'], label: '安装 dsh-a' }, async ctx => {
      seen = ctx;
      assert.ok(ctx.op, '回调能拿到自己的操作记录');
      assert.equal(ctx.op.status, 'running', '执行时状态是 running');
      assert.ok(ctx.logPath.endsWith(join('logs', ctx.op.id, 'command.log')), '每次操作有独立日志目录');
      await ctx.appendLog('第一步');
      await ctx.appendLog('');            // 空串不写
      await ctx.appendLog(123);          // 非字符串转成字符串
      await ctx.phase('installing');
      // 执行途中 phase 是回调自己写的那个
      const midway = await readJournal(profileDir);
      assert.equal(midway.operations[0].phase, 'installing', 'phase 被回调更新过');
      return { ok: true, stdout: 'done' };
    });

    assert.equal(op.status, 'succeeded');
    assert.equal(op.kind, 'install');
    assert.deepEqual(op.targets, ['dsh-a']);
    assert.equal(op.label, '安装 dsh-a');
    assert.deepEqual(op.result, { ok: true, stdout: 'done' });
    assert.equal(op.error, null);
    assert.ok(op.startedAt);
    assert.ok(op.finishedAt);
    assert.equal(seen.op.id, op.id);

    // 日志内容
    const log = await real.readFile(op.logPath, 'utf8');
    assert.equal(log, '第一步123', '空串不写，非字符串被转成字符串');

    // 落盘
    const stored = await readJournal(profileDir);
    assert.equal(stored.operations[0].id, op.id);
    assert.equal(stored.operations[0].status, 'succeeded');
    assert.equal(stored.operations[0].phase, 'succeeded', '收尾时 phase 用终态兜底');
    assert.equal(stored.current, null, '收尾后 current 被清空');
  });
});

serialTest('OperationQueue.run：任务抛错时记为 failed 并把失败原因写进日志', async () => {
  await withTempDir('dsh-ops-run-fail-', async profileDir => {
    const queue = new OperationQueue(profileDir);
    const op = await queue.run({ kind: 'install', label: '安装' }, async () => {
      throw new Error('装不上');
    });
    assert.equal(op.status, 'failed');
    assert.match(op.error, /装不上/);

    const log = await real.readFile(op.logPath, 'utf8');
    assert.match(log, /\[plugin-manager\] 操作失败：装不上/, '失败原因写进日志');
  });
});

serialTest('OperationQueue.run：抛的不是 Error（没有 message / 没有 stack）也如实记下来', async () => {
  await withTempDir('dsh-ops-run-weird-', async profileDir => {
    const queue = new OperationQueue(profileDir);
    const op = await queue.run({ kind: 'install', label: '安装' }, async () => {
      throw { code: 'E_NO_MESSAGE' };
    });
    assert.equal(op.status, 'failed');
    assert.match(op.error, /E_NO_MESSAGE|\[object Object\]/, '没有 message 的错误也要能说清楚');

    const log = await real.readFile(op.logPath, 'utf8');
    assert.match(log, /操作失败/, '失败也写日志');
  });
});

serialTest('OperationQueue.run：任务返回 ok:false 时记为 failed 并带上原因', async () => {
  await withTempDir('dsh-ops-run-notok-', async profileDir => {
    const queue = new OperationQueue(profileDir);

    const withError = await queue.run({ kind: 'install', label: 'a' }, async () => ({ ok: false, error: '自定义错误' }));
    assert.equal(withError.status, 'failed');
    assert.equal(withError.error, '自定义错误');

    const withMessage = await queue.run({ kind: 'install', label: 'b' }, async () => ({ ok: false, message: '只有 message' }));
    assert.equal(withMessage.status, 'failed');
    assert.equal(withMessage.error, '只有 message', '没有 error 时用 message');

    const bare = await queue.run({ kind: 'install', label: 'c' }, async () => ({ ok: false }));
    assert.equal(bare.status, 'failed');
    assert.equal(bare.error, '操作失败', '既没 error 也没 message 时用兜底文案');

    // 返回值不是对象（甚至 undefined）时算成功
    const ok = await queue.run({ kind: 'install', label: 'd' }, async () => undefined);
    assert.equal(ok.status, 'succeeded');
    assert.equal(ok.result, null);
  });
});

serialTest('OperationQueue.run：同一个 profile 的操作绝不并发，后来的排在前一个后面', async () => {
  await withTempDir('dsh-ops-serial-', async profileDir => {
    const queue = new OperationQueue(profileDir);
    const order = [];
    let running = 0;
    let maxConcurrent = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });

    const first = queue.run({ kind: 'a', label: 'a' }, async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      order.push('a-start');
      markStarted();
      await gate;
      order.push('a-end');
      running -= 1;
    });

    // 等第一个操作真的跑起来，再发第二个（这样入队顺序是确定的）
    await started;
    const second = queue.run({ kind: 'b', label: 'b' }, async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      order.push('b-start');
      order.push('b-end');
      running -= 1;
    });
    release();

    await Promise.all([first, second]);
    assert.equal(maxConcurrent, 1, '同一个 profile 的操作绝不并发');
    assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'], '先跑起来的那个先跑完');

    const stored = await readJournal(profileDir);
    assert.equal(stored.operations.length, 2);
    assert.equal(stored.operations[0].kind, 'b', '最近登记的操作排在最前面');
  });
});

serialTest('OperationQueue.ensureRecovered：恢复失败不影响后续（错误被兜住）', async () => {
  await withTempDir('dsh-ops-recover-fail-', async profileDir => {
    const queue = new OperationQueue(profileDir);
    queue.journal.recover = async () => { throw new Error('恢复失败'); };
    await queue.ensureRecovered();
    assert.equal(queue.recovered, true, '恢复失败被兜住，不抛给调用方');
  });
});

// ---------------------------------------------------------------------------
// 5) 队列单例
// ---------------------------------------------------------------------------

serialTest('getOperationQueue / resetOperationQueues：按 profile 复用单例，重置只丢进程内缓存', async () => {
  await withTempDir('dsh-ops-queue-', async profileDir => {
    resetOperationQueues();

    const first = getOperationQueue(profileDir);
    assert.equal(getOperationQueue(profileDir), first, '同一 profile 复用同一个队列');

    const other = getOperationQueue(join(profileDir, 'other'));
    assert.notEqual(other, first, '不同 profile 是不同的队列');

    // 落一份记录，重置之后磁盘上的记录还在
    const op = await first.run({ kind: 'install', label: '安装' }, async () => ({ ok: true }));
    assert.equal(op.status, 'succeeded');

    resetOperationQueues();
    assert.notEqual(getOperationQueue(profileDir), first, '重置后重新建队列');

    const stored = await readJournal(profileDir);
    assert.equal(stored.operations.length, 1, '重置只丢进程内单例，磁盘记录还在');
  });
});

// ---------------------------------------------------------------------------
// 6) 日志读取与清理
// ---------------------------------------------------------------------------

serialTest('readOperationLog：非法 id 拒绝、文件不存在返回 null、正常读出尾部', async () => {
  await withTempDir('dsh-ops-log-', async profileDir => {
    await assert.rejects(readOperationLog(profileDir, 'bad id'), /非法的操作 id/);
    await assert.rejects(readOperationLog(profileDir, '../evil'), /非法的操作 id/);
    await assert.rejects(readOperationLog(profileDir, ''), /非法的操作 id/);

    assert.equal(await readOperationLog(profileDir, 'op_missing'), null, '没有日志时返回 null');

    const logPath = join(profileDir, '.plugin-manager', 'logs', 'op_x', 'command.log');
    await real.mkdir(join(profileDir, '.plugin-manager', 'logs', 'op_x'), { recursive: true });
    await real.writeFile(logPath, 'hello log');

    const log = await readOperationLog(profileDir, 'op_x');
    assert.equal(log.logPath, logPath);
    assert.equal(log.text, 'hello log');
    assert.equal(log.truncated, false);

    // 超过 maxBytes 时只给尾部，并标出被截断
    await real.writeFile(logPath, 'x'.repeat(100));
    const cut = await readOperationLog(profileDir, 'op_x', 10);
    assert.equal(cut.text, 'x'.repeat(10), '只返回尾部 maxBytes 个字节');
    assert.equal(cut.truncated, true);
  });
});

serialTest('pruneOperationLogs：日志目录不存在时安静返回；过期的删掉，新的与别的目录保留', async () => {
  await withTempDir('dsh-ops-prune-', async profileDir => {
    // 日志目录还没建 → readdir 抛错 → 安静返回
    await pruneOperationLogs(profileDir);

    const logsRoot = join(profileDir, '.plugin-manager', 'logs');
    await real.mkdir(join(logsRoot, 'op_old'), { recursive: true });
    await real.mkdir(join(logsRoot, 'op_new'), { recursive: true });
    await real.mkdir(join(logsRoot, 'not-an-op'), { recursive: true });
    await real.writeFile(join(logsRoot, 'op_file'), 'x');   // 是文件不是目录

    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    await real.utimes(join(logsRoot, 'op_old'), old, old);

    await pruneOperationLogs(profileDir, 7 * 24 * 3600 * 1000);

    const left = (await real.readdir(logsRoot)).sort();
    assert.deepEqual(left, ['not-an-op', 'op_file', 'op_new'].sort(),
      '过期的 op_ 目录被删掉；不是目录的和不是 op_ 的都留着');
  });
});

serialTest('pruneOperationLogs：统计目录信息失败时跳过那一条，不影响其它目录', async () => {
  await withTempDir('dsh-ops-prune-stat-', async profileDir => {
    const logsRoot = join(profileDir, '.plugin-manager', 'logs');
    await real.mkdir(join(logsRoot, 'op_bad'), { recursive: true });
    await real.mkdir(join(logsRoot, 'op_good'), { recursive: true });

    await withHooks({
      stat: async path => {
        if (path.endsWith('op_bad')) throw fsError('EACCES', '读不到');
      }
    }, async () => {
      await pruneOperationLogs(profileDir, 7 * 24 * 3600 * 1000);
    });

    const left = (await real.readdir(logsRoot)).sort();
    assert.deepEqual(left, ['op_bad', 'op_good'], '统计失败的那条被跳过，其它目录照常处理');
  });
});

// ---------------------------------------------------------------------------
// 7) 终态集合
// ---------------------------------------------------------------------------

serialTest('TERMINAL_STATUS：终态就是 succeeded / failed / interrupted', () => {
  assert.deepEqual([...TERMINAL_STATUS].sort(), ['failed', 'interrupted', 'succeeded']);
});
