# CODING_STANDARDS.md

评审（review）阶段读这份文件：它只放**没法用脚本卡住**的判断规则。能机械检查的
东西都在 `scripts/test.sh` 里，不在这里重复（重复的规则会漂移）。

## 1. 断言要落在行为上，不落在源码文本上

新增或修改的行为，必须有「构造对象 → 断言输出」的断言。`rg` 字符串断言只允许用于
不变量：

- 某符号只许出现一次（例如 `--no-package-lock` 只能出现在回退路径）；
- 旧符号必须消失（例如 `makeSessionNotifyBadgeImage` 必须搬进 `StatusBadgeSupport`）；
- 某段文案只许在某个文件里定义（例如菜单标题只在 `LauncherMenuTitle`）。

判据：把实现改写成等价但不同写法的代码，这条断言还过不过？如果会假红，它是文本
断言；如果行为坏了它还能过（注释里出现同一个词、分支根本走不到），它什么也没守住。

历史反例：`rg -Fq 'skippedLauncherVersion'` 在「装前就清空跳过记录」的 bug 下照样通过。

## 2. 可测试逻辑不进 `Sources/main.swift`

`main.swift` 是唯一的 App 主类，约 2700 行，测试二进制没法加载它（顶层代码 + AppKit
启动），所以写进去的逻辑只能靠 grep 字符串断言——按第 1 条那是无效验证。

菜单标题、状态决策、调度参数、版本口径、跳过记录规则，一律抽成 `Sources/*Support.swift`
里的纯函数（`LauncherMenuTitle`、`LauncherUpdatePolicy`、`AutoUpdateSchedule`、
`DSHUpdatePlanner` 是既有先例），`main.swift` 只负责接线。

## 3. 中英 README 同改

`README.md` 与 `README.en.md` 是同一份内容的两份手写副本。`scripts/test.sh` 已断言
两份文件的二级标题数、三级标题数与表格行数相等；新增一节、加一行表格，必须同时落到
两份文件上（英文跟随中文，不反过来）。

## 4. 手动验收清单保持无编号

`TESTING.md` 的验收条目是 `- [ ]` 勾选清单，不是编号列表：插入一条不该引起全文重排，
也不该出现「见第 22 条」这类按编号的交叉引用。

## 已自动化，不必在此重复

`scripts/test.sh` 覆盖：版本号格式与两处 plist 一致、源码不变量、`// MARK:` 分区齐全、
中英 README 结构相等、文档里不许用 `~` 写区间、`skippedLauncherVersion` 只许两处清空。
