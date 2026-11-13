// Package probe makes the small loopback HTTP probes, ported from
// Sources/ServiceProbe.swift.
//
// Callers must be able to tell "the endpoint surely is not there (404)"
// apart from "no response arrived in time": the latter is only missing
// evidence (dsh busy, endpoint slow) — judging "plugin not loaded" from
// it is a false positive. So a real HTTP status is always returned, and
// only connection failures and timeouts yield an error.
package probe

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"
)

// client is shared by every loopback probe: keep-alive reuse matters here
// because the completion / plugin loops hit the same host for hours. The
// per-request deadline comes from the context, not Client.Timeout.
var client = &http.Client{Transport: &http.Transport{
	MaxIdleConns:        8,
	MaxIdleConnsPerHost: 4,
	IdleConnTimeout:     90 * time.Second,
}}

// Response asks url once, waiting up to timeout. A real HTTP response
// (any status) returns status and body with a nil error; only transport
// failure or timeout returns err.
func Response(url string, timeout time.Duration) (status int, body string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4MB covers any dsh front page
	return resp.StatusCode, string(data), nil
}

// Body is Response, keeping only the body; anything that is not a real
// HTTP response comes back empty.
func Body(url string, timeout time.Duration) string {
	_, body, err := Response(url, timeout)
	if err != nil {
		return ""
	}
	return body
}

// PostJSON fires a small loopback JSON command without making callers
// handle the response body. HTTP failures are intentionally returned as
// a zero status so optional launcher enhancements can fall back to their
// base behaviour. Port of ServiceProbe.postJSON.
func PostJSON(url string, payload string, timeout time.Duration) int {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(payload))
	if err != nil {
		return 0
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}
