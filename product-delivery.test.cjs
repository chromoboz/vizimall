const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
test('Product delivery changes stay in the supplier page without creating a header selector',()=>{
 const saved=new Map(), navigations=[], replacements=[];
 const document={documentElement:{dataset:{country:'DE'}},querySelector(){throw Error('Delivery controls must live inside the product');},querySelectorAll(){return[];},addEventListener(){}};
 const context={URL,Object,location:{href:'https://vizimall.com/tech.html?country=DE',origin:'https://vizimall.com'},localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},history:{state:null,replaceState:(state,title,url)=>replacements.push(String(url))},document};
 context.location.assign=url=>navigations.push(url);
 context.window={VizimallDestinations:{codes:['DE','GR','US','JP'],name:code=>code},addEventListener(){}};
 vm.runInNewContext(readFileSync('shipping-country.js','utf8'),context);
 for(const code of ['US','JP','GR']){
  context.window.VizimallShipping.remember(code);
  assert.equal(context.window.VizimallShipping.country,code);
  assert.equal(document.documentElement.dataset.country,'DE');
  const link=context.window.VizimallShipping.withCountry('/tech.html?country=DE');
  assert.equal(link.searchParams.get('country'),'DE');assert.equal(link.searchParams.get('shipping'),code);
 }
 assert.deepEqual(navigations,[]);
 assert.equal(new URL(replacements.at(-1)).searchParams.get('shipping'),'GR');
 assert.throws(()=>context.window.VizimallShipping.remember('ZZ'),/supported delivery/);
});

