(function(root){
  'use strict';
  const data=root.VizimallLocaleData;
  const countryFor=search=>{const code=new URLSearchParams(search).get('country')?.toUpperCase();return Object.hasOwn(data.languages,code)?code:null;};
  const country=countryFor(root.location?.search||'');
  const languageChoices={en:'English',de:'Deutsch',el:'Ελληνικά',fr:'Français',it:'Italiano',es:'Español',nl:'Nederlands',pl:'Polski','pt-PT':'Português'};
  const requestedLanguage=new URLSearchParams(root.location?.search||'').get('lang');
  let savedLanguage;try{savedLanguage=root.localStorage?.getItem('vizimall-entry-language-v1');}catch{}
  const language=data.languages[country]||(Object.hasOwn(languageChoices,requestedLanguage)?requestedLanguage:Object.hasOwn(languageChoices,savedLanguage)?savedLanguage:'en');
  const translationCountry=country||Object.keys(data.languages).find(code=>data.languages[code]===language);
  const regions=new Intl.DisplayNames([language],{type:'region'});
  const name=code=>regions.of(code)||code;
  function t(key,values={},code=translationCountry){
    const result=data.messages[key]?.[code]||key;
    return result.replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(values,key)?String(values[key]):match);
  }
  const patterns=[
    [/^Open bag \((\d+) items\)$/,'Open bag ({count} items)',['count']],
    [/^Bag \((\d+)\)$/,'Bag ({count})',['count']],
    [/^Your bag · Shipping to (.+)$/,'Your bag · Shipping to {place}',['place']],
    [/^Estimated subtotal: (.+)$/,'Estimated subtotal: {price}',['price']],
    [/^Selected: (.+)$/,'Selected: {option}',['option']],
    [/^(\S+) remaining · selected option$/,'{count} remaining · selected option',['count']],
    [/^(\S+) remaining in (.+)$/,'{count} remaining in {place}',['count','place']],
    [/^(\d+) delivery countries confirmed\. Checking more…$/,'{count} delivery countries confirmed. Checking more…',['count']],
    [/^(\d+) products?( loaded)?$/,'{count} products',['count']],
    [/^Photo (\d+) of (\d+) · Click to enlarge$/,'Photo {index} of {count} · Click to enlarge',['index','count']],
    [/^Welcome, (.+)\.$/,'Welcome, {person}',['person']],
    [/^(.+) · standard shipping included$/,'{price} · standard shipping included',['price']],
    [/^From (.+)$/,'From {price}',['price']],
    [/^Ships within (.+) hours$/,'Ships within {hours} hours',['hours']],
    [/^(.+) days; preparation is additional$/,'{days} days; preparation is additional',['days']]
  ];
  function text(value){
    const trimmed=value.trim();
    let result=t(trimmed);
    if(result===trimmed&&trimmed.endsWith(':')){const label=t(trimmed.slice(0,-1));if(label!==trimmed.slice(0,-1))result=label+':';}
    if(result===trimmed)for(const[pattern,key,keys]of patterns){const match=trimmed.match(pattern);if(match){result=t(key,Object.fromEntries(keys.map((key,i)=>[key,match[i+1]])));break;}}
    if(result===trimmed){const parts=trimmed.split(/(?<=\.) (?=[A-Z])/);if(parts.length>1){result=parts.map(part=>text(part)).join(' ');}}
    return result===trimmed?value:value.replace(trimmed,()=>result);
  }
  root.VizimallLocale=Object.freeze({country,language,countryFor,t,text,name});
  if(!root.document)return;
  const doc=root.document;doc.documentElement.lang=language;
  // Supplier copy, variant values and customer-authored content are never UI strings.
  const excluded='script,style,textarea,[contenteditable],.product-description,.option-choices,.variant-select,[data-vizi-content="external"],.review-body,.supplier-content,.review-card p,.review-card strong';
  function translate(node){
    if(node.nodeType===3){if(!node.parentElement?.closest(excluded)){const next=text(node.nodeValue);if(next!==node.nodeValue)node.nodeValue=next;}return;}
    if(node.nodeType!==1||node.closest(excluded))return;
    for(const attr of ['aria-label','title','placeholder','alt','data-store'])if(node.hasAttribute(attr)){const value=node.getAttribute(attr),next=text(value);if(next!==value)node.setAttribute(attr,next);}
    if(node.matches('a[href]')){
      const url=new URL(node.getAttribute('href'),root.location.href);
      if(country&&url.origin===root.location.origin&&/\/(mall|account|help|privacy|newsletter|tech|home|pets|beauty|fashion|kids|auto|lifestyle|travel)(\.html)?\/?$/.test(url.pathname)&&!url.searchParams.has('country')){url.searchParams.set('country',country);node.href=url.href;}
      else if(!country&&url.origin===root.location.origin&&/\/(account|help|privacy|newsletter)(\.html)?\/?$/.test(url.pathname)&&!url.searchParams.has('country')&&!url.searchParams.has('lang')){url.searchParams.set('lang',language);node.href=url.href;}
    }
    for(const child of node.childNodes)translate(child);
  }
  const start=()=>{
    if(doc.body.classList.contains('map-page')){
      const label=doc.createElement('label');label.className='entry-language';
      const caption=doc.createElement('span');caption.textContent=t('Language');label.append(caption);
      const selector=doc.createElement('select');selector.setAttribute('aria-label',t('Language'));selector.setAttribute('data-vizi-content','external');
      for(const[code,title]of Object.entries(languageChoices)){const option=doc.createElement('option');option.value=code;option.textContent=title;selector.append(option);}selector.value=language;
      selector.addEventListener('change',()=>{try{root.localStorage.setItem('vizimall-entry-language-v1',selector.value);}catch{}const url=new URL(root.location.href);url.searchParams.set('lang',selector.value);url.searchParams.delete('country');root.location.assign(url.href);});
      label.append(selector);doc.querySelector('.topbar').append(label);
      for(const pin of doc.querySelectorAll('.map-pin')){const code=new URL(pin.href).searchParams.get('country');pin.querySelector('.pin-label').textContent=name(code);pin.setAttribute('aria-label',t('Explore VIZIMALL {place}',{place:name(code)}));}
      for(const option of doc.querySelectorAll('.country-option')){const code=new URL(option.href).searchParams.get('country');option.children[1].firstChild.nodeValue=name(code);}
    }
    translate(doc.body);
    doc.title=text(doc.title.split(' | ')[0])+(doc.title.includes(' | ')?' | '+(country?name(country):'VIZIMALL'):'');
    new MutationObserver(records=>{for(const record of records){if(record.type==='childList')for(const node of record.addedNodes)translate(node);else translate(record.target);}}).observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder','href','data-store']});
  };
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(typeof window==='undefined'?globalThis:window);
