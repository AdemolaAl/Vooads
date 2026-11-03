// Loss guard + abuse limits (SPEC §4).
// Every job price is checked against the cheapest price a customer can pay for a credit. If the margin would fall
// below pricing.min_margin_pct, the job costs more credits (never runs at a loss). Limits stop trial and burst abuse.
const { get, all, run, db } = require('./db');
const { getSetting, pricing } = require('./settings');
const { fail } = require('./lib/http');
const providers = require('./providers');
const videotypes = require('./videotypes');
const levels = require('./levels');
const KIND_LEVELS = levels.KINDS;

db.exec(`CREATE TABLE IF NOT EXISTS signup_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, user_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS signup_log_ip ON signup_log(ip, created_at);`);

const CHARS_PER_SECOND = 15; // spoken text, about 2.5 words a second
const sqlTime = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace('T', ' ').slice(0, 19);
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

// ---------- Worst-case revenue per credit ----------
function maxDiscountPct() {
  const r = get("SELECT MAX(percent) AS m FROM discounts WHERE active = 1 AND (expires_at IS NULL OR expires_at = '' OR expires_at > ?) AND (max_uses IS NULL OR max_uses = 0 OR uses < max_uses)", new Date().toISOString());
  return Math.max(0, Math.min(100, Number(r?.m) || 0));
}
// ---------- Payment fees (Phase 2) ----------
// What a payment method charges us per purchase: the method's own config (fee_pct, fee_fixed_usd) when set, else
// pricing.payment_fees.by_adapter, else pricing.payment_fees.default. The guard uses the worst switched-on method.
const feeNum = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)));
function feeFor(adapter, cfg = {}) {
  const pf = pricing().payment_fees || {};
  const base = (pf.by_adapter && pf.by_adapter[adapter]) || pf.default || { pct: 0, fixed_usd: 0 };
  const pct = feeNum(cfg && cfg.fee_pct) ?? feeNum(base.pct) ?? 0;
  const fixed = feeNum(cfg && cfg.fee_fixed_usd) ?? feeNum(base.fixed_usd) ?? 0;
  // The customer fee built into this method's price (server/surcharge.js) pays part of the processing fee: per base dollar the
  // method keeps (1 + c)(1 − p). Never counted as more than the fee (pct floors at 0). Gatevoo (c = 0) is unchanged.
  const c = Number(cfg && cfg.customer_fee_pct) > 0 ? Math.min(Number(cfg.customer_fee_pct), 20) : 0;
  const net = c ? Math.max(0, 100 * (1 - (1 + c / 100) * (1 - Math.min(pct, 50) / 100))) : Math.min(pct, 50);
  return { pct: Math.round(net * 1000) / 1000, fixed_usd: Math.min(fixed, 20), gross_pct: Math.min(pct, 50), customer_fee_pct: c };
}
function worstFee() {
  let rows = [];
  try { rows = all('SELECT adapter, config FROM payment_methods WHERE enabled = 1'); } catch {}
  const list = rows.map((r) => ({ adapter: r.adapter, ...feeFor(r.adapter, (() => { try { return JSON.parse(r.config || '{}'); } catch { return {}; } })()) }));
  if (!list.length) { const d = (pricing().payment_fees || {}).default || { pct: 0, fixed_usd: 0 }; return { pct: feeNum(d.pct) || 0, fixed_usd: feeNum(d.fixed_usd) || 0, adapter: 'default' }; }
  return { pct: Math.max(...list.map((x) => x.pct)), fixed_usd: Math.max(...list.map((x) => x.fixed_usd)), adapter: list.sort((a, b) => b.pct - a.pct || b.fixed_usd - a.fixed_usd)[0].adapter };
}
// Money left from a purchase of `usd` after the fee.
const afterFee = (usd, f) => Math.max(0, usd * (1 - f.pct / 100) - f.fixed_usd);
function worstCaseUsdPerCredit() {
  const p = pricing();
  const disc = maxDiscountPct();
  const fee = worstFee();
  const prices = [];
  for (const pl of p.plans || []) {
    const c = Number(pl.credits_month);
    if (!(c > 0)) continue;
    const m = Number(pl.price_month) || 0;
    const y = Number(pl.price_year) || m * 10;
    prices.push(afterFee(m * (1 - disc / 100), fee) / c, afterFee(y, fee) / 12 / c); // codes only work on monthly billing (billing.js)
  }
  for (const t of p.topups || []) if (Number(t.credits) > 0) prices.push(afterFee(Number(t.price), fee) / Number(t.credits));
  const pos = prices.filter((x) => x > 0);
  return pos.length ? Math.min(...pos) : Number(p.credit_usd_value) || 0.01;
}
const minMarginPct = () => {
  const v = Number(pricing().min_margin_pct);
  return Number.isFinite(v) && v >= 0 && v < 100 ? v : 60;
};

// ---------- Provider cost ----------
// The provider row that will run this kind of step. In demo mode (no keys) the configured default row is used,
// so demo jobs are priced exactly like live ones.
// pred narrows the rows (voice tier, music source).
function rowFor(kind, pred = () => true) {
  const live = providers.chain(kind).filter((p) => p.adapter !== 'mock' && pred(providers.hydrate(p)));
  if (live.length) return live[0];
  return all('SELECT * FROM providers WHERE kind = ? AND enabled = 1 ORDER BY is_default DESC, priority ASC, id ASC', kind).map(providers.hydrate).find(pred) || null;
}
const tierOf = (row) => (row?.config?.tier === 'ultra' ? 'ultra' : 'standard');
function unitOf(row) {
  const u = String(row?.cost_unit || '').toLowerCase();
  if (/frame/.test(u)) return 'frames';
  if (/hour/.test(u)) return 'hour';
  if (/1k|1000|char/.test(u)) return 'k_chars';
  if (/sec/.test(u)) return 'second';
  if (/min/.test(u)) return 'minute';
  if (/image|script|call|request|video|clip|item|run|job|render/.test(u)) return 'item';
  return row?.kind === 'voice' ? 'k_chars' : ['video', 'ugc', 'dub'].includes(row?.kind) ? 'second' : 'item';
}
// Cost of one provider step. fallback() is used when no row has a cost set.
function stepCost(kind, { seconds = 0, calls = 1 } = {}, fallback = () => 0, pred) {
  const row = rowFor(kind, pred);
  const cost = Number(row?.cost_usd) || 0;
  if (!cost) return fallback();
  return rowCostFor(row, { seconds, calls });
}
// Cost of one provider row for `seconds` / `calls`. Units: per 1k characters, per second, per minute (optionally rounded up
// to whole minutes: config.round_up_minutes or "rounded" in the unit text), per hour, per N frames (at config.max_fps, 60 by
// default: matting is billed per frame and priced at the worst-case frame rate), or per call/item.
function rowCostFor(row, { seconds = 0, calls = 1 } = {}) {
  const cost = Number(row?.cost_usd) || 0;
  if (!cost) return 0;
  const u = String(row?.cost_unit || '').toLowerCase();
  switch (unitOf(row)) {
    case 'k_chars': return (seconds * CHARS_PER_SECOND / 1000) * cost;
    case 'second': return seconds * cost;
    case 'minute': return (row?.config?.round_up_minutes || /round/.test(u) ? Math.ceil(seconds / 60 - 1e-9) : seconds / 60) * cost;
    case 'hour': return (seconds / 3600) * cost;
    case 'frames': { const per = Number((u.match(/(\d+)\s*frame/) || [])[1]) || 1; const fps = Number(row?.config?.max_fps) || 60; return (seconds * fps / per) * cost; }
    default: return calls * cost;
  }
}
// The most expensive enabled row of a kind (live rows, or every enabled row in demo mode): new tools are priced on the worst
// provider that could run them, so switching on a pricier fallback can never make a job lose money.
function maxRowCost(kind, opts, fallback = () => 0, pred = () => true) {
  const live = providers.chain(kind).filter((p) => p.adapter !== 'mock' && pred(providers.hydrate(p)));
  const rows = live.length ? live : all('SELECT * FROM providers WHERE kind = ? AND enabled = 1', kind).map(providers.hydrate).filter(pred);
  const costs = rows.filter((r) => Number(r.cost_usd) > 0).map((r) => rowCostFor(r, opts));
  return costs.length ? Math.max(...costs) : fallback();
}
function legacyCosts() {
  const c = pricing().provider_cost_usd || {};
  return { text: Number(c.claude_script) || 0.062, image: Number(c.image) || 0.03, voiceK: Number(c.voice_per_1k_chars) || 0.1, ugc: Number(c.ugc_video_per_second) || 0.115, video: Number(c.video_per_second) || 0.07 };
}
const textCost = (calls = 1) => stepCost('text', { calls }, () => calls * legacyCosts().text);
// Voice cost for a tier: the tier's provider row (config.tier), else pricing.voice_tiers, else the legacy figure.
function voiceCostTier(seconds, tier = 'standard') {
  const addons = require('./addons');
  const t = addons.tiers()[tier] || {};
  const fb = () => (Number(t.cost_usd_per_second) ? seconds * Number(t.cost_usd_per_second) : (seconds * CHARS_PER_SECOND / 1000) * (Number(t.cost_usd_per_1k_chars) || legacyCosts().voiceK));
  const hasTier = rowFor('voice', (r) => tierOf(r) === tier);
  return stepCost('voice', { seconds }, fb, hasTier ? (r) => tierOf(r) === tier : undefined);
}
// Music cost: library tracks cost what pricing says (normally 0); AI music uses the first non-library music row, else the add-on figure.
function musicCost(seconds, source) {
  const a = require('./addons').all().music;
  const units = Math.max(seconds, Number(a.min_units) || 0);
  if (source === 'library') return units * (Number(a.library_provider_cost_usd_per_unit) || 0);
  if (source === 'brand') return 0; // the customer's own brand track: already paid for when it was made
  return stepCost('music', { seconds: units }, () => units * (Number(a.provider_cost_usd_per_unit) || 0), (r) => r.adapter !== 'library') + (Number(a.fixed_cost_usd) || 0);
}
const imageCost = (n) => stepCost('image', { calls: n }, () => n * legacyCosts().image);

// Provider cost (USD) of a job. `q` is the base quote from credits.baseQuote: {type, vt, seconds, units, segments, count, level, clips}.
// costParts also returns `main`: the cost of the main render (talking presenter or video model), used by jobs.js to decide
// whether a pricier fallback model is still covered by the job's price.
function costParts(q, input = {}) {
  let extra = q.vt ? Number(q.vt.fixed_cost_usd) || 0 : 0;
  if (q.vt) {
    const n = require('./addons').normalize(q.vt, input);
    if (n.music) extra += musicCost(require('./addons').audioSeconds(q.vt, q), n.music.source);
  }
  const p = pipelineCost(q, input);
  // Failure buffer: the share of provider cost lost on failed jobs of this type (5% until real data replaces it), so the
  // 60% margin still holds after failures. server/watchdog.js keeps the per-type figure up to date.
  const buf = failBufferFor(q);
  return { total: (p.cost + extra) * (1 + buf), main: p.main, failure_buffer: buf };
}
const providerCost = (q, input = {}) => costParts(q, input).total;
function failBufferFor(q) {
  if (!q.vt && !['ugc', 'video'].includes(q.type)) return 0; // text and image actions: no multi-step failures to cover
  try { return require('./watchdog').failBuffer(q.vt ? q.vt.id : q.type); } catch { return 0.05; }
}

// Main render cost on the quality level's provider rows (SPEC §13): the most expensive enabled model of the level, never a
// cheaper one. Jobs without a level use the standard rows. Falls back to the type's cost figure when no row has a cost.
function renderCost(q, kind, clips, fallback) {
  const c = levels.mainCost(kind, q.vt?.level || null, clips);
  return c == null ? fallback() : c;
}
const repeat = (n, len) => Array.from({ length: Math.max(1, n) }, () => len);

function pipelineCost(q, input = {}) {
  const r = pipelineCostInner(q, input);
  // A described presenter is one AI image render (credits.needsFace prices it).
  const pipe = q.vt ? q.vt.pipeline : q.type;
  if (require('./credits').needsFace(pipe, input)) r.cost += imageCost(1);
  return r;
}
function pipelineCostInner(q, input = {}) {
  const vt = q.vt;
  const s = q.seconds || 0;
  const tier = vt ? require('./addons').normalize(vt, input).voice_tier || 'standard' : 'standard';
  const voiceCost = (secs) => voiceCostTier(secs, tier);
  const mainFallback = () => (vt ? vt.provider_cost_usd_per_unit * (q.units || 0) : 0);
  const pipeline = vt ? vt.pipeline : q.type;
  const clips = q.clips || levels.clipPlan(s, vt ? vt.segment_seconds : null, pipeline, null);
  const out = (cost, main = 0) => ({ cost, main });
  switch (pipeline) {
    case 'ugc': {
      const kind = vt?.provider_kind || 'ugc';
      const main = KIND_LEVELS.includes(kind) ? renderCost(q, kind, clips, mainFallback) : stepCost(kind, { seconds: s, calls: q.segments || 1 }, mainFallback);
      return out(main + voiceCost(s) + (input.write_script ? textCost() : 0), main);
    }
    case 'video':
    case 'image_to_video': {
      const kind = vt?.provider_kind || 'video';
      const main = KIND_LEVELS.includes(kind) ? renderCost(q, kind, clips, mainFallback) : stepCost(kind, { seconds: s, calls: q.segments || 1 }, mainFallback);
      return out(main, main);
    }
    case 'slideshow': {
      const slides = q.count || 6;
      const img = rowFor('image') && Number(rowFor('image').cost_usd) ? imageCost(slides) : mainFallback();
      return out(img + voiceCost(s) + (Array.isArray(input.lines) && input.lines.length ? 0 : textCost()));
    }
    case 'dub': {
      const kind = rowFor('dub') ? 'dub' : 'ugc';
      const main = kind === 'ugc' ? renderCost(q, 'ugc', [s], mainFallback) : stepCost(kind, { seconds: s }, mainFallback);
      return out(textCost() + voiceCost(s) + main);
    }
    case 'hook_remix': {
      const n = q.count || 3;
      const kind = vt?.provider_kind || 'ugc';
      const perFallback = () => (vt ? vt.provider_cost_usd_per_unit : 0);
      const clip = KIND_LEVELS.includes(kind) ? renderCost(q, kind, [s], perFallback) : stepCost(kind, { seconds: s }, perFallback);
      return out(textCost() + n * (clip + voiceCost(s)), n * clip);
    }
    case 'motion_ad': {
      const n = q.count || 6;
      // One text call writes the scene plan (and the script when the customer gave none).
      if (vt?.quality === 'ultra') {
        // One AI video shot per scene, each rendered at the scene length (models with fixed durations bill their next length up).
        const main = renderCost(q, 'video', repeat(n, motionSceneSeconds(vt, s, n)), mainFallback);
        return out(main + voiceCost(s) + textCost(), main);
      }
      // Standard: stock clips are free; price as if every scene fell back to an AI image (worst case).
      const img = rowFor('image') && Number(rowFor('image').cost_usd) ? imageCost(n) : mainFallback();
      return out(img + voiceCost(s) + textCost());
    }
    case 'bg_swap': {
      // Background removal on every second of the upload (priced at 60 fps), the AI background picture when asked, and our
      // own ffmpeg time (compute_cost_usd_per_second).
      const matte = maxRowCost('matting', { seconds: s }, mainFallback);
      const bg = input.bg_kind === 'ai' ? imageCost(1) : 0;
      return out(matte + bg + s * (Number(vt?.compute_cost_usd_per_second) || 0), matte);
    }
    case 'auto_edit': {
      // Speech-to-text on the raw length, the AI edit plan (one text call per 2 minutes of footage) and ffmpeg time. When an
      // outside auto-edit service (kind "autoedit") is switched on, the job is priced on whichever costs more.
      const stt = maxRowCost('stt', { seconds: s }, mainFallback);
      const own = stt + textCost(Math.max(1, Math.ceil(s / 120))) + s * (Number(vt?.compute_cost_usd_per_second) || 0);
      const ext = maxRowCost('autoedit', { seconds: s, calls: 1 }, () => 0);
      return out(Math.max(own, ext), stt);
    }
    case 'brand_music': {
      // AI music rows only (the library cannot compose). fal bills whole minutes, so 15s costs a full minute there.
      const m = maxRowCost('music', { seconds: s, calls: 1 }, () => (vt ? vt.provider_cost_usd_per_unit * Math.ceil(s / 60) : 0), (r) => r.adapter !== 'library');
      return out(m, m);
    }
    case 'street': {
      // One AI video clip with native dialogue audio per part (segment_seconds, 8s on Veo 3.1), plus the Q&A script call.
      const parts = Math.max(1, Math.ceil(s / (Number(vt?.level?.segment_seconds) || Number(vt?.segment_seconds) || 8)));
      const len = s / parts;
      const main = renderCost(q, 'video', repeat(parts, len), mainFallback);
      return out(main + (String(input.script || '').trim() ? 0 : textCost()), main);
    }
    case 'mad_edit': {
      // AI mode: one AI shot per segment (cut into many beat-length pieces locally) + the edit plan call + ffmpeg time.
      // Own footage: the plan call and ffmpeg time only. Sound effects and the beat are generated locally (server/sfx.js).
      const compute = s * (Number(vt?.compute_cost_usd_per_second) || 0);
      if (input.source === 'own') return out(textCost() + compute);
      const segs = Math.max(1, Math.ceil(s / (Number(vt?.segment_seconds) || 5)));
      const main = renderCost(q, 'video', repeat(segs, Number(vt?.segment_seconds) || 5), mainFallback);
      return out(main + textCost() + compute, main);
    }
    case 'image': return out(imageCost(3 * (q.count || 1)));
    case 'hooks': case 'script': case 'angles': return out(textCost());
    case 'actor': return out(imageCost(q.count || 4));
    case 'voice': return out(voiceCostTier(s));
    default: return out(0);
  }
}
// Length of one Animated ad (Ultra) scene shot: the level's segment_seconds, else the type's, at least the scene's screen time.
function motionSceneSeconds(vt, seconds, n) {
  const T = 0.35, E = Math.min(3, Math.max(2, seconds * 0.15)), D = (seconds - E + n * T) / n; // same timing as jobs.motionTiming
  const want = Number(vt?.level?.segment_seconds) || Number(vt?.segment_seconds) || 5;
  return Math.max(want, Math.ceil(D));
}

// ---------- The check ----------
// Returns the margin at `credits`, plus the smallest safe credit price.
function evaluate(credits, costUsd) {
  const usdPerCredit = worstCaseUsdPerCredit();
  const m = minMarginPct() / 100;
  const revenueUsd = credits * usdPerCredit;
  const marginPct = revenueUsd > 0 ? ((revenueUsd - costUsd) / revenueUsd) * 100 : costUsd > 0 ? -100 : 100;
  const safeCredits = costUsd > 0 ? Math.ceil(round(costUsd / (1 - m) / usdPerCredit, 6)) : 0;
  return { ok: marginPct >= m * 100 - 1e-9, credits, providerCostUsd: round(costUsd), revenueUsd: round(revenueUsd), marginPct: round(marginPct, 1), safeCredits, usdPerCredit: round(usdPerCredit, 6), minMarginPct: m * 100 };
}

// check(type, input): uses the normal quote, then the margin rule. See credits.quoteFull for the adjusted price.
function check(type, input = {}, user = null) {
  const credits = require('./credits');
  const q = credits.baseQuote(type, input, user);
  return evaluate(q.credits, providerCost(q, input));
}

// ---------- Abuse limits ----------
const limits = () => getSetting('limits');

function checkJobLimits(user, credits, plan) {
  const L = limits();
  // The showcase house account (server/showcase.js) runs the owner's pack in one go; it holds only the credits granted
  // for those jobs, so the per-customer limits do not apply to it.
  try { if (JSON.parse(user.flags || '{}').house === 1 && user.email === require('./showcase').HOUSE_EMAIL) return; } catch {}
  if (!plan && Number(L.trial_max_jobs_per_day) > 0) {
    const n = get('SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND created_at >= ?', user.id, sqlTime(864e5)).c;
    if (n >= Number(L.trial_max_jobs_per_day)) fail(429, `The free trial allows ${L.trial_max_jobs_per_day} jobs a day. Pick a plan to keep going today.`);
  }
  if (Number(L.max_concurrent_jobs) > 0) {
    const n = get("SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND status IN ('queued','running')", user.id).c;
    if (n >= Number(L.max_concurrent_jobs)) fail(429, `You already have ${n} jobs running. Wait for one to finish, then start the next.`, { limit: 'max_concurrent_jobs' });
  }
  if (Number(L.daily_credit_cap) > 0) {
    const used = get('SELECT COALESCE(SUM(credits),0) AS t FROM jobs WHERE user_id = ? AND refunded = 0 AND created_at >= ?', user.id, sqlTime(864e5)).t;
    if (used + credits > Number(L.daily_credit_cap)) fail(429, `Daily limit reached: ${L.daily_credit_cap} credits a day. Contact support to raise it.`, { limit: 'daily_credit_cap' });
  }
}

function checkSignup(ip) {
  const max = Number(limits().max_signups_per_ip_per_day);
  if (!(max > 0) || !ip) return;
  const n = get('SELECT COUNT(*) AS c FROM signup_log WHERE ip = ? AND created_at >= ?', String(ip), sqlTime(864e5)).c;
  if (n >= max) fail(429, 'Too many new accounts from this network today. Try again tomorrow or contact support.');
}
// ---------- Free trial credits: one per person ----------
// The same inbox written differently (Gmail dots, "+tags" on any provider, googlemail.com) or a throwaway inbox gets
// no second free trial; neither does a network that already took max_trials_per_ip_per_30d trials. The account still
// works and can buy a plan; only the free credits are skipped. Trial credits never pay for video (credits.js).
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com', 'tempail.com', 'moakt.com', 'spamgourmet.com']);
function canonicalEmail(email) {
  let [local, domain] = String(email || '').trim().toLowerCase().split('@');
  if (!local || !domain) return String(email || '').toLowerCase();
  if (domain === 'googlemail.com') domain = 'gmail.com';
  local = local.split('+')[0];
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local + '@' + domain;
}
try {
  const cols = all('PRAGMA table_info(users)').map((c) => c.name);
  if (!cols.includes('email_canon')) { run('ALTER TABLE users ADD COLUMN email_canon TEXT'); for (const u of all('SELECT id, email FROM users')) run('UPDATE users SET email_canon = ? WHERE id = ?', canonicalEmail(u.email), u.id); }
  run('CREATE INDEX IF NOT EXISTS users_email_canon ON users(email_canon)');
} catch (e) { console.error('[guard] migrate', e.message); }
// Returns { ok, reason } for giving free trial credits to this new email from this network.
function trialAllowed(email, ip) {
  const canon = canonicalEmail(email);
  const domain = canon.split('@')[1] || '';
  if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable_email' };
  if (get('SELECT 1 FROM users WHERE email_canon = ? LIMIT 1', canon)) return { ok: false, reason: 'same_inbox' };
  const max = Number(limits().max_trials_per_ip_per_30d);
  if (max > 0 && ip) {
    const n = get("SELECT COUNT(DISTINCT s.user_id) AS c FROM signup_log s JOIN credit_ledger l ON l.user_id = s.user_id AND l.bucket = 'trial' AND l.delta > 0 WHERE s.ip = ? AND s.created_at >= ?", String(ip), sqlTime(30 * 864e5)).c;
    if (n >= max) return { ok: false, reason: 'network_limit' };
  }
  return { ok: true };
}
const logSignup = (ip, userId) => run('INSERT INTO signup_log(ip, user_id) VALUES(?,?)', String(ip || ''), userId);

// ---------- Admin margins report ----------
// The sample job a type is checked on: 15 seconds (or the shortest allowed) with the AI script, one hook for hook remix.
function sampleInput(t) {
  if (t.pipeline === 'brand_music') return { video_type: t.id, duration: 60, count: 1 };
  const secs = t.unit === 'item' ? Math.min(5, Math.max(3, t.min_seconds || 4)) : Math.max(t.min_seconds || 5, 15);
  return { video_type: t.id, duration: secs, count: 1, write_script: ['ugc', 'motion_ad'].includes(t.pipeline) };
}
// Worst cases admins should also see for the editing tools (longest length, AI extras on).
function worstInputs(t) {
  if (t.pipeline === 'bg_swap') return [['AI background, 10s', { video_type: t.id, duration: 10, bg_kind: 'ai' }], ['AI background, 120s', { video_type: t.id, duration: 120, bg_kind: 'ai' }]];
  if (t.pipeline === 'auto_edit') return [['5 min raw + AI music', { video_type: t.id, duration: 300, music: { enabled: true, source: 'ai' } }], ['10s raw (minimum price)', { video_type: t.id, duration: 10 }]];
  if (t.pipeline === 'mad_edit') return [['own videos, 60s', { video_type: t.id, duration: 60, source: 'own' }], ['AI shots, 60s', { video_type: t.id, duration: 60 }]];
  if (t.pipeline === 'street') return [['60s, script written by AI', { video_type: t.id, duration: 60 }]];
  if (t.pipeline === 'hook_remix') return [['10 hooks (bulk price)', { video_type: t.id, duration: 5, count: 10 }], ['5 hooks (bulk price)', { video_type: t.id, duration: 5, count: 5 }]];
  if (t.pipeline === 'brand_music') return [['15s track', { video_type: t.id, duration: 15 }], ['120s track', { video_type: t.id, duration: 120 }]];
  return [];
}
// Lowest whole credits per unit at which a level clears the minimum margin on the sample job (with the AI script).
function safeLevelPrice(t, lv) {
  const credits = require('./credits');
  const input = sampleInput(t);
  const q = credits.baseQuote('video_type', input, null, { level: lv });
  const e = evaluate(q.credits, providerCost(q, input));
  if (e.ok) return lv.credits_per_unit;
  const units = Math.max(1, q.units || 1);
  return Math.ceil(lv.credits_per_unit + (e.safeCredits - q.credits) / units);
}
// Pricing save (Admin → Pricing): every enabled level must clear the minimum margin. Levels below it are raised to the
// guard's safe price (whole credits). Returns [{type, level, from, to}].
function raiseLevels(p) {
  const raised = [];
  for (const raw of p.video_types || []) {
    const t = videotypes.all().find((x) => x.id === raw.id);
    if (!t || !Array.isArray(raw.levels)) continue;
    for (const rl of raw.levels) {
      const lv = levels.list(t).find((x) => x.id === rl.id);
      if (!lv || !lv.enabled) continue;
      const safe = safeLevelPrice(t, lv);
      if (safe > lv.credits_per_unit) { raised.push({ type: t.id, type_name: t.name, level: lv.id, level_name: lv.name, from: lv.credits_per_unit, to: safe }); rl.credits_per_unit = safe; }
    }
  }
  return raised;
}
// Free-to-the-user AI steps (the chat-edit planner): what one message really costs on the live text model, the fee after
// the free allowance, and the worst monthly cost of each plan's free allowance against that plan's net price.
const PLANNER_TOKENS = { input_tokens: 3200, output_tokens: 700 }; // a long edit thread with the video context
function llmRows() {
  const bill = require('./llmbill');
  const c = getSetting('llm');
  const row = providers.chain('text')[0];
  const model = row && row.adapter !== 'mock' ? row.model || row.adapter : 'claude-sonnet-5-5';
  const per = bill.costOf(model, PLANNER_TOKENS).cost_usd;
  const out = [];
  const fee = Math.max(0, Number(c.chat_edit.credits_per_message) || 0);
  const e = evaluate(fee, per);
  out.push({ kind: 'llm', id: 'chat_edit_message', name: `Chat edit · one paid planner message (${model})`, unit: 'message', credits: fee, safe_credits: Math.max(fee, e.safeCredits), provider_cost_usd: e.providerCostUsd, revenue_usd: e.revenueUsd, margin_pct: e.marginPct, status: e.marginPct < 0 ? 'loss' : e.ok ? 'ok' : 'low' });
  const feeW = worstFee();
  for (const pl of pricing().plans || []) {
    const n = Number(c.chat_edit.free_per_day?.[pl.id] ?? 0) || 0;
    const cost = round(n * 30 * per);
    const rev = round(afterFee(Number(pl.price_month) || 0, feeW));
    const pct = rev > 0 ? round((cost / rev) * 100, 1) : 100;
    out.push({ kind: 'llm_allowance', id: 'chat_edit_free_' + pl.id, name: `Chat edit · ${pl.name} free allowance (${n} a day, used every day)`, unit: 'month', credits: 0, provider_cost_usd: cost, revenue_usd: rev, margin_pct: round(100 - pct, 1), share_of_plan_pct: pct, status: pct > 5 ? 'low' : 'ok' });
  }
  out.push({ kind: 'llm_cap', id: 'llm_daily_cap', name: `House AI text bill · daily cap $${Number(c.daily_cap_usd) || 0} (alert at ${c.alert_pct}%)`, unit: 'day', credits: 0, provider_cost_usd: round(bill.spentToday()), revenue_usd: 0, margin_pct: 100, status: bill.capReached() ? 'low' : 'ok' });
  return out;
}
function margins() {
  const credits = require('./credits');
  const rows = [];
  const status = (e) => (e.marginPct < 0 ? 'loss' : e.ok ? 'ok' : 'low');
  const push = (kind, id, name, unit, type, input) => {
    const q = credits.baseQuote(type, input, null);
    const e = evaluate(q.credits, providerCost(q, input));
    rows.push({ kind, id, name, unit, failure_buffer_pct: Math.round(failBufferFor(q) * 1000) / 10, sample: { seconds: q.seconds || null, count: q.count || null }, credits: q.credits, safe_credits: Math.max(q.credits, e.safeCredits), provider_cost_usd: e.providerCostUsd, revenue_usd: e.revenueUsd, margin_pct: e.marginPct, status: status(e) });
  };
  const addons = require('./addons');
  for (const t of videotypes.all()) {
    const input = sampleInput(t);
    push('video_type', t.id, t.name + (t.enabled ? '' : ' (off)'), t.unit, 'video_type', input);
    // Same type with every allowed add-on switched on, so admins see the add-on margin too.
    const ok = addons.allowed(t);
    if (ok.length) push('video_type+addons', t.id, `${t.name} + ${ok.map((x) => addons.all()[x].name.toLowerCase()).join(' + ')}`, t.unit, 'video_type', { ...input, music: ok.includes('music') ? { enabled: true, source: 'ai' } : undefined, voice_tier: ok.includes('voice_ultra') ? 'ultra' : undefined });
    for (const [label, wi] of worstInputs(t)) push('video_type_worst', t.id, `${t.name} · ${label}`, t.unit, 'video_type', wi);
  }
  // Quality levels (SPEC §13): one row per level, priced on that level's own models.
  for (const t of videotypes.all()) {
    for (const lv of levels.list(t)) {
      const input = sampleInput(t);
      const q = credits.baseQuote('video_type', input, null, { level: lv });
      const e = evaluate(q.credits, providerCost(q, input));
      const live = levels.available(t).some((x) => x.id === lv.id);
      rows.push({ kind: 'video_type_level', id: t.id + ':' + lv.id, type_id: t.id, level: lv.id, name: `${t.name} · ${lv.name}${t.enabled && live ? '' : ' (off)'}`, provider: lv.model_label, enabled: t.enabled && live, unit: t.unit, min_plan: lv.min_plan,
        credits_per_unit: lv.credits_per_unit, sample_units: q.units, sample: { seconds: q.seconds || null, count: q.count || null }, credits: q.credits, safe_credits: Math.max(q.credits, e.safeCredits),
        safe_credits_per_unit: safeLevelPrice(t, lv), provider_cost_usd: e.providerCostUsd, revenue_usd: e.revenueUsd, margin_pct: e.marginPct, status: status(e) });
    }
  }
  push('job', 'ugc', 'UGC video (classic, 15s + AI script)', 'second', 'ugc', { duration: 15, write_script: true });
  push('job', 'video', 'Short video (classic, 5s)', 'second', 'video', { duration: 5 });
  push('job', 'image', 'Image set (3 sizes)', 'item', 'image', { count: 1 });
  push('job', 'hooks', 'Hook pack (20)', 'item', 'hooks', {});
  push('job', 'script', 'AI script', 'item', 'script', {});
  push('job', 'angles', 'Angles (10)', 'item', 'angles', {});
  push('job', 'actor', 'New actor (4 AI faces)', 'item', 'actor', { description: 'sample' });
  return { usd_per_credit: round(worstCaseUsdPerCredit(), 6), max_discount_pct: maxDiscountPct(), min_margin_pct: minMarginPct(), payment_fee: worstFee(), rows: [...rows, ...llmRows()] };
}

module.exports = { feeFor, worstFee, afterFee, canonicalEmail, trialAllowed, rowCostFor, maxRowCost, worstInputs, sampleInput, safeLevelPrice, raiseLevels, worstCaseUsdPerCredit, minMarginPct, providerCost, costParts, motionSceneSeconds, evaluate, check, checkJobLimits, checkSignup, logSignup, margins, limits, rowFor };
