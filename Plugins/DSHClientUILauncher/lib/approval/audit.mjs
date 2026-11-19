/**
 * 审计日志：`approval-audit.jsonl`，append-only，20MB × 5 轮转。
 *
 * 几条不能改的口径（05-设计 §7.3）：
 * - 每次判定都写，allow 也写；写失败只记 `console.error` + 计数，不阻塞判定、不回滚策略；
 * - 轮转件 `approval-audit.1.jsonl … .5.jsonl`，`.1` 是最近一次轮转，编号越大越旧；
 * - `audit()` 要跨文件读（当前 → .1 → …），最多 6 个文件；轮转瞬间的 ENOENT 重试一次；
 * - 追加式事件流：用户作答 / 超时的收尾行是新 `id` + `relatedId` 指向判定行，读不去重、按 ts 全量返回，
 *   最终态由 UI 按 `relatedId` 归并（取证时能同时看到「当时怎么判」和「用户选了什么」）。
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { enqueue } from './queue.mjs'

/** 当前审计文件名。 */
export const AUDIT_FILE = 'approval-audit.jsonl'

/** 单片上限，默认 20MB。 */
export const AUDIT_MAX_BYTES = 20 * 1024 * 1024

/** 保留的轮转片数。 */
export const AUDIT_KEEP = 5

/** `command` 字段的截断上限（字节）。 */
export const COMMAND_BYTES_LIMIT = 4096

/** 截断标记。 */
const TRUNCATED_MARK = '…[truncated]'

/** 单次 `audit()` 最多返回多少条，防一次拉爆页头。 */
export const AUDIT_LIMIT_MAX = 1000

/** `audit()` 默认返回条数。 */
export const AUDIT_LIMIT_DEFAULT = 100

/**
 * 按字节截断命令原文，超长追加标记（不按字符切，中文不会被切坏）。
 * @param {string} command - 原文。
 * @returns {string} 截断后的文本。
 */
export function truncateCommand(command) {
  const text = typeof command === 'string' ? command : ''
  const size = Buffer.byteLength(text, 'utf8')
  if (size <= COMMAND_BYTES_LIMIT) return text
  const buffer = Buffer.from(text, 'utf8')
  let end = COMMAND_BYTES_LIMIT
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return buffer.subarray(0, end).toString('utf8') + TRUNCATED_MARK
}

/**
 * 把 ISO 时间戳转成可比较的数字；解析失败返回 null。
 * @param {string} value - ISO8601 字符串。
 * @returns {number|null} 毫秒数。
 */
function timeOf(value) {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * 审计日志。
 */
export class AuditLog {
  /**
   * @param {{ stateDir?: string, now?: () => Date, maxBytes?: number, keep?: number }} [options] - 目录、时钟、单片上限、保留片数。
   */
  constructor(options = {}) {
    this.home = options.home ?? os.homedir()
    this.stateDir = options.stateDir ?? path.join(this.home, '.dsh', 'state')
    this.now = options.now ?? (() => new Date())
    this.maxBytes = options.maxBytes ?? AUDIT_MAX_BYTES
    this.keep = options.keep ?? AUDIT_KEEP
    this.file = path.join(this.stateDir, AUDIT_FILE)
    /** 写失败计数，`auditHealth()` 用。 */
    this.failedWrites = 0
    /** 最近一次写失败的原因。 */
    this.lastError = null
  }

  /** 第 n 片轮转文件路径（n 从 1 开始，1 = 最近一次）。 */
  rotatedPath(index) {
    return path.join(this.stateDir, `approval-audit.${index}.jsonl`)
  }

  /** 健康度：失败计数 + 最近错误，供页头黄条。 */
  health() {
    return { failedWrites: this.failedWrites, lastError: this.lastError }
  }

  /**
   * 追加一条审计记录（allow/ask/deny 一律写）。
   * @param {object} record - AuditRecord。
   * @returns {Promise<{ok: boolean, error?: string}>} 写结果；失败不抛错。
   */
  async append(record) {
    return enqueue(async () => {
      // 截断放在写入口：无论谁调 append，落盘的 command 都不会超过 4096 字节。
      const line = `${JSON.stringify({ ...record, command: truncateCommand(record.command) })}\n`
      const bytes = Buffer.byteLength(line, 'utf8')
      try {
        await fsp.mkdir(this.stateDir, { recursive: true, mode: 0o700 })
        const size = await this.#sizeOf(this.file)
        if (size > 0 && size + bytes > this.maxBytes) await this.#rotate()
        const handle = await fsp.open(this.file, 'a', 0o600)
        try {
          await handle.writeFile(line, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        return { ok: true }
      } catch (error) {
        this.failedWrites += 1
        this.lastError = error.message
        console.error('[approval] 审计写入失败', error.message)
        return { ok: false, error: error.message }
      }
    })
  }

  /**
   * 查询审计：当前文件不够就往 `.1 → .2 …` 读，最多 6 个文件。
   * 不去重：判定行与其收尾行（`relatedId` 指回来）都会返回。
   * @param {{ from?: string, to?: string, limit?: number, tool?: string, decision?: string }} [query] - 过滤条件。
   * @returns {Promise<object[]>} 按时间升序的记录。
   */
  async read(query = {}) {
    const limit = Math.min(Math.max(Number(query.limit ?? AUDIT_LIMIT_DEFAULT), 1), AUDIT_LIMIT_MAX)
    const files = [this.file, ...Array.from({ length: this.keep }, (_item, index) => this.rotatedPath(index + 1))]
    const collected = []
    for (const candidate of files) {
      if (collected.length >= limit && query.from === undefined) break
      const lines = await this.#readLines(candidate)
      for (const line of lines) {
        const record = parseLine(line)
        if (record === null || !matchesQuery(record, query)) continue
        collected.push(record)
      }
    }
    const records = collected.sort((left, right) => {
      const delta = (timeOf(left.ts) ?? 0) - (timeOf(right.ts) ?? 0)
      return delta !== 0 ? delta : String(left.id).localeCompare(String(right.id))
    })
    return records.slice(Math.max(records.length - limit, 0))
  }

  /**
   * 读一个文件的非空行；ENOENT 重试一次（轮转瞬间文件可能刚被改名）。
   * @param {string} file - 文件路径。
   * @returns {Promise<string[]>} 行。
   */
  async #readLines(file) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const text = await fsp.readFile(file, 'utf8')
        return text.split('\n').filter((line) => line.trim().length > 0)
      } catch (error) {
        if (error.code !== 'ENOENT') return []
        if (attempt === 1) return []
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    return []
  }

  /**
   * 文件大小；不存在算 0。
   * @param {string} file - 文件路径。
   * @returns {Promise<number>} 字节数。
   */
  async #sizeOf(file) {
    try {
      const stat = await fsp.stat(file)
      return stat.size
    } catch (error) {
      if (error.code === 'ENOENT') return 0
      throw error
    }
  }

  /**
   * 轮转：删 `.5` → `.4→.5` … → `.1→.2` → 当前 → `.1`。在写队列里做，不并发。
   * @returns {Promise<void>} 完成。
   */
  async #rotate() {
    await fsp.unlink(this.rotatedPath(this.keep)).catch(() => {})
    for (let index = this.keep - 1; index >= 1; index -= 1) {
      await fsp.rename(this.rotatedPath(index), this.rotatedPath(index + 1)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    await fsp.rename(this.file, this.rotatedPath(1)).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/**
 * 解析一行 JSON；坏行跳过（审计不能因为一行坏了整份读不出）。
 * @param {string} line - JSONL 的一行。
 * @returns {object|null} 记录或 null。
 */
function parseLine(line) {
  try {
    const value = JSON.parse(line)
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * 过滤：from/to 按时间比，tool/decision 精确匹配。
 * @param {object} record - 审计记录。
 * @param {{ from?: string, to?: string, tool?: string, decision?: string }} query - 条件。
 * @returns {boolean} 命中为 true。
 */
function matchesQuery(record, query) {
  if (query.tool !== undefined && record.tool !== query.tool) return false
  if (query.decision !== undefined && record.decision !== query.decision) return false
  const ts = timeOf(record.ts)
  if (query.from !== undefined) {
    const from = timeOf(query.from)
    if (from !== null && ts !== null && ts < from) return false
  }
  if (query.to !== undefined) {
    const to = timeOf(query.to)
    if (to !== null && ts !== null && ts > to) return false
  }
  return true
}
