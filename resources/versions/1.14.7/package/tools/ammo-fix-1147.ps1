# Dauntless Forever - 1.14.7 hunt server ammo crash fix (DF-AMMO-LOG-1147, Oct 25)
# Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
# Licence: AGPL-3.0-only.
#
# The game's own ServerAdjustAmmo (exe+0x220C8D0) writes a warning when a player's ammo would go below 0 (the game
# and the server disagree on ammo: lag, the relay, Host Mode). That warning is broken: its text expects three values
# ("ServerAdjustAmmo(%d) received for %s when current ammo is %d") but the code passes two, so the server reads a
# number as text and crashes (reports 209 and others, Repeaters). The code after it already keeps ammo between 0 and
# full, so only the warning is skipped:
#   exe+0x220C8EF  0F 89 EC 00 00 00  (jns: skip the warning when ammo stays >= 0)  ->  E9 ED 00 00 00 90  (always skip)
# Nothing on disk changes. Written only when the original bytes are there. server-1147.ps1 calls DfAmmoFix every
# few seconds for every Dauntless process; each one is patched once.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class DfAmmoMem {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int n, out IntPtr r);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteProcessMemory(IntPtr h, IntPtr a, byte[] b, int n, out IntPtr w);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool VirtualProtectEx(IntPtr h, IntPtr a, IntPtr n, uint p, out uint o);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FlushInstructionCache(IntPtr h, IntPtr a, IntPtr n);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@ -ErrorAction SilentlyContinue

$script:DfAmmoDone = @{}
$script:DfAmmoRva = 0x220C8EF
$script:DfAmmoWant = [byte[]](0x0F,0x89,0xEC,0x00,0x00,0x00)
$script:DfAmmoNew  = [byte[]](0xE9,0xED,0x00,0x00,0x00,0x90)

function DfAmmoFix([string]$LogFile) {
    $say = { param($t) if ($LogFile) { try { Add-Content -LiteralPath $LogFile -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $t) -Encoding ASCII } catch { } } }
    foreach ($p in @(Get-Process -Name 'Dauntless-Win64-Shipping' -ErrorAction SilentlyContinue)) {
        $key = "$($p.Id)"; try { $key += '@' + $p.StartTime.Ticks } catch { }
        if ($script:DfAmmoDone.ContainsKey($key)) { continue }
        $base = $null; try { $base = $p.MainModule.BaseAddress.ToInt64() } catch { }
        if (-not $base) { continue }   # still starting, or not ours to open: try again next time
        $h = [DfAmmoMem]::OpenProcess(0x0438, $false, $p.Id)
        if ($h -eq [IntPtr]::Zero) { $script:DfAmmoDone[$key] = $true; continue }
        try {
            $addr = [IntPtr]($base + $script:DfAmmoRva); $cur = New-Object byte[] 6; $n = [IntPtr]::Zero
            if (-not [DfAmmoMem]::ReadProcessMemory($h, $addr, $cur, 6, [ref]$n)) { continue }
            $c = [BitConverter]::ToString($cur)
            if ($c -eq [BitConverter]::ToString($script:DfAmmoNew)) { $script:DfAmmoDone[$key] = $true; continue }
            if ($c -ne [BitConverter]::ToString($script:DfAmmoWant)) { & $say "ammo fix: pid $($p.Id): unexpected bytes $c, not touched"; $script:DfAmmoDone[$key] = $true; continue }
            [uint32]$old = 0
            [void][DfAmmoMem]::VirtualProtectEx($h, $addr, [IntPtr]6, 0x40, [ref]$old)
            $ok = [DfAmmoMem]::WriteProcessMemory($h, $addr, $script:DfAmmoNew, 6, [ref]$n)
            [void][DfAmmoMem]::VirtualProtectEx($h, $addr, [IntPtr]6, $old, [ref]$old)
            [void][DfAmmoMem]::FlushInstructionCache($h, $addr, [IntPtr]6)
            & $say ("ammo fix: pid {0}: ammo log bug skipped (ServerAdjustAmmo): {1}" -f $p.Id, $(if ($ok) { 'on' } else { 'write failed' }))
            $script:DfAmmoDone[$key] = $true
        } finally { [void][DfAmmoMem]::CloseHandle($h) }
    }
}
