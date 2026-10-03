import { coinPolicy, eligiblePurchase, reviewInput, orderCoins, reviewCoins, publicReview } from './backend-rules.mjs';
import { hash, update } from './backend-persistence.mjs';
export const reviewKey = (productId, customerId) => `reviews/${hash(productId)}/${hash(customerId)}`;
export function keyFromId(id) {
  if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid review');
  return `reviews/${id.replace('.', '/')}`;
}
export async function ownReviews(db, customerId) {
  const { blobs } = await db.list({ prefix: `review-index/${hash(customerId)}/` });
  const result = await Promise.all(blobs.map(async entry => {
    const key = await db.get(entry.key);
    return key ? db.get(key, { type: 'json' }) : null;
  }));
  return result.filter(Boolean);
}
export async function submitReview(db, customer, orders, input, photos) {
  const data = reviewInput(input);
  const order = orders.find(order => order.id === data.orderId);
  if (!order || !eligiblePurchase(order, data.productId)) throw new Error('A paid, non-cancelled purchase is required');
  const key = reviewKey(data.productId, customer.id);
  // One canonical review per customer/product. Editing never creates a second reward.
  const review = await update(db, key, previous => ({ ...data, id: key.slice(8).replace('/', '.'),
    customerId: customer.id, author: customer.firstName ? `${customer.firstName} ${customer.lastName?.slice(0, 1) || ''}`.trim() : 'Customer',
    status: 'pending', createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    photos, incentivized: previous?.incentivized || coinPolicy.enabled,
    revision: (previous?.revision || 0) + 1 }));
  await db.set(`review-index/${hash(customer.id)}/${hash(data.productId)}`, key);
  return review;
}
export async function approvedReviews(db, productId) {
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(productId || '')) throw new Error('Invalid product');
  const { blobs } = await db.list({ prefix: `reviews/${hash(productId)}/` });
  const reviews = (await Promise.all(blobs.map(entry => db.get(entry.key, { type: 'json' })))).filter(review => review?.status === 'approved');
  return { reviews: reviews.map(publicReview).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    count: reviews.length, average: reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null };
}
export async function reconcile(db, customerId, orders) {
  const reviews = await ownReviews(db, customerId);
  const amounts = new Map(orders.map(order => [`order:${order.id}`, orderCoins(order)]));
  for (const review of reviews) {
    const order = orders.find(order => order.id === review.orderId);
    amounts.set(`review:${review.id}`, order ? reviewCoins(review, order) : 0);
    // Withdraw published reviews when their underlying purchase no longer qualifies.
    if (review.status === 'approved' && (!order || !eligiblePurchase(order, review.productId)))
      await update(db, keyFromId(review.id), current => current?.revision === review.revision ? { ...current, status: 'ineligible', revision: current.revision + 1 } : current);
  }
  const record = await update(db, `coins/${hash(customerId)}`, previous => {
    const targets = previous?.targets || {}, ledger = previous?.ledger || [];
    // Missing events reverse earlier awards; fresh verified events set a target, never increment twice.
    for (const id of Object.keys(targets)) if (!amounts.has(id)) amounts.set(id, 0);
    for (const [id, coins] of amounts) {
      const old = targets[id] || 0;
      if (coins !== old) ledger.push({ event: id, delta: coins - old, at: new Date().toISOString(), policy: coinPolicy.version });
      targets[id] = coins;
    }
    return { targets, ledger, balance: Object.values(targets).reduce((sum, coins) => sum + coins, 0), updatedAt: new Date().toISOString() };
  });
  return { balance: coinPolicy.enabled ? record.balance : null, active: coinPolicy.enabled,
    redemptionEnabled: coinPolicy.redemptionEnabled, rewards: coinPolicy.rewards,
    ledger: coinPolicy.enabled ? record.ledger.slice(-50).reverse() : [], checkedAt: record.updatedAt };
}
