// Package harnessweb makes the two judgements about a real dsh web
// service, ported from Sources/HarnessWebCompatibility.swift. dsh has
// changed the outward behaviour behind both more than once (0.1.5-rc.2
// made the front page require token auth with a fixed 401 body), so the
// launcher keeps them in one tested place.
package harnessweb

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// entryPattern captures the URL of dsh's `dsh web: <url>` stdout line.
// CJK log text around it must not be swallowed into the URL.
var entryPattern = regexp.MustCompile(`dsh web: (https?://[^\s\x{4e00}-\x{9fff}]+)`)

// WebEntryURL captures the `dsh web: <url>` entry line from dsh stdout.
// Since 0.1.5-rc.2 the URL carries ?token= (the browser trades it for a
// session cookie on first visit); older versions carry none. Lines whose
// port does not match the one we asked for (an outside instance) are
// refused. Port of HarnessWebCompatibility.webEntryURL.
func WebEntryURL(output string, port int) *url.URL {
	match := entryPattern.FindStringSubmatch(output)
	if match == nil {
		return nil
	}
	parsed, err := url.Parse(match[1])
	if err != nil {
		return nil
	}
	// url.Parse leaves Port empty for default-scheme URLs; dsh always
	// prints an explicit port, and a line without one is not our instance.
	if parsed.Port() != fmt.Sprint(port) {
		return nil
	}
	return parsed
}

// IsHarnessWebBody reports whether a response body comes from a running
// dsh. Both shapes count:
//   - older / already-authed: the page carries the deepseek and dsh marks;
//   - 0.1.5-rc.2+ unauthed: the root path answers 401 with a fixed body —
//     the service is in fact ready, and not recognising it would make the
//     launcher wait for a readiness that already arrived (until the
//     10-minute timeout kills it).
//
// Port of HarnessWebCompatibility.isHarnessWebBody.
func IsHarnessWebBody(body string) bool {
	lower := strings.ToLower(body)
	if strings.Contains(lower, "dsh web authentication required") {
		return true
	}
	return strings.Contains(lower, "deepseek") && strings.Contains(lower, "dsh")
}
