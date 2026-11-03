// Server settings. Only APP_SECRET is required in production (plus OWNER_EMAIL, or the one-time setup link printed
// in the logs, for the first admin login). Everything else (email, VooSquare, site URL, company details) can be set in
// Admin → Integrations; environment variables still work and are used when the admin has not set a value.
const path = require('node:path');

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
// Railway sets these automatically: the public domain and the mount path of an attached Volume.
const onRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID);

// Which copy of the site this is: production (the live site), staging (the safe test copy) or development (a laptop).
// APP_ENV wins. On Railway it follows the environment name: "production" is production, any other Railway
// environment (staging, PR previews "vooads-pr-12", …) is staging, so an unknown environment can never send real
// emails or take real money. Off Railway: NODE_ENV=production → production, otherwise development.
function detectAppEnv() {
  const v = env('APP_ENV').toLowerCase();
  if (['production', 'staging', 'development'].includes(v)) return v;
  const r = String(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || '').trim().toLowerCase();
  if (r) return r === 'production' ? 'production' : 'staging';
  return env('NODE_ENV') === 'production' ? 'production' : 'development';
}
const appEnv = detectAppEnv();

// Values saved in Admin → Integrations win over the environment. Loaded lazily (the database needs this file first).
function admin(key) {
  try { return require('./integrations').value(key) || ''; } catch { return ''; }
}

const config = {
  port: Number(env('PORT', 3000)),
  get appUrl() {
    const v = admin('site.app_url') || env('APP_URL') || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : `http://localhost:${env('PORT', 3000)}`);
    return v.replace(/\/$/, '');
  },
  isProd: env('NODE_ENV', onRailway ? 'production' : 'development') === 'production',
  onRailway,
  appEnv,
  isStaging: appEnv === 'staging',
  // The fake "Test payment" method: on in development and staging, never on the live site.
  testPayments: appEnv === 'staging' || (appEnv === 'development' && env('NODE_ENV', onRailway ? 'production' : 'development') !== 'production'),
  // Code version shown by /healthz (Railway sets RAILWAY_GIT_COMMIT_SHA on every GitHub deploy).
  version: String(process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || process.env.SOURCE_COMMIT || 'dev').slice(0, 40),
  // Staging only: who may receive real emails besides active staff (comma list of emails or @domains).
  stagingEmailAllowlist: env('STAGING_EMAIL_ALLOWLIST').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean),
  // Long random string. Encrypts API keys stored in the database and signs tokens. Never change it after launch.
  appSecret: env('APP_SECRET', 'dev-secret-change-me-dev-secret-change-me'),
  dataDir: path.resolve(env('DATA_DIR', env('RAILWAY_VOLUME_MOUNT_PATH', path.join(__dirname, '..', 'data')))),
  ownerEmail: env('OWNER_EMAIL', env('ADMIN_EMAIL', '')).toLowerCase(),
  brand: {
    name: 'Vooads',
    get company() { return admin('brand.company') || env('COMPANY_NAME', 'Zedapex'); },
    // The one legal line (Terms, Privacy, Refunds, the site footer, receipts). Marketing and product copy say "Vooads".
    get legalLine() { return admin('brand.legal_line') || env('LEGAL_LINE', 'Zedapex Limited, Lagos'); },
    get supportEmail() { return admin('brand.support_email') || env('SUPPORT_EMAIL', 'support@vooads.com'); },
    get fromEmail() { return admin('email.from') || env('FROM_EMAIL', 'Vooads <hello@vooads.com>'); },
  },
  email: {
    get resendKey() { return admin('email.resend_key') || env('RESEND_API_KEY'); },
  },
  voosquare: {
    // Optional: Voo ID login and payment events through the Voo Connect kit (server/voo.js), plus the support inbox.
    // Login needs base + client ID + client secret; events and the summary card need the API key.
    get base() { return admin('voosquare.base') || env('VOO_BASE'); },
    get apiKey() { return admin('voosquare.api_key') || env('VOO_API_KEY'); },
    get signalSecret() { return admin('voosquare.signal_secret') || env('VOO_SIGNAL_SECRET'); },
    // Older OpenID setting kept so saved values still show in the admin; login now uses base (Voo Connect).
    get issuer() { return admin('voosquare.issuer') || env('VOO_ISSUER'); },
    get clientId() { return admin('voosquare.client_id') || env('VOO_CLIENT_ID'); },
    get clientSecret() { return admin('voosquare.client_secret') || env('VOO_CLIENT_SECRET'); },
    get serviceKey() { return admin('voosquare.service_key') || env('VOO_SERVICE_KEY'); },
    get webhookSecret() { return admin('voosquare.webhook_secret') || env('VOO_WEBHOOK_SECRET'); },
    get eventsUrl() { return admin('voosquare.events_url') || env('VOO_EVENTS_URL', 'https://api.voosquare.com/v1/events'); },
    // Support inbox events (tickets). Admin → Support settings can also override it.
    get supportEventsUrl() { return admin('voosquare.support_events_url') || env('VOO_SUPPORT_EVENTS_URL', 'https://api.voosquare.com/v1/support/events'); },
  },
};

if (config.isProd && config.appSecret.startsWith('dev-secret')) {
  console.error('\n[vooads] APP_SECRET is not set. Add a long random APP_SECRET in Railway → Variables, then redeploy.\n');
  process.exit(1);
}
if (config.isProd && config.appSecret.length < 32) console.warn('\n[vooads] APP_SECRET is short. Use 64+ random characters for a new install (never change it on a live one).\n');

module.exports = config;
