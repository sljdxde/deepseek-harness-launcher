package app

// The download path: counters and wording the progress window shows, the
// JSON its page polls, and the transfer itself — including cancellation,
// which is what makes 取消 actually stop a stalled GitHub connection.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestHumanBytes(t *testing.T) {
	cases := map[int64]string{
		0:               "0 B",
		900:             "900 B",
		2048:            "2 KB",
		5 * 1024 * 1024: "5.0 MB",
		3 << 30:         "3.00 GB",
	}
	for in, want := range cases {
		if got := humanBytes(in); got != want {
			t.Fatalf("humanBytes(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestDownloadPercent(t *testing.T) {
	cases := []struct {
		written, total int64
		want           float64
	}{
		{0, 100, 0},
		{50, 100, 50},
		{100, 100, 100},
		{150, 100, 100}, // clamp
		{40, 0, 0},      // unknown length
		{40, -1, 0},
	}
	for _, c := range cases {
		if got := downloadPercent(c.written, c.total); got != c.want {
			t.Fatalf("downloadPercent(%d,%d) = %v, want %v", c.written, c.total, got, c.want)
		}
	}
}

func TestDownloadStatusText(t *testing.T) {
	if got := downloadStatusText(downloadConnecting, 0, 0, ""); !strings.Contains(got, "正在连接") {
		t.Fatalf("connecting text = %q", got)
	}
	if got := downloadStatusText(downloadRunning, 12*1024*1024, 40*1024*1024, ""); got != "正在下载 12.0 MB / 40.0 MB" {
		t.Fatalf("running text = %q", got)
	}
	if got := downloadStatusText(downloadRunning, 12*1024*1024, 0, ""); got != "正在下载…（已完成 12.0 MB）" {
		t.Fatalf("unknown-length text = %q", got)
	}
	if got := downloadStatusText(downloadCancelled, 1, 2, ""); got != "已取消下载" {
		t.Fatalf("cancelled text = %q", got)
	}
	if got := downloadStatusText(downloadFailed, 1, 2, "HTTP 403"); !strings.Contains(got, "HTTP 403") {
		t.Fatalf("failed text = %q", got)
	}
}

func TestDownloadStateJSONIsWhatThePagePolls(t *testing.T) {
	d := &downloadHost{}
	d.version = "0.4.0"
	d.phase = downloadRunning
	d.written = 5 * 1024 * 1024
	d.total = 20 * 1024 * 1024
	d.active = true

	var state struct {
		Active  bool    `json:"active"`
		Phase   string  `json:"phase"`
		Written int64   `json:"written"`
		Total   int64   `json:"total"`
		Pct     float64 `json:"pct"`
		Text    string  `json:"text"`
	}
	if err := json.Unmarshal([]byte(d.stateJSON()), &state); err != nil {
		t.Fatalf("state is not valid JSON: %v", err)
	}
	if !state.Active || state.Phase != downloadRunning {
		t.Fatalf("unexpected state: %+v", state)
	}
	if state.Written != d.written || state.Total != d.total || state.Pct != 25 {
		t.Fatalf("unexpected counters: %+v", state)
	}
	if !strings.Contains(state.Text, "正在下载") {
		t.Fatalf("unexpected text: %q", state.Text)
	}
}

func TestDownloadPageBakesVersion(t *testing.T) {
	page := downloadPage("0.4.0")
	if !strings.Contains(page, "v0.4.0") {
		t.Fatalf("progress page lost its version: %s", page)
	}
	if strings.Contains(page, "__VERSION__") {
		t.Fatalf("placeholder was not replaced")
	}
	// the page answers through HTTP, never through a binding
	if strings.Contains(page, "window.go") {
		t.Fatalf("progress page still calls a Wails binding:\n%s", page)
	}
}

func TestDownloadToWritesFileAndReportsProgress(t *testing.T) {
	payload := bytes.Repeat([]byte("dhl-update-payload\n"), 8000)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-length", strconv.Itoa(len(payload)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	target := filepath.Join(t.TempDir(), "DHL-windows-0.4.0.exe")
	// a previous copy must be replaced, which os.Rename alone refuses to do
	if err := os.WriteFile(target, []byte("old build"), 0o644); err != nil {
		t.Fatal(err)
	}

	var points []int64
	var total int64
	err := downloadTo(context.Background(), server.URL, target, func(written, t2 int64) {
		points = append(points, written)
		total = t2
	})
	if err != nil {
		t.Fatalf("download failed: %v", err)
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("downloaded %d bytes, want %d", len(got), len(payload))
	}
	if total != int64(len(payload)) {
		t.Fatalf("reported total %d, want %d", total, len(payload))
	}
	if len(points) == 0 || points[len(points)-1] != int64(len(payload)) {
		t.Fatalf("final progress = %v, want the full %d bytes", points, len(payload))
	}
	for i := 1; i < len(points); i++ {
		if points[i] < points[i-1] {
			t.Fatalf("progress went backwards: %v", points)
		}
	}
	if _, err := os.Stat(target + ".part"); !os.IsNotExist(err) {
		t.Fatalf("partial file was left behind")
	}
}

func TestDownloadToHonoursCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-length", "1048576")
		_, _ = w.Write(bytes.Repeat([]byte("x"), 4096))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		close(started)
		// hold the connection open until the client gives up
		<-r.Context().Done()
	}))
	defer server.Close()

	target := filepath.Join(t.TempDir(), "DHL-windows-0.4.0.exe")
	go func() {
		<-started
		cancel()
	}()

	err := downloadTo(ctx, server.URL, target, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled download returned %v, want context.Canceled", err)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("cancelled download left the target file behind")
	}
	if _, statErr := os.Stat(target + ".part"); !os.IsNotExist(statErr) {
		t.Fatalf("cancelled download left the .part file behind")
	}
}

func TestDownloadToRejectsErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no asset", http.StatusForbidden)
	}))
	defer server.Close()

	target := filepath.Join(t.TempDir(), "DHL-windows-0.4.0.exe")
	err := downloadTo(context.Background(), server.URL, target, nil)
	if err == nil || !strings.Contains(err.Error(), "403") {
		t.Fatalf("403 download returned %v, want an HTTP 403 error", err)
	}
	if _, statErr := os.Stat(target); !os.IsNotExist(statErr) {
		t.Fatalf("failed download created the target file")
	}
}
