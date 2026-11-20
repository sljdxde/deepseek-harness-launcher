// 流光效果修正：完整边框打底 + 流光彗头叠加
//   ::before 双层背景 = 静态完整描边圈（accent 38%）+ 沿边框跑的亮彗头，
//   mask 只留 2px 边框环，输入区内部不填充。
// 同步应用到真实客户端与 HTML 原型。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const OLD_CONIC = 'background:conic-gradient(from var(--aib-ang,0deg),transparent 0deg,'
const NEW_CONIC = 'background:linear-gradient(color-mix(in srgb,var(--ACCENT) 38%,transparent),color-mix(in srgb,var(--ACCENT) 38%,transparent)),conic-gradient(from var(--aib-ang,0deg),transparent 0deg,'

const FILES = [
  { p: path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js'), accent: 'var(--pm-accent)', anchor: 'background:conic-gradient(from var(--aib-ang,0deg),transparent 0deg,' },
  { p: path.join(ROOT, 'windows/docs/plugin-center-restyle-prototype.html'), accent: 'var(--accent)', anchor: 'background:conic-gradient(from var(--aib-ang,0deg),transparent 0deg,' },
]

for (const { p, accent } of FILES) {
  let s = fs.readFileSync(p, 'utf8')
  if (s.includes('linear-gradient(color-mix(in srgb,var(--ACCENT) 38%')) {
    console.log(path.basename(p), ': 已有完整边框打底，跳过')
    continue
  }
  if (!s.includes(OLD_CONIC)) { console.log(path.basename(p), ': 锚点缺失'); process.exit(1) }
  s = s.replace(OLD_CONIC, NEW_CONIC.split('var(--ACCENT)').join(accent))
  fs.writeFileSync(p, s)
  console.log(path.basename(p), ': 完整边框打底已加')
}
