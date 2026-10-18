// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('fs'),path=require('path');
const MAX_LOG=8*1024*1024;
function validState(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||!s.players||typeof s.players!=='object'||Array.isArray(s.players))throw Error('Invalid player save structure');
 return s;
}
function atomicWrite(file,data){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.'+process.pid+'.tmp';let fd;
 try{
  fd=fs.openSync(tmp,'w',0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.renameSync(tmp,file);
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}}
}
function loadState(file){
 try{return {state:validState(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))),recovered:false};}
 catch(error){
  if(error.code==='ENOENT'&&!fs.existsSync(file+'.bak'))return {state:{players:{},lastPlayer:null},recovered:false};
  let backup;
  try{backup=fs.readFileSync(file+'.bak','utf8');validState(JSON.parse(backup));}
  catch{throw Error('Player save is unreadable and has no valid backup. Original files preserved: '+file);}
  const preserved=file+'.corrupt-'+Date.now();if(fs.existsSync(file))fs.copyFileSync(file,preserved);
  atomicWrite(file,backup);
  return {state:JSON.parse(backup),recovered:true,preserved};
 }
}
function saveState(file,state){
 const data=JSON.stringify(validState(state),null,2);
 if(fs.existsSync(file)){
  const old=fs.readFileSync(file,'utf8');validState(JSON.parse(old));
  if(old===data)return false; // Reads that initialize nothing do not rewrite the save.
  atomicWrite(file+'.bak',old);
 }
 atomicWrite(file,data);return true;
}
function appendLog(file,entry,maxBytes=MAX_LOG){
 const text=JSON.stringify(entry)+'\n';
 if(fs.existsSync(file)&&fs.statSync(file).size+Buffer.byteLength(text)>maxBytes){
  for(let n=3;n>=1;n--){
   const from=n===1?file:file+'.'+(n-1),to=file+'.'+n;
   if(n===3&&fs.existsSync(to))fs.unlinkSync(to);
   if(fs.existsSync(from))fs.renameSync(from,to);
  }
 }
 fs.appendFileSync(file,text);
}
function httpError(status,message){const e=Error(message);e.status=status;return e;}
function playerKey(req,state,sessions,bearer,epicKey){
 const keys=Object.keys(state.players),token=bearer(req);
 const authenticated=token&&(sessions.get(token)||epicKey(token));
 const parts=new URL(req.url,'http://127.0.0.1').pathname.split('/').map(x=>{try{return decodeURIComponent(x);}catch{throw httpError(400,'Malformed URL');}});
 if(req.playerBody&&typeof req.playerBody==='object')for(const field of ['accountId','phx_account_id','account_id','characterId','character_id','playerId'])if(typeof req.playerBody[field]==='string')parts.push(req.playerBody[field]);
 const owners=keys.filter(k=>parts.includes(k)||parts.includes(state.players[k].accountId)||(state.players[k].characters||[]).some(c=>parts.includes(c.id)));
 if(authenticated&&state.players[authenticated]){
  if(owners.some(k=>k!==authenticated))throw httpError(403,'Account does not own this character');
  return authenticated;
 }
 if(owners.length===1)return owners[0];
 if(owners.length>1)throw httpError(409,'Request contains different player accounts');
 // A single-player server can legitimately omit auth. Never select another save
 // merely because that account was the last one to log in.
 if(keys.length===1)return keys[0];
 if(keys.length===0&&!token)return 'local';
 throw httpError(401,'Player identity is missing or expired; sign in again');
}
function validateInventory(body){
 const arrays=['addInstancedItems','saveInstancedItems','removeInstancedItems','addStackedItems','removeStackedItems'];
 for(const key of arrays)if(body[key]!==undefined&&!Array.isArray(body[key]))throw httpError(400,key+' must be an array');
 for(const key of ['addStackedItems','removeStackedItems'])for(const item of body[key]||[]){
  if(!item||typeof item.catalogId!=='string'||!item.catalogId||!Number.isSafeInteger(Number(item.quantity))||Number(item.quantity)<0)throw httpError(400,'Invalid stacked item or quantity');
 }
 for(const key of ['addInstancedItems','saveInstancedItems'])for(const item of body[key]||[]){
  if(!item||(key==='addInstancedItems'||item.catalogId!==undefined)&&(typeof item.catalogId!=='string'||!item.catalogId))throw httpError(400,'Missing equipment catalogId');
  if(key==='saveInstancedItems'&&(typeof item.instanceId!=='string'||!item.instanceId))throw httpError(400,'Missing equipment instanceId');
 }
}
module.exports={atomicWrite,loadState,saveState,appendLog,httpError,playerKey,validateInventory};
