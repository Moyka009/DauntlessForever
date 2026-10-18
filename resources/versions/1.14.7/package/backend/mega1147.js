// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const crypto = require('crypto');
const DAILY = 'bundle_reward_login_daily';
const PACK = 'feature_25_chips_keys_premium';
const clone = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const dailyItems = [
  {catalogId:'TOKEN_DAILY_PATROL_BONUS_PURCHASED',quantity:2},
  {catalogId:'TOKEN_BOUNTY_DRAFT',quantity:4},
];
const packItems = [
  {catalogId:'CURRENCY_TOKEN_EXCHANGE_SPEED_UP',quantity:25},
  {catalogId:'TOKEN_DAILY_PATROL_BONUS_PURCHASED',quantity:25},
  {catalogId:'TOKEN_BOUNTY_DRAFT_PREMIUM',quantity:25},
];
function tags(value) {
  if (Array.isArray(value)) return value.flatMap(tags);
  if (typeof value !== 'string') return [];
  try { const a=JSON.parse(value); if(Array.isArray(a))return a.flatMap(tags); } catch {}
  return value.split(/[,;|]/).map(x=>x.trim().replace(/^[\[\]"']+|[\[\]"']+$/g,'').toLowerCase()).filter(Boolean);
}
function create(ctx, options={}) {
  const now=options.now||Date.now;
  const day=()=>new Date(now()).toISOString().slice(0,10);
  const giftTags=['fountain_daily_free_bundle','webstore','supplies_supplies'];
  const packTags=['webstore','your_offers','supplies_supplies'];
  const ok=json=>({status:200,json});
  const fail=(status,note)=>({status,note});
  function atomic(p,fn) {
    const before=clone(p);
    try { const result=fn(); ctx.saveState(); return result; }
    catch(e) { for(const k of Object.keys(p))delete p[k]; Object.assign(p,before); throw e; }
  }
  function meta(p) {
    if(!p.mega1147)p.mega1147={};
    if(!p.mega1147.store)p.mega1147.store={tokens:{},claims:{}};
    return p.mega1147.store;
  }
  const character=p=>(p.characters||[]).find(ch=>ch&&typeof ch.id==='string');
  const claimed=p=>p?.mega1147?.store?.claims?.[DAILY]===day();
  function offer(p,sku=DAILY) {
    const daily=sku===DAILY;
    return {id:sku,displayName:daily?'Daily Ramsgate Gift':'Ace Chips, Patrol Keys & Premium Bounty Tokens',
      displayDescription:daily?'2 Patrol Keys and 4 Bounty Tokens. Resets daily at 00:00 UTC.':'Free repeatable pack: 25 Ace Chips, 25 Patrol Keys and 25 Premium Bounty Tokens.',
      displayPriority:daily?10:20,tags:daily?giftTags:packTags,
      prices:[{currencyId:'id_currency_platinum',price:0,salesPrice:0}],
      items:clone(daily?dailyItems:packItems),entitlements:[],skuProgression:[],images:[],maxAllowed:1,
      remaining:p&&character(p)&&(!daily||!claimed(p))?1:0,loadoutSlots:null,availableFrom:null,availableTo:null,
      timeAvailabilityReason:null,platformOfferId:null,missingEntitlementNames:null};
  }
  function player(req) {
    const token=ctx.bearerOf(req);
    return token&&ctx.sessions.has(token)?ctx.playerFor(req):null;
  }
  // Route flow follows 1.6.2; offer prices follow the verified 1.14.7 serializer.
  // These routes are local and do not depend on separately downloaded captures.
  function balances(p) {
    const captured=ctx.loadCapture('Store/Balance.md');
    const result={};
    if(captured&&typeof captured==='object'&&!Array.isArray(captured)) {
      for(const key of Object.keys(captured))if(/^id_currency_|^CURRENCY_/.test(key))result[key]=0;
    }
    const ids=['CURRENCY_PLATINUM','CURRENCY_NOTES','CURRENCY_CELLDUST','CURRENCY_MARKS_STEEL',
      'CURRENCY_MARKS_GILDED','CURRENCY_PRESTIGE','CURRENCY_EVENT_01','CURRENCY_TOKEN_EXCHANGE_SPEED_UP',
      'CURRENCY_PJM_WEAPON','CURRENCY_PJM_AIRSHIP','CURRENCY_PJM_PRESTIGE_EMPTY','CURRENCY_PJM_PRESTIGE_FILLED'];
    const quantities=new Map();
    for(const item of p?.inventory?.[character(p)?.id]?.stackedItems||[]) {
      if(typeof item?.catalogId!=='string'||!/^CURRENCY_[A-Z0-9_]+$/.test(item.catalogId))continue;
      if(!Number.isSafeInteger(item.quantity)||item.quantity<0)throw Error('Invalid store currency balance');
      const quantity=(quantities.get(item.catalogId)||0)+item.quantity;
      if(!Number.isSafeInteger(quantity)||quantity>2147483647)throw Error('Store currency balance overflow');
      quantities.set(item.catalogId,quantity);
    }
    for(const id of new Set([...ids,...quantities.keys()])) {
      result[id]=quantities.get(id)||0;
      result['id_'+id.toLowerCase()]=result[id];
    }
    return result;
  }
  function issue(p,sku=DAILY) {
    if(!character(p)||(sku===DAILY&&claimed(p)))return fail(409,'Gift unavailable');
    return atomic(p,()=>{
      const m=meta(p);
      for(const [key,t]of Object.entries(m.tokens))if(now()-t.at>3600000)delete m.tokens[key];
      if(Object.keys(m.tokens).length>=100)return fail(429,'Too many outstanding store tokens');
      const token='mega1147_'+crypto.randomBytes(32).toString('hex');
      m.tokens[hash(token)]={sku,characterId:character(p).id,day:day(),at:now(),done:false};
      return ok({purchaseToken:token});
    });
  }
  function complete(p,token) {
    const record=p.mega1147?.store?.tokens?.[hash(token)];
    if(!record)return fail(403,'Purchase token does not belong to this account');
    if(![DAILY,PACK].includes(record.sku))return fail(409,'Unrecognized purchase SKU');
    if(record.done)return {status:204};
    if(now()-record.at>600000||(record.sku===DAILY&&record.day!==day()))return fail(410,'Purchase token expired');
    if(record.sku===DAILY&&claimed(p))return fail(409,'Daily gift already claimed');
    if(character(p)?.id!==record.characterId)return fail(409,'Purchase character changed');
    return atomic(p,()=>{
      const inv=ctx.inventoryOf(p,record.characterId);
      if(!Array.isArray(inv.stackedItems))throw Error('Malformed stacked inventory');
      for(const item of record.sku===DAILY?dailyItems:packItems) {
        const held=inv.stackedItems.filter(x=>x.catalogId===item.catalogId);
        if(held.length>1)throw Error('Duplicate reward stacks need repair');
        const old=held[0]?.quantity??0;
        if(!Number.isSafeInteger(old)||old<0||old+item.quantity>2147483647)throw Error('Invalid reward quantity');
        if(held[0])held[0].quantity+=item.quantity;else inv.stackedItems.push(clone(item));
      }
      if(record.sku===DAILY)meta(p).claims[DAILY]=day();record.done=true;
      return {status:204};
    });
  }
  function handle(c) {
    if(c.service!=='store')return null;
    const pathname=c.path.replace(/\/$/,'');
    const p=player(c.req);
    if(c.method==='GET'&&pathname==='/balance') {
      if(!p)return fail(403,'A signed-in player session is required');
      return ok(balances(p));
    }
    if(c.method==='POST'&&pathname==='/reconcile') {
      if(!p)return fail(403,'A signed-in player session is required');
      return ok({balances:balances(p),refreshInventory:true});
    }
    if(c.method==='GET'&&pathname==='/product/skus/public') {
      const required=c.url.searchParams.getAll('requiredTags').flatMap(tags);
      const captured=required.length===1&&/^[A-Za-z0-9_]+$/.test(required[0])?
        ctx.loadCapture('Store/Product/Skus/'+required[0]+'.json'):null;
      const original=Array.isArray(captured)?clone(captured):[];
      const added=[DAILY,PACK].filter(sku=>required.every(t=>(sku===DAILY?giftTags:packTags).includes(t))).map(sku=>offer(p,sku));
      return {...ok([...original.filter(x=>![DAILY,PACK].includes(x?.id)),...added]),note:'mega1147-fix2 store: '+added.map(x=>x.id+' remaining='+x.remaining).join(',')};
    }
    if(c.method==='GET'&&[DAILY,PACK].some(sku=>pathname==='/product/sku/'+sku))return ok(offer(p,pathname.slice('/product/sku/'.length)));
    const m=/^\/token\/([^/]+)\/([^/]+)$/.exec(pathname);
    if(c.method==='GET'&&m&&[DAILY,PACK].includes(m[2])) {
      if(!p)return fail(403,'A signed-in player session is required');
      if(m[1].toLowerCase()!=='platinum')return fail(400,'Unsupported purchase currency');
      return issue(p,m[2]);
    }
    if(c.method==='POST'&&/^\/notification\/[^/]+$/.test(pathname)) {
      const token=[c.url.searchParams.get('token'),c.url.searchParams.get('purchaseToken'),c.body?.token,c.body?.purchaseToken].find(x=>typeof x==='string'&&x.startsWith('mega1147_'));
      if(!token)return null;
      if(!p)return fail(403,'A signed-in player session is required');
      if(pathname.split('/')[2].toLowerCase()!=='platinum')return fail(400,'Unsupported purchase currency');
      return complete(p,token);
    }
    return null;
  }
  return {handle};
}
module.exports={create,DAILY,PACK,dailyItems,packItems,tags};
