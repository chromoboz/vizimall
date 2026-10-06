import { store, limit, hash, update } from './backend-persistence.mjs';
const countries = {DE:'germany',NL:'netherlands',FR:'france',GR:'greece',IT:'italy',PL:'poland',PT:'portugal',ES:'spain'};
const stores = ['tech','home','pets','beauty','fashion','kids','auto'];
const cjBase = 'https://developers.cjdropshipping.com/api2.0/v1/';
const cacheMs = 300000;
export function createShippingHandler({dbFactory=store, fetcher=fetch, env=process.env, storefrontConfig, probeSku='CJQT25986940004',probeSkus=[]}={}) {
  let tokenPending;
  async function cj(path, token, body) {
    const response = await fetcher(cjBase+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json',...(token?{'CJ-Access-Token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});
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
    const response=await fetcher(`https://${settings.domain}/api/${settings.apiVersion}/graphql.json`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Shopify-Storefront-Access-Token':settings.publicToken},body:JSON.stringify({query:`query($id:ID!,$country:CountryCode!) @inContext(country:$country){node(id:$id){... on ProductVariant{id sku availableForSale product{id tags}}}}`,variables:{id,country}})});
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
        if(![probeSku,...probeSkus].includes(sku)||!countries[destination])return reply({error:'Invalid supplier check'},400);
        const db=await dbFactory(req);
        const key='shipping/private/supplier-probe/'+hash(JSON.stringify([sku,destination]));
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
          const from=origins.includes(destination)?destination:origins[0];
          const options=await cj('logistic/freightCalculate',access,{startCountryCode:from,endCountryCode:destination,products:[{vid:matched.vid,quantity:1}]});
          const methods=(Array.isArray(options)?options:[]).filter(o=>typeof o.logisticName==='string'&&typeof o.logisticAging==='string'&&/^\d+(?:\s*-\s*\d+)?$/.test(o.logisticAging.trim())&&o.logisticPrice!==null&&o.logisticPrice!==''&&Number.isFinite(Number(o.logisticPrice))&&Number(o.logisticPrice)>=0).map(o=>({name:o.logisticName,transport:o.logisticAging,supplierCost:{amount:String(o.logisticPrice),currencyCode:'USD'}}));
          const observedMethods=(Array.isArray(options)?options:[]).map(o=>({name:typeof o.logisticName==='string'?o.logisticName.slice(0,200):null,transport:typeof o.logisticAging==='string'?o.logisticAging.slice(0,100):null,price:['string','number'].includes(typeof o.logisticPrice)?String(o.logisticPrice).slice(0,30):null}));
          value={status:methods.length?'available':'unavailable',origins,from,destination,methods,observedMethods};
        }
        value.sku=sku;value.quantity=1;value.checkedAt=new Date().toISOString();value.expiresAt=Date.now()+cacheMs;
        await db.setJSON(key,value);return reply(value);
      }
      // Report connectivity only; never expose the supplier credential or token.
      if (url.searchParams.get('check') === 'connection') {
        const db=await dbFactory(req);
        await limit(db,'shipping:connection:'+(context.ip||'unknown'),5,60000);
        await token(db);
        return reply({status:'connected'});
      }
      const id=url.searchParams.get('variant'), destination=url.searchParams.get('shipping'), browsing=url.searchParams.get('country'), category=url.searchParams.get('store'), requestedOrigin=url.searchParams.get('from');
      const quantity=Number(url.searchParams.get('quantity')||1);
      if(!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id||'')||!countries[destination]||!countries[browsing]||!stores.includes(category)||!Number.isInteger(quantity)||quantity<1||quantity>99||(requestedOrigin&&!countries[requestedOrigin]))return reply({error:'Invalid shipping request'},400);
      const db=await dbFactory(req);
      await limit(db,'shipping:'+ (context.ip||'unknown'),60,60000);
      // Recheck current Shopify eligibility before returning even a cached quote.
      const variant=await product(id,destination);
      if(!variant.availableForSale||![`country-${countries[browsing]}`,`country-${countries[destination]}`,`store-${category}`].every(tag=>variant.product.tags.includes(tag)))return reply({status:'unavailable',methods:[]});
      if(!/^CJ[A-Za-z0-9 _-]{3,190}$/.test(variant.sku||''))return reply({status:'not_mapped',methods:[]});
      const key='shipping/quotes/'+hash(JSON.stringify([id,variant.sku,destination,browsing,category,requestedOrigin,quantity]));
      const cached=await db.get(key,{type:'json'});if(cached?.expiresAt>Date.now())return reply(cached);
      await limit(db,'shipping:global',120,60000);
      const access=await token(db);
      const matched=await findVariant(variant.sku,access);
      if(!matched)return reply({status:'not_mapped',methods:[]});
      const stock=await cj('product/stock/queryBySku?sku='+encodeURIComponent(variant.sku),access);
      const origins=(Array.isArray(stock)?stock:[]).filter(s=>countries[s.countryCode]&&Number(s.totalInventoryNum)>=quantity).map(s=>s.countryCode);
      const from=requestedOrigin||(origins.includes(browsing)?browsing:origins.includes(destination)?destination:origins[0]);
      if(!from||!origins.includes(from))return reply({status:'unavailable',origins,methods:[]});
      const options=await cj('logistic/freightCalculate',access,{startCountryCode:from,endCountryCode:destination,products:[{vid:matched.vid,quantity}]});
      // A quote without both a price and a transit estimate must never qualify.
      const methods=(Array.isArray(options)?options:[]).filter(o=>typeof o.logisticName==='string'&&o.logisticName.trim()&&o.logisticName.length<=200&&typeof o.logisticAging==='string'&&/^\d+(?:\s*-\s*\d+)?$/.test(o.logisticAging.trim())&&o.logisticPrice!==null&&o.logisticPrice!==''&&Number.isFinite(Number(o.logisticPrice))&&Number(o.logisticPrice)>=0).map(o=>({name:o.logisticName,transport:o.logisticAging.trim(),supplierCost:{amount:String(o.logisticPrice),currencyCode:'USD'}}));
      const value={status:methods.length?'available':'unavailable',sku:variant.sku,origins,from,destination,quantity,methods,checkedAt:new Date().toISOString(),expiresAt:Date.now()+cacheMs};
      await db.setJSON(key,value);return reply(value);
    }catch(error){return reply({status:'temporarily_unavailable',methods:[],...(error.supplierCode!=null?{supplierCode:error.supplierCode,supplierStep:error.supplierStep}: {})},503);}
  };
}
