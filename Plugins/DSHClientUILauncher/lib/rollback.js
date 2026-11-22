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
