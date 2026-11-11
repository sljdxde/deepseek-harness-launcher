//go:build windows

package selfinstall

// embed.go carries the bundled Node. build.ps1 copies the downloaded
// node.zip (fetch-node.ps1 keeps it at build\node.zip) into
// internal/selfinstall/assets/node.zip before compiling, so the single
// released exe installs a launcher that needs no system Node. The file
// is build output, not source: .gitignore covers it, and a build without
// it fails loudly at compile time rather than shipping an exe that
// cannot install its runtime.

import (
	"archive/zip"
	"bytes"
	_ "embed"
)

//go:embed assets/node.zip
var nodeZip []byte

// nodeZipBytes returns the embedded archive.
func nodeZipBytes() ([]byte, error) {
	if len(nodeZip) == 0 {
		return nil, errNodeZipMissing
	}
	return nodeZip, nil
}

// nodeVersionOfZip reads the wrapper directory's version without
// unpacking (node-v24.22.2-win-x64/… → v24.22.2), "" when unreadable.
func nodeVersionOfZip() string {
	data, err := nodeZipBytes()
	if err != nil {
		return ""
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	return nodeVersionFromZip(reader, commonTopDir(reader))
}

var errNodeZipMissing = &nodeZipError{}

type nodeZipError struct{}

func (*nodeZipError) Error() string {
	return "embedded node.zip is missing - run fetch-node.ps1 first (build.ps1 syncs it into internal/selfinstall/assets)"
}
