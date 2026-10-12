const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync('shipping-country.js','utf8');
function boot({url='https://vizimall.com/search.html',saved=[],detected='GR'}={}){
 const values=new Map(saved),calls=[];
 const localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 const window={VizimallDestinations:{codes:['DE','GR','FR','US'],name:code=>code},VizimallLocale:{language:'en'},addEventListener:()=>{}};
 const document={documentElement:{dataset:{}},querySelectorAll:()=>[],addEventListener:()=>{}};
 const context={window,document,localStorage,location:{href:url,assign:()=>{}},history:{state:null,replaceState:()=>{}},URL,AbortSignal,fetch:async uri=>{calls.push(uri);return{ok:true,json:async()=>({country:detected})};}};
 vm.runInNewContext(source,context);
 return{window,values,calls};
}
test('First visitor gets coarse IP country before storefront loads, without storing IP or location',async()=>{
 const b=boot();await b.window.VizimallShipping.ready;
 assert.equal(b.window.VizimallShipping.country,'GR');assert.equal(b.calls.length,1);
 assert.deepEqual([...b.values.keys()].sort(),['vizimall-shipping-country-source-v1','vizimall-shipping-country-v1']);
});
test('Explicit delivery selection and remembered manual choices override IP',async()=>{
 for(const config of [{url:'https://vizimall.com/search.html?shipping=DE'},{saved:[['vizimall-shipping-country-v1','FR']]}]){
   const b=boot(config);await b.window.VizimallShipping.ready;assert.equal(b.calls.length,0);
   assert.equal(b.window.VizimallShipping.country,config.url?'DE':'FR');
 }
});
test('Remembered geolocation is refreshed and failed detection stays editable',async()=>{
 const b=boot({saved:[['vizimall-shipping-country-v1','DE'],['vizimall-shipping-country-source-v1','geo']]});
 await b.window.VizimallShipping.ready;assert.equal(b.window.VizimallShipping.country,'GR');
 const unknown=boot({detected:null});await unknown.window.VizimallShipping.ready;
 assert.equal(unknown.window.VizimallShipping.country,'DE');unknown.window.VizimallShipping.remember('FR');
 assert.equal(unknown.values.get('vizimall-shipping-country-source-v1'),'manual');
});
