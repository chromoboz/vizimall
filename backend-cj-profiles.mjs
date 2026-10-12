import {launchDestinations} from './backend-cj-catalog.mjs';
import {mainPricingPolicy} from './backend-included-pricing.mjs';
const readyName='VIZIMALL CJ — 8 destinations included';
const holdName='VIZIMALL CJ — pending verification';
function result(data,key){const r=data?.[key];if(!r||r.userErrors?.length){const error=Error('CJ shared shipping profile was not confirmed');error.adminErrors=(r?.userErrors||[]).slice(0,3).map(e=>({message:String(e.message||'').slice(0,300),field:e.field}));throw error;}return r;}
function zeroZone(destination){return {name:'CJ confirmed '+destination,countries:[{code:destination,includeAllProvinces:true}],methodDefinitionsToCreate:[{name:'Standard shipping included',active:true,rateDefinition:{price:{amount:'0.00',currencyCode:'EUR'}}}]};}
function verifiedProfile(p,locationId){
  const gs=p?.profileLocationGroups;
  if(p?.default||p?.coversAllItems||gs?.length!==1)return false;
  const g=gs[0];
  if(g.locationGroup.locations.pageInfo.hasNextPage||g.locationGroup.locations.nodes.length!==1||g.locationGroup.locations.nodes[0].id!==locationId||g.locationGroupZones.pageInfo.hasNextPage)return false;
  const zones=g.locationGroupZones.nodes;
  return zones.length===launchDestinations.length&&launchDestinations.every(d=>zones.some(z=>z.zone.countries.length===1&&z.zone.countries[0].code.countryCode===d&&!z.zone.countries[0].code.restOfWorld&&z.methodDefinitions.nodes.length===1&&z.methodDefinitions.nodes[0].active&&!z.methodDefinitions.nodes[0].methodConditions.length&&z.methodDefinitions.nodes[0].rateProvider?.price?.currencyCode==='EUR'&&Number(z.methodDefinitions.nodes[0].rateProvider.price.amount)===0));
}
export async function sharedProfile({admin,fields,locationId,ready=false,variantIds=[]}){
  const name=ready?readyName:holdName;
  let after=null,profile;
  do{
    // Listing nested zones on 100 profiles exceeds Shopify's query-cost limit.
    // Find the owned profile cheaply, then inspect that one profile in full.
    const data=await admin(`query($after:String){deliveryProfiles(first:100,after:$after){nodes{id name} pageInfo{hasNextPage endCursor}}}`,{after});
    for(const item of data.deliveryProfiles.nodes)if(item.name===name){if(profile)throw Error('Ambiguous CJ shared profile');profile=item;}
    if(data.deliveryProfiles.pageInfo.hasNextPage&&!data.deliveryProfiles.pageInfo.endCursor)throw Error('Incomplete shipping profiles');
    after=data.deliveryProfiles.pageInfo.hasNextPage?data.deliveryProfiles.pageInfo.endCursor:null;
  }while(after);
  if(profile){
    const detail=await admin(`query($id:ID!){node(id:$id){... on DeliveryProfile{${fields}}}}`,{id:profile.id});
    if(!detail.node||detail.node.name!==name)throw Error('CJ shared shipping profile was not confirmed');
    profile=detail.node;
  }
  if(!profile){
    const created=result(await admin(`mutation($profile:DeliveryProfileInput!){deliveryProfileCreate(profile:$profile){profile{${fields}} userErrors{field message}}}`,{profile:{name,variantsToAssociate:variantIds,locationGroupsToCreate:[{locationsToAdd:[locationId],zonesToCreate:ready?launchDestinations.map(zeroZone):[]}]}}),'deliveryProfileCreate');
    profile=created.profile;
  }else if(variantIds.length){
    if(ready&&!verifiedProfile(profile,locationId))throw Error('CJ shared shipping profile was not confirmed');
    if(!ready&&(profile.default||profile.coversAllItems||profile.profileLocationGroups?.some(g=>g.locationGroupZones.pageInfo.hasNextPage||g.locationGroupZones.nodes.length)))throw Error('CJ holding profile must have no shipping rates');
    result(await admin(`mutation($id:ID!,$profile:DeliveryProfileInput!){deliveryProfileUpdate(id:$id,profile:$profile){profile{id} userErrors{field message}}}`,{id:profile.id,profile:{variantsToAssociate:variantIds}}),'deliveryProfileUpdate');
  }
  if(ready&&!verifiedProfile(profile,locationId))throw Error('CJ shared shipping profile was not confirmed');
  if(!ready&&(profile.default||profile.coversAllItems||profile.profileLocationGroups?.some(g=>g.locationGroupZones.pageInfo.hasNextPage||g.locationGroupZones.nodes.length)))throw Error('CJ holding profile must have no shipping rates');
  return profile;
}
export async function prepareSharedRoute({admin,db,fields,variantId,sku,destination,price,locationId,now=Date.now()}){
  const root='shipping/private/cj-candidate/'+variantId.split('/').at(-1)+'/';
  const candidate={sku,price,policy:mainPricingPolicy,checkedAt:now,expiresAt:now+6*3600000};
  await db.setJSON(root+destination,candidate);
  const records=await Promise.all(launchDestinations.map(d=>db.get(root+d,{type:'json'})));
  if(records.some(r=>r?.sku!==sku||r.policy!==mainPricingPolicy||r.expiresAt<=now))return {profileConfirmed:false,price,expiresAt:0};
  // Recheck all eight native prices immediately before associating the variant.
  const native=await Promise.all(launchDestinations.map(country=>admin(`query($id:ID!,$country:CountryCode!){node(id:$id){... on ProductVariant{sku contextualPricing(context:{country:$country}){price{amount currencyCode}}}}}`,{id:variantId,country})));
  for(let i=0;i<launchDestinations.length;i++){
    const data=native[i];
    const actual=data.node?.contextualPricing?.price;
    if(data.node?.sku!==sku||actual?.currencyCode!==records[i].price.currencyCode||Number(actual.amount)!==Number(records[i].price.amount))throw Error('Native country price not confirmed; shipping remains unchanged');
  }
  const profile=await sharedProfile({admin,fields,locationId,ready:true,variantIds:[variantId]});
  const fresh=await admin(`query($id:ID!){node(id:$id){... on ProductVariant{sku deliveryProfile{${fields}}}}}`,{id:variantId});
  if(fresh.node?.sku!==sku||fresh.node.deliveryProfile?.id!==profile.id||!verifiedProfile(fresh.node.deliveryProfile,locationId))throw Error('CJ shared shipping profile was not confirmed');
  for(let i=0;i<launchDestinations.length;i++)await db.setJSON('shipping/private/context-price/'+variantId.split('/').at(-1)+'/'+launchDestinations[i],{...records[i],profileConfirmed:true,profileId:profile.id});
  return {...candidate,profileConfirmed:true,profileId:profile.id};
}
export const sharedReadyProfileName=readyName;
