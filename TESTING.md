# 回归测试

本仓库所有提交都会通过 GitHub Actions 运行回归测试。测试入口为：

```sh
./scripts/test.sh
```

## 测试范围

| 类别 | 验证内容 |
|------|----------|
| 静态检查 | JS 语法、Shell 语法、Info.plist 合法性、源码关键不变量 |
| 归档插件 | 删除不读运行状态、不要求手动输入 DELETE、批量删除确认、全选/半选状态 |
| 更新器 | 版本比较、GitHub Releases 解析、Atom 降级源、DMG asset 命名 |
| dsh 更新检查 | npm 版本输出解析、启动异步检查入口、菜单栏状态 |
| dsh 首次安装 | 内置锁定文件 + `npm ci` 低内存路径、裸 `npm install` 回退、镜像回退、临时目录原子替换、取消清理、固定 runtime 校验、bundled 版本解析、版本不一致触发强制升级重装 |
| 启动器核心 | 端口选择、归档插件链接、进程生命周期、菜单栏 UI 不变量 |
| 全局快捷键 | Carbon 热键注册、修饰键转换、设置窗口录制入口 |
| 安装与卸载 | 安装器替换、旧进程终止、备份清理、旧路径清理、数据保留 |
| 构建与签名 | Universal 2 架构、ad-hoc 签名、DMG 生成与 `hdiutil verify` |

## 测试产物

`scripts/test.sh` 通过后会生成：

- `build/Deepseek Harness Launcher.app`（Universal 2）
- `build/双击完成安装或更新.app`（Universal 2 安装助手）
- `dist/Deepseek Harness Launcher.dmg`

## 发布门禁

- `.github/workflows/ci.yml` 会在每次 push 到 `main` 和每个 PR 上运行回归测试。
- `.github/workflows/ci.yml` 与 `.github/workflows/release.yml` 均含 `memory-gate` job：实测首次安装 `npm ci` 的峰值 RSS，超过 1024MB（1GB）即失败（`./scripts/memory-bench.sh 1024`）。
- `.github/workflows/release.yml` 只有在回归测试与内存门禁都通过后，才会执行 `publish` 任务。
- 如果回归测试失败，Release 不会被创建，也不会更新已有 Release。
- 建议在 GitHub 仓库 Settings → Branches 中为 `main` 配置保护规则，把 CI 的 `regression` job 设为 required status check，让未通过测试的 PR 无法合入。

## 手动验收清单

发布前建议再手动确认以下场景：

1. 从 Spotlight/Raycast 搜索 `Deepseek Harness Launcher` 或 `dsh` 启动。
2. 菜单栏出现图标，端口 3080 或回退端口正常显示。
3. 点击“打开 Deepseek Harness”，浏览器应打开并跳转到当前 Harness Web 页面。
4. 按下全局快捷键 `⌃⌥D`（或在设置中更换后的组合键）可随时呼出。
5. 设置中录制的新快捷键若被其他应用占用，保存时提示冲突并回滚。
6. 归档管理面板可单条/批量删除，点击确认后直接删除。
7. 退出启动器后，相关 npm/node/dsh 进程退出。
8. 检查更新能读取 GitHub Releases，能下载并安装更新。
9. 卸载后保留 `~/.dsh` 用户数据，移除 DHL 自有 runtime、启动器与自身插件链接。
10. 首次启动无 `~/.dsh/runtime` 时显示安装提示和进度窗口；取消后无残留 `runtime.installing-*` 目录或 npm/node 子进程。
11. 用包含更新 `dsh-runtime/package-lock.json`（不同 dsh 版本）的 App 启动时，能自动检测到版本不一致并弹出“更新 dsh”窗口，完成后原子替换并启动新版本。
12. 首次安装全程峰值内存低于 1GB：`./scripts/memory-bench.sh 1024` 应输出 `PASS`。
