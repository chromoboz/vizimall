import {update,random} from './backend-persistence.mjs';
// Only successful freight quotes populate the public product destination list.
// Work is bounded and shared between visitors; transient failures stay pending.
export async function discoverDestinations({db,key,codes,priority=[],probe,now=()=>Date.now(),batchSize=12,budgetMs=14000}){
 const owner=random(),started=now(),valid=new Set(codes);
 const empty=()=>({checked:[],available:[],failures:{},attempts:{},deferred:[],expiresAt:started+6*3600000});
 const summary=s=>({status:s.checked.length+(s.deferred?.length||0)===codes.length?'complete':'discovering',unverified:(s.deferred?.length||0),destinations:s.available.filter(c=>valid.has(c)),checked:s.checked.length,total:codes.length,expiresAt:s.expiresAt,retryAfterMs:8000});
 let state=await db.get(key,{type:'json'});
 if(state?.expiresAt>started&&state.checked.length+(state.deferred?.length||0)===codes.length)return summary(state);
 try{state=await update(db,key,old=>{const s=old?.expiresAt>started?old:empty();if(s.leaseUntil>started)throw Error('Discovery in progress');return{...s,owner,leaseUntil:started+30000};});}
 catch(error){if(error.message!=='Discovery in progress')throw error;return summary(await db.get(key,{type:'json'})||empty());}
 const checked=new Set(state.checked),available=new Set(state.available),failures={...state.failures},attempts={...state.attempts},deferred=new Set(state.deferred||[]);
 const ordered=[...new Set([...priority.filter(c=>valid.has(c)),...codes])];
 const pending=ordered.filter(c=>!checked.has(c)&&!deferred.has(c)&&!(failures[c]>started-30000)).slice(0,batchSize);
 let index=0;
 try{
  await Promise.all(Array.from({length:1},async()=>{
   while(index<pending.length&&now()<started+budgetMs){
    const code=pending[index++];
    try{const canShip=await probe(code,Math.max(1,started+budgetMs-now()));checked.add(code);delete failures[code];if(canShip)available.add(code);else available.delete(code);}
    catch{failures[code]=now();attempts[code]=(attempts[code]||0)+1;if(attempts[code]>=3)deferred.add(code);}
   }
  }));
 }finally{
  state=await update(db,key,old=>old?.owner===owner?{...old,checked:[...checked],available:[...available],failures,attempts,deferred:[...deferred],leaseUntil:0,owner:null}:old);
 }
 return summary(state);
}
