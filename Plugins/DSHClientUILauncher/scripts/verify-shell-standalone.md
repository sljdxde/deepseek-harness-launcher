# 独立实例验证（不碰用户活环境）

第一支 PR 的三件套之一：在**另一份 profile + 另一个 DSH_HOME + 另一个端口**上换壳，拿真实插件与真实数据看有没有破版，
全程不重启用户正在用的 dsh、不打断任何 bot 会话。

## 为什么要独立实例

真机直接切会重启用户活着的 dsh web，等于把所有在跑的 bot 任务一起打断。独立实例把"换壳"从"动生产"变成"跑一份副本"。

## 一键脚本（`scripts/verify-shell-standalone.sh`）

```sh
DSH_INSTALL=<dsh 安装目录，含 lib/bin.js> \
PROFILE_SRC=<源的 web profile 目录> \
PACKAGE_DIR=<本包目录> \
PUPPETEER_PATH=<含 puppeteer-core 的 node_modules>/puppeteer-core \
sh scripts/verify-shell-standalone.sh both      # 或 launcher / native
```

它做的事：建 `$STANDALONE_HOME/home`（默认 `/tmp/dsh-shell-standalone`）→ 复制 profile 的清单类文件 →
`cp -al` 复制 node_modules（**不能用软链**：pnpm 在软链 node_modules 上 exit 254）→ 换实现
（独立实例里直接替换 `node_modules/@deepseek-ai/dsh-client-ui-layout`，原包留 `.orig-layout`，不跑 pnpm）→
起独立端口的 dsh web → 跑 `verify-shell.mjs` 断言 → 退出码 0（通过）/1（断言失败）/2（参数）/3（环境缺件）。

## 预期输出长什么样

```
── launcher（端口 55248，DSH_HOME=…/home）──
URL: http://127.0.0.1:55248/?token=…
{"expected":"launcher","verdict":"ok","seen":{"launcherMark":true,"launcherShell":true,"hostRoot":true,"composer":false,"conflict":null},"errors":[]}
壳层断言通过：launcher
── native（端口 55249，DSH_HOME=…/home）──
URL: http://127.0.0.1:55249/?token=…
{"expected":"native","verdict":"ok","seen":{"launcherMark":false,"launcherShell":false,"hostRoot":true,"composer":false,"conflict":null},"errors":[]}
壳层断言通过：native
```

失败形态：`verdict=launcher-missing`（换了实现但页面没出现我们的标记）、`verdict=native-but-launcher`
（该回原生却还是我们）、退出码 3 表示环境缺件（`DSH_INSTALL` / `PROFILE_SRC` / puppeteer 缺失）。

## 手工步骤（脚本跑不通时照这个走）

```sh
# 0) 变量
SRC=<源的 web profile 目录>
HOME2=/tmp/dsh-shell-verify
PORT=64800

# 1) 复制 profile：清单类文件复制，node_modules 用 cp -al（硬链接，几秒）
rm -rf "$HOME2" && mkdir -p "$HOME2/profiles"
cp -R "$SRC" "$HOME2/profiles/web"
rm -rf "$HOME2/profiles/web/node_modules"
cp -al "$SRC/node_modules" "$HOME2/profiles/web/node_modules"

# 2) 起独立实例
cd <dsh 安装目录>
DSH_HOME="$HOME2" node lib/bin.js web --no-open --port "$PORT"

# 3) 断言（launcher 态）：DSH_URL 从启动日志里读
DSH_HOME="$HOME2" PACKAGE_DIR=<本包绝对路径> DSH_URL="http://127.0.0.1:$PORT/?token=…" \
  sh scripts/shell-switch.sh verify

# 4) 反向：切 native → 重启同一端口 → 再 verify
DSH_HOME="$HOME2" PACKAGE_DIR=<本包绝对路径> sh scripts/shell-switch.sh native
```

## 必须现场看的三件事

1. **三张卡不破版**：任务卡、汇报卡、审批卡，在真实会话里各开一张，检查标题/正文/按钮不溢出、不叠字、
   宽表格不挤压（右栏轨道与分屏下各看一次）。
2. **插件页能开**：群聊页、`plugin-manager`、`archive-manager` 各开一次，面板能渲染、返回不空白、控制台 0 报错。
3. **三栏与右栏轨道**：真实窗口宽度（1440 与 1024 各一次）下，图标栏 56 / 侧栏 280 / 主区 / 右栏轨道
   （默认 380）位置正确、不出现横向滚动条。

## 这台机器上验到哪一步（2026-11-19 21:5x）

- 独立实例起得来，且能在实例内换上我们的实现：`…/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-layout/client/client.js`
  里 `__DSH_LAUNCHER_SHELL__` 命中 2 处，dsh web 正常启动（端口从日志读到）。
- `shell-switch.sh launcher` / `native` 两向 + `verify` 在独立实例上各通过一次（`verdict=ok`，见 `开关定稿-链接与override.md`）。
- **未完成**：一键脚本里 `start_web` 之后的 URL 捕获与浏览器断言在本机会卡住（脚本自身能建实例、换实现、起服务），
  因此该脚本暂按"实验可用"标注；真机窗口请先用上面「手工步骤」那套已验证命令。
- 用户 profile 的复制受沙箱限制（dsh 数据目录不可直接读），"真实数据下的三张卡"要在能读该目录的机器上按上面步骤跑一次。
