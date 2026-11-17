// 归档管理服务端（lib/index.js）的全分支回归：每个场景一个用例。
//
// 场景实现在 helpers/archive-scenarios.js —— 同一份场景也会被其余 import 了
// lib/index.js 的测试文件调用（原因见该文件的注释：覆盖率按进程取交集）。
import test from 'node:test';
import { scenarios } from './helpers/archive-scenarios.js';

for (const item of scenarios) {
  test(item.name, async () => { await item.run(); });
}
