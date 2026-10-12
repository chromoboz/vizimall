import {store,update} from './backend-persistence.mjs';
import {createAdminPricingClientFromEnv} from './backend-price-sync.mjs';
import {createShippingHandler} from './backend-shipping.mjs';
import {baselineForSync,mainPricingPolicy} from './backend-included-pricing.mjs';
import {assertShippingScopes,supplierContext,prepareDestinationPrice,revokeDestination,profileFields} from './backend-context-pricing.mjs';
import {mainCatalogContext,launchDestinations} from './backend-cj-catalog.mjs';
import {sharedProfile} from './backend-cj-profiles.mjs';
// One bounded scheduled worker handles all supplier malls and destinations.
// Activation is explicit after the merchant approves the additional app scopes.
export function createContextPricingJob({production=false,prioritizeImports=false,storefrontConfig,env=process.env,dbFactory=store,fetcher=fetch,adminFactory=createAdminPricingClientFromEnv,prepare=prepareDestinationPrice,shippingFactory=createShippingHandler}={}){
  return async()=>{
    if(!production||env.VIZIMALL_NATIVE_SHIPPING_ENABLED!=='true')return new Response(null,{status:204});
    const db=await dbFactory(new Request('https://vizimall.com'));
    let locked=false,job,catalogAdvance;
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
      let cursor=await db.get('shipping/private/context-cursor',{type:'json'});
      if(cursor?.version!==3){cursor={version:3,index:0,destinationIndex:0,after:null,queuedLast:false,migrating:true};await db.setJSON('shipping/private/context-cursor',cursor);}
      // Alternate queued destination requests with catalog checks so new imports
      // and existing routes cannot starve behind visitor requests.
      const queued=queue?.items?.[0]||oldRoute;
      job=(cursor?.migrating&&(!queued||queued.browsing==='CN'))||cursor?.queuedLast?null:queued;
      if(prioritizeImports){
        // Oldest drafts first: publication of one option must not wait for all
        // options of older active products. Completed drafts leave this query.
        const pendingScan=await db.get('shipping/private/draft-import-scan',{type:'json'});
        const pending=await admin(`query($after:String){products(first:100,after:$after,query:"vendor:CJdropshipping status:draft",sortKey:CREATED_AT){nodes{id tags status vendor productType title variants(first:1){nodes{id sku selectedOptions{name value}}}} pageInfo{hasNextPage endCursor}}}`,{after:pendingScan?.after||null});
        for(const product of pending.products.nodes){
          if(!mainCatalogContext(product)||product.status!=='DRAFT')continue;
          if((await db.get('shipping/private/import-retry/'+product.id.split('/').at(-1),{type:'json'}))?.until>Date.now())continue;
          const variant=product.variants.nodes[0];
          const source=variant&&supplierContext({...variant,product});
          if(!source)continue;
          const records=await Promise.all(launchDestinations.map(d=>db.get('shipping/private/cj-candidate/'+variant.id.split('/').at(-1)+'/'+d,{type:'json'})));
          const missing=records.findIndex(r=>r?.sku!==variant.sku||r.policy!==mainPricingPolicy||r.expiresAt<=Date.now());
          job={variantId:variant.id,sku:variant.sku,...source,destination:launchDestinations[Math.max(0,missing)],importProductId:product.id};
          break;
        }
        if(!job?.importProductId){
          const page=pending.products.pageInfo;
          if(page?.hasNextPage&&!page.endCursor)throw Error('Incomplete draft import scan');
          await db.setJSON('shipping/private/draft-import-scan',{after:page?.hasNextPage?page.endCursor:null});
          // CJ may create ACTIVE imports. Discover those too, then the existing
          // hold/stock/cost checks put them in DRAFT before preparing prices.
          const scan=await db.get('shipping/private/import-scan',{type:'json'});
          const incoming=await admin(`query($after:String){products(first:50,after:$after,query:"vendor:CJdropshipping status:active",sortKey:CREATED_AT){nodes{id tags status vendor productType title variants(first:1){nodes{id sku selectedOptions{name value}}}} pageInfo{hasNextPage endCursor}}}`,{after:scan?.after||null});
          const held=await Promise.all(incoming.products.nodes.map(p=>db.get('shipping/private/cj-held/'+p.id.split('/').at(-1),{type:'json'})));
          for(let i=0;i<incoming.products.nodes.length;i++){
            const product=incoming.products.nodes[i],variant=product.variants.nodes[0];
            const source=variant&&supplierContext({...variant,product});
            if(held[i]||!source||!mainCatalogContext(product))continue;
            if((await db.get('shipping/private/import-retry/'+product.id.split('/').at(-1),{type:'json'}))?.until>Date.now())continue;
            job={variantId:variant.id,sku:variant.sku,...source,destination:launchDestinations[0],importProductId:product.id};break;
          }
          if(!job?.importProductId){
            const page=incoming.products.pageInfo;
            if(page.hasNextPage&&!page.endCursor)throw Error('Incomplete import scan');
            await db.setJSON('shipping/private/import-scan',{after:page.hasNextPage?page.endCursor:null});
          }
        }
      }
      if(!job){
        const data=await admin(`query($after:String){productVariants(first:100,after:$after){nodes{id sku selectedOptions{name value} product{id tags status vendor productType title}} pageInfo{hasNextPage endCursor}}}`,{after:cursor?.after||null});
        const eligible=data.productVariants.nodes.filter(supplierContext);
        const products=new Map();
        for(const v of eligible){const key=v.product.id||v.id;const group=products.get(key)||[];group.push(v);products.set(key,group);}
        for(const group of products.values()){
          const eu=group.findIndex(v=>mainCatalogContext(v.product)&&(v.selectedOptions||[]).some(o=>/electrical outlet|plug/i.test(o.name)&&o.value==='EU'));
          if(eu>0)group.unshift(...group.splice(eu,1));
        }
        const variants=[];
        for(let row=0;row<eligible.length;row++)for(const group of products.values())if(group[row])variants.push(group[row]);
        if(data.productVariants.pageInfo.hasNextPage&&!data.productVariants.pageInfo.endCursor)throw Error('Incomplete catalog');
        const index=(cursor?.index||0)%Math.max(1,variants.length),variant=variants[index];
        const main=variant&&mainCatalogContext(variant.product);
        let destinationIndex=0;
        if(main){
          const root='shipping/private/cj-candidate/'+variant.id.split('/').at(-1)+'/';
          const records=await Promise.all(launchDestinations.map(d=>db.get(root+d,{type:'json'})));
          const missing=records.findIndex(r=>r?.sku!==variant.sku||r.policy!==mainPricingPolicy||r.expiresAt<=Date.now());
          destinationIndex=missing<0?0:missing;
        }
        const nextVariant=!main;
        catalogAdvance={version:3,migrating:cursor.migrating&&index<1,queuedLast:false,destinationIndex:0,index:index+1>=variants.length?0:index+1,after:index+1>=variants.length&&data.productVariants.pageInfo.hasNextPage?data.productVariants.pageInfo.endCursor:index+1>=variants.length?null:cursor?.after||null};
        await db.setJSON('shipping/private/context-cursor',nextVariant?catalogAdvance:{...cursor,version:3,queuedLast:false,index,destinationIndex,after:cursor?.after||null});
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
        if(job.importProductId)await db.setJSON('shipping/private/import-retry/'+job.importProductId.split('/').at(-1),{until:Date.now()+600000});
        if(catalogAdvance)await db.setJSON('shipping/private/context-cursor',catalogAdvance);
      }else{
        const prepared=await prepare({admin,db,variantId:job.variantId,expectedSku:job.sku,browsing:job.browsing,category:job.category,destination:job.destination,quote,onStage:stage=>{report.stage=stage;}});
        if(job.destination===job.browsing)await update(db,baseKey,previous=>({...previous,lastWritten:quote.pricing.unitPrice}));
        report.status=prepared?.profileConfirmed===false?'preparing_countries':'verified';
        if(prepared?.profileConfirmed===true&&mainCatalogContext(fresh.node.product)&&fresh.node.product.status==='DRAFT'){
          report.stage='publish_verified_product';
          const published=await admin(`mutation($product:ProductUpdateInput!){productUpdate(product:$product){product{id status} userErrors{field message}}}`,{product:{id:fresh.node.product.id,status:'ACTIVE'}});
          if(published.productUpdate?.userErrors?.length||published.productUpdate?.product?.status!=='ACTIVE')throw Error('Verified CJ product publication was not confirmed');
        }
        if(prepared?.price)report.price=prepared.price;
        if(catalogAdvance&&prepared?.profileConfirmed===true)await db.setJSON('shipping/private/context-cursor',catalogAdvance);
      }
      await update(db,'shipping/private/context-queue',old=>({items:(old?.items||[]).filter(i=>i.variantId!==job.variantId||i.destination!==job.destination)}));
      await update(db,'shipping/private/context-routes',old=>({items:[...(old?.items||[]).filter(i=>i.variantId!==job.variantId||i.destination!==job.destination),{...job,checkedAt:Date.now()}].slice(-2000)}));
    }catch(error){if(!locked&&error.message==='Worker already running')return new Response(null,{status:204});report.status='failed';report.error=error.message==='Shipping and market permission required'?error.message:'Destination configuration or supplier validation failed';if(['CJ fulfillment location requires review','CJ fulfillment groups require review','CJ fulfillment location was not confirmed','Ambiguous destination market','Destination market needs merchant review','Native country price not confirmed; shipping remains unchanged','Included shipping rate was not confirmed','Supplier quote temporarily unavailable'].includes(error.message))report.reason=error.message;if(error.missingScopes)report.missingScopes=error.missingScopes;if(error.adminErrors?.length)report.adminErrors=error.adminErrors;if(["CJ shared shipping profile was not confirmed","CJ holding profile must have no shipping rates","Large CJ product requires a paginated import","New CJ draft status was not confirmed"].includes(error.message))report.reason=error.message;}
    finally{
      if(locked){if(report.status==='failed'&&job?.importProductId)await db.setJSON('shipping/private/import-retry/'+job.importProductId.split('/').at(-1),{until:Date.now()+600000});await db.setJSON('shipping/private/context-last-run',report);await db.setJSON('shipping/private/context-lease',{until:0});console.log(JSON.stringify(report));}
    }
    if(report.status==='failed')throw Error(report.error);
    return new Response(null,{status:204});
  };
}
