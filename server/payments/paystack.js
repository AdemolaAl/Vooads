// Paystack: cards, bank transfer, USSD, mobile money (Nigeria, Ghana, Kenya, South Africa, Côte d'Ivoire).
// Keys: https://dashboard.paystack.com/#/settings/developers (Secret key sk_live_...)
// Webhook URL: {APP_URL}/api/webhooks/paystack (Paystack signs with your secret key, no extra secret needed).
// config.currency: NGN, GHS, KES, ZAR or USD (if enabled on your account). config.usd_rate: local units per 1 USD (e.g. 1550 for NGN).
const { hmac, safeEqual } = require('../lib/util');

async function checkout(m, { payment, user, amountUsd, successUrl }) {
  const currency = m.config.currency || 'NGN';
  const rate = currency === 'USD' ? 1 : Number(m.config.usd_rate || 0);
  if (!rate) throw new Error('Set the USD exchange rate for this Paystack method in Admin → Payments.');
  const amount = Math.round(amountUsd * rate * 100);
  const reference = 'va_' + payment.id + '_' + Date.now();
  const r = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST', headers: { Authorization: 'Bearer ' + m.secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, amount, currency, reference, callback_url: successUrl, metadata: { payment_id: payment.id, user_id: user.id } }),
  });
  const data = await r.json();
  if (!data.status) throw new Error('Paystack: ' + (data.message || r.status));
  return { url: data.data.authorization_url, ref: reference };
}

function webhook(m, req) {
  const sig = req.headers['x-paystack-signature'];
  if (!safeEqual(hmac('sha512', m.secret, req.rawBody), sig)) throw Object.assign(new Error('Bad Paystack signature'), { status: 400 });
  const ev = JSON.parse(req.rawBody.toString('utf8'));
  // A dispute on one of our transactions (Paystack sends the original transaction reference).
  if (ev.event === 'charge.dispute.create') {
    const ref = String((ev.data && (ev.data.transaction?.reference || ev.data.reference)) || '');
    const p = ref ? require('../db').get("SELECT id FROM payments WHERE adapter = 'paystack' AND provider_ref = ?", ref) : null;
    return p ? { type: 'chargeback', paymentId: p.id, ref: String(ev.data.id || ref) } : { type: 'ignore' };
  }
  if (ev.event !== 'charge.success') return { type: 'ignore' };
  const d = ev.data || {};
  const paymentId = Number(d.metadata?.payment_id) || Number((String(d.reference || '').match(/^va_(\d+)_/) || [])[1]);
  // Only the transaction Vooads created for this payment counts (same reference, same currency, full amount).
  // Paystack's public key lets anyone start a transaction with any metadata, so metadata alone is not proof.
  const { get } = require('../db');
  const p = paymentId ? get('SELECT COALESCE(charged_usd, amount_usd) AS amount_usd, adapter, provider_ref FROM payments WHERE id = ?', paymentId) : null;
  const currency = m.config.currency || 'NGN';
  const rate = currency === 'USD' ? 1 : Number(m.config.usd_rate || 0);
  if (!p || p.adapter !== 'paystack' || (p.provider_ref && p.provider_ref !== d.reference) || (d.currency && d.currency !== currency) || !(Number(d.amount) + 1 >= Math.round(p.amount_usd * rate * 100))) {
    console.warn('[paystack] charge does not match the payment', paymentId, d.reference);
    return { type: 'ignore' };
  }
  return { type: 'paid', paymentId, ref: d.reference };
}

module.exports = { label: 'Paystack (Africa: cards, transfer, mobile money)', checkout, webhook, recurring: false, fields: ['secret'] };
