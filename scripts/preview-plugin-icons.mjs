// 视觉验收：从真实 client.js 抽出图标数据与样式，渲染插件中心的图标用例
//   node scripts/preview-plugin-icons.mjs
// 输出：%TEMP%/dsh-plugin-icons-preview.html（临时文件，不入库）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT = fs.readFileSync(path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js'), 'utf8')

// 1) 抽 ICONS 表
const mapStart = CLIENT.indexOf('const ICONS = {')
const mapEnd = CLIENT.indexOf('\n  }', mapStart)
const mapBody = CLIENT.slice(mapStart + 'const ICONS = {'.length, mapEnd)
const ICONS = {}
for (const m of mapBody.matchAll(/\n\s{4}([a-zA-Z0-9_]+):\s*("(?:[^"\\]|\\.)*")/g)) {
  ICONS[m[1]] = JSON.parse(m[2])
}

// 2) 抽样式（文件开头的 `const css = \`...\``）
const cssStart = CLIENT.indexOf('const css = `')
const endTick = CLIENT.indexOf('\n}`', CLIENT.indexOf('const css = `'))
const rawCss = endTick < 0 ? '' : CLIENT.slice(CLIENT.indexOf('const css = `') + 'const css = `'.length, endTick + 2)

// 3) 抽分类图标映射
const catBlock = CLIENT.match(/const CATEGORY_ICONS = \{([\s\S]*?)\n  \}/)[1]
const CATEGORY_ICONS = {}
for (const m of catBlock.matchAll(/([a-zA-Z0-9_]+):\s*'([a-zA-Z0-9_]+)'/g)) CATEGORY_ICONS[m[1]] = m[2]

// 4) 渲染
const icon = (key, size, stroke = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || ICONS.puzzle}</svg>`

const catRows = Object.entries(CATEGORY_ICONS).map(([cat, key]) => `
  <div class="dsh-pm-row" style="gap:10px;align-items:center">
    <div class="dsh-pm-icon-tile dsh-pm-icon-sm">${icon(key, 16)}</div>
    <div class="dsh-pm-row-main">
      <div class="dsh-pm-row-title">${cat}</div>
      <div class="dsh-pm-row-meta">${key}</div>
    </div>
    <span class="dsh-pm-card-chip">${icon(key, 10)}${cat}</span>
  </div>`).join('')

const cardRows = ['store', 'terminal', 'archive', 'gear', 'panel', 'library', 'tree', 'notes'].map((key) => `
  <div class="dsh-pm-card" style="width:210px;padding:10px">
    <div class="dsh-pm-card-top">
      <div class="dsh-pm-icon-tile dsh-pm-icon-md">${icon(key, 18)}</div>
      <div class="dsh-pm-card-who"><div class="dsh-pm-card-name">${key}</div><div class="dsh-pm-card-by">demo</div></div>
    </div>
    <div class="dsh-pm-card-chip" style="margin-top:8px">${icon(key, 10)}分类</div>
  </div>`).join('')

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
${rawCss}
/* 强制浅色令牌（盖过真实 CSS 的暗色媒体查询，用于验收白天形态） */
:root{--dsw-alias-label-primary:#111114;--dsw-alias-label-secondary:#4b4b53;--dsw-alias-label-tertiary:#86868e;--dsw-alias-bg-layer-1:#f2f2f5;--dsw-alias-bg-layer-2:#ececf1;--dsw-alias-border-l2:#e2e2e8;--dsw-alias-border-l3:#d5d5dc}
.dark{--dsw-alias-label-primary:#f2f2f5;--dsw-alias-label-secondary:#b9b9c2;--dsw-alias-label-tertiary:#86868e;--dsw-alias-bg-layer-1:#101013;--dsw-alias-bg-layer-2:#26272e;--dsw-alias-border-l2:#2d2e36;--dsw-alias-border-l3:#3a3b44}
body{margin:0;padding:24px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:13px/1.5 -apple-system,"Segoe UI","PingFang SC",sans-serif}
.wrap{max-width:1000px}
h3{font-size:13px;margin:18px 0 8px}
.dark{--dsw-alias-label-primary:#f2f2f5;--dsw-alias-bg-layer-1:#16171b;--dsw-alias-bg-layer-2:#202127;--dsw-alias-border-l2:#2d2e36;--dsw-alias-border-l3:#3a3b44;--dsw-alias-label-secondary:#b9b9c2;--dsw-alias-label-tertiary:#86868e;background:#0f1013}
.grid{display:flex;flex-wrap:wrap;gap:10px}
</style></head><body>
<div class="wrap">
  <h3>分类图标（行内 16px / chip 10px）</h3>
  <div style="padding:8px">${catRows}</div>
  <h3>卡片图标块（18px）</h3>
  <div class="grid">${cardRows}</div>
</div>
</body></html>`

const out = path.join(os.tmpdir(), 'dsh-plugin-icons-preview.html')
fs.writeFileSync(out, html, 'utf8')
console.log('written', out, '| icons:', Object.keys(ICONS).length)
