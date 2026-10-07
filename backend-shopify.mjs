export const shopDomain = '8ruphj-0s.myshopify.com';
export const clientId = '58b6b514-bc5e-4384-9a12-08347583d90d';
export const origin = 'https://vizimall.com';
export const nativeAccount = 'https://shopify.com/108550685006/account';
let cachedDiscovery;
export function trustedEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password
    || !['shopify.com', shopDomain].includes(url.hostname)) throw new Error('Untrusted Shopify endpoint');
  return url.href;
}
export async function discovery() {
  if (cachedDiscovery) return cachedDiscovery;
  const replies = await Promise.all(['openid-configuration', 'customer-account-api'].map(async suffix => {
    const response = await fetch(`https://${shopDomain}/.well-known/${suffix}`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error('Shopify discovery unavailable');
    return response.json();
  }));
  const [oauth, api] = replies;
  for (const field of ['authorization_endpoint', 'token_endpoint', 'end_session_endpoint', 'jwks_uri', 'issuer']) oauth[field] = trustedEndpoint(oauth[field]);
  cachedDiscovery = { ...oauth, graphql_api: trustedEndpoint(api.graphql_api) };
  return cachedDiscovery;
}
export async function exchange(code, verifier) {
  const config = await discovery();
  const response = await fetch(config.token_endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin, 'User-Agent': 'VIZIMALL-Customer/1.0' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId,
      redirect_uri: `${origin}/api/callback`, code, code_verifier: verifier })
  });
  if (!response.ok) throw new Error('Customer authentication failed');
  return response.json();
}
export async function query(token, document, variables = {}) {
  const config = await discovery();
  const response = await fetch(config.graphql_api, { method: 'POST', redirect: 'error',
    signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', Authorization: token, Origin: origin },
    body: JSON.stringify({ query: document, variables }) });
  if (!response.ok) throw new Error('Shopify customer data unavailable');
  const data = await response.json();
  if (data.errors?.length) throw new Error('Shopify customer query failed');
  return data.data;
}
const page = 'pageInfo{hasNextPage endCursor}';
const lines = `nodes{id productId variantId name title variantTitle quantity refundableQuantity image{url altText}} ${page}`;
const shipments = `nodes{id status latestShipmentStatus estimatedDeliveryAt trackingInformation{company number url}} ${page}`;
export const profileQuery = `query {customer{id firstName lastName displayName emailAddress{emailAddress}
  defaultAddress{id formatted} addresses(first:100){nodes{id formatted} ${page}}}}`;
export async function customerProfile(token) { const {customer}=await query(token,profileQuery); if(!customer?.id)throw new Error('Customer unavailable');return customer; }
export async function updateCustomerName(token,input) {
  const data=await query(token,`mutation($input:CustomerUpdateInput!){customerUpdate(input:$input){customer{id firstName lastName} userErrors{field message}}}`,{input});
  if(data.customerUpdate.userErrors.length||!data.customerUpdate.customer)throw new Error('Name not saved');
  return data.customerUpdate.customer;
}
export const ordersQuery = `query($after:String){customer{orders(first:50,after:$after,reverse:true){nodes{
  id name processedAt cancelledAt financialStatus fulfillmentStatus statusPageUrl
  totalPrice{amount currencyCode} totalRefunded{amount currencyCode} totalTax{amount currencyCode} totalShipping{amount currencyCode}
  shippingAddress{formatted} lineItems(first:100){${lines}} fulfillments(first:100){${shipments}}
} ${page}}}}`;
// Every order originates from customer.orders. No arbitrary order lookup is exposed.
export async function customerData(token) {
  const { customer } = await query(token, profileQuery);
  if (!customer?.id) throw new Error('Customer unavailable');
  const orders = []; let after = null;
  do {
    const data = await query(token, ordersQuery, { after });
    const connection = data.customer.orders;
    for (const order of connection.nodes) {
      for (const [field, fields] of [['lineItems', lines], ['fulfillments', shipments]]) {
        let connectionPage = order[field];
        while (connectionPage.pageInfo.hasNextPage) {
          const result = await query(token, `query($id:ID!,$after:String){order(id:$id){${field}(first:100,after:$after){${fields}}}}`, { id: order.id, after: connectionPage.pageInfo.endCursor });
          connectionPage = result.order[field]; order[field].nodes.push(...connectionPage.nodes);
        }
      }
      orders.push(order);
    }
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (after);
  return { customer, orders };
}
