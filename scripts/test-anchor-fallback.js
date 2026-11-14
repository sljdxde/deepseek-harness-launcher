// 旧版 WebKit 的 CSS 锚点定位降级：行为回归。
//
// 真实场景：DSH 前端用 anchor positioning 定位弹层，macOS 15 及更早的 WebKit
// 不支持它，`top`/`left` 退回字面量 12px —— 弹层全部叠在窗口左上角。
//
// 这个测试用极简 DOM 桩跑注入脚本的真实逻辑（脚本从 Swift 源里提取，避免两份
// 实现漂移），断言：
//   1. 不支持锚点时，弹层被摆到触发元素附近，而不是左上角；
//   2. 支持锚点时，脚本完全不动页面（新系统不受影响）；
//   3. 脚本幂等。
//
// 运行：node scripts/test-anchor-fallback.js

const fs = require('fs');
const path = require('path');

// ── 从 Swift 源提取脚本，保证测的就是真正注入的那份 ───────────────────────
const swiftPath = path.join(__dirname, '..', 'Sources', 'HarnessAnchorFallback.swift');
const swift = fs.readFileSync(swiftPath, 'utf8');
const match = swift.match(/static var userScript: String \{\s*"""([\s\S]*?)"""/);
if (!match) {
  console.error('✗ 无法从 HarnessAnchorFallback.swift 提取 userScript');
  process.exit(1);
}
const probe = "CSS.supports('position-anchor: --x') && CSS.supports('top: anchor(top)')";
const script = match[1].replace('\\(supportProbe)', probe);
if (script.includes('\\(')) {
  console.error('✗ 脚本里还有未替换的插值，提取逻辑已失效');
  process.exit(1);
}

const results = [];
function check(name, cond, extra) {
  results.push((cond ? '✅ ' : '❌ ') + name + (extra ? ' — ' + extra : ''));
}

// ── DOM 桩 ────────────────────────────────────────────────────────────────
class FakeHTMLElement {
  constructor(props = {}) {
    this.style = {};
    this.attributes = {};
    this.offsetWidth = 220;
    this.offsetHeight = 160;
    Object.assign(this, props);
  }
  getAttribute(k) { return this.attributes[k] ?? null; }
  setAttribute(k, v) { this.attributes[k] = v; }
  hasAttribute(k) { return k in this.attributes; }
  getBoundingClientRect() {
    // 触发元素在窗口中部：left=300, top=400, 高 28
    return { top: 400, bottom: 428, left: 300, right: 420, width: 120, height: 28 };
  }
}

function makeEnv({ supportsAnchor }) {
  const trigger = new FakeHTMLElement();
  const menu = new FakeHTMLElement({ id: 'model-menu' });
  const env = {
    window: {
      __dshAnchorFallbackInstalled: false,
      innerWidth: 1400,
      innerHeight: 900,
      addEventListener() {},
    },
    document: {
      documentElement: {},
      body: {},
      activeElement: trigger,
      contains: () => true,
      querySelectorAll: () => [menu],
      addEventListener() {},
    },
    CSS: { supports: (expr) => (expr.includes('anchor') ? supportsAnchor : true) },
    getComputedStyle: () => ({ position: 'fixed', display: 'flex', visibility: 'visible' }),
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (fn) => fn(),
    HTMLElement: FakeHTMLElement,
    Element: class { closest() { return trigger; } },
  };
  return { env, menu, trigger };
}

function run(env) {
  const names = Object.keys(env);
  const saved = {};
  for (const n of names) { saved[n] = global[n]; global[n] = env[n]; }
  try {
    eval(script);
  } finally {
    for (const n of names) { global[n] = saved[n]; }
  }
}

// ── 用例 1：旧 WebKit（不支持锚点）────────────────────────────────────────
{
  const { env, menu } = makeEnv({ supportsAnchor: false });
  run(env);
  const top = parseInt(menu.style.top, 10);
  const left = parseInt(menu.style.left, 10);

  check('旧 WebKit：脚本已安装', env.window.__dshAnchorFallbackInstalled === true);
  check('旧 WebKit：弹层被打上降级标记', menu.attributes['data-dsh-anchor-fallback'] === '1');
  check('旧 WebKit：top 不再是 12px', top !== 12, `top=${menu.style.top}`);
  check('旧 WebKit：left 不再是 12px', left !== 12, `left=${menu.style.left}`);
  check('旧 WebKit：竖直方向贴着触发元素（下方或上方）',
    top === 432 || top <= 400, `top=${top}（触发元素 400-428）`);
  check('旧 WebKit：水平方向与触发元素对齐', Math.abs(left - 300) <= 120, `left=${left}`);
  check('旧 WebKit：位置在视口内',
    top >= 12 && left >= 12 && left < env.window.innerWidth,
    `top=${top} left=${left}`);
  check('旧 WebKit：清掉了失效的 position-anchor', menu.style.positionAnchor === '');
}

// ── 用例 2：新 WebKit（支持锚点）──────────────────────────────────────────
{
  const { env, menu } = makeEnv({ supportsAnchor: true });
  run(env);
  check('新 WebKit：不改动弹层', menu.attributes['data-dsh-anchor-fallback'] === undefined);
  check('新 WebKit：不写死 top/left', menu.style.top === undefined && menu.style.left === undefined,
    `top=${menu.style.top} left=${menu.style.left}`);
}

// ── 用例 3：幂等 ─────────────────────────────────────────────────────────
{
  const { env, menu } = makeEnv({ supportsAnchor: false });
  run(env);
  const firstTop = menu.style.top;
  menu.style.top = '999px';       // 模拟页面后续改动
  run(env);                        // 重复注入应直接返回
  check('幂等：重复注入不重跑摆位', menu.style.top === '999px', `top=${menu.style.top}（首次 ${firstTop}）`);
}

// ── 用例 4：底部触发器不跑出屏幕 ─────────────────────────────────────────
{
  const { env, menu } = makeEnv({ supportsAnchor: false });
  // 触发元素贴底：菜单必须改到上方
  env.document.activeElement.getBoundingClientRect = () => ({
    top: 850, bottom: 878, left: 300, right: 420, width: 120, height: 28,
  });
  env.document.activeElement.closest = () => env.document.activeElement;
  run(env);
  const top = parseInt(menu.style.top, 10);
  check('贴底触发器：菜单改到上方', top < 850, `top=${top}`);
  check('贴底触发器：菜单在视口内', top >= 12, `top=${top}`);
}

console.log(results.join('\n'));
if (results.some((r) => r.startsWith('❌'))) process.exit(1);
