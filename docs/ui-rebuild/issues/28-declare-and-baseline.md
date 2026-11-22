Label: ready-for-agent
Type: task
Status: ready

# 28：声明与基线：engines/peer + 契约基线重生成 + CI 接线

**What to build:** 让插件在宿主升级时"要么明确报错、要么正常工作"，而不是静默加载；并让契约检查对真实宿主有意义。

- 包声明 `engines.dsh` 支持区间，下界取**实装宿主版本**（实施时用版本锁读出，不硬编码 rc.4）
- 声明 `peerDependencies`：dsh 本体 + 五个 client 子包
- 契约基线用实装宿主重生成，并记录 `hostVersion`
- 版本锁（三方比对：真实宿主 / 基线 / 本包）与契约 check 接进 CI

**Blocked by:** 无（可立即开始）


- [ ] 在真实宿主上跑契约 check，退出码 0；读出的 hostVersion 与基线记录一致
- [ ] 五类变异 fixture（删子槽 / 改 kind / 缺 ILayout 成员 / 改主题前缀 / 基线缺失）各自退出非 0，并打印对应 blocker
- [ ] 版本锁三方不一致时退出非 0，并指出是哪一方
- [ ] CI 对「实装 rc 版本」与「最新 rc 版本」各跑一次，任一失败即红
- [ ] 安装到干净 profile 后包能被正常解析（同名 drop-in 生效）
