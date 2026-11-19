import Foundation

// 运行期存活判据的回归。
//
// 这条判据修的是「Harness 页面打不开 / Could not connect to the server，
// 怎么也进不去」：启动器接管（复用）一个已存在的 dsh 时拿不到进程句柄，
// 那个实例退出后 state 仍是 running、selectedPort 指向空端口，之后每次
// 「打开」都只是把同一个死地址再加载一遍。
//
// 这里锁死三件事：
//   1. 死端口的判定阈值（3 次）与卡死进程的更长阈值（6 次）不能相等；
//   2. 只有「连不上」这一类错误才算连接失败——401/取消/内容错误重启没用；
//   3. 探测间隔在合理区间，别把空闲启动器变成忙循环。

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
        // MARK: - 1. 死端口 vs 卡死进程的阈值
        check(
            RuntimeHealthSupport.shouldTakeOver(failures: 0) == false,
            "还没失败过：不能重启"
        )
        check(
            RuntimeHealthSupport.shouldTakeOver(failures: 1) == false,
            "一次探测超时只是「慢」：不能重启（会打断正在跑的回合）"
        )
        check(
            RuntimeHealthSupport.shouldTakeOver(failures: 2) == false,
            "两次仍要容忍"
        )
        check(
            RuntimeHealthSupport.shouldTakeOver(failures: 3) == true,
            "连续 3 次无应答：接管实例已死，必须重启，否则窗口永远连不上"
        )
        check(
            RuntimeHealthSupport.shouldRestartHungProcess(failures: 3) == false,
            "进程还活着时不能用 3 次的判据：那是「慢」不是「死」"
        )
        check(
            RuntimeHealthSupport.shouldRestartHungProcess(failures: 6) == true,
            "进程活着但连续 6 次无应答：已卡死，重启"
        )
        check(
            RuntimeHealthSupport.hungFailureThreshold > RuntimeHealthSupport.adoptedFailureThreshold,
            "卡死阈值必须严格长于死端口阈值，否则会误杀健康实例"
        )

        // MARK: - 2. 哪些错误才算「连不上」
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

        // MARK: - 3. 探测间隔
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
