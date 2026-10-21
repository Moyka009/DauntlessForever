// SPDX-License-Identifier: AGPL-3.0-only
// Loadout repairs for Dauntless Forever 1.14.7. KombatKing / Codex, 2026.
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const copy=x=>JSON.parse(JSON.stringify(x));
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const MAX=48,PATH_SLOTS=5; // Saved slot limit (was 16; DF-LOADOUT-SLOTS raised it so extra slots fit); five native Path unlock conditions.
const BASE_ACCOUNT=10; // Native store/platinum account slots (1 starter + 5 Path + 10 = the old 16).
// DF-LOADOUT-SLOTS (Game Rules "Extra loadout slots"): this many account slots come free, no platinum.
// Slots once given are kept in the save (loadoutSlots1147.account), so turning the rule off never loses a loadout.
const extraSlots=()=>{const n=Number(process.env.DF_EXTRA_LOADOUT_SLOTS);return Number.isInteger(n)&&n>0?Math.min(n,MAX-PATH_SLOTS-1):0;};
function fail(status,message){const e=Error(message);e.status=status;throw e;}
function integer(v,max=MAX){return Number.isSafeInteger(v)&&v>=0&&v<=max;}
function create(ctx){
 function player(c,account,character){
  const matches=ctx.getPlayers().filter(p=>p.accountId===account);if(matches.length!==1)fail(404,'Loadout account not found');
  const p=matches[0],bearer=ctx.bearerOf(c.req);
  if(bearer&&ctx.sessions.has(bearer)&&c.method!=='GET'&&ctx.playerFor(c.req)!==p)fail(403,'Loadout account does not match signed-in player');
  if(character&&!p.characters?.some(ch=>ch.id===character))fail(404,'Loadout character not found in this account');
  return p;
 }
 function earned(p){
  let result=0;const nodes=p.pjmMaps?.main?.nodes;
  for(let i=1;i<=PATH_SLOTS;i++){
   const id='LoadoutSlot_0'+i;
   const n=Array.isArray(nodes)?nodes.find(x=>x?.node_id===id):nodes?.[id];
   if(n?.node_status===2)result++;
  }
  return result;
 }
 function counts(p,character,l){
  // Native 1.14.7 counts one starter slot on the character, then the five Path slots.
  // Keep the existing saved/store account field in its legacy starter-inclusive encoding.
  const metadata=p.loadoutSlots1147;
  let account=integer(metadata?.account,MAX-PATH_SLOTS)&&metadata.account>=1?metadata.account-1:0;
  account=Math.max(account,extraSlots());
  const chars=1+Math.max(earned(p),integer(metadata?.characters?.[character],PATH_SLOTS)?metadata.characters[character]:0);
  const used=Array.isArray(l?.loadouts)?l.loadouts.length:0;
  account=Math.max(account,Math.min(MAX-PATH_SLOTS-1,Math.max(0,used-chars)));
  const retained=Math.max(chars,used-account);
  return {num_account_slots:account,max_account_slots:Math.max(BASE_ACCOUNT,extraSlots(),account),num_character_slots:retained,max_character_slots:PATH_SLOTS+1};
 }
 function reply(l,c){return {loadouts:l.loadouts,persistent:l.persistent,...c,active_index:l.active_index,needs_migration:false};}
 const ok=value=>({status:200,json:{code:null,message:'OK',payload:copy(value)},note:'loadouts1147: saved/normalized native loadouts'});
 function dataObject(raw){
  let data=raw;if(typeof data==='string'){try{data=JSON.parse(data);}catch{fail(400,'Loadout data is not JSON');}}
  if(!object(data))fail(400,'Loadout data must be an object');
  if(Buffer.byteLength(JSON.stringify(data))>512*1024)fail(400,'Loadout data is too large');return copy(data);
 }
 function backup(p,character,original){
  if(!ctx.root||original===undefined)return;
  const bytes=Buffer.from(JSON.stringify(original,null,2)),digest=crypto.createHash('sha256').update(bytes).digest('hex');
  const dir=path.join(ctx.root,'backup/loadouts1147-repair');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,crypto.createHash('sha256').update(p.accountId+'/'+character).digest('hex').slice(0,16)+'-'+digest+'.json');
  if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});
 }
 function prepared(p,character){
  const original=p.loadouts?.[character];
  if(original!==undefined&&!object(original))fail(409,'Saved loadout record is malformed; original retained');
  const l=original===undefined?{loadouts:[],persistent:ctx.defaultPersistent(),active_index:0}:copy(original);
  if(!Array.isArray(l.loadouts)||l.loadouts.length>MAX)fail(409,'Saved loadout slot list is malformed or exceeds the reviewed limit');
  for(const slot of l.loadouts)if(slot!==null&&slot!==undefined&&!object(slot))fail(409,'Saved loadout slot is malformed; original retained');
  if(typeof l.persistent==='string'){try{l.persistent=JSON.parse(l.persistent);}catch{fail(409,'Saved persistent loadout is malformed; original retained');}}
  if(l.persistent!==null&&l.persistent!==undefined&&!object(l.persistent))fail(409,'Saved persistent loadout is malformed; original retained');
  const valid=l.loadouts.filter(object);
  let persistent=object(l.persistent)?l.persistent:null;
  if(!persistent)for(const slot of valid)if(object(slot.persistent)&&(!persistent||(integer(slot.persistent.update_version,2147483647)&&slot.persistent.update_version>(persistent.update_version||0))))persistent=slot.persistent;
  l.persistent={...ctx.defaultPersistent(),...(persistent||{})};
  const c=counts(p,character,l),total=Math.min(MAX,c.num_account_slots+c.num_character_slots);
  const template=valid[0]||ctx.defaultLoadoutSlot(l.persistent);
  for(let i=0;i<total;i++){
   if(!object(l.loadouts[i]))l.loadouts[i]=copy(template);
   l.loadouts[i].slot_index=i;l.loadouts[i].persistent=copy(l.persistent);
  }
  if(!integer(l.active_index,MAX-1)||!l.loadouts[l.active_index])l.active_index=0;
  const slotCounts={...(object(p.loadoutSlots1147)?p.loadoutSlots1147:{}),account:c.num_account_slots+1,characters:{...(object(p.loadoutSlots1147?.characters)?p.loadoutSlots1147.characters:{}),[character]:Math.min(PATH_SLOTS,c.num_character_slots-1)}};
  return {l,c,slotCounts,original,changed:JSON.stringify(l)!==JSON.stringify(original)||JSON.stringify(slotCounts)!==JSON.stringify(p.loadoutSlots1147)};
 }
 function persist(p,character,record,repair){
  const before=p.loadouts,had=Object.hasOwn(p,'loadouts'),oldCounts=p.loadoutSlots1147,hadCounts=Object.hasOwn(p,'loadoutSlots1147');
  if(repair)backup(p,character,record.original);
  p.loadouts={...(p.loadouts||{}),[character]:record.l};
  p.loadoutSlots1147=record.slotCounts;
  try{ctx.saveState();}catch(e){if(had)p.loadouts=before;else delete p.loadouts;if(hadCounts)p.loadoutSlots1147=oldCounts;else delete p.loadoutSlots1147;throw e;}
 }
 function handle(c){
  if(c.service!=='loadout')return null;
  const pathname=c.path.replace(/\/$/,'');if(!pathname.startsWith('/loadout/'))return null;
  const parts=pathname.split('/').slice(2).map(x=>decodeURIComponent(x));
  if(parts.length<1||parts.length>4)return null;
  const account=parts[0];
  if(['POST','PUT'].includes(c.method)&&parts.length===3&&parts[1]==='unlock'){
   const p=player(c,account),ch=p.characters?.[0];if(!ch)fail(404,'No loadout character');const rec=prepared(p,ch.id);
   const n=/^(0|[1-9]\d*)$/.test(parts[2])?Number(parts[2]):-1;
   if(!integer(n,MAX-PATH_SLOTS-1)||n<1)fail(400,'Invalid account slot count');
   const total=Math.max(n,rec.c.num_account_slots);rec.c.num_account_slots=total;rec.slotCounts.account=total+1;
   const length=Math.min(MAX,total+rec.c.num_character_slots),template=rec.l.loadouts[0];
   for(let i=rec.l.loadouts.length;i<length;i++)rec.l.loadouts.push({...copy(template),slot_index:i,persistent:copy(rec.l.persistent)});
   persist(p,ch.id,rec,rec.changed);return ok(rec.c);
  }
  // The shorter account endpoint must precede the two-identifier active-slot route.
  if(c.method==='GET'&&parts.length===2&&parts[1]==='slotcount'){
   const p=player(c,account),ch=p.characters?.[0];if(!ch)fail(404,'No loadout character');
   const rec=prepared(p,ch.id);if(rec.changed)persist(p,ch.id,rec,true);return ok(rec.c);
  }
  if(parts.length<2)return null;
  const character=parts[1],p=player(c,account,character),rec=prepared(p,character);
  if(c.method==='GET'){
   if(parts.length===2){if(rec.changed)persist(p,character,rec,true);return ok(rec.l.loadouts[rec.l.active_index]);}
   if(parts.length===3&&parts[2]==='all'){if(rec.changed)persist(p,character,rec,true);return ok(reply(rec.l,rec.c));}
   if(parts.length===3&&parts[2]==='slotcount'){if(rec.changed)persist(p,character,rec,true);return ok(rec.c);}
   return null;
  }
  if(!['POST','PUT'].includes(c.method))return null;
  if(parts.length===4&&parts[2]==='unlock'){
   // ResolveProgressionLoadoutSlotUnlocks sends a missing-character-slot count.
   // Entitlement comes from native Path nodes (or retained saved slots), never from account purchases.
   const n=/^(0|[1-9]\d*)$/.test(parts[3])?Number(parts[3]):-1;
   if(!integer(n,PATH_SLOTS+1)||n<1)fail(400,'Invalid character slot request');
   // prepared() reconciles to the authoritative 1 + Path count. Replays never add extra slots.
   if(rec.changed)persist(p,character,rec,true);return ok(rec.c);
  }
  if(parts.length===4&&parts[2]==='active'){
   const i=/^(0|[1-9]\d*)$/.test(parts[3])?Number(parts[3]):-1;
   if(!integer(i,MAX-1)||i>=rec.c.num_account_slots+rec.c.num_character_slots||!rec.l.loadouts[i])fail(400,'Loadout slot is invalid or locked');
   // The native config uses this same endpoint for both switch-only and save-and-activate calls.
   if(c.body?.data!==undefined||object(c.body)&&['weapon','helmet','chest','arms','legs','slot_index'].some(k=>Object.hasOwn(c.body,k))){
    const data=dataObject(c.body?.data!==undefined?c.body.data:c.body);
    rec.l.loadouts[i]={...rec.l.loadouts[i],...data,slot_index:i,persistent:copy(rec.l.persistent)};
   }
   rec.l.active_index=i;persist(p,character,rec,rec.changed);return ok(reply(rec.l,rec.c));
  }
  if(parts.length!==3)return null;
  const which=parts[2];
  if(which!=='persistent'&&!/^(0|[1-9]\d*)$/.test(which))return null;
  const data=dataObject(c.body?.data!==undefined?c.body.data:c.body);
  if(which==='persistent'){
   // Merge partial saves, keeping settings omitted by this client/server update.
   rec.l.persistent={...rec.l.persistent,...copy(data)};
   for(const slot of rec.l.loadouts)slot.persistent=copy(rec.l.persistent);
  }else{
   const i=Number(which);if(!integer(i,MAX-1)||i>=rec.c.num_account_slots+rec.c.num_character_slots)fail(400,'Loadout slot is invalid or locked');
   rec.l.loadouts[i]={...rec.l.loadouts[i],...copy(data),slot_index:i,persistent:copy(rec.l.persistent)};
  }
  persist(p,character,rec,rec.changed);return ok(reply(rec.l,rec.c));
 }
 return {handle};
}
module.exports={create};
