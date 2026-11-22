Label: wayfinder:research

Type: research
Status: resolved
Blocked by: —
Assignee: compat-facts（2026-11-20）

## Question

在 dsh 0.2.2-rc.4/rc.5 上，把整站 UI 换成我们的实现，可用的扩展点到底有哪些，哪些是公开承诺、哪些是私有契约？

必须回答：

1. **扩展点清单**：slot/seat 声明、root 注册、client entry（`package.json` 的 `dsh.client`）、bundle patch（`cordis.patch.yml`）、renderer/session/theme 服务。逐条注明：公开导出还是内部实现、d.ts 里有没有稳定承诺。
2. **同名 drop-in 依赖的私有契约**：包名+版本匹配、行 id、槽名/kind、`root.renderSlots`、seat 清单、`ILayout` 服务形状。升级时最可能断的 3-5 个点，每条给 `file:line`。
3. **第三方 UI 插件怎么挂**：dsh-better-sidebar、dsh1024、@linxin666/dsh-skins、dsh-clipchat（见 `~/.dsh/profiles/*/node_modules` 或 `plugin-sources`）——是否替换 root、是否只加 seat/行；有没有「不替换 layout 包也能接管整站 UI」的公开路径。
4. **冲突/降级机制**：布局包自带的 fallback（README 提到的 `#launcher-conflict`）是什么，能否支撑「宿主升级后自动回原生」。
5. **宿主升级机制**：runtime 目录、profile 依赖、npm 版本如何更新；同名冒充包在宿主升级后会不会被覆盖或版本不匹配。

输出：分 5 节的事实表，每条带 `file:line` 证据；末尾列 3 条最致命的兼容风险。只陈述事实，不给方案。

## Answer

（2026-11-20，`compat-facts`；全文见 `research/宿主兼容面.md`。）

- **扩展点**：槽只有 `ctx.slots` 一条入口；root 是内置单槽、d.ts 明写「DO NOT register」；槽类型包未随 runtime 安装，**没有运行时版本校验**；client entry 必须导出 `./client`；bundle patch 能按 id 覆盖 `disabled`，不能改 `name`。
- **drop-in 私有契约**：六槽/kind、root renderSlots、ILayout 六成员、9 个 sidebar 席位、版本锁（package 声称 rc.5，runtime 是 rc.4，baseline 记 rc.5）、自造 props（`activeRail/status*` 恒 undefined）。
- **第三方挂法**：四个样本都不替换 root，只加 seat/行；整站接管只能 patch disable `ui-layout` + insert 自己的行，这不是 slot API 承诺。
- **降级**：`#launcher-conflict` 是自造提示条，不是宿主机制；单槽重复注册不抛错；root 无注册时 renderer 直接抛错，**没有原生兜底**；回滚只能改 profile 依赖并重启。
- **升级**：runtime 整棵 node_modules 被替换；profile pnpm 优先，同名 drop-in 继续遮蔽宿主；没有 engines/peer 就不拦、不警告，静默加载。
- **3 条致命风险**：版本冒充 + 零兼容声明；独占 root + 6 槽硬编码；无运行时回退（白屏，只能手动回滚）。
