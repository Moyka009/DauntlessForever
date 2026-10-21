// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const MAX=2147483647;
const digest=b=>crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
function error(message,status=400){const e=Error(message);e.status=status;return e;}
function number(value,label){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>MAX)throw error('Invalid '+label);return value;}
function scale(n,factor){if(n<=0||factor===1)return n;const result=Math.max(1,Math.round(n*factor));if(!Number.isSafeInteger(result)||result>MAX)throw error('Game Rules quantity overflow');return result;}
function readSettings(root,hosting){
 const defs=JSON.parse(fs.readFileSync(path.join(root,'rules.json'),'utf8').replace(/^\uFEFF/,''));
 const settings=Object.fromEntries(defs.rules.map(r=>[r.key,Number(r.default)]));
 const file=path.join(root,'data/rules.txt');
 if(fs.existsSync(file))for(const line of fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){
  if(!line.trim()||line.trim().startsWith('#'))continue;
  const m=/^\s*([a-z_]+)\s*=\s*([0-9.]+)\s*$/.exec(line),def=m&&defs.rules.find(r=>r.key===m[1]);
  if(!def||!def.choices.some(c=>String(c[0])===m[2]))throw error('Invalid Game Rules setting: '+(m?m[1]:'line'));
  settings[m[1]]=Number(m[2]);
 }
 if(hosting)for(const key of Object.keys(settings))if(key!=='extra_loadout_slots')settings[key]=['free_crafting','rare_core_kill','free_platinum'].includes(key)?0:1; // DF-LOADOUT-SLOTS: kept when hosting (only adds slots)
 return Object.freeze(settings);
}
function create(root,options={}){
 const args=process.argv.slice(2),arg=name=>{const i=args.indexOf(name);return i<0?'':args[i+1]||'';};
 const bind=options.bind??(arg('--bind')||process.env.RECORDER_BIND||'127.0.0.1');
 const hosting=options.hosting??(process.env.DF_HOSTING==='1'||!['127.0.0.1','::1','localhost'].includes(bind)||!!(arg('--public')||process.env.RECORDER_PUBLIC_HOST));
 const settings=readSettings(root,hosting);
 process.env.DF_EXTRA_LOADOUT_SLOTS=String(settings.extra_loadout_slots||0); // DF-LOADOUT-SLOTS: read by loadouts-fix1147
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'game-rules1147-data.json'),'utf8'));
 const materials=new Set(data.materials),kills=new Set(data.killTokens);
 const factor=id=>id==='CURRENCY_NOTES'?settings.rams:id==='CURRENCY_PJM_WEAPON'?settings.weapon_merits:id==='CURRENCY_PJM_AIRSHIP'?settings.exploration_merits:id===data.rareCore?settings.rare_cores:materials.has(id)?settings.materials:1;
 const transactionId=body=>typeof body.transactionId==='string'&&body.transactionId.trim().length&&body.transactionId.length<=128?body.transactionId:null;
 function track(id,amount){
  const group=data.tracks[id];if(!group||amount<=0)return amount;
  number(amount,'progression grant');
  const individual=group==='weapon'?settings.weapon_xp:group==='mastery'?settings.mastery_xp:group==='pass'?settings.pass_xp:1;
  return scale(amount,Math.min(100,settings.universal_xp*individual));
 }
 function progress(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return body;
  const b=copy(body);
  if(Array.isArray(b.progress_tracks))b.progress_tracks=b.progress_tracks.map(t=>{
   if(!t||!data.tracks[t.progression_id])return t;
   const amount=Number(t.progress)||0;return {...t,progress:track(t.progression_id,amount)};
  });
  return b;
 }
 function sumTrack(id,before,delta){
  const total=(Number(before)||0)+delta;
  if(data.tracks[id]&&(!Number.isSafeInteger(total)||total<0||total>MAX))throw error('Game Rules progression total out of range');
  return total;
 }
 function inventory(inv,body){
  if(!transactionId(body))return body; // No replay-safe identity: retain the original transaction exactly.
  const b=copy(body),list=k=>b[k]===undefined?[]:b[k];
  for(const k of ['addInstancedItems','saveInstancedItems','removeInstancedItems','addStackedItems','removeStackedItems'])if(!Array.isArray(list(k)))throw error('Invalid inventory array: '+k);
  for(const k of ['addStackedItems','removeStackedItems'])for(const x of list(k)){
   if(!x||typeof x.catalogId!=='string')throw error('Invalid inventory item');number(x.quantity,'inventory quantity');
  }
  const source=String(b.source||'');
  const grantOnly=!list('addInstancedItems').length&&!list('saveInstancedItems').length&&!list('removeInstancedItems').length&&!list('removeStackedItems').length;
  const exclude=/craft|upgrad|surge|store|shop|purchas|fusion|refund|recycl|restor|default|editor|import|pjm.?unlock|reforg/i.test(source);
  if(grantOnly&&!exclude){
   const additions=list('addStackedItems');
   const tokens=additions.filter(x=>kills.has(x.catalogId)&&x.quantity>0);
   if(settings.rare_core_kill===1&&tokens.length===1&&tokens[0].quantity<=100&&!additions.some(x=>x.catalogId===data.rareCore))additions.push({catalogId:data.rareCore,quantity:tokens[0].quantity});
   b.addStackedItems=additions.map(x=>({...x,quantity:scale(x.quantity,factor(x.catalogId))}));
  }
  if(settings.free_crafting===1&&!list('removeInstancedItems').length&&!list('addStackedItems').length){
   const changes=[...list('addInstancedItems'),...list('saveInstancedItems')];
   if(changes.length===1){
    const item=changes[0],existing=(inv.instancedItems||[]).find(x=>x.instanceId===item.instanceId);
    const id=item.catalogId||existing?.catalogId,allowed=data.craftItems[id]||[];
    const costs={};for(const x of list('removeStackedItems'))if(x.quantity)costs[x.catalogId]=(costs[x.catalogId]||0)+x.quantity;
    const recipe=allowed.find(n=>sameCounts(costs,data.recipes[n]));
    const ownsIngredients=Object.entries(costs).every(([id,n])=>(inv.stackedItems||[]).filter(x=>x.catalogId===id).reduce((s,x)=>s+Number(x.quantity||0),0)>=n);
    if(recipe&&ownsIngredients&&!/store|shop|purchas|fusion|reforg|refund|recycl/i.test(source))b.removeStackedItems=[];
   }
  }
  return b;
 }
 function transact(player,body,inv,apply){
  const id=transactionId(body),hash=digest(body),history=player.inventoryTransactions||[];
  const prior=id&&history.find(x=>x.id===id&&x.character===body.characterId);
  if(prior){if(prior.digest!==hash)throw error('Inventory transactionId reused with different data',409);return copy(prior.result);}
  if(body.characterId&&!player.characters.some(ch=>ch.id===body.characterId))throw error('Character does not belong to this account',403);
  const draft=copy(inv),result=apply(draft,body);
  player.inventory[body.characterId||player.characters[0]?.id||'none']=draft;
  if(id)player.inventoryTransactions=[...history,{id,character:body.characterId,digest:hash,result:copy(result)}].slice(-128);
  return result;
 }
 return {settings,hosting,factor,track,progress,sumTrack,inventory,transact};
}
function sameCounts(a,b){return !!b&&Object.keys(a).length>0&&Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([id,n])=>b[id]===n);}
module.exports={create,readSettings,scale,sameCounts};
