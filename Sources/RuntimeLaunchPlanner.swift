import Foundation

/// App 自带锁文件要求的目标 dsh 版本（比已装的更新时才会出现）。
struct BundledRuntimeUpgrade: Equatable {
    let bundled: String
    let installed: String
}

/// 启动时对「运行环境（固定 runtime）」要做的动作。
///
/// 一条硬性约束：启动器不在用户没点头的情况下重装或更新运行环境。有更新只意味着
/// 「可以更新」，是否更新由用户决定；用户拒绝后，只要现有环境还能起来，就照常启动
/// ——「不更新」绝不等于「用不了」。所以这里没有任何一步是「直接开始安装」。
enum RuntimeLaunchAction: Equatable {
    /// 直接用现有运行环境启动。
    case launchInstalled
    /// 正式运行环境缺失，但上次中断留下的完整快照还在：换回来再启动。
    case recoverSnapshot
    /// App 自带锁文件比已装的 dsh 新：问一次，用户点头才更新。
    case offerBundledUpgrade(BundledRuntimeUpgrade)
    /// 运行环境缺失（也没有快照）：问一次要不要重建。
    case offerRepair
    /// 运行环境缺失，而用户在这次运行里已经拒绝过重建：不再打扰，只留菜单入口。
    case rebuildDeclined
    /// 本机从没用过 dsh：首次安装引导。
    case firstInstall
}

struct RuntimeLaunchInput: Equatable {
    /// 完整运行环境（依赖树齐全，`DSHRuntimeSupport.isInstalled()`）。
    var runtimeInstalled: Bool
    /// 至少还剩一个可执行的 dsh（`DSHRuntimeSupport.canAttemptLaunch()`）。
    var runtimeRunnable: Bool
    /// 还有一份完整运行环境快照可用来恢复。
    var recoverySnapshotAvailable: Bool
    /// 需要用户确认的锁文件升级目标，没有则 nil。
    var bundledUpgradeTarget: BundledRuntimeUpgrade?
    /// 本机已用过 DeepSeek Harness（profile 或依赖树在），缺 runtime 不等于首次安装。
    var harnessInstallPresent: Bool
    /// 本次启动器运行里，用户已经拒绝过重建运行环境。
    var rebuildDeclinedThisRun: Bool
}

enum RuntimeLaunchPlanner {
    static func plan(_ input: RuntimeLaunchInput) -> RuntimeLaunchAction {
        if input.runtimeInstalled {
            if let upgrade = input.bundledUpgradeTarget { return .offerBundledUpgrade(upgrade) }
            return .launchInstalled
        }
        // 依赖树不齐、但 dsh 本体还在：这份环境能不能用，dsh 自己比启动器更有发言权。
        // 判据（isInstalled）是「装不装」的边界，不该被拿来决定「能不能用」——先让它
        // 起来，起不来再走失败恢复阶梯，而不是先摆一个「必须重装」的门。
        if input.runtimeRunnable { return .launchInstalled }
        if input.recoverySnapshotAvailable { return .recoverSnapshot }
        if input.rebuildDeclinedThisRun { return .rebuildDeclined }
        if input.harnessInstallPresent { return .offerRepair }
        return .firstInstall
    }
}
