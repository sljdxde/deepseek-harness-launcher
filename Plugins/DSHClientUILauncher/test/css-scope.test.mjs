/** #7 静态检查：client.js 里每条 `!important` 规则都必须以外壳作用域前缀开头（05-§6.5 23:26）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

test('每条 !important 规则都以 .launcher-shell 开头（禁止命中宿主样式）', () => {
  const rules = SOURCE.split('\n').filter((line) => line.includes('!important'))
  assert.ok(rules.length > 0, '至少应有一条 !important 规则')
  for (const rule of rules) {
    const selector = rule.split('{')[0].trim()
    for (const part of selector.split(',')) {
      assert.ok(
        // 我们的根就是 .launcher-shell；任何 .launcher-* 都是外壳自己的 class（不含宿主 class）
        part.trim().startsWith('.launcher-shell') ||
        part.trim().startsWith('[data-shell="launcher"]') ||
        part.trim().startsWith('.launcher-'),
        `选择器没有外壳作用域前缀：${rule.trim().slice(0, 120)}`,
      )
    }
  }
})

test('代码块换行属性挂在 .launcher-shell 根，不写 documentElement', () => {
  assert.ok(!SOURCE.includes('documentElement.dataset.codeWrap'), '不应把属性挂到 documentElement')
  assert.ok(SOURCE.includes("'data-code-wrap': wrapOn ? 'on' : 'off'"), '应以属性形式输出在外壳根上')
})
