// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
function fail(status,message){const e=Error(message);e.status=status;throw e;}
function create(ctx){
 function handle(c){
  if(c.service!=='dauntless'||c.method!=='POST'||c.path.replace(/\/$/,'')!=='/inventory/instanceditem')return ctx.next(c);
  const b=c.body;if(!object(b))fail(400,'Expected an equipment update');
  for(const k of ['accountId','characterId','instanceId','catalogId'])if(typeof b[k]!=='string'||!b[k].length||b[k].length>512)fail(400,'Missing or invalid '+k);
  if(!Number.isSafeInteger(b.updateVersion)||b.updateVersion<0)fail(400,'Invalid equipment updateVersion');
  if(typeof b.itemData!=='string')fail(400,'Equipment itemData must be a JSON string');
  let data;try{data=JSON.parse(b.itemData);}catch{fail(400,'Equipment itemData is not JSON');}if(!object(data))fail(400,'Equipment itemData must contain an object');
  const matches=ctx.getPlayers().filter(p=>p.accountId===b.accountId);if(matches.length!==1)fail(404,'Equipment account not found');const p=matches[0];
  const token=ctx.bearerOf(c.req);if(token&&ctx.sessions.has(token)&&ctx.playerFor(c.req)!==p)fail(403,'Equipment account does not match signed-in player');
  if(!p.characters?.some(x=>x.id===b.characterId))fail(403,'Equipment character belongs to another account');
  const inv=p.inventory?.[b.characterId];const item=inv?.instancedItems?.find(x=>x.instanceId===b.instanceId);
  if(!item)fail(404,'Equipment instance not found');if(item.catalogId!==b.catalogId)fail(409,'Equipment catalogId cannot change');
  const current=Number.isSafeInteger(item.updateVersion)?item.updateVersion:0;
  if(b.updateVersion<current||b.updateVersion===current&&b.itemData!==item.itemData)fail(409,'Stale equipment update');
  if(b.updateVersion===current)return{status:200,json:clone(item),note:'equipment1147: identical saved item replay'};
  const before=clone(item);item.itemData=b.itemData;item.updateVersion=b.updateVersion;
  try{ctx.saveState();}catch(e){for(const k of Object.keys(item))delete item[k];Object.assign(item,before);throw e;}
  return{status:200,json:clone(item),note:'equipment1147: saved native instanced item update'};
 }
 return{handle};
}
module.exports={create};
