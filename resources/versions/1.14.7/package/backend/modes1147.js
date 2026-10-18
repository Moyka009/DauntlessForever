// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const hunts=require('./modes1147-data.json');
const SEASON='gauntlet-season5', PACK=50000000, MAX_LEVEL=9999999;
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=(status,message)=>{const e=Error(message);e.status=status;throw e;};
const ok=payload=>({status:200,json:{code:null,message:'OK',payload},note:'modes1147: native season / saved progress'});
function unpack(n){if(!Number.isSafeInteger(n)||n<=PACK||n>PACK+MAX_LEVEL)fail(400,'Invalid 1.14.7 Gauntlet season/level');return n-PACK;}
function huntUrl(id){const h=hunts[id];if(!h)return'';const m=h.maps[0];return m.map+'?MaxPlayers='+h.max+(h.behemoth?'?MonsterClass='+h.behemoth:'')+(m.tod?'?TODClass='+m.tod:'')+'?HuntID='+id+(h.game?'?game='+h.game:'');}
function destination(b){
 if(b.gameMode!=='ISLAND')return null;
 if(b.gameType==='TRIALS'){
  const id=Array.isArray(b.hunts)&&b.hunts[0];if(!hunts[id]||id==='CR19_MatchmakerHunt_Gauntlet')return null;
  // Use the client's scheduled ID. Never choose a different week's opponent here.
  return{city:false,label:'ISLAND/TRIALS '+(b.playerHuntId||id),url:huntUrl(id)};
 }
 if(b.gameType!=='GAUNTLET')return null;
 unpack(b.gauntlet_level);
 const u=huntUrl('CR19_MatchmakerHunt_Gauntlet')+'?GauntletLevel='+b.gauntlet_level;
 return{city:false,label:'ISLAND/GAUNTLET '+b.gauntlet_level,url:u};
}
function create(ctx){
 function account(req,id){const found=ctx.getPlayers().filter(p=>p.accountId===id);if(found.length!==1)fail(404,'Gauntlet account not found');const p=found[0],token=ctx.bearerOf(req);if(token&&ctx.sessions.has(token)&&ctx.playerFor(req)!==p)fail(403,'Gauntlet account does not match signed-in player');return p;}
 function saved(p){const m=p.mega1147?.gauntlet1147?.[SEASON];return m||{completed:[],highest:0};}
 function checkSeason(s){if(s!==SEASON)fail(404,'Gauntlet season is not available in this offline setup');}
 function finish(c){const b=c.body;if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Expected Gauntlet completion');checkSeason(b.gauntlet_id);
  const n=b.level;if(!Number.isSafeInteger(n)||n<1||n>MAX_LEVEL)fail(400,'Invalid completed Gauntlet level');
  if(!Array.isArray(b.players)||!b.players.length||b.players.length>4||b.players.some(x=>typeof x!=='string')||new Set(b.players).size!==b.players.length)fail(400,'Invalid Gauntlet completion players');
  const ps=b.players.map(id=>account(c.req,id));
  for(const p of ps){const m=saved(p);if(n>m.highest+1)fail(409,'Gauntlet completion skips locked levels');}
  const changed=ps.filter(p=>!saved(p).completed.includes(n));if(!changed.length)return ok(null);
  const before=changed.map(p=>clone(p));
  try{for(const p of changed){p.mega1147??={};p.mega1147.gauntlet1147??={};const m=p.mega1147.gauntlet1147[SEASON]??={completed:[],highest:0};m.completed.push(n);m.completed.sort((a,b)=>a-b);m.highest=Math.max(m.highest,n);}ctx.saveState();}
  catch(e){changed.forEach((p,i)=>{for(const k of Object.keys(p))delete p[k];Object.assign(p,before[i]);});throw e;}
  return ok(null);
 }
 function handle(c){if(c.service!=='gauntlet')return ctx.next(c);const pth=c.path.replace(/\/$/,'');
  if(c.method==='GET'&&pth==='/config')return ok({gauntlet_id:SEASON,start_at:'2023-06-22T17:00:00.000Z',end_at:'2099-12-31T18:00:00.000Z',each_level_rewards:[],milestone_rewards:[]});
  if(c.method==='PUT'&&pth==='/process_run')return finish(c);
  let m=/^\/progression\/level_access\/([^/]+)$/.exec(pth);
  if(c.method==='GET'&&m){checkSeason(m[1]);const ids=c.url.searchParams.getAll('account_id');if(!ids.length)return{status:204};const ns=ids.map(id=>{const p=ctx.getPlayers().find(p=>p.accountId===id);return p?saved(p).highest+1:1;});return ok(Math.max(...ns));}
  m=/^\/progression\/([^/]+)\/([^/]+)$/.exec(pth);
  if(c.method==='GET'&&m){checkSeason(m[1]);const v=saved(account(c.req,m[2]));return ok({personal_progression:v.highest,guild_progression:0});}
  m=/^\/rewards\/(personal|guild)\/([^/]+)\/([^/]+)$/.exec(pth);
  if(c.method==='GET'&&m){checkSeason(m[2]);const v=saved(account(c.req,m[3]));return ok(m[1]==='personal'?[...v.completed]:[]);}
  m=/^\/leaderboard\/(get_leaderboard|get_entry)\/([^/]+)(?:\/([^/]+))?$/.exec(pth);
  if(c.method==='GET'&&m){checkSeason(m[2]);return ok(m[1]==='get_leaderboard'?[]:null);}
  if(c.method==='POST'&&pth==='/rewards/guild'){checkSeason(c.body?.gauntlet_id);account(c.req,c.body?.account_id);return ok([]);}
  return ctx.next(c);
 }
 return{handle};
}
module.exports={create,destination,huntUrl,unpack,SEASON};
