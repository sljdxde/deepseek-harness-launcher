# Bug 分析：菜单「会话完成」点进去，浏览器没有跳到该会话

> 影响版本：v0.3.1 - v0.3.10（`BrowserAutomationSupport` 建起来之后一直如此）
> 修复状态：本地修复，未提测

## 一、现象

菜单栏「会话完成」区块里点某条提醒，期望是**在已打开的 Harness 标签页里直接看到那个会话**。
实际经常「没反应」：Chrome 被切到前台，但停在用户原来那个标签页（常常是别的网页），
Harness 标签页在后台悄悄换了会话，用户以为没跳。

## 二、日志证据

`~/Library/Logs/Deepseek Harness Launcher/dhl.log`，统计整个文件：

```console
$ grep -c "未找到匹配标签页" dhl.log
9
$ grep -c "已定位并前置 Harness 标签页" dhl.log
0
```

**9 次点击、9 次「未找到匹配标签页」，0 次成功。** 也就是说「精确选中已有标签」
这个能力自上线以来一次都没生效过，每次都退化成「只前置浏览器」：

```
[15:29:51] 用户查看会话完成提醒：session-f5fdfff1-…
[15:29:51] 检测到 Google Chrome 已连接 Harness 端口 3080，但未找到匹配标签页；已前置浏览器
```

## 三、原因分析

`BrowserAutomationSupport.tabScript` 用 **整串 URL 相等** 匹配标签页：

```applescript
if targetURLs contains (URL of browserTab as text) then   -- 列表里是
                                                          -- http://127.0.0.1:3080/ 等整串
```

而浏览器里那张标签页的地址几乎不可能是干净的根地址：

| 来源 | 标签页真实 URL |
|------|----------------|
| dsh 0.1.5-rc.2+ 入口行 `dsh web: http://127.0.0.1:<port>/?token=…` | `…/?token=…`（token 换 cookie 前就是它） |
| 客户端留下 `#` 片段 / 尾斜杠差异 | `…#/…`、`…`（无尾斜杠） |
| 手工输入 `localhost` / `[::1]` | 别的 authority 写法 |

整串比较对上述任何一种都不成立 → `missing` → 调用方只 `browser.activate()`：
Chrome 切到前台，但显示的是**它自己当前那个标签**。会话本身其实换成功了
（插件 `/commands` 的 claim/ack 链路正常，插件侧 `viewed` 事件证明客户端已切到目标会话），
用户看到的是「切了浏览器、没切会话」。

### 为什么「会话本身是对的」

同一批点击在插件事件流里都能看到 1-7 秒后目标会话的 `viewed` 记录：

```console
13:42:01 点击 session-b536ad48 → 13:42:02 viewed session-b536ad48
14:16:11 点击 session-a8193f3e → 14:16:13 viewed session-a8193f3e
14:28:01 点击 session-a8193f3e → 14:28:03 viewed session-a8193f3e
```

说明链路里坏的只有「选中标签」这一步，`/dsh-session-notify/open` → claim → `uiWorkspace.openSession`
是通的。所以修复只能落在标签匹配上，不必动插件协议。

## 四、修复

1. **匹配改为按 origin**（`scheme://host:port`，不带尾斜杠）：
   标签 URL 必须等于 origin，或以 `origin + / ? #` 开头才算命中。
   这样 `?token=…`、`#…`、尾斜杠、localhost/[::1]/127.0.0.1 全都命中，
   而 `:30800` 这种「前缀陷阱」不会被误判。
2. **失败留下证据**：脚本在没命中时把浏览器自己报出来的标签页地址带回启动器
   （`missing` + 每行一个 URL，最多 4 条），启动器写进日志：
   `…但未找到匹配标签页（2 个已开标签：http://127.0.0.1:3080/?token=… | …）；已前置浏览器`。
   下次再出问题，从日志就能直接看出浏览器当时开的是什么。
3. **跳转请求的送达结果也进日志**：`POST /dsh-session-notify/open` 非 200（外部 Harness、
   旧插件、插件未加载）时写一行，避免「点了没跳」完全无痕。
4. 重启接管的「关闭旧标签页」复用同一套匹配，同样从整串比较改为 origin 比较。

## 四之二、第二个根因：同一浏览器跑着多个实例（环境侧，尚未根治）

修好 URL 匹配后仍然复现，实测发现这台机器上 `com.google.Chrome` 有**两个实例**：

```console
$ lsappinfo list | grep -A4 '"Google Chrome"'
 pid = 711  type="Foreground"                       # 用户自己的 Chrome（2 天）
 pid = 661  type="BackgroundOnly"                    # agent-browser 常驻的自动化 Chrome
```

- `lsof` 命中的是 711（它才连到 3080）；
- 但 `tell application id "com.google.Chrome"` 只把事件发给**最近启动**的那个实例，
  也就是 661（自动化浏览器，标签页里根本没有 Harness 页面）；
- 先 `activate` 711 再发事件也没用（实测两种顺序都返回同一批标签）；
  这是 macOS / Chrome 的限制，不是参数问题。

实测证据（AE 枚举到的标签）：

```console
pid 711 (用户 Chrome, 2 天) : 前/后各激活一次，AE 仍返回 661 的两个标签
AE 返回的标签            : chrome://newtab/ | http://127.0.0.1:8931/原型-…html
```

`agent-browser` 是**常驻 daemon**（PID 7898，已跑 2 天），它拉起的 Chrome 会一直在，
所以这不再是偶发：只要它活着，标签定位就必然落空。

现在的处置：启动器把「实例数」写进日志（`…有 2 个实例在运行，AppleScript 只会发给
最近启动的那个，页面可能在另一个实例里`），不再让「未找到匹配标签页」冒充「页面没开」。

### 已知的平台限制

- 按 PID 定向的 Apple Event **可行**（实测 `GURL` 事件能精确投递到指定实例），
  但它只能打开**新标签页**，不会复用/选中已有标签；
- 选中已有标签只能走 AppleScript（受上述实例寻址限制）或 Accessibility API
  （需要给启动器开「辅助功能」权限，与当前只用「自动化」权限的设计冲突）；
- 手写 Chrome 的 AEOM（`obj ` 对象说明符 + `getd`/`setd`）理论可行，实测未跑通，
  且完全无法单测，暂不采用。

## 五、回归验证清单

1. Chrome 只开一个 Harness 标签 → 菜单点完成提醒 → **该标签被选中并切到对应会话**，
   日志出现「已定位并前置 Harness 标签页」（不再出现「未找到匹配标签页」）；
2. Harness 标签在后台、前台是别的网页 → 点提醒 → Chrome 前台显示的是 Harness 标签，
   且是该会话；
3. 标签地址手动改成 `localhost:3080` 或 `127.0.0.1:3080`（无尾斜杠）→ 仍能选中；
4. 有重复 Harness 标签时只选中最前面那一个（`windowIndex is not 1` 时把窗口提到最前）；
5. 关闭标签页后点提醒 → 走 presence 心跳路径重新开页面（原有行为不变）；
6. 重启接管（更新 dsh 后）→ 旧标签被关闭、新页面打开（close 走同一 origin 匹配）；
7. 多实例环境（agent-browser 常驻）→ 日志出现实例数提示，且会话本身仍被切到。
