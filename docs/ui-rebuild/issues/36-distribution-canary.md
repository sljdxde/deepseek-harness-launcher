Label: ready-for-agent
Type: task
Status: ready

# 36：分发清单 + CI canary

**What to build:** 两条分发通道的元信息齐备；CI 有一条端到端 canary 覆盖"接管/不接管"两条路。

- 随安装包默认携带 + 独立 plugin add
- 无头冒烟：正常基线→无横幅；变异基线→有横幅且原生 UI 在

**Blocked by:** 29、34


- [ ] 发布清单包含必需文件，安装包内路径可解析
- [ ] `dsh plugin add` 单独安装可用；卸载干净
- [ ] canary 在正常基线下断言 v17 外壳渲染且无横幅
- [ ] canary 在变异基线下断言横幅出现、原生 UI 可见
- [ ] canary 在 CI 里对两个 rc 版本都能跑起来
