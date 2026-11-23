Label: ready-for-agent
Type: task
Status: resolved

# 30：外壳骨架移植（prefactor + 壳层）

**What to build:** 先把客户端渲染拆成可独立演进的模块（prefactor），再把 v17 的骨架搭起来：图标栏、状态栏、设计令牌、壳/板布局。

- prefactor：渲染拆模块，`ILayout` 公开形状保持不变
- 壳/板分层、圆角与发丝边按 v17 令牌落地
- 日夜两套基础色先过 WCAG AA

**Blocked by:** 无（与 28/29 并行）


- [ ] 渲染模块拆分后现有单测全绿，覆盖率门禁不掉
- [ ] 空页面可跑：图标栏 + 状态栏 + 主区容器渲染，无控制台报错
- [ ] 日夜切换即时生效，正文/次要文字对比度均 ≥ 4.5:1
- [ ] 窗口从 1100 到 2000 宽无横向溢出、无元素重叠

---
Closed: 2026-11-22 · 集成分支 `feat/ui-rebuild-spec` @ f82c186 · 418 单测绿
