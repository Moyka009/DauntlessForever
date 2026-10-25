// SPDX-License-Identifier: AGPL-3.0-only
// Rams store for 1.14.7: main store offers priced in Rams (CURRENCY_NOTES).
// Purchase flow (token -> notification, atomic, receipts, balance check, grants) follows trials1147.js.
// Price table for the full store (step 2) after Dauntless Revived (github.com/mixutin/dauntless-revived, ramspricing.ts).
'use strict';
const crypto=require('crypto'),data=require('./store-rams1147-data.json');
const RAMS='CURRENCY_NOTES',PREFIX='storerams1147_';
const offers=(data.offers||[]).filter(o=>o&&typeof o.sku==='string'&&o.sku.startsWith(PREFIX)&&Number.isSafeInteger(o.price)&&o.price>=0&&Array.isArray(o.items)&&o.items.length);
const bySku=new Map(offers.map(o=>[o.sku,o]));
// Free packs switched off (data file disabledFreePacks): hidden from every shelf, their sku and token answer 410.
const disabled=new Set((data.disabledFreePacks||[]).filter(x=>typeof x==='string'&&!x.startsWith(PREFIX)));
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function error(message,status=409){const e=Error(message);e.status=status;return e;}
function tags(v){if(Array.isArray(v))return v.flatMap(tags);if(typeof v!=='string')return[];try{const a=JSON.parse(v);if(Array.isArray(a))return a.flatMap(tags);}catch{}return v.split(/[,;|]/).map(t=>t.trim().toLowerCase()).filter(Boolean);}
// The client's name for Rams in token and notification paths is logged; any name is charged in Rams.
function curName(v){return String(v||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,40)||'(none)';}
function isRams(v){const c=String(v||'').replace(/[_\s-]/g,'').toLowerCase();return['notes','rams','currencynotes','idcurrencynotes'].includes(c);}
function quantity(inv,id){const list=(inv.stackedItems||[]).filter(i=>i.catalogId===id);if(list.length>1||list.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<0))throw error('Invalid or duplicate saved stack: '+id);return list[0]?.quantity||0;}
function owns(inv,item){return(inv.instancedItems||[]).some(i=>i.catalogId===item.catalogId)||quantity(inv,item.catalogId)>=(item.quantity||1);}
function publicOffer(o,inv,signed){const held=o.items.filter(i=>owns(inv,i)),owned=held.length===o.items.length;
 return{id:o.sku,displayName:o.name,displayDescription:o.description||'',displayPriority:1000,tags:[...o.tags],
  prices:[{currencyId:'id_currency_notes',price:o.price,salesPrice:o.price,multiPrice:null}],
  items:o.items.map(i=>({catalogId:i.catalogId,quantity:i.quantity||1})),entitlements:[],skuProgression:[],images:{},
  maxAllowed:1,remaining:signed&&!owned?1:0,duplicateInstancedItems:held.map(i=>i.catalogId),loadoutSlots:null,
  availableFrom:null,availableTo:null,timeAvailabilityReason:null,platformOfferId:null,missingEntitlementNames:null,scheduledTags:null};}
function create(ctx,options={}){
 const now=options.now||Date.now,next=ctx.next||(()=>null),ok=(json,note)=>({status:200,json,note}),empty={stackedItems:[],instancedItems:[]};
 const session=req=>{const t=ctx.bearerOf(req);return t&&ctx.sessions.has(t)?ctx.playerFor(req):null;};
 const player=req=>{const p=session(req);if(!p)throw error('Signed-in player session required',403);return p;};
 const character=p=>p?.characters?.find(c=>typeof c.id==='string')?.id;
 const inventory=p=>p?.inventory?.[character(p)]||empty;
 function meta(p){p.mega1147??={};return p.mega1147.storeRams??={tokens:{}};}
 function atomic(p,fn){const before=clone(p);try{const r=fn();ctx.saveState();return r;}catch(e){for(const k of Object.keys(p))delete p[k];Object.assign(p,before);throw e;}}
 function eligible(p,o){if(!character(p))throw error('Saved character required');const inv=inventory(p);if(o.items.every(i=>owns(inv,i)))throw error('Item is already owned');if(quantity(inv,RAMS)<o.price)throw error('Not enough Rams');}
 function issue(p,o,cur){eligible(p,o);return atomic(p,()=>{const m=meta(p);for(const[k,t]of Object.entries(m.tokens))if(now()-t.at>7*86400000)delete m.tokens[k];if(Object.values(m.tokens).filter(t=>!t.done&&now()-t.at<=600000).length>=50)throw error('Too many pending Rams purchases',429);
  const token=PREFIX+crypto.randomBytes(32).toString('hex');m.tokens[hash(token)]={sku:o.sku,character:character(p),price:o.price,currency:curName(cur),at:now(),done:false};
  return ok({purchaseToken:token},'store-rams1147: token for '+o.sku+' ('+o.price+' Rams), client currency '+curName(cur)+(isRams(cur)?'':' (not a Rams name; charged in Rams)'));});}
 function redeem(p,token,cur){const t=p.mega1147?.storeRams?.tokens?.[hash(token)];if(!t||t.character!==character(p))throw error('Rams purchase belongs to another account or character',403);
  if(t.done)return{status:204,note:'store-rams1147: '+t.sku+' already paid (same token)'};if(now()-t.at>600000)throw error('Rams purchase expired',410);
  const o=bySku.get(t.sku);if(!o||o.price!==t.price)throw error('Rams offer changed');eligible(p,o);
  return atomic(p,()=>{const inv=ctx.inventoryOf(p,t.character),held=inv.stackedItems.find(i=>i.catalogId===RAMS);if(!held||held.quantity<t.price)throw error('Not enough Rams');held.quantity-=t.price;
   for(const i of o.items){if(owns(inv,i))continue;const q=i.quantity||1;
    if(i.kind==='instance')inv.instancedItems.push({catalogId:i.catalogId,instanceId:crypto.randomUUID(),updateVersion:0,itemData:null});
    else{const n=quantity(inv,i.catalogId)+q;if(!Number.isSafeInteger(n)||n>2147483647)throw error('Rams store quantity overflow');const s=inv.stackedItems.find(x=>x.catalogId===i.catalogId);if(s)s.quantity=n;else inv.stackedItems.push({catalogId:i.catalogId,quantity:n});}}
   t.done=true;return{status:204,note:'store-rams1147: '+o.sku+' bought for '+t.price+' Rams (client currency '+curName(cur)+'), '+held.quantity+' Rams left'};});}
 // The store's balance shows the character's real Rams (the captured balance is all zeros).
 function withRams(obj,p){if(!obj||typeof obj!=='object'||!p||!character(p))return obj;const n=quantity(inventory(p),RAMS);obj.CURRENCY_NOTES=n;obj.id_currency_notes=n;return obj;}
 function zeroed(o){for(const k of Object.keys(o))if(typeof o[k]==='number')o[k]=0;return o;}
 function handle(c){
  if(c.service!=='store')return next(c);const pathname=c.path.replace(/\/$/,'');
  if(c.method==='GET'&&pathname==='/product/skus/public'){
   const required=c.url.searchParams.getAll('requiredTags').flatMap(tags),base=next(c);
   const added=required.length?offers.filter(o=>required.every(t=>o.tags.includes(t))):[];
   const removed=Array.isArray(base?.json)?base.json.filter(o=>disabled.has(o?.id)).length:0;
   if(!added.length&&!removed)return base;
   if(!added.length)return{...base,json:base.json.filter(o=>!disabled.has(o?.id)),note:(base.note?base.note+'; ':'')+'store-rams1147: free pack(s) switched off'};
   const p=session(c.req),inv=inventory(p),list=Array.isArray(base?.json)?base.json.filter(o=>!bySku.has(o?.id)&&!disabled.has(o?.id)):[];
   return{...(base||{}),status:200,json:[...list,...added.map(o=>publicOffer(o,inv,!!p&&!!character(p)))],note:((base&&base.note)?base.note+'; ':'')+'store-rams1147: '+added.length+' Rams offer(s) for '+required.join(',')};
  }
  if(c.method==='GET'&&pathname==='/balance'){
   const p=session(c.req);if(!p)return next(c);const base=next(c);
   if(base&&base.json&&typeof base.json==='object'&&!Array.isArray(base.json))return{...base,json:withRams(clone(base.json),p),note:'store-rams1147: real Rams in the balance'};
   const cap=ctx.loadCapture?ctx.loadCapture('Store/Balance.md'):null;if(!cap||typeof cap!=='object')return base;
   return ok(withRams(zeroed(clone(cap)),p),'from captures; store-rams1147: real Rams in the balance');
  }
  if(c.method==='POST'&&pathname==='/reconcile'){
   const p=session(c.req);if(!p)return next(c);const base=next(c);
   if(base&&base.json&&typeof base.json==='object'&&base.json.balances){const j=clone(base.json);withRams(j.balances,p);return{...base,json:j,note:'store-rams1147: real Rams in the balance'};}
   if(base)return base;
   const cap=ctx.loadCapture?ctx.loadCapture('Store/Reconcile.md'):null;if(!cap||typeof cap!=='object')return base;
   const j=clone(cap);if(j.balances&&typeof j.balances==='object'){zeroed(j.balances);withRams(j.balances,p);}return ok(j,'from captures; store-rams1147: real Rams in the balance');
  }
  const single=/^\/product\/sku\/(.+)$/.exec(pathname);
  if(c.method==='GET'&&single&&bySku.has(single[1])){const p=session(c.req);return ok(publicOffer(bySku.get(single[1]),inventory(p),!!p&&!!character(p)));}
  const token=/^\/token\/([^/]+)\/(.+)$/.exec(pathname);
  if(c.method==='GET'&&((single&&disabled.has(single[1]))||(token&&disabled.has(token[2]))))throw error('This free pack is switched off; the items are in the Rams store',410);
  if(c.method==='GET'&&token&&bySku.has(token[2]))return issue(player(c.req),bySku.get(token[2]),token[1]);
  if(c.method==='POST'&&pathname.startsWith('/notification/')){const t=[c.url.searchParams.get('token'),c.url.searchParams.get('purchaseToken'),c.body?.token,c.body?.purchaseToken].find(t=>typeof t==='string'&&t.startsWith(PREFIX));if(t)return redeem(player(c.req),t,pathname.slice('/notification/'.length));}
  return next(c);
 }
 return{handle};
}
module.exports={create,publicOffer,owns,isRams,offers,disabled};
