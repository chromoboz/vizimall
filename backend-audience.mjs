import { hash, random, update, limit } from './backend-persistence.mjs';

export const consentVersion = '2026-10-03.1';
export const marketingText = 'I agree to receive VIZIMALL news, product updates and offers by email. I can unsubscribe at any time. Signing up is optional and does not affect shopping.';
const paths = ['/', '/index', '/mall', '/tech', '/home', '/pets', '/beauty', '/fashion', '/kids', '/auto', '/account', '/help', '/privacy', '/newsletter'];
export function analyticsInput(input) {
  const path = String(input.path || '').replace(/\.html$/, '') || '/';
  if (input.version !== consentVersion || input.analytics !== true || !paths.includes(path)
    || !/^[a-f0-9-]{36}$/.test(input.session || '') || !/^[a-f0-9-]{36}$/.test(input.event || '')) throw new Error('Invalid measurement');
  return { path, session: input.session, event: input.event };
}
async function readAll(db, prefix) {
  const result = [];
  // The SDK's default automatically retrieves all pages.
  const page = await db.list({ prefix });
  for (const entry of page.blobs) { const item = await db.get(entry.key, { type: 'json' }); if (item) result.push({ key: entry.key, ...item }); }
  return result;
}
export async function recordMeasurement(db, input, now = new Date()) {
  const value = analyticsInput(input), day = now.toISOString().slice(0, 10);
  const sessionKey = `analytics-sessions/${day}/${hash(value.session)}`;
  // Session IDs are random, independent of identity, IP, account and device.
  const result = await update(db, sessionKey, previous => {
    const events = previous?.events || [];
    if (events.includes(value.event)) return previous;
    if (events.length >= 500) throw new Error('Session limit');
    return { day, events: [...events, value.event], paths: { ...(previous?.paths || {}), [value.path]: (previous?.paths?.[value.path] || 0) + 1 }, expiresAt: now.getTime() + 31 * 86400000 };
  });
  return { recorded: result.events.includes(value.event) };
}
export async function measurementReport(db, now = new Date()) {
  const sessions = await readAll(db, 'analytics-sessions/'), days = {};
  for (const session of sessions) {
    if (session.expiresAt <= now.getTime()) { await db.delete(session.key); continue; }
    const day = days[session.day] ||= { day: session.day, sessions: 0, pageviews: 0, paths: {} };
    day.sessions++; day.pageviews += session.events.length;
    for (const [path, count] of Object.entries(session.paths)) day.paths[path] = (day.paths[path] || 0) + count;
  }
  return { days: Object.values(days).sort((a, b) => b.day.localeCompare(a.day)), definition: 'Consenting browser sessions and pageviews only. A session is one browser tab; daily sessions are counted separately. These are not unique people or all site visitors. Blocking scripts, bots and repeated tabs can affect totals. No IP, account, email, referrer or device fingerprint is stored with measurements.' };
}
function emailOf(customer) {
  const email = customer.emailAddress?.emailAddress?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Verified email required');
  return email;
}
export async function newsletterRecord(db, customer, input, now = new Date()) {
  const email = emailOf(customer), key = `newsletter/${hash(email)}`;
  if (input.action === 'unsubscribe') {
    return update(db, key, previous => ({ email, ...(previous || {}), status: 'unsubscribed', withdrawnAt: now.toISOString(), unsubscribeToken: previous?.unsubscribeToken || random() }));
  }
  if (input.action !== 'subscribe' || input.consent !== true || input.version !== consentVersion) throw new Error('Explicit marketing consent required');
  const saved = await update(db, key, previous => {
    if (previous?.status === 'subscribed') return previous;
    return { email, customerId: customer.id, status: 'subscribed', subscribedAt: now.toISOString(), version: consentVersion,
      text: marketingText, privacyNotice: 'https://vizimall.com/privacy.html', source: 'verified-account-newsletter', verification: 'Shopify email-code login followed by separate explicit consent',
      unsubscribeToken: previous?.unsubscribeToken || random(), history: [...(previous?.history || []).slice(-19), { action: 'subscribe', at: now.toISOString(), version: consentVersion }] };
  });
  await db.setJSON(`newsletter-tokens/${hash(saved.unsubscribeToken)}`, { key });
  return saved;
}
export async function newsletterStatus(db, customer) {
  const value = await db.get(`newsletter/${hash(emailOf(customer))}`, { type: 'json' });
  return { email: emailOf(customer), status: value?.status || 'not-subscribed', subscribedAt: value?.subscribedAt, version: consentVersion, text: marketingText };
}
export async function unsubscribeToken(db, token, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) throw new Error('Invalid unsubscribe link');
  // Links contain only a random withdrawal token, never the email or account ID.
  const pointer = await db.get(`newsletter-tokens/${hash(token)}`, { type: 'json' });
  if (pointer) await update(db, pointer.key, previous => {
    if (!previous || previous.unsubscribeToken !== token) throw new Error('Invalid unsubscribe link');
    return { ...previous, status: 'unsubscribed', withdrawnAt: now.toISOString() };
  });
  return { status: 'unsubscribed' }; // Uniform response prevents subscriber enumeration.
}
export async function newsletterReport(db) {
  const items = await readAll(db, 'newsletter/');
  return { subscribed: items.filter(item => item.status === 'subscribed').map(item => ({ email: item.email, subscribedAt: item.subscribedAt, version: item.version, text: item.text, verification: item.verification,
    unsubscribeUrl: `https://vizimall.com/newsletter.html#unsubscribe=${item.unsubscribeToken}` })), withdrawn: items.filter(item => item.status === 'unsubscribed').length };
}
export async function purgeAudience(db, now = new Date()) {
  for (const prefix of ['rate/', 'oauth/', 'sessions/']) for (const record of await readAll(db, prefix)) {
    if (Number.isFinite(record.expiresAt) && record.expiresAt + (prefix === 'rate/' ? 86400000 : 0) <= now.getTime()) await db.delete(record.key);
  }
  for (const record of await readAll(db, 'analytics-sessions/')) if (record.expiresAt <= now.getTime()) await db.delete(record.key);
  for (const record of await readAll(db, 'newsletter/')) {
    if (record.status === 'unsubscribed' && record.withdrawnAt && Date.parse(record.withdrawnAt) + 31 * 86400000 <= now.getTime()) {
      // Retain only an email hash, suppression status and withdrawal date.
      const current = await update(db, record.key, previous => {
        if (previous?.status !== 'unsubscribed' || previous.withdrawnAt !== record.withdrawnAt) return previous;
        return { status: 'unsubscribed', withdrawnAt: record.withdrawnAt };
      });
      if (!current.unsubscribeToken && record.unsubscribeToken) await db.delete(`newsletter-tokens/${hash(record.unsubscribeToken)}`);
    }
  }
}
export async function publicAudience(action, req, db, context, readBody) {
  if (action === 'measure' && req.method === 'POST') {
    await limit(db, `measure-security:${context.ip || 'unknown'}`, 600, 3600000);
    return recordMeasurement(db, await readBody(req, 2000));
  }
  if (action === 'newsletter-unsubscribe' && req.method === 'POST') {
    await limit(db, `unsubscribe-security:${context.ip || 'unknown'}`, 30, 3600000);
    return unsubscribeToken(db, (await readBody(req, 2000)).token);
  }
  return null;
}
