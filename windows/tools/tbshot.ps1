param([string]$Out = "$env:TEMP\dhl-tb.png")
Add-Type -Name D -Namespace W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n);
[DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
'@
[void][W.D]::SetProcessDPIAware()
$tray = [W.D]::FindWindow("Shell_TrayWnd", $null)
if ($tray -eq [IntPtr]::Zero) { Write-Host "taskbar not found"; exit 1 }
$r = New-Object W.D+RECT
[void][W.D]::GetWindowRect($tray, [ref]$r)
$w = $r.right - $r.left; $ht = $r.bottom - $r.top
Write-Host ("taskbar ({0},{1}) size {2}x{3}" -f $r.left,$r.top,$w,$ht)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[void][W.D]::PrintWindow($tray, $hdc, 2)
$g.ReleaseHdc($hdc)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host $Out
