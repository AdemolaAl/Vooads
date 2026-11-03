// Support tickets: schema, settings, SLA, bot reply, staff scope, emails and VooSquare events.
// Routes live in routes/support.js. The old support_messages table is kept and imported once into tickets.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { get, all, run, tx, J } = require('./db');
const { fail } = require('./lib/http');
const { now, esc } = require('./lib/util');
const auth = require('./auth');
const credits = require('./credits');
const email = require('./email');
const voosquare = require('./voosquare');
const { getSetting, setSetting } = require('./settings');

const STATUSES = ['open', 'pending', 'solved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CATEGORIES = ['billing', 'video', 'account', 'bug', 'call', 'other'];
const CHANNELS = ['web', 'email', 'voosquare'];
const MODES = ['both', 'vooads', 'voosquare'];

// ---------- Schema ----------
function migrate(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other', status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal',
  channel TEXT NOT NULL DEFAULT 'web', assignee_staff_id INTEGER, assignee_ext_id TEXT, assignee_ext_name TEXT,
  voo_ticket_id TEXT, phone TEXT, call_time TEXT,
  created_at TEXT, updated_at TEXT, first_response_at TEXT, last_customer_at TEXT, last_staff_at TEXT, sla_due_at TEXT,
  customer_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS tickets_user ON tickets(user_id, updated_at);
CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status, updated_at);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL, author_id TEXT, author_name TEXT, body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0, attachments TEXT NOT NULL DEFAULT '[]', created_at TEXT
);
CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages(ticket_id, id);
CREATE TABLE IF NOT EXISTS macros (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, created_by INTEGER, created_at TEXT
);`);
  // Who did it, for actions not done by a logged-in staff member (e.g. "voosquare:agent@x.com").
  const cols = db.prepare('PRAGMA table_info(audit_log)').all().map((c) => c.name);
  if (!cols.includes('actor')) db.exec('ALTER TABLE audit_log ADD COLUMN actor TEXT');
  // VooSquare message id (idempotent replies: the same id never adds a second message to a ticket).
  const mcols = db.prepare('PRAGMA table_info(ticket_messages)').all().map((c) => c.name);
  if (!mcols.includes('ext_id')) db.exec('ALTER TABLE ticket_messages ADD COLUMN ext_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ticket_messages_ext ON ticket_messages(ticket_id, ext_id) WHERE ext_id IS NOT NULL');
  if (!get('SELECT 1 FROM macros LIMIT 1') && !flag('macros_seeded')) {
    for (const [title, body] of DEFAULT_MACROS) run('INSERT INTO macros(title, body, created_at) VALUES(?,?,?)', title, body, now());
    setFlag('macros_seeded');
  }
  importLegacy();
}

const DEFAULT_MACROS = [
  ['Refunded failed render', 'Hi {{name}}, sorry about that render. I have put the credits back in your wallet, so you can run it again right away.'],
  ['Need more details', 'Hi {{name}}, thanks for reaching out. Could you send the job link or a screenshot of what you see? Then I can check it straight away.'],
  ['Solved, closing', 'Glad that is sorted. I will mark this ticket as solved. If anything else comes up, just reply here and it opens again.'],
];

// One-time markers kept in the settings table.
function flag(name) { return !!J(get("SELECT value FROM settings WHERE key = 'support_flags'")?.value, {})[name]; }
function setFlag(name) {
  const f = J(get("SELECT value FROM settings WHERE key = 'support_flags'")?.value, {});
  f[name] = now();
  run("INSERT INTO settings(key, value) VALUES('support_flags', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(f));
}

// Import old chat messages (support_messages) into one "Chat with support" ticket per customer.
// Tracks the last imported id, so it is safe to run on every boot.
function importLegacy() {
  const st = J(get("SELECT value FROM settings WHERE key = 'support_flags'")?.value, {});
  const last = Number(st.legacy_last_id || 0);
  const rows = all('SELECT m.*, s.name AS staff_name, u.name AS user_name, u.email AS user_email FROM support_messages m LEFT JOIN staff s ON s.id = m.staff_id LEFT JOIN users u ON u.id = m.user_id WHERE m.id > ? ORDER BY m.id', last);
  if (!rows.length) return 0;
  tx(() => {
    for (const m of rows) {
      if (!m.user_id || !get('SELECT 1 FROM users WHERE id = ?', m.user_id)) continue;
      const at = toIso(m.created_at);
      let t = get("SELECT * FROM tickets WHERE user_id = ? AND subject = 'Chat with support' AND channel = 'web' ORDER BY id DESC LIMIT 1", m.user_id);
      if (!t) {
        const info = run("INSERT INTO tickets(user_id, subject, category, status, priority, channel, created_at, updated_at, sla_due_at) VALUES(?, 'Chat with support', 'other', 'open', 'normal', 'web', ?, ?, ?)", m.user_id, at, at, slaDue('normal', at));
        t = get('SELECT * FROM tickets WHERE id = ?', Number(info.lastInsertRowid));
      }
      run('INSERT INTO ticket_messages(ticket_id, author_type, author_id, author_name, body, internal, created_at) VALUES(?,?,?,?,?,0,?)',
        t.id, m.from_staff ? 'staff' : 'customer', m.from_staff ? String(m.staff_id || '') : String(m.user_id), m.from_staff ? (m.staff_name || 'Vooads support') : (m.user_name || m.user_email), m.body, at);
      if (m.from_staff) run("UPDATE tickets SET status = 'pending', last_staff_at = ?, first_response_at = COALESCE(first_response_at, ?), updated_at = ?, assignee_staff_id = COALESCE(assignee_staff_id, ?) WHERE id = ?", at, at, at, m.staff_id || null, t.id);
      else run("UPDATE tickets SET status = 'open', last_customer_at = ?, updated_at = ? WHERE id = ?", at, at, t.id);
    }
    st.legacy_last_id = rows[rows.length - 1].id;
    run("INSERT INTO settings(key, value) VALUES('support_flags', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(st));
  });
  return rows.length;
}
// SQLite CURRENT_TIMESTAMP ("2026-01-02 10:00:00") → ISO, so all ticket times compare as strings.
const toIso = (s) => (!s ? now() : s.includes('T') ? s : s.replace(' ', 'T') + '.000Z');

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  // Launch (2026-11-03): on by default. Nothing is sent until VOO_WEBHOOK_SECRET (Admin → Integrations) is set.
  voosquare: { enabled: true, mode: 'both', events_url: '', max_credit_grant: 500 },
  sla_hours: { urgent: 1, high: 4, normal: 12, low: 24 },
  auto_reply: true,
  business_hours: 'Monday to Friday, 9:00 to 18:00 (WAT)',
};
function settings() {
  const s = getSetting('support') || {};
  return {
    ...DEFAULT_SETTINGS, ...s,
    voosquare: { ...DEFAULT_SETTINGS.voosquare, ...(s.voosquare || {}) },
    sla_hours: { ...DEFAULT_SETTINGS.sla_hours, ...(s.sla_hours || {}) },
  };
}
function saveSettings(b) {
  const cur = settings();
  const out = JSON.parse(JSON.stringify(cur));
  if (b.voosquare) {
    const v = b.voosquare;
    if (v.enabled !== undefined) out.voosquare.enabled = !!v.enabled;
    if (v.mode !== undefined) { if (!MODES.includes(v.mode)) fail(400, 'Mode must be both, vooads or voosquare.'); out.voosquare.mode = v.mode; }
    if (v.events_url !== undefined) {
      const u = String(v.events_url || '').trim();
      if (u && !/^https?:\/\/\S+$/.test(u)) fail(400, 'The events URL must start with https://');
      out.voosquare.events_url = u;
    }
    if (v.max_credit_grant !== undefined) {
      const n = Math.round(Number(v.max_credit_grant));
      if (!Number.isFinite(n) || n < 0 || n > 1e6) fail(400, 'Max credit grant must be a number from 0 to 1,000,000.');
      out.voosquare.max_credit_grant = n;
    }
  }
  if (b.sla_hours) {
    for (const p of PRIORITIES) {
      if (b.sla_hours[p] === undefined) continue;
      const h = Number(b.sla_hours[p]);
      if (!(h > 0 && h <= 720)) fail(400, `Reply time for ${p} must be between 0 and 720 hours.`);
      out.sla_hours[p] = h;
    }
  }
  if (b.auto_reply !== undefined) out.auto_reply = !!b.auto_reply;
  if (b.business_hours !== undefined) out.business_hours = String(b.business_hours).slice(0, 200);
  setSetting('support', out);
  return out;
}
function settingsView() {
  const s = settings();
  return {
    ...s,
    voosquare: { ...s.voosquare, events_url_default: config.voosquare.supportEventsUrl, service_key_set: !!config.voosquare.serviceKey, webhook_secret_set: !!config.voosquare.webhookSecret },
  };
}

const slaDue = (priority, from = now()) => new Date(new Date(from).getTime() + (Number(settings().sla_hours[priority]) || 12) * 36e5).toISOString();
function replyTimeText(priority) {
  const h = Number(settings().sla_hours[priority]) || 12;
  return h < 1 ? `${Math.round(h * 60)} minutes` : h === 1 ? '1 hour' : h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`;
}

// ---------- Help articles for the bot ----------
const FAQ = [
  { id: 'faq-refund-failed', title: 'A video failed. Do I get my credits back?', summary: 'Yes. When a render fails, every credit for that job goes back to your wallet automatically. Open Wallet to see the refund line.', url: '/app#wallet', keywords: 'failed render error refund credits back stuck' },
  { id: 'faq-credits', title: 'How credits work', summary: 'Every job shows its credit price before you start. Plan credits refresh every month and end with the plan period. Top-up credits never expire. Failed jobs give their credits back automatically. The 60 free trial credits cover images and hooks only.', url: '/app#wallet', keywords: 'credits balance trial plan topup top-up expire wallet cost price per second' },
  { id: 'faq-trial', title: 'Free trial: what it includes', summary: 'New accounts get 60 free credits, one free trial per person. Trial credits make images and hooks, but not videos. Videos start with any plan, from $49 a month (Starter).', url: '/app#wallet', keywords: 'free trial 60 credits video starter plan upgrade try second account' },
  { id: 'faq-payment', title: 'I paid but my plan is not active', summary: 'Most payments confirm in under a minute. Crypto can take a few network confirmations. If it still shows pending after 30 minutes, reply with the payment reference.', url: '/app#wallet', keywords: 'paid payment pending plan active card crypto usdt receipt charge' },
  { id: 'faq-cancel', title: 'Cancel or change your plan', summary: 'Turn off auto-renew with one click in Credits & plan. Your plan stays active until the end of the period you paid for and is not charged again. Switching plans replaces unused plan credits with the new plan\'s credits.', url: '/app#wallet', keywords: 'cancel subscription renew downgrade upgrade change plan refund stop' },
  { id: 'faq-auto-renew', title: 'Card plans renew automatically', summary: 'Card plans paid with Bachs renew automatically by default. We email you 3 days before a monthly charge and 7 days before a yearly one. If a card payment fails you get a grace period and an "update card" link in Credits & plan. Bank transfer, mobile money and crypto are prepaid and never renew on their own.', url: '/app#wallet', keywords: 'auto renew renewal automatic charge card bachs reminder failed declined update card grace bank transfer mobile money crypto prepaid' },
  { id: 'faq-bachs-cap', title: 'Paying more than $5,000', summary: 'Bachs takes up to $5,000 per payment. For a bigger amount, pay in parts or choose another payment method.', url: '/app#wallet', keywords: 'limit maximum cap 5000 large payment bachs too big over agency yearly' },
  { id: 'faq-fees', title: 'Are there payment fees?', summary: 'No extra fee line. Payment-method fees are already built into the price you see at checkout.', url: '/app#wallet', keywords: 'fee fees surcharge extra charge processing cost tax checkout price' },
  { id: 'faq-long-video', title: 'Making longer videos', summary: 'Videos longer than one part are rendered in parts and stitched together automatically. The price per second stays the same.', url: '/app#create', keywords: 'long video seconds length minute 60s 30s segments stitch parts' },
  { id: 'faq-languages', title: 'Videos in other languages', summary: 'Pick the language before you generate. The script, voice and captions are made in that language.', url: '/app#create', keywords: 'language spanish french portuguese arabic translate voice accent captions geo' },
  { id: 'faq-ban-shield', title: 'Ad rejected? Use Ban Shield', summary: 'Ban Shield scans your copy for claims that get ads rejected and suggests a safer rewrite.', url: '/app#shield', keywords: 'rejected banned ad account disabled policy meta facebook tiktok compliance shield' },
  { id: 'faq-login', title: 'Trouble logging in', summary: 'We send a 6-digit code to your email. Check spam, wait a minute, then ask for a new code. Codes expire after 10 minutes.', url: '/app', keywords: 'login log in code email sign in account access password' },
  { id: 'faq-voice', title: 'Change the presenter or voice', summary: 'In Create, pick another presenter or voice before you generate. Each presenter has a matching default voice.', url: '/app#create', keywords: 'voice presenter avatar actor face change accent' },
  { id: 'faq-actors', title: 'Who are the AI actors?', summary: 'Vooads has 45 AI actors. They are synthetic people made by AI, not real people. Use them as scripted spokespeople, never as real customers or real reviews (see /legal/ai-content-policy).', url: '/app#actors', keywords: 'actors actor people real person synthetic ai face model creator 45 consent' },
  { id: 'faq-how-it-works', title: 'How Vooads makes a video', summary: 'Type your idea and get a finished video ad. Vooads writes the script, picks the actor and voice, edits it and adds captions, music and your logo automatically. Then change anything by chat.', url: '/app#create', keywords: 'how work start idea make create video ad script captions music logo edit chat change' },
  { id: 'faq-styles', title: 'Ad styles you can make', summary: 'UGC talking video, green-screen reaction, podcast clip, product b-roll, photo to video, slideshow, animated ads, street interview (Pro and up), dubbing, hook remix, background change, auto-edit, brand music and Viral edit (fast cuts on the beat, zooms, bold captions and sound hits).', url: '/app#create', keywords: 'styles style types viral edit ugc podcast street interview slideshow animated dub remix background brand music' },
  { id: 'faq-chat-edit', title: 'Change a finished video by chat', summary: 'Open the video and type what to change, for example "cut the first 2 seconds, captions bigger, new actor in scene 2". You see the price first, confirm with one tap, and get a new version you can compare or undo.', url: '/app#library', keywords: 'change edit fix chat revise caption music hook scene redo tweak' },
  { id: 'faq-policies', title: 'Terms, refunds and privacy', summary: 'Read the Terms at /legal/terms, the Refund Policy at /legal/refunds and the Privacy Policy at /legal/privacy. AI content rules are at /legal/ai-content-policy.', url: '/legal/refunds', keywords: 'terms refund refunds policy privacy legal data delete gdpr' },
  { id: 'faq-referral', title: 'Referral earnings', summary: 'Share your link from Refer. You earn a share of what referred customers pay, settled after the waiting period.', url: '/app#refer', keywords: 'referral refer affiliate commission earn link payout withdraw' },
];
const STOP = new Set('the and for you your with that this have has are was were not but how what why when can cant could would should does did dont from into about there their they them our out get got just like want need help please hello thanks thank hi vooads'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

let lessonsCache = null, lessonsAt = 0;
function lessons() {
  if (lessonsCache && Date.now() - lessonsAt < 60e3) return lessonsCache;
  lessonsAt = Date.now();
  try {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'training', 'lessons.json'), 'utf8'));
    lessonsCache = (Array.isArray(list) ? list : list.lessons || []).filter((l) => l && l.title)
      .map((l) => ({ id: 'lesson-' + l.id, title: l.title, summary: l.summary || '', url: '/app#learn/' + encodeURIComponent(l.id), keywords: '', kind: 'lesson' }));
  } catch { lessonsCache = []; }
  return lessonsCache;
}

// Up to `max` help articles that match the text, best first.
function findArticles(text, max = 3) {
  const q = words(text);
  if (!q.length) return [];
  const scored = [...FAQ.map((f) => ({ ...f, kind: 'faq' })), ...lessons()].map((a) => {
    const title = new Set(words(a.title)), rest = new Set(words(a.summary + ' ' + a.keywords));
    let score = 0;
    for (const w of new Set(q)) {
      if (title.has(w)) score += 3;
      else if (rest.has(w)) score += 1;
      else if (w.length > 4 && [...title, ...rest].some((x) => x.startsWith(w.slice(0, 5)))) score += 0.5;
    }
    return { a, score };
  }).filter((x) => x.score >= 1).sort((x, y) => y.score - x.score);
  return scored.slice(0, max).map(({ a }) => ({ id: a.id, kind: a.kind, title: a.title, summary: a.summary, url: a.url }));
}

function botReplyText(ticket, articles) {
  const s = settings();
  const when = ticket.category === 'call'
    ? `We got your callback request${ticket.phone ? ' for ' + ticket.phone : ''}. Someone from the team will call you${ticket.call_time ? ' at your chosen time (' + ticket.call_time + ')' : ''} or reply here within about ${replyTimeText(ticket.priority)}.`
    : `A person from our team will reply here within about ${replyTimeText(ticket.priority)} (${s.business_hours}). We also email you when they do.`;
  const parts = [`Thanks for writing in. ${when}`];
  if (articles.length) parts.push('While you wait, these might answer it right away:\n' + articles.map((a) => `• ${a.title}: ${a.summary}`).join('\n'));
  parts.push('Your ticket number is #' + ticket.id + '.');
  return parts.join('\n\n');
}

// ---------- Views ----------
const staffName = (id) => (id ? get('SELECT name, email FROM staff WHERE id = ?', id) : null);
function ticketView(t, { withUser = false } = {}) {
  if (!t) return null;
  const st = staffName(t.assignee_staff_id);
  const out = {
    id: t.id, subject: t.subject, status: t.status, priority: t.priority, category: t.category, channel: t.channel,
    assignee_staff_id: t.assignee_staff_id || null, assignee_name: st ? st.name || st.email : t.assignee_ext_name || null,
    assignee_ext_id: t.assignee_ext_id || null, assignee_ext_name: t.assignee_ext_name || null, voo_ticket_id: t.voo_ticket_id || null,
    phone: t.phone || null, call_time: t.call_time || null,
    created_at: t.created_at, updated_at: t.updated_at, first_response_at: t.first_response_at, last_customer_at: t.last_customer_at, last_staff_at: t.last_staff_at,
    sla_due_at: t.sla_due_at, overdue: t.status === 'open' && !!t.sla_due_at && t.sla_due_at < now(), user_id: t.user_id,
  };
  if (withUser) {
    const u = get('SELECT id, email, name FROM users WHERE id = ?', t.user_id);
    out.user = u || null;
    const last = get('SELECT body, author_type, created_at FROM ticket_messages WHERE ticket_id = ? AND internal = 0 AND author_type != ? ORDER BY id DESC LIMIT 1', t.id, 'bot');
    out.last_message = last ? { body: last.body.slice(0, 160), author_type: last.author_type, created_at: last.created_at } : null;
  }
  return out;
}
function customerOf(userId) {
  const u = get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) return null;
  const plan = credits.activePlan(u);
  return { id: u.id, email: u.email, name: u.name, plan: plan ? plan.id : null, voo_id: u.voo_id || null, country: u.country || null, status: u.status };
}
const messageView = (m, { staff = false } = {}) => ({
  id: m.id, ticket_id: m.ticket_id, author_type: m.author_type, author_name: m.author_name || (m.author_type === 'bot' ? 'Vooads assistant' : null),
  body: m.body, created_at: m.created_at, attachments: J(m.attachments, []),
  ...(staff ? { internal: !!m.internal, author_id: m.author_id, ext_id: m.ext_id || null } : {}),
});
function messages(ticketId, { includeInternal = false } = {}) {
  return all(`SELECT * FROM ticket_messages WHERE ticket_id = ? ${includeInternal ? '' : 'AND internal = 0'} ORDER BY id`, ticketId);
}
const unreadFor = (t) => get(`SELECT COUNT(*) AS c FROM ticket_messages WHERE ticket_id = ? AND internal = 0 AND author_type IN ('staff','voosquare','system') AND created_at > ?`, t.id, t.customer_seen_at || '').c;

// ---------- Staff scope ----------
// 'all' (default) or 'assigned' (only tickets assigned to this staff member). Owners always see all.
function scopeOf(staff) {
  if (auth.can(staff, '*')) return 'all';
  return auth.roleLimits(staff).ticket_scope === 'assigned' ? 'assigned' : 'all';
}
// SQL filter (alias t) for what this staff member may see.
function scopeSql(staff) {
  const parts = [], params = [];
  if (scopeOf(staff) === 'assigned') { parts.push('t.assignee_staff_id = ?'); params.push(staff.id); }
  if (!auth.can(staff, 'calls.handle')) parts.push("t.category != 'call'");
  return { sql: parts.length ? parts.join(' AND ') : '1=1', params };
}
function staffTicket(staff, id) {
  const t = get('SELECT * FROM tickets WHERE id = ?', Number(id));
  if (!t) fail(404, 'Ticket not found.');
  if (scopeOf(staff) === 'assigned' && t.assignee_staff_id !== staff.id) fail(403, 'This ticket is not assigned to you. Ask a lead to assign it to you.');
  if (t.category === 'call' && !auth.can(staff, 'calls.handle')) fail(403, 'Your role does not handle callback requests.');
  return t;
}
function assertAdminWritable() {
  if (settings().voosquare.enabled && settings().voosquare.mode === 'voosquare') fail(409, 'Replies happen in VooSquare. Support is set to VooSquare-only mode, so this inbox is read-only. Change it in Support settings.');
}

// ---------- Audit ----------
function audit(actor, action, target, detail) {
  const staffId = actor && typeof actor === 'object' ? actor.id : null;
  const who = actor && typeof actor === 'object' ? actor.email : String(actor || '');
  run('INSERT INTO audit_log(staff_id, action, target, detail, actor) VALUES(?,?,?,?,?)', staffId, action, String(target ?? ''), JSON.stringify({ ...(detail || {}), ...(staffId ? {} : { by: who }) }), who);
}

// ---------- Events + emails ----------
function emit(type, ticket, message, { source } = {}) {
  const s = settings().voosquare;
  if (!s.enabled || s.mode === 'vooads' || source === 'voosquare' || !config.voosquare.webhookSecret) return null;
  const t = get('SELECT * FROM tickets WHERE id = ?', ticket.id);
  const payload = { type, ticket: ticketView(t), customer: customerOf(t.user_id), ...(message ? { message: messageView(message, { staff: true }) } : {}) };
  const p = voosquare.supportEvent(s.events_url || config.voosquare.supportEventsUrl, payload).then((r) => {
    if (r && r.voo_ticket_id && !t.voo_ticket_id) run('UPDATE tickets SET voo_ticket_id = ? WHERE id = ?', String(r.voo_ticket_id).slice(0, 80), t.id);
    return r;
  }).catch(() => null);
  return p;
}

const nl2br = (s) => esc(s).replace(/\r?\n/g, '<br>');
// Template values are inserted into HTML as-is, so customer text is escaped and subjects lose <, > and quotes.
const safeSubject = (s) => String(s || '').replace(/[<>"]/g, '');
const excerpt = (s, n = 600) => nl2br(s.length > n ? s.slice(0, n).trimEnd() + '…' : s);
email.FALLBACK_TEMPLATES.ticket_reply = {
  id: 'ticket_reply', subject: 'Re: {{ticket_subject}} [#{{ticket_id}}]', preheader: '{{agent_name}} replied to your support ticket',
  heading: 'You have a reply', body_html: '<p>Hi {{name}},</p><p>{{agent_name}} replied to your ticket <b>{{ticket_subject}}</b>:</p><blockquote style="margin:0 0 16px;padding:12px 16px;background:#F7F6F2;border-radius:12px">{{reply_html}}</blockquote><p>Reply in the app to keep the conversation in one place.</p>',
  cta_label: 'Open ticket', cta_url: '{{ticket_url}}',
};
email.FALLBACK_TEMPLATES.ticket_new = {
  id: 'ticket_new', subject: '[New ticket #{{ticket_id}}] {{ticket_subject}}', preheader: '{{customer_email}} · {{category}} · {{priority}}',
  heading: 'New support ticket', body_html: '<p><b>{{customer_name}}</b> ({{customer_email}}) opened ticket #{{ticket_id}}.</p><p>Category: {{category}} · Priority: {{priority}}{{phone_line}}</p><blockquote style="margin:0 0 16px;padding:12px 16px;background:#F7F6F2;border-radius:12px">{{message_html}}</blockquote>',
  cta_label: 'Open in admin', cta_url: '{{admin_url}}',
};

function emailReply(t, m) {
  const u = get('SELECT * FROM users WHERE id = ?', t.user_id);
  if (!u) return;
  email.queue('ticket_reply', u.email, {
    ticket_id: t.id, ticket_subject: safeSubject(t.subject), agent_name: esc(m.author_name || 'Vooads support'), reply_html: nl2br(m.body), reply_excerpt: excerpt(m.body),
    ticket_url: `${config.appUrl}/app#support/${t.id}`, status: t.status,
  }, { userId: u.id });
}
function emailNew(t, body) {
  const u = get('SELECT * FROM users WHERE id = ?', t.user_id) || {};
  email.queue('ticket_new', config.brand.supportEmail, {
    ticket_id: t.id, ticket_subject: safeSubject(t.subject), customer_name: esc(u.name || u.email || 'A customer'), customer_email: u.email || '', category: t.category, priority: t.priority,
    phone: t.phone || '', call_time: t.call_time || '', phone_line: t.phone ? ` · Phone: ${esc(t.phone)}${t.call_time ? ' (' + esc(t.call_time) + ')' : ''}` : '',
    message_html: nl2br(body), ticket_body: excerpt(body, 2000), admin_url: `${config.appUrl}/admin#/tickets/${t.id}`, admin_ticket_url: `${config.appUrl}/admin#/tickets/${t.id}`,
  });
}

// ---------- Actions ----------
function insertMessage(ticketId, { author_type, author_id = null, author_name = null, body, internal = false, attachments = [], ext_id = null }) {
  const info = run('INSERT INTO ticket_messages(ticket_id, author_type, author_id, author_name, body, internal, attachments, created_at, ext_id) VALUES(?,?,?,?,?,?,?,?,?)',
    ticketId, author_type, author_id === null ? null : String(author_id), author_name, body, internal ? 1 : 0, JSON.stringify(attachments || []), now(), ext_id ? String(ext_id).slice(0, 120) : null);
  return get('SELECT * FROM ticket_messages WHERE id = ?', Number(info.lastInsertRowid));
}

const cleanBody = (b, max = 5000) => {
  const s = String(b ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
  if (!s) fail(400, 'Write a message first.');
  return s;
};

function createTicket(user, b, { channel = 'web' } = {}) {
  const body = cleanBody(b.body);
  const category = CATEGORIES.includes(b.category) ? b.category : 'other';
  let priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
  if (priority === 'urgent') priority = 'high'; // customers cannot self-mark urgent; staff can raise it
  const subject = String(b.subject || '').trim().slice(0, 140) || body.split('\n')[0].slice(0, 80);
  let phone = null, callTime = null;
  if (category === 'call') {
    phone = String(b.phone || '').trim().slice(0, 30);
    if (!/^\+?[0-9 ()-]{6,30}$/.test(phone)) fail(400, 'Add a phone number we can call, with the country code (for example +234 801 234 5678).');
    callTime = String(b.call_time || '').trim().slice(0, 80) || null;
  }
  const t0 = now();
  const t = tx(() => {
    const info = run('INSERT INTO tickets(user_id, subject, category, status, priority, channel, phone, call_time, created_at, updated_at, last_customer_at, sla_due_at, customer_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      user.id, subject, category, 'open', priority, CHANNELS.includes(channel) ? channel : 'web', phone, callTime, t0, t0, t0, slaDue(priority, t0), t0);
    const tid = Number(info.lastInsertRowid);
    insertMessage(tid, { author_type: 'customer', author_id: user.id, author_name: user.name || user.email, body });
    return get('SELECT * FROM tickets WHERE id = ?', tid);
  });
  const first = get("SELECT * FROM ticket_messages WHERE ticket_id = ? AND author_type = 'customer' ORDER BY id LIMIT 1", t.id);
  if (settings().auto_reply) {
    const articles = findArticles(subject + ' ' + body);
    insertMessage(t.id, { author_type: 'bot', author_name: 'Vooads assistant', body: botReplyText(t, articles), attachments: articles.map((a) => ({ type: 'article', ...a })) });
  }
  emailNew(t, body);
  emit('ticket.created', t, first);
  return get('SELECT * FROM tickets WHERE id = ?', t.id);
}

function customerMessage(user, ticket, bodyIn) {
  if (ticket.status === 'closed') fail(409, 'This ticket is closed. Open a new ticket and we will pick it up.');
  const body = cleanBody(bodyIn);
  const t0 = now();
  const m = insertMessage(ticket.id, { author_type: 'customer', author_id: user.id, author_name: user.name || user.email, body });
  // A new customer message puts the ticket back in the queue. Keep the earlier due time if it was already waiting.
  const wasOpen = ticket.status === 'open';
  run('UPDATE tickets SET status = ?, last_customer_at = ?, updated_at = ?, customer_seen_at = ?, sla_due_at = ? WHERE id = ?',
    'open', t0, t0, t0, wasOpen && ticket.sla_due_at ? ticket.sla_due_at : slaDue(ticket.priority, t0), ticket.id);
  const t = get('SELECT * FROM tickets WHERE id = ?', ticket.id);
  emit('ticket.message', t, m);
  if (!wasOpen) emit('ticket.updated', t, null);
  return m;
}

// Staff or VooSquare reply. author: {type:'staff'|'voosquare', id, name}
function agentReply(ticket, author, { body: bodyIn, internal = false, status, ext_id = null } = {}) {
  const body = cleanBody(bodyIn, 8000);
  if (status !== undefined && status !== null && status !== '' && !STATUSES.includes(status)) fail(400, 'Status must be open, pending, solved or closed.');
  const t0 = now();
  const m = insertMessage(ticket.id, { author_type: author.type, author_id: author.id, author_name: author.name, body, internal, ext_id });
  if (internal) {
    run('UPDATE tickets SET updated_at = ? WHERE id = ?', t0, ticket.id);
    if (status) run('UPDATE tickets SET status = ? WHERE id = ?', status, ticket.id);
  } else {
    run('UPDATE tickets SET status = ?, last_staff_at = ?, first_response_at = COALESCE(first_response_at, ?), updated_at = ? WHERE id = ?', status || 'pending', t0, t0, t0, ticket.id);
    if (author.type === 'staff' && !ticket.assignee_staff_id && !ticket.assignee_ext_id) run('UPDATE tickets SET assignee_staff_id = ? WHERE id = ?', author.id, ticket.id);
  }
  const t = get('SELECT * FROM tickets WHERE id = ?', ticket.id);
  if (!internal) emailReply(t, m);
  emit('ticket.message', t, m, { source: author.type });
  if (status && status !== ticket.status) emit('ticket.updated', t, null, { source: author.type });
  return { ticket: t, message: m };
}

// Change fields. `fields` already validated by caller for permission; values validated here.
function updateTicket(ticket, f, { source } = {}) {
  const set = {};
  if (f.status !== undefined) { if (!STATUSES.includes(f.status)) fail(400, 'Status must be open, pending, solved or closed.'); set.status = f.status; }
  if (f.priority !== undefined) {
    if (!PRIORITIES.includes(f.priority)) fail(400, 'Priority must be low, normal, high or urgent.');
    set.priority = f.priority;
    if (!ticket.first_response_at || ticket.status === 'open') set.sla_due_at = slaDue(f.priority, ticket.last_customer_at || ticket.created_at);
  }
  if (f.category !== undefined) { if (!CATEGORIES.includes(f.category)) fail(400, 'Unknown category.'); set.category = f.category; }
  if (f.assignee_staff_id !== undefined) {
    if (f.assignee_staff_id === null || f.assignee_staff_id === '' || f.assignee_staff_id === 0) set.assignee_staff_id = null;
    else {
      const st = get("SELECT id FROM staff WHERE id = ? AND status = 'active'", Number(f.assignee_staff_id));
      if (!st) fail(400, 'Pick an active team member.');
      set.assignee_staff_id = st.id;
    }
  }
  if (f.assignee_ext_id !== undefined) set.assignee_ext_id = f.assignee_ext_id ? String(f.assignee_ext_id).slice(0, 80) : null;
  if (f.assignee_ext_name !== undefined) set.assignee_ext_name = f.assignee_ext_name ? String(f.assignee_ext_name).slice(0, 80) : null;
  if (f.voo_ticket_id !== undefined) set.voo_ticket_id = f.voo_ticket_id ? String(f.voo_ticket_id).slice(0, 80) : null;
  const keys = Object.keys(set);
  if (!keys.length) return ticket;
  set.updated_at = now();
  const k2 = Object.keys(set);
  run(`UPDATE tickets SET ${k2.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...k2.map((k) => set[k]), ticket.id);
  const t = get('SELECT * FROM tickets WHERE id = ?', ticket.id);
  emit('ticket.updated', t, null, { source });
  return t;
}

function grantCredits(ticket, amountIn, reason, { cap, staffId = null, by }) {
  const amount = Math.round(Number(amountIn));
  if (!(amount > 0)) fail(400, 'Enter how many credits to add (a whole number above 0).');
  if (cap !== undefined && cap !== null && amount > Number(cap)) fail(403, `The most you can give at a time is ${cap} credits.`);
  const why = String(reason || '').trim().slice(0, 200);
  if (!why) fail(400, 'Add a reason. It is saved in the activity log.');
  const applied = credits.grant(ticket.user_id, amount, 'topup', 'Support: ' + why, 'ticket:' + ticket.id, staffId);
  try { email.hooks.creditsAdded(ticket.user_id, applied, 'They were added on your support ticket.'); } catch (e) { console.warn('[email]', e.message); }
  const m = insertMessage(ticket.id, { author_type: 'system', author_name: 'Vooads', body: `${applied.toLocaleString('en-US')} credits were added to your wallet.` });
  insertMessage(ticket.id, { author_type: 'system', author_name: by, body: `Granted ${applied} credits. Reason: ${why}`, internal: true });
  run('UPDATE tickets SET updated_at = ? WHERE id = ?', now(), ticket.id);
  emit('ticket.message', get('SELECT * FROM tickets WHERE id = ?', ticket.id), m, { source: String(by || '').startsWith('voosquare:') ? 'voosquare' : 'staff' });
  return { applied, balance: credits.balance(ticket.user_id) };
}

// Counts for admin and VooSquare. `scope` = {sql, params} on alias t.
function counts(scope = { sql: '1=1', params: [] }, staffId = null) {
  const c = (extra, ...p) => get(`SELECT COUNT(*) AS c FROM tickets t WHERE ${scope.sql} AND ${extra}`, ...scope.params, ...p).c;
  const t = now();
  return {
    open: c("t.status = 'open'"), pending: c("t.status = 'pending'"), solved: c("t.status = 'solved'"), closed: c("t.status = 'closed'"),
    mine: staffId ? c("t.status IN ('open','pending') AND t.assignee_staff_id = ?", staffId) : 0,
    unassigned: c("t.status IN ('open','pending') AND t.assignee_staff_id IS NULL AND t.assignee_ext_id IS NULL"),
    overdue: c("t.status = 'open' AND t.sla_due_at IS NOT NULL AND t.sla_due_at < ?", t),
    calls: c("t.status IN ('open','pending') AND t.category = 'call'"),
  };
}

// Newest ticket a customer can keep chatting in (used by the old /api/support endpoints).
const latestOpenTicket = (userId) => get("SELECT * FROM tickets WHERE user_id = ? AND status != 'closed' ORDER BY updated_at DESC, id DESC LIMIT 1", userId);

module.exports = {
  STATUSES, PRIORITIES, CATEGORIES, CHANNELS, MODES, FAQ, DEFAULT_SETTINGS,
  migrate, importLegacy, flag, setFlag, settings, saveSettings, settingsView, slaDue, findArticles, botReplyText,
  ticketView, customerOf, messageView, messages, unreadFor, scopeOf, scopeSql, staffTicket, assertAdminWritable, audit, emit,
  createTicket, customerMessage, agentReply, updateTicket, grantCredits, counts, latestOpenTicket, insertMessage,
};
