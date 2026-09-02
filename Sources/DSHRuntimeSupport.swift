import Foundation
import Darwin

enum DSHRuntimeError: LocalizedError {
    case installFailed(String)
    case executableMissing
    case cancelled

    var errorDescription: String? {
        switch self {
        case .installFailed(let output):
            guard !output.isEmpty else { return "npm 安装 dsh 失败" }
            let detail = output.count > 6000 ? String(output.suffix(6000)) : output
            return "npm 安装 dsh 失败：\n\(detail)"
        case .executableMissing:
            return "npm 安装完成，但未找到 dsh 可执行文件"
        case .cancelled:
            return "已取消 dsh 安装"
        }
    }
}

final class DSHRuntimeInstallHandle {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false

    fileprivate func attach(_ process: Process) {
        lock.lock()
        self.process = process
        let shouldCancel = cancelled
        lock.unlock()
        if shouldCancel { process.terminate() }
    }

    fileprivate func isCancelled() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let process = self.process
        lock.unlock()
        if let process, process.isRunning {
            let pid = process.processIdentifier
            DispatchQueue.global(qos: .utility).async {
                DSHRuntimeSupport.terminateProcessTree(pid: pid)
            }
        }
    }
}

enum DSHRuntimeSupport {
    private static let fileManager = FileManager.default

    static var runtimeURL: URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent(".dsh", isDirectory: true)
            .appendingPathComponent("runtime", isDirectory: true)
    }

    static var executableURL: URL {
        runtimeURL.appendingPathComponent("node_modules/.bin/dsh")
    }

    static func isInstalled() -> Bool {
        runtimeIsHealthy(runtimeURL)
    }

    private static func runtimeIsHealthy(_ root: URL) -> Bool {
        let executable = root.appendingPathComponent("node_modules/.bin/dsh")
        guard fileManager.isExecutableFile(atPath: executable.path) else { return false }
        let requiredPackages = [
            "@deepseek-ai/cordis-plugin-group/package.json",
            "@deepseek-ai/dsh-app-boot/package.json"
        ]
        return requiredPackages.allSatisfy {
            fileManager.fileExists(atPath: root.appendingPathComponent("node_modules").appendingPathComponent($0).path)
        }
    }

    static func terminateProcessTree(pid: Int32) {
        let descendants = descendantProcessIDs(of: pid)
        for child in descendants.reversed() { _ = Darwin.kill(child, SIGTERM) }
        _ = Darwin.kill(pid, SIGTERM)
        usleep(500_000)
        let remaining = Array(Set(descendants + descendantProcessIDs(of: pid) + [pid]))
        for child in remaining.reversed() { _ = Darwin.kill(child, SIGKILL) }
    }

    private static func descendantProcessIDs(of root: Int32) -> [Int32] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-axo", "pid=,ppid="]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return []
        }
        var childrenByParent: [Int32: [Int32]] = [:]
        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        for line in output.split(whereSeparator: \.isNewline) {
            let fields = line.split(whereSeparator: { $0 == " " || $0 == "\t" })
            guard fields.count >= 2, let child = Int32(fields[0]), let parent = Int32(fields[1]) else { continue }
            childrenByParent[parent, default: []].append(child)
        }
        var result: [Int32] = []
        var queue = childrenByParent[root] ?? []
        while let parent = queue.popLast() {
            result.append(parent)
            queue.append(contentsOf: childrenByParent[parent] ?? [])
        }
        return result
    }

    static func install(
        npmPath: String,
        environment: [String: String],
        onOutput: @escaping (String) -> Void,
        completion: @escaping (Result<URL, Error>) -> Void
    ) -> DSHRuntimeInstallHandle {
        let handle = DSHRuntimeInstallHandle()
        // A healthy fixed runtime is the installation boundary. Never replace it
        // merely because a caller requests installation again.
        if isInstalled() {
            onOutput("已检测到完整 dsh runtime，跳过 npm 下载\n")
            DispatchQueue.main.async { completion(.success(executableURL)) }
            return handle
        }
        let root = runtimeURL.deletingLastPathComponent()
        do {
            try fileManager.createDirectory(at: root, withIntermediateDirectories: true)
            cleanupInterruptedInstalls(in: root)
        } catch {
            DispatchQueue.main.async { completion(.failure(error)) }
            return handle
        }

        let registries = LauncherEnvironment.npmRegistryCandidates(environment: environment)
        runInstallAttempt(
            npmPath: npmPath,
            environment: environment,
            registries: registries,
            index: 0,
            root: root,
            handle: handle,
            onOutput: onOutput,
            completion: completion
        )
        return handle
    }

    private static func cleanupInterruptedInstalls(in root: URL) {
        guard let entries = try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return }
        for entry in entries {
            let name = entry.lastPathComponent
            guard name.hasPrefix("runtime.installing-") || name.hasPrefix("runtime.previous-") else { continue }
            try? fileManager.removeItem(at: entry)
        }
    }

    private static func runInstallAttempt(
        npmPath: String,
        environment: [String: String],
        registries: [String],
        index: Int,
        root: URL,
        handle: DSHRuntimeInstallHandle,
        onOutput: @escaping (String) -> Void,
        completion: @escaping (Result<URL, Error>) -> Void
    ) {
        guard !handle.isCancelled() else {
            DispatchQueue.main.async {
                completion(.failure(DSHRuntimeError.cancelled))
            }
            return
        }
        guard index < registries.count else {
            DispatchQueue.main.async {
                completion(.failure(DSHRuntimeError.installFailed("所有 npm registry 均安装失败，请检查网络后重试")))
            }
            return
        }

        let registry = registries[index]
        let staging = root.appendingPathComponent(
            "runtime.installing-\(ProcessInfo.processInfo.processIdentifier)-\(UUID().uuidString)",
            isDirectory: true
        )
        onOutput("尝试 npm registry：\(registry)\n")

        let task = Process()
        task.executableURL = URL(fileURLWithPath: npmPath)
        task.arguments = [
            "install", "--prefix", staging.path,
            "--no-package-lock", "--no-audit", "--no-fund", "--progress", "--loglevel=silly",
            "--prefer-offline", "--registry", registry,
            "@deepseek-ai/dsh"
        ]
        task.currentDirectoryURL = fileManager.homeDirectoryForCurrentUser
        var attemptEnvironment = environment
        attemptEnvironment["npm_config_registry"] = registry
        attemptEnvironment["npm_config_prefer_offline"] = "true"
        attemptEnvironment["npm_config_progress"] = "true"
        attemptEnvironment["npm_config_loglevel"] = "silly"
        attemptEnvironment["npm_config_color"] = "false"
        task.environment = attemptEnvironment
        let pipe = Pipe()
        let lock = NSLock()
        var outputData = Data()
        task.standardOutput = pipe
        task.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else {
                handle.readabilityHandler = nil
                return
            }
            lock.lock()
            outputData.append(data)
            lock.unlock()
            if let text = String(data: data, encoding: .utf8) { onOutput(text) }
        }
        task.terminationHandler = { terminated in
            pipe.fileHandleForReading.readabilityHandler = nil
            let remaining = pipe.fileHandleForReading.readDataToEndOfFile()
            lock.lock()
            outputData.append(remaining)
            lock.unlock()
            if !remaining.isEmpty, let text = String(data: remaining, encoding: .utf8) { onOutput(text) }

            if handle.isCancelled() {
                try? fileManager.removeItem(at: staging)
                DispatchQueue.main.async {
                    completion(.failure(DSHRuntimeError.cancelled))
                }
                return
            }

            let output = String(data: outputData, encoding: .utf8) ?? ""
            guard terminated.terminationStatus == 0 else {
                try? fileManager.removeItem(at: staging)
                if index == registries.count - 1 {
                    DispatchQueue.main.async {
                        completion(.failure(DSHRuntimeError.installFailed(output.trimmingCharacters(in: .whitespacesAndNewlines))))
                    }
                    return
                }
                onOutput("registry \(registry) 安装失败，准备尝试备用源…\n")
                runInstallAttempt(
                    npmPath: npmPath,
                    environment: environment,
                    registries: registries,
                    index: index + 1,
                    root: root,
                    handle: handle,
                    onOutput: onOutput,
                    completion: completion
                )
                return
            }

            guard runtimeIsHealthy(staging) else {
                try? fileManager.removeItem(at: staging)
                if index == registries.count - 1 {
                    DispatchQueue.main.async { completion(.failure(DSHRuntimeError.executableMissing)) }
                    return
                }
                onOutput("registry \(registry) 安装结果不完整，准备尝试备用源…\n")
                runInstallAttempt(
                    npmPath: npmPath,
                    environment: environment,
                    registries: registries,
                    index: index + 1,
                    root: root,
                    handle: handle,
                    onOutput: onOutput,
                    completion: completion
                )
                return
            }

            let stagedExecutable = staging.appendingPathComponent("node_modules/.bin/dsh")
            if let validationError = validate(executable: stagedExecutable, environment: attemptEnvironment) {
                try? fileManager.removeItem(at: staging)
                if index == registries.count - 1 {
                    DispatchQueue.main.async { completion(.failure(validationError)) }
                    return
                }
                onOutput("registry \(registry) 的 dsh 自检失败，准备尝试备用源…\n")
                runInstallAttempt(
                    npmPath: npmPath,
                    environment: environment,
                    registries: registries,
                    index: index + 1,
                    root: root,
                    handle: handle,
                    onOutput: onOutput,
                    completion: completion
                )
                return
            }
            if handle.isCancelled() {
                try? fileManager.removeItem(at: staging)
                DispatchQueue.main.async {
                    completion(.failure(DSHRuntimeError.cancelled))
                }
                return
            }

            do {
                if fileManager.fileExists(atPath: runtimeURL.path) {
                    let backup = root.appendingPathComponent("runtime.previous-\(UUID().uuidString)")
                    try fileManager.moveItem(at: runtimeURL, to: backup)
                    do {
                        try fileManager.moveItem(at: staging, to: runtimeURL)
                        try? fileManager.removeItem(at: backup)
                    } catch {
                        try? fileManager.moveItem(at: backup, to: runtimeURL)
                        throw error
                    }
                } else {
                    try fileManager.moveItem(at: staging, to: runtimeURL)
                }
                onOutput("npm 安装完成，registry：\(registry)\n")
                DispatchQueue.main.async { completion(.success(executableURL)) }
            } catch {
                try? fileManager.removeItem(at: staging)
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
        do {
            try task.run()
            handle.attach(task)
        } catch {
            try? fileManager.removeItem(at: staging)
            DispatchQueue.main.async { completion(.failure(error)) }
        }
    }

    private static func validate(executable: URL, environment: [String: String]) -> Error? {
        let task = Process()
        task.executableURL = executable
        task.arguments = ["--version"]
        task.environment = environment
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            return error
        }
        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard task.terminationStatus == 0 else {
            return DSHRuntimeError.installFailed("安装后的 dsh 自检失败：\(output)")
        }
        return nil
    }
}
