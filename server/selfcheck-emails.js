// Email checks: every template renders in the new design, "Your video is ready" goes out when a video finishes, receipts
// show what was charged with no fee line, and the company name appears only in the one legal footer line.
// Called from selfcheck.js: emailChecks({ call, step, wait }).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function emailChecks({ call, step, wait }) {
  const { get, all, run, J } = require('./db');
  const config = require('./config');
  const email = require('./email');
  const designs = require('./email/designs');
  const catalog = require('./email/catalog');
  const { sampleVars } = require('./email/samples');
  const IMG = path.join(__dirname, '..', 'public', 'assets', 'img', 'email');
  const ip = () => ({ 'x-forwarded-for': '10.91.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) });
  const login = async (jar, mail) => { const h = ip(); const c = await call(jar, 'POST', '/api/auth/code', { email: mail }, h); return call(jar, 'POST', '/api/auth/verify', { email: mail, code: c.data.dev_code }, h); };
  const userRow = (mail) => get('SELECT * FROM users WHERE email = ?', mail);
  const queued = (tpl, mail) => all('SELECT * FROM email_queue WHERE template = ? AND to_email = ? ORDER BY id DESC', tpl, mail);
  // Own owner session (earlier groups may sign the main one out).
  const owner = get("SELECT id FROM roles WHERE name = 'Owner'");
  if (!get('SELECT 1 FROM staff WHERE email = ?', 'email-owner@example.com')) run("INSERT INTO staff(email, name, role_id, status) VALUES('email-owner@example.com', 'Email owner', ?, 'active')", owner.id);
  { const h = ip(); const c = await call('eo', 'POST', '/api/admin/auth/code', { email: 'email-owner@example.com' }, h); await call('eo', 'POST', '/api/admin/auth/verify', { email: 'email-owner@example.com', code: c.data.dev_code }, h); }
  const ids = [...new Set([...all('SELECT id FROM email_templates').map((t) => t.id), ...catalog.all.map((t) => t.id), 'ticket_reply'])];

  await step('Emails: every template renders in the new design (doctype, animated header with alt text, dark mode, Outlook fallbacks)', async () => {
    for (const c of catalog.NEW) assert.ok(get('SELECT 1 FROM email_templates WHERE id = ?', c.id), 'seeded ' + c.id);
    for (const id of ids) {
      const m = email.build(id, sampleVars(config.appUrl, id), { id: 0, name: 'Alex' });
      const d = designs.designFor(id);
      assert.ok(m.subject && !/\{\{|\}\}/.test(m.subject + m.html), id + ': unfilled placeholder');
      assert.match(m.html, /^<!doctype html>/i, id);
      assert.ok(m.html.includes('prefers-color-scheme: dark') && m.html.includes('<!--[if mso]>'), id + ': dark mode + Outlook');
      for (const tag of m.html.match(/<img\b[^>]*>/g) || []) assert.match(tag, /\salt="/, id + ': every image has alt text');
      if (d.style !== 'plain') {
        const gif = `${config.appUrl}/assets/img/email/${d.gif}.gif`;
        assert.ok(m.html.includes(gif) || (d.style === 'hero' && m.html.includes(d.gif)), id + ': header GIF');
        const file = path.join(IMG, d.gif + '.gif');
        assert.ok(fs.existsSync(file), id + ': GIF file exists');
        assert.ok(fs.statSync(file).size < 420e3, id + ': GIF stays small');
        assert.equal(fs.readFileSync(file).subarray(0, 6).toString(), 'GIF89a');
      }
      // Whole email (HTML + its images from our assets) stays under 1 MB.
      const local = [...new Set([...m.html.matchAll(/assets\/img\/email\/([\w.-]+)"/g)].map((x) => x[1]))];
      const bytes = Buffer.byteLength(m.html) + local.reduce((t, f) => t + fs.statSync(path.join(IMG, f)).size, 0);
      assert.ok(bytes < 1024 * 1024, `${id}: ${Math.round(bytes / 1024)} KB`);
      assert.ok(!/@keyframes|animation\s*:/i.test(m.html), id + ': no CSS animation (the motion is in the GIF only)');
    }
    // Admin previews use the same design.
    const pv = await call('eo', 'GET', '/api/admin/emails/video_ready/preview');
    assert.equal(pv.status, 200); assert.ok(String(pv.data).includes('Edit by chat'));
  });

  await step('Emails: "Zedapex" appears only in the one legal footer line', async () => {
    for (const id of ids) {
      const m = email.build(id, sampleVars(config.appUrl, id), { id: 0, name: 'Alex' });
      const hits = m.html.match(/zedapex/gi) || [];
      assert.equal(hits.length, 1, id + ': company name once');
      assert.match(m.html, /<p class="va-foot va-legal"[^>]*>&copy; \d{4} Zedapex Limited, Lagos<\/p>/, id + ': in the legal line');
      assert.ok(!/zedapex/i.test(m.subject + m.text), id + ': not in subject or text');
    }
    for (const f of ['designs.js', 'catalog.js', 'samples.js', 'layout.js']) assert.ok(!/zedapex/i.test(fs.readFileSync(path.join(__dirname, 'email', f), 'utf8')), f);
  });

  await step('Emails: receipts show the total charged once, with no fee line; referral commission is on the base price', async () => {
    await login('er', 'email-receipt@example.com');
    await login('ef', 'email-referrer@example.com');
    const ref = userRow('email-referrer@example.com');
    const u = userRow('email-receipt@example.com');
    run('UPDATE users SET referred_by = ? WHERE id = ?', ref.ref_code, u.id);
    run("UPDATE users SET plan_id = 'pro', plan_period = 'month', plan_expires_at = ?, plan_credits = 3500 WHERE id = ?", new Date(Date.now() + 20 * 864e5).toISOString(), u.id);
    const ins = run("INSERT INTO payments(user_id, adapter, kind, credits, amount_usd, fee_pct, fee_usd, charged_usd, status) VALUES(?, 'bachs', 'topup', 2500, 59, 4, 2.36, 61.36, 'pending')", u.id);
    require('./billing').markPaid(Number(ins.lastInsertRowid), { ref: 'email_fee_check' });
    const q = queued('topup_receipt', u.email)[0];
    assert.ok(q, 'receipt queued');
    const v = J(q.vars, {});
    assert.equal(v.amount, '$61.36', 'the amount is what the customer paid');
    const m = email.build('topup_receipt', v, userRow(u.email));
    assert.ok(m.html.includes('Total charged') && m.html.includes('$61.36'));
    assert.ok(!m.html.includes('$59.00') && !m.html.includes('$2.36'), 'no base price or fee shown');
    assert.ok(!/\bfees?\b|surcharge|processing/i.test(m.html.replace(/<style[\s\S]*?<\/style>/g, '')), 'no fee line');
    assert.ok(m.html.includes('split-receipt.gif') && m.html.includes('VA-' + ins.lastInsertRowid));
    const r = queued('referral_earned', ref.email)[0];
    assert.ok(r, 'referrer emailed');
    assert.equal(J(r.vars, {}).amount, '$5.90', '10% of the $59 base price, not of the fee');
  });

  await step('Emails: a finished video queues "Your video is ready" with its own preview, title, play button and Edit by chat', async () => {
    const mail = 'email-video@example.com';
    await login('ev', mail);
    const u = userRow(mail);
    run("UPDATE users SET plan_id = 'pro', plan_period = 'month', plan_expires_at = ?, plan_credits = 3500, name = 'Robin' WHERE id = ?", new Date(Date.now() + 20 * 864e5).toISOString(), u.id);
    const vt = require('./videotypes').all().find((t) => t.pipeline === 'video' && t.enabled !== false);
    const r = await call('ev', 'POST', '/api/jobs', { type: 'video_type', video_type: vt.id, product: 'Lumen <b>Serum</b> & co', style: 'unboxing', duration: 5 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const jobId = r.data.job.id;
    let job;
    for (let i = 0; i < 120; i++) { job = get('SELECT * FROM jobs WHERE id = ?', jobId); if (['done', 'failed'].includes(job.status)) break; await wait(500); }
    assert.equal(job.status, 'done', job.error || job.step);
    let q;
    for (let i = 0; i < 80 && !q; i++) { q = queued('video_ready', mail).find((x) => J(x.vars, {}).job_id === jobId); if (!q) await wait(250); }
    assert.ok(q, 'video_ready queued on completion');
    const v = J(q.vars, {});
    const prod = J(job.input, {}).product;
    assert.ok(v.video_title.startsWith(prod), v.video_title);
    assert.ok(v.video_page.endsWith('#library/' + jobId) && v.edit_url.includes('edit=1'));
    const out = J(job.output, {});
    const src = String(out.url || '').replace(config.appUrl, '');
    const localSrc = src.startsWith('/samples/') ? require('./samples').localPath(src.slice(9)) : src.startsWith('/media/') ? require('./media').filePath(src.slice(7)) : null;
    if (require('./stitch').available() && localSrc) assert.ok(v.preview_gif || v.thumb_url, 'a preview was made from the video itself');
    if (v.preview_gif) {
      const f = require('./media').filePath(v.preview_gif.split('/media/')[1]);
      assert.ok(f && fs.readFileSync(f).subarray(0, 3).toString() === 'GIF', 'preview is a GIF');
      assert.ok(fs.statSync(f).size <= require('./email/preview').MAX_GIF);
      assert.ok(v.thumb_url, 'thumbnail saved too');
    }
    const m = email.build('video_ready', v, userRow(mail));
    assert.ok(m.html.includes('Edit by chat') && m.html.includes('Watch your video'));
    const { esc } = require('./lib/util');
    assert.ok(m.html.includes(esc(prod)), 'title shown');
    if (/[<>&]/.test(prod)) assert.ok(!m.html.includes(prod), 'customer text is escaped');
    assert.ok(m.html.includes(v.preview_gif || v.thumb_url || 'hero-ready.gif'), 'hero shows the video preview');
    assert.ok(m.subject.startsWith('Your video is ready'));
    assert.equal(queued('video_ready', mail).filter((x) => J(x.vars, {}).job_id === jobId).length, 1, 'only once');
  });

  await step('Emails: failures, attention, credits, face approval and plan notices are wired to their events and respect opt-outs', async () => {
    const mail = 'email-events@example.com';
    await login('ee', mail);
    const u = userRow(mail);
    const jobs = require('./jobs');
    // A failed job: credits back. A job the customer cancelled: no email.
    const mk = (credits) => Number(run("INSERT INTO jobs(user_id, type, status, step, input, credits, state) VALUES(?, 'ugc', 'running', 'x', ?, ?, ?)", u.id, JSON.stringify({ product: 'Trail Shoes', segments: 3, duration: 30 }), credits, JSON.stringify({ take: { trial: 0, plan: 0, topup: credits } })).lastInsertRowid);
    const j1 = mk(90);
    jobs.failJob(get('SELECT * FROM jobs WHERE id = ?', j1), 'The AI model was busy. Your credits are back.');
    const f = queued('job_failed', mail)[0];
    assert.ok(f && J(f.vars, {}).credits === '90' && J(f.vars, {}).reason === 'The AI model was busy.');
    assert.ok(email.build('job_failed', J(f.vars, {}), u).html.includes('+90'));
    const n0 = queued('job_failed', mail).length;
    jobs.failJob(get('SELECT * FROM jobs WHERE id = ?', mk(40)), 'You cancelled this video. All its credits are back.');
    assert.equal(queued('job_failed', mail).length, n0, 'no email when the customer cancelled');
    // Needs attention: the three choices.
    email.hooks.jobAttention({ ...get('SELECT * FROM jobs WHERE id = ?', mk(10)), state: JSON.stringify({ attention: { keep_until: '2026-11-10T00:00:00Z' } }) }, 1);
    const a = J(queued('video_attention', mail)[0].vars, {});
    assert.equal(a.part, '2'); assert.equal(a.keep_until, 'Nov 10, 2026');
    const ah = email.build('video_attention', a, u).html;
    for (const c of ['choice=retry', 'choice=still', 'choice=cancel', 'Cancel and refund']) assert.ok(ah.includes(c), c);
    // Staff credit grant → credits_added (the internal reason is not sent).
    const add = await call('eo', 'POST', `/api/admin/users/${u.id}/credits`, { amount: 75, reason: 'internal: goodwill for slow render' });
    assert.equal(add.status, 200, JSON.stringify(add.data));
    const ca = queued('credits_added', mail)[0];
    assert.ok(ca && J(ca.vars, {}).credits === '75' && !ca.vars.includes('internal'));
    // Own-face actor approved / declined.
    const act = (name) => Number(run("INSERT INTO actors(user_id, name, kind, image_url, status, consent) VALUES(?, ?, 'upload', '/samples/creator-3.png', 'pending', ?)", u.id, name, JSON.stringify({ clip_url: '/media/x.mp4' })).lastInsertRowid);
    const staff = get('SELECT * FROM staff ORDER BY id LIMIT 1');
    require('./actors').review(staff, act('Robin face'), { approve: true });
    require('./actors').review(staff, act('Robin take 2'), { approve: false, note: 'The clip ends early.' });
    assert.equal(J(queued('actor_approved', mail)[0].vars, {}).actor_name, 'Robin face');
    assert.equal(J(queued('actor_declined', mail)[0].vars, {}).note, 'The clip ends early.');
    // Plan renews soon (auto-renew), plan ended, weekly digest; each once.
    run("UPDATE users SET plan_id = 'starter', plan_period = 'month', auto_renew = 1, plan_credits = 20, plan_expires_at = ? WHERE id = ?", new Date(Date.now() + 3 * 864e5).toISOString(), u.id);
    email.hooks.daily(); email.hooks.daily();
    assert.equal(queued('plan_renews_soon', mail).length, 1);
    assert.equal(J(queued('plan_renews_soon', mail)[0].vars, {}).amount, '$49.00');
    run('UPDATE users SET auto_renew = 0, plan_expires_at = ? WHERE id = ?', new Date(Date.now() - 864e5).toISOString(), u.id);
    email.hooks.daily(); email.hooks.daily();
    assert.equal(queued('plan_expired', mail).length, 1);
    run("INSERT INTO jobs(user_id, type, status, step, input, credits) VALUES(?, 'image', 'done', 'Done', '{}', 12)", u.id);
    email.hooks.weekly(); email.hooks.weekly();
    assert.equal(queued('weekly_digest', mail).length, 1);
    // Low credits on a plan: once per credit period.
    run("UPDATE users SET plan_id = 'starter', plan_expires_at = ?, plan_credits = 50, topup_credits = 0, plan_credits_reset_at = '2026-12-01' WHERE id = ?", new Date(Date.now() + 20 * 864e5).toISOString(), u.id);
    email.hooks.jobDone({ ...get('SELECT * FROM jobs WHERE id = ?', j1), type: 'hooks' }, {});
    email.hooks.jobDone({ ...get('SELECT * FROM jobs WHERE id = ?', j1), type: 'hooks' }, {});
    assert.equal(queued('paid_credits_low', mail).length + queued('trial_credits_low', mail).length, 1);
    assert.ok(email.build('paid_credits_low', J(queued('paid_credits_low', mail)[0].vars, {}), u).html.includes('Buy credits'));
    // Opt-outs: digests and low-credit emails are marketing (unsubscribe link, skipped after opting out); receipts are not.
    for (const id of ['weekly_digest', 'paid_credits_low', 'trial_credits_low']) assert.ok(email.MARKETING.has(id), id);
    for (const id of ['video_ready', 'job_failed', 'payment_receipt', 'topup_receipt', 'credits_added']) assert.ok(!email.MARKETING.has(id), id);
    run('UPDATE users SET marketing_opt_in = 0 WHERE id = ?', u.id);
    let dg;
    for (let i = 0; i < 60; i++) { await email.processQueue(); dg = get("SELECT * FROM email_queue WHERE template = 'weekly_digest' AND to_email = ?", mail); if (dg.sent_at) break; await wait(200); }
    assert.equal(dg.error, 'skipped', 'opted out: no digest');
    assert.ok(email.build('weekly_digest', {}, u).html.includes('/api/email/unsubscribe'));
    assert.ok(!email.build('job_failed', {}, u).html.includes('/api/email/unsubscribe'));
  });

  await step('Emails: a new address gets "Confirm your email", a known one gets the sign-in code', async () => {
    const out = [];
    const prev = console.log;
    console.log = (...x) => { out.push(x.join(' ')); };
    try {
      await call('vx', 'POST', '/api/auth/code', { email: 'email-new-addr@example.com' }, ip());
      await call('vx', 'POST', '/api/auth/code', { email: 'email-events@example.com' }, ip());
    } finally { console.log = prev; }
    const log = out.join('\n');
    assert.match(log, /To: email-new-addr@example\.com\nSubject: Confirm your email: \d{6}/);
    assert.match(log, /To: email-events@example\.com\nSubject: Your Vooads login code: \d{6}/);
  });

  await step('Emails: the welcome email\'s free credits equal pricing.free_trial.credits (live config, also when the owner changes it)', async () => {
    const settings = require('./settings');
    const P = settings.pricing();
    const trial = Number(P.free_trial.credits);
    const cheapest = Math.min(...P.plans.map((x) => Number(x.price_month)).filter((x) => x > 0));
    const nums = (html) => [...html.matchAll(/([\d,]+) free credits/g)].map((m) => Number(m[1].replace(/,/g, '')));
    // A real sign-up: the queued welcome email and what it renders.
    const mail = 'email-welcome-trial@example.com';
    await login('ew', mail);
    const q = queued('welcome', mail)[0];
    assert.ok(q, 'welcome queued');
    const u = userRow(mail);
    const granted = Number(J(q.vars, {}).trial_credits);
    assert.equal(granted, u.trial_credits, 'the email uses what the account got');
    assert.ok(granted > 0, 'this sign-up got the free trial');
    const html = email.build('welcome', J(q.vars, {}), u).html;
    if (granted > 0) { assert.equal(granted, trial, 'granted = pricing.free_trial.credits'); assert.deepEqual(nums(html), [trial]); }
    // Without a passed value, the live config is used.
    const plain = email.build('welcome', {}, { id: 0, name: 'Alex' });
    assert.deepEqual(nums(plain.html), [trial], 'welcome credit number = pricing.free_trial.credits');
    assert.ok(plain.html.includes(`Videos start with any plan, from $${cheapest} a month.`), 'cheapest plan price from the config');
    assert.ok(!/free credits[^.<]*\bvideo/i.test(plain.html.replace(/<[^>]+>/g, '')), 'never implies free credits make videos');
    assert.ok(!/1,200|1200 /.test(plain.html + plain.subject));
    assert.deepEqual(nums(email.build('welcome', require('./email/samples').sampleVars(config.appUrl, 'welcome'), { id: 0, name: 'Alex' }).html), [trial], 'preview sample = live value');
    assert.ok(email.build('trial_inactive_48h', {}, { id: 0, name: 'Alex' }).html.includes(`for ${P.costs.hook_pack_20} credits`), 'hook price from the config');
    // The owner changes the free trial in Admin → Pricing: emails follow.
    const saved = settings.getSetting('pricing');
    try {
      settings.setSetting('pricing', { ...saved, free_trial: { ...saved.free_trial, credits: trial + 15 } });
      assert.deepEqual(nums(email.build('welcome', {}, { id: 0, name: 'Alex' }).html), [trial + 15]);
    } finally { settings.setSetting('pricing', saved); }
    assert.deepEqual(nums(email.build('welcome', {}, { id: 0, name: 'Alex' }).html), [trial]);
  });

  await step('Emails: an edited template is never overwritten; untouched originals get the new copy', async () => {
    run("UPDATE email_templates SET body_html = '<p>Owner edit</p>' WHERE id = 'renewal_reminder'");
    email.seedTemplates();
    assert.equal(get("SELECT body_html FROM email_templates WHERE id = 'renewal_reminder'").body_html, '<p>Owner edit</p>');
    assert.equal(get("SELECT cta_label FROM email_templates WHERE id = 'welcome'").cta_label, 'Make your first ad');
    assert.equal(email.defaultFor('welcome').cta_label, 'Make your first ad');
    const reset = await call('eo', 'POST', '/api/admin/mail/lifecycle/renewal_reminder/reset');
    assert.equal(reset.status, 200);
    assert.equal(get("SELECT body_html FROM email_templates WHERE id = 'renewal_reminder'").body_html, email.defaultFor('renewal_reminder').body_html);
  });
};
