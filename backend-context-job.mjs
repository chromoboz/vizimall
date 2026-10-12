import {store,update} from './backend-persistence.mjs';
import {createAdminPricingClientFromEnv} from './backend-price-sync.mjs';
import {createShippingHandler} from './backend-shipping.mjs';
import {baselineForSync} from './backend-included-pricing.mjs';
import {assertShippingScopes,supplierContext,prepareDestinationPrice,revokeDestination,profileFields} from './backend-context-pricing.mjs';
import {mainCatalogContext,launchDestinations} from './backend-cj-catalog.mjs';
import {sharedProfile} from './backend-cj-profiles.mjs';
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
        const data=await admin(`query($after:String){productVariants(first:100,after:$after){nodes{id sku product{tags status vendor productType title}} pageInfo{hasNextPage endCursor}}}`,{after:cursor?.after||null});
        const eligible=data.productVariants.nodes.filter(supplierContext);
        const products=new Map();
        for(const v of eligible){const key=v.product.id||v.id;const group=products.get(key)||[];group.push(v);products.set(key,group);}
        const variants=[];
        for(let row=0;row<eligible.length;row++)for(const group of products.values())if(group[row])variants.push(group[row]);
        if(data.productVariants.pageInfo.hasNextPage&&!data.productVariants.pageInfo.endCursor)throw Error('Incomplete catalog');
        const index=(cursor?.index||0)%Math.max(1,variants.length),variant=variants[index];
        const main=variant&&mainCatalogContext(variant.product),destinationIndex=main?(cursor?.destinationIndex||0)%launchDestinations.length:0;
        const nextVariant=!main||destinationIndex===launchDestinations.length-1;
        await db.setJSON('shipping/private/context-cursor',{queuedLast:false,destinationIndex:nextVariant?0:destinationIndex+1,index:nextVariant?(index+1>=variants.length?0:index+1):index,after:nextVariant&&index+1>=variants.length&&data.productVariants.pageInfo.hasNextPage?data.productVariants.pageInfo.endCursor:nextVariant&&index+1>=variants.length?null:cursor?.after||null});
        if(variant){const source=supplierContext(variant);job={variantId:variant.id,sku:variant.sku,...source,destination:main?launchDestinations[destinationIndex]:source.browsing};}
        else job=queue?.items?.[0]||oldRoute;
      }else await db.setJSON('shipping/private/context-cursor',{...cursor,queuedLast:true});
      if(!job){report.status='empty_catalog';return new Response(null,{status:204});}
      report.variantId=job.variantId;report.destination=job.destination;
      const fresh=await admin(`query($id:ID!,$country:CountryCode!){shop{currencyCode} node(id:$id){... on ProductVariant{id sku price product{id tags status vendor productType title} contextualPricing(context:{country:$country}){price{amount currencyCode}}}}}`,{id:job.variantId,country:job.destination});
      if(fresh.node?.sku!==job.sku||fresh.shop?.currencyCode!=='EUR'||JSON.stringify(supplierContext(fresh.node))!==JSON.stringify({browsing:job.browsing,category:job.category})){
        await revokeDestination({admin,db,variantId:job.variantId,destination:job.destination});
        await update(db,'shipping/private/context-queue',old=>({items:(old?.items||[]).filter(i=>i.variantId!==job.variantId)}));
        await update(db,'shipping/private/context-routes',old=>({items:(old?.items||[]).filter(i=>i.variantId!==job.variantId)}));
        report.status='product_changed';return new Response(null,{status:204});
      }
      const baseKey='shipping/private/base-price/'+job.variantId.split('/').at(-1);
      if(mainCatalogContext(fresh.node.product)){
        const holdKey='shipping/private/cj-held/'+fresh.node.product.id.split('/').at(-1);
        if(!await db.get(holdKey,{type:'json'})){
          report.stage='holding_product';
          if(fresh.node.product.status!=='DRAFT'){
            const change=await admin(`mutation($product:ProductUpdateInput!){productUpdate(product:$product){product{id status} userErrors{field message}}}`,{product:{id:fresh.node.product.id,status:'DRAFT'}});
            if(change.productUpdate?.userErrors?.length||change.productUpdate?.product?.status!=='DRAFT')throw Error('New CJ draft status was not confirmed');
            fresh.node.product.status='DRAFT';
          }
          const product=await admin(`query($id:ID!){node(id:$id){... on Product{id variants(first:100){nodes{id sku} pageInfo{hasNextPage}}}}}`,{id:fresh.node.product.id});
          if(product.node?.variants.pageInfo.hasNextPage)throw Error('Large CJ product requires a paginated import');
          report.stage='holding_location';
          const services=(await admin(`query{shop{fulfillmentServices{handle serviceName location{id}}}}`)).shop?.fulfillmentServices;
          const locations=[...new Set((services||[]).filter(s=>[s.handle,s.serviceName].some(n=>String(n||'').toLowerCase()==='cjdropshipping')).map(s=>s.location?.id).filter(Boolean))];
          if(locations.length!==1)throw Error('CJ fulfillment location requires review');
          report.stage='holding_profile';
          await sharedProfile({admin,fields:profileFields,locationId:locations[0],variantIds:product.node.variants.nodes.map(v=>v.id)});
          await db.setJSON(holdKey,{preparedAt:Date.now()});
        }
      }
      await update(db,baseKey,previous=>({baseUnitPrice:previous?.baseUnitPrice&&previous.globalLastSeen===fresh.node.price?previous.baseUnitPrice:baselineForSync({amount:fresh.node.price,currencyCode:'EUR'},previous),globalLastSeen:fresh.node.price,lastWritten:fresh.node.contextualPricing.price}));
      const quoteHandler=shippingFactory({dbFactory:async()=>db,fetcher:boundedFetch,env,storefrontConfig,pricing:true,catalogMetadata:true,allowUnavailable:true,variantResolver:async id=>{
        if(id!==fresh.node.id)throw Error('Variant changed');
        return {...fresh.node,availableForSale:true,price:{amount:fresh.node.price,currencyCode:'EUR'}};
      }});
      report.stage='supplier_quote';
      const response=await quoteHandler(new Request('https://vizimall.com/api/shipping?'+new URLSearchParams({variant:job.variantId,country:job.browsing,store:job.category,shipping:job.destination,quantity:'1'})));
      const quote=await response.json();
      if(!response.ok)throw Error('Supplier quote temporarily unavailable');
      if(quote.status!=='available'){
        await revokeDestination({admin,db,variantId:job.variantId,destination:job.destination});
        report.status='route_unavailable';
      }else{
        const prepared=await prepare({admin,db,variantId:job.variantId,expectedSku:job.sku,browsing:job.browsing,category:job.category,destination:job.destination,quote,onStage:stage=>{report.stage=stage;}});
        if(job.destination===job.browsing)await update(db,baseKey,previous=>({...previous,lastWritten:quote.pricing.unitPrice}));
        report.status=prepared?.profileConfirmed===false?'preparing_countries':'verified';
      }
      await update(db,'shipping/private/context-queue',old=>({items:(old?.items||[]).filter(i=>i.variantId!==job.variantId||i.destination!==job.destination)}));
      await update(db,'shipping/private/context-routes',old=>({items:[...(old?.items||[]).filter(i=>i.variantId!==job.variantId||i.destination!==job.destination),{...job,checkedAt:Date.now()}].slice(-2000)}));
    }catch(error){if(!locked&&error.message==='Worker already running')return new Response(null,{status:204});report.status='failed';report.error=error.message==='Shipping and market permission required'?error.message:'Destination configuration or supplier validation failed';if(['CJ fulfillment location requires review','CJ fulfillment groups require review','CJ fulfillment location was not confirmed','Ambiguous destination market','Destination market needs merchant review','Native country price not confirmed; shipping remains unchanged','Included shipping rate was not confirmed','Supplier quote temporarily unavailable'].includes(error.message))report.reason=error.message;if(error.missingScopes)report.missingScopes=error.missingScopes;if(error.adminErrors?.length)report.adminErrors=error.adminErrors;if(["CJ shared shipping profile was not confirmed","CJ holding profile must have no shipping rates","Large CJ product requires a paginated import","New CJ draft status was not confirmed"].includes(error.message))report.reason=error.message;}
    finally{
      if(locked){await db.setJSON('shipping/private/context-last-run',report);await db.setJSON('shipping/private/context-lease',{until:0});console.log(JSON.stringify(report));}
    }
    if(report.status==='failed')throw Error(report.error);
    return new Response(null,{status:204});
  };
}
