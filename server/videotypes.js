// Video types registry (SPEC §2). Prices and limits live in pricing.video_types (content/pricing.json → Admin → Pricing).
// The built-in list below is only a safety net for when the pricing setting has no video_types yet.
const { pricing } = require('./settings');

const PIPELINES = ['ugc', 'video', 'image_to_video', 'slideshow', 'dub', 'hook_remix', 'motion_ad', 'bg_swap', 'auto_edit', 'brand_music', 'street', 'mad_edit'];

const BUILTIN = [
  { id: 'ugc_talking', name: 'UGC talking video', description: 'An AI creator talks to camera about your product', pipeline: 'ugc', provider_kind: 'ugc', unit: 'second', credits_per_unit: 15, provider_cost_usd_per_unit: 0.115, segment_seconds: 10, min_seconds: 5, max_seconds_by_plan: { starter: 30, pro: 60, scale: 90, agency: 120 }, min_plan: 'starter', extras: { ai_script: 8, captions: 0 }, enabled: true, badge: 'Most used' },
  { id: 'product_video', name: 'Product video', description: 'Product shots, b-roll, unboxing or app demo footage', pipeline: 'video', provider_kind: 'video', unit: 'second', credits_per_unit: 10, provider_cost_usd_per_unit: 0.07, segment_seconds: 10, min_seconds: 5, max_seconds_by_plan: { starter: 10, pro: 15, scale: 20, agency: 30 }, min_plan: 'starter', extras: {}, enabled: true, badge: null },
  { id: 'image_to_video', name: 'Photo to video', description: 'Turn a product photo into a moving shot', pipeline: 'image_to_video', provider_kind: 'video', unit: 'second', credits_per_unit: 10, provider_cost_usd_per_unit: 0.07, segment_seconds: 10, min_seconds: 5, max_seconds_by_plan: { starter: 10, pro: 15, scale: 20, agency: 30 }, min_plan: 'starter', extras: {}, enabled: true, badge: null },
  { id: 'slideshow', name: 'Slideshow ad', description: 'AI writes slides, makes an image for each, adds a voiceover and captions', pipeline: 'slideshow', provider_kind: 'image', unit: 'second', credits_per_unit: 3, provider_cost_usd_per_unit: 0.02, segment_seconds: null, min_seconds: 10, max_seconds_by_plan: { starter: 30, pro: 60, scale: 60, agency: 90 }, min_plan: 'starter', extras: {}, enabled: true, badge: 'New' },
  { id: 'dub', name: 'Dub an ad', description: 'Translate your ad script and re-voice it in another language', pipeline: 'dub', provider_kind: 'dub', unit: 'second', credits_per_unit: 8, provider_cost_usd_per_unit: 0.05, segment_seconds: null, min_seconds: 5, max_seconds_by_plan: { pro: 60, scale: 90, agency: 120 }, min_plan: 'pro', extras: {}, enabled: true, badge: null },
  { id: 'motion_ad', name: 'Animated ad (Standard)', description: 'Stock footage and AI images, kinetic headlines in your brand colour, voiceover and a CTA end card', pipeline: 'motion_ad', quality: 'standard', provider_kind: 'image', unit: 'second', credits_per_unit: 4, provider_cost_usd_per_unit: 0.017, fixed_cost_usd: 0.03, segment_seconds: 4, min_seconds: 10, max_seconds_by_plan: { starter: 30, pro: 60, scale: 60, agency: 60 }, min_plan: 'starter', extras: { ai_script: 8, captions: 0 }, addons_allowed: ['music', 'voice_ultra'], voice_tier_default: 'standard', enabled: true, badge: 'New' },
  { id: 'motion_ad_ultra', name: 'Animated ad (Ultra-realistic)', description: 'Every scene is a new AI video shot, with an ultra-realistic voice, kinetic headlines and a CTA end card', pipeline: 'motion_ad', quality: 'ultra', provider_kind: 'video', unit: 'second', credits_per_unit: 10, provider_cost_usd_per_unit: 0.08, fixed_cost_usd: 0.03, seconds_step: 5, segment_seconds: 5, min_seconds: 10, max_seconds_by_plan: { starter: 15, pro: 30, scale: 45, agency: 60 }, min_plan: 'starter', extras: { ai_script: 8, captions: 0 }, addons_allowed: ['music'], includes: ['voice_ultra'], voice_tier_default: 'ultra', enabled: true, badge: 'Ultra' },
  { id: 'bg_swap', name: 'Change background', description: 'Upload a video, pick a new background: colour, picture, AI scene or stock video', pipeline: 'bg_swap', provider_kind: 'matting', unit: 'second', credits_per_unit: 3, provider_cost_usd_per_unit: 0.024, compute_cost_usd_per_second: 0.0005, seconds_step: 1, segment_seconds: null, min_seconds: 10, max_seconds_by_plan: { starter: 30, pro: 60, scale: 120, agency: 120 }, min_plan: 'starter', extras: { ai_background: 4 }, extras_cost_usd: { ai_background: 0.03 }, addons_allowed: [], enabled: true, badge: 'New' },
  { id: 'auto_edit', name: 'Auto-edit my video', description: 'Upload raw footage: we cut silences and bad takes, add captions, music and reframe it', pipeline: 'auto_edit', provider_kind: 'stt', unit: 'second', credits_per_unit: 2, provider_cost_usd_per_unit: 0.0002, compute_cost_usd_per_second: 0.0005, min_credits: 30, seconds_step: 1, segment_seconds: null, min_seconds: 1, max_seconds_by_plan: { starter: 120, pro: 300, scale: 300, agency: 300 }, min_plan: 'starter', extras: {}, addons_allowed: ['music'], enabled: true, badge: 'New' },
  { id: 'brand_music', name: 'Brand music', description: 'An original track or a jingle that sings your brand name, reusable in every video', pipeline: 'brand_music', provider_kind: 'music', unit: 'item', credits_per_unit: 60, provider_cost_usd_per_unit: 0.6, price_by_seconds: { 15: 60, 30: 60, 60: 60, 120: 110 }, seconds_step: 1, segment_seconds: null, min_seconds: 15, max_seconds_by_plan: { starter: 60, pro: 120, scale: 120, agency: 120 }, min_plan: 'starter', extras: {}, addons_allowed: [], enabled: true, badge: 'New' },
  { id: 'street_interview', name: 'Street interview', description: 'A presenter with a handheld mic stops a passer-by: two AI speakers, ambient street sound. An AI dramatization.', pipeline: 'street', provider_kind: 'video', unit: 'second', credits_per_unit: 22, provider_cost_usd_per_unit: 0.168, segment_seconds: 8, min_seconds: 8, max_seconds_by_plan: { starter: 0, pro: 30, scale: 45, agency: 60 }, min_plan: 'pro', extras: { ai_script: 8 }, addons_allowed: [], enabled: true, badge: 'New' },
  { id: 'mad_edit', name: 'Viral edit', description: 'Fast cuts on the beat, zooms, bold captions and sound hits', pipeline: 'mad_edit', provider_kind: 'video', unit: 'second', credits_per_unit: 12, local_credits_per_unit: 3, provider_cost_usd_per_unit: 0.07, compute_cost_usd_per_second: 0.002, seconds_step: 5, segment_seconds: 5, min_seconds: 10, max_seconds_by_plan: { starter: 15, pro: 30, scale: 45, agency: 60 }, min_plan: 'starter', extras: {}, addons_allowed: [], enabled: true, badge: 'New' },
  { id: 'hook_remix', name: 'Hook remix', description: 'New 3–5s opening hooks to put in front of an ad that already works', pipeline: 'hook_remix', provider_kind: 'ugc', unit: 'item', credits_per_unit: 65, provider_cost_usd_per_unit: 0.5, segment_seconds: null, min_seconds: 3, max_seconds_by_plan: { starter: 5, pro: 5, scale: 5, agency: 5 }, min_plan: 'starter', extras: {}, enabled: true, badge: null },
];

function all() {
  const list = pricing().video_types;
  const src = Array.isArray(list) && list.length ? list : BUILTIN;
  return src.filter((t) => t && t.id && PIPELINES.includes(t.pipeline)).map(normalize);
}

function normalize(t) {
  const base = BUILTIN.find((b) => b.pipeline === t.pipeline && (t.pipeline !== 'motion_ad' || b.quality === (t.quality === 'ultra' ? 'ultra' : 'standard'))) || BUILTIN[0];
  return {
    ...base, ...t,
    provider_kind: t.provider_kind || base.provider_kind,
    unit: t.unit === 'item' ? 'item' : t.unit === 'second' ? 'second' : base.unit,
    credits_per_unit: Number(t.credits_per_unit) > 0 ? Number(t.credits_per_unit) : base.credits_per_unit,
    provider_cost_usd_per_unit: Number(t.provider_cost_usd_per_unit) >= 0 && t.provider_cost_usd_per_unit !== undefined ? Number(t.provider_cost_usd_per_unit) : base.provider_cost_usd_per_unit,
    segment_seconds: Number(t.segment_seconds) > 0 ? Number(t.segment_seconds) : null,
    min_seconds: Number(t.min_seconds) > 0 ? Number(t.min_seconds) : base.min_seconds,
    max_seconds_by_plan: t.max_seconds_by_plan && typeof t.max_seconds_by_plan === 'object' ? t.max_seconds_by_plan : base.max_seconds_by_plan,
    extras: t.extras && typeof t.extras === 'object' ? t.extras : {},
    enabled: t.enabled !== false,
  };
}

const byId = (id) => all().find((t) => t.id === id) || null;
// The type that stands in for the old job types (type 'ugc' / 'video' from the v1 studio).
const forPipeline = (pipeline) => all().find((t) => t.pipeline === pipeline && t.enabled) || normalize(BUILTIN.find((b) => b.pipeline === pipeline));

// Plan order = order in pricing.plans (cheapest first).
function planRank(planId) {
  const i = pricing().plans.findIndex((p) => p.id === planId);
  return i < 0 ? -1 : i;
}

// Max seconds (or hooks per job for 'item' types) the plan allows for this type. 0 = not on this plan.
function maxFor(t, plan) {
  if (!plan) return 0;
  const v = t.max_seconds_by_plan?.[plan.id];
  if (v !== undefined && v !== null) return Number(v) || 0;
  if (t.pipeline === 'ugc') return Number(plan.max_ugc_seconds) || 0;
  return Number(plan.max_video_seconds) || 0;
}

// Why this type is locked for the user's plan, or null when it is open. Trial accounts can never make video.
function lockedReason(t, plan) {
  if (!t.enabled) return 'This video type is switched off for now.';
  // Real-cost watchdog kill switch (server/watchdog.js): paused until the owner switches it back on.
  if (require('./watchdog').pausedReason(t.id)) return `${t.name} is temporarily unavailable. Try another style or come back soon.`;
  if (!plan) return 'Video needs a paid plan. Trial credits cover images and hooks only.';
  const minPlan = t.min_plan || null;
  if (minPlan && planRank(plan.id) < planRank(minPlan)) {
    const p = pricing().plans.find((x) => x.id === minPlan);
    return `${t.name} is on ${p ? p.name : minPlan} and above.`;
  }
  if (!maxFor(t, plan)) return `${t.name} is not included in the ${plan.name} plan.`;
  return null;
}

// Fields the studio form needs per pipeline (documented for the frontend; validated in jobs.create).
const FIELDS = {
  ugc: { required: ['product', 'duration', 'script|write_script'], optional: ['presenter', 'presenter_desc', 'language', 'audience', 'angle', 'niche', 'direction', 'captions', 'music', 'voice_tier'] },
  video: { required: ['product', 'duration'], optional: ['style', 'details', 'aspect', 'image_url', 'niche'] },
  image_to_video: { required: ['product', 'image_url', 'duration'], optional: ['style', 'details', 'direction', 'aspect', 'niche'] },
  slideshow: { required: ['product', 'duration'], optional: ['slides', 'lines', 'audience', 'angle', 'language', 'niche', 'presenter', 'aspect', 'music', 'voice_tier'] },
  dub: { required: ['video_url', 'script', 'language', 'duration'], optional: ['source_language', 'presenter', 'niche', 'product'] },
  motion_ad: { required: ['product', 'duration'], optional: ['aspect', 'style', 'brand_color', 'logo_url', 'image_url', 'script|write_script', 'language', 'cta', 'music', 'voice_tier', 'niche', 'audience'] },
  hook_remix: { required: ['product'], optional: ['video_url', 'hooks', 'count', 'duration', 'presenter', 'presenter_desc', 'language', 'audience', 'niche'] },
  bg_swap: { required: ['upload_id', 'bg_kind'], optional: ['bg_color', 'bg_image_url', 'bg_prompt', 'bg_query', 'aspect'] },
  auto_edit: { required: ['upload_id'], optional: ['aspect', 'caption_style', 'captions', 'remove_silences', 'hook_first', 'music', 'end_card', 'cta', 'logo_url', 'brand_color', 'language'] },
  street: { required: ['product', 'duration'], optional: ['script', 'question', 'host_actor_id', 'guest_desc', 'city', 'language', 'audience', 'niche', 'level', 'ai_label'] },
  mad_edit: { required: ['product', 'duration'], optional: ['source', 'videos', 'hits', 'bpm', 'brand_color', 'language', 'niche', 'level', 'music'] },
  brand_music: { required: ['product', 'duration'], optional: ['vocals', 'brand_name', 'lyrics', 'mood', 'genre', 'tempo', 'track_name'] },
};

module.exports = { all, byId, forPipeline, maxFor, lockedReason, planRank, PIPELINES, FIELDS, BUILTIN };
