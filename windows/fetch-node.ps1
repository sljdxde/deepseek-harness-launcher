# fetch-node.ps1 - downloads the portable Node runtime next to the exe,
# the way the release packaging does it. The launcher looks for
# <exeDir>\node\node.exe first, so this makes a dev build self-contained
# (no system Node needed).
#
# The downloaded zip is ALSO kept at build\node.zip: build.ps1 embeds it
# into the exe (internal/selfinstall/assets/node.zip), because the exe is
# its own installer — a single file has to carry the Node it installs.
#
# Usage:  powershell -ExecutionPolicy Bypass -File fetch-node.ps1 [-Version v22.14.0] [-Out build]
# Source: npmmirror's binary mirror first (fast in China), nodejs.org as
# the fallback.

param(
    # The pinned dsh needs Node >= 24.9, and the dev bundle (build\node)
    # carries v24.22.2 — the zip the exe embeds must be the same
    # generation, or a fresh install gets a Node the dsh refuses.
    [string]$Version = "v24.22.2",
    [string]$Out = "build"
)

$ErrorActionPreference = "Stop"
$winDir = $PSScriptRoot
$nodeDir = Join-Path $winDir "$Out\node"
$zipKeep = Join-Path $winDir "$Out\node.zip"

if (-not (Test-Path $zipKeep)) {
    $zipName = "node-$Version-win-x64.zip"
    $urls = @(
        "https://registry.npmmirror.com/-/binary/node/$Version/$zipName",
        "https://nodejs.org/dist/$Version/$zipName"
    )
    $zipPath = Join-Path $env:TEMP $zipName

    $downloaded = $false
    foreach ($u in $urls) {
        Write-Host "==> fetching $u"
        try {
            Invoke-WebRequest -Uri $u -OutFile $zipPath -UseBasicParsing
            $downloaded = $true
            break
        } catch {
            Write-Host "    failed: $($_.Exception.Message)"
        }
    }
    if (-not $downloaded) { throw "fetch-node.ps1: all mirrors failed" }
    New-Item (Split-Path $zipKeep -Parent) -ItemType Directory -Force | Out-Null
    Move-Item $zipPath $zipKeep -Force
}

# The go:embed directive in internal/selfinstall reads the zip from INSIDE
# the package (assets/node.zip) — go:embed cannot reference files outside
# the package directory. Mirror the cached zip there on every run, so
# `go vet` / `go build` work right after this script (ci.yml fetches node
# before vet for exactly this reason; build.ps1 re-syncs the same file).
$zipEmbed = Join-Path $winDir (Join-Path "internal" (Join-Path "selfinstall" (Join-Path "assets" "node.zip")))
New-Item (Split-Path $zipEmbed -Parent) -ItemType Directory -Force | Out-Null
Copy-Item $zipKeep $zipEmbed -Force

if (Test-Path (Join-Path $nodeDir "node.exe")) {
    Write-Host "==> node already at $nodeDir (zip kept at $zipKeep)"
    & (Join-Path $nodeDir "node.exe") --version
    exit 0
}

$tmp = Join-Path $env:TEMP ("node-extract-" + [guid]::NewGuid().ToString("N"))
Expand-Archive -Path $zipKeep -DestinationPath $tmp -Force
New-Item $nodeDir -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $tmp "node-$Version-win-x64\*") $nodeDir -Recurse -Force
Remove-Item $tmp -Recurse -Force
Write-Host "==> node installed at $nodeDir (zip kept at $zipKeep)"
& (Join-Path $nodeDir "node.exe") --version
