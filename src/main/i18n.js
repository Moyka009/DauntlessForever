// Dauntless Forever - launcher
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
// i18n.js (main) - the launcher language for the few texts the main process shows itself (Windows dialogs and
// notifications). It uses the window's dictionaries (renderer/i18n-xx.js, keyed by the English text), so there is
// one place to translate. The choice is launcher.json "uiLanguage" (Settings > Launcher language); unset = English.
// Errors sent to the window stay in English here: the window translates them before showing them (renderer/i18n.js tm).
'use strict';
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const DICTS = {};
const dir = path.join(__dirname, '..', 'renderer');
try {
  for (const f of fs.readdirSync(dir)) {
    if (!/^i18n-[\w-]+\.js$/.test(f)) continue;
    try { Object.assign(DICTS, require(path.join(dir, f))); } catch {}
  }
} catch {}

const codes = () => ['en', ...Object.keys(DICTS)];
const valid = (c) => typeof c === 'string' && (c === 'en' || Object.prototype.hasOwnProperty.call(DICTS, c));
// null while the player never picked one (the window then keeps what it last showed)
function saved() { try { const c = settings.load().uiLanguage; return valid(c) ? c : null; } catch { return null; } }
function save(code) { const c = valid(code) ? code : 'en'; settings.update(s => { s.uiLanguage = c; }); return c; }
function t(s, p) {
  s = String(s);
  const c = saved() || 'en', d = c !== 'en' && DICTS[c];
  let out = d && typeof d[s] === 'string' && d[s] ? d[s] : s;
  if (p) out = out.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m));
  return out;
}
module.exports = { t, saved, save, codes };
