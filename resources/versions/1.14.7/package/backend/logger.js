// Dauntless Forever - Dauntless 1.14.7 offline backend. Licence: AGPL-3.0-only.
// The small logger the chat server (realtime/) expects: its lines go to the backend's console and to logs\chat.log
// (that file is kept small: it starts over when it passes 2 MB). debug lines only with CHAT_DEBUG=1.
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.join(path.resolve(process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] : path.join(__dirname, '..')), 'logs', 'chat.log');
const t = () => new Date().toISOString().slice(11, 19);
const dbg = process.env.CHAT_DEBUG === '1';
function out(mark, m) {
  const line = `${t()} ${mark} ${m}`;
  console.log(line);
  try { if (fs.existsSync(FILE) && fs.statSync(FILE).size > 2e6) fs.unlinkSync(FILE); fs.appendFileSync(FILE, line + '\n'); } catch (e) { /* logs are optional */ }
}
exports.logger = {
  info: (m) => out(' ', m),
  warn: (m) => out('!', m),
  error: (m) => out('!', m),
  debug: (m) => { if (dbg) out(' ', m); },
};
