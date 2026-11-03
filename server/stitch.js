// Stitching with ffmpeg (SPEC §3): joins long-video segments, builds slideshow videos, splices hooks before an ad.
// ffmpeg must be on PATH (Railway: nixpacks.toml installs it). Without it every caller falls back to a playlist.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const config = require('./config');
const media = require('./media');

const BIN = process.env.FFMPEG_PATH || 'ffmpeg';
let detected = null;
let filters = '';
function available() {
  if (detected !== null) return detected;
  if (process.env.STITCH === '0') return (detected = false);
  try {
    const r = spawnSync(BIN, ['-hide_banner', '-version'], { timeout: 8000 });
    detected = r.status === 0;
    if (detected) filters = String(spawnSync(BIN, ['-hide_banner', '-filters'], { timeout: 8000 }).stdout || '');
  } catch { detected = false; }
  return detected;
}
const hasFilter = (f) => available() && new RegExp('\\s' + f + '\\s').test(filters);

function exec(args, timeoutMs = 10 * 60e3) {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, ['-hide_banner', '-y', ...guardArgs(args)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(err) : reject(new Error('ffmpeg failed: ' + err.split('\n').filter(Boolean).slice(-3).join(' | '))); });
  });
}

// Probe duration and streams by reading ffmpeg's banner (no ffprobe needed).
function probe(file) {
  const r = spawnSync(BIN, ['-hide_banner', ...guardArgs(['-i', file])], { timeout: 20000 });
  const s = String(r.stderr || '');
  const m = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return { duration: m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0, audio: /Stream #.*Audio:/.test(s), video: /Stream #.*Video:/.test(s) };
}

// Turn a URL we produced (/media/..., /samples/..., APP_URL/...) or a remote link into a local file.
// Security (audit, Phase 2): remote links go through one guarded download (lib/netguard.js: pinned DNS, private and
// reserved ranges refused, every redirect re-checked); every input's real type comes from its magic bytes, it is saved with
// that extension, and ffmpeg reads it with that demuxer only and the file/pipe protocols only (see exec() and probe()), so
// an HLS playlist or similar can never make ffmpeg open other files. Private uploads (/u/<id>, upload:<id>) only resolve
// for the job's own customer (or with a valid signed link).
const MAX_DOWNLOAD = 300e6;
const netguard = require('./lib/netguard');
const INPUT_FMT = new Map(); // local path -> demuxer for files we resolved with localFile()
function registerInput(file, fmt) { if (fmt) { INPUT_FMT.set(path.resolve(file), fmt); if (INPUT_FMT.size > 5000) INPUT_FMT.delete(INPUT_FMT.keys().next().value); } return file; }
function headOf(file) { try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(32); fs.readSync(fd, b, 0, 32, 0); fs.closeSync(fd); return b; } catch { return Buffer.alloc(0); } }
// ffmpeg input arguments: the demuxer we detected and file/pipe only, in front of every "-i <registered file>".
function guardArgs(args) {
  const out = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] === '-i' && typeof args[k + 1] === 'string' && !/^(anullsrc|color=|sine|testsrc|mandelbrot)/.test(args[k + 1]) && args[k - 1] !== 'lavfi') {
      const fmt = INPUT_FMT.get(path.resolve(args[k + 1]));
      out.push('-protocol_whitelist', 'file,pipe');
      if (fmt && args[k - 2] !== '-f') out.push('-f', fmt);
    }
    out.push(args[k]);
  }
  return out;
}
async function assertPublic(u) {
  const problem = netguard.urlProblem(u);
  if (problem) throw new Error('That link ' + problem + '.');
}
async function safeDownload(url) {
  const r = await netguard.download(url, { maxBytes: MAX_DOWNLOAD, timeoutMs: 120000 });
  return r.body;
}

async function localFile(url, tmpDir, userId = null) {
  let u = String(url || '');
  if (u.startsWith(config.appUrl)) u = u.slice(config.appUrl.length);
  const known = (p) => { const t = netguard.sniff(headOf(p)); return registerInput(p, t && t.demuxer); };
  if (u.startsWith('/media/')) { const p = media.filePath(u.slice(7).split('?')[0]); if (p) return known(p); }
  if (u.startsWith('/samples/')) { const p = require('./samples').localPath(u.slice(9).split('?')[0]); if (p) return known(p); }
  // Private customer uploads (server/uploads.js): "upload:<id>" or our own /u/ link. Only the job's own customer, or a
  // valid signed link.
  if (u.startsWith('upload:') || u.startsWith('/u/')) {
    const up = require('./uploads');
    const id = u.startsWith('upload:') ? u.slice(7) : u.slice(3).split(/[.?]/)[0];
    let row = userId ? up.owned(id, userId) : null;
    if (!row && u.startsWith('/u/')) { const q = new URLSearchParams(u.split('?')[1] || ''); row = up.verify(id, q.get('e'), String(q.get('s') || '')) || null; }
    const p = up.filePath(row);
    if (!p || !fs.existsSync(p)) throw new Error('File not found: ' + u.slice(0, 80));
    const t = netguard.sniff(headOf(p));
    if (!t) throw new Error('That upload is not a video, picture or sound file.');
    return registerInput(p, t.demuxer);
  }
  if (/^https?:\/\//.test(u)) {
    const buf = await safeDownload(u);
    const t = netguard.sniff(buf);
    if (!t) throw new Error('That link is not a video, picture or sound file.');
    const file = path.join(tmpDir, 'in-' + Math.random().toString(36).slice(2) + t.ext);
    fs.writeFileSync(file, buf);
    return registerInput(file, t.demuxer);
  }
  throw new Error('File not found: ' + u.slice(0, 80));
}

const SIZES = { '9:16': [720, 1280], '1:1': [1080, 1080], '4:5': [864, 1080], '16:9': [1280, 720] };
const sizeFor = (aspect) => SIZES[aspect] || SIZES['9:16'];

async function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vooads-stitch-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function saveOut(file, userId) {
  const m = media.save(fs.readFileSync(file), 'video/mp4', userId);
  return m.path;
}

// Join clips end to end (re-encodes so clips from different providers always fit together). Returns a /media/ path.
async function concat(urls, { userId = null, aspect = '9:16' } = {}) {
  if (!available()) throw new Error('ffmpeg is not installed');
  return withTmp(async (dir) => {
    const files = [];
    for (const u of urls) files.push(await localFile(u, dir, userId));
    const [W, H] = sizeFor(aspect);
    const args = [];
    const parts = [];
    let extra = files.length;
    const nullInputs = [];
    files.forEach((f, i) => {
      args.push('-i', f);
      const pr = probe(f);
      if (!pr.audio) { nullInputs.push({ i, dur: pr.duration || 5 }); }
    });
    for (const n of nullInputs) { args.push('-f', 'lavfi', '-t', String(n.dur), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'); n.a = extra++; }
    files.forEach((f, i) => {
      const na = nullInputs.find((n) => n.i === i);
      parts.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`);
      parts.push(`[${na ? na.a : i}:a]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
    });
    const chain = files.map((_, i) => `[v${i}][a${i}]`).join('');
    parts.push(`${chain}concat=n=${files.length}:v=1:a=1[v][a]`);
    const out = path.join(dir, 'out.mp4');
    await exec([...args, '-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
    return saveOut(out, userId);
  });
}

// Slideshow: each image gets a slow ken-burns zoom, captions burned in when the subtitles filter is available.
async function slideshow({ images, audioUrl, srt, seconds, aspect = '9:16', userId = null }) {
  if (!available()) throw new Error('ffmpeg is not installed');
  return withTmp(async (dir) => {
    const files = [];
    for (const u of images) files.push(await localFile(u, dir, userId));
    let audio = null;
    if (audioUrl) { try { audio = await localFile(audioUrl, dir, userId); if (!probe(audio).audio) audio = null; } catch { audio = null; } }
    const [W, H] = sizeFor(aspect);
    const per = Math.max(1.5, seconds / files.length);
    const frames = Math.round(per * 30);
    const args = [];
    files.forEach((f) => args.push('-i', f)); // one still frame each: zoompan turns it into exactly `frames` frames
    if (audio) args.push('-i', audio);
    const parts = files.map((_, i) => `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0012,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=30,setsar=1,format=yuv420p[s${i}]`);
    parts.push(files.map((_, i) => `[s${i}]`).join('') + `concat=n=${files.length}:v=1:a=0[base]`);
    const srtFile = path.join(dir, 'captions.srt');
    if (srt) fs.writeFileSync(srtFile, srt);
    const out = path.join(dir, 'out.mp4');
    const run = async (burn) => {
      const p = [...parts, burn ? `[base]subtitles=${srtFile.replace(/[:\\']/g, '\\$&')}:force_style='FontSize=14,Bold=1,Outline=2,Alignment=2,MarginV=60'[v]` : '[base]null[v]'];
      const a = audio ? ['-map', `${files.length}:a`, '-c:a', 'aac', '-b:a', '128k'] : [];
      await exec([...args, '-filter_complex', p.join(';'), '-map', '[v]', ...a, '-t', String(per * files.length), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', out]);
    };
    let captioned = false;
    if (srt && hasFilter('subtitles')) { try { await run(true); captioned = true; } catch (e) { console.warn('[stitch] captions skipped:', e.message.slice(0, 200)); await run(false); } }
    else await run(false);
    return { url: saveOut(out, userId), captioned };
  });
}

// ---------- Fonts ----------
// Bundled Inter ExtraBold (SIL OFL, server/assets/fonts), else a bold system font. VIDEO_FONT overrides.
let fontCache;
function fontFile() {
  if (fontCache !== undefined) return fontCache;
  const tries = [process.env.VIDEO_FONT, path.join(__dirname, 'assets', 'fonts', 'Inter-ExtraBold.otf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf', '/run/current-system/sw/share/X11/fonts/DejaVuSans-Bold.ttf'];
  fontCache = tries.find((f) => f && fs.existsSync(f)) || null;
  return fontCache;
}
const fesc = (p) => String(p).replace(/\\/g, '/').replace(/[:']/g, '\\$&');

// ---------- Audio mix ----------
// Voice on top, music ducked under it (sidechaincompress), loudness normalised to -14 LUFS. Returns filter text ending in [aout].
function audioGraph({ voice, music, seconds }) {
  const S = seconds.toFixed(2);
  const norm = 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100';
  const parts = [];
  if (voice) parts.push(`${voice}aresample=44100,aformat=channel_layouts=stereo,apad,atrim=0:${S},asetpts=PTS-STARTPTS[voice]`);
  if (music) parts.push(`${music}aresample=44100,aformat=channel_layouts=stereo,atrim=0:${S},asetpts=PTS-STARTPTS,volume=-10dB,afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, seconds - 1.5).toFixed(2)}:d=1.5[mus]`);
  if (voice && music) parts.push(`[voice]asplit=2[v1][v2]`, `[mus][v2]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[duck]`, `[v1][duck]amix=inputs=2:duration=first:normalize=0,${norm}[aout]`);
  else if (voice) parts.push(`[voice]${norm}[aout]`);
  else if (music) parts.push(`[mus]${norm}[aout]`);
  return parts;
}

// Put music under an existing video's soundtrack (UGC, b-roll, slideshow). Returns a /media/ path.
async function mixMusic(videoUrl, musicUrl, { userId = null } = {}) {
  if (!available()) throw new Error('ffmpeg is not installed');
  return withTmp(async (dir) => {
    const v = await localFile(videoUrl, dir, userId);
    const m = await localFile(musicUrl, dir, userId);
    const pv = probe(v);
    if (!probe(m).audio) throw new Error('The music file has no audio.');
    const seconds = pv.duration || 15;
    const args = ['-i', v, '-stream_loop', '-1', '-i', m];
    const graph = audioGraph({ voice: pv.audio ? '[0:a]' : null, music: '[1:a]', seconds });
    const out = path.join(dir, 'out.mp4');
    await exec([...args, '-filter_complex', graph.join(';'), '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', seconds.toFixed(2), '-movflags', '+faststart', out]);
    return saveOut(out, userId);
  });
}

// ---------- Animated ad (motion_ad) ----------
const STYLE = {
  bold: { color: 'FF4A1C', transition: 'slideleft', y: 0.66 },
  clean: { color: '111111', transition: 'fade', y: 0.7 },
  luxury: { color: 'C8A24A', transition: 'fade', y: 0.72 },
  playful: { color: 'FF3EA5', transition: 'circleopen', y: 0.64 },
  tech: { color: '2F6BFF', transition: 'wipeleft', y: 0.68 },
};
const hex = (c, d) => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? String(c).replace('#', '').toUpperCase() : d);
// Split a headline over two lines when it is long.
function wrap(text, max = 16) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.join(' ').length <= max || words.length < 2) return words.join(' ');
  let best = 1, diff = Infinity;
  for (let k = 1; k < words.length; k++) { const d = Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length); if (d < diff) { diff = d; best = k; } }
  return words.slice(0, best).join(' ') + '\n' + words.slice(best).join(' ');
}

// scenes: [{url, type:'video'|'image', headline}], plus voice/music URLs, brand colour, style, logo, product photo and CTA.
async function motionAd({ scenes, voiceUrl, musicUrl, seconds, aspect = '9:16', brandColor, style = 'bold', logoUrl, imageUrl, cta, product, userId = null }) {
  if (!available()) throw new Error('ffmpeg is not installed');
  if (!hasFilter('drawtext') || !hasFilter('xfade')) throw new Error('This ffmpeg build lacks drawtext or xfade.');
  const font = fontFile();
  return withTmp(async (dir) => {
    const [W, H] = sizeFor(aspect);
    const st = STYLE[style] || STYLE.bold;
    const brand = '0x' + hex(brandColor, st.color);
    const n = scenes.length;
    const T = 0.35;
    const E = Math.min(3, Math.max(2, seconds * 0.15));
    const D = (seconds - E + n * T) / n;
    const frames = Math.round(D * 30);
    const fsz = Math.round(W * (aspect === '16:9' ? 0.05 : 0.075));
    const fontArg = font ? `fontfile='${fesc(font)}':` : '';
    const args = [];
    const parts = [];
    let idx = 0;
    for (let k = 0; k < n; k++) {
      const s = scenes[k];
      const f = await localFile(s.url, dir, userId);
      const isImg = s.type === 'image' || /\.(png|jpe?g|webp)$/i.test(f);
      if (isImg) args.push('-i', f); else args.push('-stream_loop', '-1', '-t', D.toFixed(2), '-i', f);
      const base = isImg
        ? `[${idx}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0016,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=30`
        : `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,trim=duration=${D.toFixed(2)},setpts=PTS-STARTPTS`;
      const tf = path.join(dir, `h${k}.txt`);
      fs.writeFileSync(tf, wrap(s.headline));
      // Kinetic headline: slides up and fades in on a brand-colour box; thin brand bar along the bottom.
      const text = `drawtext=${fontArg}textfile='${fesc(tf)}':fontsize=${fsz}:fontcolor=white:line_spacing=${Math.round(fsz * 0.2)}:box=1:boxcolor=${brand}@0.92:boxborderw=${Math.round(fsz * 0.45)}:x=(w-text_w)/2:y=h*${st.y}+${Math.round(H * 0.05)}*max(0\\,1-t/0.45):alpha='min(1\\,max(0\\,(t-0.15)/0.35))'`;
      parts.push(`${base},setsar=1,format=yuv420p,${text},drawbox=x=0:y=ih-${Math.round(H * 0.012)}:w=iw:h=${Math.round(H * 0.012)}:color=${brand}:t=fill,fps=30,format=yuv420p[s${k}]`);
      idx++;
    }
    // End card: dark ground, logo on top, product photo, product name and the CTA in a brand-colour box.
    args.push('-f', 'lavfi', '-t', E.toFixed(2), '-i', `color=c=0x0B0B0A:s=${W}x${H}:r=30`);
    const bgI = idx++;
    let card = `[${bgI}:v]format=yuv420p[e0]`;
    let last = 'e0';
    for (const [url, wPct, yPct, name] of [[imageUrl, 0.6, 0.2, 'ph'], [logoUrl, 0.26, 0.06, 'lg']]) {
      if (!url) continue;
      let f;
      try { f = await localFile(url, dir, userId); } catch { continue; }
      args.push('-loop', '1', '-t', E.toFixed(2), '-i', f);
      card += `;[${idx}:v]scale=${Math.round(W * wPct)}:-2,format=rgba[${name}];[${last}][${name}]overlay=(W-w)/2:H*${yPct}:shortest=1[${name}o]`;
      last = name + 'o';
      idx++;
    }
    const nameFile = path.join(dir, 'name.txt');
    const ctaFile = path.join(dir, 'cta.txt');
    fs.writeFileSync(nameFile, wrap(String(product || '').slice(0, 40), 22));
    fs.writeFileSync(ctaFile, String(cta || 'Shop now').slice(0, 30));
    card += `;[${last}]drawtext=${fontArg}textfile='${fesc(nameFile)}':fontsize=${Math.round(fsz * 0.7)}:fontcolor=white:x=(w-text_w)/2:y=h*0.68,`
      + `drawtext=${fontArg}textfile='${fesc(ctaFile)}':fontsize=${Math.round(fsz * 0.8)}:fontcolor=white:box=1:boxcolor=${brand}:boxborderw=${Math.round(fsz * 0.5)}:x=(w-text_w)/2:y=h*0.8:alpha='min(1\\,t/0.4)',fps=30,format=yuv420p[end]`;
    parts.push(card);
    // Scene cuts with short transitions, then the end card.
    let cur = 's0', len = D;
    for (let k = 1; k < n; k++) {
      parts.push(`[${cur}][s${k}]xfade=transition=${st.transition}:duration=${T}:offset=${(len - T).toFixed(3)}[x${k}]`);
      cur = `x${k}`; len += D - T;
    }
    parts.push(`[${cur}][end]xfade=transition=fade:duration=${T}:offset=${(len - T).toFixed(3)}[vout]`);
    // Audio: voiceover on top, music ducked underneath, -14 LUFS.
    let voice = null, music = null;
    if (voiceUrl) { try { const f = await localFile(voiceUrl, dir, userId); if (probe(f).audio) { args.push('-i', f); voice = `[${idx++}:a]`; } } catch {} }
    if (musicUrl) { try { const f = await localFile(musicUrl, dir, userId); if (probe(f).audio) { args.push('-stream_loop', '-1', '-i', f); music = `[${idx++}:a]`; } } catch {} }
    const audio = audioGraph({ voice, music, seconds });
    if (!audio.length) { args.push('-f', 'lavfi', '-t', seconds.toFixed(2), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'); audio.push(`[${idx++}:a]anull[aout]`); }
    const out = path.join(dir, 'out.mp4');
    await exec([...args, '-filter_complex', [...parts, ...audio].join(';'), '-map', '[vout]', '-map', '[aout]', '-t', seconds.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
    return { url: saveOut(out, userId), font: font ? path.basename(font) : null, voice: !!voice, music: !!music };
  });
}

module.exports = { guardArgs, registerInput, INPUT_FMT, withTmpDir: withTmp, safeDownload, assertPublic, available, concat, slideshow, probe, localFile, hasFilter, mixMusic, motionAd, fontFile, wrap, audioGraph };
