// AI tools builder (no code): the rules for a tool definition, customer inputs and the prompt. Pure module, also embedded
// in the demo backend. Templates are data: {{field}} placeholders are replaced with the customer's (cleaned) text and
// nothing is ever evaluated. The database, versions and the runner are in aitools.js.
const ICONS = ['spark', 'wand', 'pen', 'chat', 'megaphone', 'target', 'image', 'camera', 'video', 'film', 'mic', 'music', 'globe', 'chart', 'bolt', 'star', 'tag', 'bag', 'heart', 'bulb', 'list', 'shield', 'mail', 'cart'];
const FIELD_TYPES = { text: 'Short text', longtext: 'Long text', choice: 'Choice', image: 'Image upload', number: 'Number' };
const KINDS = { text: 'Text', image: 'Image', video: 'Video', voice: 'Voice', music: 'Music' };
const OUTPUTS = { text: ['text', 'list'], image: ['image'], video: ['video'], voice: ['audio'], music: ['audio'] };
const OUTPUT_LABELS = { text: 'Text', list: 'List', image: 'Image', video: 'Video', audio: 'Audio' };
const STATUSES = ['draft', 'testing', 'live', 'paused'];
const BUILTINS = ['brand', 'language'];
const KEY = /^[a-z][a-z0-9_]{0,30}$/;
const PH = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;

const bad = (msg) => { const e = new Error(msg); e.status = 400; throw e; };
// Text from people: no control characters except new lines and tabs, trimmed, length-capped.
const cleanText = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const okUrl = (u) => /^(\/media\/[\w.-]+|https:\/\/[^\s"'<>]+|\/samples\/[\w.-]+)$/.test(String(u || ''));
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 50);

// Validate and normalise a tool definition from the admin. planIds: allowed min_plan ids.
function normalizeDef(d, { planIds = [] } = {}) {
  if (!d || typeof d !== 'object') bad('Send the tool settings.');
  const out = {};
  out.name = cleanText(d.name, 60);
  if (!out.name) bad('Give the tool a name.');
  out.description = cleanText(d.description, 300);
  out.icon = ICONS.includes(d.icon) ? d.icon : 'spark';
  out.kind = KINDS[d.kind] ? d.kind : bad('Pick what the tool makes: text, image, video, voice or music.');
  out.output = OUTPUTS[out.kind].includes(d.output) ? d.output : OUTPUTS[out.kind][0];
  const fields = Array.isArray(d.fields) ? d.fields : [];
  if (!fields.length) bad('Add at least one input field.');
  if (fields.length > 10) bad('A tool can have up to 10 input fields.');
  const seen = new Set();
  out.fields = fields.map((f, i) => {
    const key = String(f.key || '').trim().toLowerCase();
    if (!KEY.test(key)) bad(`Field ${i + 1}: the key must start with a letter and use only a-z, 0-9 and _ (e.g. product_name).`);
    if (seen.has(key) || BUILTINS.includes(key)) bad(`Field key "${key}" is used twice or is reserved.`);
    seen.add(key);
    const type = FIELD_TYPES[f.type] ? f.type : bad(`Field "${key}": pick a type.`);
    const o = { key, type, label: cleanText(f.label, 60) || key, help: cleanText(f.help, 160), placeholder: cleanText(f.placeholder, 120), required: f.required !== false };
    if (type === 'text') o.max = Math.max(1, Math.min(300, Math.round(Number(f.max) || 120)));
    if (type === 'longtext') o.max = Math.max(1, Math.min(4000, Math.round(Number(f.max) || 1200)));
    if (type === 'choice') {
      const opts = (Array.isArray(f.options) ? f.options : String(f.options || '').split('\n')).map((x) => cleanText(x, 60)).filter(Boolean);
      if (!opts.length || opts.length > 20) bad(`Field "${key}": add 1 to 20 choices.`);
      if (new Set(opts).size !== opts.length) bad(`Field "${key}": every choice must be different.`);
      o.options = opts;
    }
    if (type === 'number') {
      o.min = Number.isFinite(Number(f.min)) && f.min !== '' && f.min !== null ? Number(f.min) : 0;
      o.max = Number.isFinite(Number(f.max)) && f.max !== '' && f.max !== null ? Number(f.max) : 100;
      if (o.min > o.max) bad(`Field "${key}": the smallest number is bigger than the largest.`);
    }
    return o;
  });
  out.prompt_template = cleanText(d.prompt_template, 6000);
  if (!out.prompt_template) bad('Write the prompt. Use {{field_key}} to put in what the customer typed.');
  const unknown = placeholders(out.prompt_template).filter((k) => !seen.has(k) && !BUILTINS.includes(k));
  if (unknown.length) bad('The prompt uses ' + unknown.map((k) => '{{' + k + '}}').join(', ') + ' but there is no field with that key.');
  out.system = cleanText(d.system, 2000);
  out.provider_id = d.provider_id ? Math.round(Number(d.provider_id)) || null : null;
  out.seconds = ['video', 'voice', 'music'].includes(out.kind) ? Math.max(1, Math.min(60, Math.round(Number(d.seconds) || (out.kind === 'video' ? 5 : 15)))) : null;
  out.aspect = out.kind === 'video' || out.kind === 'image' ? (['9:16', '1:1', '4:5', '16:9'].includes(d.aspect) ? d.aspect : '9:16') : null;
  out.credits = Math.max(1, Math.min(100000, Math.round(Number(d.credits) || 0))) || bad('Set the credit price.');
  out.min_plan = d.min_plan ? (planIds.includes(d.min_plan) ? d.min_plan : bad('Pick a plan that exists.')) : null;
  return out;
}

function placeholders(s) {
  const out = new Set(); let m; PH.lastIndex = 0;
  while ((m = PH.exec(String(s || '')))) out.add(m[1]);
  return [...out];
}

// Customer inputs → cleaned values (throws 400 with a plain message).
function validateInputs(def, inputs = {}) {
  const v = {};
  for (const f of def.fields) {
    const raw = inputs[f.key];
    const empty = raw === undefined || raw === null || String(raw).trim() === '';
    if (empty) { if (f.required) bad(`Fill in "${f.label}".`); v[f.key] = f.type === 'number' ? null : ''; continue; }
    if (f.type === 'text' || f.type === 'longtext') { const s = cleanText(raw, f.max + 1); if (s.length > f.max) bad(`"${f.label}" can be up to ${f.max} characters.`); v[f.key] = s; }
    else if (f.type === 'choice') { const s = cleanText(raw, 60); if (!f.options.includes(s)) bad(`Pick one of the choices for "${f.label}".`); v[f.key] = s; }
    else if (f.type === 'number') { const n = Number(raw); if (!Number.isFinite(n) || n < f.min || n > f.max) bad(`"${f.label}" must be a number from ${f.min} to ${f.max}.`); v[f.key] = n; }
    else if (f.type === 'image') { const s = String(raw).trim(); if (!okUrl(s)) bad(`Upload an image for "${f.label}".`); v[f.key] = s; }
  }
  return v;
}

// Fill the prompt: plain text replacement, never code. Image fields put in their link.
function renderPrompt(def, values, extra = {}) {
  const vars = { ...extra, ...values };
  return String(def.prompt_template).replace(PH, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]))).replace(/\n{3,}/g, '\n\n').trim();
}
const firstImage = (def, values) => { const f = def.fields.find((x) => x.type === 'image' && values[x.key]); return f ? values[f.key] : null; };

// Longest prompt this tool can send (template + every field at its maximum): voice is priced on it.
function maxChars(def) {
  return String(def.prompt_template).length + def.fields.reduce((t, f) => t + (f.type === 'text' || f.type === 'longtext' ? f.max : f.type === 'choice' ? Math.max(...f.options.map((o) => o.length)) : 40), 0);
}
// Unit of a provider row's price (same rules as guard.js).
function unitOf(row) {
  const u = String(row?.cost_unit || '').toLowerCase();
  if (/1k|1000|char/.test(u)) return 'k_chars';
  if (/sec/.test(u)) return 'second';
  if (/min/.test(u)) return 'minute';
  if (/image|script|call|request|video|clip|item|run|job|render|track/.test(u)) return 'item';
  return row?.kind === 'voice' ? 'k_chars' : ['video', 'ugc', 'dub'].includes(row?.kind) ? 'second' : 'item';
}
// Worst-case provider cost (USD) of one run on `row` (the provider the tool will use). fallback = figures when no row has a cost.
function runCost(def, row, fallback = {}) {
  const cost = Number(row?.cost_usd) || 0;
  const secs = def.seconds || 0;
  if (!cost) {
    if (def.kind === 'text') return Number(fallback.text) || 0.062;
    if (def.kind === 'image') return Number(fallback.image) || 0.03;
    if (def.kind === 'video') return secs * (Number(fallback.video) || 0.07);
    if (def.kind === 'voice') return (Math.min(maxChars(def), secs * 15 + 400) / 1000) * (Number(fallback.voiceK) || 0.1);
    if (def.kind === 'music') return secs * (Number(fallback.music) || 0.0025);
    return 0;
  }
  switch (unitOf(row)) {
    case 'k_chars': return (Math.max(maxChars(def), secs * 15) / 1000) * cost;
    case 'second': return Math.max(1, secs || 1) * cost;
    case 'minute': return (Math.max(1, secs || 60) / 60) * cost;
    default: return cost;
  }
}
// The guard's minimum credits for a cost: ceil(cost / (1 - margin) / worst $ per credit).
function minCredits(costUsd, usdPerCredit, minMarginPct) {
  if (!(costUsd > 0) || !(usdPerCredit > 0)) return 1;
  const m = Math.min(0.99, Math.max(0, Number(minMarginPct) / 100));
  return Math.max(1, Math.ceil(Math.round((costUsd / (1 - m) / usdPerCredit) * 1e6) / 1e6));
}

// What a customer (or the studio) sees about a tool.
function publicView(t, def, extra = {}) {
  return {
    id: t.id, slug: t.slug, status: t.status, name: def.name, description: def.description, icon: def.icon, kind: def.kind, output: def.output,
    credits: def.credits, min_plan: def.min_plan, seconds: def.seconds,
    fields: def.fields.map((f) => ({ key: f.key, type: f.type, label: f.label, help: f.help, placeholder: f.placeholder, required: f.required, ...(f.options ? { options: f.options } : {}), ...(f.type === 'number' ? { min: f.min, max: f.max } : f.max ? { max: f.max } : {}) })),
    ...extra,
  };
}

// Text output → list items (JSON array, or one item per line without bullets/numbers).
function toList(text) {
  const s = String(text || '').trim();
  const m = s.match(/\[[\s\S]*\]/);
  if (m) { try { const a = JSON.parse(m[0]); if (Array.isArray(a)) return a.map((x) => (typeof x === 'string' ? x : x && (x.text || x.title) ? x.text || x.title : JSON.stringify(x))).filter(Boolean).slice(0, 100); } catch {} }
  return s.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 100);
}

module.exports = { ICONS, FIELD_TYPES, KINDS, OUTPUTS, OUTPUT_LABELS, STATUSES, BUILTINS, normalizeDef, validateInputs, renderPrompt, firstImage, placeholders, maxChars, unitOf, runCost, minCredits, publicView, toList, slugify, cleanText, okUrl };
