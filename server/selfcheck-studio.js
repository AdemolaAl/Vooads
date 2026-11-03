// Self-checks for Backend B: video types, long videos (segments), loss guard, abuse limits, AI brain, training.
// Called from selfcheck.js with its helpers. Uses the demo provider (no keys) and an admin session in jar 'a'.
const assert = require('node:assert');

module.exports = async function studioChecks({ call, step, wait }) {
  let ipN = 0;
  const ip = () => ({ 'x-forwarded-for': '10.9.0.' + (++ipN) });
  async function signup(jar, email) {
    const h = ip();
    const c = await call(jar, 'POST', '/api/auth/code', { email }, h);
    const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, name: 'Check', country: 'GB' }, h);
    assert.equal(v.status, 200, JSON.stringify(v.data));
    return v.data.user;
  }
  async function buyPlan(jar, planId) {
    const r = await call(jar, 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: planId, period: 'month', method_id: 0 });
    assert.ok(r.data.url, JSON.stringify(r.data));
    await call(jar, 'GET', new URL(r.data.url).pathname);
    const me = await call(jar, 'GET', '/api/me');
    assert.equal(me.data.user.plan.id, planId);
  }
  async function waitJob(jar, id, secs = 90) {
    for (let k = 0; k < secs * 2; k++) {
      const r = await call(jar, 'GET', '/api/jobs/' + id);
      if (['done', 'failed'].includes(r.data.job.status)) return r.data.job;
      await wait(500);
    }
    throw new Error('job ' + id + ' did not finish');
  }
  const setLimits = (value) => call('a', 'PUT', '/api/admin/settings/limits', { value });

  let types = [];
  await step('Studio: admin can set abuse limits', async () => {
    const r = await setLimits({ max_concurrent_jobs: 10, max_signups_per_ip_per_day: 50, trial_max_jobs_per_day: 10 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const s = await call('a', 'GET', '/api/admin/settings');
    assert.equal(s.data.limits.max_concurrent_jobs, 10);
  });

  await step('Studio: /api/video-types lists every type, all locked on the free trial', async () => {
    await signup('tv', 'trialvideo@example.com');
    const r = await call('tv', 'GET', '/api/video-types');
    assert.equal(r.status, 200);
    types = r.data.video_types;
    for (const p of ['ugc', 'video', 'image_to_video', 'slideshow', 'dub', 'hook_remix']) assert.ok(types.some((t) => t.pipeline === p), 'missing pipeline ' + p);
    for (const t of types) { assert.ok(t.locked && t.locked_reason, t.id + ' should be locked'); assert.ok(t.credits_per_unit > 0 && t.unit && t.fields); }
  });

  await step('Studio: trial user cannot create any video type', async () => {
    for (const t of types) {
      const r = await call('tv', 'POST', '/api/jobs', { type: 'video_type', video_type: t.id, product: 'serum', script: 'Hello there', duration: t.min_seconds || 5, image_url: '/samples/creator-3.png', video_url: 'https://example.com/ad.mp4', language: 'es' });
      assert.equal(r.status, 402, t.id + ' ' + JSON.stringify(r.data));
    }
    assert.equal((await call('tv', 'POST', '/api/jobs', { type: 'ugc', product: 'serum', script: 'hi' })).status, 402);
  });

  await step('Studio: angles job (AI brain) returns 10 angles with hook and why', async () => {
    const r = await call('tv', 'POST', '/api/jobs', { type: 'angles', product: 'vitamin C serum for dull skin' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const j = await waitJob('tv', r.data.job.id, 20);
    assert.equal(j.status, 'done', j.error);
    assert.equal(j.output.angles.length, 10);
    for (const a of j.output.angles) assert.ok(a.angle && a.hook && a.why);
  });

  await step('Studio: trial daily job limit is enforced', async () => {
    await setLimits({ trial_max_jobs_per_day: 1 });
    const r = await call('tv', 'POST', '/api/jobs', { type: 'hooks', product: 'serum' });
    assert.equal(r.status, 429, JSON.stringify(r.data));
    await setLimits({ trial_max_jobs_per_day: 10 });
  });

  await step('Studio: 60s UGC is refused on a 30s-max plan (Starter)', async () => {
    await signup('st', 'starterplan@example.com');
    await buyPlan('st', 'starter');
    const ugc = (await call('st', 'GET', '/api/video-types')).data.video_types.find((t) => t.pipeline === 'ugc');
    assert.ok(!ugc.locked && ugc.max_seconds > 0 && ugc.max_seconds < 60, 'starter max ' + ugc.max_seconds);
    const r = await call('st', 'POST', '/api/jobs', { type: 'video_type', video_type: ugc.id, product: 'serum', script: 'Hello there', duration: 60 });
    assert.equal(r.status, 402, JSON.stringify(r.data));
    assert.equal(r.data.max_seconds, ugc.max_seconds);
  });

  let pro;
  const jobsToWait = [];
  await step('Studio: 60s UGC on Pro is accepted and split into segments', async () => {
    await signup('pr', 'proplan@example.com');
    await buyPlan('pr', 'pro');
    pro = (await call('pr', 'GET', '/api/video-types')).data.video_types;
    const ugc = pro.find((t) => t.pipeline === 'ugc');
    assert.ok(ugc.max_seconds >= 60, 'pro max ' + ugc.max_seconds);
    const expect = ugc.segment_seconds ? Math.ceil(60 / ugc.segment_seconds) : 1;
    const q = await call('pr', 'POST', '/api/quote', { type: 'video_type', input: { video_type: ugc.id, duration: 60 } });
    assert.equal(q.data.segments, expect); assert.equal(q.data.seconds, 60); assert.equal(q.data.adjusted, false);
    const script = Array.from({ length: 14 }, (_, k) => `This is sentence number ${k + 1} about the serum.`).join(' ');
    const r = await call('pr', 'POST', '/api/jobs', { type: 'video_type', video_type: ugc.id, product: 'vitamin C serum', script, duration: 60, presenter: 'p1' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.job.segments, expect);
    assert.equal(r.data.job.credits, q.data.credits);
    jobsToWait.push(['ugc 60s', r.data.job.id, (j) => { assert.ok(j.output.url && j.output.captions_url); if (expect > 1) assert.equal(j.output.segments.length, expect); }]);
  });

  await step('Studio: every new pipeline starts in demo mode', async () => {
    const t = (p) => pro.find((x) => x.pipeline === p);
    const start = async (name, body, check) => {
      const r = await call('pr', 'POST', '/api/jobs', { type: 'video_type', ...body });
      assert.equal(r.status, 200, name + ' ' + JSON.stringify(r.data));
      jobsToWait.push([name, r.data.job.id, check]);
    };
    await start('product video', { video_type: t('video').id, product: 'white sneakers', style: 'unboxing', duration: 5 }, (j) => assert.ok(j.output.url));
    await start('image to video', { video_type: t('image_to_video').id, product: 'white sneakers', image_url: process.env.APP_URL + '/samples/creator-4.png', duration: 5 }, (j) => assert.ok(j.output.url));
    await start('slideshow', { video_type: t('slideshow').id, product: 'meal prep app', duration: Math.max(10, t('slideshow').min_seconds), slides: 5 }, (j) => { assert.equal(j.output.slides.length, 5); assert.ok(j.output.audio_url && j.output.captions_url); for (const s of j.output.slides) assert.ok(s.text && s.image_url); });
    await start('dub', { video_type: t('dub').id, video_url: 'https://example.com/ad.mp4', script: 'I tried this serum for two weeks and my skin feels great. Tap the link.', language: 'es', duration: Math.max(10, t('dub').min_seconds) }, (j) => { assert.ok(j.output.url && j.output.audio_url && j.output.script_translated); assert.equal(j.output.language, 'es'); });
    await start('hook remix', { video_type: t('hook_remix').id, product: 'vitamin C serum', count: 3, duration: 4 }, (j) => { assert.equal(j.output.hooks.length, 3); for (const h of j.output.hooks) assert.ok(h.text && h.url); });
  });

  await step('Studio: all demo pipelines complete (ugc 60s, video, image_to_video, slideshow, dub, hook_remix)', async () => {
    for (const [name, id, check] of jobsToWait) {
      const j = await waitJob('pr', id, 150);
      assert.equal(j.status, 'done', name + ': ' + j.error);
      check(j);
    }
  });

  await step('Studio: concurrent job limit is enforced', async () => {
    await setLimits({ max_concurrent_jobs: 2 });
    const v = pro.find((x) => x.pipeline === 'video');
    const ids = [];
    for (let k = 0; k < 2; k++) {
      const r = await call('pr', 'POST', '/api/jobs', { type: 'video_type', video_type: v.id, product: 'mug', duration: 5 });
      assert.equal(r.status, 200, JSON.stringify(r.data)); ids.push(r.data.job.id);
    }
    const third = await call('pr', 'POST', '/api/jobs', { type: 'video_type', video_type: v.id, product: 'mug', duration: 5 });
    assert.equal(third.status, 429, JSON.stringify(third.data));
    await setLimits({ max_concurrent_jobs: 10 });
    for (const id of ids) await waitJob('pr', id, 60);
  });

  await step('Loss guard raises credits when a provider gets expensive (margin stays above minimum)', async () => {
    const list = (await call('a', 'GET', '/api/admin/providers')).data.providers;
    const row = list.find((p) => p.kind === 'ugc' && p.is_default);
    const ugc = pro.find((t) => t.pipeline === 'ugc');
    const before = await call('pr', 'POST', '/api/quote', { type: 'video_type', input: { video_type: ugc.id, duration: 15 } });
    assert.equal(before.data.adjusted, false);
    await call('a', 'PUT', '/api/admin/providers/' + row.id, { cost_usd: 25 });
    try {
      const q = await call('pr', 'POST', '/api/quote', { type: 'video_type', input: { video_type: ugc.id, duration: 15 } });
      const m = await call('a', 'GET', '/api/admin/margins');
      assert.equal(q.data.adjusted, true, JSON.stringify(q.data));
      assert.ok(q.data.credits > before.data.credits);
      assert.ok(q.data.margin_pct >= m.data.min_margin_pct, `margin ${q.data.margin_pct} < ${m.data.min_margin_pct}`);
      // the same price is charged when the job is created
      const r = await call('pr', 'POST', '/api/jobs', { type: 'video_type', video_type: ugc.id, product: 'serum', script: 'Hi there, this serum is nice.', duration: 15 });
      if (r.status === 200) { assert.equal(r.data.job.credits, q.data.credits); await waitJob('pr', r.data.job.id, 90); } else assert.equal(r.status, 402);
    } finally {
      await call('a', 'PUT', '/api/admin/providers/' + row.id, { cost_usd: row.cost_usd });
    }
  });

  await step('Admin margins report covers every video type and job type with a status', async () => {
    const m = await call('a', 'GET', '/api/admin/margins');
    assert.equal(m.status, 200);
    assert.ok(m.data.usd_per_credit > 0 && m.data.min_margin_pct >= 0);
    for (const t of types) assert.ok(m.data.rows.some((r) => r.kind === 'video_type' && r.id === t.id), 'no margin row for ' + t.id);
    for (const id of ['ugc', 'video', 'image', 'hooks', 'script', 'angles']) assert.ok(m.data.rows.some((r) => r.kind === 'job' && r.id === id), 'no margin row for ' + id);
    for (const r of m.data.rows) assert.ok(['ok', 'low', 'loss'].includes(r.status) && Number.isFinite(r.margin_pct));
  });

  await step('Signups per IP per day are limited', async () => {
    await setLimits({ max_signups_per_ip_per_day: 1 });
    const h = { 'x-forwarded-for': '10.8.8.8' };
    for (const [jar, email] of [['s1', 'ipone@example.com'], ['s2', 'iptwo@example.com']]) {
      const c = await call(jar, 'POST', '/api/auth/code', { email }, h);
      const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code }, h);
      assert.equal(v.status, email === 'ipone@example.com' ? 200 : 429, email + ' ' + JSON.stringify(v.data));
    }
    await setLimits({ max_signups_per_ip_per_day: 50 });
  });

  await step('AI brain: admin reads and edits it, edits reach the prompts', async () => {
    const g = await call('a', 'GET', '/api/admin/ai-brain');
    assert.equal(g.status, 200);
    assert.ok('playbook' in g.data && 'verticals' in g.data && 'trends' in g.data);
    const p = await call('a', 'PUT', '/api/admin/ai-brain', { trends: '2026-10 check: short POV hooks are working' });
    assert.equal(p.status, 200); assert.equal(p.data.trends.from, 'admin');
    const pv = await call('a', 'POST', '/api/admin/ai-brain/preview', { task: 'hooks', product: 'vitamin C serum' });
    assert.ok(pv.data.system.includes('short POV hooks are working'));
    assert.equal((await call('a', 'PUT', '/api/admin/ai-brain', { verticals: 'not json' })).status, 400);
    await call('a', 'PUT', '/api/admin/ai-brain', { trends: null });
  });

  await step('Training: /api/training returns lessons and audio map; voice in demo mode is a no-op', async () => {
    const r = await call('x', 'GET', '/api/training');
    assert.equal(r.status, 200); assert.ok(Array.isArray(r.data.lessons)); assert.equal(typeof r.data.audio, 'object');
    const v = await call('a', 'POST', '/api/admin/training/voice', {});
    assert.ok([200, 400].includes(v.status));
    if (v.status === 200) assert.equal(v.data.demo, true);
  });

  // ---------- v2.1: animated ads, music, voice tiers, pronunciation (SPEC §12) ----------
  await step('Pronunciation: replace function, admin edit, public config', async () => {
    const pr = require('./pronounce');
    assert.equal(pr.apply('VOOADS is great', pr.DEFAULT), 'Voo-ads is great');
    assert.equal(pr.apply('Try vooads, VooSquare and Zedapex. Not Vooadsy.', pr.DEFAULT), 'Try Voo-ads, Voo-square and Zed-a-pex. Not Vooadsy.');
    const g = await call('a', 'GET', '/api/admin/pronunciations');
    assert.ok(g.data.pronunciations.some((r) => r.word === 'Vooads'));
    const put = await call('a', 'PUT', '/api/admin/pronunciations', { pronunciations: [...g.data.pronunciations, { word: 'Hornex', say: 'Hor-nex' }] });
    assert.equal(put.status, 200);
    assert.equal(pr.forTts('hornex and VOOADS'), 'Hor-nex and Voo-ads');
    const cfg = await call('x', 'GET', '/api/public/config');
    assert.ok(cfg.data.pronunciations.some((r) => r.word === 'Hornex'));
    await call('a', 'PUT', '/api/admin/pronunciations', { pronunciations: g.data.pronunciations });
  });

  await step('Music library: admin uploads, lists and deletes a track', async () => {
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4000, 1)]);
    const up = await call('a', 'POST', '/api/admin/music?mood=chill&name=Check%20track', mp3, { 'Content-Type': 'audio/mpeg' });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    assert.equal(up.data.track.mood, 'chill');
    assert.equal((await call('a', 'POST', '/api/admin/music?mood=nope', mp3, { 'Content-Type': 'audio/mpeg' })).status, 400);
    const list = await call('a', 'GET', '/api/admin/music');
    assert.ok(list.data.tracks.some((t) => t.id === up.data.track.id));
    assert.equal((await call('x', 'GET', up.data.track.url)).status, 200);
    assert.equal((await call('a', 'DELETE', '/api/admin/music/' + up.data.track.id)).status, 200);
    assert.ok(!(await call('a', 'GET', '/api/admin/music')).data.tracks.some((t) => t.id === up.data.track.id));
  });

  await step('Animated ads: trial cannot buy them; both tiers are listed', async () => {
    const types = (await call('tv', 'GET', '/api/video-types')).data;
    const motion = types.video_types.filter((t) => t.pipeline === 'motion_ad');
    assert.ok(motion.some((t) => t.quality === 'ultra') && motion.some((t) => t.quality !== 'ultra'), 'need standard + ultra');
    assert.ok(types.addons && types.addons.music);
    for (const t of motion) {
      const r = await call('tv', 'POST', '/api/jobs', { type: 'video_type', video_type: t.id, product: 'serum', duration: 15 });
      assert.equal(r.status, 402, t.id + ' ' + JSON.stringify(r.data));
    }
  });

  await step('Music add-on raises the quote by the add-on price and the guard still holds', async () => {
    const vt = (await call('pr', 'GET', '/api/video-types')).data;
    const t = vt.video_types.find((x) => x.pipeline === 'motion_ad' && x.quality !== 'ultra');
    const A = vt.addons.music;
    const base = await call('pr', 'POST', '/api/quote', { type: 'video_type', input: { video_type: t.id, duration: 15 } });
    const withMusic = await call('pr', 'POST', '/api/quote', { type: 'video_type', input: { video_type: t.id, duration: 15, music: { enabled: true, mood: 'upbeat', source: 'ai' } } });
    const addon = Math.ceil(A.credits_per_second * Math.max(15, A.min_seconds || 0));
    assert.ok(withMusic.data.addons.some((a) => a.id === 'music' && a.credits === addon), JSON.stringify(withMusic.data.addons));
    assert.equal(withMusic.data.base_credits, base.data.base_credits + addon);
    const m = await call('a', 'GET', '/api/admin/margins');
    assert.ok(withMusic.data.margin_pct >= m.data.min_margin_pct, `margin ${withMusic.data.margin_pct}`);
    assert.ok(m.data.rows.some((r) => r.kind === 'video_type+addons' && r.id === t.id));
    // Ultra voice on the standard tier is charged too.
    const ultra = await call('pr', 'POST', '/api/quote', { type: 'video_type', input: { video_type: t.id, duration: 15, voice_tier: 'ultra' } });
    assert.ok(ultra.data.base_credits > base.data.base_credits && ultra.data.addons.some((a) => a.id === 'voice_ultra'));
  });

  await step('Animated ads (standard + ultra) complete in demo mode', async () => {
    const vt = (await call('pr', 'GET', '/api/video-types')).data.video_types.filter((x) => x.pipeline === 'motion_ad');
    const ids = [];
    for (const t of vt) {
      const r = await call('pr', 'POST', '/api/jobs', { type: 'video_type', video_type: t.id, product: 'Vooads vitamin C serum', duration: 15, aspect: '9:16', style: 'bold', brand_color: '#FF4A1C', cta: 'Shop now', music: { enabled: true, mood: 'upbeat', source: 'library' }, voice_tier: 'ultra' });
      assert.equal(r.status, 200, t.id + ' ' + JSON.stringify(r.data));
      assert.ok(r.data.job.input.music && r.data.job.input.voice_tier === 'ultra');
      ids.push([t, r.data.job.id]);
    }
    for (const [t, id] of ids) {
      const j = await waitJob('pr', id, 120);
      assert.equal(j.status, 'done', t.id + ': ' + j.error);
      assert.ok(j.output.scenes.length >= 4 && j.output.scenes.every((s) => s.headline && s.visual_url), t.id);
      assert.ok(j.output.audio_url && j.output.captions_url && j.output.endcard.cta === 'Shop now');
      assert.ok(j.output.music_url || j.output.music_note);
      assert.equal(j.output.quality, t.quality === 'ultra' ? 'ultra' : 'standard');
    }
  });
};
