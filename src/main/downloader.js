// Dauntless Forever - launcher
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
// downloader.js - fetches a build from Epic's CDN with manifest.exe (meszmate/manifest, MIT, with the
// uncompressed-chunk fix from the DauntlessManifestArchive repo). Progress is parsed from its progress bar.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { IS_WIN, MOCK, bundledToolsDir } = require('./paths');

const BASE_URL = 'https://epicgames-download1.akamaized.net/Builds/Org/o-krlzxj88qrtb69fredeuaf887bl5az/Jackal/default';
const TOOL_SHA256 = 'e7ad5835e927ffb0020f7b0b05cc2bdef025ce94f31984d89ec99df340f6c204';

const active = new Map(); // versionId -> child

function toolPath() { return path.join(bundledToolsDir(), 'manifest.exe'); }
function toolOk() {
  try {
    const h = crypto.createHash('sha256').update(fs.readFileSync(toolPath())).digest('hex');
    return h === TOOL_SHA256;
  } catch { return false; }
}

// DF-ASSEMBLE (Oct 21): after the bar reaches 100% the tool still glues the downloaded pieces (.manifest-cache) into
// the game files, then deletes the pieces. It prints nothing while it does that (minutes on a hard drive), so players
// thought the launcher froze at 100%. The launcher now measures what is written instead: the game files' size against
// the installed size from version.json, then "tidying up" while the pieces are being removed.
function gameBytes(dir) {
  let n = 0;
  const walk = (d) => {
    let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (e.name === '.manifest-cache') continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f); else { try { n += fs.statSync(f).size; } catch {} }
    }
  };
  walk(dir);
  return n;
}
function watchAssembly(v, outDir, onProgress) {
  const totalB = (Number(v.download && v.download.installedGB) || 0) * 1073741824;   // installedGB is the manifest's GB (GiB): 1.14.7 15.39 = 16.5e9 bytes
  const cache = path.join(outDir, '.manifest-cache');
  const t0 = Date.now();
  const tick = () => {
    const done = gameBytes(outDir);
    const gb = (x) => (x / 1073741824).toFixed(2) + ' GB';
    if (totalB && done >= totalB * 0.995 && fs.existsSync(cache)) {
      onProgress({ stage: 'cleanup', stagePct: null, stageDone: gb(done), stageTotal: gb(totalB), stageSecs: Math.round((Date.now() - t0) / 1000) });
    } else {
      onProgress({ stage: 'assemble', stagePct: totalB ? Math.min(100, Math.floor(done * 100 / totalB)) : null, stageDone: gb(done), stageTotal: totalB ? gb(totalB) : '', stageSecs: Math.round((Date.now() - t0) / 1000) });
    }
  };
  tick();
  return setInterval(tick, 3000);
}
// onProgress({ pct, done, total, speed, eta, line }) ; resolves { code, failed, summary }
function download(v, outDir, onProgress, onLine) {
  return new Promise((resolve) => {
    if (active.has(v.id)) return resolve({ code: 1, error: 'already downloading' });
    fs.mkdirSync(outDir, { recursive: true });
    if (!IS_WIN) return mockDownload(v, onProgress, onLine, resolve);
    if (!toolOk()) return resolve({ code: 1, error: 'The download tool (tools\\manifest.exe) is missing or damaged. Reinstall the launcher.' });
    const args = ['download', v.download.manifestUrl, '--base-url', BASE_URL, '--output', outDir, '--concurrency', '16'];
    const child = spawn(toolPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    active.set(v.id, child);
    let summary = '', failed = null, total = null, lastErrLine = '', errorLine = '';
    let assembly = null;   // DF-ASSEMBLE: the second bar's timer, started at 100%
    // e.g. "Downloading  45% |████    | (994 MB/12 GB, 272 MB/s) [3s:40s]"  or  "(12/12 GB, 260 MB/s)" (unit once)
    const re = /(\d{1,3})%.*?\(([\d.]+(?:\s*[KMGT]?i?B)?)\s*\/\s*([\d.]+\s*[KMGT]?i?B)(?:,\s*([^)\]]+))?\)(?:\s*\[([^\]]*)\])?/;
    child.stderr.on('data', (d) => {
      const txt = d.toString('utf8');
      for (const piece of txt.split(/[\r\n]+/)) {
        if (!piece.trim()) continue;
        const m = re.exec(piece);
        if (m) {
          let done = m[2].trim(), total = m[3].trim();
          if (!/[A-Za-z]/.test(done)) done += ' ' + total.replace(/^[\d.]+\s*/, '');   // "12/12 GB" -> "12 GB"
          onProgress({ pct: +m[1], done, total, speed: m[4] || '', eta: prettyEta(m[5] || ''), line: piece.trim() });
          if (+m[1] >= 100 && !assembly) assembly = watchAssembly(v, outDir, onProgress);
        }
        else if (/^\s*Downloading\b.*%/.test(piece)) { /* a progress line in a shape we did not expect: not for the log */ }
        else {
          lastErrLine = piece.trim();
          // the tool prints its real error first, then its help text: keep the first "Error: ..." line
          if (!errorLine && /^\s*Error:/i.test(piece)) errorLine = lastErrLine;
          onLine(lastErrLine, /error|fail|denied|cannot|403|404/i.test(piece));
        }
      }
    });
    child.stdout.on('data', (d) => {
      const txt = d.toString('utf8'); summary += txt;
      for (const l of txt.split(/\r?\n/)) {
        if (!l.trim()) continue;
        onLine(l.trim(), false);
        const f = /failed:\s*(\d+)/.exec(l); if (f) failed = +f[1];
        const c = /Chunks:\s*(\d+)/.exec(l); if (c) total = +c[1];
      }
    });
    child.on('exit', (code) => { if (assembly) clearInterval(assembly); active.delete(v.id); resolve({ code: code == null ? 1 : code, failed, total, summary, lastErrLine, errorLine }); });
    child.on('error', (e) => { if (assembly) clearInterval(assembly); active.delete(v.id); resolve({ code: 1, error: 'Could not start the download tool: ' + e.message }); });
  });
}

// "3s:40s" is the progress bar's "elapsed:remaining"; show only what is left, as plain words
function prettyEta(s) {
  const parts = s.split(':'); const rem = (parts[1] || parts[0] || '').trim();
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(rem.replace(/\s/g, ''));
  if (!m) return rem;
  const h = +m[1] || 0, mi = +m[2] || 0, se = +m[3] || 0;
  if (h) return `${h} h ${mi} min`; if (mi) return `${mi} min`; return `${se} s`;
}
function cancel(id) {
  const c = active.get(id);
  if (!c) return false;
  c.kill(); // partial chunks stay in <outDir>\.manifest-cache; running again resumes
  return true;
}
function isDownloading(id) { return active.has(id); }

function mockDownload(v, onProgress, onLine, resolve) {
  let pct = 0;
  onLine('(mock) manifest download ' + v.download.manifestUrl, false);
  active.set(v.id, { kill() { active.delete(v.id); } });
  const t = setInterval(() => {
    if (!active.has(v.id)) { clearInterval(t); return resolve({ code: 1, failed: null, summary: 'cancelled' }); }
    pct += 7;
    onProgress({ pct: Math.min(pct, 100), done: (v.download.downloadGB * pct / 100).toFixed(2) + ' GB', total: v.download.downloadGB + ' GB', speed: '48 MB/s', eta: Math.max(0, 100 - pct) + 's', line: '' });
    if (pct >= 100) { clearInterval(t); active.delete(v.id); onLine('Download complete in 1m2s', false); onLine('  Chunks:    1234 (skipped: 0, failed: 0)', false); resolve({ code: 0, failed: 0, summary: 'ok' }); }
  }, 400);
}

module.exports = { download, cancel, isDownloading, toolOk, BASE_URL };
