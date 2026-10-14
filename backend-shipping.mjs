import { store, limit, hash, update } from './backend-persistence.mjs';
import './shipping-destinations.js';
import {auditedDestinations} from './backend-destination-audit.mjs';
import { discoverDestinations, enqueueDestinationDiscovery } from './backend-destinations.mjs';
import { baselineForSync, cheapestMethod, includedPrice, mainCatalogPrice, mainPricingPolicy, convertCost, parseEcbRates, shippingMethods } from './backend-included-pricing.mjs';
import {createAutoDSQuote} from './backend-autods-shipping.mjs';
import {mainCatalogContext,launchDestinations} from './backend-cj-catalog.mjs';
const countries = {CN:'china',DE:'germany',NL:'netherlands',FR:'france',GR:'greece',IT:'italy',PL:'poland',PT:'portugal',ES:'spain'};
const stores = ['tech','home','pets','beauty','fashion','kids','auto'];
const cjBase = 'https://developers.cjdropshipping.com/api2.0/v1/';
const cacheMs = 300000;
const quoteCacheMs = 6 * 60 * 60 * 1000;
export function createShippingHandler({dbFactory=store, fetcher=fetch, env=process.env, storefrontConfig, probeSku='CJQT25986940004',probeSkus=[],pricing=false,catalogMetadata=false,allowUnavailable=false,supplierPacingMs=1100,discoveryBudgetMs=14000,autodsAdminFactory,variantResolver}={}) {
  let tokenPending, supplierDb;
  const autodsQuote=createAutoDSQuote({storefrontConfig,env,fetcher,adminFactory:autodsAdminFactory});
  async function cj(path, token, body, timeoutMs=12000) {
    // CJ free accounts allow one call per second. Share the slot across functions.
    if(supplierDb&&supplierPacingMs>0){
      const reserved=await update(supplierDb,'shipping/private/cj-call-slot',old=>{
        const at=Math.max(Date.now(),old?.nextAt||0);
        if(at>Date.now()+2500)throw Error('Supplier connection is busy');
        return{nextAt:at+supplierPacingMs,expiresAt:at+60000};
      });
      const wait=reserved.nextAt-supplierPacingMs-Date.now();
      if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
    }
    const response = await fetcher(cjBase+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(Math.min(12000,timeoutMs)),headers:{'Content-Type':'application/json',...(token?{'CJ-Access-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data = await response.json();
    if (!response.ok || data.result === false || data.code !== 200) {
      const error=new Error('Supplier connection unavailable');
      error.supplierCode=Number.isSafeInteger(data.code)?data.code:null;
      error.supplierStep=path.split('?')[0];
      throw error;
    }
    return data.data;
  }
  async function findVariant(sku, access) {
    if(catalogMetadata){
      const detail=await cj('product/query?variantSku='+encodeURIComponent(sku),access);
      const matches=(detail?.variants||[]).filter(v=>v.variantSku===sku&&v.vid);
      return matches.length===1?{...matches[0],pid:detail.pid,categoryName:detail.categoryName}:null;
    }
    let variants;
    try { variants=await cj('product/variant/query?variantSku='+encodeURIComponent(sku),access); }
    catch(error){
      if(error.supplierCode!==1600300)throw error;
      // Some CJ deployments require a product ID for the variants endpoint.
      const detail=await cj('product/query?variantSku='+encodeURIComponent(sku),access);
      variants=detail?.variants;
    }
    const matches=Array.isArray(variants)?variants.filter(v=>v.variantSku===sku):[];
    return matches.length===1&&matches[0].vid?matches[0]:null;
  }
  async function token(db) {
    const key='shipping/private/token/'+hash(env.CJ_API_KEY);
    const current=await db.get(key,{type:'json'});
    if(current?.expiresAt>Date.now()+600000)return current.token;
    if(tokenPending)return tokenPending;
    tokenPending=(async()=>{
      const lock=await update(db,key,old=>{
        if(old?.expiresAt>Date.now()+600000)return old;
        if(old?.leaseUntil>Date.now())throw new Error('Supplier connection is warming up');
        return {...old,leaseUntil:Date.now()+20000};
      });
      if(lock.expiresAt>Date.now()+600000)return lock.token;
      try {
        const data=await cj('authentication/getAccessToken',null,{apiKey:env.CJ_API_KEY});
        const expiresAt=Date.parse(data.accessTokenExpiryDate);
        if(!data.accessToken||!Number.isFinite(expiresAt)||expiresAt<=Date.now()+600000)throw new Error('Supplier connection unavailable');
        await db.setJSON(key,{token:data.accessToken,expiresAt,leaseUntil:0});
        return data.accessToken;
      }catch(error){await update(db,key,old=>({...old,leaseUntil:0}));throw error;}
    })();
    try{return await tokenPending;}finally{tokenPending=null;}
  }
  async function product(id, country) {
    if(variantResolver)return variantResolver(id,country);
    const settings=storefrontConfig;
    const response=await fetcher(`https://${settings.domain}/api/${settings.apiVersion}/graphql.json`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':settings.publicToken},body:JSON.stringify({query:`query($id:ID!,$country:CountryCode!) @inContext(country:$country){node(id:$id){... on ProductVariant{id sku availableForSale quantityAvailable price{amount currencyCode} product{id tags vendor productType title}}}}`,variables:{id,country}})});
    const body=await response.json();if(!response.ok||body.errors||!body.data?.node)throw new Error('Product unavailable');
    return body.data.node;
  }
  const pending = new Map();
  async function handler(req,context={}) {
    const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    if(req.method!=='GET')return reply({error:'Method not allowed'},405);
    if(!env.CJ_API_KEY&&!env.SHOPIFY_ADMIN_CLIENT_ID&&!autodsAdminFactory)return reply({status:'not_connected',methods:[]});
    try {
      const url=new URL(req.url);
      if(url.searchParams.get('check')==='catalog-prices'){
        const destination=url.searchParams.get('shipping');
        const numbers=(url.searchParams.get('products')||'').split(',');
        if(!launchDestinations.includes(destination)||!numbers.length||numbers.length>12||numbers.some(n=>!/^\d{1,20}$/.test(n)))return reply({prices:{}},400);
        const db=await dbFactory(req);
        await limit(db,'shipping:cards:'+(context.ip||'unknown'),60,60000);
        const ids=[...new Set(numbers)].map(n=>'gid://shopify/Product/'+n);
        const settings=storefrontConfig;
        const response=await fetcher(`https://${settings.domain}/api/${settings.apiVersion}/graphql.json`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':settings.publicToken},body:JSON.stringify({query:`query($ids:[ID!]!,$country:CountryCode!) @inContext(country:$country){nodes(ids:$ids){... on Product{id vendor availableForSale variants(first:100){nodes{id sku availableForSale price{amount currencyCode}} pageInfo{hasNextPage}}}}}`,variables:{ids,country:destination}})});
        const body=await response.json();if(!response.ok||body.errors||!Array.isArray(body.data?.nodes))throw Error('Catalog price verification unavailable');
        const prices={};
        await Promise.all(body.data.nodes.filter(p=>p?.availableForSale&&String(p.vendor||'').toLowerCase()==='cjdropshipping'&&!p.variants?.pageInfo?.hasNextPage).map(async p=>{
          const confirmed=[];
          await Promise.all((p.variants?.nodes||[]).filter(v=>v.availableForSale).map(async v=>{
            const ready=await db.get('shipping/private/context-price/'+v.id.split('/').at(-1)+'/'+destination,{type:'json'});
            if(ready?.policy===mainPricingPolicy&&ready?.profileConfirmed===true&&ready?.sku===v.sku&&ready?.expiresAt>Date.now()&&ready?.price?.currencyCode==='EUR'&&Number(ready.price.amount)===Number(v.price.amount))confirmed.push({price:ready.price,id:v.id,order:p.variants.nodes.indexOf(v)});
          }));
          if(confirmed.length){
            const minimum=[...confirmed].sort((a,b)=>Number(a.price.amount)-Number(b.price.amount))[0];
            prices[p.id]={...minimum.price,confirmedVariantIds:confirmed.sort((a,b)=>a.order-b.order).map(v=>v.id)};
          }
        }));
        return reply({country:destination,prices});
      }
      // Fixed, public CJ catalog SKU for an end-to-end supplier smoke check.
      // This does not publish or qualify a Shopify product for purchase.
      if (url.searchParams.get('check') === 'supplier-sample') {
        const sku=url.searchParams.get('sku')||probeSku;
        const destination=url.searchParams.get('destination')||'DE';
        if(![probeSku,...probeSkus].includes(sku)||!globalThis.VizimallDestinations.valid(destination))return reply({error:'Invalid supplier check'},400);
        const db=await dbFactory(req);supplierDb=db;
        const requestedFrom=url.searchParams.get('from');
        if(requestedFrom&&!countries[requestedFrom])return reply({error:'Invalid supplier origin'},400);
        const key='shipping/private/supplier-probe/'+hash(JSON.stringify(requestedFrom||catalogMetadata?[sku,destination,requestedFrom,catalogMetadata]:[sku,destination]));
        const cached=await db.get(key,{type:'json'});
        if(cached?.expiresAt>Date.now())return reply(cached);
        await limit(db,'shipping:probe:global',20,60000);
        const access=await token(db);
        const stocks=await cj('product/stock/queryBySku?sku='+encodeURIComponent(sku),access);
        const origins=[...new Set((Array.isArray(stocks)?stocks:[]).filter(s=>countries[s.countryCode]&&Number(s.totalInventoryNum)>=1).map(s=>s.countryCode))];
        let value={status:'no_verified_eu_stock',origins,methods:[]};
        if(origins.length){
          const matched=await findVariant(sku,access);
          if(!matched)throw new Error('Supplier variant unavailable');
          const from=requestedFrom||(origins.includes(destination)?destination:origins[0]);
          if(!origins.includes(from))return reply({status:'unavailable',origins,methods:[],sku});
          const options=await cj('logistic/freightCalculate',access,{startCountryCode:from,endCountryCode:destination,products:[{vid:matched.vid,quantity:1}]});
          const methods=shippingMethods(options);
          const observedMethods=(Array.isArray(options)?options:[]).map(o=>({name:typeof o.logisticName==='string'?o.logisticName.slice(0,200):null,transport:typeof o.logisticAging==='string'?o.logisticAging.slice(0,100):null,price:['string','number'].includes(typeof o.logisticPrice)?String(o.logisticPrice).slice(0,30):null}));
          const stock=(Array.isArray(stocks)?stocks:[]).find(s=>s.countryCode===from);
          let processingHours=null;
          if(catalogMetadata&&matched.pid){
            const list=await cj('product/list?'+new URLSearchParams({pid:matched.pid,countryCode:from,pageSize:'1'}),access);
            const exact=(list?.list||[]).filter(p=>p.pid===matched.pid);
            if(exact.length===1&&[24,48,72].includes(Number(exact[0].deliveryTime)))processingHours=Number(exact[0].deliveryTime);
          }
          value={status:methods.length?'available':'unavailable',origins,from,destination,methods,observedMethods,stockQuantity:Number(stock?.totalInventoryNum),stockSource:'CJ reported warehouse inventory',...(catalogMetadata?{categoryName:matched.categoryName,processingHours}: {})};
        }
        value.sku=sku;value.quantity=1;value.checkedAt=new Date().toISOString();value.expiresAt=Date.now()+cacheMs;
        await db.setJSON(key,value);return reply(value);
      }
      // Report connectivity only; never expose the supplier credential or token.
      if (url.searchParams.get('check') === 'connection') {
        const db=await dbFactory(req);supplierDb=db;
        await limit(db,'shipping:connection:'+(context.ip||'unknown'),5,60000);
        await token(db);
        return reply({status:'connected'});
      }
      const id=url.searchParams.get('variant'), destination=url.searchParams.get('shipping'), browsing=url.searchParams.get('country'), category=url.searchParams.get('store'), requestedOrigin=url.searchParams.get('from');
      const quantity=Number(url.searchParams.get('quantity')||1);
      if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id||'')||!globalThis.VizimallDestinations.valid(destination)||!countries[browsing]||!stores.includes(category)||!Number.isInteger(quantity)||quantity<1||quantity>99||(requestedOrigin&&requestedOrigin!==browsing))return reply({error:'Invalid shipping request'},400);
      const db=await dbFactory(req);supplierDb=db;
      await limit(db,'shipping:'+ (context.ip||'unknown'),60,60000);
      // Recheck current Shopify eligibility before returning even a cached quote.
      const variant=await product(id,browsing==='CN'?(launchDestinations.includes(destination)?destination:'DE'):browsing);
      const main=mainCatalogContext(variant.product);
      const eligible=main ? main.browsing===browsing&&main.category===category : [`country-${countries[browsing]}`,`store-${category}`].every(tag=>variant.product.tags.includes(tag));
      if((!variant.availableForSale&&!allowUnavailable&&url.searchParams.get('check')!=='destinations')||!eligible)return reply({status:'unavailable',methods:[]});
      if(main&&url.searchParams.get('check')!=='destinations'&&!launchDestinations.includes(destination))return reply({status:'unavailable',methods:[]});
      if(!/^CJ[A-Za-z0-9 _-]{3,190}$/.test(variant.sku||''))return reply(await autodsQuote({variant,browsing,destination,category,quantity,discovery:url.searchParams.get('check')==='destinations'}));
      if(!env.CJ_API_KEY)return reply({status:'not_connected',methods:[]});
      if(url.searchParams.get('check')==='destinations'&&url.searchParams.get('cached')==='1'){
        if(main&&quantity===1){
          const prepared=await Promise.all(launchDestinations.map(code=>db.get('shipping/private/context-price/'+id.split('/').at(-1)+'/'+code,{type:'json'})));
          const confirmed=launchDestinations.filter((code,i)=>prepared[i]?.profileConfirmed===true&&prepared[i]?.sku===variant.sku&&prepared[i]?.expiresAt>Date.now());
          if(confirmed.length===launchDestinations.length)return reply({status:'complete',destinations:confirmed,expiresAt:Math.min(...prepared.map(p=>p.expiresAt)),retryAfterMs:8000});
        }
        await enqueueDestinationDiscovery(db,{variantId:id,sku:variant.sku,browsing,category,quantity});
        const discoveryKey='shipping/private/destinations/'+hash(JSON.stringify([id,variant.sku,browsing,quantity]));
        const state=await db.get(discoveryKey,{type:'json'});
        const fresh=state?.expiresAt>Date.now();
        const codes=main?launchDestinations:globalThis.VizimallDestinations.codes;
        return reply({status:fresh&&codes.every(c=>state.checked.includes(c))?'complete':'discovering',destinations:[...new Set([...(fresh?state.available:[]),...auditedDestinations({sku:variant.sku,from:browsing,quantity,state})])].filter(c=>codes.includes(c)),expiresAt:fresh?state.expiresAt:Date.now()+60000,retryAfterMs:8000});
      }
      const key='shipping/quotes/v2/'+hash(JSON.stringify([id,variant.sku,destination,browsing,category,requestedOrigin||browsing,quantity,pricing,catalogMetadata]));
      const cached=await db.get(key,{type:'json'});
      let value;
      if(url.searchParams.get('check')!=='destinations'&&cached?.status==='available'&&cached.expiresAt>Date.now()) {
        // Supplier data is persistent; eligibility and included prices stay current.
        value={...cached};
        // Stock keeps its shorter freshness window; freight stays cached for six hours.
        if((value.stockCheckedAt||Date.parse(value.checkedAt))<=Date.now()-cacheMs){
          const access=await token(db);
          const stock=await cj('product/stock/queryBySku?sku='+encodeURIComponent(variant.sku),access);
          const current=(Array.isArray(stock)?stock:[]).filter(s=>s.countryCode===browsing&&Number.isSafeInteger(Number(s.totalInventoryNum))&&Number(s.totalInventoryNum)>=quantity);
          if(!current.length)return reply({status:'unavailable',origins:[],methods:[]});
          value.stockQuantity=Math.max(...current.map(s=>Number(s.totalInventoryNum)));
          value.stockCheckedAt=Date.now();
        }
      } else {
      await limit(db,'shipping:global',120,60000);
      const access=await token(db);
      const matched=await findVariant(variant.sku,access);
      if(!matched)return reply({status:'not_mapped',methods:[]});
      const stock=await cj('product/stock/queryBySku?sku='+encodeURIComponent(variant.sku),access);
      // Never silently substitute another supplier country when local stock runs out.
      const originStock=(Array.isArray(stock)?stock:[]).filter(s=>s.countryCode===browsing&&Number.isSafeInteger(Number(s.totalInventoryNum))&&Number(s.totalInventoryNum)>=quantity);
      const origins=[...new Set(originStock.map(s=>s.countryCode))];
      const from=browsing;
      if(!from||!origins.includes(from))return reply({status:'unavailable',origins,methods:[]});
      if(url.searchParams.get('check')==='destinations'){
        await limit(db,'shipping:discovery:'+(context.ip||'unknown'),20,60000);
        const discoveryKey='shipping/private/destinations/'+hash(JSON.stringify([id,variant.sku,from,quantity]));
        return reply(await discoverDestinations({db,key:discoveryKey,budgetMs:discoveryBudgetMs,codes:main?launchDestinations:globalThis.VizimallDestinations.codes,priority:[from,destination,'GR','GB','US','BE','BG','NL','IT','CZ','EE','LT','LU','HR','LV','HU','SI','SK','IE','FR','ES','AT','PL','PT','RO','DK','FI','SE','GB','US'],probe:async(code,timeoutMs)=>{
          await limit(db,'shipping:discovery-freight',60,60000);
          const methods=shippingMethods(await cj('logistic/freightCalculate',access,{startCountryCode:from,endCountryCode:code,products:[{vid:matched.vid,quantity}]},timeoutMs));
          return methods.length>0;
        }}));
      }
      const options=await cj('logistic/freightCalculate',access,{startCountryCode:from,endCountryCode:destination,products:[{vid:matched.vid,quantity}]});
      // A quote without both a price and a transit estimate must never qualify.
      const methods=shippingMethods(options);
      const qualificationKey='shipping/private/qualification/'+id.split('/').at(-1);
      let qualification=await db.get(qualificationKey,{type:'json'});
      if(catalogMetadata&&matched.pid&&!(qualification?.sku===variant.sku&&qualification?.expiresAt>Date.now())){
        const list=await cj('product/list?'+new URLSearchParams({pid:matched.pid,countryCode:from,pageSize:'1'}),access);
        const exact=(list?.list||[]).filter(p=>p.pid===matched.pid);
        qualification={sku:variant.sku,processingHours:exact.length===1&&[24,48,72].includes(Number(exact[0].deliveryTime))?Number(exact[0].deliveryTime):null,expiresAt:Date.now()+86400000};
        await db.setJSON(qualificationKey,qualification);
      }
      value={status:methods.length?'available':'unavailable',...(methods.length?{}:{reason:'no_shipping_method'}),sku:variant.sku,origins,from,destination,quantity,methods,stockQuantity:Math.max(...originStock.map(s=>Number(s.totalInventoryNum))),stockSource:'CJ reported warehouse inventory',processingHours:qualification?.sku===variant.sku&&qualification?.expiresAt>Date.now()?qualification.processingHours:null,checkedAt:new Date().toISOString(),expiresAt:Date.now()+quoteCacheMs};
      if(pricing&&methods.length&&quantity!==1)value.unitMethods=shippingMethods(await cj('logistic/freightCalculate',access,{startCountryCode:from,endCountryCode:destination,products:[{vid:matched.vid,quantity:1}]}));
      }
      const methods=value.methods;
      if(pricing&&methods.length){
        // Destination prices are private scheduled writes, never public mutations.
        // A quote can enqueue a request; checkout waits for Shopify confirmation.
        const unitOptions=quantity===1?methods:value.unitMethods;
        const standard=cheapestMethod(unitOptions.filter(option=>methods.some(method=>method.name===option.name)));
        if(!standard)throw new Error('Standard unit shipping unavailable');
        const previous=await db.get('shipping/private/base-price/'+id.split('/').at(-1),{type:'json'});
        // Storefront prices already include the country's freight. Main-catalog
        // quotes must reuse the private merchant base, never add freight twice.
        const base=main?previous?.baseUnitPrice:baselineForSync(variant.price,previous);
        if(!base||base.currencyCode!=='EUR')throw new Error('Merchant base price not prepared');
        const fxKey='shipping/private/ecb-rates';
        let fx=await db.get(fxKey,{type:'json'});
        if(!fx||fx.refreshedAt<Date.now()-3600000){
          const response=await fetcher('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',{redirect:'error',signal:AbortSignal.timeout(6000)});
          if(!response.ok)throw new Error('Currency rates unavailable');
          fx={...parseEcbRates(await response.text()),refreshedAt:Date.now()};await db.setJSON(fxKey,fx);
        }
        let productCost;
        if(main){
          const costKey='shipping/private/cj-unit-cost/'+hash(variant.sku);
          let costRecord=await db.get(costKey,{type:'json'});
          if(costRecord?.sku!==variant.sku||costRecord?.expiresAt<=Date.now()){
            const detail=await cj('product/query?variantSku='+encodeURIComponent(variant.sku),await token(db));
            const exact=(detail?.variants||[]).filter(v=>v.variantSku===variant.sku&&v.vid);
            if(exact.length!==1)throw Error('Verified CJ product cost required');
            productCost=convertCost({amount:exact[0].variantSellPrice,currencyCode:'USD'},'USD');
            if(Number(productCost.amount)<=0)throw Error('Verified CJ product cost required');
            costRecord={sku:variant.sku,productCost,expiresAt:Date.now()+cacheMs};
            await db.setJSON(costKey,costRecord);
          }
          productCost=costRecord.productCost;
        }
        const unit=(main?mainCatalogPrice:includedPrice)({baseUnitPrice:base,supplierCost:standard.supplierCost,productCost,fx});
        const cents=BigInt(unit.lineTotal.amount.replace('.',''))*BigInt(quantity);
        const lineTotal={amount:(cents/100n)+'.'+String(cents%100n).padStart(2,'0'),currencyCode:base.currencyCode};
        const ready=await db.get('shipping/private/context-price/'+id.split('/').at(-1)+'/'+destination,{type:'json'});
        value.pricing={unitPrice:unit.lineTotal,lineTotal,includedShippingPerItem:unit.includedShipping,standardMethod:standard.name,policy:'standard_shipping_per_item',checkoutReady:ready?.profileConfirmed===true&&ready?.sku===variant.sku&&ready?.expiresAt>Date.now()&&ready?.price?.amount===unit.lineTotal.amount&&ready?.price?.currencyCode===base.currencyCode};
        if(!value.pricing.checkoutReady){
          await update(db,'shipping/private/context-queue',old=>({items:(old?.items||[]).some(i=>i.variantId===id&&i.destination===destination)?old.items:[...(old?.items||[]),{variantId:id,sku:variant.sku,browsing,category,destination,requestedAt:Date.now()}].slice(-100)}));
        }
      }
      if(value.status==='available')await db.setJSON(key,value);
      return reply(value);
    }catch(error){return reply({status:'temporarily_unavailable',methods:[],...(error.supplierCode!=null?{supplierCode:error.supplierCode,supplierStep:error.supplierStep}: {})},503);}
  }
  return async function(req,context={}) {
    if(req.method!=='GET')return handler(req,context);
    const url=new URL(req.url);
    if(url.searchParams.has('variant')){
      url.searchParams.set('from',url.searchParams.get('from')||url.searchParams.get('country')||'');
      url.searchParams.set('quantity',url.searchParams.get('quantity')||'1');
    }
    url.searchParams.sort();
    const key=url.origin+'?'+url.searchParams.toString();
    if(!pending.has(key)){
      const task=handler(req,context).finally(()=>pending.delete(key));
      pending.set(key,task);
    }
    return (await pending.get(key)).clone();
  };
}
