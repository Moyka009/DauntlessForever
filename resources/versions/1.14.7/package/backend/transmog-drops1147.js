// SPDX-License-Identifier: AGPL-3.0-only
// Transmog Stones from behemoths for 1.14.7 (DF-TRANSMOG-DROPS-1147).
// The game server reports a player's loot with POST /inventory. A behemoth kill on a hunting ground comes as source
// "PlayerLoot" with one TOKEN_KILL_COUNT_<behemoth>; the end of an escalation, trial or other mission comes as source
// "End of Mission" with all its kills and a TOKEN_HUNT_COUNT_<behemoth>. This module adds Transmog Stones to that same
// transaction (before the backend saves it), so the stone arrives with the loot and the save stays one transaction.
// The roll is seeded by the game's transactionId: a repeated request gets the same answer, never a second stone.
// Rates are in transmog-drops1147-data.json.
'use strict';
const crypto=require('crypto'),data=require('./transmog-drops1147-data.json');
const STONE=typeof data.catalogId==='string'&&/^[A-Z0-9_]+$/.test(data.catalogId)?data.catalogId:'CURRENCY_TOKEN_TRANSMOG';
const ISLAND_MS=3*3600*1000;
const num=(v,d,lo,hi)=>{const n=Number(v);return Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):d;};
const rule=(r,dc,ds)=>({chance:num(r&&r.chance,dc,0,1),stones:Math.round(num(r&&r.stones,ds,0,100))});
const KILL=rule(data.kill,0.35,1);
const MISSION={ESCALATION:rule(data.missionEnd&&data.missionEnd.ESCALATION,1,1),TRIALS:rule(data.missionEnd&&data.missionEnd.TRIALS,1,1),other:rule(data.missionEnd&&data.missionEnd.other,0.35,1)};
const HEROIC={pattern:String((data.heroic&&data.heroic.pattern)||'Heroic'),stones:Math.round(num(data.heroic&&data.heroic.stones,2,0,100))};
const ids=b=>[...(Array.isArray(b.addStackedItems)?b.addStackedItems:[]),...(Array.isArray(b.addInstancedItems)?b.addInstancedItems:[])].map(i=>i&&typeof i.catalogId==='string'?i.catalogId:'');
// What kind of drop is this transaction? null = not a behemoth drop.
function kindOf(b){
 if(!b||typeof b!=='object')return null;
 const list=ids(b),kills=list.filter(x=>x.startsWith('TOKEN_KILL_COUNT_')).length,hunt=list.some(x=>x.startsWith('TOKEN_HUNT_COUNT_'));
 if(b.source==='End of Mission'&&(hunt||kills))return'mission';
 if(b.source==='PlayerLoot'&&kills)return'kill';
 return null;
}
// 0 <= x < 1 from the transaction: the same request always rolls the same.
function roll(b,salt){const t=typeof b.transactionId==='string'&&b.transactionId?b.transactionId:crypto.randomBytes(16).toString('hex');
 return crypto.createHash('sha256').update('transmog1147|'+salt+'|'+t).digest().readUInt32BE(0)/4294967296;}
function decide(b,island,salt){
 const kind=kindOf(b);if(!kind)return null;
 const type=island&&island.gameType?String(island.gameType):'';
 const heroic=!!(island&&island.playerHuntId&&HEROIC.pattern&&String(island.playerHuntId).includes(HEROIC.pattern));
 const r=kind==='kill'?KILL:(MISSION[type]||MISSION.other);
 const x=roll(b,salt),hit=x<r.chance;
 const stones=hit?(heroic?Math.max(HEROIC.stones,r.stones):r.stones):0;
 return{kind,type:type||'no hunt seen',heroic,chance:r.chance,roll:x,stones};
}
function create(ctx,options={}){
 const next=ctx.next||(()=>null),now=options.now||Date.now,log=options.log||((m)=>console.log(m));
 const islands=new Map();   // accountId -> { gameType, playerHuntId, at }: the player's own island hunt, seen while on it
 const session=req=>{const t=ctx.bearerOf(req);return t&&ctx.sessions.has(t)?ctx.playerFor(req):null;};
 function note(p){const cd=p&&p.candidate;if(cd&&cd.city===false&&cd.gameType)islands.set(p.accountId,{gameType:cd.gameType,playerHuntId:cd.playerHuntId||'',at:now()});}
 function islandOf(acc,p){if(p&&p.accountId===acc)note(p);const i=acc&&islands.get(acc);return i&&now()-i.at<ISLAND_MS?i:null;}   // by the loot's own account: game servers post loot without a bearer
 function handle(c){
  try{
   if(c.service==='dauntless'&&c.method==='POST'&&/^\/inventory\/?$/.test(c.path)&&c.body&&typeof c.body==='object'&&kindOf(c.body)){
    let p=null;try{p=ctx.playerFor(c.req);}catch{}
    const acc=String(c.body.accountId||(p&&p.accountId)||'');
    const d=decide(c.body,islandOf(acc,p),acc);
    if(d&&d.stones>0){
     if(!Array.isArray(c.body.addStackedItems))c.body.addStackedItems=[];
     c.body.addStackedItems.push({catalogId:STONE,quantity:d.stones});   // in place: the backend's /inventory route saves it with the loot
    }
    if(d)log(`transmog1147: ${d.kind} (${d.type}${d.heroic?', heroic':''}) roll ${d.roll.toFixed(3)} < ${d.chance}? ${d.stones>0?'+'+d.stones+' Transmog Stone(s)':'no stone'}`);
   }else if(c.req&&ctx.bearerOf(c.req)){note(session(c.req));}
  }catch(e){/* a drop must never break the loot itself */}
  return next(c);
 }
 return{handle};
}
module.exports={create,kindOf,decide,STONE,KILL,MISSION,HEROIC};
