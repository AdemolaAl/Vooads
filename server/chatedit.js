// Chat editing: the customer types what to change ("cut the first 2 seconds, captions bigger, new actor in scene 2"), the
// planner turns it into a strict list of edit operations, every operation is priced before anything runs, the customer
// confirms with one tap, and the result is a new version of the video (history, compare, undo).
//
// Safety rules (all enforced here, never left to the AI):
//   - Only operations on the OP list exist. Anything else is "can't yet" with the closest thing we can do.
//   - Every operation has a price before it runs. Local (ffmpeg) operations cost 0 credits; generation operations run as
//     normal priced jobs (jobs.create: profit guard, credits taken up front, refunds on failure).
//   - Generation always uses the video's own quality level. The planner cannot name a model or a level: such fields are
//     dropped. A level that is not available for the needed type means "can't yet", never a pricier or cheaper model.
//   - Planner calls are metered (llmbill.js): free messages per plan per day, then a small fee, rate limits, a daily cap.
const { db, get, all, run, tx, J } = require('./db');
const { fail } = require('./lib/http');
const config = require('./config');
const credits = require('./credits');
const videotypes = require('./videotypes');
const levels = require('./levels');
const ops = require('./editops');

function migrate() {
  db.exec(`
CREATE TABLE IF NOT EXISTS chat_edit_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, root_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL,
  kind TEXT, plan TEXT, status TEXT, credits INTEGER NOT NULL DEFAULT 0, base_job_id INTEGER, edit_job_id INTEGER, child_job_ids TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS chat_edit_root ON chat_edit_messages(root_id, id);
CREATE TABLE IF NOT EXISTS video_versions (root_id INTEGER PRIMARY KEY, current_job_id INTEGER NOT NULL, updated_at TEXT);`);
}

const str = (v) => String(v ?? '').trim();
const r1 = (x) => Math.round(x * 10) / 10;
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const LANGS = () => require('./jobs').LANGS;
const absUrl = (u) => (/^https?:/.test(u) ? u : config.appUrl + u);

// ---------- Operations ----------
// local: ffmpeg only (0 credits). gen: a priced generation job. pipelines: where it works (null = every editable video).
const OPS = {
  trim: { local: true, label: (o) => `Keep ${r1(o.start)}–${r1(o.end)}s` },
  cut: { local: true, label: (o) => `Cut ${r1(o.start)}–${r1(o.end)}s` },
  reorder: { local: true, label: (o) => `Re-order scenes to ${o.order.map((x) => x + 1).join(', ')}` },
  speed: { local: true, label: (o) => `Speed ×${o.factor}` },
  reframe: { local: true, label: (o) => `Reframe to ${o.aspect}` },
  captions: { local: true, label: (o) => (o.on === false ? 'Captions off' : ['Captions', o.style, o.size, o.position && 'at the ' + o.position].filter(Boolean).join(' ')) },
  music: { local: true, label: (o) => (o.action === 'remove' ? 'Music off' : o.action === 'volume' ? `Music volume ${Math.round(o.volume * 100)}%` : `New music (${o.source === 'brand' ? 'your brand track' : o.source === 'library' ? 'library' : 'Vooads beat'})`) },
  overlay: { local: true, label: (o) => `Text "${o.text}" ${r1(o.start)}–${r1(o.end)}s` },
  end_card: { local: true, label: (o) => (o.on === false ? 'End card off' : `End card "${o.cta}"`) },
  logo: { local: true, label: (o) => (o.on === false ? 'Logo off' : `Logo ${o.corner}`) },
  ai_label: { local: true, label: (o) => (o.on === false ? '"AI-generated" label off' : '"AI-generated" label on') },
  speed_note: null,
  regenerate_scene: { gen: true, pipelines: ['ugc', 'video', 'image_to_video'], label: (o) => `Re-make scene ${o.scene + 1}${o.actor_id || o.actor_desc ? ' with a new actor' : ''}` },
  new_voice: { gen: true, pipelines: ['ugc', 'dub'], label: (o) => `New voice (${o.voice || 'actor voice'})` },
  translate: { gen: true, pipelines: ['ugc', 'dub'], label: (o) => `Dub into ${LANGS()[o.language]}` },
  captions_language: { gen: true, label: (o) => `Captions in ${LANGS()[o.language]}` },
  change_background: { gen: true, label: (o) => `New background (${o.kind === 'ai' ? 'AI scene' : o.kind === 'stock' ? 'stock video' : 'colour'})` },
  hook_variants: { gen: true, separate: true, label: (o) => `${o.count} new hook${o.count > 1 ? 's' : ''} for this video` },
};
delete OPS.speed_note;
const MASTER_OPS = ['trim', 'cut', 'reorder', 'speed', 'reframe', 'regenerate_scene', 'new_voice', 'translate', 'change_background'];

// ---------- Version context ----------
function rootOf(job) { const i = J(job.input, {}); return job.type === 'edit' ? Number(i.root_id) : job.id; }
function currentFor(rootId) { const v = get('SELECT current_job_id FROM video_versions WHERE root_id = ?', rootId); return v ? v.current_job_id : rootId; }
function ownedJob(user, id) {
  const j = get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', Number(id) || 0, user.id);
  if (!j) fail(404, 'Video not found.');
  return j;
}
// The real length of one of our files (the job's "duration" is what was asked; renders can differ by a second or two).
function realLength(url) {
  const m = String(url || '').match(/^\/(media|samples)\/([\w.-]+)$/);
  if (!m) return 0;
  const p = m[1] === 'media' ? require('./media').filePath(m[2]) : require('./samples').localPath(m[2]);
  if (!p) return 0;
  try { const d = require('./stitch').probe(p).duration; return d > 0 ? Math.round(d * 100) / 100 : 0; } catch { return 0; }
}
function scriptOf(out, i) {
  if (out.script) return out.script;
  if (out.script_translated) return out.script_translated;
  if (Array.isArray(out.slides)) return out.slides.map((s) => s.text).join(' ');
  if (Array.isArray(out.scenes)) return out.scenes.map((s) => s.vo || s.headline || '').join(' ');
  if (Array.isArray(out.lines)) return out.lines.map((l) => l.text).join(' ');
  return str(i.script);
}
// Everything the planner, the pricer and the editor need about one version.
function context(job) {
  const out = J(job.output, {}), i = J(job.input, {});
  if (job.type === 'edit') {
    const root = get('SELECT * FROM jobs WHERE id = ?', Number(i.root_id));
    const base = context(root);
    return { ...base, job, version_job_id: job.id, master_url: out.master_url, url: out.url, look: out.look || {}, words: out.words || [], words_source: out.words_source || 'estimate', scenes: out.scenes || [], duration: out.duration, aspect: out.aspect || base.aspect, script: out.script || base.script, language: out.language || base.language, has_stems: true, base_captioned: base.base_captioned };
  }
  if (job.status !== 'done' || !out.url) fail(400, job.status === 'done' ? 'This one has no single video to edit (it is a playlist or a set of clips). Make a new video instead.' : 'Wait until the video is finished, then edit it.');
  const vt = i.video_type ? videotypes.byId(i.video_type) : null;
  const D = realLength(out.master_url || out.url) || Number(out.duration) || Number(i.duration) || 15;
  const script = scriptOf(out, i);
  let scenes = [];
  const src = Array.isArray(out.segments) && out.segments.length > 1 ? out.segments : Array.isArray(out.scenes) && out.scenes.length > 1 ? out.scenes : null;
  if (src) scenes = src.map((s, k) => ({ n: k + 1, orig: k, start: Number(s.start) || 0, end: Math.min(D, Number(s.end) || D), text: s.headline || s.vo || '' }));
  else { const n = Math.max(1, Math.round(D / 5)); scenes = Array.from({ length: n }, (_, k) => ({ n: k + 1, orig: k, start: r1((D * k) / n), end: r1((D * (k + 1)) / n) })); }
  if (job.type === 'ugc' && script) { const parts = require('./jobs').splitScript(script, scenes.length); scenes = scenes.map((s, k) => ({ ...s, text: parts[k] || '' })); }
  const hasStems = !out.music_mixed || !!out.master_url;
  return {
    job, root: job, root_input: i, version_job_id: job.id, pipeline: job.type, vt, video_type: i.video_type || null, level: i.level || null, level_name: i.level_name || null,
    url: out.url, master_url: out.master_url || out.url, duration: D, aspect: out.aspect || i.aspect || '9:16', language: i.language || 'en', script,
    words: ops.wordsFromScript(script, D), words_source: 'estimate', scenes, has_stems: hasStems,
    look: out.look ? out.look : out.music_mixed && out.music_url && out.master_url ? { music: { on: true, url: out.music_url, volume: 0.35, source: 'original' } } : {},
    // A video finished with Auto-edit / Logo keeps its clean master, so its captions can still be restyled.
    base_captioned: out.look ? false : !!out.captioned || ['auto_edit', 'motion_ad', 'mad_edit'].includes(job.type),
  };
}
function supported(ctx) {
  return Object.keys(OPS).filter((k) => {
    const o = OPS[k];
    if (o.pipelines && !o.pipelines.includes(ctx.pipeline)) return false;
    if (k === 'reorder' && ctx.scenes.length < 2) return false;
    if (k === 'captions' && ctx.base_captioned) return false;
    if (k === 'captions_language' && (ctx.base_captioned || !ctx.words.length)) return false;
    return true;
  });
}

// ---------- Planner ----------
const ASPECTS = ['9:16', '1:1', '4:5', '16:9'];
const STYLES = ['bold', 'clean', 'boxed'];
const SIZES = ['small', 'medium', 'large', 'huge'];
const POS = ['top', 'middle', 'bottom'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function plannerInput(ctx, message, history) {
  const ops_ = supported(ctx);
  const sys = `You are the edit planner inside Vooads, an AI video ad studio. You turn a customer's edit request into operations.
Reply with ONLY one JSON object, no prose, matching exactly one of:
{"type":"plan","ops":[...],"note":"one short sentence for the customer"}
{"type":"question","question":"ONE short clarifying question"}
{"type":"unsupported","message":"why, in one short sentence","closest":"the closest thing you can do, in one short sentence"}
Operations you may use for this video (anything else is unsupported):
${ops_.map((k) => '- ' + k + ': ' + OP_DOCS[k]).join('\n')}
Rules: times are seconds on the current video (0 to ${ctx.duration}). Scenes are numbered from 1 in the list below; use the scene NUMBER. Never name an AI model, a quality level or a price. Ask a question only when the request cannot be done without one answer. Keep the customer's words for any on-screen text.`;
  const prompt = `Current video: ${ctx.duration}s, ${ctx.aspect}, language ${LANGS()[ctx.language] || ctx.language}, type ${ctx.vt ? ctx.vt.name : ctx.pipeline}.
Scenes: ${ctx.scenes.map((s) => `${s.n}: ${s.start}-${s.end}s${s.text ? ' "' + String(s.text).slice(0, 80) + '"' : ''}`).join(' | ')}
Captions: ${ctx.base_captioned ? 'burnt into the original (cannot be restyled)' : ctx.look.captions && ctx.look.captions.on !== false ? JSON.stringify(ctx.look.captions) : 'off'}. Music: ${ctx.look.music && ctx.look.music.on !== false ? 'on' : ctx.has_stems ? 'off' : 'mixed into the original (cannot be changed)'}.
${history.length ? 'Earlier in this chat:\n' + history.map((m) => `${m.role}: ${m.text}`).join('\n') + '\n' : ''}Customer: ${message}`;
  return { system: sys, prompt, max_tokens: Number(require('./settings').getSetting('llm').chat_edit.max_tokens) || 900 };
}
const OP_DOCS = {
  trim: '{"op":"trim","start":s,"end":s} keep only this part',
  cut: '{"op":"cut","start":s,"end":s} remove this part',
  reorder: '{"op":"reorder","order":[scene numbers in the new order]}',
  speed: '{"op":"speed","factor":0.5-2}',
  reframe: '{"op":"reframe","aspect":"9:16|1:1|4:5|16:9"}',
  captions: '{"op":"captions","on":true|false,"style":"bold|clean|boxed","size":"small|medium|large|huge","position":"top|middle|bottom"} any field optional',
  music: '{"op":"music","action":"swap|volume|remove","volume":0-1.5,"source":"beat|library|brand"}',
  overlay: '{"op":"overlay","text":"...","start":s,"end":s,"position":"top|middle|bottom"}',
  end_card: '{"op":"end_card","cta":"max 30 chars","on":true|false}',
  logo: '{"op":"logo","on":true|false,"corner":"top-left|top-right|bottom-left|bottom-right"}',
  ai_label: '{"op":"ai_label","on":true|false} a small "AI-generated" note on the whole video',
  regenerate_scene: '{"op":"regenerate_scene","scene":n,"direction":"what to change","new_actor":true|false,"actor_desc":"optional look of the new actor"}',
  new_voice: '{"op":"new_voice","voice":"female_warm|female_energetic|male_calm|male_mature"}',
  translate: '{"op":"translate","language":"two-letter code"} dub the whole video',
  captions_language: '{"op":"captions_language","language":"two-letter code"} captions only',
  change_background: '{"op":"change_background","kind":"color|ai|stock","color":"#RRGGBB","prompt":"scene","query":"stock search"}',
  hook_variants: '{"op":"hook_variants","count":1-10} new openings spliced onto this video',
};

// Deterministic planner for demo mode (no AI key) and as a template of what the AI must return.
const LANG_WORDS = { spanish: 'es', portuguese: 'pt', french: 'fr', german: 'de', italian: 'it', arabic: 'ar', hindi: 'hi', indonesian: 'id', turkish: 'tr', russian: 'ru', polish: 'pl', dutch: 'nl', japanese: 'ja', korean: 'ko', chinese: 'zh', vietnamese: 'vi', thai: 'th', filipino: 'tl', swahili: 'sw', pidgin: 'pcm', yoruba: 'yo', hausa: 'ha', urdu: 'ur', english: 'en' };
function rulePlan(message, ctx) {
  const m = ' ' + String(message || '').toLowerCase() + ' ';
  const quoted = (String(message || '').match(/["“]([^"”]{1,60})["”]/) || [])[1]; // on-screen text keeps the customer's capitals
  const out = [];
  const n = (x) => Number(String(x).replace(',', '.'));
  let r;
  if ((r = m.match(/(?:cut|remove|drop|delete|trim)(?: off)? the (first|last) (\d+(?:[.,]\d+)?) ?s(?:ec(?:ond)?s?)?/))) out.push(r[1] === 'first' ? { op: 'trim', start: n(r[2]), end: ctx.duration } : { op: 'trim', start: 0, end: ctx.duration - n(r[2]) });
  else if ((r = m.match(/(?:cut|remove|delete)\s+(?:from\s+)?(\d+(?:[.,]\d+)?)\s*s?\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?)\s*s?/))) out.push({ op: 'cut', start: n(r[1]), end: n(r[2]) });
  const langIn = (re) => { const x = m.match(re); return x ? LANG_WORDS[x[x.length - 1]] : null; };
  const LW = Object.keys(LANG_WORDS).join('|');
  const capLang = langIn(new RegExp(`(?:captions|subtitles)[^.,;]*?(?:in|into|to) (${LW})`));
  const dubLang = langIn(new RegExp(`(?:dub|translate|voice)[^.,;]*?(?:in|into|to) (${LW})`));
  if (capLang && !(dubLang && new RegExp(`(?:dub|translate)[^.,;]*?(?:captions|subtitles)`).test(m))) out.push({ op: 'captions_language', language: capLang });
  if (/caption|subtitle/.test(m) && !capLang) {
    const c = { op: 'captions' };
    if (/(no|remove|turn off|hide|without) (the )?(captions|subtitles)|captions off/.test(m)) c.on = false;
    else {
      c.on = true;
      if (/bigger|larger|huge|large/.test(m)) c.size = /huge|much bigger/.test(m) ? 'huge' : 'large';
      if (/smaller|small/.test(m)) c.size = 'small';
      for (const p of POS) if (new RegExp(`(at|on|to) the ${p}|${p} of`).test(m)) c.position = p;
      for (const s of STYLES) if (m.includes(' ' + s + ' ')) c.style = s;
    }
    out.push(c);
  }
  if ((r = m.match(/(?:remake|re-make|redo|regenerate|re-do|reshoot|re-shoot) (?:the )?scene (\d+)/))) out.push({ op: 'regenerate_scene', scene: Number(r[1]), new_actor: /(new|different|another) (actor|person|presenter|creator|face)/.test(m) });
  if (dubLang && dubLang !== capLang) out.push({ op: 'translate', language: dubLang });
  if ((r = m.match(/(\d+|five|ten|three) (?:new |more |different )?(?:hooks|openings|intros)/))) out.push({ op: 'hook_variants', count: { five: 5, ten: 10, three: 3 }[r[1]] || Number(r[1]) });
  if (/\b(square|1:1)\b/.test(m)) out.push({ op: 'reframe', aspect: '1:1' }); else if (/(landscape|16:9|horizontal)/.test(m)) out.push({ op: 'reframe', aspect: '16:9' }); else if (/(4:5|portrait feed)/.test(m)) out.push({ op: 'reframe', aspect: '4:5' });
  if ((r = m.match(/(\d(?:\.\d+)?)x (?:speed|faster)|speed (?:it )?up|faster/))) out.push({ op: 'speed', factor: r && r[1] ? n(r[1]) : 1.25 });
  if (/(remove|no|turn off|mute) (the )?music/.test(m)) out.push({ op: 'music', action: 'remove' });
  else if (/music (louder|up)|louder music/.test(m)) out.push({ op: 'music', action: 'volume', volume: 0.6 });
  else if (/music (quieter|lower|down|softer)|quieter music|lower the music/.test(m)) out.push({ op: 'music', action: 'volume', volume: 0.15 });
  else if (/(different|new|other|change the) music|add (some )?music|add a beat/.test(m)) out.push({ op: 'music', action: 'swap', source: /brand/.test(m) ? 'brand' : 'beat' });
  if ((r = m.match(/end card (?:that says |saying |with )?["“](.+?)["”]/)) || /add (an )?end card/.test(m)) out.push({ op: 'end_card', cta: r ? (quoted || r[1]) : 'Shop now', on: true });
  if ((r = m.match(/(?:add|put) (?:the )?text ["“](.+?)["”]/))) out.push({ op: 'overlay', text: quoted || r[1], start: 0, end: Math.min(ctx.duration, 3), position: 'top' });
  if (/(ai[- ]generated|ai) (label|note|tag)/.test(m)) out.push({ op: 'ai_label', on: !/(remove|no|without|off)/.test(m) });
  if (/(add|put) (my |the )?logo/.test(m)) out.push({ op: 'logo', on: true, corner: /left/.test(m) ? (/bottom/.test(m) ? 'bottom-left' : 'top-left') : /bottom/.test(m) ? 'bottom-right' : 'top-right' });
  if (/background/.test(m)) { const col = m.match(/#([0-9a-f]{6})/) ? '#' + m.match(/#([0-9a-f]{6})/)[1].toUpperCase() : null; out.push(col ? { op: 'change_background', kind: 'color', color: col } : { op: 'change_background', kind: 'ai', prompt: message.replace(/.*background (to |into |with )?/i, '').slice(0, 200) || 'bright modern studio' }); }
  if (/(new|different|another) voice|(male|female) voice/.test(m)) out.push({ op: 'new_voice', voice: /female|woman/.test(m) ? 'female_warm' : /male|man/.test(m) ? 'male_calm' : 'female_energetic' });
  if (out.length) return { type: 'plan', ops: out };
  if (/(better|nicer|improve|fix it|make it pop|more engaging|change it|edit it)/.test(m)) return { type: 'question', question: 'What should change first: the start, the captions, the music or one of the scenes?' };
  return { type: 'unsupported', message: 'I cannot do that edit yet.', closest: 'I can cut or re-order parts, restyle captions, swap music, add text or an end card, re-make one scene, change the background or dub it.' };
}

// The AI's answer is advice. Only known operations with clean values survive; models and levels are dropped.
function validate(raw, ctx) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!o) return { type: 'unsupported', message: 'I could not understand that request.', closest: 'Try one change at a time, like "cut the first 2 seconds" or "captions bigger".', notes: ['planner answer was not an object'] };
  if (o.type === 'question') return { type: 'question', question: str(o.question).slice(0, 200) || 'What would you like to change?' };
  if (o.type === 'unsupported') return { type: 'unsupported', message: str(o.message).slice(0, 200) || 'That edit is not possible yet.', closest: str(o.closest).slice(0, 240) };
  const ok = supported(ctx), D = ctx.duration, notes = [];
  const out = [];
  for (const x of (Array.isArray(o.ops) ? o.ops : []).slice(0, 8)) {
    if (!x || typeof x !== 'object') continue;
    const op = str(x.op);
    if (!OPS[op]) { notes.push('dropped unknown op ' + op.slice(0, 30)); continue; }
    if (!ok.includes(op)) { notes.push(op + ' is not available for this video'); continue; }
    if ('model' in x || 'level' in x || 'provider' in x) notes.push('ignored a model/level the planner tried to pick');
    const c = { op };
    const t = (v) => Math.max(0, Math.min(D, num(v)));
    if (op === 'trim' || op === 'cut' || op === 'overlay') {
      c.start = t(x.start); c.end = t(x.end);
      if (!(c.end > c.start + 0.2) || !Number.isFinite(c.start)) { notes.push('dropped ' + op + ' with bad times'); continue; }
      if (op === 'cut' && c.end - c.start > D - 1) { notes.push('dropped a cut that removed the whole video'); continue; }
      if (op === 'overlay') { c.text = str(x.text).replace(/[\u0000-\u001f]/g, ' ').slice(0, 60); c.position = POS.includes(x.position) ? x.position : 'top'; if (!c.text) continue; }
    } else if (op === 'reorder') {
      const order = (Array.isArray(x.order) ? x.order : []).map((v) => Math.round(num(v)) - 1);
      if (order.length !== ctx.scenes.length || new Set(order).size !== order.length || order.some((v) => !(v >= 0 && v < ctx.scenes.length))) { notes.push('dropped a re-order that did not list every scene once'); continue; }
      c.order = order;
    } else if (op === 'speed') { c.factor = Math.round(Math.max(0.5, Math.min(2, num(x.factor) || 1)) * 100) / 100; if (c.factor === 1) continue; }
    else if (op === 'reframe') { if (!ASPECTS.includes(x.aspect) || x.aspect === ctx.aspect) continue; c.aspect = x.aspect; }
    else if (op === 'captions') {
      c.on = x.on !== false;
      if (STYLES.includes(x.style)) c.style = x.style;
      if (SIZES.includes(x.size)) c.size = x.size;
      if (POS.includes(x.position)) c.position = x.position;
    } else if (op === 'music') {
      c.action = ['swap', 'volume', 'remove'].includes(x.action) ? x.action : 'swap';
      if (c.action !== 'swap' && !ctx.has_stems) { notes.push('music is mixed into the original'); continue; }
      if (c.action === 'volume') c.volume = Math.round(Math.max(0, Math.min(1.5, num(x.volume) || 0.35)) * 100) / 100;
      if (c.action === 'swap') c.source = ['beat', 'library', 'brand'].includes(x.source) ? x.source : 'beat';
      if (c.source === 'library' && !(require('./settings').getSetting('music_library') || []).length) c.source = 'beat';
      if (c.source === 'brand') { c.track_id = Number(x.track_id) || 0; }
    } else if (op === 'end_card') { c.on = x.on !== false; c.cta = str(x.cta).replace(/[\u0000-\u001f]/g, ' ').slice(0, 30) || 'Shop now'; }
    else if (op === 'logo') { c.on = x.on !== false; c.corner = CORNERS.includes(x.corner) ? x.corner : 'top-right'; }
    else if (op === 'ai_label') c.on = x.on !== false;
    else if (op === 'regenerate_scene') {
      const k = Math.round(num(x.scene)) - 1;
      if (!(k >= 0 && k < ctx.scenes.length)) { notes.push('dropped a scene number that does not exist'); continue; }
      c.scene = k; c.direction = str(x.direction).slice(0, 300);
      if (x.actor_id) c.actor_id = str(x.actor_id).slice(0, 20);
      else if (x.new_actor || x.actor_desc) c.actor_desc = str(x.actor_desc).slice(0, 200) || 'a different friendly creator, natural light';
      if (c.actor_desc) { const why = require('./actors').realPersonReason(c.actor_desc, c.direction); if (why) return { type: 'unsupported', message: why, closest: 'Describe a new, fictional person, or pick one of your actors.' }; }
    } else if (op === 'new_voice') { const v = require('./actors').voiceList().map((z) => z.key); c.voice = v.includes(x.voice) ? x.voice : v[0]; }
    else if (op === 'translate' || op === 'captions_language') { if (!LANGS()[x.language] || x.language === ctx.language) { notes.push('dropped an unknown language'); continue; } c.language = x.language; }
    else if (op === 'change_background') {
      c.kind = ['color', 'ai', 'stock'].includes(x.kind) ? x.kind : 'color';
      if (c.kind === 'color') c.color = /^#?[0-9a-f]{6}$/i.test(str(x.color)) ? '#' + str(x.color).replace('#', '').toUpperCase() : '#1E4DFF';
      if (c.kind === 'ai') { c.prompt = str(x.prompt).slice(0, 300); if (c.prompt.length < 3) c.prompt = 'bright modern studio'; }
      if (c.kind === 'stock') c.query = str(x.query).slice(0, 80) || 'modern office';
    } else if (op === 'hook_variants') { c.count = Math.max(1, Math.min(10, Math.round(num(x.count)) || 3)); }
    out.push(c);
  }
  if (!out.length) return { type: 'unsupported', message: notes.length ? 'That edit is not possible on this video yet.' : 'I could not find an edit in that message.', closest: 'I can cut or re-order parts, restyle captions, swap music, add text or an end card' + (ok.includes('regenerate_scene') ? ', re-make one scene' : '') + (ok.includes('translate') ? ', or dub it' : '') + '.', notes };
  return { type: 'plan', ops: out, note: str(o.note).slice(0, 200), notes };
}

// ---------- Pricing ----------
// Child job inputs for generation ops, priced exactly as jobs.create will charge them.
function levelFor(vt, parentLevel) {
  if (!levels.hasLevels(vt)) return null;
  const av = levels.available(vt);
  if (!av.length) return null; // demo: type price
  const want = parentLevel || 'standard';
  const exact = av.find((l) => l.id === want);
  if (exact) return exact.id;
  // Never above the video's level: the best level at or below it.
  const lower = av.filter((l) => levels.RANK[l.id] <= levels.RANK[want]).sort((a, b) => levels.RANK[b.id] - levels.RANK[a.id])[0];
  return lower ? lower.id : false;
}
function childSpec(op, ctx, user) {
  const i = ctx.root_input || {};
  const base = { product: i.product || 'my product', language: ctx.language, niche: i.niche, audience: i.audience };
  if (op.op === 'regenerate_scene') {
    const vt = ctx.vt;
    if (!vt) return { error: 'This video cannot re-make single scenes yet.' };
    const s = ctx.scenes[op.scene];
    const len = Math.max(vt.min_seconds || 1, Math.ceil(s.end - s.start));
    const lv = levelFor(vt, ctx.level);
    if (lv === false) return { error: `${vt.name} at your video's quality is not available right now.` };
    const input = { ...base, video_type: vt.id, duration: len, level: lv || undefined, aspect: ctx.aspect, style: i.style, image_url: i.image_url, direction: [i.direction, op.direction].filter(Boolean).join('. ') || undefined, presenter: i.presenter, voice: i.voice, voice_tier: i.voice_tier };
    if (ctx.pipeline === 'ugc') { input.script = s.text || ctx.script.split(/\s+/).slice(0, Math.round(len * 2.4)).join(' '); input.write_script = false; }
    if (op.actor_id) input.actor_id = op.actor_id;
    else if (op.actor_desc) input.presenter_desc = op.actor_desc;
    else if (i.actor_id) input.actor_id = i.actor_id;
    return { input, trim: s.end - s.start };
  }
  if (op.op === 'new_voice' || op.op === 'translate') {
    const vt = videotypes.forPipeline('dub');
    return { input: { ...base, video_type: vt.id, video_url: absUrl(ctx.master_url), script: ctx.script || 'Hello', language: op.op === 'translate' ? op.language : ctx.language, source_language: ctx.language, voice: op.voice, presenter: i.presenter, duration: Math.ceil(ctx.duration) } };
  }
  if (op.op === 'change_background') {
    const vt = videotypes.forPipeline('bg_swap');
    if (ctx.duration > 120) return { error: 'Background changes work on videos up to 2 minutes.' };
    return { input: { video_type: vt.id, duration: Math.ceil(ctx.duration), bg_kind: op.kind, bg_color: op.color, bg_prompt: op.prompt, bg_query: op.query, aspect: 'original' }, needs_upload: true };
  }
  if (op.op === 'hook_variants') {
    const vt = videotypes.forPipeline('hook_remix');
    const lv = levelFor(vt, ctx.level);
    if (lv === false) return { error: 'New hooks at your video\'s quality are not available right now.' };
    return { input: { ...base, video_type: vt.id, count: op.count, duration: 4, video_url: absUrl(ctx.url), level: lv || undefined, actor_id: i.actor_id } };
  }
  return null;
}
function priceChild(spec, user) {
  const plan = credits.activePlan(user);
  const vt = videotypes.byId(spec.input.video_type);
  if (!vt) return { error: 'That edit is not available right now.' };
  const locked = videotypes.lockedReason(vt, plan);
  if (locked) return { error: locked };
  if (vt.pipeline === 'hook_remix') spec.input.count = Math.min(spec.input.count, credits.maxHooks(vt));
  const q = credits.quoteFull('video_type', spec.input, user);
  return { credits: q.credits, provider_cost_usd: q.provider_cost_usd, margin_pct: q.margin_pct, level: q.level || null, bulk_pct: q.bulk_pct || 0 };
}
function captionsLanguageCredits() {
  const guard = require('./guard');
  const list = Math.max(1, Number((require('./settings').pricing().costs || {}).captions_translate) || 2);
  const e = guard.evaluate(list, guard.providerCost({ type: 'script', units: 1 }));
  return Math.max(list, e.safeCredits);
}
// Caption timing from the real speech: when a speech-to-text provider is set up (ElevenLabs Scribe, fal Whisper…), captions
// on a version whose words are only an even-timed estimate are timed from a transcript. Priced like any step (guard minimum,
// at least 1 credit). Without a provider (or in demo mode) captions keep the even timing, free.
const sttLive = () => require('./providers').chain('stt').some((p) => p.adapter !== 'mock');
function sttCredits(seconds) {
  const guard = require('./guard');
  const cost = guard.maxRowCost('stt', { seconds }, () => 0);
  const e = guard.evaluate(1, cost);
  return Math.max(1, e.safeCredits);
}
function needsTranscript(plan, ctx) {
  const caps = plan.ops.some((o) => o.op === 'captions' && o.on !== false) || (ctx.look.captions && ctx.look.captions.on !== false && plan.ops.some((o) => ['trim', 'cut', 'reorder', 'speed'].includes(o.op)));
  return caps && ctx.words_source !== 'transcript' && !plan.ops.some((o) => ['new_voice', 'translate', 'captions_language', 'regenerate_scene'].includes(o.op)) && sttLive();
}
function price(plan, ctx, user) {
  const items = [];
  let total = 0, editCredits = 0;
  plan.ops.forEach((op, k) => {
    const def = OPS[op.op];
    if (def.local) { items.push({ k, op: op.op, label: def.label(op), credits: 0, kind: 'local' }); return; }
    if (op.op === 'captions_language') { const c = captionsLanguageCredits(); editCredits += c; total += c; items.push({ k, op: op.op, label: def.label(op), credits: c, kind: 'text' }); return; }
    const spec = childSpec(op, ctx, user);
    if (!spec || spec.error) { items.push({ k, op: op.op, label: def.label(op), credits: null, error: spec ? spec.error : 'Not available.' }); return; }
    const p = priceChild(spec, user);
    if (p.error) { items.push({ k, op: op.op, label: def.label(op), credits: null, error: p.error }); return; }
    total += p.credits;
    items.push({ k, op: op.op, label: def.label(op), credits: p.credits, kind: def.separate ? 'separate' : 'generate', level: p.level, bulk_pct: p.bulk_pct || undefined });
  });
  if (needsTranscript(plan, ctx)) { const c = sttCredits(ctx.duration); editCredits += c; total += c; items.push({ k: -1, op: 'captions_timing', label: 'Time the captions to the real speech', credits: c, kind: 'text' }); }
  const blocked = items.filter((x) => x.error);
  const summary = items.map((x) => `${x.label}: ${x.error ? 'not available' : x.credits + ' credits'}`).join(' · ');
  return { items, total, edit_credits: editCredits, blocked: blocked.length > 0, summary };
}

// ---------- Plan (a chat message) ----------
function history(rootId) { return all("SELECT role, text FROM chat_edit_messages WHERE root_id = ? ORDER BY id DESC LIMIT 6", rootId).reverse(); }
function addMsg(root, user, role, text, extra = {}) {
  const info = run('INSERT INTO chat_edit_messages(root_id, user_id, role, text, kind, plan, status, credits, base_job_id) VALUES(?,?,?,?,?,?,?,?,?)', root, user.id, role, String(text).slice(0, 2000), extra.kind || null, extra.plan ? JSON.stringify(extra.plan) : null, extra.status || null, extra.credits || 0, extra.base || null);
  return Number(info.lastInsertRowid);
}
const msgView = (m) => ({ id: m.id, role: m.role, text: m.text, kind: m.kind, status: m.status, credits: m.credits, plan: J(m.plan, null), edit_job_id: m.edit_job_id, child_job_ids: J(m.child_job_ids, []), created_at: m.created_at });

async function planMessage(user, jobId, message, { llm = null } = {}) {
  const text = str(message).slice(0, 600);
  if (text.length < 2) fail(400, 'Type what you want to change.');
  const job = ownedJob(user, jobId);
  const root = rootOf(job);
  const cur = get('SELECT * FROM jobs WHERE id = ?', currentFor(root));
  const ctx = context(cur);
  const hist = history(root);
  const input = plannerInput(ctx, text, hist);
  const providers = require('./providers');
  // Demo mode (no text AI key): the rule planner answers, metered and limited the same way at $0.
  const runner = llm || (providers.isDemo('text') ? async () => ({ text: JSON.stringify(rulePlan(text, ctx)), adapter: 'mock', model: 'rules' }) : null);
  const bill = require('./llmbill');
  const r = await bill.call(user, 'chat_edit', input, { llm: runner, ref: 'chat:' + root });
  const raw = require('./jobs').parseJsonLoose(r.text, null);
  const v = validate(raw, ctx);
  addMsg(root, user, 'user', text, { base: ctx.version_job_id, credits: r.credits });
  let reply, extra;
  if (v.type === 'plan') {
    const p = price(v, ctx, user);
    reply = p.blocked ? 'Part of this cannot be done yet: ' + p.items.filter((x) => x.error).map((x) => `${x.label} (${x.error})`).join('; ') + '. Remove that part and ask again.' : (v.note || 'Here is the plan. Check the price, then confirm.');
    extra = { kind: 'plan', plan: { ops: v.ops, ...p, base_job_id: ctx.version_job_id, notes: v.notes }, status: p.blocked ? 'blocked' : 'proposed', credits: p.total, base: ctx.version_job_id };
  } else if (v.type === 'question') { reply = v.question; extra = { kind: 'question', status: 'question' }; }
  else { reply = v.message + (v.closest ? ' ' + v.closest : ''); extra = { kind: 'unsupported', status: 'unsupported' }; }
  const id = addMsg(root, user, 'assistant', reply, extra);
  return { message: msgView(get('SELECT * FROM chat_edit_messages WHERE id = ?', id)), fee_credits: r.credits, free: r.free, allowance: bill.allowance(get('SELECT * FROM users WHERE id = ?', user.id), 'chat_edit'), balance: credits.balance(user.id) };
}

// "Add the AI-generated label" from the export area: a ready plan (no planner call, no fee), confirmed like any other.
function labelPlan(user, jobId, on = true) {
  const job = ownedJob(user, jobId);
  const root = rootOf(job);
  const ctx = context(get('SELECT * FROM jobs WHERE id = ?', currentFor(root)));
  const v = { type: 'plan', ops: [{ op: 'ai_label', on: on !== false }] };
  const p = price(v, ctx, user);
  addMsg(root, user, 'user', on !== false ? 'Add the "AI-generated" label' : 'Remove the "AI-generated" label', { base: ctx.version_job_id });
  const id = addMsg(root, user, 'assistant', 'Here is the plan. Check the price, then confirm.', { kind: 'plan', plan: { ops: v.ops, ...p, base_job_id: ctx.version_job_id, notes: [] }, status: 'proposed', credits: 0, base: ctx.version_job_id });
  return { message: msgView(get('SELECT * FROM chat_edit_messages WHERE id = ?', id)) };
}

// ---------- Confirm ----------
// Re-prices the plan (prices or the video may have changed), checks the balance for the whole plan, then creates the child
// jobs (each charged by jobs.create) and the edit job (charged only for captions translation). Any failure refunds what
// was already created.
async function confirm(user, jobId, msgId) {
  const job = ownedJob(user, jobId);
  const root = rootOf(job);
  const m = get("SELECT * FROM chat_edit_messages WHERE id = ? AND root_id = ? AND user_id = ? AND role = 'assistant'", Number(msgId) || 0, root, user.id);
  if (!m || m.kind !== 'plan') fail(404, 'That plan was not found.');
  if (m.status !== 'proposed') fail(409, m.status === 'confirmed' ? 'This plan is already running.' : 'This plan cannot be confirmed.');
  const plan = J(m.plan, {});
  const curId = currentFor(root);
  if (curId !== plan.base_job_id) fail(409, 'The video changed since this plan was made (a newer version or an undo). Ask again so the price matches.');
  const ctx = context(get('SELECT * FROM jobs WHERE id = ?', curId));
  const fresh = price({ ops: plan.ops }, ctx, user);
  if (fresh.blocked) fail(409, 'Part of this plan is not available any more. Ask again.');
  if (fresh.total !== plan.total) {
    run("UPDATE chat_edit_messages SET plan = ?, credits = ? WHERE id = ?", JSON.stringify({ ...plan, ...fresh }), fresh.total, m.id);
    fail(409, `The price changed to ${fresh.total} credits. Check it and confirm again.`, { plan: { ...plan, ...fresh } });
  }
  const bal = credits.balance(user.id);
  const usable = bal.plan + bal.topup; // edits that render need paid credits, like every video
  if (fresh.total > 0 && usable < fresh.total) fail(402, `This needs ${fresh.total} credits and you have ${usable}. Top up or upgrade your plan to continue.`, { needed: fresh.total, have: usable });
  // Claim the plan first so two taps never run it twice.
  if (!run("UPDATE chat_edit_messages SET status = 'confirmed' WHERE id = ? AND status = 'proposed'", m.id).changes) fail(409, 'This plan is already running.');
  const jobs = require('./jobs');
  const children = [];
  try {
    for (let k = 0; k < plan.ops.length; k++) {
      const op = plan.ops[k];
      if (!OPS[op.op].gen || op.op === 'captions_language') continue;
      const spec = childSpec(op, ctx, user);
      if (spec.needs_upload) spec.input.upload_id = await masterUpload(user, ctx);
      const cj = jobs.create(get('SELECT * FROM users WHERE id = ?', user.id), 'video_type', spec.input);
      children.push({ k, op: op.op, job_id: cj.id, separate: !!OPS[op.op].separate, trim: spec.trim || null });
    }
    const needsEdit = plan.ops.some((o) => !OPS[o.op].separate);
    let editId = null;
    if (needsEdit) {
      const info = run("INSERT INTO jobs(user_id, type, status, step, input, credits, demo) VALUES(?,?,?,?,?,?,?)", user.id, 'edit', 'queued', 'start',
        JSON.stringify({ root_id: root, parent_id: curId, ops: plan.ops, children, message_id: m.id, transcribe: fresh.items.some((x) => x.op === 'captions_timing'), timing_credits: (fresh.items.find((x) => x.op === 'captions_timing') || {}).credits || 0, product: ctx.root_input.product, video_type: ctx.video_type, level: ctx.level, level_name: ctx.level_name, edit_summary: fresh.items.filter((x) => x.kind !== 'separate').map((x) => x.label).join(' · ') }),
        fresh.edit_credits, ctx.job.demo ? 1 : 0);
      editId = Number(info.lastInsertRowid);
      if (fresh.edit_credits > 0) {
        try { const take = credits.spend(user.id, fresh.edit_credits, 'edit job', 'job:' + editId, { allowTrial: false }); run('UPDATE jobs SET state = ? WHERE id = ?', JSON.stringify({ take }), editId); }
        catch (e) { run('DELETE FROM jobs WHERE id = ?', editId); editId = null; throw e; }
      }
    }
    run('UPDATE chat_edit_messages SET edit_job_id = ?, child_job_ids = ? WHERE id = ?', editId, JSON.stringify(children.map((c) => c.job_id)), m.id);
    jobs.kick();
    return { edit_job_id: editId, children: children.map((c) => ({ op: c.op, job_id: c.job_id, separate: c.separate })), charged: fresh.total, balance: credits.balance(user.id) };
  } catch (e) {
    for (const c of children) { const cj = get('SELECT * FROM jobs WHERE id = ?', c.job_id); if (cj) jobs.failJob(cj, 'The edit could not start, so this part was cancelled and refunded.'); }
    run("UPDATE chat_edit_messages SET status = 'proposed' WHERE id = ?", m.id);
    throw e;
  }
}
// "Change background" works on an upload: the current version is registered as a private upload of the customer.
async function masterUpload(user, ctx) {
  const uploads = require('./uploads');
  const stitch = require('./stitch');
  return stitch.withTmpDir(async (dir) => {
    const f = await stitch.localFile(ctx.master_url, dir, user.id);
    const up = uploads.saveLocal(user.id, f, 'video/mp4', 'bg_swap');
    const pr = stitch.probe(f);
    run('UPDATE user_uploads SET duration = ?, has_audio = ?, name = ? WHERE id = ?', pr.duration || ctx.duration, pr.audio ? 1 : 0, 'Version for chat edit', up.id);
    return up.id;
  });
}

// ---------- The edit job ----------
async function advance(job, { st, i, runStep, save, done, background }) {
  // 1. Wait for the generation parts.
  const kids = (i.children || []).filter((c) => !c.separate);
  st.kids = st.kids || {};
  for (const c of kids) {
    if (st.kids[c.k]) continue;
    const cj = get('SELECT status, error, output FROM jobs WHERE id = ?', c.job_id);
    if (!cj) throw new Error('A part of this edit is missing.');
    if (cj.status === 'failed') throw new Error(`"${OPS[c.op].label(i.ops[c.k])}" failed (${String(cj.error || '').slice(0, 120)}). Its credits were refunded. The other finished parts are in your Library.`);
    if (cj.status !== 'done') { st.progress = 0.1; return save({ step: 'Waiting for new parts' }); }
    const out = J(cj.output, {});
    if (!out.url) throw new Error(`"${OPS[c.op].label(i.ops[c.k])}" finished without a single video, so it cannot be spliced in.`);
    st.kids[c.k] = { url: out.url, script: out.script_translated || out.script || null };
  }
  const parent = get('SELECT * FROM jobs WHERE id = ?', i.parent_id);
  const ctx = context(parent);
  // 2. Captions in another language: one text call (priced on this job).
  const cl = i.ops.find((o) => o.op === 'captions_language');
  if (cl && !st.captionText) {
    const r = await runStep(job, st, 'captions_tr', 'text', { mode: 'translate', text: ctx.script, language: cl.language, system: 'You translate short video ad captions. Keep meaning and length.', prompt: `Translate into ${LANGS()[cl.language]}. Return ONLY JSON: {"text": "..."}\n"""${ctx.script}"""`, max_tokens: 1500 });
    if (!r) return save({ step: 'Translating captions' });
    const o = require('./jobs').parseJsonLoose(r.text, null);
    st.captionText = str(o && o.text ? o.text : r.text) || ctx.script;
  }
  const stitch = require('./stitch');
  if (!stitch.available()) throw new Error('Editing needs ffmpeg on the server. Nothing was charged for the local edits.');
  // 3. Transcript for caption timing (paid on this job). If the provider fails, captions fall back to even timing and the
  //    timing credits go back to the customer.
  if (i.transcribe && !st.transcript) {
    const uploads = require('./uploads');
    if (!st.sttAudio) {
      const r = background(job, 'stt_audio', () => stitch.withTmpDir(async (dir) => { const f = require('node:path').join(dir, 'speech.mp3'); await require('./editkit').extractAudio(await stitch.localFile(ctx.master_url, dir, job.user_id), f); return uploads.saveLocal(job.user_id, f, 'audio/mpeg').id; }));
      if (r.pending) { st.progress = 0.2; return save({ step: 'Listening' }); }
      if (r.error) st.sttAudio = 'none'; else st.sttAudio = r.result;
    }
    let words = null;
    if (st.sttAudio !== 'none') {
      try {
        const au = uploads.byId(st.sttAudio);
        const r = au ? await runStep(job, st, 'stt', 'stt', { audio_url: uploads.signedUrl(au), audio_path: uploads.filePath(au), duration: ctx.duration, language: ctx.language !== 'en' ? ctx.language : undefined }) : { words: [] };
        if (!r) { st.progress = 0.3; return save({ step: 'Listening' }); }
        words = require('./editkit').cleanWords(r.words, ctx.duration);
      } catch (e) { console.warn('[chatedit] transcript', job.id, e.message); words = null; }
    }
    if (!words || !words.length) {
      st.transcript = { words: [], failed: true };
      if (i.timing_credits && !st.timingRefunded) { credits.grant(job.user_id, i.timing_credits, 'topup', 'Refund: caption timing could not use the speech', 'job:' + job.id); st.timingRefunded = true; }
    } else st.transcript = { words };
  }
  // 4. Build the new master and look with ffmpeg.
  const user = get('SELECT * FROM users WHERE id = ?', job.user_id);
  const r = background(job, 'build', () => build({ job, i, ctx, kids: st.kids, captionText: st.captionText, user, transcript: st.transcript && st.transcript.words }));
  if (r.pending) { st.progress = Math.max(st.progress || 0, 0.6); return save({ step: 'Editing' }); }
  if (r.error) throw new Error('We could not make this edit: ' + String(r.error.message).slice(0, 200));
  const n = 2 + Number(get("SELECT COUNT(*) AS n FROM jobs WHERE type = 'edit' AND status = 'done' AND json_extract(input, '$.root_id') = ?", i.root_id).n); // the original is version 1
  run('INSERT INTO video_versions(root_id, current_job_id, updated_at) VALUES(?,?,?) ON CONFLICT(root_id) DO UPDATE SET current_job_id = excluded.current_job_id, updated_at = excluded.updated_at', i.root_id, job.id, new Date().toISOString());
  return done({ ...r.result, version: n, root_id: i.root_id, parent_id: i.parent_id, summary: i.edit_summary, ai_label: ctx.root_input.ai_label !== false });
}

async function build({ job, i, ctx, kids, captionText, user, transcript = null }) {
  const stitch = require('./stitch');
  const media = require('./media');
  const fs = require('node:fs');
  const path = require('node:path');
  return stitch.withTmpDir(async (dir) => {
    let master = await ops.withAudio(await stitch.localFile(ctx.master_url, dir, job.user_id), dir);
    let D = stitch.probe(master).duration || ctx.duration;
    const timed = !!(transcript && transcript.length) || ctx.words_source === 'transcript';
    let words = (transcript && transcript.length ? transcript : ctx.words).slice(), scenes = ctx.scenes.slice(), aspect = ctx.aspect, script = ctx.script;
    let wordsSource = timed ? 'transcript' : 'estimate';
    const look = JSON.parse(JSON.stringify(ctx.look || {}));
    let n = 0;
    const tmp = () => path.join(dir, `m${n++}.mp4`);
    for (let k = 0; k < i.ops.length; k++) {
      const op = i.ops[k];
      if (['new_voice', 'translate', 'change_background'].includes(op.op)) {
        master = await ops.withAudio(await stitch.localFile(kids[k].url, dir, job.user_id), dir);
        D = stitch.probe(master).duration || D;
        if (op.op === 'translate' && kids[k].script) { script = kids[k].script; words = ops.wordsFromScript(script, D); }
        wordsSource = 'estimate';
      } else if (op.op === 'regenerate_scene') {
        const s = scenes[op.scene] || scenes[0];
        const clip = await ops.withAudio(await stitch.localFile(kids[k].url, dir, job.user_id), dir);
        master = await ops.splice(master, clip, s.start, s.end, tmp());
        wordsSource = 'estimate';
      } else if (op.op === 'trim' || op.op === 'cut' || op.op === 'reorder') {
        const ranges = op.op === 'trim' ? ops.trimRanges(D, op.start, op.end) : op.op === 'cut' ? ops.cutRanges(D, op.start, op.end) : ops.reorderRanges(scenes, op.order);
        master = await ops.keep(master, ranges, tmp());
        words = ops.mapWords(words, ranges); scenes = ops.mapScenes(scenes, ranges); D = ops.lengthOf(ranges);
      } else if (op.op === 'speed') {
        master = await ops.speed(master, op.factor, tmp());
        words = ops.scaleTimes(words, op.factor); scenes = ops.scaleTimes(scenes, op.factor); D = Math.round((D / op.factor) * 1000) / 1000;
      } else if (op.op === 'reframe') { master = await ops.reframe(master, op.aspect, tmp()); aspect = op.aspect; }
      else if (op.op === 'captions') look.captions = op.on === false ? { on: false } : { ...(look.captions && look.captions.on !== false ? look.captions : { style: 'bold', size: 'medium', position: 'bottom' }), ...op, on: true, op: undefined };
      else if (op.op === 'captions_language') { look.captions = { style: 'bold', size: 'medium', position: 'bottom', ...(look.captions || {}), on: true }; words = ops.wordsFromScript(captionText, D); look.captions_language = op.language; wordsSource = 'estimate'; }
      else if (op.op === 'music') {
        if (op.action === 'remove') look.music = { on: false };
        else if (op.action === 'volume') look.music = { ...(look.music || { source: 'beat' }), on: true, volume: op.volume };
        else look.music = { on: true, source: op.source, track_id: op.track_id, volume: (look.music && look.music.volume) || 0.35 };
      } else if (op.op === 'overlay') (look.overlays = look.overlays || []).push({ text: op.text, start: op.start, end: op.end, position: op.position });
      else if (op.op === 'end_card') look.end_card = { on: op.on !== false, cta: op.cta };
      else if (op.op === 'logo') look.logo = { on: op.on !== false, corner: op.corner };
      else if (op.op === 'ai_label') look.ai_label = op.on !== false;
    }
    // Overlays and scenes outside the new length are dropped.
    if (look.overlays) look.overlays = look.overlays.filter((o) => o.start < D).map((o) => ({ ...o, end: Math.min(o.end, D) }));
    // Music file for the look.
    let musicFile = null;
    if (look.music && look.music.on !== false) {
      if (look.music.source === 'brand') { const t = require('./videotools').ownTrack(look.music.track_id, job.user_id); if (t) musicFile = await stitch.localFile(t.url, dir, job.user_id); }
      else if (look.music.source === 'library') { const lib = require('./settings').getSetting('music_library') || []; if (lib.length) musicFile = await stitch.localFile(lib[0].url, dir, job.user_id); }
      else if (look.music.url) musicFile = await stitch.localFile(look.music.url, dir, job.user_id);
      if (!musicFile) { musicFile = ops.beatFile(dir, D); look.music.source = 'beat'; }
      const saved = media.save(fs.readFileSync(musicFile), /\.wav$/.test(musicFile) ? 'audio/wav' : 'audio/mpeg', job.user_id);
      look.music.url = saved.path;
    }
    let logoFile = null;
    const brand = J(user.brand, {}) || {};
    if (brand.ai_label_auto && look.ai_label === undefined) look.ai_label = true; // Brand kit: label every edit automatically
    const logoUrl = (ctx.root_input && ctx.root_input.logo_url) || brand.logo_url;
    if ((look.logo && look.logo.on) || (look.end_card && look.end_card.on)) { if (logoUrl) { try { logoFile = await stitch.localFile(logoUrl, dir, job.user_id); } catch { logoFile = null; } } }
    const finalFile = path.join(dir, 'final.mp4');
    await ops.finish({ master, look, words, brandColor: brand.color || '#1E4DFF', logoFile, musicFile, dir, out: finalFile });
    // Only a new master is stored again; look-only edits (captions, music, text, logo, end card, label) keep the same one.
    const masterChanged = i.ops.some((o) => MASTER_OPS.includes(o.op));
    const masterSaved = masterChanged ? media.save(fs.readFileSync(master), 'video/mp4', job.user_id) : { path: ctx.master_url };
    const finalSaved = media.save(fs.readFileSync(finalFile), 'video/mp4', job.user_id);
    const srt = words.length ? media.save(Buffer.from(require('./editkit').srtFromWords(words)), 'text/plain', job.user_id).path : null;
    return { url: finalSaved.path, master_url: masterSaved.path, look, words, words_source: wordsSource, scenes, duration: Math.round(stitch.probe(finalFile).duration * 100) / 100 || D, master_duration: D, aspect, script, captions_url: srt, logo_missing: !!((look.logo && look.logo.on) && !logoFile) };
  });
}

// ---------- Versions, compare, undo ----------
function versions(user, jobId) {
  const job = ownedJob(user, jobId);
  const root = rootOf(job);
  const rootJob = get('SELECT * FROM jobs WHERE id = ?', root);
  const cur = currentFor(root);
  const list = [{ version: 1, job_id: root, url: J(rootJob.output, {}).url || null, summary: 'Original', created_at: rootJob.created_at, current: cur === root }];
  for (const e of all("SELECT id, status, output, input, created_at, error FROM jobs WHERE type = 'edit' AND user_id = ? AND json_extract(input, '$.root_id') = ? ORDER BY id", user.id, root)) {
    const out = J(e.output, {}), inp = J(e.input, {});
    if (e.status === 'done') list.push({ version: out.version, job_id: e.id, url: out.url, summary: out.summary || inp.edit_summary, parent_id: inp.parent_id, created_at: e.created_at, current: cur === e.id, duration: out.duration });
    else list.push({ version: null, job_id: e.id, status: e.status, error: e.error, summary: inp.edit_summary, created_at: e.created_at, pending: e.status !== 'failed' });
  }
  const messages = all('SELECT * FROM chat_edit_messages WHERE root_id = ? AND user_id = ? ORDER BY id DESC LIMIT 60', root, user.id).reverse().map(msgView);
  return { root_id: root, current_job_id: cur, versions: list, messages, allowance: require('./llmbill').allowance(get('SELECT * FROM users WHERE id = ?', user.id), 'chat_edit') };
}
function setCurrent(user, jobId, targetId) {
  const job = ownedJob(user, jobId);
  const root = rootOf(job);
  const t = get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', Number(targetId) || 0, user.id);
  if (!t || (t.id !== root && !(t.type === 'edit' && Number(J(t.input, {}).root_id) === root && t.status === 'done'))) fail(400, 'That version was not found.');
  run('INSERT INTO video_versions(root_id, current_job_id, updated_at) VALUES(?,?,?) ON CONFLICT(root_id) DO UPDATE SET current_job_id = excluded.current_job_id, updated_at = excluded.updated_at', root, t.id, new Date().toISOString());
  return versions(user, root);
}
// Undo: back to the version the current one was made from (free, nothing is deleted, redo = pick it again).
function undo(user, jobId) {
  const job = ownedJob(user, jobId);
  const root = rootOf(job);
  const cur = get('SELECT * FROM jobs WHERE id = ?', currentFor(root));
  if (cur.id === root) fail(400, 'This is the original. There is nothing to undo.');
  return setCurrent(user, root, Number(J(cur.input, {}).parent_id) || root);
}

module.exports = { labelPlan, migrate, OPS, MASTER_OPS, context, supported, rulePlan, validate, price, childSpec, levelFor, planMessage, confirm, advance, build, versions, setCurrent, undo, plannerInput };
