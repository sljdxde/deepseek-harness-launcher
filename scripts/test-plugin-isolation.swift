import Foundation

// 插件隔离与启动恢复的判定（见 Sources/PluginIsolationSupport.swift）。
//
// 锚点是一次真实故障：@openviking/dsh-memory-plugin 0.5.0 的 shared/ 不在 git 里，
// 子目录克隆装出来缺模块，dsh 启动即以退出码 1 结束，用户点启动/重启全部失败。
// 这里的用例锁住三件事：能从那种 stderr 里认出是谁干的、认不出时绝不瞎隔离、
// 以及隔离后的启动命令在没有隔离项时与历史命令逐字节一致。
//
// 编译：swiftc scripts/test-plugin-isolation.swift Sources/PluginIsolationSupport.swift

@main
struct PluginIsolationTests {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func checkEqual<T: Equatable>(_ lhs: T, _ rhs: T, _ message: String) {
        if lhs != rhs { failures.append("\(message)：实际 \(lhs)，期望 \(rhs)") }
    }

    /// 2026-09-22 事故日志里的真实 stderr（截掉与判定无关的行）。
    static let realIncidentStderr = """
    (node:86928) ExperimentalWarning: SQLite is an experimental feature and might change at any time
    Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): failed to apply loader entry openviking-memory (@deepseek-ai/cordis-plugin-group): failed to import loader entry openviking-memory-runtime (@openviking/dsh-memory-plugin): Cannot find module '/Users/yuzhou/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin/shared/ov-http.mjs' imported from /Users/yuzhou/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin/client.mjs
        at finalizeResolution (node:internal/modules/esm/resolve:275:11)
      code: 'ERR_MODULE_NOT_FOUND',
      url: 'file:///Users/yuzhou/.dsh/profiles/web/node_modules/@openviking/dsh-memory-plugin/shared/ov-http.mjs'
    }
    Node.js v22.23.2
    """

    /// `dsh web --dump-config` 的真实片段：自己的 group 行、别人身上的补丁行、嵌套子行。
    static let realDumpConfig = """
    # == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app
      - id: web-settings
        name: '@deepseek-ai/dsh-settings-web'
    # == @openviking/dsh-memory-plugin
    - id: openviking-memory
      name: '@deepseek-ai/cordis-plugin-group'
      group: true
      isolate:
        openvikingMemory: true
      config:
        - id: openviking-memory-runtime
          name: '@openviking/dsh-memory-plugin'
    # == @tt-a1i/archify-dsh
    - id: archify-skill-filesystem
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        providerName: archify-plugin
    # == @deepseek-ai/dsh-base, patched by @tt-a1i/archify-dsh
    - id: agent
      name: '@deepseek-ai/dsh-agent'
    """

    static func main() {
        let support = PluginIsolationSupport.self

        // MARK: - 失败归因

        checkEqual(
            support.attributedBundle(stderr: realIncidentStderr) ?? "nil",
            "@openviking/dsh-memory-plugin",
            "真实事故 stderr 应认出坏插件"
        )
        checkEqual(
            support.attributedBundle(stderr: "failed to import loader entry row-a (file:///x/node_modules/@scope/pkg/entry.mjs)") ?? "nil",
            "@scope/pkg",
            "loader 条目括号里是 file URL 时按路径取包名"
        )
        checkEqual(
            support.attributedBundle(stderr: "failed to import loader entry row-a (file:///x/node_modules/plain-pkg/entry.mjs)") ?? "nil",
            "plain-pkg",
            "非 scoped 包名也要取对"
        )
        checkEqual(
            support.attributedBundle(stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'some-dep' imported from /x/index.mjs") ?? "nil",
            "some-dep",
            "缺整包时按包名归因"
        )
        check(
            support.attributedBundle(stderr: realIncidentStderr).map { !$0.isEmpty } == true,
            "归因结果不应为空串"
        )
        check(
            support.attributedBundle(stderr: "failed to import loader entry x (@deepseek-ai/dsh-base)") == nil,
            "内置 base 不许被隔离"
        )
        check(
            support.attributedBundle(stderr: "failed to import loader entry x (dsh-plugin-manager)") == nil,
            "插件管理器自身不许被隔离"
        )
        check(
            support.attributedBundle(stderr: "(node:1) Warning: something unrelated\nServer listening") == nil,
            "认不出来时返回 nil，交给上层转安全模式"
        )
        checkEqual(
            support.attributedBundle(stderr: """
            failed to import loader entry a (@first/pkg)
            failed to import loader entry b (@second/pkg)
            """) ?? "nil",
            "@second/pkg",
            "多条错误取最后一条（前面的多是连带失败）"
        )
        checkEqual(
            support.attributedBundle(
                stderr: "failed to import loader entry a (@deepseek-ai/dsh-base)\nfailed to import loader entry b (@user/pkg)",
                protected: support.protectedBundles
            ) ?? "nil",
            "@user/pkg",
            "内置嫌疑要跳过、继续找下一个可隔离的"
        )
        checkEqual(support.packageName(fromPath: "/a/b/node_modules/@scope/name/shared/x.mjs") ?? "nil", "@scope/name", "路径取包名")
        checkEqual(support.packageName(fromPath: "/a/b/no-node-modules/x.mjs") ?? "nil", "nil", "没有 node_modules 段时不猜包名")

        // MARK: - 行 id 提取

        checkEqual(support.ownRowIds(fromDumpConfig: realDumpConfig, bundle: "@openviking/dsh-memory-plugin").joined(separator: ","), "openviking-memory", "只取自己贡献的顶层行（嵌套子行由父 group 继承 disabled）")
        checkEqual(support.ownRowIds(fromDumpConfig: realDumpConfig, bundle: "@tt-a1i/archify-dsh").joined(separator: ","), "archify-skill-filesystem", "`patched by` 段里的行不算自己的")
        check(support.ownRowIds(fromDumpConfig: realDumpConfig, bundle: "no-such-bundle").isEmpty, "bundle 不在树里时返回空（调用方据此放弃隔离）")

        // 真实插件的 patch 形状（@openviking/dsh-memory-plugin 与 dsh-notify 都是这个写法）。
        checkEqual(
            support.insertedRowIds(fromPatchYAML: """
            - insert:
                - id: openviking-memory
                  name: '@deepseek-ai/cordis-plugin-group'
                  group: true
                  config:
                    - id: openviking-memory-runtime
                      name: '@openviking/dsh-memory-plugin'
            """).joined(separator: ","),
            "openviking-memory",
            "只取 insert 块里的新行，嵌套子行不取（父 group 已连带禁用）"
        )
        checkEqual(
            support.insertedRowIds(fromPatchYAML: """
            - id: agent
              config:
                model: deepseek-flash
            - insert:
                - id: my-row
            - id: session
              disabled: false
            """).joined(separator: ","),
            "my-row",
            "顶格 `- id:` 是在改别人的行，隔离绝不能碰"
        )
        check(support.isSafeRowId("openviking-memory"), "常规 id 放行")
        check(!support.isSafeRowId("a\n  disabled: true\n- id: b"), "换行注入拒绝（行 id 来自外部输出，会被写进 YAML）")
        check(!support.isSafeRowId("id: with spaces"), "含空格拒绝")
        check(!support.isSafeRowId("quote'key"), "引号拒绝")
        check(!support.isSafeRowId(""), "空 id 拒绝")
        check(!support.isSafeRowId(String(repeating: "a", count: 129)), "超长 id 拒绝")

        // MARK: - overlay 渲染与启动参数

        let openviking = support.IsolatedPlugin(
            bundle: "@openviking/dsh-memory-plugin",
            rowIds: ["openviking-memory", "bad\ninjected"],
            reason: "ERR_MODULE_NOT_FOUND",
            isolatedAt: "2026-09-22T12:00:00Z"
        )
        checkEqual(
            support.renderIsolationPatch([openviking]),
            "- id: openviking-memory\n  disabled: true\n",
            "overlay 必须是顶格 YAML 列表（缩进会被读成别人的 config），并过滤不安全 id"
        )
        checkEqual(support.renderIsolationPatch([]), "", "没有隔离项时渲染空串（调用方据此不传 --patch）")

        checkEqual(
            support.bootArguments(port: 3080, basePatch: "/App/DSHArchiveManager/cordis.patch.yml", isolationPatch: nil).joined(separator: " "),
            "web --patch /App/DSHArchiveManager/cordis.patch.yml --no-open --port 3080",
            "没有隔离项时启动命令与历史完全一致（不许改变现有行为）"
        )
        checkEqual(
            support.bootArguments(port: 3081, basePatch: "/base.yml", isolationPatch: "/iso.yml").joined(separator: " "),
            "web --patch /base.yml --patch /iso.yml --no-open --port 3081",
            "隔离 overlay 作为第二个 --patch，且排在透传给 app 的参数之前"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: nil, isolationPatch: "/iso.yml").joined(separator: " "),
            "web --patch /iso.yml --no-open --port 3080",
            "内置插件的 patch 文件缺失时不传它（缺失路径对 dsh 是致命错误）"
        )
        checkEqual(
            support.bootArguments(port: 3080, basePatch: nil, isolationPatch: nil).joined(separator: " "),
            "web --no-open --port 3080",
            "两个 patch 都没有时退化成最小命令，仍然不传 --patch"
        )
        checkEqual(support.safeModeArguments(port: 3099).joined(separator: " "), "--profile rescue --from-default-profile web --no-open --port 3099", "安全模式不带任何 --patch")

        // MARK: - 状态文件

        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("dhl-isolation-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: tmp) }
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let stateURL = tmp.appendingPathComponent(support.stateFileName)

        check(support.readState(url: stateURL).isEmpty, "状态文件不存在时按空处理")
        check(support.writeState([openviking], url: stateURL), "写状态文件应成功")
        checkEqual(support.readState(url: stateURL).count, 1, "写后读回一条")
        checkEqual(support.readState(url: stateURL).first?.rowIds.joined(separator: ",") ?? "nil", "openviking-memory,bad\ninjected", "状态文件保留原始记录（渲染时再过滤）")

        try? "[not json".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "畸形状态文件按空处理，恢复机制自己不能变成故障源")
        try? "[{\"bundle\":\"dsh-plugin-manager\",\"rowIds\":[\"x\"],\"reason\":\"r\",\"isolatedAt\":\"t\"}]".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "内置插件的隔离记录直接丢弃（可能被手改过）")
        try? "[{\"bundle\":\"\",\"rowIds\":[\"x\"],\"reason\":\"r\",\"isolatedAt\":\"t\"}]".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "空 bundle 名丢弃")
        try? "[{\"bundle\":\"a\",\"rowIds\":[\"\"],\"reason\":\"r\",\"isolatedAt\":\"t\"}]".write(to: stateURL, atomically: true, encoding: .utf8)
        check(support.readState(url: stateURL).isEmpty, "没有安全行 id 的记录丢弃（等于隔离无效）")

        check(support.stagedPatchFile(entries: [], directory: tmp) == nil, "没有隔离项时不产出 patch 文件（dsh 对空文件与缺失文件都是致命错误）")
        let staged = support.stagedPatchFile(entries: [openviking], directory: tmp)
        check(staged?.lastPathComponent == support.patchFileName, "有隔离项时产出 overlay 文件")
        check((staged.flatMap { try? String(contentsOf: $0, encoding: .utf8) })?.isEmpty == false, "overlay 文件内容非空")
        check(
            support.stagedPatchFile(entries: [openviking], directory: URL(fileURLWithPath: "/System/Library/CoreFinder/x")) == nil,
            "写不进去时返回 nil（宁可回到没有隔离的原始行为，也不递半截文件给 dsh）"
        )

        // MARK: - 恢复决策

        checkEqual(
            support.isolationEntry(bundle: "@openviking/dsh-memory-plugin", dumpConfig: realDumpConfig, ownPatchYAML: nil, reason: "r", isolatedAt: "t")?.rowIds.joined(separator: ",") ?? "nil",
            "openviking-memory",
            "dump-config 能给出可禁的行"
        )
        checkEqual(
            support.isolationEntry(bundle: "@a/b", dumpConfig: "", ownPatchYAML: "- insert:\n    - id: only-local\n      name: x\n", reason: "r", isolatedAt: "t")?.rowIds.joined(separator: ",") ?? "nil",
            "only-local",
            "dump-config 拿不到时退回包内 patch 的 insert 块"
        )
        check(support.isolationEntry(bundle: "@a/b", dumpConfig: "", ownPatchYAML: "", reason: "r", isolatedAt: "t") == nil, "找不到任何可禁的行就不隔离（写了等于没写，下次照样起不来）")
        check(support.isolationEntry(bundle: "dsh-plugin-manager", dumpConfig: realDumpConfig, ownPatchYAML: "- id: x\n", reason: "r", isolatedAt: "t") == nil, "内置插件不给生成隔离记录")
        checkEqual(support.isolationEntry(bundle: "@a/b", dumpConfig: realDumpConfig, ownPatchYAML: nil, reason: "r", isolatedAt: "t")?.bundle ?? "nil", "nil", "dump-config 里没有这个 bundle 时不隔离")

        checkEqual(support.decideRecovery(attributed: nil, alreadyIsolated: [], isolationsThisBoot: 0), .safeMode(reason: "无法从启动日志里确定是哪个插件导致失败"), "认不出嫌疑对象就转安全模式")
        checkEqual(support.decideRecovery(attributed: "@a/b", alreadyIsolated: ["@a/b"], isolationsThisBoot: 1), .safeMode(reason: "@a/b 已被隔离过，仍然起不来"), "同一个插件隔离过一次还失败，不再重复隔离")
        checkEqual(support.decideRecovery(attributed: "@a/b", alreadyIsolated: [], isolationsThisBoot: 0), .isolate(bundle: "@a/b"), "首次识别到坏插件应隔离后重试")
        checkEqual(support.decideRecovery(attributed: "@a/b", alreadyIsolated: [], isolationsThisBoot: support.maxIsolationsPerBoot), .safeMode(reason: "本次启动已连续隔离 \(support.maxIsolationsPerBoot) 个插件"), "隔离额度用尽转安全模式，避免把插件挨个禁光")
        check(support.maxIsolationsPerBoot > 0, "隔离额度必须为正")

        if !failures.isEmpty {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
        print("plugin isolation checks passed")
    }
}
