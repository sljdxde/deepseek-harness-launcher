import Foundation

/// 运行期「dsh 还在不在」的判据，从启动器主类抽出以便单测覆盖。
///
/// 为什么需要它：启动器有两种运行状态。
/// 1. **自己拉起的实例**：`Process` 的 terminationHandler 会在进程退出时收尾，
///    状态不会说谎；
/// 2. **接管（复用）的实例**：进程不是本启动器拉起的，拿不到 terminationHandler，
///    也就没有 token 入口。它一旦退出（用户在终端里 Ctrl-C、旧版本更新后遗留的
///    孤儿进程被系统回收、手动 npx 启动的那个终端被关掉），启动器的 `state` 会
///    永远停在 running、`selectedPort` 指向一个已经没人监听的端口。
///    表现就是：点「打开 Deepseek Harness」→ 内置窗口连不上 → 只得到一张
///    「Harness 页面打不开 / Could not connect to the server」，而且**再也进不去**
///    （窗口里那个入口 URL 没变，`HarnessWindowSupport.action` 判定为 showOnly，
///    连重载都不做）。Windows 侧的 `watchAdopted` 解决的是同一个问题。
enum RuntimeHealthSupport {
    /// 存活探测间隔（接管与自管共用）。太密会白白唤醒主线程，太疏则让用户先看到死页面。
    static let adoptedProbeInterval: TimeInterval = 5

    /// 连续多少次「没等到应答」才判定卡死。**只有一条预算**，不再按「有没有
    /// 进程句柄」分两套阈值。
    ///
    /// 2026-11-20 的一次自动重启证明了分两套是反的：拿得到句柄的那条能看
    /// `isRunning`（6 次 ≈ 30 秒），拿不到句柄的接管实例分不清忙与死，却只给
    /// 3 次 ≈ 15 秒。dsh 是单线程，插件版本比对/MCP 启动能占住事件循环十几秒，
    /// 那次正好卡在 15 秒判据上被判死，重启后又要冷启动 15 秒。
    ///
    /// 现在「忙」与「死」靠探针的错误码区分（见 `classify`）：
    /// 端口没人（refused）才快速自愈，其余一律走这条最长预算。
    static let unresponsiveFailureThreshold = 6

    /// 一次探测能得出的结论。区别只在一处：**能不能证明实例已经没了**。
    enum ProbeOutcome: Equatable {
        /// 端口上确实是 dsh 在应答。
        case alive
        /// 连接被拒绝：没有进程在监听这个端口，实例确定不在了，可以立刻重启。
        case refused
        /// 连得上但没在预算内回应（或连接中途断掉）：可能只是忙，不能判死。
        case timedOut
        /// 其他网络错误，或端口上应答的不是 dsh：证据不足，按「忙」处理。
        case failure

        var label: String {
            switch self {
            case .alive: return "应答正常"
            case .refused: return "端口已无人监听"
            case .timedOut: return "探测超时"
            case .failure: return "探测失败"
            }
        }
    }

    /// 一次探测的结果：结论 + 原始错误（写日志用）。
    ///
    /// 只留结论不留错误码，日志里就只剩「端口上已没有 dsh 在应答」这一句话，
    /// 事后无法区分是 ECONNREFUSED 还是超时——2026-11-20 那次就是这样只能靠
    /// 时间线反推的。
    struct ProbeResult: Equatable {
        let outcome: ProbeOutcome
        let detail: String
    }

    static func shouldRestartUnresponsive(failures: Int) -> Bool {
        failures >= max(1, unresponsiveFailureThreshold)
    }

    /// 把一次探针的错误归成结论；`error == nil` 表示确实收到了 HTTP 响应。
    static func classify(error: NSError?) -> ProbeResult {
        guard let error else { return ProbeResult(outcome: .alive, detail: "") }
        guard error.domain == NSURLErrorDomain else {
            return ProbeResult(outcome: .failure, detail: "\(error.domain) \(error.code)")
        }
        let outcome: ProbeOutcome
        switch error.code {
        case NSURLErrorCannotConnectToHost,   // 端口没在监听（离线时最常见）
             NSURLErrorCannotFindHost,        // 主机名解析不出来
             NSURLErrorDNSLookupFailed,
             NSURLErrorNotConnectedToInternet:
            outcome = .refused
        case NSURLErrorTimedOut,              // 进程卡死/端口被防火墙丢弃
             NSURLErrorNetworkConnectionLost: // 握手期间对方消失
            outcome = .timedOut
        default:
            outcome = .failure
        }
        return ProbeResult(outcome: outcome, detail: "NSURLError \(error.code)")
    }

    /// 这次导航失败是不是「连不上」这一类（而不是 401、内容类型等）。
    /// 只有这一类才值得先确认服务是否还在、必要时重启：认证失败重启也没用。
    static func isConnectionFailure(_ error: NSError) -> Bool {
        guard error.domain == NSURLErrorDomain else { return false }
        switch error.code {
        case NSURLErrorCannotConnectToHost,   // 端口没在监听（离线时最常见）
             NSURLErrorCannotFindHost,        // 主机名解析不出来
             NSURLErrorDNSLookupFailed,
             NSURLErrorTimedOut,              // 进程卡死/端口被防火墙丢弃
             NSURLErrorNetworkConnectionLost, // 握手期间对方消失
             NSURLErrorNotConnectedToInternet:
            return true
        default:
            return false
        }
    }
}
