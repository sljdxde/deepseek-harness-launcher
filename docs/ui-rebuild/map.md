# Wayfinder 地图：dsh 新 UI 插件重构（融合版基线）

Label: `wayfinder:map`

## Destination（终点）

一份可直接交给实施的 UI 重构规格：新 UI 以插件形态替换 dsh 整站界面（基线 = 融合版）；每个控件都能解析到真实动作（0 dead control）；交互与视觉按 claude-web 口径对齐；并给出 dsh 升级后不白屏的兼容契约与回退路径。附一份修好的可点原型 v3 作为验收参照物。

## Notes（领域备忘与既定偏好）

**人类已拍板（不再讨论）：**

1. 终点 = 「路线已定、规格可交」，实施另开 effort。
2. 融合版升为唯一基线；proto-v2 v5.2 与 44 条 FR 的旧口径归档，只作迁移来源。
3. 兼容承诺取强档：升级不白屏；小版本零改动；契约一变自动回原生 UI 并提示。
4. claude-web 按「交互与视觉对齐」口径复刻；dsh 宿主已渲染的组件一律保留、不重画。
5. 验收含「0 dead control」：解析不到动作的控件必须置灰 + 说明，交付前脚本点遍全部控件。
6. 工作区只做组织层（可绑多目录的容器，会话绑其一）；权限沙箱仍以 FR-20 白名单为唯一安全边界，FR-35 三档语义不动。
7. 分层增量：保留「脑」（契约快照、审批、dock/panes/composer 纯逻辑、宿主适配），重写「皮」（布局/rail/sidebar/topbar/statusbar/页面容器）。
8. 交付物 = 规格三件套 + 修好的可点原型 v3；不做换壳 spike。

**已核实的事实（可作工单输入）：**

- 现有换壳是同名 drop-in：`Plugins/DSHClientUILauncher/package.json` 冒充 `@deepseek-ai/dsh-client-ui-layout@0.2.2-rc.5`；`cordis.patch.yml` 为空；契约快照 `contracts/host-baseline.json` + `tools/contract-snapshot.mjs --check` 已可用。
- 现有实现不在 main：0.2.0 主体在 `feat/t3-approval-wiring`（`client/client.js` 2074 行 + `lib/` 约 3800 行 + 审批模块），main 无 `client.js`。
- 原型「点不动」主因是 CSS 网格：`.main{grid-template-rows:auto minmax(0,1fr) auto}` 塞 4 块，聊天页 6 个 tab 被压成 1px 并裁掉；134 处 `data-act` 只有「分屏」无 `case`；另有 16 处只 toast、`copy` 未写剪贴板、`autoToggle` 假开关。事件委托本身无问题。
- 融合版 2091 行单文件、无规格、0 处 localStorage；工作区/目录三处文案不同源。
- claude-web 大部分 UI 表面在 dsh 有对应子系统（conversation groups、sidebar-right/dockkit、approval、composer、schedule/goal/subagent、settings）；真缺口 = 咖啡厅 3D、编排引擎、远程/网关、Monaco。
- 宿主：runtime 依赖 `@deepseek-ai/dsh ^0.2.2-rc.4`，布局包 0.2.2-rc.5；plugin 侧改动需过 `node scripts/coverage-check.mjs` 的 100% 行覆盖门禁（AGENTS.md）。

**规则：** 每票开工前按需调用 grilling / domain-modeling；research 票用 research 技能。地图与工单在 `ui-rebuild/`（本目录已进 `.git/info/exclude`，不入库）；claim = 工单头写 `Assignee`；frontier = 未关闭、`Blocked by` 全部已关闭、无 `Assignee` 的工单。

## Decisions so far（决策索引）

- [01 宿主兼容面与升级断裂点](issues/01-research-宿主兼容面与升级断裂点.md)：槽无运行时校验、root 禁止注册（整站接管只能 patch disable+insert）、同名 drop-in 升级后静默遮蔽且无原生兜底；三条致命风险已列。
- [02 claude-web 交互映射对照表](issues/02-research-claude-web交互映射.md)：大部分表面可映射到 dsh 子系统；「每轮折叠 / 权限卡键位 / 面板保活 / 编辑器」四类存在结构性冲突，详见工单。
- [03 现有实现脑皮盘点](issues/03-research-现有实现脑皮盘点.md)：8820 行里脑约 2997 行可整体搬，皮约 840 行要重写；审批「脑全皮缺」；侧栏/断点/主题变量等 10+ 处硬编码与融合版冲突。
- [06 融合版原型 v3 修复](issues/06-task-融合版原型v3修复.md)：4 行网格修好 tab 被压 1px；分屏做成真 2 栏；copy/autoToggle/stage/commit 接真实状态；剩余 toast 控件统一标「演示占位」。
- [04 插件形态与分发通道](issues/04-grilling-插件形态与分发通道.md)：混合形态 + 启动自检 + engines/peer + 一条命令回退；随包默认、独立安装可选。
- [05 claude-web 对齐切片](issues/05-grilling-claude-web对齐切片.md)：P0 十一项（A1-A11）、P1 六项、不做六项；宿主已渲染只做容器的边界已定；v4 已落地。
- [08 工作区目录语义](issues/08-grilling-工作区目录语义.md)：优先复用宿主数据、一会话一目录、白名单仍是唯一沙箱、删工作区不丢会话。
- [10 原型 v5 六条修订](issues/10-task-原型v5六条修订.md)：加目录/关闭键、权限三档对齐 dsh、鲸标、插件侧栏层级与图标、插件管理新设计、会话侧栏三段（需要你/工作区/任务）。
- [11 原型 v6 图标栏/插件管理/会话层级](issues/11-task-原型v6图标栏插件管理会话层级.md)：鲸标可展开侧栏；插件管理补排序/AI 搜索/7 分类/安装卸载/分段启停；工作区与会话改成行内 +、… 与右键菜单。
- [12 现代 Web 审计 v6](issues/12-task-现代Web审计v6.md)：Lighthouse a11y 94；P0 五项（dialog/菜单/对比度/目标尺寸/语义）+ P1 五项，逐条给实测证据与改法。
- [13 原型 v7 可访问性修复](issues/13-task-原型v7可访问性修复.md)：P0 全修、P1 修五项；Lighthouse Accessibility **94 → 100**，嵌套交互 0，弹层焦点进框。
- [14 侧栏重做对齐 dsh](issues/14-task-侧栏重做对齐dsh.md)：按 dsh 实测 32px 行/12 圆角/动作浮层重做侧栏；修「点击跳动」（保滚动+保焦点+固定行高+绝对定位动作）；需要你=待我处理+已完成未查看；三段层级 + 引导线。
- [15 侧栏照抄 dsh](issues/15-task-侧栏照抄dsh.md)：按 dsh 实测逐项复刻（区头 36/14px、按钮 28·8、行 32·行距 4、会话不缩进、无计数无箭头、动作绝对定位与顺序）；删掉自造项；需要你两组同网格对齐。
- [16 三段统一卡片](issues/16-task-三段统一卡片.md)：删行内小三角；需要你/工作区/任务 统一同一卡片（头部 40 + 圆点 + 标题 + 计数 + 操作 + 箭头最右）；箭头 x=297 对齐。
- [17 UI 一致性 review](issues/17-task-UI一致性review.md)：字号 15→6 种、字重 5→4、行高 11→4、圆角 11→8、图标 7→4；字体照 claude-web tokens；图标全换 Tabler 3.34.1；五个侧栏统一到 x=97；a11y 保持 100。
- [18 换模型支持推理等级](issues/18-task-换模型支持推理等级.md)：弹窗加快速/标准/深度分段控件（radiogroup+aria-checked）；选模型不关窗；「深入」改「推理·等级」；修弹窗只在种类变化时重建导致内部状态不刷新的 bug。
- [19 模型设置照 dsh 条目面板](issues/19-task-模型设置照dsh条目面板.md)：设置→模型 改 44px 条目面板（模型 / 推理等级 / 团队协作开关），悬停整行高亮；推理等级独立弹窗三选项；开关 role=switch。
- [20 换模型弹窗照 dsh 条目面板](issues/20-task-换模型弹窗照dsh条目面板.md)：弹窗内删分段控件，改 drow 行 + 展开子列表选等级 + 团队协作开关；未选模型行去图标改空槽对齐。
- [21 模型选择轻量浮层](issues/21-task-模型选择轻量浮层.md)：输入框右下 `模型 Default ⌄`，点开贴边浮层（模型带搜索+分组 / 等级 Default-Low-High-Max），选中即关；点外/Esc/切页自动收。
- [22 模型选择挪右下角](issues/22-task-模型选择挪右下角.md)：目录 pill 后加弹性空隙，模型/等级/发送整组靠右，模型段紧贴发送按钮左侧；浮层随触发按钮定位。
- [23 背景加层](issues/23-task-背景加层参考claude-web.md)：读 claude-web 源码，侧栏/主区/右栏改成壳上的三张卡（14 圆角+发丝边+双层阴影+8px 壳边距）；壳层 radial 柔光 + CSS 点阵颗粒；对话区点阵纹理。
- [24 背景做实](issues/24-task-背景做实.md)：v18 太淡；壳色独立并压深（浅 #e7dfcc / 深 #0b0c0e），壳边 14、圆角 16、柔光/颗粒加强；1280 以下退满铺兜底。
- [25 底纹主题/水印/时段色温](issues/25-task-底纹主题-水印-时段色温.md)：外观加纸纹/网格/点阵/纯色四种底纹；对话区同心圆+斜线水印；按小时 6 档色温微调壳色并显示时段。
- [26 回退到 v19](issues/26-task-回退到v19.md)：v20 的三栏卡片在 1442 宽下右栏被裁、顶栏挤压；v21 改满铺又不合口味。**当前参照物改回 v19**（三张浮卡 + 壳层柔光/颗粒/点阵），v20/v21 仅留档不采用。

_（05 / 04 / 08 / 10 / 11 / 12 / 13 / 14 已关闭；frontier = 09 需求重写、07 巡检。**原型已确认：`prototype/dsh-ui-merged-v17.html`；兼容方案已签收；文档已冻结到 `feat/ui-rebuild`（24b3ea5）。需求重写（09）已折叠为规格 `issues/27-spec-compat-ui-rebuild.md`；10 张实现票（28-37）**全部实现并合入** `feat/ui-rebuild-spec`@f82c186；两轴 code-review 已归档（`review-2026-11-22.md`）并修复。剩余：真机验收（canary --real + 三态回退）与发布判断。**）_

## Not yet specified（雾区：范围内、尚无法成票）

- **插件形态与分发通道**（drop-in / 公开扩展点 / 混合；随 DHL 发布 / 独立安装）——等 01 的宿主事实。
- **兼容机制细节**（契约快照覆盖范围、CI canary、自动回退的触发条件与用户可见 UX、版本矩阵）——等 01 + 04。
- **规格重写粒度**（03/04/05 打补丁还是重写；44 条 FR 的保留/合并/作废规则）——等 05、08。
- **原型 v3 的交付边界**（只修死控件与假开关，还是同时补对齐后的新交互）——等 05。
- **设置页 / 插件管理 / 归档管理**的界面——等用户给设计（沿用汇总文档第五节 #1/#2）。
- 旧版「本版不做」项（FR-21/22/24/35/37/44 态 1/2 等）在新基线下是否复活。

## Out of scope（范围外）

- **实施落地**：写插件代码、上线、发布——终点是规格，实施另开 effort。
- **launcher 的 Swift 侧**（菜单栏、安装器、内置 Harness 窗口）改动。
- **换壳 spike / 最小可运行验证**（Q8 选 B 不选 C）。
- **proto-v2 的继续维护**（归档，仅作迁移来源）。
- 汇总文档已明确不做的项：成员页、网关/模型路由、云移交、computer 使用指示、android 面板、Monaco 编辑器、完整 Git 面板、⌘K 复用宿主面板、右栏与侧聊的划词引用、分屏自选块顺序。
