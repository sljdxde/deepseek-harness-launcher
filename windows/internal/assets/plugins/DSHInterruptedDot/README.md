# dsh-interrupted-dot

把 Harness 侧栏里「本轮异常结束」的会话状态点染红。**绿点 = 本轮正常结束，红点 = 本轮异常结束**。

这个插件随 **Windows 启动器内置分发**（与归档 / 插件管理 / 会话通知一样从内置
资源解出并注入 base patch）；macOS 启动器暂未随包内置，本机仍以 local-plugins
方式安装。

启动器在 `AGENTS.md`、`test.sh` 里明确「不往 Harness 侧栏注入红点」，那条规则
针对的是**额外加一个完成提醒点**。这里不新增第二个点，只把 DSH 自己那个
「已完成」状态点的 `data-state` 从 `done` 改成 `error`（组件自带红色，主题里的
`--dsw-alias-state-error-primary`）。

## 组成

| 半边 | 文件 | 作用 |
|------|------|------|
| 宿主 | `lib/index.js` | 监听 `session/event` 的 `turn/end`，按 `reason.kind` 记下每个主会话最后一轮的结局；`GET /dsh-interrupted-dot/state` → `{ revision, failed: [sessionId] }` |
| 浏览器 | `client/client.js` | 轮询上面的接口 + 自己判定「进程崩溃」，把列表里对应行的状态点染红 |

## 判定规则

| `turn/end` 的 reason | 结局 | 说明 |
|----------------------|------|------|
| `completed` | 正常（绿） | |
| `aborted` | 正常（绿） | 用户按停止 / 宿主回收 |
| `max-tokens` / `blocked` / `forked` | 正常（绿） | 不算失败 |
| `error` | **异常（红）** | 模型 / 网络 / 工具报错 |
| `interrupted` | **异常（红）** | 进程在本轮完成前退出，宿主恢复时补写的收尾标记 |

进程崩溃时宿主已经死了，没人能记录：浏览器半边靠**连接代次**判定——一次真实
重连（`connection/reset`）前后 3 秒内，某会话从 `running: true` 变成 `false`，
说明 dsh 在这中间死过，这一轮不可能正常收尾。正常收尾不会跨重连，它一定在
当前连接里先把 `running` 置 false。

红点跟 DSH 自己的完成点同生命周期：打开会话（DSH 撤掉完成点）或会话重新开跑
就恢复；新一轮 `turn/start` 会清掉宿主里的失败记录，红点不会盖住下一次正常完成。

## 已知边界

- 崩溃判定要求**崩溃那一刻有页面开着**。整页刷新之后 DSH 自己也不会点亮完成点，
  这里同样不会再补一个红点。
- 「本轮报错」的记录只在宿主进程内存里：dsh 重启后失败列表清空（跨重启的崩溃
  由上面那条重连判定覆盖）。
- 只染 DSH 已经画出来的「已完成」点；会话空闲（没有点）时什么也不加。
- 读屏器标签仍是 DSH 的「已完成」，只有颜色和 `title` 变成异常。

## 安装 / 停用

Windows：启动器启动时把本目录解到 `%LOCALAPPDATA%\DHL\plugins\DSHInterruptedDot`，
链接进 profile 的 `node_modules`，并把 `cordis.patch.yml` 的 `insert` 合并进本次
启动的 base patch（`windows/internal/pluginisolation`）。停用：在插件管理面板里
关掉 `dsh-interrupted-dot`（写进停用覆盖层），重启 dsh 生效。

macOS（本机私有安装）：`~/.dsh/profiles/web` 里用
`link:/Users/yuzhou/.dsh/local-plugins/dsh-interrupted-dot` 建依赖，并在
`cordis.patch.yml` 末尾加同样的 `insert`；链接
`~/.dsh/profiles/web/node_modules/dsh-interrupted-dot` 指向该目录。

## 测试

```bash
node --test test/host.test.js test/client.test.js
```

覆盖：结局分类、子智能体过滤、`turn/start` 清标记、索引上限、路由；客户端的
重连窗口判定、正常收尾不改色、宿主报错染红、重新开跑恢复、空闲会话不加点、
主视图清理、React 换点后重画。
