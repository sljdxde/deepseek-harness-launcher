package dshrt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/ver"
)

// isolate points DSH_HOME at a fresh temp dir for one test.
func isolate(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	return home
}

// makeRuntime fakes an installed runtime at dir: the .cmd entry plus the
// two marker packages IsInstalled requires.
func makeRuntime(t *testing.T, dir string) {
	t.Helper()
	entry := filepath.Join(dir, "node_modules", ".bin")
	if err := os.MkdirAll(entry, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(entry, "dsh.cmd"), []byte("@echo off\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{
		filepath.Join("@deepseek-ai", "cordis-plugin-group", "package.json"),
		filepath.Join("@deepseek-ai", "dsh-app-boot", "package.json"),
	} {
		p := filepath.Join(dir, "node_modules", marker)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestIsInstalledAndCanAttemptLaunch(t *testing.T) {
	home := isolate(t)
	if IsInstalled() {
		t.Fatal("an empty home must not read as installed")
	}
	if CanAttemptLaunch() {
		t.Fatal("an empty home has no dsh entry")
	}
	// a runnable-but-incomplete runtime: entry present, markers missing
	entry := filepath.Join(home, "runtime", "node_modules", ".bin")
	if err := os.MkdirAll(entry, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(entry, "dsh.cmd"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsInstalled() {
		t.Fatal("markers missing must not read as installed")
	}
	if !CanAttemptLaunch() {
		t.Fatal("an existing entry must be launchable even when incomplete")
	}
	// completing the markers flips IsInstalled
	makeRuntime(t, filepath.Join(home, "runtime"))
	if !IsInstalled() {
		t.Fatal("full runtime must read as installed")
	}
}

func TestSnapshotRecovery(t *testing.T) {
	home := isolate(t)
	snapshot := filepath.Join(home, "runtime.previous-abc")
	makeRuntime(t, snapshot)
	if !HasRuntimeSnapshot() {
		t.Fatal("a previous-* snapshot must be found")
	}
	if !RestoreRuntimeSnapshot() {
		t.Fatal("restore must succeed")
	}
	if !IsInstalled() {
		t.Fatal("after restore the runtime must read as installed")
	}
	if _, err := os.Stat(snapshot); !os.IsNotExist(err) {
		t.Fatal("the snapshot must have moved away")
	}
}

func TestSnapshotRecoveryMovesBrokenAside(t *testing.T) {
	home := isolate(t)
	// a half runtime blocks the way
	if err := os.MkdirAll(filepath.Join(home, "runtime", "junk"), 0o755); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(home, "runtime.previous-abc")
	makeRuntime(t, snapshot)
	if !RestoreRuntimeSnapshot() {
		t.Fatal("restore must succeed past a broken runtime")
	}
	if !IsInstalled() {
		t.Fatal("snapshot must be live now")
	}
	// no broken-* leftovers
	entries, _ := os.ReadDir(home)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "runtime.broken-") {
			t.Fatalf("broken runtime must be gone, found %s", e.Name())
		}
	}
}

func TestCleanupInterruptedInstalls(t *testing.T) {
	home := isolate(t)
	for _, name := range []string{"runtime.installing-1-x", "runtime.broken-1", "runtime.retired-1"} {
		if err := os.MkdirAll(filepath.Join(home, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(home, "runtime.previous-keepme"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, "runtime.rollback"), 0o755); err != nil {
		t.Fatal(err)
	}
	// runtime is missing: previous-* survives (it may be the only
	// working environment), everything stale goes, rollback is kept
	CleanupInterruptedInstalls()
	for _, gone := range []string{"runtime.installing-1-x", "runtime.broken-1", "runtime.retired-1"} {
		if _, err := os.Stat(filepath.Join(home, gone)); !os.IsNotExist(err) {
			t.Errorf("%s must be cleaned", gone)
		}
	}
	if _, err := os.Stat(filepath.Join(home, "runtime.previous-keepme")); err != nil {
		t.Error("previous-* must survive while no live runtime exists")
	}
	if _, err := os.Stat(filepath.Join(home, "runtime.rollback")); err != nil {
		t.Error("runtime.rollback must always survive cleanup")
	}
	// once the live runtime is whole, previous-* is only an old snapshot
	makeRuntime(t, filepath.Join(home, "runtime"))
	CleanupInterruptedInstalls()
	if _, err := os.Stat(filepath.Join(home, "runtime.previous-keepme")); !os.IsNotExist(err) {
		t.Error("previous-* must be cleaned once the live runtime is whole")
	}
	if _, err := os.Stat(filepath.Join(home, "runtime.rollback")); err != nil {
		t.Error("runtime.rollback must still survive cleanup")
	}
}

func TestRollbackFlow(t *testing.T) {
	home := isolate(t)
	makeRuntime(t, filepath.Join(home, "runtime"))
	old := filepath.Join(home, "runtime.rollback")
	if err := os.Rename(filepath.Join(home, "runtime"), old); err != nil {
		t.Fatal(err)
	}
	makeRuntime(t, filepath.Join(home, "runtime")) // the "new version"
	if !HasRollback() {
		t.Fatal("rollback must be present")
	}
	if !PerformRollback() {
		t.Fatal("rollback must succeed")
	}
	if !IsInstalled() {
		t.Fatal("after rollback a runtime must be live")
	}
	if HasRollback() {
		t.Fatal("rollback snapshot must be consumed")
	}
}

func TestBundledDSHVersion(t *testing.T) {
	// the lockfile in the repo is the source of truth; this pins that the
	// embedded copy carries a real version rather than a stale one
	got := BundledDSHVersion()
	if got == "" {
		t.Fatal("the embedded lockfile must pin a dsh version")
	}
	if ver.NpmCompare(got, "0.1.5") != ver.Descending {
		t.Errorf("embedded lockfile pins %q, older than the 0.2 line", got)
	}
	if !HasBundledSpec() {
		t.Fatal("the embedded spec must be present in production builds")
	}
}

func TestBundledUpgradeTarget(t *testing.T) {
	home := isolate(t)
	if _, _, ok := BundledUpgradeTarget(""); ok {
		t.Fatal("no runtime means no upgrade target")
	}
	makeRuntime(t, filepath.Join(home, "runtime"))
	pinned := BundledDSHVersion()
	// an older installed version gets the bundled one offered
	bundled, installed, ok := BundledUpgradeTarget("0.1.1-rc.1")
	if !ok || bundled != pinned || installed != "0.1.1-rc.1" {
		t.Errorf("upgrade target = %q/%q %v (pinned %q)", bundled, installed, ok, pinned)
	}
	// installed equal or newer → no downgrade disguised as an update
	if _, _, ok := BundledUpgradeTarget(pinned); ok {
		t.Error("equal version must not offer an upgrade")
	}
	if _, _, ok := BundledUpgradeTarget("99.0.0"); ok {
		t.Error("a newer installed version must not be downgraded")
	}
}

func TestHarnessInstallDetection(t *testing.T) {
	home := isolate(t)
	if HasHarnessInstall() {
		t.Fatal("an empty home was never used")
	}
	// ① an initialized web profile
	profile := filepath.Join(home, "profiles", "web")
	if err := os.MkdirAll(profile, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(profile, "package.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if !HasHarnessInstall() {
		t.Fatal("an initialized profile means the harness was used")
	}

	// ② only the scoped dependency tree (the common shape: dsh installed
	// its profile modules but no profile-level package.json)
	home2 := isolate(t)
	scoped := filepath.Join(home2, "profiles", "node_modules", "@deepseek-ai", "dsh")
	if err := os.MkdirAll(scoped, 0o755); err != nil {
		t.Fatal(err)
	}
	if !HasHarnessInstall() {
		t.Fatal("the harness dependency tree means the harness was used")
	}

	// ③ unrelated scoped packages do not count
	home3 := isolate(t)
	other := filepath.Join(home3, "profiles", "node_modules", "@deepseek-ai", "something-else")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	if HasHarnessInstall() {
		t.Fatal("unrelated packages must not read as harness usage")
	}
}
