import { store } from './backend-persistence.mjs';
import { createAdminPricingClientFromEnv, syncVariantPrice } from './backend-price-sync.mjs';
import { createShippingHandler } from './backend-shipping.mjs';
import { parseEcbRates } from './backend-included-pricing.mjs';

// Invoked only as a Netlify scheduled function. No public HTTP price writer.
export function createPricingJob({ production=false, apply=false, prioritySku=null, storefrontConfig,
  dbFactory=store, fetcher=fetch, adminFactory=createAdminPricingClientFromEnv, env=process.env }={}) {
  return async function () {
    if (!production) return new Response(null,{status:204});
    const db=await dbFactory(new Request('https://vizimall.com'));
    const deadline=Date.now()+24000;
    const boundedFetch=(url,options={})=>fetcher(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(6000,deadline-Date.now())))])});
    const report={checkedAt:new Date().toISOString(),mode:apply?'apply':'preview',status:'checking'};
    let nextCursor;
    try {
      const admin=adminFactory({domain:storefrontConfig.domain,env,fetcher:boundedFetch});
      const cursor=await db.get('shipping/private/pricing-cursor',{type:'json'});
      const data=await admin(`query($after:String){shop{currencyCode} productVariants(first:100,after:$after){nodes{id sku product{tags status}} pageInfo{hasNextPage endCursor}}}`,{after:cursor?.after||null});
      if(data.shop?.currencyCode!=='EUR'||data.productVariants?.pageInfo?.hasNextPage&&!data.productVariants.pageInfo.endCursor) throw new Error('Catalog requires additional market or pagination configuration');
      const eligible=(data.productVariants?.nodes||[]).filter(v=>/^CJ[A-Za-z0-9 _-]{3,190}$/.test(v.sku||'') && v.product?.status!=='ARCHIVED' && v.product?.tags?.filter(t=>t.startsWith('country-')).join(',')==='country-germany');
      report.connection='connected';report.eligibleVariants=eligible.length;
      if(!eligible.length){nextCursor={index:0,after:data.productVariants?.pageInfo?.hasNextPage?data.productVariants.pageInfo.endCursor:null};report.status='no_eligible_variants';return new Response(null,{status:204});}
      const lastRun=await db.get('shipping/private/pricing-last-run',{type:'json'});
      const priorityIndex=apply&&lastRun?.mode!=='apply'?eligible.findIndex(v=>v.sku===prioritySku):-1;
      const index=priorityIndex>=0?priorityIndex:Number.isInteger(cursor?.index)?cursor.index%eligible.length:0;
      nextCursor=index+1>=eligible.length?{index:0,after:data.productVariants?.pageInfo?.hasNextPage?data.productVariants.pageInfo.endCursor:null}:{index:index+1,after:cursor?.after||null};
      const variant=eligible[index];report.sku=variant.sku;
      const quoteHandler=createShippingHandler({dbFactory:async()=>db,fetcher:boundedFetch,env,storefrontConfig,probeSkus:[variant.sku],catalogMetadata:true});
      const response=await quoteHandler(new Request('https://vizimall.com/api/shipping?check=supplier-sample&destination=DE&from=DE&sku='+encodeURIComponent(variant.sku)));
      const quote=await response.json();
      if(!response.ok||quote.status!=='available')throw new Error('Fresh CJ shipping unavailable; product price unchanged');
      const ratesResponse=await boundedFetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',{redirect:'error',signal:AbortSignal.timeout(6000)});
      if(!ratesResponse.ok)throw new Error('ECB currency rates unavailable; product price unchanged');
      const fx=parseEcbRates(await ratesResponse.text());
      const plan=await syncVariantPrice({admin,db,variantId:variant.id,expectedSku:variant.sku,quote,fx,apply});
      if(apply)await db.setJSON('shipping/private/context-price/'+variant.id.split('/').at(-1)+'/DE',{sku:variant.sku,price:plan.lineTotal,expiresAt:Date.now()+3600000,checkedAt:new Date().toISOString()});
      if(apply)await db.setJSON('shipping/private/qualification/'+variant.id.split('/').at(-1),{sku:variant.sku,processingHours:quote.processingHours||null,expiresAt:Date.now()+86400000});
      report.status=plan.applied?'updated':'verified';report.plan=plan;
    }catch(error){
      report.status='failed';
      // Controlled messages only: never log HTTP payloads, credentials or tokens.
      report.error=['Fresh CJ shipping unavailable; product price unchanged','ECB currency rates unavailable; product price unchanged','Catalog requires additional market or pagination configuration'].includes(error.message)?error.message:'Pricing connection or validation failed';
    }finally{
      if(nextCursor!==undefined)await db.setJSON('shipping/private/pricing-cursor',nextCursor);
      await db.setJSON('shipping/private/pricing-last-run',report);
      console.log(JSON.stringify(report));
    }
    if(report.status==='failed')throw new Error(report.error);
    return new Response(null,{status:204});
  };
}
