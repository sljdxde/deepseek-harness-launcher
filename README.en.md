# DHL (DeepSeek Harness Launcher)

[中文](./README.md)

DHL is a lightweight, native macOS menu-bar launcher for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), the AI-agent platform distributed as `@deepseek-ai/dsh`. Launch `DHL` from Spotlight or Raycast and it starts the Harness `web` profile, stays in the menu bar, and opens the system default browser once the service is ready. It does not embed a browser or provide a separate desktop chat UI.

The app and menu-bar icons are derived from the official `deepseek-harness-desktop` artwork under the MIT license, with limited changes such as the circular app-icon border. See [THIRD_PARTY.md](./THIRD_PARTY.md).

---

## Relationship to DeepSeek Harness

`@deepseek-ai/dsh` is the upstream Harness runtime. It can be used directly from the command line, and the upstream project also provides `deepseek-harness-desktop`, a Tauri 2 desktop shell.

DHL is a third, macOS-only option: a Swift/AppKit menu-bar app with no WebView, Electron, or Tauri wrapper. It launches the dsh runtime available on the host and injects an archive-management enhancement. DHL does not replace the Harness runtime.

---

## Features

| # | Feature | Details |
|---|---|---|
| 1 | **Native menu-bar shell, no WebView** | Built with AppKit and Swift as an `LSUIElement` app, so it stays out of the Dock and follows the system appearance. |
| 2 | **Built-in archive manager** | A Cordis patch adds an Archive Manager panel to Harness Web. It lists archived sessions, supports one-at-a-time and batch deletion with a confirmation step, and shows the workspace and descendant count. |
| 3 | **Port management (3080-3099)** | DHL scans ports starting from 3080. It reuses a responding Harness instance when found; otherwise it launches dsh on the first bindable port. If a reused instance has no archive plugin, Harness remains usable and DHL records basic mode in the log. |
| 4 | **Uses host Node and can fetch dsh automatically** | It runs `npx --prefer-offline --yes @deepseek-ai/dsh`: npm cache is preferred, and npx may download `@deepseek-ai/dsh` when it is absent. DHL does not bundle Node or the dsh runtime. It searches `~/opt/node`, `~/.volta`, `~/.nvm`, `/opt/homebrew/bin`, and `/usr/local/bin`. |
| 5 | **In-app updating** | The menu can check this repository's GitHub Releases, download `DHL.dmg`, replace the app, and restart it. Automatic checks and their interval are configurable. |
| 6 | **Launch at login** | A `LaunchAgent` named `com.local.dhl-launcher` can open DHL when you log in. |
| 7 | **Managed process lifecycle** | Stop and update paths send `SIGTERM` to the managed Harness process group and fall back to `SIGKILL` after a timeout. Matching is restricted to DHL and npm/node processes using DHL's patch. |
| 8 | **Native settings window** | Configure automatic update checks, the interval, browser opening after readiness, and launch at login. |
| 9 | **Live state and logs** | The current port is shown in the menu. stdout, stderr, and lifecycle records are written to `~/Library/Logs/DHL Launcher/dhl.log`. |

**Scope and trade-offs**

- macOS only; Windows and Linux are not supported.
- Node and npm/npx must already be usable on the host. DHL does not manage multiple dsh runtime versions.
- The first start can be slower when `@deepseek-ai/dsh` is not in the npm cache and has to be downloaded.
- DHL only adds its own archive-plugin link and temporary patch. Existing Harness profiles, sessions, and other plugins remain managed by dsh.

---

## Requirements

- macOS 12 or later.
- A terminal-usable Node.js installation and npm/npx. Node 22, or a currently dsh-compatible LTS release, is recommended. DHL does not ship a runtime.
- Network access is required only when the npm cache lacks `@deepseek-ai/dsh`, or when checking/downloading a DHL update.

The launcher executes this command, with a selected port from 3080 through 3099:

```sh
npx --prefer-offline --yes @deepseek-ai/dsh --profile web \
  --patch <cordis.patch.yml inside DHL.app> --no-open --port <3080-3099>
```

### Startup and ports

1. DHL checks ports 3080-3099.
2. If a port returns a Harness home page, DHL reuses that process; otherwise it starts dsh on the first available port.
3. When the Harness home page is ready, DHL enters the running state and, depending on the setting, opens the system default browser once.
4. **Stop Backend** ends Harness processes managed by DHL. **Quit DHL Launcher** only exits the menu-bar UI; the backend continues running.

If no port can be reused or bound, or if npx/the plugin fails to start, DHL shows a failure alert. Use **Open Log** for the command and its stdout/stderr.

---

## Install and build

### Install from source

```sh
./scripts/install.sh                                  # Build Universal 2 -> ~/Applications/DHL.app
DHL_INSTALL_DIR=/Applications ./scripts/install.sh    # Install into system /Applications
```

The script first asks the old launcher to quit. It then sends `SIGTERM`, followed by `SIGKILL` on timeout, to the old launcher and its DHL-managed Harness backend. Once they are confirmed stopped, it keeps a timestamped App backup, uses `ditto` to replace `DHL.app`, and reopens it. Set `DHL_NO_OPEN=1` to skip that final launch. Installation is cancelled rather than replacing an App whose related process cannot be confirmed stopped.

> Command Line Tools are sufficient for the Universal 2 build. Signing and notarization require a complete Xcode and Developer ID environment.

### Build outputs

```sh
./scripts/build-app.sh            # arm64 development build -> build/DHL.app
./scripts/build-universal.sh      # Universal 2 (arm64 + x86_64)
./scripts/build-dmg.sh            # dist/DHL.dmg, with the installation helper
```

The DMG exposes a single **Double-click to install or update** app. It stops old processes, replaces the app, and starts DHL again. It prefers `/Applications/DHL.app` when DHL or the previous `DSH.app` is there; otherwise it installs to `~/Applications/DHL.app`. When `/Applications` is not writable, the installer asks for administrator authorization. The payload is hidden in Finder to prevent accidental drag-and-drop installation.

Default builds are unsigned development artifacts. `scripts/sign-and-notarize.sh` provides a Developer ID signing/notarization entry point; its credentials are environment variables and must not be committed.

### Menu-bar actions

| Menu item | Shortcut | Behavior |
|---|---|---|
| Open DHL | Command-O | Opens Harness at the current port; starts it if needed. |
| Port: xxxx | - | Shows the active port, or Not Running. |
| Restart | Command-R | Stops the backend and starts it again. |
| Stop Backend | Command-S | Terminates the Harness backend. |
| Check for Updates | - | Checks GitHub Releases manually. |
| Settings... | Command-Comma | Opens update, browser, and login settings. |
| Open Log | Command-L | Opens `~/Library/Logs/DHL Launcher/dhl.log`. |
| Quit DHL Launcher | Command-Q | Quits only the menu-bar UI; Harness keeps running. |

### Settings and updates

- Settings include automatic update checks, update interval, opening the browser when Harness is ready, and launching DHL at macOS login.
- Defaults: automatic checks are enabled every 6 hours; the first background check is about 8 seconds after launch; opening the browser is enabled; launch at login is disabled. The minimum interval is one hour.
- The update source is fixed to GitHub Releases for `sljdxde/deepseek-harness-launcher`; users never need to enter a URL. The current App version is `0.1.0`, and only a higher Release version is offered.
- If GitHub's API returns `403`, commonly an unauthenticated rate limit, DHL falls back to the Releases Atom feed for version comparison. When no Release is published, a manual check reports that no update is available.
- A usable Release must contain an asset named `DHL.dmg`. DHL saves it as `~/Downloads/DHL-<version>.dmg` and asks for confirmation before **Install and Restart**. That action stops the backend, replaces the current App, and starts it again.

### Uninstall

```sh
./scripts/uninstall.sh
```

The script removes current and legacy `DHL.app`/`DSH.app` installations and the archive-plugin link when it points to DHL's resources. It preserves `~/.dsh` data, including sessions, archives, profiles, and other plugin data.

---

## Archive Manager plugin

- Location: `Plugins/DSHArchiveManager/`, containing `cordis.patch.yml`, server code in `lib/index.js`, and the React Web-panel injection in `client/client.js`.
- On startup, DHL creates `~/.dsh/profiles/web/node_modules/dsh-archive-manager` as a symbolic link to the bundled resource and passes `--patch <resource>/cordis.patch.yml` to dsh. It does not overwrite existing user Cordis patch files.
- The panel displays sessions still present in `archivedSessionIds`, with their workspace and descendant count. The server API also returns the session creation time and working directory for later UI use.
- It supports individual selection, select-all, individual deletion, and batch deletion. After the user clicks **Confirm Delete** in the second confirmation, it immediately and permanently deletes the selected sessions and their entire descendant trees. It does not require typing `DELETE`, and the delete API does not validate whether a target is running or archived.
- Deletion stages matching session directories in a temporary area under `~/.dsh/sessions`, updates workspace membership and `archivedSessionIds` in `workspace.json`, and then removes the staging area. If index writing fails, staged directory moves are rolled back. Workspace directories themselves are not deleted.
- DHL probes the plugin route after Harness becomes ready. When it cannot be reached, Harness itself stays usable and the log records that DHL is running in basic mode.

### Upgrade compatibility

Older DSH/DHL installations can leave `~/.dsh/profiles/web/node_modules/dsh-archive-manager` as a dangling link to a removed `DSH.app`. DHL detects and replaces a link that points to its own former `DSHArchiveManager` resource, preventing `ERR_MODULE_NOT_FOUND`. A same-named directory or link that is not DHL-owned is left untouched so third-party plugins are not overwritten.

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
| DHL menu-bar App (Swift / AppKit)              |
| state icon · settings · updating · login item  |
+-------------------------+---------------------+
                          | npx --prefer-offline @deepseek-ai/dsh
                          | --profile web --patch <cordis.patch.yml>
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

- Log file: `~/Library/Logs/DHL Launcher/dhl.log`; choose **Open Log** from the menu to reveal it.
- New log entries use the local time zone in `yyyy-MM-dd HH:mm:ss Z` format. Existing UTC log entries are not rewritten.
- For a startup error, first inspect the logged launch command and the following npm/dsh stderr. Common causes are Node/npx outside the discoverable paths, an initial download failure, a non-Harness program occupying a port, or an archive-plugin link pointing to a removed old App.

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
