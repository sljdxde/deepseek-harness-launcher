// 流光交互修正：常态有流光，聚焦输入框后停止流光（切到聚焦态：白底 + accent 光晕）
// 同步应用到真实客户端与 HTML 原型，保持两边一致。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const RULE = `/* 聚焦输入框后停止流光：切到聚焦态（白底 + accent 光晕），不再有流光 */
.dsh-pm-ai-bar:focus-within::before{animation:none;opacity:0}`

// ── 真实客户端 ──
const CLIENT = path.join(ROOT, 'Plugins/DSHPluginManager/client/client.js')
let client = fs.readFileSync(CLIENT, 'utf8')
if (client.includes('.dsh-pm-ai-bar:focus-within::before')) {
  console.log('真实客户端: 已有该规则，跳过')
} else {
  const anchor = '.dsh-pm-ai-bar:focus-within{background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 3px color-mix(in srgb,var(--pm-accent) 22%,transparent),0 0 16px color-mix(in srgb,var(--pm-accent) 18%,transparent)}'
  if (!client.includes(anchor)) { console.error('FAIL: 真实客户端 focus 锚点缺失'); process.exit(1) }
  client = client.replace(anchor, anchor + '\n' + RULE)
  fs.writeFileSync(CLIENT, client, 'utf8')
  console.log('真实客户端: 已加聚焦停流光规则')
}

// ── HTML 原型 ──
const PROTO = path.join(ROOT, 'windows/docs/plugin-center-restyle-prototype.html')
let proto = fs.readFileSync(PROTO, 'utf8')
if (proto.includes('.aibar:focus-within::before')) {
  console.log('原型: 已有该规则，跳过')
} else {
  const anchor = '.aibar:focus-within{background:var(--card);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent),0 0 16px color-mix(in srgb,var(--accent) 18%,transparent)}'
  if (!proto.includes(anchor)) { console.error('FAIL: 原型 focus 锚点缺失'); process.exit(1) }
  proto = proto.replace(anchor, anchor + '\n.aibar:focus-within::before{animation:none;opacity:0}')
  fs.writeFileSync(PROTO, proto, 'utf8')
  console.log('原型: 已加聚焦停流光规则')
}
