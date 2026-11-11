/**
 * 插件操作的持久化状态机与串行队列（magpie 式「操作记录可查、结果可复核」）。
 *
 * 状态落盘在 <profile>/.plugin-manager/operations.json：
 *
 *   {
 *     "version": 1,
 *     "updatedAt": "...",
 *     "current": "op_...",          // 正在/排队中的操作 id，无则 null
 *     "operations": [ { id, kind, targets, label, status, phase,
 *                       createdAt, startedAt, finishedAt, pid,
 *                       from, to, result, error, logPath } ... ]
 *   }
 *
 * status 状态机：queued → running → succeeded / failed / interrupted
 *
 * 关键语义：
 * - 所有写 profile 的操作（安装/更新/卸载/清理）走同一条串行队列，绝不并发；
 * - 每个操作落盘，界面重开 / 宿主重启后能看到「刚才那次到底成没成、失败原因」；
 * - 打开记录时，持有者 PID 已死的 queued/running 操作标记 interrupted（不是假装成功）；
 * - 每个操作带独立日志目录 logPath，失败时可把诊断信息直接展示给用户。
 */

import { existsSync } from 'node:fs';
import { mkdir, appendFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Mutex, readJsonFile, withFileLock, writeFileAtomic } from './atomic.js';

const JOURNAL_FILE = 'operations.json';
const STATE_DIR = '.plugin-manager';
const MAX_RECORDS = 60;
/** 终态：不会再变。 */
export const TERMINAL_STATUS = new Set(['succeeded', 'failed', 'interrupted']);

function nowIso() {
  return new Date().toISOString();
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function newOperationId() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `op_${stamp}_${randomBytes(3).toString('hex')}`;
}

/**
 * 操作记录仓库。一个 profile 一份；所有读写都走锁 + 原子写。
 */
export class OperationJournal {
  /**
   * @param {string} profileDir dsh profile 目录
   */
  constructor(profileDir) {
    this.profileDir = profileDir;
    this.stateDir = join(profileDir, STATE_DIR);
    this.stateFile = join(this.stateDir, JOURNAL_FILE);
    this.writeMutex = new Mutex();
  }

  /** 读整份记录（自动跳过损坏文件自愈）；读不出来就当空记录。 */
  async read() {
    const data = await readJsonFile(this.stateFile, { version: 1, current: null, operations: [] });
    if (!data || typeof data !== 'object') return { version: 1, current: null, operations: [] };
    if (!Array.isArray(data.operations)) data.operations = [];
    if (typeof data.current !== 'string') data.current = null;
    return data;
  }

  /** 整份原子写回（调用方自己持有需要的锁）。 */
  async write(data) {
    data.updatedAt = nowIso();
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(this.stateFile, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 });
  }

  /** read-modify-write 一段，跨进程串行。 */
  async mutate(mutator) {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    return withFileLock(this.stateFile, async () => {
      const data = await this.read();
      const next = await mutator(data) ?? data;
      if (!Array.isArray(next.operations)) next.operations = [];
      await this.write(next);
      return next;
    }, { waitMs: 30_000 });
  }

  /**
   * 打开记录：上次宿主进程被杀、留在 queued/running 的操作如实标记 interrupted，
   * 不让界面把「没做完」当成功。当前进程自己写的 running 不会被误标。
   */
  async recover() {
    return this.mutate(data => {
      let changed = false;
      for (const op of data.operations) {
        if (op.status === 'queued' || op.status === 'running') {
          if (!pidAlive(op.pid)) {
            op.status = 'interrupted';
            op.finishedAt = nowIso();
            op.error = op.error || 'dsh 或插件管理器在该操作完成前退出，结果未知；请重新检查/重试';
            changed = true;
          }
        }
      }
      if (data.current && !data.operations.some(op => op.id === data.current && !TERMINAL_STATUS.has(op.status))) {
        data.current = null;
        changed = true;
      }
      if (!changed) return undefined;
      return data;
    });
  }

  /** 登记一条 queued 操作并落盘。 */
  async begin(record) {
    const id = record.id || newOperationId();
    const op = {
      id,
      kind: record.kind || 'operation',
      targets: Array.isArray(record.targets) ? record.targets : [],
      label: record.label || '',
      status: 'queued',
      phase: 'queued',
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
      pid: process.pid,
      from: record.from ?? null,
      to: record.to ?? null,
      result: null,
      error: null,
      logPath: null
    };
    await this.mutate(data => {
      data.operations.unshift(op);
      data.operations = data.operations.slice(0, MAX_RECORDS);
      if (!data.current) data.current = id;
    });
    return op;
  }

  /** 更新一条操作（局部字段）。 */
  async update(id, patch) {
    return this.mutate(data => {
      const op = data.operations.find(item => item.id === id);
      if (!op) return undefined;
      Object.assign(op, patch);
      if (op.status === 'running' && !op.startedAt) op.startedAt = nowIso();
      if (TERMINAL_STATUS.has(op.status)) {
        op.finishedAt = op.finishedAt || nowIso();
        if (data.current === id) data.current = null;
      }
    });
  }

  /** 标记开始执行（并把它设为当前操作）。 */
  async markRunning(id, phase = 'running') {
    await this.mutate(data => {
      const op = data.operations.find(item => item.id === id);
      if (!op) return undefined;
      op.status = 'running';
      op.phase = phase;
      op.startedAt = op.startedAt || nowIso();
      data.current = id;
    });
  }

  /** 终态收尾。 */
  async finish(id, { status, result = null, error = null, phase = null }) {
    await this.update(id, {
      status,
      phase: phase ?? status,
      result,
      error,
      finishedAt: nowIso()
    });
  }

  async get(id) {
    const data = await this.read();
    return data.operations.find(op => op.id === id) ?? null;
  }

  /** 当前/最近的操作（界面重开后恢复用）。 */
  async snapshot(limit = 30) {
    await this.recover();
    const data = await this.read();
    const current = data.current ? data.operations.find(op => op.id === data.current) ?? null : null;
    return { current, recent: data.operations.slice(0, limit) };
  }
}

/**
 * 每个 profile 一个队列：串行执行 + 全生命周期落盘。
 */
export class OperationQueue {
  constructor(profileDir) {
    this.profileDir = profileDir;
    this.journal = new OperationJournal(profileDir);
    this.mutex = new Mutex();
    this.recovered = false;
  }

  async ensureRecovered() {
    if (!this.recovered) {
      this.recovered = true;
      await this.journal.recover().catch(() => {});
    }
  }

  /**
   * 登记并串行执行一个操作。
   *
   * @param {object} record { kind, targets, label, from, to }
   * @param {(ctx: {op: object, phase: (s: string) => Promise<void>,
   *                logPath: string, appendLog: (s: string) => Promise<void>}) => Promise<object>} task
   *        task 返回的结果会记进 op.result；抛错则 op.status=failed。
   * @returns {Promise<object>} 终态 op（含 result/error）
   */
  async run(record, task) {
    await this.ensureRecovered();
    const op = await this.journal.begin(record);
    const logDir = join(this.journal.stateDir, 'logs', op.id);
    const logPath = join(logDir, 'command.log');
    await mkdir(logDir, { recursive: true, mode: 0o700 }).catch(() => {});
    await this.journal.update(op.id, { logPath });
    const appendLog = async text => {
      if (!text) return;
      await appendFile(logPath, typeof text === 'string' ? text : String(text), { mode: 0o600 }).catch(() => {});
    };
    const execute = async () => {
      await this.journal.markRunning(op.id, 'running');
      let current = null;
      try {
        current = await this.journal.get(op.id);
        const result = await task({
          op: current,
          logPath,
          appendLog,
          phase: async phase => { await this.journal.update(op.id, { phase }); }
        });
        const status = result?.ok === false ? 'failed' : 'succeeded';
        await this.journal.finish(op.id, {
          status,
          result: result ?? null,
          error: result?.ok === false ? (result.error || result.message || '操作失败') : null
        });
      } catch (error) {
        const message = error?.message || String(error);
        await appendLog(`\n[plugin-manager] 操作失败：${message}\n${error?.stack ? `${error.stack}\n` : ''}`);
        await this.journal.finish(op.id, { status: 'failed', error: message });
      }
      return this.journal.get(op.id);
    };
    // 排队执行：mutex 保证同 profile 同时只有一个操作在跑。
    return this.mutex.run(execute);
  }
}

/** @type {Map<string, OperationQueue>} */
const queues = new Map();

/** 按 profile 目录复用同一个队列（进程内单例）。 */
export function getOperationQueue(profileDir) {
  let queue = queues.get(profileDir);
  if (!queue) {
    queue = new OperationQueue(profileDir);
    queues.set(profileDir, queue);
  }
  return queue;
}

/** 测试辅助：清空单例缓存。 */
export function resetOperationQueues() {
  for (const queue of queues.values()) {
    // 不删磁盘上的记录，只丢进程内单例。
  }
  queues.clear();
}

/** 读操作日志尾部（失败诊断）；最多 maxBytes 字节。 */
export async function readOperationLog(profileDir, opId, maxBytes = 8192) {
  if (!/^op_[\w-]+$/.test(opId)) throw new Error('非法的操作 id');
  const logPath = join(profileDir, STATE_DIR, 'logs', opId, 'command.log');
  if (!existsSync(logPath)) return null;
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(logPath);
  const text = buf.subarray(Math.max(0, buf.length - maxBytes)).toString('utf8');
  return { logPath, text, truncated: buf.length > maxBytes };
}

/** 清理超过 maxAgeMs 的旧操作日志目录（保留最近 N 条）。 */
export async function pruneOperationLogs(profileDir, maxAgeMs = 7 * 24 * 3600 * 1000) {
  const logsRoot = join(profileDir, STATE_DIR, 'logs');
  const { readdir, stat } = await import('node:fs/promises');
  let entries;
  try {
    entries = await readdir(logsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - maxAgeMs;
  await Promise.all(entries.map(async entry => {
    if (!entry.isDirectory() || !entry.name.startsWith('op_')) return;
    try {
      const st = await stat(join(logsRoot, entry.name));
      if (st.mtimeMs < cutoff) await rm(join(logsRoot, entry.name), { recursive: true, force: true });
    } catch {}
  }));
}
