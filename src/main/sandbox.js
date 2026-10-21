// Dauntless Forever - launcher
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
// sandbox.js - DF-NOSANDBOX (Oct 21): the launcher closing the instant it opens, with no window and no log.
// Chromium runs its helper processes (graphics, page) in Windows' sandbox, with restricted rights. When the folder the
// launcher is in does not give read rights to Users and to the sandbox groups (ALL APPLICATION PACKAGES S-1-15-2-1,
// ALL RESTRICTED APPLICATION PACKAGES S-1-15-2-2) - common on a drive that was added or formatted later - those
// helpers cannot load their DLLs (exit 0xC0000135), Chromium gives up ("GPU process isn't usable. Goodbye.") and the
// launcher is gone. Seen on D:\DauntlessForever (Killer31g, Oct 21).
//   - A helper that cannot start before the window is up: the launcher notes "sandbox off" and starts again at once
//     with --no-sandbox (the way it already runs under Wine). It stays off on that PC until the folder is fixed.
//   - Two starts in a row that never got a window (crashed some other way): the same.
//   - Once the window is up it offers to fix the folder's rights (one admin prompt, icacls read/execute for Users and
//     the two sandbox groups on the launcher folder only). After that the next start uses the sandbox again.
//   DF_SANDBOX=1 always keeps the sandbox on, DF_SANDBOX=0 always turns it off.
'use strict';
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
let file = null, marker = null, st = {}, offNow = false, shown = false, restarting = false, log = () => {};
const NOT_FOUND = [-1073741515, 3221225781];   // 0xC0000135: a DLL could not be loaded

function dataRoot() {   // as paths.js dataRoot() (that file is fine to use here too, but keep this one self-contained)
  if (process.env.DL_DATA_DIR) return process.env.DL_DATA_DIR;
  const base = (IS_WIN && process.env.LOCALAPPDATA) ? process.env.LOCALAPPDATA : app.getPath('userData');
  const old = path.join(base, 'DauntlessOffline');
  if (fs.existsSync(path.join(old, 'launcher.json')) || fs.existsSync(path.join(old, 'versions'))) return old;
  return path.join(base, 'DauntlessForever');
}
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { return {}; } };
const write = (f, o) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); } catch {} };
const launcherDir = () => path.dirname(process.execPath);

// sure: Windows said a helper could not start (the folder problem). Only then does the window offer the fix; a start
// that just never got a window (killed while loading, PC crash) turns the sandbox off quietly, with no message.
function turnOff(why, sure) {
  st.off = true; st.why = why; st.at = new Date().toISOString(); st.auto = !!sure;
  write(file, st);
  log(`sandbox: turned off (${why})`);
}
function restartWithout(why) {
  if (restarting || offNow || shown) return;
  restarting = true;
  turnOff(why, true);
  const args = process.argv.slice(1).filter(a => a !== '--no-sandbox').concat('--no-sandbox');
  app.relaunch({ args }); app.exit(0);
}

// before the app is ready (the switch only counts then); alreadyOff: Wine turned it off already
function early(opts) {
  opts = opts || {};
  if (opts.log) log = opts.log;
  if (!IS_WIN || !app.isPackaged || opts.alreadyOff) return;
  const root = dataRoot();
  file = path.join(root, 'sandbox.json'); marker = path.join(root, 'start-pending.json');
  st = read(file);
  const force = process.env.DF_SANDBOX;
  if (force === '1') { offNow = false; }
  else if (force === '0' || process.argv.includes('--no-sandbox')) offNow = true;
  else if (st.off) offNow = true;
  else {
    const m = read(marker);
    const recent = m.at && Date.now() - Date.parse(m.at) < 60 * 60 * 1000;
    if (recent && (m.fails || 0) >= 2) { turnOff('the last two starts never opened a window', false); offNow = true; }
  }
  if (offNow) app.commandLine.appendSwitch('no-sandbox');
  // this start is "pending" until the window shows (a second launcher quits before this, so it never counts)
  const m = read(marker);
  const recent = m.at && Date.now() - Date.parse(m.at) < 60 * 60 * 1000;
  write(marker, { at: new Date().toISOString(), fails: (recent ? (m.fails || 0) : 0) + 1, sandbox: !offNow });
  if (offNow || force === '1') return;
  // a helper that cannot start at all before the window is up: start again without the sandbox
  app.on('child-process-gone', (_e, d) => {
    if (shown || !d) return;
    log(`sandbox: helper ${d.type || '?'} gone before the window (${d.reason || '?'}, exit ${d.exitCode})`);
    if (d.reason === 'launch-failed' || NOT_FOUND.includes(d.exitCode)) restartWithout(`the ${d.type || 'helper'} process could not start (exit ${d.exitCode})`);
  });
  app.on('render-process-gone', (_e, _wc, d) => {
    if (shown || !d) return;
    log(`sandbox: page process gone before the window (${d.reason || '?'}, exit ${d.exitCode})`);
    if (d.reason === 'launch-failed' || NOT_FOUND.includes(d.exitCode)) restartWithout(`the page process could not start (exit ${d.exitCode})`);
  });
}

// the window is up: this start worked. When the sandbox is off because of the folder, offer to fix the folder.
function windowShown(win, t) {
  shown = true;
  if (!marker) return;
  try { fs.unlinkSync(marker); } catch {}
  if (!offNow || !st.auto || process.env.DF_SANDBOX === '0') return;
  const now = Date.now();
  if (st.noAsk || (st.askedAt && now - Date.parse(st.askedAt) < 7 * 86400e3)) return;
  st.askedAt = new Date().toISOString(); write(file, st);
  setTimeout(async () => {
    if (!win || win.isDestroyed()) return;
    const dir = launcherDir();
    const r = await dialog.showMessageBox(win, {
      type: 'info', buttons: [t('Fix the folder permissions'), t('Not now')], defaultId: 0, cancelId: 1,
      message: t('The launcher started with Windows\' sandbox turned off'),
      detail: t('The folder the launcher is in does not let Windows\' sandbox read it (common on a drive that was added later), so the launcher could not open normally. It works like this, but it is safer to fix the folder. "Fix the folder permissions" gives read access to that folder only and asks for admin once:') + '\n\n' + dir,
    });
    if (r.response !== 0) return;
    const ok = await fixFolder(dir);
    if (ok === true) {
      st.off = false; st.auto = false; st.fixedAt = new Date().toISOString(); st.noAsk = true; write(file, st);
      log('sandbox: folder rights fixed, sandbox back on from the next start');
      dialog.showMessageBox(win, { type: 'info', buttons: ['OK'], message: t('Folder fixed'), detail: t('The next time you open the launcher it uses the sandbox again. If it does not open then, it turns the sandbox off again by itself.') });
    } else {
      log('sandbox: folder fix failed: ' + ok);
      dialog.showMessageBox(win, { type: 'warning', buttons: ['OK'], message: t('Could not fix the folder'), detail: String(ok) + '\n\n' + t('The launcher keeps working with the sandbox off.') });
    }
  }, 1500);
}

// icacls on the launcher folder only (read/execute, inherited): Users, ALL APPLICATION PACKAGES,
// ALL RESTRICTED APPLICATION PACKAGES. One admin prompt.
function fixFolder(dir) {
  return new Promise((resolve) => {
    if (!fs.existsSync(path.join(dir, path.basename(process.execPath)))) return resolve('Unexpected launcher folder.');
    if (/^[A-Za-z]:\\?$/.test(dir) || /\\(Windows|Program Files( \(x86\))?)\\?$/i.test(dir)) return resolve('The launcher is in a system folder; it was left alone.');
    const q = dir.replace(/"/g, '');
    const inner = `-NoProfile -ExecutionPolicy Bypass -Command "& icacls.exe '${q.replace(/'/g, "''")}' /grant '*S-1-5-32-545:(OI)(CI)RX' /grant '*S-1-15-2-1:(OI)(CI)RX' /grant '*S-1-15-2-2:(OI)(CI)RX' /T /C /Q; exit $LASTEXITCODE"`;
    const outer = `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${inner.replace(/'/g, "''")}'; exit $p.ExitCode`;
    const child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', outer], { windowsHide: true });
    let err = ''; child.stderr.on('data', d => err += d);
    child.on('exit', (code) => resolve(code === 0 ? true : /canceled|cancelled|denied/i.test(err) ? 'Windows did not get permission (the admin prompt was closed).' : (err.trim().split('\n')[0] || `icacls ended with ${code}.`)));
    child.on('error', (e) => resolve(e.message));
  });
}

module.exports = { early, windowShown, isOff: () => offNow };
