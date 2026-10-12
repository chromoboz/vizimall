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
export function mainCatalogPrice(args){
  const unit=includedPrice({...args,quantity:1});
  const base=BigInt(unit.baseUnitPrice.amount.replace('.',''));
  const shipping=BigInt(unit.includedShipping.amount.replace('.',''));
  // A modest reserve covers charges on freight as well as the product. These
  // are merchant pricing assumptions, not a statement of actual tax liability.
  // Merchant's latest instruction: add a flat EUR 3 to each product's sale
  // price for the shared store campaign, without grossing up that addition.
  // This is not EUR 3 net revenue or a profit/no-loss guarantee. Tax and fees
  // can reduce it; actual advertising cost remains outside the profit target.
  if(unit.baseUnitPrice.currencyCode!=='EUR')throw Error('Main catalog requires EUR');
  const advertisingReserve=300n;
  const total=base+(shipping*130n+99n)/100n+advertisingReserve;
  const rounded=total<=90n?90n:((total-90n+99n)/100n)*100n+90n;
  return {...unit,lineTotal:money(rounded,unit.baseUnitPrice.currencyCode)};
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
export function shippingMethods(rows){
  const result=[];
  for(const row of Array.isArray(rows)?rows:[]){
    const name=row.logisticName,transport=String(row.logisticAging||'').trim();
    if(typeof name!=='string'||!name.trim()||name.length>200||!/^\d{1,3}(?:\s*-\s*\d{1,3})?$/.test(transport))continue;
    const days=transport.split('-').map(Number);if(days.some(d=>d<1||d>365)||days[0]>days.at(-1))continue;
    try{
      const freight=decimal(row.logisticPrice);
      let cost;
      if(row.totalPostageFee!=null&&row.totalPostageFee!==''){
        const total=decimal(row.totalPostageFee);
        if(total.n*freight.d<freight.n*total.d)continue;
        cost=convertCost({amount:row.totalPostageFee,currencyCode:'USD'},'USD');
      }else{
        // Include separately reported supplier taxes/clearance fees exactly once.
        const parts=[row.logisticPrice,...['taxesFee','clearanceOperationFee','tariff'].map(key=>row[key]??'0')].map(v=>convertCost({amount:v,currencyCode:'USD'},'USD'));
        cost=money(parts.reduce((sum,p)=>sum+BigInt(p.amount.replace('.','')),0n),'USD');
      }
      result.push({name:name.trim(),transport,supplierCost:cost});
    }catch{/* Missing, malformed or negative prices never qualify a route. */}
  }
  return result;
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
