/** #7 静态检查：client.js 里每条 `!important` 规则都必须以外壳作用域前缀开头（05-§6.5 23:26）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

test('每条 !important 规则都以 .launcher-shell 开头（禁止命中宿主样式）', () => {
  const rules = SOURCE.split('\n').filter((line) => line.includes('!important'))
  assert.ok(rules.length > 0, '至少应有一条 !important 规则')
  for (const rule of rules) {
    // 去掉 at-rule 外壳（@container/@media）后再看真正的选择器
    const stripped = rule.replace(/^\s*@[^{]+\{/, '').trim()
    const selector = stripped.split('{')[0].trim()
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

test('裸元素选择器（pre/code 等）不允许带 !important（05 §6.5 #7）', () => {
  const rules = SOURCE.split('\n').filter((line) => line.includes('!important'))
  for (const rule of rules) {
    const stripped = rule.replace(/^\s*@[^{]+\{/, '').trim()
    const selector = stripped.split('{')[0].trim()
    for (const part of selector.split(',')) {
      const head = part.trim().split(/[\s>+~]/)[0]
      assert.ok(
        !/^(pre|code|div|span|button|input|textarea|li|ul|p|a|h[1-6])$/.test(head),
        `裸元素选择器带 !important：${rule.trim().slice(0, 100)}`,
      )
    }
  }
})

test('选择器里不得出现宿主哈希类名（形如 .uV2eYG_input）', () => {
  const hashClass = /\.[A-Za-z0-9]{3,}_[A-Za-z0-9]{5,}/g
  const rules = SOURCE.split('\n').filter((line) => line.includes('!important'))
  for (const rule of rules) {
    assert.equal(rule.match(hashClass), null, `含宿主哈希类名：${rule.trim().slice(0, 100)}`)
  }
})

test('代码块换行属性挂在 .launcher-shell 根，不写 documentElement', () => {
  assert.ok(!SOURCE.includes('documentElement.dataset.codeWrap'), '不应把属性挂到 documentElement')
  assert.ok(SOURCE.includes("'data-code-wrap': wrapOn ? 'on' : 'off'"), '应以属性形式输出在外壳根上')
})

test('FR-38 浮层挂 body（data-launcher-overlay），不在 header 内渲染', () => {
  assert.ok(SOURCE.includes("node.setAttribute('data-launcher-overlay', '')"), '浮层必须带 data-launcher-overlay')
  assert.ok(SOURCE.includes('document.body.appendChild(node)'), '浮层要挂到 body，避开 header 的 mask')
  assert.ok(!SOURCE.includes("open ? h('div', {"), '不许再在 header 子树里直接渲染浮层')
})
