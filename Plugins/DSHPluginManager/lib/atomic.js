/**
 * 原子落盘 / 损坏自愈 / 跨进程写锁 / 进程内串行队列。
 *
 * 设计参照 dsh runtime 自带的 @deepseek-ai/dsh-atomic-write（见其 lib/index.js）
 * 与 magpie 的状态文件约定（.lock 锁、写坏的文件留在旁边并从备份恢复）：
 *
 * - writeFileAtomic：随机后缀 + wx 独占创建 + rename 提交，读者永远只看到完整的新/旧内容。
 * - readJsonFile：读不出来的损坏文件移动成 .corrupt-<时间戳> 留在旁边，不反复读坏状态。
 * - withFileLock：<file>.lock 兄弟锁，记录持有者 PID；持有者进程已死（ESRCH）时，
 *   抢一个 claim 文件、二次确认后接管锁（含 PID 复用保护）。
 * - Mutex：进程内的串行链，所有会改 profile 的操作共用一条队。
 *
 * 这个文件只能用 node: 内置模块（插件随启动器分发，无 node_modules）。
 */

import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;
const RENAME_RETRY_INITIAL_MS = 20;
const RENAME_RETRY_MAX_MS = 200;
const RENAME_RETRY_LIMIT = 8;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }, { once: true });
  }
});

/** Windows 上 rename 偶发 EACCES/EBUSY/EPERM，按上限退避重试。 */
async function renameAtomicTemp(temp, filename) {
  let delay = RENAME_RETRY_INITIAL_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(temp, filename);
      return;
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      if (attempt >= RENAME_RETRY_LIMIT) throw error;
      await sleep(delay);
      delay = Math.min(delay * 2, RENAME_RETRY_MAX_MS);
    }
  }
}

/**
 * 原子替换文件：写随机后缀兄弟文件（wx 独占，拒绝跟随符号链接），再 rename 覆盖目标。
 * 任何失败都把临时文件收掉；父目录自动创建。
 */
export async function writeFileAtomic(filename, content, options = {}) {
  await mkdir(dirname(filename), { recursive: true, ...(options.dirMode ? { mode: options.dirMode } : {}) });
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, content, { mode: options.mode ?? 0o600, flag: 'wx' });
    await renameAtomicTemp(temp, filename);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * 宽松读 JSON：文件不存在 → fallback；JSON 损坏（典型是上次被杀时写到一半）
 * 把坏文件改名成 <file>.corrupt-<时间戳> 留在旁边（magpie 约定），然后返回 fallback，
 * 避免每次启动都读同一份坏状态；坏文件可供事后排查。
 */
export async function readJsonFile(filename, fallback = {}) {
  let text;
  try {
    text = await readFile(filename, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    try {
      const stamped = `${filename}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await rename(filename, stamped);
    } catch {
      // 改名失败也不阻塞调用方。
    }
    return structuredClone(fallback);
  }
}

/** 顺手清理上次被杀留下的临时文件；保留活进程可能正在写的 staging 目录（跳过 .staged-）。 */
export async function cleanupTempSiblings(directory, prefix = '') {
  let names;
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  await Promise.all(names.map(async name => {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) return;
    if (name.includes('.staged-')) return;
    await rm(join(directory, name), { force: true, recursive: true }).catch(() => {});
  }));
}

/** 探针判断 PID 对应进程是否已经不在（ESRCH 才算死，EPERM 是别人的进程，算活着）。 */
function processGone(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

async function isLockContention(error, lockPath) {
  if (error?.code === 'EEXIST') return true;
  if (error?.code !== 'EPERM') return false;
  try {
    await lstat(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 锁持有者进程已死时接管锁：先抢 claim 文件，再二次确认锁内容没变、PID 仍死，
 * 然后才删锁，防止误删 PID 复用后的新持有者锁。
 */
async function takeOverExitedLock(lockPath) {
  let record;
  try {
    record = await readFile(lockPath, 'utf8');
  } catch {
    return false;
  }
  const match = /^(\d+)\n?$/.exec(record.trim());
  if (!match || !processGone(Number(match[1]))) return false;
  const claim = `${lockPath}.takeover-${createHash('sha256').update(record).digest('hex').slice(0, 16)}`;
  try {
    await writeFile(claim, `${process.pid}\n`, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (['EEXIST', 'EPERM'].includes(error?.code)) return false;
    throw error;
  }
  try {
    let now;
    try {
      now = await readFile(lockPath, 'utf8');
    } catch {
      return false;
    }
    const again = /^(\d+)\n?$/.exec(now.trim());
    if (now !== record || !again || !processGone(Number(again[1]))) return false;
    await rm(lockPath, { force: true });
    return true;
  } finally {
    await rm(claim, { force: true }).catch(() => {});
  }
}

/**
 * 跨进程写锁：wx 创建 <filename>.lock，里面写持有者 PID。
 * 竞争时指数退避（20ms→200ms），waitMs 超时即失败；持有进程已死则接管。
 * fn 正常/抛错都会释放锁。
 */
export async function withFileLock(filename, fn, options = {}) {
  const lockPath = `${filename}.lock`;
  const deadline = Date.now() + (options.waitMs ?? 120_000);
  let delay = LOCK_RETRY_INITIAL_MS;
  for (;;) {
    options.signal?.throwIfAborted?.();
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' });
      break;
    } catch (error) {
      if (!(await isLockContention(error, lockPath))) {
        if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
      } else if (await takeOverExitedLock(lockPath)) {
        continue;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`等待写锁超时（${lockPath}）：另一个插件操作仍在进行，请稍后再试`);
    }
    await sleep(Math.min(delay, Math.max(1, deadline - Date.now())));
    delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

/**
 * 进程内串行互斥队列：run() 按调用顺序一个接一个执行，返回该任务自己的结果。
 * 用来保证「安装 / 更新 / 卸载 / 清理」这些改同一个 profile 的操作绝不并发。
 */
export class Mutex {
  constructor() {
    /** @type {Promise<unknown>} */
    this.tail = Promise.resolve();
    this.size = 0;
  }

  /** 排队执行 fn；fn 抛错只影响它自己的 Promise，不阻塞后面的任务。 */
  run(fn) {
    this.size += 1;
    const result = this.tail.then(() => fn());
    // 链条本身不因单个任务失败而断掉。
    this.tail = result.then(() => { this.size -= 1; }, () => { this.size -= 1; });
    return result;
  }
}
