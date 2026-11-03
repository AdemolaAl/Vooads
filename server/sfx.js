// Sound effects and a beat for Mad edit, synthesised here from noise and sine waves (no samples, no licences: we made them).
// Every sound is deterministic (seeded noise), 44.1 kHz mono 16-bit WAV.
//   whoosh  band-swept noise that rises and falls, for a cut
//   impact  a low thump with a pitch drop and a short noise crack, for a big text hit
//   riser   rising noise + tone, leading into the first cut
//   beat(bpm, seconds)  kick on every beat, hat on the off-beats, clap on 2 and 4: the grid the cuts follow
const SR = 44100;

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s / 4294967296) * 2 - 1; }; }
const clamp = (x) => Math.max(-1, Math.min(1, x));

function wav(samples) {
  const n = samples.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(clamp(samples[i]) * 32767), 44 + i * 2);
  return buf;
}

// One-pole low-pass with a moving cutoff (Hz as a function of 0..1 progress).
function sweepNoise(len, cutoff, seed) {
  const r = rng(seed), out = new Float32Array(len);
  let y = 0;
  for (let i = 0; i < len; i++) {
    const a = 1 - Math.exp((-2 * Math.PI * cutoff(i / len)) / SR);
    y += a * (r() - y);
    out[i] = y;
  }
  return out;
}
function normalize(x, peak = 0.9) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); if (m > 0) for (let i = 0; i < x.length; i++) x[i] = (x[i] / m) * peak; return x; }

function whoosh(seconds = 0.45, seed = 7) {
  const len = Math.round(seconds * SR);
  const x = sweepNoise(len, (t) => 300 + 5200 * Math.sin(Math.PI * t) ** 2, seed);
  for (let i = 0; i < len; i++) { const t = i / len; x[i] *= Math.sin(Math.PI * t) ** 1.6; }
  return normalize(x, 0.8);
}
function impact(seconds = 0.6, seed = 11) {
  const len = Math.round(seconds * SR), x = new Float32Array(len), r = rng(seed);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR, f = 38 + 110 * Math.exp(-t * 22);
    ph += (2 * Math.PI * f) / SR;
    const body = Math.sin(ph) * Math.exp(-t * 6.5);
    const crack = r() * Math.exp(-t * 60) * 0.55;
    x[i] = Math.tanh((body + crack) * 1.8);
  }
  return normalize(x, 0.95);
}
function riser(seconds = 1.2, seed = 5) {
  const len = Math.round(seconds * SR);
  const x = sweepNoise(len, (t) => 200 + 7000 * t * t, seed);
  let ph = 0;
  for (let i = 0; i < len; i++) { const t = i / len; ph += (2 * Math.PI * (220 + 660 * t * t)) / SR; x[i] = (x[i] * 0.8 + Math.sin(ph) * 0.15) * t ** 1.5; }
  return normalize(x, 0.7);
}
function beat(bpm = 124, seconds = 15, seed = 3) {
  const len = Math.round(seconds * SR), x = new Float32Array(len), r = rng(seed);
  const spb = 60 / bpm;
  const add = (start, fn, dur) => { const s0 = Math.round(start * SR), n = Math.round(dur * SR); for (let i = 0; i < n && s0 + i < len; i++) x[s0 + i] += fn(i / SR); };
  const kick = (t) => Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9) * 0.9;
  const hat = (t) => r() * Math.exp(-t * 90) * 0.18;
  const clap = (t) => r() * (Math.exp(-t * 35) + 0.4 * Math.exp(-Math.abs(t - 0.012) * 300)) * 0.35;
  for (let b = 0, t = 0; t < seconds; b++, t = b * spb) {
    add(t, kick, 0.35);
    add(t + spb / 2, hat, 0.06);
    if (b % 2 === 1) add(t, clap, 0.2);
  }
  // A soft bass pulse on the beat so the bed is not only drums.
  const notes = [55, 55, 65.41, 49];
  for (let b = 0, t = 0; t < seconds; b++, t = b * spb) { const f = notes[Math.floor(b / 4) % 4]; add(t, (u) => Math.sin(2 * Math.PI * f * u) * Math.min(1, u * 80) * Math.exp(-u * 4) * 0.35, spb * 0.9); }
  const fade = Math.round(0.8 * SR);
  for (let i = 0; i < fade && i < len; i++) x[len - 1 - i] *= i / fade;
  return normalize(x, 0.85);
}

const make = { whoosh: () => wav(whoosh()), impact: () => wav(impact()), riser: () => wav(riser()), beat: (bpm, s) => wav(beat(bpm, s)) };
// Beat grid: the time of every beat in [0, seconds).
const grid = (bpm, seconds) => { const out = []; for (let t = 0, b = 0; t < seconds - 1e-6; b++, t = (b * 60) / bpm) out.push(Math.round(t * 1000) / 1000); return out; };

module.exports = { SR, wav, whoosh, impact, riser, beat, make, grid };
