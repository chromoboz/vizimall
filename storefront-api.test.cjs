const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./storefront-api.js');
const api = globalThis.VizimallStorefront;
const config = { domain: 'example.myshopify.com', publicToken: 'public-test-token', apiVersion: '2026-10' };
const productId = 'gid://shopify/Product/1';
const variantId = 'gid://shopify/ProductVariant/11';
const variant = { id: variantId, title: 'Black', availableForSale: true, price: { amount: '12.50', currencyCode: 'EUR' } };
const item = { id: productId, title: 'Lamp', tags: ['country-germany', 'store-tech'], variants: { nodes: [variant], pageInfo: { hasNextPage: false, endCursor: 'last' } } };
const line = { productId, variantId, store: 'tech', quantity: 2 };
function mock(respond) {
  return api.createClient(config, async (url, options) => {
    assert.equal(url, 'https://example.myshopify.com/api/2026-10/graphql.json');
    assert.equal(options.headers['X-Shopify-Storefront-Access-Token'], config.publicToken);
    assert.equal(options.credentials, 'omit');
    return { ok: true, json: async () => respond(JSON.parse(options.body)) };
  });
}
test('All 48 country/store routes require both exact tags', () => {
  for (const country of Object.keys(api.countries)) for (const store of api.stores) {
    const { countryTag, storeTag } = api.routing(country, store);
    assert.ok(api.matches({ tags: [countryTag, storeTag] }, country, store));
    assert.equal(api.matches({ tags: [countryTag] }, country, store), false);
    assert.equal(api.matches({ tags: [storeTag] }, country, store), false);
    assert.equal(api.matches({ tags: [countryTag + '-extra', storeTag] }, country, store), false);
  }
  assert.ok(api.matches({ tags: ['country-germany','country-france','store-tech','store-home'] }, 'FR','home'));
  assert.throws(() => api.routing('GB','tech'));
  assert.throws(() => api.routing('DE','auto'));
});
test('Rejects secret tokens and untrusted endpoints', () => {
  for (const publicToken of ['', 'shpat_secret', 'shpca_secret', 'shpss_secret', 'shppa_secret']) assert.throws(() => api.createClient({ ...config, publicToken }));
  assert.throws(() => api.createClient({ ...config, domain: 'example.myshopify.com.evil.test' }));
});
test('Server filtering, country context, pagination and stale-index protection', async () => {
  const client = mock(({ variables }) => {
    assert.deepEqual(variables, { country: 'DE', filter: 'tag:country-germany AND tag:store-tech', after: 'page-one' });
    return { data: { products: { nodes: [item, { ...item, tags: ['country-france','store-tech'] }], pageInfo: { hasNextPage: true, endCursor: 'page-two' } } } };
  });
  const result = await client.products('DE','tech','page-one');
  assert.equal(result.products.length, 1);
  assert.equal(result.pageInfo.endCursor, 'page-two');
});
test('Loads every variant page', async () => {
  const client = mock(({ variables }) => ({ data: { product: { ...item, variants: { nodes: [variables.after ? { ...variant, id: 'gid://shopify/ProductVariant/12' } : variant], pageInfo: { hasNextPage: !variables.after, endCursor: variables.after ? 'done' : 'next' } } } } }));
  const result = await client.product('DE','tech',productId);
  assert.equal(result.variants.length, 2);
});
test('Product details return the complete photo gallery while keeping variant photos', async () => {
  const photos = [{ url: 'https://cdn.shopify.com/first.jpg', altText: 'Front' }, { url: 'https://cdn.shopify.com/second.jpg', altText: 'Detail' }];
  const client = mock(({ query }) => {
    assert.match(query, /images\(first: 250\)/);
    return { data: { product: { ...item, images: { nodes: photos }, variants: { ...item.variants, nodes: [{ ...variant, image: photos[1] }] } } } };
  });
  const result = await client.product('DE','tech',productId);
  assert.deepEqual(result.images, photos);
  assert.equal(result.variants[0].image.url, photos[1].url);
});
test('Checkout validates tags and variants, then uses Shopify cart and buyer country', async () => {
  let mutation = false;
  const client = mock(({ query, variables }) => {
    if (query.includes('query Product')) return { data: { product: item } };
    mutation = true;
    assert.deepEqual(variables.input.lines, [{ merchandiseId: variantId, quantity: 2 }]);
    assert.equal(variables.input.buyerIdentity.countryCode,'DE');
    return { data: { cartCreate: { cart: { checkoutUrl: 'https://example.myshopify.com/checkouts/test', totalQuantity: 2 }, userErrors: [], warnings: [] } } };
  });
  assert.equal(await client.checkout('DE',[line]), 'https://example.myshopify.com/checkouts/test?sso=silent');
  assert.ok(mutation);
});
test('Changed tags and sold-out variants prevent checkout mutation', async () => {
  for (const product of [{ ...item, tags: ['country-france','store-tech'] }, { ...item, variants: { ...item.variants, nodes: [{ ...variant, availableForSale: false }] } }]) {
    const client = mock(({ query }) => { assert.ok(query.includes('query Product')); return { data: { product } }; });
    await assert.rejects(client.checkout('DE',[line]));
  }
});
test('Checkout reports Shopify errors, stock warnings and refuses untrusted redirects', async () => {
  for (const result of [
    { cart: null, userErrors: [{ message: 'Insufficient stock' }], warnings: [] },
    { cart: { totalQuantity: 2 }, userErrors: [], warnings: [{ message: 'Not available' }] },
    { cart: { checkoutUrl: 'https://example.myshopify.com/checkouts/test', totalQuantity: 1 }, userErrors: [], warnings: [] },
    { cart: { checkoutUrl: 'https://malicious.test/checkout', totalQuantity: 2 }, userErrors: [], warnings: [] }
  ]) {
    const client = mock(({ query }) => query.includes('query Product') ? { data: { product: item } } : { data: { cartCreate: result } });
    await assert.rejects(client.checkout('DE',[line]));
  }
});
test('HTTP and GraphQL failures are surfaced, never an empty collection', async () => {
  const failed = api.createClient(config, async () => ({ ok: false }));
  await assert.rejects(failed.products('DE','tech'));
  const denied = mock(() => ({ errors: [{ message: 'Access denied' }] }));
  await assert.rejects(denied.products('DE','tech'));
});
