# DSH

轻量级 macOS 菜单栏启动器：从 Spotlight 或 Raycast 搜索 `DSH`，应用会先检测端口，再以本地 patch 启动 DeepSeek Harness，并在服务就绪后打开系统默认浏览器。

## 开发构建

```sh
./scripts/build-app.sh          # 当前架构
./scripts/build-universal.sh    # Universal 2（arm64 + x86_64）
./scripts/build-dmg.sh          # dist/DSH.dmg
```

当前机器只有 Command Line Tools；Universal 2 二进制可交叉编译，但签名和 notarization 需要完整 Xcode/Developer ID 环境。

## 图标

正式图标是 AI 设计稿（iconfish 风格）导出，不是运行时矢量绘制的 `scripts/generate-icon.swift`。

- `Resources/icons/candidate-A..D/`：4 个候选，每个含完整 `DSH.iconset/`（16/32/128/256/512 + @2x 共 10 尺寸）和 `DSH.icns`，`source-1024.png` 为可重新缩放的设计源。
- `Resources/icons/current`：指向当前启用候选的软链。
- `Resources/icons/preview-compare.png`：大图 + 真实像素小图（16/32/64）对比。

切换图标（二选一）：

```sh
ln -sfn candidate-B Resources/icons/current          # 改默认
DSH_ICON=candidate-C ./scripts/build-app.sh          # 或临时指定
```

构建脚本统一通过 `scripts/install-icon.sh` 装图标：优先取 `Resources/icons/<候选>/DSH.icns`，找不到才回退到 Swift 矢量版。注意 `build/` 在构建时会被清空，设计源已备份在 `Resources/icons/` 下。

## 安装

```sh
./scripts/install.sh
```

默认安装到 `~/Applications/DSH.app`。安装脚本会先退出并强制结束旧启动器及其 DSH 子进程，再保留一个带时间戳的旧版本备份后替换；安装到系统 Applications 可使用 `DSH_INSTALL_DIR=/Applications ./scripts/install.sh`。设置 `DSH_NO_OPEN=1` 可跳过安装后自动启动。卸载只移除启动器，不删除 `~/.dsh` 数据。

DMG 打开后只显示“**双击完成安装或更新**”。双击它会先停止旧启动器和对应后台、替换 `/Applications/DSH.app`，然后自动重新启动；安装载荷不会显示在 Finder 中，避免误拖拽到 Applications。

## 更新与设置

菜单栏中的“设置…”支持自动检查更新、检查频率、更新源、服务就绪后是否打开浏览器，以及开机自动启动（默认关闭）。菜单栏中的“检查更新”可随时手动检查；发现新版本后下载 DMG 并在 Finder 中打开，安装仍通过带强制退出和备份的安装脚本完成。

当前启动器版本为 `0.1.0`。更新源按版本号比较，只有清单版本高于当前版本时才提示更新。用户确认“安装并重启”后，启动器会先关闭本地 DSH 进程，再替换 App、卸载 DMG 并重新启动。

更新源是一个 JSON 清单，例如：

```json
{
  "version": "0.1.1",
  "dmgURL": "https://example.com/DSH.dmg",
  "notes": "修复启动问题"
}
```

## 本地插件

`Plugins/DSHArchiveManager` 通过 `--patch` 注入 DSH。启动器会在 web profile 的 `node_modules` 下创建一个指向应用资源的可识别软链接；不会覆盖 `~/.dsh/profiles/web/cordis.patch.yml`，也不会改写会话或工作区配置。

归档管理入口位于菜单栏底部的插件操作区，永久删除整个后代树需要点击二次确认；确认后会直接删除所选会话及其后代，不检查或等待运行状态。
