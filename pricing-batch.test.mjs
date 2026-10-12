import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPricingBatch,createPricingDispatch,batchAuthorized} from './backend-pricing-batch.mjs';
const env={VIZIMALL_NATIVE_SHIPPING_ENABLED:'true',SHOPIFY_ADMIN_CLIENT_SECRET:'unit-test-only'};
function fixture(){const values=new Map();return {values,db:{get:async k=>values.get(k),getWithMetadata:async k=>values.has(k)?{data:values.get(k),etag:'1'}:null,setJSON:async(k,v)=>{values.set(k,v);return {modified:true};}}};}
async function signed(db){let request;await createPricingDispatch({production:true,env,dbFactory:async()=>db,fetcher:async(url,options)=>{request=new Request(url,options);return new Response(null,{status:202});}})();return request;}
test('Only fresh signed internal POSTs can run private pricing mutations',async()=>{
 const f=fixture(),request=await signed(f.db);assert.equal(batchAuthorized(request,env.SHOPIFY_ADMIN_CLIENT_SECRET),true);
 assert.equal(batchAuthorized(request,'different'),false);assert.equal(batchAuthorized(request,env.SHOPIFY_ADMIN_CLIENT_SECRET,Date.now()+180000),false);
 let calls=0;const run=createPricingBatch({production:true,env,dbFactory:async()=>f.db,jobFactory:()=>async()=>calls++});
 assert.equal((await run(new Request(request.url,{method:'POST'}))).status,403);assert.equal(calls,0);
});
test('A bounded background run processes countries consecutively and releases its lease',async()=>{
 const f=fixture(),request=await signed(f.db);let calls=0;
 const run=createPricingBatch({production:true,env,maxSteps:8,dbFactory:async()=>f.db,jobFactory:options=>{assert.equal(options.prioritizeImports,true);return async()=>{calls++;f.values.set('shipping/private/context-last-run',{status:'preparing_countries'});};}});
 await run(request);assert.equal(calls,8);assert.equal(f.values.get('shipping/private/pricing-batch-lease').until,0);
});
test('Concurrent dispatch and overlapping batches cannot duplicate a running batch',async()=>{
 const f=fixture(),request=await signed(f.db);f.values.set('shipping/private/pricing-batch-lease',{until:Date.now()+60000,owner:'existing'});
 await createPricingDispatch({production:true,env,dbFactory:async()=>f.db,fetcher:()=>{throw Error('duplicate');}})();
 await createPricingBatch({production:true,env,dbFactory:async()=>f.db,jobFactory:()=>{throw Error('duplicate');}})(request);
 assert.equal(f.values.get('shipping/private/pricing-batch-lease').owner,'existing');
});
test('Failure releases the batch lock and preserves durable country progress for retry',async()=>{
 const f=fixture(),request=await signed(f.db);f.values.set('shipping/private/context-cursor',{index:2,destinationIndex:3});
 await createPricingBatch({production:true,env,dbFactory:async()=>f.db,jobFactory:()=>async()=>{throw Error('CJ temporarily unavailable');}})(request);
 assert.equal(f.values.get('shipping/private/pricing-batch-lease').until,0);assert.deepEqual(f.values.get('shipping/private/context-cursor'),{index:2,destinationIndex:3});
});
