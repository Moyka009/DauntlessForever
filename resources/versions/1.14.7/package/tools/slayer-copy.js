// Dauntless Forever - copy your Slayer between versions (1.6.2 <-> 1.14.7)
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
//
// A copy, never a move: the version you copy FROM is only read. The version you copy TO gets what it is missing,
// and nothing it already has is lowered:
//   - items: gear, cosmetics and unlocks it lacks are added; currencies, materials and potions are raised to the higher
//     of the two counts (never added on top), so a second run changes nothing and a later run just tops up;
//   - weapon levels (per weapon type) are converted between the two versions' level curves and raised, never lowered;
//     reforges (Sparkforge) are raised to the higher count, with the reforged XP converted the same way;
//   - quests (the SERIE_* quest lines and the character flags) are merged: every quest and step keeps its furthest state;
//   - the Slayer's Path: every node unlocked in either version is unlocked in the target (where the node exists).
// What the target version does not have (items, Path nodes, quest lines) is parked in the target's
// data\slayer-copy-parked.json and listed on screen; it also stays in the version it came from.
// Not copied: the Hunt Pass, loadouts, gear levels/slotted cells and appearance (each version keeps its own).
//
//   node tools\slayer-copy.js from-162 [--dry]   1.6.2 -> 1.14.7 (this package)
//   node tools\slayer-copy.js to-162   [--dry]   1.14.7 (this package) -> 1.6.2
// Both games must be closed (their local servers stopped). Everything that is changed is backed up first.
'use strict';
const fs = require('fs'), path = require('path'), net = require('net'), crypto = require('crypto'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');                       // ...\versions\1.14.7
const R162 = process.env.DF_162_ROOT || path.join(path.dirname(ROOT), '1.6.2');
const STATE = path.join(ROOT, 'data', 'state.json');
const CAT1147 = path.join(__dirname, 'catalog-1147.json');      // KombatKing's 1.14.7 catalog (AGPL-3.0): id, storage
const DB162 = path.join(R162, 'data', 'undaunted.db');
const ITEMS162 = path.join(R162, 'tools', 'items.js');
const DEFAULT_EPIC = 'd211000000000000000000000000e91c';            // the offline sign-in's built-in id
const SKIP = [/^CURRENCY_PJM_PRESTIGE_/, /^TOKEN_.*PROGRESSION/, /^BREAK_/, /^PJM_/];   // per-version progress, never copied as items
const MAXQ = 99999999;
// 1.6.2 quest lines (from its game data and saves); a 1.14.7 line not in this list (or in any 1.6.2 save on this PC) is parked
const KNOWN162 = /^SERIE_(archon_tutorial_test|cr19_[a-z0-9_]+|cr20_pjm_quests|exotic|faction_[a-z0-9_]+|season_(0[0-9]|1[0-3])[a-z]?)$/;
const WEAPONS = ['Axe', 'ChainBlades', 'Hammer', 'Repeaters', 'Spear', 'Strikers', 'Sword'];
// XP needed for each next weapon level (level 1 -> 20). 1.6.2: 64,400 to level 20. 1.14.7 (progression config): 27,775.
const CURVE162 = [300, 400, 600, 1000, 1400, 1800, 2300, 2800, 3300, 3800, 4200, 4600, 4900, 5100, 5300, 5500, 5600, 5700, 5800];
const CURVE1147 = [350, 500, 700, 900, 1050, 1200, 1300, 1350, 1500, 1600, 1650, 1750, 1800, 1900, 1950, 1975, 2050, 2100, 2150];

const say = (t) => console.log(t);
function stop(t) { say('STOPPED: ' + t); process.exit(1); }
function portUp(port) {
  return new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port }); const d = (v) => { s.destroy(); res(v); };
    s.setTimeout(800, () => d(false)); s.on('connect', () => d(true)); s.on('error', () => d(false)); });
}
const skip = (id) => SKIP.some((r) => r.test(id));
const parse = (t, d) => { if (t && typeof t === 'object') return t; try { const v = JSON.parse(t); return v == null ? d : v; } catch (e) { return d; } };
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
function backupFile(file, dir) { if (!fs.existsSync(file)) return; fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(file, path.join(dir, path.basename(file) + '.' + stamp())); }
function writeJson(file, obj, pretty) { const tmp = file + '.tmp'; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(obj, null, pretty ? 2 : 0)); JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.renameSync(tmp, file); }

// ---------- weapon levels
function convertXp(xp, from, to) {
  xp = Math.max(0, Math.floor(Number(xp) || 0)); let level = 0, out = 0;
  while (level < from.length && xp >= from[level]) { xp -= from[level]; out += to[level]; level++; }
  if (level < from.length) out += Math.floor(to[level] * xp / from[level]);
  return out;
}
const levelOf = (xp, curve) => { let l = 1; xp = Number(xp) || 0; for (const c of curve) { if (xp < c) break; xp -= c; l++; } return l; };
const total = (curve) => curve.reduce((a, b) => a + b, 0);
const convertReforged = (xp, from, to) => Math.floor((Number(xp) || 0) * total(to) / total(from));

// ---------- quests (SERIE_* lines: {ID, <questGuid>: {Status, <stepGuid>: {Status, CurrentAmount}}}; Status 0..3)
function mergeNode(a, b) {
  if (!a || typeof a !== 'object') return b;
  if (!b || typeof b !== 'object') return a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object') out[k] = mergeNode(a[k], v);
    else if (typeof v === 'number' && /^(Status|CurrentAmount)$/.test(k)) out[k] = Math.max(Number(a[k]) || 0, v);
    else if (!(k in a)) out[k] = v;
  }
  return out;
}
// known: quest lines the target version has (null = all). Returns { data, added, merged, flags, parked }
function mergeQuests(targetData, sourceData, known) {
  const t = { ...parse(targetData, {}) }, s = parse(sourceData, {});
  const r = { added: [], merged: [], flags: 0, parked: {} };
  for (const [k, v] of Object.entries(s)) {
    if (!k.startsWith('SERIE_') || typeof v !== 'string') continue;
    const sv = parse(v, null); if (!sv || typeof sv !== 'object') continue;
    if (!(k in t)) { if (known && !known(k)) { r.parked[k] = v; continue; } t[k] = v; r.added.push(k.slice(6)); continue; }
    const tv = parse(t[k], null); if (!tv || typeof tv !== 'object') continue;
    const m = mergeNode(tv, sv); if (!('Status' in tv)) delete m.Status;
    const j = JSON.stringify(m); if (j !== t[k]) { t[k] = j; r.merged.push(k.slice(6)); }
  }
  for (const key of ['CharacterFlagData', 'LoginFlagData']) {
    const sf = parse(s[key], null), tf = parse(t[key], { Flags: [] });
    if (!sf || !Array.isArray(sf.Flags) || !tf || !Array.isArray(tf.Flags)) continue;
    const have = new Set(tf.Flags.map((f) => f && f.FlagKey)); let n = 0;
    for (const f of sf.Flags) if (f && f.FlagKey && !have.has(f.FlagKey)) { tf.Flags.push(f); n++; }
    if (n) { t[key] = JSON.stringify(tf); r.flags += n; }
  }
  if (s.HasFinishedTutorial === true && t.HasFinishedTutorial !== true) t.HasFinishedTutorial = true;
  r.data = JSON.stringify(t);
  return r;
}

// ---------- Slayer's Path ({nodes: {id: {node_id, node_status, objectives}}}; 2 = unlocked)
function mergePath(target, source) {
  const t = target && target.nodes && typeof target.nodes === 'object' && !Array.isArray(target.nodes) ? target : { nodes: {}, update_version: 0 };
  const r = { unlocked: 0, parked: [] };
  for (const [id, n] of Object.entries((source && source.nodes) || {})) {
    if (!n || n.node_status !== 2) continue;
    if (!t.nodes[id]) { r.parked.push(id); continue; }
    if (t.nodes[id].node_status !== 2) { t.nodes[id] = { ...t.nodes[id], node_status: 2 }; r.unlocked++; }
  }
  if (r.unlocked) t.update_version = (Number(t.update_version) || 0) + 1;
  return { path: t, ...r };
}

// ---------- 1.14.7 (this package): data\state.json, the player signed in on this PC
function readState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8').replace(/^﻿/, '')); } catch (e) { stop('No 1.14.7 save yet (data\\state.json). Play 1.14.7 once and make a character first.'); } }
function myKey1147() {
  let epic = DEFAULT_EPIC;
  try { const m = /^\s*EpicAccountId\s*=\s*([0-9a-f]{32})\s*$/im.exec(fs.readFileSync(path.join(ROOT, 'eos', 'eos_offline.ini'), 'utf8')); if (m) epic = m[1]; } catch (e) { /* default id */ }
  return crypto.createHash('sha256').update('epic:' + epic).digest('hex').slice(0, 32);
}
function me1147(st) {
  const p = st.players && st.players[myKey1147()];
  if (!p || !Array.isArray(p.characters) || !p.characters.length) stop('No 1.14.7 character of yours on this PC yet. Play 1.14.7 once and make a character first.');
  const ch = p.characters[0];
  p.inventory = p.inventory || {};
  const inv = p.inventory[ch.id] || (p.inventory[ch.id] = { stackedItems: [], instancedItems: [] });
  inv.stackedItems = inv.stackedItems || []; inv.instancedItems = inv.instancedItems || [];
  p.progress = p.progress || { tracks: {}, objectives: {} }; p.progress.tracks = p.progress.tracks || {};
  return { p, ch, inv };
}
function catalog1147() {
  let c; try { c = JSON.parse(fs.readFileSync(CAT1147, 'utf8')); } catch (e) { stop('tools\\catalog-1147.json is missing. Update the 1.14.7 server files.'); }
  return new Map((c.items || []).map((i) => [i.id, i.storage === 'instance' ? 'instance' : 'stack']));
}
const path1147 = (p) => { p.pjmMaps = p.pjmMaps || {}; return p.pjmMaps.main; };

// ---------- 1.6.2: data\undaunted.db, data\pjm\<UID>.json, data\progression\<UID>.bonus.json
function sqlite162() {
  const mod = process.env.DF_SQLITE || path.join(R162, 'backend', 'metagame', 'node_modules', 'better-sqlite3');
  try { return require(mod); } catch (e) { stop('The 1.6.2 server files are not set up on this PC (run 1.6.2 Set up first).'); }
}
function myChar162(db) {
  let key = ''; try { key = fs.readFileSync(path.join(R162, 'data', 'player.key'), 'utf8').trim(); } catch (e) { /* none */ }
  if (!key.startsWith('UUK_')) stop('Could not tell which 1.6.2 account is yours (data\\player.key). Run 1.6.2 Set up again.');
  const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex');
  let row = db.prepare('SELECT userId FROM userapikeys WHERE keyHash = ?').get(hash);
  if (!row) { try { row = db.prepare('SELECT userId FROM userapikeystoregister WHERE key = ?').get(key); } catch (e) { /* table missing */ } }
  if (!row) stop('Could not tell which 1.6.2 account is yours. Play 1.6.2 once first.');
  const ch = db.prepare('SELECT characterId, name, data, updateVersion FROM characters WHERE userId = ? ORDER BY rowid').get(row.userId);
  if (!ch) stop('No 1.6.2 character of yours on this PC yet. Play 1.6.2 once and make a character first.');
  const inv = db.prepare('SELECT stackedItems, instancedItems FROM inventories WHERE characterId = ?').get(ch.characterId) || {};
  const series = new Set();   // quest lines seen in any 1.6.2 save on this PC
  for (const r of db.prepare('SELECT data FROM characters').all()) for (const k of Object.keys(parse(r.data, {}))) if (k.startsWith('SERIE_')) series.add(k);
  return { series, user: row.userId, id: ch.characterId, name: ch.name, data: ch.data, updateVersion: ch.updateVersion,
    stacked: JSON.parse(inv.stackedItems || '[]'), instanced: JSON.parse(inv.instancedItems || '[]') };
}
const uidFile = (u) => String(u).replace(/[^\w-]/g, '_');
const pjmFile162 = (u) => path.join(R162, 'data', 'pjm', uidFile(u) + '.json');
const bonusFile162 = (u) => path.join(R162, 'data', 'progression', uidFile(u) + '.bonus.json');
function bonus162(u) { const b = parse(fs.existsSync(bonusFile162(u)) ? fs.readFileSync(bonusFile162(u), 'utf8') : null, {}); b.xp = b.xp || {}; b.reforgedXp = b.reforgedXp || {}; b.prestige = b.prestige || {}; return b; }
function ids162() {
  const known = new Set(), gear = new Set(), unlock = new Set();
  try { for (const l of fs.readFileSync(path.join(R162, 'tools', 'catalog162-ids.txt'), 'utf8').split(/\r?\n/)) if (l && !l.startsWith('#')) known.add(l.trim()); } catch (e) { /* none */ }
  try { const c = JSON.parse(fs.readFileSync(path.join(R162, 'tools', 'cosmetics-162.json'), 'utf8')); for (const i of [...(c.stacked || []), ...(c.instanced || [])]) { unlock.add(i); known.add(i); } } catch (e) { /* none */ }
  try { for (const g of JSON.parse(fs.readFileSync(path.join(R162, 'tools', 'gear-162.json'), 'utf8'))) { gear.add(g[0]); known.add(g[0]); } } catch (e) { /* none */ }
  if (!known.size) stop('The 1.6.2 item lists are missing (tools\\catalog162-ids.txt). Update the 1.6.2 server files.');
  return { known, gear, unlock };
}
function items162(args) {
  const r = cp.spawnSync(process.execPath, [ITEMS162, ...args], { cwd: R162, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let j = null; try { j = JSON.parse(r.stdout); } catch (e) { /* below */ }
  if (!j || !j.ok) stop('1.6.2 refused the change: ' + ((j && j.error) || r.stderr || r.stdout || 'no answer'));
  return j;
}
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

function park(file, from, parked) {
  const old = parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, {});
  const entry = { at: new Date().toISOString(), items: parked.items, pathNodes: parked.pathNodes, questLines: parked.questLines };
  old[from] = entry; writeJson(file, old, true);
}
function report(lines, parked, file) {
  const ql = Object.keys(parked.questLines).map((k) => k.slice(6));
  const txt = lines.join('\n') +
    (parked.items.length ? '\n\nItems the other version does not have (parked):\n  ' + parked.items.join('\n  ') : '') +
    (parked.pathNodes.length ? '\n\nSlayer\'s Path nodes the other version does not have (parked):\n  ' + parked.pathNodes.join('\n  ') : '') +
    (ql.length ? '\n\nQuest lines the other version does not have (parked):\n  ' + ql.join('\n  ') : '') + '\n';
  try { fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'logs', file), txt); } catch (e) { /* screen only */ }
  say(txt);
}

(async () => {
  const [dir] = process.argv.slice(2); const dry = process.argv.includes('--dry');
  if (dir !== 'from-162' && dir !== 'to-162') stop('Use: node tools\\slayer-copy.js from-162 | to-162 [--dry]');
  if (!fs.existsSync(DB162)) stop('Dauntless 1.6.2 is not installed and played on this PC (no 1.6.2 save found).');
  if (await portUp(63000)) stop('Dauntless 1.14.7 is running. Close the game and stop hosting first.');
  if (await portUp(61000)) stop('Dauntless 1.6.2 is running. Close the game and stop hosting first.');
  const Database = sqlite162();
  let db = new Database(DB162, { readonly: true, fileMustExist: true });
  let c162; try { c162 = myChar162(db); } finally { db.close(); }
  const st = readState(); const me = me1147(st);
  const pre = dry ? 'PREVIEW (nothing changed): ' : '';
  const note = 'The Hunt Pass, loadouts, gear levels, slotted cells and appearance stay per version.';

  if (dir === 'from-162') {
    const cat = catalog1147();
    // items
    const want = new Map(), behind = new Set();
    for (const i of c162.stacked) if (i && i.catalogId && Number(i.quantity) > 0) {
      const id = i.catalogId; if (skip(id)) continue; if (!cat.has(id)) { behind.add(id); continue; }
      const q = Math.min(MAXQ, Math.floor(Number(i.quantity))); want.set(id, { storage: cat.get(id), qty: Math.max(q, (want.get(id) || {}).qty || 0) });
    }
    for (const i of c162.instanced) if (i && i.catalogId) {
      const id = i.catalogId; if (skip(id)) continue; if (!cat.has(id)) { behind.add(id); continue; }
      if (!want.has(id)) want.set(id, { storage: cat.get(id), qty: 1 });
    }
    let gear = 0, raised = 0, unlocked = 0;
    for (const [id, w] of want) {
      if (w.storage === 'instance') { if (!me.inv.instancedItems.some((x) => x && x.catalogId === id)) { me.inv.instancedItems.push({ catalogId: id, instanceId: id, updateVersion: 1 }); gear++; } continue; }
      const row = me.inv.stackedItems.find((x) => x && x.catalogId === id);
      if (!row) { me.inv.stackedItems.push({ catalogId: id, quantity: w.qty }); if (w.qty === 1) unlocked++; else raised++; }
      else if ((Number(row.quantity) || 0) < w.qty) { row.quantity = w.qty; raised++; }
    }
    // weapon levels and reforges
    const b = bonus162(c162.user); const wl = [];
    for (const w of WEAPONS) {
      const id = 'ExperienceTrack_Weapon_' + w, pid = 'PrestigeTrack_Weapon_' + w;
      const t = me.p.progress.tracks[id] || { progress: 0 };
      const xp = convertXp(b.xp[id], CURVE162, CURVE1147), rx = convertReforged(b.reforgedXp[id], CURVE162, CURVE1147), pr = Number(b.prestige[pid]) || 0;
      const before = levelOf(t.progress, CURVE1147), beforeP = Number((me.p.progress.tracks[pid] || {}).progress) || 0;
      let changed = false;
      if (xp > (Number(t.progress) || 0)) { t.progress = xp; changed = true; }
      if (rx > (Number(t.reforgedXp) || 0)) { t.reforgedXp = rx; changed = true; }
      if (changed) me.p.progress.tracks[id] = t;
      if (pr > beforeP) { me.p.progress.tracks[pid] = { ...(me.p.progress.tracks[pid] || {}), progress: pr }; changed = true; }
      if (changed) wl.push(`${w} level ${before}->${levelOf(t.progress, CURVE1147)}${pr > beforeP ? ` (reforged ${pr}x)` : ''}`);
    }
    // quests
    const q = mergeQuests(me.ch.data, c162.data, null);
    if (q.data !== (me.ch.data || '{}') && (q.added.length || q.merged.length || q.flags)) { me.ch.data = q.data; me.ch.updateVersion = (Number(me.ch.updateVersion) || 0) + 1; }
    // Slayer's Path
    const p162 = parse(fs.existsSync(pjmFile162(c162.user)) ? fs.readFileSync(pjmFile162(c162.user), 'utf8') : null, null);
    const pm = mergePath(path1147(me.p), p162 || { nodes: {} });
    if (pm.unlocked) me.p.pjmMaps.main = pm.path;
    const parked = { items: [...behind].sort(), pathNodes: pm.parked.sort(), questLines: q.parked };
    if (!dry) {
      backupFile(STATE, path.join(ROOT, 'backup', 'slayer-copy'));
      writeJson(STATE, st);
      park(path.join(ROOT, 'data', 'slayer-copy-parked.json'), '1.6.2', parked);
    }
    report([`${pre}Copied ${c162.name} (1.6.2) into ${me.ch.name || 'your character'} (1.14.7).`,
      `  Items: ${gear} gear, ${unlocked} cosmetics/unlocks added, ${raised} currencies/materials raised.`,
      `  Weapons: ${wl.length ? wl.join(', ') : 'no change'}.`,
      `  Quests: ${q.added.length} quest lines added, ${q.merged.length} merged, ${q.flags} flags.`,
      `  Slayer's Path: ${pm.unlocked} nodes unlocked.`,
      `  Parked: ${parked.items.length} items, ${parked.pathNodes.length} Path nodes, ${Object.keys(parked.questLines).length} quest lines.`,
      'Your 1.6.2 save was not changed. ' + note], parked, 'slayer-copy.txt');
    return;
  }

  // ---- to-162: 1.14.7 -> 1.6.2
  const k = ids162(); const behind = new Set(); const setList = {}; const gearList = [];
  const have = new Map(c162.stacked.filter((x) => x && x.catalogId).map((x) => [x.catalogId, Number(x.quantity) || 0]));
  const haveInst = new Set(c162.instanced.filter((x) => x && x.catalogId).map((x) => x.catalogId));
  for (const i of me.inv.stackedItems) if (i && i.catalogId && Number(i.quantity) > 0) {
    const id = i.catalogId; if (skip(id)) continue; if (!k.known.has(id)) { behind.add(id); continue; }
    if (k.gear.has(id) && !k.unlock.has(id)) { if (!haveInst.has(id)) gearList.push(id); continue; }
    const qn = Math.min(MAXQ, Math.floor(Number(i.quantity)));
    if (k.unlock.has(id)) { if (!have.get(id) && !haveInst.has(id)) setList[id] = 1; continue; }
    if ((have.get(id) || 0) < qn) setList[id] = qn;
  }
  for (const i of me.inv.instancedItems) if (i && i.catalogId) {
    const id = i.catalogId; if (skip(id)) continue; if (!k.known.has(id)) { behind.add(id); continue; }
    if (haveInst.has(id) || have.get(id)) continue;
    if (k.unlock.has(id)) setList[id] = 1; else if (k.gear.has(id)) gearList.push(id); else behind.add(id);
  }
  const setIds = Object.keys(setList); const gear = [...new Set(gearList)];
  // weapon levels and reforges
  const b = bonus162(c162.user); const wl = []; let bonusChanged = false;
  for (const w of WEAPONS) {
    const id = 'ExperienceTrack_Weapon_' + w, pid = 'PrestigeTrack_Weapon_' + w;
    const t = me.p.progress.tracks[id] || {};
    const xp = convertXp(t.progress, CURVE1147, CURVE162), rx = convertReforged(t.reforgedXp, CURVE1147, CURVE162), pr = Number((me.p.progress.tracks[pid] || {}).progress) || 0;
    const before = levelOf(b.xp[id], CURVE162), beforeP = Number(b.prestige[pid]) || 0; let changed = false;
    if (xp > (Number(b.xp[id]) || 0)) { b.xp[id] = xp; changed = true; }
    if (rx > (Number(b.reforgedXp[id]) || 0)) { b.reforgedXp[id] = rx; changed = true; }
    if (pr > beforeP) { b.prestige[pid] = pr; changed = true; }
    if (changed) { bonusChanged = true; wl.push(`${w} level ${before}->${levelOf(b.xp[id], CURVE162)}${pr > beforeP ? ` (reforged ${pr}x)` : ''}`); }
  }
  // quests: only lines 1.6.2 already has or knows from its own quest list; the others are parked
  const q = mergeQuests(c162.data, me.ch.data, (key) => KNOWN162.test(key) || c162.series.has(key));
  const questsChanged = q.added.length || q.merged.length || q.flags;
  // Slayer's Path
  const pf = pjmFile162(c162.user);
  const p162 = parse(fs.existsSync(pf) ? fs.readFileSync(pf, 'utf8') : null, null);
  const pm = mergePath(p162 || { nodes: {}, update_version: 0 }, path1147(me.p) || { nodes: {} });
  const parked = { items: [...behind].sort(), pathNodes: pm.parked.sort(), questLines: q.parked };
  if (!dry) {
    const bdir = path.join(R162, 'backup', 'slayer-copy');
    backupFile(DB162, bdir); backupFile(pf, bdir); backupFile(bonusFile162(c162.user), bdir);
    if (questsChanged) {
      db = new Database(DB162, { fileMustExist: true });
      try { db.prepare('UPDATE characters SET data = ?, updateVersion = updateVersion + 1 WHERE characterId = ?').run(q.data, c162.id); } finally { db.close(); }
    }
    if (bonusChanged) writeJson(bonusFile162(c162.user), b, true);
    if (pm.unlocked && p162) writeJson(pf, pm.path);
    for (const part of chunks(setIds, 150)) items162(['set', c162.id, JSON.stringify(Object.fromEntries(part.map((id) => [id, setList[id]])))]);
    for (const part of chunks(gear, 150)) items162(['addgear', c162.id, JSON.stringify(part)]);
    park(path.join(R162, 'data', 'slayer-copy-parked.json'), '1.14.7', parked);
  }
  report([`${pre}Copied ${me.ch.name || 'your character'} (1.14.7) into ${c162.name} (1.6.2).`,
    `  Items: ${gear.length} gear added, ${setIds.length} cosmetics/currencies/materials added or raised.`,
    `  Weapons: ${wl.length ? wl.join(', ') : 'no change'}.`,
    `  Quests: ${q.added.length} quest lines added, ${q.merged.length} merged, ${q.flags} flags.`,
    `  Slayer's Path: ${pm.unlocked} nodes unlocked${p162 ? '' : ' (play 1.6.2 once first to copy the Path)'}.`,
    `  Parked: ${parked.items.length} items, ${parked.pathNodes.length} Path nodes, ${Object.keys(parked.questLines).length} quest lines.`,
    'Your 1.14.7 save was not changed. ' + note], parked, 'slayer-copy-to-162.txt');
})().catch((e) => stop(e.message));
