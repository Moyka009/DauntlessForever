// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('fs'),path=require('path');
function check(root){
 let s;try{s=JSON.parse(fs.readFileSync(path.join(root,'data/state.json'),'utf8').replace(/^\uFEFF/,''));}catch{return 'No readable local character save.';}
 const p=s.players?.[s.lastPlayer];if(!p||!Array.isArray(p.characters)||!p.characters.length)return 'No local character has been created.';
 if(p.characters.every(c=>!c||typeof c.data!=='string'||!c.data.trim()||c.data.trim()==='null'))return 'Your local character has not been saved by solo play yet.';
 for(const c of p.characters){if(c.data){try{JSON.parse(c.data);}catch{return 'Local character data is damaged; restore a valid save first.';}}}
 return '';
}
module.exports={check};
if(require.main===module){const reason=check(process.argv[2]);if(reason){console.error(reason);process.exitCode=2;}}
