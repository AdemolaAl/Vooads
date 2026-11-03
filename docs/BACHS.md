# Bachs (naira and African payments)

Bachs (bachs.io) is a hosted checkout for African cards, bank transfer, mobile money and USDT/USDC. Vooads uses the same
rules as Replyvoo's and Castvoo's Bachs code. Code: `server/payments/bachs.js`. Checks: `server/selfcheck-bachs.js`
(`CHECK_ONLY=bachs npm run check`).

## Who sees it

- Customers whose country is on the method's list (default `NG KE GH ZA CM UG TZ RW ZM ET EG MA CI SN BJ TG SL LR ZW BW`,
  editable in Admin → Payment methods → Bachs → Countries), **and customers whose country is not known yet**.
- **Nigeria pays in naira**: the US-dollar price × **Naira per 1 US dollar** (set on the method). The studio shows the
  naira amount before paying. Everyone else pays in US dollars. Plans and credits are always worth the US-dollar price.
  With no rate set, Nigeria pays in US dollars too.
- The customer's country comes from VooSquare (Voo ID sign-up), the hosting edge's country header at sign-up
  (`cf-ipcountry` and similar) when present, else the browser's guess from its time zone. Customers can change it in
  Settings → Country.

## Going live

1. Bachs → Developer Portal: a live secret key (`sk_live_…`), a webhook signing secret (`whsec_…`), and the webhook URL
   `https://vooads.com/api/webhooks/bachs`.
2. Vooads → Admin → Payment methods → **Bachs** (listed and switched off from the first start): paste both, set the naira
   rate, check the countries, press **Test** ("Connected. Bachs accepted the live key."), switch it on.
3. A sandbox key (`sk_sandbox_…`) can be saved and tested, but it is **never shown to customers on the live site** and the
   method cannot be switched on with it (test payments would give real plans). Staging accepts sandbox keys only. Outside
   staging, `BACHS_ALLOW_SANDBOX=true` allows one for local testing.

## How a payment flows

1. Checkout records `currency` (NGN or USD) and `amount_local` on the payment and calls `POST /v1/checkout-sessions` with
   `Idempotency-Key: va_<payment id>`, reference `va_<payment id>`, the amount, the customer's email and the return links.
   The customer goes to Bachs's `checkout_url`.
2. Bachs calls `POST /api/webhooks/bachs`. The signature is checked first: `X-Bachs-Signature` = hex HMAC-SHA256(webhook
   secret, `<X-Bachs-Timestamp>.<raw body>`), at most 5 minutes old (`t=…,v1=…` accepted too). Wrong or missing → 401.
3. A valid webhook only makes Vooads **ask Bachs** (`GET /v1/checkout-sessions/:id`). The payment is paid only if Bachs says
   COMPLETED/SUCCEEDED/PAID, the reference and checkout id are ours, and the amount and currency are at least what we asked.
   FAILED/EXPIRED/CANCELLED mark a pending payment failed (a later completed answer still pays it). Paying is idempotent:
   repeats never credit twice. If Bachs cannot be asked, the webhook answers 502 so Bachs retries.

## Unverified assumption

The request and answer shapes follow Castvoo's and Replyvoo's Bachs code (`/v1/checkout-sessions`, `checkout_url`,
`checkout_id`, `status`, `pricing`). Make one real naira payment in production before announcing it.

## Auto-renew (card subscriptions)

Code: `server/payments/bachs-subs.js`. Checks: `server/selfcheck-bachsubs.js` (`CHECK_ONLY=bachs,bachsubs npm run check`).

- **Checkout.** A monthly or yearly plan paid with Bachs shows **Renew automatically** (on by default). On, Vooads makes
  (once per plan, period, currency and amount) a Bachs recurring product, `POST /v1/products` with
  `billing_cycle: { interval: 'month' | 'year', frequency: 1 }`, then `POST /v1/checkout-sessions` with
  `product_cart: [{ product_id }]`. Completing it creates the subscription (Bachs has no create-subscription endpoint).
  Off, or with a discount code: the normal one-off payment, open to bank transfer, mobile money and crypto, with the
  manual renewal and reminder emails as before.
- **Price.** The same as a one-off Bachs payment: base price + the Bachs customer fee (4% by default) built in, naira at
  today's rate + FX buffer. Customers never see a fee line.
- **Webhooks** (same URL, same signature; `X-Bachs-Signature-V2: t=…,v1=…` is accepted too). Each event id is handled once.
  - `customer.subscription.created / updated / deleted`: Vooads reads `GET /v1/subscriptions/:id` and syncs status,
    period end and cancel-at-period-end.
  - `invoice.paid`: the first one pays the checkout payment. Each later one adds **one** payment row
    (`provider_ref = bachs_inv_<invoice id>`, unique) and pays it with `billing.markPaid`, the same plan path as every
    payment. Credits are given only when Bachs's own `GET /v1/subscriptions/:id` says the subscription is ours and active.
    A replayed event, the same invoice under a new event id, or a period that is already paid gives nothing.
  - `invoice.payment_failed`: status past due, one calm email (`payment_failed`), a "payment did not go through, update
    card" notice in the wallet (button opens the Bachs portal, `POST /v1/customers/:id/portal-sessions`). The plan keeps
    working for the grace period (Admin → Bachs → "Days a failed card renewal keeps the plan", default 7) while Bachs
    retries. No credits are given until an `invoice.paid`. After the grace period the plan ends like an expired plan.
- **Cancel.** Wallet → **Cancel auto-renew** (one click) calls `DELETE /v1/subscriptions/:id` with
  `cancel_at_period_end: true`. The plan stays active until the end of the period. The wallet shows the next charge date
  and amount.
- **Reminders.** `card_renews_soon` 3 days before each charge, and also 7 days before a yearly one, with the exact amount.
- **Price follows FX.** Before the first reminder, if today's price is higher than what the subscription charges, Vooads
  makes a product at the new price and moves the subscription for the next cycle (`PATCH /v1/subscriptions/:id`,
  `product_id`). The reminder shows the new amount. If Bachs refuses, that is recorded (Admin → Payments → Card
  auto-renew). At renewal, what Bachs charged is compared with today's price. Under the plan's base price, the credits are
  still given, the payment and the subscription are flagged for admin, and the move is tried again.
- **Flag.** Admin → Payment methods → Bachs → "Auto-renew for card payments" (yes by default); `BACHS_RECURRING=off` turns
  it off. If Bachs refuses to make the recurring product (a key without subscription access, products not set up),
  checkout quietly uses a one-off payment and the reason shows in the admin. It is retried after 24 hours.

### Verified, and not verified

Verified from Bachs's own guide and SDKs: no create-subscription endpoint (subscriptions come from a checkout of a recurring
product); `billing_cycle {interval, frequency}` on products; `product_cart` checkouts; subscriptions get, list and
cancel with `cancel_at_period_end`; the portal session endpoint; the event names; the V2 signature header. **Not verified:**
the exact HTTP verb and body of cancel (we send `DELETE` with `{cancel_at_period_end: true}`); the body of the price move
(`{product_id, prorate: false}`); the invoice webhook's field names (we read `subscription_id`, `amount_paid`, `currency`,
`period_end`, `billing_reason`); and whether a recurring checkout offers only cards. Make one real card subscription in
production, and let it renew once, before announcing it.

### What to set up in the Bachs dashboard

1. A live key with subscription (recurring products) access.
2. Webhook endpoint `https://vooads.com/api/webhooks/bachs` subscribed to: `checkout.completed`, `collection.succeeded`,
   `collection.failed`, `checkout.expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`,
   `customer.subscription.updated` and `customer.subscription.deleted`.
3. Products are made by Vooads itself. Only make them by hand if the key cannot. Recurring payment methods: cards only.
4. Turn on Bachs's own retry schedule for failed renewals (dunning) and the customer portal (card update).
