// Mail: database tables and small shared helpers (preferences, suppression list, settings, audit).
// Tables are created on first require; safe to run on every boot.
const { db, get, all, run, J } = require('../db');
const { id, now } = require('../lib/util');

db.exec(`
CREATE TABLE IF NOT EXISTS mail_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, subject TEXT, preheader TEXT, from_name TEXT,
  blocks TEXT NOT NULL DEFAULT '[]', created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mail_lifecycle_blocks (id TEXT PRIMARY KEY, blocks TEXT NOT NULL, saved_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mail_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, subject TEXT, preheader TEXT, from_name TEXT,
  blocks TEXT NOT NULL DEFAULT '[]', attachments TEXT NOT NULL DEFAULT '[]', audience TEXT NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'marketing', status TEXT NOT NULL DEFAULT 'draft', scheduled_at TEXT, timezone TEXT,
  materialized INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT,
  created_by INTEGER, sent_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS mail_campaigns_status ON mail_campaigns(status, scheduled_at);
CREATE TABLE IF NOT EXISTS mail_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, user_id INTEGER, contact_id INTEGER,
  email TEXT NOT NULL, name TEXT, token TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT, claimed_at TEXT, error TEXT, provider_id TEXT,
  sent_at TEXT, delivered_at TEXT, opened_at TEXT, open_count INTEGER NOT NULL DEFAULT 0, clicked_at TEXT, click_count INTEGER NOT NULL DEFAULT 0,
  bounced_at TEXT, complained_at TEXT, unsubscribed_at TEXT, UNIQUE(campaign_id, email)
);
CREATE INDEX IF NOT EXISTS mail_sends_queue ON mail_sends(campaign_id, status, next_at);
CREATE INDEX IF NOT EXISTS mail_sends_provider ON mail_sends(provider_id);
CREATE INDEX IF NOT EXISTS mail_sends_user ON mail_sends(user_id);
CREATE INDEX IF NOT EXISTS mail_sends_email ON mail_sends(email);
CREATE TABLE IF NOT EXISTS mail_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, send_id INTEGER, campaign_id INTEGER, type TEXT NOT NULL, url TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS mail_events_campaign ON mail_events(campaign_id, type);
CREATE TABLE IF NOT EXISTS mail_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT, country TEXT,
  consent INTEGER NOT NULL DEFAULT 0, consent_source TEXT, consent_at TEXT, unsubscribed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mail_tags (email TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY(email, tag));
CREATE TABLE IF NOT EXISTS mail_prefs (email TEXT PRIMARY KEY, marketing INTEGER NOT NULL DEFAULT 1, product INTEGER NOT NULL DEFAULT 1, updated_at TEXT);
CREATE TABLE IF NOT EXISTS mail_suppress (email TEXT PRIMARY KEY, reason TEXT NOT NULL, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS mail_media (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, mime TEXT, size INTEGER, file TEXT NOT NULL,
  width INTEGER, height INTEGER, alt TEXT, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const lower = (e) => String(e || '').trim().toLowerCase();

// Once per database: give the built-in roles their Mail access (Owner already has everything).
// Manager may design and send to chosen audiences; only owners (or roles given mail.send_all) reach every customer.
try {
  if (!get("SELECT 1 FROM settings WHERE key = 'mail_roles_v1'")) {
    const add = { Manager: ['mail.view', 'mail.edit', 'mail.send'], Viewer: ['mail.view'] };
    for (const [name, perms] of Object.entries(add)) {
      const r = get('SELECT id, permissions FROM roles WHERE name = ?', name);
      if (!r) continue;
      const cur = J(r.permissions, []);
      run('UPDATE roles SET permissions = ? WHERE id = ?', JSON.stringify([...new Set([...cur, ...perms])]), r.id);
    }
    if (get('SELECT 1 FROM roles LIMIT 1')) run("INSERT OR REPLACE INTO settings(key, value) VALUES('mail_roles_v1', '1')");
  }
} catch (e) { console.error('[mail] roles', e.message); }

// ---------- Settings ----------
const DEFAULT_SETTINGS = { rate_per_minute: 120, default_from_name: 'Vooads', max_attempts: 4 };
function settings() {
  const { getSetting } = require('../settings');
  const v = getSetting('mail_settings');
  return { ...DEFAULT_SETTINGS, ...(v && typeof v === 'object' ? v : {}) };
}
function saveSettings(patch) {
  const { setSetting } = require('../settings');
  const cur = settings();
  const next = {
    rate_per_minute: Math.max(1, Math.min(6000, Math.round(Number(patch.rate_per_minute ?? cur.rate_per_minute)) || DEFAULT_SETTINGS.rate_per_minute)),
    default_from_name: String(patch.default_from_name ?? cur.default_from_name).replace(/[<>"\r\n@,;:]/g, '').trim().slice(0, 60) || 'Vooads',
    max_attempts: Math.max(1, Math.min(8, Math.round(Number(patch.max_attempts ?? cur.max_attempts)) || 4)),
  };
  setSetting('mail_settings', next);
  return next;
}

// ---------- Preferences ----------
// Marketing for customers lives in users.marketing_opt_in (the lifecycle emails read it too). Product updates live in mail_prefs.
function prefs(email) {
  const e = lower(email);
  const u = get('SELECT id, marketing_opt_in FROM users WHERE lower(email) = ?', e);
  const c = u ? null : get('SELECT id, unsubscribed FROM mail_contacts WHERE email = ?', e);
  const p = get('SELECT * FROM mail_prefs WHERE email = ?', e);
  const marketing = u ? !!u.marketing_opt_in : c ? !c.unsubscribed && (p ? !!p.marketing : true) : p ? !!p.marketing : true;
  return { email: e, marketing, product: p ? !!p.product : true, user_id: u?.id || null, contact_id: c?.id || null, suppressed: suppressed(e) };
}
function setPrefs(email, { marketing, product }) {
  const e = lower(email);
  const cur = prefs(e);
  const m = marketing === undefined ? cur.marketing : !!marketing;
  const p = product === undefined ? cur.product : !!product;
  run('INSERT INTO mail_prefs(email, marketing, product, updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET marketing = excluded.marketing, product = excluded.product, updated_at = excluded.updated_at', e, m ? 1 : 0, p ? 1 : 0, now());
  run('UPDATE users SET marketing_opt_in = ? WHERE lower(email) = ?', m ? 1 : 0, e);
  run('UPDATE mail_contacts SET unsubscribed = ? WHERE email = ?', m || p ? 0 : 1, e);
  return prefs(e);
}

// ---------- Suppression (bounces, complaints) ----------
const suppressed = (email) => get('SELECT reason, created_at FROM mail_suppress WHERE email = ?', lower(email)) || null;
function suppress(email, reason, detail = '') {
  const e = lower(email);
  if (!e) return;
  run('INSERT INTO mail_suppress(email, reason, detail) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET reason = excluded.reason, detail = excluded.detail', e, String(reason).slice(0, 30), String(detail).slice(0, 300));
}

// ---------- Tags ----------
const cleanTag = (t) => String(t || '').trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/\s+/g, '-').slice(0, 40);
function setTags(email, tags) {
  const e = lower(email);
  run('DELETE FROM mail_tags WHERE email = ?', e);
  for (const t of [...new Set((tags || []).map(cleanTag).filter(Boolean))].slice(0, 30)) run('INSERT OR IGNORE INTO mail_tags(email, tag) VALUES(?,?)', e, t);
  return tagsOf(e);
}
const tagsOf = (email) => all('SELECT tag FROM mail_tags WHERE email = ? ORDER BY tag', lower(email)).map((r) => r.tag);

// ---------- Audit ----------
const audit = (staff, action, target, detail) => run('INSERT INTO audit_log(staff_id, action, target, detail) VALUES(?,?,?,?)', staff?.id ?? null, action, String(target ?? ''), JSON.stringify(detail || {}));

const newToken = () => id(18);
const campaign = (cid) => {
  const c = get('SELECT * FROM mail_campaigns WHERE id = ?', Number(cid));
  return c ? { ...c, blocks: J(c.blocks, []), attachments: J(c.attachments, []), audience: J(c.audience, {}) } : null;
};

module.exports = { settings, saveSettings, prefs, setPrefs, suppressed, suppress, setTags, tagsOf, cleanTag, audit, newToken, campaign, lower, DEFAULT_SETTINGS };
