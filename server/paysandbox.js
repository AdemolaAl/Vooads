// Payment method "Test (sandbox)": checks a method's setup without moving money or calling the provider.
//  1. Settings: required keys and fields are there and look right.
//  2. Checkout: for custom APIs, the exact request Vooads would send (secrets masked), built from the templates.
//  3. Webhook: a fake "paid" event, signed the way the provider signs, is run through the method's real webhook code
//     against a temporary payment inside a database savepoint that is rolled back. Nothing is saved.
// The live "Check with provider" button (integrations.testMethod) stays available for a read-only call to the provider.
const crypto = require('node:crypto');
const config = require('./config');
const { db, get, run } = require('./db');
const payments = require('./payments');
const tpl = require('./providers/httptpl');

const hm = (algo, key, data) => crypto.createHmac(algo, String(key || '')).update(data).digest('hex');
const sortKeys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort().reduce((a, k) => ((a[k] = sortKeys(o[k])), a), {}) : o);
// Build {a:{b:1}} from "a.b" paths.
function setPath(obj, path, val) {
  const ks = String(path || '').split('.').filter(Boolean);
  if (!ks.length) return obj;
  let o = obj;
  ks.slice(0, -1).forEach((k) => { if (!o[k] || typeof o[k] !== 'object') o[k] = /^\d+$/.test(k) ? [] : {}; o = o[k]; });
  o[ks[ks.length - 1]] = val;
  return obj;
}

// Run the adapter's webhook against a temporary payment, then roll everything back. Sync adapters only.
function simulate(m, adapterName, amountUsd, makeEvent) {
  const a = payments.ADAPTERS[adapterName];
  db.exec('SAVEPOINT paysbx');
  try {
    const info = run("INSERT INTO payments(user_id, method_id, adapter, kind, topup_id, credits, amount_usd, status) VALUES(NULL, ?, ?, 'topup', 'sandbox', 0, ?, 'pending')", m.id, adapterName, amountUsd);
    const pid = Number(info.lastInsertRowid);
    const { body, headers } = makeEvent(pid);
    const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = { headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), rawBody: raw };
    let ev;
    try { ev = a.webhook(m, req); } catch (e) { return { ok: false, note: 'The webhook check refused a correctly signed test event: ' + e.message }; }
    if (ev && typeof ev.then === 'function') return { ok: true, note: 'Signature check passed (this provider confirms payments with its own API, which the sandbox does not call).' };
    if (ev && ev.type === 'paid' && Number(ev.paymentId) === pid) return { ok: true, note: 'A signed "paid" test event was read correctly: the right payment would be marked paid.' };
    return { ok: false, note: 'The signed test event was accepted but not read as "paid" for the right payment. Check the paid field/value and where the payment id is.' };
  } finally {
    db.exec('ROLLBACK TO paysbx'); db.exec('RELEASE paysbx');
  }
}
// The same event with a wrong signature must be refused.
function refusesBadSignature(m, adapterName, makeEvent) {
  const a = payments.ADAPTERS[adapterName];
  const { body, headers } = makeEvent(999999999);
  const bad = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).replace(/[0-9a-f]/i, (c) => (c === '0' ? '1' : '0')) + 'x']));
  try { const r = a.webhook(m, { headers: bad, rawBody: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) }); if (r && typeof r.then === 'function') r.catch(() => {}); return false; } catch { return true; }
}

function check(row) {
  const m = payments.hydrate(row);
  const c = m.config || {};
  const steps = [];
  const add = (label, ok, note) => steps.push({ label, ok: !!ok, note: note || '' });
  let request = null, instructions = null;
  const ad = m.adapter;
  const sample = 49;
  if (ad === 'manual') {
    add('Bank details', !!(c.account_number || c.instructions), c.account_number ? `${c.bank_name || 'Bank'} · ${c.account_name || ''} · ${c.account_number}` : 'Add the bank name, account name and account number.');
    add('Currency', true, (c.currency || 'USD') + (c.currency && c.currency !== 'USD' ? ` at ${c.usd_rate || '?'} per $1` : ''));
    if (c.currency && String(c.currency).toUpperCase() !== 'USD' && !(Number(c.usd_rate) > 0)) steps[steps.length - 1] = { label: 'Currency', ok: false, note: 'Set the local units per $1 for ' + c.currency + '.' };
    instructions = payments.ADAPTERS.manual.instructions(m, { id: 1042, amount_usd: sample });
  } else if (ad === 'custom') {
    const url = String(c.checkout_url || '');
    add('Create-payment URL', /^https:\/\//.test(url), url ? url : 'Add the URL that creates a payment.');
    const currency = String(c.currency || 'USD').toUpperCase();
    const rate = currency === 'USD' ? Number(c.usd_rate || 1) : Number(c.usd_rate || 0);
    add('Currency and rate', !!rate, rate ? `${currency} · ${rate} per $1` : 'Set the local units per $1 for ' + currency + '.');
    const vars = { amount_usd: sample, amount_local: Math.round(sample * (rate || 1) * 100) / 100, amount_minor: Math.round(sample * (rate || 1) * 100), currency, payment_id: 1042, reference: 'va_1042', email: 'customer@example.com', name: 'Ada Obi', user_id: 7, success_url: config.appUrl + '/app?paid=1042#wallet', cancel_url: config.appUrl + '/app#wallet', webhook_url: `${config.appUrl}/api/webhooks/custom/${m.id}`, description: 'Vooads Pro plan (monthly)', secret: m.secret || '' };
    // Same filling as payments/custom.js (values are JSON-escaped), shown with secrets masked.
    const fill = (t) => String(t || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] === undefined ? '' : JSON.stringify(String(vars[k])).slice(1, -1)));
    let headers = { 'Content-Type': 'application/json' }, body = null, okTpl = true;
    try { if (c.headers_json) headers = { ...headers, ...JSON.parse(fill(c.headers_json)) }; } catch { okTpl = false; add('Headers', false, 'Headers are not valid JSON.'); }
    try { if (String(c.method || 'POST').toUpperCase() !== 'GET') body = JSON.parse(fill(c.body_template || '{"amount":{{amount_local}},"currency":"{{currency}}","reference":"{{reference}}","email":"{{email}}","callback_url":"{{success_url}}"}')); } catch { okTpl = false; add('Body template', false, 'The body template is not valid JSON once filled in.'); }
    if (okTpl) add('Request template', true, 'Headers and body fill in cleanly.');
    request = tpl.mask({ method: String(c.method || 'POST').toUpperCase(), url: url || '(not set)', headers, body }, [m.secret]);
    add('Payment link path', !!c.response_url_path, c.response_url_path ? `Vooads reads the payment link at "${c.response_url_path}" in the answer.` : 'Set where the payment link is in the answer, e.g. data.link.');
    const algo = String(c.signature_algo || 'sha256').toLowerCase();
    const header = String(c.signature_header || '');
    if (!header) add('Webhook signature', false, 'Set the signature header the provider uses, e.g. x-signature.');
    else if (!m.webhookSecret) add('Webhook signature', false, 'Add the webhook signing secret.');
    else {
      const make = (pid) => {
        const ev = {};
        if (c.paid_path) setPath(ev, c.paid_path, isNaN(Number(c.paid_value)) || c.paid_value === '' ? c.paid_value : c.paid_value);
        setPath(ev, c.payment_id_path || 'data.metadata.payment_id', String(pid));
        if (c.amount_path) setPath(ev, c.amount_path, Math.round(sample * (rate || 1) * 100) / 100);
        const raw = JSON.stringify(ev);
        const sig = algo === 'none' ? m.webhookSecret : hm(algo, m.webhookSecret, raw);
        return { body: raw, headers: { [header]: (c.signature_prefix || '') + sig } };
      };
      const r = simulate(m, 'custom', sample, make);
      add('Webhook: signed "paid" event', r.ok, r.note);
      add('Webhook: forged signature refused', refusesBadSignature(m, 'custom', make), 'A wrong signature must never mark a payment paid.');
    }
  } else if (ad === 'gatevoo') {
    add('API key', !!m.secret, m.secret ? 'Saved.' : 'Paste your Gatevoo API key.');
    add('Webhook secret', !!m.webhookSecret, m.webhookSecret ? 'Saved.' : 'Paste the Gatevoo webhook secret.');
    if (m.webhookSecret) {
      // Signed exactly like Gatevoo: hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`), timestamp in X-Gatevoo-Timestamp.
      const make = (pid) => { const raw = JSON.stringify({ id: 'evt_sandbox', type: 'invoice.paid', created: new Date().toISOString(), data: { id: 'inv_sandbox', status: 'paid', order_id: 'va_' + pid, amount_usd: sample, txid: 'sandbox' } }); const t = String(Math.floor(Date.now() / 1000)); return { body: raw, headers: { 'x-gatevoo-event': 'invoice.paid', 'x-gatevoo-timestamp': t, 'x-gatevoo-signature': hm('sha256', m.webhookSecret, t + '.' + raw) } }; };
      const r = simulate(m, 'gatevoo', sample, make); add('Webhook: signed "invoice.paid"', r.ok, r.note);
      add('Webhook: forged signature refused', refusesBadSignature(m, 'gatevoo', make), '');
    }
  } else if (ad === 'bachs') {
    const B = payments.ADAPTERS.bachs;
    add('Secret key', /^sk_(live|sandbox)_/.test(m.secret || ''), m.secret ? (B.isSandbox(m.secret) ? 'Sandbox key: never shown to customers on the live site.' : /^sk_live_/.test(m.secret) ? 'Live key.' : 'Bachs keys start with sk_live_ (or sk_sandbox_).') : 'Paste the Bachs secret key.');
    add('Webhook signing secret', /^whsec_/.test(m.webhookSecret || ''), m.webhookSecret ? 'Saved.' : 'Paste the webhook signing secret (whsec_…).');
    add('Naira rate', Number(c.ngn_rate) > 0, Number(c.ngn_rate) > 0 ? `Nigeria pays ₦${Number(c.ngn_rate).toLocaleString('en-US')} per $1.` : 'Not set: Nigeria pays in US dollars until you set it.');
    if (m.webhookSecret) {
      const make = (pid) => { const raw = JSON.stringify({ type: 'collection.succeeded', data: { checkout_id: 'chk_sbx', reference: 'va_' + pid, status: 'succeeded' } }); return { body: raw, headers: B.sign(raw, m.webhookSecret) }; };
      const r = simulate(m, 'bachs', sample, make); add('Webhook: signed event (signature check)', r.ok, r.note);
      add('Webhook: forged signature refused', refusesBadSignature(m, 'bachs', make), 'A wrong signature must never mark a payment paid.');
    }
  } else if (ad === 'paystack') {
    add('Secret key', /^sk_(live|test)_/.test(m.secret || ''), m.secret ? (/^sk_test_/.test(m.secret) ? 'Test key (no real money).' : /^sk_live_/.test(m.secret) ? 'Live key.' : 'Paystack keys start with sk_live_ or sk_test_.') : 'Paste the secret key.');
    const currency = c.currency || 'NGN', rate = currency === 'USD' ? 1 : Number(c.usd_rate || 0);
    add('Currency and rate', !!rate, rate ? `${currency} · ${rate} per $1` : 'Set the local units per $1.');
    if (m.secret && rate) {
      const make = (pid) => { const raw = JSON.stringify({ event: 'charge.success', data: { reference: `va_${pid}_sbx`, currency, amount: Math.round(sample * rate * 100), metadata: { payment_id: pid } } }); return { body: raw, headers: { 'x-paystack-signature': hm('sha512', m.secret, raw) } }; };
      const r = simulate(m, 'paystack', sample, make); add('Webhook: signed "charge.success"', r.ok, r.note);
    }
  } else if (ad === 'stripe') {
    add('Secret key', /^(sk|rk)_(live|test)_/.test(m.secret || ''), m.secret ? (/_test_/.test(m.secret) ? 'Test key (no real money).' : 'Live key.') : 'Paste the secret key (sk_live_… or sk_test_…).');
    add('Webhook signing secret', /^whsec_/.test(m.webhookSecret || ''), m.webhookSecret ? 'Saved.' : 'Paste the signing secret (whsec_…) from Stripe → Webhooks.');
    if (m.webhookSecret) {
      const make = (pid) => { const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_sbx', payment_status: 'paid', metadata: { payment_id: String(pid) }, amount_total: sample * 100 } } }); const t = Math.floor(Date.now() / 1000); return { body: raw, headers: { 'stripe-signature': `t=${t},v1=${hm('sha256', m.webhookSecret, t + '.' + raw)}` } }; };
      const r = simulate(m, 'stripe', sample, make); add('Webhook: signed "checkout.session.completed"', r.ok, r.note);
    }
  } else if (ad === 'nowpayments') {
    add('API key', !!m.secret, m.secret ? 'Saved.' : 'Paste the API key.');
    add('IPN secret', !!m.webhookSecret, m.webhookSecret ? 'Saved.' : 'Paste the IPN secret key.');
    if (m.webhookSecret) {
      const make = (pid) => { const ev = { payment_status: 'finished', order_id: 'va_' + pid, price_amount: sample, invoice_id: 'sbx' }; return { body: JSON.stringify(ev), headers: { 'x-nowpayments-sig': hm('sha512', m.webhookSecret, JSON.stringify(sortKeys(ev))) } }; };
      const r = simulate(m, 'nowpayments', sample, make); add('Webhook: signed "finished" IPN', r.ok, r.note);
    }
  } else if (ad === 'flutterwave') {
    add('Secret key', /^FLWSECK/.test(m.secret || ''), m.secret ? 'Saved.' : 'Paste the secret key (FLWSECK-…).');
    add('Secret hash', !!m.webhookSecret, m.webhookSecret ? 'Saved. Flutterwave sends it as verif-hash on every webhook.' : 'Make up a secret hash in Flutterwave → Webhooks and paste it here.');
    const currency = c.currency || 'USD', rate = currency === 'USD' ? 1 : Number(c.usd_rate || 0);
    add('Currency and rate', !!rate, rate ? `${currency} · ${rate} per $1` : 'Set the local units per $1.');
  } else if (ad === 'test') add('Development and staging only', config.testPayments, 'The test method only works in development and on staging.');
  else add('Settings', true, 'No sandbox for this provider. Use "Check with provider".');
  const ok = steps.every((x) => x.ok);
  return { ok, steps, request, instructions, note: ok ? 'Everything checks out in the sandbox. Switch it on when you are ready.' : 'Fix the red items, then test again.' };
}

module.exports = { check, setPath };
