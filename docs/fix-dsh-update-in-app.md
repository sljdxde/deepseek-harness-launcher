# 修复：菜单「dsh 更新可用」点击后自动更新，而不是打开 npm

> 影响版本：v0.3.2（ed2ec82）及更早
> 修复状态：已合入 main（`0.3.3-1.1-SNAPSHOT` 起）

## 一、现象

菜单栏出现「dsh 更新可用：v0.1.5-rc.2」后，点击该项只会弹出说明框，
按钮是「打开 npm」——跳到 npmjs.com 网页后用户仍需自己想办法完成更新，
launcher 内没有任何一条可直接把 dsh 更新到位的路径。

## 二、修复方案

### 1. 点击菜单项 → 确认 → 自动更新

- 检查逻辑不变：仍用 `npm view @deepseek-ai/dsh version` 与本地
  `dsh --version` 比较，发现新版本时菜单标题变为
  「Deepseek Harness 更新可用：vX」并缓存结果。
- 再次点击该项**不再重复联网检查**，直接弹出确认框：
  - dsh 正在运行：「立即更新会下载新版本并自动重启 Deepseek Harness，
    会话与归档数据不受影响。」
  - dsh 未运行：「立即更新会下载新版本，下次启动时生效。」
- 点「立即更新」后：
  1. 若 dsh 正在运行/启动中，先停止（复用 `stopDHL` 的进程组终止逻辑）；
  2. 弹出现有安装进度窗口，从 npm 安装**精确指定版本**
     （`npm install --prefix <staging> @deepseek-ai/dsh@<version>`，
     仍按镜像优先、失败回退官方源的顺序尝试）；
  3. 安装经自检后原子替换 `~/.dsh/runtime`（沿用原有 staging 机制）；
  4. 更新前 dsh 在运行则自动重启，否则提示「下次启动时生效」。
- 原「打开 npm」按钮移除。

### 2. 指定版本安装（DSHRuntimeSupport.install 新增 packageSpec）

`install(force:packageSpec:)` 新增可选参数：传入
`@deepseek-ai/dsh@<version>` 时，即使 App 内置了 dsh-runtime 锁定文件，
也强制走 `npm install <spec>` 路径而不是 `npm ci`——`npm ci` 会装回
bundled 锁定版本，与「更新到最新」的目的背道而驰。

#### 2.1 幻影 ETARGET：指定版本安装必须禁用 prefer-offline

真机首测发现：点「立即更新」后安装报
`ETARGET notarget No matching version found for @deepseek-ai/dsh-xxx@^0.1.5-rc.2`，
但两个 registry 上该版本明明都存在。

根因：安装命令此前对所有路径无条件 `--prefer-offline`。prefer-offline
会**跳过包元数据（packument）重新校验，直接使用本地缓存**；缓存的
packument 早于新版本发布，里面自然没有 0.1.5-rc.2，npm 便认为
「无匹配版本」。检查更新走的 `npm view` 是 prefer-offline=false，能看到
新版——于是出现「检查说有更新、安装却装不上」的矛盾。已在本机复现：
同一命令 `--prefer-offline` 必现 ETARGET，`--no-prefer-offline` 584 个
包 10 秒解析成功（峰值内存 377MB，远低于 1536MB V8 上限）。

修复：仅当 `packageSpec` 存在（版本定向更新）时传
`--no-prefer-offline` 并设 `npm_config_prefer_offline=false`，强制刷新
元数据；`npm ci` 锁文件回放与无 spec 的兜底安装保持 prefer-offline
（命中缓存省流量），行为不变。

### 3. 防降级：bundled 锁定版本更旧时不触发升级

`needsRuntimeUpgrade` 原先判定「bundled 版本 ≠ 已装版本」就升级。
用户手动更新后（已装 0.1.5-rc.2 > bundled 0.1.4），下次启动会被
`npm ci` 悄悄降回 0.1.4。现改为**仅当 bundled 版本严格新于已装版本时**
才触发升级（`compareVersions(bundled, installed) == .orderedDescending`），
手动更新得以保留，直到 App 自带更新的锁定文件追上来。

### 4. 菜单栏文案

菜单项、端口行与关联弹窗中的「dsh」统一改为「Deepseek Harness」
（日志与 npm 命令等技术性文本保留 dsh 原名）。

### 5. 更新后同步更新已安装插件

dsh 版本变化后，插件依赖的 `@deepseek-ai/*` peer 也随之演进。真机验证：
0.1.5-rc.2 移除了 `dsh-settings` 的 `settingsNamespace` 导出，旧版
`dsh-better-sidebar`（0.17.1）因此加载失败，**整个 dsh 无法启动**。

现在版本定向更新（以及 App 内置锁文件升级）安装成功后、重启前，先通过
dsh 自带 plugin 子命令同步更新插件：

```
<path>/dsh plugin --profile web update --latest   # 转发 pnpm，PATH 预置 ~/.dsh/pnpm-bin
```

实测该命令对 `file:`/`github:` 本地与固定源依赖无影响（package.json
不变），5 分钟超时保护，失败只记日志、不阻塞启动。

### 6. Web 首页 token 认证适配（0.1.5-rc.2 行为变化）

dsh 0.1.5-rc.2 起 Web 首页引入 launch-token 认证：进程在 stdout 打印
`dsh web: http://127.0.0.1:<port>/?token=…`，浏览器首次访问带 token 的
URL 换取绑定域名的签名 cookie；未认证请求一律 401 固定文案。launcher
适配三点：

- **打开浏览器**用 stdout 捕获的认证入口 URL（`captureWebURL`），旧版
  无 token 的打印行同样兼容；进程停止时清空（token 随进程失效）。
- **就绪/复用探测**（`isHarnessWebBody`）把 401 认证文案也视为「dsh 在
  跑」——否则新版永远等不到就绪，10 分钟后被误杀。
- 插件路由（归档、会话通知）经实测不受认证保护，无需改动。

### 7. 更新回退兜底

版本定向更新在替换 runtime 时保留旧版本快照（`~/.dsh/runtime.rollback`）：

- 更新后**启动失败**（进程启动阶段退出）或**启动超时**：弹窗提供
  「回退并重启」一键恢复到更新前版本（快照目录换回，立即重启），
  另有「查看日志」「保持新版本」选项；
- 新版本**启动成功**：自动清理快照（几百 MB 级目录不留垃圾）；
- 快照换入失败时恢复原状，走常规失败流程；`cleanupInterruptedInstalls`
  不清理 `runtime.rollback`（刻意保留），但会清理 `runtime.retired-*`
  换入过程残留。

### 8. 归档管理空列表：历史格式会话被新版列表跳过

更新到 dsh 0.1.5-rc.2 后「归档管理」显示 0 条。排查结论：归档标记
（`~/.dsh/storages/workspace.json` 的 `archivedSessionIds`，22 条）完好，
但 0.1.x 时代的会话是 generation 0 格式（`session.jsonl[.zstd]`，
header `version: 0`），新版 `sessionPersistence.list()` 对无法识别的
历史格式**静默跳过**（当前格式 v3，`session.v3.jsonl[.zstd]`），旧会话
全部从列表消失，归档插件求交集后为空。

修复：归档管理插件对归档标记中 persistence 看不到的会话做**磁盘兜底
扫描**——读取会话目录里版本最高的 generation 文件首行 header（zstd 用
Node 22 `node:zlib` 原生解码），合成进 headers；被引用的父会话一并读取
以保证子树关系完整。数据零改动；会话在新版 dsh 下被打开时仍会走官方
迁移写出 v3 文件。`deleteTrees` 共用同一合并视图，旧归档可正常删除。

## 三、测试

- `scripts/test-dsh-runtime-support.swift` 新增：
  - `testExplicitVersionInstall`：packageSpec 安装必须走
    `npm install <spec>`、不得走 `npm ci`，即使 bundled lockfile 存在；
    且必须携带 `--no-prefer-offline` / `npm_config_prefer_offline=false`；
  - `testBundledOlderDoesNotDowngrade`：bundled 版本更旧时
    `needsRuntimeUpgrade` 必须为 false（先装健康 runtime 再断言，
    防止 `isInstalled()` 为假导致断言空过）；
  - `testUpdateKeepsRollbackSnapshot`：版本定向更新保留快照且可读版本、
    `performRollback` 换回旧位并消费快照、非定向安装不保留快照；
  - `testInstallEnvironment` 追加断言：默认安装路径保持
    prefer-offline 不变；
  - `Plugins/DSHArchiveManager/test/legacy-session-headers.test.js`：
    v0（zstd/纯文本）会话从磁盘兜底合并进归档列表、父会话子树计数、
    persistence 可见时行为不变。
- 全量回归：`./scripts/test.sh`。
