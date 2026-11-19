#!/usr/bin/env node
/**
 * 版本锁（裁决 2026-11-19 §1）：本包是 layout 的同名 drop-in，**必须**与宿主 ui-layout 版本一致，
 * 版本不符就让构建/安装直接失败退出——绝不允许静默用旧产物顶上去。
 *
 * 用法：node tools/check-host-version.mjs [--host-version x.y.z]
 * 退出码：0 一致、1 不一致、3 读不到契约快照。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 比对包版本与宿主 layout 版本。
 * @param {{ hostVersion?: string }} [options] - 显式宿主版本（默认取 contracts/host-baseline.json）。
 * @returns {{ ok: boolean, packageVersion: string, hostVersion: string, reason?: string }} 结果。
 */
export function checkHostVersion({ hostVersion } = {}) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const baseline = JSON.parse(readFileSync(join(ROOT, 'contracts', 'host-baseline.json'), 'utf8'))
  const host = hostVersion ?? baseline?.host?.layoutVersion
  if (typeof host !== 'string' || host.length === 0) {
    return { ok: false, packageVersion: manifest.version, hostVersion: String(host), reason: 'contract-snapshot-missing' }
  }
  if (manifest.version !== host) {
    return { ok: false, packageVersion: manifest.version, hostVersion: host, reason: 'version-mismatch' }
  }
  return { ok: true, packageVersion: manifest.version, hostVersion: host }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--host-version')
  const result = checkHostVersion({ hostVersion: index >= 0 ? process.argv[index + 1] : undefined })
  if (result.ok) {
    process.stdout.write(`版本锁通过：${result.packageVersion}（与宿主 ui-layout 一致）\n`)
    process.exit(0)
  }
  process.stderr.write(`版本锁失败（${result.reason}）：本包 ${result.packageVersion}，宿主 ${result.hostVersion}。`
    + '同名 drop-in 必须与宿主版本一致，请对齐后重试（不允许静默用旧产物）。\n')
  process.exit(result.reason === 'contract-snapshot-missing' ? 3 : 1)
}
