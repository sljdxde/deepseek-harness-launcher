# 真机换壳：一条命令切过去、一条命令切回来

不手改 `~/.dsh` 里的任何文件，全部走 `dsh` 自己的插件接口（`dsh plugin` 转发给 profile 的 pnpm）。
本包是 **同名 drop-in**：包名就是 `@deepseek-ai/dsh-client-ui-layout`，装进 profile 后按名字顶替宿主那份，
行 id 与 `name` 都不动。

## 前置备份（一次，装之前做）

```sh
# 1) 备份整个 profile（含 package.json 与锁文件；node_modules 不必拷，装得回来）
cp -a "$HOME/.dsh/profiles/web" "$HOME/.dsh/profiles/web.bak.$(date +%Y%m%d-%H%M%S)"

# 2) 备份宿主原包（回滚兜底：哪怕依赖装不回来也能手工指回）
cp -a "<dsh 安装目录>/node_modules/@deepseek-ai/dsh-client-ui-layout" \
      "<dsh 安装目录>/node_modules/@deepseek-ai/dsh-client-ui-layout.orig"

# 3) 确认版本锁：本包版本必须等于宿主 ui-layout 版本，否则拒绝安装
cd <本包目录> && node tools/check-host-version.mjs
```

## 切到新外壳（一条命令 + 重启 + verify）

```sh
cd <本包目录>
DSH_BIN=<dsh 安装>/lib/bin.js sh scripts/shell-switch.sh launcher
#   ↑ 内部执行：dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-layout@file:<本包绝对路径>"
#               + 重启 dsh web + verify（launcher 态）
```

`verify` 的判据（按 `verify-shell.mjs` 实际口径，**不用 `[data-slot="sidebar"]`**——它两态都会出现）：
- launcher：`window.__DSH_LAUNCHER_SHELL__ === true` + `[data-shell="launcher"]` 在 + 无 `#launcher-conflict`
- native：标记为 false + `[data-shell="launcher"]` 不在 + `[data-slot="root"]` 在冒烟自检失败时脚本会**自动卸回 native** 并写 `state/ui-shell.log`（`boot-self-check=FAILED fallback=native`），
不会让你停在空白页。

## 切回 native（一条命令 + 重启 + verify）

```sh
cd <本包目录>
DSH_BIN=<dsh 安装>/lib/bin.js sh scripts/shell-switch.sh native
#   ↑ 内部执行：dsh plugin --profile web remove "@deepseek-ai/dsh-client-ui-layout"
#               + 重启 dsh web + verify（native 态）
```

卸掉依赖后 profile 里没有这份实现，模块解析回落到 dsh 安装目录里的宿主原包——这就是 native。

## 失败时的手工恢复三步

1. `cd "$HOME/.dsh/profiles/web"`，从 `package.json` 的 `dependencies` 里删掉
   `"@deepseek-ai/dsh-client-ui-layout": "file:…"`（这一步等价于 `dsh plugin --profile web remove`）。
2. 同一个目录跑 `pnpm install`；若 profile 起不来，把第 1 步之前 `cp -a` 的 `web.bak.<时间戳>` 盖回去。
3. 重启 dsh web，硬刷新页面；用 `[data-slot="sidebar"]` 在不在确认已回原生。

仍不行：把 `<dsh 安装目录>/node_modules/@deepseek-ai/dsh-client-ui-layout.orig` 复制回
`@deepseek-ai/dsh-client-ui-layout`（覆盖），重启，硬刷新。

## 窗口内清单（省事故的三条）

1. **切之前先做一次 native 态 verify**（`shell-switch.sh verify native`）：证明 Chrome / URL 工具链是活的，别在切完才发现断。
2. **切前后各记指纹**：`sha256` 取 `package.json` 与 `pnpm-lock.yaml`（脚本已写进 `/tmp/dsh-shell-<时间戳>/fingerprints.txt`）；
   回滚后逐个比对，lockfile 必须逐字一致。
3. **预探 `dsh web restart`**：`dsh web --help | grep restart`；探不到就当场写清手工重启步骤（退出 dsh web → 重新打开 → 硬刷新），
   别等切完才发现。

## 探针上跑过的实际输出（`/tmp/standalone-home`，2026-11-19）

```
$ dsh plugin --profile web add "@deepseek-ai/dsh-client-ui-layout@file:<本包>"
+ @deepseek-ai/dsh-client-ui-layout file:<本包>
Done in 244ms using pnpm v11.25.0
dsh: warning: @deepseek-ai/dsh-client-ui-layout declares no dsh.bundle — installed as a plain dependency, not a profile layer
  （这条 warning 是预期的：drop-in 不需要自己的行，行还是 ui-layout）

$ verify（launcher）  {"expected":"launcher","launcherMark":true,"launcherShell":true,"errors":[]}  → 通过

$ dsh plugin --profile web remove "@deepseek-ai/dsh-client-ui-layout"
- @deepseek-ai/dsh-client-ui-layout file:<本包>
Done in 193ms using pnpm v11.25.0

$ verify（native）    {"expected":"native","launcherMark":false,"launcherShell":false,"errors":[]}   → 通过
```

四轮往返（launcher → native → launcher → native）的完整输出见
`Pod/tasks/dsh-launcher-T3-真机验证/四轮往返-开关证据.md`。
