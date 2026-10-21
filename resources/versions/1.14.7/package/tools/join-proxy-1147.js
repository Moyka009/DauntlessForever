// Dauntless Forever - Dauntless 1.14.7 offline package
// Copyright (C) 2026 Addison2k. https://github.com/addison2k/DauntlessForever
// Licence: AGPL-3.0-only. Keep this notice: the licence requires it.
// join-proxy-1147.js - runs on the FRIEND's PC while "LAN - JOIN.bat" joins a host through the relay.
// The game talks to its usual local backend addresses (127.0.0.1:63000-63027). This proxy listens there and sends
// each connection to the host's relay address, first telling the host's gateway which backend port it is for.
// Usage: node join-proxy-1147.js <relay address> <relay port> [ready file]
'use strict';
const net = require('net'), fs = require('fs');
const [, , HOST, PORT, READY] = process.argv;
const LO = 63000, HI = 63027;
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(HOST || '') || !(/^[0-9]+$/.test(PORT||'') && Number.isInteger(Number(PORT)) && Number(PORT)>=1 && Number(PORT)<=65535)) { console.log('usage: node join-proxy-1147.js <relay address> <relay port> [ready file]'); process.exit(2); }
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
let open = 0, failed = false;
// DF-CHAT-1147: the game's chat connects to ws://127.0.0.1:5222 (the exe adds the XMPP port to ChatEndpoint itself);
// it is carried like the backend ports, to the host's 63000, where the backend takes chat connections.
const CHAT_LOCAL = 5222, CHAT_HOST_PORT = 63000;
const ports = [];
for (let p = LO; p <= HI; p++) ports.push([p, p]);
ports.push([CHAT_LOCAL, CHAT_HOST_PORT]);
for (const [p, dest] of ports) {
  const s = net.createServer((client) => {
    client.setNoDelay(true);
    const up = net.connect(Number(PORT), HOST);
    up.setNoDelay(true);
    const kill = () => { client.destroy(); up.destroy(); };
    up.on('error', kill); client.on('error', kill); up.on('close', kill); client.on('close', kill);
    up.on('connect', () => { up.write(`DFPORT ${dest}\n`); client.pipe(up); up.pipe(client); });
  });
  s.on('error', (e) => {
    if (p === CHAT_LOCAL) { log(`chat: cannot use port ${p} on this PC (${e.code || e.message}); playing without in-game chat`); if (++open === ports.length) ready(); return; }
    if (!failed) { failed = true; log(`cannot use port ${p} on this PC (${e.code || e.message}). Is Dauntless 1.14.7 still running here?`); process.exit(1); }
  });
  s.listen(p, '127.0.0.1', () => { if (++open === ports.length) ready(); });
}
function ready() {
  log(`join proxy ready: 127.0.0.1:${LO}-${HI} and chat ${CHAT_LOCAL} -> ${HOST}:${PORT}`);
  if (READY) try { fs.writeFileSync(READY, JSON.stringify({ host: HOST, port: Number(PORT), pid: process.pid })); } catch (e) {}
}
const bye = () => { if (READY) try { fs.unlinkSync(READY); } catch (e) {} process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
