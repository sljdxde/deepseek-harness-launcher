import Foundation

@main
struct DSHInstallProgressChecks {
    static func main() {
        // 1) 初始状态：preparing，百分比在 0~3% 之间（不再是 nil）
        let tracker = DSHInstallProgressTracker()
        let initial = tracker.snapshot()
        precondition(initial.detail.contains("准备 npm 安装"))
        precondition(initial.percentage >= 0 && initial.percentage <= 3.0,
                     "initial pct should be in preparing band, got \(initial.percentage)")

        // 2) 解析阶段：placeDep 事件让百分比从 3% 向 15% 爬升
        _ = tracker.consume("npm sill idealTree buildDeps\n")
        _ = tracker.consume(
            "npm silly placeDep ROOT @deepseek-ai/dsh@0.1.1 OK for:  want: 0.1.1\n" +
            "npm silly placeDep node_modules/a@1.0.0 OK for: @deepseek-ai/dsh@0.1.1 want: 1.0.0\n" +
            "npm silly placeDep node_modules/b@1.0.0 OK for: @deepseek-ai/dsh@0.1.1 want: 1.0.0\n"
        )
        let resolving = tracker.snapshot()
        precondition(resolving.detail.contains("解析依赖"))
        precondition(resolving.percentage > initial.percentage,
                     "resolving pct should climb above initial, got \(resolving.percentage)")

        // 3) 下载阶段：只有 .tgz 行计入分子，manifest 行不计
        //    placeDepKeys 有 3 个包（dsh、a、b）。下 1 个 tgz → 1/3，落在 15%~65% 区间。
        let afterOneTgz = tracker.consume(
            "npm http fetch GET 200 https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.1.tgz 120ms (cache miss)\n" +
            "npm http fetch GET 200 https://registry.npmjs.org/a 140ms (cache miss)\n"  // manifest，不应计数
        )
        precondition(afterOneTgz.detail.contains("下载依赖"))
        precondition(afterOneTgz.detail.contains("已下载 1 个包"),
                     "manifest fetch must not count, got \(afterOneTgz.detail)")
        // 15 + (1/3)*50 ≈ 31.7%
        precondition(afterOneTgz.percentage > 30 && afterOneTgz.percentage < 35,
                     "after one tgz pct should be ~31.7, got \(afterOneTgz.percentage)")

        // 下满 3 个 tgz → 下载阶段封顶 65%
        let afterAllTgz = tracker.consume(
            "npm http fetch GET 200 https://registry.npmjs.org/a/-/a-1.0.0.tgz 100ms\n" +
            "npm http fetch GET 200 https://registry.npmjs.org/b/-/b-1.0.0.tgz 100ms\n"
        )
        precondition(afterAllTgz.detail.contains("已下载 3 个包"))
        precondition(afterAllTgz.percentage >= 64 && afterAllTgz.percentage <= 66,
                     "after all tgz pct should be ~65, got \(afterAllTgz.percentage)")

        // 4) 安装阶段：ADD 事件推进 65% → 95%
        _ = tracker.consume("npm silly reify moves {}\n")
        let add1 = tracker.consume("npm silly ADD node_modules/@deepseek-ai/dsh\n")
        // 65 + (1/3)*30 = 75
        precondition(add1.detail.contains("写入本地 runtime"))
        precondition(add1.percentage >= 74 && add1.percentage <= 76,
                     "after 1/3 adds pct should be ~75, got \(add1.percentage)")

        let addAll = tracker.consume(
            "npm silly ADD node_modules/a\n" +
            "npm silly ADD node_modules/b\n"
        )
        precondition(addAll.percentage >= 94 && addAll.percentage <= 95.1,
                     "after all adds pct should be ~95, got \(addAll.percentage)")

        // 5) 完成：added N packages → 100%
        let completed = tracker.consume("added 3 packages in 3s\n")
        precondition(completed.detail.contains("校验安装"))
        precondition(completed.percentage == 100.0,
                     "completed pct should be 100, got \(completed.percentage)")

        // 6) 单调递增：连续 snapshot 不应回退
        let mono = DSHInstallProgressTracker()
        var prev = 0.0
        let samples = [
            "npm sill idealTree buildDeps\n",
            "npm silly placeDep ROOT foo@1.0.0 OK for:  want: 1.0.0\n",
            "npm silly placeDep node_modules/bar@1.0.0 OK for: foo want: 1.0.0\n",
            "npm http fetch GET 200 https://registry.npmjs.org/foo/-/foo-1.0.0.tgz 100ms\n",
            "npm silly reify moves {}\n",
            "npm silly ADD node_modules/foo\n",
            "added 2 packages in 1s\n",
        ]
        for s in samples {
            let snap = mono.consume(s)
            precondition(snap.percentage >= prev - 0.01,
                         "pct must not go backwards: \(prev) -> \(snap.percentage)")
            prev = snap.percentage
        }

        // 7) 重试（换 registry）会重置进度到准备阶段
        let retry = DSHInstallProgressTracker()
        _ = retry.consume("npm silly placeDep ROOT foo@1.0.0 OK for:  want: 1.0.0\n")
        let mid = retry.snapshot().percentage
        _ = retry.consume("尝试 npm registry：https://mirror.example.com\n")
        let afterRetry = retry.snapshot()
        precondition(afterRetry.detail.contains("准备 npm 安装"))
        precondition(afterRetry.percentage < mid,
                     "retry should reset progress below mid (\(mid)), got \(afterRetry.percentage)")

        print("dsh install progress checks passed")
    }
}
