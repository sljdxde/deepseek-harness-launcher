package app

// The dsh install/update progress window's data contract. It used to be an
// HTML-option window with a window.go binding, which renders nothing and
// has no bindings on asset-served pages — so its 取消 button was dead and
// its bar invisible. The page now polls this state and cancels over HTTP.

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProgressStateJSONIsWhatThePagePolls(t *testing.T) {
	s := &progressState{}
	s.set("正在安装依赖…", 42.5)

	var got struct {
		Detail    string  `json:"detail"`
		Pct       float64 `json:"pct"`
		Finished  bool    `json:"finished"`
		Cancelled bool    `json:"cancelled"`
	}
	if err := json.Unmarshal([]byte(s.stateJSON()), &got); err != nil {
		t.Fatalf("progress state is not valid JSON: %v", err)
	}
	if got.Detail != "正在安装依赖…" || got.Pct != 42.5 || got.Finished {
		t.Fatalf("unexpected progress state: %+v", got)
	}

	s.finish("已取消", true)
	if err := json.Unmarshal([]byte(s.stateJSON()), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Finished || !got.Cancelled || got.Pct != 100 {
		t.Fatalf("terminal state did not mark the bar done: %+v", got)
	}
}

func TestProgressPageUsesHTTPNotBindings(t *testing.T) {
	page := progressPage
	if strings.Contains(page, "window.go") {
		t.Fatalf("progress page still calls a Wails binding:\n%s", page)
	}
	if !strings.Contains(page, "/dhl-progress-state") {
		t.Fatalf("progress page does not poll its state endpoint")
	}
	if !strings.Contains(page, "action=progress-cancel") {
		t.Fatalf("progress page's 取消 button does not post the cancel action")
	}
}
