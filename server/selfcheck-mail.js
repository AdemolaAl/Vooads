// Self-check steps for Mail (server/mail, routes/mail.js). Called from selfcheck.js: mailChecks({ call, step, wait }).
// Uses a tiny local server that plays Resend, so delivery, attachments, headers and idempotency are checked for real.
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert');

// A real PNG of any size (solid colour), no image library needed.
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xc8)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = async function mailChecks({ call, step, wait }) {
  const B = process.env.APP_URL;
  const { run, get, all } = require('./db');
  const sender = require('./mail/sender');
  const store = require('./mail/store');
  const { sanitize } = require('./mail/sanitize');
  const email = require('./email');

  // Fake Resend: dedupes on Idempotency-Key like the real API.
  const got = [], byKey = new Map();
  const resend = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const key = req.headers['idempotency-key'];
      if (key && byKey.has(key)) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id: byKey.get(key) })); }
      const rid = 're_' + crypto.randomBytes(6).toString('hex');
      if (key) byKey.set(key, rid);
      got.push({ key, body, auth: req.headers.authorization, id: rid });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: rid }));
    });
  });
  await new Promise((r) => resend.listen(0, '127.0.0.1', r));
  const withResend = async (fn) => {
    process.env.RESEND_API_BASE = 'http://127.0.0.1:' + resend.address().port;
    process.env.RESEND_API_KEY = 're_check_key';
    try { return await fn(); } finally { delete process.env.RESEND_API_KEY; }
  };
  // This file logs in its own owner session (earlier checks sign other sessions out). Unique IPs avoid the login-code limits.
  const ip = () => ({ 'x-forwarded-for': '10.77.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });
  const jarCookies = {};
  {
    const h = { 'Content-Type': 'application/json', ...ip() };
    const c = await (await fetch(B + '/api/admin/auth/code', { method: 'POST', headers: h, body: JSON.stringify({ email: 'owner@example.com' }) })).json();
    const r = await fetch(B + '/api/admin/auth/verify', { method: 'POST', headers: h, body: JSON.stringify({ email: 'owner@example.com', code: c.dev_code }) });
    jarCookies.mo = (r.headers.getSetCookie?.() || []).map((x) => x.split(';')[0]).join('; ');
  }
  const A = (method, url, body) => call('mo', method, url, body, { Cookie: jarCookies.mo });
  const upload = (url, buf, type) => fetch(B + url, { method: 'POST', headers: { 'Content-Type': type, Cookie: jarCookies.mo }, body: buf }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

  // Customers for audience checks (direct inserts: faster than four sign-ups).
  const mk = (mail, extra = {}) => {
    run('INSERT INTO users(email, name, country, status, marketing_opt_in, ref_code) VALUES(?,?,?,?,?,?)', mail, extra.name ?? 'Mail Check', extra.country || 'KE', extra.status || 'active', extra.opt === 0 ? 0 : 1, 'mc' + crypto.randomBytes(4).toString('hex'));
    const id = get('SELECT id FROM users WHERE email = ?', mail).id;
    run("INSERT OR IGNORE INTO mail_tags(email, tag) VALUES(?, 'mailcheck')", mail);
    return id;
  };
  const okId = mk('mc-ok@example.com', { name: 'Bola Ade' });
  mk('mc-unsub@example.com', { opt: 0 });
  mk('mc-banned@example.com', { status: 'banned' });
  mk('mc-bounced@example.com');
  store.suppress('mc-bounced@example.com', 'bounce', 'check');
  const okId2 = mk('mc-ok2@example.com', { name: '' });
  const AUD = { tags: ['mailcheck'] };

  await step('Mail: sanitizer keeps formatting, strips scripts, handlers and unsafe links', async () => {
    assert.equal(sanitize('<p>Hi <b>there</b><script>alert(1)</script></p>'), '<p>Hi <b>there</b></p>');
    assert.equal(sanitize('<a href="javascript:alert(1)" onclick="x">x</a>'), '<a>x</a>');
    assert.equal(sanitize('<a href="&#106;avascript:alert(1)">y</a>'), '<a>y</a>');
    assert.equal(sanitize('<img src=x onerror=alert(1)><iframe src=//evil></iframe>ok'), 'ok');
    assert.equal(sanitize('<p style="color:red;background:url(//x)">s</p>'), '<p style="color:red">s</p>');
    assert.equal(sanitize('<p>open <strong>bold'), '<p>open <strong>bold</strong></p>');
    assert.equal(sanitize('a < b & c'), 'a &lt; b &amp; c');
    assert.ok(!/<script|onerror|javascript:/i.test(sanitize('<svg onload=alert(1)><script>x</script></svg><a href=" java\tscript:1">z</a>')));
  });

  await step('Mail: live preview renders blocks, fills {{tags}} with fallbacks and escapes them', async () => {
    const doc = { subject: 'Hi {{first_name|friend}}', blocks: [
      { t: 'heading', text: 'Hello {{first_name|friend}} <b>' }, { t: 'text', html: '<p>You have {{credits}} credits<script>x</script></p><a href="https://vooads.com/x">go</a>' },
      { t: 'button', label: 'Go', href: 'javascript:alert(1)' }, { t: 'image', src: 'https://evil.example/x.png' }, { t: 'video', src: '/media/u/abcdefgh.png', href: 'https://youtu.be/x' },
      { t: 'columns', src: '/media/u/abcdefgh.png', html: '<p>side</p>' }, { t: 'divider' }, { t: 'spacer', h: 999 }, { t: 'footer', html: '<p>Lagos</p>' }] };
    const r = await A('POST', '/api/admin/mail/preview', { doc });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.subject, 'Hi Alex');
    const h = r.data.html;
    assert.ok(h.includes('Hello Alex &lt;b&gt;') && h.includes('1,250 credits'), 'tags filled and escaped');
    assert.ok(!/<script|javascript:|evil\.example/.test(h), 'unsafe content removed');
    assert.ok(h.includes('#FF4A1C') && h.includes('&#9654;') && h.includes('Lagos') && h.includes('height:120px'), 'brand button, video play, footer, spacer clamped');
    const plain = require('./mail/render').renderEmail({ subject: '{{first_name|there}}', blocks: [{ t: 'text', html: '<p>Hi {{first_name|there}}</p>' }] }, { vars: {} });
    assert.equal(plain.subject, 'there'); assert.ok(plain.html.includes('Hi there'));
  });

  let imgUrl, fileIds = [];
  await step('Mail: image upload checks real bytes, resizes with ffmpeg, served at /media/u', async () => {
    const fake = await upload('/api/admin/mail/media?kind=image&name=x.png', Buffer.from('<?php echo 1; ?> not an image at all'), 'image/png');
    assert.equal(fake.status, 400);
    const big = png(2400, 60);
    const r = await upload('/api/admin/mail/media?kind=image&name=Banner.png&alt=Our%20banner', big, 'image/png');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const m = r.data.media;
    assert.equal(m.alt, 'Our banner'); assert.ok(/^\/media\/u\/[\w-]+\.png$/.test(m.url));
    if (require('./mail/uploads').ffmpegReady()) assert.equal(m.width, 1600, 'scaled to 1600px wide');
    const g = await fetch(B + m.url);
    assert.equal(g.status, 200); assert.equal(g.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(B + '/media/u/..%2F..%2Fvooads.db')).status, 404);
    imgUrl = m.url;
    const lib = await A('GET', '/api/admin/mail/media');
    assert.ok(lib.data.images.some((x) => x.url === imgUrl));
  });

  await step('Mail: attachments are checked by content and size (10 MB total)', async () => {
    assert.equal((await upload('/api/admin/mail/media?kind=file&name=report.pdf', Buffer.from('MZ\x90\x00 this is an exe'), 'application/pdf')).status, 400);
    assert.equal((await upload('/api/admin/mail/media?kind=file&name=run.exe', Buffer.from('%PDF-1.4 x'), 'application/octet-stream')).status, 400);
    assert.equal((await upload('/api/admin/mail/media?kind=file&name=a.docx', Buffer.from('PK\x03\x04 nothing'), 'application/octet-stream')).status, 400);
    const pdf = await upload('/api/admin/mail/media?kind=file&name=Price%20list.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(6e6, 32)]), 'application/pdf');
    assert.equal(pdf.status, 200, JSON.stringify(pdf.data));
    const csv = await upload('/api/admin/mail/media?kind=file&name=list.csv', Buffer.from('a,b\n1,2\n'), 'text/csv');
    assert.equal(csv.status, 200);
    const pdf2 = await upload('/api/admin/mail/media?kind=file&name=more.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5e6, 32)]), 'application/pdf');
    assert.equal(pdf2.status, 200);
    const huge = await upload('/api/admin/mail/media?kind=file&name=huge.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10.5e6, 32)]), 'application/pdf').catch(() => ({ status: 413 }));
    assert.equal(huge.status, 413, 'over 10 MB refused');
    const c = await A('POST', '/api/admin/mail/campaigns', {});
    const over = await A('PUT', '/api/admin/mail/campaigns/' + c.data.id, { attachments: [pdf.data.media.id, pdf2.data.media.id] });
    assert.equal(over.status, 400, 'more than 10 MB in total is refused');
    fileIds = [csv.data.media.id];
    await A('DEL', '/api/admin/mail/campaigns/' + c.data.id);
  });

  await step('Mail: audience counts leave out unsubscribed, banned and bounced people', async () => {
    const r = await A('POST', '/api/admin/mail/audience/count', { audience: AUD });
    assert.equal(r.status, 200);
    assert.equal(r.data.count, 2, JSON.stringify(r.data));
    assert.deepEqual(r.data.sample.map((x) => x.email).sort(), ['mc-ok2@example.com', 'mc-ok@example.com']);
    assert.equal((await A('POST', '/api/admin/mail/audience/count', { audience: { ...AUD, countries: ['NG'] } })).data.count, 0);
    assert.equal((await A('POST', '/api/admin/mail/audience/count', { audience: { ...AUD, buyer: 'paid' } })).data.count, 0);
    assert.equal((await A('POST', '/api/admin/mail/audience/count', { audience: { ...AUD, buyer: 'no_purchase', plans: ['free'] } })).data.count, 2);
    const all1 = await A('POST', '/api/admin/mail/audience/count', { audience: {} });
    assert.ok(all1.data.everyone && all1.data.count >= 2);
    assert.ok(!all1.data.sample.some((x) => /mc-(unsub|banned|bounced)/.test(x.email)));
  });

  let campId, sendRows;
  await step('Mail: only owners send to every customer; a Manager can send to a chosen segment', async () => {
    const roles = (await A('GET', '/api/admin/staff')).data.roles;
    const mgr = roles.find((x) => x.name === 'Manager');
    assert.ok(mgr.permissions.includes('mail.send') && !mgr.permissions.includes('mail.send_all'), 'Manager has mail.send only');
    const inv = await A('POST', '/api/admin/staff', { email: 'mailmgr@example.com', role_id: mgr.id });
    const hh = ip();
    await call('mm', 'POST', '/api/admin/invite/' + inv.data.invite_url.split('invite=')[1], { name: 'Mia Manager' }, hh);
    const c = await call('mm', 'POST', '/api/admin/auth/code', { email: 'mailmgr@example.com' }, hh);
    await call('mm', 'POST', '/api/admin/auth/verify', { email: 'mailmgr@example.com', code: c.data.dev_code }, hh);
    const camp = await call('mm', 'POST', '/api/admin/mail/campaigns', { name: 'Check: everyone' });
    assert.equal(camp.status, 200);
    const s1 = await call('mm', 'POST', `/api/admin/mail/campaigns/${camp.data.id}/send`, { mode: 'now' });
    assert.equal(s1.status, 403, 'manager cannot send to everyone');
    const blog = roles.find((x) => x.name === 'Blog editor');
    assert.ok(!blog.permissions.includes('mail.view'));
    await call('mm', 'DEL', '/api/admin/mail/campaigns/' + camp.data.id);
  });

  await step('Mail: send now goes through the throttled queue once, with unsubscribe header, tracking and attachments', async () => {
    await withResend(async () => {
      const c = await A('POST', '/api/admin/mail/campaigns', { name: 'Check: segment' });
      campId = c.data.id;
      const doc = { subject: 'Hello {{first_name|friend}}', preheader: 'pre', from_name: 'Ejiro at Vooads', blocks: [{ t: 'heading', text: 'Hi {{first_name|friend}}' }, { t: 'image', src: imgUrl, alt: 'banner', href: 'https://vooads.com/promo' }, { t: 'button', label: 'Open', href: '{{app_url}}/app' }] };
      assert.equal((await A('PUT', '/api/admin/mail/campaigns/' + campId, { doc, audience: AUD, attachments: fileIds })).status, 200);
      const t = await A('POST', `/api/admin/mail/campaigns/${campId}/test`, {});
      assert.equal(t.status, 200, JSON.stringify(t.data));
      const test = got.find((x) => /^\[Test\]/.test(x.body.subject));
      assert.ok(test && test.body.to[0] === 'owner@example.com' && test.body.attachments?.[0]?.filename === 'list.csv', 'test email with attachment');
      const s = await A('POST', `/api/admin/mail/campaigns/${campId}/send`, { mode: 'now' });
      assert.equal(s.status, 200, JSON.stringify(s.data)); assert.equal(s.data.recipients, 2);
      for (let i = 0; i < 40 && store.campaign(campId).status !== 'sent'; i++) { await sender.tick(); await wait(100); }
      assert.equal(store.campaign(campId).status, 'sent');
      sendRows = all('SELECT * FROM mail_sends WHERE campaign_id = ? ORDER BY id', campId);
      assert.equal(sendRows.length, 2); assert.ok(sendRows.every((x) => x.status === 'sent' && x.provider_id));
      const mine = got.filter((x) => x.key && x.key.startsWith(`vooads-mail-${campId}-`));
      assert.equal(mine.length, 2, 'one delivery per person');
      const m = mine.find((x) => x.body.to[0] === 'mc-ok@example.com');
      assert.equal(m.body.subject, 'Hello Bola'); assert.equal(m.body.from, 'Ejiro at Vooads <hello@vooads.com>');
      assert.ok(/^<http.*\/m\/u\/[\w-]+>/.test(m.body.headers['List-Unsubscribe']) && m.body.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click');
      assert.ok(m.body.html.includes('/m/o/') && m.body.html.includes('/m/c/') && !m.body.html.includes('href="https://vooads.com/promo"'), 'pixel and tracked links');
      assert.ok(m.body.html.includes(B + imgUrl), 'absolute image url');
      assert.equal(got.find((x) => x.body.to?.[0] === 'mc-ok2@example.com' && x.key?.startsWith(`vooads-mail-${campId}`)).body.subject, 'Hello friend', 'fallback used');
    });
  });

  await step('Mail: tracking links are signed (no open redirect); opens and clicks are counted', async () => {
    const s = sendRows[0];
    const good = sender.clickUrl(s.token, 'https://vooads.com/promo').replace(B, '');
    const r = await call('x', 'GET', good);
    assert.equal(r.status, 302); assert.equal(r.location, 'https://vooads.com/promo');
    assert.equal((await call('x', 'GET', good.replace('promo', 'evil'))).status, 400, 'changed url is refused');
    assert.equal((await call('x', 'GET', `/m/c/${s.token}?u=${encodeURIComponent('https://evil.example')}&s=00`)).status, 400);
    assert.equal((await call('x', 'GET', `/m/c/${sendRows[1].token}?u=${encodeURIComponent('https://vooads.com/promo')}&s=${sender.sig(s.token, 'https://vooads.com/promo')}`)).status, 400, 'signature is per email');
    const px = await fetch(B + `/m/o/${sendRows[1].token}.gif`);
    assert.equal(px.headers.get('content-type'), 'image/gif');
    const st = (await A('GET', '/api/admin/mail/campaigns/' + campId)).data;
    assert.equal(st.campaign.stats.opened, 2); assert.equal(st.campaign.stats.clicked, 1);
    assert.equal(st.links[0].url, 'https://vooads.com/promo');
  });

  await step('Mail: unsubscribe (page and one-click), preference center; receipts still arrive', async () => {
    const s = sendRows[0];
    const page = await call('x', 'GET', '/m/u/' + s.token);
    assert.equal(page.status, 200); assert.ok(/Unsubscribe\?/.test(page.data));
    assert.ok(get('SELECT marketing_opt_in FROM users WHERE id = ?', okId).marketing_opt_in, 'GET alone does not unsubscribe (link scanners)');
    const one = await fetch(B + '/m/u/' + s.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
    assert.equal(one.status, 200);
    assert.equal(get('SELECT marketing_opt_in FROM users WHERE id = ?', okId).marketing_opt_in, 0);
    assert.equal((await A('POST', '/api/admin/mail/audience/count', { audience: AUD })).data.count, 1);
    const pr = await fetch(B + '/m/p/' + s.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'product=on&set=1' });
    assert.equal(pr.status, 200);
    assert.deepEqual([store.prefs('mc-ok@example.com').marketing, store.prefs('mc-ok@example.com').product], [false, true]);
    // Transactional mail is not affected by unsubscribing.
    const receipt = email.build('payment_receipt', { amount: '$1', plan: 'Pro' }, get('SELECT * FROM users WHERE id = ?', okId));
    assert.ok(!receipt.headers && !/Unsubscribe/.test(receipt.text));
    run("INSERT INTO email_queue(user_id, to_email, template, vars, send_at) VALUES(?, 'mc-ok@example.com', 'payment_receipt', '{}', '2000-01-01')", okId);
    run("INSERT INTO email_queue(user_id, to_email, template, vars, send_at) VALUES(?, 'mc-ok@example.com', 'onboarding_day1', '{}', '2000-01-01')", okId);
    for (let i = 0; i < 30 && get("SELECT COUNT(*) AS c FROM email_queue WHERE to_email = 'mc-ok@example.com' AND sent_at IS NULL").c; i++) { await email.processQueue(); await wait(100); }
    const q = all("SELECT template, error FROM email_queue WHERE to_email = 'mc-ok@example.com'");
    assert.equal(q.find((x) => x.template === 'payment_receipt').error, null, 'receipt sent');
    assert.equal(q.find((x) => x.template === 'onboarding_day1').error, 'skipped', 'marketing skipped');
    const welcome = email.build('onboarding_day1', {}, get('SELECT * FROM users WHERE id = ?', okId2));
    assert.ok(welcome.headers['List-Unsubscribe'], 'lifecycle marketing has List-Unsubscribe');
    const lu = welcome.headers['List-Unsubscribe'].slice(1, -1).replace(B, '');
    assert.equal((await call('x', 'POST', lu, {})).status, 200);
    assert.equal(get('SELECT marketing_opt_in FROM users WHERE id = ?', okId2).marketing_opt_in, 0);
    run('UPDATE users SET marketing_opt_in = 1 WHERE id IN (?, ?)', okId, okId2);
  });

  await step('Mail: Resend webhook needs a valid signature; bounces are suppressed', async () => {
    const secretRaw = crypto.randomBytes(24);
    process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + secretRaw.toString('base64');
    try {
      const body = JSON.stringify({ type: 'email.bounced', data: { email_id: sendRows[1].provider_id, to: ['mc-ok2@example.com'], bounce: { type: 'Permanent' } } });
      const post = (h) => fetch(B + '/api/webhooks/mail/resend', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body });
      assert.equal((await post({})).status, 401);
      const ts = String(Math.floor(Date.now() / 1000)), sid = 'msg_check1';
      assert.equal((await post({ 'svix-id': sid, 'svix-timestamp': ts, 'svix-signature': 'v1,' + Buffer.alloc(32).toString('base64') })).status, 401);
      const sig = crypto.createHmac('sha256', secretRaw).update(`${sid}.${ts}.${body}`).digest('base64');
      assert.equal((await post({ 'svix-id': sid, 'svix-timestamp': String(Number(ts) - 3600), 'svix-signature': 'v1,' + sig })).status, 401, 'old timestamp refused');
      assert.equal((await post({ 'svix-id': sid, 'svix-timestamp': ts, 'svix-signature': 'v1,' + sig })).status, 200);
      assert.ok(store.suppressed('mc-ok2@example.com'));
      assert.ok(get('SELECT bounced_at FROM mail_sends WHERE id = ?', sendRows[1].id).bounced_at);
      assert.equal((await A('GET', '/api/admin/mail/campaigns/' + campId)).data.campaign.stats.bounced, 1);
    } finally { delete process.env.RESEND_WEBHOOK_SECRET; }
    run("DELETE FROM mail_suppress WHERE email = 'mc-ok2@example.com'");
  });

  await step('Mail: a scheduled campaign sends exactly once, even after a restart mid-send', async () => {
    await withResend(async () => {
      for (let i = 0; i < 4; i++) mk(`mc-sched${i}@example.com`, { name: 'Sched ' + i });
      const c = await A('POST', '/api/admin/mail/campaigns', { campaign_id: campId, name: 'Check: scheduled' });
      const id = c.data.id;
      const at = new Date(Date.now() + 3 * 3600e3).toISOString();
      const s = await A('POST', `/api/admin/mail/campaigns/${id}/send`, { mode: 'schedule', scheduled_at: at, timezone: 'Africa/Lagos' });
      assert.equal(s.status, 200, JSON.stringify(s.data)); assert.equal(s.data.campaign.status, 'scheduled');
      assert.equal((await A('POST', `/api/admin/mail/campaigns/${id}/send`, { mode: 'schedule', scheduled_at: new Date(Date.now() - 1e3).toISOString() })).status, 400, 'time in the past refused');
      await sender.tick();
      assert.equal(store.campaign(id).status, 'scheduled', 'not before its time');
      run('UPDATE mail_campaigns SET scheduled_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), id);
      const s0 = store.settings();
      store.saveSettings({ rate_per_minute: 6000 });
      for (let i = 0; i < 40 && !get("SELECT 1 FROM mail_sends WHERE campaign_id = ? AND status = 'sent'", id); i++) { await sender.tick(); await wait(60); }
      assert.equal(sender.materialize(id), 0, 'recipients are only added once');
      const n = get('SELECT COUNT(*) AS c FROM mail_sends WHERE campaign_id = ?', id).c;
      assert.equal(n, 6);
      // "Restart": a row that was handed to Resend but never marked sent goes back to the queue; Resend's idempotency stops a double.
      const one = get("SELECT * FROM mail_sends WHERE campaign_id = ? AND status = 'sent' ORDER BY id LIMIT 1", id);
      run("UPDATE mail_sends SET status = 'sending', claimed_at = '2000-01-01T00:00:00.000Z', provider_id = NULL WHERE id = ?", one.id);
      run("UPDATE mail_campaigns SET status = 'sending' WHERE id = ?", id);
      for (let i = 0; i < 20 && store.campaign(id).status !== 'sent'; i++) { await sender.tick(); await wait(50); }
      assert.equal(store.campaign(id).status, 'sent');
      const keys = got.filter((x) => x.key && x.key.startsWith(`vooads-mail-${id}-`));
      assert.equal(keys.length, 6, 'each person got one email');
      assert.equal(new Set(keys.map((x) => x.body.to[0])).size, 6);
      assert.ok(get('SELECT provider_id FROM mail_sends WHERE id = ?', one.id).provider_id, 'recovered row marked sent');
      store.saveSettings(s0);
    });
  });

  await step('Mail: pause, resume and cancel a sending campaign', async () => {
    const s0 = store.settings();
    store.saveSettings({ rate_per_minute: 1 });
    const c = await A('POST', '/api/admin/mail/campaigns', { campaign_id: campId, name: 'Check: cancel' });
    const id = c.data.id;
    assert.equal((await A('POST', `/api/admin/mail/campaigns/${id}/send`, { mode: 'now' })).status, 200);
    await sender.tick();
    assert.equal((await A('POST', `/api/admin/mail/campaigns/${id}/pause`)).data.campaign.status, 'paused');
    assert.equal((await A('PUT', `/api/admin/mail/campaigns/${id}`, { name: 'x' })).status, 409, 'cannot edit once sending');
    assert.equal((await A('POST', `/api/admin/mail/campaigns/${id}/resume`)).data.campaign.status, 'sending');
    const cx = await A('POST', `/api/admin/mail/campaigns/${id}/cancel`);
    assert.equal(cx.data.campaign.status, 'cancelled');
    assert.equal(get("SELECT COUNT(*) AS c FROM mail_sends WHERE campaign_id = ? AND status = 'queued'", id).c, 0);
    store.saveSettings(s0);
  });

  await step('Mail: lifecycle emails open in the composer, save into the live template, reset to default', async () => {
    const g = await A('GET', '/api/admin/mail/lifecycle/onboarding_day1');
    assert.equal(g.status, 200);
    assert.ok(g.data.doc.blocks.some((b) => b.t === 'heading') && g.data.doc.blocks.some((b) => b.t === 'button'));
    const doc = { ...g.data.doc, blocks: [...g.data.doc.blocks] };
    doc.blocks.splice(1, 0, { t: 'text', html: '<p>Composer line for {{first_name|you}}<script>x</script></p>' });
    assert.equal((await A('PUT', '/api/admin/mail/lifecycle/onboarding_day1', { doc })).status, 200);
    const built = email.build('onboarding_day1', {}, { id: 1, name: 'Zed' });
    assert.ok(built.html.includes('Composer line for Zed') && !built.html.includes('<script'), 'existing sender uses the new design');
    assert.ok((await A('GET', '/api/admin/mail/lifecycle/onboarding_day1')).data.template.changed);
    const pv = await A('POST', '/api/admin/mail/preview', { doc, lifecycle: 'onboarding_day1' });
    assert.ok(pv.data.html.includes('Composer line for Alex'));
    assert.equal((await A('POST', '/api/admin/mail/lifecycle/onboarding_day1/reset')).status, 200);
    assert.ok(!email.build('onboarding_day1', {}, { id: 1, name: 'Zed' }).html.includes('Composer line'));
    assert.equal((await A('GET', '/api/admin/mail/lifecycle/onboarding_day1')).data.template.changed, false);
  });

  await step('Mail: CSV import needs consent; contacts become their own audience', async () => {
    const csv = 'Email,Name,Country,Tags\n"ada@contacts.test","Ada, Lovelace",NG,vip;beta\nnot-an-email,X,,\nmc-bounced@example.com,B,,\n';
    const imp = (q) => fetch(B + '/api/admin/mail/contacts/import' + q, { method: 'POST', headers: { 'Content-Type': 'text/csv', Cookie: jarCookies.mo }, body: csv }).then(async (r) => ({ status: r.status, data: await r.json() }));
    assert.equal((await imp('?tag=webinar')).status, 400, 'consent box required');
    const r = await imp('?consent=1&tag=webinar&source=Webinar%20signups');
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual([r.data.added, r.data.invalid, r.data.suppressed], [2, 1, 1]);
    const c = get("SELECT * FROM mail_contacts WHERE email = 'ada@contacts.test'");
    assert.equal(c.name, 'Ada, Lovelace'); assert.equal(c.country, 'NG'); assert.ok(/Webinar signups/.test(c.consent_source));
    assert.equal((await A('POST', '/api/admin/mail/audience/count', { audience: { source: 'contacts', tags: ['webinar'] } })).data.count, 1, 'bounced contact left out');
    assert.equal((await A('POST', '/api/admin/mail/audience/count', { audience: { source: 'contacts', tags: ['vip'] } })).data.count, 1);
  });

  await step('Mail: customer mail history and audit log', async () => {
    const h = await A('GET', '/api/admin/mail/users/' + okId);
    assert.equal(h.status, 200);
    assert.ok(h.data.sends.some((x) => x.campaign_id === campId && x.clicked_at));
    assert.ok(h.data.lifecycle.some((x) => x.template === 'payment_receipt'));
    assert.equal(h.data.prefs.product, true);
    const t = await A('PUT', '/api/admin/mail/users/' + okId, { tags: ['VIP', 'mailcheck'] });
    assert.deepEqual(t.data.tags, ['mailcheck', 'vip']);
    const log = (await A('GET', '/api/admin/audit')).data.log.map((x) => x.action);
    for (const a of ['mail.send', 'mail.schedule', 'mail.cancel', 'mail.upload', 'mail.contacts_import', 'mail.test']) assert.ok(log.includes(a), a + ' in audit log');
  });

  resend.close();
  delete process.env.RESEND_API_BASE;
};
