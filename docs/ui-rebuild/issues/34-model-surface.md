Label: ready-for-agent
Type: task
Status: ready

# 34：模型与推理等级：浮层 + 设置条目面板

**What to build:** 输入框右下角轻量浮层选模型与推理等级（搜索 + 分组 + Default/Low/High/Max，选中即关）；设置→模型用条目面板（模型 / 推理等级 / 团队协作开关）。

- 浮层贴触发按钮定位、右对齐不出屏
- 团队协作是 `role=switch`

**Blocked by:** 32、33


- [ ] 点模型名/箭头弹出模型浮层：搜索框 + 分组 + 当前项勾选，选中即关
- [ ] 点等级弹出四项，选中即回写输入行并关闭；High/Max 等价"深入开"
- [ ] 点浮层外、按 Esc、切换页面都会收起
- [ ] 设置→模型三条目：模型值、推理等级 Default/低/高、团队开关状态都读自真实状态
- [ ] 键盘可用：Tab 可达，`aria-checked`/`aria-expanded` 正确
