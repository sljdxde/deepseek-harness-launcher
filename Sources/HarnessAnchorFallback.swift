import Foundation

/// 旧版 WebKit 的 CSS 锚点定位降级。
///
/// 背景：DeepSeek Harness 的 Web 前端（`dsh-web-frontend`）用 CSS Anchor
/// Positioning 定位所有弹出层——模型选择、下拉菜单、右键菜单、子菜单。它
/// **没有任何 `@supports` 降级，也没有 JS 特性检测**：
///
/// ```css
/// ._portal_70kcw_43 {
///   position: fixed;
///   top: max(var(--dsh-menu-window-top), calc(anchor(bottom) + 4px));
///   left: max(12px, anchor(left));
///   ...
/// }
/// ```
///
/// 锚点定位是 Safari 26 / macOS 26 才有的能力。在 macOS 15 及更早的系统上，
/// `anchor()` 整条声明失效，`top` / `left` 退回字面量 `12px`——弹层于是全部
/// 叠在窗口左上角，用户根本点不到对应的控件。
///
/// 启动器的内置窗口是自己的 `WKWebView`，可以在文档加载前注入一段脚本，
/// 只在「浏览器确实不支持锚点定位」时把弹层按触发元素重新摆位。
///
/// 设计原则：
/// 1. **只在能力缺失时生效**：支持锚点定位的新系统完全不受影响，避免两套
///    定位逻辑打架；
/// 2. **不改 DSH 源码**：注入只发生在启动器自己的窗口里，浏览器回退模式与
///    dsh 自身的其它客户端不受影响；
/// 3. 定位策略保守：优先摆在触发元素下方，空间不足则上方，再不行就贴边，
///    始终夹在视口内。
enum HarnessAnchorFallback {
    /// `CSS.supports` 的探测表达式。锚点定位的核心是 `anchor()` 函数；
    /// 只测 `anchor-name` 不够（部分版本只实现了属性没实现函数）。
    static let supportProbe = "CSS.supports('position-anchor: --x') && CSS.supports('top: anchor(top)')"

    /// 注入到每个文档的降级脚本。幂等：重复注入只会重装一次监听。
    static var userScript: String {
        """
        (function () {
          if (window.__dshAnchorFallbackInstalled) return;
          window.__dshAnchorFallbackInstalled = true;

          // 新系统原生支持：什么都不做，交回 DSH 自己的定位。
          var supported = false;
          try { supported = \(supportProbe); } catch (e) { supported = false; }
          if (supported) return;

          var GAP = 4;
          var MARGIN = 12;

          // 升级路径：旧版本可能已经给某些弹层写过内联 top/left 并打了标记。
          // 新逻辑会跳过这些（它们自己居中），但残留的内联样式优先级高于 CSS，
          // 不清掉的话弹层会一直偏着。先把上一版留下的痕迹全部还原。
          function undoPreviousRun() {
            var marked = document.querySelectorAll('[data-dsh-anchor-fallback]');
            for (var i = 0; i < marked.length; i++) {
              var el = marked[i];
              el.style.top = '';
              el.style.left = '';
              el.style.right = '';
              el.style.bottom = '';
              el.style.maxHeight = '';
              el.removeAttribute('data-dsh-anchor-fallback');
            }
          }
          undoPreviousRun();

          // 只接管**真正依赖 anchor() 摆位**的弹层。
          //
          // 这里曾经把所有 role="dialog" 都当成锚点弹层，结果把插件管理 / 归档
          // 管理这类「自己居中」的弹层改坏了：它们用
          //   left:50%; top:50%; transform:translate(-50%,-50%)
          // 居中，我们改写了 top/left 却没动 transform，于是整个弹层又被推走
          // 自身尺寸的一半，内容裁到左边看不见。
          //
          // 判据改成「CSS 里确实写了 anchor() 相关声明」：
          //   - DSH 自己的菜单/子菜单带 data-anchor-side，或 --dsh-menu-anchor；
          //   - 兜底再看 computed style 的 positionAnchor / positionArea。
          // 自带 transform 居中的弹层一律跳过，交给它们自己的 CSS。
          function hasAnchorDeclaration(el) {
            if (el.hasAttribute('data-anchor-side')) return true;
            if (el.hasAttribute('data-anchor-align')) return true;
            var anchorName = getComputedStyle(el).getPropertyValue('anchor-name');
            if (anchorName && anchorName.trim() !== '' && anchorName.trim() !== 'none') return true;
            var positionAnchor = getComputedStyle(el).getPropertyValue('position-anchor');
            if (positionAnchor && positionAnchor.trim() !== '' && positionAnchor.trim() !== 'auto' && positionAnchor.trim() !== 'none') return true;
            return false;
          }

          // 自己居中的弹层：transform 里带 translate，或 inset 四边都为 0。
          // 这类弹层不需要（也不该）由我们摆位。
          function centersItself(el) {
            var t = getComputedStyle(el).transform;
            if (t && t !== 'none') return true;
            return false;
          }

          function isOverlay(el) {
            if (!(el instanceof HTMLElement)) return false;
            var cs = getComputedStyle(el);
            if (cs.position !== 'fixed') return false;
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            if (centersItself(el)) return false;
            if (hasAnchorDeclaration(el)) return true;
            var role = el.getAttribute('role');
            if (role === 'menu' || role === 'listbox') return true;
            if (el.id && /-menu$/.test(el.id)) return true;
            return false;
          }

          // 触发元素：弹层在 DOM 上是 portal（挂在 body），无法从它反推锚点。
          // 用「当前聚焦/最后点击的元素」作为锚点，这是菜单打开时的真实来源。
          var lastTrigger = null;
          function rememberTrigger(event) {
            var t = event.target;
            if (t instanceof Element) lastTrigger = t.closest('button,[role="button"],a,input,select,textarea') || t;
          }
          document.addEventListener('pointerdown', rememberTrigger, true);
          document.addEventListener('click', rememberTrigger, true);
          document.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') rememberTrigger(e);
          }, true);

          function anchorRect(el) {
            if (lastTrigger && document.contains(lastTrigger)) {
              var r = lastTrigger.getBoundingClientRect();
              if (r.width || r.height) return r;
            }
            var a = document.activeElement;
            if (a && a !== document.body && document.contains(a)) return a.getBoundingClientRect();
            return null;
          }

          function place(el) {
            if (!isOverlay(el)) return;
            var anchor = anchorRect(el);
            if (!anchor) return;

            // 先清掉失效的锚点属性，避免它们继续参与布局。
            el.style.positionAnchor = '';
            el.style.positionArea = '';
            el.style.positionTryFallbacks = '';

            var vw = window.innerWidth, vh = window.innerHeight;
            // 先量一次自然尺寸（宽度可能受 min/max-width 约束）。
            el.style.left = MARGIN + 'px';
            el.style.top = MARGIN + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.maxHeight = Math.max(120, vh - MARGIN * 2) + 'px';
            var w = el.offsetWidth, h = el.offsetHeight;

            // 竖直：优先下方，放不下就上方，都放不下就贴边并限高。
            var top = anchor.bottom + GAP;
            if (top + h > vh - MARGIN) {
              var above = anchor.top - GAP - h;
              if (above >= MARGIN) top = above;
              else {
                top = MARGIN;
                el.style.maxHeight = Math.max(120, vh - MARGIN * 2) + 'px';
              }
            }
            // 水平：与触发元素左对齐，超出右边界则右对齐，再不行贴边。
            var left = anchor.left;
            if (left + w > vw - MARGIN) left = anchor.right - w;
            if (left < MARGIN) left = MARGIN;
            if (left + w > vw - MARGIN) left = Math.max(MARGIN, vw - MARGIN - w);

            el.style.top = Math.round(top) + 'px';
            el.style.left = Math.round(left) + 'px';
            el.setAttribute('data-dsh-anchor-fallback', '1');
          }

          function scan() {
            // 不再无条件抓 role="dialog"：自带居中的弹层（插件管理、归档管理）
            // 必须原样交给它们自己的 CSS，否则会被推偏。
            var nodes = document.querySelectorAll('[data-anchor-side],[data-anchor-align],[role="menu"],[role="listbox"],[id$="-menu"]');
            for (var i = 0; i < nodes.length; i++) place(nodes[i]);
          }

          // 弹层是 React 动态插入的：监听 DOM 变化，插入后下一帧摆位。
          var pending = false;
          function schedule() {
            if (pending) return;
            pending = true;
            requestAnimationFrame(function () {
              pending = false;
              scan();
            });
          }
          // atDocumentStart 时 documentElement 可能还没建好（脚本在 <html> 之前
          // 执行）。没有它就不能 observe，等 DOM 就绪后再装监听。
          function installObserver() {
            var root = document.documentElement;
            if (!root) { document.addEventListener('DOMContentLoaded', installObserver, { once: true }); return; }
            var observer = new MutationObserver(schedule);
            observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-anchor-side', 'data-anchor-align'] });
            schedule();
          }
          installObserver();
          window.addEventListener('resize', schedule);
          window.addEventListener('scroll', schedule, true);
        })();
        """
    }

    /// 供单测断言：脚本必须包含的关键片段。缺任何一个都说明降级逻辑被改坏。
    static let requiredFragments = [
        "CSS.supports('position-anchor: --x')",
        "CSS.supports('top: anchor(top)')",
        "data-dsh-anchor-fallback",
        "MutationObserver"
    ]

    /// 是否应该注入：只有内置窗口需要。浏览器回退模式下页面在用户自己的浏览器里，
    /// 那台浏览器支持与否不该由启动器改变。
    static func shouldInstall(embeddedWindow: Bool) -> Bool {
        embeddedWindow
    }
}
