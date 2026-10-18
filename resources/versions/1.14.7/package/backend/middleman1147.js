// SPDX-License-Identifier: AGPL-3.0-only
// Slot identity and replay handling adapted from the working 1.6.2 middleman09.
'use strict';
const crypto=require('crypto');
const TOKEN='TOKEN_CELL_EXCHANGE',MAX_MS=420000;
const clone=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const SKU=slot=>'mega1147_exchange_slot_'+slot;
const slotOf=sku=>[2,3].find(n=>SKU(n)===sku);
const isPlatinum=value=>typeof value==='string'&&['platinum','id_currency_platinum','currency_platinum'].includes(value.toLowerCase());
function error(message,status=409){const e=Error(message);e.status=status;return e;}
function data(item,strict=true){
 try{
  const d=typeof item?.itemData==='string'?JSON.parse(item.itemData):item?.itemData;
  if(!Number.isInteger(d?.SlotID)||d.SlotID<1||d.SlotID>3||typeof d.EndTime!=='string'||!Number.isFinite(Date.parse(d.EndTime))||
    typeof d.ExchangeID!=='string'||!d.ExchangeID.length||d.ExchangeID.length>256||!/^CELL_[A-Za-z0-9_]+$/.test(d.ResultCell))throw Error();
  return clone(d);
 }catch{if(strict)throw error('Invalid fusion slot data',400);return null;}
}
function normalize(inv,now){
 const slots=new Set();
 for(const i of inv.instancedItems){if(i.catalogId!==TOKEN)continue;const d=data(i);
  if(slots.has(d.SlotID))throw error('Duplicate fusion slot requires repair');slots.add(d.SlotID);
  i.instanceId=TOKEN+':'+d.SlotID;
  const end=Math.min(Date.parse(d.EndTime),now+MAX_MS);if(end!==Date.parse(d.EndTime))d.EndTime=new Date(end).toISOString();
  i.itemData=JSON.stringify(d);
 }
 return inv;
}
function create(ctx,options={}){
 const now=options.now||Date.now,next=ctx.next||(()=>null);
 const ok=(json,note)=>({status:200,json,note});
 const signed=req=>{const t=ctx.bearerOf(req);return t&&ctx.sessions.has(t)?ctx.playerFor(req):null;};
 function atomic(p,fn){const before=clone(p);try{const r=fn();ctx.saveState();return r;}catch(e){for(const k of Object.keys(p))delete p[k];Object.assign(p,before);throw e;}}
 function meta(p){p.mega1147??={};return p.mega1147.middleman??={tokens:{},receipts:{},requests:{}};}
 const owns=(p,n)=>n===1||(p?.entitlements||[]).some(e=>e.name==='exchange_slot_'+n&&(e.duration===0||Date.parse(e.activatedDate)+e.duration*3600000>now()));
 function offer(p,n){return{id:SKU(n),displayName:'Middleman Fusion Slot '+n,displayDescription:'Permanently unlock this additional cell fusion slot.',
  displayPriority:30+n,tags:['exchange_vendor_slot_'+n,'webstore','supplies_supplies'],prices:[{currencyId:'id_currency_platinum',price:0,salesPrice:0}],
  items:[],entitlements:[{name:'exchange_slot_'+n,duration:0}],skuProgression:[],images:[],maxAllowed:1,remaining:p&&!owns(p,n)?1:0,
  loadoutSlots:null,availableFrom:null,availableTo:null,timeAvailabilityReason:null,platformOfferId:null,missingEntitlementNames:null};}
 function purchase(p,n){if(owns(p,n))throw error('Fusion slot is already unlocked');return atomic(p,()=>{
  const m=meta(p);for(const [k,t]of Object.entries(m.tokens))if(now()-t.at>3600000)delete m.tokens[k];
  if(Object.keys(m.tokens).length>=100)throw error('Too many outstanding slot purchases',429);
  const token='middleman1147_'+crypto.randomBytes(32).toString('hex');m.tokens[hash(token)]={slot:n,at:now(),done:false};return ok({purchaseToken:token});
 });}
 function redeem(p,token){const t=p.mega1147?.middleman?.tokens?.[hash(token)];if(!t)throw error('Slot purchase belongs to another account',403);if(t.done)return{status:204};if(now()-t.at>600000)throw error('Slot purchase expired',410);
  return atomic(p,()=>{if(!owns(p,t.slot)){p.entitlements??=[];p.entitlements=p.entitlements.filter(e=>e.name!=='exchange_slot_'+t.slot);p.entitlements.push({name:'exchange_slot_'+t.slot,duration:0,activatedDate:null});}t.done=true;return{status:204};});
 }
 function fusion(p,body){
  if(body.accountId&&body.accountId!==p.accountId)throw error('Fusion account mismatch',403);
  const cid=body.characterId||p.characters?.[0]?.id;if(!p.characters?.some(c=>c.id===cid))throw error('Fusion character does not belong to this account',403);
  const digest=hash(JSON.stringify(body)),m=p.mega1147?.middleman;
  if(m?.requests?.[digest])return ok(clone(m.requests[digest]),'middleman1147: repeated fusion');
  const b=clone(body),fields=['addInstancedItems','saveInstancedItems','removeInstancedItems','addStackedItems','removeStackedItems'];
  for(const k of fields){if(b[k]===undefined)b[k]=[];if(!Array.isArray(b[k]))throw error('Invalid fusion inventory array',400);}
  const inv=normalize(clone(ctx.inventoryOf(p,cid)),now());
  const held=i=>{
   const id=typeof i==='string'?i:i?.instanceId,d=data(i,false);
   const candidates=inv.instancedItems.filter(x=>x.catalogId===TOKEN&&(d?data(x).SlotID===d.SlotID:id===TOKEN||x.instanceId===id));
   if(candidates.length!==1)throw error('Fusion token is missing or ambiguous');return candidates[0];
  };
  const ops=[];
  for(const k of ['addInstancedItems','saveInstancedItems'])for(const i of b[k])if(i.catalogId===TOKEN){
   const d=data(i);i.instanceId=TOKEN+':'+d.SlotID;
   if(k==='addInstancedItems'){
    if(!owns(p,d.SlotID))throw error('Unlock this Middleman slot first');
    const occupied=inv.instancedItems.find(x=>x.catalogId===TOKEN&&data(x).SlotID===d.SlotID);
    const key='start:'+hash(d.ExchangeID);ops.push(key);
    if(occupied&&data(occupied).ExchangeID!==d.ExchangeID)throw error('Fusion slot is already occupied');
    if(occupied&&!m?.receipts?.[key])return ok({createdInstancedItems:[clone(occupied)],updatedInstancedItems:[],updatedStackedItems:[],removedInstancedItems:[]},'middleman1147: existing fusion preserved');
   }else{
    const h=data(held(i));if(h.ExchangeID!==d.ExchangeID||h.ResultCell!==d.ResultCell)throw error('Cannot replace an active fusion');
    if(Date.parse(d.EndTime)>Date.parse(h.EndTime))throw error('Cannot delay a fusion');
    ops.push('save:'+hash(d.ExchangeID+'\n'+Date.parse(d.EndTime)));
   }
   d.EndTime=new Date(Math.min(Date.parse(d.EndTime),now()+MAX_MS)).toISOString();i.itemData=JSON.stringify(d);
  }
  for(let n=0;n<b.removeInstancedItems.length;n++){
   const i=b.removeInstancedItems[n],id=typeof i==='string'?i:i?.instanceId;
   if(i?.catalogId!==TOKEN&&id!==TOKEN&&!String(id).startsWith(TOKEN+':'))continue;
   const h=held(i),hd=data(h),d=data(i,false);
   if(d&&(d.ExchangeID!==hd.ExchangeID||d.ResultCell!==hd.ResultCell))throw error('Fusion removal identity differs');
   if(Date.parse(hd.EndTime)>now())throw error('Fusion is not ready');
   ops.push('remove:'+hash(hd.ExchangeID));b.removeInstancedItems[n]={...clone(h),...typeof i==='object'?i:{},instanceId:h.instanceId};
  }
  const hits=ops.map(k=>m?.receipts?.[k]);if(hits.length&&hits.every(Boolean))return ok(clone(hits[0]),'middleman1147: repeated fusion phase');
  if(hits.some(Boolean))throw error('Partly repeated fusion transaction');
  if(!ops.length)throw error('Fusion request has no stable identity',400);
  const costs=new Map();for(const i of b.removeStackedItems){if(typeof i.catalogId!=='string'||!Number.isSafeInteger(i.quantity)||i.quantity<=0)throw error('Invalid fusion cost',400);costs.set(i.catalogId,(costs.get(i.catalogId)||0)+i.quantity);}
  for(const [id,q]of costs){const stacks=inv.stackedItems.filter(i=>i.catalogId===id);if(stacks.length!==1||!Number.isSafeInteger(stacks[0].quantity)||stacks[0].quantity<q)throw error('Not enough cells or fusion currency');}
  return atomic(p,()=>{
   const result=ctx.applyInventory(inv,b);p.inventory[cid]=inv;const mm=meta(p);mm.requests[digest]=clone(result);for(const k of ops)mm.receipts[k]=clone(result);
   for(const key of Object.keys(mm.requests).slice(0,-512))delete mm.requests[key];
   return ok(result,'middleman1147: fusion saved; maximum 7 minutes');
  });
 }
 function handle(c){
  const pathname=c.path.replace(/\/$/,'');
  if(c.service==='store'){
   if(c.method==='GET'&&pathname==='/product/skus/public'){
    const r=next(c);const required=c.url.searchParams.getAll('requiredTags').flatMap(v=>{try{const a=JSON.parse(v);if(Array.isArray(a))return a.map(String);}catch{}return v.split(/[,;|]/);}).map(s=>s.trim().toLowerCase());
    const p=signed(c.req),added=[2,3].map(n=>offer(p,n)).filter(o=>required.every(t=>o.tags.includes(t)));
    return{...r,status:200,json:[...(r?.json||[]).filter(o=>!slotOf(o.id)),...added],note:'middleman1147: slot listings'};
   }
   const single=/^\/product\/sku\/(.+)$/.exec(pathname);if(c.method==='GET'&&single&&slotOf(single[1]))return ok(offer(signed(c.req),slotOf(single[1])));
   const token=/^\/token\/([^/]+)\/(.+)$/.exec(pathname);
   if(c.method==='GET'&&token&&slotOf(token[2])){const p=signed(c.req);if(!p)throw error('Signed-in player session required',403);if(!isPlatinum(token[1]))throw error('Unsupported purchase currency',400);return purchase(p,slotOf(token[2]));}
   if(c.method==='POST'&&pathname.startsWith('/notification/')){
    const t=[c.url.searchParams.get('token'),c.url.searchParams.get('purchaseToken'),c.body?.token,c.body?.purchaseToken].find(t=>typeof t==='string'&&t.startsWith('middleman1147_'));
    if(t){const p=signed(c.req);if(!p)throw error('Signed-in player session required',403);if(!isPlatinum(pathname.slice('/notification/'.length)))throw error('Unsupported purchase currency',400);return redeem(p,t);}
   }
  }
  if(c.service==='dauntless'&&c.method==='POST'&&pathname==='/inventory'){
   const b=c.body;if(b&&['addInstancedItems','saveInstancedItems','removeInstancedItems'].some(k=>Array.isArray(b[k])&&b[k].some(i=>i?.catalogId===TOKEN||(typeof i==='string'?i:i?.instanceId)?.startsWith(TOKEN))))return fusion(ctx.playerFor(c.req),b);
  }
  const get=/^\/inventory\/([^/]+)\/([^/]+)$/.exec(pathname);
  if(c.service==='dauntless'&&c.method==='GET'&&get){
   const p=ctx.playerFor(c.req),inv=p.inventory?.[get[2]];
   if(inv?.instancedItems?.some(i=>i.catalogId===TOKEN)){
    if(get[1]!==p.accountId||!p.characters.some(ch=>ch.id===get[2]))throw error('Fusion inventory owner mismatch',403);
    const fixed=normalize(clone(inv),now());if(JSON.stringify(fixed)!==JSON.stringify(inv))atomic(p,()=>{p.inventory[get[2]]=fixed;});
   }
  }
  return next(c);
 }
 return{handle};
}
module.exports={create,data,normalize,TOKEN,MAX_MS,SKU};
