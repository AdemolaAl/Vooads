// Self-check group "phase2": chat editing (planner with a fake LLM: plans, prices, level guard, unsupported requests,
// questions, confirm, versions, compare, undo), ffmpeg edit operations on generated footage, Street interview and Mad edit
// with the demo providers, the actor library (consent clip, staff approval, celebrity block), the hook factory (10 hooks,
// bulk price, export all), the payment-fee buffer, the stale naira rate and the AI bill (allowance, fee, limits, daily cap,
// alerts, Profit view).
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = async function phase2Checks({ call, step, wait }) {
  const { get, run, all } = require('./db');
  const { sha256, id } = require('./lib/util');
  const stitch = require('./stitch');
  const chatedit = require('./chatedit');
  const credits = require('./credits');
  const guard = require('./guard');
  const llmbill = require('./llmbill');
  const { getSetting, setSetting } = require('./settings');
  let ipN = 0;
  const ip = () => ({ 'x-forwarded-for': '10.52.0.' + (++ipN) });
  async function signup(jar, email) {
    const h = ip();
    const c = await call(jar, 'POST', '/api/auth/code', { email }, h);
    const v = await call(jar, 'POST', '/api/auth/verify', { email, code: c.data.dev_code, name: 'Phase', country: 'GB' }, h);
    assert.equal(v.status, 200, JSON.stringify(v.data));
    return get('SELECT * FROM users WHERE email = ?', email);
  }
  async function buyPlan(jar, planId) {
    const r = await call(jar, 'POST', '/api/billing/checkout', { kind: 'plan', plan_id: planId, period: 'month', method_id: 0 });
    await call(jar, 'GET', new URL(r.data.url).pathname);
  }
  async function waitJob(jar, jid, secs = 120) {
    for (let k = 0; k < secs * 4; k++) {
      const r = await call(jar, 'GET', '/api/jobs/' + jid);
      if (['done', 'failed'].includes(r.data.job.status)) return r.data.job;
      await wait(250);
    }
    throw new Error('job ' + jid + ' did not finish');
  }
  const userRow = (email) => get('SELECT * FROM users WHERE email = ?', email);
  const sessionFor = (email, roleName) => {
    const role = get('SELECT id FROM roles WHERE name = ?', roleName).id;
    run("INSERT OR IGNORE INTO staff(email, name, role_id, status) VALUES(?, ?, ?, 'active')", email, email.split('@')[0], role);
    const sid = id(32);
    run('INSERT INTO sessions(id, staff_id, expires_at) VALUES(?,?,?)', sha256('sess:' + sid), get('SELECT id FROM staff WHERE email = ?', email).id, new Date(Date.now() + 864e5).toISOString());
    return 'va_a=' + sid;
  };
  const OWN = sessionFor('p2owner@example.com', 'Owner');
  const A = (m, u, b) => call('p2own', m, u, b, { Cookie: OWN });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-p2-'));
  const ff = (args) => spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 60000 });

  // ---------- Setup: a Pro customer with a finished UGC video ----------
  const EM = 'chatedit@example.com';
  await signup('ce', EM);
  await buyPlan('ce', 'scale');
  let ugcJob;
  await step('Chat edit: setup, a finished UGC video to edit (demo providers)', async () => {
    const r = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'ugc_talking', product: 'Glow serum', duration: 20, write_script: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    ugcJob = await waitJob('ce', r.data.job.id);
    assert.equal(ugcJob.status, 'done', ugcJob.error);
  });

  // Fake LLM: answers whatever the test puts in `next`, with token usage so the bill has real numbers.
  let next = null;
  const L0 = getSetting('llm');
  setSetting('llm', { ...L0, chat_edit: { ...L0.chat_edit, per_minute: 1000, free_per_day: { ...L0.chat_edit.free_per_day, scale: 3 } } }); // small allowance so the fee is tested; the rate-limit check sets its own
  const fake = async () => ({ text: typeof next === 'string' ? next : JSON.stringify(next), usage: { input_tokens: 2000, output_tokens: 300 }, adapter: 'anthropic', model: 'claude-sonnet-5-5' });
  const plan = (msg) => chatedit.planMessage(userRow(EM), ugcJob.id, msg, { llm: fake });

  await step('Chat edit planner: a valid plan is priced (local ops 0 credits, a re-made scene at the video\'s own level)', async () => {
    next = { type: 'plan', ops: [{ op: 'trim', start: 2, end: 20 }, { op: 'captions', size: 'large', position: 'top' }, { op: 'regenerate_scene', scene: 2, new_actor: true, model: 'veo-3.1', level: 'ultra' }], note: 'Done.' };
    const r = await plan('Cut the first 2 seconds, captions bigger at the top, and re-make scene 2 with a new actor');
    const p = r.message.plan;
    assert.equal(r.message.kind, 'plan', JSON.stringify(r.message));
    assert.equal(p.items[0].credits, 0); assert.equal(p.items[1].credits, 0);
    assert.ok(p.items[2].credits > 0, 'the re-made scene costs credits');
    const ctx = chatedit.context(get('SELECT * FROM jobs WHERE id = ?', ugcJob.id));
    const spec = chatedit.childSpec(p.ops[2], ctx, userRow(EM));
    assert.equal(spec.input.level, ugcJob.input.level || undefined, 'same level as the video, never the one the planner named');
    assert.equal(p.items[2].credits, credits.quoteFull('video_type', spec.input, userRow(EM)).credits, 'priced exactly as the job will charge');
    assert.ok(p.notes.some((n) => /model\/level/.test(n)), 'the planner\'s model pick was dropped');
    assert.match(p.summary, /Keep 2–[\d.]+s: 0 credits · Captions large at the top: 0 credits · Re-make scene 2 with a new actor: \d+ credits/);
  });

  await step('Chat edit planner: unknown ops and junk are refused honestly with the closest option; a question is passed through', async () => {
    next = { type: 'plan', ops: [{ op: 'add_explosions', power: 9000 }, { op: 'run_shell', cmd: 'rm -rf /' }] };
    let r = await plan('add explosions');
    assert.equal(r.message.kind, 'unsupported'); assert.match(r.message.text, /I can cut or re-order/);
    next = 'this is not json at all';
    r = await plan('do something');
    assert.equal(r.message.kind, 'unsupported');
    next = { type: 'question', question: 'Which scene should get the new actor?' };
    r = await plan('new actor please');
    assert.equal(r.message.kind, 'question'); assert.equal(r.message.text, 'Which scene should get the new actor?');
    next = { type: 'plan', ops: [{ op: 'cut', start: 0, end: 20 }, { op: 'regenerate_scene', scene: 40 }, { op: 'translate', language: 'xx' }] };
    r = await plan('cut everything');
    assert.equal(r.message.kind, 'unsupported', 'bad times, a scene that does not exist and an unknown language are all dropped');
  });

  await step('Chat edit planner: demo rule planner understands everyday requests; a celebrity actor is refused', async () => {
    const ctx = chatedit.context(get('SELECT * FROM jobs WHERE id = ?', ugcJob.id));
    const p = chatedit.validate(chatedit.rulePlan('cut the first 2 seconds and make the captions bigger, then 5 new hooks and dub it into Spanish', ctx), ctx);
    assert.deepEqual(p.ops.map((o) => o.op), ['trim', 'captions', 'translate', 'hook_variants']);
    assert.equal(p.ops[1].size, 'large'); assert.equal(p.ops[2].language, 'es'); assert.equal(p.ops[3].count, 5);
    const bad = chatedit.validate({ type: 'plan', ops: [{ op: 'regenerate_scene', scene: 1, actor_desc: 'someone who looks just like Taylor Swift' }] }, ctx);
    assert.equal(bad.type, 'unsupported'); assert.match(bad.message, /real person/);
  });

  let planMsg;
  await step('Chat edit: confirm runs the plan once, makes version 2 with history; compare and undo work', async () => {
    next = { type: 'plan', ops: [{ op: 'trim', start: 2, end: 20 }, { op: 'captions', on: true, size: 'large', position: 'top' }, { op: 'end_card', cta: 'Shop the serum' }] };
    const r = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat`, { message: 'make the captions bigger' }); // demo path (rule planner) also answers
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const p = await plan('Cut the first 2 seconds, captions bigger at the top, end card');
    planMsg = p.message;
    assert.equal(planMsg.plan.total, 0);
    const before = credits.balance(userRow(EM).id).total;
    const c = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${planMsg.id}/confirm`);
    assert.equal(c.status, 200, JSON.stringify(c.data));
    assert.equal((await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${planMsg.id}/confirm`)).status, 409, 'a plan never runs twice');
    const ej = await waitJob('ce', c.data.edit_job_id);
    assert.equal(ej.status, 'done', ej.error);
    assert.equal(credits.balance(userRow(EM).id).total, before, 'local edits cost 0 credits');
    assert.ok(ej.output.url && ej.output.master_url && ej.output.look.captions.size === 'large');
    const len = stitch.probe(require('./media').filePath(ej.output.url.slice(7))).duration;
    const orig = chatedit.context(get('SELECT * FROM jobs WHERE id = ?', ugcJob.id)).duration;
    assert.ok(Math.abs(len - (orig - 2 + 2.5)) < 0.6, `trimmed 2s and added the 2.5s end card: ${len} from ${orig}`);
    const v = (await call('ce', 'GET', `/api/jobs/${ugcJob.id}/versions`)).data;
    assert.equal(v.versions.filter((x) => x.version).length, 2); assert.equal(v.current_job_id, ej.id);
    assert.ok(v.versions[0].url && v.versions[1].url, 'both versions have a video to compare');
    // Second edit on top of version 2: captions restyled from the clean master (never burnt twice).
    next = { type: 'plan', ops: [{ op: 'captions', size: 'small', position: 'bottom' }] };
    const p2 = await plan('captions smaller at the bottom');
    const c2 = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${p2.message.id}/confirm`);
    const ej2 = await waitJob('ce', c2.data.edit_job_id);
    assert.equal(ej2.status, 'done', ej2.error);
    assert.equal(ej2.output.version, 3); assert.equal(ej2.output.master_url, ej.output.master_url, 'same master, new look');
    const u = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/undo`);
    assert.equal(u.data.current_job_id, ej.id, 'undo goes back to version 2');
    await call('ce', 'POST', `/api/jobs/${ugcJob.id}/undo`);
    assert.equal((await call('ce', 'POST', `/api/jobs/${ugcJob.id}/undo`)).status, 400, 'nothing to undo on the original');
    assert.equal((await call('ce', 'POST', `/api/jobs/${ugcJob.id}/versions/${ej2.id}/use`)).data.current_job_id, ej2.id, 'redo = pick a version');
    // A plan made on an older version cannot run on a newer one.
    next = { type: 'plan', ops: [{ op: 'speed', factor: 1.25 }] };
    const p3 = await plan('faster');
    await call('ce', 'POST', `/api/jobs/${ugcJob.id}/versions/${ugcJob.id}/use`);
    assert.equal((await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${p3.message.id}/confirm`)).status, 409);
    assert.equal((await call('other', 'GET', `/api/jobs/${ugcJob.id}/versions`)).status, 401);
  });

  await step('Honesty: "AI-generated" label is a free one-tap edit; Brand kit can add it to every edit; terms say so', async () => {
    const l = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/label`, { on: true });
    assert.equal(l.status, 200, JSON.stringify(l.data));
    assert.equal(l.data.message.plan.total, 0);
    const c = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${l.data.message.id}/confirm`);
    const ej = await waitJob('ce', c.data.edit_job_id);
    assert.equal(ej.status, 'done', ej.error); assert.equal(ej.output.look.ai_label, true);
    await call('ce', 'PUT', '/api/me', { brand: { name: 'Glow', color: '#1E4DFF', niche: 'beauty', ai_label_auto: true } });
    assert.equal(JSON.parse(userRow(EM).brand).ai_label_auto, true);
    const terms = fs.readFileSync(path.join(__dirname, '..', 'content', 'legal', 'terms.md'), 'utf8');
    assert.match(terms, /AI dramatizations/); assert.match(terms, /resemble a celebrity/);
    await call('ce', 'PUT', '/api/me', { brand: { name: 'Glow', color: '#1E4DFF', niche: 'beauty', ai_label_auto: false } });
  });

  await step('Chat edit: a generation op charges exactly the quoted credits through a normal job and splices the new scene in', async () => {
    next = { type: 'plan', ops: [{ op: 'regenerate_scene', scene: 1, direction: 'smile more' }] };
    const p = await plan('re-make scene 1, smile more');
    const quoted = p.message.plan.total;
    const before = credits.balance(userRow(EM).id).total;
    const c = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${p.message.id}/confirm`);
    assert.equal(c.status, 200, JSON.stringify(c.data));
    assert.equal(before - credits.balance(userRow(EM).id).total, quoted, 'charged = quoted');
    const ej = await waitJob('ce', c.data.edit_job_id, 180);
    assert.equal(ej.status, 'done', ej.error);
    const child = get('SELECT * FROM jobs WHERE id = ?', c.data.children[0].job_id);
    assert.equal(child.status, 'done'); assert.equal(child.credits, quoted);
  });

  await step('Chat edit: a plan that costs more than the balance is refused before anything runs', async () => {
    run('UPDATE users SET plan_credits = 5, topup_credits = 0 WHERE email = ?', EM);
    next = { type: 'plan', ops: [{ op: 'regenerate_scene', scene: 1 }] };
    const p = await plan('re-make scene 1');
    assert.equal(p.message.kind, 'plan', JSON.stringify(p.message));
    const jobsBefore = get('SELECT COUNT(*) AS n FROM jobs').n;
    try {
      const c = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${p.message.id}/confirm`);
      assert.equal(c.status, 402);
      assert.equal(get('SELECT COUNT(*) AS n FROM jobs').n, jobsBefore, 'no job was created');
      assert.equal(get('SELECT status FROM chat_edit_messages WHERE id = ?', p.message.id).status, 'proposed', 'the plan can be confirmed after a top-up');
    } finally { run('UPDATE users SET plan_credits = 8000 WHERE email = ?', EM); }
  });

  // ---------- AI bill ----------
  await step('AI bill: planner messages are metered with real token cost; free allowance, then a fee; rate limit; daily cap + alert', async () => {
    const u = userRow(EM);
    const rows = all("SELECT * FROM llm_usage WHERE user_id = ? AND feature = 'chat_edit'", u.id);
    assert.ok(rows.length >= 8);
    const real = rows.find((x) => x.adapter === 'anthropic');
    assert.equal(real.cost_usd, Math.round((2000 * 2 + 300 * 10)) / 1e6, 'Sonnet 5.5 at $2/$10 per million tokens');
    const a = llmbill.allowance(u, 'chat_edit');
    assert.equal(a.free_left, 0); assert.equal(a.credits, getSetting('llm').chat_edit.credits_per_message);
    assert.ok(rows.some((x) => x.credits > 0), 'messages after the free allowance paid the fee');
    // Rate limit per minute.
    const L = getSetting('llm');
    try {
    setSetting('llm', { ...L, chat_edit: { ...L.chat_edit, per_minute: 1, free_per_day: { ...L.chat_edit.free_per_day, scale: 3 } } });
    next = { type: 'question', question: 'Which part?' };
    await assert.rejects(plan('hmm'), /very fast/);
    // Daily cap: free steps stop, an alert is raised once.
    setSetting('llm', { ...L, daily_cap_usd: 0.000001 });
    llmbill.checkCap();
    await assert.rejects(plan('hmm'), /paused for the rest of the day/);
    assert.ok(get("SELECT * FROM admin_alerts WHERE kind = 'llm_cap'"), 'admin alert raised');
    const bal = credits.balance(u.id).total;
    await assert.rejects(plan('hmm'));
    assert.equal(credits.balance(u.id).total, bal, 'no fee taken when the call is refused');
    } finally { setSetting('llm', L); }
  });

  await step('Profit guard report shows the planner message, the free allowances and the daily cap; Profit view adds them up', async () => {
    const m = guard.margins();
    assert.ok(m.rows.some((r) => r.id === 'chat_edit_message' && r.status === 'ok'), JSON.stringify(m.rows.filter((r) => r.kind === 'llm')));
    assert.ok(m.rows.filter((r) => r.kind === 'llm_allowance').every((r) => r.status === 'ok'));
    assert.ok(m.rows.some((r) => r.id === 'llm_daily_cap'));
    assert.ok(m.payment_fee && m.payment_fee.pct >= 0);
    const p = await A('GET', '/api/admin/profit?days=7');
    assert.equal(p.status, 200, JSON.stringify(p.data));
    assert.equal(p.data.series.length, 7);
    assert.ok(p.data.types.some((t) => t.id === 'ugc_talking'));
    assert.ok(p.data.llm.by_feature.some((f) => f.feature === 'chat_edit'));
    assert.ok(Array.isArray(p.data.alerts) && p.data.alerts.length >= 1);
    // A type whose real cost is above the price is flagged.
    const j = get("SELECT * FROM jobs WHERE type = 'ugc' AND user_id = ? AND status = 'done' ORDER BY id LIMIT 1", userRow(EM).id);
    run("UPDATE jobs SET state = json_set(state, '$.real_cost_usd', 999) WHERE id = ?", j.id);
    const p2 = await A('GET', '/api/admin/profit?days=7');
    assert.ok(p2.data.flagged.includes('ugc_talking'), 'below-60% type flagged');
    run("UPDATE jobs SET state = json_set(state, '$.real_cost_usd', 0) WHERE id = ?", j.id);
    const s = await A('PUT', '/api/admin/llm-settings', { daily_cap_usd: 40, chat_edit: { credits_per_message: 3, free_per_day: { pro: 10 } } });
    assert.equal(s.data.settings.daily_cap_usd, 40); assert.equal(s.data.settings.chat_edit.credits_per_message, 3); assert.equal(s.data.settings.chat_edit.free_per_day.pro, 10);
    assert.equal((await call('ce', 'GET', '/api/admin/profit')).status, 401);
    await A('PUT', '/api/admin/llm-settings', { daily_cap_usd: 25, chat_edit: { credits_per_message: 2, free_per_day: { pro: 15 } } });
  });

  await step('Jobs record their real cost per step (text by tokens on the AI bill, renders by the row that ran)', async () => {
    const j = get("SELECT * FROM jobs WHERE type = 'ugc' AND user_id = ? ORDER BY id LIMIT 1", userRow(EM).id);
    const st = JSON.parse(j.state);
    assert.ok(Array.isArray(st.cost_log) && st.cost_log.some((x) => x.kind === 'text'));
    assert.ok(get("SELECT 1 FROM llm_usage WHERE job_id = ? AND feature = 'job:ugc'", j.id));
  });

  // ---------- ffmpeg edit ops ----------
  await step('Edit ops (ffmpeg): trim, cut, re-order, speed, reframe, splice, captions/overlay/logo/end card on generated footage', async () => {
    if (!stitch.available()) return;
    const ops = require('./editops');
    const src = path.join(tmp, 'src.mp4'), clip = path.join(tmp, 'clip.mp4'), logo = path.join(tmp, 'logo.png');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=10:r=30', '-f', 'lavfi', '-i', 'sine=f=440:d=10', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
    ff(['-f', 'lavfi', '-i', 'mandelbrot=s=360x640:r=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
    ff(['-f', 'lavfi', '-i', 'color=c=0x1E4DFF:s=120x120', '-frames:v', '1', logo]);
    const d = (f) => stitch.probe(f).duration;
    const near = (a, b, t = 0.25) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);
    near(d(await ops.keep(src, ops.trimRanges(10, 2, 10), path.join(tmp, 't.mp4'))), 8);
    near(d(await ops.keep(src, ops.cutRanges(10, 3, 5), path.join(tmp, 'c.mp4'))), 8);
    const scenes = [{ start: 0, end: 4, orig: 0 }, { start: 4, end: 10, orig: 1 }];
    near(d(await ops.keep(src, ops.reorderRanges(scenes, [1, 0]), path.join(tmp, 'r.mp4'))), 10);
    near(d(await ops.speed(src, 2, path.join(tmp, 's.mp4'))), 5);
    const rf = await ops.reframe(src, '1:1', path.join(tmp, 'sq.mp4'));
    assert.deepEqual(await ops.probeSize(rf), [1080, 1080]);
    const sp = await ops.splice(src, await ops.withAudio(clip, tmp), 4, 7, path.join(tmp, 'sp.mp4'));
    near(d(sp), 10);
    // Timeline maths: words and scenes follow the cuts.
    const words = ops.wordsFromScript('one two three four five six seven eight nine ten', 10);
    const w2 = ops.mapWords(words, ops.cutRanges(10, 3, 5));
    assert.equal(w2.length, 8); assert.equal(w2[3].text, 'six'); near(w2[3].start, 3, 0.01);
    const out = path.join(tmp, 'final.mp4');
    await ops.finish({ master: src, look: { captions: { on: true, size: 'large', position: 'top' }, overlays: [{ text: '50% off today', start: 0, end: 2, position: 'top' }], logo: { on: true, corner: 'bottom-right' }, end_card: { on: true, cta: 'Shop now' }, music: { on: true, volume: 0.3 } }, words, logoFile: logo, musicFile: ops.beatFile(tmp, 10), dir: tmp, out });
    near(d(out), 12.5, 0.4);
    assert.match(ops.captionAss(words, { captions: { size: 'large', position: 'top' } }, 720, 1280, '#1E4DFF'), /Style: Cap,[^,]+,\d+,.*,8,60,60,154,1/);
  });

  // ---------- Street interview + Mad edit ----------
  await step('Street interview: Q&A script, two speakers, parts at the clip length, stitched; honesty label on', async () => {
    const q = (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'street_interview', duration: 16 } })).data;
    assert.ok(q.credits > 0 && q.margin_pct >= 60, JSON.stringify(q));
    const r = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'street_interview', product: 'Trail running shoes', duration: 16, question: 'What are you training for?' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const j = await waitJob('ce', r.data.job.id, 120);
    assert.equal(j.status, 'done', j.error);
    assert.ok(j.output.lines.some((l) => l.who === 'host') && j.output.lines.some((l) => l.who === 'guest'));
    assert.equal(j.output.segments.length, 2, '16s at 8s parts'); assert.equal(j.output.ai_label, true); assert.match(j.output.honesty, /dramatization/);
    const st = JSON.parse(get('SELECT state FROM jobs WHERE id = ?', j.id).state);
    assert.ok(Object.keys(st.sub).filter((k) => /^part/.test(k)).length === 2);
    const dl = require('./jobs').parseDialogue('Host: Hi there!\nGuest: Hello.\nWhat do you use?');
    assert.deepEqual(dl.map((x) => x.who), ['host', 'guest', 'host']);
    const bad = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'street_interview', product: 'Shoes', duration: 16, guest_desc: 'looks exactly like Cristiano Ronaldo' });
    assert.equal(bad.status, 400);
  });

  await step('Mad edit: beat grid, punch-ins, generated whoosh/impact/beat, text hits; AI shots and own footage both assemble', async () => {
    const mad = require('./madedit'), sfx = require('./sfx');
    const P = mad.plan({ seconds: 10, bpm: 120, sources: 2, hits: ['New', 'Hot', 'Now'], caption: 'one two three' });
    assert.ok(P.cuts.length >= 12); assert.ok(P.cuts.some((c) => c.punch));
    assert.ok(P.cuts.every((c) => Math.abs((c.start / 0.5) - Math.round(c.start / 0.5)) < 1e-6 || c.len < 0.5), 'cuts land on the half-beat grid');
    assert.equal(P.hits.length, 3); assert.equal(P.words.length, 3);
    for (const k of ['whoosh', 'impact', 'riser']) { const b = sfx.make[k](); assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.ok(b.length > 10000); }
    assert.equal(sfx.grid(120, 2).length, 4);
    const q1 = (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'mad_edit', duration: 15 } })).data;
    const q2 = (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'mad_edit', duration: 15, source: 'own' } })).data;
    assert.ok(q2.credits < q1.credits && q2.margin_pct >= 60 && q1.margin_pct >= 60, JSON.stringify([q1, q2]));
    const r = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'mad_edit', product: 'Sneakers', duration: 10 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const j = await waitJob('ce', r.data.job.id, 150);
    assert.equal(j.status, 'done', j.error);
    if (stitch.available()) { assert.ok(j.output.url && j.output.cuts >= 10, JSON.stringify(j.output)); near10(stitch.probe(require('./media').filePath(j.output.url.slice(7))).duration); }
    // Own footage: upload a clip, no AI render.
    const clip = path.join(tmp, 'own.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=6:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
    const up = await call('ce', 'POST', '/api/uploads/video?for=mad_edit&name=own.mp4', fs.readFileSync(clip), { 'Content-Type': 'video/mp4' });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const r2 = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'mad_edit', product: 'Sneakers', duration: 10, source: 'own', videos: [up.data.upload.id], hits: ['Fresh', 'Drop'] });
    assert.equal(r2.status, 200, JSON.stringify(r2.data));
    const j2 = await waitJob('ce', r2.data.job.id, 150);
    assert.equal(j2.status, 'done', j2.error);
    assert.deepEqual(j2.output.hits, ['Fresh', 'Drop']); assert.equal(j2.output.source, 'own');
    assert.equal((await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'mad_edit', product: 'X', duration: 10, source: 'own', videos: ['nope'] })).status, 400);
    function near10(x) { assert.ok(Math.abs(x - 10) < 0.3, 'mad edit length ' + x); }
  });

  // ---------- Actors ----------
  let faceJob;
  await step('Actors: describe → 4 faces (priced) → pick → save with a voice; house actors listed; use in a video', async () => {
    const l = (await call('ce', 'GET', '/api/actors')).data;
    assert.ok(l.house.length >= 5 && l.voices.length >= 4);
    const bal = credits.balance(userRow(EM).id).total;
    const r = await call('ce', 'POST', '/api/jobs', { type: 'actor', description: 'woman in her forties, short grey hair, linen shirt, sunny kitchen' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    faceJob = await waitJob('ce', r.data.job.id);
    assert.equal(faceJob.output.faces.length, 4);
    assert.equal(bal - credits.balance(userRow(EM).id).total, faceJob.credits);
    assert.ok(guard.margins().rows.find((x) => x.id === 'actor').status === 'ok');
    assert.equal((await call('ce', 'POST', '/api/actors', { job_id: faceJob.id, face_url: '/media/someone-else.png', name: 'Rita', voice_key: 'female_warm' })).status, 400, 'only faces from that job');
    const s = await call('ce', 'POST', '/api/actors', { job_id: faceJob.id, face_url: faceJob.output.faces[1], name: 'Rita', voice_key: 'female_warm' });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const j = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'ugc_talking', product: 'Tea', duration: 10, script: 'Hi, this tea is lovely.', actor_id: String(s.data.actor.id) });
    assert.equal(j.status, 200, JSON.stringify(j.data));
    assert.equal(j.data.job.input.actor.image_url, faceJob.output.faces[1]);
    assert.equal((await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'ugc_talking', product: 'Tea', duration: 10, script: 'Hi.', actor_id: 'h:p5' })).data.job.input.actor.name, 'Lena');
  });

  await step('Actors: celebrities and lookalikes are blocked; an own-face upload needs consent + a clip + staff approval', async () => {
    assert.equal((await call('ce', 'POST', '/api/jobs', { type: 'actor', description: 'a man who looks like Elon Musk in a suit' })).status, 400);
    assert.equal((await call('ce', 'POST', '/api/jobs', { type: 'actor', description: 'celebrity footballer lookalike, tall' })).status, 400);
    assert.equal((await call('ce', 'POST', '/api/actors', { job_id: faceJob.id, face_url: faceJob.output.faces[0], name: 'Beyoncé', voice_key: 'female_warm' })).status, 400);
    const img = await call('ce', 'POST', '/api/upload', fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'img', 'apple-touch-icon.png')), { 'Content-Type': 'image/png' });
    assert.equal(img.status, 200);
    assert.equal((await call('ce', 'POST', '/api/actors/upload', { name: 'Sam Lee', image_url: img.data.url, consent: false })).status, 400, 'consent box');
    assert.equal((await call('ce', 'POST', '/api/actors/upload', { name: 'Sam Lee', image_url: img.data.url, consent: true })).status, 400, 'consent clip');
    const clip = path.join(tmp, 'consent.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=360x640:d=5:r=30', '-f', 'lavfi', '-i', 'sine=d=5', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
    const up = await call('ce', 'POST', '/api/uploads/video?for=actor_consent&name=consent.mp4', fs.readFileSync(clip), { 'Content-Type': 'video/mp4' });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    const a = await call('ce', 'POST', '/api/actors/upload', { name: 'Sam Lee', image_url: img.data.url, consent: true, consent_upload_id: up.data.upload.id, voice_key: 'male_calm' });
    assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(a.data.actor.status, 'pending');
    const use = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'ugc_talking', product: 'Tea', duration: 10, script: 'Hi.', actor_id: String(a.data.actor.id) });
    assert.equal(use.status, 400); assert.match(use.data.error, /consent check/);
    const pend = (await A('GET', '/api/admin/actors')).data.actors.find((x) => x.id === a.data.actor.id);
    assert.ok(pend.consent.clip_url && /I agree to Vooads/.test(pend.consent.line));
    assert.equal((await A('POST', `/api/admin/actors/${a.data.actor.id}/review`, { approve: true })).data.actor.status, 'active');
    assert.equal((await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'ugc_talking', product: 'Tea', duration: 10, script: 'Hi.', actor_id: String(a.data.actor.id) })).status, 200);
    // Another customer can never use it.
    await signup('ce2', 'chatedit2@example.com'); await buyPlan('ce2', 'pro');
    assert.equal((await call('ce2', 'POST', '/api/jobs', { type: 'video_type', video_type: 'ugc_talking', product: 'Tea', duration: 10, script: 'Hi.', actor_id: String(a.data.actor.id) })).status, 400);
  });

  // ---------- Hook factory ----------
  await step('Hook factory: 10 hooks at a bulk price (guard-checked), spliced onto the video, export all as a zip', async () => {
    for (let k = 0; k < 600 && get("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('queued','running')", userRow(EM).id).n; k++) await wait(250);
    const q = async (count) => (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'hook_remix', count, duration: 4 } })).data;
    const q1 = await q(1), q5 = await q(5), q10 = await q(10), q12 = await q(12);
    assert.equal(q10.count, 10); assert.equal(q12.count, 10, 'never more than 10');
    assert.ok(q10.credits < q1.credits * 10 && q5.credits < q1.credits * 5, 'bulk discount');
    assert.equal(q10.bulk_pct, 10); assert.equal(q5.bulk_pct, 5);
    assert.ok(q10.margin_pct >= 60, 'still above the minimum margin: ' + q10.margin_pct);
    const r = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'hook_remix', product: 'Glow serum', count: 10, duration: 4, video_url: ugcJob.output.url });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.job.input.count, 10);
    const j = await waitJob('ce', r.data.job.id, 240);
    assert.equal(j.status, 'done', j.error);
    assert.equal(j.output.hooks.length, 10);
    const z = await call('ce', 'GET', `/api/jobs/${j.id}/export.zip`);
    assert.equal(z.status, 200);
    assert.ok(String(z.data).startsWith('PK'), 'zip');
    assert.ok(String(z.data).includes('hooks.txt') && String(z.data).includes('hook-10-clip.mp4'));
  });

  // ---------- Payment fees + naira rate ----------
  await step('Fee buffer: the worst switched-on method\'s fee comes off every credit price; per-method override; fees in Profit', async () => {
    const base = guard.worstCaseUsdPerCredit();
    const m = get("SELECT * FROM payment_methods WHERE adapter = 'test'") || get('SELECT * FROM payment_methods ORDER BY id LIMIT 1');
    const cfg0 = m.config, en0 = m.enabled;
    run('UPDATE payment_methods SET enabled = 1, config = ? WHERE id = ?', JSON.stringify({ fee_pct: 20, fee_fixed_usd: 1 }), m.id);
    const worse = guard.worstCaseUsdPerCredit();
    assert.ok(worse < base * 0.85, `${worse} < ${base}`);
    { const f = guard.feeFor(m.adapter, { fee_pct: 20, fee_fixed_usd: 1 }); assert.equal(f.pct, 20); assert.equal(f.fixed_usd, 1); }
    // A price that was safe can need more credits once fees are counted.
    const e1 = guard.evaluate(100, 1.2);
    assert.ok(e1.safeCredits > 0);
    run('UPDATE payment_methods SET enabled = ?, config = ? WHERE id = ?', en0, cfg0, m.id);
    assert.equal(guard.worstCaseUsdPerCredit(), base);
    const bad = await A('PUT', '/api/admin/payment-methods/' + m.id, { config: { fee_pct: 90 } });
    assert.equal(bad.status, 400);
    const p = (await A('GET', '/api/admin/profit?days=3')).data;
    assert.ok(p.totals.fees_usd >= 0 && p.payment_fee_worst);
  });

  await step('FX: naira price = USD × rate × (1 + buffer), shown as "₦1,650 + 4% = ₦1,716 per $1"; the buffer defaults to 0% now that the Bachs 4% customer fee covers it', async () => {
    const fx = require('./fx'), bachs = require('./payments/bachs');
    assert.equal(fx.bufferPct({ config: { ngn_rate: 1650 } }), 0, 'default 0% (field kept for extra cover)');
    assert.equal(fx.explain({ config: { ngn_rate: 1650 } }), '₦1,650 per $1');
    const m = { config: { ngn_rate: 1650, fx_buffer_pct: 4 } };
    assert.equal(fx.bufferPct(m), 4); assert.equal(fx.effectiveRate(m), 1716);
    assert.equal(fx.explain(m), '₦1,650 + 4% = ₦1,716 per $1');
    assert.equal(bachs.localAmount(m, 10, 'NGN'), 17160);
    assert.equal(bachs.localAmount({ config: { ngn_rate: 1650 } }, 10, 'NGN'), 16500);
    assert.ok(bachs.notes({ config: { ngn_rate: 1650, fx_buffer_pct: 4 } })[0].includes('₦1,650 + 4% = ₦1,716 per $1'), 'admin sees the effective rate');
    assert.equal(bachs.localAmount({ config: { ngn_rate: 1650, fx_buffer_pct: 10 } }, 10, 'NGN'), 18150);
    assert.match(bachs.config_fields.find((f) => f.key === 'fx_buffer_pct').help, /rate you actually buy dollars at, not the official rate/);
  });

  await step('FX auto rate: raises apply at once; a drop over 2% waits for approval (2% or less applies); a failed feed keeps the last rate; every change is logged and alerted', async () => {
    const fx = require('./fx'), payments = require('./payments');
    const id = get("SELECT id FROM payment_methods WHERE adapter = 'bachs' ORDER BY id LIMIT 1").id;
    const c0 = get('SELECT config FROM payment_methods WHERE id = ?', id).config;
    const setCfg = (c) => run('UPDATE payment_methods SET config = ? WHERE id = ?', JSON.stringify(c), id);
    const cfg = () => JSON.parse(get('SELECT config FROM payment_methods WHERE id = ?', id).config);
    const m = () => payments.byId(id);
    let feed = 0;
    const fetcher = async () => (feed < 0 ? Promise.reject(new Error('feed down')) : { rates: { NGN: feed } });
    try {
      setCfg({ ...JSON.parse(c0), ngn_rate: 1500, ngn_rate_updated_at: '2026-10-01T00:00:00.000Z', fx_auto: 'no', fx_url: 'https://fx.example.com/usd.json', fx_json_path: 'rates.NGN' });
      feed = 1540;
      let r = await fx.checkMethod(m(), { fetcher });
      assert.equal(cfg().ngn_rate, 1500, 'auto off: nothing applied'); assert.equal(cfg().fx_feed_rate, 1540);
      setCfg({ ...cfg(), fx_auto: 'yes' });
      r = await fx.checkMethod(m(), { fetcher });
      assert.equal(r.changed, 'raised'); assert.equal(cfg().ngn_rate, 1540, 'a higher rate applies at once');
      assert.ok(get("SELECT 1 FROM audit_log WHERE action = 'fx.rate_raised'")); assert.ok(get("SELECT 1 FROM admin_alerts WHERE kind LIKE 'fx_rate_%'"));
      feed = 1520; // 1.3% lower: allowed
      r = await fx.checkMethod(m(), { fetcher });
      assert.equal(r.changed, 'lowered'); assert.equal(cfg().ngn_rate, 1520);
      feed = 1400; // 7.9% lower: held for the owner
      r = await fx.checkMethod(m(), { fetcher });
      assert.equal(r.held, true); assert.equal(cfg().ngn_rate, 1520, 'a big drop is not applied'); assert.equal(cfg().fx_pending_lower.rate, 1400);
      assert.ok(get("SELECT 1 FROM audit_log WHERE action = 'fx.lower_held'"));
      const ap = await A('POST', '/api/admin/fx/approve', { method_id: id });
      assert.equal(ap.status, 200, JSON.stringify(ap.data)); assert.equal(cfg().ngn_rate, 1400); assert.ok(!cfg().fx_pending_lower);
      const at = cfg().ngn_rate_updated_at;
      feed = -1; // feed down
      r = await fx.checkMethod(m(), { fetcher });
      assert.ok(r.error); assert.equal(cfg().ngn_rate, 1400, 'last rate kept'); assert.equal(cfg().ngn_rate_updated_at, at, 'age not refreshed, so staleness rules apply'); assert.match(cfg().fx_last_error, /feed down/);
      assert.ok(require('./payments/bachs').warnings(m()).some((w) => /Rate feed problem/.test(w)));
    } finally { setCfg(JSON.parse(c0)); }
  });

  await step('FX sudden move: the naira weakens 5%+ → rate raised at once (auto on) or naira checkout paused with the friendly message (auto off); the FX line shows whether naira income covers what was sold', async () => {
    const fx = require('./fx'), payments = require('./payments'), bachs = require('./payments/bachs');
    const id = get("SELECT id FROM payment_methods WHERE adapter = 'bachs' ORDER BY id LIMIT 1").id;
    const c0 = get('SELECT config FROM payment_methods WHERE id = ?', id).config;
    const setCfg = (c) => run('UPDATE payment_methods SET config = ? WHERE id = ?', JSON.stringify(c), id);
    const cfg = () => JSON.parse(get('SELECT config FROM payment_methods WHERE id = ?', id).config);
    const m = () => payments.byId(id);
    const fetcher = async () => 1620; // a plain number feed
    try {
      setCfg({ ...JSON.parse(c0), ngn_rate: 1500, ngn_rate_updated_at: new Date().toISOString(), fx_auto: 'yes', fx_url: 'https://fx.example.com/n', fx_json_path: '' });
      let r = await fx.checkMethod(m(), { fetcher });
      assert.equal(r.changed, 'sudden'); assert.equal(cfg().ngn_rate, 1620);
      assert.ok(get("SELECT 1 FROM admin_alerts WHERE kind LIKE 'fx_rate_%' AND level = 'stop'"));
      setCfg({ ...cfg(), ngn_rate: 1500, fx_auto: 'no' });
      r = await fx.checkMethod(m(), { fetcher });
      assert.equal(r.paused, true); assert.equal(cfg().ngn_rate, 1500);
      assert.equal(bachs.staleness(m()).block, true);
      await assert.rejects(bachs.checkout({ ...m(), secret: 'sk_live_' + 'a1'.repeat(16), webhookSecret: 'whsec_' + 'b2'.repeat(16) }, { payment: { id: 1 }, user: { country: 'NG' }, amountUsd: 10 }), /Naira payments are paused for a moment/);
      assert.ok(get("SELECT 1 FROM admin_alerts WHERE kind LIKE 'fx_paused_%'"));
      // Saving a new rate in admin lifts the pause.
      const put = await A('PUT', '/api/admin/payment-methods/' + id, { config: { ...cfg(), ngn_rate: 1630 } });
      assert.equal(put.status, 200, JSON.stringify(put.data)); assert.ok(!cfg().fx_paused); assert.equal(bachs.staleness(m()).block, false);
      // FX line: ₦15,000 received for $10 of credits; at today's ₦1,620 it is worth $9.26 → not covering.
      const uid = userRow(EM).id;
      run("INSERT INTO payments(user_id, method_id, adapter, kind, credits, amount_usd, status, currency, amount_local, provider_ref, paid_at) VALUES(?, ?, 'bachs', 'topup', 100, 10, 'paid', 'NGN', 15000, ?, ?)", uid, id, 'fxt_' + Date.now(), new Date().toISOString());
      setCfg({ ...cfg(), fx_feed_rate: 1620 });
      const rep = (await A('GET', '/api/admin/fx?days=30')).data.report;
      assert.ok(rep.ngn_received >= 15000); assert.equal(rep.today_rate, 1620); assert.equal(rep.today_source, 'feed');
      assert.ok(rep.usd_at_today < rep.usd_sold && rep.ok === false && rep.covering_pct < 100, JSON.stringify(rep));
      run("DELETE FROM payments WHERE provider_ref LIKE 'fxt_%'");
    } finally { setCfg(JSON.parse(c0)); }
  });

  await step('Customer fee built into the price: Bachs total = base × 1.04, Gatevoo shows the base price and "save 4%"; credits, commission and Voo value use the base; no fee line anywhere customer-facing; the owner can edit the %', async () => {
    const payments = require('./payments'), sc = require('./surcharge'), billing = require('./billing');
    const { encrypt } = require('./lib/util');
    sc.fill();
    for (const m of all('SELECT adapter, config FROM payment_methods')) { const c = JSON.parse(m.config || '{}'); assert.equal(Number(c.customer_fee_pct), m.adapter === 'bachs' ? 4 : 0, m.adapter + ' default'); }
    const mk = (adapter, name, cfg) => Number(run("INSERT INTO payment_methods(name, adapter, enabled, sort, countries, config, secret_enc, webhook_secret_enc, public_key) VALUES(?, ?, 1, -5, '[\"*\"]', ?, ?, ?, 'pk')", name, adapter, JSON.stringify(cfg), encrypt(adapter === 'bachs' ? 'sk_live_feetest12345' : 'gv_live_feetest12345'), encrypt('whsec_feetest12345')).lastInsertRowid);
    const bid = mk('bachs', 'Bachs (cards, bank)', { customer_fee_pct: 4 }), gid = mk('gatevoo', 'Crypto (Gatevoo: USDT, BTC)', { customer_fee_pct: 0 });
    const keep = { b: payments.ADAPTERS.bachs.checkout, g: payments.ADAPTERS.gatevoo.checkout, bh: payments.ADAPTERS.bachs.hidden, gh: payments.ADAPTERS.gatevoo.hidden };
    const seen = [];
    payments.ADAPTERS.bachs.checkout = payments.ADAPTERS.gatevoo.checkout = async (m, o) => { seen.push({ adapter: m.adapter, amountUsd: o.amountUsd }); return { url: '/app?paid=' + o.payment.id }; };
    payments.ADAPTERS.bachs.hidden = payments.ADAPTERS.gatevoo.hidden = () => null;
    try {
      await signup('fee', 'fee-check@example.com'); await buyPlan('fee', 'pro');
      run("UPDATE users SET country = 'GH' WHERE email = ?", 'fee-check@example.com');
      const bill = (await call('fee', 'GET', '/api/billing')).data;
      const bm = bill.methods.find((x) => x.id === bid), gm = bill.methods.find((x) => x.id === gid);
      assert.equal(bm.price_factor, 1.04); assert.equal(gm.price_factor, 1); assert.equal(gm.save_pct, 4); assert.equal(bm.save_pct, 0);
      assert.ok(!/fee|surcharge/i.test(JSON.stringify(bill.methods.map(({ id, name, price_factor, save_pct, local }) => ({ id, name, price_factor, save_pct, local })))), 'no fee wording to customers');
      const pack = bill.topups[0];
      const credits0 = credits.balance(userRow('fee-check@example.com').id).total;
      let r = await call('fee', 'POST', '/api/billing/checkout', { kind: 'topup', topup_id: pack.id, method_id: bid });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const pb = get('SELECT * FROM payments WHERE adapter = ? ORDER BY id DESC LIMIT 1', 'bachs');
      assert.equal(pb.amount_usd, pack.price, 'base price recorded'); assert.equal(pb.fee_pct, 4);
      assert.equal(pb.fee_usd, Math.round(pack.price * 4) / 100); assert.equal(pb.charged_usd, Math.round(pack.price * 104) / 100, 'total = base × 1.04');
      assert.equal(seen.at(-1).amountUsd, pb.charged_usd, 'the customer is charged base × 1.04');
      billing.markPaid(pb.id, { ref: 'fee_test_b' });
      assert.equal(credits.balance(userRow('fee-check@example.com').id).total - credits0, pack.credits, 'credits = the base pack, nothing less');
      const rc = get("SELECT vars FROM email_queue WHERE template = 'topup_receipt' AND to_email = ? ORDER BY id DESC LIMIT 1", 'fee-check@example.com');
      assert.ok(rc, 'receipt queued'); const rv = JSON.parse(rc.vars);
      assert.equal(rv.amount, '$' + pb.charged_usd.toFixed(2), 'the receipt shows what was paid'); assert.ok(!/fee/i.test(JSON.stringify(rv)), 'no fee line on the receipt');
      const html = require('./email').build('topup_receipt', rv, userRow('fee-check@example.com')).html;
      assert.ok(!/processing fee|surcharge/i.test(html));
      r = await call('fee', 'POST', '/api/billing/checkout', { kind: 'topup', topup_id: pack.id, method_id: gid });
      const pg = get('SELECT * FROM payments WHERE adapter = ? ORDER BY id DESC LIMIT 1', 'gatevoo');
      assert.equal(pg.fee_usd, 0); assert.equal(pg.charged_usd, pack.price); assert.equal(seen.at(-1).amountUsd, pack.price, 'Gatevoo charges the base price');
      // Customer history shows what they paid; admin sees the split.
      const hist = (await call('fee', 'GET', '/api/billing')).data.payments.find((x) => x.id === pb.id);
      assert.equal(hist.amount_usd, pb.charged_usd);
      const adm = (await A('GET', '/api/admin/payments')).data.payments.find((x) => x.id === pb.id);
      assert.equal(adm.amount_usd, pack.price); assert.equal(adm.fee_usd, pb.fee_usd);
      // Profit counts what was paid and shows the customer fees separately.
      const pr = (await A('GET', '/api/admin/profit?days=7')).data.totals;
      assert.ok(pr.customer_fees_usd >= pb.fee_usd);
      // The guard counts the customer fee against that method's processing cost; Gatevoo (0%) is unchanged.
      const g = require('./guard');
      assert.ok(g.feeFor('bachs', { fee_pct: 3.5, customer_fee_pct: 4 }).pct === 0 && g.feeFor('bachs', { fee_pct: 3.5 }).pct === 3.5);
      assert.equal(g.feeFor('gatevoo', { fee_pct: 1, customer_fee_pct: 0 }).pct, 1);
      // The owner edits the %; bad values are refused; a value he set is never overwritten on boot.
      const bad = await A('PUT', '/api/admin/payment-methods/' + bid, { config: { customer_fee_pct: 30 } });
      assert.equal(bad.status, 400);
      const ok = await A('PUT', '/api/admin/payment-methods/' + bid, { config: { customer_fee_pct: 2.5 } });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
      sc.fill();
      assert.equal(JSON.parse(get('SELECT config FROM payment_methods WHERE id = ?', bid).config).customer_fee_pct, 2.5);
      assert.equal((await call('fee', 'GET', '/api/billing')).data.methods.find((x) => x.id === bid).price_factor, 1.025);
      // The studio never writes a fee line.
      const studio = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'studio-app.js'), 'utf8');
      assert.ok(!/processing fee/i.test(studio) && /and save ' \+ x\.save_pct \+ '%/.test(studio));
    } finally {
      Object.assign(payments.ADAPTERS.bachs, { checkout: keep.b, hidden: keep.bh }); Object.assign(payments.ADAPTERS.gatevoo, { checkout: keep.g, hidden: keep.gh });
      run('UPDATE payment_methods SET enabled = 0 WHERE id IN (?, ?)', bid, gid);
    }
  });

  await step('Naira rate: stamped when saved; warning after 7 days; optional pause of naira checkout after 30 days', async () => {
    const bachs = require('./payments/bachs');
    const m = get("SELECT * FROM payment_methods WHERE adapter = 'bachs' ORDER BY id LIMIT 1");
    const r = await A('PUT', '/api/admin/payment-methods/' + m.id, { config: { ngn_rate: 1550, block_when_stale: 'yes' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const saved = JSON.parse(get('SELECT config FROM payment_methods WHERE id = ?', m.id).config);
    assert.ok(saved.ngn_rate_updated_at);
    assert.equal(r.data.method.warnings.length, 0, 'fresh rate: no warning');
    const h = (days) => ({ config: { ...saved, ngn_rate_updated_at: new Date(Date.now() - days * 864e5).toISOString() } });
    assert.equal(bachs.staleness(h(3)).warn, false);
    assert.equal(bachs.staleness(h(8)).warn, true); assert.equal(bachs.staleness(h(8)).block, false);
    assert.equal(bachs.staleness(h(31)).block, true);
    assert.equal(bachs.staleness({ config: { ...h(31).config, block_when_stale: 'no' } }).block, false, 'pause is optional');
    const nine = h(9).config;
    run('UPDATE payment_methods SET config = ? WHERE id = ?', JSON.stringify(nine), m.id);
    const v = (await A('GET', '/api/admin/payment-methods')).data.methods.find((x) => x.id === m.id);
    assert.match(v.warnings[0], /9 days old/);
    // Re-saving the same rate keeps the old date (it is the rate's age, not the form's).
    await A('PUT', '/api/admin/payment-methods/' + m.id, { config: { ngn_rate: 1550, block_when_stale: 'yes' } });
    assert.equal(JSON.parse(get('SELECT config FROM payment_methods WHERE id = ?', m.id).config).ngn_rate_updated_at, nine.ngn_rate_updated_at);
    await assert.rejects(bachs.checkout({ ...require('./payments').hydrate(get('SELECT * FROM payment_methods WHERE id = ?', m.id)), secret: 'sk_live_abcdefghijkl', webhookSecret: 'whsec_abcdefghijkl', config: h(40).config }, { payment: { id: 1 }, user: { country: 'NG', email: 'a@b.c' }, amountUsd: 10 }), /paused/);
    run('UPDATE payment_methods SET config = ? WHERE id = ?', m.config, m.id);
  });

  await step('Referrals: ?invite= is the link; old ?ref= still credits the inviter; VooSquare refs are not read as ours', async () => {
    const inviter = userRow(EM);
    const ref = (await call('ce', 'GET', '/api/referral')).data;
    assert.match(ref.link, /\?invite=/);
    const h = ip();
    const c = await call('inv', 'POST', '/api/auth/code', { email: 'invited@example.com' }, h);
    await call('inv', 'POST', '/api/auth/verify', { email: 'invited@example.com', code: c.data.dev_code, ref: inviter.ref_code }, h);
    assert.equal(userRow('invited@example.com').referred_by, inviter.ref_code);
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'studio-app.js'), 'utf8');
    assert.match(app, /qs\.get\('invite'\)/);
  });


  // ---------- Last gaps: faces, price floor, fee pre-fill, transcript captions, every provider call billed ----------
  await step('Pricing: a described presenter face is priced (about 3 credits, above 60%), shown in the quote; an actor needs none', async () => {
    const q0 = (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'ugc_talking', duration: 10, script: 'Hi there.' } })).data;
    const q1 = (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'ugc_talking', duration: 10, script: 'Hi there.', presenter_desc: 'man in his 40s, denim shirt' } })).data;
    assert.equal(q1.credits - q0.credits, 3); assert.ok(q1.addons.some((a) => a.id === 'presenter_face' && a.credits === 3)); assert.ok(q1.margin_pct >= 60);
    assert.ok(q1.provider_cost_usd > q0.provider_cost_usd, 'the image render is in the cost');
    const q2 = (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'ugc_talking', duration: 10, script: 'Hi there.', presenter_desc: 'x', actor_id: 'h:p1' } })).data;
    assert.equal(q2.credits, q0.credits);
    const hr = (await call('ce', 'POST', '/api/quote', { type: 'video_type', input: { video_type: 'hook_remix', count: 2, presenter_desc: 'woman 30s' } })).data;
    assert.ok(hr.addons.some((a) => a.id === 'presenter_face'));
  });

  await step('No unpriced AI calls: every provider call is in a paid job (metered) or on the AI bill', async () => {
    const dir = __dirname, hits = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (!/providers|assets/.test(f)) walk(p); } else if (/\.js$/.test(f) && !/^selfcheck/.test(f)) { const t = fs.readFileSync(p, 'utf8'); if (/providers\.submit\(/.test(t)) hits.push([path.relative(dir, p), t]); } } };
    walk(dir);
    const ok = { 'jobs.js': /meter\(job, st, key, kind, p, input, r\.result\)/, 'llmbill.js': /const c = record\(/, 'aimodels.js': /recordProvider\(/, 'aitools.js': /recordProvider\(/, [path.join('routes', 'studio.js')]: /recordProvider\(/, 'houseactors.js': /recordProvider\(/ };
    for (const [f, t] of hits) { assert.ok(ok[f], f + ' calls a provider without billing it'); assert.match(t, ok[f], f + ' does not record the cost'); }
    assert.equal(hits.length, Object.keys(ok).length);
    // The admin test of a text provider is on the bill too.
    assert.match(fs.readFileSync(path.join(dir, 'routes', 'admin.js'), 'utf8'), /feature: 'admin_test:text'/);
  });

  await step('Data update: saved prices under the 60% floor are raised once (to the file price or the guard minimum) and logged; higher prices kept', async () => {
    const pf = require('./pricefloor');
    const orig = JSON.parse(JSON.stringify(getSetting('pricing')));
    const P = JSON.parse(JSON.stringify(orig));
    const bm = P.video_types.find((t) => t.id === 'brand_music'); bm.price_by_seconds['120'] = 110;
    const hr = P.video_types.find((t) => t.id === 'hook_remix'); hr.levels.find((l) => l.id === 'standard').credits_per_unit = 400; // owner set higher
    const pb = P.video_types.find((t) => t.id === 'product_broll'); pb.levels.find((l) => l.id === 'standard').credits_per_unit = 2; // far too low
    P.costs.hook_pack_20 = 1;
    setSetting('pricing', P);
    const du = { ...(getSetting('data_updates') || {}) }; delete du.price_floor_2026_11; setSetting('data_updates', du);
    const r = pf.priceFloor();
    const N = getSetting('pricing');
    assert.ok(N.video_types.find((t) => t.id === 'brand_music').price_by_seconds['120'] >= 125, 'Brand music 120s raised');
    assert.equal(N.video_types.find((t) => t.id === 'hook_remix').levels.find((l) => l.id === 'standard').credits_per_unit, 400, 'never lowered');
    assert.ok(N.video_types.find((t) => t.id === 'product_broll').levels.find((l) => l.id === 'standard').credits_per_unit >= 10);
    assert.ok(N.costs.hook_pack_20 >= 6);
    assert.ok(r.changes.length >= 3, JSON.stringify(r));
    assert.ok(get("SELECT 1 FROM audit_log WHERE action = 'pricing.floor_raise'"));
    assert.ok(pf.priceFloor().skipped, 'runs once');
    for (const row of guard.margins().rows.filter((x) => x.kind === 'video_type_level' && x.enabled)) assert.notEqual(row.status, 'loss', row.name);
    setSetting('pricing', orig);
  });

  await step('Payment fees are pre-filled on every method (empty fields only); new methods get them too', async () => {
    const pf = require('./pricefloor');
    const id1 = Number(run("INSERT INTO payment_methods(name, adapter, enabled, sort, countries, config) VALUES('Fee test', 'stripe', 0, 99, '[]', '{}')").lastInsertRowid);
    const id2 = Number(run("INSERT INTO payment_methods(name, adapter, enabled, sort, countries, config) VALUES('Fee test 2', 'paystack', 0, 99, '[]', ?)", JSON.stringify({ fee_pct: 1.2, fee_fixed_usd: 0 })).lastInsertRowid);
    pf.paymentFees();
    const c1 = JSON.parse(get('SELECT config FROM payment_methods WHERE id = ?', id1).config), c2 = JSON.parse(get('SELECT config FROM payment_methods WHERE id = ?', id2).config);
    assert.equal(c1.fee_pct, 2.9); assert.equal(c1.fee_fixed_usd, 0.3);
    assert.equal(c2.fee_pct, 1.2, 'an edited fee is kept');
    const made = await A('POST', '/api/admin/payment-methods', { adapter: 'gatevoo', name: 'Fee test 3' });
    assert.equal(made.data.method.config.fee_pct, 1);
    for (const x of [id1, id2, made.data.method.id]) run('DELETE FROM payment_methods WHERE id = ?', x);
  });

  await step('Captions on edited versions are timed from a transcript when a speech-to-text provider is set up (priced), else even timing', async () => {
    const providers = require('./providers');
    const ctx0 = chatedit.context(get('SELECT * FROM jobs WHERE id = ?', ugcJob.id));
    const plain = chatedit.price({ ops: [{ op: 'captions', on: true }] }, ctx0, userRow(EM));
    assert.ok(!plain.items.some((x) => x.op === 'captions_timing'), 'demo: no transcript, even timing, free');
    const chain = providers.chain;
    providers.ADAPTERS.fakestt = { submit: async () => ({ done: true, result: { words: [{ text: 'Okay,', start: 0.4, end: 0.8 }, { text: 'listen', start: 0.9, end: 1.3 }, { text: 'up.', start: 1.35, end: 1.7 }] } }) };
    providers.chain = (kind) => (kind === 'stt' ? [{ id: 9901, name: 'Fake Scribe', kind: 'stt', adapter: 'fakestt', config: {}, apiKey: 'x', cost_usd: 0.4, cost_unit: 'per hour' }] : chain(kind));
    try {
      const p = chatedit.price({ ops: [{ op: 'captions', on: true, size: 'large' }] }, ctx0, userRow(EM));
      const t = p.items.find((x) => x.op === 'captions_timing');
      assert.ok(t && t.credits >= 1, JSON.stringify(p.items));
      next = { type: 'plan', ops: [{ op: 'captions', on: true, size: 'large' }] };
      await call('ce', 'POST', `/api/jobs/${ugcJob.id}/versions/${ugcJob.id}/use`);
      const m = await plan('captions bigger');
      assert.ok(m.message.plan.items.some((x) => x.op === 'captions_timing'));
      const before = credits.balance(userRow(EM).id).total;
      const c = await call('ce', 'POST', `/api/jobs/${ugcJob.id}/chat/${m.message.id}/confirm`);
      assert.equal(c.status, 200, JSON.stringify(c.data));
      assert.equal(before - credits.balance(userRow(EM).id).total, m.message.plan.total);
      const ej = await waitJob('ce', c.data.edit_job_id);
      assert.equal(ej.status, 'done', ej.error);
      assert.equal(ej.output.words_source, 'transcript'); assert.equal(ej.output.words[0].text, 'Okay,'); assert.equal(ej.output.words[0].start, 0.4);
      // The next caption edit on that version needs no new transcript.
      const ctx1 = chatedit.context(get('SELECT * FROM jobs WHERE id = ?', ej.id));
      assert.ok(!chatedit.price({ ops: [{ op: 'captions', size: 'small' }] }, ctx1, userRow(EM)).items.some((x) => x.op === 'captions_timing'));
    } finally { providers.chain = chain; delete providers.ADAPTERS.fakestt; }
  });

  // ---------- Real-cost watchdog ----------
  await step('Watchdog: real cost per step (reported, measured or estimated); drift above 10% raises the table cost, never lowers it', async () => {
    const wd = require('./watchdog');
    const row = { id: 1, adapter: 'fal', cost_usd: 0.1, cost_unit: 'per second', config: {} };
    assert.deepEqual(wd.measure(row, 'video', { duration: 5 }, { cost_usd: 0.62 }).source, 'reported');
    assert.equal(wd.measure({ id: 2, adapter: 'elevenlabs', cost_usd: 0.3, cost_unit: 'per 1k characters', config: {} }, 'voice', { text: 'x'.repeat(2000) }, {}).usd, 0.6);
    assert.equal(wd.measure(row, 'video', { duration: 5 }, {}).source, 'estimated');
    const mk = (name, cost) => Number(run("INSERT INTO providers(name, kind, adapter, model, config, cost_usd, cost_unit, enabled, priority) VALUES(?, 'video', 'fal', 'wd/test', ?, ?, 'per second', 0, 990)", name, JSON.stringify({ level: 'pro', tag: 'wd-' + name }), cost).lastInsertRowid);
    const up = mk('WD up', 0.1), down = mk('WD down', 0.1);
    for (let k = 0; k < 12; k++) {
      run("INSERT INTO job_costs(job_id, provider_id, kind, level, units, usd, table_usd, source) VALUES(NULL, ?, 'video', 'pro', 5, 0.65, 0.5, 'reported')", up);
      run("INSERT INTO job_costs(job_id, provider_id, kind, level, units, usd, table_usd, source) VALUES(NULL, ?, 'video', 'pro', 5, 0.25, 0.5, 'reported')", down);
      run("INSERT INTO job_costs(job_id, provider_id, kind, level, units, usd, table_usd, source) VALUES(NULL, ?, 'video', 'pro', 5, 9, 0.5, 'estimated')", down); // estimates never count
    }
    const rep = wd.check();
    const raised = rep.raised.find((x) => x.provider_id === up);
    assert.ok(raised && raised.from === 0.1 && raised.to === 0.13, JSON.stringify(rep));
    assert.equal(get('SELECT cost_usd FROM providers WHERE id = ?', up).cost_usd, 0.13);
    assert.equal(get('SELECT cost_usd FROM providers WHERE id = ?', down).cost_usd, 0.1, 'never lowered automatically');
    assert.ok(rep.suggested.some((x) => x.provider_id === down), 'a lower cost is only suggested');
    assert.ok(get("SELECT 1 FROM audit_log WHERE action = 'watchdog.cost_raised'"));
    assert.ok(get("SELECT 1 FROM admin_alerts WHERE kind = ?", 'cost_drift_' + up));
    assert.equal(wd.check().raised.length, 0, 'the same steps are not counted twice');
    run('DELETE FROM job_costs WHERE provider_id IN (?, ?)', up, down); run('DELETE FROM providers WHERE id IN (?, ?)', up, down);
  });

  await step('Watchdog: after a raise the margin guard runs again and lifts prices under 60% (never lowers one)', async () => {
    const wd = require('./watchdog');
    const orig = JSON.parse(JSON.stringify(getSetting('pricing')));
    const P = JSON.parse(JSON.stringify(orig));
    P.video_types.find((t) => t.id === 'product_broll').levels.find((l) => l.id === 'pro').credits_per_unit = 3;
    P.video_types.find((t) => t.id === 'product_broll').levels.find((l) => l.id === 'standard').credits_per_unit = 500;
    setSetting('pricing', P);
    const r = wd.reguard();
    const N = getSetting('pricing').video_types.find((t) => t.id === 'product_broll');
    assert.ok(N.levels.find((l) => l.id === 'pro').credits_per_unit >= 18, JSON.stringify(r));
    assert.equal(N.levels.find((l) => l.id === 'standard').credits_per_unit, 500, 'a higher price is kept');
    setSetting('pricing', orig);
  });

  await step('Watchdog kill switch: a type under 40% real margin (24h) is paused ("temporarily unavailable"); the owner override switches it back on', async () => {
    const wd = require('./watchdog');
    const ids = [];
    for (let k = 0; k < 3; k++) ids.push(Number(run("INSERT INTO jobs(user_id, type, status, step, input, state, credits, demo) VALUES(?, 'image_to_video', 'done', 'Done', ?, ?, 10, 0)", userRow(EM).id, JSON.stringify({ video_type: 'image_to_video', product: 'x' }), JSON.stringify({ real_cost_usd: 5 })).lastInsertRowid));
    try {
      const hit = wd.killSwitch();
      assert.ok(hit.some((x) => x.id === 'image_to_video'), JSON.stringify(hit));
      assert.ok(get("SELECT 1 FROM admin_alerts WHERE kind = 'paused_image_to_video'"));
      const r = await call('ce', 'POST', '/api/jobs', { type: 'video_type', video_type: 'image_to_video', product: 'Lamp', duration: 5, image_url: '/samples/creator-3.webp' });
      assert.equal(r.status, 402); assert.match(r.data.error, /temporarily unavailable/);
      const types = (await call('ce', 'GET', '/api/video-types')).data.video_types;
      assert.match(types.find((t) => t.id === 'image_to_video').locked_reason, /temporarily unavailable/);
      assert.equal((await call('ce', 'POST', '/api/admin/watchdog/resume', { type: 'image_to_video' })).status, 401, 'owner only');
      const o = await A('POST', '/api/admin/watchdog/resume', { type: 'image_to_video' });
      assert.equal(o.status, 200, JSON.stringify(o.data));
      assert.ok(!wd.pausedReason('image_to_video'));
      assert.equal(wd.killSwitch().length, 0, 'the override holds for 24 hours');
      const w = await A('GET', '/api/admin/watchdog');
      assert.equal(w.status, 200); assert.equal(w.data.thresholds.kill_margin_pct, 40);
      assert.ok(get("SELECT 1 FROM audit_log WHERE action = 'watchdog.type_resumed'"));
    } finally { for (const x of ids) run('DELETE FROM jobs WHERE id = ?', x); setSetting('paused_types', {}); }
  });

  // ---------- Security audit fixes ----------
  await step('Security: a refunded payment is never credited again (markPaid replay, signed Bachs event ignored)', async () => {
    const billing = require('./billing');
    await signup('sec1', 'secrefund@example.com');
    await buyPlan('sec1', 'starter');
    const co = await call('sec1', 'POST', '/api/billing/checkout', { kind: 'topup', topup_id: 't1', method_id: 0 });
    assert.equal(co.status, 200, JSON.stringify(co.data));
    await call('sec1', 'GET', new URL(co.data.url).pathname);
    const u0 = userRow('secrefund@example.com');
    assert.equal(get('SELECT status FROM payments WHERE id = ?', co.data.payment_id).status, 'paid');
    const r = await A('POST', `/api/admin/payments/${co.data.payment_id}/refund`, { remove_credits: true });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const after = userRow('secrefund@example.com').topup_credits;
    billing.markPaid(co.data.payment_id, { ref: 'replay' });
    assert.equal(userRow('secrefund@example.com').topup_credits, after, 'replay gives nothing');
    assert.equal(get('SELECT status FROM payments WHERE id = ?', co.data.payment_id).status, 'refunded');
    // The Bachs webhook ignores a refunded payment even with a valid signature.
    const bachs = require('./payments/bachs');
    run("UPDATE payments SET adapter = 'bachs', provider_ref = 'bachs_cs_replay' WHERE id = ?", co.data.payment_id);
    const raw = Buffer.from(JSON.stringify({ type: 'checkout.completed', data: { checkout_id: 'cs_replay', reference: 'va_' + co.data.payment_id } }));
    const ev = await bachs.webhook({ webhookSecret: 'whsec_replaytest', secret: 'sk_live_x' }, { headers: bachs.sign(raw, 'whsec_replaytest'), rawBody: raw });
    assert.equal(ev.type, 'ignore');
    assert.equal(userRow('secrefund@example.com').topup_credits, after);
    assert.ok(u0.topup_credits > after, 'the refund removed the credits');
  });

  await step('Security: customer files reach ffmpeg only as the type their bytes show, with file/pipe protocols only', async () => {
    const ng = require('./lib/netguard');
    assert.equal(ng.sniff(Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd\n')), null, 'an HLS playlist is refused');
    assert.equal(ng.sniff(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(8)])).demuxer, 'mov');
    assert.equal(ng.sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])).demuxer, 'matroska');
    const f = path.join(tmp, 'x.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    stitch.registerInput(f, 'mov');
    const a = stitch.guardArgs(['-ss', '1', '-i', f, '-f', 'lavfi', '-i', 'anullsrc', 'out.mp4']);
    assert.deepEqual(a.slice(0, 7), ['-ss', '1', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i']);
    assert.ok(!a.slice(7).includes('-protocol_whitelist') || a.indexOf('anullsrc') < 0 || a[a.indexOf('anullsrc') - 3] !== '-protocol_whitelist', 'lavfi inputs untouched');
    // A playlist pretending to be a video: refused before ffmpeg ever sees it.
    const evil = path.join(tmp, 'evil.m3u8');
    fs.writeFileSync(evil, '#EXTM3U\n#EXTINF:1,\n' + f + '\n#EXT-X-ENDLIST\n');
    const up = require('./uploads').saveLocal(userRow(EM).id, evil, 'video/mp4', 'work');
    await assert.rejects(stitch.localFile('upload:' + up.id, tmp, userRow(EM).id), /not a video/);
  });

  await step('Security: one guarded fetch (pinned DNS, private/IPv4-mapped/reserved ranges refused, redirects re-checked) for links and mirror', async () => {
    const ng = require('./lib/netguard');
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::1', 'fd00::1', '100.64.0.1', '198.18.0.1', '0.0.0.0', '64:ff9b::7f00:1']) assert.ok(ng.isBlockedIp(ip), ip);
    assert.ok(!ng.isBlockedIp('93.184.216.34'));
    for (const u of ['http://127.0.0.1/x.mp4', 'http://[::ffff:127.0.0.1]/x', 'http://localhost:4000/x', 'http://metadata.google.internal/', 'ftp://example.com/a', 'http://user:pw@example.com/']) assert.ok(ng.urlProblem(u), u);
    await assert.rejects(stitch.safeDownload('http://127.0.0.1:9/a.mp4'), /private/);
    // A public-looking host that redirects to a private address is stopped at the redirect.
    const http = require('node:http');
    const srv = http.createServer((q, r) => { r.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); r.end(); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    process.env.NETGUARD_ALLOW_PRIVATE = '1';
    const first = await ng.request(`http://127.0.0.1:${srv.address().port}/`).catch((e) => e);
    process.env.NETGUARD_ALLOW_PRIVATE = '';
    assert.equal(first.status, 302);
    await assert.rejects(ng.download('http://169.254.169.254/latest/meta-data'), /private/);
    srv.close();
    assert.equal(await require('./media').mirror('http://127.0.0.1:9/x.mp4', null), 'http://127.0.0.1:9/x.mp4', 'mirror refuses private links (keeps the link)');
  });

  await step('Security: private uploads resolve only for their owner (or a valid signed link)', async () => {
    const uploads = require('./uploads');
    const f = path.join(tmp, 'mine.mp4');
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]);
    const up = uploads.saveLocal(userRow(EM).id, f, 'video/mp4', 'work');
    const other = userRow('chatedit2@example.com');
    assert.ok(await stitch.localFile('upload:' + up.id, tmp, userRow(EM).id));
    await assert.rejects(stitch.localFile('upload:' + up.id, tmp, other.id), /not found/);
    await assert.rejects(stitch.localFile('/u/' + up.id + '.mp4', tmp, other.id), /not found/);
    await assert.rejects(stitch.localFile('/u/' + up.id + '.mp4', tmp), /not found/);
    assert.ok(await stitch.localFile(uploads.signedPath(uploads.byId(up.id), 600), tmp), 'a signed link still works');
  });

  await step('Security: the Stripe paid event must match the payment\'s session and amount', async () => {
    const stripe = require('./payments/stripe');
    const { hmac } = require('./lib/util');
    const u = userRow(EM);
    const pid = Number(run("INSERT INTO payments(user_id, adapter, kind, topup_id, credits, amount_usd, provider_ref, status) VALUES(?, 'stripe', 'topup', 't2', 1000, 49, 'cs_real_1', 'pending')", u.id).lastInsertRowid);
    const ev = (o) => { const raw = Buffer.from(JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { payment_id: pid }, ...o } } })); const t = Math.floor(Date.now() / 1000); return stripe.webhook({ webhookSecret: 'whsec_s' }, { headers: { 'stripe-signature': `t=${t},v1=${hmac('sha256', 'whsec_s', t + '.' + raw.toString('utf8'))}` }, rawBody: raw }); };
    assert.equal(ev({ id: 'cs_other', amount_total: 4900 }).type, 'ignore', 'another session');
    assert.equal(ev({ id: 'cs_real_1', amount_total: 100 }).type, 'ignore', 'amount too low');
    const ok = ev({ id: 'cs_real_1', amount_total: 4900 });
    assert.equal(ok.type, 'paid'); assert.equal(ok.paymentId, pid);
  });

  await step('Security: the CSP has no \'unsafe-inline\' for scripts and no page carries an inline script or handler', async () => {
    const r = await fetch(process.env.APP_URL + '/');
    const csp = r.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self';/); assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
    for (const u of ['/', '/app', '/admin', '/blog', '/legal/terms']) {
      const html = await (await fetch(process.env.APP_URL + u)).text();
      const inline = html.match(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/gi) || [];
      assert.equal(inline.length, 0, u + ' has an inline script');
      assert.ok(!/<[a-z][^>]*\son(click|error|load|input|change|submit)=/i.test(html), u + ' has an inline handler');
    }
    for (const f of fs.readdirSync(path.join(__dirname, '..', 'public', 'assets', 'js'))) {
      const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', f), 'utf8');
      assert.ok(!/\son(click|error|load)="/.test(js), f + ' writes an inline handler');
    }
  });


  // ---------- House actors ----------
  await step('House actors: 45 slots; pinned originals lead (Recommended row and Browse all); last-used goes first; market picks fill; slots hidden; admin order field; generate needs keys', async () => {
    const ha = require('./houseactors');
    assert.equal(ha.all().length, 45, '45 house-actor slots');
    const counts = ha.all().reduce((m, a) => { m[a.market] = (m[a.market] || 0) + 1; return m; }, {});
    assert.deepEqual(counts, { africa: 12, latam: 6, brazil: 5, mena: 5, south_asia: 5, sea: 5, europe: 4, north_america: 3 });
    assert.equal(ha.all().filter((a) => a.country === 'NG').length, 2, 'two Nigerian actors (one woman, one man)');
    assert.deepEqual(ha.all().filter((a) => a.country === 'NG').map((a) => a.gender).sort(), ['f', 'm']);
    assert.ok(!ha.all().some((a) => /amaka/i.test(a.name)));
    for (const a of ha.all()) assert.equal(require('./actors').realPersonReason(a.name + ' ' + a.look), null, a.name + ' passes the lookalike check');
    const ORIG = ['p1', 'p2', 'p3', 'p4', 'p5'];
    assert.deepEqual(ha.all().slice(0, 5).map((a) => a.id), ORIG, 'Browse all: originals first by default');
    const cfg = (await call('anon', 'GET', '/api/public/config')).data;
    assert.deepEqual(cfg.presenters.slice(0, 5).map((a) => a.name), ['Maya', 'Omar', 'Bianca', 'Frank', 'Lena']);
    assert.ok(cfg.presenters.every((a) => a.image_url && a.speaks_line && /^Speaks: /.test(a.speaks_line)), 'only actors with a portrait are offered; each shows Speaks');
    assert.equal(cfg.presenters.length, ha.ready().length, 'every slot with a portrait is offered');
    assert.ok(cfg.presenters.length >= 5);
    {
      // A slot without a portrait is hidden (blank one for a moment, then put it back).
      const saved = ha.byId('p45').img;
      ha.savePresenter('p45', { img: '' });
      const hid = (await call('anon', 'GET', '/api/public/config')).data;
      assert.ok(!hid.presenters.some((a) => a.id === 'p45'), 'slots without a portrait are hidden');
      assert.equal(hid.presenters.length, ha.ready().length);
      ha.savePresenter('p45', { img: saved });
      assert.equal(ha.byId('p45').img, saved);
    }
    // A customer in Nigeria: originals first, then the Nigerian actors lead the market picks.
    await signup('ha', 'house-actors@example.com');
    run("UPDATE users SET country = 'NG' WHERE email = ?", 'house-actors@example.com');
    let r = (await call('ha', 'GET', '/api/actors/recommended?pipe=ugc')).data;
    assert.ok(r.recommended.length >= 6 && r.recommended.length <= 8, 'a short row of 6-8');
    assert.deepEqual(r.recommended.slice(0, 5).map((a) => a.presenter), ORIG, 'Recommended: originals lead by default');
    const ngReady = ha.ready().filter((a) => a.country === 'NG').map((a) => a.id);
    assert.deepEqual(r.recommended.slice(5, 5 + ngReady.length).map((a) => a.presenter).sort(), ngReady.sort(), 'then the Nigerian actors for a customer in Nigeria');
    // The actor picked last goes first next time (only it goes ahead of the pinned originals).
    await buyPlan('ha', 'pro');
    const j = await call('ha', 'POST', '/api/jobs', { type: 'ugc', product: 'Shea butter', duration: 10, script: 'This shea butter keeps my skin soft all day long, honestly.', presenter: 'p8' });
    assert.equal(j.status, 200, JSON.stringify(j.data));
    r = (await call('ha', 'GET', '/api/actors/recommended?pipe=ugc')).data;
    assert.deepEqual(r.recommended.slice(0, 6).map((a) => a.presenter), ['p8', ...ORIG], 'last-used first, then the originals');
    await waitJob('ha', j.data.job.id);
    // Admin: the Featured/order field reorders; a customer cannot change it.
    assert.equal((await call('ha', 'PUT', '/api/admin/house-actors/p2', { featured: 9 })).status, 401);
    const up = await A('PUT', '/api/admin/house-actors/p5', { featured: 1 });
    assert.equal(up.status, 200, JSON.stringify(up.data));
    await A('PUT', '/api/admin/house-actors/p1', { featured: 5 });
    assert.deepEqual(ha.all().slice(0, 5).map((a) => a.id), ['p5', 'p2', 'p3', 'p4', 'p1']);
    await A('PUT', '/api/admin/house-actors/p5', { featured: 5 }); await A('PUT', '/api/admin/house-actors/p1', { featured: 1 });
    assert.deepEqual(ha.all().slice(0, 5).map((a) => a.id), ORIG);
    // Generate: cost first; refused (with what is missing) when there are no image/video keys.
    const est = await A('POST', '/api/admin/house-actors/generate', {});
    const needWork = ha.all().filter((a) => !a.img || !a.motion).length;
    assert.equal(est.data.confirm_needed, true); assert.equal(est.data.estimate.count, needWork, 'all missing actors counted');
    const go = await A('POST', '/api/admin/house-actors/generate', { confirm: true });
    assert.equal(go.status, 409); assert.ok(go.data.missing_keys.some((k) => /image model/.test(k)) && go.data.missing_keys.some((k) => /video model/.test(k)));
    const list = (await A('GET', '/api/admin/house-actors')).data;
    assert.equal(list.actors.length, 45); assert.equal(list.missing.length, ha.missing().length);
  });

  // ---------- Half-failed jobs and long videos ----------
  {
    const providers = require('./providers');
    const chain0 = providers.chain;
    const calls = { voice: [], ugc: [] };
    let ugcPlan = () => null; // returns an error message to fail this call, or null to succeed
    let ugcMax = 0;
    providers.ADAPTERS.fakevoice = { submit: async (p, kind, input) => { calls.voice.push(input.text); return { done: true, result: { url: '/samples/ugc-serum.mp4' } }; } };
    providers.ADAPTERS.fakeugc = { submit: async (p, kind, input) => { calls.ugc.push(input.text); const err = ugcPlan(calls.ugc.length, input); if (err) throw new Error(err); return { done: true, result: { url: '/samples/ugc-serum.mp4' } }; } };
    const VOICE = { id: 9911, name: 'Fake ElevenLabs', kind: 'voice', adapter: 'fakevoice', config: {}, apiKey: 'x', cost_usd: 0.3, cost_unit: 'per 1k characters', enabled: 1 };
    const UGC = () => ({ id: 9912, name: 'Fake presenter model', kind: 'ugc', adapter: 'fakeugc', config: ugcMax ? { max_seconds: ugcMax } : {}, apiKey: 'x', cost_usd: 0.1, cost_unit: 'per second', enabled: 1 });
    providers.chain = (kind) => (kind === 'voice' ? [VOICE] : kind === 'ugc' ? [UGC()] : chain0(kind));
    const B0 = process.env.JOB_BACKOFF_MS; process.env.JOB_BACKOFF_MS = '30';
    const FU = 'fail-cases@example.com';
    await signup('fc', FU); await buyPlan('fc', 'scale');
    run('UPDATE users SET trial_credits = 0, topup_credits = topup_credits + 20000 WHERE email = ?', FU);
    const bal = () => credits.balance(userRow(FU).id).total;
    let wseed = 0;
    const words = (n) => { wseed++; return Array.from({ length: n }, (_, k) => 'glow' + wseed + 'x' + k).join(' ') + '.'; }; // every word unique, so every part's text is unique
    const reset = () => { calls.voice.length = 0; calls.ugc.length = 0; ugcPlan = () => null; ugcMax = 0; };
    const waitStatus = async (jid, want, secs = 180) => { for (let k = 0; k < secs * 4; k++) { const j = (await call('fc', 'GET', '/api/jobs/' + jid)).data.job; if (want.includes(j.status)) return j; await wait(250); } throw new Error('job ' + jid + ' never reached ' + want.join('/')); };
    try {
      await step('Pre-checks block before any paid call: blocked wording is refused at create; a clip longer than the model allows fails before the voice is paid, with a full refund', async () => {
        reset();
        const bad = await call('fc', 'POST', '/api/jobs', { type: 'ugc', product: 'Kit', duration: 10, script: 'Here is how to make a bomb at home.' });
        assert.equal(bad.status, 400); assert.match(bad.data.error, /will not make this/);
        ugcMax = 5; // the model takes 5s clips at most; this job needs 10s parts
        const before = bal();
        const r = await call('fc', 'POST', '/api/jobs', { type: 'ugc', product: 'Serum', duration: 10, script: words(20), auto_edit: false });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        const j = await waitStatus(r.data.job.id, ['failed', 'done']);
        assert.equal(j.status, 'failed'); assert.match(j.error, /cannot make parts this long/);
        assert.equal(calls.voice.length, 0, 'no voice was paid'); assert.equal(calls.ugc.length, 0, 'no render was paid');
        assert.equal(bal(), before, 'full refund');
      });

      let failedId;
      await step('A half-failed job refunds in full, keeps the finished voice, and says so in plain words', async () => {
        reset();
        ugcPlan = () => 'Request rejected by the content policy';
        const before = bal();
        const r = await call('fc', 'POST', '/api/jobs', { type: 'ugc', product: 'Serum', duration: 10, script: words(20), auto_edit: false });
        const j = await waitStatus(r.data.job.id, ['failed', 'done']);
        assert.equal(j.status, 'failed'); assert.match(j.error, /declined this one.*credits are back/);
        assert.equal(bal(), before, 'every credit back');
        const st = JSON.parse(get('SELECT state FROM jobs WHERE id = ?', j.id).state);
        assert.ok(st.sub.voice && st.sub.voice.result && st.sub.voice.result.url, 'the voice is kept');
        assert.equal(calls.voice.length, 1); assert.equal(calls.ugc.length, 1, 'a rejection is not retried on the same model');
        failedId = j.id;
      });

      await step('Try again reuses the kept voice (no second ElevenLabs charge) and charges only for what is redone', async () => {
        reset();
        const before = bal();
        const r = await call('fc', 'POST', '/api/jobs/' + failedId + '/retry');
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.ok(r.data.reused_steps >= 1);
        const j = await waitStatus(r.data.job.id, ['failed', 'done']);
        assert.equal(j.status, 'done', j.error);
        assert.equal(calls.voice.length, 0, 'no second voice charge'); assert.equal(calls.ugc.length, 1, 'only the render is redone');
        assert.equal(j.retry_of, failedId);
        assert.equal(before - bal(), j.credits, 'charged the reduced price: ' + j.credits + ' (saved ' + r.data.credits_saved + ')');
        const orig = get('SELECT credits FROM jobs WHERE id = ?', failedId).credits;
        assert.ok(j.credits <= orig, 'never more than a fresh job');
      });

      await step('Fallback stays on the same level or goes lower, never higher; a lower level gives the price difference back', async () => {
        const levels = require('./levels');
        const rows = [{ id: 1, kind: 'ugc', adapter: 'fal', enabled: 1, config: { level: 'ultra', tag: 'u' } }, { id: 2, kind: 'ugc', adapter: 'fal', enabled: 1, config: { level: 'pro', tag: 'p' } }, { id: 3, kind: 'ugc', adapter: 'fal', enabled: 1, config: { level: 'standard', tag: 's' } }, { id: 4, kind: 'ugc', adapter: 'fal', enabled: 1, config: { level: 'pro', tag: 'p2' } }];
        const c = levels.runChain('ugc', { id: 'pro', provider_tag: 'p2' }, rows, () => true);
        assert.deepEqual(c.map((r) => r.id), [4, 2, 3], 'main pro model, other pro model, then standard; never ultra');
        assert.deepEqual(levels.runChain('ugc', { id: 'standard', provider_tag: 's' }, rows, () => true).map((r) => r.id), [3]);
      });

      await step('Long video: 8 parts, part 5 fails twice (temporary) then works; only part 5 is redone, voices are made once each', async () => {
        reset();
        let n = 0;
        ugcPlan = (k) => { n = k; return k === 6 || k === 7 ? 'HTTP 503 Service temporarily unavailable' : null; }; // 6th and 7th render calls = part 5 (index 5), twice
        const before = bal();
        const r = await call('fc', 'POST', '/api/jobs', { type: 'ugc', product: 'Serum', duration: 80, script: words(160), auto_edit: false });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        assert.equal(r.data.job.segments, 8);
        const j = await waitStatus(r.data.job.id, ['failed', 'done', 'attention'], 300);
        assert.equal(j.status, 'done', j.error);
        assert.equal(calls.voice.length, 8, 'one voice per part, no extra ElevenLabs charge');
        assert.equal(calls.ugc.length, 10, '8 parts + 2 retries');
        const per = calls.ugc.reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m; }, {});
        assert.deepEqual(Object.values(per).sort(), [1, 1, 1, 1, 1, 1, 1, 3], 'only one part was redone (3 tries)');
        assert.equal(per[calls.ugc[5]], 3, 'and it is part 5');
        assert.equal(get("SELECT COUNT(*) AS c FROM provider_failures WHERE job_id = ? AND temporary = 1", j.id).c, 2, 'both temporary failures logged');
        assert.equal(before - bal(), j.credits, 'charged once, no refund needed');
      });

      await step('Long video: a part that keeps failing puts the job in "Needs attention" with every finished part kept; Cancel refunds in full and assets are kept 7 days', async () => {
        reset();
        ugcPlan = (k, input) => (calls.ugc.filter((t) => t === input.text).length >= 1 && calls.ugc.indexOf(input.text) === 3 ? 'Request rejected by the content policy' : null);
        const before = bal();
        const r = await call('fc', 'POST', '/api/jobs', { type: 'ugc', product: 'Serum', duration: 50, script: words(100), auto_edit: false });
        const j = await waitStatus(r.data.job.id, ['failed', 'done', 'attention'], 240);
        assert.equal(j.status, 'attention', j.error);
        assert.equal(j.attention.part, 3); assert.match(j.error, /Part 4 could not be made/);
        const keep = new Date(j.attention.keep_until).getTime() - Date.now();
        assert.ok(keep > 6.9 * 864e5 && keep <= 7 * 864e5, 'assets kept 7 days');
        const st = JSON.parse(get('SELECT state FROM jobs WHERE id = ?', j.id).state);
        assert.equal(st.seg.filter(Boolean).length, 3, 'parts 1-3 kept'); assert.ok(st.sub.voice3 && st.sub.voice3.result, 'part 4 voice kept');
        assert.ok(before - bal() > 0, 'still charged while waiting for a choice');
        assert.equal((await call('fc', 'POST', '/api/jobs/' + j.id + '/attention', { action: 'nope' })).status, 400);
        const c = await call('fc', 'POST', '/api/jobs/' + j.id + '/attention', { action: 'cancel' });
        assert.equal(c.status, 200, JSON.stringify(c.data));
        assert.equal(c.data.job.status, 'failed'); assert.match(c.data.job.error, /cancelled.*credits are back/);
        assert.equal(bal(), before, 'full refund (Refund Policy: failed jobs get their credits back)');
        const st2 = JSON.parse(get('SELECT state FROM jobs WHERE id = ?', j.id).state);
        assert.equal(st2.seg.filter(Boolean).length, 3, 'finished parts still kept for Try again');
        assert.ok(st2.attention && st2.attention.keep_until, 'keep date recorded');
      });

      await step('Long video: "Use a still shot" for the failed part finishes the video for free; "Try that part again" resumes from that part only', async () => {
        reset();
        let failing = true;
        ugcPlan = (k, input) => (failing && calls.ugc.indexOf(input.text) === 1 ? 'Request rejected by the content policy' : null);
        const r = await call('fc', 'POST', '/api/jobs', { type: 'ugc', product: 'Serum', duration: 20, script: words(40), auto_edit: false });
        let j = await waitStatus(r.data.job.id, ['failed', 'done', 'attention'], 120);
        assert.equal(j.status, 'attention');
        const before = bal(), ugcBefore = calls.ugc.length;
        await call('fc', 'POST', '/api/jobs/' + j.id + '/attention', { action: 'still' });
        j = await waitStatus(j.id, ['failed', 'done', 'attention'], 120);
        assert.equal(j.status, 'done', j.error);
        assert.equal(calls.ugc.length, ugcBefore, 'a still shot needs no render'); assert.equal(bal(), before, 'and costs nothing');
        assert.ok(j.output.segments[1].still, 'part 2 is the still shot');
        // Try again on a fresh failure: only the failed part is rendered again.
        reset(); failing = true;
        ugcPlan = (k, input) => (failing && calls.ugc.indexOf(input.text) === 1 ? 'Request rejected by the content policy' : null);
        const r2 = await call('fc', 'POST', '/api/jobs', { type: 'ugc', product: 'Serum', duration: 20, script: words(40) + ' again', auto_edit: false });
        j = await waitStatus(r2.data.job.id, ['failed', 'done', 'attention'], 120);
        assert.equal(j.status, 'attention');
        failing = false; const u0 = calls.ugc.length, v0 = calls.voice.length;
        await call('fc', 'POST', '/api/jobs/' + j.id + '/attention', { action: 'retry' });
        j = await waitStatus(j.id, ['failed', 'done', 'attention'], 120);
        assert.equal(j.status, 'done', j.error);
        assert.equal(calls.ugc.length - u0, 1, 'one render: the failed part'); assert.equal(calls.voice.length - v0, 0, 'its voice was kept');
      });

      await step('Failure buffer: the guard adds the per-type failure buffer (5% default, from real data when there is enough) to the cost it prices on', async () => {
        const wd = require('./watchdog');
        assert.equal(wd.DEFAULT_FAIL_BUFFER, 0.05);
        const row = (rs) => rs.find((x) => x.id === 'ugc_talking');
        const a = row(guard.margins().rows || guard.margins());
        assert.equal(a.failure_buffer_pct, 5);
        const fr0 = getSetting('failure_rates');
        setSetting('failure_rates', { ...(fr0 || {}), ugc_talking: 0.2 });
        const b = row(guard.margins().rows || guard.margins());
        assert.equal(b.failure_buffer_pct, 20);
        assert.ok(b.provider_cost_usd > a.provider_cost_usd * 1.1, 'priced on the higher buffered cost');
        setSetting('failure_rates', fr0 || {});
      });
    } finally {
      providers.chain = chain0; delete providers.ADAPTERS.fakevoice; delete providers.ADAPTERS.fakeugc;
      if (B0 === undefined) delete process.env.JOB_BACKOFF_MS; else process.env.JOB_BACKOFF_MS = B0;
    }
  }

  setSetting('llm', L0);
  fs.rmSync(tmp, { recursive: true, force: true });
};
