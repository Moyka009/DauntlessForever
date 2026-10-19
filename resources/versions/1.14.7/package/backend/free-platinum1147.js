// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function platinum(id){return typeof id==='string'&&/^(?:platinum|(?:id_)?currency_platinum)(?:_[a-z0-9_]+)?$/i.test(id);}
function zero(value,inherited=false){
 if(Array.isArray(value))return value.map(x=>zero(x,inherited));
 if(!value||typeof value!=='object')return value;
 const out={},currency=value.currencyId??value.currency_id??value.currency;
 const free=currency===undefined?inherited:platinum(currency);
 for(const [k,v]of Object.entries(value)){
  if(free&&/^(?:price|salesPrice|salePrice|originalPrice|basePrice|sales_price|sale_price|original_price|base_price)$/i.test(k)&&(typeof v==='number'||typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v)))out[k]=0;
  else out[k]=zero(v,free);
 }
 return out;
}
const on=()=>process.env.DF_FREE_PLATINUM==='1'; // DF-FREE-PLATINUM: Game Rules "Free platinum"
function reply(response){if(!on())return response;return {...response,json:zero(response.json)};}
function inventory(body){
 if(!on())return body;
 if(!body||typeof body!=='object'||!Array.isArray(body.removeStackedItems))return body;
 const removals=body.removeStackedItems.filter(x=>!platinum(x?.catalogId));
 return removals.length===body.removeStackedItems.length?body:{...body,removeStackedItems:clone(removals)};
}
module.exports={platinum,zero,reply,inventory,on};
