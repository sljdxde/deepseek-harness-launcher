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
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/session"
)

// taskbarBadgeText and badgeText must agree: the taskbar overlay and the
// tray tile show the same number, and a disagreement would look like a
// bug to the user. Both follow the macOS BadgeText rule.
func TestTaskbarBadgeText(t *testing.T) {
	cases := []struct {
		count int
		want  string
	}{
		{-5, ""}, // negative is treated as none
		{0, ""},  // none clears the overlay
		{1, "1"},
		{9, "9"},
		{10, "10"},
		{99, "99"},   // last exact number
		{100, "99+"}, // above 99 is capped
		{1000, "99+"},
	}
	for _, c := range cases {
		if got := taskbarBadgeText(c.count); got != c.want {
			t.Errorf("taskbarBadgeText(%d) = %q, want %q", c.count, got, c.want)
		}
	}
}

func TestTrayBadgeTextMatchesTaskbar(t *testing.T) {
	// the two badges are drawn by different code; they must never disagree
	for count := -2; count <= 250; count++ {
		if got, want := taskbarBadgeText(count), badgeText(count); got != want {
			t.Fatalf("badge mismatch at %d: taskbar %q, tray %q", count, got, want)
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

// A launcher that already serves dsh must not start a second one; the
// same is true while a user-initiated restart owns the transition.
func TestStartLatchShowsPageWhenUp(t *testing.T) {
	running := &controller{state: stateRunning}
	if got := running.beginStart(); got != startShowBrowser {
		t.Fatalf("state=running: decision = %v, want startShowBrowser", got)
	}
	if running.starting {
		t.Error("state=running must not claim the latch")
	}

	restarting := &controller{state: stateStopped, restarting: true}
	if got := restarting.beginStart(); got != startShowBrowser {
		t.Fatalf("restart in flight: decision = %v, want startShowBrowser", got)
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
// last — the bug that made dsh.cmd lose node half the time.
func TestFlattenEnvDedupesCaseInsensitiveKeys(t *testing.T) {
	out := flattenEnv(map[string]string{
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
