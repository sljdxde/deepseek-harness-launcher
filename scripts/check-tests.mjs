#!/usr/bin/env node
/**
 * 测试断言纪律检查（retro 2026-11-22）：CODING_STANDARDS §1 只允许三类"源码文本断言"
 * 不变量；其它针对 SOURCE 的正则/包含断言等价重写就会假红，属实现细节断言。
 *
 * 规则：测试里出现 assert.match(SOURCE …) / SOURCE.match( / assert.ok(SOURCE …) 等，
 * 必须由文件级指令放行：
 *   // source-assert-allow-file: <理由 ≥8 字>
 * 且每文件放行上限 8 处；放行会在输出里逐文件列出，便于评审看见。
 *
 * 退出码：0 通过；1 有违规；3 读不到目录。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = join(ROOT, 'Plugins')
const PATTERNS = [
  /assert\.match\(\s*SOURCE\b/,
  /assert\.doesNotMatch\(\s*SOURCE\b/,
  /assert\.ok\(\s*SOURCE\b/,
  /\bSOURCE\.match\(/,
  /\bSOURCE\.includes\(/,
  /\bSOURCE\.indexOf\(/,
]
const ALLOW_RE = /\/\/\s*source-assert-allow-file:\s*(\S.{7,})/
const CAP_PER_FILE = 8

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(mjs|js)$/.test(name)) out.push(full)
  }
  return out
}

const violations = []
const allowed = []
let testDirs = 0
for (const plugin of readdirSync(PLUGINS)) {
  for (const sub of ['test', 'tests']) {
    const dir = join(PLUGINS, plugin, sub)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    testDirs++
    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8')
      const hits = []
      text.split('\n').forEach((line, i) => {
        if (PATTERNS.some((re) => re.test(line))) hits.push({ line: i + 1, text: line.trim() })
      })
      if (!hits.length) continue
      const m = text.match(ALLOW_RE)
      const rel = relative(ROOT, file)
      if (m) {
        if (hits.length > CAP_PER_FILE) violations.push(`${rel}: 放行超上限 ${hits.length} > ${CAP_PER_FILE}`)
        else allowed.push(`${rel}: ${hits.length} 处（${m[1].trim()}）`)
        continue
      }
      for (const h of hits) violations.push(`${rel}:${h.line} 源码文本断言未放行 → ${h.text.slice(0, 80)}`)
    }
  }
}
if (!testDirs) { console.error('✗ 找不到任何 Plugins/*/test 目录'); process.exit(3) }

if (allowed.length) {
  console.log(`ℹ 已放行的文件级源码断言（评审可见）：`)
  for (const a of allowed) console.log('  - ' + a)
}
if (violations.length) {
  console.error(`✗ check-tests 发现 ${violations.length} 处：`)
  for (const v of violations) console.error('  - ' + v)
  console.error('  修法：改成行为断言（import 模块断言输出），或确属不变量则加 // source-assert-allow-file: <理由>')
  process.exit(1)
}
console.log('✓ check-tests：没有未放行的源码文本断言')
