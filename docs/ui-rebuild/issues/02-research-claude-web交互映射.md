Label: wayfinder:research

Type: research
Status: resolved
Blocked by: —
Assignee: claude-web-map（2026-11-20）

## Question

把 claude-web 的 UI 表面与交互模式逐项映射到 dsh：哪些能落在宿主已有子系统上，哪些只能靠外壳自绘，哪些需要 dsh 没有的后端？重点回答每轮折叠、权限卡、排队/插话、右栏 tab、分屏、命令面板这六类的可行性。

## Answer

（来源：claude-web-map 子代理盘点，仓库 `/tmp/claude-web-ref`，HEAD `09c8cc5`；只按 README/CLAUDE.md 与源码目录取证，未逐文件读实现。）

### 映射结论

| claude-web 表面 | dsh 对应 | 判定 |
|---|---|---|
| 会话页、每轮折叠成一行、步骤时间线 | `conversation` 的 Event/View/Group Definition + `ui-chat` | 可做；折叠必须写成 Group Definition，不能在渲染层包 `<div class="turn">` |
| 右栏 Review / Files / Git / Terminal / Browser | `sidebar-right` + `ui-dockkit` + `workspace-files` + `shell`/`terminal`/`lsp` | 可做；tab 类型需注册 |
| composer 权限卡 | `approval/request` waterfall（结果闭集、fail-closed） | 卡的位置可做；「空框 Enter=允许」依赖 composer 与卡的共享内部态，插件拿不到 |
| composer 排队 / 插话 | `composer` + `conversation.input.activity` slot | 可做 |
| 分屏 / tab / 组 | 纯前端布局树 | 可做；「隐藏不卸载」与 slot 生命周期冲突 |
| 命令面板 / 快捷键 | 纯前端命令表 + 宿主快捷键 | 可做 |
| 侧栏 Needs you / Overview / pin | `sidebar` slots + `session-query` / `session-projection` | 可做 |
| 设置六组页 | `settings` 子系统 + `ui-settings` slot | 可做 |
| Background 卡片 / 关系图 | `jobs` + `subagent` | 卡片可做；3D 咖啡厅要自建 |
| Automation（定时/目标/多代理） | `schedule` / `goal` / `subagent` | 可做 |
| Providers / 模型菜单 | `llm` 路由 + `config-catalog` | 可做 |
| 远程 / 手机 | 无对应 | 需后端，不做 |

### 结构性冲突（规格必须正面处理）

1. **每轮折叠**：dsh 按 Event Definition 物化节点、增量快照渲染，没有「整轮一个容器」这一层；`transcriptView: compact` 折的是轨迹，不是轮。
2. **权限卡键位**：「卡出现瞬间的 Enter 不算」「空框 Enter=允许」是 claude-web composer 与卡共享的私有约定，dsh 插件只能 slot 内自管，容易与宿主 Enter 语义打架。
3. **保活**：claude-web 面板 `keepAlive`（隐藏不卸载）与 Cordis effect 生命周期相反——owner 折叠时贡献会被移除。
4. **编辑器**：dsh 没有编辑器子系统，只有 `sidebar-documentpreview`；Monaco tab 等于新造 tab 类型 + 缓冲 + 保存语义。
5. **覆盖层**：全窗设置页、⌘K、咖啡厅 canvas 需抢占 root 或新增 slot 声明。
6. **样式与 i18n 契约**：`html[data-theme]`、`.chat[data-state]` 等 DOM 钩子与中文原文当 key 的 `tr()`，与 dsh 主题令牌、bundle 式 i18n 是两套契约，不能混。
