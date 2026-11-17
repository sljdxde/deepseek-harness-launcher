# DSHChinaMirror

国内网络加速（内置插件）：把 Deepseek Harness 插件管理器的四类网络请求映射到国内镜像，开关在插件管理面板的「国内加速」切换，**即时生效，无需重启 dsh**。

## 映射规则（内置，随插件版本发布）

| 类型 | 原始地址 | 镜像 |
|------|----------|------|
| npm registry | `https://registry.npmjs.org/` | `https://registry.npmmirror.com/` |
| GitHub raw | `https://raw.githubusercontent.com/` | `https://raw.gitmirror.com/` |
| git clone / codeload | `https://github.com/` `https://codeload.github.com/` | `https://ghfast.top/<原地址>` |
| GitHub API | `https://api.github.com/` | **不映射**（国内多数网络可达，镜像无对应端点） |

## 架构

本插件只提供「开关 + 规则表」：

- `GET /dsh-china-mirror/state` → `{ enabled, table, updatedAt }`
- `POST /dsh-china-mirror/enabled` `{ enabled: boolean }` → 原子写盘

消费方（内置的 dsh-plugin-manager）在启动时和每次网络调用组之前读一次 state，`enabled=true` 时用 `table` 替换 URL 前缀（`mapURL` 是本插件导出的纯函数，两边共用同一实现）；映射后的请求失败时**自然回退直连**，不会因为镜像抖动让安装/更新卡死。

状态存 `~/.dsh/china-mirror/state.json`。关闭开关后所有请求立即恢复直连。

## 独立仓库计划

本插件从 launcher 仓库拆出、独立维护（仓库创建后此 README 更新地址）。launcher 内置一份副本（`windows/internal/assets/plugins/`，由 build.ps1 从本目录同步），保证开箱即用；用户可通过插件管理器更新到独立仓库的新版本。

## 测试

```sh
node --test Plugins/DSHChinaMirror/test/host.test.js
```
