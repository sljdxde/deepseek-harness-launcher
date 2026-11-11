/**
 * dsh-launcher-settings 的纯函数单测：默认值、归一化、校验。
 *
 * 这些函数是面板与启动器之间的契约 —— 归一化保证面板永远拿到可渲染的值，
 * 校验保证「界面放行」的东西后端也一定接受，两边不会出现两套口径。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 在沙箱里加载插件，取出它导出的纯函数（不启动宿主）。 */
function loadPlugin() {
  const src = fs.readFileSync(path.join(here, '..', 'lib', 'index.js'), 'utf8')
  const mod = { exports: {} }
  const sandbox = {
    module: mod,
    exports: mod.exports,
    process,
    Buffer,
    fetch: () => Promise.reject(new Error('no network in tests')),
    console,
  }
  vm.createContext(sandbox)
  // 源码是 ESM；把 export 改写成 CommonJS 才能在这个沙箱里跑
  const cjs = src
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export async function /gm, 'async function ')
  vm.runInContext(cjs + '\nmodule.exports = { DEFAULTS, REGISTRIES, normalizeSettings, validateSettings, diffFromDefaults }', sandbox)
  return mod.exports
}

const plugin = loadPlugin()

test('defaults are the shipped values', () => {
  assert.equal(plugin.DEFAULTS.updateIntervalHours, 6)
  assert.equal(plugin.DEFAULTS.npmRegistry, 'https://registry.npmmirror.com')
  assert.equal(plugin.DEFAULTS.globalHotKey, 'Ctrl+Alt+D')
  assert.equal(plugin.DEFAULTS.autoCheckPluginUpdates, true)
  assert.equal(plugin.DEFAULTS.launchAtLogin, false)
})

test('the China mirror is first in the registry list', () => {
  assert.equal(plugin.REGISTRIES[0].url, 'https://registry.npmmirror.com')
  assert.equal(plugin.REGISTRIES[0].note, '默认')
  assert.equal(plugin.REGISTRIES[1].url, 'https://registry.npmjs.org')
})

test('normalizeSettings fills gaps with defaults', () => {
  const out = plugin.normalizeSettings({})
  assert.deepEqual(shape(out), shape(plugin.DEFAULTS))
  // null / garbage must not throw or leak through
  assert.deepEqual(shape(plugin.normalizeSettings(null)), shape(plugin.DEFAULTS))
  assert.deepEqual(shape(plugin.normalizeSettings('nonsense')), shape(plugin.DEFAULTS))
})

test('normalizeSettings clamps the interval', () => {
  assert.equal(plugin.normalizeSettings({ updateIntervalHours: 0 }).updateIntervalHours, 6)
  assert.equal(plugin.normalizeSettings({ updateIntervalHours: -5 }).updateIntervalHours, 6)
  assert.equal(plugin.normalizeSettings({ updateIntervalHours: 1 }).updateIntervalHours, 1)
  assert.equal(plugin.normalizeSettings({ updateIntervalHours: 9999 }).updateIntervalHours, 720)
  // a non-number falls back rather than producing NaN
  assert.equal(plugin.normalizeSettings({ updateIntervalHours: 'x' }).updateIntervalHours, 6)
})

test('normalizeSettings keeps booleans and ignores wrong types', () => {
  const out = plugin.normalizeSettings({
    autoCheckPluginUpdates: false,
    launchAtLogin: 'yes', // wrong type: ignored
  })
  assert.equal(out.autoCheckPluginUpdates, false)
  assert.equal(out.launchAtLogin, false)
})

test('validateSettings accepts a sane form', () => {
  assert.equal(plugin.validateSettings({ ...plugin.DEFAULTS }), null)
})

test('validateSettings rejects a too-small interval', () => {
  const bad = { ...plugin.DEFAULTS, updateIntervalHours: 0 }
  assert.match(plugin.validateSettings(bad), /至少为 1 小时/)
})

test('validateSettings rejects a bad hotkey when enabled', () => {
  const noModifier = { ...plugin.DEFAULTS, globalHotKey: 'D' }
  assert.match(plugin.validateSettings(noModifier), /修饰键/)

  const empty = { ...plugin.DEFAULTS, globalHotKey: '' }
  assert.match(plugin.validateSettings(empty), /必须填写组合键/)

  const garbage = { ...plugin.DEFAULTS, globalHotKey: 'Ctrl+Alt+€' }
  assert.ok(plugin.validateSettings(garbage))
})

test('validateSettings ignores the hotkey when disabled', () => {
  const off = { ...plugin.DEFAULTS, globalHotKeyEnabled: false, globalHotKey: '' }
  assert.equal(plugin.validateSettings(off), null)
})

// 沙箱里创建的对象原型与宿主不同，deepStrictEqual 会因原型不等而失败；
// 这里比 JSON 形状，正是要测的东西。
const shape = v => JSON.parse(JSON.stringify(v))

test('diffFromDefaults sends only what changed', () => {
  const diff = plugin.diffFromDefaults({
    ...plugin.DEFAULTS,
    launchAtLogin: true,
    updateIntervalHours: 12,
  })
  assert.deepEqual(shape(diff), { updateIntervalHours: 12, launchAtLogin: true })
  // nothing changed → nothing to send
  assert.deepEqual(shape(plugin.diffFromDefaults({ ...plugin.DEFAULTS })), {})
})
