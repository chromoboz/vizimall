import {createAdminPricingClientFromEnv} from './backend-price-sync.mjs';

// Routes observed in AutoDS Marketplace on 9 October 2026. This is the
// supplier's combined processing + shipping estimate, not a transit guarantee.
// New products require their own verified route before being enabled.
export const autodsRoutes = Object.freeze({
  'gid://shopify/Product/16132811981134': {category:'home',days:7},
  'gid://shopify/Product/16132833935694': {category:'pets',days:7}
});
const profileId='gid://shopify/DeliveryProfile/147908591950';
export function createAutoDSQuote({storefrontConfig,env,fetcher,adminFactory=createAdminPricingClientFromEnv}) {
  let admin;
  return async ({variant,browsing,destination,category,quantity,discovery=false}) => {
    const unavailable={status:discovery?'complete':'unavailable',destinations:[],methods:[]};
    const route=autodsRoutes[variant.product.id];
    if(!route)return {status:'not_mapped',methods:[]};
    if(browsing!=='DE'||destination!=='DE'||category!==route.category||variant.product.tags.filter(t=>t.startsWith('country-')).join(',')!=='country-germany'||!variant.availableForSale||!Number.isSafeInteger(variant.quantityAvailable)||variant.quantityAvailable<quantity)return unavailable;
    admin ||= adminFactory({domain:storefrontConfig.domain,env,fetcher});
    const data=await admin(`query($id:ID!,$country:CountryCode!){shop{fulfillmentServices{serviceName handle location{id}}} node(id:$id){... on ProductVariant{id sku product{id status} contextualPricing(context:{country:$country}){price{amount currencyCode}} deliveryProfile{id default coversAllItems profileLocationGroups{locationGroup{locations(first:250,includeLegacy:true){nodes{id} pageInfo{hasNextPage}}} locationGroupZones(first:250){nodes{zone{countries{code{countryCode restOfWorld}}} methodDefinitions(first:100){nodes{active name methodConditions{__typename} rateProvider{... on DeliveryRateDefinition{price{amount currencyCode}}}} pageInfo{hasNextPage}}} pageInfo{hasNextPage}}}}}}}`,{id:variant.id,country:'DE'});
    const fresh=data.node,profile=fresh?.deliveryProfile;
    const services=(data.shop?.fulfillmentServices||[]).filter(s=>/^AutoDS\b/i.test(s.serviceName||'')&&s.location?.id);
    const locationIds=new Set(services.map(s=>s.location.id));
    const groups=profile?.profileLocationGroups||[];
    if(fresh?.id!==variant.id||fresh.sku!==variant.sku||fresh.product?.id!==variant.product.id||fresh.product.status!=='ACTIVE'||profile.id!==profileId||profile.default||profile.coversAllItems||!groups.length||!locationIds.size)return unavailable;
    if(groups.some(g=>g.locationGroup.locations.pageInfo.hasNextPage||g.locationGroupZones.pageInfo.hasNextPage))return unavailable;
    if(!groups.some(g=>g.locationGroup.locations.nodes.some(l=>locationIds.has(l.id))))return unavailable;
    const zones=groups.flatMap(g=>g.locationGroupZones.nodes);
    if(!zones.length||zones.some(z=>z.zone.countries.length!==1||z.zone.countries[0].code.countryCode!=='DE'||z.zone.countries[0].code.restOfWorld||z.methodDefinitions.pageInfo.hasNextPage||!z.methodDefinitions.nodes.length||z.methodDefinitions.nodes.some(m=>!m.active||m.methodConditions.length||m.rateProvider?.price?.currencyCode!=='EUR'||Number(m.rateProvider.price.amount)!==0)))return unavailable;
    const price=fresh.contextualPricing?.price;
    if(price?.currencyCode!=='EUR'||variant.price?.currencyCode!=='EUR'||!/^\d+\.\d{2}$/.test(price.amount)||Number(price.amount)<=0||Number(price.amount)!==Number(variant.price.amount))return unavailable;
    const expiresAt=Date.now()+60000;
    if(discovery)return {status:'complete',destinations:['DE'],expiresAt};
    const cents=BigInt(price.amount.replace('.',''))*BigInt(quantity);
    return {status:'available',supplier:'autods',sku:variant.sku,origins:['DE'],from:'DE',destination:'DE',quantity,stockQuantity:variant.quantityAvailable,stockSource:'AutoDS synced stock via Shopify',totalDelivery:{days:route.days,unit:'business_days',includesProcessing:true},checkedAt:new Date().toISOString(),expiresAt,methods:[{name:'Standard shipping included',transport:null,supplierCost:{amount:'0.00',currencyCode:'EUR'}}],pricing:{unitPrice:price,lineTotal:{amount:`${cents/100n}.${String(cents%100n).padStart(2,'0')}`,currencyCode:'EUR'},includedShippingPerItem:{amount:'0.00',currencyCode:'EUR'},standardMethod:'Standard shipping included',policy:'standard_shipping_per_item',checkoutReady:true}};
  };
}
