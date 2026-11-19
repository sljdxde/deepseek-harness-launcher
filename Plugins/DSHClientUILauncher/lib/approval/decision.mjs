/**
 * 审批判定：纯函数，无 I/O、无全局状态、不 import client 任何东西。
 *
 * 七步顺序就是安全边界（05-设计 §7.2），先命中先返回，`decidedBy` 记录命中者。
 * 顺序不许调、步骤不许合并——要动先改文档并通知技术负责人。
 *
 * @see docs/features/0.2.0-dsh-launcher-new-ui/05-设计.md §7.2
 */

import { createHash } from 'node:crypto'
import { isAbsolute, resolve, sep } from 'node:path'

/** 四档运行模式。 */
export const RUN_MODES = Object.freeze(['readonly', 'ask', 'auto-safe', 'full'])

/** 六类工具。 */
export const TOOL_CLASSES = Object.freeze(['fs.read', 'fs.write', 'exec', 'net', 'browser', 'git.push'])

/** 三档工具策略。 */
export const TOOL_POLICIES = Object.freeze(['allow', 'ask', 'deny'])

/** shell 元字符：命中任意一个就不允许写 PermanentAllow（§7.2「始终允许怎么落」a）。 */
const SHELL_METACHARACTERS = /[|;&><$`*?~()]/

/** 变量替换的另一种写法（`${...}` 已由 `$` 覆盖，这里兜住 `$VAR` 与反斜杠转义）。 */
const VARIABLE_SUBSTITUTION = /\$[A-Za-z_{]|\\\$/

/** 永久允许命令的长度上限（归一化后，字符数）。 */
export const PERMANENT_COMMAND_LIMIT = 1024

/**
 * 归一化命令：去首尾空白，连续空白压成一个空格。
 * 判定与「始终允许」写入都用它，保证同一份文本两边算出的 hash 一致。
 * @param {string} command - 原始命令。
 * @returns {string} 归一化后的命令。
 */
export function normalizeCommand(command) {
  if (typeof command !== 'string') return ''
  return command.trim().replace(/\s+/gu, ' ')
}

/**
 * 永久允许的唯一键：sha256(tool + '\0' + cwd + '\0' + command)。
 * @param {string} tool - 工具类。
 * @param {string} cwd - 判定时的绝对工作目录。
 * @param {string} command - 归一化后的命令。
 * @returns {string} 十六进制摘要。
 */
export function commandHash(tool, cwd, command) {
  return createHash('sha256')
    .update(`${tool}\0${cwd}\0${normalizeCommand(command)}`)
    .digest('hex')
}

/**
 * 路径归一化：`resolve()` 吃掉 `..`、`.`、重复分隔符与相对段。
 *
 * **M1 与 M2 共用这一个入口**：白名单里的 `paths`（写类）与 exec 的 `call.cwd`
 * 都先过这里再比前缀，避免两条判定各自漏一种写法。
 * @param {string} target - 原始路径。
 * @param {string} [base] - 相对路径的基准目录，默认进程 cwd。
 * @returns {string} 归一化后的绝对路径；空输入返回空串。
 */
export function normalizePath(target, base) {
  if (typeof target !== 'string' || target.length === 0) return ''
  return resolve(base ?? process.cwd(), target)
}

/**
 * 展开 `~` 后的绝对路径。
 * @param {string} target - 可能是 `~/Pod` 的路径。
 * @param {string} home - 用户主目录。
 * @returns {string} 绝对值归一化后的路径。
 */
export function expandPath(target, home) {
  if (typeof target !== 'string') return ''
  if (target === '~') return normalizePath(home, home)
  if (target.startsWith('~/')) return normalizePath(target.slice(2), home)
  return normalizePath(target, home)
}

/**
 * 判断一个路径是否落在白名单目录里（含目录自身，不含前缀相同的兄弟目录）。
 * @param {string} target - 待判定的路径。
 * @param {string[]} whitelist - 白名单目录（可含 `~`）。
 * @param {string} cwd - 相对路径的基准目录。
 * @param {string} home - 用户主目录。
 * @returns {boolean} 命中任一目录为 true。
 */
export function isInsideWhitelist(target, whitelist, cwd, home) {
  // 两侧都走 normalizePath：`..` / `.` / 重复分隔符先归一化，再做前缀比较（M1）。
  const abs = normalizePath(target, cwd ?? home)
  if (abs === '') return false
  for (const dir of whitelist ?? []) {
    // 空项不能变成「什么都算在内」：`'' + sep === '/'` 会让任何绝对路径命中（B1-v3）。
    if (typeof dir !== 'string' || dir.trim().length === 0) continue
    const base = normalizePath(expandPath(dir, home), home)
    if (base === '') continue
    if (abs === base) return true
    if (abs.startsWith(base.endsWith(sep) ? base : base + sep)) return true
  }
  return false
}

/**
 * 危险命令匹配：归一化后、忽略大小写的子串匹配（`DROP TABLE` 与 `drop table` 同命中）。
 * @param {string} pattern - 配置里的模式。
 * @param {string} command - 归一化后的命令。
 * @returns {boolean} 命中为 true。
 */
export function matchesDangerousPattern(pattern, command) {
  const needle = normalizeCommand(pattern).toLowerCase()
  if (needle.length === 0) return false
  return command.toLowerCase().includes(needle)
}

/**
 * 这条命令能不能写成「始终允许」。三条必须同时成立（§7.2）：
 * (a) 不含 shell 元字符与变量替换；(b) 不是 exec，或工作目录在白名单内；(c) 归一化后 ≤ 1024。
 * 不满足就禁用按钮——不生成「同类命令」规则，也不写路径前缀通配。
 * @param {{ tool: string, command?: string, cwd?: string, paths?: string[] }} call - 工具调用。
 * @param {{ dirWhitelist?: string[] }} policy - 当前策略（取白名单）。
 * @param {{ home?: string }} [options] - 主目录。
 * @returns {{ ok: boolean, reason?: string }} 判定结果与不可用的原因。
 */
export function canPermanentAllow(call, policy, options = {}) {
  const home = options.home ?? process.env.HOME ?? '/'
  const command = normalizeCommand(call?.command)
  if (command.length === 0) return { ok: false, reason: 'empty-command' }
  if (SHELL_METACHARACTERS.test(command) || VARIABLE_SUBSTITUTION.test(command)) {
    return { ok: false, reason: 'shell-metacharacter' }
  }
  if (command.length > PERMANENT_COMMAND_LIMIT) return { ok: false, reason: 'too-long' }
  // 危险命令永远轮不到第 4 步（第 3 步先问），写进来也是死键、等于给用户一个假按钮（V32-1）。
  const guard = policy?.dangerousGuard
  if ((guard?.patterns ?? []).some((pattern) => matchesDangerousPattern(pattern, command))) {
    return { ok: false, reason: 'dangerous-command' }
  }
  if (call.tool === 'exec') {
    const cwd = call.cwd ?? home
    if (!isInsideWhitelist(cwd, policy?.dirWhitelist ?? [], home, home)) {
      return { ok: false, reason: 'exec-outside-whitelist' }
    }
  }
  return { ok: true }
}

/**
 * 对一次工具调用做判定。
 * @param {object} policy - 策略文档（§7.1）。
 * @param {{ tool: string, command?: string, cwd?: string, paths?: string[], toolCallId?: string }} call - 工具调用。
 * @param {{ home?: string }} [ctx] - 判定上下文（主目录；无状态，可省略）。
 * @returns {{ decision: 'allow'|'ask'|'deny', decidedBy: string, matchedRule?: string }} 判定结果。
 */
export function decide(policy, call, ctx = {}) {
  const home = ctx.home ?? process.env.HOME ?? '/'
  const tool = call?.tool
  const command = normalizeCommand(call?.command)
  // 第 4 步的永久允许键与 addPermanentAllow 用同一个 normalizePath 算，`~/Pod/./` 与 `~/Pod` 是同一个键（V3-1）。
  const cwd = normalizePath(typeof call?.cwd === 'string' && call.cwd.length > 0 ? call.cwd : home, home)
  const tools = policy?.tools ?? {}
  const runMode = policy?.runMode

  // 1. 只读档：除 fs.read 外一律拒绝。放在最前面，任何后续规则都不能把它放过。
  if (runMode === 'readonly' && tool !== 'fs.read') {
    return { decision: 'deny', decidedBy: 'runmode' }
  }

  // 2. 工具策略显式 deny。
  if (tools[tool] === 'deny') {
    return { decision: 'deny', decidedBy: 'tool-policy' }
  }

  // 3. 危险命令：命中一律 ask，即使 full、即使 tools[tool]==='allow'。
  //    `enabled` 不参与判定（2026-11-19 裁定 G1/G2）：它只控「是否亮危险标记」，
  //    false 时仍然问，matchedRule 记 `guard-off`，取证时能看出当时没标注。
  const guard = policy?.dangerousGuard
  if (command.length > 0) {
    const hit = (guard?.patterns ?? []).find((pattern) => matchesDangerousPattern(pattern, command))
    if (hit !== undefined) {
      const rule = `danger:${normalizeCommand(hit)}`
      return {
        decision: 'ask',
        decidedBy: 'danger-guard',
        matchedRule: guard?.enabled === false ? `${rule}|guard-off` : rule,
      }
    }
  }

  // 4. 永久允许：唯一键完全一致才放行，不做泛化。
  const hash = commandHash(tool, cwd, command)
  const permanent = (policy?.permanentAllows ?? []).find(
    (entry) => entry.tool === tool && entry.cwd === cwd && entry.commandHash === hash,
  )
  if (permanent !== undefined) {
    return { decision: 'allow', decidedBy: 'permanent', matchedRule: `perm:${permanent.id}` }
  }

  // 5. 目录白名单：写类看路径参数，exec 额外看显式传入的 cwd（`cd /etc && …` 不能被放过）。
  //    调用方没传 cwd 时不判，避免把默认 home 变成噪音。
  const whitelist = policy?.dirWhitelist ?? []
  const requestedPaths = Array.isArray(call?.paths) ? call.paths : []
  const outsidePath = requestedPaths.some(
    (target) => !isInsideWhitelist(target, whitelist, cwd, home),
  )
  // M2 与 M1 共用 normalizePath：`/Pod/../etc` 从这里绕不过去。
  const explicitCwd = typeof call?.cwd === 'string' && isAbsolute(call.cwd) ? normalizePath(call.cwd, home) : null
  const outsideCwd = tool === 'exec' && explicitCwd !== null && !isInsideWhitelist(explicitCwd, whitelist, cwd, home)
  if ((tool === 'fs.write' || tool === 'exec') && (outsidePath || outsideCwd)) {
    return { decision: 'ask', decidedBy: 'dir-scope', matchedRule: 'dir:out-of-whitelist' }
  }

  // 6. 显式 allow 或全自动。
  if (tools[tool] === 'allow') {
    return { decision: 'allow', decidedBy: 'tool-policy' }
  }
  if (runMode === 'full') {
    return { decision: 'allow', decidedBy: 'runmode' }
  }

  // 7. 其余，包括工具类不在 tools 表里：默认问。
  return { decision: 'ask', decidedBy: 'tool-policy' }
}
