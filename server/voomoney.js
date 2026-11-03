// Money events for VooSquare that need more than one row: stable event ids, credit-pack usage, refunds and chargebacks.
// Contract: VooSquare docs/INTEGRATION.md §2–2c and docs/VOO_CONNECT.md ("Vooads" section).
//
//  Event ids   Built from payments.event_key, a random id stored on the payment (never a database row number). Payments
//              paid before this existed keep event_key = their old row id, so events already sent keep their ids.
//  Plans       spend + plan_started/plan_renewed when paid (commissionable). Plan credits never produce a usage spend.
//  Packs       wallet_topup when bought (NOT commissionable). Each pack is a "lot" with a USD value per credit; when its
//              credits are used, the value is added to that customer's day, and ONE spend per customer per day
//              (event id va_use_<date>_<voo_id>) is sent once the day is over. Used credits are the only commission on a
//              pack, so a pack can never earn twice, and the sum of its spends can never exceed what was paid for it.
//              Free credits (trial, staff grants, plan credits) are never reported.
//  Refund      refund event (never reverses commission): a plan points at its spend; a pack has no spend of its own, so its
//              refund is sent without original_event_id (contract: "a refund of unused credits ... leaves it out").
//  Chargeback  reverses commission: a plan → one chargeback on its spend; a pack → one chargeback per daily usage spend
//              that used its credits (for the amount of that pack in that spend), and its usage not yet sent is cancelled.
const crypto = require('node:crypto');
const { get, all, run, tx } = require('./db');

try {
  const cols = all('PRAGMA table_info(payments)').map((c) => c.name);
  for (const [c, d] of [['event_key', 'TEXT'], ['refund_kind', 'TEXT'], ['refund_shortfall', 'INTEGER'], ['refund_ref', 'TEXT']]) if (!cols.includes(c)) run(`ALTER TABLE payments ADD COLUMN ${c} ${d}`);
  legacyKeys();
  run('CREATE UNIQUE INDEX IF NOT EXISTS payments_event_key ON payments(event_key)');
  run(`CREATE TABLE IF NOT EXISTS topup_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, payment_id INTEGER NOT NULL UNIQUE, credits INTEGER NOT NULL,
    credits_left INTEGER NOT NULL, usd_per_credit REAL NOT NULL, usd_left REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  if (!all('PRAGMA table_info(topup_lots)').some((c) => c.name === 'usd_left')) run('ALTER TABLE topup_lots ADD COLUMN usd_left REAL');
  run('CREATE INDEX IF NOT EXISTS topup_lots_user ON topup_lots(user_id, credits_left)');
  run(`CREATE TABLE IF NOT EXISTS credit_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, day TEXT NOT NULL, lot_id INTEGER NOT NULL, payment_id INTEGER NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'open', event_id TEXT,
    UNIQUE(user_id, day, lot_id))`);
} catch (e) { console.error('[voomoney] migrate', e.message); }

// Already paid before stable keys existed: keep the old ids (va_pay_<id>, va_topup_<id>) for events VooSquare already has.
// Runs on boot before any new payment is touched (server/index.js requires this module first).
function legacyKeys() { run("UPDATE payments SET event_key = CAST(id AS TEXT) WHERE event_key IS NULL AND status IN ('paid','refunded')"); }
const today = () => new Date().toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

// The payment's stable key (made once, stored). Old paid rows already carry their row id (see above).
function eventKey(paymentId) {
  const p = get('SELECT id, event_key FROM payments WHERE id = ?', Number(paymentId));
  if (!p) return null;
  if (p.event_key) return p.event_key;
  const k = 'k' + crypto.randomBytes(10).toString('hex');
  run('UPDATE payments SET event_key = ? WHERE id = ? AND event_key IS NULL', k, p.id);
  return get('SELECT event_key FROM payments WHERE id = ?', p.id).event_key;
}

// ---------- Credit packs ----------
function addLot(payment) {
  const credits = Math.round(Number(payment.credits) || 0), usd = Number(payment.amount_usd) || 0;
  if (!(credits > 0) || !(usd > 0)) return null;
  run('INSERT OR IGNORE INTO topup_lots(user_id, payment_id, credits, credits_left, usd_per_credit, usd_left) VALUES(?,?,?,?,?,?)', payment.user_id, payment.id, credits, credits, r6(usd / credits), usd);
  return get('SELECT * FROM topup_lots WHERE payment_id = ?', payment.id);
}
// Called inside credits.spend (same transaction) with the top-up credits just taken. Oldest pack first.
function consume(userId, n) {
  let left = Math.round(Number(n) || 0);
  if (left <= 0) return 0;
  const day = today();
  let usd = 0;
  for (const lot of all('SELECT * FROM topup_lots WHERE user_id = ? AND credits_left > 0 ORDER BY id', userId)) {
    if (left <= 0) break;
    const c = Math.min(left, lot.credits_left);
    // The last credits of a pack take exactly what is left of its price, so a pack never reports more than was paid.
    const pool = lot.usd_left == null ? lot.credits_left * lot.usd_per_credit : lot.usd_left;
    const v = c === lot.credits_left ? r6(pool) : Math.min(r6(pool), r6(c * lot.usd_per_credit));
    run('UPDATE topup_lots SET credits_left = credits_left - ?, usd_left = MAX(0, COALESCE(usd_left, credits_left * usd_per_credit) - ?) WHERE id = ?', c, v, lot.id);
    run(`INSERT INTO credit_usage(user_id, day, lot_id, payment_id, credits, usd) VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_id, day, lot_id) DO UPDATE SET credits = credits + excluded.credits, usd = usd + excluded.usd`, userId, day, lot.id, lot.payment_id, c, v);
    usd += v; left -= c;
  }
  return r6(usd); // credits beyond the packs were free top-up credits (staff grants): never reported
}
// A failed job gives its top-up credits back: undo today's open usage, newest pack first.
function unconsume(userId, n) {
  let left = Math.round(Number(n) || 0);
  for (const u of all("SELECT u.*, l.usd_per_credit FROM credit_usage u JOIN topup_lots l ON l.id = u.lot_id WHERE u.user_id = ? AND u.day = ? AND u.state = 'open' AND u.credits > 0 ORDER BY u.lot_id DESC", userId, today())) {
    if (left <= 0) break;
    const c = Math.min(left, u.credits);
    const v = c === u.credits ? u.usd : Math.min(u.usd, r6(c * u.usd_per_credit));
    run('UPDATE credit_usage SET credits = credits - ?, usd = MAX(0, usd - ?) WHERE id = ?', c, v, u.id);
    run('UPDATE topup_lots SET credits_left = credits_left + ?, usd_left = COALESCE(usd_left, 0) + ? WHERE id = ?', c, v, u.lot_id);
    left -= c;
  }
}
// Daily job: one spend per customer per finished day (stable id, so a re-run sends the same id and VooSquare ignores it).
function flushUsage({ before = today() } = {}) {
  const voo = require('./voo');
  const k = voo.eventsOn() && voo.kit();
  const rows = all("SELECT u.user_id, u.day, SUM(u.usd) AS usd, SUM(u.credits) AS credits, us.voo_id, us.country FROM credit_usage u JOIN users us ON us.id = u.user_id WHERE u.state = 'open' AND u.day < ? GROUP BY u.user_id, u.day", before);
  let sent = 0;
  for (const r of rows) {
    if (!r.voo_id) { run("UPDATE credit_usage SET state = 'local' WHERE user_id = ? AND day = ? AND state = 'open'", r.user_id, r.day); continue; } // no Voo ID: nothing to report
    if (!k) continue; // VooSquare not set up yet: keep it for later
    const value = r2(Number(r.usd) || 0);
    if (value < 0.01) { run("UPDATE credit_usage SET state = 'tiny' WHERE user_id = ? AND day = ? AND state = 'open'", r.user_id, r.day); continue; }
    const eventId = k.events.id('use', r.day, r.voo_id);
    try {
      k.events.spend({ eventId, vooId: r.voo_id, valueUsd: value, label: `Credits used (${r.credits})`, occurredAt: new Date(r.day + 'T23:59:00Z'), country: r.country || undefined });
      run("UPDATE credit_usage SET state = 'sent', event_id = ? WHERE user_id = ? AND day = ? AND state = 'open'", eventId, r.user_id, r.day);
      sent++;
    } catch (e) { console.warn('[voosquare] usage spend', e.message); }
  }
  return sent;
}

// ---------- Refunds and chargebacks ----------
// Staff refund (Admin → Payments) or a provider's chargeback. Marks the payment refunded once, ends the plan it paid for
// or takes back the pack's unused credits (never below zero; what was already used is recorded as the shortfall), and
// reports refund / chargeback to VooSquare. Returns {ok, removed, shortfall} or {ok:false, reason}.
function reverse(paymentId, { kind = 'refund', staffId = null, ref = null } = {}) {
  const credits = require('./credits');
  const { now } = require('./lib/util');
  const out = tx(() => {
    const p = get('SELECT * FROM payments WHERE id = ?', Number(paymentId));
    if (!p) return { ok: false, reason: 'not found' };
    if (p.status !== 'paid') return { ok: false, reason: p.status === 'refunded' ? 'already refunded' : 'not paid' };
    // The plan payment that pays for the current period (the newest paid one) ends the plan; an older period is over.
    const latest = p.kind === 'plan' ? get("SELECT id FROM payments WHERE user_id = ? AND kind = 'plan' AND status = 'paid' ORDER BY COALESCE(paid_at, created_at) DESC, id DESC LIMIT 1", p.user_id) : null;
    const funding = !!latest && latest.id === p.id;
    if (!run("UPDATE payments SET status = 'refunded', refunded_at = ?, refunded_by = ?, refund_kind = ?, refund_ref = ? WHERE id = ? AND status = 'paid'", now(), staffId, kind, ref ? String(ref).slice(0, 120) : null, p.id).changes) return { ok: false, reason: 'already refunded' };
    const u = get('SELECT * FROM users WHERE id = ?', p.user_id);
    let removed = 0, shortfall = 0, planEnded = false;
    if (p.kind === 'plan') {
      const active = u.plan_id && u.plan_expires_at > now();
      if (active && funding) {
        removed = Math.min(Math.max(0, u.plan_credits), Number(p.credits) || 0);
        shortfall = Math.max(0, (Number(p.credits) || 0) - removed);
        run('UPDATE users SET plan_credits = 0, plan_expires_at = ?, auto_renew = 0 WHERE id = ?', now(), u.id);
        if (u.plan_credits > 0) run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref, staff_id) VALUES(?,?,?,?,?,?)', u.id, -u.plan_credits, 'plan', `Plan ended: payment ${kind === 'chargeback' ? 'charged back' : 'refunded'}`, 'pay:' + p.id, staffId);
        planEnded = true;
      } else shortfall = Number(p.credits) || 0; // that period's credits were already used or expired
    } else {
      const lot = get('SELECT * FROM topup_lots WHERE payment_id = ?', p.id);
      const unused = lot ? lot.credits_left : Number(p.credits) || 0;
      removed = Math.min(unused, Math.max(0, u.topup_credits));
      shortfall = Math.max(0, (Number(p.credits) || 0) - removed);
      if (removed > 0) {
        run('UPDATE users SET topup_credits = topup_credits - ? WHERE id = ?', removed, u.id);
        run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref, staff_id) VALUES(?,?,?,?,?,?)', u.id, -removed, 'topup', `Credit pack ${kind === 'chargeback' ? 'charged back' : 'refunded'}`, 'pay:' + p.id, staffId);
      }
      if (lot) run('UPDATE topup_lots SET credits_left = 0, usd_left = 0 WHERE id = ?', lot.id);
      // A chargeback means the money is gone: usage of this pack not reported yet is never reported.
      if (lot && kind === 'chargeback') run("UPDATE credit_usage SET state = 'cancelled' WHERE lot_id = ? AND state = 'open'", lot.id);
    }
    run('UPDATE payments SET refund_shortfall = ? WHERE id = ?', shortfall, p.id);
    return { ok: true, payment: p, user: u, removed, shortfall, planEnded };
  });
  if (out.ok) report(out.payment, out.user, kind);
  return out;
}
function report(p, u, kind) {
  const voo = require('./voo');
  const k = voo.eventsOn() && voo.kit();
  if (!k || !u || !u.voo_id) return 0;
  const key = eventKey(p.id);
  const value = r2(Number(p.amount_usd) || 0);
  let n = 0;
  try {
    if (p.kind === 'plan') {
      const orig = k.events.id('pay', key);
      if (kind === 'chargeback') k.events.chargeback({ eventId: k.events.id('cb', key), vooId: u.voo_id, valueUsd: value, originalEventId: orig, plan: p.plan_id || undefined, label: 'Plan payment charged back' });
      else k.events.refund({ eventId: k.events.id('rf', key), vooId: u.voo_id, valueUsd: value, originalEventId: orig, plan: p.plan_id || undefined, label: 'Plan payment refunded' });
      n = 1;
    } else if (kind === 'chargeback') {
      // One chargeback per daily usage spend that used this pack (that is where its commission came from).
      for (const s of all("SELECT event_id, day, SUM(usd) AS usd FROM credit_usage WHERE payment_id = ? AND state = 'sent' AND event_id IS NOT NULL GROUP BY event_id, day", p.id)) {
        const v = r2(Number(s.usd) || 0);
        if (v < 0.01) continue;
        k.events.chargeback({ eventId: k.events.id('cb', key, s.day), vooId: u.voo_id, valueUsd: v, originalEventId: s.event_id, label: 'Credit pack charged back' });
        n++;
      }
    } else if (value >= 0.01) {
      k.events.refund({ eventId: k.events.id('rf', key), vooId: u.voo_id, valueUsd: value, label: 'Credit pack refunded' });
      n = 1;
    }
  } catch (e) { console.warn('[voosquare] ' + kind + ' event', e.message); }
  return n;
}

module.exports = { legacyKeys, eventKey, addLot, consume, unconsume, flushUsage, reverse, report };
