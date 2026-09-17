# 修复指南：dsh-tui 插件 `lib/` 缺失导致 Launcher 启动失败

> 影响组件：DSHPluginManager（v0.3.0 起内置）· 插件市场 git 兜底安装路径
> 关联分支：`fix/npm-install-oom-and-alert`（安装期内存问题）

## 一、现象

从插件市场安装 `ccch1mneyyy/dsh-TUI` 后，Launcher 启动 dsh 失败并退化为基础模式。
日志（`~/Library/Logs/Deepseek Harness Launcher/dhl.log`）特征：

```
Error: dsh: plugin tree failed to load: failed to apply loader entry include
(cordis:include): loader entries failed to apply

Error: failed to import loader entry dsh-tui-workspaces
(@deepseek-harness-tui/dsh-tui/workspaces): Cannot find module
'~/.dsh/profiles/web/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/workspaces.js'
...
code: 'ERR_MODULE_NOT_FOUND'

Deepseek Harness Launcher 进程退出：code=1
归档增强插件不可用，Deepseek Harness Launcher 将以基础模式运行
```

报错的模块不限于 `workspaces`，`command-trees`、`settings-sections`、`scenes`、
`plugin-host`、`extensions`、`oauth`、`index`、`working-activity` 等所有
`lib/types/*.js` 入口全部找不到——因为是整个 `lib/` 目录缺失。

## 二、原因分析

profile（`~/.dsh/profiles/web`）是一个 pnpm 工作区，插件的安装链路是：

1. `installPlugin()`（`Plugins/DSHPluginManager/lib/index.js`）先按仓库 slug 推导
   npm 候选名并探测：`@ccch1mneyyy/dsh-tui`、`dsh-tui`。
   **但该插件在 npm 上的真实包名是 `@deepseek-harness-tui/dsh-tui`**，两个候选都
   探测失败；
2. 走 git 兜底路径：浅克隆 `https://github.com/ccch1mneyyy/dsh-TUI` 到
   `~/.dsh/profiles/web/plugin-sources/ccch1mneyyy-dsh-TUI`，再以
   `file:` 依赖执行 `dsh plugin --profile web add file:<目录>` 装进 profile；
3. 上游仓库**不提交 `lib/` 目录**（`git ls-files | grep '^lib/'` 为 0 条）——
   `lib/` 是 `prepare` 脚本的编译产物（`compile` = vendor/dsh-std 构建 +
   dsh-auth 构建 + `tsc`）。pnpm 对 `file:` 目录依赖只做原样物化，**不会触发
   `prepare`**，于是装出来的是一个 `package.json` 声称
   `"main": "lib/types/index.js"`、实际没有 `lib/` 的残缺包；
4. dsh 启动时 cordis 加载器按 `cordis.yml` 的 loader entries 逐个 import
   `lib/types/*.js`，全部 `ERR_MODULE_NOT_FOUND`，插件树加载失败，boot 直接抛错
   退出。

时间线示例（出问题的机器）：9 月 16 日 22:27 最后一次正常启动；22:36–22:40 插件
源被重新下载并执行 pnpm 安装（`plugin-sources/`、`node_modules/.pnpm*` 的时间戳
可佐证）；之后再启动即崩溃。

## 三、修复步骤（推荐：改装 npm 正式包）

npm 注册表上的正式包在发布时已执行 `prepare` 编译，tarball 内含完整 `lib/`，
直接换成正式包即可（坏包是源码版 0.10.1，npm 最新为 0.10.2）。

```bash
# 0) 退出 Deepseek Harness Launcher（菜单栏图标 → 退出），确认无残留进程
pgrep -fl "Deepseek Harness Launcher|dsh web"

# 1) 用 dsh 自带 CLI 把插件换成 npm 正式包（PATH 挂上 launcher 准备的 pnpm shim）
export PATH="$HOME/.dsh/pnpm-bin:$PATH"
cd ~/.dsh
./runtime/node_modules/.bin/dsh plugin --profile web add @deepseek-harness-tui/dsh-tui

# 2) 验证入口文件已就位（不再报 ERR_MODULE_NOT_FOUND 的前提）
ls ~/.dsh/profiles/web/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/index.js

# 3) 清理 git 源码残留（可选，profile 的依赖记录已被 add 覆盖为 npm 包）
rm -rf ~/.dsh/profiles/web/plugin-sources/ccch1mneyyy-dsh-TUI

# 4) 重新启动 Launcher
open ~/Applications/Deepseek\ Harness\ Launcher.app   # 以实际安装位置为准
```

> 说明：workspace 配置了 `minimumReleaseAge: 1440`（只安装发布满 24 小时的版本），
> 若 0.10.2 刚发布，pnpm 会落到 0.10.1——npm 包版本均含 `lib/`，不影响修复。
> 该命令与 DSHPluginManager 网页界面「安装」走的是同一条
> `dsh plugin --profile web add` 通道，只是显式指定了真实包名。

修复后启动日志应重新出现：

```
[stdout] dsh web: http://127.0.0.1:3080
归档增强插件已就绪
```

## 四、备选方案

### 方案 B：从源码补构建 `lib/`（不推荐，内存开销大）

```bash
export PATH="$HOME/.dsh/pnpm-bin:$PATH"
cd ~/.dsh/profiles/web/plugin-sources/ccch1mneyyy-dsh-TUI
pnpm install
pnpm run compile          # vendor/dsh-std + dsh-auth + tsc，8GB 内存机器慎用
rm -rf ~/.dsh/profiles/web/node_modules/@deepseek-harness-tui/dsh-tui
cd ~/.dsh/profiles/web && pnpm install   # 重新物化 file: 依赖
```

### 方案 C：手动用 npm tarball 覆盖（应急）

```bash
TMP="$(mktemp -d)" && cd "$TMP"
curl -sL https://registry.npmjs.org/@deepseek-harness-tui/dsh-tui/-/dsh-tui-0.10.2.tgz -o tui.tgz
tar -xzf tui.tgz
cp -R package/lib ~/.dsh/profiles/web/plugin-sources/ccch1mneyyy-dsh-TUI/lib
rm -rf ~/.dsh/profiles/web/node_modules/@deepseek-harness-tui/dsh-tui
cd ~/.dsh/profiles/web && "$HOME/.dsh/pnpm-bin/pnpm" install
```

## 五、为什么应用内「重新安装」修不了

当前实现的两个盲区，导致损坏状态无法从网页界面自愈：

1. **幂等判断误判**：`installPlugin()` 只看包名是否已存在于 node_modules
   （`lib/index.js` 的 alreadyInstalled 分支），残缺包也在场，再点「安装」只会
   返回「已安装」；
2. **损坏判定过窄**：`listInstalledPlugins()` 只把「读不到 package.json 的悬空
   符号链接」标为 `broken`，本例的包 `package.json` 完整，被当作正常用户插件，
   「清理后重新安装」入口不会出现。

## 六、后续改进建议（代码层）

1. **安装后入口校验**：安装完成后读取包 `package.json` 的 `main`/`exports` 指向
   并逐个 `fs.access`，缺失即判定 `broken`，提示清理重装——可同时堵住第五节的
   两个盲区；
2. **git 兜底路径感知构建产物**：克隆后若发现 `files` 声明了 `lib/`、`dist/` 等
   未提交目录，先在源目录跑 `pnpm install && pnpm run compile`（或直接回退报
   「该插件只能从 npm 安装」），不要把残缺包装进 profile；
3. **市场数据支持真实 npm 包名**：`installCandidates()` 目前从 repo slug 猜测
   （`@ccch1mneyyy/dsh-tui`），建议 awesome-dsh-plugin 的 yml 增加可选
   `npm:` 字段，命中后跳过 git 兜底；
4. **安装期内存保护**：与 `fix/npm-install-oom-and-alert` 分支合流，git 兜底
   `file:` 安装同样可能在小内存机器上 OOM 中断，留下本例这类半成品。

## 七、诊断命令速查

```bash
# Launcher 日志
tail -100 ~/Library/Logs/Deepseek\ Harness\ Launcher/dhl.log

# profile 依赖记录（file: 依赖 = git 兜底装的）
grep dsh-tui ~/.dsh/profiles/web/package.json

# 包完整性（应能看到 index.js）
ls ~/.dsh/profiles/web/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/

# 源码目录是否提交过 lib/（0 条 = 纯构建产物）
git -C ~/.dsh/profiles/web/plugin-sources/ccch1mneyyy-dsh-TUI ls-files | grep -c '^lib/'
```
