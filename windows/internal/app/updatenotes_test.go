package app

// The release-notes renderer: the dialog must show a release body as
// formatted text, and must never let remote Markdown inject markup into
// the launcher's own WebView. Both halves are asserted here.

import (
	"strings"
	"testing"
)

func TestReleaseNotesRendersBlocks(t *testing.T) {
	markdown := strings.Join([]string{
		"## 侧栏 Deck 已移除",
		"",
		"这次是一次**减法**发布。",
		"",
		"- 插件 `DSHSidebarDeck` 删除",
		"- 注入脚本一并清理",
		"",
		"1. 第一步",
		"2. 第二步",
		"",
		"```",
		"dsh --version",
		"```",
		"",
		"---",
		"",
		"### 结语",
	}, "\n")

	html := releaseNotesHTML(markdown)
	for _, want := range []string{
		"<h2>侧栏 Deck 已移除</h2>",
		"<p>这次是一次<strong>减法</strong>发布。</p>",
		"<ul>",
		"<li>插件 <code>DSHSidebarDeck</code> 删除</li>",
		"<li>注入脚本一并清理</li>",
		"<ol>",
		"<li>第一步</li>",
		"<pre><code>dsh --version</code></pre>",
		"<hr>",
		"<h3>结语</h3>",
	} {
		if !strings.Contains(html, want) {
			t.Fatalf("rendered notes missing %q\nfull:\n%s", want, html)
		}
	}
	if strings.Contains(html, "## ") || strings.Contains(html, "**") || strings.Contains(html, "```") {
		t.Fatalf("raw Markdown leaked into the page:\n%s", html)
	}
}

func TestReleaseNotesEscapesRemoteContent(t *testing.T) {
	html := releaseNotesHTML("<script>alert(1)</script>\n\n[a](javascript:alert(1))")
	if strings.Contains(html, "<script") {
		t.Fatalf("raw script tag reached the page: %s", html)
	}
	if !strings.Contains(html, "&lt;script&gt;alert(1)&lt;/script&gt;") {
		t.Fatalf("script text was not escaped: %s", html)
	}
	// only http(s) links become anchors; a javascript: target stays text
	if strings.Contains(html, "<a href") {
		t.Fatalf("non-web link was turned into an anchor: %s", html)
	}
}

func TestReleaseNotesKeepsSnakeCaseLiteral(t *testing.T) {
	html := releaseNotesHTML("cordis.patch.yml 与 sidebar_deck_path 保持原样")
	if !strings.Contains(html, "sidebar_deck_path") {
		t.Fatalf("intraword underscore was treated as emphasis: %s", html)
	}
}

func TestReleaseNotesEmptyBody(t *testing.T) {
	if got := releaseNotesHTML("   \n\n \n"); got != "" {
		t.Fatalf("blank notes should render nothing, got %q", got)
	}
}

func TestReleaseNotesCapsRunawayBody(t *testing.T) {
	html := releaseNotesHTML(strings.Repeat("x", releaseNotesMaxRunes+500))
	if !strings.HasSuffix(strings.TrimSpace(html), "…</p>") {
		t.Fatalf("a runaway body should end with the ellipsis paragraph, got tail %q",
			html[len(html)-40:])
	}
}

func TestReleaseNotesOrderedListAndNestedIndent(t *testing.T) {
	html := releaseNotesHTML("3. 第三\n    - 子项")
	if !strings.Contains(html, "<ol>") || !strings.Contains(html, "<li>第三</li>") {
		t.Fatalf("ordered item missing: %s", html)
	}
	if !strings.Contains(html, `<li style="margin-left:`) {
		t.Fatalf("indented item lost its indent: %s", html)
	}
	// the nested bullet is a new list, not a sibling of an <ol>
	if strings.Count(html, "<ul>") != 1 || strings.Count(html, "</ol>") != 1 {
		t.Fatalf("list nesting is wrong: %s", html)
	}
}

func TestReleaseNotesRendersBlockquote(t *testing.T) {
	html := releaseNotesHTML("> 这次是一次**减法**发布：\n> 第二行")
	want := "<blockquote>这次是一次<strong>减法</strong>发布： 第二行</blockquote>"
	if !strings.Contains(html, want) {
		t.Fatalf("blockquote not rendered, want %q in:\n%s", want, html)
	}
}

func TestReleaseNotesHeadingRequiresSpace(t *testing.T) {
	// "#tag" is text, not a heading
	if html := releaseNotesHTML("#not-a-heading"); strings.Contains(html, "<h1>") {
		t.Fatalf("#tag was treated as a heading: %s", html)
	}
}
