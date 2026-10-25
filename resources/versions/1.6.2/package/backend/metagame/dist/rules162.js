// Dauntless Forever - Dauntless 1.6.2 offline backend
// Copyright (C) 2026 Addison2k (port to this Dauntless build and all changes). https://github.com/addison2k/DauntlessForever
// Based on Undaunted, Copyright (C) gwog and contributors, https://github.com/SyST3MDeV/Undaunted
// Licence: AGPL-3.0-only (LICENSE-AGPL-3.0.txt). Keep this notice: the licence requires it.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rules = void 0;
exports.ScaleXp = ScaleXp;
exports.ApplyInventoryRules = ApplyInventoryRules;
//
// [rules] Game Rules: optional changes the player picks in the launcher (Game Rules page). The launcher writes
// data\rules.txt, start.ps1 turns it into these environment variables (defaults come from the package's rules.json):
//   RULE_WEAPON_XP      multiplier for Weapon Skill XP the game server grants (kills, wildlife, bounties). 1 = normal.
//   RULE_PASS_XP        multiplier for Hunt Pass XP. 1 = normal.
//   RULE_LOOT           multiplier for materials and Rams added by a hunt (pure "add" inventory transactions). 1 = normal.
//   RULE_FREE_CRAFTING  1 = crafting and upgrading keep their materials and Rams (you still need them to start).
// DF-RULES-162B (Oct 25), the same rules 1.14.7 has:
//   RULE_UNIVERSAL_XP        multiplies weapon XP, Hunt Pass XP and mastery progress together (on top of each one).
//   RULE_MASTERY_XP          extra mastery points when a mastery objective completes (1 = normal, never lowers).
//   RULE_RAMS                multiplier for Rams a hunt adds (on top of Loot amount).
//   RULE_WEAPON_MERITS       multiplier for Combat Merits (CURRENCY_PJM_WEAPON) a hunt adds.
//   RULE_EXPLORATION_MERITS  multiplier for Airship Merits (CURRENCY_PJM_AIRSHIP) a hunt adds.
//   RULE_RARE_CORES          multiplier for Rare Cell Cores (CONTAINER_CORE_GOLD_CELLCORE) a hunt adds.
//   RULE_RARE_CORE_KILL      1 = a hunt reward with one behemoth kill token also gives a Rare Cell Core.
//   RULE_TRIAL_BOSS / RULE_EXTRA_LOADOUT_SLOTS are read by tools\trials-schedule.cjs and controllers/loadout.ts.
// Every rule logs a "[rules]" line when it changes something, so a test hunt shows exactly what it did.
const logger_1 = require("./logger");
function Multiplier(name) {
    const v = Number(process.env[name] ?? 1);
    if (!Number.isFinite(v) || v <= 0)
        return 1;
    return Math.min(10, Math.max(0.1, v));
}
const Universal = Multiplier("RULE_UNIVERSAL_XP");
const Both = (a) => Math.min(100, Math.round(a * Universal * 1000) / 1000);
exports.Rules = {
    weaponXp: Both(Multiplier("RULE_WEAPON_XP")),
    passXp: Both(Multiplier("RULE_PASS_XP")),
    masteryXp: Math.max(1, Both(Multiplier("RULE_MASTERY_XP"))),
    loot: Multiplier("RULE_LOOT"),
    rams: Multiplier("RULE_RAMS"),
    weaponMerits: Multiplier("RULE_WEAPON_MERITS"),
    explorationMerits: Multiplier("RULE_EXPLORATION_MERITS"),
    rareCores: Multiplier("RULE_RARE_CORES"),
    rareCoreKill: (process.env.RULE_RARE_CORE_KILL ?? "0") === "1",
    freeCrafting: (process.env.RULE_FREE_CRAFTING ?? "0") === "1",
};
logger_1.logger.info(`[rules] Game Rules: weapon XP x${exports.Rules.weaponXp}, Hunt Pass XP x${exports.Rules.passXp}, mastery x${exports.Rules.masteryXp} ` +
    `(universal x${Universal}), loot x${exports.Rules.loot}, Rams x${exports.Rules.rams}, Combat Merits x${exports.Rules.weaponMerits}, ` +
    `Airship Merits x${exports.Rules.explorationMerits}, Rare Cell Cores x${exports.Rules.rareCores}, core per kill ${exports.Rules.rareCoreKill ? "on" : "off"}, ` +
    `free crafting ${exports.Rules.freeCrafting ? "on" : "off"}`);
const RARE_CORE = "CONTAINER_CORE_GOLD_CELLCORE";
const KILL_TOKEN = /^TOKEN_KILL_COUNT_[A-Z0-9]+_[A-Z0-9]+$/;
// How much a hunt reward of this item is multiplied by. Merits are Slayer's Path currencies (IsProtected) and only
// change by their own rules; everything else Loot amount already covered keeps it.
function AddFactor(catalogId) {
    if (catalogId === "CURRENCY_PJM_WEAPON")
        return exports.Rules.weaponMerits;
    if (catalogId === "CURRENCY_PJM_AIRSHIP")
        return exports.Rules.explorationMerits;
    if (IsProtected(catalogId))
        return 1;
    let f = exports.Rules.loot;
    if (catalogId === "CURRENCY_NOTES")
        f *= exports.Rules.rams;
    if (catalogId === RARE_CORE)
        f *= exports.Rules.rareCores;
    return Math.min(100, f);
}
const AnyAddRule = () => exports.Rules.loot !== 1 || exports.Rules.rams !== 1 || exports.Rules.weaponMerits !== 1 || exports.Rules.explorationMerits !== 1
    || exports.Rules.rareCores !== 1 || exports.Rules.rareCoreKill;
// Scale an XP amount. Never rounds a real grant down to 0.
function ScaleXp(amount, factor) {
    if (!(amount > 0) || factor === 1)
        return amount;
    return Math.max(1, Math.round(amount * factor));
}
// Items no rule may touch: progression tokens, Slayer's Path currencies, fusion tokens, season fragments.
function IsProtected(catalogId) {
    const id = String(catalogId ?? "");
    return id.startsWith("TOKEN_") || id.startsWith("CURRENCY_PJM") || id.startsWith("CURRENCY_TOKEN")
        || id.startsWith("CURRENCY_SEASON") || id.includes("PRESTIGE") || id === "";
}
// Changes a transaction before it is stored. Returns the catalogIds whose removal was skipped (free crafting), so the
// route can report their unchanged counts back to the game.
function ApplyInventoryRules(tx, transactionId, fromGameServer) {
    const kept = [];
    const instancedAdd = tx.instancedAdd ?? [], stackedAdd = tx.stackedAdd ?? [];
    const instancedRemove = tx.instancedRemove ?? [], stackedRemove = tx.stackedRemove ?? [];
    const instancedSave = tx.instancedSave ?? [];
    const touchesFusion = [...instancedAdd, ...instancedRemove, ...instancedSave].some((i) => i?.catalogId === "TOKEN_CELL_EXCHANGE");
    // Loot: a transaction that only ADDS stacked items (end-of-hunt rewards, gathering) gets more of them.
    if (AnyAddRule() && fromGameServer && stackedAdd.length > 0
        && stackedRemove.length === 0 && instancedRemove.length === 0 && instancedSave.length === 0 && !touchesFusion) {
        const changed = [];
        let adds = stackedAdd;
        // DF-RULES-162B: Rare Cell Core on behemoth kill (one kill token in the reward, no core in it already)
        const kills = adds.filter((i) => KILL_TOKEN.test(String(i?.catalogId ?? "")) && Number(i?.quantity) > 0);
        if (exports.Rules.rareCoreKill && kills.length === 1 && Number(kills[0].quantity) <= 100 && !adds.some((i) => i?.catalogId === RARE_CORE)) {
            adds = [...adds, { catalogId: RARE_CORE, quantity: Number(kills[0].quantity) }];
            changed.push(`${RARE_CORE} +${kills[0].quantity} for ${kills[0].catalogId}`);
        }
        tx.stackedAdd = adds.map((i) => {
            const q = Number(i?.quantity);
            const f = AddFactor(String(i?.catalogId ?? ""));
            if (f === 1 || !(q > 0))
                return i;
            const nq = Math.max(1, Math.round(q * f));
            if (nq !== q)
                changed.push(`${i.catalogId} ${q}->${nq}`);
            return { ...i, quantity: nq };
        });
        if (changed.length)
            logger_1.logger.info(`[rules] hunt rewards on ${transactionId}: ${changed.join(", ")}`);
    }
    // Free crafting: a transaction that spends stacked items AND creates or changes gear (craft, upgrade) keeps them.
    if (exports.Rules.freeCrafting && stackedRemove.length > 0 && (instancedAdd.length > 0 || instancedSave.length > 0) && !touchesFusion) {
        const stillRemove = [];
        for (const i of stackedRemove) {
            if (IsProtected(i?.catalogId))
                stillRemove.push(i);
            else
                kept.push(String(i.catalogId));
        }
        tx.stackedRemove = stillRemove;
        if (kept.length) {
            const made = [...instancedAdd, ...instancedSave].map((i) => i?.catalogId).filter(Boolean).join(", ");
            logger_1.logger.info(`[rules] free crafting on ${transactionId}: kept ${stackedRemove.filter((i) => kept.includes(String(i.catalogId)))
                .map((i) => `${i.catalogId} x${i.quantity}`).join(", ")} (made/changed ${made})`);
        }
    }
    // While any inventory rule is on, describe each spending transaction once, so a test shows its real shape.
    if ((exports.Rules.freeCrafting || AnyAddRule()) && (stackedRemove.length > 0 || instancedRemove.length > 0) && !kept.length) {
        const ids = (a) => a.map((i) => `${i?.catalogId}${i?.quantity != null ? " x" + i.quantity : ""}`).join(", ") || "-";
        logger_1.logger.info(`[rules] untouched ${transactionId} (${fromGameServer ? "game server" : "client"}): ` +
            `add [${ids(instancedAdd)}] [${ids(stackedAdd)}] remove [${ids(instancedRemove)}] [${ids(stackedRemove)}] save [${ids(instancedSave)}]`);
    }
    return kept;
}
