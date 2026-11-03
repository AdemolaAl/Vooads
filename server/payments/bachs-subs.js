// Bachs auto-renewing plans (card only). Monthly and yearly plans paid with Bachs can renew by themselves; everything
// else (bank transfer, mobile money, crypto) stays a one-off payment with the manual renewal and the reminder emails.
//
// HOW BACHS DOES IT (docs.bachs.io and the official SDKs, see docs/BACHS.md → "Auto-renew"):
//   POST   /v1/products                     a product with billing_cycle {interval: month|year, frequency: 1}
//   POST   /v1/checkout-sessions            product_cart [{product_id}] + customer: completing it creates the subscription
//                                           (Bachs has no create-subscription endpoint)
//   GET    /v1/subscriptions/:id            read back before giving anything
//   PATCH  /v1/subscriptions/:id            product_id: move the subscriber to a new price
//   DELETE /v1/subscriptions/:id            cancel_at_period_end: true → the plan runs to the end of the period
//   POST   /v1/customers/:id/portal-sessions  hosted page where the customer updates the card
//   Webhooks: invoice.paid (first charge and every renewal), invoice.payment_failed, customer.subscription.created /
//   updated / deleted. Delivered at least once, so every event id is stored and handled only once.
//
// SAFETY
//   - Credits only after invoice.paid AND Bachs's own GET /subscriptions/:id says the subscription is ours and active.
//   - One renewal = one payments row (provider_ref bachs_inv_<invoice id>, unique) = billing.markPaid → activatePlan,
//     the same code path as every other plan payment. A repeated or replayed event never gives credits twice.
//   - The 4% Bachs customer fee stays inside the price (surcharge.quote). The naira price follows the current FX rate
//     and buffer (fx.effectiveRate). When that raises the price, the subscription is moved to a new Bachs price for the
//     next cycle and the reminder email shows the new amount. If Bachs refuses the move, the renewal still gives the
//     credits it paid for, the payment is flagged for admin when it is under the plan's base price, and the move is
//     tried again.
//   - Payment cap (bachs.maxUsd, default $5,000 per payment, fee inside, naira at the effective rate): a recurring
//     product over the cap is never made, and a subscriber is never moved to a price over it. When the renewal price
//     would go over, the subscription ends at the end of the paid period (nothing more is charged by card), the row is
//     flagged for admin, and the customer gets the one-off renewal reminder to pay in the wallet instead.
//   - Flag: Admin → Payment methods → Bachs → "Auto-renew for card payments" (on by default; env BACHS_RECURRING=off
//     turns it off). If Bachs refuses to make the recurring product (key without subscription access, product not set
//     up), checkout quietly falls back to a one-off payment and the reason is shown in the admin for a day.
const config = require('../config');
const { get, all, run, J } = require('../db');
const { now, addDays } = require('../lib/util');

const GRACE_DAYS = 7;          // Bachs retries the card; the plan stays usable this long after the period ends
const UNAVAILABLE_RETRY_H = 24; // after Bachs refused the recurring product, try again after this long

try {
  run(`CREATE TABLE IF NOT EXISTS bachs_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, method_id INTEGER, sub_id TEXT UNIQUE, customer_id TEXT,
    plan_id TEXT, period TEXT, currency TEXT, amount_local REAL, amount_usd REAL, product_id TEXT, first_payment_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', current_period_end TEXT, paid_through TEXT, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0, past_due_since TEXT, last_failure TEXT, grace_until TEXT,
    next_amount_local REAL, next_product_id TEXT, price_move TEXT, flag TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  run('CREATE INDEX IF NOT EXISTS bachs_subs_user ON bachs_subscriptions(user_id)');
  run('CREATE TABLE IF NOT EXISTS bachs_events (event_id TEXT PRIMARY KEY, type TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP)');
  run(`CREATE TABLE IF NOT EXISTS bachs_products (plan_id TEXT, period TEXT, currency TEXT, amount TEXT, product_id TEXT NOT NULL,
    method_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (plan_id, period, currency, amount, method_id))`);
  const cols = all('PRAGMA table_info(payments)').map((c) => c.name);
  if (!cols.includes('review_flag')) run('ALTER TABLE payments ADD COLUMN review_flag TEXT');
} catch (e) { console.error('[bachs-subs] migrate', e.message); }

const bachs = () => require('./bachs');
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const money = (cur, n) => (cur === 'NGN' ? '₦' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '$' + Number(n).toFixed(2));
const ACTIVE = ['active', 'trialing'];

function saveMethodConfig(m, patch) {
  const row = get('SELECT config FROM payment_methods WHERE id = ?', m.id);
  if (!row) return;
  const c = { ...J(row.config, {}), ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete c[k];
  run('UPDATE payment_methods SET config = ? WHERE id = ?', JSON.stringify(c), m.id);
  m.config = c;
}

// Feature flag: on unless switched off, and not while Bachs recently refused to make recurring products.
function enabled(m) {
  if (/^(0|off|false|no)$/i.test(String(process.env.BACHS_RECURRING || ''))) return false;
  if (!m || !m.config) return false;
  if (['no', 'false', '0', false].includes(m.config.recurring)) return false;
  const u = m.config.recurring_unavailable;
  if (u && Date.now() - Date.parse(u.at || 0) < UNAVAILABLE_RETRY_H * 36e5) return false;
  return true;
}

async function api(m, method, path, body, idem) {
  let r;
  try {
    r = await fetch(bachs().baseFor(m.secret) + path, {
      method, signal: AbortSignal.timeout(20e3),
      headers: { Authorization: 'Bearer ' + m.secret, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw Object.assign(new Error('Bachs could not be reached'), { status: 502, network: true }); }
  const j = await r.json().catch(() => ({}));
  const d = j && j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? j.data : j;
  if (!r.ok) {
    const msg = (d && (d.message || (d.error && (d.error.message || d.error)))) || 'HTTP ' + r.status;
    throw Object.assign(new Error('Bachs: ' + String(msg).slice(0, 160)), { status: r.status >= 500 || r.status === 429 ? 502 : r.status, http: r.status });
  }
  return d || {};
}

// The price this customer pays for this plan with Bachs right now: base price + Bachs customer fee, then naira at the
// current effective FX rate (rate + buffer) for Nigeria. Same numbers as a one-off Bachs checkout.
function currentPrice(m, plan, period, country, currencyHint) {
  const base = period === 'year' ? Number(plan.price_year) : Number(plan.price_month);
  const fq = require('../surcharge').quote(m, base);
  const currency = currencyHint || bachs().currencyFor(m, country);
  return { base_usd: fq.base_usd, total_usd: fq.total_usd, fee_usd: fq.fee_usd, fee_pct: fq.fee_pct, currency, amount: bachs().localAmount(m, fq.total_usd, currency) };
}

// One Bachs recurring product per plan, period, currency and amount. A new price = a new product (old subscribers are
// moved to it for their next cycle). Bachs refusing (no subscription access, bad setup) marks recurring unavailable.
async function ensureProduct(m, plan, period, currency, amount) {
  if (bachs().overCap(m, amount, currency)) throw bachs().capError(m); // never a recurring price over the Bachs cap
  const amt = Number(amount).toFixed(2);
  const row = get('SELECT product_id FROM bachs_products WHERE plan_id = ? AND period = ? AND currency = ? AND amount = ? AND method_id = ?', plan.id, period, currency, amt, m.id);
  if (row) return row.product_id;
  let d;
  try {
    d = await api(m, 'POST', '/products', {
      name: `Vooads ${plan.name} (${period === 'year' ? 'yearly' : 'monthly'})`,
      price: { currency, amount: amt, price_type: 'fixed' },
      billing_cycle: { interval: period === 'year' ? 'year' : 'month', frequency: 1 },
      metadata: { app: 'vooads', plan_id: plan.id, period },
    }, `va_prod_${plan.id}_${period}_${currency}_${amt}_${m.id}`);
  } catch (e) {
    if (!e.network && e.status !== 502) saveMethodConfig(m, { recurring_unavailable: { at: now(), reason: e.message } });
    throw Object.assign(e, { fallback: true });
  }
  const pid = d.id || d.product_id;
  if (!pid) throw Object.assign(new Error('Bachs made no product id'), { fallback: true });
  run('INSERT OR IGNORE INTO bachs_products(plan_id, period, currency, amount, product_id, method_id) VALUES(?,?,?,?,?,?)', plan.id, period, currency, amt, String(pid), m.id);
  if (m.config && m.config.recurring_unavailable) saveMethodConfig(m, { recurring_unavailable: undefined });
  return String(pid);
}

// Subscription checkout. Throws { fallback: true } when Bachs cannot do recurring right now: billing.js then runs the
// normal one-off checkout instead, so the customer never sees an error for it.
async function checkout(m, { payment, user, plan, period, successUrl, cancelUrl }) {
  if (!enabled(m)) throw Object.assign(new Error('Auto-renew is off for Bachs'), { fallback: true });
  const why = bachs().hidden(m);
  if (why) throw new Error(why);
  const price = currentPrice(m, plan, period, user.country);
  if (bachs().overCap(m, price.amount, price.currency)) throw bachs().capError(m);
  if (price.currency === 'NGN' && bachs().staleness(m).block) throw Object.assign(new Error('Naira payments are paused for a moment while we update the exchange rate. Pick another payment method or try again later.'), { status: 409, customer: true });
  const productId = await ensureProduct(m, plan, period, price.currency, price.amount);
  const reference = 'va_' + payment.id;
  run('UPDATE payments SET currency = ?, amount_local = ? WHERE id = ?', price.currency, price.amount, payment.id);
  let d;
  try {
    d = await api(m, 'POST', '/checkout-sessions', {
      product_cart: [{ product_id: productId, quantity: 1 }], reference,
      customer: { email: user.email, ...(user.name ? { name: String(user.name).slice(0, 80) } : {}) },
      success_url: successUrl, cancel_url: cancelUrl,
      metadata: { app: 'vooads', reference, payment_id: String(payment.id), user_id: String(user.id), plan_id: plan.id, period, kind: 'plan', amount_usd: price.base_usd.toFixed(2) },
    }, reference + '_sub');
  } catch (e) { if (!e.network && e.http && [401, 403].includes(e.http)) saveMethodConfig(m, { recurring_unavailable: { at: now(), reason: e.message } }); throw Object.assign(e, { fallback: !e.network }); }
  const url = d.checkout_url || d.url, id = d.checkout_id || d.id;
  if (!url || !id || !/^https:\/\//.test(String(url))) throw Object.assign(new Error('Bachs could not start the subscription checkout'), { fallback: true });
  run(`INSERT INTO bachs_subscriptions(user_id, method_id, plan_id, period, currency, amount_local, amount_usd, product_id, first_payment_id, status)
       VALUES(?,?,?,?,?,?,?,?,?, 'pending')`, user.id, m.id, plan.id, period, price.currency, price.amount, price.base_usd, productId, payment.id);
  return { url: String(url), ref: 'bachs_' + String(id).slice(0, 120), recurring: true };
}

// ---------- Webhooks ----------
const SUB_EVENTS = /^(customer\.subscription\.|invoice\.)/;
const isSubEvent = (ev) => !!(ev && SUB_EVENTS.test(String(ev.type || '')));
const objOf = (ev) => { const d = ev && ev.data && typeof ev.data === 'object' ? ev.data : (ev || {}); return d.object && typeof d.object === 'object' ? d.object : d; };
const isoOf = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); const t = Number.isFinite(n) && String(v).match(/^\d+$/) ? (n < 1e12 ? n * 1000 : n) : Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const subIdOf = (o) => String(o.subscription_id || (o.subscription && typeof o.subscription === 'object' ? o.subscription.id : o.subscription) || '');
const periodEndOf = (o) => isoOf(o.current_period_end || o.period_end || (o.period && o.period.end) || (o.lines && o.lines[0] && o.lines[0].period && o.lines[0].period.end));

// Bachs's own view of the subscription (never trust the webhook body alone).
async function fetchSub(m, subId) { return api(m, 'GET', '/subscriptions/' + encodeURIComponent(subId)); }

function rowFor(subId, meta = {}) {
  let row = subId ? get('SELECT * FROM bachs_subscriptions WHERE sub_id = ?', subId) : null;
  if (row) return row;
  // First time we hear of it: link it to the pending row made at checkout (Bachs copies checkout metadata onto it).
  const pid = Number(meta.payment_id || String(meta.reference || '').replace(/^va_/, ''));
  if (pid) row = get("SELECT * FROM bachs_subscriptions WHERE first_payment_id = ? AND sub_id IS NULL", pid);
  if (row && subId) run('UPDATE bachs_subscriptions SET sub_id = ?, updated_at = ? WHERE id = ?', subId, now(), row.id);
  return row ? get('SELECT * FROM bachs_subscriptions WHERE id = ?', row.id) : null;
}

// Event id → handled once. Without an id, a stable key from the type and the object.
function claim(ev) {
  const o = objOf(ev);
  const key = String(ev.id || `${ev.type}:${o.id || ''}:${o.status || ''}:${o.current_period_end || o.period_end || ''}`);
  return run('INSERT OR IGNORE INTO bachs_events(event_id, type) VALUES(?,?)', key.slice(0, 200), String(ev.type || '')).changes > 0 ? key : null;
}
const unclaim = (key) => key && run('DELETE FROM bachs_events WHERE event_id = ?', key);

async function handle(m, ev) {
  const key = claim(ev);
  if (!key) return { type: 'ignore', duplicate: true };
  try {
    const type = String(ev.type), o = objOf(ev);
    if (type.startsWith('customer.subscription.')) return await onSubscription(m, type, o);
    if (type === 'invoice.paid' || type === 'invoice.payment_succeeded') return await onInvoicePaid(m, o);
    if (type === 'invoice.payment_failed') return await onInvoiceFailed(m, o);
    return { type: 'ignore' };
  } catch (e) { unclaim(key); throw e; } // Bachs retries; nothing was given
}

function syncFrom(row, s) {
  const st = String(s.status || '').toLowerCase();
  const end = periodEndOf(s);
  const cust = s.customer_id || (s.customer && typeof s.customer === 'object' ? s.customer.id : s.customer) || null;
  const cape = s.cancel_at_period_end === true || s.cancel_at_period_end === 1 ? 1 : (s.cancel_at_period_end === false ? 0 : row.cancel_at_period_end);
  run(`UPDATE bachs_subscriptions SET status = COALESCE(?, status), current_period_end = COALESCE(?, current_period_end), customer_id = COALESCE(?, customer_id),
       cancel_at_period_end = ?, updated_at = ? WHERE id = ?`, st || null, end, cust ? String(cust) : null, cape, now(), row.id);
  const pid = s.product_id || (s.product && (s.product.id || s.product)) || null;
  if (pid && row.next_product_id && String(pid) === row.next_product_id) // Bachs confirms the move to the new price
    run('UPDATE bachs_subscriptions SET product_id = next_product_id, amount_local = next_amount_local, next_product_id = NULL, next_amount_local = NULL, price_move = ? WHERE id = ?', 'moved ' + now().slice(0, 10), row.id);
  return get('SELECT * FROM bachs_subscriptions WHERE id = ?', row.id);
}

async function onSubscription(m, type, o) {
  const subId = String(o.id || o.subscription_id || '');
  let row = rowFor(subId, o.metadata || {});
  const s = await fetchSub(m, subId);
  if (!row) row = rowFor(subId, s.metadata || {});
  if (!row) return { type: 'ignore' };
  if (s.metadata && s.metadata.app && s.metadata.app !== 'vooads') return { type: 'ignore' };
  row = syncFrom(row, s);
  const st = String(s.status || '').toLowerCase();
  if (type === 'customer.subscription.deleted' || ['canceled', 'cancelled', 'ended', 'expired'].includes(st)) {
    run("UPDATE bachs_subscriptions SET status = 'canceled', updated_at = ? WHERE id = ?", now(), row.id);
    run('UPDATE users SET auto_renew = 0 WHERE id = ?', row.user_id); // the plan runs to its paid end, then expires as usual
  } else if (row.cancel_at_period_end) run('UPDATE users SET auto_renew = 0 WHERE id = ?', row.user_id);
  else if (ACTIVE.includes(st) && row.paid_through) run('UPDATE users SET auto_renew = 1 WHERE id = ?', row.user_id);
  return { type: 'subscription', status: st };
}

async function onInvoicePaid(m, o) {
  const subId = subIdOf(o);
  const invId = String(o.id || o.invoice_id || '');
  if (!subId || !invId) return { type: 'ignore' };
  const ref = 'bachs_inv_' + invId.slice(0, 100);
  if (get('SELECT 1 FROM payments WHERE provider_ref = ?', ref)) return { type: 'ignore', duplicate: true };
  // Ask Bachs: the subscription must be ours and active (a paid invoice turns it active).
  const s = await fetchSub(m, subId);
  let row = rowFor(subId, o.metadata || (o.subscription_details && o.subscription_details.metadata) || {}) || rowFor(subId, s.metadata || {});
  if (!row) return { type: 'ignore' };
  const st = String(s.status || '').toLowerCase();
  if ((s.metadata && s.metadata.app && s.metadata.app !== 'vooads') || !ACTIVE.includes(st)) return { type: 'ignore' };
  row = syncFrom(row, s);
  const paidCur = String(o.currency || (o.amount && o.amount.currency) || row.currency || '').toUpperCase();
  const paid = Number(String(o.amount_paid ?? o.total ?? o.amount ?? '').replace(',', '.'));
  if (!(paid > 0) || paidCur !== row.currency) {
    console.warn('[bachs-subs] invoice amount/currency not usable', invId, paid, paidCur);
    run('UPDATE bachs_subscriptions SET flag = ? WHERE id = ?', `Invoice ${invId}: amount or currency did not match (${paid} ${paidCur}). Check in Bachs.`, row.id);
    return { type: 'ignore' };
  }
  const periodEnd = periodEndOf(o) || periodEndOf(s);
  const firstPay = row.first_payment_id ? get('SELECT * FROM payments WHERE id = ?', row.first_payment_id) : null;
  const plan = require('../settings').planById(row.plan_id);
  if (!plan) return { type: 'ignore' };

  // First invoice = the checkout payment. Pay that payment row (once); never a second row for the same period.
  const isFirst = o.billing_reason === 'subscription_create' || (firstPay && !row.paid_through);
  if (isFirst && firstPay) {
    if (firstPay.status !== 'paid' && paid + 0.001 >= Number(firstPay.amount_local ?? firstPay.charged_usd)) {
      require('../billing').markPaid(firstPay.id, { autoRenew: true, ref: firstPay.provider_ref, raw: { bachs_invoice: invId, currency: paidCur, amount: paid } });
    }
    run("UPDATE bachs_subscriptions SET paid_through = ?, status = ?, fail_count = 0, past_due_since = NULL, grace_until = NULL, updated_at = ? WHERE id = ?", periodEnd || addDays(now(), row.period === 'year' ? 365 : 30), st, now(), row.id);
    run("UPDATE payments SET raw = json_set(COALESCE(raw,'{}'), '$.bachs_invoice', ?) WHERE id = ?", invId, firstPay.id);
    run('UPDATE users SET auto_renew = ? WHERE id = ?', row.cancel_at_period_end ? 0 : 1, row.user_id);
    return { type: 'subscription_first' };
  }
  if (row.paid_through && periodEnd && periodEnd <= row.paid_through) return { type: 'ignore', duplicate: true }; // period already paid

  // A renewal: one payments row, paid through the normal plan path (billing.markPaid → activatePlan).
  const m2 = currentPrice(m, plan, row.period, null, row.currency);
  const usdPaidNow = row.currency === 'NGN' ? r2(paid / (require('../fx').effectiveRate(m) || 1)) : paid;
  const baseUsd = Number(row.period === 'year' ? plan.price_year : plan.price_month);
  const feeUsd = r2(usdPaidNow - baseUsd);
  const ins = run(`INSERT INTO payments(user_id, method_id, adapter, kind, plan_id, period, credits, amount_usd, fee_pct, fee_usd, charged_usd, currency, amount_local, provider_ref, status)
     VALUES(?,?, 'bachs', 'plan', ?,?,?,?,?,?,?,?,?,?, 'pending')`, row.user_id, m.id, plan.id, row.period, plan.credits_month, baseUsd, m2.fee_pct, Math.max(0, feeUsd), usdPaidNow, row.currency, paid, ref);
  const payId = Number(ins.lastInsertRowid);
  // Margin check: what Bachs charged, at today's rate, against today's price and the plan's base price (the floor).
  let flag = null;
  if (paid + 0.01 < m2.amount) {
    flag = usdPaidNow < baseUsd
      ? `Renewal under the margin floor: charged ${money(row.currency, paid)} (≈ $${usdPaidNow.toFixed(2)}), plan base price $${baseUsd.toFixed(2)}, today's price ${money(row.currency, m2.amount)}. Credits given; subscriber moved to the new price.`
      : `Renewal under today's price (${money(row.currency, paid)} vs ${money(row.currency, m2.amount)}); still above the base price. Subscriber moved to the new price.`;
    run('UPDATE payments SET review_flag = ? WHERE id = ?', flag, payId);
  }
  // Bachs says a new period started and is paid: the plan's credits refresh now (activatePlan's new-period branch), even
  // when the invoice lands a little before our own 30-day credit date.
  run('UPDATE users SET plan_credits_reset_at = ? WHERE id = ? AND plan_id = ?', now(), row.user_id, plan.id);
  require('../billing').markPaid(payId, { autoRenew: true, ref, raw: { bachs_invoice: invId, bachs_subscription: subId, currency: paidCur, amount: paid } });
  const end = periodEnd || addDays(row.paid_through || now(), row.period === 'year' ? 365 : 30);
  // Bachs's period end is the truth: a grace extension never adds free days on top of the paid period.
  run('UPDATE users SET plan_expires_at = ?, auto_renew = ? WHERE id = ? AND plan_id = ?', addDays(end, 1), row.cancel_at_period_end ? 0 : 1, row.user_id, plan.id);
  run(`UPDATE bachs_subscriptions SET paid_through = ?, status = ?, fail_count = 0, past_due_since = NULL, grace_until = NULL, last_failure = NULL,
       flag = COALESCE(?, flag), updated_at = ? WHERE id = ?`, end, st, flag, now(), row.id);
  if (paid + 0.01 < m2.amount) await movePrice(m, get('SELECT * FROM bachs_subscriptions WHERE id = ?', row.id)).catch(() => {});
  return { type: 'bachs_renewed', paymentId: payId };
}

async function onInvoiceFailed(m, o) {
  const subId = subIdOf(o);
  const row = rowFor(subId, o.metadata || {});
  if (!row) return { type: 'ignore' };
  const u = get('SELECT * FROM users WHERE id = ?', row.user_id);
  const end = row.paid_through || row.current_period_end || (u && u.plan_expires_at) || now();
  const grace = addDays(end, Number(m.config && m.config.grace_days) > 0 ? Number(m.config.grace_days) : GRACE_DAYS);
  const reason = String(o.failure_message || o.last_payment_error?.message || o.failure_reason || 'The card was declined.').slice(0, 200);
  run(`UPDATE bachs_subscriptions SET status = 'past_due', fail_count = fail_count + 1, past_due_since = COALESCE(past_due_since, ?), last_failure = ?, grace_until = COALESCE(grace_until, ?), updated_at = ? WHERE id = ?`,
    now(), reason, grace, now(), row.id);
  // Keep the plan usable while Bachs retries (no new credits: those come only with a paid invoice).
  if (u && u.plan_id === row.plan_id && u.plan_expires_at < grace) run('UPDATE users SET plan_expires_at = ? WHERE id = ?', grace, u.id);
  if (u && !row.past_due_since) {
    const plan = require('../settings').planById(row.plan_id);
    const amt = Number(o.amount_due ?? o.amount ?? row.amount_local);
    require('../email').queue('payment_failed', u.email, { plan: plan ? plan.name : 'Vooads', amount: money(row.currency, amt > 0 ? amt : row.amount_local), grace_date: require('../email').fmtDate(grace) }, { userId: u.id });
  }
  return { type: 'payment_failed' };
}

// ---------- Price follows FX ----------
// The current price (fee inside, naira at today's rate + buffer) is above what the subscription charges: make a product
// at the new price and move the subscription to it for the next cycle. Never lowers a price automatically.
async function movePrice(m, row) {
  const plan = require('../settings').planById(row.plan_id);
  if (!plan || !row.sub_id || ['canceled'].includes(row.status) || row.cancel_at_period_end) return null;
  const want = currentPrice(m, plan, row.period, null, row.currency);
  // Over the Bachs cap (the new price, or the current one after the admin lowered the cap): never moved; one-off instead.
  if (bachs().overCap(m, want.amount, row.currency) || bachs().overCap(m, row.amount_local, row.currency)) return capFallback(m, row, plan, want);
  // Already moving to this price (Bachs accepted) → nothing to do. A refused move is tried again.
  const accepted = row.next_amount_local && /^Moving/.test(String(row.price_move || ''));
  const charging = Number(accepted ? row.next_amount_local : row.amount_local);
  if (!(want.amount > charging + 0.009)) return null;
  let productId;
  try { productId = await ensureProduct(m, plan, row.period, row.currency, want.amount); }
  catch (e) { run('UPDATE bachs_subscriptions SET price_move = ? WHERE id = ?', ('Could not make the new price: ' + e.message).slice(0, 200), row.id); return null; }
  run('UPDATE bachs_subscriptions SET next_amount_local = ?, next_product_id = ?, updated_at = ? WHERE id = ?', want.amount, productId, now(), row.id);
  try {
    await api(m, 'PATCH', '/subscriptions/' + encodeURIComponent(row.sub_id), { product_id: productId, prorate: false }, `va_move_${row.sub_id}_${productId}`);
    run('UPDATE bachs_subscriptions SET price_move = ? WHERE id = ?', `Moving to ${money(row.currency, want.amount)} from the next cycle`, row.id);
    return { moved: true, amount: want.amount };
  } catch (e) {
    // Bachs could not change the price: recorded; at renewal the margin check flags it and we try again.
    run('UPDATE bachs_subscriptions SET price_move = ? WHERE id = ?', ('Bachs refused the price change: ' + e.message).slice(0, 200), row.id);
    return { moved: false, amount: want.amount };
  }
}

// The renewal price would go over the Bachs cap: no new product, no move. The subscription ends at the end of the paid
// period (Bachs charges nothing more), the admin sees the flag, and the customer gets the normal one-off renewal
// reminder (billing.daily's "reminded_" key is set so it is sent once). Bachs refusing the cancel is recorded; the next
// check tries again.
async function capFallback(m, row, plan, want) {
  const cap = bachs().maxUsd(m);
  let flag = `Renewal price ${money(row.currency, want.amount)} would go over the Bachs limit of $${cap.toLocaleString('en-US')} per payment. Not moved to that price; auto-renew ends after this period and the customer pays one-off (reminder sent).`;
  let cancelled = false;
  try {
    await api(m, 'DELETE', '/subscriptions/' + encodeURIComponent(row.sub_id), { cancel_at_period_end: true }, 'va_cancel_' + row.sub_id);
    cancelled = true;
  } catch (e) { flag = `Renewal price ${money(row.currency, want.amount)} would go over the Bachs limit of $${cap.toLocaleString('en-US')} per payment. Not moved; Bachs did not accept turning auto-renew off (${e.message}). Tried again at the next check.`.slice(0, 400); }
  run('UPDATE bachs_subscriptions SET flag = ?, price_move = ?, next_amount_local = NULL, next_product_id = NULL, cancel_at_period_end = ?, updated_at = ? WHERE id = ?',
    flag, 'Over the Bachs limit: not moved', cancelled ? 1 : row.cancel_at_period_end, now(), row.id);
  if (!cancelled) return { moved: false, over_cap: true, cancelled: false };
  run('UPDATE users SET auto_renew = 0 WHERE id = ?', row.user_id);
  const u = get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (u && u.plan_expires_at) {
    const f = J(u.flags, {}), key = 'reminded_' + String(u.plan_expires_at).slice(0, 10);
    if (!f[key]) {
      f[key] = 1; run('UPDATE users SET flags = ? WHERE id = ?', JSON.stringify(f), u.id);
      require('../email').queue('renewal_reminder', u.email, { plan: plan.name, credits: Number(u.plan_credits || 0).toLocaleString('en-US') }, { userId: u.id });
    }
  }
  return { moved: false, over_cap: true, cancelled: true };
}

// ---------- Customer actions ----------
const forUser = (userId) => get("SELECT * FROM bachs_subscriptions WHERE user_id = ? AND sub_id IS NOT NULL AND status != 'canceled' ORDER BY id DESC LIMIT 1", userId);

async function cancel(userId) {
  const row = forUser(userId);
  if (!row) return null;
  const m = require('./index').byIdAdapter(row.method_id, 'bachs') || require('./index').byAdapterAny('bachs');
  if (!m) throw Object.assign(new Error('Bachs is not set up.'), { status: 502 });
  await api(m, 'DELETE', '/subscriptions/' + encodeURIComponent(row.sub_id), { cancel_at_period_end: true }, 'va_cancel_' + row.sub_id);
  run('UPDATE bachs_subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?', now(), row.id);
  run('UPDATE users SET auto_renew = 0 WHERE id = ?', userId);
  return row;
}

// Hosted Bachs page where the customer updates the card.
async function cardUrl(userId) {
  const row = forUser(userId);
  if (!row || !row.customer_id) return null;
  const m = require('./index').byIdAdapter(row.method_id, 'bachs') || require('./index').byAdapterAny('bachs');
  const d = await api(m, 'POST', '/customers/' + encodeURIComponent(row.customer_id) + '/portal-sessions', { return_url: `${config.appUrl}/app#wallet` });
  return d.url || d.portal_url || null;
}

// What the wallet shows: next charge date and amount, and a calm notice when a payment failed.
function summary(userId) {
  const row = forUser(userId);
  if (!row) return null;
  const amount = Number(row.next_amount_local || row.amount_local);
  return {
    provider: 'bachs', status: row.status, period: row.period, cancel_at_period_end: !!row.cancel_at_period_end,
    next_charge_at: row.cancel_at_period_end ? null : (row.paid_through || row.current_period_end),
    next_amount: amount, currency: row.currency, next_amount_label: money(row.currency, amount),
    price_changed: !!row.next_amount_local,
    payment_failed: row.status === 'past_due' ? { since: row.past_due_since, grace_until: row.grace_until, message: 'Your last card payment did not go through. Bachs will try again. Update your card to keep your plan.' } : null,
  };
}

// ---------- Daily ----------
// Reminder 3 days before each renewal (and 7 days before a yearly one), with the amount that will be charged (the new
// amount when the price went up). End of grace: the plan ends the same way an expired plan ends today.
async function daily(t = now()) {
  const methods = {};
  const methodFor = (id) => methods[id] || (methods[id] = require('./index').byIdAdapter(id, 'bachs'));
  for (const row of all("SELECT * FROM bachs_subscriptions WHERE status IN ('active','trialing') AND cancel_at_period_end = 0 AND sub_id IS NOT NULL")) {
    const m = methodFor(row.method_id);
    const due = row.paid_through || row.current_period_end;
    if (!m || !due) continue;
    const days = (Date.parse(due) - Date.parse(t)) / 864e5;
    const at = row.period === 'year' ? [7, 3] : [3];
    const hit = at.find((d) => days > d - 0.5 && days <= d + 0.5);
    if (hit === undefined) continue;
    if (hit === at[0]) await movePrice(m, row).catch((e) => console.warn('[bachs-subs] price', e.message)); // before the first reminder
    const fresh = get('SELECT * FROM bachs_subscriptions WHERE id = ?', row.id);
    if (fresh.cancel_at_period_end) continue; // over the Bachs cap: one-off reminder instead of a card charge
    const u = get('SELECT * FROM users WHERE id = ?', row.user_id);
    const f = J(u && u.flags, {}); const key = `bachs_remind_${hit}_${String(due).slice(0, 10)}`;
    if (!u || f[key]) continue;
    f[key] = 1; run('UPDATE users SET flags = ? WHERE id = ?', JSON.stringify(f), u.id);
    const plan = require('../settings').planById(row.plan_id);
    const amount = Number(fresh.next_amount_local || fresh.amount_local);
    const priceNote = fresh.next_amount_local ? `The price of your plan changed from ${money(fresh.currency, fresh.amount_local)} to ${money(fresh.currency, amount)} with the exchange rate, so this renewal is ${money(fresh.currency, amount)}.` : '';
    require('../email').queue('card_renews_soon', u.email, { plan: plan ? plan.name : 'Vooads', renew_date: require('../email').fmtDate(due), amount: money(fresh.currency, amount), days: String(hit), period: row.period === 'year' ? 'yearly' : 'monthly', price_note: priceNote }, { userId: u.id });
  }
  for (const row of all("SELECT * FROM bachs_subscriptions WHERE status = 'past_due' AND grace_until IS NOT NULL AND grace_until <= ?", t)) {
    run("UPDATE bachs_subscriptions SET status = 'unpaid', updated_at = ? WHERE id = ?", t, row.id);
    // Same as a plan that ran out: plan_expires_at in the past; credits.activePlan stops it and email.hooks.daily sends "plan ended".
    run('UPDATE users SET plan_expires_at = ?, auto_renew = 0 WHERE id = ? AND plan_id = ? AND plan_expires_at > ?', t, row.user_id, row.plan_id, t);
  }
}

// Admin list: status, next charge, failures and flags.
function adminList({ limit = 200 } = {}) {
  return all(`SELECT s.id, s.user_id, u.email, s.sub_id, s.plan_id, s.period, s.status, s.currency, s.amount_local, s.next_amount_local,
      COALESCE(s.paid_through, s.current_period_end) AS next_charge_at, s.cancel_at_period_end, s.fail_count, s.last_failure, s.past_due_since,
      s.grace_until, s.price_move, s.flag, s.created_at, s.updated_at
    FROM bachs_subscriptions s LEFT JOIN users u ON u.id = s.user_id WHERE s.sub_id IS NOT NULL ORDER BY s.id DESC LIMIT ?`, Math.min(500, Number(limit) || 200));
}

module.exports = { enabled, checkout, handle, isSubEvent, cancel, cardUrl, summary, daily, adminList, movePrice, currentPrice, ensureProduct, forUser, GRACE_DAYS };
