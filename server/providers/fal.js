// fal.ai: one key runs hundreds of image and video models. Get a key at https://fal.ai/dashboard/keys
// The model is the fal model id, for example:
//   image: fal-ai/bytedance/seedream/v4/text-to-image
//   video: fal-ai/kling-video/v2.5-turbo/pro/text-to-video   (config.image_model for photo-to-video: fal-ai/kling-video/v2.5-turbo/pro/image-to-video)
//   ugc:   fal-ai/kling-video/ai-avatar/v2/pro                 (takes image_url + audio_url)
//          fal-ai/bytedance/omnihuman/v1.5                     (Pro realistic level: image_url + audio_url)
//          fal-ai/veo3.1/image-to-video with config.input = 'dialogue' (Ultra level: the presenter photo is the first frame and
//          Veo speaks the line itself, generate_audio true; 8s max per clip, parts are stitched)
// Quality levels (SPEC §13) read config.level / config.tag. config.clip_durations (e.g. [4, 6, 8]) snaps every clip up to a
// length the model accepts, config.duration_suffix ('s') sends "8s" instead of "8" (Veo).
//   dub:   a lip-sync model such as fal-ai/sync-lipsync/v2       (takes video_url + audio_url)
//   music: any fal text-to-music model id (prompt + duration in seconds; add model fields in config.extra, output in config.output_path)
// Check each model's page on fal.ai for its exact input fields; put any extras in config.extra (JSON) and change config.output_path if the result field differs.
const { req, pick } = require('./net');

const auth = (p) => ({ Authorization: 'Key ' + p.apiKey });

// Clip length the model accepts: the next allowed duration up (Veo 4/6/8s, Kling 2.5 5/10s), sent as "8s" when the model wants it.
function duration(p, sec) {
  const a = Array.isArray(p.config.clip_durations) ? p.config.clip_durations.map(Number).filter((x) => x > 0).sort((x, y) => x - y) : null;
  let d = Math.max(1, Math.round(Number(sec) || 5));
  if (a && a.length) d = a.find((x) => x >= d) ?? a[a.length - 1];
  return String(d) + (p.config.duration_suffix || '');
}

function buildInput(p, kind, input) {
  const extra = p.config.extra || {};
  if (kind === 'image') {
    const [w, h] = (input.size || '1080x1350').split('x').map(Number);
    return { prompt: input.prompt, image_size: { width: w, height: h }, num_images: 1, ...extra };
  }
  if (kind === 'video') {
    const body = { prompt: input.prompt, duration: duration(p, input.duration || 5), aspect_ratio: input.aspect || '9:16', ...extra };
    if (input.image_url) body.image_url = input.image_url;
    return body;
  }
  if (kind === 'music') {
    // ElevenLabs Music on fal (fal-ai/elevenlabs/music) takes the length in ms and an instrumental switch; other music models take seconds.
    if (p.config.input === 'elevenlabs') return { prompt: require('./music').promptFor(input), music_length_ms: Math.max(3000, Math.min(600000, Math.round((Number(input.seconds) || 30) * 1000))), force_instrumental: !input.vocals, ...extra };
    return { prompt: require('./music').promptFor(input), duration: Math.round(Number(input.seconds) || 30), ...extra };
  }
  // VEED video background removal (veed/video-background-removal/fast): VP9 with alpha by default, or "h264" for two files
  // (colour + alpha matte). Edge refinement is on: it is what the guard prices ($0.012 per 30 frames).
  if (kind === 'matting') return { video_url: input.video_url, output_codec: p.config.codec === 'h264' ? 'h264' : 'vp9', refine_foreground_edges: p.config.refine !== false, subject_is_person: input.subject_is_person !== false, ...extra };
  // Whisper on fal: word-level chunks for cut lists and captions.
  if (kind === 'stt') return { audio_url: input.audio_url, task: 'transcribe', chunk_level: 'word', ...(input.language ? { language: input.language } : {}), ...extra };
  if (kind === 'dub') return { video_url: input.video_url, audio_url: input.audio_url, ...extra };
  // Video models that speak the line themselves (Veo 3.1): the presenter photo is the first frame, the script goes in the prompt.
  if (kind === 'ugc' && p.config.input === 'dialogue') {
    const say = String(input.text || '').replace(/"/g, "'").trim();
    return { prompt: `${input.prompt || 'Natural, friendly UGC creator talking to the phone camera'}. Handheld vertical smartphone video, natural light, realistic skin and lip movement. The person looks into the camera and says${say ? `: "${say}"` : ' a short friendly line'}. No subtitles, no music.`, image_url: input.image_url, duration: duration(p, input.duration || 8), aspect_ratio: input.aspect || '9:16', ...extra };
  }
  if (kind === 'ugc') return { image_url: input.image_url, audio_url: input.audio_url, prompt: input.prompt || 'Natural, friendly talking presenter, subtle head movement', ...extra };
  return { prompt: input.prompt, ...extra };
}

async function submit(p, kind, input) {
  const model = kind === 'video' && input.image_url && p.config.image_model ? p.config.image_model : p.model;
  if (!model) throw new Error('No fal model id set for this provider.');
  const data = await req('https://queue.fal.run/' + model, { method: 'POST', headers: auth(p), body: buildInput(p, kind, input), timeout: 60000 });
  return { done: false, handle: { status_url: data.status_url, response_url: data.response_url, request_id: data.request_id, kind } };
}

// Some fal endpoints return what the request cost (cost, cost_usd, billing.cost, usage.cost). When they do, the cost
// watchdog uses it instead of our price table.
function reportedCost(out) {
  const c = [out && out.cost_usd, out && out.cost, out && out.billing && out.billing.cost, out && out.usage && (out.usage.cost_usd ?? out.usage.cost)].map(Number).find((x) => Number.isFinite(x) && x >= 0);
  return c !== undefined ? { cost_usd: c } : {};
}
async function poll(p, h) {
  const st = await req(h.status_url, { headers: auth(p), timeout: 30000 });
  if (st.status === 'IN_QUEUE' || st.status === 'IN_PROGRESS') return { done: false, progress: st.status === 'IN_PROGRESS' ? 0.6 : 0.2 };
  const out = await req(h.response_url, { headers: auth(p), timeout: 60000 });
  if (h.kind === 'stt') return { done: true, result: sttResult(out) };
  if (h.kind === 'matting') {
    const files = Array.isArray(out.video) ? out.video : out.video ? [out.video] : [];
    const url = pick(out, p.config.output_path || '') || files[0]?.url;
    if (!url) return { done: true, error: 'Background removal finished but returned no video.' };
    return { done: true, result: { url, mask_url: files[1]?.url || null, codec: files.length > 1 ? 'h264' : 'vp9' } };
  }
  const path = p.config.output_path || (h.kind === 'image' ? 'images.0.url' : h.kind === 'music' ? 'audio.url' : 'video.url');
  const url = pick(out, path) || pick(out, 'video.url') || pick(out, 'images.0.url') || pick(out, 'image.url') || pick(out, 'audio.url') || pick(out, 'audio_file.url') || pick(out, 'audio_url');
  if (!url) return { done: true, error: 'The model finished but returned no file. Check the output path in the provider settings.' };
  return { done: true, result: { url, ...reportedCost(out) } };
}

// Whisper chunks ({timestamp: [start, end], text}) → {words: [{text, start, end}], text, language}.
function sttResult(out) {
  const chunks = Array.isArray(out.chunks) ? out.chunks : [];
  const words = chunks.map((c) => ({ text: String(c.text || '').trim(), start: Number(c.timestamp?.[0]), end: Number(c.timestamp?.[1] ?? c.timestamp?.[0]) })).filter((w) => w.text && Number.isFinite(w.start));
  return { words, text: String(out.text || ''), language: Array.isArray(out.inferred_languages) ? out.inferred_languages[0] : out.language || null };
}

async function test(p) {
  // A key check that costs nothing: ask for the status of a request that does not exist.
  try {
    await req('https://queue.fal.run/' + (p.model || 'fal-ai/flux/schnell') + '/requests/00000000-0000-0000-0000-000000000000/status', { headers: auth(p), timeout: 20000 });
    return { ok: true, note: 'Key accepted.' };
  } catch (e) {
    if (e.status === 401 || e.status === 403) return { ok: false, note: 'fal rejected the key.' };
    return { ok: true, note: 'Key accepted (fal answered: ' + e.message.slice(0, 80) + ').' };
  }
}

module.exports = { submit, poll, test, buildInput, sttResult };
