Add-Type -Name T -Namespace W -MemberDefinition @'
[DllImport("shell32.dll")] public static extern bool Shell_NotifyIcon(uint msg, ref NOTIFYICONDATA d);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct NOTIFYICONDATA {
  public int cbSize; public IntPtr hWnd; public uint uID; public uint uFlags;
  public uint uCallbackMessage; public IntPtr hIcon;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string szTip;
  public uint dwState; public uint dwStateMask;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string szInfo;
  public uint uTimeout; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string szInfoTitle;
  public uint dwInfoFlags; public Guid guidItem; public IntPtr hBalloonIcon;
}
'@
# 找 Wails 的隐藏托盘窗口（它的窗口类持有托盘图标）
Write-Host "tray icon host is a hidden window owned by DHL; simulating a click needs its hwnd."
