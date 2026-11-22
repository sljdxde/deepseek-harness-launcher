# claude-web 交互映射（研究 02）

来源：子代理 `claude-web-map` 盘点 `/tmp/claude-web-ref`（HEAD `09c8cc5`），2026-11-20。
结论：**大部分 UI 表面在 dsh 有对应子系统；真缺口是咖啡厅 3D、编排引擎、远程/网关、Monaco。**

## 映射表

| claude-web 表面 | dsh 对应 | 判定 |
|---|---|---|
| 会话页 / 每轮折叠 / 步骤时间线 | `conversation` Event/View/Group Definition + `ui-chat` | 可做；折叠必须写成 Group Definition，不能包 DOM |
| 右栏 Review / Files / Git / Terminal / Browser | `sidebar-right` + `ui-dockkit` + `workspace-files` + `shell`/`terminal`/`lsp` | 可做；tab 类型需注册 |
| composer 权限卡 | `approval/request` waterfall（闭集、fail-closed） | 位置可做；「空框 Enter=允许」拿不到宿主内部态 |
| composer 排队 / 插话 | `composer` + `conversation.input.activity` slot | 可做 |
| 分屏 / tab / 组 | 纯前端布局树 | 可做；「隐藏不卸载」与 slot 生命周期冲突 |
| 命令面板 / 快捷键 | 纯前端命令表 + 宿主快捷键 | 可做 |
| 侧栏 Needs you / Overview / pin | `sidebar` slots + `session-query` / `session-projection` | 可做 |
| 设置六组页 | `settings` + `ui-settings` slot | 可做 |
| Background 卡片 / 关系图 | `jobs` + `subagent` | 卡片可做；3D 咖啡厅要自建 |
| Automation | `schedule` / `goal` / `subagent` | 可做 |
| Providers / 模型菜单 | `llm` 路由 + `config-catalog` | 可做 |
| 远程 / 手机 | 无对应 | 需后端，不做 |

## 结构性冲突

1. **每轮折叠**：dsh 按 Event Definition 物化节点、增量快照渲染，没有「整轮一个容器」；`transcriptView: compact` 折的是轨迹，不是轮。
2. **权限卡键位**：「卡出现瞬间的 Enter 不算」「空框 Enter=允许」是 claude-web 私有约定，插件只能 slot 内自管，易与宿主 Enter 语义打架。
3. **保活**：`keepAlive`（隐藏不卸载）与 Cordis effect 生命周期相反。
4. **编辑器**：dsh 无编辑器子系统，只有 `sidebar-documentpreview`；Monaco tab 等于新造一套。
5. **覆盖层**：全窗设置、⌘K、咖啡厅 canvas 需抢 root 或新增 slot 声明。
6. **样式与 i18n**：`html[data-theme]`、`.chat[data-state]` 钩子与中文原文当 key 的 `tr()`，和 dsh 主题令牌、bundle i18n 是两套契约。
