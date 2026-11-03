// Logins (email code), sessions, and staff permissions.
const config = require('./config');
const { get, all, run, J } = require('./db');
const { id, code6, sha256, now, addDays, isEmail, refCode, safeEqual } = require('./lib/util');
const { fail, rateLimit } = require('./lib/http');

const USER_COOKIE = 'va_s';
const STAFF_COOKIE = 'va_a';
// "Keep me signed in": a 30-day session that rolls forward while it is used. Otherwise a browser-session cookie,
// backed by a server session that ends after SHORT_HOURS without use.
const SESSION_DAYS = 30;
const SHORT_HOURS = 12;
const REFRESH_MS = 6 * 3600e3; // move expiry forward at most every 6 hours (saves a write per request)

// Session ids are stored hashed: a copy of the database cannot be used to log in.
const sidHash = (sid) => sha256('sess:' + sid);
const sessionLife = (remember) => (remember ? SESSION_DAYS * 864e5 : SHORT_HOURS * 3600e3);
const cookieOpts = (remember) => ({ ...(remember ? { maxAge: SESSION_DAYS * 86400 } : {}), secure: config.isProd });

try {
  const cols = all('PRAGMA table_info(sessions)').map((c) => c.name);
  for (const [c, d] of [['remember', 'INTEGER NOT NULL DEFAULT 1'], ['last_seen_at', 'TEXT'], ['user_agent', 'TEXT'], ['ip', 'TEXT']]) if (!cols.includes(c)) run(`ALTER TABLE sessions ADD COLUMN ${c} ${d}`);
  run('CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)');
  run('CREATE INDEX IF NOT EXISTS sessions_staff ON sessions(staff_id)');
} catch (e) { console.error('[sessions] migrate', e.message); }

// Every permission the admin understands. Roles are lists of these. "*" means everything.
const PERMISSIONS = {
  'dashboard.view': 'See the admin overview and revenue',
  'users.view': 'See customers and their usage',
  'users.edit': 'Edit customer details and plans',
  'users.credits': 'Give or remove credits (up to the role limit)',
  'users.ban': 'Suspend or ban customers',
  'users.finance': 'See money: what each customer spent, our AI cost, profit, revenue charts and CSV export',
  'payments.view': 'See payments and receipts',
  'payments.refund': 'Mark payments as refunded',
  'payments.manage': 'Set up payment methods and keys',
  'providers.view': 'See AI providers and costs',
  'providers.manage': 'Add, switch and edit AI providers and keys',
  'pricing.view': 'See plans, credit costs and top-ups',
  'pricing.manage': 'Change plans, credit costs, top-ups and discount codes',
  'blog.view': 'See blog posts',
  'blog.edit': 'Write, edit and publish blog posts',
  'emails.view': 'See email templates and the send log',
  'emails.edit': 'Edit email templates and send test emails',
  'mail.view': 'See Mail: campaigns, templates, audiences and stats',
  'mail.edit': 'Design emails and templates, upload images and files, import contacts, send tests',
  'mail.send': 'Send, schedule, pause and cancel campaigns to a chosen audience',
  'mail.send_all': 'Send a campaign to every customer at once (owners and admins)',
  'support.reply': 'Read and reply to customer support chats',
  'tickets.view': 'See support tickets (all, or only assigned ones if the role is limited)',
  'tickets.reply': 'Reply to tickets, add internal notes and change status',
  'tickets.assign': 'Assign tickets to team members',
  'tickets.manage': 'Edit macros and support settings (SLA, VooSquare)',
  'calls.handle': 'See and handle callback requests',
  'tickets.close': 'Solve and close tickets',
  'staff.view': 'See staff members and roles',
  'staff.manage': 'Invite staff, create roles and set permissions',
  'settings.view': 'See site settings',
  'settings.manage': 'Change site settings',
  'audit.view': 'See the activity log of staff actions',
  'features.view': 'See the AI tools built for customers',
  'features.manage': 'Build, test and publish AI tools for customers',
};

function perms(staff) {
  if (!staff) return [];
  const role = staff.role_id ? get('SELECT * FROM roles WHERE id = ?', staff.role_id) : null;
  if (!role) return [];
  return J(role.permissions, []);
}
function roleLimits(staff) {
  const role = staff && staff.role_id ? get('SELECT limits FROM roles WHERE id = ?', staff.role_id) : null;
  return role ? J(role.limits, {}) : {};
}
const can = (staff, p) => {
  const list = perms(staff);
  return list.includes('*') || list.includes(p);
};

function newSession(res, { userId = null, staffId = null, remember = true, req = null }) {
  const sid = id(32);
  remember = remember !== false;
  run('INSERT INTO sessions(id, user_id, staff_id, expires_at, remember, last_seen_at, user_agent, ip) VALUES(?,?,?,?,?,?,?,?)',
    sidHash(sid), userId, staffId, new Date(Date.now() + sessionLife(remember)).toISOString(), remember ? 1 : 0, now(),
    req ? String(req.headers['user-agent'] || '').slice(0, 200) : null, req ? String(req.ip || '').slice(0, 64) : null);
  res.cookie(staffId ? STAFF_COOKIE : USER_COOKIE, sid, cookieOpts(remember));
  return sid;
}
function endSession(req, res, staff = false) {
  const name = staff ? STAFF_COOKIE : USER_COOKIE;
  const sid = req.cookies[name];
  if (sid) run('DELETE FROM sessions WHERE id IN (?, ?)', sidHash(sid), sid);
  res.cookie(name, '', { maxAge: 0, secure: cookieOpts(true).secure });
}
// Sign out everywhere: every session of this customer (or staff member), including the current one.
function endAllSessions(req, res, { userId = null, staffId = null }) {
  const n = userId ? run('DELETE FROM sessions WHERE user_id = ?', userId).changes : staffId ? run('DELETE FROM sessions WHERE staff_id = ?', staffId).changes : 0;
  res.cookie(staffId ? STAFF_COOKIE : USER_COOKIE, '', { maxAge: 0, secure: cookieOpts(true).secure });
  return Number(n);
}
function countSessions({ userId = null, staffId = null }) {
  return userId ? get('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ? AND expires_at > ?', userId, now()).c
    : get('SELECT COUNT(*) AS c FROM sessions WHERE staff_id = ? AND expires_at > ?', staffId, now()).c;
}
function sessionFor(req, staff = false) {
  const sid = req.cookies[staff ? STAFF_COOKIE : USER_COOKIE];
  if (!sid || sid.length > 100) return null;
  let s = get('SELECT * FROM sessions WHERE id = ?', sidHash(sid));
  // Sessions created before ids were hashed (raw 43-character ids) keep working until they expire.
  if (!s && /^[\w-]{43}$/.test(sid)) s = get('SELECT * FROM sessions WHERE id = ?', sid);
  if (!s) return null;
  if (s.expires_at < now()) { run('DELETE FROM sessions WHERE id = ?', s.id); return null; }
  if ((staff ? !s.staff_id : !s.user_id)) return null;
  // Rolling expiry: active sessions stay signed in.
  const seen = Date.parse(s.last_seen_at || s.created_at || 0) || 0;
  if (Date.now() - seen > REFRESH_MS && req.res) {
    const remember = s.remember !== 0;
    run('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?', new Date(Date.now() + sessionLife(remember)).toISOString(), now(), s.id);
    if (remember) req.res.cookie(staff ? STAFF_COOKIE : USER_COOKIE, sid, cookieOpts(true));
  }
  return s;
}
function currentUser(req) {
  const s = sessionFor(req);
  if (!s || !s.user_id) return null;
  const u = get('SELECT * FROM users WHERE id = ?', s.user_id);
  if (u) run('UPDATE users SET last_seen_at = ? WHERE id = ?', now(), u.id);
  return u;
}
function currentStaff(req) {
  const s = sessionFor(req, true);
  if (!s || !s.staff_id) return null;
  return get("SELECT * FROM staff WHERE id = ? AND status = 'active'", s.staff_id);
}

// Middleware-style guards. Each returns the user/staff or throws a clean error.
function requireUser(req) {
  const u = currentUser(req);
  if (!u) fail(401, 'Please log in.');
  if (u.status === 'banned') fail(403, 'This account is banned for breaking the Terms. Contact support@vooads.com if you think this is a mistake.');
  if (u.status === 'suspended') fail(403, 'This account is paused while we review it. Contact support@vooads.com.');
  return u;
}
function requireStaff(req, permission) {
  const s = currentStaff(req);
  if (!s) fail(401, 'Please log in to the admin.');
  if (permission && !can(s, permission)) fail(403, 'Your role does not have access to this. Ask the owner to update your permissions.');
  return s;
}

// Email login codes, used for both customers and staff.
function issueCode(email, kind, ip) {
  email = String(email || '').trim().toLowerCase();
  if (!isEmail(email)) fail(400, 'Enter a valid email address.');
  rateLimit('code:' + ip, 10, 6e5);
  rateLimit('code:' + email, 5, 6e5);
  const code = code6();
  run('INSERT INTO login_codes(email, kind, code_hash, expires_at) VALUES(?,?,?,?)', email, kind, sha256(code + config.appSecret), new Date(Date.now() + 10 * 60e3).toISOString());
  return { email, code };
}
const badCodes = new Map(); // email → times of wrong codes (memory; cleared on restart)
setInterval(() => { const t = Date.now(); for (const [k, v] of badCodes) if (!v.some((x) => t - x < 864e5)) badCodes.delete(k); }, 36e5).unref();
function checkCode(email, kind, code, ip) {
  email = String(email || '').trim().toLowerCase();
  rateLimit('verify:' + ip, 20, 6e5);
  // Per account too, so guessing from many addresses does not help: 10 wrong codes per 10 minutes, 30 a day.
  const fails = (badCodes.get(email) || []).filter((t) => Date.now() - t < 864e5);
  if (fails.length >= 30 || fails.filter((t) => Date.now() - t < 6e5).length >= 10) fail(429, 'Too many wrong codes. Wait a while and ask for a new code.');
  const row = get('SELECT * FROM login_codes WHERE email = ? AND kind = ? AND used = 0 ORDER BY id DESC LIMIT 1', email, kind);
  if (!row || row.expires_at < now()) fail(400, 'That code has expired. Ask for a new one.');
  if (row.attempts >= 5) fail(400, 'Too many wrong tries. Ask for a new code.');
  if (!safeEqual(row.code_hash, sha256(String(code || '').trim() + config.appSecret))) {
    run('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    badCodes.set(email, [...fails, Date.now()]);
    fail(400, 'That code is not right. Check the email and try again.');
  }
  run('UPDATE login_codes SET used = 1 WHERE id = ?', row.id);
  return email;
}

function uniqueRefCode() {
  for (let i = 0; i < 10; i++) {
    const c = refCode();
    if (!get('SELECT 1 FROM users WHERE ref_code = ?', c)) return c;
  }
  return refCode() + Date.now().toString(36);
}

function cleanupSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  run('DELETE FROM login_codes WHERE expires_at < ?', addDays(now(), -2));
}

module.exports = {
  PERMISSIONS, perms, can, roleLimits, newSession, endSession, endAllSessions, countSessions, currentUser, currentStaff, requireUser, requireStaff,
  issueCode, checkCode, uniqueRefCode, cleanupSessions, USER_COOKIE, STAFF_COOKIE,
};
