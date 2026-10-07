const {test}=require('node:test');
const assert=require('node:assert/strict');
require('./storefront-api.js');require('./delivery-info.js');
const config={domain:'example.myshopify.com',publicToken:'public',apiVersion:'2026-10'};
const item={id:'gid://shopify/Product/1',tags:['country-germany','country-greece','store-tech'],variants:{nodes:[{id:'gid://shopify/ProductVariant/1',availableForSale:true}],pageInfo:{hasNextPage:false}},images:{nodes:[]}};
const client=reply=>globalThis.VizimallStorefront.createClient(config,async(u,o)=>({ok:true,json:async()=>({data:reply(JSON.parse(o.body))})}));
test('Delivery country does not add products to another supplier storefront',async()=>{
 const german={...item,tags:['country-germany','store-tech']};
 const c=client(({variables})=>{assert.equal(variables.country,'GR');assert.equal(variables.filter,'tag:country-germany AND tag:store-tech');return {products:{nodes:[german,{...item,tags:['country-greece','store-tech']}],pageInfo:{hasNextPage:false}}};});
 assert.deepEqual((await c.products('DE','tech',null,{shippingCountry:'GR'})).products,[german]);
 assert.equal(globalThis.VizimallStorefront.matches(german,'GR','tech'),false);
});
test('Direct detail requires supplier/store tags while accepting worldwide destinations',async()=>{
 const c=client(()=>({product:{...item,tags:['country-germany','store-tech']}}));
 assert.equal((await c.product('DE','tech',item.id,undefined,'US')).id,item.id);
 await assert.rejects(c.product('GR','tech',item.id,undefined,'US'),/no longer available/);
 await assert.rejects(c.product('DE','home',item.id,undefined,'US'),/no longer available/);
 await assert.rejects(c.product('DE','tech',item.id,undefined,'ZZ'),/supported delivery/);
});
test('Checkout prices and buyer identity use destination, retaining browsing eligibility',async()=>{
 const c=client(({query,variables})=>{assert.equal(variables.country,'GR');if(query.includes('query Product'))return {product:item};assert.equal(variables.input.buyerIdentity.countryCode,'GR');return {cartCreate:{cart:{totalQuantity:1,checkoutUrl:'https://example.myshopify.com/checkouts/test'},userErrors:[],warnings:[]}};});
 assert.match(await c.checkout('GR',[{productId:item.id,variantId:'gid://shopify/ProductVariant/1',quantity:1,store:'tech',browsingCountry:'DE'}]),/checkouts/);
});
test('A changed native destination price blocks checkout before creating a cart',async()=>{
 let cartCreated=false;
 const priced={...item,variants:{nodes:[{id:'gid://shopify/ProductVariant/1',availableForSale:true,price:{amount:'25.00',currencyCode:'EUR'}}],pageInfo:{hasNextPage:false}}};
 const c=client(({query})=>{if(query.includes('query Product'))return{product:priced};cartCreated=true;return{};});
 await assert.rejects(c.checkout('GR',[{productId:item.id,variantId:'gid://shopify/ProductVariant/1',quantity:1,store:'tech',browsingCountry:'DE',price:{amount:'29.10',currencyCode:'EUR'}}]),/checkout price changed/);
 assert.equal(cartCreated,false);
});
test('Legacy supplier average, decimal cost and processing qualifier retain their meaning',()=>{
 const nl={description:'Estimated delivery: supplier-reported average of 2 days to the Netherlands; this is an estimate. Netherlands shipping: €7.95 per order.'};
 const route=globalThis.VizimallDelivery.route(nl,'NL');assert.equal(route.estimate,'supplier-reported average of 2 days to the Netherlands');assert.equal(route.cost,'Supplier-reported: €7.95 per order');
 assert.equal(globalThis.VizimallDelivery.route(nl,'GR').estimate,null);
 const de={description:'Estimated delivery: 4–8 days to Germany, including processing and transport. Processing is 1–3 days for 80% of orders; transport is 3–5 days.'};
 assert.equal(globalThis.VizimallDelivery.route(de,'DE').processing,'1–3 days for 80% of orders');
});
test('Expired, unverified or variant-mismatched structured routes never supply delivery promises',()=>{
 const route={verified:true,available:true,appliesToAllVariants:true,source:'Supplier',checkedAt:'2026-10-01',expiresAt:'2026-10-10',estimatedDelivery:'3–7 business days'};
 const p=r=>({delivery:{type:'json',value:JSON.stringify({version:1,destinations:{DE:r}})}});
 const now=Date.parse('2026-10-06');
 assert.equal(globalThis.VizimallDelivery.route(p(route),'DE',null,now).estimate,'3–7 business days');
 for(const changed of [{expiresAt:'2026-10-05'},{verified:false},{appliesToAllVariants:false}])assert.equal(globalThis.VizimallDelivery.route(p({...route,...changed}),'DE',null,now).estimate,null);
});
