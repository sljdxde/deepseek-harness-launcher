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
    /// 接管实例的存活探测间隔。太密会白白唤醒主线程，太疏则让用户先看到死页面。
    static let adoptedProbeInterval: TimeInterval = 5

    /// 连续失败多少次才判定「它已经死了」。dsh 在跑长任务时会短暂占用事件循环，
    /// 单次探测超时不代表进程没了。
    static let adoptedFailureThreshold = 3

    /// 进程还活着、但端口一直不应答时的额外预算。超过它就按「卡死」处理：
    /// 一个连自己首页都答不出来的 dsh 对用户来说与崩溃无异，而且这类卡死不会
    /// 自己恢复——正是「怎么也进不去」的另一半来源。
    static let hungFailureThreshold = 6

    static func shouldTakeOver(failures: Int, threshold: Int = adoptedFailureThreshold) -> Bool {
        failures >= max(1, threshold)
    }

    /// 进程还在跑时该不该也重启：只认更长的预算，别用 15 秒的判据去打断
    /// 正在跑的回合。
    static func shouldRestartHungProcess(failures: Int) -> Bool {
        failures >= max(adoptedFailureThreshold + 1, hungFailureThreshold)
    }

    /// 这次导航失败是不是「端口上没人」这一类（而不是 401、内容类型等）。
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