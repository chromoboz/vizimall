// Proposal only. Economic awards remain disabled until explicitly approved.
export const coinPolicy = Object.freeze({
  version: 'proposal-1', enabled: false, startsAt: null, currency: 'EUR',
  coinsPerEuro: 10, reviewCoins: 25, photoBonusCoins: 25,
  coinsPerEuroDiscount: 1000, minimumCartEuro: 30, maximumDiscountPercent: 5,
  rewards: [{ coins: 1000, discountEuro: 1 }, { coins: 2000, discountEuro: 2 }, { coins: 5000, discountEuro: 5 }],
  redemptionEnabled: false
});
export function cents(amount) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(amount))) throw new Error('Invalid monetary amount');
  const [whole, fraction = ''] = String(amount).split('.');
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(value)) throw new Error('Invalid monetary amount');
  return value;
}
export function eligiblePurchase(order, productId) {
  return !order.cancelledAt && ['PAID', 'PARTIALLY_REFUNDED'].includes(order.financialStatus)
    && order.lineItems.nodes.some(line => line.productId === productId && line.refundableQuantity > 0);
}
export function reviewInput(input) {
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(input.productId || '') || !/^gid:\/\/shopify\/Order\/\d+$/.test(input.orderId || '')) throw new Error('Invalid purchase');
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error('Choose 1–5 stars');
  const text = String(input.text || '').trim();
  if (text.length < 20 || text.length > 2000 || /https?:\/\/|www\./i.test(text)) throw new Error('Write 20–2000 characters without links');
  return { productId: input.productId, orderId: input.orderId, rating: input.rating, text };
}
export function orderCoins(order, policy = coinPolicy) {
  if (!policy.enabled || !policy.startsAt || Date.parse(order.processedAt) < Date.parse(policy.startsAt)
      || order.cancelledAt || !['PAID', 'PARTIALLY_REFUNDED'].includes(order.financialStatus) || order.totalPrice.currencyCode !== policy.currency) return 0;
  // Exclude delivery/tax and subtract all refunds conservatively, including their tax.
  const net = Math.max(0, cents(order.totalPrice.amount) - cents(order.totalTax?.amount || '0')
    - cents(order.totalShipping.amount) - cents(order.totalRefunded.amount));
  return Math.floor(net * policy.coinsPerEuro / 100);
}
export function reviewCoins(review, order, policy = coinPolicy) {
  return policy.enabled && policy.startsAt && Date.parse(review.createdAt) >= Date.parse(policy.startsAt)
    && review.status === 'approved' && eligiblePurchase(order, review.productId)
    ? policy.reviewCoins + (review.photos.length ? policy.photoBonusCoins : 0) : 0;
}
export function publicReview(review) {
  return { id: review.id, rating: review.rating, text: review.text, author: review.author,
    createdAt: review.createdAt, verifiedPurchase: true, incentivized: review.incentivized,
    photos: review.photos.map((_, index) => `/api/media?review=${review.id}&photo=${index}`) };
}
