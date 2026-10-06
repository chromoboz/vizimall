import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
// Publish only browser assets. Server code, package files and tests stay private.
await mkdir('dist', { recursive: true });
for (const file of await readdir('.')) {
  if (/\.(html|css|js|svg|png|webp|avif)$/.test(file) && !file.endsWith('.test.js')) await copyFile(file, `dist/${file}`);
}
await copyFile('_headers', 'dist/_headers');
await copyFile('map-attribution.txt', 'dist/map-attribution.txt');
await mkdir('.generated/functions', { recursive: true });
await mkdir('.generated/lib', { recursive: true });
await copyFile('backend-shipping.mjs', '.generated/lib/backend-shipping.mjs');
await copyFile('shipping-audit-catalog.mjs', '.generated/lib/shipping-audit-catalog.mjs');
for (const file of ['backend-included-pricing.mjs', 'backend-price-sync.mjs', 'backend-pricing-job.mjs','backend-context-pricing.mjs','backend-context-job.mjs','backend-destinations.mjs','shipping-destinations.js']) await copyFile(file, `.generated/lib/${file}`);
const storefrontConfiguration = await readFile('shopify-config.js', 'utf8');
await writeFile('.generated/functions/shipping.mjs', `import { createShippingHandler } from '../lib/backend-shipping.mjs';\nimport { shippingAuditSkus } from '../lib/shipping-audit-catalog.mjs';\nconst window = {};\n${storefrontConfiguration}\nexport default createShippingHandler({ storefrontConfig: window.VIZIMALL_SHOPIFY, probeSkus: shippingAuditSkus, pricing:true });\n`);
for (const file of ['backend-rules.mjs', 'backend-persistence.mjs', 'backend-reviews.mjs', 'backend-shopify.mjs', 'backend-audience.mjs','backend-profile.mjs']) await copyFile(file, `.generated/lib/${file}`);
const handler = (await readFile('backend-customer.mjs', 'utf8')).replaceAll("from './backend-", "from '../lib/backend-");
await writeFile('.generated/functions/customer.mjs', handler);
const productionRetention = process.env.CONTEXT === 'production';
await writeFile('.generated/functions/pricing-sync.mjs', `import { createContextPricingJob } from '../lib/backend-context-job.mjs';\nconst window = {};\n${storefrontConfiguration}\nexport default createContextPricingJob({production:${productionRetention},storefrontConfig:window.VIZIMALL_SHOPIFY});\nexport const config = {schedule:'*/2 * * * *'};\n`);
await writeFile('.generated/functions/retention.mjs', `import { store } from '../lib/backend-persistence.mjs';
import { purgeAudience } from '../lib/backend-audience.mjs';
export default async function () { if (${productionRetention}) await purgeAudience(await store(new Request('https://vizimall.com'))); return new Response(null, {status:204}); }
export const config = { schedule: '17 3 * * *' };\n`);
