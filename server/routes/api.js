// Customer-facing API: public config, login, studio jobs, billing, support, referrals, webhooks.
const config = require('../config');
const { get, all, run, J } = require('../db');
const { parseJson, fail, rateLimit, readBody } = require('../lib/http');
const { now, isEmail, clampInt, hmac, safeEqual } = require('../lib/util');
const auth = require('../auth');
const credits = require('../credits');
const jobs = require('../jobs');
const shield = require('../shield');
const billing = require('../billing');
const payments = require('../payments');
const email = require('../email');
const media = require('../media');
const voo = require('../voo');
const voosquare = require('../voosquare');
const providers = require('../providers');
const guard = require('../guard');
const { getSetting, pricing, planById } = require('../settings');

function publicUser(u) {
  const b = credits.balance(u);
  const plan = credits.activePlan(u);
  return {
    id: u.id, email: u.email, name: u.name, country: u.country, ref_code: u.ref_code, brand: J(u.brand, null),
    onboarding: J(u.onboarding, {}), marketing_opt_in: !!u.marketing_opt_in, voo_id: u.voo_id,
    plan: plan ? { id: plan.id, name: plan.name, period: u.plan_period, expires_at: u.plan_expires_at, auto_renew: !!u.auto_renew, scripts: plan.scripts, max_ugc_seconds: plan.max_ugc_seconds, max_video_seconds: plan.max_video_seconds, credits_month: plan.credits_month } : null,
    balance: b, created_at: u.created_at,
  };
}

// The customer's country at sign-up: the hosting edge's country header when there is one (Cloudflare, Vercel,
// CloudFront, Fastly), else the browser's guess from its time zone (sent by the sign-up form), else unknown.
// Customers can change it in Settings → Country. It decides which payment methods they see (Bachs, Paystack…).
const COUNTRY_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'cloudfront-viewer-country', 'fastly-geo-country', 'x-country-code', 'x-appengine-country'];
function detectCountry(req, fallback) {
  for (const h of COUNTRY_HEADERS) {
    const v = String(req.headers[h] || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1') return v;
  }
  const f = String(fallback || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(f) ? f : '';
}

function createUser({ email: mail, name, country, ref, vooId, marketing, emailVerified = true, ip = '' }) {
  // One free trial per person (guard.trialAllowed): no second trial for the same inbox, a throwaway inbox or a busy network.
  const trialOk = guard.trialAllowed(mail, ip);
  const trial = trialOk.ok ? pricing().free_trial?.credits || 0 : 0;
  const refBy = ref && get('SELECT ref_code FROM users WHERE ref_code = ?', String(ref).toLowerCase()) ? String(ref).toLowerCase() : null;
  const info = run('INSERT INTO users(email, name, country, voo_id, ref_code, referred_by, trial_credits, marketing_opt_in, last_seen_at, email_verified, email_canon) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    mail, (name || '').slice(0, 60) || null, (country || '').slice(0, 2).toUpperCase() || null, vooId || null, auth.uniqueRefCode(), refBy, trial, marketing === false ? 0 : 1, now(), emailVerified ? 1 : 0, guard.canonicalEmail(mail));
  if (!trialOk.ok) console.log('[signup] no free trial for new user (' + trialOk.reason + ')');
  const user = get('SELECT * FROM users WHERE id = ?', Number(info.lastInsertRowid));
  if (trial) run('INSERT INTO credit_ledger(user_id, delta, bucket, reason) VALUES(?,?,?,?)', user.id, trial, 'trial', 'Free trial credits');
  email.hooks.signup(user, trial);
  return user;
}

module.exports = function mount(r) {
  // ---------- Public ----------
  r.get('/api/public/config', (req, res) => {
    const p = pricing();
    res.json({
      brand: { name: 'Vooads', company: config.brand.company, support: config.brand.supportEmail },
      site: getSetting('site'),
      plans: p.plans, topups: p.topups, costs: p.costs, free_trial: p.free_trial,
      presenters: require('../houseactors').ready().map((a) => ({ ...require('../houseactors').card(a), id: a.id, name: a.name, img: a.img })), // id = the presenter id ("p1"); card id "h:p1" is the actor id
      actor_filters: { markets: require('../houseactors').MARKETS, styles: require('../houseactors').STYLES, ages: require('../houseactors').AGES },
      languages: jobs.LANGS, video_styles: Object.keys(jobs.VIDEO_STYLES), referral: getSetting('referral'),
      voosquare_login: voo.loginOn(),
      voosquare: voo.publicInfo(),
      pronunciations: require('../pronounce').list(),
    });
  });
  // Website showcase: videos the owner picked from the "Made with Vooads" pack (server/showcase.js). Empty = examples.
  r.get('/api/public/showcase', (req, res) => { res.json({ items: require('../showcase').publicList() }); });
  r.get('/api/public/posts', (req, res) => {
    res.json(all("SELECT slug, title, excerpt, cover_url, tags, read_minutes, published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT ?", clampInt(req.query.limit, 1, 50, 6)).map((p) => ({ ...p, tags: J(p.tags, []) })));
  });
  r.post('/api/public/shield', async (req, res) => {
    rateLimit('shield:' + req.ip, 30, 6e4);
    const b = await parseJson(req);
    const text = String(b.text || '').slice(0, 3000);
    res.json({ ...shield.scan(text, b.niche), rewrite: shield.rewrite(text, b.niche) });
  });

  // ---------- Login ----------
  r.post('/api/auth/code', async (req, res) => {
    const b = await parseJson(req);
    if (/\.invalid$/i.test(String(b.email || '').trim())) fail(400, 'Enter a valid email address.'); // e.g. the showcase house account
    if (!getSetting('site').signups_open && !get('SELECT 1 FROM users WHERE email = ?', String(b.email || '').toLowerCase())) fail(403, 'New sign-ups are paused for a moment. Try again soon.');
    const { email: mail, code } = auth.issueCode(b.email, 'user', req.ip);
    // A first code for an address with no account confirms the email for sign-up; later ones are sign-in codes.
    const known = get('SELECT name FROM users WHERE email = ?', mail);
    await email.sendNow(known ? 'login_code' : 'verify_email', mail, { code, ...(known && known.name ? { name: known.name } : {}) }).catch((e) => { console.error('[email]', e.message); fail(502, 'We could not send the email. Try again in a minute.'); });
    res.json({ ok: true, ...(!config.isProd && !config.email.resendKey ? { dev_code: code } : {}) });
  });
  r.post('/api/auth/verify', async (req, res) => {
    const b = await parseJson(req);
    const mail = auth.checkCode(b.email, 'user', b.code, req.ip);
    let user = get('SELECT * FROM users WHERE email = ?', mail);
    let isNew = false;
    if (!user) {
      // The person just proved this inbox with a code, so asking VooSquare is safe. A new email that already has a
      // Voo ID logs in with VooSquare instead of making a second, separate account.
      if (await voo.vooIdExists(mail)) return res.json({ voo_account: true, error: 'You already have a Voo account. Log in with VooSquare.', login_url: '/auth/voosquare?return_to=%2Fapp' }, 409);
      guard.checkSignup(req.ip);
      user = createUser({ email: mail, name: b.name, country: detectCountry(req, b.country), ref: b.ref, marketing: b.marketing, ip: req.ip });
      guard.logSignup(req.ip, user.id); isNew = true;
    } else if (!user.email_verified) run('UPDATE users SET email_verified = 1 WHERE id = ?', user.id); // the code proved it
    if (user.status === 'banned') fail(403, 'This account is banned for breaking the Terms.');
    auth.newSession(res, { userId: user.id, remember: b.remember !== false, req });
    res.json({ user: publicUser(user), new: isNew });
  });
  r.post('/api/auth/logout', (req, res) => { auth.endSession(req, res); res.json({ ok: true }); });
  // Settings → "Sign out of all devices".
  r.post('/api/auth/logout-all', (req, res) => {
    const u = auth.currentUser(req);
    if (!u) fail(401, 'Please log in.');
    res.json({ ok: true, ended: auth.endAllSessions(req, res, { userId: u.id }) });
  });
  r.get('/api/auth/sessions', (req, res) => {
    const u = auth.requireUser(req);
    res.json({ count: auth.countSessions({ userId: u.id }) });
  });

  // ---------- VooSquare login (Voo Connect kit, server/voo.js) ----------
  //   GET  /auth/voosquare?return_to=/app&signup=1  start (VooSquare's launcher opens this with its Launch path)
  //   POST /api/auth/voosquare/link                 "Connect VooSquare" in Settings for the account logged in now
  //   GET  /auth/voosquare/callback                 VooSquare comes back here (register this exact address)
  //   GET  /auth/voosquare/logout                   end our session, then VooSquare's, then back to our home page
  const LINK_COOKIE = 'va_voolink';
  const linkTag = (req) => hmac('sha256', config.appSecret, 'voolink:' + (req.cookies[auth.USER_COOKIE] || ''));
  function loginErrorPage(res, e) {
    const msg = e && e.status && e.status < 500 ? e.message : e && e.status ? e.message : 'Something went wrong while logging you in.';
    if (!(e && e.status)) console.error('[voosquare] login', e && e.message);
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    res.writeHead(e && e.status ? e.status : 502, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login did not finish · Vooads</title><body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fff;color:#0A1020;display:grid;place-items:center;min-height:100vh;padding:24px"><main style="max-width:440px;text-align:center"><h1 style="font-size:26px;letter-spacing:-.02em">Login did not finish</h1><p style="color:#4A5468;line-height:1.55">${esc(msg)}</p><p style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px"><a href="/auth/voosquare" style="background:#1F4BFF;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Try again</a><a href="/app" style="border:1px solid #DCE2EE;color:#0A1020;padding:12px 20px;border-radius:12px;text-decoration:none;font-weight:600">Log in with email</a></p></main>`);
  }
  r.get('/auth/voosquare', (req, res) => {
    if (!voo.loginOn()) return res.redirect('/app');
    rateLimit('voo-login:' + req.ip, 60, 900e3);
    // A Vooads invite (?invite=) survives the trip to VooSquare in its own cookie; VooSquare's own ref is never read as ours.
    if (/^[a-z0-9]{4,16}$/i.test(String(req.query.invite || ''))) res.cookie('va_invite', String(req.query.invite).toLowerCase(), { maxAge: 3600, secure: config.isProd });
    try { voo.startLogin(req, res, { returnTo: req.query.return_to, signup: req.query.signup === '1' || req.query.prompt === 'signup' }); }
    catch (e) { loginErrorPage(res, e); }
  });
  // Older link kept working.
  r.get('/api/auth/voosquare/start', (req, res) => res.redirect('/auth/voosquare' + (req.query.return_to ? '?return_to=' + encodeURIComponent(String(req.query.return_to)) : '')));
  r.post('/api/auth/voosquare/link', (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('voo-link:' + u.id, 20, 600e3);
    if (!voo.loginOn()) fail(403, 'VooSquare login is switched off.');
    if (u.voo_id) fail(409, 'Your account is already connected to VooSquare.');
    res.cookie(LINK_COOKIE, linkTag(req), { maxAge: 600, secure: config.isProd });
    res.json({ url: '/auth/voosquare?return_to=' + encodeURIComponent('/app#settings') });
  });
  r.get('/auth/voosquare/callback', async (req, res) => {
    if (!voo.loginOn()) return res.redirect('/app');
    try {
      rateLimit('voo-login:' + req.ip, 60, 900e3);
      const { vu, returnTo } = await voo.finishLogin(req, res);
      const current = auth.currentUser(req);
      const wantLink = !!(current && req.cookies[LINK_COOKIE] && safeEqual(req.cookies[LINK_COOKIE], linkTag(req)));
      if (req.cookies[LINK_COOKIE]) res.cookie(LINK_COOKIE, '', { maxAge: 0 });
      const { user, isNew, linked } = voo.linkOrCreate(vu, wantLink ? current : null, (f) => createUser({ email: f.email, name: f.name, country: f.country || detectCountry(req, ''), ref: req.cookies.va_invite || f.ref, vooId: f.vooId, emailVerified: f.emailVerified, ip: req.ip }));
      if (req.cookies.va_invite) res.cookie('va_invite', '', { maxAge: 0 });
      if (user.status === 'banned') fail(403, 'This account is banned for breaking the Terms.');
      if (!wantLink) {
        if (current) auth.endSession(req, res); // a different account was logged in on this browser
        auth.newSession(res, { userId: user.id, req });
      }
      if (isNew) guard.logSignup(req.ip, user.id);
      const [pathPart, hash] = returnTo.split('#');
      res.redirect(isNew ? '/app?welcome=1' : linked ? pathPart + (pathPart.includes('?') ? '&' : '?') + 'voo=linked' + (hash ? '#' + hash : '') : returnTo);
    } catch (e) { loginErrorPage(res, e); }
  });
  const vooLogout = (req, res) => {
    const was = auth.currentUser(req);
    auth.endSession(req, res);
    res.writeHead(302, { Location: voo.loginOn() && was && was.voo_id ? voo.logoutUrl() : '/', 'Cache-Control': 'no-store' });
    res.end();
  };
  r.get('/auth/voosquare/logout', (req, res) => {
    // Another website must not log people out with a hidden link: a cross-site GET only shows a button.
    const site = String(req.headers['sec-fetch-site'] || '');
    if (site && site !== 'same-origin' && site !== 'none') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Log out · Vooads</title><body style="font-family:system-ui,sans-serif;padding:48px;text-align:center"><h2>Log out of Vooads?</h2><form method="post" action="/auth/voosquare/logout"><button style="font:inherit;padding:12px 22px;border-radius:12px;border:0;background:#1F4BFF;color:#fff">Log out</button></form>');
    }
    return vooLogout(req, res);
  });
  r.post('/auth/voosquare/logout', vooLogout);
  // VooSquare's launcher may open /dashboard; the studio is /app.
  r.get('/dashboard', (req, res) => res.redirect('/app'));
  // Landing pages keep the affiliate click (ref / vclick / coupon) for VooSquare. Off: an empty script.
  r.get('/voo-connect-browser.js', (req, res) => {
    const body = voo.loginOn() || voo.eventsOn() ? require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'voo-connect', 'voo-connect-browser.js')) : Buffer.from('/* Voo Connect is off */');
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(body);
  });

  // ---------- Account ----------
  r.get('/api/me', (req, res) => {
    const u = auth.currentUser(req);
    res.json({ user: u && u.status === 'active' ? publicUser(u) : null, banned: u && u.status !== 'active' ? u.status : null });
  });
  r.put('/api/me', async (req, res) => {
    const u = auth.requireUser(req);
    const b = await parseJson(req);
    const f = {};
    if (b.name !== undefined) f.name = String(b.name).slice(0, 60);
    if (b.country !== undefined) { const cc = String(b.country || '').trim().toUpperCase(); if (cc && !/^[A-Z]{2}$/.test(cc)) fail(400, 'Pick your country from the list.'); f.country = cc || null; }
    if (b.brand !== undefined) f.brand = JSON.stringify({ name: String(b.brand?.name || '').slice(0, 40), color: String(b.brand?.color || '').slice(0, 9), niche: String(b.brand?.niche || '').slice(0, 40), ...(/^\/media\/[\w.-]+$/.test(String(b.brand?.logo_url || '')) ? { logo_url: String(b.brand.logo_url) } : {}), ai_label_auto: !!b.brand?.ai_label_auto, cta: String(b.brand?.cta || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 30) });
    if (b.onboarding && typeof b.onboarding === 'object' && !Array.isArray(b.onboarding)) {
      // Small flags only (guide steps, hidden guide). Anything else is dropped.
      const ob = { ...J(u.onboarding, {}) };
      for (const [k, v] of Object.entries(b.onboarding).slice(0, 20)) if (/^[a-z_]{1,30}$/.test(k) && ['boolean', 'number'].includes(typeof v)) ob[k] = v;
      f.onboarding = JSON.stringify(ob);
    }
    if (b.marketing_opt_in !== undefined) f.marketing_opt_in = b.marketing_opt_in ? 1 : 0;
    const keys = Object.keys(f);
    if (keys.length) run(`UPDATE users SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, ...keys.map((k) => f[k]), u.id);
    res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) });
  });

  // ---------- Studio ----------
  r.post('/api/quote', async (req, res) => {
    const u = auth.requireUser(req);
    const b = await parseJson(req);
    const input = b.input && typeof b.input === 'object' ? b.input : {};
    // Quality level (SPEC §13): a level above the customer's plan is refused here too, with the plan to upgrade to.
    if (b.type === 'video_type' && input.level !== undefined) {
      const vt = require('../videotypes').byId(String(input.video_type || ''));
      if (vt) jobs.checkLevel(vt, input.level, credits.activePlan(u));
    }
    res.json({ ...credits.quoteFull(b.type, input, u), balance: credits.balance(u) });
  });
  r.post('/api/jobs', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('job:' + u.id, 30, 6e4);
    if (getSetting('site').maintenance) fail(503, 'Vooads is down for a short update. Try again in a few minutes.');
    const b = await parseJson(req);
    if (!['ugc', 'video', 'image', 'hooks', 'script', 'angles', 'video_type', 'actor'].includes(b.type)) fail(400, 'Pick what you want to make.');
    const input = {};
    for (const k of ['product', 'audience', 'angle', 'language', 'niche', 'duration', 'aspect', 'style', 'presenter', 'presenter_desc', 'script', 'write_script', 'details', 'prompt', 'count', 'image_url', 'direction', 'geo', 'video_type', 'video_url', 'source_language', 'voice', 'slides', 'template', 'captions', 'hooks', 'lines', 'voice_tier', 'brand_color', 'logo_url', 'cta', 'level',
      // Change background / Auto-edit / Brand music (server/videotools.js validates every one of these).
      'upload_id', 'bg_kind', 'bg_color', 'bg_image_url', 'bg_prompt', 'bg_query', 'caption_style', 'remove_silences', 'hook_first', 'end_card', 'vocals', 'lyrics', 'genre', 'tempo', 'mood', 'track_name', 'brand_name',
      // Phase 2: actors, street interview, mad edit.
      'actor_id', 'description', 'question', 'guest_desc', 'city', 'ai_label', 'source', 'videos', 'hits', 'bpm', 'auto_edit', 'brand_finish']) {
      if (b[k] !== undefined) input[k] = typeof b[k] === 'string' ? b[k].slice(0, k === 'script' ? 4000 : 800) : Array.isArray(b[k]) ? b[k].slice(0, 10).map((x) => String(x ?? '').slice(0, 200)) : b[k];
    }
    if (input.video_url && !/^(\/media\/|https?:\/\/)/.test(input.video_url)) delete input.video_url;
    if (input.image_url && !/^(\/media\/|https?:\/\/)/.test(input.image_url)) delete input.image_url;
    if (input.image_url && input.image_url.startsWith('/media/')) input.image_url = config.appUrl + input.image_url;
    if (input.logo_url && !/^(\/media\/|https?:\/\/)/.test(input.logo_url)) delete input.logo_url;
    if (input.bg_image_url && !/^(\/media\/|https?:\/\/)/.test(input.bg_image_url)) delete input.bg_image_url;
    if (input.bg_image_url && input.bg_image_url.startsWith('/media/')) input.bg_image_url = config.appUrl + input.bg_image_url;
    if (b.music && typeof b.music === 'object') input.music = { enabled: b.music.enabled !== false, mood: String(b.music.mood || '').slice(0, 20), source: ['library', 'brand'].includes(b.music.source) ? b.music.source : 'ai', ...(b.music.source === 'brand' ? { track_id: Number(b.music.track_id) || 0 } : {}) };
    else if (b.music === true) input.music = { enabled: true };
    const job = jobs.create(u, b.type, input);
    voosquare.event(u, 'ads_generated', `${b.type} started`);
    res.json({ job, balance: credits.balance(get('SELECT * FROM users WHERE id = ?', u.id)) });
  });
  r.get('/api/jobs', (req, res) => {
    const u = auth.requireUser(req);
    const type = req.query.type;
    const rows = type
      ? all('SELECT * FROM jobs WHERE user_id = ? AND type = ? ORDER BY id DESC LIMIT ?', u.id, type, clampInt(req.query.limit, 1, 200, 60))
      : all('SELECT * FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?', u.id, clampInt(req.query.limit, 1, 200, 60));
    res.json({ jobs: rows.map(jobs.view), balance: credits.balance(u) });
  });
  r.get('/api/jobs/:id', (req, res) => {
    const u = auth.requireUser(req);
    const j = get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', Number(req.params.id), u.id);
    if (!j) fail(404, 'Not found');
    res.json({ job: jobs.view(j) });
  });
  r.post('/api/shield', async (req, res) => {
    auth.requireUser(req);
    const b = await parseJson(req);
    const text = String(b.text || '').slice(0, 5000);
    res.json({ ...shield.scan(text, b.niche), rewrite: shield.rewrite(text, b.niche) });
  });
  r.post('/api/upload', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('up:' + u.id, 20, 6e4);
    const type = String(req.headers['content-type'] || '').split(';')[0];
    if (!/^image\/(png|jpeg|webp)$/.test(type)) fail(400, 'Upload a PNG, JPG or WebP photo.');
    const buf = await readBody(req, 8e6);
    if (!require('../lib/util').isImage(buf, type)) fail(400, 'That file is not a real PNG, JPG or WebP image.');
    const m = media.save(buf, type, u.id);
    res.json({ url: m.path });
  });

  // ---------- Billing ----------
  r.get('/api/billing', (req, res) => {
    const u = auth.requireUser(req);
    const p = pricing();
    res.json({
      methods: (() => { const list = payments.forCountry(u.country), sc = require('../surcharge'); return list.map((m) => ({ price_factor: sc.factor(m), save_pct: sc.savePct(m, list), m })); })().map(({ price_factor, save_pct, m }) => ({ id: m.id, name: m.name, adapter: m.adapter, price_factor, save_pct, recurring: !!payments.ADAPTERS[m.adapter]?.recurring, card_auto_renew: !!(payments.ADAPTERS[m.adapter]?.subscriptions && require('../payments/bachs-subs').enabled(m)), logo_url: m.config?.logo_url || null, manual: m.adapter === 'manual',
        // Bachs: what this customer pays in (NGN for Nigeria at the admin's rate, else USD), shown before checkout.
        ...(m.adapter === 'bachs' ? { local: { currency: payments.ADAPTERS.bachs.currencyFor(m, u.country), rate: payments.ADAPTERS.bachs.currencyFor(m, u.country) === 'NGN' ? require('../fx').effectiveRate(m) : 1, paused: payments.ADAPTERS.bachs.currencyFor(m, u.country) === 'NGN' && payments.ADAPTERS.bachs.staleness(m).block },
          // Payment cap: the checkout hides Bachs for totals over this (fee inside); the server refuses them too.
          max_usd: payments.ADAPTERS.bachs.maxUsd(m), cap_note: payments.ADAPTERS.bachs.capMessage(m) } : {}) })),
      country: u.country || null,
      plans: p.plans, topups: p.topups,
      payments: all('SELECT id, kind, plan_id, period, credits, COALESCE(charged_usd, amount_usd) AS amount_usd, status, adapter, created_at, paid_at FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id),
      ledger: credits.ledger(u.id, 30), user: publicUser(u),
      // Bachs card auto-renew: next charge date and amount, and a calm notice when a card payment failed.
      subscription: (() => { try { return require('../payments/bachs-subs').summary(u.id); } catch { return null; } })(),
    });
  });
  r.post('/api/billing/card', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('card:' + u.id, 10, 6e4);
    const url = await require('../payments/bachs-subs').cardUrl(u.id).catch((e) => fail(502, 'Bachs is not available right now. Try again in a minute.'));
    if (!url) fail(404, 'There is no card on file to update.');
    res.json({ url });
  });
  r.post('/api/billing/discount', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('disc:' + u.id, 15, 6e4);
    const b = await parseJson(req);
    const d = billing.checkDiscount(b.code, u, 'plan');
    if (!d) fail(400, 'Enter a discount code.');
    res.json({ code: d.code, percent: d.percent });
  });
  r.post('/api/billing/checkout', async (req, res) => {
    const u = auth.requireUser(req);
    rateLimit('pay:' + u.id, 10, 6e4);
    const b = await parseJson(req);
    res.json(await billing.startCheckout(u, b));
  });
  r.post('/api/billing/cancel', async (req, res) => {
    const u = auth.requireUser(req);
    if (u.stripe_sub) {
      const m = payments.byAdapterAny('stripe');
      if (m) await payments.ADAPTERS.stripe.cancel(m, u.stripe_sub).catch((e) => fail(502, e.message));
    }
    // Bachs card auto-renew: cancel at the end of the period (the plan stays active until then).
    const bs = require('../payments/bachs-subs');
    if (bs.forUser(u.id)) await bs.cancel(u.id).catch((e) => { console.warn('[bachs cancel]', e.message); fail(502, 'We could not reach the card processor. Try again in a minute.'); });
    run('UPDATE users SET auto_renew = 0 WHERE id = ?', u.id);
    if (u.auto_renew) voo.reportCancelled(u, u.plan_id);
    res.json({ ok: true, message: 'Auto-renew is off.' + (credits.activePlan(u) ? ' Your plan stays active until ' + u.plan_expires_at.slice(0, 10) + '.' : '') });
  });
  r.get('/api/pay/test/:id', (req, res) => {
    if (!config.testPayments) fail(404, 'Not found');
    // Only the customer's own test-method payments (never a real Stripe/Gatevoo/... payment).
    const u = auth.requireUser(req);
    const p = get("SELECT id FROM payments WHERE id = ? AND user_id = ? AND adapter = 'test'", Number(req.params.id), u.id);
    if (!p) fail(404, 'Not found');
    billing.markPaid(p.id, { ref: 'test_' + p.id });
    res.redirect('/app?paid=' + req.params.id + '#wallet');
  });

  // ---------- Support ----------
  // Tickets and the old /api/support chat endpoints live in routes/support.js.

  // ---------- Referrals ----------
  r.get('/api/referral', (req, res) => {
    const u = auth.requireUser(req);
    const refs = all('SELECT id, created_at FROM users WHERE referred_by = ?', u.ref_code);
    const paying = refs.filter((x) => get("SELECT 1 FROM payments WHERE user_id = ? AND status = 'paid'", x.id)).length;
    const spent = refs.reduce((s, x) => s + (get("SELECT COALESCE(SUM(amount_usd),0) AS t FROM payments WHERE user_id = ? AND status = 'paid'", x.id).t || 0), 0);
    const tiers = getSetting('referral').tiers;
    const tier = [...tiers].reverse().find((t) => paying >= t.min) || { pct: 0 };
    res.json({ link: `${config.appUrl}/?invite=${u.ref_code}`, legacy_link: `${config.appUrl}/?ref=${u.ref_code}`, referred: refs.length, paying, spent_usd: Math.round(spent * 100) / 100, pct: tier.pct, est_earned_usd: Math.round(spent * tier.pct) / 100, settings: getSetting('referral') });
  });

  // ---------- Email unsubscribe ----------
  r.get('/api/email/unsubscribe', (req, res) => {
    const uid = Number(req.query.u);
    if (!uid || !safeEqual(email.unsubToken(uid), req.query.t)) return res.html('<p style="font-family:sans-serif">That link is not valid.</p>', 400);
    run('UPDATE users SET marketing_opt_in = 0 WHERE id = ?', uid);
    res.html('<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:80px auto;text-align:center"><h1>You are unsubscribed</h1><p>You will still get receipts and login codes. Changed your mind? Turn tips back on in the app settings.</p><p><a href="/">Back to Vooads</a></p></div>');
  });

  // ---------- Webhooks ----------
  async function handleWebhook(req, res, adapterName, method) {
    const adapter = payments.ADAPTERS[adapterName];
    if (!adapter || !method) fail(404, 'Unknown webhook');
    // Several methods can share one provider (e.g. two Paystack accounts): the one whose secret verifies the signature wins.
    const candidates = adapterName === 'custom' ? [method] : [method, ...all('SELECT * FROM payment_methods WHERE adapter = ? AND secret_enc IS NOT NULL AND id != ? ORDER BY enabled DESC, id', adapterName, method.id || 0).map(payments.hydrate)];
    let ev, lastErr;
    for (const m of candidates) {
      try { ev = await adapter.webhook(m, req); break; } catch (e) { lastErr = e; }
    }
    if (!ev) { console.warn('[webhook]', adapterName, lastErr?.message); return res.json({ error: lastErr?.message || 'Bad webhook' }, lastErr?.status || 400); }
    if (ev.type === 'paid' && ev.paymentId) {
      // A webhook can only pay a payment that was started with the same provider.
      const p = get('SELECT adapter FROM payments WHERE id = ?', Number(ev.paymentId));
      if (p && p.adapter === adapterName) billing.markPaid(ev.paymentId, ev);
      else console.warn('[webhook]', adapterName, 'payment', ev.paymentId, 'belongs to', p ? p.adapter : 'nobody');
    }
    if (ev.type === 'chargeback' && ev.paymentId) {
      const p = get('SELECT adapter FROM payments WHERE id = ?', Number(ev.paymentId));
      if (p && p.adapter === adapterName) require('../voomoney').reverse(ev.paymentId, { kind: 'chargeback', ref: ev.ref });
    }
    if (ev.type === 'renewed') billing.renewStripe(ev.subscription, ev.ref, ev.amountUsd);
    if (ev.type === 'cancelled') run('UPDATE users SET auto_renew = 0 WHERE stripe_sub = ?', ev.subscription);
    res.json({ received: true });
  }
  // Custom payment methods: each row has its own webhook URL.
  r.post('/api/webhooks/custom/:methodId', async (req, res) => {
    req.rawBody = await readBody(req, 1e6);
    return handleWebhook(req, res, 'custom', payments.byIdAdapter(req.params.methodId, 'custom'));
  });
  r.post('/api/webhooks/:adapter', async (req, res) => {
    req.rawBody = await readBody(req, 1e6);
    const adapterName = req.params.adapter;
    if (adapterName === 'custom') fail(404, 'Use /api/webhooks/custom/<method id>.');
    // Webhooks still work after a method is switched off, so renewals and cancellations already in progress are handled.
    return handleWebhook(req, res, adapterName, payments.ADAPTERS[adapterName] ? payments.byAdapterAny(adapterName) : null);
  });

  // ---------- VooSquare summary (server to server) ----------
  // Accepts the Voo Connect API key (how VooSquare calls every tool's Summary URL) or the older inbound service key.
  r.get('/api/voosquare/summary', (req, res) => {
    const key = config.voosquare.serviceKey, apiKey = voo.eventsOn() ? config.voosquare.apiKey : '';
    const okKey = (k) => k && safeEqual(String(req.headers.authorization || ''), 'Bearer ' + k);
    if (!okKey(key) && !okKey(apiKey)) fail(401, 'Unauthorized');
    require('../integrations').noteInbound();
    const period = ['1d', '7d', '30d'].includes(req.query.period) ? req.query.period : '1d';
    const out = voo.summary(String(req.query.voo_id || ''), period);
    if (!out) return res.json({ linked: false });
    res.json({ tool: 'vooads', linked: true, period, ...out });
  });
};

module.exports.publicUser = publicUser;
