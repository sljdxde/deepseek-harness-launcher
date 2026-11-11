param([string]$Out = "$env:TEMP\dhl-screen.png")
Add-Type -Name D -Namespace W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
'@
[void][W.D]::SetProcessDPIAware()
Add-Type -AssemblyName System.Drawing
$w = [W.D]::GetSystemMetrics(0); $h = [W.D]::GetSystemMetrics(1)
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host ("$Out ${w}x${h}")
