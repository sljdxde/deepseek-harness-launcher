# install.ps1 installs the built launcher for the current user.
#
# The macOS side has scripts/install-from-app.sh: stop what is running,
# swap the app bundle in place, keep one backup, and relaunch. This is the
# Windows counterpart. It exists because the launcher locates its bundled
# Node beside the exe (nodeenv's nodeDir), so running DHL.exe straight out
# of build\ works but is not an install: there is no stable path, no
# shortcut, and the next rebuild overwrites the binary under a running
# process.
#
# Install layout, mirroring the macOS bundle:
#
#   %LOCALAPPDATA%\Programs\DHL\
#     DHL.exe
#     node\            bundled Node (required, found beside the exe)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File install.ps1            # install + start
#   powershell -ExecutionPolicy Bypass -File install.ps1 -NoStart   # install only
#   powershell -ExecutionPolicy Bypass -File install.ps1 -From build

param(
    [string]$From = "",
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($From)) { $From = Join-Path $here 'build' }
$From = (Resolve-Path $From).Path

$target = Join-Path $env:LOCALAPPDATA 'Programs\DHL'
$exe = Join-Path $From 'DHL.exe'
$node = Join-Path $From 'node\node.exe'

if (-not (Test-Path $exe)) {
    throw "No DHL.exe in $From - run build.ps1 first."
}
if (-not (Test-Path $node)) {
    throw "No node\node.exe in $From - the launcher needs the bundled Node beside it."
}

# Version is read from the exe's own resource, so what is installed is what
# was built rather than what a file elsewhere claims.
$version = (Get-Item $exe).VersionInfo.ProductVersion
Write-Host "==> installing DHL $version"
Write-Host "    from $From"
Write-Host "    to   $target"

# Stop the running launcher before replacing its binary: Windows refuses to
# overwrite an exe that is executing, and a half-replaced install would be
# worse than a restart. The launcher's own quit path stops dsh as well, so
# this mirrors what a menu Quit does.
function Stop-Dhl {
    $procs = Get-Process -Name DHL -ErrorAction SilentlyContinue
    if ($procs) {
        Write-Host "==> stopping running launcher"
        $procs | ForEach-Object {
            try { $_.CloseMainWindow() | Out-Null } catch { }
        }
        Start-Sleep -Milliseconds 800
        $procs = Get-Process -Name DHL -ErrorAction SilentlyContinue
        if ($procs) {
            $procs | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 400
        }
    }
    # A dsh left behind would keep port 3080 and make the new build adopt an
    # instance running the previous patch file. Stop the ones this install
    # owns: node processes whose command line points at the runtime.
    $runtime = Join-Path $env:USERPROFILE '.dsh\runtime'
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$runtime*" } |
        ForEach-Object {
            Write-Host "==> stopping dsh (pid $($_.ProcessId))"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

Stop-Dhl

# Copy into a staging directory first, then swap, so a failed copy never
# leaves a partially written install (the same staging-then-swap rule the
# dsh runtime installer follows).
$staging = "$target.installing"
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

Write-Host "==> copying files"
Copy-Item $exe (Join-Path $staging 'DHL.exe')
# node\ is ~100 MB and unchanged between builds in practice; copy it whole
# because a partial node tree is unusable.
Copy-Item (Join-Path $From 'node') (Join-Path $staging 'node') -Recurse

# Swap: move the old install aside, promote staging, drop the backup only
# after the promote succeeded.
$backup = $null
if (Test-Path $target) {
    $backup = "$target.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Move-Item $target $backup
}
try {
    Move-Item $staging $target
} catch {
    if ($backup -and (Test-Path $backup)) { Move-Item $backup $target }
    throw "install failed; previous version restored"
}

# One backup only: a directory of them is how disk fills up unnoticed.
Get-ChildItem (Split-Path -Parent $target) -Directory -Filter 'DHL.backup-*' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -ne $backup } |
    ForEach-Object {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "==> removed old backup $($_.Name)"
    }

Write-Host "==> installed to $target"

if (-not $NoStart) {
    Write-Host "==> starting launcher"
    # The launcher writes its own Start-menu shortcut on first start (it
    # points at whatever exe is running, which is now the installed one), so
    # there is no shortcut to create here.
    Start-Process -FilePath (Join-Path $target 'DHL.exe') -WorkingDirectory $target
    Start-Sleep -Seconds 2
    $running = Get-Process -Name DHL -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "==> running (pid $($running[0].Id))"
    } else {
        Write-Warning "the launcher exited right after start; see $env:LOCALAPPDATA\DHL\logs\dhl.log"
    }
}
