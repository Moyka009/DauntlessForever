// Dauntless Forever - launcher tools (Inventory page helper for 1.14.7)
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
//
// Reads and changes the items in this package's save, data\state.json (written by backend\recorder-1147.js).
// Same commands and replies as the 1.6.2 helper, so the launcher's Inventory page works the same for both:
//   node tools\items.js list
//       -> {"ok":true,"characters":[{"id","name","items":{"CURRENCY_NOTES":1200,...},"gear":[...]}],"gearCatalog":[...]}
//   node tools\items.js set <characterId|*> <JSON {"CATALOG_ID": count, ...}>
//       sets each count (0 removes the item); "*" = every character of yours. Backs the save up first.
//   node tools\items.js addgear <characterId|*> <JSON ["WP_EB_ROCK", "CC_HAIR_SPIKED", ...]>
//       adds anything in the Inventory picker (tools\gear-1147.json): gear at level 0, and cosmetics the way the game
//       keeps each one (an unlock, a stack of 1, or a one-of-a-kind item; tools\catalog-1147.json says which).
//       Things you already have are left as they are.
//   node tools\items.js removegear <characterId> <JSON ["<instanceId or unlock id>", ...]>
//       removes gear or a cosmetic; anything in one of your loadouts or worn (equipped) is refused.
//   node tools\items.js addcosmetic <characterId|*> <JSON [...]> | all
//       same as addgear for cosmetics; "all" unlocks every cosmetic in the picker at once.
// Typing it yourself (PowerShell drops the quotes inside JSON): the list can also be plain words after the character,
//   node tools\items.js set * CURRENCY_NOTES=50000 TOKEN_BOUNTY_DRAFT=10
//   node tools\items.js addgear * CC_HAIR_SPIKED AC_HEAD_UNSEEN_00
// Only your own Slayers are listed or changed (the player eos\eos_offline.ini signs in as); friends who visited while
// you hosted keep theirs. Refuses while the local backend is running (port 63000): it keeps the save in memory and
// would overwrite the change.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STATE = path.join(ROOT, "data", "state.json");
const ID_OK = /^[A-Za-z0-9_-]{3,80}$/;
const MAX = 99999999;
const KEEP_BACKUPS = 10;
const DEFAULT_EPIC = "d211000000000000000000000000e91c";   // the offline sign-in's built-in id (as slayer-copy.js)
const STARTER = new Set(["WP_EB_TRAINING", "LT_BASIC"]);  // the backend hands these back anyway (no spawn without them)

function out(o) { process.stdout.write(JSON.stringify(o)); }
function fail(error) { out({ ok: false, error }); process.exit(0); }

// The picker: [id, name, type, storage] with storage "i" (one-of-a-kind item) or "s" (unlock, a stack of 1)
function picker() {
    try { const d = JSON.parse(fs.readFileSync(path.join(__dirname, "gear-1147.json"), "utf8").replace(/^﻿/, "")); return d && Array.isArray(d.items) ? d : null; }
    catch { return null; }
}

function backendUp() {
    return new Promise((resolve) => {
        const s = net.connect({ host: "127.0.0.1", port: 63000 });
        const done = (v) => { s.destroy(); resolve(v); };
        s.setTimeout(800, () => done(false));
        s.on("connect", () => done(true));
        s.on("error", () => done(false));
    });
}
function readState() {
    if (!fs.existsSync(STATE)) fail("No save yet. Press Play once and make a character first.");
    try { return JSON.parse(fs.readFileSync(STATE, "utf8").replace(/^﻿/, "")); }
    catch { fail("The save file could not be read (data\\state.json)."); }
}
function writeState(state) {
    const tmp = STATE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    JSON.parse(fs.readFileSync(tmp, "utf8"));   // read back before it replaces the save
    fs.renameSync(tmp, STATE);
}
// Your player: the key the game's sign-in gives eos\eos_offline.ini's EpicAccountId here (same rule as slayer-copy.js)
function myKey() {
    let epic = DEFAULT_EPIC;
    try { const m = /^\s*EpicAccountId\s*=\s*([0-9a-f]{32})\s*$/im.exec(fs.readFileSync(path.join(ROOT, "eos", "eos_offline.ini"), "utf8")); if (m) epic = m[1]; } catch {}
    return crypto.createHash("sha256").update("epic:" + epic).digest("hex").slice(0, 32);
}
// Your characters with their inventories (the recorder keys inventories by character id)
function characters(state) {
    const players = state.players || {};
    const p = players[myKey()] || players[state.lastPlayer];
    if (!p) return [];
    const list = [];
    for (const ch of p.characters || []) {
        if (!ch || !ch.id) continue;
        if (!p.inventory) p.inventory = {};
        if (!p.inventory[ch.id]) p.inventory[ch.id] = { stackedItems: [], instancedItems: [] };
        const inv = p.inventory[ch.id];
        if (!Array.isArray(inv.stackedItems)) inv.stackedItems = [];
        if (!Array.isArray(inv.instancedItems)) inv.instancedItems = [];
        const lo = p.loadouts && p.loadouts[ch.id];
        list.push({ id: ch.id, name: ch.name || "", inv, worn: JSON.stringify(lo || {}) });
    }
    return list;
}
const worn = (c, id) => c.worn.includes('"' + id + '"');
function backup() {
    const dir = path.join(ROOT, "backup", "inventory");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    fs.copyFileSync(STATE, path.join(dir, `state.json.${stamp}`));
    const old = fs.readdirSync(dir).filter((f) => f.startsWith("state.json.")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
}
// The change list: one JSON argument (the launcher), or plain words (typed by hand): ID=count for set, IDs otherwise
function argList(kind) {
    const rest = process.argv.slice(4);
    const raw = rest.join(" ").trim();
    if (raw.startsWith("{") || raw.startsWith("[")) { try { return JSON.parse(raw); } catch { return null; } }
    if (kind === "set") {
        const o = {};
        for (const w of rest) { const m = /^([A-Za-z0-9_-]{3,80})=(\d+)$/.exec(w.trim()); if (!m) return null; o[m[1]] = Number(m[2]); }
        return o;
    }
    return rest.map((w) => w.trim()).filter(Boolean);
}
const unlockHeld = (inv, id) => inv.stackedItems.some((x) => x && x.catalogId === id && Number(x.quantity) > 0);
// Add one picker entry to a character: true when it changed something
function addOne(inv, id, storage) {
    if (storage === "i") {
        if (inv.instancedItems.some((x) => x && x.catalogId === id)) return false;
        // Same shape as the items the backend and Slayer copy hand out: the item id doubles as the instance id
        const instanceId = inv.instancedItems.some((x) => x && x.instanceId === id) ? crypto.randomUUID() : id;
        inv.instancedItems.push({ catalogId: id, instanceId, updateVersion: 1 });
        return true;
    }
    if (unlockHeld(inv, id)) return false;
    inv.stackedItems = inv.stackedItems.filter((x) => !x || x.catalogId !== id);
    inv.stackedItems.push({ catalogId: id, quantity: 1 });
    return true;
}

(async () => {
    const [cmd, who] = process.argv.slice(2);

    if (cmd === "list") {
        const pk = picker();
        const types = pk ? new Map(pk.items.map((g) => [g[0], g[3]])) : null;
        const chars = characters(readState()).map((c) => {
            const items = {};
            for (const i of c.inv.stackedItems) if (i && i.catalogId) items[i.catalogId] = Number(i.quantity) || 0;
            let gear;
            if (types) {
                gear = [];
                for (const i of c.inv.instancedItems) if (i && types.has(i.catalogId)) {
                    let level = 0; try { level = Number(JSON.parse(i.itemData || "{}").CurrentLevel) || 0; } catch {}
                    gear.push({ id: i.catalogId, instanceId: i.instanceId, level, equipped: worn(c, i.instanceId) || STARTER.has(i.catalogId) });
                }
                // cosmetics kept as an unlock show in the gear list too, so they can be seen and removed there
                for (const i of c.inv.stackedItems) if (i && Number(i.quantity) > 0 && types.get(i.catalogId) === "s" && !gear.some((g) => g.id === i.catalogId))
                    gear.push({ id: i.catalogId, instanceId: i.catalogId, level: 0, equipped: worn(c, i.catalogId) });
            }
            return { id: c.id, name: c.name, items, gear };
        });
        out({ ok: true, characters: chars, gearCatalog: pk ? pk.items.map((g) => [g[0], g[1], g[2]]) : undefined,
            gearTypes: pk ? pk.types : undefined, unlockAll: !!pk });
        return;
    }

    if (cmd === "set") {
        const want = argList("set");
        if (!want || typeof want !== "object" || Array.isArray(want)) fail("Bad change list. Use ID=count, for example CURRENCY_NOTES=50000.");
        const changes = Object.entries(want).filter(([id, n]) => ID_OK.test(id) && Number.isFinite(Number(n)));
        if (!changes.length) fail("Nothing to change.");
        if (await backendUp()) fail("Dauntless is still running. Close the game (and the launcher's server window), then try again.");
        const state = readState();
        const targets = characters(state).filter((c) => who === "*" || c.id === who);
        if (!targets.length) fail("Character not found.");
        backup();
        const result = {};
        for (const c of targets) {
            for (const [id, raw] of changes) {
                const n = Math.max(0, Math.min(MAX, Math.floor(Number(raw))));
                const st = c.inv.stackedItems;
                const i = st.findIndex((x) => x && x.catalogId === id);
                if (n === 0) { if (i >= 0) st.splice(i, 1); }
                else if (i >= 0) st[i].quantity = n;
                else st.push({ catalogId: id, quantity: n });
                result[id] = n;
            }
        }
        writeState(state);
        out({ ok: true, set: result });
        return;
    }

    if (cmd === "addgear" || cmd === "addcosmetic" || cmd === "removegear") {
        const pk = picker();
        if (!pk) fail("This version's server files have no item list (tools\\gear-1147.json). Update the server files.");
        const storage = new Map(pk.items.map((g) => [g[0], g[3]]));
        let list = argList("list");
        const all = cmd !== "removegear" && Array.isArray(list) && list.length === 1 && String(list[0]).toLowerCase() === "all";
        // "all": every cosmetic in the picker (not gear: weapons, armour, lanterns, parts and omnicells stay as they are)
        if (all) { const gearKinds = new Set(["Weapons", "Armour", "Lanterns", "Weapon parts", "Omnicells"]); list = pk.items.filter((g) => !gearKinds.has(g[2])).map((g) => g[0]); }
        if (!Array.isArray(list) || !list.length || list.length > 5000) fail("Nothing to change.");
        if (await backendUp()) fail("Dauntless is still running. Close the game (and the launcher's server window), then try again.");
        const state = readState();
        const mine = characters(state);
        if (who !== "*" && !mine.some((c) => c.id === who)) fail("Character not found.");
        if (who === "*" && cmd === "removegear") fail("Remove gear one character at a time.");
        const targets = mine.filter((c) => who === "*" || c.id === who);
        if (!targets.length) fail("Character not found.");
        const result = { added: [], already: [], removed: [], equipped: [], unknown: [] };
        let changed = false;
        for (const c of targets) {
            if (cmd === "removegear") {
                for (const iid of list) {
                    const id = String(iid);
                    if (storage.get(id) === "s" && unlockHeld(c.inv, id)) {
                        if (worn(c, id)) { result.equipped.push(id); continue; }
                        c.inv.stackedItems = c.inv.stackedItems.filter((x) => !x || x.catalogId !== id); result.removed.push(id); changed = true; continue;
                    }
                    const i = c.inv.instancedItems.findIndex((x) => x && x.instanceId === id && storage.has(x.catalogId));
                    if (i < 0) { result.unknown.push(id); continue; }
                    const item = c.inv.instancedItems[i];
                    if (worn(c, id) || STARTER.has(item.catalogId)) { result.equipped.push(item.catalogId); continue; }
                    result.removed.push(item.catalogId); c.inv.instancedItems.splice(i, 1); changed = true;
                }
                continue;
            }
            for (const raw of list) {
                const id = String(raw);
                if (!storage.has(id)) { if (!result.unknown.includes(id)) result.unknown.push(id); continue; }
                if (addOne(c.inv, id, storage.get(id))) { result.added.push(id); changed = true; } else result.already.push(id);
            }
        }
        if (changed) { backup(); writeState(state); }
        if (all) out({ ok: true, all: true, addedCount: result.added.length, alreadyCount: result.already.length, characters: targets.length });
        else out({ ok: true, ...result });
        return;
    }
    fail("Unknown command.");
})().catch((e) => fail(String(e && e.message || e)));
