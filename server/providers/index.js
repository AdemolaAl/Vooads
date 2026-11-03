// AI provider registry. The admin picks which provider does each job (text, image, video, ugc, voice).
// Add a new provider type by creating a file in this folder that exports { submit, poll? } and listing it in ADAPTERS.
const { all, get, J } = require('../db');
const { decrypt } = require('../lib/util');

const ADAPTERS = {
  anthropic: require('./anthropic'),
  openai: require('./openai'),
  fal: require('./fal'),
  elevenlabs: require('./elevenlabs'),
  http: require('./http'),
  mock: require('./mock'),
  pexels: require('./stock').pexels,
  pixabay: require('./stock').pixabay,
  elevenlabs_music: require('./music').elevenlabs_music,
  library: require('./music').library,
  replicate: require('./replicate'),
};
// Adapters that work without an API key.
const KEYLESS = ['mock', 'http', 'library'];

// What each adapter can do, shown in the admin when adding a provider.
const CAPABILITIES = {
  anthropic: ['text'],
  openai: ['text'],
  fal: ['image', 'video', 'ugc', 'dub', 'music', 'matting', 'stt'],
  elevenlabs: ['voice', 'stt'],
  http: ['text', 'image', 'video', 'ugc', 'voice', 'dub', 'music', 'stock', 'matting', 'stt', 'autoedit'],
  mock: ['text', 'image', 'video', 'ugc', 'voice', 'dub', 'music', 'stock', 'matting', 'stt'],
  pexels: ['stock'],
  pixabay: ['stock'],
  elevenlabs_music: ['music'],
  library: ['music'],
  replicate: ['text', 'image', 'video', 'ugc', 'voice', 'dub', 'music'],
};

const KINDS = {
  text: 'Scripts, hooks, ad copy and Ban Shield checks',
  image: 'Ad images and presenter photos',
  video: 'Product, b-roll and motion videos',
  ugc: 'Talking presenter (UGC) videos from a photo and a voice track',
  voice: 'Voiceovers',
  dub: 'Lip-sync an existing video to a new voice track (dubbing)',
  music: 'Background music under the voiceover (AI music or your uploaded library)',
  stock: 'Free stock footage for animated ads and video backgrounds (Pexels, Pixabay)',
  matting: 'Video background removal for "Change background" (cuts the person out of the customer\'s video)',
  stt: 'Speech-to-text with word timings for "Auto-edit my video" (cuts, captions)',
  autoedit: 'Optional outside auto-edit service that replaces the built-in auto-edit pipeline (off by default)',
};

function hydrate(row) {
  return row && { ...row, config: J(row.config, {}), apiKey: decrypt(row.api_key_enc) };
}

// One fal.ai key runs every fal model: a fal row without its own key uses the key saved on another fal row.
const SHARED_KEY = ['fal'];
function sharedKey(adapter) {
  if (!SHARED_KEY.includes(adapter)) return '';
  for (const r of all("SELECT api_key_enc FROM providers WHERE adapter = ? AND api_key_enc IS NOT NULL AND api_key_enc != '' ORDER BY enabled DESC, id ASC", adapter)) {
    const k = decrypt(r.api_key_enc);
    if (k) return k;
  }
  return '';
}

// Providers for a job, best first. Falls back to the demo provider so the app always works.
function chain(kind) {
  const keys = {};
  const rows = all('SELECT * FROM providers WHERE kind = ? AND enabled = 1 ORDER BY is_default DESC, priority ASC, id ASC', kind)
    .map(hydrate)
    .map((p) => (p.apiKey || !SHARED_KEY.includes(p.adapter) ? p : { ...p, apiKey: keys[p.adapter] ?? (keys[p.adapter] = sharedKey(p.adapter)), keyShared: true }))
    .filter((p) => KEYLESS.includes(p.adapter) || p.apiKey);
  return rows.length ? rows : [{ id: 0, name: 'Demo', kind, adapter: 'mock', config: {}, apiKey: '', model: 'demo' }];
}
const isDemo = (kind) => chain(kind)[0].adapter === 'mock';

async function submit(provider, kind, input) {
  const a = ADAPTERS[provider.adapter];
  if (!a) throw new Error('Unknown adapter ' + provider.adapter);
  return a.submit(provider, kind, input);
}
async function poll(provider, handle) {
  const a = ADAPTERS[provider.adapter];
  if (!a.poll) return { done: true, result: handle };
  return a.poll(provider, handle);
}
const byId = (id) => {
  if (!id) return chain('text').find((p) => p.adapter === 'mock');
  const p = hydrate(get('SELECT * FROM providers WHERE id = ?', id));
  return p && !p.apiKey && SHARED_KEY.includes(p.adapter) ? { ...p, apiKey: sharedKey(p.adapter), keyShared: true } : p;
};

// Quick connection test from the admin.
async function test(provider) {
  const a = ADAPTERS[provider.adapter];
  if (!a.test) return { ok: true, note: 'No test available for this type. Run a real job to check it.' };
  return a.test(provider);
}

module.exports = { ADAPTERS, CAPABILITIES, KINDS, KEYLESS, SHARED_KEY, sharedKey, chain, isDemo, submit, poll, byId, hydrate, test };
