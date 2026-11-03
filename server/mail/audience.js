// Mail: who gets a campaign. An audience is a plain object from the admin:
//   { source: 'users' | 'contacts', plans: ['free', 'pro', ...], buyer: 'any' | 'paid' | 'no_purchase',
//     spend_min, spend_max, active: 'any' | 'within' | 'not_within', active_days, countries: ['NG', ...],
//     signup_from: 'YYYY-MM-DD', signup_to: 'YYYY-MM-DD', tags: ['vip', ...] }
// Always excluded: banned or suspended customers, people who unsubscribed (from marketing, or from product updates for
// product mail), contacts without consent, and addresses on the suppression list (bounces and spam complaints).
const { get, all } = require('../db');
const { now, addDays } = require('../lib/util');
const store = require('./store');

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CAT = (c) => (c === 'product' ? 'product' : 'marketing');

function clean(a = {}) {
  const arr = (v, re, n = 30) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter((x) => re.test(x)).slice(0, n);
  const money = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
  return {
    source: a.source === 'contacts' ? 'contacts' : 'users',
    plans: arr(a.plans, /^[\w-]{1,40}$/),
    buyer: ['paid', 'no_purchase'].includes(a.buyer) ? a.buyer : 'any',
    spend_min: money(a.spend_min), spend_max: money(a.spend_max),
    active: ['within', 'not_within'].includes(a.active) ? a.active : 'any',
    active_days: Math.max(1, Math.min(3650, Math.round(Number(a.active_days)) || 30)),
    countries: arr(a.countries, /^[A-Za-z]{2}$/, 60).map((c) => c.toUpperCase()),
    signup_from: DAY.test(a.signup_from || '') ? a.signup_from : '', signup_to: DAY.test(a.signup_to || '') ? a.signup_to : '',
    tags: arr(a.tags, /^[\w -]{1,40}$/).map(store.cleanTag).filter(Boolean),
  };
}

// True when the audience is "every customer" (no filter narrows it). Only owners and admins may send that.
function isEveryone(a) {
  const x = clean(a);
  return x.source === 'users' && !x.plans.length && x.buyer === 'any' && x.spend_min === null && x.spend_max === null && x.active === 'any'
    && !x.countries.length && !x.signup_from && !x.signup_to && !x.tags.length;
}

// SQL for eligible recipients: returns { sql, params } selecting (user_id, contact_id, email, name).
function query(a, category) {
  const x = clean(a);
  const cat = CAT(category);
  const w = [], p = [];
  const t = now();
  if (x.source === 'contacts') {
    w.push('c.consent = 1', 'c.unsubscribed = 0', 'c.email NOT IN (SELECT email FROM mail_suppress)');
    w.push(`COALESCE((SELECT ${cat} FROM mail_prefs mp WHERE mp.email = c.email), 1) = 1`);
    // Someone who is also a customer follows the customer rules (status, opt-out) instead.
    w.push("NOT EXISTS (SELECT 1 FROM users u2 WHERE lower(u2.email) = c.email AND (u2.status != 'active' OR u2.marketing_opt_in = 0))");
    if (x.countries.length) { w.push(`upper(COALESCE(c.country,'')) IN (${x.countries.map(() => '?').join(',')})`); p.push(...x.countries); }
    if (x.signup_from) { w.push('c.created_at >= ?'); p.push(x.signup_from); }
    if (x.signup_to) { w.push('c.created_at < ?'); p.push(addDays(x.signup_to + 'T00:00:00Z', 1).replace('T', ' ').slice(0, 19)); }
    if (x.tags.length) { w.push(`c.email IN (SELECT email FROM mail_tags WHERE tag IN (${x.tags.map(() => '?').join(',')}))`); p.push(...x.tags); }
    return { sql: `SELECT NULL AS user_id, c.id AS contact_id, c.email AS email, c.name AS name FROM mail_contacts c WHERE ${w.join(' AND ')}`, params: p, x };
  }
  w.push("u.status = 'active'", 'lower(u.email) NOT IN (SELECT email FROM mail_suppress)');
  if (cat === 'marketing') w.push('u.marketing_opt_in = 1');
  else w.push('COALESCE((SELECT product FROM mail_prefs mp WHERE mp.email = lower(u.email)), 1) = 1', 'u.marketing_opt_in = 1');
  if (x.plans.length) {
    const named = x.plans.filter((pl) => pl !== 'free');
    const ors = [];
    if (named.length) { ors.push(`(u.plan_id IN (${named.map(() => '?').join(',')}) AND u.plan_expires_at > ?)`); p.push(...named, t); }
    if (x.plans.includes('free')) { ors.push('(u.plan_id IS NULL OR u.plan_expires_at IS NULL OR u.plan_expires_at <= ?)'); p.push(t); }
    w.push('(' + ors.join(' OR ') + ')');
  }
  const paid = "EXISTS (SELECT 1 FROM payments pp WHERE pp.user_id = u.id AND pp.status = 'paid')";
  if (x.buyer === 'paid') w.push(paid);
  if (x.buyer === 'no_purchase') w.push('NOT ' + paid);
  const spend = "(SELECT COALESCE(SUM(amount_usd), 0) FROM payments ps WHERE ps.user_id = u.id AND ps.status = 'paid')";
  if (x.spend_min !== null) { w.push(spend + ' >= ?'); p.push(x.spend_min); }
  if (x.spend_max !== null) { w.push(spend + ' <= ?'); p.push(x.spend_max); }
  if (x.active !== 'any') {
    const since = addDays(t, -x.active_days);
    if (x.active === 'within') { w.push('u.last_seen_at >= ?'); p.push(since); }
    else { w.push('(u.last_seen_at IS NULL OR u.last_seen_at < ?)'); p.push(since); }
  }
  if (x.countries.length) { w.push(`upper(COALESCE(u.country,'')) IN (${x.countries.map(() => '?').join(',')})`); p.push(...x.countries); }
  if (x.signup_from) { w.push('u.created_at >= ?'); p.push(x.signup_from); }
  if (x.signup_to) { w.push('u.created_at < ?'); p.push(addDays(x.signup_to + 'T00:00:00Z', 1).replace('T', ' ').slice(0, 19)); }
  if (x.tags.length) { w.push(`lower(u.email) IN (SELECT email FROM mail_tags WHERE tag IN (${x.tags.map(() => '?').join(',')}))`); p.push(...x.tags); }
  return { sql: `SELECT u.id AS user_id, NULL AS contact_id, lower(u.email) AS email, u.name AS name FROM users u WHERE ${w.join(' AND ')}`, params: p, x };
}

function count(a, category) {
  const q = query(a, category);
  const n = get(`SELECT COUNT(*) AS c FROM (${q.sql})`, ...q.params).c;
  const sample = all(`${q.sql} ORDER BY email LIMIT 5`, ...q.params).map((r) => ({ email: r.email, name: r.name || '' }));
  // How many the same filters would reach without the always-on exclusions (shown as "not included").
  let excluded = null;
  if (q.x.source === 'users') {
    excluded = {
      banned_or_paused: get("SELECT COUNT(*) AS c FROM users WHERE status != 'active'").c,
      unsubscribed: get("SELECT COUNT(*) AS c FROM users WHERE status = 'active' AND marketing_opt_in = 0").c,
      suppressed: get('SELECT COUNT(*) AS c FROM mail_suppress').c,
    };
  } else {
    excluded = { no_consent: get('SELECT COUNT(*) AS c FROM mail_contacts WHERE consent = 0').c, unsubscribed: get('SELECT COUNT(*) AS c FROM mail_contacts WHERE unsubscribed = 1').c, suppressed: get('SELECT COUNT(*) AS c FROM mail_suppress').c };
  }
  return { count: n, sample, excluded, everyone: isEveryone(a), audience: q.x };
}
const recipients = (a, category) => { const q = query(a, category); return all(q.sql, ...q.params); };

// Is this one address still allowed to get this campaign right now? (checked again just before sending)
function stillEligible(send, category) {
  const cat = CAT(category);
  if (store.suppressed(send.email)) return 'suppressed';
  const u = get('SELECT status, marketing_opt_in FROM users WHERE lower(email) = ?', send.email);
  if (u && u.status !== 'active') return 'account ' + u.status;
  const pr = store.prefs(send.email);
  if (!pr.marketing) return 'unsubscribed';
  if (cat === 'product' && !pr.product) return 'unsubscribed';
  if (!u && send.contact_id) {
    const c = get('SELECT consent, unsubscribed FROM mail_contacts WHERE id = ?', send.contact_id);
    if (!c || !c.consent || c.unsubscribed) return 'unsubscribed';
  }
  return null;
}

function options() {
  const { pricing } = require('../settings');
  return {
    plans: [{ id: 'free', name: 'Free (no plan)' }, ...(pricing().plans || []).map((p) => ({ id: p.id, name: p.name }))],
    countries: all("SELECT upper(country) AS c, COUNT(*) AS n FROM users WHERE country IS NOT NULL AND country != '' GROUP BY upper(country) UNION ALL SELECT upper(country), COUNT(*) FROM mail_contacts WHERE country IS NOT NULL AND country != '' GROUP BY upper(country)")
      .reduce((m, r) => { m[r.c] = (m[r.c] || 0) + r.n; return m; }, {}),
    tags: all('SELECT tag, COUNT(*) AS n FROM mail_tags GROUP BY tag ORDER BY n DESC LIMIT 100'),
    contacts: get('SELECT COUNT(*) AS c FROM mail_contacts WHERE consent = 1 AND unsubscribed = 0').c,
    users: get("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").c,
  };
}

module.exports = { clean, query, count, recipients, isEveryone, stillEligible, options };
