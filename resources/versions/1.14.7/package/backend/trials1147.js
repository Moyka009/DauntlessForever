// SPDX-License-Identifier: AGPL-3.0-only
// Ownership and saved purchase flow adapted from the working 1.6.2 Trials shop.
'use strict';
const crypto=require('crypto'),catalog=require('./trials1147-data.json');
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const byId=new Map(catalog.map(o=>[o.id,o]));
function error(message,status=409){const e=Error(message);e.status=status;return e;}
function currency(value){const c=String(value).replace(/[_\s-]/g,'').toLowerCase();if(['steelmarks','markssteel','currencymarkssteel','idcurrencymarkssteel'].includes(c))return'CURRENCY_MARKS_STEEL';if(['gildedmarks','marksgilded','currencymarksgilded','idcurrencymarksgilded'].includes(c))return'CURRENCY_MARKS_GILDED';return null;}
function tags(v){if(Array.isArray(v))return v.flatMap(tags);if(typeof v!=='string')return[];try{const a=JSON.parse(v);if(Array.isArray(a))return a.flatMap(tags);}catch{}return v.split(/[,;|]/).map(t=>t.trim().toLowerCase()).filter(Boolean);}
function quantity(inv,id){const list=(inv.stackedItems||[]).filter(i=>i.catalogId===id);if(list.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<0)||list.length>1)throw error('Invalid or duplicate saved stack: '+id,409);return list[0]?.quantity||0;}
function owns(inv,item){return(inv.instancedItems||[]).some(i=>i.catalogId===item.catalogId)||quantity(inv,item.catalogId)>=item.quantity;}
function publicOffer(o,inv){const result=clone(o);delete result.repeatable;delete result.championOnly;for(const i of result.items){delete i.kind;delete i.source;}
 result.maxAllowed=1;result.remaining=o.repeatable?1:o.items.every(i=>owns(inv,i))?0:1;
 result.duplicateInstancedItems=o.repeatable?[]:o.items.filter(i=>owns(inv,i)).map(i=>i.catalogId);
 // Rank eligibility is distinct from owning an item. Do not label an unowned
 // Champion reward as owned merely because local Top 100 verification is absent.
 if(o.championOnly)result.missingEntitlementNames=['Trials Champion: verified Top 100 unlock required'];
 return result;
}
function create(ctx,options={}){
 const now=options.now||Date.now,next=ctx.next||(()=>null),ok=(json,note)=>({status:200,json,note});
 const player=req=>{const t=ctx.bearerOf(req);if(!t||!ctx.sessions.has(t))throw error('Signed-in player session required',403);return ctx.playerFor(req);};
 const character=p=>p.characters?.find(c=>typeof c.id==='string')?.id;
 function inventory(p){const id=character(p);if(!id)throw error('Saved character required');return p.inventory?.[id]||{stackedItems:[],instancedItems:[]};}
 function meta(p){p.mega1147??={};return p.mega1147.trials??={tokens:{}};}
 function atomic(p,fn){const before=clone(p);try{const r=fn();ctx.saveState();return r;}catch(e){for(const k of Object.keys(p))delete p[k];Object.assign(p,before);throw e;}}
 function eligible(o,inv,cur){const price=o.prices[0];if(cur!==currency(price.currencyId))throw error('Incorrect Trials purchase currency',400);if(o.championOnly)throw error('Champion rewards require verified Top 100 support',403);if(!o.repeatable&&o.items.every(i=>owns(inv,i)))throw error('Trials item is already owned');if(quantity(inv,cur)<price.price)throw error('Not enough Trials marks');}
 function issue(p,o,cur){eligible(o,inventory(p),cur);return atomic(p,()=>{const m=meta(p);for(const[k,t]of Object.entries(m.tokens))if(now()-t.at>7*86400000)delete m.tokens[k];if(Object.values(m.tokens).filter(t=>!t.done&&now()-t.at<=600000).length>=50)throw error('Too many pending Trials purchases',429);
  const token='trials1147_'+crypto.randomBytes(32).toString('hex');m.tokens[hash(token)]={sku:o.id,character:character(p),currency:cur,price:o.prices[0].price,at:now(),done:false};return ok({purchaseToken:token});});}
 function redeem(p,token,cur){const t=p.mega1147?.trials?.tokens?.[hash(token)];if(!t||t.character!==character(p))throw error('Trials purchase belongs to another account or character',403);if(cur!==t.currency)throw error('Trials purchase currency mismatch',400);if(t.done)return{status:204};if(now()-t.at>600000)throw error('Trials purchase expired',410);const o=byId.get(t.sku);if(!o||t.price!==o.prices[0].price)throw error('Trials offer changed');eligible(o,inventory(p),cur);
  return atomic(p,()=>{const inv=ctx.inventoryOf(p,t.character),held=inv.stackedItems.find(i=>i.catalogId===cur);if(!held||held.quantity<t.price)throw error('Not enough Trials marks');held.quantity-=t.price;
   for(const i of o.items){if(!o.repeatable&&owns(inv,i))continue;if(i.kind==='instance')inv.instancedItems.push({catalogId:i.catalogId,instanceId:crypto.randomUUID(),updateVersion:0,itemData:null});else{const q=quantity(inv,i.catalogId)+i.quantity;if(!Number.isSafeInteger(q)||q>2147483647)throw error('Trials reward quantity overflow');const item=inv.stackedItems.find(x=>x.catalogId===i.catalogId);if(item)item.quantity=q;else inv.stackedItems.push({catalogId:i.catalogId,quantity:q});}}
   t.done=true;return{status:204};});
 }
 function handle(c){
  if(c.service!=='store')return next(c);const pathname=c.path.replace(/\/$/,'');
  if(c.method==='GET'&&pathname==='/product/skus/public'){
   const required=c.url.searchParams.getAll('requiredTags').flatMap(tags);
   if(required.some(t=>t==='ladyluckstore'||t.startsWith('store_trials_tab_'))){const p=player(c.req),inv=inventory(p),base=next(c),added=catalog.filter(o=>required.every(t=>o.tags.includes(t))).map(o=>publicOffer(o,inv));return ok([...(base?.json||[]).filter(o=>!byId.has(o?.id)&&!o?.tags?.includes('ladyluckstore')),...added],'trials1147: ownership from saved inventory');}
  }
  const single=/^\/product\/sku\/(.+)$/.exec(pathname);if(c.method==='GET'&&single&&byId.has(single[1]))return ok(publicOffer(byId.get(single[1]),inventory(player(c.req))));
  const token=/^\/token\/([^/]+)\/(.+)$/.exec(pathname);if(c.method==='GET'&&token&&byId.has(token[2]))return issue(player(c.req),byId.get(token[2]),currency(token[1]));
  if(c.method==='POST'&&pathname.startsWith('/notification/')){const t=[c.url.searchParams.get('token'),c.url.searchParams.get('purchaseToken'),c.body?.token,c.body?.purchaseToken].find(t=>typeof t==='string'&&t.startsWith('trials1147_'));if(t)return redeem(player(c.req),t,currency(pathname.slice('/notification/'.length)));}
  return next(c);
 }
 return{handle};
}
module.exports={create,publicOffer,owns,currency,catalog};
