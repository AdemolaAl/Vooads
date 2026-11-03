// Emails: templates live in the database (edited in Admin → Emails), sent through Resend.
// Without RESEND_API_KEY, emails are printed in the server log so you can test everything locally.
// The look (animated headers, stat cards, receipts) is in designs.js and layout.js; built-in copy is in
// content/emails/emails.json plus catalog.js.
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { get, all, run, J } = require('../db');
const { render, esc, hmac, now, addDays, id } = require('../lib/util');
const layout = require('./layout');
const catalog = require('./catalog');

// Emails people can opt out of. Everything else is transactional (receipts, codes, security, account, video status).
const SALES = ['sales_day2_first_video_nudge', 'sales_day4_case_study', 'sales_day6_objections', 'sales_day8_offer_last_call', 'sales_day12_founder_note', 'trial_inactive_48h', 'upgrade_after_first_hooks'];
const MARKETING = new Set([...SALES, 'onboarding_day1', 'onboarding_day2', 'onboarding_day3_plans', 'onboarding_day5_offer', 'winback_day14', 'trial_credits_low', 'trial_ended', 'paid_credits_low', 'weekly_digest']);
// Skip these once someone has paid.
const SKIP_IF_PAID = new Set([...SALES, 'onboarding_day1', 'onboarding_day2', 'onboarding_day3_plans', 'onboarding_day5_offer', 'trial_credits_low', 'trial_ended']);
// Template values that are already safe HTML (escaped by the module that sends them). Every other value is escaped
// before it goes into the email body, because some of them are typed by customers (product names, actor names).
const HTML_VARS = new Set(['trial_line', 'reply_html', 'reply_excerpt', 'message_html', 'ticket_body', 'phone_line', 'agent_name', 'customer_name']);

const ROUTES = {
  '/login': '/app', '/create?type=ugc': '/app#create', '/create': '/app#create', '/pricing': '/#pricing', '/settings/billing': '/app#wallet',
  '/scripts': '/app#create', '/settings/billing/top-up': '/app#wallet', '/referrals': '/app#refer', '/projects': '/app#library',
  '/legal/acceptable-use': '/legal/acceptable-use', '/legal/terms': '/legal/terms', '/legal': '/legal/terms',
};
function fixUrl(u) {
  return String(u || '').replace(/\{\{app_url\}\}(\/[A-Za-z0-9\/_-]*)(\?[^\s"'<]*)?/g, (m, p, q = '') => {
    const key = ROUTES[p + q] ? p + q : p;
    const mapped = ROUTES[key];
    if (!mapped) return m;
    const keep = q && !ROUTES[p + q] ? q : '';
    return '{{app_url}}' + (keep ? mapped.replace(/(#.*)?$/, keep + '$1') : mapped);
  });
}

const FIELDS = ['subject', 'preheader', 'heading', 'body_html', 'cta_label', 'cta_url'];
function originals() {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'content', 'emails', 'emails.json'), 'utf8'));
  return list.map((e) => ({ ...e, body_html: fixUrl(e.body_html), cta_url: fixUrl(e.cta_url) }));
}
// The built-in version of a template (what "Reset to default" restores).
function defaultFor(tid) {
  return catalog.all.find((x) => x.id === tid) || originals().find((x) => x.id === tid) || null;
}

function seedTemplates() {
  const orig = originals();
  const ins = (e) => run('INSERT INTO email_templates(id, trigger, delay, subject, preheader, heading, body_html, cta_label, cta_url) VALUES(?,?,?,?,?,?,?,?,?)',
    e.id, e.trigger, e.delay, e.subject, e.preheader, e.heading, e.body_html, e.cta_label, e.cta_url);
  for (const e of orig) if (!get('SELECT 1 FROM email_templates WHERE id = ?', e.id)) ins(e);
  for (const e of catalog.NEW) if (!get('SELECT 1 FROM email_templates WHERE id = ?', e.id)) ins(e);
  // New defaults for older templates, only while the stored copy is still the untouched original.
  for (const e of catalog.UPGRADED) {
    const row = get('SELECT * FROM email_templates WHERE id = ?', e.id);
    const o = orig.find((x) => x.id === e.id);
    if (!row || !o || !FIELDS.every((k) => String(row[k] ?? '') === String(o[k] ?? ''))) continue;
    run(`UPDATE email_templates SET trigger=?, ${FIELDS.map((k) => k + '=?').join(', ')}, updated_at=? WHERE id=?`, e.trigger, ...FIELDS.map((k) => e[k]), now(), e.id);
  }
}

const unsubToken = (uid) => hmac('sha256', config.appSecret, 'unsub:' + uid).slice(0, 24);

// Built-in plain versions used when a template id is not in the database yet (e.g. ticket emails). Modules add to this.
const FALLBACK_TEMPLATES = {};

// Numbers about credits and prices come from the live pricing config (content/pricing.json, or what the owner saved in
// Admin → Pricing). Email copy never hard-codes them. trial_credits can be passed (what this account actually got).
function livePricing(given) {
  const P = require('../settings').pricing();
  const trial = given !== undefined && given !== '' ? Number(String(given).replace(/,/g, '')) || 0 : Number(P.free_trial?.credits) || 0;
  const cheapest = Math.min(...(P.plans || []).map((p) => Number(p.price_month)).filter((x) => x > 0));
  return {
    trial_credits: trial.toLocaleString('en-US'),
    trial_line: trial > 0 ? `You have <strong>${trial.toLocaleString('en-US')} free credits</strong> to try hooks, images and Ban Shield.` : 'You can try hooks, images and Ban Shield as soon as you add credits.',
    plan_from: Number.isFinite(cheapest) ? '$' + (Number.isInteger(cheapest) ? cheapest : cheapest.toFixed(2)) : 'any plan',
    hook_cost: String(Number(P.costs?.hook_pack_20) || ''),
  };
}
const fmtDate = (d) => new Date(d || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

// assetBase: where the email images live (default APP_URL/assets/img/email; the offline gallery uses a relative path).
function build(templateId, vars = {}, user = null, { assetBase } = {}) {
  const t = get('SELECT * FROM email_templates WHERE id = ?', templateId) || (FALLBACK_TEMPLATES[templateId] && { enabled: 1, ...FALLBACK_TEMPLATES[templateId] });
  if (!t) throw new Error('Missing email template ' + templateId);
  const v = { app_url: config.appUrl, name: user?.name || 'there', support_email: config.brand.supportEmail, ...vars };
  // Some lifecycle emails mention the customer's credits; fill in the live balance when the sender did not pass it.
  if (v.credits === undefined && user?.id && /\{\{\s*credits\s*\}\}/.test(t.subject + t.preheader + t.body_html)) {
    try { v.credits = require('../credits').balance(user).total.toLocaleString('en-US'); } catch {}
  }
  if (/receipt/.test(templateId) && !v.date) v.date = fmtDate();
  Object.assign(v, { ...livePricing(v.trial_credits), ...vars }); // free credits, cheapest plan, hook price: always the live config
  const unsub = user && MARKETING.has(templateId) ? `${config.appUrl}/api/email/unsubscribe?u=${user.id}&t=${unsubToken(user.id)}` : null;
  const vh = {}; // values as HTML: customer-typed text never becomes markup in an email
  for (const [k, x] of Object.entries(v)) vh[k] = HTML_VARS.has(k) || typeof x !== 'string' ? x : esc(x);
  const html = layout({
    preheader: render(t.preheader, v), heading: render(t.heading, v), body: render(t.body_html, vh),
    ctaLabel: render(t.cta_label, v), ctaUrl: render(t.cta_url, v), unsub, appUrl: config.appUrl,
    legal: config.brand.legalLine, // the one legal line, in every footer
    support: config.brand.supportEmail, kind: templateId, vars: v, assetBase,
  });
  const text = render(t.body_html, v).replace(/<li>/g, '\n- ').replace(/<\/p>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    + (t.cta_url ? `\n\n${render(t.cta_label, v)}: ${render(t.cta_url, v)}` : '') + (unsub ? `\n\nUnsubscribe: ${unsub}` : '');
  // Marketing emails also carry List-Unsubscribe headers (one-click unsubscribe in Gmail and Apple Mail; see routes/mail.js).
  const headers = unsub ? { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
  return { subject: render(t.subject, v), html, text, enabled: !!t.enabled, headers };
}

async function deliver(to, { subject, html, text, headers }) {
  // Staging: only staff and the allowlist get real emails; the rest are printed in the log (server/staging.js).
  if (!require('../staging').emailAllowed(to)) {
    console.log(`\n[email:staging-blocked] To: ${to}\nSubject: ${subject}\n${String(text || '').slice(0, 600)}\n`);
    return { logged: true, blocked: true };
  }
  if (!config.email.resendKey) {
    console.log(`\n[email:log] To: ${to}\nSubject: ${subject}\n${text.slice(0, 600)}\n`);
    return { logged: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + config.email.resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.brand.fromEmail, to: [to], subject, html, text, reply_to: config.brand.supportEmail, ...(headers ? { headers } : {}) }),
  });
  if (!r.ok) throw new Error('Resend: ' + (await r.text()).slice(0, 200));
  return r.json();
}

// Put an email in the queue. delayDays can be fractional.
function queue(templateId, to, vars = {}, { userId = null, delayDays = 0 } = {}) {
  run('INSERT INTO email_queue(user_id, to_email, template, vars, send_at) VALUES(?,?,?,?,?)', userId, to, templateId, JSON.stringify(vars), addDays(now(), delayDays));
}
// Send right away (login codes, receipts).
async function sendNow(templateId, to, vars = {}, user = null) {
  const msg = build(templateId, vars, user);
  return deliver(to, msg);
}

function suppressedEmail(email) {
  try { return !!require('../mail/store').suppressed(email); } catch { return false; }
}

let sending = false;
async function processQueue() {
  if (sending) return;
  sending = true;
  try {
    const rows = all('SELECT * FROM email_queue WHERE sent_at IS NULL AND send_at <= ? AND attempts < 5 ORDER BY id LIMIT 20', now());
    for (const q of rows) {
      const user = q.user_id ? get('SELECT * FROM users WHERE id = ?', q.user_id) : null;
      const skip = (user && MARKETING.has(q.template) && !user.marketing_opt_in)
        || (user && SKIP_IF_PAID.has(q.template) && get("SELECT 1 FROM payments WHERE user_id = ? AND status = 'paid'", user.id))
        || (user && q.template === 'trial_inactive_48h' && get('SELECT 1 FROM jobs WHERE user_id = ?', user.id))
        || (user && user.status !== 'active' && !['account_banned', 'account_warning'].includes(q.template));
      if (skip) { run("UPDATE email_queue SET sent_at = ?, error = 'skipped' WHERE id = ?", now(), q.id); continue; }
      // Automatic marketing emails never go to addresses on the Mail suppression list (hard bounces and spam complaints).
      if (MARKETING.has(q.template) && suppressedEmail(q.to_email)) { run("UPDATE email_queue SET sent_at = ?, error = 'suppressed' WHERE id = ?", now(), q.id); continue; }
      try {
        const msg = build(q.template, J(q.vars, {}), user);
        if (!msg.enabled) { run("UPDATE email_queue SET sent_at = ?, error = 'template off' WHERE id = ?", now(), q.id); continue; }
        await deliver(q.to_email, msg);
        run('UPDATE email_queue SET sent_at = ?, error = NULL WHERE id = ?', now(), q.id);
      } catch (e) {
        run('UPDATE email_queue SET attempts = attempts + 1, error = ?, send_at = ? WHERE id = ?', e.message.slice(0, 300), addDays(now(), 0.02), q.id);
      }
    }
  } finally {
    sending = false;
  }
}

// ---------- helpers for the lifecycle hooks ----------
const VIDEO_JOBS = new Set(['ugc', 'video', 'image_to_video', 'slideshow', 'dub', 'hook_remix', 'motion_ad', 'bg_swap', 'auto_edit', 'brand_music', 'street', 'mad_edit']);
const KIND_NAMES = { ugc: 'UGC video', video: 'Product video', image_to_video: 'Photo to video', slideshow: 'Slideshow', dub: 'Dubbed video', hook_remix: 'Hook remix', motion_ad: 'Motion ad', bg_swap: 'New background', auto_edit: 'Auto-edit', brand_music: 'Brand music', street: 'Street interview', mad_edit: 'Fast-cut edit', hooks: 'Hook pack', image: 'Image set' };
const obj = (x) => (x && typeof x === 'object' ? x : J(x, {}));
const userById = (uid) => (uid ? get('SELECT * FROM users WHERE id = ?', uid) : null);
// Real, active inboxes only (the showcase house account uses a .invalid address).
const reachable = (u) => !!(u && u.email && u.status === 'active' && !/\.invalid$/i.test(u.email));
function templateOn(tid) {
  const t = get('SELECT enabled FROM email_templates WHERE id = ?', tid);
  return t ? !!t.enabled : !!FALLBACK_TEMPLATES[tid];
}
function setFlag(u, key) {
  const f = J(get('SELECT flags FROM users WHERE id = ?', u.id)?.flags, {});
  if (f[key]) return false;
  f[key] = 1;
  run('UPDATE users SET flags = ? WHERE id = ?', JSON.stringify(f), u.id);
  return true;
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
function jobInfo(job) {
  const i = obj(job.input);
  let kind = KIND_NAMES[job.type] || 'Video';
  try { const vt = i.video_type && require('../videotypes').byId(i.video_type); if (vt && vt.name) kind = vt.name; } catch {}
  const what = String(i.product || i.title || i.prompt || '').replace(/\s+/g, ' ').trim();
  const title = what ? `${what.length > 48 ? what.slice(0, 47).trimEnd() + '…' : what}: ${kind}` : kind;
  const secs = Number(i.duration) || 0;
  const meta = [secs ? clock(secs) : '', i.aspect || '', '1080p', i.captions === false ? '' : 'captions on'].filter(Boolean).join(' · ');
  const page = `${config.appUrl}/app#library/${job.id}`;
  return { job_id: job.id, video_title: title, video_meta: meta, video_page: page, edit_url: page + '?edit=1', job_url: page, url: page };
}
const fmtCredits = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US');

// A finished video gets an email with a preview made from the video itself (preview.js). Best effort and quick; if the
// preview cannot be made, the email still goes out with the built-in header.
const sentReady = new Set();
function videoReady(job, videoUrl, templateId = 'video_ready', extra = {}) {
  const u = userById(job.user_id);
  if (!reachable(u) || !templateOn(templateId) || sentReady.has(templateId + job.id)) return null;
  sentReady.add(templateId + job.id);
  const vars = { name: u.name || 'there', ...jobInfo(job), video_url: /^https?:/.test(videoUrl) ? videoUrl : config.appUrl + videoUrl, ...extra };
  const send = (p = {}) => queue(templateId, u.email, { ...vars, ...p }, { userId: u.id });
  return require('./preview').forJob(job, videoUrl).then(send, (e) => { console.warn('[email] preview', e.message); send(); });
}

// Low balance: once per plan credit period (paid) or once per trial. Both are opt-out emails.
function lowCredits(userId) {
  const u = userById(userId);
  if (!reachable(u)) return;
  const credits = require('../credits');
  const b = credits.balance(u);
  const plan = credits.activePlan(u);
  if (plan && plan.credits_month > 0) {
    const pct = (b.plan + b.topup) / plan.credits_month * 100;
    if (pct < 15 && setFlag(u, 'low_' + String(u.plan_credits_reset_at || '').slice(0, 10))) queue('paid_credits_low', u.email, { credits: fmtCredits(b.plan + b.topup), plan: plan.name, pct_left: Math.round(pct) }, { userId: u.id });
  } else if (!plan && b.topup === 0) {
    const trial = Number(require('../settings').pricing().free_trial?.credits) || 0;
    if (trial > 0 && b.trial > 0 && b.trial < trial * 0.2 && setFlag(u, 'low_trial')) queue('trial_credits_low', u.email, { credits: fmtCredits(b.trial), pct_left: Math.round(b.trial / trial * 100) }, { userId: u.id });
  }
}

// Lifecycle hooks used by the rest of the app.
const hooks = {
  signup(user, trialCredits) {
    const code = ('WELCOME' + id(3).replace(/[^A-Za-z0-9]/g, '')).toUpperCase().slice(0, 12);
    run("INSERT OR IGNORE INTO discounts(code, percent, applies_to, expires_at, max_uses, user_id) VALUES(?, 30, 'first_month', ?, 1, ?)", code, addDays(now(), 10), user.id);
    const seq = [
      ['welcome', 0, { credits: trialCredits, trial_credits: trialCredits }], // what this account really got ['onboarding_day1', 1], ['sales_day2_first_video_nudge', 2], ['trial_inactive_48h', 2.1],
      ['onboarding_day3_plans', 3], ['sales_day4_case_study', 4], ['onboarding_day5_offer', 5, { code }], ['sales_day6_objections', 6],
      ['sales_day8_offer_last_call', 8, { code }], ['sales_day12_founder_note', 12],
    ];
    for (const [tpl, days, vars] of seq) queue(tpl, user.email, vars || {}, { userId: user.id, delayDays: days });
  },
  // First finished hook pack on a free account: nudge to a plan (once per user).
  firstHooks(user) {
    if (!user || user.plan_id || get("SELECT 1 FROM email_queue WHERE user_id = ? AND template = 'upgrade_after_first_hooks'", user.id)) return;
    queue('upgrade_after_first_hooks', user.email, {}, { userId: user.id, delayDays: 0.05 });
  },
  // Any job finished (server/jobs.js done()). Videos get "Your video is ready"; long ones use long_video_ready (longVideo).
  jobDone(job, output) {
    try { lowCredits(job.user_id); } catch (e) { console.warn('[email] low credits', e.message); }
    if (!output || !VIDEO_JOBS.has(job.type) || (Number(obj(job.input).segments) || 1) > 1) return null;
    const url = output.url || (Array.isArray(output.hooks) && output.hooks[0] && output.hooks[0].url) || null;
    return url ? videoReady(job, url, 'video_ready') : null;
  },
  longVideo(job, url) {
    const i = obj(job.input);
    return videoReady(job, url, 'long_video_ready', { seconds: i.duration, segments: i.segments || 1, video_meta: [i.duration ? clock(Number(i.duration)) : '', i.aspect || '', `${i.segments || 1} parts joined`].filter(Boolean).join(' · ') });
  },
  // A long video paused because one part keeps failing (jobs.js needsAttention): the three choices.
  jobAttention(job, part) {
    const u = userById(job.user_id);
    if (!reachable(u)) return;
    const i = obj(job.input), st = obj(job.state);
    queue('video_attention', u.email, { ...jobInfo(job), part: String(Number(part) + 1), segments: String(i.segments || 1), keep_until: fmtDate(st.attention?.keep_until || addDays(now(), 7)) }, { userId: u.id });
  },
  // A job failed and its credits went back (jobs.js failJob). Not when the customer cancelled it themselves.
  jobFailed(job) {
    if (!job || !(Number(job.credits) > 0) || /^You cancelled/i.test(String(job.error || ''))) return;
    const u = userById(job.user_id);
    if (!reachable(u)) return;
    let balance = '';
    try { balance = fmtCredits(require('../credits').balance(u).total); } catch {}
    queue('job_failed', u.email, { ...jobInfo(job), credits: fmtCredits(job.credits), reason: String(job.error || '').replace(/\s*(All its|Your) credits are back\.?/i, '').trim(), balance }, { userId: u.id });
  },
  // Staff or support added credits (positive grants only).
  creditsAdded(userId, amount, note = '') {
    const u = userById(userId);
    if (!reachable(u) || !(Number(amount) > 0)) return;
    let balance = '';
    try { balance = fmtCredits(require('../credits').balance(u).total); } catch {}
    queue('credits_added', u.email, { credits: fmtCredits(amount), note, balance }, { userId: u.id });
  },
  // Someone this customer referred paid: their commission at the current tier, on the base price (never the fee).
  referral(payer, payment) {
    if (!payer || !payer.referred_by) return;
    const ref = get('SELECT * FROM users WHERE ref_code = ?', payer.referred_by);
    if (!reachable(ref) || ref.id === payer.id) return;
    const s = require('../settings').getSetting('referral') || {};
    const paying = get("SELECT COUNT(DISTINCT u.id) AS c FROM users u JOIN payments p ON p.user_id = u.id AND p.status = 'paid' WHERE u.referred_by = ?", ref.ref_code).c;
    const tier = [...(s.tiers || [])].sort((a, b) => b.min - a.min).find((x) => paying >= x.min) || { pct: 0 };
    const earned = Math.round((Number(payment.amount_usd) || 0) * tier.pct) / 100;
    if (!(earned > 0)) return;
    queue('referral_earned', ref.email, { amount: '$' + earned.toFixed(2), pct: String(tier.pct), referral_link: `${config.appUrl}/?invite=${ref.ref_code}` }, { userId: ref.id });
  },
  // Staff approved or declined a customer's own-face actor (actors.js review).
  actorReviewed(actor, approve, note = '') {
    const u = userById(actor && actor.user_id);
    if (!reachable(u)) return;
    queue(approve ? 'actor_approved' : 'actor_declined', u.email, { actor_name: actor.name || 'Your actor', note: String(note || '').slice(0, 300) }, { userId: u.id });
  },
  // Daily (billing.daily): renewal notice for auto-renewing plans, plan ended, and the Monday weekly digest.
  daily() {
    const t = now();
    const { planById } = require('../settings');
    for (const u of all("SELECT * FROM users WHERE plan_id IS NOT NULL AND auto_renew = 1 AND status = 'active' AND plan_expires_at BETWEEN ? AND ?", addDays(t, 2.5), addDays(t, 3.5))) {
      // Bachs card subscribers get their own reminder with the exact amount (card_renews_soon, payments/bachs-subs.js).
      try { if (get("SELECT 1 FROM bachs_subscriptions WHERE user_id = ? AND sub_id IS NOT NULL AND status != 'canceled'", u.id)) continue; } catch {}
      if (!reachable(u) || !setFlag(u, 'renews_' + String(u.plan_expires_at).slice(0, 10))) continue;
      const plan = planById(u.plan_id);
      const price = plan ? (u.plan_period === 'year' ? plan.price_year : plan.price_month) : null;
      queue('plan_renews_soon', u.email, { plan: plan?.name || 'plan', renew_date: fmtDate(u.plan_expires_at), amount: Number(price) > 0 ? '$' + Number(price).toFixed(2) : 'your plan price', credits: fmtCredits(u.plan_credits) }, { userId: u.id });
    }
    for (const u of all("SELECT * FROM users WHERE plan_id IS NOT NULL AND status = 'active' AND plan_expires_at BETWEEN ? AND ?", addDays(t, -2), t)) {
      if (!reachable(u) || !setFlag(u, 'ended_' + String(u.plan_expires_at).slice(0, 10))) continue;
      queue('plan_expired', u.email, { plan: planById(u.plan_id)?.name || 'Vooads', ended_date: fmtDate(u.plan_expires_at) }, { userId: u.id });
    }
    if (new Date(t).getUTCDay() === 1) hooks.weekly(t);
  },
  // Weekly digest (opt-out): customers who finished something in the last 7 days.
  weekly(t = now()) {
    const week = 'digest_' + String(t).slice(0, 10);
    const since = addDays(t, -7).replace('T', ' ').slice(0, 19);
    for (const r of all("SELECT user_id, COUNT(*) AS n, SUM(credits) AS used FROM jobs WHERE status = 'done' AND created_at >= ? GROUP BY user_id", since)) {
      const u = userById(r.user_id);
      if (!reachable(u) || !u.marketing_opt_in || !setFlag(u, week)) continue;
      let left = '';
      try { left = fmtCredits(require('../credits').balance(u).total); } catch {}
      queue('weekly_digest', u.email, { videos: String(r.n), credits_used: fmtCredits(r.used), credits: left }, { userId: u.id });
    }
  },
};

module.exports = { seedTemplates, build, deliver, queue, sendNow, processQueue, hooks, unsubToken, MARKETING, FALLBACK_TEMPLATES, fixUrl, defaultFor, fmtDate, videoReady };
