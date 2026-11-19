/**
 * 策略存储：`~/.dsh/state/approval-policy.json`，原子写 + `version` 乐观锁 + 进程内串行。
 *
 * 三层约定（05-设计 §7.4）：
 * - 临界区：整段「读 → 改 → 写」进 enqueue，只靠 version 会丢更新；
 * - 乐观锁：临界区里比对 ifVersion，不匹配就返回 conflict + 当前文档，绝不覆盖；
 * - 落盘：tmp → fsync → rename，权限 0600；写坏文件不静默重置，改名 `.corrupt.<ts>` 留证。
 *
 * TODO(跨进程)：本版按「单 dsh web 进程」假设，tmp→fsync→rename 只保证不写坏、不保证不丢更新。
 * 若宿主要支持多进程，再加 `approval-policy.lock`（O_EXCL 建锁、5s 视为陈旧可抢、写完即删）。
 */

import { constants as fsConstants } from 'node:fs'
import { isAbsolute } from 'node:path'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { enqueue } from './queue.mjs'
import { ulid } from './ulid.mjs'
import {
  RUN_MODES,
  TOOL_CLASSES,
  TOOL_POLICIES,
  canPermanentAllow,
  commandHash,
  normalizeCommand,
  normalizePath,
} from './decision.mjs'

/** 默认策略文件路径。 */
export const POLICY_FILE = 'approval-policy.json'

/** 默认白名单（存展开后的绝对路径，§7.1）。 */
export const DEFAULT_WHITELIST = ['~/Pod', '~/Pod/tasks']

/** 默认危险命令模式。 */
export const DEFAULT_DANGEROUS_PATTERNS = ['rm -rf', 'git push --force', 'DROP TABLE', 'sudo']

/** 默认工具策略。 */
export const DEFAULT_TOOLS = Object.freeze({
  'fs.read': 'allow',
  'fs.write': 'ask',
  exec: 'ask',
  net: 'ask',
  browser: 'ask',
  'git.push': 'deny',
})

/**
 * 默认状态目录 `~/.dsh/state`。
 * @param {string} [home] - 主目录，测试可注入。
 * @returns {string} 绝对路径。
 */
export function defaultStateDir(home = os.homedir()) {
  return path.join(home, '.dsh', 'state')
}

/**
 * 构造一份默认策略文档。
 * @param {{ home?: string, now?: () => Date }} [options] - 主目录与时钟。
 * @returns {object} PolicyDoc。
 */
export function createDefaultPolicy(options = {}) {
  const home = options.home ?? os.homedir()
  const now = options.now ?? (() => new Date())
  return {
    version: 1,
    runMode: 'auto-safe',
    dangerousGuard: { enabled: true, patterns: [...DEFAULT_DANGEROUS_PATTERNS] },
    dirWhitelist: DEFAULT_WHITELIST.map((dir) => path.join(home, dir.slice(2))),
    tools: { ...DEFAULT_TOOLS },
    permanentAllows: [],
    updatedAt: now().toISOString(),
    updatedBy: 'system',
  }
}

/**
 * 校验一份完整策略文档；不合法就把原因带回去，不抛错。
 * @param {unknown} doc - 待校验对象。
 * @returns {{ ok: true, value: object } | { ok: false, message: string }} 校验结果。
 */
export function validatePolicy(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, message: 'policy 必须是对象' }
  }
  const value = doc
  if (!Number.isInteger(value.version) || value.version < 1) {
    return { ok: false, message: 'version 必须是 ≥1 的整数' }
  }
  if (!RUN_MODES.includes(value.runMode)) {
    return { ok: false, message: `runMode 必须是 ${RUN_MODES.join('/')}` }
  }
  const guard = value.dangerousGuard
  if (guard === null || typeof guard !== 'object' || typeof guard.enabled !== 'boolean') {
    return { ok: false, message: 'dangerousGuard.enabled 必须是布尔' }
  }
  if (!Array.isArray(guard.patterns) || guard.patterns.some((item) => typeof item !== 'string')) {
    return { ok: false, message: 'dangerousGuard.patterns 必须是字符串数组' }
  }
  if (!Array.isArray(value.dirWhitelist) || value.dirWhitelist.some((item) => typeof item !== 'string')) {
    return { ok: false, message: 'dirWhitelist 必须是字符串数组' }
  }
  for (const entry of value.dirWhitelist) {
    if (entry.trim().length === 0) {
      return { ok: false, message: 'dirWhitelist 不能有空项（空项会把任何绝对路径算成白名单内）' }
    }
    if (!(isAbsolute(entry) || entry === '~' || entry.startsWith('~/'))) {
      return { ok: false, message: `dirWhitelist 必须是绝对路径或 ~ 开头：${entry}` }
    }
  }
  if (value.tools === null || typeof value.tools !== 'object' || Array.isArray(value.tools)) {
    return { ok: false, message: 'tools 必须是对象' }
  }
  for (const tool of TOOL_CLASSES) {
    if (!TOOL_POLICIES.includes(value.tools[tool])) {
      return { ok: false, message: `tools.${tool} 必须是 ${TOOL_POLICIES.join('/')}` }
    }
  }
  if (!Array.isArray(value.permanentAllows)) {
    return { ok: false, message: 'permanentAllows 必须是数组' }
  }
  for (const entry of value.permanentAllows) {
    if (entry === null || typeof entry !== 'object') {
      return { ok: false, message: 'permanentAllows 的元素必须是对象' }
    }
    if (typeof entry.id !== 'string' || !TOOL_CLASSES.includes(entry.tool)) {
      return { ok: false, message: 'PermanentAllow.id/tool 不合法' }
    }
    if (entry.scope !== 'exact') {
      return { ok: false, message: 'PermanentAllow.scope 本版只允许 exact' }
    }
    if (typeof entry.command !== 'string' || typeof entry.commandHash !== 'string') {
      return { ok: false, message: 'PermanentAllow.command/commandHash 不合法' }
    }
  }
  if (typeof value.updatedAt !== 'string' || typeof value.updatedBy !== 'string') {
    return { ok: false, message: 'updatedAt/updatedBy 必须是字符串' }
  }
  return { ok: true, value }
}

/**
 * 复验 permanentAllows：`set()` 是外部入口，不能因为「UI 传上来的」就跳过永久允许的三条前提。
 * 逐条查 cwd 是字符串、`commandHash` 与 tool+cwd+command 重算结果一致、`canPermanentAllow` 仍通过（M3）。
 * @param {object[]} entries - 待落盘的永久允许。
 * @param {object} policy - 合并后的策略（取白名单）。
 * @param {string} home - 主目录。
 * @returns {string|null} 有问题的原因；全部通过返回 null。
 */
function permanentAllowProblem(entries, changedIds, policy, home) {
  for (const entry of entries) {
    if (typeof entry.cwd !== 'string' || entry.cwd.length === 0) {
      return `PermanentAllow.cwd 必须是字符串（${entry.id}）`
    }
    if (commandHash(entry.tool, entry.cwd, entry.command) !== entry.commandHash) {
      return `PermanentAllow.commandHash 与 tool/cwd/command 不一致（${entry.id}）`
    }
    // V3-2：只对新写/改过的条目跑三条前提；原样带过来的只做结构自洽校验，
    // 否则「把某目录从白名单去掉」会因为该目录下还留着永久允许而整份保存失败。
    if (!changedIds.has(entry.id)) continue
    const allowed = canPermanentAllow({ tool: entry.tool, command: entry.command, cwd: entry.cwd }, policy, { home })
    if (allowed.ok !== true) {
      return `PermanentAllow 不满足永久允许前提（${entry.id}）：${allowed.reason}`
    }
  }
  return null
}

/**
 * 深合并一个 patch；未知字段原样带进来，交给 validatePolicy 拒。
 * @param {object} doc - 当前文档。
 * @param {object} patch - 局部更新。
 * @returns {object} 合并结果（不改原对象）。
 */
function mergePatch(doc, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return patch
  }
  const next = { ...doc, ...patch }
  if (patch.dangerousGuard !== undefined) {
    next.dangerousGuard = { ...doc.dangerousGuard, ...patch.dangerousGuard }
  }
  if (patch.tools !== undefined) {
    next.tools = { ...doc.tools, ...patch.tools }
  }
  return next
}

/**
 * 把目录 fsync 一次，保证 rename 后的目录项落盘；不支持的环境静默跳过。
 * @param {string} dir - 目录。
 * @returns {Promise<void>} 完成。
 */
async function syncDirectory(dir) {
  let handle = null
  try {
    handle = await fsp.open(dir, 'r')
    await handle.sync()
  } catch {
    // 有的文件系统不支持目录 fsync，不阻塞写入。
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * 策略存储。
 */
export class PolicyStore {
  /**
   * @param {{ stateDir?: string, home?: string, now?: () => Date }} [options] - 目录、主目录、时钟。
   */
  constructor(options = {}) {
    this.home = options.home ?? os.homedir()
    this.stateDir = options.stateDir ?? defaultStateDir(this.home)
    this.now = options.now ?? (() => new Date())
    this.file = path.join(this.stateDir, POLICY_FILE)
    /** 最近一次坏文件的备份路径，供黄条提示使用。 */
    this.corruptBackup = null
    /** 写失败计数（磁盘满等），不阻塞判定。 */
    this.writeFailures = 0
  }

  /** 当前策略文件路径。 */
  get filePath() {
    return this.file
  }

  /**
   * 读当前策略；文件不存在给默认值，解析失败改名备份后给默认值。
   * @returns {Promise<object>} PolicyDoc。
   */
  async get() {
    const { doc } = await enqueue(() => this.#read())
    return doc
  }

  /**
   * 按版本号更新策略。版本不匹配返回 conflict + 当前文档，不覆盖。
   * @param {object} patch - 局部更新（version/updatedAt/updatedBy 不接受）。
   * @param {number} ifVersion - 调用方看到的版本号。
   * @returns {Promise<{ok: true, doc: object} | {ok: false, reason: 'conflict', current: object} | {ok: false, reason: 'invalid', message: string}>} 结果。
   */
  async set(patch, ifVersion) {
    return enqueue(async () => {
      const { doc } = await this.#read()
      if (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) {
        for (const key of ['version', 'updatedAt', 'updatedBy']) {
          if (key in patch) {
            return { ok: false, reason: 'invalid', message: `${key} 由存储维护，patch 不接受` }
          }
        }
      }
      if (doc.version !== ifVersion) {
        return { ok: false, reason: 'conflict', current: doc }
      }
      const checked = validatePolicy(mergePatch(doc, patch))
      if (checked.ok !== true) {
        return { ok: false, reason: 'invalid', message: checked.message }
      }
      const before = new Map(doc.permanentAllows.map((entry) => [entry.id, entry]))
      const changedIds = new Set(
        checked.value.permanentAllows
          .filter((entry) => {
            const previous = before.get(entry.id)
            return previous === undefined
              || previous.tool !== entry.tool
              || previous.cwd !== entry.cwd
              || previous.command !== entry.command
              || previous.commandHash !== entry.commandHash
          })
          .map((entry) => entry.id),
      )
      const allowProblem = permanentAllowProblem(checked.value.permanentAllows, changedIds, checked.value, this.home)
      if (allowProblem !== null) {
        return { ok: false, reason: 'invalid', message: allowProblem }
      }
      const next = {
        ...checked.value,
        version: doc.version + 1,
        updatedAt: this.now().toISOString(),
        updatedBy: 'user:local',
      }
      const written = await this.#write(next)
      if (written.ok !== true) return written
      return { ok: true, doc: next }
    })
  }

  /**
   * 写入一条「始终允许」；三条前提不满足就不写（§7.2），返回原因。
   * @param {{ tool: string, command?: string, cwd?: string }} call - 用户点「始终允许」时的调用。
   * @returns {Promise<{ok: boolean, doc?: object, allow?: object, reason?: string}>} 结果。
   */
  async addPermanentAllow(call) {
    return enqueue(async () => {
      const { doc } = await this.#read()
      const allowed = canPermanentAllow(call, doc, { home: this.home })
      if (allowed.ok !== true) return { ok: false, reason: allowed.reason }
      const command = normalizeCommand(call.command)
      const cwd = normalizePath(
        typeof call.cwd === 'string' && call.cwd.length > 0 ? call.cwd : this.home,
        this.home,
      )
      const hash = commandHash(call.tool, cwd, command)
      const existing = doc.permanentAllows.find(
        (entry) => entry.tool === call.tool && entry.cwd === cwd && entry.commandHash === hash,
      )
      if (existing !== undefined) return { ok: true, doc, allow: existing }
      const allow = {
        id: ulid(this.now().getTime()),
        tool: call.tool,
        cwd,
        command,
        commandHash: hash,
        scope: 'exact',
        createdAt: this.now().toISOString(),
      }
      const next = {
        ...doc,
        version: doc.version + 1,
        permanentAllows: [...doc.permanentAllows, allow],
        updatedAt: this.now().toISOString(),
        updatedBy: 'user:local',
      }
      const written = await this.#write(next)
      if (written.ok !== true) return written
      return { ok: true, doc: next, allow }
    })
  }

  /**
   * 读文件并解析；坏文件改名备份，不静默重置。
   * @returns {Promise<{doc: object, corrupt: boolean}>} 文档与是否刚从坏文件恢复。
   */
  async #read() {
    let text = null
    try {
      text = await fsp.readFile(this.file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') return { doc: createDefaultPolicy({ home: this.home, now: this.now }), corrupt: false }
      throw error
    }
    let parsed = null
    let problem = null
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      problem = error.message
    }
    const checked = problem === null ? validatePolicy(parsed) : { ok: false, message: problem }
    if (checked.ok === true) return { doc: checked.value, corrupt: false }

    const stamp = this.now().toISOString().replace(/[:.]/gu, '-')
    const backup = path.join(this.stateDir, `approval-policy.corrupt.${stamp}.json`)
    try {
      await fsp.rename(this.file, backup)
      this.corruptBackup = backup
    } catch {
      // 改名失败就保留原文件；下面照默认值走，不删用户数据。
    }
    return { doc: createDefaultPolicy({ home: this.home, now: this.now }), corrupt: true }
  }

  /**
   * 原子写：tmp → fsync → rename → 0600，任何一步失败都不留半份文件。
   * @param {object} doc - 待写文档。
   * @returns {Promise<{ok: true} | {ok: false, reason: 'io', message: string}>} 结果。
   */
  async #write(doc) {
    const dir = path.dirname(this.file)
    const tmp = path.join(dir, `.approval-policy.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
    try {
      await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
      const handle = await fsp.open(tmp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(doc, null, 2)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fsp.chmod(tmp, 0o600)
      await fsp.rename(tmp, this.file)
      await syncDirectory(dir)
      return { ok: true }
    } catch (error) {
      this.writeFailures += 1
      await fsp.unlink(tmp).catch(() => {})
      return { ok: false, reason: 'io', message: error.message }
    }
  }
}
