// Injection-safe templates for "Custom API" providers (and the AI model wizard preview).
// Templates are data, never code: a JSON template is parsed FIRST, then {{placeholders}} are filled inside the parsed values.
// A value can therefore never close a string, add a key or change the structure of the request, whatever it contains
// (quotes, backslashes, newlines, "}" ...). Pure module: no database, no network (also embedded in the demo backend).
//
//   "{{prompt}}"            → the value as a string
//   {{seconds}} (no quotes) → the value as a number when it is one (allowed outside strings; still parsed safely)
//   "Make {{seconds}}s"     → text with the value inserted
// URLs: values are URL-encoded. Headers: CR/LF and other control characters are removed.
const PH = /\{\{\s*([A-Za-z_][\w]*)\s*\}\}/g;
const ONE = /^\{\{\s*([A-Za-z_][\w]*)\s*\}\}$/;
const MARK = '\u0000ph:';

// Replace bare {{x}} (outside JSON strings) with a quoted marker so the template parses as JSON.
function quoteBare(src) {
  let out = '', inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += src[++i] ?? ''; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '{' && src[i + 1] === '{') {
      const m = /^\{\{\s*([A-Za-z_][\w]*)\s*\}\}/.exec(src.slice(i));
      if (m) { out += JSON.stringify(MARK + m[1]); i += m[0].length - 1; continue; }
    }
    out += c;
  }
  return out;
}

// Template (string or already-parsed object) → parsed tree. Throws a readable error for bad JSON.
function parse(tpl) {
  if (tpl === undefined || tpl === null || tpl === '') return null;
  if (typeof tpl !== 'string') return JSON.parse(JSON.stringify(tpl));
  try { return JSON.parse(quoteBare(tpl)); } catch (e) {
    const err = new Error('The template is not valid JSON: ' + String(e.message).replace(/\u0000ph:/g, '').slice(0, 120));
    err.status = 400;
    throw err;
  }
}

const typed = (v) => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
};
const asText = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function fillString(s, vars, unknown) {
  if (s.startsWith(MARK)) { const k = s.slice(MARK.length); if (!(k in vars)) unknown.add(k); return typed(vars[k]); }
  const one = ONE.exec(s);
  if (one) { if (!(one[1] in vars)) unknown.add(one[1]); return typeof vars[one[1]] === 'number' ? String(vars[one[1]]) : asText(vars[one[1]]); }
  return s.replace(PH, (_, k) => { if (!(k in vars)) unknown.add(k); return asText(vars[k]); });
}
function walk(node, vars, unknown) {
  if (typeof node === 'string') return fillString(node, vars, unknown);
  if (Array.isArray(node)) return node.map((x) => walk(x, vars, unknown));
  if (node && typeof node === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(node)) o[k] = walk(v, vars, unknown); // keys are never filled
    return o;
  }
  return node;
}

// Fill a JSON template. Returns the filled object (send it with JSON.stringify).
function render(tpl, vars = {}, { unknownOut } = {}) {
  const tree = parse(tpl);
  if (tree === null) return null;
  const unknown = new Set();
  const out = walk(tree, vars, unknown);
  if (unknownOut) unknown.forEach((k) => unknownOut.add(k));
  return out;
}

// Headers: an object (or JSON template) of name → value. Names must be plain tokens; values lose control characters.
function renderHeaders(tpl, vars = {}) {
  const h = render(tpl, vars) || {};
  if (typeof h !== 'object' || Array.isArray(h)) { const e = new Error('Headers must be a JSON object, e.g. {"Authorization": "Bearer {{key}}"}'); e.status = 400; throw e; }
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(k)) continue;
    out[k] = asText(v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 4000);
  }
  return out;
}

// URL template: values are URL-encoded so they cannot add path segments, queries or another host.
function renderUrl(tpl, vars = {}) {
  const s = String(tpl || '').replace(PH, (_, k) => encodeURIComponent(asText(vars[k])));
  if (!/^https?:\/\/[^\s/?#]+/i.test(s)) { const e = new Error('The URL must start with https:// (or http://).'); e.status = 400; throw e; }
  return s;
}

// Placeholders used anywhere in a template (string or object).
function placeholders(tpl) {
  const s = typeof tpl === 'string' ? tpl : JSON.stringify(tpl ?? '');
  const out = new Set();
  let m; PH.lastIndex = 0;
  while ((m = PH.exec(s))) out.add(m[1]);
  return [...out];
}

// Read "data.items.0.url" from an object.
const pick = (obj, p) => String(p || '').split('.').filter(Boolean).reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);

// Hide secrets in a preview: any header that looks like auth, and the key itself anywhere.
function mask(obj, secrets = []) {
  let s = JSON.stringify(obj ?? null);
  for (const x of secrets.filter((y) => y && String(y).length >= 4)) s = s.split(JSON.stringify(String(x)).slice(1, -1)).join('••••' + String(x).slice(-4));
  return JSON.parse(s);
}

module.exports = { parse, render, renderHeaders, renderUrl, placeholders, pick, mask, quoteBare };
