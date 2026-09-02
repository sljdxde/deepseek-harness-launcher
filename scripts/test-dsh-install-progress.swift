import Foundation

@main
struct DSHInstallProgressChecks {
    static func main() {
        let tracker = DSHInstallProgressTracker()

        let initial = tracker.snapshot()
        precondition(initial.detail.contains("准备 npm 安装"))
        precondition(initial.percentage == nil)

        _ = tracker.consume("npm sill idealTree buildDeps\n")
        let resolving = tracker.snapshot()
        precondition(resolving.detail.contains("解析 dsh 依赖"))

        let downloading = tracker.consume(
            "npm http fetch GET 200 https://registry.npmjs.org/a 120ms (cache miss)\n" +
            "npm http fetch GET 200 https://registry.npmjs.org/b 140ms (cache miss)\n"
        )
        precondition(downloading.detail.contains("下载 dsh 依赖"))
        precondition(downloading.detail.contains("2 条成功下载记录"))
        precondition(downloading.percentage == nil)

        let partial = tracker.consume("npm sill reify")
        precondition(partial.detail.contains("下载 dsh 依赖"))
        let installing = tracker.consume("\n")
        precondition(installing.detail.contains("写入本地 runtime"))

        let installingAgain = tracker.consume("npm info run dsh postinstall\n")
        precondition(installingAgain.detail.contains("写入本地 runtime"))

        _ = tracker.consume(
            "npm silly placeDep ROOT @deepseek-ai/dsh@0.1.1 OK for:  want: 0.1.1\n" +
            "npm silly placeDep node_modules/@deepseek-ai/cordis-plugin-group@0.1.1 OK for: @deepseek-ai/dsh@0.1.1 want: 0.1.1\n" +
            "npm silly reify moves {}\n"
        )
        let half = tracker.consume("npm silly ADD node_modules/@deepseek-ai/dsh\n")
        precondition(half.percentage == 50)
        precondition(half.detail.contains("50.00%"))

        let full = tracker.consume("npm silly ADD node_modules/@deepseek-ai/cordis-plugin-group\n")
        precondition(full.percentage == 100)
        precondition(full.detail.contains("100.00%"))

        let addWithoutReifyTracker = DSHInstallProgressTracker()
        _ = addWithoutReifyTracker.consume(
            "npm silly placeDep ROOT @deepseek-ai/dsh@0.1.1 OK for:  want: 0.1.1\n" +
            "npm silly placeDep ROOT @deepseek-ai/cordis-plugin-group@0.1.1 OK for: @deepseek-ai/dsh@0.1.1 want: 0.1.1\n"
        )
        let addWithoutReify = addWithoutReifyTracker.consume("npm silly ADD node_modules/@deepseek-ai/dsh\n")
        precondition(addWithoutReify.percentage == 50)
        precondition(addWithoutReify.detail.contains("50.00%"))

        let fractionalTracker = DSHInstallProgressTracker()
        _ = fractionalTracker.consume(
            "npm silly placeDep ROOT @deepseek-ai/dsh@0.1.1 OK for:  want: 0.1.1\n" +
            "npm silly placeDep node_modules/a@1.0.0 OK for: @deepseek-ai/dsh@0.1.1 want: 1.0.0\n" +
            "npm silly placeDep node_modules/b@1.0.0 OK for: @deepseek-ai/dsh@0.1.1 want: 1.0.0\n" +
            "npm silly reify moves {}\n"
        )
        let fractional = fractionalTracker.consume("npm silly ADD node_modules/@deepseek-ai/dsh\nnpm silly ADD node_modules/a\n")
        precondition(fractional.percentage == 66.67)
        precondition(fractional.detail.contains("66.67%"))

        let completed = tracker.consume("added 42 packages in 3s\n")
        precondition(completed.detail.contains("校验 dsh 安装"))
        precondition(completed.percentage == 100)

        print("dsh install progress checks passed")
    }
}
