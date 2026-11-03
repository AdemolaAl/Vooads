// Website showcase: "Make showcase pack" (owners only) and Admin → Website → Showcase.
//
// The pack makes one video per ad style and business type through Vooads' OWN pipeline (jobs.js, the same providers,
// levels and ffmpeg steps customers use), on a house account. The house account is given exactly the credits each job
// costs, labelled in the ledger, so no customer is charged and the real provider cost is what the company pays. The
// estimated provider cost is shown before anything runs and the run needs an explicit confirmation.
// The owner then picks which finished videos go on the website. Only videos made by this pipeline are listed here, so
// only these can carry the "Made with Vooads" note on the site (the public API marks them made_with_vooads: true).
const config = require('./config');
const { get, all, run } = require('./db');
const { fail } = require('./lib/http');
const { getSetting, setSetting } = require('./settings');

const HOUSE_EMAIL = 'showcase@house.vooads.invalid';
const KEY = 'showcase';

// One per ad style and business type. Inputs go through jobs.create exactly like a customer's.
const PRESETS = [
  { id: 'ugc_skincare', title: 'UGC skincare', style: 'UGC talking', audience: 'business',
    input: { video_type: 'ugc_talking', level: 'pro', duration: 10, presenter: 'p1', product: 'vitamin C face serum', language: 'en',
      script: 'Okay, I did not expect this. Two weeks with this vitamin C serum and my skin looks brighter in the morning. It sinks in fast, no sticky feel. If your skin looks tired, try it.' } },
  { id: 'cafe_promo', title: 'Café promo', style: 'Business promo', audience: 'business',
    input: { video_type: 'product_broll', level: 'pro', duration: 5, style: 'lifestyle', product: 'neighborhood café: a fresh latte with heart latte art', details: 'A friendly barista slides the latte across a wooden counter toward the camera, bright cozy café, morning sunlight, pastries behind.' } },
  { id: 'street_interview', title: 'Street interview', style: 'Street interview', audience: 'buyer',
    input: { video_type: 'ugc_talking', level: 'ultra', duration: 8, product: 'meal prep delivery service', language: 'en',
      presenter_desc: 'cheerful young woman with dark wavy hair in a denim jacket on a sunny city sidewalk, an interviewer holds a small handheld microphone toward her',
      script: 'Honestly? I stopped cooking on weekdays. The meals show up, they taste homemade, and I save like two hours a day.' } },
  { id: 'fast_cut_product', title: 'Fast-cut product ad', style: 'Product b-roll', audience: 'both',
    input: { video_type: 'product_broll', level: 'pro', duration: 5, style: 'product', product: 'matte wireless over-ear headphones with no logo', details: 'Fast dolly-in, crisp studio light with a soft blue rim light, a hand lifts them toward the camera.' } },
  { id: 'app_ad', title: 'App ad', style: 'UGC talking', audience: 'buyer',
    input: { video_type: 'ugc_talking', level: 'standard', duration: 10, presenter: 'p4', product: 'budget planner app', language: 'en',
      script: 'I used to have no idea where my money went. This app sorts every payment for me, and now I actually save every month. It takes two minutes to set up.' } },
  { id: 'podcast_clip', title: 'Podcast clip', style: 'Podcast clip', audience: 'both',
    input: { video_type: 'ugc_podcast', level: 'standard', duration: 10, presenter: 'p3', product: 'online fitness coaching', language: 'en',
      script: 'Here is what nobody tells you about getting fit. You do not need two hours a day. You need twenty minutes, done every day, with someone keeping you honest.' } },
  { id: 'real_estate', title: 'Real estate tour', style: 'Property tour', audience: 'business',
    input: { video_type: 'product_broll', level: 'pro', duration: 5, style: 'lifestyle', product: 'bright modern three-bedroom home for sale', details: 'Smooth gimbal walkthrough from the entryway into an open living room with large windows and light oak floors, afternoon sun, no people.' } },
];

function houseUser() {
  let u = get('SELECT * FROM users WHERE email = ?', HOUSE_EMAIL);
  const far = '2099-12-31T00:00:00.000Z';
  if (!u) {
    run("INSERT INTO users(email, name, ref_code, plan_id, plan_period, plan_expires_at, plan_credits, trial_credits, marketing_opt_in, flags) VALUES(?, 'Vooads showcase (house account)', ?, 'agency', 'year', ?, 0, 0, 0, ?)",
      HOUSE_EMAIL, require('./auth').uniqueRefCode(), far, JSON.stringify({ house: 1 }));
    u = get('SELECT * FROM users WHERE email = ?', HOUSE_EMAIL);
  } else if (u.plan_id !== 'agency' || u.plan_expires_at < far) {
    run("UPDATE users SET plan_id = 'agency', plan_expires_at = ?, status = 'active' WHERE id = ?", far, u.id);
    u = get('SELECT * FROM users WHERE id = ?', u.id);
  }
  return u;
}

function state() { return { jobs: [], selected: [], ...(getSetting(KEY) || {}) }; }

// Price of each preset on the house account: credits (what a customer would pay) and the real provider cost.
function estimate() {
  const credits = require('./credits');
  const u = houseUser();
  const rows = PRESETS.map((p) => {
    try {
      const q = credits.quoteFull('video_type', { ...p.input }, u);
      return { id: p.id, title: p.title, style: p.style, credits: q.credits, provider_cost_usd: Math.round((Number(q.provider_cost_usd) || 0) * 100) / 100, demo: false };
    } catch (e) { return { id: p.id, title: p.title, style: p.style, error: e.message }; }
  });
  const providers = require('./providers');
  const demo = providers.isDemo('ugc') || providers.isDemo('video');
  return { presets: rows, total_usd: Math.round(rows.reduce((s, r) => s + (r.provider_cost_usd || 0), 0) * 100) / 100, demo, note: demo ? 'Some AI providers have no key yet, so the pack would come out as demo samples. Add the fal and ElevenLabs keys first.' : 'Charged by your AI providers to your own accounts. No customer credits are used.' };
}

// Runs the pack (or some presets). confirm must be true: the owner saw the estimate first.
function makePack(staff, { confirm, only } = {}) {
  if (confirm !== true) fail(400, 'Check the estimated cost, then confirm to make the showcase pack.');
  const providers = require('./providers');
  if (providers.isDemo('ugc') || providers.isDemo('video')) fail(400, 'Add the fal and ElevenLabs keys first. Without them the pack would only contain demo samples.');
  const jobs = require('./jobs');
  const credits = require('./credits');
  const list = PRESETS.filter((p) => !Array.isArray(only) || !only.length || only.includes(p.id));
  const s = state();
  const made = [], errors = [];
  for (const p of list) {
    const u = houseUser();
    try {
      const q = credits.quoteFull('video_type', { ...p.input }, u);
      // Exactly what this job costs, so the house account never holds spare credits.
      credits.grant(u.id, q.credits, 'topup', 'Showcase pack: ' + p.title + ' (house account, no customer charged)', 'showcase:' + p.id, staff?.id || null);
      const job = jobs.create(get('SELECT * FROM users WHERE id = ?', u.id), 'video_type', { ...p.input });
      s.jobs = [{ preset: p.id, title: p.title, style: p.style, audience: p.audience, job_id: job.id, at: new Date().toISOString() }, ...s.jobs.filter((x) => x.job_id !== job.id)].slice(0, 60);
      made.push({ preset: p.id, job_id: job.id, credits: q.credits });
    } catch (e) {
      // Give back the grant if the job could not be created.
      const u2 = get('SELECT * FROM users WHERE id = ?', u.id);
      if (u2.topup_credits > 0) credits.grant(u.id, -u2.topup_credits, 'topup', 'Showcase pack: unused credits removed', 'showcase:' + p.id, staff?.id || null);
      errors.push({ preset: p.id, error: e.message });
    }
  }
  setSetting(KEY, s);
  return { made, errors, ...list_() };
}

// Every pack video with its status, for Admin → Website → Showcase.
function list_() {
  const s = state();
  const items = s.jobs.map((x) => {
    const j = get('SELECT id, status, step, output, error, demo FROM jobs WHERE id = ?', x.job_id);
    let out = null; try { out = j && j.output ? JSON.parse(j.output) : null; } catch {}
    return { ...x, status: j ? j.status : 'missing', step: j?.step || '', error: j?.error || null, demo: !!j?.demo, url: out?.url || null, selected: s.selected.includes(x.job_id) };
  });
  return { items, selected: s.selected, house_email: HOUSE_EMAIL };
}

function select(ids) {
  if (!Array.isArray(ids)) fail(400, 'Send the list of videos to show.');
  const s = state();
  const ok = new Set(s.jobs.map((x) => x.job_id));
  const pick = [...new Set(ids.map(Number))].filter((id) => ok.has(id)).slice(0, 24);
  for (const id of pick) {
    const j = get("SELECT status, demo FROM jobs WHERE id = ?", id);
    if (!j || j.status !== 'done') fail(400, 'Only finished videos can go on the website.');
    if (j.demo) fail(400, 'Demo samples cannot go on the website as "Made with Vooads".');
  }
  s.selected = pick;
  setSetting(KEY, s);
  return list_();
}

// What the public website shows: selected, finished, real (not demo) pack videos. Empty → the site uses its examples.
function publicList() {
  const { items } = list_();
  return items.filter((x) => x.selected && x.status === 'done' && !x.demo && x.url).map((x) => ({
    id: x.job_id, title: x.title, style: x.style, audience: x.audience, url: x.url.startsWith('/') ? x.url : x.url, made_with_vooads: true,
  }));
}

module.exports = { PRESETS, HOUSE_EMAIL, houseUser, estimate, makePack, list: list_, select, publicList, appUrl: () => config.appUrl };
