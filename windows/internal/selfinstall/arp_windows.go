//go:build windows

package selfinstall

// arp_windows.go owns the Add/Remove Programs entry: HKCU's Uninstall key
// with UninstallString pointing back at the exe's --uninstall, so the
// machine's own uninstall surface works without a setup program. Written
// on install and refreshed on every installed start (the version moves).

import (
	"golang.org/x/sys/windows/registry"
)

// arpKeyPath is this app's per-user uninstall entry.
const arpKeyPath = `Software\Microsoft\Windows\CurrentVersion\Uninstall\DHL`

// RegisterARP writes or refreshes the uninstall entry. Every start of the
// installed copy calls it, so a self-updated exe re-stamps the version
// without a separate step.
func RegisterARP(exe, version string) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, arpKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()

	values := map[string]string{
		"DisplayName":     "Deepseek Harness Launcher",
		"DisplayVersion":  version,
		"DisplayIcon":     exe,
		"InstallLocation": parentDir(exe),
		"Publisher":       "Deepseek Harness Launcher",
		"URLInfoAbout":    "https://github.com/sljdxde/deepseek-harness-launcher",
		// ARP runs UninstallString; the flags go through the app's own
		// uninstall flow (confirm, stop dsh, clean up after exit)
		"UninstallString": `"` + exe + `" --uninstall`,
		"QuietUninstallString": `"` + exe + `" --uninstall --yes`,
		"NoModify":       "1",
		"NoRepair":       "1",
	}
	for name, value := range values {
		if err := key.SetStringValue(name, value); err != nil {
			return err
		}
	}
	return nil
}

// RemoveARP deletes the uninstall entry. Missing is fine: it means the
// entry never existed (a dev or portable run).
func RemoveARP() error {
	return registry.DeleteKey(registry.CURRENT_USER, arpKeyPath)
}

// parentDir is filepath.Dir spelled for the value table's readability.
func parentDir(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '\\' || path[i] == '/' {
			return path[:i]
		}
	}
	return ""
}
