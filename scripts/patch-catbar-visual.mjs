// 分类条视觉对齐原型：
//   1. 轨道比内容区背景深一档（此前两者都是 bg-layer-2 → 轨道隐形，只剩白 thumb 在飘）
//   2. 筛选按钮（来源/排序）选中态也用白 thumb + seg-edge，与分类条一致
//   3. catrow 允许换行（原型 .catrow 有 flex-wrap:wrap），不再横向裁切
import fs from 'node:fs'
const p = 'D:/003代码目录/deepseek-harness-launcher/Plugins/DSHPluginManager/client/client.js'
let s = fs.readFileSync(p, 'utf8')
let n = 0
const rep = (oldStr, newStr, msg) => {
  if (!s.includes(oldStr)) { console.error('FAIL: ' + msg); process.exit(1) }
  s = s.replace(oldStr, newStr); n++
}

// 1) 轨道：在内容区背景（bg-layer-2）上再深/亮一档，并把裁切改成换行
rep(
  ".dsh-pm-segs{background:var(--dsw-alias-bg-layer-2);border-radius:7px;display:inline-flex;flex:0 1 auto;flex-wrap:nowrap;gap:2px;min-width:0;overflow-x:auto;padding:2px}",
  ".dsh-pm-segs{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,var(--dsw-alias-bg-layer-2));border-radius:7px;display:inline-flex;flex:0 1 auto;flex-wrap:wrap;gap:2px;min-width:0;padding:2px}",
  '轨道与内容区同色')

// 2) catrow 换行（原型 flex-wrap:wrap）
rep(
  ".dsh-pm-catrow{align-items:center;display:flex;gap:10px;min-width:0}",
  ".dsh-pm-catrow{align-items:center;display:flex;flex-wrap:wrap;gap:10px;min-width:0}",
  'catrow 换行')

// 3) 筛选按钮选中态：白 thumb + seg-edge（与分类条一致）
rep(
  ".dsh-pm-segf.on{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-button-ghost-active-fill));color:var(--dsw-alias-label-primary);font-weight:600}",
  ".dsh-pm-segf.on{background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.14),0 0 0 .5px rgba(0,0,0,.08);color:var(--dsw-alias-label-primary);font-weight:600}",
  '筛选选中态白 thumb')

fs.writeFileSync(p, s, 'utf8')
console.log('分类条视觉已对齐:', n, '处')
