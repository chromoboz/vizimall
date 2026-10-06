import { test } from 'node:test';
import assert from 'node:assert/strict';
import { includedPrice, baselineForSync, cheapestMethod, parseEcbRates } from './backend-included-pricing.mjs';
const now = Date.parse('2026-10-06T10:00:00Z');
const fx = { date: '2026-10-05', rates: { USD: '1.1204', PLN: '4.3' } };
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
