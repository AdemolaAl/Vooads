// Money math for the admin (customer spend, refunds, discounts, MRR, ARPU, revenue per day). Pure functions on plain rows,
// so the server and the demo backend compute exactly the same numbers. All amounts are USD, rounded to cents.
//
// Definitions (shown in the admin too):
//   gross     = what customers paid (paid + later refunded payments), after discount codes
//   refunds   = payments marked refunded (full amount)
//   net spend = gross − refunds
//   discount  = list price − amount charged, for payments that used a discount code
//   AI cost   = provider cost the profit guard recorded for each finished job that ran on a real provider (not demo)
//   profit    = net spend − AI cost
//   MRR       = active plans, monthly price (yearly ÷ 12)
//   ARPU      = MRR ÷ customers on an active plan
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const PAIDISH = ['paid', 'refunded'];

function listPrice(p, pricing) {
  if (!pricing) return null;
  if (p.kind === 'plan') {
    const pl = (pricing.plans || []).find((x) => x.id === p.plan_id);
    if (!pl) return null;
    return p.period === 'year' ? Number(pl.price_year) || Number(pl.price_month) * 10 : Number(pl.price_month);
  }
  const t = (pricing.topups || []).find((x) => x.id === p.topup_id);
  return t ? Number(t.price) : null;
}

// Money facts of one payment row.
function facts(p, pricing) {
  const counted = PAIDISH.includes(p.status);
  const gross = counted ? Number(p.amount_usd) || 0 : 0;
  const refund = p.status === 'refunded' ? gross : 0;
  const lp = counted && p.discount_code ? listPrice(p, pricing) : null;
  const discount = lp !== null && lp > gross ? lp - gross : 0;
  return { gross: r2(gross), refund: r2(refund), net: r2(gross - refund), discount: r2(discount), credits: p.status === 'paid' ? Number(p.credits) || 0 : 0, counted };
}

function summarize(payments, pricing) {
  const s = { gross_usd: 0, refunds_usd: 0, net_usd: 0, discount_usd: 0, credits_bought: 0, payments: 0, refunds: 0, pending: 0, first_paid_at: null, last_paid_at: null };
  for (const p of payments || []) {
    const f = facts(p, pricing);
    if (p.status === 'pending' || p.status === 'review') s.pending++;
    if (!f.counted) continue;
    s.gross_usd += f.gross; s.refunds_usd += f.refund; s.discount_usd += f.discount; s.credits_bought += f.credits; s.payments++;
    if (p.status === 'refunded') s.refunds++;
    const at = p.paid_at || p.created_at;
    if (at && (!s.first_paid_at || at < s.first_paid_at)) s.first_paid_at = at;
    if (at && (!s.last_paid_at || at > s.last_paid_at)) s.last_paid_at = at;
  }
  s.gross_usd = r2(s.gross_usd); s.refunds_usd = r2(s.refunds_usd); s.discount_usd = r2(s.discount_usd); s.net_usd = r2(s.gross_usd - s.refunds_usd);
  return s;
}

// Customer timeline: every payment, top-up and refund as dated events (newest first). Refunds are their own negative event.
function timeline(payments, pricing) {
  const ev = [];
  for (const p of payments || []) {
    const f = facts(p, pricing);
    const what = p.kind === 'plan' ? `Plan · ${p.plan_id || ''}${p.period ? ' (' + (p.period === 'year' ? 'yearly' : 'monthly') + ')' : ''}` : `Top-up · ${p.topup_id || ''}`;
    if (f.counted) ev.push({ type: p.kind === 'plan' ? 'payment' : 'topup', at: p.paid_at || p.created_at, payment_id: p.id, label: what, amount_usd: f.gross, discount_usd: f.discount, discount_code: p.discount_code || null, credits: Number(p.credits) || 0, adapter: p.adapter });
    if (p.status === 'refunded') ev.push({ type: 'refund', at: p.refunded_at || p.paid_at || p.created_at, payment_id: p.id, label: 'Refund · ' + what, amount_usd: -f.refund, adapter: p.adapter });
    if (!f.counted) ev.push({ type: p.status === 'review' ? 'review' : p.status === 'pending' ? 'pending' : 'failed', at: p.created_at, payment_id: p.id, label: what, amount_usd: 0, quoted_usd: r2(p.amount_usd), adapter: p.adapter, status: p.status });
  }
  return ev.sort((a, b) => (String(b.at) > String(a.at) ? 1 : String(b.at) < String(a.at) ? -1 : b.payment_id - a.payment_id));
}

const dayOf = (s) => {
  if (!s) return null;
  const t = String(s);
  return t.includes('T') ? t.slice(0, 10) : t.slice(0, 10);
};
// Net revenue per day for the `days` days ending today (UTC): {day, gross, refunds, net}. Refunds count on the day they happened.
function daily(payments, days = 30, end = new Date()) {
  const out = [], idx = {};
  for (let k = days - 1; k >= 0; k--) {
    const d = new Date(end.getTime() - k * 864e5).toISOString().slice(0, 10);
    idx[d] = out.length; out.push({ day: d, gross: 0, refunds: 0, net: 0 });
  }
  for (const p of payments || []) {
    if (!PAIDISH.includes(p.status)) continue;
    const g = idx[dayOf(p.paid_at || p.created_at)];
    if (g !== undefined) out[g].gross += Number(p.amount_usd) || 0;
    if (p.status === 'refunded') { const r = idx[dayOf(p.refunded_at || p.paid_at || p.created_at)]; if (r !== undefined) out[r].refunds += Number(p.amount_usd) || 0; }
  }
  for (const d of out) { d.gross = r2(d.gross); d.refunds = r2(d.refunds); d.net = r2(d.gross - d.refunds); }
  return out;
}

function mrr(users, pricing, nowIso = new Date().toISOString()) {
  let m = 0, paying = 0;
  for (const u of users || []) {
    if (!u.plan_id || !u.plan_expires_at || u.plan_expires_at <= nowIso) continue;
    const pl = (pricing?.plans || []).find((x) => x.id === u.plan_id);
    if (!pl) continue;
    paying++;
    m += u.plan_period === 'year' ? (Number(pl.price_year) || pl.price_month * 10) / 12 : Number(pl.price_month);
  }
  return { mrr: r2(m), paying, arpu: paying ? r2(m / paying) : 0 };
}

// Escape one CSV cell. Cells that start with = + - @ (or tab/CR) get a leading quote so spreadsheets never run them as formulas.
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

module.exports = { r2, listPrice, facts, summarize, timeline, daily, mrr, csvCell, csv, PAIDISH };
