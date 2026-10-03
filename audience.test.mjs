import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { consentVersion, analyticsInput, recordMeasurement, measurementReport, newsletterRecord, newsletterStatus, newsletterReport, unsubscribeToken, purgeAudience } from './backend-audience.mjs';
import { createHandler } from './backend-customer.mjs';
import { hash } from './backend-persistence.mjs';
class DB {
  values = new Map(); count = 0;
  async get(key) { return structuredClone(this.values.get(key)?.data ?? null); }
  async getWithMetadata(key) { return structuredClone(this.values.get(key) ?? null); }
  async setJSON(key,data,opts={}) { const old=this.values.get(key); if(opts.onlyIfNew&&old||opts.onlyIfMatch&&old?.etag!==opts.onlyIfMatch)return{modified:false}; this.values.set(key,{data:structuredClone(data),etag:String(++this.count)});return{modified:true}; }
  async delete(key) { this.values.delete(key); }
  async list({prefix}) {return{blobs:[...this.values.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
}
const measurement = () => ({version:consentVersion,analytics:true,path:'/mall',session:randomUUID(),event:randomUUID()});
const customer = {id:'gid://shopify/Customer/1',emailAddress:{emailAddress:'verified@example.invalid'}};
test('Measurement requires explicit current consent, rejects sensitive routes and stores no identity',async()=>{
  const input=measurement();assert.throws(()=>analyticsInput({...input,analytics:false}));assert.throws(()=>analyticsInput({...input,version:'old'}));
  for(const path of ['/api/callback','/mall?email=private@example.invalid','/account?code=secret'])assert.throws(()=>analyticsInput({...input,path}));
  const db=new DB();await recordMeasurement(db,{...input,email:'private@example.invalid',ip:'1.2.3.4',referrer:'secret',customerId:'secret'});
  const stored=JSON.stringify([...db.values]);for(const secret of ['private@example.invalid','1.2.3.4','secret',input.session])assert.equal(stored.includes(secret),false);
});
test('Repeated events are idempotent, concurrent pageviews retained and sessions separated by UTC day',async()=>{
  const db=new DB(),first=measurement(),now=new Date('2026-10-03T12:00:00Z');
  await Promise.all([recordMeasurement(db,first,now),recordMeasurement(db,first,now),recordMeasurement(db,{...first,event:randomUUID()},now)]);
  let report=await measurementReport(db,now);assert.equal(report.days[0].sessions,1);assert.equal(report.days[0].pageviews,2);
  await recordMeasurement(db,first,new Date('2026-10-04T12:00:00Z'));report=await measurementReport(db,new Date('2026-10-04T12:00:00Z'));assert.equal(report.days.length,2);
});
test('Verified newsletter requires separate explicit consent and never trusts a submitted email',async()=>{
  const db=new DB();assert.equal((await newsletterStatus(db,customer)).status,'not-subscribed');
  await assert.rejects(newsletterRecord(db,customer,{action:'subscribe',consent:false,version:consentVersion}));
  await assert.rejects(newsletterRecord(db,customer,{action:'subscribe',consent:true,version:'old'}));
  const input={action:'subscribe',consent:true,version:consentVersion,email:'attacker@example.invalid'};
  await Promise.all([newsletterRecord(db,customer,input),newsletterRecord(db,customer,input)]);
  const report=await newsletterReport(db);assert.equal(report.subscribed.length,1);assert.equal(report.subscribed[0].email,'verified@example.invalid');
  assert.equal(JSON.stringify([...db.values]).includes('attacker@example.invalid'),false);
});
test('Withdrawal works without login and removed subscribers cannot enter current exports; fresh consent is required to rejoin',async()=>{
  const db=new DB(),now=new Date('2026-10-03T12:00:00Z');
  const record=await newsletterRecord(db,customer,{action:'subscribe',consent:true,version:consentVersion},now);
  await unsubscribeToken(db,record.unsubscribeToken,now);await unsubscribeToken(db,record.unsubscribeToken,now);
  assert.equal((await newsletterReport(db)).subscribed.length,0);assert.equal((await newsletterStatus(db,customer)).status,'unsubscribed');
  await assert.rejects(newsletterRecord(db,customer,{action:'subscribe',consent:false,version:consentVersion}));
  await newsletterRecord(db,customer,{action:'subscribe',consent:true,version:consentVersion},now);assert.equal((await newsletterReport(db)).subscribed.length,1);
});
test('Daily retention removes expired metrics and withdrawn contact details but preserves suppression and active subscriptions',async()=>{
  const db=new DB(),now=new Date('2026-10-03T12:00:00Z');await recordMeasurement(db,measurement(),now);
  await newsletterRecord(db,customer,{action:'subscribe',consent:true,version:consentVersion},now);await newsletterRecord(db,customer,{action:'unsubscribe'},now);
  const other={id:'gid://shopify/Customer/2',emailAddress:{emailAddress:'active@example.invalid'}};await newsletterRecord(db,other,{action:'subscribe',consent:true,version:consentVersion},now);
  await purgeAudience(db,new Date('2026-11-05T12:00:00Z'));await purgeAudience(db,new Date('2026-11-06T12:00:00Z'));
  assert.equal(JSON.stringify([...db.values]).includes('verified@example.invalid'),false);assert.equal((await newsletterStatus(db,customer)).status,'unsubscribed');
  assert.equal((await newsletterReport(db)).subscribed.length,1);assert.equal((await measurementReport(db,new Date('2026-11-06T12:00:00Z'))).days.length,0);
});
test('Audience endpoints deny public admin reads, foreign origins and unverified email registration',async()=>{
  const db=new DB(),token='a'.repeat(43);await db.setJSON(`sessions/${hash(token)}`,{token:'private',expiresAt:Date.now()+100000});
  const handler=createHandler({storeFactory:async()=>db,dataProvider:async()=>({customer,orders:[]})});
  assert.equal((await handler(new Request('https://vizimall.com/api/audience-admin'))).status,401);
  assert.equal((await handler(new Request('https://vizimall.com/api/audience-admin',{headers:{cookie:`__Host-vizi-session=${token}`}}))).status,404);
  assert.equal((await handler(new Request('https://vizimall.com/api/measure',{method:'POST',headers:{origin:'https://attacker.test','content-type':'application/json'},body:JSON.stringify(measurement())}))).status,400);
  assert.equal((await handler(new Request('https://vizimall.com/api/newsletter',{method:'POST',headers:{origin:'https://vizimall.com','content-type':'application/json'},body:JSON.stringify({email:'fake@example.invalid',consent:true,version:consentVersion})}))).status,401);
});
function browserHarness(source,storage=new Map()) {
  const nodes=[],requests=[],sessions=new Map(),listeners={};
  class Element {constructor(tag){this.tag=tag;this.children=[];nodes.push(this);}append(...items){this.children.push(...items);}setAttribute(){}focus(){}}
  const backing={getItem:key=>storage.get(key)||null,setItem:(key,val)=>storage.set(key,val),removeItem:key=>storage.delete(key)};
  const session={getItem:key=>sessions.get(key)||null,setItem:(key,val)=>sessions.set(key,val),removeItem:key=>sessions.delete(key)};
  const sandbox={document:{createElement:tag=>new Element(tag),body:new Element('body')},location:{pathname:'/mall.html'},crypto:{randomUUID},Date,JSON,localStorage:backing,sessionStorage:session,AbortController,fetch:async(path,input)=>{requests.push({path,input});return{};},addEventListener:(type,fn)=>listeners[type]=fn};
  vm.runInNewContext(source,sandbox);return{requests,sessions,storage,listeners,button:text=>nodes.find(node=>node.tag==='button'&&node.textContent===text),nodes};
}
test('Browser makes no optional request before consent or after rejection, measures only on accept and supports later withdrawal',async()=>{
  const source=await readFile('consent.js','utf8');const browser=browserHarness(source);assert.equal(browser.requests.length,0);assert.equal(browser.sessions.size,0);
  browser.button('Reject optional measurement').onclick();assert.equal(browser.requests.length,0);
  const reload=browserHarness(source,browser.storage);assert.equal(reload.requests.length,0);reload.button('Cookie preferences').onclick();reload.button('Accept optional measurement').onclick();
  assert.equal(reload.requests.length,1);const payload=JSON.parse(reload.requests[0].input.body);assert.deepEqual(Object.keys(payload).sort(),['analytics','event','path','session','version']);assert.equal(reload.requests[0].input.credentials,'omit');
  reload.button('Reject optional measurement').onclick();assert.equal(reload.sessions.size,0);assert.equal(browserHarness(source,reload.storage).requests.length,0);
});
