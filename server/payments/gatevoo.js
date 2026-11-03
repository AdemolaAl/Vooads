// Gatevoo: Zedapex's own non-custodial crypto checkout (USDT, BTC). Contract: docs/GATEVOO-API.md (matches the Gatevoo
// code: src/invoices.js and src/webhooks.js).
// Secret key = Gatevoo API key (gv_live_…). Webhook secret = the app's webhook signing secret in Gatevoo.
// Webhook URL to set on the app inside Gatevoo: {APP_URL}/api/webhooks/gatevoo.
//
// Invoice:  POST {base}/invoices  (base default https://gatevoo.com/api/v1)  Authorization: Bearer <API key>
//           { amount_usd, order_id: "va_<payment id>", customer_email, customer_name?, description, redirect_url, metadata }
//           → 201 { id, status, checkout_url, … }. The checkout page refuses framing: the studio sends the browser there.
// Webhook:  X-Gatevoo-Event, X-Gatevoo-Timestamp (unix seconds), X-Gatevoo-Delivery, X-Gatevoo-Signature
//           signature = lowercase hex HMAC-SHA256(webhook secret, `${timestamp}.${rawBody}`), no prefix.
//           Refused when wrong, missing, or more than 5 minutes old (or in the future).
//           Body { id: "evt_…", type: "invoice.paid" | "invoice.test" | …, created, data: { id, status, amount_usd, order_id, … } }.
//           Credit only for type "invoice.paid" with data.status "paid" and amount_usd ≥ the payment (1 cent tolerance).
//           "invoice.test" (the dashboard's test button) is verified and answered 200 without crediting anything.
//           Gatevoo retries up to 24 hours: billing.markPaid is idempotent, so a repeat never credits twice.
const crypto = require('node:crypto');
const { get } = require('../db');
const { safeEqual } = require('../lib/util');

const MAX_AGE_SEC = 300;
// The API base, always ending in /api/v<n>. Older setups saved "https://api.gatevoo.com" (no version path).
function base(m) {
  let b = String((m.config && m.config.base_url) || 'https://gatevoo.com/api/v1').trim().replace(/\/+$/, '');
  if (b === 'https://api.gatevoo.com') b = 'https://gatevoo.com';
  if (!/\/api\/v\d+$/.test(b)) b += '/api/v1';
  return b;
}

async function checkout(m, { payment, user, amountUsd, description, successUrl }) {
  if (!m.secret) throw new Error('Add the Gatevoo API key in Admin → Payment methods.');
  const r = await fetch(base(m) + '/invoices', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + m.secret, 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': 'va_' + payment.id },
    body: JSON.stringify({
      amount_usd: Math.round(amountUsd * 100) / 100, order_id: 'va_' + payment.id, description: String(description || '').slice(0, 200),
      customer_email: user.email, ...(user.name ? { customer_name: String(user.name).slice(0, 80) } : {}),
      redirect_url: successUrl, metadata: { payment_id: String(payment.id), user_id: String(user.id), app: 'vooads' },
    }),
    signal: AbortSignal.timeout(20e3),
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok || !data.checkout_url || !/^https?:\/\//.test(String(data.checkout_url))) throw new Error('Gatevoo: ' + (data.error?.message || data.error || data.message || 'HTTP ' + r.status));
  return { url: String(data.checkout_url), ref: 'gv_' + (data.id || payment.id) };
}

// Exactly Gatevoo's own signing (src/webhooks.js): hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`).
function sign(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)}`).digest('hex');
}
function sigOk(headers, raw, secret) {
  const t = String(headers['x-gatevoo-timestamp'] || '');
  const sig = String(headers['x-gatevoo-signature'] || '').trim().toLowerCase();
  if (!secret || !/^\d{9,11}$/.test(t) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > MAX_AGE_SEC) return false;
  return safeEqual(sig, sign(secret, t, raw));
}

function webhook(m, req) {
  if (!sigOk(req.headers, req.rawBody, m.webhookSecret)) throw Object.assign(new Error('Bad Gatevoo signature'), { status: 400 });
  let ev;
  try { ev = JSON.parse(req.rawBody.toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const type = String(ev.type || req.headers['x-gatevoo-event'] || '');
  if (type === 'invoice.test') return { type: 'ignore', test: true };
  if (type !== 'invoice.paid') return { type: 'ignore' }; // invoice.expired and anything else: nothing to do
  const d = ev.data || {};
  if (String(d.status || '') !== 'paid') return { type: 'ignore' }; // "review" is never credited automatically
  const paymentId = Number(String(d.order_id || '').replace(/^va_/, '')) || Number(d.metadata?.payment_id);
  const p = paymentId ? get('SELECT COALESCE(charged_usd, amount_usd) AS amount_usd, adapter FROM payments WHERE id = ?', paymentId) : null;
  if (!p || p.adapter !== 'gatevoo') return { type: 'ignore' };
  if (!(Number(d.amount_usd) + 0.01 >= Number(p.amount_usd))) {
    console.warn('[gatevoo] paid amount is lower than the payment', paymentId, d.amount_usd, p.amount_usd);
    return { type: 'ignore' };
  }
  return { type: 'paid', paymentId, ref: 'gv_' + (d.id || paymentId), raw: { event: ev.id, invoice: d.id, txid: d.txid, amount_usd: d.amount_usd, method: d.method, received: d.received } };
}

// Read-only key check for Admin → Integrations: an unknown invoice answers 404 when the key is accepted.
async function testKey(m) {
  if (!m.secret) return { ok: false, note: 'Add the Gatevoo API key first.' };
  let r;
  try { r = await fetch(base(m) + '/invoices/inv_vooads_key_check', { headers: { Authorization: 'Bearer ' + m.secret, Accept: 'application/json' }, signal: AbortSignal.timeout(10e3) }); }
  catch (e) { return { ok: false, note: 'Could not reach Gatevoo at ' + base(m) + ': ' + e.message }; }
  if (r.status === 401 || r.status === 403) return { ok: false, note: 'Gatevoo refused the API key. Copy it again from Gatevoo.' };
  if (r.ok || r.status === 404) return { ok: !!m.webhookSecret, note: 'Gatevoo accepted the API key.' + (m.webhookSecret ? ' Set the webhook URL on your app in Gatevoo and press its Test button.' : ' Add the webhook signing secret so payments are confirmed.') };
  return { ok: false, note: 'Gatevoo answered HTTP ' + r.status + '.' };
}

module.exports = {
  label: 'Gatevoo (crypto: USDT, BTC)', checkout, webhook, recurring: false, fields: ['secret', 'webhookSecret'], sign, sigOk, testKey, base,
  help: 'Secret key = Gatevoo API key. Webhook secret = the app\'s webhook signing secret in Gatevoo. Webhook URL: /api/webhooks/gatevoo',
  config_fields: [
    { key: 'base_url', label: 'API address', help: 'Leave empty for https://gatevoo.com/api/v1 unless Gatevoo gives you another address.', type: 'text' },
  ],
};
