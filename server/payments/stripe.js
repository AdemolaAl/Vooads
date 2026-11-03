// Stripe: cards worldwide, Apple Pay, Google Pay. Plans renew automatically.
// Keys: https://dashboard.stripe.com/apikeys (Secret key sk_live_...)
// Webhook: https://dashboard.stripe.com/webhooks → add endpoint {APP_URL}/api/webhooks/stripe
//   events: checkout.session.completed, invoice.paid, customer.subscription.deleted → copy the Signing secret (whsec_...).
const { hmac, safeEqual } = require('../lib/util');

const form = (obj, prefix = '', out = []) => {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
  }
  return out.join('&');
};
async function api(m, path, body, method = 'POST') {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method, headers: { Authorization: 'Bearer ' + m.secret, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body ? form(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Stripe: ' + (data.error?.message || r.status));
  return data;
}

async function checkout(m, { payment, user, amountUsd, description, successUrl, cancelUrl, recurring }) {
  const cents = Math.round(amountUsd * 100);
  const price_data = { currency: 'usd', unit_amount: cents, product_data: { name: description } };
  if (recurring) price_data.recurring = { interval: recurring };
  const session = await api(m, 'checkout/sessions', {
    mode: recurring ? 'subscription' : 'payment',
    customer_email: user.email,
    client_reference_id: String(payment.id),
    success_url: successUrl, cancel_url: cancelUrl,
    line_items: { 0: { quantity: 1, price_data } },
    metadata: { payment_id: payment.id, user_id: user.id },
    ...(recurring ? { subscription_data: { metadata: { payment_id: payment.id, user_id: user.id } } } : {}),
  });
  return { url: session.url, ref: session.id };
}

// Returns a normalised event: { type: 'paid'|'renewed'|'cancelled'|'ignore', paymentId, ref, subscription, customer, amountUsd }
function webhook(m, req) {
  const sig = String(req.headers['stripe-signature'] || '');
  const parts = Object.fromEntries(sig.split(',').map((p) => p.split('=')));
  const expected = hmac('sha256', m.webhookSecret, `${parts.t}.${req.rawBody.toString('utf8')}`);
  if (!m.webhookSecret || !safeEqual(expected, parts.v1)) throw Object.assign(new Error('Bad Stripe signature'), { status: 400 });
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) throw Object.assign(new Error('Stale Stripe event'), { status: 400 });
  const ev = JSON.parse(req.rawBody.toString('utf8'));
  const o = ev.data.object;
  if (ev.type === 'checkout.session.completed' && (o.payment_status === 'paid' || o.payment_status === 'no_payment_required')) {
    // The session must be the one we created for this payment, for at least the amount we asked (security audit).
    const pid = Number(o.metadata?.payment_id || o.client_reference_id);
    const p = pid ? require('../db').get('SELECT id, provider_ref, COALESCE(charged_usd, amount_usd) AS amount_usd, status FROM payments WHERE id = ?', pid) : null;
    if (!p || !p.provider_ref || o.id !== p.provider_ref) { console.warn('[stripe] session does not match payment', pid); return { type: 'ignore' }; }
    if (Number(o.amount_total || 0) < Math.round(Number(p.amount_usd || 0) * 100)) { console.warn('[stripe] amount too low for payment', pid, o.amount_total); return { type: 'ignore' }; }
    return { type: 'paid', paymentId: pid, ref: o.id, subscription: o.subscription, customer: o.customer, amountUsd: (o.amount_total || 0) / 100, raw: { payment_intent: o.payment_intent || null, session: o.id } };
  }
  if (ev.type === 'invoice.paid' && o.billing_reason === 'subscription_cycle')
    return { type: 'renewed', subscription: o.subscription, ref: o.id, amountUsd: (o.amount_paid || 0) / 100 };
  if (ev.type === 'customer.subscription.deleted') return { type: 'cancelled', subscription: o.id };
  // A dispute: the payment is found by its payment intent (saved when it was paid).
  if (ev.type === 'charge.dispute.created' && o.payment_intent) {
    const p = require('../db').get("SELECT id FROM payments WHERE adapter = 'stripe' AND json_extract(raw, '$.payment_intent') = ?", String(o.payment_intent));
    return p ? { type: 'chargeback', paymentId: p.id, ref: o.id } : { type: 'ignore' };
  }
  return { type: 'ignore' };
}

async function cancel(m, subscriptionId) {
  await api(m, 'subscriptions/' + subscriptionId, { cancel_at_period_end: 'true' });
}

module.exports = { label: 'Stripe (cards, Apple Pay, Google Pay)', checkout, webhook, cancel, recurring: true, fields: ['secret', 'webhookSecret'] };
