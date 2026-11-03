// Custom payment provider: connect almost any checkout API from the admin, no code.
// Each custom method is its own row (adapter 'custom'); its webhook URL is {APP_URL}/api/webhooks/custom/<methodId>.
// Secret key = provider API key (usable in headers/body as {{secret}}). Webhook secret = the provider's signing secret.
const config = require('../config');
const { get } = require('../db');
const { hmac, safeEqual } = require('../lib/util');

// Read "data.metadata.payment_id" or "items.0.id" from an object.
const pick = (obj, p) => String(p || '').split('.').filter(Boolean).reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
// Fill {{vars}}. Values are JSON-escaped so they are safe inside JSON strings ("{{email}}") and as bare numbers ({{amount_usd}}).
const fill = (tpl, vars) => String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : JSON.stringify(String(vars[k])).slice(1, -1)));
const rateOf = (m) => {
  const currency = String(m.config.currency || 'USD').toUpperCase();
  const rate = currency === 'USD' ? Number(m.config.usd_rate || 1) : Number(m.config.usd_rate || 0);
  return { currency, rate };
};

async function checkout(m, { payment, user, amountUsd, description, successUrl, cancelUrl }) {
  const c = m.config;
  if (!/^https?:\/\//.test(c.checkout_url || '')) throw new Error(`Set the checkout URL for "${m.name}" in Admin → Payment methods.`);
  const { currency, rate } = rateOf(m);
  if (!rate) throw new Error(`Set the USD exchange rate for "${m.name}" in Admin → Payment methods.`);
  const local = Math.round(amountUsd * rate * 100) / 100;
  const vars = {
    amount_usd: Math.round(amountUsd * 100) / 100, amount_local: local, amount_minor: Math.round(local * 100), currency,
    payment_id: payment.id, reference: 'va_' + payment.id, email: user.email, name: user.name || '', user_id: user.id,
    success_url: successUrl, cancel_url: cancelUrl, webhook_url: `${config.appUrl}/api/webhooks/custom/${m.id}`, description, secret: m.secret || '',
  };
  let headers = { 'Content-Type': 'application/json' };
  if (c.headers_json) {
    try { headers = { ...headers, ...JSON.parse(fill(c.headers_json, vars)) }; } catch { throw new Error(`Headers for "${m.name}" are not valid JSON.`); }
  }
  const method = String(c.method || 'POST').toUpperCase();
  let body;
  if (method !== 'GET') {
    const raw = fill(c.body_template || '{"amount":{{amount_local}},"currency":"{{currency}}","reference":"{{reference}}","email":"{{email}}","callback_url":"{{success_url}}"}', vars);
    try { body = JSON.stringify(JSON.parse(raw)); } catch { throw new Error(`The body template for "${m.name}" is not valid JSON after filling in the values.`); }
  }
  const r = await fetch(fill(c.checkout_url, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, encodeURIComponent(v)]))), { method, headers, body, signal: AbortSignal.timeout(20e3) });
  let data = {};
  const text = await r.text();
  try { data = JSON.parse(text); } catch {}
  const url = pick(data, c.response_url_path || 'checkout_url');
  if (!r.ok || typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error(`${m.name}: no checkout link in the reply (HTTP ${r.status}). Check "Checkout link path". ${text.slice(0, 120)}`);
  return { url, ref: `cx${m.id}_${payment.id}` };
}

function webhook(m, req) {
  const c = m.config;
  const algo = String(c.signature_algo || 'sha256').toLowerCase();
  const header = String(c.signature_header || '').toLowerCase();
  if (!m.webhookSecret) throw Object.assign(new Error('Set a webhook secret for this payment method first.'), { status: 400 });
  if (!header) throw Object.assign(new Error('Set the signature header for this payment method first.'), { status: 400 });
  let got = String(req.headers[header] || '').trim();
  const prefix = String(c.signature_prefix || '');
  if (prefix && got.startsWith(prefix)) got = got.slice(prefix.length);
  let ok;
  if (algo === 'none') ok = safeEqual(got, m.webhookSecret); // the provider sends the shared secret as-is (like Flutterwave's verif-hash)
  else if (algo === 'sha256' || algo === 'sha512') ok = safeEqual(hmac(algo, m.webhookSecret, req.rawBody), got.toLowerCase());
  else throw Object.assign(new Error('Unknown signature type'), { status: 400 });
  if (!ok) throw Object.assign(new Error('Bad signature'), { status: 400 });
  let ev;
  try { ev = JSON.parse(req.rawBody.toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const paidValue = c.paid_value === undefined || c.paid_value === '' ? null : String(c.paid_value);
  if (paidValue !== null && String(pick(ev, c.paid_path || 'event')) !== paidValue) return { type: 'ignore' };
  const pidRaw = pick(ev, c.payment_id_path || 'data.metadata.payment_id');
  const paymentId = Number((String(pidRaw ?? '').match(/\d+/) || [])[0]);
  const p = paymentId ? get('SELECT COALESCE(charged_usd, amount_usd) AS amount_usd, method_id, adapter FROM payments WHERE id = ?', paymentId) : null;
  if (!p || p.adapter !== 'custom' || Number(p.method_id) !== Number(m.id)) return { type: 'ignore' };
  if (c.amount_path) {
    const { rate } = rateOf(m);
    const paid = Number(pick(ev, c.amount_path));
    const expected = Math.round(p.amount_usd * (rate || 1) * 100) / 100;
    if (!(paid + 0.01 >= expected)) { console.warn('[custom pay] amount too low', m.id, paymentId, paid, expected); return { type: 'ignore' }; }
  }
  return { type: 'paid', paymentId, ref: `cx${m.id}_${paymentId}` };
}

module.exports = {
  label: 'Custom provider (any checkout API, no code)', checkout, webhook, recurring: false, multiple: true, fields: ['secret', 'webhookSecret'],
  help: 'Works with most providers that give you a checkout link and send a signed webhook. Webhook URL: /api/webhooks/custom/<method id>.',
  config_fields: [
    { key: 'checkout_url', label: 'Checkout API URL', help: 'The provider endpoint that creates a payment and returns a link, e.g. https://api.paystack.co/transaction/initialize', type: 'text' },
    { key: 'method', label: 'HTTP method', help: 'Usually POST.', type: 'select', options: ['POST', 'PUT', 'GET'] },
    { key: 'headers_json', label: 'Headers (JSON)', help: 'Extra headers, e.g. {"Authorization":"Bearer {{secret}}"}. {{secret}} is the secret key saved above.', type: 'textarea' },
    { key: 'body_template', label: 'Body template (JSON)', help: 'Request body with variables: {{amount_usd}} {{amount_local}} {{amount_minor}} {{currency}} {{payment_id}} {{reference}} {{email}} {{name}} {{success_url}} {{cancel_url}} {{webhook_url}} {{description}}. Put text variables in quotes, numbers without.', type: 'textarea' },
    { key: 'response_url_path', label: 'Checkout link path', help: 'Where the payment link is in the reply, e.g. data.authorization_url or data.link.', type: 'text' },
    { key: 'currency', label: 'Currency', help: 'Currency sent to the provider, e.g. USD, NGN, KES.', type: 'text' },
    { key: 'usd_rate', label: 'Local units per 1 USD', help: 'Exchange rate used for {{amount_local}}. 1 for USD.', type: 'number' },
    { key: 'signature_header', label: 'Signature header', help: 'Header the provider signs webhooks with, e.g. x-paystack-signature.', type: 'text' },
    { key: 'signature_algo', label: 'Signature type', help: 'HMAC of the raw body with the webhook secret. "none" = the header must equal the webhook secret exactly.', type: 'select', options: ['sha256', 'sha512', 'none'] },
    { key: 'signature_prefix', label: 'Signature prefix', help: 'Text before the hex signature, e.g. sha256= (leave empty if none).', type: 'text' },
    { key: 'paid_path', label: 'Paid event path', help: 'Field that says what happened, e.g. event or data.status.', type: 'text' },
    { key: 'paid_value', label: 'Paid event value', help: 'Value of that field when the payment succeeded, e.g. charge.success or successful.', type: 'text' },
    { key: 'payment_id_path', label: 'Payment ID path', help: 'Field holding our payment number (or the reference va_123), e.g. data.metadata.payment_id or data.reference.', type: 'text' },
    { key: 'amount_path', label: 'Paid amount path (optional)', help: 'Field with the amount paid in your currency, in main units (not cents), checked against the order, e.g. data.amount. Leave empty to skip.', type: 'text' },
  ],
};
