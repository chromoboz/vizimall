(() => {
  const markets = window.VIZIMALL_MARKETS;
  const code = new URLSearchParams(location.search).get('country')?.toUpperCase();
  if (!code || !Object.hasOwn(markets, code)) {
    location.replace('index.html');
    return;
  }
  const market = markets[code];
  const locale = window.VizimallLocale;
  const place = locale?.name(code) || market.name;
  document.documentElement.dataset.country = code;
  document.title = `${document.title.split(' | ')[0]} | ${place}`;
  const header = document.querySelector('.topbar, .shop-header');
  const link = document.createElement('a');
  link.className = 'market-switch';
  link.href = 'index.html';
  link.textContent = `${code} · ${place} ↗`;
  link.setAttribute('aria-label', locale ? locale.t('Browsing {place} mall. Change mall',{place}) : `Browsing ${place} mall. Change mall`);
  header.append(link);
  for (const anchor of document.querySelectorAll('a[href]')) {
    const target = new URL(anchor.href, location.href);
    if (target.origin === location.origin && /\/(mall|account)(?:\.html)?\/?$/.test(target.pathname)) {
      target.searchParams.set('country', code);
      anchor.href = target.href;
    }
  }
  for (const button of document.querySelectorAll('[data-href]')) {
    const target = window.VizimallShipping.withCountry(button.dataset.href);
    target.searchParams.set('country', code); button.dataset.href = target.href;
  }
  const heading = document.querySelector('.collection-heading h2');
  if (heading) heading.textContent = locale ? locale.t('The {place} collection',{place}) : `The ${place} collection`;
  const welcome = document.querySelector('.shop-welcome');
  if (welcome) {
    const label = document.createElement('p');
    label.className = 'country-store-label';
    label.textContent = `VIZIMALL ${place.toUpperCase()}`;
    welcome.prepend(label);
  }
})();

