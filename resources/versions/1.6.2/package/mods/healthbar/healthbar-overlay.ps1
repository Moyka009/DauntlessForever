# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 the healthbar authors
#
# This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General
# Public License, version 3, as published by the Free Software Foundation. It is distributed WITHOUT ANY WARRANTY;
# see the LICENSE file. Keep this notice.
#
# healthbar-overlay.ps1
# Shows the behemoth health bars written by the "healthbar" UE4SS mod (healthbar.json) in a transparent window that
# stays on top of the game. It only reads that one local file (plus behemoth-names.txt next to this script) and draws
# bars. No network, nothing is installed.
#
# The healthbar mod starts this for you when the game starts (and the overlay quits again when the game closes).
# To start it yourself in the background (no window, quit it from its tray icon), double-click
# start-healthbar-overlay.bat, or run it by hand:
#   powershell -ExecutionPolicy Bypass -File .\healthbar-overlay.ps1
#
# - The overlay only shows while Dauntless is the window you are using, so it disappears when you alt-tab.
# - Press the toggle key (default F8) while in the game to hide or show it. Right-click the tray icon for the same.
# - The game must be in windowed or borderless ("Windowed Fullscreen") mode, or Windows hides this window behind it.
#
# Options:  -Width 600 (width of every bar)  -Gap 30 (space between bars)  -Height 24 (bar height)
#           -NameSize 12  -NumberSize 10.5  -FromBottom 200 (pixels above the bottom edge of the game window)
#           -HotKey F8  (or "Ctrl+F8", "Alt+H", ...)
#           -GameProcess Dauntless*,Archon*  (process names that count as "the game")
#           -NoFocusCheck  (show even when the game is not the active window)
#           -QuitWhenGameCloses  (exit by itself a few seconds after the game closes; the mod passes this)
#           -Dir "C:\folder"  (where healthbar.json is; the default is the Dauntless Forever meter folder)

param(
    [string]$Dir = $(if ($env:DF_METER_DIR) { $env:DF_METER_DIR } elseif (Test-Path (Join-Path $env:LOCALAPPDATA 'DauntlessForever\versions\1.6.2\data\meter')) { Join-Path $env:LOCALAPPDATA 'DauntlessForever\versions\1.6.2\data\meter' } else { Join-Path $env:LOCALAPPDATA 'DauntlessOffline' }),
    [int]$Width = 600,
    [int]$Gap = 30,
    [int]$Height = 24,
    [int]$FromBottom = 200,
    [double]$NameSize = 12,
    [double]$NumberSize = 10.5,
    [int]$StaleSeconds = 10,
    [string]$HotKey = 'F8',
    [string[]]$GameProcess = @('Dauntless*', 'Archon*'),
    [switch]$NoFocusCheck,
    [switch]$QuitWhenGameCloses
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Only one overlay at a time, and the newest one wins: stop any OLDER copy of this overlay that is still running
# (so after you update the script, the new version always takes over from an old one left in the tray).
# It only touches PowerShell processes whose command line names healthbar-overlay.ps1.
try {
    $me = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction Stop |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*healthbar-overlay.ps1*' -and $_.CreationDate -lt $me.CreationDate } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { } }
} catch { }

# A borderless window that never takes focus and lets mouse clicks pass through to the game. It is drawn with
# per-pixel transparency (UpdateLayeredWindow), so text can float over the game with no background behind it
# and the shield tint can be see-through. Plus two Windows calls: which program is in front, is the toggle key down.
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class Native
{
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}

public class OverlayForm : Form
{
    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    private struct BLENDFUNCTION
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE { public int cx; public int cy; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize,
        IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hObject);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);

    public OverlayForm() { }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x80000;     // WS_EX_LAYERED
            cp.ExStyle |= 0x20;        // WS_EX_TRANSPARENT (clicks pass through)
            cp.ExStyle |= 0x80;        // WS_EX_TOOLWINDOW (no taskbar / alt-tab entry)
            cp.ExStyle |= 0x08000000;  // WS_EX_NOACTIVATE
            return cp;
        }
    }

    // Puts a 32-bit bitmap (with alpha) on screen at (x, y) as this window's whole picture.
    public void SetBitmap(Bitmap bitmap, int x, int y)
    {
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memDc = CreateCompatibleDC(screenDc);
        IntPtr hBitmap = IntPtr.Zero;
        IntPtr oldBitmap = IntPtr.Zero;
        try
        {
            hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
            oldBitmap = SelectObject(memDc, hBitmap);

            SIZE size = new SIZE();
            size.cx = bitmap.Width;
            size.cy = bitmap.Height;
            POINT source = new POINT();
            POINT target = new POINT();
            target.X = x;
            target.Y = y;
            BLENDFUNCTION blend = new BLENDFUNCTION();
            blend.BlendOp = 0;               // AC_SRC_OVER
            blend.BlendFlags = 0;
            blend.SourceConstantAlpha = 255; // the bitmap's own per-pixel alpha does the work
            blend.AlphaFormat = 1;           // AC_SRC_ALPHA

            UpdateLayeredWindow(this.Handle, screenDc, ref target, ref size, memDc, ref source, 0, ref blend, 2);
        }
        finally
        {
            ReleaseDC(IntPtr.Zero, screenDc);
            if (hBitmap != IntPtr.Zero)
            {
                SelectObject(memDc, oldBitmap);
                DeleteObject(hBitmap);
            }
            DeleteDC(memDc);
        }
    }
}
"@

$file = Join-Path $Dir 'healthbar.json'
$namesFile = Join-Path $PSScriptRoot 'behemoth-names.txt'

$script:gap = $Gap
$script:barH = $Height
$script:labelH = 28          # room above the bar for the name
$script:capH = 3             # how far the end caps stick out above and below the bar
$script:barW = $Width
$script:totalW = $Width
$script:totalH = $script:labelH + $Height + $script:capH
$script:winX = 0
$script:winY = 0
$script:bars = @()
$script:names = @{}
$script:noted = @{}
$script:namesStamp = $null
$script:lastState = $null
$script:lastSig = ''
$script:userHidden = $false
$script:gameFocused = $false
$script:lastForeground = ''
$script:ticks = 0
$script:wasDown = $false
$script:sawGame = $false
$script:missing = 0

# ---- drawing tools (made once). Colors are (alpha, red, green, blue); alpha 255 = solid.
$script:trackBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(150, 10, 12, 16))
$script:fillTop = [System.Drawing.Color]::FromArgb(240, 196, 40, 36)
$script:fillBottom = [System.Drawing.Color]::FromArgb(240, 128, 18, 18)
$script:shieldBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(75, 70, 170, 255))
$script:shieldEdgeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 140, 205, 255))
$script:framePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(170, 230, 230, 230), [single]1)
$script:tickPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(55, 255, 255, 255), [single]1)
$script:capBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(200, 235, 235, 235))
$script:outlineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(190, 0, 0, 0))
$script:fontName = [System.Drawing.Font]::new('Segoe UI', [single]$NameSize, [System.Drawing.FontStyle]::Bold)
$script:fontNums = [System.Drawing.Font]::new('Segoe UI', [single]$NumberSize, [System.Drawing.FontStyle]::Bold)

$script:centerFmt = New-Object System.Drawing.StringFormat
$script:centerFmt.Alignment = [System.Drawing.StringAlignment]::Center
$script:centerFmt.LineAlignment = [System.Drawing.StringAlignment]::Center
$script:centerFmt.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap

$script:nameFmt = New-Object System.Drawing.StringFormat
$script:nameFmt.Alignment = [System.Drawing.StringAlignment]::Center
$script:nameFmt.LineAlignment = [System.Drawing.StringAlignment]::Far      # sits just above the bar
$script:nameFmt.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
$script:nameFmt.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap

# white text with a thin dark outline, so it reads on any background
function Draw-Outlined($g, [string]$text, $font, [float]$x, [float]$y, [float]$w, [float]$h, $fmt) {
    foreach ($d in @(@(-1, 0), @(1, 0), @(0, -1), @(0, 1), @(1, 1))) {
        $r = New-Object System.Drawing.RectangleF(([float]($x + $d[0])), ([float]($y + $d[1])), $w, $h)
        $g.DrawString($text, $font, $script:outlineBrush, $r, $fmt)
    }
    $rect = New-Object System.Drawing.RectangleF($x, $y, $w, $h)
    $g.DrawString($text, $font, [System.Drawing.Brushes]::White, $rect, $fmt)
}

# ---- the window
$form = New-Object OverlayForm
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.Size = New-Object System.Drawing.Size(10, 10)
$script:form = $form

# every bar as wide as a single bar, unless that would not fit on the screen; works out where the window goes
function Update-Layout([int]$n) {
    # the bars go over the game's own window (any monitor); the main screen only when the game window is not known
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $gw = Get-GameWindow
    if ($gw -ne [IntPtr]::Zero) {
        $r = New-Object Native+RECT
        if ([Native]::GetWindowRect($gw, [ref]$r) -and ($r.Right - $r.Left) -gt 200 -and ($r.Bottom - $r.Top) -gt 200) {
            $screen = New-Object System.Drawing.Rectangle($r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
        }
    }
    $w = [Math]::Min($Width, [int](($screen.Width * 0.92 - ($n - 1) * $script:gap) / $n))
    $script:barW = $w
    $script:totalW = $n * $w + [Math]::Max(0, $n - 1) * $script:gap
    $script:totalH = $script:labelH + $script:barH + $script:capH
    $script:winX = $screen.X + [int](($screen.Width - $script:totalW) / 2)
    $script:winY = $screen.Bottom - $FromBottom - $script:totalH
}

# draw all bars into a transparent bitmap and hand it to the window
function Render-Bars {
    $bars = $script:bars
    $n = $bars.Count
    $w = $script:barW
    $h = $script:barH
    $lh = $script:labelH
    $cap = $script:capH
    $bmp = New-Object System.Drawing.Bitmap($script:totalW, $script:totalH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
        for ($i = 0; $i -lt $n; $i++) {
            $b = $bars[$i]
            $x = $i * ($w + $script:gap)
            $y = $lh
            $max = [double]$b.max
            $hp = [Math]::Max(0.0, [double]$b.hp)
            $frac = 0.0
            if ($max -gt 0) { $frac = [Math]::Min(1.0, $hp / $max) }

            # dark see-through track, then the red health fill
            $g.FillRectangle($script:trackBrush, $x, $y, $w, $h)
            $fillW = [int](($w - 2) * $frac)
            if ($fillW -gt 0) {
                $rect = New-Object System.Drawing.Rectangle(($x + 1), ($y + 1), $fillW, ($h - 2))
                $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $script:fillTop, $script:fillBottom, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
                $g.FillRectangle($grad, $rect)
                $grad.Dispose()
            }

            # faint quarter marks
            foreach ($t in 0.25, 0.5, 0.75) {
                $tx = [int]($x + $w * $t)
                $g.DrawLine($script:tickPen, $tx, ($y + 1), $tx, ($y + $h - 2))
            }

            # shield: only drawn while there is one, as a see-through blue tint over the health bar
            $sh = [double]$b.shield
            $shMax = [double]$b.shieldMax
            if ($sh -gt 0 -and $shMax -gt 0) {
                $sFrac = [Math]::Min(1.0, $sh / $shMax)
                $sw = [int](($w - 2) * $sFrac)
                if ($sw -gt 0) {
                    # a light tint, so the red health bar stays visible underneath...
                    $g.FillRectangle($script:shieldBrush, ($x + 1), ($y + 1), $sw, ($h - 2))
                    # ...and bright lines along the top and bottom and at the end, which show how much shield is left
                    $g.FillRectangle($script:shieldEdgeBrush, ($x + 1), ($y + 1), $sw, 2)
                    $g.FillRectangle($script:shieldEdgeBrush, ($x + 1), ($y + $h - 3), $sw, 2)
                    $g.FillRectangle($script:shieldEdgeBrush, ($x + 1 + [Math]::Max(0, $sw - 2)), ($y + 1), [Math]::Min(2, $sw), ($h - 2))
                }
            }

            # thin frame and end caps
            $g.DrawRectangle($script:framePen, $x, $y, ($w - 1), ($h - 1))
            $g.FillRectangle($script:capBrush, $x, ($y - $cap), 2, ($h + 2 * $cap))
            $g.FillRectangle($script:capBrush, ($x + $w - 2), ($y - $cap), 2, ($h + 2 * $cap))

            $id = ([string]$b.id).ToLowerInvariant()
            $name = [string]$b.name
            if ($b.gameName) { $name = [string]$b.gameName }
            if ($script:names.ContainsKey($id)) { $name = $script:names[$id] }
            $nums = '{0:N0} / {1:N0}  ({2:P0})' -f $hp, $max, $frac

            # name above the bar, numbers inside it
            Draw-Outlined $g ($name.ToUpperInvariant()) $script:fontName $x 0 $w ($lh - 4) $script:nameFmt
            Draw-Outlined $g $nums $script:fontNums $x $y $w $h $script:centerFmt
        }
    } finally {
        $g.Dispose()
    }
    try {
        $script:form.SetBitmap($bmp, $script:winX, $script:winY)
    } finally {
        $bmp.Dispose()
    }
}

# ---- behemoth-names.txt:  internal_id = Name shown on screen
function Load-Names {
    try {
        if (-not (Test-Path -LiteralPath $namesFile)) { return }
        $stamp = (Get-Item -LiteralPath $namesFile).LastWriteTimeUtc
        if ($script:namesStamp -eq $stamp) { return }
        $map = @{}
        foreach ($line in [System.IO.File]::ReadAllLines($namesFile)) {
            $t = $line.Trim()
            if ($t -eq '' -or $t.StartsWith('#')) { continue }
            $i = $t.IndexOf('=')
            if ($i -lt 1) { continue }
            $value = $t.Substring($i + 1)
            $hash = $value.IndexOf('#')
            if ($hash -ge 0) { $value = $value.Substring(0, $hash) }
            $value = $value.Trim()
            if ($value -eq '') { continue }
            $map[$t.Substring(0, $i).Trim().ToLowerInvariant()] = $value
        }
        $script:names = $map
        $script:namesStamp = $stamp
        $script:lastSig = ''     # redraw with the new names
    } catch { }
}

# a behemoth with no name anywhere yet gets a blank line in behemoth-names.txt, with hints, ready to be filled in
function Note-Unknown($b) {
    try {
        $id = ([string]$b.id).ToLowerInvariant()
        if (-not $id -or $script:noted.ContainsKey($id) -or $script:names.ContainsKey($id) -or [string]$b.gameName) { return }
        $script:noted[$id] = $true
        $text = ''
        if (Test-Path -LiteralPath $namesFile) { $text = [System.IO.File]::ReadAllText($namesFile) }
        if ($text -match ('(?mi)^\s*#?\s*' + [regex]::Escape($id) + '\s*=')) { return }
        $hint = 'max health ' + ([double]$b.max).ToString('N0')
        if ($b.map) { $hint += ', hunt map ' + [string]$b.map }
        $lines = @()
        if ($text -notmatch '(?m)^# --- seen but not named yet') {
            $lines += ''
            $lines += '# --- seen but not named yet: type the name after the = sign (the overlay picks it up by itself) ---'
        }
        $lines += ($id + ' =        # seen: ' + $hint)
        Add-Content -LiteralPath $namesFile -Value $lines -Encoding UTF8
    } catch { }
}

# ---- reading the mod's file (even while the game is writing it); on a failed read keep the last good state
function Read-State {
    if (-not (Test-Path -LiteralPath $file)) { return $null }
    $fs = $null
    try {
        $fs = [System.IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
        $reader = New-Object System.IO.StreamReader($fs)
        $text = $reader.ReadToEnd()
        $reader.Dispose()
        $script:lastState = ($text | ConvertFrom-Json)
        return $script:lastState
    } catch {
        return $script:lastState
    } finally {
        if ($fs) { $fs.Dispose() }
    }
}

# ---- which program is in front?
$script:fgHwnd = [IntPtr]::Zero
$script:gameHwnd = [IntPtr]::Zero
function Get-ForegroundProcessName {
    try {
        $h = [Native]::GetForegroundWindow()
        $script:fgHwnd = $h
        if ($h -eq [IntPtr]::Zero) { return '' }
        $procId = [uint32]0
        [void][Native]::GetWindowThreadProcessId($h, [ref]$procId)
        if ($procId -eq 0) { return '' }
        return [System.Diagnostics.Process]::GetProcessById([int]$procId).ProcessName
    } catch {
        return ''
    }
}

# the game's window: the one last seen in front, else the first game process that has a window
function Get-GameWindow {
    if ($script:gameHwnd -ne [IntPtr]::Zero -and [Native]::IsWindow($script:gameHwnd)) { return $script:gameHwnd }
    foreach ($pr in [System.Diagnostics.Process]::GetProcesses()) {
        try {
            foreach ($gp in $GameProcess) { if ($pr.ProcessName -like $gp -and $pr.MainWindowHandle -ne [IntPtr]::Zero) { $script:gameHwnd = $pr.MainWindowHandle } }
        } catch { }
        $pr.Dispose()
        if ($script:gameHwnd -ne [IntPtr]::Zero) { break }
    }
    return $script:gameHwnd
}

# ---- toggle key
$script:hkVk = [int][System.Windows.Forms.Keys]::F8
$script:hkMods = @()
try {
    $keyName = $null
    foreach ($part in $HotKey.Split('+')) {
        switch ($part.Trim().ToLowerInvariant()) {
            'ctrl'  { $script:hkMods += 0x11 }
            'alt'   { $script:hkMods += 0x12 }
            'shift' { $script:hkMods += 0x10 }
            default { $keyName = $part.Trim() }
        }
    }
    if ($keyName) { $script:hkVk = [int][System.Windows.Forms.Keys]$keyName }
} catch {
    $script:hkVk = [int][System.Windows.Forms.Keys]::F8
    $script:hkMods = @()
}

# ---- tray icon (the way to quit)
$script:ctx = New-Object System.Windows.Forms.ApplicationContext
$script:tray = New-Object System.Windows.Forms.NotifyIcon
$script:tray.Icon = [System.Drawing.SystemIcons]::Application
$script:tray.Text = 'healthbar overlay'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemToggle = $menu.Items.Add('Show / hide overlay (' + $HotKey + ' in game)')
$script:itemInfo = $menu.Items.Add('Foreground app: (none yet)')
$script:itemInfo.Enabled = $false
$itemExit = $menu.Items.Add('Exit')
$itemToggle.Add_Click({ $script:userHidden = -not $script:userHidden })
$itemExit.Add_Click({ $script:ctx.ExitThread() })
$menu.Add_Opening({
    $name = $script:lastForeground
    if (-not $name) { $name = '(none yet)' }
    $script:itemInfo.Text = 'Foreground app: ' + $name
})
$script:tray.ContextMenuStrip = $menu
$script:tray.Add_DoubleClick({ $script:userHidden = -not $script:userHidden })
$script:tray.Visible = $true

# ---- main timer: read the file, decide whether to show, redraw when something changed
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    $script:ticks++
    if (($script:ticks % 10) -eq 1) { Load-Names }

    # when started by the mod: quit a few seconds after the game has closed
    if ($QuitWhenGameCloses.IsPresent -and (($script:ticks % 10) -eq 5)) {
        $running = $false
        foreach ($pr in [System.Diagnostics.Process]::GetProcesses()) {
            try {
                foreach ($gp in $GameProcess) { if ($pr.ProcessName -like $gp) { $running = $true } }
            } catch { }
            $pr.Dispose()
        }
        if ($running) { $script:sawGame = $true; $script:missing = 0 } else { $script:missing++ }
        if ($script:sawGame -and $script:missing -ge 5) { $script:ctx.ExitThread() }
    }

    if ($NoFocusCheck.IsPresent) {
        $script:gameFocused = $true
    } else {
        $fg = Get-ForegroundProcessName
        $script:lastForeground = $fg
        $focused = $false
        foreach ($p in $GameProcess) { if ($fg -like $p) { $focused = $true } }
        if ($focused) { $script:gameHwnd = $script:fgHwnd }
        $script:gameFocused = $focused
    }

    $bars = @()
    $st = Read-State
    if ($st -and $st.bars) {
        $age = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$st.time
        if ($age -le $StaleSeconds) { $bars = @($st.bars) }
    }

    if (($bars.Count -gt 0) -and $script:gameFocused -and (-not $script:userHidden)) {
        $script:bars = $bars
        Update-Layout $bars.Count
        foreach ($nb in $bars) { Note-Unknown $nb }
        $sig = (($bars | ForEach-Object { '{0}:{1}:{2}:{3}:{4}' -f $_.id, $_.hp, $_.max, $_.shield, $_.shieldMax }) -join ';') + "|$($script:barW)|$($script:winX),$($script:winY)"
        if (-not $script:form.Visible) {
            $script:form.Show()
            $script:lastSig = ''
        }
        if ($sig -ne $script:lastSig) {
            Render-Bars
            $script:lastSig = $sig
        }
    } elseif ($script:form.Visible) {
        $script:form.Hide()
        $script:lastSig = ''
    }
})

# ---- key timer: a quick poll so a short tap is not missed. Only counts while the game is in front.
$keyTimer = New-Object System.Windows.Forms.Timer
$keyTimer.Interval = 40
$keyTimer.Add_Tick({
    $down = ([Native]::GetAsyncKeyState($script:hkVk) -lt 0)
    if ($down) {
        foreach ($m in $script:hkMods) {
            if ([Native]::GetAsyncKeyState($m) -ge 0) { $down = $false }
        }
    }
    if ($down -and (-not $script:wasDown) -and $script:gameFocused) {
        $script:userHidden = -not $script:userHidden
    }
    $script:wasDown = $down
})

Load-Names
Write-Host "healthbar overlay running. Watching: $file"
$timer.Start()
$keyTimer.Start()
try {
    [System.Windows.Forms.Application]::Run($script:ctx)
} finally {
    $timer.Stop()
    $keyTimer.Stop()
    $script:tray.Visible = $false
    $script:tray.Dispose()
    $script:form.Dispose()
}
