// Admin → Profit: money in vs money out, per day and per job type.
//   revenue        payments marked paid that day (USD), minus refunds marked that day
//   payment fees   each paid payment × the fee of the method that took it (guard.feeFor: method config, else pricing.payment_fees)
//   provider cost  what each job's finished steps really cost (jobs.js meter: token usage for text, the list price of the
//                  provider row that ran each render), failed and refunded jobs included; old jobs without a meter fall back
//                  to the cost the guard priced them at
//   free AI        LLM calls nobody paid a job for (chat-edit planning, admin tests), from the AI bill (llmbill.js)
// Per job type: credits charged × the real net revenue per credit in the period (after fees; the worst-case credit price when
// nothing was sold), against the real cost. A type below the minimum margin (60% by default) is flagged.
const { all, J } = require('./db');
const guard = require('./guard');

const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const r4 = (x) => Math.round((Number(x) || 0) * 1e4) / 1e4;
const dayOf = (s) => String(s || '').replace(' ', 'T').slice(0, 10);

function methodCfg() {
  const by = {};
  for (const m of all('SELECT id, adapter, config FROM payment_methods')) by[m.id] = { adapter: m.adapter, config: J(m.config, {}) };
  return by;
}
function paymentFee(p, methods) {
  const m = methods[p.method_id];
  const f = guard.feeFor(p.adapter || m?.adapter, m && m.adapter === p.adapter ? m.config : {});
  // The provider's own fee on what the customer really paid (base + the customer fee built into the price).
  return r4(paidOf(p) * (f.gross_pct ?? f.pct) / 100 + f.fixed_usd);
}
// What the customer paid: the base price plus the method's customer fee (server/surcharge.js). Refunds return all of it.
const paidOf = (p) => Number(p.charged_usd) > 0 ? Number(p.charged_usd) : Number(p.amount_usd) || 0;
function jobCost(j) {
  const st = J(j.state, {});
  if (st.real_cost_usd !== undefined) return Number(st.real_cost_usd) || 0;
  return j.status === 'done' && !j.demo ? Number(st.quote?.provider_cost_usd) || 0 : 0;
}
const jobLabel = (j) => { const i = J(j.input, {}); return i.video_type || (j.type === 'tool' ? 'tool:' + (i.tool_slug || i.tool_name || '') : j.type); };

function report(q = {}) {
  const days = Math.max(1, Math.min(365, Number(q.days) || 30));
  const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const methods = methodCfg();
  const D = {};
  const row = (d) => (D[d] = D[d] || { day: d, revenue_usd: 0, customer_fees_usd: 0, refunds_usd: 0, fees_usd: 0, provider_cost_usd: 0, free_ai_usd: 0, jobs: 0, credits_sold: 0 });
  for (let k = 0; k < days; k++) row(new Date(Date.now() - (days - 1 - k) * 864e5).toISOString().slice(0, 10));

  let creditsSold = 0, netForCredits = 0;
  for (const p of all("SELECT * FROM payments WHERE status IN ('paid','refunded')")) {
    const pd = dayOf(p.paid_at || p.created_at);
    if (pd >= since) {
      const r = row(pd), fee = paymentFee(p, methods);
      r.revenue_usd += paidOf(p); r.customer_fees_usd += Number(p.fee_usd) || 0; r.fees_usd += fee; r.credits_sold += Number(p.credits) || 0;
      creditsSold += Number(p.credits) || 0; netForCredits += paidOf(p) - fee;
    }
    if (p.status === 'refunded' && p.refunded_at && dayOf(p.refunded_at) >= since) { row(dayOf(p.refunded_at)).refunds_usd += paidOf(p); netForCredits -= paidOf(p); }
  }
  const usdPerCredit = creditsSold > 0 ? Math.max(0, netForCredits / creditsSold) : guard.worstCaseUsdPerCredit();

  const T = {};
  for (const j of all("SELECT id, type, status, credits, refunded, demo, input, state, created_at FROM jobs WHERE substr(created_at,1,10) >= ?", since)) {
    const cost = jobCost(j), r = row(dayOf(j.created_at));
    r.provider_cost_usd += cost; r.jobs++;
    const k = jobLabel(j);
    const t = (T[k] = T[k] || { id: k, jobs: 0, done: 0, failed: 0, credits: 0, cost_usd: 0, refunded_cost_usd: 0 });
    t.jobs++;
    if (j.status === 'done') t.done++;
    if (j.status === 'failed') { t.failed++; t.refunded_cost_usd += cost; }
    if (!j.refunded && j.status !== 'failed') t.credits += Number(j.credits) || 0;
    t.cost_usd += cost;
  }
  for (const l of all("SELECT substr(created_at,1,10) AS d, SUM(cost_usd) AS c FROM llm_usage WHERE job_id IS NULL AND substr(created_at,1,10) >= ? GROUP BY d", since)) row(l.d).free_ai_usd += Number(l.c) || 0;

  const min = guard.minMarginPct();
  const series = Object.values(D).filter((d) => d.day >= since).sort((a, b) => (a.day < b.day ? -1 : 1)).map((d) => {
    const net = d.revenue_usd - d.refunds_usd - d.fees_usd;
    const profit = net - d.provider_cost_usd - d.free_ai_usd;
    return { ...d, revenue_usd: r2(d.revenue_usd), refunds_usd: r2(d.refunds_usd), fees_usd: r2(d.fees_usd), provider_cost_usd: r2(d.provider_cost_usd), free_ai_usd: r2(d.free_ai_usd), profit_usd: r2(profit), margin_pct: net > 0 ? Math.round((profit / net) * 1000) / 10 : null };
  });
  const names = Object.fromEntries(require('./videotypes').all().map((t) => [t.id, t.name]));
  const types = Object.values(T).map((t) => {
    const revenue = t.credits * usdPerCredit;
    const margin = revenue > 0 ? Math.round(((revenue - t.cost_usd) / revenue) * 1000) / 10 : t.cost_usd > 0 ? -100 : null;
    return { ...t, name: names[t.id] || t.id, revenue_usd: r2(revenue), cost_usd: r2(t.cost_usd), refunded_cost_usd: r2(t.refunded_cost_usd), margin_pct: margin, flag: margin !== null && margin < min && t.cost_usd > 0 };
  }).sort((a, b) => (b.flag - a.flag) || b.cost_usd - a.cost_usd);
  const sum = (k) => r2(series.reduce((x, d) => x + d[k], 0));
  const totals = { revenue_usd: sum('revenue_usd'), refunds_usd: sum('refunds_usd'), customer_fees_usd: sum('customer_fees_usd'), fees_usd: sum('fees_usd'), provider_cost_usd: sum('provider_cost_usd'), free_ai_usd: sum('free_ai_usd'), profit_usd: sum('profit_usd') };
  const net = totals.revenue_usd - totals.refunds_usd - totals.fees_usd;
  totals.margin_pct = net > 0 ? Math.round((totals.profit_usd / net) * 1000) / 10 : null;
  return { days, since, min_margin_pct: min, usd_per_credit: r4(usdPerCredit), usd_per_credit_source: creditsSold > 0 ? 'sales in this period after fees' : 'worst-case credit price (no sales in this period)', payment_fee_worst: guard.worstFee(), totals, series, types, flagged: types.filter((t) => t.flag).map((t) => t.id), llm: require('./llmbill').summary(days), alerts: require('./llmbill').alerts(20) };
}

module.exports = { report, paymentFee, jobCost };
