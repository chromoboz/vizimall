(function (root) {
  'use strict';
  const countries = Object.freeze({ DE: 'germany', FR: 'france', NL: 'netherlands', PL: 'poland', ES: 'spain', PT: 'portugal', IT: 'italy', GR: 'greece' });
  const stores = Object.freeze(['tech', 'home', 'pets', 'beauty', 'fashion', 'lifestyle']);
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
    async function request(query, variables) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetcher(endpoint, {
          method: 'POST', signal: controller.signal, credentials: 'omit',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': config.publicToken },
          body: JSON.stringify({ query, variables })
        });
        if (!response.ok) throw new Error('Unable to reach the store. Please try again.');
        const body = await response.json();
        if (body.errors?.length || !body.data) throw new Error('Unable to load store information. Please try again.');
        return body.data;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('The store took too long to respond. Please try again.');
        throw error;
      } finally { clearTimeout(timer); }
    }
    const productFields = 'id title description tags availableForSale featuredImage { url altText } priceRange { minVariantPrice { amount currencyCode } }';
    const variantFields = 'id title availableForSale price { amount currencyCode } image { url altText }';
    async function products(country, store, after = null) {
      const { countryTag, storeTag } = routing(country, store);
      const data = await request(`query Products($country: CountryCode!, $filter: String!, $after: String) @inContext(country: $country) {
        products(first: 24, after: $after, query: $filter, sortKey: TITLE) {
          nodes { ${productFields} } pageInfo { hasNextPage endCursor }
        }
      }`, { country, filter: `tag:${countryTag} AND tag:${storeTag}`, after });
      // Also check exact tags locally: Shopify search indexing can lag behind edits.
      return { products: data.products.nodes.filter(p => matches(p, country, store)), pageInfo: data.products.pageInfo };
    }
    async function product(country, store, id) {
      routing(country, store);
      let after = null, item, variants = [];
      do {
        const data = await request(`query Product($country: CountryCode!, $id: ID!, $after: String) @inContext(country: $country) {
          product(id: $id) { ${productFields} variants(first: 100, after: $after) {
            nodes { ${variantFields} } pageInfo { hasNextPage endCursor }
          } }
        }`, { country, id, after });
        item = data.product;
        if (!item || !matches(item, country, store)) throw new Error('This product is no longer available in this store.');
        variants.push(...item.variants.nodes);
        const page = item.variants.pageInfo;
        if (page.hasNextPage && (!page.endCursor || page.endCursor === after)) throw new Error('Unable to load all product options.');
        after = page.hasNextPage ? page.endCursor : null;
      } while (after);
      return { ...item, variants };
    }
    async function checkout(country, lines) {
      if (!Object.hasOwn(countries, country) || !Array.isArray(lines) || !lines.length || lines.length > 50) throw new Error('Please review your cart.');
      const verified = [];
      // Revalidate country/store eligibility and current stock at checkout.
      const details = await Promise.all(lines.map(line => product(country, line.store, line.productId)));
      lines.forEach((line, index) => {
        const variant = details[index].variants.find(v => v.id === line.variantId && v.availableForSale);
        if (!variant || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
          throw new Error('An item is no longer available. Remove it or select another option.');
        }
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
      return url.href;
    }
    return Object.freeze({ products, product, checkout });
  }
  root.VizimallStorefront = Object.freeze({ countries, stores, routing, matches, createClient });
})(typeof window === 'undefined' ? globalThis : window);
