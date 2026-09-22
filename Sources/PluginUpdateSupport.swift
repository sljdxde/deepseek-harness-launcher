import Foundation

/// 内置 dsh-plugin-manager 的 `/dsh-plugin-manager/updates` 响应。
/// 只解启动器真正用到的字段：可更新数量、进行中的更新进度、最近一次批量更新结果。
/// （纯数据 + 纯映射，单测见 scripts/test-plugin-updates.swift。）
struct PluginUpdatesSnapshot: Decodable, Equatable {
    struct Summary: Decodable, Equatable {
        let updateAvailable: Int
    }

    struct Progress: Decodable, Equatable {
        let active: Bool
        let kind: String?
        let total: Int?
        let done: Int?
        let current: String?
        let step: String?
    }

    struct Result: Decodable, Equatable {
        let name: String
        let ok: Bool
        let error: String?
    }

    struct Batch: Decodable, Equatable {
        let finishedAt: String?
        let updated: Int?
        let failed: Int?
        let results: [Result]?
    }

    let summary: Summary
    let progress: Progress?
    let lastBatch: Batch?

    /// 解析响应体；nil / 空 body / HTML / `{"error":…}`（外部实例 404 降级）都返回 nil。
    static func parse(_ body: String?) -> PluginUpdatesSnapshot? {
        guard let body, !body.isEmpty, let data = body.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(PluginUpdatesSnapshot.self, from: data)
    }
}

/// 进度窗口要显示的三要素：状态行、明细行、进度百分比。
struct PluginUpdateProgressPresentation: Equatable {
    let status: String
    let detail: String
    let percentage: Double
}

enum PluginUpdatePresentation {
    /// 进行中的更新 → 进度窗口文案；没有在更新时返回 nil（窗口据此收起）。
    /// 字段缺失或异常都不会让窗口显示成空白：总数按 1、序号夹在 [1, total]。
    static func progress(_ progress: PluginUpdatesSnapshot.Progress?) -> PluginUpdateProgressPresentation? {
        guard let progress, progress.active else { return nil }
        let total = max(progress.total ?? 1, 1)
        let currentIndex = min(max((progress.done ?? 0) + 1, 1), total)
        let step = (progress.step?.isEmpty == false) ? progress.step! : "正在准备…"
        let name = progress.current?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return PluginUpdateProgressPresentation(
            status: "正在更新插件（\(currentIndex)/\(total)）",
            detail: name.isEmpty ? step : "\(name) · \(step)",
            percentage: Double(currentIndex) / Double(total) * 100
        )
    }

    /// 最近一次批量更新的收尾文案；没有新批次（finishedAt 缺失）时返回 nil。
    static func batchSummary(_ batch: PluginUpdatesSnapshot.Batch?) -> String? {
        guard let finishedAt = batch?.finishedAt, !finishedAt.isEmpty else { return nil }
        let updated = batch?.updated ?? 0
        let failed = batch?.failed ?? 0
        return failed == 0
            ? "插件更新完成（\(updated) 个）"
            : "插件更新完成：\(updated) 个成功、\(failed) 个失败"
    }
}
