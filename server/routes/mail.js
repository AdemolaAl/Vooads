// Mail: admin API (composer, templates, audiences, media, campaigns, stats), public tracking and unsubscribe pages,
// and the Resend webhook. Permissions: mail.view, mail.edit, mail.send, mail.send_all (see auth.js).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { get, all, run, J } = require('../db');
const { parseJson, readBody, fail, rateLimit, serveStatic } = require('../lib/http');
const { now, esc, safeEqual, isEmail, clampInt, render: tpl } = require('../lib/util');
const auth = require('../auth');
const email = require('../email');
const layout = require('../email/layout');
const store = require('../mail/store');
const render = require('../mail/render');
const uploads = require('../mail/uploads');
const audience = require('../mail/audience');
const sender = require('../mail/sender');
const { stats, topLinks, userHistory, webhookSecret } = require('../mail/stats');

// Owners/admins only for "every customer": the * role, or a role that was given mail.send_all.
const canSendAll = (s) => auth.can(s, '*') || auth.can(s, 'mail.send_all');
function requireAny(req, ...perms) {
  const s = auth.requireStaff(req);
  if (!perms.some((p) => auth.can(s, p))) fail(403, 'Your role does not have access to this. Ask the owner to update your permissions.');
  return s;
}

const SAMPLE_VARS = { first_name: 'Alex', credits: '1,250', plan: 'Pro', email: 'alex@example.com' };
const LEGACY_SAMPLE = { code: '482915', credits: '60', plan: 'Pro', amount: '$149.00', invite_url: '', role: 'Support', inviter_name: 'Jordan', reason: 'Example reason', effective_date: 'in 14 days', change_1: 'Example change', change_2: 'Example change', change_3: 'Example change', customer_email: 'alex@example.com', ticket_subject: 'Example ticket', ticket_body: 'Example message', reply_excerpt: 'Example reply', seconds: '45', segments: '3' };

const STARTER = () => render.normalizeDoc({
  subject: 'Something new for you, {{first_name|there}}', preheader: 'A quick update from the Vooads team', from_name: store.settings().default_from_name,
  blocks: [
    { id: 'h', t: 'heading', text: 'Hi {{first_name|there}} 👋', size: 'lg' },
    { id: 'p', t: 'text', html: '<p>Write your message here. Keep it short and friendly: one idea, one link.</p><p>You have <strong>{{credits|some}}</strong> credits ready to use.</p>' },
    { id: 'b', t: 'button', label: 'Open Vooads', href: '{{app_url}}/app', style: 'brand' },
    { id: 's', t: 'spacer', h: 8 },
    { id: 'f', t: 'text', html: '<p>Talk soon,<br>The Vooads team</p>' },
  ],
});

const campaignView = (c, full = false) => {
  const st = stats(c.id);
  const out = {
    id: c.id, name: c.name, subject: c.subject, preheader: c.preheader, from_name: c.from_name, category: c.category, status: c.status,
    scheduled_at: c.scheduled_at, timezone: c.timezone, started_at: c.started_at, finished_at: c.finished_at, created_at: c.created_at, updated_at: c.updated_at,
    total: c.total, stats: st, audience: c.audience, attachments: c.attachments.map((x) => uploads.view(uploads.byId(x))).filter(Boolean),
  };
  if (full) out.blocks = c.blocks;
  return out;
};
const editable = (c) => ['draft', 'scheduled'].includes(c.status);

// The built-in version (content/emails/emails.json, or the newer copy in server/email/catalog.js).
function lifecycleDefault(tid) {
  return email.defaultFor(tid);
}
function lifecycleDoc(t) {
  const saved = get('SELECT * FROM mail_lifecycle_blocks WHERE id = ?', t.id);
  if (saved && saved.saved_at >= String(t.updated_at || '')) return render.normalizeDoc({ subject: t.subject, preheader: t.preheader, blocks: J(saved.blocks, []) });
  return render.fromLegacy(t);
}
function legacyPreview(t, doc) {
  const f = render.toLegacy(doc);
  const v = { ...LEGACY_SAMPLE, ...require('../email/samples').sampleVars(config.appUrl, t.id), app_url: config.appUrl, name: 'Alex', support_email: config.brand.supportEmail };
  const html = layout({
    preheader: tpl(f.preheader, v), heading: tpl(f.heading, v), body: tpl(f.body_html, v), ctaLabel: tpl(f.cta_label, v), ctaUrl: tpl(f.cta_url, v),
    unsub: email.MARKETING.has(t.id) ? '#' : null, appUrl: config.appUrl, legal: config.brand.legalLine, support: config.brand.supportEmail, kind: t.id, vars: v,
  });
  return { subject: tpl(f.subject, v), preheader: tpl(f.preheader, v), html: html.replace('<head>', '<head><base target="_blank">') };
}

// ---------- Public pages (unsubscribe, preferences) ----------
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Vooads</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap">
<style>:root{--ink:#0B0B0A;--bg:#F7F6F2;--line:#E6E3DA;--mut:#66625A;--brand:#FF4A1C}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:500;min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.c{width:100%;max-width:460px;background:#fff;border:1px solid var(--line);border-radius:26px;padding:34px 28px;box-shadow:0 30px 60px -40px rgba(11,11,10,.35);animation:in .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes in{from{opacity:0;transform:translateY(12px)}}.logo{display:flex;align-items:center;gap:8px;font-weight:800;font-size:20px;letter-spacing:-.5px;margin-bottom:22px}.logo i{width:30px;height:30px;border-radius:9px;background:var(--ink);display:inline-block;position:relative}.logo i:after{content:"";position:absolute;left:8px;top:11px;width:5px;height:8px;border-radius:3px;background:var(--brand);box-shadow:9px 0 0 var(--brand)}
h1{font-size:26px;line-height:1.15;letter-spacing:-.6px;margin:0 0 10px}p{color:var(--mut);line-height:1.6;margin:0 0 16px;font-size:15px}
.opt{display:flex;gap:14px;align-items:flex-start;padding:16px;border:1px solid var(--line);border-radius:16px;margin:0 0 10px;cursor:pointer;transition:border-color .2s}.opt:hover{border-color:var(--ink)}.opt input{width:20px;height:20px;accent-color:var(--brand);margin:2px 0 0;flex:none}.opt b{display:block;font-size:15px}.opt span{color:var(--mut);font-size:13.5px;line-height:1.5}
button{appearance:none;border:0;background:var(--ink);color:#fff;font:inherit;font-weight:700;font-size:15px;padding:14px 22px;border-radius:999px;cursor:pointer;width:100%;margin-top:8px;transition:transform .15s,background .2s}button:hover{background:#2A2926}button:active{transform:scale(.98)}button.brand{background:var(--brand)}
a{color:var(--ink)}.small{font-size:13px;color:var(--mut);text-align:center;margin-top:18px}.ok{display:inline-grid;place-items:center;width:46px;height:46px;border-radius:50%;background:#E6F5EC;color:#1F9D55;font-size:22px;margin-bottom:14px}</style></head>
<body><main class="c"><div class="logo"><i></i>vooads</div>${body}</main></body></html>`;
}
function sendByToken(token) {
  const t = String(token || '').replace(/\.gif$/, '');
  if (!/^[\w-]{16,40}$/.test(t)) return null;
  return get('SELECT * FROM mail_sends WHERE token = ?', t);
}
function prefsForm(token, p, saved) {
  return `${saved ? '<div class="ok">&#10003;</div>' : ''}<h1>${saved ? 'Saved.' : 'Email preferences'}</h1><p>Choose what Vooads sends to <b>${esc(p.email)}</b>. Receipts, login codes and security emails always arrive.</p>
<form method="post" action="/m/p/${esc(token)}"><label class="opt"><input type="checkbox" name="marketing" ${p.marketing ? 'checked' : ''}><div><b>Tips and offers</b><span>Ideas for better ads, new features and the occasional deal.</span></div></label>
<label class="opt"><input type="checkbox" name="product" ${p.product ? 'checked' : ''}><div><b>Product updates</b><span>Important changes to Vooads and your account features.</span></div></label>
<input type="hidden" name="set" value="1"><button type="submit">Save preferences</button></form><p class="small"><a href="${esc(config.appUrl)}">Back to Vooads</a></p>`;
}
function unsubscribe(send, how) {
  if (!send.unsubscribed_at) {
    run('UPDATE mail_sends SET unsubscribed_at = ? WHERE id = ?', now(), send.id);
    run("INSERT INTO mail_events(send_id, campaign_id, type, url) VALUES(?,?,'unsubscribe',?)", send.id, send.campaign_id, how);
  }
  store.setPrefs(send.email, { marketing: false, product: false });
}

// ---------- Resend webhook (Svix signatures) ----------
function verifySvix(raw, h, secret) {
  const sid = h['svix-id'], ts = h['svix-timestamp'], sigs = h['svix-signature'];
  if (!secret || !sid || !ts || !sigs) return false;
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  let key;
  try { key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  const expected = crypto.createHmac('sha256', key).update(`${sid}.${ts}.${raw}`).digest('base64');
  return String(sigs).split(' ').some((p) => { const [v, s] = p.split(','); return v === 'v1' && safeEqual(s, expected); });
}

module.exports = function mount(r) {
  // ================= Admin: overview & settings =================
  r.get('/api/admin/mail/overview', (req, res) => {
    const s = auth.requireStaff(req, 'mail.view');
    const camps = all('SELECT * FROM mail_campaigns ORDER BY COALESCE(scheduled_at, created_at) DESC, id DESC LIMIT 200').map((c) => campaignView(store.campaign(c.id)));
    res.json({
      campaigns: camps,
      templates: get('SELECT COUNT(*) AS c FROM mail_templates').c,
      live: !!config.email.resendKey, webhook: !!webhookSecret(), settings: store.settings(),
      can: { edit: auth.can(s, 'mail.edit'), send: auth.can(s, 'mail.send'), send_all: canSendAll(s) },
      me: { email: s.email, name: s.name },
    });
  });
  r.get('/api/admin/mail/settings', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    res.json({ settings: store.settings(), live: !!config.email.resendKey, from: config.brand.fromEmail, webhook_url: `${config.appUrl}/api/webhooks/mail/resend`, webhook_set: !!webhookSecret(), ffmpeg: uploads.ffmpegReady() });
  });
  r.put('/api/admin/mail/settings', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.send');
    const b = await parseJson(req);
    const next = store.saveSettings(b || {});
    store.audit(s, 'mail.settings', 'mail', next);
    res.json({ settings: next });
  });

  // ================= Preview =================
  r.post('/api/admin/mail/preview', async (req, res) => {
    auth.requireStaff(req, 'mail.view');
    rateLimit('mailpv:' + req.ip, 240, 60e3);
    const b = await parseJson(req);
    const doc = render.normalizeDoc(b.doc || {});
    if (b.lifecycle) {
      const t = get('SELECT * FROM email_templates WHERE id = ?', String(b.lifecycle));
      if (!t) fail(404, 'Template not found');
      return res.json(legacyPreview(t, doc));
    }
    const out = render.renderEmail(doc, { appUrl: config.appUrl, relative: true, company: config.brand.company, support: config.brand.supportEmail, vars: SAMPLE_VARS, unsubUrl: '#', prefsUrl: '#', preview: true });
    res.json({ subject: out.subject, preheader: out.preheader, html: out.html, from: sender.fromHeader(doc.from_name) });
  });

  // ================= Templates (your own) =================
  r.get('/api/admin/mail/templates', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    const mk = email.MARKETING;
    const saved = new Set(all('SELECT id FROM mail_lifecycle_blocks').map((x) => x.id));
    res.json({
      templates: all('SELECT id, name, subject, preheader, from_name, blocks, updated_at, created_at FROM mail_templates ORDER BY updated_at DESC').map((t) => ({ ...t, blocks: J(t.blocks, []) })),
      lifecycle: all('SELECT id, trigger, delay, subject, enabled, updated_at FROM email_templates ORDER BY rowid').map((t) => ({ ...t, marketing: mk.has(t.id), designed: saved.has(t.id) })),
    });
  });
  r.post('/api/admin/mail/templates', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const b = await parseJson(req);
    const doc = render.normalizeDoc(b.doc || STARTER());
    const name = String(b.name || doc.subject || 'Untitled template').trim().slice(0, 80) || 'Untitled template';
    const info = run('INSERT INTO mail_templates(name, subject, preheader, from_name, blocks, created_by) VALUES(?,?,?,?,?,?)', name, doc.subject, doc.preheader, doc.from_name, JSON.stringify(doc.blocks), s.id);
    store.audit(s, 'mail.template_add', info.lastInsertRowid, { name });
    res.json({ id: Number(info.lastInsertRowid) });
  });
  r.get('/api/admin/mail/templates/:id', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    const t = get('SELECT * FROM mail_templates WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Template not found');
    res.json({ template: { id: t.id, name: t.name, updated_at: t.updated_at }, doc: render.normalizeDoc({ ...t, blocks: J(t.blocks, []) }) });
  });
  r.put('/api/admin/mail/templates/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const t = get('SELECT * FROM mail_templates WHERE id = ?', Number(req.params.id));
    if (!t) fail(404, 'Template not found');
    const b = await parseJson(req);
    const doc = render.normalizeDoc(b.doc || {});
    const name = String(b.name ?? t.name).trim().slice(0, 80) || t.name;
    run('UPDATE mail_templates SET name = ?, subject = ?, preheader = ?, from_name = ?, blocks = ?, updated_at = ? WHERE id = ?', name, doc.subject, doc.preheader, doc.from_name, JSON.stringify(doc.blocks), now(), t.id);
    store.audit(s, 'mail.template_edit', t.id, { name });
    res.json({ ok: true, doc });
  });
  r.del('/api/admin/mail/templates/:id', (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    run('DELETE FROM mail_templates WHERE id = ?', Number(req.params.id));
    store.audit(s, 'mail.template_delete', req.params.id);
    res.json({ ok: true });
  });

  // ================= Lifecycle emails (the 30 built-in ones) =================
  r.get('/api/admin/mail/lifecycle/:id', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    const t = get('SELECT * FROM email_templates WHERE id = ?', req.params.id);
    if (!t) fail(404, 'Template not found');
    const def = lifecycleDefault(t.id);
    const changed = !!def && ['subject', 'preheader', 'heading', 'body_html', 'cta_label', 'cta_url'].some((k) => String(def[k] ?? '') !== String(t[k] ?? ''));
    res.json({ template: { id: t.id, trigger: t.trigger, delay: t.delay, enabled: !!t.enabled, marketing: email.MARKETING.has(t.id), changed, has_default: !!def }, doc: lifecycleDoc(t) });
  });
  r.put('/api/admin/mail/lifecycle/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const t = get('SELECT * FROM email_templates WHERE id = ?', req.params.id);
    if (!t) fail(404, 'Template not found');
    const b = await parseJson(req);
    const doc = render.normalizeDoc(b.doc || {});
    if (!doc.subject.trim()) fail(400, 'Add a subject line.');
    const f = render.toLegacy(doc);
    const at = now();
    run('UPDATE email_templates SET subject=?, preheader=?, heading=?, body_html=?, cta_label=?, cta_url=?, enabled=?, updated_at=? WHERE id=?',
      f.subject, f.preheader, f.heading, f.body_html, f.cta_label, f.cta_url, b.enabled === undefined ? t.enabled : b.enabled ? 1 : 0, at, t.id);
    run('INSERT INTO mail_lifecycle_blocks(id, blocks, saved_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET blocks = excluded.blocks, saved_at = excluded.saved_at', t.id, JSON.stringify(doc.blocks), at);
    store.audit(s, 'email.edit', t.id, { via: 'mail composer' });
    res.json({ ok: true, doc });
  });
  r.post('/api/admin/mail/lifecycle/:id/reset', (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const t = get('SELECT * FROM email_templates WHERE id = ?', req.params.id);
    const def = t && lifecycleDefault(t.id);
    if (!def) fail(404, 'There is no built-in version of this email.');
    run('UPDATE email_templates SET subject=?, preheader=?, heading=?, body_html=?, cta_label=?, cta_url=?, updated_at=? WHERE id=?', def.subject, def.preheader, def.heading, def.body_html, def.cta_label, def.cta_url, now(), t.id);
    run('DELETE FROM mail_lifecycle_blocks WHERE id = ?', t.id);
    store.audit(s, 'mail.lifecycle_reset', t.id);
    res.json({ ok: true, doc: render.fromLegacy(get('SELECT * FROM email_templates WHERE id = ?', t.id)) });
  });
  r.post('/api/admin/mail/lifecycle/:id/test', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    rateLimit('mailtest:' + s.id, 15, 10 * 60e3);
    if (!get('SELECT 1 FROM email_templates WHERE id = ?', req.params.id)) fail(404, 'Template not found');
    await email.sendNow(req.params.id, s.email, { ...LEGACY_SAMPLE, invite_url: config.appUrl + '/admin', inviter_name: s.name || 'Vooads' }).catch((e) => fail(502, e.message));
    store.audit(s, 'mail.test', req.params.id, { to: s.email });
    res.json({ ok: true, to: s.email, logged: !config.email.resendKey });
  });

  // ================= Campaigns =================
  r.post('/api/admin/mail/campaigns', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const b = await parseJson(req);
    let doc = null, name = String(b.name || '').trim().slice(0, 80);
    if (b.template_id) {
      const t = get('SELECT * FROM mail_templates WHERE id = ?', Number(b.template_id));
      if (!t) fail(404, 'Template not found');
      doc = render.normalizeDoc({ ...t, blocks: J(t.blocks, []) }); name = name || t.name;
    } else if (b.lifecycle_id) {
      const t = get('SELECT * FROM email_templates WHERE id = ?', String(b.lifecycle_id));
      if (!t) fail(404, 'Template not found');
      doc = lifecycleDoc(t); name = name || 'Copy of ' + t.id.replace(/_/g, ' ');
    } else if (b.campaign_id) {
      const c = store.campaign(b.campaign_id);
      if (!c) fail(404, 'Campaign not found');
      doc = render.normalizeDoc(c); name = name || c.name + ' (copy)';
      b.audience = b.audience || c.audience; b.category = b.category || c.category; b.attachments = c.attachments;
    } else doc = STARTER();
    if (!doc.from_name) doc.from_name = store.settings().default_from_name;
    const info = run('INSERT INTO mail_campaigns(name, subject, preheader, from_name, blocks, audience, category, attachments, created_by) VALUES(?,?,?,?,?,?,?,?,?)',
      name || 'Untitled email', doc.subject, doc.preheader, doc.from_name, JSON.stringify(doc.blocks), JSON.stringify(audience.clean(b.audience || {})), b.category === 'product' ? 'product' : 'marketing', JSON.stringify(uploads.checkAttachments(b.attachments)), s.id);
    store.audit(s, 'mail.campaign_add', info.lastInsertRowid, { name });
    res.json({ id: Number(info.lastInsertRowid) });
  });
  r.get('/api/admin/mail/campaigns/:id', (req, res) => {
    const s = auth.requireStaff(req, 'mail.view');
    const c = store.campaign(req.params.id);
    if (!c) fail(404, 'Campaign not found');
    res.json({ campaign: campaignView(c, true), links: topLinks(c.id), can: { edit: auth.can(s, 'mail.edit'), send: auth.can(s, 'mail.send'), send_all: canSendAll(s) } });
  });
  r.put('/api/admin/mail/campaigns/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const c = store.campaign(req.params.id);
    if (!c) fail(404, 'Campaign not found');
    if (!editable(c)) fail(409, 'This email has already gone out. Duplicate it to make changes.');
    const b = await parseJson(req);
    const doc = b.doc ? render.normalizeDoc(b.doc) : c;
    const aud = b.audience ? audience.clean(b.audience) : c.audience;
    const att = b.attachments ? uploads.checkAttachments(b.attachments) : c.attachments;
    const name = String(b.name ?? c.name).trim().slice(0, 80) || c.name;
    const cat = b.category ? (b.category === 'product' ? 'product' : 'marketing') : c.category;
    run('UPDATE mail_campaigns SET name=?, subject=?, preheader=?, from_name=?, blocks=?, audience=?, attachments=?, category=?, updated_at=? WHERE id=?',
      name, doc.subject, doc.preheader, doc.from_name, JSON.stringify(doc.blocks), JSON.stringify(aud), JSON.stringify(att), cat, now(), c.id);
    store.audit(s, 'mail.campaign_edit', c.id, { name });
    res.json({ ok: true, campaign: campaignView(store.campaign(c.id), true) });
  });
  r.del('/api/admin/mail/campaigns/:id', (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const c = store.campaign(req.params.id);
    if (!c) fail(404, 'Campaign not found');
    if (c.status !== 'draft') fail(409, 'Only drafts can be deleted. Cancel it instead.');
    run('DELETE FROM mail_campaigns WHERE id = ?', c.id);
    store.audit(s, 'mail.campaign_delete', c.id, { name: c.name });
    res.json({ ok: true });
  });
  r.post('/api/admin/mail/campaigns/:id/test', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    rateLimit('mailtest:' + s.id, 15, 10 * 60e3);
    const c = store.campaign(req.params.id);
    if (!c) fail(404, 'Campaign not found');
    const b = await parseJson(req);
    const doc = b.doc ? render.normalizeDoc(b.doc) : c;
    const r2 = await sender.sendTest({ ...c, ...doc, attachments: b.attachments ? uploads.checkAttachments(b.attachments) : c.attachments }, s).catch((e) => fail(502, 'Test email failed: ' + e.message));
    store.audit(s, 'mail.test', c.id, { to: s.email });
    res.json({ ok: true, to: s.email, logged: !!r2.logged });
  });
  r.post('/api/admin/mail/campaigns/:id/send', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.send');
    rateLimit('mailsend:' + s.id, 20, 10 * 60e3);
    const c = store.campaign(req.params.id);
    if (!c) fail(404, 'Campaign not found');
    if (!editable(c)) fail(409, 'This email is already ' + c.status + '.');
    const b = await parseJson(req);
    if (!String(c.subject || '').trim()) fail(400, 'Add a subject line first.');
    if (!c.blocks.length) fail(400, 'Add some content to the email first.');
    if (audience.isEveryone(c.audience) && !canSendAll(s)) fail(403, 'Only owners and admins can send to every customer. Narrow the audience (for example by plan or country) or ask an owner.');
    const n = audience.count(c.audience, c.category).count;
    if (!n) fail(400, 'Nobody matches this audience yet. Change the filters.');
    if (b.mode === 'schedule') {
      const at = new Date(String(b.scheduled_at || ''));
      if (isNaN(at)) fail(400, 'Pick a date and time.');
      if (at.getTime() < Date.now() + 60e3) fail(400, 'Pick a time at least a minute from now (or send now).');
      if (at.getTime() > Date.now() + 366 * 864e5) fail(400, 'Pick a time within the next year.');
      const tz = String(b.timezone || 'UTC').replace(/[^\w/+-]/g, '').slice(0, 60) || 'UTC';
      run("UPDATE mail_campaigns SET status = 'scheduled', scheduled_at = ?, timezone = ?, sent_by = ?, updated_at = ? WHERE id = ?", at.toISOString(), tz, s.id, now(), c.id);
      store.audit(s, 'mail.schedule', c.id, { name: c.name, at: at.toISOString(), timezone: tz, recipients: n });
    } else {
      run("UPDATE mail_campaigns SET status = 'sending', scheduled_at = NULL, sent_by = ?, updated_at = ? WHERE id = ?", s.id, now(), c.id);
      store.audit(s, 'mail.send', c.id, { name: c.name, recipients: n, everyone: audience.isEveryone(c.audience) });
      setTimeout(() => sender.tick().catch(() => {}), 50);
    }
    res.json({ ok: true, recipients: n, campaign: campaignView(store.campaign(c.id)) });
  });
  const transition = (from, to, action, extra) => async (req, res) => {
    const s = auth.requireStaff(req, 'mail.send');
    const c = store.campaign(req.params.id);
    if (!c) fail(404, 'Campaign not found');
    if (!from.includes(c.status)) fail(409, `This email is ${c.status}.`);
    run('UPDATE mail_campaigns SET status = ?, updated_at = ? WHERE id = ?', to, now(), c.id);
    if (extra) extra(c);
    store.audit(s, action, c.id, { name: c.name, from: c.status });
    res.json({ ok: true, campaign: campaignView(store.campaign(c.id)) });
  };
  r.post('/api/admin/mail/campaigns/:id/pause', transition(['sending'], 'paused', 'mail.pause'));
  r.post('/api/admin/mail/campaigns/:id/resume', transition(['paused'], 'sending', 'mail.resume'));
  r.post('/api/admin/mail/campaigns/:id/unschedule', transition(['scheduled'], 'draft', 'mail.unschedule', (c) => run('UPDATE mail_campaigns SET scheduled_at = NULL WHERE id = ?', c.id)));
  r.post('/api/admin/mail/campaigns/:id/cancel', transition(['scheduled', 'sending', 'paused'], 'cancelled', 'mail.cancel', (c) => run("UPDATE mail_sends SET status = 'cancelled' WHERE campaign_id = ? AND status = 'queued'", c.id)));
  r.get('/api/admin/mail/campaigns/:id/recipients', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    const F = { opened: 'opened_at IS NOT NULL', clicked: 'clicked_at IS NOT NULL', bounced: '(bounced_at IS NOT NULL OR complained_at IS NOT NULL)', unsubscribed: 'unsubscribed_at IS NOT NULL', failed: "status IN ('failed','skipped')", waiting: "status IN ('queued','sending')" };
    const w = ['campaign_id = ?'], p = [Number(req.params.id)];
    if (F[req.query.filter]) w.push(F[req.query.filter]);
    if (req.query.q) { w.push('email LIKE ?'); p.push('%' + String(req.query.q).toLowerCase().slice(0, 80) + '%'); }
    const rows = all(`SELECT id, user_id, email, name, status, error, sent_at, delivered_at, opened_at, open_count, clicked_at, click_count, bounced_at, complained_at, unsubscribed_at FROM mail_sends WHERE ${w.join(' AND ')} ORDER BY id LIMIT 100 OFFSET ?`, ...p, clampInt(req.query.offset, 0, 1e7, 0));
    res.json({ recipients: rows, total: get(`SELECT COUNT(*) AS c FROM mail_sends WHERE ${w.join(' AND ')}`, ...p).c });
  });

  // ================= Audiences =================
  r.get('/api/admin/mail/audience/options', (req, res) => { auth.requireStaff(req, 'mail.view'); res.json(audience.options()); });
  r.post('/api/admin/mail/audience/count', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.view');
    rateLimit('mailcount:' + s.id, 240, 60e3);
    const b = await parseJson(req);
    res.json({ ...audience.count(b.audience || {}, b.category), can_send_all: canSendAll(s) });
  });
  r.get('/api/admin/mail/contacts', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    const q = '%' + String(req.query.q || '').toLowerCase().slice(0, 80) + '%';
    const rows = all('SELECT * FROM mail_contacts WHERE email LIKE ? OR lower(COALESCE(name, \'\')) LIKE ? ORDER BY id DESC LIMIT 100 OFFSET ?', q, q, clampInt(req.query.offset, 0, 1e7, 0))
      .map((c) => ({ ...c, tags: store.tagsOf(c.email), suppressed: !!store.suppressed(c.email) }));
    res.json({ contacts: rows, total: get('SELECT COUNT(*) AS c FROM mail_contacts WHERE email LIKE ? OR lower(COALESCE(name, \'\')) LIKE ?', q, q).c, suppressed: all('SELECT * FROM mail_suppress ORDER BY created_at DESC LIMIT 200') });
  });
  // CSV body (text/csv). Query: consent=1 (required), tag, source.
  r.post('/api/admin/mail/contacts/import', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    rateLimit('mailimport:' + s.id, 20, 10 * 60e3);
    if (!['1', 'true', 'yes'].includes(String(req.query.consent))) fail(400, 'Tick the box to confirm these people agreed to get emails from you.');
    const text = (await readBody(req, 5e6)).toString('utf8');
    if (text.includes('\u0000')) fail(400, 'That is not a CSV file.');
    const rows = parseCsv(text).slice(0, 50001);
    if (!rows.length) fail(400, 'The file is empty.');
    let head = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z_ ]/g, ''));
    let col = { email: head.findIndex((h) => /^(e-?mail|email address)$/.test(h)), name: head.findIndex((h) => /^(name|full name|first name|firstname|first_name)$/.test(h)), country: head.findIndex((h) => /^(country|country code)$/.test(h)), tags: head.findIndex((h) => /^(tags?|labels?)$/.test(h)) };
    let body = rows.slice(1);
    if (col.email < 0) { col = { email: 0, name: rows[0].length > 1 ? 1 : -1, country: -1, tags: -1 }; body = rows; }
    const tag = store.cleanTag(req.query.tag || '');
    const source = String(req.query.source || 'CSV import').slice(0, 120) + ' · by ' + s.email + ' · ' + now().slice(0, 10);
    const out = { added: 0, updated: 0, invalid: 0, suppressed: 0, total: body.length };
    for (const row of body.slice(0, 50000)) {
      const mail = String(row[col.email] || '').trim().toLowerCase();
      if (!isEmail(mail) || mail.length > 200) { if (row.some((x) => String(x).trim())) out.invalid++; continue; }
      if (store.suppressed(mail)) out.suppressed++;
      const nm = col.name >= 0 ? String(row[col.name] || '').trim().slice(0, 80) : '';
      const ct = col.country >= 0 && /^[a-z]{2}$/i.test(String(row[col.country] || '').trim()) ? String(row[col.country]).trim().toUpperCase() : null;
      const ex = get('SELECT id FROM mail_contacts WHERE email = ?', mail);
      if (ex) { run('UPDATE mail_contacts SET name = COALESCE(NULLIF(?, \'\'), name), country = COALESCE(?, country), consent = 1, consent_source = ?, consent_at = ? WHERE id = ?', nm, ct, source, now(), ex.id); out.updated++; }
      else { run('INSERT INTO mail_contacts(email, name, country, consent, consent_source, consent_at, created_by) VALUES(?,?,?,1,?,?,?)', mail, nm || null, ct, source, now(), s.id); out.added++; }
      const tags = [tag, ...(col.tags >= 0 ? String(row[col.tags] || '').split(/[;|,]/) : [])].map(store.cleanTag).filter(Boolean);
      for (const t of tags) run('INSERT OR IGNORE INTO mail_tags(email, tag) VALUES(?,?)', mail, t);
    }
    store.audit(s, 'mail.contacts_import', 'contacts', { ...out, tag });
    res.json(out);
  });
  r.del('/api/admin/mail/contacts/:id', (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const c = get('SELECT * FROM mail_contacts WHERE id = ?', Number(req.params.id));
    if (!c) fail(404, 'Contact not found');
    run('DELETE FROM mail_contacts WHERE id = ?', c.id);
    if (!get('SELECT 1 FROM users WHERE lower(email) = ?', c.email)) run('DELETE FROM mail_tags WHERE email = ?', c.email);
    store.audit(s, 'mail.contact_delete', c.email);
    res.json({ ok: true });
  });
  r.del('/api/admin/mail/suppressions/:email', (req, res) => {
    const s = auth.requireStaff(req, 'mail.send');
    run('DELETE FROM mail_suppress WHERE email = ?', String(req.params.email).toLowerCase());
    store.audit(s, 'mail.unsuppress', req.params.email);
    res.json({ ok: true });
  });

  // ================= Media library =================
  r.get('/api/admin/mail/media', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    res.json({ images: uploads.list('image'), files: uploads.list('file'), ffmpeg: uploads.ffmpegReady(), limits: { image_mb: uploads.IMAGE_MAX / 1e6, file_mb: uploads.FILE_MAX / 1e6, attach_total_mb: uploads.ATTACH_TOTAL_MAX / 1e6 } });
  });
  // Raw file body. Query: kind=image|file, name, alt.
  r.post('/api/admin/mail/media', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    rateLimit('mailup:' + s.id, 60, 10 * 60e3);
    const kind = req.query.kind === 'file' ? 'file' : 'image';
    const max = kind === 'file' ? uploads.FILE_MAX : uploads.IMAGE_MAX;
    if (Number(req.headers['content-length']) > max) fail(413, kind === 'file' ? 'Attachments can be up to 10 MB.' : 'Images can be up to 8 MB.');
    const buf = await readBody(req, max + 1);
    const m = kind === 'image' ? await uploads.saveImage(buf, { name: req.query.name, alt: req.query.alt, staffId: s.id }) : uploads.saveFile(buf, { name: req.query.name, staffId: s.id });
    store.audit(s, 'mail.upload', m.id, { kind, name: m.name, size: m.size });
    res.json({ media: m });
  });
  r.put('/api/admin/mail/media/:id', async (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const m = uploads.byId(req.params.id);
    if (!m) fail(404, 'File not found');
    const b = await parseJson(req);
    run('UPDATE mail_media SET alt = ?, name = COALESCE(NULLIF(?, \'\'), name) WHERE id = ?', String(b.alt ?? m.alt ?? '').slice(0, 200), String(b.name || '').replace(/[^\w .()-]+/g, '').slice(0, 80), m.id);
    store.audit(s, 'mail.media_edit', m.id);
    res.json({ media: uploads.view(uploads.byId(m.id)) });
  });
  r.del('/api/admin/mail/media/:id', (req, res) => {
    const s = auth.requireStaff(req, 'mail.edit');
    const m = uploads.byId(req.params.id);
    if (!m) fail(404, 'File not found');
    const inUse = get("SELECT id, name FROM mail_campaigns WHERE status IN ('scheduled','sending','paused') AND (blocks LIKE ? OR attachments LIKE ?) LIMIT 1", '%' + m.file.replace('private/', '') + '%', '%' + m.id + '%');
    if (inUse) fail(409, `“${inUse.name}” is still sending with this file. Wait until it is done.`);
    uploads.remove(m.id);
    store.audit(s, 'mail.media_delete', m.id, { name: m.name });
    res.json({ ok: true });
  });
  r.get('/api/admin/mail/media/:id/download', (req, res) => {
    auth.requireStaff(req, 'mail.view');
    const m = uploads.byId(req.params.id);
    if (!m) fail(404, 'File not found');
    const p = path.join(uploads.DIR, m.file);
    res.writeHead(200, { 'Content-Type': m.mime, 'Content-Disposition': `attachment; filename="${m.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(p).pipe(res);
  });
  // Public images for emails.
  r.get('/media/u/:file', (req, res) => {
    const p = uploads.publicPath(req.params.file);
    if (!p) { res.writeHead(404); return res.end('Not found'); }
    serveStatic(path.dirname(p), req, res, { maxAge: 86400 * 365, path: '/' + path.basename(p) });
  });

  // ================= One customer's mail (linked from the customer page) =================
  r.get('/api/admin/mail/users/:id', (req, res) => {
    requireAny(req, 'mail.view', 'users.view');
    const u = get('SELECT id, email, name, marketing_opt_in, status FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'Customer not found');
    res.json({ user: { id: u.id, email: u.email, name: u.name, status: u.status }, prefs: store.prefs(u.email), tags: store.tagsOf(u.email), ...userHistory(u.id, u.email) });
  });
  r.put('/api/admin/mail/users/:id', async (req, res) => {
    const s = requireAny(req, 'mail.edit', 'users.edit');
    const u = get('SELECT id, email FROM users WHERE id = ?', Number(req.params.id));
    if (!u) fail(404, 'Customer not found');
    const b = await parseJson(req);
    if (b.tags) store.setTags(u.email, Array.isArray(b.tags) ? b.tags : String(b.tags).split(','));
    if (b.marketing !== undefined || b.product !== undefined) store.setPrefs(u.email, { marketing: b.marketing, product: b.product });
    store.audit(s, 'mail.user_prefs', u.id, b);
    res.json({ prefs: store.prefs(u.email), tags: store.tagsOf(u.email) });
  });

  // ================= Public: tracking, unsubscribe, preferences =================
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  r.get('/m/o/:token', (req, res) => {
    try {
      rateLimit('mopen:' + req.ip, 1200, 60e3);
      const s = sendByToken(req.params.token);
      if (s && req.method === 'GET') {
        run('UPDATE mail_sends SET opened_at = COALESCE(opened_at, ?), open_count = open_count + 1 WHERE id = ?', now(), s.id);
      }
    } catch {}
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': GIF.length, 'Cache-Control': 'no-store, no-cache, must-revalidate, private', Pragma: 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : GIF);
  });
  r.get('/m/c/:token', (req, res) => {
    rateLimit('mclick:' + req.ip, 600, 60e3);
    const url = String(req.query.u || '');
    const s = sendByToken(req.params.token);
    // Only links the server signed for this email are followed: no open redirects.
    if (!s || !sender.verifyClick(s.token, url, req.query.s)) return res.html(page('Link not valid', '<h1>This link is not valid.</h1><p>It may have been changed or copied wrong. You can still go to <a href="' + esc(config.appUrl) + '">Vooads</a>.</p>'), 400);
    if (req.method === 'GET') {
      const t = now();
      run('UPDATE mail_sends SET clicked_at = COALESCE(clicked_at, ?), click_count = click_count + 1, opened_at = COALESCE(opened_at, ?) WHERE id = ?', t, t, s.id);
      run("INSERT INTO mail_events(send_id, campaign_id, type, url) VALUES(?,?,'click',?)", s.id, s.campaign_id, url.slice(0, 1000));
    }
    res.writeHead(302, { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end();
  });
  r.get('/m/u/:token', (req, res) => {
    if (req.params.token === 'test') return res.html(page('Test email', '<h1>This was a test email.</h1><p>In a real email this button unsubscribes the person who got it.</p>'));
    const s = sendByToken(req.params.token);
    if (!s) return res.html(page('Link not valid', '<h1>This link is not valid.</h1><p>Open the latest email from us and use its unsubscribe link.</p>'), 404);
    const p = store.prefs(s.email);
    if (!p.marketing && !p.product) return res.html(page('Unsubscribed', `<div class="ok">&#10003;</div><h1>You are unsubscribed.</h1><p><b>${esc(s.email)}</b> gets no tips, offers or product updates. Receipts and login codes still arrive.</p><p class="small"><a href="/m/p/${esc(s.token)}">Change email preferences</a></p>`));
    res.html(page('Unsubscribe', `<h1>Unsubscribe?</h1><p>Stop tips, offers and product updates to <b>${esc(s.email)}</b>. Receipts and login codes still arrive.</p><form method="post" action="/m/u/${esc(s.token)}"><button type="submit" class="brand">Unsubscribe</button></form><p class="small">Or <a href="/m/p/${esc(s.token)}">choose what you get</a>.</p>`));
  });
  r.post('/m/u/:token', async (req, res) => {
    rateLimit('munsub:' + req.ip, 60, 60e3);
    const s = sendByToken(req.params.token);
    await readBody(req, 1e4).catch(() => null);
    if (!s) return res.html(page('Link not valid', '<h1>This link is not valid.</h1>'), 404);
    unsubscribe(s, req.headers['content-type']?.includes('form') && !req.headers.origin ? 'one-click' : 'page');
    res.html(page('Unsubscribed', `<div class="ok">&#10003;</div><h1>You are unsubscribed.</h1><p>We will not send tips, offers or product updates to <b>${esc(s.email)}</b>. Receipts and login codes still arrive.</p><p class="small"><a href="/m/p/${esc(s.token)}">Changed your mind? Email preferences</a></p>`));
  });
  r.get('/m/p/:token', (req, res) => {
    if (req.params.token === 'test') return res.html(page('Test email', '<h1>This was a test email.</h1><p>In a real email this opens the person\'s email preferences.</p>'));
    const s = sendByToken(req.params.token);
    if (!s) return res.html(page('Link not valid', '<h1>This link is not valid.</h1>'), 404);
    res.html(page('Email preferences', prefsForm(s.token, store.prefs(s.email))));
  });
  r.post('/m/p/:token', async (req, res) => {
    rateLimit('mprefs:' + req.ip, 60, 60e3);
    const s = sendByToken(req.params.token);
    if (!s) return res.html(page('Link not valid', '<h1>This link is not valid.</h1>'), 404);
    const b = await parseJson(req);
    const p = store.setPrefs(s.email, { marketing: b.marketing === 'on', product: b.product === 'on' });
    if (!p.marketing && !p.product) unsubscribe(s, 'preferences');
    else if (s.unsubscribed_at) run('UPDATE mail_sends SET unsubscribed_at = NULL WHERE id = ?', s.id);
    res.html(page('Email preferences', prefsForm(s.token, p, true)));
  });
  // One-click unsubscribe (List-Unsubscribe-Post) for the lifecycle marketing emails, which link to /api/email/unsubscribe.
  r.post('/api/email/unsubscribe', async (req, res) => {
    rateLimit('munsub:' + req.ip, 60, 60e3);
    await readBody(req, 1e4).catch(() => null);
    const uid = Number(req.query.u);
    if (!uid || !safeEqual(email.unsubToken(uid), req.query.t)) return res.json({ error: 'That link is not valid.' }, 400);
    run('UPDATE users SET marketing_opt_in = 0 WHERE id = ?', uid);
    res.json({ ok: true });
  });

  // ================= Resend webhook =================
  r.post('/api/webhooks/mail/resend', async (req, res) => {
    const raw = (await readBody(req, 1e6)).toString('utf8');
    if (!verifySvix(raw, req.headers, webhookSecret())) return res.json({ error: 'Bad signature' }, 401);
    let ev;
    try { ev = JSON.parse(raw); } catch { return res.json({ error: 'Bad JSON' }, 400); }
    const d = ev.data || {};
    const s = d.email_id ? get('SELECT * FROM mail_sends WHERE provider_id = ?', String(d.email_id)) : null;
    const to = (Array.isArray(d.to) ? d.to : [d.to]).filter(Boolean).map((x) => String(x).toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1'));
    const t = now();
    if (ev.type === 'email.delivered' && s) run('UPDATE mail_sends SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ?', t, s.id);
    if (ev.type === 'email.bounced') {
      if (s) run('UPDATE mail_sends SET bounced_at = COALESCE(bounced_at, ?) WHERE id = ?', t, s.id);
      for (const e of to) store.suppress(e, 'bounce', d.bounce?.message || d.bounce?.type || '');
    }
    if (ev.type === 'email.complained') {
      if (s) run('UPDATE mail_sends SET complained_at = COALESCE(complained_at, ?) WHERE id = ?', t, s.id);
      for (const e of to) { store.suppress(e, 'complaint', 'Marked as spam'); store.setPrefs(e, { marketing: false, product: false }); }
    }
    if (s && ['email.delivered', 'email.bounced', 'email.complained'].includes(ev.type)) run('INSERT INTO mail_events(send_id, campaign_id, type) VALUES(?,?,?)', s.id, s.campaign_id, ev.type.slice(6));
    res.json({ received: true });
  });
};

// Small CSV parser (quotes, escaped quotes, commas/semicolons, CRLF).
function parseCsv(text) {
  const t = String(text).replace(/^﻿/, '');
  const firstLine = t.slice(0, t.indexOf('\n') < 0 ? t.length : t.indexOf('\n'));
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}
module.exports.parseCsv = parseCsv;
module.exports.verifySvix = verifySvix;
