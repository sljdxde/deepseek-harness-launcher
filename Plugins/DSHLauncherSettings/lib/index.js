/**
 * dsh-launcher-settings — 把启动器设置搬进 Harness 界面。
 *
 * 为什么要这个插件：启动器的设置在 Windows 上原本是一个独立的小窗口，
 * 它和 Harness 界面是两套视觉、两个入口，用户得先想到「去托盘右键」才找得到。
 * 把它做成 Harness 侧边栏的一个面板之后：
 *   · 入口在用户本来就看着的地方（侧边栏，紧挨着「设置」）；
 *   · 面板用 dsh 自己的设计令牌，深浅色自动跟随，与 Harness 浑然一体；
 *   · 设置的读写仍然落在启动器（%APPDATA%\DHL\settings.json），插件只做界面。
 *
 * 数据通路：
 *   GET  /dsh-launcher-settings/state   → 启动器当前设置 + 版本信息
 *   POST /dsh-launcher-settings/state   → 保存设置（部分字段）
 *
 * 启动器侧的对应实现见 windows/internal/app/settings_http.go。启动器没在跑
 * （例如用官方桌面版打开同一个 dsh）时，接口返回 503，面板显示为只读并说明
 * 原因 —— 不假装保存成功。
 */
export const name = 'dsh-launcher-settings'

/** 面板与启动器之间的路径前缀。 */
const BASE = '/dsh-launcher-settings'

/**
 * 默认值必须与启动器一致（windows/internal/app/actions.go 的 settingsFile）。
 * 两边都写死一份是有意的：插件不能依赖启动器在场才能渲染表单。
 */
export const DEFAULTS = {
  updateIntervalHours: 6,
  autoCheckPluginUpdates: true,
  openBrowserOnReady: true,
  launchAtLogin: false,
  globalHotKeyEnabled: true,
  globalHotKey: 'Ctrl+Alt+D',
  desktopShortcut: false,
  npmRegistry: 'https://registry.npmmirror.com',
}

/** 镜像源候选：国内优先，官方兜底。 */
export const REGISTRIES = [
  { id: 'npmmirror', url: 'https://registry.npmmirror.com', label: 'npmmirror（国内）', note: '默认' },
  { id: 'npmjs', url: 'https://registry.npmjs.org', label: 'npm 官方', note: '' },
]

/**
 * 把启动器返回的部分设置补齐成完整表单值。
 * 缺字段、类型不对、数值越界都在这里兜住 —— 面板永远拿到可渲染的值。
 */
export function normalizeSettings(raw) {
  const out = { ...DEFAULTS }
  if (!raw || typeof raw !== 'object') return out

  const num = raw.updateIntervalHours
  if (typeof num === 'number' && isFinite(num) && num >= 1) {
    out.updateIntervalHours = Math.min(720, Math.round(num))
  }
  for (const key of ['autoCheckPluginUpdates', 'openBrowserOnReady',
                     'launchAtLogin', 'globalHotKeyEnabled', 'desktopShortcut']) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key]
  }
  if (typeof raw.globalHotKey === 'string' && raw.globalHotKey.trim()) {
    out.globalHotKey = raw.globalHotKey.trim()
  }
  if (typeof raw.npmRegistry === 'string' && raw.npmRegistry.trim()) {
    out.npmRegistry = raw.npmRegistry.trim()
  }
  return out
}

/**
 * 保存前的校验。返回错误文案，或 null 表示可以提交。
 * 与启动器侧的校验保持一致，避免「界面放行、后端拒绝」的两套口径。
 */
export function validateSettings(values) {
  const hours = values.updateIntervalHours
  if (typeof hours !== 'number' || !isFinite(hours) || hours < 1) {
    return '检查频率至少为 1 小时'
  }
  if (hours > 720) return '检查频率最多为 720 小时'
  const chord = String(values.globalHotKey || '').trim()
  if (values.globalHotKeyEnabled) {
    if (!chord) return '启用全局快捷键时必须填写组合键'
    if (!/^[A-Za-z0-9+\s]+$/.test(chord)) return '快捷键只能包含字母、数字与 +'
    const parts = chord.split('+').map(s => s.trim()).filter(Boolean)
    if (parts.length < 2) return '快捷键至少要有一个修饰键，例如 Ctrl+Alt+D'
    const hasModifier = parts.some(p => /^(ctrl|control|alt|shift|win|windows)$/i.test(p))
    if (!hasModifier) return '快捷键需要 Ctrl / Alt / Shift / Win 之一'
  }
  return null
}

/** 只把与默认值不同的字段发回去，省得覆盖启动器里的其它设置。 */
export function diffFromDefaults(values) {
  const out = {}
  for (const [key, def] of Object.entries(DEFAULTS)) {
    if (values[key] !== def) out[key] = values[key]
  }
  return out
}

export function apply(ctx) {
  // dsh 的 HTTP 路由要通过 inject 拿到 webServer：直接读 ctx.webServer 在
  // 插件加载时还不存在（apply 早于服务装配），会抛「Cannot destructure」。
  ctx.inject(['webServer'], host => {
    const route = (path, handler) => host.webServer.register({
      kind: 'exact', path, handler,
    })

    // 启动器通过环境变量把自己的控制端口告诉插件；没有就是「启动器没在跑」
    const launcherBase = () => process.env.DHL_CONTROL_URL || ''
    const launcherToken = () => process.env.DHL_CONTROL_TOKEN || ''

    route(`${BASE}/state`, async (req, res) => {
      if (req.method === 'GET') {
        await handleGet(res, launcherBase(), launcherToken())
        return
      }
      if (req.method === 'POST') {
        await handlePost(req, res, launcherBase(), launcherToken())
        return
      }
      sendJSON(res, 405, { ok: false, error: 'method not allowed' })
    })
  })
}

/** GET：读启动器的设置与版本。 */
async function handleGet(res, base, token) {
  if (!base) {
    sendJSON(res, 200, { available: false, reason: '启动器未运行', settings: DEFAULTS })
    return
  }
  try {
    const upstream = await fetch(`${base}/settings`, {
      headers: { accept: 'application/json', 'X-DHL-Token': token },
    })
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`)
    const data = await upstream.json()
    sendJSON(res, 200, {
      available: true,
      settings: normalizeSettings(data.settings),
      versions: data.versions || {},
    })
  } catch (err) {
    sendJSON(res, 200, {
      available: false,
      reason: `无法读取启动器设置：${err && err.message ? err.message : err}`,
      settings: DEFAULTS,
    })
  }
}

/** POST：校验后转发给启动器保存。 */
async function handlePost(req, res, base, token) {
  if (!base) {
    sendJSON(res, 503, { ok: false, error: '启动器未运行，设置无法保存' })
    return
  }
  let body = {}
  try {
    body = await readJSON(req)
  } catch {
    sendJSON(res, 400, { ok: false, error: '请求体不是合法 JSON' })
    return
  }
  const merged = normalizeSettings({ ...DEFAULTS, ...body })
  const problem = validateSettings(merged)
  if (problem) {
    sendJSON(res, 400, { ok: false, error: problem })
    return
  }
  try {
    const upstream = await fetch(`${base}/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-DHL-Token': token,
      },
      body: JSON.stringify(body),
    })
    const text = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(text)
  } catch (err) {
    sendJSON(res, 502, {
      ok: false,
      error: `无法保存到启动器：${err && err.message ? err.message : err}`,
    })
  }
}

function sendJSON(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

async function readJSON(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}
