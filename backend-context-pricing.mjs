import './shipping-destinations.js';
const countries={DE:'germany',GR:'greece',NL:'netherlands',FR:'france',IT:'italy',ES:'spain',PL:'poland',PT:'portugal'};
export const requiredShippingScopes=['read_products','write_products','read_markets','write_markets','read_shipping','write_shipping','read_locations'];
export function supplierContext(variant){
  const tags=variant?.product?.tags||[];
  const countryTags=tags.filter(t=>t.startsWith('country-'));
  const browsing=Object.keys(countries).find(code=>countryTags.length===1&&countryTags[0]==='country-'+countries[code]);
  const category=tags.find(t=>/^store-(tech|home|pets|beauty|fashion|kids|auto)$/.test(t))?.slice(6);
  return browsing&&category&&/^CJ[A-Za-z0-9 _-]{3,190}$/.test(variant.sku||'')&&variant.product.status!=='ARCHIVED'?{browsing,category}:null;
}
function payload(data,key){const result=data?.[key];if(!result||result.userErrors?.length)throw Error('Shopify destination configuration was not confirmed');return result;}
function sameMoney(a,b){return a?.currencyCode===b?.currencyCode&&Number(a.amount)===Number(b.amount);}
const marketFields=`id name status conditions{conditionTypes regionsCondition{regions(first:250){nodes{... on MarketRegionCountry{code}} pageInfo{hasNextPage}}}} catalogs(first:100){nodes{id title status priceList{id currency}} pageInfo{hasNextPage}}`;
const locationFields=`id isActive isFulfillmentService fulfillmentService{handle serviceName}`;
const profileFields=`id name default coversAllItems unassignedLocationsPaginated(first:250){nodes{${locationFields}} pageInfo{hasNextPage}} profileLocationGroups{locationGroup{id locations(first:250){nodes{${locationFields}} pageInfo{hasNextPage}}} locationGroupZones(first:250){nodes{zone{id countries{code{countryCode restOfWorld}}} methodDefinitions(first:10){nodes{id active name methodConditions{__typename} rateProvider{... on DeliveryRateDefinition{price{amount currencyCode}}}} pageInfo{hasNextPage}}} pageInfo{hasNextPage}}}`;
function cjLocation(profile){
  const unassigned=profile?.unassignedLocationsPaginated;
  if(!unassigned||unassigned.pageInfo.hasNextPage)throw Error('CJ fulfillment location requires review');
  const locations=[...unassigned.nodes,...(profile.profileLocationGroups||[]).flatMap(g=>g.locationGroup.locations.nodes)];
  const matches=[...new Map(locations.filter(l=>l.isActive&&l.isFulfillmentService&&[l.fulfillmentService?.handle,l.fulfillmentService?.serviceName].some(n=>String(n||'').toLowerCase()==='cjdropshipping')).map(l=>[l.id,l])).values()];
  if(matches.length!==1)throw Error('CJ fulfillment location requires review');
  return matches[0].id;
}
export async function assertShippingScopes(admin){
  const data=await admin(`query{currentAppInstallation{accessScopes{handle}}}`);
  const scopes=new Set(data.currentAppInstallation?.accessScopes?.map(s=>s.handle));
  const missing=requiredShippingScopes.filter(scope=>!scopes.has(scope)&&!(scope.startsWith('read_')&&scopes.has(scope.replace(/^read_/,'write_'))));
  if(missing.length){const error=Error('Shipping and market permission required');error.missingScopes=missing;throw error;}
}
// Only the private scheduled worker can call this writer. Never take a price
// supplied by a browser. Each destination retains its own native checkout price.
export async function prepareDestinationPrice({admin,db,variantId,expectedSku,browsing,category,destination,quote,now=Date.now()}){
  if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId||'')||!globalThis.VizimallDestinations.valid(destination)||quote?.status!=='available'||quote.sku!==expectedSku||quote.from!==browsing||quote.destination!==destination||quote.quantity!==1||!Number.isFinite(quote.expiresAt)||quote.expiresAt<=now||!quote.pricing?.unitPrice)throw Error('Fresh destination shipping quote required');
  const price=quote.pricing.unitPrice;
  if(price.currencyCode!=='EUR'||!/^\d+\.\d{2}$/.test(price.amount))throw Error('Destination currency requires configuration');
  const read=()=>admin(`query($id:ID!,$country:CountryCode!){shop{currencyCode} node(id:$id){... on ProductVariant{id sku price product{id tags status} contextualPricing(context:{country:$country}){price{amount currencyCode}} deliveryProfile{${profileFields}}}}}`,{id:variantId,country:destination});
  const current=await read(),variant=current.node;
  if(variant?.sku!==expectedSku||current.shop?.currencyCode!=='EUR'||JSON.stringify(supplierContext(variant))!==JSON.stringify({browsing,category}))throw Error('Supplier tags or variant changed');
  const baseline=await db.get('shipping/private/base-price/'+variantId.split('/').at(-1),{type:'json'});
  if(baseline?.globalLastSeen!==variant.price)throw Error('Merchant base price changed');
  // Country-only markets. Do not reuse a regional market for a per-country price,
  // and never replace an existing merchant catalog or change product visibility.
  let after=null,market;
  do{
    const result=await admin(`query($after:String){markets(first:100,after:$after){nodes{${marketFields}} pageInfo{hasNextPage endCursor}}}`,{after});
    for(const item of result.markets.nodes){
      const regions=item.conditions?.regionsCondition?.regions;
      if(!regions?.pageInfo.hasNextPage&&item.conditions.conditionTypes?.length===1&&regions?.nodes.length===1&&regions.nodes[0].code===destination){if(market)throw Error('Ambiguous destination market');market=item;}
    }
    if(result.markets.pageInfo.hasNextPage&&!result.markets.pageInfo.endCursor)throw Error('Incomplete markets');
    after=result.markets.pageInfo.hasNextPage?result.markets.pageInfo.endCursor:null;
  }while(after);
  if(!market){
    market=payload(await admin(`mutation($input:MarketCreateInput!){marketCreate(input:$input){market{${marketFields}} userErrors{field message}}}`,{input:{name:'Vizimall delivery '+destination,handle:'vizimall-delivery-'+destination.toLowerCase(),status:'ACTIVE',conditions:{regionsCondition:{regions:[{countryCode:destination}]}},currencySettings:{baseCurrency:'EUR',localCurrencies:false}}}),'marketCreate').market;
  }
  if(market.status!=='ACTIVE'||market.catalogs?.pageInfo.hasNextPage)throw Error('Destination market needs merchant review');
  const title='Vizimall CJ shipping · '+destination;
  let catalog=market.catalogs?.nodes.find(c=>c.title===title);
  if(!catalog){catalog=payload(await admin(`mutation($input:CatalogCreateInput!){catalogCreate(input:$input){catalog{id title status priceList{id currency}} userErrors{field message}}}`,{input:{title,status:'ACTIVE',context:{marketIds:[market.id]}}}),'catalogCreate').catalog;}
  if(catalog.status!=='ACTIVE')throw Error('Shipping catalog inactive');
  let priceList=catalog.priceList;
  if(!priceList){priceList=payload(await admin(`mutation($input:PriceListCreateInput!){priceListCreate(input:$input){priceList{id currency} userErrors{field message}}}`,{input:{name:title,currency:'EUR',catalogId:catalog.id,parent:{adjustment:{type:'PERCENTAGE_INCREASE',value:0}}}}),'priceListCreate').priceList;}
  if(priceList.currency!=='EUR')throw Error('Destination currency requires configuration');
  payload(await admin(`mutation($priceListId:ID!,$prices:[PriceListPriceInput!]!){priceListFixedPricesAdd(priceListId:$priceListId,prices:$prices){prices{variant{id} price{amount currencyCode}} userErrors{field message}}}`,{priceListId:priceList.id,prices:[{variantId,price}]}),'priceListFixedPricesAdd');
  // A dedicated variant profile prevents unsupported destinations from becoming
  // purchasable via an address change at checkout. Shopify profile limits fail
  // closed; no fallback to a rest-of-world free-shipping rate.
  const beforeProfile=await read();
  if(beforeProfile.node?.sku!==expectedSku||JSON.stringify(beforeProfile.node?.product)!==JSON.stringify(variant.product)||!sameMoney(beforeProfile.node?.contextualPricing?.price,price))throw Error('Native country price not confirmed; shipping remains unchanged');
  const name='Vizimall CJ route '+variantId.split('/').at(-1);
  const owned=variant.deliveryProfile?.name===name&&!variant.deliveryProfile.default&&!variant.deliveryProfile.coversAllItems;
  const existing=variant.deliveryProfile;
  const groups=existing?.profileLocationGroups||[];
  if(!groups.length||groups.length>5||groups.some(g=>g.locationGroup.locations.pageInfo.hasNextPage||g.locationGroupZones.pageInfo.hasNextPage))throw Error('Fulfillment locations require review');
  // CJ inventory stays at its app-managed location. Copying a merchant's physical
  // location makes Shopify mark stocked CJ products sold out for that route.
  const fulfillmentLocationId=cjLocation(existing);
  if(owned&&groups.length!==1)throw Error('CJ fulfillment groups require review');
  if(owned){
    const group=groups[0],ids=group.locationGroup.locations.nodes.map(l=>l.id);
    if(ids.length!==1||ids[0]!==fulfillmentLocationId){
      payload(await admin(`mutation($id:ID!,$profile:DeliveryProfileInput!){deliveryProfileUpdate(id:$id,profile:$profile){profile{id} userErrors{field message}}}`,{id:existing.id,profile:{locationGroupsToUpdate:[{id:group.locationGroup.id,locationsToAdd:ids.includes(fulfillmentLocationId)?[]:[fulfillmentLocationId],locationsToRemove:ids.filter(id=>id!==fulfillmentLocationId)}]}}),'deliveryProfileUpdate');
    }
  }
  const zone={name:'CJ confirmed '+destination,countries:[{code:destination,includeAllProvinces:true}],methodDefinitionsToCreate:[{name:'Standard shipping included',active:true,description:'Standard shipping is included per item in the product price.',rateDefinition:{price:{amount:'0.00',currencyCode:'EUR'}}}]};
  const already=owned&&groups.every(g=>g.locationGroupZones.nodes.some(z=>z.zone.countries.length===1&&z.zone.countries[0].code.countryCode===destination&&!z.zone.countries[0].code.restOfWorld&&z.methodDefinitions.nodes.length===1&&z.methodDefinitions.nodes[0].active&&!z.methodDefinitions.nodes[0].methodConditions.length&&sameMoney(z.methodDefinitions.nodes[0].rateProvider.price,{amount:'0.00',currencyCode:'EUR'})));
  if(!already){
    if(owned){payload(await admin(`mutation($id:ID!,$profile:DeliveryProfileInput!){deliveryProfileUpdate(id:$id,profile:$profile){profile{id} userErrors{field message}}}`,{id:existing.id,profile:{locationGroupsToUpdate:groups.map(g=>({id:g.locationGroup.id,zonesToCreate:[zone]}))}}),'deliveryProfileUpdate');}
    else{
      payload(await admin(`mutation($profile:DeliveryProfileInput!){deliveryProfileCreate(profile:$profile){profile{id} userErrors{field message}}}`,{profile:{name,variantsToAssociate:[variantId],locationGroupsToCreate:[{locationsToAdd:[fulfillmentLocationId],zonesToCreate:[zone]}]}}),'deliveryProfileCreate');
    }
  }
  const fresh=await read();
  if(fresh.node?.sku!==expectedSku||JSON.stringify(fresh.node?.product)!==JSON.stringify(variant.product)||!sameMoney(fresh.node?.contextualPricing?.price,price)||fresh.node.deliveryProfile?.name!==name)throw Error('Native checkout price or profile was not confirmed');
  const freshGroups=fresh.node.deliveryProfile.profileLocationGroups;
  if(freshGroups.length!==1||freshGroups[0].locationGroup.locations.nodes.length!==1||freshGroups[0].locationGroup.locations.nodes[0].id!==fulfillmentLocationId)throw Error('CJ fulfillment location was not confirmed');
  if(!freshGroups.length||freshGroups.some(g=>!g.locationGroupZones.nodes.some(z=>z.zone.countries.length===1&&z.zone.countries[0].code.countryCode===destination&&!z.zone.countries[0].code.restOfWorld&&z.methodDefinitions.nodes.length===1&&z.methodDefinitions.nodes[0].active&&!z.methodDefinitions.nodes[0].methodConditions.length&&sameMoney(z.methodDefinitions.nodes[0].rateProvider.price,{amount:'0.00',currencyCode:'EUR'}))))throw Error('Included shipping rate was not confirmed');
  const record={sku:expectedSku,price,profileConfirmed:true,profileId:fresh.node.deliveryProfile.id,marketId:market.id,priceListId:priceList.id,checkedAt:new Date(now).toISOString(),expiresAt:now+3600000};
  await db.setJSON('shipping/private/context-price/'+variantId.split('/').at(-1)+'/'+destination,record);
  return record;
}
export async function revokeDestination({admin,db,variantId,destination}){
  await db.setJSON('shipping/private/context-price/'+variantId.split('/').at(-1)+'/'+destination,{expiresAt:0,profileConfirmed:false});
  const data=await admin(`query($id:ID!){node(id:$id){... on ProductVariant{deliveryProfile{${profileFields}}}}}`,{id:variantId});
  const profile=data.node?.deliveryProfile;
  if(!profile||profile.name!=='Vizimall CJ route '+variantId.split('/').at(-1)||profile.default||profile.coversAllItems)return;
  const zones=(profile.profileLocationGroups||[]).flatMap(g=>g.locationGroupZones.nodes).filter(z=>z.zone.countries.some(c=>c.code.countryCode===destination)).map(z=>z.zone.id);
  if(zones.length)payload(await admin(`mutation($id:ID!,$profile:DeliveryProfileInput!){deliveryProfileUpdate(id:$id,profile:$profile){profile{id} userErrors{field message}}}`,{id:profile.id,profile:{zonesToDelete:zones}}),'deliveryProfileUpdate');
}
