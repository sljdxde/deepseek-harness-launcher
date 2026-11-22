Label: ready-for-agent
Type: task
Status: ready

# 35：回退面：设置入口 + 命令 + runbook

**What to build:** 用户能在产品里找到回退：设置→高级→「回退原生 UI」，拿到可复制命令，按 runbook 完成 native→launcher→native 三态，数据不丢。

- 命令固定 remove → install → 重启
- 不提供一键执行破坏性操作

**Blocked by:** 33


- [ ] 设置→高级能看到回退入口与说明（数据目录不动）
- [ ] 命令可一键复制，内容与 runbook 一致
- [ ] 按 runbook 完成三态切换，三次都能在 3 分钟内回到原生 UI
- [ ] 回退后审批策略与审计记录仍在
