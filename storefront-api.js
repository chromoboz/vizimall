(function (root) {
  'use strict';
  if (typeof module !== 'undefined') require('./shipping-destinations.js');
  const validDestination = code => root.VizimallDestinations.valid(code);
  const countries = Object.freeze({ DE: 'germany', FR: 'france', NL: 'netherlands', PL: 'poland', ES: 'spain', PT: 'portugal', IT: 'italy', GR: 'greece' });
  const stores = Object.freeze(['tech', 'home', 'pets', 'beauty', 'fashion', 'kids', 'auto']);
  function routing(country, store) {
    if (!Object.hasOwn(countries, country) || !stores.includes(store)) throw new Error('Please select a country and store from the mall.');
    return { countryTag: `country-${countries[country]}`, storeTag: `store-${store}` };
  }
  function matches(product, country, store) {
    const { countryTag, storeTag } = routing(country, store);
    return Array.isArray(product.tags) && product.tags.includes(countryTag) && product.tags.includes(storeTag);
  }
  function createClient(config, fetcher = root.fetch.bind(root)) {
    if (!config || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(config.domain) || !config.publicToken || /^(shpat_|shpca_|shpss_|shppa_)/i.test(config.publicToken)) {
      throw new Error('The store connection is unavailable. Please try again later.');
    }
    if (!/^\d{4}-(01|04|07|10)$/.test(config.apiVersion)) throw new Error('The store connection is unavailable.');
    const endpoint = `https://${config.domain}/api/${config.apiVersion}/graphql.json`;
    async function request(query, variables, signal) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      try {
        const response = await fetcher(endpoint, {
          method: 'POST', signal: controller.signal, credentials: 'omit',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': config.publicToken },
          body: JSON.stringify({ query, variables })
        });
        if (!response.ok) throw new Error('Unable to reach the store. Please try again.');
        const body = await response.json();
        if (body.errors?.length && body.errors.every(error => error.extensions?.code === 'ACCESS_DENIED' && error.path?.includes('quantityAvailable')) && query.includes('quantityAvailable')) {
          return request(query.replace(/\bquantityAvailable\b/g, ''), variables, signal);
        }
        if (body.errors?.length || !body.data) throw new Error('Unable to load store information. Please try again.');
        return body.data;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('The store took too long to respond. Please try again.');
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
    const productFields = 'id title description tags availableForSale featuredImage { url altText } priceRange { minVariantPrice { amount currencyCode } }';
    const variantFields = 'id title selectedOptions { name value } availableForSale quantityAvailable currentlyNotInStock price { amount currencyCode } image { url altText }';
    async function products(country, store, after = null, options = {}) {
      const { countryTag, storeTag } = routing(country, store);
      const shippingCountry = options.shippingCountry || country;
      if (!validDestination(shippingCountry)) throw new Error('Choose a supported delivery country.');
      // Collection tags identify the supplier's storefront, not destinations.
      const terms = [countryTag, storeTag].map(tag => 'tag:' + tag);
      const quote = value => '"' + value.replace(/[\\"():*]/g, character => '\\' + character) + '"';
      for (const word of String(options.search || '').trim().split(/\s+/).filter(Boolean)) terms.push('title:' + quote(word) + '*');
      if (options.inStock) terms.push('available_for_sale:true');
      const sortKey = ['low', 'high'].includes(options.sort) ? 'PRICE' : 'TITLE';
      const reverse = options.sort === 'high';
      const listFields = productFields.replace(' description ', ' ');
      const data = await request(`query Products($country: CountryCode!, $filter: String!, $after: String) @inContext(country: $country) {
        products(first: 24, after: $after, query: $filter, sortKey: ${sortKey}, reverse: ${reverse}) {
          nodes { ${listFields} } pageInfo { hasNextPage endCursor }
        }
      }`, { country: shippingCountry, filter: terms.join(' AND '), after }, options.signal);
      // Also check exact tags locally: Shopify search indexing can lag behind edits.
      return { products: data.products.nodes.filter(p => matches(p, country, store)), pageInfo: data.products.pageInfo };
    }
    async function product(country, store, id, signal, shippingCountry = country) {
      routing(country, store);
      if (!validDestination(shippingCountry)) throw new Error('Choose a supported delivery country.');
      let after = null, item, variants = [];
      do {
        const data = await request(`query Product($country: CountryCode!, $id: ID!, $after: String) @inContext(country: $country) {
          product(id: $id) { ${productFields} descriptionHtml delivery:metafield(namespace:"vizimall",key:"delivery_routes"){type value} images(first: 250) { nodes { url altText } } variants(first: 100, after: $after) {
            nodes { ${variantFields} } pageInfo { hasNextPage endCursor }
          } }
        }`, { country: shippingCountry, id, after }, signal);
        item = data.product;
        if (!item || !matches(item, country, store)) throw new Error('This product is no longer available in this store.');
        variants.push(...item.variants.nodes);
        const page = item.variants.pageInfo;
        if (page.hasNextPage && (!page.endCursor || page.endCursor === after)) throw new Error('Unable to load all product options.');
        after = page.hasNextPage ? page.endCursor : null;
      } while (after);
      return { ...item, images: item.images?.nodes || [], variants };
    }
    async function checkout(country, lines) {
      if (!validDestination(country) || !Array.isArray(lines) || !lines.length || lines.length > 50) throw new Error('Please review your cart.');
      const verified = [];
      // Revalidate country/store eligibility and current stock at checkout.
      const details = await Promise.all(lines.map(line => product(line.browsingCountry || country, line.store, line.productId, undefined, country)));
      lines.forEach((line, index) => {
        const variant = details[index].variants.find(v => v.id === line.variantId && v.availableForSale);
        if (!variant || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
          throw new Error('An item is no longer available. Remove it or select another option.');
        }
        if(line.price&&(line.price.currencyCode!==variant.price?.currencyCode||Number(line.price.amount)!==Number(variant.price?.amount)))throw new Error('The checkout price changed. Please refresh the shipping quote.');
        verified.push({ merchandiseId: variant.id, quantity: line.quantity });
      });
      const data = await request(`mutation Checkout($country: CountryCode!, $input: CartInput!) @inContext(country: $country) {
        cartCreate(input: $input) {
          cart { checkoutUrl totalQuantity }
          userErrors { message } warnings { message }
        }
      }`, { country, input: { buyerIdentity: { countryCode: country }, lines: verified, attributes: [{ key: 'vizimall-country', value: country }] } });
      const result = data.cartCreate;
      if (result.userErrors.length) throw new Error(result.userErrors.map(e => e.message).join(' '));
      if (result.warnings?.length) throw new Error(result.warnings.map(e => e.message).join(' ') + ' Please review your cart.');
      if (!result.cart || result.cart.totalQuantity !== verified.reduce((n, l) => n + l.quantity, 0)) throw new Error('Stock changed. Please review your cart quantities.');
      const url = new URL(result.cart.checkoutUrl);
      if (url.protocol !== 'https:' || !(url.hostname === config.domain || url.hostname === 'shopify.com' || url.hostname.endsWith('.shopify.com'))) {
        throw new Error('Unable to open secure checkout. Please try again.');
      }
      // Shopify authenticates an existing Customer Accounts session in checkout.
      // No customer token is sent to or stored in this browser.
      url.searchParams.set('sso', 'silent');
      return url.href;
    }
    return Object.freeze({ products, product, checkout });
  }
  root.VizimallStorefront = Object.freeze({ countries, stores, routing, matches, createClient });
})(typeof window === 'undefined' ? globalThis : window);
