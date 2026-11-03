// Naira exchange-rate safety for Bachs (Nigeria pays in naira).
//  - FX buffer: the naira price is USD × rate × (1 + buffer). Default 0% (the Bachs 4% customer fee now covers it), kept for
//    extra cover ("fx_buffer_pct" on the Bachs method).
//  - Automatic rate (optional, off until a source is set): a JSON feed (method config "fx_url" or env FX_RATE_URL) and a JSON
//    path ("fx_json_path", e.g. "rates.NGN"), checked every hour. A higher rate is applied at once (it protects the owner); a
//    lower one only within 2% per step, a bigger drop waits for the owner's approval. Every change is audit-logged and alerted.
//    A failed feed keeps the last rate, and the staleness rules (warning at 7 days, optional pause at 30) apply as before.
//  - Sudden move: when the feed shows the naira more than 5% weaker than the saved rate, the rate is raised to the feed at once
//    (auto on) or naira checkout pauses until the owner saves a new rate (auto off). The owner is alerted either way.
const { get, all, run, J } = require('./db');

const DEFAULT_BUFFER_PCT = 0, MAX_AUTO_DROP = 0.02, SUDDEN = 0.05;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
function bufferPct(m) { const v = num(m && m.config && m.config.fx_buffer_pct); return Number.isFinite(v) && v >= 0 && v <= 50 ? v : DEFAULT_BUFFER_PCT; }
function rate(m) { const r = num(m && m.config && m.config.ngn_rate); return r > 0 ? r : 0; }
function effectiveRate(m) { const r = rate(m); return r ? Math.round(r * (1 + bufferPct(m) / 100) * 100) / 100 : 0; }
const ngnFmt = (n) => '₦' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
function explain(m) { const r = rate(m); if (!r) return null; return bufferPct(m) ? `${ngnFmt(r)} + ${bufferPct(m)}% = ${ngnFmt(effectiveRate(m))} per $1` : `${ngnFmt(r)} per $1`; }
function source(m) { const c = (m && m.config) || {}; return { url: String(c.fx_url || process.env.FX_RATE_URL || '').trim(), path: String(c.fx_json_path || process.env.FX_RATE_PATH || '').trim() }; }
function autoOn(m) { return ['yes', 'true', '1', true].includes(m && m.config && m.config.fx_auto) && !!source(m).url; }
function paused(m) { return !!(m && m.config && m.config.fx_paused); }

// "rates.NGN", "data.0.rate", "NGN" — dots walk objects and arrays.
function pick(obj, p) {
  if (!p) return typeof obj === 'number' ? obj : num(obj && (obj.NGN ?? obj.ngn ?? obj.rate));
  return String(p).split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
async function fetchRate(m, fetcher) {
  const { url, path } = source(m);
  if (!url) throw new Error('No rate source set.');
  const body = fetcher ? await fetcher(url) : JSON.parse((await require('./lib/netguard').download(url, { timeoutMs: 15e3, maxBytes: 2e6 })).body.toString('utf8'));
  const r = num(typeof body === 'string' ? JSON.parse(body) : body) || num(pick(typeof body === 'string' ? JSON.parse(body) : body, path));
  if (!(r > 50 && r < 1e6)) throw new Error('The feed did not return a usable USD/NGN rate' + (path ? ' at "' + path + '"' : '') + '.');
  return r;
}

function saveConfig(id, patch) {
  const row = get('SELECT config FROM payment_methods WHERE id = ?', id);
  const cfg = { ...J(row && row.config, {}), ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === undefined) delete cfg[k];
  run('UPDATE payment_methods SET config = ? WHERE id = ?', JSON.stringify(cfg), id);
  return cfg;
}
function audit(action, detail, staff) {
  try { run('INSERT INTO audit_log(staff_id, action, target, detail, actor) VALUES(?,?,?,?,?)', staff ? staff.id : null, action, 'fx', JSON.stringify(detail), staff ? staff.email : 'fx-watch'); } catch {}
}
const alert = (kind, msg, level) => { try { return require('./watchdog').alertOwner ? require('./watchdog').alertOwner(kind, msg, level) : require('./llmbill').alert(kind, msg, level); } catch { return false; } };

// One check of one Bachs method against its feed. Returns what happened.
async function checkMethod(m, { fetcher, nowIso = new Date().toISOString() } = {}) {
  const { url } = source(m);
  if (!url) return { id: m.id, skipped: 'no source' };
  const saved = rate(m);
  let feed;
  try { feed = await fetchRate(m, fetcher); } catch (e) {
    saveConfig(m.id, { fx_last_error: String(e.message).slice(0, 200), fx_checked_at: nowIso });
    return { id: m.id, error: e.message, kept: saved };
  }
  const base = { fx_feed_rate: feed, fx_checked_at: nowIso, fx_last_error: undefined };
  const apply = (to, why, level = 'warn') => {
    saveConfig(m.id, { ...base, ngn_rate: to, ngn_rate_updated_at: nowIso, fx_paused: undefined, fx_pending_lower: undefined });
    audit('fx.rate_' + why, { method_id: m.id, from: saved, to, feed });
    alert('fx_rate_' + m.id + '_' + why + '_' + to + '_' + nowIso.slice(0, 13), `Naira rate ${why === 'raised' || why === 'sudden' ? 'raised' : 'lowered'} from ${ngnFmt(saved)} to ${ngnFmt(to)} per $1 (feed: ${ngnFmt(feed)}).${why === 'sudden' ? ' The naira weakened more than 5% at once.' : ''}`, level);
    return { id: m.id, changed: why, from: saved, to };
  };
  // Sudden weakening of the naira.
  if (saved && feed > saved * (1 + SUDDEN)) {
    if (autoOn(m)) return apply(feed, 'sudden', 'stop');
    if (!paused(m)) {
      saveConfig(m.id, { ...base, fx_paused: { at: nowIso, feed, saved } });
      audit('fx.paused', { method_id: m.id, saved, feed });
      alert('fx_paused_' + m.id + '_' + nowIso.slice(0, 10), `The naira weakened more than 5%: the feed says ${ngnFmt(feed)} per $1, your saved rate is ${ngnFmt(saved)}. Naira checkout is paused until you save a new rate on the Bachs method.`, 'stop');
    } else saveConfig(m.id, base);
    return { id: m.id, paused: true, saved, feed };
  }
  if (!autoOn(m)) { saveConfig(m.id, base); return { id: m.id, feed, saved, auto: false }; }
  if (!saved || feed > saved) return apply(feed, 'raised');
  if (feed === saved) { saveConfig(m.id, { ...base, ngn_rate_updated_at: nowIso }); return { id: m.id, same: true }; } // confirmed by the feed
  const drop = (saved - feed) / saved;
  if (drop <= MAX_AUTO_DROP) return apply(feed, 'lowered', 'info');
  // Bigger drop: wait for the owner. The saved rate stays (it is the safer one).
  const pend = m.config && m.config.fx_pending_lower;
  saveConfig(m.id, { ...base, fx_pending_lower: { rate: feed, at: nowIso, drop_pct: Math.round(drop * 1000) / 10 } });
  if (!pend || pend.rate !== feed) {
    audit('fx.lower_held', { method_id: m.id, saved, feed });
    alert('fx_lower_' + m.id + '_' + nowIso.slice(0, 10), `The feed shows the naira ${Math.round(drop * 1000) / 10}% stronger (${ngnFmt(feed)} per $1, saved ${ngnFmt(saved)}). We kept the saved rate. Approve the lower rate on the Bachs method if you want it.`, 'info');
  }
  return { id: m.id, held: true, saved, feed };
}
async function check(opts = {}) {
  const payments = require('./payments');
  const out = [];
  for (const r of all("SELECT id FROM payment_methods WHERE adapter = 'bachs'")) {
    const m = payments.byId(r.id);
    try { out.push(await checkMethod(m, opts)); } catch (e) { out.push({ id: r.id, error: e.message }); }
  }
  return out;
}
// The owner approves a held lower rate.
function approveLower(methodId, staff) {
  const m = require('./payments').byId(methodId);
  const p = m && m.config && m.config.fx_pending_lower;
  if (!p) return null;
  const nowIso = new Date().toISOString();
  saveConfig(m.id, { ngn_rate: p.rate, ngn_rate_updated_at: nowIso, fx_pending_lower: undefined, fx_paused: undefined });
  audit('fx.rate_lowered_approved', { method_id: m.id, from: rate(m), to: p.rate }, staff);
  return p.rate;
}

// Profit → FX: naira received in the window, converted at today's rate (the feed when there is one, else the saved rate
// without buffer), against the USD value of the credits those payments sold.
function report({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = all("SELECT amount_usd, amount_local FROM payments WHERE status = 'paid' AND currency = 'NGN' AND substr(COALESCE(paid_at, created_at), 1, 10) >= ?", since);
  const m = (() => { try { const r = get("SELECT id FROM payment_methods WHERE adapter = 'bachs' ORDER BY enabled DESC, id LIMIT 1"); return r && require('./payments').byId(r.id); } catch { return null; } })();
  const today = (m && (num(m.config.fx_feed_rate) > 0 ? num(m.config.fx_feed_rate) : rate(m))) || 0;
  const ngn = rows.reduce((t, r) => t + (Number(r.amount_local) || 0), 0);
  const usdSold = rows.reduce((t, r) => t + (Number(r.amount_usd) || 0), 0);
  const usdNow = today ? ngn / today : 0;
  const cover = usdSold ? Math.round((usdNow / usdSold) * 1000) / 10 : null;
  return { days, payments: rows.length, ngn_received: Math.round(ngn * 100) / 100, today_rate: today, today_source: m && num(m.config.fx_feed_rate) > 0 ? 'feed' : 'saved rate', usd_at_today: Math.round(usdNow * 100) / 100, usd_sold: Math.round(usdSold * 100) / 100, gap_usd: Math.round((usdNow - usdSold) * 100) / 100, covering_pct: cover, ok: cover === null || cover >= 100, saved_rate: m ? rate(m) : 0, buffer_pct: m ? bufferPct(m) : DEFAULT_BUFFER_PCT, effective: m ? explain(m) : null };
}

module.exports = { DEFAULT_BUFFER_PCT, MAX_AUTO_DROP, SUDDEN, bufferPct, rate, effectiveRate, explain, source, autoOn, paused, pick, fetchRate, checkMethod, check, approveLower, report };
