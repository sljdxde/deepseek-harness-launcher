/**
 * 分发清单断言（票 36，规格 DistributionManifest）：`files` / `exports` / npm 元信息齐备，安装包内路径可解析。
 *
 * 只断言外部可验证的事实：清单里声明的每个条目都在磁盘上、exports 每个 target 都存在、
 * 运行时必需件（实现、客户端、契约基线、patch）都在 files 里。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** 运行时必需件：换壳实现、v17 客户端、契约基线、cordis patch。 */
const REQUIRED_FILES = ['lib', 'client', 'contracts', 'cordis.patch.yml']

test('files：含全部运行时必需件，且每个条目都在磁盘上', () => {
  assert.ok(Array.isArray(manifest.files), 'package.json 必须有 files 数组')
  for (const entry of REQUIRED_FILES) {
    assert.ok(manifest.files.includes(entry), `files 缺必需件 ${entry}`)
  }
  for (const entry of manifest.files) {
    assert.ok(existsSync(join(ROOT, entry)), `files 声明的 ${entry} 在包内不存在`)
  }
})

test('files 覆盖安装/换壳脚本会拷贝的入口（package.json 除外，npm 自动带上）', () => {
  // scripts/verify-shell-standalone.sh 的 switch_impl 只拷这些；少一个换壳就是残包
  for (const entry of ['package.json', 'client', 'lib', 'cordis.patch.yml', 'contracts']) {
    if (entry === 'package.json') continue
    assert.ok(manifest.files.includes(entry), `换壳入口 ${entry} 必须在 files 里`)
  }
})

test('exports：入口齐全，且每个 target 都是包内真实文件', () => {
  const exportsMap = manifest.exports ?? {}
  for (const key of ['.', './client', './contracts/host-baseline.json', './cordis.patch.yml', './package.json']) {
    assert.ok(key in exportsMap, `exports 缺 ${key}`)
  }
  assert.equal(exportsMap['.'], './lib/index.js')
  const normalize = (target) => target.replace(/^\.\//, '')
  assert.equal(normalize(manifest.main), normalize(exportsMap['.']), 'main 与 exports["."] 必须指向同一实现')
  for (const [key, target] of Object.entries(exportsMap)) {
    assert.equal(typeof target, 'string', `exports[${key}] 必须是字符串 target`)
    assert.ok(existsSync(join(ROOT, target)), `exports[${key}] → ${target} 在包内不存在`)
  }
})

test('npm 元信息：private 保持 true（不发布 npm），license/keywords/description 齐备', () => {
  // 规格 Out of Scope：只准备元信息与 CI 校验，不代发。private:true 是防误发的开关。
  assert.equal(manifest.private, true, '本包不发布 npm，private 必须为 true')
  assert.equal(manifest.license, 'UNLICENSED')
  assert.equal(typeof manifest.description, 'string')
  assert.ok(manifest.description.length > 0)
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length > 0)
})

test('README：两条分发通道（随安装包携带 / dsh plugin add）都写清', () => {
  assert.match(readme, /随 DHL 安装包默认携带/)
  assert.match(readme, /dsh plugin .*add/)
  assert.match(readme, /remove/)
  assert.match(readme, /install/)
})

test('README：说明 private 现状与 canary 退出码', () => {
  assert.match(readme, /private/)
  assert.match(readme, /canary/)
  assert.match(readme, /退出码/)
})
