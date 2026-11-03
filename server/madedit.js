// Mad edit assembly (ffmpeg): fast cuts on a beat grid, punch-in zooms, whooshes on cuts, impacts under big text hits,
// kinetic word-by-word captions, and a beat (generated in server/sfx.js) or the customer's music under it all.
//
// plan(): the cut list, pure and testable. render(): the ffmpeg work.
const fs = require('node:fs');
const path = require('node:path');
const stitch = require('./stitch');
const kit = require('./editkit');
const sfx = require('./sfx');

// Cut lengths in beats. Mostly one beat, a held two-beat shot now and then, half-beat bursts before a hit.
const PATTERN = [2, 1, 1, 1, 2, 1, 0.5, 0.5, 1, 1, 2, 1, 1, 0.5, 0.5, 2];
const r3 = (x) => Math.round(x * 1000) / 1000;

// {cuts: [{start, len, src, from, zoom, punch}], hits: [{t, text}], words: [{text, start, end}], spb}
function plan({ seconds, bpm = 124, sources = 1, sourceLengths = [], hits = [], caption = '' }) {
  const S = Math.max(3, Number(seconds) || 15);
  const B = Math.max(80, Math.min(160, Number(bpm) || 124));
  const spb = 60 / B;
  const n = Math.max(1, sources);
  const cuts = [];
  const off = Array.from({ length: n }, () => 0);
  let t = 0, k = 0;
  while (t < S - 0.05) {
    const len = Math.min(PATTERN[k % PATTERN.length] * spb, S - t);
    if (len < 0.12) break;
    const src = k % n;
    const L = Number(sourceLengths[src]) || 0;
    let from = off[src];
    if (L > 0 && from + len > L - 0.05) from = Math.max(0, (from + len) % Math.max(0.5, L - len));
    off[src] = from + len + spb * 0.5; // skip a little footage so a source never repeats the same frames
    const punch = k % 3 === 2; // animated punch-in every third cut
    cuts.push({ start: r3(t), len: r3(len), src, from: r3(from), zoom: punch ? 1 : [1, 1.12, 1.06][k % 3], punch });
    t += len; k++;
  }
  // Big text hits: on every 4th cut from the second one, at most one per 1.5s, in order.
  const H = [];
  const texts = (hits || []).map((x) => String(x || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 28)).filter(Boolean);
  let hi = 0, last = -9;
  for (let c = 1; c < cuts.length && hi < texts.length; c += 4) if (cuts[c].start - last >= 1.5) { H.push({ t: cuts[c].start, len: r3(Math.min(1.4, Math.max(0.6, cuts[c].len * 2))), text: texts[hi++] }); last = cuts[c].start; }
  // Kinetic captions: one word per half beat, starting after the first cut.
  const words = String(caption || '').split(/\s+/).filter(Boolean).slice(0, 80);
  const step = spb / 2, w0 = Math.min(S - 0.5, cuts[1] ? cuts[1].start : 0.5);
  const W = [];
  words.forEach((w, i) => { const s = w0 + i * step; if (s < S - 0.2) W.push({ text: w, start: r3(s), end: r3(Math.min(S, s + step)) }); });
  return { cuts, hits: H, words: W, spb: r3(spb), bpm: B, seconds: S };
}

async function render({ files, seconds, bpm = 124, hits = [], caption = '', aspect = '9:16', brandColor = '#1E4DFF', musicFile = null, captions = true, out }) {
  if (!stitch.available()) throw new Error('ffmpeg is not installed');
  return kit.withTmp(async (dir) => {
    const [W, H] = aspect === '1:1' ? [1080, 1080] : aspect === '16:9' ? [1280, 720] : aspect === '4:5' ? [864, 1080] : [720, 1280];
    const lens = files.map((f) => stitch.probe(f).duration || 0);
    const P = plan({ seconds, bpm, sources: files.length, sourceLengths: lens, hits, caption });
    // 1. Each cut: fill the frame, a static zoom or an animated punch-in, 30 fps, no sound (the edit's sound is built below).
    const pieces = [];
    for (let i = 0; i < P.cuts.length; i++) {
      const c = P.cuts[i];
      const f = path.join(dir, `cut${String(i).padStart(3, '0')}.mp4`);
      const z = c.zoom || 1;
      const frames = Math.max(2, Math.round(c.len * 30));
      const base = `scale=${Math.round(W * z)}:${Math.round(H * z)}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
      const vf = c.punch
        ? `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(1.28,1+0.28*on/${Math.max(1, Math.round(frames * 0.6))})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=30,setsar=1,format=yuv420p`
        : `${base},setsar=1,fps=30,format=yuv420p`;
      await kit.slot(() => kit.exec(['-ss', String(c.from), '-stream_loop', '-1', '-i', files[c.src], '-t', String(c.len), '-an', '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p', f], 3 * 60e3));
      pieces.push(f);
    }
    // 2. Sound: the beat (or the customer's music), a whoosh just before every cut, an impact under every text hit, a riser in.
    const wv = path.join(dir, 'whoosh.wav'), im = path.join(dir, 'impact.wav'), ri = path.join(dir, 'riser.wav'), bt = path.join(dir, 'beat.wav');
    fs.writeFileSync(wv, sfx.make.whoosh()); fs.writeFileSync(im, sfx.make.impact()); fs.writeFileSync(ri, sfx.make.riser());
    if (!musicFile) fs.writeFileSync(bt, sfx.make.beat(P.bpm, P.seconds + 0.5));
    const args = [];
    pieces.forEach((f) => args.push('-i', f));
    const nV = pieces.length;
    args.push('-i', musicFile || bt, '-i', wv, '-i', im, '-i', ri);
    const iBed = nV, iW = nV + 1, iI = nV + 2, iR = nV + 3;
    const g = [];
    g.push(pieces.map((_, i) => `[${i}:v]`).join('') + `concat=n=${nV}:v=1:a=0[vc]`);
    // Kinetic captions (ASS, word by word in the brand colour) and big text hits (drawtext from files, never the command line).
    let v = '[vc]';
    if (captions && P.words.length && stitch.hasFilter('ass')) {
      const ass = path.join(dir, 'kin.ass');
      fs.writeFileSync(ass, kit.buildAss(P.words, { style: 'bold', brandColor, width: W, height: H, fontName: /Inter/i.test(stitch.fontFile() || '') ? 'Inter ExtraBold' : 'DejaVu Sans' }));
      g.push(`${v}ass=${kit.escFilterPath(ass)}:fontsdir=${kit.escFilterPath(path.join(__dirname, 'assets', 'fonts'))}[vk]`); v = '[vk]';
    }
    const font = stitch.fontFile();
    const hexc = /^#?[0-9a-f]{6}$/i.test(String(brandColor || '')) ? String(brandColor).replace('#', '') : '1E4DFF';
    P.hits.forEach((h, i) => {
      const tf = path.join(dir, `hit${i}.txt`);
      fs.writeFileSync(tf, h.text.toUpperCase());
      const fsz = Math.round(Math.min(W, H) * (h.text.length > 14 ? 0.085 : 0.12));
      const a = h.t.toFixed(3), b = (h.t + h.len).toFixed(3);
      g.push(`${v}drawtext=${font ? `fontfile=${kit.escFilterPath(font)}:` : ''}textfile=${kit.escFilterPath(tf)}:fontsize=${fsz}:fontcolor=white:box=1:boxcolor=0x${hexc}:boxborderw=${Math.round(fsz * 0.35)}:x=(w-text_w)/2+if(lt(t-${a}\\,0.12)\\,6*sin(t*90)\\,0):y=h*0.42:enable='between(t,${a},${b})'[vh${i}]`);
      v = `[vh${i}]`;
    });
    g.push(`${v}format=yuv420p[vout]`);
    // Audio graph: delayed copies of the effects, mixed over the bed.
    const fx = [];
    const ms = (t) => Math.max(0, Math.round(t * 1000));
    const whooshAt = P.cuts.slice(1).map((c) => c.start - 0.18).filter((t) => t > 0).slice(0, 40);
    g.push(`[${iW}:a]asplit=${Math.max(1, whooshAt.length)}${whooshAt.map((_, i) => `[w${i}]`).join('') || '[w0]'}`);
    whooshAt.forEach((t, i) => { g.push(`[w${i}]volume=0.45,adelay=${ms(t)}|${ms(t)}[wd${i}]`); fx.push(`[wd${i}]`); });
    if (!whooshAt.length) g.push('[w0]anullsink');
    const hitsAt = P.hits.map((h) => h.t).slice(0, 20);
    if (hitsAt.length) {
      g.push(`[${iI}:a]asplit=${hitsAt.length}${hitsAt.map((_, i) => `[h${i}]`).join('')}`);
      hitsAt.forEach((t, i) => { g.push(`[h${i}]volume=0.9,adelay=${ms(t)}|${ms(t)}[hd${i}]`); fx.push(`[hd${i}]`); });
    } else g.push(`[${iI}:a]anullsink`);
    g.push(`[${iR}:a]volume=0.5[rz]`); fx.push('[rz]');
    g.push(`[${iBed}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${musicFile ? '0.7' : '0.85'},atrim=0:${P.seconds.toFixed(2)}[bed]`);
    g.push(`[bed]${fx.join('')}amix=inputs=${fx.length + 1}:duration=first:normalize=0,alimiter=limit=0.95,aformat=channel_layouts=stereo[aout]`);
    await kit.slot(() => kit.exec([...args, '-filter_complex', g.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', P.seconds.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], 10 * 60e3));
    return { url: out, seconds: P.seconds, cuts: P.cuts.length, hits: P.hits, words: P.words.length, bpm: P.bpm };
  });
}

module.exports = { plan, render, PATTERN };
