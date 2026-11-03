// Regression checks for bugs found in the 4 Oct 2026 QA pass. Called from selfcheck.js: qaChecks({ call, step }).
const assert = require('node:assert');


// A separate owner-role staff member for this group (the main owner's session may be signed out by earlier groups,
// and login codes are limited per email).
async function ownerJar(call, jar, email) {
  const { get, run } = require('./db');
  const owner = get("SELECT id FROM roles WHERE name = 'Owner'");
  if (!get('SELECT 1 FROM staff WHERE email = ?', email)) run("INSERT INTO staff(email, name, role_id, status) VALUES(?, 'QA owner', ?, 'active')", email, owner.id);
  const h = { 'x-forwarded-for': '10.97.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) };
  const c = await call(jar, 'POST', '/api/admin/auth/code', { email }, h);
  const v = await call(jar, 'POST', '/api/admin/auth/verify', { email, code: c.data.dev_code }, h);
  if (v.status !== 200) throw new Error('owner login failed: ' + JSON.stringify(v.data));
}

module.exports = async function qaChecks({ call, step }) {
  await ownerJar(call, 'qo', 'qa-owner@example.com');
  const ip = { 'x-forwarded-for': '10.98.0.' + Math.floor(Math.random() * 200) };
  const c = await call('qx', 'POST', '/api/auth/code', { email: 'qa-regress@example.com' }, ip);
  await call('qx', 'POST', '/api/auth/verify', { email: 'qa-regress@example.com', code: c.data.dev_code, country: 'NG' }, ip);

  await step('QA: a payment provider that is down gives a clean 502 (no raw error, no 500) and the payment is marked failed', async () => {
    const m = (await call('qo', 'POST', '/api/admin/payment-methods', { adapter: 'custom', name: 'Down provider' })).data.method;
    await call('qo', 'PUT', '/api/admin/payment-methods/' + m.id, { enabled: true, countries: ['*'], secret: 'k', config: { checkout_url: 'http://127.0.0.1:9/never', response_url_path: 'data.link' } });
    try {
      const r = await call('qx', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: m.id });
      assert.equal(r.status, 502, JSON.stringify(r.data));
      assert.match(r.data.error, /Down provider is not available right now/);
      assert.doesNotMatch(r.data.error, /fetch failed|ECONNREFUSED|JSON/);
      const p = (await call('qx', 'GET', '/api/billing')).data.payments[0];
      assert.equal(p.status, 'failed');
    } finally {
      await call('qo', 'PUT', '/api/admin/payment-methods/' + m.id, { enabled: false });
    }
  });

  await step('QA: a too-big request gets a 413 answer (not a dropped connection), also when Content-Length says so up front', async () => {
    const r = await call('qx', 'POST', '/api/jobs', Buffer.from('{"type":"hooks","product":"' + 'x'.repeat(2.2e6) + '"}'), { 'Content-Type': 'application/json' });
    assert.equal(r.status, 413); assert.match(r.data.error, /too big/);
    const big = Buffer.alloc(9e6); Buffer.from('89504e470d0a1a0a', 'hex').copy(big);
    const r2 = await call('qx', 'POST', '/api/upload', big, { 'Content-Type': 'image/png' });
    assert.equal(r2.status, 413);
  });

  // 3 Nov 2026 launch QA: broken .png photo links, pulsing "live" dots, unreadable dark-studio tiles and checkout.
  await step('QA: studio/admin photo links point at real files; no pulsing live dots; dark studio locked tiles and checkout pill are readable', async () => {
    const fs = require('node:fs'), path = require('node:path');
    const pub = path.join(__dirname, '..', 'public');
    const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
    for (const f of ['assets/js/trainer.js', 'assets/js/admin-business.js', 'assets/js/voo-ui.js', 'assets/css/trainer.css']) {
      for (const m of read(f).matchAll(/\/samples\/([a-z0-9-]+\.(?:png|webp|jpe?g))/g)) assert.ok(fs.existsSync(path.join(pub, 'samples', m[1])), f + ' points at a missing file: ' + m[1]);
    }
    const admin = read('admin.html');
    assert.doesNotMatch(admin, /\.live-dot\{[^}]*animation/, 'admin header dot must not pulse');
    assert.doesNotMatch(admin, /\.dot\.live\{[^}]*animation/, 'admin live dot must not pulse');
    assert.doesNotMatch(read('assets/css/admin-mail.css'), /\.ml-banner\.live \.dot\{[^}]*animation/, 'mail live dot must not pulse');
    assert.doesNotMatch(read('assets/js/admin-business.js'), /\.tstat\.live::before\{animation:ping/, 'AI tool live dot must not pulse');
    const v3 = read('assets/css/studio-v3.css');
    assert.match(v3, /\.ty\.vt\.lk\{background:var\(--card\)\}/, 'locked video tiles are dark (title readable)');
    assert.match(v3, /\.co-plan\{background:var\(--soft2\)!important/, 'checkout plan pill readable on dark');
    assert.match(read('assets/js/studio-app.js'), /TN\.payMark\(kind\) : I\('wallet', 18\)/, 'card method shows an icon');
  });
};
