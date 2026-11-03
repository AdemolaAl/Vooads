// Self-check group "voo": "Continue with VooSquare" through the Voo Connect kit, against a fake VooSquare in this
// process. Login next to the email login, linking only when the email is verified on both sides, never a duplicate,
// "You already have a Voo account", launcher return_to, forged tokens and state, payment events, summary card, logout.
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert');

module.exports = async function vooChecks({ call, step }) {
  const { get, all, run } = require('./db');
  const integ = require('./integrations');
  const voo = require('./voo');
  const CLIENT = 'vsc_vooads_check';
  const SECRET = 'vss_' + 'q'.repeat(40);
  const API_KEY = 'vsk_' + 'k'.repeat(40);
  const codes = new Map();
  const events = [];
  const vooEmails = new Set();
  let base = '';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const idToken = (claims, secret = SECRET) => { const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(claims); return h + '.' + crypto.createHmac('sha256', secret).update(h).digest('base64url'); };
  const vs = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const keyOk = req.headers.authorization === 'Bearer ' + API_KEY;
      if (u.pathname === '/oauth/token') {
        const f = new URLSearchParams(body);
        if (f.get('client_id') !== CLIENT || f.get('client_secret') !== SECRET) return json({ error: 'invalid_client' }, 401);
        const p = codes.get(f.get('code'));
        if (!p) return json({ error: 'invalid_grant' }, 400);
        codes.delete(f.get('code'));
        const now = Math.floor(Date.now() / 1000);
        const user = { sub: p.voo_id, voo_id: p.voo_id, email: p.email, email_verified: p.email_verified !== false, name: p.name || 'Grace Lee', country: p.country || 'KE', voo_ref: '' };
        return json({ access_token: 'vsat.x', token_type: 'Bearer', expires_in: 3600, id_token: idToken({ ...user, iss: base, aud: CLIENT, iat: now, exp: now + 300 }, p.badToken ? 'wrong-secret' : SECRET), user });
      }
      if (u.pathname === '/api/v1/events') { if (!keyOk) return json({ error: 'bad key' }, 401); const list = JSON.parse(body).events || []; events.push(...list); return json({ stored: list.length, rejected: [] }); }
      if (u.pathname === '/api/v1/users/lookup') { if (!keyOk) return json({ error: 'bad key' }, 401); return json({ voo_id_exists: vooEmails.has(JSON.parse(body).email) }); }
      if (u.pathname.startsWith('/api/v1/users/')) return keyOk ? json({ error: 'not found' }, 404) : json({ error: 'bad key' }, 401);
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => vs.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + vs.address().port;
  const enable = () => { integ.save({ 'voosquare.base': base, 'voosquare.client_id': CLIENT, 'voosquare.client_secret': SECRET, 'voosquare.api_key': API_KEY, 'voosquare.signal_secret': 's'.repeat(40) }); voo.reset(); };
  const disable = () => { integ.save({}, { clear: ['voosquare.base', 'voosquare.client_id', 'voosquare.client_secret', 'voosquare.api_key', 'voosquare.signal_secret'] }); voo.reset(); };
  const ip = () => ({ 'x-forwarded-for': '10.77.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });

  // The browser round trip: /auth/voosquare → (VooSquare) → /auth/voosquare/callback.
  async function vooLogin(jar, person, { returnTo, tamperState = false } = {}) {
    const h = ip();
    const start = await call(jar, 'GET', '/auth/voosquare' + (returnTo ? '?return_to=' + encodeURIComponent(returnTo) : ''), null, h);
    assert.equal(start.status, 302, 'start redirects');
    const loc = new URL(start.location);
    assert.equal(loc.origin + loc.pathname, base + '/oauth/authorize');
    assert.equal(loc.searchParams.get('client_id'), CLIENT);
    const code = 'c_' + crypto.randomBytes(6).toString('hex');
    codes.set(code, person);
    const state = tamperState ? 'not-the-state' : loc.searchParams.get('state');
    return call(jar, 'GET', '/auth/voosquare/callback?code=' + code + '&state=' + encodeURIComponent(state), null, h);
  }
  const emailLogin = async (jar, email, extra = {}) => { const h = ip(); const c = await call(jar, 'POST', '/api/auth/code', { email }, h); return call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, ...extra }, h); };

  await step('Voo login: off until keys are set; email login keeps working', async () => {
    disable();
    assert.equal((await call('vx', 'GET', '/api/public/config')).data.voosquare_login, false);
    const r = await call('vx', 'GET', '/auth/voosquare');
    assert.equal(r.status, 302); assert.equal(r.location, '/app');
    enable();
    assert.equal((await call('vx', 'GET', '/api/public/config')).data.voosquare_login, true);
  });

  await step('Voo login: a new Voo ID gets a new account (trial credits, country from VooSquare) and a session', async () => {
    const r = await vooLogin('v1', { voo_id: 'voo_new_1', email: 'vooperson@example.com', country: 'KE', name: 'Grace Lee' });
    assert.equal(r.status, 302, JSON.stringify(r.data)); assert.ok(String(r.location).startsWith('/app'));
    const me = (await call('v1', 'GET', '/api/me')).data.user;
    assert.equal(me.email, 'vooperson@example.com'); assert.equal(me.voo_id, 'voo_new_1'); assert.equal(me.country, 'KE');
    // Same Voo ID again: same account.
    await vooLogin('v1b', { voo_id: 'voo_new_1', email: 'vooperson@example.com' });
    assert.equal(get('SELECT COUNT(*) AS c FROM users WHERE email = ?', 'vooperson@example.com').c, 1);
  });

  await step('Voo login: an existing email-code account is linked when the email is verified on both sides (no duplicate)', async () => {
    assert.equal((await emailLogin('v2', 'linkme@example.com', { name: 'Ana' })).status, 200);
    const before = get('SELECT * FROM users WHERE email = ?', 'linkme@example.com');
    const r = await vooLogin('v2voo', { voo_id: 'voo_link_2', email: 'linkme@example.com', email_verified: true });
    assert.equal(r.status, 302, JSON.stringify(r.data));
    const after = get('SELECT * FROM users WHERE email = ?', 'linkme@example.com');
    assert.equal(after.id, before.id); assert.equal(after.voo_id, 'voo_link_2');
    assert.equal(get('SELECT COUNT(*) AS c FROM users WHERE email = ?', 'linkme@example.com').c, 1);
    // The old email login still opens the same account.
    assert.equal((await emailLogin('v2b', 'linkme@example.com')).data.user.id, before.id);
  });

  await step('Voo login: not linked when VooSquare has not verified the email (clear message, no second account)', async () => {
    await emailLogin('v3', 'notverified@example.com');
    const r = await vooLogin('v3voo', { voo_id: 'voo_unver_3', email: 'notverified@example.com', email_verified: false });
    assert.equal(r.status, 409); assert.match(String(r.data), /Confirm your email in VooSquare/);
    assert.equal(get('SELECT voo_id FROM users WHERE email = ?', 'notverified@example.com').voo_id, null);
    assert.equal(get('SELECT COUNT(*) AS c FROM users WHERE voo_id = ?', 'voo_unver_3').c, 0);
    // Not verified on the Vooads side either: refused too.
    run("INSERT INTO users(email, ref_code, email_verified) VALUES('unconfirmed@example.com', 'refuncf1', 0)");
    const r2 = await vooLogin('v3b', { voo_id: 'voo_unver_4', email: 'unconfirmed@example.com', email_verified: true });
    assert.equal(r2.status, 409); assert.equal(get('SELECT voo_id FROM users WHERE email = ?', 'unconfirmed@example.com').voo_id, null);
  });

  await step('Voo login: a new email-code sign-up with an email that has a Voo account is sent to VooSquare', async () => {
    vooEmails.add('hasvoo@example.com');
    const r = await emailLogin('v4', 'hasvoo@example.com');
    assert.equal(r.status, 409); assert.equal(r.data.voo_account, true);
    assert.equal(r.data.error, 'You already have a Voo account. Log in with VooSquare.');
    assert.ok(!get('SELECT 1 FROM users WHERE email = ?', 'hasvoo@example.com'), 'no account made');
  });

  await step('Voo login: launcher return_to lands in the studio; no open redirect; forged token and state are refused', async () => {
    const a = await vooLogin('v5', { voo_id: 'voo_new_1', email: 'vooperson@example.com' }, { returnTo: '/dashboard' });
    assert.equal(a.location, '/app');
    const b = await vooLogin('v5b', { voo_id: 'voo_new_1', email: 'vooperson@example.com' }, { returnTo: '//evil.example/x' });
    assert.equal(b.location, '/app');
    const c = await vooLogin('v5c', { voo_id: 'voo_new_1', email: 'vooperson@example.com' }, { returnTo: '/app#wallet' });
    assert.equal(c.location, '/app#wallet');
    const bad = await vooLogin('v5d', { voo_id: 'voo_new_1', email: 'vooperson@example.com', badToken: true });
    assert.equal(bad.status, 400); assert.equal((await call('v5d', 'GET', '/api/me')).data.user, null);
    const st = await vooLogin('v5e', { voo_id: 'voo_new_1', email: 'vooperson@example.com' }, { tamperState: true });
    assert.equal(st.status, 400); assert.equal((await call('v5e', 'GET', '/api/me')).data.user, null);
  });

  await step('Voo login: "Connect VooSquare" links the account that pressed it (a different Voo email is fine)', async () => {
    await emailLogin('v6', 'connectme@example.com');
    const l = await call('v6', 'POST', '/api/auth/voosquare/link', {});
    assert.equal(l.status, 200, JSON.stringify(l.data));
    const r = await vooLogin('v6', { voo_id: 'voo_conn_6', email: 'other-address@example.com' });
    assert.equal(r.status, 302, JSON.stringify(r.data)); assert.match(r.location, /voo=linked/);
    assert.equal(get('SELECT voo_id FROM users WHERE email = ?', 'connectme@example.com').voo_id, 'voo_conn_6');
    assert.ok(!get('SELECT 1 FROM users WHERE email = ?', 'other-address@example.com'));
  });

  await step('Voo login: plan payments reach VooSquare as spend + plan_started, once; summary card needs the API key', async () => {
    await vooLogin('v7', { voo_id: 'voo_pay_7', email: 'voopayer@example.com', country: 'GH' });
    const co = await call('v7', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: 0 });
    assert.equal(co.status, 200, JSON.stringify(co.data));
    await call('v7', 'GET', '/api/pay/test/' + co.data.payment_id);
    await call('v7', 'GET', '/api/pay/test/' + co.data.payment_id); // a repeat changes nothing
    await voo.kit().events.flush();
    const mine = events.filter((e) => e.voo_id === 'voo_pay_7');
    assert.deepEqual(mine.map((e) => e.type).sort(), ['plan_started', 'spend']);
    assert.ok(mine.every((e) => e.value_usd === 49), JSON.stringify(mine));
    const payRow = get('SELECT provider_ref, event_key FROM payments WHERE id = ?', co.data.payment_id);
    assert.equal(mine.find((e) => e.type === 'spend').event_id, 'va_pay_' + payRow.event_key, 'stable random key, never the row number');
    assert.match(payRow.event_key, /^k[0-9a-f]{20}$/);
    assert.equal(mine.find((e) => e.type === 'spend').payment_ref, payRow.provider_ref || 'VA-' + payRow.event_key, 'kit 1.3.0: the spend carries the payment reference (never paid twice)');
    assert.equal((await call('x', 'GET', '/api/voosquare/summary?voo_id=voo_pay_7&period=7d', null, { Authorization: 'Bearer ' + API_KEY })).data.linked, true);
    assert.equal((await call('x', 'GET', '/api/voosquare/summary?voo_id=voo_pay_7', null, { Authorization: 'Bearer vsk_wrong' })).status, 401);
  });


  // ---------------- Money events: stable ids, credit packs, refunds, chargebacks (VooSquare INTEGRATION.md §2b, §2c) ----------------
  const vm = require('./voomoney');
  const credits = require('./credits');
  const { sha256, id: rid } = require('./lib/util');
  const role = get("SELECT id FROM roles WHERE name = 'Owner'").id;
  run("INSERT OR IGNORE INTO staff(email, name, role_id, status) VALUES('vmoney@example.com', 'Money', ?, 'active')", role);
  const sidM = rid(32);
  run('INSERT INTO sessions(id, staff_id, expires_at) VALUES(?,?,?)', sha256('sess:' + sidM), get("SELECT id FROM staff WHERE email = 'vmoney@example.com'").id, new Date(Date.now() + 864e5).toISOString());
  const S = (m, u, b) => call('vmoney', m, u, b, { Cookie: 'va_a=' + sidM });
  const me = () => get("SELECT * FROM users WHERE voo_id = 'voo_pay_7'");
  const ev = (f) => events.filter((e) => e.voo_id === 'voo_pay_7' && f(e));
  const buy = async (body) => { const co = await call('v7', 'POST', '/api/billing/checkout', body); assert.equal(co.status, 200, JSON.stringify(co.data)); await call('v7', 'GET', '/api/pay/test/' + co.data.payment_id); return co.data.payment_id; };

  await step('VooSquare ids: new payments get a stored random event key; payments already sent keep their old row-id ids', async () => {
    const u = me();
    const old = Number(run("INSERT INTO payments(user_id, adapter, kind, topup_id, credits, amount_usd, status, paid_at) VALUES(?, 'test', 'topup', 't1', 350, 19, 'paid', ?)", u.id, new Date().toISOString()).lastInsertRowid);
    vm.legacyKeys();
    assert.equal(get('SELECT event_key FROM payments WHERE id = ?', old).event_key, String(old), 'already-sent ids are kept');
    const n = Number(run("INSERT INTO payments(user_id, adapter, kind, topup_id, credits, amount_usd, status) VALUES(?, 'test', 'topup', 't1', 350, 19, 'pending')", u.id).lastInsertRowid);
    const k1 = vm.eventKey(n), k2 = vm.eventKey(n);
    assert.equal(k1, k2, 'made once, stored'); assert.notEqual(k1, String(n)); assert.match(k1, /^k[0-9a-f]{20}$/);
    run('DELETE FROM payments WHERE id IN (?, ?)', old, n);
    // Activity and cancel events are keyed by the Voo ID, not a row number.
    voo.reportActivity(u, 'ads_generated', 'x');
    await voo.kit().events.flush();
    assert.ok(ev((e) => e.type === 'ads_generated').every((e) => e.event_id.includes('voo_pay_7')));
  });

  let packPid;
  await step('Credit packs: wallet_topup only when bought; ONE spend per customer per day as pack credits are used (never twice, never above the price)', async () => {
    packPid = await buy({ kind: 'topup', topup_id: 't1', method_id: 0 });
    await voo.kit().events.flush();
    const key = get('SELECT event_key FROM payments WHERE id = ?', packPid).event_key;
    assert.equal(ev((e) => e.event_id === 'va_topup_' + key && e.type === 'wallet_topup').length, 1);
    assert.equal(ev((e) => e.type === 'spend' && e.value_usd === 19).length, 0, 'the top-up itself is never a spend');
    run('UPDATE users SET plan_credits = 0, trial_credits = 0 WHERE id = ?', me().id); // use the pack, not the plan or trial credits
    const t1 = credits.spend(me().id, 100, 'test use', 'job:x1');
    assert.equal(t1.topup, 100);
    const t2 = credits.spend(me().id, 50, 'test use', 'job:x2');
    credits.refund(me().id, t2, 'Refund: job failed', 'job:x2'); // a failed job gives its credits back: not used, not reported
    const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    assert.equal(vm.flushUsage({ before: tomorrow }), 1);
    assert.equal(vm.flushUsage({ before: tomorrow }), 0, 'never sent twice');
    await voo.kit().events.flush();
    const day = new Date().toISOString().slice(0, 10);
    const use = ev((e) => e.type === 'spend' && e.event_id === `va_use_${day}_voo_pay_7`);
    assert.equal(use.length, 1); assert.equal(use[0].value_usd, Math.round(100 * 19 / 350 * 100) / 100);
    // Using the whole pack can never report more than was paid for it.
    credits.spend(me().id, 250, 'test use', 'job:x3');
    run("UPDATE credit_usage SET day = '2026-01-02' WHERE state = 'open'");
    vm.flushUsage({ before: tomorrow });
    const total = all('SELECT SUM(usd) AS t FROM credit_usage WHERE payment_id = ?', packPid)[0].t;
    assert.ok(total <= 19 + 1e-9, 'pack total ' + total);
    // Plan credits and staff grants never make a usage spend.
    credits.grant(me().id, 500, 'topup', 'goodwill', null, null);
    credits.spend(me().id, 200, 'test use', 'job:x4');
    assert.equal(get("SELECT COUNT(*) AS n FROM credit_usage WHERE state = 'open' AND user_id = ?", me().id).n, 0, 'free credits are not reported');
  });

  await step('Refunds: a pack refund sends refund (no original: no spend of its own); a plan refund ends the plan, removes its credits and points at its spend', async () => {
    // Pack: a fresh one, half used.
    const pid = await buy({ kind: 'topup', topup_id: 't1', method_id: 0 });
    run('UPDATE users SET topup_credits = 350, plan_credits = 0, trial_credits = 0 WHERE id = ?', me().id);
    credits.spend(me().id, 150, 'test use', 'job:x5');
    const r = await S('POST', `/api/admin/payments/${pid}/refund`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.removed, 200); assert.equal(r.data.shortfall, 150);
    assert.ok(me().topup_credits >= 0);
    assert.equal(get('SELECT refund_shortfall FROM payments WHERE id = ?', pid).refund_shortfall, 150);
    await voo.kit().events.flush();
    const key = get('SELECT event_key FROM payments WHERE id = ?', pid).event_key;
    const rf = ev((e) => e.event_id === 'va_rf_' + key);
    assert.equal(rf.length, 1); assert.equal(rf[0].type, 'refund'); assert.equal(rf[0].value_usd, 19); assert.ok(!rf[0].original_event_id);
    assert.equal((await S('POST', `/api/admin/payments/${pid}/refund`, {})).status, 400, 'once');
    // Plan: the current plan payment.
    const planPid = await buy({ kind: 'plan', plan_id: 'pro', period: 'month', method_id: 0 });
    assert.equal(me().plan_id, 'pro');
    credits.spend(me().id, 3000, 'test use', 'job:x6');
    const left = me().plan_credits;
    const pr = await S('POST', `/api/admin/payments/${planPid}/refund`, {});
    assert.equal(pr.status, 200, JSON.stringify(pr.data));
    assert.equal(pr.data.plan_ended, true); assert.equal(pr.data.removed, left); assert.equal(pr.data.shortfall, 3500 - left);
    const u = me();
    assert.ok(u.plan_expires_at <= new Date().toISOString() && u.plan_credits === 0 && u.auto_renew === 0, 'plan ended, its credits gone, never below zero');
    assert.equal(credits.balance(u.id).planActive, false);
    await voo.kit().events.flush();
    const pk = get('SELECT event_key FROM payments WHERE id = ?', planPid).event_key;
    const prf = ev((e) => e.event_id === 'va_rf_' + pk)[0];
    assert.equal(prf.type, 'refund'); assert.equal(prf.original_event_id, 'va_pay_' + pk); assert.equal(prf.plan, 'pro');
  });

  await step('Chargebacks: a plan chargeback reverses its spend; a pack chargeback names each daily usage spend that used it; providers report them', async () => {
    const planPid = await buy({ kind: 'plan', plan_id: 'starter', period: 'month', method_id: 0 });
    const c = await S('POST', `/api/admin/payments/${planPid}/chargeback`, { ref: 'dp_test_1' });
    assert.equal(c.status, 200, JSON.stringify(c.data));
    await voo.kit().events.flush();
    const pk = get('SELECT event_key FROM payments WHERE id = ?', planPid).event_key;
    const cb = ev((e) => e.event_id === 'va_cb_' + pk)[0];
    assert.equal(cb.type, 'chargeback'); assert.equal(cb.original_event_id, 'va_pay_' + pk); assert.equal(cb.value_usd, 49);
    assert.equal(get('SELECT refund_kind FROM payments WHERE id = ?', planPid).refund_kind, 'chargeback');
    // Pack: used yesterday (sent), then used today (not sent yet), then charged back.
    const pid = await buy({ kind: 'topup', topup_id: 't1', method_id: 0 });
    run('UPDATE users SET plan_credits = 0, trial_credits = 0, topup_credits = 350 WHERE id = ?', me().id);
    credits.spend(me().id, 70, 'test use', 'job:x7');
    run("UPDATE credit_usage SET day = '2026-01-03' WHERE state = 'open' AND payment_id = ?", pid);
    vm.flushUsage({ before: new Date(Date.now() + 864e5).toISOString().slice(0, 10) });
    credits.spend(me().id, 35, 'test use', 'job:x8');
    const k = await S('POST', `/api/admin/payments/${pid}/chargeback`, {});
    assert.equal(k.status, 200);
    await voo.kit().events.flush();
    const key = get('SELECT event_key FROM payments WHERE id = ?', pid).event_key;
    const pcb = ev((e) => e.type === 'chargeback' && e.event_id.startsWith('va_cb_' + key));
    assert.equal(pcb.length, 1); assert.equal(pcb[0].original_event_id, 'va_use_2026-01-03_voo_pay_7'); assert.equal(pcb[0].value_usd, Math.round(70 * 19 / 350 * 100) / 100);
    assert.equal(get("SELECT COUNT(*) AS n FROM credit_usage WHERE payment_id = ? AND state = 'open'", pid).n, 0, 'unsent usage of a charged-back pack is never reported');
    // Stripe and Paystack disputes map to the right payment.
    const stripe = require('./payments/stripe'), paystack = require('./payments/paystack');
    const { hmac } = require('./lib/util');
    const sp = Number(run("INSERT INTO payments(user_id, adapter, kind, plan_id, credits, amount_usd, provider_ref, status, raw, paid_at) VALUES(?, 'stripe', 'plan', 'starter', 1000, 49, 'cs_d1', 'paid', ?, ?)", me().id, JSON.stringify({ payment_intent: 'pi_d1' }), new Date().toISOString()).lastInsertRowid);
    const raw = Buffer.from(JSON.stringify({ type: 'charge.dispute.created', data: { object: { id: 'dp_1', payment_intent: 'pi_d1' } } })); const t = Math.floor(Date.now() / 1000);
    const se = stripe.webhook({ webhookSecret: 'whsec_s' }, { headers: { 'stripe-signature': `t=${t},v1=${hmac('sha256', 'whsec_s', t + '.' + raw.toString('utf8'))}` }, rawBody: raw });
    assert.deepEqual([se.type, se.paymentId], ['chargeback', sp]);
    const pp = Number(run("INSERT INTO payments(user_id, adapter, kind, topup_id, credits, amount_usd, provider_ref, status, paid_at) VALUES(?, 'paystack', 'topup', 't1', 350, 19, 'va_psk_ref1', 'paid', ?)", me().id, new Date().toISOString()).lastInsertRowid);
    const praw = Buffer.from(JSON.stringify({ event: 'charge.dispute.create', data: { id: 77, transaction: { reference: 'va_psk_ref1' } } }));
    const pe = paystack.webhook({ secret: 'sk_x' }, { headers: { 'x-paystack-signature': require('node:crypto').createHmac('sha512', 'sk_x').update(praw).digest('hex') }, rawBody: praw });
    assert.deepEqual([pe.type, pe.paymentId], ['chargeback', pp]);
    run('DELETE FROM payments WHERE id IN (?, ?)', sp, pp);
  });

  await step('Voo login: logout ends our session and sends Voo ID accounts to VooSquare\'s logout; a cross-site GET only asks', async () => {
    const r = await call('v7', 'GET', '/auth/voosquare/logout', null, { 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(r.status, 302); assert.ok(r.location.startsWith(base + '/oauth/logout'));
    assert.equal((await call('v7', 'GET', '/api/me')).data.user, null);
    await vooLogin('v8', { voo_id: 'voo_pay_7', email: 'voopayer@example.com' });
    const x = await call('v8', 'GET', '/auth/voosquare/logout', null, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(x.status, 200); assert.ok((await call('v8', 'GET', '/api/me')).data.user, 'still logged in');
  });

  await step('Voo login: keys live in Admin → Integrations (encrypted, never sent back), the login test checks them', async () => {
    const own = get("SELECT id FROM staff WHERE email = 'owner@example.com'");
    assert.ok(own);
    const raw = JSON.stringify(require('./settings').getSetting('integrations'));
    assert.ok(!raw.includes(SECRET) && !raw.includes(API_KEY), 'stored encrypted');
    const t = await integ.testVooLogin();
    assert.equal(t.ok, true, t.note); assert.match(t.note, /API key accepted/);
    const view = JSON.stringify(integ.fieldsView());
    assert.ok(!view.includes(SECRET) && !view.includes(API_KEY), 'never sent back');
    disable();
  });

  await new Promise((r) => vs.close(r));
  void all;
};
