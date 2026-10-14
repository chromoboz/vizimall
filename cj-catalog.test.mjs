import {test} from 'node:test';
import assert from 'node:assert/strict';
import {supplierContext} from './backend-context-pricing.mjs';
import {launchDestinations} from './backend-cj-catalog.mjs';
import {prepareSharedRoute,sharedProfile} from './backend-cj-profiles.mjs';
import {createContextPricingJob,readyForCatalog} from './backend-context-job.mjs';
import {requiredShippingScopes} from './backend-context-pricing.mjs';
import {mainPricingPolicy} from './backend-included-pricing.mjs';
test('CJ main catalog requires neither country nor category tags and preserves actual supplier identity',()=>{
  const product={vendor:'CJdropshipping',title:'Manual Six-Roller Neck Massager',status:'DRAFT',tags:[]};
  assert.deepEqual(supplierContext({sku:'CJAM130816105EV',product}),{browsing:'CN',category:'beauty'});
  assert.deepEqual(supplierContext({sku:'CJJT161368237KP',product:{...product,title:'G-Shaped LED Lamp'}}),{browsing:'CN',category:'home'});
  assert.equal(supplierContext({sku:'CJAM130816105EV',product:{...product,status:'ARCHIVED'}}),null);
  assert.equal(supplierContext({sku:'OTHER',product}),null);
  assert.equal(supplierContext({sku:'CJAM130816105EV',product:{...product,vendor:'Kersten B.V.'}}),null);
});
const sku='CJTEST1',variantId='gid://shopify/ProductVariant/1',price={amount:'15.90',currencyCode:'EUR'};
test('Only exact current-policy unexpired readiness skips supplier work',()=>{
 const now=1000,v={sku};const good={sku,policy:mainPricingPolicy,expiresAt:2000};
 assert.equal(readyForCatalog(good,v,now),true);
 for(const record of [null,{...good,sku:'CJCHANGED'},{...good,policy:'old'},{...good,expiresAt:now}])assert.equal(readyForCatalog(record,v,now),false);
});
function dbFixture(){const values=new Map();return {values,db:{get:async k=>values.get(k),setJSON:async(k,v)=>values.set(k,v)}};}
test('A fully current catalog does not quote CJ or rewrite Shopify prices',async()=>{
 const {db,values}=dbFixture();db.getWithMetadata=async k=>values.has(k)?{data:values.get(k),etag:'1'}:null;
 const save=db.setJSON;db.setJSON=async(k,v)=>{await save(k,v);return {modified:true};};
 values.set('shipping/private/context-routes',{items:[{variantId,sku,browsing:'CN',category:'pets',destination:'DE',checkedAt:0}]});
 values.set('shipping/private/cj-ready/1',{sku,policy:mainPricingPolicy,expiresAt:Date.now()+60000});
 const product={id:'gid://shopify/Product/1',vendor:'CJdropshipping',status:'ACTIVE',title:'Pet brush',tags:[]};
 const admin=async q=>{
  if(q.includes('currentAppInstallation'))return {currentAppInstallation:{accessScopes:requiredShippingScopes.map(handle=>({handle}))}};
  if(q.includes('productVariants('))return {productVariants:{nodes:[{id:variantId,sku,product}],pageInfo:{hasNextPage:false}}};
  throw Error('No price or profile request is needed');
 };
 await createContextPricingJob({production:true,env:{VIZIMALL_NATIVE_SHIPPING_ENABLED:'true'},storefrontConfig:{domain:'example.myshopify.com'},dbFactory:async()=>db,adminFactory:()=>admin,shippingFactory:()=>{throw Error('No supplier request is needed');}})();
 assert.equal(values.get('shipping/private/context-last-run').status,'idle');
});
test('One-country price cannot open the shared eight-country route',async()=>{
  const {db}=dbFixture();
  const record=await prepareSharedRoute({admin:()=>{throw Error('No native route may open yet');},db,fields:'id',variantId,sku,destination:'DE',price,locationId:'CJ'});
  assert.equal(record.profileConfirmed,false);
});
test('All eight quotes and native prices are required, then one shared profile is reused',async()=>{
  const {db,values}=dbFixture(),now=Date.now(),writes=[];
  for(const country of launchDestinations)values.set('shipping/private/cj-candidate/1/'+country,{sku,price,policy:mainPricingPolicy,expiresAt:now+60000});
  const zone=country=>({zone:{countries:[{code:{countryCode:country,restOfWorld:false}}]},methodDefinitions:{nodes:[{active:true,methodConditions:[],rateProvider:{price:{amount:'0.00',currencyCode:'EUR'}}}]}});
  const profile={id:'shared',name:'VIZIMALL CJ — 8 destinations included',default:false,coversAllItems:false,profileLocationGroups:[{locationGroup:{locations:{nodes:[{id:'CJ'}],pageInfo:{hasNextPage:false}}},locationGroupZones:{nodes:launchDestinations.map(zone),pageInfo:{hasNextPage:false}}}]};
  const admin=async(q,v)=>{
    if(q.includes('contextualPricing'))return {node:{sku,contextualPricing:{price}}};
    if(q.includes('deliveryProfiles('))return {deliveryProfiles:{nodes:[profile],pageInfo:{hasNextPage:false}}};
    if(q.includes('deliveryProfileUpdate(')){writes.push(v);return {deliveryProfileUpdate:{profile:{id:'shared'},userErrors:[]}};}
    if(q.includes('... on DeliveryProfile'))return {node:profile};
    return {node:{sku,deliveryProfile:profile}};
  };
  const args={admin,db,fields:'id',variantId,sku,destination:'DE',price,locationId:'CJ',now};
  assert.equal((await prepareSharedRoute(args)).profileConfirmed,true);
  assert.equal(writes.length,1);assert.deepEqual(writes[0].profile,{variantsToAssociate:[variantId]});
  for(const country of launchDestinations)assert.equal(values.get('shipping/private/context-price/1/'+country).profileConfirmed,true);
  values.get('shipping/private/cj-candidate/1/FR').expiresAt=0;
  writes.length=0;assert.equal((await prepareSharedRoute(args)).profileConfirmed,false);assert.equal(writes.length,0);
});
test('A malformed shared profile cannot receive any variant',async()=>{
  let mutated=false;
  const admin=async q=>{if(q.startsWith('mutation')){mutated=true;throw Error('unsafe association');}const bad={id:'bad',name:'VIZIMALL CJ — 8 destinations included',default:false,coversAllItems:false,profileLocationGroups:[]};if(q.includes('... on DeliveryProfile'))return{node:bad};return{deliveryProfiles:{nodes:[bad],pageInfo:{hasNextPage:false}}};};
  await assert.rejects(sharedProfile({admin,fields:'id',locationId:'CJ',ready:true,variantIds:[variantId]}),/not confirmed/);
  assert.equal(mutated,false);
});
test('Scheduled main catalog preparation visits all eight destinations and privately resolves drafts',async()=>{
  const {db,values}=dbFixture();
  db.getWithMetadata=async k=>values.has(k)?{data:values.get(k),etag:'1'}:null;
  const original=db.setJSON;db.setJSON=async(k,v)=>{await original(k,v);return {modified:true};};
  const product={id:'gid://shopify/Product/1',vendor:'CJdropshipping',title:'Neck Massager',status:'DRAFT',tags:[]};
  values.set('shipping/private/cj-held/1',{preparedAt:Date.now()});
  values.set('shipping/private/import-retry/blocked',{until:Date.now()+600000});
  values.set('shipping/private/context-queue',{items:[{variantId,sku,browsing:'CN',category:'beauty',destination:'DE'}]});
  values.set('shipping/private/context-cursor',{version:3,index:0,queuedLast:false,migrating:false});
  const variant={id:variantId,sku,price:'5.90',product,contextualPricing:{price:{amount:'5.90',currencyCode:'EUR'}}};
  const destinations=[];
  let publications=0;
  const admin=async q=>{
    if(q.includes('currentAppInstallation'))return {currentAppInstallation:{accessScopes:requiredShippingScopes.map(handle=>({handle}))}};
    if(q.includes('productVariants('))return {productVariants:{nodes:[variant],pageInfo:{hasNextPage:false}}};
    if(q.includes('productUpdate(')){publications++;return {productUpdate:{product:{id:product.id,status:'ACTIVE'},userErrors:[]}};}
    return {shop:{currencyCode:'EUR'},node:variant};
  };
  const run=createContextPricingJob({production:true,prioritizeImports:true,env:{VIZIMALL_NATIVE_SHIPPING_ENABLED:'true'},storefrontConfig:{domain:'example.myshopify.com'},dbFactory:async()=>db,adminFactory:()=>async(q,v)=>{
    if(q.includes('products(first:100'))return {products:{nodes:product.status==='DRAFT'?[{...product,id:'gid://shopify/Product/blocked',variants:{nodes:[{...variant,id:'gid://shopify/ProductVariant/blocked'}]}},{...product,variants:{nodes:[variant]}}]:[]}};
    if(q.includes('productVariants('))throw Error('Older active variant catalog must not delay new draft');
    const result=await admin(q,v);if(q.includes('productUpdate('))product.status='ACTIVE';return result;
  },shippingFactory:options=>async req=>{
    const resolved=await options.variantResolver(variantId,'DE');
    assert.equal(resolved.product.status,'DRAFT');assert.equal(resolved.price.amount,'5.90');
    const url=new URL(req.url),destination=url.searchParams.get('shipping');
    assert.equal(url.searchParams.get('country'),'CN');destinations.push(destination);
    return Response.json({status:'available',sku,from:'CN',destination,pricing:{unitPrice:price}});
  },prepare:async({destination})=>{
    values.set('shipping/private/cj-candidate/1/'+destination,{sku,price,policy:mainPricingPolicy,expiresAt:Date.now()+3600000});
    return {profileConfirmed:destinations.length===8,price};
  }});
  for(let i=0;i<8;i++){await run();assert.equal(publications,i===7?1:0);assert.equal(values.get('shipping/private/context-queue').items.length,i===7?0:1);}
  assert.deepEqual(destinations,launchDestinations);
  assert.equal(values.get('shipping/private/context-last-run').status,'verified');
});
