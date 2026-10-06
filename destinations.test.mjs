import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverDestinations} from './backend-destinations.mjs';
const database=()=>{const values=new Map();return{get:async k=>values.get(k),getWithMetadata:async k=>values.has(k)?{data:values.get(k),etag:'1'}:null,setJSON:async(k,v)=>{values.set(k,v);return{modified:true}}};};
test('Only product/warehouse freight confirmations become selectable destinations',async()=>{
 const db=database(),calls=[];const args={db,key:'sku-DE-quantity1',codes:['DE','US','GR','JP'],probe:async code=>{calls.push(code);return['DE','US'].includes(code);}};
 const result=await discoverDestinations(args);assert.equal(result.status,'complete');assert.deepEqual(result.destinations,['DE','US']);
 await discoverDestinations(args);assert.equal(calls.length,4);
});
test('Transient failures remain pending and retries add a country only after success',async()=>{
 const db=database();let time=100000,failed=true;
 const args={db,key:'sku',codes:['DE','US'],now:()=>time,probe:async code=>{if(code==='US'&&failed)throw Error('supplier temporarily unavailable');return true;}};
 const first=await discoverDestinations(args);assert.equal(first.status,'discovering');assert.deepEqual(first.destinations,['DE']);assert.equal(first.checked,1);
 time+=31000;failed=false;const next=await discoverDestinations(args);assert.equal(next.status,'complete');assert.deepEqual(next.destinations,['DE','US']);
});
test('Expired availability is discarded and a changed quantity or variant uses a separate index',async()=>{
 const db=database();let time=100000,available=true;
 const args={db,key:'sku-1',codes:['DE','US'],now:()=>time,probe:async()=>available};
 assert.equal((await discoverDestinations(args)).destinations.length,2);
 available=false;assert.deepEqual((await discoverDestinations({...args,key:'sku-2'})).destinations,[]);
 time+=900001;assert.deepEqual((await discoverDestinations(args)).destinations,[]);
});
test('Parallel visitors share a lease instead of multiplying CJ scans',async()=>{
 const db=database();let release;const wait=new Promise(resolve=>release=resolve),calls=[];
 const args={db,key:'sku',codes:['DE'],probe:async code=>{calls.push(code);await wait;return true;}};
 const first=discoverDestinations(args);await new Promise(resolve=>setImmediate(resolve));
 const second=await discoverDestinations(args);assert.equal(second.status,'discovering');assert.deepEqual(second.destinations,[]);release();assert.deepEqual((await first).destinations,['DE']);assert.equal(calls.length,1);
});
