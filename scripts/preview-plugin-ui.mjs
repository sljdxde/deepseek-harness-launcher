// 原型复刻验收页：用真实 client.js 的 CSS 渲染 AI 搜索条 + 详情浮窗 + 推荐位
//   node scripts/preview-plugin-ui.mjs
// 输出：%TEMP%/dsh-plugin-ui-preview.html（临时，不入库）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js'), 'utf8')

// 抽真实图标（生成器侧内联 SVG 用）
const mapStart = CLIENT.indexOf('const ICONS = {')
const mapEnd = CLIENT.indexOf('\n  }', mapStart)
const mapBody = CLIENT.slice(mapStart + 'const ICONS = {'.length, mapEnd)
const ICONS = {}
for (const m of mapBody.matchAll(/\n\s{4}([a-zA-Z0-9_]+):\s*("(?:[^"\\]|\\.)*")/g)) ICONS[m[1]] = JSON.parse(m[2])
const ic = (name, size) =>
  '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.puzzle) + '</svg>'

// 抽真实 CSS
const cssStart = CLIENT.indexOf('const css = `') + 'const css = `'.length
const tplStart = CLIENT.indexOf('const css = `') + 'const css = `'.length
const tplClose = CLIENT.indexOf('`', tplStart)
const rawCss = CLIENT.slice(tplStart, tplClose)
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
:root{--pm-accent:#4f46e5;--pm-accent-fg:#ffffff}
${rawCss}
/* 与 dsh 外壳一致的浅/深两套令牌（真实面板由 dsh 注入，这里静态复刻两态） */
.dsh-pm-page{--pm-accent:#4f46e5;--pm-accent-fg:#ffffff}
.light{
  --dsw-alias-label-primary:#111114; --dsw-alias-label-secondary:#4b4b53;
  --dsw-alias-label-tertiary:#86868e; --dsw-alias-bg-layer-1:#ffffff;
  --dsw-alias-bg-layer-2:#ececf1; --dsw-alias-border-l2:#e2e2e8; --dsw-alias-border-l3:#d5d5dc;
  --dsw-alias-state-success-primary:#189a58; --dsw-alias-state-error-primary:#d64545;
  --dsw-alias-button-ghost-active-fill:#ececf1;
  --fg:#1c1c21;
  background:#f2f2f5;
}
.dark{
  --dsw-alias-label-primary:#f2f2f5; --dsw-alias-label-secondary:#b9b9c2;
  --dsw-alias-label-tertiary:#86868e; --dsw-alias-bg-layer-1:#191a1f;
  --dsw-alias-bg-layer-2:#26272e; --dsw-alias-border-l2:#2d2e36; --dsw-alias-border-l3:#3a3b44;
  --dsw-alias-state-success-primary:#3fbd7f; --dsw-alias-state-error-primary:#f0655f;
  --dsw-alias-button-ghost-active-fill:#26272e;
  --fg:#f2f2f5;
  background:#101013;
}
body{margin:0;font:13px/1.5 -apple-system,"Segoe UI","PingFang SC",sans-serif}
.scene{padding:22px 26px}
.scene h3{font-size:13px;margin:0 0 12px}
.stage{position:relative;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;overflow:hidden;height:430px}
</style></head><body>

<div class="scene light">
  <h3>分类条（收起态）</h3>
  <div class="dsh-pm-catbar"><div class="dsh-pm-catrow">
    <div class="dsh-pm-segs">
      <button class="dsh-pm-seg">界面 <span class="n">2399</span></button>
      <button class="dsh-pm-seg">工具 <span class="n">1677</span></button>
      <button class="dsh-pm-seg">会话 <span class="n">931</span></button>
      <button class="dsh-pm-seg on">记忆 <span class="n">510</span></button>
      <button class="dsh-pm-seg more">全部 25 类</button>
    </div>
    <div class="dsh-pm-filters">
      <div class="dsh-pm-segs mini">
        <button class="dsh-pm-segf on">全部</button>
        <button class="dsh-pm-segf">官方</button>
        <button class="dsh-pm-segf">社区</button>
      </div>
      <div class="dsh-pm-segs mini">
        <button class="dsh-pm-segf on">星标</button>
        <button class="dsh-pm-segf">下载量</button>
        <button class="dsh-pm-segf">最新</button>
      </div>
    </div>
  </div></div>

  <h3 style="margin-top:18px">分类条（展开态：同一容器换行 + 末尾「收起」）</h3>
  <div class="dsh-pm-catbar"><div class="dsh-pm-catrow">
    <div class="dsh-pm-segs xp">
      <button class="dsh-pm-seg">界面 <span class="n">2399</span></button>
      <button class="dsh-pm-seg">工具 <span class="n">1677</span></button>
      <button class="dsh-pm-seg">会话 <span class="n">931</span></button>
      <button class="dsh-pm-seg">工作流 <span class="n">726</span></button>
      <button class="dsh-pm-seg">开发 <span class="n">664</span></button>
      <button class="dsh-pm-seg">用量 <span class="n">650</span></button>
      <button class="dsh-pm-seg">模型 <span class="n">602</span></button>
      <button class="dsh-pm-seg on">记忆 <span class="n">510</span></button>
      <button class="dsh-pm-seg">技能 <span class="n">430</span></button>
      <button class="dsh-pm-seg">主题 <span class="n">429</span></button>
      <button class="dsh-pm-seg">通知 <span class="n">401</span></button>
      <button class="dsh-pm-seg">娱乐 <span class="n">387</span></button>
      <button class="dsh-pm-seg">远程 <span class="n">340</span></button>
      <button class="dsh-pm-seg">安全 <span class="n">305</span></button>
      <button class="dsh-pm-seg">浏览器 <span class="n">233</span></button>
      <button class="dsh-pm-seg">文档 <span class="n">228</span></button>
      <button class="dsh-pm-seg xall">收起</button>
    </div>
    <div class="dsh-pm-filters">
      <div class="dsh-pm-segs mini">
        <button class="dsh-pm-segf on">全部</button>
        <button class="dsh-pm-segf">官方</button>
        <button class="dsh-pm-segf">社区</button>
      </div>
    </div>
  </div></div>

  <div class="dsh-pm-body" style="margin-top:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;padding:18px">
    <div class="dsh-pm-grid" style="display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(230px,1fr))">
      <div class="dsh-pm-card">
        <div class="dsh-pm-card-top">
          <div class="dsh-pm-icon-tile dsh-pm-icon-md">${ic('terminal-2', 18)}</div>
          <div class="dsh-pm-card-who"><div class="dsh-pm-card-name">dsh-TUI</div><div class="dsh-pm-card-by">ccch1mneyyy</div></div>
          <button class="dsh-pm-install">${ic('install', 12)}安装</button>
        </div>
        <div class="dsh-pm-card-sum" style="color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.45">Claude Code 风格全屏终端 UI。</div>
        <div class="dsh-pm-card-chip">${ic('layout-sidebar-left-expand', 10)}界面</div>
      </div>
    </div>
  </div>
</div>

<div class="scene light">
  <h3>浅色：AI 搜索条（常态流光描边）</h3>
  <div class="stage" style="background:var(--dsw-alias-bg-layer-1);padding:22px">
    <form class="dsh-pm-ai-bar">
      <span class="spark">${ic('sparkle', 16)}</span>
      <span class="dsh-pm-ai-badge">AI 搜索</span>
      <input class="inp" placeholder="描述你想要的插件，例如「把会话导出成 Markdown」">
      <button type="button" class="dsh-pm-ai-go">${ic('search', 13)}找插件</button>
    </form>
    <div style="height:16px"></div>
    <!-- 详情小浮窗：贴点击处（这里演示以行中心为点击点） -->
    <div class="dsh-pm-rank-row" style="position:relative">
      <span class="rk">2</span>
      <div class="dsh-pm-icon-tile dsh-pm-icon-sm">${ic('palette', 16)}</div>
      <div class="who"><div class="nm">modlens</div><div class="sub">视觉 · ↓ 63.8k/周 · ★ 3.2k</div></div>
      <button class="dsh-pm-install">${ic('install', 12)}安装</button>
    </div>
    <div class="dsh-pm-mask"></div>
    <div class="dsh-pm-drawer" style="left:230px;top:96px">
      <div class="dsh-pm-drawer-head">
        <div style="flex:1;min-width:0">
          <div class="dsh-pm-drawer-title">modlens<span class="dsh-pm-drawer-meta"> · lensworks · 视觉</span></div>
        </div>
        <button class="dsh-pm-drawer-close">×</button>
      </div>
      <div class="dsh-pm-drawer-desc">给 dsh 换一套可调参的主题引擎：字体、密度、圆角与动效曲线都能在设置里微调。</div>
      <div class="dsh-pm-drawer-stats"><span>★ 3200</span><span>下载 63800</span><span>添加于 2026-05-11</span></div>
      <div class="dsh-pm-drawer-actions">
        <button class="dsh-pm-install">${ic('install', 12)}安装</button>
        <a class="dsh-pm-drawer-link">在 GitHub 上查看 ↗</a>
      </div>
    </div>
  </div>
</div>

<div class="scene dark">
  <h3>夜晚：同一结构</h3>
  <div class="stage dark" style="background:var(--dsw-alias-bg-layer-1);padding:22px">
    <form class="dsh-pm-ai-bar">
      <span class="spark">${ic('sparkle', 16)}</span>
      <span class="dsh-pm-ai-badge">AI 搜索</span>
      <input class="inp" placeholder="描述你想要的插件，例如「把会话导出成 Markdown」">
      <button type="button" class="dsh-pm-ai-go">${ic('search', 13)}找插件</button>
    </form>
    <div style="height:16px"></div>
    <div class="dsh-pm-rank-row" style="position:relative">
      <span class="rk">2</span>
      <div class="dsh-pm-icon-tile dsh-pm-icon-sm">${ic('palette', 16)}</div>
      <div class="who"><div class="nm">modlens</div><div class="sub">视觉 · ↓ 63.8k/周 · ★ 3.2k</div></div>
      <button class="dsh-pm-install">${ic('install', 12)}安装</button>
    </div>
    <div class="dsh-pm-mask"></div>
    <div class="dsh-pm-drawer" style="left:230px;top:96px">
      <div class="dsh-pm-drawer-head">
        <div style="flex:1;min-width:0">
          <div class="dsh-pm-drawer-title">modlens<span class="dsh-pm-drawer-meta"> · lensworks · 视觉</span></div>
        </div>
        <button class="dsh-pm-drawer-close">×</button>
      </div>
      <div class="dsh-pm-drawer-desc">给 dsh 换一套可调参的主题引擎：字体、密度、圆角与动效曲线都能在设置里微调。</div>
      <div class="dsh-pm-drawer-stats"><span>★ 3200</span><span>下载 63800</span><span>添加于 2026-05-11</span></div>
      <div class="dsh-pm-drawer-actions">
        <button class="dsh-pm-install">${ic('install', 12)}安装</button>
        <a class="dsh-pm-drawer-link">在 GitHub 上查看 ↗</a>
      </div>
    </div>
  </div>
</div>

</body></html>`

const out = path.join(os.tmpdir(), 'dsh-plugin-ui-preview.html')
fs.writeFileSync(out, html, 'utf8')
console.log('written', out)
