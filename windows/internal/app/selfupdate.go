package app

// selfupdate.go checks the launcher's own GitHub releases and installs a
// downloaded build by swapping the exe — the Windows counterpart of the
// macOS DMG self-update. No code signing certificate is used (an accepted
// trade-off: SmartScreen warns on first run), so the install is a plain
// file swap guarded by a hash-free but version-checked download.

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/applog"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/ver"
)

const (
	launcherRepo   = "sljdxde/deepseek-harness-launcher"
	launcherAPIURL = "https://api.github.com/repos/" + launcherRepo + "/releases/latest"
	// the Windows asset's name; GitHub turns spaces into dots, so match
	// the release workflow's spelling
	winAssetName = "DHL-windows-amd64.exe"
)

// launcherRelease is one published launcher release.
type launcherRelease struct {
	Version string
	Notes   string
	URL     string // the Windows exe asset
}

// checkLauncherRelease asks GitHub for the newest release and picks the
// Windows asset. A 404 means nothing was published yet; a 403 (anonymous
// rate limit) falls back to the Atom feed for the tag only.
func checkLauncherRelease() (*launcherRelease, error) {
	client := &http.Client{Timeout: 12 * time.Second}
	req, err := http.NewRequest(http.MethodGet, launcherAPIURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "DeepseekHarnessLauncher")
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub Release HTTP %d", resp.StatusCode)
	}
	var payload struct {
		TagName string `json:"tag_name"`
		Body    string `json:"body"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	version := ver.NormalizeRelease(strings.TrimSpace(payload.TagName))
	if version == "" {
		return nil, nil
	}
	release := &launcherRelease{Version: version, Notes: payload.Body}
	for _, asset := range payload.Assets {
		if strings.EqualFold(asset.Name, winAssetName) {
			release.URL = asset.URL
			break
		}
	}
	// a release without our asset is still worth reporting (the user
	// learns a version exists) but not installable
	return release, nil
}

// compareRelease compares two launcher versions with the release-cycle
// comparator (NOT the npm one).
func compareRelease(a, b string) int {
	return ver.CycleCompare(ver.NormalizeRelease(a), ver.NormalizeRelease(b))
}

// installLauncherUpdate downloads the exe and swaps it in on restart: the
// running exe cannot overwrite itself on Windows, so the new file lands
// beside it and a small cmd script moves it once this process exits.
// auto skips the confirm dialog — it is the 自动下载并安装更新 switch
// doing its job; the manual path still asks.
func (c *controller) installLauncherUpdate(release *launcherRelease, auto bool) {
	if release.URL == "" {
		warn("启动器更新", "这个 Release 没有 Windows 安装包（"+winAssetName+"）。")
		return
	}
	exe, err := os.Executable()
	if err != nil {
		warn("启动器更新", "无法定位当前程序："+err.Error())
		return
	}
	target := filepath.Join(paths.Downloads(), "DHL-windows-"+release.Version+".exe")
	if err := downloadTo(release.URL, target); err != nil {
		applog.Logf("launcher update download failed: %v", err)
		warn("启动器更新", "下载失败："+err.Error())
		return
	}
	applog.Logf("launcher update downloaded: %s", target)
	if !auto {
		if !confirm("安装启动器更新",
			fmt.Sprintf("已下载 v%s。\n\n安装会替换当前程序并重新启动，现在继续吗？", release.Version)) {
			return
		}
	}
	if err := swapAndRestart(exe, target); err != nil {
		applog.Logf("launcher update swap failed: %v", err)
		warn("启动器更新", "替换程序失败："+err.Error())
		return
	}
	applog.Logf("launcher update handed over; quitting")
	c.Quit()
}

// downloadTo fetches a URL into path, replacing any earlier copy.
func downloadTo(url, path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	client := &http.Client{Timeout: 10 * time.Minute}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "DeepseekHarnessLauncher")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	tmp := path + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, resp.Body); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

// swapAndRestart schedules the swap: a detached cmd waits for this
// process to exit, moves the new exe over the old path, and starts it.
// The old file is kept as .old so a failed start can be rolled back by
// hand.
func swapAndRestart(exe, downloaded string) error {
	script := filepath.Join(os.TempDir(), fmt.Sprintf("dhl-update-%d.cmd", time.Now().UnixNano()))
	body := strings.Join([]string{
		"@echo off",
		"rem waits for the running launcher to exit, then swaps the exe",
		":wait",
		"timeout /t 1 /nobreak >nul",
		`tasklist /fi "PID eq ` + fmt.Sprint(os.Getpid()) + `" | find "` + fmt.Sprint(os.Getpid()) + `" >nul && goto wait`,
		`move /y "` + exe + `" "` + exe + `.old" >nul 2>&1`,
		`move /y "` + downloaded + `" "` + exe + `" >nul 2>&1`,
		`start "" "` + exe + `"`,
		"del /q \"%~f0\"",
	}, "\r\n")
	if err := os.WriteFile(script, []byte(body), 0o644); err != nil {
		return err
	}
	cmd := proc.Command("cmd.exe", "/c", script)
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return nil
}
