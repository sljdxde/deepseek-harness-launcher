import Foundation

// 运行期存活判据的回归。
//
// 这条判据修的是「Harness 页面打不开 / Could not connect to the server，
// 怎么也进不去」：启动器接管（复用）一个已存在的 dsh 时拿不到进程句柄，
// 那个实例退出后 state 仍是 running、selectedPort 指向空端口，之后每次
// 「打开」都只是把同一个死地址再加载一遍。
//
// 2026-11-20 的一次自动重启暴露了旧判据的另一半问题：探测只看「拿没拿到
// 能识别的 body」，把「端口没人（ECONNREFUSED）」与「还活着只是忙（超时）」
// 当成同一件事，于是接管实例在一条约 15 秒的事件循环停顿上被判死（3 次 ×
// 5 秒）；而它恰恰是分不清忙/死的那条路，预算却最短。
//
// 这里锁死四件事：
//   1. 只有「端口没人监听」才能直接判死；超时/连上又断一律按「忙」处理，
//      统一走一条最长预算（6 次），不再按有没有进程句柄分两套阈值；
//   2. 探针必须留下失败原因（错误域 + 错误码），否则下次还是无法区分忙与死；
//   3. 窗口导航的「连不上」分类保持不变——401/取消/内容错误重启没用；
//   4. 探测间隔在合理区间，别把空闲启动器变成忙循环。

@main
struct RuntimeHealthChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func error(_ code: Int, domain: String = NSURLErrorDomain) -> NSError {
        NSError(domain: domain, code: code, userInfo: nil)
    }

    static func main() {
        // MARK: - 1. 「没等到应答」只有一条预算，且不能太短
        check(
            RuntimeHealthSupport.shouldRestartUnresponsive(failures: 0) == false,
            "还没失败过：不能重启"
        )
        check(
            RuntimeHealthSupport.shouldRestartUnresponsive(failures: 1) == false,
            "一次探测超时只是「慢」：不能重启（会打断正在跑的回合）"
        )
        check(
            RuntimeHealthSupport.shouldRestartUnresponsive(failures: 5) == false,
            "连续 5 次仍要容忍：dsh 是单线程，插件扫描/MCP 启动能占住事件循环十秒以上"
        )
        check(
            RuntimeHealthSupport.shouldRestartUnresponsive(failures: 6) == true,
            "连续 6 次无应答（约 30 秒）：已卡死，重启"
        )
        check(
            RuntimeHealthSupport.unresponsiveFailureThreshold >= 6,
            "预算不得低于 6 次：2026-11-20 那次 15 秒停顿就是被更短的判据误杀的"
        )

        // MARK: - 2. 三态归类：能不能证明「实例没了」
        check(RuntimeHealthSupport.classify(error: nil).outcome == .alive, "收到响应就是活的")

        let refusedCodes = [
            NSURLErrorCannotConnectToHost,   // 端口没人监听：唯一能直接判死的信号
            NSURLErrorCannotFindHost,
            NSURLErrorDNSLookupFailed,
            NSURLErrorNotConnectedToInternet
        ]
        for code in refusedCodes {
            check(
                RuntimeHealthSupport.classify(error: error(code)).outcome == .refused,
                "NSURLError \(code) 说明端口上没人，应直接自愈"
            )
        }

        let timeoutCodes = [NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost]
        for code in timeoutCodes {
            check(
                RuntimeHealthSupport.classify(error: error(code)).outcome == .timedOut,
                "NSURLError \(code) 只说明这次没等到应答（可能只是忙），不能判死"
            )
        }

        let indeterminateCodes = [NSURLErrorCancelled, NSURLErrorBadURL]
        for code in indeterminateCodes {
            check(
                RuntimeHealthSupport.classify(error: error(code)).outcome == .failure,
                "NSURLError \(code) 既不能证明死也不能证明忙，按证据不足处理"
            )
        }

        check(
            RuntimeHealthSupport.classify(
                error: error(NSURLErrorCannotConnectToHost, domain: "WebKitErrorDomain")
            ).outcome == .failure,
            "别的错误域不能按「端口没人」处理（域必须一起判）"
        )

        // 失败原因必须落进 detail，否则日志里还是分不清忙与死。
        let timedOut = RuntimeHealthSupport.classify(error: error(NSURLErrorTimedOut))
        check(
            timedOut.detail.contains("-1001"),
            "探测超时要把 NSURLError 码记下来（诊断用），实际：\(timedOut.detail)"
        )
        check(
            RuntimeHealthSupport.classify(error: nil).detail.isEmpty,
            "成功探测不需要错误详情"
        )

        // MARK: - 3. 窗口导航的「连不上」分类（决定要不要去确认服务还在）
        let connectionCodes = [
            NSURLErrorCannotConnectToHost,   // 端口上没人：就是这张「打不开」页的来源
            NSURLErrorCannotFindHost,
            NSURLErrorDNSLookupFailed,
            NSURLErrorTimedOut,
            NSURLErrorNetworkConnectionLost,
            NSURLErrorNotConnectedToInternet
        ]
        for code in connectionCodes {
            check(
                RuntimeHealthSupport.isConnectionFailure(error(code)),
                "NSURLError \(code) 属于连接失败，应触发存活确认"
            )
        }
        check(
            RuntimeHealthSupport.isConnectionFailure(error(NSURLErrorCancelled)) == false,
            "被取消的导航（外链改道）不是失败，不能因此重启 dsh"
        )
        check(
            RuntimeHealthSupport.isConnectionFailure(error(NSURLErrorBadURL)) == false,
            "坏 URL 重启也没用"
        )
        check(
            RuntimeHealthSupport.isConnectionFailure(
                error(NSURLErrorCannotConnectToHost, domain: "WebKitErrorDomain")
            ) == false,
            "别的错误域不按连接失败处理（域必须一起判）"
        )

        // MARK: - 4. 探测间隔
        check(
            RuntimeHealthSupport.adoptedProbeInterval >= 2,
            "探测间隔过密会白白唤醒主线程"
        )
        check(
            RuntimeHealthSupport.adoptedProbeInterval <= 30,
            "探测间隔过疏会让用户先看到一张死页面"
        )

        if failures.isEmpty {
            print("runtime health checks passed")
            return
        }
        for failure in failures { print("✗ \(failure)") }
        exit(1)
    }
}
