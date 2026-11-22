# UI 重构工作区（本地，不入库）

这个目录是「dsh 新 UI 插件重构」的全部工作材料：地图、工单、调研、原型。**已被 `.git/info/exclude` 排除，不会进 git。**

## 目录

| 路径 | 内容 |
|---|---|
| `map.md` | wayfinder 地图（终点、拍板、事实、雾区、范围外） |
| `issues/` | 工单，一张一个 md；`Blocked by` 是阻塞关系 |
| `prototype/` | 原型与截图：`dsh-ui-merged-v17.html` 是**当前参照物**（原始版另存 `dsh-ui-merged.html`）；`versions/` 存 v6-v21 全部历史版本；`VERSIONS.md` 是版本总表 |
| `research/` | 调研结论（claude-web 映射、原型审计、现有实现盘点、宿主兼容面） |
| `notes/` | 讨论记录 |

## 怎么用

- 地图与工单：先读 `map.md`，再看 `issues/` 里 `Status: open` 且 `Blocked by` 全闭的那张。
- 原型：浏览器直接打开 `prototype/dsh-ui-merged-v3.html`，无需构建。
- 工单状态：`open` / `resolved`；认领写 `Assignee`。

## 边界

- 这里只放**规划与参照物**，不放实现代码；实现另开 effort。
- 原型里的演示数据、`is-stub` 控件都是参照物的一部分，不代表最终实现。
