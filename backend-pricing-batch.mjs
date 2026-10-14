import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {store,update} from './backend-persistence.mjs';
import {createContextPricingJob} from './backend-context-job.mjs';
const origin='https://vizimall.com';
const leaseKey='shipping/private/pricing-batch-lease';
const sign=(secret,time)=>createHmac('sha256',secret).update('vizimall-pricing-batch:'+time).digest('hex');
export function batchAuthorized(request,secret,now=Date.now()){
  const time=request.headers.get('x-vizi-job-time'),signature=request.headers.get('x-vizi-job-signature');
  if(!secret||!/^\d{13}$/.test(time||'')||Math.abs(now-Number(time))>120000||!/^[a-f0-9]{64}$/.test(signature||''))return false;
  return timingSafeEqual(Buffer.from(signature),Buffer.from(sign(secret,time)));
}
export function createPricingDispatch({production=false,env=process.env,fetcher=fetch,dbFactory=store}={}){
  return async()=>{
    if(!production||env.VIZIMALL_NATIVE_SHIPPING_ENABLED!=='true')return new Response(null,{status:204});
    if(!env.SHOPIFY_ADMIN_CLIENT_SECRET)throw Error('Pricing connection unavailable');
    const db=await dbFactory(new Request(origin));
    if((await db.get(leaseKey,{type:'json'}))?.until>Date.now())return new Response(null,{status:204});
    const time=String(Date.now());
    const result=await fetcher(origin+'/.netlify/functions/pricing-batch-background',{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'x-vizi-job-time':time,'x-vizi-job-signature':sign(env.SHOPIFY_ADMIN_CLIENT_SECRET,time)}});
    if(result.status!==202)throw Error('Pricing background dispatch unavailable');
    return new Response(null,{status:204});
  };
}
export function createPricingBatch({production=false,env=process.env,dbFactory=store,jobFactory=createContextPricingJob,clock=Date.now,budgetMs=600000,maxSteps=48,...options}={}){
  return async request=>{
    if(!production||env.VIZIMALL_NATIVE_SHIPPING_ENABLED!=='true'||request.method!=='POST'||!batchAuthorized(request,env.SHOPIFY_ADMIN_CLIENT_SECRET,clock()))return new Response(null,{status:403});
    const db=await dbFactory(new Request(origin)),owner=randomUUID();
    try{await update(db,leaseKey,old=>{if(old?.until>clock())throw Error('Batch already running');return {owner,until:clock()+budgetMs+60000};});}
    catch(error){if(error.message==='Batch already running')return new Response(null,{status:204});throw error;}
    const run=jobFactory({...options,production:true,prioritizeImports:true,env,dbFactory:async()=>db});
    const started=clock();let completed=0,failed=0;
    try{
      for(let step=0;step<maxSteps&&clock()-started<budgetMs-30000;step++){
        if((await db.get('shipping/private/context-lease',{type:'json'}))?.until>clock())break;
        // Same durable country cursor and exact-price gate. No parallel writes
        // to shared profiles or bursts of supplier requests.
        try{await run();completed++;}catch{failed++;break;}
        const last=await db.get('shipping/private/context-last-run',{type:'json'});
        if(!last||['empty_catalog','idle'].includes(last.status))break;
      }
    }finally{
      await update(db,leaseKey,old=>old?.owner===owner?{until:0}:old);
      console.log(JSON.stringify({status:'pricing_batch_complete',completed,failed,durationMs:clock()-started}));
    }
    return new Response(null,{status:204});
  };
}
