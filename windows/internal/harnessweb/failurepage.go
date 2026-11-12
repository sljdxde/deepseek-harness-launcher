package harnessweb

// failurepage.go ports the macOS launcher's HarnessWindowSupport.failureHTML:
// when the Harness page cannot be served (dsh exited, or the instance is
// token-gated and we hold no entry), the main window shows a readable card
// instead of a stale page or WebView2's raw English error. Layout and copy
// follow the macOS design; the hint names the Windows surfaces (tray panel
// buttons) instead of the menu bar.

import (
	"encoding/base64"
	"fmt"
	"html"
	"strings"
)

// AuthenticationFailureMessage is the dedicated title for a token-gated
// instance we hold no entry URL for: not a network error, just "this
// launcher has no credentials for that instance".
const AuthenticationFailureMessage = "Harness 页面要求认证"

// FailureHTML renders the readable fallback page. detail (optional) is the
// raw cause shown small under the title; both are HTML-escaped.
func FailureHTML(message, detail string) string {
	var b strings.Builder
	b.WriteString(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font: 14px/1.7 "Segoe UI", "Microsoft YaHei", sans-serif; background: #f6f6f6; color: #222; }
  @media (prefers-color-scheme: dark) { body { background: #1c1c1e; color: #f2f2f2; } }
  .card { max-width: 560px; padding: 28px 32px; border-radius: 14px; background: rgba(255,255,255,.72);
          box-shadow: 0 8px 30px rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { .card { background: rgba(255,255,255,.06); } }
  h1 { margin: 0 0 10px; font-size: 17px; }
  p { margin: 6px 0; }
  .detail { color: #888; font-size: 12px; word-break: break-all; }
  .hint { margin-top: 14px; color: #888; font-size: 12px; }
</style></head>
<body><main class="card">
  <h1>`)
	b.WriteString(escapeHTML(message))
	b.WriteString("</h1>\n")
	if detail != "" {
		b.WriteString(`  <p class="detail">`)
		b.WriteString(escapeHTML(detail))
		b.WriteString("</p>\n")
	}
	b.WriteString(`  <p class="hint">托盘图标打开面板，「打开主窗口」可重试；如果服务没有起来，用「重启 DeepSeek Harness」让启动器重新拉起。</p>
</main></body></html>
`)
	return b.String()
}

// FailureDataURL wraps FailureHTML in a data: URI the webview can navigate
// to directly (base64, so no character needs URL escaping). Wails' SetURL
// runs the string through baseURL.Parse, and a data: URI is absolute, so it
// survives unchanged to WebView2's Navigate.
func FailureDataURL(message, detail string) string {
	return fmt.Sprintf("data:text/html;charset=utf-8;base64,%s",
		base64.StdEncoding.EncodeToString([]byte(FailureHTML(message, detail))))
}

// escapeHTML is html.EscapeString with an empty-string passthrough so the
// template above can inline it unconditionally.
func escapeHTML(text string) string {
	return html.EscapeString(text)
}
