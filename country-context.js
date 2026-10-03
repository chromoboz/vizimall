(() => {
  const markets = window.VIZIMALL_MARKETS;
  const code = new URLSearchParams(location.search).get('country')?.toUpperCase();
  if (!code || !Object.hasOwn(markets, code)) {
    location.replace('index.html');
    return;
  }
  const market = markets[code];
  document.documentElement.dataset.country = code;
  document.title = `${document.title.split(' | ')[0]} | ${market.name}`;
  const header = document.querySelector('.topbar, .shop-header');
  const link = document.createElement('a');
  link.className = 'market-switch';
  link.href = 'index.html';
  link.textContent = `${code} · ${market.name} ↗`;
  link.setAttribute('aria-label', `Current country: ${market.name}. Change country`);
  header.append(link);
  for (const anchor of document.querySelectorAll('a[href]')) {
    const target = new URL(anchor.href, location.href);
    if (target.origin === location.origin && /\/(mall|account)(?:\.html)?\/?$/.test(target.pathname)) {
      target.searchParams.set('country', code);
      anchor.href = target.href;
    }
  }
  for (const button of document.querySelectorAll('[data-href]')) button.dataset.href += `?country=${code}`;
  const heading = document.querySelector('.collection-heading h2');
  if (heading) heading.textContent = `The ${market.name} collection`;
  const welcome = document.querySelector('.shop-welcome');
  if (welcome) {
    const label = document.createElement('p');
    label.className = 'country-store-label';
    label.textContent = `VIZIMALL ${market.name.toUpperCase()}`;
    welcome.prepend(label);
  }
})();

