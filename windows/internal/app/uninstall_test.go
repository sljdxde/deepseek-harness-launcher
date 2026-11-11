package app

// The uninstall's guard rules, pinned without touching a real link: the
// launcher may only remove profile links that point into its own plugin
// copies, never at a plugin the user installed from their own disk.

import "testing"

func TestIsOurPluginTarget(t *testing.T) {
	ours := []string{
		`C:\Users\u\AppData\Local\DHL\plugins\DSHArchiveManager`,
		`C:\Users\U\AppData\LOCAL\DHL\PLUGINS\DSHSessionNotify`,
		`C:\Users\u\AppData\Local/DHL\plugins\DSHPluginManager`,
	}
	for _, target := range ours {
		if !isOurPluginTarget(target) {
			t.Errorf("%q must be recognised as ours", target)
		}
	}
	// the user's own plugins live anywhere else on disk; the macOS
	// uninstall script's rule is the same: preserve them
	theirs := []string{
		`D:\003代码目录\dsh-workbuddy-plugin`,
		`C:\Users\u\projects\my-dsh-plugin`,
		`C:\Users\u\AppData\Local\SomeOtherApp\plugins\x`,
	}
	for _, target := range theirs {
		if isOurPluginTarget(target) {
			t.Errorf("%q must NOT be treated as ours", target)
		}
	}
}

// The runner flag is recognised without executing anything: parsing is
// pure, the cleanup itself only ever runs via HandleUninstallRunner (which
// no test may call — it deletes the real install).
func TestUninstallRunnerPidParsing(t *testing.T) {
	if _, claimed := uninstallRunnerPid([]string{"--panel"}); claimed {
		t.Error("--panel must not be claimed by the uninstall runner")
	}
	if _, claimed := uninstallRunnerPid([]string{"--open", "--settings"}); claimed {
		t.Error("ordinary flags must not be claimed by the uninstall runner")
	}
	pid, claimed := uninstallRunnerPid([]string{"--uninstall-run", "4242"})
	if !claimed {
		t.Error("--uninstall-run must be claimed")
	}
	if pid != 4242 {
		t.Errorf("pid = %d, want 4242", pid)
	}
	// malformed pid: still claimed — the runner phase has nothing else to
	// fall back to, and running the app from a temp copy would be worse
	if _, claimed := uninstallRunnerPid([]string{"--uninstall-run", "not-a-pid"}); !claimed {
		t.Error("malformed --uninstall-run must still be claimed")
	}
}
