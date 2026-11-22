# 原型版本总表（含原始版存档）

## 结论先说

- **你的原始版本没有丢**：`prototype/dsh-ui-merged.html` 与 Pod 里的原件、以及存档 `versions/00-original-0945.html` 三份 sha256 完全一致（`37c7527e…`，2091 行）。
- **当前参照物 = `dsh-ui-merged-v17.html`**（你指定的版本）；原始版仍是 `dsh-ui-merged.html`。
- 从 v8 起的每一版都留了独立文件，现在统一收进 `prototype/versions/`。

## 存档清单

| 文件 | 行数 | 这一版改了什么 |
|---|---|---|
| `00-original-0945.html` | 2091 | **你的原始版**（Pod 里那份，未改动） |
| `dsh-ui-merged-v6.html` | 2931 | 融合版 v6：图标栏 / 插件管理 / 侧栏六项修复 |
| `dsh-ui-merged-v7.html` | 2931 | 与 v6 内容相同（当时原地覆盖，重复存档） |
| `dsh-ui-merged-v8.html` | 3003 | 侧栏重做：32px 行、保滚动/焦点、需要你=待我处理+已完成未查看 |
| `dsh-ui-merged-v9.html` | 3037 | 侧栏照 dsh：会话不缩进、无计数、动作浮层、选中色 |
| `dsh-ui-merged-v10.html` | 3075 | 需要你/工作区/任务 三段统一卡片，折叠箭头靠最右 |
| `dsh-ui-merged-v11.html` | 3076 | 全 UI 字号/圆角/图标尺寸收敛（15→6 种字号） |
| `dsh-ui-merged-v12.html` | 3106 | 字体照 claude-web tokens、图标全换 Tabler、五个侧栏对齐 x=97 |
| `dsh-ui-merged-v13.html` | 3106 | 与 v12 相同（当时复制快照，内容未分叉） |
| `dsh-ui-merged-v14.html` | 3141 | 设置→模型 改 dsh 条目面板（模型/推理等级/团队开关） |
| `dsh-ui-merged-v15.html` | 3157 | 换模型弹窗改条目行 + 展开子列表 |
| `dsh-ui-merged-v16.html` | 3235 | 模型/等级改轻量浮层（搜索+分组 / Default-Low-High-Max） |
| `dsh-ui-merged-v17.html` | 3237 | 模型选择挪到输入框右下角 |
| `dsh-ui-merged-v18.html` | 3258 | 背景加层：壳/板三张浮卡 + 柔光 + 颗粒 + 点阵 |
| `dsh-ui-merged-v19.html` | 3266 | 背景做实：壳色压深、壳边 14、圆角 16、纹理加强 |
| `dsh-ui-merged-v20.html` | 3305 | 底纹主题（纸纹/网格/点阵/纯色）+ 水印 + 时段色温（未采用） |
| `dsh-ui-merged-v21.html` | 3300 | 满铺布局版（未采用） |

## 丢失 / 重复的，如实说明

- **v1-v5 的 html 没有保留**：v3-v5 只剩截图与 `改动说明-v3/v4/v5.md`；v6 当时是**原地覆盖**成 v7 的基线，所以 v6/v7 文件相同。这是我的存档流程问题，已改为「每版新建文件、只增不改」。
- v12/v13 内容相同（v13 是复制快照，未做修改）。

## 以后怎么存

1. 每轮改动**新建** `dsh-ui-merged-vN.html`，绝不覆盖旧文件。
2. 旧文件进 `versions/`，本表同步追加一行。
3. 当前参照物在 `README.md` 里只写一个文件名，切换时只改这一行。
