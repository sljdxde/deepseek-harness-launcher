# build.ps1 — the Windows launcher's build entry, the counterpart of the
# macOS scripts/build-app.sh.
#
# What it does, in order:
#   1. reads the version out of Resources/Info.plist (the same single
#      source of truth the macOS build and bump-version.sh keep in sync);
#   2. syncs the shared assets this repo's macOS build uses (the iconset
#      PNGs, the menubar creature) into windows/assets, and builds the
#      tray's multi-size .ico from the iconset;
#   3. writes winres.json (icon group + manifest + version info) and
#      compiles it into a .syso via go-winres, so the exe carries the
#      brand icon, a per-monitor-v2 manifest, and the plist version;
#   4. go build with -H windowsgui (no console window) and the version
#      injected.
#
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1 [-Out build\DHL.exe]
# Prereq: Go 1.26+ on PATH (network reaches goproxy.cn the first time for
#         go-winres).

param(
    [string]$Out = "build\DHL.exe"
)

$ErrorActionPreference = "Stop"

$winDir = $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $winDir "..")
$plistPath = Join-Path $repoRoot "Resources\Info.plist"
$iconsetDir = Join-Path $repoRoot "Resources\icons\candidate-upstream\DHL.iconset"
$assetsDir = Join-Path $winDir "assets"

# --- 0. go ---------------------------------------------------------------------

# go is often not on a plain PowerShell's PATH; look in the usual
# per-user install spot before giving up.
$go = "go"
if (-not (Get-Command $go -ErrorAction SilentlyContinue)) {
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\go\bin\go.exe"
    if (Test-Path $candidate) {
        $go = $candidate
    } else {
        throw "build.ps1: go is not on PATH and not at $candidate - install Go 1.26+ first"
    }
}

# --- 1. version ----------------------------------------------------------------

$plist = Get-Content $plistPath -Raw
if ($plist -notmatch 'CFBundleShortVersionString</key>\s*<string>([^<]+)</string>') {
    throw "build.ps1: cannot read CFBundleShortVersionString from $plistPath"
}
$version = $Matches[1]
Write-Host "==> version $version (from Resources/Info.plist)"

# numeric file version for the VERSIONINFO resource: the base x.y.z with a
# trailing .0; the -a.b cycle numbers stay in ProductVersion's string.
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)') {
    throw "build.ps1: version '$version' does not start with x.y.z"
}
$fileVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"

# --- 2. assets -----------------------------------------------------------------

$iconsOut = Join-Path $assetsDir "icons"
New-Item $iconsOut -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $iconsetDir "icon_16x16.png") (Join-Path $iconsOut "icon-16.png") -Force
Copy-Item (Join-Path $iconsetDir "icon_32x32.png") (Join-Path $iconsOut "icon-32.png") -Force
Copy-Item (Join-Path $iconsetDir "icon_32x32@2x.png") (Join-Path $iconsOut "icon-64.png") -Force
Copy-Item (Join-Path $iconsetDir "icon_128x128.png") (Join-Path $iconsOut "icon-128.png") -Force
Copy-Item (Join-Path $iconsetDir "icon_256x256.png") (Join-Path $iconsOut "icon-256.png") -Force
Write-Host "==> icons synced into windows/assets/icons"

# tray.ico from the iconset (committed one regenerated only when sizes
# change; regenerating is cheap, so always do)
Push-Location $winDir

# the bundled dsh plugins are embedded into the exe; sync them from the
# repo's shared Plugins/ so both platforms ship the same code.
#
# DSHSidebarDeck is NOT in this list any more: macOS removed the takeover
# sidebar in 0.4.0 (Plugins/DSHSidebarDeck is gone), while the Windows port
# still ships it as an experimental, default-off option. So the Windows build
# keeps using the copy already committed under internal/assets/plugins/
# instead of syncing it from Plugins/ — until the Windows side follows suit.
$pluginsOut = Join-Path $winDir "internal\assets\plugins"
New-Item $pluginsOut -ItemType Directory -Force | Out-Null
foreach ($name in @("DSHArchiveManager", "DSHPluginManager", "DSHSessionNotify")) {
    Remove-Item (Join-Path $pluginsOut $name) -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $repoRoot "Plugins\$name") $pluginsOut -Recurse -Force
}
Write-Host "==> plugins synced into windows/internal/assets/plugins"

# the dsh runtime spec is embedded too: the lockfile decides which dsh the
# installer pulls, so it must come from the repo's single copy
$runtimeOut = Join-Path $winDir (Join-Path "internal" (Join-Path "dshrt" (Join-Path "assets" "dsh-runtime")))
New-Item $runtimeOut -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $repoRoot "Resources\dsh-runtime\package.json") $runtimeOut -Force
Copy-Item (Join-Path $repoRoot "Resources\dsh-runtime\package-lock.json") $runtimeOut -Force
Write-Host "==> dsh runtime spec synced into windows/internal/dshrt/assets/dsh-runtime"

# the bundled Node rides inside the exe: the exe IS the installer, so a
# single double-click must carry everything a fresh machine needs
# (fetch-node.ps1 keeps the zip at build\node.zip)
$nodeZip = Join-Path $winDir "build\node.zip"
$nodeZipOut = Join-Path $winDir "internal\selfinstall\assets\node.zip"
if (-not (Test-Path $nodeZip)) {
    throw "build.ps1: $nodeZip is missing - run fetch-node.ps1 first (it downloads the zip the exe embeds)"
}
New-Item (Split-Path $nodeZipOut -Parent) -ItemType Directory -Force | Out-Null
Copy-Item $nodeZip $nodeZipOut -Force
Write-Host "==> node.zip synced into windows/internal/selfinstall/assets"

& $go run ./tools/genico -out internal/app/tray.ico `
    (Join-Path $iconsOut "icon-16.png") `
    (Join-Path $iconsOut "icon-32.png") `
    (Join-Path $iconsOut "icon-64.png") `
    (Join-Path $iconsOut "icon-128.png") `
    (Join-Path $iconsOut "icon-256.png")
if ($LASTEXITCODE -ne 0) { throw "build.ps1: genico failed" }
Write-Host "==> tray.ico built"

# The exe's icon resource gets the same full ladder the tray.ico carries:
# Windows asks for 20/24/40/48 too (125%/150% displays), and a group
# missing those makes the shell rescale the nearest entry — the soft,
# stair-stepped icon the user sees in Explorer and Start-menu search.
# genico fills the ladder and can also emit it as PNGs, because winres
# reads PNGs rather than .ico.
$exeIcons = Join-Path $assetsDir "exe-icons"
& $go run ./tools/genico -out (Join-Path $assetsDir "app-full.ico") -pngdir $exeIcons `
    (Join-Path $iconsOut "icon-16.png") `
    (Join-Path $iconsOut "icon-32.png") `
    (Join-Path $iconsOut "icon-64.png") `
    (Join-Path $iconsOut "icon-128.png") `
    (Join-Path $iconsOut "icon-256.png")
if ($LASTEXITCODE -ne 0) { throw "build.ps1: genico failed for the exe icon" }
Write-Host "==> exe icon ladder built"

# --- 3. winres -----------------------------------------------------------------

$winres = @{
    RT_GROUP_ICON = @{
        # ID 1 is the group Explorer shows for the exe. Wails' toast
        # service looks for group id 3 instead, so the same art is
        # published under both ids — otherwise the notification backend
        # logs "cannot load icon from resource with id 3" on every start.
        #
        # One entry per image, largest first: the full ladder genico wrote,
        # so the exe answers an exact size for every box Windows asks for.
        "#1" = @{
            "0000" = @(
                "exe-icons\icon-256.png", "exe-icons\icon-128.png", "exe-icons\icon-64.png",
                "exe-icons\icon-48.png", "exe-icons\icon-40.png", "exe-icons\icon-32.png",
                "exe-icons\icon-24.png", "exe-icons\icon-20.png", "exe-icons\icon-16.png"
            )
        }
        "#3" = @{
            "0000" = @(
                "exe-icons\icon-256.png", "exe-icons\icon-128.png", "exe-icons\icon-64.png",
                "exe-icons\icon-48.png", "exe-icons\icon-40.png", "exe-icons\icon-32.png",
                "exe-icons\icon-24.png", "exe-icons\icon-20.png", "exe-icons\icon-16.png"
            )
        }
    }
    RT_MANIFEST = @{
        "#1" = @{
            "0409" = @{
                identity = @{ name = "com.local.dhl-launcher"; version = "$fileVersion" }
                description = "Deepseek Harness Launcher"
                "minimum-os" = "win10"
                "execution-level" = "as invoker"
                "ui-access" = $false
                "auto-elevate" = $false
                "dpi-awareness" = "per monitor v2"
                "disable-theming" = $false
                "disable-window-filtering" = $false
                "high-resolution-scrolling-aware" = $false
                "ultra-high-resolution-scrolling-aware" = $false
                "long-path-aware" = $true
                "printer-driver-isolation" = $false
                "gdi-scaling" = $false
                "segment-heap" = $false
                "use-common-controls-v6" = $true
            }
        }
    }
    RT_VERSION = @{
        "#1" = @{
            "0000" = @{
                fixed = @{ file_version = "$fileVersion"; product_version = "$fileVersion" }
                info = @{
                    "0409" = @{
                        CompanyName = "Deepseek Harness Launcher"
                        FileDescription = "Deepseek Harness Launcher"
                        LegalCopyright = "MIT"
                        OriginalFilename = "DHL.exe"
                        ProductName = "Deepseek Harness Launcher"
                        # FileVersion is a separate string from ProductVersion:
                        # Explorer's Details tab and install.ps1 both read it,
                        # and go-winres does not fill it in from the fixed
                        # block. Left out, the version shows as blank.
                        FileVersion = "$version"
                        ProductVersion = "$version"
                    }
                }
            }
        }
    }
}
# written without a BOM: go-winres's JSON reader refuses one
$winresJson = $winres | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Join-Path $assetsDir "winres.json"), $winresJson)
& $go run github.com/tc-hib/go-winres@v0.3.3 make --in assets/winres.json --arch amd64 --out rsrc
if ($LASTEXITCODE -ne 0) { throw "build.ps1: go-winres failed" }
Write-Host "==> winres compiled (exe icon + manifest + version $fileVersion)"

# --- 4. build ------------------------------------------------------------------

& $go build -trimpath -buildvcs=false `
    -ldflags "-s -w -H windowsgui -X main.version=$version" `
    -o $Out .
if ($LASTEXITCODE -ne 0) { throw "build.ps1: go build failed" }
Pop-Location
Write-Host "==> built $Out (version $version)"
