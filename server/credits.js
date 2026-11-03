// Credits: three buckets. Trial (images and hooks only), plan (resets every month), top-up (never expires).
const { get, run, tx, all } = require('./db');
const { now } = require('./lib/util');
const { fail } = require('./lib/http');
const { pricing, planById } = require('./settings');

function balance(u) {
  const user = typeof u === 'object' ? get('SELECT * FROM users WHERE id = ?', u.id) : get('SELECT * FROM users WHERE id = ?', u);
  const planActive = user.plan_id && user.plan_expires_at && user.plan_expires_at > now();
  const plan = planActive ? user.plan_credits : 0;
  return { trial: user.trial_credits, plan, topup: user.topup_credits, total: user.trial_credits + plan + user.topup_credits, planActive: !!planActive };
}

function activePlan(user) {
  if (!user.plan_id || !user.plan_expires_at || user.plan_expires_at <= now()) return null;
  return planById(user.plan_id) || null;
}

// Spend credits. Returns the breakdown so failed jobs can be refunded to the same buckets.
function spend(userId, amount, reason, ref, { allowTrial = true } = {}) {
  amount = Math.ceil(amount);
  if (amount <= 0) return { trial: 0, plan: 0, topup: 0 };
  return tx(() => {
    const u = get('SELECT * FROM users WHERE id = ?', userId);
    const b = balance(u);
    const usable = (allowTrial ? b.trial : 0) + b.plan + b.topup;
    if (usable < amount) {
      const msg = !allowTrial && b.trial > 0 && b.plan + b.topup < amount
        ? 'Video needs a paid plan. Trial credits cover images and hooks only.'
        : `This needs ${amount} credits and you have ${usable}. Top up or upgrade your plan to continue.`;
      fail(402, msg, { needed: amount, have: usable });
    }
    let left = amount;
    const take = { trial: 0, plan: 0, topup: 0 };
    if (allowTrial) { take.trial = Math.min(left, b.trial); left -= take.trial; }
    take.plan = Math.min(left, b.plan); left -= take.plan;
    take.topup = Math.min(left, b.topup); left -= take.topup;
    run('UPDATE users SET trial_credits = trial_credits - ?, plan_credits = plan_credits - ?, topup_credits = topup_credits - ? WHERE id = ?', take.trial, take.plan, take.topup, userId);
    run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref) VALUES(?,?,?,?,?)', userId, -amount, JSON.stringify(take), reason, ref || null);
    if (take.topup > 0) require('./voomoney').consume(userId, take.topup); // credit-pack usage, reported to VooSquare daily
    return take;
  });
}

function refund(userId, take, reason, ref) {
  if (!take) return;
  const total = (take.trial || 0) + (take.plan || 0) + (take.topup || 0);
  if (!total) return;
  run('UPDATE users SET trial_credits = trial_credits + ?, plan_credits = plan_credits + ?, topup_credits = topup_credits + ? WHERE id = ?', take.trial || 0, take.plan || 0, take.topup || 0, userId);
  if (take.topup > 0) require('./voomoney').unconsume(userId, take.topup);
  run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref) VALUES(?,?,?,?,?)', userId, total, JSON.stringify(take), reason, ref || null);
}

function grant(userId, amount, bucket, reason, ref, staffId = null) {
  amount = Math.round(amount);
  const col = { trial: 'trial_credits', plan: 'plan_credits', topup: 'topup_credits' }[bucket] || 'topup_credits';
  tx(() => {
    if (amount < 0) {
      const u = get('SELECT * FROM users WHERE id = ?', userId);
      const avail = u[col];
      if (avail + amount < 0) amount = -avail;
    }
    run(`UPDATE users SET ${col} = ${col} + ? WHERE id = ?`, amount, userId);
    run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref, staff_id) VALUES(?,?,?,?,?,?)', userId, amount, bucket, reason, ref || null, staffId);
  });
  return amount;
}

// Credit price of each action. Every number comes from the admin pricing settings (costs + video_types).
// baseQuote = list price; quoteFull = list price checked by the loss guard (server/guard.js).
const segmentsFor = (vt, seconds) => (vt && vt.segment_seconds && ['ugc', 'video', 'image_to_video'].includes(vt.pipeline) && seconds > vt.segment_seconds ? Math.ceil(seconds / vt.segment_seconds) : 1);
const HOOK_SECONDS = (input) => Math.max(2, Math.min(5, Number(input.duration) || 4));
// Requested length rounded up to the type's step (e.g. 5s steps for b-roll), never below the minimum.
function videoSeconds(vt, duration) {
  const step = Math.max(1, Number(vt.seconds_step) || 1);
  const want = Number(duration) || vt.min_seconds || 15;
  return Math.max(vt.min_seconds || 1, Math.ceil(want / step) * step);
}
const maxHooks = (vt) => Math.max(1, Math.min(10, Number(vt && vt.max_hooks) || 5));
const hookCount = (input, max = 5) => Math.max(1, Math.min(max, Math.floor(Number(input.count)) || (Array.isArray(input.hooks) ? input.hooks.length : 0) || 3));
// Hook factory bulk price: the best pricing.video_types[].bulk_discounts step the count reaches ([{min: 5, pct: 5}, ...]).
function bulkPct(vt, count) {
  const steps = Array.isArray(vt && vt.bulk_discounts) ? vt.bulk_discounts : [];
  return steps.filter((x) => count >= Number(x.min)).reduce((m, x) => Math.max(m, Math.min(50, Number(x.pct) || 0)), 0);
}
// Animated ads: one scene per segment_seconds, 4 to 8 scenes (the end card is extra).
const sceneCount = (vt, seconds) => Math.max(4, Math.min(8, Math.round(seconds / (Number(vt.segment_seconds) || 5))));
const slideCount = (input) => Math.max(4, Math.min(8, Math.floor(Number(input.slides)) || (Array.isArray(input.lines) ? input.lines.length : 0) || 6));

const needsFace = (pipeline, input) => ['ugc', 'hook_remix', 'dub'].includes(pipeline) && !!String(input.presenter_desc || '').trim() && !String(input.actor_id || '').trim();
const faceCredits = () => Math.max(1, Math.ceil(Number((pricing().costs || {}).presenter_face) || 3));
// opts.level: price this level object even when it is switched off (admin margins and the pricing save check only).
function baseQuote(type, input = {}, user, opts = {}) {
  const c = pricing().costs || {};
  const videotypes = require('./videotypes');
  switch (type) {
    case 'video_type': {
      const levels = require('./levels');
      let vt = videotypes.byId(input.video_type);
      if (!vt) return { type, credits: 0, seconds: 0, units: 0, segments: 0 };
      // Quality level (SPEC §13): its price, cost and render length replace the type's. Unknown levels quote as standard.
      const level = opts.level || (levels.hasLevels(vt) ? levels.pick(vt, input.level) || levels.pick(vt, 'standard') : null);
      if (level) vt = levels.apply(vt, level);
      let seconds, count = null;
      const toolSecs = require('./videotools').quoteSeconds(vt, input, user); // uploads: the real length of the customer's video
      if (vt.pipeline === 'hook_remix') { seconds = HOOK_SECONDS(input); count = hookCount(input, maxHooks(vt)); }
      else seconds = videoSeconds(vt, toolSecs != null ? toolSecs : input.duration);
      if (vt.pipeline === 'slideshow') count = slideCount(input);
      if (vt.pipeline === 'motion_ad') count = sceneCount(vt, seconds);
      // Mad edit from the customer's own videos: no AI render, a local (ffmpeg) price per second.
      if (vt.pipeline === 'mad_edit' && input.source === 'own') vt = { ...vt, credits_per_unit: Number(vt.local_credits_per_unit) || 3, own_footage: true };
      const units = vt.unit === 'item' ? (count || 1) : seconds;
      const ex = vt.extras || {};
      const aiScript = (vt.pipeline === 'street' && !String(input.script || '').trim()) || (['ugc', 'motion_ad'].includes(vt.pipeline) && (input.write_script || (vt.pipeline === 'motion_ad' && !String(input.script || '').trim()))) || (vt.pipeline === 'slideshow' && !(Array.isArray(input.lines) && input.lines.length));
      const extra = (aiScript ? Number(ex.ai_script ?? (vt.pipeline === 'ugc' ? c.script : 0)) || 0 : 0) + (input.captions && vt.pipeline !== 'auto_edit' ? Number(ex.captions) || 0 : 0)
        + (vt.pipeline === 'bg_swap' && input.bg_kind === 'ai' ? Number(ex.ai_background) || 0 : 0);
      const clips = levels.clipsFor(vt, seconds);
      const q = { type, vt, seconds, units, count, level, clips, segments: vt.pipeline === 'motion_ad' ? count : clips ? clips.length : segmentsFor(vt, seconds) };
      const addonLines = require('./addons').lines(vt, input, q);
      // A presenter described in words is a new AI face (one image render): priced like any other step.
      if (needsFace(vt.pipeline, input)) addonLines.push({ id: 'presenter_face', name: 'New presenter face', credits: faceCredits() });
      const bulk = vt.pipeline === 'hook_remix' ? bulkPct(vt, count) : 0;
      let main = Math.ceil(vt.credits_per_unit * units * (1 - bulk / 100));
      if (bulk) { q.bulk_pct = bulk; q.list_credits = Math.ceil(vt.credits_per_unit * units); }
      // Brand music: one price per track length (pricing price_by_seconds, e.g. 60 credits up to 60s, 110 for 120s).
      if (vt.pipeline === 'brand_music') main = trackPrice(vt, seconds);
      // Auto-edit: a minimum per job (min_credits) so very short clips still cover the transcript and the AI plan.
      if (Number(vt.min_credits) > 0) main = Math.max(main, Math.ceil(Number(vt.min_credits)));
      return { ...q, addons: addonLines, credits: main + extra + addonLines.reduce((t, a) => t + a.credits, 0) };
    }
    case 'ugc': {
      const secs = Number(input.duration) || 15;
      const vt = videotypes.forPipeline('ugc');
      return { type, seconds: secs, units: secs, segments: segmentsFor(vt, secs), credits: Math.ceil(c.ugc_video_per_second * secs) + (input.write_script ? c.script : 0) + (needsFace('ugc', input) ? faceCredits() : 0) };
    }
    case 'video': {
      const secs = Number(input.duration) || 5;
      const vt = videotypes.forPipeline('video');
      return { type, seconds: secs, units: secs, segments: segmentsFor(vt, secs), credits: Math.ceil(c.video_per_second * secs) };
    }
    case 'image': { const n = Math.max(1, Math.min(10, Math.floor(Number(input.count)) || 1)); return { type, count: n, units: n, segments: 1, credits: c.image_3_sizes * n }; }
    case 'hooks': return { type, units: 1, segments: 1, credits: c.hook_pack_20 };
    case 'actor': return { type, count: 4, units: 4, segments: 1, credits: Number(c.actor_faces) > 0 ? Number(c.actor_faces) : 12 };
    case 'script': return { type, units: 1, segments: 1, credits: c.script };
    case 'angles': return { type, units: 1, segments: 1, credits: Number(c.angles) > 0 ? Number(c.angles) : 2 };
    case 'voice': { const secs = Number(input.duration) || 15; return { type, seconds: secs, units: secs, segments: 1, credits: Math.ceil(c.voice_per_second * secs) }; }
    case 'remix': return { type, units: 1, segments: 1, credits: c.remix };
    default: return { type, units: 0, segments: 0, credits: 0 };
  }
}

function trackPrice(vt, seconds) {
  const t = vt.price_by_seconds && typeof vt.price_by_seconds === 'object' ? Object.entries(vt.price_by_seconds).map(([k, v]) => [Number(k), Number(v)]).filter(([k, v]) => k > 0 && v > 0).sort((x, y) => x[0] - y[0]) : [];
  const hit = t.find(([k]) => k >= seconds) || t[t.length - 1];
  return hit ? Math.ceil(hit[1]) : Math.ceil(vt.credits_per_unit);
}

// {credits, base_credits, segments, seconds, adjusted, margin_pct, provider_cost_usd}
function quoteFull(type, input = {}, user) {
  const guard = require('./guard');
  const q = baseQuote(type, input, user);
  const parts = guard.costParts(q, input);
  const e = guard.evaluate(q.credits, parts.total);
  const adjusted = q.credits > 0 && !e.ok && e.safeCredits > q.credits;
  const credits = adjusted ? e.safeCredits : q.credits;
  const after = adjusted ? guard.evaluate(credits, e.providerCostUsd) : e;
  return {
    credits, base_credits: q.credits, segments: q.segments || 1, seconds: q.seconds || null, count: q.count || null, adjusted,
    margin_pct: after.marginPct, provider_cost_usd: after.providerCostUsd, video_type: q.vt ? q.vt.id : undefined,
    segment_seconds: q.vt ? q.vt.segment_seconds : undefined, addons: q.addons || [],
    level: q.level ? q.level.id : undefined, level_name: q.level ? q.level.name : undefined, model_label: q.level ? q.level.model_label : undefined,
    clips: q.clips || undefined, main_cost_usd: Math.round(parts.main * 1e4) / 1e4, bulk_pct: q.bulk_pct || 0, list_credits: q.list_credits || undefined,
  };
}
const quote = (type, input, user) => quoteFull(type, input, user).credits;

function ledger(userId, limit = 50) {
  return all('SELECT delta, bucket, reason, ref, created_at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);
}

module.exports = { needsFace, faceCredits, maxHooks, bulkPct, hookCount, balance, activePlan, spend, refund, grant, quote, quoteFull, baseQuote, videoSeconds, sceneCount, ledger };
