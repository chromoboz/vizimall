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
  for (const anchor of document.querySelectorAll('a[href="mall.html"]')) anchor.href = `mall.html?country=${code}`;
  for (const button of document.querySelectorAll('[data-href]')) button.dataset.href += `?country=${code}`;
  const heading = document.querySelector('.collection-heading h2');
  const message = document.querySelector('.collection-message');
  if (heading) heading.textContent = `The ${market.name} collection`;
  if (message) message.textContent = `We're preparing this store for ${market.name}. Products will appear here once suppliers and delivery options for this destination are confirmed.`;
  const placeholder = document.querySelector('.product-grid');
  if (placeholder) placeholder.remove();
  const welcome = document.querySelector('.shop-welcome');
  if (welcome) {
    const label = document.createElement('p');
    label.className = 'country-store-label';
    label.textContent = `VIZIMALL ${market.name.toUpperCase()} · COUNTRY PREVIEW`;
    welcome.prepend(label);
  }
})();
