import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
// Publish only browser assets. Server code, package files and tests stay private.
await mkdir('dist', { recursive: true });
for (const file of await readdir('.')) {
  if (/\.(html|css|js|svg|png)$/.test(file) && !file.endsWith('.test.js')) await copyFile(file, `dist/${file}`);
}
await copyFile('_headers', 'dist/_headers');
await copyFile('map-attribution.txt', 'dist/map-attribution.txt');
await mkdir('.generated/functions', { recursive: true });
await mkdir('.generated/lib', { recursive: true });
for (const file of ['backend-rules.mjs', 'backend-persistence.mjs', 'backend-reviews.mjs', 'backend-shopify.mjs', 'backend-audience.mjs']) await copyFile(file, `.generated/lib/${file}`);
const handler = (await readFile('backend-customer.mjs', 'utf8')).replaceAll("from './backend-", "from '../lib/backend-");
await writeFile('.generated/functions/customer.mjs', handler);
const productionRetention = process.env.CONTEXT === 'production';
await writeFile('.generated/functions/retention.mjs', `import { store } from '../lib/backend-persistence.mjs';
import { purgeAudience } from '../lib/backend-audience.mjs';
export default async function () { if (${productionRetention}) await purgeAudience(await store(new Request('https://vizimall.com'))); return new Response(null, {status:204}); }
export const config = { schedule: '17 3 * * *' };\n`);
