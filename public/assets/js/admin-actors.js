/* Vooads admin: Content → House actors. The 45 house actors (portrait, motion preview, default voice, tags), the "Featured /
   order" field that pins the originals first, and the one-click "Generate" / "Generate all missing" tools (cost shown first).
   Server: server/houseactors.js, routes in server/routes/phase2.js. */
(function () {
'use strict';
(window.VA_EXT = window.VA_EXT || []).push(function (A) {
const { $, $$, esc, can, GET, POST, PUT, toast, act, SECTIONS, VIEWS, route } = A;
const at = SECTIONS.findIndex((s) => s.id === 'settings');
SECTIONS.splice(at < 0 ? SECTIONS.length : at, 0,
  { id: 'houseactors', label: 'House actors', perm: 'settings.view', group: 'Admin', title: ['House actors.', 'Faces, voices, order.'], desc: 'The AI actors every customer can use. Pin favourites first, fix tags and voices, and make missing portraits and motion previews.' });

const css = document.createElement('style');
css.textContent = `
.ha-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:14px}
.ha-k{display:flex;flex-wrap:wrap;gap:8px}.ha-k span{border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:13px;background:#fff}
.ha-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.ha-c{border:1px solid var(--line);border-radius:16px;background:#fff;overflow:hidden;display:grid}
.ha-c .ph{aspect-ratio:3/4;background:#EEECE6 center/cover no-repeat;position:relative}
.ha-c .ph em{position:absolute;left:8px;top:8px;font-style:normal;font-size:11.5px;font-weight:700;background:#fff;border-radius:999px;padding:3px 8px}
.ha-c .ph em.miss{background:#FFF4F2;color:#C2361B}
.ha-c .b{padding:10px 12px;display:grid;gap:6px;font-size:13px}
.ha-c .b b{font-size:15px}
.ha-c .row2{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ha-c .inp.sm{padding:6px 8px;font-size:12.5px}
.ha-warn{border:1px solid #F3DFA8;background:#FFF8E6;border-radius:14px;padding:12px 14px;font-size:13.5px;margin-bottom:14px}
`;
document.head.appendChild(css);

VIEWS.houseactors = async (el) => {
  const r = await GET('/api/admin/house-actors');
  const manage = can('settings.manage');
  const est = r.estimate || {};
  const mk = (a) => r.markets[a.market] || a.market;
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const st = r.status || {};
  el.innerHTML = `
    <div class="ha-top"><div class="ha-k"><span><b>${r.actors.filter((a) => a.ready).length}</b> live</span><span><b>${r.missing.length}</b> need work</span><span><b>${r.actors.filter((a) => a.featured).length}</b> pinned first</span></div>
      ${manage ? `<button class="btn brand sm" id="haAll">Generate all missing${est.count ? ` · ${est.count} actors` : ''}</button>` : ''}</div>
    ${est.missing_keys && est.missing_keys.length ? `<div class="ha-warn"><b>To generate actors here, add:</b><ul style="margin:6px 0 0 18px">${est.missing_keys.map((k) => `<li>${esc(k)}</li>`).join('')}</ul></div>` : ''}
    <p class="hint" style="margin:-4px 0 12px">“Pinned” sets the order at the front of the picker (1 first). The customer's own last-used actor is the only thing shown ahead of pinned actors. Everyone else follows “Order”.</p>
    <div class="ha-grid">${r.actors.map((a) => `<div class="ha-c" data-id="${esc(a.id)}">
      <div class="ph" style="background-image:url('${esc(a.image_url || '')}')">${a.ready ? (a.motion ? '<em>Portrait + motion</em>' : '<em>Portrait</em>') : '<em class="miss">Slot · needs a portrait</em>'}</div>
      <div class="b"><b>${esc(a.name)}</b><span class="hint">${esc(r.styles[a.style] || a.style)} · ${esc(a.age)} · ${a.gender === 'm' ? 'Man' : 'Woman'} · ${esc(mk(a))}${a.country ? ' · ' + esc(a.country) : ''}</span>
        <span class="hint">Voice: ${esc(a.voice_label || a.voice || 'none')}${a.voice_id ? ` <code>${esc(a.voice_id)}</code>` : ''}</span>
        <span class="hint">${esc(a.speaks_line)}</span>
        ${st[a.id] ? `<span class="hint">Generate: ${esc(st[a.id].status)}${st[a.id].step ? ' (' + esc(st[a.id].step) + ')' : ''}${st[a.id].error ? ' · ' + esc(st[a.id].error) : ''}</span>` : ''}
        ${manage ? `<div class="row2"><label class="hint">Pinned<input class="inp sm" type="number" min="0" max="99" data-f="featured" value="${a.featured || ''}" placeholder="—"></label><label class="hint">Order<input class="inp sm" type="number" min="0" data-f="order" value="${esc(a.order)}"></label></div>
        <div class="row2"><select class="inp sm" data-f="market">${opt(r.markets, a.market)}</select><select class="inp sm" data-f="style">${opt(r.styles, a.style)}</select></div>
        <input class="inp sm mono" data-f="voice_id" value="${esc(a.voice_id || '')}" placeholder="ElevenLabs voice ID">
        <div class="row" style="gap:6px"><button class="btn ghost xs" data-save>Save</button>${!a.img || !a.motion ? '<button class="btn ghost xs" data-gen>Generate</button>' : ''}</div>` : ''}
      </div></div>`).join('')}</div>`;
  if (!manage) return;
  const ask = async (ids, btn) => {
    const q = await POST('/api/admin/house-actors/generate', { ids });
    const e = q.estimate;
    if (e.missing_keys && e.missing_keys.length) return toast('Add the provider keys listed at the top first.', true);
    if (!e.count) return toast('Nothing missing.');
    if (!confirm(`Make ${e.count} actor${e.count > 1 ? 's' : ''} (portrait and a 5-second motion preview) with ${e.image_model} and ${e.video_model}? Estimated provider cost: $${e.usd.toFixed(2)}.`)) return;
    await act(btn, () => POST('/api/admin/house-actors/generate', { ids, confirm: true }), 'Queued. This page shows progress when you reload it.');
    route();
  };
  $('#haAll').onclick = (ev) => ask([], ev.currentTarget);
  $$('.ha-c', el).forEach((c) => {
    const id = c.dataset.id;
    const g = $('[data-gen]', c); if (g) g.onclick = (ev) => ask([id], ev.currentTarget);
    const s = $('[data-save]', c); if (s) s.onclick = (ev) => {
      const body = {}; $$('[data-f]', c).forEach((f) => { body[f.dataset.f] = f.dataset.f === 'featured' ? (f.value === '' ? null : Number(f.value)) : f.dataset.f === 'order' ? Number(f.value) : f.value; });
      act(ev.currentTarget, () => PUT('/api/admin/house-actors/' + encodeURIComponent(id), body), 'Saved').then(route);
    };
  });
};
});
})();
