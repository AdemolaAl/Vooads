// Paid add-ons on video jobs (SPEC §12): background music and the ultra-realistic voice tier.
// Prices come from pricing.addons / pricing.voice_tiers; the defaults below only apply when those keys are missing.
const { pricing } = require('./settings');

const MOODS = ['upbeat', 'chill', 'cinematic', 'corporate', 'hiphop', 'emotional'];
const DEFAULT_ADDONS = {
  music: { name: 'Background music', unit: 'second', credits_per_unit: 2, provider_cost_usd_per_unit: 0.0025, fixed_cost_usd: 0.15, min_units: 10, provider_kind: 'music', min_plan: 'starter', library_credits_per_unit: 0, library_provider_cost_usd_per_unit: 0 },
  voice_ultra: { name: 'Ultra-realistic voice', unit: 'second', credits_per_unit: 1, provider_cost_usd_per_unit: 0.0015, provider_kind: 'voice', min_plan: 'starter' },
};
const DEFAULT_TIERS = {
  standard: { label: 'Standard voice', cost_usd_per_1k_chars: 0.04, cost_usd_per_second: 0.0006 },
  ultra: { label: 'Ultra-realistic voice', cost_usd_per_1k_chars: 0.1, cost_usd_per_second: 0.0015 },
};
// Pipelines that have a soundtrack music can sit under, and pipelines with a voiceover.
const MUSIC_PIPELINES = ['ugc', 'video', 'image_to_video', 'slideshow', 'motion_ad', 'auto_edit'];
const VOICE_PIPELINES = ['ugc', 'slideshow', 'dub', 'hook_remix', 'motion_ad'];

function all() {
  const a = pricing().addons || {};
  return { music: { ...DEFAULT_ADDONS.music, ...(a.music || {}) }, voice_ultra: { ...DEFAULT_ADDONS.voice_ultra, ...(a.voice_ultra || {}) } };
}
function tiers() {
  const t = pricing().voice_tiers || {};
  return { standard: { ...DEFAULT_TIERS.standard, ...(t.standard || {}) }, ultra: { ...DEFAULT_TIERS.ultra, ...(t.ultra || {}) } };
}

// Which add-ons a video type can take. pricing.video_types[].addons_allowed wins; otherwise by pipeline.
function allowed(vt) {
  if (!vt) return [];
  const list = Array.isArray(vt.addons_allowed) ? vt.addons_allowed : [...(MUSIC_PIPELINES.includes(vt.pipeline) ? ['music'] : []), ...(VOICE_PIPELINES.includes(vt.pipeline) ? ['voice_ultra'] : [])];
  return list.filter((x) => x === 'music' ? MUSIC_PIPELINES.includes(vt.pipeline) : x === 'voice_ultra' ? VOICE_PIPELINES.includes(vt.pipeline) : false);
}
const included = (vt) => (Array.isArray(vt?.includes) ? vt.includes : []);

// Normalise job input → {music: {enabled, mood, source} | null, voice_tier}
function normalize(vt, input = {}) {
  const ok = allowed(vt);
  const m = input.music && typeof input.music === 'object' ? input.music : input.music === true ? { enabled: true } : null;
  const music = m && m.enabled !== false && ok.includes('music')
    ? { enabled: true, mood: MOODS.includes(m.mood) ? m.mood : 'upbeat', source: m.source === 'library' ? 'library' : m.source === 'brand' && Number(m.track_id) > 0 ? 'brand' : 'ai', ...(m.source === 'brand' && Number(m.track_id) > 0 ? { track_id: Math.floor(Number(m.track_id)) } : {}) }
    : null;
  let tier = vt?.voice_tier_default === 'ultra' ? 'ultra' : 'standard';
  if (included(vt).includes('voice_ultra')) tier = 'ultra';
  else if (input.voice_tier === 'ultra' && ok.includes('voice_ultra')) tier = 'ultra';
  else if (input.voice_tier === 'standard') tier = 'standard';
  return { music, voice_tier: VOICE_PIPELINES.includes(vt?.pipeline) ? tier : undefined };
}

// Seconds of voice/music a job has (hook remix: every hook clip).
const audioSeconds = (vt, q) => (vt?.pipeline === 'hook_remix' ? (q.seconds || 0) * (q.count || 1) : q.seconds || 0);

// Credit lines for the quote: [{id, name, units, credits}]
function lines(vt, input, q) {
  const n = normalize(vt, input);
  const a = all();
  const secs = audioSeconds(vt, q);
  const out = [];
  if (n.music) {
    const units = Math.max(secs, Number(a.music.min_units) || 0);
    // Library tracks cost what pricing says (normally 0); the customer's own brand track is free (already paid for).
    const per = n.music.source === 'brand' ? 0 : n.music.source === 'library' ? Number(a.music.library_credits_per_unit) || 0 : Number(a.music.credits_per_unit) || 0;
    out.push({ id: 'music', name: a.music.name, source: n.music.source, units, credits: Math.ceil(per * units) });
  }
  if (n.voice_tier === 'ultra' && !included(vt).includes('voice_ultra') && vt?.voice_tier_default !== 'ultra') {
    out.push({ id: 'voice_ultra', name: a.voice_ultra.name, units: secs, credits: Math.ceil((Number(a.voice_ultra.credits_per_unit) || 0) * secs) });
  }
  return out;
}

// Studio view: prices per second so the builder can show add-on lines.
function publicView() {
  const a = all();
  return {
    music: { name: a.music.name, credits_per_second: a.music.credits_per_unit, library_credits_per_second: a.music.library_credits_per_unit, min_seconds: a.music.min_units, min_plan: a.music.min_plan, moods: MOODS },
    voice_ultra: { name: a.voice_ultra.name, credits_per_second: a.voice_ultra.credits_per_unit, min_plan: a.voice_ultra.min_plan },
    voice_tiers: Object.fromEntries(Object.entries(tiers()).map(([k, v]) => [k, { label: v.label }])),
  };
}

module.exports = { all, tiers, allowed, normalize, lines, audioSeconds, publicView, MOODS, MUSIC_PIPELINES, VOICE_PIPELINES };
