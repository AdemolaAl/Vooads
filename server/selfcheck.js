// Self-check: boots the app on a temporary database and runs every main flow end to end.
// Run: npm run check   (takes about 30 seconds, uses the demo AI provider, sends no real emails or payments)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-check-'));
process.env.DATA_DIR = tmp;
process.env.PORT = String(4100 + Math.floor(Math.random() * 800));
process.env.APP_URL = 'http://localhost:' + process.env.PORT;
process.env.OWNER_EMAIL = 'owner@example.com';
process.env.NODE_ENV = 'development';
delete process.env.RESEND_API_KEY;
process.env.MOCK_RENDER_MS = process.env.MOCK_RENDER_MS || '1200'; // faster demo renders
process.env.JOB_TICK_MS = process.env.JOB_TICK_MS || '800';
process.env.VOO_SERVICE_KEY = 'vs_check_service_key';
process.env.VOO_WEBHOOK_SECRET = 'vs_check_webhook_secret';
delete process.env.VOO_SUPPORT_EVENTS_URL;
const log = console.log;
console.log = () => {}; // keep the output readable
const server = require('./index');
const B = process.env.APP_URL;

const jars = {};
async function call(jar, method, url, body, headers = {}) {
  const r = await fetch(B + url, {
    method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jars[jar] ? { Cookie: jars[jar] } : {}), ...headers },
    body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined, // a Buffer is sent raw (uploads)
  });
  const set = r.headers.getSetCookie?.() || [];
  if (set.length) jars[jar] = [jars[jar], ...set.map((c) => c.split(';')[0])].filter(Boolean).join('; ');
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data, location: r.headers.get('location') };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function step(name, fn) {
  try { await fn(); passed++; log('  ✓', name); } catch (e) { log('  ✗', name, '\n    ', e.message); process.exitCode = 1; }
}
async function waitJob(jar, id, secs = 25) {
  for (let i = 0; i < secs * 2; i++) {
    const r = await call(jar, 'GET', '/api/jobs/' + id);
    if (['done', 'failed'].includes(r.data.job.status)) return r.data.job;
    await wait(500);
  }
  throw new Error('job ' + id + ' did not finish');
}

(async () => {
  await wait(800);
  log('\nVooads self-check\n');
  await step('Public config and pricing load', async () => {
    const r = await call('u', 'GET', '/api/public/config');
    assert.equal(r.status, 200); assert.ok(r.data.plans.length >= 3);
  });
  await step('Pages render (home, blog, post, legal, sitemap)', async () => {
    for (const u of ['/', '/blog', '/legal/terms', '/legal/privacy', '/sitemap.xml', '/robots.txt']) assert.equal((await call('x', 'GET', u)).status, 200, u);
    const blog = await call('x', 'GET', '/blog');
    const slug = String(blog.data).match(/href="\/blog\/([^"]+)"/)[1];
    assert.equal((await call('x', 'GET', '/blog/' + slug)).status, 200);
  });
  await step('Free Ban Shield flags risky copy', async () => {
    const r = await call('x', 'POST', '/api/public/shield', { text: 'Guaranteed profit! Risk-free. Are you broke?', niche: 'finance' });
    assert.ok(r.data.score < 50 && r.data.flags.length >= 3);
  });
  await step('Customer signs up with an email code and gets trial credits', async () => {
    const c = await call('u', 'POST', '/api/auth/code', { email: 'buyer@example.com' });
    const v = await call('u', 'POST', '/api/auth/verify', { email: 'buyer@example.com', code: c.data.dev_code, name: 'Ada', country: 'GB' });
    assert.equal(v.status, 200); assert.ok(v.data.new); assert.ok(v.data.user.balance.trial > 0);
  });
  await step('Wrong code is rejected', async () => {
    await call('z', 'POST', '/api/auth/code', { email: 'x@example.com' });
    const v = await call('z', 'POST', '/api/auth/verify', { email: 'x@example.com', code: '000000' });
    assert.equal(v.status, 400);
  });
  await step('Hooks job runs on trial credits (demo provider)', async () => {
    const r = await call('u', 'POST', '/api/jobs', { type: 'hooks', product: 'vitamin C serum', language: 'es' });
    const j = await waitJob('u', r.data.job.id);
    assert.equal(j.status, 'done'); assert.equal(j.output.hooks.length, 20);
  });
  await step('Video is locked on the free trial', async () => {
    const r = await call('u', 'POST', '/api/jobs', { type: 'ugc', product: 'serum', script: 'hello' });
    assert.equal(r.status, 402);
  });
  await step('Checkout (test payment) activates the Pro plan', async () => {
    const r = await call('u', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'pro', period: 'month', method_id: 0 });
    assert.ok(r.data.url);
    const go = await call('u', 'GET', new URL(r.data.url).pathname);
    assert.equal(go.status, 302);
    const me = await call('u', 'GET', '/api/me');
    assert.equal(me.data.user.plan.id, 'pro'); assert.ok(me.data.user.balance.plan >= 3500);
  });
  await step('Paying twice for the same checkout does not double the credits', async () => {
    const before = (await call('u', 'GET', '/api/me')).data.user.balance.total;
    await call('u', 'GET', '/api/pay/test/1');
    assert.equal((await call('u', 'GET', '/api/me')).data.user.balance.total, before);
  });
  await step('UGC video with the AI script writer completes', async () => {
    const r = await call('u', 'POST', '/api/jobs', { type: 'ugc', product: 'vitamin C serum', write_script: true, duration: 15, language: 'en', presenter: 'p1' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const j = await waitJob('u', r.data.job.id, 40);
    assert.equal(j.status, 'done', j.error); assert.ok(j.output.url && j.output.captions_url);
  });
  await step('Image set (3 sizes) and short video complete', async () => {
    const a = await call('u', 'POST', '/api/jobs', { type: 'image', product: 'white sneakers' });
    const b = await call('u', 'POST', '/api/jobs', { type: 'video', product: 'white sneakers', style: 'unboxing', duration: 5 });
    const ja = await waitJob('u', a.data.job.id, 40); const jb = await waitJob('u', b.data.job.id, 40);
    assert.equal(ja.output.images.length, 3); assert.ok(jb.output.url);
  });
  await step('Credits are charged correctly (UGC 15s + script)', async () => {
    const p = (await call('u', 'GET', '/api/public/config')).data.costs;
    const q = await call('u', 'POST', '/api/quote', { type: 'ugc', input: { duration: 15, write_script: true } });
    assert.equal(q.data.credits, Math.ceil(p.ugc_video_per_second * 15) + p.script);
  });
  await step('Owner logs in to the admin', async () => {
    const c = await call('a', 'POST', '/api/admin/auth/code', { email: 'owner@example.com' });
    const v = await call('a', 'POST', '/api/admin/auth/verify', { email: 'owner@example.com', code: c.data.dev_code });
    assert.equal(v.status, 200);
    const o = await call('a', 'GET', '/api/admin/overview');
    assert.equal(o.status, 200); assert.ok(o.data.users >= 1);
  });
  let blogInvite;
  await step('Owner invites a blog-only editor', async () => {
    const roles = (await call('a', 'GET', '/api/admin/staff')).data.roles;
    const blogRole = roles.find((r) => r.name === 'Blog editor');
    const r = await call('a', 'POST', '/api/admin/staff', { email: 'writer@example.com', role_id: blogRole.id, name: 'Writer' });
    assert.ok(r.data.invite_url); blogInvite = r.data.invite_url.split('invite=')[1];
  });
  await step('Blog editor can write posts but cannot see customers or pricing', async () => {
    await call('w', 'POST', '/api/admin/invite/' + blogInvite, { name: 'Writer' });
    const c = await call('w', 'POST', '/api/admin/auth/code', { email: 'writer@example.com' });
    await call('w', 'POST', '/api/admin/auth/verify', { email: 'writer@example.com', code: c.data.dev_code });
    assert.equal((await call('w', 'GET', '/api/admin/users')).status, 403);
    assert.equal((await call('w', 'GET', '/api/admin/pricing')).status, 403);
    const p = await call('w', 'POST', '/api/admin/posts', { title: 'Test post', body_md: '## Hello\nWorld', status: 'published' });
    assert.equal(p.status, 200);
    assert.equal((await call('x', 'GET', '/blog/' + p.data.post.slug)).status, 200);
  });
  await step('Support role cannot give more credits than its limit', async () => {
    const roles = (await call('a', 'GET', '/api/admin/staff')).data.roles;
    const sup = roles.find((r) => r.name === 'Support');
    const inv = await call('a', 'POST', '/api/admin/staff', { email: 'help@example.com', role_id: sup.id });
    await call('s', 'POST', '/api/admin/invite/' + inv.data.invite_url.split('invite=')[1], { name: 'Help' });
    const c = await call('s', 'POST', '/api/admin/auth/code', { email: 'help@example.com' });
    await call('s', 'POST', '/api/admin/auth/verify', { email: 'help@example.com', code: c.data.dev_code });
    assert.equal((await call('s', 'POST', '/api/admin/users/1/credits', { amount: 5000, reason: 'test' })).status, 403);
    assert.equal((await call('s', 'POST', '/api/admin/users/1/credits', { amount: 50, reason: 'Failed render refund' })).status, 200);
    assert.equal((await call('s', 'GET', '/api/admin/providers')).status, 403);
  });
  await step('Support chat: customer writes, staff replies', async () => {
    await call('u', 'POST', '/api/support', { body: 'How do I change my presenter voice?' });
    assert.equal((await call('s', 'POST', '/api/admin/support/1', { body: 'Go to Settings → Voices.' })).status, 200);
    const m = await call('u', 'GET', '/api/support');
    assert.equal(m.data.messages.length, 2);
  });
  await step('Admin can switch the default AI provider', async () => {
    const list = (await call('a', 'GET', '/api/admin/providers')).data.providers;
    const backup = list.find((p) => p.kind === 'video' && !p.is_default);
    await call('a', 'PUT', '/api/admin/providers/' + backup.id, { is_default: true });
    const after = (await call('a', 'GET', '/api/admin/providers')).data.providers.find((p) => p.id === backup.id);
    assert.ok(after.is_default);
  });
  await step('Admin can update AI provider config', async () => {
    const added = await call('a', 'POST', '/api/admin/providers', {
      name: 'Config update check', kind: 'text', adapter: 'http',
      config: { url: 'https://old.example.test' }, enabled: false,
    });
    const id = added.data.provider.id;
    const saved = await call('a', 'PUT', '/api/admin/providers/' + id, {
      config: { url: 'https://new.example.test' },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.provider.config.url, 'https://new.example.test');
    await call('a', 'DELETE', '/api/admin/providers/' + id);
  });
  await step('Bad pricing is refused', async () => {
    const r = await call('a', 'PUT', '/api/admin/pricing', { pricing: { plans: [], topups: [], costs: {} } });
    assert.equal(r.status, 400);
  });
  await step('Fake payment webhooks are rejected', async () => {
    await call('a', 'PUT', '/api/admin/payment-methods/2', { enabled: true, secret: 'sk_test_x' });
    const r = await call('x', 'POST', '/api/webhooks/paystack', { event: 'charge.success', data: { metadata: { payment_id: 1 } } }, { 'x-paystack-signature': 'nope' });
    assert.equal(r.status, 400);
  });
  await step('Banning a customer removes credits and logs them out', async () => {
    const r = await call('a', 'POST', '/api/admin/users/1/status', { status: 'banned', reason: 'Scam ads' });
    assert.equal(r.status, 200);
    const me = await call('u', 'GET', '/api/me');
    assert.equal(me.data.user, null);
    const u = (await call('a', 'GET', '/api/admin/users/1')).data.user;
    assert.equal(u.balance.total, 0);
  });
  await step('Every staff action is in the audit log', async () => {
    const r = await call('a', 'GET', '/api/admin/audit');
    assert.ok(r.data.log.length >= 5);
  });
  await step('Email templates render', async () => {
    const t = (await call('a', 'GET', '/api/admin/emails')).data.templates;
    assert.ok(t.length >= 15);
    for (const x of t) assert.equal((await call('a', 'GET', `/api/admin/emails/${x.id}/preview`)).status, 200, x.id);
  });

  // CHECK_ONLY=videotools,mail runs only those groups (after the core checks above).
  const only = (process.env.CHECK_ONLY || '').split(',').filter(Boolean);
  for (const g of ['support', 'studio', 'levels', 'security', 'business', 'voo', 'bachs', 'bachsubs', 'bachscap', 'showcase', 'phase2', 'mail', 'emails', 'videotools', 'staging', 'qa']) {
    if (!only.length || only.includes(g)) await require('./selfcheck-' + g)({ call, step, wait });
  }

  await step('QA: test-payment link only pays the owner\'s own test payment; counts are whole numbers', async () => {
    const ip = { 'x-forwarded-for': '10.99.0.' + Math.floor(Math.random() * 200) };
    const login = async (jar, email) => { const c = await call(jar, 'POST', '/api/auth/code', { email }, ip); return call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code }, ip); };
    await login('qa1', 'qa1@example.com'); await login('qa2', 'qa2@example.com');
    const co = await call('qa1', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'pro', period: 'month', method_id: 0 });
    assert.equal(co.status, 200);
    assert.notEqual((await call('anon', 'GET', '/api/pay/test/' + co.data.payment_id)).status, 302, 'anonymous request must not mark a payment paid');
    assert.notEqual((await call('qa2', 'GET', '/api/pay/test/' + co.data.payment_id)).status, 302, 'another customer must not mark it paid');
    assert.equal((await call('qa1', 'GET', '/api/me')).data.user.plan, null);
    assert.equal((await call('qa1', 'GET', '/api/pay/test/' + co.data.payment_id)).status, 302);
    assert.equal((await call('qa1', 'GET', '/api/me')).data.user.plan.id, 'pro');
    const q = async (input) => (await call('qa1', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'hook_remix', ...input } })).data.credits;
    assert.equal(await q({ count: 2.5 }), await q({ count: 2 }), 'fractional hook count is rounded down');
    const img = (await call('qa1', 'POST', '/api/quote', { type: 'image', input: { count: 1.5 } })).data.credits;
    assert.equal(img, (await call('qa1', 'POST', '/api/quote', { type: 'image', input: { count: 1 } })).data.credits);
    const job = (await call('qa1', 'POST', '/api/jobs', { type: 'video_type', video_type: 'hook_remix', product: 'Serum', hooks: ['One', 'Two'], count: 5 })).data.job;
    assert.equal(job.input.count, 2, 'own hooks: charged per hook given');
  });

  log(`\n${passed} checks passed${process.exitCode ? ', some FAILED (see above)' : ''}.\n`);
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})();
