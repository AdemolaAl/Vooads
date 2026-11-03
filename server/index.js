// Vooads server. Start with: npm start
const http = require('node:http');
const path = require('node:path');
const config = require('./config');
const { createRouter, decorate, serveStatic, HttpError } = require('./lib/http');
const { seed } = require('./seed');
const jobs = require('./jobs');
const email = require('./email');
const billing = require('./billing');
const auth = require('./auth');
const samples = require('./samples');

seed();
require('./voomoney'); // payments.event_key etc. before any payment is touched (old paid rows keep their row-id keys)
require('./staging').seedSample(); // staging only: sample data on an empty database

const router = createRouter();
require('./routes/api')(router);
require('./routes/studio')(router);
require('./routes/support')(router);
require('./routes/admin')(router);
require('./routes/business')(router);
require('./routes/mail')(router); // Mail: campaigns, templates, tracking (server/mail/)
require('./routes/videotools')(router); // Uploads (signed /u/ links) and brand tracks (server/videotools.js)
require('./routes/phase2')(router); // Chat editing, actors, hook export, Profit view (server/chatedit.js, actors.js, profit.js)
require('./routes/pages')(router);

const PUB = path.join(__dirname, '..', 'public');
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // No inline scripts anywhere (they live in /assets/js), so script-src is 'self' only. Styles keep inline (style attributes).
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https:; object-src 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  ...(config.isProd ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  // Staging and PR previews must never show up in search results next to the live site.
  ...(config.isStaging ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  decorate(req, res);
  try {
    // Basic CSRF protection: API writes must come from our own site (or be webhooks / server-to-server).
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.path.startsWith('/api/') && !req.path.startsWith('/api/webhooks/')) {
      const origin = req.headers.origin;
      let host = null;
      try { host = origin ? new URL(origin).host : null; } catch {}
      if (origin && host !== req.headers.host && origin !== config.appUrl) throw new HttpError(403, 'Blocked request from another site.');
      // No Origin header (older browsers): fall back to the browser's own cross-site marker, then the Referer.
      if (!origin && req.headers['sec-fetch-site'] === 'cross-site' && !req.path.startsWith('/api/voosquare/')) throw new HttpError(403, 'Blocked request from another site.');
      if (!origin && req.headers.referer && req.headers.cookie) {
        let rh = null; try { rh = new URL(req.headers.referer).host; } catch {}
        if (rh && rh !== req.headers.host && !config.appUrl.endsWith('//' + rh)) throw new HttpError(403, 'Blocked request from another site.');
      }
    }
    const m = router.match(req.method, req.path);
    if (m) {
      req.params = m.params;
      for (const h of m.handlers) await h(req, res);
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(PUB, req, res, { maxAge: req.path.startsWith('/assets/') ? 86400 : 300 })) return;
    if (req.path.startsWith('/api/')) throw new HttpError(404, 'Not found');
    res.html('<!doctype html><meta name="viewport" content="width=device-width"><title>Page not found · Vooads</title><div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:120px auto;text-align:center"><h1>Page not found</h1><p><a href="/">Go to Vooads</a></p></div>', 404);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[error]', req.method, req.path, e instanceof HttpError ? e.message : e); // our own 5xx (e.g. 502 provider down): no stack
    // Too big: answer, then close the connection instead of reading (and throwing away) the rest of the upload.
    if (status === 413 && !res.headersSent) { res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy()); }
    if (!res.headersSent) res.json({ error: status >= 500 && config.isProd ? 'Something went wrong on our side. Try again in a moment.' : e.message, ...(e.extra || {}) }, status);
  }
});

server.listen(config.port, () => {
  console.log(`\nVooads is running on ${config.appUrl} (port ${config.port})`);
  console.log(`Data folder: ${config.dataDir}`);
  console.log(`Environment: ${config.appEnv} · version ${config.version}${config.isStaging ? ' · STAGING: emails to staff/allowlist only, payments in test mode' : ''}`);
  const setup = require('./integrations').setupLink();
  if (setup) console.log(`\n[vooads] No admin account yet. Open this link within 24 hours to create the owner account:\n  ${setup}\n(Or set OWNER_EMAIL and redeploy.)\n`);
  if (!config.email.resendKey) console.log('Emails are printed here until RESEND_API_KEY is set.');
});

jobs.start();
setInterval(() => email.processQueue().catch((e) => console.error('[email queue]', e.message)), 20e3).unref();
require('./mail/sender').start(); // Mail campaign worker (throttled queue, survives restarts)
const daily = () => { try { billing.daily(); auth.cleanupSessions(); require('./uploads').cleanup(); } catch (e) { console.error('[daily]', e.message); } };
setTimeout(daily, 10e3).unref();
setInterval(daily, 60 * 60e3).unref();
// Naira rate feed (server/fx.js): every hour, only when a source is set on the Bachs method or in FX_RATE_URL.
setInterval(() => require('./fx').check().catch((e) => console.error('[fx]', e.message)), 60 * 60e3).unref();
samples.mirror().catch(() => {});
require('./voo').start(); // VooSquare event outbox (Voo Connect), only when the API key is set

process.on('SIGTERM', () => server.close(() => process.exit(0)));
module.exports = server;
