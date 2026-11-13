package app

// Pure-logic tests for the shell: badge labels, hotkey parsing, settings
// formatting, and the taskbar/ tray badge agreement. Nothing here touches
// a window, a COM object, or the registry — those are exercised on a real
// machine (see TESTING.md).

import (
	"strings"
	"testing"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/harnessweb"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/launch"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/nodeenv"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

// badgeText is the one label rule the tray tile and the taskbar button
// share, so the two badges can never show different numbers. It follows
// the macOS BadgeText rule.
func TestBadgeText(t *testing.T) {
	cases := []struct {
		count int
		want  string
	}{
		{-5, ""}, // negative is treated as none
		{0, ""},  // none clears the badge
		{1, "1"},
		{9, "9"},
		{10, "10"},
		{99, "99"},   // last exact number
		{100, "99+"}, // above 99 is capped
		{1000, "99+"},
	}
	for _, c := range cases {
		if got := badgeText(c.count); got != c.want {
			t.Errorf("badgeText(%d) = %q, want %q", c.count, got, c.want)
		}
	}
}

// parseHotkey reads the settings page's "Ctrl+Alt+D" style chords.
func TestParseHotkey(t *testing.T) {
	const (
		modAlt     = 0x0001
		modControl = 0x0002
		modShift   = 0x0004
		modWin     = 0x0008
	)
	cases := []struct {
		chord   string
		wantMod int
		wantVK  int
		wantOK  bool
	}{
		{"Ctrl+Alt+D", modControl | modAlt, 'D', true},
		{"ctrl+alt+d", modControl | modAlt, 'D', true}, // case-insensitive
		{"Ctrl+Shift+A", modControl | modShift, 'A', true},
		{"Alt+F1", modAlt, 0x70, true}, // VK_F1
		{"Ctrl+Alt+F12", modControl | modAlt, 0x7B, true},
		{"Win+Alt+H", modWin | modAlt, 'H', true},
		{"Ctrl+Alt+1", modControl | modAlt, '1', true},
		// malformed input must be refused, not guessed at
		{"", 0, 0, false},
		{"Ctrl+Alt", 0, 0, false},       // no key
		{"Ctrl+Alt+", 0, 0, false},      // trailing separator
		{"Ctrl+Alt+F99", 0, 0, false},   // F-key out of range
		{"Ctrl+Alt+Space", 0, 0, false}, // named key not supported
	}
	for _, c := range cases {
		mod, vk, ok := parseHotkey(c.chord)
		if ok != c.wantOK {
			t.Errorf("parseHotkey(%q) ok = %v, want %v", c.chord, ok, c.wantOK)
			continue
		}
		if !ok {
			continue
		}
		if mod != c.wantMod || vk != c.wantVK {
			t.Errorf("parseHotkey(%q) = mod 0x%x vk 0x%x, want 0x%x 0x%x",
				c.chord, mod, vk, c.wantMod, c.wantVK)
		}
	}
}

// fmtInterval renders the update interval the settings page shows.
func TestFmtInterval(t *testing.T) {
	cases := []struct {
		hours float64
		want  string
	}{
		{0, "6"},  // zero falls back to the default
		{-3, "6"}, // negative too
		{1, "1"},
		{6, "6"},
		{24, "24"},
		{1.5, "1.5"},
		{6.25, "6.2"}, // one decimal
	}
	for _, c := range cases {
		if got := fmtInterval(c.hours); got != c.want {
			t.Errorf("fmtInterval(%v) = %q, want %q", c.hours, got, c.want)
		}
	}
}

// escapeSingle protects paths inside a PowerShell single-quoted string.
func TestEscapeSingle(t *testing.T) {
	cases := []struct{ in, want string }{
		{`C:\plain\path.exe`, `C:\plain\path.exe`},
		{`C:\it's here\x.exe`, `C:\it''s here\x.exe`},
		{`''`, `''''`},
		{``, ``},
	}
	for _, c := range cases {
		if got := escapeSingle(c.in); got != c.want {
			t.Errorf("escapeSingle(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// settingsFile round-trips through JSON, and the unread rows survive it —
// that is what keeps the menu rows after a restart, not just the count.
func TestSettingsRoundTrip(t *testing.T) {
	original := settingsFile{
		UpdateIntervalHours:    6,
		AutoCheckPluginUpdates: true,
		OpenBrowserOnReady:     true,
		LaunchAtLogin:          false,
		GlobalHotKeyEnabled:    true,
		GlobalHotKey:           "Ctrl+Alt+D",
		SkippedDSHVersion:      "0.2.3",
		SkippedLauncherVersion: "0.4.0",
		DesktopShortcut:        true,
		UnreadEvents: []session.Event{
			{Seq: 1, SessionID: "s1", Title: "会话", Reason: "completed", At: 1000, Kind: "completion"},
		},
	}
	data, err := marshalJSON(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var restored settingsFile
	if err := unmarshalJSON(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if restored.GlobalHotKey != original.GlobalHotKey ||
		restored.UpdateIntervalHours != original.UpdateIntervalHours ||
		restored.AutoCheckPluginUpdates != original.AutoCheckPluginUpdates ||
		restored.DesktopShortcut != original.DesktopShortcut ||
		restored.SkippedDSHVersion != original.SkippedDSHVersion {
		t.Errorf("settings round-trip lost fields: %+v", restored)
	}
	if len(restored.UnreadEvents) != 1 || restored.UnreadEvents[0].SessionID != "s1" {
		t.Errorf("unread rows lost: %+v", restored.UnreadEvents)
	}
}

// A taskbar button pinned before the action flags existed carries no
// arguments; clicking it must still take the user straight to Harness —
// one click, the page, no menu in between. The panel lives on the tray.
// TestStartLatchIgnoresCheckingState is the regression test for the
// 2026-11-12 wedge: updating dsh put the launcher into stateChecking and
// then called Start, which used the state as its "already starting"
// mutex and returned immediately. dsh never came back, and because Open
// also skipped on stateChecking the app was dead until it was restarted
// by hand.
func TestStartLatchIgnoresCheckingState(t *testing.T) {
	// an update/restart flow has already parked the launcher in checking
	c := &controller{state: stateChecking}
	if got := c.beginStart(); got != startProceed {
		t.Fatalf("state=checking, no start in flight: decision = %v, want startProceed", got)
	}
	if !c.starting {
		t.Fatal("beginStart did not claim the latch")
	}

	// a real launch in flight still wins over a second caller
	if got := c.beginStart(); got != startInFlight {
		t.Fatalf("second call while starting: decision = %v, want startInFlight", got)
	}

	// once the launch finishes, Start is callable again
	c.starting = false
	if got := c.beginStart(); got != startProceed {
		t.Fatalf("after the launch finished: decision = %v, want startProceed", got)
	}
}

// A launcher that already serves dsh must not start a second one, and it
// must not claim the start latch while doing so.
//
// "Serving" requires a port: state==running alone is not enough, because
// the exit watcher clears the port before it flips the state. The restart
// guard is covered in state_machine_test.go.
func TestStartLatchShowsPageWhenUp(t *testing.T) {
	running := &controller{state: stateRunning, port: 3080}
	if got := running.beginStart(); got != startShowBrowser {
		t.Fatalf("state=running with a port: decision = %v, want startShowBrowser", got)
	}
	if running.starting {
		t.Error("state=running must not claim the latch")
	}
}

func TestStartupActionDefaultsToOpen(t *testing.T) {
	// a plain start records nothing; the second-instance fallback is what
	// makes an argument-less taskbar click open Harness
	startupAction = ""
	SetStartupAction(nil)
	if startupAction != "" {
		t.Errorf("no arguments: action = %q, want empty", startupAction)
	}
	if defaultSecondInstanceAction != "open" {
		t.Errorf("second-instance fallback = %q, want open", defaultSecondInstanceAction)
	}
	SetStartupAction([]string{"--open"})
	if startupAction != "open" {
		t.Errorf("--open: action = %q, want open", startupAction)
	}
	// the panel flag stays available for scripts; the tray clicks call it
	// directly
	SetStartupAction([]string{"--panel"})
	if startupAction != "panel" {
		t.Errorf("--panel: action = %q, want panel", startupAction)
	}
	// an unknown flag records nothing, so the fallback applies
	startupAction = ""
	SetStartupAction([]string{"--nonsense"})
	if startupAction != "" {
		t.Errorf("unknown flag: action = %q, want empty", startupAction)
	}
}

// Windows environment keys are case-insensitive; a map carrying both
// "Path" and "PATH" must collapse to one line, or the child's
// environment block keeps whichever line the random map order emitted
// last — the bug that made dsh.cmd lose node half the time. The
// implementation lives in nodeenv (both the launcher and the installer
// flatten through it); this test pins the launcher's own use of it.
func TestFlattenEnvDedupesCaseInsensitiveKeys(t *testing.T) {
	out := nodeenv.Environment(map[string]string{
		"Path":  `C:\old`,
		"PATH":  `C:\new`,
		"DHL_X": "1",
		"dhl_x": "2",
		"OTHER": "keep",
	})
	var pathLines, xLines, otherLines []string
	for _, line := range out {
		key := line[:strings.IndexByte(line, '=')]
		switch {
		case strings.EqualFold(key, "PATH"):
			pathLines = append(pathLines, line)
		case strings.EqualFold(key, "DHL_X"):
			xLines = append(xLines, line)
		case strings.EqualFold(key, "OTHER"):
			otherLines = append(otherLines, line)
		}
	}
	// Only ONE line per case-insensitive key may survive; which casing
	// wins is an implementation detail, but the value must be one of the
	// two candidates — never both, never a mangled mix.
	if len(pathLines) != 1 {
		t.Errorf("PATH lines = %v, want exactly one", pathLines)
	} else if !strings.HasSuffix(pathLines[0], `C:\new`) && !strings.HasSuffix(pathLines[0], `C:\old`) {
		t.Errorf("PATH value %q is neither candidate", pathLines[0])
	}
	if len(xLines) != 1 {
		t.Errorf("DHL_X lines = %v, want exactly one", xLines)
	} else if !strings.HasSuffix(xLines[0], "=1") && !strings.HasSuffix(xLines[0], "=2") {
		t.Errorf("DHL_X value %q is neither candidate", xLines[0])
	}
	if len(otherLines) != 1 {
		t.Errorf("unrelated key lost: %v", otherLines)
	}
}

// A dsh this launcher started must never fall back to the token URL saved
// by a previous process: dsh mints a new token on every boot, so the old
// one renders a 401 page and the user reads it as "dsh 打不开". The saved
// URL is only an adopted-instance credential.
func TestHarnessTargetURLNeverUsesStaleTokenForOwnLaunch(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	harnessweb.SaveLastURL("http://127.0.0.1:3080/?token=stale")

	// an adopted instance has no launcher and relies on the saved URL
	if got := harnessTargetURL(3080, nil); got != "http://127.0.0.1:3080/?token=stale" {
		t.Errorf("adopted target = %q, want the saved token URL", got)
	}

	// our own launcher before the entry line: bare port, NOT the stale token
	l := &launch.Launcher{}
	if got := harnessTargetURL(3080, l); got != "http://127.0.0.1:3080/" {
		t.Errorf("own launcher before entry line = %q, want the bare port URL", got)
	}
}

// No saved URL and an adopted instance still has to produce something
// loadable rather than an empty window URL.
func TestHarnessTargetURLAdoptedWithoutSavedURL(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	if got := harnessTargetURL(3081, nil); got != "http://127.0.0.1:3081/" {
		t.Errorf("adopted target = %q, want the bare port URL", got)
	}
}

// The notification switch must survive a round trip, and an older settings
// file (written before the switch existed) must read as ON: a launcher
// that silently stopped toasting would look broken.
func TestNotifyOnCompleteDefaultsOnAndPersists(t *testing.T) {
	// absent field = older file = default on
	var old settingsFile
	if err := unmarshalJSON([]byte(`{"updateIntervalHours":6}`), &old); err != nil {
		t.Fatalf("unmarshal legacy settings: %v", err)
	}
	if old.NotifyOnComplete != nil {
		t.Error("a legacy settings file must leave the switch unset (nil = default on)")
	}

	// an explicit off survives
	off := false
	saved := settingsFile{NotifyOnComplete: &off}
	data, err := marshalJSON(saved)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var restored settingsFile
	if err := unmarshalJSON(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if restored.NotifyOnComplete == nil {
		t.Fatal("an explicit off was lost; the launcher would start toasting again")
	}
	if *restored.NotifyOnComplete {
		t.Error("an explicit off came back on")
	}
}

// The icon-cache rebuild must happen exactly once per installed binary.
// Doing it on every start would cost a shell-wide cache rebuild each launch;
// never doing it leaves Start-menu search showing the previous build's art
// (the "5" burned into the icon long after badges stopped being written
// into shortcuts).
func TestClaimIconFlushOncePerBinary(t *testing.T) {
	c := &controller{}

	if !c.claimIconFlush(1000) {
		t.Fatal("the first start of a binary must rebuild the cache")
	}
	if c.claimIconFlush(1000) {
		t.Error("a second start of the same binary must not rebuild again")
	}
	if !c.claimIconFlush(2000) {
		t.Error("a new binary (new mtime) must rebuild")
	}
	if c.claimIconFlush(2000) {
		t.Error("the new binary rebuilt twice")
	}
	// a downgrade back to the old binary is still a new stamp
	if !c.claimIconFlush(1000) {
		t.Error("returning to a previous binary must rebuild")
	}
}

// The Wails app Name is the Windows toast AppID, not a display string.
// Wails passes cfg.Name to wintoast.SetAppData, which registers
// HKCU\Software\Classes\AppUserModelId\<Name>. When that differed from the
// process AUMID, Windows created a SECOND app identity: Start-menu search
// listed the launcher twice, and the auto-generated entry carried its own
// unread badge — the "5" that survived every icon-cache rebuild.
func TestAppNameIsTheAUMID(t *testing.T) {
	// the constant the shortcuts, the process and the toast must share
	if appUserModelID == "" {
		t.Fatal("appUserModelID must be set")
	}
	// a friendly display name here is the bug: it must look like an AUMID
	if strings.ContainsAny(appUserModelID, " ") {
		t.Errorf("appUserModelID %q contains spaces; it is a registry key and an "+
			"AppUserModelId, not a label", appUserModelID)
	}
}

// Every field saveSettings writes must survive the round trip, and every
// field restoreSessionUnread reads must be one of them. The two lists
// drifting apart is a silent bug: a setting the user changes reverts on the
// next launch with no error anywhere.
func TestSettingsFieldsRoundTripCompletely(t *testing.T) {
	on, off := true, false
	original := settingsFile{
		UpdateIntervalHours:    12,
		AutoCheckPluginUpdates: true,
		OpenBrowserOnReady:     true,
		SidebarDeck:            true,
		LaunchAtLogin:          true,
		GlobalHotKeyEnabled:    true,
		GlobalHotKey:           "Ctrl+Alt+D",
		DesktopShortcut:        true,
		NpmRegistry:            "https://registry.npmmirror.com",
		SkippedDSHVersion:      "0.2.3",
		SkippedLauncherVersion: "0.4.0",
		Theme:                  "dark",
		AutoUpdate:             true,
		AutoCheckUpdates:       &on,
		NotifyOnComplete:       &off,
	}
	data, err := marshalJSON(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var restored settingsFile
	if err := unmarshalJSON(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if restored.UpdateIntervalHours != original.UpdateIntervalHours {
		t.Errorf("UpdateIntervalHours = %v, want %v", restored.UpdateIntervalHours, original.UpdateIntervalHours)
	}
	if restored.AutoCheckPluginUpdates != original.AutoCheckPluginUpdates {
		t.Error("AutoCheckPluginUpdates lost")
	}
	if restored.OpenBrowserOnReady != original.OpenBrowserOnReady {
		t.Error("OpenBrowserOnReady lost")
	}
	if restored.SidebarDeck != original.SidebarDeck {
		t.Error("SidebarDeck lost")
	}
	if restored.LaunchAtLogin != original.LaunchAtLogin {
		t.Error("LaunchAtLogin lost")
	}
	if restored.GlobalHotKeyEnabled != original.GlobalHotKeyEnabled {
		t.Error("GlobalHotKeyEnabled lost")
	}
	if restored.GlobalHotKey != original.GlobalHotKey {
		t.Errorf("GlobalHotKey = %q, want %q", restored.GlobalHotKey, original.GlobalHotKey)
	}
	if restored.DesktopShortcut != original.DesktopShortcut {
		t.Error("DesktopShortcut lost")
	}
	if restored.NpmRegistry != original.NpmRegistry {
		t.Errorf("NpmRegistry = %q", restored.NpmRegistry)
	}
	if restored.SkippedDSHVersion != original.SkippedDSHVersion {
		t.Errorf("SkippedDSHVersion = %q", restored.SkippedDSHVersion)
	}
	if restored.SkippedLauncherVersion != original.SkippedLauncherVersion {
		t.Errorf("SkippedLauncherVersion = %q", restored.SkippedLauncherVersion)
	}
	if restored.Theme != original.Theme {
		t.Errorf("Theme = %q, want %q", restored.Theme, original.Theme)
	}
	if restored.AutoUpdate != original.AutoUpdate {
		t.Error("AutoUpdate lost")
	}
	if restored.AutoCheckUpdates == nil || !*restored.AutoCheckUpdates {
		t.Error("AutoCheckUpdates lost")
	}
	if restored.NotifyOnComplete == nil || *restored.NotifyOnComplete {
		t.Error("NotifyOnComplete lost")
	}
}

// harnessTargetURL with no port cannot produce a usable URL: port 0 is not
// a listening port, so "http://127.0.0.1:0/" would be a navigation to
// nowhere. Callers check the port, but the function must not hand back
// something that looks valid when it is not.
func TestHarnessTargetURLRejectsZeroPort(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())

	// an adopted instance with no saved URL and no port
	got := harnessTargetURL(0, nil)
	if strings.Contains(got, ":0/") {
		t.Errorf("harnessTargetURL(0, nil) = %q: port 0 is not a listening port", got)
	}
}
