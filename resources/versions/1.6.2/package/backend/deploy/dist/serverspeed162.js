// Dauntless Forever - Dauntless 1.6.2 offline package
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
'use strict';
// DF-SERVERSPEED (Oct 21): every server copy (Ramsgate, Training Dojo, hunts) runs at High priority and with Windows
// power throttling ("efficiency mode") off. On some PCs Windows slowed the hidden server copies down while the game
// had the focus, so a hunt ran at a few frames per second and hitched. Never stops or delays a server: if Windows
// refuses, the server simply runs at normal priority and the deploy log says why.
// data\server_priority.txt with the word normal turns it off.
const cp = require('node:child_process'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const ROOT = path.resolve(__dirname, '..', '..', '..');   // backend/deploy/<dist|src> -> package folder

function Enabled() {
    if (process.platform !== 'win32') return false;
    try { return fs.readFileSync(path.join(ROOT, 'data', 'server_priority.txt'), 'utf8').trim().toLowerCase() !== 'normal'; } catch { return true; }
}

// ProcessPowerThrottling (4): Version 1, ControlMask EXECUTION_SPEED (1), StateMask 0 = never throttle this process
const PS = "Add-Type -Namespace DFS -Name P -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern bool SetProcessInformation(IntPtr h, int c, byte[] i, int s);'; " +
    "$p = Get-Process -Id __PID__ -ErrorAction Stop; try { $p.PriorityClass = 'High' } catch {}; " +
    "if (-not [DFS.P]::SetProcessInformation($p.Handle, 4, [byte[]](1,0,0,0,1,0,0,0,0,0,0,0), 12)) { exit 3 }";

function Apply(Child, Port, logger) {
    try {
        if (!Enabled() || !Child || !Child.pid) return;
        const Pid = Child.pid;
        try { os.setPriority(Pid, os.constants.priority.PRIORITY_HIGH); } catch (e) { logger.warn(`[speed] port ${Port}: High priority refused (${e && e.code ? e.code : 'error'})`); }
        const ps = cp.spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PS.replace('__PID__', String(Pid))], { windowsHide: true, stdio: 'ignore' });
        ps.on('error', () => { });
        ps.on('exit', (code) => {
            if (code === 0) logger.info(`[speed] port ${Port}: server copy (pid ${Pid}) at High priority, no power throttling`);
            else logger.warn(`[speed] port ${Port}: power throttling could not be switched off (code ${code})`);
        });
        ps.unref();
    } catch (e) { try { logger.warn(`[speed] ${e && e.message ? e.message : e}`); } catch { } }
}
module.exports = { Apply };
