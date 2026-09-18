# AGENTS.md

本文件面向在本仓库工作的 AI 编码助手与开发者，约定必须遵守的项目规则。

## 版本号规则

采用「目标发布版本 + 测试迭代号」的管理方式，同一发布周期内有三个状态：

| 状态 | 格式 | 说明 |
|------|------|------|
| 开发中 | `x.y.z-a.b-SNAPSHOT` | 正在开发，内容随时变化 |
| 提测 | `x.y.z-a.b` | 提交给测试的候选构建（去掉 SNAPSHOT） |
| 正式发布 | `x.y.z` | 打 `vx.y.z` 标签发布的官方版本 |

其中 `x.y.z` 是本次的**目标发布版本**，`a.b` 是测试迭代号：

- `a`：测试阶段编号，从 `1` 开始，一个发布周期内一般不变；
- `b`：从 `1` 起，每轮「提测被打回 → 修复 → 重新提测」递增。

生命周期（占位符示例，非真实版本号）：

    x.y.z-1.1-SNAPSHOT    # 开发
    x.y.z-1.1             # 第 1 次提测
    （发现 bug）
    x.y.z-1.2-SNAPSHOT    # 修复后继续开发
    x.y.z-1.2             # 第 2 次提测
    （测试通过）
    x.y.z                 # 正式发布，tag 为 vx.y.z

规则：

1. **正式 tag 只允许纯 `x.y.z`**：tag、`Resources/Info.plist`、
   `Resources/InstallerInfo.plist` 三处版本号必须一致（历史上 v0.2.0 标签打包
   仍为 0.1.0，导致用户反复收到更新提示）。`release.yml` 在发布前会校验
   tag 与包内版本一致。
2. **排序语义**：同一 `x.y.z` 内 `-a.b-SNAPSHOT` < `-a.b` < 无后缀（正式）；
   `a.b` 按数字逐位比较；base（`x.y.z`）优先于后缀。
   `Sources/UpdateSupport.swift` 的 `compareVersions` 已实现该语义并有测试
   覆盖（`scripts/test-update-support.swift`），因此开发/提测构建不会被提示
   「更新」到更旧的正式版，而提测机器会在正式发布后收到升级提示。
3. **版本号落点**（改动版本时必须全部同步）：
   - `Resources/Info.plist` → `CFBundleShortVersionString`
   - `Resources/InstallerInfo.plist` → `CFBundleShortVersionString`（与上者一致，
     `scripts/test.sh` 会校验格式规则与一致性，不锁定具体版本号）
   - `README.md` 的「当前 App 版本」说明（正式发布时更新，测试期不必跟随）

## 版本周期流程

每个发布周期（目标版本 `x.y.z`）按以下步骤执行：

1. **开始开发**：把两处 plist 版本号改为 `x.y.z-1.1-SNAPSHOT` 并提交，开始开发。
2. **本地自测（每轮提交代码前必须完成）**：
   - `./scripts/test.sh` 全量回归必须全绿（含 JS/Swift 语法检查、单元测试、
     双架构构建、安装器构建、DMG 生成与校验）；
   - 从 `dist/` 挂载 DMG，用 `install-from-app.sh` 安装到 /Applications 做
     真机验证：dsh 启动、菜单栏状态、会话完成通知、浏览器标签复用等核心
     功能；
   - 改动涉及安装/升级/卸载路径时，额外验证 `scripts/uninstall.sh` 与应用内
     更新流程。
3. **提测**：开发完成后，版本号去掉 SNAPSHOT 改为 `x.y.z-1.1`，重新跑通
   `./scripts/test.sh` 并完成本地安装验证，提交推送；该构建即为提测候选。
4. **被打回**：把版本号递增为 `x.y.z-1.2-SNAPSHOT` 回到第 2 步；修复后重复
   第 3 步，提测 `x.y.z-1.2`。以此类推。
5. **正式发布**：测试通过后，版本号改为 `x.y.z`，跑通全量回归并提交推送，
   打标签 `vx.y.z` 推送；`release.yml` 会先校验 tag 与包内版本一致，再在回归
   门禁与内存门禁通过后自动发布 GitHub Release 并上传 DMG。
6. **发布收尾**：在 GitHub Release 页面把说明替换为 Markdown 更新日志
   （启动器的更新弹窗会渲染该正文）；本地安装一次正式版，使开发机版本归位。

## 其他约定

- 全量回归入口：`./scripts/test.sh`，提交前必须全绿。
- 浏览器标签复用：禁止用 AppleScript 做"发现浏览器"的第一步（会触发自动化
  授权）；仅允许在 lsof 连接检测确认浏览器已连接后，用 AppleScript 精确选中
  标签，且必须保留降级路径（详见 `Sources/BrowserConnectionSupport.swift` 与
  `Sources/BrowserAutomationSupport.swift` 的注释）。
