# 独立实例验证（不碰用户活环境）

第一支 PR 的三件套之一：在**另一份 profile + 另一个 DSH_HOME + 另一个端口**上换壳，拿真实插件与真实数据看有没有破版，
全程不重启用户正在用的 dsh、不打断任何 bot 会话。

## 为什么要独立实例

真机直接切会重启用户活着的 dsh web，等于把所有在跑的 bot 任务一起打断。独立实例把"换壳"从"动生产"变成"跑一份副本"。

## 步骤（在能读用户 profile 的机器上执行）

```sh
# 0) 变量
SRC="$HOME/.dsh/profiles/web"                 # 用户的 profile（只读复制）
HOME2=/tmp/dsh-shell-verify                   # 独立 DSH_HOME
PORT=64800                                    # 独立端口

# 1) 复制 profile（node_modules 用软链，不复制依赖树；原包留底）
rm -rf "$HOME2" && mkdir -p "$HOME2/profiles"
cp -R "$SRC" "$HOME2/profiles/web"
rm -rf "$HOME2/profiles/web/node_modules"
ln -s "$SRC/node_modules" "$HOME2/profiles/web/node_modules"
mkdir -p "$HOME2/profiles/web/.orig/@deepseek-ai"
cp -R "$SRC/node_modules/@deepseek-ai/dsh-client-ui-layout" \
      "$HOME2/profiles/web/.orig/@deepseek-ai/dsh-client-ui-layout"

# 2) 切到新外壳（换模块连接 + 记录状态，不重装）
DSH_HOME="$HOME2" PACKAGE_DIR=<本包绝对路径> ./scripts/shell-switch.sh launcher

# 3) 起独立实例（不碰用户端口/会话）
cd <dsh 安装目录>
DSH_HOME="$HOME2" node lib/bin.js web --no-open --port "$PORT"

# 4) 断言（launcher 态）+ 人工看三件事，见下
DSH_HOME="$HOME2" PACKAGE_DIR=<本包绝对路径> DSH_URL="http://127.0.0.1:$PORT/?token=<从启动日志读>" \
  ./scripts/shell-switch.sh verify

# 5) 反向：切回 native，再 verify 一次
DSH_HOME="$HOME2" PACKAGE_DIR=<本包绝对路径> ./scripts/shell-switch.sh native
# 重启同一个端口，再 verify
```

## 必须现场看的三件事

1. **三张卡不破版**：任务卡（dsh-bot 的 task 卡）、汇报卡、审批卡，在真实会话里各开一张，检查
   标题/正文/按钮不溢出、不叠字、宽表格不挤压（右栏轨道与分屏下各看一次）。
2. **插件页能开**：dsh-bot 群聊页、`plugin-manager`（插件管理）、`archive-manager`（归档管理）各开一次，
   面板能渲染、返回不空白、控制台 0 报错。
3. **三栏与右栏轨道**：真实窗口宽度（1440 与 1024 各一次）下，图标栏 56 / 侧栏 280 / 主区 / 右栏轨道
   （默认 380，拖 320–520）位置正确、不出现横向滚动条。

## 本次在探针上验到哪一步（2026-11-19）

- 独立实例起得来：`DSH_HOME=/tmp/standalone-home`（profile 副本 + 独立端口），与用户环境完全隔离。
- `shell-switch.sh launcher` → `verify`：通过（`launcherMark: true`、`launcherShell: true`、`errors: []`）。
- `shell-switch.sh native`（只换连接、不重装）→ 重启 → `verify`：通过（`launcherMark: false`、原生 root 槽在）。
- **未完成**：用户 profile 的复制。研发侧沙箱不允许读写用户 dsh 数据目录，因此"真实数据下的三张卡"
  这一项需要在能读该目录的机器/人上按上面步骤跑一次；最后两轮 launcher→native 重复切换的 4 次 verify
  输出也一并补在那次运行里。
