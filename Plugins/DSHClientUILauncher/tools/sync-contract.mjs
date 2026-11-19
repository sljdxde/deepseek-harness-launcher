#!/usr/bin/env node
/**
 * 把 lib/contract.js 的六条子槽 + 契约面成员"生成"进 client/client.js 的标记区。
 *
 * 为什么要有这一步：浏览器半区是被宿主模块加载器加载的单文件，不能 import Node 模块，
 * 但契约常量只能有一份事实（05-§5、06 R-02）。所以 Node 侧是源，客户端里的那块是生成物，
 * 由本脚本写入、由 test/contract.test.mjs 的同步检查挡住手改。
 *
 * 用法：node tools/sync-contract.mjs          # 就地更新
 *       node tools/sync-contract.mjs --check  # 只检查，漂移退出码 1
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SUB_SLOTS, LAYOUT_FACE_MEMBERS } from '../lib/contract.js'
import { RAIL_ENTRIES } from '../lib/rail.js'
import { MODE_LABELS, statusText } from '../lib/statusbar.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'client', 'client.js')
const ID_START = '// #region module-id'
const ID_END = '// #endregion module-id'
const START = '  // #region children-from-contract'
const END = '  // #endregion children-from-contract'

/** 生成标记区的那几行（缩进固定两个空格，client.js 在 factory 作用域里）。 */
export function contractBlock() {
  const children = SUB_SLOTS.map((slot) => `    ${JSON.stringify(slot.name)}: { kind: ${JSON.stringify(slot.kind)}, scope: 'root' },`).join('\n')
  return [
    START,
    '  // 本段由 tools/sync-contract.mjs 从 lib/contract.js 生成，勿手改；',
    '  // 漂移由 test/contract.test.mjs 的同步检查挡住。',
    '  const CHILDREN = {',
    children,
    '  }',
    `  const LAYOUT_FACE_MEMBERS = ${JSON.stringify(LAYOUT_FACE_MEMBERS)}`,
    `  const RAIL_ENTRIES = ${JSON.stringify(RAIL_ENTRIES)}`,
    `  const MODE_LABELS = ${JSON.stringify(MODE_LABELS)}`,
    `  const statusText = ${statusText.toString()}`,
    END,
  ].join('\n')
}

/** 模块 id 段：与 package.json 的 name 一致（同名替换时两边一起变，见 tools/build-layout-alias.mjs）。 */
export function moduleIdBlock(name) {
  return [ID_START, '// 本段由 tools/sync-contract.mjs 从 package.json 的 name 生成，勿手改。', `const MODULE_ID = ${JSON.stringify(name)}`, ID_END].join('\n')
}

/** 把源码里的 module-id 段换成包名；找不到标记返回 null。 */
export function withModuleId(source, name) {
  const start = source.indexOf(ID_START)
  const end = source.indexOf(ID_END)
  if (start < 0 || end < 0) return null
  return `${source.slice(0, start)}${moduleIdBlock(name)}${source.slice(end + ID_END.length)}`
}

/** 把源码里的标记区换成生成内容；找不到标记返回 null。 */
export function withContractBlock(source) {
  const start = source.indexOf(START)
  const end = source.indexOf(END)
  if (start < 0 || end < 0) return null
  return `${source.slice(0, start)}${contractBlock()}${source.slice(end + END.length)}`
}

/**
 * 同步一次；返回退出码而不是直接 exit，便于单测覆盖两条分支。
 * @param {{ check?: boolean, target?: string, log?: (line: string) => void }} [options] - 选项。
 * @returns {number} 0 已最新/已写入，1 检查发现漂移，3 找不到标记区。
 */
export function runSync({ check = false, target = CLIENT, log = () => {} } = {}) {
  const source = readFileSync(target, 'utf8')
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const withId = withModuleId(source, manifest.name)
  if (withId === null) {
    log('client/client.js 里找不到 module-id 标记区')
    return 3
  }
  const next = withContractBlock(withId)
  if (next === null) {
    log('client/client.js 里找不到 children-from-contract 标记区')
    return 3
  }
  if (next === source) {
    log('契约块已是最新')
    return 0
  }
  if (check) {
    log('client/client.js 的契约块与 lib/contract.js 不一致，跑 node tools/sync-contract.mjs 更新')
    return 1
  }
  writeFileSync(target, next)
  log('已更新 client/client.js 的契约块')
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runSync({
    check: process.argv.includes('--check'),
    log: (line) => {
      const stream = line.startsWith('契约块已是最新') || line.startsWith('已更新') ? process.stdout : process.stderr
      stream.write(`${line}\n`)
    },
  }))
}
