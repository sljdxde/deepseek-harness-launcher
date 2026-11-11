param([string]$Out = "$env:TEMP\dhl-taskicon.png")
Add-Type -Name D -Namespace W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
'@
[void][W.D]::SetProcessDPIAware()
$proc = Get-Process DHL -ErrorAction SilentlyContinue
$script:hwndTarget = [IntPtr]::Zero
$cb = [W.D+EnumProc]{
  param($h, $l)
  $p = 0
  [void][W.D]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -eq $proc.Id) {
    $t = New-Object System.Text.StringBuilder 256
    [void][W.D]::GetWindowText($h, $t, 256)
    $title = $t.ToString()
    if ($title -like "*Deepseek Harness Launcher*") { Write-Host ("window: '" + $title + "'"); $script:hwndTarget = $h }
  }
  return $true
}
[void][W.D]::EnumWindows($cb, [IntPtr]::Zero)
Write-Host ("host hwnd: " + $script:hwndTarget)
