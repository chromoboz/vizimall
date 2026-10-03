import { discovery, exchange, customerData, clientId, origin, nativeAccount } from './backend-shopify.mjs';
import { store, hash, random, cookie, setCookie, session, update, limit } from './backend-persistence.mjs';
import { submitReview, approvedReviews, ownReviews, reconcile, keyFromId } from './backend-reviews.mjs';
import { publicReview, coinPolicy } from './backend-rules.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (data, status = 200) => Response.json(data, { status, headers });
function redirect(location, cookies = []) {
  const result = new Headers({ ...headers, Location: location });
  for (const cookie of cookies) result.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers: result });
}
function checkOrigin(req) {
  if (req.headers.get('origin') !== origin || req.headers.get('sec-fetch-site') === 'cross-site') throw new Error('Invalid request origin');
}
async function body(req, maximum = 4500000) {
  if (!(req.headers.get('content-type') || '').startsWith('application/json')) throw new Error('JSON required');
  const text = await req.text();
  if (Buffer.byteLength(text) > maximum) throw new Error('Upload too large');
  return JSON.parse(text);
}
export async function preparePhotos(input = []) {
  if (!Array.isArray(input) || input.length > 3) throw new Error('Up to three photos allowed');
  if (!input.length) return [];
  const sharp = require('sharp');
  return Promise.all(input.map(async value => {
    if (typeof value !== 'string' || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(value)) throw new Error('Use JPEG or PNG photos');
    const bytes = Buffer.from(value.split(',')[1], 'base64');
    if (bytes.length > 1000000) throw new Error('Each photo must be under 1 MB');
    const image = sharp(bytes, { limitInputPixels: 16000000, animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png'].includes(metadata.format) || metadata.pages > 1) throw new Error('Invalid photo');
    // Re-encode and strip EXIF, including GPS and embedded comments.
    return (await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString('base64');
  }));
}
let jwks;
export function createHandler({ storeFactory = store, dataProvider = customerData } = {}) {
return async function handler(req, context = {}) {
  try {
    const url = new URL(req.url), action = url.pathname.split('/').filter(Boolean).pop();
    if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);
    if (req.method === 'POST') checkOrigin(req);
    const db = await storeFactory(req);
    if (action === 'login' && req.method === 'GET') {
      await limit(db, `login:${context.ip || 'unknown'}`, 60, 3600000);
      const state = random(), verifier = random(), nonce = random(), binding = random();
      await db.setJSON(`oauth/${hash(state)}`, { verifier, nonce, binding: hash(binding), expiresAt: Date.now() + 600000 });
      const config = await discovery();
      const destination = new URL(config.authorization_endpoint);
      const parameters = { client_id: clientId, redirect_uri: `${origin}/api/callback`, response_type: 'code',
        scope: 'openid email customer-account-api:full', state, nonce, code_challenge: hashBuffer(verifier), code_challenge_method: 'S256' };
      for (const [key, value] of Object.entries(parameters)) destination.searchParams.set(key, value);
      return redirect(destination.href, [setCookie('__Host-vizi-login', binding, 600)]);
    }
    if (action === 'callback' && req.method === 'GET') {
      const state = url.searchParams.get('state'), code = url.searchParams.get('code');
      if (!/^[A-Za-z0-9_-]{43}$/.test(state || '') || !code) throw new Error('Invalid authentication response');
      const key = `oauth/${hash(state)}`, entry = await db.getWithMetadata(key, { type: 'json' });
      const binding = cookie(req, '__Host-vizi-login');
      if (!entry || entry.data.used || entry.data.expiresAt < Date.now() || !binding || hash(binding) !== entry.data.binding) throw new Error('Authentication expired');
      const consumed = await db.setJSON(key, { used: true, expiresAt: 0 }, { onlyIfMatch: entry.etag });
      if (!consumed.modified) throw new Error('Authentication already used');
      const tokens = await exchange(code, entry.data.verifier), config = await discovery();
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      jwks ||= createRemoteJWKSet(new URL(config.jwks_uri));
      const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: config.issuer, audience: clientId });
      if (payload.nonce !== entry.data.nonce || !tokens.access_token || !Number.isFinite(tokens.expires_in)) throw new Error('Invalid customer identity');
      const id = random(), seconds = Math.min(tokens.expires_in, 86400);
      // Access/identity tokens remain on the server. Expiry requires fresh sign-in.
      await db.setJSON(`sessions/${hash(id)}`, { token: tokens.access_token, identity: tokens.id_token, expiresAt: Date.now() + seconds * 1000 });
      return redirect(`${origin}/account.html`, [setCookie('__Host-vizi-session', id, seconds), setCookie('__Host-vizi-login', '', 0)]);
    }
    const signed = await session(req, db);
    if (action === 'logout' && req.method === 'POST') {
      if (!signed) return redirect(`${origin}/account.html`, [setCookie('__Host-vizi-session', '', 0)]);
      await db.delete(signed.key);
      const config = await discovery(), destination = new URL(config.end_session_endpoint);
      destination.searchParams.set('id_token_hint', signed.identity);
      destination.searchParams.set('post_logout_redirect_uri', `${origin}/account.html`);
      return redirect(destination.href, [setCookie('__Host-vizi-session', '', 0)]);
    }
    if (action === 'reviews' && req.method === 'GET') return json(await approvedReviews(db, url.searchParams.get('product')));
    if (action === 'media' && req.method === 'GET') {
      const review = await db.get(keyFromId(url.searchParams.get('review')), { type: 'json' });
      if (!review) return json({ error: 'Photo unavailable' }, 404);
      if (review.status !== 'approved') {
        if (!signed) return json({ error: 'Photo unavailable' }, 404);
        const { customer } = await dataProvider(signed.token);
        if (customer.id !== review.customerId && !moderator(customer.id)) return json({ error: 'Photo unavailable' }, 404);
      }
      const index = Number(url.searchParams.get('photo'));
      if (!Number.isInteger(index) || index < 0 || !review.photos[index]) return json({ error: 'Photo unavailable' }, 404);
      return new Response(Buffer.from(review.photos[index], 'base64'), { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
    }
    if (!signed) return json({ error: 'Please sign in', signedIn: false, nativeAccount }, 401);
    const data = await dataProvider(signed.token);
    const { customer, orders } = data;
    if (action === 'account' && req.method === 'GET') {
      const coins = await reconcile(db, customer.id, orders), reviews = await ownReviews(db, customer.id);
      return json({ ...data, reviews: reviews.map(review => ({ ...publicReview(review), status: review.status, productId: review.productId, orderId: review.orderId })),
        coins, nativeAccount, moderator: moderator(customer.id), policy: { active: coinPolicy.enabled } });
    }
    if (action === 'reviews' && req.method === 'POST') {
      await limit(db, `review:${customer.id}`, 20, 86400000);
      const input = await body(req);
      const review = await submitReview(db, customer, orders, input, await preparePhotos(input.photos));
      await reconcile(db, customer.id, orders);
      return json({ id: review.id, status: review.status }, 201);
    }
    if (action === 'favourites') {
      const key = `favourites/${hash(customer.id)}`;
      if (req.method === 'GET') return json({ items: (await db.get(key, { type: 'json' }))?.items || [] });
      const input = await body(req, 3000);
      const countries = ['DE', 'FR', 'NL', 'PL', 'ES', 'PT', 'IT', 'GR'], stores = ['tech', 'home', 'pets', 'beauty', 'fashion', 'kids'];
      if (!/^gid:\/\/shopify\/Product\/\d+$/.test(input.productId || '') || !countries.includes(input.country) || !stores.includes(input.store)
        || typeof input.title !== 'string' || input.title.length > 250 || !['add', 'remove'].includes(input.action)) throw new Error('Invalid favourite');
      await limit(db, `favourites:${customer.id}`, 200, 3600000);
      const result = await update(db, key, previous => {
        const items = (previous?.items || []).filter(item => !(item.productId === input.productId && item.country === input.country && item.store === input.store));
        if (input.action === 'add') { if (items.length >= 100) throw new Error('Favourites list is full'); items.push({ productId: input.productId, country: input.country, store: input.store, title: input.title }); }
        return { items };
      });
      return json(result);
    }
    if (action === 'support') {
      const prefix = `support/${hash(customer.id)}/`;
      if (req.method === 'GET') {
        const { blobs } = await db.list({ prefix });
        return json({ tickets: (await Promise.all(blobs.map(entry => db.get(entry.key, { type: 'json' })))).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
      }
      const input = await body(req, 10000);
      if (input.orderId && !orders.some(order => order.id === input.orderId)) throw new Error('Order not found');
      const text = String(input.text || '').trim(); if (text.length < 10 || text.length > 2000) throw new Error('Write 10–2000 characters');
      await limit(db, `support:${customer.id}`, 5, 86400000);
      const id = `${hash(customer.id)}.${random()}`, reference = `VIZ-${random().slice(0,8).toUpperCase()}`;
      await db.setJSON(`support/${id.replace('.', '/')}`, { id, reference, orderId: input.orderId || null, text, reply: null, status: 'open', createdAt: new Date().toISOString() }, { onlyIfNew: true });
      return json({ reference }, 201);
    }
    if (action === 'support-admin' && moderator(customer.id)) {
      if (req.method === 'GET') { const { blobs } = await db.list({ prefix: 'support/' }); return json({ tickets: await Promise.all(blobs.map(entry => db.get(entry.key, { type: 'json' }))) }); }
      const input = await body(req, 10000), reply = String(input.reply || '').trim();
      if (!/^[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/.test(input.id || '') || reply.length < 5 || reply.length > 2000) throw new Error('Invalid reply');
      await update(db, `support/${input.id.replace('.', '/')}`, previous => { if (!previous) throw new Error('Request not found'); return { ...previous, reply, status: 'resolved', repliedAt: new Date().toISOString() }; });
      return json({ status: 'resolved' });
    }
    if (action === 'withdraw' && req.method === 'POST') {
      const input = await body(req, 2000);
      await update(db, keyFromId(input.id), previous => {
        if (!previous || previous.customerId !== customer.id) throw new Error('Review not found');
        return { ...previous, status: 'withdrawn', photos: [], revision: previous.revision + 1 };
      });
      await reconcile(db, customer.id, orders);
      return json({ status: 'withdrawn' });
    }
    if (action === 'moderation' && moderator(customer.id)) {
      if (req.method === 'GET') {
        const { blobs } = await db.list({ prefix: 'reviews/' });
        const reviews = (await Promise.all(blobs.map(entry => db.get(entry.key, { type: 'json' })))).filter(review => review?.status === 'pending');
        return json({ reviews: reviews.map(review => ({ ...publicReview(review), revision: review.revision })) });
      }
      const input = await body(req, 3000);
      if (!['approved', 'rejected'].includes(input.status)) throw new Error('Invalid moderation decision');
      await update(db, keyFromId(input.id), previous => {
        if (!previous || previous.status !== 'pending' || previous.revision !== input.revision) throw new Error('Review changed; refresh before moderating');
        return { ...previous, status: input.status, moderatedAt: new Date().toISOString(), revision: previous.revision + 1 };
      });
      return json({ status: input.status });
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    // Do not echo Shopify responses, tokens, account data or unexpected stack traces.
    return json({ error: 'This request could not be completed. Please try again or sign in again.' }, 400);
  }
};
}
export default createHandler();
import { createHash } from 'node:crypto';
function hashBuffer(value) { return createHash('sha256').update(value).digest('base64url'); }
function moderator(id) { return (process.env.VIZIMALL_MODERATOR_CUSTOMER_IDS || '').split(',').map(value => value.trim()).includes(id); }
