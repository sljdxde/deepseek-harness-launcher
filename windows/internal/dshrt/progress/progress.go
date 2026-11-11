// Package progress turns npm's line-oriented install output into a small
// user-facing status, ported from Sources/DSHInstallProgress.swift. The
// percentage is stage-weighted so the bar moves before npm reports a
// stable dependency total; once placeDep and ADD events arrive it
// switches to the observed ratio. The percentage always moves within
// 0...100 — the bar never sits at indeterminate for long stretches, and
// never goes backwards (a retried install resets it to its floor).
package progress

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"sync"
)

// Snapshot is one user-facing reading.
type Snapshot struct {
	Detail     string
	Percentage float64 // always 0...100
}

type phase int

const (
	phasePreparing phase = iota
	phaseResolving
	phaseDownloading
	phaseInstalling
	phaseValidating
)

func (p phase) title() string {
	switch p {
	case phasePreparing:
		return "准备 npm 安装"
	case phaseResolving:
		return "解析依赖"
	case phaseDownloading:
		return "下载依赖"
	case phaseInstalling:
		return "写入本地 runtime"
	default:
		return "校验安装"
	}
}

func (p phase) bounds() (float64, float64) {
	switch p {
	case phasePreparing:
		return 0, 3
	case phaseResolving:
		return 3, 15
	case phaseDownloading:
		return 15, 65
	case phaseInstalling:
		return 65, 95
	default:
		return 95, 100
	}
}

// Tracker consumes npm output chunk by chunk.
type Tracker struct {
	mu             sync.Mutex
	phase          phase
	downloadedTgz  int
	placeDepKeys   map[string]bool
	addKeys        map[string]bool
	completed      bool
	outputBuffer   string
	lastPercentage float64
}

// NewTracker starts a tracker at the preparing phase.
func NewTracker() *Tracker {
	return &Tracker{
		phase:        phasePreparing,
		placeDepKeys: map[string]bool{},
		addKeys:      map[string]bool{},
	}
}

// Consume folds a chunk of npm output in and returns where things stand.
func (t *Tracker) Consume(text string) Snapshot {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.outputBuffer += strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(t.outputBuffer, "\n")
	t.outputBuffer = lines[len(lines)-1]
	for _, line := range lines[:len(lines)-1] {
		t.consumeLine(line)
	}
	return t.snapshotLocked()
}

// Snapshot reads the current status.
func (t *Tracker) Snapshot() Snapshot {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.snapshotLocked()
}

func (t *Tracker) consumeLine(line string) {
	normalized := strings.ToLower(strings.TrimSpace(line))
	if normalized == "" {
		return
	}

	if strings.Contains(normalized, "尝试 npm registry：") || strings.Contains(normalized, "trying npm registry:") {
		t.resetForRetry()
		return
	}

	if countPackages(normalized) >= 0 && strings.Contains(normalized, " packages in ") {
		t.completed = true
		t.advanceTo(phaseValidating)
		return
	}

	if strings.Contains(normalized, "npm 安装完成") || strings.Contains(normalized, "install complete") ||
		strings.Contains(normalized, "up to date") || strings.Contains(normalized, " packages in ") {
		t.completed = true
		t.advanceTo(phaseValidating)
		return
	}

	if key, ok := packageKey(normalized, "placedep"); ok {
		t.placeDepKeys[key] = true
		t.advanceTo(phaseResolving)
	} else if strings.Contains(normalized, "reify") {
		t.advanceTo(phaseInstalling)
	} else if key, ok := packageKey(normalized, "add"); ok {
		t.addKeys[key] = true
		t.advanceTo(phaseInstalling)
	} else if strings.Contains(normalized, "npm info run") || strings.Contains(normalized, "extract") || strings.Contains(normalized, "link") {
		t.advanceTo(phaseInstalling)
	} else if strings.Contains(normalized, "http fetch") || strings.Contains(normalized, "fetch manifest") || strings.Contains(normalized, "fetch get") {
		t.advanceTo(phaseDownloading)
		// only real tarball downloads count toward the numerator (a URL
		// with .tgz): every package makes two requests (manifest +
		// tarball) and counting both would inflate the download progress
		success := strings.Contains(normalized, " 200 ") || strings.Contains(normalized, " 304 ") || strings.Contains(normalized, " cache hit")
		if success && strings.Contains(normalized, ".tgz") {
			t.downloadedTgz++
		}
	} else if strings.Contains(normalized, "idealtree") || strings.Contains(normalized, "ideal tree") || strings.Contains(normalized, "sill arborist") {
		t.advanceTo(phaseResolving)
	}
}

// packageKey pulls the package identifier out of an npm silly line like
// `sill placeDep ROOT @cordis/core@1.0.0 ok for: root`.
func packageKey(line, marker string) (string, bool) {
	i := strings.Index(line, " "+marker+" ")
	if i < 0 {
		return "", false
	}
	payload := line[i+1+len(marker)+1:]
	beforeStatus := payload
	if j := strings.Index(payload, " ok for:"); j >= 0 {
		beforeStatus = payload[:j]
	}
	fields := strings.FieldsFunc(beforeStatus, func(r rune) bool { return r == ' ' || r == '\t' })
	for _, f := range fields {
		if f == "root" {
			continue
		}
		if f != "" {
			return f, true
		}
	}
	return "", false
}

var packageCountPattern = regexp.MustCompile(`(?:added|removed|changed)\s+(\d+)\s+packages`)

func countPackages(line string) int {
	m := packageCountPattern.FindStringSubmatch(line)
	if m == nil {
		return -1
	}
	// the first numeric run in the match is the count
	digits := regexp.MustCompile(`\d+`).FindString(m[1])
	if digits == "" {
		return -1
	}
	n := 0
	for _, d := range digits {
		n = n*10 + int(d-'0')
	}
	return n
}

func (t *Tracker) resetForRetry() {
	t.phase = phasePreparing
	t.downloadedTgz = 0
	t.placeDepKeys = map[string]bool{}
	t.addKeys = map[string]bool{}
	t.completed = false
	t.lastPercentage = 0
}

func (t *Tracker) advanceTo(next phase) {
	if next >= t.phase {
		t.phase = next
	}
}

// phaseFraction is progress inside the phase: with a real denominator
// it is numerator/denominator; without one it crawls with the number of
// events seen so the bar keeps moving slowly instead of pinning at the
// phase floor.
func (t *Tracker) phaseFraction() float64 {
	switch t.phase {
	case phasePreparing:
		return 0
	case phaseResolving:
		// the total package count is unknown while resolving; each new
		// placeDep pushes the bar a little, linearly up to ~40 packages
		return math.Min(1.0, float64(len(t.placeDepKeys))/40.0)
	case phaseDownloading:
		total := maxInt(1, len(t.placeDepKeys))
		return math.Min(1.0, float64(t.downloadedTgz)/float64(total))
	case phaseInstalling:
		total := maxInt(1, len(t.placeDepKeys))
		return math.Min(1.0, float64(len(t.addKeys))/float64(total))
	default:
		if t.completed {
			return 1.0
		}
		return 0.6
	}
}

func (t *Tracker) snapshotLocked() Snapshot {
	var detail string
	switch {
	case t.phase == phaseDownloading && t.downloadedTgz > 0:
		detail = fmt.Sprintf("当前 npm 操作：%s；已下载 %d 个包", t.phase.title(), t.downloadedTgz)
	case t.phase == phaseInstalling && len(t.addKeys) > 0:
		total := len(t.placeDepKeys)
		if total == 0 {
			total = len(t.addKeys)
		}
		detail = fmt.Sprintf("当前 npm 操作：%s；已写入 %d/%d 个包", t.phase.title(), len(t.addKeys), total)
	default:
		detail = "当前 npm 操作：" + t.phase.title()
	}

	lower, upper := t.phase.bounds()
	rawPct := 100.0
	if !t.completed {
		rawPct = lower + t.phaseFraction()*(upper-lower)
	}
	// monotonic: a phase falling back (retry) has already cleared
	// lastPercentage; normal progress never goes backwards
	pct := math.Max(t.lastPercentage, math.Min(100, rawPct))
	t.lastPercentage = pct

	return Snapshot{
		Detail:     detail,
		Percentage: math.Round(pct*10) / 10,
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
