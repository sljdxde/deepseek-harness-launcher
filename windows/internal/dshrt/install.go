// Install orchestrates a dsh runtime install, ported from
// DSHRuntimeSupport.install: snapshot recovery first, then registry
// fallback attempts, each npm run staged into runtime.installing-*, each
// attempt validated (health check + `dsh --version` self-test), and the
// staging directory swapped into the fixed runtime atomically.
package dshrt

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/nodeenv"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

// InstallOptions is one install request.
type InstallOptions struct {
	// NpmPath is the npm entry to run (a .cmd shim or an exe).
	NpmPath string
	// Environment is the base environment (see nodeenv.NodeEnvironment).
	Environment map[string]string
	// Force reinstalls even though a healthy runtime is present (the
	// bundled lockfile updated and the user agreed).
	Force bool
	// PackageSpec installs an explicit version ("@deepseek-ai/dsh@0.2.0")
	// instead of the bundled pin — a menu-triggered dsh update. It wins
	// over the bundled lockfile, and keeps the old runtime as a rollback
	// snapshot until the new version proves it starts.
	PackageSpec string
	// OnOutput receives npm output chunks as they stream (progress
	// window + log).
	OnOutput func(string)
}

// installError carries the npm output tail for the failure dialog.
type installError struct {
	message string
	tail    string
}

func (e *installError) Error() string {
	if e.tail == "" {
		return e.message
	}
	return e.message + "：\n" + e.tail
}

// MaxCapturedOutputBytes bounds the retained npm output: only the tail
// is ever surfaced (error dialogs keep the last 6000 characters), so the
// whole stream is never buffered.
const MaxCapturedOutputBytes = 8 * 1024 * 1024

const failureTailChars = 6000

// Install runs the install to completion. It returns the executable
// path of the (possibly recovered) runtime, or an error describing what
// went wrong — cancellations surface as ErrCancelled.
func Install(ctx context.Context, opts InstallOptions) (string, error) {
	onOutput := opts.OnOutput
	if onOutput == nil {
		onOutput = func(string) {}
	}

	// When a previous install/update was interrupted mid-swap, the live
	// runtime survives only as a snapshot (runtime.previous-* /
	// runtime.rollback). Swap it back before deciding anything: it is the
	// one working environment the user has, and reinstalling would push
	// them from "the old one still runs" to "nothing runs" on a network
	// failure.
	if !IsInstalled() && HasRuntimeSnapshot() && RestoreRuntimeSnapshot() {
		onOutput("检测到上次运行环境更新未完成，已从快照恢复现有运行环境\n")
	}
	if IsInstalled() && !opts.Force {
		onOutput("已检测到完整 dsh runtime，跳过 npm 下载\n")
		return ExecutablePath(), nil
	}
	if opts.Force {
		if opts.PackageSpec != "" {
			onOutput(fmt.Sprintf("开始安装 %s（npm install，指定版本）\n", opts.PackageSpec))
		} else {
			onOutput("检测到新的 dsh 版本，开始低内存更新（npm ci，锁定版本）\n")
		}
	}

	root := DSHHome()
	if err := os.MkdirAll(root, 0o755); err != nil {
		return "", err
	}
	CleanupInterruptedInstalls()

	registries := nodeenv.RegistryCandidates(opts.Environment, "")
	for index, registry := range registries {
		last := index == len(registries)-1
		err := installAttempt(ctx, opts, onOutput, registry)
		switch {
		case err == nil:
			onOutput(fmt.Sprintf("npm 安装完成，registry：%s\n", registry))
			return ExecutablePath(), nil
		case errors.Is(err, ErrCancelled):
			return "", ErrCancelled
		case last:
			return "", err
		default:
			onOutput(fmt.Sprintf("registry %s 安装失败，准备尝试备用源…\n", registry))
		}
	}
	// registries must be non-empty (RegistryCandidates never returns nil)
	return "", &installError{message: "所有 npm registry 均安装失败，请检查网络后重试"}
}

func installAttempt(ctx context.Context, opts InstallOptions, onOutput func(string), registry string) error {
	staging := filepath.Join(DSHHome(), "runtime.installing-"+fmt.Sprint(os.Getpid())+"-"+uuid())
	onOutput(fmt.Sprintf("尝试 npm registry：%s\n", registry))

	// Prefer the bundled lockfile: `npm ci` replays the already-resolved
	// dependency set instead of re-running npm's memory-hungry peer
	// resolution, cutting first-install peak RSS from ~3GB to well under
	// 1GB. Only staging gets the spec; the fixed runtime is still swapped
	// in atomically. An explicit PackageSpec wins over the bundled pin.
	if opts.PackageSpec == "" && HasBundledSpec() {
		if err := os.MkdirAll(staging, 0o755); err != nil {
			return err
		}
		pkg, lock := bundledPackageJSON, bundledLockJSON
		if BundledPackageOverride != nil {
			pkg = BundledPackageOverride
		}
		if BundledLockOverride != nil {
			lock = BundledLockOverride
		}
		if err := os.WriteFile(filepath.Join(staging, "package.json"), pkg, 0o644); err != nil {
			onOutput("bundled runtime 规格复制失败，回退到完整 npm 解析：" + err.Error() + "\n")
			_ = os.RemoveAll(staging)
		} else if err := os.WriteFile(filepath.Join(staging, "package-lock.json"), lock, 0o644); err != nil {
			onOutput("bundled runtime 规格复制失败，回退到完整 npm 解析：" + err.Error() + "\n")
			_ = os.RemoveAll(staging)
		}
	}

	var args []string
	// A version-targeted install chases a freshly published version;
	// cached packuments predate it and prefer-offline serves them WITHOUT
	// revalidation, turning resolution into a phantom ETARGET ("no
	// matching version") even though the registry has the package. Such
	// installs must revalidate metadata; lockfile replay and the bare
	// fallback keep prefer-offline for cache hits.
	preferOffline := opts.PackageSpec == ""
	lockPresent := hasDir(staging) && fileExists(filepath.Join(staging, "package-lock.json"))
	if lockPresent {
		args = []string{
			"ci", "--prefix", staging,
			"--no-audit", "--no-fund", "--prefer-offline",
			"--registry", registry,
		}
	} else {
		spec := opts.PackageSpec
		if spec == "" {
			spec = "@deepseek-ai/dsh"
		}
		offlineFlag := "--prefer-offline"
		if !preferOffline {
			offlineFlag = "--no-prefer-offline"
		}
		args = []string{
			"install", "--prefix", staging,
			"--no-package-lock", "--no-audit", "--no-fund", "--progress",
			offlineFlag,
			"--registry", registry,
			spec,
		}
	}

	attemptEnv := map[string]string{}
	for k, v := range opts.Environment {
		attemptEnv[k] = v
	}
	attemptEnv["npm_config_registry"] = registry
	if preferOffline {
		attemptEnv["npm_config_prefer_offline"] = "true"
	} else {
		attemptEnv["npm_config_prefer_offline"] = "false"
	}
	attemptEnv["npm_config_progress"] = "true"
	attemptEnv["npm_config_color"] = "false"
	// The progress window parses npm's resolution/download/install events
	// (placeDep, ADD, http fetch, reify) for its percentage; those lines
	// are emitted at silly level only. The full log stays available for
	// debugging failed installs.
	attemptEnv["npm_config_loglevel"] = "silly"
	// Resolving the 100+ package dsh tree needs more than Node's default
	// heap; cap V8 old space at the tuned ceiling. A ceiling, not a
	// preallocation; existing NODE_OPTIONS survive.
	existing := attemptEnv["NODE_OPTIONS"]
	attemptEnv["NODE_OPTIONS"] = joinNonEmpty(existing, fmt.Sprintf("--max-old-space-size=%d", NpmMaxOldSpaceSizeMB))

	cmd := proc.CommandContext(ctx, opts.NpmPath, args...)
	cmd.Dir = DSHHome()
	cmd.Env = flattenEnv(attemptEnv)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = os.RemoveAll(staging)
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		_ = os.RemoveAll(staging)
		return err
	}

	var capture []byte
	var captureMu sync.Mutex
	appendCapture := func(data []byte) {
		captureMu.Lock()
		defer captureMu.Unlock()
		capture = append(capture, data...)
		if len(capture) > MaxCapturedOutputBytes {
			capture = capture[len(capture)-MaxCapturedOutputBytes:]
		}
	}
	pump := func(r io.Reader) {
		reader := bufio.NewReaderSize(r, 64*1024)
		buf := make([]byte, 64*1024)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				appendCapture(chunk)
				onOutput(string(chunk))
			}
			if err != nil {
				return
			}
		}
	}

	if err := cmd.Start(); err != nil {
		_ = os.RemoveAll(staging)
		return err
	}
	var pumpWg sync.WaitGroup
	pumpWg.Add(2)
	go func() { defer pumpWg.Done(); pump(stdout) }()
	go func() { defer pumpWg.Done(); pump(stderr) }()

	waitErr := cmd.Wait()
	pumpWg.Wait()

	if ctx.Err() != nil {
		_ = os.RemoveAll(staging)
		return ErrCancelled
	}

	output := strings.TrimSpace(string(capture))
	if waitErr != nil {
		_ = os.RemoveAll(staging)
		return &installError{message: "npm 安装 dsh 失败", tail: tailChars(output)}
	}
	if !runtimeIsHealthy(staging) {
		_ = os.RemoveAll(staging)
		return errors.New("npm 安装完成，但未找到 dsh 可执行文件")
	}
	if err := validateStaged(ctx, staging, attemptEnv); err != nil {
		_ = os.RemoveAll(staging)
		return err
	}

	// atomic swap: the old runtime moves aside, staging takes its place
	root := DSHHome()
	if hasDir(RuntimeDir()) {
		backup := filepath.Join(root, "runtime.previous-"+uuid())
		if err := os.Rename(RuntimeDir(), backup); err != nil {
			_ = os.RemoveAll(staging)
			return err
		}
		if err := os.Rename(staging, RuntimeDir()); err != nil {
			_ = os.Rename(backup, RuntimeDir())
			return err
		}
		if opts.PackageSpec != "" {
			// version-targeted update: keep the old runtime as the
			// rollback snapshot until the new version proves it starts
			// (the caller discards the snapshot after a healthy start)
			_ = os.RemoveAll(RollbackDir())
			if err := os.Rename(backup, RollbackDir()); err != nil {
				onOutput("回退快照保留失败（不影响本次更新）：" + err.Error() + "\n")
				_ = os.RemoveAll(backup)
			}
		} else {
			_ = os.RemoveAll(backup)
		}
	} else {
		if err := os.Rename(staging, RuntimeDir()); err != nil {
			return err
		}
	}
	return nil
}

// validateStaged runs the staged dsh once (`--version`) before it is
// trusted with the swap.
func validateStaged(ctx context.Context, staging string, env map[string]string) error {
	staged := filepath.Join(staging, "node_modules", ".bin", "dsh.cmd")
	if _, err := os.Stat(staged); err != nil {
		staged = filepath.Join(staging, "node_modules", ".bin", "dsh")
	}
	cmd := proc.CommandContext(ctx, staged, "--version")
	cmd.Dir = DSHHome()
	cmd.Env = flattenEnv(env)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("安装后的 dsh 自检失败：%s", strings.TrimSpace(string(output)))
	}
	return nil
}

// tailChars keeps the last N characters of npm output for a failure
// dialog.
func tailChars(output string) string {
	runes := []rune(output)
	if len(runes) > failureTailChars {
		return string(runes[len(runes)-failureTailChars:])
	}
	return output
}

func joinNonEmpty(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, " ")
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func flattenEnv(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}
