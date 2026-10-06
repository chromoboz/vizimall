const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
function boot(search,extra={}){
  const root={location:{search,href:'https://vizimall.com/tech.html'+search,origin:'https://vizimall.com'},...extra};
  const context={window:root,URL,URLSearchParams,Intl,Object,MutationObserver:extra.MutationObserver};
  for(const path of ['locale-data.js','locale-extra.js','locale.js'])vm.runInNewContext(readFileSync(path,'utf8'),context);
  return root;
}
test('Every storefront selects its language independently of delivery and entry preference',()=>{
  for(const[country,language]of Object.entries({DE:'de',GR:'el',FR:'fr',IT:'it',ES:'es',NL:'nl',PL:'pl',PT:'pt-PT'})){
    const root=boot('?country='+country+'&shipping=JP&shipto=US&lang=en',{localStorage:{getItem:()=> 'el'}});
    assert.equal(root.VizimallLocale.language,language);
    for(const[key,values]of Object.entries(root.VizimallLocaleData.messages)){
      assert.ok(values[country]?.trim(),key+' missing '+country);
      const placeholders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
      assert.deepEqual(placeholders(values[country]),placeholders(key),key+' placeholders '+country);
    }
    assert.notEqual(root.VizimallLocale.t('Shipping cost'),'Shipping cost');
  }
});
test('Entry language selection, memory and invalid-query fallback are distinct from storefront selection',()=>{
  assert.equal(boot('?lang=el').VizimallLocale.language,'el');
  assert.equal(boot('',{localStorage:{getItem:()=> 'de'}}).VizimallLocale.language,'de');
  assert.equal(boot('?lang=unsupported&shipping=PL').VizimallLocale.language,'en');
  assert.equal(boot('?country=de&lang=el').VizimallLocale.language,'de');
});
test('Dynamic shipping and bag text preserve quantities, prices and supplier values',()=>{
  const locale=boot('?country=DE').VizimallLocale;
  assert.equal(locale.text(' Bag (12) '),' Warenkorb (12) ');
  assert.equal(locale.text('Shipping cost: '),'Versandkosten: ');
  assert.equal(locale.text('Selected: Red $& XL'),'Ausgewählt: Red $& XL');
  assert.equal(locale.text('24,90 € · standard shipping included'),'24,90 € · Standardversand inbegriffen');
  assert.equal(locale.text('A supplier description that is not a UI key'),'A supplier description that is not a UI key');
});
test('DOM translation skips supplier copy, variant choices and externally authored titles, and does not rewrite unchanged text',()=>{
  let observer, writes=0;
  function element(cls='',children=[]){const el={nodeType:1,cls,childNodes:children,parentElement:null,hasAttribute:()=>false,matches:()=>false,closest(selector){return selector.includes('.'+this.cls)&&this.cls?this:this.parentElement?.closest(selector);}};children.forEach(child=>child.parentElement=el);return el;}
  function text(value){let current=value;return{nodeType:3,parentElement:null,get nodeValue(){return current;},set nodeValue(next){writes++;current=next;}};}
  const ui=text('Shipping cost'),copy=text('Shipping cost'),title=text('Support'),variant=text('Standard');
  const body=element('shop-page',[element('',[ui]),element('product-description',[copy]),element('supplier-content',[title]),element('option-choices',[variant])]);body.classList={contains:()=>false};
  const document={documentElement:{lang:'en'},body,title:'Tech | VIZIMALL',readyState:'complete'};
  boot('?country=DE&shipping=GR',{document,MutationObserver:class{constructor(callback){observer=callback;}observe(){}}});
  assert.equal(document.documentElement.lang,'de');assert.equal(ui.nodeValue,'Versandkosten');assert.equal(copy.nodeValue,'Shipping cost');assert.equal(title.nodeValue,'Support');assert.equal(variant.nodeValue,'Standard');
  const before=writes;observer([{type:'characterData',target:ui}]);assert.equal(writes,before,'already translated text must not cause a mutation loop');
  const added=text('Sold out');added.parentElement=body;observer([{type:'childList',addedNodes:[added]}]);assert.equal(added.nodeValue,'Ausverkauft');
});
