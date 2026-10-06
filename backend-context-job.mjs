import {store,update} from './backend-persistence.mjs';
import {createAdminPricingClientFromEnv} from './backend-price-sync.mjs';
import {createShippingHandler} from './backend-shipping.mjs';
import {baselineForSync} from './backend-included-pricing.mjs';
import {assertShippingScopes,supplierContext,prepareDestinationPrice,revokeDestination} from './backend-context-pricing.mjs';
// One bounded scheduled worker handles all supplier malls and destinations.
// Activation is explicit after the merchant approves the additional app scopes.
export function createContextPricingJob({production=false,storefrontConfig,env=process.env,dbFactory=store,fetcher=fetch,adminFactory=createAdminPricingClientFromEnv,prepare=prepareDestinationPrice,shippingFactory=createShippingHandler}={}){
  return async()=>{
    if(!production||env.VIZIMALL_NATIVE_SHIPPING_ENABLED!=='true')return new Response(null,{status:204});
    const db=await dbFactory(new Request('https://vizimall.com'));
    let locked=false,job;
    const report={status:'checking',checkedAt:new Date().toISOString()};
    const deadline=Date.now()+26000;
    const boundedFetch=(url,options={})=>fetcher(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(6000,deadline-Date.now())))])});
    try{
      await update(db,'shipping/private/context-lease',old=>{if(old?.until>Date.now())throw Error('Worker already running');return{until:Date.now()+35000};});locked=true;
      const admin=adminFactory({domain:storefrontConfig.domain,env,fetcher:boundedFetch});
      await assertShippingScopes(admin);
      const queue=await db.get('shipping/private/context-queue',{type:'json'});
      const routes=await db.get('shipping/private/context-routes',{type:'json'});
      const oldRoute=(routes?.items||[]).find(r=>r.checkedAt<Date.now()-1800000);
      const cursor=await db.get('shipping/private/context-cursor',{type:'json'});
      // Alternate queued destination requests with catalog checks so new imports
      // and existing routes cannot starve behind visitor requests.
      job=cursor?.queuedLast?null:queue?.items?.[0]||oldRoute;
      if(!job){
        const data=await admin(`query($after:String){productVariants(first:100,after:$after){nodes{id sku product{tags status}} pageInfo{hasNextPage endCursor}}}`,{after:cursor?.after||null});
        const variants=data.productVariants.nodes.filter(supplierContext);
        if(data.productVariants.pageInfo.hasNextPage&&!data.productVariants.pageInfo.endCursor)throw Error('Incomplete catalog');
        const index=(cursor?.index||0)%Math.max(1,variants.length),variant=variants[index];
        await db.setJSON('shipping/private/context-cursor',{queuedLast:false,index:index+1>=variants.length?0:index+1,after:index+1>=variants.length&&data.productVariants.pageInfo.hasNextPage?data.productVariants.pageInfo.endCursor:index+1>=variants.length?null:cursor?.after||null});
        if(variant){const source=supplierContext(variant);job={variantId:variant.id,sku:variant.sku,...source,destination:source.browsing};}
        else job=queue?.items?.[0]||oldRoute;
      }else await db.setJSON('shipping/private/context-cursor',{...cursor,queuedLast:true});
      if(!job){report.status='empty_catalog';return new Response(null,{status:204});}
      report.variantId=job.variantId;report.destination=job.destination;
      const fresh=await admin(`query($id:ID!,$country:CountryCode!){shop{currencyCode} node(id:$id){... on ProductVariant{id sku price product{tags status} contextualPricing(context:{country:$country}){price{amount currencyCode}}}}}`,{id:job.variantId,country:job.browsing});
      if(fresh.node?.sku!==job.sku||fresh.shop?.currencyCode!=='EUR'||JSON.stringify(supplierContext(fresh.node))!==JSON.stringify({browsing:job.browsing,category:job.category})){
        await revokeDestination({admin,db,variantId:job.variantId,destination:job.destination});
        await update(db,'shipping/private/context-queue',old=>({items:(old?.items||[]).filter(i=>i.variantId!==job.variantId)}));
        await update(db,'shipping/private/context-routes',old=>({items:(old?.items||[]).filter(i=>i.variantId!==job.variantId)}));
        report.status='product_changed';return new Response(null,{status:204});
      }
      const baseKey='shipping/private/base-price/'+job.variantId.split('/').at(-1);
      await update(db,baseKey,previous=>({baseUnitPrice:previous?.baseUnitPrice&&previous.globalLastSeen===fresh.node.price?previous.baseUnitPrice:baselineForSync({amount:fresh.node.price,currencyCode:'EUR'},previous),globalLastSeen:fresh.node.price,lastWritten:fresh.node.contextualPricing.price}));
      const quoteHandler=shippingFactory({dbFactory:async()=>db,fetcher:boundedFetch,env,storefrontConfig,pricing:true,catalogMetadata:true,allowUnavailable:true});
      const response=await quoteHandler(new Request('https://vizimall.com/api/shipping?'+new URLSearchParams({variant:job.variantId,country:job.browsing,store:job.category,shipping:job.destination,quantity:'1'})));
      const quote=await response.json();
      if(!response.ok)throw Error('Supplier quote temporarily unavailable');
      if(quote.status!=='available'){
        await revokeDestination({admin,db,variantId:job.variantId,destination:job.destination});
        report.status='route_unavailable';
      }else{
        await prepare({admin,db,variantId:job.variantId,expectedSku:job.sku,browsing:job.browsing,category:job.category,destination:job.destination,quote});
        if(job.destination===job.browsing)await update(db,baseKey,previous=>({...previous,lastWritten:quote.pricing.unitPrice}));
        report.status='verified';
      }
      await update(db,'shipping/private/context-queue',old=>({items:(old?.items||[]).filter(i=>i.variantId!==job.variantId||i.destination!==job.destination)}));
      await update(db,'shipping/private/context-routes',old=>({items:[...(old?.items||[]).filter(i=>i.variantId!==job.variantId||i.destination!==job.destination),{...job,checkedAt:Date.now()}].slice(-2000)}));
    }catch(error){report.status='failed';report.error=error.message==='Shipping and market permission required'?error.message:'Destination configuration or supplier validation failed';if(error.missingScopes)report.missingScopes=error.missingScopes;}
    finally{
      if(locked){await db.setJSON('shipping/private/context-last-run',report);await db.setJSON('shipping/private/context-lease',{until:0});console.log(JSON.stringify(report));}
    }
    if(report.status==='failed')throw Error(report.error);
    return new Response(null,{status:204});
  };
}
