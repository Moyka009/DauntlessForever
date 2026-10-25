# Dauntless Forever - 1.14.7 party fix (DF-PARTY-STAY-1147, Oct 25)
# Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
# Licence: AGPL-3.0-only.
#
# The game decides who in its party is online from Epic's live services, which do not exist offline. After a map
# change (an escalation, a trial, a hunt) its check finds nobody "online" and either leaves the party
# ("UArchonPartyPrimary::UpdateParty - Leaving party due to all members being offline") or, as the leader, kicks the
# member ("Kicking member from party who was detected to be Offline"). Both are turned off in the running game:
#   exe+0x1C7B447  0F 85 7E 08 00 00  (jne: leave the party)   -> six NOPs
#   exe+0x1C7B47E  0F 86 8D 05 00 00  (jbe: member is online)  -> jmp to the same place (never "offline")
# Real leaves and kicks still work; the backend removes players it has not heard from for 3 minutes.
# Nothing on disk changes. Each patch is written only when the original bytes are there.
# play-1147.ps1 calls DfPartyStay while the game starts; it returns $true once there is nothing left to do.
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class DfPartyMem {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int n, out IntPtr r);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool WriteProcessMemory(IntPtr h, IntPtr a, byte[] b, int n, out IntPtr w);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool VirtualProtectEx(IntPtr h, IntPtr a, IntPtr n, uint p, out uint o);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FlushInstructionCache(IntPtr h, IntPtr a, IntPtr n);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@ -ErrorAction SilentlyContinue

$script:DfPartyPatches = @(
    @{ Name = 'leave when all members look offline'; Rva = 0x1C7B447; Want = [byte[]](0x0F,0x85,0x7E,0x08,0x00,0x00); New = [byte[]](0x90,0x90,0x90,0x90,0x90,0x90) },
    @{ Name = 'leader kicks a member who looks offline'; Rva = 0x1C7B47E; Want = [byte[]](0x0F,0x86,0x8D,0x05,0x00,0x00); New = [byte[]](0xE9,0x8E,0x05,0x00,0x00,0x90) }
)

function DfPartyStay([datetime]$Since, [string]$LogFile) {
    $say = { param($t) if ($LogFile) { try { Add-Content -LiteralPath $LogFile -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $t) -Encoding ASCII } catch { } } }
    $games = @(Get-CimInstance Win32_Process -Filter "Name='Dauntless-Win64-Shipping.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -notmatch '(^|\s)-server(\s|$)' })
    if (-not $games.Count) { return $false }   # not started yet
    $done = $true
    foreach ($g in $games) {
        $p = Get-Process -Id $g.ProcessId -ErrorAction SilentlyContinue
        if (-not $p) { continue }
        if ($Since -and $p.StartTime -lt $Since.AddSeconds(-5)) { continue }   # someone else's older game
        $base = $null; try { $base = $p.MainModule.BaseAddress.ToInt64() } catch { }
        if (-not $base) { $done = $false; continue }   # still loading
        $h = [DfPartyMem]::OpenProcess(0x0438, $false, $p.Id)
        if ($h -eq [IntPtr]::Zero) { & $say "party stay: pid $($p.Id): cannot open the game"; continue }
        try {
            foreach ($x in $script:DfPartyPatches) {
                $addr = [IntPtr]($base + $x.Rva); $cur = New-Object byte[] 6; $n = [IntPtr]::Zero
                if (-not [DfPartyMem]::ReadProcessMemory($h, $addr, $cur, 6, [ref]$n)) { $done = $false; continue }
                $c = [BitConverter]::ToString($cur)
                if ($c -eq [BitConverter]::ToString($x.New)) { continue }
                if ($c -ne [BitConverter]::ToString($x.Want)) { & $say "party stay: pid $($p.Id): $($x.Name): unexpected bytes $c, not touched"; continue }
                [uint32]$old = 0
                [void][DfPartyMem]::VirtualProtectEx($h, $addr, [IntPtr]6, 0x40, [ref]$old)
                $ok = [DfPartyMem]::WriteProcessMemory($h, $addr, $x.New, 6, [ref]$n)
                [void][DfPartyMem]::VirtualProtectEx($h, $addr, [IntPtr]6, $old, [ref]$old)
                [void][DfPartyMem]::FlushInstructionCache($h, $addr, [IntPtr]6)
                & $say ("party stay: pid {0}: {1}: {2}" -f $p.Id, $x.Name, $(if ($ok) { 'off' } else { 'write failed' }))
                if (-not $ok) { $done = $false }
            }
        } finally { [void][DfPartyMem]::CloseHandle($h) }
    }
    return $done
}
