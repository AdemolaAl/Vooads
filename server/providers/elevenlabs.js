// ElevenLabs voices. Get a key at https://elevenlabs.io/app/settings/api-keys
// Model: eleven_flash_v2_5 (cheap, fast) or eleven_multilingual_v2 (best quality). Voice IDs are set in Admin → Settings → Voices.
const { req } = require('./net');
const media = require('../media');

// Speech-to-text (Scribe): word timings for Auto-edit. Sends the local audio file when the job has one, else a link.
// POST https://api.elevenlabs.io/v1/speech-to-text (multipart): model_id scribe_v1, timestamps_granularity word.
async function transcribe(p, input) {
  const fs = require('node:fs');
  const form = new FormData();
  form.append('model_id', p.config.stt_model || (/^scribe/.test(p.model || '') ? p.model : 'scribe_v1'));
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  if (input.language) form.append('language_code', String(input.language).slice(0, 5));
  if (input.audio_path && fs.existsSync(input.audio_path)) form.append('file', new Blob([fs.readFileSync(input.audio_path)], { type: 'audio/mpeg' }), 'audio.mp3');
  else form.append('cloud_storage_url', String(input.audio_url || ''));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 300000);
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': p.apiKey }, body: form, signal: ctrl.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${r.status} ${data?.detail?.message || data?.detail || 'speech-to-text failed'}`.slice(0, 300));
    const words = (data.words || []).filter((w) => w.type === 'word' || !w.type).map((w) => ({ text: String(w.text || '').trim(), start: Number(w.start), end: Number(w.end) }));
    return { done: true, result: { words, text: String(data.text || ''), language: data.language_code || null } };
  } finally { clearTimeout(t); }
}

async function submit(p, kind, input) {
  if (kind === 'stt') return transcribe(p, input);
  const voice = input.voice_id || p.config.default_voice || '21m00Tcm4TlvDq8ikWAM';
  const buf = await req(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': p.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: input.text, model_id: p.model || 'eleven_flash_v2_5', voice_settings: { stability: 0.45, similarity_boost: 0.8 } }),
    raw: true,
    timeout: 120000,
  });
  const m = media.save(buf, 'audio/mpeg', input.user_id);
  return { done: true, result: { url: m.publicUrl, media_id: m.id } };
}

async function test(p) {
  try {
    await req('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': p.apiKey }, timeout: 20000 });
    return { ok: true, note: 'Key accepted.' };
  } catch (e) {
    return { ok: false, note: e.message.slice(0, 120) };
  }
}

module.exports = { submit, test };
