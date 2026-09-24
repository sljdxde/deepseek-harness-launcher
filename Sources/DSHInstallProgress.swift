import Foundation

struct DSHInstallProgressSnapshot: Equatable {
    let detail: String
    /// 现在始终返回一个 0...100 的百分比，进度条不再长时间停在 indeterminate。
    /// 早期阶段没有精确分母时按阶段权重推进，拿到 placeDep/ADD 计数后切到精确比例。
    let percentage: Double
}

/// Turns npm's line-oriented progress output into a small, user-facing
/// installation status. The percentage is stage-weighted so the bar moves
/// even before npm emits a stable dependency total; once placeDep and ADD
/// events arrive it switches to the real observed ratio.
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
            case .resolving: return "解析依赖"
            case .downloading: return "下载依赖"
            case .installing: return "写入本地 runtime"
            case .validating: return "校验安装"
            }
        }

        /// 该阶段起始的百分比（0...100）。
        var lowerBound: Double {
            switch self {
            case .preparing: return 0
            case .resolving: return 3
            case .downloading: return 15
            case .installing: return 65
            case .validating: return 95
            }
        }

        /// 该阶段结束时的百分比。
        var upperBound: Double {
            switch self {
            case .preparing: return 3
            case .resolving: return 15
            case .downloading: return 65
            case .installing: return 95
            case .validating: return 100
            }
        }
    }

    private let lock = NSLock()
    private var phase: Phase = .preparing
    private var downloadedTgzCount = 0
    private var placeDepKeys = Set<String>()
    private var addKeys = Set<String>()
    private var installationCompleted = false
    private var outputBuffer = ""
    /// 上次吐出的百分比，用于保证单调递增（npm 重试 reset 时一并清零）。
    private var lastPercentage: Double = 0

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

        if packageCount(in: normalized) != nil, normalized.contains(" packages in ") {
            installationCompleted = true
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
            advance(to: .installing)
        } else if let key = packageKey(in: normalized, marker: "add") {
            addKeys.insert(key)
            advance(to: .installing)
        } else if normalized.contains("npm info run") || normalized.contains("extract") || normalized.contains("link") {
            advance(to: .installing)
        } else if normalized.contains("http fetch") || normalized.contains("fetch manifest") || normalized.contains("fetch get") {
            advance(to: .downloading)
            // 只数实际的 tarball 下载（URL 含 .tgz），manifest 请求不记入分子，
            // 否则下载进度会因每个包两次请求（manifest + tarball）而虚高。
            let success = normalized.contains(" 200 ") || normalized.contains(" 304 ") || normalized.contains(" cache hit")
            if success, normalized.contains(".tgz") {
                downloadedTgzCount += 1
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
        downloadedTgzCount = 0
        placeDepKeys.removeAll()
        addKeys.removeAll()
        installationCompleted = false
        lastPercentage = 0
    }

    private func advance(to next: Phase) {
        guard next.rawValue >= phase.rawValue else { return }
        guard next != phase else { return }
        phase = next
    }

    /// 该阶段内部 0...1 的进度：有精确分母时按分子/分母算，否则按已见事件数
    /// 做一个缓增（让进度条在阶段内也能缓慢爬升，而不是钉死在阶段下界）。
    private func phaseFraction() -> Double {
        switch phase {
        case .preparing:
            return 0
        case .resolving:
            // 解析阶段还不知道总包数：placeDep 每多一个包推一点，前 ~40 个包
            // 线性推满这个阶段。小包直接满。
            return min(1.0, Double(placeDepKeys.count) / 40.0)
        case .downloading:
            let total = max(1, placeDepKeys.count)
            return min(1.0, Double(downloadedTgzCount) / Double(total))
        case .installing:
            let total = max(1, placeDepKeys.count)
            return min(1.0, Double(addKeys.count) / Double(total))
        case .validating:
            return installationCompleted ? 1.0 : 0.6
        }
    }

    private func snapshotLocked() -> DSHInstallProgressSnapshot {
        let detail: String
        switch phase {
        case .downloading where downloadedTgzCount > 0:
            detail = "当前 npm 操作：\(phase.title)；已下载 \(downloadedTgzCount) 个包"
        case .installing where !addKeys.isEmpty:
            let total = placeDepKeys.isEmpty ? addKeys.count : placeDepKeys.count
            detail = "当前 npm 操作：\(phase.title)；已写入 \(addKeys.count)/\(total) 个包"
        default:
            detail = "当前 npm 操作：\(phase.title)"
        }

        let lower = phase.lowerBound
        let upper = phase.upperBound
        let rawPct = installationCompleted ? 100.0 : lower + phaseFraction() * (upper - lower)
        // 单调递增：阶段回退（重试）时 lastPercentage 已被清零，正常推进时不会回退。
        let pct = max(lastPercentage, min(100, rawPct))
        lastPercentage = pct

        return DSHInstallProgressSnapshot(
            detail: detail,
            percentage: (pct * 10).rounded() / 10
        )
    }
}
