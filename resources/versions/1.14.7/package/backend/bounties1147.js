// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const KEYS=['bounties','draft_data','draft_data_daily','draft_data_weekly'];
const draft=()=>({current_draft_choices:[],previous_draft_selections:[],bronze_count:0,silver_count:0,gold_count:0});
const empty=()=>({bounties:[],draft_data:draft(),draft_data_daily:draft(),draft_data_weekly:draft()});
function fail(message,status=400){const e=Error(message);e.status=status;throw e;}
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
function family(b){const id=String(b.bounty_id||'');return /^Bounty_/i.test(id)?'normal':/^Challenge_Daily_/i.test(id)?'daily':/Challenge_Season_|Challenge_Weekly_|-season\d/i.test(id)?'weekly':'id:'+id;}
const slot=b=>family(b)+':'+b.slot_index;
function stamp(b){if(!b?.drafted_timestamp)return null;const n=Date.parse(b.drafted_timestamp);return Number.isFinite(n)?n:null;}
function validate(b){if(!obj(b)||typeof b.bounty_id!=='string'||!b.bounty_id.length||b.bounty_id.length>512)fail('Invalid bounty ID');if(!Number.isSafeInteger(b.slot_index)||b.slot_index<0||b.slot_index>4096)fail('Invalid bounty slot');if(b.update_version!==undefined&&(!Number.isSafeInteger(b.update_version)||b.update_version<0))fail('Invalid bounty version');if(b.claimed!==undefined&&typeof b.claimed!=='boolean')fail('Invalid bounty claim flag');if(b.drafted_timestamp!==undefined&&stamp(b)===null)fail('Invalid bounty draft date');if(!Array.isArray(b.objectives))fail('Invalid bounty objectives');for(const o of b.objectives)if(!obj(o)||typeof o.objective_id!=='string'||!Number.isFinite(o.progress)||o.progress<0)fail('Invalid bounty objective progress');return b;}
function newer(a,b){const x=stamp(a),y=stamp(b);if(x!==null&&y!==null&&x!==y)return x>y;if(a.bounty_id!==b.bounty_id)return true;return (a.update_version||0)>=(b.update_version||0);}
function same(a,b){return a.bounty_id===b.bounty_id&&stamp(a)===stamp(b);}
function mergeProgress(previous,incoming){const result={...previous,...clone(incoming)},goals=new Map((previous.objectives||[]).map(o=>[o.objective_id,clone(o)]));for(const o of incoming.objectives){const old=goals.get(o.objective_id);goals.set(o.objective_id,{...old,...clone(o),progress:Math.max(old?.progress||0,o.progress)});}result.objectives=[...goals.values()];return result;}
function create(ctx){
 const next=ctx.next||(()=>null),wrapped=payload=>({code:null,message:'OK',payload}),ok=(payload,note)=>({status:200,json:wrapped(payload),note:'bounties1147: '+note});
 function owner(c,account){const all=ctx.getPlayers();const matches=all.filter(p=>p.accountId===account);if(matches.length!==1)fail('Saved bounty account not found',404);const token=ctx.bearerOf(c.req);if(token&&ctx.sessions.has(token)&&ctx.playerFor(c.req)!==matches[0])fail('Bounty account does not match signed-in player',403);return matches[0];}
 function atomic(p,fn){const before=clone(p);try{return fn();}catch(e){for(const k of Object.keys(p))delete p[k];Object.assign(p,before);throw e;}}
 function ledger(p){p.mega1147??={};return p.mega1147.bounties??={closed:{}};}
 function close(p,b){const m=ledger(p),old=Object.hasOwn(m.closed,b.bounty_id)?m.closed[b.bounty_id]:null,time=stamp(b);if(!old||time!==null&&(old.drafted===null||time>old.drafted))Object.defineProperty(m.closed,b.bounty_id,{value:{drafted:time},enumerable:true,writable:true,configurable:true});}
 function blocked(p,b){const entries=p.mega1147?.bounties?.closed;const closed=entries&&Object.hasOwn(entries,b.bounty_id)?entries[b.bounty_id]:null;return !!closed&&(stamp(b)===null||closed.drafted===null||stamp(b)<=closed.drafted);}
 function state(p){const result={...empty(),...clone(p.bounties||{})},list=[];if(!Array.isArray(result.bounties))fail('Saved bounty list is malformed',409);for(const b of result.bounties){validate(b);if(b.claimed){close(p,b);continue;}if(blocked(p,b))continue;const i=list.findIndex(x=>slot(x)===slot(b));if(i<0)list.push(b);else if(newer(b,list[i]))list[i]=b;}result.bounties=list;return result;}
 function apply(p,body){const src=obj(body)?(KEYS.some(k=>Object.hasOwn(body,k))?body:obj(body.payload)?body.payload:{}):{};
  if(src.bounties!==undefined&&!Array.isArray(src.bounties))fail('Invalid bounty update list');const posted=src.bounties||[];posted.forEach(validate);
  for(const k of KEYS.slice(1))if(src[k]!==undefined&&!obj(src[k]))fail('Invalid bounty draft data');
  const cur=state(p),echo=[];
  for(const b of posted){if(blocked(p,b))continue;const i=cur.bounties.findIndex(x=>slot(x)===slot(b)),previous=i<0?null:cur.bounties[i];
   if(previous&&!newer(b,previous))continue;
   if(b.claimed){close(p,b);if(previous&&previous.bounty_id===b.bounty_id)cur.bounties.splice(i,1);echo.push(clone(b));}
   else if(previous&&same(previous,b))cur.bounties[i]=mergeProgress(previous,b);
   else if(i<0)cur.bounties.push(clone(b));else {close(p,previous);cur.bounties[i]=clone(b);}
  }
  for(const k of KEYS.slice(1))if(src[k]!==undefined)cur[k]=clone(src[k]);
  p.bounties=cur;return echo.length?{...clone(cur),bounties:[...clone(cur.bounties),...echo]}:clone(cur);
 }
 function idsFrom(body){const ids=new Set();function add(o){if(typeof o==='string'){ids.add(o);return;}if(Array.isArray(o)){o.forEach(add);return;}if(!obj(o))return;if(typeof o.bounty_id==='string')ids.add(o.bounty_id);for(const k of ['bounty_ids','bountyIds','ids','bounties'])if(Array.isArray(o[k]))o[k].forEach(add);if(obj(o.payload)||Array.isArray(o.payload))add(o.payload);}add(body);return ids;}
 function handle(c){const pathname=c.path.replace(/\/$/,'');
  if(c.service!=='progression')return next(c);
  if(c.method==='GET'&&['/game_tuning/bounty_game_data','/bounty/game-data'].includes(pathname)){const data=ctx.loadCapture('Progression/Game Tuning/Bounty/GetData.md');if(!data?.payload)fail('Bounty tuning capture is missing',503);const result=clone(data);result.payload.delete_claimed_bounties=true;return{status:200,json:result,note:'bounties1147: native immediate claim removal enabled'};}
  const remove=/^\/bounty\/delete\/([^/]+)$/.exec(pathname),route=/^\/bounty\/([^/]+)$/.exec(pathname);if(!remove&&!route)return next(c);
  if(remove&&c.method!=='POST'||route&&!['GET','POST','PUT'].includes(c.method))return next(c);
  const account=decodeURIComponent((remove||route)[1]),p=owner(c,account);
  return atomic(p,()=>{const before=JSON.stringify([p.bounties,p.mega1147?.bounties]);let result;
   if(remove){const ids=idsFrom(c.body),cur=state(p);cur.bounties=cur.bounties.filter(b=>{if(!ids.has(b.bounty_id))return true;close(p,b);return false;});p.bounties=cur;result=clone(cur);}
   else if(c.method==='GET'){result=state(p);if(p.bounties||result.bounties.length)p.bounties=result;}
   else result=apply(p,c.body);
   if(before!==JSON.stringify([p.bounties,p.mega1147?.bounties]))ctx.saveState();
   return ok(result,remove?'deleted requested IDs':c.method==='GET'?'loaded persistent slots':'merged changed slots; other slots retained');
  });
 }
 return{handle,apply,idsFrom};
}
module.exports={create,family,slot,validate,mergeProgress};
