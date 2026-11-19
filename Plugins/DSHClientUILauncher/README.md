# dsh-client-ui-launcher（T3）

dsh 新外壳：接管 `root` 并重新声明 6 个子槽，把整站换成「图标栏 + 侧栏 + 主区 + 右栏 dock + 底状态条」，
再挂右栏多标签、2/4/6 分屏、composer 四件、插件工作台容器。设计与验收见
`Pod/docs/features/0.2.0-dsh-launcher-new-ui/05-设计.md`。

## 现状（T3 第一段）

| 部分 | 状态 |
| --- | --- |
| 纯逻辑：右栏宽度/隐藏、分屏降档、宽度预算（`lib/layout.js`） | 已实现，单测覆盖 |
| 纯逻辑：`/` 三档匹配、附件条规则、上下文计量、排队消息、引用插入（`lib/composer.js`） | 已实现，单测覆盖 |
| 契约常量表（`lib/contract.js`）+ 运行期 diff | 已实现，单测覆盖 |
| 契约快照工具（`tools/contract-snapshot.mjs`）+ baseline | 已实现，`--check` 与宿主 0.2.2-rc.5 一致 |
| host 半区（`lib/index.js`） | 空实现：本版没有 host 能力，审批服务是 T4 |
| **客户端渲染（LauncherRoot / 6 槽声明 / 右栏 / 分屏 / composer UI / 插件容器）** | **未开始** |
| `scripts/shell-switch.sh`（R1 回滚入口） | 未开始 |
| `package.json` 的 `dsh.client` | 暂时不宣称：渲染器落地后再加，避免装上只有一个空插件行 |

所以这个包现在**不可安装、还不换皮**：它是 W1 的一半 + W9 的核心。

## 测试

```sh
node --test test/*.test.mjs                     # 28 条，全绿
node --experimental-test-coverage --test test/*.test.mjs   # 行覆盖 100%

# 宿主槽契约（默认读包内 node_modules；本仓库不装依赖时指到 npm 快照）
node tools/contract-snapshot.mjs --check \
  --layout-from  <...>/node_modules/@deepseek-ai/dsh-client-ui-layout \
  --sidebar-from <...>/node_modules/@deepseek-ai/dsh-client-ui-sidebar
```

`--check` 退出码：0 一致、2 有差异、3 找不到输入。差异分类打印
（`slot:new` / `slot:kind-changed` / `slot:removed` / `seat:*` / `root:render-slots`），
确认跟进后 `--write` 更新 `contracts/host-baseline.json`，并在 PR 里写"宿主改了什么、我们跟进了什么"。

## 契约事实（0.2.2-rc.5）

- 6 子槽：`sidebar:single`、`main:keyed`、`rightbar:single`、`shell.bottom:single`、
  `shell.overlay:list`、`shell.leading:single`；root 的 `renderSlots` 正好是这 6 个。
- `ui-sidebar` 在 `sidebar` 槽里声明了 **9 个席位**（含 `sidebar.brand.mark`、`sidebar.workspaces`、
  `sidebar.settings` 等），且写在它公开的 `SlotMap` 里 —— 所以 05-§4.3 的**落法 A 技术上可行**；
  但走 A 要连同这 9 个席位一起复刻，选 A 还是 B 按 06-§四第 3 条在第一支 PR 里定稿。

## 下一步

1. 客户端渲染器（W1 尾）：`LauncherRoot` 注册 `root` + 6 槽声明 + `#launcher-conflict` 降级 + 图标栏/侧栏/主区/状态条。
2. W2–W7：右栏 dock、分屏、⌘K、composer 四件 UI、插件工作台容器。
3. `scripts/shell-switch.sh` + 实跑输出（06-§四第 2 条：没有 `native`/`launcher` 两次真实输出，PR 不合）。
