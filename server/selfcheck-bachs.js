// Self-check group "bachs": Bachs naira and African payments against a fake Bachs in this process. Shown only in the
// countries it serves and to unknown countries, naira for Nigeria at the admin's rate, sandbox keys never shown on the
// live site, signed webhooks, credit only from Bachs's own answer and only once, admin key test and sandbox test.
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert');

module.exports = async function bachsChecks({ call, step }) {
  const { get, run } = require('./db');
  const { sha256, id } = require('./lib/util');
  const LIVE = 'sk_live_vooadscheck123', SBX = 'sk_sandbox_vooadscheck123', WHS = 'whsec_vooadscheck123';
  const sessions = new Map();
  const calls = [];
  let acceptKey = LIVE, down = false;
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (down) return json({ message: 'down' }, 503);
      if (req.headers.authorization !== 'Bearer ' + acceptKey) return json({ message: 'Invalid API key' }, 401);
      if (req.method === 'POST' && req.url === '/v1/checkout-sessions') {
        const p = JSON.parse(body);
        const cid = 'chk_' + crypto.randomBytes(5).toString('hex');
        const s = { checkout_id: cid, checkout_url: 'https://checkout.bachs.test/' + cid, reference: p.reference, pricing: p.pricing, status: 'OPEN' };
        sessions.set(cid, s); calls.push({ ...p, idem: req.headers['idempotency-key'] });
        return json(s, 201);
      }
      const m = /^\/v1\/checkout-sessions\/([\w-]+)$/.exec(req.url);
      if (req.method === 'GET' && m) { const s = sessions.get(m[1]); return s ? json(s) : json({ message: 'not found' }, 404); }
      json({ message: 'nope' }, 404);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.BACHS_API_BASE = 'http://127.0.0.1:' + fake.address().port;

  // An owner session straight in the database (other groups end the first owner session).
  const owner = get("SELECT id FROM roles WHERE name = 'Owner'").id;
  run("INSERT OR IGNORE INTO staff(email, name, role_id, status) VALUES('bachsowner@example.com', 'Bachs Owner', ?, 'active')", owner);
  const sid = id(32);
  run('INSERT INTO sessions(id, staff_id, expires_at) VALUES(?,?,?)', sha256('sess:' + sid), get("SELECT id FROM staff WHERE email = 'bachsowner@example.com'").id, new Date(Date.now() + 864e5).toISOString());
  const O = (method, url, body) => call('bachsown', method, url, body, { Cookie: 'va_a=' + sid });
  const ip = () => ({ 'x-forwarded-for': '10.66.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });
  const customer = async (jar, email, country) => { const h = ip(); const c = await call(jar, 'POST', '/api/auth/code', { email }, h); const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, ...(country ? { country } : {}) }, h); assert.equal(v.status, 200, JSON.stringify(v.data)); return v.data.user; };
  const bachsIn = async (jar) => (await call(jar, 'GET', '/api/billing')).data.methods.find((m) => m.adapter === 'bachs');
  const method = () => get("SELECT * FROM payment_methods WHERE adapter = 'bachs' ORDER BY id LIMIT 1");
  const hook = (ev, { secret = WHS, ts = Math.floor(Date.now() / 1000), headers } = {}) => {
    const raw = JSON.stringify(ev);
    const sig = crypto.createHmac('sha256', secret).update(ts + '.' + raw).digest('hex');
    return call('hook', 'POST', '/api/webhooks/bachs', Buffer.from(raw), { 'Content-Type': 'application/json', ...(headers || { 'x-bachs-timestamp': String(ts), 'x-bachs-signature': sig }) });
  };
  const pay = (pid) => get('SELECT * FROM payments WHERE id = ?', pid);

  let ng, ngPay;
  await step('Bachs: seeded switched off; cannot be switched on without both keys or with a sandbox key on the live site', async () => {
    const m = method();
    assert.ok(m, 'Bachs method row exists'); assert.equal(m.enabled, 0);
    assert.ok(JSON.parse(m.countries).includes('NG') && JSON.parse(m.countries).includes('KE'));
    assert.equal((await O('PUT', '/api/admin/payment-methods/' + m.id, { enabled: true })).status, 400, 'no keys');
    const s = await O('PUT', '/api/admin/payment-methods/' + m.id, { secret: SBX, webhook_secret: WHS, enabled: true });
    assert.equal(s.status, 400); assert.match(s.data.error, /sandbox/i);
    const ok = await O('PUT', '/api/admin/payment-methods/' + m.id, { secret: LIVE, webhook_secret: WHS, config: { ngn_rate: 1500 }, enabled: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.data)); assert.equal(method().enabled, 1);
  });

  await step('Bachs: shown in African countries (naira for Nigeria) and to unknown countries (US dollars), not elsewhere', async () => {
    ng = await customer('bng', 'naira.buyer@example.com', 'NG');
    const a = await bachsIn('bng');
    assert.ok(a, 'Nigeria sees Bachs'); assert.deepEqual(a.local, { currency: 'NGN', rate: 1500, paused: false });
    await customer('bke', 'kenya.buyer@example.com', 'KE');
    assert.equal((await bachsIn('bke')).local.currency, 'USD');
    await customer('bgb', 'uk.buyer@example.com', 'GB');
    assert.equal(await bachsIn('bgb'), undefined, 'not shown in the UK');
    await customer('bxx', 'nowhere.buyer@example.com', '');
    const u = await bachsIn('bxx');
    assert.ok(u, 'unknown country sees Bachs'); assert.equal(u.local.currency, 'USD');
  });

  await step('Bachs: checkout charges naira at the admin rate with our reference; a sandbox key is never shown live', async () => {
    const m = method();
    const co = await call('bng', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: m.id });
    assert.equal(co.status, 200, JSON.stringify(co.data)); assert.match(co.data.url, /^https:\/\/checkout\.bachs\.test\//);
    ngPay = co.data.payment_id;
    const last = calls[calls.length - 1];
    assert.deepEqual(last.pricing, { currency: 'NGN', amount: (49 * 1.04 * 1500).toFixed(2), price_type: 'fixed' }); // the Bachs price includes its 4% customer fee
    assert.equal(last.reference, 'va_' + ngPay); assert.equal(last.idem, 'va_' + ngPay);
    assert.equal(pay(ngPay).currency, 'NGN'); assert.equal(pay(ngPay).amount_local, 76440); assert.equal(pay(ngPay).amount_usd, 49, 'base price recorded'); assert.equal(pay(ngPay).fee_usd, 1.96);
    // Swap in a sandbox key directly: the live site hides the method and refuses its checkout.
    run('UPDATE payment_methods SET secret_enc = ? WHERE id = ?', require('./lib/util').encrypt(SBX), m.id);
    assert.equal(await bachsIn('bng'), undefined, 'sandbox key hidden');
    assert.equal((await call('bng', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: m.id })).status, 400);
    run('UPDATE payment_methods SET secret_enc = ? WHERE id = ?', require('./lib/util').encrypt(LIVE), m.id);
  });

  await step('Bachs: webhooks need a valid, fresh signature; credit only on Bachs\'s own "completed" answer, only once', async () => {
    const p = pay(ngPay);
    const cid = p.provider_ref.replace(/^bachs_/, '');
    const ev = { id: 'evt_1', type: 'collection.succeeded', data: { checkout_id: cid, reference: 'va_' + ngPay, status: 'succeeded' } };
    assert.equal((await hook(ev, { secret: 'whsec_wrong_secret_1' })).status, 401, 'wrong secret');
    assert.equal((await hook(ev, { ts: Math.floor(Date.now() / 1000) - 900 })).status, 401, 'too old');
    assert.equal((await hook(ev, { headers: {} })).status, 401, 'no signature');
    // Signed, but Bachs itself still says OPEN: nothing is given.
    assert.equal((await hook(ev)).status, 200);
    assert.equal(pay(ngPay).status, 'pending');
    // Bachs says completed but for less naira: not paid.
    Object.assign(sessions.get(cid), { status: 'COMPLETED', pricing: { currency: 'NGN', amount: '1000.00' } });
    await hook(ev);
    assert.equal(pay(ngPay).status, 'pending', 'underpaid');
    // Bachs is down: 502 so it retries.
    down = true; assert.equal((await hook(ev)).status, 502); down = false;
    // Completed in full: paid once.
    Object.assign(sessions.get(cid), { status: 'COMPLETED', pricing: { currency: 'NGN', amount: (49 * 1.04 * 1500).toFixed(2) } });
    assert.equal((await hook(ev)).status, 200);
    assert.equal(pay(ngPay).status, 'paid');
    const credits = get('SELECT plan_credits FROM users WHERE id = ?', ng.id).plan_credits;
    await hook(ev); await hook({ ...ev, id: 'evt_2' });
    assert.equal(get('SELECT plan_credits FROM users WHERE id = ?', ng.id).plan_credits, credits, 'never twice');
    assert.equal(get("SELECT COUNT(*) AS c FROM credit_ledger WHERE user_id = ? AND ref = ?", ng.id, 'pay:' + ngPay).c, 1);
  });

  await step('Bachs: a reference for another provider\'s payment, or a forged checkout, never pays anything', async () => {
    const other = await call('bng', 'POST', '/api/billing/checkout', { kind: 'topup', topup_id: 't1', method_id: 0 });
    assert.equal(other.status, 200, JSON.stringify(other.data));
    const r = await hook({ type: 'collection.succeeded', data: { checkout_id: 'chk_forged', reference: 'va_' + other.data.payment_id, status: 'succeeded' } });
    assert.equal(r.status, 200); assert.equal(pay(other.data.payment_id).status, 'pending');
  });

  await step('Bachs: admin key test, sandbox test and staging rule', async () => {
    const m = method();
    const t = await O('POST', '/api/admin/payment-methods/' + m.id + '/test');
    assert.equal(t.data.ok, true, t.data.note); assert.match(t.data.note, /live key/);
    acceptKey = 'sk_live_someone_else';
    assert.equal((await O('POST', '/api/admin/payment-methods/' + m.id + '/test')).data.ok, false, 'refused key');
    acceptKey = LIVE;
    const sb = await O('POST', '/api/admin/payment-methods/' + m.id + '/sandbox');
    assert.equal(sb.status, 200, JSON.stringify(sb.data));
    const steps = sb.data.steps || [];
    assert.ok(steps.some((s) => /forged signature/i.test(s.label) && s.ok), JSON.stringify(steps));
    const staging = require('./staging');
    const cfg = require('./config');
    const was = cfg.isStaging; cfg.isStaging = true;
    try {
      assert.ok(staging.paymentProblem({ adapter: 'bachs', secret: LIVE, config: {} }), 'staging refuses a live key');
      assert.equal(staging.paymentProblem({ adapter: 'bachs', secret: SBX, config: {} }), null);
    } finally { cfg.isStaging = was; }
    await O('PUT', '/api/admin/payment-methods/' + m.id, { enabled: false });
  });

  await step('Customer country: detected at sign-up from the edge header, else the browser guess; editable in Settings', async () => {
    const h = { ...ip(), 'cf-ipcountry': 'GH' };
    const c = await call('bcty', 'POST', '/api/auth/code', { email: 'edge.country@example.com' }, h);
    const v = await call('bcty', 'POST', '/api/auth/verify', { email: 'edge.country@example.com', code: c.data.dev_code, country: 'US' }, h);
    assert.equal(v.data.user.country, 'GH');
    const u2 = await customer('bcty2', 'tz.guess@example.com', 'ng');
    assert.equal(u2.country, 'NG');
    const put = await call('bcty2', 'PUT', '/api/me', { country: 'ke' });
    assert.equal(put.data.user.country, 'KE');
  });

  await new Promise((r) => fake.close(r));
  delete process.env.BACHS_API_BASE;
};
