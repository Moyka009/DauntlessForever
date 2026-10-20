# Dauntless Forever - offline package (1.6.2 and 1.14.7)
# Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
# Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
# df-watch.ps1 - started by start.ps1 next to the player's game (hidden). While the game runs it checks the local
# backend, the Ramsgate server and the PC's free memory every 2 s. When something is wrong it shows a small box on
# top of the game (borderless / windowed mode) with a numbered error, so a screenshot says what happened:
#   Error 1  the local backend closed
#   Error 2  the local backend is running but not answering
#   Error 3  the Ramsgate server closed
#   Error 4  the Ramsgate server is running but not reachable (its game port is not open)
#   Error 5  the PC is out of memory
#   Error 6  Training Grounds is off on this PC (less than 32 GB of memory; data\dojo.txt = on turns it back on)
#   Error 7  the program that starts the game servers closed (1.6.2)
# Every error is also written to logs\watch.log; start.ps1 repeats them when the game closes.
# It never takes focus and clicks go through it to the game. It closes by itself when the game closes.
# To see the box without a problem:  powershell -ExecutionPolicy Bypass -File tools\df-watch.ps1 -TestCode 2
param(
    [ValidateSet('1.6.2', '1.14.7')][string]$Version = '1.14.7',
    [string]$Root = '',
    [int]$BackendPid = 0,          # 1.14.7: recorder-1147.js   1.6.2: the metagame
    [int]$DeployPid = 0,           # 1.6.2 only: the deploy server (starts the game server copies)
    [int]$RamsgatePort = 0,
    [string]$PingUrl = '',
    [int]$TestCode = 0             # shows that error for 20 s and closes (to see what the box looks like)
)
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$LogDir = Join-Path $Root 'logs'; $DataDir = Join-Path $Root 'data'
New-Item -ItemType Directory -Force $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'watch.log'
$NoticeFile = Join-Path $DataDir 'watch_notice.json'   # written by the backend (Error 6)
if (-not $RamsgatePort) { $RamsgatePort = if ($Version -eq '1.6.2') { 8777 } else { 8780 } }
if (-not $PingUrl) { $PingUrl = if ($Version -eq '1.6.2') { 'http://127.0.0.1:61000/dauntless-status' } else { 'http://127.0.0.1:63000/_recorder/ping' } }
Remove-Item -LiteralPath $NoticeFile -Force -ErrorAction SilentlyContinue
[IO.File]::WriteAllText($LogFile, ("{0:yyyy-MM-dd HH:mm:ss} watch started ({1})`r`n" -f (Get-Date), $Version))

$Texts = @{
    1 = 'The local backend closed. Close the game and press Play again.'
    2 = 'The local backend is running but not answering (often: the PC is out of memory, or an antivirus is blocking it).'
    3 = 'The Ramsgate server closed (often: not enough memory). Close the game and press Play again.'
    4 = 'The Ramsgate server is running but not reachable (its game port is not open: firewall or antivirus).'
    5 = 'Your PC is out of memory'
    6 = 'Training Grounds is off on this PC (less than 32 GB of memory). You stay in Ramsgate.'
    7 = 'The program that starts the game servers closed. Close the game and press Play again.'
}
function Log([string]$t) { try { [IO.File]::AppendAllText($LogFile, ("{0:yyyy-MM-dd HH:mm:ss} {1}`r`n" -f (Get-Date), $t)) } catch {} }
function Alive([int]$id) { if (-not $id) { return $true }; return [bool](Get-Process -Id $id -ErrorAction SilentlyContinue) }
function Answers { try { Invoke-WebRequest -Uri $PingUrl -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true } catch { return [bool]($_.Exception.Response) } }
function UdpOpen([int]$p) { [bool](Get-NetUDPEndpoint -LocalPort $p -ErrorAction SilentlyContinue) }
function PlayerGame { @(Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'" | Where-Object { $_.CommandLine -notmatch '(^|\s)-server(\s|$)' }) }
function ServerCopies { @(Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'" | Where-Object { $_.CommandLine -match '(^|\s)-server(\s|$)' }) }

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -Namespace DF -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
'@
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Dauntless Forever" Width="560" SizeToContent="Height" WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" Topmost="True" ShowInTaskbar="False" ShowActivated="False" ResizeMode="NoResize"
        FontFamily="Bahnschrift, Segoe UI" Visibility="Hidden">
  <Border CornerRadius="6" BorderThickness="2" BorderBrush="#E0D9534F" Background="#E6100C0C" Padding="14,10,14,10">
    <StackPanel>
      <TextBlock x:Name="Head" Foreground="#FFFF6B5E" FontSize="22" FontWeight="Bold"/>
      <TextBlock x:Name="Body" Foreground="#FFF2F2F2" FontSize="15" TextWrapping="Wrap" Margin="0,4,0,0"/>
      <TextBlock x:Name="Foot" Foreground="#FFB9B9B9" FontSize="12" TextWrapping="Wrap" Margin="0,6,0,0"/>
    </StackPanel>
  </Border>
</Window>
'@
$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$head = $win.FindName('Head'); $body = $win.FindName('Body'); $foot = $win.FindName('Foot')
$win.Add_SourceInitialized({
    $h = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    # WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE: clicks go to the game, never focused
    [void][DF.Win]::SetWindowLong($h, -20, ([DF.Win]::GetWindowLong($h, -20) -bor 0x20 -bor 0x80000 -bor 0x80 -bor 0x8000000))
})
$wa = [System.Windows.SystemParameters]::WorkArea
$win.Left = $wa.Left + ($wa.Width - $win.Width) / 2; $win.Top = $wa.Top + 40

$S = @{ Started = Get-Date; SeenGame = $false; GoneSince = $null; Miss = 0; LowMem = 0; NoPort = 0; NoServer = 0;
        Shown = @{}; Active = 0; NoticeUntil = [datetime]::MinValue; NoticeAt = ''; Tick = 0 }
function Show-Error([int]$code, [string]$extra = '') {
    $t = $Texts[$code]; if ($extra) { $t = "$t $extra" }
    if (-not $S.Shown.ContainsKey($code)) { $S.Shown[$code] = $true; Log ("Error {0}: {1}" -f $code, $t) }
    $S.Active = $code
    $head.Text = "Dauntless Forever - Error $code"
    $body.Text = $t
    $foot.Text = ("Dauntless {0}  {1:HH:mm}   Asking for help? Post this screenshot or say 'Error {2}' in the Discord." -f $Version, (Get-Date), $code)
    if (-not $win.IsVisible) { $win.Show() }
}
function Hide-Error([int]$code) { if ($S.Active -eq $code) { $S.Active = 0; $win.Hide() } }

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(2)
$timer.Add_Tick({
    try {
        $S.Tick++
        if ($TestCode) { if ($S.Tick -eq 1) { Show-Error $TestCode '(test)' }; if ($S.Tick -ge 10) { $win.Close() }; return }
        # --- the game: closes this watch when it is gone (10 s), or after 3 minutes if it never appeared
        if ($S.Tick % 3 -eq 1) {
            if ((PlayerGame).Count -gt 0) { $S.SeenGame = $true; $S.GoneSince = $null }
            elseif ($S.SeenGame) { if (-not $S.GoneSince) { $S.GoneSince = Get-Date } elseif (((Get-Date) - $S.GoneSince).TotalSeconds -gt 10) { Log 'game closed, watch ends'; $win.Close(); return } }
            elseif (((Get-Date) - $S.Started).TotalMinutes -gt 3) { Log 'game never appeared, watch ends'; $win.Close(); return }
        }
        # --- 1 / 7 / 2: backend
        if (-not (Alive $BackendPid)) { Show-Error 1; return }
        if ($Version -eq '1.6.2' -and -not (Alive $DeployPid)) { Show-Error 7; return }
        if (Answers) { $S.Miss = 0; Hide-Error 2 } else { $S.Miss++ }
        if ($S.Miss -ge 3) { Show-Error 2; return }
        # --- 3 / 4: Ramsgate (1.6.2 restarts a crashed Ramsgate by itself: only a long gap counts)
        if ($S.Tick % 3 -eq 0) {
            $udp = UdpOpen $RamsgatePort
            if ($udp) { $S.NoPort = 0; $S.NoServer = 0; Hide-Error 3; Hide-Error 4 }
            else {
                if ((ServerCopies).Count -gt 0) { $S.NoPort++; $S.NoServer = 0 } else { $S.NoServer++ }
                $limit = if ($Version -eq '1.6.2') { 15 } else { 3 }   # x 6 s
                if ($S.NoServer -ge $limit) { Show-Error 3; return }
                if ($S.NoPort -ge 15) { Show-Error 4; return }
            }
        }
        # --- 5: memory (free physical memory under 500 MB for 3 checks in a row)
        if ($S.Tick % 2 -eq 0) {
            $os = Get-CimInstance Win32_OperatingSystem
            if ($os) {
                $freeMb = [int]($os.FreePhysicalMemory / 1024); $totGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
                if ($freeMb -lt 500) { $S.LowMem++ } else { $S.LowMem = 0; Hide-Error 5 }
                if ($S.LowMem -ge 3) { Show-Error 5 ("({0} MB free of {1} GB). Close other programs (browser, Discord video) and try again." -f $freeMb, $totGb); return }
            }
        }
        # --- 6: notices from the backend (Training Grounds off), shown for 15 s
        if (Test-Path -LiteralPath $NoticeFile) {
            $n = Get-Content -LiteralPath $NoticeFile -Raw | ConvertFrom-Json
            if ($n -and "$($n.at)" -ne $S.NoticeAt) { $S.NoticeAt = "$($n.at)"; $S.NoticeUntil = (Get-Date).AddSeconds(15); $S.Shown.Remove([int]$n.code) | Out-Null; Show-Error ([int]$n.code) }
        }
        if ($S.Active -eq 6 -and (Get-Date) -gt $S.NoticeUntil) { Hide-Error 6 }
    } catch { Log ("watch: " + $_.Exception.Message) }
})
$timer.Start()
$app = New-Object System.Windows.Application
$app.ShutdownMode = 'OnExplicitShutdown'
$win.Add_Closed({ $timer.Stop(); $app.Shutdown() })
[void]$app.Run()
