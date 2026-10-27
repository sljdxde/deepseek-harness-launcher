Label: wayfinder:research

## Question

macOS 版 DHL 的 7 处 OS 粘合与 AppKit 外壳，在 Windows 上的原生等价机制各自成不成立、成熟度如何？逐项查证，产出一张"macOS 机制 → Windows 机制 → 可行性/坑"的映射表。

需查证（以一手来源为准：MSDN/Win32 API 文档）：
- 菜单栏状态项 → Win32 NotifyIcon（托盘）/ 各壳的 tray 能力；unread 角标绘制与覆盖。
- Carbon RegisterEventHotKey → Win32 `RegisterHotKey`（全局快捷键录制 UI 的等价物）。
- LaunchAgent → 注册表 `HKCU\...\Run` / 任务计划程序 / 启动文件夹：免提权与否、卸载清理。
- DMG+hdiutil 自更新 → Windows 无签名条件下可行形态：MSI 静默更新、exe 自替换（ren/restart 套路）、便携 ZIP 整目录替换；各自坑。
- NSAppleScript 浏览器标签选中/前置 → **Windows 有无任何可靠等价**（无 Apple Events；Chrome DevTools 协议？UI Automation？）——这是全对等清单里风险最高的一项，要给明确结论与降级口径建议。
- NSWorkspace 浏览器检测 → Win32 进程枚举 / 注册表 App Paths；`open -a` → ShellExecute。
- lsof/ps + 进程组 SIGTERM/SIGKILL → tasklist/WMIC 弃用问题、`TerminateProcess`、Job Object 做进程组级联终止；BSD socket 端口扫描 → Winsock 等价。
- `~/.dsh` / `~/Library/Logs` 路径惯例 → `%APPDATA%/%LOCALAPPDATA%` 对应选择。

## Blocked by

_（无）_
