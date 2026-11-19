/**
 * 判定纯函数的七步用例 + 4 档 × 6 类矩阵（05-设计 §7.2、§10-7/8）。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TOOL_CLASSES,
  RUN_MODES,
  canPermanentAllow,
  commandHash,
  decide,
  isInsideWhitelist,
  normalizeCommand,
  normalizePath,
} from '../lib/approval/decision.mjs'
import { createDefaultPolicy } from '../lib/approval/policy-store.mjs'

const HOME = '/Users/tester'
const WHITELIST = [`${HOME}/Pod`, `${HOME}/Pod/tasks`]

/**
 * 造一份策略：默认值 + 局部覆盖。
 * @param {object} [patch] - 覆盖项。
 * @returns {object} 策略文档。
 */
function policyOf(patch = {}) {
  const base = createDefaultPolicy({ home: HOME, now: () => new Date('2026-11-19T12:00:00.000Z') })
  return { ...base, ...patch, dirWhitelist: patch.dirWhitelist ?? WHITELIST }
}

/** 一次普通的工具调用。 */
function callOf(patch = {}) {
  return { tool: 'fs.read', command: '', cwd: `${HOME}/Pod`, paths: [], ...patch }
}

test('矩阵：4 档 × 6 类工具，默认策略下的判定与 decidedBy', () => {
  const expected = {
    readonly: {
      'fs.read': ['allow', 'tool-policy'],
      'fs.write': ['deny', 'runmode'],
      exec: ['deny', 'runmode'],
      net: ['deny', 'runmode'],
      browser: ['deny', 'runmode'],
      'git.push': ['deny', 'runmode'],
    },
    ask: {
      'fs.read': ['allow', 'tool-policy'],
      'fs.write': ['ask', 'tool-policy'],
      exec: ['ask', 'tool-policy'],
      net: ['ask', 'tool-policy'],
      browser: ['ask', 'tool-policy'],
      'git.push': ['deny', 'tool-policy'],
    },
    'auto-safe': {
      'fs.read': ['allow', 'tool-policy'],
      'fs.write': ['ask', 'tool-policy'],
      exec: ['ask', 'tool-policy'],
      net: ['ask', 'tool-policy'],
      browser: ['ask', 'tool-policy'],
      'git.push': ['deny', 'tool-policy'],
    },
    full: {
      'fs.read': ['allow', 'tool-policy'],
      'fs.write': ['allow', 'runmode'],
      exec: ['allow', 'runmode'],
      net: ['allow', 'runmode'],
      browser: ['allow', 'runmode'],
      'git.push': ['deny', 'tool-policy'],
    },
  }

  for (const runMode of RUN_MODES) {
    const policy = policyOf({ runMode })
    for (const tool of TOOL_CLASSES) {
      const verdict = decide(policy, callOf({ tool }), { home: HOME })
      const [decision, decidedBy] = expected[runMode][tool]
      assert.deepEqual(
        [verdict.decision, verdict.decidedBy],
        [decision, decidedBy],
        `${runMode} × ${tool}`,
      )
    }
  }
})

test('第 1 步：readonly 下写类一律 deny，危险命令也轮不到第 3 步', () => {
  const policy = policyOf({ runMode: 'readonly' })
  const verdict = decide(policy, callOf({ tool: 'exec', command: 'sudo rm -rf /' }), { home: HOME })
  assert.equal(verdict.decision, 'deny')
  assert.equal(verdict.decidedBy, 'runmode')
  assert.equal(verdict.matchedRule, undefined)
})

test('第 2 步：tools[tool] 为 deny 时，full 也 deny', () => {
  const policy = policyOf({ runMode: 'full' })
  const verdict = decide(policy, callOf({ tool: 'git.push', command: 'git push origin main' }), { home: HOME })
  assert.deepEqual([verdict.decision, verdict.decidedBy], ['deny', 'tool-policy'])
})

test('第 3 步：dangerousGuard 命中即 ask，matchedRule 带模式名', () => {
  const policy = policyOf({ runMode: 'full', dangerousGuard: { enabled: true, patterns: ['sudo'] } })
  const verdict = decide(policy, callOf({ tool: 'exec', command: 'sudo  rm -rf  /tmp' }), { home: HOME })
  assert.equal(verdict.decision, 'ask')
  assert.equal(verdict.decidedBy, 'danger-guard')
  assert.equal(verdict.matchedRule, 'danger:sudo')
})

test('G1：full 档 + enabled=false，危险命令仍要问，matchedRule 带 guard-off', () => {
  const policy = policyOf({ runMode: 'full', dangerousGuard: { enabled: false, patterns: ['rm -rf'] } })
  const verdict = decide(policy, callOf({ tool: 'exec', command: 'rm -rf /tmp/x' }), { home: HOME })
  assert.deepEqual([verdict.decision, verdict.decidedBy], ['ask', 'danger-guard'])
  assert.equal(verdict.matchedRule, 'danger:rm -rf|guard-off')
})

test('G2：auto-safe + tools.exec=allow + enabled=false，sudo 仍要问', () => {
  const policy = policyOf({
    runMode: 'auto-safe',
    tools: { ...policyOf().tools, exec: 'allow' },
    dangerousGuard: { enabled: false, patterns: ['sudo'] },
  })
  const verdict = decide(policy, callOf({ tool: 'exec', command: 'sudo ls' }), { home: HOME })
  assert.deepEqual([verdict.decision, verdict.decidedBy], ['ask', 'danger-guard'])
  assert.match(verdict.matchedRule, /guard-off/u)
})

test('enabled=true 时只记 danger:<pattern>，不带 guard-off', () => {
  const policy = policyOf({ runMode: 'full', dangerousGuard: { enabled: true, patterns: ['sudo'] } })
  const verdict = decide(policy, callOf({ tool: 'exec', command: 'sudo ls' }), { home: HOME })
  assert.deepEqual([verdict.decision, verdict.decidedBy], ['ask', 'danger-guard'])
  assert.equal(verdict.matchedRule, 'danger:sudo')
})

test('第 4 步：永久允许按唯一键命中才放行', () => {
  const cwd = `${HOME}/Pod`
  const command = 'rm tmp.txt'
  const allow = {
    id: '01JC0000000000000000000001',
    tool: 'exec',
    cwd,
    command,
    commandHash: commandHash('exec', cwd, command),
    scope: 'exact',
    createdAt: '2026-11-19T12:00:00.000Z',
  }
  const policy = policyOf({ runMode: 'auto-safe', permanentAllows: [allow] })
  const hit = decide(policy, callOf({ tool: 'exec', command: '  rm   tmp.txt ', cwd }), { home: HOME })
  assert.deepEqual([hit.decision, hit.decidedBy], ['allow', 'permanent'])
  assert.equal(hit.matchedRule, `perm:${allow.id}`)
})

test('第 5 步：写类路径出白名单即 ask，full 也 ask', () => {
  const policy = policyOf({ runMode: 'full' })
  const inside = decide(policy, callOf({ tool: 'fs.write', paths: [`${HOME}/Pod/a.md`] }), { home: HOME })
  const outside = decide(policy, callOf({ tool: 'fs.write', paths: ['/etc/passwd'] }), { home: HOME })
  assert.deepEqual([inside.decision, inside.decidedBy], ['allow', 'runmode'])
  assert.deepEqual([outside.decision, outside.decidedBy], ['ask', 'dir-scope'])
  assert.equal(outside.matchedRule, 'dir:out-of-whitelist')
})

test('第 5 步：exec 看显式传入的 cwd——cd /etc 在 full 档也要问', () => {
  const policy = policyOf({ runMode: 'full' })
  const outside = decide(policy, callOf({ tool: 'exec', command: 'cat hosts', cwd: '/etc' }), { home: HOME })
  const inside = decide(policy, callOf({ tool: 'exec', command: 'ls', cwd: `${HOME}/Pod` }), { home: HOME })
  assert.deepEqual([outside.decision, outside.decidedBy], ['ask', 'dir-scope'])
  assert.equal(outside.matchedRule, 'dir:out-of-whitelist')
  assert.deepEqual([inside.decision, inside.decidedBy], ['allow', 'runmode'])
})

test('第 5 步：exec 没传 cwd 就不按默认 home 判，避免噪音', () => {
  const policy = policyOf({ runMode: 'full' })
  const verdict = decide(policy, { tool: 'exec', command: 'ls' }, { home: HOME })
  assert.deepEqual([verdict.decision, verdict.decidedBy], ['allow', 'runmode'])
})

test('第 6 步：tools allow 走 tool-policy，full 走 runmode', () => {
  const allowTool = decide(policyOf({ runMode: 'ask' }), callOf({ tool: 'fs.read' }), { home: HOME })
  const fullMode = decide(policyOf({ runMode: 'full' }), callOf({ tool: 'net' }), { home: HOME })
  assert.deepEqual([allowTool.decision, allowTool.decidedBy], ['allow', 'tool-policy'])
  assert.deepEqual([fullMode.decision, fullMode.decidedBy], ['allow', 'runmode'])
})

test('第 7 步：不在工具表里的类也落到 ask', () => {
  const policy = policyOf({ runMode: 'auto-safe' })
  const verdict = decide(policy, callOf({ tool: 'unknown.tool' }), { home: HOME })
  assert.deepEqual([verdict.decision, verdict.decidedBy], ['ask', 'tool-policy'])
})

test('永久允许不泛化：同命令才命中，换个文件就回到 ask', () => {
  const cwd = `${HOME}/Pod`
  const allow = {
    id: '01JC0000000000000000000002',
    tool: 'exec',
    cwd,
    command: 'rm tmp.txt',
    commandHash: commandHash('exec', cwd, 'rm tmp.txt'),
    scope: 'exact',
    createdAt: '2026-11-19T12:00:00.000Z',
  }
  const policy = policyOf({ runMode: 'auto-safe', permanentAllows: [allow] })
  const same = decide(policy, callOf({ tool: 'exec', command: 'rm tmp.txt', cwd }), { home: HOME })
  const other = decide(policy, callOf({ tool: 'exec', command: 'rm other.txt', cwd }), { home: HOME })
  const otherCwd = decide(policy, callOf({ tool: 'exec', command: 'rm tmp.txt', cwd: `${HOME}/elsewhere` }), { home: HOME })
  assert.equal(same.decision, 'allow')
  assert.equal(other.decision, 'ask')
  assert.equal(otherCwd.decision, 'ask')
})

test('canPermanentAllow：shell 元字符、变量替换、超长、exec 出白名单都不给', () => {
  const policy = policyOf()
  const base = { tool: 'exec', cwd: `${HOME}/Pod`, command: 'rm tmp.txt' }
  assert.equal(canPermanentAllow(base, policy, { home: HOME }).ok, true)
  assert.equal(canPermanentAllow({ ...base, command: 'rm a | b' }, policy, { home: HOME }).ok, false)
  assert.equal(canPermanentAllow({ ...base, command: 'rm $HOME/x' }, policy, { home: HOME }).ok, false)
  assert.equal(canPermanentAllow({ ...base, command: 'rm `whoami`' }, policy, { home: HOME }).ok, false)
  assert.equal(canPermanentAllow({ ...base, command: `rm ${'a'.repeat(1100)}` }, policy, { home: HOME }).ok, false)
  assert.equal(
    canPermanentAllow({ ...base, cwd: '/tmp' }, policy, { home: HOME }).reason,
    'exec-outside-whitelist',
  )
  assert.equal(canPermanentAllow({ tool: 'fs.write', cwd: `${HOME}/Pod`, command: 'a.txt' }, policy, { home: HOME }).ok, true)
})

test('白名单前缀不做宽匹配：/Users/tester/Pod-other 不算 /Users/tester/Pod 里', () => {
  assert.equal(isInsideWhitelist(`${HOME}/Pod/a`, WHITELIST, HOME, HOME), true)
  assert.equal(isInsideWhitelist(`${HOME}/Pod-other/a`, WHITELIST, HOME, HOME), false)
  assert.equal(isInsideWhitelist(`${HOME}/Pod/tasks/x`, WHITELIST, HOME, HOME), true)
})

test('B1-v3：空白名单项不能变成「什么都算在内」', () => {
  assert.equal(isInsideWhitelist('/etc/passwd', [''], HOME, HOME), false)
  assert.equal(isInsideWhitelist(`${HOME}/Pod/a`, ['', `${HOME}/Pod`], HOME, HOME), true)
  assert.equal(isInsideWhitelist('/etc/passwd', ['', `${HOME}/Pod`], HOME, HOME), false)

  const policy = policyOf({ runMode: 'full', dirWhitelist: [''] })
  const write = decide(policy, callOf({ tool: 'fs.write', paths: ['/etc/passwd'] }), { home: HOME })
  const exec = decide(policy, callOf({ tool: 'exec', command: 'cat hosts', cwd: '/etc' }), { home: HOME })
  assert.deepEqual([write.decision, write.decidedBy], ['ask', 'dir-scope'])
  assert.deepEqual([exec.decision, exec.decidedBy], ['ask', 'dir-scope'])
  assert.equal(canPermanentAllow({ tool: 'exec', command: 'rm tmp.txt', cwd: '/etc' }, policy, { home: HOME }).ok, false)
})

test('V3-1：永久允许键里的 cwd 归一化，~/Pod/./ 与 ~/Pod 同一个键', () => {
  const base = `${HOME}/Pod`
  const command = 'rm tmp.txt'
  const allow = {
    id: '01JC0000000000000000000012',
    tool: 'exec',
    cwd: base,
    command,
    commandHash: commandHash('exec', base, command),
    scope: 'exact',
    createdAt: '2026-11-19T12:00:00.000Z',
  }
  const policy = policyOf({ runMode: 'auto-safe', permanentAllows: [allow] })
  const dotted = decide(policy, callOf({ tool: 'exec', command, cwd: `${base}/./` }), { home: HOME })
  assert.deepEqual([dotted.decision, dotted.decidedBy], ['allow', 'permanent'])
})

test('V32-1：危险命令不给「始终允许」，关名单也一样', () => {
  const on = policyOf()
  const off = policyOf({ dangerousGuard: { enabled: false, patterns: ['rm -rf'] } })
  const call = { tool: 'exec', command: 'rm -rf /tmp/x', cwd: `${HOME}/Pod` }
  assert.deepEqual(canPermanentAllow(call, on, { home: HOME }), { ok: false, reason: 'dangerous-command' })
  assert.deepEqual(canPermanentAllow(call, off, { home: HOME }), { ok: false, reason: 'dangerous-command' }, 'enabled 只影响标注，不放开永久允许')
})

test('M1/M2 共用 normalizePath：exec 的 call.cwd 与 paths 同一套归一化', () => {
  assert.equal(normalizePath(`${HOME}/Pod/../etc`), `${HOME}/etc`)
  assert.equal(normalizePath(`${HOME}/Pod/./sub/../a.md`), `${HOME}/Pod/a.md`)
  const policy = policyOf({ runMode: 'full' })
  const dottedInside = decide(
    policy,
    callOf({ tool: 'exec', command: 'ls', cwd: `${HOME}/Pod/./tasks/../x` }),
    { home: HOME },
  )
  assert.deepEqual([dottedInside.decision, dottedInside.decidedBy], ['allow', 'runmode'], '归一化后仍在 Pod 内，不误伤')
})

test('M1：绝对路径带 .. 先归一化再比，穿不出白名单', () => {
  const policy = policyOf({ runMode: 'full' })
  const escapeWrite = decide(policy, callOf({ tool: 'fs.write', paths: [`${HOME}/Pod/../../etc/passwd`] }), { home: HOME })
  const escapeExec = decide(policy, callOf({ tool: 'exec', command: 'cat hosts', cwd: `${HOME}/Pod/../../etc` }), { home: HOME })
  const sibling = decide(policy, callOf({ tool: 'fs.write', paths: [`${HOME}/Pod/../Pod2/x`] }), { home: HOME })
  const inside = decide(policy, callOf({ tool: 'fs.write', paths: [`${HOME}/Pod/./sub/../a.md`] }), { home: HOME })

  assert.deepEqual([escapeWrite.decision, escapeWrite.decidedBy], ['ask', 'dir-scope'])
  assert.deepEqual([escapeExec.decision, escapeExec.decidedBy], ['ask', 'dir-scope'])
  assert.deepEqual([sibling.decision, sibling.decidedBy], ['ask', 'dir-scope'])
  assert.deepEqual([inside.decision, inside.decidedBy], ['allow', 'runmode'], '归一化后仍在白名单内不误伤')
})

test('normalizeCommand：压空白、去首尾', () => {
  assert.equal(normalizeCommand('  rm   -rf \n /tmp '), 'rm -rf /tmp')
  assert.equal(normalizeCommand(undefined), '')
})
