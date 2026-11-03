// House actors: our own AI actors (45 slots, content/house-actors.json), stored in the "presenters" setting so the owner can
// edit them in Admin → House actors. Each has a portrait, a short looping motion preview, a default voice for its market, and
// tags (gender, age, style, market) for the picker's filters. Every actor can speak every supported language (multilingual
// voice + lip-sync dub), so a card shows "Speaks: <native>, EN +N".
//
// Order: the originals the owner pinned ("featured" 1..n) always lead, then the rest by "order". The Recommended row puts the
// customer's own last-used actor first, then the featured actors, then picks for their market (country, language, brand).
//
// A slot without a portrait is hidden from customers. Admin → House actors makes portrait (image provider), motion (video
// provider, image-to-video) and keeps the voice in one click, or "Generate all missing" after showing the cost.
const fs = require('node:fs');
const path = require('node:path');
const { getSetting, setSetting } = require('./settings');

const MARKETS = { africa: 'Africa', latam: 'LatAm & Spain', brazil: 'Brazil & Portugal', mena: 'Middle East & N. Africa', south_asia: 'South Asia', sea: 'Southeast Asia', europe: 'Europe', north_america: 'North America & UK' };
const STYLES = { casual: 'Casual creator', professional: 'Professional', fitness: 'Fitness', beauty: 'Beauty & skincare', parent: 'Parent & home', student: 'Student', tech: 'Tech & gaming', older: 'Trusted presenter' };
const AGES = ['20s', '30s', '40s', '50s+'];
const LANG_COUNT = 24; // languages the studio can voice and lip-sync (jobs.js LANGS)
// Country → market. Nigeria also has its own two actors (tag "NG"), which lead the market picks there.
const COUNTRY_MARKET = {
  NG: 'africa', GH: 'africa', KE: 'africa', ZA: 'africa', CM: 'africa', SN: 'africa', CI: 'africa', UG: 'africa', TZ: 'africa', RW: 'africa', ET: 'africa', ZM: 'africa', ZW: 'africa', BW: 'africa',
  MX: 'latam', ES: 'latam', CO: 'latam', AR: 'latam', CL: 'latam', PE: 'latam', EC: 'latam', VE: 'latam', GT: 'latam', DO: 'latam', UY: 'latam', BO: 'latam', PY: 'latam', CR: 'latam', PA: 'latam',
  BR: 'brazil', PT: 'brazil', AO: 'brazil', MZ: 'brazil',
  AE: 'mena', SA: 'mena', EG: 'mena', JO: 'mena', MA: 'mena', DZ: 'mena', TN: 'mena', QA: 'mena', KW: 'mena', BH: 'mena', OM: 'mena', LB: 'mena', IQ: 'mena',
  IN: 'south_asia', PK: 'south_asia', BD: 'south_asia', LK: 'south_asia', NP: 'south_asia',
  ID: 'sea', VN: 'sea', TH: 'sea', PH: 'sea', MY: 'sea', SG: 'sea', KH: 'sea', MM: 'sea',
  FR: 'europe', BE: 'europe', CH: 'europe', DE: 'europe', IT: 'europe', NL: 'europe', PL: 'europe', SE: 'europe', IE: 'europe', AT: 'europe', LU: 'europe',
  US: 'north_america', CA: 'north_america', GB: 'north_america', AU: 'north_america', NZ: 'north_america',
};
const LANG_MARKET = { es: 'latam', pt: 'brazil', ar: 'mena', hi: 'south_asia', ur: 'south_asia', id: 'sea', vi: 'sea', th: 'sea', tl: 'sea', fr: 'europe', sw: 'africa', pcm: 'africa', yo: 'africa', ha: 'africa' };

let ROSTER = null;
function roster() {
  if (!ROSTER) { try { ROSTER = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'house-actors.json'), 'utf8')); } catch { ROSTER = []; } }
  return ROSTER;
}

function norm(p, i) {
  const img = String(p.img || '');
  return {
    id: String(p.id), name: String(p.name || ''), gender: p.gender === 'm' ? 'm' : 'f', age: AGES.includes(p.age) ? p.age : '30s',
    style: STYLES[p.style] ? p.style : 'casual', market: MARKETS[p.market] ? p.market : 'north_america', country: String(p.country || ''),
    lang: String(p.lang || 'en'), voice: p.voice || '', voice_id: p.voice_id || '', voice_label: p.voice_label || '',
    look: String(p.look || ''), img, image_url: img.replace(/\.png$/, '.webp'), motion: String(p.motion || ''),
    featured: Number(p.featured) > 0 ? Number(p.featured) : null, order: Number.isFinite(Number(p.order)) && p.order !== '' && p.order != null ? Number(p.order) : 100 + i,
    ready: !!img,
  };
}
// Featured first (1, 2, 3…), then by order. Stable.
function sortActors(list) {
  return list.slice().sort((a, b) => (a.featured ? a.featured : 1e6) - (b.featured ? b.featured : 1e6) || a.order - b.order);
}
function all() { return sortActors((getSetting('presenters') || []).map(norm)); }
function ready() { return all().filter((a) => a.ready); }
function byId(id) { return all().find((a) => a.id === String(id).replace(/^h:/, '')) || null; }

function speaks(a) {
  const codes = [a.lang.toUpperCase()];
  if (a.lang !== 'en') codes.push('EN');
  return { codes, more: Math.max(0, LANG_COUNT - codes.length), line: 'Speaks: ' + codes.join(', ') + ' +' + Math.max(0, LANG_COUNT - codes.length) };
}
function card(a) {
  const s = speaks(a);
  return { id: 'h:' + a.id, presenter: a.id, name: a.name, gender: a.gender, age: a.age, style: a.style, style_label: STYLES[a.style], market: a.market, market_label: MARKETS[a.market], country: a.country, image_url: a.image_url, motion_url: a.motion || null, speaks: s.codes, speaks_line: s.line, voice_label: a.voice_label || null, featured: a.featured };
}

// The customer's market: brand kit country first, then their account country, then the studio language.
function marketFor({ country, brandCountry, language } = {}) {
  const c = String(brandCountry || country || '').toUpperCase();
  return { country: c, market: COUNTRY_MARKET[c] || LANG_MARKET[language] || null };
}
// Formats that suit some styles better (a light nudge only).
const FORMAT_STYLE = { street: ['casual', 'student', 'older'], ugc: ['casual', 'beauty', 'fitness', 'parent'], hook_remix: ['casual', 'beauty'], dub: ['professional', 'older'] };

// Recommended row: last-used actor, the featured originals, then market picks to fill n.
function recommend({ lastId, country, brandCountry, language, pipe, n = 8 } = {}) {
  const list = ready();
  const out = [];
  const add = (a) => { if (a && !out.includes(a) && out.length < n) out.push(a); };
  if (lastId) add(list.find((a) => a.id === String(lastId).replace(/^h:/, '')));
  list.filter((a) => a.featured).forEach(add);
  const { country: c, market } = marketFor({ country, brandCountry, language });
  const prefer = FORMAT_STYLE[pipe] || [];
  const score = (a) => (c && a.country === c ? 4 : 0) + (market && a.market === market ? 2 : 0) + (prefer.includes(a.style) ? 1 : 0);
  list.filter((a) => !out.includes(a)).map((a, i) => ({ a, s: score(a), i })).sort((x, y) => y.s - x.s || x.i - y.i).forEach((x) => add(x.a));
  return out.map(card);
}

// ---------- Admin: generate missing actors ----------
function missing() {
  return all().filter((a) => !a.img || !a.motion || !(a.voice_id || a.voice)).map((a) => ({ id: a.id, name: a.name, needs: [!a.img && 'portrait', !a.motion && 'motion', !(a.voice_id || a.voice) && 'voice'].filter(Boolean) }));
}
function keys() {
  const providers = require('./providers');
  const img = providers.chain('image')[0], vid = providers.chain('video')[0], voice = providers.chain('voice')[0];
  const lack = [];
  if (img.adapter === 'mock') lack.push('an image model (Admin → AI providers → Images), for the portrait');
  if (vid.adapter === 'mock') lack.push('a video model that can animate a photo (Admin → AI providers → Video), for the motion preview');
  if (voice.adapter === 'mock') lack.push('an ElevenLabs key (Admin → AI providers → Voice), so the default voices can speak');
  return { img, vid, voice, lack };
}
const MOTION_SECONDS = 5;
function estimate(ids) {
  const levels = require('./levels');
  const { img, vid, lack } = keys();
  const want = (ids && ids.length ? ids.map(byId).filter(Boolean) : all()).filter((a) => !a.img || !a.motion);
  const imgCost = img.adapter === 'mock' ? 0 : levels.rowCost(img, [1]) || Number(img.cost_usd) || 0;
  const vidCost = vid.adapter === 'mock' ? 0 : levels.rowCost(vid, [MOTION_SECONDS]) || 0;
  const per = want.map((a) => ({ id: a.id, name: a.name, usd: Math.round(((a.img ? 0 : imgCost) + (a.motion ? 0 : vidCost)) * 100) / 100 }));
  return { count: per.length, usd: Math.round(per.reduce((t, x) => t + x.usd, 0) * 100) / 100, per, image_model: img.adapter === 'mock' ? null : img.name, video_model: vid.adapter === 'mock' ? null : vid.name, missing_keys: lack };
}

function status() { return getSetting('house_actor_gen') || {}; }
function setStatus(id, s) { const all_ = { ...status() }; all_[id] = { ...(all_[id] || {}), ...s, at: new Date().toISOString() }; setSetting('house_actor_gen', all_); }
function savePresenter(id, patch) {
  const list = (getSetting('presenters') || []).map((p) => (String(p.id) === String(id) ? { ...p, ...patch } : p));
  setSetting('presenters', list);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runProvider(p, kind, input, maxMs = 15 * 60e3) {
  const providers = require('./providers');
  let r = await providers.submit(p, kind, input);
  const bill = (res) => { try { require('./llmbill').recordProvider({ row: p, kind, input, result: res, feature: 'house_actor:' + kind }); } catch (e) { console.warn('[houseactors] bill', e.message); } };
  const t0 = Date.now();
  while (!r.done) {
    if (Date.now() - t0 > maxMs) throw new Error('timed out');
    await wait(Number(process.env.HOUSE_ACTOR_POLL_MS) || 4000);
    r = await providers.poll(p, r.handle);
    if (r.error) throw new Error(r.error);
  }
  bill(r.result); // an owner cost, on the AI bill like every other provider call
  return r.result;
}
const QUEUE = [];
let running = false;
async function drain() {
  if (running) return;
  running = true;
  try {
    while (QUEUE.length) {
      const id = QUEUE.shift();
      try { await generateOne(id); } catch (e) { setStatus(id, { status: 'failed', error: String(e.message).slice(0, 200) }); }
    }
  } finally { running = false; }
}
async function generateOne(id) {
  const media = require('./media');
  const a = byId(id);
  if (!a) throw new Error('No such actor');
  const { img, vid } = keys();
  const why = require('./actors').realPersonReason(a.name + ' ' + a.look);
  if (why) throw new Error(why);
  setStatus(id, { status: 'running', step: 'portrait' });
  let portrait = a.img;
  if (!portrait) {
    const r = await runProvider(img, 'image', { prompt: `Authentic UGC creator selfie photo of a fictional ${a.look}, looking at the phone camera with a friendly natural expression, head and shoulders, natural light, realistic smartphone photo, vertical, no text, an original person who does not resemble any celebrity`, size: '1080x1920', aspect: '9:16' });
    portrait = await media.mirror(r.url || (r.images && r.images[0] && r.images[0].url), null);
    savePresenter(id, { img: portrait });
  }
  if (!a.motion) {
    setStatus(id, { status: 'running', step: 'motion' });
    const abs = /^https?:/.test(portrait) ? portrait : require('./config').appUrl + portrait;
    const r = await runProvider(vid, 'video', { image_url: abs, prompt: `The ${a.gender === 'm' ? 'man' : 'woman'} looks into the phone camera, smiles and talks naturally with small head movements and a light hand gesture, handheld selfie feel, subtle natural motion, steady framing, no text`, duration: MOTION_SECONDS, aspect: '9:16' });
    const motion = await media.mirror(r.url, null);
    savePresenter(id, { motion });
  }
  setStatus(id, { status: 'done', step: null, error: null });
}
// Queue one or more actors. Refuses (with the list of what is missing) when the keys are not set.
function generate(ids) {
  const { lack } = keys();
  const list = (ids && ids.length ? ids : missing().filter((m) => m.needs.includes('portrait') || m.needs.includes('motion')).map((m) => m.id)).filter((id) => byId(id));
  if (lack.length && lack.some((x) => !/ElevenLabs/.test(x))) {
    const err = new Error('Generating house actors needs ' + lack.join('; ') + '.');
    err.status = 409; err.missing_keys = lack; throw err;
  }
  for (const id of list) if (!QUEUE.includes(id)) { QUEUE.push(id); setStatus(id, { status: 'queued', error: null }); }
  drain();
  return { queued: list.length };
}

module.exports = { MARKETS, STYLES, AGES, COUNTRY_MARKET, roster, all, ready, byId, sortActors, card, speaks, marketFor, recommend, missing, keys, estimate, status, generate, savePresenter };
