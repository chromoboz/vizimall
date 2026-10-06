import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createShippingHandler} from './backend-shipping.mjs';
function database(entries=[]){const values=new Map(entries);return {values,get:async k=>values.get(k),getWithMetadata:async k=>values.has(k)?{data:values.get(k),etag:'1'}:null,setJSON:async(k,v)=>{values.set(k,v);return{modified:true}}};}
const settings={domain:'example.myshopify.com',apiVersion:'2026-10',publicToken:'public'};
const base='https://vizimall.com/api/shipping?variant=gid://shopify/ProductVariant/1&country=DE&shipping=GR&store=tech';
const variant={id:'gid://shopify/ProductVariant/1',sku:'CJTEST-1',availableForSale:true,product:{tags:['country-germany','country-greece','store-tech']}};
function fixture(overrides={}){
 const calls=[];const db=database(overrides.entries);const fetcher=async(url,options={})=>{calls.push({url,body:options.body&&JSON.parse(options.body),headers:options.headers});let data;
 if(url.includes('ecb.europa.eu'))return new Response(`<Cube time="${new Date().toISOString().slice(0,10)}"><Cube currency="USD" rate="1.1204"/></Cube>`);
 if(url.includes('myshopify.com'))return Response.json({data:{node:overrides.variant||variant}});
 if(url.includes('getAccessToken'))data={accessToken:'secret-token',accessTokenExpiryDate:'2099-01-01'};
 else if(url.includes('variant/query')){if(overrides.variantParameterError)return Response.json({result:false,code:1600300,message:'Param error'});data=[{vid:'cj-variant',variantSku:'CJTEST-1'}];}
 else if(url.includes('product/query'))data={variants:overrides.detailVariants||[{vid:'cj-variant',variantSku:'CJTEST-1'}]};
 else if(url.includes('stock/query'))data=overrides.stock||[{countryCode:'DE',totalInventoryNum:10},{countryCode:'CN',totalInventoryNum:100}];
 else if(url.includes('freightCalculate'))data=(typeof overrides.methods==='function'?overrides.methods(JSON.parse(options.body)):overrides.methods)||[{logisticName:'CJPacket',logisticPrice:8.07,logisticAging:'3-5'}];
 return Response.json({result:true,code:200,data});};
 return {calls,db,handler:createShippingHandler({dbFactory:async()=>db,fetcher,env:{CJ_API_KEY:'test-secret'},storefrontConfig:settings,probeSku:'CJTEST-1',pricing:overrides.pricing||false})};
}
test('Absent CJ configuration performs no supplier requests',async()=>{const handler=createShippingHandler({env:{},fetcher:()=>{throw Error('must not call')}});assert.equal((await (await handler(new Request(base))).json()).status,'not_connected');});
test('CJ variant parameter rejection falls back to product details and still requires an exact SKU',async()=>{
 for(const [detailVariants,expected] of [[[{vid:'cj-variant',variantSku:'CJTEST-1'}],'available'],[[{vid:'other',variantSku:'CJOTHER'}],'not_mapped']]){
   const {handler,calls}=fixture({variantParameterError:true,detailVariants});
   const result=await (await handler(new Request(base))).json();assert.equal(result.status,expected);
   assert.ok(calls.some(c=>c.url.includes('product/query?variantSku=CJTEST-1')));
   if(expected==='not_mapped')assert.ok(!calls.some(c=>c.url.includes('freightCalculate')));
 }
});
test('Connection check validates supplier authentication without disclosing credentials',async()=>{
 const {handler,calls}=fixture();const response=await handler(new Request('https://vizimall.com/api/shipping?check=connection'),{ip:'test'});
 assert.deepEqual(await response.json(),{status:'connected'});
 assert.equal(calls.filter(c=>c.url.includes('getAccessToken')).length,1);
 await handler(new Request('https://vizimall.com/api/shipping?check=connection'),{ip:'test'});
 assert.equal(calls.filter(c=>c.url.includes('getAccessToken')).length,1);
});
test('Supplier smoke check exercises live freight without publishing a Shopify draft',async()=>{
 const {handler,calls}=fixture();const result=await (await handler(new Request('https://vizimall.com/.netlify/functions/shipping?check=supplier-sample'),{ip:'test'})).json();
 assert.equal(result.status,'available');assert.equal(result.destination,'DE');assert.equal(result.from,'DE');assert.ok(!calls.some(c=>c.url.includes('myshopify.com')));assert.ok(!JSON.stringify(result).includes('secret'));
 const noStock=fixture({stock:[{countryCode:'CN',totalInventoryNum:100}]});
 assert.equal((await (await noStock.handler(new Request('https://vizimall.com/.netlify/functions/shipping?check=supplier-sample'))).json()).status,'no_verified_eu_stock');
 assert.ok(!noStock.calls.some(c=>c.url.includes('freightCalculate')));
});
test('Supplier diagnostics reject unknown SKUs and destinations before contacting CJ',async()=>{
 for(const query of ['sku=CJUNKNOWN','destination=ZZ']){
   const {handler,calls}=fixture();const response=await handler(new Request('https://vizimall.com/.netlify/functions/shipping?check=supplier-sample&'+query));
   assert.equal(response.status,400);assert.equal(calls.length,0);
 }
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
 for(const [url,overrides,status] of [[base.replace('shipping=GR','shipping=ZZ'),{},null],[base,{variant:{...variant,product:{tags:['country-greece','store-tech']}}},'unavailable'],[base+'&from=NL',{},null],[base+'&quantity=20',{},'unavailable']]){
 const f=fixture(overrides);const response=await f.handler(new Request(url),{ip:'test'});if(status)assert.equal((await response.json()).status,status);else assert.equal(response.status,400);assert.ok(!f.calls.some(c=>c.url.includes('freightCalculate')));
 }
});
test('A Germany-only product quotes worldwide from Germany and never substitutes another country warehouse',async()=>{
 const onlyDE={...variant,product:{tags:['country-germany','store-tech']}};
 const f=fixture({variant:onlyDE});
 const result=await (await f.handler(new Request(base.replace('shipping=GR','shipping=US')))).json();
 assert.equal(result.status,'available');assert.equal(result.destination,'US');assert.equal(result.from,'DE');assert.equal(result.stockQuantity,10);
 const unavailable=fixture({variant:onlyDE,stock:[{countryCode:'GR',totalInventoryNum:100},{countryCode:'CN',totalInventoryNum:100}]});
 assert.equal((await(await unavailable.handler(new Request(base))).json()).status,'unavailable');
 assert.ok(!unavailable.calls.some(c=>c.url.includes('freightCalculate')));
});
test('Included unit prices use the protected base without compounding; unconfirmed international checkout remains blocked',async()=>{
 const f=fixture({pricing:true,variant:{...variant,price:{amount:'27.79',currencyCode:'EUR'}},methods:[{logisticName:'Standard',logisticPrice:'6.60',logisticAging:'3-5'}],entries:[['shipping/private/base-price/1',{baseUnitPrice:{amount:'21.90',currencyCode:'EUR'},lastWritten:{amount:'27.79',currencyCode:'EUR'}}]]});
 const quote=await(await f.handler(new Request(base+'&quantity=2'))).json();
 assert.equal(quote.pricing.unitPrice.amount,'27.79');assert.equal(quote.pricing.lineTotal.amount,'55.58');assert.equal(quote.pricing.checkoutReady,false);
 assert.deepEqual(f.db.values.get('shipping/private/context-queue').items.map(i=>[i.variantId,i.destination]),[['gid://shopify/ProductVariant/1','GR']]);
 assert.ok(!JSON.stringify(quote).includes('secret'));
 await f.handler(new Request(base));assert.equal(f.db.values.get('shipping/private/context-queue').items.length,1);
});
test('Only matching, fresh, exact-SKU destination price confirmations enable checkout',async()=>{
 for(const [record,expected] of [[{sku:'CJTEST-1',profileConfirmed:true,expiresAt:Date.now()+60000,price:{amount:'29.10',currencyCode:'EUR'}},true],[{sku:'CJOTHER',expiresAt:Date.now()+60000,price:{amount:'29.10',currencyCode:'EUR'}},false],[{sku:'CJTEST-1',expiresAt:Date.now()-1,price:{amount:'29.10',currencyCode:'EUR'}},false]]){
  const f=fixture({pricing:true,variant:{...variant,price:{amount:'21.90',currencyCode:'EUR'}},entries:[['shipping/private/context-price/1/GR',record]]});
  const quote=await(await f.handler(new Request(base))).json();assert.equal(quote.pricing.checkoutReady,expected);
 }
});

test('Destination discovery returns only freight-supported countries for the current SKU, warehouse and quantity',async()=>{
 const {handler,calls}=fixture({methods:body=>['DE','US'].includes(body.endCountryCode)?[{logisticName:'DHL',logisticPrice:0,logisticAging:'3-5'}]:[]});
 const result=await(await handler(new Request(base+'&check=destinations'))).json();
 assert.equal(result.status,'discovering');assert.deepEqual(result.destinations,['DE','US']);
 for(const call of calls.filter(c=>c.url.includes('freightCalculate'))){assert.equal(call.body.startCountryCode,'DE');assert.equal(call.body.products[0].vid,'cj-variant');assert.equal(call.body.products[0].quantity,1);}
 assert.ok(!JSON.stringify(result).includes('secret'));
});
