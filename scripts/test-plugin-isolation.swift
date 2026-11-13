import Foundation

// 用户停用插件：启动参数与 --patch overlay（见 Sources/PluginIsolationSupport.swift）。
//
// 历史上这里还覆盖「崩溃隔离 / stderr 归因 / 逐个排除 / 安全模式 / 启动前静态
// 预检」，那套机制整体下线后主流程 0 调用，已连同实现一起删除。现在只锁住
// 主流程真会走的两条链路：拼启动参数、读停用状态并渲染 overlay。
//
// 编译：swiftc scripts/test-plugin-isolation.swift Sources/PluginIsolationSupport.swift

@main
struct PluginIsolationTests {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func checkEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String) {
        check(actual == expected, "\(message)（实际：\(actual)，期望：\(expected)）")
    }

    static func main() throws {
        let support = PluginIsolationSupport.self
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("dhl-plugin-disabled-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }

        // MARK: - 启动参数

        checkEqual(
            support.bootArguments(port: 3080, basePatch: nil, disabledPatch: nil),
            ["web", "--no-open", "--port", "3080"],
            "没有 patch 时与历史命令逐字节一致"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/base.yml", disabledPatch: nil),
            ["web", "--patch", "/base.yml", "--no-open", "--port", "3080"],
            "只带内置插件 patch"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/base.yml", disabledPatch: "/disabled.yml"),
            ["web", "--patch", "/base.yml", "--patch", "/disabled.yml", "--no-open", "--port", "3080"],
            "用户停用层排在最后（最后应用优先级最高）"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: "", disabledPatch: "/disabled.yml"),
            ["web", "--patch", "/disabled.yml", "--no-open", "--port", "3080"],
            "空路径不能递给 dsh"
        )

        // MARK: - 路径与白名单

        let home = root.appendingPathComponent("dsh", isDirectory: true)
        checkEqual(
            support.disabledStateURL(home: home).path,
            home.appendingPathComponent("plugin-manager/disabled.json").path,
            "停用状态落点"
        )
        checkEqual(
            support.disabledPatchDirectory(home: home).path,
            home.appendingPathComponent("plugin-manager", isDirectory: true).path,
            "overlay 落点"
        )
        check(support.undisableableBundles.contains("@deepseek-ai/dsh-base"), "core 不许停用")
        check(support.undisableableBundles.contains("dsh-plugin-manager"), "插件管理器自身不许停用")
        check(!support.undisableableBundles.contains("dsh-session-notify"), "内置通知插件仍允许用户主动停用")
        check(support.isSafeRowId("dsh-context"), "合法行 id")
        check(!support.isSafeRowId("bad id\n- id: injected"), "换行/空格不能进 YAML")
        check(support.isSafeBundleName("@scope/pkg"), "合法 bundle 名")
        check(!support.isSafeBundleName("../evil"), "拒绝路径穿越")

        // MARK: - 读停用状态

        let stateURL = support.disabledStateURL(home: home)
        func writeState(_ body: String) {
            try? fm.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? body.write(to: stateURL, atomically: true, encoding: .utf8)
        }
        func readState() -> [PluginIsolationSupport.DisabledPlugin] {
            support.readDisabledState(url: stateURL)
        }

        check(readState().isEmpty, "状态文件不存在时按「没有停用」处理")
        writeState("not json")
        check(readState().isEmpty, "畸形 JSON 不能让启动器变成故障源")

        writeState("""
        {"version":1,"updatedAt":"2026-11-12","disabled":[
          {"bundle":"dsh-context","rowIds":["dsh-context","bad id"],"disabledAt":"2026-11-12"},
          {"bundle":"dsh-context","rowIds":["dup"],"disabledAt":null},
          {"bundle":"@deepseek-ai/dsh-base","rowIds":["core"],"disabledAt":null},
          {"bundle":"../evil","rowIds":["evil"],"disabledAt":null},
          {"bundle":"dsh-empty","rowIds":["bad id"],"disabledAt":null},
          {"bundle":"dsh-guizang-design","rowIds":["dsh-guizang-design","dsh-context"],"disabledAt":null}
        ]}
        """)
        let entries = readState()
        checkEqual(
            entries.map(\.bundle), ["dsh-context", "dsh-guizang-design"],
            "去重、过滤不可停用/非法 bundle/无合法行 id 的条目"
        )
        checkEqual(entries[0].rowIds, ["dsh-context"], "行 id 也过滤非法字符")
        checkEqual(entries[1].rowIds, ["dsh-guizang-design", "dsh-context"], "合法行 id 全保留")

        // MARK: - overlay 渲染与落盘

        let expectedPatch = "- id: dsh-context\n  disabled: true\n- id: dsh-guizang-design\n  disabled: true\n"
        checkEqual(
            support.renderCombinedDisabledPatch(disabled: entries), expectedPatch,
            "按行 id 去重，输出顶格 YAML 列表"
        )
        checkEqual(support.renderCombinedDisabledPatch(disabled: []), "", "没有停用项时返回空串")
        let coreOnly = [PluginIsolationSupport.DisabledPlugin(bundle: "@deepseek-ai/dsh-base", rowIds: ["core"], disabledAt: nil)]
        checkEqual(support.renderCombinedDisabledPatch(disabled: coreOnly), "", "不可停用的 bundle 不进 overlay")

        let directory = support.disabledPatchDirectory(home: home)
        check(support.stagedDisabledPatchFile(disabled: [], directory: directory) == nil, "没有停用项时不产出 overlay")
        let staged = support.stagedDisabledPatchFile(disabled: entries, directory: directory)
        checkEqual(staged?.lastPathComponent ?? "nil", support.disabledPatchFileName, "有停用项时产出 overlay 文件")
        checkEqual(
            (staged.flatMap { try? String(contentsOf: $0, encoding: .utf8) }) ?? "",
            expectedPatch,
            "overlay 是可被 dsh 解析的顶格 YAML 列表"
        )
        check(
            support.stagedDisabledPatchFile(disabled: entries, directory: URL(fileURLWithPath: "/System/Library/CoreFinder/x")) == nil,
            "写不进去时返回 nil（宁可不停用，也不递半截文件给 dsh）"
        )

        if !failures.isEmpty {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
        print("plugin isolation checks passed")
    }
}
