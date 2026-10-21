// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('fs'),path=require('path');
// DF-PLACE-1147: games send a heartbeat every 20 s; a player silent for 3 minutes has left (closed the game, crashed)
const LEASE_MS=Number(process.env.DF_PLACE_LEASE_MS)||3*60*1000,DEAD_MS=Number(process.env.DF_PLACE_DEAD_MS)||6*60*1000;
function create({root,getState,liveServer,huntServer}){
 const seen=new Map(),retired=new Set(),unknown='@unidentified-live-hunt';
 const touch=key=>{if(key&&key!==unknown){seen.set(key,Date.now());const cd=getState().players?.[key]?.candidate;if(cd?.city===false)retired.delete(cd.id);}};
 const retire=id=>{retired.add(id);if(retired.size>4096)retired.delete(retired.values().next().value);};
 // DF-MULTIHUNT-1147: after a backend restart the places are rebuilt from data\wanted.json and data\server_hunt.json
 const readList=f=>{try{const j=JSON.parse(fs.readFileSync(path.join(root,f),'utf8').replace(/^\uFEFF/,''));return Array.isArray(j.list)?j.list:(j&&j.id?[j]:[]);}catch{return[];}};
 function recover(places){
  if(places.size)return places;
  const wanted=readList('data/wanted.json');
  const live=readList('data/server_hunt.json').map(x=>x&&x.id).filter(id=>id&&!retired.has(id)&&huntServer(id));
  for(const id of new Set([...live,...wanted.map(w=>w&&w.id).filter(Boolean)])){
   const w=wanted.find(x=>x&&x.id===id);
   const rows=Object.entries(getState().players||{}).filter(([,p])=>p.candidate?.city===false&&p.candidate.id===id);
   const candidate=rows[0]?.[1].candidate;
   const url=candidate?.url||w?.url||null;
   const place={id,url,base:url?url.replace(/\?PlayerHuntIds=[^?]*/g,''):null,label:candidate?.label||w?.label||'an existing hunt',owners:new Set(rows.map(([key])=>key)),reuse:!!w?.reuse,asked:w?.at};
   if(!place.owners.size)place.owners.add(unknown);
   for(const key of place.owners)if(!seen.has(key))seen.set(key,Date.now());
   places.set(id,place);
  }
  return places;
 }
 function prune(place){
  if(!place)return;
  // DF-PLACE-1147: an owner whose own match is no longer this place (back in Ramsgate, another hunt, left)
  // is stale; a place whose hunt server never came up (or stopped) for 6 minutes is released.
  const players=getState().players||{};
  if(!place.at)place.at=Date.now();
  const live=huntServer(place.id);
  if(live)place.at=Date.now();
  else if(Date.now()-place.at>DEAD_MS){place.owners.clear();return;}
  for(const key of place.owners){
   if(key!==unknown){const cd=players[key]&&players[key].candidate;if(!cd||cd.city!==false||cd.id!==place.id){place.owners.delete(key);continue;}}
   if(key===unknown){if(!huntServer(place.id))place.owners.delete(key);continue;}
   if(Date.now()-(seen.get(key)||0)>LEASE_MS)place.owners.delete(key);
  }
 }
 return{touch,recover,prune,retire,LEASE_MS};
}
module.exports={create,LEASE_MS};
