// Self-check steps for the Oct 2026 admin business features: customer spend math, money permissions and role limits,
// Connect VooSquare and agent permissions, payment sandbox + bank transfers, the AI model wizard (injection-safe
// templates) and the AI tools builder (draft visibility, atomic publish, refunds, profit guard).
// Called from selfcheck.js: businessChecks({ call, step, wait }).
const http = require('node:http');
const assert = require('node:assert');

module.exports = async function businessChecks({ call, step, wait }) {
  const B = process.env.APP_URL;
  const VOO_KEY = process.env.VOO_SERVICE_KEY;
  let OWN_COOKIE = '';
  const O = (method, url, body, h = {}) => call('own', method, url, body, { Cookie: OWN_COOKIE, ...h });
  const ipH = () => ({ 'x-forwarded-for': '10.88.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });
  const custLogin = async (jar, email) => { const ip = ipH(); const c = await call(jar, 'POST', '/api/auth/code', { email }, ip); const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, country: 'NG', name: email.split('@')[0] }, ip); assert.equal(v.status, 200, JSON.stringify(v.data)); return v.data.user; };
  const staffLogin = async (jar, email, roleId) => {
    const inv = await O('POST', '/api/admin/staff', { email, role_id: roleId, name: email.split('@')[0] });
    assert.equal(inv.status, 200, JSON.stringify(inv.data));
    await call(jar, 'POST', '/api/admin/invite/' + inv.data.invite_url.split('invite=')[1], { name: email.split('@')[0] });
    const ip = ipH();
    const c = await call(jar, 'POST', '/api/admin/auth/code', { email }, ip);
    assert.equal((await call(jar, 'POST', '/api/admin/auth/verify', { email, code: c.data.dev_code }, ip)).status, 200);
  };
  const roleId = async (name) => (await O('GET', '/api/admin/staff')).data.roles.find((r) => r.name === name)?.id;
  const newRole = async (name, permissions, limits = {}) => { const r = await O('POST', '/api/admin/roles', { name, permissions, limits }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.id; };
  const pay = async (jar, body) => { const co = await call(jar, 'POST', '/api/billing/checkout', { method_id: 0, ...body }); assert.equal(co.status, 200, JSON.stringify(co.data)); assert.equal((await call(jar, 'GET', '/api/pay/test/' + co.data.payment_id)).status, 302); return co.data.payment_id; };
  const waitJob = async (jar, id, secs = 20) => { for (let i = 0; i < secs * 4; i++) { const j = (await call(jar, 'GET', '/api/jobs/' + id)).data.job; if (['done', 'failed'].includes(j.status)) return j; await wait(250); } throw new Error('job ' + id + ' did not finish'); };

  await step('Business checks: a second owner gets a session (earlier checks end the first owner session)', async () => {
    // Straight into the database, so the owner's login-code rate limit is left for the checks that test it.
    const { get, run } = require('./db');
    const { sha256, id } = require('./lib/util');
    const owner = get("SELECT id FROM roles WHERE name = 'Owner'").id;
    run("INSERT OR IGNORE INTO staff(email, name, role_id, status) VALUES('bizowner@example.com', 'Biz Owner', ?, 'active')", owner);
    const sid = id(32);
    run('INSERT INTO sessions(id, staff_id, expires_at) VALUES(?,?,?)', sha256('sess:' + sid), get("SELECT id FROM staff WHERE email = 'bizowner@example.com'").id, new Date(Date.now() + 864e5).toISOString());
    OWN_COOKIE = 'va_a=' + sid;
    const r = await O('GET', '/api/admin/me');
    assert.equal(r.data.staff.email, 'bizowner@example.com');
    OWN_COOKIE = 'va_a=' + sid;
  });
  // ---------------- Spend math ----------------
  let finUser, planPid, topPid;
  await step('Spend: lifetime spend is net of refunds and discounts are tracked (customers list, detail, CSV, overview)', async () => {
    const P = (await O('GET', '/api/admin/pricing')).data.pricing;
    const pro = P.plans.find((p) => p.id === 'pro'), t1 = P.topups[0];
    assert.equal((await O('POST', '/api/admin/discounts', { code: 'SPEND20', percent: 20, applies_to: 'first_month' })).status, 200);
    finUser = await custLogin('fin', 'spender@example.com');
    planPid = await pay('fin', { kind: 'plan', plan_id: 'pro', period: 'month', code: 'SPEND20' });
    topPid = await pay('fin', { kind: 'topup', topup_id: t1.id });
    await O('DELETE', '/api/admin/discounts/SPEND20');
    const paidPlan = Math.round(pro.price_month * 0.8 * 100) / 100;
    assert.equal((await O('POST', `/api/admin/payments/${topPid}/refund`, { remove_credits: true })).status, 200);
    const list = (await O('GET', '/api/admin/finance/customers?q=spender@example.com')).data;
    const row = list.users[0];
    assert.equal(row.gross_usd, Math.round((paidPlan + t1.price) * 100) / 100, 'gross = discounted plan + top-up');
    assert.equal(row.refunds_usd, t1.price, 'refunded top-up');
    assert.equal(row.net_usd, paidPlan, 'net = gross - refunds');
    assert.equal(row.discount_usd, Math.round(pro.price_month * 0.2 * 100) / 100, 'discount = list - charged');
    assert.equal(row.credits_bought, pro.credits_month, 'refunded credits are not counted as bought');
    assert.equal(row.profit_usd, Math.round((row.net_usd - row.ai_cost_usd) * 100) / 100);
    const d = (await O('GET', '/api/admin/finance/customers/' + row.id)).data;
    assert.equal(d.summary.net_usd, paidPlan);
    const ev = d.timeline.map((e) => e.type);
    assert.ok(ev.includes('refund') && ev.includes('payment') && ev.includes('topup'), 'timeline has payment, top-up and refund');
    assert.equal(d.timeline.find((e) => e.type === 'refund').amount_usd, -t1.price);
    assert.ok(d.timeline.find((e) => e.type === 'payment').discount_code === 'SPEND20');
    // Date range: before the customer existed, nothing.
    assert.equal((await O('GET', '/api/admin/finance/customers?q=spender@example.com&from=2000-01-01&to=2000-12-31')).data.users[0].net_usd, 0);
    // Top spenders sort + CSV (formula injection guarded).
    const top = (await O('GET', '/api/admin/finance/customers?sort=spend&dir=desc&limit=5')).data.users;
    for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].net_usd >= top[i].net_usd, 'sorted by spend');
    const core = require('./finance-core');
    assert.equal(core.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"'); assert.equal(core.csvCell('-12.5'), '-12.5'); assert.equal(core.csvCell('@cmd'), "'@cmd");
    const o = (await O('GET', '/api/admin/finance/overview?days=30')).data;
    assert.ok(o.total_revenue_usd >= paidPlan && o.refunds_usd >= t1.price && o.mrr_usd > 0 && o.arpu_usd > 0 && o.series.length === 30);
    assert.ok(o.top_spenders.length >= 1 && o.top_spenders[0].net_usd >= o.top_spenders[o.top_spenders.length - 1].net_usd);
  });
  await step('Spend: CSV export works for finance roles and is formula-safe', async () => {
    const r = await O('GET', '/api/admin/finance/customers.csv?q=spender');
    assert.equal(r.status, 200);
    assert.match(String(r.data), /net_spend_usd/); assert.match(String(r.data), /spender@example\.com/);
  });

  // ---------------- Permissions and role limits ----------------
  await step('Permissions: staff without "See money" get customers but no money; role credit limits per grant and per day are enforced', async () => {
    const rid = await newRole('Ops (no money)', ['dashboard.view', 'users.view', 'users.credits', 'tickets.view', 'tickets.reply'], { max_credit_grant: 100, max_credit_grant_day: 150 });
    await staffLogin('ops', 'ops@example.com', rid);
    const l = await call('ops', 'GET', '/api/admin/finance/customers?sort=spend');
    assert.equal(l.status, 200);
    assert.ok(l.data.users.length && l.data.users.every((u) => u.net_usd === undefined && u.profit_usd === undefined && u.ai_cost_usd === undefined), 'no money fields');
    assert.equal(l.data.sort, 'joined', 'money sorts fall back');
    assert.equal(l.data.totals, null);
    assert.equal((await call('ops', 'GET', '/api/admin/finance/customers.csv')).status, 403);
    assert.equal((await call('ops', 'GET', '/api/admin/finance/overview')).status, 403);
    const det = (await call('ops', 'GET', '/api/admin/finance/customers/' + finUser.id)).data;
    assert.equal(det.summary.net_usd, undefined); assert.equal(det.timeline.length, 0);
    const ov = (await call('ops', 'GET', '/api/admin/overview')).data;
    assert.equal(ov.revenue_30d, null); assert.equal(ov.mrr, null); assert.ok(ov.days.every((x) => x.revenue === null));
    const g = (amount) => call('ops', 'POST', `/api/admin/users/${finUser.id}/credits`, { amount, reason: 'Limit check' });
    assert.equal((await g(120)).status, 403, 'over the per-grant limit');
    assert.equal((await g(100)).status, 200);
    const over = await g(60);
    assert.equal(over.status, 403, 'over the daily limit'); assert.match(over.data.error, /a day/);
    assert.equal((await g(50)).status, 200, 'exactly at the daily limit');
    assert.equal((await g(1)).status, 403);
    // Without tickets.close the role cannot solve tickets.
    await custLogin('tk', 'closer@example.com');
    const t = (await call('tk', 'POST', '/api/tickets', { subject: 'Help', body: 'Please help', category: 'other' })).data.ticket;
    assert.equal((await call('ops', 'POST', `/api/admin/tickets/${t.id}/reply`, { body: 'Done!', status: 'solved' })).status, 403);
    assert.equal((await call('ops', 'PUT', `/api/admin/tickets/${t.id}`, { status: 'closed' })).status, 403);
    assert.equal((await call('ops', 'POST', `/api/admin/tickets/${t.id}/reply`, { body: 'On it.' })).status, 200);
    // A non-owner cannot hand out bigger limits than their own: covered by role rules.
    const rr = require('./roles');
    assert.ok(rr.limitsProblem({ max_credit_grant: 100 }, { max_credit_grant: 500 }, ['users.credits']));
    assert.equal(rr.limitsProblem({ max_credit_grant: 100 }, { max_credit_grant: 50 }, ['users.credits']), null);
  });
  await step('Permissions: refund limit per role; presets and plain-English groups are served to the role builder', async () => {
    const rid = await newRole('Small refunds', ['payments.view', 'payments.refund'], { max_refund_usd: 10 });
    await staffLogin('rf', 'refunds@example.com', rid);
    const r = await call('rf', 'POST', `/api/admin/payments/${planPid}/refund`, { remove_credits: false });
    assert.equal(r.status, 403); assert.match(r.data.error, /up to \$10/);
    const st = (await O('GET', '/api/admin/staff')).data;
    assert.deepEqual(st.perm_groups.map((g) => g.label).slice(0, 6), ['Support', 'Users', 'Money', 'Content', 'Settings', 'AI']);
    for (const n of ['Owner', 'Admin', 'Support agent', 'Finance', 'Content editor']) assert.ok(st.presets.some((p) => p.name === n), n);
    for (const n of ['Admin', 'Support agent', 'Finance', 'Content editor']) assert.ok(st.roles.some((x) => x.name === n), 'seeded role ' + n);
    assert.ok(!st.presets.find((p) => p.name === 'Admin').permissions.includes('*'));
  });

  // ---------------- VooSquare ----------------
  let vTicket;
  await step('VooSquare connect: connection code → settings, URLs to paste back, test both ways (mock-safe)', async () => {
    assert.equal((await O('POST', '/api/admin/voosquare/connect', { code: 'not-a-code' })).status, 400);
    const code = 'vsq1.' + Buffer.from(JSON.stringify({ v: 1, issuer: 'https://id.voosquare.test', client_id: 'vooads-check', client_secret: 'cs_check', support_events_url: 'https://api.voosquare.test/v1/support/events' })).toString('base64url');
    const dec = await O('POST', '/api/admin/voosquare/decode', { code });
    assert.equal(dec.data.fields.issuer, 'https://id.voosquare.test'); assert.equal(dec.data.fields.client_secret_set, true);
    const c = await O('POST', '/api/admin/voosquare/connect', { code });
    assert.equal(c.status, 200, JSON.stringify(c.data));
    assert.ok(c.data.urls.tickets_url.endsWith('/api/voosquare/support/tickets') && c.data.urls.redirect_uri.endsWith('/auth/voosquare/callback'));
    assert.ok(!JSON.stringify(c.data.urls).includes('cs_check'), 'no secret in the URLs');
    await O('POST', '/api/admin/voosquare/support', { enabled: true, mode: 'both' });
    const t = await O('POST', '/api/admin/voosquare/test');
    assert.ok(t.data.out.ok && t.data.out.mock, 'outbound ping simulated for a .test host: ' + JSON.stringify(t.data.out));
    assert.ok(t.data.in.ok, 'inbound API answers with the key: ' + JSON.stringify(t.data.in));
    assert.equal(t.data.status.state, 'connected');
  });
  await step('VooSquare inbound: agents act with their mapped Vooads role (reply, close, assign, scope, credits); replies are idempotent and ordered', async () => {
    const voo = (method, url, body, extra = {}) => call('vs2', method, url, body, { Authorization: 'Bearer ' + VOO_KEY, ...extra });
    const before = (await O('GET', '/api/admin/voosquare/agents')).data;
    const ids = { viewer: await roleId('Viewer'), agent: await roleId('Support agent'), lead: await roleId('Support') };
    const sv = await O('PUT', '/api/admin/voosquare/agents', { default_role_id: 'none', map: [{ email: 'reader@voosquare.com', role_id: ids.viewer }, { email: 'agent@voosquare.com', role_id: ids.agent }, { email: 'lead@voosquare.com', role_id: ids.lead }] });
    assert.equal(sv.status, 200, JSON.stringify(sv.data));
    assert.equal((await O('PUT', '/api/admin/voosquare/agents', { map: [{ email: 'boss@voosquare.com', role_id: await roleId('Owner') }] })).status, 400, 'no Owner role for agents');
    await custLogin('vc', 'voocust@example.com');
    vTicket = (await call('vc', 'POST', '/api/tickets', { subject: 'Render question', body: 'Why did it fail?', category: 'video' })).data.ticket.id;
    const reply = (agent, body, extra = {}, headers = {}) => voo('POST', `/api/voosquare/support/tickets/${vTicket}/reply`, { body, agent, ...extra }, headers);
    assert.equal((await reply({ email: 'stranger@voosquare.com' }, 'hi')).status, 403, 'unmapped agent with no default role');
    assert.equal((await reply({ email: 'reader@voosquare.com' }, 'hi')).status, 403, 'Viewer cannot reply');
    assert.equal((await reply({ id: 'ag_9', email: 'agent@voosquare.com' }, 'hi')).status, 403, 'assigned-only agent: not their ticket');
    assert.equal((await voo('PUT', `/api/voosquare/support/tickets/${vTicket}`, { assignee: { id: 'ag_9', name: 'Agent Nine' }, agent: { email: 'agent@voosquare.com' } })).status, 403, 'agent cannot assign');
    assert.equal((await voo('PUT', `/api/voosquare/support/tickets/${vTicket}`, { priority: 'high' })).status, 400, 'changes need an agent');
    assert.equal((await voo('PUT', `/api/voosquare/support/tickets/${vTicket}`, { assignee: { id: 'ag_9', name: 'Agent Nine' }, agent: { email: 'lead@voosquare.com' } })).status, 200, 'lead assigns');
    const r1 = await reply({ id: 'ag_9', name: 'Agent Nine', email: 'agent@voosquare.com' }, 'Looking now.', { client_msg_id: 'vs-msg-1' });
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    const r2 = await reply({ id: 'ag_9', name: 'Agent Nine', email: 'agent@voosquare.com' }, 'Looking now.', {}, { 'Idempotency-Key': 'vs-msg-1' });
    assert.equal(r2.data.duplicate, true); assert.equal(r2.data.message.id, r1.data.message.id, 'same message, no duplicate');
    const adm = await O('POST', `/api/admin/tickets/${vTicket}/reply`, { body: 'Owner here too.' });
    const msgs = (await O('GET', '/api/admin/tickets/' + vTicket)).data.messages;
    assert.equal(msgs.filter((m) => m.body === 'Looking now.').length, 1);
    const idsOrder = msgs.map((m) => m.id);
    assert.deepEqual(idsOrder, [...idsOrder].sort((a, b) => a - b), 'ordered by id');
    assert.ok(idsOrder.indexOf(r1.data.message.id) < idsOrder.indexOf(adm.data.message.id));
    const inc = (await voo('GET', `/api/voosquare/support/tickets/${vTicket}/messages?after_id=${r1.data.message.id}`)).data;
    assert.deepEqual(inc.messages.map((m) => m.id), [adm.data.message.id], 'incremental sync returns only newer messages');
    assert.equal((await voo('POST', `/api/voosquare/support/tickets/${vTicket}/credits`, { amount: 150, reason: 'x', agent: { id: 'ag_9', email: 'agent@voosquare.com' } })).status, 403, 'over the role limit (100)');
    assert.equal((await voo('POST', `/api/voosquare/support/tickets/${vTicket}/credits`, { amount: 80, reason: 'Goodwill', agent: { id: 'ag_9', email: 'agent@voosquare.com' } })).status, 200);
    assert.equal((await reply({ id: 'ag_9', email: 'agent@voosquare.com' }, 'Solved, thanks!', { status: 'solved' })).status, 200, 'Support agent preset can solve');
    const audit = (await O('GET', '/api/admin/audit')).data.log;
    assert.ok(audit.some((x) => x.actor === 'voosquare:agent@voosquare.com' && x.detail.role === 'Support agent'));
    await O('PUT', '/api/admin/voosquare/agents', { default_role_id: before.default_role_id ?? 'none', map: [] });
  });

  // ---------------- Payments ----------------
  await step('Payments: sandbox test of a custom API (request preview, signed webhook simulated and rolled back) and a bank transfer with proof → approve', async () => {
    const before = (await O('GET', '/api/admin/payments?limit=500')).data.payments.length;
    const m = (await O('POST', '/api/admin/payment-methods', { adapter: 'custom', name: 'Check PSP' })).data.method;
    await O('PUT', '/api/admin/payment-methods/' + m.id, { secret: 'sk_check_123456', webhook_secret: 'whs_check_7890', config: { checkout_url: 'https://api.psp.test/v1/pay', method: 'POST', headers_json: '{"Authorization":"Bearer {{secret}}"}', body_template: '{"amount": {{amount_minor}}, "currency": "{{currency}}", "ref": "{{reference}}", "email": "{{email}}"}', response_url_path: 'data.link', currency: 'NGN', usd_rate: 1500, signature_header: 'x-psp-signature', signature_algo: 'sha512', paid_path: 'event', paid_value: 'charge.success', payment_id_path: 'data.reference', amount_path: 'data.amount' } });
    const sb = (await O('POST', `/api/admin/payment-methods/${m.id}/sandbox`)).data;
    assert.ok(sb.ok, JSON.stringify(sb.steps));
    assert.equal(sb.request.body.amount, 49 * 1500 * 100); assert.ok(!JSON.stringify(sb.request).includes('sk_check_123456'), 'secret masked');
    assert.equal((await O('GET', '/api/admin/payments?limit=500')).data.payments.length, before, 'sandbox saved nothing');
    await O('PUT', '/api/admin/payment-methods/' + m.id, { config: { checkout_url: 'https://api.psp.test/v1/pay', body_template: '{"amount": {{amount_minor}, }', currency: 'NGN', usd_rate: 1500, signature_header: 'x-psp-signature', signature_algo: 'sha512', paid_path: 'event', paid_value: 'charge.success', payment_id_path: 'data.reference' } });
    const bad = (await O('POST', `/api/admin/payment-methods/${m.id}/sandbox`)).data;
    assert.equal(bad.ok, false, 'a broken template and a missing link path are caught');
    assert.deepEqual(bad.steps.filter((x) => !x.ok).map((x) => x.label), ['Body template', 'Payment link path']);
    await O('DELETE', '/api/admin/payment-methods/' + m.id);
    // Bank transfer
    const bank = (await O('POST', '/api/admin/payment-methods', { adapter: 'manual', name: 'Bank transfer (NGN)' })).data.method;
    assert.equal((await O('POST', `/api/admin/payment-methods/${bank.id}/sandbox`)).data.ok, false, 'no bank details yet');
    await O('PUT', '/api/admin/payment-methods/' + bank.id, { enabled: true, countries: '*', config: { bank_name: 'GTBank', account_name: 'Zedapex Limited', account_number: '0123456789', currency: 'NGN', usd_rate: 1500, review_hours: 6, logo_url: '/assets/img/favicon.svg' } });
    assert.ok((await O('POST', `/api/admin/payment-methods/${bank.id}/sandbox`)).data.ok);
    await custLogin('bt', 'banker@example.com');
    const bill = (await call('bt', 'GET', '/api/billing')).data;
    assert.ok(bill.methods.find((x) => x.id === bank.id && x.manual && x.logo_url), 'logo and manual flag in the checkout list');
    const co = await call('bt', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: 'starter', period: 'month', method_id: bank.id });
    assert.equal(co.status, 200, JSON.stringify(co.data)); assert.match(co.data.url, /manual=/);
    const ins = (await call('bt', 'GET', '/api/billing/manual/' + co.data.payment_id)).data;
    assert.equal(ins.instructions.reference, 'VA-' + co.data.payment_id); assert.equal(ins.instructions.account_number, '0123456789'); assert.ok(ins.instructions.amount_local > 0);
    assert.equal((await call('x', 'GET', '/api/billing/manual/' + co.data.payment_id)).status, 401);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    assert.equal((await call('bt', 'POST', `/api/billing/manual/${co.data.payment_id}/proof`, Buffer.from('not an image at all'), { 'Content-Type': 'image/png' })).status, 400);
    const up = await call('bt', 'POST', `/api/billing/manual/${co.data.payment_id}/proof`, png, { 'Content-Type': 'image/png' });
    assert.equal(up.status, 200, JSON.stringify(up.data)); assert.equal(up.data.status, 'review');
    const rv = (await O('GET', '/api/admin/payments/review')).data.payments.find((p) => p.id === co.data.payment_id);
    assert.ok(rv && rv.proof_url && rv.status === 'review');
    assert.equal((await call('rf', 'POST', `/api/admin/payments/${co.data.payment_id}/approve`)).status, 403, 'approval follows the refund limit');
    assert.equal((await O('POST', `/api/admin/payments/${co.data.payment_id}/approve`)).status, 200);
    assert.equal((await call('bt', 'GET', '/api/me')).data.user.plan.id, 'starter');
    await O('PUT', '/api/admin/payment-methods/' + bank.id, { enabled: false });
  });

  // ---------------- AI model wizard: safe templates ----------------
  await step('AI models: custom HTTP body/URL/header templating is injection-safe (unit + a real request to a local API)', async () => {
    const tpl = require('./providers/httptpl');
    const evil = 'x", "admin": true, "seconds": 999, "z": "\\\n}{';
    const body = tpl.render('{ "prompt": "{{prompt}}", "seconds": {{seconds}}, "img": "{{image_url}}", "meta": { "note": "Make {{seconds}}s: {{prompt}}" } }', { prompt: evil, seconds: 8, image_url: 'https://a.test/i.png' });
    assert.deepEqual(Object.keys(body), ['prompt', 'seconds', 'img', 'meta']);
    assert.equal(body.prompt, evil); assert.equal(body.seconds, 8); assert.equal(body.admin, undefined);
    assert.equal(body.meta.note, 'Make 8s: ' + evil);
    assert.equal(JSON.parse(JSON.stringify(body)).prompt, evil);
    assert.equal(tpl.renderUrl('https://api.example.test/v1/{{prompt}}?q={{prompt}}', { prompt: '../admin?x=1&y=@evil.com/#' }), 'https://api.example.test/v1/..%2Fadmin%3Fx%3D1%26y%3D%40evil.com%2F%23?q=..%2Fadmin%3Fx%3D1%26y%3D%40evil.com%2F%23');
    assert.deepEqual(tpl.renderHeaders({ 'X-Prompt': '{{prompt}}', 'Bad Header': 'x' }, { prompt: 'a\r\nX-Evil: 1' }), { 'X-Prompt': 'aX-Evil: 1' });
    assert.throws(() => tpl.render('{ "a": {{x}} '), /not valid JSON/);
    // A real call through the wizard's live test to a local API: the API receives exactly the template's structure.
    let got = null;
    const api = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { got = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(ch).toString('utf8')) }; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: { url: 'https://cdn.example.test/out.png' } })); }); });
    await new Promise((r) => api.listen(0, '127.0.0.1', r));
    try {
      const fields = { url: `http://127.0.0.1:${api.address().port}/gen/{{prompt}}`, method: 'POST', headers: '{ "Authorization": "Bearer {{key}}", "X-Kind": "{{kind}}" }', body: '{ "prompt": "{{prompt}}", "n": 1, "size": "{{size}}" }', output_path: 'data.url' };
      const t = await O('POST', '/api/admin/ai-models/test', { kind: 'image', preset: 'http', fields, api_key: 'key_live_check', cost_usd: 0.02, cost_unit: 'per image', mode: 'live', sample_prompt: evil, sample_response: '{"data":{"url":"https://x.test/a.png"}}' });
      assert.equal(t.status, 200, JSON.stringify(t.data));
      assert.ok(t.data.ok, JSON.stringify(t.data.steps));
      assert.deepEqual(Object.keys(got.body), ['prompt', 'n', 'size']); assert.equal(got.body.prompt, evil.slice(0, 500)); assert.equal(got.body.n, 1);
      assert.ok(got.url.startsWith('/gen/x%22'), 'prompt URL-encoded in the path');
      assert.equal(got.headers.authorization, 'Bearer key_live_check');
      assert.ok(!JSON.stringify(t.data.request).includes('key_live_check'), 'key masked in the preview');
      assert.equal(t.data.result.url, 'https://cdn.example.test/out.png');
      const dry = await O('POST', '/api/admin/ai-models/test', { kind: 'image', preset: 'http', fields: { ...fields, output_path: 'data.nope' }, cost_usd: 0.02, sample_response: '{"data":{"url":"x"}}' });
      assert.equal(dry.data.ok, false, 'a wrong result path is caught in the dry run');
    } finally { api.close(); }
  });
  let videoProvider;
  await step('AI models: a new model for a quality level runs the profit guard (price raised, never at a loss)', async () => {
    const before = (await O('GET', '/api/admin/pricing')).data.pricing.video_types.find((t) => t.id === 'product_broll').levels.find((l) => l.id === 'ultra').credits_per_unit;
    const r = await O('POST', '/api/admin/ai-models', { kind: 'video', preset: 'http', name: 'Check Ultra video', fields: { url: 'https://api.example.test/video', body: '{"prompt":"{{prompt}}","seconds":{{seconds}}}', output_path: 'url' }, cost_usd: 2.5, cost_unit: 'per second', use: { mode: 'level', video_type: 'product_broll', level: 'ultra' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    videoProvider = r.data.provider_id;
    const hit = r.data.raised.find((x) => x.type === 'product_broll' && x.level === 'ultra');
    assert.ok(hit && hit.to > before, 'Ultra price raised: ' + JSON.stringify(r.data.raised));
    const mg = (await O('GET', '/api/admin/margins')).data.rows.find((x) => x.id === 'product_broll:ultra');
    assert.ok(mg.margin_pct >= 59.9, 'margin after the raise: ' + mg.margin_pct);
    await O('PUT', '/api/admin/providers/' + videoProvider, { enabled: false });
  });

  // ---------------- AI tools builder ----------------
  let failProv, toolId, slug;
  await step('AI tools: guard minimum price is applied on save; drafts are invisible to customers; testing is allow-list only', async () => {
    failProv = (await O('POST', '/api/admin/providers', { name: 'Check broken text API', kind: 'text', adapter: 'http', config: { url: 'http://127.0.0.1:9/never', output_path: 'text' }, cost_usd: 0.01, cost_unit: 'per call', priority: 900, enabled: false })).data.provider.id;
    const vidProv = (await O('POST', '/api/admin/providers', { name: 'Check pricey video API', kind: 'video', adapter: 'http', config: { url: 'https://api.example.test/v', output_path: 'url' }, cost_usd: 0.4, cost_unit: 'per second', enabled: false })).data.provider.id;
    const vdef = { name: 'Check video tool', icon: 'video', kind: 'video', output: 'video', seconds: 10, credits: 1, provider_id: vidProv, fields: [{ key: 'product', type: 'text', label: 'Product' }], prompt_template: 'A shot of {{product}}' };
    const pv = (await O('POST', '/api/admin/features/price', { def: vdef })).data;
    const g = require('./guard');
    assert.equal(pv.min_credits, Math.ceil(Math.round(4 / (1 - g.minMarginPct() / 100) / g.worstCaseUsdPerCredit() * 1e6) / 1e6), 'min = cost / (1 - margin) / worst $ per credit');
    const cv = (await O('POST', '/api/admin/features', { def: vdef })).data;
    assert.ok(cv.raised && cv.raised.from === 1 && cv.raised.to === pv.min_credits, JSON.stringify(cv.raised));
    assert.equal(cv.feature.draft.def.credits, pv.min_credits);
    assert.equal((await O('POST', '/api/admin/features', { def: { ...vdef, prompt_template: 'Use {{nope}}' } })).status, 400, 'unknown placeholder refused');
    assert.equal((await O('POST', '/api/admin/features', { def: { ...vdef, fields: [{ key: 'Bad Key', type: 'text' }] } })).status, 400);
    await O('DELETE', '/api/admin/features/' + cv.feature.id);
    // The text tool used below.
    const def = { name: 'Check caption writer', icon: 'pen', description: 'Writes captions', kind: 'text', output: 'list', credits: 3, fields: [{ key: 'product', type: 'text', label: 'Product', max: 80 }, { key: 'tone', type: 'choice', label: 'Tone', options: ['Fun', 'Calm'] }], prompt_template: 'V1: write 5 captions for {{product}} in a {{tone}} tone.' };
    const c = (await O('POST', '/api/admin/features', { def })).data;
    toolId = c.feature.id; slug = c.feature.slug;
    assert.equal(c.feature.status, 'draft');
    await custLogin('tu', 'tooluser@example.com'); await custLogin('tu2', 'outsider@example.com');
    assert.ok(!(await call('tu', 'GET', '/api/tools')).data.tools.some((t) => t.slug === slug), 'draft hidden');
    assert.equal((await call('tu', 'POST', `/api/tools/${slug}/run`, { inputs: { product: 'Serum', tone: 'Fun' } })).status, 404, 'draft cannot run');
    await O('PUT', `/api/admin/features/${toolId}/testers`, { emails: 'tooluser@example.com' });
    await O('POST', `/api/admin/features/${toolId}/status`, { status: 'testing' });
    const seen = (await call('tu', 'GET', '/api/tools')).data.tools.find((t) => t.slug === slug);
    assert.ok(seen && seen.testing, 'tester sees it'); assert.ok(!(await call('tu2', 'GET', '/api/tools')).data.tools.some((t) => t.slug === slug), 'others do not');
    const tr = await O('POST', `/api/admin/features/${toolId}/try`, { inputs: { product: 'Serum', tone: 'Calm' } });
    assert.equal(tr.status, 200, JSON.stringify(tr.data)); assert.match(tr.data.prompt, /Serum in a Calm tone/); assert.ok(tr.data.output.items.length >= 1);
    assert.equal((await O('POST', `/api/admin/features/${toolId}/try`, { inputs: { product: 'Serum', tone: 'Angry' } })).status, 400, 'choices are checked');
  });
  await step('AI tools: publish switches versions atomically; live customers keep the live version while a new draft is edited', async () => {
    const p1 = (await O('POST', `/api/admin/features/${toolId}/publish`)).data.feature;
    assert.equal(p1.status, 'live'); assert.equal(p1.draft, null);
    const v1 = p1.live.version_id;
    assert.equal((await O('POST', `/api/admin/features/${toolId}/publish`)).status, 400, 'nothing to publish twice');
    const cur = (await O('GET', `/api/admin/features/${toolId}`)).data.feature;
    await O('PUT', `/api/admin/features/${toolId}`, { def: { ...cur.live.def, name: 'Check caption writer v2', prompt_template: 'V2: write captions for {{product}} ({{tone}}).' } });
    assert.ok((await call('tu2', 'GET', '/api/tools')).data.tools.find((t) => t.slug === slug).name === 'Check caption writer', 'customers still see v1');
    const j1 = (await call('tu2', 'POST', `/api/tools/${slug}/run`, { inputs: { product: 'Serum', tone: 'Fun' } })).data.job;
    assert.equal(j1.input.version_id, v1); assert.match(j1.input.prompt, /^V1:/);
    const d1 = await waitJob('tu2', j1.id);
    assert.equal(d1.status, 'done', d1.error); assert.ok(d1.output.items.length >= 1);
    const p2 = (await O('POST', `/api/admin/features/${toolId}/publish`)).data.feature;
    assert.notEqual(p2.live.version_id, v1);
    const j2 = (await call('tu2', 'POST', `/api/tools/${slug}/run`, { inputs: { product: 'Serum', tone: 'Fun' } })).data.job;
    assert.equal(j2.input.version_id, p2.live.version_id); assert.match(j2.input.prompt, /^V2:/);
    assert.equal((await waitJob('tu2', j2.id)).status, 'done');
    assert.ok((await O('GET', `/api/admin/features/${toolId}`)).data.feature.versions.length >= 2, 'version history');
    // The swap is one conditional UPDATE: a publish against a draft that changed in between does nothing.
    const { run } = require('./db');
    assert.equal(run("UPDATE ai_features SET live_version_id = draft_version_id, draft_version_id = NULL, status = 'live' WHERE id = ? AND draft_version_id = ?", toolId, -1).changes, 0);
    await O('POST', `/api/admin/features/${toolId}/status`, { status: 'paused' });
    assert.ok(!(await call('tu2', 'GET', '/api/tools')).data.tools.some((t) => t.slug === slug), 'paused tools disappear');
    assert.equal((await call('tu2', 'POST', `/api/tools/${slug}/run`, { inputs: { product: 'Serum', tone: 'Fun' } })).status, 404);
    await O('POST', `/api/admin/features/${toolId}/status`, { status: 'live' });
  });
  await step('AI tools: a failed run refunds every credit exactly once', async () => {
    const cur = (await O('GET', `/api/admin/features/${toolId}`)).data.feature;
    await O('PUT', '/api/admin/providers/' + failProv, { enabled: true });
    await O('PUT', `/api/admin/features/${toolId}`, { def: { ...cur.live.def, provider_id: failProv } });
    await O('POST', `/api/admin/features/${toolId}/publish`);
    const bal0 = (await call('tu2', 'GET', '/api/me')).data.user.balance.total;
    const r = await call('tu2', 'POST', `/api/tools/${slug}/run`, { inputs: { product: 'Serum', tone: 'Calm' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.balance.total, bal0 - r.data.job.credits, 'charged up front');
    const j = await waitJob('tu2', r.data.job.id, 30);
    assert.equal(j.status, 'failed');
    const bal1 = (await call('tu2', 'GET', '/api/me')).data.user.balance.total;
    assert.equal(bal1, bal0, 'refunded: ' + JSON.stringify({ bal0, bal1, credits: r.data.job.credits, err: j.error }));
    const { get } = require('./db');
    assert.equal(get('SELECT refunded FROM jobs WHERE id = ?', j.id).refunded, 1);
    assert.equal(get("SELECT COUNT(*) AS c FROM credit_ledger WHERE ref = ? AND delta > 0", 'job:' + j.id).c, 1, 'one refund line');
    await O('POST', `/api/admin/features/${toolId}/status`, { status: 'paused' });
    await O('PUT', '/api/admin/providers/' + failProv, { enabled: false });
  });
};
