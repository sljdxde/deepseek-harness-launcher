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
  puppeteer = (await import('puppeteer-core')).default
} catch {
  process.stderr.write('没有 puppeteer-core（npm i -D puppeteer-core）。手工断言见 shell-switch.sh verify 的输出。\n')
  process.exit(3)
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await new Promise((resolve) => setTimeout(resolve, 8_000))
  // 原生壳的特征不是 `.app`（0.2.2-rc.5 里没有这个类），而是 ui-layout 自己渲染的
  // `[data-slot="sidebar"]` 等槽标记；新外壳是 `[data-shell="launcher"]`。
  const seen = await page.evaluate(() => ({
    launcher: document.querySelector('[data-shell="launcher"]') !== null,
    native: document.querySelector('[data-slot="sidebar"]') !== null,
    conflict: document.getElementById('launcher-conflict')?.textContent ?? null,
  }))
  const ok = expected === 'launcher'
    ? seen.launcher && !seen.native
    : seen.native && !seen.launcher
  process.stdout.write(`${JSON.stringify({ expected, seen, errors: errors.slice(0, 4) })}\n`)
  if (!ok) {
    process.stderr.write(`壳层断言失败：期望 ${expected}，实测 launcher=${seen.launcher} native=${seen.native}\n`)
    process.exit(1)
  }
  process.stdout.write(`壳层断言通过：${expected}\n`)
} finally {
  await browser.close().catch(() => {})
}
