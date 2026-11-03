// Self-check steps for sessions ("keep me signed in", sign out everywhere) and security fixes from the Oct 2026 audit.
// Called from selfcheck.js: securityChecks({ call, step, wait }).
const assert = require('node:assert');

module.exports = async function securityChecks({ call, step }) {
  const B = process.env.APP_URL;
  const ipH = () => ({ 'x-forwarded-for': '10.77.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });
  // Log in and return the raw Set-Cookie header so the cookie flags can be checked.
  async function login(email, extra = {}) {
    const ip = ipH();
    const c = await (await fetch(B + '/api/auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json', ...ip }, body: JSON.stringify({ email }) })).json();
    const r = await fetch(B + '/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...ip }, body: JSON.stringify({ email, code: c.dev_code, ...extra }) });
    const set = r.headers.getSetCookie()[0] || '';
    return { set, cookie: set.split(';')[0], status: r.status };
  }
  const me = async (cookie) => (await (await fetch(B + '/api/me', { headers: { Cookie: cookie } })).json()).user;

  await step('Sessions: "Keep me signed in" sets a 30-day HttpOnly SameSite=Lax cookie; unticked sets a browser-session cookie', async () => {
    const a = await login('keep1@example.com');
    assert.equal(a.status, 200);
    assert.match(a.set, /HttpOnly/); assert.match(a.set, /SameSite=Lax/); assert.match(a.set, /Max-Age=2592000/);
    assert.ok(await me(a.cookie), 'remembered session works');
    const b = await login('keep2@example.com', { remember: false });
    assert.match(b.set, /HttpOnly/); assert.doesNotMatch(b.set, /Max-Age/, 'session cookie has no Max-Age');
    assert.ok(await me(b.cookie), 'session-only login works');
  });

  await step('Sessions: ids are stored hashed, logout ends this session only, "sign out of all devices" ends every session', async () => {
    const { get, all } = require('./db');
    const p1 = await login('multi@example.com'), p2 = await login('multi@example.com');
    const raw = p1.cookie.split('=')[1];
    assert.equal(get('SELECT 1 AS x FROM sessions WHERE id = ?', decodeURIComponent(raw)), undefined, 'raw session id is not in the database');
    const uid = (await me(p1.cookie)).id;
    assert.equal(all('SELECT id FROM sessions WHERE user_id = ?', uid).length, 2);
    const cnt = await (await fetch(B + '/api/auth/sessions', { headers: { Cookie: p1.cookie } })).json();
    assert.equal(cnt.count, 2);
    await fetch(B + '/api/auth/logout', { method: 'POST', headers: { Cookie: p1.cookie } });
    assert.equal(await me(p1.cookie), null, 'logged-out session is dead');
    assert.ok(await me(p2.cookie), 'the other device stays signed in');
    const p3 = await login('multi@example.com');
    const out = await (await fetch(B + '/api/auth/logout-all', { method: 'POST', headers: { Cookie: p3.cookie } })).json();
    assert.equal(out.ended, 2);
    assert.equal(await me(p2.cookie), null); assert.equal(await me(p3.cookie), null);
  });

  await step('Sessions: expired sessions are refused; rolling refresh moves the expiry forward', async () => {
    const { run, get } = require('./db');
    const p = await login('roll@example.com');
    const uid = (await me(p.cookie)).id;
    const row = get('SELECT * FROM sessions WHERE user_id = ?', uid);
    run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() + 864e5).toISOString(), row.id);
    const r = await fetch(B + '/api/me', { headers: { Cookie: p.cookie } });
    assert.match(r.headers.getSetCookie().join(';'), /Max-Age=2592000/, 'cookie refreshed');
    assert.ok(get('SELECT expires_at FROM sessions WHERE id = ?', row.id).expires_at > new Date(Date.now() + 29 * 864e5).toISOString());
    run('UPDATE sessions SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), row.id);
    assert.equal(await me(p.cookie), null);
  });

  await step('Admin: keep-signed-in and sign out of all admin sessions', async () => {
    const ip = ipH();
    const adm = async (remember) => {
      const c = await (await fetch(B + '/api/admin/auth/code', { method: 'POST', headers: { 'Content-Type': 'application/json', ...ip }, body: JSON.stringify({ email: 'owner@example.com' }) })).json();
      const r = await fetch(B + '/api/admin/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', ...ip }, body: JSON.stringify({ email: 'owner@example.com', code: c.dev_code, remember }) });
      return r.headers.getSetCookie()[0] || '';
    };
    const s1 = await adm(false), s2 = await adm(true);
    assert.doesNotMatch(s1, /Max-Age/); assert.match(s2, /Max-Age=2592000/);
    const ck1 = s1.split(';')[0], ck2 = s2.split(';')[0];
    const am = async (ck) => (await (await fetch(B + '/api/admin/me', { headers: { Cookie: ck } })).json()).staff;
    assert.ok(await am(ck1));
    const r = await (await fetch(B + '/api/admin/auth/logout-all', { method: 'POST', headers: { Cookie: ck2 } })).json();
    assert.ok(r.ended >= 2);
    assert.equal(await am(ck1), null); assert.equal(await am(ck2), null);
  });

  // Fresh admin session (the step above signed the owner out everywhere).
  const adminLogin = async (jar) => { const ip = ipH(); const c = await call(jar, 'POST', '/api/admin/auth/code', { email: 'owner@example.com' }, ip); return call(jar, 'POST', '/api/admin/auth/verify', { email: 'owner@example.com', code: c.data.dev_code }, ip); };
  await adminLogin('ai');

  await step('Integrations: status board lists AI, payments, email, VooSquare and storage; secrets are never sent back', async () => {
    assert.equal((await call('anon2', 'GET', '/api/admin/integrations')).status, 401);
    const o = (await call('ai', 'GET', '/api/admin/integrations')).data;
    assert.ok(o.providers.length >= 5 && o.payments.length >= 3, 'providers and payment methods listed');
    for (const k of ['email', 'voosquare', 'storage', 'server', 'fields']) assert.ok(o[k], k);
    assert.ok(['connected', 'untested', 'error', 'not_connected'].includes(o.email.status));
    const put = await call('ai', 'PUT', '/api/admin/integrations', { values: { 'email.resend_key': 're_secret_value_123456', 'brand.company': 'Zedapex Limited' } });
    assert.equal(put.status, 200);
    const raw = JSON.stringify((await call('ai', 'GET', '/api/admin/integrations')).data);
    assert.ok(!raw.includes('re_secret_value_123456'), 'the saved key is not in the response');
    assert.ok(raw.includes('re_s••••3456'), 'masked hint shown');
    assert.equal(require('./config').email.resendKey, 're_secret_value_123456', 'config reads the admin value');
    assert.equal(require('./config').brand.company, 'Zedapex Limited');
    const { get } = require('./db');
    assert.ok(!get("SELECT value FROM settings WHERE key = 'integrations'").value.includes('re_secret_value'), 'stored encrypted');
    await call('ai', 'PUT', '/api/admin/integrations', { clear: ['email.resend_key', 'brand.company'] });
    assert.equal(require('./config').email.resendKey, '', 'cleared: falls back to the environment');
    assert.equal((await call('ai', 'PUT', '/api/admin/integrations', { values: { 'site.app_url': 'javascript:alert(1)' } })).status, 400);
  });

  await step('Integrations: tests report clear results (payment method without key, storage, VooSquare key)', async () => {
    const o = (await call('ai', 'GET', '/api/admin/integrations')).data;
    const noKey = o.payments.find((m) => !m.secret_set && m.adapter !== 'test' && m.adapter !== 'custom');
    const t = (await call('ai', 'POST', `/api/admin/payment-methods/${noKey.id}/test`)).data;
    assert.equal(t.ok, false); assert.match(t.note, /secret key/i);
    const stg = (await call('ai', 'POST', '/api/admin/integrations/test/storage')).data;
    assert.equal(stg.ok, true, stg.note);
    const before = require('./config').voosquare.serviceKey;
    const g = (await call('ai', 'POST', '/api/admin/integrations/voosquare/service-key')).data;
    assert.match(g.key, /^vs_/);
    assert.ok(!JSON.stringify(g.overview).includes(g.key), 'key shown once, not in the overview');
    assert.equal((await call('vs2', 'GET', '/api/voosquare/summary?voo_id=x', null, { Authorization: 'Bearer ' + g.key })).status, 200);
    assert.equal((await call('vs2', 'GET', '/api/voosquare/summary?voo_id=x', null, { Authorization: 'Bearer ' + before })).status, 401, 'old key stops working');
    assert.equal((await call('ai', 'POST', '/api/admin/integrations/test/voosquare-inbound')).data.ok, true);
    await call('ai', 'PUT', '/api/admin/integrations', { clear: ['voosquare.service_key'] });
    assert.equal(require('./config').voosquare.serviceKey, before);
    const ov = (await call('ai', 'GET', '/api/admin/integrations')).data;
    assert.equal(ov.storage.status, 'connected');
    assert.equal(ov.payments.find((m) => m.id === noKey.id).last_test.ok, false);
  });

  await step('CSRF: state-changing requests from another site are refused', async () => {
    const p = await login('csrf@example.com');
    const post = (h) => fetch(B + '/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: p.cookie, ...h }, body: JSON.stringify({ body: 'x' }) });
    assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await post({ Referer: 'https://evil.example/page' })).status, 403);
    assert.equal((await post({ Origin: B })).status, 200, 'same-site request works');
  });

  await step('Uploads: only real images are accepted, size is capped', async () => {
    const p = await login('upl@example.com');
    const up = (buf, type) => fetch(B + '/api/upload', { method: 'POST', headers: { 'Content-Type': type, Cookie: p.cookie }, body: buf });
    assert.equal((await up(Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' ')), 'image/png')).status, 400, 'HTML posing as PNG');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
    const ok = await up(png, 'image/png');
    assert.equal(ok.status, 200);
    const url = (await ok.json()).url;
    const served = await fetch(B + url);
    assert.equal(served.headers.get('content-type'), 'image/png'); assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await up(Buffer.alloc(9e6, 1), 'image/png').catch(() => ({ status: 413 }))).status, 413);
    assert.equal((await up(png, 'text/html')).status, 400);
  });

  await step('Support: closed tickets cannot get new customer messages; XSS in tickets is stored as text', async () => {
    const p = await login('closed@example.com');
    const req = (m, u, b) => fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', Cookie: p.cookie }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ status: r.status, data: await r.json() }));
    const t = (await req('POST', '/api/tickets', { subject: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>', category: 'bug' })).data.ticket;
    assert.equal(t.subject, '<img src=x onerror=alert(1)>', 'kept as text (escaped when shown)');
    await req('POST', `/api/tickets/${t.id}/close`);
    assert.equal((await req('POST', `/api/tickets/${t.id}/messages`, { body: 'hello?' })).status, 409);
  });

  await step('Payments: webhooks only pay matching payments (Paystack reference/amount, provider must match)', async () => {
    const { run, get } = require('./db');
    const crypto = require('node:crypto');
    const m = (await call('ai', 'POST', '/api/admin/payment-methods', { adapter: 'paystack', name: 'Paystack check' })).data.method;
    await call('ai', 'PUT', '/api/admin/payment-methods/' + m.id, { secret: 'sk_test_check', config: { currency: 'NGN', usd_rate: 1000 } });
    const u = await login('paycheck@example.com');
    const uid = (await me(u.cookie)).id;
    const pid = Number(run("INSERT INTO payments(user_id, method_id, adapter, kind, topup_id, credits, amount_usd, provider_ref) VALUES(?,?,?,?,?,?,?,?)", uid, m.id, 'paystack', 'topup', 't1', 350, 19, 'va_ref_ok').lastInsertRowid);
    const hook = (body) => { const raw = JSON.stringify(body); return fetch(B + '/api/webhooks/paystack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': crypto.createHmac('sha512', 'sk_test_check').update(raw).digest('hex') }, body: raw }); };
    await hook({ event: 'charge.success', data: { reference: 'attacker_ref', amount: 100, currency: 'NGN', metadata: { payment_id: pid } } });
    assert.equal(get('SELECT status FROM payments WHERE id = ?', pid).status, 'pending', 'foreign transaction with metadata only is ignored');
    await hook({ event: 'charge.success', data: { reference: 'va_ref_ok', amount: 100, currency: 'NGN', metadata: { payment_id: pid } } });
    assert.equal(get('SELECT status FROM payments WHERE id = ?', pid).status, 'pending', 'too small amount is ignored');
    const bad = await fetch(B + '/api/webhooks/paystack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'nope' }, body: '{}' });
    assert.equal(bad.status, 400, 'unsigned webhook refused');
    await hook({ event: 'charge.success', data: { reference: 'va_ref_ok', amount: 1900000, currency: 'NGN', metadata: { payment_id: pid } } });
    assert.equal(get('SELECT status FROM payments WHERE id = ?', pid).status, 'paid');
    const before = get('SELECT topup_credits FROM users WHERE id = ?', uid).topup_credits;
    await hook({ event: 'charge.success', data: { reference: 'va_ref_ok', amount: 1900000, currency: 'NGN', metadata: { payment_id: pid } } });
    assert.equal(get('SELECT topup_credits FROM users WHERE id = ?', uid).topup_credits, before, 'paying twice never doubles credits');
    await call('ai', 'DELETE', '/api/admin/payment-methods/' + m.id);
  });

  await step('Credits: a failed job refunds exactly once, even if failure is reported twice', async () => {
    const { get, all } = require('./db');
    const jobs = require('./jobs');
    const p = await login('refund1@example.com');
    const uid = (await me(p.cookie)).id;
    const r = await fetch(B + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: p.cookie }, body: JSON.stringify({ type: 'hooks', product: 'serum' }) });
    const job = (await r.json()).job;
    const bal0 = get('SELECT trial_credits FROM users WHERE id = ?', uid).trial_credits;
    const row = get('SELECT * FROM jobs WHERE id = ?', job.id);
    jobs.failJob({ ...row, refunded: 0 }, 'test failure');
    jobs.failJob({ ...row, refunded: 0 }, 'test failure again');
    assert.equal(get('SELECT trial_credits FROM users WHERE id = ?', uid).trial_credits, bal0 + job.credits, 'refunded once');
    assert.equal(all("SELECT 1 FROM credit_ledger WHERE user_id = ? AND reason = 'Refund: job failed'", uid).length, 1);
  });

  await step('Staff: a non-owner who manages the team cannot grant permissions they do not have', async () => {
    const role = (await call('ai', 'POST', '/api/admin/roles', { name: 'Team lead check', permissions: ['staff.view', 'staff.manage', 'users.view'] })).data;
    const inv = (await call('ai', 'POST', '/api/admin/staff', { email: 'lead@example.com', role_id: role.id })).data;
    const token = inv.invite_url.split('#invite=')[1];
    await call('lead', 'POST', '/api/admin/invite/' + token, { name: 'Lead' });
    const ip = ipH();
    const c = await call('lead', 'POST', '/api/admin/auth/code', { email: 'lead@example.com' }, ip);
    await call('lead', 'POST', '/api/admin/auth/verify', { email: 'lead@example.com', code: c.data.dev_code }, ip);
    assert.equal((await call('lead', 'POST', '/api/admin/roles', { name: 'Sneaky', permissions: ['providers.manage', 'staff.manage'] })).status, 403);
    assert.equal((await call('lead', 'PUT', '/api/admin/roles/' + role.id, { name: 'Team lead check', permissions: ['staff.view', 'staff.manage', 'users.view', 'payments.manage'] })).status, 403, 'cannot edit own role');
    const roles = (await call('ai', 'GET', '/api/admin/staff')).data.roles;
    const manager = roles.find((x) => x.name === 'Manager');
    assert.equal((await call('lead', 'POST', '/api/admin/staff', { email: 'alt@example.com', role_id: manager.id })).status, 403, 'cannot invite into a stronger role');
    assert.equal((await call('lead', 'POST', '/api/admin/roles', { name: 'Helper', permissions: ['users.view'] })).status, 200, 'can grant what they have');
  });

  await step('Blog: staff-written titles and cover links cannot inject HTML into public pages', async () => {
    const r = await call('ai', 'POST', '/api/admin/posts', { title: 'XSS test "><script>alert(1)</script>', slug: 'xss-check', body_md: 'Hello <script>alert(2)</script> [x](javascript:alert(3))', excerpt: '"><img src=x onerror=alert(4)>', cover_url: 'x" onerror="alert(5)', status: 'published' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const html = (await call('x', 'GET', '/blog/xss-check')).data;
    assert.ok(!/<img src=x onerror/.test(html), 'no raw img tag from the excerpt');
    assert.ok(!html.includes('<script>alert('), 'script tags escaped');
    assert.ok(!html.includes('href="javascript:'), 'javascript: links dropped');
    assert.ok(!html.includes('onerror="alert(5)'), 'cover URL cannot break out of the attribute');
  });

  await step('VooSquare login only returns to a path on this site (no open redirect)', async () => {
    const voo = require('./voo');
    assert.equal(voo.safeReturn('/app#wallet'), '/app#wallet');
    assert.equal(voo.safeReturn('/dashboard'), '/app');
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/app\\..', '/blog', 'javascript:alert(1)']) assert.equal(voo.safeReturn(bad), '/app', bad);
  });
};
