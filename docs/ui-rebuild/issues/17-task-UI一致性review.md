Label: wayfinder:task

Type: task
Status: resolved
Blocked by: —
Assignee: lead（2026-11-20）

## Question

整个 UI 再 review，确保字体、图标、元素一致；会话侧栏字体偏大；各页侧栏没对齐；图标要补、用 Tabler；字体照 claude-web。

## Answer

（产出 `prototype/dsh-ui-merged-v12.html`，明细 `prototype/改动说明-v12.md`。）

- 审计 8 个页面全部文本节点：字号 15 种→6 种（10/11/12/13/14/20）、字重 5→4（400/500/600/700）、行高 11→4+20px、圆角 11→8 档（2/4/6/8/10/12/999/50%）、图标尺寸 7→4（12/14/16/20）。
- 字体照 claude-web tokens.css：Inter Variable / JetBrains Mono / PingFang 回退；字号对齐其 micro11/meta12/sm13/base14；会话行标题 14→13（这就是「偏大」那处）。
- 图标全部换 Tabler Icons 3.34.1 outline（64 个 + sliders），统一 1.7 stroke；文字 ✓ 换成 Tabler check。
- 插件/扩展/设置/自动化/后台 五个侧栏从旧 .chat-row 改成 side-card+row，标题左端全部 x=97（8 个页面实测一致）。
- 复核时修掉 checklist 复选框 13px 过小（target-size），改为 18px + 32px 行高。
- 验证：字号/字重/圆角/图标分布如上；横向溢出 0；123 图标 0 空渲染；Lighthouse a11y 100、BP 100；控制台 0 报错。
