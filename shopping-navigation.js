(() => {
  'use strict';
  const labels = Object.freeze({home:'Home and Living',beauty:'Beauty and Care',tech:'Tech and Gadgets',kids:'Kids and Play',auto:'Auto and Accessories',pets:'Pets and Friends',fashion:'Fashion'});
  window.VizimallNavigation = Object.freeze({labels});
  const country = document.documentElement.dataset.country;
  if (!country) return;
  const tr = key => window.VizimallLocale?.t(key) || key;
  const destination = window.VizimallShipping?.country || country;
  const target = page => page + '.html?country=' + country + '&shipping=' + destination;
  const navigation = document.createElement('nav');
  navigation.className = 'shopping-navigation';
  navigation.setAttribute('aria-label', tr('Find a product'));
  const search = document.createElement('a');
  search.className = 'shopping-search'; search.href = target('search');
  search.textContent = '⌕ ' + tr('Search all stores'); navigation.append(search);
  const menu = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = tr('Stores'); menu.append(summary);
  const links = document.createElement('div'); links.className = 'shopping-categories';
  // These shortcuts use the same six active routes and never rewrite product tags.
  for (const store of ['home','beauty','tech','kids','auto','pets']) {
    const link = document.createElement('a'); link.href = target(store); link.textContent = tr(labels[store]);
    if (document.body.dataset.category === store) link.setAttribute('aria-current','page');
    links.append(link);
  }
  const help = document.createElement('a'); help.href = target('help'); help.textContent = tr('Help & returns'); links.append(help);
  menu.append(links); navigation.append(menu);
  document.querySelector('.shop-header, .topbar')?.after(navigation);
  document.addEventListener('click', event => {if (!navigation.contains(event.target)) menu.open = false;});
  document.addEventListener('keydown', event => {if (event.key === 'Escape') menu.open = false;});
})();
