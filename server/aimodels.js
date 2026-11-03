// "Add AI model" wizard: pick what it makes, pick a preset (fal, ElevenLabs, OpenAI-compatible, Replicate or any HTTP API),
// enter the cost, test it (a safe dry run by default), and choose where it is used. The profit guard runs on save: quality
// levels and AI tools that would fall under the minimum margin are raised automatically and reported.
const { get, all, run, tx } = require('./db');
const { fail } = require('./lib/http');
const { encrypt, mask } = require('./lib/util');
const providers = require('./providers');
const tpl = require('./providers/httptpl');

// Wizard kinds → provider kinds. "ugc" covers talking presenters; "dub" lip-syncs an existing video.
const KINDS = {
  video: { label: 'Video', kind: 'video', unit: 'per second', sample: { prompt: 'A cinematic close-up of a glass serum bottle on a marble table, soft morning light', seconds: 5, aspect: '9:16' } },
  image: { label: 'Image', kind: 'image', unit: 'per image', sample: { prompt: 'A bright lifestyle photo of white sneakers on a city street, 4:5', aspect: '4:5', size: '1080x1350' } },
  voice: { label: 'Voice', kind: 'voice', unit: 'per 1k characters', sample: { text: 'Okay, I need to talk about this serum. My skin has never looked this good.' } },
  music: { label: 'Music', kind: 'music', unit: 'per minute', sample: { prompt: 'Upbeat, modern background music for a product ad', seconds: 15, mood: 'upbeat' } },
  text: { label: 'Text', kind: 'text', unit: 'per call', sample: { prompt: 'Write three short hooks for a vitamin C serum ad.', system: 'You write short ad copy.' } },
  ugc: { label: 'UGC presenter (lip-sync)', kind: 'ugc', unit: 'per second', sample: { prompt: 'Friendly creator talking to the phone camera', image_url: 'https://example.com/presenter.png', audio_url: 'https://example.com/voice.mp3', text: 'This serum changed my mornings.', seconds: 8 } },
  dub: { label: 'Lip-sync an existing video', kind: 'dub', unit: 'per second', sample: { video_url: 'https://example.com/ad.mp4', audio_url: 'https://example.com/voice-es.mp3', seconds: 15 } },
};

// Presets: which adapter, which fields the wizard shows, and sensible defaults. Fields map to provider.model / provider.config.
const PRESETS = {
  fal: { label: 'fal.ai model', adapter: 'fal', kinds: ['video', 'image', 'ugc', 'dub', 'music'], help: 'One fal key runs hundreds of models. Paste the model id from the model page on fal.ai.', key: 'fal.ai/dashboard/keys', keyOptional: true,
    fields: [{ k: 'model', l: 'Model id', ph: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', h: 'Copy it from the model page, e.g. fal-ai/bytedance/seedream/v4/text-to-image.' },
      { k: 'image_model', l: 'Photo-to-video model (optional)', ph: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', kinds: ['video'], cfg: 1 },
      { k: 'output_path', l: 'Result path (optional)', ph: 'video.url', h: 'Only if the file is not at the usual place in fal\'s answer.', cfg: 1 },
      { k: 'extra', l: 'Extra inputs (JSON, optional)', ph: '{ "resolution": "720p" }', json: 1, cfg: 1 }] },
  elevenlabs: { label: 'ElevenLabs', adapter: 'elevenlabs', kinds: ['voice'], help: 'Realistic voices. Use eleven_flash_v2_5 (cheap) or eleven_multilingual_v2 / eleven_v3 (best).', key: 'elevenlabs.io → Settings → API keys',
    fields: [{ k: 'model', l: 'Voice model', ph: 'eleven_multilingual_v2' }, { k: 'default_voice', l: 'Default voice id (optional)', ph: '21m00Tcm4TlvDq8ikWAM', cfg: 1 }, { k: 'tier', l: 'Voice quality', sel: ['standard', 'ultra'], cfg: 1 }] },
  elevenlabs_music: { label: 'ElevenLabs Music', adapter: 'elevenlabs_music', kinds: ['music'], help: 'Background music made for each ad. Same key as ElevenLabs voices.', key: 'elevenlabs.io → Settings → API keys', fields: [{ k: 'model', l: 'Model', ph: 'music_v1' }] },
  openai: { label: 'OpenAI-compatible', adapter: 'openai', kinds: ['text'], help: 'OpenAI, OpenRouter, Groq, Together and any API that speaks the OpenAI chat format.', key: 'platform.openai.com (or your host)',
    fields: [{ k: 'model', l: 'Model', ph: 'gpt-4o-mini' }, { k: 'base_url', l: 'API base URL (optional)', ph: 'https://openrouter.ai/api/v1', cfg: 1 }] },
  replicate: { label: 'Replicate', adapter: 'replicate', kinds: ['video', 'image', 'voice', 'music', 'text', 'ugc', 'dub'], help: 'Run any model on replicate.com. Use "owner/name" or "owner/name:version".', key: 'replicate.com/account/api-tokens',
    fields: [{ k: 'model', l: 'Model', ph: 'black-forest-labs/flux-schnell' }, { k: 'input', l: 'Model inputs (JSON template)', ph: '{ "prompt": "{{prompt}}", "aspect_ratio": "{{aspect}}" }', tpl: 1, cfg: 1, h: 'Use {{prompt}}, {{image_url}}, {{seconds}}, {{aspect}}, {{text}}, {{audio_url}}.' },
      { k: 'output_path', l: 'Result path (optional)', ph: '0', cfg: 1, h: 'Empty = the output itself, or its first item.' }] },
  http: { label: 'Any HTTP API', adapter: 'http', kinds: ['video', 'image', 'voice', 'music', 'text', 'ugc', 'dub'], help: 'Connect any API with a URL, headers and a JSON body. Templates are filled safely: what a customer types can never change the request.', key: 'whatever the API needs (used as {{key}})', keyOptional: true,
    fields: [{ k: 'url', l: 'Request URL', ph: 'https://api.example.com/v1/generate', cfg: 1 }, { k: 'method', l: 'Method', sel: ['POST', 'GET', 'PUT'], cfg: 1 },
      { k: 'headers', l: 'Headers (JSON)', ph: '{ "Authorization": "Bearer {{key}}" }', tpl: 1, cfg: 1 },
      { k: 'body', l: 'Body template (JSON)', ph: '{ "prompt": "{{prompt}}", "image_url": "{{image_url}}", "seconds": {{seconds}} }', tpl: 1, cfg: 1, h: 'Use {{prompt}}, {{image_url}}, {{seconds}}, {{aspect}}, {{text}}, {{audio_url}}, {{model}}. Numbers can go without quotes.' },
      { k: 'output_path', l: 'Result path', ph: 'data.url', cfg: 1, h: 'Where the file link (or the text) is in the answer.' },
      { k: 'poll_url', l: 'Status URL (slow APIs, optional)', ph: 'https://api.example.com/v1/jobs/{{id}}', cfg: 1 },
      { k: 'id_path', l: 'Job id path', ph: 'id', cfg: 1 }, { k: 'done_path', l: 'Status path', ph: 'status', cfg: 1 },
      { k: 'done_value', l: 'Status when done', ph: 'completed', cfg: 1 }, { k: 'fail_value', l: 'Status when failed', ph: 'failed', cfg: 1 },
      { k: 'result_path', l: 'Result path when done (optional)', ph: 'output.url', cfg: 1 }] },
};
const UNITS = ['per second', 'per minute', 'per image', 'per 1k characters', 'per call', 'per clip', 'per track'];

function meta() {
  const { pricing } = require('./settings');
  const levels = require('./levels');
  const types = (pricing().video_types || []).filter((t) => t && ['ugc', 'video'].includes(t.provider_kind) && Array.isArray(t.levels) && t.levels.length)
    .map((t) => ({ id: t.id, name: t.name, kind: t.provider_kind, levels: levels.list(t).map((l) => ({ id: l.id, name: l.name, model_label: l.model_label, provider_tag: l.provider_tag })) }));
  return { kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { label: v.label, kind: v.kind, unit: v.unit }])), presets: PRESETS, units: UNITS, level_types: types };
}

// Provider row (not saved) from wizard input. Keeps the saved key when editing an existing row.
function draftRow(b) {
  const k = KINDS[b.kind];
  if (!k) fail(400, 'Pick what the model makes.');
  const pr = PRESETS[b.preset];
  if (!pr) fail(400, 'Pick how to connect it.');
  if (!pr.kinds.includes(b.kind)) fail(400, `${pr.label} cannot make ${k.label.toLowerCase()} here. Pick another preset.`);
  const config = {};
  let model = '';
  for (const f of pr.fields) {
    const v = b.fields?.[f.k];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    if (f.json) { try { config[f.k] = typeof v === 'string' ? JSON.parse(v) : v; } catch { fail(400, `"${f.l}" is not valid JSON.`); } }
    else if (f.tpl) { const s = String(v); tpl.parse(s); config[f.k] = s.slice(0, 8000); } // parse = syntax check; stored as text, filled safely at run time
    else if (f.cfg) config[f.k] = String(v).trim().slice(0, 1000);
    else model = String(v).trim().slice(0, 300);
  }
  if (pr.adapter === 'http') {
    if (!config.url) fail(400, 'Add the request URL.');
    tpl.renderUrl(config.url, {});
    if (!config.poll_url && !config.output_path) fail(400, 'Add the result path (where the file link or text is in the answer).');
  }
  if (['fal', 'replicate', 'openai', 'elevenlabs', 'elevenlabs_music'].includes(pr.adapter) && !model && pr.adapter !== 'elevenlabs_music') fail(400, 'Add the model id.');
  const existing = b.provider_id ? providers.byId(Number(b.provider_id)) : null;
  const apiKey = String(b.api_key || '').trim() || existing?.apiKey || (pr.adapter === 'fal' ? providers.sharedKey('fal') : '');
  return { id: existing?.id || 0, name: String(b.name || '').trim().slice(0, 60) || `${pr.label} · ${k.label}`, kind: k.kind, adapter: pr.adapter, model, config, apiKey, enabled: 1, cost_usd: Number(b.cost_usd) || 0, cost_unit: String(b.cost_unit || k.unit) };
}

// The request the model would get for the sample input (secrets masked). Only for adapters whose request is template-built.
function preview(row, sample) {
  const a = providers.ADAPTERS[row.adapter];
  if (a.build) { const r = a.build(row, row.kind, sample); return tpl.mask(r, [row.apiKey]); }
  if (row.adapter === 'fal') return { method: 'POST', url: 'https://queue.fal.run/' + (row.model || '(model id)'), headers: { Authorization: 'Key ••••' + String(row.apiKey || '').slice(-4) }, body: { ...sample, ...(row.config.extra || {}) } };
  if (row.adapter === 'openai') return { method: 'POST', url: (row.config.base_url || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions', body: { model: row.model, messages: [{ role: 'user', content: sample.prompt }] } };
  if (row.adapter === 'elevenlabs') return { method: 'POST', url: `https://api.elevenlabs.io/v1/text-to-speech/${row.config.default_voice || '(voice id)'}`, body: { text: sample.text, model_id: row.model } };
  return { method: 'POST', url: '(set by ' + row.adapter + ')', body: sample };
}

// Test run. mode "dry" (default): build the real request for a sample and check paths against a pasted sample answer.
// mode "live": call the API for real (may cost a little), poll up to 60 s. Demo/mock rows and *.test/*.example hosts are
// simulated so the wizard works with no keys at all.
async function test(b) {
  const row = draftRow(b);
  const k = KINDS[b.kind];
  const sample = { ...k.sample, ...(b.sample_prompt ? { prompt: String(b.sample_prompt).slice(0, 500), text: String(b.sample_prompt).slice(0, 500) } : {}) };
  const out = { ok: true, mode: b.mode === 'live' ? 'live' : 'dry', steps: [] };
  const add = (label, ok, note) => { out.steps.push({ label, ok: !!ok, note: note || '' }); if (!ok) out.ok = false; };
  let request = null;
  try { request = preview(row, sample); add('Request', true, 'Built from your settings with a sample prompt.'); } catch (e) { add('Request', false, e.message); }
  out.request = request;
  const keyNeeded = !['http', 'mock', 'library'].includes(row.adapter);
  add('API key', !keyNeeded || !!row.apiKey, row.apiKey ? 'Saved (' + mask(row.apiKey) + ')' : keyNeeded ? 'Paste the API key (get it at ' + PRESETS[b.preset].key + ').' : 'Not needed, or set in the headers.');
  add('Cost', Number(row.cost_usd) > 0, Number(row.cost_usd) > 0 ? `$${row.cost_usd} ${row.cost_unit}. The profit guard prices every job on it.` : 'Enter what one unit costs you, so prices never fall below your margin.');
  if (b.sample_response) {
    let data;
    try { data = typeof b.sample_response === 'string' ? JSON.parse(b.sample_response) : b.sample_response; } catch { add('Sample answer', false, 'The sample answer is not valid JSON.'); }
    if (data !== undefined) {
      const c = row.config || {};
      if (c.poll_url) { const id = tpl.pick(data, c.id_path || 'id'); add('Job id in the answer', id !== undefined && id !== null && id !== '', id !== undefined ? `Found "${String(id).slice(0, 60)}" at ${c.id_path || 'id'}.` : `Nothing at ${c.id_path || 'id'}.`); }
      const path = c.result_path || c.output_path || (row.adapter === 'replicate' ? 'output' : 'url');
      const v = c.poll_url && !c.result_path && !c.output_path ? undefined : tpl.pick(data, path);
      if (!c.poll_url || c.result_path || c.output_path) add('Result in the answer', v !== undefined && v !== null && v !== '', v !== undefined && v !== null ? `Found "${String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 120)}" at ${path}.` : `Nothing at ${path}. Check the result path.`);
    }
  }
  const simulated = row.adapter === 'mock' || (row.adapter === 'http' && require('./vooconnect').isMockHost(row.config.url));
  if (out.mode === 'live' && out.ok) {
    const runRow = simulated ? { id: 0, name: 'Simulated', kind: row.kind, adapter: 'mock', config: {}, apiKey: '' } : row;
    const t0 = Date.now();
    try {
      let r = await providers.submit(runRow, row.kind, sample);
      let res = r.done ? r.result : null;
      while (!res) {
        if (Date.now() - t0 > 60e3) throw new Error('No answer within 60 seconds. Slow models still work in real jobs.');
        await new Promise((x) => setTimeout(x, 800));
        const p = await providers.poll(runRow, r.handle);
        if (p.done && p.error) throw new Error(p.error);
        if (p.done) res = p.result;
      }
      out.result = res;
      try { require('./llmbill').recordProvider({ row: runRow, kind: row.kind, input: sample, result: res, feature: 'admin_test:' + row.kind }); } catch (e) { console.warn('[aimodels] bill', e.message); }
      add(simulated ? 'Simulated run' : 'Live run', true, (simulated ? 'Test address: a sample result was returned without calling anything. ' : '') + `Answered in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
    } catch (e) { add('Live run', false, String(e.message).slice(0, 240)); }
  }
  return out;
}

// Save the model and decide where it is used. use: {mode: 'default'|'fallback'|'level'|'off', video_type, level, make_main}
function create(staff, b) {
  const guard = require('./guard');
  const { pricing, setSetting } = require('./settings');
  const row = draftRow(b);
  if (!(row.cost_usd >= 0)) fail(400, 'Enter the cost.');
  const use = b.use || {};
  const mode = ['default', 'fallback', 'level', 'off'].includes(use.mode) ? use.mode : 'fallback';
  const cfg = { ...row.config };
  if (row.kind === 'voice' && !cfg.tier) cfg.tier = 'standard';
  let levelInfo = null;
  if (mode === 'level') {
    if (!['ugc', 'video'].includes(row.kind)) fail(400, 'Quality levels are for video and UGC presenter models.');
    const P = pricing();
    const t = (P.video_types || []).find((x) => x.id === use.video_type);
    if (!t || t.provider_kind !== row.kind) fail(400, 'Pick a video type that uses this kind of model.');
    const lv = (t.levels || []).find((l) => l.id === use.level);
    if (!lv) fail(400, 'Pick a quality level of that video type.');
    cfg.level = lv.id;
    cfg.tag = String(use.tag || '').trim().slice(0, 40) || require('./aitools-core').slugify(row.name).slice(0, 40) || 'custom-' + Date.now().toString(36);
    levelInfo = { type: t, level: lv };
  } else if (['ugc', 'video'].includes(row.kind)) cfg.level = cfg.level || 'standard';
  const id = tx(() => {
    const info = run('INSERT INTO providers(name, kind, adapter, model, api_key_enc, config, cost_usd, cost_unit, enabled, is_default, priority, notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      row.name, row.kind, row.adapter, row.model, b.api_key ? encrypt(String(b.api_key).trim()) : '', JSON.stringify(cfg), row.cost_usd, row.cost_unit,
      mode === 'off' ? 0 : 1, 0, mode === 'fallback' ? 200 : 100, String(b.notes || 'Added with the AI model wizard.').slice(0, 500));
    const pid = Number(info.lastInsertRowid);
    if (mode === 'default') { run('UPDATE providers SET is_default = 0 WHERE kind = ?', row.kind); run('UPDATE providers SET is_default = 1 WHERE id = ?', pid); }
    return pid;
  });
  // The profit guard re-prices quality levels with the new model in the mix and raises any that would lose money.
  const P = JSON.parse(JSON.stringify(pricing()));
  if (levelInfo && use.make_main !== false) {
    const t = P.video_types.find((x) => x.id === levelInfo.type.id), lv = t.levels.find((l) => l.id === levelInfo.level.id);
    lv.provider_tag = cfg.tag; lv.model_label = String(use.model_label || row.name).slice(0, 60); lv.enabled = true;
  }
  const raised = guard.raiseLevels(P);
  if ((levelInfo && use.make_main !== false) || raised.length) setSetting('pricing', P);
  const tools = require('./aitools').priceReport().filter((x) => x.below);
  return { provider_id: id, raised, tools_below: tools, margins: guard.margins().rows.filter((r) => r.kind === 'video_type_level' ? (levelInfo ? r.type_id === levelInfo.type.id : false) : false) };
}

module.exports = { KINDS, PRESETS, UNITS, meta, draftRow, preview, test, create };
