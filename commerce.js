(() => {
  'use strict';
  const country = document.documentElement.dataset.country;
  const api = window.VizimallStorefront;
  if (!country || !Object.hasOwn(api.countries, country)) return;
  const store = document.body.dataset.category;
  const market = window.VIZIMALL_MARKETS[country];
  const storageKey = `vizimall-cart-v1:${window.VIZIMALL_SHOPIFY.domain}:${country}`;
  let client, connectionError;
  try { client = api.createClient(window.VIZIMALL_SHOPIFY); } catch (error) { connectionError = error; }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = 'commerce-button') {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }
  function money(price) {
    try { return new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: price.currencyCode }).format(Number(price.amount)); }
    catch { return `${price.amount} ${price.currencyCode}`; }
  }
  function image(source, title) {
    const node = element('img');
    node.alt = source?.altText || title;
    node.loading = 'lazy';
    try {
      const url = new URL(source?.url);
      if (url.protocol === 'https:') node.src = url.href;
    } catch { node.alt = `Image unavailable: ${title}`; }
    return node;
  }
  function productInformation(detail) {
    const details = element('section', 'product-information');
    details.append(element('h3', '', 'Product details'));
    const delivery = element('section', 'delivery-information');
    delivery.setAttribute('aria-label', 'Delivery information');
    delivery.append(element('h3', '', 'Delivery'));
    const description = element('div', 'product-description');
    const parsed = new DOMParser().parseFromString(detail.descriptionHtml || '', 'text/html');
    const allowed = new Set(['P', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'BR']);
    function clean(node, target) {
      if (node.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName)) return;
      const safe = allowed.has(node.tagName) ? element(node.tagName.toLowerCase()) : document.createDocumentFragment();
      for (const child of node.childNodes) clean(child, safe);
      target.append(safe);
    }
    for (const node of parsed.body.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P' && /^Dispatched from /i.test(node.textContent.replace(/\s+/g, ' ').trim())) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        const estimate = text.match(/Estimated delivery:\s*([^.]*)\./i);
        if (estimate) {
          delivery.append(element('p', 'delivery-estimate', estimate[1]));
          delivery.append(element('p', '', text.replace(estimate[0], '').replace(/\s+/g, ' ').trim()));
        } else clean(node, delivery);
      } else clean(node, description);
    }
    if (!description.textContent.trim()) description.textContent = detail.description;
    details.append(description);
    if (delivery.children.length === 1) delivery.append(element('p', '', 'Delivery time depends on the product and destination. Enter your delivery address at checkout to check available shipping options.'));
    const listedCountries = Object.entries(api.countries).filter(([, slug]) => detail.tags?.includes(`country-${slug}`)).map(([code]) => window.VIZIMALL_MARKETS[code].name);
    if (listedCountries.length) delivery.append(element('p', '', `Listed destinations: ${listedCountries.join(', ')}.`));
    delivery.append(element('p', 'destination-note', 'Delivery estimates apply to the destinations stated for this product. Shipping to another country may take longer or be unavailable. Enter your delivery address at checkout to check shipping options.'));
    return { details, delivery };
  }
  function validLine(line) {
    return line && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(line.variantId) && /^gid:\/\/shopify\/Product\/\d+$/.test(line.productId)
      && api.stores.includes(line.store) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99
      && typeof line.title === 'string' && typeof line.variantTitle === 'string' && Number.isFinite(Number(line.price?.amount))
      && /^[A-Z]{3}$/.test(line.price?.currencyCode);
  }
  let cart = [];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) cart = saved.filter(validLine).slice(0, 50);
  } catch {}
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(cart)); } catch {}
    cartButton.textContent = `Bag (${cart.reduce((n, l) => n + l.quantity, 0)})`;
  }
  function dialog(title) {
    const node = element('dialog', 'commerce-dialog');
    const header = element('header', 'commerce-dialog-header');
    header.append(element('h2', '', title), button('Close', () => node.close(), 'commerce-close'));
    node.append(header);
    document.body.append(node);
    node.addEventListener('close', () => node.remove(), { once: true });
    node.showModal();
    return node;
  }
  const cartButton = button('Bag (0)', showCart, 'cart-toggle');
  document.querySelector('.shop-header, .topbar')?.append(cartButton);
  save();
  function showCart() {
    const modal = dialog(`Your bag · ${market.name}`);
    const contents = element('div', 'cart-contents');
    const status = element('p', 'commerce-status');
    status.setAttribute('role', 'status');
    const totals = new Map();
    function updateTotals() {
      for (const [currencyCode, node] of totals) {
        const amount = cart.filter(l => l.price.currencyCode === currencyCode).reduce((n, l) => n + Number(l.price.amount) * l.quantity, 0);
        node.textContent = `Estimated subtotal: ${money({ amount, currencyCode })}`;
      }
    }
    const pay = button('Secure checkout', async () => {
      pay.disabled = true;
      for (const control of contents.querySelectorAll('button, input')) control.disabled = true;
      status.textContent = 'Checking availability and opening secure checkout…';
      try {
        if (!client) throw connectionError;
        const url = await client.checkout(country, cart.map(line => ({ ...line })));
        // Keep the bag when a buyer returns without completing payment.
        location.assign(url);
      } catch (error) {
        status.textContent = error.message; pay.disabled = cart.length === 0;
        for (const control of contents.querySelectorAll('button, input')) control.disabled = false;
      }
    });
    function render() {
      contents.replaceChildren();
      totals.clear();
      if (!cart.length) contents.append(element('p', '', 'Your bag is empty. Explore the stores to find something you love.'));
      for (const line of cart) {
        const row = element('div', 'cart-line');
        const info = element('div');
        info.append(element('h3', '', line.title), element('p', '', line.variantTitle === 'Default Title' ? '' : line.variantTitle), element('p', '', money(line.price)));
        const quantity = element('input');
        quantity.type = 'number'; quantity.min = '1'; quantity.max = '99'; quantity.value = String(line.quantity);
        quantity.setAttribute('aria-label', `Quantity for ${line.title}`);
        quantity.addEventListener('input', () => {
          const next = Number(quantity.value);
          if (Number.isInteger(next) && next >= 1 && next <= 99) { line.quantity = next; save(); updateTotals(); }
        });
        quantity.addEventListener('change', () => { quantity.value = String(line.quantity); });
        row.append(info, quantity, button('Remove', () => { cart = cart.filter(l => l !== line); save(); render(); }, 'commerce-close'));
        contents.append(row);
      }
      const currencies = [...new Set(cart.map(l => l.price.currencyCode))];
      for (const currencyCode of currencies) {
        const total = element('p', 'cart-total');
        totals.set(currencyCode, total); contents.append(total);
      }
      updateTotals();
      pay.disabled = !cart.length;
    }
    modal.append(contents, element('p', 'checkout-note', `You are shopping the ${market.name} collection. Your delivery address can be in another country, but delivery may take longer or be unavailable. Shipping options, final prices and taxes are calculated in Shopify checkout. You can check out as a guest.`), status, pay);
    render();
  }
  async function showProduct(item) {
      const modal = dialog(item.title);
    const content = element('div', 'product-detail');
    const status = element('p', 'commerce-status', 'Loading product options…');
    status.setAttribute('role', 'status');
    content.append(status); modal.append(content);
    try {
      const detail = await client.product(country, store, item.id);
      if (!modal.isConnected) return;
      const photos = [...detail.images, detail.featuredImage, ...detail.variants.map(v => v.image)]
        .filter((photo, index, all) => /^https:\/\//i.test(photo?.url || '') && all.findIndex(p => p?.url === photo.url) === index);
      const gallery = element('section', 'product-gallery');
      gallery.setAttribute('aria-label', `${detail.title} photos`);
      const mainImage = image(photos[0], detail.title);
      mainImage.loading = 'eager';
      const counter = element('p', 'gallery-counter');
      counter.setAttribute('aria-live', 'polite');
      let photoIndex = 0;
      const enlarge = button('', () => {
        const viewer = dialog(`${detail.title} · Photo ${photoIndex + 1}`);
        viewer.classList.add('photo-viewer');
        viewer.append(image(photos[photoIndex], detail.title));
      }, 'gallery-enlarge');
      enlarge.setAttribute('aria-label', `Enlarge photo of ${detail.title}`);
      mainImage.draggable = false;
      enlarge.append(mainImage);
      const stage = element('div', 'gallery-stage');
      const previousPhoto = button('‹', () => choosePhoto((photoIndex - 1 + photos.length) % photos.length), 'gallery-arrow gallery-previous');
      const nextPhoto = button('›', () => choosePhoto((photoIndex + 1) % photos.length), 'gallery-arrow gallery-next');
      previousPhoto.setAttribute('aria-label', 'Previous photo'); nextPhoto.setAttribute('aria-label', 'Next photo');
      previousPhoto.hidden = nextPhoto.hidden = photos.length < 2;
      stage.append(enlarge, previousPhoto, nextPhoto);
      let swipeStart = null, suppressEnlarge = false;
      stage.addEventListener('pointerdown', event => { suppressEnlarge = false; if (event.pointerType !== 'mouse') swipeStart = { x: event.clientX, y: event.clientY }; });
      stage.addEventListener('pointerup', event => {
        if (!swipeStart || photos.length < 2) return;
        const dx = event.clientX - swipeStart.x, dy = event.clientY - swipeStart.y;
        swipeStart = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          suppressEnlarge = true;
          choosePhoto((photoIndex + (dx < 0 ? 1 : -1) + photos.length) % photos.length);
        }
      });
      stage.addEventListener('pointercancel', () => { swipeStart = null; });
      enlarge.addEventListener('click', event => { if (suppressEnlarge) { event.stopImmediatePropagation(); suppressEnlarge = false; } }, { capture: true });
      const thumbnails = element('div', 'gallery-thumbnails');
      thumbnails.setAttribute('aria-label', 'Choose a product photo');
      const photoButtons = photos.map((photo, index) => {
        const thumb = button('', () => choosePhoto(index), 'gallery-thumbnail');
        thumb.setAttribute('aria-label', `Show photo ${index + 1} of ${photos.length}`);
        thumb.append(image(photo, `${detail.title} · Photo ${index + 1}`));
        thumbnails.append(thumb);
        return thumb;
      });
      function choosePhoto(index) {
        photoIndex = index;
        mainImage.src = photos[index].url;
        mainImage.alt = `${detail.title} · Photo ${index + 1}`;
        counter.textContent = `Photo ${index + 1} of ${photos.length} · Click to enlarge`;
        photoButtons.forEach((thumb, i) => thumb.setAttribute('aria-pressed', String(i === index)));
        const active = photoButtons[index];
        thumbnails.scrollTo({ left: Math.max(0, active.offsetLeft - thumbnails.offsetLeft - thumbnails.clientWidth / 2 + active.clientWidth / 2), behavior: 'smooth' });
      }
      gallery.append(stage, counter, thumbnails);
      if (photos.length) choosePhoto(0);
      else { enlarge.disabled = true; counter.textContent = 'Photos are currently unavailable.'; }
      content.replaceChildren(gallery);
      const copy = element('div', 'product-detail-copy');
      const price = element('p', 'detail-price');
      const selectedOption = element('p', 'selected-option');
      const information = productInformation(detail);
      copy.append(element('p', 'detail-eyebrow', `${market.name} collection`), price);
      const selectLabel = element('label', '', 'Choose an option');
      const select = element('select', 'variant-select');
      const selectId = `variant-${detail.id.split('/').pop()}`;
      select.id = selectId; selectLabel.htmlFor = selectId;
      for (const variant of detail.variants) {
        const option = element('option', '', `${variant.title === 'Default Title' ? 'Standard' : variant.title} · ${money(variant.price)}${variant.availableForSale ? '' : ' · Sold out'}`);
        option.value = variant.id; option.disabled = !variant.availableForSale; select.append(option);
      }
      const available = detail.variants.find(v => v.availableForSale);
      if (available) select.value = available.id;
      const optionGroups = new Map();
      for (const variant of detail.variants) for (const option of variant.selectedOptions || []) {
        if (option.name === 'Title' && option.value === 'Default Title') continue;
        if (!optionGroups.has(option.name)) optionGroups.set(option.name, new Set());
        optionGroups.get(option.name).add(option.value);
      }
      const optionButtons = [];
      for (const [name, values] of optionGroups) {
        const group = element('fieldset', 'product-options');
        group.append(element('legend', '', name));
        const choices = element('div', 'option-choices');
        for (const value of values) {
          const eligible = detail.variants.filter(v => v.selectedOptions?.some(o => o.name === name && o.value === value));
          const choice = button('', () => {
            const current = detail.variants.find(v => v.id === select.value);
            const next = eligible.find(v => v.availableForSale && v.selectedOptions.every(o => o.name === name || current?.selectedOptions?.some(c => c.name === o.name && c.value === o.value)))
              || eligible.find(v => v.availableForSale);
            if (next) { select.value = next.id; showVariantPhoto(); }
          }, 'option-choice');
          choice.setAttribute('aria-label', `Choose ${name}: ${value}`);
          choice.disabled = !eligible.some(v => v.availableForSale);
          if (/colou?r/i.test(name)) {
            const source = eligible.find(v => v.image)?.image;
            if (source) choice.append(image(source, value));
          }
          choice.append(element('span', '', value));
          choices.append(choice); optionButtons.push({ choice, name, value });
        }
        group.append(choices); copy.append(group);
      }
      function showVariantPhoto() {
        const variant = detail.variants.find(v => v.id === select.value);
        const index = photos.findIndex(photo => photo.url === variant?.image?.url);
        if (index >= 0) choosePhoto(index);
        else if (photos.length) choosePhoto(0);
        price.textContent = variant ? money(variant.price) : '';
        selectedOption.textContent = variant && variant.title !== 'Default Title' ? `Selected: ${variant.title}` : '';
        optionButtons.forEach(({ choice, name, value }) => choice.setAttribute('aria-pressed', String(variant?.selectedOptions?.some(o => o.name === name && o.value === value) || false)));
        if (typeof add !== 'undefined') { add.disabled = !variant?.availableForSale; add.textContent = variant?.availableForSale ? 'Add to bag' : 'Sold out'; }
      }
      select.addEventListener('change', showVariantPhoto);
      const add = button(available ? 'Add to bag' : 'Sold out', () => {
        const variant = detail.variants.find(v => v.id === select.value && v.availableForSale);
        if (!variant) return;
        const existing = cart.find(l => l.variantId === variant.id);
        if (existing && existing.quantity >= 99) { status.textContent = 'The maximum quantity per item is 99.'; return; }
        if (!existing && cart.length >= 50) { status.textContent = 'Your bag is full. Please check out first.'; return; }
        if (existing) existing.quantity += 1;
        else cart.push({ productId: detail.id, variantId: variant.id, store, title: detail.title, variantTitle: variant.title, price: variant.price, quantity: 1 });
        save(); status.textContent = 'Added to your bag.';
      });
      add.disabled = !available;
      status.textContent = '';
      selectLabel.hidden = select.hidden = optionGroups.size > 0 || detail.variants.length < 2;
      const purchaseActions = element('div', 'purchase-actions');
      purchaseActions.append(add, button('View bag', () => { modal.close(); showCart(); }, 'commerce-secondary'));
      copy.append(selectLabel, select, selectedOption, purchaseActions, status, information.delivery);
      content.append(copy, information.details);
      if (window.VizimallReviews) window.VizimallReviews(content, detail.id);
      showVariantPhoto();
    } catch (error) { status.textContent = error.message; }
  }
  const panel = document.querySelector('.product-panel');
  if (!panel || !api.stores.includes(store)) return;
  const destinationNotice = element('aside', 'destination-notice');
  destinationNotice.setAttribute('aria-label', 'Delivery destination');
  destinationNotice.append(element('strong', '', `Shopping ${market.name}, delivering elsewhere?`), element('p', '', 'The mall you browse is separate from your delivery address. The product’s stated delivery estimate applies only to confirmed destinations. Other destinations may take longer or be unavailable; check shipping options with your address at checkout.'));
  panel.before(destinationNotice);
  const grid = panel.querySelector('.product-grid');
  const tools = element('div', 'store-tools');
  const search = element('input'); search.type = 'search'; search.placeholder = 'Search this store'; search.setAttribute('aria-label', 'Search this store');
  const sorting = element('select'); sorting.setAttribute('aria-label', 'Sort products');
  for (const [value, text] of [['name','Name A–Z'], ['low','Price: low to high'], ['high','Price: high to low']]) { const option = element('option', '', text); option.value = value; sorting.append(option); }
  const stock = element('label', '', 'In stock only '); const stockInput = element('input'); stockInput.type = 'checkbox'; stock.append(stockInput);
  const minimum = element('input'); minimum.type = 'number'; minimum.min = 0; minimum.placeholder = 'Min price'; minimum.setAttribute('aria-label', 'Minimum price');
  const maximum = element('input'); maximum.type = 'number'; maximum.min = 0; maximum.placeholder = 'Max price'; maximum.setAttribute('aria-label', 'Maximum price');
  tools.append(search, sorting, stock, minimum, maximum); grid.before(tools);
  const message = panel.querySelector('.collection-message');
  const count = panel.querySelector('.collection-heading > span');
  const more = button('Load more', load);
  more.hidden = true; panel.append(more);
  const retry = button('Try again', load, 'commerce-secondary');
  retry.hidden = true; panel.append(retry);
  let cursor = null, loading = false, seen = new Set(), records = [], complete = false;
  function renderProducts() {
    const filtered = records.filter(item => item.title.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())
      && (!stockInput.checked || item.availableForSale)
      && (!minimum.value || Number(item.priceRange.minVariantPrice.amount) >= Number(minimum.value))
      && (!maximum.value || Number(item.priceRange.minVariantPrice.amount) <= Number(maximum.value)));
    filtered.sort((a, b) => sorting.value === 'name' ? a.title.localeCompare(b.title) : (Number(a.priceRange.minVariantPrice.amount) - Number(b.priceRange.minVariantPrice.amount)) * (sorting.value === 'high' ? -1 : 1));
    grid.replaceChildren();
    for (const item of filtered) {
      const card = element('article', 'product-card');
      const open = button('', () => showProduct(item), 'product-open'); open.setAttribute('aria-label', `View ${item.title}`);
      open.append(image(item.featuredImage, item.title), element('h3', '', item.title));
      const favourite = button('♡ Save favourite', async () => {
        favourite.disabled = true;
        try {
          const response = await fetch('/api/favourites', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', productId: item.id, title: item.title, country, store }) });
          if (response.status === 401) { location.href = 'account.html#favourites'; return; }
          if (!response.ok) throw new Error('Could not save. Please try again.');
          favourite.textContent = '♥ Saved';
        } catch (error) { message.textContent = error.message; } finally { favourite.disabled = false; }
      }, 'favourite-button');
      card.append(open, element('p', 'product-price', `From ${money(item.priceRange.minVariantPrice)}`), button(item.availableForSale ? 'Choose options' : 'View product · Sold out', () => showProduct(item), 'commerce-secondary'), favourite);
      grid.append(card);
    }
    count.textContent = `${filtered.length} product${filtered.length === 1 ? '' : 's'}${complete ? '' : ' loaded'}`;
    message.textContent = filtered.length ? 'Choose a product to explore its options.' : records.length ? 'No products match these filters.' : 'No products in this collection yet. Explore another store.';
  }
  async function refine() {
    renderProducts();
    // Complete pagination before claiming that filters search the whole collection.
    if (!complete && !loading) await load();
  }
  for (const control of [search, sorting, stockInput, minimum, maximum]) control.addEventListener('input', refine);
  async function load() {
    if (loading) return;
    loading = true; more.disabled = true; retry.hidden = true;
    panel.setAttribute('aria-busy', 'true');
    message.textContent = 'Loading the collection…';
    try {
      if (!client) throw connectionError;
      // Skip pages whose stale search results fail the exact-tag check.
      let result;
      do {
        result = await client.products(country, store, cursor);
        const previous = cursor;
        cursor = result.pageInfo.endCursor;
        if (result.pageInfo.hasNextPage && (!cursor || cursor === previous)) throw new Error('Unable to load the next page. Please try again.');
      } while (!result.products.length && result.pageInfo.hasNextPage);
      for (const item of result.products) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        records.push(item);
      }
      complete = !result.pageInfo.hasNextPage;
      renderProducts();
      more.hidden = !result.pageInfo.hasNextPage;
    } catch (error) { message.textContent = error.message; count.textContent = 'Collection'; retry.hidden = false; }
    finally { loading = false; more.disabled = false; panel.setAttribute('aria-busy', 'false'); }
    if (!complete && retry.hidden && (search.value || sorting.value !== 'name' || stockInput.checked || minimum.value || maximum.value || new URLSearchParams(location.search).has('product'))) await load();
    const requested = new URLSearchParams(location.search).get('product');
    if (requested && records.some(item => item.id === requested) && !panel.dataset.requestedOpened) { panel.dataset.requestedOpened = 'true'; showProduct(records.find(item => item.id === requested)); }
  }
  load();
})();
