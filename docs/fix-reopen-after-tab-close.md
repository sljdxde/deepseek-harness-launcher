# Bug 分析：关闭 Harness 页面后，菜单「打开」无法重新打开页面

> 影响版本：v0.3.1（ee3e13b）及更早
> 修复状态：已合入 main（ce0bc57 起，即 `0.3.2-1.1-SNAPSHOT`），随 0.3.2 发布

## 一、现象

在浏览器里关闭 Deepseek Harness 的标签页后，再点菜单栏的
「打开 Deepseek Harness」（或全局热键），launcher 只把浏览器调到前台，
**不会重新打开页面**，看起来就像「打开」失灵了。

日志（`~/Library/Logs/Deepseek Harness Launcher/dhl.log`）特征：

```
检测到 Google Chrome 已连接 Harness 端口 3080，已定位并前置 Harness 标签页   ← 页面还在时，正常
检测到 Google Chrome 已连接 Harness 端口 3080，但未找到匹配标签页；已前置浏览器 ← 关闭页面后，只前置不开页
```

## 二、原因分析

### 1. socket 探测被 Chrome keep-alive 骗过

菜单「打开」的判定链路（`openWebPage`）第一步是 `lsof` 探测端口 3080 上
有哪些客户端连接，再沿进程父子链定位浏览器主进程。问题在于：**标签页关闭
后，Chrome 的 keep-alive 连接不会立即消失**，会在 `CLOSED` 状态悬挂一段时间：

```
Google  28512 ... TCP 127.0.0.1:55358->127.0.0.1:3080 (CLOSED)
```

这条残留连接让 launcher 误判「页面还开着」，于是走「已连接浏览器」分支：
先用 Apple Events 定位 Harness 标签页 → 找不到（已关闭）→ 降级为仅
`browser.activate()` 前置浏览器，不重开 URL（避免在页面真的开着时开出
重复标签页——这正是该启发式的设计初衷）。

### 2. v0.3.1 缺少 presence 心跳兜底

纯 socket 启发式天然分不清「页面开着」和「连接残留」。正确的修正手段是
心跳：注入页面的客户端在页面存活期间定期上报，launcher 打开前先查心跳，
心跳没了就说明页面真的全关了，直接重开页面。

该机制（`/dsh-session-notify/presence`）在 v0.3.1 中**不存在**，实测证据：

```console
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/dsh-session-notify/presence
404                                        # 运行中的后端没有这个路由
$ grep -c presence <安装包>/DSHSessionNotify/lib/index.js
0                                          # 插件侧无心跳实现
$ strings <安装包>/Contents/MacOS/DHL | grep -c presence
0                                          # launcher 侧无心跳查询
```

对比之下，同插件的 `/events`、`/commands`、`/open` 路由均正常（200/405），
排除了「插件没加载」的可能——就是路由本身缺失。

> 注：launcher 对「心跳接口不存在」（外部 Harness / 旧版插件）有意保留了
> 「有连接就前置」的降级行为（`BrowserConnectionSupport.presenceActive`
> 返回 nil 时不改变行为）。缺陷在于自带插件自己也没提供心跳，降级路径
> 成了唯一路径。

## 三、修复状态（已合入 main，未发布）

`v0.3.1..HEAD`（16 个文件，+393 行）实现了完整修复：

| 侧 | 改动 | 作用 |
|----|------|------|
| 注入客户端 | `DSHSessionNotify/client/client.js` 心跳上报 | 页面存活期间维持 presence |
| 插件 | `lib/index.js` 新增 `GET /dsh-session-notify/presence`、`POST /presence/bye` | 汇总心跳，页面关闭（含 `pagehide`）即失效 |
| launcher | `main.swift` `openWebPage` 先查 `pagePresence` | `active=false` → 直接重开页面（日志「Harness 页面已全部关闭，重新打开页面」）；nil → 维持降级 |
| launcher | `BrowserConnectionSupport.presenceActive` | 心跳响应解析 |

修复后行为：关闭标签页 → 心跳停止（`bye` 上报 + 心跳超时双保险）→
点「打开」→ 不再信任残留 socket，直接重开页面。

**注意：修复需要 launcher 二进制与插件两侧同时更新**，只热替换插件一侧
没有效果（旧 launcher 不会查询 presence），反之亦然。因此无法在已装的
v0.3.1 上单独打补丁，需等待 0.3.2 发布。

## 四、0.3.2 发布前的临时恢复

后端（dsh web）与页面是否打开无关，一直在运行，所以最简单的恢复方式是
**在浏览器地址栏手动输入**：

```
http://127.0.0.1:3080/
```

退出并重启 launcher 无效——重启后的「打开」仍走同一条被残留连接欺骗的
判定路径。

## 五、回归验证清单（0.3.2 提测时）

1. 打开 Harness 页面 → 点「打开」→ 应定位并前置现有标签页（不重复开页）；
2. 关闭 Harness 标签页 → 立即点「打开」→ 应重新打开页面；
3. 关闭 Harness 标签页 → 等 60 秒以上再点「打开」→ 应重新打开页面
   （覆盖 keep-alive 长悬挂场景）；
4. 关闭整个浏览器 → 点「打开」→ 应重新打开页面；
5. 启动后首次自动打开、2 秒冷却节流行为不变（`shouldDefer` 回归）。
