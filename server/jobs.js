// Generation pipeline. Each job moves through steps; the worker runs every few seconds.
// Job types: hooks, script, angles, image, video, ugc (+ v2 video types: image_to_video, slideshow, dub, hook_remix).
// UGC video: script → Ban Shield → (per segment: voice → talking presenter) → stitch → save.
// Videos longer than the provider's max are rendered as segments with the same presenter/voice and stitched (server/stitch.js).
const { get, all, run, tx, J } = require('./db');
const providers = require('./providers');
const credits = require('./credits');
const shield = require('./shield');
const media = require('./media');
const guard = require('./guard');
const stitch = require('./stitch');
const brain = require('./ai/brain');
const videotypes = require('./videotypes');
const levels = require('./levels');
const addons = require('./addons');
const pronounce = require('./pronounce');
const { getSetting } = require('./settings');
const config = require('./config');
const { fail } = require('./lib/http');
const { now } = require('./lib/util');

const LANGS = {
  en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ar: 'Arabic', hi: 'Hindi',
  id: 'Indonesian', tr: 'Turkish', ru: 'Russian', pl: 'Polish', nl: 'Dutch', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
  vi: 'Vietnamese', th: 'Thai', tl: 'Filipino', sw: 'Swahili', pcm: 'Nigerian Pidgin', yo: 'Yoruba', ha: 'Hausa', ur: 'Urdu',
};

const VIDEO_STYLES = {
  product: 'clean product showcase, the product rotates slowly on a simple surface, soft studio light, premium commercial look',
  lifestyle: 'lifestyle b-roll, a person naturally using the product in a real home setting, handheld phone camera feel',
  unboxing: 'hands unboxing the product on a table, close-up, natural daylight, satisfying reveal',
  demo: 'a phone or laptop screen showing the app being used, smooth scrolling, modern desk, clean light',
  motion: 'bold kinetic motion graphic style background with smooth abstract shapes and space for text, vibrant brand colors',
  testimonial_broll: 'cinematic close-ups that support a customer story, warm natural light, shallow depth of field',
};

const IMAGE_SIZES = [['1:1', '1080x1080'], ['4:5', '1080x1350'], ['9:16', '1080x1920']];
const ASPECT_SIZE = { '9:16': '1080x1920', '1:1': '1080x1080', '4:5': '1080x1350', '16:9': '1920x1080' };
const WORDS_PER_SECOND = 2.4;
const VIDEO_PIPELINES = ['ugc', 'video', 'image_to_video', 'slideshow', 'dub', 'hook_remix', 'motion_ad', 'bg_swap', 'auto_edit', 'brand_music', 'street', 'mad_edit'];
const TOOL_PIPES = ['bg_swap', 'auto_edit', 'brand_music']; // server/videotools.js
const MOTION_STYLES = ['bold', 'clean', 'luxury', 'playful', 'tech'];
const MOTION_ASPECTS = ['9:16', '1:1', '16:9'];
const JOB_TYPES = ['hooks', 'script', 'angles', 'image', 'actor', ...VIDEO_PIPELINES];

const ser = (o) => JSON.stringify(o ?? {});
function update(job, patch) {
  const fields = Object.keys(patch);
  const vals = fields.map((f) => (typeof patch[f] === 'object' && patch[f] !== null ? ser(patch[f]) : patch[f]));
  run(`UPDATE jobs SET ${fields.map((f) => f + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`, ...vals, now(), job.id);
  Object.assign(job, patch);
}

function langName(code) { return LANGS[code] || 'English'; }
const str = (v) => String(v ?? '').trim();
const absUrl = (u) => (/^https?:/.test(u) ? u : config.appUrl + u);
const brandLine = (i) => (i.brand ? `Brand: ${i.brand} (use this name where a brand is mentioned)\n` : '');
const okUrl = (u) => /^(\/media\/|\/samples\/|https?:\/\/)/.test(str(u));

// ---------- Creating jobs (called by the app API) ----------
// type: 'video_type' (v2, input.video_type = registry id) or one of the v1 types ugc/video/image/hooks/script, or 'angles'.
function create(user, type, input) {
  const plan = credits.activePlan(user);
  const clean = { ...input };
  let jobType = type;
  let isVideo = false;

  if (type === 'video_type') {
    const vt = videotypes.byId(str(input.video_type));
    if (!vt) fail(400, 'Pick a video type.');
    const locked = videotypes.lockedReason(vt, plan);
    if (locked) fail(402, locked, { locked: true, min_plan: vt.min_plan || null });
    const max = videotypes.maxFor(vt, plan);
    jobType = vt.pipeline;
    isVideo = true;
    clean.video_type = vt.id;
    // Quality level (SPEC §13): checked against the plan, stored on the job with its model.
    const level = checkLevel(vt, input.level, plan);
    if (level) { clean.level = level.id; clean.level_name = level.name; clean.model = level.model_label; if (level.provider_tag) clean.level_tag = level.provider_tag; }
    else { delete clean.level; delete clean.level_name; delete clean.model; delete clean.level_tag; }
    if (vt.pipeline === 'hook_remix') {
      clean.duration = Math.max(Math.min(vt.min_seconds || 3, 5), Math.min(5, max || 5, Number(input.duration) || 4));
      const maxH = credits.maxHooks(vt); // hook factory: up to 10 openings, bulk price from 5 (pricing bulk_discounts)
      const given = Array.isArray(input.hooks) ? input.hooks.map(str).filter(Boolean).slice(0, maxH) : [];
      if (given.length) clean.hooks = given; else delete clean.hooks;
      clean.count = given.length || Math.max(1, Math.min(maxH, Math.floor(Number(input.count)) || 3)); // own hooks: one variant per hook
      if (clean.video_url && !okUrl(clean.video_url)) fail(400, 'The ad link must be a full https:// link or an uploaded file.');
    } else if (TOOL_PIPES.includes(vt.pipeline)) {
      // Change background / Auto-edit / Brand music: the length comes from the customer's upload (or the track length).
      require('./videotools').prepare(vt, input, clean, user, plan);
      if (vt.pipeline !== 'brand_music' && clean.duration > max) fail(402, `Your ${plan.name} plan takes videos up to ${max}s for ${vt.name.toLowerCase()}. This one is ${Math.round(clean.raw_seconds)}s. Trim it or upgrade.`, { max_seconds: max });
    } else {
      const secs = credits.videoSeconds(vt, input.duration);
      if (secs < (vt.min_seconds || 1)) fail(400, `${vt.name} needs at least ${vt.min_seconds} seconds.`);
      if (secs > max) fail(402, `Your ${plan.name} plan makes ${vt.name.toLowerCase()} up to ${max}s. Pick a shorter length or upgrade.`, { max_seconds: max });
      clean.duration = secs;
    }
    if (vt.pipeline === 'ugc') {
      if (input.write_script && !plan.scripts) fail(402, 'The AI script writer is on Pro and above. Write your own script or upgrade.');
      if (!input.write_script && !str(input.script)) fail(400, 'Add a script, or turn on the AI script writer.');
    }
    if (vt.pipeline === 'video' && !VIDEO_STYLES[input.style]) clean.style = 'product';
    if (vt.pipeline === 'image_to_video') {
      if (!okUrl(input.image_url)) fail(400, 'Upload a product photo first.');
      if (!VIDEO_STYLES[input.style]) clean.style = 'product';
    }
    if (vt.pipeline === 'slideshow') {
      const lines = Array.isArray(input.lines) ? input.lines.map(str).filter(Boolean).slice(0, 8) : [];
      if (lines.length && lines.length < 4) fail(400, 'A slideshow needs 4 to 8 slides.');
      if (lines.length) clean.lines = lines; else delete clean.lines;
      clean.slides = lines.length || Math.max(4, Math.min(8, Math.floor(Number(input.slides)) || 6));
    }
    if (vt.pipeline === 'motion_ad') {
      clean.quality = vt.quality === 'ultra' ? 'ultra' : 'standard';
      clean.aspect = MOTION_ASPECTS.includes(input.aspect) ? input.aspect : '9:16';
      clean.style = MOTION_STYLES.includes(input.style) ? input.style : 'bold';
      clean.brand_color = /^#?[0-9a-f]{6}$/i.test(str(input.brand_color)) ? '#' + str(input.brand_color).replace('#', '').toUpperCase() : '';
      for (const k of ['logo_url', 'image_url']) if (clean[k] && !okUrl(clean[k])) delete clean[k];
      clean.cta = str(input.cta).slice(0, 30) || 'Shop now';
      clean.write_script = !str(input.script);
      clean.scenes = credits.sceneCount(vt, clean.duration);
    }
    if (vt.pipeline === 'street') {
      clean.script = str(input.script).slice(0, 3000);
      if (!clean.script) delete clean.script;
      clean.question = str(input.question).slice(0, 160);
      clean.guest_desc = str(input.guest_desc).slice(0, 200);
      clean.city = str(input.city).slice(0, 40);
      const why = require('./actors').realPersonReason(clean.guest_desc, clean.question);
      if (why) fail(400, why);
      clean.ai_label = input.ai_label !== false;
    }
    if (vt.pipeline === 'mad_edit') {
      clean.source = input.source === 'own' ? 'own' : 'ai';
      if (clean.source === 'own') {
        const up = require('./uploads');
        const ids = (Array.isArray(input.videos) ? input.videos : []).map((x) => String(x || '').replace(/^upload:/, '')).slice(0, 8);
        const owned = ids.map((x) => up.owned(x, user.id)).filter((x) => x && x.kind === 'video');
        if (!owned.length) fail(400, 'Upload at least one of your videos for the viral edit.');
        clean.videos = owned.map((x) => 'upload:' + x.id);
      } else delete clean.videos;
      const hits = (Array.isArray(input.hits) ? input.hits : String(input.hits || '').split(/\n|\|/)).map((x) => str(x).slice(0, 28)).filter(Boolean).slice(0, 6);
      if (hits.length) clean.hits = hits; else delete clean.hits;
      clean.bpm = Math.max(90, Math.min(150, Math.round(Number(input.bpm)) || 124));
      clean.aspect = MOTION_ASPECTS.includes(input.aspect) ? input.aspect : '9:16';
      clean.brand_color = /^#?[0-9a-f]{6}$/i.test(str(input.brand_color)) ? '#' + str(input.brand_color).replace('#', '').toUpperCase() : '';
    }
    // Add-ons: background music and the voice tier (SPEC §12).
    const ad = addons.normalize(vt, input);
    const A = addons.all();
    if (ad.music) {
      const mp = A.music.min_plan;
      if (mp && videotypes.planRank(plan.id) < videotypes.planRank(mp)) fail(402, `Background music is on the ${mp} plan and above.`);
      // A brand track must be the customer's own (made with Brand music). Reusing it is free.
      if (ad.music.source === 'brand' && !require('./videotools').ownTrack(ad.music.track_id, user.id)) fail(400, 'Pick one of your own brand tracks.');
      clean.music = ad.music;
    } else delete clean.music;
    if (ad.voice_tier) clean.voice_tier = ad.voice_tier; else delete clean.voice_tier;
    if (ad.voice_tier === 'ultra' && A.voice_ultra.min_plan && videotypes.planRank(plan.id) < videotypes.planRank(A.voice_ultra.min_plan)) fail(402, `The ultra-realistic voice is on the ${A.voice_ultra.min_plan} plan and above.`);
    if (vt.pipeline === 'dub') {
      if (!okUrl(input.video_url)) fail(400, 'Add the link to the video you want to dub.');
      if (!str(input.script)) fail(400, 'Paste the script spoken in the video so we can translate it.');
      if (!LANGS[input.language]) fail(400, 'Pick the language to dub into.');
      if (!str(clean.product)) clean.product = str(input.script).slice(0, 80);
    }
  }
  if (type !== 'video_type') { delete clean.music; delete clean.voice_tier; delete clean.level; delete clean.level_name; delete clean.model; delete clean.level_tag; }
  if (type === 'ugc') {
    if (!plan) fail(402, 'UGC videos need a paid plan. Pick a plan to unlock them.');
    isVideo = true;
    clean.duration = Math.max(5, Math.min(plan.max_ugc_seconds, Number(input.duration) || 15));
    clean.video_type = videotypes.forPipeline('ugc').id;
    if (input.write_script && !plan.scripts) fail(402, 'The AI script writer is on Pro and above. Write your own script or upgrade.');
    if (!input.write_script && !str(input.script)) fail(400, 'Add a script, or turn on the AI script writer.');
  }
  if (type === 'video') {
    if (!plan) fail(402, 'Videos need a paid plan. Pick a plan to unlock them.');
    isVideo = true;
    clean.duration = Math.max(5, Math.min(plan.max_video_seconds, Number(input.duration) || 5));
    clean.video_type = videotypes.forPipeline('video').id;
    if (!VIDEO_STYLES[input.style]) clean.style = 'product';
  }
  // Actor library: a house actor or one of the customer's own (approved) actors replaces the presenter and its voice.
  if (str(input.actor_id)) {
    const a = require('./actors').resolve(input.actor_id, user.id);
    clean.actor = a; clean.actor_id = String(a.id);
    if (a.presenter) clean.presenter = a.presenter;
    delete clean.presenter_desc;
  } else { delete clean.actor; delete clean.actor_id; }
  if (type === 'actor') {
    const desc = str(input.description).slice(0, 400);
    if (desc.length < 8) fail(400, 'Describe the person: age, look, hair, clothes, setting.');
    const why = require('./actors').realPersonReason(desc);
    if (why) fail(400, why);
    clean.description = desc;
    clean.count = 4;
    if (!str(clean.product)) clean.product = 'Actor: ' + desc.slice(0, 60);
  }
  if (!JOB_TYPES.includes(jobType)) fail(400, 'Pick what you want to make.');
  // Free content checks before anything is paid: AI models reject these, and the voice would be wasted.
  moderate(clean);
  if (type === 'script' && !(plan && plan.scripts)) fail(402, 'The AI script writer is on Pro and above.');
  if (!str(clean.product) && type !== 'image') fail(400, 'Tell us what you are advertising.');
  if (type === 'image' && !str(clean.product || clean.prompt)) fail(400, 'Describe the image or the product.');
  if (type === 'image') clean.count = Math.max(1, Math.min(10, Math.floor(Number(input.count)) || 1));
  clean.language = LANGS[clean.language] ? clean.language : 'en';
  // Brand settings (Studio → Settings) shape every script and hook.
  const brand = J(user.brand, null);
  if (brand && typeof brand === 'object') {
    if (!str(clean.niche) && brand.niche && brand.niche !== 'other') clean.niche = String(brand.niche).slice(0, 40);
    if (brand.name) clean.brand = String(brand.name).slice(0, 40);
  }

  const q = credits.quoteFull(type, clean, user);
  const cost = q.credits;
  if (isVideo) clean.segments = q.segments;
  if (isVideo && Array.isArray(q.clips) && q.clips.length) clean.clips = q.clips; else delete clean.clips;
  guard.checkJobLimits(user, cost, plan);
  const kind = { actor: 'image', street: 'video', mad_edit: clean.source === 'own' ? 'text' : 'video', hooks: 'text', script: 'text', angles: 'text', image: 'image', video: 'video', image_to_video: 'video', slideshow: 'image', dub: 'dub', hook_remix: 'ugc', motion_ad: clean.quality === 'ultra' ? 'video' : 'stock', bg_swap: 'matting', auto_edit: 'stt', brand_music: 'music' }[jobType] || 'ugc';
  const demo = jobType === 'brand_music' ? require('./videotools').aiMusicChain()[0].adapter === 'mock' : providers.isDemo(kind);
  const info = run('INSERT INTO jobs(user_id, type, status, step, input, credits, demo) VALUES(?,?,?,?,?,?,?)', user.id, jobType, 'queued', 'start', ser(clean), cost, demo ? 1 : 0);
  const jobId = Number(info.lastInsertRowid);
  try {
    const take = credits.spend(user.id, cost, `${jobType} job`, 'job:' + jobId, { allowTrial: !isVideo });
    run('UPDATE jobs SET state = ? WHERE id = ?', ser({ take, quote: q }), jobId);
  } catch (e) {
    run('DELETE FROM jobs WHERE id = ?', jobId);
    throw e;
  }
  if (!plan) run('UPDATE jobs SET state = json_set(state, \'$.watermark\', 1) WHERE id = ?', jobId);
  // The actor picked last leads the Recommended row next time (server/houseactors.js).
  const usedActor = clean.actor_id ? String(clean.actor_id) : clean.presenter && clean.presenter !== 'custom' && !clean.presenter_desc ? 'h:' + clean.presenter : null;
  if (usedActor) { try { run("UPDATE users SET flags = json_set(COALESCE(NULLIF(flags, ''), '{}'), '$.last_actor', ?) WHERE id = ?", usedActor, user.id); } catch {} }
  kick();
  return view(get('SELECT * FROM jobs WHERE id = ?', jobId));
}

// Content the AI models (and the ad platforms) refuse. Checked at create, before any paid step. Ban Shield still rewrites
// risky ad claims later; this only stops what no model will make.
const BLOCKED = /\b(child|minor|underage|teen)\b[^.]{0,40}\b(sexy|nude|naked|sexual|lingerie)|\b(nude|naked|porn|explicit sex|onlyfans leak)\b|\b(behead|gore|dismember|bomb[- ]making|how to make (a )?(bomb|explosive))\b|\b(nazi|swastika)\b/i;
function moderate(i) {
  const text = ['product', 'script', 'prompt', 'details', 'direction', 'presenter_desc', 'question', 'guest_desc', 'description', 'angle', 'audience'].map((k) => String(i[k] || '')).join(' \n ');
  if (BLOCKED.test(text)) fail(400, 'The AI models will not make this. Please change the wording (no sexual content, violence or hate symbols).');
  const why = require('./actors').realPersonReason(i.presenter_desc, i.direction, i.prompt);
  if (why) fail(400, why);
}

// The quality level a video job asks for. null for types without levels. 400 when the level does not exist or is switched
// off, 403 (with the plan to upgrade to) when the customer's plan is too low.
function checkLevel(vt, levelId, plan) {
  if (!levels.hasLevels(vt)) return null;
  // Types without a Standard level (Street interview starts at Pro) default to their lowest level that is switched on. In demo
  // mode (no AI keys) such a type has no level with a model behind it, so it runs on the demo samples at the type's own price.
  const av = levels.available(vt);
  if (!str(levelId) && !av.some((l) => l.id === 'standard')) {
    if (!av.length && providers.isDemo(vt.provider_kind)) return null;
    if (av.length) levelId = av[0].id;
  }
  const want = str(levelId) || 'standard';
  const level = levels.pick(vt, want);
  if (!level) {
    if (!levels.IDS.includes(want)) fail(400, 'Pick Standard, Pro realistic or Ultra cinematic.');
    fail(400, `${levels.NAMES[want]} is not available for ${vt.name.toLowerCase()} right now. Pick another quality.`, { level: want });
  }
  const locked = levels.lockedReason(level, plan);
  if (locked) {
    const p = (require('./settings').pricing().plans || []).find((x) => x.id === level.min_plan);
    fail(403, `${locked} Upgrade to ${p ? p.name : level.min_plan} to use it, or pick Standard.`, { locked: true, level: level.id, min_plan: level.min_plan, upgrade: p ? { plan_id: p.id, plan_name: p.name, price_month: p.price_month } : null });
  }
  return level;
}

function view(j) {
  if (!j) return null;
  const st = J(j.state, {});
  const input = J(j.input, {});
  return {
    id: j.id, type: j.type, video_type: input.video_type || null, status: j.status, step: j.step, credits: j.credits, demo: !!j.demo, error: j.error,
    input, output: J(j.output, null), progress: st.progress || 0, steps: st.steps || [], watermark: !!st.watermark,
    segments: input.segments || 1, adjusted: !!st.quote?.adjusted,
    attention: st.attention || null, retry_of: st.retry_of || null, keep_until: st.attention?.keep_until || st.keep_until || null,
    level: input.level || null, level_name: input.level_name || null, model: input.model || null,
    created_at: j.created_at, updated_at: j.updated_at,
  };
}

// ---------- Prompts (built on the AI brain) ----------
function hooksPrompt(i) {
  return {
    mode: 'hooks', topic: i.product,
    system: brain.systemFor('hooks', i),
    prompt: `Write 20 different opening hooks (max 12 words each) for a video ad.
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
Angle: ${i.angle || 'any'}
Language: ${langName(i.language)} (write the hooks in this language, natural and local, not a word-for-word translation)
Mix formats: question, bold claim (compliant), POV, story, curiosity gap, objection, social proof framing, listicle.
Return ONLY a JSON array of 20 strings.`,
    max_tokens: 1500,
  };
}
function beatsText(seconds, i) {
  const plan = brain.scriptPlan(seconds, i.template, brain.detectVertical(i)?.id);
  return (plan.template ? `Structure: ${plan.template}\n` : '') + plan.beats.map((b) => `- ${b.beat}${b.from !== undefined ? ` (${b.from}–${b.to}s)` : ''}${b.note ? ': ' + b.note : ''}`).join('\n');
}
function scriptPrompt(i) {
  const secs = Number(i.duration) || 15;
  const words = Math.round(secs * WORDS_PER_SECOND);
  return {
    mode: 'script', topic: i.product,
    system: brain.systemFor(i.video_type ? 'ugc' : 'script', i),
    prompt: `Write a UGC video ad script.
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
Angle: ${i.angle || 'pick the strongest'}
Language: ${langName(i.language)} (natural, native, conversational)
Length: about ${words} spoken words (${secs} seconds).
Beats:
${beatsText(secs, i)}
Return ONLY JSON: {"angle": "...", "hook": "...", "lines": ["spoken line 1", "..."], "cta": "..."}`,
    max_tokens: secs > 30 ? 2400 : 1200,
  };
}
function anglesPrompt(i) {
  return {
    mode: 'angles', topic: i.product,
    system: brain.systemFor('angles', i),
    prompt: `Give 10 different ad angles for this product, each with an opening hook (max 12 words) and one sentence on why it works for this audience.
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
Language: ${langName(i.language)}
Return ONLY a JSON array of 10 objects: [{"angle": "...", "hook": "...", "why": "..."}]`,
    max_tokens: 1500,
  };
}
function slidesPrompt(i) {
  return {
    mode: 'slides', topic: i.product, count: i.slides,
    system: brain.systemFor('slides', i),
    prompt: `Write ${i.slides} on-screen lines for a ${i.duration}s slideshow video ad, one per slide (max 9 words each). Slide 1 is the hook, the last slide is the call to action. The lines are also read out as the voiceover.
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
Angle: ${i.angle || 'pick the strongest'}
Language: ${langName(i.language)}
Return ONLY a JSON array of ${i.slides} strings.`,
    max_tokens: 800,
  };
}
function translatePrompt(i) {
  const words = String(i.script).split(/\s+/).filter(Boolean).length;
  return {
    mode: 'translate', text: i.script, language: i.language,
    system: brain.systemFor('translate', i),
    prompt: `Translate this video ad script${i.source_language && LANGS[i.source_language] ? ' from ' + langName(i.source_language) : ''} into ${langName(i.language)}.
Make it sound native and natural for that market, keep the meaning and the call to action, keep it about ${words} words so it fits the same video length, and keep it compliant with ad policies.
Script:
"""${i.script}"""
Return ONLY JSON: {"text": "..."}`,
    max_tokens: 2000,
  };
}
function hookRemixPrompt(i) {
  return {
    mode: 'hook_remix', topic: i.product, count: i.count,
    system: brain.systemFor('hook_remix', i),
    prompt: `Write ${i.count} new opening hooks for an existing video ad that already works. Each hook is spoken by a creator in ${i.duration} seconds or less (max ${Math.round(i.duration * WORDS_PER_SECOND) + 1} words) and must flow into the original ad.
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
Language: ${langName(i.language)}
Use different formats (question, POV, curiosity gap, objection, story).
Return ONLY a JSON array of ${i.count} strings.`,
    max_tokens: 600,
  };
}
const MOTION_LOOK = {
  bold: 'bold, high-contrast, punchy commercial look', clean: 'clean, bright, minimal, airy commercial look', luxury: 'luxury, dark moody light, elegant slow camera moves',
  playful: 'playful, colourful, energetic, fun', tech: 'sleek modern tech look, cool tones, screens and clean surfaces',
};
function motionPlanPrompt(i) {
  const n = i.scenes || 6;
  const words = Math.max(4, Math.round(((i.duration - 2.5) / n) * WORDS_PER_SECOND));
  return {
    mode: 'motion_plan', topic: i.product, count: n, cta: i.cta,
    system: brain.systemFor('motion_ad', i),
    prompt: `Plan an animated video ad of ${i.duration} seconds in ${n} scenes, followed by an end card with the call to action "${i.cta}".
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
Style: ${i.style}
Language: ${langName(i.language)} (headlines and voiceover in this language)
For every scene give:
- "headline": on-screen text, at most 6 words, punchy
- "vo": the voiceover line for that scene, about ${words} spoken words
- "query": a 2 to 5 word English search for stock footage that shows the scene (concrete visuals, no brand names, no text)
Scene 1 is the hook. The last scene leads into the call to action.
${i.script ? `Use this voiceover script word for word, split across the scenes in order:\n"""${i.script}"""\n` : ''}Return ONLY JSON: {"scenes": [{"headline": "...", "vo": "...", "query": "..."}], "cta": "..."}`,
    max_tokens: 1500,
  };
}
// Scene timing shared with stitch.motionAd: end card E seconds, transitions of 0.35s.
function motionTiming(seconds, n) {
  const T = 0.35, E = Math.min(3, Math.max(2, seconds * 0.15)), D = (seconds - E + n * T) / n;
  const r = (x) => Math.round(x * 10) / 10;
  return { E, D, scenes: Array.from({ length: n }, (_, k) => ({ start: r(k * (D - T)), end: r(k * (D - T) + D) })), endcard: { start: r(seconds - E), end: seconds } };
}

function imagePrompt(i, ratio) {
  return `${i.prompt || `High-converting social media ad image for: ${i.product}.`} ${i.audience ? 'Audience: ' + i.audience + '.' : ''} Style: ${i.style || 'clean, bright, premium, photorealistic, scroll-stopping'}. Aspect ${ratio}. Leave clear space for a headline. No text in the image.`;
}
function videoPrompt(i) {
  return `${VIDEO_STYLES[i.style] || VIDEO_STYLES.product}. Product: ${i.product}. ${i.details || ''} ${i.direction || ''} Vertical ${i.aspect || '9:16'} ad, high quality, realistic, smooth motion, no text overlays.`;
}

function parseJsonLoose(text, fallback) {
  const m = String(text || '').match(/[\[{][\s\S]*[\]}]/);
  if (!m) return fallback;
  try { return JSON.parse(m[0]); } catch { return fallback; }
}

// ---------- Running a provider step with fallback ----------
// `only` optionally narrows the providers (voice tier, music source).
// Retries and fallback (owner's rules):
//  - a temporary error (timeout, network, HTTP 5xx, rate limit) is retried on the same model with backoff, at most 2 times;
//  - a rejection, or a model that keeps failing, moves to the next approved model at the same level, then a LOWER level
//    (never a pricier one: see levels.runChain); work done on a lower level gives the price difference back (done());
//  - when every model has failed, the error carries the job's state so finished steps (voice, script, parts) are kept.
const TEMP_ERR = /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|\b5\d\d\b|\b429\b|rate.?limit|too many requests|overloaded|temporarily|unavailable|busy/i;
const MAX_TEMP_RETRIES = 2;
const backoffMs = (n) => (Number(process.env.JOB_BACKOFF_MS) || 4000) * 2 ** (n - 1);
function stepFailed(job, st, sub, key, kind, p, msg) {
  const temp = TEMP_ERR.test(String(msg));
  try { require('./watchdog').recordFailure(job, p, kind, temp, msg); } catch {}
  sub.handle = null;
  if (temp && (sub.temp || 0) < MAX_TEMP_RETRIES) { sub.temp = (sub.temp || 0) + 1; sub.waitUntil = Date.now() + backoffMs(sub.temp); sub.lastError = `${p.name}: ${msg}`; return; }
  sub.temp = 0; sub.waitUntil = 0;
  sub.tried.push(p.id);
  sub.lastError = `${p.name}: ${msg}`;
  console.warn('[jobs]', job.id, key, sub.lastError);
}
async function runStep(job, st, key, kind, input, only) {
  st.sub = st.sub || {};
  const sub = st.sub[key] || (st.sub[key] = { tried: [] });
  if (sub.result) return sub.result;
  if (sub.waitUntil && Date.now() < sub.waitUntil) return null; // backing off after a temporary error
  const list = only || (levels.KINDS.includes(kind) ? levelChain(job, kind) : providers.chain(kind));
  if (!sub.handle) {
    const p = list.find((x) => !sub.tried.includes(x.id)) || null;
    if (!p) throw Object.assign(new Error(sub.lastError || `No working ${kind} provider. Check Admin → AI providers.`), { state: st, stepKey: key });
    try {
      const r = await providers.submit(p, kind, { ...input, user_id: job.user_id });
      sub.provider = p.id;
      if (p.adapter === 'mock') update(job, { demo: 1 });
      if (r.done) { sub.result = r.result; sub.temp = 0; meter(job, st, key, kind, p, input, r.result); return r.result; }
      sub.handle = r.handle;
      return null;
    } catch (e) {
      stepFailed(job, st, sub, key, kind, p, e.message);
      return null; // next tick retries (temporary) or tries the next model
    }
  }
  const p = list.find((x) => x.id === sub.provider) || providers.byId(sub.provider);
  let r;
  try { r = await providers.poll(p, sub.handle); } catch (e) { stepFailed(job, st, sub, key, kind, p, e.message); return null; }
  if (r.progress) sub.progress = r.progress;
  if (!r.done) return null;
  if (r.error) { stepFailed(job, st, sub, key, kind, p, r.error); return null; }
  sub.result = r.result;
  sub.temp = 0;
  meter(job, st, key, kind, p, input, r.result);
  return r.result;
}

// Real cost of a finished provider step (Admin → Profit): text steps by their token usage (also written to the AI bill),
// everything else by the list price of the provider row that really ran it, at the length asked. Failed and refunded jobs keep
// what their finished steps cost us, so the profit view shows those losses too.
function meter(job, st, key, kind, p, input, result) {
  try {
    let usd = 0;
    const wd = require('./watchdog');
    const m = wd.measure(p, kind, input, result); // real cost when the provider reports it, else the table cost ("estimated")
    if (kind === 'text') {
      usd = require('./llmbill').record({ userId: job.user_id, feature: 'job:' + job.type, jobId: job.id, provider: p, usage: result && result.usage, input, text: result && result.text }).cost_usd;
      wd.record(job, p, kind, input, { ...m, source: result && result.usage ? 'reported' : 'estimated' }, usd);
    } else { usd = m.usd; wd.record(job, p, kind, input, m); }
    st.real_cost_usd = Math.round(((Number(st.real_cost_usd) || 0) + usd) * 1e6) / 1e6;
    // A render that fell back to a lower level than the customer paid for: remembered so done() gives the difference back.
    const want = obj(job.input).level;
    if (want && levels.KINDS.includes(kind) && p && p.adapter !== 'mock' && levels.RANK[levels.rowLevel(p)] < levels.RANK[want]) (st.lower = st.lower || []).push({ key, level: levels.rowLevel(p), seconds: Number(input.duration) || 0 });
    (st.cost_log = st.cost_log || []).push({ key, kind, provider: p ? p.id : null, usd: Math.round(usd * 1e6) / 1e6 });
    if (st.cost_log.length > 120) st.cost_log.splice(0, st.cost_log.length - 120);
  } catch (e) { console.warn('[jobs] meter', job.id, e.message); }
}

// Render chain for ugc/video steps (SPEC §13): the job's quality level (standard for jobs without one), then lower levels
// (the price difference is given back in done()). Never a pricier level without the customer's OK; if nothing is left, the
// step fails and the job is refunded.
function levelChain(job, kind) {
  const i = obj(job.input);
  const vt = i.video_type ? videotypes.byId(i.video_type) : null;
  const level = (vt && levels.hasLevels(vt) && levels.list(vt).find((l) => l.id === (i.level || 'standard'))) || { id: i.level || 'standard', provider_tag: i.level_tag || '' };
  const st = obj(job.state), q = st.quote || {};
  const clips = Array.isArray(i.clips) && i.clips.length ? i.clips : [Number(i.duration) || 5];
  const budget = Number(job.credits) * guard.worstCaseUsdPerCredit() * (1 - guard.minMarginPct() / 100) - ((Number(q.provider_cost_usd) || 0) - (Number(q.main_cost_usd) || 0));
  const canAfford = (row) => budget > 0 && levels.rowCost(row, clips) <= budget;
  return levels.runChain(kind, level, providers.chain(kind), canAfford);
}

// Long-running local work (ffmpeg) runs in the background so the worker keeps serving other jobs.
const BG = new Map();
function background(job, key, fn) {
  const k = job.id + ':' + key;
  let t = BG.get(k);
  if (!t) {
    t = { done: false };
    BG.set(k, t);
    Promise.resolve().then(fn).then((r) => { t.done = true; t.result = r; }, (e) => { t.done = true; t.error = e; });
    return { pending: true };
  }
  if (!t.done) return { pending: true };
  BG.delete(k);
  return t.error ? { error: t.error } : { result: t.result };
}

const STEP_LABELS = {
  hooks: ['Writing hooks', 'Ban Shield check'],
  script: ['Writing script', 'Ban Shield check'],
  angles: ['Finding angles', 'Ban Shield check'],
  image: ['Writing prompt', 'Rendering 1:1', 'Rendering 4:5', 'Rendering 9:16'],
  video: ['Directing the shot', 'Rendering video', 'Saving'],
  image_to_video: ['Reading your photo', 'Animating', 'Saving'],
  ugc: ['Script', 'Ban Shield check', 'Voice', 'Presenter', 'Rendering presenter video', 'Saving'],
  slideshow: ['Writing slides', 'Ban Shield check', 'Making images', 'Voiceover', 'Building slideshow', 'Saving'],
  dub: ['Translating', 'Ban Shield check', 'New voice', 'Lip-sync', 'Saving'],
  hook_remix: ['Writing hooks', 'Ban Shield check', 'Rendering hooks', 'Splicing', 'Saving'],
  motion_ad: ['Planning scenes', 'Ban Shield check', 'Visuals', 'Voiceover', 'Music', 'Animating', 'Saving'],
  street: ['Writing the interview', 'Ban Shield check', 'Filming parts', 'Stitching', 'Saving'],
  mad_edit: ['Planning the edit', 'Shots', 'Cutting to the beat', 'Saving'],
  actor: ['Making faces'],
  edit: ['Waiting for new parts', 'Editing', 'Saving'],
  ...require('./videotools').STEP_LABELS,
};
const segLabel = (k, n, label) => (n > 1 ? `${label} · part ${k + 1} of ${n}` : label);

// Split a script into n parts of about equal speaking time, preferring sentence ends.
function splitScript(text, n) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (n <= 1 || words.length <= n) return [words.join(' ')];
  const parts = [];
  let start = 0;
  for (let k = 1; k < n; k++) {
    const ideal = Math.round((words.length * k) / n);
    const span = Math.max(1, Math.round(words.length / n / 4));
    let cut = ideal;
    for (let d = 0; d <= span; d++) {
      if (/[.!?]$/.test(words[ideal + d - 1] || '')) { cut = ideal + d; break; }
      if (/[.!?]$/.test(words[ideal - d - 1] || '') && ideal - d > start) { cut = ideal - d; break; }
    }
    cut = Math.max(start + 1, Math.min(cut, words.length - (n - k)));
    parts.push(words.slice(start, cut).join(' '));
    start = cut;
  }
  parts.push(words.slice(start).join(' '));
  return parts;
}

// The job's video type with its quality level applied (segment length, price), or the plain type.
function levelType(i) {
  const vt = i.video_type ? videotypes.byId(i.video_type) : null;
  if (!vt || !i.level) return vt;
  const l = levels.list(vt).find((x) => x.id === i.level);
  return l ? levels.apply(vt, l) : vt;
}

// Default direction per UGC style. A video type can set its own with a "direction" field in pricing.video_types.
function typeDirection(id) {
  const vt = id && videotypes.byId(id);
  if (vt?.direction) return vt.direction;
  if (/green/.test(id || '')) return 'UGC creator reacting to a screenshot shown behind them like a TikTok green-screen video, pointing at it, expressive, natural';
  if (/podcast/.test(id || '')) return 'Podcast host speaking into a studio microphone, headphones, warm studio light, confident and conversational';
  return 'Natural UGC creator talking to the phone camera, friendly, subtle hand gestures';
}

function voiceFor(i) {
  const voices = getSetting('voices');
  const presenters = getSetting('presenters');
  const pres = presenters.find((p) => p.id === i.presenter) || presenters[0];
  if (i.actor) return { pres: { ...(pres || {}), name: i.actor.name }, voice_id: i.actor.voice_id || voices[i.voice] || voices[i.actor.voice_key] || voices[pres?.voice] || undefined };
  return { pres, voice_id: voices[i.voice] || pres?.voice_id || voices[pres?.voice] || undefined };
}
// Presenter photo (preset, or generated once from a description). Returns the URL or null while it renders.
async function presenterUrl(job, st, i) {
  if (st.presenterUrl) return st.presenterUrl;
  const { pres } = voiceFor(i);
  if (i.actor && i.actor.image_url) { st.presenterUrl = absUrl(i.actor.image_url); return st.presenterUrl; }
  if (i.presenter_desc) {
    const img = await runStep(job, st, 'presenter', 'image', { prompt: `Authentic UGC creator selfie photo, ${i.presenter_desc}, looking at the camera, natural light, realistic smartphone photo, vertical`, size: '1080x1920', aspect: '9:16' });
    if (!img) return null;
    st.presenterUrl = img.url;
  } else st.presenterUrl = absUrl(pres?.img || '/samples/creator-3.png');
  return st.presenterUrl;
}
const progressOf = (st) => Object.values(st.sub || {}).reduce((m, s) => Math.max(m, s.progress || 0), 0);

// ---------- Voice tiers + pronunciation (SPEC §12) ----------
// Voice providers carry config.tier 'standard' | 'ultra'. The job's tier picks the rows; if none match, any voice row is used.
function voiceChain(tier) {
  const all = providers.chain('voice');
  const want = tier === 'ultra' ? 'ultra' : 'standard';
  const match = all.filter((p) => p.adapter === 'mock' || (p.config?.tier === 'ultra' ? 'ultra' : 'standard') === want);
  return match.length ? [...match, ...all.filter((p) => !match.includes(p))] : all;
}
// Every TTS call goes through here so the pronunciation dictionary always applies.
function voiceStep(job, st, key, i, text, voice_id) {
  return runStep(job, st, key, 'voice', { text: pronounce.forTts(text), voice_id, language: i.language, tier: i.voice_tier || 'standard' }, voiceChain(i.voice_tier));
}

// ---------- Background music (SPEC §12) ----------
// Library first when the customer picked the library, AI music first otherwise. Demo mode (no music source at all) uses samples.
function musicChain(source) {
  const rows = providers.chain('music').filter((p) => p.adapter !== 'mock');
  const lib = rows.filter((p) => p.adapter === 'library');
  const ai = rows.filter((p) => p.adapter !== 'library');
  const libReady = (getSetting('music_library') || []).length > 0;
  const list = source === 'library' ? [...(libReady ? lib : []), ...ai] : [...ai, ...(libReady ? lib : [])];
  return list.length ? list : [{ id: 0, name: 'Demo', kind: 'music', adapter: 'mock', config: {}, apiKey: '', model: 'demo' }];
}
// Returns undefined (no music asked), null (still working) or {url} / {error}.
async function musicStep(job, st, i, seconds) {
  if (!i.music?.enabled) return undefined;
  if (st.music) return st.music;
  if (i.music.source === 'brand') {
    try { st.music = require('./videotools').brandTrackFor(job, i); }
    catch (e) { st.music = { error: e.message }; }
    return st.music;
  }
  try {
    const r = await runStep(job, st, 'music', 'music', { mood: i.music.mood, seconds, prompt: undefined }, musicChain(i.music.source));
    if (!r) return null;
    st.music = { url: await media.mirror(r.url, job.user_id), mood: r.mood || i.music.mood, source: r.source || i.music.source };
  } catch (e) {
    console.warn('[jobs] music', job.id, e.message);
    st.music = { error: 'We could not add background music this time: ' + e.message };
  }
  return st.music;
}
// Put the music under a finished video. Returns null while working, else {url, music_url, music_note}.
async function withMusic(job, st, i, videoUrl, seconds) {
  const m = await musicStep(job, st, i, seconds);
  if (m === undefined) return { url: videoUrl };
  if (m === null) return null;
  if (m.error || !videoUrl) return { url: videoUrl, music_url: m.url || null, music_note: m.error };
  if (st.mixed) return st.mixed;
  if (!stitch.available()) return (st.mixed = { url: videoUrl, music_url: m.url, music_note: 'The music track is ready. It is mixed in automatically once ffmpeg is installed on the server.' });
  const r = background(job, 'music_mix', () => stitch.mixMusic(videoUrl, m.url, { userId: job.user_id }));
  if (r.pending) return null;
  if (r.error) { console.warn('[jobs] music mix', job.id, r.error.message); return (st.mixed = { url: videoUrl, music_url: m.url, music_note: 'We could not mix the music in, so the track is attached separately.' }); }
  return (st.mixed = { url: r.result, music_url: m.url, music_mixed: true });
}
const musicOut = (mx) => (mx.music_url !== undefined ? { music_url: mx.music_url, music_mixed: !!mx.music_mixed, music_note: mx.music_note } : {});

// Stitch clips (or return a playlist when ffmpeg is missing or fails). Returns null while working.
function stitchOrPlaylist(job, st, key, urls, aspect) {
  if (st[key]) return st[key];
  if (urls.length === 1) return (st[key] = { url: urls[0], stitched: false });
  if (!stitch.available()) return (st[key] = { url: null, stitched: false, note: 'Your video is ready as parts that play in order. Automatic joining starts once ffmpeg is installed on the server.' });
  const r = background(job, key, () => stitch.concat(urls, { userId: job.user_id, aspect }));
  if (r.pending) return null;
  if (r.error) { console.warn('[jobs] stitch failed', job.id, r.error.message); return (st[key] = { url: null, stitched: false, note: 'We could not join the parts automatically, so they play in order as a playlist.' }); }
  return (st[key] = { url: r.result, stitched: true });
}

// advance() moves a job forward. It returns true when it made progress without waiting, so the worker can call it again.
const obj = (v) => (v && typeof v === 'object' ? v : J(v, {}));
async function advance(job) {
  const i = obj(job.input);
  const st = obj(job.state);
  st.steps = STEP_LABELS[job.type] || [];
  const save = (patch = {}) => { update(job, { ...patch, state: st }); return false; };
  const next = (patch = {}) => { update(job, { ...patch, state: st }); return true; };
  const done = (output) => {
    // Finish (free, local ffmpeg): Auto-edit (burnt-in captions) and Logo & end card from the Brand kit. The clean video stays
    // as master_url so chat edits can restyle it later.
    const fin = finishPlan(job, i, output);
    if (fin && !st.finished) {
      const r = background(job, 'finish', () => finishVideo(job, output, fin));
      if (r.pending) { st.progress = Math.max(st.progress || 0, 0.97); return save({ step: 'Finishing' }); }
      st.finished = r.error ? { error: String(r.error.message).slice(0, 200) } : r.result;
      if (r.error) console.warn('[jobs] finish', job.id, r.error.message);
    }
    // Parts made on a lower level than paid for (fallback): the price difference goes back to the customer, once.
    if (st.lower && st.lower.length && !st.lowerRefunded) {
      const vt = videotypes.byId(i.video_type), all_ = vt ? levels.list(vt) : [];
      const cpu = (id) => (all_.find((l) => l.id === id) || {}).credits_per_unit || 0;
      const diff = Math.floor(st.lower.reduce((t, x) => t + Math.max(0, cpu(i.level) - cpu(x.level)) * (x.seconds || 0), 0));
      if (diff > 0) { credits.grant(job.user_id, Math.min(diff, Number(job.credits) || 0), 'topup', `Difference back: part of this video was made on a lower quality`, 'job:' + job.id); output.level_note = `Part of this video was made on a lower quality because the ${i.level_name || i.level} model was not available, so ${Math.min(diff, Number(job.credits) || 0)} credits went back to your balance.`; }
      st.lowerRefunded = true;
    }
    if (fin && st.finished && !st.finished.error) { output.master_url = output.master_url || output.url; output.url = st.finished.url; output.look = st.finished.look; output.captioned = !!st.finished.look.captions; }
    else if (fin && st.finished && st.finished.error) output.finish_note = 'We could not add the captions or logo this time, so this is the clean video. Ask for them in the chat edit.';
    st.progress = 1;
    // Chat editing needs the video before music was mixed in (so music can be swapped or turned down later).
    if (output && output.music_mixed && !output.master_url) output.master_url = (st.joined && st.joined.url) || (st.built && st.built.url) || null;
    if (job.type === 'hooks') { try { require('./email').hooks.firstHooks(get('SELECT * FROM users WHERE id = ?', job.user_id)); } catch (e) { console.warn('[email]', e.message); } }
    try { require('./email').hooks.jobDone(job, output); } catch (e) { console.warn('[email]', e.message); } // "Your video is ready", low credits
    return save({ status: 'done', step: 'Done', output });
  };
  if (job.status === 'queued') update(job, { status: 'running' });
  // AI tools built in Admin → AI tools (server/aitools.js) run through the same step runner, refunds and limits.
  if (job.type === 'tool') return require('./aitools').advance(job, { st, i, runStep, save, done });
  // Change background, Auto-edit and Brand music (server/videotools.js).
  if (TOOL_PIPES.includes(job.type)) return require('./videotools').advance(job, { st, i, runStep, save, next, done, background, musicStep });

  if (job.type === 'edit') return require('./chatedit').advance(job, { st, i, runStep, save, next, done, background });
  // Cheap checks before the first paid step: is there a video model for this quality, and can it take these clip lengths?
  // Catching it here costs nothing; finding out after the voiceover is paid would waste it.
  if (!st.prechecked && ['ugc', 'video', 'image_to_video', 'street', 'hook_remix', 'mad_edit'].includes(job.type) && !(job.type === 'mad_edit' && i.source === 'own')) {
    precheck(job, i);
    st.prechecked = true;
  }
  if (job.type === 'street') return streetAdvance(job, st, i, { save, next, done });
  if (job.type === 'mad_edit') return madAdvance(job, st, i, { save, next, done });
  if (job.type === 'actor') {
    const actors = require('./actors');
    st.faces = st.faces || [];
    for (let k = 0; k < 4; k++) {
      if (st.faces[k]) continue;
      const r = await runStep(job, st, 'face' + k, 'image', { prompt: actors.facePrompt(i.description, k), size: '1080x1350', aspect: '4:5' });
      if (!r) { st.progress = k / 4; return save({ step: `Making faces (${k + 1}/4)` }); }
      st.faces[k] = await media.mirror(r.url, job.user_id);
      return next({ step: `Making faces (${k + 1}/4)` });
    }
    return done({ faces: st.faces, description: i.description });
  }

  if (job.type === 'hooks') {
    const r = await runStep(job, st, 'text', 'text', hooksPrompt(i));
    if (!r) return save({ step: 'Writing hooks' });
    const list = parseJsonLoose(r.text, []).filter((x) => typeof x === 'string').slice(0, 20);
    if (!list.length) throw new Error('The text provider returned no hooks.');
    return done({ hooks: list.map((h) => ({ text: h, shield: shield.scan(h, i.niche) })), vertical: brain.detectVertical(i)?.id || null });
  }

  if (job.type === 'script') {
    const r = await runStep(job, st, 'text', 'text', scriptPrompt(i));
    if (!r) return save({ step: 'Writing script' });
    const s = parseJsonLoose(r.text, null);
    if (!s || !Array.isArray(s.lines)) throw new Error('The text provider returned an unreadable script.');
    return done({ script: s, shield: shield.scan(s.lines.join(' '), i.niche), vertical: brain.detectVertical(i)?.id || null });
  }

  if (job.type === 'angles') {
    const r = await runStep(job, st, 'text', 'text', anglesPrompt(i));
    if (!r) return save({ step: 'Finding angles' });
    const list = (parseJsonLoose(r.text, []) || []).filter((a) => a && typeof a === 'object' && a.hook).slice(0, 10)
      .map((a) => ({ angle: str(a.angle), hook: str(a.hook), why: str(a.why), shield: shield.scan(str(a.hook), i.niche) }));
    if (!list.length) throw new Error('The text provider returned no angles.');
    return done({ angles: list, vertical: brain.detectVertical(i)?.id || null });
  }

  if (job.type === 'image') {
    const count = Math.max(1, Math.min(10, Math.floor(Number(i.count)) || 1));
    st.images = st.images || [];
    for (let n = 0; n < count; n++) {
      for (const [ratio, size] of IMAGE_SIZES) {
        const key = `img${n}_${ratio}`;
        const r = await runStep(job, st, key, 'image', { prompt: imagePrompt(i, ratio) + (n ? ` Variation ${n + 1}.` : ''), size, aspect: ratio });
        if (!r) { st.progress = st.images.length / (count * 3); return save({ step: `Rendering ${ratio}` }); }
        if (!st.images.find((x) => x.key === key)) st.images.push({ key, ratio, url: await media.mirror(r.url, job.user_id) });
      }
    }
    return done({ images: st.images.map(({ ratio, url }) => ({ ratio, url })) });
  }

  if (job.type === 'video' || job.type === 'image_to_video') {
    const n = Math.max(1, Number(i.segments) || 1);
    const segLen = levelType(i)?.segment_seconds || i.duration;
    const clips = Array.isArray(i.clips) && i.clips.length === n ? i.clips : null;
    st.seg = st.seg || [];
    for (let k = 0; k < n; k++) {
      if (st.seg[k]) continue;
      const start = clips ? clips.slice(0, k).reduce((t, c) => t + c, 0) : k * segLen;
      const len = clips ? clips[k] : k === n - 1 ? Math.max(5, i.duration - start) : segLen;
      const prompt = videoPrompt(i) + (n > 1 ? ` Shot ${k + 1} of ${n}: ${k === 0 ? 'opening shot' : k === n - 1 ? 'closing shot' : 'continue the same scene from a new angle'}, same product and setting.` : '');
      const key = n > 1 ? `video${k}` : 'video';
      if (st.stillParts && st.stillParts[k]) {
        const sr = background(job, 'still' + k, () => stillPart(job, st, i, k, len, null));
        if (sr.pending) return save({ step: `Still shot for part ${k + 1}` });
        if (sr.error) throw sr.error;
        st.seg[k] = { url: sr.result, start, end: Math.min(i.duration, start + len), still: true };
        return next({ step: segLabel(k, n, 'Still shot ready') });
      }
      const r = await runStep(job, st, key, 'video', { prompt, duration: len, aspect: i.aspect || '9:16', image_url: i.image_url });
      if (!r) { st.progress = Math.max(st.progress || 0, (k + progressOf(st) * 0.9) / (n + 0.2)); return save({ step: segLabel(k, n, job.type === 'video' ? 'Rendering video' : 'Animating') }); }
      st.seg[k] = { url: await media.mirror(r.url, job.user_id), start, end: Math.min(i.duration, start + len) };
      return next({ step: segLabel(k, n, 'Rendered') });
    }
    const s = stitchOrPlaylist(job, st, 'joined', st.seg.map((x) => x.url), i.aspect);
    if (!s) return save({ step: 'Stitching' });
    const mx = await withMusic(job, st, i, s.url || (n === 1 ? st.seg[0].url : null), i.duration);
    if (!mx) return save({ step: 'Music' });
    return done({ url: mx.url || s.url || st.seg[0].url, duration: i.duration, aspect: i.aspect || '9:16', segments: n > 1 ? st.seg : undefined, stitched: s.stitched, playlist: n > 1 && !s.stitched, note: s.note, ...musicOut(mx) });
  }

  if (job.type === 'ugc') {
    // 1. Script, then Ban Shield auto-fix before anything is spoken.
    if (!st.script) {
      if (i.write_script) {
        const r = await runStep(job, st, 'script', 'text', scriptPrompt(i));
        if (!r) return save({ step: 'Script' });
        const s = parseJsonLoose(r.text, null);
        if (!s || !Array.isArray(s.lines)) throw new Error('The script writer returned an unreadable script.');
        st.script = s.lines.join(' ');
        st.scriptObj = s;
      } else st.script = str(i.script);
      const check = shield.scan(st.script, i.niche);
      st.shield = check;
      if (check.flags.length) st.script = shield.rewrite(st.script, i.niche);
      st.progress = 0.12;
      return next({ step: 'Ban Shield check' });
    }
    // 2. Presenter (same for every segment)
    const pUrl = await presenterUrl(job, st, i);
    if (!pUrl) return save({ step: 'Presenter' });
    // 3. Segments: voice → talking presenter, in order, same presenter and voice.
    const n = Math.max(1, Number(i.segments) || 1);
    if (!st.parts) st.parts = splitScript(st.script, n);
    const parts = st.parts;
    const totalWords = parts.reduce((t, p) => t + p.split(/\s+/).length, 0) || 1;
    const { pres, voice_id } = voiceFor(i);
    st.seg = st.seg || [];
    let acc = 0;
    for (let k = 0; k < parts.length; k++) {
      const words = parts[k].split(/\s+/).length;
      const start = Math.round((i.duration * acc) / totalWords * 10) / 10;
      acc += words;
      if (st.seg[k]) continue;
      const vk = parts.length > 1 ? `voice${k}` : 'voice';
      const voice = await voiceStep(job, st, vk, i, parts[k], voice_id);
      if (!voice) return save({ step: segLabel(k, parts.length, 'Voice') });
      const uk = parts.length > 1 ? `ugc${k}` : 'ugc';
      if (st.stillParts && st.stillParts[k]) {
        const clipLenS = Array.isArray(i.clips) && i.clips[k] ? i.clips[k] : Math.max(1, Math.round(i.duration / parts.length));
        const r = background(job, 'still' + k, () => stillPart(job, st, i, k, clipLenS, voice.url));
        if (r.pending) return save({ step: `Still shot for part ${k + 1}` });
        if (r.error) throw r.error;
        st.seg[k] = { url: r.result, start, end: Math.round((i.duration * acc) / totalWords * 10) / 10, still: true };
        return next({ step: segLabel(k, parts.length, 'Still shot ready') });
      }
      const clipLen = Array.isArray(i.clips) && i.clips[k] ? i.clips[k] : Math.max(1, Math.round(i.duration / parts.length));
      const vid = await runStep(job, st, uk, 'ugc', { image_url: pUrl, audio_url: absUrl(voice.url), prompt: i.direction || typeDirection(i.video_type), text: parts[k], duration: clipLen, aspect: i.aspect || '9:16' });
      if (!vid) { st.progress = Math.max(st.progress || 0, 0.15 + 0.75 * ((k + progressOf(st) * 0.9) / parts.length)); return save({ step: segLabel(k, parts.length, 'Rendering presenter video') }); }
      st.seg[k] = { url: await media.mirror(vid.url, job.user_id), start, end: Math.round((i.duration * acc) / totalWords * 10) / 10 };
      return next({ step: segLabel(k, parts.length, 'Rendered') });
    }
    // 4. Stitch + captions for the full length
    const s = stitchOrPlaylist(job, st, 'joined', st.seg.map((x) => x.url), i.aspect);
    if (!s) return save({ step: `Stitching ${n} parts` });
    const mx = await withMusic(job, st, i, s.url || (n === 1 ? st.seg[0].url : null), i.duration);
    if (!mx) return save({ step: 'Music' });
    const cap = media.save(Buffer.from(makeSrt(st.script, i.duration)), 'text/plain', job.user_id);
    if (n > 1) notifyLong(job, mx.url || s.url || st.seg[0].url);
    return done({
      ...musicOut(mx),
      url: mx.url || s.url || st.seg[0].url, script: st.script, script_obj: st.scriptObj || null, captions_url: cap.path, shield: st.shield, duration: i.duration,
      presenter: pres?.name, segments: n > 1 ? st.seg : undefined, stitched: s.stitched, playlist: n > 1 && !s.stitched, note: s.note,
    });
  }

  if (job.type === 'slideshow') {
    if (!st.lines) {
      let lines = Array.isArray(i.lines) ? i.lines : null;
      if (!lines) {
        const r = await runStep(job, st, 'slides', 'text', slidesPrompt(i));
        if (!r) return save({ step: 'Writing slides' });
        lines = (parseJsonLoose(r.text, []) || []).filter((x) => typeof x === 'string' && x.trim());
        if (lines.length < 2) throw new Error('The text provider returned no slides.');
      }
      st.lines = lines.slice(0, 8).map((l) => shield.rewrite(str(l), i.niche));
      st.shield = shield.scan(st.lines.join(' '), i.niche);
      st.progress = 0.15;
      return next({ step: 'Ban Shield check' });
    }
    const n = st.lines.length;
    st.images = st.images || [];
    for (let k = 0; k < n; k++) {
      if (st.images[k]) continue;
      const r = await runStep(job, st, `img${k}`, 'image', { prompt: `Scroll-stopping vertical ad photo for slide ${k + 1} of a slideshow about ${i.product}. The slide says: "${st.lines[k]}". Photorealistic, bright, clean, room for a caption at the bottom. No text in the image.`, size: ASPECT_SIZE[i.aspect] || ASPECT_SIZE['9:16'], aspect: i.aspect || '9:16' });
      if (!r) { st.progress = 0.15 + 0.5 * (k / n); return save({ step: `Making images (${k + 1}/${n})` }); }
      st.images[k] = await media.mirror(r.url, job.user_id);
      return next({ step: `Making images (${k + 1}/${n})` });
    }
    const { voice_id } = voiceFor(i);
    const voice = await voiceStep(job, st, 'voice', i, st.lines.join(' '), voice_id);
    if (!voice) return save({ step: 'Voiceover' });
    const per = i.duration / n;
    const slides = st.lines.map((text, k) => ({ text, image_url: st.images[k], start: Math.round(k * per * 10) / 10, end: Math.round((k + 1) * per * 10) / 10 }));
    const srt = slides.map((s, k) => `${k + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text}\n`).join('\n');
    if (!st.built) {
      if (!stitch.available()) st.built = { url: null, note: 'Your slides and voiceover are ready. The joined slideshow video is made once ffmpeg is installed on the server.' };
      else {
        const r = background(job, 'slideshow', () => stitch.slideshow({ images: st.images, audioUrl: voice.url, srt, seconds: i.duration, aspect: i.aspect, userId: job.user_id }));
        if (r.pending) { st.progress = Math.max(st.progress || 0, 0.8); return save({ step: 'Building slideshow' }); }
        st.built = r.error ? { url: null, note: 'We could not build the slideshow video, so the slides and voiceover are ready to use separately.' } : { url: r.result.url, captioned: r.result.captioned };
        if (r.error) console.warn('[jobs] slideshow failed', job.id, r.error.message);
      }
    }
    const mx = await withMusic(job, st, i, st.built.url, i.duration);
    if (!mx) return save({ step: 'Music' });
    const cap = media.save(Buffer.from(srt), 'text/plain', job.user_id);
    return done({ ...musicOut(mx), url: mx.url || st.built.url, slides, audio_url: voice.url, captions_url: cap.path, duration: i.duration, aspect: i.aspect || '9:16', stitched: !!st.built.url, captioned: !!st.built.captioned, shield: st.shield, note: st.built.note });
  }

  if (job.type === 'dub') {
    if (!st.text) {
      if ((i.source_language || '') === i.language) st.text = str(i.script);
      else {
        const r = await runStep(job, st, 'translate', 'text', translatePrompt(i));
        if (!r) return save({ step: 'Translating' });
        const o = parseJsonLoose(r.text, null);
        st.text = str(o && typeof o === 'object' && !Array.isArray(o) ? o.text : r.text);
        if (!st.text) throw new Error('The text provider returned no translation.');
      }
      st.shield = shield.scan(st.text, i.niche);
      if (st.shield.flags.length) st.text = shield.rewrite(st.text, i.niche);
      st.progress = 0.2;
      return next({ step: 'Ban Shield check' });
    }
    const { voice_id } = voiceFor(i);
    const voice = await voiceStep(job, st, 'voice', i, st.text, voice_id);
    if (!voice) return save({ step: 'New voice' });
    // Lip-sync: a 'dub' provider when one is set up; otherwise a UGC presenter re-voices it; demo mode uses samples.
    if (!st.mode) st.mode = !providers.isDemo('dub') || providers.isDemo('ugc') ? 'dub' : 'ugc';
    let out;
    if (st.mode === 'dub') out = await runStep(job, st, 'lipsync', 'dub', { video_url: absUrl(i.video_url), audio_url: absUrl(voice.url), prompt: 'Lip-sync the speaker to the new voice track' });
    else {
      const pUrl = await presenterUrl(job, st, i);
      if (!pUrl) return save({ step: 'Presenter' });
      out = await runStep(job, st, 'lipsync', 'ugc', { image_url: pUrl, audio_url: absUrl(voice.url), prompt: 'Natural UGC creator talking to the phone camera' });
    }
    if (!out) { st.progress = Math.max(st.progress || 0, 0.4 + 0.5 * progressOf(st)); return save({ step: 'Lip-sync' }); }
    const url = await media.mirror(out.url, job.user_id);
    const cap = media.save(Buffer.from(makeSrt(st.text, i.duration)), 'text/plain', job.user_id);
    return done({
      url, audio_url: voice.url, script_translated: st.text, source_script: i.script, language: i.language, captions_url: cap.path, duration: i.duration, shield: st.shield, mode: st.mode,
      note: st.mode === 'ugc' ? 'No lip-sync provider is set up, so a presenter speaks the translated script. Add a "dub" provider in Admin → AI providers to keep the original video.' : undefined,
    });
  }

  if (job.type === 'hook_remix') {
    if (!st.hooks) {
      let hooks = Array.isArray(i.hooks) ? i.hooks : null;
      if (!hooks) {
        const r = await runStep(job, st, 'text', 'text', hookRemixPrompt(i));
        if (!r) return save({ step: 'Writing hooks' });
        hooks = (parseJsonLoose(r.text, []) || []).filter((x) => typeof x === 'string' && x.trim());
        if (!hooks.length) throw new Error('The text provider returned no hooks.');
      }
      st.hooks = hooks.slice(0, i.count).map((h) => shield.rewrite(str(h), i.niche));
      st.progress = 0.1;
      return next({ step: 'Ban Shield check' });
    }
    const pUrl = await presenterUrl(job, st, i);
    if (!pUrl) return save({ step: 'Presenter' });
    const { voice_id } = voiceFor(i);
    const kind = videotypes.byId(i.video_type)?.provider_kind || 'ugc';
    st.clips = st.clips || [];
    for (let k = 0; k < st.hooks.length; k++) {
      if (st.clips[k]) continue;
      const voice = await voiceStep(job, st, `voice${k}`, i, st.hooks[k], voice_id);
      if (!voice) return save({ step: `Rendering hooks (${k + 1}/${st.hooks.length})` });
      const input = kind === 'video'
        ? { prompt: `UGC creator says to camera: "${st.hooks[k]}". ${i.product}. Vertical, handheld phone feel.`, duration: i.duration, aspect: '9:16' }
        : { image_url: pUrl, audio_url: absUrl(voice.url), prompt: 'Energetic UGC creator opening line to the phone camera', text: st.hooks[k], duration: i.duration, aspect: '9:16' };
      const vid = await runStep(job, st, `hook${k}`, kind, input);
      if (!vid) { st.progress = 0.1 + 0.7 * ((k + progressOf(st) * 0.9) / st.hooks.length); return save({ step: `Rendering hooks (${k + 1}/${st.hooks.length})` }); }
      st.clips[k] = await media.mirror(vid.url, job.user_id);
      return next({ step: `Rendering hooks (${k + 1}/${st.hooks.length})` });
    }
    // Splice each hook in front of the original ad (needs ffmpeg and the ad link).
    if (!st.remix) {
      if (!i.video_url) st.remix = { urls: [], note: 'Add the link to your ad to get versions with each hook already spliced in.' };
      else if (!stitch.available()) st.remix = { urls: [], note: 'Hook clips are ready. Splicing them onto your ad starts once ffmpeg is installed on the server.' };
      else {
        const r = background(job, 'remix', async () => { const out = []; for (const c of st.clips) out.push(await stitch.concat([c, i.video_url], { userId: job.user_id })); return out; });
        if (r.pending) { st.progress = Math.max(st.progress || 0, 0.85); return save({ step: 'Splicing' }); }
        st.remix = r.error ? { urls: [], note: 'We could not splice the hooks onto your ad, so the hook clips are ready to add in your editor.' } : { urls: r.result };
        if (r.error) console.warn('[jobs] remix failed', job.id, r.error.message);
      }
    }
    return done({ hooks: st.hooks.map((text, k) => ({ text, url: st.clips[k], seconds: i.duration, remix_url: st.remix.urls[k] || null, shield: shield.scan(text, i.niche) })), source_video: i.video_url || null, note: st.remix.note });
  }
  if (job.type === 'motion_ad') {
    // 1. Scene plan from the AI brain: headline, voiceover line and a stock-footage search per scene.
    if (!st.plan) {
      const r = await runStep(job, st, 'plan', 'text', motionPlanPrompt(i));
      if (!r) return save({ step: 'Planning scenes' });
      const o = parseJsonLoose(r.text, null);
      const raw = (Array.isArray(o) ? o : o?.scenes || []).filter((x) => x && typeof x === 'object' && (x.headline || x.vo)).slice(0, 8);
      if (raw.length < 2) throw new Error('The text provider returned no scene plan.');
      st.plan = raw.map((x) => ({
        headline: shield.rewrite(str(x.headline || x.vo).split(/\s+/).slice(0, 6).join(' '), i.niche),
        vo: shield.rewrite(str(x.vo), i.niche),
        query: str(x.query || x.visual || i.product).slice(0, 100),
      }));
      st.cta = str(i.cta) || str(o?.cta).slice(0, 30) || 'Shop now';
      st.shield = shield.scan(st.plan.map((x) => x.headline + '. ' + x.vo).join(' '), i.niche);
      st.progress = 0.1;
      return next({ step: 'Ban Shield check' });
    }
    const n = st.plan.length;
    const ultra = i.quality === 'ultra';
    const segLen = videotypes.byId(i.video_type)?.segment_seconds || 5;
    const sceneLen = guard.motionSceneSeconds(levelType(i), i.duration, n); // AI shot length per scene (priced the same way)
    // 2. Visuals: ultra = an AI video shot per scene; standard = stock footage (Pexels/Pixabay), else an AI image with Ken Burns.
    st.vis = st.vis || [];
    st.stockFail = st.stockFail || {};
    for (let k = 0; k < n; k++) {
      if (st.vis[k]) continue;
      const sc = st.plan[k];
      const label = `Visuals (${k + 1}/${n})`;
      if (ultra) {
        const r = await runStep(job, st, `scene${k}`, 'video', { prompt: `${sc.query}. ${MOTION_LOOK[i.style] || MOTION_LOOK.bold}. Ad for ${i.product}. ${i.aspect} frame, cinematic, realistic, smooth camera move, no text or logos.`, duration: sceneLen, aspect: i.aspect, image_url: k === 0 && i.image_url ? absUrl(i.image_url) : undefined });
        if (!r) { st.progress = 0.1 + 0.55 * ((k + progressOf(st) * 0.9) / n); return save({ step: label }); }
        st.vis[k] = { url: await media.mirror(r.url, job.user_id), type: 'video', source: 'ai_video' };
        return next({ step: label });
      }
      if (!st.stockFail[k]) {
        let r = null;
        try { r = await runStep(job, st, `stock${k}`, 'stock', { query: sc.query, aspect: i.aspect, min_seconds: segLen }); }
        catch (e) { st.stockFail[k] = e.message; }
        if (r) {
          st.vis[k] = { url: await media.mirror(r.url, job.user_id), type: 'video', source: r.source || 'stock', credit: r.credit || null };
          return next({ step: label });
        }
        if (!st.stockFail[k]) return save({ step: label });
      }
      const img = await runStep(job, st, `img${k}`, 'image', { prompt: `${sc.query}, for an ad about ${i.product}. ${MOTION_LOOK[i.style] || MOTION_LOOK.bold}. Photorealistic, room for a headline, no text in the image.`, size: ASPECT_SIZE[i.aspect] || ASPECT_SIZE['9:16'], aspect: i.aspect });
      if (!img) { st.progress = 0.1 + 0.55 * (k / n); return save({ step: label }); }
      st.vis[k] = { url: await media.mirror(img.url, job.user_id), type: 'image', source: 'ai_image' };
      return next({ step: label });
    }
    // 3. Voiceover (tiered, pronunciation applied) and 4. music
    const { voice_id } = voiceFor(i);
    const voice = await voiceStep(job, st, 'voice', i, st.plan.map((x) => x.vo).join(' '), voice_id);
    if (!voice) { st.progress = Math.max(st.progress || 0, 0.7); return save({ step: 'Voiceover' }); }
    const music = await musicStep(job, st, i, i.duration);
    if (music === null) return save({ step: 'Music' });
    // 5. Compose with ffmpeg (or hand back the parts as a playlist).
    const tm = motionTiming(i.duration, n);
    const scenes = st.plan.map((x, k) => ({ ...x, visual_url: st.vis[k].url, visual_type: st.vis[k].type, source: st.vis[k].source, credit: st.vis[k].credit || undefined, ...tm.scenes[k] }));
    const srt = scenes.map((x, k) => `${k + 1}\n${ts(x.start)} --> ${ts(Math.min(x.end, tm.endcard.start))}\n${x.vo || x.headline}\n`).join('\n');
    if (!st.built) {
      if (!stitch.available()) st.built = { url: null, note: 'Your scenes, voiceover and music are ready and play in order. The finished animated video is made once ffmpeg is installed on the server.' };
      else {
        const r = background(job, 'motion', () => stitch.motionAd({
          scenes: st.vis.map((v, k) => ({ url: v.url, type: v.type, headline: st.plan[k].headline })), voiceUrl: voice.url, musicUrl: music && !music.error ? music.url : null,
          seconds: i.duration, aspect: i.aspect, brandColor: i.brand_color, style: i.style, logoUrl: i.logo_url, imageUrl: i.image_url, cta: st.cta, product: i.brand || i.product, userId: job.user_id,
        }));
        if (r.pending) { st.progress = Math.max(st.progress || 0, 0.85); return save({ step: 'Animating' }); }
        if (r.error) console.warn('[jobs] motion ad compose failed', job.id, r.error.message);
        st.built = r.error ? { url: null, note: 'We could not render the finished video, so the scenes, voiceover and music play in order as a playlist.' } : { url: r.result.url };
      }
    }
    const cap = media.save(Buffer.from(srt), 'text/plain', job.user_id);
    return done({
      url: st.built.url, scenes, endcard: { ...tm.endcard, cta: st.cta, logo_url: i.logo_url || null, image_url: i.image_url || null }, audio_url: voice.url,
      music_url: music && !music.error ? music.url : null, music_note: music?.error, captions_url: cap.path, duration: i.duration, aspect: i.aspect, style: i.style,
      brand_color: i.brand_color || null, quality: i.quality, voice_tier: i.voice_tier, stitched: !!st.built.url, playlist: !st.built.url, shield: st.shield, note: st.built.note,
    });
  }
  throw new Error('Unknown job type ' + job.type);
}

// ---------- Street interview ----------
// Presenter with a handheld mic + a passer-by, two speakers, ambient street sound. The AI brain writes the Q&A; each part
// (up to the level's clip length, 8s on Veo 3.1) is one clip with native dialogue audio; parts are stitched.
function streetPrompt(i) {
  const secs = Number(i.duration) || 15;
  return {
    mode: 'street', topic: i.product,
    system: brain.systemFor('ugc', i),
    prompt: `Write a street-interview video ad of ${secs} seconds. A presenter with a handheld microphone stops a passer-by on a city street.
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
${i.question ? `The presenter's first question: "${i.question}"\n` : ''}Language: ${langName(i.language)} (natural spoken street talk)
About ${Math.round(secs * 2.3)} spoken words in total, in short turns (max 14 words each). The presenter asks, the passer-by answers in their own words and mentions the product naturally, the last line is a short call to action.
This is a dramatization with AI actors: no real names, no claims of being a real customer, no fake statistics, no guarantees.
Return ONLY JSON: {"lines": [{"who": "host", "text": "..."}, {"who": "guest", "text": "..."}], "guest": "short visual description of the passer-by"}`,
    max_tokens: 1200,
  };
}
// "Host: ... / Guest: ..." pasted scripts.
function parseDialogue(text) {
  return String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l, k) => {
    const m = l.match(/^(host|presenter|interviewer|q|guest|passer-?by|a)\s*[:\-]\s*(.+)$/i);
    return m ? { who: /^(host|presenter|interviewer|q)$/i.test(m[1]) ? 'host' : 'guest', text: m[2] } : { who: k % 2 ? 'guest' : 'host', text: l };
  }).slice(0, 30);
}
function streetParts(lines, seconds, segLen) {
  const words = (l) => l.text.split(/\s+/).length;
  const total = lines.reduce((t, l) => t + words(l), 0) || 1;
  const n = Math.max(1, Math.ceil(seconds / segLen));
  const per = total / n;
  const parts = Array.from({ length: n }, () => []);
  let acc = 0;
  for (const l of lines) { const k = Math.min(n - 1, Math.floor(acc / per)); parts[k].push(l); acc += words(l); }
  return parts.map((p) => (p.length ? p : [{ who: 'guest', text: '' }]));
}
async function streetAdvance(job, st, i, { save, next, done }) {
  if (!st.lines) {
    let lines = i.script ? parseDialogue(i.script) : null, guest = '';
    if (!lines) {
      const r = await runStep(job, st, 'script', 'text', streetPrompt(i));
      if (!r) return save({ step: 'Writing the interview' });
      const o = parseJsonLoose(r.text, null);
      lines = (Array.isArray(o?.lines) ? o.lines : []).filter((x) => x && x.text).map((x) => ({ who: /host|presenter/i.test(x.who) ? 'host' : 'guest', text: str(x.text).slice(0, 160) }));
      guest = str(o?.guest).slice(0, 160);
      if (lines.length < 2) throw new Error('The text provider returned no interview.');
    }
    st.lines = lines.map((l) => ({ ...l, text: shield.rewrite(l.text, i.niche) }));
    st.shield = shield.scan(st.lines.map((l) => l.text).join(' '), i.niche);
    const why = require('./actors').realPersonReason(guest);
    st.guest = i.guest_desc || (!why && guest) || 'a friendly passer-by in their thirties in casual city clothes';
    st.progress = 0.1;
    return next({ step: 'Ban Shield check' });
  }
  const vt = levelType(i);
  const segLen = Number(vt?.segment_seconds) || 8;
  if (!st.parts) st.parts = streetParts(st.lines, i.duration, segLen);
  const n = st.parts.length;
  const host = i.actor ? `${i.actor.name ? 'the presenter ' : ''}${i.actor.description || 'a confident presenter in smart casual clothes'}` : 'a confident presenter in their late twenties in a smart casual jacket';
  st.seg = st.seg || [];
  for (let k = 0; k < n; k++) {
    if (st.seg[k]) continue;
    const len = k === n - 1 ? Math.max(4, i.duration - segLen * (n - 1)) : segLen;
    const talk = st.parts[k].filter((l) => l.text).map((l) => (l.who === 'host' ? `The presenter says into the mic: "${l.text}"` : `The passer-by answers into the mic: "${l.text}"`)).join(' ');
    const prompt = `Handheld vertical street interview on a busy ${i.city || 'city'} sidewalk in daylight. On the left, ${host}, holding a handheld microphone with a foam windscreen toward the passer-by. On the right, ${st.guest}. ${talk} Natural ambient street sound: traffic, footsteps, distant chatter. Documentary realism, natural light, slight handheld movement, same two people and same street as the other parts. No subtitles, no text on screen.`;
    if (st.stillParts && st.stillParts[k]) {
      const sr = background(job, 'still' + k, () => stillPart(job, st, i, k, len, null));
      if (sr.pending) return save({ step: `Still shot for part ${k + 1}` });
      if (sr.error) throw sr.error;
      st.seg[k] = { url: sr.result, start: segLen * k, end: Math.min(i.duration, segLen * k + len), still: true };
      return next({ step: segLabel(k, n, 'Still shot ready') });
    }
    const r = await runStep(job, st, 'part' + k, 'video', { prompt, duration: len, aspect: '9:16' });
    if (!r) { st.progress = 0.1 + 0.75 * ((k + progressOf(st) * 0.9) / n); return save({ step: segLabel(k, n, 'Filming parts') }); }
    st.seg[k] = { url: await media.mirror(r.url, job.user_id), start: segLen * k, end: Math.min(i.duration, segLen * k + len) };
    return next({ step: segLabel(k, n, 'Filmed') });
  }
  const s = stitchOrPlaylist(job, st, 'joined', st.seg.map((x) => x.url), '9:16');
  if (!s) return save({ step: 'Stitching' });
  const script = st.lines.map((l) => l.text).join(' ');
  const cap = media.save(Buffer.from(makeSrt(script, i.duration)), 'text/plain', job.user_id);
  return done({
    url: s.url || st.seg[0].url, lines: st.lines, script, captions_url: cap.path, duration: i.duration, aspect: '9:16', segments: n > 1 ? st.seg : undefined,
    stitched: s.stitched, playlist: n > 1 && !s.stitched, note: s.note, shield: st.shield, ai_label: i.ai_label !== false,
    honesty: 'AI dramatization with AI actors. Do not present it as a real customer or a real interview.',
  });
}

// ---------- Viral edit (internal id mad_edit) ----------
function madPrompt(i) {
  return {
    mode: 'mad_edit', topic: i.product,
    system: brain.systemFor('hooks', i),
    prompt: `Plan a ${i.duration}-second fast-cut "mad edit" video ad.
${brandLine(i)}Product/offer: ${i.product}
Audience: ${i.audience || 'general'}
Language: ${langName(i.language)} (hits and caption in this language)
Give: "hits": 3 to 5 big on-screen text hits, 1 to 3 words each, punchy, compliant (no guarantees);
"caption": one spoken-style line of at most 18 words shown word by word;
"shots": ${Math.ceil((Number(i.duration) || 15) / 5)} short visual descriptions for AI video shots of the product (dynamic, close-ups, motion, no text, no logos).
Return ONLY JSON: {"hits": ["..."], "caption": "...", "shots": ["..."]}`,
    max_tokens: 700,
  };
}
async function madAdvance(job, st, i, { save, next, done }) {
  if (!st.plan) {
    const r = await runStep(job, st, 'plan', 'text', madPrompt(i));
    if (!r) return save({ step: 'Planning the edit' });
    const o = parseJsonLoose(r.text, null) || {};
    const hits = (i.hits && i.hits.length ? i.hits : Array.isArray(o.hits) ? o.hits : []).map((x) => shield.rewrite(str(x).slice(0, 28), i.niche)).filter(Boolean).slice(0, 6);
    st.plan = {
      hits: hits.length ? hits : [str(i.brand || i.product).split(/\s+/).slice(0, 3).join(' '), 'New drop', 'Shop now'],
      caption: shield.rewrite(str(o.caption).split(/\s+/).slice(0, 18).join(' '), i.niche),
      shots: (Array.isArray(o.shots) ? o.shots : []).map((x) => str(x).slice(0, 200)).filter(Boolean),
    };
    st.progress = 0.1;
    return next({ step: 'Shots' });
  }
  const segLen = Number(levelType(i)?.segment_seconds) || 5;
  if (!st.files) {
    if (i.source === 'own') st.files = i.videos.slice();
    else {
      const n = Math.max(1, Math.ceil(i.duration / segLen));
      st.shots = st.shots || [];
      for (let k = 0; k < n; k++) {
        if (st.shots[k]) continue;
        const desc = st.plan.shots[k] || `${i.product}, dynamic close-up ${k % 2 ? 'with fast camera move' : 'rotating on a clean surface'}`;
        const r = await runStep(job, st, 'shot' + k, 'video', { prompt: `${desc}. Ad for ${i.product}. High energy, fast motion, punchy commercial look, ${i.aspect} frame, no text, no logos.`, duration: segLen, aspect: i.aspect });
        if (!r) { st.progress = 0.1 + 0.6 * ((k + progressOf(st) * 0.9) / n); return save({ step: `Shots (${k + 1}/${n})` }); }
        st.shots[k] = await media.mirror(r.url, job.user_id);
        return next({ step: `Shots (${k + 1}/${n})` });
      }
      st.files = st.shots.slice();
    }
  }
  if (!st.built) {
    if (!stitch.available()) st.built = { url: null, note: 'Your shots and edit plan are ready. The viral edit is cut once ffmpeg is installed on the server.' };
    else {
      const r = background(job, 'mad', () => stitch.withTmpDir(async (dir) => {
        const files = [];
        for (const u of st.files) files.push(await stitch.localFile(u, dir, job.user_id));
        const out = require('node:path').join(dir, 'mad.mp4');
        const res = await require('./madedit').render({ files, seconds: i.duration, bpm: i.bpm, hits: st.plan.hits, caption: st.plan.caption, aspect: i.aspect, brandColor: i.brand_color || '#1E4DFF', out });
        return { ...res, url: media.save(require('node:fs').readFileSync(out), 'video/mp4', job.user_id).path };
      }));
      if (r.pending) { st.progress = Math.max(st.progress || 0, 0.8); return save({ step: 'Cutting to the beat' }); }
      if (r.error) { console.warn('[jobs] mad edit failed', job.id, r.error.message); throw new Error('We could not cut the viral edit: ' + r.error.message.slice(0, 160)); }
      st.built = r.result;
    }
  }
  return done({ url: st.built.url, cuts: st.built.cuts, hits: st.plan.hits, caption: st.plan.caption, bpm: i.bpm, duration: i.duration, aspect: i.aspect, source: i.source, shots: i.source === 'own' ? undefined : st.shots, note: st.built.note, sfx: 'Sound effects and beat generated by Vooads (no third-party samples).' });
}

// ---------- Finish: Auto-edit + Logo & end card ----------
function finishPlan(job, i, output) {
  if (!output || !output.url || output.playlist) return null;
  const captions = i.auto_edit === true && ['ugc', 'street', 'dub'].includes(job.type);
  let brand = null;
  if (i.brand_finish) { const u = get('SELECT brand FROM users WHERE id = ?', job.user_id); const b = J(u && u.brand, {}) || {}; if (b.logo_url) brand = b; }
  if (!captions && !brand) return null;
  return { captions, brand };
}
async function finishVideo(job, output, fin) {
  const ops = require('./editops');
  const fs = require('node:fs'), path = require('node:path');
  return stitch.withTmpDir(async (dir) => {
    const src = await ops.withAudio(await stitch.localFile(output.url, dir, job.user_id), dir);
    const D = stitch.probe(src).duration || Number(output.duration) || 15;
    const script = output.script || output.script_translated || (Array.isArray(output.lines) ? output.lines.map((l) => l.text).join(' ') : '');
    const look = {};
    if (fin.captions && script) look.captions = { on: true, style: 'bold', size: 'medium', position: 'bottom' };
    let logoFile = null;
    if (fin.brand) { try { logoFile = await stitch.localFile(fin.brand.logo_url, dir, job.user_id); } catch { logoFile = null; } }
    if (logoFile) { look.logo = { on: true, corner: 'top-right' }; look.end_card = { on: true, cta: String(fin.brand.cta || 'Shop now').slice(0, 30) }; }
    if (!look.captions && !look.logo) return { url: output.url, look: {} };
    if (output.music_mixed && output.music_url && output.master_url) look.music = { on: true, url: output.music_url, volume: 0.35, source: 'original' };
    const out = path.join(dir, 'finished.mp4');
    await ops.finish({ master: src, look: { ...look, music: undefined }, words: ops.wordsFromScript(script, D), brandColor: fin.brand?.color || '#1E4DFF', logoFile, dir, out });
    return { url: media.save(fs.readFileSync(out), 'video/mp4', job.user_id).path, look };
  });
}

// Long video finished: email with a preview made from the joined video (server/email: hooks.longVideo).
function notifyLong(job, url) {
  try { require('./email').hooks.longVideo(job, url); } catch (e) { console.warn('[jobs] long video email', e.message); }
}

function ts(s) {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 36e5)).padStart(2, '0'), m = String(Math.floor((ms % 36e5) / 6e4)).padStart(2, '0'), sec = String(Math.floor((ms % 6e4) / 1000)).padStart(2, '0');
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`;
}
function makeSrt(script, duration) {
  const words = String(script).split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let k = 0; k < words.length; k += 6) chunks.push(words.slice(k, k + 6).join(' '));
  const per = (Number(duration) || 15) / Math.max(1, chunks.length);
  return chunks.map((c, k) => `${k + 1}\n${ts(k * per)} --> ${ts((k + 1) * per)}\n${c}\n`).join('\n');
}

// What the customer reads when a job fails (the technical reason stays in the log and in Admin).
function friendly(msg) {
  const m = String(msg || '');
  if (/rejected|policy|safety|moderation|content/i.test(m)) return 'The AI model declined this one (it can be strict about some words or images). Your credits are back. Try rewording the product line or using another photo.';
  if (TEMP_ERR.test(m)) return 'The AI model was busy and did not answer after a few tries. Your credits are back. Press Try again in a minute: anything already made is reused.';
  return m.length > 200 ? m.slice(0, 200) : m;
}

function precheck(job, i) {
  const kind = job.type === 'hook_remix' ? (videotypes.byId(i.video_type)?.provider_kind || 'ugc') : job.type === 'ugc' ? (videotypes.byId(i.video_type)?.provider_kind || 'ugc') : 'video';
  const chain = levels.KINDS.includes(kind) ? levelChain(job, kind) : providers.chain(kind);
  if (!chain.length) throw new Error(`No ${kind === 'ugc' ? 'presenter' : 'video'} model is available for ${i.level_name || 'this quality'} right now, so nothing was started. Your credits are back.`);
  if (chain[0].adapter === 'mock') return;
  const lens = Array.isArray(i.clips) && i.clips.length ? i.clips : [Number(i.duration) || 5];
  const maxOf = (r) => { const c = r.config || {}; if (Number(c.max_seconds) > 0) return Number(c.max_seconds); if (Array.isArray(c.clip_durations) && c.clip_durations.length) return Math.max(...c.clip_durations.map(Number)); return Infinity; };
  const fits = chain.filter((r) => lens.every((l) => l <= maxOf(r)));
  if (!fits.length) throw new Error(`The ${i.level_name || ''} model cannot make parts this long (${Math.max(...lens)}s). Nothing was started and your credits are back. Pick a shorter length or another quality.`);
  if (job.type === 'image_to_video' && i.image_url && /^(\/media\/|\/samples\/)/.test(String(i.image_url).replace(config.appUrl, ''))) {
    const ng = require('./lib/netguard');
    const u = String(i.image_url).replace(config.appUrl, '');
    const p = u.startsWith('/media/') ? media.filePath(u.slice(7)) : require('./samples').localPath(u.slice(9));
    const head = p ? require('node:fs').readFileSync(p).subarray(0, 32) : null;
    const t = head && ng.sniff(head);
    if (!t || !/^image\//.test(t.mime)) throw new Error('That product photo is not a PNG, JPG or WebP picture, so nothing was started. Your credits are back.');
  }
}

// ---------- Long videos: a part that keeps failing ----------
// The job pauses as "Needs attention" with every finished part and voice kept. The customer picks: try that part again, use
// a still shot for it (free), or cancel. Cancel = a full refund, as the Refund Policy promises for failed jobs; finished parts
// are kept 7 days so a later "Try again" reuses them. Jobs left in "Needs attention" for 7 days are cancelled the same way.
const KEEP_DAYS = 7;
function needsAttention(job, part, msg) {
  const st = obj(job.state);
  st.attention = { part, error: String(msg).slice(0, 300), at: new Date().toISOString(), keep_until: new Date(Date.now() + KEEP_DAYS * 864e5).toISOString() };
  const n = Number(obj(job.input).segments) || 1;
  run("UPDATE jobs SET status = 'attention', step = ?, error = ?, state = ?, updated_at = ? WHERE id = ?", `Part ${part + 1} of ${n} needs your choice`, 'Part ' + (part + 1) + ' could not be made: ' + friendly(msg), ser(st), now(), job.id);
  try { require('./email').hooks.jobAttention(get('SELECT * FROM jobs WHERE id = ?', job.id), part); } catch (e) { console.warn('[email]', e.message); }
}
function resolveAttention(user, jobId, action) {
  const job = get("SELECT * FROM jobs WHERE id = ? AND user_id = ?", Number(jobId) || 0, user.id);
  if (!job) fail(404, 'Video not found.');
  if (job.status !== 'attention') fail(409, 'This video does not need a choice right now.');
  const st = obj(job.state), k = st.attention ? st.attention.part : null;
  if (action === 'cancel') { failJob(job, 'You cancelled this video. All its credits are back.'); return view(get('SELECT * FROM jobs WHERE id = ?', job.id)); }
  if (k === null) fail(409, 'Nothing to do.');
  for (const key of Object.keys(st.sub || {})) if (new RegExp('^(ugc|video|part|shot)' + k + '$').test(key) && !st.sub[key].result) delete st.sub[key];
  if (action === 'still') (st.stillParts = st.stillParts || {})[k] = true;
  else if (action !== 'retry') fail(400, 'Pick: try again, use a still shot, or cancel.');
  delete st.attention;
  st.resumed_at = new Date().toISOString();
  run("UPDATE jobs SET status = 'running', step = ?, error = NULL, state = ?, updated_at = ? WHERE id = ?", action === 'still' ? `Still shot for part ${k + 1}` : `Trying part ${k + 1} again`, ser(st), now(), job.id);
  kick();
  return view(get('SELECT * FROM jobs WHERE id = ?', job.id));
}
// A still shot for a part (free, local): the presenter photo or the product photo, or a frame of a finished part, held for the
// part's length with a slow zoom, over that part's own voice when it has one.
async function stillPart(job, st, i, k, len, audioUrl) {
  const fs = require('node:fs'), path = require('node:path');
  return stitch.withTmpDir(async (dir) => {
    const kit = require('./editkit');
    let img = st.presenterUrl || i.image_url || null;
    let imgFile = null;
    if (img) { try { imgFile = await stitch.localFile(img, dir, job.user_id); } catch { imgFile = null; } }
    if (!imgFile) {
      const near = (st.seg || []).find((x) => x && x.url);
      if (near) { const v = await stitch.localFile(near.url, dir, job.user_id); imgFile = path.join(dir, 'frame.jpg'); await kit.exec(['-sseof', '-0.2', '-i', v, '-frames:v', '1', imgFile]); }
    }
    if (!imgFile) throw new Error('No picture to use for a still shot.');
    const out = path.join(dir, 'still.mp4');
    const args = ['-loop', '1', '-t', String(len), '-i', imgFile];
    if (audioUrl) args.push('-i', await stitch.localFile(audioUrl, dir, job.user_id));
    else args.push('-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    await kit.exec([...args, '-filter_complex', `[0:v]scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='min(1.12,1+0.0008*on)':d=1:s=720x1280:fps=30,format=yuv420p[v]`, '-map', '[v]', '-map', '1:a', '-t', String(len), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', out]);
    return media.save(fs.readFileSync(out), 'video/mp4', job.user_id).path;
  });
}

// ---------- Try again (failed jobs) ----------
// A new job with the same input that starts from everything the failed one already made (script, voice, image, finished
// parts). The customer pays only for what is redone: the price is reduced by the share of the provider cost already spent
// on the reused steps. Available for KEEP_DAYS days.
function retryJob(user, jobId) {
  const old = get("SELECT * FROM jobs WHERE id = ? AND user_id = ?", Number(jobId) || 0, user.id);
  if (!old) fail(404, 'Video not found.');
  if (old.status !== 'failed') fail(409, 'Only a failed video can be tried again.');
  if (Date.now() - new Date(String(old.updated_at).replace(' ', 'T') + (String(old.updated_at).includes('Z') ? '' : 'Z')).getTime() > KEEP_DAYS * 864e5) fail(410, 'This one is too old to resume. Make it again from Create.');
  const ost = obj(old.state), oin = obj(old.input);
  if (old.type === 'edit' || old.type === 'tool') fail(400, 'Ask for this edit again in the chat.');
  const type = oin.video_type ? 'video_type' : old.type;
  const input = { ...oin };
  for (const k of ['segments', 'clips', 'actor']) delete input[k];
  if (oin.actor) input.actor_id = String(oin.actor.id);
  const nj = create(user, type, input);
  // Carry over finished work.
  const keep = {};
  for (const [k, v] of Object.entries(ost.sub || {})) if (v && v.result) keep[k] = { tried: [], result: v.result, provider: v.provider, reused: true };
  const carry = {};
  for (const k of ['script', 'scriptObj', 'shield', 'parts', 'presenterUrl', 'lines', 'guest', 'plan', 'hooks', 'clips', 'seg', 'images', 'vis', 'shots', 'faces', 'text', 'mode', 'cta']) if (ost[k] !== undefined) carry[k] = ost[k];
  const reusedUsd = (ost.cost_log || []).filter((c) => keep[c.key]).reduce((t, c) => t + (Number(c.usd) || 0), 0);
  const row = get('SELECT * FROM jobs WHERE id = ?', nj.id), nst = obj(row.state);
  const total = Number(nst.quote && nst.quote.provider_cost_usd) || 0;
  const share = total > 0 ? Math.min(0.95, reusedUsd / total) : 0;
  let back = 0;
  if (share > 0 && nst.take) {
    const scale = (n) => Math.floor((Number(n) || 0) * share);
    const t = { trial: scale(nst.take.trial), plan: scale(nst.take.plan), topup: scale(nst.take.topup) };
    back = t.trial + t.plan + t.topup;
    if (back > 0) { credits.refund(user.id, t, 'Reused from job ' + old.id, 'job:' + nj.id); nst.take = { trial: nst.take.trial - t.trial, plan: nst.take.plan - t.plan, topup: nst.take.topup - t.topup }; }
  }
  Object.assign(nst, carry, { sub: keep, retry_of: old.id, reused_usd: Math.round(reusedUsd * 1e4) / 1e4 });
  run('UPDATE jobs SET state = ?, credits = credits - ? WHERE id = ?', ser(nst), back, nj.id);
  kick();
  return { job: view(get('SELECT * FROM jobs WHERE id = ?', nj.id)), reused_steps: Object.keys(keep).length, credits_saved: back };
}

function failJob(job, message) {
  // Atomic and idempotent: only the call that flips refunded 0 → 1 gives the credits back.
  const err = String(message).slice(0, 400), t = now();
  tx(() => {
    const flipped = run("UPDATE jobs SET status = 'failed', step = 'Failed', error = ?, refunded = 1, updated_at = ? WHERE id = ? AND refunded = 0", err, t, job.id).changes;
    if (flipped) credits.refund(job.user_id, obj(get('SELECT state FROM jobs WHERE id = ?', job.id)?.state).take, 'Refund: job failed', 'job:' + job.id);
    else run("UPDATE jobs SET status = 'failed', step = 'Failed', error = ?, updated_at = ? WHERE id = ?", err, t, job.id);
  });
  Object.assign(job, { status: 'failed', step: 'Failed', error: err, refunded: 1 });
  try { require('./email').hooks.jobFailed?.(job); } catch {}
}

let busy = false;
let timer = null;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const rows = all("SELECT * FROM jobs WHERE status IN ('queued','running') ORDER BY id ASC LIMIT 12");
    for (const job of rows) {
      const resumed = obj(job.state).resumed_at;
      const age = Date.now() - (resumed ? new Date(resumed).getTime() : new Date(job.created_at.replace(' ', 'T') + (job.created_at.includes('Z') ? '' : 'Z')).getTime());
      const maxAge = (45 + 10 * Math.max(0, (obj(job.input).segments || 1) - 1)) * 60e3; // long videos get more time
      if (age > maxAge) { failJob(job, 'This took too long, so we stopped it and returned your credits.'); continue; }
      try {
        for (let k = 0; k < 12; k++) if (!(await advance(job)) || job.status !== 'running') break; // when every provider for a step has failed, runStep throws and the job fails below
      } catch (e) {
        console.error('[jobs] failed', job.id, e.message);
        // Keep everything already made (voice, script, finished parts): a retry reuses it instead of paying again.
        if (e.state) run('UPDATE jobs SET state = ? WHERE id = ?', ser(e.state), job.id);
        const part = /^(ugc|video|part|voice|shot)(\d+)$/.exec(e.stepKey || '');
        const n = Number(obj(job.input).segments) || 1;
        if (part && n > 1 && ['ugc', 'video', 'image_to_video', 'street'].includes(job.type)) needsAttention(get('SELECT * FROM jobs WHERE id = ?', job.id), Number(part[2]), e.message);
        else failJob(get('SELECT * FROM jobs WHERE id = ?', job.id), friendly(e.message));
      }
    }
  } finally {
    busy = false;
  }
}
function kick() { setTimeout(tick, 50); }
function start() { if (!timer) timer = setInterval(tick, Number(process.env.JOB_TICK_MS) || 2500); }

module.exports = { resolveAttention, retryJob, needsAttention, friendly, KEEP_DAYS, TEMP_ERR, kick, runStep, parseJsonLoose, parseDialogue, streetParts, create, view, checkLevel, levelChain, start, tick, failJob, LANGS, VIDEO_STYLES, makeSrt, splitScript, JOB_TYPES };
