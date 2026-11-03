// One-time data updates on boot, so Ade has nothing to change by hand after a deploy.
//
// 1. price_floor_2026_11: payment fees are now counted by the profit guard, so some prices the owner saved in Admin →
//    Pricing can sit under the 60% floor (Brand music 120s at 110 is the known one). Every saved price that is below the
//    guard's minimum is raised to the price in content/pricing.json, or to the guard's minimum when that is higher. A price
//    at or above the minimum is never touched, so a price the owner set higher always stays. Each change is logged
//    (audit log + an admin alert) with the old and new value.
// 2. payment fees: every payment method gets Fee % and Fixed fee pre-filled from pricing.payment_fees (only where
//    they are empty), so the guard's fee buffer works with zero admin steps. Admin can still edit them.
// The price floor runs once (setting "data_updates" remembers it); the fee pre-fill only ever fills empty fields.
const { get, all, run, J } = require('./db');
const { getSetting, setSetting, DEFAULTS } = require('./settings');

function done(key) { return !!(getSetting('data_updates') || {})[key]; }
function mark(key, info) { const d = { ...(getSetting('data_updates') || {}) }; d[key] = { at: new Date().toISOString(), ...info }; setSetting('data_updates', d); }
function log(action, detail) {
  try { run("INSERT INTO audit_log(staff_id, action, target, detail) VALUES(NULL, ?, 'pricing', ?)", action, JSON.stringify(detail)); } catch (e) { console.warn('[pricefloor] audit', e.message); }
  console.log('[data update]', action, JSON.stringify(detail));
}

// Changes needed so every saved price clears the guard. Pure apart from reading the current pricing and provider rows.
function plan(saved) {
  const guard = require('./guard'), credits = require('./credits'), levels = require('./levels'), videotypes = require('./videotypes');
  const file = DEFAULTS.pricing;
  const changes = [];
  const fileType = (id) => (file.video_types || []).find((t) => t && t.id === id) || null;
  const raise = (where, from, safe, fileVal) => { const to = Math.max(Math.ceil(safe), Number(fileVal) > from ? Number(fileVal) : 0); if (to > from) changes.push({ where, from, to }); return to > from ? to : from; };
  for (const t of saved.video_types || []) {
    if (!t || !t.id) continue;
    const vt = videotypes.all().find((x) => x.id === t.id);
    if (!vt) continue;
    const ft = fileType(t.id);
    // Levels: the lowest safe credits per unit on the level's own models.
    for (const lv of Array.isArray(t.levels) ? t.levels : []) {
      const nl = levels.list(vt).find((x) => x.id === lv.id);
      if (!nl) continue;
      const safe = guard.safeLevelPrice(vt, nl);
      const fl = ft && Array.isArray(ft.levels) ? ft.levels.find((x) => x.id === lv.id) : null;
      const to = raise(`${t.id} · ${lv.id} level (credits per ${vt.unit})`, Number(lv.credits_per_unit), safe, fl && fl.credits_per_unit);
      lv.credits_per_unit = to;
    }
    // Brand music: one price per track length.
    if (t.price_by_seconds && typeof t.price_by_seconds === 'object') {
      for (const k of Object.keys(t.price_by_seconds)) {
        const q = credits.baseQuote('video_type', { video_type: t.id, duration: Number(k) }, null);
        const e = guard.evaluate(Number(t.price_by_seconds[k]), guard.providerCost(q, { video_type: t.id, duration: Number(k) }));
        t.price_by_seconds[k] = raise(`${t.id} · ${k}s track`, Number(t.price_by_seconds[k]), e.ok ? 0 : e.safeCredits, ft && ft.price_by_seconds && ft.price_by_seconds[k]);
      }
      continue;
    }
    // Types without levels: the sample job must clear the floor at the type's own price.
    if (!levels.hasLevels(vt)) {
      const input = guard.sampleInput(vt);
      const q = credits.baseQuote('video_type', input, null);
      const e = guard.evaluate(q.credits, guard.providerCost(q, input));
      if (!e.ok && q.credits > 0) {
        const per = Math.ceil(Number(t.credits_per_unit) * (e.safeCredits / q.credits));
        t.credits_per_unit = raise(`${t.id} (credits per ${vt.unit})`, Number(t.credits_per_unit), per, ft && ft.credits_per_unit);
      }
    }
  }
  // Fixed-price actions.
  const c = saved.costs || {};
  for (const [key, type, input] of [['hook_pack_20', 'hooks', {}], ['script', 'script', {}], ['angles', 'angles', {}], ['image_3_sizes', 'image', { count: 1 }], ['actor_faces', 'actor', {}]]) {
    if (c[key] === undefined) continue;
    const q = credits.baseQuote(type, input, null);
    const e = guard.evaluate(Number(c[key]), guard.providerCost(q, input));
    if (!e.ok) c[key] = raise(`${key} (credits)`, Number(c[key]), e.safeCredits, (file.costs || {})[key]);
  }
  return changes;
}

function priceFloor() {
  const key = 'price_floor_2026_11';
  if (done(key)) return { skipped: true };
  const row = get("SELECT value FROM settings WHERE key = 'pricing'");
  if (!row) { mark(key, { changes: 0, note: 'no saved pricing: the file prices are used' }); return { changes: [] }; }
  const saved = getSetting('pricing');
  const next = JSON.parse(JSON.stringify(saved));
  const changes = plan(next);
  if (changes.length) {
    setSetting('pricing', next);
    log('pricing.floor_raise', { reason: 'Payment fees are now counted by the profit guard; saved prices under the 60% floor were raised.', changes });
    try { require('./llmbill').alert('price_floor', `On update, ${changes.length} saved price${changes.length > 1 ? 's were' : ' was'} under the 60% margin floor and raised: ${changes.map((x) => `${x.where} ${x.from} → ${x.to}`).join('; ')}. Prices you set higher were not changed.`, 'warn', 'once'); } catch {}
  }
  mark(key, { changes: changes.length });
  return { changes };
}

function paymentFees() {
  // Runs on every boot but only fills empty fields, so a fee Ade edited is never overwritten.
  const guard = require('./guard');
  let n = 0;
  for (const m of all('SELECT id, adapter, config FROM payment_methods')) {
    const cfg = J(m.config, {});
    if ((cfg.fee_pct !== undefined && cfg.fee_pct !== '') || (cfg.fee_fixed_usd !== undefined && cfg.fee_fixed_usd !== '')) continue;
    const f = guard.feeFor(m.adapter, {});
    run('UPDATE payment_methods SET config = ? WHERE id = ?', JSON.stringify({ ...cfg, fee_pct: f.pct, fee_fixed_usd: f.fixed_usd }), m.id);
    n++;
  }
  if (n) log('payment_methods.fees_prefilled', { methods: n });
  return { methods: n };
}

function runAll() {
  const out = {};
  try { out.price_floor = priceFloor(); } catch (e) { console.error('[data update] price floor', e.message); }
  try { out.payment_fees = paymentFees(); } catch (e) { console.error('[data update] payment fees', e.message); }
  try { out.customer_fees = require('./surcharge').fill(); } catch (e) { console.error('[data update] customer fees', e.message); } // empty fields only
  return out;
}

module.exports = { runAll, priceFloor, paymentFees, plan };
