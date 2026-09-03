import Foundation

@main
struct DSHRuntimeSupportChecks {
    static func main() {
        let fileManager = FileManager.default
        let temp = fileManager.temporaryDirectory.appendingPathComponent("dsh-runtime-support-\(UUID().uuidString)", isDirectory: true)
        let fakeNPM = temp.appendingPathComponent("fake-npm")
        do {
            try fileManager.createDirectory(at: temp, withIntermediateDirectories: true)
            try makeFakeNPM(at: fakeNPM)
            try testMirrorFallback(fakeNPM: fakeNPM)
            try testHealthyRuntimeSkipsDownload(fakeNPM: fakeNPM)
            try testCancellation(fakeNPM: fakeNPM)
            try testInstallEnvironment(fakeNPM: fakeNPM)
            try testLockfileCIInstall(fakeNPM: fakeNPM)
            try testBundledVersionParsing()
            try testUpgradeReinstall(fakeNPM: fakeNPM)
            try testCapturedOutputIsBounded()
            try fileManager.removeItem(at: temp)
            print("dsh runtime support checks passed")
        } catch {
            try? fileManager.removeItem(at: temp)
            fatalError(error.localizedDescription)
        }
    }

    private static func makeFakeNPM(at url: URL) throws {
        let script = """
        #!/bin/sh
        prefix=""
        registry=""
        next=""
        for arg in "$@"; do
          case "$arg" in
            --prefix) next=prefix ;;
            --registry) next=registry ;;
            *)
              if [ "$next" = prefix ]; then prefix="$arg"; next=""; fi
              if [ "$next" = registry ]; then registry="$arg"; next=""; fi
              ;;
          esac
        done
        if [ -n "$FAKE_NPM_ENV_FILE" ]; then
          {
            echo "NODE_OPTIONS=$NODE_OPTIONS"
            echo "npm_config_registry=$npm_config_registry"
            echo "ARGS=$*"
          } >> "$FAKE_NPM_ENV_FILE"
        fi
        if [ "$registry" = "https://registry.npmmirror.com" ]; then exit 42; fi
        if [ "$registry" = "https://slow.example" ]; then sleep 30; exit 1; fi
        mkdir -p "$prefix/node_modules/.bin" "$prefix/node_modules/@deepseek-ai/cordis-plugin-group" "$prefix/node_modules/@deepseek-ai/dsh-app-boot"
        printf '{"name":"@deepseek-ai/cordis-plugin-group"}\\n' > "$prefix/node_modules/@deepseek-ai/cordis-plugin-group/package.json"
        printf '{"name":"@deepseek-ai/dsh-app-boot"}\\n' > "$prefix/node_modules/@deepseek-ai/dsh-app-boot/package.json"
        printf '#!/bin/sh\\nprintf "0.1.1-rc.2\\\\n"\\n' > "$prefix/node_modules/.bin/dsh"
        chmod +x "$prefix/node_modules/.bin/dsh"
        """
        try script.data(using: .utf8)!.write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }

    private static func testMirrorFallback(fakeNPM: URL) throws {
        let result = runInstall(fakeNPM: fakeNPM, environment: [:])
        guard case .success(let executable) = result else {
            throw TestError("镜像回退安装未成功")
        }
        guard DSHRuntimeSupport.isInstalled(), FileManager.default.fileExists(atPath: executable.path) else {
            throw TestError("固定 runtime 校验失败")
        }
        guard !hasTemporaryInstallDirectory() else {
            throw TestError("成功安装后仍有临时目录")
        }
    }

    private static func testHealthyRuntimeSkipsDownload(fakeNPM: URL) throws {
        var output = ""
        let result = runInstall(fakeNPM: fakeNPM, environment: [:]) { output += $0 }
        guard case .success(let executable) = result, executable == DSHRuntimeSupport.executableURL else {
            throw TestError("健康 runtime 未被直接复用")
        }
        guard output.contains("跳过 npm 下载"), !output.contains("尝试 npm registry") else {
            throw TestError("健康 runtime 仍触发了 npm 下载")
        }
        try FileManager.default.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    private static func testCancellation(fakeNPM: URL) throws {
        let resultBox = ResultBox()
        let handle = DSHRuntimeSupport.install(
            npmPath: fakeNPM.path,
            environment: ["DHL_NPM_REGISTRY": "https://slow.example"],
            onOutput: { _ in },
            completion: { resultBox.value = $0 }
        )
        Thread.sleep(forTimeInterval: 0.2)
        handle.cancel()
        waitForResult(resultBox)
        guard case .failure(let error) = resultBox.value,
              case .cancelled = error as? DSHRuntimeError else {
            throw TestError("取消安装未返回 cancelled")
        }
        guard !hasTemporaryInstallDirectory() else {
            throw TestError("取消安装后仍有临时目录")
        }
    }

    // After the cancellation test the runtime is absent again, so this runs a
    // fresh install and asserts the process environment carries the memory
    // budget: a bounded V8 old-space ceiling. (Fetch concurrency is covered by
    // the LauncherEnvironment.nodeEnvironment unit test.)
    private static func testInstallEnvironment(fakeNPM: URL) throws {
        let envFile = fakeNPM.deletingLastPathComponent().appendingPathComponent("env.txt")
        let result = runInstall(fakeNPM: fakeNPM, environment: ["FAKE_NPM_ENV_FILE": envFile.path])
        guard case .success = result else {
            throw TestError("安装环境检查：安装未成功")
        }
        guard let recorded = try? String(contentsOfFile: envFile.path, encoding: .utf8) else {
            throw TestError("安装环境检查：未记录 npm 环境")
        }
        let expectedOptions = "--max-old-space-size=\(DSHRuntimeSupport.npmMaxOldSpaceSizeMB)"
        guard recorded.contains("NODE_OPTIONS=\(expectedOptions)") else {
            throw TestError("npm NODE_OPTIONS 未携带内存上限 \(expectedOptions)，实际：\(recorded)")
        }
        try FileManager.default.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    // With a bundled dsh-runtime spec present, the install must switch to
    // `npm ci` (replay the lockfile) instead of a bare `npm install`, and the
    // staged runtime must carry the copied package.json/package-lock.json.
    private static func testLockfileCIInstall(fakeNPM: URL) throws {
        let envFile = fakeNPM.deletingLastPathComponent().appendingPathComponent("env-ci.txt")
        let specDir = fakeNPM.deletingLastPathComponent().appendingPathComponent("spec")
        try FileManager.default.createDirectory(at: specDir, withIntermediateDirectories: true)
        let package = specDir.appendingPathComponent("package.json")
        let lock = specDir.appendingPathComponent("package-lock.json")
        try Data(#"{"name":"dsh-runtime","version":"1.0.0"}"#.utf8).write(to: package)
        try Data("{}".utf8).write(to: lock)
        DSHRuntimeSupport.bundledRuntimeOverride = (package, lock)
        defer { DSHRuntimeSupport.bundledRuntimeOverride = nil }

        let result = runInstall(
            fakeNPM: fakeNPM,
            environment: ["DHL_NPM_REGISTRY": "https://npm.example.test", "FAKE_NPM_ENV_FILE": envFile.path]
        )
        guard case .success = result else {
            throw TestError("lockfile 安装未成功")
        }
        guard let recorded = try? String(contentsOfFile: envFile.path, encoding: .utf8) else {
            throw TestError("lockfile 安装未记录 npm 参数")
        }
        guard recorded.contains("ARGS=ci ") else {
            throw TestError("存在 bundled spec 时未使用 npm ci，参数：\(recorded)")
        }
        guard FileManager.default.fileExists(atPath: DSHRuntimeSupport.runtimeURL.appendingPathComponent("package.json").path),
              FileManager.default.fileExists(atPath: DSHRuntimeSupport.runtimeURL.appendingPathComponent("package-lock.json").path) else {
            throw TestError("staging runtime 未携带 bundled 的 package.json / package-lock.json")
        }
        try FileManager.default.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    private static func testBundledVersionParsing() throws {
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-spec-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        let package = temp.appendingPathComponent("package.json")
        let lock = temp.appendingPathComponent("package-lock.json")
        try Data(#"{"name":"dsh-runtime","version":"1.0.0"}"#.utf8).write(to: package)
        let lockJSON = #"{"name":"dsh-runtime","version":"1.0.0","packages":{"node_modules/@deepseek-ai/dsh":{"version":"0.2.0"}}}"#
        try Data(lockJSON.utf8).write(to: lock)
        DSHRuntimeSupport.bundledRuntimeOverride = (package, lock)
        defer { DSHRuntimeSupport.bundledRuntimeOverride = nil }
        guard DSHRuntimeSupport.bundledDSHVersion() == "0.2.0" else {
            throw TestError("无法从 bundled lock 解析 dsh 版本")
        }
    }

    // Irregular-update path: an app update ships a bundled lockfile pinning a
    // different dsh version, so the launch flow must detect the mismatch and
    // reinstall through the low-memory `npm ci` path (force) instead of reusing
    // the healthy-but-stale runtime.
    private static func testUpgradeReinstall(fakeNPM: URL) throws {
        // 1) 先装一个健康 runtime（无 override，走 npm install 回退路径）
        let envFile = fakeNPM.deletingLastPathComponent().appendingPathComponent("env-upgrade.txt")
        let first = runInstall(fakeNPM: fakeNPM, environment: ["FAKE_NPM_ENV_FILE": envFile.path])
        guard case .success = first else {
            throw TestError("升级前置安装未成功")
        }
        guard !DSHRuntimeSupport.needsRuntimeUpgrade(environment: [:]) else {
            throw TestError("无 bundled 差异时不应判定为需要升级")
        }

        // 2) bundled lock 钉住不同版本 → 判定需要升级
        let specDir = fakeNPM.deletingLastPathComponent().appendingPathComponent("spec-upgrade")
        try FileManager.default.createDirectory(at: specDir, withIntermediateDirectories: true)
        let package = specDir.appendingPathComponent("package.json")
        let lock = specDir.appendingPathComponent("package-lock.json")
        try Data(#"{"name":"dsh-runtime","version":"1.0.0"}"#.utf8).write(to: package)
        try Data(#"{"name":"dsh-runtime","version":"1.0.0","packages":{"node_modules/@deepseek-ai/dsh":{"version":"0.2.0"}}}"#.utf8).write(to: lock)
        DSHRuntimeSupport.bundledRuntimeOverride = (package, lock)
        defer { DSHRuntimeSupport.bundledRuntimeOverride = nil }
        guard DSHRuntimeSupport.needsRuntimeUpgrade(environment: [:]) else {
            throw TestError("版本不一致未判定为需要升级")
        }

        // 3) force 重装必须走 npm ci 且提示升级，而不是跳过
        let box = ResultBox()
        var output = ""
        _ = DSHRuntimeSupport.install(
            npmPath: fakeNPM.path,
            environment: ["DHL_NPM_REGISTRY": "https://npm.example.test", "FAKE_NPM_ENV_FILE": envFile.path],
            force: true,
            onOutput: { output += $0 },
            completion: { box.value = $0 }
        )
        waitForResult(box)
        guard case .success = box.value else {
            throw TestError("升级强制重装未成功")
        }
        guard let recorded = try? String(contentsOfFile: envFile.path, encoding: .utf8), recorded.contains("ARGS=ci ") else {
            throw TestError("升级重装未使用 npm ci")
        }
        guard output.contains("检测到新的 dsh 版本") else {
            throw TestError("升级重装缺少升级提示")
        }
        try FileManager.default.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    private static func testCapturedOutputIsBounded() throws {
        var buffer = Data()
        let chunks = (0..<12).map { Data(repeating: UInt8($0), count: 1 << 20) }
        for chunk in chunks { DSHRuntimeSupport.appendCapturedOutput(chunk, to: &buffer) }
        guard buffer.count <= DSHRuntimeSupport.maxCapturedOutputBytes else {
            throw TestError("捕获缓冲区超出上限：\(buffer.count)")
        }
        let expected = chunks.dropFirst(chunks.count - (DSHRuntimeSupport.maxCapturedOutputBytes / (1 << 20))).reduce(Data(), +)
        guard buffer == expected else {
            throw TestError("捕获缓冲区未正确保留尾部")
        }
    }

    private static func runInstall(
        fakeNPM: URL,
        environment: [String: String],
        onOutput: @escaping (String) -> Void = { _ in }
    ) -> Result<URL, Error> {
        let box = ResultBox()
        _ = DSHRuntimeSupport.install(npmPath: fakeNPM.path, environment: environment, onOutput: onOutput, completion: { box.value = $0 })
        waitForResult(box)
        return box.value!
    }

    private static func waitForResult(_ box: ResultBox) {
        while box.value == nil {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
    }

    private static func hasTemporaryInstallDirectory() -> Bool {
        let root = DSHRuntimeSupport.runtimeURL.deletingLastPathComponent()
        let entries = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
        return entries.contains { $0.lastPathComponent.hasPrefix("runtime.installing-") }
    }

    private final class ResultBox {
        var value: Result<URL, Error>?
    }

    private struct TestError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
}
