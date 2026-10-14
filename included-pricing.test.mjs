import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includedPrice, mainCatalogPrice, baselineForSync, cheapestMethod, parseEcbRates, destinationVatBudget } from './backend-included-pricing.mjs';
const now = Date.parse('2026-10-06T10:00:00Z');
const fx = { date: '2026-10-05', rates: { USD: '1.1204', PLN: '4.3' } };
test('Main catalog covers shared normal overhead and declared costs before a flat advertising addition',()=>{
  const args={destination:'GR',baseUnitPrice:{amount:'5.90',currencyCode:'EUR'},supplierCost:{amount:'0',currencyCode:'EUR'},productCost:{amount:'1.36',currencyCode:'EUR'}};
  const price=mainCatalogPrice(args);
  assert.equal(price.lineTotal.amount,'12.90');
  const beforeAdvertising=Number(price.lineTotal.amount)-3;
  const plannedMargin=beforeAdvertising*(1-.24*1.05*1.02-.0499-.05)-1.36*1.02-.35-1.35;
  assert.ok(plannedMargin>=3);
  const freightPrice=mainCatalogPrice({...args,supplierCost:{amount:'10.00',currencyCode:'EUR'}});
  const subtotal=Number(freightPrice.lineTotal.amount)-3;
  assert.ok(subtotal*(1-.24*1.05*1.02-.0499-.05)-11.36*1.02-.35-1.35>=3);
  assert.equal(mainCatalogPrice({...args,quantity:3}).lineTotal.amount,price.lineTotal.amount);
  assert.throws(()=>mainCatalogPrice({...args,baseUnitPrice:{amount:'5.90',currencyCode:'USD'}}));
  assert.throws(()=>mainCatalogPrice({...args,productCost:undefined}));
  assert.throws(()=>mainCatalogPrice({...args,productCost:{amount:'0.00',currencyCode:'EUR'}}));
});

test('Each launch destination budgets CJ gross-value VAT and handling before opening its new price',()=>{
  const args={baseUnitPrice:{amount:'1.00',currencyCode:'EUR'},supplierCost:{amount:'12.98',currencyCode:'USD'},productCost:{amount:'11.85',currencyCode:'USD'},fx,now};
  for(const [destination,vat] of Object.entries(destinationVatBudget)){
    const price=mainCatalogPrice({...args,destination});
    const subtotal=Number(price.lineTotal.amount)-3;
    const cost=(11.85+12.98)/1.1204;
    const margin=subtotal*(1-vat/100*1.05*1.02-.0499-.05)-cost*1.02-.35-1.35;
    assert.ok(margin>=3,`${destination} reserves all planned costs`);
  }
  assert.ok(Number(mainCatalogPrice({...args,destination:'GR'}).lineTotal.amount)>Number(mainCatalogPrice({...args,destination:'DE'}).lineTotal.amount));
  assert.throws(()=>mainCatalogPrice(args),/Destination IOSS budget unavailable/);
  assert.throws(()=>mainCatalogPrice({...args,destination:'US'}),/Destination IOSS budget unavailable/);
});
test('Included shipping converts actual freight once for the requested quantity without multiplying it twice', () => {
  const result = includedPrice({ baseUnitPrice: { amount: '29.90', currencyCode: 'EUR' }, quantity: 3, supplierCost: { amount: '6.60', currencyCode: 'USD' }, fx, now });
  assert.equal(result.includedShipping.amount, '5.89');
  assert.equal(result.lineTotal.amount, '95.59');
  assert.equal(result.customerShippingCharge.amount, '0.00');
});
test('Price resynchronization retains the base and recognizes manual merchant edits', () => {
  const baseUnitPrice = { amount: '29.90', currencyCode: 'EUR' };
  const lastWritten = { amount: '35.79', currencyCode: 'EUR' };
  assert.deepEqual(baselineForSync(lastWritten, { baseUnitPrice, lastWritten }), baseUnitPrice);
  const changed = { amount: '32.90', currencyCode: 'EUR' };
  assert.deepEqual(baselineForSync(changed, { baseUnitPrice, lastWritten }), changed);
});
test('Missing, stale or future currency rates never turn a paid shipment into free shipping', () => {
  for (const invalid of [null, { ...fx, date: '2026-09-01' }, { ...fx, date: '2026-10-08' }, { ...fx, rates: { USD: '0' } }]) {
    assert.throws(() => includedPrice({ baseUnitPrice: { amount: '10', currencyCode: 'EUR' }, supplierCost: { amount: '9', currencyCode: 'USD' }, fx: invalid, now }));
  }
  assert.equal(includedPrice({ baseUnitPrice: { amount: '10', currencyCode: 'EUR' }, supplierCost: { amount: '0', currencyCode: 'USD' }, now }).lineTotal.amount, '10.00');
});
test('The default method has valid cost and transit, selects cheapest, then shortest upper transit estimate', () => {
  const cost = amount => ({ amount, currencyCode: 'USD' });
  assert.equal(cheapestMethod([{ name: 'Slow', transport: '5-7', supplierCost: cost('0') }, { name: 'Fast', transport: '3-5', supplierCost: cost('0') }, { name: 'Missing', supplierCost: cost('0') }, { name: 'Premium', transport: '2-3', supplierCost: cost('9') }]).name, 'Fast');
  assert.equal(cheapestMethod([]), null);
});
test('ECB parsing preserves the date and validates rate direction and cent rounding', () => {
  const parsed = parseEcbRates(`<Cube time='2026-10-05'><Cube currency='USD' rate='1.1204'/><Cube currency='PLN' rate='4.3'/></Cube>`, now);
  assert.equal(parsed.date, fx.date);
  assert.equal(includedPrice({ baseUnitPrice: { amount: '1.00', currencyCode: 'PLN' }, supplierCost: { amount: '1.1204', currencyCode: 'USD' }, fx: parsed, now }).lineTotal.amount, '5.30');
  for (const amount of ['-1', 'NaN', '', '1e3']) assert.throws(() => includedPrice({ baseUnitPrice: { amount, currencyCode: 'EUR' }, supplierCost: { amount: '0', currencyCode: 'USD' }, now }));
});
