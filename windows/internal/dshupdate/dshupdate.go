// Package dshupdate carries the pure logic of the dsh update check —
// channel detection, npm metadata decoding, the GitHub release feed
// parser, and the candidate planner — ported from
// Sources/DSHUpdateSupport.swift. The network and process halves live in
// the same package's service.go; this file stays testable without either.
package dshupdate

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/ver"
)

// VersionFromOutput pulls the first semver-looking token out of `dsh
// --version` output.
func VersionFromOutput(output string) string {
	re := regexp.MustCompile(`\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b`)
	return re.FindString(output)
}

// Channel labels which release line a version is on. dsh uses npm-style
// prerelease suffixes (rc/beta/alpha/dev); menus and dialogs must show
// them, or users upgrade onto an internal build believing it a release —
// the easiest way for a check-for-updates feature to mislead.
type Channel int

const (
	ChannelStable Channel = iota
	ChannelReleaseCandidate
	ChannelBeta
	ChannelAlpha
	ChannelDevelopment
	// ChannelOther carries its raw suffix label in OtherLabel.
	ChannelOther
)

// DetectChannel reads the channel off a version. Port of
// DSHReleaseChannel.detect.
func DetectChannel(version string) (Channel, string) {
	value := ver.NormalizeNpm(version)
	dash := strings.IndexByte(value, '-')
	if dash < 0 {
		return ChannelStable, ""
	}
	prerelease := value[dash+1:]
	head := prerelease
	if i := strings.IndexAny(prerelease, ".-"); i >= 0 {
		head = prerelease[:i]
	}
	if head == "" {
		return ChannelStable, ""
	}
	switch strings.ToLower(head) {
	case "rc":
		return ChannelReleaseCandidate, ""
	case "beta":
		return ChannelBeta, ""
	case "alpha":
		return ChannelAlpha, ""
	case "dev", "snapshot":
		return ChannelDevelopment, ""
	}
	return ChannelOther, head
}

// Label is the channel's menu text, matching the macOS launcher's.
func (c Channel) Label() string {
	switch c {
	case ChannelStable:
		return "正式版"
	case ChannelReleaseCandidate:
		return "候选版"
	case ChannelBeta:
		return "公测版"
	case ChannelAlpha:
		return "内测版"
	case ChannelDevelopment:
		return "开发版"
	default:
		return "预发布版"
	}
}

// IsPrerelease is false only for the stable channel.
func (c Channel) IsPrerelease() bool { return c != ChannelStable }

// Source says where a candidate came from.
type Source struct {
	Kind string // "githubRelease" | "npmTag" | "npmRegistry"
	Tag  string // the dist-tag, for Kind == "npmTag"
}

func (s Source) Label() string {
	switch s.Kind {
	case "githubRelease":
		return "GitHub Release"
	case "npmTag":
		return "npm " + s.Tag + " 标签"
	default:
		return "npm 版本列表"
	}
}

// Candidate is one discoverable version.
type Candidate struct {
	Version     string
	Source      Source
	Channel     Channel
	OtherLabel  string
	PublishedAt *time.Time
	Notes       string
}

// NewCandidate normalizes the version and derives the channel.
func NewCandidate(version string, source Source, publishedAt *time.Time, notes string) Candidate {
	normalized := ver.NormalizeNpm(version)
	channel, other := DetectChannel(normalized)
	return Candidate{
		Version:     normalized,
		Source:      source,
		Channel:     channel,
		OtherLabel:  other,
		PublishedAt: publishedAt,
		Notes:       notes,
	}
}

// LabelFor renders the channel label, including a raw "other" suffix.
func (c Candidate) LabelFor() string {
	if c.Channel == ChannelOther {
		return c.OtherLabel + " 版"
	}
	return c.Channel.Label()
}

// Report is everything one check found; menus, dialogs and logs all read
// from it.
type Report struct {
	Current              string
	Best                 Candidate
	NewestStable         *Candidate
	Candidates           []Candidate
	NpmMetadataAvailable bool
	Messages             []string
	Warnings             []string
}

// IsUpdate is true when Best is newer than what is installed.
func (r Report) IsUpdate() bool {
	return ver.NpmCompare(r.Best.Version, r.Current) == ver.Descending
}

// NpmMetadata is the decoded `npm view @deepseek-ai/dsh dist-tags
// versions --json`.
type NpmMetadata struct {
	DistTags map[string]string
	Versions []string
}

// DecodeNpmMetadata parses npm output. npm writes warnings outside the
// JSON; the caller splits stderr away, and anything left before the
// first JSON byte is dropped as a second line of defence. A bare JSON
// string is the fallback shape of `npm view <pkg> version --json`.
func DecodeNpmMetadata(data []byte) *NpmMetadata {
	payload := data
	for len(payload) > 0 && payload[0] != '{' && payload[0] != '"' && payload[0] != '[' {
		payload = payload[1:]
	}
	var object any
	if err := json.Unmarshal(payload, &object); err != nil {
		return nil
	}
	metadata := &NpmMetadata{DistTags: map[string]string{}}
	switch value := object.(type) {
	case map[string]any:
		if tags, ok := value["dist-tags"].(map[string]any); ok {
			for k, v := range tags {
				if s, ok := v.(string); ok {
					metadata.DistTags[k] = s
				}
			}
		}
		if versions, ok := value["versions"].([]any); ok {
			for _, v := range versions {
				if s, ok := v.(string); ok {
					metadata.Versions = append(metadata.Versions, s)
				}
			}
		}
	case string:
		// `npm view <pkg> version --json` fallback: a single string.
		if value != "" {
			metadata.DistTags["latest"] = value
			metadata.Versions = []string{value}
		}
	case []any:
		for _, v := range value {
			if s, ok := v.(string); ok {
				metadata.Versions = append(metadata.Versions, s)
			}
		}
	}
	if len(metadata.DistTags) == 0 && len(metadata.Versions) == 0 {
		return nil
	}
	return metadata
}

// Contains reports whether npm's version list carries the version
// (case-insensitively, as npm spells it).
func (m *NpmMetadata) Contains(version string) bool {
	for _, v := range m.Versions {
		if strings.EqualFold(v, version) {
			return true
		}
	}
	return false
}

// Summary is the log line describing the dist-tags seen.
func (m *NpmMetadata) Summary() string {
	if len(m.DistTags) == 0 {
		return "npm 无 dist-tag"
	}
	order := []string{"latest", "next", "beta", "alpha"}
	rank := func(tag string) int {
		for i, o := range order {
			if o == tag {
				return i
			}
		}
		return len(order)
	}
	tags := make([]string, 0, len(m.DistTags))
	for tag := range m.DistTags {
		tags = append(tags, tag)
	}
	for i := 1; i < len(tags); i++ {
		for j := i; j > 0; j-- {
			l, r := rank(tags[j-1]), rank(tags[j])
			if l > r || (l == r && tags[j-1] > tags[j]) {
				tags[j-1], tags[j] = tags[j], tags[j-1]
			} else {
				break
			}
		}
	}
	parts := make([]string, 0, len(tags))
	for _, tag := range tags {
		parts = append(parts, tag+" "+m.DistTags[tag])
	}
	return "npm dist-tags：" + strings.Join(parts, " / ")
}

// --- GitHub release feed ----------------------------------------------------

// ReleaseEntry is one parsed release.
type ReleaseEntry struct {
	Version     string
	Tag         string
	PublishedAt *time.Time
	Notes       string
	HTMLURL     string
}

type atomLink struct {
	Href string `xml:"href,attr"`
}

type atomEntry struct {
	Title     string     `xml:"title"`
	Links     []atomLink `xml:"link"`
	Updated   string     `xml:"updated"`
	Published string     `xml:"published"`
	Content   struct {
		Value string `xml:",chardata"`
	} `xml:"content"`
}

type atomFeed struct {
	Entries []atomEntry `xml:"entry"`
}

// ParseReleaseFeed parses GitHub's releases.atom. The launcher's own
// update path already fell back to the Atom feed when the anonymous API
// rate-limits (403); dsh's check uses only the feed: no token, no rate
// limit, one request for the recent releases with dates and notes.
func ParseReleaseFeed(data []byte) []ReleaseEntry {
	var feed atomFeed
	if err := xml.Unmarshal(data, &feed); err != nil {
		return nil
	}
	var entries []ReleaseEntry
	for _, e := range feed.Entries {
		var linkTag, htmlURL string
		for _, link := range e.Links {
			if !strings.Contains(link.Href, "/releases/tag/") {
				continue
			}
			if htmlURL == "" {
				htmlURL = link.Href
			}
			if linkTag == "" {
				parts := strings.Split(link.Href, "/")
				raw := parts[len(parts)-1]
				if decoded, err := xmlDecodePath(raw); err == nil {
					raw = decoded
				}
				if raw != "" {
					linkTag = raw
				}
			}
		}
		publishedAt := parseAtomDate(firstNonEmptyString(e.Published, e.Updated))
		var notes string
		if e.Content.Value != "" {
			if md := MarkdownFromHTML(e.Content.Value); md != "" {
				notes = md
			}
		}
		rawTag := linkTag
		if rawTag == "" {
			if e.Title != "" {
				rawTag = e.Title
			} else if htmlURL != "" {
				parts := strings.Split(htmlURL, "/")
				rawTag = parts[len(parts)-1]
			}
		}
		version := ver.NormalizeNpm(rawTag)
		if version == "" || !isDigitByte(version[0]) {
			continue
		}
		entries = append(entries, ReleaseEntry{
			Version:     version,
			Tag:         rawTag,
			PublishedAt: publishedAt,
			Notes:       notes,
			HTMLURL:     htmlURL,
		})
	}
	return entries
}

// xmlDecodePath percent-decodes a tag path segment.
func xmlDecodePath(raw string) (string, error) {
	return url.PathUnescape(raw)
}

func parseAtomDate(value string) *time.Time {
	if value == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, value); err == nil {
			return &t
		}
	}
	return nil
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func isDigitByte(b byte) bool { return b >= '0' && b <= '9' }

// MarkdownFromHTML lightly converts a release body's HTML into the
// Markdown the update dialog renders. Inline marks first (bold, code,
// links), then block structure (headings, lists, paragraphs) — reversed,
// nested links and code collapse into plain text. Port of
// DSHReleaseFeedParser.markdown.
func MarkdownFromHTML(html string) string {
	const limit = 4000
	text := strings.ReplaceAll(html, "\r\n", "\n")
	// code blocks before inline <code>, or the inline rule splits them
	text = replacePattern(text, `(?is)<pre[^>]*>\s*<code[^>]*>(.*?)</code>\s*</pre>`, func(g []string) string {
		return "```\n" + PlainTextFromHTML(g[1]) + "\n```\n"
	})
	text = replacePattern(text, `(?is)<(?:strong|b)[^>]*>(.*?)</(?:strong|b)>`, func(g []string) string {
		return "**" + PlainTextFromHTML(g[1]) + "**"
	})
	text = replacePattern(text, `(?is)<(?:em|i)[^>]*>(.*?)</(?:em|i)>`, func(g []string) string {
		return "*" + PlainTextFromHTML(g[1]) + "*"
	})
	text = replacePattern(text, `(?is)<code[^>]*>(.*?)</code>`, func(g []string) string {
		return "`" + PlainTextFromHTML(g[1]) + "`"
	})
	text = replacePattern(text, `(?is)<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>`, func(g []string) string {
		href := decodeEntities(g[1])
		label := PlainTextFromHTML(g[2])
		if href == "" {
			return label
		}
		return "[" + label + "](" + href + ")"
	})
	text = replacePattern(text, `(?is)<h[1-6][^>]*>(.*?)</h[1-6]>`, func(g []string) string {
		return "### " + PlainTextFromHTML(g[1]) + "\n\n"
	})
	text = replacePattern(text, `(?is)<li[^>]*>(.*?)</li>`, func(g []string) string {
		return "- " + PlainTextFromHTML(g[1]) + "\n"
	})
	text = replacePattern(text, `(?is)<(p|div)[^>]*>(.*?)</\1>`, func(g []string) string {
		return PlainTextFromHTML(g[2]) + "\n\n"
	})
	for _, br := range []string{"<br />", "<br/>", "<br>"} {
		text = strings.ReplaceAll(text, br, "\n")
	}
	text = regexp.MustCompile(`<[^>]+>`).ReplaceAllString(text, "")
	text = decodeEntities(text)
	text = regexp.MustCompile(`\n{3,}`).ReplaceAllString(text, "\n\n")
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(line)
	}
	text = strings.Trim(strings.Join(lines, "\n"), " \t\r\n")
	if text == "" {
		return ""
	}
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit]) + "\n…"
	}
	return text
}

// PlainTextFromHTML squeezes an HTML fragment into plain text (content
// inside tags).
func PlainTextFromHTML(fragment string) string {
	text := regexp.MustCompile(`<[^>]+>`).ReplaceAllString(fragment, "")
	text = decodeEntities(text)
	text = strings.ReplaceAll(text, "\n", " ")
	return strings.TrimSpace(text)
}

var entityReplacements = [][]string{
	{"&nbsp;", " "}, {"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"},
	{"&quot;", "\""}, {"&#39;", "'"}, {"&apos;", "'"},
	{"&mdash;", "—"}, {"&ndash;", "–"},
}

func decodeEntities(value string) string {
	for _, pair := range entityReplacements {
		value = strings.ReplaceAll(value, pair[0], pair[1])
	}
	return value
}

// replacePattern substitutes every match, handing the callback the match
// groups Swift-style: groups[0] is the whole match, groups[n] the nth
// capture. Port of DSHReleaseFeedParser.replacing.
func replacePattern(value, pattern string, transform func(groups []string) string) string {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return value
	}
	matches := re.FindAllStringSubmatchIndex(value, -1)
	if matches == nil {
		return value
	}
	var out strings.Builder
	cursor := 0
	for _, m := range matches {
		out.WriteString(value[cursor:m[0]])
		groups := make([]string, 0, len(m)/2)
		for g := 0; g*2 < len(m); g++ {
			if m[g*2] < 0 {
				groups = append(groups, "")
				continue
			}
			groups = append(groups, value[m[g*2]:m[g*2+1]])
		}
		out.WriteString(transform(groups))
		cursor = m[1]
	}
	out.WriteString(value[cursor:])
	return out.String()
}

// --- planner -----------------------------------------------------------------

// PlanReport merges the sources into one report. A GitHub release wins
// over the same version seen in a npm dist-tag (it carries date and
// notes); only versions actually published to npm are recommended, or
// the install is guaranteed to fail (a lagging mirror once produced
// exactly that ETARGET). Port of DSHUpdatePlanner.report.
func PlanReport(current string, npm *NpmMetadata, releases []ReleaseEntry, npmError string, githubError string) Report {
	var candidates []Candidate
	var messages []string
	var warnings []string

	for _, entry := range releases {
		seen := false
		for _, c := range candidates {
			if c.Version == entry.Version {
				seen = true
				break
			}
		}
		if seen {
			continue
		}
		candidates = append(candidates, NewCandidate(entry.Version, Source{Kind: "githubRelease"}, entry.PublishedAt, entry.Notes))
	}
	if len(releases) > 0 {
		messages = append(messages, fmt.Sprintf("GitHub Release 最新：v%s", releases[0].Version))
	}
	if githubError != "" {
		warnings = append(warnings, "GitHub Release 列表不可用（"+githubError+"）")
	}

	if npm != nil {
		messages = append(messages, npm.Summary())
		for tag, version := range npm.DistTags {
			if version == "" {
				continue
			}
			normalized := ver.NormalizeNpm(version)
			seen := false
			for _, c := range candidates {
				if c.Version == normalized {
					seen = true
					break
				}
			}
			if seen {
				continue
			}
			candidates = append(candidates, NewCandidate(normalized, Source{Kind: "npmTag", Tag: tag}, nil, ""))
		}
		if npmError != "" {
			warnings = append(warnings, "npm 元数据不完整（"+npmError+"）")
		}
	} else if npmError != "" {
		warnings = append(warnings, "npm 元数据不可用（"+npmError+"）")
	}

	if len(candidates) == 0 && npm != nil && len(npm.Versions) > 0 {
		newest := npm.Versions[len(npm.Versions)-1]
		messages = append(messages, "npm 版本列表最新：v"+newest)
		candidates = append(candidates, NewCandidate(newest, Source{Kind: "npmRegistry"}, nil, ""))
	}

	// only versions published to npm are recommendable
	if npm != nil {
		if len(npm.Versions) == 0 {
			warnings = append(warnings, "npm 版本列表为空，未能校验版本是否可安装")
		} else {
			var installable []Candidate
			var dropped []string
			for _, c := range candidates {
				if npm.Contains(c.Version) {
					installable = append(installable, c)
				} else {
					dropped = append(dropped, "v"+c.Version)
				}
			}
			if len(dropped) > 0 {
				warnings = append(warnings, "已忽略尚未发布到 npm 的版本："+strings.Join(dropped, "、"))
			}
			candidates = installable
		}
	} else {
		warnings = append(warnings, "未能校验版本是否已发布到 npm")
	}

	// sort newest first, stably so equal versions keep their order
	for i := 1; i < len(candidates); i++ {
		for j := i; j > 0 && ver.NpmCompare(candidates[j-1].Version, candidates[j].Version) == ver.Ascending; j-- {
			candidates[j-1], candidates[j] = candidates[j], candidates[j-1]
		}
	}
	if len(candidates) == 0 {
		// no candidates at all: fall back to the current version, the
		// caller reports "unknown"
		return Report{
			Current:    ver.NormalizeNpm(current),
			Best:       NewCandidate(current, Source{Kind: "npmRegistry"}, nil, ""),
			Candidates: nil,
			Messages:   messages,
			Warnings:   append(warnings, "没有取到任何已发布版本"),
		}
	}
	report := Report{
		Current:              ver.NormalizeNpm(current),
		Best:                 candidates[0],
		Candidates:           candidates,
		NpmMetadataAvailable: npm != nil && len(npm.Versions) > 0,
		Messages:             messages,
		Warnings:             warnings,
	}
	for i := range candidates {
		if !candidates[i].Channel.IsPrerelease() {
			stable := candidates[i]
			report.NewestStable = &stable
			break
		}
	}
	return report
}

// SelectableUpdates lists what the update dialog may offer: only
// candidates newer than the installed version, newest first, capped at
// limit. Port of DSHUpdatePlanner.selectableUpdates.
func SelectableUpdates(report Report, limit int) []Candidate {
	var newer []Candidate
	for _, c := range report.Candidates {
		if ver.NpmCompare(c.Version, report.Current) == ver.Descending {
			newer = append(newer, c)
		}
	}
	if len(newer) == 0 {
		if report.IsUpdate() {
			return []Candidate{report.Best}
		}
		return nil
	}
	if limit < 1 {
		limit = 1
	}
	if len(newer) > limit {
		newer = newer[:limit]
	}
	return newer
}

// IsSkipped tells a skipped record from a version, whatever form each is
// written in (a GitHub tag vs an npm version spell the same version).
// Port of DSHUpdatePlanner.isSkipped.
func IsSkipped(version, skipped string) bool {
	if skipped == "" {
		return false
	}
	return ver.NormalizeNpm(skipped) == ver.NormalizeNpm(version)
}

// BestAnnounceable picks the version menus and the badge should announce:
// the highest candidate **outside** the skip record (nil when all are
// skipped). Only comparing report.Best is not enough — the user often
// skips the second-newest in the dropdown, after which announcing best
// keeps a lamp lit that the user already refused, and dropping the whole
// report makes the next check announce best again (badge off then on).
// Port of DSHUpdatePlanner.bestAnnounceable.
func BestAnnounceable(report Report, skipped string) *Candidate {
	var pool []Candidate
	for _, c := range report.Candidates {
		if ver.NpmCompare(c.Version, report.Current) == ver.Descending {
			pool = append(pool, c)
		}
	}
	if len(pool) == 0 {
		if report.IsUpdate() {
			pool = []Candidate{report.Best}
		}
	}
	for i := range pool {
		if !IsSkipped(pool[i].Version, skipped) {
			c := pool[i]
			return &c
		}
	}
	return nil
}
