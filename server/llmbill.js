// The AI (LLM) bill. Every text call we pay for is recorded here with its real token cost, the account and the feature
// that made it: scripts and hooks inside paid jobs (jobs.js records them), the chat-edit planner, admin tests.
//
// Steps the customer does not pay for directly (the chat-edit planner beyond its fee, any future free AI helper) go through
// call(), which enforces, in this order:
//   1. the house daily cap on LLM spend (Admin → Profit → AI bill). At the cap free steps are refused until midnight UTC;
//      an admin alert is raised at alert_pct and again at the cap.
//   2. per-account rate limits (per minute and per day, per feature).
//   3. the free allowance per plan per day; after it, a small credit fee per message, taken before the call.
// Settings live in the "llm" setting (settings.js DEFAULTS.llm), editable in Admin → Profit.
const { db, get, all, run, tx } = require('./db');
const { getSetting } = require('./settings');
const { fail } = require('./lib/http');

function migrate() {
  db.exec(`
CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, feature TEXT NOT NULL, job_id INTEGER, provider_id INTEGER, adapter TEXT, model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0,
  free INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS llm_usage_day ON llm_usage(created_at);
CREATE INDEX IF NOT EXISTS llm_usage_user ON llm_usage(user_id, feature, created_at);
CREATE TABLE IF NOT EXISTS admin_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, day TEXT, level TEXT NOT NULL DEFAULT 'warn', message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), seen_at TEXT, UNIQUE(kind, day)
);`);
}

const cfg = () => getSetting('llm');
const today = () => new Date().toISOString().slice(0, 10);
const r6 = (x) => Math.round(x * 1e6) / 1e6;

// USD per million tokens for a model id: the longest configured prefix wins, else "default" (deliberately high).
function priceFor(model) {
  const t = cfg().prices_usd_per_mtok || {};
  const m = String(model || '').toLowerCase();
  let best = null, len = -1;
  for (const [k, v] of Object.entries(t)) if (k !== 'default' && m.startsWith(k.toLowerCase()) && k.length > len) { best = v; len = k.length; }
  const p = best || t.default || { in: 15, out: 75 };
  return { in: Number(p.in) || 0, out: Number(p.out) || 0 };
}
// Token usage → USD. Anthropic sends input_tokens/output_tokens (+ cache tokens, billed here as input); OpenAI prompt/completion.
function costOf(model, usage = {}) {
  const u = usage || {};
  const inT = (Number(u.input_tokens ?? u.prompt_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) * 1.25 + (Number(u.cache_read_input_tokens) || 0) * 0.1;
  const outT = Number(u.output_tokens ?? u.completion_tokens) || 0;
  const p = priceFor(model);
  return { input_tokens: Math.round(inT), output_tokens: outT, cost_usd: r6((inT * p.in + outT * p.out) / 1e6) };
}
// When a provider sends no usage (custom HTTP adapters), estimate from characters (about 4 per token) so the bill never reads 0.
function estimateUsage(input = {}, text = '') {
  const chars = String(input.system || '').length + String(input.prompt || '').length;
  return { input_tokens: Math.ceil(chars / 4), output_tokens: Math.ceil(String(text || '').length / 4), estimated: true };
}

function record({ userId = null, feature, jobId = null, provider = null, usage, input, text, credits = 0, free = false }) {
  const demo = !provider || provider.adapter === 'mock';
  const model = provider ? provider.model || provider.adapter : 'demo';
  const u = usage && (usage.input_tokens != null || usage.prompt_tokens != null) ? usage : estimateUsage(input, text);
  const c = demo ? { input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0, cost_usd: 0 } : costOf(model, u);
  run('INSERT INTO llm_usage(user_id, feature, job_id, provider_id, adapter, model, input_tokens, output_tokens, cost_usd, credits, free, demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    userId, String(feature).slice(0, 40), jobId, provider?.id || null, provider?.adapter || 'mock', String(model).slice(0, 80), c.input_tokens, c.output_tokens, c.cost_usd, Math.round(credits) || 0, free ? 1 : 0, demo ? 1 : 0);
  checkCap();
  return c;
}

// Any other provider call nobody pays a job for (admin tests, training narration): text by tokens, other kinds by the list
// price of the row that ran, so the house bill and the Profit view see every AI dollar.
function recordProvider({ row, kind, input = {}, result = {}, userId = null, feature }) {
  if (kind === 'text') return record({ userId, feature, provider: row, usage: result && result.usage, input, text: result && result.text });
  const demo = !row || row.adapter === 'mock';
  let usd = 0;
  if (!demo && Number(row.cost_usd) > 0) {
    const seconds = kind === 'voice' ? String(input.text || '').length / 15 : Number(input.duration || input.seconds) || 0;
    try { usd = require('./guard').rowCostFor(row, { seconds, calls: 1 }); } catch { usd = 0; }
  }
  run('INSERT INTO llm_usage(user_id, feature, job_id, provider_id, adapter, model, input_tokens, output_tokens, cost_usd, credits, free, demo) VALUES(?,?,?,?,?,?,0,0,?,0,1,?)',
    userId, String(feature).slice(0, 40), null, row?.id || null, row?.adapter || 'mock', String(row?.model || row?.adapter || 'demo').slice(0, 80), r6(usd), demo ? 1 : 0);
  checkCap();
  return { cost_usd: r6(usd) };
}

// ---------- House daily cap + alerts ----------
function spentToday() { return Number(get("SELECT COALESCE(SUM(cost_usd),0) AS t FROM llm_usage WHERE substr(created_at,1,10) = ?", today()).t) || 0; }
function alert(kind, message, level = 'warn', day = today()) {
  const info = run('INSERT OR IGNORE INTO admin_alerts(kind, day, level, message) VALUES(?,?,?,?)', kind, day, level, String(message).slice(0, 400));
  if (info.changes) console.warn(`[alert] ${kind}: ${message}`);
  return !!info.changes;
}
function checkCap() {
  const c = cfg(), cap = Number(c.daily_cap_usd) || 0;
  if (!(cap > 0)) return;
  const s = spentToday(), pct = Number(c.alert_pct) || 80;
  if (s >= cap) alert('llm_cap', `The AI text bill reached $${s.toFixed(2)} today, the daily cap of $${cap.toFixed(2)}. Free AI steps (chat-edit planning) are paused until midnight UTC. Paid jobs keep running. Raise the cap in Admin → Profit.`, 'stop');
  else if (s >= cap * pct / 100) alert('llm_cap_warn', `The AI text bill is at $${s.toFixed(2)} today (${Math.round((s / cap) * 100)}% of the $${cap.toFixed(2)} daily cap).`, 'warn');
}
const capReached = () => { const c = cfg(), cap = Number(c.daily_cap_usd) || 0; return cap > 0 && c.block_free_at_cap !== false && spentToday() >= cap; };

// ---------- Allowance, fee, rate limits ----------
const planKey = (user) => { const p = require('./credits').activePlan(user); return p ? p.id : 'free'; };
function featureCfg(feature) { const c = cfg(); return feature === 'chat_edit' ? c.chat_edit : { ...c.free_steps, free_per_day: null, credits_per_message: 0 }; }
function usedToday(userId, feature) { return Number(get('SELECT COUNT(*) AS n FROM llm_usage WHERE user_id = ? AND feature = ? AND substr(created_at,1,10) = ?', userId, feature, today()).n) || 0; }
function usedSince(userId, feature, ms) { return Number(get('SELECT COUNT(*) AS n FROM llm_usage WHERE user_id = ? AND feature = ? AND created_at >= ?', userId, feature, new Date(Date.now() - ms).toISOString()).n) || 0; }
// What the next message costs this account: {free_left, credits}.
function allowance(user, feature = 'chat_edit') {
  const f = featureCfg(feature);
  const fpd = f.free_per_day && typeof f.free_per_day === 'object' ? Number(f.free_per_day[planKey(user)] ?? f.free_per_day.free) || 0 : Infinity;
  const used = usedToday(user.id, feature);
  const left = Math.max(0, fpd - used);
  return { free_per_day: Number.isFinite(fpd) ? fpd : null, used_today: used, free_left: Number.isFinite(left) ? left : null, credits: left > 0 ? 0 : Math.max(0, Math.round(Number(f.credits_per_message) || 0)) };
}
function checkLimits(user, feature) {
  const f = featureCfg(feature);
  if (capReached()) fail(503, 'AI editing is paused for the rest of the day. Your videos and paid jobs are not affected. Try again tomorrow.', { llm_cap: true });
  if (Number(f.per_minute) > 0 && usedSince(user.id, feature, 6e4) >= Number(f.per_minute)) fail(429, 'You are sending messages very fast. Wait a minute and try again.');
  if (Number(f.per_day) > 0 && usedToday(user.id, feature) >= Number(f.per_day)) fail(429, 'You reached today\'s limit for AI edit messages. It resets at midnight UTC.');
}

// Run one free-to-the-user text step. `llm` (tests) replaces the provider: async ({system, prompt, max_tokens}) => {text, usage}.
// Returns {text, cost_usd, credits, free}. The fee is taken before the call and given back when the call fails.
async function call(user, feature, input, { llm = null, ref = null } = {}) {
  checkLimits(user, feature);
  const a = allowance(user, feature);
  const credits = require('./credits');
  let take = null;
  if (a.credits > 0) take = credits.spend(user.id, a.credits, `AI ${feature.replace('_', ' ')} message`, ref || `llm:${feature}`);
  try {
    let text, usage, provider = null;
    if (llm) { const r = await llm(input); text = r.text; usage = r.usage; provider = { id: null, adapter: r.adapter || 'test', model: r.model || 'claude-sonnet-5-5' }; }
    else {
      const providers = require('./providers');
      let lastErr = null;
      for (const p of providers.chain('text')) {
        try { const r = await providers.submit(p, 'text', input); if (!r.done) throw new Error('text provider did not answer'); text = r.result.text; usage = r.result.usage; provider = p; break; }
        catch (e) { lastErr = e; }
      }
      if (!provider) throw lastErr || new Error('No text provider.');
    }
    const c = record({ userId: user.id, feature, provider, usage, input, text, credits: a.credits, free: a.credits === 0 });
    return { text, cost_usd: c.cost_usd, credits: a.credits, free: a.credits === 0, demo: provider.adapter === 'mock' };
  } catch (e) {
    if (take) credits.refund(user.id, take, `Refund: AI ${feature.replace('_', ' ')} failed`, ref || `llm:${feature}`);
    throw e;
  }
}

// ---------- Reports ----------
function summary(days = 30) {
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const byDay = all("SELECT substr(created_at,1,10) AS day, COUNT(*) AS calls, SUM(cost_usd) AS cost_usd, SUM(CASE WHEN job_id IS NULL THEN cost_usd ELSE 0 END) AS free_cost_usd, SUM(credits) AS credits FROM llm_usage WHERE substr(created_at,1,10) >= ? GROUP BY day ORDER BY day", since);
  const byFeature = all("SELECT feature, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd, SUM(credits) AS credits, SUM(free) AS free_calls FROM llm_usage WHERE substr(created_at,1,10) >= ? GROUP BY feature ORDER BY cost_usd DESC", since);
  const topAccounts = all("SELECT l.user_id, u.email, COUNT(*) AS calls, SUM(l.cost_usd) AS cost_usd, SUM(l.credits) AS credits FROM llm_usage l LEFT JOIN users u ON u.id = l.user_id WHERE substr(l.created_at,1,10) >= ? AND l.job_id IS NULL GROUP BY l.user_id ORDER BY cost_usd DESC LIMIT 10", since);
  const c = cfg();
  return { days, today_usd: r6(spentToday()), daily_cap_usd: Number(c.daily_cap_usd) || 0, cap_reached: capReached(), by_day: byDay, by_feature: byFeature, top_free_accounts: topAccounts, settings: c };
}
const alerts = (limit = 30) => all('SELECT * FROM admin_alerts ORDER BY id DESC LIMIT ?', limit);

module.exports = { recordProvider, migrate, priceFor, costOf, estimateUsage, record, call, allowance, checkLimits, capReached, spentToday, alert, alerts, summary, checkCap };
