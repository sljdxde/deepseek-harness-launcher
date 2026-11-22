/** #7 静态检查：client.js 里每条 `!important` 规则都必须以外壳作用域前缀开头（05-§6.5 23:26）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderModelPopover } from '../lib/model-surface.js'
import { renderCommandPalette } from '../lib/main-view.js'

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

test('代码块换行属性不再写 documentElement（旧实现已消失，§1 不变量）', () => {
  // 旧符号必须消失：早期实现把 data-code-wrap 挂到 documentElement，会污染宿主主题。
  assert.ok(!SOURCE.includes('documentElement.dataset.codeWrap'), '不应把属性挂到 documentElement')
})

test('浮层渲染函数的输出行为（FR-38）：模型浮层/命令面板由 lib 渲染，带各自标记', () => {
  const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined) })
  const pop = renderModelPopover(h, { kind: 'model', state: { model: 'DeepSeek V3.2', reason: 'Default', deep: false } })
  assert.equal(pop.props['data-model-popover'], 'model')
  // 命令面板由 main-view 渲染；旧实现把它塞进 header 子树（用 open ? h('div', …)），该写法必须消失。
  assert.equal(typeof renderCommandPalette, 'function')
  assert.ok(!SOURCE.includes("open ? h('div', {"), '不许再在 header 子树里直接渲染浮层')
})
