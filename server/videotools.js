// Video tools that work on the customer's own footage or make brand audio (SPEC §14):
//   bg_swap      "Change background"  upload → background (colour / image / AI scene / stock video) → AI background removal
//                (fal VEED) → ffmpeg composite (original audio kept) → mp4 in the chosen shape
//   auto_edit    "Auto-edit my video" upload → audio → speech-to-text with word timings → AI edit plan (validated, never
//                trusted as is) → ffmpeg cuts, punch-ins, animated captions, music bed with ducking, -14 LUFS, reframe, end card
//   brand_music  "Brand music"        brief → ElevenLabs Music (instrumental or a jingle that sings the brand name) → saved to
//                the customer's "My brand tracks", reusable for free as the music of any video (music source "brand")
// Jobs run in the same worker as every other job (server/jobs.js): same step runner, provider fallback, limits and automatic
// refunds when a job fails.
const fs = require('node:fs');
const path = require('node:path');
const { db, get, all, run } = require('./db');
const providers = require('./providers');
const uploads = require('./uploads');
const media = require('./media');
const stitch = require('./stitch');
const editkit = require('./editkit');
const config = require('./config');
const { fail } = require('./lib/http');

db.exec(`CREATE TABLE IF NOT EXISTS brand_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, job_id INTEGER, name TEXT, url TEXT NOT NULL, seconds INTEGER,
  vocals INTEGER DEFAULT 0, mood TEXT, genre TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS brand_tracks_user ON brand_tracks(user_id, deleted_at);`);

const PIPES = ['bg_swap', 'auto_edit', 'brand_music'];
const BG_KINDS = ['color', 'image', 'ai', 'stock'];
const BG_ASPECTS = ['original', '9:16', '4:5', '1:1', '16:9'];
const EDIT_ASPECTS = ['9:16', '4:5', '1:1'];
const MUSIC_LENGTHS = [15, 30, 60, 120];
const MOODS = ['upbeat', 'chill', 'cinematic', 'corporate', 'hiphop', 'emotional'];
const STEP_LABELS = {
  bg_swap: ['Preparing video', 'Background', 'Removing background', 'Compositing', 'Saving'],
  auto_edit: ['Listening', 'Transcribing', 'Planning the edit', 'Music', 'Cutting and captions', 'Saving'],
  brand_music: ['Composing', 'Saving'],
};
const str = (v) => String(v ?? '').trim();
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// ---------- Brand tracks ----------
const trackView = (t) => t && { id: t.id, name: t.name, url: t.url, seconds: t.seconds, vocals: !!t.vocals, mood: t.mood, genre: t.genre, job_id: t.job_id, created_at: t.created_at };
const tracksOf = (userId) => all('SELECT * FROM brand_tracks WHERE user_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 100', userId).map(trackView);
// A brand track the user owns, or null (never someone else's).
function ownTrack(id, userId) {
  const t = get('SELECT * FROM brand_tracks WHERE id = ? AND deleted_at IS NULL', Number(id) || 0);
  return t && t.user_id === userId ? t : null;
}

// Prompts must describe a sound, not copy an artist (AI content policy).
const IMITATION = /\b(in the style of|style of|sounds? like|sound-?alike|voice of|cover of|imitat\w*|copy of|like (?:the song|a song by))\b/i;
function checkMusicBrief(text) {
  if (IMITATION.test(String(text || ''))) fail(400, 'Describe the mood, genre and tempo instead of naming an artist or song. Prompts must not imitate real artists.');
}

// ---------- Creating jobs: validation (called from jobs.create) ----------
// Mutates `clean` (the job input). Throws 400/402/403 with a readable message.
function prepare(vt, input, clean, user, plan) {
  const p = vt.pipeline;
  if (p === 'bg_swap' || p === 'auto_edit') {
    const up = uploads.owned(str(input.upload_id), user.id);
    if (!up || up.kind !== 'video') fail(400, 'Upload your video first.');
    const max = uploads.purpose(p).max_seconds;
    if (up.duration > max + 0.5) fail(400, `That video is too long. ${vt.name} takes up to ${max}s.`);
    clean.upload_id = up.id;
    clean.upload_name = up.name || 'Your video';
    clean.raw_seconds = Math.round(up.duration * 100) / 100;
    clean.duration = Math.max(vt.min_seconds || 1, Math.ceil(up.duration));
    if (!str(clean.product)) clean.product = (p === 'bg_swap' ? 'New background: ' : 'Auto-edit: ') + clean.upload_name;
  }
  if (p === 'bg_swap') {
    clean.bg_kind = BG_KINDS.includes(input.bg_kind) ? input.bg_kind : 'color';
    clean.aspect = BG_ASPECTS.includes(input.aspect) ? input.aspect : 'original';
    clean.bg_color = /^#?[0-9a-f]{6}$/i.test(str(input.bg_color)) ? '#' + str(input.bg_color).replace('#', '').toUpperCase() : '#1DB954';
    if (clean.bg_kind === 'image') {
      if (!/^(\/media\/|https?:\/\/)/.test(str(input.bg_image_url))) fail(400, 'Upload the background picture.');
      clean.bg_image_url = str(input.bg_image_url);
    } else delete clean.bg_image_url;
    if (clean.bg_kind === 'ai') { clean.bg_prompt = str(input.bg_prompt).slice(0, 400); if (clean.bg_prompt.length < 3) fail(400, 'Describe the background scene you want.'); } else delete clean.bg_prompt;
    if (clean.bg_kind === 'stock') { clean.bg_query = str(input.bg_query).slice(0, 100) || 'modern office'; } else delete clean.bg_query;
  }
  if (p === 'auto_edit') {
    clean.aspect = EDIT_ASPECTS.includes(input.aspect) ? input.aspect : '9:16';
    clean.caption_style = Object.keys(editkit.CAPTION_STYLES).includes(input.caption_style) ? input.caption_style : 'bold';
    clean.captions = input.captions !== false;
    clean.remove_silences = input.remove_silences !== false;
    clean.hook_first = bool(input.hook_first);
    clean.end_card = bool(input.end_card);
    clean.cta = str(input.cta).slice(0, 30) || 'Shop now';
    clean.brand_color = /^#?[0-9a-f]{6}$/i.test(str(input.brand_color)) ? '#' + str(input.brand_color).replace('#', '').toUpperCase() : '';
    if (clean.logo_url && !/^(\/media\/|https?:\/\/)/.test(str(clean.logo_url))) delete clean.logo_url;
  }
  if (p === 'brand_music') {
    const want = Number(input.duration) || 30;
    clean.duration = MUSIC_LENGTHS.find((x) => x >= want) || MUSIC_LENGTHS[MUSIC_LENGTHS.length - 1];
    const max = require('./videotypes').maxFor(vt, plan);
    if (clean.duration > max) fail(402, `Your ${plan.name} plan makes brand tracks up to ${max}s. Pick a shorter length or upgrade.`, { max_seconds: max });
    clean.vocals = bool(input.vocals);
    clean.mood = MOODS.includes(input.mood) ? input.mood : 'upbeat';
    clean.genre = str(input.genre).slice(0, 60);
    clean.tempo = ['slow', 'medium', 'fast'].includes(input.tempo) ? input.tempo : 'medium';
    clean.lyrics = clean.vocals ? str(input.lyrics).slice(0, 600) : '';
    clean.track_name = str(input.track_name).slice(0, 60);
    clean.brand_name = str(input.brand_name || clean.brand).slice(0, 40);
    if (str(clean.product).length < 3) fail(400, 'Describe your brand and what the music is for.');
    if (clean.vocals && !clean.brand_name) fail(400, 'Add the brand name the jingle should sing.');
    checkMusicBrief([clean.product, clean.genre, clean.lyrics].join(' '));
  }
}

// Seconds a quote is based on: the uploaded video's real length when the customer owns the upload (never a number the
// browser sent for it), else the length asked for.
function quoteSeconds(vt, input, user) {
  if ((vt.pipeline === 'bg_swap' || vt.pipeline === 'auto_edit') && input.upload_id && user) {
    const up = uploads.owned(str(input.upload_id), user.id);
    if (up) return Math.ceil(up.duration);
  }
  if (vt.pipeline === 'brand_music') { const want = Number(input.duration) || 30; return MUSIC_LENGTHS.find((x) => x >= want) || MUSIC_LENGTHS[MUSIC_LENGTHS.length - 1]; }
  return null;
}

// ---------- Running jobs ----------
// ctx = {st, i, runStep, save, next, done, background, musicStep} from jobs.advance.
async function advance(job, ctx) {
  const { st, i } = ctx;
  st.steps = STEP_LABELS[job.type];
  if (job.type === 'bg_swap') return bgSwap(job, ctx);
  if (job.type === 'auto_edit') return autoEdit(job, ctx);
  if (job.type === 'brand_music') return brandMusic(job, ctx);
  throw new Error('Unknown video tool ' + job.type + ' ' + (i && i.video_type));
}

function sourceUpload(job, i) {
  const up = uploads.owned(i.upload_id, job.user_id);
  if (!up) throw new Error(`Your uploaded video is no longer stored (uploads are kept ${uploads.limits().keep_days} days). Upload it again.`);
  return up;
}
const ASPECT_SIZE = { '9:16': '1080x1920', '4:5': '1080x1350', '1:1': '1080x1080', '16:9': '1920x1080' };
// Remove the server's own intermediate files (extracted audio, re-timed copies) once a job no longer needs them.
function dropWork(st) {
  for (const k of ['prepId', 'audioId']) { const u = st[k] && uploads.byId(st[k]); if (u && u.purpose === 'work') uploads.remove(u); }
}

async function bgSwap(job, { st, i, runStep, save, next, done, background }) {
  const up = sourceUpload(job, i);
  const src = uploads.filePath(up);
  // 1. Footage above 60 fps or 1080p is re-timed / scaled first (the matting model bills per frame; priced at 60 fps).
  if (!st.sendId) {
    if (!stitch.available()) { st.sendId = up.id; return next({ step: 'Preparing video' }); }
    const r = background(job, 'prep', () => editkit.withTmp(async (dir) => {
      const f = await editkit.prepForMatting(src, up, dir);
      return f === src ? up.id : uploads.saveLocal(job.user_id, f, 'video/mp4').id;
    }));
    if (r.pending) { st.progress = 0.05; return save({ step: 'Preparing video' }); }
    if (r.error) throw new Error('We could not read your video: ' + r.error.message);
    st.sendId = r.result;
    if (st.sendId !== up.id) st.prepId = st.sendId;
    return next({ step: 'Preparing video' });
  }
  // 2. The new background.
  if (!st.bg) {
    if (i.bg_kind === 'image') st.bg = { kind: 'image', url: i.bg_image_url };
    else if (i.bg_kind === 'ai') {
      const r = await runStep(job, st, 'bg_img', 'image', { prompt: `${i.bg_prompt}. Empty background scene for a video ad, no people, no text, photorealistic, natural light, depth, leave room for a person standing in front. ${i.aspect === 'original' ? '' : i.aspect + ' frame.'}`, size: ASPECT_SIZE[i.aspect] || (up.width > up.height ? '1920x1080' : '1080x1920'), aspect: i.aspect === 'original' ? (up.width > up.height ? '16:9' : '9:16') : i.aspect });
      if (!r) { st.progress = 0.12; return save({ step: 'Background' }); }
      st.bg = { kind: 'image', url: await media.mirror(r.url, job.user_id), ai: true };
    } else if (i.bg_kind === 'stock') {
      let r = null;
      try { r = await runStep(job, st, 'bg_stock', 'stock', { query: i.bg_query, aspect: i.aspect === 'original' ? (up.width > up.height ? '16:9' : '9:16') : i.aspect, min_seconds: Math.min(10, i.duration) }); }
      catch (e) { st.bg = { kind: 'color', color: i.bg_color, note: 'No stock clip was found, so a solid colour was used.' }; return next({ step: 'Background' }); }
      if (!r) { st.progress = 0.12; return save({ step: 'Background' }); }
      st.bg = { kind: 'video', url: await media.mirror(r.url, job.user_id), credit: r.credit || null };
    } else st.bg = { kind: 'color', color: i.bg_color };
    st.progress = 0.2;
    return next({ step: 'Background' });
  }
  // 3. Cut the person out (fal VEED video background removal; the demo provider keys out green).
  const send = uploads.byId(st.sendId) || up;
  const m = await runStep(job, st, 'matte', 'matting', { video_url: uploads.signedUrl(send), video_path: uploads.filePath(send), duration: i.duration, subject_is_person: true });
  if (!m) { const s = st.sub && st.sub.matte; st.progress = Math.max(st.progress || 0, 0.25 + 0.5 * ((s && s.progress) || 0.1)); return save({ step: 'Removing background' }); }
  // 4. Composite with ffmpeg, original audio kept.
  if (!st.out) {
    if (!stitch.available()) { st.out = { url: m.url, note: 'Your cut-out video is ready. Putting it on the new background starts once ffmpeg is installed on the server.' }; return next({ step: 'Compositing' }); }
    const r = background(job, 'compose', () => editkit.withTmp(async (dir) => {
      const fg = await stitch.localFile(m.url, dir, job.user_id);
      const mask = m.mask_url ? await stitch.localFile(m.mask_url, dir, job.user_id) : null;
      let bg = { kind: 'color', color: st.bg.color || i.bg_color };
      if (st.bg.kind !== 'color') {
        // A background we cannot fetch (expired link, sample not on this server) falls back to the colour instead of failing.
        try { bg = { kind: st.bg.kind, file: await stitch.localFile(st.bg.url, dir, job.user_id) }; }
        catch (e) { console.warn('[bg_swap] background unavailable', job.id, e.message); st.bgNote = 'The background could not be loaded, so a solid colour was used. Try again or pick another background.'; }
      }
      const out = path.join(dir, 'out.mp4');
      await editkit.compositeBackground({ fg, mask, src, bg, aspect: i.aspect, info: up, out });
      return media.save(fs.readFileSync(out), 'video/mp4', job.user_id).path;
    }));
    if (r.pending) { st.progress = Math.max(st.progress || 0, 0.82); return save({ step: 'Compositing' }); }
    if (r.error) throw new Error('We could not put your video on the new background: ' + r.error.message.slice(0, 200));
    st.out = { url: r.result };
  }
  dropWork(st);
  return done({ url: st.out.url, duration: Math.round(up.duration * 10) / 10, aspect: i.aspect, background: { kind: st.bg.kind, color: st.bg.color || null, url: st.bg.url || null, ai: !!st.bg.ai, credit: st.bg.credit || null }, note: st.out.note || st.bg.note || st.bgNote, source_name: i.upload_name });
}

// The AI edit plan: word list in, JSON advice out (checked by editkit.validatePlan).
function editPlanPrompt(i, words, D) {
  const list = words.slice(0, 1500).map((w, k) => `${k}|${w.start.toFixed(2)}|${w.end.toFixed(2)}|${w.text}`).join('\n');
  return {
    mode: 'edit_plan', duration: D, words,
    system: 'You are a senior short-form video editor for paid social ads. You read a word-timed transcript and decide what to cut so the video is tight, keeps attention and never loses meaning. You answer with JSON only.',
    prompt: `Video length: ${D.toFixed(2)} seconds. Transcript, one word per line as index|start|end|word (seconds):
${list}

Tasks:
1. "remove": time ranges to cut: repeated or abandoned takes (keep the LAST good take), false starts, stumbles, off-topic asides. Do not list silences or filler words like "um"/"uh": they are removed automatically. Cut on word boundaries.
2. "hook": the single strongest 1.5 to 8 second line to open the ad with (a bold claim, a result, a question), or null.
3. "emphasis": up to 8 times (seconds) of key words worth a punch-in zoom.
Return ONLY JSON: {"remove": [{"start": 0.0, "end": 0.0, "reason": "repeated take"}], "hook": {"start": 0.0, "end": 0.0} or null, "emphasis": [0.0]}`,
    max_tokens: 1500,
  };
}
function parseJsonLoose(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function autoEdit(job, ctx) {
  const { st, i, runStep, save, next, done, background, musicStep } = ctx;
  const up = sourceUpload(job, i);
  const src = uploads.filePath(up);
  const D = Number(up.duration) || i.duration;
  // Optional outside service (Admin → AI providers, kind "autoedit", off by default): hands the whole edit over.
  const ext = providers.chain('autoedit').filter((p) => p.adapter !== 'mock');
  if (ext.length || st.sub?.external) {
    const r = await runStep(job, st, 'external', 'autoedit', { video_url: uploads.signedUrl(up), aspect: i.aspect, prompt: i.product, duration: D }, ext);
    if (!r) { st.progress = Math.max(st.progress || 0, 0.2 + 0.6 * ((st.sub?.external?.progress) || 0.1)); return save({ step: 'Cutting and captions' }); }
    return done({ url: await media.mirror(r.url, job.user_id), duration: null, raw_seconds: Math.round(D * 10) / 10, aspect: i.aspect, provider: 'external', note: 'Edited by the outside auto-edit service set up in Admin → AI providers.' });
  }
  if (!stitch.available()) throw new Error('Auto-edit needs ffmpeg on the server. Ask the admin to install it.');
  // 1. Audio for speech-to-text (mono 16 kHz MP3, a private work file).
  if (!st.audioId) {
    if (!up.has_audio) { st.audioId = 'none'; st.words = []; return next({ step: 'Listening' }); }
    const r = background(job, 'audio', () => editkit.withTmp(async (dir) => { const f = path.join(dir, 'audio.mp3'); await editkit.extractAudio(src, f); return uploads.saveLocal(job.user_id, f, 'audio/mpeg').id; }));
    if (r.pending) { st.progress = 0.05; return save({ step: 'Listening' }); }
    if (r.error) throw new Error('We could not read the sound of your video: ' + r.error.message.slice(0, 160));
    st.audioId = r.result;
    return next({ step: 'Listening' });
  }
  // 2. Words with timings.
  if (!st.words) {
    const au = uploads.byId(st.audioId);
    if (!au) throw new Error('The extracted audio went missing. Try again.');
    const r = await runStep(job, st, 'stt', 'stt', { audio_url: uploads.signedUrl(au), audio_path: uploads.filePath(au), duration: D, language: i.language && i.language !== 'en' ? i.language : undefined });
    if (!r) { st.progress = 0.2; return save({ step: 'Transcribing' }); }
    st.words = editkit.cleanWords(r.words, D);
    st.progress = 0.35;
    return next({ step: 'Transcribing' });
  }
  // 3. Edit plan: our own cuts (silences, fillers) + the AI's advice, validated and clamped.
  if (!st.segs) {
    let plan = { removals: [], hook: null, emphasis: [], notes: [] };
    if (st.words.length >= 4) {
      const r = await runStep(job, st, 'plan', 'text', editPlanPrompt(i, st.words, D));
      if (!r) { st.progress = 0.45; return save({ step: 'Planning the edit' }); }
      plan = editkit.validatePlan(parseJsonLoose(r.text), { duration: D, words: st.words });
    }
    st.plan = { hook: plan.hook, emphasis: plan.emphasis, ai_cuts: plan.removals.length, notes: plan.notes };
    st.segs = editkit.cutList({ duration: D, words: st.words, plan, removeSilences: i.remove_silences !== false, hookFirst: !!i.hook_first });
    st.progress = 0.55;
    return next({ step: 'Planning the edit' });
  }
  // 4. Music bed (library, AI, or the customer's own brand track).
  const mus = await musicStep(job, st, i, D);
  if (mus === null) return save({ step: 'Music' });
  // 5. Render.
  if (!st.out) {
    const r = background(job, 'render', () => editkit.withTmp(async (dir) => {
      const musicFile = mus && !mus.error && mus.url ? await stitch.localFile(mus.url, dir, job.user_id).catch(() => null) : null;
      let logoFile = null;
      if (i.end_card && i.logo_url) logoFile = await stitch.localFile(i.logo_url, dir, job.user_id).catch(() => null);
      const brandColor = i.brand_color || userBrandColor(job.user_id) || '#FF4A1C';
      const out = path.join(dir, 'edit.mp4');
      const res = await editkit.renderEdit({ src, info: up, segs: st.segs, words: st.words, captions: i.captions !== false, captionStyle: i.caption_style, brandColor, aspect: i.aspect, musicFile, endCard: i.end_card ? { logoFile, cta: i.cta } : null, out });
      const m = media.save(fs.readFileSync(out), 'video/mp4', job.user_id);
      const cap = media.save(Buffer.from(res.srt || ''), 'text/plain', job.user_id);
      return { url: m.path, captions_url: cap.path, seconds: res.seconds, captioned: res.captioned, pieces: res.pieces };
    }));
    if (r.pending) { st.progress = Math.max(st.progress || 0, 0.7); return save({ step: 'Cutting and captions' }); }
    if (r.error) throw new Error('The edit could not be rendered: ' + r.error.message.slice(0, 200));
    st.out = r.result;
  }
  dropWork(st);
  const kept = st.segs.reduce((t, s) => t + (s.end - s.start), 0);
  return done({
    url: st.out.url, captions_url: st.out.captions_url, duration: st.out.seconds, raw_seconds: Math.round(D * 10) / 10, removed_seconds: Math.max(0, Math.round((D - kept) * 10) / 10),
    pieces: st.out.pieces, hook: st.plan.hook, hook_first: !!i.hook_first && !!st.plan.hook, captioned: st.out.captioned, caption_style: i.caption_style, aspect: i.aspect,
    transcript: st.words.map((w) => w.text).join(' ').slice(0, 2000), music_url: mus && !mus.error ? mus.url || null : null, music_note: mus?.error, source_name: i.upload_name,
  });
}
function userBrandColor(userId) {
  try { const b = JSON.parse(get('SELECT brand FROM users WHERE id = ?', userId)?.brand || 'null'); return b && /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : null; } catch { return null; }
}

// Brand music: only AI music rows (the library cannot compose). Demo mode makes a simple real audio file.
function aiMusicChain() {
  const rows = providers.chain('music').filter((p) => p.adapter !== 'library' && p.adapter !== 'mock');
  return rows.length ? rows : [{ id: 0, name: 'Demo', kind: 'music', adapter: 'mock', config: {}, apiKey: '', model: 'demo' }];
}
const MOOD_WORDS = { upbeat: 'upbeat, bright and positive', chill: 'relaxed, warm and laid-back', cinematic: 'cinematic, building and inspiring', corporate: 'clean, modern and optimistic', hiphop: 'confident modern hip-hop', emotional: 'heartfelt and emotional' };
function musicPrompt(i) {
  const parts = [
    `${i.vocals ? 'A catchy advertising jingle with lead vocals' : 'Instrumental background music for a video ad, no vocals'}, ${i.duration} seconds.`,
    `Brand and use: ${i.product}.`,
    `Mood: ${MOOD_WORDS[i.mood] || i.mood}.`, i.genre ? `Genre: ${i.genre}.` : '', `Tempo: ${i.tempo}.`,
    i.vocals ? `The singer clearly sings the brand name "${i.brand_name}" in the hook.` : 'Leaves room for a voiceover.',
    i.vocals && i.lyrics ? `Lyrics: ${i.lyrics}` : '',
    'Original composition, not imitating any real artist or song. Clean mix, strong ending.',
  ];
  return parts.filter(Boolean).join(' ');
}
async function brandMusic(job, { st, i, runStep, save, done }) {
  if (!st.track) {
    const r = await runStep(job, st, 'music', 'music', { prompt: musicPrompt(i), seconds: i.duration, vocals: !!i.vocals, mood: i.mood, render_audio: true }, aiMusicChain());
    if (!r) { st.progress = Math.max(st.progress || 0, 0.3 + 0.5 * ((st.sub?.music?.progress) || 0.2)); return save({ step: 'Composing' }); }
    const url = await media.mirror(r.url, job.user_id);
    const name = i.track_name || `${i.brand_name || String(i.product).split(/[,.]/)[0].slice(0, 30)} · ${i.vocals ? 'jingle' : 'theme'} ${i.duration}s`;
    const info = run('INSERT INTO brand_tracks(user_id, job_id, name, url, seconds, vocals, mood, genre) VALUES(?,?,?,?,?,?,?,?)', job.user_id, job.id, name.slice(0, 80), url, i.duration, i.vocals ? 1 : 0, i.mood, i.genre || null);
    st.track = { id: Number(info.lastInsertRowid), url, name };
  }
  return done({
    audio_url: st.track.url, track_id: st.track.id, track_name: st.track.name, seconds: i.duration, vocals: !!i.vocals, mood: i.mood, genre: i.genre || null,
    licence: 'Made for your brand. You can use it in your ads, including paid ads. Do not register it with Content ID or as your own song. Reusing it as the music of any Vooads video is free.',
  });
}

// ---------- Music source "brand" for any video add-on ----------
// Returns {url} for the user's own track; throws when the track is not theirs or no longer exists.
function brandTrackFor(job, i) {
  const t = ownTrack(i.music.track_id, job.user_id);
  if (!t) throw new Error('That brand track is no longer in your library. Pick another one.');
  return { url: t.url, mood: t.mood, source: 'brand', name: t.name };
}

module.exports = { PIPES, STEP_LABELS, BG_KINDS, BG_ASPECTS, EDIT_ASPECTS, MUSIC_LENGTHS, prepare, quoteSeconds, advance, tracksOf, ownTrack, trackView, brandTrackFor, checkMusicBrief, musicPrompt, editPlanPrompt, aiMusicChain, IMITATION };
