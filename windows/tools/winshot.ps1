param([string]$Out = "$env:TEMP\dhl-win.png", [string]$Match = "Deepseek")
Add-Type -Name D -Namespace W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
'@
[void][W.D]::SetProcessDPIAware()
$proc = Get-Process DHL -ErrorAction SilentlyContinue
if (-not $proc) { Write-Host "DHL not running"; exit 1 }
$script:target = [IntPtr]::Zero
$cb = [W.D+EnumProc]{
  param($h, $l)
  $p = 0
  [void][W.D]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -eq $proc.Id -and [W.D]::IsWindowVisible($h)) {
    $t = New-Object System.Text.StringBuilder 256
    [void][W.D]::GetWindowText($h, $t, 256)
    if ($t.ToString() -like "*$Match*") { $script:target = $h; return $false }
  }
  return $true
}
[void][W.D]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:target -eq [IntPtr]::Zero) { Write-Host "no visible window matching '$Match'"; exit 1 }
$r = New-Object W.D+RECT
[void][W.D]::GetWindowRect($script:target, [ref]$r)
$w = $r.right - $r.left; $ht = $r.bottom - $r.top
Write-Host ("found ({0},{1}) size {2}x{3}" -f $r.left,$r.top,$w,$ht)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][W.D]::PrintWindow($script:target, $hdc, 2)
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host $Out
