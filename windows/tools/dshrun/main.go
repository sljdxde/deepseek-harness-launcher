// dshrun reproduces the launcher's dsh child exactly (proc.Command +
// nodeenv environment + the same args) and prints everything the child
// emits, for debugging launch-context failures.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/nodeenv"
	"github.com/sljdxde/deepseek-harness-launcher/windows/internal/proc"
)

func main() {
	node := nodeDir()
	env := nodeenv.NodeEnvironment(node, nil)
	dsh := os.Args[1]
	args := os.Args[2:]
	fmt.Println("node dir:", node)
	fmt.Println("dsh:", dsh, args)

	cmd := proc.Command(dsh, args...)
	cmd.Dir = os.Getenv("USERPROFILE")
	cmd.Env = flatten(env)
	out, err := cmd.CombinedOutput()
	fmt.Printf("--- exit %v ---\n", err)
	fmt.Println(string(out))
}

func nodeDir() string {
	exe, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "node")
		if _, err := os.Stat(filepath.Join(candidate, "node.exe")); err == nil {
			return candidate
		}
	}
	return ""
}

func flatten(env map[string]string) []string {
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}
