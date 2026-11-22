# @deepseek-ai/dsh-client-ui-layout（DHL 新外壳）

同名 drop-in：包名就是宿主的 layout 包名（`@deepseek-ai/dsh-client-ui-layout`），装进 profile 后按名字顶替宿主实现，
把整站换成 v17 外壳（图标栏 + 侧栏 + 主区 + 右栏 dock + 底状态条），再挂右栏多标签、2/4/6 分屏、composer 四件与插件工作台容器。

`cordis.patch.yml` 保持 `[]`：不 insert 自己的行。换壳靠「替换实现」，不靠 patch 抢注（同一实现被加载两次会 root 注册两次）。

## 分发通道

两条通道都走 `dsh plugin`，不手改 `~/.dsh` 里的文件。

### 通道一：随 DHL 安装包默认携带（普通用户零安装）

DHL 安装包内置本包，安装时写进默认 profile；用户打开即是新外壳，无需自己装。
升级 DHL 时随包更新，启动前 HostGuard 自检宿主契约（版本/子槽/renderSlots/ILayout 成员/主题前缀），不符则回退原生 UI 并出横幅。

### 通道二：独立 `dsh plugin add`（开发 / 尝鲜 / 其它 launcher）

```sh
# 安装（按 file: 依赖装进 profile，内部转发给 pnpm）
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-layout@file:<本包绝对路径>"
# 升级：重装同一路径后重启 dsh
# 卸载（干净回原生：remove 摘依赖 + install 重算树，解析回宿主原包）
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-layout
dsh plugin --profile web install
# 之后重启 dsh（退出 dsh web 后重新打开，并硬刷新页面）
```

`dsh plugin add` 会把包装成 profile 的**普通依赖**（`warning: installed as a plain dependency` 是预期：
drop-in 不需要自己的 profile 行）。卸载干净 = `remove` + `install`：依赖从 `package.json` 摘掉、pnpm 重算依赖树，
layout 解析回宿主自带那份。
完整的切换 / 回退手册见 `scripts/runbook-shell-switch.md` 与 `docs/ui-rebuild/runbook-回退.md`。

## 发布清单与 npm 元信息

- **`private: true`（保持现状）**：本包**不发布到 npm**（spec 明确「只准备元信息与 CI 校验，不代发」）。
  分发只走上面两条通道，因此保留 `private: true` 防止误发；`license` 为 `UNLICENSED`。
- **`files`**：随包携带 `lib/`（host 半区与纯逻辑）、`client/`（v17 客户端产物）、`contracts/`（契约基线）、
  `tools/`（契约快照 / 版本锁 / 同步工具，装后仍能跑 `contract:check`）、`cordis.patch.yml`、`README.md`。
- **`exports`**：`.`（host 半区）、`./client`（浏览器客户端）、`./contracts/host-baseline.json`（契约基线，工具读取）、
  `./cordis.patch.yml`、`./package.json`；每个 target 都是包内真实文件。
- **`engines.dsh` + `peerDependencies`**：支持区间 `>=0.2.2-rc.4 <0.3.0`（实装宿主版本为下界）。
  该区间与 `lib/contract.js` 的 `SUPPORTED_HOST_RANGE` **各自声明**，由 `test/contract.test.mjs`
  断言两者一致（不是同一份常量字面量，改一处必须同步另一处，测试会拦）。

## 兼容开关（显式白名单）

HostGuard 默认把「读不到宿主形状」当 blocker（不接管、出横幅），不静默放行。仅当明确知道
自己在和**没有 slots API 的旧宿主**打交道时，才用显式环境开关放行（在页面注入）：

| 开关 | 作用 | 风险 |
| --- | --- | --- |
| `window.__DSH_LAUNCHER_ALLOW_LEGACY_SLOTS__ = true` | slots API 读不到时按 baseline 形状兜底，继续注册 | 假设旧宿主与 baseline 同形；形状真变了会白屏，只在受控环境用 |
| `window.__DSH_LAUNCHER_HOST_SHAPE__ = {…}` | 整体覆盖探测到的宿主形状（canary / 调试用） | 仅测试用途，覆盖后 HostGuard 按给定形状判定 |

除此之外：版本读不到 = `version-unreadable` blocker，不再回退 baseline 版本掩盖；`ILayout` 成员
（`layoutMembers`）必须从宿主 layout 服务实测并参与判定（不再空转）。

## 护栏

| 护栏 | 位置 | 行为 |
| --- | --- | --- |
| HostGuard | `lib/guard.js` | 注册前自检版本 / 子槽 / renderSlots / ILayout 成员 / 主题前缀；关键项不符 → 不接管 |
| Bootstrap | `lib/bootstrap.js` | `guard.ok` 才注册 root；否则不注册、不抛错、出可关闭横幅（含回退命令） |
| RollbackSurface | `lib/rollback.js` | 设置 → 高级「回退原生 UI」，命令 remove → install → 重启，数据目录不动 |

## 测试与 canary

```sh
node --test test/*.test.mjs                 # 单元测试
node tools/sync-contract.mjs --check        # client 契约块与 lib/contract.js 一致
node tools/contract-snapshot.mjs --check ...  # 宿主 d.ts 与 baseline 结构比对（CI）
node tools/check-host-version.mjs           # 三方版本锁：宿主 = baseline = 本包
```

无头冒烟 canary（离线桩，一条脚本覆盖「接管 / 不接管」两条端到端路径）：

```sh
node scripts/canary.mjs --mode both         # 基线→外壳无横幅；变异基线→横幅+原生 UI
node scripts/canary.mjs --mode baseline --json
node scripts/canary.mjs --help
```

退出码：`0` 断言通过；`1` 断言失败；`2` 参数错误；`3` 缺 baseline / 输入（不假装成功）。

## 契约事实（0.2.2-rc.4）

- 6 子槽：`sidebar:single`、`main:keyed`、`rightbar:single`、`shell.bottom:single`、
  `shell.overlay:list`、`shell.leading:single`；root 的 `renderSlots` 正好是这 6 个。
- `ui-sidebar` 在 `sidebar` 槽里声明了 9 个席位（`sidebar.brand.mark`、`sidebar.workspaces`、`sidebar.settings` 等），
  本包同名重新声明，避免注册进这些席位的插件静默消失。
- 基线用实装宿主 `--write` 重生成；`hostVersion` 就是宿主 layout 包版本。
