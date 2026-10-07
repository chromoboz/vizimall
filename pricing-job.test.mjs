import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPricingJob} from './backend-pricing-job.mjs';
const variant={id:'gid://shopify/ProductVariant/1',sku:'CJTEST1',product:{id:'gid://shopify/Product/1',tags:['country-germany','store-home'],status:'DRAFT'}};
function fixture({available=true,pagination=false}={}){
 const values=new Map(), mutations=[];
 const quote={status:available?'available':'unavailable',sku:'CJTEST1',quantity:1,destination:'DE',checkedAt:new Date().toISOString(),expiresAt:Date.now()+60000,methods:[{name:'Standard',transport:'5-7',supplierCost:{amount:'6.60',currencyCode:'USD'}}]};
 const db={get:async key=>key.includes('supplier-probe/')?quote:values.get(key),getWithMetadata:async key=>values.has(key)?{data:values.get(key),etag:'1'}:null,setJSON:async(key,value)=>{values.set(key,value);return {modified:true}}};
 let price='21.90';
 const admin=async(query,variables)=>{if(query.includes('productVariants(first:'))return{shop:{currencyCode:'EUR'},productVariants:{nodes:[variant],pageInfo:{hasNextPage:pagination}}};if(query.startsWith('query'))return{shop:{currencyCode:'EUR'},node:{...variant,price}};mutations.push(variables);price=variables.variants[0].price;return{productVariantsBulkUpdate:{productVariants:[{id:variant.id,price}],userErrors:[]}};};
 const args={production:true,storefrontConfig:{domain:'test.myshopify.com'},env:{CJ_API_KEY:'test-only'},dbFactory:async()=>db,adminFactory:()=>admin,fetcher:async()=>new Response(`<Cube time="${new Date().toISOString().slice(0,10)}"><Cube currency="USD" rate="1.1204"/></Cube>`)};
 return{values,mutations,args};
}
test('Scheduled preview verifies included price without modifying Shopify or publishing drafts',async()=>{
 const f=fixture();await createPricingJob(f.args)();assert.equal(f.mutations.length,0);const result=f.values.get('shipping/private/pricing-last-run');assert.equal(result.connection,'connected');assert.equal(result.plan.lineTotal.amount,'27.79');assert.equal(result.mode,'preview');assert.equal(result.plan.applied,false);
});
test('Scheduled apply writes only the confirmed included variant price and does not compound freight',async()=>{
 const f=fixture();const run=createPricingJob({...f.args,apply:true,prioritySku:variant.sku});await run();await run();assert.equal(f.mutations.length,1);assert.deepEqual(f.mutations[0],{productId:variant.product.id,variants:[{id:variant.id,price:'27.79'}]});assert.equal(f.values.get('shipping/private/pricing-last-run').plan.lineTotal.amount,'27.79');
});
test('Unavailable freight fails closed and advances the cursor so another item can be checked',async()=>{
 const f=fixture({available:false});await assert.rejects(createPricingJob(f.args)());assert.equal(f.mutations.length,0);assert.equal(f.values.get('shipping/private/pricing-last-run').status,'failed');assert.ok(f.values.has('shipping/private/pricing-cursor'));
});
test('Preview deploys perform no authentication; an incomplete catalog cannot write prices',async()=>{
 await createPricingJob({production:false,dbFactory:()=>{throw Error('must not access')}})();
 const f=fixture({pagination:true});await assert.rejects(createPricingJob({...f.args,apply:true})());assert.equal(f.mutations.length,0);
});
test('Pagination advances beyond a page with no matching supplier variants',async()=>{
 const f=fixture(),seen=[];
 const admin=async(query,variables)=>{seen.push(variables.after);return{shop:{currencyCode:'EUR'},productVariants:{nodes:[],pageInfo:{hasNextPage:!variables.after,endCursor:variables.after?null:'next-page'}}};};
 const job=createPricingJob({...f.args,adminFactory:()=>admin});await job();await job();
 assert.deepEqual(seen,[null,'next-page']);assert.equal(f.values.get('shipping/private/pricing-cursor').after,null);
});
