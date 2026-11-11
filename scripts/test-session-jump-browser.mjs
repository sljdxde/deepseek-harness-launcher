#!/usr/bin/env node
/**
 * 会话跳转的真实浏览器端到端回归（不 mock DOM / 不 mock 网络）。
 *
 * 背景：菜单栏点「会话完成」→ 启动器 POST /dsh-session-notify/open 入队一条
 * 「打开会话」命令，所有 Harness 页面轮询领取。多页面环境里，后台 Chrome 的
 * `document.hasFocus()` 会谎报 true（实测启动器在最前时它仍返回 true），于是
 * 自动化标签页也能领走命令、在自己看不见的窗口里切换会话——用户看到的就是
 * 「点了没反应」。这条测试用真实 Chromium 页面加载真实 client.js、真实 HTTP
 * 路由（apply(ctx) 接到真 http.Server），验证：
 *
 * 1. 外部 Chrome 页面没有真实用户操作时，不领取命令（命令留在队列里）；
 * 2. 外部 Chrome 页面收到真实鼠标操作后，可以正常领取并跳转；
 * 3. 内置 WKWebView（Safari UA）不需要用户操作也能领取；
 * 4. 两个页面同时在线时，命令归内置页面，不被后台 Chrome 抢走。
 *
 * 依赖：本机 Playwright（profiles 的 node_modules 里已有）。CI 没有时打印
 * SKIP 并退出 0，不阻塞回归；开发机必须真实跑起来。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SOURCE = path.join(ROOT, 'Plugins/DSHSessionNotify/client/client.js')
const require = createRequire(import.meta.url)

function loadPlaywright() {
  const candidates = [
    process.env.DSH_PLAYWRIGHT_PATH,
    path.join(os.homedir(), '.dsh/profiles/web/node_modules/playwright'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { return require(candidate) } catch { /* try next */ }
  }
  return null
}

const playwright = loadPlaywright()
if (!playwright) {
  console.log('SKIP 会话跳转浏览器回归：未找到 Playwright（可用 DSH_PLAYWRIGHT_PATH 指定）')
  process.exit(0)
}

/** 启动真实的 dsh-session-notify HTTP 服务（apply(ctx) + 真 http.Server）。 */
async function startPluginServer(clientSource) {
  const { apply } = await import(path.join(ROOT, 'Plugins/DSHSessionNotify/lib/index.js'))
  const routes = new Map()
  const listeners = new Map()
  const teardown = []
  const logger = { info() {}, warn(...args) { console.error('[plugin]', ...args) } }
  const host = {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
      return () => listeners.set(event, (listeners.get(event) || []).filter(item => item !== listener))
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect(setup) { teardown.push(setup()) },
    logger,
  }
  const ctx = {
    on: host.on,
    inject(deps, callback) { assert.deepEqual(deps, ['webServer']); callback(host) },
    logger,
  }
  apply(ctx)

  const pageHTML = `<!doctype html><meta charset="utf-8"><title>jump-e2e</title>
<script>
  window.__opened = [];
  window.__ModuleLoader__ = { load(record) { window.__plugin = record.factory() } };
</script>
<script src="/client.js"></script>
<script>
  const ids = ['session-from', 'session-target'];
  const byId = {
    'session-from': { id: 'session-from', retainedBy: { mainView: 1 } },
    'session-target': { id: 'session-target', retainedBy: {} },
  };
  const subscribers = new Set();
  const list = {
    getSnapshot: () => ({ phase: 'ready', ids, byId }),
    subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
  };
  const ctx = {
    sessions: { list },
    get(name) {
      if (name === 'uiWorkspace') return { openSession(id) { window.__opened.push(id) } };
      return undefined;
    },
    effect(setup) { window.__cleanup = setup() },
  };
  window.__plugin.apply(ctx);
</script>`

  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname
    if (pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(pageHTML)
      return
    }
    if (pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(clientSource)
      return
    }
    const handler = routes.get(pathname)
    if (!handler) { res.writeHead(404); res.end('not found'); return }
    try { await handler(req, res) } catch (error) {
      res.writeHead(500); res.end(String(error?.message || error))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      teardown.forEach(fn => fn())
      await new Promise(resolve => server.close(resolve))
    },
  }
}

async function openPage(browser, base, { safariUA = false } = {}) {
  const context = await browser.newContext({
    userAgent: safariUA
      ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  await page.goto(`${base}/`, { waitUntil: 'load' })
  // 等首次轮询拿到命令列表（750ms 一跳）。
  await page.waitForTimeout(1000)
  return { context, page }
}

async function queueCommand(base, sessionId, { requireEmbedded = false } = {}) {
  const response = await fetch(`${base}/dsh-session-notify/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, requireEmbedded }),
  })
  assert.equal(response.status, 200)
}

async function queuedCommands(base) {
  const response = await fetch(`${base}/dsh-session-notify/commands?clientId=e2e-probe&visible=0`)
  assert.equal(response.status, 200)
  const body = await response.json()
  return body.items
}

const browser = await playwright.chromium.launch({ headless: true })
const server = await startPluginServer(await readFile(CLIENT_SOURCE, 'utf8'))
try {
  // 1) 后台 Chrome 页面：没有真实用户操作，不得领取命令。
  {
    const { context, page } = await openPage(browser, server.base, { safariUA: false })
    await queueCommand(server.base, 'session-target')
    await page.waitForTimeout(2200)
    assert.deepEqual(await page.evaluate(() => window.__opened), [], '后台 Chrome 不应领取跳转命令')
    assert.equal((await queuedCommands(server.base)).length, 1, '命令应留在队列里等内置窗口')
    await context.close()
  }

  // 2) 外部 Chrome 页面：真实鼠标操作后可以领取（外部浏览器回退模式不被误伤）。
  {
    const { context, page } = await openPage(browser, server.base, { safariUA: false })
    await page.bringToFront()
    await page.mouse.click(12, 12)
    await queueCommand(server.base, 'session-target')
    await page.waitForTimeout(2200)
    assert.deepEqual(await page.evaluate(() => window.__opened), ['session-target'], '真实操作过的 Chrome 页面应能跳转')
    await context.close()
  }

  // 3) 内置 WKWebView（Safari UA）：不需要用户操作也能领取。
  {
    const { context, page } = await openPage(browser, server.base, { safariUA: true })
    await queueCommand(server.base, 'session-target')
    await page.waitForTimeout(2200)
    assert.deepEqual(await page.evaluate(() => window.__opened), ['session-target'], '内置页面应直接领取跳转命令')
    await context.close()
  }

  // 4) 两个页面同时在线：后台 Chrome 不得抢走本该给内置页面的命令。
  {
    const chrome = await openPage(browser, server.base, { safariUA: false })
    const embedded = await openPage(browser, server.base, { safariUA: true })
    await queueCommand(server.base, 'session-target')
    await chrome.page.waitForTimeout(2200)
    assert.deepEqual(await embedded.page.evaluate(() => window.__opened), ['session-target'], '命令应归内置页面')
    assert.deepEqual(await chrome.page.evaluate(() => window.__opened), [], '后台 Chrome 不得抢命令')
    await chrome.context.close()
    await embedded.context.close()
  }

  // 5) 启动器内置窗口模式：requireEmbedded 命令即使 Chrome 页面刚有真实操作也领不到。
  {
    const chrome = await openPage(browser, server.base, { safariUA: false })
    await chrome.page.bringToFront()
    await chrome.page.mouse.click(12, 12) // 让它看起来像「活跃」的 Chrome 页面
    const embedded = await openPage(browser, server.base, { safariUA: true })
    await queueCommand(server.base, 'session-target', { requireEmbedded: true })
    await chrome.page.waitForTimeout(2200)
    assert.deepEqual(await chrome.page.evaluate(() => window.__opened), [], 'requireEmbedded 命令不能被 Chrome 领取')
    assert.deepEqual(await embedded.page.evaluate(() => window.__opened), ['session-target'], '内置页面应领取 requireEmbedded 命令')
    await chrome.context.close()
    await embedded.context.close()
  }

  console.log('会话跳转浏览器回归通过：后台 Chrome 不再抢命令，内置页面正常跳转（含 requireEmbedded 定向）')
} finally {
  await server.close()
  await browser.close()
}
