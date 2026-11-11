// Package planner decides what the launcher does about the dsh runtime at
// startup, ported from Sources/RuntimeLaunchPlanner.swift.
//
// One hard rule the whole package enforces: the launcher never installs or
// updates the runtime without the user saying yes. An available update
// only means "an update exists"; declining it must never mean "cannot
// run". Nothing here returns "install right away".
package planner

// BundledRuntimeUpgrade is a dsh update the app's own lockfile asks for —
// shown only when it is newer than what is installed.
type BundledRuntimeUpgrade struct {
	Bundled   string
	Installed string
}

// Action is what startup should do about the runtime.
type Action int

const (
	// LaunchInstalled starts with the runtime that is there.
	LaunchInstalled Action = iota
	// RecoverSnapshot swaps back the complete snapshot a previous
	// interrupted replacement left, then starts.
	RecoverSnapshot
	// OfferBundledUpgrade asks once before updating to the bundled
	// lockfile's dsh version; the user nods first.
	OfferBundledUpgrade
	// OfferRepair asks once about rebuilding when the runtime is gone
	// (no snapshot).
	OfferRepair
	// RebuildDeclined means the user already declined a rebuild this run;
	// leave a menu entry and stop asking.
	RebuildDeclined
	// FirstInstall guides through the first install (also user-gated).
	FirstInstall
)

// Input is what the planner looks at, gathered by the caller.
type Input struct {
	// RuntimeInstalled: the full dependency tree is present
	// (dshrt.IsInstalled).
	RuntimeInstalled bool
	// RuntimeRunnable: at least an executable dsh remains
	// (dshrt.CanAttemptLaunch).
	RuntimeRunnable bool
	// RecoverySnapshotAvailable: a complete runtime snapshot can be
	// swapped back.
	RecoverySnapshotAvailable bool
	// BundledUpgradeTarget: the bundled lockfile wants a newer dsh, nil
	// otherwise.
	BundledUpgradeTarget *BundledRuntimeUpgrade
	// HarnessInstallPresent: dsh was used on this machine before (a
	// profile or dependency tree exists) — a missing runtime is then not
	// a first install.
	HarnessInstallPresent bool
	// RebuildDeclinedThisRun: the user declined a rebuild this run.
	RebuildDeclinedThisRun bool
}

// Plan picks the startup action. Port of RuntimeLaunchPlanner.plan.
func Plan(in Input) Action {
	if in.RuntimeInstalled {
		if in.BundledUpgradeTarget != nil {
			return OfferBundledUpgrade
		}
		return LaunchInstalled
	}
	// The dependency tree is incomplete but a dsh executable remains:
	// whether this environment works is dsh's own call, not the
	// launcher's. IsInstalled draws the "should it be installed" line and
	// must not be borrowed for "can it run" — start it first, and fall
	// down the recovery ladder only when starting fails.
	if in.RuntimeRunnable {
		return LaunchInstalled
	}
	if in.RecoverySnapshotAvailable {
		return RecoverSnapshot
	}
	if in.RebuildDeclinedThisRun {
		return RebuildDeclined
	}
	if in.HarnessInstallPresent {
		return OfferRepair
	}
	return FirstInstall
}
