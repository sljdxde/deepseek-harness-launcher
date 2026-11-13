package pluginisolation

// Test cases ported verbatim from scripts/test-plugin-isolation.swift
// (the user-disable overlay and the sidebar deck takeover patch), plus
// StageBootPatches gate coverage for the per-boot staging.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func disabled(bundle string, rowIDs ...string) DisabledPlugin {
	return DisabledPlugin{Bundle: bundle, RowIDs: rowIDs, DisabledAt: "2026-11-11T00:00:00Z"}
}

func TestRenderCombinedDisabledPatch(t *testing.T) {
	contextPlugin := disabled("dsh-context", "dsh-context")
	archivePlugin := disabled("dsh-archive-manager", "dsh-archive-manager")
	basePlugin := disabled("@deepseek-ai/dsh-base", "session")
	managerPlugin := disabled("dsh-plugin-manager", "dsh-plugin-manager")
	crashIsolated := IsolatedPlugin{Bundle: "@a/b", RowIDs: []string{"row-x", "dsh-context", "bad\ninjected"}, Reason: "r", IsolatedAt: "t"}

	if got := RenderCombinedDisabledPatch(nil, []DisabledPlugin{contextPlugin, archivePlugin}); got != "- id: dsh-context\n  disabled: true\n- id: dsh-archive-manager\n  disabled: true\n" {
		t.Errorf("用户停用正常渲染；内置插件（非 core/管理器）允许停用: got %q", got)
	}
	if got := RenderCombinedDisabledPatch(nil, []DisabledPlugin{basePlugin, managerPlugin}); got != "" {
		t.Errorf("不可停用的 core/管理器即使状态文件里有记录也不渲染: got %q", got)
	}
	merged := RenderCombinedDisabledPatch([]IsolatedPlugin{crashIsolated}, []DisabledPlugin{contextPlugin})
	if merged != "- id: dsh-context\n  disabled: true\n- id: row-x\n  disabled: true\n" {
		t.Errorf("崩溃隔离与用户停用合并、按行 id 去重，且不安全 id 被过滤: got %q", merged)
	}
	if !strings.HasPrefix(merged, "- id: dsh-context\n") {
		t.Errorf("用户停用的行排在崩溃隔离之前（冲突时用户意图优先）: got %q", merged)
	}
	if got := RenderCombinedDisabledPatch(nil, nil); got != "" {
		t.Errorf("没有任何条目时渲染空串: got %q", got)
	}

	deckPlugin := disabled(SidebarDeckBundle, SidebarDeckBundle)
	if got := RenderCombinedDisabledPatch(nil, []DisabledPlugin{deckPlugin}); got != "- id: dsh-sidebar-deck\n  disabled: true\n- id: ui-sidebar\n  disabled: false\n" {
		t.Errorf("停用侧栏 Deck：禁用 Deck 行，并把官方侧栏行重新启用: got %q", got)
	}
	if !strings.HasSuffix(RenderCombinedDisabledPatch(nil, []DisabledPlugin{deckPlugin}), "- id: ui-sidebar\n  disabled: false\n") {
		t.Error("重新启用条目追加在最后（覆盖层后应用、优先级最高）")
	}
	if strings.Contains(RenderCombinedDisabledPatch(nil, []DisabledPlugin{contextPlugin}), "ui-sidebar") {
		t.Error("没停用 Deck 时不碰官方侧栏行")
	}
	if got := replacementRows[SidebarDeckBundle]; len(got) != 1 || got[0] != "ui-sidebar" {
		t.Errorf("Deck 的接管行关系固定: got %v", got)
	}

	// 同一接管插件出现两次（状态文件去重前的防御）：重新启用行只追加一次。
	if got := RenderCombinedDisabledPatch(nil, []DisabledPlugin{deckPlugin, deckPlugin}); got != "- id: dsh-sidebar-deck\n  disabled: true\n- id: ui-sidebar\n  disabled: false\n" {
		t.Errorf("重复条目按行 id 去重: got %q", got)
	}
}

func TestSidebarDeckPatch(t *testing.T) {
	patch := RenderSidebarDeckPatch()
	if !strings.Contains(patch, "- id: ui-sidebar\n  disabled: true") {
		t.Error("Deck 接管补丁停用官方侧栏")
	}
	if !strings.Contains(patch, "- id: dsh-sidebar-deck\n") {
		t.Error("Deck 接管补丁插入自己")
	}

	deckPlugin := disabled(SidebarDeckBundle, SidebarDeckBundle)
	if !IsSidebarDeckDisabled([]DisabledPlugin{deckPlugin}) {
		t.Error("状态里能识别 Deck 被用户停用")
	}
	if IsSidebarDeckDisabled([]DisabledPlugin{disabled("dsh-context", "dsh-context")}) {
		t.Error("其它插件停用不影响 Deck 判定")
	}

	dir := t.TempDir()
	path, err := StagedSidebarDeckPatchFile(dir)
	if err != nil {
		t.Fatalf("Deck 接管补丁应能写入临时目录: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取落盘补丁: %v", err)
	}
	if string(data) != RenderSidebarDeckPatch() {
		t.Errorf("Deck 接管补丁能落盘且内容一致: got %q", string(data))
	}
	if filepath.Base(path) != SidebarDeckPatchFileName {
		t.Errorf("落盘文件名: got %q", filepath.Base(path))
	}
}

func TestDisabledStatePaths(t *testing.T) {
	home := t.TempDir()
	if got := DisabledStatePath(home); !strings.HasSuffix(filepath.ToSlash(got), "/plugin-manager/disabled.json") {
		t.Errorf("状态文件落点在 $DSH_HOME/plugin-manager/disabled.json: got %q", got)
	}
	if filepath.Base(DisabledPatchDir(home)) != "plugin-manager" {
		t.Error("overlay 与状态文件在同一目录")
	}
}

func TestSafeBundleName(t *testing.T) {
	if SafeBundleName("../evil") {
		t.Error("bundle 名拒绝路径穿越")
	}
	if !SafeBundleName("@scope/name") {
		t.Error("正常 scoped 包名放行")
	}
	if SafeBundleName("") {
		t.Error("空 bundle 名拒绝")
	}
	if SafeBundleName("bad name") {
		t.Error("含空白等非法字符的 bundle 名拒绝")
	}
	if SafeBundleName(strings.Repeat("a", 129)) {
		t.Error("超长 bundle 名拒绝")
	}
}

func TestSafeRowID(t *testing.T) {
	if SafeRowID("") || SafeRowID("bad\ninjected") || SafeRowID(strings.Repeat("a", 129)) {
		t.Error("不安全的行 id 必须拒绝")
	}
	for _, ok := range []string{"dsh-context", "ui-sidebar", "@a/b", "a.b:c/d-e_f"} {
		if !SafeRowID(ok) {
			t.Errorf("安全行 id %q 不应被拒", ok)
		}
	}
}

func TestReadDisabledState(t *testing.T) {
	home := t.TempDir()
	statePath := DisabledStatePath(home)

	if got := ReadDisabledState(statePath); len(got) != 0 {
		t.Errorf("状态文件不存在时按没有停用处理: got %v", got)
	}

	if err := os.MkdirAll(DisabledPatchDir(home), 0o755); err != nil {
		t.Fatal(err)
	}
	state := `{
  "version": 1,
  "updatedAt": "2026-11-11T00:00:00Z",
  "disabled": [
    { "bundle": "dsh-context", "rowIds": ["dsh-context", "bad\ninjected"], "disabledAt": "t" },
    { "bundle": "dsh-plugin-manager", "rowIds": ["dsh-plugin-manager"], "disabledAt": "t" },
    { "bundle": "@deepseek-ai/dsh-base", "rowIds": ["session"], "disabledAt": "t" },
    { "bundle": "../evil", "rowIds": ["x"], "disabledAt": "t" },
    { "bundle": "empty-rows", "rowIds": [], "disabledAt": "t" },
    { "bundle": "dsh-context", "rowIds": ["duplicate"], "disabledAt": "t" }
  ]
}`
	if err := os.WriteFile(statePath, []byte(state), 0o644); err != nil {
		t.Fatal(err)
	}
	readBack := ReadDisabledState(statePath)
	if len(readBack) != 1 {
		t.Fatalf("只保留合法、去重、含安全行 id 的记录，实际 %d 条", len(readBack))
	}
	if readBack[0].Bundle != "dsh-context" {
		t.Errorf("保留合法的 bundle: got %q", readBack[0].Bundle)
	}
	if strings.Join(readBack[0].RowIDs, ",") != "dsh-context" {
		t.Errorf("不安全行 id 被过滤: got %v", readBack[0].RowIDs)
	}

	if err := os.WriteFile(statePath, []byte("[not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ReadDisabledState(statePath); len(got) != 0 {
		t.Errorf("畸形 JSON 不能让启动器变成故障源: got %v", got)
	}
}

func TestStagedDisabledPatchFile(t *testing.T) {
	home := t.TempDir()
	dir := DisabledPatchDir(home)

	if path, err := StagedDisabledPatchFile(nil, nil, dir); path != "" || err != nil {
		t.Errorf("没有停用项时不产出 overlay: got (%q, %v)", path, err)
	}

	path, err := StagedDisabledPatchFile(nil, []DisabledPlugin{disabled("dsh-context", "dsh-context")}, dir)
	if err != nil {
		t.Fatalf("有停用项时产出 overlay 文件: %v", err)
	}
	if filepath.Base(path) != DisabledPatchFileName {
		t.Errorf("overlay 文件名: got %q", filepath.Base(path))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "- id: dsh-context\n  disabled: true\n" {
		t.Errorf("overlay 是可被 dsh 解析的顶格 YAML 列表: got %q", string(data))
	}

	// 写不进去时返回错误（宁可不停用，也不递半截文件给 dsh）。
	blocked := filepath.Join(home, "file-not-dir")
	if err := os.WriteFile(blocked, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if path, err := StagedDisabledPatchFile(nil, []DisabledPlugin{disabled("dsh-context", "dsh-context")}, filepath.Join(blocked, "sub")); err == nil || path != "" {
		t.Errorf("写不进去时返回错误: got (%q, %v)", path, err)
	}
}

// TestStageBootPatches walks the per-boot gates: base readability, deck
// fail-open (missing resources / user disabled / write failure) and the
// disabled overlay's empty-vs-staged outcomes.
func TestStageBootPatches(t *testing.T) {
	t.Run("没有任何资源时全部退回", func(t *testing.T) {
		base, deck, disabledPatch, notes := StageBootPatches(filepath.Join(t.TempDir(), "plugins"), t.TempDir(), false)
		if base != "" || deck != "" || disabledPatch != "" {
			t.Errorf("空资源应全空: got (%q, %q, %q)", base, deck, disabledPatch)
		}
		if len(notes) != 1 || !strings.Contains(notes[0], "侧栏 Deck 未启用") {
			t.Errorf("默认关闭要有日志: %v", notes)
		}
	})

	t.Run("Deck 就绪且无停用时三个槽位齐全", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())

		base, deck, disabledPatch, notes := StageBootPatches(plugins, home, true)
		if base != filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml") {
			t.Errorf("base = %q", base)
		}
		if deck != filepath.Join(DisabledPatchDir(home), SidebarDeckPatchFileName) {
			t.Errorf("deck = %q", deck)
		}
		if disabledPatch != "" {
			t.Errorf("无停用项时 disabled = %q", disabledPatch)
		}
		if len(notes) != 1 || !strings.Contains(notes[0], "侧栏 Deck 接管补丁：") {
			t.Errorf("Deck staging 要有日志: %v", notes)
		}
		data, err := os.ReadFile(deck)
		if err != nil || string(data) != RenderSidebarDeckPatch() {
			t.Errorf("落盘的 Deck 补丁内容: (%q, %v)", string(data), err)
		}
	})

	t.Run("用户停用 Deck 时退回官方侧栏并产出停用层", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())
		write(t, DisabledStatePath(home), `{"version":1,"disabled":[{"bundle":"dsh-sidebar-deck","rowIds":["dsh-sidebar-deck"],"disabledAt":"t"},{"bundle":"dsh-context","rowIds":["dsh-context"],"disabledAt":"t"}]}`)

		base, deck, disabledPatch, notes := StageBootPatches(plugins, home, true)
		if base == "" || deck != "" {
			t.Errorf("Deck 停用后应退回官方侧栏: got (%q, %q)", base, deck)
		}
		if !strings.Contains(notes[0], "侧栏 Deck 已被用户停用") {
			t.Errorf("Deck 停用要有日志: %v", notes)
		}
		if disabledPatch == "" {
			t.Fatal("停用层应当落盘")
		}
		data, err := os.ReadFile(disabledPatch)
		if err != nil {
			t.Fatal(err)
		}
		want := "- id: dsh-sidebar-deck\n  disabled: true\n- id: dsh-context\n  disabled: true\n- id: ui-sidebar\n  disabled: false\n"
		if string(data) != want {
			t.Errorf("停用层内容: got %q want %q", string(data), want)
		}
		if !strings.Contains(notes[1], "插件停用覆盖层：") || !strings.Contains(notes[1], "dsh-sidebar-deck、dsh-context") {
			t.Errorf("停用层要有日志: %v", notes)
		}
	})

	t.Run("base patch 不可读时不传 base", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())

		base, deck, _, notes := StageBootPatches(plugins, home, true)
		if base != "" {
			t.Errorf("base = %q", base)
		}
		if deck == "" {
			t.Error("deck 不受 base 缺失影响")
		}
		if len(notes) != 1 {
			t.Errorf("notes = %v", notes)
		}
	})

	t.Run("Deck 补丁写失败时退回官方侧栏", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())
		// plugin-manager 被同名文件占用：MkdirAll 失败，Deck 补丁落不了盘。
		write(t, DisabledPatchDir(home), "not a directory")

		base, deck, _, notes := StageBootPatches(plugins, home, true)
		if base != filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml") {
			t.Errorf("base = %q", base)
		}
		if deck != "" {
			t.Errorf("Deck 写失败必须退回官方侧栏: got %q", deck)
		}
		if len(notes) != 1 || !strings.Contains(notes[0], "侧栏 Deck 接管补丁写入失败") {
			t.Errorf("Deck 写失败要有日志: %v", notes)
		}
	})

	t.Run("停用覆盖层临时文件写失败时降级并记录", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())
		write(t, DisabledStatePath(home), `{"disabled":[{"bundle":"dsh-context","rowIds":["dsh-context"],"disabledAt":"t"}]}`)
		// overlay 的临时文件路径被目录占用：写 tmp 失败，停用层落不了盘。
		if err := os.MkdirAll(filepath.Join(DisabledPatchDir(home), DisabledPatchFileName+".tmp"), 0o755); err != nil {
			t.Fatal(err)
		}

		base, deck, disabledPatch, notes := StageBootPatches(plugins, home, true)
		if base != filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml") {
			t.Errorf("base = %q", base)
		}
		if deck == "" || disabledPatch != "" {
			t.Errorf("Deck 正常、停用层写失败必须退回: got (%q, %q)", deck, disabledPatch)
		}
		if len(notes) != 2 || !strings.Contains(notes[0], "侧栏 Deck 接管补丁：") || !strings.Contains(notes[1], "停用覆盖层写入失败") {
			t.Errorf("写失败要有日志: %v", notes)
		}
	})

	t.Run("停用覆盖层改名失败时清理临时文件并降级", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())
		write(t, DisabledStatePath(home), `{"disabled":[{"bundle":"dsh-context","rowIds":["dsh-context"],"disabledAt":"t"}]}`)
		// 目标 overlay 路径被目录占用：tmp 能写进去，rename 失败，必须清掉 tmp。
		if err := os.MkdirAll(filepath.Join(DisabledPatchDir(home), DisabledPatchFileName), 0o755); err != nil {
			t.Fatal(err)
		}

		_, _, disabledPatch, notes := StageBootPatches(plugins, home, true)
		if disabledPatch != "" {
			t.Errorf("改名失败必须退回: got %q", disabledPatch)
		}
		if len(notes) != 2 || !strings.Contains(notes[0], "侧栏 Deck 接管补丁：") || !strings.Contains(notes[1], "停用覆盖层写入失败") {
			t.Errorf("写失败要有日志: %v", notes)
		}
		leftovers, err := filepath.Glob(filepath.Join(DisabledPatchDir(home), "*.tmp"))
		if err != nil || len(leftovers) != 0 {
			t.Errorf("失败后不得留下临时文件: %v (%v)", leftovers, err)
		}
	})

	// Deck 还在优化期：默认关——资源就绪也不接管，官方侧栏原样。
	t.Run("默认关闭：资源就绪也不接管官方侧栏", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())

		base, deck, _, notes := StageBootPatches(plugins, home, false)
		if base != filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml") {
			t.Errorf("base = %q", base)
		}
		if deck != "" {
			t.Errorf("默认必须使用官方侧栏: deck = %q", deck)
		}
		if len(notes) != 1 || !strings.Contains(notes[0], "侧栏 Deck 未启用") {
			t.Errorf("默认关闭要有日志: %v", notes)
		}
		// 接管补丁文件也不得落盘（staging 只发生在启用时）。
		if _, err := os.Stat(filepath.Join(DisabledPatchDir(home), SidebarDeckPatchFileName)); !os.IsNotExist(err) {
			t.Errorf("未启用时不得写接管补丁: %v", err)
		}
	})

	// 开了设置但 Deck 资源缺失：同样退回官方侧栏（fail open）。
	t.Run("启用但资源缺失退回官方侧栏", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")

		base, deck, _, notes := StageBootPatches(plugins, home, true)
		if base == "" || deck != "" {
			t.Errorf("资源缺失应保留 base、退回 deck: got (%q, %q)", base, deck)
		}
		if len(notes) != 1 || !strings.Contains(notes[0], "未找到侧栏 Deck 资源") {
			t.Errorf("缺资源要有日志: %v", notes)
		}
	})

	// 开了设置但用户在面板里明确停用：仍退回官方侧栏，停用层含回启行。
	t.Run("启用但面板停用仍退回官方侧栏", func(t *testing.T) {
		plugins, home := t.TempDir(), t.TempDir()
		write(t, filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml"), "- insert:\n")
		write(t, filepath.Join(plugins, "DSHSidebarDeck", "cordis.patch.yml"), RenderSidebarDeckPatch())
		write(t, DisabledStatePath(home), `{"disabled":[{"bundle":"dsh-sidebar-deck","rowIds":["dsh-sidebar-deck"],"disabledAt":"t"}]}`)

		_, deck, disabledPatch, notes := StageBootPatches(plugins, home, true)
		if deck != "" {
			t.Errorf("面板停用后退回官方侧栏: deck = %q", deck)
		}
		if disabledPatch == "" {
			t.Fatal("停用层应当落盘")
		}
		data, err := os.ReadFile(disabledPatch)
		if err != nil {
			t.Fatal(err)
		}
		if want := "- id: dsh-sidebar-deck\n  disabled: true\n- id: ui-sidebar\n  disabled: false\n"; string(data) != want {
			t.Errorf("停用层内容: got %q want %q", string(data), want)
		}
		if !strings.Contains(notes[0], "侧栏 Deck 已被用户停用") {
			t.Errorf("停用日志: %v", notes)
		}
	})
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestComposeBundledBasePatch(t *testing.T) {
	base := "- insert:\n    - id: dsh-archive-manager\n"
	extra := "- insert:\n    - id: dsh-interrupted-dot\n"
	got := ComposeBundledBasePatch(base, extra)
	if got != base+extra {
		t.Errorf("combine = %q", got)
	}
	// 缺行尾换行时必须补上，否则两条 YAML 会粘成一行。
	if got := ComposeBundledBasePatch("- insert:\n", extra); got != "- insert:\n"+extra {
		t.Errorf("missing newline not normalized: %q", got)
	}
	if got := ComposeBundledBasePatch("", extra); got != extra {
		t.Errorf("empty base = %q", got)
	}
	if got := ComposeBundledBasePatch(base, ""); got != base {
		t.Errorf("empty extra = %q", got)
	}
}

func TestStageBootPatchesComposesInterruptedDot(t *testing.T) {
	plugins, home := t.TempDir(), t.TempDir()
	basePath := filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml")
	extraPath := filepath.Join(plugins, "DSHInterruptedDot", "cordis.patch.yml")
	write(t, basePath, "- insert:\n    - id: dsh-archive-manager\n")
	write(t, extraPath, "- insert:\n    - id: dsh-interrupted-dot\n")

	base, _, _, _ := StageBootPatches(plugins, home, false)
	if base != filepath.Join(DisabledPatchDir(home), BundledBasePatchFileName) {
		t.Fatalf("base = %q", base)
	}
	data, err := os.ReadFile(base)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	for _, want := range []string{"dsh-archive-manager", "dsh-interrupted-dot"} {
		if !strings.Contains(text, want) {
			t.Errorf("composed base missing %q: %q", want, text)
		}
	}
}

func TestStageBootPatchesFallsBackWhenExtraPatchCannotStage(t *testing.T) {
	plugins, home := t.TempDir(), t.TempDir()
	basePath := filepath.Join(plugins, "DSHArchiveManager", "cordis.patch.yml")
	write(t, basePath, "- insert:\n    - id: dsh-archive-manager\n")
	write(t, filepath.Join(plugins, "DSHInterruptedDot", "cordis.patch.yml"), "- insert:\n    - id: dsh-interrupted-dot\n")
	// plugin-manager 被同名文件占用：合成 base 写不出去，必须退回原 base。
	write(t, DisabledPatchDir(home), "not a directory")

	base, _, _, notes := StageBootPatches(plugins, home, false)
	if base != basePath {
		t.Errorf("write failure must fall back to the shared base: %q", base)
	}
	if !strings.Contains(strings.Join(notes, "\n"), "异常结束状态点插件补丁合并失败") {
		t.Errorf("missing fallback note: %v", notes)
	}
}
