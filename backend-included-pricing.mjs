// Private server calculations. Never trust a browser-supplied price or FX rate.
const supported = new Set(['EUR', 'USD', 'PLN']);
function decimal(value) {
  const text = String(value);
  if (!/^\d{1,9}(?:\.\d{1,8})?$/.test(text)) throw new Error('Invalid monetary value');
  const [whole, fraction = ''] = text.split('.');
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}
function rounded(n, d) { return (n * 2n + d) / (2n * d); }
function money(cents, currencyCode) {
  if (cents > 100000000000n) throw new Error('Price outside supported range');
  return { amount: `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`, currencyCode };
}
export function convertCost(cost, currencyCode, fx, now = Date.now()) {
  if (!supported.has(currencyCode) || !supported.has(cost?.currencyCode)) throw new Error('Unsupported currency');
  const value = decimal(cost.amount);
  if (!value.n || cost.currencyCode === currencyCode) return money(rounded(value.n * 100n, value.d), currencyCode);
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(fx?.date || '') && Date.parse(fx.date + 'T00:00:00Z');
  if (!dated || dated > now || now - dated > 7 * 86400000) throw new Error('Fresh exchange rate unavailable');
  const from = decimal(cost.currencyCode === 'EUR' ? '1' : fx.rates?.[cost.currencyCode]);
  const to = decimal(currencyCode === 'EUR' ? '1' : fx.rates?.[currencyCode]);
  if (!from.n || !to.n) throw new Error('Invalid exchange rate');
  return money(rounded(value.n * to.n * from.d * 100n, value.d * to.d * from.n), currencyCode);
}
export function includedPrice({ baseUnitPrice, quantity = 1, supplierCost, fx, now }) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error('Invalid quantity');
  const base = decimal(baseUnitPrice.amount);
  const baseCents = rounded(base.n * 100n, base.d);
  const convertedShipping = convertCost(supplierCost, baseUnitPrice.currencyCode, fx, now);
  const converted = decimal(convertedShipping.amount);
  const shippingCents = rounded(converted.n * 100n, converted.d);
  // freightCalculate returns the freight for the requested quantity: add it ONCE.
  return { baseUnitPrice: money(baseCents, baseUnitPrice.currencyCode), quantity,
    includedShipping: convertedShipping, lineTotal: money(baseCents * BigInt(quantity) + shippingCents, baseUnitPrice.currencyCode),
    customerShippingCharge: money(0n, baseUnitPrice.currencyCode), fxDate: supplierCost.currencyCode === baseUnitPrice.currencyCode || !shippingCents ? null : fx.date };
}
export function baselineForSync(currentPrice, previous) {
  const normalized = convertCost(currentPrice, currentPrice.currencyCode);
  // An unchanged synchronized price retains its original base. A merchant edit
  // becomes the new base instead of repeatedly adding freight to our own price.
  return previous?.lastWritten?.currencyCode === currentPrice.currencyCode &&
    convertCost(previous.lastWritten, currentPrice.currencyCode).amount === normalized.amount ? previous.baseUnitPrice : normalized;
}
export function cheapestMethod(methods) {
  const eligible = methods.filter(method => method.name && /^\d+(?:\s*-\s*\d+)?$/.test(method.transport || '') && method.supplierCost?.currencyCode === 'USD');
  for (const method of eligible) decimal(method.supplierCost.amount);
  return eligible.sort((a, b) => Number(a.supplierCost.amount) - Number(b.supplierCost.amount) ||
    Number(a.transport.split('-').at(-1)) - Number(b.transport.split('-').at(-1)) || a.name.localeCompare(b.name))[0] || null;
}
export function parseEcbRates(xml, now = Date.now()) {
  if (typeof xml !== 'string' || xml.length > 50000) throw new Error('Invalid exchange-rate response');
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const rates = {};
  for (const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[match[1]] = match[2];
  const fx = { date, rates, source: 'ECB' };
  convertCost({ amount: '1', currencyCode: 'USD' }, 'EUR', fx, now);
  return fx;
}
