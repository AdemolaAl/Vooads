// Database: built-in SQLite (node:sqlite). One file in DATA_DIR. On Railway, mount a Volume at /data and set DATA_DIR=/data.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });

const DB_FILE = path.join(config.dataDir, 'vooads.db');
const existed = fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0;
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Migrations: every schema change in this app is additive and safe to run again (CREATE TABLE/INDEX IF NOT EXISTS,
// and ALTER TABLE ADD COLUMN only after checking the column is missing). They run at every boot, here and in the
// modules that own their tables (support.js, mail/store.js, uploads.js, ...). Nothing is ever dropped or renamed.
// Before any of them run, an existing database is copied to DATA_DIR/backups (newest 10 kept; BACKUP_ON_BOOT=0 skips).
if (existed && process.env.BACKUP_ON_BOOT !== '0') {
  try { const name = require('./backups').snapshot(db, 'boot'); console.log('[backup] saved ' + name + ' before migrations'); }
  catch (e) { console.error('[backup] boot backup failed (continuing):', e.message); }
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT, country TEXT, voo_id TEXT UNIQUE,
  plan_id TEXT, plan_period TEXT, plan_expires_at TEXT,
  plan_credits INTEGER NOT NULL DEFAULT 0, plan_credits_reset_at TEXT,
  topup_credits INTEGER NOT NULL DEFAULT 0,
  trial_credits INTEGER NOT NULL DEFAULT 0,
  auto_renew INTEGER NOT NULL DEFAULT 0, stripe_customer TEXT, stripe_sub TEXT,
  referred_by TEXT, ref_code TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', ban_reason TEXT,
  brand TEXT, onboarding TEXT DEFAULT '{}', flags TEXT DEFAULT '{}',
  marketing_opt_in INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'user',
  code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS login_codes_email ON login_codes(email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER, staff_id INTEGER, expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]', limits TEXT NOT NULL DEFAULT '{}', system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT, role_id INTEGER REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'invited', invite_token TEXT, invited_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL, adapter TEXT NOT NULL,
  model TEXT, api_key_enc TEXT, config TEXT NOT NULL DEFAULT '{}',
  cost_usd REAL NOT NULL DEFAULT 0, cost_unit TEXT, enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, adapter TEXT NOT NULL,
  secret_enc TEXT, public_key TEXT, webhook_secret_enc TEXT, config TEXT NOT NULL DEFAULT '{}',
  countries TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), method_id INTEGER, adapter TEXT,
  kind TEXT, plan_id TEXT, period TEXT, topup_id TEXT, credits INTEGER DEFAULT 0, amount_usd REAL, discount_code TEXT,
  provider_ref TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', raw TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, paid_at TEXT
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), delta INTEGER NOT NULL, bucket TEXT,
  reason TEXT, ref TEXT, staff_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', step TEXT, input TEXT, state TEXT DEFAULT '{}', output TEXT,
  credits INTEGER NOT NULL DEFAULT 0, refunded INTEGER NOT NULL DEFAULT 0, error TEXT, demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, user_id INTEGER, mime TEXT, file TEXT, url TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL, excerpt TEXT, body_md TEXT,
  cover_url TEXT, tags TEXT NOT NULL DEFAULT '[]', author TEXT, status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT, read_minutes INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, to_email TEXT NOT NULL, template TEXT NOT NULL,
  vars TEXT NOT NULL DEFAULT '{}', send_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS email_queue_due ON email_queue(sent_at, send_at);

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY, trigger TEXT, delay TEXT, subject TEXT, preheader TEXT, heading TEXT, body_html TEXT,
  cta_label TEXT, cta_url TEXT, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS discounts (
  code TEXT PRIMARY KEY, percent INTEGER NOT NULL, applies_to TEXT NOT NULL DEFAULT 'first_month',
  expires_at TEXT, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, user_id INTEGER, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), from_staff INTEGER NOT NULL DEFAULT 0,
  staff_id INTEGER, body TEXT NOT NULL, read_by_staff INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, action TEXT, target TEXT, detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const J = (s, d) => {
  if (s === null || s === undefined || s === '') return d;
  try { return JSON.parse(s); } catch { return d; }
};
const clean = (row) => (row ? Object.assign({}, row) : row);

const get = (sql, ...p) => clean(db.prepare(sql).get(...p));
const all = (sql, ...p) => db.prepare(sql).all(...p).map(clean);
const run = (sql, ...p) => db.prepare(sql).run(...p);
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, get, all, run, tx, J };
