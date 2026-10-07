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
test('Missing public inventory permission preserves detail and never fabricates quantity', async () => {
  let calls = 0;
  const client = mock(({ query }) => {
    calls++;
    if (query.includes('quantityAvailable')) return { errors: [{ extensions: { code: 'ACCESS_DENIED' }, path: ['product','variants','nodes',0,'quantityAvailable'] }] };
    return { data: { product: item } };
  });
  const detail = await client.product('DE', 'tech', productId);
  assert.equal(calls, 2);
  assert.equal(detail.variants[0].quantityAvailable, undefined);
  assert.equal(detail.variants[0].availableForSale, true);
});
test('All 56 country/store routes require both exact tags', () => {
  for (const country of Object.keys(api.countries)) for (const store of api.stores) {
    const { countryTag, storeTag } = api.routing(country, store);
    assert.ok(api.matches({ tags: [countryTag, storeTag] }, country, store));
    assert.equal(api.matches({ tags: [countryTag] }, country, store), false);
    assert.equal(api.matches({ tags: [storeTag] }, country, store), false);
    assert.equal(api.matches({ tags: [countryTag + '-extra', storeTag] }, country, store), false);
  }
  assert.ok(api.matches({ tags: ['country-germany','country-france','store-tech','store-home'] }, 'FR','home'));
  assert.throws(() => api.routing('GB','tech'));
  assert.throws(() => api.routing('DE','unknown'));
  assert.equal(api.routing('DE', 'auto').storeTag, 'store-auto');
  assert.equal(api.matches({ tags: ['country-germany', 'store-fashion'] }, 'DE', 'auto'), false);
});
test('Rejects secret tokens and untrusted endpoints', () => {
  for (const publicToken of ['', 'shpat_secret', 'shpca_secret', 'shpss_secret', 'shppa_secret']) assert.throws(() => api.createClient({ ...config, publicToken }));
  assert.throws(() => api.createClient({ ...config, domain: 'example.myshopify.com.evil.test' }));
});
test('Server filtering, country context, pagination and stale-index protection', async () => {
  const client = mock(({ variables }) => {
    assert.deepEqual(variables, { country: 'DE', language: 'DE', filter: 'tag:country-germany AND tag:store-tech', after: 'page-one' });
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

test('Checkout language follows the supplier mall while pricing and delivery follow the destination', async () => {
  for(const[browsingCountry,language]of Object.entries({DE:'DE',GR:'EL',FR:'FR',IT:'IT',ES:'ES',NL:'NL',PL:'PL',PT:'PT_PT'})){
    const client=mock(({query,variables})=>{
      if(query.includes('query Product'))return{data:{product:{...item,tags:[api.routing(browsingCountry,'tech').countryTag,'store-tech']}}};
      assert.match(query,/@inContext\(country: \$country, language: \$language\)/);
      assert.equal(variables.language,language);
      assert.equal(variables.input.buyerIdentity.countryCode,'US');
      return{data:{cartCreate:{cart:{checkoutUrl:'https://example.myshopify.com/checkouts/test',totalQuantity:2},userErrors:[],warnings:[]}}};
    });
    await client.checkout('US',[{...line,browsingCountry}],browsingCountry);
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
test('Search and global price sorting keep pages small and omit detail payloads', async () => {
  const client = mock(({query, variables}) => {
    assert.match(query, /products\(first: 24/);
    assert.match(query, /sortKey: PRICE, reverse: true/);
    assert.doesNotMatch(query, /description|images\(|variants\(/);
    assert.equal(variables.filter, 'tag:country-germany AND tag:store-tech AND title:"Lamp"* AND available_for_sale:true');
    return {data:{products:{nodes:[item],pageInfo:{hasNextPage:false,endCursor:'last'}}}};
  });
  await client.products('DE','tech',null,{search:'Lamp',sort:'high',inStock:true});
});
test('User search punctuation is escaped instead of changing country/store constraints', async () => {
  const client = mock(({variables}) => {
    assert.ok(variables.filter.startsWith('tag:country-germany AND tag:store-tech AND title:'));
    assert.ok(variables.filter.includes('\\"'));
    assert.ok(variables.filter.includes('\\:'));
    return {data:{products:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}};
  });
  await client.products('DE','tech',null,{search:'" OR tag:country-france'});
});
test('Changing a filter or closing a detail can abort the in-flight fetch', async () => {
  const controller = new AbortController();
  const client = api.createClient(config, async (url, options) => {
    await new Promise((resolve,reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'),{name:'AbortError'})), {once:true});
    });
  });
  const pending = client.products('DE','tech',null,{signal:controller.signal});
  controller.abort();
  await assert.rejects(pending);
});
