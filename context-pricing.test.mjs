import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supplierContext,assertShippingScopes,prepareDestinationPrice,revokeDestination,requiredShippingScopes} from './backend-context-pricing.mjs';
import {createContextPricingJob} from './backend-context-job.mjs';
import {shippingMethods} from './backend-included-pricing.mjs';
const id='gid://shopify/ProductVariant/1';
const source={sku:'CJTEST1',id,price:'21.90',product:{tags:['country-germany','store-tech'],status:'ACTIVE'}};
const quote={status:'available',sku:'CJTEST1',from:'DE',destination:'GR',quantity:1,expiresAt:Date.now()+60000,pricing:{unitPrice:{amount:'29.10',currencyCode:'EUR'}}};
function fixture({contextMismatch=false,rate='0.00',scopes=requiredShippingScopes}={}){
  const values=new Map([['shipping/private/base-price/1',{globalLastSeen:'21.90'}]]),writes=[];
  const zone={zone:{id:'gid://shopify/DeliveryZone/1',countries:[{code:{countryCode:'GR',restOfWorld:false}}]},methodDefinitions:{nodes:[{active:true,methodConditions:[],rateProvider:{price:{amount:rate,currencyCode:'EUR'}}}]}};
  const groups=[{locationGroup:{id:'gid://shopify/DeliveryLocationGroup/1',locations:{nodes:[{id:'gid://shopify/Location/1'}],pageInfo:{hasNextPage:false}}},locationGroupZones:{nodes:[zone],pageInfo:{hasNextPage:false}}}];
  let profile={id:'gid://shopify/DeliveryProfile/1',name:'General',default:true,profileLocationGroups:groups},contextPrice='21.90';
  const admin=async(query,vars)=>{
    if(query.includes('currentAppInstallation'))return{currentAppInstallation:{accessScopes:scopes.map(handle=>({handle}))}};
    if(query.startsWith('query')&&query.includes('markets(first:'))return{markets:{nodes:[{id:'gid://shopify/Market/GR',name:'Existing Greece',status:'ACTIVE',conditions:{conditionTypes:['REGION'],regionsCondition:{regions:{nodes:[{code:'GR'}],pageInfo:{hasNextPage:false}}}},catalogs:{nodes:[{id:'merchant-catalog',title:'Merchant catalog',status:'ACTIVE',priceList:{id:'merchant-prices',currency:'EUR'}}],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:false}}};
    if(query.startsWith('query'))return{shop:{currencyCode:'EUR'},node:{...source,contextualPricing:{price:{amount:contextPrice,currencyCode:'EUR'}},deliveryProfile:profile}};
    writes.push({query,vars});
    if(query.includes('catalogCreate('))return{catalogCreate:{catalog:{id:'owned-catalog',status:'ACTIVE'},userErrors:[]}};
    if(query.includes('priceListCreate('))return{priceListCreate:{priceList:{id:'owned-prices',currency:'EUR'},userErrors:[]}};
    if(query.includes('priceListFixedPricesAdd(')){contextPrice=contextMismatch?'25.00':'29.10';return{priceListFixedPricesAdd:{prices:[],userErrors:[]}};}
    if(query.includes('deliveryProfileCreate(')){profile={...profile,name:vars.profile.name,default:false,coversAllItems:false};return{deliveryProfileCreate:{profile:{id:profile.id},userErrors:[]}};}
    if(query.includes('deliveryProfileUpdate('))return{deliveryProfileUpdate:{profile:{id:profile.id},userErrors:[]}};
    throw Error('Unexpected operation');
  };
  const db={get:async key=>values.get(key),getWithMetadata:async key=>values.has(key)?{data:values.get(key),etag:'1'}:null,setJSON:async(key,value)=>{values.set(key,value);return{modified:true}}};
  const args={admin,db,variantId:id,expectedSku:'CJTEST1',browsing:'DE',category:'tech',destination:'GR',quote};
  return{admin,db,args,values,writes};
}
test('All eight supplier malls and seven categories qualify independently of delivery country',()=>{
  for(const [country,browsing] of Object.entries({germany:'DE',greece:'GR',netherlands:'NL',france:'FR',italy:'IT',spain:'ES',poland:'PL',portugal:'PT'}))for(const category of ['tech','home','pets','beauty','fashion','kids','auto'])assert.deepEqual(supplierContext({...source,product:{tags:['country-'+country,'store-'+category],status:'ACTIVE'}}),{browsing,category});
  assert.equal(supplierContext({...source,product:{tags:['country-germany','country-greece','store-tech']}}),null);
  assert.equal(supplierContext({...source,sku:'OTHER'}),null);
});
test('Destination writer verifies native price and zero shipping, leaving merchant catalogs and supplier tags intact',async()=>{
  const f=fixture();const record=await prepareDestinationPrice(f.args);
  assert.equal(record.profileConfirmed,true);assert.equal(record.price.amount,'29.10');
  const catalog=f.writes.find(w=>w.query.includes('catalogCreate(')).vars.input;
  assert.equal(catalog.publicationId,undefined);assert.deepEqual(catalog.context.marketIds,['gid://shopify/Market/GR']);
  const fixed=f.writes.find(w=>w.query.includes('priceListFixedPricesAdd(')).vars;
  assert.equal(fixed.priceListId,'owned-prices');
  const profile=f.writes.find(w=>w.query.includes('deliveryProfileCreate(')).vars.profile;
  assert.deepEqual(profile.variantsToAssociate,[id]);assert.equal(profile.coversAllItems,undefined);
  assert.deepEqual(profile.locationGroupsToCreate[0].zonesToCreate[0].countries,[{code:'GR',includeAllProvinces:true}]);
  assert.ok(!f.writes.some(w=>/productUpdate|productVariantsBulkUpdate|publishablePublish/.test(w.query)));
});
test('A conflicting native price never opens a free-shipping route or enables checkout',async()=>{
  const f=fixture({contextMismatch:true});await assert.rejects(prepareDestinationPrice(f.args),/Native country price/);
  assert.ok(!f.writes.some(w=>w.query.includes('deliveryProfileCreate')));assert.equal(f.values.has('shipping/private/context-price/1/GR'),false);
});
test('An unexpected paid shipping rate cannot be marked checkout-ready',async()=>{
  const f=fixture({rate:'3.00'});await assert.rejects(prepareDestinationPrice(f.args),/Included shipping rate/);
  assert.equal(f.values.has('shipping/private/context-price/1/GR'),false);
});
test('Unconfirmed permissions and disabled activation prevent all destination writes',async()=>{
  const f=fixture({scopes:['read_products','write_products']});await assert.rejects(assertShippingScopes(f.admin),/permission/);assert.equal(f.writes.length,0);
  await createContextPricingJob({production:true,env:{},dbFactory:()=>{throw Error('must not access')}})();
  await createContextPricingJob({production:false,env:{VIZIMALL_NATIVE_SHIPPING_ENABLED:'true'},dbFactory:()=>{throw Error('must not access')}})();
});
test('Route withdrawal invalidates readiness and never changes a merchant-owned shipping profile',async()=>{
  const f=fixture();await revokeDestination({admin:f.admin,db:f.db,variantId:id,destination:'GR'});
  assert.equal(f.values.get('shipping/private/context-price/1/GR').profileConfirmed,false);assert.equal(f.writes.length,0);
});
test('Supplier total postage takes precedence; separate fees are added once; malformed ranges fail closed',()=>{
  const row={logisticName:'Standard',logisticAging:'3-5',logisticPrice:'6.60',taxesFee:'1.10',clearanceOperationFee:'0.50'};
  assert.equal(shippingMethods([row])[0].supplierCost.amount,'8.20');
  assert.equal(shippingMethods([{...row,totalPostageFee:'8.20'}])[0].supplierCost.amount,'8.20');
  for(const bad of [{logisticAging:'5-3'},{logisticAging:'0'},{logisticPrice:null},{totalPostageFee:'0'},{taxesFee:'unknown'}])assert.deepEqual(shippingMethods([{...row,...bad}]),[]);
});
test('The scheduled worker processes a Greek supplier destination without spreading tags or writing a global price',async()=>{
 const f=fixture();const job={variantId:id,sku:'CJTEST1',browsing:'GR',category:'home',destination:'US'};
 await f.db.setJSON('shipping/private/context-queue',{items:[job]});
 const greek={...source,contextualPricing:{price:{amount:'21.90',currencyCode:'EUR'}},product:{tags:['country-greece','store-home'],status:'ACTIVE'}};
 const admin=async(q,v)=>q.includes('currentAppInstallation')?f.admin(q,v):{shop:{currencyCode:'EUR'},node:greek};
 let prepared;
 const run=createContextPricingJob({production:true,env:{VIZIMALL_NATIVE_SHIPPING_ENABLED:'true'},storefrontConfig:{domain:'example.myshopify.com'},dbFactory:async()=>f.db,adminFactory:()=>admin,shippingFactory:()=>async req=>{assert.equal(new URL(req.url).searchParams.get('country'),'GR');assert.equal(new URL(req.url).searchParams.get('shipping'),'US');return Response.json({...quote,from:'GR',destination:'US'});},prepare:async args=>{prepared=args;}});
 await run();assert.equal(prepared.browsing,'GR');assert.equal(prepared.destination,'US');assert.equal(f.values.get('shipping/private/context-queue').items.length,0);
 assert.equal(f.values.get('shipping/private/context-last-run').status,'verified');assert.equal(f.values.get('shipping/private/base-price/1').baseUnitPrice.amount,'21.90');
});
