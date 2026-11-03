/* Vooads admin: Website → Showcase (owners only).
   "Make showcase pack" runs one video per ad style and business type through Vooads' own pipeline on the house account
   (estimated provider cost shown first, nothing runs without a confirmation), then the owner picks which finished videos
   the website shows as "Made with Vooads". Server: server/showcase.js, routes in server/routes/admin.js. */
(function () {
'use strict';
(window.VA_EXT = window.VA_EXT || []).push(function (A) {
const { $, $$, esc, can, GET, POST, PUT, toast, act, modal, emptyCard, ico, SECTIONS, VIEWS, route } = A;
const at = SECTIONS.findIndex((s) => s.id === 'blog');
SECTIONS.splice(at < 0 ? SECTIONS.length : at, 0, { id: 'showcase', label: 'Website showcase', perm: '*', group: 'Content', title: ['Website showcase.', 'Show real Vooads work.'], desc: 'Make a pack of sample ads with Vooads itself, then pick which ones the website shows as “Made with Vooads”.' });

const css = document.createElement('style');
css.textContent = `
.scx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.scx-card{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.scx-card video,.scx-card .ph{width:100%;aspect-ratio:9/16;object-fit:cover;background:#0E1424;display:block}
.scx-card .ph{display:grid;place-items:center;color:#9AA4B8;font-size:13px;font-weight:600;text-align:center;padding:10px}
.scx-card .b{padding:10px 12px;display:grid;gap:6px}
.scx-card .b b{font-size:14px}.scx-card .b small{color:var(--mut);font-size:12px}
.scx-card label{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;cursor:pointer}
.scx-est{width:100%;border-collapse:collapse;font-size:14px}.scx-est td{padding:8px 0;border-bottom:1px solid var(--line)}.scx-est td:last-child{text-align:right;font-variant-numeric:tabular-nums}
`;
document.head.appendChild(css);

const usd = (n) => '$' + (Number(n) || 0).toFixed(2);

VIEWS.showcase = async (el, acts) => {
  const r = await GET('/api/admin/showcase');
  const e = r.estimate;
  acts.innerHTML = `<button class="btn brand sm" id="scxMake">${ico('plus')} Make showcase pack</button>`;
  const items = r.items;
  el.innerHTML = `<div class="stack">
    <div class="card pad"><p class="hint" style="margin:0">The website shows its built-in examples until you pick videos here. Videos made by this pack carry the note “Made with Vooads” on the site. Every face is AI-generated; the pack never uses a real person’s likeness.</p></div>
    <div class="card"><div class="card-h"><b>Your pack</b><span class="hint">${items.length ? items.filter((x) => x.selected).length + ' on the website' : 'Nothing made yet'}</span></div>
      <div class="card-b">${items.length ? `<div class="scx-grid">${items.map((x) => `<div class="scx-card">
        ${x.status === 'done' && x.url ? `<video src="${esc(x.url)}" muted loop playsinline preload="metadata" controls></video>` : `<div class="ph">${x.status === 'failed' ? 'Failed: ' + esc(x.error || '') + '<br>(credits went back to the house account)' : esc(x.step || x.status)}</div>`}
        <div class="b"><b>${esc(x.title)}</b><small>${esc(x.style)}${x.demo ? ' · demo sample' : ''}</small>
        ${x.status === 'done' && !x.demo ? `<label><input type="checkbox" data-pick="${x.job_id}" ${x.selected ? 'checked' : ''}> Show on website</label>` : ''}</div></div>`).join('')}</div>
        <div class="row end" style="margin-top:14px"><button class="btn brand sm" id="scxSave">Save website picks</button></div>` : emptyCard('No showcase videos yet', 'Press “Make showcase pack”. You see the estimated cost before anything runs.')}</div></div>
  </div>`;
  const save = $('#scxSave');
  if (save) save.onclick = (ev) => act(ev.currentTarget, () => PUT('/api/admin/showcase/selected', { ids: $$('[data-pick]', el).filter((c) => c.checked).map((c) => Number(c.dataset.pick)) }), 'Saved. The website now shows your picks.');
  $('#scxMake').onclick = () => {
    const rows = e.presets.map((p) => `<tr><td><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-only="${esc(p.id)}" ${p.error ? 'disabled' : 'checked'}> ${esc(p.title)} <span class="hint">${esc(p.style)}</span></label>${p.error ? `<div class="hint">${esc(p.error)}</div>` : ''}</td><td>${p.error ? '-' : usd(p.provider_cost_usd)}</td></tr>`).join('');
    modal({
      title: 'Make showcase pack', cls: 'wide', ok: e.demo ? '' : 'Confirm and make videos',
      body: `<p class="hint">${esc(e.note)}</p><table class="scx-est">${rows}<tr><td><b>Estimated provider cost (all ticked)</b></td><td><b id="scxTot">${usd(e.total_usd)}</b></td></tr></table>`,
      onOk: async () => {
        const only = $$('[data-only]').filter((c) => c.checked).map((c) => c.dataset.only);
        if (!only.length) { toast('Tick at least one video.'); return false; }
        const out = await POST('/api/admin/showcase/pack', { confirm: true, only });
        toast(out.made.length + ' video' + (out.made.length === 1 ? '' : 's') + ' started.' + (out.errors.length ? ' ' + out.errors.length + ' could not start: ' + out.errors[0].error : ''));
        route();
      },
    });
    const recalc = () => { const tot = e.presets.filter((p) => !p.error && $(`[data-only="${p.id}"]`)?.checked).reduce((s, p) => s + p.provider_cost_usd, 0); const t = $('#scxTot'); if (t) t.textContent = usd(tot); };
    $$('[data-only]').forEach((c) => c.addEventListener('change', recalc));
  };
};
});
})();
