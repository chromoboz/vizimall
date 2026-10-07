(() => {
  'use strict';
  const markets = Object.fromEntries(window.VizimallDestinations.codes.map(code => [code,{name:window.VizimallDestinations.name(code)}]));
  const key = 'vizimall-shipping-country-v1';
  const valid = code => typeof code === 'string' && Object.hasOwn(markets, code);
  const url = new URL(location.href);
  const normalize = value => String(value || '').toUpperCase();
  const stored = () => { try { return normalize(localStorage.getItem(key)); } catch { return ''; } };
  const requested = normalize(url.searchParams.get('shipping'));
  const browsing = normalize(url.searchParams.get('country'));
  const initial = url.pathname === '/' || /\/index(?:\.html)?\/?$/.test(url.pathname);
  const remembered = stored();
  let country = valid(requested) ? requested : valid(remembered) ? remembered : valid(browsing) ? browsing : 'DE';
  if (!initial || valid(requested) || valid(remembered)) { try { localStorage.setItem(key, country); } catch {} }
  document.documentElement.dataset.shippingCountry = country;
  url.searchParams.set('shipping', country);
  if (!initial || valid(requested) || valid(remembered)) history.replaceState(history.state, '', url);
  const withCountry = (input, code = country) => {
    const target = new URL(input, location.href);
    if (!(initial && !valid(requested) && !valid(stored())) && target.origin === location.origin && /\/(?:index|mall|search|account|tech|home|pets|beauty|fashion|kids|auto|help|privacy|newsletter|travel|lifestyle)(?:\.html)?\/?$/.test(target.pathname)) target.searchParams.set('shipping', code);
    return target;
  };
  // Product controls remember delivery without navigating away from the product.
  function remember(code) {
    code = normalize(code);
    if (!valid(code)) throw new Error('Choose a supported delivery country.');
    country = code;
    try { localStorage.setItem(key, code); } catch {}
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
  window.VizimallShipping = Object.freeze({ get country() { return country; }, storageKey: key, remember, select, withCountry });
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
