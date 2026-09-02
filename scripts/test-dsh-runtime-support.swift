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
