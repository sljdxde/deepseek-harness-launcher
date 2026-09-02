import Foundation

struct DSHInstallProgressSnapshot: Equatable {
    let detail: String
    let percentage: Double?
}

/// Turns npm's line-oriented progress output into a small, user-facing
/// installation status. The percentage is shown only when npm has emitted
/// both a stable dependency total and real package-completion events.
final class DSHInstallProgressTracker {
    private enum Phase: Int, CaseIterable {
        case preparing
        case resolving
        case downloading
        case installing
        case validating

        var title: String {
            switch self {
            case .preparing: return "准备 npm 安装"
            case .resolving: return "解析 dsh 依赖"
            case .downloading: return "下载 dsh 依赖"
            case .installing: return "写入本地 runtime"
            case .validating: return "校验 dsh 安装"
            }
        }
    }

    private let lock = NSLock()
    private var phase: Phase = .preparing
    private var completedDownloads = 0
    private var placeDepKeys = Set<String>()
    private var addKeys = Set<String>()
    private var totalPackages: Int?
    private var installationCompleted = false
    private var outputBuffer = ""
    func consume(_ text: String) -> DSHInstallProgressSnapshot {
        lock.lock()
        defer { lock.unlock() }

        outputBuffer.append(text.replacingOccurrences(of: "\r", with: "\n"))
        let lines = outputBuffer.split(separator: "\n", omittingEmptySubsequences: false)
        outputBuffer = String(lines.last ?? "")
        for line in lines.dropLast() {
            consumeLine(String(line))
        }
        return snapshotLocked()
    }

    func snapshot() -> DSHInstallProgressSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return snapshotLocked()
    }

    private func consumeLine(_ line: String) {
        let normalized = line.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return }

        if normalized.contains("尝试 npm registry：") || normalized.contains("trying npm registry:") {
            resetForRetry()
            return
        }

        if let addedCount = packageCount(in: normalized), normalized.contains(" packages in ") {
            installationCompleted = true
            if addedCount > 0 { totalPackages = max(totalPackages ?? 0, addedCount) }
            advance(to: .validating)
            return
        }

        if normalized.contains("npm 安装完成") || normalized.contains("install complete") ||
            normalized.contains("up to date") || normalized.contains(" packages in ") {
            installationCompleted = true
            advance(to: .validating)
            return
        }

        if let key = packageKey(in: normalized, marker: "placedep") {
            placeDepKeys.insert(key)
            advance(to: .resolving)
        } else if normalized.contains("reify") {
            if totalPackages == nil, !placeDepKeys.isEmpty {
                totalPackages = placeDepKeys.count
            }
            advance(to: .installing)
        } else if let key = packageKey(in: normalized, marker: "add") {
            addKeys.insert(key)
            // npm may emit ADD events without a preceding `reify` line. Once
            // real package placement and completion events are both present,
            // use the observed dependency graph as the stable denominator.
            if totalPackages == nil, !placeDepKeys.isEmpty {
                totalPackages = placeDepKeys.count
            }
            advance(to: .installing)
        } else if normalized.contains("npm info run") || normalized.contains("extract") || normalized.contains("link") {
            advance(to: .installing)
        } else if normalized.contains("http fetch") || normalized.contains("fetch manifest") || normalized.contains("fetch get") {
            advance(to: .downloading)
            if normalized.contains(" 200 ") || normalized.contains(" 304 ") || normalized.contains(" cache hit") {
                completedDownloads += 1
            }
        } else if normalized.contains("idealtree") || normalized.contains("ideal tree") || normalized.contains("sill arborist") {
            advance(to: .resolving)
        }
    }

    private func packageKey(in line: String, marker: String) -> String? {
        guard let markerRange = line.range(of: " \(marker) ") else { return nil }
        let payload = line[markerRange.upperBound...]
        let beforeStatus = payload.components(separatedBy: " ok for:").first ?? String(payload)
        let token = beforeStatus
            .split(whereSeparator: { $0 == " " || $0 == "\t" })
            .drop(while: { $0 == "root" })
            .first
        guard let token, !token.isEmpty else { return nil }
        return String(token)
    }

    private func packageCount(in line: String) -> Int? {
        guard let match = line.range(of: #"(?:added|removed|changed)\s+(\d+)\s+packages"#, options: .regularExpression) else { return nil }
        let digits = line[match].split(whereSeparator: { !$0.isNumber }).first
        return digits.flatMap { Int($0) }
    }

    private func resetForRetry() {
        phase = .preparing
        completedDownloads = 0
        placeDepKeys.removeAll()
        addKeys.removeAll()
        totalPackages = nil
        installationCompleted = false
    }

    private func advance(to next: Phase) {
        guard next.rawValue >= phase.rawValue else { return }
        guard next != phase else { return }
        phase = next
    }

    private func snapshotLocked() -> DSHInstallProgressSnapshot {
        let detail: String
        switch phase {
        case .downloading where completedDownloads > 0:
            detail = "当前 npm 操作：\(phase.title)；已收到 \(completedDownloads) 条成功下载记录"
        default:
            detail = "当前 npm 操作：\(phase.title)"
        }

        let percentage: Double?
        if installationCompleted {
            percentage = 100
        } else if let totalPackages, totalPackages > 0, !addKeys.isEmpty {
            let rawPercentage = min(100, Double(addKeys.count) / Double(totalPackages) * 100)
            percentage = (rawPercentage * 100).rounded() / 100
        } else {
            percentage = nil
        }

        let percentageDetail: String
        if let percentage {
            percentageDetail = "\(detail)；安装进度：\(String(format: "%.2f%%", locale: Locale(identifier: "en_US_POSIX"), percentage))"
        } else {
            percentageDetail = detail
        }
        return DSHInstallProgressSnapshot(
            detail: percentageDetail,
            percentage: percentage
        )
    }
}
