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
//     —— 任一进程真的执行过就算覆盖过，这与「这段代码是否被测到」的语义一致；
//   * 再按 V8 区间的**嵌套**做差集：外层 count>0 的区间扣掉更具体的
//     count=0 区间，剩下的字节才算真的被执行过。
//
// 输出统一用 ASCII：Windows 控制台默认 GBK，中文会被替换/截断，读起来像乱码。
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

// 自动发现：Plugins/ 下任何带 test(s)/ 的插件都跑测试；其中"有 lib 代码却没有任何
// TARGETS 条目"的插件视为免检口 → 直接失败（新插件不会再被漏掉）。
// GRANDFATHERED 是两个历史插件（只有 index.js，尚未纳入 100% 门禁），显式挂账；
// 新插件想豁免必须加进这个名单并在评审里说明理由。
const GRANDFATHERED = ['DSHInterruptedDot', 'DSHSessionNotify'];
const discovered = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((n) => {
    const base = join(pluginsDir, n);
    return existsSync(join(base, 'package.json')) &&
      (existsSync(join(base, 'test')) || existsSync(join(base, 'tests')));
  });
const pluginDirs = [...new Set(['DSHPluginManager', 'DSHArchiveManager', 'DSHChinaMirror', ...discovered])];
const uncovered = discovered.filter((n) =>
  !GRANDFATHERED.includes(n) && !TARGETS.some((t) => t.startsWith(`Plugins/${n}/`)));
if (uncovered.length) {
  console.error(`✗ 覆盖率门禁：这些插件有测试却没有任何 TARGETS 条目（免检口）：${uncovered.join(', ')}`);
  console.error('  修法：把其 lib/*.js 加进 TARGETS；确属历史豁免则加进 GRANDFATHERED 并说明理由。');
  process.exit(1);
}
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
  console.error('coverage: no test files found');
  process.exit(1);
}

// 覆盖数据目录必须在仓库外：node --test 的每个 worker 各自写一份 JSON。
const covDir = mkdtempSync(join(process.env.TEMP || process.env.TMP || '.', 'dsh-cov-'));

console.log(`coverage: running ${testFiles.length} test files...`);
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
  console.error('coverage: some tests failed - fix the tests first');
  const failures = ((result.stdout || '') + (result.stderr || '')).split('\n')
    .filter(line => /^\s*not ok /.test(line));
  if (failures.length) {
    console.error(`failing cases (${failures.length}):`);
    for (const line of failures) console.error('  ' + line.trim());
  } else {
    console.error(((result.stdout || '') + (result.stderr || '')).split('\n').slice(-40).join('\n'));
  }
  rmSync(covDir, { recursive: true, force: true });
  process.exit(1);
}

// ---- parse raw V8 coverage data ----
// Per process: absolute path -> list of {start, end, count} intervals.
// Processes are kept separate on purpose: each process has its own V8 counters
// and its own interval division (divided along the path it actually took).
// Mixing intervals across processes and then subtracting "count=0" holes
// would wrongly mark code as uncovered - one process took that branch while
// another did not, and the hole from the second would cancel out the
// coverage from the first.
// The correct aggregation is: compute the covered set **per process**
// (subtracting that process's own count=0 holes), then take the **union**
// across processes.
const perProcess = [];   // [{ file -> [{start,end,count}] }]
for (const name of readdirSync(covDir)) {
  if (!name.endsWith('.json')) continue;
  let parsed;
  try { parsed = JSON.parse(readFileSync(join(covDir, name), 'utf8')); } catch { continue; }
  const byFile = new Map();
  for (const entry of parsed.result || []) {
    // V8's url is file:///D:/... on Windows and file:///Users/... on macOS,
    // percent-encoded when the path has non-ASCII. fileURLToPath understands
    // both shapes; stripping the scheme by hand used to break every macOS path
    // (file:///Users/... became "Users/..." relative to the repo).
    let file;
    try {
      file = fileURLToPath(String(entry.url));
    } catch { continue; }
    let spans = byFile.get(file);
    if (!spans) { spans = []; byFile.set(file, spans); }
    for (const fn of entry.functions || []) {
      for (const range of fn.ranges || []) {
        spans.push({ start: range.startOffset, end: range.endOffset, count: range.count });
      }
    }
  }
  perProcess.push(byFile);
}

/**
 * Which lines are covered.
 *
 * V8's intervals are **nested**: the module has one count>0 range, the function
 * body another count>0 range, and the branches inside it that never ran are
 * smaller count=0 ranges. So "this line falls inside some count>0 range" is
 * always true (the outer range covers everything) - we have to subtract the
 * more specific count=0 ranges from the count>0 ones.
 */
function coveredLines(source, spans) {
  const covered = new Set();
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
    // Parts covered by a smaller count=0 range are still not covered.
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
  if (!existsSync(abs)) { console.error(`  x ${target}: file missing`); failed = true; continue; }
  const source = readFileSync(abs, 'utf8');
  const sourceLines = source.split('\n');
  const totalLines = sourceLines.length;
  // Union across processes: each process computes its own covered set
  // (subtracting its own count=0 holes), then we take the union.
  const covered = new Set();
  let seen = false;
  for (const byFile of perProcess) {
    const spans = byFile.get(resolve(abs));
    if (!spans) continue;
    seen = true;
    for (const line of coveredLines(source, spans)) covered.add(line);
  }
  if (!seen) { console.error(`  x ${target}: not present in coverage data (no test loaded it?)`); failed = true; continue; }
  const missed = [];
  for (let line = 1; line <= totalLines; line++) {
    // Blank lines and pure-comment lines carry no executable statement:
    // counting them as "uncovered" would be noise, not signal.
    const text = sourceLines[line - 1];
    const isComment = /^\s*(\/\/|\/\*|\*)/.test(text);
    if (!covered.has(line) && text.trim() !== '' && !isComment) missed.push(line);
  }
  const pct = totalLines > 0 ? ((totalLines - missed.length) / totalLines) * 100 : 100;
  const ok = pct >= THRESHOLD;
  console.log(`  ${ok ? 'ok' : 'x '} ${target}: ${pct.toFixed(2)}% line coverage (${totalLines - missed.length}/${totalLines})`);
  if (!ok) {
    failed = true;
    // Merge into ranges for readability.
    const rangesOut = [];
    for (const line of missed) {
      const last = rangesOut[rangesOut.length - 1];
      if (last && line === last[1] + 1) last[1] = line;
      else rangesOut.push([line, line]);
    }
    details.push(`\n  ${target} uncovered lines: ${rangesOut.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ')}`);
  }
}

for (const detail of details) console.log(detail);
if (process.env.COV_REPORT === '1') {
  const reportPath = join(repoRoot, 'windows/docs/coverage-report.txt');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, details.join('\n') || 'all targets met');
}

if (process.env.COV_KEEP_DIR) {
  console.log('KEEP_DIR=' + covDir);
} else {
  rmSync(covDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`\ncoverage: below the ${THRESHOLD}% threshold`);
  process.exit(1);
}
console.log(`coverage: all target files at or above ${THRESHOLD}% line coverage`);
