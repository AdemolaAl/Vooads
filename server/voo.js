// VooSquare through the Voo Connect kit (../voo-connect, copied UNCHANGED from VooSquare's sdk/voo-connect, version in
// voo-connect/package.json; never edit it, copy a new version over it). This is the same kit and the same rules as
// Replyvoo, Castvoo, Joinvoo and Spyvoo:
//
//  1. Login: "Continue with VooSquare" next to Vooads' own email-code login (which keeps working).
//     A Voo ID is found by users.voo_id first. It is linked to an existing Vooads account only when
//       (a) that account is logged in and pressed "Connect VooSquare" (Settings), or
//       (b) the email is verified on BOTH sides (VooSquare says email_verified, and Vooads proved the inbox with a
//           login code), the account has no Voo ID yet and the email is not a staff email.
//     Otherwise a new account. Never a second account with the same email.
//  2. "You already have a Voo account": a NEW email that already has a Voo ID is asked to log in with VooSquare
//     (asked only after the person proved the email with a login code, so nobody can probe emails).
//  3. Events: plan payments are reported as spend + plan_started (stable ids from the payment id), top-ups as
//     wallet_topup, and a light activity event when an ad is made. Queued in our database, sent every few seconds.
//  4. Summary card (GET /api/voosquare/summary): Bearer VOO_API_KEY (kit) or the older inbound service key.
//
// Settings: Admin → Integrations → VooSquare (saved encrypted) or the environment: VOO_BASE, VOO_CLIENT_ID,
// VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET (VOO_SERVER_BASE and VOO_REDIRECT_URI optional, VOO_CONNECT=off
// switches every VooSquare feature off). Admin values win.
const path = require('node:path');
const config = require('./config');
const { get, all, run, tx } = require('./db');
const { fail } = require('./lib/http');

const KIT = require(path.join(__dirname, '..', 'voo-connect'));
const off = () => /^(0|off|false|no)$/i.test(String(process.env.VOO_CONNECT || ''));

// Outbox in our own database (one row) so queued events survive restarts and deploys.
run('CREATE TABLE IF NOT EXISTS voo_queue (id INTEGER PRIMARY KEY CHECK (id = 1), queue TEXT NOT NULL, updated_at TEXT)');
run('CREATE TABLE IF NOT EXISTS voo_failed (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, type TEXT, error TEXT, body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
// users.email_verified: 1 when Vooads proved the inbox (every email-code login does; existing accounts all came in
// that way). A Voo ID account made from VooSquare copies VooSquare's email_verified. users.voo_linked_at: when linked.
try {
  const cols = all('PRAGMA table_info(users)').map((c) => c.name);
  if (!cols.includes('email_verified')) run('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('voo_linked_at')) run('ALTER TABLE users ADD COLUMN voo_linked_at TEXT');
} catch (e) { console.error('[voosquare] migrate', e.message); }
const dbStore = {
  load() { try { const r = get('SELECT queue FROM voo_queue WHERE id = 1'); return r ? JSON.parse(r.queue) : []; } catch { return []; } },
  save(list) { run('INSERT INTO voo_queue (id, queue, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET queue = excluded.queue, updated_at = excluded.updated_at', JSON.stringify(list), new Date().toISOString()); },
};

// Effective settings (admin first, then the environment).
function cfg() {
  const v = config.voosquare;
  return {
    on: !off(),
    base: String(v.base || '').replace(/\/+$/, ''),
    serverBase: String(process.env.VOO_SERVER_BASE || '').replace(/\/+$/, ''),
    clientId: v.clientId || '',
    clientSecret: v.clientSecret || '',
    apiKey: v.apiKey || '',
    signalSecret: v.signalSecret || '',
    redirectUri: process.env.VOO_REDIRECT_URI || config.appUrl + '/auth/voosquare/callback',
  };
}
const loginOn = (c = cfg()) => !!(c.on && c.base && c.clientId && c.clientSecret);
const eventsOn = (c = cfg()) => !!(c.on && c.base && c.apiKey);

let inst = null, instKey = '', started = false;
function kit() {
  const c = cfg();
  if (!loginOn(c) && !eventsOn(c)) return null;
  const key = [c.base, c.serverBase, c.clientId, c.clientSecret, c.apiKey, c.signalSecret, c.redirectUri].join('|');
  if (inst && instKey === key) return inst;
  if (inst) inst.events.stop();
  inst = KIT.createVooConnect({
    base: c.base, serverBase: c.serverBase || undefined, clientId: c.clientId, clientSecret: c.clientSecret, apiKey: c.apiKey,
    signalSecret: c.signalSecret || undefined, redirectUri: c.redirectUri, eventPrefix: 'va', toolName: 'vooads',
    defaultReturnTo: '/app', secureCookies: config.appUrl.startsWith('https://') ? true : undefined, store: dbStore, timeoutMs: 10000,
    backoffMs: Number(process.env.VOO_BACKOFF_MS) || undefined,
    onRejected(ev, error) {
      console.warn('[voosquare] event refused: ' + ev.event_id + ' (' + error + ')');
      try { run('INSERT INTO voo_failed(event_id, type, error, body) VALUES(?,?,?,?)', ev.event_id, ev.type || '', String(error).slice(0, 300), JSON.stringify(ev)); } catch {}
    },
    onError(err) { console.warn('[voosquare] ' + err.message); },
  });
  instKey = key;
  if (started) { started = false; start(); }
  return inst;
}
function start(ms = Number(process.env.VOO_FLUSH_MS) || 5000) {
  const k = eventsOn() && kit();
  if (!k || started) return false;
  k.events.start(ms);
  started = true;
  return true;
}
function reset() { if (inst) inst.events.stop(); inst = null; instKey = ''; started = false; }

/* ---------------- login ---------------- */
// Where a login may land: the studio (any of its views) or the admin. VooSquare's launcher may ask for /dashboard.
function safeReturn(r) {
  const s = String(r || '');
  if (s === '/dashboard' || s.startsWith('/dashboard?')) return '/app';
  return (/^\/app(\/|\?|#|$)/.test(s) || /^\/admin(\/|\?|#|$)/.test(s)) && !s.startsWith('//') && !/[\\\u0000-\u001F\s]/.test(s) ? s.slice(0, 300) : '/app';
}
function startLogin(req, res, { returnTo, signup } = {}) { return kit().startLogin(req, res, { returnTo: safeReturn(returnTo), signup: !!signup }); }

const LOGIN_ERRORS = {
  access_denied: 'You cancelled the VooSquare login.',
  state_missing: 'This login took too long or was opened in another browser. Please try again.',
  state_mismatch: 'This login link was opened in another browser. Please try again.',
  state_expired: 'This login took too long. Please try again.',
  invalid_grant: 'This login link was already used or has expired. Please try again.',
  invalid_client: 'Vooads’ VooSquare settings are wrong. Please log in with your email for now.',
  invalid_id_token: 'VooSquare login could not be verified. Please try again.',
  network: 'VooSquare could not be reached. Please try again in a moment.',
  timeout: 'VooSquare could not be reached. Please try again in a moment.',
};
async function finishLogin(req, res) {
  try {
    const { user, returnTo } = await kit().handleCallback(req, res);
    return { vu: user, returnTo: safeReturn(returnTo) };
  } catch (e) {
    if (e.status && !e.code) throw e;
    if (!LOGIN_ERRORS[e.code]) console.error('[voosquare] login', e.code || '', e.message);
    fail(e.code === 'network' || e.code === 'timeout' ? 502 : 400, LOGIN_ERRORS[e.code] || 'VooSquare login did not finish. Please try again.');
  }
}
function logoutUrl() { return loginOn() ? kit().logoutUrl(config.appUrl + '/') : '/'; }

const cleanCountry = (c) => (/^[A-Za-z]{2}$/.test(String(c || '')) ? String(c).toUpperCase() : '');
const isStaffEmail = (email) => !!get("SELECT 1 FROM staff WHERE email = ? AND status = 'active'", email);

// Finds or creates the Vooads user for a Voo ID. current = the account that pressed "Connect VooSquare".
// createUser(fields) is passed in by routes/api.js (it gives trial credits and sends the welcome email).
function linkOrCreate(vu, current, createUser) {
  const vooId = String(vu.voo_id || vu.sub || '').slice(0, 200);
  if (!vooId) fail(400, 'VooSquare did not send a Voo ID.');
  const email = String(vu.email || '').trim().toLowerCase().slice(0, 200);
  const verified = vu.email_verified === true;
  const name = String(vu.name || '').trim().slice(0, 60);
  const country = cleanCountry(vu.country);
  const ref = String(vu.voo_ref || '').trim().slice(0, 64);
  return tx(() => {
    const byVoo = get('SELECT * FROM users WHERE voo_id = ?', vooId);
    const link = (u, how) => {
      run('UPDATE users SET voo_id = ?, voo_linked_at = ? WHERE id = ? AND (voo_id IS NULL OR voo_id = ?)', vooId, new Date().toISOString(), u.id, vooId);
      const out = get('SELECT * FROM users WHERE id = ?', u.id);
      if (out.voo_id !== vooId) fail(409, 'This Vooads account is already connected to another Voo ID.');
      if (country && !out.country) run('UPDATE users SET country = ? WHERE id = ?', country, u.id);
      console.log('[voosquare] linked user', u.id, 'by', how);
      return get('SELECT * FROM users WHERE id = ?', u.id);
    };
    // (a) "Connect VooSquare" pressed in Settings by this same session.
    if (current) {
      const me = get('SELECT * FROM users WHERE id = ?', current.id);
      if (byVoo && byVoo.id !== me.id) fail(409, 'That Voo ID is already connected to another Vooads account.');
      if (me.voo_id && me.voo_id !== vooId) fail(409, 'Your Vooads account is already connected to another Voo ID.');
      return { user: me.voo_id === vooId ? me : link(me, 'connect'), isNew: false, linked: me.voo_id !== vooId };
    }
    if (byVoo) {
      const patch = {};
      if (country && !byVoo.country) patch.country = country;
      if (name && !byVoo.name) patch.name = name;
      const keys = Object.keys(patch);
      if (keys.length) run(`UPDATE users SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), byVoo.id);
      return { user: { ...byVoo, ...patch }, isNew: false, linked: false };
    }
    // (b) Same email, verified on both sides.
    if (email) {
      const same = get('SELECT * FROM users WHERE email = ?', email);
      if (same) {
        if (same.voo_id) fail(409, 'This email is already connected to another Voo ID. Contact support and we will sort it out.');
        if (!verified) fail(409, 'There is already a Vooads account with this email. Confirm your email in VooSquare first, or log in to Vooads with an email code and press “Connect VooSquare” in Settings.');
        if (!same.email_verified) fail(409, 'There is already a Vooads account with this email that has not been confirmed. Log in to Vooads with an email code, then press “Connect VooSquare” in Settings.');
        if (isStaffEmail(email)) fail(409, 'Staff emails are never connected automatically. Log in with an email code, then press “Connect VooSquare” in Settings.');
        return { user: link(same, 'email'), isNew: false, linked: true };
      }
    }
    // (c) A new account.
    if (!email) fail(400, 'Your Voo ID has no email address. Add one in VooSquare and try again.');
    const user = createUser({ email, name, country, ref, vooId, emailVerified: verified });
    run('UPDATE users SET voo_linked_at = ? WHERE id = ?', new Date().toISOString(), user.id);
    return { user: get('SELECT * FROM users WHERE id = ?', user.id), isNew: true, linked: false };
  });
}

// "You already have a Voo account": POST /api/v1/users/lookup with the tool API key. Any problem means "no".
async function vooIdExists(email) {
  const c = cfg();
  if (!loginOn(c) || !c.apiKey || !email) return false;
  try {
    const r = await fetch((c.serverBase || c.base) + '/api/v1/users/lookup', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(2500),
      headers: { authorization: 'Bearer ' + c.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: String(email).trim().toLowerCase() }),
    });
    return r.ok && (await r.json()).voo_id_exists === true;
  } catch { return false; }
}

/* ---------------- events ---------------- */
// Plan payment → spend + plan_started (or plan_renewed). Top-up → wallet_topup. Ids come from the payment id, so a
// repeat (webhook retries, a second markPaid) is the same event and VooSquare never counts it twice.
function reportPayment(user, p, { renewed = false, planName = '' } = {}) {
  const k = eventsOn() && kit();
  if (!k || !user?.voo_id || !(Number(p.amount_usd) > 0)) return false;
  const value = Math.round(Number(p.amount_usd) * 100) / 100;
  const at = p.paid_at ? new Date(String(p.paid_at).replace(' ', 'T') + (String(p.paid_at).endsWith('Z') ? '' : 'Z')) : new Date();
  const country = cleanCountry(user.country) || undefined;
  try {
    if (p.kind === 'plan') {
      // paymentRef (kit 1.3.0): the processor's own reference (Gatevoo invoice id, Paystack/Stripe reference), so VooSquare never
      // pays the same payment twice when it arrives again under another event id.
      const key = require('./voomoney').eventKey(p.id) || p.id; // stable random key (old payments keep their row id)
      const paymentRef = String(p.provider_ref || 'VA-' + key).replace(/[^A-Za-z0-9_.:\/#@+=-]/g, '-').slice(0, 120);
      k.events.spend({ eventId: k.events.id('pay', key), vooId: user.voo_id, valueUsd: value, plan: p.plan_id || undefined, label: (planName || 'Plan') + ' plan', country, occurredAt: at, paymentRef });
      const e = { eventId: k.events.id(renewed ? 'renew' : 'plan', key), vooId: user.voo_id, valueUsd: value, plan: p.plan_id || 'plan', label: planName || 'Plan', country, occurredAt: at };
      if (renewed) k.events.planRenewed(e); else k.events.planStarted(e);
    } else {
      // Not commissionable: the usage spends (server/voomoney.js) carry the pack's commission as its credits are used.
      k.events.walletTopup({ eventId: k.events.id('topup', require('./voomoney').eventKey(p.id) || p.id), vooId: user.voo_id, valueUsd: value, label: (p.credits || 0) + ' credits', country, occurredAt: at });
    }
    return true;
  } catch (e) { console.warn('[voosquare] payment event', e.message); return false; }
}
function reportActivity(user, type, label) {
  const k = eventsOn() && kit();
  if (!k || !user?.voo_id) return false;
  // One activity event per user per type per hour at most (ads_generated can be frequent).
  const hour = new Date().toISOString().slice(0, 13);
  try { k.events.activity(type, { eventId: k.events.id(type, user.voo_id, hour), vooId: user.voo_id, label: String(label || '').slice(0, 120) }); return true; } catch { return false; }
}
function reportCancelled(user, planId) {
  const k = eventsOn() && kit();
  if (!k || !user?.voo_id) return false;
  try { k.events.planCancelled({ eventId: k.events.id('cancel', user.voo_id, new Date().toISOString().slice(0, 10)), vooId: user.voo_id, plan: planId || 'plan', label: 'Auto-renew off' }); return true; } catch { return false; }
}

// Summary card numbers (also used by the older service-key route).
function summary(vooId, period) {
  const credits = require('./credits');
  const u = vooId ? get('SELECT * FROM users WHERE voo_id = ?', String(vooId)) : null;
  if (!u || u.status !== 'active') return null;
  const days = { '1d': 1, '7d': 7, '30d': 30 }[period] || 1;
  const fmt = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
  const since = fmt(new Date(Date.now() - days * 864e5)), prev = fmt(new Date(Date.now() - 2 * days * 864e5));
  const made = (a, b) => get("SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND status = 'done' AND created_at >= ? AND created_at < ?", u.id, a, b).c;
  const now = fmt(new Date(Date.now() + 1000));
  const cur = made(since, now), before = made(prev, since);
  const langs = get("SELECT COUNT(DISTINCT json_extract(input, '$.language')) AS c FROM jobs WHERE user_id = ? AND created_at >= ?", u.id, since).c;
  const plan = credits.activePlan(u);
  return {
    status: plan ? 'active' : u.trial_credits > 0 ? 'trial' : 'none',
    metrics: [
      { key: 'ads_made', label: 'Ads made', value: cur, unit: 'count', change_pct: before ? Math.round(((cur - before) / before) * 1000) / 10 : cur ? 100 : 0 },
      { key: 'languages_used', label: 'Languages', value: langs, unit: 'count' },
      { key: 'credits_left', label: 'Credits left', value: credits.balance(u).total, unit: 'count' },
    ],
    open_url: config.appUrl + '/app',
  };
}

function publicInfo() {
  const c = cfg();
  const b = c.base || 'https://voosquare.com';
  return { enabled: loginOn(c), home_url: b, apps_url: b + '/app', login_url: '/auth/voosquare', signup_url: '/auth/voosquare?signup=1&return_to=%2Fapp' };
}
function adminInfo() {
  const c = cfg();
  return {
    login: loginOn(c), events: eventsOn(c), base: c.base, client_id: c.clientId, redirect_uri: c.redirectUri, logout_uri: config.appUrl + '/',
    launch_path: '/app', summary_url: config.appUrl + '/api/voosquare/summary', kit_version: KIT.VERSION, switched_off: off(),
    pending_events: (() => { try { return dbStore.load().length; } catch { return 0; } })(),
    refused_events: all('SELECT event_id, type, error, created_at FROM voo_failed ORDER BY id DESC LIMIT 20'),
  };
}

module.exports = { KIT, cfg, kit, start, reset, loginOn, eventsOn, safeReturn, startLogin, finishLogin, logoutUrl, linkOrCreate, vooIdExists, reportPayment, reportActivity, reportCancelled, summary, publicInfo, adminInfo, dbStore };
