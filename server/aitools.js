// AI tools builder: admins create customer-facing AI tools without code (Admin → AI tools). Rules for definitions, inputs
// and prompts are in aitools-core.js; this file keeps versions in the database, prices every tool with the profit guard,
// and runs tools as jobs (credits taken up front in one transaction, refunded by jobs.failJob when anything fails).
//
// Lifecycle: draft → testing (only staff and allow-listed customer emails see it) → live → paused.
// Versions: every save makes a new version. Customers always use the live version; publishing switches the live version
// in one database statement, so a customer who is running a tool is never affected by an edit.
const { db, get, all, run, tx, J } = require('./db');
const { fail } = require('./lib/http');
const { now } = require('./lib/util');
const core = require('./aitools-core');
const config = require('./config');

function migrate() {
  db.exec(`
CREATE TABLE IF NOT EXISTS ai_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  live_version_id INTEGER, draft_version_id INTEGER, allowlist TEXT NOT NULL DEFAULT '[]', runs INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS ai_feature_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, feature_id INTEGER NOT NULL REFERENCES ai_features(id) ON DELETE CASCADE, version INTEGER NOT NULL,
  def TEXT NOT NULL, note TEXT, created_by INTEGER, created_at TEXT, published_at TEXT, UNIQUE(feature_id, version)
);`);
}

const planIds = () => (require('./settings').pricing().plans || []).map((p) => p.id);
const defOf = (vid) => { const v = vid ? get('SELECT def FROM ai_feature_versions WHERE id = ?', vid) : null; return v ? J(v.def, null) : null; };

// The provider row a tool runs on: the one picked in the builder, else the best row of its kind.
function providerRow(def) {
  const providers = require('./providers');
  if (def.provider_id) {
    const p = providers.byId(def.provider_id);
    if (p && p.kind === def.kind) return p;
  }
  return require('./guard').rowFor(def.kind);
}
// Profit guard: cost of one run on that provider and the lowest safe price.
function price(def) {
  const guard = require('./guard');
  const c = require('./settings').pricing().provider_cost_usd || {};
  const row = providerRow(def);
  const cost = core.runCost(def, row, { text: c.claude_script, image: c.image, video: c.video_per_second, voiceK: c.voice_per_1k_chars, music: undefined });
  const min = core.minCredits(cost, guard.worstCaseUsdPerCredit(), guard.minMarginPct());
  const credits = Math.max(def.credits, min);
  const e = guard.evaluate(credits, cost);
  return { cost_usd: Math.round(cost * 1e4) / 1e4, min_credits: min, credits, margin_pct: e.marginPct, provider: row ? { id: row.id, name: row.name, adapter: row.adapter, cost_usd: row.cost_usd, cost_unit: row.cost_unit } : null };
}
// Raise the price to the guard minimum. Returns {from, to} when it had to.
function autoRaise(def) {
  const p = price(def);
  if (def.credits < p.min_credits) { const from = def.credits; def.credits = p.min_credits; return { from, to: p.min_credits }; }
  return null;
}

function addVersion(featureId, def, staffId, note) {
  const n = (get('SELECT MAX(version) AS v FROM ai_feature_versions WHERE feature_id = ?', featureId)?.v || 0) + 1;
  const info = run('INSERT INTO ai_feature_versions(feature_id, version, def, note, created_by, created_at) VALUES(?,?,?,?,?,?)', featureId, n, JSON.stringify(def), String(note || '').slice(0, 200), staffId || null, now());
  return Number(info.lastInsertRowid);
}
function uniqueSlug(name) {
  const base = core.slugify(name) || 'tool';
  let s = base;
  for (let i = 2; get('SELECT 1 FROM ai_features WHERE slug = ?', s); i++) s = base + '-' + i;
  return s;
}

function feature(id) {
  const f = get('SELECT * FROM ai_features WHERE id = ?', Number(id));
  if (!f) fail(404, 'AI tool not found.');
  return f;
}
// Admin view: both versions, price check, history.
function adminView(f, { history = false } = {}) {
  const live = defOf(f.live_version_id), draft = defOf(f.draft_version_id);
  const cur = draft || live;
  const lv = f.live_version_id ? get('SELECT version, published_at FROM ai_feature_versions WHERE id = ?', f.live_version_id) : null;
  const dv = f.draft_version_id ? get('SELECT version, created_at FROM ai_feature_versions WHERE id = ?', f.draft_version_id) : null;
  return {
    id: f.id, slug: f.slug, status: f.status, runs: f.runs, allowlist: J(f.allowlist, []), created_at: f.created_at, updated_at: f.updated_at,
    name: cur?.name, icon: cur?.icon, kind: cur?.kind, output: cur?.output, description: cur?.description,
    live: live ? { version_id: f.live_version_id, version: lv?.version, published_at: lv?.published_at, def: live, price: price(live) } : null,
    draft: draft ? { version_id: f.draft_version_id, version: dv?.version, created_at: dv?.created_at, def: draft, price: price(draft) } : null,
    ...(history ? { versions: all('SELECT v.id, v.version, v.note, v.created_at, v.published_at, s.name AS by_name, s.email AS by_email FROM ai_feature_versions v LEFT JOIN staff s ON s.id = v.created_by WHERE v.feature_id = ? ORDER BY v.version DESC', f.id).map((v) => ({ ...v, live: v.id === f.live_version_id, draft: v.id === f.draft_version_id })) } : {}),
  };
}
const list = () => all('SELECT * FROM ai_features ORDER BY CASE status WHEN \'live\' THEN 0 WHEN \'testing\' THEN 1 WHEN \'draft\' THEN 2 ELSE 3 END, updated_at DESC, id DESC').map((f) => adminView(f));

function create(staff, body) {
  const def = core.normalizeDef(body.def || body, { planIds: planIds() });
  const raised = autoRaise(def);
  const t = now();
  const id = tx(() => {
    const info = run("INSERT INTO ai_features(slug, status, created_by, created_at, updated_at) VALUES(?, 'draft', ?, ?, ?)", uniqueSlug(def.name), staff.id, t, t);
    const fid = Number(info.lastInsertRowid);
    const vid = addVersion(fid, def, staff.id, 'Created');
    run('UPDATE ai_features SET draft_version_id = ? WHERE id = ?', vid, fid);
    return fid;
  });
  return { feature: adminView(feature(id), { history: true }), raised };
}
// Every save is a new draft version. The live version is never touched here.
function save(staff, id, body) {
  const f = feature(id);
  const def = core.normalizeDef(body.def || body, { planIds: planIds() });
  const raised = autoRaise(def);
  tx(() => {
    const vid = addVersion(f.id, def, staff.id, body.note || 'Edited');
    run('UPDATE ai_features SET draft_version_id = ?, updated_at = ? WHERE id = ?', vid, now(), f.id);
  });
  return { feature: adminView(feature(f.id), { history: true }), raised };
}
function setStatus(id, status) {
  const f = feature(id);
  if (!['draft', 'testing', 'paused', 'live'].includes(status)) fail(400, 'Pick draft, testing, live or paused.');
  if (status === 'live' && !f.live_version_id) fail(400, 'Publish the tool first. That makes it live.');
  if (status === 'testing' && !f.draft_version_id && !f.live_version_id) fail(400, 'Save the tool first.');
  if (status === 'draft' && f.live_version_id) fail(400, 'This tool has been live. Pause it instead, so customers stop seeing it.');
  run('UPDATE ai_features SET status = ?, updated_at = ? WHERE id = ?', status, now(), f.id);
  return adminView(feature(f.id), { history: true });
}
// Atomic switch: the draft becomes the live version in one statement (only if the draft is still the one we checked).
function publish(staff, id) {
  const f = feature(id);
  if (!f.draft_version_id) fail(400, 'There are no changes to publish.');
  const def = defOf(f.draft_version_id);
  const p = price(def);
  if (def.credits < p.min_credits) fail(409, `The price is below the profit guard minimum (${p.min_credits} credits). Save the tool again to raise it.`);
  const t = now();
  const changed = tx(() => {
    const n = run("UPDATE ai_features SET live_version_id = draft_version_id, draft_version_id = NULL, status = 'live', updated_at = ? WHERE id = ? AND draft_version_id = ?", t, f.id, f.draft_version_id).changes;
    if (n) run('UPDATE ai_feature_versions SET published_at = ? WHERE id = ?', t, f.draft_version_id);
    return n;
  });
  if (!changed) fail(409, 'Someone saved this tool a moment ago. Reload and publish again.');
  return adminView(feature(f.id), { history: true });
}
function restore(staff, id, versionId) {
  const f = feature(id);
  const v = get('SELECT * FROM ai_feature_versions WHERE id = ? AND feature_id = ?', Number(versionId), f.id);
  if (!v) fail(404, 'Version not found.');
  return save(staff, f.id, { def: J(v.def, {}), note: 'Restored from version ' + v.version });
}
function setAllowlist(id, emails) {
  const f = feature(id);
  const list = (Array.isArray(emails) ? emails : String(emails || '').split(/[\s,;]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  for (const e of list) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, e + ' is not a valid email.');
  if (list.length > 200) fail(400, 'Up to 200 testers.');
  run('UPDATE ai_features SET allowlist = ?, updated_at = ? WHERE id = ?', JSON.stringify([...new Set(list)]), now(), f.id);
  return adminView(feature(f.id), { history: true });
}
function remove(id) {
  const f = feature(id);
  if (f.live_version_id && f.status !== 'paused') fail(400, 'Pause the tool before deleting it.');
  tx(() => { run('DELETE FROM ai_feature_versions WHERE feature_id = ?', f.id); run('DELETE FROM ai_features WHERE id = ?', f.id); });
}

// ---------- Customers ----------
const isTester = (f, user) => !!user && J(f.allowlist, []).includes(String(user.email).toLowerCase());
// The version a customer gets: live tools → live version; testing tools → the draft, for allow-listed emails only.
function forCustomer(f, user) {
  if (f.status === 'live' && f.live_version_id) return { version_id: f.live_version_id, def: defOf(f.live_version_id), testing: false };
  if (f.status === 'testing' && isTester(f, user)) { const vid = f.draft_version_id || f.live_version_id; return vid ? { version_id: vid, def: defOf(vid), testing: true } : null; }
  return null;
}
function lockReason(def, user) {
  if (!def.min_plan) return null;
  const credits = require('./credits');
  const vt = require('./videotypes');
  const plan = credits.activePlan(user);
  if (!plan || vt.planRank(plan.id) < vt.planRank(def.min_plan)) {
    const p = (require('./settings').pricing().plans || []).find((x) => x.id === def.min_plan);
    return `This tool is on the ${p ? p.name : def.min_plan} plan and above.`;
  }
  return null;
}
function customerList(user) {
  const out = [];
  for (const f of all("SELECT * FROM ai_features WHERE status IN ('live','testing') ORDER BY updated_at DESC, id DESC")) {
    const v = forCustomer(f, user);
    if (!v || !v.def) continue;
    const p = price(v.def);
    const lk = lockReason(v.def, user);
    out.push(core.publicView(f, { ...v.def, credits: p.credits }, { testing: v.testing, locked: !!lk, locked_reason: lk }));
  }
  return out;
}
function bySlug(user, slug) {
  const f = get('SELECT * FROM ai_features WHERE slug = ?', String(slug || '').slice(0, 60));
  const v = f ? forCustomer(f, user) : null;
  if (!f || !v || !v.def) fail(404, 'This tool is not available.');
  return { f, ...v };
}
function quote(user, slug) {
  const { f, def, testing } = bySlug(user, slug);
  const p = price(def);
  const credits = require('./credits');
  return { tool: core.publicView(f, { ...def, credits: p.credits }, { testing }), credits: p.credits, adjusted: p.credits > def.credits, balance: credits.balance(user) };
}

const KIND_TO_PROVIDER = { text: 'text', image: 'image', video: 'video', voice: 'voice', music: 'music' };
const abs = (u) => (u && u.startsWith('/') ? config.appUrl + u : u);

function run_(user, slug, inputs) {
  const credits = require('./credits');
  const guard = require('./guard');
  const providers = require('./providers');
  const { f, version_id, def, testing } = bySlug(user, slug);
  const lk = lockReason(def, user);
  if (lk) fail(402, lk, { locked: true, min_plan: def.min_plan });
  const values = core.validateInputs(def, inputs || {});
  const brand = J(user.brand, null);
  const prompt = core.renderPrompt(def, values, { brand: brand?.name || '', language: 'English' });
  const p = price(def);
  const plan = credits.activePlan(user);
  guard.checkJobLimits(user, p.credits, plan);
  const firstText = def.fields.find((x) => (x.type === 'text' || x.type === 'longtext') && values[x.key]);
  const input = {
    tool_id: f.id, tool_slug: f.slug, version_id, tool_name: def.name, tool_icon: def.icon, kind: def.kind, output: def.output, testing,
    product: firstText ? String(values[firstText.key]).slice(0, 80) : def.name, values, prompt, system: def.system || '',
    seconds: def.seconds, aspect: def.aspect, provider_id: def.provider_id, image_url: core.firstImage(def, values),
  };
  const st = { quote: { credits: p.credits, base_credits: def.credits, provider_cost_usd: p.cost_usd, main_cost_usd: p.cost_usd, adjusted: p.credits > def.credits, margin_pct: p.margin_pct } };
  const allowTrial = ['text', 'image'].includes(def.kind); // trial credits cover text and images only, like the studio
  const info = run('INSERT INTO jobs(user_id, type, status, step, input, credits, demo) VALUES(?,?,?,?,?,?,?)', user.id, 'tool', 'queued', 'start', JSON.stringify(input), p.credits, providers.isDemo(KIND_TO_PROVIDER[def.kind]) ? 1 : 0);
  const jobId = Number(info.lastInsertRowid);
  try {
    const take = credits.spend(user.id, p.credits, 'tool job', 'job:' + jobId, { allowTrial });
    run('UPDATE jobs SET state = ? WHERE id = ?', JSON.stringify({ ...st, take }), jobId);
  } catch (e) { run('DELETE FROM jobs WHERE id = ?', jobId); throw e; }
  run('UPDATE ai_features SET runs = runs + 1 WHERE id = ?', f.id);
  setTimeout(() => require('./jobs').tick().catch(() => {}), 50);
  return require('./jobs').view(get('SELECT * FROM jobs WHERE id = ?', jobId));
}

// Provider input for a run (shared by the job runner and the admin "Try it").
function providerInput(i) {
  if (i.kind === 'text') return { prompt: i.prompt, system: i.system || undefined, max_tokens: 2000, mode: 'tool', topic: i.product, output: i.output }; // mode/topic only shape demo samples
  if (i.kind === 'image') return { prompt: i.prompt, size: { '9:16': '1080x1920', '1:1': '1080x1080', '4:5': '1080x1350', '16:9': '1920x1080' }[i.aspect] || '1080x1350', aspect: i.aspect, image_url: abs(i.image_url) || undefined };
  if (i.kind === 'video') return { prompt: i.prompt, duration: i.seconds || 5, seconds: i.seconds || 5, aspect: i.aspect || '9:16', image_url: abs(i.image_url) || undefined };
  if (i.kind === 'voice') return { text: require('./pronounce').forTts(i.prompt), prompt: i.prompt };
  if (i.kind === 'music') return { prompt: i.prompt, seconds: i.seconds || 15, mood: 'upbeat' };
  return { prompt: i.prompt };
}
function outputOf(i, r) {
  if (i.output === 'list') return { items: core.toList(r.text), text: r.text };
  if (i.output === 'text') return { text: String(r.text || '').trim() };
  return { url: r.url, [i.output === 'audio' ? 'audio_url' : i.output === 'video' ? 'video_url' : 'image_url']: r.url };
}
// Providers a run may use: the tool's own provider only when one was picked (it was priced on it), else the kind's chain.
function chainFor(i) {
  const providers = require('./providers');
  if (i.provider_id) { const p = providers.byId(i.provider_id); if (p && p.enabled) return [p]; }
  return null;
}

// Job runner hook (jobs.advance → here). ctx: {st, runStep, save, done}.
async function advance(job, ctx) {
  const i = typeof job.input === 'object' && job.input ? job.input : J(job.input, {});
  const { st } = ctx;
  st.steps = ['Getting ready', 'Running the AI', 'Saving'];
  const kind = KIND_TO_PROVIDER[i.kind];
  if (!kind) throw new Error('Unknown tool kind.');
  const only = chainFor(i);
  if (i.provider_id && !only) throw new Error('The AI model this tool uses is switched off. Your credits are back.');
  st.progress = Math.max(st.progress || 0, 0.15);
  const r = await ctx.runStep(job, st, 'main', kind, providerInput(i), only || require('./providers').chain(kind));
  if (!r) { const sub = st.sub?.main; st.progress = Math.max(0.2, Math.min(0.9, sub?.progress || 0.35)); return ctx.save({ step: 'Running the AI' }); }
  let out = outputOf(i, r);
  if (out.url) { out.url = await require('./media').mirror(out.url, job.user_id); for (const k of ['image_url', 'video_url', 'audio_url']) if (out[k]) out[k] = out.url; }
  if (i.output === 'list' && !out.items.length) throw new Error('The AI returned nothing usable. Your credits are back.');
  if (i.output === 'text' && !out.text) throw new Error('The AI returned nothing usable. Your credits are back.');
  return ctx.done({ ...out, tool: { name: i.tool_name, icon: i.tool_icon, slug: i.tool_slug, output: i.output } });
}

// Admin "Try it": runs the draft (or live) version right away, no credits. Demo providers answer with samples.
async function tryIt(id, inputs, which = 'draft') {
  const providers = require('./providers');
  const f = feature(id);
  const vid = which === 'live' ? f.live_version_id : f.draft_version_id || f.live_version_id;
  const def = defOf(vid);
  if (!def) fail(400, 'Save the tool first.');
  const values = core.validateInputs(def, inputs || {});
  const prompt = core.renderPrompt(def, values, { brand: 'Your brand', language: 'English' });
  const i = { kind: def.kind, output: def.output, prompt, system: def.system, seconds: def.seconds, aspect: def.aspect, provider_id: def.provider_id, image_url: core.firstImage(def, values) };
  const list = chainFor(i) || providers.chain(KIND_TO_PROVIDER[def.kind]);
  if (def.provider_id && !chainFor(i)) fail(400, 'The AI model this tool uses is switched off.');
  const p = list[0];
  const t0 = Date.now();
  let r;
  try {
    r = await providers.submit(p, KIND_TO_PROVIDER[def.kind], providerInput(i));
    let res = r.done ? r.result : null, h = r.handle;
    while (!res) {
      if (Date.now() - t0 > 90e3) fail(504, 'The AI took longer than 90 seconds. Try a shorter output, or test with a real run.');
      await new Promise((x) => setTimeout(x, 700));
      const pr = await providers.poll(p, h);
      if (pr.done && pr.error) throw new Error(pr.error);
      if (pr.done) res = pr.result;
    }
    r = res;
    try { require('./llmbill').recordProvider({ row: p, kind: KIND_TO_PROVIDER[def.kind], input: providerInput(i), result: res, feature: 'admin_test:tool' }); } catch (e2) { console.warn('[aitools] bill', e2.message); }
  } catch (e) { if (e.status) throw e; fail(502, `${p.name}: ${e.message}`.slice(0, 300)); }
  return { version_id: vid, prompt, output: outputOf(i, r), provider: { id: p.id, name: p.name, demo: p.adapter === 'mock' }, ms: Date.now() - t0, price: price(def) };
}

// Re-check every tool after an AI model's cost changes: drafts and live versions under the minimum are flagged.
function priceReport() {
  return all('SELECT * FROM ai_features').map((f) => {
    const d = defOf(f.live_version_id || f.draft_version_id);
    if (!d) return null;
    const p = price(d);
    return { id: f.id, name: d.name, status: f.status, credits: d.credits, min_credits: p.min_credits, below: d.credits < p.min_credits };
  }).filter(Boolean);
}

module.exports = { migrate, list, adminView, feature, create, save, setStatus, publish, restore, setAllowlist, remove, customerList, quote, run: run_, advance, tryIt, price, priceReport, providerInput };
