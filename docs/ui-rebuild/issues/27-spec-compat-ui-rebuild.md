Label: ready-for-agent
Type: spec
Status: ready
Source: wayfinder map（docs/ui-rebuild/map.md）+ issues 01-26 + 兼容性改造方案.md（已签收）

# Spec：整壳 UI 的兼容硬化与 v17 落地

## Problem Statement

用户装的是「整套换皮」的 UI 插件（同名 drop-in 替换宿主 layout）。当前它有三处硬伤：

1. **升级可能白屏**：插件没有声明 `engines.dsh` / `peerDependencies`，宿主升级时会静默加载；启动前不校验宿主契约（root 子槽、`renderSlots`、`ILayout` 成员、主题变量前缀），一旦宿主形状变了，root 注册失败就直接白屏，而宿主没有原生兜底。
2. **契约基线过期**：`contracts/host-baseline.json` 记的是 rc.5，与实装宿主不一致；`--check` 只在仓库内自比，宿主升级后仍可能"通过"。
3. **没有回退入口**：用户唯一的退路是翻文档手敲命令；数据目录、审批策略、审计的保留边界没有写在产品里。

同时，人类已确认的 **v17 视觉**尚未移植进插件（现有 `client/client.js` 还是旧外壳），0 dead control 也没有被验证过。

## Solution

把确认过的 v17 外观移植进同名 drop-in 包，并加**四道护栏 + 一条验收线**：

- 护栏一 **HostGuard**：注册前自检宿主版本/子槽/`renderSlots`/`ILayout` 成员/主题前缀，任一关键项不符就**不接管**、保留原生 UI、显示可关闭横幅并附回退命令。
- 护栏二 **声明与基线**：补 `engines.dsh` + `peerDependencies`；baseline 用实装版本重生成；CI 对「实装 rc.4 + 最新 rc」各跑一次契约 check。
- 护栏三 **回退**：设置 → 高级 → 「回退原生 UI」，给出可复制的 remove/install/重启命令；数据不丢；三态（native → launcher → native）各验一次。
- 护栏四 **分发**：随 DHL 安装包默认携带 + 独立 `dsh plugin add` 两条通道，安装/升级/卸载写进 runbook。
- 验收线：契约 check 退出 0、升级 canary 不白屏、回退 3 分钟内完成、**0 dead control**。

## User Stories

1. 作为 dsh 用户，我希望升级 dsh 后界面要么正常工作、要么自动回到原生界面，这样我不会看到白屏。
2. 作为 dsh 用户，我希望版本不匹配时看到一条可关闭的说明横幅，并直接拿到回退命令，这样我不用去翻文档。
3. 作为 dsh 用户，我希望在设置里一键回到原生 UI，这样出问题时 3 分钟内能恢复。
4. 作为 dsh 用户，我希望回退不丢审批策略、审计和会话数据，这样我敢试新 UI。
5. 作为 dsh 用户，我希望新 UI 在日间/夜间两套主题下都过 WCAG AA，这样长时间用眼不累。
6. 作为 dsh 用户，我希望侧栏能看出「工作区 → 会话」的层级，而不是一坨平铺列表。
7. 作为 dsh 用户，我希望「需要你」把「待我处理」和「已完成未查看」汇总在一起，这样我一眼知道要处理什么。
8. 作为 dsh 用户，我希望点击会话、折叠分区时列表不跳动。
9. 作为 dsh 用户，我希望模型和推理等级在输入框右下角轻量切换（搜索 + 分组 + Default/Low/High/Max），不要弹大框。
10. 作为 dsh 用户，我希望设置里的模型项做成和 dsh 一样的条目面板（模型 / 推理等级 / 团队协作开关）。
11. 作为 dsh 用户，我希望字体、字号、圆角、图标尺寸在全站一致（Tabler 图标、claude-web 的字号阶梯）。
12. 作为 dsh 用户，我希望背景有可切换的底纹（纸纹/网格/点阵/纯色）并能按早晚微调色温，这样界面不呆板。
13. 作为 dsh 用户，我希望对话区有极淡的几何水印，但绝不干扰阅读。
14. 作为键盘用户，我希望所有可点元素都能 Tab 到、有可见焦点，没有点了没反应的死控件。
15. 作为 dsh 用户，我希望插件随启动器安装包默认就有，不用自己装。
16. 作为尝鲜用户，我希望也能用 `dsh plugin add` 单独安装。
17. 作为维护者，我希望宿主 minor 升级时插件零改动，major 有明确适配窗口。
18. 作为维护者，我希望 CI 在宿主契约变化时报红，而不是等用户白屏才发现。
19. 作为维护者，我希望契约基线能一条命令重生成，并记录是哪个宿主版本。
20. 作为维护者，我希望 guard 的判定表有单测覆盖每一个分支（版本、子槽、kind、成员、前缀、baseline 缺失）。
21. 作为维护者，我希望「0 dead control」是一条可自动巡检的验收项，而不是人工点一遍。
22. 作为审阅者，我希望这套 UI 的视觉基线冻结在 v17，后续改动都有版本存档可回溯。

## Implementation Decisions

**形态（已定）**：本包是**同名 drop-in**（包名就是 `@deepseek-ai/dsh-client-ui-layout`），由 profile 依赖/override 按名解析；`cordis.patch.yml` 保持 `[]`，不再 insert 自己的行（否则同一实现加载两次、root 注册两次）。换壳靠"替换实现"，不靠 patch 抢注。

**要建/改的模块**（按职责命名，不写路径）：
- **HostGuard**：`guardHost({ hostVersion, baseline, slots, layoutMembers, themePrefix }) → { ok, blockers[], warnings[] }`。blockers：版本不在支持区间、baseline 缺失/不可读、root 子槽缺失或 kind/scope 变化、`renderSlots` 缺项、`ILayout` 六成员缺失、主题前缀改名。warnings：新增可选成员、主题变量新增（不阻挡接管，记日志）。
- **Bootstrap**：guard 通过才注册 root 并注入 client；不通过则不注册、不抛错，改为渲染兜底横幅（含原因列表 + 回退命令 + "本次不再提示"）。
- **ContractBaseline**：`--write` 用实装宿主重生成并写入 `hostVersion`；`--check` 做**结构比较**（集合比较，不比顺序），区分 blocker / warning。
- **RollbackSurface**：设置 → 高级 的条目 + 命令生成 `rollbackCommand(profile)`；命令固定为 remove → install → 重启；附带"数据目录不动"的说明与 runbook 链接。
- **ShellTransplant**：把冻结的 v17 外壳（rail / sidebar / main / dock / statusbar + tokens）作为 client 的渲染实现，沿用 ILayout 现有公开形状，不改宿主契约。
- **DistributionManifest**：`engines.dsh`（支持区间以实装 rc.4 为下界）、`peerDependencies`（dsh + 五个 `dsh-client-ui-*`）、`files`、npm 发布元信息。

**接口与契约**
- `ILayout` 六个成员签名保持不变；新增能力只能通过可选参数/可选方法。
- Guard 输出是**纯数据**，便于在 host 半区与 client 半区复用，也便于单测。
- 版本支持区间写在 `engines.dsh` 与 guard 共同引用的一份常量里，避免两处漂移。

**行为细节（易错处先定死）**
- baseline 不可读 = **按不匹配处理**（安全侧），记一条日志，不重试。
- 主题前缀改名 = **warning 而非 blocker**：仍接管，但全部走内联 fallback 变量（保证不白屏、只是配色退化）。
- 横幅只出现一次/会话，可关闭；关闭状态不持久化（下次启动仍会提示，避免掩盖问题）。
- 回退动作是**可复制命令**，不在 UI 内直接执行破坏性操作。
- 0 dead control 的判定：每个可点元素要么有处理函数，要么显式 `disabled`，要么带 `title/aria-label` 说明"演示占位"。

**从原型继承的视觉决策**（v17 冻结）：壳/板分层、32px 行、12–16 圆角、Tabler 图标 1.7 描边、claude-web 字号阶梯（11/12/13/14）、侧栏标题左端统一 x=97、需要你=两组合计、模型浮层四项等级。

## Testing Decisions

**好测试的标准**：只测外部行为（guard 的输入→输出、命令生成的字面结果、横幅出现/不出现、root 是否注册），不测内部函数调用次数与私有结构。

**缝合点（按高度从高到低）**
1. **契约快照 CLI + 版本锁**（最高缝，一条命令覆盖"宿主形状是否还兼容"）：`contract-snapshot --check` 对实装宿主与一组 fixture 宿主（删槽 / 改 kind / 缺 ILayout 成员 / 改主题前缀 / baseline 缺失）分别断言退出码与 blocker 列表。
2. **插件单测（node:test + 假宿主 ctx）**：guard 判定表逐分支、`rollbackCommand` 字面值、`engines/peerDependencies` 断言、分发清单断言。沿用现有 25 个 `test/*.test.mjs` 的写法与 100% 行覆盖门禁。
3. **端到端冒烟（一条 canary）**：无头启动 dsh 加载本包 → 断言 root 渲染出 v17 外壳、横幅不存在；再用"变异 baseline"启动 → 断言横幅存在且原生 UI 在。只在 CI 跑一条，不进日常单测。

**要测的模块**：HostGuard、Bootstrap（注册/不注册分支）、ContractBaseline 的 check 语义、RollbackSurface 的命令生成、DistributionManifest。

**先例**：`test/contract.test.mjs`（契约结构断言）、`test/escape.test.mjs`（安全侧行为）、`test/layout.test.mjs`（ILayout 形状）；CI 侧沿用 `tools/contract-snapshot.mjs --check`。

## Out of Scope

- 改 dsh 宿主本身（槽位体系、renderer、主题机制）。
- 主题编辑器、自定义配色、动效系统。
- 移动端 / 手机壳（`shell/` 不吃 tokens，不在本次）。
- Windows 安装器打包流程改造。
- 历史会话迁移、旧 UI 与 v17 的双向切换动画。
- 发布到 npm 商店（只准备元信息与 CI 校验，不代发）。

## Further Notes

- 视觉基线：`docs/ui-rebuild/prototype/dsh-ui-merged-v17.html`（人类确认，2026-11-20），历史版本在 `prototype/versions/`。
- 兼容方案全文：`docs/ui-rebuild/兼容性改造方案.md`（已签收）。
- 07 号工单「死控件巡检」并入本 spec 的验收票，不再单独作为探索票。
- 支持区间以实装版本为准：实施时先用版本锁读出真实宿主版本，再生成 baseline 并写 `engines.dsh`；不要沿用"rc.4"这类硬编码假设。
