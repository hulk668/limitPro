# =============================================================================
# verify-open-dir.ps1 —— 「打开数据目录」真实效用验证（仅 Windows）
#
# 为什么需要这个脚本：
#   typecheck / build / 接口冒烟测试**全部无法发现**这一类故障 —— 因为
#   spawn('explorer.exe', ...) 只要进程被创建就返回成功，而 explorer 即使
#   窗口没显示也返回成功退出码。历史上就因此出过「点了按钮只有提示、目录
#   根本没打开」（根因：windowsHide: true 会以 CREATE_NO_WINDOW 创建进程）
#   以及「打开的是另一个空目录」两类假阳性。
#
#   本脚本以**肉眼可见的事实**为唯一判据，而不是相信启动器的返回值：
#     1) 用 COM(Shell.Application) 拿到每个资源管理器窗口的**真实路径**；
#     2) 用 Win32 IsWindowVisible 过滤掉 COM 集合里的僵尸/隐藏残留条目；
#     3) 要求「出现了一个可见的、路径等于后端 dataDir 的窗口」，
#        或者「该路径的窗口被提到了前台」（资源管理器可能复用已开窗口）。
#
# 为什么不能用窗口标题判定：
#   标题只是目录名，且用户可能同时开着别的目录窗口，容易误判（实测踩过）。
#   路径才是权威信息。
#
# 前置条件：后端正在运行（pnpm dev 或 pnpm start:web）
# 用法：
#   pnpm verify:open-dir
#   $env:LIMITPRO_BASE='http://127.0.0.1:3211'; pnpm verify:open-dir
#
# 副作用：会在你的屏幕上短暂弹出数据目录窗口，验证完自动关闭
#         （只关「本次验证新出现、且路径等于数据目录」的窗口，绝不碰其他窗口）。
#
# ⚠️ 本文件必须保存为 **UTF-8 with BOM**。PowerShell 5.1 对无 BOM 的 .ps1
#    会按系统 ANSI 代码页（中文环境为 GBK）解析，文件里的中文会被拆坏，
#    直接报「字符串缺少终止符」而无法运行。改动后请确认首字节为 EF BB BF。
# =============================================================================

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Base = if ($env:LIMITPRO_BASE) { $env:LIMITPRO_BASE } else { 'http://127.0.0.1:3210' }

$script:passed = 0
$script:failed = 0

function Check([string]$Name, [bool]$Ok, [string]$Detail) {
  if ($Ok) {
    $script:passed++
    Write-Output "  [OK]   $Name"
  } else {
    $script:failed++
    Write-Output "  [FAIL] $Name"
    if ($Detail) { Write-Output "         $Detail" }
  }
}

# --- Win32 探针 --------------------------------------------------------------
if (-not ('WinProbe' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class WinProbe {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);

  public static string ClassOf(IntPtr h) {
    StringBuilder sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    return sb.ToString();
  }

  public static string TitleOf(IntPtr h) {
    StringBuilder sb = new StringBuilder(1024);
    GetWindowText(h, sb, 1024);
    return sb.ToString();
  }

  public static List<IntPtr> All() {
    List<IntPtr> found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) { found.Add(h); return true; }, IntPtr.Zero);
    return found;
  }

  public static int CountClass(string want) {
    int n = 0;
    foreach (IntPtr h in All()) { if (ClassOf(h) == want) n++; }
    return n;
  }

  public static void Close(IntPtr h) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
'@
}

Write-Output ""
Write-Output "=== verify:open-dir  ($Base) ==="
Write-Output ""

# --- 探针可信度自检：探针必须能看到你的桌面，否则结论无意义 ----------------
if ([WinProbe]::CountClass('Shell_TrayWnd') -lt 1) {
  Write-Output "  [FAIL] 窗口探针看不到本机桌面（未找到 Shell_TrayWnd），结论不可信"
  Write-Output "         self SessionId=$((Get-Process -Id $PID).SessionId)  explorer SessionId=$((Get-Process explorer -ErrorAction SilentlyContinue | Select-Object -First 1).SessionId)"
  exit 1
}
Check '窗口探针能看到本机桌面' $true ''

# --- 资源管理器窗口清单（可见 + 有真实路径）--------------------------------
$shell = New-Object -ComObject Shell.Application

function Get-ExplorerWindows {
  $list = @()
  foreach ($w in $shell.Windows()) {
    $h = [IntPtr]$w.HWND
    # COM 的 Windows() 集合会保留已隐藏/待销毁的僵尸条目，必须过滤
    if (-not [WinProbe]::IsWindow($h)) { continue }
    if (-not [WinProbe]::IsWindowVisible($h)) { continue }
    $p = ''
    try { $p = [string]$w.Document.Folder.Self.Path } catch { $p = '' }
    $list += [PSCustomObject]@{ Hwnd = $h; Path = $p; Com = $w }
  }
  return $list
}

$baseline = Get-ExplorerWindows
$baselineHwnds = @{}
foreach ($w in $baseline) { $baselineHwnds[$w.Hwnd] = $true }
Write-Output "         基线：当前可见的资源管理器窗口 $($baseline.Count) 个"

# --- 后端可达 & 路径唯一性 --------------------------------------------------
try {
  $health = Invoke-RestMethod -Uri "$Base/api/health" -Method Get -TimeoutSec 5
} catch {
  Write-Output "  [FAIL] 后端不可访问：$Base —— 请先启动（pnpm dev）"
  exit 1
}
$healthDir = [string]$health.data.dataDir
Check '后端可访问且返回 dataDir' ([bool]$healthDir) "dataDir=$healthDir"

# --- 真正触发一次「打开」 ---------------------------------------------------
try {
  $res = Invoke-RestMethod -Uri "$Base/api/system/reveal-data-dir" -Method Post `
    -ContentType 'application/json' -Body '{}' -TimeoutSec 10
} catch {
  Write-Output "  [FAIL] POST /api/system/reveal-data-dir 失败：$($_.Exception.Message)"
  exit 1
}
$apiDir = [string]$res.data.path
$apiOpened = [bool]$res.data.opened

Write-Output "         后端返回：path=$apiDir opened=$apiOpened"
Check '接口返回 opened=true' ($apiOpened -eq $true) "opened=$apiOpened"
Check '接口路径 == /api/health 的 dataDir（单一事实来源）' ($apiDir -eq $healthDir) "api=$apiDir  health=$healthDir"

# --- 核心判据：可见的、路径正确的窗口真的出现了 ------------------------------
$newWindows = @()
$reusedFocused = $false
$seenPaths = @()

$deadline = (Get-Date).AddSeconds(12)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 400
  $now = Get-ExplorerWindows
  $seenPaths = @($now | ForEach-Object { $_.Path })

  $newWindows = @($now | Where-Object {
      -not $baselineHwnds.ContainsKey($_.Hwnd) -and ([string]$_.Path) -eq $apiDir
    })
  if ($newWindows.Count -gt 0) { break }

  # 资源管理器可能复用已开着的同路径窗口，此时只会把它提到前台
  $fg = [WinProbe]::GetForegroundWindow()
  foreach ($w in $now) {
    if ($w.Hwnd -eq $fg -and ([string]$w.Path) -eq $apiDir) { $reusedFocused = $true; break }
  }
  if ($reusedFocused) { break }
}

$appeared = $newWindows.Count -gt 0

Check '数据目录窗口真的出现在桌面上（非仅 spawn 成功）' ($appeared -or $reusedFocused) `
  "没有可见窗口指向 $apiDir —— 打开动作静默失败（历史上因 windowsHide: true 导致）。当前可见资源管理器窗口路径：$($seenPaths -join ' | ')"

if ($appeared) {
  Write-Output "         凭据：新出现 $($newWindows.Count) 个窗口，路径 = $apiDir"
} elseif ($reusedFocused) {
  Write-Output "         凭据：该路径的已有窗口被提到了前台（资源管理器复用行为）"
}

# --- 收尾：只关闭「本次新出现且路径等于数据目录」的窗口 ----------------------
foreach ($w in $newWindows) {
  try { $w.Com.Quit() } catch { try { [WinProbe]::Close($w.Hwnd) } catch { /* ignore */ } }
}
if ($newWindows.Count -gt 0) { Start-Sleep -Milliseconds 600 }

# --- 顺手自愈：清理 COM 集合里残留的隐藏僵尸窗口 ----------------------------
# 用 WM_CLOSE 关资源管理器窗口时，它会留下 IsWindowVisible=$false 的残留条目
# （不可见、无害，但会一直挂在 COM 的 Windows() 集合里越积越多）。
# 这里主动清一次，避免长期跑验证脚本攒垃圾。绝不碰可见窗口。
$ghosts = 0
foreach ($w in @($shell.Windows())) {
  try {
    $h = [IntPtr]$w.HWND
    if (-not [WinProbe]::IsWindow($h)) { continue }
    if ([WinProbe]::IsWindowVisible($h)) { continue }
    $w.Quit()
    $ghosts++
  } catch { /* ignore */ }
}
if ($ghosts -gt 0) { Write-Output "         顺手清理隐藏残留窗口 $ghosts 个" }

Write-Output ""
Write-Output "  结果: $script:passed 通过, $script:failed 失败"
Write-Output ""

if ($script:failed -gt 0) { exit 1 }
exit 0
