# Deepseek Harness Launcher (DHL)

[中文](./README.md)

**Deepseek Harness Launcher** is a lightweight, native macOS menu-bar launcher for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the AI-agent platform distributed as `@deepseek-ai/dsh`. Launch it from Spotlight or Raycast by searching `Deepseek Harness Launcher`; `dsh` and `dhl` remain valid shortcuts. It starts the Harness `web` profile, stays in the menu bar, and opens the system default browser once the service is ready. It does not embed a browser or provide a separate desktop chat UI.

The app and menu-bar icons are derived from the official `deepseek-harness-desktop` artwork under the MIT license, with limited changes such as the circular app-icon border. See [THIRD_PARTY.md](./THIRD_PARTY.md).

---

## Relationship to DeepSeek Harness

`@deepseek-ai/dsh` is the upstream Harness runtime. It can be used directly from the command line, and the upstream project also provides `deepseek-harness-desktop`, a Tauri 2 desktop shell.

Deepseek Harness Launcher is a third, macOS-only option: a Swift/AppKit menu-bar app with no WebView, Electron, or Tauri wrapper. It launches the dsh runtime available on the host and injects an archive-management enhancement. It does not replace the Harness runtime.

---

## Features

| # | Feature | Details |
|---|---|---|
| 1 | **Native menu-bar shell, no WebView** | Built with AppKit and Swift as an `LSUIElement` app, so it stays out of the Dock and follows the system appearance. |
| 2 | **Built-in archive manager** | A Cordis patch adds an Archive Manager panel to Harness Web. It lists archived sessions, supports one-at-a-time and batch deletion with a confirmation step, and shows the workspace and descendant count. |
| 3 | **Port management (3080-3099)** | Deepseek Harness Launcher scans ports starting from 3080. It reuses a responding Harness instance when found; otherwise it launches dsh on the first bindable port. If a reused instance has no archive plugin, Harness remains usable and the launcher records basic mode in the log. |
| 4 | **Reliable first install, stable subsequent starts** | On first start it installs `@deepseek-ai/dsh` completely into `~/.dsh/runtime`, keeps peer-dependency resolution enabled, stages into a temporary directory, and swaps atomically. It tries a faster npm mirror first and falls back to the official registry. Later starts run the fixed runtime directly instead of relying on a half-installed npx cache. |
| 5 | **In-app updating** | The menu can check this repository's GitHub Releases, download `Deepseek.Harness.Launcher.dmg` (GitHub stores spaces as dots), replace the app, and restart it. Automatic checks and their interval are configurable. |
| 6 | **Launch at login** | A `LaunchAgent` named `com.local.dhl-launcher` can open Deepseek Harness Launcher when you log in. |
| 7 | **Managed process lifecycle** | Stop and update paths send `SIGTERM` to the managed Harness process group and fall back to `SIGKILL` after a timeout. Matching is restricted to the launcher and npm/node processes using its patch. |
| 8 | **Native settings window** | Configure automatic update checks, the interval, browser opening after readiness, and launch at login. |
| 9 | **Live state and logs** | The current port is shown in the menu. stdout, stderr, and lifecycle records are written to `~/Library/Logs/Deepseek Harness Launcher/dhl.log`. |
| 10 | **Global quick summon** | Press `Control-Option-D` (record a custom combination in Settings) from any app to summon the Deepseek Harness browser window, focusing the existing tab instead of opening a new one. |
| 11 | **Startup dsh update check** | After launch, asynchronously checks the latest `@deepseek-ai/dsh` version on npm without blocking startup, and shows a menu-bar hint when a newer version is available. |

**Scope and trade-offs**

- macOS only; Windows and Linux are not supported.
- Node and npm must already be usable on the host. Deepseek Harness Launcher does not manage multiple dsh runtime versions.
- The first start shows an installation window and can take several minutes; later starts reuse `~/.dsh/runtime`.
- Deepseek Harness Launcher only adds its own archive-plugin link and temporary patch. Existing Harness profiles, sessions, and other plugins remain managed by dsh.

---

## Requirements

- macOS 12 or later.
- A terminal-usable Node.js installation and npm. Node 22, or a currently dsh-compatible LTS release, is recommended. Deepseek Harness Launcher does not ship Node.
- Network access is required for the first install or update of `@deepseek-ai/dsh`, or when checking/downloading a Deepseek Harness Launcher update.

On first start the launcher performs a complete install:

```sh
npm install --prefix ~/.dsh/runtime --no-package-lock --no-audit --no-fund \
  --progress --loglevel=silly --prefer-offline --registry <registry> @deepseek-ai/dsh
```

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
3. When the Harness home page is ready, Deepseek Harness Launcher enters the running state and, depending on the setting, opens the system default browser once.
4. **Quit Deepseek Harness** exits the menu-bar UI and terminates the Harness backend managed by Deepseek Harness Launcher.

If no port can be reused or bound, or if npm, dsh, or the plugin fails to start, Deepseek Harness Launcher shows a failure alert. The first install can be cancelled and its temporary directory is cleaned automatically. Use **Open Log** for the command and its stdout/stderr.

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
| Open Deepseek Harness | Command-O | Opens Harness at the current port; starts it if needed. |
| Global quick summon | Control-Option-D | Summons Harness from any app; customizable in Settings. |
| Port: xxxx | - | Shows the active port, or Not Running. |
| Check for Updates | - | Checks GitHub Releases manually. |
| Settings... | Command-Comma | Opens update, browser, and login settings. |
| Open Log | Command-L | Opens `~/Library/Logs/Deepseek Harness Launcher/dhl.log`. |
| Quit Deepseek Harness | Command-Q | Quits the menu-bar UI and terminates the Harness backend. |

### Settings and updates

- Settings include automatic update checks, update interval, opening the browser when Harness is ready, launching Deepseek Harness Launcher at macOS login, and the global quick-summon shortcut.
- Defaults: automatic checks are enabled every 6 hours; the first background check is about 8 seconds after launch; opening the browser is enabled; launch at login is disabled; the global shortcut is enabled as Control-Option-D. The minimum interval is one hour.
- The update source is fixed to GitHub Releases for `sljdxde/deepseek-harness-launcher`; users never need to enter a URL. The current App version is `0.1.0`, and only a higher Release version is offered.
- Launcher updates and `@deepseek-ai/dsh` updates are separate paths. The dsh check only compares the npm latest version and shows a hint; it never modifies the npm cache.
- If GitHub's API returns `403`, commonly an unauthenticated rate limit, Deepseek Harness Launcher falls back to the Releases Atom feed for version comparison. When no Release is published, a manual check reports that no update is available.
- A usable Release must contain an asset named `Deepseek.Harness.Launcher.dmg` (GitHub replaces spaces in asset names with dots). Deepseek Harness Launcher saves it as `~/Downloads/Deepseek Harness Launcher-<version>.dmg` and asks for confirmation before **Install and Restart**. That action terminates the backend, replaces the current App, and starts Deepseek Harness again.

### Uninstall

```sh
./scripts/uninstall.sh
```

The script removes current and legacy `Deepseek Harness Launcher.app`, `DHL.app`, and `DSH.app` installations, stops and removes the DHL-managed `~/.dsh/runtime` and temporary install directories, prunes historical App backups, detaches and unregisters old DMG volumes/payloads, and removes the archive-plugin link when it points to Deepseek Harness Launcher's resources. It preserves the other `~/.dsh` data, including sessions, archives, profiles, and other plugin data.

---

## Archive Manager plugin

- Location: `Plugins/DSHArchiveManager/`, containing `cordis.patch.yml`, server code in `lib/index.js`, and the React Web-panel injection in `client/client.js`.
- On startup, Deepseek Harness Launcher creates `~/.dsh/profiles/web/node_modules/dsh-archive-manager` as a symbolic link to the bundled resource and passes `--patch <resource>/cordis.patch.yml` to dsh. It does not overwrite existing user Cordis patch files.
- The panel displays sessions still present in `archivedSessionIds`, with their workspace and descendant count. The server API also returns the session creation time and working directory for later UI use.
- It supports individual selection, select-all, individual deletion, and batch deletion. After the user clicks **Confirm Delete** in the second confirmation, it immediately and permanently deletes the selected sessions and their entire descendant trees. It does not require typing `DELETE`, and the delete API does not validate whether a target is running or archived.
- Deletion stages matching session directories in a temporary area under `~/.dsh/sessions`, updates workspace membership and `archivedSessionIds` in `workspace.json`, and then removes the staging area. If index writing fails, staged directory moves are rolled back. Workspace directories themselves are not deleted.
- Deepseek Harness Launcher probes the plugin route after Harness becomes ready. When it cannot be reached, Harness itself stays usable and the log records that the launcher is running in basic mode.

### Upgrade compatibility

Older DSH/DHL installations can leave `~/.dsh/profiles/web/node_modules/dsh-archive-manager` as a dangling link to a removed `DSH.app`. Deepseek Harness Launcher detects and replaces a link that points to its own former `DSHArchiveManager` resource, preventing `ERR_MODULE_NOT_FOUND`. A same-named directory or link that is not owned by Deepseek Harness Launcher is left untouched so third-party plugins are not overwritten.

---

## Icons

- **App icon:** a circular white background with the black creature, derived from `deepseek-harness-desktop`. Assets are under `Resources/icons/candidate-upstream/`; `DHL.iconset/` contains all standard sizes and `DHL.icns` is the packaged result.
- **Menu-bar icon:** `Resources/menubar-creature.png`, rendered from the upstream `macos-tray.svg`. It is installed as a template image, so it appears white in a dark menu bar and black in a light menu bar.
- `scripts/install-icon.sh` packages `DHL.icns` and `menubar-creature.png` into the App bundle.
- See [THIRD_PARTY.md](./THIRD_PARTY.md) for attribution and license notes.

---

## Architecture

```text
+-----------------------------------------------+
| Deepseek Harness Launcher menu-bar App        |
| state icon · settings · updating · login item  |
+-------------------------+---------------------+
                          | ~/.dsh/runtime/node_modules/.bin/dsh
                          | web --patch <cordis.patch.yml>
                          | --no-open --port 3080..3099
                          v
+-----------------------------------------------+
| dsh web profile (localhost, background server) |
|   |- Harness UI  http://127.0.0.1:<port>/      |
|   `- Archive plugin /dsh-archive-manager/*     |
+-------------------------+---------------------+
                          |
                          v
              System default browser opens Harness
```

The dsh data directory is `~/.dsh`; dsh manages its profiles, sessions, and archives.

## Logs and troubleshooting

- Log file: `~/Library/Logs/Deepseek Harness Launcher/dhl.log`; choose **Open Log** from the menu to reveal it.
- New log entries use the local time zone in `yyyy-MM-dd HH:mm:ss Z` format. Existing UTC log entries are not rewritten.
- For a startup error, first inspect the logged launch command and the following npm/dsh stderr. Common causes are Node/npm outside the discoverable paths, registry network failures, a non-Harness program occupying a port, or an archive-plugin link pointing to a removed old App.

---

## Development and tests

- Requirements: macOS 12+ and Xcode Command Line Tools (`swiftc`). CLT is enough to cross-compile Universal 2 binaries.
- `./scripts/test.sh` runs plugin syntax and archive-deletion tests, launcher helper tests, update-check tests, installer-replacement tests, and builds/checks both Universal 2 Apps.

```sh
./scripts/test.sh
```

---

## License

- Main repository: MIT, see [LICENSE](./LICENSE).
- Icon artwork adapted from `deepseek-harness-desktop` (MIT, Copyright 2026 contributors); see [THIRD_PARTY.md](./THIRD_PARTY.md) for attribution and modifications.

> `dsh` can execute local code. Use it only in a trusted, isolated environment suitable for learning, research, or testing.
