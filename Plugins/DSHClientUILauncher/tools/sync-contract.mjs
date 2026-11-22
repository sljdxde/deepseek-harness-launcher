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
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SUB_SLOTS, LAYOUT_FACE_MEMBERS } from '../lib/contract.js'
import { RAIL_ENTRIES } from '../lib/rail.js'
import { MODE_LABELS, statusText } from '../lib/statusbar.js'
import { SHELL_ICONS, DSH_LOGO } from '../lib/icons.js'
import { SHELL_METRICS, tokensCss, skeletonCss } from '../lib/tokens.js'
import { shellColumns, DRAWER_BREAKPOINT } from '../lib/shell-layout.js'
import { shellIcon, renderRail, renderStatusbar } from '../lib/shell-render.js'
import * as mainView from '../lib/main-view.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = join(ROOT, 'client', 'client.js')
const ID_START = '// #region module-id'
const ID_END = '// #endregion module-id'
const START = '  // #region children-from-contract'
const END = '  // #endregion children-from-contract'
const SHELL_START = '  // #region shell-from-lib'
const SHELL_END = '  // #endregion shell-from-lib'
const MAIN_START = '  // #region main-from-lib'
const MAIN_END = '  // #endregion main-from-lib'

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
/**
 * 构建标记：`<version>+<git短sha>`，供页面 `data-build` 与测试断言「测的是哪一版」。
 * @returns {string} 形如 `0.2.2-rc.5+fe56b8c`（拿不到 git 时用 `dev`）。
 */
export function buildStampBlock() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  let sha = 'dev'
  try {
    sha = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() || 'dev'
  } catch {
    /* 非 git 环境退 dev */
  }
  return `${manifest.version}+${sha}`
}

export function moduleIdBlock(name) {
  return [ID_START, '// 本段由 tools/sync-contract.mjs 从 package.json 的 name 生成，勿手改。', `const MODULE_ID = ${JSON.stringify(name)}`, ID_END].join('\n')
}

/**
 * 生成壳层块（票 30）：令牌 CSS、图标、四列几何与图标栏/状态条渲染函数。
 *
 * 与 children-from-contract 同一套路：Node 模块是源，浏览器半区拿生成物。
 * 渲染函数用 toString 内联，所以它们只能引用本块里同样被内联的常量（SHELL_ICONS/DSH_LOGO）。
 * @returns {string} 标记区文本（含起止标记）。
 */
export function shellBlock() {
  return [
    SHELL_START,
    '  // 本段由 tools/sync-contract.mjs 从 lib/{tokens,icons,shell-layout,shell-render}.js 生成，勿手改；',
    '  // 漂移由 test/contract.test.mjs 的同步检查挡住。',
    `  const SHELL_METRICS = ${JSON.stringify(SHELL_METRICS)}`,
    `  const SHELL_ICONS = ${JSON.stringify(SHELL_ICONS)}`,
    `  const DSH_LOGO = ${JSON.stringify(DSH_LOGO)}`,
    `  const DRAWER_BREAKPOINT = ${JSON.stringify(DRAWER_BREAKPOINT)}`,
    `  const TOKENS_CSS = ${JSON.stringify(tokensCss())}`,
    `  const SKELETON_CSS = ${JSON.stringify(skeletonCss())}`,
    `  const shellColumns = ${shellColumns.toString()}`,
    `  const shellIcon = ${shellIcon.toString()}`,
    `  const renderRail = ${renderRail.toString()}`,
    `  const renderStatusbar = ${renderStatusbar.toString()}`,
    SHELL_END,
  ].join('\n')
}

/**
 * 生成主区块（票 32）：主区渲染函数 + 状态变换 + 主区 CSS。
 *
 * 与 shell 同一套路：Node 模块是源，浏览器半区拿生成物；渲染函数用 toString 内联，
 * 只能引用本块内同样被内联的常量/函数（MAIN_* 前缀避免与 client 既有常量撞名）。
 * @returns {string} 标记区文本（含起止标记）。
 */
export function mainBlock() {
  const names = [
    'mainIcon',
    'applyApproval',
    'resetApproval',
    'approvalOf',
    'pendingApprovals',
    'isApprovalPending',
    'composerCanSend',
    'composerKeyDown',
    'paletteFilter',
    'paletteStep',
    'paletteCommand',
    'toggleExpanded',
    'shouldFollowScroll',
    'renderUserMessage',
    'renderFoldSummary',
    'renderTools',
    'renderPlan',
    'renderTaskCard',
    'renderReportCard',
    'renderChangedCard',
    'renderApprovalCard',
    'renderApprovalDock',
    'renderBotMessage',
    'renderThread',
    'renderComposer',
    'renderCommandPalette',
    'renderMainView',
  ]
  const lines = [
    MAIN_START,
    '  // 本段由 tools/sync-contract.mjs 从 lib/main-view.js 生成，勿手改；',
    '  // 漂移由 test/contract.test.mjs 的同步检查挡住。',
    `  const MAIN_APPROVAL_CHOICES = ${JSON.stringify(mainView.APPROVAL_CHOICES)}`,
    `  const MAIN_DEMO_COMMANDS = ${JSON.stringify(mainView.DEMO_COMMANDS)}`,
    `  const MAIN_DEMO_THREAD = ${JSON.stringify(mainView.DEMO_THREAD)}`,
    `  const MAIN_ICONS = ${JSON.stringify(mainView.MAIN_ICONS)}`,
    `  const MAIN_CSS = ${JSON.stringify(mainView.mainCss())}`,
  ]
  for (const name of names) lines.push(`  const ${name} = ${mainView[name].toString()}`)
  lines.push(MAIN_END)
  return lines.join('\n')
}

/** 把源码里的 main 标记区换成生成内容；没有该标记区时原样返回（可选区）。 */
export function withMainBlock(source) {
  const start = source.indexOf(MAIN_START)
  const end = source.indexOf(MAIN_END)
  if (start < 0 || end < 0) return source
  return `${source.slice(0, start)}${mainBlock()}${source.slice(end + MAIN_END.length)}`
}

/** 把源码里的 shell 标记区换成生成内容；没有该标记区时原样返回（可选区，兼容旧 fixture）。 */
export function withShellBlock(source) {
  const start = source.indexOf(SHELL_START)
  const end = source.indexOf(SHELL_END)
  if (start < 0 || end < 0) return source
  return `${source.slice(0, start)}${shellBlock()}${source.slice(end + SHELL_END.length)}`
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
  let next = `${source.slice(0, start)}${contractBlock()}${source.slice(end + END.length)}`
  // BUILD_STAMP 也随包版本/提交更新（页面 data-build 用它）
  next = next.replace(/const BUILD_STAMP = "[^"]*"/, `const BUILD_STAMP = ${JSON.stringify(buildStampBlock())}`)
  return withMainBlock(withShellBlock(next))
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
  // BUILD_STAMP 随每次提交变化，不能参与“漂移”判定（否则每次提交都会红）
  const normalize = (text) => text.replace(/const BUILD_STAMP = "[^"]*"/, 'const BUILD_STAMP = "X"')
  if (normalize(next) === normalize(source)) {
    if (next !== source && !check) {
      writeFileSync(target, next)
      log('已更新 client/client.js 的 BUILD_STAMP')
      return 0
    }
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
