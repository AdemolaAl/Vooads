// Checkout, plan activation, renewals, discount codes.
const config = require('./config');
const { get, all, run, tx, J } = require('./db');
const { now, addDays } = require('./lib/util');
const { fail } = require('./lib/http');
const { pricing, planById } = require('./settings');
const payments = require('./payments');
const email = require('./email');
const voosquare = require('./voosquare');

function priceFor({ kind, plan_id, period, topup_id }) {
  const p = pricing();
  if (kind === 'plan') {
    const plan = planById(plan_id);
    if (!plan) fail(400, 'Pick a plan.');
    const yearly = period === 'year';
    return { amount: yearly ? plan.price_year : plan.price_month, credits: plan.credits_month, label: `Vooads ${plan.name} (${yearly ? 'yearly' : 'monthly'})`, plan, period: yearly ? 'year' : 'month' };
  }
  const t = p.topups.find((x) => x.id === topup_id);
  if (!t) fail(400, 'Pick a top-up pack.');
  return { amount: t.price, credits: t.credits, label: `${t.credits.toLocaleString('en-US')} Vooads credits`, topup: t };
}

function checkDiscount(code, user, kind) {
  if (!code) return null;
  const d = get('SELECT * FROM discounts WHERE code = ? AND active = 1', String(code).trim().toUpperCase());
  if (!d) fail(400, 'That discount code is not valid.');
  if (d.expires_at && d.expires_at < now()) fail(400, 'That discount code has expired.');
  if (d.max_uses && d.uses >= d.max_uses) fail(400, 'That discount code has been used.');
  if (d.user_id && d.user_id !== user.id) fail(400, 'That discount code belongs to another account.');
  if (kind !== 'plan') fail(400, 'Discount codes work on plans, not top-ups.');
  if (d.applies_to === 'first_month' && get("SELECT 1 FROM payments WHERE user_id = ? AND kind = 'plan' AND status = 'paid'", user.id)) fail(400, 'That code is for your first plan payment only.');
  return d;
}

async function startCheckout(user, body) {
  const kind = body.kind === 'topup' ? 'topup' : 'plan';
  const q = priceFor({ kind, plan_id: body.plan_id, period: body.period, topup_id: body.topup_id });
  if (kind === 'topup' && !get("SELECT 1 FROM payments WHERE user_id = ? AND kind = 'plan' AND status = 'paid'", user.id) && !(user.plan_id && user.plan_expires_at > now()))
    fail(400, 'Top-ups are for paid plans. Pick a plan first.');
  const method = payments.byId(body.method_id);
  if (!method || (method.id && !method.enabled)) fail(400, 'Pick a payment method.');
  if (method.id && !payments.forCountry(user.country).some((m) => m.id === method.id)) fail(400, 'That payment method is not available in your country. Pick another one.');
  const adapter = payments.ADAPTERS[method.adapter];
  if (!adapter) fail(400, 'Pick a payment method.');
  const live = require('./staging').paymentProblem(method); // staging: never take real money
  if (live) fail(400, live);
  if (body.code && kind === 'plan' && body.period === 'year') fail(400, 'Discount codes work on monthly plans. Yearly already includes 2 months free.');
  const disc = checkDiscount(body.code, user, kind);
  let amount = q.amount;
  if (disc) amount = Math.round(amount * (100 - disc.percent)) / 100;
  // The method's customer fee is built into what the customer pays; credits, commission and Voo events use the base price.
  const fq = require('./surcharge').quote(method, amount);
  // Bachs payment cap: the final total (fee inside, naira at this checkout's rate) must fit, or nothing is started.
  if (method.adapter === 'bachs' && adapter.overCap) {
    const bq = adapter.quote(method, user.country, fq.total_usd);
    if (adapter.overCap(method, bq.amount, bq.currency)) fail(400, adapter.capMessage(method));
  }
  const info = run('INSERT INTO payments(user_id, method_id, adapter, kind, plan_id, period, topup_id, credits, amount_usd, discount_code, fee_pct, fee_usd, charged_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    user.id, method.id || null, method.adapter, kind, q.plan?.id || null, q.period || null, q.topup?.id || null, q.credits, amount, disc?.code || null, fq.fee_pct, fq.fee_usd, fq.total_usd);
  const payment = get('SELECT * FROM payments WHERE id = ?', Number(info.lastInsertRowid));
  // Recurring billing only on Stripe, and only without a one-off discount (the discount applies to the first charge).
  const recurring = kind === 'plan' && adapter.recurring && !disc ? q.period : null;
  let res;
  // Bachs card auto-renew: a monthly or yearly plan with "Renew automatically" on (the default) starts a Bachs subscription
  // checkout (cards only). When Bachs cannot do it right now (flag off, no subscription access, product not set up) it
  // quietly becomes the normal one-off Bachs payment below. Discount codes stay one-off (they apply to one charge).
  if (kind === 'plan' && adapter.subscriptions && body.auto_renew !== false && !disc) {
    const subs = require('./payments/bachs-subs');
    if (subs.enabled(method)) {
      try {
        res = await subs.checkout(method, { payment, user, plan: q.plan, period: q.period,
          successUrl: `${config.appUrl}/app?paid=${payment.id}#wallet`, cancelUrl: `${config.appUrl}/app?cancelled=1#wallet` });
      } catch (e) {
        if (e.customer) { run("UPDATE payments SET status = 'failed', review_note = ? WHERE id = ?", ('Checkout could not start: ' + e.message).slice(0, 300), payment.id); fail(e.status || 409, e.message); }
        console.warn('[checkout] bachs auto-renew unavailable, one-off instead:', e.message);
        res = null;
      }
    }
  }
  try {
    if (!res) res = await adapter.checkout(method, {
      payment, user, amountUsd: fq.total_usd, description: q.label, recurring,
      successUrl: `${config.appUrl}/app?paid=${payment.id}#wallet`, cancelUrl: `${config.appUrl}/app?cancelled=1#wallet`,
    });
    if (!res || typeof res.url !== 'string' || !res.url) throw new Error('no checkout link returned');
  } catch (e) {
    // Provider down, wrong key, or an answer that is not JSON: never show the raw error (or a 500) to the customer.
    // The payment is marked failed with the reason, so staff can see it in Admin → Payments.
    console.error('[checkout]', method.adapter, 'payment', payment.id, e.message);
    run("UPDATE payments SET status = 'failed', review_note = ? WHERE id = ?", ('Checkout could not start: ' + e.message).slice(0, 300), payment.id);
    if (e.customer) fail(e.status || 409, e.message); // a message written for customers (e.g. naira paused while the rate is updated)
    fail(502, `${method.name || 'This payment method'} is not available right now. Try again in a minute or pick another payment method.`);
  }
  run('UPDATE payments SET provider_ref = ? WHERE id = ?', res.ref || null, payment.id);
  return { url: res.url, payment_id: payment.id, auto_renew: !!(res.recurring || recurring) };
}

function activatePlan(userId, plan, period, extra = {}) {
  const u = get('SELECT * FROM users WHERE id = ?', userId);
  const samePlanActive = u.plan_id === plan.id && u.plan_expires_at > now();
  const base = samePlanActive ? u.plan_expires_at : now();
  const expires = addDays(base, period === 'year' ? 365 : 30);
  // Paying again for the plan you already have (early renewal): keep this period's credits and add the paid time.
  // The next monthly refresh (daily job) gives the new period's credits, so nothing already paid for is lost.
  if (samePlanActive && u.plan_credits_reset_at && u.plan_credits_reset_at > now()) {
    run('UPDATE users SET plan_period = ?, plan_expires_at = ?, auto_renew = ?, stripe_sub = COALESCE(?, stripe_sub), stripe_customer = COALESCE(?, stripe_customer) WHERE id = ?',
      period, expires, extra.autoRenew ? 1 : 0, extra.subscription || null, extra.customer || null, userId);
    return;
  }
  // Switching plans: unused credits of the old plan are replaced by the new plan's credits. Record it so the ledger matches the balance.
  const oldLeft = u.plan_id && u.plan_expires_at > now() ? u.plan_credits : 0;
  if (oldLeft > 0) run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref) VALUES(?,?,?,?,?)', userId, -oldLeft, 'plan', 'Unused plan credits replaced by the new plan', extra.ref || null);
  run(`UPDATE users SET plan_id = ?, plan_period = ?, plan_expires_at = ?, plan_credits = ?, plan_credits_reset_at = ?,
       auto_renew = ?, stripe_sub = COALESCE(?, stripe_sub), stripe_customer = COALESCE(?, stripe_customer) WHERE id = ?`,
    plan.id, period, expires, plan.credits_month, addDays(now(), 30), extra.autoRenew ? 1 : 0, extra.subscription || null, extra.customer || null, userId);
  run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref) VALUES(?,?,?,?,?)', userId, plan.credits_month, 'plan', `${plan.name} plan credits`, extra.ref || null);
}

// Statuses a payment can be marked paid from ('review' = a bank transfer with proof waiting for staff).
const PAYABLE = ['pending', 'failed', 'review'];
// Called by webhooks (and the dev test flow). Safe to call twice.
function markPaid(paymentId, extra = {}) {
  const done = tx(() => {
    const p = get('SELECT * FROM payments WHERE id = ?', paymentId);
    if (!p) return null;
    // Only a pending or failed payment can become paid. Paid stays paid; a refunded payment is never credited again, even by
    // a later, correctly signed provider event (security audit, Phase 2).
    if (!PAYABLE.includes(p.status)) return null;
    const ref = extra.ref && !get('SELECT 1 FROM payments WHERE provider_ref = ? AND id != ?', extra.ref, p.id) ? extra.ref : null; // provider_ref is unique
    const flipped = run("UPDATE payments SET status = 'paid', paid_at = ?, raw = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ? AND status IN ('pending','failed','review')", now(), JSON.stringify(extra.raw || {}), ref, p.id).changes;
    if (!flipped) return null;
    require('./voomoney').eventKey(p.id); // stable random id for VooSquare events, made the moment it is paid
    if (p.discount_code) run('UPDATE discounts SET uses = uses + 1 WHERE code = ?', p.discount_code);
    if (p.kind === 'plan') {
      const plan = planById(p.plan_id);
      if (plan) activatePlan(p.user_id, plan, p.period, { autoRenew: !!extra.subscription || !!extra.autoRenew, subscription: extra.subscription, customer: extra.customer, ref: 'pay:' + p.id });
    } else {
      require('./voomoney').addLot(p); // the pack's USD value per credit, for usage spends to VooSquare
      run('UPDATE users SET topup_credits = topup_credits + ? WHERE id = ?', p.credits, p.user_id);
      run('INSERT INTO credit_ledger(user_id, delta, bucket, reason, ref) VALUES(?,?,?,?,?)', p.user_id, p.credits, 'topup', 'Top-up', 'pay:' + p.id);
    }
    return p;
  });
  if (!done) return;
  const user = get('SELECT * FROM users WHERE id = ?', done.user_id);
  const plan = done.plan_id ? planById(done.plan_id) : null;
  // The receipt shows what the customer paid (the price for their method), with no separate fee line.
  const paidLocal = done.currency === 'NGN' && Number(done.amount_local) > 0 ? '₦' + Number(done.amount_local).toLocaleString('en-US', { maximumFractionDigits: 2 }) : null;
  const vars = { amount: paidLocal || '$' + Number(done.charged_usd || done.amount_usd).toFixed(2), plan: plan?.name || '', credits: done.credits.toLocaleString('en-US'), code: 'VA-' + done.id };
  email.queue(done.kind === 'plan' ? 'payment_receipt' : 'topup_receipt', user.email, { ...vars, period: done.kind === 'plan' ? (done.period === 'year' ? 'yearly' : 'monthly') : '' }, { userId: user.id });
  const renewedPlan = done.kind === 'plan' && !!get("SELECT 1 FROM payments WHERE user_id = ? AND kind = 'plan' AND plan_id = ? AND status = 'paid' AND id != ?", done.user_id, done.plan_id, done.id);
  if (renewedPlan) email.queue('plan_renewed', user.email, vars, { userId: user.id });
  else if (done.kind === 'plan' && plan?.scripts) email.queue('plan_upgraded', user.email, vars, { userId: user.id });
  try { email.hooks.referral(user, done); } catch (e) { console.warn('[email] referral', e.message); } // commission on the base price
  // VooSquare (Voo Connect): spend + plan_started, or wallet_topup, with ids from the payment id (repeats are ignored).
  require('./voo').reportPayment(user, { ...done, provider_ref: (get('SELECT provider_ref FROM payments WHERE id = ?', done.id) || {}).provider_ref || done.provider_ref, paid_at: new Date().toISOString() }, { planName: plan?.name || '', renewed: done.kind === 'plan' && !!get("SELECT 1 FROM payments WHERE user_id = ? AND kind = 'plan' AND plan_id = ? AND status = 'paid' AND id != ?", done.user_id, done.plan_id, done.id) });
  voosquare.event(user, 'spend', `Paid $${Number(done.amount_usd).toFixed(2)}`, done.amount_usd); // base price, never the fee
  if (done.kind === 'plan') voosquare.event(user, 'plan_started', plan?.name || 'Plan');
}

function renewStripe(subscription, ref, amountUsd) {
  const u = get('SELECT * FROM users WHERE stripe_sub = ?', subscription);
  if (!u) return;
  const plan = planById(u.plan_id);
  if (!plan) return;
  const exists = get('SELECT 1 FROM payments WHERE provider_ref = ?', ref);
  if (exists) return;
  const ins = run("INSERT INTO payments(user_id, adapter, kind, plan_id, period, credits, amount_usd, provider_ref, status, paid_at) VALUES(?, 'stripe', 'plan', ?, ?, ?, ?, ?, 'paid', ?)", u.id, plan.id, u.plan_period, plan.credits_month, amountUsd, ref, now());
  require('./voo').reportPayment(u, { id: Number(ins.lastInsertRowid), kind: 'plan', plan_id: plan.id, amount_usd: amountUsd, credits: plan.credits_month }, { renewed: true, planName: plan.name });
  activatePlan(u.id, plan, u.plan_period, { autoRenew: true, subscription, ref });
  email.queue('payment_receipt', u.email, { amount: '$' + Number(amountUsd).toFixed(2), plan: plan.name, credits: plan.credits_month.toLocaleString('en-US'), code: ref, period: u.plan_period === 'year' ? 'yearly' : 'monthly' }, { userId: u.id });
  email.queue('plan_renewed', u.email, { plan: plan.name, credits: plan.credits_month.toLocaleString('en-US') }, { userId: u.id });
  try { email.hooks.referral(u, { amount_usd: amountUsd }); } catch (e) { console.warn('[email] referral', e.message); }
  voosquare.event(u, 'spend', `Renewed ${plan.name}`, amountUsd);
}

// Daily housekeeping: monthly credit refresh for yearly plans, renewal reminders, expiry.
function daily() {
  const t = now();
  try { require('./voomoney').flushUsage(); } catch (e) { console.error('[voosquare usage]', e.message); }
  try { require('./watchdog').run(); } catch (e) { console.error('[watchdog]', e.message); }
  // Refresh only when at least half a credit period is left, so a 365-day plan gets 12 refreshes, not 13.
  for (const u of all("SELECT * FROM users WHERE plan_id IS NOT NULL AND plan_expires_at > ? AND plan_credits_reset_at <= ?", addDays(t, 15), t)) {
    const plan = planById(u.plan_id);
    if (!plan) continue;
    run('UPDATE users SET plan_credits = ?, plan_credits_reset_at = ? WHERE id = ?', plan.credits_month, addDays(t, 30), u.id);
    run('INSERT INTO credit_ledger(user_id, delta, bucket, reason) VALUES(?,?,?,?)', u.id, plan.credits_month, 'plan', 'Monthly credits refresh');
  }
  for (const u of all("SELECT * FROM users WHERE plan_id IS NOT NULL AND auto_renew = 0 AND plan_expires_at BETWEEN ? AND ?", addDays(t, 2.5), addDays(t, 3.5))) {
    const f = J(u.flags, {});
    const key = 'reminded_' + u.plan_expires_at.slice(0, 10);
    if (f[key]) continue;
    f[key] = 1;
    run('UPDATE users SET flags = ? WHERE id = ?', JSON.stringify(f), u.id);
    email.queue('renewal_reminder', u.email, { plan: planById(u.plan_id)?.name || 'plan', credits: Number(u.plan_credits || 0).toLocaleString('en-US') }, { userId: u.id });
  }
  for (const u of all("SELECT * FROM users WHERE status = 'active' AND last_seen_at BETWEEN ? AND ?", addDays(t, -15), addDays(t, -14))) {
    const f = J(u.flags, {});
    if (f.winback) continue;
    f.winback = 1;
    run('UPDATE users SET flags = ? WHERE id = ?', JSON.stringify(f), u.id);
    email.queue('winback_day14', u.email, {}, { userId: u.id });
  }
  // Bachs card auto-renew: reminders 3 days (and 7 days for yearly) before each charge, price follows FX, end of grace.
  try { require('./payments/bachs-subs').daily(t).catch((e) => console.error('[bachs-subs daily]', e.message)); } catch (e) { console.error('[bachs-subs daily]', e.message); }
  // Plan renews soon (auto-renew), plan ended, and the Monday weekly digest (server/email).
  try { email.hooks.daily(); } catch (e) { console.error('[email daily]', e.message); }
}

module.exports = { priceFor, startCheckout, markPaid, renewStripe, activatePlan, daily, checkDiscount };
