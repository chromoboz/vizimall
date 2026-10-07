import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hash} from './backend-persistence.mjs';
import {createDestinationJob} from './backend-destination-job.mjs';
import {enqueueDestinationDiscovery} from './backend-destinations.mjs';
const job={variantId:'gid://shopify/ProductVariant/1',sku:'CJTEST-1',browsing:'DE',category:'tech',quantity:1};
function fixture(){
 const values=new Map();
 const db={get:async k=>values.get(k),getWithMetadata:async k=>values.has(k)?{data:values.get(k),etag:'1'}:null,setJSON:async(k,v)=>{values.set(k,v);return{modified:true};}};
 const calls=[],settings=[];
 const worker=createDestinationJob({production:true,env:{CJ_API_KEY:'secret'},dbFactory:async()=>db,shippingFactory:config=>{
  settings.push(config);return async req=>{calls.push(new URL(req.url));return Response.json({status:'discovering',destinations:['DE']});};
 }});
 return{db,values,calls,settings,worker};
}
test('Background discovery deduplicates queue entries and respects quantity/SKU separation',async()=>{
 const f=fixture();await enqueueDestinationDiscovery(f.db,job);await enqueueDestinationDiscovery(f.db,job);
 await enqueueDestinationDiscovery(f.db,{...job,quantity:2});await enqueueDestinationDiscovery(f.db,{...job,sku:'CJTEST-2'});
 assert.equal(f.values.get('shipping/private/discovery-queue').items.length,3);
 await f.worker();assert.equal(f.calls.length,1);assert.equal(f.calls[0].searchParams.get('check'),'destinations');
 assert.equal(f.settings[0].discoveryBudgetMs,8000);
});
test('Private known product routes are warmed without a product-page visit',async()=>{
 const f=fixture();f.values.set('shipping/private/context-routes',{items:[job,{...job,destination:'GR'}]});
 await f.worker();assert.equal(f.calls.length,1);assert.equal(f.values.get('shipping/private/discovery-queue').items.length,1);
});
test('Complete fresh lists are not rescanned; next incomplete product progresses',async()=>{
 const f=fixture();await enqueueDestinationDiscovery(f.db,job);await enqueueDestinationDiscovery(f.db,{...job,variantId:'gid://shopify/ProductVariant/2'});
 const key='shipping/private/destinations/'+hash(JSON.stringify([job.variantId,job.sku,job.browsing,1]));
 f.values.set(key,{expiresAt:Date.now()+60000,checked:globalThis.VizimallDestinations.codes,deferred:[]});
 await f.worker();assert.equal(f.calls.length,1);assert.equal(f.calls[0].searchParams.get('variant'),'gid://shopify/ProductVariant/2');
});
test('Preview and overlapping workers do nothing; active pricing gets supplier priority',async()=>{
 let touched=false;await createDestinationJob({production:false,env:{CJ_API_KEY:'secret'},dbFactory:()=>{touched=true;}})();assert.equal(touched,false);
 const f=fixture();await enqueueDestinationDiscovery(f.db,job);
 f.values.set('shipping/private/context-lease',{until:Date.now()+60000});await f.worker();assert.equal(f.calls.length,0);
 f.values.delete('shipping/private/context-lease');f.values.set('shipping/private/discovery-worker',{until:Date.now()+60000});await f.worker();assert.equal(f.calls.length,0);
});
