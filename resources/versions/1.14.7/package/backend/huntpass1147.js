// SPDX-License-Identifier: AGPL-3.0-only
// Mega pass selection, expansion and catch-up follow the working 1.6.2 pass.
'use strict';
const crypto=require('crypto'),baseData=require('./huntpass1147-data.json');
const data=baseData,PASS=data.pass_id,MAX=data.levels*data.xp_per_level,PREMIUM=PASS+'_premium';
const clone=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const isPlatinum=x=>['platinum','currency_platinum','id_currency_platinum'].includes(String(x).toLowerCase());
const expanded=(rank,data=baseData)=>(data.rewards[String(rank)]||[]).flatMap(id=>data.bundles[id]||[id]);
function error(message,status=409){const e=Error(message);e.status=status;return e;}
function integer(n,label){if(!Number.isSafeInteger(n)||n<0)throw error('Invalid '+label,400);return n;}
function level(xp,data=baseData){return Math.min(data.levels,Math.floor(integer(xp,'Hunt Pass XP')/data.xp_per_level));}
function emptyReward(rank){return{rank_id:rank,entitlements:[],instanced_items:[],ordered_instanced_items:[],stacked_items:[]};}
// DF-PASSWINDOW-1147 (Addison2k): the game builds one weekly Challenges header per week of the pass season. A season
// running to 2099 made it build thousands, which is the lag when opening Bounties/Challenges. The pass stays
// permanent, but the game is shown a rolling 12-week season starting at the pass's own start date.
function passWindow(data){const W=12*7*864e5,base=Date.parse(data.start_date)||Date.UTC(2026,9,17),n=Math.max(0,Math.floor((Date.now()-base)/W));
 const iso=t=>new Date(t).toISOString().replace(/\.\d{3}Z$/,'+00:00');return{start:iso(base+n*W),end:iso(base+(n+1)*W)};}
function pathConfig(data=baseData){const path={progression_id:PASS,premium_gating_entitlement:PREMIUM,reset_with_character:false,progression_multiplier:1,start_date:passWindow(data).start,end_date:passWindow(data).end,requirements:[{rank_id:0,xp_required:0}],free_rewards:[emptyReward(0)],premium_rewards:[emptyReward(0)]};
 for(let rank=1;rank<=data.levels;rank++){
  path.requirements.push({rank_id:rank,xp_required:data.xp_per_level});
  for(const side of ['free','premium']){const r=emptyReward(rank);
   const entries=data.grants?(data.grants[String(rank)]?.[side]||[]):(side==='premium'?(data.rewards[String(rank)]||[]).map(id=>[id,1]):[]);
   for(const [priority,[id,quantity]] of entries.entries()){
    if(data.bundles[id]||data.items[id].kind==='instance'){for(let n=0;n<quantity;n++)r.ordered_instanced_items.push({catalog_id:id,hidden:false,priority:r.ordered_instanced_items.length});}
    else r.stacked_items.push({catalog_id:id,quantity,hidden:false,priority});
   }path[side+'_rewards'].push(r);
  }
 }return path;
}
function progressBody(body){if(!body||typeof body!=='object'||Array.isArray(body))return body;const b=clone(body);for(const t of Array.isArray(b.progress_tracks)?b.progress_tracks:[]){if(t?.progression_id!==PASS)continue;const echo=['confirmed_fremium_rank','confirmed_freemium_rank','confirmed_free_rank','confirmed_premium_rank'].some(k=>Object.hasOwn(t,k));if(echo)t.progress=0;else integer(t.progress??0,'Hunt Pass XP grant');}return b;}
function create(ctx,options={}){
 const data=options.data||baseData,seasons=options.seasons,MAX=data.levels*data.xp_per_level;
 const rankLevel=x=>level(x,data),config=()=>pathConfig(data),grants=rank=>data.grants?[...(data.grants[String(rank)]?.free||[]),...(data.grants[String(rank)]?.premium||[])]:expanded(rank,data).map(id=>[id,1]);
 const now=options.now||Date.now,next=ctx.next||(()=>null),ok=(json,note)=>({status:200,json,note}),wrapped=payload=>({code:null,message:'OK',payload});
 function atomic(p,fn){const before=clone(p),dirty=seasons?.dirty(p);try{seasons?.prepare(p);return fn();}catch(e){for(const k of Object.keys(p))delete p[k];Object.assign(p,before);seasons?.setDirty(p,dirty);throw e;}}
 function track(p){p.progress??={tracks:{},objectives:{}};p.progress.tracks??={};const t=p.progress.tracks[PASS]??={progress:0};integer(t.progress??0,'saved Hunt Pass XP');return t;}
 function meta(p){p.mega1147??={};return p.mega1147.huntpass??={revision:data.revision,paid_rank:0,tokens:{}};}
 function held(inv,id){return inv.instancedItems.some(i=>i.catalogId===id)||inv.stackedItems.some(i=>i.catalogId===id&&i.quantity>0);}
 function add(inv,id,quantity=1){const i=data.items[id];if(!i)throw error('Unknown 1.14.7 pass reward');integer(quantity,'reward quantity');const unique=i.cosmetic!==false;if(unique&&held(inv,id))return;quantity=unique?1:quantity;
  if(i.kind==='instance'){for(let n=0;n<quantity;n++)inv.instancedItems.push({catalogId:id,instanceId:crypto.randomUUID(),itemData:null,updateVersion:0});}
  else{const stack=inv.stackedItems.find(x=>x.catalogId===id);if(stack){integer(stack.quantity,'reward stack');stack.quantity=unique?1:integer(stack.quantity+quantity,'reward balance');}else inv.stackedItems.push({catalogId:id,quantity});}}
 function settle(p){seasons?.prepare(p);const before=JSON.stringify([p.progress?.tracks?.[PASS],p.mega1147?.huntpass]);const t=track(p),m=meta(p),top=rankLevel(t.progress);const from=m.revision===data.revision?integer(m.paid_rank||0,'paid Hunt Pass rank'):0;
  if(top<from)throw error('Hunt Pass XP cannot rewind paid rewards');
  if(top>from){const cid=p.characters?.[0]?.id;if(!cid)throw error('A saved character is required for Hunt Pass rewards');const inv=ctx.inventoryOf(p,cid);if(!Array.isArray(inv.stackedItems)||!Array.isArray(inv.instancedItems))throw error('Malformed reward inventory');for(let rank=from+1;rank<=top;rank++)for(const [id,quantity] of grants(rank))add(inv,id,quantity);}
  m.revision=data.revision;m.paid_rank=top;t.confirmed_fremium_rank=top;t.confirmed_premium_rank=top;
  if(top>from)t.confirmed_date=new Date(now()).toISOString().slice(0,19);
  return before!==JSON.stringify([p.progress.tracks[PASS],p.mega1147.huntpass])||!!seasons?.dirty(p);
 }
 function settleSaved(p){return atomic(p,()=>{if(settle(p))ctx.saveState();});}
 function assertDelta(id,n){if(id===PASS)integer(n,'Hunt Pass XP grant');}
 function out(p){const t=track(p);return{phx_account_id:p.accountId,progression_id:PASS,progress:t.progress,confirmed_fremium_rank:t.confirmed_fremium_rank||0,confirmed_premium_rank:t.confirmed_premium_rank||0,confirmed_date:t.confirmed_date||null};}
 function premium(p){if(!Array.isArray(p.entitlements))p.entitlements=[];if(!p.entitlements.some(e=>e.name===PREMIUM&&e.duration===0)){p.entitlements=p.entitlements.filter(e=>e.name!==PREMIUM);p.entitlements.push({name:PREMIUM,duration:0,activatedDate:null});return true;}return false;}
 function signed(req){const t=ctx.bearerOf(req);if(!t||!ctx.sessions.has(t))throw error('Signed-in player session required',403);const p=ctx.playerFor(req);seasons?.prepare(p);return p;}
 function skuRank(sku){if(sku==='hp_level_skip_1_rank')return 1;const m=/^hp_level_skip_(\d+)_ranks$/.exec(sku);return m&&+m[1]>=2&&+m[1]<=100?+m[1]:null;}
 function offer(p,ranks){const t=p.progress?.tracks?.[PASS]||{progress:0},available=!!p.characters?.[0]?.id&&rankLevel(t.progress)+ranks<=data.levels;return{id:ranks===1?'hp_level_skip_1_rank':'hp_level_skip_'+ranks+'_ranks',displayName:'Hunt Pass Level Skip',displayDescription:'Advance '+ranks+' Hunt Pass rank'+(ranks===1?'':'s')+'.',displayPriority:1000,tags:['event','hp_level_skip_rank'],prices:[{currencyId:'id_currency_platinum',price:150*ranks,salesPrice:150*ranks}],items:[],entitlements:[],skuProgression:{progressionId:'selected_huntpass',ranks,xp:null},images:[],maxAllowed:1,remaining:available?1:0,loadoutSlots:null,availableFrom:null,availableTo:null,timeAvailabilityReason:null,platformOfferId:null,missingEntitlementNames:null};}
 function balance(p){const inv=p.inventory?.[p.characters?.[0]?.id];const list=(inv?.stackedItems||[]).filter(i=>i.catalogId==='CURRENCY_PLATINUM');if(list.length>1||list.some(i=>!Number.isSafeInteger(i.quantity)||i.quantity<0))throw error('Invalid platinum balance');return list[0]?.quantity||0;}
 function premiumOffer(p){return{id:PREMIUM,displayName:'Hunt Pass - Both Tracks',displayDescription:'Both tracks are enabled for this local pass.',displayPriority:1,tags:[PASS+'_pass'],prices:[{currencyId:'id_currency_platinum',price:0,salesPrice:0}],items:[],entitlements:[{name:PREMIUM,duration:0}],skuProgression:null,images:[],maxAllowed:1,remaining:(p.entitlements||[]).some(e=>e.name===PREMIUM&&e.duration===0)?0:1,loadoutSlots:null,availableFrom:null,availableTo:null,timeAvailabilityReason:null,platformOfferId:null,missingEntitlementNames:null};}
 function issue(p,ranks){if(!p.characters?.[0]?.id)throw error('Saved character required');const o=offer(p,ranks);if(!o.remaining)throw error('Not enough Hunt Pass ranks remain');if(balance(p)<o.prices[0].price)throw error('Not enough platinum');return atomic(p,()=>{const m=meta(p);for(const[k,t]of Object.entries(m.tokens))if(now()-t.at>7*86400000)delete m.tokens[k];if(Object.values(m.tokens).filter(t=>!t.done&&now()-t.at<600000).length>=50)throw error('Too many pending rank purchases',429);const token='huntpass1147_'+crypto.randomBytes(32).toString('hex');m.tokens[hash(token)]={ranks,character:p.characters[0].id,at:now(),done:false};ctx.saveState();return ok({purchaseToken:token});});}
 function redeem(p,token){const t=p.mega1147?.huntpass?.tokens?.[hash(token)];if(!t||t.character!==p.characters?.[0]?.id)throw error('Rank purchase belongs to another account or character',403);if(t.done)return{status:204};if(now()-t.at>600000)throw error('Rank purchase expired',410);if(t.premium)return atomic(p,()=>{premium(p);t.done=true;ctx.saveState();return{status:204};});if(rankLevel(track(p).progress)+t.ranks>data.levels)throw error('Not enough Hunt Pass ranks remain');const cost=t.ranks*150;if(balance(p)<cost)throw error('Not enough platinum');return atomic(p,()=>{const inv=ctx.inventoryOf(p,t.character),plat=inv.stackedItems.find(i=>i.catalogId==='CURRENCY_PLATINUM');plat.quantity-=cost;track(p).progress=Math.min(MAX,track(p).progress+t.ranks*data.xp_per_level);settle(p);t.done=true;ctx.saveState();return{status:204};});}
 function inventory(inv,body){if(!body||typeof body!=='object')return body;const changes=[...(body.addStackedItems||[]),...(body.addInstancedItems||[])];const packs=changes.some(i=>data.bundles[i?.catalogId]);const explicitPass=/hunt.?pass|season27/i.test(String(body.source||''));const passSource=explicitPass||/progression.?reward/i.test(String(body.source||''));if(!packs&&!passSource)return body;const b=clone(body),wanted=new Set(),seen=new Set();
  for(const k of ['addStackedItems','addInstancedItems'])b[k]=(b[k]||[]).filter(i=>{const bundle=data.bundles[i?.catalogId];if(bundle){for(const id of bundle)wanted.add(id);return false;}if(passSource&&data.items[i?.catalogId]){if(data.items[i.catalogId].cosmetic!==false){wanted.add(i.catalogId);return false;}if(explicitPass)return false;}return true;});
  for(const id of wanted){if(held(inv,id)||seen.has(id))continue;seen.add(id);if(data.items[id].kind==='instance')b.addInstancedItems.push({catalogId:id,instanceId:crypto.randomUUID(),itemData:null,updateVersion:0});else b.addStackedItems.push({catalogId:id,quantity:1});}
  return b;
 }
 function handle(c){const pathname=c.path.replace(/\/$/,'');
  if(c.service==='auth'&&c.method==='GET'&&pathname==='/entitlementsv2'){const p=ctx.playerFor(c.req);return atomic(p,()=>{if(premium(p))ctx.saveState();return ok({entitlements:p.entitlements},'huntpass1147: Mega premium enabled');});}
  if(c.service==='progression'){
   if(c.method==='GET'&&pathname==='/progression/config'){const base=clone(ctx.loadCapture('Progression/Config.json')||wrapped({paths:[]}));base.payload??={paths:[]};base.payload.paths=(base.payload.paths||[]).filter(p=>p.progression_id!==PASS);base.payload.paths.push(config());return ok(base,'huntpass1147: valid selected season on season27');}
   if(/^\/huntpass\/[^/]+$/.test(pathname)&&['GET','POST'].includes(c.method)){const p=ctx.playerFor(c.req);if(c.method==='POST'){const chosen=typeof c.body==='string'?c.body:c.body?.progression_id??c.body?.payload?.progression_id;if(chosen&&chosen!==PASS)throw error('Only the local Mega Hunt Pass is active',400);}return atomic(p,()=>{const changed=settle(p)||p.huntPass!==PASS;p.huntPass=PASS;if(changed)ctx.saveState();return ok(wrapped(PASS),'huntpass1147: selected pass is a string');});}
   const confirm=/^\/progression\/[^/]+\/season27\/(\d+)\/confirm\/(.+)$/.exec(pathname);if(c.method==='POST'&&confirm){const p=ctx.playerFor(c.req);if(+confirm[1]>rankLevel(track(p).progress))throw error('Cannot confirm an unearned Hunt Pass rank');return atomic(p,()=>{settle(p);ctx.saveState();return ok(wrapped(out(p)));});}
   if(c.method==='GET'&&/^\/progression\/[^/]+(?:\/season27)?$/.test(pathname)&&pathname!=='/progression/config'){const p=ctx.playerFor(c.req);settleSaved(p);if(pathname.endsWith('/season27'))return ok(wrapped(out(p)));}
  }
  if(c.service==='dauntless'&&c.method==='GET'&&/^\/inventory\/[^/]+\/[^/]+$/.test(pathname))settleSaved(ctx.playerFor(c.req));
  if(c.service==='store'){
   if(c.method==='GET'&&pathname==='/product/skus/public'){const required=c.url.searchParams.getAll('requiredTags').flatMap(v=>{try{const a=JSON.parse(v);if(Array.isArray(a))return a.map(String);}catch{}return v.split(/[,;|]/);}).map(s=>s.trim().toLowerCase());if(required.includes(PASS+'_pass')){const p=signed(c.req);return ok([premiumOffer(p)].filter(o=>required.every(t=>o.tags.includes(t))));}if(required.includes('hp_level_skip_rank')){const p=signed(c.req);return ok(Array.from({length:100},(_,i)=>offer(p,i+1)).filter(o=>required.every(t=>o.tags.includes(t))),'huntpass1147: native rank skips');}}
   const single=/^\/product\/sku\/(.+)$/.exec(pathname);if(c.method==='GET'&&single&&single[1]===PREMIUM)return ok(premiumOffer(signed(c.req)));if(c.method==='GET'&&single&&skuRank(single[1]))return ok(offer(signed(c.req),skuRank(single[1])));
   const token=/^\/token\/([^/]+)\/(.+)$/.exec(pathname);if(c.method==='GET'&&token&&token[2]===PREMIUM){if(!isPlatinum(token[1]))throw error('Invalid premium purchase currency',400);const p=signed(c.req);if(!p.characters?.[0]?.id)throw error('Saved character required');return atomic(p,()=>{const m=meta(p);for(const[k,t]of Object.entries(m.tokens))if(now()-t.at>7*86400000)delete m.tokens[k];if(Object.values(m.tokens).filter(t=>!t.done&&now()-t.at<600000).length>=50)throw error('Too many pending pass purchases',429);const token='huntpass1147_'+crypto.randomBytes(32).toString('hex');m.tokens[hash(token)]={premium:true,character:p.characters[0].id,at:now(),done:false};ctx.saveState();return ok({purchaseToken:token});});}if(c.method==='GET'&&token&&skuRank(token[2])){if(!isPlatinum(token[1]))throw error('Rank skips require platinum',400);return issue(signed(c.req),skuRank(token[2]));}
   if(c.method==='POST'&&pathname.startsWith('/notification/')){const t=[c.url.searchParams.get('token'),c.url.searchParams.get('purchaseToken'),c.body?.token,c.body?.purchaseToken].find(t=>typeof t==='string'&&t.startsWith('huntpass1147_'));if(t){if(!isPlatinum(pathname.slice('/notification/'.length)))throw error('Rank purchase currency mismatch',400);return redeem(signed(c.req),t);}}
  }
  return next(c);
 }
 return{handle,atomic,settle,assertDelta,inventory,progressBody};
}
module.exports={create,progressBody,pathConfig,expanded,level,data,PASS,MAX};
