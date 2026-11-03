// Bachs (bachs.io): hosted checkout for African cards, bank transfer, mobile money and USDT/USDC. Same rules as
// Replyvoo's and Castvoo's Bachs code, on Vooads' own payments.
//
// WHO SEES IT. Customers in the countries set on the method (Admin → Payment methods → Bachs → Countries; default the
// African countries Bachs serves) AND customers whose country is not known yet. Nigeria pays in naira (NGN) at the
// admin's "Naira per US dollar" rate; everyone else pays in US dollars. Plans and credits are always worth the USD price.
//
// KEYS. Admin → Payment methods → Bachs: Secret key (sk_live_…, or sk_sandbox_… for testing) and Webhook secret (whsec_…),
// saved encrypted like every method. A sandbox key is never shown to customers on the live site (test payments would give
// real plans and credits): only on staging, or with BACHS_ALLOW_SANDBOX=true. Admin → Integrations → Test checks the key.
//
// API. sk_live_ → https://api.bachs.io/v1, sk_sandbox_ → https://sandbox-api.bachs.io/v1 (BACHS_API_BASE: tests only).
//   POST /checkout-sessions        start a checkout (Idempotency-Key = our reference)
//   GET  /checkout-sessions/:id    read it back with our own key before giving anything
// WEBHOOK  POST /api/webhooks/bachs. X-Bachs-Signature = hex HMAC-SHA256(webhook secret, "<X-Bachs-Timestamp>.<raw body>"),
// at most 5 minutes old ("Bachs-Signature" / "Bachs-Timestamp" and the "t=…,v1=…" form are accepted too). Wrong or
// missing → refused before anything is read. A valid webhook only makes us ASK Bachs: the payment is marked paid only
// when Bachs itself says COMPLETED/SUCCEEDED for OUR checkout id and reference, in the currency we asked, for at least the
// amount we asked. billing.markPaid is idempotent, so repeats never give twice. Bachs unreachable → 502 so it retries.
const crypto = require('node:crypto');
const config = require('../config');
const { get, all, run } = require('../db');
const { safeEqual } = require('../lib/util');

const COUNTRIES = ['NG', 'KE', 'GH', 'ZA', 'CM', 'UG', 'TZ', 'RW', 'ZM', 'ET', 'EG', 'MA', 'CI', 'SN', 'BJ', 'TG', 'SL', 'LR', 'ZW', 'BW'];
const NAIRA = ['NG'];
const PAID = ['COMPLETED', 'SUCCEEDED', 'PAID'];
const DEAD = ['FAILED', 'EXPIRED', 'CANCELLED', 'CANCELED'];
const KEY_RE = /^sk_(live|sandbox)_[\w-]{8,}$/;
const WEBHOOK_RE = /^whsec_[\w-]{8,}$/;

// Payment rows remember what the customer was asked to pay in their currency (additive migration).
try {
  const cols = all('PRAGMA table_info(payments)').map((c) => c.name);
  if (!cols.includes('currency')) run('ALTER TABLE payments ADD COLUMN currency TEXT');
  if (!cols.includes('amount_local')) run('ALTER TABLE payments ADD COLUMN amount_local REAL');
} catch (e) { console.error('[bachs] migrate', e.message); }

const isSandbox = (key) => /^sk_sandbox_/.test(String(key || ''));
const allowSandbox = () => config.isStaging || /^(1|true|yes)$/i.test(String(process.env.BACHS_ALLOW_SANDBOX || ''));
const baseFor = (key) => String(process.env.BACHS_API_BASE || (isSandbox(key) ? 'https://sandbox-api.bachs.io' : 'https://api.bachs.io')).replace(/\/+$/, '') + '/v1';
const ngnRate = (m) => Number(m.config?.ngn_rate) > 0 ? Number(m.config.ngn_rate) : 0;

// Naira rate age: a warning in the admin after 7 days; with "pause when stale" on, naira checkout stops after 30 days
// (an old rate undercharges when the naira falls). ngn_rate_updated_at is set by the admin route whenever the rate changes.
const STALE_WARN_DAYS = 7, STALE_BLOCK_DAYS = 30;
function staleness(m, nowMs = Date.now()) {
  if (!ngnRate(m)) return { days: null, warn: false, block: false };
  const at = Date.parse(m.config?.ngn_rate_updated_at || '');
  const days = Number.isFinite(at) ? Math.floor((nowMs - at) / 864e5) : null;
  const pause = ['yes', 'true', '1', true].includes(m.config?.block_when_stale);
  const old = days === null || days >= STALE_WARN_DAYS;
  // A sudden fall of the naira (feed > 5% above the saved rate, automatic rate off) also pauses naira checkout (server/fx.js).
  const fxPaused = !!m.config?.fx_paused;
  return { days, warn: old || fxPaused, block: fxPaused || (pause && (days === null || days >= STALE_BLOCK_DAYS)), fx_paused: fxPaused, updated_at: Number.isFinite(at) ? new Date(at).toISOString() : null };
}
function warnings(m) {
  const s = staleness(m), out = [];
  const fx = require('../fx');
  if (m.config?.fx_paused) out.push(`The naira weakened more than 5% (feed ₦${Number(m.config.fx_paused.feed).toLocaleString('en-US')} per $1). Naira checkout is paused until you save a new rate.`);
  if (m.config?.fx_pending_lower) out.push(`The feed shows a lower rate (₦${Number(m.config.fx_pending_lower.rate).toLocaleString('en-US')}, ${m.config.fx_pending_lower.drop_pct}% lower). It needs your approval.`);
  if (m.config?.fx_last_error) out.push(`Rate feed problem: ${m.config.fx_last_error} The last rate is kept.`);
  if (!s.warn || m.config?.fx_paused) return out;
  const when = s.days === null ? 'The naira rate has no update date yet' : `The naira rate is ${s.days} days old`;
  return [...out, `${when}. Nigeria pays ₦${ngnRate(m).toLocaleString('en-US')} per $1. Check today's rate and save it again.${s.block ? ' Naira checkout is paused until you do.' : ''}`];
}
// NGN for Nigeria (when a rate is set), USD for everyone else and for unknown countries.
// Plain facts for the admin (not warnings): the naira rate customers pay, with the FX buffer.
function notes(m) { return ngnRate(m) ? [`Naira rate customers pay: ${require('../fx').explain(m)}. Use the rate you actually buy dollars at, not the official rate.`] : []; }
function currencyFor(m, country) { return NAIRA.includes(String(country || '').toUpperCase()) && ngnRate(m) > 0 ? 'NGN' : 'USD'; }
// Naira = USD × rate × (1 + FX buffer) (server/fx.js).
function localAmount(m, usd, currency) { return currency === 'NGN' ? Math.round(usd * require('../fx').effectiveRate(m) * 100) / 100 : Math.round(usd * 100) / 100; }

// Payment cap: Bachs takes at most this many US dollars per payment (Admin → Payment methods → Bachs → "Bachs max per
// payment (USD)"; empty = env BACHS_MAX_USD, else 5000). The amount checked is the final total the customer pays, the
// customer fee included; a naira amount is turned back into dollars at the same effective rate the checkout used.
// Over the cap → never sent to Bachs (one-off, plans and auto-renew products alike); customers pay in parts or pick
// another method. billing.startCheckout refuses it before a payment row exists; checkout() below refuses it again.
const DEFAULT_MAX_USD = 5000;
function maxUsd(m) {
  const v = m && m.config ? m.config.max_usd : undefined;
  if (v !== undefined && v !== null && v !== '' && Number(v) > 0) return Number(v);
  const e = Number(process.env.BACHS_MAX_USD);
  return e > 0 ? e : DEFAULT_MAX_USD;
}
const fmtUsd = (n) => '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
function capMessage(m) { return `Bachs takes up to ${fmtUsd(maxUsd(m))} per payment. Pay in parts, or choose another method.`; }
// The amount in US dollars: naira ÷ the effective rate (rate + FX buffer) used for the checkout, to the cent.
function usdValue(m, amount, currency) {
  const n = Number(amount);
  if (currency !== 'NGN') return Math.round(n * 100) / 100;
  const rate = require('../fx').effectiveRate(m);
  return rate > 0 ? Math.round((n / rate) * 100) / 100 : Infinity;
}
function overCap(m, amount, currency) { return usdValue(m, amount, currency) > maxUsd(m) + 1e-9; }
function capError(m) { return Object.assign(new Error(capMessage(m)), { status: 400, customer: true, over_cap: true }); }

// Why this method must not be shown to customers right now (null = fine). Used by payments.forCountry and checkout.
function hidden(m) {
  if (!m.secret || !m.webhookSecret) return 'Add the Bachs secret key and the webhook signing secret.';
  if (!KEY_RE.test(m.secret)) return 'The Bachs secret key must start with sk_live_ (or sk_sandbox_ for testing).';
  if (!WEBHOOK_RE.test(m.webhookSecret)) return 'The Bachs webhook signing secret must start with whsec_.';
  if (isSandbox(m.secret) && !allowSandbox()) return 'This is a Bachs sandbox (test) key: it is never shown to customers on the live site. Use your sk_live_ key.';
  return null;
}

async function checkout(m, { payment, user, amountUsd, description, successUrl, cancelUrl }) {
  const why = hidden(m);
  if (why) throw new Error(why);
  const currency = currencyFor(m, user.country);
  if (currency === 'NGN' && staleness(m).block) throw Object.assign(new Error('Naira payments are paused for a moment while we update the exchange rate. Pick another payment method or try again later.'), { status: 409, customer: true });
  const amount = localAmount(m, amountUsd, currency);
  if (overCap(m, amount, currency)) throw capError(m); // never send Bachs a payment over the cap
  const reference = 'va_' + payment.id;
  run('UPDATE payments SET currency = ?, amount_local = ? WHERE id = ?', currency, amount, payment.id);
  let j = {}, status = 0;
  try {
    const r = await fetch(baseFor(m.secret) + '/checkout-sessions', {
      method: 'POST', signal: AbortSignal.timeout(20e3),
      headers: { Authorization: 'Bearer ' + m.secret, 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': reference },
      body: JSON.stringify({
        pricing: { currency, amount: amount.toFixed(2), price_type: 'fixed' }, reference,
        success_url: successUrl, cancel_url: cancelUrl,
        customer: { email: user.email, ...(user.name ? { name: String(user.name).slice(0, 80) } : {}) },
        metadata: { app: 'vooads', reference, payment_id: String(payment.id), kind: payment.kind, description: String(description || '').slice(0, 120), amount_usd: Number(amountUsd).toFixed(2) },
        expires_in_minutes: 60,
      }),
    });
    status = r.status; j = await r.json().catch(() => ({}));
  } catch (e) { j = { message: e.message }; }
  const d = j && j.data && typeof j.data === 'object' ? j.data : j;
  const url = d && d.checkout_url; const id = d && (d.checkout_id || d.id);
  if (!url || !id || !/^https:\/\//.test(String(url))) {
    const why2 = (d && (d.message || (d.error && (d.error.message || d.error)))) || (status ? 'HTTP ' + status : 'no checkout');
    throw new Error('Bachs could not start the payment: ' + String(why2).slice(0, 160));
  }
  return { url: String(url), ref: 'bachs_' + String(id).slice(0, 120) };
}

// Signature over "<timestamp>.<raw body>", at most 5 minutes old.
function sigOk(headers, raw, secret) {
  // X-Bachs-Signature-V2: "t=<ts>,v1=<hex>[,v1=<hex>]" (several v1 digests while the secret rotates). Preferred by Bachs.
  const v2 = String(headers['x-bachs-signature-v2'] || '');
  if (v2) {
    const parts = v2.split(',').map((x) => x.trim().split('=')).filter((x) => x.length === 2);
    const t2 = (parts.find((x) => x[0] === 't') || [])[1] || '';
    const sigs = parts.filter((x) => x[0] === 'v1').map((x) => x[1].toLowerCase());
    if (!secret || !sigs.length || !/^\d+$/.test(t2) || Math.abs(Date.now() / 1000 - Number(t2)) > 300) return false; // malformed V2 never falls back
    const want = crypto.createHmac('sha256', secret).update(t2 + '.').update(raw).digest('hex');
    return sigs.some((x) => safeEqual(x, want));
  }
  const hs = String(headers['x-bachs-signature'] || headers['bachs-signature'] || '');
  const kv = Object.fromEntries(hs.split(',').map((x) => x.trim().split('=')).filter((x) => x.length === 2));
  const t = String(headers['x-bachs-timestamp'] || headers['bachs-timestamp'] || kv.t || '');
  const sig = String(kv.v1 || kv.sha256 || (hs.includes(',') ? '' : hs)).replace(/^(sha256=|v\d=)/, '').trim();
  if (!secret || !sig || !/^\d+$/.test(t) || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  return safeEqual(sig.toLowerCase(), crypto.createHmac('sha256', secret).update(t + '.').update(raw).digest('hex'));
}
function sign(raw, secret, t = Math.floor(Date.now() / 1000)) {
  return { 'x-bachs-timestamp': String(t), 'x-bachs-signature': crypto.createHmac('sha256', secret).update(t + '.').update(raw).digest('hex') };
}

// Reads the checkout back from Bachs with our own key. Resolves { type: 'paid', paymentId, ref } only when Bachs says it
// is paid, for our checkout and reference, in our currency, for at least our amount. Failed/expired → the pending payment
// is marked failed (a later "completed" answer still pays it). Throws 502 when Bachs cannot be asked (Bachs retries).
async function confirm(m, p) {
  const checkoutId = String(p.provider_ref || '').replace(/^bachs_/, '');
  if (!checkoutId) return { type: 'ignore' };
  let r;
  try { r = await fetch(baseFor(m.secret) + '/checkout-sessions/' + encodeURIComponent(checkoutId), { headers: { Authorization: 'Bearer ' + m.secret, Accept: 'application/json' }, signal: AbortSignal.timeout(20e3) }); }
  catch { throw Object.assign(new Error('Bachs could not be reached'), { status: 502 }); }
  if (!r.ok) {
    if (r.status >= 500 || r.status === 429) throw Object.assign(new Error('Bachs answered HTTP ' + r.status), { status: 502 });
    return { type: 'ignore' };
  }
  const raw = await r.json().catch(() => ({}));
  const s = raw && raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const st = String(s.status || '').toUpperCase(), ps = String(s.payment_status || '').toUpperCase();
  const reference = 'va_' + p.id;
  if ((s.reference && String(s.reference) !== reference) || (s.checkout_id && String(s.checkout_id) !== checkoutId)) {
    console.warn('[bachs] checkout does not belong to payment', p.id);
    return { type: 'ignore' };
  }
  if (PAID.includes(st) || ps === 'SUCCEEDED') {
    const pr = s.pricing || {};
    const cur = String(s.currency || pr.currency || '').toUpperCase();
    const paid = Number(String(s.amount ?? pr.amount ?? '').replace(',', '.'));
    const wantCur = p.currency || 'USD', want = Number(p.amount_local ?? p.charged_usd ?? p.amount_usd);
    if (!Number.isFinite(paid) || paid <= 0 || cur !== wantCur || paid + 0.001 < want) {
      console.warn('[bachs] amount or currency mismatch', p.id, paid, cur, 'wanted', want, wantCur);
      run("UPDATE payments SET review_note = ? WHERE id = ? AND status = 'pending'", 'Bachs: amount or currency did not match. Check in Bachs.', p.id);
      return { type: 'ignore' };
    }
    const txid = (s.charge && (s.charge.id || s.charge.payment_id)) || checkoutId;
    return { type: 'paid', paymentId: p.id, ref: p.provider_ref, raw: { bachs_status: st || ps, bachs_payment: String(txid).slice(0, 120), currency: cur, amount: paid } };
  }
  if (DEAD.includes(st) || ps === 'FAILED') {
    run("UPDATE payments SET status = 'failed', review_note = ? WHERE id = ? AND status = 'pending'", 'Bachs: payment ' + (st || ps).toLowerCase(), p.id);
    return { type: 'ignore' };
  }
  return { type: 'ignore' };
}

// Not async on purpose: a bad signature throws at once (the admin sandbox relies on that); the rest is a promise.
function webhook(m, req) {
  if (!sigOk(req.headers, req.rawBody, m.webhookSecret)) throw Object.assign(new Error('Bad Bachs signature'), { status: 401 });
  let ev;
  try { ev = JSON.parse(req.rawBody.toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  // Auto-renew: subscription and invoice events (payments/bachs-subs.js), each handled once.
  if (require('./bachs-subs').isSubEvent(ev)) return require('./bachs-subs').handle(m, ev);
  const d = (ev && (ev.data && typeof ev.data === 'object' ? ev.data : ev)) || {};
  const obj = d.object && typeof d.object === 'object' ? d.object : d;
  const checkoutId = String(obj.checkout_id || obj.checkout_session_id || obj.id || '');
  const reference = String(obj.reference || (obj.metadata && obj.metadata.reference) || '');
  const byRef = /^va_\d+$/.test(reference) ? get("SELECT * FROM payments WHERE id = ? AND adapter = 'bachs'", Number(reference.slice(3))) : null;
  const byCheckout = checkoutId ? get("SELECT * FROM payments WHERE provider_ref = ? AND adapter = 'bachs'", 'bachs_' + checkoutId) : null;
  const p = byCheckout || byRef;
  if (!p || !['pending', 'failed', 'review'].includes(p.status)) return Promise.resolve({ type: 'ignore' }); // paid or refunded: never again
  return confirm(m, p);
}

// Admin "Check with provider": ask Bachs for a made-up checkout. 404 means the key was accepted, 401/403 means not.
async function testKey(m) {
  if (!m.secret) return { ok: false, note: 'Add the Bachs secret key first.' };
  if (!KEY_RE.test(m.secret)) return { ok: false, note: 'The Bachs secret key must start with sk_live_ (or sk_sandbox_ for testing).' };
  let r;
  try { r = await fetch(baseFor(m.secret) + '/checkout-sessions/cs_vooads_key_check', { headers: { Authorization: 'Bearer ' + m.secret, Accept: 'application/json' }, signal: AbortSignal.timeout(10e3) }); }
  catch { return { ok: false, note: 'Could not reach Bachs. Try again in a minute.' }; }
  if (r.status === 401 || r.status === 403) return { ok: false, note: 'Bachs refused the secret key. Copy it again from Bachs → Developer Portal → API keys.' };
  if (r.ok || [400, 404, 422].includes(r.status)) {
    const why = hidden(m);
    return { ok: true, note: 'Connected. Bachs accepted the ' + (isSandbox(m.secret) ? 'sandbox' : 'live') + ' key.' + (m.webhookSecret ? '' : ' Add the webhook signing secret too.') + (why && m.webhookSecret ? ' Customers do not see it yet: ' + why : '') + (ngnRate(m) ? ' Nigeria pays ₦' + ngnRate(m).toLocaleString('en-US') + ' per $1.' : ' Set the naira rate so Nigeria can pay in naira (until then everyone pays in US dollars).') };
  }
  return { ok: false, note: 'Bachs answered HTTP ' + r.status + '. Try again in a minute.' };
}

// What the customer will pay with this method (shown before they leave for Bachs).
function quote(m, country, usd) { const currency = currencyFor(m, country); return { currency, amount: localAmount(m, usd, currency) }; }

module.exports = {
  label: 'Bachs (Africa: naira, cards, bank, mobile money)', checkout, webhook,
  // recurring: false = no Stripe-style recurring on every Bachs payment. Card auto-renew is its own flow (bachs-subs.js),
  // chosen per checkout with "Renew automatically"; bank, mobile money and crypto stay one-off.
  recurring: false, subscriptions: true, baseFor, fields: ['secret', 'webhookSecret'],
  showUnknownCountry: true, defaultCountries: COUNTRIES, hidden, quote, maxUsd, capMessage, usdValue, overCap, capError, DEFAULT_MAX_USD, staleness, warnings, notes, STALE_WARN_DAYS, STALE_BLOCK_DAYS, testKey, sigOk, sign, confirm, currencyFor, localAmount, isSandbox, COUNTRIES,
  help: 'Secret key = Bachs secret key (sk_live_…). Webhook secret = Bachs webhook signing secret (whsec_…). Webhook URL: /api/webhooks/bachs. Nigeria pays in naira at the rate below; other countries pay in US dollars.',
  config_fields: [
    { key: 'ngn_rate', label: 'Naira per 1 US dollar', help: 'Nigeria pays the US-dollar price × this rate, in naira. Update it regularly: after 7 days the admin shows a warning. Empty or 0 = Nigeria pays in US dollars.', type: 'number' },
    { key: 'fx_buffer_pct', label: 'FX buffer %', help: 'Added on top of the rate: naira price = US-dollar price × rate × (1 + buffer). Use the rate you actually buy dollars at, not the official rate.', type: 'number', default: '0' },
    { key: 'fx_auto', label: 'Update the rate automatically', help: 'Off until a rate source is set (below, or FX_RATE_URL on the server). Checked every hour. Raises apply at once; a drop of more than 2% waits for your approval.', options: ['no', 'yes'], default: 'no' },
    { key: 'fx_url', label: 'Rate source (JSON URL)', help: 'Any USD/NGN feed you trust that returns JSON. Leave empty to use FX_RATE_URL.', type: 'text' },
    { key: 'fx_json_path', label: 'Where the rate is in the JSON', help: 'Dots between keys, e.g. rates.NGN or data.0.rate. Empty = a plain number, or a field named NGN or rate.', type: 'text' },
    { key: 'recurring', label: 'Auto-renew for card payments', help: 'Yes = monthly and yearly plans paid by card renew automatically through Bachs (customers can turn it off at checkout). Bank transfer, mobile money and crypto are always one-off. If the Bachs key has no subscription access, checkout quietly uses one-off payments.', options: ['yes', 'no'], default: 'yes' },
    { key: 'grace_days', label: 'Days a failed card renewal keeps the plan', help: 'Bachs retries the card meanwhile. After this the plan ends like an expired plan. Default 7.', type: 'number', default: '7' },
    { key: 'max_usd', label: 'Bachs max per payment (USD)', help: 'Bachs takes at most this much per payment, the customer fee included (naira counted at the rate customers pay). Bigger payments never go to Bachs: customers pay in parts or pick another method, and a card auto-renew that would go over turns into a one-off payment with a reminder. Empty = BACHS_MAX_USD on the server, else 5000.', type: 'number', default: '5000' },
    { key: 'block_when_stale', label: 'Pause naira checkout when the rate is 30+ days old', help: 'Yes = Nigerian customers cannot pay in naira until you save a fresh rate (they can still use other methods).', options: ['no', 'yes'], default: 'no' },
  ],
};
