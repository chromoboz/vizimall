import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createShippingHandler} from './backend-shipping.mjs';
function database(){const values=new Map();return {get:async k=>values.get(k),getWithMetadata:async k=>values.has(k)?{data:values.get(k),etag:'1'}:null,setJSON:async(k,v)=>{values.set(k,v);return{modified:true}}};}
const settings={domain:'example.myshopify.com',apiVersion:'2026-10',publicToken:'public'};
const base='https://vizimall.com/api/shipping?variant=gid://shopify/ProductVariant/1&country=DE&shipping=GR&store=tech';
const variant={id:'gid://shopify/ProductVariant/1',sku:'CJTEST-1',availableForSale:true,product:{tags:['country-germany','country-greece','store-tech']}};
function fixture(overrides={}){
 const calls=[];const db=database();const fetcher=async(url,options)=>{calls.push({url,body:options.body&&JSON.parse(options.body),headers:options.headers});let data;
 if(url.includes('myshopify.com'))return Response.json({data:{node:overrides.variant||variant}});
 if(url.includes('getAccessToken'))data={accessToken:'secret-token',accessTokenExpiryDate:'2099-01-01'};
 else if(url.includes('variant/query'))data=[{vid:'cj-variant',variantSku:'CJTEST-1'}];
 else if(url.includes('stock/query'))data=overrides.stock||[{countryCode:'DE',totalInventoryNum:10},{countryCode:'CN',totalInventoryNum:100}];
 else if(url.includes('freightCalculate'))data=overrides.methods||[{logisticName:'CJPacket',logisticPrice:8.07,logisticAging:'3-5'}];
 return Response.json({result:true,code:200,data});};
 return {calls,handler:createShippingHandler({dbFactory:async()=>db,fetcher,env:{CJ_API_KEY:'test-secret'},storefrontConfig:settings})};
}
test('Absent CJ configuration performs no supplier requests',async()=>{const handler=createShippingHandler({env:{},fetcher:()=>{throw Error('must not call')}});assert.equal((await (await handler(new Request(base))).json()).status,'not_connected');});
test('Connection check validates supplier authentication without disclosing credentials',async()=>{
 const {handler,calls}=fixture();const response=await handler(new Request('https://vizimall.com/api/shipping?check=connection'),{ip:'test'});
 assert.deepEqual(await response.json(),{status:'connected'});
 assert.equal(calls.filter(c=>c.url.includes('getAccessToken')).length,1);
 await handler(new Request('https://vizimall.com/api/shipping?check=connection'),{ip:'test'});
 assert.equal(calls.filter(c=>c.url.includes('getAccessToken')).length,1);
});
test('Quotes missing a price or numeric transit estimate do not qualify',async()=>{
 const {handler}=fixture({methods:[{logisticName:'Unknown time',logisticPrice:8.07},{logisticName:'Unknown cost',logisticAging:'3-5'},{logisticName:'Placeholder',logisticPrice:0,logisticAging:'N/A'}]});
 const result=await (await handler(new Request(base),{ip:'test'})).json();
 assert.equal(result.status,'unavailable');assert.deepEqual(result.methods,[]);
});
test('Live quotes use exact Shopify SKU, stocked European origin, variant and quantity; cache excludes credentials',async()=>{
 const {handler,calls}=fixture();const result=await (await handler(new Request(base+'&quantity=2'),{ip:'test'})).json();
 assert.equal(result.from,'DE');assert.deepEqual(result.origins,['DE']);assert.equal(result.methods[0].supplierCost.currencyCode,'USD');
 const freight=calls.find(c=>c.url.includes('freightCalculate'));assert.equal(freight.body.products[0].quantity,2);assert.equal(freight.body.products[0].vid,'cj-variant');assert.equal(freight.body.endCountryCode,'GR');
 assert.ok(!JSON.stringify(result).includes('secret'));await handler(new Request(base+'&quantity=2'),{ip:'test'});assert.equal(calls.filter(c=>c.url.includes('freightCalculate')).length,1);
});
test('Unsupported destination, ineligible product, unavailable origin and insufficient stock stop freight requests',async()=>{
 for(const [url,overrides,status] of [[base.replace('shipping=GR','shipping=US'),{},null],[base,{variant:{...variant,product:{tags:['country-germany','store-tech']}}},'unavailable'],[base+'&from=NL',{},'unavailable'],[base+'&quantity=20',{},'unavailable']]){
 const f=fixture(overrides);const response=await f.handler(new Request(url),{ip:'test'});if(status)assert.equal((await response.json()).status,status);else assert.equal(response.status,400);assert.ok(!f.calls.some(c=>c.url.includes('freightCalculate')));
 }
});
