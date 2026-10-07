const {test}=require('node:test');
const assert=require('node:assert/strict');
require('./storefront-api.js'); require('./product-copy.js');
const api=globalThis.VizimallStorefront;
const config={domain:'example.myshopify.com',publicToken:'public-test-token',apiVersion:'2026-10'};
test('Country-wide search retains exact country and active store tags, excludes stale-index results and uses browsing language',async()=>{
  const client=api.createClient(config,async(url,options)=>{
    const {query,variables}=JSON.parse(options.body);
    assert.match(query,/@inContext\(country: \$country, language: \$language\)/);
    assert.equal(variables.country,'NL'); assert.equal(variables.language,'DE');
    assert.match(variables.filter,/^tag:country-germany AND \(tag:store-tech OR/);
    assert.ok(variables.filter.includes('tag:store-auto'));
    return{ok:true,json:async()=>({data:{products:{nodes:[
      {id:'tech',tags:['country-germany','store-tech']},
      {id:'home',tags:['country-germany','store-home']},
      {id:'wrong-country',tags:['country-greece','store-tech']},
      {id:'retired',tags:['country-germany','store-lifestyle']},
      {id:'unrouted',tags:['country-germany']}
    ],pageInfo:{hasNextPage:true,endCursor:'next'}}}})};
  });
  const result=await client.products('DE','all',null,{shippingCountry:'NL',search:'Lamp'});
  assert.deepEqual(result.products.map(p=>p.id),['tech','home']);
  assert.equal(api.productStore(result.products[1],'DE'),'home');
  assert.equal(result.pageInfo.endCursor,'next');
  await assert.rejects(client.products('XX','all'));
});
test('Reviewed product copy is limited to an unchanged exact supplier title and does not invent copy for another product',()=>{
  const source='20W Power Bank With Magnetic Closure, 10000mAh, Portable, Wireless, Fast Charging, MagSafe Compatible For IPhone 15 Pro Max And 16 Pro';
  const apply=globalThis.VizimallProductCopy.apply;
  for(const country of Object.keys(api.countries)){
    const item=apply({id:'gid://shopify/Product/16123378008398',title:source},country);
    assert.notEqual(item.title,source);assert.match(item.title,/20 W/); assert.ok(item.summary);
  }
  assert.equal(apply({id:'gid://shopify/Product/OTHER',title:source},'DE').title,source);
  assert.equal(apply({id:'gid://shopify/Product/16123378008398',title:'Changed 5000mAh model'},'DE').title,'Changed 5000mAh model');
  assert.equal(globalThis.VizimallProductCopy.search('Powerbank'),'Power Bank');
});
