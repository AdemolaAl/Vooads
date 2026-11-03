/* Vooads admin: Money → Profit (revenue vs provider costs vs payment fees per day, job types below the minimum margin,
   the AI text bill with its allowance, fee, limits and daily cap, admin alerts) and Customers → Actor consent (approve or
   reject own-face actors after watching the consent clip). Server: server/profit.js, server/llmbill.js, server/actors.js,
   routes in server/routes/phase2.js. */
(function () {
'use strict';
(window.VA_EXT = window.VA_EXT || []).push(function (A) {
const { $, $$, esc, can, GET, POST, PUT, toast, act, emptyCard, SECTIONS, VIEWS, route } = A;
const at = SECTIONS.findIndex((s) => s.id === 'showcase');
SECTIONS.splice(at < 0 ? SECTIONS.length : at, 0,
  { id: 'profit', label: 'Profit', perm: 'users.finance', group: 'Business', title: ['Profit.', 'Money in, money out.'], desc: 'Revenue against what the AI providers, payment fees and free AI steps really cost, per day and per video type.' },
  { id: 'actorreview', label: 'Actor consent', perm: 'users.view', group: 'Support', title: ['Actor consent.', 'Own faces, checked.'], desc: 'Customers who want to use their own face send a consent clip. Watch it, then approve or reject.' });

const css = document.createElement('style');
css.textContent = `
.pf-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.pf-k div{border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:#fff}
.pf-k b{display:block;font-size:22px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.pf-k span{font-size:12.5px;color:var(--mut)}
.pf-t{width:100%;border-collapse:collapse;font-size:13.5px}
.pf-t th,.pf-t td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.pf-t th:first-child,.pf-t td:first-child{text-align:left;white-space:normal}
.pf-t tr.flag td{background:#FFF4F2}
.pf-t .bad{color:#C2361B;font-weight:700}
.pf-wrap{overflow-x:auto}
.pf-bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding:6px 0;border-bottom:1px solid var(--line)}
.pf-bars i{flex:1;min-width:3px;background:#1E4DFF;border-radius:3px 3px 0 0;opacity:.85}
.pf-bars i.neg{background:#C2361B}
.pf-al{display:grid;gap:8px}
.pf-al div{border-radius:12px;padding:10px 12px;font-size:13.5px;background:#FFF8E6;border:1px solid #F3DFA8;display:flex;justify-content:space-between;gap:10px}
.pf-al div.stop{background:#FFF1EE;border-color:#F4C5BA}
.pf-al div.seen{opacity:.6}
.pf-set{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.ar-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.ar-card{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;display:grid}
.ar-card .m{display:grid;grid-template-columns:1fr 1fr;gap:2px;background:#0E1424}
.ar-card img,.ar-card video{width:100%;aspect-ratio:3/4;object-fit:cover;display:block}
.ar-card .b{padding:10px 12px;display:grid;gap:6px;font-size:13px}
`;
document.head.appendChild(css);
const usd = (n) => (Number(n) < 0 ? '-$' : '$') + Math.abs(Number(n) || 0).toFixed(2);
const pct = (n) => (n == null ? '–' : Number(n).toFixed(1) + '%');

VIEWS.profit = async (el, acts) => {
  const days = Number(sessionStorage.getItem('pfDays') || 30);
  const r = await GET('/api/admin/profit?days=' + days);
  const wd = await GET('/api/admin/watchdog').catch(() => null);
  const fx = await GET('/api/admin/fx?days=' + days).catch(() => null);
  const t = r.totals, llm = r.llm, s = llm.settings;
  acts.innerHTML = `<select class="inp sm" id="pfD">${[7, 30, 90].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`).join('')}</select>`;
  const max = Math.max(1, ...r.series.map((d) => Math.abs(d.profit_usd)));
  el.innerHTML = `<div class="stack">
    <div class="pf-k">
      <div><b>${usd(t.revenue_usd - t.refunds_usd)}</b><span>Revenue after refunds</span></div>
      <div><b>${usd(t.customer_fees_usd || 0)}</b><span>Customer fees built into prices (in revenue)</span></div>
      <div><b>${usd(t.fees_usd)}</b><span>Payment fees (worst method ${esc(r.payment_fee_worst.adapter)}: ${r.payment_fee_worst.pct}% + ${usd(r.payment_fee_worst.fixed_usd)})</span></div>
      <div><b>${usd(t.provider_cost_usd)}</b><span>AI provider cost (incl. failed jobs)</span></div>
      <div><b>${usd(t.free_ai_usd)}</b><span>Free AI steps (chat planning)</span></div>
      <div><b>${usd(t.profit_usd)}</b><span>Profit · margin ${pct(t.margin_pct)}</span></div>
    </div>
    ${r.alerts.length ? `<div class="card pad"><b>Alerts</b><div class="pf-al" style="margin-top:8px">${r.alerts.map((a) => `<div class="${a.level === 'stop' ? 'stop' : ''} ${a.seen_at ? 'seen' : ''}"><span>${esc(a.day || '')} · ${esc(a.message)}</span>${a.seen_at ? '' : `<button class="btn ghost sm" data-seen="${a.id}">Seen</button>`}</div>`).join('')}</div></div>` : ''}
    ${fx ? fxCard(fx) : ''}
    ${wd ? watchCard(wd) : ''}
    <div class="card"><div class="card-h"><b>Profit per day</b><span class="hint">Credits are valued at ${usd(r.usd_per_credit)} each (${esc(r.usd_per_credit_source)}).</span></div>
      <div class="card-b"><div class="pf-bars" aria-hidden="true">${r.series.map((d) => `<i class="${d.profit_usd < 0 ? 'neg' : ''}" style="height:${Math.max(2, Math.round(Math.abs(d.profit_usd) / max * 100))}%" title="${esc(d.day)} ${usd(d.profit_usd)}"></i>`).join('')}</div>
      <div class="pf-wrap"><table class="pf-t"><thead><tr><th>Day</th><th>Revenue</th><th>Refunds</th><th>Fees</th><th>AI providers</th><th>Free AI</th><th>Profit</th><th>Margin</th></tr></thead><tbody>
      ${r.series.slice().reverse().map((d) => `<tr><td>${esc(d.day)}</td><td>${usd(d.revenue_usd)}</td><td>${usd(d.refunds_usd)}</td><td>${usd(d.fees_usd)}</td><td>${usd(d.provider_cost_usd)}</td><td>${usd(d.free_ai_usd)}</td><td class="${d.profit_usd < 0 ? 'bad' : ''}">${usd(d.profit_usd)}</td><td>${pct(d.margin_pct)}</td></tr>`).join('')}</tbody></table></div></div></div>
    <div class="card"><div class="card-h"><b>Video types</b><span class="hint">${r.flagged.length ? r.flagged.length + ' below the ' + r.min_margin_pct + '% minimum' : 'All at or above the ' + r.min_margin_pct + '% minimum'}</span></div>
      <div class="card-b pf-wrap"><table class="pf-t"><thead><tr><th>Type</th><th>Jobs</th><th>Failed</th><th>Credits</th><th>Revenue</th><th>Real cost</th><th>Lost on failed</th><th>Margin</th></tr></thead><tbody>
      ${r.types.length ? r.types.map((x) => `<tr class="${x.flag ? 'flag' : ''}"><td>${esc(x.name)}${x.flag ? ' <span class="bad">below ' + r.min_margin_pct + '%</span>' : ''}</td><td>${x.jobs}</td><td>${x.failed}</td><td>${x.credits.toLocaleString('en-US')}</td><td>${usd(x.revenue_usd)}</td><td>${usd(x.cost_usd)}</td><td>${usd(x.refunded_cost_usd)}</td><td class="${x.flag ? 'bad' : ''}">${pct(x.margin_pct)}</td></tr>`).join('') : '<tr><td colspan="8">No jobs in this period.</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-h"><b>AI text bill</b><span class="hint">Today ${usd(llm.today_usd)} of the ${usd(llm.daily_cap_usd)} daily cap${llm.cap_reached ? ' · free AI steps paused' : ''}</span></div>
      <div class="card-b"><div class="pf-wrap"><table class="pf-t"><thead><tr><th>Feature</th><th>Calls</th><th>Free calls</th><th>Tokens in / out</th><th>Fees (credits)</th><th>Cost</th></tr></thead><tbody>
      ${llm.by_feature.length ? llm.by_feature.map((f) => `<tr><td>${esc(f.feature)}</td><td>${f.calls}</td><td>${f.free_calls}</td><td>${(f.input_tokens || 0).toLocaleString('en-US')} / ${(f.output_tokens || 0).toLocaleString('en-US')}</td><td>${f.credits || 0}</td><td>${usd(f.cost_usd)}</td></tr>`).join('') : '<tr><td colspan="6">No AI text calls yet.</td></tr>'}</tbody></table></div>
      ${llm.top_free_accounts.length ? `<p class="hint" style="margin-top:12px">Top accounts on free AI steps: ${llm.top_free_accounts.map((a) => `${esc(a.email || '#' + a.user_id)} ${usd(a.cost_usd)} (${a.calls})`).join(' · ')}</p>` : ''}
      <h4 style="margin:16px 0 8px">Settings</h4>
      <div class="pf-set">
        <div class="fld"><label>Daily cap on the AI text bill (USD)</label><input class="inp" id="pfCap" type="number" min="0" step="1" value="${s.daily_cap_usd}"></div>
        <div class="fld"><label>Alert at (% of cap)</label><input class="inp" id="pfAl" type="number" min="10" max="100" value="${s.alert_pct}"></div>
        <div class="fld"><label>Chat edit: credits per message after the free ones</label><input class="inp" id="pfFee" type="number" min="0" max="100" value="${s.chat_edit.credits_per_message}"></div>
        <div class="fld"><label>Chat edit: messages per minute</label><input class="inp" id="pfPm" type="number" min="0" value="${s.chat_edit.per_minute}"></div>
        <div class="fld"><label>Chat edit: messages per day</label><input class="inp" id="pfPd" type="number" min="0" value="${s.chat_edit.per_day}"></div>
        ${Object.keys(s.chat_edit.free_per_day).map((k) => `<div class="fld"><label>Free messages a day · ${esc(k)}</label><input class="inp" data-free="${esc(k)}" type="number" min="0" value="${s.chat_edit.free_per_day[k]}"></div>`).join('')}
      </div>
      <label class="row" style="gap:8px;margin-top:6px"><input type="checkbox" id="pfBlk" ${s.block_free_at_cap !== false ? 'checked' : ''}> Pause free AI steps when the cap is reached (paid jobs keep running)</label>
      <div class="row end" style="margin-top:12px">${can('settings.manage') ? '<button class="btn brand sm" id="pfSave">Save AI bill settings</button>' : '<span class="hint">Only staff who can change settings can edit these.</span>'}</div>
      <p class="hint">The profit guard report (Pricing → Margins) shows what one paid planner message and each plan's free allowance cost against the price.</p></div></div>
  </div>`;
  $$('[data-resume]', el).forEach((b) => { b.onclick = (ev) => act(ev.currentTarget, () => POST('/api/admin/watchdog/resume', { type: b.dataset.resume }), 'Switched back on').then(route); });
  const fc = $('#fxRun'); if (fc) fc.onclick = (ev) => act(ev.currentTarget, () => POST('/api/admin/fx/check'), 'Rate feed checked').then(route);
  $$('[data-fxok]', el).forEach((b) => { b.onclick = (ev) => { if (confirm('Use the lower naira rate from the feed?')) act(ev.currentTarget, () => POST('/api/admin/fx/approve', { method_id: Number(b.dataset.fxok) }), 'Lower rate saved').then(route); }; });
  const wr = $('#wdRun'); if (wr) wr.onclick = (ev) => act(ev.currentTarget, () => POST('/api/admin/watchdog/run'), 'Checked').then(route);
  $('#pfD').onchange = (e) => { sessionStorage.setItem('pfDays', e.target.value); route(); };
  $$('[data-seen]', el).forEach((b) => { b.onclick = async () => { await POST('/api/admin/alerts/' + b.dataset.seen + '/seen'); route(); }; });
  const save = $('#pfSave');
  if (save) save.onclick = (ev) => act(ev.currentTarget, () => PUT('/api/admin/llm-settings', {
    daily_cap_usd: Number($('#pfCap').value), alert_pct: Number($('#pfAl').value), block_free_at_cap: $('#pfBlk').checked,
    chat_edit: { credits_per_message: Number($('#pfFee').value), per_minute: Number($('#pfPm').value), per_day: Number($('#pfPd').value), free_per_day: Object.fromEntries($$('[data-free]', el).map((i) => [i.dataset.free, Number(i.value)])) },
  }), 'Saved');
};

// Real-cost watchdog: paused types (owner override), raised table costs, suggested lower costs (never applied automatically).
function watchCard(wd) {
  const paused = Object.entries(wd.paused || {}).filter(([, v]) => v && v.on);
  const rep = wd.report || {};
  const drift = wd.drift || [];
  return `<div class="card"><div class="card-h"><b>Cost watchdog</b><span class="hint">Real cost vs our table, last ${wd.thresholds.window} jobs or ${wd.thresholds.days} days. Raises costs and prices when real cost is ${wd.thresholds.drift_pct}%+ higher; pauses a type under ${wd.thresholds.kill_margin_pct}% real margin (24h).</span></div><div class="card-b">
    ${paused.length ? `<div class="pf-al">${paused.map(([id, v]) => `<div class="stop"><span><b>${esc(id)}</b> paused ${esc(String(v.at || '').slice(0, 16).replace('T', ' '))}: real margin ${v.margin_pct}% (revenue ${usd(v.revenue_usd)}, cost ${usd(v.cost_usd)}). Customers see "temporarily unavailable".</span>${can('settings.manage') ? `<button class="btn brand sm" data-resume="${esc(id)}">Switch back on</button>` : ''}</div>`).join('')}</div>` : '<p class="hint" style="margin:0 0 10px">No video type is paused.</p>'}
    ${(rep.raised || []).length ? `<p><b>Raised at the last check:</b> ${rep.raised.map((x) => `${esc(x.name)} $${x.from} → $${x.to}`).join(' · ')}</p>` : ''}
    ${(rep.suggested || []).length ? `<p class="hint">Real cost is lower than the table (prices are never lowered automatically): ${rep.suggested.map((x) => `${esc(x.name)} table $${x.from}, real about $${x.real}`).join(' · ')}. Lower it in AI providers if it holds.</p>` : ''}
    <div class="pf-wrap"><table class="pf-t"><thead><tr><th>Provider row</th><th>Steps</th><th>Real</th><th>Table</th><th>Real / table</th></tr></thead><tbody>${drift.length ? drift.map((d) => `<tr><td>#${d.provider_id}</td><td>${d.steps}</td><td>${usd(d.real_usd)}</td><td>${usd(d.table_usd)}</td><td class="${d.ratio > 1.1 ? 'bad' : ''}">${(d.ratio * 100).toFixed(0)}%</td></tr>`).join('') : '<tr><td colspan="5">No reported costs yet (demo mode or no provider returns its cost).</td></tr>'}</tbody></table></div>
    <h4 style="margin:16px 0 8px">Failure rate per model (24 hours)</h4>
    <div class="pf-wrap"><table class="pf-t"><thead><tr><th>Model</th><th>Level</th><th>Attempts</th><th>Failed</th><th>Temporary</th><th>Failure rate</th></tr></thead><tbody>${(wd.failure_rates || []).length ? wd.failure_rates.map((m) => `<tr class="${m.rate > 15 && m.attempts >= 5 ? 'flag' : ''}"><td>${esc(m.name)}</td><td>${esc(m.level)}</td><td>${m.attempts}</td><td>${m.failures}</td><td>${m.temporary}</td><td class="${m.rate > 15 ? 'bad' : ''}">${m.rate}%</td></tr>`).join('') : '<tr><td colspan="6">No provider attempts in the last 24 hours.</td></tr>'}</tbody></table></div>
    <p class="hint">Over 15% in a day (5+ attempts) sends an alert. Wasted cost per type is the "Lost on failed" column below; the price guard adds each type's failure buffer (${wd.default_failure_buffer_pct}% until there is enough real data).</p>
    ${can('settings.manage') ? '<div class="row end" style="margin-top:10px"><button class="btn ghost sm" id="wdRun">Check now</button></div>' : ''}</div></div>`;
}

VIEWS.actorreview = async (el) => {
  const r = await GET('/api/admin/actors');
  const list = r.actors;
  el.innerHTML = list.length ? `<div class="ar-grid">${list.map((a) => `<div class="ar-card"><div class="m"><img src="${esc(a.image_url)}" alt="Uploaded face">${a.consent && a.consent.clip_url ? `<video src="${esc(a.consent.clip_url)}" controls playsinline preload="metadata"></video>` : '<div></div>'}</div>
    <div class="b"><b>${esc(a.name)} · ${esc(a.email)}</b><span class="hint">Must say: “${esc(a.consent ? a.consent.line : '')}”</span><span class="hint">${esc(a.status)}${a.review_note ? ' · ' + esc(a.review_note) : ''} · sent ${esc(String(a.created_at).slice(0, 10))}</span>
    ${a.status === 'pending' && can('users.edit') ? `<div class="row" style="gap:6px"><button class="btn brand sm" data-ok="${a.id}">Approve</button><button class="btn ghost sm" data-no="${a.id}">Reject</button></div>` : ''}</div></div>`).join('')}</div>` : emptyCard('No own-face actors waiting', 'When a customer sends a consent clip it shows up here.');
  $$('[data-ok]', el).forEach((b) => { b.onclick = (ev) => act(ev.currentTarget, () => POST('/api/admin/actors/' + b.dataset.ok + '/review', { approve: true }), 'Approved').then(route); });
  $$('[data-no]', el).forEach((b) => { b.onclick = async () => { const note = prompt('Why? The customer sees this.', 'The clip does not show the same person saying the consent line.'); if (note === null) return; await POST('/api/admin/actors/' + b.dataset.no + '/review', { approve: false, note }); toast('Rejected'); route(); }; });
};

// Naira (Bachs) rate safety: what customers pay per $1, the feed, held drops, pauses, and whether naira income covers the USD value sold.
function fxCard(fx) {
  const r = fx.report || {};
  const ngn = (n) => '₦' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (!fx.methods.length) return '';
  return `<div class="card"><div class="card-h"><b>FX (naira)</b><span class="hint">Naira received, converted at today's rate (${esc(r.today_source || '')}), against the US-dollar value of the credits sold.</span></div><div class="card-b">
    <div class="pf-k"><div><b>${ngn(r.ngn_received)}</b><span>Naira received · ${r.payments} payments</span></div><div><b>${usd(r.usd_at_today)}</b><span>Worth today at ${ngn(r.today_rate)}/$1</span></div><div><b>${usd(r.usd_sold)}</b><span>US-dollar value sold</span></div><div><b class="${r.ok ? '' : 'bad'}">${r.covering_pct === null ? '—' : r.covering_pct + '%'}</b><span>${r.ok ? 'The rate is covering' : 'Not covering: raise the rate or the FX buffer'} (${usd(r.gap_usd)})</span></div></div>
    ${fx.methods.map((m) => `<div class="pf-al" style="margin-top:10px"><div class="${m.paused ? 'stop' : ''}"><span><b>${esc(m.name)}</b>: ${m.effective ? esc(m.effective) : 'no naira rate set (Nigeria pays in US dollars)'}. ${m.auto ? 'Automatic rate on' : m.source_set ? 'Automatic rate off (source set)' : 'Automatic rate off (no source)'}${m.feed_rate ? ` · feed ${ngn(m.feed_rate)} at ${esc(String(m.checked_at || '').slice(0, 16).replace('T', ' '))}` : ''}${m.error ? ` · feed problem: ${esc(m.error)}` : ''}${m.paused ? ` · <b>naira checkout paused</b> (feed ${ngn(m.paused.feed)} vs saved ${ngn(m.paused.saved)}): save a new rate on the Bachs method` : ''}${m.pending_lower ? ` · lower rate waiting: ${ngn(m.pending_lower.rate)} (${m.pending_lower.drop_pct}% lower)` : ''}</span>${m.pending_lower && can('settings.manage') ? `<button class="btn ghost sm" data-fxok="${m.id}">Approve lower rate</button>` : ''}</div></div>`).join('')}
    <p class="hint">Use the rate you actually buy dollars at, not the official rate. Change it, the FX buffer and the rate source in Payments → Bachs.</p>
    ${can('settings.manage') ? '<div class="row end" style="margin-top:10px"><button class="btn ghost sm" id="fxRun">Check the feed now</button></div>' : ''}</div></div>`;
}
});
})();
