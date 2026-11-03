// Mail: builds each person's email (personalized, tracked) and sends campaigns through Resend from a background worker.
//
// How a campaign is sent, safely:
//  1. "Send now" or a schedule time that has passed: the worker writes one row per recipient into mail_sends in a single
//     transaction (UNIQUE(campaign_id, email) means nobody is added twice, even if this runs again after a restart).
//  2. Every few seconds the worker takes the next rows that are due, within the rate limit (Mail → Settings), and claims
//     each one (queued → sending) before calling Resend. Resend gets an Idempotency-Key per row, so if the server stops
//     between "sent" and "saved", the retry after a restart does not deliver a second copy.
//  3. Failures retry with back-off (1, 5, 15 minutes …) up to the attempt limit; then the row is marked failed.
//  4. Pause stops picking rows; Cancel marks the rows still waiting as cancelled. Nothing is lost on restart: it all lives
//     in the database.
// Without RESEND_API_KEY nothing leaves the server: emails are printed in the log (like the rest of the app) and marked sent.
const config = require('../config');
const { get, all, run, tx } = require('../db');
const { hmac, safeEqual, now, addDays } = require('../lib/util');
const store = require('./store');
const render = require('./render');
const uploads = require('./uploads');
const audience = require('./audience');

const RESEND = () => (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/$/, '');

// ---------- Signed links ----------
const sig = (token, url) => hmac('sha256', config.appSecret, 'mail-click:' + token + ':' + url).slice(0, 32);
const clickUrl = (token, url) => `${config.appUrl}/m/c/${token}?u=${encodeURIComponent(url)}&s=${sig(token, url)}`;
const verifyClick = (token, url, s) => !!url && /^https?:\/\//i.test(url) && safeEqual(sig(token, url), String(s || ''));
const urls = (token) => ({
  pixel: `${config.appUrl}/m/o/${token}.gif`,
  unsub: `${config.appUrl}/m/u/${token}`,
  prefs: `${config.appUrl}/m/p/${token}`,
});

function fromHeader(name) {
  const from = config.brand.fromEmail;
  const addr = (from.match(/<([^>]+)>/) || [, from])[1].trim();
  const n = String(name || '').replace(/[<>"\r\n@,;:]/g, '').trim() || store.settings().default_from_name || 'Vooads';
  return `${n} <${addr}>`;
}

// Values for {{first_name}}, {{credits}}, {{plan}}, {{email}}.
function varsFor({ user_id, email, name }) {
  const u = user_id ? get('SELECT * FROM users WHERE id = ?', user_id) : null;
  const nm = (u?.name || name || '').trim();
  const v = { first_name: nm.split(/\s+/)[0] || '', email: email || u?.email || '', credits: '', plan: '' };
  if (u) {
    try { v.credits = require('../credits').balance(u).total.toLocaleString('en-US'); } catch {}
    try { const { planById } = require('../settings'); v.plan = u.plan_id && u.plan_expires_at > now() ? (planById(u.plan_id)?.name || u.plan_id) : ''; } catch {}
  }
  return v;
}

// One recipient's finished email.
function buildFor(c, send, { test = false } = {}) {
  const doc = { subject: c.subject, preheader: c.preheader, blocks: c.blocks };
  const u = test ? null : urls(send.token);
  const msg = render.renderEmail(doc, {
    appUrl: config.appUrl, company: config.brand.company, support: config.brand.supportEmail,
    legal: /receipt/i.test(String(c.template_id || c.template || c.key || c.id || '')) || /^Receipt for|credits added to your account/i.test(String(c.subject || '')) ? config.brand.legalLine : null, // receipts carry the legal line
    vars: send.vars || varsFor(send),
    link: test ? (x) => x : (x) => clickUrl(send.token, x),
    pixel: test ? null : u.pixel,
    unsubUrl: test ? `${config.appUrl}/m/u/test` : u.unsub, prefsUrl: test ? `${config.appUrl}/m/p/test` : u.prefs,
  });
  const headers = test ? {} : { 'List-Unsubscribe': `<${u.unsub}>, <mailto:${config.brand.supportEmail}?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  return { ...msg, subject: (test ? '[Test] ' : '') + (msg.subject || '(no subject)'), headers };
}

// Send one email through Resend. Returns { id } or throws an Error with .retry (true for rate limits / server errors).
async function deliver({ to, from, subject, html, text, headers, attachments, idempotencyKey, tags }) {
  const key = config.email.resendKey;
  // Staging: campaigns only reach staff and the allowlist; everyone else is logged, never emailed (server/staging.js).
  if (!require('../staging').emailAllowed(to)) {
    console.log(`\n[mail:staging-blocked] To: ${to}\nSubject: ${subject}\n`);
    return { id: 'staging_blocked_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), logged: true, blocked: true };
  }
  if (!key) {
    console.log(`\n[mail:log] To: ${to}\nFrom: ${from}\nSubject: ${subject}${attachments?.length ? `\nAttachments: ${attachments.map((a) => a.filename).join(', ')}` : ''}\n${String(text).slice(0, 400)}\n`);
    return { id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), logged: true };
  }
  let r;
  try {
    r = await fetch(RESEND() + '/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: JSON.stringify({ from, to: [to], subject, html, text, reply_to: config.brand.supportEmail, headers, ...(attachments?.length ? { attachments } : {}), ...(tags ? { tags } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) { throw Object.assign(new Error('Could not reach Resend: ' + e.message), { retry: true }); }
  const body = await r.text();
  if (!r.ok) throw Object.assign(new Error(`Resend ${r.status}: ${body.slice(0, 200)}`), { retry: r.status === 429 || r.status >= 500 });
  try { return JSON.parse(body); } catch { return { id: null }; }
}

// ---------- Test email ----------
async function sendTest(c, staff) {
  const send = { email: staff.email, vars: { first_name: (staff.name || '').split(/\s+/)[0] || 'there', email: staff.email, credits: '1,250', plan: 'Pro' } };
  const msg = buildFor(c, send, { test: true });
  const attachments = uploads.attachmentsFor(c.attachments);
  return deliver({ to: staff.email, from: fromHeader(c.from_name), subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers, attachments });
}

// ---------- Worker ----------
// Writes the recipient rows for a campaign (once).
function materialize(cid) {
  return tx(() => {
    const c = store.campaign(cid);
    if (!c || c.materialized) return 0;
    const rows = audience.recipients(c.audience, c.category);
    const at = now();
    let n = 0;
    for (const r of rows) {
      n += Number(run('INSERT OR IGNORE INTO mail_sends(campaign_id, user_id, contact_id, email, name, token, next_at) VALUES(?,?,?,?,?,?,?)',
        c.id, r.user_id, r.contact_id, String(r.email).toLowerCase(), r.name || null, store.newToken(), at).changes);
    }
    run("UPDATE mail_campaigns SET materialized = 1, total = ?, status = 'sending', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?", n, at, at, c.id);
    return n;
  });
}

const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720];
let budget = 0, lastRefill = Date.now(), busy = false;
const attachCache = new Map(); // campaign id → base64 attachments (built once per campaign while it sends)

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const t = now();
    // Scheduled campaigns that are due start sending.
    for (const c of all("SELECT id FROM mail_campaigns WHERE status = 'scheduled' AND scheduled_at <= ?", t)) {
      run("UPDATE mail_campaigns SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'scheduled'", t, c.id);
    }
    for (const c of all("SELECT id FROM mail_campaigns WHERE status = 'sending' AND materialized = 0")) materialize(c.id);
    // Rows stuck in "sending" (the server stopped mid-send) go back to the queue; the idempotency key prevents doubles.
    run("UPDATE mail_sends SET status = 'queued', next_at = ? WHERE status = 'sending' AND claimed_at < ?", t, addDays(t, -2 / 1440));

    const s = store.settings();
    const perMs = s.rate_per_minute / 60000;
    budget = Math.min(s.rate_per_minute, budget + (Date.now() - lastRefill) * perMs);
    lastRefill = Date.now();
    const take = Math.floor(budget);
    if (take >= 1) {
      const due = all(`SELECT ms.*, c.category FROM mail_sends ms JOIN mail_campaigns c ON c.id = ms.campaign_id
        WHERE c.status = 'sending' AND ms.status = 'queued' AND (ms.next_at IS NULL OR ms.next_at <= ?) ORDER BY ms.id LIMIT ?`, t, take);
      for (const send of due) {
        if (!Number(run("UPDATE mail_sends SET status = 'sending', claimed_at = ? WHERE id = ? AND status = 'queued'", now(), send.id).changes)) continue;
        budget -= 1;
        await sendOne(send, s);
      }
    }
    // Finished campaigns.
    for (const c of all("SELECT id FROM mail_campaigns WHERE status = 'sending' AND materialized = 1")) {
      if (!get("SELECT 1 FROM mail_sends WHERE campaign_id = ? AND status IN ('queued', 'sending') LIMIT 1", c.id)) {
        run("UPDATE mail_campaigns SET status = 'sent', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'", now(), now(), c.id);
        attachCache.delete(c.id);
      }
    }
  } catch (e) {
    console.error('[mail worker]', e.message);
  } finally { busy = false; }
}

async function sendOne(send, s) {
  const c = store.campaign(send.campaign_id);
  const why = audience.stillEligible(send, c.category);
  if (why) { run("UPDATE mail_sends SET status = 'skipped', error = ? WHERE id = ?", why, send.id); return; }
  try {
    if (!attachCache.has(c.id)) attachCache.set(c.id, uploads.attachmentsFor(c.attachments));
    const msg = buildFor(c, send);
    const r = await deliver({
      to: send.email, from: fromHeader(c.from_name), subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers,
      attachments: attachCache.get(c.id), idempotencyKey: `vooads-mail-${c.id}-${send.id}`,
      tags: [{ name: 'campaign', value: String(c.id) }],
    });
    run("UPDATE mail_sends SET status = 'sent', sent_at = ?, provider_id = ?, error = NULL, attempts = attempts + 1 WHERE id = ?", now(), r?.id || null, send.id);
  } catch (e) {
    const attempts = send.attempts + 1;
    const final = !e.retry || attempts >= s.max_attempts; // e.g. an invalid address will never work: stop at once
    if (final) run("UPDATE mail_sends SET status = 'failed', attempts = ?, error = ? WHERE id = ?", attempts, e.message.slice(0, 300), send.id);
    else run("UPDATE mail_sends SET status = 'queued', attempts = ?, error = ?, next_at = ? WHERE id = ?", attempts, e.message.slice(0, 300), addDays(now(), BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] / 1440), send.id);
  }
}

let timer = null;
function start() {
  if (timer) return;
  const ms = Math.max(200, Number(process.env.MAIL_TICK_MS) || 4000);
  timer = setInterval(() => tick().catch(() => {}), ms);
  timer.unref();
  setTimeout(() => tick().catch(() => {}), 1500).unref();
}
const stop = () => { clearInterval(timer); timer = null; };

module.exports = { start, stop, tick, materialize, deliver, sendTest, buildFor, varsFor, fromHeader, clickUrl, verifyClick, sig, urls };
