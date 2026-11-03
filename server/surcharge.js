// Customer fee per payment method ("Customer fee %", config.customer_fee_pct). Customers never see a fee line: every price
// shown for a method already includes it (Bachs is simply 4% dearer; Gatevoo shows the base price and "save 4%"). The credits
// are always the base price; the split is stored on the payment for admin (amount_usd = base, fee_usd, fee_pct,
// charged_usd = base + fee = what the customer paid, and what a refund returns). Commission, Voo spend events and revenue use the base price (payments.amount_usd), never the fee.
// Defaults: Bachs 4% (a third-party platform with its own fees), Gatevoo 0%, every other method 0% (admin-editable).
const { all, run } = require('./db');

const DEFAULTS = { bachs: 4, gatevoo: 0 };
const defaultFor = (adapter) => (DEFAULTS[adapter] !== undefined ? DEFAULTS[adapter] : 0);

try {
  const cols = all('PRAGMA table_info(payments)').map((c) => c.name);
  if (!cols.includes('fee_usd')) run('ALTER TABLE payments ADD COLUMN fee_usd REAL NOT NULL DEFAULT 0');
  if (!cols.includes('fee_pct')) run('ALTER TABLE payments ADD COLUMN fee_pct REAL NOT NULL DEFAULT 0');
  if (!cols.includes('charged_usd')) run('ALTER TABLE payments ADD COLUMN charged_usd REAL');
} catch (e) { console.error('[surcharge] migrate', e.message); }

function pct(method) {
  const v = method && method.config ? method.config.customer_fee_pct : undefined;
  const n = v === undefined || v === null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : defaultFor(method && method.adapter);
}
const r2 = (n) => Math.round(n * 100) / 100;
function quote(method, baseUsd) {
  const p = pct(method), fee = r2(baseUsd * p / 100);
  return { base_usd: r2(baseUsd), fee_pct: p, fee_usd: fee, total_usd: r2(baseUsd + fee) };
}

// Fill the field once for methods that do not have it yet. A value the owner set is never changed.
function fill() {
  let n = 0;
  for (const m of all('SELECT id, adapter, config FROM payment_methods')) {
    let c = {}; try { c = JSON.parse(m.config || '{}') || {}; } catch {}
    if (c.customer_fee_pct === undefined || c.customer_fee_pct === null || c.customer_fee_pct === '') {
      c.customer_fee_pct = defaultFor(m.adapter);
      run('UPDATE payment_methods SET config = ? WHERE id = ?', JSON.stringify(c), m.id);
      n++;
    }
  }
  return n;
}
// Price multiplier for a method, and the saving a cheaper method gives against the dearest one shown (for "save 4%").
const factor = (method) => 1 + pct(method) / 100;
function savePct(method, methods) {
  const top = Math.max(...methods.map(pct), 0);
  const d = top - pct(method);
  return d > 0 ? Math.round(d * 10) / 10 : 0; // the fee difference in points, e.g. Bachs 4% vs Gatevoo 0% = "save 4%"
}

module.exports = { DEFAULTS, defaultFor, pct, quote, fill, factor, savePct };
