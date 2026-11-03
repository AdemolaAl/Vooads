// Real-cost watchdog: the profit guard prices jobs from our cost table; this checks the table against what jobs really cost.
//
//  1. Every finished provider step is written to job_costs with the real cost when the provider tells us (Anthropic tokens,
//     a fal endpoint that returns its cost) or when we can measure it exactly (ElevenLabs bills the characters we send):
//     source 'reported' / 'measured'. Otherwise the table cost, marked 'estimated'.
//  2. Every housekeeping run (hourly) compares, per provider row (model + level), the real cost of the last 50 reported or
//     measured steps (last 7 days) with the table cost of those same steps.
//  3. More than 10% above the table: the row's table cost is raised to the real figure, the margin guard runs again (level
//     prices and saved prices are raised so every price keeps 60%), the owner is alerted (admin + email when mail is set up)
//     with old and new figures, and it goes in the audit log. Prices are never lowered automatically: more than 10% below the
//     table only adds a suggestion in admin.
//  4. Kill switch: a video type whose real margin over the last 24 hours (Profit page numbers) is under 40% is paused for new
//     jobs ("temporarily unavailable") and the owner is alerted. The owner's override switches it back on (and keeps the
//     switch off for that type for 24 hours so it does not flip straight back).
const { get, all, run } = require('./db');
const { getSetting, setSetting } = require('./settings');

const DRIFT = 0.10, WINDOW = 50, DAYS = 7, KILL_MARGIN = 40, KILL_MIN_JOBS = 3;
run(`CREATE TABLE IF NOT EXISTS job_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, provider_id INTEGER, kind TEXT, level TEXT, units REAL,
  usd REAL NOT NULL, table_usd REAL NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
run('CREATE INDEX IF NOT EXISTS job_costs_provider ON job_costs(provider_id, created_at)');
run(`CREATE TABLE IF NOT EXISTS provider_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, provider_id INTEGER, kind TEXT, temporary INTEGER NOT NULL DEFAULT 0, message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
run('CREATE INDEX IF NOT EXISTS provider_failures_p ON provider_failures(provider_id, created_at)');
const FAIL_ALERT = 0.15, FAIL_MIN_ATTEMPTS = 5;

const r4 = (x) => Math.round(x * 1e4) / 1e4;
function alertOwner(kind, message, level = 'warn', day) {
  const bill = require('./llmbill');
  const fresh = bill.alert(kind, message, level, day);
  if (!fresh) return false;
  try {
    const to = require('./config').ownerEmail;
    if (to) require('./email').deliver?.(to, { subject: 'Vooads: ' + message.slice(0, 70), text: message, html: '<p>' + String(message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</p><p>Admin → Business → Profit</p>' })?.catch?.(() => {});
  } catch {}
  return true;
}
function audit(action, detail) { try { run("INSERT INTO audit_log(staff_id, action, target, detail) VALUES(NULL, ?, 'watchdog', ?)", action, JSON.stringify(detail)); } catch {} }

// ---------- 1. Record ----------
// Real cost of one finished step. Returns {usd, table, source}.
function measure(row, kind, input, result) {
  const guard = require('./guard');
  const seconds = kind === 'voice' ? String(input.text || '').length / 15 : Number(input.duration || input.seconds) || 0;
  const table = row && row.adapter !== 'mock' && Number(row.cost_usd) > 0 ? guard.rowCostFor(row, { seconds, calls: 1 }) : 0;
  const rc = Number(result && result.cost_usd);
  if (Number.isFinite(rc) && rc >= 0 && result && result.cost_usd !== undefined) return { usd: rc, table, source: 'reported' };
  // ElevenLabs bills the characters sent; with a per-1k-characters price that is an exact figure.
  if (kind === 'voice' && row && /1k|1000|char/i.test(String(row.cost_unit || '')) && Number(row.cost_usd) > 0) return { usd: (String(input.text || '').length / 1000) * Number(row.cost_usd), table, source: 'measured' };
  return { usd: table, table, source: 'estimated' };
}
function record(job, row, kind, input, m, usdOverride) {
  if (!row || row.adapter === 'mock' || !row.id) return;
  const lv = (row.config && row.config.level) || 'standard';
  run('INSERT INTO job_costs(job_id, provider_id, kind, level, units, usd, table_usd, source) VALUES(?,?,?,?,?,?,?,?)', job ? job.id : null, row.id, kind, lv, Number(input.duration || input.seconds) || null, r4(usdOverride ?? m.usd), r4(m.table), m.source);
}

// Every failed provider attempt (temporary or not), for the failure rate per model.
function recordFailure(job, row, kind, temporary, message) {
  if (!row || row.adapter === 'mock' || !row.id) return;
  run('INSERT INTO provider_failures(job_id, provider_id, kind, temporary, message) VALUES(?,?,?,?,?)', job ? job.id : null, row.id, kind, temporary ? 1 : 0, String(message || '').slice(0, 200));
}
// Failure rate per model over a window: failed attempts / (failed attempts + finished steps).
function failureRates(hours = 24) {
  const since = new Date(Date.now() - hours * 36e5).toISOString();
  const f = Object.fromEntries(all('SELECT provider_id, COUNT(*) AS n, SUM(temporary) AS temp FROM provider_failures WHERE created_at >= ? GROUP BY provider_id', since).map((x) => [x.provider_id, x]));
  const ok = Object.fromEntries(all('SELECT provider_id, COUNT(*) AS n FROM job_costs WHERE created_at >= ? GROUP BY provider_id', since).map((x) => [x.provider_id, x.n]));
  const ids = new Set([...Object.keys(f), ...Object.keys(ok)].map(Number));
  return [...ids].map((id) => {
    const fails = f[id] ? f[id].n : 0, okN = ok[id] || 0, row = get('SELECT name, kind, config FROM providers WHERE id = ?', id) || {};
    let lv = 'standard'; try { lv = JSON.parse(row.config || '{}').level || 'standard'; } catch {}
    return { provider_id: id, name: row.name || '#' + id, kind: row.kind, level: lv, attempts: fails + okN, failures: fails, temporary: f[id] ? f[id].temp : 0, rate: fails + okN ? Math.round((fails / (fails + okN)) * 1000) / 10 : 0 };
  }).sort((a, b) => b.rate - a.rate);
}
function failureAlerts() {
  const out = [];
  for (const m of failureRates(24)) {
    if (m.attempts < FAIL_MIN_ATTEMPTS || m.rate <= FAIL_ALERT * 100) continue;
    if (alertOwner('fail_rate_' + m.provider_id, `${m.name} failed ${m.failures} of ${m.attempts} attempts in the last 24 hours (${m.rate}%, over ${FAIL_ALERT * 100}%). Jobs fall back to other models at the same or a lower level; check the provider's status or switch the model off in AI providers.`, 'warn', new Date().toISOString().slice(0, 10))) out.push(m);
  }
  return out;
}
// Failure buffer for the profit guard: provider cost wasted on failed jobs / cost of finished jobs, per type, last 30 days.
// Starts at 5% (DEFAULT_FAIL_BUFFER) and follows the real figure once a type has 20+ jobs (never under 2%, never over 50%).
const DEFAULT_FAIL_BUFFER = 0.05;
function updateFailureBuffers() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const by = {};
  for (const j of all("SELECT type, status, input, state FROM jobs WHERE substr(created_at,1,10) >= ? AND demo = 0 AND status IN ('done','failed')", since)) {
    let i = {}, st = {}; try { i = JSON.parse(j.input || '{}'); st = JSON.parse(j.state || '{}'); } catch {}
    const k = i.video_type || j.type, c = Number(st.real_cost_usd) || 0;
    const b = (by[k] = by[k] || { jobs: 0, wasted: 0, done: 0 });
    b.jobs++; if (j.status === 'failed') b.wasted += c; else b.done += c;
  }
  const rates = { ...(getSetting('failure_rates') || {}) };
  for (const [k, b] of Object.entries(by)) if (b.jobs >= 20 && b.done > 0) rates[k] = Math.max(0.02, Math.min(0.5, Math.round((b.wasted / b.done) * 1000) / 1000));
  setSetting('failure_rates', rates);
  return rates;
}
function failBuffer(typeId) { const r = (getSetting('failure_rates') || {})[typeId]; return Number.isFinite(Number(r)) ? Number(r) : DEFAULT_FAIL_BUFFER; }

// ---------- 2 + 3. Drift ----------
function drift() {
  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const out = [];
  for (const p of all("SELECT DISTINCT provider_id FROM job_costs WHERE source != 'estimated' AND created_at >= ?", since)) {
    const rows = all("SELECT usd, table_usd FROM job_costs WHERE provider_id = ? AND source != 'estimated' AND created_at >= ? AND table_usd > 0 ORDER BY id DESC LIMIT ?", p.provider_id, since, WINDOW);
    if (!rows.length) continue;
    const real = rows.reduce((t, x) => t + x.usd, 0), table = rows.reduce((t, x) => t + x.table_usd, 0);
    if (!(table > 0)) continue;
    out.push({ provider_id: p.provider_id, steps: rows.length, real_usd: r4(real), table_usd: r4(table), ratio: Math.round((real / table) * 1000) / 1000 });
  }
  return out;
}
function check() {
  const report = { raised: [], suggested: [], reguard: null };
  const settings = require('./settings');
  for (const d of drift()) {
    const row = get('SELECT * FROM providers WHERE id = ?', d.provider_id);
    if (!row || !(Number(row.cost_usd) > 0)) continue;
    if (d.ratio > 1 + DRIFT) {
      const from = Number(row.cost_usd), to = Math.ceil(from * d.ratio * 1e4) / 1e4;
      run('UPDATE providers SET cost_usd = ? WHERE id = ? AND cost_usd < ?', to, row.id, to); // only ever up
      // Steps already counted are not counted again for the next comparison.
      run("UPDATE job_costs SET table_usd = table_usd * ? WHERE provider_id = ? AND source != 'estimated'", d.ratio, row.id);
      const item = { provider_id: row.id, name: row.name, unit: row.cost_unit, from, to, ratio: d.ratio, steps: d.steps };
      report.raised.push(item);
      audit('watchdog.cost_raised', item);
      alertOwner('cost_drift_' + row.id, `${row.name} really costs ${Math.round((d.ratio - 1) * 100)}% more than our table (${d.steps} recent jobs). Table cost raised from $${from} to $${to} ${row.cost_unit || ''}; customer prices were re-checked to keep the 60% margin.`, 'warn', new Date().toISOString().slice(0, 13));
    } else if (d.ratio < 1 - DRIFT) {
      report.suggested.push({ provider_id: row.id, name: row.name, from: Number(row.cost_usd), real: r4(Number(row.cost_usd) * d.ratio), ratio: d.ratio });
    }
  }
  if (report.raised.length) report.reguard = reguard();
  setSetting('watchdog_report', { at: new Date().toISOString(), ...report });
  return report;
}
// Margin guard again after a cost change: level prices and saved prices rise to the guard minimum (never down).
function reguard() {
  const guard = require('./guard'), pf = require('./pricefloor');
  const P = JSON.parse(JSON.stringify(getSetting('pricing')));
  const levels = guard.raiseLevels(P);
  const changes = pf.plan(P);
  if (levels.length || changes.length) {
    setSetting('pricing', P);
    audit('watchdog.prices_raised', { levels, changes });
  }
  return { levels, changes };
}

// ---------- 4. Kill switch ----------
const paused = () => getSetting('paused_types') || {};
function pausedReason(typeId) { const p = paused()[typeId]; return p && p.on ? p : null; }
function killSwitch() {
  const rep = require('./profit').report({ days: 1 });
  const P = { ...paused() };
  const hit = [];
  for (const t of rep.types) {
    const cur = P[t.id];
    if (cur && cur.on) continue;
    if (cur && cur.override_until && cur.override_until > new Date().toISOString()) continue;
    if (t.margin_pct === null || t.margin_pct >= KILL_MARGIN || t.jobs < KILL_MIN_JOBS || !(t.cost_usd > 0)) continue;
    P[t.id] = { on: true, at: new Date().toISOString(), margin_pct: t.margin_pct, cost_usd: t.cost_usd, revenue_usd: t.revenue_usd, jobs: t.jobs };
    hit.push({ id: t.id, name: t.name, margin_pct: t.margin_pct });
    audit('watchdog.type_paused', { type: t.id, margin_pct: t.margin_pct, cost_usd: t.cost_usd, revenue_usd: t.revenue_usd });
    alertOwner('paused_' + t.id, `${t.name} was paused for new jobs: its real margin over the last 24 hours is ${t.margin_pct}% (under ${KILL_MARGIN}%). Revenue $${t.revenue_usd}, real cost $${t.cost_usd}. Switch it back on in Admin → Profit when the cause is fixed.`, 'stop', new Date().toISOString().slice(0, 10));
  }
  if (hit.length) setSetting('paused_types', P);
  return hit;
}
function resume(typeId, staff) {
  const P = { ...paused() };
  P[typeId] = { on: false, override_until: new Date(Date.now() + 864e5).toISOString(), resumed_by: staff ? staff.id : null, resumed_at: new Date().toISOString() };
  setSetting('paused_types', P);
  audit('watchdog.type_resumed', { type: typeId, by: staff ? staff.email : null });
  return P[typeId];
}
function run1() {
  const out = {};
  try { out.drift = check(); } catch (e) { console.error('[watchdog] drift', e.message); }
  try { out.paused = killSwitch(); } catch (e) { console.error('[watchdog] kill switch', e.message); }
  try { out.fail_alerts = failureAlerts(); out.buffers = updateFailureBuffers(); } catch (e) { console.error('[watchdog] failures', e.message); }
  try { out.attention_cancelled = expireAttention(); } catch (e) { console.error('[watchdog] attention', e.message); }
  return out;
}
// "Needs attention" jobs nobody answered for 7 days: cancelled with the full refund (Refund Policy §4).
function expireAttention() {
  const jobs = require('./jobs');
  let n = 0;
  for (const j of all("SELECT * FROM jobs WHERE status = 'attention'")) {
    let st = {}; try { st = JSON.parse(j.state || '{}'); } catch {}
    if (st.attention && st.attention.keep_until && st.attention.keep_until < new Date().toISOString()) { jobs.failJob(j, 'No choice was made for 7 days, so this video was cancelled and all its credits are back.'); n++; }
  }
  return n;
}
function view() {
  return { report: getSetting('watchdog_report') || null, drift: drift(), paused: paused(), failure_rates: failureRates(24), failure_buffers: getSetting('failure_rates') || {}, default_failure_buffer_pct: DEFAULT_FAIL_BUFFER * 100, thresholds: { drift_pct: DRIFT * 100, window: WINDOW, days: DAYS, kill_margin_pct: KILL_MARGIN, kill_min_jobs: KILL_MIN_JOBS } };
}

module.exports = { alertOwner, recordFailure, failureRates, failureAlerts, updateFailureBuffers, failBuffer, expireAttention, DEFAULT_FAIL_BUFFER, measure, record, drift, check, reguard, killSwitch, resume, pausedReason, run: run1, view, DRIFT, KILL_MARGIN };
