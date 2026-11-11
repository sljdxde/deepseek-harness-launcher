package harnessweb

import "testing"

func TestWebEntryURL(t *testing.T) {
	// token-bearing entry (0.1.5-rc.2+), surrounded by CJK log text
	u := WebEntryURL("some noise dsh web: http://127.0.0.1:3080/?token=abc123 中文日志", 3080)
	if u == nil {
		t.Fatal("token-bearing entry must be captured")
	}
	if got := u.Query().Get("token"); got != "abc123" {
		t.Errorf("token = %q, want abc123", got)
	}
	// older, tokenless entry
	if u := WebEntryURL("dsh web: http://127.0.0.1:3080/", 3080); u == nil {
		t.Fatal("tokenless entry must be captured")
	}
	// a different port means an outside instance: refuse
	if u := WebEntryURL("dsh web: http://127.0.0.1:3099/?token=x", 3080); u != nil {
		t.Fatalf("foreign port must be refused, got %v", u)
	}
	// no entry line at all
	if u := WebEntryURL("listening on 3080", 3080); u != nil {
		t.Fatalf("plain log line must not match, got %v", u)
	}
	// CJK right after the URL must not be swallowed into it
	u = WebEntryURL("dsh web: http://127.0.0.1:3080/?token=t 已就绪", 3080)
	if u == nil || u.RawQuery != "token=t" {
		t.Fatalf("CJK suffix must be excluded, got %v", u)
	}
}

func TestIsHarnessWebBody(t *testing.T) {
	cases := []struct {
		body string
		want bool
	}{
		{"<html>Deepseek Harness dsh assets</html>", true},
		{"dsh web authentication required", true},
		{"DSH WEB AUTHENTICATION REQUIRED", true}, // case-insensitive
		{"welcome to nginx", false},
		{"deepseek only", false}, // needs both marks
		{"", false},
	}
	for _, c := range cases {
		if got := IsHarnessWebBody(c.body); got != c.want {
			t.Errorf("IsHarnessWebBody(%q) = %v, want %v", c.body, got, c.want)
		}
	}
}
