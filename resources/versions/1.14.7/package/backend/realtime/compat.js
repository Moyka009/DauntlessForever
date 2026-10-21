// Dauntless Forever - Dauntless 1.14.7 offline backend
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only (LICENSE-AGPL-3.0.txt). Keep this notice: the licence requires it.
//
// compat.js (DF-CHAT-1147) - what the chat server (chat.js, muc.js, presence.js: from Dauntless Revived,
// github.com/mixutin/dauntless-revived, AGPL-3.0, by way of the 1.6.2 package) expects from the backend,
// answered from recorder-1147.js: accounts and names from state.players, parties from the party service.
// The recorder calls bind() once with its lookups. 1.14.7 keeps no friends or blocks yet: empty.
'use strict';
const { EventEmitter } = require('node:events');
const net = require('node:net');

let B = null;   // { playerByAccount(id) -> player|null, accountFromToken(token) -> accountId|null, partyIdOf(accountId) -> id|null }
function bind(lookups) { B = lookups; }

const KeyRevocations = new EventEmitter();
const ACCOUNT_ID_RULE = /^[A-Za-z0-9_-]{1,64}$/;
function IsAccountIdShape(v) { return typeof v === 'string' && ACCOUNT_ID_RULE.test(v); }

// The game logs in to chat with SASL PLAIN: its account id and a token it already holds. Accepted: a session
// token this backend handed out (PUT /gamesession), or the sign-in token whose account is that id.
function ValidateMetagameJWTAndGetPayload(token) {
  const id = B && B.accountFromToken(String(token || ''));
  if (!id) { const e = new Error('not a token of this backend'); e.name = 'JsonWebTokenError'; throw e; }
  return { userId: id };
}
function FindUsernameForUserId(id) {
  if (!IsAccountIdShape(id) || !B) return undefined;
  const p = B.playerByAccount(id);
  return p ? (p.username || 'Slayer') : undefined;
}
const FriendshipListeners = new Set();
function AddFriendshipListener(l) { FriendshipListeners.add(l); return () => FriendshipListeners.delete(l); }
function NotifyFriendship(ev) { for (const l of FriendshipListeners) { try { l(ev); } catch (e) { /* never breaks the caller */ } } }
function ListFriends() { return []; }
function IsBlockedEitherWay() { return false; }
function BlockersAmong() { return new Set(); }
function GetPartyOf(id) { const p = B && B.partyIdOf(id); return p ? { PartyId: p } : undefined; }
function IsGuildMember() { return false; }   // no guilds here: guild rooms admit nobody

function ParseOnOff(raw) {
  const v = String(raw || '').toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  return undefined;
}
function ChatPresence() { return ParseOnOff((process.env.CHAT_PRESENCE || '').trim()) ?? false; }   // no friends store: off
function ClientAddressOf(req) {
  const raw = req.socket && req.socket.remoteAddress;
  if (typeof raw !== 'string') return 'unknown';
  const plain = (/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(raw) || [])[1] || raw;
  return net.isIP(plain) !== 0 ? plain.toLowerCase() : 'unknown';
}
function IsTrustedGatewayRequest() { return false; }

module.exports = { bind, KeyRevocations, ACCOUNT_ID_RULE, IsAccountIdShape, ValidateMetagameJWTAndGetPayload, FindUsernameForUserId,
  AddFriendshipListener, NotifyFriendship, ListFriends, IsBlockedEitherWay, BlockersAmong, GetPartyOf, IsGuildMember,
  ParseOnOff, ChatPresence, ClientAddressOf, IsTrustedGatewayRequest };
