// Admin "business" API (Oct 2026): customer spend and revenue, Connect VooSquare + agent roles, the payment method wizard
// (sandbox test, bank transfers with proof), the AI model wizard and the AI tools builder, plus the customer side of
// bank transfers and AI tools. Logic lives in finance.js, vooconnect.js, paysandbox.js, aimodels.js and aitools.js.
const config = require('../config');
const { get, all, run } = require('../db');
const { parseJson, fail, readBody, rateLimit } = require('../lib/http');
const { now, isImage } = require('../lib/util');
const auth = require('../auth');
const credits = require('../credits');
const payments = require('../payments');
const billing = require('../billing');
const media = require('../media');
const finance = require('../finance');
const vooconnect = require('../vooconnect');
const paysandbox = require('../paysandbox');
const aimodels = require('../aimodels');
const aitools = require('../aitools');
const core = require('../aitools-core');
const team = require('../team');
const support = require('../support');
const { pricing } = require('../settings');

const audit = (staff, action, target, detail) => run('INSERT INTO audit_log(staff_id, action, target, detail) VALUES(?,?,?,?)', staff.id, action, String(target ?? ''), JSON.stringify(detail || {}));
const money = (s) => auth.can(s, 'users.finance');

module.exports = function mount(r) {
  finance.migrate();
  aitools.migrate();
  team.migrate();

  // ================= Customer spend & revenue =================
  r.get('/api/admin/finance/customers', (req, res) => {
    const s = auth.requireStaff(req, 'users.view');
    res.json(finance.customers(req.query, { money: money(s) }));
  });
  r.get('/api/admin/finance/customers.csv', (req, res) => {
    const s = auth.requireStaff(req, 'users.view');
    if (!money(s)) fail(403, 'Your role cannot see money, so it cannot export spend. Ask the owner for "See money".');
    const csv = finance.customersCsv(req.query);
    audit(s, 'finance.export', 'customers', { from: req.query.from || null, to: req.query.to || null });
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="vooads-customers-${now().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' });
    res.end('﻿' + csv);
  });
  r.get('/api/admin/finance/customers/:id', (req, res) => {
    const s = auth.requireStaff(req, 'users.view');
    const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'Customer not found');
    const d = finance.customer(u.id, { money: money(s), payments: auth.can(s, 'payments.view') });
    let brand = null; try { brand = JSON.parse(u.brand || 'null'); } catch {}
    res.json({
      user: { id: u.id, email: u.email, name: u.name, country: u.country, status: u.status, ban_reason: u.ban_reason, plan_id: u.plan_id, plan_period: u.plan_period, plan_expires_at: u.plan_expires_at, auto_renew: !!u.auto_renew, voo_id: u.voo_id, ref_code: u.ref_code, referred_by: u.referred_by, marketing_opt_in: !!u.marketing_opt_in, created_at: u.created_at, last_seen_at: u.last_seen_at, brand, balance: credits.balance(u) },
      ledger: credits.ledger(u.id, 60), ...d, money: money(s),
      can: { credits: auth.can(s, 'users.credits'), ban: auth.can(s, 'users.ban'), edit: auth.can(s, 'users.edit'), tickets: auth.can(s, 'tickets.view'), refund: auth.can(s, 'payments.refund'), limits: auth.can(s, '*') ? {} : auth.roleLimits(s), granted_today: team.grantedToday(s.id) },
    });
  });
  r.get('/api/admin/finance/overview', (req, res) => {
    const s = auth.requireStaff(req, 'dashboard.view');
    if (!money(s)) fail(403, 'Your role cannot see money. Ask the owner for "See money".');
    res.json(finance.overview(req.query.days));
  });

  // ================= Connect VooSquare =================
  r.get('/api/admin/voosquare/status', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    res.json(vooconnect.status());
  });
  r.post('/api/admin/voosquare/decode', async (req, res) => {
    auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const f = vooconnect.decodeCode(b.code);
    res.json({ fields: { issuer: f.issuer, base: f.base, api_key_set: !!f.api_key, client_id: f.client_id, client_secret_set: !!f.client_secret, events_url: f.events_url, support_events_url: f.support_events_url, webhook_secret_set: !!f.webhook_secret } });
  });
  r.post('/api/admin/voosquare/connect', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const out = vooconnect.connect(b, { rotate: !!b.rotate });
    audit(s, 'voosquare.connect', 'voosquare', { saved: out.saved, rotated: !!b.rotate, new_key: !!out.return_code });
    res.json(out);
  });
  r.post('/api/admin/voosquare/rotate', (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const out = vooconnect.rotateKeys();
    audit(s, 'voosquare.connect', 'voosquare', { rotated: true });
    res.json(out);
  });
  r.post('/api/admin/voosquare/support', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const v = {};
    if (b.enabled !== undefined) v.enabled = !!b.enabled;
    if (b.mode !== undefined) v.mode = b.mode;
    if (b.max_credit_grant !== undefined) v.max_credit_grant = b.max_credit_grant;
    support.saveSettings({ voosquare: v });
    audit(s, 'support.settings', 'support', { voosquare: support.settings().voosquare });
    res.json(vooconnect.status());
  });
  r.post('/api/admin/voosquare/test', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const out = await vooconnect.ping();
    audit(s, 'integrations.test', 'voosquare-both', { out: out.out.ok, in: out.in.ok });
    res.json(out);
  });
  r.get('/api/admin/voosquare/agents', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    res.json({ ...vooconnect.agentSettings(), roles: all('SELECT id, name, permissions FROM roles ORDER BY id').map((x) => ({ id: x.id, name: x.name, owner: /"\*"/.test(x.permissions) })), recent: all("SELECT DISTINCT substr(actor, 11) AS email FROM audit_log WHERE actor LIKE 'voosquare:%' ORDER BY id DESC LIMIT 30").map((x) => x.email) });
  });
  r.put('/api/admin/voosquare/agents', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    if (!auth.can(s, 'staff.manage')) fail(403, 'Mapping agents to roles needs "Invite people and edit roles".');
    const b = await parseJson(req);
    // No climbing: a non-owner can only map agents to roles whose permissions they have themselves.
    if (!auth.can(s, '*')) {
      const mine = auth.perms(s);
      const ids = [...(Array.isArray(b.map) ? b.map.map((x) => Number(x.role_id)) : []), ...(b.default_role_id && b.default_role_id !== 'none' ? [Number(b.default_role_id)] : [])];
      for (const id of ids) { const role = get('SELECT * FROM roles WHERE id = ?', id); if (role && JSON.parse(role.permissions || '[]').some((p) => !mine.includes(p))) fail(403, `You can only give agents roles with permissions you have. "${role.name}" has more.`); }
    }
    const out = vooconnect.saveAgents(b);
    audit(s, 'voosquare.agents', 'voosquare', { agents: out.map.length, default_role_id: out.default_role_id });
    res.json(out);
  });

  // ================= Payment method wizard =================
  r.post('/api/admin/payment-methods/:id/sandbox', (req, res) => {
    const s = auth.requireStaff(req, 'payments.manage');
    const m = get('SELECT * FROM payment_methods WHERE id = ?', Number(req.params.id));
    if (!m) fail(404, 'Not found');
    const out = paysandbox.check(m);
    require('../integrations').record('method:' + m.id, { ok: out.ok, note: 'Sandbox: ' + (out.ok ? 'all checks passed' : out.steps.filter((x) => !x.ok).map((x) => x.label).join(', ') + ' to fix') });
    audit(s, 'payment_method.test', m.id, { ok: out.ok, sandbox: true });
    res.json(out);
  });
  r.get('/api/admin/payments/review', (req, res) => {
    auth.requireStaff(req, 'payments.view');
    res.json({ payments: all("SELECT p.id, p.user_id, p.method_id, p.kind, p.plan_id, p.period, p.topup_id, p.credits, p.amount_usd, p.status, p.proof_url, p.review_note, p.created_at, u.email, u.name, m.name AS method_name, m.config AS method_config FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN payment_methods m ON m.id = p.method_id WHERE p.adapter = 'manual' AND p.status IN ('review','pending') ORDER BY CASE p.status WHEN 'review' THEN 0 ELSE 1 END, p.id DESC LIMIT 100")
      .map((p) => { let c = {}; try { c = JSON.parse(p.method_config || '{}'); } catch {} const cur = String(c.currency || 'USD').toUpperCase(); const rate = cur === 'USD' ? 1 : Number(c.usd_rate) || 0; return { ...p, method_config: undefined, reference: 'VA-' + p.id, currency: cur, amount_local: rate ? Math.round(p.amount_usd * rate * 100) / 100 : null }; }) });
  });
  r.post('/api/admin/payments/:id/approve', (req, res) => {
    const s = auth.requireStaff(req, 'payments.refund');
    const p = get("SELECT * FROM payments WHERE id = ? AND adapter = 'manual'", Number(req.params.id));
    if (!p || !['review', 'pending'].includes(p.status)) fail(400, 'Only bank transfers waiting for review can be approved.');
    team.assertRefund(s, p.amount_usd); // same money limit as refunds
    billing.markPaid(p.id, { ref: 'manual_' + p.id, raw: { approved_by: s.email, proof_url: p.proof_url } });
    audit(s, 'payment.approve', p.id, { amount_usd: p.amount_usd, user_id: p.user_id });
    res.json({ ok: true, payment: get('SELECT id, status, paid_at FROM payments WHERE id = ?', p.id) });
  });
  r.post('/api/admin/payments/:id/reject', async (req, res) => {
    const s = auth.requireStaff(req, 'payments.refund');
    const b = await parseJson(req);
    const p = get("SELECT * FROM payments WHERE id = ? AND adapter = 'manual'", Number(req.params.id));
    if (!p || !['review', 'pending'].includes(p.status)) fail(400, 'Only bank transfers waiting for review can be rejected.');
    const note = String(b.note || '').trim().slice(0, 300);
    if (!note) fail(400, 'Tell the customer why (they see this).');
    run("UPDATE payments SET status = 'failed', review_note = ? WHERE id = ?", note, p.id);
    audit(s, 'payment.reject', p.id, { note });
    res.json({ ok: true });
  });
  // Customer: bank details for a transfer they started, and the proof upload.
  const ownManual = (u, id) => {
    const p = get("SELECT * FROM payments WHERE id = ? AND user_id = ? AND adapter = 'manual'", Number(id), u.id);
    if (!p) fail(404, 'Payment not found.');
    return p;
  };
  r.get('/api/billing/manual/:id', (req, res) => {
    const u = auth.requireUser(req);
    const p = ownManual(u, req.params.id);
    const m = payments.hydrate(get('SELECT * FROM payment_methods WHERE id = ?', p.method_id));
    if (!m) fail(404, 'This payment method was removed. Contact support.');
    res.json({ payment: { id: p.id, status: p.status, amount_usd: p.amount_usd, kind: p.kind, plan_id: p.plan_id, credits: p.credits, proof_url: p.proof_url, review_note: p.review_note, created_at: p.created_at }, instructions: payments.ADAPTERS.manual.instructions(m, p) });
  });
  r.post('/api/billing/manual/:id/proof', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('proof:' + u.id, 10, 6e4);
    const p = ownManual(u, req.params.id);
    if (!['pending', 'review'].includes(p.status)) fail(400, p.status === 'paid' ? 'This payment is already confirmed.' : 'This payment cannot take a receipt any more. Start a new one.');
    const type = String(req.headers['content-type'] || '').split(';')[0];
    if (!/^image\/(png|jpeg|webp)$/.test(type)) fail(400, 'Upload a screenshot or photo of the receipt (PNG, JPG or WebP).');
    const buf = await readBody(req, 8e6);
    if (!isImage(buf, type)) fail(400, 'That file is not a real PNG, JPG or WebP image.');
    const saved = media.save(buf, type, u.id);
    run("UPDATE payments SET proof_url = ?, status = 'review' WHERE id = ?", saved.path, p.id);
    try { require('../email').queue('ticket_new', config.brand.supportEmail, { ticket_id: 'PAY-' + p.id, ticket_subject: 'Bank transfer proof for payment VA-' + p.id, customer_name: u.name || u.email, customer_email: u.email, category: 'billing', priority: 'normal', phone_line: '', message_html: `Amount: $${Number(p.amount_usd).toFixed(2)}. Review it in Admin → Payments.`, ticket_body: '', admin_url: `${config.appUrl}/admin#/payments`, admin_ticket_url: `${config.appUrl}/admin#/payments` }); } catch {}
    res.json({ ok: true, status: 'review', proof_url: saved.path });
  });

  // ================= AI model wizard =================
  r.get('/api/admin/ai-models/meta', (req, res) => {
    auth.requireStaff(req, 'providers.view');
    res.json(aimodels.meta());
  });
  r.post('/api/admin/ai-models/test', async (req, res) => {
    auth.requireStaff(req, 'providers.manage');
    const b = await parseJson(req);
    res.json(await aimodels.test(b));
  });
  r.post('/api/admin/ai-models', async (req, res) => {
    const s = auth.requireStaff(req, 'providers.manage');
    const b = await parseJson(req);
    if ((b.use?.mode === 'level') && !auth.can(s, 'pricing.manage')) fail(403, 'Choosing the model for a quality level changes prices. That needs "Change prices".');
    const out = aimodels.create(s, b);
    audit(s, 'provider.add', out.provider_id, { wizard: true, kind: b.kind, preset: b.preset, use: b.use?.mode, raised: out.raised });
    res.json(out);
  });

  // ================= AI tools builder =================
  const toolMeta = () => ({
    icons: core.ICONS, field_types: core.FIELD_TYPES, kinds: core.KINDS, outputs: core.OUTPUTS, output_labels: core.OUTPUT_LABELS, statuses: core.STATUSES,
    plans: (pricing().plans || []).map((p) => ({ id: p.id, name: p.name })),
    providers: all('SELECT id, name, kind, adapter, cost_usd, cost_unit, enabled FROM providers WHERE kind IN (\'text\',\'image\',\'video\',\'voice\',\'music\') ORDER BY kind, is_default DESC, priority, id'),
  });
  r.get('/api/admin/features', (req, res) => {
    auth.requireStaff(req, 'features.view');
    res.json({ features: aitools.list(), meta: toolMeta() });
  });
  r.get('/api/admin/features/:id', (req, res) => {
    auth.requireStaff(req, 'features.view');
    res.json({ feature: aitools.adminView(aitools.feature(req.params.id), { history: true }), meta: toolMeta() });
  });
  r.post('/api/admin/features/price', async (req, res) => {
    auth.requireStaff(req, 'features.view');
    const b = await parseJson(req);
    const def = core.normalizeDef(b.def || b, { planIds: (pricing().plans || []).map((p) => p.id) });
    res.json(aitools.price(def));
  });
  r.post('/api/admin/features', async (req, res) => {
    const s = auth.requireStaff(req, 'features.manage');
    const out = aitools.create(s, await parseJson(req));
    audit(s, 'feature.add', out.feature.id, { name: out.feature.name, raised: out.raised });
    res.json(out);
  });
  r.put('/api/admin/features/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'features.manage');
    const out = aitools.save(s, req.params.id, await parseJson(req));
    audit(s, 'feature.edit', out.feature.id, { name: out.feature.name, version: out.feature.draft?.version, raised: out.raised });
    res.json(out);
  });
  r.post('/api/admin/features/:id/status', async (req, res) => {
    const s = auth.requireStaff(req, 'features.manage');
    const b = await parseJson(req);
    const f = aitools.setStatus(req.params.id, b.status);
    audit(s, 'feature.status', f.id, { status: f.status });
    res.json({ feature: f });
  });
  r.post('/api/admin/features/:id/publish', (req, res) => {
    const s = auth.requireStaff(req, 'features.manage');
    const f = aitools.publish(s, req.params.id);
    audit(s, 'feature.publish', f.id, { version: f.live?.version });
    res.json({ feature: f });
  });
  r.post('/api/admin/features/:id/restore', async (req, res) => {
    const s = auth.requireStaff(req, 'features.manage');
    const b = await parseJson(req);
    const out = aitools.restore(s, req.params.id, b.version_id);
    audit(s, 'feature.restore', out.feature.id, { version_id: b.version_id });
    res.json(out);
  });
  r.put('/api/admin/features/:id/testers', async (req, res) => {
    const s = auth.requireStaff(req, 'features.manage');
    const b = await parseJson(req);
    const f = aitools.setAllowlist(req.params.id, b.emails);
    audit(s, 'feature.testers', f.id, { count: f.allowlist.length });
    res.json({ feature: f });
  });
  r.post('/api/admin/features/:id/try', async (req, res) => {
    const s = auth.requireStaff(req, 'features.view');
    rateLimit('try:' + s.id, 20, 6e4);
    const b = await parseJson(req);
    res.json(await aitools.tryIt(req.params.id, b.inputs || {}, b.which === 'live' ? 'live' : 'draft'));
  });
  r.del('/api/admin/features/:id', (req, res) => {
    const s = auth.requireStaff(req, 'features.manage');
    aitools.remove(req.params.id);
    audit(s, 'feature.delete', req.params.id);
    res.json({ ok: true });
  });

  // Customer side: live tools (and testing tools for allow-listed testers), quote and run.
  r.get('/api/tools', (req, res) => {
    const u = auth.requireUser(req);
    res.json({ tools: aitools.customerList(u), balance: credits.balance(u) });
  });
  r.post('/api/tools/:slug/quote', (req, res) => {
    const u = auth.requireUser(req);
    res.json(aitools.quote(u, req.params.slug));
  });
  r.post('/api/tools/:slug/run', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('tool:' + u.id, 20, 6e4);
    if (require('../settings').getSetting('site').maintenance) fail(503, 'Vooads is down for a short update. Try again in a few minutes.');
    const b = await parseJson(req);
    const job = aitools.run(u, req.params.slug, b.inputs && typeof b.inputs === 'object' ? b.inputs : {});
    res.json({ job, balance: credits.balance(get('SELECT * FROM users WHERE id = ?', u.id)) });
  });
};
