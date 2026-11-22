Label: ready-for-agent
Type: task
Status: ready

# 29：HostGuard 判定表 + Bootstrap：不接管与横幅

**What to build:** 宿主形状变化时**不注册 root、不白屏**：保留原生界面，并显示一条可关闭的说明横幅（原因列表 + 可复制的回退命令）。

- guard 是纯函数：输入版本/基线/子槽/renderSlots/ILayout 成员/主题前缀，输出 `{ok, blockers[], warnings[]}`
- 关键项不符即 blocker：版本出区间、基线不可读、子槽缺失或 kind/scope 变化、renderSlots 缺项、ILayout 六成员缺失
- 主题变量前缀改名 = warning：仍接管，但全部走内联 fallback 变量（配色退化而不白屏）
- 横幅每次启动出现一次，可关闭但不持久化

**Blocked by:** 28


- [ ] 基线不可读按"不匹配"处理，不重试、只记一条日志
- [ ] 五种 blocker 各自单独触发时都进入"不接管"分支，原生 UI 可见
- [ ] 横幅含原因、回退命令、"本次不再提示"
- [ ] 主题前缀改名时仍接管，页面无样式错乱（退化为 fallback 配色）
- [ ] guard 判定表单测覆盖每个分支（含 warnings 不阻挡接管）
- [ ] 重复加载幂等：不会注册两次、不会叠出两条横幅
