#!/usr/bin/env node
/**
 * 壳层 verify 的页面断言（被 scripts/shell-switch.sh verify 调用）。
 *
 * 判据（05-§4.2-3）：launcher 时页面必须有 `[data-shell="launcher"]` 且没有原生槽标记
 * `[data-slot="sidebar"]`；native 时反过来。两者都不满足就退出码 1；浏览器起不来退出码 3，不假装成功。
 * 注：原生壳没有 `.app` 类（0.2.2-rc.5 实测），所以判据用槽标记而不是类名。
 *
 * 浏览器：优先 puppeteer-core + 系统 Chrome（同 dsh-clipchat 的 e2e 口径），没有就退出 3 并给手工步骤。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const [url, expected] = process.argv.slice(2)
if (url === undefined || (expected !== 'launcher' && expected !== 'native')) {
  process.stderr.write('用法：verify-shell.mjs <url> <launcher|native>\n')
  process.exit(2)
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]
const chrome = process.env.E2E_CHROME_PATH ?? CHROME_CANDIDATES.find((path) => existsSync(path))
if (chrome === undefined) {
  process.stderr.write('找不到可用的 Chrome（设 E2E_CHROME_PATH）。手工断言见 shell-switch.sh verify 的输出。\n')
  process.exit(3)
}

let puppeteer = null
try {
  // PUPPETEER_PATH 给目录时 ESM 不能直接 import（ERR_UNSUPPORTED_DIR_IMPORT），走 CJS require
  if (process.env.PUPPETEER_PATH) {
    puppeteer = createRequire(import.meta.url)(process.env.PUPPETEER_PATH)
  } else {
    puppeteer = (await import('puppeteer-core')).default
  }
} catch {
  process.stderr.write('没有 puppeteer-core（npm i -D puppeteer-core）。手工断言见 shell-switch.sh verify 的输出。\n')
  process.exit(3)
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] })
try {
  const page = await browser.newPage()
  // 模块 URL 的 rev 可能不随包内文件变化（实测：重建 client 后 rev 不变），必须禁缓存，
  // 否则 verify 会对着上一次加载的旧模块下结论。
  await page.setCacheEnabled(false)
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await new Promise((resolve) => setTimeout(resolve, 8_000))
  // 原生壳的特征不是 `.app`（0.2.2-rc.5 里没有这个类），而是 ui-layout 自己渲染的
  // `[data-slot="sidebar"]` 等槽标记；新外壳是 `[data-shell="launcher"]`。
  // 两侧都要两个特征，避免"属性写错导致假阳性"：launcher = 我们的标记在 + 原生特征不在；
  // native = 宿主原生特征在（右栏列或原生顶栏节点）+ 我们的标记不在。
  // 实测：[data-slot="sidebar"] 在两侧都会出现（framework 给声明的一方打标），所以不能用它判原生。
  // 判据换成"本实现的运行时标记 + 界面特征"双特征：launcher 有标记与 [data-shell]；
  // native 没有标记，且有宿主自己的 composer（textarea）与 root 槽挂载点。
  // 冒烟门禁：控制台里出现 `slot entry crashed` 一律算失败（单测覆盖不到浏览器侧）
  const crashed = errors.filter((line) => line.includes('slot entry crashed'))
  const seen = await page.evaluate(() => ({
    build: document.querySelector('[data-shell="launcher"]')?.getAttribute('data-build') ?? null,
    launcherMark: window.__DSH_LAUNCHER_SHELL__ === true,
    launcherShell: document.querySelector('[data-shell="launcher"]') !== null,
    hostRoot: document.querySelector('[data-slot="root"]') !== null,
    composer: document.querySelectorAll('textarea').length > 0,
    conflict: document.getElementById('launcher-conflict')?.textContent ?? null,
  }))
  // native 不靠 composer（新开页面没有会话，composer 可能还没渲染）：标记与外壳都不在 + root 槽已挂载即可。
  // 判决口径：launcher 模式下只要没看到我们自己的标记/外壳，就判 launcher-missing（**失败**），
  // 不能因为看到原生槽就当成通过——那正是"只写依赖不写 bundles"时会出现的假象。
  let verdict = 'ok'
  if (expected === 'launcher') {
    if (seen.conflict !== null) verdict = 'launcher-conflict'
    else if (!seen.launcherMark || !seen.launcherShell) verdict = 'launcher-missing'
  } else if (seen.launcherMark || seen.launcherShell) verdict = 'native-but-launcher'
  else if (!seen.hostRoot) verdict = 'native-no-host-root'
  if (crashed.length > 0) verdict = 'slot-entry-crashed'
  // 有会话时的追加判据（SESSION_URL 开关）：注册成功 ≠ 渲染出来
  let sessionActions = null
  if (process.env.SESSION_URL) {
    try {
      await page.goto(process.env.SESSION_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.SESSION_WAIT ?? 12000)))
      sessionActions = await page.evaluate(() => ({
        buttons: document.querySelectorAll('.launcher-turn-action').length,
        actions: [...document.querySelectorAll('[data-action]')].map((n) => n.getAttribute('data-action')),
      }))
      if (sessionActions.buttons < 2) verdict = 'session-actions-missing'
    } catch {
      sessionActions = { buttons: -1, actions: [] }
      verdict = 'session-actions-missing'
    }
  }
  const ok = verdict === 'ok'
  process.stdout.write(`${JSON.stringify({ expected, verdict, seen, sessionActions, errors: errors.slice(0, 4) })}\n`)
  if (!ok) {
    process.stderr.write(`壳层断言失败：[${verdict}] 期望 ${expected}，实测 ${JSON.stringify(seen)}\n`)
    process.exit(1)
  }
  process.stdout.write(`壳层断言通过：${expected}\n`)
} finally {
  await browser.close().catch(() => {})
}
