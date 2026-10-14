(() => {
  'use strict';
  const markets = Object.fromEntries(window.VizimallDestinations.codes.map(code => [code,{name:window.VizimallDestinations.name(code)}]));
  const key = 'vizimall-shipping-country-v1';
  const sourceKey='vizimall-shipping-country-source-v1';
  const valid = code => typeof code === 'string' && Object.hasOwn(markets, code);
  const url = new URL(location.href);
  const normalize = value => String(value || '').toUpperCase();
  const stored = () => { try { return normalize(localStorage.getItem(key)); } catch { return ''; } };
  const requested = normalize(url.searchParams.get('shipping'));
  const browsing = normalize(url.searchParams.get('country'));
  const initial = url.pathname === '/' || /\/index(?:\.html)?\/?$/.test(url.pathname);
  const remembered = stored();
  let rememberedSource='';try{rememberedSource=localStorage.getItem(sourceKey)||'';}catch{}
  const needsDetection=!valid(requested)&&(!valid(remembered)||['geo','fallback'].includes(rememberedSource));
  let country = valid(requested) ? requested : valid(remembered) ? remembered : 'DE';
  if (!needsDetection) { try { localStorage.setItem(key, country); } catch {} }
  document.documentElement.dataset.shippingCountry = country;
  url.searchParams.set('shipping', country);
  if (!initial || valid(requested) || valid(remembered)) history.replaceState(history.state, '', url);
  const withCountry = (input, code = country) => {
    const target = new URL(input, location.href);
    if (target.origin === location.origin) {
      target.searchParams.delete('country');
      target.searchParams.set('lang', window.VizimallLocale?.language || 'en');
    }
    if (!(initial && !valid(requested) && !valid(stored())) && target.origin === location.origin && /\/(?:index|mall|search|account|tech|home|pets|beauty|fashion|kids|auto|help|privacy|newsletter|travel|lifestyle)(?:\.html)?\/?$/.test(target.pathname)) target.searchParams.set('shipping', code);
    return target;
  };
  // Product controls remember delivery without navigating away from the product.
  function remember(code,source='manual') {
    code = normalize(code);
    if (!valid(code)) throw new Error('Choose a supported delivery country.');
    country = code;
    try { localStorage.setItem(key, code);localStorage.setItem(sourceKey,source); } catch {}
    document.documentElement.dataset.shippingCountry = code;
    const next = new URL(location.href);
    next.searchParams.set('shipping', code);
    history.replaceState(history.state, '', next);
    return code;
  }
  function select(code) {
    remember(code);
    location.assign(location.href);
  }
  const ready=(async()=>{
    if(!needsDetection||typeof fetch!=='function')return country;
    try{
      const response=await fetch('/.netlify/functions/destination',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(3000)});
      const detected=response.ok?normalize((await response.json()).country):'';
      if(valid(detected))remember(detected,'geo');
      else remember(country,'fallback');
    }catch{remember(country,'fallback');}
    for(const anchor of document.querySelectorAll('a[href]'))anchor.href=withCountry(anchor.href).href;
    for(const button of document.querySelectorAll('[data-href]'))button.dataset.href=withCountry(button.dataset.href).href;
    return country;
  })();
  window.VizimallShipping = Object.freeze({ get country() { return country; }, storageKey: key, ready, remember, select, withCountry });
  for (const anchor of document.querySelectorAll('a[href]')) anchor.href = withCountry(anchor.href).href;
  // Covers links created later by profile, favourites and store navigation.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (anchor) anchor.href = withCountry(anchor.href).href;
  }, true);
  window.addEventListener('storage', event => {
    if (event.key === key && valid(normalize(event.newValue)) && normalize(event.newValue) !== country) select(event.newValue);
  });
  window.addEventListener('pageshow', event => {
    const saved = stored();
    if (event.persisted && valid(saved) && saved !== country) select(saved);
  });
})();
