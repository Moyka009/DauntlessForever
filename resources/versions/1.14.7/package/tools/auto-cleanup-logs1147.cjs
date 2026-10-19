// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('fs'),path=require('path'),net=require('net');
function packageRoot(root){root=fs.realpathSync(root);if(!fs.existsSync(path.join(root,'config.json'))||!fs.existsSync(path.join(root,'backend/recorder-1147.js')))throw Error('Cleanup requires an active 1.14.7 package folder');return root;}
function clean(root,{keep=5,ageHours=24,now=Date.now(),dryRun=false}={}){
 if(!Number.isInteger(keep)||keep<1||!Number.isFinite(ageHours)||ageHours<1||!Number.isFinite(now))throw Error('Invalid retention settings');root=packageRoot(root);
 const groups=new Map(),removed=[],skipped=[];
 for(const dir of ['logs','upload']){
  const folder=path.join(root,dir);if(!fs.existsSync(folder))continue;if(fs.lstatSync(folder).isSymbolicLink()||!fs.lstatSync(folder).isDirectory())throw Error('Refusing linked or invalid log folder');
  for(const name of fs.readdirSync(folder)){
   const file=path.join(folder,name);let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(stat.isSymbolicLink())continue;
   let group;
   if(dir==='logs'&&(stat.isDirectory()||stat.isFile()&&/\.(log|txt|jsonl)$/i.test(name))&&/^server_run[_-][A-Za-z0-9]/i.test(name))group='server runs';
   else if(dir==='logs'&&(stat.isDirectory()||stat.isFile()&&/\.(log|txt|jsonl)$/i.test(name))&&/^run[_-][A-Za-z0-9]/i.test(name))group='client runs';
   else if(dir==='logs'&&stat.isFile()&&/^server_[0-9]+(?:_engine(?:_err)?)?[_-][0-9]{8}.*\.(log|txt)$/i.test(name))group=name.replace(/[_-][0-9]{8}.*$/,'');
   else if(dir==='upload'&&stat.isFile()&&/^server_logs[_-].+\.zip$/i.test(name))group='server archives';
   else if(dir==='upload'&&stat.isFile()&&/^client_logs[_-].+\.zip$/i.test(name))group='client archives';
   if(group){const key=dir+'/'+group;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({file,time:stat.mtimeMs});}
  }
 }
 function safe(file,depth=0){if(depth>24)return false;let stat;try{stat=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')return false;throw e;}if(stat.isSymbolicLink()||now-stat.mtimeMs<ageHours*3600000)return false;return !stat.isDirectory()||fs.readdirSync(file).every(n=>safe(path.join(file,n),depth+1));}
 for(const entries of groups.values())for(const item of entries.sort((a,b)=>b.time-a.time||a.file.localeCompare(b.file)).slice(keep)){
  if(now-item.time<ageHours*3600000)continue;
  try{if(!safe(item.file))continue;if(!dryRun)fs.rmSync(item.file,{recursive:true});removed.push(path.relative(root,item.file));}catch(e){if(e.code==='ENOENT')continue;skipped.push({file:path.relative(root,item.file),reason:e.code||'unavailable'});}
 }
 return{dry_run:dryRun,removed,skipped,kept_per_group:keep,minimum_age_hours:ageHours,client_engine_preserved:true,current_logs_and_archives_preserved:true};
}
function backendUp(port=63000){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});let done=false;const finish=v=>{if(done)return;done=true;s.destroy();resolve(v);};s.once('connect',()=>finish(true));s.once('error',()=>finish(false));s.setTimeout(800,()=>finish(false));});}
async function automatic(root,options={}){root=packageRoot(root);if(await backendUp(options.port||63000))return{skipped:true,reason:'backend is already running',removed:[]};return clean(root,options);}
async function main(args){try{const root=args.find(a=>!a.startsWith('--'))||path.resolve(__dirname,'..'),auto=args.includes('--auto'),result=auto?await automatic(root):clean(root,{dryRun:args.includes('--preview')});if(auto){if(result.removed.length)console.log('Automatic log cleanup: removed '+result.removed.length+' old log folders/archives; newest five per group and the past 24 hours kept.');if(Array.isArray(result.skipped)&&result.skipped.length)console.log('Automatic log cleanup: '+result.skipped.length+' unavailable entries kept.');}else console.log(JSON.stringify(result,null,2));}catch(e){console.error('Log cleanup skipped: '+e.message);process.exitCode=1;}}
if(require.main===module)main(process.argv.slice(2));
module.exports={clean,automatic,backendUp,main};
