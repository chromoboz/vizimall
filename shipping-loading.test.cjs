const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const source=readFileSync('commerce.js','utf8');
const helper=source.slice(0,source.indexOf('(() => {'));
const query=(shipping='DE',quantity='1',from)=>new URLSearchParams({variant:'gid://shopify/ProductVariant/1',shipping,country:'DE',store:'tech',quantity,...(from?{from}:{})});
const quote=(destination='DE')=>({status:'available',destination,from:'DE',origins:['DE'],methods:[{name:'DHL',transport:'3-5',supplierCost:{amount:'0',currencyCode:'USD'}}],quantity:1,stockQuantity:10,checkedAt:new Date().toISOString(),expiresAt:Date.now()+6*3600000,pricing:{checkoutReady:true,unitPrice:{amount:'22.90',currencyCode:'EUR'},lineTotal:{amount:'22.90',currencyCode:'EUR'},standardMethod:'DHL'}});
function boot({saved=new Map(),fetcher,blocked=false}={}){
 let now=Date.now(),calls=[];
 const root={VIZIMALL_SHOPIFY:{domain:'example.myshopify.com'},localStorage:{getItem:k=>{if(blocked)throw Error('blocked');return saved.get(k)||null;},setItem:(k,v)=>{if(blocked)throw Error('blocked');saved.set(k,v);},removeItem:k=>saved.delete(k)},fetch:async(url)=>{calls.push(url);return fetcher?fetcher(url):Response.json(quote(new URL(url,'https://vizimall.com').searchParams.get('shipping')));}};
 const context={URLSearchParams,AbortSignal,Date:class extends Date {static now(){return now;}},Map,JSON,Promise};
 vm.runInNewContext(helper,context);
 return{client:context.createShippingQuoteClient(root),root,calls,saved,advance:ms=>{now+=ms;},context};
}
test('Browser deduplicates simultaneous requests and default/explicit warehouses',async()=>{
 const f=boot();
 await Promise.all([f.client.get(query()),f.client.get(query('DE','1','DE')),f.client.get(query())]);
 assert.equal(f.calls.length,1);
 await f.client.get(query());assert.equal(f.calls.length,1);
 await f.client.get(query('GR'));await f.client.get(query('DE','2'));await f.client.get(query('DE','1','NL'));
 assert.equal(f.calls.length,4);
});
test('Browser survives reload, expires after six hours, and revalidates prices sooner',async()=>{
 const f=boot();await f.client.get(query());
 const next=boot({saved:f.saved});await next.client.get(query());assert.equal(next.calls.length,0);
 f.advance(60001);assert.ok(f.client.read(query()));await f.client.get(query());assert.equal(f.calls.length,2);
 f.advance(6*3600000+1);assert.equal(f.client.read(query()),null);
});
test('Storage denial, malformed entries and failed requests allow retry',async()=>{
 const blocked=boot({blocked:true});await blocked.client.get(query());await blocked.client.get(query());assert.equal(blocked.calls.length,1);
 let attempts=0;
 const f=boot({fetcher:async()=>++attempts===1?Response.json({error:'busy'},{status:503}):Response.json(quote())});
 await assert.rejects(f.client.get(query()));await f.client.get(query());assert.equal(attempts,2);
 const corrupted=boot();await corrupted.client.get(query());
 for(const key of corrupted.saved.keys())corrupted.saved.set(key,'broken');
 const next=boot({saved:corrupted.saved});await next.client.get(query());assert.equal(next.calls.length,1);
});
class Node {
 constructor(tag,cls='',text=''){this.tagName=tag;this.className=cls;this.textContent=text;this.children=[];this.listeners={};this.attributes={};this.isConnected=true;this.value='';}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
 setAttribute(k,v){this.attributes[k]=v;}
 get firstChild(){return this.children[0]||this;}
 addEventListener(k,fn){this.listeners[k]=fn;}
 dispatchEvent(event){this.listeners[event.type]?.(event);this.events??=[];this.events.push(event);}
}
const tick=()=>new Promise(r=>setImmediate(r));
function productBoot(fetcher,discovery){
 const f=boot({fetcher:async url=>new URL(url,'https://vizimall.com').searchParams.get('check')==='destinations'?Response.json(discovery?discovery(new URL(url,'https://vizimall.com').searchParams):{status:'complete',destinations:['DE','GR'],expiresAt:Date.now()+6*3600000}):fetcher?fetcher(url):Response.json(quote(new URL(url,'https://vizimall.com').searchParams.get('shipping')))}),nodes=[];
 Object.assign(f.root,{VizimallDestinations:{codes:['DE','GR','US'],valid:code=>['DE','GR','US'].includes(code),name:c=>c},VizimallDelivery:{route:()=>({})},VizimallShipping:{remember:c=>c}});
 Object.assign(f.context,{window:f.root,country:'DE',shippingCountry:'DE',store:'tech',destination:{name:'DE'},storageKey:'',cartInitialized:true,cartReady:Promise.resolve(),cartWrites:Promise.resolve(),loadCart:async()=>{},tr:s=>s,money:p=>p.amount,shippingQuotes:f.client,element:(tag,cls,text)=>{const n=new Node(tag,cls,text);nodes.push(n);return n;},DOMParser:class{parseFromString(){return{body:{childNodes:[]}};}},document:{documentElement:{lang:'de'},body:{},visibilityState:'visible'},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},MutationObserver:class{observe(){}disconnect(){}},setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{}});
 const start=source.indexOf('  function productInformation('),end=source.indexOf('  function validLine(');
 vm.runInNewContext(source.slice(start,end),f.context);
 const information=f.context.productInformation({description:''},'tech');
 return{...f,information,nodes,selector:nodes.find(n=>n.attributes['aria-label']==='Product shipping country')};
}
test('Product opening requests Germany only; other countries load on selection and cache on return',async()=>{
 const f=productBoot();
 assert.equal(f.selector.value,'');assert.equal(f.selector.disabled,false);
 f.information.renderDelivery('gid://shopify/ProductVariant/1');await tick();
 assert.equal(f.calls.length,2);assert.equal(new URL(f.calls[1],'https://vizimall.com').searchParams.get('shipping'),'DE');
 assert.ok(f.calls[0].includes('cached=1'));assert.ok(!f.calls[1].includes('destinations'));
 assert.deepEqual(f.selector.children.map(n=>n.value),['','DE','GR']);
 f.selector.value='GR';await f.selector.listeners.change();await tick();assert.equal(f.calls.length,3);
 f.selector.value='DE';await f.selector.listeners.change();await tick();assert.equal(f.calls.length,3);
 assert.equal(f.information.delivery.attributes['aria-busy'],'false');
});
test('Country-control interaction never starts a supplier scan; only cached confirmations are listed',async()=>{
 const f=productBoot(undefined,params=>({status:params.has('cached')?'discovering':'complete',destinations:params.has('cached')?['DE']:['DE','GR'],expiresAt:Date.now()+6*3600000}));
 f.information.renderDelivery('gid://shopify/ProductVariant/1');await tick();
 assert.deepEqual(f.selector.children.map(n=>n.value),['','DE']);
 assert.equal(f.calls.length,2);
 assert.equal(f.selector.listeners.focus,undefined);assert.equal(f.selector.listeners.pointerdown,undefined);
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.selector.children.map(n=>n.value),['','DE']);
});
test('Confirmed lists are available synchronously after a reload, and expired lists are discarded',async()=>{
 const f=boot({fetcher:async()=>Response.json({status:'complete',destinations:['DE','GR'],expiresAt:Date.now()+6*3600000})});
 await f.client.destinations(query());
 const next=boot({saved:f.saved});assert.equal(next.client.readDestinations(query()).destinations.length,2);
 next.advance(6*3600000+1);assert.equal(next.client.readDestinations(query()),null);
});
test('A late previous-country response cannot overwrite the current shipping price',async()=>{
 const resolvers={};const f=productBoot(url=>new Promise(resolve=>{resolvers[new URL(url,'https://vizimall.com').searchParams.get('shipping')]=resolve;}));
 f.information.renderDelivery('gid://shopify/ProductVariant/1');
 f.selector.value='GR';await f.selector.listeners.change();
 resolvers.GR(Response.json(quote('GR')));await tick();
 resolvers.DE(Response.json(quote('DE')));await tick();
 const events=f.information.delivery.events.filter(e=>e.detail.quote?.status==='available');
 assert.deepEqual(events.map(e=>e.detail.quote.destination),['GR']);
});
test('Selecting an unsupported destination keeps the selector usable and blocks purchase',async()=>{
 const f=productBoot(url=>Response.json(new URL(url,'https://vizimall.com').searchParams.get('shipping')==='US'?{status:'unavailable',reason:'no_shipping_method',methods:[]}:quote()));
 f.information.renderDelivery('gid://shopify/ProductVariant/1');await tick();
 f.selector.value='US';await f.selector.listeners.change();await tick();
 assert.equal(f.selector.disabled,false);assert.equal(f.selector.value,'');
 assert.ok(!f.selector.children.some(n=>n.value==='US'));
 assert.equal(f.information.delivery.events.at(-1).detail.quote.status,'unavailable');
 f.selector.value='DE';await f.selector.listeners.change();await tick();
 assert.equal(f.information.delivery.events.at(-1).detail.quote.destination,'DE');
});
