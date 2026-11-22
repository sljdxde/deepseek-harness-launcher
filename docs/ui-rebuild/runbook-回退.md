# Runbook：回退原生 UI（native → launcher → native 三态）

> 票 35 验收文档。产品内入口：**设置 → 高级 →「回退原生 UI」**，那里展示的说明与命令与本文件同源
> （`lib/rollback.js` 的 `rollbackCommand` / `rollbackSurface`）。命令只供**复制**，产品不代跑任何破坏性操作。

## 适用范围

- 本包是**同名 drop-in**（包名 `@deepseek-ai/dsh-client-ui-layout`），装进 profile 就顶替宿主那份实现。
- 回退 = 把这份依赖从 profile 摘掉 + 重装原生依赖 + 重启；数据目录不动。
- 只动 `dsh plugin` 接口，不手改 `~/.dsh` 里的文件。

## 数据边界（回退不丢）

| 数据 | 位置 | 回退影响 |
|---|---|---|
| 审批策略 | `~/.dsh/state/approval-policy.json` | 不动 |
| 审计日志 | `~/.dsh/state/approval-audit.jsonl`（及 `.1`…`.5` 轮转件） | 不动 |
| 会话 / 工作区 | dsh 自身数据目录 | 不动 |

验收时前后各记一次 `sha256`（`approval-policy.json`、`approval-audit.jsonl` 与 `pnpm-lock.yaml`），回退后逐字比对。

## 三个状态怎么判

不看 `[data-slot="sidebar"]`（两态都会出现），只看双特征：

- **launcher 态**：`window.__DSH_LAUNCHER_SHELL__ === true` 且 `[data-shell="launcher"]` 在。
- **native 态**：`window.__DSH_LAUNCHER_SHELL__ === false`（或无）且 `[data-shell="launcher"]` 不在、`[data-slot="root"]` 在。

## 前置：备份 profile（一次）

```sh
cp -a "$HOME/.dsh/profiles/web" "$HOME/.dsh/profiles/web.bak.$(date +%Y%m%d-%H%M%S)"
sha256sum "$HOME/.dsh/state/approval-policy.json" "$HOME/.dsh/state/approval-audit.jsonl" \
          "$HOME/.dsh/profiles/web/pnpm-lock.yaml" > /tmp/dsh-rollback-fingerprints.txt
```

## 三态步骤

### 态 1：native（起点）

**预期**：安装包自带的原生界面；无 HostGuard 横幅。

1. 确认当前是 native：按「三个状态怎么判」核一遍（`__DSH_LAUNCHER_SHELL__` 非 true）。
2. 记录指纹（见前置）。

### 态 2：native → launcher（切到新外壳）

```sh
# 把本包按 file: 依赖装进 profile（内部转发给 pnpm）
dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-layout@file:<本包绝对路径>"
# 之后重启 dsh web，并硬刷新页面
```

**预期**：`__DSH_LAUNCHER_SHELL__ === true`、`[data-shell="launcher"]` 在、无 `#launcher-hostguard-banner`；
设置 → 高级 能看到「回退原生 UI」入口与可复制命令。

### 态 3：launcher → native（回退）

产品内「回退原生 UI」给出的命令就是下面三行（`remove → install → 重启`）：

```sh
dsh plugin --profile web remove @deepseek-ai/dsh-client-ui-layout
dsh plugin --profile web install
# 之后重启 dsh（退出 dsh web 后重新打开，并硬刷新页面）
```

**预期**：`__DSH_LAUNCHER_SHELL__` 不为 true、`[data-shell="launcher"]` 不在、`[data-slot="root"]` 在；
审批策略与审计指纹与前置一致；**3 分钟内**回到原生 UI。

### 再走一次：native → launcher → native（往返验证）

重复态 2、态 3 各一次，确认两次都能在 3 分钟内回到原生，且指纹不变。

## 命令来源（单一真源）

产品里展示与复制的命令来自 `Plugins/DSHClientUILauncher/lib/rollback.js`：

```js
rollbackCommand('web')   // remove → install → 重启，三行固定
```

设置页把 `rollbackSurface()` 的说明 / 步骤 / 命令 / runbook 路径渲染成可复制块，不另抄字符串。
HostGuard 不接管横幅里的回退命令也复用同一个 `rollbackCommand`。

## 失败时的手工恢复

1. `cd "$HOME/.dsh/profiles/web"`，从 `package.json` 的 `dependencies` 删掉
   `"@deepseek-ai/dsh-client-ui-layout": "file:…"`（等价于 `dsh plugin --profile web remove`）。
2. 同目录跑 `pnpm install`；profile 起不来就把前置备份的 `web.bak.<时间戳>` 盖回。
3. 重启 dsh web，硬刷新，按「三个状态怎么判」确认回到 native。

## 验收清单（对应票 35）

- [ ] 设置 → 高级 能看到回退入口与说明（数据目录不动）。
- [ ] 命令一键复制，内容与本 runbook 一致。
- [ ] 按本 runbook 走 native → launcher → native，三次都能在 3 分钟内回到原生 UI。
- [ ] 回退后审批策略与审计指纹不变（文件仍在）。
