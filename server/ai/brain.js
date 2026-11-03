// AI brain (SPEC §7): the creative knowledge every text prompt is built from.
// Sources: content/ai/playbook.md, verticals.json, trends.md, script-templates.json. The admin can override each one
// (settings ai_playbook, ai_verticals, ai_trends, ai_templates) via GET/PUT /api/admin/ai-brain. Missing files are fine.
const fs = require('node:fs');
const path = require('node:path');
const { getSetting, setSetting } = require('../settings');

const DIR = path.join(__dirname, '..', '..', 'content', 'ai');
const FILES = { playbook: 'playbook.md', verticals: 'verticals.json', trends: 'trends.md', templates: 'script-templates.json' };
const KEYS = { playbook: 'ai_playbook', verticals: 'ai_verticals', trends: 'ai_trends', templates: 'ai_templates' };

const fileCache = new Map();
function readFile(name) {
  const p = path.join(DIR, FILES[name]);
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  const hit = fileCache.get(name);
  if (hit && hit.mtime === st.mtimeMs) return hit.val;
  let val = null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    val = FILES[name].endsWith('.json') ? JSON.parse(raw) : raw;
  } catch (e) { console.warn('[brain] could not read', FILES[name], e.message); }
  fileCache.set(name, { mtime: st.mtimeMs, val });
  return val;
}

// Admin override wins; otherwise the content file.
function source(name) {
  const v = getSetting(KEYS[name]);
  if (v !== undefined && v !== null && v !== '') return { value: v, from: 'admin' };
  const f = readFile(name);
  return { value: f, from: f === null ? 'missing' : 'file' };
}
const asList = (v, key) => (Array.isArray(v) ? v : v && Array.isArray(v[key]) ? v[key] : []);
const playbook = () => String(source('playbook').value || '');
const trends = () => String(source('trends').value || '');
const verticals = () => asList(source('verticals').value, 'verticals').filter((v) => v && v.id);
const templates = () => asList(source('templates').value, 'templates').filter((t) => t && (t.id || t.name));

// ---------- Vertical detection ----------
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const FALLBACK_WORDS = {
  skincare: ['serum', 'skin', 'acne', 'spf', 'sunscreen', 'moisturizer', 'cleanser', 'retinol', 'vitamin c'],
  supplements: ['supplement', 'vitamin', 'protein', 'collagen', 'capsule', 'gummies', 'creatine'],
  fitness: ['gym', 'workout', 'fitness', 'training', 'yoga'],
  saas: ['saas', 'software', 'crm', 'dashboard', 'b2b', 'platform', 'tool'],
  'mobile-apps': ['app', 'download', 'ios', 'android'],
  'trading-education': ['trading', 'forex', 'stocks', 'options', 'signals', 'broker'],
  'crypto-apps': ['crypto', 'bitcoin', 'btc', 'usdt', 'wallet', 'token', 'exchange'],
  'igaming-sweepstakes': ['casino', 'betting', 'bet', 'sportsbook', 'slots', 'sweepstakes', 'odds'],
  fashion: ['sneakers', 'shoes', 'dress', 'shirt', 'jacket', 'fashion', 'apparel'],
};

function detectVertical(input = {}) {
  const list = verticals();
  if (!list.length) return null;
  const niche = norm(input.niche);
  if (niche) {
    const hit = list.find((v) => norm(v.id) === niche || norm(v.name) === niche || norm(v.id).replace(/ /g, '') === niche.replace(/ /g, ''))
      || list.find((v) => norm(v.id).split(' ').includes(niche.split(' ')[0]) || norm(v.name).includes(niche));
    if (hit) return hit;
  }
  const text = ' ' + norm([input.product, input.audience, input.details, input.angle, input.niche, input.prompt].filter(Boolean).join(' ')) + ' ';
  if (!text.trim()) return null;
  let best = null, bestScore = 0;
  for (const v of list) {
    const words = [...(v.keywords || []), ...(FALLBACK_WORDS[v.id] || []), ...norm(v.name).split(' ').filter((w) => w.length > 3 && !['and', 'with'].includes(w))];
    let score = 0;
    for (const w of new Set(words.map(norm).filter(Boolean))) if (text.includes(' ' + w + ' ') || (w.length > 4 && text.includes(' ' + w))) score += w.includes(' ') ? 3 : w.length >= 5 ? 2 : 1; // specific words count more than 'app'
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

// ---------- Script plans ----------
function builtinPlan(seconds) {
  const s = Math.max(5, Number(seconds) || 15);
  const cut = (f) => Math.round(s * f * 10) / 10;
  return [
    { beat: 'Hook', from: 0, to: Math.min(3, cut(0.15)), note: 'Stop the scroll in the first line.' },
    { beat: 'Problem', from: Math.min(3, cut(0.15)), to: cut(0.35), note: 'Name the pain in plain words.' },
    { beat: 'Discovery', from: cut(0.35), to: cut(0.55), note: 'How the product came in.' },
    { beat: 'Proof or demo', from: cut(0.55), to: cut(0.85), note: 'Show it working. No fake numbers.' },
    { beat: 'Call to action', from: cut(0.85), to: s, note: 'One clear next step.' },
  ];
}
// Beats for a length. Template choice: input.template (id or name) → a template whose best_for matches the vertical →
// the first template → a built-in plan. Beat times ("0-3s" or numbers) are scaled from the template's base length.
function pickTemplate(templateId, verticalId) {
  const list = templates();
  if (!list.length) return null;
  return (templateId && list.find((x) => x.id === templateId || x.name === templateId))
    || (verticalId && list.find((x) => Array.isArray(x.best_for) && x.best_for.includes(verticalId)))
    || list[0];
}
function scriptPlan(seconds, templateId, verticalId) {
  const s = Math.max(5, Number(seconds) || 15);
  const t = pickTemplate(templateId, verticalId);
  if (!t) return { template: null, beats: builtinPlan(s) };
  let raw = t.beats, base = Number(t.base_seconds) || 0;
  if (raw && !Array.isArray(raw) && typeof raw === 'object') { // {"15": [...], "30": [...]}
    const keys = Object.keys(raw).map((k) => [k, Number(String(k).replace(/\D/g, ''))]).filter(([, n]) => n > 0);
    if (keys.length) { const [k, n] = keys.reduce((a, b) => (Math.abs(b[1] - s) < Math.abs(a[1] - s) ? b : a)); raw = raw[k]; base = n; }
  }
  if (!Array.isArray(raw) || !raw.length) return { template: t.name || t.id, beats: builtinPlan(s) };
  if (!base) { const last = raw[raw.length - 1]; base = Number(String(last.t || last.to || last.end || '').split('-').pop().replace(/[^\d.]/g, '')) || s; }
  const scale = s / base;
  const r1 = (n) => Math.round(n * scale * 10) / 10;
  const beats = raw.map((b) => {
    if (typeof b === 'string') return { beat: b };
    const out = { beat: b.beat || b.purpose || b.name || b.label || 'Beat', note: b.line_pattern || b.note || b.direction || b.goal };
    const m = String(b.t || '').match(/([\d.]+)\s*-\s*([\d.]+)/);
    if (m) { out.from = r1(Number(m[1])); out.to = r1(Number(m[2])); }
    else if (typeof (b.from ?? b.start) === 'number') { out.from = r1(b.from ?? b.start); out.to = r1(b.to ?? b.end); }
    return out;
  });
  return { template: t.name || t.id, template_id: t.id || null, beats };
}

// ---------- System prompts ----------
const ROLES = {
  hooks: 'You write scroll-stopping opening hooks for paid social video ads.',
  script: 'You are a top UGC ad scriptwriter for performance marketers. Scripts sound like a real person talking to their phone camera.',
  ugc: 'You are a top UGC ad scriptwriter for performance marketers. Scripts sound like a real person talking to their phone camera.',
  angles: 'You are a creative strategist who finds ad angles that convert for a specific vertical.',
  slides: 'You write short, punchy on-screen lines for slideshow video ads.',
  translate: 'You translate and localise ad scripts so they sound native, not translated.',
  hook_remix: 'You write new 3 to 5 second opening hooks to put in front of an ad that already works.',
  motion_ad: 'You are a motion-graphics ad director. You plan short animated ads scene by scene: punchy on-screen headlines, a natural voiceover and concrete stock-footage visuals.',
};
// Brand names must be written exactly as given; the voice engine handles pronunciation (settings `pronunciations`).
function spellingRule(input) {
  let words = [];
  try { words = (require('../pronounce').list() || []).map((r) => r.word); } catch {}
  if (input.brand) words.unshift(String(input.brand));
  words = [...new Set(words.filter(Boolean))].slice(0, 30);
  return words.length ? `Spell brand and product names exactly as given, with the same capitals and no spaces or hyphens added (for example: ${words.join(', ')}). Never write them phonetically.` : '';
}
const PLATFORM_RULES = 'Platform rules (Meta, TikTok, YouTube): no guaranteed results, no income, health or medical claims, no fake statistics, reviews or testimonials, no before/after promises, never point at the viewer\'s personal traits ("Are you overweight?"), 18+ and local-law rules for gambling, trading and crypto.';
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n…' : s);

function verticalBlock(v) {
  if (!v) return '';
  const line = (label, arr, n = 8) => (Array.isArray(arr) && arr.length ? `${label}: ${arr.slice(0, n).join(' | ')}\n` : '');
  return `\n## Vertical: ${v.name || v.id}\n` + line('Audiences', v.audiences) + line('Pains', v.pains) + line('Angles that work', v.angles, 10)
    + line('Hook examples', v.hook_examples, 8) + line('Proof types', v.proof_types) + line('CTAs', v.ctas) + line('Never claim', v.banned_claims, 12)
    + (v.compliance_notes ? `Compliance: ${v.compliance_notes}\n` : '') + line('Best formats', v.best_formats);
}

function systemFor(task, input = {}) {
  const v = detectVertical(input);
  const pb = playbook();
  const tr = trends();
  return [
    ROLES[task] || ROLES.script,
    PLATFORM_RULES,
    spellingRule(input),
    pb ? '\n# Creative playbook\n' + clip(pb, 24000) : '', // the playbook is ~21k chars: 12k cut off the ad policy and output format rules
    verticalBlock(v),
    tr ? '\n# Current trends (dated notes)\n' + clip(tr, 3000) : '',
  ].filter(Boolean).join('\n');
}

// ---------- Admin ----------
function state() {
  const out = {};
  for (const name of Object.keys(FILES)) {
    const s = source(name);
    out[name] = { value: s.value, from: s.from, file: 'content/ai/' + FILES[name], setting: KEYS[name] };
  }
  out.vertical_ids = verticals().map((v) => ({ id: v.id, name: v.name }));
  return out;
}
// PUT body: {playbook?, verticals?, trends?, templates?}; null or '' resets that part to the content file.
function update(body = {}) {
  for (const name of Object.keys(FILES)) {
    if (!(name in body)) continue;
    let v = body[name];
    if (v === null || v === '') { setSetting(KEYS[name], null); continue; }
    if (name === 'verticals' || name === 'templates') {
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch { const e = new Error(`${name} must be valid JSON.`); e.status = 400; throw e; } }
      if (!Array.isArray(asList(v, name)) || !asList(v, name).length) { const e = new Error(`${name} must be a JSON array.`); e.status = 400; throw e; }
    } else v = String(v).slice(0, 200000);
    setSetting(KEYS[name], v);
  }
  return state();
}

module.exports = { systemFor, scriptPlan, detectVertical, verticals, playbook, trends, templates, state, update };
