// Self-checks for the editing tools (SPEC §14): Change background, Auto-edit my video, Brand music.
// Profit guard at every length (60 fps worst case, AI extras, 30% code), upload validation (magic bytes, ffprobe length,
// plan, quota, signed links), the edit-plan validator, caption/ffmpeg safety, brand-track reuse (free, owner only), refunds,
// and REAL ffmpeg runs of both pipelines on generated test footage with the demo providers. Called from selfcheck.js.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function videoToolChecks({ call, step, wait }) {
  let ipN = 0;
  const ip = () => ({ 'x-forwarded-for': '10.21.0.' + (++ipN) });
  async function signup(jar, email) {
    const h = ip();
    const c = await call(jar, 'POST', '/api/auth/code', { email }, h);
    const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, name: 'Tools', country: 'NG' }, h);
    assert.equal(v.status, 200, JSON.stringify(v.data));
    return v.data.user;
  }
  async function buyPlan(jar, planId) {
    const r = await call(jar, 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: planId, period: 'month', method_id: 0 });
    await call(jar, 'GET', new URL(r.data.url).pathname);
    assert.equal((await call(jar, 'GET', '/api/me')).data.user.plan.id, planId);
  }
  async function waitJob(jar, id, secs = 150) {
    for (let k = 0; k < secs * 2; k++) {
      const r = await call(jar, 'GET', '/api/jobs/' + id);
      if (['done', 'failed'].includes(r.data.job.status)) return r.data.job;
      await wait(500);
    }
    throw new Error('job ' + id + ' did not finish');
  }
  const balance = async (jar) => (await call(jar, 'GET', '/api/me')).data.user.balance.total;
  const upload = (jar, file, purpose, type = 'video/mp4', name = 'clip.mp4') => call(jar, 'POST', `/api/uploads/video?for=${purpose}&name=${encodeURIComponent(name)}`, fs.readFileSync(file), { 'Content-Type': type });

  const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-vt-'));
  const ff = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); if (r.status !== 0) throw new Error(String(r.stderr)); };
  // A tiny "green screen" clip: a moving test card on chroma green, with a tone (8s), and a long one (130s, 64px).
  const green = path.join(dir, 'green.mp4'), long = path.join(dir, 'long.mp4'), mid = path.join(dir, 'mid.mp4'), big = path.join(dir, 'big.mp4');
  if (ffmpeg) {
    ff(['-f', 'lavfi', '-i', 'color=c=0x00FF00:s=480x270:r=30:d=12', '-f', 'lavfi', '-i', 'testsrc=s=150x200:r=30:d=12', '-f', 'lavfi', '-i', 'sine=f=330:d=12', '-filter_complex', "[0][1]overlay=x='160+50*sin(t)':y=70[v]", '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', green]);
    ff(['-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=5:d=130', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', long]);
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '6M', '-pix_fmt', 'yuv420p', big]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x00FF00:s=64x64:r=10:d=40', '-f', 'lavfi', '-i', 'sine=f=200:d=40', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mid]);
  }

  // Own admin session (earlier groups sign the shared one out).
  // A second owner-role staff member for this group, so the owner's login-code limit is not hit.
  {
    const { get, run } = require('./db');
    const owner = get("SELECT id FROM roles WHERE name = 'Owner'");
    if (!get("SELECT 1 FROM staff WHERE email = 'tools-owner@example.com'")) run("INSERT INTO staff(email, name, role_id, status) VALUES('tools-owner@example.com', 'Tools owner', ?, 'active')", owner.id);
    const h = ip(); const c = await call('va', 'POST', '/api/admin/auth/code', { email: 'tools-owner@example.com' }, h);
    assert.equal((await call('va', 'POST', '/api/admin/auth/verify', { email: 'tools-owner@example.com', code: c.data.dev_code }, h)).status, 200);
  }
  await signup('vt_t', 'tools-trial@example.com');
  await signup('vt_s', 'tools-starter@example.com'); await buyPlan('vt_s', 'starter');
  await signup('vt_p', 'tools-pro@example.com'); await buyPlan('vt_p', 'pro');
  await signup('vt_o', 'tools-other@example.com'); await buyPlan('vt_o', 'pro');
  await call('va', 'PUT', '/api/admin/settings/limits', { value: { max_concurrent_jobs: 20, daily_credit_cap: 0 } });

  await step('Tools: three new video types with providers, prices and plan limits', async () => {
    const vs = (await call('vt_s', 'GET', '/api/video-types')).data.video_types;
    const by = (id) => vs.find((t) => t.id === id);
    for (const id of ['bg_swap', 'auto_edit', 'brand_music']) assert.ok(by(id) && !by(id).locked, id);
    assert.equal(by('bg_swap').credits_per_unit, 3); assert.equal(by('bg_swap').max_seconds, 30);
    assert.equal(by('auto_edit').credits_per_unit, 2); assert.deepEqual(by('auto_edit').addons, ['music']);
    const tvs = (await call('vt_t', 'GET', '/api/video-types')).data.video_types;
    assert.ok(tvs.filter((t) => ['bg_swap', 'auto_edit', 'brand_music'].includes(t.id)).every((t) => t.locked), 'locked on the trial');
    const rows = (await call('va', 'GET', '/api/admin/providers')).data.providers;
    const veed = rows.find((p) => p.kind === 'matting');
    assert.ok(veed && /veed\/video-background-removal\/fast/.test(veed.model) && /checked 4 Oct 2026/.test(veed.notes) && veed.cost_unit === 'per 30 frames');
    assert.ok(rows.some((p) => p.kind === 'stt' && p.adapter === 'elevenlabs') && rows.some((p) => p.kind === 'stt' && p.model === 'fal-ai/whisper'));
    const sub = rows.find((p) => p.kind === 'autoedit');
    assert.ok(sub && !sub.enabled && /Submagic/.test(sub.name) && /\$69\/month for 100 videos/.test(sub.notes), 'Submagic preset off by default');
    assert.ok(rows.some((p) => p.model === 'fal-ai/elevenlabs/music' && !p.enabled));
  });

  await step('Tools: profit guard keeps 60%+ at every length (60 fps, AI extras, AI music, 30% code, pricey fallbacks on)', async () => {
    const credits = require('./credits');
    const guard = require('./guard');
    const sweep = (label, listOk = false) => {
      const cases = [];
      for (let s = 1; s <= 120; s += 7) for (const bg of ['color', 'image', 'ai', 'stock']) cases.push({ video_type: 'bg_swap', duration: s, bg_kind: bg });
      for (let s = 1; s <= 300; s += 13) for (const m of [undefined, { enabled: true, source: 'ai' }, { enabled: true, source: 'library' }]) cases.push({ video_type: 'auto_edit', duration: s, music: m });
      for (const s of [5, 15, 30, 45, 60, 90, 120]) cases.push({ video_type: 'brand_music', duration: s });
      for (const input of cases) {
        const q = credits.quoteFull('video_type', input, null);
        assert.ok(q.margin_pct >= guard.minMarginPct() - 1e-6, `${label}: ${JSON.stringify(input)} → ${q.credits} cr, cost $${q.provider_cost_usd}, margin ${q.margin_pct}%`);
        if (listOk) assert.ok(!q.adjusted, `${label}: list price ${q.base_credits} is below the guard for ${JSON.stringify(input)}`);
      }
      return cases.length;
    };
    assert.ok(sweep('list prices', true) > 140);
    // Exact list prices from the spec.
    const c = (input) => credits.quoteFull('video_type', input, null);
    assert.equal(c({ video_type: 'bg_swap', duration: 5 }).credits, 30, 'min 10s at 3 cr/s');
    assert.equal(c({ video_type: 'bg_swap', duration: 20, bg_kind: 'ai' }).credits, 64, '20s × 3 + 4 for the AI background');
    assert.equal(c({ video_type: 'brand_music', duration: 30 }).credits, 60);
    assert.equal(c({ video_type: 'brand_music', duration: 120 }).credits, 125); // 110 before payment fees were counted (Phase 2 fee buffer)
    assert.equal(c({ video_type: 'auto_edit', duration: 10 }).credits, 30, 'minimum 30 credits');
    assert.equal(c({ video_type: 'auto_edit', duration: 100 }).credits, 200);
    const q60 = c({ video_type: 'bg_swap', duration: 60 });
    assert.ok(Math.abs(q60.provider_cost_usd - (60 * 0.024 + 60 * 0.0005) * (1 + require('./watchdog').failBuffer('bg_swap'))) < 1e-6, /* + the failure buffer, 5% by default */ 'matting priced at 60 fps: $0.024/s ' + q60.provider_cost_usd);
    // Worst case: 30% code on, and the pricier fal music alternative switched on.
    assert.equal((await call('va', 'POST', '/api/admin/discounts', { code: 'TOOLS30', percent: 30, applies_to: 'first_month' })).status, 200);
    const rows = (await call('va', 'GET', '/api/admin/providers')).data.providers;
    const falMusic = rows.find((p) => p.model === 'fal-ai/elevenlabs/music');
    sweep('30% code', true);
    await call('va', 'PUT', '/api/admin/providers/' + falMusic.id, { enabled: true });
    try {
      // fal bills whole minutes: with it switched on, short AI-music jobs are priced up by the guard (never sold at a loss).
      sweep('30% code + fal music on');
      const q15 = c({ video_type: 'brand_music', duration: 15 });
      assert.ok(Math.abs(q15.provider_cost_usd - 0.6 * (1 + require('./watchdog').failBuffer('brand_music'))) < 1e-6, 'fal rounds 15s up to a full minute: ' + q15.provider_cost_usd);
      const m = (await call('va', 'GET', '/api/admin/margins')).data;
      const worst = m.rows.filter((r) => r.kind === 'video_type_worst');
      assert.ok(worst.length >= 6, 'worst-case rows in Admin → Profit guard');
    } finally {
      await call('va', 'PUT', '/api/admin/providers/' + falMusic.id, { enabled: false });
      await call('va', 'DELETE', '/api/admin/discounts/TOOLS30');
    }
  });

  await step('Tools: edit plan from the AI is validated (out of range, reversed, NaN, overlapping, too much, bad hook)', async () => {
    const ek = require('./editkit');
    const words = ek.cleanWords([{ text: 'Hello', start: 0.5, end: 0.9 }, { text: 'um', start: 1.0, end: 1.3 }, { text: 'this', start: 1.4, end: 1.7 }, { text: 'works', start: 1.75, end: 2.2 }, { text: 'great', start: 5.0, end: 5.4 }, { text: 'buy', start: 5.5, end: 5.8 }, { text: 'now', start: 5.85, end: 6.2 }, { text: 'bad', start: 'x', end: 2 }, { text: 'neg', start: -3, end: -1 }], 8);
    assert.equal(words.length, 7, 'invalid words dropped');
    const p = ek.validatePlan({ remove: [{ start: -5, end: 0.4 }, { start: 1.5, end: 1.2 }, { start: 'NaN', end: 3 }, { start: 3, end: 4 }, { start: 3.5, end: 4.5 }, { start: 9, end: 12 }, { start: 1.6, end: 1.8 }], hook: { start: 5.0, end: 6.2 }, emphasis: [1.8, 99, -1, 'x'] }, { duration: 8, words });
    assert.deepEqual(p.removals.map((r) => [r.start, r.end]), [[0, 0.4], [1.4, 2.2], [3, 4.5]], 'clamped, merged, snapped to words: ' + JSON.stringify(p.removals));
    assert.deepEqual(p.hook, { start: 5, end: 6.2 });
    assert.deepEqual(p.emphasis, [1.8]);
    assert.ok(p.notes.length >= 3);
    const greedy = ek.validatePlan({ remove: [{ start: 0, end: 3.9 }, { start: 4, end: 7.9 }] }, { duration: 8, words });
    assert.equal(greedy.removals.length, 0, 'AI cuts removing > 70% are ignored');
    for (const junk of [null, 'cut everything', [1, 2], { remove: 'all' }, { hook: { start: 0, end: 30 } }]) {
      const v = ek.validatePlan(junk, { duration: 8, words });
      assert.ok(Array.isArray(v.removals) && v.hook === null, 'junk plan ' + JSON.stringify(junk));
    }
    const segs = ek.cutList({ duration: 8, words, plan: p, removeSilences: true, hookFirst: true });
    assert.ok(segs[0].hook && segs[0].start === 5, 'hook first');
    for (let k = 0; k < segs.length; k++) { assert.ok(segs[k].end > segs[k].start && segs[k].start >= 0 && segs[k].end <= 8); }
    const src = segs.slice().sort((a, b) => a.start - b.start);
    for (let k = 1; k < src.length; k++) assert.ok(src[k].start >= src[k - 1].end - 1e-9, 'no overlapping pieces');
    const all = ek.cutList({ duration: 8, words: [], plan: { removals: [{ start: 0, end: 8 }] }, removeSilences: true });
    assert.deepEqual(all.map((x) => [x.start, x.end]), [[0, 8]], 'never cut everything: keep the video whole');
  });

  await step('Tools: captions and ffmpeg commands never carry user text unescaped', async () => {
    const ek = require('./editkit');
    const evil = [{ text: '{\\fs200\\c&H0000FF&}HACK', start: 0, end: 0.5 }, { text: "it's:a,b;[x]drawtext=text=pwn", start: 0.6, end: 1 }, { text: 'line\nbreak\\N', start: 1.1, end: 1.5 }];
    const words = ek.cleanWords(evil, 5);
    const ass = ek.buildAss(words, { style: 'bold', brandColor: '#FF4A1C' });
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.ok(events.length >= 3);
    for (const e of events) {
      const text = e.split(',').slice(9).join(',');
      const userTags = text.replace(/\{\\fscx112\\fscy112\\t\(0,90,\\fscx100\\fscy100\)\}/g, '').replace(/\{\\c&H00[0-9A-F]{6}&\}/g, '');
      assert.ok(!/[{}]/.test(userTags), 'no override tags from user text: ' + text);
      assert.ok(!/\n/.test(e) && !/\\N/.test(userTags), 'no line breaks from user text');
    }
    assert.ok(/HACK/.test(ass) && !/\\fs200/.test(ass), 'text kept, tags removed');
    assert.equal(ek.escFilterPath("/tmp/a'b:c/x.ass"), "'/tmp/a'\\''b\\:c/x.ass'");
    // Brand music prompts may not imitate artists.
    const u = 'vt_p';
    for (const bad of ['in the style of Drake', 'sounds like Burna Boy', 'a cover of Thriller']) {
      const r = await call(u, 'POST', '/api/jobs', { type: 'video_type', video_type: 'brand_music', product: 'Glow serum launch ' + bad, duration: 30 });
      assert.equal(r.status, 400, bad);
    }
  });

  await step('Mail: automatic marketing emails skip addresses on the bounce/complaint list', async () => {
    const { get, run } = require('./db');
    const email = require('./email');
    const store = require('./mail/store');
    const u = get("SELECT * FROM users WHERE email = 'tools-starter@example.com'");
    run('UPDATE users SET marketing_opt_in = 1 WHERE id = ?', u.id);
    store.suppress(u.email, 'complaint', 'check');
    email.queue('winback_day14', u.email, { name: 'Tools' }, { userId: u.id });
    let row = null;
    for (let k = 0; k < 20 && !(row && row.sent_at); k++) { await email.processQueue(); row = get("SELECT * FROM email_queue WHERE user_id = ? AND template = 'winback_day14' ORDER BY id DESC LIMIT 1", u.id); if (!row.sent_at) await wait(300); }
    assert.equal(row.error, 'suppressed', JSON.stringify(row));
    run('DELETE FROM mail_suppress WHERE email = ?', u.email);
    email.queue('winback_day14', u.email, { name: 'Tools' }, { userId: u.id });
    for (let k = 0; k < 20; k++) { await email.processQueue(); row = get("SELECT * FROM email_queue WHERE user_id = ? AND template = 'winback_day14' ORDER BY id DESC LIMIT 1", u.id); if (row.sent_at) break; await wait(300); }
    assert.ok(row.sent_at && row.error !== 'suppressed', 'sent again once removed from the list: ' + row.error);
  });

  if (!ffmpeg) { await step('Tools: ffmpeg not installed, skipped upload and render checks', async () => {}); fs.rmSync(dir, { recursive: true, force: true }); return; }

  let up1 = null;
  await step('Tools: uploads are checked by magic bytes, ffprobe length, plan, size and quota', async () => {
    const fake = path.join(dir, 'fake.mp4');
    fs.writeFileSync(fake, Buffer.concat([Buffer.from('<?php system($_GET[1]); ?>'), Buffer.alloc(4000, 32)]));
    assert.equal((await upload('vt_s', fake, 'bg_swap')).status, 400, 'bad magic bytes');
    const ftyp = path.join(dir, 'ftyp.mp4');
    fs.writeFileSync(ftyp, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(5000, 7)]));
    const r0 = await upload('vt_s', ftyp, 'bg_swap');
    assert.equal(r0.status, 400, 'right magic, not a real video'); assert.match(r0.data.error, /could not be read|not a real/i);
    assert.equal((await upload('vt_s', green, 'bg_swap', 'image/png')).status, 400, 'wrong type');
    assert.equal((await upload('vt_t', green, 'bg_swap')).status, 402, 'trial cannot upload');
    const tooLong = await upload('vt_s', long, 'bg_swap');
    assert.equal(tooLong.status, 400); assert.match(tooLong.data.error, /130s long.*up to 2 minutes/);
    assert.equal((await upload('vt_s', long, 'auto_edit')).status, 200, '130s is fine for auto-edit (5 min)');
    const ok = await upload('vt_s', green, 'bg_swap', 'video/mp4', 'green "test".mp4');
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    up1 = ok.data.upload;
    assert.ok(Math.abs(up1.duration - 12) < 0.2 && up1.width === 480 && up1.has_audio && up1.fps === 30, JSON.stringify(up1));
    // Signed links: good → 200, tampered/expired → 404, never under /media.
    const link = up1.preview_url;
    assert.match(link, /^\/u\/[\w-]+\.mp4\?e=\d+&s=[0-9a-f]{32}$/);
    assert.equal((await call('x', 'GET', link)).status, 200);
    const bad = link.slice(0, -1) + (link.slice(-1) === 'a' ? 'b' : 'a');
    assert.equal((await call('x', 'GET', bad)).status, 404, 'tampered');
    assert.equal((await call('x', 'GET', link.replace(/\/u\/[\w-]+/, '/u/AAAAAAAAAAAA'))).status, 404, 'another id with this signature');
    const exp = require('./uploads');
    const old = `/u/${up1.id}.mp4?e=1000000000&s=${require('./lib/util').hmac('sha256', require('./config').appSecret, 'upload:' + up1.id + ':1000000000').slice(0, 32)}`;
    assert.equal((await call('x', 'GET', old)).status, 404, 'expired');
    assert.ok(!fs.existsSync(path.join(require('./media').DIR, path.basename(exp.byId(up1.id).file))), 'not in public media');
    // Quota.
    await call('va', 'PUT', '/api/admin/settings/limits', { value: { upload_quota_mb: 1 } });
    assert.ok(fs.statSync(big).size > 1.2e6, 'test file is over 1 MB');
    const q = await upload('vt_p', big, 'auto_edit');
    assert.equal(q.status, 413, 'quota enforced: ' + JSON.stringify(q.data)); assert.match(q.data.error, /upload space is full/);
    await call('va', 'PUT', '/api/admin/settings/limits', { value: { upload_quota_mb: 2000 } });
    const list = (await call('vt_s', 'GET', '/api/uploads')).data;
    assert.ok(list.uploads.length >= 2 && list.quota_mb === 2000 && list.keep_days === 7);
  });

  await step('Tools: plan limits and ownership: another customer\'s upload or a too-long video is refused', async () => {
    assert.equal((await call('vt_o', 'POST', '/api/jobs', { type: 'video_type', video_type: 'bg_swap', upload_id: up1.id, bg_kind: 'color' })).status, 400, 'not your upload');
    const m = await upload('vt_s', mid, 'bg_swap');
    assert.equal(m.status, 200);
    const r = await call('vt_s', 'POST', '/api/jobs', { type: 'video_type', video_type: 'bg_swap', upload_id: m.data.upload.id, bg_kind: 'color' });
    assert.equal(r.status, 402, 'starter takes 30s for background change'); assert.match(r.data.error, /up to 30s/);
    // The quote uses the real upload length, not what the browser says.
    const qq = await call('vt_s', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'bg_swap', upload_id: up1.id, duration: 1, bg_kind: 'color' } });
    assert.equal(qq.data.credits, 36, '12s × 3');
    const other = await call('vt_o', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'bg_swap', upload_id: up1.id, duration: 10 } });
    assert.equal(other.data.credits, 30, 'someone else\'s upload id is ignored');
  });

  await step('Tools: Change background runs for real (demo matting = ffmpeg colour key) on colour, image and AI backgrounds', async () => {
    const before = await balance('vt_s');
    const r = await call('vt_s', 'POST', '/api/jobs', { type: 'video_type', video_type: 'bg_swap', upload_id: up1.id, bg_kind: 'color', bg_color: '#FF4A1C', aspect: '9:16' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.job.credits, 36);
    assert.equal(before - (await balance('vt_s')), 36);
    const j = await waitJob('vt_s', r.data.job.id);
    assert.equal(j.status, 'done', j.error);
    const f = require('./media').filePath(j.output.url.replace('/media/', ''));
    const pr = require('./uploads').probe(f);
    assert.ok(pr.ok && pr.width === 1080 && pr.height === 1920 && pr.has_audio && Math.abs(pr.duration - 12) < 0.3, JSON.stringify(pr));
    // The person (test card) stays, the green is gone: sample the corner (background) and the centre-bottom (foreground).
    const px = spawnSync('ffmpeg', ['-v', 'error', '-ss', '3', '-i', f, '-frames:v', '1', '-vf', 'crop=4:4:20:20,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout;
    assert.ok(px[0] > 200 && px[1] < 140 && px[2] < 90, 'corner shows the new orange background, not green: ' + [...px]);
    const r2 = await call('vt_s', 'POST', '/api/jobs', { type: 'video_type', video_type: 'bg_swap', upload_id: up1.id, bg_kind: 'ai', bg_prompt: 'bright modern kitchen', aspect: 'original' });
    assert.equal(r2.data.job.credits, 40, '+4 for the AI background');
    const j2 = await waitJob('vt_s', r2.data.job.id);
    assert.equal(j2.status, 'done', j2.error); assert.ok(j2.output.background.ai);
    const p2 = require('./uploads').probe(require('./media').filePath(j2.output.url.replace('/media/', '')));
    assert.ok(p2.width === 480 && p2.height === 270, 'original shape kept: ' + p2.width + 'x' + p2.height);
    assert.equal(j2.output.aspect, 'original');
  });

  let trackId = null;
  await step('Tools: Brand music makes a track in "My brand tracks"; reuse is free and owner-only', async () => {
    const r = await call('vt_p', 'POST', '/api/jobs', { type: 'video_type', video_type: 'brand_music', product: 'Glowlab vitamin C serum launch, bright and fresh', brand_name: 'Glowlab', vocals: true, lyrics: 'Glow up with Glowlab', mood: 'upbeat', genre: 'afrobeats pop', duration: 30 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.job.credits, 60);
    const j = await waitJob('vt_p', r.data.job.id);
    assert.equal(j.status, 'done', j.error);
    assert.ok(j.output.audio_url && j.output.track_id && j.output.vocals && /paid ads/.test(j.output.licence));
    trackId = j.output.track_id;
    const tracks = (await call('vt_p', 'GET', '/api/brand-tracks')).data.tracks;
    assert.ok(tracks.some((t) => t.id === trackId && t.seconds === 30));
    assert.equal((await call('vt_o', 'GET', '/api/brand-tracks')).data.tracks.length, 0, 'other users see none');
    // Reuse: free on any video with music, only for the owner.
    const q = await call('vt_p', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'ugc_talking', duration: 15, script: 'Hi', music: { enabled: true, source: 'brand', track_id: trackId } } });
    const line = q.data.addons.find((a) => a.id === 'music');
    assert.ok(line && line.credits === 0 && line.source === 'brand', JSON.stringify(q.data.addons));
    const base = await call('vt_p', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'ugc_talking', duration: 15, script: 'Hi' } });
    assert.equal(q.data.credits, base.data.credits, 'brand track adds nothing');
    const steal = await call('vt_o', 'POST', '/api/jobs', { type: 'video_type', video_type: 'ugc_talking', product: 'Serum', script: 'Hello there', duration: 10, music: { enabled: true, source: 'brand', track_id: trackId } });
    assert.equal(steal.status, 400, 'someone else\'s track is refused');
    assert.equal((await call('vt_o', 'DELETE', '/api/brand-tracks/' + trackId)).status, 404);
  });

  await step('Tools: Auto-edit runs for real: cuts, hook first, burnt-in captions, brand-track music bed, end card, SRT', async () => {
    const up = await upload('vt_p', green, 'auto_edit', 'video/mp4', 'raw take.mp4');
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const before = await balance('vt_p');
    const r = await call('vt_p', 'POST', '/api/jobs', { type: 'video_type', video_type: 'auto_edit', upload_id: up.data.upload.id, aspect: '9:16', caption_style: 'boxed', remove_silences: true, hook_first: true, end_card: true, cta: 'Shop: 20% off', music: { enabled: true, source: 'brand', track_id: trackId } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.job.credits, 30, '12s raw = 24 → minimum 30, brand music free');
    assert.equal(before - (await balance('vt_p')), 30);
    const j = await waitJob('vt_p', r.data.job.id, 200);
    assert.equal(j.status, 'done', j.error);
    const o = j.output;
    assert.ok(o.url && o.captions_url && o.removed_seconds > 0.5 && o.hook_first && o.captioned && o.music_url, JSON.stringify(o).slice(0, 400));
    const f = require('./media').filePath(o.url.replace('/media/', ''));
    const pr = require('./uploads').probe(f);
    assert.ok(pr.ok && pr.width === 1080 && pr.height === 1920 && pr.has_audio, JSON.stringify(pr));
    assert.ok(pr.duration < 12 + 2.5 && pr.duration > 3, 'shorter than raw + end card: ' + pr.duration);
    const srt = fs.readFileSync(require('./media').filePath(o.captions_url.replace('/media/', '')), 'utf8');
    assert.match(srt, /^1\n00:00:0\d,\d{3} --> /);
    // Loudness normalised to about -14 LUFS.
    const lufs = String(spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'ebur128', '-f', 'null', '-']).stderr).match(/I:\s+(-?[\d.]+) LUFS\s+Threshold/g);
    const I = Number(String(lufs && lufs[lufs.length - 1]).match(/-?[\d.]+/)[0]);
    assert.ok(I > -16.5 && I < -11.5, 'integrated loudness ' + I);
  });

  await step('Tools: failed tool jobs refund every credit (upload deleted before the render)', async () => {
    const up = await upload('vt_p', green, 'bg_swap');
    const before = await balance('vt_p');
    const r = await call('vt_p', 'POST', '/api/jobs', { type: 'video_type', video_type: 'bg_swap', upload_id: up.data.upload.id, bg_kind: 'color' });
    assert.equal(r.status, 200);
    require('./uploads').remove(require('./uploads').byId(up.data.upload.id));
    const j = await waitJob('vt_p', r.data.job.id);
    assert.equal(j.status, 'failed'); assert.match(j.error, /no longer stored|Upload it again/);
    assert.equal(await balance('vt_p'), before, 'refunded');
    const up2 = await upload('vt_p', green, 'auto_edit');
    const b2 = await balance('vt_p');
    const r2 = await call('vt_p', 'POST', '/api/jobs', { type: 'video_type', video_type: 'auto_edit', upload_id: up2.data.upload.id });
    fs.unlinkSync(require('./uploads').filePath(require('./uploads').byId(up2.data.upload.id)));
    const j2 = await waitJob('vt_p', r2.data.job.id);
    assert.equal(j2.status, 'failed');
    assert.equal(await balance('vt_p'), b2, 'auto-edit refunded');
  });

  await step('Tools: old uploads are cleaned up after the keep period', async () => {
    const { run } = require('./db');
    const uploads = require('./uploads');
    const up = await upload('vt_s', green, 'bg_swap');
    const file = uploads.filePath(uploads.byId(up.data.upload.id));
    run("UPDATE user_uploads SET created_at = datetime('now', '-30 days') WHERE id = ?", up.data.upload.id);
    assert.ok(uploads.cleanup() >= 1);
    assert.ok(!fs.existsSync(file) && !uploads.byId(up.data.upload.id));
  });
  fs.rmSync(dir, { recursive: true, force: true });
};
