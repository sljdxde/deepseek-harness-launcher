/**
 * 分发通道一（A1 / 票 36）：随 DHL 安装包默认携带本包，且运行期按名解析到本包。
 *
 * 这是**打包/接线不变量**（CODING_STANDARDS §1 允许的"某符号只许出现在某处/必须存在"类）：
 * 打包脚本必须 copy 本包目录，runtime 的内置插件清单必须把宿主包名
 * `@deepseek-ai/dsh-client-ui-layout` 指到本包（DSHClientUILauncher），卸载脚本要能清掉对应软链。
 * 完整打包跑不起来时，这几条静态断言仍能守住「漏带 / 指错包」的回归。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../../../', import.meta.url)
const read = (rel) => readFileSync(new URL(rel, root), 'utf8')

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-layout'
const BUNDLE_DIR = 'DSHClientUILauncher'

test('打包脚本（arm64 + universal）都把本包 copy 进 App Resources', () => {
  for (const script of ['scripts/build-app.sh', 'scripts/build-universal.sh']) {
    assert.match(read(script), new RegExp(`copy_bundled_plugin\\s+${BUNDLE_DIR}\\b`), `${script} 必须 copy ${BUNDLE_DIR}`)
  }
})

test('runtime 内置插件清单按宿主包名把本包链进 profile（同名 drop-in 的前提）', () => {
  const main = read('Sources/main.swift')
  // 找到 BundledPlugin(linkName: "<pkg>", bundleMarker: "DSHClientUILauncher", ...)
  const row = new RegExp(
    `BundledPlugin\\(linkName:\\s*"${PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}",\\s*bundleMarker:\\s*"${BUNDLE_DIR}"`,
  )
  assert.match(main, row, `main.swift 的 bundledPlugins 必须含 linkName=${PACKAGE_NAME} → ${BUNDLE_DIR}`)
  // App Resources 里要有对应的包目录入口，否则链接指向空
  assert.match(main, new RegExp(`appendingPathComponent\\("${BUNDLE_DIR}"\\)`), 'main.swift 要能定位到 App 包内的本包目录')
})

test('卸载脚本能清掉本包的作用域软链（不留悬空链接）', () => {
  const uninstall = read('scripts/uninstall.sh')
  assert.ok(
    uninstall.includes(`${PACKAGE_NAME}:${BUNDLE_DIR}`),
    'uninstall.sh 的内置插件清单必须含本包（linkName:bundleMarker）',
  )
})

test('本包包名就是宿主 layout 包名（同名替换），且 host 半区入口存在', () => {
  const manifest = JSON.parse(read('Plugins/DSHClientUILauncher/package.json'))
  assert.equal(manifest.name, PACKAGE_NAME, '包名必须等于宿主 layout 包名才能同名 drop-in')
  assert.ok(typeof manifest.main === 'string' && manifest.main.length > 0, 'host 半区入口 main 不能为空')
  assert.ok(Array.isArray(manifest.files) && manifest.files.includes('client'), '发布清单必须带 client 半区')
})
