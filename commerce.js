(() => {
  'use strict';
  const country = document.documentElement.dataset.country;
  let shippingCountry = window.VizimallShipping?.country || country;
  const api = window.VizimallStorefront;
  if (!country || !Object.hasOwn(api.countries, country)) return;
  const store = document.body.dataset.category;
  const market = window.VIZIMALL_MARKETS[country];
  const destination = {name:window.VizimallDestinations.name(shippingCountry)};
  let storageKey = `vizimall-cart-v1:${window.VIZIMALL_SHOPIFY.domain}:${shippingCountry}`;
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
  function setImage(node, source, title, kind = 'card') {
    node.alt = source?.altText || title;
    node.decoding = 'async';
    node.removeAttribute('srcset');
    node.removeAttribute('src');
    try {
      const url = new URL(source?.url);
      if (url.protocol !== 'https:') return;
      // Shopify CDN negotiates modern formats; preserve all other image hosts.
      const cdn = url.hostname === 'cdn.shopify.com' || url.hostname.endsWith('.myshopify.com');
      const widths = kind === 'thumb' ? [80,160] : kind === 'detail' ? [400,800,1200] : kind === 'viewer' ? [800,1200,1600] : [240,400,640];
      node.sizes = kind === 'thumb' ? '62px' : kind === 'detail' ? '(max-width: 760px) calc(100vw - 68px), 460px' : kind === 'viewer' ? '(max-width: 1000px) calc(100vw - 80px), 920px' : '(max-width: 600px) calc((100vw - 86px) / 2), (max-width: 1100px) calc((100vw - 150px) / 3), 300px';
      const sized = width => { const next = new URL(url); next.searchParams.set('width', width); return next.href; };
      if (cdn) node.srcset = widths.map(width => sized(width) + ' ' + width + 'w').join(', ');
      node.src = cdn ? sized(widths[1]) : url.href;
    } catch { node.alt = 'Image unavailable: ' + title; }
  }
  function image(source, title, kind = 'card') {
    const node = element('img');
    node.loading = 'lazy';
    setImage(node, source, title, kind);
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
    delivery.replaceChildren(element('h3', '', 'Delivery'));
    const shipLabel = element('label', 'delivery-country', 'Ship to: ');
    const selector = element('select'); selector.setAttribute('aria-label', 'Product shipping country');
    for (const code of window.VizimallDestinations.codes) {
      const target={name:window.VizimallDestinations.name(code)};
      const option = element('option', '', target.name); option.value = code; selector.append(option);
    }
    selector.value = shippingCountry;
    selector.addEventListener('change', () => {
      shippingCountry = window.VizimallShipping.remember(selector.value);
      destination.name = window.VizimallDestinations.name(shippingCountry);
      storageKey = `vizimall-cart-v1:${window.VIZIMALL_SHOPIFY.domain}:${shippingCountry}`;
      cart = readCart();
      save();
      renderDelivery(lastVariant, originControl.value || undefined);
    });
    shipLabel.append(selector); delivery.append(shipLabel);
    const quantityLabel = element('label', 'delivery-country', 'Quantity: ');
    const quantity = element('input'); quantity.type = 'number'; quantity.min = '1'; quantity.max = '99'; quantity.value = '1'; quantity.setAttribute('aria-label','Shipping quote quantity');
    quantityLabel.append(quantity); delivery.append(quantityLabel);
    const originLabel = element('label', 'delivery-country', 'Shipping from: ');
    const originControl = element('select'); originControl.setAttribute('aria-label','Shipping origin'); originLabel.append(originControl); originLabel.hidden = true;
    const methodLabel = element('label', 'delivery-country', 'Shipping method: ');
    const methodControl = element('select'); methodControl.setAttribute('aria-label','Shipping method'); methodLabel.append(methodControl); methodLabel.hidden = true;
    const table = element('dl', 'delivery-facts');
    delivery.append(originLabel, methodLabel, table);
    let lastVariant, requestNumber = 0, quoteController;
    function renderDelivery(variantId, from) {
      lastVariant = variantId;
      delivery.dispatchEvent(new CustomEvent('vizimall-shipping-quote',{detail:{variantId,quote:null},bubbles:true}));
      quoteController?.abort(); const requestId = ++requestNumber;
      methodLabel.hidden = originLabel.hidden = true;
      const route = window.VizimallDelivery.route(detail, shippingCountry, variantId);
      table.replaceChildren();
      for (const [label, value] of [
        ['Shipping method', route.method || 'Confirmed at checkout'],
        ['Processing time', route.processing || 'Not provided'],
        ['Estimated delivery', route.estimate || 'Not provided for this destination'],
        ['Shipping cost', route.cost || 'Confirmed at checkout']
      ]) { table.append(element('dt', '', label), element('dd', '', value)); }
      note.textContent = route.note;
      if (!variantId || !Number.isInteger(Number(quantity.value)) || Number(quantity.value)<1 || Number(quantity.value)>99) return;
      quoteController = new AbortController();
      const query = new URLSearchParams({ variant:variantId, shipping:shippingCountry, country, store, quantity:quantity.value });
      if (from) query.set('from',from);
      fetch('/.netlify/functions/shipping?'+query, { signal:quoteController.signal,credentials:'same-origin' }).then(response => response.json()).then(quote => {
        if (requestId !== requestNumber || !delivery.isConnected) return;
        if(quote.status!=='available')delivery.dispatchEvent(new CustomEvent('vizimall-shipping-quote',{detail:{variantId,quote},bubbles:true}));
        if (quote.status === 'not_connected' || quote.status === 'not_mapped') return;
        if (quote.status === 'unavailable') { table.replaceChildren(element('dt','','Availability'),element('dd','','No shipping option available for this quantity and destination.')); note.textContent='Choose another destination or quantity.'; return; }
        if (quote.status !== 'available') { note.textContent='Live shipping information is temporarily unavailable. '+route.note; return; }
        originControl.replaceChildren();
        for (const code of quote.origins) { const option=element('option','',window.VIZIMALL_MARKETS[code]?.name||code); option.value=code; originControl.append(option); }
        originControl.value=quote.from; originLabel.hidden=false;
        methodControl.replaceChildren();
        quote.methods.forEach((method,index)=>{const option=element('option','',method.name);option.value=String(index);methodControl.append(option);});
        methodLabel.hidden=false;
        methodControl.value=String(Math.max(0,quote.methods.findIndex(m=>m.name===quote.pricing?.standardMethod)));
        methodControl.disabled=Boolean(quote.pricing);
        methodLabel.firstChild.textContent=quote.pricing?'Standard shipping: ':'Shipping method: ';
        function showQuote() {
          const method=quote.methods[Number(methodControl.value)]; if(!method)return;
          table.replaceChildren();
          const rows=[['Processing time',quote.processingHours?'Ships within '+quote.processingHours+' hours':route.processing||'Not provided by supplier'],['Estimated transport',method.transport+' days; preparation is additional'],['Warehouse stock',Number.isSafeInteger(quote.stockQuantity)?quote.stockQuantity.toLocaleString()+' remaining in '+window.VizimallDestinations.name(quote.from):'Not provided'],['CJ shipping estimate for this quantity',money(method.supplierCost)]];
          if(quote.pricing)rows.push(['Price including standard shipping per item',money(quote.pricing.unitPrice)],['Total for '+quote.quantity+' item(s)',money(quote.pricing.lineTotal)]);
          for(const [label,value] of rows)table.append(element('dt','',label),element('dd','',value));
          note.textContent=quote.pricing?(quote.pricing.checkoutReady?'Standard shipping is included per item.':'Shipping is available. The checkout price for this destination is being prepared; purchasing is temporarily unavailable.')+' CJ checked '+new Date(quote.checkedAt).toLocaleTimeString()+'. Preparation and transport are separate estimates.': 'CJ estimate for '+quote.quantity+' item(s), checked '+new Date(quote.checkedAt).toLocaleTimeString()+'. Final checkout charge is not yet verified.';
          delivery.dispatchEvent(new CustomEvent('vizimall-shipping-quote',{detail:{variantId,quote},bubbles:true}));
        }
        methodControl.onchange=showQuote;showQuote();
      }).catch(error => { if(requestId===requestNumber && error.name!=='AbortError'){note.textContent='Live shipping information is temporarily unavailable. '+route.note;delivery.dispatchEvent(new CustomEvent('vizimall-shipping-quote',{detail:{variantId,quote:{status:'temporarily_unavailable'}},bubbles:true}));} });
    }
    const note = element('p', 'delivery-source'); delivery.append(note);
    quantity.addEventListener('change',()=>renderDelivery(lastVariant,originControl.value||undefined));
    originControl.addEventListener('change',()=>renderDelivery(lastVariant,originControl.value));
    const refresh=setInterval(()=>{if(delivery.isConnected&&document.visibilityState==='visible')renderDelivery(lastVariant,originControl.value||undefined);},300000);
    const cleanup=new MutationObserver(()=>{if(!delivery.isConnected){clearInterval(refresh);quoteController?.abort();cleanup.disconnect();}});
    cleanup.observe(document.body,{childList:true});
    renderDelivery();
    return { details, delivery, renderDelivery };
  }
  function validLine(line) {
    return line && /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(line.variantId) && /^gid:\/\/shopify\/Product\/\d+$/.test(line.productId)
      && api.stores.includes(line.store) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99
      && typeof line.title === 'string' && typeof line.variantTitle === 'string' && Number.isFinite(Number(line.price?.amount))
      && /^[A-Z]{3}$/.test(line.price?.currencyCode);
  }
  function readCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(saved)) return saved.filter(validLine).slice(0, 50);
    } catch {}
    return [];
  }
  let cart = readCart();
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(cart)); } catch {}
    renderBag(cart.reduce((n, l) => n + l.quantity, 0));
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
  function renderBag(count) {
    if (!document.body.classList.contains('mall-page')) { cartButton.textContent = `Bag (${count})`; return; }
    cartButton.setAttribute('aria-label', `Open bag (${count} items)`);
    cartButton.title = 'Your bag';
    const icon = element('span','bag-icon');
    icon.innerHTML = '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></svg>';
    const badge = element('span','bag-count',String(count)); badge.hidden = count === 0; badge.setAttribute('aria-hidden','true');
    cartButton.replaceChildren(icon,badge);
  }
  const cartButton = button('Bag (0)', showCart, 'cart-toggle');
  document.body.append(cartButton);
  save();
  function showCart() {
    const modal = dialog(`Your bag · Shipping to ${destination.name}`);
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
        for (const line of cart) {
          const query=new URLSearchParams({variant:line.variantId,shipping:shippingCountry,country:line.browsingCountry||country,store:line.store,quantity:line.quantity});
          const response=await fetch('/.netlify/functions/shipping?'+query,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
          const quote=await response.json();
          if(!response.ok||quote.status!=='available'||!quote.methods?.length) throw new Error('Shipping cost and delivery time could not be verified. Please try again before checking out.');
          if(!quote.pricing?.checkoutReady)throw new Error('The shipping-included checkout price for this destination is not ready. Please try again later.');
          line.price=quote.pricing.unitPrice;
        }
        save();updateTotals();
        const url = await client.checkout(shippingCountry, cart.map(line => ({ ...line })));
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
      const controller = new AbortController();
      modal.addEventListener('close', () => controller.abort(), { once: true });
      const detail = await client.product(country, store, item.id, controller.signal, shippingCountry);
      if (!modal.isConnected) return;
      const photos = [...detail.images, detail.featuredImage, ...detail.variants.map(v => v.image)]
        .filter((photo, index, all) => /^https:\/\//i.test(photo?.url || '') && all.findIndex(p => p?.url === photo.url) === index);
      const gallery = element('section', 'product-gallery');
      gallery.setAttribute('aria-label', `${detail.title} photos`);
      const mainImage = image(photos[0], detail.title, 'detail');
      mainImage.loading = 'eager';
      const counter = element('p', 'gallery-counter');
      counter.setAttribute('aria-live', 'polite');
      let photoIndex = 0;
      const enlarge = button('', () => {
        const viewer = dialog(`${detail.title} · Photo ${photoIndex + 1}`);
        viewer.classList.add('photo-viewer');
        const enlarged = image(photos[photoIndex], detail.title, 'viewer');
        enlarged.loading = 'eager';
        viewer.append(enlarged);
        modal.addEventListener('close', () => viewer.close(), { once: true });
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
        thumb.append(image(photo, `${detail.title} · Photo ${index + 1}`, 'thumb'));
        thumbnails.append(thumb);
        return thumb;
      });
      function choosePhoto(index) {
        photoIndex = index;
        setImage(mainImage, photos[index], `${detail.title} · Photo ${index + 1}`, 'detail');
        counter.textContent = `Photo ${index + 1} of ${photos.length} · Click to enlarge`;
        photoButtons.forEach((thumb, i) => thumb.setAttribute('aria-pressed', String(i === index)));
        const active = photoButtons[index];
        thumbnails.scrollTo({ left: Math.max(0, active.offsetLeft - thumbnails.offsetLeft - thumbnails.clientWidth / 2 + active.clientWidth / 2), behavior: matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches ? 'auto' : 'smooth' });
      }
      gallery.append(stage, counter, thumbnails);
      if (photos.length) choosePhoto(0);
      else { enlarge.disabled = true; counter.textContent = 'Photos are currently unavailable.'; }
      content.replaceChildren(gallery);
      const copy = element('div', 'product-detail-copy');
      const price = element('p', 'detail-price');
      const selectedOption = element('p', 'selected-option');
      const stockStatus = element('p', 'product-stock');
      stockStatus.setAttribute('aria-live', 'polite');
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
            if (source) choice.append(image(source, value, 'thumb'));
          }
          choice.append(element('span', '', value));
          choices.append(choice); optionButtons.push({ choice, name, value });
        }
        group.append(choices); copy.append(group);
      }
      let currentShippingQuote=null;
      function showVariantPhoto() {
        const variant = detail.variants.find(v => v.id === select.value);
        information.renderDelivery(variant?.id);
        const index = photos.findIndex(photo => photo.url === variant?.image?.url);
        if (index >= 0) choosePhoto(index);
        else if (photos.length) choosePhoto(0);
        price.textContent = variant ? money(variant.price) : '';
        selectedOption.textContent = variant && variant.title !== 'Default Title' ? `Selected: ${variant.title}` : '';
        stockStatus.textContent = !variant?.availableForSale ? 'Sold out' : variant.currentlyNotInStock ? 'Available to order · delivery may take longer' : Number.isInteger(variant.quantityAvailable) && variant.quantityAvailable > 0 ? `${variant.quantityAvailable.toLocaleString()} remaining · selected option` : 'In stock · quantity unavailable';
        optionButtons.forEach(({ choice, name, value }) => choice.setAttribute('aria-pressed', String(variant?.selectedOptions?.some(o => o.name === name && o.value === value) || false)));
        if (typeof add !== 'undefined') { add.disabled = true; add.textContent = variant?.availableForSale ? 'Checking shipping…' : 'Sold out'; }
      }
      select.addEventListener('change', showVariantPhoto);
      const add = button(available ? 'Add to bag' : 'Sold out', () => {
        const variant = detail.variants.find(v => v.id === select.value && v.availableForSale);
        if (!variant||!currentShippingQuote?.pricing?.checkoutReady) return;
        const existing = cart.find(l => l.variantId === variant.id);
        const selectedQuantity=currentShippingQuote.quantity;
        const nextQuantity=(existing?.quantity||0)+selectedQuantity;
        if(!Number.isInteger(selectedQuantity)||selectedQuantity<1||nextQuantity>99||nextQuantity>currentShippingQuote.stockQuantity){status.textContent='This quantity exceeds the available stock or item limit.';return;}
        if (!existing && cart.length >= 50) { status.textContent = 'Your bag is full. Please check out first.'; return; }
        if (existing) {existing.quantity=nextQuantity;existing.price=currentShippingQuote.pricing.unitPrice;}
        else cart.push({ productId: detail.id, variantId: variant.id, store, browsingCountry: country, title: detail.title, variantTitle: variant.title, price: currentShippingQuote.pricing.unitPrice, quantity:selectedQuantity });
        save(); status.textContent = 'Added to your bag.';
      });
      add.disabled = true;
      information.delivery.addEventListener('vizimall-shipping-quote',event=>{
        if(event.detail.variantId!==select.value)return;
        currentShippingQuote=event.detail.quote;
        const quote=currentShippingQuote;
        if(!quote)price.textContent='Checking destination price…';
        if(quote?.pricing)price.textContent=money(quote.pricing.unitPrice)+' · standard shipping included';
        if(Number.isSafeInteger(quote?.stockQuantity))stockStatus.textContent=quote.stockQuantity.toLocaleString()+' remaining in '+window.VizimallDestinations.name(quote.from);
        add.disabled=!quote?.pricing?.checkoutReady;
        add.textContent=quote?.pricing?.checkoutReady?'Add to bag':quote?.status==='available'?'Checkout price pending':quote?'Shipping unavailable':'Checking shipping…';
      });
      status.textContent = '';
      selectLabel.hidden = select.hidden = optionGroups.size > 0 || detail.variants.length < 2;
      const purchaseActions = element('div', 'purchase-actions');
      purchaseActions.append(add, button('View bag', () => { modal.close(); showCart(); }, 'commerce-secondary'));
      copy.append(selectLabel, select, selectedOption, stockStatus, purchaseActions, status, information.delivery);
      content.append(copy, information.details);
      if (window.VizimallReviews) window.VizimallReviews(content, detail.id);
      showVariantPhoto();
    } catch (error) { status.textContent = error.message; }
  }
  const panel = document.querySelector('.product-panel');
  if (!panel || !api.stores.includes(store)) return;
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
  // Keep only nearby 24-product pages in memory. Other pages retain a cursor
  // and measured spacer, so scrolling back restores them without layout collapse.
  grid.classList.add('paged-grid');
  let cursor = null, loading = false, complete = false, total = 0;
  let generation = 0, filterTimer, options = { shippingCountry }, pages = [];
  const requests = new Set();
  const pageByNode = new WeakMap();
  function updateCount() {
    count.textContent = total + ' product' + (total === 1 ? '' : 's') + (complete ? '' : ' loaded');
  }
  function productCard(item) {
    const card = element('article', 'product-card');
    const open = button('', () => showProduct(item), 'product-open');
    open.setAttribute('aria-label', 'View ' + item.title);
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
    card.dataset.productId = item.id;
    const rating = element('p', 'product-rating', 'Loading reviews…');
    rating.setAttribute('aria-live', 'polite');
    card.append(open, rating, element('p', 'product-price', 'From ' + money(item.priceRange.minVariantPrice)), button(item.availableForSale ? 'Choose options' : 'View product · Sold out', () => showProduct(item), 'commerce-secondary'), favourite);
    return card;
  }
  function priceMatches(item) {
    const amount = Number(item.priceRange.minVariantPrice.amount);
    return (!options.min || amount >= Number(options.min)) && (!options.max || amount <= Number(options.max));
  }
  function mount(page, items) {
    page.items = items.filter(priceMatches);
    page.node.style.minHeight = '';
    page.node.replaceChildren(...page.items.map(productCard));
    loadRatings(page.node, page.items);
    if (!page.items.length) page.node.append(element('p', 'commerce-status', 'No products in this page match these prices.'));
    sizeObserver?.observe(page.node);
  }
  async function loadRatings(node, items) {
    if (!items.length) return;
    const cards = [...node.querySelectorAll('.product-card')];
    try {
      const response = await fetch('/api/review-summaries?' + new URLSearchParams({ products: items.map(item => item.id).join(',') }), { credentials: 'omit' });
      if (!response.ok) throw new Error('Reviews unavailable');
      const { summaries } = await response.json();
      for (const card of cards) {
        const summary = summaries?.find(value => value.productId === card.dataset.productId);
        const label = card.querySelector('.product-rating');
        if (Number.isInteger(summary?.count) && summary.count > 0 && Number.isFinite(summary.average) && summary.average >= 1 && summary.average <= 5) {
          const stars = element('span', 'product-stars');
          stars.setAttribute('aria-hidden', 'true');
          stars.textContent = '★'.repeat(Math.round(summary.average)) + '☆'.repeat(5 - Math.round(summary.average));
          label.replaceChildren(stars, document.createTextNode(` ${summary.average.toFixed(1)}/5 (${summary.count})`));
          label.setAttribute('aria-label', `${summary.average.toFixed(1)} out of 5 from ${summary.count} approved purchase reviews`);
        } else {
          const stars = element('span', 'product-stars', '☆☆☆☆☆');
          stars.setAttribute('aria-hidden', 'true');
          label.replaceChildren(stars, document.createTextNode(' No reviews yet'));
        }
      }
    } catch {
      for (const card of cards) card.querySelector('.product-rating').textContent = 'Reviews currently unavailable';
    }
  }
  function release(page) {
    if (!page.items || page.near || page.node.contains(document.activeElement)) return;
    page.height = page.node.getBoundingClientRect().height;
    page.width = page.node.clientWidth;
    sizeObserver?.unobserve(page.node);
    page.node.style.minHeight = page.height + 'px';
    const restore = button('Show these products', () => restorePage(page), 'commerce-secondary page-restore');
    restore.addEventListener('focus', () => { page.near = true; restorePage(page); });
    page.node.replaceChildren(restore);
    page.items = null;
  }
  async function restorePage(page) {
    if (page.items || page.pending) return;
    page.pending = true;
    const token = generation, controller = new AbortController();
    requests.add(controller);
    try {
      const result = await client.products(country, store, page.after, { ...options, signal: controller.signal });
      if (token !== generation) return;
      const hadFocus = page.node.contains(document.activeElement);
      mount(page, result.products);
      if (hadFocus) page.node.querySelector('button')?.focus();
      release(page);
    } catch (error) {
      if (token === generation && !controller.signal.aborted) {
        const retryPage = button('Try loading these products again', () => restorePage(page), 'commerce-secondary page-restore');
        page.node.replaceChildren(retryPage);
      }
    } finally { requests.delete(controller); page.pending = false; }
  }
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
    for (const {target} of entries) {
      const page = pageByNode.get(target);
      if (page?.items) { page.height = target.getBoundingClientRect().height; page.width = target.clientWidth; }
    }
  }) : null;
  const pageObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const page = pageByNode.get(entry.target);
      if (!page) continue;
      page.near = entry.isIntersecting;
      if (page.near) restorePage(page); else release(page);
    }
  }, { rootMargin: '700px 0px' }) : null;
  grid.addEventListener('focusout', () => requestAnimationFrame(() => pages.forEach(release)));
  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      for (const page of pages) if (!page.items && page.width) {
        // Re-estimate unloaded page height on orientation/column changes.
        const width = page.node.clientWidth;
        const oldColumns = page.width < 520 ? 2 : 3, columns = width < 520 ? 2 : 3;
        page.node.style.minHeight = Math.max(100, page.height * oldColumns / columns * Math.max(.6, width / page.width)) + 'px';
      }
    });
  });
  async function load() {
    if (loading || complete) return;
    const token = generation, controller = new AbortController();
    requests.add(controller);
    loading = true; more.disabled = true; retry.hidden = true;
    panel.setAttribute('aria-busy', 'true');
    message.textContent = 'Loading the collection…';
    try {
      if (!client) throw connectionError;
      const after = cursor;
      const result = await client.products(country, store, after, { ...options, signal: controller.signal });
      if (token !== generation) return;
      const next = result.pageInfo.endCursor;
      if (result.pageInfo.hasNextPage && (!next || next === after)) throw new Error('Unable to load the next page. Please try again.');
      cursor = next; complete = !result.pageInfo.hasNextPage;
      const page = { after, node: element('div', 'product-page'), items: null, near: true, height: 0, width: 0 };
      page.node.setAttribute('aria-label', 'Product page ' + (pages.length + 1));
      pageByNode.set(page.node, page); pages.push(page); grid.append(page.node);
      mount(page, result.products);
      total += page.items.length;
      pageObserver?.observe(page.node);
      updateCount();
      more.hidden = complete;
      message.textContent = total ? 'Choose a product to explore its options.' : complete ? 'No products match this collection and these filters.' : 'No matching products in this page. Load more to continue.';
      // Re-arm only after an explicit scroll/load action: no catalog-draining loop.
      if (!complete && page.items.length && infiniteObserver) {
        infiniteObserver.unobserve(more); infiniteObserver.observe(more);
      }
    } catch (error) {
      if (token === generation && !controller.signal.aborted) { message.textContent = error.message; retry.hidden = false; }
    } finally {
      requests.delete(controller);
      if (token === generation) { loading = false; more.disabled = false; panel.setAttribute('aria-busy', 'false'); }
    }
  }
  const infiniteObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && !loading && !complete && retry.hidden && !document.querySelector('dialog[open]')) load();
  }, { rootMargin: '350px 0px' }) : null;
  function refine() {
    clearTimeout(filterTimer);
    // Invalidate immediately, including responses arriving during debounce.
    generation++; requests.forEach(controller => controller.abort()); requests.clear();
    loading = true; infiniteObserver?.unobserve(more);
    filterTimer = setTimeout(() => {
      pages.forEach(page => { pageObserver?.unobserve(page.node); sizeObserver?.unobserve(page.node); page.items = null; });
      pages = []; grid.replaceChildren(); cursor = null; complete = false; total = 0;
      options = { shippingCountry, search: search.value, sort: sorting.value, inStock: stockInput.checked, min: minimum.value, max: maximum.value };
      more.hidden = true; retry.hidden = true; loading = false;
      load();
    }, 250);
  }
  for (const control of [search, sorting, stockInput, minimum, maximum]) control.addEventListener('input', refine);
  window.addEventListener('pagehide', () => {
    for (const controller of requests) controller.abort();
    for (const modal of document.querySelectorAll('dialog[open]')) modal.close();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    if (!pages.length && !loading) load();
    else if (!complete) { infiniteObserver?.unobserve(more); infiniteObserver?.observe(more); }
  });
  // Saved-favourite links load that one product directly, never every list page.
  const requested = new URLSearchParams(location.search).get('product');
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(requested || '') && client) showProduct({ id: requested, title: 'Product' });
  load();
})();
