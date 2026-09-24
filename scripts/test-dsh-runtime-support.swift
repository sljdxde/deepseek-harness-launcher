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
            try testBundledOlderDoesNotDowngrade(fakeNPM: fakeNPM)
            try testExplicitVersionInstall(fakeNPM: fakeNPM)
            try testUpdateKeepsRollbackSnapshot(fakeNPM: fakeNPM)
            try testInterruptedUpdateRecoversSnapshot(fakeNPM: fakeNPM)
            try testSnapshotReplacesHalfRuntime(fakeNPM: fakeNPM)
            try testHalfRuntimeIsStillLaunchable()
            try testCapturedOutputIsBounded()
            try testHasHarnessInstall()
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
            echo "npm_config_prefer_offline=$npm_config_prefer_offline"
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
        guard recorded.contains("npm_config_prefer_offline=true") else {
            throw TestError("默认安装路径应保持 prefer-offline（命中缓存），实际：\(recorded)")
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
        // 弹窗文案需要「当前 → 目标」两个版本号：判定结果一并带上，别让调用方
        // 为此再跑一次 `dsh --version`。
        guard let target = DSHRuntimeSupport.bundledUpgradeTarget(environment: [:]),
              target.bundled == "0.2.0", target.installed == "0.1.1-rc.2" else {
            throw TestError("升级目标未携带 bundled / installed 版本号")
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

    // Manual-update protection: the bundled lockfile pinning an OLDER dsh
    // version than the installed one (the user updated dsh from the menu) must
    // NOT count as a runtime upgrade — a forced `npm ci` here would silently
    // downgrade the manual update on the next launch.
    private static func testBundledOlderDoesNotDowngrade(fakeNPM: URL) throws {
        // 前置：先装一个健康 runtime（fake npm 安装出的 dsh 自报 0.1.1-rc.2），
        // 否则 isInstalled() 为假会让 needsRuntimeUpgrade 空过、断言失效。
        let first = runInstall(fakeNPM: fakeNPM, environment: [:])
        guard case .success = first else {
            throw TestError("防降级检查的前置安装未成功")
        }
        let specDir = fakeNPM.deletingLastPathComponent().appendingPathComponent("spec-older")
        try FileManager.default.createDirectory(at: specDir, withIntermediateDirectories: true)
        let package = specDir.appendingPathComponent("package.json")
        let lock = specDir.appendingPathComponent("package-lock.json")
        try Data(#"{"name":"dsh-runtime","version":"1.0.0"}"#.utf8).write(to: package)
        try Data(#"{"name":"dsh-runtime","version":"1.0.0","packages":{"node_modules/@deepseek-ai/dsh":{"version":"0.0.9"}}}"#.utf8).write(to: lock)
        DSHRuntimeSupport.bundledRuntimeOverride = (package, lock)
        defer { DSHRuntimeSupport.bundledRuntimeOverride = nil }
        // fake npm 安装出的 dsh 自报版本 0.1.1-rc.2，比 bundled 钉住的 0.0.9 新
        guard !DSHRuntimeSupport.needsRuntimeUpgrade(environment: [:]) else {
            throw TestError("bundled 版本更旧时不应判定为需要升级（会降级手动更新）")
        }
        try FileManager.default.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    // Menu-triggered update path: an explicit packageSpec must install exactly
    // that spec via `npm install`, ignoring the bundled lockfile even when one
    // is present — `npm ci` would replay the bundled pin instead of the target.
    private static func testExplicitVersionInstall(fakeNPM: URL) throws {
        let envFile = fakeNPM.deletingLastPathComponent().appendingPathComponent("env-explicit.txt")
        let specDir = fakeNPM.deletingLastPathComponent().appendingPathComponent("spec-explicit")
        try FileManager.default.createDirectory(at: specDir, withIntermediateDirectories: true)
        let package = specDir.appendingPathComponent("package.json")
        let lock = specDir.appendingPathComponent("package-lock.json")
        try Data(#"{"name":"dsh-runtime","version":"1.0.0"}"#.utf8).write(to: package)
        try Data(#"{"name":"dsh-runtime","version":"1.0.0","packages":{"node_modules/@deepseek-ai/dsh":{"version":"0.2.0"}}}"#.utf8).write(to: lock)
        DSHRuntimeSupport.bundledRuntimeOverride = (package, lock)
        defer { DSHRuntimeSupport.bundledRuntimeOverride = nil }

        let box = ResultBox()
        var output = ""
        _ = DSHRuntimeSupport.install(
            npmPath: fakeNPM.path,
            environment: ["DHL_NPM_REGISTRY": "https://npm.example.test", "FAKE_NPM_ENV_FILE": envFile.path],
            force: true,
            packageSpec: "@deepseek-ai/dsh@9.9.9",
            onOutput: { output += $0 },
            completion: { box.value = $0 }
        )
        waitForResult(box)
        guard case .success = box.value else {
            throw TestError("指定版本安装未成功")
        }
        guard let recorded = try? String(contentsOfFile: envFile.path, encoding: .utf8) else {
            throw TestError("指定版本安装未记录 npm 参数")
        }
        guard recorded.contains("ARGS=install "), recorded.contains("@deepseek-ai/dsh@9.9.9") else {
            throw TestError("指定版本安装未使用 npm install <spec>，参数：\(recorded)")
        }
        guard !recorded.contains("ci ") else {
            throw TestError("指定版本安装不应走 npm ci（会装回 bundled 锁定版本），参数：\(recorded)")
        }
        // 指定版本更新必须重新校验包元数据：prefer-offline 会直接用缓存里
        // 还没有新版本的旧 packument，把安装变成幻影 ETARGET。
        guard recorded.contains("--no-prefer-offline"), recorded.contains("npm_config_prefer_offline=false") else {
            throw TestError("指定版本安装必须禁用 prefer-offline 以刷新元数据，实际：\(recorded)")
        }
        guard output.contains("开始安装 @deepseek-ai/dsh@9.9.9") else {
            throw TestError("指定版本安装缺少目标版本提示")
        }
        // 指定版本更新会保留旧 runtime 作为回退快照，测试结束后清理
        DSHRuntimeSupport.discardRollback()
        try FileManager.default.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    // Rollback safety net: a version-targeted update must keep the previous
    // runtime as a snapshot; performRollback swaps it back; discardRollback
    // cleans it. The snapshot must carry the OLD bits (marker proves it), and
    // non-targeted installs (first install / lockfile upgrade) keep deleting
    // the old runtime as before.
    private static func testUpdateKeepsRollbackSnapshot(fakeNPM: URL) throws {
        // 1) 前置：装一个健康 runtime 并植入版本标记
        let first = runInstall(fakeNPM: fakeNPM, environment: [:])
        guard case .success = first else {
            throw TestError("回退测试的前置安装未成功")
        }
        let markerDir = DSHRuntimeSupport.runtimeURL.appendingPathComponent("node_modules/@deepseek-ai/dsh", isDirectory: true)
        try FileManager.default.createDirectory(at: markerDir, withIntermediateDirectories: true)
        let marker = markerDir.appendingPathComponent("package.json")
        try Data(#"{"name":"@deepseek-ai/dsh","version":"0.1.1"}"#.utf8).write(to: marker)

        // 2) 版本定向更新 → 快照存在且版本可读，现行 runtime 标记消失
        let box = ResultBox()
        _ = DSHRuntimeSupport.install(
            npmPath: fakeNPM.path,
            environment: [:],
            force: true,
            packageSpec: "@deepseek-ai/dsh@9.9.9",
            onOutput: { _ in },
            completion: { box.value = $0 }
        )
        waitForResult(box)
        guard case .success = box.value else {
            throw TestError("回退测试的更新安装未成功")
        }
        guard DSHRuntimeSupport.hasRollback() else {
            throw TestError("版本定向更新后未保留回退快照")
        }
        guard DSHRuntimeSupport.rollbackVersion() == "0.1.1" else {
            throw TestError("回退快照版本读取失败：\(DSHRuntimeSupport.rollbackVersion() ?? "nil")")
        }
        guard !FileManager.default.fileExists(atPath: marker.path) else {
            throw TestError("更新后现行 runtime 不应仍带旧版本标记")
        }

        // 3) 回退 → 旧标记回到现行位置，快照清空，runtime 健康
        guard DSHRuntimeSupport.performRollback() else {
            throw TestError("回退换入失败")
        }
        guard FileManager.default.fileExists(atPath: marker.path), DSHRuntimeSupport.isInstalled() else {
            throw TestError("回退后现行 runtime 未恢复为旧版本")
        }
        guard !DSHRuntimeSupport.hasRollback() else {
            throw TestError("回退后快照应被消费")
        }

        // 4) 非定向安装（force 升级路径）不保留快照
        let upgradeBox = ResultBox()
        _ = DSHRuntimeSupport.install(
            npmPath: fakeNPM.path,
            environment: [:],
            force: true,
            onOutput: { _ in },
            completion: { upgradeBox.value = $0 }
        )
        waitForResult(upgradeBox)
        guard case .success = upgradeBox.value else {
            throw TestError("非定向升级安装未成功")
        }
        guard !DSHRuntimeSupport.hasRollback() else {
            throw TestError("非定向安装不应保留回退快照")
        }
        DSHRuntimeSupport.discardRollback()
        try FileManager.default.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    // Interrupted-update recovery: replacing the runtime is a two-step rename
    // (old aside, new in). If the app dies in between, the only copy of a working
    // environment sits in `runtime.previous-*`. That snapshot must be recognised
    // and swapped back — a missing runtime must not turn into a forced reinstall
    // (the user cannot decline that without losing a working environment).
    private static func testInterruptedUpdateRecoversSnapshot(fakeNPM: URL) throws {
        let fileManager = FileManager.default
        try? fileManager.removeItem(at: DSHRuntimeSupport.runtimeURL)
        DSHRuntimeSupport.discardRollback()
        let snapshot = DSHRuntimeSupport.runtimeURL.deletingLastPathComponent()
            .appendingPathComponent("runtime.previous-\(UUID().uuidString)", isDirectory: true)
        try writeHealthyRuntime(at: snapshot)
        defer { try? fileManager.removeItem(at: snapshot) }

        guard !DSHRuntimeSupport.isInstalled() else { throw TestError("快照恢复测试前置：正式 runtime 应缺失") }
        // 比路径要先把符号链接解开：temporaryDirectory 走的是 /var/...，而
        // contentsOfDirectory 回的是解析后的 /private/var/...。
        let expected = snapshot.resolvingSymlinksInPath().path
        guard DSHRuntimeSupport.hasRuntimeSnapshot(),
              DSHRuntimeSupport.runtimeSnapshotURL()?.resolvingSymlinksInPath().path == expected else {
            throw TestError("runtime.previous-* 未被认成可恢复的运行环境快照")
        }

        var output = ""
        let result = runInstall(fakeNPM: fakeNPM, environment: [:]) { output += $0 }
        guard case .success = result else { throw TestError("快照恢复后的安装流程未成功") }
        guard output.contains("已从快照恢复现有运行环境") else {
            throw TestError("未走快照恢复路径，实际输出：\(output)")
        }
        guard !output.contains("尝试 npm registry") else {
            throw TestError("快照可恢复时仍然联网重装了运行环境")
        }
        guard DSHRuntimeSupport.isInstalled(), DSHRuntimeSupport.canAttemptLaunch() else {
            throw TestError("恢复后的运行环境不可用")
        }
        guard !fileManager.fileExists(atPath: snapshot.path) else {
            throw TestError("快照未被换入正式位置")
        }
        guard DSHRuntimeSupport.runtimeSnapshotURL() == nil else {
            throw TestError("恢复后仍残留快照（下次会被当成垃圾）")
        }
        try? fileManager.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    // A runtime that was left half-installed must not block the snapshot: the
    // snapshot is a complete environment, the leftover is not. The replaced
    // half-runtime is parked as runtime.broken-* and removed, so no residue is
    // left to confuse the next launch.
    private static func testSnapshotReplacesHalfRuntime(fakeNPM: URL) throws {
        let fileManager = FileManager.default
        try? fileManager.removeItem(at: DSHRuntimeSupport.runtimeURL)
        DSHRuntimeSupport.discardRollback()
        // 半份 runtime：只剩可执行文件，依赖树是空的（isInstalled() 为假）
        try fileManager.createDirectory(
            at: DSHRuntimeSupport.runtimeURL.appendingPathComponent("node_modules/.bin", isDirectory: true),
            withIntermediateDirectories: true
        )
        let halfExecutable = DSHRuntimeSupport.executableURL
        try Data("#!/bin/sh\nexit 1\n".utf8).write(to: halfExecutable)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: halfExecutable.path)
        let snapshot = DSHRuntimeSupport.runtimeURL.deletingLastPathComponent()
            .appendingPathComponent("runtime.previous-\(UUID().uuidString)", isDirectory: true)
        try writeHealthyRuntime(at: snapshot)
        defer { try? fileManager.removeItem(at: snapshot) }

        guard DSHRuntimeSupport.restoreRuntimeSnapshot() else {
            throw TestError("半份 runtime 挡路时快照未换入")
        }
        guard DSHRuntimeSupport.isInstalled() else { throw TestError("换入后的运行环境不完整") }
        let residue = (try? fileManager.contentsOfDirectory(
            atPath: DSHRuntimeSupport.runtimeURL.deletingLastPathComponent().path
        )) ?? []
        guard !residue.contains(where: { $0.hasPrefix("runtime.broken-") }) else {
            throw TestError("换入后仍留下 runtime.broken-* 垃圾")
        }
        guard !fileManager.fileExists(atPath: snapshot.path) else { throw TestError("快照未消费") }
        try? fileManager.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    // Judging "can we try to launch" by the full dependency tree would declare a
    // runnable environment dead and force a reinstall. The launcher's boundary
    // check (isInstalled) and its launch check (canAttemptLaunch) must stay
    // separate: dsh itself is the authority on whether its install works.
    private static func testHalfRuntimeIsStillLaunchable() throws {
        let fileManager = FileManager.default
        try? fileManager.removeItem(at: DSHRuntimeSupport.runtimeURL)
        try fileManager.createDirectory(
            at: DSHRuntimeSupport.runtimeURL.appendingPathComponent("node_modules/.bin", isDirectory: true),
            withIntermediateDirectories: true
        )
        let executable = DSHRuntimeSupport.executableURL
        try Data("#!/bin/sh\nprintf \"0.1.1-rc.2\\n\"\n".utf8).write(to: executable)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        guard !DSHRuntimeSupport.isInstalled() else { throw TestError("半份 runtime 不应被判成完整安装") }
        guard DSHRuntimeSupport.canAttemptLaunch() else { throw TestError("dsh 本体还在时却判定为不可启动") }
        try? fileManager.removeItem(at: DSHRuntimeSupport.runtimeURL)
    }

    private static func writeHealthyRuntime(at root: URL) throws {
        let fileManager = FileManager.default
        for package in ["cordis-plugin-group", "dsh-app-boot"] {
            let directory = root.appendingPathComponent("node_modules/@deepseek-ai/\(package)", isDirectory: true)
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data(#"{"name":"@deepseek-ai/\#(package)"}"#.utf8).write(to: directory.appendingPathComponent("package.json"))
        }
        let bin = root.appendingPathComponent("node_modules/.bin", isDirectory: true)
        try fileManager.createDirectory(at: bin, withIntermediateDirectories: true)
        let executable = bin.appendingPathComponent("dsh")
        try Data("#!/bin/sh\nprintf \"0.1.1-rc.2\\n\"\n".utf8).write(to: executable)
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
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

    /// A missing runtime is NOT a first install when DeepSeek Harness has
    /// profiles or a dependency tree already on disk: the launcher should rebuild
    /// the runtime in place, not start first-install onboarding.
    private static func testHasHarnessInstall() throws {
        let fileManager = FileManager.default
        let previousHome = ProcessInfo.processInfo.environment["DSH_HOME"]
        let dshHome = fileManager.temporaryDirectory
            .appendingPathComponent("dsh-has-harness-\(UUID().uuidString)", isDirectory: true)
        setenv("DSH_HOME", dshHome.path, 1)
        defer {
            if let previousHome { setenv("DSH_HOME", previousHome, 1) } else { unsetenv("DSH_HOME") }
            try? fileManager.removeItem(at: dshHome)
        }

        let profiles = dshHome.appendingPathComponent("profiles", isDirectory: true)

        // Clean environment: no harness install.
        precondition(!DSHRuntimeSupport.hasHarnessInstall())

        // ① An initialized profile (web/package.json) counts as an install.
        try fileManager.createDirectory(at: profiles.appendingPathComponent("web"), withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: profiles.appendingPathComponent("web/package.json"))
        precondition(DSHRuntimeSupport.hasHarnessInstall())

        // ② A dependency tree under @deepseek-ai also counts (dangling symlinks
        // from a cleaned runtime still prove the tree was installed once).
        try fileManager.removeItem(at: profiles.appendingPathComponent("web"))
        let scoped = profiles.appendingPathComponent("node_modules/@deepseek-ai")
        try fileManager.createDirectory(at: scoped.appendingPathComponent("dsh"), withIntermediateDirectories: true)
        precondition(DSHRuntimeSupport.hasHarnessInstall())

        // A random scoped name must NOT count as a harness install.
        try fileManager.removeItem(at: dshHome)
        let unrelated = profiles.appendingPathComponent("node_modules/@random-vendor")
        try fileManager.createDirectory(at: unrelated, withIntermediateDirectories: true)
        precondition(!DSHRuntimeSupport.hasHarnessInstall())
    }

    private struct TestError: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
}
