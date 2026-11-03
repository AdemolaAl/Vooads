// Admin money views: customers with lifetime spend (net of refunds), credits bought/used, our AI cost and profit; one
// customer's spend timeline; revenue, MRR, ARPU and top spenders for the overview; CSV export. The math is in
// finance-core.js (shared with the demo). Money is only returned to staff with the users.finance permission (routes check).
const { get, all, db, J } = require('./db');
const core = require('./finance-core');
const { pricing } = require('./settings');

// Schema additions (safe on every boot): when a payment was refunded and by whom, proof for bank transfers.
function migrate() {
  const cols = all('PRAGMA table_info(payments)').map((c) => c.name);
  for (const [c, d] of [['refunded_at', 'TEXT'], ['refunded_by', 'INTEGER'], ['proof_url', 'TEXT'], ['review_note', 'TEXT']]) if (!cols.includes(c)) db.exec(`ALTER TABLE payments ADD COLUMN ${c} ${d}`);
  db.exec('CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id, status)');
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Date range from the query: from/to as YYYY-MM-DD (inclusive). Returns comparable string bounds or nulls.
function range(q = {}) {
  const from = DAY.test(String(q.from || '')) ? String(q.from) : null;
  const to = DAY.test(String(q.to || '')) ? String(q.to) : null;
  return { from, to, inRange: (s) => { const d = s ? String(s).slice(0, 10) : null; if (!d) return !from && !to; return (!from || d >= from) && (!to || d <= to); } };
}

// Job totals per customer: credits used (not refunded), our AI cost (finished, real provider), job count, last job.
function jobAgg(rg, userId = null) {
  const where = [], p = [];
  if (userId) { where.push('user_id = ?'); p.push(userId); }
  if (rg.from) { where.push('substr(created_at,1,10) >= ?'); p.push(rg.from); }
  if (rg.to) { where.push('substr(created_at,1,10) <= ?'); p.push(rg.to); }
  const rows = all(`SELECT user_id, SUM(CASE WHEN refunded = 0 AND status != 'failed' THEN credits ELSE 0 END) AS used,
    SUM(CASE WHEN status = 'done' AND demo = 0 THEN COALESCE(CAST(json_extract(state, '$.quote.provider_cost_usd') AS REAL), 0) ELSE 0 END) AS ai_cost,
    COUNT(*) AS jobs, MAX(created_at) AS last_job FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY user_id`, ...p);
  return Object.fromEntries(rows.map((r) => [r.user_id, r]));
}

function paymentsBy(rg, userId = null) {
  const rows = all(`SELECT id, user_id, kind, plan_id, period, topup_id, credits, amount_usd, discount_code, status, adapter, created_at, paid_at, refunded_at
    FROM payments WHERE status IN ('paid','refunded') ${userId ? 'AND user_id = ?' : ''}`, ...(userId ? [userId] : []));
  const by = {};
  for (const p of rows) if (rg.inRange(p.paid_at || p.created_at)) (by[p.user_id] = by[p.user_id] || []).push(p);
  return by;
}

const SORTS = { spend: 'net_usd', profit: 'profit_usd', ai_cost: 'ai_cost_usd', credits_used: 'credits_used', credits_bought: 'credits_bought', last_active: 'last_active', joined: 'created_at', email: 'email' };
const MONEY_SORTS = ['spend', 'profit', 'ai_cost'];

// Customers list with spend columns. money=false strips every USD field (staff without users.finance).
function customers(q = {}, { money = false } = {}) {
  const rg = range(q);
  const P = pricing();
  const term = String(q.q || '').trim().toLowerCase().slice(0, 100);
  const where = [], params = [];
  if (term) { where.push("(lower(email) LIKE ? OR lower(COALESCE(name,'')) LIKE ?)"); params.push('%' + term + '%', '%' + term + '%'); }
  if (['active', 'suspended', 'banned'].includes(q.status)) { where.push('status = ?'); params.push(q.status); }
  const users = all(`SELECT id, email, name, country, plan_id, plan_period, plan_expires_at, plan_credits, topup_credits, trial_credits, status, created_at, last_seen_at FROM users ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, ...params);
  const pays = paymentsBy(rg), jobsA = jobAgg(rg), nowIso = new Date().toISOString();
  let rows = users.map((u) => {
    const s = core.summarize(pays[u.id] || [], P), j = jobsA[u.id] || {};
    const planActive = !!(u.plan_id && u.plan_expires_at > nowIso);
    const ai = core.r2(j.ai_cost || 0);
    return {
      id: u.id, email: u.email, name: u.name, country: u.country, status: u.status, created_at: u.created_at, last_seen_at: u.last_seen_at,
      last_active: [u.last_seen_at, j.last_job].filter(Boolean).map((x) => (String(x).includes('T') ? x : String(x).replace(' ', 'T') + 'Z')).sort().pop() || null,
      plan_id: planActive ? u.plan_id : null, plan_period: planActive ? u.plan_period : null, plan_active: planActive,
      balance: (planActive ? u.plan_credits : 0) + u.topup_credits + u.trial_credits,
      credits_bought: s.credits_bought, credits_used: Number(j.used) || 0, jobs: Number(j.jobs) || 0,
      net_usd: s.net_usd, gross_usd: s.gross_usd, refunds_usd: s.refunds_usd, discount_usd: s.discount_usd, ai_cost_usd: ai, profit_usd: core.r2(s.net_usd - ai), payments: s.payments,
    };
  });
  if (q.plan === 'paying') rows = rows.filter((r) => r.plan_active); else if (q.plan === 'free') rows = rows.filter((r) => !r.plan_active); else if (q.plan) rows = rows.filter((r) => r.plan_id === q.plan);
  if (money && Number(q.min_spend) > 0) rows = rows.filter((r) => r.net_usd >= Number(q.min_spend));
  if (money && q.spenders === '1') rows = rows.filter((r) => r.net_usd > 0);
  let sort = SORTS[q.sort] ? q.sort : 'joined';
  if (!money && MONEY_SORTS.includes(sort)) sort = 'joined';
  const key = SORTS[sort], dir = q.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => { const x = a[key] ?? '', y = b[key] ?? ''; return (x > y ? 1 : x < y ? -1 : 0) * dir || (b.id - a.id); });
  const total = rows.length;
  const totals = money ? rows.reduce((t, r) => ({ net_usd: t.net_usd + r.net_usd, ai_cost_usd: t.ai_cost_usd + r.ai_cost_usd, profit_usd: t.profit_usd + r.profit_usd, refunds_usd: t.refunds_usd + r.refunds_usd }), { net_usd: 0, ai_cost_usd: 0, profit_usd: 0, refunds_usd: 0 }) : null;
  if (totals) for (const k of Object.keys(totals)) totals[k] = core.r2(totals[k]);
  const lim = Math.max(1, Math.min(5000, Number(q.limit) || 50)), off = Math.max(0, Number(q.offset) || 0);
  const page = (q.all ? rows : rows.slice(off, off + lim)).map((r) => (money ? r : strip(r)));
  return { users: page, total, totals, sort, dir: dir === 1 ? 'asc' : 'desc', from: rg.from, to: rg.to, money };
}
const MONEY_KEYS = ['net_usd', 'gross_usd', 'refunds_usd', 'discount_usd', 'ai_cost_usd', 'profit_usd', 'payments'];
function strip(r) { const o = { ...r }; for (const k of MONEY_KEYS) delete o[k]; return o; }

function customersCsv(q) {
  const d = customers({ ...q, all: 1 }, { money: true });
  const head = ['id', 'email', 'name', 'country', 'status', 'plan', 'joined', 'last_active', 'net_spend_usd', 'gross_usd', 'refunds_usd', 'discounts_usd', 'credits_bought', 'credits_used', 'ai_cost_usd', 'profit_usd', 'payments', 'jobs'];
  return core.csv([head, ...d.users.map((r) => [r.id, r.email, r.name || '', r.country || '', r.status, r.plan_id || 'free', r.created_at, r.last_active || '', r.net_usd.toFixed(2), r.gross_usd.toFixed(2), r.refunds_usd.toFixed(2), r.discount_usd.toFixed(2), r.credits_bought, r.credits_used, r.ai_cost_usd.toFixed(2), r.profit_usd.toFixed(2), r.payments, r.jobs])]);
}

// One customer: spend summary, timeline, jobs with credits and our AI cost, tickets and referrals.
function customer(id, { money = false, payments = false } = {}) {
  const u = get('SELECT * FROM users WHERE id = ?', Number(id));
  if (!u) return null;
  const P = pricing();
  const pays = all('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC', u.id).map((p) => ({ ...p, raw: undefined }));
  const s = core.summarize(pays, P);
  const ja = jobAgg(range({}), u.id)[u.id] || {};
  const jobs = all('SELECT id, type, status, credits, refunded, demo, error, input, state, created_at FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT 60', u.id).map((j) => {
    const i = J(j.input, {}), st = J(j.state, {});
    const cost = st.quote && Number(st.quote.provider_cost_usd) ? core.r2(st.quote.provider_cost_usd) : null;
    return { id: j.id, type: j.type, status: j.status, credits: j.credits, refunded: !!j.refunded, demo: !!j.demo, error: j.error, created_at: j.created_at,
      label: i.tool_name || i.video_type || j.type, level: i.level_name || null, seconds: i.duration || i.seconds || null,
      ...(money ? { ai_cost_usd: j.status === 'done' && !j.demo ? cost : 0, est_cost_usd: cost } : {}) };
  });
  const tickets = all('SELECT id, subject, status, priority, category, updated_at FROM tickets WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id);
  const refs = all('SELECT id, email, name, created_at FROM users WHERE referred_by = ? ORDER BY id DESC', u.ref_code || '\u0000');
  const refSpend = money && refs.length ? Object.fromEntries(refs.map((x) => [x.id, core.summarize(all("SELECT * FROM payments WHERE user_id = ? AND status IN ('paid','refunded')", x.id), P).net_usd])) : {};
  const ai = core.r2(ja.ai_cost || 0);
  const out = {
    summary: { credits_bought: s.credits_bought, credits_used: Number(ja.used) || 0, jobs: Number(ja.jobs) || 0, last_active: u.last_seen_at, ...(money ? { net_usd: s.net_usd, gross_usd: s.gross_usd, refunds_usd: s.refunds_usd, discount_usd: s.discount_usd, ai_cost_usd: ai, profit_usd: core.r2(s.net_usd - ai), payments: s.payments, first_paid_at: s.first_paid_at, last_paid_at: s.last_paid_at } : {}) },
    timeline: money ? core.timeline(pays, P) : [],
    payments: payments ? pays : [],
    jobs, tickets,
    referrals: refs.map((x) => ({ id: x.id, email: x.email, name: x.name, created_at: x.created_at, ...(money ? { net_usd: refSpend[x.id] || 0 } : {}) })),
  };
  return out;
}

// Revenue block for the overview.
function overview(days = 30) {
  const P = pricing();
  const n = Math.max(7, Math.min(365, Number(days) || 30));
  const pays = all("SELECT id, user_id, kind, plan_id, period, topup_id, credits, amount_usd, discount_code, status, created_at, paid_at, refunded_at FROM payments WHERE status IN ('paid','refunded')");
  const all_ = core.summarize(pays, P);
  const series = core.daily(pays, n);
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const last30 = core.summarize(pays.filter((p) => String(p.paid_at || p.created_at).slice(0, 10) >= since), P);
  const m = core.mrr(all('SELECT plan_id, plan_period, plan_expires_at FROM users WHERE plan_id IS NOT NULL'), P);
  const ai30 = core.r2(get("SELECT COALESCE(SUM(CAST(json_extract(state, '$.quote.provider_cost_usd') AS REAL)), 0) AS t FROM jobs WHERE status = 'done' AND demo = 0 AND substr(created_at,1,10) >= ?", since).t);
  const top = customers({ sort: 'spend', dir: 'desc', limit: 10, spenders: '1' }, { money: true }).users;
  const ever = new Set(pays.filter((p) => p.status === 'paid').map((p) => p.user_id)).size;
  return {
    total_revenue_usd: all_.net_usd, gross_usd: all_.gross_usd, refunds_usd: all_.refunds_usd, discount_usd: all_.discount_usd,
    revenue_30d_usd: last30.net_usd, refunds_30d_usd: last30.refunds_usd, ai_cost_30d_usd: ai30, profit_30d_usd: core.r2(last30.net_usd - ai30),
    mrr_usd: m.mrr, paying: m.paying, arpu_usd: m.arpu, customers_ever_paid: ever, avg_lifetime_usd: ever ? core.r2(all_.net_usd / ever) : 0,
    series, days: n, top_spenders: top.map((t) => ({ id: t.id, email: t.email, name: t.name, plan_id: t.plan_id, net_usd: t.net_usd, profit_usd: t.profit_usd, credits_used: t.credits_used })),
  };
}

module.exports = { migrate, customers, customersCsv, customer, overview, range, MONEY_SORTS };
