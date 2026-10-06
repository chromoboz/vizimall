(() => {
  'use strict';
  const markets = window.VIZIMALL_MARKETS;
  const key = 'vizimall-shipping-country-v1';
  const valid = code => typeof code === 'string' && Object.hasOwn(markets, code);
  const url = new URL(location.href);
  const normalize = value => String(value || '').toUpperCase();
  const stored = () => { try { return normalize(localStorage.getItem(key)); } catch { return ''; } };
  const requested = normalize(url.searchParams.get('shipping'));
  const browsing = normalize(url.searchParams.get('country'));
  const initial = url.pathname === '/' || /\/index(?:\.html)?\/?$/.test(url.pathname);
  const remembered = stored();
  const country = valid(requested) ? requested : valid(remembered) ? remembered : valid(browsing) ? browsing : 'DE';
  if (!initial || valid(requested) || valid(remembered)) { try { localStorage.setItem(key, country); } catch {} }
  document.documentElement.dataset.shippingCountry = country;
  url.searchParams.set('shipping', country);
  if (!initial || valid(requested) || valid(remembered)) history.replaceState(history.state, '', url);
  const withCountry = (input, code = country) => {
    const target = new URL(input, location.href);
    if (!(initial && !valid(requested) && !valid(remembered)) && target.origin === location.origin && /\/(?:index|mall|account|tech|home|pets|beauty|fashion|kids|auto|help|privacy|newsletter|travel|lifestyle)(?:\.html)?\/?$/.test(target.pathname)) target.searchParams.set('shipping', code);
    return target;
  };
  // Reload atomically: no stale list, open product or checkout request survives a switch.
  function select(code) {
    code = normalize(code);
    if (!valid(code)) throw new Error('Choose a supported delivery country.');
    try { localStorage.setItem(key, code); } catch {}
    const next = new URL(location.href);
    next.searchParams.set('shipping', code);
    location.assign(next.href);
  }
  window.VizimallShipping = Object.freeze({ country, storageKey: key, select, withCountry });
  const header = document.querySelector('.topbar, .shop-header, .account-header');
  if (header) {
    header.classList.add('has-shipping-selector');
    const label = document.createElement('label');
    label.className = 'shipping-selector';
    label.append(document.createTextNode('Shipping to: '));
    const control = document.createElement('select');
    control.id = 'shipping-country';
    control.setAttribute('aria-label', 'Shipping country');
    for (const [code, market] of Object.entries(markets)) {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = market.name;
      control.append(option);
    }
    control.value = country;
    control.addEventListener('change', () => select(control.value));
    label.append(control);
    header.append(label);
  }
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
