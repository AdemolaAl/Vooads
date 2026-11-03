// VooSquare connection (shared Zedapex account). Optional: everything works without it.
// 1) Events: key moments are sent to VooSquare's live feed (signed with VOO_WEBHOOK_SECRET).
// 2) Summary: GET /api/voosquare/summary lets VooSquare show Vooads numbers on its dashboard (needs VOO_SERVICE_KEY).
// 3) Support events: ticket.created / ticket.message / ticket.updated go to the VooSquare support inbox
//    (see docs/VOOSQUARE-SUPPORT-API.md). Inbound support calls live in routes/support.js.
const config = require('./config');
const { hmac, id } = require('./lib/util');

// With the Voo Connect API key set, events go through the kit instead (server/voo.js): money events are sent by
// billing.js with stable ids (voo.reportPayment), everything else as a kit activity event. This older signed feed is
// only used when there is no API key.
async function event(user, type, label, valueUsd) {
  const voo = require('./voo');
  if (voo.eventsOn()) {
    if (!['spend', 'plan_started', 'plan_renewed', 'wallet_topup', 'refund', 'chargeback'].includes(type)) voo.reportActivity(user, type, label);
    return;
  }
  const c = config.voosquare;
  if (!c.webhookSecret || !user?.voo_id) return;
  const body = JSON.stringify({ event_id: 'va_' + id(9), tool: 'vooads', voo_id: user.voo_id, type, occurred_at: new Date().toISOString(), label, ...(valueUsd ? { value_usd: valueUsd } : {}) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(c.eventsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voo-Signature': hmac('sha256', c.webhookSecret, body) }, body });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
}

// Signature VooSquare checks on every support event: "sha256=" + hex HMAC-SHA256 of the raw body.
const sign = (body, secret = config.voosquare.webhookSecret) => 'sha256=' + hmac('sha256', secret, body);

// Send one support event. First try right away, then up to 3 retries (2s, 6s, 18s).
// Resolves to the parsed JSON response of the successful call (or null). Never throws.
async function supportEvent(url, payload, { retryDelays = [2000, 6000, 18000] } = {}) {
  const secret = config.voosquare.webhookSecret;
  if (!secret || !url) return null;
  const body = JSON.stringify({ event_id: 'va_sup_' + id(9), occurred_at: new Date().toISOString(), tool: 'vooads', ...payload });
  const headers = { 'Content-Type': 'application/json', 'X-Voo-Signature': sign(body, secret), 'X-Voo-Tool': 'vooads' };
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10e3) });
      if (r.ok) { try { return await r.json(); } catch { return {}; } }
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
        console.warn('[voosquare support] event refused', r.status, payload.type);
        return null;
      }
    } catch {}
    if (attempt < retryDelays.length) await new Promise((r) => setTimeout(r, retryDelays[attempt]).unref?.());
  }
  console.warn('[voosquare support] event not delivered after retries', payload.type);
  return null;
}

module.exports = { event, supportEvent, sign };
