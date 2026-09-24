import Foundation

/// 启动期运行环境决策的纯逻辑回归：这些判据决定「点开启动器会发生什么」，
/// 且都必须满足一条硬约束——**没有用户点头，绝不开始装/更新**。
/// 所以每个用例断言的是「弹窗/菜单入口」，只有当运行环境本身可用、或用户已经
/// 表态过时，才允许直接进入启动。
@main
struct RuntimeLaunchPlanChecks {
    static func main() {
        let upgrade = BundledRuntimeUpgrade(bundled: "0.1.5-rc.4", installed: "0.1.5-rc.2")

        // ① 完整运行环境 + 没有升级目标 → 直接启动。
        precondition(plan(installed: true) == .launchInstalled)

        // ② 完整运行环境 + App 自带版本更新 → 只给出可更新的目标，让用户决定；
        //    绝不返回「直接安装」。
        precondition(plan(installed: true, upgrade: upgrade) == .offerBundledUpgrade(upgrade))

        // ③ 运行环境缺失但快照还在（上次替换 runtime 中途被打断）→ 先恢复，
        //    不弹重装：那份快照就是用户手上唯一能跑的环境。
        precondition(plan(snapshot: true) == .recoverSnapshot)
        //    快照优先于「用户已拒绝重建」和首次安装引导。
        precondition(plan(snapshot: true, declined: true) == .recoverSnapshot)
        precondition(plan(snapshot: true, harnessPresent: false) == .recoverSnapshot)

        // ④ 运行环境缺失、没有快照、本机用过 dsh → 问一次要不要重建。
        precondition(plan(harnessPresent: true) == .offerRepair)

        // ⑤ 运行环境缺失，而用户这次运行里已经拒绝过重建 → 不再打扰，留菜单入口。
        precondition(plan(harnessPresent: true, declined: true) == .rebuildDeclined)

        // ⑥ 从没用过 dsh → 首次安装引导（同样要用户点头）。
        precondition(plan(harnessPresent: false) == .firstInstall)

        // ⑦ 依赖树不齐但 dsh 本体还在：先让它起来。判据没过不等于不能用，
        //    「必须重装」不该成为启动的前提。
        precondition(plan(runnable: true) == .launchInstalled)
        precondition(plan(runnable: true, harnessPresent: true) == .launchInstalled)
        //    残缺环境上的升级提示一并压后：先能跑起来，再谈更新。
        precondition(plan(runnable: true, upgrade: upgrade) == .launchInstalled)
        //    半份 runtime 甚至不该盖过快照恢复：快照是完整的一份。
        precondition(plan(runnable: true, snapshot: true) == .launchInstalled)

        // ⑧ 完整环境优先于快照：运行环境好好的，不去动快照。
        precondition(plan(installed: true, snapshot: true) == .launchInstalled)

        print("runtime launch plan checks passed")
    }

    private static func plan(
        installed: Bool = false,
        runnable: Bool = false,
        snapshot: Bool = false,
        upgrade: BundledRuntimeUpgrade? = nil,
        harnessPresent: Bool = false,
        declined: Bool = false
    ) -> RuntimeLaunchAction {
        RuntimeLaunchPlanner.plan(RuntimeLaunchInput(
            runtimeInstalled: installed,
            runtimeRunnable: runnable,
            recoverySnapshotAvailable: snapshot,
            bundledUpgradeTarget: upgrade,
            harnessInstallPresent: harnessPresent,
            rebuildDeclinedThisRun: declined
        ))
    }
}
