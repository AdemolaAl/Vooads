#!/usr/bin/env node
// Adds a music bed to the silent music-only samples (product, café and property clips). The bed is ours: a warm chord pad
// synthesised here plus the in-house beat from server/sfx.js (no samples, no licences). Run once; it rewrites the mp4s in
// public/samples with the video stream copied and an AAC track added.
//   node scripts/music-beds.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sfx = require('../server/sfx');

const SR = sfx.SR;
const BEDS = {
  'biz-cafe-promo': { bpm: 92, chords: [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]], beat: 0.35 },
  'biz-real-estate': { bpm: 80, chords: [[196.0, 246.94, 293.66], [164.81, 196.0, 246.94], [130.81, 164.81, 196.0], [146.83, 185.0, 220.0]], beat: 0.18 },
  'style-product-headphones': { bpm: 118, chords: [[110.0, 164.81, 220.0], [98.0, 146.83, 196.0], [87.31, 130.81, 174.61], [98.0, 146.83, 196.0]], beat: 0.6 },
};

function pad(seconds, bpm, chords) {
  const len = Math.round(seconds * SR), x = new Float32Array(len), bar = (60 / bpm) * 4;
  for (let i = 0; i < len; i++) {
    const t = i / SR, c = chords[Math.floor(t / bar) % chords.length], u = (t % bar) / bar;
    const env = Math.min(1, u * 6) * Math.min(1, (1 - u) * 8);
    let v = 0;
    for (const f of c) v += Math.sin(2 * Math.PI * f * t) * 0.6 + Math.sin(2 * Math.PI * f * 2 * t) * 0.12 + Math.sin(2 * Math.PI * f * 0.5 * t) * 0.2;
    x[i] = (v / c.length) * env * 0.5;
  }
  return x;
}

function run(name, cfg) {
  const file = path.join(__dirname, '..', 'public', 'samples', name + '.mp4');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (probe.stdout.trim()) { console.log(name, 'already has audio, skipped'); return; }
  const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout) || 6;
  const p = pad(dur, cfg.bpm, cfg.chords), b = sfx.beat(cfg.bpm, dur, 9);
  const mix = new Float32Array(p.length);
  let peak = 0;
  for (let i = 0; i < mix.length; i++) { mix[i] = p[i] + (b[i] || 0) * cfg.beat; peak = Math.max(peak, Math.abs(mix[i])); }
  const fade = Math.round(0.6 * SR);
  for (let i = 0; i < mix.length; i++) { mix[i] = (mix[i] / (peak || 1)) * 0.7; if (i < fade) mix[i] *= i / fade; if (i > mix.length - fade) mix[i] *= (mix.length - i) / fade; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bed-'));
  const wav = path.join(tmp, 'bed.wav'), out = path.join(tmp, 'out.mp4');
  fs.writeFileSync(wav, sfx.wav(mix));
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '96k', '-af', 'loudnorm=I=-20:TP=-2', '-shortest', '-movflags', '+faststart', out]);
  if (r.status !== 0) throw new Error(String(r.stderr));
  fs.copyFileSync(out, file);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(name, 'music bed added');
}
for (const [n, c] of Object.entries(BEDS)) run(n, c);
