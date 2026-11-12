package app

// controller.go is the dsh lifecycle: the startup flow (port, planner
// decision, install when the user agrees, launch, browser), the restart
// flow, and the exit watcher that relaunches after dsh's own
// exit-0 restart request. It ports the start/launch/install sections of
// Sources/main.swift.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt/planner"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshrt/progress"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/dshupdate"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/harnessweb"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/launch"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/nodeenv"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

// launcher states, mirroring LauncherState on macOS.
const (
	stateStopped  = iota // not running, no error
	stateChecking        // port probing / deciding what to do
	stateRunning         // dsh serving
	stateFailed          // last attempt failed
)

// controller drives dsh for the tray app.
type controller struct {
	mu sync.Mutex

	app      *application.App
	version  string
	portItem *application.MenuItem
	launcher *launch.Launcher
	state    int
	port     int
	reused   bool

	// runCtx/runCancel live as long as the current dsh run does — NOT
	// as long as launchInstalled's stack: cancelling there would kill a
	// freshly ready dsh the moment its launch function returns.
	runCtx    context.Context
	runCancel context.CancelFunc

	// notifier sends Windows toasts; nil when unavailable (the badge and
	// the menu still carry the news).
	notifier *notifications.NotificationService

	// monitorGen retires a session poller when dsh stops or restarts.
	monitorGen int
	// pollFailures counts consecutive silent polls, so a log line marks
	// the first one and then every twentieth instead of every 3.5s
	pollFailures  int
	pluginUpdates pluginUpdateSummary

	// pending updates the menu rows and the badge report.
	pendingDSHUpdate       *dshupdate.Candidate
	pendingLauncherUpdate  *launcherRelease
	skippedDSHVersion      string
	skippedLauncherVersion string
	// settings the page edits
	updateIntervalHours    float64
	autoCheckPluginUpdates bool
	openBrowserOnReady     bool
	// sidebarDeck 是实验性的接管型侧栏（DSHSidebarDeck）：默认关，还在优化。
	sidebarDeck         bool
	globalHotKeyEnabled bool
	globalHotKey        string
	desktopShortcut     bool
	npmRegistry         string
	// restartGuard is set while a user-initiated restart is in flight,
	// so the exit watcher does not double-launch.
	restarting bool
	// starting is the "a Start() is in flight" latch. It is deliberately
	// NOT derived from state == stateChecking: the update, restart and
	// relaunch flows all put the launcher into stateChecking *before*
	// calling Start, so using the state as the mutex made those flows a
	// no-op — the launcher sat on "正在停止…" forever and no later click
	// could start dsh again (2026-11-12: dsh update to 0.2.2-rc.2 wedged
	// the app until it was restarted).
	starting bool
	// rebuildDeclined is the user's "no" to a runtime rebuild, this run.
	rebuildDeclined bool
	// installCancel stops a running install (the progress window's 取消
	// button calls it).
	installCancel context.CancelFunc

	// dshVersion caches the installed runtime's version for the panel's
	// 更新 tab: asking the runtime spawns a `dsh --version` process, which
	// is far too slow to run on every panel refresh. dshVersionAsked makes
	// the lazy fill a once-per-process affair.
	dshVersion      string
	dshVersionAsked bool

	// theme is the panel colour scheme: "system" (""), "light" or "dark".
	theme string
	// autoCheckUpdates gates the periodic launcher/dsh update checks.
	autoCheckUpdates bool
	// autoUpdate downloads and installs launcher updates without asking.
	autoUpdate bool
	// notifyOnComplete shows a Windows toast when a session finishes.
	notifyOnComplete bool
	// lastAutoVersion remembers which launcher version was already
	// auto-installed, so one release is installed exactly once.
	lastAutoVersion string
}

func newController(a *application.App) *controller {
	// notifyOnComplete defaults to on; the settings file can turn it off.
	return &controller{app: a, autoCheckUpdates: true, notifyOnComplete: true}
}

// setState updates the port row (disabled, the informational line) —
// the single place the tray text reflects state, the way setMenuRow was
// the only writer on macOS.
func (c *controller) setState(state int, text string) {
	c.mu.Lock()
	c.state = state
	c.mu.Unlock()
	application.InvokeSync(func() {
		if c.portItem == nil {
			return
		}
		c.portItem.SetLabel(text)
	})
	applog.Logf("state -> %d %s", state, text)
}

func (c *controller) currentState() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// nodeDir locates the portable node next to the exe (node\node.exe),
// falling back to PATH (empty string). The bundled node is the way the
// Windows launcher frees its users from installing Node; the PATH
// fallback covers developers who would rather manage their own.
// lookPath finds a Windows executable on PATH.
func lookPath(name string) (string, error) {
	return exec.LookPath(name)
}

func nodeDir() string {
	exe, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "node")
		if _, err := os.Stat(filepath.Join(candidate, "node.exe")); err == nil {
			return candidate
		}
	}
	if path, err := lookPath("node.exe"); err == nil && path != "" {
		return filepath.Dir(path)
	}
	return ""
}

func (c *controller) npmPath(env map[string]string) string {
	if dir := nodeDir(); dir != "" {
		candidate := filepath.Join(dir, "npm.cmd")
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	if path, ok := nodeenv.FindExecutable("npm", env); ok {
		return path
	}
	return ""
}

// dshEntryPath is the runtime's dsh entry to execute. On Windows the
// npm .cmd shim is the entry; running it goes through proc.Batch so
// cmd.exe reads the arguments back correctly.
func (c *controller) dshEntryPath() string { return dshrt.ExecutablePath() }

// cancelInstall stops a running dsh install; the progress window's 取消
// button reaches it through ProgressBridge.
func (c *controller) cancelInstall() {
	c.mu.Lock()
	cancel := c.installCancel
	c.mu.Unlock()
	if cancel != nil {
		applog.Logf("install cancelled from progress window")
		cancel()
	}
}

// ProgressBridge is what the progress window calls into.
type ProgressBridge struct {
	ctl *controller
}

// Cancel stops the running install.
func (b *ProgressBridge) Cancel() {
	if b.ctl != nil {
		b.ctl.cancelInstall()
	}
}

// ensureDSHVersion fills the cached dsh version once per process, in the
// background: asking the runtime spawns a `dsh --version` process, which
// is far too slow for the panel to block on every refresh. The version
// also lands here through checkUpdates and updateDSHTo; this covers a
// panel opened before the first update check (the first one runs 8s after
// start).
func (c *controller) ensureDSHVersion() {
	c.mu.Lock()
	known := c.dshVersion != "" || c.dshVersionAsked
	c.dshVersionAsked = true
	c.mu.Unlock()
	if known {
		return
	}
	go func() {
		v := dshVersionOf(nodeEnvironment())
		c.mu.Lock()
		c.dshVersion = v
		c.mu.Unlock()
		if v != "" {
			refreshOpenPanel()
		}
	}()
}

// installedDSHVersion asks the installed runtime for its version; ""
// when it cannot be read.
func (c *controller) installedDSHVersion(env map[string]string) string {
	entry := c.dshEntryPath()
	cmd := proc.Command(entry, "--version")
	cmd.Env = flattenEnv(env)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return dshupdate.VersionFromOutput(string(output))
}

// startDecision is what Start does when it is entered.
type startDecision int

const (
	startProceed     startDecision = iota // go on and bring dsh up
	startShowBrowser                      // already up: just show the page
	startInFlight                         // another Start owns the launch
)

// beginStart claims the launch latch. The latch is `starting`, never the
// state: every flow that restarts dsh (update, 重启, exit-0 relaunch)
// sets stateChecking *before* calling Start, so a state-based mutex made
// those flows return immediately and the launcher never came back up.
func (c *controller) beginStart() startDecision {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state == stateRunning || c.restarting {
		return startShowBrowser
	}
	if c.starting {
		return startInFlight
	}
	c.starting = true
	return startProceed
}

// Start is the 打开/启动 flow. Everything runs on this goroutine; UI
// touches go through InvokeSync.
func (c *controller) Start() {
	switch c.beginStart() {
	case startShowBrowser:
		// already up: 打开 just brings the browser forward (below)
		c.openBrowserForCurrent()
		return
	case startInFlight:
		return
	}
	defer func() {
		c.mu.Lock()
		c.starting = false
		c.mu.Unlock()
	}()
	c.setState(stateChecking, "检测端口…")

	// bundled plugins land on disk and into the profile node_modules
	if _, err := launch.Prepare(); err != nil {
		applog.Logf("plugin prepare failed: %v", err)
	}

	port, reuse, err := launch.FindPort()
	if err != nil {
		c.setState(stateFailed, "未找到可用端口")
		warn("Deepseek Harness Launcher", err.Error())
		return
	}
	if reuse {
		// An instance already answers on the port. Verify it once more
		// before adopting: a single slow probe can report a port as served
		// when nothing is there, and adopting a dead port leaves the user
		// with a browser tab that cannot connect.
		if !launch.Reuse(port) {
			applog.Logf("port %d looked served but did not answer twice; launching our own", port)
			reuse = false
		}
	}
	if reuse {
		c.mu.Lock()
		c.port = port
		c.reused = true
		c.mu.Unlock()
		c.setState(stateRunning, fmt.Sprintf("端口：%d（已接管）", port))
		c.startSessionMonitor()
		c.prepareHarnessURL(port, nil)
		// watch the adopted instance: if it dies, start our own rather than
		// leaving the user with a tab that cannot connect
		go c.watchAdopted(port)
		return
	}

	env := nodeenv.NodeEnvironment(nodeDir(), nil)
	// the settings plugin inside dsh talks to the launcher over this URL
	control.mu.Lock()
	if control.port != 0 {
		env["DHL_CONTROL_URL"] = fmt.Sprintf("http://127.0.0.1:%d", control.port)
		env["DHL_CONTROL_TOKEN"] = control.token
	}
	control.mu.Unlock()
	// the runtime decision: install only ever happens behind a dialog
	var upgrade *planner.BundledRuntimeUpgrade
	installed := dshrt.IsInstalled()
	runnable := dshrt.CanAttemptLaunch()
	if installed {
		if b, i, ok := dshrt.BundledUpgradeTarget(c.installedDSHVersion(env)); ok {
			upgrade = &planner.BundledRuntimeUpgrade{Bundled: b, Installed: i}
		}
	}
	action := planner.Plan(planner.Input{
		RuntimeInstalled:          installed,
		RuntimeRunnable:           runnable,
		RecoverySnapshotAvailable: dshrt.HasRuntimeSnapshot(),
		BundledUpgradeTarget:      upgrade,
		HarnessInstallPresent:     dshrt.HasHarnessInstall(),
		RebuildDeclinedThisRun:    c.rebuildDeclined,
	})

	switch action {
	case planner.LaunchInstalled:
		c.launchInstalled(port, env)
	case planner.RecoverSnapshot:
		if dshrt.HasRuntimeSnapshot() && dshrt.RestoreRuntimeSnapshot() {
			applog.Logf("runtime recovered from snapshot")
			c.launchInstalled(port, env)
			return
		}
		// the snapshot was itself incomplete: treat as rebuild
		if !c.offerRebuild(port, env) {
			return
		}
		c.installAndLaunch(port, env, dshrt.InstallOptions{Force: true})
	case planner.OfferBundledUpgrade:
		text := fmt.Sprintf(
			"应用自带了更新的 dsh 版本。\n\n当前版本：%s\n目标版本：%s\n\n更新会重新安装运行环境（依赖已锁定，通常很快）。\n现在更新吗？",
			upgrade.Installed, upgrade.Bundled)
		bringToFront()
		if !confirm("更新 Deepseek Harness 运行环境", text) {
			// declined once is not a broken runtime: start what is there
			c.launchInstalled(port, env)
			return
		}
		c.installAndLaunch(port, env, dshrt.InstallOptions{Force: true})
	case planner.OfferRepair:
		if !c.offerRebuild(port, env) {
			return
		}
		c.installAndLaunch(port, env, dshrt.InstallOptions{Force: true})
	case planner.RebuildDeclined:
		c.setState(stateFailed, "未启动（运行环境缺失）")
	case planner.FirstInstall:
		text := "欢迎使用 Deepseek Harness Launcher。\n\n" +
			"首次使用需要联网下载并安装 DeepSeek Harness 运行环境（npm 依赖，约百余个包），\n" +
			"安装到 ~/.dsh/runtime，全程用户级、不需要管理员权限。\n\n现在开始安装吗？"
		bringToFront()
		if !confirm("安装 Deepseek Harness", text) {
			c.setState(stateFailed, "未安装")
			return
		}
		c.installAndLaunch(port, env, dshrt.InstallOptions{})
	}
}

// offerRebuild asks once about rebuilding a missing runtime; a no is
// remembered for this run.
func (c *controller) offerRebuild(port int, env map[string]string) bool {
	text := "DeepSeek Harness 的运行环境缺失（~/.dsh/runtime 不存在）。\n" +
		"你的会话与数据不受影响，可以原地重建运行环境。\n\n现在重建吗？"
	bringToFront()
	if !confirm("重建运行环境", text) {
		c.rebuildDeclined = true
		c.setState(stateFailed, "未启动（运行环境缺失）")
		return false
	}
	return true
}

// installAndLaunch runs the npm install (with the progress window and
// registry fallback), then launches.
func (c *controller) installAndLaunch(port int, env map[string]string, opts dshrt.InstallOptions) {
	npmPath := c.npmPath(env)
	if npmPath == "" {
		c.setState(stateFailed, "未找到 npm")
		warn("Deepseek Harness Launcher",
			"未找到 npm。\n\n请把捆绑的 node 目录放在程序旁边（node\\node.exe），\n或自行安装 Node.js 后重试。")
		return
	}
	opts.NpmPath = npmPath
	// the user's chosen mirror goes in as the explicit override, so the
	// install chain puts it first and keeps the defaults as fallbacks
	if registry := c.chosenRegistry(); registry != "" {
		env["DHL_NPM_REGISTRY"] = registry
		opts.Environment = env
	}
	opts.Environment = env

	tracker := newProgressWindow(c.app, "正在安装 Deepseek Harness")
	defer tracker.Close()
	progress := progress.NewTracker()
	opts.OnOutput = func(chunk string) {
		snapshot := progress.Consume(chunk)
		tracker.Update(snapshot.Detail, snapshot.Percentage)
	}

	applog.Logf("install start (spec=%q force=%v)", opts.PackageSpec, opts.Force)
	ctx, cancel := context.WithCancel(context.Background())
	c.mu.Lock()
	c.installCancel = cancel
	c.mu.Unlock()
	defer cancel()

	_, err := dshrt.Install(ctx, opts)
	if err != nil {
		tracker.Finish(false)
		c.setState(stateFailed, "安装失败")
		applog.Logf("install failed: %v", err)
		bringToFront()
		if err == dshrt.ErrCancelled {
			tracker.Cancelled()
			warn("Deepseek Harness Launcher", "已取消 dsh 安装")
		} else {
			warn("Deepseek Harness Launcher", "npm 安装 dsh 失败："+err.Error())
		}
		return
	}
	tracker.Finish(true)
	applog.Logf("install done")
	c.launchInstalled(port, env)
}

// launchInstalled starts dsh web on the port and opens the browser when
// ready.
func (c *controller) launchInstalled(port int, env map[string]string) {
	entry := c.dshEntryPath()
	if _, err := os.Stat(entry); err != nil {
		c.setState(stateFailed, "启动失败（dsh 缺失）")
		warn("Deepseek Harness Launcher", "npm 安装完成，但未找到 dsh 可执行文件")
		return
	}
	c.setState(stateChecking, fmt.Sprintf("正在启动（端口 %d）…", port))

	launcher := &launch.Launcher{}
	c.mu.Lock()
	launcher.DeckWanted = c.sidebarDeck
	c.mu.Unlock()
	launcher.Stdout = func(line string) {
		applog.Logf("dsh: %s", strings.TrimRight(line, "\r\n"))
	}
	c.mu.Lock()
	if c.runCancel != nil {
		c.runCancel() // a stale run (should not happen) loses its context
	}
	c.runCtx, c.runCancel = context.WithCancel(context.Background())
	ctx := c.runCtx
	c.launcher = launcher
	c.mu.Unlock()

	if err := launcher.Start(ctx, entry, port, flattenEnv(env)); err != nil {
		c.mu.Lock()
		c.launcher = nil
		c.mu.Unlock()
		if err == context.Canceled {
			return
		}
		c.setState(stateFailed, "启动失败")
		applog.Logf("launch failed: %v", err)
		dshWin.FailurePage("Harness 启动失败", err.Error())
		bringToFront()
		warn("Deepseek Harness Launcher", "dsh 启动失败："+err.Error())
		return
	}

	c.mu.Lock()
	c.port = port
	c.reused = false
	c.mu.Unlock()
	c.setState(stateRunning, fmt.Sprintf("端口：%d", port))
	c.startSessionMonitor()

	// 侧栏「已完成」红点开关：告诉插件本机是内置窗口启动器，让它随命令
	// 轮询下发完成会话 id。Windows 的 WebView2 注不进脚本（ExecJS 对 dsh
	// 页面无效），红点改走插件通道；mac 的启动器从不发这个开关，它的注入
	// 脚本照旧。失败只记日志：红点这一轮不出现，dsh 照常工作。
	go func() {
		if status := postJSON(port, "/dsh-session-notify/launcher-config", `{"sidebarDots":true}`); status != 200 {
			applog.Logf("launcher-config -> HTTP %d（侧栏红点本轮不可用）", status)
		}
	}()

	// exit watcher: dsh exiting 0 while it served (the plugin manager's
	// restart endpoint) means "start me again", not "I am dead"
	go func() {
		err := c.waitLauncher(launcher)
		c.mu.Lock()
		same := c.launcher == launcher
		wasRestarting := c.restarting
		if same {
			c.launcher = nil
		}
		c.mu.Unlock()
		if !same {
			return // a newer launcher took over
		}
		if wasRestarting {
			return // the restart flow owns what happens next
		}
		if err == nil {
			applog.Logf("dsh exited 0 (restart request); relaunching")
			c.setState(stateChecking, "正在重启…")
			c.Start()
			return
		}
		c.mu.Lock()
		c.port = 0 // the served port died with it; refresh/open must not target a corpse
		c.mu.Unlock()
		c.setState(stateFailed, "已退出")
		// the macOS launcher's failure card: a readable page in the
		// window instead of a stale interactive-looking page
		dshWin.FailurePage("Harness 服务已退出", err.Error())
		applog.Logf("dsh exited: %v", err)
	}()

	c.prepareHarnessURLFor(port, launcher)
}

// prepareHarnessURLFor points the main window at this launcher's page,
// waiting briefly for the token entry line first. Start returns as soon
// as the port answers, but the `dsh web: <url>` line is captured by the
// stdout pump a moment later; loading the window before that happened
// left it on the bare port URL (401) or on the previous process's token.
// The wait is bounded and harmless: an older dsh that never prints the
// line just gets the bare URL, which is what it needs.
func (c *controller) prepareHarnessURLFor(port int, l *launch.Launcher) {
	if l != nil {
		l.WaitEntryURL(3 * time.Second)
	}
	c.prepareHarnessURL(port, l)
}

// waitLauncher blocks until the launcher's dsh process exits.
func (c *controller) waitLauncher(l *launch.Launcher) error {
	return l.Wait()
}

// prepareHarnessURL records the Harness page URL for the main window
// WITHOUT showing it. dsh becoming ready is not a request from the user
// to pop a window up — the launcher starts in the tray with a minimised
// main window, and clicking the taskbar button is what reveals it.
// harnessTargetURL is the URL the main window should show for port: the
// token entry when this launcher captured one, the last saved token URL
// for an adopted instance (dsh's front page answers 401 without a token,
// and an adopted instance never printed its token to us).
//
// The saved URL is ONLY an adopted-instance credential. For a dsh this
// launcher started, falling back to it would load the previous process's
// token and render a 401 page — dsh mints a new token on every boot.
func harnessTargetURL(port int, l *launch.Launcher) string {
	if l == nil {
		if saved := harnessweb.LoadLastURL(); saved != "" {
			return saved
		}
		return fmt.Sprintf("http://127.0.0.1:%d/", port)
	}
	return launch.OpenURLForEntry(l, port)
}

func (c *controller) prepareHarnessURL(port int, l *launch.Launcher) {
	dshWin.SetURL(c.app, harnessTargetURL(port, l))
}

// openBrowser shows the Harness page in the launcher's own window. The
// page itself is served by dsh (token entry URL when it printed one, the
// bare loopback URL for an adopted instance), with the bundled plugins
// injected server-side — so it is the same UI the browser showed.
//
// This replaces the macOS-style "hand the URL to the system browser"
// behaviour on Windows: the taskbar button then belongs to a real window,
// and Windows itself handles click-to-restore / click-to-minimise. No
// foreground hooks or window hunting needed.
func (c *controller) openBrowser(port int, l *launch.Launcher) bool {
	c.prepareHarnessURL(port, l)
	dshWin.Show(c.app, "")
	return true
}

// refreshUpdateRows repaints the panel's update rows. The panel renders
// from the live model, so this is just a re-render of an open panel.
func (c *controller) refreshUpdateMenuRows() {
	refreshOpenPanel()
}

func (c *controller) openBrowserForCurrent() {
	c.mu.Lock()
	port, l := c.port, c.launcher
	c.mu.Unlock()
	if port == 0 {
		return
	}
	c.openBrowser(port, l)
}

// RefreshPage is the 刷新页面 row (and the Ctrl+R chord): reload the
// Harness page without restarting dsh — the macOS launcher's ⌘R entry.
// dsh not running behaves like 打开 (it starts the runtime first).
func (c *controller) RefreshPage() {
	c.mu.Lock()
	port, l := c.port, c.launcher
	c.mu.Unlock()
	if port == 0 {
		go c.Open()
		return
	}
	target := harnessTargetURL(port, l)
	dshWin.SetURL(c.app, target) // re-point in case dsh was restarted under us
	dshWin.Reload(c.app)
}

// Restart is the 重启 menu row: stop the tree, then start again.
func (c *controller) Restart() {
	c.mu.Lock()
	if c.restarting {
		c.mu.Unlock()
		return
	}
	c.restarting = true
	launcher := c.launcher
	c.mu.Unlock()

	c.setState(stateChecking, "正在重启…")
	if launcher != nil && launcher.Running() {
		launcher.Stop()
	}
	// the old process tree is dead; the exit watcher is told to stand
	// down by restarting above
	go func() {
		c.mu.Lock()
		c.launcher = nil
		c.mu.Unlock()
		c.restarting = false
		c.Start()
	}()
}

// Quit stops dsh and tears the app down.
// Quit stops dsh and exits, matching the macOS launcher's quit(): that one
// calls stopDHL and then terminates, so the menu row "退出 Deepseek
// Harness" really does end the server. Leaving it running was my deviation
// and it surprised the user — the row says "quit Harness", not "close the
// launcher".
func (c *controller) Quit() {
	c.mu.Lock()
	launcher := c.launcher
	c.mu.Unlock()
	// stop the child we started, then sweep anything else carrying our
	// runtime — an adopted instance, or a process an interrupted update
	// left behind. The macOS launcher does the same through
	// managedDSHPIDs; stopping only the remembered child leaves orphans
	// holding the port.
	if launcher != nil && launcher.Running() {
		launcher.Stop()
	}
	StopAll()
	applog.Logf("launcher quitting; dsh stopped")
	c.app.Quit()
}

// chosenRegistry is the mirror the user picked in settings, or "" to use
// the default chain (China mirror first, official second).
func (c *controller) chosenRegistry() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.npmRegistry
}

// setTheme stores the panel colour scheme ("system"/"light"/"dark"; ""
// means system).
func (c *controller) setTheme(mode string) {
	c.mu.Lock()
	c.theme = mode
	c.mu.Unlock()
	saveSettings()
}

// setOpenOnReady toggles "show the main window when dsh is ready".
func (c *controller) setOpenOnReady(on bool) {
	c.mu.Lock()
	c.openBrowserOnReady = on
	c.mu.Unlock()
	saveSettings()
}

// setSidebarDeck toggles the experimental takeover sidebar. It only takes
// effect on the NEXT dsh launch: the takeover patch is staged per boot.
func (c *controller) setSidebarDeck(on bool) {
	c.mu.Lock()
	c.sidebarDeck = on
	c.mu.Unlock()
	saveSettings()
}

// setAutoCheckPluginUpdates toggles the plugin-update poll.
func (c *controller) setAutoCheckPluginUpdates(on bool) {
	c.mu.Lock()
	c.autoCheckPluginUpdates = on
	c.mu.Unlock()
	saveSettings()
}

// mirrorEnabled reports whether installs prefer the China mirror. An
// unset registry means the default chain, which is npmmirror-first.
func (c *controller) mirrorEnabled() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.npmRegistry == "" || strings.Contains(c.npmRegistry, "npmmirror")
}

// setMirror pins the install source: on = the China mirror explicitly,
// off = official npmjs explicitly (so the choice survives upgrades).
func (c *controller) setMirror(on bool) {
	c.mu.Lock()
	if on {
		c.npmRegistry = "https://registry.npmmirror.com"
	} else {
		c.npmRegistry = "https://registry.npmjs.org"
	}
	c.mu.Unlock()
	saveSettings()
}

// setLaunchAtLoginSetting syncs the registry-backed auto-start entry and
// reports the state that actually stuck.
func (c *controller) setLaunchAtLoginSetting(on bool) bool {
	if err := setLaunchAtLogin(on); err != nil {
		applog.Logf("launch at login: %v", err)
		return launchAtLoginEnabled()
	}
	return on
}

// autoCheckEnabled reports whether the periodic update checks run.
func (c *controller) autoCheckEnabled() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.autoCheckUpdates
}

// setAutoCheckUpdates turns the periodic checks on or off.
func (c *controller) setAutoCheckUpdates(on bool) {
	c.mu.Lock()
	c.autoCheckUpdates = on
	c.mu.Unlock()
	saveSettings()
}

// setAutoUpdate turns unattended launcher updates on or off.
func (c *controller) setAutoUpdate(on bool) {
	c.mu.Lock()
	c.autoUpdate = on
	c.mu.Unlock()
	saveSettings()
}

// setNotifyOnComplete turns the session-finished toast on or off.
func (c *controller) setNotifyOnComplete(on bool) {
	c.mu.Lock()
	c.notifyOnComplete = on
	c.mu.Unlock()
	saveSettings()
}

// frequencyMin/Max bound the update-check interval the stepper can
// reach, in hours.
const (
	frequencyMin = 1.0
	frequencyMax = 168.0 // one week
)

// stepFrequency moves the update-check interval by ONE HOUR and returns
// the new value. A ladder (1/3/6/12/24/48) was rejected: the user expects
// "+" to mean "one more hour", and jumps of six hours made the control
// feel broken.
func (c *controller) stepFrequency(dir string) float64 {
	c.mu.Lock()
	cur := c.updateIntervalHours
	c.mu.Unlock()
	if cur < frequencyMin {
		cur = 6
	}
	if dir == "up" {
		cur++
	} else {
		cur--
	}
	if cur < frequencyMin {
		cur = frequencyMin
	}
	if cur > frequencyMax {
		cur = frequencyMax
	}
	c.mu.Lock()
	c.updateIntervalHours = cur
	c.mu.Unlock()
	saveSettings()
	return cur
}

// setTheme stores the panel colour scheme ("system"/"light"/"dark"; ""
// means system).

// flattenEnv adapts the nodeenv map to an exec environment slice.
// Windows environment keys are case-insensitive, but a Go map is not:
// os.Environ() hands us "Path" while new code writes "PATH", and both
// lines riding into the child's environment block lets the (random) map
// order decide which one survives — that is exactly how dsh.cmd once
// lost node half the time. Deduplicate case-insensitively with a
// DETERMINISTIC winner: original-cased keys are visited in sorted order,
// and a later key overwrites an earlier one (so "PATH" sorts before
// "Path" and wins — the new value is the one we wrote).
func flattenEnv(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	index := map[string]int{}
	var out []string
	for _, k := range keys {
		v := env[k]
		if i, ok := index[strings.ToLower(k)]; ok {
			out[i] = k + "=" + v
			continue
		}
		index[strings.ToLower(k)] = len(out)
		out = append(out, k+"="+v)
	}
	return out
}

// watchAdopted polls an adopted instance and takes over when it stops
// answering. Without this, an instance that dies after adoption leaves the
// launcher showing "已接管" over a dead port, and every click opens a tab
// that cannot connect.
func (c *controller) watchAdopted(port int) {
	failures := 0
	for {
		time.Sleep(5 * time.Second)
		c.mu.Lock()
		same := c.reused && c.port == port
		c.mu.Unlock()
		if !same {
			return // a restart replaced it
		}
		if launch.Reuse(port) {
			failures = 0
			continue
		}
		failures++
		if failures < 3 {
			continue // tolerate a slow moment
		}
		applog.Logf("adopted instance on port %d stopped answering; launching our own", port)
		c.mu.Lock()
		c.reused = false
		c.mu.Unlock()
		c.setState(stateStopped, "未运行")
		go c.Start()
		return
	}
}
