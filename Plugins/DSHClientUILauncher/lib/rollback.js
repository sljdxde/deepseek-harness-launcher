/**
 * 回退命令生成（票 29 横幅复用，票 35 设置面板复用）。
 *
 * 只生成**可复制**的命令文本，不在 UI 里代跑：remove → install → 重启 三步固定，
 * 数据目录（`~/.dsh/state/` 的审批策略与审计）不动。
 */

/** 同名 drop-in 包名（回退就是把这层依赖从 profile 里摘掉）。 */
export const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-layout'

/**
 * @param {string} [profile] - dsh profile，默认 web。
 * @returns {string} 三行命令：remove → install → 重启。
 */
export function rollbackCommand(profile = 'web') {
  const name = typeof profile === 'string' && profile.trim().length > 0 ? profile.trim() : 'web'
  return [
    `dsh plugin --profile ${name} remove ${PACKAGE_NAME}`,
    `dsh plugin --profile ${name} install`,
    '# 之后重启 dsh（退出 dsh web 后重新打开，并硬刷新页面）',
  ].join('\n')
}

/** 回退说明：只摘依赖，不动数据。审批策略与审计都在 `~/.dsh/state/`。 */
export const ROLLBACK_NOTE = '数据目录 ~/.dsh/state/ 不动：审批策略与审计记录都保留，回退只摘 UI 依赖。'

/** 回退三步（remove → install → 重启），与命令行一一对应。 */
export const ROLLBACK_STEPS = Object.freeze([
  '移除 profile 里的本版 UI 依赖（remove）',
  '重新安装原生界面依赖（install）',
  '重启 dsh 并硬刷新页面（restart）',
])

/** runbook 相对仓库根的路径（设置页展示给用户，与文档同源）。 */
export const RUNBOOK_PATH = 'docs/ui-rebuild/runbook-回退.md'

/**
 * 设置页「回退原生 UI」入口的界面模型（纯数据，Node 侧与浏览器半区复用）。
 *
 * 命令仍由 {@link rollbackCommand} 生成——单一真源，不在 UI 里另抄一份字符串。
 * copied 只控制按钮/状态文案，复制动作与计时器由 client 的 LauncherRoot 负责。
 * @param {{ profile?: string, copied?: boolean }} [options] - dsh profile 与「刚复制过」状态。
 * @returns {{ id: string, title: string, note: string, steps: string[], command: string, copyLabel: string, copied: boolean, runbook: string }} 入口模型。
 */
export function rollbackSurface({ profile = 'web', copied = false } = {}) {
  const didCopy = copied === true
  return {
    id: 'revert-native',
    title: '回退原生 UI',
    note: ROLLBACK_NOTE,
    steps: [...ROLLBACK_STEPS],
    command: rollbackCommand(profile),
    copyLabel: didCopy ? '已复制' : '复制命令',
    copied: didCopy,
    runbook: RUNBOOK_PATH,
  }
}
