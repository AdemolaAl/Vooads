// Studio v2 API (Backend B): video types, training center, margins (loss guard), AI brain and training voice admin.
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../db');
const { parseJson, fail, readBody } = require('../lib/http');
const auth = require('../auth');
const credits = require('../credits');
const providers = require('../providers');
const guard = require('../guard');
const stitch = require('../stitch');
const brain = require('../ai/brain');
const videotypes = require('../videotypes');
const { getSetting, setSetting } = require('../settings');
const media = require('../media');
const addons = require('../addons');
const levels = require('../levels');
const pronounce = require('../pronounce');

const audit = (staff, action, target, detail) => run('INSERT INTO audit_log(staff_id, action, target, detail) VALUES(?,?,?,?)', staff.id, action, String(target ?? ''), JSON.stringify(detail || {}));

const LESSONS_FILE = path.join(__dirname, '..', '..', 'content', 'training', 'lessons.json');
function lessons() {
  try {
    const raw = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.lessons) ? raw.lessons : [];
    return list.filter((l) => l && l.id);
  } catch { return []; }
}

// Public view of one video type for the studio, with limits for the signed-in user's plan (if any).
function typeView(t, plan) {
  const locked = videotypes.lockedReason(t, plan);
  return {
    id: t.id, name: t.name, description: t.description, pipeline: t.pipeline, unit: t.unit, credits_per_unit: t.credits_per_unit,
    segment_seconds: t.segment_seconds, seconds_step: Math.max(1, Number(t.seconds_step) || 1), min_seconds: t.min_seconds, max_seconds: plan ? videotypes.maxFor(t, plan) : null,
    max_seconds_by_plan: t.max_seconds_by_plan, min_plan: t.min_plan || null, extras: t.extras, badge: t.badge || null,
    locked: !!locked, locked_reason: locked, fields: videotypes.FIELDS[t.pipeline],
    levels: levels.view(t, plan),
    upload: t.upload || null, price_by_seconds: t.price_by_seconds || null, min_credits: t.min_credits || null,
    auto_level: t.auto_level || null, max_hooks: t.max_hooks || null, bulk_discounts: Array.isArray(t.bulk_discounts) ? t.bulk_discounts : null, local_credits_per_unit: t.local_credits_per_unit || null,
    quality: t.quality || null, addons: addons.allowed(t), includes: Array.isArray(t.includes) ? t.includes : [], voice_tier_default: t.voice_tier_default || (addons.VOICE_PIPELINES.includes(t.pipeline) ? 'standard' : null),
  };
}

module.exports = function mount(r) {
  // ---------- Video types (public; personalised when logged in) ----------
  r.get('/api/video-types', (req, res) => {
    const u = auth.currentUser(req);
    const plan = u && u.status === 'active' ? credits.activePlan(u) : null;
    res.json({
      video_types: videotypes.all().filter((t) => t.enabled).map((t) => typeView(t, plan)),
      plan: plan ? { id: plan.id, name: plan.name } : null,
      stitching: stitch.available(),
      addons: addons.publicView(),
    });
  });

  // ---------- Training center ----------
  r.get('/api/training', (req, res) => {
    res.json({ lessons: lessons(), audio: getSetting('training_audio') || {} });
  });

  // ---------- Admin: margins + limits ----------
  r.get('/api/admin/margins', (req, res) => {
    auth.requireStaff(req, 'pricing.view');
    res.json({ ...guard.margins(), limits: guard.limits(), ffmpeg: stitch.available() });
  });

  // ---------- Admin: AI brain ----------
  r.get('/api/admin/ai-brain', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    res.json(brain.state());
  });
  r.put('/api/admin/ai-brain', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    let out;
    try { out = brain.update(b); } catch (e) { fail(e.status || 400, e.message); }
    audit(s, 'ai_brain.edit', 'ai-brain', { parts: Object.keys(b) });
    res.json(out);
  });
  r.post('/api/admin/ai-brain/preview', async (req, res) => {
    auth.requireStaff(req, 'settings.view');
    const b = await parseJson(req);
    const input = { product: String(b.product || ''), niche: String(b.niche || ''), audience: String(b.audience || '') };
    res.json({ vertical: brain.detectVertical(input)?.id || null, system: brain.systemFor(b.task || 'script', input), plan: brain.scriptPlan(Number(b.seconds) || 15, b.template) });
  });

  // ---------- Admin: training narration (mp3 per scene through the default voice provider) ----------
  r.post('/api/admin/training/voice', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const list = lessons().filter((l) => !b.lesson_id || l.id === b.lesson_id);
    if (!list.length) fail(400, b.lesson_id ? 'Lesson not found.' : 'No lessons yet. Add content/training/lessons.json.');
    const p = providers.chain('voice')[0];
    if (p.adapter === 'mock') return res.json({ ok: false, demo: true, note: 'Add an ElevenLabs key in Admin → AI providers first. Until then the player uses the browser voice.', audio: getSetting('training_audio') || {} });
    const voices = getSetting('voices');
    const voiceId = (b.voice && voices[b.voice]) || b.voice_id || voices.coach || voices.female_warm;
    const map = { ...(getSetting('training_audio') || {}) };
    let made = 0;
    const errors = [];
    for (const l of list) {
      const scenes = Array.isArray(l.scenes) ? l.scenes : [];
      const urls = Array.isArray(map[l.id]) && !b.force ? [...map[l.id]] : [];
      for (let k = 0; k < scenes.length; k++) {
        if (urls[k]) continue;
        const text = String(scenes[k].narration || scenes[k].caption || '').trim();
        if (!text) { urls[k] = null; continue; }
        try {
          const out = await providers.submit(p, 'voice', { text: pronounce.forTts(text.slice(0, 2500)), voice_id: voiceId });
          urls[k] = out.result?.url || null;
          require('../llmbill').recordProvider({ row: p, kind: 'voice', input: { text }, result: out.result, feature: 'training_voice' });
          made++;
        } catch (e) { errors.push(`${l.id}#${k + 1}: ${e.message.slice(0, 120)}`); urls[k] = null; }
      }
      map[l.id] = urls;
      setSetting('training_audio', map); // save as we go, so a timeout keeps finished lessons
    }
    audit(s, 'training.voice', b.lesson_id || 'all', { made, errors: errors.length });
    res.json({ ok: !errors.length, made, errors, audio: map });
  });

  // ---------- Admin: pronunciation dictionary (applied to every voiceover) ----------
  r.get('/api/admin/pronunciations', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    res.json({ pronunciations: pronounce.list(), defaults: pronounce.DEFAULT });
  });
  r.put('/api/admin/pronunciations', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const b = await parseJson(req);
    const rows = pronounce.sanitize(b.pronunciations);
    if (!rows) fail(400, 'Send pronunciations as a list of {word, say}.');
    setSetting('pronunciations', rows);
    audit(s, 'pronunciations.edit', 'pronunciations', { count: rows.length });
    res.json({ pronunciations: rows });
  });
  r.post('/api/admin/pronunciations/preview', async (req, res) => {
    auth.requireStaff(req, 'settings.view');
    const b = await parseJson(req);
    res.json({ text: pronounce.apply(String(b.text || '').slice(0, 2000), Array.isArray(b.pronunciations) ? b.pronunciations : pronounce.list()) });
  });

  // ---------- Admin: music library (tracks by mood, used by the 'library' music provider) ----------
  r.get('/api/admin/music', (req, res) => {
    auth.requireStaff(req, 'settings.view');
    res.json({ tracks: getSetting('music_library') || [], moods: addons.MOODS });
  });
  // Raw upload: body = the mp3, Content-Type audio/mpeg, ?mood=upbeat&name=Track%20name
  r.post('/api/admin/music', async (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!['audio/mpeg', 'audio/mp3'].includes(type)) fail(400, 'Upload an MP3 file (Content-Type audio/mpeg).');
    const mood = addons.MOODS.includes(req.query.mood) ? req.query.mood : null;
    if (!mood) fail(400, 'Pick a mood: ' + addons.MOODS.join(', ') + '.');
    const buf = await readBody(req, 30e6);
    if (buf.length < 1000) fail(400, 'That file is empty.');
    const looksMp3 = buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
    if (!looksMp3) fail(400, 'That file is not an MP3.');
    const m = media.save(buf, 'audio/mpeg', null);
    const track = { id: m.id, url: m.path, mood, name: String(req.query.name || 'Track').slice(0, 80), bytes: buf.length, created_at: new Date().toISOString() };
    setSetting('music_library', [...(getSetting('music_library') || []), track]);
    audit(s, 'music.upload', m.id, { mood, name: track.name });
    res.json({ track });
  });
  r.del('/api/admin/music/:id', (req, res) => {
    const s = auth.requireStaff(req, 'settings.manage');
    const list = getSetting('music_library') || [];
    const t = list.find((x) => x.id === req.params.id);
    if (!t) fail(404, 'Track not found.');
    setSetting('music_library', list.filter((x) => x.id !== t.id));
    const row = media.row(t.id);
    if (row) {
      const f = media.filePath(row.file);
      if (f) { try { fs.unlinkSync(f); } catch {} }
      run('DELETE FROM media WHERE id = ?', t.id);
    }
    audit(s, 'music.delete', t.id, { name: t.name });
    res.json({ ok: true });
  });
};

module.exports.lessons = lessons;
