// Self-check group "bachsubs": Bachs card auto-renew against a fake Bachs in this process, with signed (mocked) webhooks:
// subscription checkout (recurring product, card), first charge, renewal, duplicate events, failed payment and grace,
// cancel at period end, price change with FX (moved to the new price, reminder shows it), a renewal under the margin
// floor when Bachs refuses the price change, and the quiet fallback to one-off payments.
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert');

module.exports = async function bachSubsChecks({ call, step }) {
  const { get, all, run } = require('./db');
  const { sha256, id, addDays } = require('./lib/util');
  const subs = require('./payments/bachs-subs');
  const LIVE = 'sk_live_vooadssubs123', WHS = 'whsec_vooadssubs123';
  const products = new Map(), sessions = new Map(), subsMap = new Map(), log = [];
  let refuseProducts = false, refusePatch = false;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer ' + LIVE) return json({ message: 'Invalid API key' }, 401);
      const p = body ? JSON.parse(body) : {};
      log.push({ method: req.method, url: req.url, body: p, idem: req.headers['idempotency-key'] });
      if (req.method === 'POST' && req.url === '/v1/products') {
        if (refuseProducts) return json({ message: 'This key cannot create subscription products' }, 403);
        const pid = 'prod_' + crypto.randomBytes(4).toString('hex');
        products.set(pid, p); return json({ data: { id: pid, ...p } }, 201);
      }
      if (req.method === 'POST' && req.url === '/v1/checkout-sessions') {
        const cid = 'chk_' + crypto.randomBytes(5).toString('hex');
        const s = { checkout_id: cid, checkout_url: 'https://checkout.bachs.test/' + cid, reference: p.reference, status: 'OPEN', ...(p.product_cart ? { mode: 'subscription' } : { pricing: p.pricing }) };
        sessions.set(cid, s); return json(s, 201);
      }
      let m = /^\/v1\/checkout-sessions\/([\w-]+)$/.exec(req.url);
      if (req.method === 'GET' && m) return sessions.has(m[1]) ? json(sessions.get(m[1])) : json({ message: 'not found' }, 404);
      m = /^\/v1\/subscriptions\/([\w-]+)$/.exec(req.url);
      if (m) {
        const s = subsMap.get(m[1]);
        if (!s) return json({ message: 'not found' }, 404);
        if (req.method === 'GET') return json({ data: s });
        if (req.method === 'PATCH') { if (refusePatch) return json({ message: 'price changes are not allowed on this subscription' }, 422); s.product_id = p.product_id; return json({ data: s }); }
        if (req.method === 'DELETE') { s.cancel_at_period_end = !!p.cancel_at_period_end; if (!p.cancel_at_period_end) s.status = 'canceled'; return json({ data: s }); }
      }
      m = /^\/v1\/customers\/([\w-]+)\/portal-sessions$/.exec(req.url);
      if (req.method === 'POST' && m) return json({ data: { id: 'ps_1', url: 'https://billing.bachs.test/p/' + m[1] } }, 201);
      json({ message: 'nope' }, 404);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.BACHS_API_BASE = 'http://127.0.0.1:' + fake.address().port;

  const owner = get("SELECT id FROM roles WHERE name = 'Owner'").id;
  run("INSERT OR IGNORE INTO staff(email, name, role_id, status) VALUES('subsowner@example.com', 'Subs Owner', ?, 'active')", owner);
  const sid = id(32);
  run('INSERT INTO sessions(id, staff_id, expires_at) VALUES(?,?,?)', sha256('sess:' + sid), get("SELECT id FROM staff WHERE email = 'subsowner@example.com'").id, new Date(Date.now() + 864e5).toISOString());
  const O = (method, url, body) => call('subsown', method, url, body, { Cookie: 'va_a=' + sid });
  const ip = () => ({ 'x-forwarded-for': '10.77.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });
  const customer = async (jar, email, country) => { const h = ip(); const c = await call(jar, 'POST', '/api/auth/code', { email }, h); const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, country }, h); assert.equal(v.status, 200, JSON.stringify(v.data)); return v.data.user; };
  const method = () => get("SELECT * FROM payment_methods WHERE adapter = 'bachs' ORDER BY id LIMIT 1");
  const hm = () => require('./payments').byIdAdapter(method().id, 'bachs');
  // Signed with the V2 header Bachs prefers: "t=<ts>,v1=<hex>".
  const hook = (ev) => {
    const raw = JSON.stringify(ev), ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', WHS).update(ts + '.' + raw).digest('hex');
    return call('subshook', 'POST', '/api/webhooks/bachs', Buffer.from(raw), { 'Content-Type': 'application/json', 'x-bachs-signature-v2': `t=${ts},v1=${sig}` });
  };
  const user = (uid) => get('SELECT * FROM users WHERE id = ?', uid);
  const paidPlanPays = (uid) => all("SELECT * FROM payments WHERE user_id = ? AND kind = 'plan' AND status = 'paid'", uid);
  const emails = (uid, tpl) => all('SELECT * FROM email_queue WHERE user_id = ? AND template = ?', uid, tpl);
  const iso = (d) => new Date(d).toISOString();

  let u, pay, subId = 'sub_' + crypto.randomBytes(4).toString('hex'), price, periodEnd;
  await step('Bachs auto-renew: plan checkout makes a monthly recurring product and a card subscription checkout (on by default)', async () => {
    const m = method();
    const ok = await O('PUT', '/api/admin/payment-methods/' + m.id, { secret: LIVE, webhook_secret: WHS, config: { ngn_rate: 1500, ngn_rate_updated_at: new Date().toISOString() }, enabled: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    u = await customer('sub1', 'subscriber@example.com', 'NG');
    const b = await call('sub1', 'GET', '/api/billing');
    assert.ok(b.data.methods.find((x) => x.adapter === 'bachs').card_auto_renew, 'auto-renew offered for Bachs');
    const co = await call('sub1', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: m.id });
    assert.equal(co.status, 200, JSON.stringify(co.data)); assert.equal(co.data.auto_renew, true);
    pay = co.data.payment_id;
    const prod = log.find((x) => x.url === '/v1/products');
    assert.deepEqual(prod.body.billing_cycle, { interval: 'month', frequency: 1 });
    price = subs.currentPrice(hm(), require('./settings').planById('starter'), 'month', 'NG');
    assert.equal(prod.body.price.currency, 'NGN'); assert.equal(prod.body.price.amount, price.amount.toFixed(2), 'naira price with the 4% fee inside, at the FX rate + buffer');
    assert.ok(price.total_usd > price.base_usd, 'fee built into the price');
    const cs = log.filter((x) => x.url === '/v1/checkout-sessions').pop();
    assert.ok(cs.body.product_cart && cs.body.product_cart[0].product_id && !cs.body.pricing, 'subscription checkout uses the recurring product');
    assert.equal(cs.body.metadata.payment_id, String(pay));
    // Turned off → the normal one-off Bachs payment (bank, mobile money, crypto stay one-off).
    const one = await call('sub1', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: m.id, auto_renew: false });
    assert.equal(one.status, 200); assert.equal(one.data.auto_renew, false);
    assert.ok(log.filter((x) => x.url === '/v1/checkout-sessions').pop().body.pricing, 'one-off checkout uses fixed pricing');
    // Yearly makes a yearly product.
    await call('sub1', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'year', method_id: m.id });
    assert.equal(log.filter((x) => x.url === '/v1/products').pop().body.billing_cycle.interval, 'year');
  });

  await step('Bachs auto-renew: create webhook links the subscription; first invoice.paid activates the plan once', async () => {
    periodEnd = iso(Date.now() + 30 * 864e5);
    subsMap.set(subId, { id: subId, status: 'active', customer_id: 'cust_sub1', current_period_end: periodEnd, cancel_at_period_end: false, metadata: { app: 'vooads', payment_id: String(pay) } });
    assert.equal((await hook({ id: 'evt_c1', type: 'customer.subscription.created', data: { object: { id: subId, metadata: { payment_id: String(pay) } } } })).status, 200);
    assert.equal(get('SELECT sub_id FROM bachs_subscriptions WHERE first_payment_id = ?', pay).sub_id, subId);
    assert.equal(paidPlanPays(u.id).length, 0, 'no credits before Bachs confirms a payment');
    const r = await hook({ id: 'evt_i1', type: 'invoice.paid', data: { object: { id: 'inv_1', subscription_id: subId, billing_reason: 'subscription_create', amount_paid: price.amount.toFixed(2), currency: 'NGN', period_end: periodEnd } } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const pp = paidPlanPays(u.id); assert.equal(pp.length, 1); assert.equal(pp[0].id, pay);
    const x = user(u.id); assert.equal(x.plan_id, 'starter'); assert.equal(x.auto_renew, 1); assert.equal(x.stripe_sub, null, 'never touches the Stripe subscription field');
    const b = await call('sub1', 'GET', '/api/billing');
    assert.equal(b.data.subscription.next_charge_at.slice(0, 10), periodEnd.slice(0, 10)); assert.match(b.data.subscription.next_amount_label, /^₦/);
  });

  await step('Bachs auto-renew: a renewal invoice.paid adds the new period\'s credits through the plan path; duplicates never give twice', async () => {
    const before = get("SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = ? AND bucket = 'plan' AND delta > 0", u.id).n;
    run('UPDATE users SET plan_credits = 3 WHERE id = ?', u.id); // most credits used
    const next = iso(Date.parse(periodEnd) + 30 * 864e5);
    subsMap.get(subId).current_period_end = next;
    const ev = { id: 'evt_i2', type: 'invoice.paid', data: { object: { id: 'inv_2', subscription_id: subId, billing_reason: 'subscription_cycle', amount_paid: price.amount.toFixed(2), currency: 'NGN', period_end: next } } };
    assert.equal((await hook(ev)).status, 200);
    assert.equal(paidPlanPays(u.id).length, 2);
    const x = user(u.id); assert.equal(x.plan_credits, require('./settings').planById('starter').credits_month);
    assert.equal(x.plan_expires_at.slice(0, 10), addDays(next, 1).slice(0, 10), 'paid period from Bachs');
    assert.equal(get("SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = ? AND bucket = 'plan' AND delta > 0", u.id).n, before + 1);
    assert.ok(emails(u.id, 'plan_renewed').length >= 1);
    await hook(ev); // same event again
    await hook({ ...ev, id: 'evt_i2_retry' }); // same invoice, new event id
    await hook({ id: 'evt_i1', type: 'invoice.paid', data: { object: { id: 'inv_1', subscription_id: subId, amount_paid: price.amount.toFixed(2), currency: 'NGN', period_end: periodEnd } } });
    assert.equal(paidPlanPays(u.id).length, 2, 'no second credit for the same invoice or event');
    assert.equal(get("SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = ? AND bucket = 'plan' AND delta > 0", u.id).n, before + 1);
    periodEnd = next;
  });

  await step('Bachs auto-renew: failed payment shows a calm notice and an email, gives nothing, keeps the plan during grace, then ends it', async () => {
    const credBefore = user(u.id).plan_credits;
    assert.equal((await hook({ id: 'evt_f1', type: 'invoice.payment_failed', data: { object: { id: 'inv_3', subscription_id: subId, amount_due: price.amount.toFixed(2), currency: 'NGN' } } })).status, 200);
    await hook({ id: 'evt_f2', type: 'invoice.payment_failed', data: { object: { id: 'inv_3', subscription_id: subId, amount_due: price.amount.toFixed(2), currency: 'NGN', attempt: 2 } } }); // Bachs retry fails again
    const row = get('SELECT * FROM bachs_subscriptions WHERE sub_id = ?', subId);
    assert.equal(row.status, 'past_due'); assert.equal(row.fail_count, 2);
    assert.equal(emails(u.id, 'payment_failed').length, 1, 'one email per failure run, not per retry');
    assert.equal(user(u.id).plan_credits, credBefore); assert.equal(paidPlanPays(u.id).length, 2);
    const b = await call('sub1', 'GET', '/api/billing');
    assert.ok(b.data.subscription.payment_failed && /Update your card/.test(b.data.subscription.payment_failed.message));
    const card = await call('sub1', 'POST', '/api/billing/card'); assert.match(card.data.url, /^https:\/\/billing\.bachs\.test\//);
    // A retry that succeeds clears it.
    const next = iso(Date.parse(periodEnd) + 30 * 864e5); subsMap.get(subId).current_period_end = next;
    await hook({ id: 'evt_i3', type: 'invoice.paid', data: { object: { id: 'inv_3', subscription_id: subId, amount_paid: price.amount.toFixed(2), currency: 'NGN', period_end: next } } });
    assert.equal(get('SELECT status FROM bachs_subscriptions WHERE sub_id = ?', subId).status, 'active'); assert.equal(paidPlanPays(u.id).length, 3);
    periodEnd = next;
    // A second subscriber whose retries all fail: after the grace period the plan ends like an expired plan.
    const u2 = await customer('sub2', 'subscriber2@example.com', 'NG');
    const co = await call('sub2', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: method().id });
    const sub2 = 'sub_' + crypto.randomBytes(4).toString('hex'), end2 = iso(Date.now() + 30 * 864e5);
    subsMap.set(sub2, { id: sub2, status: 'active', customer_id: 'cust_sub2', current_period_end: end2, metadata: { app: 'vooads', payment_id: String(co.data.payment_id) } });
    await hook({ id: 'evt_s2i1', type: 'invoice.paid', data: { object: { id: 'inv_s2_1', subscription_id: sub2, billing_reason: 'subscription_create', amount_paid: price.amount.toFixed(2), currency: 'NGN', period_end: end2, metadata: { payment_id: String(co.data.payment_id) } } } });
    assert.equal(user(u2.id).plan_id, 'starter');
    await hook({ id: 'evt_s2f1', type: 'invoice.payment_failed', data: { object: { id: 'inv_s2_2', subscription_id: sub2, amount_due: price.amount.toFixed(2), currency: 'NGN' } } });
    const g = get('SELECT grace_until FROM bachs_subscriptions WHERE sub_id = ?', sub2).grace_until;
    assert.ok(user(u2.id).plan_expires_at >= g, 'plan kept during grace');
    run('UPDATE bachs_subscriptions SET grace_until = ? WHERE sub_id = ?', addDays(new Date().toISOString(), -0.01), sub2); // grace is over
    await subs.daily();
    assert.equal(get('SELECT status FROM bachs_subscriptions WHERE sub_id = ?', sub2).status, 'unpaid');
    assert.ok(!require('./credits').activePlan(user(u2.id)), 'plan ended after grace');
  });

  await step('Bachs auto-renew: one-click cancel calls Bachs (end of period); the plan stays active', async () => {
    const u3 = await customer('sub3', 'subscriber3@example.com', 'KE');
    const co = await call('sub3', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: method().id });
    const s3 = 'sub_' + crypto.randomBytes(4).toString('hex'), e3 = iso(Date.now() + 30 * 864e5);
    subsMap.set(s3, { id: s3, status: 'active', customer_id: 'cust_sub3', current_period_end: e3, metadata: { app: 'vooads', payment_id: String(co.data.payment_id) } });
    const usd = subs.currentPrice(hm(), require('./settings').planById('starter'), 'month', 'KE');
    assert.equal(usd.currency, 'USD');
    await hook({ id: 'evt_s3i1', type: 'invoice.paid', data: { object: { id: 'inv_s3_1', subscription_id: s3, billing_reason: 'subscription_create', amount_paid: usd.amount.toFixed(2), currency: 'USD', period_end: e3, metadata: { payment_id: String(co.data.payment_id) } } } });
    assert.equal(user(u3.id).auto_renew, 1);
    const c = await call('sub3', 'POST', '/api/billing/cancel');
    assert.equal(c.status, 200, JSON.stringify(c.data));
    const del = log.filter((x) => x.method === 'DELETE').pop();
    assert.equal(del.url, '/v1/subscriptions/' + s3); assert.equal(del.body.cancel_at_period_end, true);
    assert.equal(user(u3.id).auto_renew, 0); assert.ok(require('./credits').activePlan(user(u3.id)), 'active until the end of the period');
    const b = await call('sub3', 'GET', '/api/billing'); assert.equal(b.data.subscription.cancel_at_period_end, true);
    await hook({ id: 'evt_s3d', type: 'customer.subscription.deleted', data: { object: { id: s3 } } });
    assert.equal(get('SELECT status FROM bachs_subscriptions WHERE sub_id = ?', s3).status, 'canceled');
  });

  await step('Bachs auto-renew: naira price follows FX: subscriber moved to the new price, reminder shows the new amount', async () => {
    const m = method();
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: { ngn_rate: 1800, ngn_rate_updated_at: new Date().toISOString() } });
    const newPrice = subs.currentPrice(hm(), require('./settings').planById('starter'), 'month', 'NG');
    assert.ok(newPrice.amount > price.amount);
    await subs.daily(addDays(periodEnd, -3)); // 3 days before the charge
    const patch = log.filter((x) => x.method === 'PATCH').pop();
    assert.equal(patch.url, '/v1/subscriptions/' + subId);
    assert.equal(products.get(patch.body.product_id).price.amount, newPrice.amount.toFixed(2));
    const mail = emails(u.id, 'card_renews_soon').pop();
    const v = JSON.parse(mail.vars); assert.match(v.amount, new RegExp(newPrice.amount.toLocaleString('en-US').replace(/[.,]/g, '.')));
    assert.ok(v.price_note && v.price_note.includes('changed'));
    await subs.daily(addDays(periodEnd, -3)); assert.equal(emails(u.id, 'card_renews_soon').length, 1, 'one reminder per charge');
    // Yearly: 7 days before too (and 3 days before).
    const uy = await customer('suby', 'subscribery@example.com', 'KE');
    const yp = subs.currentPrice(hm(), require('./settings').planById('starter'), 'year', 'KE');
    const ye = iso(Date.now() + 7 * 864e5), sy = 'sub_y' + crypto.randomBytes(3).toString('hex');
    run("INSERT INTO bachs_subscriptions(user_id, method_id, sub_id, plan_id, period, currency, amount_local, amount_usd, status, paid_through) VALUES(?,?,?,'starter','year','USD',?,?, 'active', ?)", uy.id, m.id, sy, yp.amount, yp.base_usd, ye);
    await subs.daily(); assert.equal(emails(uy.id, 'card_renews_soon').length, 1, 'yearly gets the 7-day reminder');
    assert.equal(JSON.parse(emails(uy.id, 'card_renews_soon')[0].vars).days, '7');
    await subs.daily(addDays(ye, -3)); assert.equal(emails(uy.id, 'card_renews_soon').length, 2, 'and the 3-day one');
    // Bachs confirms the move → our record follows.
    await hook({ id: 'evt_u1', type: 'customer.subscription.updated', data: { object: { id: subId } } });
    assert.equal(get('SELECT amount_local FROM bachs_subscriptions WHERE sub_id = ?', subId).amount_local, newPrice.amount);
    price = newPrice;
  });

  await step('Bachs auto-renew: Bachs refuses the price change → renewal still gives credits, is flagged under the margin floor, moved later', async () => {
    const m = method();
    refusePatch = true;
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: { ngn_rate: 4000, ngn_rate_updated_at: new Date().toISOString() } });
    await subs.daily(addDays(periodEnd, -3));
    assert.match(get('SELECT price_move FROM bachs_subscriptions WHERE sub_id = ?', subId).price_move, /refused/);
    const next = iso(Date.parse(periodEnd) + 30 * 864e5); subsMap.get(subId).current_period_end = next;
    const n = paidPlanPays(u.id).length;
    await hook({ id: 'evt_i4', type: 'invoice.paid', data: { object: { id: 'inv_4', subscription_id: subId, amount_paid: price.amount.toFixed(2), currency: 'NGN', period_end: next } } });
    const pp = paidPlanPays(u.id); assert.equal(pp.length, n + 1, 'credits for what Bachs was paid');
    assert.match(pp[pp.length - 1].review_flag || '', /margin floor/);
    assert.match(get('SELECT flag FROM bachs_subscriptions WHERE sub_id = ?', subId).flag, /margin floor/);
    const a = await O('GET', '/api/admin/bachs/subscriptions');
    assert.equal(a.status, 200); assert.ok(a.data.subscriptions.some((x) => x.sub_id === subId && x.flag)); assert.ok(a.data.flagged.length >= 1);
    refusePatch = false;
    await subs.movePrice(hm(), get('SELECT * FROM bachs_subscriptions WHERE sub_id = ?', subId));
    assert.match(get('SELECT price_move FROM bachs_subscriptions WHERE sub_id = ?', subId).price_move, /^Moving/);
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: { ngn_rate: 1500, ngn_rate_updated_at: new Date().toISOString() } });
  });

  await step('Bachs auto-renew: no subscription access → checkout quietly falls back to a one-off payment; flag off works too', async () => {
    const m = method();
    refuseProducts = true;
    run("DELETE FROM bachs_products"); // force a new product
    const co = await call('sub1', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'pro', period: 'month', method_id: m.id });
    assert.equal(co.status, 200, JSON.stringify(co.data)); assert.equal(co.data.auto_renew, false);
    assert.ok(log.filter((x) => x.url === '/v1/checkout-sessions').pop().body.pricing, 'one-off');
    assert.ok(JSON.parse(method().config).recurring_unavailable, 'reason kept for the admin');
    assert.equal((await call('sub1', 'GET', '/api/billing')).data.methods.find((x) => x.adapter === 'bachs').card_auto_renew, false);
    refuseProducts = false;
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: { recurring: 'no', recurring_unavailable: null } });
    assert.equal((await call('sub1', 'GET', '/api/billing')).data.methods.find((x) => x.adapter === 'bachs').card_auto_renew, false);
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: { recurring: 'yes' }, enabled: false });
    delete process.env.BACHS_API_BASE;
    fake.close();
  });
};
