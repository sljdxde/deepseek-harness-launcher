// Package ver carries the two version comparators the launcher lives by,
// ported from Sources/NpmVersionSupport.swift and UpdateSupport.swift.
//
// They are NOT interchangeable, and mixing them is how update prompts go
// wrong:
//
//   - NpmCompare: standard npm/semver semantics for dsh and plugin
//     versions (0.1.7-alpha.1 < 0.1.7-alpha.2, prerelease below release).
//   - CycleCompare: this repo's own x.y.z-a.b[-SNAPSHOT] release-cycle
//     numbering, where a prerelease-looking suffix only means "not the
//     official release" — rc.1 and rc.6 compare EQUAL under it.
package ver

import (
	"math/big"
	"strconv"
	"strings"
)

// Comparison results, matching Swift's ComparisonResult.
const (
	Ascending  = -1
	Same       = 0
	Descending = 1
)

// NormalizeNpm trims a raw dsh version into npm form: "dsh-v0.1.7-alpha.1"
// and "dsh-0.1.7" lose their prefixes, a lone "v" before a digit goes,
// whitespace goes. Port of normalizedDSHVersion.
func NormalizeNpm(raw string) string {
	value := strings.TrimSpace(raw)
	for _, prefix := range []string{"dsh-v", "dsh-"} {
		if strings.HasPrefix(value, prefix) {
			return value[len(prefix):]
		}
	}
	if strings.HasPrefix(value, "v") && len(value) > 1 && isDigit(value[1]) {
		return value[1:]
	}
	return value
}

type npmIdentifier struct {
	// number is set when the identifier is numeric.
	number   *big.Int
	isNumber bool
	text     string
}

type parsedNpmVersion struct {
	base       []uint64
	prerelease []npmIdentifier
	hasPre     bool
}

// parseNpmVersion reads an npm/semver version. Build metadata (+build)
// never takes part in the comparison.
func parseNpmVersion(raw string) parsedNpmVersion {
	value := NormalizeNpm(raw)
	if i := strings.IndexByte(value, '+'); i >= 0 {
		value = value[:i]
	}
	parts := strings.SplitN(value, "-", 2)
	base := parseDotNumbers(parts[0])
	if len(base) == 0 {
		base = []uint64{0}
	}
	parsed := parsedNpmVersion{base: base}
	if len(parts) > 1 {
		for _, token := range strings.Split(parts[1], ".") {
			if n, err := strconv.ParseUint(token, 10, 64); err == nil {
				parsed.prerelease = append(parsed.prerelease, npmIdentifier{isNumber: true, number: big.NewInt(0).SetUint64(n)})
				continue
			}
			// Swift's Int is strict about digits; "+3"/"-2" still parse.
			if n, ok := new(big.Int).SetString(token, 10); ok {
				parsed.prerelease = append(parsed.prerelease, npmIdentifier{isNumber: true, number: n})
				continue
			}
			parsed.prerelease = append(parsed.prerelease, npmIdentifier{text: strings.ToLower(token)})
		}
		parsed.hasPre = len(parsed.prerelease) > 0
	}
	return parsed
}

// NpmCompare compares two dsh/npm versions: base numerically, then
// prerelease identifiers — numeric by value, numeric below alphanumeric,
// alphanumeric lexicographically (lowercased); more identifiers win when
// one is a prefix of the other; a prerelease sits below its own release.
// Port of compareDSHVersions.
func NpmCompare(lhs, rhs string) int {
	left := parseNpmVersion(lhs)
	right := parseNpmVersion(rhs)

	for i := 0; i < len(left.base) || i < len(right.base); i++ {
		l := uint64(0)
		if i < len(left.base) {
			l = left.base[i]
		}
		r := uint64(0)
		if i < len(right.base) {
			r = right.base[i]
		}
		if l < r {
			return Ascending
		}
		if l > r {
			return Descending
		}
	}

	switch {
	case !left.hasPre && !right.hasPre:
		return Same
	case !left.hasPre:
		return Descending
	case !right.hasPre:
		return Ascending
	}
	for i := 0; i < len(left.prerelease) || i < len(right.prerelease); i++ {
		if i >= len(left.prerelease) {
			return Ascending
		}
		if i >= len(right.prerelease) {
			return Descending
		}
		l, r := left.prerelease[i], right.prerelease[i]
		if l.isNumber && r.isNumber {
			switch l.number.Cmp(r.number) {
			case -1:
				return Ascending
			case 1:
				return Descending
			}
			continue
		}
		if l.isNumber {
			return Ascending
		}
		if r.isNumber {
			return Descending
		}
		if l.text != r.text {
			if l.text < r.text {
				return Ascending
			}
			return Descending
		}
	}
	return Same
}

// --- release-cycle versions (UpdateSupport.swift) --------------------------

type parsedCycleVersion struct {
	base       []uint64
	testSuffix []uint64
	hasSuffix  bool
	isSnapshot bool
}

// parseCycle reads x.y.z-a.b[-SNAPSHOT]. The first all-numeric token is
// the base; "SNAPSHOT" or any token with a non-numeric part marks a
// non-official build; a fully numeric later token is the test cycle.
func parseCycle(value string) parsedCycleVersion {
	parsed := parsedCycleVersion{}
	for _, token := range strings.Split(value, "-") {
		components := strings.Split(token, ".")
		nums := make([]uint64, 0, len(components))
		allNumeric := true
		for _, c := range components {
			n, err := strconv.ParseUint(c, 10, 64)
			if err != nil {
				allNumeric = false
				break
			}
			nums = append(nums, n)
		}
		if len(parsed.base) == 0 && allNumeric {
			parsed.base = nums
			continue
		}
		if token == "SNAPSHOT" || !allNumeric {
			// Any textual suffix (SNAPSHOT / rc.2 / beta) ranks before the
			// official release of the same base.
			parsed.isSnapshot = true
			continue
		}
		parsed.testSuffix = nums
		parsed.hasSuffix = true
	}
	return parsed
}

// CycleCompare ranks release-cycle versions: the base x.y.z dominates the
// suffix; test suffixes compare component by component; SNAPSHOT and any
// textual suffix sit below their submission, which sits below the official
// release. Port of compareVersions (UpdateSupport.swift).
func CycleCompare(lhs, rhs string) int {
	left := parseCycle(lhs)
	right := parseCycle(rhs)

	for i := 0; i < len(left.base) || i < len(right.base); i++ {
		l := uint64(0)
		if i < len(left.base) {
			l = left.base[i]
		}
		r := uint64(0)
		if i < len(right.base) {
			r = right.base[i]
		}
		if l < r {
			return Ascending
		}
		if l > r {
			return Descending
		}
	}

	if !left.hasSuffix && right.hasSuffix {
		return Descending
	}
	if left.hasSuffix && !right.hasSuffix {
		return Ascending
	}
	if left.hasSuffix && right.hasSuffix {
		for i := 0; i < len(left.testSuffix) || i < len(right.testSuffix); i++ {
			a := uint64(0)
			if i < len(left.testSuffix) {
				a = left.testSuffix[i]
			}
			b := uint64(0)
			if i < len(right.testSuffix) {
				b = right.testSuffix[i]
			}
			if a < b {
				return Ascending
			}
			if a > b {
				return Descending
			}
		}
	}
	// Same suffix shape and officialness: only the SNAPSHOT mark differs
	// (the bare x.y.z-SNAPSHOT fallback).
	if left.isSnapshot != right.isSnapshot {
		if left.isSnapshot {
			return Ascending
		}
		return Descending
	}
	return Same
}

// NormalizeRelease strips the "v"/"V" tag prefix, so v0.3.10 and 0.3.10
// stay one version (compareVersions only reads digits).
func NormalizeRelease(version string) string {
	if strings.HasPrefix(version, "v") || strings.HasPrefix(version, "V") {
		return version[1:]
	}
	return version
}

func parseDotNumbers(value string) []uint64 {
	parts := strings.Split(value, ".")
	out := make([]uint64, 0, len(parts))
	any := false
	for _, p := range parts {
		n, err := strconv.ParseUint(p, 10, 64)
		if err != nil {
			out = append(out, 0) // unparsable numeric components fall back to 0
			continue
		}
		out = append(out, n)
		any = true
	}
	if !any {
		return nil
	}
	return out
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }
