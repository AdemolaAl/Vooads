// Self-check group "bachscap": the Bachs payment cap (default $5,000 per payment, fee inside, naira counted back at the
// checkout's effective rate) against a fake Bachs in this process. Under and exactly at the cap go through as before;
// over the cap is refused by the server before anything reaches Bachs, while the other methods still work; naira near
// the boundary; the admin setting and the BACHS_MAX_USD fallback; and an auto-renew whose renewal price would go over the
// cap is never moved to that price: flagged for admin, auto-renew ends, one-off reminder sent.
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert');

module.exports = async function bachsCapChecks({ call, step }) {
  const { get, all, run } = require('./db');
  const { sha256, id, addDays } = require('./lib/util');
  const settings = require('./settings');
  const bachs = require('./payments/bachs');
  const subs = require('./payments/bachs-subs');
  const LIVE = 'sk_live_vooadscap123', WHS = 'whsec_vooadscap123';
  const MSG = 'Bachs takes up to $5,000 per payment. Pay in parts, or choose another method.';
  const log = [], subsMap = new Map();
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer ' + LIVE) return json({ message: 'Invalid API key' }, 401);
      const p = body ? JSON.parse(body) : {};
      log.push({ method: req.method, url: req.url, body: p });
      if (req.method === 'POST' && req.url === '/v1/products') return json({ data: { id: 'prod_' + crypto.randomBytes(4).toString('hex'), ...p } }, 201);
      if (req.method === 'POST' && req.url === '/v1/checkout-sessions') { const cid = 'chk_' + crypto.randomBytes(5).toString('hex'); return json({ checkout_id: cid, checkout_url: 'https://checkout.bachs.test/' + cid, reference: p.reference, status: 'OPEN' }, 201); }
      const m = /^\/v1\/subscriptions\/([\w-]+)$/.exec(req.url);
      if (m && subsMap.has(m[1])) {
        const s = subsMap.get(m[1]);
        if (req.method === 'DELETE') s.cancel_at_period_end = !!p.cancel_at_period_end;
        if (req.method === 'PATCH') s.product_id = p.product_id;
        return json({ data: s });
      }
      json({ message: 'nope' }, 404);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.BACHS_API_BASE = 'http://127.0.0.1:' + fake.address().port;
  const envWas = process.env.BACHS_MAX_USD; delete process.env.BACHS_MAX_USD;

  const owner = get("SELECT id FROM roles WHERE name = 'Owner'").id;
  run("INSERT OR IGNORE INTO staff(email, name, role_id, status) VALUES('capowner@example.com', 'Cap Owner', ?, 'active')", owner);
  const sid = id(32);
  run('INSERT INTO sessions(id, staff_id, expires_at) VALUES(?,?,?)', sha256('sess:' + sid), get("SELECT id FROM staff WHERE email = 'capowner@example.com'").id, new Date(Date.now() + 864e5).toISOString());
  const O = (method, url, body) => call('capown', method, url, body, { Cookie: 'va_a=' + sid });
  const ip = () => ({ 'x-forwarded-for': '10.88.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });
  const customer = async (jar, email, country) => { const h = ip(); const c = await call(jar, 'POST', '/api/auth/code', { email }, h); const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, country }, h); assert.equal(v.status, 200, JSON.stringify(v.data)); return v.data.user; };
  const method = () => get("SELECT * FROM payment_methods WHERE adapter = 'bachs' ORDER BY id LIMIT 1");
  const hm = () => require('./payments').byIdAdapter(method().id, 'bachs');
  const bachsCalls = () => log.filter((x) => x.url === '/v1/checkout-sessions').length;
  const paysOf = (uid) => get('SELECT COUNT(*) AS n FROM payments WHERE user_id = ?', uid).n;
  const cfg = (extra = {}) => ({ ngn_rate: 1500, fx_buffer_pct: 0, recurring: 'no', ...extra });

  // Plans whose Bachs total (base + 4% fee) is just under, exactly at and one cent over $5,000.
  const savedPricing = JSON.parse(JSON.stringify(settings.pricing()));
  const mk = (pid, price) => ({ ...savedPricing.plans[0], id: pid, name: 'Cap ' + pid, price_month: price, price_year: price * 10 });
  settings.setSetting('pricing', { ...savedPricing, plans: [...savedPricing.plans, mk('capunder', 4000), mk('capat', 4807.69), mk('capover', 4807.70)] });
  // Another method for everyone, so a customer over the cap can still pay.
  const manualId = Number(run("INSERT INTO payment_methods(name, adapter, countries, enabled, sort, config) VALUES('Bank transfer (cap check)', 'manual', '[\"*\"]', 1, 90, ?)", JSON.stringify({ instructions: 'Pay to the account in the receipt email.' })).lastInsertRowid);
  let ke;

  await step('Bachs cap: the setting defaults to $5,000 (admin field, then BACHS_MAX_USD); totals include the 4% fee', async () => {
    const f = bachs.config_fields.find((x) => x.key === 'max_usd');
    assert.ok(f, 'admin field exists'); assert.equal(f.label, 'Bachs max per payment (USD)'); assert.equal(f.default, '5000');
    const m = method();
    const ok = await O('PUT', '/api/admin/payment-methods/' + m.id, { secret: LIVE, webhook_secret: WHS, config: cfg(), enabled: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(bachs.maxUsd(hm()), 5000); assert.equal(bachs.capMessage(hm()), MSG);
    process.env.BACHS_MAX_USD = '4500'; assert.equal(bachs.maxUsd(hm()), 4500, 'env fallback when the admin field is empty'); delete process.env.BACHS_MAX_USD;
    assert.equal(bachs.maxUsd({ config: { max_usd: '7000' } }), 7000, 'admin field wins');
    assert.equal((await O('PUT', '/api/admin/payment-methods/' + m.id, { config: cfg({ max_usd: '-5' }) })).status, 400, 'negative cap refused');
    assert.equal(require('./surcharge').quote(hm(), 4807.69).total_usd, 5000);
    assert.equal(require('./surcharge').quote(hm(), 4807.70).total_usd, 5000.01);
    ke = await customer('capke', 'cap.kenya@example.com', 'KE');
    run("INSERT INTO payments(user_id, adapter, kind, plan_id, period, credits, amount_usd, status, paid_at) VALUES(?, 'test', 'plan', 'starter', 'month', 0, 49, 'paid', ?)", ke.id, new Date().toISOString());
    const b = await call('capke', 'GET', '/api/billing');
    const x = b.data.methods.find((y) => y.adapter === 'bachs');
    assert.equal(x.max_usd, 5000); assert.equal(x.cap_note, MSG);
  });

  await step('Bachs cap: under the cap and exactly at the cap ($5,000.00 with the fee) start a Bachs checkout as before', async () => {
    const m = method();
    const u = await call('capke', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capunder', period: 'month', method_id: m.id });
    assert.equal(u.status, 200, JSON.stringify(u.data));
    assert.deepEqual(log.filter((x) => x.url === '/v1/checkout-sessions').pop().body.pricing, { currency: 'USD', amount: '4160.00', price_type: 'fixed' });
    const a = await call('capke', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capat', period: 'month', method_id: m.id });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    assert.deepEqual(log.filter((x) => x.url === '/v1/checkout-sessions').pop().body.pricing, { currency: 'USD', amount: '5000.00', price_type: 'fixed' });
    assert.equal(get('SELECT charged_usd FROM payments WHERE id = ?', a.data.payment_id).charged_usd, 5000);
  });

  await step('Bachs cap: one cent over is refused by the server before Bachs is called; other methods still offered and work', async () => {
    const m = method(), before = bachsCalls(), rows = paysOf(ke.id);
    const r = await call('capke', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capover', period: 'month', method_id: m.id });
    assert.equal(r.status, 400); assert.equal(r.data.error, MSG);
    assert.equal(bachsCalls(), before, 'nothing sent to Bachs'); assert.equal(paysOf(ke.id), rows, 'no payment row');
    // The adapter itself refuses too (defence in depth), and so does the subscription path.
    await assert.rejects(bachs.checkout(hm(), { payment: { id: 999999, kind: 'plan' }, user: { email: 'x@example.com', country: 'KE' }, amountUsd: 5000.01, description: 'x', successUrl: 'https://a', cancelUrl: 'https://b' }), (e) => e.customer && e.message === MSG);
    await assert.rejects(subs.ensureProduct(hm(), settings.planById('capover'), 'month', 'USD', 5000.01), (e) => e.message === MSG);
    assert.equal(bachsCalls(), before);
    const b = await call('capke', 'GET', '/api/billing');
    assert.ok(b.data.methods.some((x) => x.id === manualId), 'bank transfer still offered'); assert.ok(b.data.methods.some((x) => x.adapter === 'bachs'), 'Bachs still listed for smaller amounts');
    const other = await call('capke', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capover', period: 'month', method_id: manualId });
    assert.equal(other.status, 200, JSON.stringify(other.data));
    // A higher admin cap lets it through; the env fallback applies when the field is empty.
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: cfg({ max_usd: '6000' }) });
    assert.equal((await call('capke', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capover', period: 'month', method_id: m.id })).status, 200);
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: cfg() });
    process.env.BACHS_MAX_USD = '4500';
    const e = await call('capke', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capat', period: 'month', method_id: m.id });
    assert.equal(e.status, 400); assert.equal(e.data.error, 'Bachs takes up to $4,500 per payment. Pay in parts, or choose another method.');
    delete process.env.BACHS_MAX_USD;
  });

  await step('Bachs cap: naira near the boundary is counted back at the checkout rate (rate + FX buffer)', async () => {
    const m = method();
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: cfg({ fx_buffer_pct: 2 }) }); // effective ₦1,530 per $1
    const h = hm();
    assert.equal(require('./fx').effectiveRate(h), 1530);
    assert.equal(bachs.usdValue(h, 7650000, 'NGN'), 5000);
    assert.equal(bachs.overCap(h, 7650000, 'NGN'), false, 'exactly $5,000 in naira (at ₦1,530, not the ₦1,500 base rate)');
    assert.equal(bachs.overCap(h, 7650007.64, 'NGN'), false, 'under half a cent over rounds to the cap');
    assert.equal(bachs.overCap(h, 7650015.30, 'NGN'), true, 'one cent over');
    await customer('capng', 'cap.naira@example.com', 'NG');
    const at = await call('capng', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capat', period: 'month', method_id: m.id });
    assert.equal(at.status, 200, JSON.stringify(at.data));
    assert.deepEqual(log.filter((x) => x.url === '/v1/checkout-sessions').pop().body.pricing, { currency: 'NGN', amount: '7650000.00', price_type: 'fixed' });
    const before = bachsCalls();
    const over = await call('capng', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capover', period: 'month', method_id: m.id });
    assert.equal(over.status, 400); assert.equal(over.data.error, MSG); assert.equal(bachsCalls(), before);
    // Auto-renew on: the recurring product at exactly the cap is made; over the cap it is not.
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: cfg({ fx_buffer_pct: 2, recurring: 'yes' }) });
    const sub = await call('capng', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capat', period: 'month', method_id: m.id });
    assert.equal(sub.status, 200, JSON.stringify(sub.data)); assert.equal(sub.data.auto_renew, true);
    assert.equal(log.filter((x) => x.url === '/v1/products').pop().body.price.amount, '7650000.00');
    const prods = log.filter((x) => x.url === '/v1/products').length;
    assert.equal((await call('capng', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'capover', period: 'month', method_id: m.id })).status, 400);
    assert.equal(log.filter((x) => x.url === '/v1/products').length, prods, 'no product over the cap');
  });

  await step('Bachs cap: an auto-renew whose renewal price would go over is not moved; flagged, auto-renew ends, one-off reminder', async () => {
    const m = method();
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: cfg({ recurring: 'yes' }) });
    const u = await customer('capsub', 'cap.subscriber@example.com', 'KE');
    const due = addDays(new Date().toISOString(), 3), subId = 'sub_cap' + crypto.randomBytes(3).toString('hex');
    run("UPDATE users SET plan_id = 'capat', plan_period = 'month', plan_expires_at = ?, auto_renew = 1, plan_credits = 10 WHERE id = ?", addDays(due, 1), u.id);
    run("INSERT INTO bachs_subscriptions(user_id, method_id, sub_id, plan_id, period, currency, amount_local, amount_usd, status, paid_through) VALUES(?,?,?,'capat','month','USD',5000,4807.69,'active',?)", u.id, m.id, subId, due);
    subsMap.set(subId, { id: subId, status: 'active', cancel_at_period_end: false });
    // The owner raises the plan price: the renewal would be $5,096.00 with the fee.
    const p = settings.pricing();
    settings.setSetting('pricing', { ...p, plans: p.plans.map((x) => (x.id === 'capat' ? { ...x, price_month: 4900 } : x)) });
    const n = log.length;
    await subs.daily();
    const after = log.slice(n);
    assert.ok(!after.some((x) => x.url === '/v1/products'), 'no product at the over-cap price');
    assert.ok(!after.some((x) => x.method === 'PATCH'), 'subscription not moved');
    const del = after.find((x) => x.method === 'DELETE'); assert.ok(del, 'auto-renew turned off at Bachs'); assert.equal(del.body.cancel_at_period_end, true);
    const row = get('SELECT * FROM bachs_subscriptions WHERE sub_id = ?', subId);
    assert.match(row.flag, /over the Bachs limit of \$5,000/); assert.equal(row.cancel_at_period_end, 1); assert.equal(row.next_amount_local, null);
    assert.equal(get('SELECT auto_renew FROM users WHERE id = ?', u.id).auto_renew, 0);
    assert.equal(all("SELECT 1 FROM email_queue WHERE user_id = ? AND template = 'renewal_reminder'", u.id).length, 1, 'one-off reminder');
    assert.equal(all("SELECT 1 FROM email_queue WHERE user_id = ? AND template = 'card_renews_soon'", u.id).length, 0, 'no card charge reminder');
    await subs.daily();
    assert.equal(all("SELECT 1 FROM email_queue WHERE user_id = ? AND template = 'renewal_reminder'", u.id).length, 1, 'reminder sent once');
    const a = await O('GET', '/api/admin/bachs/subscriptions');
    assert.ok(a.data.subscriptions.some((x) => x.sub_id === subId && /limit/.test(x.flag || '')), 'flag shown to admin');
  });

  // Leave everything as the other groups expect it.
  settings.setSetting('pricing', savedPricing);
  run('DELETE FROM payment_methods WHERE id = ?', manualId);
  await O('PUT', '/api/admin/payment-methods/' + method().id, { config: { ngn_rate: 1500 }, enabled: false });
  if (envWas !== undefined) process.env.BACHS_MAX_USD = envWas;
  delete process.env.BACHS_API_BASE;
  await new Promise((r) => fake.close(r));
};
