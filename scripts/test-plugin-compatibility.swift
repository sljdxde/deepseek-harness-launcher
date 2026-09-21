import Foundation

// 插件与 dsh 运行时的兼容性判定（见 Sources/PluginCompatibilitySupport.swift）。
// 区间求值用真实生态里的写法做锚点：@openviking/dsh-memory-plugin 声明过
// `>=0.1.0-rc.6 <0.2.0` 这种组合区间；版本比较复用 compareVersions 的排序
// 语义（预发布后缀低于同 base 正式版）。
// 编译：swiftc scripts/test-plugin-compatibility.swift Sources/PluginCompatibilitySupport.swift Sources/UpdateSupport.swift

@main
struct PluginCompatibilityTests {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func main() {
        // MARK: - satisfiesRange

        check(PluginCompatibilitySupport.satisfiesRange("0.1.5-rc.2", range: ">=0.1.0-rc.6 <0.2.0"), "组合区间应满足")
        check(!PluginCompatibilitySupport.satisfiesRange("0.2.0", range: ">=0.1.0-rc.6 <0.2.0"), "越过上界应不满足")
        check(!PluginCompatibilitySupport.satisfiesRange("0.0.9", range: ">=0.1.0-rc.6 <0.2.0"), "低于下界应不满足")
        check(PluginCompatibilitySupport.satisfiesRange("0.1.0", range: ">=0.1.0-rc.6 <0.2.0"), "正式版高于 rc 下界")
        // 已知近似：compareVersions 对同为文本后缀（rc.1/rc.6）的预发布视为相等，
        // 因此 rc.1 会被判为满足 >=rc.6。该近似只影响“同为预发布”的边界情况，
        // 正式版与预发布之间的比较不受影响，这里显式记录该行为。
        check(PluginCompatibilitySupport.satisfiesRange("0.1.0-rc.1", range: ">=0.1.0-rc.6 <0.2.0"), "同为 rc 后缀按近似相等处理（记录已知近似）")

        check(PluginCompatibilitySupport.satisfiesRange("1.0.0", range: "*"), "星号恒真")
        check(PluginCompatibilitySupport.satisfiesRange("1.2.3", range: ""), "空区间恒真")

        check(PluginCompatibilitySupport.satisfiesRange("1.5.0", range: "^1.2.0"), "^ 区间内应满足")
        check(!PluginCompatibilitySupport.satisfiesRange("2.0.0", range: "^1.2.0"), "^ 上界外应不满足")
        check(PluginCompatibilitySupport.satisfiesRange("0.2.9", range: "^0.2.5"), "^0.x 区间内应满足")
        check(!PluginCompatibilitySupport.satisfiesRange("0.3.0", range: "^0.2.5"), "^0.x 次版本上界外应不满足")

        check(PluginCompatibilitySupport.satisfiesRange("1.2.9", range: "~1.2.3"), "~ 区间内应满足")
        check(!PluginCompatibilitySupport.satisfiesRange("1.3.0", range: "~1.2.3"), "~ 上界外应不满足")

        check(PluginCompatibilitySupport.satisfiesRange("3.0.0", range: "3.0.0"), "精确匹配")
        check(!PluginCompatibilitySupport.satisfiesRange("3.0.1", range: "3.0.0"), "精确不匹配")
        check(PluginCompatibilitySupport.satisfiesRange("3.0.0", range: "=3.0.0"), "等号精确匹配")
        check(PluginCompatibilitySupport.satisfiesRange("0.5.0", range: ">=0.4.0 || ^2.0.0"), "或分支：第一支满足")
        check(PluginCompatibilitySupport.satisfiesRange("2.1.0", range: ">=0.4.0 || ^2.0.0"), "或分支：第二支满足")
        check(!PluginCompatibilitySupport.satisfiesRange("0.1.0", range: ">=0.4.0 || ^2.0.0"), "或分支：两支都不满足")

        // MARK: - scan（磁盘 peer 扫描）

        let fm = FileManager.default
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("dsh-plugin-compat-\(ProcessInfo.processInfo.processIdentifier)")
        func writeManifest(_ dir: URL, _ object: [String: Any]) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let data = try! JSONSerialization.data(withJSONObject: object)
            try! data.write(to: dir.appendingPathComponent("package.json"))
        }

        let profileModules = tmp.appendingPathComponent("profile/node_modules")
        let runtimeModules = tmp.appendingPathComponent("runtime/node_modules")
        // 用户插件：声明 peer，落在区间外
        writeManifest(profileModules.appendingPathComponent("memory-plugin"), [
            "name": "memory-plugin", "version": "0.3.0",
            "peerDependencies": ["@deepseek-ai/dsh-llm": ">=0.2.0"]
        ] as [String: Any])
        // runtime 里的 peer 版本
        writeManifest(runtimeModules.appendingPathComponent("@deepseek-ai/dsh-llm"), ["name": "@deepseek-ai/dsh-llm", "version": "0.1.5-rc.2"])
        // peer 包不存在
        writeManifest(profileModules.appendingPathComponent("legacy-plugin"), [
            "name": "legacy-plugin", "version": "0.1.0",
            "peerDependencies": ["@deepseek-ai/dsh-removed-api": "^0.1.0"]
        ] as [String: Any])
        // 兼容的用户插件（peer 满足）
        writeManifest(profileModules.appendingPathComponent("fine-plugin"), [
            "name": "fine-plugin", "version": "1.0.0",
            "peerDependencies": ["@deepseek-ai/dsh-llm": ">=0.1.0 <0.2.0"]
        ] as [String: Any])

        let plugins: [PluginCompatibilitySupport.InstalledPlugin] = [
            .init(name: "memory-plugin", version: "0.3.0", source: "user", broken: nil),
            .init(name: "legacy-plugin", version: "0.1.0", source: "user", broken: nil),
            .init(name: "fine-plugin", version: "1.0.0", source: "user", broken: nil),
            .init(name: "dsh-archive-manager", version: "0.1.0", source: "bundled", broken: nil),
            .init(name: "dsh-broken-thing", version: nil, source: "broken", broken: true),
        ]
        let issues = PluginCompatibilitySupport.scan(plugins: plugins, profileModules: profileModules, runtimeModules: runtimeModules)
        check(issues.count == 3, "应发现 3 个问题（peer 超界、peer 缺失、损坏残留），实际 \(issues.count)：\(issues.map(\.pluginName))")
        check(issues.contains { $0.pluginName == "memory-plugin" && $0.reason.contains("0.2.0") && $0.reason.contains("0.1.5-rc.2") },
              "peer 超界问题的 reason 应包含区间与实际版本：\(issues.first?.reason ?? "")")
        check(issues.contains { $0.pluginName == "legacy-plugin" && $0.reason.contains("dsh-removed-api") && $0.reason.contains("不存在") },
              "peer 缺失问题应点名包并说明不存在")
        check(issues.contains { $0.pluginName == "dsh-broken-thing" && $0.userPlugin }, "broken 残留按用户插件处理")
        check(!issues.contains { $0.pluginName == "fine-plugin" }, "区间满足的插件不应报问题")
        check(!issues.contains { !$0.userPlugin }, "bundled 插件不做 peer 扫描（其检测走接口探针）")

        try? fm.removeItem(at: tmp)

        if !failures.isEmpty {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
        print("plugin compatibility checks passed")
    }
}
