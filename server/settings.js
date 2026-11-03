// Key/value settings stored in the database (pricing, site toggles). Admin edits these; code reads them through here.
const fs = require('node:fs');
const path = require('node:path');
const { get, run, J } = require('./db');

const DEFAULT_PRICING = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'pricing.json'), 'utf8'));

const DEFAULTS = {
  pricing: DEFAULT_PRICING,
  site: {
    announcement: 'New: UGC videos in 20+ languages. Start with free credits.',
    signups_open: true,
    maintenance: false,
    support_chat: true,
  },
  referral: { tiers: [{ min: 1, pct: 10 }, { min: 5, pct: 20 }, { min: 20, pct: 30 }], settle_days: 30, min_withdraw_usd: 300 },
  // House actors (content/house-actors.json): 45 slots, the five originals pinned first. See server/houseactors.js.
  presenters: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'house-actors.json'), 'utf8')),
  voices: {
    // ElevenLabs voice IDs. Replace with voices from your ElevenLabs Voice Library.
    female_warm: '21m00Tcm4TlvDq8ikWAM',
    female_energetic: 'EXAVITQu4vr4xnSDxMaL',
    male_calm: 'TxGEqnHWrfWFTfGW9XjX',
    male_mature: 'VR6AewLTigWG4xSOukaG',
    // Coach Vee, the training narrator: "Liz - authentic, engaging narrator" from the ElevenLabs library.
    coach: 'mNL951wnwlF16e6sXtTh',
  },
};

// Abuse limits (SPEC §4). 0 turns a limit off.
DEFAULTS.limits = { trial_max_jobs_per_day: 10, max_concurrent_jobs: 3, daily_credit_cap: 0, max_signups_per_ip_per_day: 3, max_trials_per_ip_per_30d: 3, upload_quota_mb: 2000, upload_keep_days: 7 };
DEFAULTS.training_audio = {};
// SPEC §12: brand pronunciations for every voiceover, and the admin-uploaded music library ([{id, url, mood, name, created_at}]).
DEFAULTS.pronunciations = [
  { word: 'Vooads', say: 'Voo-ads' }, { word: 'VooSquare', say: 'Voo-square' }, { word: 'Zedapex', say: 'Zed-a-pex' }, { word: 'Joinvoo', say: 'Join-voo' },
  { word: 'Replyvoo', say: 'Reply-voo' }, { word: 'Castvoo', say: 'Cast-voo' }, { word: 'Gatevoo', say: 'Gate-voo' }, { word: 'Affleego', say: 'Af-lee-go' },
];
DEFAULTS.music_library = [];
// AI (LLM) bill: what every text call really costs us, the free allowance for chat editing, rate limits and the daily cap on
// LLM spend for steps the customer does not pay for directly (server/llmbill.js). Prices are USD per million tokens, matched
// by the start of the model id (longest match wins); "default" covers unknown models and is set high on purpose.
DEFAULTS.llm = {
  prices_usd_per_mtok: {
    'claude-sonnet-5': { in: 2, out: 10 }, 'claude-sonnet-4': { in: 3, out: 15 }, 'claude-haiku-5': { in: 0.5, out: 2.5 }, 'claude-haiku-4': { in: 1, out: 5 },
    'claude-opus-5-5': { in: 4, out: 20 }, 'claude-opus-5': { in: 5, out: 25 }, 'claude-opus-4-1': { in: 15, out: 75 }, 'claude-opus-4-0': { in: 15, out: 75 }, 'claude-opus-4': { in: 5, out: 25 },
    'gpt-': { in: 5, out: 20 }, default: { in: 15, out: 75 },
  },
  chat_edit: { free_per_day: { free: 2, starter: 5, pro: 15, scale: 40, agency: 90 }, credits_per_message: 2, per_minute: 6, per_day: 200, max_tokens: 900 },
  free_steps: { per_minute: 10, per_day: 300 },
  daily_cap_usd: 25,
  alert_pct: 80,
  block_free_at_cap: true,
};

// New keys added to content/pricing.json (e.g. video_types, min_margin_pct) flow into a saved pricing setting
// without touching what the admin changed: only missing keys and missing video types (by id) are added.
// To retire a video type, set "enabled": false instead of deleting it (deleted ids come back from the file).
const RENAMES = { mad_edit: { from: 'Mad edit' } };
function mergePricing(saved) {
  if (!saved || typeof saved !== 'object') return DEFAULT_PRICING;
  const out = { ...saved };
  for (const [k, v] of Object.entries(DEFAULT_PRICING)) {
    if (out[k] === undefined) out[k] = v;
    else if (['costs', 'provider_cost_usd', 'free_trial', 'addons', 'voice_tiers'].includes(k) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...v, ...out[k] };
  }
  if (Array.isArray(DEFAULT_PRICING.video_types)) {
    const have = Array.isArray(out.video_types) ? out.video_types : [];
    const ids = new Set(have.map((t) => t && t.id));
    // Quality levels (SPEC §13) reach saved types that never had them. A type saved with "levels": [] keeps none.
    const withLevels = have.map((t) => {
      const def = t && t.levels === undefined && DEFAULT_PRICING.video_types.find((d) => d && d.id === t.id && Array.isArray(d.levels));
      return def ? { ...t, levels: JSON.parse(JSON.stringify(def.levels)) } : t;
    });
    // Display renames: a saved type still carrying an old default name gets the new name and subtitle (ids never change).
    const renamed = withLevels.map((t) => {
      const r = t && RENAMES[t.id];
      if (!r || t.name !== r.from) return t;
      const def = DEFAULT_PRICING.video_types.find((d) => d && d.id === t.id) || {};
      return { ...t, name: def.name || t.name, description: def.description || t.description };
    });
    out.video_types = [...renamed, ...DEFAULT_PRICING.video_types.filter((t) => t && !ids.has(t.id))];
  }
  return out;
}
// New house-actor slots (by id) and new tag fields reach a saved presenters list; what the owner changed is kept.
function mergePresenters(saved) {
  if (!Array.isArray(saved)) return DEFAULTS.presenters;
  const ids = new Set(saved.map((p) => p && String(p.id)));
  const merged = saved.map((p) => { const d = DEFAULTS.presenters.find((x) => String(x.id) === String(p && p.id)); return d ? { ...d, ...p } : p; });
  return [...merged, ...DEFAULTS.presenters.filter((d) => !ids.has(String(d.id)))];
}
const withDefaults = (key, val) => (key === 'presenters' ? mergePresenters(val) : key === 'pricing' ? mergePricing(val) : key === 'limits' ? { ...DEFAULTS.limits, ...(val || {}) } : key === 'voices' ? { ...DEFAULTS.voices, ...(val || {}) } : key === 'llm' ? mergeLlm(val) : val);
function mergeLlm(v) {
  const d = DEFAULTS.llm, o = v && typeof v === 'object' ? v : {};
  return { ...d, ...o, prices_usd_per_mtok: { ...d.prices_usd_per_mtok, ...(o.prices_usd_per_mtok || {}) }, chat_edit: { ...d.chat_edit, ...(o.chat_edit || {}), free_per_day: { ...d.chat_edit.free_per_day, ...((o.chat_edit || {}).free_per_day || {}) } }, free_steps: { ...d.free_steps, ...(o.free_steps || {}) } };
};

const cache = new Map();
function getSetting(key) {
  if (cache.has(key)) return cache.get(key);
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  const val = withDefaults(key, row ? J(row.value, DEFAULTS[key]) : DEFAULTS[key]);
  cache.set(key, val);
  return val;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key, value, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP', key, JSON.stringify(value));
  cache.set(key, withDefaults(key, value));
}

const pricing = () => getSetting('pricing');
const planById = (id) => pricing().plans.find((p) => p.id === id);

module.exports = { getSetting, setSetting, pricing, planById, DEFAULTS, mergePricing };
