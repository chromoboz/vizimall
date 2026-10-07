import { createHash, randomBytes } from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
export async function store(req) {
  const { getStore } = await import('@netlify/blobs');
  // Runtime CONTEXT is not assumed. Production namespace survives every deploy.
  const hostname = new URL(req.url).hostname;
  const suffix = hostname === 'vizimall.com' ? 'production' : `preview-${hash(hostname).slice(0, 20)}`;
  return getStore({ name: `vizimall-customers-${suffix}`, consistency: 'strong', region: 'eu-central-1' });
}
export async function update(db, key, transform) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = await db.getWithMetadata(key, { type: 'json' });
    const next = await transform(previous?.data || null);
    const result = await db.setJSON(key, next, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
    if (result.modified) return next;
  }
  throw new Error('Concurrent change; please retry');
}
export function cookie(req, name) {
  const value = (req.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function setCookie(name, value, seconds) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}
export async function session(req, db) {
  const id = cookie(req, '__Host-vizi-session');
  const value = id ? await db.get(`sessions/${hash(id)}`, { type: 'json' }) : null;
  if (!value) return null;
  if (value.expiresAt <= Date.now()) { await db.delete(`sessions/${hash(id)}`); return null; }
  return { ...value, key: `sessions/${hash(id)}` };
}
export async function limit(db, key, maximum, windowMs) {
  const window = Math.floor(Date.now() / windowMs);
  await update(db, `rate/${hash(key)}/${window}`, previous => {
    if ((previous?.count || 0) >= maximum) throw new Error('Too many requests');
    return { count: (previous?.count || 0) + 1, expiresAt: (window + 1) * windowMs };
  });
}
