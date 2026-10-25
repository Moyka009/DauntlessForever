// SPDX-License-Identifier: AGPL-3.0-only
// Rams store for 1.14.7 (DF-STORE-RAMS-1147): main store offers priced in Rams (CURRENCY_NOTES).
// Purchase flow (token -> notification, atomic, receipts, balance check, grants) follows trials1147.js.
// Price table after Dauntless Revived (github.com/mixutin/dauntless-revived, ramspricing.ts); prices live in
// store-rams1147-data.json. Items come from tools/catalog-1147.json (KombatKing, AGPL).
'use strict';
const crypto=require('crypto'),path=require('path'),fs=require('fs');
const data=require('./store-rams1147-data.json');
// DF-STORE-PICTURES-1147 (Oct 25): with data.onlyWithPicture, only offers whose id is a row of the game's store picture table are sold
let PICTURES=new Set();try{PICTURES=new Set(require('./store-rams1147-pictures.json').skus||[]);}catch(e){PICTURES=new Set();}
const RAMS='CURRENCY_NOTES',PREFIX='storerams1147_';   // PREFIX: purchase tokens only (the notification finds its own by it)
// DF-STORE-TABS-1147: offer ids are sku_<lowercase catalogId>, the client's own store picture key (UI/Store/StoreItemsTable),
// so 853 items show their picture with no pak. Which skus are ours is the explicit set bySku, never an id prefix.
const OFFER_PREFIX=typeof data.offerIdPrefix==='string'&&/^[a-z0-9_]*$/.test(data.offerIdPrefix)?data.offerIdPrefix:'sku_';
const SKU_OK=/^[a-z0-9_]{3,120}$/;
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function error(message,status=409){const e=Error(message);e.status=status;return e;}
function tags(v){if(Array.isArray(v))return v.flatMap(tags);if(typeof v!=='string')return[];try{const a=JSON.parse(v);if(Array.isArray(a))return a.flatMap(tags);}catch{}return v.split(/[,;|]/).map(t=>t.trim().toLowerCase()).filter(Boolean);}
const curName=v=>String(v||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40)||'(none)';
function isRams(v){const c=String(v||'').replace(/[_\s-]/g,'').toLowerCase();return['notes','rams','currencynotes','idcurrencynotes'].includes(c);}
const fmt=n=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
// Shop text stays plain ASCII (catalog names carry curly quotes): quotes and dashes mapped, anything else dropped.
const ascii=t=>String(t).replace(/[\u2018\u2019\u02bc]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').normalize('NFKD').replace(/[^\x20-\x7e]/g,'').trim();
// The 1.14.7 client only draws a few store currencies (id_currency_notes shows as platinum -1). The offers carry this
// label, the store balance reports the player's Rams under it, and every purchase is charged in Rams.
const LABEL=typeof data.labelCurrencyId==='string'&&/^id_currency_[a-z0-9_]+$/.test(data.labelCurrencyId)?data.labelCurrencyId:'id_currency_event_01';
const balanceKeys=id=>[id,id.replace(/^id_/,'').toUpperCase()];
// ---------------------------------------------------------------- offers (built once at start)
function loadCatalog(){
 for(const f of [path.join(__dirname,'..','tools','catalog-1147.json'),path.join(__dirname,'catalog-1147.json')]){
  try{const j=JSON.parse(fs.readFileSync(f,'utf8'));if(Array.isArray(j.items))return j.items;}catch{}
 }
 return[];
}
const catalogItems=loadCatalog(),catalogById=new Map(catalogItems.map(i=>[i.id,i]));
// DF-STORE-NAMES-1147: English names from the game's own text for items that have none in catalog-1147.json.
const extraNames=(()=>{try{const j=JSON.parse(fs.readFileSync(path.join(__dirname,'store-rams1147-names.json'),'utf8'));return j&&typeof j.names==='object'?j.names:{};}catch{return{};}})();
function build(){
 const out=[],seen=new Set(),rx=(list,flags='')=>(list||[]).map(s=>new RegExp(s,flags));
 const exIds=new Set(data.excludeIds||[]),exIdRx=rx(data.excludeIdPatterns),exNameRx=rx(data.excludeNamePatterns,'i');
 const add=o=>{if(!o||!SKU_OK.test(o.sku)||seen.has(o.sku))return;seen.add(o.sku);out.push(o);};
 // the client's tab tags per item (store_view_model SubTagIds), e.g. WP_AC_ -> skin_weapon_ac
 const itemTags=(data.itemTags||[]).map(t=>({rx:new RegExp(t.idPattern),tags:(t.tags||[]).filter(x=>typeof x==='string')}));
 const tagsFor=(base,id)=>[...new Set([...base,...itemTags.filter(t=>t.rx.test(id)).flatMap(t=>t.tags)])];
 for(const cat of data.categories||[]){
  const src=new RegExp(cat.source),idRx=new RegExp(cat.idPattern);
  if(!Number.isSafeInteger(cat.price)||cat.price<0)continue;
  for(const it of catalogItems){
   const source=String(it.source||'').split('/').pop();
   if(!src.test(source)||!idRx.test(it.id)||exIds.has(it.id)||exIdRx.some(r=>r.test(it.id)))continue;
   const own=typeof it.name==='string'&&it.name&&it.name!==it.id,given=typeof extraNames[it.id]==='string'&&extraNames[it.id]?extraNames[it.id]:'';
   if(!own&&!given&&!data.includeUnnamed)continue;
   const name=ascii(given||(own?it.name:it.id));   // the names file wins: it also fixes wrong catalog names
   if(exNameRx.some(r=>r.test(name)))continue;
   if(data.onlyWithPicture&&!PICTURES.has(OFFER_PREFIX+it.id.toLowerCase()))continue;   // DF-STORE-PICTURES-1147
   add({sku:OFFER_PREFIX+it.id.toLowerCase(),name,description:cat.name+'. Costs '+fmt(cat.price)+' Rams.',price:cat.price,tags:tagsFor(cat.tags,it.id),category:cat.key,
    label:LABEL,items:[{catalogId:it.id,quantity:1,kind:it.storage==='instance'?'instance':'stack'}]});
  }
 }
 for(const x of data.extraOffers||[]){
  if(!x||typeof x.sku!=='string'||!SKU_OK.test(x.sku)||!Number.isSafeInteger(x.price)||x.price<0)continue;
  const items=(x.items||[]).filter(i=>catalogById.has(i.catalogId)).map(i=>({catalogId:i.catalogId,quantity:i.quantity||1,kind:i.kind==='instance'?'instance':'stack'}));
  if(!items.length&&!x.entitlement)continue;
  add({sku:x.sku,name:x.name,description:(x.description?x.description+' ':'')+'Costs '+fmt(x.price)+' Rams.',price:x.price,tags:[...(x.tags||['webstore'])],
   category:'extra',label:LABEL,items,entitlement:x.entitlement||null,repeatable:!!x.repeatable});
 }
 for(const t of data.labelTests||[]){
  const it=catalogById.get(t.catalogId);if(!it||typeof t.sku!=='string'||!SKU_OK.test(t.sku)||!/^id_currency_[a-z0-9_]+$/.test(t.currencyId||''))continue;
  add({sku:t.sku,name:'Label test: '+it.name,description:'Label test ('+t.currencyId+'). Costs '+fmt(t.price)+' Rams.',price:t.price,tags:['webstore','store_tab_style','dyes','dye_armour','cat_item_armour_dye'],
   category:'labeltest',label:t.currencyId,items:[{catalogId:it.id,quantity:1,kind:it.storage==='instance'?'instance':'stack'}]});
 }
 return out;
}
const offers=build(),bySku=new Map(offers.map(o=>[o.sku,o]));
const labels=[...new Set(offers.map(o=>o.label))];
// Free packs switched off (data file disabledFreePacks): hidden from every shelf, their sku and token answer 410.
const disabled=new Set((data.disabledFreePacks||[]).filter(x=>typeof x==='string'&&!bySku.has(x)));
// ---------------------------------------------------------------- ownership
function quantity(inv,id){const list=(inv.stackedItems||[]).filter(i=>i.catalogId===id);if(list.length>1||list.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<0))throw error('Invalid or duplicate saved stack: '+id);return list[0]?.quantity||0;}
function ownedSet(inv){const s=new Set();for(const i of inv.instancedItems||[])s.add(i.catalogId);for(const i of inv.stackedItems||[])if(i.quantity>0)s.add(i.catalogId);return s;}
const hasEntitlement=(p,name)=>(p?.entitlements||[]).some(e=>e&&e.name===name);
function owned(p,o,set){if(o.repeatable)return false;if(o.entitlement)return hasEntitlement(p,o.entitlement);return o.items.every(i=>set.has(i.catalogId));}
function publicOffer(o,p,set,signed){const own=owned(p,o,set);
 return{id:o.sku,displayName:o.name,displayDescription:o.description||'',displayPriority:1000,tags:[...o.tags],
  prices:[{currencyId:o.label,price:o.price,salesPrice:o.price,multiPrice:null}],
  items:o.items.map(i=>({catalogId:i.catalogId,quantity:i.quantity||1})),entitlements:o.entitlement?[{name:o.entitlement,duration:0}]:[],skuProgression:[],images:{},
  maxAllowed:o.repeatable?99:1,remaining:signed&&!own?1:0,duplicateInstancedItems:o.repeatable||o.entitlement?[]:o.items.filter(i=>set.has(i.catalogId)).map(i=>i.catalogId),loadoutSlots:null,
  availableFrom:null,availableTo:null,timeAvailabilityReason:null,platformOfferId:null,missingEntitlementNames:null,scheduledTags:null};}
// ---------------------------------------------------------------- module
function create(ctx,options={}){
 const now=options.now||Date.now,next=ctx.next||(()=>null),ok=(json,note)=>({status:200,json,note}),empty={stackedItems:[],instancedItems:[]};
 const session=req=>{const t=ctx.bearerOf(req);return t&&ctx.sessions.has(t)?ctx.playerFor(req):null;};
 const player=req=>{const p=session(req);if(!p)throw error('Signed-in player session required',403);return p;};
 const character=p=>p?.characters?.find(c=>typeof c.id==='string')?.id;
 const inventory=p=>p?.inventory?.[character(p)]||empty;
 function meta(p){p.mega1147??={};return p.mega1147.storeRams??={tokens:{}};}
 function atomic(p,fn){const before=clone(p);try{const r=fn();ctx.saveState();return r;}catch(e){for(const k of Object.keys(p))delete p[k];Object.assign(p,before);throw e;}}
 function eligible(p,o){if(!character(p))throw error('Saved character required');const inv=inventory(p);if(owned(p,o,ownedSet(inv)))throw error('Item is already owned');if(quantity(inv,RAMS)<o.price)throw error('Not enough Rams');}
 function issue(p,o,cur){eligible(p,o);return atomic(p,()=>{const m=meta(p);for(const[k,t]of Object.entries(m.tokens))if(now()-t.at>7*86400000)delete m.tokens[k];if(Object.values(m.tokens).filter(t=>!t.done&&now()-t.at<=600000).length>=50)throw error('Too many pending Rams purchases',429);
  const token=PREFIX+crypto.randomBytes(32).toString('hex');m.tokens[hash(token)]={sku:o.sku,character:character(p),price:o.price,currency:curName(cur),at:now(),done:false};
  return ok({purchaseToken:token},'store-rams1147: token for '+o.sku+' ('+o.price+' Rams), client currency '+curName(cur)+(isRams(cur)?'':' (charged in Rams)'));});}
 function redeem(p,token,cur){const t=p.mega1147?.storeRams?.tokens?.[hash(token)];if(!t||t.character!==character(p))throw error('Rams purchase belongs to another account or character',403);
  if(t.done)return{status:204,note:'store-rams1147: '+t.sku+' already paid (same token)'};if(now()-t.at>600000)throw error('Rams purchase expired',410);
  const o=bySku.get(t.sku);if(!o||o.price!==t.price)throw error('Rams offer changed');eligible(p,o);
  return atomic(p,()=>{const inv=ctx.inventoryOf(p,t.character),held=inv.stackedItems.find(i=>i.catalogId===RAMS);if(!held||held.quantity<t.price)throw error('Not enough Rams');held.quantity-=t.price;
   const set=ownedSet(inv);
   for(const i of o.items){if(!o.repeatable&&set.has(i.catalogId))continue;const q=i.quantity||1;
    if(i.kind==='instance')for(let n=0;n<(o.repeatable?q:1);n++)inv.instancedItems.push({catalogId:i.catalogId,instanceId:crypto.randomUUID(),updateVersion:0,itemData:null});
    else{const n=(o.repeatable?quantity(inv,i.catalogId):0)+q;if(!Number.isSafeInteger(n)||n>2147483647)throw error('Rams store quantity overflow');const s=inv.stackedItems.find(x=>x.catalogId===i.catalogId);if(s)s.quantity=o.repeatable?n:Math.max(s.quantity,q);else inv.stackedItems.push({catalogId:i.catalogId,quantity:n});}}
   if(o.entitlement&&!hasEntitlement(p,o.entitlement)){p.entitlements??=[];p.entitlements.push({name:o.entitlement,duration:0,activatedDate:null});}
   t.done=true;return{status:204,note:'store-rams1147: '+o.sku+' bought for '+t.price+' Rams (client currency '+curName(cur)+'), '+held.quantity+' Rams left'};});}
 // The store's balance shows the character's real Rams, under CURRENCY_NOTES and under every label currency in use.
 function withRams(obj,p){if(!obj||typeof obj!=='object'||!p||!character(p))return obj;const n=quantity(inventory(p),RAMS);obj.CURRENCY_NOTES=n;obj.id_currency_notes=n;for(const l of labels)for(const k of balanceKeys(l))obj[k]=n;return obj;}
 function zeroed(o){for(const k of Object.keys(o))if(typeof o[k]==='number')o[k]=0;return o;}
 const withoutDisabled=list=>list.filter(o=>!disabled.has(o?.id));
 function handle(c){
  if(c.service!=='store')return next(c);const pathname=c.path.replace(/\/$/,'');
  if(c.method==='GET'&&pathname==='/product/skus/public'){
   const required=c.url.searchParams.getAll('requiredTags').flatMap(tags),base=next(c);
   const added=required.length?offers.filter(o=>required.every(t=>o.tags.includes(t))):[];
   const list=Array.isArray(base?.json)?base.json:null;
   const removed=list?list.filter(o=>disabled.has(o?.id)).length:0;
   if(!added.length&&!removed)return base;
   const kept=list?withoutDisabled(list).filter(o=>!bySku.has(o?.id)):[];
   if(!added.length)return{...base,json:kept,note:(base.note?base.note+'; ':'')+'store-rams1147: '+removed+' free pack(s) switched off'};
   const p=session(c.req),set=ownedSet(inventory(p)),signed=!!p&&!!character(p);
   return{...(base||{}),status:200,json:[...kept,...added.map(o=>publicOffer(o,p,set,signed))],note:((base&&base.note)?base.note+'; ':'')+'store-rams1147: '+added.length+' Rams offer(s) for '+required.join(',')+(removed?', '+removed+' free pack(s) off':'')};
  }
  if(c.method==='GET'&&pathname==='/balance'){
   const p=session(c.req);if(!p)return next(c);const base=next(c);
   if(base&&base.json&&typeof base.json==='object'&&!Array.isArray(base.json))return{...base,json:withRams(clone(base.json),p),note:'store-rams1147: real Rams in the balance (also as '+labels.join(', ')+')'};
   const cap=ctx.loadCapture?ctx.loadCapture('Store/Balance.md'):null;if(!cap||typeof cap!=='object')return base;
   return ok(withRams(zeroed(clone(cap)),p),'from captures; store-rams1147: real Rams in the balance (also as '+labels.join(', ')+')');
  }
  if(c.method==='POST'&&pathname==='/reconcile'){
   const p=session(c.req);if(!p)return next(c);const base=next(c);
   if(base&&base.json&&typeof base.json==='object'&&base.json.balances){const j=clone(base.json);withRams(j.balances,p);return{...base,json:j,note:'store-rams1147: real Rams in the balance'};}
   if(base)return base;
   const cap=ctx.loadCapture?ctx.loadCapture('Store/Reconcile.md'):null;if(!cap||typeof cap!=='object')return base;
   const j=clone(cap);if(j.balances&&typeof j.balances==='object'){zeroed(j.balances);withRams(j.balances,p);}return ok(j,'from captures; store-rams1147: real Rams in the balance');
  }
  const single=/^\/product\/sku\/(.+)$/.exec(pathname);
  const token=/^\/token\/([^/]+)\/(.+)$/.exec(pathname);
  if(c.method==='GET'&&((single&&disabled.has(single[1]))||(token&&disabled.has(token[2]))))throw error('This free pack is switched off; it is in the Rams store now',410);
  if(c.method==='GET'&&single&&bySku.has(single[1])){const p=session(c.req);return ok(publicOffer(bySku.get(single[1]),p,ownedSet(inventory(p)),!!p&&!!character(p)));}
  if(c.method==='GET'&&token&&bySku.has(token[2]))return issue(player(c.req),bySku.get(token[2]),token[1]);
  if(c.method==='POST'&&pathname.startsWith('/notification/')){const t=[c.url.searchParams.get('token'),c.url.searchParams.get('purchaseToken'),c.body?.token,c.body?.purchaseToken].find(t=>typeof t==='string'&&t.startsWith(PREFIX));if(t)return redeem(player(c.req),t,pathname.slice('/notification/'.length));}
  return next(c);
 }
 return{handle};
}
module.exports={create,publicOffer,isRams,offers,disabled,LABEL,catalogById};
