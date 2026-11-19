#!/usr/bin/env node
/**
 * 同名替换的构建：产出一份"名字就是 @deepseek-ai/dsh-client-ui-layout"的实现包。
 *
 * 为什么：前端产物里有一份硬编码的必需客户端模块清单，按**模块名**认。换壳要定义成
 * "换 layout 插件的实现"，所以把本包构建成同名、同版本、client 模块 id 同步改名的产物，
 * 装进 profile 顶替原包即可；行 id 与 name 都不用改（配置层面本来也改不了，loader 会 skipping）。
 *
 * 用法：node tools/build-layout-alias.mjs --out /tmp/launcher-as-layout
 *       （--version 默认取 contracts/host-baseline.json 里宿主 ui-layout 的版本）
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { withModuleId } from './sync-contract.mjs'

export const HOST_PACKAGE = '@deepseek-ai/dsh-client-ui-layout'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归复制，跳过 node_modules 与生成物目录。 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    if (name === 'node_modules' || name === 'build') continue
    const source = join(from, name)
    const target = join(to, name)
    if (statSync(source).isDirectory()) copyTree(source, target)
    else cpSync(source, target)
  }
}

/**
 * 产出同名替换包。
 * @param {{ out: string, version?: string }} options - 输出目录与要写的版本号。
 * @returns {{ out: string, name: string, version: string, moduleId: string }} 产物摘要。
 */
export function buildAlias({ out, version }) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const baseline = JSON.parse(readFileSync(join(ROOT, 'contracts', 'host-baseline.json'), 'utf8'))
  const hostVersion = version ?? baseline.host.layoutVersion
  rmSync(out, { recursive: true, force: true })
  copyTree(ROOT, out)
  const aliasManifest = { ...manifest, name: HOST_PACKAGE, version: hostVersion, description: `${manifest.description}（以 ${HOST_PACKAGE} 名义同名替换）` }
  writeFileSync(join(out, 'package.json'), `${JSON.stringify(aliasManifest, null, 2)}\n`)
  const clientPath = join(out, 'client', 'client.js')
  const rewritten = withModuleId(readFileSync(clientPath, 'utf8'), HOST_PACKAGE)
  if (rewritten === null) throw new Error('client/client.js 缺少 module-id 标记区')
  writeFileSync(clientPath, rewritten)
  return { out, name: HOST_PACKAGE, version: hostVersion, moduleId: HOST_PACKAGE }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--out')
  const out = index >= 0 ? process.argv[index + 1] : null
  if (out === null) {
    process.stderr.write('用法：node tools/build-layout-alias.mjs --out <dir> [--version x.y.z]\n')
    process.exit(2)
  }
  const versionIndex = process.argv.indexOf('--version')
  const summary = buildAlias({ out, version: versionIndex >= 0 ? process.argv[versionIndex + 1] : undefined })
  process.stdout.write(`已产出同名替换包：${summary.out}（${summary.name}@${summary.version}，module id ${summary.moduleId}）\n`)
}
