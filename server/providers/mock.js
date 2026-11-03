// Demo provider. Used automatically when no real provider is set up, so every screen works before keys are added.
// Outputs are sample files, clearly marked "Demo" in the app.
const SAMPLE_UGC = ['ugc-serum.mp4', 'ugc-sunscreen.mp4', 'ugc-protein.mp4', 'ugc-saas.mp4', 'ugc-fintech.mp4', 'ugc-sneakers.mp4', 'ugc-serum-es.mp4', 'ugc-language-app.mp4'];
const SAMPLE_IMG = ['creator-3.png', 'creator-4.png', 'creator-5.png', 'creator-6.png'];
let n = 0;

function demoText(input) {
  if (input.mode === 'hooks') {
    const topic = input.topic || 'your product';
    return JSON.stringify([
      `Stop scrolling if ${topic} is on your list this month.`,
      `I tried ${topic} for 14 days. Here's what happened.`,
      `Nobody told me ${topic} could be this easy.`,
      `3 reasons people switch to ${topic}.`,
      `The honest review of ${topic} you were waiting for.`,
      `I almost didn't buy ${topic}. Glad I did.`,
      `This is your sign to try ${topic}.`,
      `POV: you finally found ${topic} that works.`,
      `What I wish I knew before trying ${topic}.`,
      `Is ${topic} worth it? Let me show you.`,
      `My friends keep asking about ${topic}. So here it is.`,
      `Before and after one week of ${topic}.`,
      `${topic}: the 10-second version.`,
      `If you hate wasting money, watch this.`,
      `I tested 5 options. ${topic} won.`,
      `Do not buy ${topic} until you see this.`,
      `Here's how I use ${topic} every day.`,
      `The small change that made a big difference.`,
      `You asked, so here's my ${topic} routine.`,
      `This replaced 3 things I used to pay for.`,
    ]);
  }
  if (input.mode === 'script') {
    return JSON.stringify({
      hook: `Okay, I need to talk about ${input.topic || 'this'}.`,
      lines: [
        `Okay, I need to talk about ${input.topic || 'this'}.`,
        `I was skeptical at first, honestly.`,
        `But after a week it just became part of my routine.`,
        `It's simple, it works, and it saves me time.`,
        `If you've been on the fence, this is your sign. Link's below.`,
      ],
      cta: 'Tap the link to try it today.',
      angle: 'Personal discovery',
    });
  }
  if (input.mode === 'shield') return JSON.stringify({ score: 92, flags: [] });
  const topic = input.topic || 'your product';
  if (input.mode === 'angles') {
    const base = [
      ['Time saved', `I got my mornings back with ${topic}.`, 'Busy buyers pay for time; the hook names a concrete win.'],
      ['Problem first', `This is the problem nobody talks about with ${topic}.`, 'Opening on the pain earns attention before the pitch.'],
      ['Skeptic converted', `I didn't believe ${topic} would work for me.`, 'Doubt mirrors the viewer and makes the turn credible.'],
      ['Demo', `Watch what happens when I use ${topic} for 10 seconds.`, 'Showing beats telling and keeps hold rate up.'],
      ['Comparison', `I tried three options before ${topic}.`, 'Positions the product as the considered choice without naming rivals.'],
      ['Routine', `Here's where ${topic} fits in my day.`, 'Routine content feels native to the feed.'],
      ['Objection', `"Is ${topic} worth the price?" Let's see.`, 'Answers the main reason people do not buy.'],
      ['Gift', `The gift I keep recommending: ${topic}.`, 'Opens a second buyer: people shopping for someone else.'],
      ['Mistake', `The mistake I made before finding ${topic}.`, 'Mistake hooks create curiosity and feel honest.'],
      ['Quick win', `One small change: ${topic}.`, 'Low-effort promise without overclaiming.'],
    ];
    return JSON.stringify(base.map(([angle, hook, why]) => ({ angle, hook, why })));
  }
  if (input.mode === 'slides') {
    const n = Math.max(4, Math.min(8, Number(input.count) || 6));
    const lines = [`Still looking for ${topic}?`, 'Here is what changed for me.', 'Simple to start.', 'Fits into a busy day.', 'Made with care.', 'People keep asking about it.', 'Easy to try.', 'Tap to see the offer.'];
    return JSON.stringify(lines.slice(0, n - 1).concat('Tap the link to try it today.'));
  }
  if (input.mode === 'tool') {
    // AI tools (Admin → AI tools) in demo mode: a believable sample in the shape the tool returns.
    const t = String(topic).slice(0, 60);
    const lines = [`${t}: the small upgrade your routine was missing.`, `Real results, no filters. Meet ${t}.`, `Why everyone keeps asking about ${t}.`, `Your sign to finally try ${t}.`, `${t}, made for busy days.`];
    return input.output === 'list' ? lines.join('\n') : `Demo sample for "${t}". ${lines[0]} Add an AI text provider in Admin → AI providers for real results.`;
  }
  if (input.mode === 'translate') return JSON.stringify({ language: input.language || 'es', text: String(input.text || '') });
  if (input.mode === 'hook_remix') {
    const n = Math.max(1, Math.min(10, Number(input.count) || 3));
    return JSON.stringify([`Wait, before you scroll: ${topic}.`, `Nobody told me this about ${topic}.`, `POV: you finally tried ${topic}.`, `This changed how I shop for ${topic}.`, `Okay, real talk about ${topic}.`, `Three seconds. That is all ${topic} needs.`, `I was today years old when I found ${topic}.`, `Stop overpaying. Look at ${topic}.`, `Here is the trick with ${topic}.`, `My honest take on ${topic}.`].slice(0, n));
  }
  if (input.mode === 'street') {
    return JSON.stringify({ guest: 'a woman in her thirties with a denim jacket and sunglasses on her head', lines: [
      { who: 'host', text: 'Quick question! What is in your bag right now?' },
      { who: 'guest', text: `Honestly? ${topic}. I take it everywhere.` },
      { who: 'host', text: 'Why that one?' },
      { who: 'guest', text: 'It is simple, it works, and it does not slow me down.' },
      { who: 'host', text: 'Would you tell a friend?' },
      { who: 'guest', text: 'I already did. Twice.' },
    ] });
  }
  if (input.mode === 'mad_edit') return JSON.stringify({ hits: ['New drop', 'Zero fuss', 'Shop now'], caption: `This is ${topic} and it changes your whole morning`, shots: [`${topic} spinning on a pedestal`, `hands grabbing ${topic}`, `${topic} close-up with fast push-in`] });
  if (input.mode === 'motion_plan') {
    const n = Math.max(4, Math.min(8, Number(input.count) || 5));
    const scenes = [
      { headline: 'Tired of the same routine?', vo: `If your day needs a reset, meet ${topic}.`, query: 'person stretching morning sunlight' },
      { headline: `Meet ${String(topic).split(' ').slice(0, 3).join(' ')}`, vo: 'Made to fit into a busy life without the fuss.', query: 'product on clean table close up' },
      { headline: 'Simple from day one', vo: 'Set it up in minutes and it just works.', query: 'hands unboxing package' },
      { headline: 'Looks good, works better', vo: 'Clean design you will actually want to use.', query: 'modern apartment lifestyle' },
      { headline: 'Loved by busy people', vo: 'It saves time on the little things.', query: 'happy woman smiling phone' },
      { headline: 'Ready when you are', vo: 'Take it anywhere, use it every day.', query: 'city walk sunset' },
      { headline: 'Small change, big difference', vo: 'One small switch can change the whole day.', query: 'coffee morning desk' },
      { headline: 'Your turn', vo: 'Tap the link to see the offer.', query: 'friends laughing outdoors' },
    ].slice(0, n);
    scenes[scenes.length - 1] = { headline: 'Try it today', vo: input.cta || 'Tap the link to try it today.', query: 'happy customer thumbs up' };
    return JSON.stringify({ scenes, cta: input.cta || 'Shop now' });
  }
  if (input.mode === 'edit_plan') return JSON.stringify(demoEditPlan(input));
  return 'Demo text output. Add an AI text provider in Admin → AI providers to get real results.';
}

// Demo transcript for Auto-edit: a creator talking with a filler, a long pause and a repeated (bad) take.
const DEMO_LINES = ['So', 'I', 'tried', 'this', 'glow', 'serum', 'for', 'two', 'weeks.', 'Um,', 'honestly', 'my', 'skin', 'looks', 'brighter.', 'My', 'skin', 'looks', 'brighter', 'in', 'daylight,', 'no', 'filter.', 'It', 'takes', 'ten', 'seconds', 'every', 'morning.', 'Uh', 'the', 'best', 'part?', 'It', 'actually', 'works.', 'Try', 'it', 'today,', 'link', 'below.'];
function demoWords(duration) {
  const D = Math.max(3, Number(duration) || 15);
  const n = DEMO_LINES.length, words = [];
  const speak = D * 0.82, per = speak / n;
  let t = Math.min(0.4, D * 0.03);
  for (let i = 0; i < n; i++) {
    if (i === 9) t += Math.min(1.4, D * 0.06); // a long pause before "Um"
    const len = per * 0.8;
    words.push({ text: DEMO_LINES[i], start: Math.round(t * 1000) / 1000, end: Math.round(Math.min(D, t + len) * 1000) / 1000 });
    t += per;
    if (t > D - 0.2) break;
  }
  return words;
}
// Demo edit plan: cut the first take of a repeated line, use the strongest line as the hook, punch in on key words.
function demoEditPlan(input) {
  const w = Array.isArray(input.words) ? input.words : demoWords(input.duration);
  const idx = (t, from = 0) => w.findIndex((x, i) => i >= from && String(x.text).toLowerCase().replace(/[^a-z]/g, '') === t);
  const a = idx('honestly'), b = idx('my', a + 1), c = idx('brighter', b + 1);
  const remove = a >= 0 && b > a && c > b ? [{ start: w[b].start, end: w[c].end, reason: 'repeated take' }] : [];
  const h1 = idx('it', idx('part') + 1), h2 = idx('works', h1);
  const hook = h1 >= 0 && h2 > h1 ? { start: w[Math.max(0, h1 - 3)].start, end: w[h2].end } : null;
  const emphasis = w.filter((x) => /brighter|seconds|works|today/i.test(x.text)).map((x) => x.start).slice(0, 4);
  return { remove, hook, emphasis };
}

// Long demo work (background removal) runs off the worker loop; poll() picks up the result.
const BGWORK = new Map();

async function submit(p, kind, input) {
  n++;
  if (kind === 'text') return { done: true, result: { text: demoText(input) } };
  if (kind === 'stt') return { done: true, result: { words: demoWords(input.duration), text: DEMO_LINES.join(' '), language: 'en', demo: true } };
  if (kind === 'matting') {
    // Demo background removal: key out green with ffmpeg (works on green-screen footage; other footage keeps its background).
    const stitch = require('../stitch');
    if (!input.video_path || !stitch.available()) return { done: false, handle: { kind: 'video', at: Date.now(), file: SAMPLE_UGC[n % SAMPLE_UGC.length] } };
    const key = 'm' + Date.now() + n;
    const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
    const out = path.join(os.tmpdir(), 'vooads-matte-' + key + '.webm');
    BGWORK.set(key, require('../editkit').mockMatte(input.video_path, out).then(() => { const m = require('../media').save(fs.readFileSync(out), 'video/webm', input.user_id); fs.rmSync(out, { force: true }); return { url: m.path, codec: 'vp9', demo: true }; }));
    return { done: false, handle: { kind: 'matting', key } };
  }
  if (kind === 'music' && input.render_audio && require('../stitch').available()) {
    // Brand tracks in demo mode: a real (simple) audio file of the asked length, so previews and reuse work.
    const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
    const out = path.join(os.tmpdir(), 'vooads-music-' + Date.now() + n + '.mp3');
    await require('../editkit').mockMusic(input.seconds, out);
    const m = require('../media').save(fs.readFileSync(out), 'audio/mpeg', input.user_id);
    fs.rmSync(out, { force: true });
    return { done: true, result: { url: m.path, mood: input.mood || 'upbeat', source: 'demo' } };
  }
  if (kind === 'voice') return { done: true, result: { url: '/samples/' + SAMPLE_UGC[n % SAMPLE_UGC.length] } };
  if (kind === 'music') return { done: true, result: { url: '/samples/' + SAMPLE_UGC[n % SAMPLE_UGC.length], mood: input.mood || 'upbeat', source: 'demo' } };
  if (kind === 'stock') return { done: true, result: { url: '/samples/' + SAMPLE_UGC[n % SAMPLE_UGC.length], source: 'demo', credit: 'Demo sample' } };
  if (kind === 'image') return { done: false, handle: { kind, at: Date.now(), file: SAMPLE_IMG[n % SAMPLE_IMG.length] } };
  return { done: false, handle: { kind, at: Date.now(), file: SAMPLE_UGC[n % SAMPLE_UGC.length] } };
}

// MOCK_RENDER_MS shortens the fake render time (the self-check uses it).
async function poll(p, h) {
  if (h.kind === 'matting') {
    const pr = BGWORK.get(h.key);
    if (!pr) return { done: true, error: 'The demo background removal was interrupted (server restart).' };
    const r = await Promise.race([pr.then((x) => ({ x }), (e) => ({ e })), new Promise((res) => setTimeout(() => res(null), 30))]);
    if (!r) return { done: false, progress: 0.5 };
    BGWORK.delete(h.key);
    return r.e ? { done: true, error: r.e.message } : { done: true, result: r.x };
  }
  const ms = Number(process.env.MOCK_RENDER_MS) || 0;
  const wait = ms ? (h.kind === 'image' ? ms / 2 : ms) : h.kind === 'image' ? 2500 : 6000;
  if (Date.now() - h.at < wait) return { done: false, progress: Math.min(0.95, (Date.now() - h.at) / wait) };
  return { done: true, result: { url: '/samples/' + h.file } };
}

module.exports = { demoWords, demoEditPlan, submit, poll, test: async () => ({ ok: true, note: 'Demo provider. Outputs are samples.' }) };
