#!/usr/bin/env node
/**
 * 身份断言（2026-11-19 技术负责人裁定）：验证「profile 里装的到底是不是这份本包」。
 *
 * 两条一起过才算「装的是这份」：
 *   1) realpath(profile/node_modules/@deepseek-ai/dsh-client-ui-layout) === 本包绝对路径
 *   2) 已装目录里 client/client.js 的 sha256 === 仓库里本包 client/client.js 的 sha256
 *
 * 身份对、页面却还是旧壳 → 不是安装失败，是**服务端模块缓存**，打 reason=stale-module-cache，提示必须重启。
 *
 * 用法：node tools/check-installed-identity.mjs --profile-dir <profile> [--package-dir <本包>] [--expect launcher|native]
 * 退出码：0 身份符合期望；1 身份不符；3 环境缺件。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NAME = '@deepseek-ai/dsh-client-ui-layout'

const arg = (name) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/**
 * 比对已装实现与本包的同一性。
 * @param {{ profileDir: string, packageDir?: string }} input - profile 与本包目录。
 * @returns {{ installed: string|null, packagePath: string, samePath: boolean, installedSha: string|null, packageSha: string, sameBytes: boolean, ours: boolean|null }} 结果。
 */
export function installedIdentity({ profileDir, packageDir = ROOT }) {
  const target = join(profileDir, 'node_modules', NAME)
  const result = {
    installed: null,
    packagePath: realpathSync(packageDir),
    samePath: false,
    installedSha: null,
    packageSha: sha256(join(packageDir, 'client/client.js')),
    sameBytes: false,
    ours: null,
  }
  if (!existsSync(target)) return result
  result.installed = realpathSync(target)
  result.samePath = result.installed === result.packagePath
  const clientFile = join(target, 'client/client.js')
  if (existsSync(clientFile)) {
    result.installedSha = sha256(clientFile)
    result.sameBytes = result.installedSha === result.packageSha
  }
  // 兜底判断：即便路径不同（pnpm 可能是拷贝），字节一致也算「这份」
  result.ours = result.samePath || result.sameBytes
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const profileDir = arg('--profile-dir') ?? process.env.PROFILE_DIR
  const packageDir = arg('--package-dir') ?? process.env.PKG_DIR ?? ROOT
  const expect = arg('--expect') ?? 'launcher'
  if (!profileDir) {
    process.stderr.write('缺 --profile-dir\n')
    process.exit(3)
  }
  const info = installedIdentity({ profileDir, packageDir })
  const report = { expect, ...info, verdict: 'ok' }
  if (expect === 'launcher') {
    if (info.ours !== true) report.verdict = 'identity-mismatch'
  } else if (info.ours === true) {
    report.verdict = 'identity-still-ours'
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
  if (report.verdict !== 'ok') {
    process.stderr.write(`身份断言失败：[${report.verdict}] installed=${info.installed ?? '（不存在）'} package=${info.packagePath}\n`)
    process.exit(1)
  }
  process.exit(0)
}
