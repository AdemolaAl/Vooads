// Quality levels (SPEC §13): a video type can offer up to three levels (standard, pro, ultra), each a specific model with its
// own provider row and price. Pure module: provider rows come from the database on the server, or from setRowSource() in the
// demo. Types without "levels" in pricing.video_types behave exactly as before (they run on the standard provider rows).
//
// Provider rows (kinds ugc and video) carry config.level ('standard' | 'pro' | 'ultra', default standard) and config.tag
// (a short model id such as 'veo-3.1'). A level picks its main model with provider_tag; every enabled row of the same kind
// and level is a fallback. Rows can also set config.clip_durations (e.g. [4, 6, 8] for Veo) so the guard prices the clip
// lengths the model really bills.
const { pricing } = require('./settings');

const IDS = ['standard', 'pro', 'ultra'];
const RANK = { standard: 0, pro: 1, ultra: 2 };
const NAMES = { standard: 'Standard', pro: 'Pro realistic', ultra: 'Ultra cinematic' };
const KINDS = ['ugc', 'video']; // provider kinds that have quality levels
const CLIP_PIPELINES = ['ugc', 'video', 'image_to_video'];

let rowSource = null;
function setRowSource(fn) { rowSource = fn; }
function rows() {
  if (rowSource) return rowSource() || [];
  try {
    const db = require('./db');
    const providers = require('./providers');
    return db.all('SELECT * FROM providers').map(providers.hydrate);
  } catch { return []; }
}

const rowLevel = (r) => (r && r.config && IDS.includes(r.config.level) ? r.config.level : 'standard');
const rowTag = (r) => String((r && r.config && r.config.tag) || '');
const isOn = (r) => !!(r && r.enabled && Number(r.enabled) !== 0 && r.adapter !== 'mock');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Enabled rows of a kind at a level (key or not: an enabled row is a row the admin wants used, so it is priced).
function levelRows(kind, levelId, all = rows()) {
  return all.filter((r) => r.kind === kind && isOn(r) && rowLevel(r) === levelId);
}
// The level's main row (provider_tag), else the best enabled row at that level.
function primaryRow(kind, level, all = rows()) {
  const at = levelRows(kind, level.id, all);
  const tagged = level.provider_tag ? all.find((r) => r.kind === kind && rowTag(r) === level.provider_tag && isOn(r)) : null;
  if (tagged) return tagged;
  return at.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || num(a.priority, 100) - num(b.priority, 100) || a.id - b.id)[0] || null;
}

function normLevel(l) {
  const id = IDS.includes(l.id) ? l.id : null;
  if (!id) return null;
  return {
    id, name: String(l.name || NAMES[id]), model_label: String(l.model_label || ''), benefit: String(l.benefit || ''),
    provider_tag: l.provider_tag ? String(l.provider_tag) : '',
    credits_per_unit: num(l.credits_per_unit) > 0 ? num(l.credits_per_unit) : null,
    provider_cost_usd_per_unit: num(l.provider_cost_usd_per_unit, 0),
    min_plan: l.min_plan || null,
    segment_seconds: num(l.segment_seconds) > 0 ? num(l.segment_seconds) : null,
    enabled: l.enabled !== false,
    notes: l.notes ? String(l.notes) : '',
  };
}
// Every configured level of a type, in standard → ultra order (the admin sees disabled ones too).
function list(vt) {
  if (!vt || !Array.isArray(vt.levels) || !KINDS.includes(vt.provider_kind)) return [];
  const seen = new Set();
  return vt.levels.map(normLevel).filter((l) => l && l.credits_per_unit && !seen.has(l.id) && seen.add(l.id)).sort((a, b) => RANK[a.id] - RANK[b.id]);
}
const hasLevels = (vt) => list(vt).length > 0;
// Levels customers can pick: switched on, with an enabled model behind them. Standard is always there (demo mode falls back to samples).
function available(vt, all = rows()) {
  return list(vt).filter((l) => l.enabled && (l.id === 'standard' || levelRows(vt.provider_kind, l.id, all).length > 0));
}
// The level a request asks for ('' = standard). null when the type has no levels or the level is not available.
function pick(vt, levelId, all) {
  const av = available(vt, all);
  if (!av.length) return null;
  return av.find((l) => l.id === (levelId || 'standard')) || null;
}
// The type as the job sees it: the level's price, cost fallback and render length replace the type's.
function apply(vt, level) {
  if (!level) return vt;
  return { ...vt, credits_per_unit: level.credits_per_unit, provider_cost_usd_per_unit: level.provider_cost_usd_per_unit || vt.provider_cost_usd_per_unit, segment_seconds: level.segment_seconds || vt.segment_seconds, level };
}

// Plan check. planRank(id) and the plan list come from videotypes/pricing.
function lockedReason(level, plan) {
  if (!level || !level.min_plan) return null;
  const plans = pricing().plans || [];
  const rank = (id) => plans.findIndex((p) => p.id === id);
  if (plan && rank(plan.id) >= rank(level.min_plan)) return null;
  const p = plans.find((x) => x.id === level.min_plan);
  return `${level.name}${level.model_label ? ' (' + level.model_label + ')' : ''} is on the ${p ? p.name : level.min_plan} plan and above.`;
}

// ---------- Clip plans and cost ----------
// Shortest set of n clips, each one of `allowed`, that covers `seconds`.
function bestClips(seconds, n, allowed) {
  const a = [...new Set(allowed.map(Number).filter((x) => x > 0))].sort((x, y) => x - y);
  let best = null;
  const walk = (k, from, acc, sum) => {
    if (k === n) { if (sum >= seconds - 1e-9 && (!best || sum < best.sum)) best = { sum, clips: acc.slice() }; return; }
    for (let i = from; i < a.length; i++) { acc.push(a[i]); walk(k + 1, i, acc, sum + a[i]); acc.pop(); }
  };
  if (n <= 12 && a.length <= 6) walk(0, 0, [], 0);
  if (!best) return Array.from({ length: n }, () => a[a.length - 1]);
  return best.clips.sort((x, y) => y - x);
}
// Clip lengths a render is split into. Matches jobs.js: video parts are segLen long with the last at least 5s; UGC parts share
// the length evenly (the voice drives them). Models with fixed durations (allowed) get the cheapest covering set.
function clipPlan(seconds, segLen, pipeline, allowed) {
  seconds = Math.max(0, num(seconds));
  const seg = num(segLen) > 0 ? num(segLen) : seconds || 1;
  const n = seconds > seg ? Math.ceil(seconds / seg) : 1;
  if (Array.isArray(allowed) && allowed.length) return bestClips(seconds, n, allowed.filter((x) => num(x) <= Math.max(seg, Math.min(...allowed))));
  if (n === 1) return [seconds];
  if (pipeline === 'ugc') return Array.from({ length: n }, () => Math.round((seconds / n) * 100) / 100);
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? Math.max(5, seconds - seg * (n - 1)) : seg));
}
// Seconds a model bills for one clip (fixed durations round up).
function billSeconds(sec, row) {
  const a = row && row.config && Array.isArray(row.config.clip_durations) ? row.config.clip_durations.map(Number).filter((x) => x > 0).sort((x, y) => x - y) : null;
  const min = num(row && row.config && row.config.min_clip_seconds);
  if (!a || !a.length) return Math.max(sec, min);
  const up = a.find((x) => x >= sec - 1e-9);
  return Math.max(up === undefined ? a[a.length - 1] * Math.ceil(sec / a[a.length - 1]) : up, min);
}
function unitOf(row) {
  const u = String((row && row.cost_unit) || '').toLowerCase();
  if (/1k|1000|char/.test(u)) return 'k_chars';
  if (/sec/.test(u)) return 'second';
  if (/min/.test(u)) return 'minute';
  if (/image|script|call|request|video|clip|item|run|job|render/.test(u)) return 'item';
  return 'second';
}
// Provider cost of rendering these clips on one row.
function rowCost(row, clips) {
  const cost = num(row && row.cost_usd);
  if (!cost) return 0;
  const billed = clips.reduce((t, c) => t + billSeconds(c, row), 0);
  switch (unitOf(row)) {
    case 'minute': return (billed / 60) * cost;
    case 'item': return clips.length * cost;
    case 'k_chars': return (billed * 15 / 1000) * cost;
    default: return billed * cost;
  }
}
// What the guard charges for the main render: the most expensive enabled row of the level (its main model and every
// same-level fallback). Never a cheaper one. null when no row has a cost (the caller uses the type's cost figure).
function mainCost(kind, level, clips, all = rows()) {
  const lv = level || { id: 'standard', provider_tag: '' };
  const cand = levelRows(kind, lv.id, all);
  const p = primaryRow(kind, lv, all);
  if (p && !cand.includes(p)) cand.push(p);
  const costs = cand.filter((r) => num(r.cost_usd) > 0).map((r) => rowCost(r, clips));
  return costs.length ? Math.max(...costs) : null;
}
// Allowed clip lengths of the level's main model (null = any length).
function allowedFor(kind, level, all = rows()) {
  const p = primaryRow(kind, level || { id: 'standard', provider_tag: '' }, all);
  const a = p && p.config && Array.isArray(p.config.clip_durations) ? p.config.clip_durations.map(Number).filter((x) => x > 0) : null;
  return a && a.length ? a : null;
}
// Clip plan for a quote. vt has the level applied (credits.baseQuote).
function clipsFor(vt, seconds, all = rows()) {
  if (!vt || !CLIP_PIPELINES.includes(vt.pipeline)) return null;
  return clipPlan(seconds, vt.segment_seconds, vt.pipeline, allowedFor(vt.provider_kind || 'video', vt.level, all));
}

// Run-time order for a render step: the level's main model, then other rows at the same level, then (only when the job's
// price still covers them, see jobs.js) rows of a higher level. Never a cheaper level. `live` = providers.chain(kind).
function runChain(kind, level, live, canAfford = () => false) {
  const lv = level || { id: 'standard', provider_tag: '' };
  if (live.length && live[0].adapter === 'mock') return live; // demo mode: samples
  // Same level first (its main model first), then LOWER levels, best first. Never a pricier level: the customer did not agree
  // to it (jobs.js gives back the price difference when a lower level did the work).
  const same = live.filter((r) => rowLevel(r) === lv.id).sort((a, b) => (rowTag(b) === lv.provider_tag ? 1 : 0) - (rowTag(a) === lv.provider_tag ? 1 : 0));
  const lower = live.filter((r) => RANK[rowLevel(r)] < RANK[lv.id]).sort((a, b) => RANK[rowLevel(b)] - RANK[rowLevel(a)]);
  return [...same, ...lower];
}

// Studio view of a type's levels for a plan.
function view(vt, plan, all = rows()) {
  const plans = pricing().plans || [];
  return available(vt, all).map((l) => {
    const locked = lockedReason(l, plan);
    const p = l.min_plan ? plans.find((x) => x.id === l.min_plan) : null;
    return { id: l.id, name: l.name, model_label: l.model_label, benefit: l.benefit, credits_per_unit: l.credits_per_unit, min_plan: l.min_plan, min_plan_name: p ? p.name : null, segment_seconds: l.segment_seconds || vt.segment_seconds, locked: !!locked, locked_reason: locked };
  });
}

module.exports = { IDS, RANK, NAMES, KINDS, setRowSource, rows, rowLevel, rowTag, levelRows, primaryRow, list, hasLevels, available, pick, apply, lockedReason, clipPlan, bestClips, billSeconds, rowCost, mainCost, allowedFor, clipsFor, runChain, view };
