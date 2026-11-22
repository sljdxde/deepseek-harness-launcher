/**
 * 设计令牌（票 30）：日夜两套基础色的 WCAG AA 门禁 + 生成 CSS 的形状。
 *
 * 只测外部行为：给颜色 → 得到对比度；给 mode → 得到可读的令牌表与 CSS。
 * 对比度期望值用独立实现计算（不调用被测函数反推），避免自证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LAUNCHER_TOKENS,
  SHELL_METRICS,
  TEXT_PAIRS,
  CONTRAST_MIN,
  parseColor,
  relativeLuminance,
  contrastRatio,
  contrastReport,
  themeTokens,
  tokensCss,
  skeletonCss,
} from '../lib/tokens.js'

/** 测试内独立实现的对比度（与 lib 的实现分开写，避免"tautological"）。 */
function lumOf([r, g, b]) {
  const channel = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
function ratioOf(a, b) {
  const la = lumOf(a)
  const lb = lumOf(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

test('日夜两套令牌都齐全，含正文/次要/弱化三档文字色', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = LAUNCHER_TOKENS[mode]
    for (const key of ['bg', 'bg2', 'panel', 'surface3', 'line', 'ink', 'ink2', 'ink3', 'accent']) {
      assert.equal(typeof tokens[key], 'string', `${mode}.${key} 必须是字符串`)
    }
  }
  assert.notEqual(LAUNCHER_TOKENS.light.bg, LAUNCHER_TOKENS.dark.bg, '两套底色必须不同')
})

test('parseColor 支持 #rrggbb 与 #rgb，非法返回 null', () => {
  assert.deepEqual(parseColor('#1b1c19'), [27, 28, 25])
  assert.deepEqual(parseColor('#fff'), [255, 255, 255])
  assert.equal(parseColor('rgba(0,0,0,.1)'), null)
  assert.equal(parseColor('#12345'), null)
  assert.equal(parseColor(undefined), null)
})

test('relativeLuminance / contrastRatio 与独立实现一致', () => {
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9)
  assert.ok(Math.abs(relativeLuminance('#000000')) < 1e-9)
  const got = contrastRatio('#1b1c19', '#f4f1e9')
  const want = ratioOf([27, 28, 25], [244, 241, 233])
  assert.ok(Math.abs(got - want) < 1e-9)
  assert.equal(CONTRAST_MIN, 4.5)
})

test('正文与次要文字在日夜两套下均 ≥ 4.5:1（WCAG AA）', () => {
  for (const mode of ['light', 'dark']) {
    const report = contrastReport(mode)
    assert.ok(report.length >= 3, '至少覆盖正文/次要/弱化 3 组')
    for (const item of report) {
      assert.ok(
        item.ratio >= CONTRAST_MIN,
        `${mode} ${item.name} 对比度 ${item.ratio.toFixed(2)} < ${CONTRAST_MIN}`,
      )
      assert.equal(item.pass, true)
    }
  }
})

test('对比度报告里的数值来自真实令牌表（抽查正文一组）', () => {
  for (const mode of ['light', 'dark']) {
    const tokens = LAUNCHER_TOKENS[mode]
    const pair = TEXT_PAIRS.find((p) => p.fg === 'ink' && p.bg === 'bg')
    const expected = ratioOf(parseColor(tokens[pair.fg]), parseColor(tokens[pair.bg]))
    const item = contrastReport(mode).find((entry) => entry.name === pair.name)
    assert.ok(Math.abs(item.ratio - expected) < 1e-9)
  }
})

test('themeTokens 取到对应模式；非法模式退回 light', () => {
  assert.equal(themeTokens('dark'), LAUNCHER_TOKENS.dark)
  assert.equal(themeTokens('light'), LAUNCHER_TOKENS.light)
  assert.equal(themeTokens('nope'), LAUNCHER_TOKENS.light)
})

test('tokensCss 生成作用域令牌：光/暗选择器 + 尺寸变量，且不裸命中 html/body', () => {
  const css = tokensCss()
  assert.match(css, /\.launcher-shell\{/)
  assert.match(css, /\.launcher-shell\[data-theme="light"\]/)
  assert.match(css, /\.launcher-shell\[data-theme="dark"\]/)
  assert.match(css, /--l-ink:/)
  assert.match(css, new RegExp(`--l-rail:${SHELL_METRICS.rail}px`))
  assert.match(css, new RegExp(`--l-status:${SHELL_METRICS.status}px`))
  assert.ok(!/(^|\})\s*(html|body)\s*\{/.test(css), '不许裸命中 html/body')
})

test('skeletonCss 只作用于外壳类，不含 !important', () => {
  const css = skeletonCss()
  assert.match(css, /\.launcher-rail\{/)
  assert.match(css, /\.launcher-rail__entry/)
  assert.match(css, /\.launcher-statusbar\{/)
  assert.match(css, /\.launcher-main\{/)
  assert.ok(!css.includes('!important'), '骨架样式不需要 !important')
  // 每条规则的选择器都必须带外壳作用域
  for (const rule of css.split('}')) {
    const selector = rule.split('{')[0].trim()
    if (selector === '' || selector.startsWith('@')) continue
    for (const part of selector.split(',')) {
      assert.ok(
        part.trim().startsWith('.launcher-'),
        `选择器没有外壳作用域：${part.trim().slice(0, 80)}`,
      )
    }
  }
})

test('relativeLuminance：不可解析的颜色与含非有限分量的数组都返回 NaN（不抛错）', () => {
  assert.ok(Number.isNaN(relativeLuminance('rgba(0,0,0,.1)')), '解析不出的颜色 → NaN')
  assert.ok(Number.isNaN(relativeLuminance([Number.NaN, 0, 0])), '含 NaN 的分量 → NaN')
  assert.ok(Number.isNaN(relativeLuminance([255, Infinity, 0])), '含 Infinity 的分量 → NaN')
  assert.ok(Number.isFinite(relativeLuminance([255, 255, 255])), '直接给分量也能算')
})
