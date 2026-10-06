import { store, limit, hash, update } from './backend-persistence.mjs';
import './shipping-destinations.js';
import { discoverDestinations } from './backend-destinations.mjs';
import { baselineForSync, cheapestMethod, includedPrice, parseEcbRates, shippingMethods } from './backend-included-pricing.mjs';
const countries = {DE:'germany',NL:'netherlands',FR:'france',GR:'greece',IT:'italy',PL:'poland',PT:'portugal',ES:'spain'};
const stores = ['tech','home','pets','beauty','fashion','kids','auto'];
const cjBase = 'https://developers.cjdropshipping.com/api2.0/v1/';
const cacheMs = 300000;
export function createShippingHandler({dbFactory=store, fetcher=fetch, env=process.env, storefrontConfig, probeSku='CJQT25986940004',probeSkus=[],pricing=false,catalogMetadata=false,allowUnavailable=false,supplierPacingMs=1100}={}) {
  let tokenPending, supplierDb;
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
    const settings=storefrontConfig;
    const response=await fetcher(`https://${settings.domain}/api/${settings.apiVersion}/graphql.json`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':settings.publicToken},body:JSON.stringify({query:`query($id:ID!,$country:CountryCode!) @inContext(country:$country){node(id:$id){... on ProductVariant{id sku availableForSale price{amount currencyCode} product{id tags}}}}`,variables:{id,country}})});
    const body=await response.json();if(!response.ok||body.errors||!body.data?.node)throw new Error('Product unavailable');
    return body.data.node;
  }
  return async function handler(req,context={}) {
    const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    if(req.method!=='GET')return reply({error:'Method not allowed'},405);
    if(!env.CJ_API_KEY)return reply({status:'not_connected',methods:[]});
    try {
      const url=new URL(req.url);
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
      const variant=await product(id,browsing);
      if((!variant.availableForSale&&!allowUnavailable&&url.searchParams.get('check')!=='destinations')||![`country-${countries[browsing]}`,`store-${category}`].every(tag=>variant.product.tags.includes(tag)))return reply({status:'unavailable',methods:[]});
      if(!/^CJ[A-Za-z0-9 _-]{3,190}$/.test(variant.sku||''))return reply({status:'not_mapped',methods:[]});
      const key='shipping/quotes/'+hash(JSON.stringify([id,variant.sku,destination,browsing,category,requestedOrigin,quantity]));
      const cached=await db.get(key,{type:'json'});if(cached?.expiresAt>Date.now()&&!pricing)return reply(cached);
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
        return reply(await discoverDestinations({db,key:discoveryKey,codes:globalThis.VizimallDestinations.codes,priority:[from,destination,'GR','GB','US','FR','NL','IT','ES','PL','PT'],probe:async(code,timeoutMs)=>{
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
      const value={status:methods.length?'available':'unavailable',...(methods.length?{}:{reason:'no_shipping_method'}),sku:variant.sku,origins,from,destination,quantity,methods,stockQuantity:Math.max(...originStock.map(s=>Number(s.totalInventoryNum))),stockSource:'CJ reported warehouse inventory',processingHours:qualification?.sku===variant.sku&&qualification?.expiresAt>Date.now()?qualification.processingHours:null,checkedAt:new Date().toISOString(),expiresAt:Date.now()+cacheMs};
      if(pricing&&methods.length){
        // Destination prices are private scheduled writes, never public mutations.
        // A quote can enqueue a request; checkout waits for Shopify confirmation.
        const unitOptions=quantity===1?methods:shippingMethods(await cj('logistic/freightCalculate',access,{startCountryCode:from,endCountryCode:destination,products:[{vid:matched.vid,quantity:1}]}));
        const standard=cheapestMethod(unitOptions.filter(option=>methods.some(method=>method.name===option.name)));
        if(!standard)throw new Error('Standard unit shipping unavailable');
        const previous=await db.get('shipping/private/base-price/'+id.split('/').at(-1),{type:'json'});
        const base=baselineForSync(variant.price,previous);
        const fxKey='shipping/private/ecb-rates';
        let fx=await db.get(fxKey,{type:'json'});
        if(!fx||fx.refreshedAt<Date.now()-3600000){
          const response=await fetcher('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',{redirect:'error',signal:AbortSignal.timeout(6000)});
          if(!response.ok)throw new Error('Currency rates unavailable');
          fx={...parseEcbRates(await response.text()),refreshedAt:Date.now()};await db.setJSON(fxKey,fx);
        }
        const unit=includedPrice({baseUnitPrice:base,supplierCost:standard.supplierCost,fx});
        const cents=BigInt(unit.lineTotal.amount.replace('.',''))*BigInt(quantity);
        const lineTotal={amount:(cents/100n)+'.'+String(cents%100n).padStart(2,'0'),currencyCode:base.currencyCode};
        const ready=await db.get('shipping/private/context-price/'+id.split('/').at(-1)+'/'+destination,{type:'json'});
        value.pricing={unitPrice:unit.lineTotal,lineTotal,includedShippingPerItem:unit.includedShipping,standardMethod:standard.name,policy:'standard_shipping_per_item',checkoutReady:ready?.profileConfirmed===true&&ready?.sku===variant.sku&&ready?.expiresAt>Date.now()&&ready?.price?.amount===unit.lineTotal.amount&&ready?.price?.currencyCode===base.currencyCode};
        if(!value.pricing.checkoutReady){
          await update(db,'shipping/private/context-queue',old=>({items:(old?.items||[]).some(i=>i.variantId===id&&i.destination===destination)?old.items:[...(old?.items||[]),{variantId:id,sku:variant.sku,browsing,category,destination,requestedAt:Date.now()}].slice(-100)}));
        }
      }
      await db.setJSON(key,value);return reply(value);
    }catch(error){return reply({status:'temporarily_unavailable',methods:[],...(error.supplierCode!=null?{supplierCode:error.supplierCode,supplierStep:error.supplierStep}: {})},503);}
  };
}
