// Staging safety guards. Staging is a full copy of Vooads (own database, own Volume, own keys) for building and
// testing new features without touching the live site. On staging (config.isStaging):
//  - Emails reach only active staff, OWNER_EMAIL and STAGING_EMAIL_ALLOWLIST. Everything else is printed in the log.
//  - Payments run in test mode only: the fake "Test payment" method is always offered, and a payment method whose
//    keys or address look live is hidden and refused at checkout (Stripe/Paystack need test keys, Flutterwave a
//    _TEST key, NOWPayments uses its sandbox API, Gatevoo and custom APIs need a sandbox/test/staging address).
//  - Studio and admin show a "Staging — test data" banner, and search engines are told not to index it.
//  - An empty staging database gets sample customers, jobs and a ticket so there is something to click.
// On production and development these functions change nothing.
const config = require('./config');

// ---------- Email ----------
function emailAllowed(to) {
  if (!config.isStaging) return true;
  const e = String(to || '').trim().toLowerCase();
  if (!e) return false;
  if (config.ownerEmail && e === config.ownerEmail) return true;
  for (const a of config.stagingEmailAllowlist) {
    if (a.startsWith('@') ? e.endsWith(a) : e === a) return true;
  }
  try { return !!require('./db').get("SELECT 1 AS ok FROM staff WHERE lower(email) = ? AND status = 'active'", e); } catch { return false; }
}

// ---------- Payments ----------
const sandboxHost = (u) => { try { return /(^|[.-])(sandbox|test|testing|staging|stage)([.-]|$)/i.test(new URL(String(u)).hostname); } catch { return false; } };
// Why this method may not take money on staging, or null when it is safe.
function paymentProblem(m) {
  if (!config.isStaging || !m) return null;
  const s = String(m.secret || '');
  const c = m.config || {};
  switch (m.adapter) {
    case 'test': case 'manual': return null; // the fake method, and bank transfers that staff approve by hand
    case 'stripe': return /^(sk|rk)_test_/.test(s) ? null : 'Staging takes Stripe test keys only (sk_test_…).';
    case 'paystack': return /^sk_test_/.test(s) ? null : 'Staging takes Paystack test keys only (sk_test_…).';
    case 'flutterwave': return /_TEST/i.test(s) ? null : 'Staging takes Flutterwave test keys only (FLWSECK_TEST-…).';
    case 'nowpayments': return null; // payments/nowpayments.js talks to api-sandbox.nowpayments.io on staging
    case 'bachs': return /^sk_sandbox_/.test(s) ? null : 'Staging takes Bachs sandbox keys only (sk_sandbox_…).';
    case 'gatevoo': return sandboxHost(c.base_url || 'https://gatevoo.com/api/v1') ? null : 'Staging needs a Gatevoo sandbox API address (Payment methods → API address).';
    case 'custom': return sandboxHost(c.checkout_url) ? null : 'Staging needs a sandbox/test checkout URL for this custom method.';
    default: return 'Unknown payment method: not allowed on staging.';
  }
}

// ---------- Banner + robots ----------
const BANNER = '<div id="va-env-banner" role="status" style="position:sticky;top:0;z-index:2147483000;background:#f5b400;color:#111;font:600 13px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:7px 12px;letter-spacing:.01em">Staging — test data. Emails go to staff only and payments are in test mode.</div>';
function injectBanner(html) {
  if (!config.isStaging) return html;
  return /<body[^>]*>/i.test(html) ? html.replace(/<body([^>]*)>/i, (m) => m + BANNER) : BANNER + html;
}

// ---------- Sample data ----------
function seedSample() {
  if (!config.isStaging) return false;
  const { get, run, tx } = require('./db');
  if (get('SELECT COUNT(*) AS c FROM users').c > 0) return false;
  if (get("SELECT 1 AS ok FROM settings WHERE key = 'staging_seeded'")) return false;
  const { now, addDays } = require('./lib/util');
  const auth = require('./auth');
  const users = [
    { email: 'pro.buyer@staging.test', name: 'Ada (sample)', country: 'NG', plan: 'pro', plan_credits: 3500, topup: 1000 },
    { email: 'trial.user@staging.test', name: 'Kofi (sample)', country: 'GH', plan: null, plan_credits: 0, topup: 0 },
    { email: 'scale.agency@staging.test', name: 'Wanjiru (sample)', country: 'KE', plan: 'scale', plan_credits: 8500, topup: 0 },
  ];
  tx(() => {
    for (const u of users) {
      const info = run('INSERT INTO users(email, name, country, ref_code, plan_id, plan_period, plan_expires_at, plan_credits, plan_credits_reset_at, topup_credits, trial_credits, last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        u.email, u.name, u.country, auth.uniqueRefCode(), u.plan, u.plan ? 'month' : null, u.plan ? addDays(now(), 30) : null, u.plan_credits, u.plan ? addDays(now(), 30) : null, u.topup, u.plan ? 0 : 60, now());
      const uid = Number(info.lastInsertRowid);
      run('INSERT INTO credit_ledger(user_id, delta, bucket, reason) VALUES(?,?,?,?)', uid, u.plan ? u.plan_credits : 60, u.plan ? 'plan' : 'trial', 'Staging sample credits');
      if (u.topup) run('INSERT INTO credit_ledger(user_id, delta, bucket, reason) VALUES(?,?,?,?)', uid, u.topup, 'topup', 'Staging sample top-up');
      if (u.plan) run("INSERT INTO payments(user_id, method_id, adapter, kind, plan_id, period, credits, amount_usd, provider_ref, status, paid_at) VALUES(?,NULL,'test','plan',?,'month',?,?,?,'paid',?)",
        uid, u.plan, u.plan_credits, u.plan === 'pro' ? 149 : 349, 'staging_sample_' + uid, now());
      const hooks = ['Stop scrolling if your skin looks tired', 'I tried this for 7 days', 'Nobody tells you this about serums'];
      run("INSERT INTO jobs(user_id, type, status, step, input, output, credits, demo) VALUES(?, 'hooks', 'done', 'Done', ?, ?, 6, 1)",
        uid, JSON.stringify({ product: 'Vitamin C serum (sample)', language: 'en' }), JSON.stringify({ hooks: Array.from({ length: 20 }, (_, i) => hooks[i % 3] + ' #' + (i + 1)) }));
    }
  });
  try {
    const support = require('./support');
    const u = get('SELECT * FROM users WHERE email = ?', users[0].email);
    support.createTicket(u, { subject: 'Sample ticket: how do I change the voice?', body: 'This is sample staging data. Reply to it to test the support inbox.', category: 'other' });
  } catch (e) { console.error('[staging] sample ticket skipped:', e.message); }
  run("INSERT INTO settings(key, value) VALUES('staging_seeded', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ at: now() }));
  console.log('[staging] empty database: added 3 sample customers, jobs and a support ticket (test data).');
  return true;
}

module.exports = { emailAllowed, paymentProblem, injectBanner, seedSample, sandboxHost, BANNER };
