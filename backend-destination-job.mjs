import {store,hash,update} from './backend-persistence.mjs';
import {createShippingHandler} from './backend-shipping.mjs';
import {enqueueDestinationDiscoveries} from './backend-destinations.mjs';

export function createDestinationJob({production=false,env=process.env,storefrontConfig,dbFactory=store,shippingFactory=createShippingHandler,fetcher=fetch}={}) {
  return async()=>{
    if(!production||!env.CJ_API_KEY)return new Response(null,{status:204});
    const db=await dbFactory(new Request('https://vizimall.com'));
    const deadline=Date.now()+26000;
    const boundedFetch=(url,options={})=>fetcher(url,{...options,signal:AbortSignal.any([...(options.signal?[options.signal]:[]),AbortSignal.timeout(Math.max(1,Math.min(6000,deadline-Date.now())))])});
    let locked=false;
    try {
      // Keep supplier work behind the existing private price/stock worker.
      const pricing=await db.get('shipping/private/context-lease',{type:'json'});
      if(pricing?.until>Date.now())return new Response(null,{status:204});
      await update(db,'shipping/private/discovery-worker',old=>{
        if(old?.until>Date.now())throw Error('Worker already running');
        return {until:Date.now()+35000};
      });locked=true;
      // Pricing discovers new imports even before any visitor opens them.
      const routes=await db.get('shipping/private/context-routes',{type:'json'});
      const unique=new Map((routes?.items||[]).map(r=>[r.variantId+'|'+r.sku+'|'+r.browsing,r]));
      if(unique.size)await enqueueDestinationDiscoveries(db,[...unique.values()].map(route=>({variantId:route.variantId,sku:route.sku,browsing:route.browsing,category:route.category,quantity:1})));
      const queue=await db.get('shipping/private/discovery-queue',{type:'json'});
      for(const job of [...(queue?.items||[])].sort((a,b)=>a.lastRun-b.lastRun)){
        const key='shipping/private/destinations/'+hash(JSON.stringify([job.variantId,job.sku,job.browsing,job.quantity]));
        const state=await db.get(key,{type:'json'});
        if(state?.expiresAt>Date.now()&&state.checked.length+(state.deferred?.length||0)===globalThis.VizimallDestinations.codes.length)continue;
        await update(db,'shipping/private/discovery-queue',old=>({items:(old?.items||[]).map(i=>i.identity===job.identity?{...i,lastRun:Date.now()}:i)}));
        const handler=shippingFactory({dbFactory:async()=>db,env,storefrontConfig,allowUnavailable:true,fetcher:boundedFetch,discoveryBudgetMs:8000});
        const response=await handler(new Request('https://vizimall.com/.netlify/functions/shipping?'+new URLSearchParams({check:'destinations',variant:job.variantId,country:job.browsing,store:job.category,shipping:job.browsing,quantity:String(job.quantity)})));
        const result=await response.json();
        const summary={variantId:job.variantId,status:response.ok?result.status:'temporarily_unavailable',checkedAt:new Date().toISOString(),confirmed:result.destinations?.length||0};
        await db.setJSON('shipping/private/discovery-last-run',summary);
        console.log('Shipping country preparation',JSON.stringify(summary));
        break; // One bounded supplier batch per invocation.
      }
      return new Response(null,{status:204});
    } catch(error) {
      if(error.message!=='Worker already running')await db.setJSON('shipping/private/discovery-last-run',{status:'temporarily_unavailable',checkedAt:new Date().toISOString()});
      return new Response(null,{status:204});
    } finally {
      if(locked)await db.setJSON('shipping/private/discovery-worker',{until:0});
    }
  };
}
