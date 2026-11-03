// Admin → Mail: campaigns, block composer with live preview, audiences, media library, stats.
// Uses the admin's helpers through window.VooAdmin (set in admin.html). Exposes window.VooMail:
//   VooMail.view(el, acts)                     the Mail section
//   VooMail.attachUserTab(drawer, userId, ok)  adds a "Mail" tab to the customer drawer
//   VooMail.userHistory(userId)                Promise of { prefs, tags, sends, lifecycle } (GET /api/admin/mail/users/:id)
(() => {
'use strict';
let $, $$, esc, GET, POST, PUT, DEL, api, toast, act, modal, can, fdate, ago, int, debounce, S;
const bind = () => ({ $, $$, esc, GET, POST, PUT, DEL, api, toast, act, modal, can, fdate, ago, int, debounce, S } = window.VooAdmin);

// ---------- Icons ----------
const P = {
  heading: 'M6 4v16M18 4v16M6 12h12', text: 'M4 6h16M4 12h16M4 18h10', image: 'M3 4h18v16H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 16l-5-5L5 20',
  button: 'M3 8h18v8H3zM8 12h8', divider: 'M3 12h18M7 7h10M7 17h10', spacer: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4', columns: 'M3 4h8v16H3zM14 6h7M14 10h7M14 14h5',
  video: 'M3 5h18v14H3zM10 9l5 3-5 3z', footer: 'M3 4h18v16H3zM3 15h18M7 18h10', grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M19 12l-7 7-7-7', copy: 'M9 9h11v11H9zM5 15H4V4h11v1', trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  back: 'M19 12H5M12 19l-7-7 7-7', plus: 'M12 5v14M5 12h14', desk: 'M2 4h20v13H2zM8 21h8M12 17v4', phone: 'M7 2h10v20H7zM11 18h2', send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  mail: 'M4 4h16v16H4zM22 6l-10 7L2 6', tpl: 'M3 3h18v6H3zM3 13h8v8H3zM15 13h6v8h-6z', media: 'M3 4h18v16H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 16l-5-5L5 20',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z', italic: 'M19 4h-9M14 20H5M15 4 9 20', underline: 'M6 3v7a6 6 0 0 0 12 0V3M4 21h16', link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', smile: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01', tag: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  clip: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5', upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  check: 'M20 6 9 17l-5-5', x: 'M18 6 6 18M6 6l12 12', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', edit: 'M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  cal: 'M3 5h18v16H3zM16 3v4M8 3v4M3 10h18', bolt: 'M13 2 3 14h9l-1 8 10-12h-9z', pause: 'M6 4h4v16H6zM14 4h4v16h-4z', play: 'M6 4l14 8-14 8z', stop: 'M5 5h14v14H5z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20', coin: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5M12 6v2M12 16v2',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z', download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', arrow: 'M5 12h14M13 6l6 6-6 6', quote: 'M3 21c3 0 7-1 7-8V5H3v8h4c0 3-2 5-4 5zM14 21c3 0 7-1 7-8V5h-7v8h4c0 3-2 5-4 5z',
};
const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n] || ''}"/></svg>`;
const ARR = () => `<span class="arr">${svg('arrow')}</span>`;

const BLOCKS = {
  heading: { l: 'Heading', d: () => ({ text: 'A clear, short headline', size: 'lg', align: 'left' }) },
  text: { l: 'Text', d: () => ({ html: '<p>Write something friendly. Use <strong>bold</strong> for the one thing that matters.</p>', align: 'left' }) },
  image: { l: 'Image', d: () => ({ src: '', alt: '', href: '', width: 100, align: 'center' }) },
  button: { l: 'Button', d: () => ({ label: 'Open Vooads', href: '{{app_url}}/app', align: 'left', style: 'brand' }) },
  columns: { l: 'Image + text', d: () => ({ src: '', alt: '', href: '', html: '<p><strong>Side by side.</strong> A picture next to a few words.</p>', side: 'left' }) },
  video: { l: 'Video', d: () => ({ src: '', alt: '', href: '', caption: 'Watch: 30 seconds' }) },
  divider: { l: 'Divider', d: () => ({}) },
  spacer: { l: 'Space', d: () => ({ h: 24 }) },
  footer: { l: 'Footer', d: () => ({ html: '<p>You can reply to this email. A real person reads it.</p>' }) },
};
const ICON = { heading: 'heading', text: 'text', image: 'image', button: 'button', columns: 'columns', video: 'video', divider: 'divider', spacer: 'spacer', footer: 'footer' };
const TAGS = [['first_name', 'there', 'First name', 'Their first name, or “there”'], ['credits', 'your', 'Credits', 'Their credit balance'], ['plan', 'Free', 'Plan', 'Their plan name, or “Free”']];
const EMOJI = ['👋', '🎉', '🔥', '🚀', '✨', '💡', '🎬', '📈', '💰', '⏰', '✅', '👉', '❤️', '😊', '🙌', '🤝', '📣', '🎁', '⚡', '🌍', '📊', '🏆', '👀', '💬'];
const STATUS = { draft: 'Draft', scheduled: 'Scheduled', sending: 'Sending', paused: 'Paused', sent: 'Sent', cancelled: 'Cancelled' };
const plain = (t) => String(t || '').replace(/\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g, (m, k, fb) => (fb !== undefined ? fb : k === 'first_name' ? 'there' : '…'));
const stPill = (s) => `<span class="ml-st ${esc(s)}"><i></i>${esc(STATUS[s] || s)}</span>`;
const uid = () => Math.random().toString(36).slice(2, 10);
const pct = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
const size = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
const tzLabel = () => { const z = tz(); const off = -new Date().getTimezoneOffset(); return `${z.replace(/_/g, ' ')} (GMT${off >= 0 ? '+' : '-'}${Math.floor(Math.abs(off) / 60)}${off % 60 ? ':' + String(Math.abs(off) % 60).padStart(2, '0') : ''})`; };
const when = (c) => c.status === 'scheduled' ? 'Sends ' + fdate(c.scheduled_at) : c.status === 'sent' ? 'Sent ' + ago(c.finished_at || c.started_at) : c.status === 'sending' || c.status === 'paused' ? 'Started ' + ago(c.started_at) : 'Edited ' + ago(c.updated_at || c.created_at);

// Media lookups (the demo returns data URLs in `thumb`).
const MEDIA = new Map();
const remember = (list) => (list || []).forEach((m) => { if (m && m.url) MEDIA.set(m.url, m); });
const thumb = (src) => (src ? (MEDIA.get(src)?.thumb || src) : '');

// Animated number.
function countTo(el, to) {
  if (!el) return;
  const from = Number(el.dataset.v || 0); el.dataset.v = to;
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = int(to); return; }
  const t0 = performance.now(), d = 600;
  const f = (t) => { const k = Math.min(1, (t - t0) / d); const e = 1 - Math.pow(1 - k, 3); el.textContent = int(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}

// File picker → Promise<File[]>.
function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple; i.style.display = 'none';
    i.onchange = () => { resolve([...i.files]); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}
async function uploadFile(file, kind, alt = '') {
  if (kind === 'image' && file.size > 8e6) throw new Error(file.name + ' is bigger than 8 MB.');
  if (kind === 'file' && file.size > 10e6) throw new Error(file.name + ' is bigger than 10 MB.');
  const r = await api(`/api/admin/mail/media?kind=${kind}&name=${encodeURIComponent(file.name)}&alt=${encodeURIComponent(alt)}`, { method: 'POST', raw: file, type: file.type || 'application/octet-stream' });
  remember([r.media]);
  return r.media;
}

// ================= Mail home =================
const TABS = [['campaigns', 'Campaigns', 'mail'], ['templates', 'Templates', 'tpl'], ['audience', 'Contacts', 'users'], ['media', 'Media', 'media'], ['settings', 'Settings', 'gear']];
async function view(el, acts) {
  bind();
  const parts = location.hash.replace(/^#\/mail\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'edit') {
    await home(el, acts, 'campaigns');
    return openComposer(parts[1], decodeURIComponent(parts[2] || ''));
  }
  if (parts[0] === 'c' && parts[1]) return report(el, acts, Number(parts[1]));
  return home(el, acts, TABS.some((t) => t[0] === parts[0]) ? parts[0] : 'campaigns');
}

async function home(el, acts, tab) {
  const ov = await GET('/api/admin/mail/overview');
  S.mail = ov;
  acts.innerHTML = ov.can.edit ? `<button class="btn ml-go" id="ml-new">${svg('plus')} New email ${ARR()}</button>` : '';
  if (ov.can.edit) $('#ml-new').onclick = () => newEmail();
  const sending = ov.campaigns.filter((c) => c.status === 'sending').length;
  el.innerHTML = `<div class="ml">
    <div class="ml-banner ${ov.live ? 'live' : ''} ml-anim"><span class="dot"></span><div>${ov.live ? `<b>Sending is live</b> through Resend${ov.webhook ? ', with delivery and bounce tracking.' : '. Add the Resend webhook in Settings to see deliveries and bounces.'}` : '<b>Test mode.</b> Emails are written to the server log instead of being sent. Add your Resend key in Integrations to go live.'}</div></div>
    <div class="ml-bar"><div class="ml-tabs" role="tablist">${TABS.map(([id, l, i]) => `<button role="tab" data-t="${id}" class="${id === tab ? 'on' : ''}">${svg(i)}${l}${id === 'campaigns' && sending ? `<span class="n">${sending}</span>` : ''}</button>`).join('')}</div></div>
    <div id="ml-tab"></div></div>`;
  const show = (t) => {
    $$('.ml-tabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    try { history.replaceState(null, '', '#/mail' + (t === 'campaigns' ? '' : '/' + t)); } catch {}
    const box = $('#ml-tab');
    box.innerHTML = '<div class="ml-card"><div class="b"><div class="sk" style="width:40%"></div><div class="sk" style="margin-top:12px"></div></div></div>';
    const fn = { campaigns: tabCampaigns, templates: tabTemplates, audience: tabAudience, media: tabMedia, settings: tabSettings }[t];
    Promise.resolve(fn(box, ov)).catch((e) => { box.innerHTML = `<div class="ml-card"><div class="b"><div class="note bad">${esc(e.message)}</div></div></div>`; });
  };
  $$('.ml-tabs button', el).forEach((b) => b.onclick = () => show(b.dataset.t));
  show(tab);
  if (sending) {
    const t = setInterval(async () => {
      if (S.section !== 'mail' || !$('.ml-tabs')) return clearInterval(t);
      if ($('.ml-tabs button.on')?.dataset.t !== 'campaigns') return;
      try { const o = await GET('/api/admin/mail/overview'); S.mail = o; drawCampaigns($('#ml-tab'), o, true); if (!o.campaigns.some((c) => c.status === 'sending')) clearInterval(t); } catch {}
    }, 4000);
    S.timers.push(t);
  }
}

function tabCampaigns(box, ov) { drawCampaigns(box, ov); }
function drawCampaigns(box, ov, quiet) {
  if (!box) return;
  if (!ov.campaigns.length) {
    box.innerHTML = `<div class="ml-empty ml-anim"><div class="ml-env"><i></i><em></em></div><b>Your first email is one click away</b><p>Pick a design, choose who gets it, then send now or schedule it. You can send yourself a test first.</p>${ov.can.edit ? `<button class="btn ml-go" data-new>${svg('plus')} Create an email ${ARR()}</button>` : ''}</div>`;
    $('[data-new]', box) && ($('[data-new]', box).onclick = () => newEmail());
    return;
  }
  box.innerHTML = `<div class="ml-grid">${ov.campaigns.map((c, i) => {
    const s = c.stats;
    const live = c.status === 'sending' || c.status === 'paused';
    return `<button class="ml-camp ${quiet ? '' : 'ml-anim'}" style="--i:${Math.min(i, 12)}" data-id="${c.id}" data-st="${esc(c.status)}">
      <div class="top">${stPill(c.status)}<span class="when">${svg(c.status === 'scheduled' ? 'cal' : 'clock')}${esc(when(c))}</span></div>
      <div><h4>${esc(c.name || 'Untitled email')}</h4><div class="subj">${esc(plain(c.subject) || 'No subject yet')}</div></div>
      ${live ? `<div><div class="ml-prog ${c.status === 'sending' ? 'run' : ''}"><i style="width:${s.progress}%"></i></div><div class="when" style="margin-top:6px">${int(s.sent)} of ${int(s.total)} sent</div></div>` : ''}
      ${['sent', 'sending', 'paused', 'cancelled'].includes(c.status) ? `<div class="ml-mini"><div><span>Sent</span><b>${int(s.sent)}</b></div><div><span>Opened</span><b>${pct(s.open_rate)}</b></div><div><span>Clicked</span><b>${pct(s.click_rate)}</b></div></div>`
        : `<div class="ml-mini"><div><span>Audience</span><b>${c.audience?.source === 'contacts' ? 'Contacts' : 'Customers'}</b></div><div><span>Type</span><b>${c.category === 'product' ? 'Product' : 'Tips'}</b></div><div><span>Files</span><b>${int(c.attachments.length)}</b></div></div>`}
    </button>`;
  }).join('')}</div>`;
  $$('.ml-camp', box).forEach((b) => b.onclick = () => { location.hash = ['draft', 'scheduled'].includes(b.dataset.st) && S.mail?.can.edit ? '#/mail/edit/c/' + b.dataset.id : '#/mail/c/' + b.dataset.id; });
}

async function newEmail() {
  const r = await GET('/api/admin/mail/templates').catch((e) => { toast(e.message, true); return null; });
  if (!r) return;
  const w = modal({
    title: 'Start a new email', ok: null, cancel: 'Close',
    body: `<p>Start from a clean, friendly design or reuse one you made before.</p>
      <div class="ml-tpls" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        <button class="ml-tpl" data-start="blank" style="text-align:left;cursor:pointer;font:inherit;color:inherit"><div class="ml-thumb"><i class="h"></i><i></i><i class="s"></i><i class="btn"></i></div><b>Simple update</b><small>Heading, text and a button</small></button>
        ${r.templates.slice(0, 8).map((t) => `<button class="ml-tpl" data-tpl="${t.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">${miniThumb(t.blocks)}<b>${esc(t.name)}</b><small>Your template</small></button>`).join('')}
      </div>
      ${r.lifecycle.length ? `<div class="ml-f"><label>Or copy a built-in email</label><select class="inp sm" id="ml-lc"><option value="">Choose one…</option>${r.lifecycle.map((t) => `<option value="${esc(t.id)}">${esc(t.id.replace(/_/g, ' '))} · ${esc(t.subject)}</option>`).join('')}</select></div>` : ''}`,
  });
  w.querySelector('.modal').style.maxWidth = '640px';
  const go = async (body, btn) => { const x = await act(btn, () => POST('/api/admin/mail/campaigns', body)); if (x) { w.remove(); location.hash = '#/mail/edit/c/' + x.id; } };
  $$('[data-start]', w).forEach((b) => b.onclick = () => go({}, b));
  $$('[data-tpl]', w).forEach((b) => b.onclick = () => go({ template_id: Number(b.dataset.tpl) }, b));
  const lc = $('#ml-lc', w); if (lc) lc.onchange = () => lc.value && go({ lifecycle_id: lc.value }, null);
}
function miniThumb(blocks) {
  const m = { heading: '<i class="h"></i>', text: '<i></i><i class="s"></i>', image: '<i class="img"></i>', columns: '<i class="img" style="width:48%"></i>', video: '<i class="img" style="background:#121110"></i>', button: '<i class="btn"></i>', divider: '<i style="height:1px"></i>' };
  return `<div class="ml-thumb">${(blocks || []).slice(0, 7).map((b) => m[b.t] || '').join('') || '<i class="h"></i><i></i>'}</div>`;
}

// ---------- Templates tab ----------
async function tabTemplates(box, ov) {
  const r = await GET('/api/admin/mail/templates');
  const mk = r.lifecycle.filter((t) => t.marketing), acc = r.lifecycle.filter((t) => !t.marketing);
  const row = (t) => `<div class="ml-row"><span class="ml-ic ${t.marketing ? 'o' : ''}">${svg(t.marketing ? 'star' : 'mail')}</span><div class="m"><b>${esc(t.subject)}</b><small>${esc(t.trigger || '')}${t.delay ? ' · ' + esc(t.delay) : ''}</small></div><div class="acts">${t.designed ? '<span class="ml-tag o">Designed here</span>' : ''}${t.enabled ? '' : '<span class="ml-tag">Off</span>'}<button class="btn ghost xs" data-lc="${esc(t.id)}">${svg('edit')} ${ov.can.edit ? 'Edit' : 'View'}</button></div></div>`;
  box.innerHTML = `<div class="ml" style="gap:22px">
    <section class="ml-sec ml-anim"><div class="ml-sech"><div><h3>Your templates</h3><p>Designs you can reuse for any campaign.</p></div>${ov.can.edit ? `<button class="btn ghost sm" id="ml-tnew">${svg('plus')} New template</button>` : ''}</div>
      ${r.templates.length ? `<div class="ml-tpls">${r.templates.map((t, i) => `<div class="ml-tpl ml-anim" style="--i:${i}">${miniThumb(t.blocks)}<div><b>${esc(t.name)}</b><small>${esc(t.subject || 'No subject')} · ${ago(t.updated_at)}</small></div><div class="acts">${ov.can.edit ? `<button class="btn ghost xs" data-te="${t.id}">${svg('edit')} Edit</button><button class="btn ghost xs" data-tu="${t.id}">${svg('send')} Use</button><button class="iconbtn" data-td="${t.id}" title="Delete" aria-label="Delete template">${svg('trash')}</button>` : ''}</div></div>`).join('')}</div>`
        : `<div class="ml-empty" style="padding:28px"><b style="font-size:16px">No templates yet</b><p>Save any email as a template from the composer, or start one here.</p></div>`}
    </section>
    <section class="ml-sec ml-anim" style="--i:2"><div class="ml-sech"><div><h3>Built-in emails</h3><p>The emails Vooads sends by itself (welcome, receipts, reminders). Edit their design here; changes go live right away.</p></div></div>
      <div class="ml-card"><div class="h"><div><h3>Marketing</h3><p>Only sent to people who did not unsubscribe.</p></div></div>${mk.map(row).join('')}</div>
      <div class="ml-card"><div class="h"><div><h3>Account and billing</h3><p>Always sent: codes, receipts, security.</p></div></div>${acc.map(row).join('')}</div>
    </section></div>`;
  $('#ml-tnew') && ($('#ml-tnew').onclick = async (e) => { const x = await act(e.currentTarget, () => POST('/api/admin/mail/templates', { name: 'New template' })); if (x) location.hash = '#/mail/edit/t/' + x.id; });
  $$('[data-te]', box).forEach((b) => b.onclick = () => { location.hash = '#/mail/edit/t/' + b.dataset.te; });
  $$('[data-tu]', box).forEach((b) => b.onclick = async () => { const x = await act(b, () => POST('/api/admin/mail/campaigns', { template_id: Number(b.dataset.tu) })); if (x) location.hash = '#/mail/edit/c/' + x.id; });
  $$('[data-td]', box).forEach((b) => b.onclick = () => modal({ title: 'Delete this template?', body: '<p>Campaigns made from it are not affected.</p>', ok: 'Delete', okClass: 'danger', onOk: async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/mail/templates/' + b.dataset.td), 'Template deleted'); if (!x) return false; tabTemplates(box, ov); } }));
  $$('[data-lc]', box).forEach((b) => b.onclick = () => { location.hash = '#/mail/edit/l/' + encodeURIComponent(b.dataset.lc); });
}

// ---------- Contacts tab ----------
async function tabAudience(box, ov) {
  const st = { q: '' };
  const r = await GET('/api/admin/mail/contacts');
  box.innerHTML = `<div class="ml" style="gap:16px">
    ${ov.can.edit ? `<div class="ml-card ml-anim"><div class="h"><div><h3>Import contacts</h3><p>People who are not customers yet (webinar sign-ups, a waitlist). They stay in their own list.</p></div></div><div class="b" style="display:grid;gap:12px">
      <div class="ml-drop" id="ml-csvdrop" tabindex="0" role="button">${svg('upload')}<b>Drop a CSV file or click to choose</b><span>Columns: email (required), name, country, tags. Up to 50,000 rows.</span></div>
      <div class="ml-fs"><div class="ml-f"><label>Add a tag to everyone <small>optional</small></label><input class="inp sm" id="ml-ctag" placeholder="e.g. webinar-oct"></div><div class="ml-f"><label>Where they came from</label><input class="inp sm" id="ml-csrc" placeholder="e.g. Webinar sign-up form"></div></div>
      <label class="ml-check req"><input type="checkbox" id="ml-consent"><span><b>These people agreed to get emails from us.</b> Only import people who opted in. Everyone gets an unsubscribe link in every email.</span></label>
      <div id="ml-cres"></div></div></div>` : ''}
    <div class="ml-card ml-anim" style="--i:1"><div class="h"><div><h3>Contacts <span class="ml-tag" id="ml-ctot">${int(r.total)}</span></h3><p>Pick “Imported contacts” as the audience to email them.</p></div><input class="inp sm" id="ml-cq" type="search" placeholder="Search email or name" style="max-width:240px"></div><div id="ml-clist"></div></div>
    <div class="ml-card ml-anim" style="--i:2"><div class="h"><div><h3>Never email (bounces and spam reports)</h3><p>Addresses that bounced or marked us as spam. Campaigns skip them automatically.</p></div></div><div id="ml-sup"></div></div></div>`;
  const draw = (r) => {
    $('#ml-ctot').textContent = int(r.total);
    $('#ml-clist').innerHTML = r.contacts.length ? r.contacts.map((c) => `<div class="ml-row"><span class="ml-ic">${svg('users')}</span><div class="m"><b>${esc(c.email)}</b><small>${esc(c.name || 'No name')}${c.country ? ' · ' + esc(c.country) : ''} · ${esc(c.consent_source || '')}</small></div><div class="acts">${c.tags.map((t) => `<span class="ml-tag">${esc(t)}</span>`).join('')}${c.unsubscribed ? '<span class="ml-tag">Unsubscribed</span>' : ''}${c.suppressed ? '<span class="ml-tag o">Bounced</span>' : ''}${ov.can.edit ? `<button class="iconbtn" data-cd="${c.id}" aria-label="Remove contact" title="Remove">${svg('trash')}</button>` : ''}</div></div>`).join('')
      : `<div class="ml-card" style="border:0;box-shadow:none"><div class="b" style="color:var(--mut);font-size:14px">${st.q ? 'No contacts match.' : 'No contacts yet. Import a CSV above.'}</div></div>`;
    $$('[data-cd]', box).forEach((b) => b.onclick = async () => { const x = await act(b, () => DEL('/api/admin/mail/contacts/' + b.dataset.cd), 'Contact removed'); if (x) draw(await GET('/api/admin/mail/contacts?q=' + encodeURIComponent(st.q))); });
    $('#ml-sup').innerHTML = r.suppressed.length ? r.suppressed.map((s) => `<div class="ml-row"><span class="ml-ic o">${svg('x')}</span><div class="m"><b>${esc(s.email)}</b><small>${esc(s.reason)} · ${ago(s.created_at)}${s.detail ? ' · ' + esc(s.detail) : ''}</small></div>${ov.can.send ? `<div class="acts"><button class="btn ghost xs" data-su="${esc(s.email)}">Allow again</button></div>` : ''}</div>`).join('') : '<div class="b" style="color:var(--mut);font-size:14px;padding:14px 18px">Nothing here. Good.</div>';
    $$('[data-su]', box).forEach((b) => b.onclick = async () => { const x = await act(b, () => DEL('/api/admin/mail/suppressions/' + encodeURIComponent(b.dataset.su)), 'Removed from the list'); if (x) draw(await GET('/api/admin/mail/contacts?q=' + encodeURIComponent(st.q))); });
  };
  draw(r);
  $('#ml-cq').oninput = debounce(async (e) => { st.q = e.target.value.trim(); try { draw(await GET('/api/admin/mail/contacts?q=' + encodeURIComponent(st.q))); } catch (x) { toast(x.message, true); } }, 250);
  const drop = $('#ml-csvdrop');
  if (!drop) return;
  const importFile = async (f) => {
    if (!f) return;
    if (!$('#ml-consent').checked) { toast('Tick the consent box first.', true); $('#ml-consent').closest('label').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 300 }); return; }
    if (f.size > 5e6) return toast('The CSV can be up to 5 MB.', true);
    drop.innerHTML = '<span class="spinner"></span><b>Importing…</b>';
    try {
      const x = await api(`/api/admin/mail/contacts/import?consent=1&tag=${encodeURIComponent($('#ml-ctag').value)}&source=${encodeURIComponent($('#ml-csrc').value || f.name)}`, { method: 'POST', raw: f, type: 'text/csv' });
      $('#ml-cres').innerHTML = `<div class="note brand ml-anim"><b>${int(x.added)} added, ${int(x.updated)} updated.</b> ${x.invalid ? int(x.invalid) + ' rows had no valid email. ' : ''}${x.suppressed ? int(x.suppressed) + ' are on the never-email list and will be skipped.' : ''}</div>`;
      draw(await GET('/api/admin/mail/contacts'));
    } catch (e) { toast(e.message, true); }
    drop.innerHTML = `${svg('upload')}<b>Drop a CSV file or click to choose</b><span>Columns: email (required), name, country, tags. Up to 50,000 rows.</span>`;
  };
  drop.onclick = async () => importFile((await pickFiles('.csv,text/csv'))[0]);
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.click(); } };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); importFile(e.dataTransfer.files[0]); };
}

// ---------- Media tab ----------
async function tabMedia(box, ov) {
  const r = await GET('/api/admin/mail/media');
  remember(r.images);
  box.innerHTML = `<div class="ml" style="gap:16px">
    <div class="ml-card ml-anim"><div class="h"><div><h3>Images</h3><p>PNG, JPG, GIF or WebP up to ${r.limits.image_mb} MB. ${r.ffmpeg ? 'Big photos are resized and compressed for fast emails.' : ''} Add alt text: it shows when images are off.</p></div></div><div class="b" style="display:grid;gap:14px">
      ${ov.can.edit ? `<div class="ml-drop" id="ml-idrop" tabindex="0" role="button">${svg('upload')}<b>Drop images or click to upload</b><span>You can pick several at once.</span></div>` : ''}
      <div class="ml-media" id="ml-imgs"></div></div></div>
    <div class="ml-card ml-anim" style="--i:1"><div class="h"><div><h3>Files for attachments</h3><p>PDF, PNG, JPG, ZIP, CSV or Word (.docx). Up to ${r.limits.attach_total_mb} MB attached per email.</p></div>${ov.can.edit ? `<button class="btn ghost sm" id="ml-fup">${svg('clip')} Upload file</button>` : ''}</div><div id="ml-files"></div></div></div>`;
  const draw = (r) => {
    remember(r.images);
    $('#ml-imgs').innerHTML = r.images.length ? r.images.map((m, i) => `<div class="ml-m ml-anim" style="--i:${Math.min(i, 14)}"><button class="pic" data-alt="${esc(m.id)}" title="Edit alt text"><img src="${esc(m.thumb || m.url)}" alt="${esc(m.alt)}" loading="lazy"></button><div class="meta"><b>${esc(m.name)}</b><small>${m.width}×${m.height} · ${size(m.size)}${m.alt ? '' : ' · <span style="color:var(--o-d)">no alt text</span>'}</small></div>${ov.can.edit ? `<button class="iconbtn del" data-md="${esc(m.id)}" aria-label="Delete image" title="Delete">${svg('trash')}</button>` : ''}</div>`).join('') : '<p class="hint" style="grid-column:1/-1;color:var(--mut)">No images yet.</p>';
    $('#ml-files').innerHTML = r.files.length ? r.files.map((f) => `<div class="ml-row"><span class="ml-ic">${svg('file')}</span><div class="m"><b>${esc(f.name)}</b><small>${size(f.size)} · ${ago(f.created_at)}</small></div><div class="acts"><a class="iconbtn" href="/api/admin/mail/media/${esc(f.id)}/download" title="Download" aria-label="Download">${svg('download')}</a>${ov.can.edit ? `<button class="iconbtn" data-md="${esc(f.id)}" aria-label="Delete file" title="Delete">${svg('trash')}</button>` : ''}</div></div>`).join('') : '<div class="b" style="color:var(--mut);font-size:14px">No files yet.</div>';
    $$('[data-md]', box).forEach((b) => b.onclick = () => modal({ title: 'Delete this file?', body: '<p>Emails already sent keep working only if the image stays. Delete only files you no longer use.</p>', ok: 'Delete', okClass: 'danger', onOk: async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/mail/media/' + b.dataset.md), 'Deleted'); if (!x) return false; draw(await GET('/api/admin/mail/media')); } }));
    $$('[data-alt]', box).forEach((b) => b.onclick = () => {
      const m = r.images.find((x) => x.id === b.dataset.alt);
      if (!ov.can.edit) return;
      modal({ title: 'Alt text', body: `<img src="${esc(m.thumb || m.url)}" alt="" style="max-height:180px;border-radius:12px;object-fit:contain;background:var(--soft)"><div class="ml-f"><label>Describe the image in a few words</label><input class="inp sm" id="ml-altv" maxlength="200" value="${esc(m.alt)}" placeholder="e.g. Woman holding a serum bottle"></div>`, ok: 'Save', onOk: async (w, btn) => { const x = await act(btn, () => PUT('/api/admin/mail/media/' + m.id, { alt: $('#ml-altv', w).value }), 'Saved'); if (!x) return false; draw(await GET('/api/admin/mail/media')); } });
    });
  };
  draw(r);
  const up = async (files) => {
    for (const f of files) { try { await uploadFile(f, 'image'); toast('Uploaded ' + f.name); } catch (e) { toast(e.message, true); } }
    draw(await GET('/api/admin/mail/media'));
  };
  const d = $('#ml-idrop');
  if (d) {
    d.onclick = async () => up(await pickFiles('image/png,image/jpeg,image/gif,image/webp', true));
    d.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } };
    d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); up([...e.dataTransfer.files]); };
  }
  $('#ml-fup') && ($('#ml-fup').onclick = async (e) => { const [f] = await pickFiles('.pdf,.png,.jpg,.jpeg,.zip,.csv,.docx'); if (!f) return; const x = await act(e.currentTarget, () => uploadFile(f, 'file'), 'Uploaded ' + f.name); if (x) draw(await GET('/api/admin/mail/media')); });
}

// ---------- Settings tab ----------
async function tabSettings(box, ov) {
  const r = await GET('/api/admin/mail/settings');
  const can2 = ov.can.send;
  box.innerHTML = `<div class="ml" style="gap:16px">
    <div class="ml-card ml-anim"><div class="h"><div><h3>Sending</h3><p>How fast campaigns go out. Slower is kinder to new domains.</p></div></div><div class="b" style="display:grid;gap:14px">
      <div class="ml-fs"><div class="ml-f"><label>Emails per minute</label><input class="inp sm" id="ml-rate" type="number" min="1" max="6000" value="${r.settings.rate_per_minute}" ${can2 ? '' : 'disabled'}><span class="hint">A campaign to 1,000 people takes about ${Math.ceil(1000 / r.settings.rate_per_minute)} minutes.</span></div>
      <div class="ml-f"><label>Default “from” name</label><input class="inp sm" id="ml-fromn" maxlength="60" value="${esc(r.settings.default_from_name)}" ${can2 ? '' : 'disabled'}><span class="hint">Emails come from ${esc(r.from)}.</span></div>
      <div class="ml-f"><label>Tries per email</label><input class="inp sm" id="ml-tries" type="number" min="1" max="8" value="${r.settings.max_attempts}" ${can2 ? '' : 'disabled'}><span class="hint">If Resend is busy, we wait and try again (1, 5, 15 minutes…).</span></div></div>
      ${can2 ? `<div class="row end"><button class="btn solid sm" id="ml-sset">Save</button></div>` : ''}</div></div>
    <div class="ml-card ml-anim" style="--i:1"><div class="h"><div><h3>Delivery tracking</h3><p>Opens and clicks are tracked by Vooads. Deliveries, bounces and spam reports come from Resend.</p></div></div><div class="b" style="display:grid;gap:12px">
      <div class="ml-row" style="padding:0;border:0"><span class="ml-ic ${r.live ? '' : 'o'}">${svg(r.live ? 'check' : 'x')}</span><div class="m"><b>${r.live ? 'Resend is connected' : 'Resend is not connected'}</b><small>${r.live ? 'Emails are really sent.' : 'Add the API key in Integrations. Until then emails print in the server log.'}</small></div></div>
      <div class="ml-row" style="padding:0;border:0"><span class="ml-ic ${r.webhook_set ? '' : 'o'}">${svg(r.webhook_set ? 'check' : 'x')}</span><div class="m"><b>${r.webhook_set ? 'Webhook is set' : 'Webhook is not set yet'}</b><small>In resend.com → Webhooks, add this address with the events delivered, bounced and complained, then paste its signing secret in Integrations.</small></div></div>
      <div class="ml-file"><span class="m">${esc(r.webhook_url)}</span><button class="btn ghost xs" id="ml-cp">${svg('copy')} Copy</button></div>
      <div class="ml-row" style="padding:0;border:0"><span class="ml-ic">${svg('image')}</span><div class="m"><b>${r.ffmpeg ? 'Images are optimized automatically' : 'Images are stored as uploaded'}</b><small>${r.ffmpeg ? 'Large photos are resized to 1600px and compressed.' : 'Install ffmpeg on the server to resize big photos.'}</small></div></div>
    </div></div></div>`;
  $('#ml-cp').onclick = () => window.VooAdmin.copy ? window.VooAdmin.copy(r.webhook_url) : navigator.clipboard?.writeText(r.webhook_url).then(() => toast('Copied'));
  $('#ml-sset') && ($('#ml-sset').onclick = (e) => act(e.currentTarget, () => PUT('/api/admin/mail/settings', { rate_per_minute: Number($('#ml-rate').value), default_from_name: $('#ml-fromn').value, max_attempts: Number($('#ml-tries').value) }), 'Settings saved'));
}

// ================= Campaign report =================
async function report(el, acts, id) {
  const r = await GET('/api/admin/mail/campaigns/' + id);
  const c = r.campaign;
  remember(c.attachments);
  const s = c.stats;
  acts.innerHTML = `<a class="btn ghost sm" href="#/mail">${svg('back')} All emails</a>`;
  const actions = [];
  if (r.can.send && c.status === 'sending') actions.push(`<button class="btn ghost sm" data-do="pause">${svg('pause')} Pause</button>`);
  if (r.can.send && c.status === 'paused') actions.push(`<button class="btn ml-go sm" data-do="resume">${svg('play')} Resume</button>`);
  if (r.can.send && c.status === 'scheduled') actions.push(`<button class="btn ghost sm" data-do="unschedule">${svg('edit')} Unschedule</button>`);
  if (r.can.send && ['scheduled', 'sending', 'paused'].includes(c.status)) actions.push(`<button class="btn dghost sm" data-do="cancel">${svg('stop')} Cancel</button>`);
  if (r.can.edit) actions.push(`<button class="btn ghost sm" data-do="dup">${svg('copy')} Duplicate</button>`);
  if (r.can.edit && ['draft', 'scheduled'].includes(c.status)) actions.push(`<a class="btn solid sm" href="#/mail/edit/c/${c.id}">${svg('edit')} Edit</a>`);
  const kpi = (l, v, sub, cls = '', i = 0) => `<div class="ml-kpi ml-anim ${cls}" style="--i:${i}"><span>${l}</span><b data-k="${l}">${v}</b><small>${sub}</small></div>`;
  el.innerHTML = `<div class="ml">
    <div class="ml-card ml-anim"><div class="b" style="display:grid;gap:12px">
      <div class="ml-bar"><div style="min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${stPill(c.status)}<span class="hint" style="font-size:13px">${esc(when(c))}${c.timezone && c.status === 'scheduled' ? ' · ' + esc(c.timezone.replace(/_/g, ' ')) : ''}</span></div>
        <h2 style="font-size:24px;letter-spacing:-.04em;margin-top:8px;overflow-wrap:anywhere">${esc(c.name)}</h2><p style="color:var(--mut);margin-top:2px;overflow-wrap:anywhere">${esc(plain(c.subject))}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${actions.join('')}</div></div>
      ${['sending', 'paused'].includes(c.status) ? `<div><div class="ml-prog ${c.status === 'sending' ? 'run' : ''}"><i id="ml-pg" style="width:${s.progress}%"></i></div><p class="hint" style="font-size:12.5px;margin-top:6px" id="ml-pgt">${int(s.sent)} of ${int(s.total)} sent${s.queued ? ' · ' + int(s.queued) + ' waiting' : ''}${s.failed ? ' · ' + int(s.failed) + ' failed' : ''}</p></div>` : ''}
    </div></div>
    <div class="ml-kpis">${kpi('Recipients', int(s.total || 0), c.audience?.source === 'contacts' ? 'Imported contacts' : 'Customers', 'o', 0)}${kpi('Delivered', int(s.delivered), s.delivered_estimated ? 'Estimated (no webhook)' : pct(s.total ? s.delivered / s.total * 100 : 0) + ' of sent', '', 1)}${kpi('Opened', pct(s.open_rate), int(s.opened) + ' people', '', 2)}${kpi('Clicked', pct(s.click_rate), int(s.clicked) + ' people', '', 3)}${kpi('Unsubscribed', int(s.unsubscribed), pct(s.unsub_rate), '', 4)}${kpi('Bounced', int(s.bounced + s.complained), s.complained ? int(s.complained) + ' spam reports' : pct(s.bounce_rate), '', 5)}</div>
    <div class="ml-report">
      <div style="display:grid;gap:14px;min-width:0">
        <div class="ml-card ml-anim" style="--i:2"><div class="h"><div><h3>How it did</h3><p>Opens are counted when images load, so the real number is usually higher.</p></div></div><div class="b"><div class="ml-funnel">${[['Sent', s.sent], ['Delivered', s.delivered], ['Opened', s.opened], ['Clicked', s.clicked]].map(([l, v], i) => `<div class="ml-fn"><span>${l}</span><div class="t"><i style="width:${s.total ? Math.max(2, v / s.total * 100) : 0}%;--i:${i}"></i></div><b>${int(v)}</b></div>`).join('')}</div></div></div>
        <div class="ml-card ml-anim" style="--i:3"><div class="h"><div><h3>Top links</h3><p>Which links people clicked.</p></div></div>${r.links.length ? r.links.map((l) => `<div class="ml-row"><span class="ml-ic">${svg('link')}</span><div class="m"><b>${esc(l.url.replace(/^https?:\/\//, ''))}</b><small>${int(l.people)} people</small></div><div class="acts"><span class="ml-tag o">${int(l.clicks)} clicks</span></div></div>`).join('') : '<div class="b" style="color:var(--mut);font-size:14px">No clicks yet.</div>'}</div>
        <div class="ml-card ml-anim" style="--i:4"><div class="h"><div><h3>People</h3></div><input class="inp sm" id="ml-rq" type="search" placeholder="Search email" style="max-width:220px"></div>
          <div class="b" style="padding-bottom:6px"><div class="ml-filter" id="ml-rf">${[['', 'Everyone'], ['opened', 'Opened'], ['clicked', 'Clicked'], ['bounced', 'Bounced'], ['unsubscribed', 'Unsubscribed'], ['failed', 'Not sent'], ['waiting', 'Waiting']].map(([k, l]) => `<button data-f="${k}" class="${!k ? 'on' : ''}">${l}</button>`).join('')}</div></div><div id="ml-rl"></div></div>
      </div>
      <div class="ml-card ml-anim" style="--i:3"><div class="h"><div><h3>The email</h3><p>${esc(c.from_name || 'Vooads')} · ${c.attachments.length ? int(c.attachments.length) + ' attachment' + (c.attachments.length > 1 ? 's' : '') : 'no attachments'}</p></div></div><div class="b"><div class="ml-prevmini"><iframe title="Email preview" sandbox="allow-same-origin" id="ml-rpv"></iframe></div></div></div>
    </div></div>`;
  POST('/api/admin/mail/preview', { doc: { subject: c.subject, preheader: c.preheader, from_name: c.from_name, blocks: c.blocks } }).then((p) => { const f = $('#ml-rpv'); if (f) f.srcdoc = p.html; }).catch(() => {});
  const st = { f: '', q: '' };
  const people = async () => {
    const x = await GET(`/api/admin/mail/campaigns/${id}/recipients?filter=${st.f}&q=${encodeURIComponent(st.q)}`);
    const tagz = (p) => [p.status === 'queued' || p.status === 'sending' ? '<span>Waiting</span>' : p.status === 'failed' ? `<span class="bad" title="${esc(p.error || '')}">Failed</span>` : p.status === 'skipped' ? `<span title="${esc(p.error || '')}">Skipped</span>` : p.status === 'cancelled' ? '<span>Cancelled</span>' : '<span class="on">Sent</span>',
      p.opened_at ? `<span class="on">Opened${p.open_count > 1 ? ' ×' + p.open_count : ''}</span>` : '', p.clicked_at ? `<span class="o">Clicked${p.click_count > 1 ? ' ×' + p.click_count : ''}</span>` : '',
      p.bounced_at ? '<span class="bad">Bounced</span>' : '', p.complained_at ? '<span class="bad">Spam report</span>' : '', p.unsubscribed_at ? '<span class="bad">Unsubscribed</span>' : ''].join('');
    $('#ml-rl').innerHTML = x.recipients.length ? x.recipients.map((p) => `<div class="ml-recip"><div style="min-width:0"><b>${esc(p.email)}</b><small>${esc(p.name || '')}${p.sent_at ? (p.name ? ' · ' : '') + 'sent ' + ago(p.sent_at) : ''}</small></div><div class="ml-dots">${tagz(p)}</div></div>`).join('') + (x.total > x.recipients.length ? `<div class="b hint" style="font-size:12.5px">Showing ${int(x.recipients.length)} of ${int(x.total)}.</div>` : '')
      : `<div class="b" style="color:var(--mut);font-size:14px">${s.total ? 'Nobody here.' : c.status === 'scheduled' ? 'The list is made when it starts sending.' : 'Nobody yet.'}</div>`;
  };
  $$('#ml-rf button').forEach((b) => b.onclick = () => { $$('#ml-rf button').forEach((x) => x.classList.toggle('on', x === b)); st.f = b.dataset.f; people().catch((e) => toast(e.message, true)); });
  $('#ml-rq').oninput = debounce((e) => { st.q = e.target.value.trim(); people().catch((x) => toast(x.message, true)); }, 250);
  people().catch(() => {});
  $$('[data-do]', el).forEach((b) => b.onclick = async () => {
    const d = b.dataset.do;
    if (d === 'dup') { const x = await act(b, () => POST('/api/admin/mail/campaigns', { campaign_id: id })); if (x) location.hash = '#/mail/edit/c/' + x.id; return; }
    const run2 = async (btn) => { const x = await act(btn, () => POST(`/api/admin/mail/campaigns/${id}/${d}`), { pause: 'Paused. Nobody else gets it until you resume.', resume: 'Sending again', cancel: 'Cancelled. Nobody else gets it.', unschedule: 'Back to draft' }[d]); if (x) report(el, acts, id); return x; };
    if (d === 'cancel') modal({ title: 'Cancel this email?', body: `<p>People who already got it keep it. Everyone still waiting (${int(s.queued || s.total)}) will not get it. This cannot be undone.</p>`, ok: 'Cancel sending', okClass: 'danger', cancel: 'Keep it', onOk: (w, btn) => run2(btn).then((x) => (x ? undefined : false)) });
    else run2(b);
  });
  if (['sending', 'scheduled'].includes(c.status)) {
    const t = setInterval(async () => {
      if (S.section !== 'mail' || !$('#ml-rl')) return clearInterval(t);
      try {
        const x = await GET('/api/admin/mail/campaigns/' + id);
        if (x.campaign.status !== c.status) { clearInterval(t); return report(el, acts, id); }
        const n = x.campaign.stats;
        if ($('#ml-pg')) $('#ml-pg').style.width = n.progress + '%';
        if ($('#ml-pgt')) $('#ml-pgt').textContent = `${int(n.sent)} of ${int(n.total)} sent${n.queued ? ' · ' + int(n.queued) + ' waiting' : ''}${n.failed ? ' · ' + int(n.failed) + ' failed' : ''}`;
      } catch {}
    }, 3000);
    S.timers.push(t);
  }
}

// ================= Composer =================
let E = null; // editor state
function openComposer(kind, id) {
  $$('.mlx').forEach((x) => x.remove());
  E = { kind, id, step: 'design', sel: null, device: 'desktop', dirty: false, saving: false, seq: 0, can: S.mail?.can || { edit: can('mail.edit'), send: can('mail.send') } };
  const w = document.createElement('div');
  w.className = 'mlx'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', 'Email composer');
  w.innerHTML = '<div class="mlx-top"><div class="sk" style="width:200px"></div></div>';
  document.body.appendChild(w);
  document.documentElement.style.overflow = 'hidden';
  S.cleanup.push(() => { w.remove(); document.documentElement.style.overflow = ''; window.removeEventListener('beforeunload', beforeUnload); clearTimeout(E?.autoT); });
  window.addEventListener('beforeunload', beforeUnload);
  load().catch((e) => { w.innerHTML = `<div class="mlx-top"><button class="back" data-x>${svg('back')}</button><b>Could not open this email</b></div><div style="padding:30px"><div class="note bad">${esc(e.message)}</div></div>`; $('[data-x]', w).onclick = () => { location.hash = '#/mail'; }; });
}
function beforeUnload(e) { if (E && E.dirty) { e.preventDefault(); e.returnValue = ''; } }
async function load() {
  const [media] = await Promise.all([GET('/api/admin/mail/media').catch(() => ({ images: [], files: [] }))]);
  remember(media.images); remember(media.files);
  E.files = media.files || [];
  if (E.kind === 'c') {
    const r = await GET('/api/admin/mail/campaigns/' + E.id);
    const c = r.campaign;
    E.can = r.can;
    if (!['draft', 'scheduled'].includes(c.status)) { location.hash = '#/mail/c/' + c.id; return; }
    E.name = c.name; E.doc = { subject: c.subject, preheader: c.preheader, from_name: c.from_name, blocks: c.blocks }; E.audience = c.audience || {}; E.category = c.category; E.attachments = c.attachments.map((a) => a.id); E.status = c.status; E.scheduled_at = c.scheduled_at;
    remember(c.attachments);
  } else if (E.kind === 't') {
    const r = await GET('/api/admin/mail/templates/' + E.id);
    E.name = r.template.name; E.doc = r.doc;
  } else {
    const r = await GET('/api/admin/mail/lifecycle/' + encodeURIComponent(E.id));
    E.name = E.id.replace(/_/g, ' '); E.doc = r.doc; E.meta = r.template;
  }
  E.doc.blocks.forEach((b) => { if (!b.id) b.id = uid(); });
  E.sel = null;
  shell();
}

function shell() {
  const w = $('.mlx');
  const camp = E.kind === 'c';
  const sub = camp ? (E.status === 'scheduled' ? 'Scheduled · edits are saved automatically' : 'Draft · saved automatically') : E.kind === 't' ? 'Template · saved automatically' : `Built-in email · ${E.meta.marketing ? 'marketing' : 'account'} · ${esc(E.meta.trigger || '')}`;
  w.innerHTML = `<header class="mlx-top">
      <button class="back" data-x aria-label="Close composer" title="Close">${svg('back')}</button>
      <div class="mlx-name"><input id="mlx-name" value="${esc(E.name)}" aria-label="Name" ${E.kind === 'l' ? 'readonly' : ''} maxlength="80"><small id="mlx-state"><i></i><span>${sub}</span></small></div>
      ${camp ? `<nav class="mlx-steps" aria-label="Steps">${[['design', 'Design'], ['audience', 'Audience'], ['send', 'Send']].map(([k, l], i) => `<button data-step="${k}"><i>${i + 1}</i>${l}</button>`).join('')}</nav>` : ''}
      <div class="mlx-acts">
        ${E.can.edit ? `<button class="btn ghost sm hide-s" id="mlx-test">${svg('send')} Test</button>` : ''}
        ${E.kind === 'l' && E.can.edit ? `${E.meta.has_default ? `<button class="btn ghost sm hide-s" id="mlx-reset">${svg('refresh')} Reset</button>` : ''}<button class="btn solid sm" id="mlx-save">Save changes</button>` : ''}
        ${E.kind === 't' && E.can.edit ? `<button class="btn ml-go sm" id="mlx-use">Use in a campaign ${ARR()}</button>` : ''}
        ${camp ? `<button class="btn ml-go sm" id="mlx-next">Next ${ARR()}</button>` : ''}
      </div></header>
    <div id="mlx-main" style="flex:1;min-height:0;display:flex;flex-direction:column"></div>`;
  $('[data-x]', w).onclick = close;
  $('#mlx-name').oninput = (e) => { E.name = e.target.value; changed(false); };
  $('#mlx-test') && ($('#mlx-test').onclick = (e) => sendTest(e.currentTarget));
  $('#mlx-save') && ($('#mlx-save').onclick = (e) => saveLifecycle(e.currentTarget));
  $('#mlx-reset') && ($('#mlx-reset').onclick = () => modal({ title: 'Reset to the built-in version?', body: '<p>Your changes to this email are removed and the original Vooads wording comes back.</p>', ok: 'Reset', okClass: 'danger', onOk: async (mw, btn) => { const x = await act(btn, () => POST(`/api/admin/mail/lifecycle/${encodeURIComponent(E.id)}/reset`), 'Back to the built-in version'); if (!x) return false; E.doc = x.doc; E.dirty = false; E.sel = null; setStep('design'); } }));
  $('#mlx-use') && ($('#mlx-use').onclick = async (e) => { await saveNow(); const x = await act(e.currentTarget, () => POST('/api/admin/mail/campaigns', { template_id: Number(E.id) })); if (x) { E.dirty = false; location.hash = '#/mail/edit/c/' + x.id; } });
  $('#mlx-next') && ($('#mlx-next').onclick = () => setStep(E.step === 'design' ? 'audience' : 'send'));
  $$('[data-step]', w).forEach((b) => b.onclick = () => setStep(b.dataset.step));
  setStep(E.step);
}
function setStep(step) {
  E.step = step;
  $$('.mlx [data-step]').forEach((b, i) => { b.classList.toggle('on', b.dataset.step === step); b.classList.toggle('done', ['design', 'audience', 'send'].indexOf(step) > i); });
  const nx = $('#mlx-next'); if (nx) nx.style.display = step === 'send' ? 'none' : '';
  const main = $('#mlx-main');
  if (step === 'design') designStep(main);
  else if (step === 'audience') audienceStep(main);
  else sendStep(main);
}
async function close() {
  if (E && E.dirty) {
    if (E.kind === 'l') return modal({ title: 'Leave without saving?', body: '<p>Your changes to this built-in email are not saved yet.</p>', ok: 'Leave', okClass: 'danger', cancel: 'Keep editing', onOk: () => { E.dirty = false; location.hash = '#/mail/templates'; } });
    await saveNow();
  }
  location.hash = E?.kind === 'c' ? '#/mail' : '#/mail/templates';
}

// ----- saving -----
function changed(preview = true) {
  E.dirty = true;
  state('dirty', E.kind === 'l' ? 'Unsaved changes' : 'Saving soon…');
  if (preview) schedulePreview();
  if (E.kind !== 'l') { clearTimeout(E.autoT); E.autoT = setTimeout(() => saveNow(), 1500); }
}
function state(cls, text) { const s = $('#mlx-state'); if (!s) return; s.className = cls; s.querySelector('span').textContent = text; }
async function saveNow() {
  if (!E || !E.dirty || E.kind === 'l' || !E.can.edit) return true;
  clearTimeout(E.autoT);
  E.saving = true; state('busy', 'Saving…');
  try {
    if (E.kind === 'c') await PUT('/api/admin/mail/campaigns/' + E.id, { name: E.name, doc: E.doc, audience: E.audience, category: E.category, attachments: E.attachments });
    else await PUT('/api/admin/mail/templates/' + E.id, { name: E.name, doc: E.doc });
    E.dirty = false; state('', 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    return true;
  } catch (e) { state('dirty', 'Not saved'); toast(e.message, true); return false; }
  finally { E.saving = false; }
}
async function saveLifecycle(btn) {
  const x = await act(btn, () => PUT('/api/admin/mail/lifecycle/' + encodeURIComponent(E.id), { doc: E.doc }), 'Saved. This email now goes out with your changes.');
  if (x) { E.dirty = false; state('', 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }
}
async function sendTest(btn) {
  if (E.kind === 'l') { await act(btn, () => POST(`/api/admin/mail/lifecycle/${encodeURIComponent(E.id)}/test`), (r) => (r.logged ? 'Test written to the server log (email is in test mode)' : 'Test sent to ' + r.to)); return; }
  if (E.kind === 't') {
    await saveNow();
    // Templates have no campaign: send the test through a temporary draft, then remove it.
    await act(btn, async () => { const c = await POST('/api/admin/mail/campaigns', { template_id: Number(E.id), name: '(test) ' + E.name }); try { return await POST(`/api/admin/mail/campaigns/${c.id}/test`, { doc: E.doc }); } finally { DEL('/api/admin/mail/campaigns/' + c.id).catch(() => {}); } }, (r) => (r.logged ? 'Test written to the server log (email is in test mode)' : 'Test sent to ' + r.to));
    return;
  }
  await saveNow();
  await act(btn, () => POST(`/api/admin/mail/campaigns/${E.id}/test`, { doc: E.doc, attachments: E.attachments }), (r) => (r.logged ? 'Test written to the server log (email is in test mode)' : 'Test sent to ' + r.to + '. Check your inbox.'));
}

// ----- Design step -----
function designStep(main) {
  main.innerHTML = `<div class="mlx-body" id="mlx-body">
    <section class="mlx-edit" id="mlx-edit">
      <div class="mlx-group ml-anim"><h4><b>Envelope</b><span>What people see in their inbox</span></h4>
        ${E.kind !== 'l' ? `<div class="ml-f"><label for="mlx-from">From name</label><input class="inp sm" id="mlx-from" maxlength="60" value="${esc(E.doc.from_name || '')}" placeholder="Vooads"></div>` : ''}
        <div class="ml-f"><label for="mlx-subj">Subject <small id="mlx-sc">${(E.doc.subject || '').length}/200</small></label><div class="ml-inp"><input class="inp sm" id="mlx-subj" maxlength="200" value="${esc(E.doc.subject || '')}" placeholder="Something worth opening"><span class="tools"><button class="ml-mini-btn" data-emo="mlx-subj" title="Emoji" aria-label="Add emoji">${svg('smile')}</button><button class="ml-mini-btn" data-tagf="mlx-subj" title="Personalize" aria-label="Add personal tag">${svg('tag')}</button></span></div></div>
        <div class="ml-f"><label for="mlx-pre">Preview text <small>shown after the subject</small></label><div class="ml-inp"><input class="inp sm" id="mlx-pre" maxlength="250" value="${esc(E.doc.preheader || '')}" placeholder="One short line that adds to the subject"><span class="tools"><button class="ml-mini-btn" data-emo="mlx-pre" title="Emoji" aria-label="Add emoji">${svg('smile')}</button><button class="ml-mini-btn" data-tagf="mlx-pre" title="Personalize" aria-label="Add personal tag">${svg('tag')}</button></span></div></div>
      </div>
      <div class="mlx-group ml-anim" style="--i:1"><h4><b>Content</b><span>Drag ${svg('grip').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"')} to reorder</span></h4><div class="mlx-blocks" id="mlx-blocks"></div></div>
      ${E.can.edit ? `<div class="mlx-group ml-anim" style="--i:2"><h4><b>Add a block</b><span id="mlx-addhint">${E.sel ? 'Goes under the selected block' : 'Goes at the end'}</span></h4><div class="mlx-add">${Object.entries(BLOCKS).map(([k, v]) => `<button data-add="${k}"><span>${svg(ICON[k])}</span>${v.l}</button>`).join('')}</div></div>` : ''}
      ${E.kind === 'c' && E.can.edit ? `<button class="btn ml-go ml-big" id="mlx-next2">Next: choose who gets it ${ARR()}</button>` : ''}
      ${E.kind === 'c' && E.can.edit ? `<button class="btn ghost sm" id="mlx-astpl" style="justify-self:center">${svg('tpl')} Save as a template</button>` : ''}
    </section>
    <section class="mlx-prev" aria-label="Preview">
      <div class="mlx-ph"><div class="mlx-inbox"><span class="av">${esc((E.doc.from_name || 'V')[0].toUpperCase())}</span><div class="t"><b id="mlx-ifrom">${esc(E.doc.from_name || 'Vooads')}</b><span><em id="mlx-isubj"></em> · <span id="mlx-ipre"></span></span></div></div>
        <div class="ml-seg" role="tablist" aria-label="Device"><button data-dev="desktop" class="${E.device === 'desktop' ? 'on' : ''}">${svg('desk')} Desktop</button><button data-dev="mobile" class="${E.device === 'mobile' ? 'on' : ''}">${svg('phone')} Mobile</button></div></div>
      <span class="mlx-loading" id="mlx-ld"></span>
      <div class="mlx-stage"><div class="mlx-frame ${E.device === 'mobile' ? 'phone' : ''}" id="mlx-frame"><iframe id="mlx-if" title="Email preview" sandbox="allow-same-origin"></iframe></div></div>
    </section>
  </div>
  <div class="mlx-mtabs" role="tablist"><button data-mt="edit" class="on">${svg('edit')} Edit</button><button data-mt="prev">${svg('eye')} Preview</button></div>`;
  const bind2 = (id, key, max) => { const i = $('#' + id); if (!i) return; i.oninput = () => { E.doc[key] = i.value; if (id === 'mlx-subj') $('#mlx-sc').textContent = i.value.length + '/' + max; inbox(); changed(); }; };
  bind2('mlx-from', 'from_name', 60); bind2('mlx-subj', 'subject', 200); bind2('mlx-pre', 'preheader', 250);
  $$('[data-emo]', main).forEach((b) => b.onclick = (e) => { e.preventDefault(); emojiPop(b, (em) => insertInto($('#' + b.dataset.emo), em)); });
  $$('[data-tagf]', main).forEach((b) => b.onclick = (e) => { e.preventDefault(); tagPop(b, (t) => insertInto($('#' + b.dataset.tagf), t)); });
  $$('[data-add]', main).forEach((b) => b.onclick = () => addBlock(b.dataset.add));
  $$('[data-dev]', main).forEach((b) => b.onclick = () => { E.device = b.dataset.dev; $$('[data-dev]', main).forEach((x) => x.classList.toggle('on', x === b)); $('#mlx-frame').classList.toggle('phone', E.device === 'mobile'); });
  $$('[data-mt]', main).forEach((b) => b.onclick = () => { $$('[data-mt]', main).forEach((x) => x.classList.toggle('on', x === b)); $('#mlx-body').classList.toggle('show-prev', b.dataset.mt === 'prev'); if (b.dataset.mt === 'prev') preview(); });
  $('#mlx-next2') && ($('#mlx-next2').onclick = () => setStep('audience'));
  $('#mlx-astpl') && ($('#mlx-astpl').onclick = (e) => modal({ title: 'Save as a template', body: `<div class="ml-f"><label>Template name</label><input class="inp sm" id="ml-tn" maxlength="80" value="${esc(E.name)}"></div>`, ok: 'Save template', onOk: async (w, btn) => { const x = await act(btn, () => POST('/api/admin/mail/templates', { name: $('#ml-tn', w).value, doc: E.doc }), 'Template saved. Find it under Templates.'); if (!x) return false; } }));
  const ifr = $('#mlx-if');
  ifr.onload = () => wireFrame(ifr);
  inbox(); drawBlocks(); preview();
}
function inbox() {
  const fill = (s) => String(s || '').replace(/\{\{\s*first_name\s*(\|[^}]*)?\}\}/g, 'Alex').replace(/\{\{\s*credits\s*(\|[^}]*)?\}\}/g, '1,250').replace(/\{\{\s*plan\s*(\|[^}]*)?\}\}/g, 'Pro').replace(/\{\{\s*(\w+)\s*(\|([^}]*))?\}\}/g, (m, k, f, fb) => fb || '');
  const a = $('#mlx-isubj'), b = $('#mlx-ipre'), f = $('#mlx-ifrom');
  if (a) a.textContent = fill(E.doc.subject) || 'No subject yet';
  if (b) b.textContent = fill(E.doc.preheader) || 'Add preview text';
  if (f) f.textContent = E.doc.from_name || 'Vooads';
}
const schedulePreview = () => { clearTimeout(E.pvT); E.pvT = setTimeout(preview, 280); };
async function preview() {
  const ifr = $('#mlx-if');
  if (!ifr) return;
  const seq = ++E.seq;
  $('#mlx-ld')?.classList.add('on');
  try {
    const r = await POST('/api/admin/mail/preview', { doc: E.doc, ...(E.kind === 'l' ? { lifecycle: E.id } : {}) });
    if (seq !== E.seq || !$('#mlx-if')) return;
    let y = 0; try { y = ifr.contentWindow.scrollY; } catch {}
    E.keepY = y;
    ifr.srcdoc = r.html;
  } catch (e) { if (seq === E.seq) toast(e.message, true); }
  finally { if (seq === E.seq) $('#mlx-ld')?.classList.remove('on'); }
}
// Click a block in the preview to edit it.
function wireFrame(ifr) {
  let d; try { d = ifr.contentDocument; } catch { return; }
  if (!d) return;
  try { if (E.keepY) ifr.contentWindow.scrollTo(0, E.keepY); } catch {}
  d.addEventListener('click', (e) => {
    e.preventDefault();
    const t = e.target.closest && e.target.closest('[data-b]');
    if (t && E.kind !== 'l') select(t.dataset.b, true);
  });
  markFrame();
}
function markFrame() {
  let d; try { d = $('#mlx-if')?.contentDocument; } catch { return; }
  if (!d) return;
  d.querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('vx-on', x.dataset.b === E.sel));
  const on = E.sel && d.querySelector(`[data-b="${CSS.escape(E.sel)}"]`);
  if (on && on.getBoundingClientRect) { const r = on.getBoundingClientRect(); const h = d.defaultView.innerHeight; if (r.top < 0 || r.bottom > h) on.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

function summary(b) {
  const txt = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  switch (b.t) {
    case 'heading': return b.text || 'Empty heading';
    case 'text': case 'footer': return txt(b.html) || 'Empty text';
    case 'image': return b.src ? (b.alt || MEDIA.get(b.src)?.name || 'Image') : 'No image picked';
    case 'button': return (b.label || 'No label') + (b.href ? ' → ' + b.href.replace(/^\{\{app_url\}\}/, 'vooads.com').replace(/^https?:\/\//, '') : '');
    case 'columns': return txt(b.html) || 'Image and text';
    case 'video': return b.href ? b.href.replace(/^https?:\/\//, '') : 'Add the video link';
    case 'spacer': return b.h + 'px of space';
    default: return 'A thin line';
  }
}
function drawBlocks() {
  const box = $('#mlx-blocks');
  if (!box) return;
  const ed = E.can.edit && !(E.kind === 'l' && false);
  box.innerHTML = E.doc.blocks.length ? E.doc.blocks.map((b, i) => `<div class="mlb ${b.id === E.sel ? 'on' : ''} ${b._new ? 'new' : ''}" data-id="${esc(b.id)}">
      <div class="mlb-h" data-open>
        ${ed ? `<button class="mlb-grip" data-grip aria-label="Drag to reorder" title="Drag to reorder">${svg('grip')}</button>` : ''}
        <span class="mlb-ico">${svg(ICON[b.t])}</span><div class="mlb-t"><b>${BLOCKS[b.t].l}</b><span>${esc(summary(b))}</span></div>
        ${ed ? `<div class="mlb-a"><button class="ml-mini-btn" data-mv="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up" title="Move up">${svg('up')}</button><button class="ml-mini-btn" data-mv="1" ${i === E.doc.blocks.length - 1 ? 'disabled' : ''} aria-label="Move down" title="Move down">${svg('down')}</button><button class="ml-mini-btn" data-dup aria-label="Duplicate" title="Duplicate">${svg('copy')}</button><button class="ml-mini-btn" data-del aria-label="Delete" title="Delete">${svg('trash')}</button></div>` : ''}
      </div>${b.id === E.sel ? `<div class="mlb-b">${blockForm(b)}</div>` : ''}</div>`).join('')
    : '<div class="ml-empty" style="padding:24px"><b style="font-size:15px">Empty email</b><p style="font-size:13.5px">Add a heading, some text and a button below.</p></div>';
  E.doc.blocks.forEach((b) => delete b._new);
  $$('.mlb', box).forEach((card) => {
    const b = E.doc.blocks.find((x) => x.id === card.dataset.id);
    $('[data-open]', card).onclick = (e) => { if (e.target.closest('button')) return; select(b.id === E.sel ? null : b.id); };
    $$('[data-mv]', card).forEach((x) => x.onclick = () => move(b.id, Number(x.dataset.mv)));
    $('[data-dup]', card) && ($('[data-dup]', card).onclick = () => { const i = E.doc.blocks.indexOf(b); const c = JSON.parse(JSON.stringify(b)); c.id = uid(); c._new = true; E.doc.blocks.splice(i + 1, 0, c); E.sel = c.id; drawBlocks(); changed(); });
    $('[data-del]', card) && ($('[data-del]', card).onclick = () => { const i = E.doc.blocks.indexOf(b); card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-14px)' }], { duration: 180, easing: 'ease-in' }).onfinish = () => { E.doc.blocks.splice(i, 1); if (E.sel === b.id) E.sel = null; drawBlocks(); changed(); const u = toastUndo('Block removed', () => { E.doc.blocks.splice(i, 0, b); drawBlocks(); changed(); }); }; });
    const g = $('[data-grip]', card); if (g) dragSort(g, card);
    if (b.id === E.sel) wireForm(card, b);
  });
  const h = $('#mlx-addhint'); if (h) h.textContent = E.sel ? 'Goes under the selected block' : 'Goes at the end';
}
function toastUndo(msg, undo) {
  toast(msg);
  const t = $$('.toast').pop();
  if (!t) return;
  const b = document.createElement('button');
  b.textContent = 'Undo'; b.style.cssText = 'margin-left:10px;border:0;background:#fff;color:#0B0B0A;border-radius:999px;padding:4px 10px;font-weight:700;cursor:pointer';
  b.onclick = () => { undo(); t.remove(); };
  t.appendChild(b);
}
function select(id, fromPreview) {
  E.sel = id;
  drawBlocks();
  markFrame();
  if (id) {
    const card = $(`.mlb[data-id="${CSS.escape(id)}"]`);
    if (card) setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: fromPreview ? 'center' : 'nearest' }), 30);
    if (fromPreview && matchMedia('(max-width:980px)').matches) { $('#mlx-body')?.classList.remove('show-prev'); $$('[data-mt]').forEach((x) => x.classList.toggle('on', x.dataset.mt === 'edit')); }
  }
}
function move(id, d) {
  const i = E.doc.blocks.findIndex((b) => b.id === id), j = i + d;
  if (j < 0 || j >= E.doc.blocks.length) return;
  const before = rects();
  [E.doc.blocks[i], E.doc.blocks[j]] = [E.doc.blocks[j], E.doc.blocks[i]];
  drawBlocks(); flip(before); changed();
}
function addBlock(t) {
  const b = { id: uid(), t, ...BLOCKS[t].d(), _new: true };
  const i = E.sel ? E.doc.blocks.findIndex((x) => x.id === E.sel) : -1;
  if (i >= 0) E.doc.blocks.splice(i + 1, 0, b); else E.doc.blocks.push(b);
  E.sel = b.id;
  drawBlocks(); changed();
  setTimeout(() => $(`.mlb[data-id="${b.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
  if (['image', 'columns', 'video'].includes(t)) setTimeout(() => chooseImage(b), 250);
}
const rects = () => new Map($$('.mlb').map((c) => [c.dataset.id, c.getBoundingClientRect().top]));
function flip(before) {
  $$('.mlb').forEach((c) => { const t0 = before.get(c.dataset.id); if (t0 === undefined) return; const dy = t0 - c.getBoundingClientRect().top; if (dy) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.2,1)' }); });
}
// Pointer-based drag (works with mouse and touch).
function dragSort(handle, card) {
  handle.onpointerdown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const list = card.parentElement, scroller = $('#mlx-edit');
    handle.setPointerCapture?.(e.pointerId);
    card.classList.add('drag');
    let lastY = e.clientY, raf = 0;
    const onMove = (ev) => {
      lastY = ev.clientY;
      const sibs = [...list.children].filter((x) => x !== card && x.classList.contains('mlb'));
      const before = rects();
      let moved = false;
      for (const s of sibs) {
        const r = s.getBoundingClientRect();
        if (lastY > r.top && lastY < r.bottom) {
          const after = lastY > r.top + r.height / 2;
          if (after && s.nextElementSibling !== card) { s.after(card); moved = true; }
          else if (!after && s.previousElementSibling !== card) { s.before(card); moved = true; }
          break;
        }
      }
      if (moved) flip(before);
      if (!raf) raf = requestAnimationFrame(function auto() { raf = 0; const r = scroller.getBoundingClientRect(); if (lastY < r.top + 60) scroller.scrollTop -= 12; else if (lastY > r.bottom - 60) scroller.scrollTop += 12; else return; raf = requestAnimationFrame(auto); });
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp); handle.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(raf);
      card.classList.remove('drag');
      const order = $$('.mlb', list).map((c) => c.dataset.id);
      const old = E.doc.blocks.map((b) => b.id).join();
      E.doc.blocks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      if (old !== order.join()) { drawBlocks(); changed(); }
    };
    handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', onUp); handle.addEventListener('pointercancel', onUp);
  };
}

// ----- block forms -----
const segH = (name, val, opts) => `<div class="ml-seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const alignSeg = (b) => segH('align', b.align, [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]);
const rich = (html, ph = 'Write here…') => `<div class="mlrt-w"><div class="mlrt-tb">
  <button type="button" class="ml-mini-btn" data-cmd="bold" title="Bold" aria-label="Bold">${svg('bold')}</button><button type="button" class="ml-mini-btn" data-cmd="italic" title="Italic" aria-label="Italic">${svg('italic')}</button><button type="button" class="ml-mini-btn" data-cmd="underline" title="Underline" aria-label="Underline">${svg('underline')}</button><span class="sep"></span>
  <button type="button" class="ml-mini-btn" data-cmd="link" title="Link" aria-label="Add link">${svg('link')}</button><button type="button" class="ml-mini-btn" data-cmd="insertUnorderedList" title="List" aria-label="Bulleted list">${svg('list')}</button><button type="button" class="ml-mini-btn" data-cmd="quote" title="Quote" aria-label="Quote">${svg('quote')}</button><span class="sep"></span>
  <button type="button" class="ml-mini-btn" data-cmd="emoji" title="Emoji" aria-label="Add emoji">${svg('smile')}</button><button type="button" class="ml-mini-btn" data-cmd="tag" title="Personalize" aria-label="Add personal tag">${svg('tag')}</button></div>
  <div class="mlrt" contenteditable="true" data-ph="${esc(ph)}" role="textbox" aria-multiline="true">${html || ''}</div></div>`;
const picRow = (b, label) => `<div class="mlb-pic"><div class="th">${b.src ? `<img src="${esc(thumb(b.src))}" alt="">` : svg('image')}</div><div style="display:grid;gap:6px;min-width:0"><b style="font-size:13px">${b.src ? esc(MEDIA.get(b.src)?.name || 'Image') : label}</b><div class="ac"><button type="button" class="btn ghost xs" data-pick>${svg('media')} ${b.src ? 'Change' : 'Choose'}</button><button type="button" class="btn ghost xs" data-up>${svg('upload')} Upload</button></div></div></div>`;
function blockForm(b) {
  const f = (label, inner, hint = '') => `<div class="ml-f"><label>${label}</label>${inner}${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  const url = (k, ph = 'https://…') => `<input class="inp sm" data-k="${k}" value="${esc(b[k] || '')}" placeholder="${ph}" inputmode="url">`;
  switch (b.t) {
    case 'heading': return f('Text', `<div class="ml-inp"><input class="inp sm" data-k="text" maxlength="300" value="${esc(b.text)}"><span class="tools"><button type="button" class="ml-mini-btn" data-emoin title="Emoji" aria-label="Add emoji">${svg('smile')}</button><button type="button" class="ml-mini-btn" data-tagin title="Personalize" aria-label="Add personal tag">${svg('tag')}</button></span></div>`) + `<div class="ml-fs">${f('Size', segH('size', b.size, [['lg', 'Large'], ['md', 'Medium']]))}${f('Align', alignSeg(b))}</div>`;
    case 'text': return rich(b.html) + f('Align', alignSeg(b));
    case 'footer': return rich(b.html, 'Small print, your address, a friendly sign-off') + '<span class="hint" style="font-size:12.5px;color:var(--mut)">Shows under the email, above the unsubscribe link (always added for you).</span>';
    case 'image': return picRow(b, 'No image yet') + f('Alt text', `<input class="inp sm" data-k="alt" maxlength="200" value="${esc(b.alt)}" placeholder="Describe the picture">`, 'Shown when images are off. Helps people using screen readers.') + f('Link when tapped <small>optional</small>', url('href')) + `<div class="ml-fs">${f('Width', segH('width', b.width, [[100, 'Full'], [75, '¾'], [50, '½']]))}${f('Align', alignSeg(b))}</div>`;
    case 'button': return `<div class="ml-fs">${f('Label', `<input class="inp sm" data-k="label" maxlength="80" value="${esc(b.label)}">`)}${f('Link', url('href', 'https://… or {{app_url}}/app'))}</div><div class="ml-fs">${f('Style', segH('style', b.style, [['brand', 'Orange'], ['ink', 'Black'], ['outline', 'Outline']]))}${f('Align', alignSeg(b))}</div>`;
    case 'columns': return picRow(b, 'No image yet') + f('Alt text', `<input class="inp sm" data-k="alt" maxlength="200" value="${esc(b.alt)}">`) + rich(b.html) + `<div class="ml-fs">${f('Image on the', segH('side', b.side, [['left', 'Left'], ['right', 'Right']]))}${f('Image link <small>optional</small>', url('href'))}</div>`;
    case 'video': return picRow(b, 'Pick a thumbnail') + f('Video link', url('href', 'https://youtube.com/… or any video page'), 'Email apps cannot play video. People tap the picture and it opens here.') + f('Caption <small>optional</small>', `<input class="inp sm" data-k="caption" maxlength="140" value="${esc(b.caption)}">`) + f('Alt text', `<input class="inp sm" data-k="alt" maxlength="200" value="${esc(b.alt)}">`);
    case 'spacer': return f(`Height <small id="mlx-sph">${b.h}px</small>`, `<input type="range" min="4" max="120" step="4" data-k="h" value="${b.h}" style="accent-color:var(--brand)">`);
    default: return '<p class="hint" style="font-size:13px;color:var(--mut)">A thin line to separate sections.</p>';
  }
}
function wireForm(card, b) {
  const upd = () => { $('.mlb-t span', card).textContent = summary(b); changed(); };
  $$('[data-k]', card).forEach((i) => i.oninput = () => { b[i.dataset.k] = i.type === 'range' ? Number(i.value) : i.value; if (i.type === 'range') $('#mlx-sph').textContent = i.value + 'px'; upd(); });
  $$('[data-seg]', card).forEach((g) => $$('button', g).forEach((x) => x.onclick = () => { $$('button', g).forEach((y) => y.classList.toggle('on', y === x)); b[g.dataset.seg] = g.dataset.seg === 'width' ? Number(x.dataset.v) : x.dataset.v; upd(); }));
  const ti = $('[data-k="text"]', card);
  $('[data-emoin]', card) && ($('[data-emoin]', card).onclick = (e) => emojiPop(e.currentTarget, (em) => insertInto(ti, em)));
  $('[data-tagin]', card) && ($('[data-tagin]', card).onclick = (e) => tagPop(e.currentTarget, (t) => insertInto(ti, t)));
  $('[data-pick]', card) && ($('[data-pick]', card).onclick = () => chooseImage(b));
  $('[data-up]', card) && ($('[data-up]', card).onclick = async (e) => { const [f] = await pickFiles('image/png,image/jpeg,image/gif,image/webp'); if (!f) return; const m = await act(e.currentTarget, () => uploadFile(f, 'image'), 'Image uploaded'); if (m) useImage(b, m); });
  const ed = $('.mlrt', card);
  if (ed) {
    let range = null;
    const keep = () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); };
    const restore = () => { ed.focus(); if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); } };
    ed.addEventListener('keyup', keep); ed.addEventListener('mouseup', keep); ed.addEventListener('blur', keep);
    ed.oninput = () => { b.html = ed.innerHTML; upd(); };
    ed.onpaste = (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); };
    $$('[data-cmd]', card).forEach((x) => { x.onmousedown = (e) => e.preventDefault(); x.onclick = (e) => {
      const c = x.dataset.cmd;
      if (c === 'emoji') { keep(); return emojiPop(x, (em) => { restore(); document.execCommand('insertText', false, em); }); }
      if (c === 'tag') { keep(); return tagPop(x, (t) => { restore(); document.execCommand('insertText', false, t); }); }
      if (c === 'quote') { restore(); document.execCommand('formatBlock', false, 'blockquote'); ed.oninput(); return; }
      if (c === 'link') {
        keep();
        const sel = String(getSelection());
        return modal({ title: 'Add a link', body: `<div class="ml-f"><label>Web address</label><input class="inp sm" id="ml-lk" placeholder="https://vooads.com/…" inputmode="url"></div>${sel ? '' : '<div class="ml-f"><label>Text to show</label><input class="inp sm" id="ml-lt" placeholder="Read more"></div>'}`, ok: 'Add link', onOk: (w) => {
          let u = $('#ml-lk', w).value.trim();
          if (!u) return false;
          if (!/^(https?:|mailto:|\{\{app_url\}\})/i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
          restore();
          if (sel) document.execCommand('createLink', false, u);
          else { const t = $('#ml-lt', w).value.trim() || u.replace(/^https?:\/\//, ''); document.execCommand('insertHTML', false, `<a href="${esc(u)}">${esc(t)}</a>`); }
          ed.oninput();
        } });
      }
      restore(); document.execCommand(c, false, null); ed.oninput();
    }; });
  }
}
function insertInto(input, text) {
  if (!input) return;
  const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, s) + text + input.value.slice(e);
  input.focus(); input.setSelectionRange(s + text.length, s + text.length);
  input.dispatchEvent(new Event('input'));
}
function pop(anchor, html) {
  $$('.ml-pop').forEach((p) => p.remove());
  const p = document.createElement('div');
  p.className = 'ml-pop'; p.innerHTML = html;
  document.body.appendChild(p);
  const r = anchor.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
  p.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.right - w)) + 'px';
  p.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(12, r.top - h - 8) : r.bottom + 8) + 'px';
  const off = (e) => { if (!p.contains(e.target) && e.target !== anchor) { p.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  return p;
}
function emojiPop(anchor, cb) {
  const p = pop(anchor, `<div class="emo">${EMOJI.map((e) => `<button type="button" aria-label="${e}">${e}</button>`).join('')}</div>`);
  $$('button', p).forEach((b) => { b.onmousedown = (e) => e.preventDefault(); b.onclick = () => { cb(b.textContent); p.remove(); }; });
}
function tagPop(anchor, cb) {
  const p = pop(anchor, `<div class="tags">${TAGS.map(([k, fb, l, d]) => `<button type="button" data-t="{{${k}|${fb}}}"><b>${l}</b><small>${d}</small></button>`).join('')}<button type="button" data-t="{{email}}"><b>Email address</b><small>Their email</small></button></div>`);
  $$('button', p).forEach((b) => { b.onmousedown = (e) => e.preventDefault(); b.onclick = () => { cb(b.dataset.t); p.remove(); }; });
}
function useImage(b, m) {
  b.src = m.url; if (!b.alt && m.alt) b.alt = m.alt; b.w = m.width; b.h = m.height;
  drawBlocks(); changed();
}
async function chooseImage(b) {
  let r;
  try { r = await GET('/api/admin/mail/media'); } catch (e) { return toast(e.message, true); }
  remember(r.images);
  let picked = b.src;
  const w = modal({
    title: 'Choose an image', ok: 'Use this image',
    body: `${E.can.edit ? `<div class="ml-drop" id="ml-pdrop" tabindex="0" role="button">${svg('upload')}<b>Upload a new image</b><span>PNG, JPG, GIF or WebP up to 8 MB</span></div>` : ''}
      <div class="ml-media" id="ml-pick" style="max-height:46vh;overflow:auto;padding:2px">${r.images.map((m) => `<button type="button" class="ml-m pick ${m.url === b.src ? 'on' : ''}" data-u="${esc(m.url)}" style="font:inherit;color:inherit;text-align:left;padding:0"><span class="pic"><img src="${esc(m.thumb || m.url)}" alt="${esc(m.alt)}" loading="lazy"></span><span class="meta"><b>${esc(m.name)}</b><small>${m.width}×${m.height}</small></span></button>`).join('') || '<p class="hint" style="grid-column:1/-1">No images yet. Upload one above.</p>'}</div>`,
    onOk: () => { const m = r.images.find((x) => x.url === picked); if (!m) { toast('Pick an image first.', true); return false; } useImage(b, m); },
  });
  w.querySelector('.modal').style.maxWidth = '680px';
  const wire = () => $$('[data-u]', w).forEach((x) => { x.onclick = () => { picked = x.dataset.u; $$('[data-u]', w).forEach((y) => y.classList.toggle('on', y === x)); }; x.ondblclick = () => { picked = x.dataset.u; $('[data-ok]', w).click(); }; });
  wire();
  const d = $('#ml-pdrop', w);
  if (d) {
    const up = async (f) => { if (!f) return; d.innerHTML = '<span class="spinner"></span><b>Uploading…</b>'; try { const m = await uploadFile(f, 'image'); w.remove(); useImage(b, m); toast('Image uploaded'); } catch (e) { toast(e.message, true); d.innerHTML = `${svg('upload')}<b>Upload a new image</b><span>PNG, JPG, GIF or WebP up to 8 MB</span>`; } };
    d.onclick = async () => up((await pickFiles('image/png,image/jpeg,image/gif,image/webp'))[0]);
    d.ondragover = (e) => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = (e) => { e.preventDefault(); d.classList.remove('over'); up(e.dataTransfer.files[0]); };
  }
}

// ----- Audience step -----
async function audienceStep(main) {
  main.innerHTML = `<div class="mlx-scroll"><div class="mlx-aud"><div class="ml-filt" id="mla-f"><div class="ml-card"><div class="b"><div class="sk"></div></div></div></div><aside><div class="ml-count ml-anim" id="mla-c"><span>Will get this email</span><b id="mla-n" data-v="0">…</b><p id="mla-d">Counting…</p></div></aside></div></div>`;
  let opt;
  try { opt = await GET('/api/admin/mail/audience/options'); } catch (e) { return toast(e.message, true); }
  const a = E.audience = { source: 'users', plans: [], buyer: 'any', spend_min: null, spend_max: null, active: 'any', active_days: 30, countries: [], signup_from: '', signup_to: '', tags: [], ...(E.audience || {}) };
  const draw = () => {
    const users = a.source !== 'contacts';
    const chip = (key, v, l, n) => `<button type="button" class="ml-chip ${a[key].includes(v) ? 'on' : ''}" data-ch="${key}" data-v="${esc(v)}">${a[key].includes(v) ? svg('check').replace('<svg', '<svg style="width:13px;height:13px"') : ''}${esc(l)}${n !== undefined ? ` <small>${int(n)}</small>` : ''}</button>`;
    const fc = (icon, title, on, key, inner) => `<div class="ml-fc ml-anim ${on ? 'act' : ''}"><h5><span>${svg(icon)}${title}</span>${on && E.can.edit ? `<button type="button" class="ml-clear" data-clr="${key}">Clear</button>` : ''}</h5>${inner}</div>`;
    $('#mla-f').innerHTML = `
      ${fc('users', 'Who', false, '', `<div class="ml-seg" data-src>${[['users', `Customers <small>${int(opt.users)}</small>`], ['contacts', `Imported contacts <small>${int(opt.contacts)}</small>`]].map(([v, l]) => `<button type="button" data-v="${v}" class="${a.source === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="ml-seg" data-cat>${[['marketing', 'Tips and offers'], ['product', 'Product update']].map(([v, l]) => `<button type="button" data-v="${v}" class="${(E.category || 'marketing') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="hint" style="font-size:12.5px;color:var(--mut)">People choose which of these two they get in their email preferences. Unsubscribed, banned and bounced people never get it.</span>`)}
      ${users ? fc('star', 'Plan', a.plans.length, 'plans', `<div class="ml-chips">${opt.plans.map((p) => chip('plans', p.id, p.name)).join('')}</div>`) : ''}
      ${users ? fc('coin', 'Purchases', a.buyer !== 'any' || a.spend_min !== null || a.spend_max !== null, 'buyer', `<div class="ml-seg" data-buyer>${[['any', 'Anyone'], ['paid', 'Has paid'], ['no_purchase', 'Trial, never paid']].map(([v, l]) => `<button type="button" data-v="${v}" class="${a.buyer === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="row2"><span style="font-size:13px;color:var(--mut)">Lifetime spend</span><input class="inp sm" type="number" min="0" step="1" placeholder="Min $" data-num="spend_min" value="${a.spend_min ?? ''}"><span style="color:var(--mut2)">to</span><input class="inp sm" type="number" min="0" step="1" placeholder="Max $" data-num="spend_max" value="${a.spend_max ?? ''}"></div>`) : ''}
      ${users ? fc('clock', 'Last active', a.active !== 'any', 'active', `<div class="ml-seg" data-active>${[['any', 'Any time'], ['within', 'Active in the last'], ['not_within', 'Not active in the last']].map(([v, l]) => `<button type="button" data-v="${v}" class="${a.active === v ? 'on' : ''}">${l}</button>`).join('')}</div>${a.active !== 'any' ? `<div class="row2"><input class="inp sm" type="number" min="1" max="3650" data-days value="${a.active_days}" style="max-width:100px"><span style="font-size:13px;color:var(--mut)">days</span></div>` : ''}`) : ''}
      ${fc('globe', 'Country', a.countries.length, 'countries', Object.keys(opt.countries).length ? `<div class="ml-chips">${Object.entries(opt.countries).sort((x, y) => y[1] - x[1]).slice(0, 30).map(([c, n]) => chip('countries', c, c, n)).join('')}</div>` : '<span class="hint" style="font-size:13px;color:var(--mut)">No countries known yet.</span>')}
      ${fc('cal', users ? 'Signed up' : 'Added', a.signup_from || a.signup_to, 'signup', `<div class="row2"><input class="inp sm" type="date" data-date="signup_from" value="${esc(a.signup_from)}" aria-label="From"><span style="color:var(--mut2)">to</span><input class="inp sm" type="date" data-date="signup_to" value="${esc(a.signup_to)}" aria-label="To"></div>`)}
      ${fc('tag', 'Tags', a.tags.length, 'tags', `${opt.tags.length ? `<div class="ml-chips">${opt.tags.map((t) => chip('tags', t.tag, t.tag, t.n)).join('')}</div>` : '<span class="hint" style="font-size:13px;color:var(--mut)">No tags yet. Tag customers on their page, or add tags when you import contacts.</span>'}`)}
      <button class="btn ml-go ml-big" id="mla-next">Next: review and send ${ARR()}</button>`;
    const set = () => { changed(false); count(); draw(); };
    $$('[data-src] button').forEach((b) => b.onclick = () => { a.source = b.dataset.v; set(); });
    $$('[data-cat] button').forEach((b) => b.onclick = () => { E.category = b.dataset.v; set(); });
    $$('[data-buyer] button').forEach((b) => b.onclick = () => { a.buyer = b.dataset.v; set(); });
    $$('[data-active] button').forEach((b) => b.onclick = () => { a.active = b.dataset.v; set(); });
    $$('[data-ch]').forEach((b) => b.onclick = () => { const k = b.dataset.ch, v = b.dataset.v; a[k] = a[k].includes(v) ? a[k].filter((x) => x !== v) : [...a[k], v]; set(); });
    $$('[data-num]').forEach((i) => i.oninput = debounce(() => { a[i.dataset.num] = i.value === '' ? null : Number(i.value); changed(false); count(); }, 350));
    $$('[data-date]').forEach((i) => i.onchange = () => { a[i.dataset.date] = i.value; set(); });
    $('[data-days]') && ($('[data-days]').oninput = debounce((e) => { a.active_days = Number(e.target.value) || 30; changed(false); count(); }, 350));
    $$('[data-clr]').forEach((b) => b.onclick = () => { const k = b.dataset.clr; if (k === 'buyer') { a.buyer = 'any'; a.spend_min = a.spend_max = null; } else if (k === 'active') a.active = 'any'; else if (k === 'signup') a.signup_from = a.signup_to = ''; else a[k] = []; set(); });
    $('#mla-next').onclick = () => setStep('send');
    if (!E.can.edit) $$('#mla-f button:not(#mla-next), #mla-f input').forEach((x) => x.disabled = true);
  };
  let cseq = 0;
  const count = async () => {
    const my = ++cseq;
    try {
      const r = await POST('/api/admin/mail/audience/count', { audience: a, category: E.category });
      if (my !== cseq || !$('#mla-n')) return;
      E.count = r.count; E.everyone = r.everyone;
      countTo($('#mla-n'), r.count);
      const ex = r.excluded || {};
      $('#mla-d').innerHTML = `${r.count === 1 ? 'person' : 'people'}${r.everyone ? ' · every customer' : ''}`;
      $('#mla-c').querySelectorAll('ul,.warn,.ex').forEach((x) => x.remove());
      $('#mla-c').insertAdjacentHTML('beforeend', `${r.everyone && !r.can_send_all ? '<div class="warn">Only owners and admins can send to every customer. Add a filter (for example a plan or a country).</div>' : r.everyone ? '<div class="warn">This goes to every customer who did not unsubscribe. Double-check before you send.</div>' : ''}
        ${r.sample.length ? `<ul>${r.sample.map((s) => `<li><i>${esc((s.name || s.email)[0].toUpperCase())}</i><span>${esc(s.name ? s.name + ' · ' + s.email : s.email)}</span></li>`).join('')}${r.count > r.sample.length ? `<li><i>+</i><span>and ${int(r.count - r.sample.length)} more</span></li>` : ''}</ul>` : ''}
        <div class="ex">Never included: ${a.source === 'contacts' ? `${int(ex.unsubscribed || 0)} unsubscribed, ${int(ex.no_consent || 0)} without consent` : `${int(ex.unsubscribed || 0)} unsubscribed, ${int(ex.banned_or_paused || 0)} banned or paused`}, ${int(ex.suppressed || 0)} bounced or spam reports.</div>`);
    } catch (e) { toast(e.message, true); }
  };
  draw(); count();
}

// ----- Send step -----
async function sendStep(main) {
  await saveNow();
  main.innerHTML = `<div class="mlx-scroll"><div class="mlx-send" id="mls"><div class="ml-card"><div class="b"><div class="sk"></div></div></div></div></div>`;
  let cnt;
  try { cnt = await POST('/api/admin/mail/audience/count', { audience: E.audience || {}, category: E.category }); } catch (e) { return toast(e.message, true); }
  E.count = cnt.count;
  const files = () => E.attachments.map((id) => E.files.find((f) => f.id === id) || MEDIA.get(id) || { id, name: 'File', size: 0 });
  const total = () => files().reduce((s, f) => s + (f.size || 0), 0);
  const okSubj = !!String(E.doc.subject || '').trim(), okBody = E.doc.blocks.length > 0, okAud = cnt.count > 0 && (!cnt.everyone || cnt.can_send_all);
  const mode = { v: E.status === 'scheduled' ? 'schedule' : 'now' };
  const localDT = (iso) => { const d = iso ? new Date(iso) : new Date(Date.now() + 2 * 3600e3); d.setSeconds(0, 0); if (!iso) d.setMinutes(0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const drawFiles = () => {
    const fl = files();
    $('#mls-files').innerHTML = (fl.length ? `<div class="ml-files">${fl.map((f) => `<div class="ml-file">${svg('file').replace('<svg', '<svg style="width:16px;height:16px;flex:none"')}<span class="m">${esc(f.name)}</span><small>${size(f.size || 0)}</small>${E.can.edit ? `<button class="ml-mini-btn" data-rm="${esc(f.id)}" aria-label="Remove attachment" title="Remove">${svg('x')}</button>` : ''}</div>`).join('')}</div><div class="ml-bar2" style="margin-top:8px"><i style="width:${Math.min(100, total() / 1e7 * 100)}%"></i></div><span class="hint" style="font-size:12px;color:var(--mut)">${size(total())} of 10 MB</span>` : '<span class="hint" style="font-size:13px;color:var(--mut)">No files attached. Attachments make emails heavier; a link is often better.</span>');
    $$('[data-rm]', main).forEach((b) => b.onclick = () => { E.attachments = E.attachments.filter((x) => x !== b.dataset.rm); changed(false); drawFiles(); });
  };
  const it = (ok, label, value) => `<div class="it"><span class="ok ${ok ? '' : 'no'}">${svg(ok ? 'check' : 'x')}</span><div class="m"><small>${label}</small><b>${value}</b></div></div>`;
  $('#mls').innerHTML = `
    <div class="ml-card ml-anim"><div class="h"><div><h3>Ready to go?</h3><p>Check the details, send yourself a test, then send or schedule.</p></div><button class="btn ghost sm" id="mls-test">${svg('send')} Send a test to me</button></div>
      <div class="ml-sum">${it(true, 'From', esc(E.doc.from_name || 'Vooads'))}${it(okSubj, 'Subject', okSubj ? esc(E.doc.subject) : 'Add a subject in Design')}${it(true, 'Preview text', esc(E.doc.preheader || '—'))}${it(okBody, 'Content', okBody ? int(E.doc.blocks.length) + ' blocks' : 'Add content in Design')}
        ${it(okAud, 'Audience', `${int(cnt.count)} ${cnt.count === 1 ? 'person' : 'people'} · ${E.audience?.source === 'contacts' ? 'imported contacts' : cnt.everyone ? 'every customer' : 'customers matching your filters'}${cnt.everyone && !cnt.can_send_all ? ' (needs an owner)' : ''}`)}</div></div>
    <div class="ml-card ml-anim" style="--i:1"><div class="h"><div><h3>Attachments <small style="color:var(--mut2);font-weight:600">optional</small></h3><p>PDF, PNG, JPG, ZIP, CSV or Word, up to 10 MB in total.</p></div>${E.can.edit ? `<button class="btn ghost sm" id="mls-att">${svg('clip')} Attach a file</button>` : ''}</div><div class="b" id="mls-files"></div></div>
    ${E.can.send ? `<div class="ml-card ml-anim" style="--i:2"><div class="h"><div><h3>When</h3></div></div><div class="b" style="display:grid;gap:12px">
      <div class="ml-when"><button type="button" class="ml-opt ${mode.v === 'now' ? 'on' : ''}" data-mode="now"><b>${svg('bolt')} Send now</b><span>Starts within a few seconds, at a safe speed.</span></button><button type="button" class="ml-opt ${mode.v === 'schedule' ? 'on' : ''}" data-mode="schedule"><b>${svg('cal')} Schedule</b><span>Pick a day and time.</span></button></div>
      <div class="ml-f" id="mls-at" ${mode.v === 'schedule' ? '' : 'hidden'}><label for="mls-dt">Date and time <small>${esc(tzLabel())}</small></label><input class="inp sm" type="datetime-local" id="mls-dt" value="${localDT(E.scheduled_at)}"></div>
      <button class="btn ml-go ml-big" id="mls-go" ${okSubj && okBody && okAud ? '' : 'disabled'}></button>
      ${E.status === 'scheduled' ? `<button class="btn ghost sm" id="mls-unsch" style="justify-self:center">Unschedule (back to draft)</button>` : ''}
    </div></div>` : '<div class="note">Your role can design emails but not send them. Ask someone with “send” access to send it.</div>'}`;
  drawFiles();
  const label = () => { const b = $('#mls-go'); if (!b) return; b.innerHTML = mode.v === 'now' ? `${svg('send')} Send to ${int(cnt.count)} ${cnt.count === 1 ? 'person' : 'people'} ${ARR()}` : `${svg('cal')} Schedule for ${esc(new Date($('#mls-dt').value || Date.now()).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} ${ARR()}`; };
  label();
  $$('[data-mode]', main).forEach((b) => b.onclick = () => { mode.v = b.dataset.mode; $$('[data-mode]', main).forEach((x) => x.classList.toggle('on', x === b)); $('#mls-at').hidden = mode.v !== 'schedule'; label(); });
  $('#mls-dt') && ($('#mls-dt').oninput = label);
  $('#mls-test').onclick = (e) => sendTest(e.currentTarget);
  $('#mls-att') && ($('#mls-att').onclick = async (e) => {
    const [f] = await pickFiles('.pdf,.png,.jpg,.jpeg,.zip,.csv,.docx');
    if (!f) return;
    if (total() + f.size > 1e7) return toast('That would be more than 10 MB of attachments.', true);
    const m = await act(e.currentTarget, () => uploadFile(f, 'file'), 'Attached ' + f.name);
    if (m) { E.files.push(m); E.attachments.push(m.id); changed(false); drawFiles(); }
  });
  $('#mls-unsch') && ($('#mls-unsch').onclick = async (e) => { const x = await act(e.currentTarget, () => POST(`/api/admin/mail/campaigns/${E.id}/unschedule`), 'Back to draft'); if (x) { E.status = 'draft'; shell(); } });
  $('#mls-go') && ($('#mls-go').onclick = async (e) => {
    if (!(await saveNow())) return;
    const body = mode.v === 'now' ? { mode: 'now' } : { mode: 'schedule', scheduled_at: new Date($('#mls-dt').value).toISOString(), timezone: tz() };
    if (mode.v === 'schedule' && isNaN(new Date($('#mls-dt').value))) return toast('Pick a date and time.', true);
    modal({
      title: mode.v === 'now' ? `Send to ${int(cnt.count)} ${cnt.count === 1 ? 'person' : 'people'}?` : 'Schedule this email?',
      body: `<p>${mode.v === 'now' ? 'It starts right away. You can pause or cancel while it is sending.' : `It goes out on <b>${esc(new Date(body.scheduled_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }))}</b> (${esc(tzLabel())}). You can unschedule it until then.`}</p><div class="ml-inbox" style="display:none"></div><div class="note"><b>${esc(E.doc.subject)}</b><br>${esc(E.doc.preheader || '')}</div>`,
      ok: mode.v === 'now' ? 'Send now' : 'Schedule', okClass: 'accent',
      onOk: async (w, btn) => {
        const x = await act(btn, () => POST(`/api/admin/mail/campaigns/${E.id}/send`, body), mode.v === 'now' ? 'Sending started' : 'Scheduled');
        if (!x) return false;
        E.dirty = false;
        celebrate();
        setTimeout(() => { location.hash = '#/mail/c/' + E.id; }, 700);
      },
    });
  });
}
function celebrate() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99;overflow:hidden';
  document.body.appendChild(box);
  const cols = ['#FF4A1C', '#0B0B0A', '#FFD3C2', '#F7F6F2'];
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('i');
    const x = 50 + (Math.random() - 0.5) * 30;
    s.style.cssText = `position:absolute;left:${x}%;top:55%;width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 8}px;border-radius:2px;background:${cols[i % 4]}`;
    box.appendChild(s);
    s.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${(Math.random() - 0.5) * 520}px,${-200 - Math.random() * 260}px) rotate(${Math.random() * 720}deg)`, opacity: 0 }], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  }
  setTimeout(() => box.remove(), 1600);
}

// ================= Customer page: Mail tab =================
const userHistory = (userId) => GET('/api/admin/mail/users/' + userId);
async function mountUserHistory(el, userId) {
  bind();
  el.innerHTML = '<div class="sk"></div><div class="sk" style="margin-top:10px;width:70%"></div>';
  let r;
  try { r = await userHistory(userId); } catch (e) { el.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  const edit = can('mail.edit') || can('users.edit');
  const lbl = (x) => x.bounced_at ? '<span class="ml-tag o">Bounced</span>' : x.complained_at ? '<span class="ml-tag o">Spam report</span>' : x.clicked_at ? '<span class="ml-tag o">Clicked</span>' : x.opened_at ? '<span class="ml-tag g">Opened</span>' : x.status === 'sent' ? '<span class="ml-tag">Sent</span>' : `<span class="ml-tag">${esc(x.status)}</span>`;
  el.innerHTML = `<div class="ml" style="gap:16px">
    <div class="ml-card"><div class="b" style="display:grid;gap:12px">
      <div class="ml-row" style="padding:0;border:0"><div class="m"><b>Tips and offers</b><small>Marketing emails and campaigns</small></div><button class="sw" role="switch" data-pref="marketing" aria-checked="${r.prefs.marketing}" ${edit ? '' : 'disabled'} aria-label="Tips and offers"></button></div>
      <div class="ml-row" style="padding:0;border:0"><div class="m"><b>Product updates</b><small>News about Vooads features</small></div><button class="sw" role="switch" data-pref="product" aria-checked="${r.prefs.product}" ${edit ? '' : 'disabled'} aria-label="Product updates"></button></div>
      ${r.prefs.suppressed ? `<div class="note warn"><b>Never-email list:</b> ${esc(r.prefs.suppressed.reason)} (${ago(r.prefs.suppressed.created_at)}). Campaigns skip this address.</div>` : ''}
      <div class="ml-f"><label>Tags <small>for audiences</small></label><div style="display:flex;gap:8px"><input class="inp sm" id="mlu-tags" value="${esc(r.tags.join(', '))}" placeholder="vip, webinar" ${edit ? '' : 'readonly'}>${edit ? '<button class="btn ghost sm" id="mlu-ts">Save</button>' : ''}</div></div>
    </div></div>
    <div><h4 style="font-size:14px;margin:0 0 8px">Campaigns (${r.sends.length})</h4><div class="ml-hist">${r.sends.length ? r.sends.map((x) => `<a class="ml-hi" href="#/mail/c/${x.campaign_id}" style="color:inherit;text-decoration:none"><span class="ml-ic">${svg('mail')}</span><div class="m"><b>${esc(x.subject || x.campaign)}</b><small>${esc(x.campaign)} · ${x.sent_at ? ago(x.sent_at) : esc(x.status)}${x.unsubscribed_at ? ' · unsubscribed' : ''}</small></div>${lbl(x)}</a>`).join('') : '<p style="color:var(--mut);font-size:13.5px">No campaigns yet.</p>'}</div></div>
    <div><h4 style="font-size:14px;margin:0 0 8px">Automatic emails (${r.lifecycle.length})</h4><div class="ml-hist">${r.lifecycle.length ? r.lifecycle.slice(0, 30).map((x) => `<div class="ml-hi"><span class="ml-ic">${svg('clock')}</span><div class="m"><b>${esc(x.template.replace(/_/g, ' '))}</b><small>${x.sent_at ? (x.error === 'skipped' || x.error === 'suppressed' ? 'Skipped ' : x.error ? 'Not sent ' : 'Sent ') + ago(x.sent_at) : 'Due ' + ago(x.send_at)}</small></div>${x.error === 'suppressed' ? '<span class="ml-tag o" title="On the never-email list (bounce or spam report)">Never-email list</span>' : x.error && x.error !== 'skipped' ? `<span class="ml-tag o" title="${esc(x.error)}">Error</span>` : ''}</div>`).join('') : '<p style="color:var(--mut);font-size:13.5px">None yet.</p>'}</div></div></div>`;
  $$('[data-pref]', el).forEach((b) => b.onclick = async () => { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', on); const x = await act(null, () => PUT('/api/admin/mail/users/' + userId, { [b.dataset.pref]: on }), 'Email preferences saved'); if (!x) b.setAttribute('aria-checked', !on); });
  $('#mlu-ts') && ($('#mlu-ts').onclick = (e) => act(e.currentTarget, () => PUT('/api/admin/mail/users/' + userId, { tags: $('#mlu-tags').value.split(',') }), 'Tags saved'));
}
// Adds a "Mail" tab next to the customer drawer's other tabs (Account, Credits, Jobs, Payments).
function attachUserTab(drawer, userId, allowed = true) {
  bind();
  if (!allowed || !(can('mail.view') || can('users.view'))) return;
  const tabs = drawer.querySelector('#ctabs');
  if (!tabs || tabs.querySelector('[data-t="mail"]')) return;
  const btn = document.createElement('button');
  btn.dataset.t = 'mail'; btn.textContent = 'Mail';
  tabs.appendChild(btn);
  const pane = document.createElement('div');
  pane.dataset.p = 'mail'; pane.hidden = true;
  (tabs.parentElement || drawer).appendChild(pane);
  let loaded = false;
  btn.onclick = () => {
    tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn));
    drawer.querySelectorAll('[data-p]').forEach((p) => p.hidden = p !== pane);
    if (!loaded) { loaded = true; mountUserHistory(pane, userId); }
  };
}

window.VooMail = { view, attachUserTab, mountUserHistory, userHistory };
})();
