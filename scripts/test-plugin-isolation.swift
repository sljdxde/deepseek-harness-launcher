import Foundation

// 插件隔离与启动恢复的判定（见 Sources/PluginIsolationSupport.swift）。
//
// 锚点是一次真实故障：@openviking/dsh-memory-plugin 0.5.0 的 shared/ 不在 git 里，
// 子目录克隆装出来缺模块，dsh 启动即以退出码 1 结束，用户点启动/重启全部失败。
// 这里的用例锁住三件事：能从那种 stderr 里认出是谁干的、认不出时绝不瞎隔离、
// 以及隔离后的启动命令在没有隔离项时与历史命令逐字节一致。
//
// 编译：swiftc scripts/test-plugin-isolation.swift Sources/PluginIsolationSupport.swift Sources/PluginSourceCheck.swift

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

        // MARK: - 行归属映射与逐个排除阶梯

        let rowsMap = support.bundleRowIds(fromDumpConfig: realDumpConfig)
        checkEqual(rowsMap["@openviking/dsh-memory-plugin"]?.joined(separator: ",") ?? "nil", "openviking-memory", "dump 一次解析出全部 bundle 的行")
        checkEqual(rowsMap["@tt-a1i/archify-dsh"]?.joined(separator: ",") ?? "nil", "archify-skill-filesystem", "别的 bundle 的行也要收进来")
        check((rowsMap["@deepseek-ai/dsh-base"] ?? []).isEmpty, "`patched by` 段不该被算成谁的新行")
        checkEqual(support.bundleOwning(rowId: "openviking-memory-runtime", in: rowsMap) ?? "nil", "nil", "别人的子行不认，避免误禁")
        checkEqual(support.bundleOwning(rowId: "archify-skill-filesystem", in: rowsMap) ?? "nil", "@tt-a1i/archify-dsh", "行 id 反查归属")

        checkEqual(
            support.attributedRowIds(stderr: "failed to import loader entry openviking-memory-runtime (@openviking/dsh-memory-plugin)\nfailed to apply loader entry archify-row (x)").joined(separator: ","),
            "archify-row,openviking-memory-runtime",
            "行 id 按最后出现优先（后面的才是真正没起来的行）"
        )
        check(
            support.attributedRowIds(stderr: "failed to import loader entry bad\nid:\n  disabled: true (x)").isEmpty,
            "不安全字符的行 id 直接丢弃（会被写进 YAML）"
        )
        checkEqual(
            support.isolatableBundles(fromProfileManifest: """
            { "dsh": { "profile": { "bundles": [
              "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@openviking/dsh-memory-plugin", "dsh-notify"
            ] } } }
            """).joined(separator: ","),
            "@openviking/dsh-memory-plugin,dsh-notify",
            "core 层不可隔离，第三方按 manifest 顺序排队"
        )
        check(support.isolatableBundles(fromProfileManifest: "not json").isEmpty, "manifest 读不懂就当没有候选，交给安全模式")

        // MARK: - 隔离记录

        checkEqual(
            support.isolationEntry(bundle: "@openviking/dsh-memory-plugin", rowIds: ["openviking-memory"], reason: "r", isolatedAt: "t")?.rowIds.joined(separator: ",") ?? "nil",
            "openviking-memory", "有可禁的行才生成记录"
        )
        check(support.isolationEntry(bundle: "@a/b", rowIds: [], reason: "r", isolatedAt: "t") == nil, "没有可禁的行就不隔离（写了等于没写）")
        check(support.isolationEntry(bundle: "dsh-plugin-manager", rowIds: ["x"], reason: "r", isolatedAt: "t") == nil, "内置插件不给生成隔离记录")
        checkEqual(
            support.isolationEntry(bundle: "@a/b", rowIds: ["ok-row", "bad\ninjected"], reason: "r", isolatedAt: "t")?.rowIds.joined(separator: ",") ?? "nil",
            "ok-row", "不安全行 id 被过滤掉"
        )

        // MARK: - 恢复决策

        let emptyInput = support.RecoveryInput(attributedBundle: nil, attributedRowIds: [], rowIdOwners: [], candidateBundles: [], isolatedBundles: [], isolationsThisBoot: 0)
        check(support.decideRecovery(emptyInput) == .safeMode(reason: "没有可隔离的第三方插件，dsh 本体或内置插件出了问题"), "什么都没点名且没有候选 → 安全模式")
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: "@a/b", attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: [], isolationsThisBoot: 0))
                == .isolate(bundle: "@a/b", source: .stderrBundle),
            "日志点名了包 → 只禁它"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: nil, attributedRowIds: ["row-x"], rowIdOwners: ["@c/d"], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: [], isolationsThisBoot: 0))
                == .isolate(bundle: "@c/d", source: .stderrRow),
            "只点名了行 → 按行反查 bundle，优先于瞎猜"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: nil, attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: [], isolationsThisBoot: 1))
                == .isolate(bundle: "@a/b", source: .bisect),
            "什么都认不出 → 从候选列表逐个排除，而不是一把全砍"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: "@a/b", attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b", "@c/d"], isolatedBundles: ["@a/b"], isolationsThisBoot: 1))
                == .isolate(bundle: "@c/d", source: .bisect),
            "点名的已经禁过了 → 继续排除下一个"
        )
        check(
            support.decideRecovery(support.RecoveryInput(attributedBundle: nil, attributedRowIds: [], rowIdOwners: [], candidateBundles: ["@a/b"], isolatedBundles: ["@a/b"], isolationsThisBoot: 1))
                == .safeMode(reason: "已隔离 1 个插件仍起不来：@a/b"),
            "第三方全禁完仍失败 → 安全模式"
        )
        check(support.decideRecovery(emptyInput) != .isolate(bundle: "@a/b", source: .bisect), "决策不会凭空发明插件名")

        // MARK: - 启动前静态预检

        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent("dhl-preflight-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }
        func write(_ relative: String, _ body: String) {
            let url = root.appendingPathComponent(relative)
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? body.write(to: url, atomically: true, encoding: .utf8)
        }
        func gaps(in sub: String) -> [String] {
            PluginSourceCheck.unresolvableLocalImports(in: sub.isEmpty ? root : root.appendingPathComponent(sub))
                .map { "\($0.importer) -> \($0.specifier)" }
        }

        write("index.mjs", "import { a } from './lib/a.mjs';\nexport const all = a;\n")
        write("lib/a.mjs", "export const a = 1\n")
        write("servers/mcp.mjs", "import '../lib/a.mjs';\nexport const s = 1;\n")
        check(gaps(in: "").isEmpty, "完整源码不报")

        write("client.mjs", "import { http } from './shared/ov-http.mjs';\nexport const c = http;\n")
        checkEqual(gaps(in: "").joined(separator: ","), "client.mjs -> ./shared/ov-http.mjs", "缺整个 shared/ 要报（真实事故形状）")

        write("shared/ov-http.mjs", "export const http = 1\n")
        check(gaps(in: "").isEmpty, "补上 shared/ 之后不报")

        write("dynamic.mjs", "const load = () => import('./maybe-later.mjs');\nexport const d = load;\n")
        checkEqual(gaps(in: "").joined(separator: ","), "dynamic.mjs -> ./maybe-later.mjs", "动态 import 也查")

        write("reexport.mjs", "export { x } from './gone.mjs';\n")
        check(gaps(in: "").contains("reexport.mjs -> ./gone.mjs"), "re-export 也查")

        // 换下一组用例前把上面那些"故意缺文件"的样本清干净，否则会串味。
        for stale in ["index.mjs", "client.mjs", "dynamic.mjs", "reexport.mjs", "servers", "shared"] {
            try? fm.removeItem(at: root.appendingPathComponent(stale))
        }
        write("plain.mjs", "import { x } from './plain';\nexport const p = x;\n")
        write("plain.js", "export const x = 1\n")
        write("dirimport.mjs", "import { y } from './dir/';\nexport const q = y;\n")
        write("dir/index.mjs", "export const y = 1\n")
        write("bare.mjs", "import { llm } from '@deepseek-ai/dsh-llm';\nexport const b = llm;\n")
        check(gaps(in: "").isEmpty, "省扩展名、目录 index、裸包名都不误报")

        write("outside.mjs", "import { z } from '../../other-pkg/z.mjs';\nexport const o = z;\n")
        check(gaps(in: "").isEmpty, "指向包外的相对路径不报（pnpm 布局另有解析）")

        write("index.test.mjs", "import { fix } from './fixture.mjs';\nexport const t = fix;\n")
        write("test/only-tests.mjs", "import { g } from './gone-in-tests.mjs';\nexport const u = g;\n")
        write("node_modules/dep/x.mjs", "import { n } from './missing-in-deps.mjs';\nexport const v = n;\n")
        check(gaps(in: "").isEmpty, "测试文件、test/ 目录、node_modules 里的缺失都不拦启动")

        check(PluginSourceCheck.unresolvableLocalImports(in: root.appendingPathComponent("no-such-dir")).isEmpty,
              "目录不存在时返回空（预检自己不能变成故障源）")

        if !failures.isEmpty {
            for failure in failures { print("FAIL: \(failure)") }
            exit(1)
        }
        print("plugin isolation checks passed")
    }
}
