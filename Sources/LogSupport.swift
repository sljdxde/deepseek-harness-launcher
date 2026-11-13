import Foundation

func formatLogTimestamp(_ date: Date = Date(), timeZone: TimeZone = .current) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = timeZone
    formatter.dateFormat = "yyyy-MM-dd HH:mm:ss Z"
    return formatter.string(from: date)
}

/// 追加写日志的常驻句柄：不再每块输出都 open/seek/write/close，并在超过上限时
/// 轮转成 `<name>.1`。线程安全（stdout/stderr 两条管道会并发进来），失败一律吞掉：
/// 日志不能影响启动器生命周期。
final class LogFileWriter {
    let url: URL
    let maxBytes: UInt64
    private let fileManager: FileManager
    private let lock = NSLock()
    private var handle: FileHandle?

    init(url: URL, maxBytes: UInt64 = 2 * 1024 * 1024, fileManager: FileManager = .default) {
        self.url = url
        self.maxBytes = max(1, maxBytes)
        self.fileManager = fileManager
    }

    deinit { close() }

    func append(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock(); defer { lock.unlock() }
        guard let handle = openLocked() else { return }
        do {
            let end = try handle.seekToEnd()
            // end > 0：刚轮转出来的空文件不再立即轮转，否则会丢第一条。
            if end > 0, end + UInt64(data.count) > maxBytes {
                rotateLocked()
                guard let rotated = openLocked() else { return }
                _ = try rotated.seekToEnd()
                try rotated.write(contentsOf: data)
            } else {
                try handle.write(contentsOf: data)
            }
        } catch {
            // 写日志失败不能打断主流程；下一次 append 会重新尝试。
            closeLocked()
        }
    }

    func close() {
        lock.lock(); defer { lock.unlock() }
        closeLocked()
    }

    private func openLocked() -> FileHandle? {
        if let handle { return handle }
        if !fileManager.fileExists(atPath: url.path) {
            fileManager.createFile(atPath: url.path, contents: nil)
        }
        guard let opened = try? FileHandle(forWritingTo: url) else { return nil }
        handle = opened
        return opened
    }

    private func closeLocked() {
        try? handle?.close()
        handle = nil
    }

    private func rotateLocked() {
        closeLocked()
        let backup = url.appendingPathExtension("1")
        try? fileManager.removeItem(at: backup)
        try? fileManager.moveItem(at: url, to: backup)
    }
}
