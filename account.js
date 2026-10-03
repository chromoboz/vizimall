(() => {
  'use strict';
  const status = document.querySelector('#account-status'), content = document.querySelector('#account-content');
  const country = new URLSearchParams(location.search).get('country');
  const back = document.querySelector('a[href="mall.html"]');
  if (back) back.href = ['DE','FR','NL','PL','ES','PT','IT','GR'].includes(country) ? `mall.html?country=${country}` : 'index.html';
  const node = (tag, text, cls) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (cls) item.className = cls; return item; };
  function link(text, href, cls = 'account-button') { const item = node('a', text, cls); item.href = href; return item; }
  function safeLink(text, href) {
    try { const url = new URL(href); if (url.protocol !== 'https:' || url.username || url.password) return node('span', text); const item = link(text, url.href); item.rel = 'noopener noreferrer'; item.target = '_blank'; return item; }
    catch { return node('span', text); }
  }
  const money = price => new Intl.NumberFormat('en', { style: 'currency', currency: price.currencyCode }).format(Number(price.amount));
  async function request(path, input) {
    const response = await fetch(`/api/${path}`, { credentials: 'same-origin', cache: 'no-store',
      ...(input ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Please try again.');
    return data;
  }
  function card(title, id) { const section = node('section', undefined, 'account-card'); if (id) section.id = id; section.append(node('h2', title)); return section; }
  function photos(review, target) { const gallery = node('div', undefined, 'review-photos'); for (const photo of review.photos || []) { const img = node('img'); img.src = photo; img.alt = 'Customer photo'; img.loading = 'lazy'; gallery.append(img); } target.append(gallery); }
  function reviewForm(order, line, existing) {
    const modal = node('dialog', undefined, 'commerce-dialog'); const form = node('form', undefined, 'review-form');
    form.append(node('h2', `Review ${line.name || line.title}`), node('p', 'Share your honest experience. Positive and negative reviews are treated equally. Reviews are checked for spam and personal information before publication.', 'account-muted'));
    function field(label, control) { const wrapper = node('label', label); wrapper.append(control); form.append(wrapper); return control; }
    const rating = field('Rating', node('select'));
    for (let value = 5; value >= 1; value--) { const option = node('option', `${value} star${value > 1 ? 's' : ''}`); option.value = value; rating.append(option); }
    rating.value = existing?.rating || 5;
    const text = field('Your review', node('textarea')); text.required = true; text.minLength = 20; text.maxLength = 2000; text.rows = 5; text.value = existing?.text || '';
    const files = field('Photos (optional, up to 3 JPEG/PNG files, 1 MB each)', node('input')); files.type = 'file'; files.accept = 'image/jpeg,image/png'; files.multiple = true;
    form.append(node('p', 'Please avoid faces, addresses and other personal information. Uploaded photos are resized and location metadata is removed. Editing a review replaces its photos and sends it for review again.', 'account-muted'));
    const message = node('p'); message.setAttribute('role', 'status'); const submit = node('button', 'Submit review', 'account-button'); submit.type = 'submit';
    const cancel = node('button', 'Close', 'account-button account-secondary'); cancel.type = 'button'; cancel.onclick = () => modal.close();
    form.append(message, submit, cancel); modal.append(form); document.body.append(modal); modal.addEventListener('close', () => modal.remove()); modal.showModal();
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true; message.textContent = 'Checking your purchase and sending your review…';
      try {
        if (files.files.length > 3 || [...files.files].some(file => file.size > 1000000 || !['image/jpeg', 'image/png'].includes(file.type))) throw new Error('Use up to 3 JPEG/PNG photos under 1 MB each.');
        const encoded = await Promise.all([...files.files].map(file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); })));
        await request('reviews', { orderId: order.id, productId: line.productId, rating: Number(rating.value), text: text.value, photos: encoded });
        modal.close(); await load();
      } catch (error) { message.textContent = error.message; } finally { submit.disabled = false; }
    };
  }
  async function load() {
    try {
      const data = await request('account'); status.textContent = ''; content.replaceChildren();
      const nav = node('nav', undefined, 'account-nav'); nav.setAttribute('aria-label', 'Account sections');
      for (const [title, id] of [['Profile', 'profile'], ['Orders & tracking', 'orders'], ['Reviews', 'reviews'], ['VIZI Coin', 'coins'], ['Favourites', 'favourites']]) nav.append(link(title, `#${id}`, ''));
      const logout = node('form'); logout.method = 'post'; logout.action = '/api/logout'; const logoutButton = node('button', 'Sign out', 'account-button account-secondary'); logout.append(logoutButton);
      content.append(nav, logout); const grid = node('div', undefined, 'account-grid'); content.append(grid);
      const profile = card('Your profile', 'profile'); profile.append(node('p', data.customer.displayName), node('p', data.customer.emailAddress?.emailAddress || ''));
      for (const address of data.customer.addresses.nodes) profile.append(node('p', address.formatted.join(', ')));
      profile.append(link('Manage profile & addresses', data.nativeAccount), node('p', 'Profile and delivery addresses are saved securely in your Shopify account.', 'account-muted')); grid.append(profile);
      const coins = card('VIZI Coin', 'coins'); grid.append(coins);
      if (data.coins.active) {
        coins.append(node('h3', `${data.coins.balance} VIZI Coin`)); const next = data.coins.rewards.find(reward => reward.coins > data.coins.balance);
        if (next) { const progress = node('progress', undefined, 'coin-progress'); progress.max = next.coins; progress.value = data.coins.balance; coins.append(progress, node('p', `${next.coins - data.coins.balance} coins to the €${next.discountEuro} reward.`)); }
        coins.append(node('p', data.coins.redemptionEnabled ? 'Available rewards are listed below.' : 'Reward redemption is not open yet.', 'account-muted'));
        for (const event of data.coins.ledger) coins.append(node('p', `${event.delta > 0 ? '+' : ''}${event.delta} · ${event.event.startsWith('order:') ? 'Shopping' : 'Review'} · ${new Date(event.at).toLocaleDateString()}`, 'account-muted'));
      } else coins.append(node('p', 'VIZI Coin is being prepared. Earning rates and rewards will be published before the programme opens. No coins or discounts are being issued yet.', 'account-muted'));
      const orders = card('Orders & delivery', 'orders'); orders.classList.add('account-wide'); grid.append(orders);
      if (!data.orders.length) orders.append(node('p', 'You have no orders yet. Your orders and delivery updates will appear here after your first purchase.'));
      for (const order of data.orders) {
        const details = node('details', undefined, 'account-card'); details.append(node('summary', `${order.name} · ${money(order.totalPrice)} · ${order.fulfillmentStatus.replaceAll('_', ' ').toLowerCase()}`));
        details.append(node('p', `${new Date(order.processedAt).toLocaleDateString()} · Payment: ${order.financialStatus?.replaceAll('_', ' ').toLowerCase() || 'Awaiting confirmation'}`));
        if (order.cancelledAt) details.append(node('p', 'This order was cancelled.'));
        if (order.shippingAddress) details.append(node('p', `Delivery address: ${order.shippingAddress.formatted.join(', ')}`));
        if (!order.fulfillments.nodes.length) details.append(node('p', 'A tracking link will appear when the seller dispatches your order.'));
        for (const shipment of order.fulfillments.nodes) {
          details.append(node('p', `Delivery update: ${(shipment.latestShipmentStatus || shipment.status || 'Pending').replaceAll('_', ' ').toLowerCase()}`));
          if (shipment.estimatedDeliveryAt) details.append(node('p', `Estimated arrival: ${new Date(shipment.estimatedDeliveryAt).toLocaleDateString()}`));
          for (const tracking of shipment.trackingInformation) details.append(tracking.url ? safeLink(`${tracking.company || 'Carrier'} · ${tracking.number || 'Track parcel'}`, tracking.url) : node('p', `${tracking.company || 'Carrier'} · ${tracking.number || 'Tracking pending'}`));
        }
        for (const line of order.lineItems.nodes) {
          const row = node('div', undefined, 'order-item'); if (line.image) { const img = node('img'); try { if (new URL(line.image.url).protocol === 'https:') img.src = line.image.url; } catch {} img.alt = line.image.altText || line.name; row.append(img); }
          row.append(node('div', `${line.name || line.title} · ${line.variantTitle || ''} · Qty ${line.quantity}`));
          if (line.productId && !order.cancelledAt && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.financialStatus) && line.refundableQuantity > 0) {
            const existing = data.reviews.find(review => review.productId === line.productId); const button = node('button', existing ? 'Edit review' : 'Write a review', 'account-button account-secondary'); button.onclick = () => reviewForm(order, line, existing); row.append(button);
          }
          details.append(row);
        }
        details.append(safeLink('Order details, returns & cancellation requests', order.statusPageUrl)); orders.append(details);
      }
      const reviews = card('Your reviews', 'reviews'); reviews.classList.add('account-wide'); grid.append(reviews);
      if (!data.reviews.length) reviews.append(node('p', 'After a purchase, open an order above to share your experience.'));
      for (const review of data.reviews) {
        const item = node('article', undefined, 'review-card'); item.append(node('strong', `${review.rating}/5 · ${review.status}`), node('p', review.text)); photos(review, item);
        if (review.status !== 'withdrawn') { const withdraw = node('button', 'Withdraw review', 'account-button account-secondary'); withdraw.onclick = async () => { withdraw.disabled = true; try { await request('withdraw', { id: review.id }); await load(); } catch (error) { status.textContent = error.message; withdraw.disabled = false; } }; item.append(withdraw); }
        reviews.append(item);
      }
      const favourites = card('Your favourites', 'favourites'); favourites.classList.add('account-wide'); grid.append(favourites);
      const saved = await request('favourites');
      if (!saved.items.length) favourites.append(node('p', 'Save products with the heart button while browsing a store.'));
      for (const item of saved.items) {
        const row = node('div', undefined, 'order-item'); row.append(link(item.title, `${item.store}.html?country=${encodeURIComponent(item.country)}&product=${encodeURIComponent(item.productId)}`, ''));
        const remove = node('button', 'Remove', 'account-button account-secondary'); remove.onclick = async () => { remove.disabled = true; try { await request('favourites', { ...item, action: 'remove' }); await load(); } catch (error) { status.textContent = error.message; remove.disabled = false; } }; row.append(remove); favourites.append(row);
      }
      await support(grid, data.orders, data.moderator);
      if (data.moderator) await moderation(grid);
    } catch (error) {
      status.textContent = 'Sign in to view your account, or try again if the connection is unavailable.';
      content.replaceChildren(link('Sign in / Create an account', '/api/login'), node('p', 'Shopify sends a one-time code to your email. No password is needed.', 'account-muted'), link('Open Shopify account', 'https://shopify.com/108550685006/account', 'account-button account-secondary'));
    }
  }
  async function moderation(grid) {
    const panel = card('Review moderation'); panel.classList.add('account-wide'); grid.append(panel);
    panel.append(node('p', 'Publish honest positive and negative reviews equally. Reject only spam, unrelated content or personal information.'));
    const data = await request('moderation');
    for (const review of data.reviews) { const row = node('article', undefined, 'review-card'); row.append(node('strong', `${review.author} · ${review.rating}/5`), node('p', review.text)); photos(review, row);
      for (const [title, state] of [['Publish', 'approved'], ['Reject', 'rejected']]) { const button = node('button', title, 'account-button account-secondary'); button.onclick = async () => { button.disabled = true; try { await request('moderation', { id: review.id, revision: review.revision, status: state }); await load(); } catch (error) { status.textContent = error.message; button.disabled = false; } }; row.append(button); }
      panel.append(row);
    }
  }
  async function support(grid, orders, isModerator) {
    const panel = card('Help with an order', 'support'); panel.classList.add('account-wide'); grid.append(panel);
    panel.append(link('Email info@vizimall.com', 'mailto:info@vizimall.com', ''));
    const form = node('form'); const select = node('select'); select.setAttribute('aria-label', 'Order for support request');
    const general = node('option', 'General question'); general.value = ''; select.append(general);
    for (const order of orders) { const option = node('option', order.name); option.value = order.id; select.append(option); }
    const text = node('textarea'); text.required = true; text.minLength = 10; text.maxLength = 2000; text.rows = 4; text.setAttribute('aria-label', 'Your question'); text.placeholder = 'How can we help? Please never include payment card details or passwords.';
    const submit = node('button', 'Send support request', 'account-button'); const message = node('p'); message.setAttribute('role', 'status'); form.append(select, text, submit, message); panel.append(form);
    form.onsubmit = async event => { event.preventDefault(); submit.disabled = true; try { const result = await request('support', { orderId: select.value || null, text: text.value }); message.textContent = `Request ${result.reference} saved. You can see its status below.`; text.value = ''; await load(); } catch (error) { message.textContent = error.message; } finally { submit.disabled = false; } };
    const data = await request('support');
    for (const ticket of data.tickets) { const row = node('article', undefined, 'review-card'); row.append(node('strong', `${ticket.reference} · ${ticket.status}`), node('p', ticket.text)); if (ticket.reply) row.append(node('p', `VIZIMALL: ${ticket.reply}`)); panel.append(row); }
    if (isModerator) {
      const inbox = await request('support-admin'); const section = card('Customer support inbox'); section.classList.add('account-wide'); grid.append(section);
      for (const ticket of inbox.tickets) { const row = node('article', undefined, 'review-card'); row.append(node('strong', `${ticket.reference} · ${ticket.status}`), node('p', ticket.text)); const reply = node('textarea'); reply.maxLength = 2000; reply.minLength = 5; reply.setAttribute('aria-label', `Reply to ${ticket.reference}`); const button = node('button', 'Reply & resolve', 'account-button'); button.onclick = async () => { button.disabled = true; try { await request('support-admin', { id: ticket.id, reply: reply.value }); await load(); } catch (error) { status.textContent = error.message; button.disabled = false; } }; row.append(reply, button); section.append(row); }
    }
  }
  load();
})();
