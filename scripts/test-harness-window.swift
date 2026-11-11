import AppKit
import Foundation

// 内置 Harness 窗口（WKWebView）的决策层单测。
//
// 这条链路替代了「用 AppleScript 在浏览器里选中标签页」：那条路在多浏览器实例
// 环境下永远选不中，只能新开标签页，用户看到的就是「点已完成任务又开一个窗口」。
// 内置窗口没有标签页可匹配，但决策仍然会坏——所以把判断放在
// `HarnessWindowSupport`，这里逐条锁死：
//   1. 打开/重载/只前置：端口、token 入口、强制重载（dsh 重启）三种触发；
//   2. 外链与同源导航：只有 loopback + 当前端口留在窗口内，其它一律外开；
//   3. 下载落点：文件名清洗、重名不覆盖、扩展名保留；
//   4. 失败兜底页 / 401 文案：可读、有下一步动作；
//   5. 主菜单：编辑菜单存在且快捷键正确（WKWebView 的 ⌘C/⌘V 靠它）。
//
// 编译：swiftc scripts/test-harness-window.swift Sources/HarnessWindowSupport.swift \
//        Sources/AppMenuSupport.swift -o /tmp/test-harness-window -framework AppKit

@main
struct HarnessWindowChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func checkEqual<T: Equatable>(_ actual: T, _ expected: T, _ label: String) {
        if actual != expected { failures.append("\(label)：期望 \(expected)，实际 \(actual)") }
    }

    static func url(_ string: String) -> URL {
        guard let url = URL(string: string) else {
            failures.append("测试 URL 非法：\(string)")
            return URL(fileURLWithPath: "/")
        }
        return url
    }

    static func main() {
        let entry = url("http://127.0.0.1:3080/?token=abc")
        let samePortBare = url("http://127.0.0.1:3080/")

        // MARK: - 1. 打开 / 重载 / 只前置
        func context(
            isRunning: Bool = true,
            targetPort: Int? = 3080,
            windowExists: Bool = true,
            loadedPort: Int? = 3080,
            loadedEntryURL: URL? = url("http://127.0.0.1:3080/?token=abc")
        ) -> HarnessWindowSupport.Context {
            HarnessWindowSupport.Context(
                isRunning: isRunning,
                targetPort: targetPort,
                windowExists: windowExists,
                loadedPort: loadedPort,
                loadedEntryURL: loadedEntryURL
            )
        }

        checkEqual(
            HarnessWindowSupport.action(context: context(isRunning: false), entryURL: entry, forceReload: false),
            .waitForRuntime, "dsh 没在跑：必须先启动，不能对着空端口开窗口"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(targetPort: nil), entryURL: entry, forceReload: false),
            .waitForRuntime, "没有端口：等同没就绪"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(), entryURL: nil, forceReload: false),
            .waitForRuntime, "拿不到入口 URL：等，不要开一张空白页"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(windowExists: false, loadedPort: nil, loadedEntryURL: nil), entryURL: entry, forceReload: false),
            .openAndLoad(entry), "第一次打开：新建窗口并加载"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(), entryURL: entry, forceReload: false),
            .showOnly, "同一端口 + 同一个入口：只前置，不重载（重载会打断正在跑的回合）"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(), entryURL: samePortBare, forceReload: false),
            .showAndLoad(samePortBare),
            "入口 URL 变了（token 更新）：必须重载，不能把旧 token 页留在眼前"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(loadedPort: 3081, loadedEntryURL: url("http://127.0.0.1:3081/?token=old")), entryURL: entry, forceReload: false),
            .showAndLoad(entry), "端口变了（换实例）：必须重载"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(), entryURL: entry, forceReload: true),
            .showAndLoad(entry), "dsh 重启：强制用新入口重载"
        )
        checkEqual(
            HarnessWindowSupport.action(context: context(loadedEntryURL: nil), entryURL: entry, forceReload: false),
            .showAndLoad(entry), "不知道旧页面用的哪个入口：宁可重载一次，也不留 401 页"
        )

        // MARK: - 2. 链接与导航
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("http://127.0.0.1:3080/#/session/1"), harnessPort: 3080),
            .inWindow, "同端口 SPA 路由留在窗口内"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("http://localhost:3080/x"), harnessPort: 3080),
            .inWindow, "localhost 与 127.0.0.1 等价"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("http://[::1]:3080/x"), harnessPort: 3080),
            .inWindow, "IPv6 loopback 也算本机"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("http://127.0.0.1:3081/x"), harnessPort: 3080),
            .external, "同主机不同端口：外开（窗口不该变成通用浏览器）"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("https://deepseek.com/x"), harnessPort: 3080),
            .external, "外站外开"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("mailto:a@b.com"), harnessPort: 3080),
            .external, "mailto 外开"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("file:///etc/hosts"), harnessPort: 3080),
            .external, "file: 外开"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("http://127.0.0.1/x"), harnessPort: 80),
            .inWindow, "省略端口按 http 默认 80 处理"
        )
        checkEqual(
            HarnessWindowSupport.linkAction(url: url("about:blank"), harnessPort: 3080),
            .inWindow, "兜底页的 about:blank 必须留在窗口内（否则 401 页会被外链规则取消成白屏）"
        )

        checkEqual(
            HarnessWindowSupport.navigationRedirect(url: url("https://example.com"), harnessPort: 3080, frameIsMainFrame: true),
            url("https://example.com"), "主框架外链改道系统浏览器"
        )
        check(nil == HarnessWindowSupport.navigationRedirect(url: url("https://example.com"), harnessPort: 3080, frameIsMainFrame: false), "iframe 外链不改道（插件内嵌面板依赖）")
        check(nil == HarnessWindowSupport.navigationRedirect(url: url("http://127.0.0.1:3080/x"), harnessPort: 3080, frameIsMainFrame: true), "同源主框架导航放行")

        // MARK: - 3. 下载落点
        let downloads = URL(fileURLWithPath: "/Users/tester/Downloads")
        var existing = Set<String>()
        let first = HarnessWindowSupport.downloadDestination(
            directory: downloads, suggestedFilename: "报告.pdf", fileExists: { existing.contains($0.path) }
        )
        checkEqual(first.lastPathComponent, "报告.pdf", "普通文件名保持原样")
        existing.insert(first.path)
        let second = HarnessWindowSupport.downloadDestination(
            directory: downloads, suggestedFilename: "报告.pdf", fileExists: { existing.contains($0.path) }
        )
        checkEqual(second.lastPathComponent, "报告 (1).pdf", "重名不覆盖，插序号并保留扩展名")
        existing.insert(second.path)
        let third = HarnessWindowSupport.downloadDestination(
            directory: downloads, suggestedFilename: "报告.pdf", fileExists: { existing.contains($0.path) }
        )
        checkEqual(third.lastPathComponent, "报告 (2).pdf", "连续重名继续递增")

        checkEqual(
            HarnessWindowSupport.sanitizedFilename("../../etc/passwd"), "_.._etc_passwd",
            "路径分隔符必须清洗，不能落成全盘路径"
        )
        checkEqual(
            HarnessWindowSupport.sanitizedFilename("  bad:name\n"), "bad_name",
            "冒号/控制字符/首尾空白清洗"
        )
        checkEqual(HarnessWindowSupport.sanitizedFilename("..."), "download", "纯点号回退到默认名")
        checkEqual(HarnessWindowSupport.sanitizedFilename(""), "download", "空名回退到默认名")
        checkEqual(HarnessWindowSupport.sanitizedFilename(nil), "download", "缺名回退到默认名")
        let longName = String(repeating: "a", count: 300) + ".tar.gz"
        let sanitizedLong = HarnessWindowSupport.sanitizedFilename(longName)
        check(sanitizedLong.count <= 120, "超长文件名必须截断（实际 \(sanitizedLong.count)）")
        check(sanitizedLong.hasSuffix(".gz"), "截断后仍保留扩展名")
        check(!sanitizedLong.contains("/"), "截断后不得含路径分隔符")

        // MARK: - 4. 失败页与 401
        let failure = HarnessWindowSupport.failureHTML(
            message: "Harness 页面打不开",
            detail: "<script>alert(1)</script>"
        )
        check(failure.contains("Harness 页面打不开"), "失败页要有标题")
        check(failure.contains("&lt;script&gt;"), "插入正文必须转义，不能把页面源码当 HTML 执行")
        check(!failure.contains("<script>alert"), "原始标签不得进入 HTML")
        check(failure.contains("浏览器"), "失败页必须给出「改用浏览器」的下一步")
        check(failure.contains("重启 Deepseek Harness"), "失败页必须给出让启动器接管的下一步")
        checkEqual(HarnessWindowSupport.authenticationFailureMessage, "Harness 页面要求认证", "401 文案稳定")

        // MARK: - 5. 主菜单
        let actions = AppMenuActions(
            quit: NSSelectorFromString("quit:"),
            settings: NSSelectorFromString("openSettings:"),
            openLogs: NSSelectorFromString("openLogs:"),
            reloadPage: NSSelectorFromString("reloadHarnessWindow:"),
            openHarnessWindow: NSSelectorFromString("openDHL:")
        )
        let target = NSObject()
        let menu = AppMenuSupport.makeMainMenu(appName: "Deepseek Harness Launcher", actions: actions, target: target)
        // 顶层 NSMenuItem 的 title 在程序化构建时是占位值，真正显示的是 submenu 标题。
        let titles = menu.items.map { $0.submenu?.title ?? "" }
        checkEqual(titles, ["Deepseek Harness Launcher", "编辑", "显示", "窗口"], "主菜单四段（应用/编辑/显示/窗口）")
        let appMenu = menu.items.first?.submenu
        check(appMenu?.items.contains(where: { $0.title.hasPrefix("退出") && $0.keyEquivalent == "q" }) == true, "应用菜单必须有 ⌘Q 退出")
        check(appMenu?.items.contains(where: { $0.title == "设置…" && $0.keyEquivalent == "," }) == true, "应用菜单必须有 ⌘, 设置")
        let editMenu = menu.items.count > 1 ? menu.items[1].submenu : nil
        let editSelectors = editMenu?.items.filter { !$0.isSeparatorItem }.map { $0.action.map(NSStringFromSelector) ?? "" }
        checkEqual(editSelectors, AppMenuSupport.editSelectors, "编辑菜单的复制/粘贴/撤销必须沿响应链（selector 完整）")
        check(editMenu?.items.contains(where: { $0.keyEquivalent == "c" && $0.action == NSSelectorFromString("copy:") }) == true, "⌘C 必须存在")
        check(editMenu?.items.contains(where: { $0.keyEquivalent == "v" && $0.action == NSSelectorFromString("paste:") }) == true, "⌘V 必须存在")
        check(editMenu?.items.allSatisfy({ $0.target == nil }) == true, "编辑菜单项不得指定 target（否则复制粘贴被启动器截走）")
        let windowMenu = menu.items.last?.submenu
        check(windowMenu?.items.contains(where: { $0.title == "打开 Harness 窗口" && $0.keyEquivalent == "o" }) == true, "窗口菜单必须有 ⌘O 打开界面")

        if failures.isEmpty {
            print("test-harness-window: ok")
        } else {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
    }
}