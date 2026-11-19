import Foundation

/// 旧版 WebKit 的 CSS 锚点定位降级：脚本契约回归。
///
/// 背景：DSH 前端用 CSS Anchor Positioning 定位所有弹出层，且**没有降级方案**。
/// 锚点定位是 macOS 26 / Safari 26 才有的能力；macOS 15 及更早的系统上
/// `anchor()` 失效，`top`/`left` 退回字面量 12px，于是模型选择、下拉菜单、
/// 右键菜单全部叠在窗口左上角——用户报的「内容飘到左上角」。
///
/// 启动器在内置窗口里注入降级脚本。这里锁死三件事：
///   1. 能力探测必须同时覆盖属性与函数（只测其一会在半实现版本上误判）；
///   2. 脚本必须幂等，且支持锚点定位时**不得**改动页面；
///   3. 摆位结果必须落在触发元素附近、且夹在视口内。
///
/// 脚本本身用 node 跑（见 scripts/test-anchor-fallback.js），这里校验 Swift 侧契约。

@main
struct AnchorFallbackChecks {
    static var failures: [String] = []

    static func check(_ condition: Bool, _ message: String) {
        if !condition { failures.append(message) }
    }

    static func main() {
        let script = HarnessAnchorFallback.userScript

        // MARK: - 1. 能力探测
        check(
            HarnessAnchorFallback.supportProbe.contains("position-anchor"),
            "探测必须包含 position-anchor：只测 anchor() 会在部分实现上误判"
        )
        check(
            HarnessAnchorFallback.supportProbe.contains("anchor(top)"),
            "探测必须包含 anchor() 函数：属性实现了不代表函数可用"
        )
        check(
            script.contains("CSS.supports('position-anchor: --x')")
                && script.contains("CSS.supports('top: anchor(top)')"),
            "注入脚本里必须真的做这两项探测，否则会在新系统上错误地接管定位"
        )

        // MARK: - 2. 新系统不生效
        check(
            script.contains("if (supported) return;"),
            "支持锚点定位时必须直接返回，不能与 DSH 自己的定位打架"
        )

        // MARK: - 3. 幂等
        check(
            script.contains("__dshAnchorFallbackInstalled"),
            "脚本必须幂等：重复注入（页面内导航）不能叠加多套监听"
        )

        // MARK: - 4. 必须真的清除失效的锚点属性
        // 只改 top/left 不够：position-anchor / position-area 若还挂着，
        // 浏览器仍会按（失效的）锚点规则参与布局。
        check(
            script.contains("style.positionAnchor = ''"),
            "必须清掉 position-anchor，否则失效的锚点规则仍参与布局"
        )
        check(
            script.contains("style.positionArea = ''"),
            "必须清掉 position-area"
        )

        // MARK: - 5. 摆位必须双向兜底且夹在视口内
        check(
            script.contains("anchor.bottom + GAP") && script.contains("anchor.top - GAP - h"),
            "竖直方向要同时尝试下方与上方，否则底部触发器的菜单会跑出屏幕"
        )
        check(
            script.contains("vw - MARGIN - w") || script.contains("vw - MARGIN"),
            "水平方向必须夹在视口内"
        )
        check(
            script.contains("offsetWidth") && script.contains("offsetHeight"),
            "必须按弹层实际尺寸计算，不能写死宽度"
        )

        // MARK: - 6. 动态插入的弹层要能被发现
        check(
            script.contains("MutationObserver"),
            "弹层是 React 动态挂到 body 的，必须监听 DOM 变化"
        )
        check(
            script.contains("requestAnimationFrame"),
            "摆位要等下一帧，插入当拍拿不到最终尺寸"
        )

        // MARK: - 7. 触发元素来源
        check(
            script.contains("pointerdown") && script.contains("click"),
            "必须记录触发元素（弹层是 portal，无法从自身反推锚点）"
        )
        check(
            script.contains("activeElement"),
            "没有触发记录时要回退到 activeElement，键盘打开的菜单依赖它"
        )

        // MARK: - 8. 标记位（供排查与样式兜底）
        check(
            script.contains("data-dsh-anchor-fallback"),
            "被降级摆位的弹层要打标记，便于用户排查与后续样式覆盖"
        )

        // MARK: - 8.5 自带居中的弹层必须被跳过
        // 真实回归：插件管理 / 归档管理用 left:50%;top:50%;transform:translate(-50%,-50%)
        // 居中且带 role="dialog"。早期实现无条件接管 role="dialog"，改写 top/left
        // 却留下 transform，弹层被推走自身尺寸的一半，内容裁到左边。
        check(
            script.contains("centersItself"),
            "必须识别「自带居中」的弹层并跳过，否则会再次把它们推偏"
        )
        check(
            script.contains("if (centersItself(el)) return false;"),
            "自带居中的弹层必须在 isOverlay 里直接排除"
        )
        check(
            !script.contains("'[role=\"menu\"],[role=\"listbox\"],[role=\"dialog\"]"),
            "scan 不能再无条件抓 role=\"dialog\"，那会把居中弹层一起抓进来"
        )
        check(
            script.contains("undoPreviousRun"),
            "必须能还原上一版留下的内联样式，否则升级后弹层一直偏着"
        )

        // MARK: - 9. 只在内置窗口注入
        check(
            HarnessAnchorFallback.shouldInstall(embeddedWindow: true),
            "内置窗口必须注入"
        )
        check(
            !HarnessAnchorFallback.shouldInstall(embeddedWindow: false),
            "浏览器回退模式不注入：页面在用户自己的浏览器里，不该被启动器改写"
        )

        // MARK: - 10. requiredFragments 与脚本一致
        for fragment in HarnessAnchorFallback.requiredFragments {
            check(
                script.contains(fragment),
                "requiredFragments 里的「\(fragment)」不在脚本里，清单已过期"
            )
        }

        if failures.isEmpty {
            print("anchor fallback checks passed")
            return
        }
        for failure in failures { print("✗ \(failure)") }
        exit(1)
    }
}
