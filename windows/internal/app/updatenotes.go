package app

// updatenotes.go renders the Markdown release body GitHub returns for a
// launcher release (and, for dsh, the npm/GitHub candidate notes) into the
// HTML the update dialog shows.
//
// Why this exists: the untrustworthy-but-common path used a Win32
// MessageBoxW, which draws plain text only, so the dialog showed literal
// Markdown ("## Deepseek Harness Launcher v0.4.0", "**侧栏 Deck**", "- 条目")
// and cut the body at 900 runes. macOS renders the same body through
// ReleaseNotesSupport; this is the Windows counterpart and covers the same
// subset: headings, lists, fenced code, rules, and inline bold / italic /
// code / links. Anything unrecognized stays literal text, so malformed
// notes degrade to readable prose instead of vanishing.
//
// The output is HTML, so every byte of the release body is escaped before
// it reaches the page: a release body is remote content rendered inside
// the launcher's own WebView.

import (
	"strconv"
	"strings"
)

const (
	// releaseNotesMaxRunes bounds what one dialog has to lay out. The page
	// scrolls, so this is generous; it only stops a pathological release
	// body from becoming a multi-megabyte document.
	releaseNotesMaxRunes = 20000

	// inline max nesting keeps renderInline terminating on adversarial
	// input such as "**a **b **c**" — at depth 2 the inner span is treated
	// as plain text.
	inlineMaxDepth = 2
)

// releaseNotesHTML converts one Markdown body to HTML blocks. An empty or
// whitespace-only body yields "" so the caller can show its own
// "no notes" line.
func releaseNotesHTML(markdown string) string {
	markdown = strings.ReplaceAll(markdown, "\r\n", "\n")
	markdown = strings.ReplaceAll(markdown, "\r", "\n")
	if runes := []rune(markdown); len(runes) > releaseNotesMaxRunes {
		markdown = string(runes[:releaseNotesMaxRunes]) + "\n…"
	}

	lines := strings.Split(markdown, "\n")
	// trailing blank lines only inflate the dialog
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 {
		return ""
	}

	var out strings.Builder
	listOpen := "" // "ul" / "ol" / ""
	closeList := func() {
		if listOpen != "" {
			out.WriteString("</" + listOpen + ">\n")
			listOpen = ""
		}
	}
	openList := func(kind string) {
		if listOpen == kind {
			return
		}
		closeList()
		out.WriteString("<" + kind + ">\n")
		listOpen = kind
	}

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		if line == "" {
			closeList()
			continue
		}

		// fenced code block: ``` … ```
		if strings.HasPrefix(line, "```") {
			closeList()
			var fence []string
			for i+1 < len(lines) && !strings.HasPrefix(strings.TrimSpace(lines[i+1]), "```") {
				i++
				fence = append(fence, lines[i])
			}
			if i+1 < len(lines) {
				i++ // consume the closing fence
			}
			out.WriteString("<pre><code>" + esc(strings.Join(fence, "\n")) + "</code></pre>\n")
			continue
		}

		// horizontal rule: --- / *** / ___
		if isHorizontalRule(line) {
			closeList()
			out.WriteString("<hr>\n")
			continue
		}

		// blockquote: consecutive lines starting with ">"
		if strings.HasPrefix(line, ">") {
			closeList()
			quoted := []string{strings.TrimSpace(strings.TrimPrefix(line, ">"))}
			for i+1 < len(lines) {
				next := strings.TrimSpace(lines[i+1])
				if !strings.HasPrefix(next, ">") {
					break
				}
				i++
				quoted = append(quoted, strings.TrimSpace(strings.TrimPrefix(next, ">")))
			}
			out.WriteString("<blockquote>" + renderInline(strings.Join(quoted, " "), 0) + "</blockquote>\n")
			continue
		}

		// ATX heading: # … ######
		if level, text, ok := markdownHeading(line); ok {
			closeList()
			tag := strconv.Itoa(level)
			out.WriteString("<h" + tag + ">" + renderInline(text, 0) + "</h" + tag + ">\n")
			continue
		}

		// list item: - / * / + bullet, or 1. / 1) ordered. The RAW line is
		// passed in: the nesting depth lives in its leading spaces.
		if item, ok := markdownListItem(lines[i]); ok {
			openList(item.kind)
			if item.indent > 0 {
				out.WriteString(`<li style="margin-left:` + strconv.Itoa(item.indent*14) + `px">` +
					renderInline(item.text, 0) + "</li>\n")
			} else {
				out.WriteString("<li>" + renderInline(item.text, 0) + "</li>\n")
			}
			continue
		}

		// plain paragraph (one line per paragraph, as macOS does)
		closeList()
		out.WriteString("<p>" + renderInline(line, 0) + "</p>\n")
	}
	closeList()
	return out.String()
}

func isHorizontalRule(line string) bool {
	body := strings.ReplaceAll(line, " ", "")
	if len(body) < 3 {
		return false
	}
	first := body[0]
	if first != '-' && first != '*' && first != '_' {
		return false
	}
	for i := 0; i < len(body); i++ {
		if body[i] != first {
			return false
		}
	}
	return true
}

func markdownHeading(line string) (level int, text string, ok bool) {
	if !strings.HasPrefix(line, "#") {
		return 0, "", false
	}
	marks := 0
	for marks < len(line) && line[marks] == '#' {
		marks++
	}
	// "#tag" is not a heading; Markdown requires the space
	if marks > 6 || marks >= len(line) || line[marks] != ' ' {
		return 0, "", false
	}
	text = strings.TrimSpace(strings.Trim(line[marks:], "#"))
	if text == "" {
		return 0, "", false
	}
	return marks, text, true
}

type markdownList struct {
	kind   string // "ul" or "ol"
	text   string
	indent int // nesting depth derived from leading spaces
}

func markdownListItem(line string) (markdownList, bool) {
	indentWidth := len(line) - len(strings.TrimLeft(line, " "))
	body := strings.TrimSpace(line)

	if len(body) > 1 && strings.ContainsRune("-*+", rune(body[0])) && body[1] == ' ' {
		return markdownList{kind: "ul", text: strings.TrimSpace(body[1:]), indent: min(indentWidth/2, 4)}, true
	}

	digits := 0
	for digits < len(body) && digits < 4 && body[digits] >= '0' && body[digits] <= '9' {
		digits++
	}
	if digits > 0 && digits < len(body) && (body[digits] == '.' || body[digits] == ')') {
		rest := strings.TrimSpace(body[digits+1:])
		if rest != "" {
			return markdownList{kind: "ol", text: rest, indent: min(indentWidth/2, 4)}, true
		}
	}
	return markdownList{}, false
}

// renderInline tokenizes one line's inline Markdown. Everything outside a
// recognized span is escaped; everything inside is escaped too, so a
// release body cannot inject markup.
func renderInline(text string, depth int) string {
	runes := []rune(text)
	var out strings.Builder

	for i := 0; i < len(runes); {
		switch runes[i] {
		case '`':
			if j := indexRuneFrom(runes, i+1, '`'); j > i {
				out.WriteString("<code>" + esc(string(runes[i+1:j])) + "</code>")
				i = j + 1
				continue
			}

		case '[':
			if j := indexRuneFrom(runes, i+1, ']'); j > i {
				// …[label](target)
				if j+1 < len(runes) && runes[j+1] == '(' {
					if k := indexRuneFrom(runes, j+2, ')'); k > j+1 {
						label := string(runes[i+1 : j])
						target := strings.TrimSpace(string(runes[j+2 : k]))
						if isWebLink(target) && depth < inlineMaxDepth {
							out.WriteString(`<a href="` + esc(target) + `" target="_blank" rel="noreferrer">` +
								renderInline(label, depth+1) + "</a>")
							i = k + 1
							continue
						}
					}
				}
			}

		case '*', '_':
			needle := string(runes[i])
			double := i+1 < len(runes) && string(runes[i+1]) == needle
			if double {
				needle += needle
			}
			if j := indexStringFrom(runes, i+len(needle), needle); j > i {
				inner := string(runes[i+len(needle) : j])
				// "_" inside a word (snake_case) stays literal; emphasis
				// around a phrase only.
				intraword := needle == "_" && !strings.Contains(inner, " ")
				if inner != "" && !strings.Contains(inner, "\n") && !intraword {
					if depth < inlineMaxDepth {
						if double {
							out.WriteString("<strong>" + renderInline(inner, depth+1) + "</strong>")
						} else {
							out.WriteString("<em>" + renderInline(inner, depth+1) + "</em>")
						}
						i = j + len(needle)
						continue
					}
				}
			}
		}

		out.WriteString(esc(string(runes[i])))
		i++
	}
	return out.String()
}

func indexRuneFrom(runes []rune, from int, want rune) int {
	for i := from; i < len(runes); i++ {
		if runes[i] == want {
			return i
		}
	}
	return -1
}

func indexStringFrom(runes []rune, from int, want string) int {
	needle := []rune(want)
	if len(needle) == 0 {
		return -1
	}
	for i := from; i+len(needle) <= len(runes); i++ {
		match := true
		for k := range needle {
			if runes[i+k] != needle[k] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func isWebLink(target string) bool {
	return strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://")
}
