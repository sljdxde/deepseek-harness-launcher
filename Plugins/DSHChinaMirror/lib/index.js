/**
 * dsh-china-mirror — 国内网络加速（宿主半边，内置插件）。
 *
 * 插件管理器走四类网络：npm registry（pnpm view/add 与官方市场查询）、GitHub raw
 * （远端 package.json / CHANGELOG）、GitHub API（raw 失败的兜底 + Releases）、以及
 * git clone（市场仓库与插件仓库）。国内直连这几类都慢或断流，本项目把 URL 映射到
 * 国内镜像：
 *
 *   npm registry      → https://registry.npmmirror.com（CoSYNC 同步，分钟级）
 *   GitHub raw        → https://raw.gitmirror.com（以及 gh-proxy 兜底）
 *   GitHub API        → 不映射（api.github.com 在国内多数网络可达，镜像无对应端点）
 *   git clone         → https://ghfast.top/https://github.com/...（gitclone.com 备选）
 *
 * 插件管理器在每次启动与每次网络调用组里读一次
 *
 *   GET /dsh-china-mirror/state
 *     → { enabled, table: [{ match, replace, kind, note }], updatedAt }
 *
 * `table` 是「有序替换规则」：逐条 `url.startsWith(match)` 命中即替换前缀。映射逻辑
 * 导出为纯函数 `mapURL(url, table)`，插件管理器与测试直接复用，不重复实现。
 *
 *   POST /dsh-china-mirror/enabled { enabled: boolean }
 *     → 立即写盘生效；不需要重启 dsh（读 state 是每次调用前的动作）。
 *
 * 状态存 `$DSH_HOME/china-mirror/state.json`（原子写）；没有该文件时默认关闭。
 * 本插件只管「开关 + 规则表」；**所有实际的 URL 替换都在插件管理器（消费方）里做**，
 * 它失败时自然回退直连，本插件不参与任何安装/更新流程。
 *
 * @module dsh-china-mirror
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** 插件名（cordis 用）。 */
export const name = 'dsh-china-mirror';

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh');
const stateFile = () => join(dshHome(), 'china-mirror', 'state.json');

/**
 * 镜像规则表（内置，不做成可配置项——镜像地址变了是发布新插件版本的事，
 * 用户自定义规则走插件管理器需求面再说）。顺序有意义：更具体的 match 在前。
 *
 * kind 是消费方的意图标签：registry 只映射 pnpm/npm 的 registry 域名（环境变量
 * 与 URL 两种途径都用它），raw 映射 GitHub 的 raw 文件域，git 映射 git clone 地址。
 *
 * @returns {{match:string,replace:string,kind:string,note:string}[]}
 */
export function mirrorURLTable() {
  return [
    {
      match: 'https://registry.npmjs.org/',
      replace: 'https://registry.npmmirror.com/',
      kind: 'registry',
      note: 'npm registry → npmmirror（分钟级同步）',
    },
    {
      match: 'https://raw.githubusercontent.com/',
      replace: 'https://raw.gitmirror.com/',
      kind: 'raw',
      note: 'GitHub raw → gitmirror',
    },
    {
      // codeload 必须排在 github.com 之前：它是 github.com 之外的独立域，
      // 但 ghfast 代理按「整串前缀替换」工作，更具体的先命中才不会被截胡。
      match: 'https://codeload.github.com/',
      replace: 'https://ghfast.top/https://codeload.github.com/',
      kind: 'git',
      note: 'git codeload → ghfast 加速',
    },
    {
      match: 'https://github.com/',
      replace: 'https://ghfast.top/https://github.com/',
      kind: 'git',
      note: 'git clone / codeload → ghfast 加速',
    },
  ];
}

/**
 * 按规则表映射一个 URL：逐条前缀匹配，命中第一条即替换并返回；不命中原样返回。
 * 纯函数，无 IO——插件管理器对每类请求选择性地套用（api.github.com 故意不在表里，
 * 保持直连），测试覆盖各分支。
 * @param {string} url - 原始 URL。
 * @param {{match:string,replace:string}[]} table - mirrorURLTable() 的输出（可截取）。
 * @returns {string}
 */
export function mapURL(url, table = mirrorURLTable()) {
  const value = url == null ? '' : String(url);
  if (!value) return value;
  // 已经是镜像地址的不再二次映射（幂等）：避免同一 URL 途经两条路径被套两层前缀。
  for (const rule of table) {
    if (value.startsWith(rule.replace)) return value;
  }
  for (const rule of table) {
    if (rule.match && value.startsWith(rule.match)) return rule.replace + value.slice(rule.match.length);
  }
  return value;
}

/**
 * 从映射结果反推原始 URL（测试与日志用）：只剥 ghfast 这类代理前缀和已知镜像域，
 * 避免误伤普通 URL。
 * @param {string} url - 可能已映射的 URL。
 * @param {{match:string,replace:string}[]} table - mirrorURLTable() 的输出。
 * @returns {string}
 */
export function unmapURL(url, table = mirrorURLTable()) {
  const value = url == null ? '' : String(url);
  for (const rule of table) {
    if (rule.replace && value.startsWith(rule.replace)) {
      return rule.match + value.slice(rule.replace.length);
    }
  }
  return value;
}

/** 读当前状态；没有状态文件时返回默认关闭。 */
export async function readMirrorState() {
  try {
    const raw = JSON.parse(await fs.readFile(stateFile(), 'utf8'));
    return {
      enabled: raw?.enabled === true,
      table: mirrorURLTable(),
      updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch {
    return { enabled: false, table: mirrorURLTable(), updatedAt: null };
  }
}

/** 写开关状态（原子写：tmp + rename），返回读回的状态。 */
export async function writeMirrorEnabled(enabled) {
  const value = enabled === true;
  const path = stateFile();
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify({ enabled: value, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, path);
  return readMirrorState();
}

/**
 * 插件入口：只注册两个路由，没有任何会话/文件监听。
 * @param ctx - cordis 上下文。
 */
export function apply(ctx) {
  ctx.inject(['webServer'], host => {
    host.effect(() => {
      const dispose = host.webServer.register({
        kind: 'exact',
        path: '/dsh-china-mirror/state',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' });
            res.end();
            return;
          }
          try {
            res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(await readMirrorState()));
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: String(error?.message || error) }));
          }
        },
      });
      const disposeToggle = host.webServer.register({
        kind: 'exact',
        path: '/dsh-china-mirror/enabled',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' });
            res.end();
            return;
          }
          try {
            let body = '';
            for await (const chunk of req) body += chunk;
            let parsed = null;
            try { parsed = JSON.parse(body || '{}'); } catch { /* 保持 null */ }
            if (typeof parsed?.enabled !== 'boolean') {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: '缺少 enabled 布尔值' }));
              return;
            }
            res.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(await writeMirrorEnabled(parsed.enabled)));
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: String(error?.message || error) }));
          }
        },
      });
      return () => { dispose(); disposeToggle(); };
    }, 'dsh-china-mirror: routes');
  });
}

