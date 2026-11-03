// Self-check: environments (production / staging / development), staging guards, /healthz, backups and migrations.
// Called from selfcheck.js: stagingChecks({ call, step, wait }). Staging is tested in a separate server process
// started with APP_ENV=staging and NODE_ENV=production (like Railway), on its own throwaway data folder.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
// Run a tiny script in a fresh Node process with the given env and return its JSON output.
function probe(env, code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-env-'));
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, DATA_DIR: dir, APP_SECRET: 'x'.repeat(64) };
  const r = spawnSync(NODE, ['--no-warnings', '-e', code], { cwd: ROOT, env: { ...base, ...env }, encoding: 'utf8', timeout: 30000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error('probe failed: ' + (r.stderr || r.stdout).slice(0, 400));
  return JSON.parse(r.stdout.trim().split('\n').pop());
}


// A separate owner-role staff member for this group (the main owner's session may be signed out by earlier groups,
// and login codes are limited per email).
async function ownerJar(call, jar, email, roleName = 'Owner') {
  const { get, run } = require('./db');
  const owner = get('SELECT id FROM roles WHERE name = ?', roleName);
  if (!get('SELECT 1 FROM staff WHERE email = ?', email)) run("INSERT INTO staff(email, name, role_id, status) VALUES(?, 'QA owner', ?, 'active')", email, owner.id);
  const h = { 'x-forwarded-for': '10.97.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) };
  const c = await call(jar, 'POST', '/api/admin/auth/code', { email }, h);
  const v = await call(jar, 'POST', '/api/admin/auth/verify', { email, code: c.data.dev_code }, h);
  if (v.status !== 200) throw new Error('owner login failed: ' + JSON.stringify(v.data));
}

module.exports = async function stagingChecks({ call, step, wait }) {
  await step('Env: APP_ENV is detected from Railway (production / any other env = staging) and APP_ENV overrides it', async () => {
    const code = "const c=require('./server/config');console.log(JSON.stringify({e:c.appEnv,s:c.isStaging,t:c.testPayments,v:c.version}))";
    assert.deepEqual(probe({ RAILWAY_ENVIRONMENT_NAME: 'production' }, code), { e: 'production', s: false, t: false, v: 'dev' });
    assert.equal(probe({ RAILWAY_ENVIRONMENT_NAME: 'staging' }, code).e, 'staging');
    assert.equal(probe({ RAILWAY_ENVIRONMENT_NAME: 'vooads-pr-12' }, code).e, 'staging', 'PR preview environments are staging');
    assert.equal(probe({ RAILWAY_ENVIRONMENT_NAME: 'production', APP_ENV: 'staging' }, code).e, 'staging');
    assert.deepEqual(probe({}, code), { e: 'development', s: false, t: true, v: 'dev' });
    assert.equal(probe({ NODE_ENV: 'production' }, code).t, false, 'no test payments in production');
    assert.equal(probe({ RAILWAY_ENVIRONMENT_NAME: 'staging' }, code).t, true, 'test payments on staging');
    assert.equal(probe({ RAILWAY_GIT_COMMIT_SHA: 'abc123def' }, code).v, 'abc123def');
  });

  await step('Staging guards: payments need test keys / sandbox addresses; emails reach staff and the allowlist only', async () => {
    const code = `const st=require('./server/staging');const m=(adapter,secret,config={})=>st.paymentProblem({adapter,secret,config});
      console.log(JSON.stringify({
        stripeLive:m('stripe','sk_live_1'),stripeTest:m('stripe','sk_test_1'),rk:m('stripe','rk_test_1'),
        payLive:m('paystack','sk_live_1'),payTest:m('paystack','sk_test_1'),flwLive:m('flutterwave','FLWSECK-1'),flwTest:m('flutterwave','FLWSECK_TEST-1'),
        gvLive:m('gatevoo','k'),gvSbx:m('gatevoo','k',{base_url:'https://sandbox.gatevoo.com'}),gvTrick:m('gatevoo','k',{base_url:'https://api.gatevoo.com/sandbox'}),
        cuLive:m('custom','',{checkout_url:'https://api.paystack.co/x'}),cuTest:m('custom','',{checkout_url:'https://api-test.example.com/x'}),
        manual:m('manual',''),test:m('test',''),np:m('nowpayments','k'),np_api:require('./server/payments/nowpayments').API(),unknown:m('weird','x'),
        owner:st.emailAllowed('owner@x.test'),allow:st.emailAllowed('qa@allowed.test'),dom:st.emailAllowed('anyone@team.test'),
        cust:st.emailAllowed('customer@gmail.com'),sneaky:st.emailAllowed('customer@team.test.evil.com'),empty:st.emailAllowed('')}))`;
    const r = probe({ APP_ENV: 'staging', OWNER_EMAIL: 'owner@x.test', STAGING_EMAIL_ALLOWLIST: 'qa@allowed.test, @team.test' }, code);
    assert.ok(r.stripeLive && r.payLive && r.flwLive && r.gvLive && r.cuLive && r.unknown && r.gvTrick, 'live keys/addresses refused: ' + JSON.stringify(r));
    assert.equal(r.stripeTest, null); assert.equal(r.rk, null); assert.equal(r.payTest, null); assert.equal(r.flwTest, null);
    assert.equal(r.gvSbx, null); assert.equal(r.cuTest, null); assert.equal(r.manual, null); assert.equal(r.test, null); assert.equal(r.np, null);
    assert.equal(r.np_api, 'https://api-sandbox.nowpayments.io');
    assert.ok(r.owner && r.allow && r.dom, 'staff / allowlist get emails');
    assert.ok(!r.cust && !r.sneaky && !r.empty, 'customers do not');
    // Production and development: guards are off.
    const p = probe({ RAILWAY_ENVIRONMENT_NAME: 'production' }, "const st=require('./server/staging');console.log(JSON.stringify({p:st.paymentProblem({adapter:'stripe',secret:'sk_live_1',config:{}}),e:st.emailAllowed('customer@gmail.com'),np:require('./server/payments/nowpayments').API()}))");
    assert.deepEqual(p, { p: null, e: true, np: 'https://api.nowpayments.io' });
  });

  await step('Healthz: checks the database is writable and ffmpeg, returns env + version', async () => {
    const r = await call('h', 'GET', '/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true); assert.equal(r.data.db, 'writable'); assert.equal(r.data.env, 'development');
    assert.equal(typeof r.data.ffmpeg, 'boolean'); assert.ok(r.data.version);
  });

  await step('Backups: owner only (401 logged out, 403 for other staff); create, list, download; no path tricks', async () => {
    await ownerJar(call, 'bo', 'backup-owner@example.com');
    await ownerJar(call, 'bw', 'backup-blog@example.com', 'Blog editor');
    await ownerJar(call, 'bs', 'backup-support@example.com', 'Support');
    assert.equal((await call('anon', 'GET', '/api/admin/backups')).status, 401);
    assert.equal((await call('anon', 'POST', '/api/admin/backups')).status, 401);
    assert.equal((await call('bw', 'GET', '/api/admin/backups')).status, 403, 'blog editor is refused');
    assert.equal((await call('bs', 'POST', '/api/admin/backups')).status, 403, 'support is refused');
    const c = await call('bo', 'POST', '/api/admin/backups');
    assert.equal(c.status, 200, JSON.stringify(c.data)); assert.match(c.data.name, /^vooads-\d{8}-\d{6}(-\d+)?-manual\.db$/);
    const l = await call('bo', 'GET', '/api/admin/backups');
    assert.ok(l.data.backups.some((b) => b.name === c.data.name));
    const d = await call('bo', 'GET', '/api/admin/backups/' + c.data.name);
    assert.equal(d.status, 200);
    assert.ok(String(d.data).startsWith('SQLite format 3'), 'download is a SQLite file');
    assert.equal((await call('bw', 'GET', '/api/admin/backups/' + c.data.name)).status, 403);
    for (const bad of ['..%2Fvooads.db', '%2E%2E%2F%2E%2E%2Fetc%2Fpasswd', 'vooads.db', 'vooads-20260101-000000-x.db.bak']) assert.equal((await call('bo', 'GET', '/api/admin/backups/' + bad)).status, 404, bad);
    const backups = require('./backups');
    for (let i = 0; i < 12; i++) backups.snapshot(require('./db').db, 'prune');
    assert.equal(backups.list().length, backups.KEEP, 'only the newest 10 are kept');
  });

  // ---------- A real staging server (separate process) ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-staging-'));
  const port = 5100 + Math.floor(Math.random() * 700);
  const S = 'http://localhost:' + port;
  let out = '';
  let child = null;
  const start = async () => {
    out = '';
    child = spawn(NODE, ['--no-warnings', 'server/index.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DATA_DIR: dir, PORT: String(port), APP_URL: S, APP_ENV: 'staging', NODE_ENV: 'production', APP_SECRET: 's'.repeat(64), OWNER_EMAIL: 'owner@staging.test', STAGING_EMAIL_ALLOWLIST: 'qa@team.test', RAILWAY_GIT_COMMIT_SHA: 'feedc0de', JOB_TICK_MS: '500', MOCK_RENDER_MS: '300' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(S + '/healthz')).ok) return; } catch {} await wait(250); }
    throw new Error('staging server did not start: ' + out.slice(-800));
  };
  const stop = () => new Promise((r) => { if (!child || child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 4000); });
  const jar = {};
  const sc = async (who, method, url, body, headers = {}) => {
    const r = await fetch(S + url, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}), 'x-forwarded-for': '10.55.0.' + (who.length + 1), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie?.() || [];
    if (set.length) jar[who] = [jar[who], ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
    const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
  const codeFor = async (email) => {
    for (let i = 0; i < 20; i++) {
      const re = new RegExp('To: ' + email.replace(/[.@+]/g, '\\$&') + '\\n(?:From: [^\\n]*\\n)?Subject: [^\\n]*?(\\d{6})', 'g');
      const all = [...out.matchAll(re)];
      if (all.length) return all[all.length - 1][1];
      await wait(150);
    }
    throw new Error('no login code in the staging log for ' + email);
  };
  try {
    await step('Staging server: boots, /healthz says staging + git version, sample data is seeded once', async () => {
      await start();
      const h = await sc('x', 'GET', '/healthz');
      assert.equal(h.status, 200); assert.equal(h.data.env, 'staging'); assert.equal(h.data.version, 'feedc0de');
      assert.match(h.headers.get('x-robots-tag') || '', /noindex/);
      assert.match(out, /\[staging\] empty database: added 3 sample customers/);
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(path.join(dir, 'vooads.db'), { readOnly: true });
      assert.equal(d.prepare('SELECT COUNT(*) AS c FROM users').get().c, 3);
      assert.ok(d.prepare('SELECT COUNT(*) AS c FROM jobs').get().c >= 3);
      assert.ok(d.prepare('SELECT COUNT(*) AS c FROM tickets').get().c >= 1);
      d.close();
    });

    await step('Staging server: studio and admin show the "Staging — test data" banner; robots.txt blocks everything', async () => {
      for (const u of ['/app', '/admin']) { const r = await sc('x', 'GET', u); assert.equal(r.status, 200); assert.match(String(r.data), /Staging — test data/, u); assert.equal(r.headers.get('cache-control'), 'no-store'); }
      assert.match(String((await sc('x', 'GET', '/robots.txt')).data), /Disallow: \/\n/);
    });

    await step('Staging server: customer emails are blocked and logged; staff/allowlist emails go out', async () => {
      const c = await sc('cust', 'POST', '/api/auth/code', { email: 'pro.buyer@staging.test' });
      assert.equal(c.status, 200); assert.equal(c.data.dev_code, undefined, 'no on-screen codes (NODE_ENV=production)');
      await wait(200);
      assert.match(out, /\[email:staging-blocked\] To: pro\.buyer@staging\.test/);
      await sc('qa', 'POST', '/api/auth/code', { email: 'qa@team.test' });
      await sc('own', 'POST', '/api/admin/auth/code', { email: 'owner@staging.test' });
      await wait(200);
      assert.doesNotMatch(out, /staging-blocked\] To: qa@team\.test/); assert.doesNotMatch(out, /staging-blocked\] To: owner@staging\.test/);
      assert.match(out, /\[email:log\] To: owner@staging\.test/);
    });

    await step('Staging server: checkout offers the test method, hides a live Stripe key, refuses it, and test-pays', async () => {
      const code = await codeFor('pro.buyer@staging.test');
      const v = await sc('cust', 'POST', '/api/auth/verify', { email: 'pro.buyer@staging.test', code });
      assert.equal(v.status, 200, JSON.stringify(v.data));
      // Owner adds a live Stripe key and switches it on.
      const oc = await codeFor('owner@staging.test');
      assert.equal((await sc('own', 'POST', '/api/admin/auth/verify', { email: 'owner@staging.test', code: oc })).status, 200);
      const methods = (await sc('own', 'GET', '/api/admin/payment-methods')).data.methods;
      const stripe = methods.find((m) => m.adapter === 'stripe');
      assert.equal((await sc('own', 'PUT', '/api/admin/payment-methods/' + stripe.id, { enabled: true, secret: 'sk_live_51abc', countries: ['*'] })).status, 200);
      const cfg = (await sc('cust', 'GET', '/api/billing')).data;
      const list = cfg.methods || cfg;
      assert.ok(Array.isArray(list), JSON.stringify(cfg).slice(0, 200));
      assert.ok(list.some((m) => m.id === 0), 'test method offered on staging');
      assert.ok(!list.some((m) => m.id === stripe.id), 'live Stripe hidden on staging');
      const bad = await sc('cust', 'POST', '/api/billing/checkout', { kind: 'topup', topup_id: (await sc('cust', 'GET', '/api/public/config')).data.topups[0].id, method_id: stripe.id });
      assert.equal(bad.status, 400);
      const integ = (await sc('own', 'GET', '/api/admin/integrations')).data;
      assert.equal(integ.server.env, 'staging');
      assert.match(integ.payments.find((m) => m.id === stripe.id).staging_problem || '', /test keys/);
      const ok = await sc('cust', 'POST', '/api/billing/checkout', { kind: 'topup', topup_id: (await sc('cust', 'GET', '/api/public/config')).data.topups[0].id, method_id: 0 });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      const before = (await sc('cust', 'GET', '/api/me')).data.user.balance.total;
      assert.equal((await sc('cust', 'GET', '/api/pay/test/' + ok.data.payment_id)).status, 302);
      assert.ok((await sc('cust', 'GET', '/api/me')).data.user.balance.total > before, 'test payment adds credits on staging');
    });

    await step('Migrations: a restart re-runs every migration safely (idempotent), backs up first, and keeps the data', async () => {
      await stop();
      const { DatabaseSync } = require('node:sqlite');
      const schema = () => { const d = new DatabaseSync(path.join(dir, 'vooads.db'), { readOnly: true }); const s = d.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all().map((r) => `${r.type}:${r.name}:${r.sql}`).join('\n'); const u = d.prepare('SELECT COUNT(*) AS c FROM users').get().c; d.close(); return { s, u }; };
      const a = schema();
      await start();
      assert.match(out, /\[backup\] saved vooads-\d{8}-\d{6}(-\d+)?-boot\.db before migrations/);
      assert.doesNotMatch(out, /\[staging\] empty database/, 'sample data is not added twice');
      const files = fs.readdirSync(path.join(dir, 'backups'));
      assert.ok(files.some((f) => /-boot\.db$/.test(f)));
      const bk = new (require('node:sqlite').DatabaseSync)(path.join(dir, 'backups', files.find((f) => /-boot\.db$/.test(f))), { readOnly: true });
      assert.equal(bk.prepare('SELECT COUNT(*) AS c FROM users').get().c, a.u, 'the boot backup holds the data');
      bk.close();
      await stop();
      const b = schema();
      assert.equal(b.s, a.s, 'schema unchanged by a second boot'); assert.equal(b.u, a.u);
      await start();
      assert.equal((await sc('x', 'GET', '/healthz')).status, 200);
    });
  } finally {
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
