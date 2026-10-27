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
        // rc 粒度必须真的生效：0.1.0-rc.1 不满足 >=0.1.0-rc.6。
        // （旧实现复用启动器的 compareVersions，把两个 rc 判成相等，于是不兼容的插件被报成兼容。）
        check(!PluginCompatibilitySupport.satisfiesRange("0.1.0-rc.1", range: ">=0.1.0-rc.6 <0.2.0"), "rc.1 不应满足 >=rc.6")
        check(PluginCompatibilitySupport.satisfiesRange("0.1.0-rc.6", range: ">=0.1.0-rc.6 <0.2.0"), "rc.6 满足 >=rc.6")
        check(PluginCompatibilitySupport.satisfiesRange("0.1.0-rc.10", range: ">=0.1.0-rc.6 <0.2.0"), "rc.10 按数值高于 rc.6（不是字典序）")
        // 越界的预发布：插件写 `<0.2.0` 排除的就是 0.2 这条线，0.2.0-rc.9 不能算满足。
        check(!PluginCompatibilitySupport.satisfiesRange("0.2.0-rc.9", range: ">=0.1.0-rc.6 <0.2.0"), "上界线的预发布不应被放过")
        // dsh 生态常态是装 rc runtime：只写正式区间的插件不能被误报成不兼容（npm 默认的
        // 预发布门控会这么干，这里刻意不采纳）。
        check(PluginCompatibilitySupport.satisfiesRange("0.1.5-rc.2", range: ">=0.1.0 <0.2.0"), "区间内的 rc runtime 算兼容")
        // 空格写法与 x-range：`>= 0.1.0` 曾被拆成 `>=` + `0.1.0` 两段，退化成「必须精确等于」。
        check(PluginCompatibilitySupport.satisfiesRange("1.5.0", range: ">= 0.1.0"), "操作符后的空格不能把比较子拆断")
        check(PluginCompatibilitySupport.satisfiesRange("0.1.4", range: "0.1.x"), "0.1.x 接受 0.1 线内的版本")
        check(!PluginCompatibilitySupport.satisfiesRange("0.2.0", range: "0.1.x"), "0.1.x 拒绝 0.2.0")
        check(PluginCompatibilitySupport.satisfiesRange("1.9.9", range: "1.x"), "1.x 覆盖整条主版本线")
        // ^0.0.3 的上界是 0.0.4（npm 只允许补丁位浮动），旧实现算成 0.1.0。
        check(!PluginCompatibilitySupport.satisfiesRange("0.0.4", range: "^0.0.3"), "^0.0.3 不允许跨到 0.0.4")
        check(PluginCompatibilitySupport.satisfiesRange("0.0.3", range: "^0.0.3"), "^0.0.3 满足自身")
        check(PluginCompatibilitySupport.satisfiesRange("0.1.5-rc.2", range: ">=0.1.0-rc.6 <0.2.0 || ^0.1.5-rc.1"), "真实插件的多分支写法")

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

        // 内置插件：插件管理器通常标 bundled；旧接口/软链判定失败时可能标成 user
        // 或 broken（App 被移动、同名软链指向别处）。三种都不许进兼容性扫描——
        // 用户升不了也卸不掉，报警只能把人引去白重启。这里故意给它们塞一个必然
        // 不满足的 peer，证明不是「碰巧没触发」。
        writeManifest(profileModules.appendingPathComponent("dsh-archive-manager"), [
            "name": "dsh-archive-manager", "version": "0.1.0",
            "peerDependencies": ["@deepseek-ai/nonexistent-builtin-api": "^9.0.0"]
        ] as [String: Any])

        let plugins: [PluginCompatibilitySupport.InstalledPlugin] = [
            .init(name: "memory-plugin", version: "0.3.0", source: "user", broken: nil),
            .init(name: "legacy-plugin", version: "0.1.0", source: "user", broken: nil),
            .init(name: "fine-plugin", version: "1.0.0", source: "user", broken: nil),
            .init(name: "dsh-archive-manager", version: "0.1.0", source: "bundled", broken: nil),
            // 同一内置插件被旧接口错标成 user：名字集合必须兜住。
            .init(name: "dsh-archive-manager", version: "0.1.0", source: "user", broken: nil),
            // 内置插件的「损坏残留」也不许报：那不是用户能清理/重装的东西。
            .init(name: "dsh-plugin-manager", version: nil, source: "broken", broken: true),
            .init(name: "dsh-session-notify", version: nil, source: "user", broken: nil),
            .init(name: "dsh-broken-thing", version: nil, source: "broken", broken: true),
        ]
        let issues = PluginCompatibilitySupport.scan(plugins: plugins, profileModules: profileModules, runtimeModules: runtimeModules)
        check(issues.count == 3, "应发现 3 个问题（peer 超界、peer 缺失、损坏残留），实际 \(issues.count)：\(issues.map(\.pluginName))")
        check(issues.contains { $0.pluginName == "memory-plugin" && $0.reason.contains("0.2.0") && $0.reason.contains("0.1.5-rc.2") },
              "peer 超界问题的 reason 应包含区间与实际版本：\(issues.first?.reason ?? "")")
        check(issues.contains { $0.pluginName == "legacy-plugin" && $0.reason.contains("dsh-removed-api") && $0.reason.contains("不存在") },
              "peer 缺失问题应点名包并说明不存在")
        check(issues.contains { $0.pluginName == "dsh-broken-thing" }, "用户插件的 broken 残留仍要报（可以清理/重装）")
        check(!issues.contains { $0.pluginName == "fine-plugin" }, "区间满足的插件不应报问题")
        check(!issues.contains { PluginCompatibilitySupport.bundledPluginNames.contains($0.pluginName) },
              "内置插件永不参与兼容性扫描（bundled/user/broken 三种标记都一样）：\(issues.map(\.pluginName))")

        // 一个插件同时踩两个 peer（实测 dsh-connect-workbuddy：pi-ai 超界 + react 缺失）
        // 只能报**一条**：日志行按插件计数、弹窗按插件逐个呈现，一条一条报会让同一插件
        // 在日志里出现两遍，用户处理完第一条还会再弹一次。
        writeManifest(profileModules.appendingPathComponent("double-trouble"), [
            "name": "double-trouble", "version": "1.2.3",
            "peerDependencies": [
                "@deepseek-ai/dsh-llm": ">=0.2.0",
                "@deepseek-ai/dsh-removed-api": "^0.1.0"
            ]
        ] as [String: Any])
        let merged = PluginCompatibilitySupport.scan(
            plugins: [.init(name: "double-trouble", version: "1.2.3", source: "user", broken: nil)],
            profileModules: profileModules, runtimeModules: runtimeModules
        )
        check(merged.count == 1, "同一插件的多个 peer 问题应合并成一条，实际 \(merged.count) 条：\(merged.map(\.reason))")
        check(merged.first?.reason.contains("@deepseek-ai/dsh-llm") == true
              && merged.first?.reason.contains("dsh-removed-api") == true
              && merged.first?.reason.contains("；") == true,
              "合并后的一条要同时说清两个原因：\(merged.first?.reason ?? "")")
        check(PluginCompatibilitySupport.mergeByPlugin(merged).count == 1, "合并是幂等的")

        // peer 的实际解析位置：只看 runtime 一个目录会把提升到 profile 根的 peer 误报成
        // 「不存在」（用户机器上 react 就在 ~/.dsh/profiles/node_modules 下，只是软链）。
        writeManifest(tmp.appendingPathComponent("profile/node_modules/hoisted-dep"), ["name": "hoisted-dep", "version": "2.5.0"])
        writeManifest(profileModules.appendingPathComponent("hoisted-user"), [
            "name": "hoisted-user", "version": "0.1.0",
            "peerDependencies": ["hoisted-dep": "^2.0.0"]
        ] as [String: Any])
        // 插件自己带的嵌套依赖也算数（Node 会先看 <pkg>/node_modules）。
        writeManifest(profileModules.appendingPathComponent("nested-user/node_modules/nested-dep"), ["name": "nested-dep", "version": "1.0.0"])
        writeManifest(profileModules.appendingPathComponent("nested-user"), [
            "name": "nested-user", "version": "0.1.0",
            "peerDependencies": ["nested-dep": "^1.0.0"]
        ] as [String: Any])
        let resolved = PluginCompatibilitySupport.scan(
            plugins: [
                .init(name: "hoisted-user", version: "0.1.0", source: "user", broken: nil),
                .init(name: "nested-user", version: "0.1.0", source: "user", broken: nil),
            ],
            profileModules: profileModules, runtimeModules: runtimeModules
        )
        check(resolved.isEmpty, "提升到 profile 根 / 插件自带的 peer 不该被报成不存在：\(resolved.map { "\($0.pluginName): \($0.reason)" })")

        // 浏览器侧 react/react-dom 由外壳提供：有客户端半的插件不该因「runtime 里没有
        // react」被报警（实测 dsh-connect-workbuddy 能用却被劝退卸载）。
        writeManifest(profileModules.appendingPathComponent("client-plugin"), [
            "name": "client-plugin", "version": "1.0.0",
            "peerDependencies": ["react": "^18.2.0", "react-dom": "^18.2.0"],
            "dsh": ["client": ["platform": "web"]]
        ] as [String: Any])
        // 没有客户端半的插件声明 react → 仍然按真实缺失报（主机半不可能从外壳拿 react）。
        writeManifest(profileModules.appendingPathComponent("host-plugin"), [
            "name": "host-plugin", "version": "1.0.0",
            "peerDependencies": ["react": "^18.2.0"]
        ] as [String: Any])
        let shellPeers = PluginCompatibilitySupport.scan(
            plugins: [
                .init(name: "client-plugin", version: "1.0.0", source: "user", broken: nil),
                .init(name: "host-plugin", version: "1.0.0", source: "user", broken: nil),
            ],
            profileModules: profileModules, runtimeModules: runtimeModules
        )
        check(!shellPeers.contains { $0.pluginName == "client-plugin" }, "客户端半的 react peer 不该报警：\(shellPeers.map(\.reason))")
        check(shellPeers.contains { $0.pluginName == "host-plugin" && $0.reason.contains("react") }, "没有客户端半时仍要如实报告 react 缺失")

        try? fm.removeItem(at: tmp)

        if !failures.isEmpty {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
        print("plugin compatibility checks passed")
    }
}
