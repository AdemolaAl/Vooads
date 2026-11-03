// Replicate (replicate.com): thousands of open models behind one API key. Get a key at https://replicate.com/account/api-tokens
// Model: "owner/name" for official models (e.g. black-forest-labs/flux-schnell), or "owner/name:version" / a bare version id.
// config.input: JSON template of the model inputs, e.g. {"prompt": "{{prompt}}", "duration": {{seconds}}} (filled safely, see httptpl.js).
// config.output_path: where the file/text is in the finished prediction's "output" (default: the output itself, or its first item).
const { req, pick } = require('./net');
const tpl = require('./httptpl');
const { varsFor } = require('./http');

const API = 'https://api.replicate.com/v1';
const auth = (p) => ({ Authorization: 'Bearer ' + p.apiKey });

function defaultInput(kind) {
  if (kind === 'image') return { prompt: '{{prompt}}', aspect_ratio: '{{aspect}}' };
  if (kind === 'video') return { prompt: '{{prompt}}', duration: '{{seconds}}' };
  if (kind === 'voice') return { text: '{{text}}' };
  if (kind === 'music') return { prompt: '{{prompt}}', duration: '{{seconds}}' };
  if (kind === 'ugc' || kind === 'dub') return { image: '{{image_url}}', audio: '{{audio_url}}', video: '{{video_url}}' };
  return { prompt: '{{prompt}}' };
}

// The request this provider sends (submit and the admin preview).
function build(p, kind, input) {
  const model = String(p.model || '').trim();
  if (!model) throw new Error('Set the Replicate model, e.g. black-forest-labs/flux-schnell');
  const vars = varsFor(p, kind, input);
  const filled = tpl.render(p.config?.input || defaultInput(kind), vars) || {};
  // Drop empty optional inputs so the model uses its own defaults.
  const inputs = Object.fromEntries(Object.entries(filled).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  const [name, version] = model.includes(':') ? model.split(':') : /^[a-f0-9]{40,}$/i.test(model) ? [null, model] : [model, null];
  if (version) return { url: API + '/predictions', method: 'POST', headers: auth(p), body: { version, input: inputs } };
  return { url: API + '/models/' + name.split('/').map(encodeURIComponent).join('/') + '/predictions', method: 'POST', headers: auth(p), body: { input: inputs } };
}

function outputOf(p, kind, out) {
  let v = p.config?.output_path ? pick(out, p.config.output_path) : out;
  if (Array.isArray(v)) v = kind === 'text' ? v.join('') : v[0];
  if (v && typeof v === 'object') v = v.url || v.uri || JSON.stringify(v);
  return v;
}

async function submit(p, kind, input) {
  const r = build(p, kind, input);
  const data = await req(r.url, { method: 'POST', headers: r.headers, body: r.body, timeout: 60000 });
  if (data.status === 'succeeded') {
    const v = outputOf(p, kind, data.output);
    if (!v) throw new Error('Replicate finished but returned no output. Check the output path.');
    return { done: true, result: kind === 'text' ? { text: String(v) } : { url: String(v) } };
  }
  if (!data.urls?.get) throw new Error('Replicate did not return a prediction link.');
  return { done: false, handle: { get: data.urls.get, kind } };
}

async function poll(p, h) {
  const d = await req(h.get, { headers: auth(p), timeout: 30000 });
  if (d.status === 'starting' || d.status === 'processing') return { done: false, progress: d.status === 'processing' ? 0.6 : 0.2 };
  if (d.status !== 'succeeded') return { done: true, error: 'Replicate: ' + (d.error || d.status) };
  const v = outputOf(p, h.kind, d.output);
  return v ? { done: true, result: h.kind === 'text' ? { text: String(v) } : { url: String(v) } } : { done: true, error: 'Replicate returned no output. Check the output path.' };
}

async function test(p) {
  try {
    await req(API + '/account', { headers: auth(p), timeout: 20000 });
    return { ok: true, note: 'Key accepted by Replicate.' };
  } catch (e) {
    return { ok: false, note: e.status === 401 ? 'Replicate rejected the key.' : e.message.slice(0, 120) };
  }
}

module.exports = { submit, poll, test, build, defaultInput };
