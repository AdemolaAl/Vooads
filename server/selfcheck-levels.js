// Self-checks for quality levels (SPEC §13): every enabled level clears the profit guard, levels are checked against the
// plan, jobs are priced on the chosen model, and fallbacks never go to a cheaper model. Called from selfcheck.js.
const assert = require('node:assert');

module.exports = async function levelChecks({ call, step }) {
  let ipN = 0;
  const ip = () => ({ 'x-forwarded-for': '10.13.0.' + (++ipN) });
  async function signup(jar, email) {
    const h = ip();
    const c = await call(jar, 'POST', '/api/auth/code', { email }, h);
    const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, name: 'Levels', country: 'GB' }, h);
    assert.equal(v.status, 200, JSON.stringify(v.data));
  }
  async function buyPlan(jar, planId) {
    const r = await call(jar, 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: planId, period: 'month', method_id: 0 });
    await call(jar, 'GET', new URL(r.data.url).pathname);
    assert.equal((await call(jar, 'GET', '/api/me')).data.user.plan.id, planId);
  }
  const quote = (jar, input) => call(jar, 'POST', '/api/quote', { type: 'video_type', input });
  const providerRows = async () => (await call('a', 'GET', '/api/admin/providers')).data.providers;
  const byTag = (rows, kind, tag) => rows.find((p) => p.kind === kind && p.config && p.config.tag === tag);

  await signup('lv_s', 'levels-starter@example.com'); await buyPlan('lv_s', 'starter');
  await signup('lv_p', 'levels-pro@example.com'); await buyPlan('lv_p', 'pro');
  await signup('lv_x', 'levels-scale@example.com'); await buyPlan('lv_x', 'scale');
  await signup('lv_t', 'levels-trial@example.com');

  await step('Levels: every enabled level clears the profit guard (also with a 30% code active)', async () => {
    const check = async (label) => {
      const m = (await call('a', 'GET', '/api/admin/margins')).data;
      const rows = m.rows.filter((r) => r.kind === 'video_type_level');
      assert.ok(rows.length >= 18, label + ': level rows ' + rows.length);
      for (const r of rows.filter((x) => x.enabled)) {
        assert.equal(r.status, 'ok', `${label}: ${r.name} margin ${r.margin_pct}% (needs ${r.safe_credits_per_unit}/unit)`);
        assert.ok(r.margin_pct >= m.min_margin_pct && r.safe_credits_per_unit <= r.credits_per_unit, r.name);
      }
      return m;
    };
    await check('no code');
    assert.equal((await call('a', 'POST', '/api/admin/discounts', { code: 'LVLWORST30', percent: 30, applies_to: 'first_month' })).status, 200);
    const m = await check('30% code');
    assert.ok(m.usd_per_credit < 0.029, 'worst case per credit ' + m.usd_per_credit);
    await call('a', 'DELETE', '/api/admin/discounts/LVLWORST30');
  });

  await step('Levels: studio lists levels with models; Pro and Ultra are locked on Starter, open on Scale', async () => {
    const vs = (await call('lv_s', 'GET', '/api/video-types')).data.video_types;
    const ugc = vs.find((t) => t.id === 'ugc_talking');
    assert.deepEqual(ugc.levels.map((l) => l.id), ['standard', 'pro', 'ultra']);
    assert.deepEqual(ugc.levels.map((l) => l.model_label), ['Kling Avatar v2', 'OmniHuman 1.5', 'Google Veo 3.1']);
    assert.ok(!ugc.levels[0].locked && ugc.levels[1].locked && ugc.levels[2].locked && ugc.levels[1].min_plan_name === 'Pro');
    const broll = vs.find((t) => t.id === 'product_broll');
    assert.deepEqual(broll.levels.map((l) => l.credits_per_unit), [10, 18, 45]);
    const slides = vs.find((t) => t.id === 'slideshow');
    assert.deepEqual(slides.levels, [], 'types without levels have none');
    const xs = (await call('lv_x', 'GET', '/api/video-types')).data.video_types.find((t) => t.id === 'ugc_talking');
    assert.ok(xs.levels.every((l) => !l.locked));
  });

  await step('Levels: quote follows the level; a level above the plan is refused with an upgrade hint (403)', async () => {
    const base = { video_type: 'ugc_talking', duration: 30, script: 'hi' };
    const std = (await quote('lv_x', base)).data, pro = (await quote('lv_x', { ...base, level: 'pro' })).data, ul = (await quote('lv_x', { ...base, level: 'ultra' })).data;
    assert.equal(std.credits, 450); assert.equal(pro.credits, 660); assert.equal(ul.credits, 1350);
    assert.equal(pro.level, 'pro'); assert.equal(pro.model_label, 'OmniHuman 1.5'); assert.equal(std.level, 'standard');
    const lk = await quote('lv_s', { ...base, level: 'ultra' });
    assert.equal(lk.status, 403); assert.ok(/Scale/.test(lk.data.error) && lk.data.upgrade && lk.data.upgrade.plan_id === 'scale', JSON.stringify(lk.data));
    assert.equal((await quote('lv_t', { ...base, level: 'pro' })).status, 403, 'trial cannot quote Pro');
    assert.equal((await quote('lv_x', { ...base, level: 'diamond' })).status, 400);
    // Types without levels ignore the field (behave as before).
    const sl = { video_type: 'slideshow', duration: 15 };
    assert.equal((await quote('lv_x', sl)).data.credits, (await quote('lv_x', { ...sl, level: 'standard' })).data.credits);
  });

  await step('Levels: jobs are priced on the chosen model (main render cost per level, Veo clip lengths)', async () => {
    const q = async (level, video_type = 'ugc_talking', duration = 15) => (await quote('lv_x', { video_type, duration, script: 'hello there', level })).data;
    assert.equal((await q('standard')).main_cost_usd, 1.725); // 15s × $0.115 (Kling Avatar v2 Pro)
    assert.equal((await q('pro')).main_cost_usd, 2.4); // 15s × $0.16 (OmniHuman 1.5)
    const u = await q('ultra');
    assert.deepEqual(u.clips, [8, 8]); assert.equal(u.segments, 2); assert.equal(u.main_cost_usd, 6.4); // 2 × 8s Veo clips × $0.40
    const b = await q('ultra', 'product_broll', 10);
    assert.deepEqual(b.clips.slice().sort(), [4, 6]); assert.equal(b.main_cost_usd, 4); // cheapest covering Veo clips
    assert.equal((await q('pro', 'product_broll', 15)).main_cost_usd, 2.52); // 15s × $0.168 (Kling 3.0 Pro, audio on)
  });

  await step('Levels: the guard prices the most expensive enabled model of a level, never a cheaper one', async () => {
    const rows = await providerRows();
    const fast = byTag(rows, 'video', 'veo-3.1-fast');
    assert.ok(fast && !fast.enabled && fast.config.level === 'pro', 'Veo 3.1 Fast seeded off as a Pro alternative');
    const before = (await quote('lv_x', { video_type: 'product_broll', duration: 15, level: 'pro' })).data;
    try {
    await call('a', 'PUT', '/api/admin/providers/' + fast.id, { enabled: true }); // cheaper per second ($0.15) same-level fallback
    // Veo Fast bills fixed 4/6/8s clips, so as a fallback it can cost more than Kling 3.0: the guard must never price lower.
    assert.ok((await quote('lv_x', { video_type: 'product_broll', duration: 15, level: 'pro' })).data.main_cost_usd >= before.main_cost_usd, 'never priced below Kling 3.0');
    await call('a', 'PUT', '/api/admin/providers/' + fast.id, { cost_usd: 0.3 }); // now the pricier fallback
    const up = (await quote('lv_x', { video_type: 'product_broll', duration: 16, level: 'pro' })).data;
    assert.ok(up.main_cost_usd >= 16 * 0.3 - 1e-9, 'priced on the pricier fallback ' + up.main_cost_usd);
    assert.ok(up.margin_pct >= 60 && up.credits >= up.base_credits, 'guard keeps the margin ' + up.margin_pct);
    } finally { await call('a', 'PUT', '/api/admin/providers/' + fast.id, { cost_usd: 0.15, enabled: false }); }
  });

  await step('Levels: run-time fallback stays on the same level, then lower levels; never a pricier one', async () => {
    const levels = require('./levels');
    const jobs = require('./jobs');
    const rows = await providerRows();
    const fal = rows.find((p) => p.adapter === 'fal' && p.kind === 'video' && p.config.tag === 'kling-2.5-turbo-pro');
    await call('a', 'PUT', '/api/admin/providers/' + fal.id, { api_key: 'fal_check_key' }); // one fal key runs every fal model
    try {
      const pq = (await quote('lv_x', { video_type: 'product_broll', duration: 15, level: 'pro' })).data;
      const job = (credits, level = 'pro') => ({ id: 0, user_id: 0, credits, input: JSON.stringify({ video_type: 'product_broll', level, level_tag: level === 'pro' ? 'kling-3.0-pro' : '', duration: 15, clips: pq.clips }), state: JSON.stringify({ quote: pq }) });
      const tight = jobs.levelChain(job(pq.credits), 'video');
      assert.ok(tight.length >= 1 && tight.every((r) => levels.RANK[r.config.level] <= levels.RANK.pro), 'pro chain: ' + tight.map((r) => r.name).join(', '));
      assert.equal(tight[0].config.tag, 'kling-3.0-pro');
      const firstLower = tight.findIndex((r) => r.config.level !== 'pro');
      assert.ok(firstLower === -1 || tight.slice(firstLower).every((r) => r.config.level !== 'pro'), 'every pro model is tried before a lower one');
      assert.ok(tight.every((r) => r.apiKey === 'fal_check_key'), 'rows share the fal key');
      const rich = jobs.levelChain(job(pq.credits * 10), 'video');
      assert.ok(!rich.some((r) => r.config.level === 'ultra'), 'never a pricier level, even when the price would cover it');
      const stdChain = jobs.levelChain(job(150, 'standard'), 'video');
      assert.ok(stdChain.length && stdChain.every((r) => r.config.level === 'standard'), 'a standard job never moves up');
      assert.ok(stdChain[0].config.level === 'standard', 'standard jobs start on a standard model');
      // A pro job given ultra, pro and standard rows: pro first, then standard; ultra never.
      const mix = levels.runChain('video', { id: 'pro', provider_tag: 'kling-3.0-pro' }, rich.concat(rows.filter((r) => r.kind === 'video' && r.config.level === 'ultra')), () => true);
      assert.ok(mix.length && !mix.some((r) => r.config.level === 'ultra'), mix.map((r) => r.config.level).join(','));
    } finally {
      await call('a', 'PUT', '/api/admin/providers/' + fal.id, { clear_key: true });
    }
  });

  await step('Levels: a level whose models are all off is hidden and refused', async () => {
    const rows = await providerRows();
    const k3 = byTag(rows, 'video', 'kling-3.0-pro');
    await call('a', 'PUT', '/api/admin/providers/' + k3.id, { enabled: false });
    try {
      const b = (await call('lv_x', 'GET', '/api/video-types')).data.video_types.find((t) => t.id === 'product_broll');
      assert.deepEqual(b.levels.map((l) => l.id), ['standard', 'ultra']);
      const r = await call('lv_x', 'POST', '/api/jobs', { type: 'video_type', video_type: 'product_broll', product: 'sneakers', duration: 5, level: 'pro' });
      assert.equal(r.status, 400, JSON.stringify(r.data));
    } finally { await call('a', 'PUT', '/api/admin/providers/' + k3.id, { enabled: true }); }
  });

  await step('Levels: Starter cannot generate on Pro (403); Pro user generates on Pro and the job keeps level + model', async () => {
    const body = { type: 'video_type', video_type: 'ugc_talking', product: 'vitamin C serum', script: 'I tried this serum for two weeks. My skin looks brighter. Link below.', duration: 10, level: 'pro' };
    const no = await call('lv_s', 'POST', '/api/jobs', body);
    assert.equal(no.status, 403); assert.ok(no.data.upgrade && no.data.min_plan === 'pro');
    const q = (await quote('lv_p', { ...body })).data;
    const before = (await call('lv_p', 'GET', '/api/me')).data.user.balance.total;
    const r = await call('lv_p', 'POST', '/api/jobs', body);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.job.level, 'pro'); assert.equal(r.data.job.model, 'OmniHuman 1.5'); assert.equal(r.data.job.credits, q.credits);
    assert.equal(before - r.data.balance.total, q.credits);
    let j = r.data.job;
    for (let k = 0; k < 120 && !['done', 'failed'].includes(j.status); k++) { await new Promise((ok) => setTimeout(ok, 500)); j = (await call('lv_p', 'GET', '/api/jobs/' + j.id)).data.job; }
    assert.equal(j.status, 'done', j.error); assert.ok(j.output.url); assert.equal(j.level_name, 'Pro realistic');
  });

  await step('Levels: saving pricing raises a level below the minimum margin to the guard\'s safe price', async () => {
    const pr = (await call('a', 'GET', '/api/admin/pricing')).data.pricing;
    const t = pr.video_types.find((x) => x.id === 'product_broll');
    const ul = t.levels.find((l) => l.id === 'ultra');
    const keep = ul.credits_per_unit;
    ul.credits_per_unit = 5;
    const r = await call('a', 'PUT', '/api/admin/pricing', { pricing: pr });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const hit = r.data.raised.find((x) => x.type === 'product_broll' && x.level === 'ultra');
    assert.ok(hit && hit.from === 5 && hit.to > 30, JSON.stringify(r.data.raised));
    assert.equal(r.data.pricing.video_types.find((x) => x.id === 'product_broll').levels.find((l) => l.id === 'ultra').credits_per_unit, hit.to);
    const bad = JSON.parse(JSON.stringify(r.data.pricing));
    bad.video_types.find((x) => x.id === 'product_broll').levels.push({ id: 'ultra', credits_per_unit: 50 });
    assert.equal((await call('a', 'PUT', '/api/admin/pricing', { pricing: bad })).status, 400, 'duplicate level refused');
    const back = r.data.pricing; back.video_types.find((x) => x.id === 'product_broll').levels.find((l) => l.id === 'ultra').credits_per_unit = keep;
    assert.equal((await call('a', 'PUT', '/api/admin/pricing', { pricing: back })).data.raised.length, 0);
  });

  await step('Levels: clip plans and billing (unit)', async () => {
    const L = require('./levels');
    assert.deepEqual(L.clipPlan(15, 10, 'video', null), [10, 5]);
    assert.deepEqual(L.clipPlan(30, 10, 'ugc', null), [10, 10, 10]);
    assert.deepEqual(L.clipPlan(5, 8, 'video', [4, 6, 8]), [6]);
    assert.equal(L.clipPlan(9, 8, 'ugc', [4, 6, 8]).reduce((a, b) => a + b, 0), 10);
    assert.equal(L.billSeconds(5, { config: { clip_durations: [4, 6, 8] } }), 6);
    assert.equal(L.billSeconds(7, { config: {} }), 7);
  });
};
