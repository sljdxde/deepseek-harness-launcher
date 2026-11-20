import fs from 'node:fs'
import { KEY_TO_TABLER } from './lib/tabler-icons.mjs'
const p = 'D:/003代码目录/deepseek-harness-launcher/windows/docs/plugin-center-restyle-prototype.html'
const s = fs.readFileSync(p, 'utf8')
const keys = new Set(Object.keys(KEY_TO_TABLER))
const used = new Set([...s.matchAll(/ICONS\.([a-zA-Z0-9_]+)/g)].map(m => m[1]))
const bad = [...used].filter(k => !keys.has(k))
console.log('引用的键:', used.size)
console.log('不存在的键（会渲染成空图标）:', bad.join(', ') || '无')
// data-ic 的取值也校验
const icNames = new Set([...s.matchAll(/data-ic="([a-z0-9-]+)"/g)].map(m => m[1]))
const badIc = [...icNames].filter(k => !keys.has(k))
console.log('data-ic 里不存在的键:', badIc.join(', ') || '无')
