package ver

import "testing"

// The ordering cases come verbatim from scripts/test-dsh-version-support.swift
// and scripts/test-update-support.swift, so the Go port is pinned to the
// same semantics the macOS launcher ships with.
func TestNpmCompare(t *testing.T) {
	cases := []struct {
		lhs, rhs string
		want     int
	}{
		{"0.1.7-alpha.2", "0.1.7-alpha.1", Descending},
		{"0.1.5-rc.3", "0.1.5-rc.2", Descending},
		{"0.1.7-alpha.1", "0.1.5-rc.2", Descending},
		{"0.1.5-rc.2", "0.1.5", Ascending}, // prerelease below its release
		{"0.1.5-rc.2", "0.1.5-beta.3", Descending},
		{"0.1.5-rc.2", "0.1.5-rc.2", Same},
		{"1.0.0", "1.0.0+build.7", Same}, // build metadata never compares
		{"0.2.0", "0.1.9", Descending},
		{"0.1.5-alpha.1", "0.1.5-alpha", Descending},
		{"dsh-v0.1.7-alpha.1", "0.1.7-alpha.1", Same},
	}
	for _, c := range cases {
		if got := NpmCompare(c.lhs, c.rhs); got != c.want {
			t.Errorf("NpmCompare(%q, %q) = %d, want %d", c.lhs, c.rhs, got, c.want)
		}
	}
}

func TestNormalizeNpm(t *testing.T) {
	cases := []struct{ in, want string }{
		{"dsh-v0.1.7-alpha.1", "0.1.7-alpha.1"},
		{"v0.1.5-rc.2", "0.1.5-rc.2"},
		{" 0.1.5-rc.2 ", "0.1.5-rc.2"},
		{"dsh-0.1.5", "0.1.5"},
		{"0.1.5", "0.1.5"},
		{"version", "version"},
	}
	for _, c := range cases {
		if got := NormalizeNpm(c.in); got != c.want {
			t.Errorf("NormalizeNpm(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestCycleCompare(t *testing.T) {
	cases := []struct {
		lhs, rhs string
		want     int
	}{
		// from scripts/test-update-support.swift
		{"0.1.1-rc.2", "0.1.1", Ascending},
		{"1.0.0", "1.0.0", Same},
		// the npm comparators cannot tell these apart; the cycle one must not
		// pretend it can either (they are both "not official")
		{"0.1.7-alpha.1", "0.1.7-alpha.2", Same},
		// release-cycle semantics: SNAPSHOT < submission < official
		{"0.3.11-1.1-SNAPSHOT", "0.3.11-1.1", Ascending},
		{"0.3.11-1.1", "0.3.11-1.2", Ascending},
		{"0.3.11-1.10", "0.3.11-1.9", Descending},
		{"0.3.11-1.1", "0.3.11", Ascending},
		{"0.3.11", "0.3.10", Descending},
		{"0.3.11-2.1", "0.3.11-1.3", Descending},
		// a dev build never gets "updated" onto an older official release
		{"0.3.11-1.1-SNAPSHOT", "0.3.10", Descending},
	}
	for _, c := range cases {
		if got := CycleCompare(c.lhs, c.rhs); got != c.want {
			t.Errorf("CycleCompare(%q, %q) = %d, want %d", c.lhs, c.rhs, got, c.want)
		}
	}
}

func TestNormalizeRelease(t *testing.T) {
	if NormalizeRelease("v0.3.10") != "0.3.10" || NormalizeRelease("V0.3.10") != "0.3.10" ||
		NormalizeRelease("0.3.10") != "0.3.10" {
		t.Fatal("NormalizeRelease must strip the tag v/V prefix only")
	}
}
