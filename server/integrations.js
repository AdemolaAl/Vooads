// Admin → Integrations: every outside connection in one place, with a status (connected / not connected / error)
// and a Test button. Values saved here are stored in the settings table (secrets encrypted with APP_SECRET) and win
// over environment variables (see config.js). Secrets never go back to the browser: only "set" and a masked hint.
const fs = require('node:fs');
const path = require('node:path');

// key → { label, secret?, help, env }
const FIELDS = {
  'site.app_url': { label: 'Public site URL', env: 'APP_URL', help: 'Your live address, for example https://vooads.com. Used in emails, webhooks and for AI providers to fetch files. Leave empty on Railway to use the Railway domain.' },
  'brand.company': { label: 'Company name', env: 'COMPANY_NAME', help: 'Shown in emails and the footer.' },
  'brand.support_email': { label: 'Support email', env: 'SUPPORT_EMAIL', help: 'Where customers reply and where new-ticket alerts go.' },
  'email.resend_key': { label: 'Resend API key', env: 'RESEND_API_KEY', secret: true, help: 'resend.com → API Keys. Without it, emails (and login codes) are printed in the server log.' },
  'email.from': { label: 'Send emails from', env: 'FROM_EMAIL', help: 'For example: Vooads <hello@vooads.com>. The domain must be verified in Resend.' },
  'email.webhook_secret': { label: 'Resend webhook signing secret', env: 'RESEND_WEBHOOK_SECRET', secret: true, help: 'resend.com → Webhooks → add https://<your site>/api/webhooks/mail/resend (events: delivered, bounced, complained) and paste its signing secret (whsec_…). Turns on delivered/bounce stats in Mail.' },
  'voosquare.base': { label: 'VooSquare address', env: 'VOO_BASE', help: 'https://voosquare.com (no path). With the client ID and secret it turns on "Continue with VooSquare". VooSquare → Admin → Products → Vooads → Credentials.' },
  'voosquare.client_id': { label: 'VooSquare client ID', env: 'VOO_CLIENT_ID', help: 'Starts with vsc_. From VooSquare → Admin → Products → Vooads → Credentials.' },
  'voosquare.client_secret': { label: 'VooSquare client secret', env: 'VOO_CLIENT_SECRET', secret: true, help: 'Starts with vss_. Signs the login tokens.' },
  'voosquare.api_key': { label: 'VooSquare API key', env: 'VOO_API_KEY', secret: true, help: 'Starts with vsk_. Reports plan payments to VooSquare, powers the dashboard card (Summary URL) and "You already have a Voo account".' },
  'voosquare.signal_secret': { label: 'VooSquare signal secret', env: 'VOO_SIGNAL_SECRET', secret: true, help: 'A long random value you make once and never change (openssl rand -hex 32). Hashes fraud hints before they are sent.' },
  'voosquare.issuer': { label: 'Older login issuer URL (not used)', env: 'VOO_ISSUER', help: 'Kept for older setups. Login now uses the VooSquare address above.' },
  'voosquare.webhook_secret': { label: 'VooSquare signing secret', env: 'VOO_WEBHOOK_SECRET', secret: true, help: 'Signs the events Vooads sends to VooSquare (dashboard feed and support inbox).' },
  'voosquare.events_url': { label: 'VooSquare events URL', env: 'VOO_EVENTS_URL', help: 'Dashboard activity feed. Default: https://api.voosquare.com/v1/events' },
  'voosquare.support_events_url': { label: 'VooSquare support events URL', env: 'VOO_SUPPORT_EVENTS_URL', help: 'Support inbox events (tickets). Default: https://api.voosquare.com/v1/support/events' },
  'voosquare.service_key': { label: 'VooSquare service key (inbound API)', env: 'VOO_SERVICE_KEY', secret: true, help: 'VooSquare sends this as "Authorization: Bearer <key>" when it reads tickets or your summary. Generate one here and paste it into VooSquare.' },
};

let cache = null;
function store() {
  if (cache) return cache;
  const { getSetting } = require('./settings');
  return (cache = getSetting('integrations') || {});
}
// Plain value for config.js (decrypted). Empty string when not set in the admin.
const plainCache = new Map();
function value(key) {
  const raw = store()[key];
  if (!raw) return '';
  if (!FIELDS[key]?.secret) return String(raw);
  if (plainCache.has(key)) return plainCache.get(key);
  const v = require('./lib/util').decrypt(raw);
  plainCache.set(key, v);
  return v;
}
function save(patch, { clear = [] } = {}) {
  const { setSetting } = require('./settings');
  const { encrypt } = require('./lib/util');
  const next = { ...store() };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!FIELDS[k]) continue;
    const s = String(v ?? '').trim().slice(0, 500);
    if (!s) continue; // blank = keep the saved value (secrets are never sent back to the browser)
    if (k === 'site.app_url' && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(s)) throw Object.assign(new Error('The site URL must start with https:// (or http:// for local testing).'), { status: 400 });
    if (k === 'voosquare.base' && !/^https:\/\/[^\s/]+$/i.test(s.replace(/\/+$/, '')) && !(!require('./config').isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s.replace(/\/+$/, '')))) throw Object.assign(new Error('The VooSquare address must look like https://voosquare.com (no path).'), { status: 400 });
    if (/_url$|\.issuer$/.test(k) && k !== 'site.app_url' && !/^https:\/\//.test(s)) throw Object.assign(new Error(FIELDS[k].label + ' must start with https://'), { status: 400 });
    if ((k === 'brand.support_email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw Object.assign(new Error('Enter a valid support email.'), { status: 400 });
    next[k] = FIELDS[k].secret ? encrypt(k === 'voosquare.base' ? s.replace(/\/+$/, '') : s) : (k === 'voosquare.base' ? s.replace(/\/+$/, '') : s);
  }
  for (const k of clear) if (FIELDS[k]) delete next[k];
  setSetting('integrations', next);
  cache = next; plainCache.clear();
}
const mask = (s) => require('./lib/util').mask(s);

// What the admin sees for each field: where the value comes from and a safe preview.
function fieldsView() {
  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    const saved = value(k), envV = process.env[f.env] || '';
    const v = saved || envV;
    out[k] = { label: f.label, help: f.help || '', secret: !!f.secret, env: f.env, source: saved ? 'admin' : envV ? 'env' : 'none', set: !!v, value: f.secret ? '' : v, hint: f.secret ? mask(v) : '' };
  }
  return out;
}

// ---------- Status of every integration ----------
const last = () => require('./settings').getSetting('integration_tests') || {};
function record(key, result) {
  const { setSetting } = require('./settings');
  const all = { ...last(), [key]: { ok: !!result.ok, note: String(result.note || '').slice(0, 300), at: new Date().toISOString() } };
  setSetting('integration_tests', all);
  return all[key];
}
const state = (configured, t) => (!configured ? 'not_connected' : t && !t.ok ? 'error' : t && t.ok ? 'connected' : 'untested');

function overview() {
  const config = require('./config');
  const { all: q, get } = require('./db');
  const providers = require('./providers');
  const payments = require('./payments');
  const T = last();
  const prov = q('SELECT * FROM providers ORDER BY kind, is_default DESC, priority, id').map((p) => {
    const h = providers.hydrate(p);
    const keyless = (providers.KEYLESS || ['mock', 'library', 'http']).includes(h.adapter);
    const t = T['provider:' + h.id];
    const shared = !h.apiKey && (providers.SHARED_KEY || []).includes(h.adapter) && !!providers.sharedKey?.(h.adapter); // one fal key runs every fal model
    return { id: h.id, name: h.name, kind: h.kind, adapter: h.adapter, enabled: !!h.enabled, is_default: !!h.is_default, key_set: !!h.apiKey, key_shared: shared, key_hint: mask(h.apiKey), status: !h.enabled ? 'off' : state(keyless || !!h.apiKey || shared, t), last_test: t || null };
  });
  const kinds = Object.keys(providers.KINDS || {}).length ? Object.keys(providers.KINDS) : [...new Set(prov.map((p) => p.kind))];
  const methods = q('SELECT * FROM payment_methods ORDER BY sort, id').map((m) => {
    const h = payments.hydrate(m);
    const t = T['method:' + h.id];
    const needsSecret = !['test', 'manual'].includes(h.adapter);
    return { staging_problem: require('./staging').paymentProblem(h), id: h.id, name: h.name, adapter: h.adapter, enabled: !!h.enabled, secret_set: !!h.secret, secret_hint: mask(h.secret), webhook_set: !!h.webhookSecret, webhook_url: h.adapter === 'custom' ? `${config.appUrl}/api/webhooks/custom/${h.id}` : `${config.appUrl}/api/webhooks/${h.adapter}`, status: !h.enabled ? 'off' : state(!needsSecret || !!h.secret, t), last_test: t || null };
  });
  const v = config.voosquare;
  const sup = (() => { try { return require('./support').settings().voosquare; } catch { return {}; } })();
  const vs = {
    login: { status: state(!!(v.base && v.clientId && v.clientSecret), T['voosquare.login']), last_test: T['voosquare.login'] || null, kit: require('./voo').adminInfo() },
    events: { status: state(!!v.webhookSecret, T['voosquare.events']), last_test: T['voosquare.events'] || null, support_enabled: !!sup.enabled, support_mode: sup.mode || 'vooads' },
    inbound: { status: state(!!v.serviceKey, T['voosquare.inbound']), last_test: T['voosquare.inbound'] || null, last_call_at: (require('./settings').getSetting('voosquare_last_inbound') || {}).at || null, endpoints: [`${config.appUrl}/api/voosquare/summary`, `${config.appUrl}/api/voosquare/support/tickets`] },
  };
  const ff = (() => { try { return require('./stitch').available(); } catch { return false; } })();
  let disk = null;
  try { const s = fs.statfsSync(config.dataDir); disk = { free_gb: Math.round((s.bavail * s.bsize) / 1e8) / 10, total_gb: Math.round((s.blocks * s.bsize) / 1e8) / 10 }; } catch {}
  const samples = require('./samples');
  const sampleNames = Object.keys(samples.SAMPLES);
  const storage = {
    status: state(true, T.storage), last_test: T.storage || null, data_dir: config.dataDir, volume: !!process.env.RAILWAY_VOLUME_MOUNT_PATH || !!process.env.DATA_DIR, disk, ffmpeg: ff,
    media_files: get('SELECT COUNT(*) AS c FROM media').c, samples_local: sampleNames.filter((n) => samples.localPath(n)).length, samples_total: sampleNames.length,
  };
  return {
    server: { env: config.appEnv, version: config.version, staging_allowlist: config.isStaging ? config.stagingEmailAllowlist : undefined, app_url: config.appUrl, production: config.isProd, railway: config.onRailway, owner_email_set: !!config.ownerEmail, secret_ok: !config.appSecret.startsWith('dev-secret') },
    fields: fieldsView(),
    email: { status: state(!!config.email.resendKey, T.email), last_test: T.email || null, from: config.brand.fromEmail },
    voosquare: vs,
    providers: prov, provider_kinds: kinds,
    payments: methods,
    storage,
  };
}

// ---------- Tests ----------
const withTimeout = (ms = 10e3) => ({ signal: AbortSignal.timeout(ms) });
async function testEmail(to) {
  const config = require('./config');
  if (!config.email.resendKey) return record('email', { ok: false, note: 'Add a Resend API key first. Until then emails are printed in the server log.' });
  if (!require('./staging').emailAllowed(to)) return record('email', { ok: false, note: 'Staging: ' + to + ' is not staff or on STAGING_EMAIL_ALLOWLIST, so no email was sent.' });
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', ...withTimeout(), headers: { Authorization: 'Bearer ' + config.email.resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.brand.fromEmail, to: [to], subject: 'Vooads test email', text: 'This is a test from Admin → Integrations. Email sending works.', reply_to: config.brand.supportEmail }),
    });
    const body = await r.text();
    return record('email', r.ok ? { ok: true, note: 'Sent a test email to ' + to } : { ok: false, note: 'Resend said ' + r.status + ': ' + body.slice(0, 160) });
  } catch (e) { return record('email', { ok: false, note: e.message }); }
}
// Voo Connect login check: exchange a made-up code. "invalid_grant" means VooSquare accepted our client ID and secret;
// "invalid_client" means they are wrong. Also checks the API key with a read of an unknown Voo ID (404 = key accepted).
async function testVooLogin() {
  const voo = require('./voo');
  const c = voo.cfg();
  const cbUrl = c.redirectUri;
  if (!c.base || !c.clientId || !c.clientSecret) return record('voosquare.login', { ok: false, note: 'Add the VooSquare address, client ID and client secret first.' });
  const k = voo.kit();
  let note = '';
  try { await k.exchangeCode('vooads_connection_check', {}); return record('voosquare.login', { ok: false, note: 'VooSquare accepted a made-up login code. Check the VooSquare address.' }); }
  catch (e) {
    if (e.code === 'invalid_grant') note = 'Login works: VooSquare accepted the client ID and secret.';
    else if (e.code === 'invalid_client') return record('voosquare.login', { ok: false, note: 'VooSquare refused the client ID or secret. Copy them again from VooSquare → Admin → Products → Vooads → Credentials.' });
    else if (/redirect/i.test(String(e.code || '') + e.message)) return record('voosquare.login', { ok: false, note: 'VooSquare does not know the callback ' + cbUrl + '. Add it to the Redirect URIs.' });
    else return record('voosquare.login', { ok: false, note: 'Could not check login: ' + (e.code || '') + ' ' + e.message });
  }
  if (c.apiKey) {
    try { await k.users.get('va_connection_check'); note += ' API key accepted.'; }
    catch (e) { note += e.status === 404 ? ' API key accepted.' : e.status === 401 ? ' VooSquare refused the API key.' : ' API key not checked (' + (e.code || e.message) + ').'; if (e.status === 401) return record('voosquare.login', { ok: false, note }); }
  } else note += ' Add the API key so plan payments reach VooSquare.';
  return record('voosquare.login', { ok: true, note: note + ' Callback: ' + cbUrl });
}
async function testVooEvents() {
  const config = require('./config');
  const v = config.voosquare;
  if (!v.webhookSecret) return record('voosquare.events', { ok: false, note: 'Add the VooSquare signing secret first.' });
  let url = v.supportEventsUrl;
  try { url = require('./support').settings().voosquare.events_url || url; } catch {}
  const body = JSON.stringify({ event_id: 'va_test_' + Date.now(), type: 'ping', tool: 'vooads', occurred_at: new Date().toISOString() });
  try {
    const r = await fetch(url, { method: 'POST', ...withTimeout(), headers: { 'Content-Type': 'application/json', 'X-Voo-Signature': require('./voosquare').sign(body), 'X-Voo-Tool': 'vooads' }, body });
    return record('voosquare.events', r.ok ? { ok: true, note: 'VooSquare accepted a signed test event at ' + url } : { ok: false, note: url + ' returned HTTP ' + r.status });
  } catch (e) { return record('voosquare.events', { ok: false, note: url + ': ' + e.message }); }
}
function testVooInbound() {
  const v = require('./config').voosquare;
  if (!v.serviceKey) return record('voosquare.inbound', { ok: false, note: 'Generate a service key, then paste it into VooSquare.' });
  if (v.serviceKey.length < 24) return record('voosquare.inbound', { ok: false, note: 'The service key is too short. Generate a new one.' });
  const at = (require('./settings').getSetting('voosquare_last_inbound') || {}).at;
  return record('voosquare.inbound', { ok: true, note: at ? 'Key set. Last call from VooSquare: ' + at : 'Key set. No call from VooSquare yet.' });
}
function testStorage() {
  const config = require('./config');
  const dir = path.join(config.dataDir, 'media');
  const f = path.join(dir, '.write-test-' + Date.now());
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, 'ok'); const ok = fs.readFileSync(f, 'utf8') === 'ok'; fs.unlinkSync(f);
    if (!ok) throw new Error('Read-back failed');
    const ff = require('./stitch').available();
    const vol = !!process.env.RAILWAY_VOLUME_MOUNT_PATH || !!process.env.DATA_DIR || !config.onRailway;
    return record('storage', { ok: vol, note: (vol ? 'Files save to ' + config.dataDir : 'Files save to ' + config.dataDir + ' but no Volume is attached: everything is lost on redeploy. Add a Volume at /data.') + (ff ? ' · ffmpeg ready' : ' · ffmpeg missing: long videos play as a playlist') });
  } catch (e) { return record('storage', { ok: false, note: 'Cannot write to ' + dir + ': ' + e.message }); }
}

// Payment method test: an authenticated read-only call per provider. Never creates a charge.
async function testMethod(m) {
  const payments = require('./payments');
  const h = payments.hydrate(m);
  const key = 'method:' + h.id;
  const call = async (url, headers) => { const r = await fetch(url, { headers, ...withTimeout() }); return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 200) }; };
  try {
    if (h.adapter === 'test') return record(key, { ok: true, note: 'Test method (development only). It is switched off in production.' });
    if (h.adapter === 'manual') return record(key, h.config?.account_number || h.config?.instructions ? { ok: true, note: 'Bank details are set. Customers see them at checkout and upload proof for you to approve.' } : { ok: false, note: 'Add the bank name, account name and account number.' });
    if (h.adapter !== 'custom' && !h.secret) return record(key, { ok: false, note: 'Add the secret key first.' });
    let r;
    switch (h.adapter) {
      case 'stripe': r = await call('https://api.stripe.com/v1/balance', { Authorization: 'Bearer ' + h.secret });
        if (r.ok && !h.webhookSecret) return record(key, { ok: false, note: 'Key works. Add the webhook signing secret (whsec_...) so payments are confirmed.' });
        break;
      case 'paystack': r = await call('https://api.paystack.co/balance', { Authorization: 'Bearer ' + h.secret }); break;
      case 'flutterwave': r = await call('https://api.flutterwave.com/v3/balances', { Authorization: 'Bearer ' + h.secret });
        if (r.ok && !h.webhookSecret) return record(key, { ok: false, note: 'Key works. Add the webhook secret hash so payments are confirmed.' });
        break;
      case 'nowpayments': r = await call(require('./payments/nowpayments').API() + '/v1/merchant/coins', { 'x-api-key': h.secret });
        if (r.ok && !h.webhookSecret) return record(key, { ok: false, note: 'Key works. Add the IPN secret so payments are confirmed.' });
        break;
      case 'bachs': return record(key, await require('./payments/bachs').testKey(h));
      case 'gatevoo': return record(key, await require('./payments/gatevoo').testKey(h));
      case 'custom': {
        const c = h.config || {};
        if (!/^https:\/\//.test(c.checkout_url || '')) return record(key, { ok: false, note: 'Set a checkout URL that starts with https://' });
        const sample = { amount_usd: '1.00', amount_local: '1.00', amount_minor: '100', currency: c.currency || 'USD', payment_id: '0', reference: 'va_0', email: 'test@example.com', name: 'Test', success_url: 'https://example.com/ok', cancel_url: 'https://example.com/cancel', webhook_url: 'https://example.com/hook', description: 'Test', secret: 'x' };
        try { if (c.body_template) JSON.parse(String(c.body_template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => sample[k] ?? '')); } catch { return record(key, { ok: false, note: 'The body template is not valid JSON once filled in.' }); }
        try { if (c.headers_json) JSON.parse(String(c.headers_json).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => sample[k] ?? '')); } catch { return record(key, { ok: false, note: 'Headers must be valid JSON.' }); }
        if (!c.response_url_path) return record(key, { ok: false, note: 'Set where the payment link is in the response (for example data.link).' });
        if ((c.signature_algo || 'sha256') !== 'none' && !h.webhookSecret) return record(key, { ok: false, note: 'Add the webhook secret, or set the signature to "none" (not recommended).' });
        try { await fetch(c.checkout_url, { method: 'HEAD', ...withTimeout(8e3) }); } catch (e) { return record(key, { ok: false, note: 'Cannot reach ' + new URL(c.checkout_url).host + ': ' + e.message }); }
        return record(key, { ok: true, note: 'Settings look right and the provider is reachable. Make one small real payment to finish testing.' });
      }
      default: return record(key, { ok: false, note: 'No test for this provider yet.' });
    }
    return record(key, r.ok ? { ok: true, note: 'Key accepted by ' + (payments.ADAPTERS[h.adapter]?.label || h.adapter) + '.' } : { ok: false, note: 'HTTP ' + r.status + (r.status === 401 || r.status === 403 ? ': the key was refused.' : ': ' + r.text) });
  } catch (e) { return record(key, { ok: false, note: e.message }); }
}

function newServiceKey() { return 'vs_' + require('./lib/util').id(32); }
let lastNote = 0;
function noteInbound() { if (Date.now() - lastNote < 60e3) return; lastNote = Date.now(); try { require('./settings').setSetting('voosquare_last_inbound', { at: new Date().toISOString() }); } catch {} }

// First admin without OWNER_EMAIL: a one-time setup link printed in the server log (valid 24 hours, until an owner exists).
function ownerExists() {
  const { all } = require('./db');
  return all("SELECT s.id, r.permissions FROM staff s JOIN roles r ON r.id = s.role_id WHERE s.status = 'active'").some((x) => /"\*"/.test(x.permissions || ''));
}
function setupLink() {
  const config = require('./config');
  if (config.ownerEmail || ownerExists()) return null;
  const { id, sha256 } = require('./lib/util');
  const token = id(24);
  require('./settings').setSetting('owner_setup', { hash: sha256('setup:' + token), expires: Date.now() + 864e5 });
  return `${config.appUrl}/admin#setup=${token}`;
}
function setupValid(token) {
  const { sha256, safeEqual } = require('./lib/util');
  const s = require('./settings').getSetting('owner_setup');
  if (!s || !s.hash || !(s.expires > Date.now()) || ownerExists()) return false;
  return safeEqual(s.hash, sha256('setup:' + String(token || '')));
}
function setupDone() { require('./settings').setSetting('owner_setup', null); }

module.exports = { setupLink, setupValid, setupDone, FIELDS, value, save, fieldsView, overview, record, testEmail, testVooLogin, testVooEvents, testVooInbound, testStorage, testMethod, newServiceKey, noteInbound };
