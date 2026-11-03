// Local edit operations for chat editing (ffmpeg, near-zero cost). A video version has two layers:
//   master  the picture and voice: trims, cuts, re-ordered scenes, speed, reframe, a re-made scene spliced in, a new voice
//   look    what goes on top, re-rendered from the master every time: captions (style, size, position), text overlays,
//           a logo, the end card, music (swap, volume, remove)
// so "captions bigger" after "captions on top" never burns captions twice, and music volume can change on a clean master.
//
// Times: `ranges` are kept pieces of the source, in output order. mapTime() moves words and scenes onto the new timeline.
const fs = require('node:fs');
const path = require('node:path');
const stitch = require('./stitch');
const kit = require('./editkit');
const sfx = require('./sfx');

const r3 = (x) => Math.round(x * 1000) / 1000;
const SIZES = { '9:16': [720, 1280], '1:1': [1080, 1080], '4:5': [864, 1080], '16:9': [1280, 720] };

// ---------- Timeline maths (pure) ----------
function trimRanges(D, start, end) { const s = Math.max(0, Math.min(D, start)), e = Math.max(s, Math.min(D, end)); return e - s > 0.2 ? [{ start: s, end: e }] : [{ start: 0, end: D }]; }
function cutRanges(D, start, end) {
  const s = Math.max(0, Math.min(D, start)), e = Math.max(s, Math.min(D, end));
  const out = [];
  if (s > 0.05) out.push({ start: 0, end: s });
  if (D - e > 0.05) out.push({ start: e, end: D });
  return out.length ? out : [{ start: 0, end: D }];
}
function reorderRanges(scenes, order) { return order.map((k) => scenes[k]).filter(Boolean).map((s) => ({ start: s.start, end: s.end })); }
// Where a source time lands after keeping `ranges` (null when it was cut).
function mapTime(ranges, t) {
  let at = 0;
  for (const r of ranges) { if (t >= r.start - 1e-6 && t <= r.end + 1e-6) return r3(at + (t - r.start)); at += r.end - r.start; }
  return null;
}
const lengthOf = (ranges) => r3(ranges.reduce((t, r) => t + (r.end - r.start), 0));
function mapWords(words, ranges) {
  const out = [];
  let at = 0;
  for (const r of ranges) {
    for (const w of words) { const mid = (w.start + w.end) / 2; if (mid >= r.start && mid < r.end) out.push({ text: w.text, start: r3(at + Math.max(0, w.start - r.start)), end: r3(at + Math.min(r.end, w.end) - r.start) }); }
    at += r.end - r.start;
  }
  return out;
}
function mapScenes(scenes, ranges) {
  const out = [];
  let at = 0;
  for (const r of ranges) {
    for (const s of scenes) {
      const a = Math.max(s.start, r.start), b = Math.min(s.end, r.end);
      if (b - a > 0.2) out.push({ ...s, start: r3(at + a - r.start), end: r3(at + b - r.start) });
    }
    at += r.end - r.start;
  }
  // Re-number, merging pieces of the same original scene that ended up next to each other.
  const merged = [];
  for (const s of out) { const l = merged[merged.length - 1]; if (l && l.orig === s.orig && Math.abs(l.end - s.start) < 0.01) l.end = s.end; else merged.push({ ...s }); }
  return merged.map((s, i) => ({ ...s, n: i + 1 }));
}
const scaleTimes = (items, f) => items.map((x) => ({ ...x, start: r3(x.start / f), end: r3(x.end / f) }));

// Evenly timed words from the script (when nothing better is known): honest about being an estimate in the UI.
function wordsFromScript(text, D) {
  const ws = String(text || '').split(/\s+/).filter(Boolean).slice(0, 600);
  if (!ws.length || !(D > 0)) return [];
  const per = D / ws.length;
  return ws.map((w, i) => ({ text: w, start: r3(i * per), end: r3((i + 1) * per) }));
}

// ---------- ffmpeg ----------
async function probeSize(file) {
  const r = require('node:child_process').spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', ...stitch.guardArgs(['-i', file])], { timeout: 20000 });
  const m = String(r.stderr || '').match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  return m ? [Number(m[1]), Number(m[2])] : [720, 1280];
}
const ENC = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
// Make sure a file has an audio stream (silence when it has none) so every filter graph can use [0:a].
async function withAudio(file, dir) {
  if (stitch.probe(file).audio) return file;
  const out = path.join(dir, 'a-' + path.basename(file));
  await kit.exec(['-i', file, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-shortest', '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', out]);
  return out;
}
async function keep(src, ranges, out) {
  const g = [], c = [];
  ranges.forEach((r, i) => {
    g.push(`[0:v]trim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`, `[0:a]atrim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    c.push(`[v${i}][a${i}]`);
  });
  g.push(`${c.join('')}concat=n=${ranges.length}:v=1:a=1[v][a]`);
  await kit.exec(['-i', src, '-filter_complex', g.join(';'), '-map', '[v]', '-map', '[a]', ...ENC, out]);
  return out;
}
async function speed(src, f, out) {
  const fa = Math.max(0.5, Math.min(2, f));
  await kit.exec(['-i', src, '-filter_complex', `[0:v]setpts=PTS/${fa}[v];[0:a]atempo=${fa}[a]`, '-map', '[v]', '-map', '[a]', ...ENC, out]);
  return out;
}
async function reframe(src, aspect, out) {
  const [W, H] = SIZES[aspect] || SIZES['9:16'];
  await kit.exec(['-i', src, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})*0.35,setsar=1,fps=30,format=yuv420p`, ...ENC, out]);
  return out;
}
// Put `clip` (its first end-start seconds) in place of [start, end] of src, scaled to src's frame.
async function splice(src, clip, start, end, out) {
  const [W, H] = await probeSize(src);
  const D = stitch.probe(src).duration;
  const len = Math.max(0.3, end - start);
  const g = [];
  const parts = [];
  const norm = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,format=yuv420p`;
  if (start > 0.05) { g.push(`[0:v]trim=0:${start.toFixed(3)},setpts=PTS-STARTPTS,${norm}[va]`, `[0:a]atrim=0:${start.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[aa]`); parts.push('[va][aa]'); }
  g.push(`[1:v]trim=0:${len.toFixed(3)},setpts=PTS-STARTPTS,${norm},tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},trim=0:${len.toFixed(3)}[vb]`, `[1:a]atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${len.toFixed(3)}[ab]`); parts.push('[vb][ab]');
  if (D - end > 0.05) { g.push(`[0:v]trim=start=${end.toFixed(3)},setpts=PTS-STARTPTS,${norm}[vc]`, `[0:a]atrim=start=${end.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo[ac]`); parts.push('[vc][ac]'); }
  g.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=1[v][a]`);
  await kit.exec(['-i', src, '-i', clip, '-filter_complex', g.join(';'), '-map', '[v]', '-map', '[a]', ...ENC, out]);
  return out;
}

// Captions ASS with the chosen style, size (small 0.8 / medium 1 / large 1.3 / huge 1.6) and position (top/middle/bottom).
const SIZE_SCALE = { small: 0.8, medium: 1, large: 1.3, huge: 1.6 };
function captionAss(words, look, W, H, brandColor) {
  const c = look.captions || {};
  let ass = kit.buildAss(words, { style: c.style || 'bold', brandColor, width: W, height: H, fontName: /Inter/i.test(stitch.fontFile() || '') ? 'Inter ExtraBold' : 'DejaVu Sans' });
  const scale = SIZE_SCALE[c.size] || Number(c.size) || 1;
  const pos = c.position || 'bottom';
  ass = ass.replace(/^Style: Cap,([^,]*),(\d+),(.*)$/m, (m, font, size, rest) => {
    const f = rest.split(',');
    // rest fields: Primary..Encoding; Alignment is index 15, MarginV index 18 (after Fontsize).
    f[15] = pos === 'top' ? '8' : pos === 'middle' ? '5' : '2';
    f[18] = String(pos === 'middle' ? 0 : Math.round(H * (pos === 'top' ? 0.12 : 0.18)));
    return `Style: Cap,${font},${Math.round(Number(size) * scale)},${f.join(',')}`;
  });
  return ass;
}

// The look on top of a master: music, captions, overlays, logo, end card. Returns the output file.
async function finish({ master, look = {}, words = [], brandColor = '#1E4DFF', logoFile = null, musicFile = null, dir, out }) {
  const [W, H] = await probeSize(master);
  const D = stitch.probe(master).duration;
  let cur = master;
  const step = (n) => path.join(dir, `look${n}.mp4`);
  let n = 0;
  // Music under the master's own sound (or replacing nothing when removed: the master has no music).
  if (look.music && look.music.on !== false && musicFile) {
    const vol = Math.max(0, Math.min(1.5, Number(look.music.volume ?? 0.35)));
    const o = step(n++);
    await kit.exec(['-i', cur, '-stream_loop', '-1', '-i', musicFile, '-filter_complex', `[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=${vol.toFixed(2)},atrim=0:${D.toFixed(2)},afade=t=out:st=${Math.max(0, D - 1).toFixed(2)}:d=1[m];[0:a]aresample=44100,aformat=channel_layouts=stereo[v];[v][m]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', D.toFixed(3), o]);
    cur = o;
  }
  const vf = [];
  if (look.captions && look.captions.on !== false && words.length && stitch.hasFilter('ass')) {
    const f = path.join(dir, 'cap.ass');
    fs.writeFileSync(f, captionAss(words, look, W, H, brandColor));
    vf.push(`ass=${kit.escFilterPath(f)}:fontsdir=${kit.escFilterPath(path.join(__dirname, 'assets', 'fonts'))}`);
  }
  const font = stitch.fontFile();
  (look.overlays || []).slice(0, 8).forEach((o, i) => {
    const tf = path.join(dir, `ov${i}.txt`);
    fs.writeFileSync(tf, String(o.text || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 60));
    const fsz = Math.round(Math.min(W, H) * 0.07);
    const y = o.position === 'bottom' ? 'h*0.78' : o.position === 'middle' ? '(h-text_h)/2' : 'h*0.1';
    const a = Math.max(0, Number(o.start) || 0), b = Math.min(D, Number(o.end) || D);
    vf.push(`drawtext=${font ? `fontfile=${kit.escFilterPath(font)}:` : ''}textfile=${kit.escFilterPath(tf)}:fontsize=${fsz}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=${Math.round(fsz * 0.3)}:x=(w-text_w)/2:y=${y}:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`);
  });
  if (look.ai_label) {
    const tf = path.join(dir, 'ailabel.txt');
    fs.writeFileSync(tf, 'AI-generated');
    const fsz = Math.max(14, Math.round(Math.min(W, H) * 0.032));
    vf.push(`drawtext=${font ? `fontfile=${kit.escFilterPath(font)}:` : ''}textfile=${kit.escFilterPath(tf)}:fontsize=${fsz}:fontcolor=white@0.92:box=1:boxcolor=black@0.45:boxborderw=${Math.round(fsz * 0.45)}:x=w*0.04:y=h-text_h-h*0.03`);
  }
  if (vf.length || (look.logo && look.logo.on && logoFile)) {
    const o = step(n++);
    const args = ['-i', cur];
    let g = `[0:v]${vf.length ? vf.join(',') : 'null'}[v0]`;
    if (look.logo && look.logo.on && logoFile) {
      args.push('-i', logoFile);
      const c = look.logo.corner || 'top-right';
      const x = /left/.test(c) ? 'W*0.04' : 'W-w-W*0.04', y = /bottom/.test(c) ? 'H-h-H*0.04' : 'H*0.04';
      g += `;[1:v]scale=${Math.round(W * 0.18)}:-2,format=rgba,colorchannelmixer=aa=0.9[lg];[v0][lg]overlay=${x}:${y}[v1]`;
    } else g += ';[v0]null[v1]';
    await kit.exec([...args, '-filter_complex', g + ';[v1]format=yuv420p[v]', '-map', '[v]', '-map', '0:a', ...ENC, o]);
    cur = o;
  }
  if (look.end_card && look.end_card.on !== false) {
    const card = path.join(dir, 'end.mp4');
    await kit.makeEndCard({ logoFile: look.end_card.logo !== false ? logoFile : null, cta: look.end_card.cta || 'Shop now', W, H, brandColor, out: card, dir });
    const o = step(n++);
    await kit.exec(['-i', cur, '-i', card, '-filter_complex', `[0:v]setsar=1,fps=30,format=yuv420p[a0];[1:v]scale=${W}:${H},setsar=1,fps=30,format=yuv420p[b0];[0:a]aresample=44100,aformat=channel_layouts=stereo[a1];[1:a]aresample=44100,aformat=channel_layouts=stereo[b1];[a0][a1][b0][b1]concat=n=2:v=1:a=1[v][a]`, '-map', '[v]', '-map', '[a]', ...ENC, o]);
    cur = o;
  }
  fs.copyFileSync(cur, out);
  return out;
}

// A generated music bed when the customer asks for "different music" and has no library or brand track: our beat.
function beatFile(dir, seconds, bpm = 112) { const f = path.join(dir, 'beat.wav'); fs.writeFileSync(f, sfx.make.beat(bpm, seconds + 1)); return f; }

module.exports = { trimRanges, cutRanges, reorderRanges, mapTime, mapWords, mapScenes, scaleTimes, lengthOf, wordsFromScript, keep, speed, reframe, splice, finish, captionAss, withAudio, probeSize, beatFile, SIZES, SIZE_SCALE };
