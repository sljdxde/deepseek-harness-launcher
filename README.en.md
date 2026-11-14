# Deepseek Harness Launcher (DHL)

[中文](./README.md)

**Deepseek Harness Launcher** is a lightweight, native macOS launcher for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the AI-agent platform distributed as `@deepseek-ai/dsh`. Launch it from Spotlight or Raycast by searching `Deepseek Harness Launcher`; `dsh` and `dhl` remain valid shortcuts. It starts the Harness `web` profile and presents the Harness UI in a **built-in native window** (`NSWindow` + `WKWebView`); the menu-bar and Dock icons stay present, and the built-in window opens by default once the service is ready instead of the system browser. You can switch back to the system browser in Settings (fallback mode).

The app and menu-bar icons are derived from the official `deepseek-harness-desktop` artwork under the MIT license, with limited changes such as the circular app-icon border. See [THIRD_PARTY.md](./THIRD_PARTY.md).

---

## Relationship to DeepSeek Harness

`@deepseek-ai/dsh` is the upstream Harness runtime. It can be used directly from the command line, and the upstream project also provides `deepseek-harness-desktop`, a Tauri 2 desktop shell.

Deepseek Harness Launcher is a third, lightweight option: on macOS it is a native Swift/AppKit app that hosts the Harness UI in an embedded `WKWebView` window (the default UI, with a browser fallback in Settings); on Windows it is a Go + Wails tray app, with feature parity on both platforms. It is not a full Electron or Tauri shell: it launches the dsh runtime already installed on the host and injects bundled plugins such as the archive manager, plugin manager, and the page-presence heartbeat / session-jump channel (`DSHSessionNotify`). It does not replace the Harness runtime.

The only differences between the two platforms are how the system mechanisms are implemented, not which features exist:

| Capability | macOS | Windows |
|---|---|---|
| Resident entry | Menu-bar status item + Dock icon | Tray icon + a **Harness main window** that can be pinned to the taskbar |
| Opening the UI | Menu-bar menu "Open" / global ⌃⌥D | **Click the taskbar button to restore the Harness main window, click again to minimize** (native Windows behavior); click/right-click the tray icon for the launcher panel (Sessions / Updates / Settings tabs) |
| dsh page | Built-in `WKWebView` window (can fall back to the system browser) | dsh page embedded in the launcher's own window (same injected plugins) |
| Launch at login | `LaunchAgent` | Registry `HKCU\...\Run` |
| Self update | Download the DMG, replace the .app | Download the exe, replace it and restart |
| Completion reminders | Menu-bar numeric badge + Dock number + a **Session completions** menu list (counted per session, survives restarts); the Harness sidebar stays DSH's own, with no injected dots | Red unread badge on the tray/taskbar + a **Sessions** panel list + Windows Toast notifications; no injected sidebar dots either |
| Node runtime | Uses the system node/npm | **Bundled portable Node (embedded in the exe)** (no install needed, or fall back to the system node) |
| Installation | Double-click the installer inside the DMG | **The exe is the installer**: double-click to install into `%LOCALAPPDATA%`, with Control Panel uninstall |

---

## Features

| # | Feature | Details |
|---|---|---|
| 1 | **Native shell + built-in Harness window** | Built with AppKit and Swift; the launcher owns an `NSWindow` + `WKWebView` window that hosts the Harness UI (the default UI, with a browser fallback in Settings). `LSUIElement=false`, so the menu-bar and Dock icons stay present. Compared with Tauri/Electron it bundles no Node runtime: smaller on disk, lower memory, and it follows the system appearance. |
| 2 | **Built-in archive manager** | A Cordis patch adds an Archive Manager panel to Harness Web. It lists archived sessions, supports one-at-a-time and batch deletion with a confirmation step, and shows the workspace and descendant count. |
| 3 | **Port management (3080-3099)** | Deepseek Harness Launcher scans ports starting from 3080. It reuses a responding Harness instance when found; otherwise it launches dsh on the first bindable port. If a reused instance has no archive plugin, Harness remains usable and the launcher records basic mode in the log. |
| 4 | **Reliable first install, stable subsequent starts** | On first start it installs `@deepseek-ai/dsh` completely into `~/.dsh/runtime`, keeps peer-dependency resolution enabled, stages into a temporary directory, and swaps atomically. It tries a faster npm mirror first and falls back to the official registry. Later starts run the fixed runtime directly instead of relying on a half-installed npx cache. |
| 5 | **In-app updating** | The menu can check this repository's GitHub Releases, download `Deepseek.Harness.Launcher.dmg` (GitHub stores spaces as dots), replace the app, and restart it. A background timer checks automatically on the configured interval (6 hours by default). |
| 6 | **Launch at login** | A `LaunchAgent` named `com.local.dhl-launcher` can open Deepseek Harness Launcher when you log in. |
| 7 | **Managed process lifecycle** | Stop and update paths send `SIGTERM` to the managed Harness process group and fall back to `SIGKILL` after a timeout. Matching is restricted to the launcher and npm/node processes using its patch. |
| 8 | **Native settings window** | Configure the update-check interval, plugin-update checking, showing Harness in the built-in window (without opening a browser), opening the Harness UI when ready, launch at login, and the global quick-summon shortcut. |
| 9 | **Live state and logs** | The current port is shown in the menu. stdout, stderr, and lifecycle records are written to `~/Library/Logs/Deepseek Harness Launcher/dhl.log`. |
| 10 | **Global quick summon** | Press `Control-Option-D` (record a custom combination in Settings) from any app to open and bring forward the built-in Harness window; dsh is started first if needed. The default path has no browser instance, AppleScript, or tab matching, and never opens extra tabs or windows. Browser fallback mode keeps the original tab-reuse and degradation logic (the macOS multi-instance addressing limit is described under "Browser fallback mode"). |
| 11 | **Scheduled update checks (dsh + launcher)** | A background timer — always on, one round every 6 hours by default, the first 8 seconds after launch — checks npm for a newer `@deepseek-ai/dsh` and this repository's Releases for a newer launcher, without blocking startup. When something is available the menu row says so and the menu-bar icon gains a blue up-arrow badge, so you see it without opening the menu. |
| 12 | **Built-in plugin manager** | Adds a Plugin Manager entry to the Harness Web sidebar with Installed and Marketplace pages: view/uninstall installed plugins, update them to the latest version, or **ignore one version** (the update stops counting as available; a higher remote version brings it back), and browse a marketplace built from two sources: the community `awesome-dsh-plugin` list and **DeepSeek's official plugins** (npm `@deepseek-ai` packages that declare `dsh.bundle`, pinned first in the category list; DeepSeek maintains no third-party list repo and ships no index source), with categories, search, sort by stars/downloads and one-click install. Before updating, the row's "更新内容" action shows that version's GitHub Release notes or the matching CHANGELOG section; after an update only that plugin's cached check result is patched, so other plugins keep their update markers. The sidebar entry renders an icon only — no badge — and the launcher menu row no longer shows the available-update count (it is written to the log instead and drives the update-progress window). Install/uninstall run through `dsh plugin --profile web`, bootstrapping pnpm via corepack when missing. Every plugin row has a **Disable / Enable** switch: disabling writes that plugin's rows in the dsh plugin tree into the launcher's `--patch` overlay (`disabled: true`) and takes effect after dsh restarts; enabling removes that overlay. Bundled plugins can be disabled too (they still cannot be uninstalled), but `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and the plugin manager itself cannot be disabled — their switches are greyed out with an explanation. |
| 13 | **Session completion statistics (menu bar / Dock numbers)** | The bundled `DSHSessionNotify` plugin records root-session `turn/end` events in Harness, and the launcher polls the feed to maintain an *unread session count*: a numeric pill at the bottom-right of the menu-bar icon, the same number on the Dock icon, and a **Session completions** section at the top of the menu (workspace name + time + result). Clicking a row jumps to that session and clears only that row. The unread set is persisted in UserDefaults, so a launcher restart/update does not zero it. Counting is per **session** (a long session finishing many turns counts once), and `resumed` / `viewed` / `aborted` retract the matching reminder. **No red dots are injected into the Harness sidebar**: its own "已完成" status dot remains DSH's, and the launcher only does statistics and numeric hints. |
| 14 | **Automatic recovery from startup failures (removed)** | The launcher no longer disables plugins, bisects, or falls back to safe mode when dsh fails to start; it reports the failure as-is and leaves the profile's dependencies and bundle list untouched. |
| 15 | **Abnormal-completion status dot (Windows built-in)** | The Windows launcher bundles `dsh-interrupted-dot`: normal endings (completed / user stop / max tokens / blocked) keep DSH's own green dot, while abnormal endings (`error`, `interrupted`, including a mid-turn process crash) paint that **same** dot red — no second dot is added, and opening the session or starting it again restores it. The macOS launcher does not bundle it yet (installed locally via `local-plugins`). |

**Scope and trade-offs**

- macOS and Windows are supported; Linux is not.
- The built-in window only hosts the Harness page (a loopback host and the current port): external and documentation links go to the system browser, and it is not a general-purpose browser with an address bar. Turning off the built-in-window switch restores the complete browser path (fallback mode).
- On macOS, Node and npm must already be usable on the host; the Windows build bundles portable Node. Deepseek Harness Launcher does not manage multiple dsh runtime versions.
- The first start shows an installation window and can take several minutes; later starts reuse `~/.dsh/runtime`.
- Deepseek Harness Launcher only adds its own bundled-plugin links (archive manager, plugin manager, session notifications) and temporary patches. Existing Harness profiles, sessions, and other plugins remain managed by dsh.

---

## Requirements

- macOS 12 or later.
- A terminal-usable Node.js installation and npm. Node 22, or a currently dsh-compatible LTS release, is recommended. Deepseek Harness Launcher does not ship Node.
- Network access is required for the first install or update of `@deepseek-ai/dsh`, or when checking/downloading a Deepseek Harness Launcher update.

On first start the launcher performs a complete install:

```sh
npm ci --prefix ~/.dsh/runtime --no-audit --no-fund --prefer-offline \
  --registry <registry>
```

The app ships a pinned `dsh-runtime/package-lock.json`, so the install replays an already-resolved dependency set through `npm ci` instead of the about 3 GB a bare `npm install` can need while re-resolving the whole graph. Measured peaks: about 190-220 MB with a cold cache, about 1.2-1.3 GB once every tarball is cached (npm reifies the whole tree in one burst); the V8 ceiling is 1536 MB.

Updating dsh never re-resolves the graph either: when a new app version ships a newer lockfile, the launcher **asks once** on start (**Update runtime** / **Later**). Choosing **Later** does not block anything — the current runtime starts as usual and the menu keeps an **Update runtime to vX (bundled)** entry you can use at any time. The launcher never starts an install just because an update exists.

After installation it executes:

```sh
~/.dsh/runtime/node_modules/.bin/dsh web \
  --patch <cordis.patch.yml inside Deepseek Harness Launcher.app> --no-open --port <3080-3099>
```

The default registry order is `registry.npmmirror.com`, then `registry.npmjs.org`. Set `DHL_NPM_REGISTRY` to use a company or private registry.

The installation window reads npm's actual output and shows the current npm operation (resolve, download, write, validate), actual successful download records, and elapsed time. It shows a percentage only when npm provides a stable dependency total and real completion events; the percentage is always formatted to two decimal places, with no remaining-time estimate.

If npm keeps failing inside the launcher, the failure dialog provides this copyable official fallback:

```sh
npx @deepseek-ai/dsh web
```

Leave the terminal process running, then reopen Deepseek Harness Launcher; it will reuse the running Harness. Add `--no-open` if the command should not open a browser.

### Startup and ports

1. Deepseek Harness Launcher checks ports 3080-3099.
2. If a port returns a Harness home page, it reuses that process; otherwise it starts dsh on the first available port.
3. When the Harness home page is ready, Deepseek Harness Launcher enters the running state and, depending on the settings, opens the Harness UI automatically (on by default): the built-in window when the built-in-window switch is on, or the system default browser once in fallback mode.
4. **Quit Deepseek Harness** exits the launcher (menu-bar icon, Dock icon, and the built-in window together) and terminates the Harness backend managed by Deepseek Harness Launcher. Closing the window is not quitting: dsh keeps running in the background, and clicking the Dock icon, pressing Command-O, or choosing **Open Deepseek Harness** brings the window back.

If no port can be reused or bound, or if npm, dsh, or the plugin fails to start, Deepseek Harness Launcher shows a failure alert. The first install can be cancelled and its temporary directory is cleaned automatically. Use **Open Log** for the command and its stdout/stderr.

### Startup never forces an install or runtime update

The launcher separates "is this runtime usable" from "is the dependency tree complete": if `.bin/dsh` is still there, the environment gets a chance to start instead of being declared dead and replaced. Every install action during startup needs the user's consent first:

- **Bundled lockfile is newer**: one prompt (**Update runtime** / **Later**). **Later** starts the current runtime and is remembered, so it is not asked again; the **Update runtime to vX (bundled)** menu entry stays available.
- **Runtime missing** (dsh was used on this machine but `~/.dsh/runtime` is gone): one prompt (**Reinstall** / **Later**). **Later** is not repeated on every open, and a **Rebuild Deepseek Harness runtime** menu entry appears.
- **Replacement interrupted midway** (the previous environment only exists as a `runtime.previous-*` snapshot): it is swapped back automatically and started — no reinstall dialog, no network install. The uninstall script likewise only prunes such snapshots once the real runtime is in place, so it never deletes the user's only working environment.

---

## Install and build

### Install from source

```sh
./scripts/install.sh                                  # Build Universal 2 -> ~/Applications/Deepseek Harness Launcher.app
DHL_INSTALL_DIR=/Applications ./scripts/install.sh    # Install into system /Applications
```

The script first asks the old launcher to quit. It then sends `SIGTERM`, followed by `SIGKILL` on timeout, to the old launcher and its Deepseek Harness Launcher-managed Harness backend. Once they are confirmed stopped, it keeps a timestamped App backup, uses `ditto` to replace `Deepseek Harness Launcher.app`, and reopens it. After a successful reinstall it prunes older App backups, unregisters stale DMG payload entries, and removes quarantine from the new App. Set `DHL_NO_OPEN=1` to skip that final launch. Installation is cancelled rather than replacing an App whose related process cannot be confirmed stopped.

> Command Line Tools are sufficient for the Universal 2 build. Signing and notarization require a complete Xcode and Developer ID environment.

### Build outputs

```sh
./scripts/build-app.sh            # arm64 development build -> build/Deepseek Harness Launcher.app
./scripts/build-universal.sh      # Universal 2 (arm64 + x86_64)
./scripts/build-dmg.sh            # dist/Deepseek Harness Launcher.dmg, with the installation helper
./scripts/test.sh                # full regression suite, including DMG packaging and verification
```

See [TESTING.md](TESTING.md) for the full regression checklist and release gate. GitHub Actions runs it on every commit; a failed suite blocks release creation and updates.

The DMG exposes a single **Double-click to install or update** app. The installer embeds the complete Deepseek Harness Launcher.app, so it still works when copied out of the DMG or moved to another folder; the hidden DMG payload remains only for compatibility with older install/update flows. It stops old processes, replaces the app, and starts Deepseek Harness Launcher again. It prefers `/Applications/Deepseek Harness Launcher.app` when the launcher or a legacy `DHL.app`/`DSH.app` is there; otherwise it installs to `~/Applications/Deepseek Harness Launcher.app`. When `/Applications` is not writable, the installer asks for administrator authorization.

Default builds are ad-hoc signed for local use. A directly downloaded copy can still be rejected by Gatekeeper with a “damaged” alert; run `xattr -dr com.apple.quarantine "/Applications/Deepseek Harness Launcher.app"` and try again. For distribution, `scripts/sign-and-notarize.sh` provides a Developer ID signing/notarization entry point; its credentials are environment variables and must not be committed.

### Menu-bar actions

| Menu item | Shortcut | Behavior |
|---|---|---|
| Open Deepseek Harness | Command-O | Opens/presents the built-in Harness window; starts dsh if needed. In browser fallback mode it reuses or opens a Harness tab instead. |
| Global quick summon | Control-Option-D | Brings the built-in Harness window forward from any app; customizable in Settings. |
| Port: xxxx | - | Shows the active port, or Not Running. |
| Check for Updates | - | Checks GitHub Releases manually; background checks run on the configured interval and raise a blue up-arrow badge on the menu-bar icon. |
| Settings... | Command-Comma | Opens update, built-in window, browser fallback, and login settings. |
| Open Log | Command-L | Opens `~/Library/Logs/Deepseek Harness Launcher/dhl.log`. |
| Quit Deepseek Harness | Command-Q | Quits the launcher and terminates the Harness backend. |

### Main menu and window

The launcher is now a regular app (`LSUIElement=false`) with a permanent Dock icon and a full main menu:

| Menu | Items and shortcuts |
|---|---|
| Application | About Deepseek Harness Launcher, Settings… Command-Comma, Quit Deepseek Harness Command-Q |
| Edit | Undo Command-Z, Redo Shift-Command-Z, Cut Command-X, Copy Command-C, Paste Command-V, Delete, Select All Command-A (copy/paste inside WKWebView depends on it) |
| View | Reload Harness Page Command-R, Open Log Command-L |
| Window | Minimize Command-M, Close Command-W, Open Harness Window Command-O |

- The main-menu Command-R only reloads the built-in window's page; it does not restart dsh. It does not conflict with the menu-bar **Restart Deepseek Harness** Command-R: menu-bar shortcuts only apply while that menu is open.
- Closing the window (Command-W or the red close button) does not quit: dsh keeps running in the background, and the menu-bar icon and port status keep working. Clicking the Dock icon, pressing Command-O, or choosing **Open Deepseek Harness** brings the window back.
- Quit still uses Command-Q or the **Quit Deepseek Harness** menu entry, which ends the built-in window and the managed dsh backend together.
- After a dsh restart the built-in window reloads automatically with the new process's token entry (the old token is dead; without the reload it would sit on a 401 page); the menu bar still shows "已重启 ✓".
- The window title is "Deepseek Harness", the default size is 1280×860, the minimum is 960×600, and the last position/size is restored; if the WebKit content process crashes, the page reloads automatically.
- Inside the window: external links (not `127.0.0.1`/`localhost`/`::1` or the current port) go to the system browser; `<input type=file>` uses the native file picker (attachment uploads work); downloads go to `~/Downloads` (duplicate names get a number instead of overwriting); JS alert/confirm/prompt use native dialogs.

### Settings and updates

- Settings include the update-check interval, plugin-update checking, showing Harness in the built-in window (without opening a browser), opening the Harness UI when ready, launching Deepseek Harness Launcher at macOS login, and the global quick-summon shortcut.
- Defaults: **background checks are always on**, one round every 6 hours, with the first one about 8 seconds after launch; plugin-update checking is on; **the built-in window is on**; opening the Harness UI when ready is enabled; launch at login is disabled; the global shortcut is enabled as Control-Option-D. The minimum interval is one hour.
- Turning off **Show Harness in the built-in window (without opening a browser)** returns to the old browser path (fallback mode): the old code and behavior are kept intact, for cases where the built-in window cannot be used or you need browser extensions. See **Browser fallback mode** below.
- **Both update paths can be ignored ("skip this version")**: the launcher's own dialog and the dsh dialog both end with *Skip this version* / *Un-skip this version*. A skipped version never titles the menu and never raises the badge — the row returns to its plain "检测启动器（DHL）更新" / "检查 Deepseek Harness 更新" text instead of parking a long title in the most prominent slot. The record persists across restarts, a higher remote version notifies again, and clicking the row still opens the dialog where the skip can be undone.
- Background checks are always on, report only, and never install silently: neither the launcher's own update check nor the dsh check has an on/off switch (historically that switch turned the launcher check into a manual-only click, which made it look like there was no background timer at all while dsh checks kept running). When a newer version exists, the menu-bar icon shows a **blue up-arrow badge** at its top-right and hovering explains whether it is the launcher or Deepseek Harness that can be updated; the actual update still starts only from the menu entry.
- The update source is fixed to GitHub Releases for `sljdxde/deepseek-harness-launcher`; users never need to enter a URL. The current App version is `0.4.2`, and only a higher Release version is offered.
- Launcher updates and `@deepseek-ai/dsh` updates are separate paths. The dsh check reads both the **npm dist-tags** (`latest` / `next` / `beta` / `alpha`) and the **GitHub Releases feed** for `deepseek-ai/deepseek-harness` (the anonymous API is rate-limited with `403` often enough that the Atom feed is the reliable source), then takes the newest version that is actually published to npm. It only reports; it never modifies the npm cache. Menu and dialog both label the channel (stable / release candidate / beta / alpha), because npm's `latest` regularly lags behind a freshly published Release.
- Whether dsh is updated is entirely the user's call: the dialog offers **Update to vX / Later / Skip this version**, a pre-release makes *Later* the default button (pressing Return never installs an alpha by accident), and the dialog shows the source (GitHub Release or an npm tag), the publish date, and the Markdown release notes. **When more than one version is newer than the installed one, the dialog adds an "Update to: [version ▾]" picker** listing them all (newest first, at most 10, newest preselected); switching refreshes that version's source, date and notes, and retitles the button to *Update to vX*. With a single candidate the dialog stays the plain one-version prompt. *Skip this version* skips the selected entry and is remembered: that version no longer titles the menu or raises the badge (the row goes back to its plain title), while a manual menu click still opens the dialog, where the skip can be undone. Automatic checks only update the menu title and the menu-bar badge — they **never install silently**.
- A dsh Release tag looks like `dsh-v0.1.7-alpha.1` and is treated as the same version as the npm version `0.1.7-alpha.1`; GitHub Releases are preferred when both name a version (they carry the date and notes). Only candidates present in npm's version list are offered: when a mirror lags, a Release tag that npm does not serve yet would fail with `ETARGET`, so it is dropped and explained in the log.
- dsh versions are compared with npm (semver) semantics: a pre-release sorts below the matching official version, and `alpha.1 < alpha.2` / `rc.2 < rc.3` are distinguished. The launcher's own `compareVersions` (for `x.y.z-a.b[-SNAPSHOT]`) does not distinguish the latter, which is why dsh has its own `compareDSHVersions`.
- If GitHub's API returns `403`, commonly an unauthenticated rate limit, Deepseek Harness Launcher falls back to the Releases Atom feed for version comparison. When no Release is published, a manual check reports that no update is available.
- A usable Release must contain an asset named `Deepseek.Harness.Launcher.dmg` (GitHub replaces spaces in asset names with dots). Deepseek Harness Launcher saves it as `~/Downloads/Deepseek Harness Launcher-<version>.dmg` and asks for confirmation before **Install and Restart**. That action terminates the backend, replaces the current App, and starts Deepseek Harness again.

### Browser fallback mode

Turning off **Show Harness in the built-in window (without opening a browser)** in Settings returns the launcher to the original browser path. That code and behavior are kept intact and are meant for fallback cases (the built-in window cannot be used, you need a browser extension, or you simply prefer Harness in your browser).

- Harness opens in the system default browser; **Open Deepseek Harness** and the global shortcut go through the browser path.
- An existing Harness tab is reused/brought forward; tab matching is by origin (`scheme://host:port`). On first use macOS asks whether the launcher may control Chrome/Safari.
- When the same browser runs multiple instances (resident automation browsers such as `agent-browser` or `chrome-devtools-mcp`), macOS only sends AppleScript events to the most recently launched instance. When the instance actually connected to Harness is not the addressed one, the launcher leaves the other instance's tabs alone: if the Harness page is already visible it only brings the browser forward; if you switched to another tab it opens a new tab in the connected instance (addressed by pid) and switches to the target session, logging the hint that quitting the background instance restores in-tab switching. This is a platform limit, not something the launcher can fix (see [`docs/fix-session-jump-tab-focus.md`](docs/fix-session-jump-tab-focus.md)).
- Browser fallback mode also keeps the focus-priority command claiming and all degradation paths.

### Plugin version detection and updates

- **How "newer" is decided, per source.** npm packages are compared against the registry's `dist-tags` (`latest` only — a stable install is never pushed a rc/beta/alpha). `github:` dependencies and `plugin-sources` clones are compared through `git ls-remote` plus the remote `package.json`: **a higher remote version is what counts**, and a changed commit with an unchanged version is only annotated ("远端有新提交"). A difference in major version is still offered, tagged as "跨大版本 vX", and the update button installs the newest release regardless of the range recorded in the profile.
- **Source identification.** Cloning into `plugin-sources` writes a `.dsh-source.json` marker (author / repo / subdir / commit). Clones made before this feature have no marker, so detection resolves them in order of authority — `repository.url` + `repository.directory` from the plugin's own `package.json`, then a market-index-confirmed directory name, then directory-name candidates — confirming each with `git ls-remote` and writing the marker back. Plugins that resolve to nothing (local or private) are reported as "未识别到可检测的远端来源".
- **No plugin compatibility checks.** Startup, plugin updates and installs no longer compare `peerDependencies`/engine requirements against the dsh runtime, and no longer probe the target version's peer declarations over the network. The market's `latest` often targets a newer dsh than the one installed (e.g. v0.30.0 requires `^0.2.2-rc.1` while the runtime is 0.2.1-rc.2), so the old gate pinned users to a version they could never leave and added a `pnpm view` round trip; the startup scan also requested `/installed` and walked `node_modules` reading every `package.json`. Incomplete installs are still rolled back by the post-install check (`installedImportGaps`); a plugin that installs but fails to load is only reported, never isolated or disabled automatically.
- **Ignoring a version.** The per-row "忽略" button and the "忽略选中" toolbar action hide an update you do not want to see. It applies to **that one version** (recorded in the profile's `.plugin-updates-ignored.json`, matched by `name` + version), so a higher remote version notifies again and nothing is pinned forever. Ignored entries no longer count towards the available-update total or "全部更新", while the row keeps its update and "取消忽略" buttons. The detection cache `.plugin-updates.json` always holds the raw result — ignoring is applied when the result is read, so un-ignoring restores it instantly without re-checking the network.
- **Updating.** npm → `pnpm add <name>@<latest>`; `github:` → re-resolve from the recorded spec; a `plugin-sources` clone → the old directory is renamed to `.bak-<timestamp>` before the fresh clone and restored if the clone fails (only the newest backup is kept). Server-side plugin code needs a **dsh restart** to take effect.
- **Reading the remote `package.json`.** `raw.githubusercontent.com` first (no token needed, so the normal path never touches the API); when that fails (timeout, stall, 404) it falls back to `api.github.com/repos/.../contents` and decodes the base64 payload. Networks that throttle raw hard (measured on a CN link: one GET took 14–60 s and often stalled mid-transfer) otherwise leave every `github:` plugin permanently "failed". The abort message is reported as "拉取远端 package.json 超时（N 秒）" instead of undici's internal wording.
- **Background checking** is on by default (turn it off with "自动检测插件更新" in Settings). The launcher triggers a refresh about 15 seconds after Harness is ready and then follows the check interval (6 hours by default); results are cached in `.plugin-updates.json` under the profile so nothing hits the network again within six hours. Turning the switch off stops background checking only — the manual "检查更新" button in the panel still works.
- **Where it shows up.** Each row of the installed list shows the current version plus "可更新到 vX" (update one, ignore one, update all, or ignore the selection) and the panel shows when it last checked; the available-update count is only written to the launcher log (it drives the update-progress window): the sidebar entry renders an icon only and the launcher menu row no longer reports it, and ignored entries are excluded from the count. External/older Harness instances without these routes simply degrade silently.

### Plugin compatibility checks (removed)

The launcher **no longer runs plugin compatibility checks**: no static scan at startup, no peer comparison when updating a plugin, no version-requirement filtering when installing. Such checks slowed readiness and updates (a `pnpm view` round trip, an `/installed` request, walking `node_modules` to read every `package.json`) and regularly pinned users to an old version because the market's `latest` targets a newer dsh — all to raise warnings the user cannot act on.

- A plugin that really breaks dsh is now only reported: the launcher no longer disables, isolates, or rolls back any plugin (see below).
- The npm range helpers and their table-driven tests now live only in `Plugins/DSHPluginManager/lib/index.js` and `plugin-peer-compat.test.js`; the launcher performs no compatibility checks and no longer maintains a second Swift implementation.
- dsh's official plugin market filters versions by `engines.dsh` on its own. That lives in the dsh runtime, not in this launcher repository.

### Startup failure auto-recovery (removed)

The launcher **no longer** decides which plugin should be disabled. The pre-launch static pre-check (scanning relative imports and pre-isolating), stderr attribution and bisect after a failed launch, the isolation overlay (`--patch` + `disabled: true`), safe mode (`--profile rescue`), the one-click rollback prompt after a failed dsh update, and the "N plugins isolated" menu entry have all been removed.

- If dsh exits during startup, the launcher only logs and reports it; no automatic restart or plugin disabling.
- Normal launch arguments no longer carry an **automatic isolation** overlay; plugins the user explicitly disables in the panel still take effect through a separate `disabled` overlay (see "Built-in plugin manager").
- The implementation and tests for that recovery machinery have been removed rather than kept as a second set of semantics. `Sources/PluginIsolationSupport.swift` now only holds what the main flow still calls: reading the user-disabled state, rendering its overlay, and assembling the launch arguments.

### Windows: install, uninstall, and builds

Install (the exe is the installer; it is user-level and needs no administrator rights):

1. Download `DHL-windows-amd64.exe` from GitHub Releases (portable Node is embedded, so no Node.js install is required);
2. Double-click it: the launcher installs itself into `%LOCALAPPDATA%\Programs\DHL` (copies the exe and extracts the bundled Node), creates a Start-menu shortcut and an "Installed apps" uninstall entry, then starts. Double-clicking a newer installer afterwards upgrades the installed copy (the same version simply starts it). On first run SmartScreen may warn about an unknown publisher; choose "More info -> Run anyway".

To skip self-installation, run it with the `DHL_NO_INSTALL=1` environment variable, or put a `.portable` marker file / `data` directory next to the exe (portable mode). Running the exe directly from the build directory is development mode and also skips self-installation.

Uninstall (all `~/.dsh` data and the runtime are preserved); choose one:

- Launcher "Settings" -> "About" -> "Uninstall launcher";
- Windows "Settings -> Apps -> Installed apps" -> uninstall Deepseek Harness Launcher;
- The command line `DHL.exe --uninstall`.

Uninstalling stops dsh and removes `%LOCALAPPDATA%\Programs\DHL` (including historical backups), `%LOCALAPPDATA%\DHL` (logs and bundled plugin copies), Start-menu/desktop/taskbar shortcuts, the autostart registry entry and the uninstall entry, and prunes profile links to bundled plugins; **other `~/.dsh` data** (sessions, credentials, runtime, and user-installed plugins) is preserved.

Build from source (Go 1.26+):

```powershell
cd windows
powershell -ExecutionPolicy Bypass -File fetch-node.ps1   # download portable Node and keep the zip (for embedding into the exe)
powershell -ExecutionPolicy Bypass -File build.ps1         # build\DHL.exe (self-contained installer)
go test ./...                                              # unit tests
```

### Uninstall

```sh
./scripts/uninstall.sh
```

The script removes current and legacy `Deepseek Harness Launcher.app`, `DHL.app`, and `DSH.app` installations, stops the DHL-managed Harness, prunes historical App backups and interrupted-install leftovers (`~/.dsh/runtime.installing-*`, `runtime.broken-*`), detaches and unregisters old DMG volumes/payloads, and removes the archive-plugin link when it points to Deepseek Harness Launcher's resources. It preserves the other `~/.dsh` data, including sessions, archives, profiles, and other plugin data. A `~/.dsh/runtime.previous-*` snapshot is a complete environment left behind by an interrupted runtime replacement: when the real runtime is missing it is restored first, and it is only pruned once the real runtime is in place — the user's only working environment is never deleted.

---

## Archive Manager plugin

- Location: `Plugins/DSHArchiveManager/`, containing `cordis.patch.yml`, server code in `lib/index.js`, and the React Web-panel injection in `client/client.js`.
- On startup, Deepseek Harness Launcher creates `~/.dsh/profiles/web/node_modules/dsh-archive-manager` as a symbolic link to the bundled resource and passes `--patch <resource>/cordis.patch.yml` to dsh. It does not overwrite existing user Cordis patch files.
- The panel displays sessions still present in `archivedSessionIds`, with their workspace and descendant count. The server API also returns the session creation time and working directory for later UI use.
- It supports individual selection, select-all, individual deletion, and batch deletion. After the user clicks **Confirm Delete** in the second confirmation, it immediately and permanently deletes the selected sessions and their entire descendant trees. It does not require typing `DELETE`, and the delete API does not validate whether a target is running or archived.
- Deletion stages matching session directories in a temporary area under `~/.dsh/sessions`, updates workspace membership and `archivedSessionIds` in `workspace.json`, and then removes the staging area. If index writing fails, staged directory moves are rolled back. Workspace directories themselves are not deleted.
- Deepseek Harness Launcher probes the plugin route after Harness becomes ready. When it cannot be reached, Harness itself stays usable and the log records that the launcher is running in basic mode.

### Upgrade compatibility

Older DSH/DHL installations can leave `~/.dsh/profiles/web/node_modules/dsh-archive-manager` as a dangling link to a removed `DSH.app`. Deepseek Harness Launcher detects and replaces a link that points to its own former `DSHArchiveManager` resource, preventing `ERR_MODULE_NOT_FOUND`. A same-named directory or link that is not owned by Deepseek Harness Launcher is left untouched so third-party plugins are not overwritten. Bundled plugins from earlier releases (`DSHMoreMenu`, `DSHUiEnhance`, `DSHLauncherSettings`, `DSHSidebarDeck`) have been retired; the launcher reclaims same-named dangling links that still point into an app bundle's old resources at startup. Plugins installed by the user under those names are never removed.

---

## What the bundled notification plugin (DSHSessionNotify) still provides

The launcher still maintains completion statistics — menu-bar numeric badge, Dock number, and the **Session completions** menu list — by polling the plugin's event feed, but it **does not inject red dots into the Harness sidebar**: that sidebar status dot stays DSH's own. The bundled plugin provides three capabilities:

- **Page-presence heartbeat**: the injected client reports its clientId, visibility, and the session it is showing every 750 ms (`GET /dsh-session-notify/commands?...&viewing=…&visible=…`), and `GET /dsh-session-notify/presence` summarizes "is a Harness page connected right now, and is it visible?". Browser fallback mode uses it to decide between reusing a tab and opening a new one — Chrome keep-alive sockets stay ESTABLISHED long after every tab is closed, so socket checks alone mislead.
- **Completion event feed**: `GET /dsh-session-notify/events?after=<seq>` returns `completion` / `resumed` / `viewed` deltas; the launcher turns them into the unread session count behind the menu-bar badge, the Dock number, and the menu list.
- **Session-jump command channel (plugin side)**: `POST /dsh-session-notify/open` queues a command and a page claims it while polling (`/dsh-session-notify/commands`, focused-first, visible-first, with a TTL). Both the macOS launcher (completion row click, embedded window adds `requireEmbedded`) and the Windows panel's session rows post it, so it must not be deleted from the shared plugin.

Sidebar dots were removed from the shared plugin entirely: both platforms turn completion state into numbers (menu bar / Dock / tray / taskbar) and completion lists only, while the Harness sidebar's own "已完成" dot stays DSH's own.

---

## Icons

- **App icon:** a circular white background with the black creature, derived from `deepseek-harness-desktop`. Assets are under `Resources/icons/candidate-upstream/`; `DHL.iconset/` contains all standard sizes and `DHL.icns` is the packaged result.
- **Menu-bar icon:** `Resources/menubar-creature.png`, rendered from the upstream `macos-tray.svg`. It is installed as a template image, so it appears white in a dark menu bar and black in a light menu bar.
- `scripts/install-icon.sh` packages `DHL.icns` and `menubar-creature.png` into the App bundle.
- See [THIRD_PARTY.md](./THIRD_PARTY.md) for attribution and license notes.

---

## Architecture

```text
┌────────────────────────────────────────────────┐
│ Deepseek Harness Launcher (macOS app)          │
│   menu-bar icon · Dock icon · Settings window  │
│   ├─ built-in Harness window (WKWebView)       │
│   └─ self-update · login item · update badge   │
└───────────────┬────────────────────────────────┘
                │ launch: ~/.dsh/runtime/node_modules/.bin/dsh
                │         web --patch <cordis.patch.yml>
                │         --no-open --port 3080..3099
                ▼
┌────────────────────────────────────────────────┐
│ dsh web profile (localhost, background)        │
│   ├─ Harness UI  http://127.0.0.1:<port>/      │
│   └─ archive plugin  /dsh-archive-manager/*    │
└────────────────────────────────────────────────┘
                │ WebSocket / HTTP (loopback only)
                ▼
  The built-in window loads the Harness page directly
  (turn the built-in window off = browser fallback mode:
   the system default browser opens Harness instead)
```

The dsh data directory is `~/.dsh`; dsh manages its profiles, sessions, and archives.

## Logs and troubleshooting

- Log file: `~/Library/Logs/Deepseek Harness Launcher/dhl.log`; choose **Open Log** from the menu to reveal it.
- New log entries use the local time zone in `yyyy-MM-dd HH:mm:ss Z` format. Existing UTC log entries are not rewritten.
- For a startup error, first inspect the logged launch command and the following npm/dsh stderr. Common causes are Node/npm outside the discoverable paths, registry network failures, a non-Harness program occupying a port, or an archive-plugin link pointing to a removed old App.
- If the built-in window shows **Harness page requires authentication**, the current dsh was started externally (or just restarted) and the launcher has no token entry for it. Click **Open Deepseek Harness** in the menu bar to retry; for an external instance, switch back to browser opening in Settings, or use **Restart Deepseek Harness** so the launcher takes it over.

---

## Development and tests

- Requirements: macOS 12+ and Xcode Command Line Tools (`swiftc`). CLT is enough to cross-compile Universal 2 binaries.
- `./scripts/test.sh` is still the full regression: plugin syntax and archive-deletion tests, launcher helper tests, update-check tests, installer-replacement tests, and builds/checks both Universal 2 Apps.
- `./scripts/test.sh --fast` skips packaging (Universal 2 build, installer, DMG) and runs only the assertions, for quick iteration.
- `./scripts/test-one.sh <suite>` runs a single Swift test, where `<suite>` is the middle of `scripts/test-<suite>.swift` (e.g. `update-support`, `status-badge`).
- `scripts/test-harness-window.swift` locks the built-in window's decision layer: open/reload/present-only, external-link routing, non-overwriting downloads, the 401 fallback page, and main-menu shortcuts; `./scripts/test-one.sh harness-window` runs just that suite. The full suite remains `./scripts/test.sh`.

```sh
./scripts/test.sh
```

---

## License

- Main repository: MIT, see [LICENSE](./LICENSE).
- Icon artwork adapted from `deepseek-harness-desktop` (MIT, Copyright 2026 contributors); see [THIRD_PARTY.md](./THIRD_PARTY.md) for attribution and modifications.

> `dsh` can execute local code. Use it only in a trusted, isolated environment suitable for learning, research, or testing.
