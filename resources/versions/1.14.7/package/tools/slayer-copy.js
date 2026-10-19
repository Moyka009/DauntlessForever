// Dauntless Forever - copy your Slayer between versions (1.6.2 <-> 1.14.7)
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
//
// A copy, never a move: the version you copy FROM is only read. The version you copy TO gets what it is missing:
//   - gear, cosmetics and unlocks it does not have yet are added (gear you already own is left as it is);
//   - currencies, materials and other counted items are raised to the higher of the two counts (never added on top),
//     so running it twice changes nothing and running it later just tops up.
// Items the other version does not have stay behind; they are listed (and kept in the save as a note).
// Story quests, the Slayer's Path, Hunt Pass and weapon/gear levels are kept per version and are not copied.
//
//   node tools\slayer-copy.js from-162 [--dry]   1.6.2 -> 1.14.7 (this package)
//   node tools\slayer-copy.js to-162   [--dry]   1.14.7 (this package) -> 1.6.2
// Both games must be closed (their local servers stopped). A backup of the save that is changed is made first.
'use strict';
const fs = require('fs'), path = require('path'), net = require('net'), crypto = require('crypto'), cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');                       // ...\versions\1.14.7
const R162 = process.env.DF_162_ROOT || path.join(path.dirname(ROOT), '1.6.2');
const STATE = path.join(ROOT, 'data', 'state.json');
const CAT1147 = path.join(__dirname, 'catalog-1147.json');      // KombatKing's 1.14.7 catalog (AGPL-3.0): id, storage
const DB162 = path.join(R162, 'data', 'undaunted.db');
const ITEMS162 = path.join(R162, 'tools', 'items.js');
const DEFAULT_EPIC = 'd211000000000000000000000000e91c';            // the offline sign-in's built-in id
// never copied: per-version progress and things that would unlock the wrong way
const SKIP = [/^CURRENCY_PJM_PRESTIGE_/, /^TOKEN_.*PROGRESSION/, /^BREAK_/, /^PJM_/];
const MAXQ = 99999999;

const say = (t) => console.log(t);
function stop(t) { say('STOPPED: ' + t); process.exit(1); }
function portUp(port) {
  return new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port }); const d = (v) => { s.destroy(); res(v); };
    s.setTimeout(800, () => d(false)); s.on('connect', () => d(true)); s.on('error', () => d(false)); });
}
const skip = (id) => SKIP.some((r) => r.test(id));

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
  return { p, ch, inv };
}
function catalog1147() {
  let c; try { c = JSON.parse(fs.readFileSync(CAT1147, 'utf8')); } catch (e) { stop('tools\\catalog-1147.json is missing. Update the 1.14.7 server files.'); }
  return new Map((c.items || []).map((i) => [i.id, i.storage === 'instance' ? 'instance' : 'stack']));
}

// ---------- 1.6.2: data\undaunted.db (read here), written through 1.6.2's own tools\items.js
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
  const ch = db.prepare('SELECT characterId, name FROM characters WHERE userId = ? ORDER BY rowid').get(row.userId);
  if (!ch) stop('No 1.6.2 character of yours on this PC yet. Play 1.6.2 once and make a character first.');
  const inv = db.prepare('SELECT stackedItems, instancedItems FROM inventories WHERE characterId = ?').get(ch.characterId) || {};
  return { id: ch.characterId, name: ch.name, stacked: JSON.parse(inv.stackedItems || '[]'), instanced: JSON.parse(inv.instancedItems || '[]') };
}
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

function report(lines, behind, file) {
  const txt = lines.join('\n') + (behind.length ? '\n\nStayed behind (the other version does not have these):\n  ' + behind.join('\n  ') : '') + '\n';
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
  const db = new Database(DB162, { readonly: true, fileMustExist: true });
  let src162; try { src162 = myChar162(db); } finally { db.close(); }
  const cat = catalog1147();
  const st = readState(); const me = me1147(st);

  if (dir === 'from-162') {
    const want = new Map();   // id -> { storage, qty }
    const behind = new Set();
    for (const i of src162.stacked) if (i && i.catalogId && Number(i.quantity) > 0) {
      const id = i.catalogId; if (skip(id)) continue;
      if (!cat.has(id)) { behind.add(id); continue; }
      const q = Math.min(MAXQ, Math.floor(Number(i.quantity)));
      want.set(id, { storage: cat.get(id), qty: Math.max(q, (want.get(id) || {}).qty || 0) });
    }
    for (const i of src162.instanced) if (i && i.catalogId) {
      const id = i.catalogId; if (skip(id)) continue;
      if (!cat.has(id)) { behind.add(id); continue; }
      if (!want.has(id)) want.set(id, { storage: cat.get(id), qty: 1 });
    }
    let gearAdded = 0, raised = 0, unlocked = 0, had = 0;
    for (const [id, w] of want) {
      if (w.storage === 'instance') {
        if (me.inv.instancedItems.some((x) => x && x.catalogId === id)) { had++; continue; }
        me.inv.instancedItems.push({ catalogId: id, instanceId: id, updateVersion: 1 }); gearAdded++;
      } else {
        const row = me.inv.stackedItems.find((x) => x && x.catalogId === id);
        if (!row) { me.inv.stackedItems.push({ catalogId: id, quantity: w.qty }); if (w.qty === 1) unlocked++; else raised++; }
        else if ((Number(row.quantity) || 0) < w.qty) { row.quantity = w.qty; raised++; }
        else had++;
      }
    }
    const left = [...behind].sort();
    me.p.slayerCopy1147 = { from: '1.6.2', character: src162.name, at: new Date().toISOString(), stayedBehind: left };
    if (!dry) {
      const bdir = path.join(ROOT, 'backup', 'slayer-copy'); fs.mkdirSync(bdir, { recursive: true });
      const bak = path.join(bdir, 'state.json.' + new Date().toISOString().replace(/[:.]/g, '-')); fs.copyFileSync(STATE, bak);
      const tmp = STATE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st)); JSON.parse(fs.readFileSync(tmp, 'utf8')); fs.renameSync(tmp, STATE);
    }
    report([`${dry ? 'PREVIEW (nothing changed): ' : ''}Copied ${src162.name} (1.6.2) into ${me.ch.name || 'your character'} (1.14.7).`,
      `  ${gearAdded} gear added, ${unlocked} cosmetics/unlocks added, ${raised} currencies/materials raised, ${had} you already had.`,
      `  ${left.length} stayed behind.`, 'Your 1.6.2 save was not changed. Quests, Slayer\'s Path, Hunt Pass and levels stay per version.'], left, 'slayer-copy.txt');
    return;
  }

  // to-162: 1.14.7 -> 1.6.2, through 1.6.2's own Inventory tool
  const k = ids162(); const behind = new Set(); const setList = {}; const gearList = [];
  const have = new Map(src162.stacked.filter((x) => x && x.catalogId).map((x) => [x.catalogId, Number(x.quantity) || 0]));
  const haveInst = new Set(src162.instanced.filter((x) => x && x.catalogId).map((x) => x.catalogId));
  for (const i of me.inv.stackedItems) if (i && i.catalogId && Number(i.quantity) > 0) {
    const id = i.catalogId; if (skip(id)) continue;
    if (!k.known.has(id)) { behind.add(id); continue; }
    if (k.gear.has(id) && !k.unlock.has(id)) { if (!haveInst.has(id)) gearList.push(id); continue; }
    const q = Math.min(MAXQ, Math.floor(Number(i.quantity)));
    if (k.unlock.has(id)) { if (!have.get(id) && !haveInst.has(id)) setList[id] = 1; continue; }
    if ((have.get(id) || 0) < q) setList[id] = q;
  }
  for (const i of me.inv.instancedItems) if (i && i.catalogId) {
    const id = i.catalogId; if (skip(id)) continue;
    if (!k.known.has(id)) { behind.add(id); continue; }
    if (haveInst.has(id) || have.get(id)) continue;
    if (k.unlock.has(id)) setList[id] = 1; else if (k.gear.has(id)) gearList.push(id); else behind.add(id);
  }
  const left = [...behind].sort(); const setIds = Object.keys(setList); const gear = [...new Set(gearList)];
  if (!dry) {
    for (const part of chunks(setIds, 150)) items162(['set', src162.id, JSON.stringify(Object.fromEntries(part.map((id) => [id, setList[id]])))]);
    for (const part of chunks(gear, 150)) items162(['addgear', src162.id, JSON.stringify(part)]);
  }
  report([`${dry ? 'PREVIEW (nothing changed): ' : ''}Copied ${me.ch.name || 'your character'} (1.14.7) into ${src162.name} (1.6.2).`,
    `  ${gear.length} gear added, ${setIds.length} cosmetics/currencies/materials added or raised.`,
    `  ${left.length} stayed behind.`, 'Your 1.14.7 save was not changed. Quests, Slayer\'s Path, Hunt Pass and levels stay per version.'], left, 'slayer-copy-to-162.txt');
})().catch((e) => stop(e.message));
