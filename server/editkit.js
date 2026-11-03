// ffmpeg toolkit for the editing tools (SPEC §14): Change background (bg_swap) and Auto-edit my video (auto_edit).
// Everything that touches user text goes through files we write ourselves (ASS captions, drawtext textfile), never into the
// command line or the filter string. Long work runs inside jobs.background() with a timeout, a small concurrency limit
// (Railway CPUs are small: FFMPEG_CONCURRENCY, default 1) and a temp folder that is always deleted.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const stitch = require('./stitch');

const BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const THREADS = String(Math.max(1, Number(process.env.FFMPEG_THREADS) || 2));
const MAX_PARALLEL = Math.max(1, Number(process.env.FFMPEG_CONCURRENCY) || 1);
const FONT_DIR = path.join(__dirname, 'assets', 'fonts');

// ---------- Concurrency + exec ----------
let active = 0;
const waiting = [];
async function slot(fn) {
  if (active >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; const n = waiting.shift(); if (n) n(); }
}
function exec(args, timeoutMs = 15 * 60e3) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, ['-hide_banner', '-nostdin', '-y', ...stitch.guardArgs(args)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-6000); });
    const t = setTimeout(() => { p.kill('SIGKILL'); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code, signal) => {
      clearTimeout(t);
      if (code === 0) return resolve(err);
      reject(new Error(signal === 'SIGKILL' ? 'ffmpeg took too long and was stopped.' : 'ffmpeg failed: ' + err.split('\n').filter(Boolean).slice(-3).join(' | ')));
    });
  });
}
async function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-edit-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', THREADS];
const ENC_FAST = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', '-threads', THREADS];

// ---------- Sizes (capped at 1080p) ----------
const ASPECTS = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
function outSize(aspect, src = {}) {
  if (ASPECTS[aspect]) return ASPECTS[aspect];
  // "original": the source shape, never above 1080p on the short side.
  const w = Number(src.width) || 1080, h = Number(src.height) || 1920;
  const k = Math.min(1, 1080 / Math.min(w, h));
  return [even(w * k), even(h * k)];
}
const hex6 = (c, d = 'FF4A1C') => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).replace('#', '').toUpperCase() : d);

// ---------- Audio extraction (for speech-to-text) ----------
function extractAudio(src, out) {
  return slot(() => exec(['-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', out], 5 * 60e3));
}

// Matting models bill per frame and are priced at 60 fps at most: faster footage (slow-motion phones) is re-timed to 60 fps
// and anything above 1080p is scaled down before it is sent. Returns the file to send (the original when nothing changes).
async function prepForMatting(src, info, dir) {
  const tooFast = Number(info.fps) > 60.5, tooBig = Math.min(Number(info.width) || 0, Number(info.height) || 0) > 1080;
  if (!tooFast && !tooBig) return src;
  const out = path.join(dir, 'prep.mp4');
  const vf = [tooFast ? 'fps=60' : null, tooBig ? "scale='if(gt(iw,ih),-2,1080)':'if(gt(iw,ih),1080,-2)'" : null].filter(Boolean).join(',');
  await slot(() => exec(['-i', src, '-vf', vf, ...ENC_FAST, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]));
  return out;
}

// ---------- Change background: composite ----------
// fg: matted foreground (VP9 WebM with alpha), or fg + mask (two H.264 files: colour and alpha). bg: {kind:'color', color} |
// {kind:'image'|'video', file}. src: the original upload (its audio is kept). Writes an mp4 to `out`.
async function compositeBackground({ fg, mask, src, bg, aspect, info, out }) {
  if (!stitch.available()) throw new Error('ffmpeg is not installed');
  const [W, H] = outSize(aspect, info);
  const T = Math.max(0.5, Number(info.duration) || 5).toFixed(2);
  const args = [];
  if (bg.kind === 'image') args.push('-loop', '1', '-t', T, '-i', bg.file);
  else if (bg.kind === 'video') args.push('-stream_loop', '-1', '-t', T, '-i', bg.file);
  else args.push('-f', 'lavfi', '-t', T, '-i', `color=c=0x${hex6(bg.color, '111111')}:s=${W}x${H}:r=30`);
  // libvpx decodes the alpha plane of VP9 WebM (the built-in decoder drops it).
  if (/\.webm$/i.test(fg) && !mask) args.push('-c:v', 'libvpx-vp9');
  args.push('-i', fg);
  let maskIdx = -1;
  if (mask) { args.push('-i', mask); maskIdx = 2; }
  args.push('-i', src);
  const srcIdx = mask ? 3 : 2;
  const parts = [`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p[bg]`];
  if (mask) parts.push(`[2:v]format=gray,scale=${W}:${H}:force_original_aspect_ratio=decrease[m]`, `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,format=yuva420p[c]`, '[c][m]alphamerge[fg0]');
  else parts.push(`[1:v]format=yuva420p,scale=${W}:${H}:force_original_aspect_ratio=decrease[fg0]`);
  // The person stands on the bottom edge, centred; a soft key light breathes slightly so the cut-out does not look pasted.
  parts.push('[bg][fg0]overlay=x=(W-w)/2:y=H-h:shortest=1:format=auto,fps=30,format=yuv420p[v]');
  const hasAudio = info.has_audio !== false;
  const map = ['-map', '[v]', ...(hasAudio ? ['-map', `${srcIdx}:a?`] : [])];
  void maskIdx;
  await slot(() => exec([...args, '-filter_complex', parts.join(';'), ...map, '-t', T, ...ENC, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]));
  return out;
}

// Demo matting (no provider keys): keys out green (#00FF00-ish) with colorkey and writes a VP9 WebM with alpha. On footage
// without a green screen nothing is keyed, which is fine for a demo.
async function mockMatte(src, out) {
  await slot(() => exec(['-i', src, '-t', '120', '-vf', 'colorkey=0x00FF00:0.32:0.12,format=yuva420p', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1500k', '-an', out]));
  return out;
}

// Demo music (no provider keys): a short soft chord loop so brand tracks, previews and the music mix work end to end.
async function mockMusic(seconds, out) {
  const S = Math.max(3, Math.min(180, Number(seconds) || 15));
  await slot(() => exec(['-f', 'lavfi', '-t', String(S), '-i', 'sine=f=220:sample_rate=44100', '-f', 'lavfi', '-t', String(S), '-i', 'sine=f=277.18:sample_rate=44100', '-f', 'lavfi', '-t', String(S), '-i', 'sine=f=329.63:sample_rate=44100',
    '-filter_complex', `[0][1][2]amix=inputs=3,volume=0.6,tremolo=f=2:d=0.5,afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, S - 1.5)}:d=1.5[a]`, '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '128k', out], 60e3));
  return out;
}

// ---------- Auto-edit: transcript → cut list ----------
const FILLERS = /^(u+m+|u+h+|e+r+m*|a+h+|h+m+|m+h*m+|mhm)$/i;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN);
const r3 = (x) => Math.round(x * 1000) / 1000;

// Clean provider words: numbers only, inside the video, in order, text without control characters.
function cleanWords(words, duration) {
  const D = Number(duration) || 0;
  const out = [];
  for (const w of Array.isArray(words) ? words.slice(0, 20000) : []) {
    if (!w || typeof w !== 'object') continue;
    const s = num(w.start), e = num(w.end);
    const text = String(w.text ?? w.word ?? '').replace(/[\u0000-\u001f\u007f{}\\<>]/g, '').trim().slice(0, 40);
    if (!text || !(s >= 0) || !(e >= s) || s > D + 0.5) continue;
    out.push({ text, start: r3(Math.min(s, D)), end: r3(Math.min(Math.max(e, s + 0.04), D)) });
  }
  return out.sort((a, b) => a.start - b.start);
}

// Merge overlapping or touching ranges ([{start,end}]) inside [0, D].
function mergeRanges(list, D, gap = 0.001) {
  const xs = list.map((x) => ({ start: Math.max(0, x.start), end: Math.min(D, x.end) })).filter((x) => x.end - x.start > 0.001).sort((a, b) => a.start - b.start);
  const out = [];
  for (const x of xs) { const l = out[out.length - 1]; if (l && x.start <= l.end + gap) l.end = Math.max(l.end, x.end); else out.push({ ...x }); }
  return out;
}
const total = (rs) => rs.reduce((t, x) => t + (x.end - x.start), 0);

// What we cut ourselves: silences longer than `minGap` (keeping a small pad) and filler words.
function autoRemovals(words, D, { removeSilences = true, minGap = 0.6, pad = 0.12 } = {}) {
  const out = [];
  if (removeSilences) {
    let prev = 0;
    for (const w of words) {
      if (w.start - prev > minGap) out.push({ start: prev === 0 ? 0 : prev + pad, end: w.start - pad, why: 'silence' });
      prev = Math.max(prev, w.end);
    }
    if (words.length && D - prev > minGap) out.push({ start: prev + pad, end: D, why: 'silence' });
  }
  for (const w of words) if (FILLERS.test(w.text.replace(/[^\p{L}]/gu, ''))) out.push({ start: w.start, end: w.end, why: 'filler' });
  return out.filter((x) => x.end - x.start > 0.05);
}

// Snap a cut edge out of the middle of a word: a start moves to the start of the word it falls in, an end to that word's end.
function snap(t, words, side) {
  const w = words.find((x) => t > x.start + 0.01 && t < x.end - 0.01);
  if (!w) return t;
  return side === 'start' ? w.start : w.end;
}

// The AI's edit plan is advice, never trusted as is. Accepts {remove:[{start,end}], hook:{start,end}, emphasis:[t]} (also
// "cuts" for "remove"). Out-of-range values are clamped, reversed/NaN/tiny ranges dropped, overlaps merged, edges snapped to
// word boundaries. If the AI would cut more than 70% of the video, its removals are ignored (ours still apply).
// Returns {removals, hook, emphasis, notes}.
function validatePlan(raw, { duration, words = [] }) {
  const D = Number(duration) || 0;
  const notes = [];
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (raw !== null && raw !== undefined && o !== raw) notes.push('plan was not an object');
  const rangesIn = Array.isArray(o.remove) ? o.remove : Array.isArray(o.cuts) ? o.cuts : [];
  let removals = [];
  for (const x of rangesIn.slice(0, 200)) {
    const s = num(x && x.start), e = num(x && x.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) { notes.push('dropped a cut without numbers'); continue; }
    if (e <= s) { notes.push('dropped a reversed cut'); continue; }
    if (e <= 0 || s >= D) { notes.push('dropped a cut outside the video'); continue; }
    const cs = Math.max(0, s), ce = Math.min(D, e);
    if (ce - cs > D * 0.5) { notes.push('dropped a cut longer than half the video'); continue; }
    removals.push({ start: snap(cs, words, 'start'), end: snap(ce, words, 'end'), why: String(x.reason || 'ai').slice(0, 40) });
  }
  removals = mergeRanges(removals, D);
  if (total(removals) > D * 0.7) { notes.push('ignored AI cuts: they removed too much'); removals = []; }
  let hook = null;
  if (o.hook && typeof o.hook === 'object') {
    let s = num(o.hook.start), e = num(o.hook.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      s = Math.max(0, snap(s, words, 'start')); e = Math.min(D, snap(e, words, 'end'));
      const inside = words.filter((w) => w.start >= s - 0.01 && w.end <= e + 0.01).length;
      if (e - s >= 1 && e - s <= 10 && inside >= 2 && s > 0.5) hook = { start: r3(s), end: r3(e) };
      else notes.push('hook ignored (length, position or too few words)');
    }
  }
  const emphasis = (Array.isArray(o.emphasis) ? o.emphasis : []).slice(0, 60).map((t) => num(t && typeof t === 'object' ? t.t ?? t.time : t)).filter((t) => t >= 0 && t <= D);
  return { removals, hook, emphasis, notes };
}

// Final cut list in OUTPUT order: [{start, end, zoom}] in source seconds. Keeps never drop below 1s in total (then the video
// is kept whole), pieces shorter than 0.25s are dropped, at most 80 pieces (the smallest gaps are closed first).
function cutList({ duration, words, plan, removeSilences = true, hookFirst = false }) {
  const D = Number(duration) || 0;
  const rem = mergeRanges([...autoRemovals(words, D, { removeSilences }), ...(plan.removals || [])], D);
  let keeps = [];
  let t = 0;
  for (const r of rem) { if (r.start > t) keeps.push({ start: t, end: r.start }); t = Math.max(t, r.end); }
  if (t < D) keeps.push({ start: t, end: D });
  keeps = keeps.filter((k) => k.end - k.start >= 0.25);
  while (keeps.length > 80) {
    let best = 1, gap = Infinity;
    for (let i = 1; i < keeps.length; i++) { const g = keeps[i].start - keeps[i - 1].end; if (g < gap) { gap = g; best = i; } }
    keeps[best - 1].end = keeps[best].end; keeps.splice(best, 1);
  }
  if (total(keeps) < Math.min(1, D)) keeps = [{ start: 0, end: D }];
  let order = keeps;
  if (hookFirst && plan.hook) {
    const h = plan.hook;
    const hookParts = keeps.map((k) => ({ start: Math.max(k.start, h.start), end: Math.min(k.end, h.end) })).filter((k) => k.end - k.start >= 0.25);
    if (hookParts.length) {
      const rest = [];
      for (const k of keeps) {
        if (k.end <= h.start || k.start >= h.end) rest.push(k);
        else { if (h.start - k.start >= 0.25) rest.push({ start: k.start, end: h.start }); if (k.end - h.end >= 0.25) rest.push({ start: h.end, end: k.end }); }
      }
      order = [...hookParts.map((x) => ({ ...x, hook: true })), ...rest];
    }
  }
  const emph = plan.emphasis || [];
  return order.map((k, i) => ({ start: r3(k.start), end: r3(k.end), hook: !!k.hook, zoom: emph.some((e) => e >= k.start && e < k.end) ? 1.12 : i % 2 ? 1.05 : 1 }));
}

// Map source-time words onto the output timeline (segments joined with `xf` seconds of overlap).
function remapWords(words, segs, xf = 0) {
  const out = [];
  let at = 0;
  segs.forEach((s, i) => {
    const off = at;
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid >= s.start && mid < s.end) out.push({ text: w.text, start: r3(off + Math.max(0, w.start - s.start)), end: r3(off + Math.min(s.end, w.end) - s.start) });
    }
    at += s.end - s.start - xf;
  });
  return out.sort((a, b) => a.start - b.start);
}

// ---------- Captions ----------
// ASS needs {, }, \ escaped away (they start override tags); newlines would break the event line. User words are plain text.
const assText = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[{}]/g, '').replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
const assTime = (s) => { const cs = Math.max(0, Math.round(s * 100)); const h = Math.floor(cs / 360000), m = Math.floor(cs % 360000 / 6000), sec = Math.floor(cs % 6000 / 100); return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const assColor = (hex) => { const h = hex6(hex); return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; }; // ASS is BGR
const CAPTION_STYLES = {
  bold: { label: 'Bold pop', upper: true, size: 0.072, outline: 6, shadow: 0, box: false, y: 0.3 },
  clean: { label: 'Clean', upper: false, size: 0.055, outline: 0, shadow: 3, box: false, y: 0.22 },
  boxed: { label: 'Boxed', upper: false, size: 0.06, outline: 0, shadow: 0, box: true, y: 0.26 },
};
// Groups words into short lines (up to 3 words / 18 characters) and writes one event per word: the word being spoken is
// highlighted in the brand colour (and pops in for the "bold" style).
function buildAss(words, { style = 'bold', brandColor = '#FF4A1C', width = 1080, height = 1920, fontName = 'Inter ExtraBold' } = {}) {
  const S = CAPTION_STYLES[style] || CAPTION_STYLES.bold;
  const fs0 = Math.round(Math.min(width, height) * S.size * (height > width ? 1 : 0.8));
  const brand = assColor(brandColor);
  const lines = [];
  let cur = [];
  for (const w of words) {
    const txt = assText(S.upper ? w.text.toUpperCase() : w.text);
    if (!txt) continue;
    const len = cur.reduce((t, x) => t + x.txt.length + 1, 0);
    const gap = cur.length ? w.start - cur[cur.length - 1].end : 0;
    if (cur.length && (cur.length >= 3 || len + txt.length > 18 || gap > 0.5)) { lines.push(cur); cur = []; }
    cur.push({ ...w, txt });
  }
  if (cur.length) lines.push(cur);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Cap,${fontName},${fs0},&H00FFFFFF,&H00FFFFFF,&H00101010,${S.box ? '&H5A000000' : '&H64000000'},-1,0,0,0,100,100,0,0,${S.box ? 3 : 1},${S.box ? Math.round(fs0 * 0.28) : S.outline},${S.shadow},2,60,60,${Math.round(height * S.y)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const ev = [];
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const st = line[i].start, en = i < line.length - 1 ? line[i + 1].start : Math.max(line[i].end, st + 0.2);
      if (en - st < 0.02) continue;
      const pop = style === 'bold' ? `{\\fscx112\\fscy112\\t(0,90,\\fscx100\\fscy100)}` : '';
      const text = line.map((x, k) => (k === i ? `{\\c${brand}&}${x.txt}{\\c&H00FFFFFF&}` : x.txt)).join(' ');
      ev.push(`Dialogue: 0,${assTime(st)},${assTime(en)},Cap,,0,0,0,,${pop}${text}`);
    }
  }
  return header + ev.join('\n') + '\n';
}
function srtFromWords(words) {
  const ts = (s) => { const ms = Math.max(0, Math.round(s * 1000)); return `${String(Math.floor(ms / 36e5)).padStart(2, '0')}:${String(Math.floor(ms % 36e5 / 6e4)).padStart(2, '0')}:${String(Math.floor(ms % 6e4 / 1000)).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const chunks = [];
  let cur = [];
  for (const w of words) { cur.push(w); if (cur.length >= 6 || /[.!?]$/.test(w.text)) { chunks.push(cur); cur = []; } }
  if (cur.length) chunks.push(cur);
  return chunks.map((c, i) => `${i + 1}\n${ts(c[0].start)} --> ${ts(c[c.length - 1].end)}\n${c.map((x) => x.text).join(' ').replace(/[\r\n]+/g, ' ')}\n`).join('\n');
}

// ---------- Auto-edit: render ----------
// segs: cutList() output. Each piece is cut and reframed into its own file (accurate seek, so footage never waits in memory
// when the hook moves to the front), then the pieces are joined with tiny crossfades (hard cuts above 24 pieces), captions are
// burnt in from an ASS file, the music bed is ducked under the voice, loudness is set to -14 LUFS and an end card is added.
async function renderEdit({ src, info, segs, words, captions = true, captionStyle = 'bold', brandColor, aspect = '9:16', musicFile = null, endCard = null, out }) {
  if (!stitch.available()) throw new Error('ffmpeg is not installed');
  return withTmp(async (dir) => {
    const [W, H] = outSize(aspect, info);
    const hasAudio = info.has_audio !== false;
    const files = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i], len = Math.max(0.25, s.end - s.start);
      const f = path.join(dir, `seg${String(i).padStart(3, '0')}.mp4`);
      const z = s.zoom || 1;
      // Reframe: fill the frame, centred horizontally and a little above centre (where faces usually are), then punch in.
      const vf = `scale=${Math.round(W * z)}:${Math.round(H * z)}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})*0.35,setsar=1,fps=30,format=yuv420p`;
      const af = `aresample=44100,aformat=channel_layouts=stereo,afade=t=in:d=0.02,afade=t=out:st=${Math.max(0, len - 0.03).toFixed(3)}:d=0.03`;
      const inArgs = ['-ss', s.start.toFixed(3), '-i', src];
      if (!hasAudio) inArgs.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
      await slot(() => exec([...inArgs, '-t', len.toFixed(3), '-map', '0:v:0', '-map', hasAudio ? '0:a:0' : '1:a:0', '-vf', vf, '-af', af, ...ENC_FAST, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', f], 5 * 60e3));
      files.push({ f, len: stitch.probe(f).duration || len });
    }
    if (endCard) {
      const f = path.join(dir, 'end.mp4');
      await makeEndCard({ ...endCard, W, H, brandColor, out: f, dir });
      files.push({ f, len: stitch.probe(f).duration || 2.5, end: true });
    }
    const xf = files.length > 1 && files.length <= 24 ? 0.08 : 0;
    // Output-timeline words for the captions + SRT.
    const mapped = remapWords(words, segs, xf);
    const assFile = path.join(dir, 'captions.ass');
    fs.writeFileSync(assFile, buildAss(mapped, { style: captionStyle, brandColor, width: W, height: H, fontName: fontFamily() }));
    const args = [];
    files.forEach((x) => args.push('-i', x.f));
    const parts = [];
    let v = '[0:v]', a = '[0:a]', len = files[0].len;
    for (let i = 1; i < files.length; i++) {
      if (xf) {
        parts.push(`${v}[${i}:v]xfade=transition=fade:duration=${xf}:offset=${(len - xf).toFixed(3)}[vx${i}]`, `${a}[${i}:a]acrossfade=d=${xf}:c1=tri:c2=tri[ax${i}]`);
        v = `[vx${i}]`; a = `[ax${i}]`; len += files[i].len - xf;
      } else len += files[i].len;
    }
    if (!xf && files.length > 1) { parts.push(files.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${files.length}:v=1:a=1[vc][ac]`); v = '[vc]'; a = '[ac]'; }
    const burn = captions && stitch.hasFilter('ass');
    parts.push(`${v}${burn ? `ass=${escFilterPath(assFile)}:fontsdir=${escFilterPath(FONT_DIR)}` : 'null'},format=yuv420p[vout]`);
    let music = null;
    if (musicFile) { args.push('-stream_loop', '-1', '-i', musicFile); music = `[${files.length}:a]`; }
    const audio = stitch.audioGraph ? stitch.audioGraph({ voice: a, music, seconds: len }) : [`${a}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`];
    await slot(() => exec([...args, '-filter_complex', [...parts, ...audio].join(';'), '-map', '[vout]', '-map', '[aout]', '-t', len.toFixed(3), ...ENC, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]));
    return { url: out, seconds: Math.round(len * 10) / 10, srt: srtFromWords(mapped), captioned: burn, pieces: segs.length, crossfade: xf };
  });
}
// Filter-graph option values: escape the characters the filter parser treats specially (paths are ours, never user text).
const escFilterPath = (p) => "'" + String(p).replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:') + "'";
let fam;
function fontFamily() {
  if (fam !== undefined) return fam;
  const f = stitch.fontFile ? stitch.fontFile() : null;
  fam = f && /Inter/i.test(f) ? 'Inter ExtraBold' : 'DejaVu Sans';
  return fam;
}

// End card: brand-dark ground, optional logo, the call to action in a brand-colour box (text from a file, never the command).
async function makeEndCard({ logoFile, cta, W, H, brandColor, out, dir, seconds = 2.5 }) {
  const font = stitch.fontFile ? stitch.fontFile() : null;
  const fontArg = font ? `fontfile=${escFilterPath(font)}:` : '';
  const ctaFile = path.join(dir, 'cta.txt');
  fs.writeFileSync(ctaFile, String(cta || 'Shop now').replace(/[\u0000-\u001f]/g, ' ').slice(0, 30));
  const args = ['-f', 'lavfi', '-t', String(seconds), '-i', `color=c=0x0B0B0A:s=${W}x${H}:r=30`];
  let g = '[0:v]format=yuv420p[e0]', last = 'e0';
  if (logoFile) { args.push('-loop', '1', '-t', String(seconds), '-i', logoFile); g += `;[1:v]scale=${Math.round(W * 0.34)}:-2,format=rgba[lg];[e0][lg]overlay=(W-w)/2:H*0.3:shortest=1[e1]`; last = 'e1'; }
  args.push('-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  const aIdx = logoFile ? 2 : 1;
  const fsz = Math.round(Math.min(W, H) * 0.075);
  g += `;[${last}]drawtext=${fontArg}textfile=${escFilterPath(ctaFile)}:fontsize=${fsz}:fontcolor=white:box=1:boxcolor=0x${hex6(brandColor)}:boxborderw=${Math.round(fsz * 0.5)}:x=(w-text_w)/2:y=h*0.62:alpha='min(1\\,t/0.35)',fps=30,format=yuv420p[v]`;
  await slot(() => exec([...args, '-filter_complex', g, '-map', '[v]', '-map', `${aIdx}:a`, '-t', String(seconds), ...ENC_FAST, '-c:a', 'aac', out], 60e3));
  return out;
}

module.exports = { exec, slot, withTmp, outSize, ASPECTS, extractAudio, prepForMatting, compositeBackground, mockMatte, mockMusic, cleanWords, mergeRanges, autoRemovals, validatePlan, cutList, remapWords, buildAss, assText, srtFromWords, renderEdit, makeEndCard, CAPTION_STYLES, FILLERS, escFilterPath };
