// 生成一个候选对比页：几种「安装/下载」图形在 12px 实际尺寸下的效果
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadNormalized } from './lib/tabler-icons.mjs'

const SRC = path.join(os.tmpdir(), 'icon-research/tabler/package/icons/outline')
const names = ['download', 'arrow-down', 'arrow-bar-to-down', 'package-import', 'cloud-download', 'file-download']
const set = loadNormalized(SRC, names)

const rows = names.map((n) => {
  const inner = set[n]
  return `<tr>
    <td style="font-family:ui-monospace,monospace;font-size:11px">${n}</td>
    <td><span class="ic" data-ic="${n}" data-size="12"></span></td>
    <td style="font-size:12px"><span class="ic" data-ic="${n}" data-size="12"></span>安装</td>
    <td style="font-size:13px"><span class="ic" data-ic="${n}" data-size="13"></span>安装</td>
    <td><span class="ic" data-ic="${n}" data-size="20"></span></td>
  </tr>`
}).join('')

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  body{margin:0;padding:24px;background:#f2f2f5;color:#111114;font:13px/1.5 -apple-system,"Segoe UI","PingFang SC",sans-serif}
  .ic{align-items:center;display:inline-flex;justify-content:center;line-height:0;vertical-align:middle}
  table{border-collapse:collapse;background:#fff;border:1px solid #e2e2e8;border-radius:10px}
  td,th{border-bottom:1px solid #ededf1;padding:10px 14px;text-align:left}
  .btn{align-items:center;background:#eeedfd;border-radius:13px;color:#4f46e5;display:inline-flex;font-size:12px;font-weight:600;gap:4px;height:26px;padding:0 12px}
  h3{font-size:13px;margin:20px 0 8px}
</style></head><body>
<h3>候选图形（12 / 13px 实际尺寸）</h3>
<table><thead><tr><th>图标</th><th>12px</th><th>按钮内 12px</th><th>按钮内 13px</th><th>20px</th></tr></thead>
<tbody>${rows}</tbody></table>
<h3>放进真实按钮里看</h3>
<div style="display:flex;gap:14px;flex-wrap:wrap">
${names.map(n => `<span class="btn"><span class="ic" data-ic="${n}" data-size="12"></span>安装</span>`).join('')}
</div>
<script>
const SET = ${JSON.stringify(set)};
document.querySelectorAll(".ic").forEach(el => {
  el.innerHTML = '<svg width="'+(+el.dataset.size||12)+'" height="'+(+el.dataset.size||12)+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+(SET[el.dataset.ic]||'')+'</svg>';
});
</script></body></html>`

const out = path.join(os.tmpdir(), 'dsh-icon-work', 'install-icon-compare.html')
fs.writeFileSync(out, html, 'utf8')
console.log('written', out)
