// Support tickets: customer API, admin inbox, macros, support settings, old /api/support endpoints, and the VooSquare inbound API.
// Logic lives in server/support.js. Contract: docs/SPEC-v2.md §5 and docs/VOOSQUARE-SUPPORT-API.md.
const config = require('../config');
const { get, all, run, J } = require('../db');
const { parseJson, fail, rateLimit } = require('../lib/http');
const { now, addDays, clampInt, isEmail, safeEqual } = require('../lib/util');
const auth = require('../auth');
const credits = require('../credits');
const support = require('../support');
const team = require('../team');
const vooconnect = require('../vooconnect');
const { getSetting } = require('../settings');

const PAGE = 50;

// Customer's own ticket or 404.
function ownTicket(u, id) {
  const t = get('SELECT * FROM tickets WHERE id = ? AND user_id = ?', Number(id), u.id);
  if (!t) fail(404, 'Ticket not found.');
  return t;
}
const customerTicket = (t) => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority, category: t.category, phone: t.phone, call_time: t.call_time, created_at: t.created_at, updated_at: t.updated_at });

function staffCan(staff, ...perms) { return perms.some((p) => auth.can(staff, p)); }
function requireAnyStaff(req, ...perms) {
  const s = auth.requireStaff(req);
  if (!staffCan(s, ...perms)) fail(403, 'Your role does not have access to this. Ask the owner to update your permissions.');
  return s;
}
// Team members who can be assigned tickets.
function assignableStaff() {
  return all("SELECT id, name, email, role_id FROM staff WHERE status = 'active' ORDER BY name, email")
    .filter((s) => auth.can(s, 'tickets.reply'))
    .map((s) => ({ id: s.id, name: s.name || s.email, email: s.email, scope: support.scopeOf(s) }));
}
const readOnly = () => { const v = support.settings().voosquare; return !!(v.enabled && v.mode === 'voosquare'); };

// VooSquare server-to-server auth.
function requireVoo(req) {
  const key = config.voosquare.serviceKey;
  if (!key || !safeEqual(req.headers.authorization, 'Bearer ' + key)) fail(401, 'Unauthorized');
  if (!support.settings().voosquare.enabled) fail(403, 'VooSquare support is switched off in Vooads (Admin → Support settings).');
  require('../integrations').noteInbound();
}
function vooWritable() {
  if (support.settings().voosquare.mode === 'vooads') fail(409, 'Replies happen in the Vooads admin. Support mode is set to Vooads-only, so VooSquare is read-only for tickets.');
}
function vooAgent(a) {
  const agent = a && typeof a === 'object' ? a : {};
  const mail = String(agent.email || '').trim().toLowerCase();
  if (!isEmail(mail)) fail(400, 'Send agent.email so the action can be logged.');
  return { id: String(agent.id || mail).slice(0, 80), name: String(agent.name || mail).slice(0, 80), email: mail, role: String(agent.role || '').slice(0, 40) };
}

module.exports = function mount(r) {
  // ================= Customer =================
  r.get('/api/tickets', (req, res) => {
    const u = auth.requireUser(req);
    const rows = all('SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100', u.id);
    res.json({ tickets: rows.map((t) => ({ ...customerTicket(t), unread: support.unreadFor(t) })) });
  });
  r.post('/api/tickets', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('tix:' + u.id, 6, 10 * 6e4);
    const b = await parseJson(req);
    const t = support.createTicket(u, b);
    res.json({ ticket: customerTicket(t), messages: support.messages(t.id).map((m) => support.messageView(m)) });
  });
  r.get('/api/tickets/:id', (req, res) => {
    const u = auth.requireUser(req);
    const t = ownTicket(u, req.params.id);
    run('UPDATE tickets SET customer_seen_at = ? WHERE id = ?', now(), t.id);
    res.json({ ticket: customerTicket(t), messages: support.messages(t.id).map((m) => support.messageView(m)) });
  });
  r.post('/api/tickets/:id/messages', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('tmsg:' + u.id, 20, 6e4);
    const t = ownTicket(u, req.params.id);
    const b = await parseJson(req);
    const m = support.customerMessage(u, t, b.body);
    res.json({ message: support.messageView(m), ticket: customerTicket(get('SELECT * FROM tickets WHERE id = ?', t.id)) });
  });
  r.post('/api/tickets/:id/close', (req, res) => {
    const u = auth.requireUser(req);
    const t = ownTicket(u, req.params.id);
    if (t.status !== 'closed') {
      support.insertMessage(t.id, { author_type: 'system', author_name: 'Vooads', body: 'The customer closed this ticket.' });
      support.updateTicket(t, { status: 'closed' }, { source: 'customer' });
    }
    res.json({ ticket: customerTicket(get('SELECT * FROM tickets WHERE id = ?', t.id)) });
  });

  // Old chat endpoints, kept for older app versions. They use the newest ticket that is not closed.
  r.get('/api/support', (req, res) => {
    const u = auth.requireUser(req);
    const t = support.latestOpenTicket(u.id);
    const msgs = t ? all("SELECT * FROM ticket_messages WHERE ticket_id = ? AND internal = 0 AND author_type IN ('customer','staff','voosquare') ORDER BY id LIMIT 200", t.id) : [];
    if (t) run('UPDATE tickets SET customer_seen_at = ? WHERE id = ?', now(), t.id);
    res.json({ ticket_id: t ? t.id : null, messages: msgs.map((m) => ({ id: m.id, from_staff: m.author_type === 'customer' ? 0 : 1, author_name: m.author_name, body: m.body, created_at: m.created_at })) });
  });
  r.post('/api/support', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('sup:' + u.id, 15, 6e4);
    if (getSetting('site').support_chat === false) fail(403, 'Chat is closed right now. Email ' + config.brand.supportEmail + ' instead.');
    const b = await parseJson(req);
    const t = support.latestOpenTicket(u.id);
    if (t) support.customerMessage(u, t, String(b.body || '').slice(0, 2000));
    else support.createTicket(u, { subject: 'Chat with support', body: String(b.body || '').slice(0, 2000), category: 'other' });
    res.json({ ok: true, ticket_id: (t || support.latestOpenTicket(u.id))?.id || null });
  });

  // ================= Admin inbox =================
  r.get('/api/admin/tickets', (req, res) => {
    const s = auth.requireStaff(req, 'tickets.view');
    const scope = support.scopeSql(s);
    const where = [scope.sql], params = [...scope.params];
    const q = req.query;
    if (q.status) {
      const list = String(q.status).split(',').filter((x) => support.STATUSES.includes(x));
      if (list.length) { where.push(`t.status IN (${list.map(() => '?').join(',')})`); params.push(...list); }
    }
    if (q.priority && support.PRIORITIES.includes(q.priority)) { where.push('t.priority = ?'); params.push(q.priority); }
    if (q.category && support.CATEGORIES.includes(q.category)) { where.push('t.category = ?'); params.push(q.category); }
    if (q.assignee === 'me') { where.push('t.assignee_staff_id = ?'); params.push(s.id); }
    else if (q.assignee === 'none') where.push('t.assignee_staff_id IS NULL AND t.assignee_ext_id IS NULL');
    else if (q.assignee === 'voosquare') where.push('t.assignee_ext_id IS NOT NULL');
    else if (q.assignee && /^\d+$/.test(q.assignee)) { where.push('t.assignee_staff_id = ?'); params.push(Number(q.assignee)); }
    if (q.overdue === '1' || q.overdue === 'true') { where.push("t.status = 'open' AND t.sla_due_at < ?"); params.push(now()); }
    if (q.user_id && /^\d+$/.test(q.user_id)) { where.push('t.user_id = ?'); params.push(Number(q.user_id)); }
    if (q.q) {
      const term = String(q.q).trim().toLowerCase().slice(0, 100);
      const idq = term.replace(/^#/, '');
      where.push("(lower(t.subject) LIKE ? OR lower(COALESCE(u.email,'')) LIKE ? OR lower(COALESCE(u.name,'')) LIKE ? OR t.id = ?)");
      params.push('%' + term + '%', '%' + term + '%', '%' + term + '%', /^\d+$/.test(idq) ? Number(idq) : -1);
    }
    const page = clampInt(q.page, 1, 1e6, 1);
    const sqlWhere = where.join(' AND ');
    const total = get(`SELECT COUNT(*) AS c FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE ${sqlWhere}`, ...params).c;
    // Overdue and urgent first among open tickets, then most recently updated.
    const rows = all(`SELECT t.* FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE ${sqlWhere}
      ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 WHEN 'solved' THEN 2 ELSE 3 END,
      CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?`, ...params, PAGE, (page - 1) * PAGE);
    res.json({
      tickets: rows.map((t) => support.ticketView(t, { withUser: true })),
      counts: support.counts(scope, s.id), page, pages: Math.max(1, Math.ceil(total / PAGE)), total,
      scope: support.scopeOf(s), read_only: readOnly(), mode: support.settings().voosquare.enabled ? support.settings().voosquare.mode : 'vooads',
      staff: assignableStaff(),
    });
  });
  r.get('/api/admin/tickets/:id', (req, res) => {
    const s = auth.requireStaff(req, 'tickets.view');
    const t = support.staffTicket(s, req.params.id);
    const u = get('SELECT * FROM users WHERE id = ?', t.user_id);
    res.json({
      ticket: support.ticketView(t, { withUser: true }),
      messages: support.messages(t.id, { includeInternal: true }).map((m) => support.messageView(m, { staff: true })),
      user: u ? { ...support.customerOf(u.id), balance: credits.balance(u), created_at: u.created_at, last_seen_at: u.last_seen_at, plan_expires_at: u.plan_expires_at } : null,
      recent_jobs: u ? all('SELECT id, type, status, credits, refunded, demo, error, created_at FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT 10', u.id) : [],
      recent_payments: u && auth.can(s, 'payments.view') ? all('SELECT id, kind, plan_id, period, credits, amount_usd, status, adapter, created_at, paid_at FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 10', u.id) : [],
      other_tickets: u ? all('SELECT id, subject, status, updated_at FROM tickets WHERE user_id = ? AND id != ? ORDER BY id DESC LIMIT 10', u.id, t.id) : [],
      read_only: readOnly(), staff: assignableStaff(),
      can: { reply: auth.can(s, 'tickets.reply'), assign: auth.can(s, 'tickets.assign'), credits: auth.can(s, 'users.credits'), max_credit_grant: auth.can(s, '*') ? null : auth.roleLimits(s).max_credit_grant ?? null },
    });
  });
  r.post('/api/admin/tickets/:id/reply', async (req, res) => {
    const s = auth.requireStaff(req, 'tickets.reply');
    const t = support.staffTicket(s, req.params.id);
    support.assertAdminWritable();
    const b = await parseJson(req);
    if (b.status) team.assertStatusChange(s, b.status);
    const out = support.agentReply(t, { type: 'staff', id: s.id, name: s.name || s.email }, { body: b.body, internal: !!b.internal, status: b.status || undefined });
    support.audit(s, b.internal ? 'ticket.note' : 'ticket.reply', 'ticket:' + t.id, { status: out.ticket.status });
    res.json({ ticket: support.ticketView(out.ticket, { withUser: true }), message: support.messageView(out.message, { staff: true }) });
  });
  r.put('/api/admin/tickets/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'tickets.view');
    const t = support.staffTicket(s, req.params.id);
    support.assertAdminWritable();
    const b = await parseJson(req);
    const f = {};
    for (const k of ['status', 'priority', 'category']) if (b[k] !== undefined) f[k] = b[k];
    if (Object.keys(f).length && !auth.can(s, 'tickets.reply')) fail(403, 'Your role cannot change tickets.');
    if (f.status) team.assertStatusChange(s, f.status);
    if (b.assignee_staff_id !== undefined) {
      if (!auth.can(s, 'tickets.assign')) fail(403, 'Your role cannot assign tickets.');
      f.assignee_staff_id = b.assignee_staff_id;
      if (b.assignee_staff_id) { f.assignee_ext_id = null; f.assignee_ext_name = null; }
      if (b.assignee_staff_id && Number(b.assignee_staff_id) !== s.id) {
        const target = get("SELECT * FROM staff WHERE id = ? AND status = 'active'", Number(b.assignee_staff_id));
        if (target && !auth.can(target, 'tickets.reply')) fail(400, 'That team member cannot reply to tickets.');
      }
    }
    if (!Object.keys(f).length) fail(400, 'Nothing to change.');
    const nt = support.updateTicket(t, f, { source: 'staff' });
    support.audit(s, 'ticket.update', 'ticket:' + t.id, f);
    res.json({ ticket: support.ticketView(nt, { withUser: true }) });
  });
  r.post('/api/admin/tickets/:id/credits', async (req, res) => {
    const s = auth.requireStaff(req, 'users.credits');
    const t = support.staffTicket(s, req.params.id);
    support.assertAdminWritable();
    const b = await parseJson(req);
    const cap = auth.can(s, '*') ? null : auth.roleLimits(s).max_credit_grant;
    team.assertGrant(s, Math.round(Number(b.amount)) || 0);
    const out = support.grantCredits(t, b.amount, b.reason, { cap, staffId: s.id, by: s.name || s.email });
    support.audit(s, 'ticket.credits', 'ticket:' + t.id, { user_id: t.user_id, amount: out.applied, reason: b.reason });
    res.json({ ok: true, ...out });
  });

  // ---------- Macros ----------
  r.get('/api/admin/macros', (req, res) => {
    auth.requireStaff(req, 'tickets.view');
    res.json({ macros: all('SELECT m.*, s.name AS created_by_name FROM macros m LEFT JOIN staff s ON s.id = m.created_by ORDER BY m.title') });
  });
  const macroBody = (b) => {
    const title = String(b.title || '').trim().slice(0, 80), body = String(b.body || '').trim().slice(0, 5000);
    if (!title || !body) fail(400, 'A macro needs a title and a message.');
    return { title, body };
  };
  r.post('/api/admin/macros', async (req, res) => {
    const s = auth.requireStaff(req, 'tickets.manage');
    const m = macroBody(await parseJson(req));
    const info = run('INSERT INTO macros(title, body, created_by, created_at) VALUES(?,?,?,?)', m.title, m.body, s.id, now());
    support.audit(s, 'macro.add', info.lastInsertRowid, { title: m.title });
    res.json({ macro: get('SELECT * FROM macros WHERE id = ?', Number(info.lastInsertRowid)) });
  });
  r.put('/api/admin/macros/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'tickets.manage');
    const row = get('SELECT * FROM macros WHERE id = ?', Number(req.params.id));
    if (!row) fail(404, 'Macro not found.');
    const m = macroBody(await parseJson(req));
    run('UPDATE macros SET title = ?, body = ? WHERE id = ?', m.title, m.body, row.id);
    support.audit(s, 'macro.edit', row.id, { title: m.title });
    res.json({ macro: get('SELECT * FROM macros WHERE id = ?', row.id) });
  });
  r.del('/api/admin/macros/:id', (req, res) => {
    const s = auth.requireStaff(req, 'tickets.manage');
    run('DELETE FROM macros WHERE id = ?', Number(req.params.id));
    support.audit(s, 'macro.delete', req.params.id);
    res.json({ ok: true });
  });

  // ---------- Support settings ----------
  r.get('/api/admin/support-settings', (req, res) => {
    auth.requireStaff(req, 'tickets.view');
    res.json(support.settingsView());
  });
  r.put('/api/admin/support-settings', async (req, res) => {
    const s = auth.requireStaff(req, 'tickets.manage');
    const b = await parseJson(req);
    const v = (b.value || b).voosquare;
    // Where ticket data is sent is a data-sharing decision: only roles that manage site settings may change it.
    if (v && v.events_url !== undefined && String(v.events_url || '').trim() !== String(support.settings().voosquare.events_url || '') && !auth.can(s, 'settings.manage')) fail(403, 'Only the owner (or a role that manages settings) can change where ticket events are sent.');
    support.saveSettings(b.value || b);
    support.audit(s, 'support.settings', 'support', { voosquare: support.settings().voosquare });
    res.json(support.settingsView());
  });

  // ---------- Old admin chat endpoints (pre-tickets admin UI). Backed by tickets now. ----------
  r.get('/api/admin/support', (req, res) => {
    const s = requireAnyStaff(req, 'support.reply', 'tickets.reply');
    const scope = support.scopeSql(s);
    const threads = all(`SELECT u.id AS user_id, u.email, u.name, MAX(t.id) AS last_id, MAX(t.updated_at) AS last_at,
      SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS unread
      FROM tickets t JOIN users u ON u.id = t.user_id WHERE ${scope.sql} GROUP BY u.id ORDER BY last_at DESC LIMIT 100`, ...scope.params);
    for (const th of threads) th.last_body = get("SELECT m.body FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE t.user_id = ? AND m.internal = 0 AND m.author_type != 'bot' ORDER BY m.id DESC LIMIT 1", th.user_id)?.body || '';
    res.json({ threads });
  });
  r.get('/api/admin/support/:userId', (req, res) => {
    const s = requireAnyStaff(req, 'support.reply', 'tickets.reply');
    const uid = Number(req.params.userId);
    const scope = support.scopeSql(s);
    const u = get('SELECT id, email, name, plan_id, status FROM users WHERE id = ?', uid);
    const msgs = all(`SELECT m.* FROM ticket_messages m JOIN tickets t ON t.id = m.ticket_id WHERE t.user_id = ? AND ${scope.sql} AND m.author_type != 'bot' ORDER BY m.id`, uid, ...scope.params);
    res.json({ user: u, messages: msgs.map((m) => ({ id: m.id, ticket_id: m.ticket_id, from_staff: m.author_type === 'customer' ? 0 : 1, internal: m.internal, staff_name: m.author_type === 'customer' ? null : m.author_name, body: m.body, created_at: m.created_at })) });
  });
  r.post('/api/admin/support/:userId', async (req, res) => {
    const s = requireAnyStaff(req, 'support.reply', 'tickets.reply');
    const b = await parseJson(req);
    const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.userId));
    if (!u) fail(404, 'Customer not found');
    support.assertAdminWritable();
    let t = support.latestOpenTicket(u.id);
    if (t) t = support.staffTicket(s, t.id);
    else if (support.scopeOf(s) === 'assigned') fail(403, 'Your role only answers tickets assigned to you.');
    else {
      const t0 = now();
      const info = run("INSERT INTO tickets(user_id, subject, category, status, priority, channel, created_at, updated_at, assignee_staff_id) VALUES(?, 'Message from Vooads support', 'other', 'pending', 'normal', 'web', ?, ?, ?)", u.id, t0, t0, s.id);
      t = get('SELECT * FROM tickets WHERE id = ?', Number(info.lastInsertRowid));
    }
    support.agentReply(t, { type: 'staff', id: s.id, name: s.name || s.email }, { body: String(b.body || '').slice(0, 4000) });
    support.audit(s, 'ticket.reply', 'ticket:' + t.id, { via: 'legacy' });
    res.json({ ok: true, ticket_id: t.id });
  });

  // ================= VooSquare inbound (server to server) =================
  r.get('/api/voosquare/support/tickets', (req, res) => {
    requireVoo(req);
    const where = ['1=1'], params = [];
    if (req.query.status) {
      const list = String(req.query.status).split(',').filter((x) => support.STATUSES.includes(x));
      if (list.length) { where.push(`t.status IN (${list.map(() => '?').join(',')})`); params.push(...list); }
    }
    if (req.query.updated_since) {
      const d = new Date(req.query.updated_since);
      if (isNaN(d)) fail(400, 'updated_since must be an ISO date.');
      where.push('t.updated_at > ?'); params.push(d.toISOString());
    }
    const limit = clampInt(req.query.limit, 1, 200, 100), offset = clampInt(req.query.offset, 0, 1e9, 0);
    const rows = all(`SELECT t.* FROM tickets t WHERE ${where.join(' AND ')} ORDER BY t.updated_at ASC, t.id ASC LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
    res.json({ tickets: rows.slice(0, limit).map((t) => ({ ...support.ticketView(t), customer: support.customerOf(t.user_id) })), has_more: rows.length > limit, next_offset: rows.length > limit ? offset + limit : null });
  });
  r.get('/api/voosquare/support/stats', (req, res) => {
    requireVoo(req);
    const c = support.counts();
    const since30 = addDays(now(), -30), since1 = addDays(now(), -1), since7 = addDays(now(), -7);
    const frt = all('SELECT created_at, first_response_at FROM tickets WHERE first_response_at IS NOT NULL AND created_at >= ?', since30);
    const avg = frt.length ? Math.round(frt.reduce((a, t) => a + (new Date(t.first_response_at) - new Date(t.created_at)), 0) / frt.length / 6e4) : null;
    res.json({
      tool: 'vooads', mode: support.settings().voosquare.mode, counts: c,
      created_24h: get('SELECT COUNT(*) AS c FROM tickets WHERE created_at >= ?', since1).c,
      solved_7d: get("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('solved','closed') AND updated_at >= ?", since7).c,
      avg_first_response_minutes_30d: avg, sla_hours: support.settings().sla_hours, open_url: config.appUrl + '/admin#/tickets',
    });
  });
  // Messages after a known id, oldest first: VooSquare syncs a thread without re-reading it (ordering = message id).
  r.get('/api/voosquare/support/tickets/:id/messages', (req, res) => {
    requireVoo(req);
    const t = get('SELECT * FROM tickets WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Ticket not found.');
    const after = clampInt(req.query.after_id, 0, 1e12, 0);
    const rows = all('SELECT * FROM ticket_messages WHERE ticket_id = ? AND id > ? ORDER BY id LIMIT 200', t.id, after);
    res.json({ ticket: support.ticketView(t), messages: rows.map((m) => support.messageView(m, { staff: true })), last_id: rows.length ? rows[rows.length - 1].id : after });
  });
  r.get('/api/voosquare/support/tickets/:id', (req, res) => {
    requireVoo(req);
    const t = get('SELECT * FROM tickets WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Ticket not found.');
    res.json({ ticket: support.ticketView(t), customer: support.customerOf(t.user_id), messages: support.messages(t.id, { includeInternal: true }).map((m) => support.messageView(m, { staff: true })) });
  });
  r.post('/api/voosquare/support/tickets/:id/reply', async (req, res) => {
    requireVoo(req);
    vooWritable();
    const t = get('SELECT * FROM tickets WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Ticket not found.');
    const b = await parseJson(req);
    const agent = vooAgent(b.agent);
    // The agent's Vooads role decides what they may do (see vooconnect.js: agent map → staff email → default role).
    const who = vooconnect.resolveAgent(agent);
    vooconnect.agentTicket(who, t);
    vooconnect.agentRequire(who, 'tickets.reply', 'reply to tickets');
    if (['solved', 'closed'].includes(b.status)) vooconnect.agentRequire(who, 'tickets.close', 'solve or close tickets');
    // Idempotent: the same VooSquare message id (body field or Idempotency-Key header) never adds a second message.
    const extId = String(b.client_msg_id || b.voo_message_id || req.headers['idempotency-key'] || '').trim().slice(0, 120) || null;
    if (extId) {
      const dup = get('SELECT * FROM ticket_messages WHERE ticket_id = ? AND ext_id = ?', t.id, extId);
      if (dup) return res.json({ ticket: support.ticketView(get('SELECT * FROM tickets WHERE id = ?', t.id)), message: support.messageView(dup, { staff: true }), duplicate: true });
    }
    const out = support.agentReply(t, { type: 'voosquare', id: agent.id, name: agent.name }, { body: b.body, internal: !!b.internal, status: b.status || undefined, ext_id: extId });
    support.audit('voosquare:' + agent.email, b.internal ? 'ticket.note' : 'ticket.reply', 'ticket:' + t.id, { agent, role: who.role.name });
    res.json({ ticket: support.ticketView(out.ticket), message: support.messageView(out.message, { staff: true }) });
  });
  r.put('/api/voosquare/support/tickets/:id', async (req, res) => {
    requireVoo(req);
    vooWritable();
    const t = get('SELECT * FROM tickets WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Ticket not found.');
    const b = await parseJson(req);
    const agent = b.agent ? vooAgent(b.agent) : null;
    const f = {};
    for (const k of ['status', 'priority', 'category', 'voo_ticket_id']) if (b[k] !== undefined) f[k] = b[k];
    // Changes made by an agent follow their role. Only voo_ticket_id (VooSquare's own id) may be set without an agent.
    const changes = Object.keys(f).filter((k) => k !== 'voo_ticket_id').length || b.assignee !== undefined;
    if (changes && !agent) fail(400, 'Send agent.email so the change can be checked and logged.');
    if (agent && changes) {
      const who = vooconnect.resolveAgent(agent);
      vooconnect.agentTicket(who, t);
      if (['status', 'priority', 'category'].some((k) => f[k] !== undefined)) vooconnect.agentRequire(who, 'tickets.reply', 'change tickets');
      if (['solved', 'closed'].includes(f.status)) vooconnect.agentRequire(who, 'tickets.close', 'solve or close tickets');
      if (b.assignee !== undefined) vooconnect.agentRequire(who, 'tickets.assign', 'assign tickets');
    }
    if (b.assignee !== undefined) {
      if (!b.assignee) { f.assignee_ext_id = null; f.assignee_ext_name = null; }
      else { f.assignee_ext_id = String(b.assignee.id || b.assignee.email || ''); f.assignee_ext_name = String(b.assignee.name || b.assignee.email || 'VooSquare agent'); f.assignee_staff_id = null; }
    }
    if (!Object.keys(f).length) fail(400, 'Nothing to change.');
    const nt = support.updateTicket(t, f, { source: 'voosquare' });
    support.audit('voosquare:' + (agent ? agent.email : 'service'), 'ticket.update', 'ticket:' + t.id, { ...f, agent });
    res.json({ ticket: support.ticketView(nt) });
  });
  r.post('/api/voosquare/support/tickets/:id/credits', async (req, res) => {
    requireVoo(req);
    vooWritable();
    const t = get('SELECT * FROM tickets WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Ticket not found.');
    const b = await parseJson(req);
    const agent = vooAgent(b.agent);
    const who = vooconnect.resolveAgent(agent);
    vooconnect.agentTicket(who, t);
    vooconnect.agentGrantCheck(who, Math.round(Number(b.amount)) || 0);
    const out = support.grantCredits(t, b.amount, b.reason, { cap: support.settings().voosquare.max_credit_grant, by: 'voosquare:' + agent.email, staffId: who.staff ? who.staff.id : null });
    support.audit('voosquare:' + agent.email, 'ticket.credits', 'ticket:' + t.id, { user_id: t.user_id, amount: out.applied, reason: b.reason, agent });
    res.json({ ok: true, ...out });
  });
};
