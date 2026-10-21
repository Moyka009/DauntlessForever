-- SPDX-License-Identifier: AGPL-3.0-only
-- healthbar: behemoth health bars for Dauntless 1.6.2 (Dauntless Forever / UE4SS)
-- Copyright (C) 2026 the healthbar authors
--
-- This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General
-- Public License, version 3, as published by the Free Software Foundation. It is distributed WITHOUT ANY WARRANTY;
-- see the LICENSE file. Keep this notice.
--
-- v9: tracks the behemoths you are fighting in Dauntless 1.6.2 and writes their health and shield to a
-- small JSON file, which the overlay window (healthbar-overlay.ps1) shows on screen.
--
-- Why a file and not an in-game bar: calling game functions from Lua does not return usable results in this setup,
-- but reading properties works. The bundled DamageMeter hands its numbers over the same way.
--
-- A behemoth only gets a bar once its health (or shield) drops right after one of YOUR hits, so behemoths you have
-- not touched never show up. Every engaged behemoth gets its own bar, up to MAX_BARS, in the order you hit them.
--
-- Client only: it needs the local player's controller, which hidden server copies do not have.
-- F4 = refresh now. Everything is logged as [healthbar] lines in UE4SS.log.

local HEARTBEAT       = 2.0    -- seconds: rewrite the file this often while bars are showing, even if nothing changed
local PC_SEARCH_EVERY = 3.0    -- seconds between searches for the local player while none is known
local LIST_EVERY      = 2.0    -- seconds between searches for behemoths
local HIT_WINDOW      = 1.5    -- a health drop within this many seconds of one of my hits counts as my damage
local LINGER          = 3.0    -- seconds to keep a dead behemoth's empty bar on screen
local MAX_BARS        = 4

local HIT_HOOK = "/Script/Archon.ArchonCombatTextComponent:MulticastSendMultitypeCombatText"

-- Start healthbar-overlay.ps1 by itself when the game starts (it quits again when the game closes).
-- Set this to false if you would rather start the overlay yourself (start-healthbar-overlay.bat). See README.txt.
local AUTO_START_OVERLAY = false   -- Dauntless Forever starts the overlay itself when this mod is on

---------------------------------------------------------------- helpers
local function log(m) print("[healthbar] " .. tostring(m) .. "\n") end
local logged = {}
local function logOnce(k, m) if not logged[k] then logged[k] = true log(m) end end

local function valid(o)
    if not o then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v
end

local function nameOf(o)
    local ok, n = pcall(function() return o:GetFullName() end)
    return ok and n or nil
end

local function pathOf(full) return full and full:match("^%S+%s+(.+)$") end

-- the launcher sets DF_METER_DIR for the game (its %LOCALAPPDATA% is a private copy); same folder as DamageMeter
local Dir = os.getenv("DF_METER_DIR")
    or (os.getenv("LOCALAPPDATA") and (os.getenv("LOCALAPPDATA") .. "\\DauntlessOffline"))
    or nil
local OutFile = Dir and (Dir .. "\\healthbar.json")

---------------------------------------------------------------- the local player (cached, property reads only)
local PC_CLASSES = {"player_controller_bp_C", "ArchonPlayerController", "PlayerController"}

local function isLocal(pc)
    local okP, pl = pcall(function() return pc.Player end)
    if not (okP and valid(pl)) then return false end
    local n = nameOf(pl)
    if not n then return false end
    n = n:lower()
    return (n:find("localplayer", 1, true) or n:find("local_player", 1, true)) and true or false
end

local function findLocalPC()
    for _, cls in ipairs(PC_CLASSES) do
        for _, pc in ipairs(FindAllOf(cls) or {}) do
            if valid(pc) then
                local n = nameOf(pc)
                if not (n and n:find("Default__", 1, true)) and isLocal(pc) then return pc end
            end
        end
    end
    return nil
end

local function diagnose()
    log("no local player controller found in this process (normal for a hidden server copy)")
    log("diag: LocalPlayer objects " .. #(FindAllOf("LocalPlayer") or {}))
    for _, cls in ipairs(PC_CLASSES) do
        local list = FindAllOf(cls) or {}
        log(string.format("diag: %s -> %d objects", cls, #list))
        for i, pc in ipairs(list) do
            if i > 3 then break end
            local okP, pl = pcall(function() return pc.Player end)
            log(string.format("diag:   %s | Player=%s", nameOf(pc) or "?", okP and (nameOf(pl) or tostring(pl)) or "ERR"))
        end
    end
end

local pcCache, lastSearch, diagCount = nil, -100, 0
local function getPC(force, now)
    if valid(pcCache) then return pcCache end
    pcCache = nil
    if not force and now - lastSearch < PC_SEARCH_EVERY then return nil end
    lastSearch = now
    pcCache = findLocalPC()
    if pcCache then
        log("local player found: " .. (nameOf(pcCache) or "?"))
    elseif force or diagCount < 2 then
        diagCount = diagCount + 1
        diagnose()
    end
    return pcCache
end

---------------------------------------------------------------- starting the overlay window
local function fileExists(path)
    local f = io.open(path, "r")
    if f then f:close() return true end
    return false
end

-- this mod's own folder (the one that holds Scripts\ and healthbar-overlay.ps1)
local function modFolder()
    local function scriptsParent(p)
        if not p then return nil end
        p = p:gsub("^@", "")
        local dir = p:match("^(.*)[/\\][Ss][Cc][Rr][Ii][Pp][Tt][Ss][/\\][^/\\]*$")
        if dir and dir:match("^%a:[/\\]") then return dir end
        return nil
    end
    local ok, info = pcall(function() return debug.getinfo(1, "S") end)
    if ok and info then
        local d = scriptsParent(info.source)
        if d and fileExists(d .. "\\healthbar-overlay.ps1") then return d end
    end
    -- UE4SS puts every mod's Scripts folder on package.path: take the one that sits next to the overlay script
    for entry in tostring(package.path):gmatch("[^;]+") do
        local dir = entry:match("^(.*)[/\\][Ss][Cc][Rr][Ii][Pp][Tt][Ss][/\\]%?%.lua$")
        if dir and dir:match("^%a:[/\\]") and fileExists(dir .. "\\healthbar-overlay.ps1") then return dir end
    end
    return nil
end

local overlayTried = false
local function startOverlay()
    if overlayTried or not AUTO_START_OVERLAY then return end
    overlayTried = true
    if type(os.execute) ~= "function" then
        log("auto-start: os.execute is not available here; start start-healthbar-overlay.bat yourself")
        return
    end
    local base = modFolder()
    if not base then
        log("auto-start: could not find healthbar-overlay.ps1 next to the Scripts folder; start start-healthbar-overlay.bat yourself")
        return
    end
    local script = base .. "\\healthbar-overlay.ps1"
    local outDir = Dir and (Dir:gsub("[/\\]+$", ""))
    if script:find('"', 1, true) or (outDir and outDir:find('"', 1, true)) then
        log("auto-start skipped: unusual characters in a path")
        return
    end
    local cmd = 'start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' .. script .. '" -QuitWhenGameCloses'
    if outDir and outDir ~= "" then cmd = cmd .. ' -Dir "' .. outDir .. '"' end
    log("auto-start: " .. cmd)
    local ok, err = pcall(os.execute, cmd)
    if not ok then log("auto-start failed: " .. tostring(err)) end
end

---------------------------------------------------------------- my hits (the damage-number hook, property reads only)
local myHitAt, hookSeen = -100, false

-- the PlayerState behind a hit's source: the source itself, or its instigator / owner (projectiles, buffs)
local function playerStateOf(src)
    if not valid(src) then return nil end
    local ok, ps = pcall(function() return src.PlayerState end)
    if ok and valid(ps) then return ps end
    for _, field in ipairs({"Instigator", "Owner"}) do
        local ok2, o = pcall(function() return src[field] end)
        if ok2 and valid(o) then
            local ok3, ps2 = pcall(function() return o.PlayerState end)
            if ok3 and valid(ps2) then return ps2 end
        end
    end
    return nil
end

local function addressOf(o)
    local ok, a = pcall(function() return o:GetAddress() end)
    return ok and a or nil
end

local function localPSAddress()
    if not valid(pcCache) then return nil end
    local ok, ps = pcall(function() return pcCache.PlayerState end)
    if ok and valid(ps) then return addressOf(ps) end
    return nil
end

local function onHits(entries)
    local mine = localPSAddress()
    entries:ForEach(function(i, elem)
        hookSeen = true
        if mine then
            local ps = playerStateOf(elem:get().SourceActor)
            if ps and addressOf(ps) == mine then myHitAt = os.clock() end
        end
    end)
end

---------------------------------------------------------------- behemoths (cached list)
local bList, lastList, lastCount = {}, -100, -1
local function behemoths(now, force)
    local every = (#bList == 0) and 1.0 or LIST_EVERY
    if force or now - lastList >= every then
        lastList = now
        bList = {}
        for _, b in ipairs(FindAllOf("ArchonBehemoth") or {}) do
            if valid(b) then
                local n = nameOf(b)
                if n and not n:find("Default__", 1, true) then bList[#bList + 1] = b end
            end
        end
        if #bList ~= lastCount then lastCount = #bList log("ArchonBehemoth objects: " .. #bList) end
    end
    return bList
end

---------------------------------------------------------------- health / shield (properties of the attribute set)
local attrSets, attrMissAt = {}, {}

local function readNum(obj, prop)
    local ok, v = pcall(function() return obj[prop] end)
    if ok and type(v) == "number" then return v end
    return nil
end

-- a behemoth's ArchonHealthAttributeSet is a subobject: its path starts with the behemoth's path + ".".
-- If several match (e.g. parts), take the one with the biggest MaxHealth: that is the behemoth's own.
local function attrFor(key)
    local a = attrSets[key]
    if valid(a) then return a end
    attrSets[key] = nil
    local now = os.clock()
    if attrMissAt[key] and now - attrMissAt[key] < 2 then return nil end
    local path = pathOf(key)
    if not path then return nil end
    local best, bestMax = nil, -1
    for _, s in ipairs(FindAllOf("ArchonHealthAttributeSet") or {}) do
        if valid(s) then
            local sp = pathOf(nameOf(s))
            if sp and sp:sub(1, #path + 1) == path .. "." then
                local m = readNum(s, "MaxHealth") or 0
                if m > bestMax then best, bestMax = s, m end
            end
        end
    end
    if best then attrSets[key] = best attrMissAt[key] = nil else attrMissAt[key] = now end
    return best
end

---------------------------------------------------------------- names
-- "lerawr_beta_bp_C /Game/..." -> "lerawr_beta" (the game's internal name; the overlay maps it to the real name)
local function idOf(key)
    local cls = (key and key:match("^(%S+)")) or "behemoth"
    cls = cls:lower():gsub("_c$", ""):gsub("_bp$", "")
    return (cls:gsub("[^%w_]", ""))
end

local function prettyName(id)
    local n = id:gsub("_beta$", ""):gsub("_", " ")
    n = n:gsub("(%a)(%w*)", function(a, b) return a:upper() .. b end)
    return (n:gsub("[^%w _%-]", ""))
end

-- The hunt map's short name, from the behemoth's object path (shown as a hint when a new behemoth needs naming)
local function mapOf(key)
    local m = key and key:match("%s(/[^%.:]+)")
    m = m and m:match("([^/]+)$")
    return ((m or ""):gsub("[^%w_%-]", ""))
end

-- Try to read the behemoth's real in-game name from the game's own data: a name-like property on the behemoth, or on
-- one data object it points to. Anything that does not look like a human name (paths, code names, empty) is ignored.
local NAME_WORDS = {"displayname", "behemothname", "localizedname", "creaturename", "friendlyname", "monstername",
                    "enemyname", "nametext", "title"}
local DATA_WORDS = {"data", "definition", "descriptor", "config", "info", "asset", "profile", "spec"}

local function hasWord(lower, words)
    for i, w in ipairs(words) do
        if lower:find(w, 1, true) then return i end
    end
    return nil
end

local function textOf(v)
    if type(v) == "string" then return v end
    if v == nil then return nil end
    local ok, s = pcall(function() return v:ToString() end)
    if ok and type(s) == "string" then return s end
    return nil
end

local function plausibleName(s, id)
    if not s then return nil end
    s = s:gsub("^%s+", ""):gsub("%s+$", "")
    if #s < 3 or #s > 40 or not s:find("%a") or s:find("[/\\:_%.]") then return nil end
    local l = s:lower()
    if l == "none" or l == id or l:gsub("%s", "") == id:gsub("_", "") then return nil end
    return (s:gsub('[%c"\\]', ""))
end

local function propNames(obj)
    local list = {}
    local okC, c = pcall(function() return obj:GetClass() end)
    local depth = 0
    while okC and valid(c) and depth < 12 do
        pcall(function()
            c:ForEachProperty(function(p)
                local okN, pn = pcall(function() return p:GetFName():ToString() end)
                if okN and pn then list[#list + 1] = pn end
            end)
        end)
        local okS, sup = pcall(function() return c:GetSuperStruct() end)
        if not (okS and valid(sup)) then break end
        c = sup
        depth = depth + 1
    end
    return list
end

local function gameNameOf(b, id)
    local best, bestScore, bestFrom = nil, 1e9, nil
    local function consider(obj, depth)
        for _, pn in ipairs(propNames(obj)) do
            local l = pn:lower()
            local w = hasWord(l, NAME_WORDS)
            if w then
                local okV, v = pcall(function() return obj[pn] end)
                local name = okV and plausibleName(textOf(v), id) or nil
                local score = w + depth * 20
                if name and score < bestScore then
                    best, bestScore, bestFrom = name, score, (depth > 0 and "data object: " or "") .. pn
                end
            elseif depth == 0 and hasWord(l, DATA_WORDS) then
                local okV, v = pcall(function() return obj[pn] end)
                if okV and valid(v) then consider(v, 1) end      -- one level deep only
            end
        end
    end
    pcall(consider, b, 0)
    return best, bestFrom
end

-- once per kind of behemoth: print the properties that might hold its real in-game name, so it can be matched later
local nameDumped = {}
local function dumpNameProps(b, id)
    if nameDumped[id] then return end
    nameDumped[id] = true
    log("name-related properties of " .. id .. ":")
    local okK, cls0 = pcall(function() return b:GetClass() end)
    if okK and valid(cls0) then log("  class: " .. (nameOf(cls0) or "?")) end
    local okC, c = pcall(function() return b:GetClass() end)
    local n, depth = 0, 0
    while okC and valid(c) and depth < 10 and n < 60 do
        pcall(function()
            c:ForEachProperty(function(p)
                local pn = p:GetFName():ToString()
                local l = pn:lower()
                if n < 60 and (l:find("name", 1, true) or l:find("type", 1, true) or l:find("tier", 1, true)
                    or l:find("variant", 1, true) or l:find("species", 1, true) or l:find("threat", 1, true)
                    or l:find("behemoth", 1, true) or hasWord(l, DATA_WORDS)) then
                    n = n + 1
                    local okV, v = pcall(function() return b[pn] end)
                    local s = "?"
                    if okV then
                        local t = type(v)
                        if t == "string" or t == "number" or t == "boolean" then
                            s = tostring(v)
                        else
                            local okS, str = pcall(function() return v:ToString() end)
                            if okS and str then
                                s = tostring(str)
                            else
                                local okF, full = pcall(function() return v:GetFullName() end)
                                s = okF and tostring(full) or t
                            end
                        end
                    end
                    log(string.format("  %s = %s", pn, s))
                end
            end)
        end)
        local okS, sup = pcall(function() return c:GetSuperStruct() end)
        if not (okS and valid(sup)) then break end
        c = sup
        depth = depth + 1
    end
end

---------------------------------------------------------------- engaged behemoths
local entries, order = {}, {}      -- entries[key] = bar data; order = keys in the order they were engaged
local lastHp, lastShield = {}, {}

local function engage(key, b, hp, mx)
    local id = idOf(key)
    local okG, gname, gfrom = pcall(gameNameOf, b, id)
    if not okG then gname, gfrom = nil, nil end
    entries[key] = {key = key, id = id, name = prettyName(id), gameName = gname, map = mapOf(key),
                    hp = hp, mx = mx, shield = 0, peak = 0, deadAt = nil}
    order[#order + 1] = key
    log(string.format("engaged: id=%s  health %.0f / %.0f  in-game name: %s", id, hp, mx,
        gname and (gname .. "  (from " .. tostring(gfrom) .. ")") or "not found"))
    dumpNameProps(b, id)
end

local function drop(key)
    entries[key] = nil
    for i = #order, 1, -1 do
        if order[i] == key then table.remove(order, i) end
    end
end

---------------------------------------------------------------- output file
local lastBody, lastWriteAt = nil, -100
local function writeBars(now)
    if not OutFile then logOnce("nodir", "no output folder known, nothing will be written") return end
    local list = {}
    for i = math.max(1, #order - MAX_BARS + 1), #order do
        local e = entries[order[i]]
        if e then
            list[#list + 1] = string.format(
                '{"id":"%s","name":"%s","gameName":"%s","map":"%s","hp":%.0f,"max":%.0f,"shield":%.0f,"shieldMax":%.0f}',
                e.id, e.name, e.gameName or "", e.map or "", math.max(e.hp, 0), e.mx, e.shield, e.peak)
        end
    end
    local body = table.concat(list, ",")
    if body == lastBody and (#list == 0 or now - lastWriteAt < HEARTBEAT) then return end
    local f = io.open(OutFile, "w")
    if not f then logOnce("openfail", "cannot write " .. OutFile) return end
    f:write(string.format('{"v":2,"time":%d,"bars":[%s]}', os.time(), body))
    f:close()
    lastBody, lastWriteAt = body, now
    logOnce("writing", "writing " .. OutFile)
end

---------------------------------------------------------------- one pass
local function tick(force)
    local now = os.clock()
    local pc = getPC(force, now)
    if not pc then return end
    startOverlay()      -- only the real game gets here (it has a local player); runs once

    local seen = {}
    for _, b in ipairs(behemoths(now, force)) do
        if valid(b) then
            local key = nameOf(b)
            local a = key and attrFor(key)
            local hp = a and readNum(a, "CurrentHealth")
            local mx = a and readNum(a, "MaxHealth")
            if key and hp and mx and mx > 0 then
                seen[key] = true
                local s = readNum(a, "CurrentShield") or 0
                local prevHp, prevShield = lastHp[key], lastShield[key]
                lastHp[key], lastShield[key] = hp, s

                -- engaged = its health or shield dropped right after one of my hits
                if not entries[key] and prevHp ~= nil then
                    local dropped = hp < prevHp - 0.01 or (prevShield ~= nil and s < prevShield - 0.01)
                    if dropped and (now - myHitAt <= HIT_WINDOW or not hookSeen) then engage(key, b, hp, mx) end
                end

                local e = entries[key]
                if e then
                    e.hp, e.mx = hp, mx
                    if s > 0.5 then
                        e.shield = s
                        e.peak = math.max(e.peak, s)
                    else
                        e.shield, e.peak = 0, 0
                    end
                    if hp <= 0 and not e.deadAt then e.deadAt = now end
                end
            end
        end
    end

    local gone = {}
    for k, e in pairs(entries) do
        if not seen[k] or (e.deadAt and now - e.deadAt > LINGER) then gone[#gone + 1] = k end
    end
    for _, k in ipairs(gone) do drop(k) end
    for k in pairs(lastHp) do
        if not seen[k] then lastHp[k], lastShield[k], attrSets[k], attrMissAt[k] = nil, nil, nil, nil end
    end

    writeBars(now)
end

local function run(force)
    local ok, e = pcall(tick, force)
    if not ok then logOnce("tick", "ERROR in tick: " .. tostring(e)) end
end

---------------------------------------------------------------- start
local okH, errH = pcall(function()
    RegisterHook(HIT_HOOK, function(self, Entries)
        local ok, e = pcall(function() onHits(Entries:get()) end)
        if not ok then logOnce("hit", "could not read a hit: " .. tostring(e)) end
    end)
end)
LoopAsync(250, function() run(false) return false end)
RegisterKeyBind(Key.F4, function() run(true) end)
log("v9 loaded; will write " .. tostring(OutFile) .. (okH and "" or ("  (hit hook failed: " .. tostring(errH) .. ")")))
