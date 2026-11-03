// "Connect VooSquare" wizard + VooSquare agent → Vooads role mapping.
//
// Step 1  VooSquare gives a connection code (base64url JSON, optionally prefixed "vsq1.") with its login (OIDC) details
//         and where to send events: {v, issuer, client_id, client_secret, events_url?, support_events_url?, webhook_secret?}.
//         The fields can also be pasted one by one.
// Step 2  Vooads saves them, creates the inbound service key (and a signing secret when VooSquare did not send one) and
//         returns everything to paste into VooSquare, also as one "return code".
// Step 3  Test both ways: a signed ping to VooSquare (simulated for .test/.example/.invalid hosts or VOOSQUARE_MOCK=1, so
//         the wizard can be tried without a real VooSquare) and a real call to our own inbound API with the service key.
//
// Agents: VooSquare sends agent {id, name, email} on every write. Their Vooads permissions come from, in order:
//   1. the agent map (Admin → Integrations → VooSquare → Agents: email → role),
//   2. a Vooads staff member with the same email (their role),
//   3. the default role for VooSquare agents (setting; starts as the "Support" role; "none" blocks unmapped agents).
const config = require('./config');
const { get, all } = require('./db');
const { fail } = require('./lib/http');
const { id } = require('./lib/util');
const auth = require('./auth');
const roles = require('./roles');

const PREFIX = 'vsq1.';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s) => Buffer.from(String(s).replace(/=+$/, ''), 'base64url').toString('utf8');
const httpsOk = (u) => /^https:\/\/[^\s/]+/i.test(String(u || '')) || (!config.isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(u || '')));
const isMockHost = (u) => { try { return process.env.VOOSQUARE_MOCK === '1' || /\.(test|example|invalid)$/i.test(new URL(u).hostname); } catch { return false; } };

// Connection code → fields. Throws 400 with a plain message when it cannot be read.
function decodeCode(code) {
  let s = String(code || '').trim().replace(/\s+/g, '');
  if (!s) fail(400, 'Paste the connection code from VooSquare.');
  if (s.length > 6000) fail(400, 'That code is too long. Copy it again from VooSquare.');
  if (s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
  let o;
  try { o = JSON.parse(s.startsWith('{') ? s : unb64(s)); } catch { fail(400, 'That code could not be read. Copy the whole code from VooSquare → Apps → Vooads.'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) fail(400, 'That code could not be read.');
  return clean(o);
}
function clean(o) {
  const out = {};
  const str = (k, n = 500) => (o[k] === undefined || o[k] === null ? '' : String(o[k]).trim().slice(0, n));
  out.issuer = str('issuer').replace(/\/$/, '');
  // Voo Connect (current): base = the VooSquare address. Older codes only had an OpenID issuer; its origin is used.
  out.base = str('base').replace(/\/+$/, '') || (() => { try { return out.issuer ? new URL(out.issuer).origin : ''; } catch { return ''; } })();
  out.api_key = str('api_key', 300);
  out.client_id = str('client_id', 200);
  out.client_secret = str('client_secret', 300);
  out.events_url = str('events_url');
  out.support_events_url = str('support_events_url') || str('support_url');
  out.webhook_secret = str('webhook_secret', 300);
  if (!out.base || !out.client_id || !out.client_secret) fail(400, 'The code (or the form) needs the VooSquare address, client ID and client secret.');
  if (!httpsOk(out.base)) fail(400, 'The VooSquare address must start with https://');
  if (out.issuer && !/^https:\/\/[^\s/]+/i.test(out.issuer)) fail(400, 'The VooSquare issuer must start with https://');
  for (const k of ['events_url', 'support_events_url']) if (out[k] && !httpsOk(out[k])) fail(400, `The ${k.replace(/_/g, ' ')} must start with https://`);
  return out;
}
function encode(obj) { return PREFIX + b64(JSON.stringify(obj)); }

// What to paste into VooSquare (URLs never contain secrets; secrets only appear right after they are created).
function pasteBack({ serviceKey = null, webhookSecret = null } = {}) {
  const base = config.appUrl;
  const urls = {
    base_url: base,
    inbound_base: base + '/api/voosquare/support',
    tickets_url: base + '/api/voosquare/support/tickets',
    stats_url: base + '/api/voosquare/support/stats',
    summary_url: base + '/api/voosquare/summary',
    redirect_uri: base + '/auth/voosquare/callback',
  };
  const ret = { v: 1, tool: 'vooads', ...urls, ...(serviceKey ? { service_key: serviceKey } : {}), ...(webhookSecret ? { webhook_secret: webhookSecret } : {}) };
  return { urls, return_code: serviceKey || webhookSecret ? encode(ret) : null };
}

// Steps 1 + 2. Saves login + event settings, creates the service key (and signing secret if VooSquare sent none).
function connect(body, { rotate = false } = {}) {
  const integ = require('./integrations');
  const support = require('./support');
  const f = body.code ? decodeCode(body.code) : clean(body);
  const values = { 'voosquare.base': f.base, 'voosquare.client_id': f.client_id, 'voosquare.client_secret': f.client_secret };
  if (f.issuer) values['voosquare.issuer'] = f.issuer;
  if (f.api_key) values['voosquare.api_key'] = f.api_key;
  if (f.events_url && /^https:/.test(f.events_url)) values['voosquare.events_url'] = f.events_url;
  let webhookSecret = null, serviceKey = null;
  if (f.webhook_secret) values['voosquare.webhook_secret'] = f.webhook_secret;
  else if (!config.voosquare.webhookSecret || rotate) { webhookSecret = 'whs_' + id(30); values['voosquare.webhook_secret'] = webhookSecret; }
  if (!config.voosquare.serviceKey || rotate) { serviceKey = integ.newServiceKey(); values['voosquare.service_key'] = serviceKey; }
  try { integ.save(values); } catch (e) { fail(e.status || 400, e.message); }
  require('./voo').reset(); require('./voo').start();
  // Support events go where VooSquare said (support settings accept http://localhost for local testing).
  if (f.support_events_url) support.saveSettings({ voosquare: { events_url: f.support_events_url } });
  return { saved: Object.keys(values).filter((k) => !/secret|key/.test(k)), ...pasteBack({ serviceKey, webhookSecret }), status: status() };
}

// New service key and signing secret (VooSquare must get the new return code). Login details stay as they are.
function rotateKeys() {
  const integ = require('./integrations');
  const serviceKey = integ.newServiceKey(), webhookSecret = 'whs_' + id(30);
  integ.save({ 'voosquare.service_key': serviceKey, 'voosquare.webhook_secret': webhookSecret });
  return { ...pasteBack({ serviceKey, webhookSecret }), status: status() };
}

function status() {
  const v = config.voosquare;
  let sup = {};
  try { sup = require('./support').settings().voosquare; } catch {}
  const T = require('./settings').getSetting('integration_tests') || {};
  const parts = { login: !!(v.base && v.clientId && v.clientSecret), events: !!v.webhookSecret, inbound: !!v.serviceKey, support: !!sup.enabled };
  const n = Object.values(parts).filter(Boolean).length;
  const tests = { out: T['voosquare.ping_out'] || null, in: T['voosquare.ping_in'] || null };
  const bad = (tests.out && !tests.out.ok) || (tests.in && !tests.in.ok);
  return {
    state: n === 0 ? 'not_connected' : bad ? 'error' : n === 4 && tests.out?.ok && tests.in?.ok ? 'connected' : 'partial',
    parts, tests, issuer: v.issuer || null, base: v.base || null, api_key_set: !!v.apiKey, mode: sup.mode || 'both', events_url: sup.events_url || v.supportEventsUrl,
    last_inbound_at: (require('./settings').getSetting('voosquare_last_inbound') || {}).at || null, ...pasteBack(),
  };
}

// Step 3: both directions. Never throws; records the results for the status chip.
async function ping() {
  const integ = require('./integrations');
  const voosquare = require('./voosquare');
  const v = config.voosquare;
  let sup = {};
  try { sup = require('./support').settings().voosquare; } catch {}
  const url = sup.events_url || v.supportEventsUrl;
  let out;
  if (!v.webhookSecret) out = { ok: false, note: 'No signing secret yet. Run step 2.' };
  else if (isMockHost(url)) {
    const body = JSON.stringify({ event_id: 'va_ping_' + id(6), type: 'ping', tool: 'vooads', occurred_at: new Date().toISOString() });
    const sig = voosquare.sign(body);
    const okSig = sig === voosquare.sign(body, v.webhookSecret);
    out = { ok: okSig, mock: true, note: okSig ? `Test mode (${new URL(url).hostname}): a signed ping was built and its signature checked here. Use the real VooSquare address to send it for real.` : 'Could not sign the ping.' };
  } else {
    const body = JSON.stringify({ event_id: 'va_ping_' + id(6), type: 'ping', tool: 'vooads', occurred_at: new Date().toISOString() });
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voo-Signature': voosquare.sign(body), 'X-Voo-Tool': 'vooads' }, body, signal: AbortSignal.timeout(10e3) });
      out = r.ok ? { ok: true, note: 'VooSquare accepted a signed ping at ' + url } : { ok: false, note: url + ' answered HTTP ' + r.status + (r.status === 401 ? ': the signing secret does not match.' : '') };
    } catch (e) { out = { ok: false, note: 'Could not reach ' + url + ': ' + e.message }; }
  }
  integ.record('voosquare.ping_out', out);
  let inn;
  if (!v.serviceKey) inn = { ok: false, note: 'No service key yet. Run step 2.' };
  else if (!sup.enabled) inn = { ok: false, note: 'Switch on "Answer tickets from VooSquare" first.' };
  else {
    try {
      const r = await fetch(`http://127.0.0.1:${config.port}/api/voosquare/support/stats`, { headers: { Authorization: 'Bearer ' + v.serviceKey }, signal: AbortSignal.timeout(8e3) });
      const d = await r.json().catch(() => ({}));
      inn = r.ok ? { ok: true, note: `Inbound API answers with the service key (${d.counts?.open ?? 0} open tickets). VooSquare can read and reply.` } : { ok: false, note: 'Inbound API answered HTTP ' + r.status + ': ' + (d.error || '') };
    } catch (e) { inn = { ok: false, note: 'Inbound check failed: ' + e.message }; }
  }
  integ.record('voosquare.ping_in', inn);
  return { out, in: inn, status: status() };
}

// ---------- Agents ----------
const AGENTS_KEY = 'voosquare_agents';
function agentSettings() {
  const { getSetting } = require('./settings');
  const s = getSetting(AGENTS_KEY) || {};
  let def = s.default_role_id;
  if (def === undefined) def = get("SELECT id FROM roles WHERE name = 'Support'")?.id ?? null; // first run: the Support role
  return { default_role_id: def === 'none' ? null : def, map: Array.isArray(s.map) ? s.map : [] };
}
function saveAgents(b) {
  const { setSetting } = require('./settings');
  const cur = agentSettings();
  const next = { default_role_id: cur.default_role_id ?? 'none', map: cur.map };
  if (b.default_role_id !== undefined) {
    if (b.default_role_id === null || b.default_role_id === '' || b.default_role_id === 'none') next.default_role_id = 'none';
    else { const r = get('SELECT * FROM roles WHERE id = ?', Number(b.default_role_id)); if (!r) fail(400, 'Pick a role for unmapped agents.'); if (J(r.permissions).includes('*')) fail(400, 'VooSquare agents cannot get the Owner role.'); next.default_role_id = r.id; }
  }
  if (b.map !== undefined) {
    if (!Array.isArray(b.map) || b.map.length > 500) fail(400, 'Send the agent list as a list.');
    const seen = new Set();
    next.map = b.map.map((x) => {
      const email = String(x.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Each agent needs a valid email.');
      if (seen.has(email)) fail(400, email + ' is listed twice.');
      seen.add(email);
      const r = get('SELECT * FROM roles WHERE id = ?', Number(x.role_id));
      if (!r) fail(400, 'Pick a role for ' + email + '.');
      if (J(r.permissions).includes('*')) fail(400, 'VooSquare agents cannot get the Owner role.');
      return { email, role_id: r.id, name: String(x.name || '').slice(0, 60) };
    });
  }
  setSetting(AGENTS_KEY, next);
  return agentSettings();
}
const J = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

// Who a VooSquare agent is in Vooads: {email, name, staff, role, source}. Throws 403 when they have no role.
function resolveAgent(agent) {
  const email = String(agent.email || '').toLowerCase();
  const s = agentSettings();
  const mapped = s.map.find((x) => x.email === email);
  const staff = get("SELECT * FROM staff WHERE email = ? AND status = 'active'", email) || null;
  let role = null, source = null;
  if (mapped) { role = get('SELECT * FROM roles WHERE id = ?', mapped.role_id); source = 'map'; }
  else if (staff) { role = get('SELECT * FROM roles WHERE id = ?', staff.role_id); source = 'staff'; }
  else if (s.default_role_id) { role = get('SELECT * FROM roles WHERE id = ?', s.default_role_id); source = 'default'; }
  if (!role) fail(403, `VooSquare agent ${email} has no Vooads role. Map them in Admin → Integrations → VooSquare.`);
  const perms = J(role.permissions);
  // Agents never act as an owner, even when mapped through an owner's staff account.
  const safePerms = perms.includes('*') ? Object.keys(auth.PERMISSIONS) : perms;
  let limits = {};
  try { limits = JSON.parse(role.limits || '{}'); } catch {}
  return { email, name: agent.name, id: agent.id, staff, role: { id: role.id, name: role.name }, perms: safePerms, limits, source };
}
const agentCan = (a, p) => a.perms.includes(p);
function agentRequire(a, p, what) { if (!agentCan(a, p)) fail(403, `VooSquare agent ${a.email} (${a.role.name}) cannot ${what}.`); }
function agentGrantCheck(a, amount) {
  agentRequire(a, 'users.credits', 'give credits');
  const used = require('./team').agentGrantedToday(a.email);
  const why = roles.grantProblem(a.limits, amount, used, false);
  if (why) fail(403, why);
}
// Ticket scope for agents: "assigned" roles only touch tickets assigned to them (in VooSquare or in Vooads).
function agentTicket(a, t) {
  if (a.limits.ticket_scope === 'assigned') {
    const mine = (t.assignee_ext_id && [String(a.id), a.email].includes(String(t.assignee_ext_id))) || (a.staff && t.assignee_staff_id === a.staff.id);
    if (!mine) fail(403, 'This ticket is not assigned to ' + a.email + '.');
  }
  if (t.category === 'call' && !agentCan(a, 'calls.handle')) fail(403, `VooSquare agent ${a.email} (${a.role.name}) cannot handle callback requests.`);
  return t;
}

module.exports = { decodeCode, encode, connect, rotateKeys, status, ping, pasteBack, agentSettings, saveAgents, resolveAgent, agentCan, agentRequire, agentGrantCheck, agentTicket, isMockHost, PREFIX };
