// Dauntless Forever - launcher
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
// repair.js - DF-CHECKFILES (Oct 21): More > "Check the game files". Every game file is compared with Epic's manifest
// for this build (size and SHA1), and only the files that are missing or damaged are downloaded again. The files this
// version's set-up puts into the game folder on purpose (package.installedFiles: the offline sign-in, the loader,
// our paks) are left alone.
// The tool is manifest-repair.exe: meszmate/manifest v0.1.0 (MIT) with the plain-chunk fix plus "verify --progress"
// and "download --files <list>" (source change: bin/manifest-repair.patch next to it). It ships inside the launcher
// update and is copied out to the launcher's data folder before use.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./paths');

const BASE_URL = 'https://epicgames-download1.akamaized.net/Builds/Org/o-krlzxj88qrtb69fredeuaf887bl5az/Jackal/default';
const TOOL_SHA256 = '55d2f385908d92b6bef22cb5946507292310a0527d3c50b1c057f0d4aa404ac6';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const active = new Map();   // versionId -> child

function tool() {
  const src = path.join(__dirname, 'bin', 'manifest-repair.bin');   // .bin inside the update, so the packer never unpacks it beside app.asar
  const dir = path.join(P.dataRoot(), 'tools'); fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, 'manifest-repair.exe');
  try { if (sha(fs.readFileSync(dst)) === TOOL_SHA256) return dst; } catch {}
  const b = fs.readFileSync(src);   // inside app.asar: Electron reads it like a normal file
  if (sha(b) !== TOOL_SHA256) throw new Error('The repair tool inside the launcher is damaged. Reinstall the launcher.');
  fs.writeFileSync(dst + '.tmp', b); fs.renameSync(dst + '.tmp', dst);
  return dst;
}
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

function run(id, args, onErrLine, onOutLine) {
  return new Promise((resolve) => {
    let exe; try { exe = tool(); } catch (e) { return resolve({ code: 1, error: e.message }); }
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active.set(id, child);
    const feed = (stream, fn) => { let buf = ''; stream.on('data', (d) => { buf += d.toString('utf8'); const parts = buf.split(/[\r\n]+/); buf = parts.pop(); for (const l of parts) if (l.trim()) fn(l); }); stream.on('end', () => { if (buf.trim()) fn(buf); }); };
    feed(child.stderr, onErrLine); feed(child.stdout, onOutLine);
    child.on('exit', (code) => { active.delete(id); resolve({ code: code == null ? 1 : code }); });
    child.on('error', (e) => { active.delete(id); resolve({ code: 1, error: 'Could not start the repair tool: ' + e.message }); });
  });
}

// onProgress({ phase: 'check'|'repair', pct, text }) ; onLine(text, isErr)
// resolves { ok, checked, bad: [{ file, why }], repaired, error }
async function checkAndRepair(v, gameDir, onProgress, onLine) {
  if (active.has(v.id)) return { ok: false, error: 'Already checking this game.' };
  const ours = new Set(((v.package && v.package.installedFiles) || []).map(f => norm(typeof f === 'string' ? f : f && f.rel)));
  // 1. check
  const bad = []; let checked = 0, total = 0, lastPct = -1, errorLine = '';
  const r1 = await run(v.id, ['verify', v.download.manifestUrl, '-p', gameDir, '--progress'],
    (l) => {
      const m = /^CHECK (\d+)\/(\d+) (.*)$/.exec(l.trim());
      if (m) {
        checked = +m[1]; total = +m[2];
        const pct = Math.floor(checked * 100 / Math.max(1, total));
        if (pct !== lastPct) { lastPct = pct; onProgress({ phase: 'check', pct, text: `${checked} of ${total} files` }); }
      } else if (/^Error:/i.test(l.trim()) && !errorLine) errorLine = l.trim();
    },
    (l) => {
      const m = /^(MISSING|BAD SIZE|BAD HASH)\s+(.+?)(?:\s+\(expected .*\))?$/.exec(l.trim());
      if (m && !ours.has(norm(m[2]))) bad.push({ file: m[2], why: m[1] === 'MISSING' ? 'missing' : 'damaged' });
    });
  if (r1.error) return { ok: false, error: r1.error };
  // exit 1 with problems listed is the normal "files need repair"; exit 1 with nothing checked is a real failure
  if (r1.code !== 0 && !total) return { ok: false, error: errorLine.replace(/^Error:\s*/i, '') || 'The check could not run (could the manifest be downloaded?).' };
  for (const b of bad) onLine(`${b.why === 'missing' ? 'Missing' : 'Damaged'}: ${b.file}`, true);
  if (!bad.length) return { ok: true, checked: total, bad, repaired: 0 };
  // 2. repair: only those files
  const list = path.join(P.dataRoot(), 'tools', `repair-${v.id}.txt`);
  fs.writeFileSync(list, bad.map(b => b.file).join('\n') + '\n');
  const cache = path.join(gameDir, '.manifest-cache'), hadCache = fs.existsSync(cache);
  const re = /(\d{1,3})%.*?\(([\d.]+(?:\s*[KMGT]?i?B)?)\s*\/\s*([\d.]+\s*[KMGT]?i?B)/;
  let failed = null; errorLine = '';
  const r2 = await run(v.id, ['download', v.download.manifestUrl, '--base-url', BASE_URL, '--output', gameDir, '--files', list, '--concurrency', '16'],
    (l) => {
      const m = re.exec(l);
      if (m) onProgress({ phase: 'repair', pct: +m[1], text: `${m[2].trim()} of ${m[3].trim()}` });
      else if (/^\s*Error:/i.test(l) && !errorLine) errorLine = l.trim();
    },
    (l) => { const f = /failed:\s*(\d+)/.exec(l); if (f) failed = +f[1]; });
  try { fs.unlinkSync(list); } catch {}
  // a failed repair leaves its pieces in .manifest-cache: removed, so the launcher never mistakes the game for an unfinished download
  if (!hadCache) try { fs.rmSync(cache, { recursive: true, force: true }); } catch {}
  if (r2.error) return { ok: false, checked: total, bad, error: r2.error };
  if (r2.code !== 0 || failed) return { ok: false, checked: total, bad, error: errorLine.replace(/^Error:\s*/i, '') || 'Some pieces could not be downloaded. Check your connection (and that a firewall lets the launcher out), then try again.' };
  return { ok: true, checked: total, bad, repaired: bad.length };
}
function cancel(id) { const c = active.get(id); if (c) try { c.kill(); } catch {} }
const isChecking = (id) => active.has(id);
module.exports = { checkAndRepair, cancel, isChecking, TOOL_SHA256 };
