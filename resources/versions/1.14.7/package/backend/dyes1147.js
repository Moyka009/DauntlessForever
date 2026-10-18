// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const crypto=require('crypto'),catalog=require('./dyes1147-data.json');
const bySku=new Map(catalog.map(d=>[d.sku,d])),clone=x=>JSON.parse(JSON.stringify(x)),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const pack={sku:'dyes1147_all_dyes',name:'All Dyes Pack',price:0,tags:[...new Set(catalog.flatMap(d=>d.tags))]};
const contents=d=>d.sku===pack.sku?catalog:[d];
function dyeOffer(o){if(!o||typeof o!=='object')return false;if(bySku.has(o.id)||o.id===pack.sku)return true;const items=Array.isArray(o.items)?o.items:[];return items.some(i=>/^DYE_/i.test(typeof i==='string'?i:String(i?.catalogId||i?.catalog_id||i?.itemId||i?.item_id||'')))||tags(o.tags).some(t=>['dyes','dye_armour','cat_item_armour_dye'].includes(t));}
function error(message,status=409){const e=Error(message);e.status=status;return e;}
function tags(v){if(Array.isArray(v))return v.flatMap(tags);if(typeof v!=='string')return[];try{const a=JSON.parse(v);if(Array.isArray(a))return a.flatMap(tags);}catch{}return v.split(/[,;|]/).map(x=>x.trim().toLowerCase()).filter(Boolean);}
function platinum(s){return ['platinum','id_currency_platinum','currency_platinum'].includes(String(s).toLowerCase());}
function quantity(inv,id){const held=(inv.stackedItems||[]).filter(x=>x.catalogId===id);if(held.length>1||held.some(x=>!Number.isSafeInteger(x.quantity)||x.quantity<0))throw error('Invalid saved dye/currency stack');return held[0]?.quantity||0;}
function owns(inv,id){return(inv.instancedItems||[]).some(x=>x.catalogId===id)||quantity(inv,id)>0;}
function offer(d,inv,signed){const dyes=contents(d),held=dyes.filter(x=>owns(inv,x.catalogId)),owned=held.length===dyes.length;return{id:d.sku,displayName:d.name,displayDescription:'Unlock all '+catalog.length+' dyes. Already-owned dyes are kept.',displayPriority:1000,tags:[...d.tags],prices:[{currencyId:'id_currency_platinum',price:0,salesPrice:0,multiPrice:null}],items:dyes.map(x=>({catalogId:x.catalogId,quantity:1})),entitlements:[],skuProgression:[],images:{},maxAllowed:1,remaining:signed&&!owned?1:0,duplicateInstancedItems:held.map(x=>x.catalogId),loadoutSlots:null,availableFrom:null,availableTo:null,timeAvailabilityReason:null,platformOfferId:null,missingEntitlementNames:null,scheduledTags:null};}
function create(ctx,options={}){
 const now=options.now||Date.now,next=ctx.next||(()=>null),empty={stackedItems:[],instancedItems:[]},retiredSkus=new Set(bySku.keys());
 const player=req=>{const t=ctx.bearerOf(req);return t&&ctx.sessions.has(t)?ctx.playerFor(req):null;};
 const character=p=>p?.characters?.find(c=>typeof c.id==='string')?.id;
 const inventory=p=>p?.inventory?.[character(p)]||empty;
 const meta=p=>{p.mega1147??={};return p.mega1147.dyes??={tokens:{}};};
 function atomic(p,fn){const before=clone(p);try{const r=fn();ctx.saveState();return r;}catch(e){for(const k of Object.keys(p))delete p[k];Object.assign(p,before);throw e;}}
 function eligible(p,d){if(!p)throw error('Signed-in player session required',403);if(!character(p))throw error('Saved character required');const inv=inventory(p);if(contents(d).every(x=>owns(inv,x.catalogId)))throw error('All dyes in this offer are already owned');}
 function issue(p,d,cur){if(!platinum(cur))throw error('Unsupported dye purchase currency',400);eligible(p,d);return atomic(p,()=>{const m=meta(p);for(const[k,t]of Object.entries(m.tokens))if(now()-t.at>7*86400000)delete m.tokens[k];if(Object.values(m.tokens).filter(t=>!t.done&&now()-t.at<=600000).length>=50)throw error('Too many pending dye purchases',429);const token='dyes1147_'+crypto.randomBytes(32).toString('hex');m.tokens[hash(token)]={sku:d.sku,character:character(p),at:now(),done:false};return{status:200,json:{purchaseToken:token}};});}
 function redeem(p,token,cur){if(!p)throw error('Signed-in player session required',403);if(!platinum(cur))throw error('Unsupported dye purchase currency',400);const t=p.mega1147?.dyes?.tokens?.[hash(token)];if(!t||t.character!==character(p))throw error('Dye purchase belongs to another account or character',403);if(t.done)return{status:204};if(now()-t.at>600000)throw error('Dye purchase expired',410);const d=t.sku===pack.sku?pack:bySku.get(t.sku);if(!d)throw error('Unknown dye offer');if(!character(p))throw error('Saved character required');
  return atomic(p,()=>{const inv=ctx.inventoryOf(p,t.character);for(const dye of contents(d)){if(owns(inv,dye.catalogId))continue;if(dye.kind==='instance')inv.instancedItems.push({catalogId:dye.catalogId,instanceId:crypto.randomUUID(),updateVersion:0,itemData:null});else{const item=inv.stackedItems.find(x=>x.catalogId===dye.catalogId);if(item)item.quantity=1;else inv.stackedItems.push({catalogId:dye.catalogId,quantity:1});}}t.done=true;return{status:204};});
 }
 function handle(c){if(c.service!=='store')return next(c);const pathname=c.path.replace(/\/$/,'');
  if(c.method==='GET'&&pathname==='/product/skus/public'){const required=c.url.searchParams.getAll('requiredTags').flatMap(tags),p=player(c.req),inv=inventory(p),base=next(c),original=Array.isArray(base?.json)?base.json:[];const kept=original.filter(o=>{if(!dyeOffer(o))return true;if(typeof o.id==='string'&&o.id!==pack.sku)retiredSkus.add(o.id);return false;});const added=required.every(t=>pack.tags.includes(t))?[offer(pack,inv,!!p&&!!character(p))]:[];return{...base,status:200,json:[...kept,...added],note:'dyes1147: one free All Dyes pack; captured and legacy dye listings removed'};}
  const single=/^\/product\/sku\/(.+)$/.exec(pathname);if(c.method==='GET'&&single&&single[1]===pack.sku){const p=player(c.req);return{status:200,json:offer(pack,inventory(p),!!p&&!!character(p))};}
  const token=/^\/token\/([^/]+)\/(.+)$/.exec(pathname);if(c.method==='GET'&&token&&token[2]===pack.sku)return issue(player(c.req),pack,token[1]);
  if(c.method==='GET'&&((single&&retiredSkus.has(single[1]))||(token&&retiredSkus.has(token[2]))))throw error('Individual dyes replaced by the All Dyes pack',410);
  if(c.method==='POST'&&pathname.startsWith('/notification/')){const t=[c.url.searchParams.get('token'),c.url.searchParams.get('purchaseToken'),c.body?.token,c.body?.purchaseToken].find(x=>typeof x==='string'&&x.startsWith('dyes1147_'));if(t)return redeem(player(c.req),t,pathname.slice('/notification/'.length));}
  return next(c);
 }
 return{handle};
}
module.exports={create,catalog,pack,offer,owns,dyeOffer};
