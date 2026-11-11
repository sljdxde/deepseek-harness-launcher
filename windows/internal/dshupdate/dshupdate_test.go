package dshupdate

import (
	"strings"
	"testing"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/ver"
)

// Cases come verbatim from scripts/test-dsh-version-support.swift.

func TestVersionFromOutput(t *testing.T) {
	if VersionFromOutput("0.1.1-rc.2\n") != "0.1.1-rc.2" {
		t.Error("version line must be read")
	}
	if VersionFromOutput("1.2.3") != "1.2.3" {
		t.Error("bare version must be read")
	}
	if VersionFromOutput("no version here") != "" {
		t.Error("prose must yield no version")
	}
}

func TestDetectChannel(t *testing.T) {
	cases := []struct {
		version string
		want    Channel
		label   string
		pre     bool
	}{
		{"0.1.5-rc.2", ChannelReleaseCandidate, "候选版", true},
		{"0.1.7-alpha.1", ChannelAlpha, "内测版", true},
		{"0.2.0-beta.1", ChannelBeta, "公测版", true},
		{"0.2.0", ChannelStable, "正式版", false},
		{"dsh-v0.1.7-alpha.1", ChannelAlpha, "内测版", true},
	}
	for _, c := range cases {
		ch, _ := DetectChannel(c.version)
		if ch != c.want {
			t.Errorf("DetectChannel(%q) = %v, want %v", c.version, ch, c.want)
		}
		if ch.Label() != c.label {
			t.Errorf("label(%q) = %q, want %q", c.version, ch.Label(), c.label)
		}
		if ch.IsPrerelease() != c.pre {
			t.Errorf("IsPrerelease(%q) = %v, want %v", c.version, ch.IsPrerelease(), c.pre)
		}
	}
}

func TestDecodeNpmMetadata(t *testing.T) {
	combined := []byte(`{"dist-tags":{"latest":"0.1.5-rc.2","next":"0.1.5-rc.3","alpha":"0.1.7-alpha.1"},"versions":["0.1.5-rc.2","0.1.5-rc.3"]}`)
	m := DecodeNpmMetadata(combined)
	if m == nil {
		t.Fatal("combined npm metadata must decode")
	}
	if m.DistTags["alpha"] != "0.1.7-alpha.1" {
		t.Errorf("alpha tag = %q", m.DistTags["alpha"])
	}
	if !m.Contains("0.1.5-rc.2") {
		t.Error("installed version must be found")
	}
	if m.Contains("0.1.7-alpha.1") {
		t.Error("a tag without a tarball must not count as published (mirror lag)")
	}
	summary := m.Summary()
	if !strings.Contains(summary, "latest 0.1.5-rc.2") || !strings.Contains(summary, "alpha 0.1.7-alpha.1") {
		t.Errorf("summary = %q", summary)
	}

	single := DecodeNpmMetadata([]byte(`"0.1.5-rc.2"`))
	if single == nil || single.DistTags["latest"] != "0.1.5-rc.2" {
		t.Error("bare-string fallback must decode as latest")
	}
	if DecodeNpmMetadata([]byte("not json")) != nil {
		t.Error("prose must not decode")
	}
}

func TestParseReleaseFeed(t *testing.T) {
	feed := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>v0.1.7-alpha.1</title>
    <link rel="alternate" href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.1"/>
    <updated>2026-09-22T06:16:27Z</updated>
    <content type="html">&lt;h2&gt;Highlights&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Faster starts&lt;/li&gt;&lt;li&gt;&lt;code&gt;dsh web&lt;/code&gt; flag&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;See &lt;a href="https://example.test/notes"&gt;notes&lt;/a&gt;&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>v0.1.6-alpha.2</title>
    <link rel="alternate" href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.2"/>
    <updated>2026-09-17T13:30:16Z</updated>
    <content type="html"></content>
  </entry>
</feed>`)
	entries := ParseReleaseFeed(feed)
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	first := entries[0]
	if first.Version != "0.1.7-alpha.1" || first.Tag != "dsh-v0.1.7-alpha.1" {
		t.Errorf("first entry version/tag = %q/%q", first.Version, first.Tag)
	}
	if first.PublishedAt == nil {
		t.Error("published date must parse")
	}
	if !strings.HasSuffix(first.HTMLURL, "/releases/tag/dsh-v0.1.7-alpha.1") {
		t.Errorf("htmlURL = %q", first.HTMLURL)
	}
	notes := first.Notes
	for _, want := range []string{"### Highlights", "- Faster starts", "`dsh web`", "[notes](https://example.test/notes)"} {
		if !strings.Contains(notes, want) {
			t.Errorf("notes %q missing %q", notes, want)
		}
	}
	if entries[1].Version != "0.1.6-alpha.2" || entries[1].Notes != "" {
		t.Errorf("second entry = %+v", entries[1])
	}

	if got := PlainTextFromHTML("a &amp; b <div>c</div>"); got != "a & b c" {
		t.Errorf("PlainTextFromHTML = %q", got)
	}
	if got := ParseReleaseFeed([]byte("<feed></feed>")); len(got) != 0 {
		t.Errorf("empty feed must parse to nothing, got %v", got)
	}
}

func TestMarkdownFromHTMLEntities(t *testing.T) {
	if got := MarkdownFromHTML("&lt;div&gt;noise&lt;/div&gt;"); strings.Contains(got, "&lt;") {
		t.Errorf("entities must be decoded, got %q", got)
	}
}

func mkNpm(tags map[string]string, versions []string) *NpmMetadata {
	return &NpmMetadata{DistTags: tags, Versions: versions}
}

func rel(version, tag, notes string) ReleaseEntry {
	return ReleaseEntry{Version: version, Tag: tag, Notes: notes}
}

func TestPlanReport(t *testing.T) {
	npm := mkNpm(
		map[string]string{"latest": "0.1.5-rc.2", "next": "0.1.5-rc.3", "alpha": "0.1.7-alpha.1"},
		[]string{"0.1.5-rc.2", "0.1.5-rc.3", "0.1.7-alpha.1"},
	)
	releases := []ReleaseEntry{
		rel("0.1.7-alpha.1", "dsh-v0.1.7-alpha.1", "### New"),
		rel("0.1.5-rc.2", "dsh-v0.1.5-rc.2", ""),
	}
	// real-world shape: npm latest sits at the installed version while
	// GitHub already published the alpha
	report := PlanReport("0.1.5-rc.2", npm, releases, "", "")
	if report.Best.Version != "0.1.7-alpha.1" || report.Best.Channel != ChannelAlpha {
		t.Errorf("best = %+v", report.Best)
	}
	if report.Best.Source.Kind != "githubRelease" || report.Best.Notes != "### New" {
		t.Errorf("same-version github release must win with notes, got %+v", report.Best)
	}
	if !report.IsUpdate() {
		t.Error("this is an update")
	}
	if report.NewestStable != nil {
		t.Errorf("newestStable = %+v, want none", report.NewestStable)
	}
	if !contains(report.Messages, "GitHub Release 最新") || !contains(report.Messages, "npm dist-tags") {
		t.Errorf("messages = %v", report.Messages)
	}
	if len(report.Warnings) != 0 {
		t.Errorf("warnings = %v", report.Warnings)
	}
	// deduplicated candidates: alpha (github), rc.3 (next tag), rc.2 (latest)
	if len(report.Candidates) != 3 ||
		report.Candidates[0].Version != "0.1.7-alpha.1" ||
		report.Candidates[1].Version != "0.1.5-rc.3" ||
		report.Candidates[2].Version != "0.1.5-rc.2" {
		t.Errorf("candidates = %v", report.Candidates)
	}

	// up to date
	current := PlanReport("0.1.7-alpha.1",
		mkNpm(map[string]string{"latest": "0.1.7-alpha.1"}, []string{"0.1.7-alpha.1"}),
		[]ReleaseEntry{rel("0.1.7-alpha.1", "dsh-v0.1.7-alpha.1", "")}, "", "")
	if current.IsUpdate() || report.Best.Version == "" {
		t.Errorf("current report: isUpdate=%v", current.IsUpdate())
	}
	if current.Best.Version != "0.1.7-alpha.1" {
		t.Errorf("current best = %q", current.Best.Version)
	}

	// installed newer than everything published: not an update
	ahead := PlanReport("0.1.8-alpha.1",
		mkNpm(map[string]string{"latest": "0.1.5-rc.2"}, []string{"0.1.5-rc.2"}), nil, "", "")
	if ahead.IsUpdate() {
		t.Error("being ahead must not read as an update")
	}
	if ahead.Best.Version != "0.1.5-rc.2" {
		t.Errorf("ahead best = %q", ahead.Best.Version)
	}

	// a GitHub tag npm has never seen must be dropped with a reason
	unpublished := PlanReport("0.1.5-rc.2",
		mkNpm(map[string]string{"latest": "0.1.5-rc.2"}, []string{"0.1.5-rc.2"}),
		[]ReleaseEntry{rel("0.1.7-alpha.1", "dsh-v0.1.7-alpha.1", "")}, "", "")
	if unpublished.Best.Version != "0.1.5-rc.2" || unpublished.IsUpdate() {
		t.Errorf("unpublished = best %q update %v", unpublished.Best.Version, unpublished.IsUpdate())
	}
	if !contains(unpublished.Warnings, "0.1.7-alpha.1") {
		t.Errorf("warnings = %v", unpublished.Warnings)
	}

	// GitHub down, npm alive: the next tag still surfaces
	feedDown := PlanReport("0.1.5-rc.2", npm, nil, "", "Release feed HTTP 500")
	if feedDown.Best.Version != "0.1.7-alpha.1" {
		t.Errorf("feedDown best = %q", feedDown.Best.Version)
	}
	if !contains(feedDown.Warnings, "GitHub Release") {
		t.Errorf("feedDown warnings = %v", feedDown.Warnings)
	}

	// both sources dead: no lying "up to date"
	empty := PlanReport("0.1.5-rc.2", nil, nil, "npm view 无输出", "")
	if len(empty.Candidates) != 0 || empty.IsUpdate() || len(empty.Warnings) == 0 {
		t.Errorf("empty report = %+v", empty)
	}

	// stable + prerelease coexisting: announce newest, name the stable one
	mixed := PlanReport("0.1.4",
		mkNpm(map[string]string{"latest": "0.1.5", "alpha": "0.1.7-alpha.1"}, []string{"0.1.5", "0.1.7-alpha.1"}),
		nil, "", "")
	if mixed.Best.Version != "0.1.7-alpha.1" {
		t.Errorf("mixed best = %q", mixed.Best.Version)
	}
	if mixed.NewestStable == nil || mixed.NewestStable.Version != "0.1.5" {
		t.Errorf("mixed newestStable = %+v", mixed.NewestStable)
	}
}

func TestSkipPolicy(t *testing.T) {
	report := PlanReport("0.1.5-rc.2",
		mkNpm(map[string]string{"alpha": "0.1.7-alpha.1"}, []string{"0.1.7-alpha.1"}),
		nil, "", "")
	if !report.IsUpdate() {
		t.Fatal("report must be an update")
	}
	if got := BestAnnounceable(report, ""); got == nil || got.Version != "0.1.7-alpha.1" {
		t.Errorf("announceable = %+v", got)
	}
	if got := BestAnnounceable(report, "0.1.7-alpha.1"); got != nil {
		t.Errorf("fully skipped must announce nothing, got %+v", got)
	}
	// a GitHub tag and an npm version spell the same version
	if !IsSkipped("0.1.7-alpha.1", "dsh-v0.1.7-alpha.1") {
		t.Error("tag and version forms must match")
	}
	if IsSkipped("0.1.7-alpha.2", "0.1.7-alpha.1") {
		t.Error("a different prerelease must not match")
	}
	current := PlanReport("0.1.5-rc.2",
		mkNpm(map[string]string{"latest": "0.1.5-rc.2"}, []string{"0.1.5-rc.2"}), nil, "", "")
	if BestAnnounceable(current, "") != nil {
		t.Error("no update means nothing announceable")
	}
}

func TestBestAnnounceableWithMultiple(t *testing.T) {
	multi := PlanReport("0.1.5-rc.2",
		mkNpm(
			map[string]string{"alpha": "0.1.7-alpha.1", "next": "0.1.5-rc.3"},
			[]string{"0.1.5-rc.2", "0.1.5-rc.3", "0.1.7-alpha.1"},
		),
		[]ReleaseEntry{rel("0.1.7-alpha.1", "dsh-v0.1.7-alpha.1", "")}, "", "")
	if len(multi.Candidates) != 2 ||
		multi.Candidates[0].Version != "0.1.7-alpha.1" ||
		multi.Candidates[1].Version != "0.1.5-rc.3" {
		t.Fatalf("candidates = %+v", multi.Candidates)
	}
	// skipping the second-newest still announces the newest
	if got := BestAnnounceable(multi, "0.1.5-rc.3"); got == nil || got.Version != "0.1.7-alpha.1" {
		t.Errorf("announceable = %+v", got)
	}
	// skipping the best falls to the second-newest (not nil, not best)
	if got := BestAnnounceable(multi, "0.1.7-alpha.1"); got == nil || got.Version != "0.1.5-rc.3" {
		t.Errorf("announceable = %+v", got)
	}
	if got := BestAnnounceable(multi, ""); got == nil || got.Version != "0.1.7-alpha.1" {
		t.Errorf("announceable = %+v", got)
	}
	upToDate := PlanReport("0.1.7-alpha.1",
		mkNpm(map[string]string{"alpha": "0.1.7-alpha.1"}, []string{"0.1.7-alpha.1"}), nil, "", "")
	if !multi.IsUpdate() {
		t.Error("multi must be an update")
	}
	if BestAnnounceable(upToDate, "") != nil {
		t.Error("up to date means nothing announceable")
	}
}

func TestSelectableUpdates(t *testing.T) {
	npm := mkNpm(
		map[string]string{"latest": "0.1.5-rc.2", "next": "0.1.5-rc.3", "alpha": "0.1.7-alpha.1"},
		[]string{"0.1.4", "0.1.5-rc.2", "0.1.5-rc.3", "0.1.6-alpha.1", "0.1.7-alpha.1"},
	)
	report := PlanReport("0.1.5-rc.2", npm, []ReleaseEntry{
		rel("0.1.7-alpha.1", "dsh-v0.1.7-alpha.1", "### 新"),
		rel("0.1.6-alpha.1", "dsh-v0.1.6-alpha.1", ""),
		rel("0.1.4", "dsh-v0.1.4", ""),
	}, "", "")
	choices := SelectableUpdates(report, 10)
	if len(choices) != 3 ||
		choices[0].Version != "0.1.7-alpha.1" ||
		choices[1].Version != "0.1.6-alpha.1" ||
		choices[2].Version != "0.1.5-rc.3" {
		t.Errorf("choices = %+v", choices)
	}
	if choices[0].Channel != ChannelAlpha {
		t.Errorf("first channel = %v", choices[0].Channel)
	}
	hasGitHub := false
	for _, c := range choices {
		if c.Source.Kind == "githubRelease" {
			hasGitHub = true
		}
	}
	if !hasGitHub {
		t.Error("github-sourced choices must exist")
	}
	if got := SelectableUpdates(report, 2); len(got) != 2 || got[1].Version != "0.1.6-alpha.1" {
		t.Errorf("limited choices = %+v", got)
	}

	single := PlanReport("0.1.5-rc.2",
		mkNpm(map[string]string{"next": "0.1.5-rc.3"}, []string{"0.1.5-rc.3"}), nil, "", "")
	if got := SelectableUpdates(single, 10); len(got) != 1 || got[0].Version != "0.1.5-rc.3" {
		t.Errorf("single = %+v", got)
	}
	upToDate := PlanReport("0.1.7-alpha.1",
		mkNpm(map[string]string{"latest": "0.1.7-alpha.1"}, []string{"0.1.7-alpha.1"}), nil, "", "")
	if got := SelectableUpdates(upToDate, 10); len(got) != 0 {
		t.Errorf("up-to-date choices = %+v", got)
	}
}

func TestFeedDates(t *testing.T) {
	// fractional seconds parse too
	feed := []byte(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>v1.2.3</title><published>2026-09-22T06:16:27.123Z</published></entry></feed>`)
	entries := ParseReleaseFeed(feed)
	if len(entries) != 1 || entries[0].PublishedAt == nil {
		t.Fatalf("entries = %+v", entries)
	}
	want := time.Date(2026, 9, 22, 6, 16, 27, 123000000, time.UTC)
	if !entries[0].PublishedAt.Equal(want) {
		t.Errorf("date = %v, want %v", entries[0].PublishedAt, want)
	}
}

func contains(list []string, needle string) bool {
	for _, s := range list {
		if strings.Contains(s, needle) {
			return true
		}
	}
	return false
}

// ver package sanity: the cycle comparator and the npm comparator must
// disagree exactly where the macOS docs say they do.
func TestComparatorDisagreement(t *testing.T) {
	if ver.CycleCompare("0.1.7-alpha.1", "0.1.7-alpha.2") != ver.Same {
		t.Error("cycle comparator must treat prerelease suffixes as not-official only")
	}
	if ver.NpmCompare("0.1.7-alpha.1", "0.1.7-alpha.2") != ver.Ascending {
		t.Error("npm comparator must order prerelease identifiers")
	}
}
