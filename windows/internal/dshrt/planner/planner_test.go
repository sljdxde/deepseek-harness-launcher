package planner

import "testing"

// Cases come verbatim from scripts/test-runtime-launch-plan.swift: every
// branch must hold the rule that nothing installs without the user's nod.
func TestPlan(t *testing.T) {
	upgrade := &BundledRuntimeUpgrade{Bundled: "0.1.5-rc.4", Installed: "0.1.5-rc.2"}

	plan := func(mods ...func(*Input)) Action {
		in := Input{}
		for _, m := range mods {
			m(&in)
		}
		return Plan(in)
	}
	installed := func(in *Input) { in.RuntimeInstalled = true }
	runnable := func(in *Input) { in.RuntimeRunnable = true }
	snapshot := func(in *Input) { in.RecoverySnapshotAvailable = true }
	harness := func(in *Input) { in.HarnessInstallPresent = true }
	declined := func(in *Input) { in.RebuildDeclinedThisRun = true }
	upgraded := func(in *Input) { in.BundledUpgradeTarget = upgrade }

	cases := []struct {
		name string
		mods []func(*Input)
		want Action
	}{
		// ① full runtime, no upgrade target → start
		{"installed-starts", []func(*Input){installed}, LaunchInstalled},
		// ② full runtime + bundled upgrade → ask only; never "install now"
		{"installed-offers-upgrade", []func(*Input){installed, upgraded}, OfferBundledUpgrade},
		// ③ snapshot beats declined and first-install
		{"snapshot-recovers", []func(*Input){snapshot}, RecoverSnapshot},
		{"snapshot-beats-declined", []func(*Input){snapshot, declined}, RecoverSnapshot},
		{"snapshot-beats-no-harness", []func(*Input){snapshot}, RecoverSnapshot},
		// ④ used before, nothing left → offer repair
		{"harness-offers-repair", []func(*Input){harness}, OfferRepair},
		// ⑤ declined this run → menu entry only
		{"declined-quiets", []func(*Input){harness, declined}, RebuildDeclined},
		// ⑥ never used → first-install guidance (user-gated)
		{"fresh-first-install", []func(*Input){}, FirstInstall},
		// ⑦ runnable-but-incomplete still starts, even against upgrades
		{"runnable-starts", []func(*Input){runnable}, LaunchInstalled},
		{"runnable-with-harness-starts", []func(*Input){runnable, harness}, LaunchInstalled},
		{"runnable-defers-upgrade", []func(*Input){runnable, upgraded}, LaunchInstalled},
		{"runnable-defers-snapshot", []func(*Input){runnable, snapshot}, LaunchInstalled},
		// ⑧ a full runtime beats a snapshot
		{"installed-beats-snapshot", []func(*Input){installed, snapshot}, LaunchInstalled},
	}
	for _, c := range cases {
		if got := plan(c.mods...); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
