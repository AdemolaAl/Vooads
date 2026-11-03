// Admin API. Every route checks a permission (see PERMISSIONS in auth.js). All changes are written to the audit log.
const config = require('../config');
const { get, all, run, tx, J } = require('../db');
const { parseJson, fail, readBody } = require('../lib/http');
const { now, addDays, encrypt, mask, id, clampInt, isEmail, slugify } = require('../lib/util');
const auth = require('../auth');
const credits = require('../credits');
const providers = require('../providers');
const guard = require('../guard');
const payments = require('../payments');
const email = require('../email');
const media = require('../media');
const billing = require('../billing');
const { getSetting, setSetting, pricing, planById, DEFAULTS } = require('../settings');
const team = require('../team');
const roleRules = require('../roles');

const audit = (staff, action, target, detail) => run('INSERT INTO audit_log(staff_id, action, target, detail) VALUES(?,?,?,?)', staff.id, action, String(target ?? ''), JSON.stringify(detail || {}));
// A non-owner may only hand out permissions (and credit limits) they have themselves: no climbing above your own access.
function assertCanGrant(s, permsList, limits = {}) {
  if (auth.can(s, '*')) return;
  const mine = auth.perms(s);
  const extra = permsList.filter((p) => !mine.includes(p));
  if (extra.length) fail(403, 'You can only give permissions your own role has. Ask an owner for: ' + extra.join(', ') + '.');
  const myLimit = auth.roleLimits(s).max_credit_grant;
  if (myLimit !== undefined && myLimit !== null && permsList.includes('users.credits') && (limits.max_credit_grant === undefined || limits.max_credit_grant === null || limits.max_credit_grant === '' || Number(limits.max_credit_grant) > Number(myLimit)))
    fail(403, `Set a credit limit of ${myLimit} or less (your own limit).`);
  const lp = roleRules.limitsProblem(auth.roleLimits(s), limits || {}, permsList);
  if (lp) fail(403, lp);
}
const staffView = (s) => ({ id: s.id, email: s.email, name: s.name, role_id: s.role_id, status: s.status, created_at: s.created_at, last_login_at: s.last_login_at });

function providerView(p) {
  const h = providers.hydrate(p);
  return { id: h.id, name: h.name, kind: h.kind, adapter: h.adapter, model: h.model, config: h.config, cost_usd: h.cost_usd, cost_unit: h.cost_unit, enabled: !!h.enabled, is_default: !!h.is_default, priority: h.priority, notes: h.notes, key_set: !!h.apiKey, key_hint: mask(h.apiKey), key_shared: !h.apiKey && providers.SHARED_KEY.includes(h.adapter) && !!providers.sharedKey(h.adapter) };
}
// Every method can state its real fees; the profit guard uses the worst switched-on method (guard.feeFor).
const FEE_FIELDS = [
  { key: 'fee_pct', label: 'Fee % per payment', help: 'What this provider keeps from each payment, in percent. Empty = the default in Pricing → payment fees. Used by the profit guard.', type: 'number' },
  { key: 'fee_fixed_usd', label: 'Fixed fee per payment (USD)', help: 'Fixed amount per payment, e.g. 0.30. Empty = the default.', type: 'number' },
  { key: 'customer_fee_pct', label: 'Customer fee %', help: 'Built into the price customers see for this method (never shown as a separate fee). Bachs 4%, Gatevoo 0%, others 0% by default. Credits stay the base price.', type: 'number' },
];
function methodView(m) {
  const h = payments.hydrate(m);
  const ad = payments.ADAPTERS[h.adapter];
  const fee = require('../guard').feeFor(h.adapter, h.config);
  return { warnings: ad?.warnings ? ad.warnings(h) : [], notes: ad?.notes ? ad.notes(h) : [], fee, id: h.id, name: h.name, adapter: h.adapter, public_key: h.public_key, config: h.config, countries: h.countries, enabled: !!h.enabled, sort: h.sort, secret_set: !!h.secret, secret_hint: mask(h.secret), webhook_set: !!h.webhookSecret, webhook_url: h.adapter === 'custom' ? `${config.appUrl}/api/webhooks/custom/${h.id}` : `${config.appUrl}/api/webhooks/${h.adapter}` };
}

// Rough AI provider spend from finished, non-demo jobs, using provider_cost_usd from the pricing settings.
function estAiCost(since, c) {
  let t = 0;
  for (const j of all("SELECT type, input, json_extract(state, '$.quote.provider_cost_usd') AS pc FROM jobs WHERE status = 'done' AND demo = 0 AND created_at >= ?", since)) {
    if (Number(j.pc) > 0) { t += Number(j.pc); continue; } // exact cost saved by the profit guard at job time
    const i = J(j.input, {}), d = Number(i.duration) || 15;
    if (j.type === 'ugc') t += d * (c.ugc_video_per_second || 0) + (d * 15 / 1000) * (c.voice_per_1k_chars || 0) + (i.write_script ? c.claude_script || 0 : 0);
    else if (j.type === 'video') t += (Number(i.duration) || 5) * (c.video_per_second || 0);
    else if (j.type === 'image') t += (Number(i.count) || 1) * 3 * (c.image || 0);
    else t += c.claude_script || 0;
  }
  return Math.round(t * 100) / 100;
}

module.exports = function mount(r) {
  // ---------- Staff login (email code) ----------
  r.post('/api/admin/auth/code', async (req, res) => {
    const b = await parseJson(req);
    const mail = String(b.email || '').trim().toLowerCase();
    const s = get("SELECT * FROM staff WHERE email = ? AND status = 'active'", mail);
    const isOwner = (config.ownerEmail && mail === config.ownerEmail) || (b.setup && require('../integrations').setupValid(b.setup));
    // Same answer either way so nobody can probe which emails are staff.
    if (!s && !isOwner) { await new Promise((x) => setTimeout(x, 400)); return res.json({ ok: true }); }
    const { code } = auth.issueCode(mail, 'staff', req.ip);
    await email.sendNow('login_code', mail, { code }).catch((e) => fail(502, 'Email failed: ' + e.message));
    res.json({ ok: true, ...(!config.isProd && !config.email.resendKey ? { dev_code: code } : {}) });
  });
  r.post('/api/admin/auth/verify', async (req, res) => {
    const b = await parseJson(req);
    const mail = auth.checkCode(b.email, 'staff', b.code, req.ip);
    let s = get('SELECT * FROM staff WHERE email = ?', mail);
    const viaSetup = !s && b.setup && require('../integrations').setupValid(b.setup);
    if (!s && ((config.ownerEmail && mail === config.ownerEmail) || viaSetup)) {
      const owner = get("SELECT id FROM roles WHERE name = 'Owner'");
      run("INSERT INTO staff(email, name, role_id, status) VALUES(?, 'Owner', ?, 'active')", mail, owner.id);
      s = get('SELECT * FROM staff WHERE email = ?', mail);
      if (viaSetup) require('../integrations').setupDone();
    }
    if (!s || s.status !== 'active') fail(403, 'This email does not have admin access.');
    run('UPDATE staff SET last_login_at = ? WHERE id = ?', now(), s.id);
    auth.newSession(res, { staffId: s.id, remember: b.remember !== false, req });
    res.json({ ok: true });
  });
  r.post('/api/admin/auth/logout', (req, res) => { auth.endSession(req, res, true); res.json({ ok: true }); });
  r.post('/api/admin/auth/logout-all', (req, res) => {
    const s = auth.requireStaff(req);
    const ended = auth.endAllSessions(req, res, { staffId: s.id });
    audit(s, 'staff.logout_all', s.id, { sessions: ended });
    res.json({ ok: true, ended });
  });
  r.get('/api/admin/invite/:token', (req, res) => {
    const s = get("SELECT * FROM staff WHERE invite_token = ? AND status = 'invited' AND created_at >= datetime('now', '-14 days')", String(req.params.token));
    if (!s) fail(404, 'This invite link is no longer valid. Ask for a new one.');
    const role = get('SELECT name FROM roles WHERE id = ?', s.role_id);
    res.json({ email: s.email, role: role?.name });
  });
  r.post('/api/admin/invite/:token', async (req, res) => {
    const b = await parseJson(req);
    const s = get("SELECT * FROM staff WHERE invite_token = ? AND status = 'invited' AND created_at >= datetime('now', '-14 days')", String(req.params.token));
    if (!s) fail(404, 'This invite link is no longer valid.');
    run("UPDATE staff SET name = ?, status = 'active', invite_token = NULL WHERE id = ?", String(b.name || '').slice(0, 60) || s.email, s.id);
    res.json({ ok: true, email: s.email });
  });
  r.get('/api/admin/me', (req, res) => {
    const s = auth.currentStaff(req);
    if (!s) return res.json({ staff: null });
    const role = get('SELECT * FROM roles WHERE id = ?', s.role_id);
    res.json({ staff: staffView(s), role: role && { name: role.name, permissions: J(role.permissions, []), limits: J(role.limits, {}) }, all_permissions: auth.PERMISSIONS, demo: { text: providers.isDemo('text'), image: providers.isDemo('image'), video: providers.isDemo('video'), ugc: providers.isDemo('ugc'), voice: providers.isDemo('voice') }, email_live: !!config.email.resendKey });
  });

  // ---------- Overview ----------
  r.get('/api/admin/overview', (req, res) => {
    const viewer = auth.requireStaff(req, 'dashboard.view');
    // Money (revenue, MRR, AI cost, payment amounts) only for roles with users.finance.
    if (!auth.can(viewer, 'users.finance')) {
      const json = res.json;
      res.json = (d, st) => json.call(res, d && d.days ? { ...d, revenue_30d: null, mrr: null, est_ai_cost_30d: null, money_hidden: true, days: d.days.map((x) => ({ ...x, revenue: null })), recent_payments: (d.recent_payments || []).map((p) => ({ ...p, amount_usd: null })) } : d, st);
    }
    const d30 = addDays(now(), -30);
    const sum = (sql, ...p) => get(sql, ...p)?.t || 0;
    const days = [];
    for (let k = 13; k >= 0; k--) {
      const day = addDays(now(), -k).slice(0, 10);
      days.push({
        day,
        signups: sum("SELECT COUNT(*) AS t FROM users WHERE substr(created_at,1,10) = ?", day),
        revenue: Math.round(sum("SELECT COALESCE(SUM(amount_usd),0) AS t FROM payments WHERE status = 'paid' AND substr(paid_at,1,10) = ?", day) * 100) / 100,
        jobs: sum("SELECT COUNT(*) AS t FROM jobs WHERE substr(created_at,1,10) = ?", day),
      });
    }
    const p = pricing();
    let mrr = 0;
    for (const u of all("SELECT plan_id, plan_period FROM users WHERE plan_id IS NOT NULL AND plan_expires_at > ?", now())) {
      const pl = planById(u.plan_id); if (pl) mrr += u.plan_period === 'year' ? pl.price_year / 12 : pl.price_month;
    }
    const usedCredits = -sum("SELECT COALESCE(SUM(delta),0) AS t FROM credit_ledger WHERE delta < 0 AND reason LIKE '%job' AND created_at >= ?", d30.replace('T', ' ').slice(0, 19));
    res.json({
      users: sum('SELECT COUNT(*) AS t FROM users'),
      paying: sum("SELECT COUNT(*) AS t FROM users WHERE plan_id IS NOT NULL AND plan_expires_at > ?", now()),
      revenue_30d: Math.round(sum("SELECT COALESCE(SUM(amount_usd),0) AS t FROM payments WHERE status = 'paid' AND paid_at >= ?", d30) * 100) / 100,
      mrr: Math.round(mrr),
      jobs_30d: sum("SELECT COUNT(*) AS t FROM jobs WHERE created_at >= ?", d30.replace('T', ' ').slice(0, 19)),
      failed_30d: sum("SELECT COUNT(*) AS t FROM jobs WHERE status = 'failed' AND created_at >= ?", d30.replace('T', ' ').slice(0, 19)),
      est_ai_cost_30d: estAiCost(d30.replace('T', ' ').slice(0, 19), p.provider_cost_usd || {}),
      credits_used_30d: usedCredits,
      open_support: sum("SELECT COUNT(*) AS t FROM tickets WHERE status = 'open'"),
      open_tickets: sum("SELECT COUNT(*) AS t FROM tickets WHERE status = 'open'"),
      overdue_tickets: sum("SELECT COUNT(*) AS t FROM tickets WHERE status = 'open' AND sla_due_at < ?", now()),
      days,
      recent_payments: all('SELECT p.id, p.kind, p.plan_id, p.amount_usd, p.status, p.adapter, p.created_at, u.email FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 8'),
      demo: { text: providers.isDemo('text'), image: providers.isDemo('image'), video: providers.isDemo('video'), ugc: providers.isDemo('ugc'), voice: providers.isDemo('voice') },
      payments_live: !!get('SELECT 1 FROM payment_methods WHERE enabled = 1'),
      email_live: !!config.email.resendKey,
    });
  });

  // ---------- Customers ----------
  r.get('/api/admin/users', (req, res) => {
    auth.requireStaff(req, 'users.view');
    const q = '%' + String(req.query.q || '').toLowerCase() + '%';
    const status = req.query.status || '';
    const rows = all(`SELECT id, email, name, country, plan_id, plan_expires_at, plan_credits, topup_credits, trial_credits, status, created_at, last_seen_at
      FROM users WHERE (lower(email) LIKE ? OR lower(COALESCE(name,'')) LIKE ?) ${status ? 'AND status = ?' : ''} ORDER BY id DESC LIMIT ? OFFSET ?`,
      ...(status ? [q, q, status] : [q, q]), clampInt(req.query.limit, 1, 200, 50), clampInt(req.query.offset, 0, 1e9, 0));
    res.json({ users: rows.map((u) => ({ ...u, plan_active: !!(u.plan_id && u.plan_expires_at > now()) })), total: get(`SELECT COUNT(*) AS c FROM users WHERE (lower(email) LIKE ? OR lower(COALESCE(name,'')) LIKE ?) ${status ? 'AND status = ?' : ''}`, ...(status ? [q, q, status] : [q, q])).c });
  });
  r.get('/api/admin/users/:id', (req, res) => {
    const s = auth.requireStaff(req, 'users.view');
    const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'Customer not found');
    res.json({
      user: { ...u, brand: J(u.brand, null), onboarding: J(u.onboarding, {}), flags: J(u.flags, {}), balance: credits.balance(u) },
      ledger: credits.ledger(u.id, 50),
      jobs: all('SELECT id, type, status, credits, demo, error, created_at FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id),
      payments: auth.can(s, 'payments.view') ? all('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id) : [],
      referred: all('SELECT id, email, created_at FROM users WHERE referred_by = ?', u.ref_code),
    });
  });
  r.put('/api/admin/users/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'users.edit');
    const b = await parseJson(req);
    const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'Customer not found');
    if (b.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', String(b.name).slice(0, 60), u.id);
    if (b.country !== undefined) run('UPDATE users SET country = ? WHERE id = ?', String(b.country).slice(0, 2).toUpperCase(), u.id);
    if (b.plan_id !== undefined) {
      if (!b.plan_id) run('UPDATE users SET plan_id = NULL, plan_expires_at = NULL, plan_credits = 0, auto_renew = 0 WHERE id = ?', u.id);
      else {
        const plan = planById(b.plan_id); if (!plan) fail(400, 'Unknown plan');
        billing.activatePlan(u.id, plan, b.period === 'year' ? 'year' : 'month', { ref: 'staff:' + s.id });
      }
    }
    audit(s, 'user.edit', u.id, b);
    res.json({ ok: true });
  });
  r.post('/api/admin/users/:id/credits', async (req, res) => {
    const s = auth.requireStaff(req, 'users.credits');
    const b = await parseJson(req);
    const amount = Math.round(Number(b.amount));
    if (!amount) fail(400, 'Enter how many credits to add or remove.');
    const limit = auth.roleLimits(s).max_credit_grant;
    if (!auth.can(s, '*') && limit !== undefined && Math.abs(amount) > Number(limit)) fail(403, `Your role can give at most ${limit} credits at a time.`);
    if (!String(b.reason || '').trim()) fail(400, 'Add a reason. It is saved in the activity log.');
    team.assertGrant(s, amount);
    const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'Customer not found');
    // Roles limited to assigned tickets may only credit customers whose ticket is assigned to them.
    if (require('../support').scopeOf(s) === 'assigned' && !get('SELECT 1 FROM tickets WHERE user_id = ? AND assignee_staff_id = ?', u.id, s.id)) fail(403, 'You can only give credits to customers whose ticket is assigned to you.');
    const applied = credits.grant(u.id, amount, b.bucket || 'topup', 'Staff: ' + String(b.reason).slice(0, 120), 'staff:' + s.id, s.id);
    audit(s, 'user.credits', u.id, { amount: applied, bucket: b.bucket || 'topup', reason: b.reason });
    if (applied > 0 && b.notify !== false) email.hooks.creditsAdded(u.id, applied, ''); // the staff reason stays internal
    res.json({ ok: true, applied, balance: credits.balance(u) });
  });
  r.post('/api/admin/users/:id/status', async (req, res) => {
    const s = auth.requireStaff(req, 'users.ban');
    const b = await parseJson(req);
    if (!['active', 'suspended', 'banned'].includes(b.status)) fail(400, 'Pick active, suspended or banned.');
    const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'Customer not found');
    const reason = String(b.reason || '').slice(0, 300);
    if (b.status !== 'active' && !reason) fail(400, 'Add a reason. The customer sees it in the email.');
    tx(() => {
      run('UPDATE users SET status = ?, ban_reason = ? WHERE id = ?', b.status, b.status === 'active' ? null : reason, u.id);
      if (b.status === 'banned') {
        // Banned accounts lose their credits, as the Terms say. Recorded in the ledger.
        const bal = credits.balance(u);
        if (bal.total) run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, staff_id) VALUES(?,?,?,?,?)', u.id, -bal.total, 'all', 'Forfeited on ban', s.id);
        run('UPDATE users SET trial_credits = 0, plan_credits = 0, topup_credits = 0, auto_renew = 0 WHERE id = ?', u.id);
        run('DELETE FROM sessions WHERE user_id = ?', u.id);
      }
    });
    if (b.status === 'banned') email.queue('account_banned', u.email, { reason }, { userId: u.id });
    // A banned account must not keep paying: stop the card subscription too (best effort, logged on failure).
    if (b.status === 'banned' && u.stripe_sub) {
      const m = payments.byAdapterAny('stripe');
      if (m) payments.ADAPTERS.stripe.cancel(m, u.stripe_sub).catch((e) => console.warn('[ban] stripe cancel failed', u.id, e.message));
    }
    if (b.status === 'suspended' && b.notify !== false) email.queue('account_warning', u.email, { reason }, { userId: u.id });
    audit(s, 'user.status', u.id, { status: b.status, reason });
    res.json({ ok: true });
  });

  // ---------- Payments ----------
  r.get('/api/admin/payments', (req, res) => {
    auth.requireStaff(req, 'payments.view');
    res.json({ payments: all('SELECT p.*, u.email FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT ?', clampInt(req.query.limit, 1, 500, 100)).map((p) => ({ ...p, raw: undefined })) });
  });
  // Bachs card auto-renew: every subscription with its status, next charge, failures and price flags.
  r.get('/api/admin/bachs/subscriptions', (req, res) => {
    auth.requireStaff(req, 'payments.view');
    const subs = require('../payments/bachs-subs');
    const m = payments.byAdapterAny('bachs');
    res.json({ enabled: !!(m && subs.enabled(m)), unavailable: (m && m.config && m.config.recurring_unavailable) || null, subscriptions: subs.adminList({ limit: req.query.limit }),
      flagged: all("SELECT id, user_id, amount_local, currency, review_flag, paid_at FROM payments WHERE adapter = 'bachs' AND review_flag IS NOT NULL ORDER BY id DESC LIMIT 50") });
  });
  r.post('/api/admin/payments/:id/refund', async (req, res) => {
    const s = auth.requireStaff(req, 'payments.refund');
    const b = await parseJson(req);
    const p = get('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
    if (!p || p.status !== 'paid') fail(400, 'Only paid payments can be marked refunded.');
    team.assertRefund(s, p.amount_usd);
    // Ends the plan this payment pays for (or takes back the pack's unused credits, never below zero; the rest is recorded as
    // the shortfall) and tells VooSquare (refund event: commission stays, as its contract says). server/voomoney.js
    const r = require('../voomoney').reverse(p.id, { kind: 'refund', staffId: s.id });
    if (!r.ok) fail(400, 'Only paid payments can be marked refunded.');
    audit(s, 'payment.refund', p.id, { ...b, removed: r.removed, shortfall: r.shortfall, plan_ended: r.planEnded });
    res.json({ ok: true, removed: r.removed, shortfall: r.shortfall, plan_ended: !!r.planEnded, note: 'Marked refunded here. Send the money back in the payment provider\'s own dashboard.' + (r.planEnded ? ' The plan it paid for has ended.' : '') + (r.shortfall ? ` ${r.shortfall} of its credits were already used.` : '') });
  });
  // A chargeback the provider reported outside a webhook (or one we only learn about by email): same as a refund, and
  // VooSquare reverses the affiliate commission on it.
  r.post('/api/admin/payments/:id/chargeback', async (req, res) => {
    const s = auth.requireStaff(req, 'payments.refund');
    const b = await parseJson(req);
    const p = get('SELECT * FROM payments WHERE id = ?', Number(req.params.id));
    if (!p || p.status !== 'paid') fail(400, 'Only paid payments can be marked charged back.');
    const r = require('../voomoney').reverse(p.id, { kind: 'chargeback', staffId: s.id, ref: b.ref });
    if (!r.ok) fail(400, 'Only paid payments can be marked charged back.');
    audit(s, 'payment.chargeback', p.id, { ref: b.ref || null, removed: r.removed, shortfall: r.shortfall });
    res.json({ ok: true, removed: r.removed, shortfall: r.shortfall, plan_ended: !!r.planEnded });
  });
  r.get('/api/admin/payment-methods', (req, res) => {
    auth.requireStaff(req, 'payments.view');
    res.json({ methods: all('SELECT * FROM payment_methods ORDER BY sort, id').map(methodView), adapters: Object.fromEntries(Object.entries(payments.ADAPTERS).map(([k, a]) => [k, { label: a.label, fields: a.fields, recurring: !!a.recurring, config_fields: [...(a.config_fields || []), ...FEE_FIELDS], multiple: !!a.multiple, help: a.help || '' }])) });
  });
  r.post('/api/admin/payment-methods', async (req, res) => {
    const s = auth.requireStaff(req, 'payments.manage');
    const b = await parseJson(req);
    if (!payments.ADAPTERS[b.adapter]) fail(400, 'Pick a payment provider.');
    const fee = require('../guard').feeFor(b.adapter, {}); // pre-filled so the profit guard's fee buffer works with no extra step
    const info = run('INSERT INTO payment_methods(name, adapter, enabled, sort, countries, config) VALUES(?,?,0,?,?,?)', String(b.name || payments.ADAPTERS[b.adapter].label).slice(0, 60), b.adapter, 100, JSON.stringify(payments.ADAPTERS[b.adapter].defaultCountries || []), JSON.stringify({ fee_pct: fee.pct, fee_fixed_usd: fee.fixed_usd, customer_fee_pct: require('../surcharge').defaultFor(b.adapter) }));
    audit(s, 'payment_method.add', info.lastInsertRowid, { adapter: b.adapter });
    res.json({ method: methodView(get('SELECT * FROM payment_methods WHERE id = ?', Number(info.lastInsertRowid))) });
  });
  r.put('/api/admin/payment-methods/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'payments.manage');
    const b = await parseJson(req);
    const m = get('SELECT * FROM payment_methods WHERE id = ?', Number(req.params.id));
    if (!m) fail(404, 'Not found');
    const f = {};
    if (b.name !== undefined) f.name = String(b.name).slice(0, 60);
    if (b.secret) f.secret_enc = encrypt(String(b.secret).trim());
    if (b.webhook_secret) f.webhook_secret_enc = encrypt(String(b.webhook_secret).trim());
    if (b.public_key !== undefined) f.public_key = String(b.public_key).trim();
    if (b.config !== undefined) {
      const prev = J(m.config, {});
      const cfg = { ...(b.config && typeof b.config === 'object' ? b.config : {}) };
      if (m.adapter === 'bachs' && cfg.max_usd !== undefined && cfg.max_usd !== '' && cfg.max_usd !== null && !(Number(cfg.max_usd) > 0 && Number(cfg.max_usd) <= 1e7)) fail(400, 'Bachs max per payment must be a US-dollar amount above 0 (default 5000).');
      // The naira rate's age drives the stale-rate warning: stamp it when the rate changes, keep the old stamp otherwise.
      if (m.adapter === 'bachs') cfg.ngn_rate_updated_at = Number(cfg.ngn_rate) > 0 && Number(cfg.ngn_rate) !== Number(prev.ngn_rate) ? new Date().toISOString() : prev.ngn_rate_updated_at || null; if (m.adapter === 'bachs') { for (const k of ['fx_paused', 'fx_pending_lower', 'fx_feed_rate', 'fx_checked_at', 'fx_last_error']) if (cfg[k] === undefined && prev[k] !== undefined) cfg[k] = prev[k]; if (cfg.fx_buffer_pct !== undefined && cfg.fx_buffer_pct !== '' && !(Number(cfg.fx_buffer_pct) >= 0 && Number(cfg.fx_buffer_pct) <= 50)) fail(400, 'FX buffer must be between 0 and 50%.'); } if (m.adapter === 'bachs' && Number(cfg.ngn_rate) > 0 && Number(cfg.ngn_rate) !== Number(prev.ngn_rate)) { delete cfg.fx_paused; delete cfg.fx_pending_lower; }
      if (cfg.customer_fee_pct !== undefined && cfg.customer_fee_pct !== '' && !(Number(cfg.customer_fee_pct) >= 0 && Number(cfg.customer_fee_pct) <= 20)) fail(400, 'Customer fee % must be between 0 and 20.'); for (const k of ['fee_pct', 'fee_fixed_usd']) if (cfg[k] !== undefined && cfg[k] !== '' && cfg[k] !== null && !(Number(cfg[k]) >= 0 && Number(cfg[k]) <= (k === 'fee_pct' ? 50 : 20))) fail(400, k === 'fee_pct' ? 'Fee % must be between 0 and 50.' : 'The fixed fee must be between 0 and 20 US dollars.');
      f.config = JSON.stringify(cfg);
    }
    if (b.countries !== undefined) f.countries = JSON.stringify((Array.isArray(b.countries) ? b.countries : String(b.countries).split(',')).map((c) => String(c).trim().toUpperCase()).filter(Boolean));
    if (b.enabled !== undefined) f.enabled = b.enabled ? 1 : 0;
    if (b.sort !== undefined) f.sort = clampInt(b.sort, 0, 1000, 100);
    if (f.countries && JSON.parse(f.countries).some((c) => c !== '*' && !/^[A-Z]{2}$/.test(c))) fail(400, 'Countries are 2-letter codes, like NG, KE, GH (or * for everyone).');
    // A method that must not be shown yet (Bachs without both keys, or with a sandbox key on the live site) cannot be switched on.
    const ad = payments.ADAPTERS[m.adapter];
    if (ad?.hidden && (f.enabled === 1 || (m.enabled && (f.secret_enc || f.webhook_secret_enc)))) {
      const why = ad.hidden(payments.hydrate({ ...m, ...f }));
      if (why && f.enabled === 1) fail(400, why);
      if (why) f.enabled = 0;
    }
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE payment_methods SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), m.id);
    audit(s, 'payment_method.edit', m.id, { ...b, secret: b.secret ? '(changed)' : undefined, webhook_secret: b.webhook_secret ? '(changed)' : undefined });
    res.json({ method: methodView(get('SELECT * FROM payment_methods WHERE id = ?', m.id)) });
  });
  r.del('/api/admin/payment-methods/:id', (req, res) => {
    const s = auth.requireStaff(req, 'payments.manage');
    run('DELETE FROM payment_methods WHERE id = ?', Number(req.params.id));
    audit(s, 'payment_method.delete', req.params.id);
    res.json({ ok: true });
  });

  // ---------- Website showcase (owners only): "Make showcase pack" and which videos go on the site ----------
  const showcase = require('../showcase');
  const ownerOnly = (req) => { const s = auth.requireStaff(req, 'settings.manage'); if (!auth.can(s, '*')) fail(403, 'Only an owner can do this.'); return s; };
  r.get('/api/admin/showcase', (req, res) => { ownerOnly(req); res.json({ ...showcase.list(), estimate: showcase.estimate(), presets: showcase.PRESETS.map((p) => ({ id: p.id, title: p.title, style: p.style, audience: p.audience })) }); });
  r.post('/api/admin/showcase/pack', async (req, res) => {
    const s = ownerOnly(req);
    const b = await parseJson(req);
    const out = showcase.makePack(s, { confirm: b.confirm === true, only: Array.isArray(b.only) ? b.only.map(String) : null });
    audit(s, 'showcase.pack', out.made.map((x) => x.job_id).join(','), { made: out.made.length, errors: out.errors.length });
    res.json(out);
  });
  r.put('/api/admin/showcase/selected', async (req, res) => {
    const s = ownerOnly(req);
    const b = await parseJson(req);
    const out = showcase.select(b.ids);
    audit(s, 'showcase.select', out.selected.join(','), {});
    res.json(out);
  });

  // ---------- AI providers ----------
  r.get('/api/admin/providers', (req, res) => {
    auth.requireStaff(req, 'providers.view');
    res.json({ providers: all('SELECT * FROM providers ORDER BY kind, is_default DESC, priority, id').map(providerView), kinds: providers.KINDS, capabilities: providers.CAPABILITIES });
  });
  r.post('/api/admin/providers', async (req, res) => {
    const s = auth.requireStaff(req, 'providers.manage');
    const b = await parseJson(req);
    if (!providers.KINDS[b.kind]) fail(400, 'Pick what this provider does.');
    if (!providers.CAPABILITIES[b.adapter]?.includes(b.kind)) fail(400, 'That provider type cannot do this job.');
    const info = run('INSERT INTO providers(name, kind, adapter, model, api_key_enc, config, cost_usd, cost_unit, enabled, priority, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      String(b.name || b.adapter).slice(0, 60), b.kind, b.adapter, String(b.model || '').trim(), b.api_key ? encrypt(String(b.api_key).trim()) : '',
      JSON.stringify(b.config || {}), Number(b.cost_usd) || 0, String(b.cost_unit || ''), b.enabled === false ? 0 : 1, clampInt(b.priority, 1, 1000, 100), String(b.notes || ''));
    audit(s, 'provider.add', info.lastInsertRowid, { name: b.name, kind: b.kind, adapter: b.adapter });
    res.json({ provider: providerView(get('SELECT * FROM providers WHERE id = ?', Number(info.lastInsertRowid))) });
  });
  r.put('/api/admin/providers/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'providers.manage');
    const b = await parseJson(req);
    const p = get('SELECT * FROM providers WHERE id = ?', Number(req.params.id));
    if (!p) fail(404, 'Not found');
    const f = {};
    if (b.name !== undefined) f.name = String(b.name).slice(0, 60);
    if (b.model !== undefined) f.model = String(b.model).trim();
    if (b.api_key) f.api_key_enc = encrypt(String(b.api_key).trim());
    if (b.api_key && b.enabled === undefined && !p.enabled) f.enabled = 1; // slots seeded switched off (stock, music) turn on when a key is added
    if (b.clear_key) f.api_key_enc = '';
    if (b.config !== undefined) {
      const prev = J(m.config, {});
      const cfg = { ...(b.config && typeof b.config === 'object' ? b.config : {}) };
      // The naira rate's age drives the stale-rate warning: stamp it when the rate changes, keep the old stamp otherwise.
      if (m.adapter === 'bachs') cfg.ngn_rate_updated_at = Number(cfg.ngn_rate) > 0 && Number(cfg.ngn_rate) !== Number(prev.ngn_rate) ? new Date().toISOString() : prev.ngn_rate_updated_at || null; if (m.adapter === 'bachs') { for (const k of ['fx_paused', 'fx_pending_lower', 'fx_feed_rate', 'fx_checked_at', 'fx_last_error']) if (cfg[k] === undefined && prev[k] !== undefined) cfg[k] = prev[k]; if (cfg.fx_buffer_pct !== undefined && cfg.fx_buffer_pct !== '' && !(Number(cfg.fx_buffer_pct) >= 0 && Number(cfg.fx_buffer_pct) <= 50)) fail(400, 'FX buffer must be between 0 and 50%.'); } if (m.adapter === 'bachs' && Number(cfg.ngn_rate) > 0 && Number(cfg.ngn_rate) !== Number(prev.ngn_rate)) { delete cfg.fx_paused; delete cfg.fx_pending_lower; }
      if (cfg.customer_fee_pct !== undefined && cfg.customer_fee_pct !== '' && !(Number(cfg.customer_fee_pct) >= 0 && Number(cfg.customer_fee_pct) <= 20)) fail(400, 'Customer fee % must be between 0 and 20.'); for (const k of ['fee_pct', 'fee_fixed_usd']) if (cfg[k] !== undefined && cfg[k] !== '' && cfg[k] !== null && !(Number(cfg[k]) >= 0 && Number(cfg[k]) <= (k === 'fee_pct' ? 50 : 20))) fail(400, k === 'fee_pct' ? 'Fee % must be between 0 and 50.' : 'The fixed fee must be between 0 and 20 US dollars.');
      f.config = JSON.stringify(cfg);
    }
    if (b.cost_usd !== undefined) f.cost_usd = Number(b.cost_usd) || 0;
    if (b.cost_unit !== undefined) f.cost_unit = String(b.cost_unit);
    if (b.enabled !== undefined) f.enabled = b.enabled ? 1 : 0;
    if (b.priority !== undefined) f.priority = clampInt(b.priority, 1, 1000, 100);
    if (b.notes !== undefined) f.notes = String(b.notes);
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE providers SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), p.id);
    if (b.is_default) tx(() => { run('UPDATE providers SET is_default = 0 WHERE kind = ?', p.kind); run('UPDATE providers SET is_default = 1, enabled = 1 WHERE id = ?', p.id); });
    audit(s, 'provider.edit', p.id, { ...b, api_key: b.api_key ? '(changed)' : undefined });
    res.json({ provider: providerView(get('SELECT * FROM providers WHERE id = ?', p.id)) });
  });
  r.post('/api/admin/providers/:id/test', async (req, res) => {
    auth.requireStaff(req, 'providers.manage');
    const p = providers.byId(Number(req.params.id));
    if (!p) fail(404, 'Not found');
    if (!p.apiKey && !['mock', 'http', 'library'].includes(p.adapter)) return res.json({ ok: false, note: 'Add the API key first.' });
    const integ = require('../integrations');
    let out;
    try { out = await providers.test(p); } catch (e) { out = { ok: false, note: e.message.slice(0, 200) }; }
    // Text providers answer a tiny prompt when tested: that call is on the AI bill too (other kinds only check the key).
    if (p.kind === 'text' && ['anthropic', 'openai'].includes(p.adapter)) { try { require('../llmbill').record({ feature: 'admin_test:text', provider: p, input: { prompt: 'Reply with the word OK.' }, text: String(out.note || 'OK') }); } catch {} }
    integ.record('provider:' + p.id, out);
    res.json(out);
  });
  r.del('/api/admin/providers/:id', (req, res) => {
    const s = auth.requireStaff(req, 'providers.manage');
    run('DELETE FROM providers WHERE id = ?', Number(req.params.id));
    audit(s, 'provider.delete', req.params.id);
    res.json({ ok: true });
  });

  // ---------- Pricing & discounts ----------
  r.get('/api/admin/pricing', (req, res) => {
    auth.requireStaff(req, 'pricing.view');
    res.json({ pricing: pricing(), defaults: DEFAULTS.pricing, discounts: all('SELECT * FROM discounts ORDER BY rowid DESC LIMIT 200') });
  });
  r.put('/api/admin/pricing', async (req, res) => {
    const s = auth.requireStaff(req, 'pricing.manage');
    const b = await parseJson(req);
    const p = b.pricing;
    if (!p || !Array.isArray(p.plans) || !p.plans.length || !Array.isArray(p.topups) || !p.costs) fail(400, 'Pricing needs plans, top-ups and credit costs.');
    for (const pl of p.plans) {
      if (!pl.id || !pl.name || !(pl.price_month > 0) || !(pl.credits_month > 0)) fail(400, `Plan "${pl.name || pl.id}" needs a name, monthly price and credits.`);
      pl.price_year = Number(pl.price_year) || pl.price_month * 10;
    }
    const ids = p.plans.map((pl) => pl.id);
    if (new Set(ids).size !== ids.length) fail(400, 'Each plan needs its own ID.');
    for (const old of pricing().plans) {
      if (!ids.includes(old.id) && get('SELECT 1 FROM users WHERE plan_id = ? AND plan_expires_at > ?', old.id, now())) fail(400, `Plan "${old.name}" has customers on it, so it cannot be removed or have its ID changed.`);
    }
    for (const pl of p.plans) if (!(Number(pl.max_ugc_seconds) >= 5) || !(Number(pl.max_video_seconds) >= 5)) fail(400, `Plan "${pl.name}" needs max video lengths of at least 5 seconds.`);
    const tids = p.topups.map((t) => t.id);
    if (new Set(tids).size !== tids.length) fail(400, 'Each top-up needs its own ID.');
    for (const t of p.topups) if (!t.id || !(Number(t.price) > 0) || !(Number(t.credits) > 0)) fail(400, 'Each top-up needs an ID, a price above 0 and credits above 0.');
    for (const k of ['ugc_video_per_second', 'video_per_second', 'image_3_sizes', 'hook_pack_20', 'script']) if (!(Number(p.costs[k]) > 0)) fail(400, `Credit cost "${k}" must be above 0.`);
    // Quality levels (SPEC §13): ids, prices and plans must make sense; then the profit guard raises any level below the minimum margin.
    const planIdSet = new Set(ids);
    for (const t of Array.isArray(p.video_types) ? p.video_types : []) {
      if (t.levels === undefined) continue;
      if (!Array.isArray(t.levels)) fail(400, `Quality levels of "${t.name || t.id}" must be a list.`);
      const seen = new Set();
      for (const l of t.levels) {
        if (!['standard', 'pro', 'ultra'].includes(l.id) || seen.has(l.id)) fail(400, `"${t.name || t.id}" has a quality level that is not standard, pro or ultra, or is listed twice.`);
        seen.add(l.id);
        if (!(Number(l.credits_per_unit) > 0)) fail(400, `Set the credits for ${l.name || l.id} on "${t.name || t.id}".`);
        if (l.min_plan && !planIdSet.has(l.min_plan)) fail(400, `${l.name || l.id} on "${t.name || t.id}" needs a plan that exists.`);
      }
    }
    setSetting('pricing', p);
    const raised = guard.raiseLevels(p);
    if (raised.length) setSetting('pricing', p);
    audit(s, 'pricing.edit', 'pricing', raised.length ? { raised } : {});
    res.json({ ok: true, pricing: p, raised });
  });
  r.post('/api/admin/discounts', async (req, res) => {
    const s = auth.requireStaff(req, 'pricing.manage');
    const b = await parseJson(req);
    const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const pct = clampInt(b.percent, 1, 50, 0);
    if (!code || !pct) fail(400, 'Add a code and a percent between 1 and 50. The profit guard raises job prices while a big code is active.');
    run(`INSERT INTO discounts(code, percent, applies_to, expires_at, max_uses, active) VALUES(?,?,?,?,?,1)
      ON CONFLICT(code) DO UPDATE SET percent = excluded.percent, applies_to = excluded.applies_to, expires_at = excluded.expires_at, max_uses = excluded.max_uses, active = 1`, code, pct, b.applies_to === 'any' ? 'any' : 'first_month', b.expires_at || null, b.max_uses ? clampInt(b.max_uses, 1, 1e6, 1) : null);
    audit(s, 'discount.add', code, { pct });
    res.json({ ok: true });
  });
  r.del('/api/admin/discounts/:code', (req, res) => {
    const s = auth.requireStaff(req, 'pricing.manage');
    run('UPDATE discounts SET active = 0 WHERE code = ?', req.params.code);
    audit(s, 'discount.off', req.params.code);
    res.json({ ok: true });
  });

  // ---------- Blog ----------
  r.get('/api/admin/posts', (req, res) => {
    auth.requireStaff(req, 'blog.view');
    res.json({ posts: all('SELECT id, slug, title, status, published_at, updated_at, cover_url FROM posts ORDER BY COALESCE(published_at, updated_at) DESC') });
  });
  r.get('/api/admin/posts/:id', (req, res) => {
    auth.requireStaff(req, 'blog.view');
    const p = get('SELECT * FROM posts WHERE id = ?', Number(req.params.id));
    if (!p) fail(404, 'Post not found');
    res.json({ post: { ...p, tags: J(p.tags, []) } });
  });
  const savePost = async (req, res, existing) => {
    const s = auth.requireStaff(req, 'blog.edit');
    const b = await parseJson(req);
    const title = String(b.title || '').trim().slice(0, 140);
    if (!title) fail(400, 'Give the post a title.');
    let slug = slugify(b.slug || title) || 'post-' + Date.now();
    const clash = get('SELECT id FROM posts WHERE slug = ?', slug);
    if (clash && (!existing || clash.id !== existing.id)) slug += '-' + Date.now().toString(36).slice(-4);
    const body = String(b.body_md || '');
    const words = body.split(/\s+/).length;
    const status = b.status === 'published' ? 'published' : 'draft';
    const published = status === 'published' ? (existing?.published_at || now()) : null;
    const tags = JSON.stringify((Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',')).map((t) => String(t).trim()).filter(Boolean).slice(0, 8));
    if (existing) {
      run('UPDATE posts SET slug=?, title=?, excerpt=?, body_md=?, cover_url=?, tags=?, author=?, status=?, published_at=?, read_minutes=?, updated_at=? WHERE id=?',
        slug, title, String(b.excerpt || '').slice(0, 300), body, (/^(https?:\/\/|\/)[^\s"'<>]*$/.test(String(b.cover_url || '')) ? String(b.cover_url).slice(0, 500) : ''), tags, String(b.author || 'Vooads Team'), status, published, Math.max(1, Math.round(words / 220)), now(), existing.id);
      audit(s, 'post.edit', existing.id, { title, status });
      return res.json({ post: get('SELECT * FROM posts WHERE id = ?', existing.id) });
    }
    const info = run('INSERT INTO posts(slug, title, excerpt, body_md, cover_url, tags, author, status, published_at, read_minutes) VALUES(?,?,?,?,?,?,?,?,?,?)',
      slug, title, String(b.excerpt || '').slice(0, 300), body, (/^(https?:\/\/|\/)[^\s"'<>]*$/.test(String(b.cover_url || '')) ? String(b.cover_url).slice(0, 500) : ''), tags, String(b.author || 'Vooads Team'), status, published, Math.max(1, Math.round(words / 220)));
    audit(s, 'post.add', info.lastInsertRowid, { title, status });
    res.json({ post: get('SELECT * FROM posts WHERE id = ?', Number(info.lastInsertRowid)) });
  };
  r.post('/api/admin/posts', (req, res) => savePost(req, res, null));
  r.put('/api/admin/posts/:id', (req, res) => {
    auth.requireStaff(req, 'blog.edit');
    const p = get('SELECT * FROM posts WHERE id = ?', Number(req.params.id));
    if (!p) fail(404, 'Post not found');
    return savePost(req, res, p);
  });
  r.del('/api/admin/posts/:id', (req, res) => {
    const s = auth.requireStaff(req, 'blog.edit');
    run('DELETE FROM posts WHERE id = ?', Number(req.params.id));
    audit(s, 'post.delete', req.params.id);
    res.json({ ok: true });
  });
  r.post('/api/admin/upload', async (req, res) => {
    const s = auth.requireStaff(req);
    if (!['blog.edit', 'settings.manage', 'payments.manage', 'features.manage'].some((p) => auth.can(s, p))) fail(403, 'Your role cannot upload files.');
    const type = String(req.headers['content-type'] || '').split(';')[0];
    if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) fail(400, 'Upload a PNG, JPG, WebP or GIF image.');
    const up = await readBody(req, 8e6);
    if (!require('../lib/util').isImage(up, type)) fail(400, 'That file is not a real PNG, JPG, WebP or GIF image.');
    const m = media.save(up, type, null);
    res.json({ url: m.path });
  });

  // ---------- Emails ----------
  r.get('/api/admin/emails', (req, res) => {
    auth.requireStaff(req, 'emails.view');
    res.json({ templates: all('SELECT * FROM email_templates ORDER BY rowid'), log: all('SELECT id, to_email, template, send_at, sent_at, error, attempts FROM email_queue ORDER BY id DESC LIMIT 100'), live: !!config.email.resendKey, marketing: [...email.MARKETING] });
  });
  r.put('/api/admin/emails/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'emails.edit');
    const b = await parseJson(req);
    const t = get('SELECT * FROM email_templates WHERE id = ?', req.params.id);
    if (!t) fail(404, 'Template not found');
    run('UPDATE email_templates SET subject=?, preheader=?, heading=?, body_html=?, cta_label=?, cta_url=?, enabled=?, updated_at=? WHERE id=?',
      String(b.subject ?? t.subject), String(b.preheader ?? t.preheader), String(b.heading ?? t.heading), String(b.body_html ?? t.body_html), String(b.cta_label ?? t.cta_label), String(b.cta_url ?? t.cta_url), b.enabled === undefined ? t.enabled : b.enabled ? 1 : 0, now(), t.id);
    audit(s, 'email.edit', t.id);
    res.json({ ok: true });
  });
  r.get('/api/admin/emails/:id/preview', (req, res) => {
    auth.requireStaff(req, 'emails.view');
    const msg = email.build(req.params.id, require('../email/samples').sampleVars(config.appUrl, req.params.id), { id: 0, name: 'Alex' });
    res.html(msg.html);
  });
  r.post('/api/admin/emails/:id/test', async (req, res) => {
    const s = auth.requireStaff(req, 'emails.edit');
    await email.sendNow(req.params.id, s.email, { ...require('../email/samples').sampleVars(config.appUrl, req.params.id), inviter_name: s.name || 'The Vooads team' }).catch((e) => fail(502, e.message));
    res.json({ ok: true, to: s.email, logged: !config.email.resendKey });
  });

  // ---------- Support ----------
  // Tickets, macros, support settings and the old /api/admin/support endpoints live in routes/support.js.

  // ---------- Staff & roles ----------
  r.get('/api/admin/staff', (req, res) => {
    auth.requireStaff(req, 'staff.view');
    res.json({ staff: all('SELECT * FROM staff ORDER BY id').map(staffView), roles: all('SELECT * FROM roles ORDER BY id').map((x) => ({ ...x, permissions: J(x.permissions, []), limits: J(x.limits, {}) })), all_permissions: auth.PERMISSIONS, perm_groups: roleRules.groupsFor(auth.PERMISSIONS), presets: roleRules.presetsFor(auth.PERMISSIONS), limit_keys: roleRules.LIMIT_KEYS });
  });
  r.post('/api/admin/staff', async (req, res) => {
    const s = auth.requireStaff(req, 'staff.manage');
    const b = await parseJson(req);
    const mail = String(b.email || '').trim().toLowerCase();
    if (!isEmail(mail)) fail(400, 'Enter a valid email.');
    const role = get('SELECT * FROM roles WHERE id = ?', Number(b.role_id));
    if (!role) fail(400, 'Pick a role.');
    if (J(role.permissions, []).includes('*') && !auth.can(s, '*')) fail(403, 'Only an owner can invite another owner.');
    assertCanGrant(s, J(role.permissions, []), J(role.limits, {}));
    if (get('SELECT 1 FROM staff WHERE email = ?', mail)) fail(400, 'This person is already on the team.');
    const token = id(24);
    run("INSERT INTO staff(email, name, role_id, status, invite_token, invited_by) VALUES(?,?,?,'invited',?,?)", mail, String(b.name || '').slice(0, 60) || null, role.id, token, s.id);
    const inviteUrl = `${config.appUrl}/admin#invite=${token}`;
    await email.sendNow('staff_invite', mail, { invite_url: inviteUrl, role: role.name, inviter_name: s.name || 'The Vooads team', name: b.name || 'there' }).catch((e) => console.error('[invite email]', e.message));
    audit(s, 'staff.invite', mail, { role: role.name });
    res.json({ ok: true, invite_url: inviteUrl });
  });
  r.put('/api/admin/staff/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'staff.manage');
    const b = await parseJson(req);
    const t = get('SELECT * FROM staff WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Not found');
    if (t.id === s.id) fail(400, 'You cannot change your own access. Ask another owner.');
    const ownerRole = get("SELECT id FROM roles WHERE name = 'Owner'").id;
    if (t.role_id === ownerRole && !auth.can(s, '*')) fail(403, 'Only an owner can change an owner.');
    if (b.role_id !== undefined) {
      const role = get('SELECT * FROM roles WHERE id = ?', Number(b.role_id));
      if (!role) fail(400, 'Pick a role.');
      if (J(role.permissions, []).includes('*') && !auth.can(s, '*')) fail(403, 'Only an owner can make someone an owner.');
      assertCanGrant(s, J(role.permissions, []), J(role.limits, {}));
      run('UPDATE staff SET role_id = ? WHERE id = ?', role.id, t.id);
    }
    if (b.status !== undefined && ['active', 'disabled'].includes(b.status)) {
      run('UPDATE staff SET status = ? WHERE id = ?', b.status, t.id);
      if (b.status === 'disabled') run('DELETE FROM sessions WHERE staff_id = ?', t.id);
    }
    audit(s, 'staff.edit', t.email, b);
    res.json({ ok: true });
  });
  r.del('/api/admin/staff/:id', (req, res) => {
    const s = auth.requireStaff(req, 'staff.manage');
    const t = get('SELECT * FROM staff WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Not found');
    if (t.id === s.id) fail(400, 'You cannot remove yourself.');
    const ownerRole = get("SELECT id FROM roles WHERE name = 'Owner'").id;
    if (t.role_id === ownerRole && !auth.can(s, '*')) fail(403, 'Only an owner can remove an owner.');
    run('DELETE FROM sessions WHERE staff_id = ?', t.id);
    run('DELETE FROM staff WHERE id = ?', t.id);
    audit(s, 'staff.remove', t.email);
    res.json({ ok: true });
  });
  r.post('/api/admin/roles', async (req, res) => {
    const s = auth.requireStaff(req, 'staff.manage');
    const b = await parseJson(req);
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) fail(400, 'Name the role.');
    const permsList = (Array.isArray(b.permissions) ? b.permissions : []).filter((p) => auth.PERMISSIONS[p]);
    assertCanGrant(s, permsList, b.limits || {});
    if (get('SELECT 1 FROM roles WHERE lower(name) = lower(?)', name)) fail(409, 'A role with that name already exists. Pick another name.');
    const info = run('INSERT INTO roles(name, description, permissions, limits) VALUES(?,?,?,?)', name, String(b.description || '').slice(0, 200), JSON.stringify(permsList), JSON.stringify(roleRules.cleanLimits({ ...(b.limits || {}), ticket_scope: b.limits?.ticket_scope === 'assigned' ? 'assigned' : undefined })));
    audit(s, 'role.add', name, { permissions: permsList });
    res.json({ id: Number(info.lastInsertRowid) });
  });
  r.put('/api/admin/roles/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'staff.manage');
    const role = get('SELECT * FROM roles WHERE id = ?', Number(req.params.id));
    if (!role) fail(404, 'Not found');
    if (role.name === 'Owner') fail(400, 'The Owner role always has full access.');
    if (role.id === s.role_id && !auth.can(s, '*')) fail(403, 'You cannot change your own role. Ask an owner.');
    const b = await parseJson(req);
    const permsList = (Array.isArray(b.permissions) ? b.permissions : []).filter((p) => auth.PERMISSIONS[p]);
    assertCanGrant(s, permsList, b.limits || J(role.limits, {}));
    run('UPDATE roles SET name = ?, description = ?, permissions = ?, limits = ? WHERE id = ?', String(b.name || role.name).slice(0, 40), String(b.description ?? role.description ?? '').slice(0, 200), JSON.stringify(permsList),
      JSON.stringify(roleRules.cleanLimits(b.limits || {}, J(role.limits, {}))), role.id);
    audit(s, 'role.edit', role.name, { permissions: permsList });
    res.json({ ok: true });
  });
  r.del('/api/admin/roles/:id', (req, res) => {
    const s = auth.requireStaff(req, 'staff.manage');
    const role = get('SELECT * FROM roles WHERE id = ?', Number(req.params.id));
    if (!role) fail(404, 'Not found');
    if (role.system) fail(400, 'Built-in roles cannot be deleted. Edit them instead.');
    if (get('SELECT 1 FROM staff WHERE role_id = ?', role.id)) fail(400, 'Move the people in this role to another role first.');
    run('DELETE FROM roles WHERE id = ?', role.id);
    audit(s, 'role.delete', role.name);
    res.json({ ok: true });
  });

  // ---------- Integrations (status + Test for every outside connection) ----------
  r.get('/api/admin/integrations', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    res.json(require('../integrations').overview());
  });

  // ---------- Database backups (owners only: a backup holds every customer and every encrypted key) ----------
  const requireOwner = (req) => {
    const s = auth.requireStaff(req);
    if (!auth.can(s, '*')) fail(403, 'Only an owner can see and download backups.');
    return s;
  };
  r.get('/api/admin/backups', (req, res) => {
    requireOwner(req);
    const backups = require('../backups');
    res.json({ backups: backups.list(), keep: backups.KEEP, dir: backups.DIR() });
  });
  r.post('/api/admin/backups', (req, res) => {
    const s = requireOwner(req);
    require('../lib/http').rateLimit('backup:' + s.id, 6, 6e5); // VACUUM INTO copies the whole database
    const name = require('../backups').snapshot(require('../db').db, 'manual');
    audit(s, 'backup.create', name);
    res.json({ ok: true, name, backups: require('../backups').list() });
  });
  r.get('/api/admin/backups/:name', (req, res) => {
    const s = requireOwner(req);
    const file = require('../backups').fileFor(req.params.name);
    if (!file) fail(404, 'Backup not found.');
    audit(s, 'backup.download', req.params.name);
    const size = require('node:fs').statSync(file).size;
    res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': size, 'Content-Disposition': `attachment; filename="${req.params.name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    require('node:fs').createReadStream(file).pipe(res);
  });
  r.put('/api/admin/integrations', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const integ = require('../integrations');
    const values = b.values && typeof b.values === 'object' ? b.values : {};
    const clear = Array.isArray(b.clear) ? b.clear.map(String) : [];
    try { integ.save(values, { clear }); } catch (e) { fail(e.status || 400, e.message); }
    audit(s, 'integrations.edit', 'integrations', { changed: Object.keys(values).filter((k) => String(values[k] ?? '').trim()), cleared: clear });
    res.json(integ.overview());
  });
  r.post('/api/admin/integrations/voosquare/service-key', (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const integ = require('../integrations');
    const key = integ.newServiceKey();
    integ.save({ 'voosquare.service_key': key });
    audit(s, 'integrations.voosquare_key', 'voosquare', { rotated: true });
    // Shown once so it can be pasted into VooSquare. Afterwards only a masked hint is ever returned.
    res.json({ key, overview: integ.overview() });
  });
  r.post('/api/admin/integrations/test/:what', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const integ = require('../integrations');
    const what = req.params.what;
    const fn = { email: () => integ.testEmail(s.email), 'voosquare-login': integ.testVooLogin, 'voosquare-events': integ.testVooEvents, 'voosquare-inbound': integ.testVooInbound, storage: integ.testStorage }[what];
    if (!fn) fail(404, 'Unknown test');
    const out = await fn();
    audit(s, 'integrations.test', what, { ok: out.ok });
    res.json(out);
  });
  r.post('/api/admin/payment-methods/:id/test', async (req, res) => {
    const s = auth.requireStaff(req, 'payments.manage');
    const m = get('SELECT * FROM payment_methods WHERE id = ?', Number(req.params.id));
    if (!m) fail(404, 'Not found');
    const out = await require('../integrations').testMethod(m);
    audit(s, 'payment_method.test', m.id, { ok: out.ok });
    res.json(out);
  });

  // ---------- Settings & audit ----------
  r.get('/api/admin/settings', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    res.json({ site: getSetting('site'), presenters: getSetting('presenters'), voices: getSetting('voices'), referral: getSetting('referral'), limits: getSetting('limits'), env: { app_url: config.appUrl, owner: config.ownerEmail, email_live: !!config.email.resendKey, voosquare_login: !!config.voosquare.issuer, data_dir: config.dataDir } });
  });
  r.put('/api/admin/settings/:key', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    if (!['site', 'presenters', 'voices', 'referral', 'limits'].includes(req.params.key)) fail(400, 'Unknown setting');
    const b = await parseJson(req);
    if (req.params.key === 'limits') b.value = Object.fromEntries(Object.entries(DEFAULTS.limits).map(([k, d]) => [k, Math.max(0, Math.round(Number(b.value?.[k] ?? getSetting('limits')[k] ?? d)) || 0)]));
    setSetting(req.params.key, b.value);
    audit(s, 'settings.edit', req.params.key);
    res.json({ ok: true });
  });
  r.get('/api/admin/audit', (req, res) => {
    auth.requireStaff(req, 'audit.view');
    res.json({ log: all('SELECT a.*, s.email AS staff_email FROM audit_log a LEFT JOIN staff s ON s.id = a.staff_id ORDER BY a.id DESC LIMIT 300').map((x) => ({ ...x, detail: J(x.detail, {}) })) });
  });
};
