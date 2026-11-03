// NOWPayments: crypto (USDT TRC20, BTC, ETH and 300+ coins). Swap for Gatevoo once it is live by adding a gatevoo.js file.
// Keys: https://account.nowpayments.io → Store settings → API key, and IPN secret key.
// IPN callback is sent automatically to {APP_URL}/api/webhooks/nowpayments.
const { hmac, safeEqual } = require('../lib/util');
const config = require('../config');

// Staging uses the NOWPayments sandbox (account.sandbox.nowpayments.io, its own API key): no real coins move.
const API = () => (config.isStaging ? 'https://api-sandbox.nowpayments.io' : 'https://api.nowpayments.io');

const sortKeys = (o) => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.keys(o).sort().reduce((a, k) => ((a[k] = sortKeys(o[k])), a), {}) : o);

async function checkout(m, { payment, amountUsd, description, successUrl, cancelUrl }) {
  const r = await fetch(API() + '/v1/invoice', {
    method: 'POST', headers: { 'x-api-key': m.secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      price_amount: amountUsd, price_currency: 'usd', order_id: 'va_' + payment.id, order_description: description,
      ipn_callback_url: config.appUrl + '/api/webhooks/nowpayments', success_url: successUrl, cancel_url: cancelUrl,
      ...(m.config.pay_currency ? { pay_currency: m.config.pay_currency } : {}),
    }),
  });
  const data = await r.json();
  if (!data.invoice_url) throw new Error('NOWPayments: ' + (data.message || r.status));
  return { url: data.invoice_url, ref: 'np_' + data.id };
}

function webhook(m, req) {
  let body;
  try { body = JSON.parse(req.rawBody.toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const sig = hmac('sha512', m.webhookSecret, JSON.stringify(sortKeys(body)));
  if (!m.webhookSecret || !safeEqual(sig, req.headers['x-nowpayments-sig'])) throw Object.assign(new Error('Bad NOWPayments signature'), { status: 400 });
  if (body.payment_status !== 'finished') return { type: 'ignore' };
  const paymentId = Number(String(body.order_id).replace('va_', ''));
  const { get } = require('../db');
  const p = paymentId ? get('SELECT COALESCE(charged_usd, amount_usd) AS amount_usd, adapter FROM payments WHERE id = ?', paymentId) : null;
  if (!p || p.adapter !== 'nowpayments' || (body.price_amount !== undefined && !(Number(body.price_amount) + 0.01 >= Number(p.amount_usd)))) {
    console.warn('[nowpayments] IPN does not match the payment', paymentId);
    return { type: 'ignore' };
  }
  return { type: 'paid', paymentId, ref: 'np_' + (body.invoice_id || body.payment_id) };
}

module.exports = { API, label: 'Crypto via NOWPayments (USDT, BTC and more)', checkout, webhook, recurring: false, fields: ['secret', 'webhookSecret'] };
