package progress

import "testing"

// Cases follow scripts/test-dsh-install-progress.swift so the Windows
// bar moves exactly as the macOS one does.
func TestStagesAndPercentage(t *testing.T) {
	// 1) initial state: preparing, 0..3 (never nil/indeterminate)
	tracker := NewTracker()
	initial := tracker.Snapshot()
	if initial.Percentage < 0 || initial.Percentage > 3.0 {
		t.Fatalf("initial pct %v outside preparing band", initial.Percentage)
	}

	// 2) resolving: placeDep events climb from 3% toward 15%
	tracker.Consume("npm sill idealTree buildDeps\n")
	tracker.Consume("npm silly placeDep ROOT @deepseek-ai/dsh@0.1.1 OK for:  want: 0.1.1\n" +
		"npm silly placeDep node_modules/a@1.0.0 OK for: @deepseek-ai/dsh@0.1.1 want: 1.0.0\n" +
		"npm silly placeDep node_modules/b@1.0.0 OK for: @deepseek-ai/dsh@0.1.1 want: 1.0.0\n")
	resolving := tracker.Snapshot()
	if resolving.Percentage <= initial.Percentage {
		t.Fatalf("resolving pct %v must climb above initial %v", resolving.Percentage, initial.Percentage)
	}

	// 3) downloading: only .tgz lines count toward the numerator; the
	//    manifest fetch must not (3 packages known, 1 tgz → 1/3 of 15..65)
	afterOneTgz := tracker.Consume(
		"npm http fetch GET 200 https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.1.tgz 120ms (cache miss)\n" +
			"npm http fetch GET 200 https://registry.npmjs.org/a 140ms (cache miss)\n")
	if afterOneTgz.Percentage < 30 || afterOneTgz.Percentage > 35 {
		t.Errorf("after one tgz pct = %v, want ~31.7", afterOneTgz.Percentage)
	}
	// all 3 tgz → downloading tops out near 65
	afterAllTgz := tracker.Consume(
		"npm http fetch GET 200 https://registry.npmjs.org/a/-/a-1.0.0.tgz 100ms\n" +
			"npm http fetch GET 200 https://registry.npmjs.org/b/-/b-1.0.0.tgz 100ms\n")
	if afterAllTgz.Percentage < 64 || afterAllTgz.Percentage > 66 {
		t.Errorf("after all tgz pct = %v, want ~65", afterAllTgz.Percentage)
	}

	// 4) installing: ADD events push 65% → 95% (1/3 adds → ~75)
	tracker.Consume("npm silly reify moves {}\n")
	add1 := tracker.Consume("npm silly ADD node_modules/@deepseek-ai/dsh\n")
	if add1.Percentage < 74 || add1.Percentage > 76 {
		t.Errorf("after 1/3 adds pct = %v, want ~75", add1.Percentage)
	}
	addAll := tracker.Consume("npm silly ADD node_modules/a\nnpm silly ADD node_modules/b\n")
	if addAll.Percentage < 94 || addAll.Percentage > 95.1 {
		t.Errorf("after all adds pct = %v, want ~95", addAll.Percentage)
	}

	// 5) completion: "added N packages" → 100%
	completed := tracker.Consume("added 3 packages in 3s\n")
	if completed.Percentage != 100.0 {
		t.Errorf("completed pct = %v, want 100", completed.Percentage)
	}
}

func TestMonotonic(t *testing.T) {
	tracker := NewTracker()
	prev := 0.0
	samples := []string{
		"npm sill idealTree buildDeps\n",
		"npm silly placeDep ROOT foo@1.0.0 OK for:  want: 1.0.0\n",
		"npm silly placeDep node_modules/bar@1.0.0 OK for: foo want: 1.0.0\n",
		"npm http fetch GET 200 https://registry.npmjs.org/foo/-/foo-1.0.0.tgz 100ms\n",
		"npm silly reify moves {}\n",
		"npm silly ADD node_modules/foo\n",
		"added 2 packages in 1s\n",
	}
	for _, s := range samples {
		got := tracker.Consume(s)
		if got.Percentage < prev {
			t.Fatalf("pct went backwards: %v < %v after %q", got.Percentage, prev, s)
		}
		prev = got.Percentage
	}
}

func TestRetryResets(t *testing.T) {
	tracker := NewTracker()
	tracker.Consume("npm silly placeDep ROOT x@1.0.0 OK for: want: 1.0.0\n")
	high := tracker.Snapshot()
	if high.Percentage <= 3 {
		t.Fatalf("setup: pct should have climbed, got %v", high.Percentage)
	}
	// the launcher announcing a registry retry must bring the bar back
	// to its floor instead of jumping to 100 via stale monotonic state
	retry := tracker.Consume("尝试 npm registry：https://registry.npmjs.org\n")
	if retry.Percentage > 3.1 {
		t.Errorf("after retry pct = %v, want back in the preparing band", retry.Percentage)
	}
}
