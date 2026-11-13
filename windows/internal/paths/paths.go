// Package paths decides where the Windows launcher keeps things, the way
// LauncherEnvironment.swift and UpdateSupport.swift do on macOS: logs under
// %LOCALAPPDATA%, settings under %APPDATA%, the dsh home under ~/.dsh.
package paths

import (
	"os"
	"path/filepath"
)

// AppDirName is the folder name under the data roots. The macOS app uses
// "Deepseek Harness Launcher" in ~/Library; Windows keeps the short brand,
// the way tray tooltips do.
const AppDirName = "DHL"

// LocalData is %LOCALAPPDATA%: per-machine data that follows no account
// (roams no). Logs and caches live under it.
func LocalData() string {
	if v := os.Getenv("LOCALAPPDATA"); v != "" {
		return v
	}
	return filepath.Join(home(), "AppData", "Local")
}

// RoamingData is %APPDATA%: per-account data that follows the profile.
// Settings live under it.
func RoamingData() string {
	if v := os.Getenv("APPDATA"); v != "" {
		return v
	}
	return filepath.Join(home(), "AppData", "Roaming")
}

// LogDir is where dhl.log is appended, the counterpart of
// ~/Library/Logs/Deepseek Harness Launcher.
func LogDir() string {
	return filepath.Join(LocalData(), AppDirName, "logs")
}

// LogFile is the launcher's own log, the counterpart of dhl.log.
func LogFile() string {
	return filepath.Join(LogDir(), "dhl.log")
}

// SettingsDir is where settings.json lives (macOS keeps UserDefaults in
// the com.local.dhl-launcher domain).
func SettingsDir() string {
	return filepath.Join(RoamingData(), AppDirName)
}

// SettingsFile is the launcher's settings, a JSON file where macOS has
// the defaults database.
func SettingsFile() string {
	return filepath.Join(SettingsDir(), "settings.json")
}

// DSHHome is ~/.dsh, the runtime's install root. dsh itself decides this
// on every platform; the launcher only follows it, honoring DSH_HOME the
// way the macOS launcher does.
func DSHHome() string {
	if v := os.Getenv("DSH_HOME"); v != "" {
		return v
	}
	return filepath.Join(home(), ".dsh")
}

// Downloads is the user's Downloads folder, where the self-update fetches
// its payload before installing it (macOS: ~/Downloads).
func Downloads() string {
	if v := os.Getenv("USERPROFILE"); v != "" {
		return filepath.Join(v, "Downloads")
	}
	return filepath.Join(home(), "Downloads")
}

// home is the user's profile directory.
func home() string {
	if v := os.Getenv("USERPROFILE"); v != "" {
		return v
	}
	h, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return h
}
