window.VizimallReviews = async (target, productId) => {
  const node = (tag, text) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; return item; };
  const section = node('section'); section.className = 'product-reviews'; section.append(node('h3', 'Customer reviews'));
  const message = node('p', 'Loading reviews…'); message.setAttribute('role', 'status'); section.append(message); target.append(section);
  try {
    const response = await fetch(`/api/reviews?product=${encodeURIComponent(productId)}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error(); const data = await response.json();
    message.textContent = data.count ? `${data.average.toFixed(1)} / 5 · ${data.count} verified purchase review${data.count === 1 ? '' : 's'}` : 'No customer reviews yet.';
    for (const review of data.reviews) { const row = node('article'); row.className = 'review-card'; row.append(node('strong', `${review.rating}/5 · ${review.author}`), node('time', new Date(review.createdAt).toLocaleDateString()), node('p', review.text), node('small', `Verified purchase${review.incentivized ? ' · VIZI Coin review incentive; no positive rating required' : ''}`));
      const gallery = node('div'); gallery.className = 'review-photos'; for (const photo of review.photos) { const img = node('img'); img.src = photo; img.alt = 'Customer photo'; img.loading = 'lazy'; gallery.append(img); } row.append(gallery); section.append(row);
    }
  } catch { message.textContent = 'Reviews are temporarily unavailable. Please try again later.'; }
  const account = node('a', 'Purchased this product? Write a review from your orders.'); account.href = 'account.html#orders'; section.append(account);
};
