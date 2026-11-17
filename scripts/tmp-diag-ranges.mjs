// 诊断：看 V8 原始覆盖数据里，一个「没人调用过的导出函数」长什么样，
// 以及跨进程聚合后它的区间长什么样。
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const covDir = process.argv[2];
const targetName = process.argv[3] || 'atomic.js';

const merged = new Map();
for (const name of readdirSync(covDir)) {
  if (!name.endsWith('.json')) continue;
  const parsed = JSON.parse(readFileSync(join(covDir, name), 'utf8'));
  for (const entry of parsed.result || []) {
    const file = resolve(decodeURIComponent(String(entry.url).replace(/^file:\/\//, '').replace(/^\//, '')));
    let ranges = merged.get(file);
    if (!ranges) { ranges = new Map(); merged.set(file, ranges); }
    for (const fn of entry.functions || []) {
      for (const range of fn.ranges || []) {
        const key = `${range.startOffset}:${range.endOffset}`;
        const prev = ranges.get(key);
        ranges.set(key, prev === undefined ? range.count : Math.max(prev, range.count));
      }
    }
  }
}

for (const [file, ranges] of merged) {
  if (!file.endsWith(targetName)) continue;
  console.log('file:', file);
  const zero = [...ranges.entries()].filter(([, c]) => c === 0);
  const positive = [...ranges.entries()].filter(([, c]) => c > 0);
  console.log('  区间总数:', ranges.size, ' count=0 的:', zero.length, ' count>0 的:', positive.length);
  const source = readFileSync(file, 'utf8');
  // 找出 count=0 区间里的行，看它们是否落在某个 count>0 区间内
  let uncovered = 0;
  for (const [key, count] of zero) {
    const [start, end] = key.split(':').map(Number);
    const inPositive = positive.some(([k]) => {
      const [ps, pe] = k.split(':').map(Number);
      return ps < end && pe > start;
    });
    if (!inPositive) uncovered += 1;
  }
  console.log('  count=0 且不在任何 count>0 区间内的:', uncovered);
  // 打印前 5 个 count=0 区间
  for (const [key, count] of zero.slice(0, 5)) {
    const [start, end] = key.split(':').map(Number);
    const line = source.slice(0, start).split('\n').length;
    console.log(`    zero range ${key} -> line ${line}: ${source.slice(start, Math.min(end, start + 60)).replace(/\n/g, ' ')}`);
  }
}
