import Foundation

/// 启动器侧「插件更新」的纯逻辑单测：/updates 响应的解码与进度窗口文案映射。
/// 这些逻辑以前埋在 main.swift 的私有方法里，测不到——TDD 化之后先有断言，
/// main.swift 只负责把结果喂给进度窗口。
@main
struct PluginUpdateSupportChecks {
    static func main() {
        checkSnapshotDecoding()
        checkProgressPresentation()
        checkBatchSummary()
        print("plugin update support checks passed")
    }

    /// 真实响应样本（取自本机 /dsh-plugin-manager/updates）。
    static let sampleJSON = """
    {
      "checkedAt": "2026-09-22T11:15:29.597Z",
      "refreshing": false,
      "summary": { "total": 4, "updateAvailable": 2, "failed": 0, "unknown": 0 },
      "inventory": [
        { "name": "@openviking/dsh-memory-plugin", "kind": "git", "installedVersion": "0.3.0",
          "status": "update-available", "latestVersion": "0.5.0", "major": false },
        { "name": "dsh-notify", "kind": "git", "installedVersion": "0.5.1",
          "status": "up-to-date", "latestVersion": "0.5.1" }
      ],
      "progress": { "active": true, "kind": "batch", "total": 3, "done": 1, "current": "dsh-tokenledger", "step": "正在重新克隆源码…" },
      "lastBatch": { "startedAt": "2026-09-22T11:00:00.000Z", "finishedAt": "2026-09-22T11:02:00.000Z",
                     "updated": 2, "failed": 1,
                     "results": [ { "name": "dsh-notify", "ok": true, "updatedTo": "0.6.0" },
                                  { "name": "dsh-tokenledger", "ok": false, "error": "pnpm add 失败" } ] }
    }
    """

    static func checkSnapshotDecoding() {
        guard let snapshot = PluginUpdatesSnapshot.parse(sampleJSON) else {
            preconditionFailure("真实样本必须能解码")
        }
        precondition(snapshot.summary.updateAvailable == 2)
        precondition(snapshot.progress?.active == true)
        precondition(snapshot.progress?.kind == "batch")
        precondition(snapshot.progress?.current == "dsh-tokenledger")
        precondition(snapshot.lastBatch?.updated == 2)
        precondition(snapshot.lastBatch?.failed == 1)
        precondition(snapshot.lastBatch?.results?.first?.ok == true)

        // 没有进度/批次字段（检测中、或旧版插件）也要能解码，不能整条失败。
        let minimal = #"{"summary":{"updateAvailable":0}}"#
        precondition(PluginUpdatesSnapshot.parse(minimal)?.summary.updateAvailable == 0)
        precondition(PluginUpdatesSnapshot.parse(minimal)?.progress == nil)
        precondition(PluginUpdatesSnapshot.parse(minimal)?.lastBatch == nil)

        // 降级路径：nil / 空串 / HTML / 错误对象 / 插件不可用时的空 body。
        precondition(PluginUpdatesSnapshot.parse(nil) == nil)
        precondition(PluginUpdatesSnapshot.parse("") == nil)
        precondition(PluginUpdatesSnapshot.parse("<!doctype html><html></html>") == nil)
        precondition(PluginUpdatesSnapshot.parse(#"{"error":"找不到路由"}"#) == nil)
    }

    static func checkProgressPresentation() {
        // 没有进行中的更新 → 不显示进度（进度窗口据此收起）。
        precondition(PluginUpdatePresentation.progress(nil) == nil)
        precondition(PluginUpdatePresentation.progress(.init(active: false, kind: nil, total: nil, done: nil, current: nil, step: nil)) == nil)

        // 1/3：状态行带序号，明细行是「插件 · 步骤」，进度按已完成数算。
        let first = PluginUpdatePresentation.progress(.init(active: true, kind: "batch", total: 3, done: 0, current: "dsh-notify", step: "正在下载并安装 v0.6.0…"))
        precondition(first?.status == "正在更新插件（1/3）")
        precondition(first?.detail == "dsh-notify · 正在下载并安装 v0.6.0…")
        precondition(abs((first?.percentage ?? 0) - 100.0 / 3) < 0.01)

        let second = PluginUpdatePresentation.progress(.init(active: true, kind: "batch", total: 3, done: 2, current: "plugin-c", step: "正在同步 profile…"))
        precondition(second?.status == "正在更新插件（3/3）")
        precondition(second?.percentage == 100)

        // 单插件更新：total 缺省按 1 处理，进度满格。
        let single = PluginUpdatePresentation.progress(.init(active: true, kind: "single", total: 1, done: 0, current: "demo-plugin", step: "正在解析最新版本 v2.0.0…"))
        precondition(single?.status == "正在更新插件（1/1）")
        precondition(single?.percentage == 100)

        // 字段缺失/异常值都不能让窗口显示成空或越界。
        let sparse = PluginUpdatePresentation.progress(.init(active: true, kind: nil, total: nil, done: nil, current: nil, step: nil))
        precondition(sparse?.status == "正在更新插件（1/1）")
        precondition(sparse?.detail == "正在准备…")
        precondition(sparse?.percentage == 100)

        let overflow = PluginUpdatePresentation.progress(.init(active: true, kind: "batch", total: 2, done: 9, current: "x", step: "y"))
        precondition(overflow?.status == "正在更新插件（2/2）")
        precondition(overflow?.percentage == 100)

        // 没有插件名时明细行只显示步骤，不留一个孤零零的分隔符。
        let noName = PluginUpdatePresentation.progress(.init(active: true, kind: "single", total: 1, done: 0, current: "", step: "正在准备…"))
        precondition(noName?.detail == "正在准备…")
    }

    static func checkBatchSummary() {
        precondition(PluginUpdatePresentation.batchSummary(nil) == nil)
        precondition(PluginUpdatePresentation.batchSummary(.init(finishedAt: nil, updated: 1, failed: 0, results: nil)) == nil)
        precondition(PluginUpdatePresentation.batchSummary(.init(finishedAt: "2026-09-22T11:02:00.000Z", updated: 2, failed: 0, results: nil)) == "插件更新完成（2 个）")
        precondition(PluginUpdatePresentation.batchSummary(.init(finishedAt: "2026-09-22T11:02:00.000Z", updated: 1, failed: 1, results: nil)) == "插件更新完成：1 个成功、1 个失败")
        precondition(PluginUpdatePresentation.batchSummary(.init(finishedAt: "2026-09-22T11:02:00.000Z", updated: 0, failed: 2, results: nil)) == "插件更新完成：0 个成功、2 个失败")
        // 字段缺失按 0 计，不能崩。
        precondition(PluginUpdatePresentation.batchSummary(.init(finishedAt: "2026-09-22T11:02:00.000Z", updated: nil, failed: nil, results: nil)) == "插件更新完成（0 个）")
    }
}
