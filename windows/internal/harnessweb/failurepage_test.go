package harnessweb

// Tests for the failure fallback page, ported from the macOS launcher's
// failureHTML expectations: readable card, escaped user data, optional
// detail block, and a data: URI a webview can navigate to.

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestFailureHTML(t *testing.T) {
	page := FailureHTML("Harness 服务已停止", "exit status 1")
	if !strings.Contains(page, "<h1>Harness 服务已停止</h1>") {
		t.Errorf("标题要出现在卡片里: %s", page)
	}
	if !strings.Contains(page, `<p class="detail">exit status 1</p>`) {
		t.Errorf("detail 要以小字展示: %s", page)
	}
	if !strings.Contains(page, "打开主窗口」可重试") {
		t.Errorf("要给出重试指引: %s", page)
	}
	if !strings.Contains(page, "<!doctype html>") || !strings.Contains(page, `charset="utf-8"`) {
		t.Errorf("要是完整的 UTF-8 HTML 页: %s", page)
	}

	noDetail := FailureHTML("页面加载失败", "")
	if strings.Contains(noDetail, `class="detail"`) {
		t.Errorf("detail 为空时不得渲染 detail 块: %s", noDetail)
	}
	if !strings.Contains(noDetail, "<h1>页面加载失败</h1>") {
		t.Errorf("无 detail 时标题仍在: %s", noDetail)
	}
}

func TestFailureHTMLEscapes(t *testing.T) {
	page := FailureHTML(`<b>标题</b> & "引号"`, `<script>alert(1)</script>`)
	if strings.Contains(page, "<b>标题</b>") || strings.Contains(page, "<script>") {
		t.Errorf("标题与 detail 必须转义，不得注入 HTML: %s", page)
	}
	if !strings.Contains(page, "&lt;b&gt;标题&lt;/b&gt;") {
		t.Errorf("标题被转义为实体: %s", page)
	}
	if !strings.Contains(page, "&lt;script&gt;alert(1)&lt;/script&gt;") {
		t.Errorf("detail 被转义为实体: %s", page)
	}
	if !strings.Contains(page, "&#34;引号&#34;") {
		t.Errorf("引号被转义: %s", page)
	}
}

func TestFailureDataURL(t *testing.T) {
	url := FailureDataURL("Harness 页面要求认证", "")
	const prefix = "data:text/html;charset=utf-8;base64,"
	if !strings.HasPrefix(url, prefix) {
		t.Fatalf("data URI 前缀: got %q", url[:min(len(url), 60)])
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(url, prefix))
	if err != nil {
		t.Fatalf("base64 可解码: %v", err)
	}
	if string(raw) != FailureHTML("Harness 页面要求认证", "") {
		t.Error("data URI 解码后与 FailureHTML 输出一致")
	}
	// base64 字符集不含 URL 特殊字符，重导航无需再转义。
	if strings.ContainsAny(strings.TrimPrefix(url, prefix), "&#\"' ") {
		t.Error("base64 载荷不应含 URL 特殊字符")
	}
}

func TestAuthenticationFailureMessage(t *testing.T) {
	if AuthenticationFailureMessage != "Harness 页面要求认证" {
		t.Errorf("401 文案口径固定: got %q", AuthenticationFailureMessage)
	}
}
