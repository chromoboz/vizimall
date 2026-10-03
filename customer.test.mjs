import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewInput, eligiblePurchase, cents, orderCoins, reviewCoins, publicReview, coinPolicy } from './backend-rules.mjs';
import { update, session, hash, setCookie } from './backend-persistence.mjs';
import { submitReview, approvedReviews, ownReviews, reconcile, keyFromId } from './backend-reviews.mjs';
import { trustedEndpoint } from './backend-shopify.mjs';
import { createHandler, preparePhotos } from './backend-customer.mjs';
import { createRequire } from 'node:module';
const productId = 'gid://shopify/Product/1', customerId = 'gid://shopify/Customer/1';
const order = { id: 'gid://shopify/Order/1', financialStatus: 'PAID', cancelledAt: null, processedAt: '2026-10-03T10:00:00Z',
  totalPrice: { amount: '125.00', currencyCode: 'EUR' }, totalShipping: { amount: '5.00' }, totalTax: { amount: '20.00' }, totalRefunded: { amount: '0.00' },
  lineItems: { nodes: [{ productId, refundableQuantity: 1 }] } };
const policy = { ...coinPolicy, enabled: true, startsAt: '2026-10-03T00:00:00Z' };
class Database {
  values = new Map(); counter = 0;
  async get(key, options) { const value = this.values.get(key)?.data; return options?.type === 'json' ? structuredClone(value ?? null) : value ?? null; }
  async getWithMetadata(key) { const entry = this.values.get(key); return entry ? structuredClone(entry) : null; }
  async setJSON(key, data, options = {}) { const entry = this.values.get(key); if ((options.onlyIfNew && entry) || (options.onlyIfMatch && entry?.etag !== options.onlyIfMatch)) return { modified: false };
    const etag = String(++this.counter); this.values.set(key, { data: structuredClone(data), etag }); return { modified: true, etag }; }
  async set(key, data, options) { return this.setJSON(key, data, options); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix }) { return { blobs: [...this.values.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
}
test('Money uses decimal integer arithmetic and rejects malformed values', () => {
  assert.equal(cents('12.09'), 1209); assert.equal(cents('0.1'), 10);
  for (const amount of ['NaN', '-1', '1.001', '1e6']) assert.throws(() => cents(amount));
});
test('Unapproved economics award nothing; proposal nets shipping, tax and refunds', () => {
  assert.equal(orderCoins(order), 0); assert.equal(orderCoins(order, policy), 1000);
  assert.equal(orderCoins({ ...order, totalRefunded: { amount: '50.00' } }, policy), 500);
  assert.equal(orderCoins({ ...order, cancelledAt: 'today' }, policy), 0);
  assert.equal(orderCoins({ ...order, financialStatus: 'PENDING' }, policy), 0);
  assert.equal(orderCoins({ ...order, totalPrice: { amount: '125', currencyCode: 'USD' } }, policy), 0);
});
test('Verified purchase rejects cancelled, unpaid, refunded or unrelated purchases', () => {
  assert.equal(eligiblePurchase(order, productId), true);
  assert.equal(eligiblePurchase(order, 'gid://shopify/Product/9'), false);
  assert.equal(eligiblePurchase({ ...order, lineItems: { nodes: [{ productId, refundableQuantity: 0 }] } }, productId), false);
});
test('Moderated complete review earns one flat reward at every star value', () => {
  for (let rating = 1; rating <= 5; rating++) {
    const review = { rating, productId, status: 'approved', createdAt: '2026-10-03T11:00:00Z', photos: [] };
    assert.equal(reviewCoins(review, order, policy), 25);
    assert.equal(reviewCoins({ ...review, photos: ['a', 'b', 'c'] }, order, policy), 50);
    assert.equal(reviewCoins({ ...review, status: 'pending' }, order, policy), 0);
    assert.equal(reviewCoins(review, { ...order, cancelledAt: 'today' }, policy), 0);
  }
});
test('Review input and public projection never leak private purchase data', () => {
  const input = { productId, orderId: order.id, rating: 1, text: 'A useful honest review about this product.' };
  assert.equal(reviewInput(input).rating, 1);
  assert.throws(() => reviewInput({ ...input, rating: 6 })); assert.throws(() => reviewInput({ ...input, text: 'https://spam.example/test' }));
  const publicData = publicReview({ ...input, customerId, photos: [], id: 'test', status: 'approved', author: 'Customer' });
  assert.equal(publicData.customerId, undefined); assert.equal(publicData.orderId, undefined);
  assert.throws(() => keyFromId('../../sessions/secret'));
});
test('Concurrent updates retain both changes without losing data', async () => {
  const db = new Database();
  await Promise.all([update(db, 'count', value => ({ count: (value?.count || 0) + 1 })), update(db, 'count', value => ({ count: (value?.count || 0) + 1 }))]);
  assert.equal((await db.get('count', { type: 'json' })).count, 2);
});
test('Review creation, editing, moderation and refund invalidation are persistent', async () => {
  const db = new Database(); const customer = { id: customerId, firstName: 'Alice', lastName: 'Tester' };
  const input = { productId, orderId: order.id, rating: 2, text: 'This product could be improved, here is my honest review.' };
  const first = await submitReview(db, customer, [order], input, []);
  assert.equal(first.status, 'pending'); assert.equal((await approvedReviews(db, productId)).count, 0);
  const edited = await submitReview(db, customer, [order], { ...input, rating: 1 }, []);
  assert.equal(first.id, edited.id); assert.equal((await ownReviews(db, customerId)).length, 1);
  await update(db, keyFromId(first.id), current => ({ ...current, status: 'approved' }));
  assert.equal((await approvedReviews(db, productId)).count, 1);
  const coins = await reconcile(db, customerId, [order]); assert.equal(coins.active, false); assert.equal(coins.balance, null);
  await reconcile(db, customerId, [{ ...order, cancelledAt: '2026-10-03' }]);
  assert.equal((await approvedReviews(db, productId)).count, 0);
  await assert.rejects(submitReview(db, customer, [], input, []));
});
test('Sessions expire and cookies cannot be read by browser JavaScript', async () => {
  const db = new Database(), token = 'x'.repeat(43), req = new Request('https://vizimall.com/api/account', { headers: { cookie: `__Host-vizi-session=${token}` } });
  await db.setJSON(`sessions/${hash(token)}`, { token: 'private', expiresAt: Date.now() - 1 });
  assert.equal(await session(req, db), null); assert.equal(await db.get(`sessions/${hash(token)}`, { type: 'json' }), null);
  assert.match(setCookie('__Host-vizi-session', token, 300), /HttpOnly; Secure; SameSite=Lax/);
  for (const url of ['http://shopify.com/test', 'https://shopify.com.attacker.test', 'https://secret@shopify.com']) assert.throws(() => trustedEndpoint(url));
});
test('API rejects forged origins, unauthenticated requests and another customer’s review', async () => {
  const db = new Database(), token = 'y'.repeat(43);
  const handler = createHandler({ storeFactory: async () => db, dataProvider: async () => ({ customer: { id: customerId, firstName: 'A' }, orders: [order] }) });
  const unsigned = await handler(new Request('https://vizimall.com/api/account')); assert.equal(unsigned.status, 401);
  const forged = await handler(new Request('https://vizimall.com/api/withdraw', { method: 'POST', headers: { Origin: 'https://attacker.test' } })); assert.equal(forged.status, 400);
  await db.setJSON(`sessions/${hash(token)}`, { token: 'private', expiresAt: Date.now() + 10000 });
  const requestHeaders = { cookie: `__Host-vizi-session=${token}`, Origin: 'https://vizimall.com', 'Content-Type': 'application/json' };
  const other = await submitReview(db, { id: 'gid://shopify/Customer/2', firstName: 'B' }, [order], { productId, orderId: order.id, rating: 3, text: 'This is another person’s verified review.' }, []);
  const withdrawn = await handler(new Request('https://vizimall.com/api/withdraw', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ id: other.id }) })); assert.equal(withdrawn.status, 400);
  const own = await handler(new Request('https://vizimall.com/api/account', { headers: requestHeaders })); const account = await own.json();
  assert.equal(own.status, 200); assert.equal(account.reviews.length, 0); assert.equal(JSON.stringify(account).includes('private'), false);
  const media = await handler(new Request(`https://vizimall.com/api/media?review=${other.id}&photo=0`, { headers: requestHeaders })); assert.equal(media.status, 404);
  const mod = await handler(new Request('https://vizimall.com/api/moderation', { headers: requestHeaders })); assert.equal(mod.status, 404);
});
test('Saved favourites persist across API requests and remain isolated by customer', async () => {
  const db = new Database(), token = 'z'.repeat(43);
  await db.setJSON(`sessions/${hash(token)}`, { token: 'private', expiresAt: Date.now() + 10000 });
  const handler = createHandler({ storeFactory: async () => db, dataProvider: async () => ({ customer: { id: customerId }, orders: [] }) });
  const headers = { cookie: `__Host-vizi-session=${token}`, Origin: 'https://vizimall.com', 'Content-Type': 'application/json' };
  const item = { action: 'add', productId, country: 'NL', store: 'home', title: 'Test item' };
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await handler(new Request('https://vizimall.com/api/favourites', { method: 'POST', headers, body: JSON.stringify(item) }))).status, 200);
  const saved = await (await handler(new Request('https://vizimall.com/api/favourites', { headers }))).json(); assert.equal(saved.items.length, 1);
});
test('Photo processing decodes, resizes, strips metadata and refuses unsafe uploads', async () => {
  const require = createRequire(import.meta.url), sharp = require('sharp');
  const input = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#336699' } }).jpeg().withMetadata().toBuffer();
  const result = await preparePhotos([`data:image/jpeg;base64,${input.toString('base64')}`]);
  const metadata = await sharp(Buffer.from(result[0], 'base64')).metadata();
  assert.equal(metadata.format, 'jpeg'); assert.ok(metadata.width <= 1600); assert.equal(metadata.exif, undefined);
  await assert.rejects(preparePhotos(['data:image/svg+xml;base64,PHN2Zz4=']));
  await assert.rejects(preparePhotos(['data:image/jpeg;base64,YmFk']));
  await assert.rejects(preparePhotos(Array(4).fill(`data:image/jpeg;base64,${input.toString('base64')}`)));
});
