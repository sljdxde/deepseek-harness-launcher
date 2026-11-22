#!/usr/bin/env node
/**
 * 版本锁（裁决 2026-11-19 §1，三方比对版）。
 *
 * 本包是 layout 的同名 drop-in，必须与**真实宿主**、**契约基线**、**本包**三者版本一致；
 * 只比仓库里两个文件（本包 vs baseline）是形同虚设的——宿主升级后那两处仍可能相等。
 *
 * 用法：node tools/check-host-version.mjs [--host-version x.y.z] [--baseline-version x.y.z]
 * 退出码：0 三方一致；1 有任一不一致；3 读不到真实宿主版本或契约快照。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 读真实宿主版本：profile 里的 dsh 包 → `dsh --version`。
 * @param {{ profileDir?: string, dshBin?: string }} [options] - profile 目录与 dsh 可执行。
 * @returns {string} 版本号；读不到返回空串。
 */
export function realHostVersion({ profileDir, dshBin } = {}) {
  if (profileDir) {
    const pkg = join(profileDir, 'node_modules/@deepseek-ai/dsh/package.json')
    if (existsSync(pkg)) {
      try {
        return String(JSON.parse(readFileSync(pkg, 'utf8')).version ?? '')
      } catch {
        /* 落到下一档 */
      }
    }
  }
  for (const bin of [dshBin, 'dsh']) {
    if (!bin) continue
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      const version = out.replace(/^v/, '').split(/\s+/)[0]
      if (version.length > 0) return version
    } catch {
      /* 试下一个 */
    }
  }
  return ''
}

/**
 * 三方比对：真实宿主 = 契约基线 = 本包。
 * @param {{ hostVersion?: string, baselineVersion?: string, profileDir?: string, dshBin?: string }} [options] - 覆盖项。
 * @returns {{ ok: boolean, host: string, baseline: string, packageVersion: string, reason?: string }} 三方值与判定。
 */
export function checkHostVersion({ hostVersion, baselineVersion, profileDir, dshBin } = {}) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const baseline = JSON.parse(readFileSync(join(ROOT, 'contracts', 'host-baseline.json'), 'utf8'))
  // baseline 用 --write 从实装宿主重生成时会记录顶层 hostVersion（旧文件退回 host.layoutVersion）。
  const expected = baselineVersion ?? baseline?.hostVersion ?? baseline?.host?.layoutVersion
  const host = hostVersion ?? realHostVersion({ profileDir, dshBin })
  const result = { ok: false, host, baseline: String(expected ?? ''), packageVersion: manifest.version }
  if (!host) return { ...result, reason: 'host-version-unreadable' }
  if (!result.baseline) return { ...result, reason: 'contract-snapshot-missing' }
  if (host !== result.baseline) return { ...result, reason: 'host-vs-baseline' }
  if (manifest.version !== result.baseline) return { ...result, reason: 'package-vs-baseline' }
  return { ...result, ok: true }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : undefined
  }
  const result = checkHostVersion({
    hostVersion: arg('--host-version'),
    baselineVersion: arg('--baseline-version'),
    profileDir: arg('--profile-dir') ?? process.env.PROFILE_DIR,
    dshBin: process.env.DSH_BIN,
  })
  const triplet = `host=${result.host || '（读不到）'} baseline=${result.baseline || '（读不到）'} package=${result.packageVersion}`
  if (result.ok) {
    process.stdout.write(`版本锁通过：${triplet}\n`)
    process.exit(0)
  }
  process.stderr.write(`版本锁失败（${result.reason}）：${triplet}。三者必须一致，拒绝安装（不静默用旧产物）。\n`)
  process.exit(result.reason === 'host-version-unreadable' || result.reason === 'contract-snapshot-missing' ? 3 : 1)
}
