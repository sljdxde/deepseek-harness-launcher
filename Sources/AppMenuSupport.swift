import AppKit

/// 启动器变成「常规 App（Dock 有图标、有窗口）」后必须有的主菜单。
///
/// 为什么必须有：AppKit 的键盘快捷键（⌘C/⌘V/⌘Z/⌘A、⌘W、⌘Q…）是**菜单项**
/// 驱动的，不是窗口自带的。`LSUIElement` 菜单栏 App 没有主菜单也能用，因为它
/// 没有可编辑的窗口；一旦内置 Harness 窗口（WKWebView）成为主界面，没有「编辑」
/// 菜单就等于：输入框能打字，但 ⌘C/⌘V 全部失效。
///
/// 这里只声明标准菜单结构；`target` 与 App 专属 action 由 `main.swift` 传入，
/// 便于在测试二进制里断言「编辑菜单存在且快捷键正确」。
struct AppMenuActions {
    let quit: Selector
    let settings: Selector
    let openLogs: Selector
    let reloadPage: Selector
    let openHarnessWindow: Selector
}

enum AppMenuSupport {
    static let editSelectors = ["undo:", "redo:", "cut:", "copy:", "paste:", "delete:", "selectAll:"]

    /// 主菜单：应用 / 编辑 / 显示 / 窗口。
    ///
    /// 编辑菜单项**不设 target**：它们必须沿 responder chain 找到当前第一响应者
    /// （WKWebView 内部的编辑控件），指定 target 会把复制粘贴抢到启动器身上。
    static func makeMainMenu(appName: String, actions: AppMenuActions, target: AnyObject) -> NSMenu {
        let mainMenu = NSMenu()

        // 应用菜单
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu(title: appName)
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于 \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settingsItem = appMenu.addItem(withTitle: "设置…", action: actions.settings, keyEquivalent: ",")
        settingsItem.target = target
        appMenu.addItem(.separator())
        let quitItem = appMenu.addItem(withTitle: "退出 \(appName)", action: actions.quit, keyEquivalent: "q")
        quitItem.target = target

        // 编辑菜单（复制/粘贴/撤销必须沿响应链走）
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "编辑")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "撤销", action: NSSelectorFromString("undo:"), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "重做", action: NSSelectorFromString("redo:"), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: NSSelectorFromString("cut:"), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: NSSelectorFromString("copy:"), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: NSSelectorFromString("paste:"), keyEquivalent: "v")
        editMenu.addItem(withTitle: "删除", action: NSSelectorFromString("delete:"), keyEquivalent: "")
        editMenu.addItem(withTitle: "全选", action: NSSelectorFromString("selectAll:"), keyEquivalent: "a")

        // 显示菜单
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "显示")
        viewMenuItem.submenu = viewMenu
        let reload = viewMenu.addItem(withTitle: "重新载入 Harness 页面", action: actions.reloadPage, keyEquivalent: "r")
        reload.target = target
        let logs = viewMenu.addItem(withTitle: "打开日志", action: actions.openLogs, keyEquivalent: "l")
        logs.target = target

        // 窗口菜单
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "窗口")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "关闭", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(.separator())
        let open = windowMenu.addItem(withTitle: "打开 Harness 窗口", action: actions.openHarnessWindow, keyEquivalent: "o")
        open.target = target

        return mainMenu
    }
}