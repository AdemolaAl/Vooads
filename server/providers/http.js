// "Custom API" provider: connect any HTTP API without writing code.
// In the admin set: config.url, config.method (POST), config.headers (JSON, use {{key}} for the API key),
// config.body (JSON template using {{prompt}}, {{text}}, {{seconds}}/{{duration}}, {{aspect}}, {{image_url}}, {{audio_url}}, {{model}}),
// config.output_path (where the result is, e.g. "data.url" or "choices.0.message.content").
// For APIs that return a job id first: config.poll_url (use {{id}}), config.id_path, config.done_path + config.done_value
// (+ config.fail_value, config.result_path for the finished answer when it differs from output_path).
// Templates are filled by ./httptpl.js: values go INTO the parsed JSON, so a prompt can never change the request's structure.
const { req, pick } = require('./net');
const tpl = require('./httptpl');

const DEFAULT_HEADERS = { Authorization: 'Bearer {{key}}' };

// Every variable a template can use. seconds and duration are the same number.
function varsFor(p, kind, input = {}) {
  const seconds = Number(input.seconds ?? input.duration) || undefined;
  return {
    prompt: String(input.prompt ?? input.text ?? ''), text: String(input.text ?? input.prompt ?? ''), system: String(input.system || ''),
    seconds: seconds ?? '', duration: seconds ?? '', aspect: String(input.aspect || ''), size: String(input.size || ''),
    image_url: String(input.image_url || ''), audio_url: String(input.audio_url || ''), video_url: String(input.video_url || ''),
    voice_id: String(input.voice_id || ''), mood: String(input.mood || ''), kind, model: p.model || '', key: p.apiKey || '',
  };
}

// The exact request this provider sends for `input` (used by submit and by the admin "Test run" preview).
function build(p, kind, input) {
  const c = p.config || {};
  if (!c.url) throw new Error('This custom provider has no URL set.');
  const vars = varsFor(p, kind, input);
  const method = String(c.method || 'POST').toUpperCase();
  const headers = tpl.renderHeaders(c.headers || DEFAULT_HEADERS, vars);
  const body = method === 'GET' ? undefined : c.body ? tpl.render(c.body, vars) : { prompt: vars.prompt, model: p.model || undefined };
  return { url: tpl.renderUrl(c.url, vars), method, headers, body };
}

function resultOf(kind, val) { return kind === 'text' ? { text: typeof val === 'string' ? val : JSON.stringify(val) } : { url: String(val) }; }

async function submit(p, kind, input) {
  const c = p.config;
  const r = build(p, kind, input);
  const data = await req(r.url, { method: r.method, headers: r.headers, body: r.body, timeout: 120000 });
  if (c.poll_url) {
    const id = pick(data, c.id_path || 'id');
    if (id === undefined || id === null || id === '') throw new Error('The custom API answered but no job id was found at ' + (c.id_path || 'id'));
    return { done: false, handle: { id: String(id), kind } };
  }
  const val = pick(data, c.output_path || 'url');
  if (val === undefined || val === null || val === '') throw new Error('The custom API answered but nothing was found at ' + (c.output_path || 'url'));
  return { done: true, result: resultOf(kind, val) };
}

async function poll(p, h) {
  const c = p.config;
  const vars = { ...varsFor(p, h.kind, {}), id: h.id };
  const data = await req(tpl.renderUrl(c.poll_url, vars), { headers: tpl.renderHeaders(c.headers || DEFAULT_HEADERS, vars), timeout: 30000 });
  const doneVal = pick(data, c.done_path || 'status');
  if (String(doneVal) !== String(c.done_value || 'completed')) {
    if (c.fail_value && String(doneVal) === String(c.fail_value)) return { done: true, error: 'The custom API reported a failure.' };
    return { done: false };
  }
  const path = c.result_path || c.output_path || 'url';
  const val = pick(data, path);
  return val !== undefined && val !== null && val !== '' ? { done: true, result: resultOf(h.kind, val) } : { done: true, error: 'No result at ' + path };
}

module.exports = { submit, poll, build, varsFor };
