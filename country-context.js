(() => {
  // One catalog; each product retains its own supplier origin for shipping.
  const locale = window.VizimallLocale;
  const languageCountry = {de:'DE',el:'GR',fr:'FR',it:'IT',es:'ES',nl:'NL',pl:'PL','pt-PT':'PT'};
  document.documentElement.dataset.country = languageCountry[locale?.language] || 'DE';
  const url = new URL(location.href);
  url.searchParams.delete('country');
  url.searchParams.set('lang', locale?.language || 'en');
  history.replaceState(history.state, '', url);
  for (const button of document.querySelectorAll('[data-href]')) button.dataset.href = window.VizimallShipping.withCountry(button.dataset.href).href;
  const heading = document.querySelector('.collection-heading h2');
  if (heading) heading.textContent = 'The VIZIMALL collection';
})();
