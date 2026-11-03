// Background music (provider kind 'music').
//   elevenlabs_music: ElevenLabs Music API, POST https://api.elevenlabs.io/v1/music (xi-api-key). Model in "model" (music_v1 default).
//                     Billed per minute of audio; instrumental only so it never fights the voiceover.
//   library:          a random track of the chosen mood from the music the admin uploaded (Admin → Music library). No key, no cost.
// fal music models go through the fal adapter (kind 'music', model = the fal model id, config.extra for model-specific fields).
const { req } = require('./net');
const media = require('../media');
const { getSetting } = require('../settings');

const MOOD_PROMPTS = {
  upbeat: 'upbeat, positive, modern pop groove, bright synths, light percussion',
  chill: 'chill lo-fi, relaxed beat, warm keys',
  cinematic: 'cinematic, building strings and soft percussion, inspiring',
  corporate: 'clean corporate background, light piano and plucks, optimistic',
  hiphop: 'modern hip-hop beat, punchy drums, confident',
  emotional: 'emotional, soft piano and ambient pads, heartfelt',
};
const promptFor = (input) => input.prompt || `${MOOD_PROMPTS[input.mood] || MOOD_PROMPTS.upbeat}. Instrumental background music for a ${Math.round(input.seconds || 30)} second video ad, no vocals, steady energy, mix leaves room for a voiceover.`;

const elevenlabs_music = {
  async submit(p, kind, input) {
    const ms = Math.max(3000, Math.min(600000, Math.round((Number(input.seconds) || 30) * 1000)));
    const buf = await req('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': p.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ prompt: promptFor(input), music_length_ms: ms, model_id: p.model || 'music_v1', force_instrumental: !input.vocals, ...(p.config.extra || {}) }),
      raw: true,
      timeout: 240000,
    });
    const m = media.save(buf, 'audio/mpeg', input.user_id);
    return { done: true, result: { url: m.publicUrl, media_id: m.id, mood: input.mood, source: 'elevenlabs' } };
  },
  async test(p) {
    try { await req('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': p.apiKey }, timeout: 20000 }); return { ok: true, note: 'Key accepted.' }; }
    catch (e) { return { ok: false, note: e.message.slice(0, 120) }; }
  },
};

// Tracks the admin uploaded: settings music_library = [{id, url, mood, name}]
function pickTrack(mood) {
  const lib = (getSetting('music_library') || []).filter((t) => t && t.url);
  const same = lib.filter((t) => t.mood === mood);
  const pool = same.length ? same : lib;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
const library = {
  async submit(p, kind, input) {
    const t = pickTrack(input.mood);
    if (!t) throw new Error('The music library is empty. Upload tracks in Admin → Music library.');
    return { done: true, result: { url: t.url, mood: t.mood, name: t.name, source: 'library' } };
  },
  async test() {
    const n = (getSetting('music_library') || []).length;
    return { ok: n > 0, note: n ? `${n} tracks in the library.` : 'No tracks yet. Upload some in Admin → Music library.' };
  },
};

module.exports = { elevenlabs_music, library, pickTrack, promptFor, MOOD_PROMPTS };
