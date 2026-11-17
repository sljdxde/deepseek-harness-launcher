// 覆盖率门禁（scripts/test.sh 会跑）：插件的全部单元测试跑完后，
// 逐文件核对行覆盖率，低于阈值直接失败。
//
// 不用 c8/nyc：node 自带 --experimental-test-coverage 就够（v22+），
// 省一个依赖，也避免「覆盖率数据来自另一套插桩、与真实测试不同源」的问题。
//
// ── 为什么自己算，而不用 node 的报告表格 ──
//
// node 的报告是**跨进程聚合**后的结果：同一个文件被多个测试进程加载时，
// 它把各进程的区间按「函数名」合并 —— 于是一个只在某进程里 count=0 的
// 函数，可能被另一个进程的同名区间「覆盖」掉，报告显示 100% 而实际没跑到。
// 实测：往 atomic.js 里塞一个没人调用的函数，单跑报 99.13%（正确），
// 合跑却报 100%（假绿灯）。所以门禁自己解析 NODE_V8_COVERAGE 原始数据：
//   * 每个进程单独给每段代码的 count；
//   * 跨进程按 (startOffset, endOffset) 聚合，count 取**最大值**
//     —— 任一进程真的执行过就算覆盖过，这与「这段代码是否被测到」的语义一致。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');   // scripts/ 的上一级就是仓库根
const pluginsDir = join(repoRoot, 'Plugins');

// 需要 100% 行覆盖的目标文件（相对 repoRoot）。
// lib/ 下的每个模块都要在列：atomic.js（原子写/锁）与 operations.js（操作队列）
// 是插件的一部分，漏掉就等于给它们开了免检口。
const TARGETS = [
  'Plugins/DSHPluginManager/lib/index.js',
  'Plugins/DSHPluginManager/lib/atomic.js',
  'Plugins/DSHPluginManager/lib/operations.js',
  'Plugins/DSHPluginManager/client/client.js',
  'Plugins/DSHArchiveManager/lib/index.js',
  'Plugins/DSHArchiveManager/client/client.js',
  'Plugins/DSHChinaMirror/lib/index.js',
];

const THRESHOLD = Number(process.env.COV_THRESHOLD || 100);

const pluginDirs = ['DSHPluginManager', 'DSHArchiveManager', 'DSHChinaMirror'];
const testFiles = [];
for (const plugin of pluginDirs) {
  const dir = join(pluginsDir, plugin);
  if (!existsSync(dir)) continue;
  for (const sub of ['test', 'tests']) {
    const testDir = join(dir, sub);
    if (!existsSync(testDir)) continue;
    for (const name of readdirSync(testDir)) {
      // 冒烟脚本叫 *.smoke.mjs（不是 *.test.js），也要收进来：
      // client/client.js 的覆盖率全靠它（vm 里跑的客户端代码）。
      if (/\.(test|spec)\.(js|mjs|cjs)$/.test(name) || /\.smoke\.mjs$/.test(name)) testFiles.push(join(testDir, name));
    }
  }
}
if (testFiles.length === 0) {
  console.error('覆盖率：没找到任何测试文件');
  process.exit(1);
}

// 覆盖数据目录必须在仓库外：node --test 的每个 worker 各自写一份 JSON。
const covDir = mkdtempSync(join(process.env.TEMP || process.env.TMP || '.', 'dsh-cov-'));

console.log(`覆盖率：跑 ${testFiles.length} 个测试文件…`);
if (process.env.COV_DEBUG_DIR) console.log('COV_DIR=' + covDir);
const result = spawnSync(process.execPath, [
  '--test',
  '--test-reporter=tap',
  ...testFiles,
], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, NODE_V8_COVERAGE: covDir },
});

if (result.status !== 0) {
  console.error('覆盖率：测试本身没全绿，先修测试再谈覆盖率');
  const failures = ((result.stdout || '') + (result.stderr || '')).split('\n')
    .filter(line => /^\s*not ok /.test(line));
  if (failures.length) {
    console.error(`失败用例 ${failures.length} 个：`);
    for (const line of failures) console.error('  ' + line.trim());
  } else {
    console.error(((result.stdout || '') + (result.stderr || '')).split('\n').slice(-40).join('\n'));
  }
  rmSync(covDir, { recursive: true, force: true });
  process.exit(1);
}

// ---- 解析 V8 原始覆盖数据，跨进程聚合 ----
/** 绝对路径 → Map<区间键, count> */
const merged = new Map();
for (const name of readdirSync(covDir)) {
  if (!name.endsWith('.json')) continue;
  let parsed;
  try { parsed = JSON.parse(readFileSync(join(covDir, name), 'utf8')); } catch { continue; }
  for (const entry of parsed.result || []) {
    let file;
    try { file = fileURLToPath(entry.url); } catch { continue; }
    file = resolve(file);
    let ranges = merged.get(file);
    if (!ranges) { ranges = new Map(); merged.set(file, ranges); }
    for (const fn of entry.functions || []) {
      for (const range of fn.ranges || []) {
        const key = `${range.startOffset}:${range.endOffset}`;
        const previous = ranges.get(key);
        // 同一段代码在多个进程里出现：任一进程执行过（count>0）就算覆盖。
        ranges.set(key, previous === undefined ? range.count : Math.max(previous, range.count));
      }
    }
  }
}

/**
 * 哪些行被覆盖。
 *
 * V8 给的区间是**嵌套**的：模块整体一个 count>0 的区间，函数体又是一个
 * count>0 的区间，函数体里没走到的分支则是更小的 count=0 区间。
 * 所以「这行落在某个 count>0 的区间里」永远成立（外层区间罩着整段）——
 * 必须按**区间嵌套**做差集：从 count>0 的区间里扣掉更具体的 count=0 区间，
 * 剩下的字节才算真的被执行过。
 */
function coveredLines(source, ranges) {
  const covered = new Set();
  const spans = [...ranges.entries()].map(([key, count]) => {
    const [start, end] = key.split(':').map(Number);
    return { start, end, count };
  });
  if (spans.length === 0) return covered;
  const lineOf = new Int32Array(source.length + 1);
  let line = 1;
  for (let i = 0; i <= source.length; i++) {
    lineOf[i] = line;
    if (source[i] === '\n') line += 1;
  }
  const mark = (from, to) => {
    for (let i = Math.max(0, from); i < to && i < source.length; i++) covered.add(lineOf[i]);
  };
  for (const span of spans) {
    if (span.count <= 0) continue;
    // 这个已覆盖区间里，被更小的 count=0 区间挖走的部分仍未覆盖。
    const holes = spans
      .filter(other => other.count === 0 && other.start >= span.start && other.end <= span.end)
      .map(other => [other.start, other.end])
      .sort((a, b) => a[0] - b[0]);
    if (holes.length === 0) { mark(span.start, span.end); continue; }
    let cursor = span.start;
    for (const [holeStart, holeEnd] of holes) {
      if (holeStart > cursor) mark(cursor, holeStart);
      cursor = Math.max(cursor, holeEnd);
    }
    if (cursor < span.end) mark(cursor, span.end);
  }
  return covered;
}

let failed = false;
const details = [];
for (const target of TARGETS) {
  const abs = join(repoRoot, target);
  if (!existsSync(abs)) { console.error(`  ✘ ${target}: 文件不存在`); failed = true; continue; }
  const ranges = merged.get(resolve(abs));
  if (!ranges) { console.error(`  ✘ ${target}: 覆盖数据里没有这个文件（测试没加载它？）`); failed = true; continue; }
  const source = readFileSync(abs, 'utf8');
  const sourceLines = source.split('\n');
  const totalLines = sourceLines.length;
  const covered = coveredLines(source, ranges);
  const missed = [];
  for (let line = 1; line <= totalLines; line++) {
    // 空行与纯注释行不算「未覆盖的行」：它们本来就没有可执行语句。
    if (!covered.has(line) && sourceLines[line - 1].trim() !== '' && !/^\s*(\/\/|\/\*|\*)/.test(sourceLines[line - 1])) {
      missed.push(line);
    }
  }
  const pct = totalLines > 0 ? ((totalLines - missed.length) / totalLines) * 100 : 100;
  const ok = pct >= THRESHOLD;
  console.log(`  ${ok ? '✔' : '✘'} ${target}: ${pct.toFixed(2)}% 行覆盖（${totalLines - missed.length}/${totalLines}）`);
  if (!ok) {
    failed = true;
    // 合并成区间，便于人读
    const rangesOut = [];
    for (const line of missed) {
      const last = rangesOut[rangesOut.length - 1];
      if (last && line === last[1] + 1) last[1] = line;
      else rangesOut.push([line, line]);
    }
    details.push(`\n  ${target} 未覆盖行：${rangesOut.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}`);
  }
}

for (const detail of details) console.log(detail);
if (process.env.COV_REPORT === '1') {
  const reportPath = join(repoRoot, 'windows/docs/coverage-report.txt');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, details.join('\n') || '全部达标');
}

if (process.env.COV_KEEP_DIR) { console.log('KEEP_DIR=' + covDir); } else { rmSync(covDir, { recursive: true, force: true }); }

if (failed) {
  console.error(`\n覆盖率：低于 ${THRESHOLD}% 门槛`);
  process.exit(1);
}
console.log(`覆盖率：全部目标文件行覆盖 ≥ ${THRESHOLD}%`);
