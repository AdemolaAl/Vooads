# Gatevoo integration (matches the Gatevoo code)

Vooads takes crypto payments (USDT, BTC) through Gatevoo, Zedapex's own non-custodial checkout. This page matches the
Gatevoo code itself (`src/invoices.js`, `src/webhooks.js`). Vooads code: `server/payments/gatevoo.js`. Checks: the
Gatevoo step in `server/selfcheck-support.js` signs webhooks exactly the way Gatevoo does.

## Setup

1. Gatevoo → your app → copy the **API key** (`gv_live_…`) and the **webhook signing secret**.
2. Gatevoo → your app → webhook URL: `https://vooads.com/api/webhooks/gatevoo`.
3. Vooads → Admin → Payment methods → **Crypto (Gatevoo)**: paste the API key as **Secret key**, the signing secret as
   **Webhook secret**. Leave **API address** empty for `https://gatevoo.com/api/v1` (an older saved
   `https://api.gatevoo.com` is read as `https://gatevoo.com/api/v1`). Set the countries, switch it on.
4. Press **Test** on the method (Admin → Integrations): Vooads asks Gatevoo for an unknown invoice; `404` means the key
   was accepted, `401/403` means it was not. Then press Gatevoo's own **Test** button: Vooads answers `200` and credits
   nothing.

## 1. Create an invoice

`POST {API address}/invoices` with `Authorization: Bearer <API key>`, `Content-Type: application/json` and
`Idempotency-Key: va_<payment id>`:

```json
{
  "amount_usd": 49,
  "order_id": "va_123",
  "description": "Vooads Pro (monthly)",
  "customer_email": "buyer@example.com",
  "customer_name": "Alex",
  "redirect_url": "https://vooads.com/app?paid=123#wallet",
  "metadata": { "payment_id": "123", "user_id": "45", "app": "vooads" }
}
```

Gatevoo answers `201 { "id": "inv_…", "status": "open", "checkout_url": "https://gatevoo.com/…", … }`. Vooads stores
`gv_<id>` on the payment and sends the browser to `checkout_url`. **Gatevoo's checkout refuses framing** (strict CSP):
it is always opened as a full-page redirect, never inside an iframe. Any other answer: the payment is marked failed and
the customer sees "Gatevoo is not available right now. Try again in a minute or pick another payment method."

## 2. Webhook

Gatevoo sends `POST https://vooads.com/api/webhooks/gatevoo` with these headers:

| Header | Value |
|---|---|
| `X-Gatevoo-Event` | `invoice.paid`, `invoice.test`, … |
| `X-Gatevoo-Timestamp` | Unix time in **seconds**, as a string |
| `X-Gatevoo-Delivery` | Delivery id (`wh_…`) |
| `X-Gatevoo-Signature` | lowercase hex `HMAC_SHA256(webhook secret, "<timestamp>.<raw body>")`, **no prefix** |

Body:

```json
{
  "id": "evt_…",
  "type": "invoice.paid",
  "created": "2026-11-03T10:00:00.000Z",
  "data": {
    "id": "inv_…", "status": "paid", "amount_usd": 49, "order_id": "va_123", "description": "Vooads Pro (monthly)",
    "customer_email": "buyer@example.com", "metadata": { "payment_id": "123" }, "method": "usdt_trc20",
    "txid": "…", "tx_url": "…", "received": "49.00", "paid_at": "…", "checkout_url": "…"
  }
}
```

What Vooads does, in order:

1. Checks the signature over the **exact raw body** with a constant-time compare. Wrong, missing, malformed (anything
   but 64 hex characters), or a timestamp more than **5 minutes** old or in the future → `400 {"error":"Bad Gatevoo signature"}`.
   Nothing in the body is read before this.
2. `type` `invoice.test` → `200 {"received":true}`, nothing credited.
3. Any type other than `invoice.paid` (for example `invoice.expired`) → `200`, nothing changes.
4. `data.status` must be `paid`. `review` (and anything else) is never credited automatically → `200`.
5. Finds the payment from `data.order_id` (`va_<id>`) or `data.metadata.payment_id`. It must be a Gatevoo payment.
6. `data.amount_usd` must be at least the payment amount (1 cent tolerance). Underpaid → `200`, not credited, logged.
7. Marks the payment paid and gives the plan or credits. This is idempotent: Gatevoo's retries (0s, 30s, 2m, 10m, 30m,
   2h, 6h, 24h) and repeat deliveries never credit twice.

## 3. Sign a test webhook by hand

```js
const crypto = require('node:crypto');
const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', created: new Date().toISOString(),
  data: { id: 'inv_1', status: 'paid', order_id: 'va_123', amount_usd: 49 } });
const ts = String(Math.floor(Date.now() / 1000));
const signature = crypto.createHmac('sha256', process.env.GATEVOO_WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
await fetch('https://staging.vooads.com/api/webhooks/gatevoo', { method: 'POST', body, headers: {
  'Content-Type': 'application/json', 'X-Gatevoo-Event': 'invoice.paid', 'X-Gatevoo-Timestamp': ts,
  'X-Gatevoo-Delivery': 'wh_manual', 'X-Gatevoo-Signature': signature } });
```

Staging only accepts a Gatevoo sandbox or test API address (`server/staging.js`), so a staging test never takes real money.
