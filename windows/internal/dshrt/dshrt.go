// Package dshrt keeps the dsh runtime healthy: where it lives, whether
// it is whole, how an interrupted replacement is recovered, and how a
// fresh install is staged and swapped in atomically. Ported from
// Sources/DSHRuntimeSupport.swift.
//
// Layout under ~/.dsh (DSH_HOME honored):
//
//	runtime/                     the fixed runtime, node_modules/.bin/dsh
//	runtime.installing-<pid>-<uuid>   a staging directory npm fills
//	runtime.previous-<uuid>      the runtime displaced by a swap
//	runtime.rollback             the old runtime kept after a
//	                             version-targeted update, for one-step rollback
//	runtime.broken-<uuid>        a half runtime moved aside during recovery
//	runtime.retired-<uuid>       the runtime removed by performRollback
package dshrt

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/paths"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/ver"
)

// NpmMaxOldSpaceSizeMB is the V8 old-space ceiling (MB) for the npm
// process during install. The lockfile `npm ci` path measures 190-220MB
// with a cold cache and 1.2-1.3GB on a warm cache (656 packages, npm
// reifies the whole tree in one burst); 1536 keeps a margin above the
// warm-cache peak while still hard-capping npm — a stray full-resolution
// install OOMs here on purpose, so the low-memory path can never silently
// regress. Keep in sync with the macOS sources and the CI memory gate.
const NpmMaxOldSpaceSizeMB = 1536

// The runtime specification embedded in the exe (Resources/dsh-runtime),
// synced by build.ps1. When present, the install runs `npm ci` against
// this lockfile so first-install memory stays low and the dependency set
// is reproducible. Tests override the vars below to exercise the path.
var (
	//go:embed assets/dsh-runtime/package.json
	bundledPackageJSON []byte
	//go:embed assets/dsh-runtime/package-lock.json
	bundledLockJSON []byte

	// BundledPackageOverride / BundledLockOverride replace the embedded
	// spec when non-nil (test hook; the Swift port had bundledRuntimeOverride).
	BundledPackageOverride []byte
	BundledLockOverride    []byte
)

// ErrCancelled is returned when an install was cancelled.
var ErrCancelled = errors.New("已取消 dsh 安装")

// DSHHome is the root of the DeepSeek Harness user data, honoring
// DSH_HOME the way the macOS launcher and dsh itself do.
func DSHHome() string { return paths.DSHHome() }

// RuntimeDir is the fixed runtime root.
func RuntimeDir() string { return filepath.Join(DSHHome(), "runtime") }

// ExecutablePath is the runtime's dsh entry, the npm .cmd shim on
// Windows (proc.Batch hands it to cmd.exe with a safe command line).
func ExecutablePath() string {
	return filepath.Join(RuntimeDir(), "node_modules", ".bin", "dsh.cmd")
}

// RollbackDir is the old runtime kept before a version-targeted update;
// the new version must prove it starts before this snapshot is dropped.
func RollbackDir() string { return filepath.Join(DSHHome(), "runtime.rollback") }

func hasDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// IsInstalled reports the full runtime: the dsh entry plus both marker
// packages of the dependency tree.
func IsInstalled() bool {
	return runtimeIsHealthy(RuntimeDir())
}

// CanAttemptLaunch is the minimal "worth trying" check: a dsh entry
// exists in the fixed runtime. Deliberately separate from IsInstalled —
// that draws the "should it be installed" line and must not be borrowed
// to decide "can it run", or a runnable-but-incomplete environment gets
// judged dead and forces an unnecessary reinstall.
func CanAttemptLaunch() bool {
	_, err := os.Stat(ExecutablePath())
	return err == nil
}

func runtimeIsHealthy(root string) bool {
	entry := filepath.Join(root, "node_modules", ".bin", "dsh.cmd")
	if _, err := os.Stat(entry); err != nil {
		// accept the extensionless shim too (some npm layouts)
		if _, err := os.Stat(filepath.Join(root, "node_modules", ".bin", "dsh")); err != nil {
			return false
		}
	}
	for _, marker := range []string{
		filepath.Join("@deepseek-ai", "cordis-plugin-group", "package.json"),
		filepath.Join("@deepseek-ai", "dsh-app-boot", "package.json"),
	} {
		if _, err := os.Stat(filepath.Join(root, "node_modules", marker)); err != nil {
			return false
		}
	}
	return true
}

// BundledDSHVersion reads the dsh version the embedded lockfile pins —
// the version a lockfile-based install yields.
func BundledDSHVersion() string {
	lock := bundledLockJSON
	if BundledLockOverride != nil {
		lock = BundledLockOverride
	}
	if lock == nil {
		return ""
	}
	var parsed struct {
		Packages map[string]struct {
			Version string `json:"version"`
		} `json:"packages"`
	}
	if err := json.Unmarshal(lock, &parsed); err != nil {
		return ""
	}
	entry, ok := parsed.Packages["node_modules/@deepseek-ai/dsh"]
	if !ok {
		return ""
	}
	return entry.Version
}

// HasBundledSpec reports whether an embedded runtime spec exists.
func HasBundledSpec() bool {
	pkg, lock := bundledPackageJSON, bundledLockJSON
	if BundledPackageOverride != nil {
		pkg = BundledPackageOverride
	}
	if BundledLockOverride != nil {
		lock = BundledLockOverride
	}
	return pkg != nil && lock != nil
}

// HasRollback reports whether a rollback snapshot is kept.
func HasRollback() bool { return hasDir(RollbackDir()) }

// DiscardRollback drops the rollback snapshot (the new version has
// proven itself).
func DiscardRollback() { _ = os.RemoveAll(RollbackDir()) }

// RollbackVersion reads the dsh version inside the rollback snapshot
// from its package.json; "" means unknown.
func RollbackVersion() string {
	manifest := filepath.Join(RollbackDir(), "node_modules", "@deepseek-ai", "dsh", "package.json")
	data, err := os.ReadFile(manifest)
	if err != nil {
		return ""
	}
	var parsed struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return ""
	}
	return parsed.Version
}

// PerformRollback swaps the rollback snapshot in as the live runtime
// (the failed new version is removed). On failure the previous state is
// restored and false comes back.
func PerformRollback() bool {
	if !HasRollback() || !IsInstalled() {
		return false
	}
	root := DSHHome()
	retired := filepath.Join(root, "runtime.retired-"+uuid())
	if err := os.Rename(RuntimeDir(), retired); err != nil {
		return false
	}
	if err := os.Rename(RollbackDir(), RuntimeDir()); err != nil {
		_ = os.Rename(retired, RuntimeDir())
		return false
	}
	_ = os.RemoveAll(retired)
	return true
}

// RuntimeSnapshotDir finds the newest complete-environment snapshot: the
// version-update rollback, or a runtime.previous-* left by an
// interrupted replacement. These are whole working runtimes, not garbage
// — when the live runtime is gone, the snapshot is the only one the user
// has.
func RuntimeSnapshotDir() string {
	var candidates []string
	if hasDir(RollbackDir()) {
		candidates = append(candidates, RollbackDir())
	}
	root := DSHHome()
	entries, err := os.ReadDir(root)
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			if strings.HasPrefix(e.Name(), "runtime.previous-") {
				candidates = append(candidates, filepath.Join(root, e.Name()))
			}
		}
	}
	if len(candidates) == 0 {
		return ""
	}
	sort.Slice(candidates, func(i, j int) bool {
		return modTime(candidates[i]).Before(modTime(candidates[j]))
	})
	return candidates[len(candidates)-1]
}

// HasRuntimeSnapshot reports whether recovery is possible.
func HasRuntimeSnapshot() bool { return RuntimeSnapshotDir() != "" }

// RestoreRuntimeSnapshot swaps the snapshot in as the live runtime. A
// complete runtime already in place means nothing to do (true). If the
// swap fails the scene is put back and false comes back.
func RestoreRuntimeSnapshot() bool {
	if IsInstalled() {
		return true
	}
	snapshot := RuntimeSnapshotDir()
	if snapshot == "" {
		return false
	}
	root := DSHHome()
	if !hasDir(RuntimeDir()) {
		return os.Rename(snapshot, RuntimeDir()) == nil
	}
	// a half runtime is in the way: move it aside, delete it only after
	// the snapshot has swapped in; failure puts it back
	broken := filepath.Join(root, "runtime.broken-"+uuid())
	if err := os.Rename(RuntimeDir(), broken); err != nil {
		return false
	}
	if err := os.Rename(snapshot, RuntimeDir()); err != nil {
		_ = os.Rename(broken, RuntimeDir())
		return false
	}
	_ = os.RemoveAll(broken)
	return true
}

// HasHarnessInstall reports whether DeepSeek Harness has been used on
// this machine before. A missing runtime does NOT mean a fresh first
// install: profiles, sessions, archives and plugins survive a runtime
// wipe, and an absent runtime with data present should be rebuilt in
// place, not onboarded from scratch.
func HasHarnessInstall() bool {
	profiles := filepath.Join(DSHHome(), "profiles")
	// ① any initialized profile (web/desktop with a package.json)
	for _, name := range []string{"web", "desktop"} {
		if _, err := os.Stat(filepath.Join(profiles, name, "package.json")); err == nil {
			return true
		}
	}
	// ② the harness dependency tree was installed: any core package
	// under the @deepseek-ai scope (a dangling symlink entry still counts)
	scoped := filepath.Join(profiles, "node_modules", "@deepseek-ai")
	names, err := os.ReadDir(scoped)
	if err != nil {
		return false
	}
	harness := map[string]bool{"dsh": true, "dsh-web-app": true, "dsh-app-boot": true, "dsh-base": true}
	for _, n := range names {
		if harness[n.Name()] {
			return true
		}
	}
	return false
}

// CleanupInterruptedInstalls removes leftovers that can no longer help:
// staging/broken/retired directories, and runtime.previous-* snapshots
// once the live runtime is whole again. runtime.rollback is always kept
// — rollback depends on it.
func CleanupInterruptedInstalls() {
	root := DSHHome()
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	installed := IsInstalled()
	for _, e := range entries {
		name := e.Name()
		stale := strings.HasPrefix(name, "runtime.installing-") ||
			strings.HasPrefix(name, "runtime.broken-") ||
			strings.HasPrefix(name, "runtime.retired-") ||
			(strings.HasPrefix(name, "runtime.previous-") && installed)
		if stale {
			_ = os.RemoveAll(filepath.Join(root, name))
		}
	}
}

// BundledUpgradeTarget returns (bundled, installed) when the embedded
// lockfile pins a NEWER dsh than the one installed — an app update
// shipped a newer runtime spec, and a lockfile `npm ci` would refresh
// it. Whether that happens is the user's call; this only reports the
// opportunity. An installed version NEWER than bundled yields nil
// (silently "updating" back would be a downgrade — the user probably
// updated dsh from the menu on purpose). npm semantics throughout: the
// cycle comparator would call two rc versions equal and never let a
// fix release through.
func BundledUpgradeTarget(installedVersion string) (bundled, installed string, ok bool) {
	if !IsInstalled() {
		return "", "", false
	}
	bundledVer := BundledDSHVersion()
	if bundledVer == "" || installedVersion == "" {
		return "", "", false
	}
	if ver.NpmCompare(bundledVer, installedVersion) != ver.Descending {
		return "", "", false
	}
	return bundledVer, installedVersion, true
}

func modTime(path string) time.Time {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}

// uuid is a random hex suffix for staging/backup directory names.
func uuid() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}
