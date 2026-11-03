// Flutterwave: cards, mobile money, bank transfer across Africa and more.
// Keys: https://app.flutterwave.com/dashboard/settings/apis (Secret key FLWSECK-...)
// Webhook: Settings → Webhooks → URL {APP_URL}/api/webhooks/flutterwave and a Secret hash you choose → paste the same hash here.
// config.currency: NGN, GHS, KES, ZAR, USD... config.usd_rate: local units per 1 USD (1 for USD).
const { safeEqual } = require('../lib/util');
const { get } = require('../db');

async function checkout(m, { payment, user, amountUsd, description, successUrl }) {
  const currency = m.config.currency || 'USD';
  const rate = currency === 'USD' ? 1 : Number(m.config.usd_rate || 0);
  if (!rate) throw new Error('Set the USD exchange rate for this Flutterwave method in Admin → Payments.');
  const tx_ref = 'va_' + payment.id + '_' + Date.now();
  const r = await fetch('https://api.flutterwave.com/v3/payments', {
    method: 'POST', headers: { Authorization: 'Bearer ' + m.secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_ref, amount: Math.round(amountUsd * rate * 100) / 100, currency, redirect_url: successUrl,
      customer: { email: user.email, name: user.name || user.email }, meta: { payment_id: payment.id },
      customizations: { title: 'Vooads', description },
    }),
  });
  const data = await r.json();
  if (data.status !== 'success') throw new Error('Flutterwave: ' + (data.message || r.status));
  return { url: data.data.link, ref: tx_ref };
}

async function webhook(m, req) {
  if (!m.webhookSecret || !safeEqual(req.headers['verif-hash'], m.webhookSecret)) throw Object.assign(new Error('Bad Flutterwave hash'), { status: 400 });
  const ev = JSON.parse(req.rawBody.toString('utf8'));
  const d = ev.data || {};
  if (ev.event !== 'charge.completed' || d.status !== 'successful') return { type: 'ignore' };
  // Double-check with Flutterwave before giving credits.
  const r = await fetch(`https://api.flutterwave.com/v3/transactions/${d.id}/verify`, { headers: { Authorization: 'Bearer ' + m.secret } });
  const v = await r.json();
  if (v.status !== 'success' || v.data.status !== 'successful' || v.data.tx_ref !== d.tx_ref) return { type: 'ignore' };
  const paymentId = Number(String(d.tx_ref).split('_')[1]);
  const p = get('SELECT COALESCE(charged_usd, amount_usd) AS amount_usd FROM payments WHERE id = ?', paymentId);
  const currency = m.config.currency || 'USD';
  const rate = currency === 'USD' ? 1 : Number(m.config.usd_rate || 0);
  if (!p || v.data.currency !== currency || Number(v.data.amount) + 0.01 < Math.round(p.amount_usd * rate * 100) / 100) {
    console.warn('[flutterwave] amount or currency does not match payment', paymentId);
    return { type: 'ignore' };
  }
  return { type: 'paid', paymentId, ref: d.tx_ref, paidAmount: v.data.amount, paidCurrency: v.data.currency };
}

module.exports = { label: 'Flutterwave (Africa and global cards, mobile money)', checkout, webhook, recurring: false, fields: ['secret', 'webhookSecret'] };
