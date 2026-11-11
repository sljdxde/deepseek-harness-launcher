package dshupdate

// service.go is the network half of the dsh update check: the installed
// version, npm's dist-tags, and the GitHub release feed, merged through
// the ported planner.

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

// ReleasesFeedURL is where dsh's releases live. The Atom feed is used
// rather than the API: the anonymous API rate-limits (403) frequently,
// which the launcher's own update path already hit.
const ReleasesFeedURL = "https://github.com/deepseek-ai/deepseek-harness/releases.atom"

// CheckResult is what one check found.
type CheckResult struct {
	Report Report
	Err    string
}

// RunVersion reads `dsh --version` through the given entry and environment.
func RunVersion(entry string, env []string) string {
	cmd := proc.Command(entry, "--version")
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	return VersionFromOutput(string(out))
}

// FetchNpmMetadata asks npm for dist-tags and versions in one call, falling
// back to the single-field query when a npm build rejects the combined
// one.
func FetchNpmMetadata(npmPath string, env []string) (*NpmMetadata, string) {
	run := func(args ...string) []byte {
		cmd := proc.Command(npmPath, args...)
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		if err != nil && len(out) == 0 {
			return nil
		}
		// npm writes warnings to stderr; only stdout is JSON. Using
		// CombinedOutput keeps them apart badly, so strip everything
		// before the first JSON byte in the decoder instead.
		return out
	}
	if out := run("view", "@deepseek-ai/dsh", "dist-tags", "versions", "--json"); out != nil {
		if metadata := DecodeNpmMetadata(out); metadata != nil {
			return metadata, ""
		}
	}
	if out := run("view", "@deepseek-ai/dsh", "version", "--json"); out != nil {
		if metadata := DecodeNpmMetadata(out); metadata != nil {
			return metadata, "仅取到 npm latest"
		}
	}
	return nil, "npm view 无输出"
}

// FetchReleases pulls and parses the release feed.
func FetchReleases() ([]ReleaseEntry, string) {
	client := &http.Client{Timeout: 12 * time.Second}
	req, err := http.NewRequest(http.MethodGet, ReleasesFeedURL, nil)
	if err != nil {
		return nil, err.Error()
	}
	req.Header.Set("User-Agent", "DeepseekHarnessLauncher")
	req.Header.Set("Accept", "application/atom+xml, application/xml;q=0.9, */*;q=0.8")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Sprintf("Release feed HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil || len(data) == 0 {
		return nil, "Release feed 为空"
	}
	entries := ParseReleaseFeed(data)
	if len(entries) == 0 {
		return nil, "Release feed 解析为空"
	}
	return entries, ""
}

// Check runs the whole dsh update check. Both sources failing is a
// failure; either one usable yields a conclusion with the other's error
// in the warnings.
func Check(current string, npmPath string, env []string) Report {
	if current == "" {
		current = "0.0.0"
	}
	var npm *NpmMetadata
	npmError := ""
	if npmPath != "" {
		npm, npmError = FetchNpmMetadata(npmPath, env)
	}
	releases, githubError := FetchReleases()
	return PlanReport(current, npm, releases, npmError, githubError)
}
