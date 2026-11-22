Label: wayfinder:grilling

Type: grilling
Status: resolved
Blocked by: 01
Assignee: lead（2026-11-20）

## Question

在「宿主兼容面」的事实之上，拍板三件事：

**A. 插件形态**：① 继续同名 drop-in（完全控制，但每次宿主升级要跟契约）；② 改用公开扩展点（稳，但可能接不了整站）；③ 混合（公开面为主 + drop-in 只兜底 root）。

**B. 分发通道**：随 launcher 安装包发 / 独立 dsh 插件（插件市场或手动装）/ 两者都支持。写清安装、升级、卸载各走哪条。

**C. 兼容承诺落成机制**：契约快照覆盖到哪、CI 怎么拦（canary 用哪个宿主版本）、自动回退的触发条件与用户可见 UX（提示文案、怎么切回、状态是否保留）。

产出：一份可写进 ADR 的决策记录，含被否选项与理由。

## Answer

（2026-11-20，人类回复「全部按照推荐」；方案全文见 `兼容性改造方案.md`。）

- **形态**：混合。默认只加公开扩展点（seat/行/`shell.overlay`）；仅当启动自检通过，才用 bundle patch disable `ui-layout` + insert 接管 root。被否：直接 `register('root')`（d.ts 明写 DO NOT register）、纯 drop-in 无护栏。
- **自检**：宿主版本、6 子槽 name/kind、root renderSlots、ILayout 六成员、主题变量前缀；任一不符 → 不接管、显示横幅、给回退命令，不抛错。
- **声明**：加 `engines.dsh` + `peerDependencies`；契约 baseline 改记**实装 rc.4**；CI 对 rc.4 与最新 rc 双跑 `contract-snapshot --check`。
- **回退**：设置 → 高级 → 回退原生 UI（remove + install + 重启）；审批策略与审计留在 `~/.dsh/state` 不丢。
- **分发**：随 DHL 安装包默认携带，同时支持独立 `dsh plugin add`。
