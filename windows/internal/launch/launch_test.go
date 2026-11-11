package launch

// Unit tests for the pure launch-argument builders. The process glue in
// Start is exercised on real launches; BootArgs and OpenSessionPayload
// carry the ported macOS semantics and are checked here against the
// Swift test expectations.

import "testing"

func TestBootArgs(t *testing.T) {
	tests := []struct {
		name     string
		port     int
		base     string
		deck     string
		disabled string
		want     []string
	}{
		{
			name:     "三个槽位齐全",
			port:     3080,
			base:     "base.yml",
			deck:     "deck.yml",
			disabled: "disabled.yml",
			want:     []string{"web", "--patch", "base.yml", "--patch", "deck.yml", "--patch", "disabled.yml", "--no-open", "--port", "3080"},
		},
		{
			name: "空槽位跳过（dsh 对缺失的 --patch 文件是致命错误）",
			port: 3081,
			base: "base.yml",
			want: []string{"web", "--patch", "base.yml", "--no-open", "--port", "3081"},
		},
		{
			name:     "只有停用层",
			port:     3099,
			disabled: "disabled.yml",
			want:     []string{"web", "--patch", "disabled.yml", "--no-open", "--port", "3099"},
		},
		{
			name: "全部为空",
			port: 3080,
			want: []string{"web", "--no-open", "--port", "3080"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := BootArgs(tt.port, tt.base, tt.deck, tt.disabled)
			if len(got) != len(tt.want) {
				t.Fatalf("BootArgs = %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Fatalf("BootArgs = %v, want %v", got, tt.want)
				}
			}
		})
	}
}

func TestOpenSessionPayload(t *testing.T) {
	payload, ok := OpenSessionPayload("abc-123", true)
	if !ok || payload != `{"sessionId":"abc-123","requireEmbedded":true}` {
		t.Errorf("embedded 跳转要带 requireEmbedded: got (%q, %v)", payload, ok)
	}
	payload, ok = OpenSessionPayload("abc-123", false)
	if !ok || payload != `{"sessionId":"abc-123"}` {
		t.Errorf("普通跳转不带 requireEmbedded: got (%q, %v)", payload, ok)
	}
	payload, ok = OpenSessionPayload("  abc-123 \r\n", true)
	if !ok || payload != `{"sessionId":"abc-123","requireEmbedded":true}` {
		t.Errorf("sessionId 先去空白: got (%q, %v)", payload, ok)
	}
	if payload, ok = OpenSessionPayload("   ", true); ok || payload != "" {
		t.Errorf("空白 sessionId 拒绝: got (%q, %v)", payload, ok)
	}
	if payload, ok = OpenSessionPayload("", false); ok || payload != "" {
		t.Errorf("空 sessionId 拒绝: got (%q, %v)", payload, ok)
	}
}
