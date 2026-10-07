import { update } from './backend-persistence.mjs';
import { baselineForSync, cheapestMethod, includedPrice } from './backend-included-pricing.mjs';
// Private integration; not exposed as a public HTTP mutation. The merchant must
// connect a product-only Admin app before any writer can be activated.
export function createAdminPricingClient({ domain, token, tokenProvider, fetcher = fetch }) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain || '') || (!token && typeof tokenProvider !== 'function')) throw new Error('Shopify product-price connection required');
  return async (query, variables) => {
    const response = await fetcher(`https://${domain}/admin/api/2026-10/graphql.json`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token || await tokenProvider() },
      body: JSON.stringify({ query, variables })
    });
    const result = await response.json();
    if (!response.ok || result.errors || !result.data) throw new Error('Shopify price request failed');
    return result.data;
  };
}
export function createAdminPricingClientFromEnv({domain,env=process.env,fetcher=fetch,clock=Date.now}) {
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain||'') || !env.SHOPIFY_ADMIN_CLIENT_ID || !env.SHOPIFY_ADMIN_CLIENT_SECRET) throw new Error('Shopify product-price connection required');
  let access,expires=0,pending;
  const tokenProvider=async()=>{
    if(access&&expires>clock()+60000)return access;
    if(pending)return pending;
    pending=(async()=>{
      const response=await fetcher(`https://${domain}/admin/oauth/access_token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.SHOPIFY_ADMIN_CLIENT_ID,client_secret:env.SHOPIFY_ADMIN_CLIENT_SECRET}).toString()});
      const result=await response.json();
      if(!response.ok || typeof result.access_token!=='string' || !Number.isFinite(result.expires_in) || result.expires_in<=60 || !String(result.scope||'').split(',').includes('write_products'))throw new Error('Shopify product-price authentication unavailable');
      access=result.access_token;expires=clock()+result.expires_in*1000;return access;
    })();
    try{return await pending;}finally{pending=null;}
  };
  return createAdminPricingClient({domain,tokenProvider,fetcher});
}
export async function syncVariantPrice({ admin, db, variantId, expectedSku, quote, fx, apply = false, now = Date.now() }) {
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId || '') || !/^CJ[A-Za-z0-9 _-]{3,190}$/.test(expectedSku || '')) throw new Error('Invalid CJ variant');
  // This writer supports the existing single-country Germany catalog. It must
  // never globally overwrite a price for an item sold in multiple countries.
  if (quote?.status !== 'available' || quote.sku !== expectedSku || quote.destination !== 'DE' || !Number.isFinite(quote.expiresAt) || quote.expiresAt <= now || !quote.checkedAt || (quote.quantity != null && quote.quantity !== 1)) throw new Error('Fresh single-item shipping quote required');
  const method = cheapestMethod(quote.methods || []);
  if (!method) throw new Error('Shipping method unavailable');
  const read = () => admin(`query($id:ID!){shop{currencyCode} node(id:$id){... on ProductVariant{id sku price product{id tags status}}}}`, { id: variantId });
  const current = await read();
  const variant = current.node;
  const countryTags = variant?.product?.tags?.filter(tag => tag.startsWith('country-')) || [];
  if (!variant || variant.sku !== expectedSku || countryTags.length !== 1 || countryTags[0] !== 'country-germany' || current.shop?.currencyCode !== 'EUR') throw new Error('Variant or market eligibility changed');
  const currentPrice = { amount: variant.price, currencyCode: current.shop.currencyCode };
  const key = 'shipping/private/base-price/' + variantId.split('/').at(-1);
  const previous = await db.get(key, { type: 'json' });
  const baseUnitPrice = baselineForSync(currentPrice, previous);
  const pricing = includedPrice({ baseUnitPrice, quantity: 1, supplierCost: method.supplierCost, fx, now });
  const plan = { variantId, sku: expectedSku, currentPrice, ...pricing, method: method.name, destination: 'DE', applied: false };
  if (!apply || currentPrice.amount === pricing.lineTotal.amount) return plan;
  // Recheck immediately before writing; reject another worker or merchant edit.
  const fresh = await read();
  if (fresh.node?.sku !== variant.sku || fresh.node?.price !== variant.price || JSON.stringify(fresh.node?.product) !== JSON.stringify(variant.product)) throw new Error('Product changed; recalculate price');
  // Persist the expected result before the mutation: a successful write followed
  // by a lost response cannot compound shipping on the next run.
  await update(db, key, old => {
    if (JSON.stringify(old) !== JSON.stringify(previous || null)) throw new Error('Concurrent pricing update');
    return { baseUnitPrice, lastWritten: pricing.lineTotal, method: method.name, destination: 'DE', fxDate: pricing.fxDate, checkedAt: quote.checkedAt };
  });
  const changed = await admin(`mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$productId,variants:$variants){productVariants{id price} userErrors{field message}}}`, {
    productId: variant.product.id, variants: [{ id: variantId, price: pricing.lineTotal.amount }]
  });
  const result = changed.productVariantsBulkUpdate;
  if (result?.userErrors?.length || !result?.productVariants?.some(item => item.id === variantId && Number(item.price) === Number(pricing.lineTotal.amount))) throw new Error('Shopify did not confirm the included price');
  return { ...plan, applied: true };
}
