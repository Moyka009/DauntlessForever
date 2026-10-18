// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('fs'),path=require('path');
const clone=x=>JSON.parse(JSON.stringify(x));
const PASS='season27';
function create(root){
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 const index=read(path.join(root,'seasons/index.json'));
 const choice=path.join(root,'data/season.txt');
 const key=fs.existsSync(choice)?fs.readFileSync(choice,'utf8').replace(/^\uFEFF/,'').trim():index.default;
 const entry=index.seasons.find(s=>s.key===key);
 if(!entry||!/^[-\w]+\.json$/.test(entry.file))throw Error('Unknown 1.14.7 season selection: '+key);
 const data=read(path.join(root,'seasons',entry.file));
 if(data.pass_id!==PASS||!Number.isSafeInteger(data.levels)||data.levels<1||data.levels>400||data.xp_per_level!==100||!data.revision||!data.items||!data.rewards||!data.bundles)throw Error('Invalid 1.14.7 season data');
 const keys=new Set(index.seasons.map(s=>s.key)),changed=new WeakSet();
 const dirty=p=>changed.has(p),setDirty=(p,yes)=>yes?changed.add(p):changed.delete(p);
 function snapshot(p){return{track:clone(p.progress?.tracks?.[PASS]||{progress:0}),meta:clone(p.mega1147?.huntpass||{revision:'mega1147-400-v1',paid_rank:0,tokens:{}})};}
 function prepare(p){
  p.mega1147??={};p.progress??={tracks:{},objectives:{}};p.progress.tracks??={};
  let bank=p.mega1147.huntpassSeasons;
  if(!bank){bank=p.mega1147.huntpassSeasons={active:'mega',passes:{mega:snapshot(p)}};changed.add(p);}
  if(!bank.passes||!keys.has(bank.active))throw Error('Invalid saved season bank');
  if(bank.disk_view==='mega'||bank.active!==key){
   if(bank.disk_view==='mega')bank.passes.mega=snapshot(p);
   if(!bank.disk_view)bank.passes[bank.active]=snapshot(p);
   const saved=bank.passes[key]||{track:{progress:0},meta:{revision:data.revision,paid_rank:0,tokens:{}}};
   p.progress.tracks[PASS]=clone(saved.track);p.mega1147.huntpass=clone(saved.meta);
   bank.active=key;delete bank.disk_view;changed.add(p);
  }
 }
 function mirror(p){
  if(!p)return;const bank=p.mega1147?.huntpassSeasons,passes={};
  if(bank){for(const[k,v]of Object.entries(bank.passes))if(keys.has(k))passes[k]={xp:v.track?.progress||0};
   if(bank.disk_view==='mega')passes.mega={xp:p.progress?.tracks?.[PASS]?.progress||0};
   if(!bank.disk_view&&keys.has(bank.active))passes[bank.active]={xp:p.progress?.tracks?.[PASS]?.progress||0};
  }else passes.mega={xp:p.progress?.tracks?.[PASS]?.progress||0};
  const dir=path.join(root,'data/progression'),file=path.join(dir,'mega1147-seasons.huntpass.json');
  try{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify({passes}));fs.renameSync(file+'.tmp',file);}
  catch(e){console.warn('Season progress display cache could not be updated: '+e.message);}
 }
 function save(state,persist){
  const swap=[];
  for(const p of Object.values(state.players||{})){const b=p.mega1147?.huntpassSeasons;if(b&&!b.disk_view&&!b.passes?.mega)throw Error('Mega Pass progress archive is missing');}
  for(const p of Object.values(state.players||{})){
   const bank=p.mega1147?.huntpassSeasons;if(!bank||bank.disk_view)continue;
   bank.passes[bank.active]=snapshot(p);
   const mega=bank.passes.mega;if(!mega)throw Error('Mega Pass progress archive is missing');
   swap.push({p,track:p.progress.tracks[PASS],meta:p.mega1147.huntpass});
   p.progress.tracks[PASS]=clone(mega.track);p.mega1147.huntpass=clone(mega.meta);bank.disk_view='mega';
  }
  let result;
  try{result=persist();}finally{for(const{p,track,meta}of swap){p.progress.tracks[PASS]=track;p.mega1147.huntpass=meta;delete p.mega1147.huntpassSeasons.disk_view;}}
  for(const{p}of swap)changed.delete(p);
  mirror(state.players?.[state.lastPlayer]||Object.values(state.players||{})[0]);
  return result;
 }
 // Startup only selects data. Save data is migrated on the first player request.
 const stateFile=path.join(root,'data/state.json');
 if(fs.existsSync(stateFile)){const state=read(stateFile);mirror(state.players?.[state.lastPlayer]||Object.values(state.players||{})[0]);}
 return{data,key,prepare,save,mirror,dirty,setDirty};
}
module.exports={create};
