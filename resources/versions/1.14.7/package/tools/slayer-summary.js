// Dauntless Forever - Slayer summary for the Slayer copy page (1.6.2 and 1.14.7 side by side)
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
//
// Read only: nothing is written. Prints one line of JSON with the same few facts for your Slayer in each
// version, counted the same way on both sides so they can be compared:
//   {ok, v162:{...}|null, v1147:{...}|null}   each: {name, lastPlayed, gear, cosmetics, rams, maxed, reforges, path, pathOf}
// gear/cosmetics count only items that exist in BOTH versions; path counts only Slayer's Path nodes both versions
// have; maxed = weapon types at level 20 (a reforged weapon counts: it got there).
//   node tools\slayer-summary.js
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');                       // ...\versions\1.14.7
const R162 = process.env.DF_162_ROOT || path.join(path.dirname(ROOT), '1.6.2');
const DEFAULT_EPIC = 'd211000000000000000000000000e91c';
const TYPES = ['Axe', 'ChainBlades', 'Hammer', 'Repeaters', 'Spear', 'Strikers', 'Sword'];
const L20_162 = 64400, L20_1147 = 27775;                          // total weapon XP for level 20 in each version
const GEAR = /^(WP|AR|LT)_/;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; } };
const errs = [];

// what exists in both versions
function catalogs() {
  const c1147 = new Map(), k162 = new Set();
  const c = readJson(path.join(__dirname, 'catalog-1147.json'));
  for (const i of (c && c.items) || []) c1147.set(i.id, !!i.cosmetic);
  try { for (const l of fs.readFileSync(path.join(R162, 'tools', 'catalog162-ids.txt'), 'utf8').split(/\r?\n/)) if (l && !l.startsWith('#')) k162.add(l.trim()); } catch (e) { /* below */ }
  const cos = readJson(path.join(R162, 'tools', 'cosmetics-162.json'));
  for (const i of [...((cos && cos.stacked) || []), ...((cos && cos.instanced) || [])]) k162.add(i);
  for (const g of readJson(path.join(R162, 'tools', 'gear-162.json')) || []) k162.add(g[0]);
  return { c1147, k162, both: (id) => c1147.has(id) && k162.has(id) };
}
function countItems(ids, cat) {
  let gear = 0, cosmetics = 0;
  for (const id of ids) {
    if (!cat.both(id)) continue;
    if (GEAR.test(id)) gear++; else if (cat.c1147.get(id)) cosmetics++;
  }
  return { gear, cosmetics };
}
const doneNodes = (m) => new Set(Object.values((m && m.nodes) || {}).filter((n) => n && n.node_status === 2).map((n) => n.node_id));

function v162(cat) {
  const db162 = path.join(R162, 'data', 'undaunted.db');
  if (!fs.existsSync(db162)) return null;
  let Database;
  try { Database = require(process.env.DF_SQLITE || path.join(R162, 'backend', 'metagame', 'node_modules', 'better-sqlite3')); } catch (e) { errs.push('1.6.2 is not set up'); return null; }
  let key = ''; try { key = fs.readFileSync(path.join(R162, 'data', 'player.key'), 'utf8').trim(); } catch (e) { /* none */ }
  const db = new Database(db162, { readonly: true, fileMustExist: true });
  try {
    const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
    let row = key ? db.prepare('SELECT userId FROM userapikeys WHERE keyHash = ?').get(hash) : null;
    if (!row && key) { try { row = db.prepare('SELECT userId FROM userapikeystoregister WHERE key = ?').get(key); } catch (e) { /* none */ } }
    if (!row) return null;
    const ch = db.prepare('SELECT characterId, name, lastModifiedDate FROM characters WHERE userId = ? ORDER BY rowid').get(row.userId);
    if (!ch) return null;
    const inv = db.prepare('SELECT stackedItems, instancedItems FROM inventories WHERE characterId = ?').get(ch.characterId) || {};
    const st = JSON.parse(inv.stackedItems || '[]'), ins = JSON.parse(inv.instancedItems || '[]');
    const ids = new Set();
    for (const i of st) if (i && i.catalogId && Number(i.quantity) > 0) ids.add(i.catalogId);
    for (const i of ins) if (i && i.catalogId) ids.add(i.catalogId);
    const rams = Number((st.find((i) => i && i.catalogId === 'CURRENCY_NOTES') || {}).quantity) || 0;
    const bonus = readJson(path.join(R162, 'data', 'progression', row.userId + '.bonus.json')) || {};
    let maxed = 0, reforges = 0;
    for (const t of TYPES) {
      const xp = Number((bonus.xp || {})['ExperienceTrack_Weapon_' + t]) || 0;
      const pr = Number((bonus.prestige || {})['PrestigeTrack_Weapon_' + t]) || 0;
      reforges += pr; if (xp >= L20_162 || pr > 0) maxed++;
    }
    const pjm = readJson(path.join(R162, 'data', 'pjm', row.userId + '.json'));
    const all = new Set(Object.keys((pjm && pjm.nodes) || {}));
    // last played: the newest of the character's own files (the database date has no time and is not always updated)
    let t = Date.parse(ch.lastModifiedDate); if (isNaN(t)) t = 0;
    for (const f of [path.join('pjm', row.userId + '.json'), path.join('progression', row.userId + '.json'), path.join('progression', row.userId + '.bonus.json')]) {
      try { t = Math.max(t, fs.statSync(path.join(R162, 'data', f)).mtimeMs); } catch (e) { /* not there */ }
    }
    return { name: ch.name, lastPlayed: t ? new Date(t).toISOString() : null, ...countItems(ids, cat), rams, maxed, reforges,
      path: doneNodes(pjm).size, pathOf: all.size, pathIds: all };
  } finally { db.close(); }
}

function v1147(cat, pathIds162) {
  const stFile = path.join(ROOT, 'data', 'state.json');
  const st = readJson(stFile); if (!st) return null;
  let epic = DEFAULT_EPIC;
  try { const m = /^\s*EpicAccountId\s*=\s*([0-9a-f]{32})\s*$/im.exec(fs.readFileSync(path.join(ROOT, 'eos', 'eos_offline.ini'), 'utf8')); if (m) epic = m[1]; } catch (e) { /* default id */ }
  const p = st.players && st.players[crypto.createHash('sha256').update('epic:' + epic).digest('hex').slice(0, 32)];
  if (!p || !Array.isArray(p.characters) || !p.characters.length) return null;
  const ch = p.characters[0];
  const inv = (p.inventory || {})[ch.id] || {};
  const ids = new Set();
  for (const i of inv.stackedItems || []) if (i && i.catalogId && Number(i.quantity) > 0) ids.add(i.catalogId);
  for (const i of inv.instancedItems || []) if (i && i.catalogId) ids.add(i.catalogId);
  const rams = Number(((inv.stackedItems || []).find((i) => i && i.catalogId === 'CURRENCY_NOTES') || {}).quantity) || 0;
  const tr = (p.progress && p.progress.tracks) || {};
  let maxed = 0, reforges = 0;
  for (const t of TYPES) {
    const xp = Number((tr['ExperienceTrack_Weapon_' + t] || {}).progress) || 0;
    const pr = Number((tr['PrestigeTrack_Weapon_' + t] || {}).progress) || 0;
    reforges += pr; if (xp >= L20_1147 || pr > 0) maxed++;
  }
  const done = doneNodes((p.pjmMaps || {}).main);
  const shared = pathIds162 && pathIds162.size ? pathIds162 : null;
  let mt = null; try { mt = fs.statSync(stFile).mtime.toISOString(); } catch (e) { /* none */ }
  return { name: ch.name || p.username || 'Slayer', lastPlayed: mt, ...countItems(ids, cat), rams, maxed, reforges,
    path: shared ? [...done].filter((id) => shared.has(id)).length : done.size, pathOf: shared ? shared.size : Object.keys(((p.pjmMaps || {}).main || {}).nodes || {}).length };
}

try {
  const cat = catalogs();
  let a = null, b = null;
  try { a = v162(cat); } catch (e) { errs.push('1.6.2: ' + e.message); }
  try { b = v1147(cat, a && a.pathIds); } catch (e) { errs.push('1.14.7: ' + e.message); }
  if (a) delete a.pathIds;
  console.log(JSON.stringify({ ok: true, v162: a, v1147: b, notes: errs }));
} catch (e) { console.log(JSON.stringify({ ok: false, error: e.message })); }
