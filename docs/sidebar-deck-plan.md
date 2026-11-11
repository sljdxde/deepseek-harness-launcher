# 侧栏 Deck（方案 C）实施与兼容方案

Status: 方向已拍板（C 自由积木），M0 技术验证已完成
Last updated: 2026-11-11

## 决策

采用原型 **C 自由积木**：侧栏由可移动区块组成，区块可排序、可拖进底部工具条、可折叠；最近会话是内置区块（默认随安装启用、可移除/卸载）；侧栏可调宽。

原型：`prototypes/sidebar-v2/index.html`

## M0 技术验证（已完成）

在隔离环境（`DSH_HOME=/tmp/deck-spike`，端口 3099，未触碰正在运行的 GUI）里验证了三件事：

1. **官方侧栏不能靠"再注册一次"覆盖**。直接 `ctx.slots.register({name:'sidebar'})` 会让官方 `ui-sidebar` 激活失败，整个 Web 端起不来（"Failed to load plugins"）。单槽位没有优先级仲裁。
2. **可以整体替换**：在 patch overlay 里禁用 `ui-sidebar` 行（`- id: ui-sidebar` + `disabled: true`），再由我们注册 `sidebar` 槽位、并**照抄官方声明的子槽位**（`sidebar.brand.mark/name`、`sidebar.panellist`、`sidebar.panellist.actions`、`sidebar.workspaces`、`sidebar.settings`、`sidebar.footer.action`、`sidebar.toggle.badge`），即可接管整列。验证截图：`prototypes/sidebar-v2/screenshots/spike-接管验证.jpg`。
3. **官方数据/座位可以直接复用**，不必重写：`sidebar` 槽位的 props 里已经有
   `renderSlot` / `renderFactorySlot`、`useSessions`、`useWorkspaces`、`useSessionAccess`、`useWorkspaceAccess`、`useSessionStatus`、`useSessionRetainInfo`、`collapsed` / `width` / `drawer`。
   左侧栏的"工作区浏览区"仍是官方 `ui-workspace` 注册进 `sidebar.workspaces` 的那个组件，deck 只要 `renderSlot('sidebar.workspaces', …)` 就能原样渲染它。

结论：C 可行，且耦合面比预想小——渲染、数据、宽度状态都走官方契约，deck 只负责"外壳 + 区块编排"。

## 架构

两个独立插件，都随启动器打包、默认可卸载：

| 插件 | 职责 | 卸载后的行为 |
|---|---|---|
| `dsh-sidebar-deck` | 接管 `sidebar` 槽位；区块编排（排序/工具条/折叠/宽度/换边）；暴露 `ctx.sidebarDeck` 区块注册服务 | 需要回退到官方侧栏（见兼容策略），不能只是"少一块" |
| `dsh-recent-sessions-block` | 通过 `ctx.sidebarDeck.registerBlock()` 注册"最近会话"区块；跨工作区最近会话 + 状态点 + 搜索 | 侧栏少一块，其余正常；这就是"内置但可卸载" |

区块模型：
- 区块 = `{ id, title, order, zone: 'stack' | 'dock', collapsed, removable, render(ctx) }`
- 官方座位各包一层区块：`workspace`（`renderSlot('sidebar.workspaces')`）、`settings`（`sidebar.settings`）、`footer`（`sidebar.footer.action`）、`panellist`（面板入口）
- 布局（order/zone/collapsed/width/side/hidden）存插件设置，不存 localStorage

## 兼容策略（本项目的硬要求）

核心原则：**只依赖公开契约（槽位名 + props + hooks），不复制官方实现；一旦契约对不上，就回退官方侧栏，而不是白屏。**

1. **版本矩阵 + 启动器门控**
   - deck 的 `package.json` 声明支持的 DSH 版本范围；启动器安装 runtime 时按已装 DSH 版本决定是否启用 deck patch。
   - 不在范围内或未知的新版本：**不注入** `disabled: ui-sidebar` 的覆盖，走官方侧栏，并提示一次"侧栏增强暂未适配当前版本，已回退"。
   - 与现有 `PluginIsolationSupport` 的语义一致：宁可少一个增强，不制造启动故障。

2. **客户端契约探针**
   - deck 启动时检查 `ctx.slots.spec('sidebar')`、各子槽位声明、`layout` 服务是否存在；任一缺失就不注册、只打日志（此时官方侧栏仍然在，因为门控没禁用）。
   - 渲染区块时用 try/catch 包住官方组件；单块失败只降级该块（显示"此区块在当前版本不可用"），不拖垮整列。

3. **不碰官方内部**
   - 不复制 `SidebarRoot`、不 import 官方 CSS module 类名、不读 `p-*`/`hHd-Xa_*` 这类哈希类名。
   - 布局与宽度优先用 frame 提供的 `collapsed/width/drawer` 与 `ctx.layout`，不自己算列宽。
   - 图标用官方 `dsw-icon-*` 精灵或自绘，不假设内部 DOM 结构。

4. **升级检测与回归**
   - CI 增加"对 `@deepseek-ai/dsh@next` 装一次 + 冒烟"任务；契约探针失败即失败。
   - 启动器全量回归 `./scripts/test.sh` 里加入 deck 的隔离/回退用例（模拟未知版本 → 应回退官方侧栏）。
   - 发布按启动器版本周期走（`x.y.z-a.b-SNAPSHOT` → 提测 → 正式），deck 与 runtime 版本绑定发布。

## 实现进度（2026-11-11）

已完成并在隔离环境（`DSH_HOME=/tmp/deck-spike`，端口 3099）跑通：

- **UI 优化（第三轮，参考 magpie）**：按 `magpie/site` 的设计语言重做侧栏样式——中性色阶 + 1px 边框平面卡片、4 档字号令牌（10.5 eyebrow / 11 meta / 13 正文 / 14.5 品牌）、12px 卡片间距 / 30px 行高 / 32px 卡头、官方工作区工具栏叠进卡头同一行（不再多占一行）、细滚轮、focus-visible 蓝框、pill 芯片。对比图：`docs/images/sidebar-deck-ui-v2.jpg`。
- **UI 对齐（第二轮）**：区块改成卡片（边框/圆角/悬停）、区块头加计数、官方工作区浏览器压到 26px 行高并固定在卡片内滚动（`[role="treeitem"]` 语义选择器，失败开放）+ 底部渐隐；去掉当前版本已迁到 `sidebar.panellist` 后必然空着的「快捷入口」区块。对比图：`docs/images/sidebar-deck-ui-pass.jpg`。
- **Deck 插件** `Plugins/DSHSidebarDeck/`：接管 `sidebar` 槽位；品牌/新会话/最近会话（真实 `ctx.sessions` 数据、运行中圆点、相对时间、点击切换）/工作区（官方浏览器 `renderSlot`）/面板（官方 panellist 图标，等宽两列）/快捷入口（官方 footer actions）/底部设置座位（含账号登录行，未删除）。区块可折叠、可拖动排序、可拖进底部工具条（点击展开浮层）、布局存 localStorage、品牌行有重置。
- **停用即回退**：Deck 自己的 `cordis.patch.yml` 是「停用官方 `ui-sidebar` + 插入自己」；启动器侧 `Sources/PluginIsolationSupport.swift` 新增 `replacementRows`，用户停用 Deck 时在停用覆盖层末尾追加 `ui-sidebar: disabled: false`。隔离环境已验证：`- id: dsh-sidebar-deck disabled: true` + `- id: ui-sidebar disabled: false` 启动后官方侧栏完整回来（无白屏）。
- **启动器打包**：`BundledPlugin` 增加 `dsh-sidebar-deck`；`build-app.sh` / `build-universal.sh` 复制资源；启动器按「资源存在 + 用户未停用」生成接管补丁（`bootArguments` 新增 deck 槽位，顺序 base → deck → 隔离 → 停用），任一环不满足就退回官方侧栏（失败开放）。`./scripts/test.sh --fast` 全绿、`build-app.sh` 通过。
- **插件管理停用/启用**（同批完成）：管理面板每行新增开关（内置也支持停用、仍不可卸载），停用 = 启动器 `--patch` 覆盖 `disabled: true`，启用即移除；状态存 `$DSH_HOME/plugin-manager/disabled.json`；host 14 个新用例 + UI smoke 场景 + Swift 合并渲染用例。

尚未验证 / 待办：

- 真机（重建后的 Launcher App）启动冒烟：隔离环境里最小 profile 下内置插件的 footer action 没有注册（官方侧栏下同样没有），判断是这些插件依赖的宿主服务在最小 profile 缺失；需要在用户真实 profile 上验证一次。
- 真实「停用 Deck → 重启 → 官方侧栏」与「启用 → 重启 → Deck」的活体回归。
- Windows 启动器还没有读取 `disabled.json` 并合并 `--patch` 的逻辑。
- UI 打磨（按用户要求放到功能完成之后）。

## 里程碑

| | 内容 | 验收 |
|---|---|---|
| M0 ✅ | 接管机制验证（隔离环境） | 截图 + 结论（本文） |
| M1 | deck 骨架：接管外壳、渲染官方 brand/new-session/panellist/workspaces/settings/footer 座位、宽度与折叠 | 隔离环境里侧栏与现网功能等价，官方数据正常 |
| M2 | 区块编排：排序 / 拖进底部工具条 / 折叠 / 换边 / 布局持久化 | 三种交互在浏览器里可用；刷新后保留 |
| M3 | 最近会话区块插件（独立、可卸载）：跨工作区最近会话、状态点、搜索、点击切换 | 卸载后侧栏只少一块；运行中/待审批状态正确 |
| M4 | 启动器打包：`BundledPlugin` 登记、patch、`PluginIsolationSupport` 回退、卸载路径、版本矩阵 | `./scripts/test.sh` 全绿 + 真机安装验证 |

M1 的关键未知已消除（M0），剩下是工程量。

## 风险

- **白屏风险**：deck 靠"禁用官方侧栏"接管，一旦 deck 客户端加载失败就没有侧栏。缓解：启动器版本门控 + 契约探针 + 失败回退；最坏情况用户仍可用 `dsh rescue`。
- **槽位契约漂移**：`sidebar` 的子槽位集合或 props 变化会打破组合。缓解：探针 + 只依赖 props/hook，不依赖内部结构。
- **官方座位组件被替换后行为差异**：`sidebar.workspaces` 的滚动/搜索由官方组件负责，deck 只提供容器，风险较低。
- **拖动与官方宽度状态冲突**：宽度以官方 `ctx.layout` 为准，deck 的拖宽要写回官方状态，不能另存一套。

## 一次性环境

验证环境在 `/tmp/deck-spike`（独立 `DSH_HOME`），没有动 `~/.dsh` 和正在运行的 GUI。后续 M1/M2 继续在这个隔离环境里迭代，验证通过再进 `Plugins/`。
