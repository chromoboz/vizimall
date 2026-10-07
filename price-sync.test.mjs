import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAdminPricingClient,createAdminPricingClientFromEnv,syncVariantPrice} from './backend-price-sync.mjs';
const now=Date.parse('2026-10-06T10:00:00Z');
function fixture(tags=['country-germany','store-home']){
 const values=new Map();const writes=[];
 const db={get:async k=>values.get(k),getWithMetadata:async k=>values.has(k)?{data:values.get(k),etag:'1'}:null,setJSON:async(k,v)=>{values.set(k,v);return{modified:true}}};
 let price='21.90';
 const admin=async(q,v)=>{if(q.startsWith('query'))return{shop:{currencyCode:'EUR'},node:{id:'gid://shopify/ProductVariant/1',sku:'CJTEST1',price,product:{id:'gid://shopify/Product/1',tags,status:'DRAFT'}}};writes.push(v);price=v.variants[0].price;return{productVariantsBulkUpdate:{productVariants:[{id:'gid://shopify/ProductVariant/1',price}],userErrors:[]}}};
 return {db,writes,args:{admin,db,variantId:'gid://shopify/ProductVariant/1',expectedSku:'CJTEST1',quote:{status:'available',sku:'CJTEST1',destination:'DE',quantity:1,checkedAt:'2026-10-06T09:59:00Z',expiresAt:now+60000,methods:[{name:'Standard',transport:'5-7',supplierCost:{amount:'6.60',currencyCode:'USD'}}]},fx:{date:'2026-10-05',rates:{USD:'1.1204'}},now}};
}
test('Price preview writes nothing; an applied confirmed update includes freight exactly once on rerun',async()=>{
 const f=fixture();assert.equal((await syncVariantPrice(f.args)).lineTotal.amount,'27.79');assert.equal(f.writes.length,0);
 assert.equal((await syncVariantPrice({...f.args,apply:true})).applied,true);
 assert.equal((await syncVariantPrice({...f.args,apply:true})).lineTotal.amount,'27.79');assert.equal(f.writes.length,1);
 assert.deepEqual(Object.keys(f.writes[0].variants[0]).sort(),['id','price']);
});
test('Wrong or multiple markets, stale quotes and quantity quotes do not cause global price writes',async()=>{
 for(const tags of [['country-greece'],['country-germany','country-greece'],[]]){const f=fixture(tags);await assert.rejects(syncVariantPrice({...f.args,apply:true}));assert.equal(f.writes.length,0);}
 for(const override of [{expiresAt:now-1},{quantity:2},{status:'unavailable'}]){const f=fixture();await assert.rejects(syncVariantPrice({...f.args,quote:{...f.args.quote,...override},apply:true}));assert.equal(f.writes.length,0);}
});
test('Missing admin credentials and untrusted domains are refused before transmitting a token',()=>{
 for(const args of [{domain:'shop.myshopify.com'}, {domain:'attacker.example',token:'secret'}])assert.throws(()=>createAdminPricingClient({...args,fetcher:()=>{throw Error('must not fetch')}}));
});
test('Official own-store client credentials stay private, cache the token and refresh before expiry',async()=>{
 let instant=now,auth=0;const calls=[];
 const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/access_token')){auth++;return Response.json({access_token:'private-token',expires_in:86400,scope:'read_products,write_products'});}return Response.json({data:{shop:{currencyCode:'EUR'}}});};
 const admin=createAdminPricingClientFromEnv({domain:'example.myshopify.com',env:{SHOPIFY_ADMIN_CLIENT_ID:'id',SHOPIFY_ADMIN_CLIENT_SECRET:'private-client-secret'},fetcher,clock:()=>instant});
 await admin('query{shop{currencyCode}}',{});await admin('query{shop{currencyCode}}',{});assert.equal(auth,1);
 instant+=86400000;assert.deepEqual(await admin('query{shop{currencyCode}}',{}),{shop:{currencyCode:'EUR'}});assert.equal(auth,2);
 assert.ok(calls.filter(c=>c.url.includes('graphql')).every(c=>c.options.headers['X-Shopify-Access-Token']==='private-token'&&!c.options.body.includes('private-client-secret')));
});
