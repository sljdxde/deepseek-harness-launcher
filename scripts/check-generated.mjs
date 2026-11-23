#!/usr/bin/env node
/**
 * 生成物纪律检查（retro 2026-11-22）：三类真实事故的确定性守卫。
 *   1) 合并残留冲突标记（<<<<<<< / >>>>>>>）被提交；
 *   2) 同一 client 单文件里，多个 #region *-from-lib 生成块声明了同名顶层符号；
 *   3) BUILD_STAMP 与 package.json 版本 / 近期提交 sha 不一致。
 * 退出码：0 通过；1 有违规；3 读不到输入。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'Plugins/DSHClientUILauncher/client/client.js')
const PKG = join(ROOT, 'Plugins/DSHClientUILauncher/package.json')
const problems = []

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

// 1) 冲突标记
const tracked = git(['ls-files']).split('\n').filter(Boolean)
for (const f of tracked) {
  const full = join(ROOT, f)
  if (!existsSync(full)) continue
  let text
  try { text = readFileSync(full, 'utf8') } catch { continue }
  if (/^(<<<<<<< |>>>>>>> )/m.test(text) || /^\|\|\|\|\|\|\| /m.test(text)) problems.push(`冲突标记残留：${f}`)
}

// 2) 生成块同名顶层符号
// 整壳 UI 插件已独立成库（dsh-client-ui-layout 仓库）：本仓库检出里没有它时，
// 第 2/3 项（生成块同名符号、BUILD_STAMP）跳过——那两项归该包自己的检查，
// 冲突标记检查（第 1 项）对本仓库照旧全量生效。
if (!existsSync(CLIENT)) console.log('ℹ 未检出 Plugins/DSHClientUILauncher（已独立成库），跳过生成块与 BUILD_STAMP 检查')
else {
  const src = readFileSync(CLIENT, 'utf8')
  const regions = [...src.matchAll(/\/\/ #region ([a-z0-9-]+)\n([\s\S]*?)\/\/ #endregion \1/g)]
  const seen = new Map()
  const topLevelDecls = (body) => {
    // 去掉字符串/模板/注释后按大括号深度取顶层声明，避免把函数内局部变量算进来
    const stripped = body
      .replace(/`(?:\\.|[^`\\])*`/g, '``')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const out = []
    let depth = 0
    for (const line of stripped.split('\n')) {
      const m = line.match(/^(?: {2})?(?:const|let|var|function) ([A-Za-z_$][\w$]*)/)
      if (m && depth === 0) out.push(m[1])
      for (const ch of line) {
        if (ch === '{') depth++
        else if (ch === '}') depth = Math.max(0, depth - 1)
      }
    }
    return out
  }
  for (const [, name, body] of regions) {
    const decls = topLevelDecls(body)
    for (const d of new Set(decls)) {
      if (seen.has(d)) problems.push(`生成块同名符号：${d} 同时出现在 ${seen.get(d)} 与 ${name}`)
      else seen.set(d, name)
    }
  }
  // 3) BUILD_STAMP
  if (existsSync(PKG)) {
    const { version } = JSON.parse(readFileSync(PKG, 'utf8'))
    const m = src.match(/const BUILD_STAMP = "([^"]+)"/)
    if (!m) problems.push('client.js 里找不到 BUILD_STAMP')
    else {
      const [, stamp] = m
      const [stampVersion, sha] = stamp.split('+')
      if (stampVersion !== version) problems.push(`BUILD_STAMP 版本 ${stampVersion} ≠ package.json ${version}`)
      // 浅克隆（CI 默认 depth=1）里拿不到父提交：此时只校验版本前缀，
      // 并在输出里说明跳过了 sha 新鲜度检查（本地/完整克隆仍会查）。
      let shallow = false
      try { shallow = git(['rev-parse', '--is-shallow-repository']) === 'true' } catch { shallow = true }
      const recent = new Set()
      // PR 的 checkout 是 merge commit：stamp 记的是 head 提交，不在 HEAD/HEAD^/HEAD~2 里，
      // 因此还要认 GITHUB_HEAD_SHA 与最近 5 个提交。
      for (const ref of ['HEAD', 'HEAD^', 'HEAD~2', 'HEAD~3', 'HEAD~4']) {
        try { recent.add(git(['rev-parse', '--short', ref])) } catch { /* 浅克隆忽略 */ }
      }
      for (const sha of git(['log', '-5', '--format=%h']).split('\n')) if (sha) recent.add(sha)
      if (process.env.GITHUB_HEAD_SHA) recent.add(process.env.GITHUB_HEAD_SHA.slice(0, 7))
      const canCheckSha = !shallow && recent.size > 1
      if (!canCheckSha) console.log(`ℹ 浅克隆：跳过 BUILD_STAMP sha 新鲜度检查（本地或 fetch-depth≥3 时仍会校验）`)
      else if (!recent.has(sha)) problems.push(`BUILD_STAMP sha ${sha} 不在近期提交 ${[...recent].join('/')} 内（跑 node tools/sync-contract.mjs 更新）`)
    }
  }
}

if (problems.length) {
  console.error(`✗ check-generated 发现 ${problems.length} 处问题：`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('✓ check-generated：无冲突标记、无生成块同名符号、BUILD_STAMP 一致')
