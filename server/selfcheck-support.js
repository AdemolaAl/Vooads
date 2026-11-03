// Self-check steps for support tickets, VooSquare support and the Gatevoo / custom payment adapters.
// Called from selfcheck.js after the main flows: supportChecks({ call, step, wait }).
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert');

const hmac = (algo, key, data) => crypto.createHmac(algo, key).update(data).digest('hex');

module.exports = async function supportChecks({ call, step, wait }) {
  const B = process.env.APP_URL;
  const VOO_KEY = process.env.VOO_SERVICE_KEY, VOO_SECRET = process.env.VOO_WEBHOOK_SECRET;
  // A tiny local server that plays VooSquare (events), Gatevoo (invoices) and a custom PSP (checkout).
  const events = [], seen = {};
  const recv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const send = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/events') { events.push({ headers: req.headers, raw, body: JSON.parse(raw) }); return send({ ok: true, voo_ticket_id: 'VS-' + events.length }); }
      if (req.url === '/api/v1/invoices') { seen.invoice = { headers: req.headers, body: JSON.parse(raw) }; return send({ id: 'inv_' + seen.invoice.body.order_id, checkout_url: 'https://pay.gatevoo.test/i/1' }); }
      if (req.url === '/custom/checkout') { seen.custom = { headers: req.headers, body: JSON.parse(raw) }; return send({ status: true, data: { link: 'https://pay.psp.test/abc' } }); }
      send({ error: 'not found' }, 404);
    });
  });
  await new Promise((r) => recv.listen(0, '127.0.0.1', r));
  const R = 'http://127.0.0.1:' + recv.address().port;
  const voo = (method, url, body, key = VOO_KEY) => call('vs', method, url, body, { Authorization: 'Bearer ' + key });
  const raw = async (url, body, headers) => {
    const r = await fetch(B + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  let ticketId, agentId;
  await step('Support settings: owner turns on VooSquare support', async () => {
    const r = await call('a', 'PUT', '/api/admin/support-settings', { voosquare: { enabled: true, mode: 'both', events_url: R + '/events', max_credit_grant: 300 }, sla_hours: { normal: 12 } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.voosquare.mode, 'both'); assert.ok(r.data.voosquare.service_key_set);
    assert.equal((await call('a', 'PUT', '/api/admin/support-settings', { voosquare: { mode: 'nope' } })).status, 400);
  });
  await step('Support: customer opens a ticket and gets an instant bot reply', async () => {
    const c = await call('t', 'POST', '/api/auth/code', { email: 'tickets@example.com' });
    await call('t', 'POST', '/api/auth/verify', { email: 'tickets@example.com', code: c.data.dev_code, name: 'Tunde', country: 'NG' });
    const r = await call('t', 'POST', '/api/tickets', { subject: 'Render failed', body: 'My video render failed. Do I get my credits back?', category: 'video' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ticketId = r.data.ticket.id;
    assert.ok(r.data.ticket.status === 'open');
    const d = await call('t', 'GET', '/api/tickets/' + ticketId);
    const bot = d.data.messages.find((m) => m.author_type === 'bot');
    assert.ok(bot, 'bot reply missing');
    assert.ok(/reply here within about 12 hours/.test(bot.body), bot.body);
    assert.ok(bot.attachments.length >= 1 && bot.attachments[0].title, 'no help articles suggested');
    const call2 = await call('t', 'POST', '/api/tickets', { subject: 'Call me', body: 'Please call me about billing', category: 'call' });
    assert.equal(call2.status, 400); // phone required for callbacks
    const log = (await call('a', 'GET', '/api/admin/emails')).data.log;
    assert.ok(log.some((x) => x.template === 'ticket_new'), 'support inbox email not queued');
  });
  await step('VooSquare receives a signed ticket.created event', async () => {
    for (let i = 0; i < 30 && !events.length; i++) await wait(100);
    const e = events.find((x) => x.body.type === 'ticket.created');
    assert.ok(e, 'no event received');
    assert.equal(e.headers['x-voo-signature'], 'sha256=' + hmac('sha256', VOO_SECRET, e.raw));
    assert.equal(e.headers['x-voo-tool'], 'vooads');
    assert.equal(e.body.tool, 'vooads'); assert.ok(e.body.event_id && e.body.occurred_at);
    assert.equal(e.body.ticket.id, ticketId); assert.equal(e.body.customer.email, 'tickets@example.com');
    assert.equal(e.body.message.author_type, 'customer');
    await wait(100);
    assert.equal((await call('a', 'GET', '/api/admin/tickets/' + ticketId)).data.ticket.voo_ticket_id, 'VS-1');
  });
  await step('Support: staff reply reaches the customer, internal note stays hidden', async () => {
    const n = await call('a', 'POST', `/api/admin/tickets/${ticketId}/reply`, { body: 'Customer is on a launch deadline, be quick.', internal: true });
    assert.equal(n.status, 200, JSON.stringify(n.data));
    const r = await call('a', 'POST', `/api/admin/tickets/${ticketId}/reply`, { body: 'Sorry about that! Your credits are back in your wallet.' });
    assert.equal(r.status, 200); assert.equal(r.data.ticket.status, 'pending');
    const list = await call('t', 'GET', '/api/tickets');
    assert.equal(list.data.tickets.find((t) => t.id === ticketId).unread, 1);
    const d = await call('t', 'GET', '/api/tickets/' + ticketId);
    assert.ok(d.data.messages.some((m) => m.author_type === 'staff' && /credits are back/.test(m.body)));
    assert.ok(!d.data.messages.some((m) => /launch deadline/.test(m.body)), 'internal note leaked to customer');
    assert.equal((await call('t', 'GET', '/api/tickets')).data.tickets.find((t) => t.id === ticketId).unread, 0);
    const admin = await call('a', 'GET', '/api/admin/tickets/' + ticketId);
    assert.ok(admin.data.messages.some((m) => m.internal && /launch deadline/.test(m.body)));
    assert.ok(admin.data.ticket.first_response_at);
    const inbox = await call('a', 'GET', '/api/admin/tickets?status=open,pending');
    assert.equal(inbox.status, 200); assert.ok(inbox.data.tickets.length >= 1 && inbox.data.counts.pending >= 1);
    const log = (await call('a', 'GET', '/api/admin/emails')).data.log;
    assert.equal(log.filter((x) => x.template === 'ticket_reply' && x.to_email === 'tickets@example.com').length, 1);
    assert.ok((await call('a', 'GET', '/api/admin/overview')).data.open_tickets >= 0);
    const m = await call('a', 'POST', '/api/admin/macros', { title: 'Check spam', body: 'Hi {{name}}, check your spam folder.' });
    assert.equal(m.status, 200);
    assert.ok((await call('a', 'GET', '/api/admin/macros')).data.macros.length >= 4);
  });
  await step('Support: assigned-only agent cannot read unassigned tickets', async () => {
    const roles = (await call('a', 'GET', '/api/admin/staff')).data.roles;
    const role = roles.find((r) => r.name === 'Support (assigned only)');
    assert.ok(role && role.limits.ticket_scope === 'assigned');
    assert.ok(roles.find((r) => r.name === 'Support').permissions.includes('tickets.reply'));
    assert.ok(roles.find((r) => r.name === 'Viewer').permissions.includes('tickets.view'));
    const inv = await call('a', 'POST', '/api/admin/staff', { email: 'agent@example.com', role_id: role.id });
    await call('g', 'POST', '/api/admin/invite/' + inv.data.invite_url.split('invite=')[1], { name: 'Agent' });
    const c = await call('g', 'POST', '/api/admin/auth/code', { email: 'agent@example.com' });
    await call('g', 'POST', '/api/admin/auth/verify', { email: 'agent@example.com', code: c.data.dev_code });
    agentId = (await call('g', 'GET', '/api/admin/me')).data.staff.id;
    const t2 = await call('t', 'POST', '/api/tickets', { subject: 'Login trouble', body: 'I do not get the login code email' });
    assert.equal((await call('g', 'GET', '/api/admin/tickets/' + t2.data.ticket.id)).status, 403);
    assert.equal((await call('g', 'GET', '/api/admin/tickets')).data.tickets.length, 0);
    assert.equal((await call('a', 'PUT', '/api/admin/tickets/' + t2.data.ticket.id, { assignee_staff_id: agentId, priority: 'high' })).status, 200);
    assert.equal((await call('g', 'GET', '/api/admin/tickets/' + t2.data.ticket.id)).status, 200);
    assert.equal((await call('g', 'GET', '/api/admin/tickets/' + ticketId)).status, 403);
    assert.equal((await call('g', 'POST', `/api/admin/tickets/${t2.data.ticket.id}/credits`, { amount: 500, reason: 'too much' })).status, 403);
    assert.equal((await call('g', 'POST', `/api/admin/tickets/${t2.data.ticket.id}/credits`, { amount: 20, reason: 'Sorry for the wait' })).status, 200);
    assert.equal((await call('g', 'PUT', '/api/admin/tickets/' + t2.data.ticket.id, { assignee_staff_id: null })).status, 403); // no tickets.assign
  });
  await step('VooSquare inbound: right key replies, wrong key gets 401', async () => {
    assert.equal((await voo('GET', '/api/voosquare/support/tickets', null, 'wrong-key')).status, 401);
    assert.equal((await voo('POST', `/api/voosquare/support/tickets/${ticketId}/reply`, { body: 'x', agent: { email: 'x@y.com' } }, 'wrong-key')).status, 401);
    const list = await voo('GET', '/api/voosquare/support/tickets?status=open,pending');
    assert.equal(list.status, 200); assert.ok(list.data.tickets.some((t) => t.id === ticketId));
    const r = await voo('POST', `/api/voosquare/support/tickets/${ticketId}/reply`, { body: 'Hi Tunde, Tola from VooSquare here.', agent: { id: 'ag_1', name: 'Tola', email: 'tola@voosquare.com', role: 'agent' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const d = await call('t', 'GET', '/api/tickets/' + ticketId);
    assert.ok(d.data.messages.some((m) => m.author_type === 'voosquare' && m.author_name === 'Tola'));
    const u = await voo('PUT', '/api/voosquare/support/tickets/' + ticketId, { status: 'solved', assignee: { id: 'ag_1', name: 'Tola' }, agent: { email: 'tola@voosquare.com' } });
    assert.equal(u.status, 200); assert.equal(u.data.ticket.assignee_ext_name, 'Tola'); assert.equal(u.data.ticket.status, 'solved');
    assert.equal((await voo('POST', `/api/voosquare/support/tickets/${ticketId}/credits`, { amount: 301, reason: 'x', agent: { email: 'tola@voosquare.com' } })).status, 403);
    assert.equal((await voo('POST', `/api/voosquare/support/tickets/${ticketId}/credits`, { amount: 50, reason: 'Goodwill', agent: { email: 'tola@voosquare.com' } })).status, 200);
    const stats = await voo('GET', '/api/voosquare/support/stats');
    assert.equal(stats.status, 200); assert.ok(stats.data.counts.solved >= 1);
    const audit = (await call('a', 'GET', '/api/admin/audit')).data.log;
    assert.ok(audit.some((x) => x.actor === 'voosquare:tola@voosquare.com' && x.action === 'ticket.reply'));
    assert.ok(!events.some((e) => e.body.message?.author_type === 'voosquare'), 'VooSquare reply was echoed back to VooSquare');
  });
  await step('Support mode "voosquare" makes the admin inbox read-only (and "vooads" blocks VooSquare)', async () => {
    await call('a', 'PUT', '/api/admin/support-settings', { voosquare: { mode: 'voosquare' } });
    const r = await call('a', 'POST', `/api/admin/tickets/${ticketId}/reply`, { body: 'hello' });
    assert.equal(r.status, 409); assert.ok(/VooSquare/.test(r.data.error));
    assert.equal((await call('a', 'GET', '/api/admin/tickets')).data.read_only, true);
    await call('a', 'PUT', '/api/admin/support-settings', { voosquare: { mode: 'vooads' } });
    assert.equal((await voo('POST', `/api/voosquare/support/tickets/${ticketId}/reply`, { body: 'x', agent: { email: 'tola@voosquare.com' } })).status, 409);
    await call('a', 'PUT', '/api/admin/support-settings', { voosquare: { mode: 'both' } });
    assert.equal((await call('a', 'POST', `/api/admin/tickets/${ticketId}/reply`, { body: 'Back to normal.' })).status, 200);
  });
  await step('Old chat messages are imported into tickets', async () => {
    const { run, get } = require('./db');
    const uid = get("SELECT id FROM users WHERE email = 'tickets@example.com'").id;
    run('INSERT INTO support_messages(user_id, body) VALUES(?, ?)', uid, 'Old chat message from before tickets');
    assert.equal(require('./support').importLegacy(), 1);
    assert.equal(require('./support').importLegacy(), 0);
    const t = get("SELECT * FROM tickets WHERE user_id = ? AND subject = 'Chat with support'", uid);
    assert.ok(t && get('SELECT 1 FROM ticket_messages WHERE ticket_id = ? AND body LIKE ?', t.id, 'Old chat%'));
  });
  await step('Custom payment method: signed webhook marks payment paid, bad signature rejected', async () => {
    const add = await call('a', 'POST', '/api/admin/payment-methods', { adapter: 'custom', name: 'Test PSP' });
    assert.equal(add.status, 200);
    const mid = add.data.method.id;
    assert.ok(add.data.method.webhook_url.endsWith('/api/webhooks/custom/' + mid));
    const pm = await call('a', 'GET', '/api/admin/payment-methods');
    assert.ok(pm.data.adapters.custom.config_fields.some((f) => f.key === 'body_template') && pm.data.adapters.custom.multiple);
    assert.ok(pm.data.methods.some((m) => m.adapter === 'gatevoo' && !m.enabled), 'Gatevoo method not seeded');
    await call('a', 'PUT', '/api/admin/payment-methods/' + mid, {
      enabled: true, countries: ['*'], secret: 'psp_key', webhook_secret: 'psp_whsec',
      config: {
        checkout_url: R + '/custom/checkout', method: 'POST', headers_json: '{"Authorization":"Bearer {{secret}}"}',
        body_template: '{"amount":{{amount_minor}},"email":"{{email}}","reference":"{{reference}}","callback":"{{webhook_url}}","meta":{"payment_id":"{{payment_id}}"}}',
        response_url_path: 'data.link', currency: 'USD', usd_rate: 1, signature_header: 'x-psp-signature', signature_algo: 'sha512', signature_prefix: '',
        paid_path: 'event', paid_value: 'charge.success', payment_id_path: 'data.meta.payment_id', amount_path: 'data.amount_major',
      },
    });
    const plan = (await call('t', 'GET', '/api/public/config')).data.plans[0], price = plan.price_month;
    const co = await call('t', 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: plan.id, period: 'month', method_id: mid });
    assert.equal(co.status, 200, JSON.stringify(co.data));
    assert.equal(co.data.url, 'https://pay.psp.test/abc');
    assert.equal(seen.custom.headers.authorization, 'Bearer psp_key');
    assert.equal(seen.custom.body.email, 'tickets@example.com'); assert.equal(seen.custom.body.amount, Math.round(price * 100));
    const pid = co.data.payment_id;
    const body = JSON.stringify({ event: 'charge.success', data: { meta: { payment_id: String(pid) }, amount_major: price } });
    assert.equal((await raw('/api/webhooks/custom/' + mid, body, { 'x-psp-signature': 'deadbeef' })).status, 400);
    assert.equal((await raw('/api/webhooks/custom/' + mid, body, { 'x-psp-signature': hmac('sha512', 'wrong', body) })).status, 400);
    let bill = await call('t', 'GET', '/api/billing');
    assert.equal(bill.data.payments.find((p) => p.id === pid).status, 'pending');
    const ok = await raw('/api/webhooks/custom/' + mid, body, { 'x-psp-signature': hmac('sha512', 'psp_whsec', body) });
    assert.equal(ok.status, 200);
    bill = await call('t', 'GET', '/api/billing');
    assert.equal(bill.data.payments.find((p) => p.id === pid).status, 'paid');
    assert.equal((await call('t', 'GET', '/api/me')).data.user.plan.id, plan.id);
  });
  await step('Gatevoo: invoice is created; webhooks signed exactly like Gatevoo (timestamp, 5 minutes); test, review and underpaid credit nothing; paid credits once', async () => {
    const gv = (await call('a', 'GET', '/api/admin/payment-methods')).data.methods.find((m) => m.adapter === 'gatevoo');
    await call('a', 'PUT', '/api/admin/payment-methods/' + gv.id, { enabled: true, secret: 'gv_key', webhook_secret: 'gv_whsec', config: { base_url: R } });
    const before = (await call('t', 'GET', '/api/me')).data.user.balance.topup;
    const topup = (await call('t', 'GET', '/api/billing')).data.topups[0];
    const co = await call('t', 'POST', '/api/billing/checkout', { kind: 'topup', topup_id: topup.id, method_id: gv.id });
    assert.equal(co.status, 200, JSON.stringify(co.data));
    assert.equal(co.data.url, 'https://pay.gatevoo.test/i/1');
    const pid = co.data.payment_id;
    assert.equal(seen.invoice.headers.authorization, 'Bearer gv_key');
    assert.equal(seen.invoice.body.order_id, 'va_' + pid); assert.equal(seen.invoice.body.amount_usd, topup.price);
    assert.equal(seen.invoice.body.redirect_url.startsWith(B + '/app'), true);
    // Gatevoo's own signing (src/webhooks.js): hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`), no prefix.
    const gsign = (secret, ts, rawBody) => require('node:crypto').createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    const now = () => String(Math.floor(Date.now() / 1000));
    const gh = (secret, b, ts = now(), ev = 'invoice.paid') => ({ 'X-Gatevoo-Event': ev, 'X-Gatevoo-Timestamp': ts, 'X-Gatevoo-Delivery': 'wh_check', 'X-Gatevoo-Signature': gsign(secret, ts, b) });
    const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', created: new Date().toISOString(), data: { id: 'inv_va_' + pid, status: 'paid', order_id: 'va_' + pid, amount_usd: topup.price, txid: '0xabc' } });
    assert.equal((await raw('/api/webhooks/gatevoo', body, gh('nope', body))).status, 400, 'wrong secret');
    assert.equal((await raw('/api/webhooks/gatevoo', body, { ...gh('gv_whsec', body), 'X-Gatevoo-Signature': 'sha256=' + gsign('gv_whsec', now(), body) })).status, 400, 'old sha256= form refused');
    assert.equal((await raw('/api/webhooks/gatevoo', body, gh('gv_whsec', body, String(Math.floor(Date.now() / 1000) - 600)))).status, 400, 'older than 5 minutes');
    const test = JSON.stringify({ id: 'evt_t', type: 'invoice.test', created: new Date().toISOString(), data: { id: 'inv_test', status: 'paid', order_id: 'va_' + pid, amount_usd: topup.price } });
    assert.equal((await raw('/api/webhooks/gatevoo', test, gh('gv_whsec', test, now(), 'invoice.test'))).status, 200, 'test event answered');
    const review = JSON.stringify({ id: 'evt_r', type: 'invoice.paid', data: { id: 'inv_va_' + pid, status: 'review', order_id: 'va_' + pid, amount_usd: topup.price } });
    assert.equal((await raw('/api/webhooks/gatevoo', review, gh('gv_whsec', review))).status, 200);
    const under = JSON.stringify({ id: 'evt_u', type: 'invoice.paid', data: { id: 'inv_va_' + pid, status: 'paid', order_id: 'va_' + pid, amount_usd: topup.price - 1 } });
    assert.equal((await raw('/api/webhooks/gatevoo', under, gh('gv_whsec', under))).status, 200);
    const expired = JSON.stringify({ id: 'evt_e', type: 'invoice.expired', data: { order_id: 'va_' + pid } });
    assert.equal((await raw('/api/webhooks/gatevoo', expired, gh('gv_whsec', expired, now(), 'invoice.expired'))).status, 200);
    assert.equal((await call('t', 'GET', '/api/billing')).data.payments.find((p) => p.id === pid).status, 'pending', 'test, review, underpaid and expired credit nothing');
    const ok = await raw('/api/webhooks/gatevoo', body, gh('gv_whsec', body));
    assert.equal(ok.status, 200);
    assert.equal((await call('t', 'GET', '/api/billing')).data.payments.find((p) => p.id === pid).status, 'paid');
    assert.equal((await raw('/api/webhooks/gatevoo', body, gh('gv_whsec', body))).status, 200, 'retry is fine');
    assert.equal((await call('t', 'GET', '/api/me')).data.user.balance.topup, before + topup.credits);
  });
  recv.close();
};
