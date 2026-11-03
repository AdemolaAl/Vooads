/* Moved out of admin.html so the CSP can drop 'unsafe-inline' (security audit). */
(() => {
'use strict';
// ================= Utilities =================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');
const S = { me: null, perms: [], section: null, timers: [], cleanup: [], pricing: null, roles: null };
const can = (p) => Array.isArray(p) ? p.some((x) => can(x)) : (S.perms.includes('*') || S.perms.includes(p));
const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const money = (n, dp) => '$' + num(n).toLocaleString(undefined, { minimumFractionDigits: dp ?? (num(n) % 1 ? 2 : 0), maximumFractionDigits: dp ?? 2 });
const int = (n) => num(n).toLocaleString();
function parseDate(s) { if (!s) return null; let t = String(s); if (!t.includes('T')) t = t.replace(' ', 'T') + 'Z'; const d = new Date(t); return isNaN(d) ? null : d; }
function ago(s) {
  const d = parseDate(s); if (!d) return '—';
  const sec = (Date.now() - d) / 1000;
  if (sec < 0) { const f = -sec; if (f < 3600) return 'in ' + Math.round(f / 60) + 'm'; if (f < 86400) return 'in ' + Math.round(f / 3600) + 'h'; return 'in ' + Math.round(f / 86400) + 'd'; }
  if (sec < 60) return 'just now'; if (sec < 3600) return Math.floor(sec / 60) + 'm ago'; if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'; if (sec < 86400 * 30) return Math.floor(sec / 86400) + 'd ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
const fdate = (s) => { const d = parseDate(s); return d ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
const initials = (n) => String(n || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(path, opt = {}) {
  const o = { method: opt.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opt.raw) { o.body = opt.raw; o.headers['Content-Type'] = opt.type; }
  else if (opt.body !== undefined) { o.body = JSON.stringify(opt.body); o.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await fetch(path, o); } catch (e) { throw new Error('Could not reach the server. Check your connection.'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) {
    const err = new Error((data && data.error) || 'Request failed (' + r.status + ')'); err.status = r.status;
    if (r.status === 401 && S.me && !path.startsWith('/api/admin/auth')) { S.me = null; toast('Your session ended. Log in again.', true); showLogin(); }
    throw err;
  }
  return data;
}
const GET = (p) => api(p);
const POST = (p, b = {}) => api(p, { method: 'POST', body: b });
const PUT = (p, b = {}) => api(p, { method: 'PUT', body: b });
const DEL = (p) => api(p, { method: 'DELETE' });
// For APIs that are still being built: a 404/405/501 means "not there yet", not an error.
const isMissing = (e) => e && [404, 405, 501].includes(e.status);
async function tryGet(p) {
  try { return { ok: true, data: await GET(p) }; }
  catch (e) { return { ok: false, missing: isMissing(e), forbidden: e.status === 403, error: e }; }
}
const naCard = (title, text) => `<div class="card na"><span class="ic">${ico('clock')}</span><div><b>${title || 'Not available yet'}</b><p>${text || 'This part switches on as soon as the server update lands. Nothing is broken, and nothing you do here is lost.'}</p></div></div>`;
const ARR = () => `<span class="arr">${ico('arrow')}</span>`;
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
const clock = (sec) => pad2(sec / 60) + ':' + pad2(sec % 60);

let toastT;
function toast(msg, bad = false) {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', bad ? 'alert' : 'status');
  t.innerHTML = (bad ? ico('alert') : ico('check')) + '<span>' + esc(msg) + '</span>';
  document.body.appendChild(t);
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, bad ? 5200 : 2800);
}
// Run an action with a busy button; toast on success or the API error.
async function act(btn, fn, ok) {
  let html;
  if (btn) { html = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>' + (btn.dataset.busy ? esc(btn.dataset.busy) : ''); }
  try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); return r; }
  catch (e) { toast(e.message, true); return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = 0; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {} ta.remove(); }
  toast('Copied to clipboard');
}

// ================= Icons =================
const IC = {
  profit: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  actorreview: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 12 0v1M17 11l2 2 4-4',
  showcase: 'M3 5h18v14H3zM10 9l5 3-5 3z',
  overview: 'M3 3h8v10H3zM13 3h8v6h-8zM13 11h8v10h-8zM3 15h8v6H3z',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  payments: 'M2 5h20v14H2zM2 10h20M6 15h4',
  support: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  providers: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  methods: 'M20 12V8H6a2 2 0 0 1 0-4h12v4M4 6v12a2 2 0 0 0 2 2h14v-4M18 12a2 2 0 0 0 0 4h4v-4z',
  pricing: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  emails: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  team: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  audit: 'M12 8v4l3 3M3.05 11a9 9 0 1 1 .5 4M3 4v5h5',
  integrations: 'M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4',
  menu: 'M3 6h18M3 12h18M3 18h12', x: 'M18 6 6 18M6 6l12 12', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14', copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1', check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', edit: 'M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z', back: 'M19 12H5M12 19l-7-7 7-7',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z', refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z', ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3', upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  text: 'M4 7V4h16v3M9 20h6M12 4v16', image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21', video: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
  ugc: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', voice: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4',
  mail: 'M4 4h16v16H4zM22 6l-10 7L2 6',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  userplus: 'M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z',
  guard: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM8.5 12.5l2.5 2.5 4.5-5',
  brain: 'M9.5 2A2.5 2.5 0 0 0 7 4.5V5a3 3 0 0 0-3 3 3 3 0 0 0 .5 5A3 3 0 0 0 7 18a3 3 0 0 0 5 1.5V4.5A2.5 2.5 0 0 0 9.5 2zM14.5 2A2.5 2.5 0 0 1 17 4.5V5a3 3 0 0 1 3 3 3 3 0 0 1-.5 5A3 3 0 0 1 17 18a3 3 0 0 1-5 1.5',
  training: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM10 8l6 4-6 4z',
  headset: 'M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z',
  note: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  coin: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5M12 6v2M12 16v2',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  play: 'M6 4l14 8-14 8z', pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  stock: 'M2 4h20v16H2zM7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5',
  dub: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3',
  volume: 'M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
};
IC.support = IC.inbox; IC['support-settings'] = IC.headset;
const ico = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[n] || ''}"/></svg>`;
const LOGO = '<span class="lmark sm"><span class="eye"><b></b></span><span class="eye"><b></b></span></span>';
const FACE = (cls = '') => `<div class="face ${cls}"><div class="eyes"><span class="eye"><b></b></span><span class="eye"><b></b></span></div><span class="mouth"></span></div>`;

// ================= Sections =================
const SECTIONS = [
  { id: 'overview', label: 'Overview', perm: 'dashboard.view', group: 'Business', title: ['Good morning.', 'Here is today.'], desc: 'How Vooads is doing right now: money, customers, support and profit, with anything that needs you on top.' },
  { id: 'customers', label: 'Customers', perm: 'users.view', group: 'Business', title: ['Your customers.', 'Find anyone fast.'], desc: 'Search any customer, see their credits and history, give credits, or pause an account.' },
  { id: 'payments', label: 'Payments', perm: 'payments.view', group: 'Business', title: ['All payments.', 'Paid or not.'], desc: 'Every checkout. Mark one refunded here after you send the money back in the provider.' },
  { id: 'inbox', label: 'Support inbox', perm: ['tickets.view', 'support.reply'], group: 'Support', wide: true, title: ['Support inbox.', 'Answer fast.'], desc: 'Every ticket and callback request in one place. Reply, leave private notes, assign, and give credits without leaving the thread.' },
  { id: 'support-settings', label: 'Support settings', perm: ['tickets.manage', 'settings.manage'], group: 'Support', title: ['Support settings.', 'Set it once.'], desc: 'Where tickets are answered (here, VooSquare or both), reply-time targets, the instant bot answer and saved replies.' },
  { id: 'integrations', label: 'Integrations', perm: 'settings.view', group: 'Setup', title: ['Integrations.', 'Connect and test.'], desc: 'Every outside service in one place: AI, payments, email, VooSquare and storage. See what is connected, add keys, and test each one.' },
  { id: 'providers', label: 'AI providers', perm: 'providers.view', group: 'Setup', title: ['AI providers.', 'Swap in one click.'], desc: 'Choose which AI service does each job and add their API keys. No code.' },
  { id: 'methods', label: 'Payment methods', perm: 'payments.view', group: 'Setup', title: ['Payment methods.', 'Any provider.'], desc: 'Turn checkouts on, add keys, pick countries, or connect any payment API without code.' },
  { id: 'pricing', label: 'Pricing & video types', perm: 'pricing.view', group: 'Setup', title: ['Pricing.', 'Never at a loss.'], desc: 'Plans, top-ups, video types and what each one costs in credits, plus discount codes.' },
  { id: 'guard', label: 'Profit guard', perm: 'pricing.view', group: 'Setup', title: ['Profit guard.', 'Every job pays.'], desc: 'Checks every video type against the cheapest price a customer can pay, and blocks jobs that would lose money.' },
  { id: 'brain', label: 'AI brain', perm: 'settings.view', group: 'Content', title: ['AI brain.', 'What the AI knows.'], desc: 'The ad know-how the AI uses for every hook and script: the playbook, each niche, and this week\'s trends.' },
  { id: 'voice', label: 'Voice & pronunciation', perm: 'settings.view', group: 'Content', title: ['Voice.', 'Said right, every time.'], desc: 'How brand names are spoken in every voiceover, and which voice is Standard or Ultra-realistic.' },
  { id: 'music', label: 'Music library', perm: 'settings.view', group: 'Content', title: ['Music library.', 'Sound that fits.'], desc: 'Upload background tracks by mood. Library music is free; AI music is a paid add-on made for each ad.' },
  { id: 'training', label: 'Training', perm: 'settings.view', group: 'Content', title: ['Training.', 'Lessons with a voice.'], desc: 'The how-to lessons customers watch in the studio. Generate their voiceovers here.' },
  { id: 'blog', label: 'Blog', perm: 'blog.view', group: 'Content', title: ['The blog.', 'Write and publish.'], desc: 'Write, edit and publish posts for vooads.com/blog. Drafts stay private until you publish.' },
  { id: 'emails', label: 'Emails', perm: 'emails.view', group: 'Content', title: ['Emails.', 'Every word you send.'], desc: 'Every email Vooads sends. Edit the words, preview them, and send yourself a test.' },
  { id: 'mail', label: 'Mail', perm: 'mail.view', group: 'Content', wide: true, title: ['Mail.', 'Send something sweet.'], desc: 'Design beautiful emails, choose who gets them, send now or schedule, and see who opened and clicked.' },
  { id: 'team', label: 'Team & roles', perm: 'staff.view', group: 'Admin', title: ['Team & roles.', 'Right access only.'], desc: 'Invite people and decide exactly what each role can see, change and give away.' },
  { id: 'settings', label: 'Settings', perm: 'settings.view', group: 'Admin', title: ['Site settings.', 'Switches and voices.'], desc: 'Site switches, the announcement bar, referral payouts, presenters and voice IDs.' },
  { id: 'audit', label: 'Audit log', perm: 'audit.view', group: 'Admin', title: ['Activity log.', 'Nothing hidden.'], desc: 'Every change made by staff and VooSquare agents, newest first. Nobody can edit or delete it.' },
];
const visible = () => SECTIONS.filter((s) => can(s.perm));

// ================= Boot =================
async function boot() {
  const h = location.hash;
  if (h.startsWith('#invite=')) return showInvite(decodeURIComponent(h.slice(8)));
  if (h.startsWith('#setup=')) { S.setup = decodeURIComponent(h.slice(7)); try { history.replaceState(null, '', location.pathname); } catch {} }
  try {
    const me = await GET('/api/admin/me');
    if (!me.staff) return showLogin();
    S.me = me; S.perms = me.role?.permissions || [];
    showApp();
  } catch (e) { showLogin(e.message); }
}

function authShell(inner) {
  root.innerHTML = `<div class="auth">
    <div class="auth-art">
      <div><a class="logo" href="/" aria-label="Vooads home">${LOGO}<span class="lword">Vooads</span></a>
      <h1>Run Vooads <span class="it">from one place.</span></h1>
      <p>Customers, payments, AI providers, pricing, content and your team. Everything that keeps the studio running.</p>
      ${FACE('brand')}</div>
      <div class="ticks"><span>Email-code login</span><span>Role-based access</span><span>Every change logged</span></div>
    </div>
    <div class="auth-form"><div class="auth-card">${inner}</div></div>
  </div>`;
}

function showLogin(errMsg) {
  stopTimers();
  authShell(`<span class="eyebrow">Staff only</span>
    <h2 style="margin-top:12px">Log in to the <span class="it b">admin</span></h2>
    <p class="sub">${S.setup ? 'First-time setup: enter the email you want as the <b>owner</b> account. We\'ll email you a 6-digit code.' : 'We\'ll email you a 6-digit code. No passwords to remember.'}</p>
    <form id="f-email" autocomplete="on">
      <div class="fld"><label for="em">Work email</label><input class="inp" id="em" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" required placeholder="you@company.com"></div>
      <label class="chk" style="display:flex;gap:10px;align-items:center;font-size:14px;cursor:pointer"><input type="checkbox" id="keep" name="remember" checked> Keep me signed in for 30 days on this device</label>
      <button class="btn brand block lg" type="submit">Email me a code</button>
      <div class="note"><b>First time setting up?</b> The very first login must use the <b>OWNER_EMAIL</b> set on the server. Everyone else joins through an invite link.</div>
    </form>
    <form id="f-code" hidden>
      <div class="fld"><label for="cd">6-digit code</label><input class="inp code-inp" id="cd" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required placeholder="••••••"><small id="sentto"></small></div>
      <div id="devnote"></div>
      <button class="btn brand block lg" type="submit">Log in</button>
      <div class="row between"><button type="button" class="linkbtn" id="chg">Use a different email</button><button type="button" class="linkbtn" id="resend">Send a new code</button></div>
    </form>`);
  if (errMsg) toast(errMsg, true);
  const fe = $('#f-email'), fc = $('#f-code');
  let email = '', keep = true;
  try { const le = localStorage.getItem('va_admin_email'); if (le) $('#em').value = le; if (localStorage.getItem('va_admin_keep') === '0') $('#keep').checked = false; } catch {}
  const send = async (btn) => {
    const r = await act(btn, () => POST('/api/admin/auth/code', { email, setup: S.setup || undefined }));
    if (!r) return;
    fe.hidden = true; fc.hidden = false;
    $('#sentto').textContent = 'If ' + email + ' has admin access, the code is on its way. It expires in 10 minutes.';
    if (r.dev_code) { $('#cd').value = r.dev_code; $('#devnote').innerHTML = '<div class="note brand"><b>Development mode:</b> email is not set up, so the code was filled in for you.</div>'; }
    else { $('#devnote').innerHTML = ''; toast('Check your inbox for the code'); }
    $('#cd').focus();
  };
  fe.onsubmit = (e) => { e.preventDefault(); email = $('#em').value.trim().toLowerCase(); keep = $('#keep').checked; send(fe.querySelector('button[type=submit]')); };
  $('#resend').onclick = (e) => send(e.currentTarget);
  $('#chg').onclick = () => { fc.hidden = true; fe.hidden = false; $('#em').focus(); };
  $('#cd').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if (e.target.value.length === 6) { if (fc.requestSubmit) fc.requestSubmit(); else fc.dispatchEvent(new Event('submit', { cancelable: true })); } };
  fc.onsubmit = async (e) => {
    e.preventDefault();
    const r = await act(fc.querySelector('button[type=submit]'), () => POST('/api/admin/auth/verify', { email, code: $('#cd').value, remember: keep, setup: S.setup || undefined }));
    if (r) { try { localStorage.setItem('va_admin_email', email); localStorage.setItem('va_admin_keep', keep ? '1' : '0'); } catch {} }
    if (r) { toast('Welcome back'); history.replaceState(null, '', location.pathname + '#/'); boot(); }
  };
  setTimeout(() => $('#em')?.focus(), 50);
}

async function showInvite(token) {
  authShell(`<div class="sk" style="height:30px;width:60%"></div><div class="sk" style="margin-top:14px"></div>`);
  let inv;
  try { inv = await GET('/api/admin/invite/' + encodeURIComponent(token)); }
  catch (e) {
    authShell(`<span class="eyebrow">Invite</span><h2 style="margin-top:12px">This link has <span class="it b">expired</span></h2><p class="sub">${esc(e.message)}</p><a class="btn ghost block" href="#" id="tologin">Go to login</a>`);
    $('#tologin').onclick = (ev) => { ev.preventDefault(); history.replaceState(null, '', location.pathname); showLogin(); };
    return;
  }
  authShell(`<span class="eyebrow">You're invited</span>
    <h2 style="margin-top:12px">Join the Vooads <span class="it b">team</span></h2>
    <p class="sub">You've been invited as <span class="pill brand">${esc(inv.role || 'Staff')}</span> with <b>${esc(inv.email)}</b>.</p>
    <form id="f-inv"><div class="fld"><label for="nm">Your name</label><input class="inp" id="nm" required maxlength="60" autocomplete="name" placeholder="How the team will see you"></div>
    <button class="btn brand block lg" type="submit">Accept invite</button>
    <p class="hint">Next you'll log in with a code sent to ${esc(inv.email)}.</p></form>`);
  $('#nm').focus();
  $('#f-inv').onsubmit = async (e) => {
    e.preventDefault();
    const r = await act(e.target.querySelector('button'), () => POST('/api/admin/invite/' + encodeURIComponent(token), { name: $('#nm').value.trim() }), 'Invite accepted. Log in to continue.');
    if (r) { history.replaceState(null, '', location.pathname); showLogin(); $('#em').value = r.email || inv.email; }
  };
}

// ================= App shell =================
function showApp() {
  const me = S.me, vis = visible();
  const groups = [...new Set(vis.map((s) => s.group))];
  root.innerHTML = `<div class="shell">
    <aside class="side" id="side" aria-label="Admin navigation">
      <div class="brandrow">${LOGO}<span class="lword">Voo<span class="g">ads</span></span><span class="tag">Admin</span></div>
      <nav class="nav">${groups.map((g) => `<h6>${g}</h6>` + vis.filter((s) => s.group === g).map((s) => `<a href="#/${s.id}" data-sec="${s.id}">${ico(s.id)}<span>${s.label}</span>${s.id === 'inbox' ? '<span class="badge" id="sup-badge" hidden></span>' : ''}</a>`).join('')).join('')}
      ${!vis.length ? '<p style="color:#8F897C;font-size:13.5px;padding:10px">Your role has no sections yet. Ask the owner to add permissions.</p>' : ''}</nav>
      <div class="me"><span class="avatar">${esc(initials(me.staff.name || me.staff.email))}</span><div class="who"><b>${esc(me.staff.name || me.staff.email)}</b><span>${esc(me.role?.name || 'No role')}</span></div>
      <button class="iconbtn" id="logout" title="Log out" aria-label="Log out">${ico('logout')}</button></div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main">
      <header class="topbar"><button class="iconbtn" id="burger" aria-label="Open menu">${ico('menu')}</button><span class="t" id="tb-title">Admin</span>${LOGO}</header>
      <main class="page" id="page"></main>
    </div>
  </div>
  <div class="drawer-wrap" id="dw"><div class="bg"></div><aside class="drawer" role="dialog" aria-modal="true"></aside></div>`;
  const side = $('#side'), scrim = $('#scrim');
  const close = () => { side.classList.remove('open'); scrim.classList.remove('on'); };
  $('#burger').onclick = () => { side.classList.add('open'); scrim.classList.add('on'); };
  scrim.onclick = close;
  $$('.nav a').forEach((a) => a.addEventListener('click', close));
  $('#logout').onclick = () => {
    const d = openDrawer({ title: 'Log out', sub: 'End this session, or every admin session you have open.', body: `<div class="stack" style="display:grid;gap:12px"><button class="btn brand block" id="lo1">Log out of this device</button><button class="btn ghost block" id="lo2">Sign out of all devices</button><p class="sub" style="font-size:13.5px">Use "all devices" if you lost a phone or logged in on a shared computer.</p></div>` });
    $('#lo1', d).onclick = async (e) => { await act(e.currentTarget, () => POST('/api/admin/auth/logout'), 'Logged out'); closeDrawer(); S.me = null; showLogin(); };
    $('#lo2', d).onclick = async (e) => { const r = await act(e.currentTarget, () => POST('/api/admin/auth/logout-all'), (x) => 'Signed out of ' + x.ended + ' session' + (x.ended === 1 ? '' : 's')); if (r) { closeDrawer(); S.me = null; showLogin(); } };
  };
  $('#dw .bg').onclick = closeDrawer;
  // Section links route with the history API (embedded webviews can cancel link-driven fragment navigation).
  if (!showApp._wired) {
    showApp._wired = true;
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !S.me) return;
      const a = e.target.closest && e.target.closest('a[href^="#/"]'); if (!a || (a.target && a.target !== '_self')) return;
      e.preventDefault();
      try { history.pushState(null, '', a.getAttribute('href')); } catch { location.hash = a.getAttribute('href'); return; }
      route();
    });
    addEventListener('popstate', () => { if (S.me) route(); });
  }
  window.onhashchange = route;
  route();
  refreshBadge();
}

// Sidebar badge: open tickets (new inbox) or unread chats (classic inbox while the ticket API is not there yet).
async function refreshBadge(counts) {
  const b = $('#sup-badge'); if (!b) return;
  let n = 0, hot = false;
  if (counts) { n = num(counts.open); hot = num(counts.overdue) > 0; }
  else if (can('tickets.view') && S.ticketsApi !== false) {
    const r = await tryGet('/api/admin/tickets?status=open&page=1');
    if (r.ok) { S.ticketsApi = true; n = num(r.data.counts?.open ?? r.data.tickets?.length); hot = num(r.data.counts?.overdue) > 0; }
    else if (r.missing) S.ticketsApi = false;
  }
  if (!n && S.ticketsApi !== true && can('support.reply')) {
    try { n = (await GET('/api/admin/support')).threads.reduce((a, t) => a + (t.unread || 0), 0); } catch {}
  }
  b.hidden = !n; b.textContent = n > 99 ? '99+' : n; b.classList.toggle('soft', !hot);
  b.title = hot ? 'Some tickets are past their reply-time target' : 'Open tickets';
}

function stopTimers() { S.timers.forEach(clearInterval); S.timers = []; S.cleanup.forEach((f) => { try { f(); } catch {} }); S.cleanup = []; }

function route() {
  if (location.hash.startsWith('#invite=')) return boot();
  const vis = visible();
  let id = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
  if (id === 'support') id = 'inbox';
  const sec = vis.find((s) => s.id === id) || vis[0];
  stopTimers(); closeDrawer(); $('.savebar')?.remove(); $$('.modal-wrap').forEach((m) => m.remove());
  const page = $('#page');
  if (!sec) { page.innerHTML = `<div class="card empty">${FACE()}<b>Nothing to see yet</b>Your role doesn't include any admin sections. Ask the owner to update your permissions.</div>`; return; }
  S.section = sec.id;
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.sec === sec.id));
  $('#tb-title').textContent = sec.label;
  document.title = sec.label + ' · Vooads Admin';
  let t = sec.title;
  if (sec.id === 'overview') {
    const h = new Date().getHours();
    const first = S.me.staff.name ? ', ' + S.me.staff.name.split(' ')[0] : '';
    t = ['Good ' + (h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening') + first + '.', 'Here is today.'];
  }
  page.classList.toggle('wide', !!sec.wide); page.classList.remove('thread-open');
  page.innerHTML = `<div class="phead"><div><span class="eyebrow"><i class="live-dot"></i><span id="ph-live">${esc(sec.group)} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></span><h1>${esc(t[0])} <span class="it b">${esc(t[1])}</span></h1><p>${esc(sec.desc)}</p></div><div class="acts" id="acts"></div></div><div id="body"><div class="stack"><div class="card pad"><div class="sk" style="width:40%"></div><div class="sk" style="margin-top:12px"></div><div class="sk" style="margin-top:12px;width:80%"></div></div></div></div>`;
  window.scrollTo({ top: 0 });
  const fn = VIEWS[sec.id];
  Promise.resolve(fn($('#body'), $('#acts'))).catch((e) => {
    if (S.section !== sec.id) return;
    $('#body').innerHTML = isMissing(e) ? naCard() : `<div class="card empty">${FACE()}<b>Couldn't load this page</b>${esc(e.message)}</div>`;
  });
}

// ---------- Drawer & modal ----------
function openDrawer({ title, sub = '', body = '', foot = '' }) {
  const dw = $('#dw'), d = $('.drawer', dw);
  d.innerHTML = `<div class="dh"><div class="grow"><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="iconbtn" data-x aria-label="Close">${ico('x')}</button></div><div class="db">${body}</div>${foot ? `<div class="df">${foot}</div>` : ''}`;
  $('[data-x]', d).onclick = closeDrawer;
  dw.classList.add('on');
  document.addEventListener('keydown', escClose);
  setTimeout(() => $('input:not([type=checkbox]):not([readonly]),textarea', d)?.focus({ preventScroll: true }), 300);
  return d;
}
function closeDrawer() { $('#dw')?.classList.remove('on'); document.removeEventListener('keydown', escClose); }
function escClose(e) { if (e.key === 'Escape' && !$('.modal-wrap')) closeDrawer(); }
function modal({ title, body = '', ok = 'Confirm', okClass = 'brand', cancel = 'Cancel', onOk, cls = '', onClose }) {
  const w = document.createElement('div');
  w.className = 'modal-wrap';
  w.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true"><h3>${title}</h3><div class="body">${body}</div><div class="row end"><button class="btn ghost sm" data-c>${cancel}</button>${ok ? `<button class="btn ${okClass} sm" data-ok>${ok}</button>` : ''}</div></div>`;
  document.body.appendChild(w);
  const close = () => { w.remove(); document.removeEventListener('keydown', k); onClose?.(); };
  const k = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', k);
  w.onclick = (e) => { if (e.target === w) close(); };
  $('[data-c]', w).onclick = close;
  $('[data-ok]', w) && ($('[data-ok]', w).onclick = async (e) => { const r = await onOk?.(w, e.currentTarget); if (r !== false) close(); });
  setTimeout(() => $('input,textarea,select', w)?.focus(), 60);
  return w;
}
const confirmDel = (what, onOk) => modal({ title: 'Delete ' + what + '?', body: '<p>This cannot be undone.</p>', ok: 'Delete', okClass: 'danger', onOk });

const sw = (on, attrs = '') => `<button type="button" class="sw" role="switch" aria-checked="${on ? 'true' : 'false'}" ${attrs}></button>`;
const statusPill = (s) => {
  const m = { active: 'good', paid: 'good', published: 'good', sent: 'good', succeeded: 'good', done: 'good', completed: 'good', pending: 'warn', invited: 'warn', queued: 'warn', running: 'sky', processing: 'sky', draft: 'plain', suspended: 'warn', refunded: 'violet', banned: 'bad', failed: 'bad', disabled: 'bad', cancelled: 'plain', expired: 'plain' };
  return `<span class="pill ${m[s] || 'plain'}">${esc(s || '—')}</span>`;
};
const emptyCard = (t, s) => `<div class="empty">${FACE()}<b>${t}</b>${s || ''}</div>`;
const tbl = (cols, rows, cls = 'cards') => `<div class="tblw"><table class="tbl ${cls}"><thead><tr>${cols.map((c) => `<th class="${c.r ? 'r' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

// ================= Views =================
const VIEWS = {};
// Mail (public/assets/js/admin-mail.js) uses these helpers.
window.VooAdmin = { $, $$, esc, api, GET, POST, PUT, DEL, toast, act, modal, openDrawer, closeDrawer, can, S, fdate, ago, int, money, debounce, copy };
VIEWS.mail = (el, acts) => (window.VooMail ? window.VooMail.view(el, acts) : Promise.reject(Object.assign(new Error('Mail did not load. Refresh the page.'), { status: 500 })));

// ---------- Overview ----------
VIEWS.overview = async (el, acts) => {
  acts.innerHTML = `<button class="btn ghost sm" id="rf">${ico('refresh')} Refresh</button>`;
  $('#rf').onclick = () => route();
  const [d, tk, mg] = await Promise.all([
    GET('/api/admin/overview'),
    can('tickets.view') ? tryGet('/api/admin/tickets?status=open&page=1') : null,
    can('pricing.view') ? tryGet('/api/admin/margins') : null,
  ]);
  const counts = tk?.ok ? (tk.data.counts || {}) : null;
  if (tk?.ok) { S.ticketsApi = true; refreshBadge(counts); }
  const mn = mg?.ok ? normMargins(mg.data) : null;
  const msum = mn ? marginSummary(mn.rows, num(mn.min, 60)) : null;
  const demoKinds = Object.entries(d.demo || {}).filter(([, v]) => v).map(([k]) => k);
  const days = d.days || [];
  const today = days[days.length - 1] || { jobs: 0, signups: 0, revenue: 0 };
  const spark = (vals) => { const mx = Math.max(1, ...vals.map(num)); return `<div class="spark" aria-hidden="true">${vals.map((v, i) => `<i style="--h:${Math.max(7, num(v) / mx * 100).toFixed(0)}%;animation-delay:${i * 35}ms"></i>`).join('')}</div>`; };
  const catSpark = (items) => { const mx = Math.max(1, ...items.map((x) => Math.abs(num(x.v)))); return `<div class="spark cat" aria-hidden="true">${items.map((x, i) => `<i title="${esc(x.t || '')}" style="--h:${Math.max(7, Math.abs(num(x.v)) / mx * 100).toFixed(0)}%;background:${x.c};animation-delay:${i * 45}ms"></i>`).join('')}</div>`; };
  const tickets = counts
    ? { l: 'Open tickets', v: int(counts.open), s: int(counts.pending) + ' pending · ' + int(counts.unassigned) + ' unassigned', href: '#/inbox', spark: catSpark([{ v: counts.open, c: 'var(--brand)', t: 'Open' }, { v: counts.pending, c: 'var(--warn)', t: 'Pending' }, { v: counts.unassigned, c: 'var(--ink)', t: 'Unassigned' }, { v: counts.mine, c: '#A19E95', t: 'Mine' }]) }
    : { l: d.open_tickets != null ? 'Open tickets' : 'Open support chats', v: int(d.open_tickets ?? d.open_support), s: num(d.open_tickets ?? d.open_support) ? 'Waiting for a reply' : 'All caught up', href: can(['tickets.view', 'support.reply']) ? '#/inbox' : '', spark: '' };
  const overdue = counts
    ? { l: 'Overdue tickets', v: int(counts.overdue), s: num(counts.overdue) ? 'Past the reply-time target. Answer these first.' : 'Every ticket is within its reply-time target', href: '#/inbox', alert: num(counts.overdue) > 0, spark: catSpark([{ v: Math.max(num(counts.overdue), .2), c: num(counts.overdue) ? 'var(--bad)' : 'var(--good)' }]) }
    : d.overdue_tickets != null ? { l: 'Overdue tickets', v: int(d.overdue_tickets), s: num(d.overdue_tickets) ? 'Past the reply-time target' : 'Every ticket is within its target', alert: num(d.overdue_tickets) > 0, spark: '' }
    : { l: 'Overdue tickets', v: '—', s: 'Shows up when the ticket inbox is switched on', spark: '' };
  const margin = msum
    ? { l: 'Margin health', v: msum.loss ? msum.loss + ' at a loss' : msum.low ? msum.low + ' running low' : 'All safe', s: msum.total + ' job types checked · lowest ' + (msum.worst == null ? '—' : Math.round(msum.worst) + '%'), href: '#/guard', alert: msum.loss > 0, spark: catSpark(msum.rows.slice(0, 16).map((x) => ({ v: Math.max(Math.abs(num(x.margin)), 4), c: x.status === 'loss' ? 'var(--bad)' : x.status === 'low' ? 'var(--warn)' : 'var(--good)', t: x.name + ' ' + Math.round(num(x.margin)) + '%' }))) }
    : { l: 'Margin health', v: '—', s: can('pricing.view') ? 'The profit guard switches on with the server update' : 'Needs pricing access', href: can('pricing.view') ? '#/guard' : '', spark: '' };
  const kpis = [
    { l: 'Revenue, last 30 days', v: money(d.revenue_30d), s: 'MRR ' + money(d.mrr) + ' · today ' + money(today.revenue), hero: true, spark: spark(days.map((x) => x.revenue)) },
    { l: 'Jobs today', v: int(today.jobs), s: int(d.jobs_30d) + ' in 30 days · ' + (d.failed_30d ? int(d.failed_30d) + ' failed' : 'none failed'), spark: spark(days.map((x) => x.jobs)) },
    { l: 'Customers', v: int(d.users), s: int(d.paying) + ' paying · ' + int(today.signups) + ' joined today', spark: spark(days.map((x) => x.signups)) },
    tickets, overdue, margin,
  ];
  const max = Math.max(1, ...days.map((x) => x.revenue));
  const maxJ = Math.max(1, ...days.map((x) => Math.max(x.signups, x.jobs)));
  const W = 700, H = 200, bw = W / Math.max(1, days.length);
  const bars = days.map((x, i) => { const h = Math.max(2, (x.revenue / max) * (H - 30)); return `<rect class="bar" x="${i * bw + bw * .2}" y="${H - 18 - h}" width="${bw * .6}" height="${h}" rx="5" style="animation-delay:${i * 30}ms"><title>${x.day}: ${money(x.revenue)}</title></rect>`; }).join('');
  const line = (k) => days.map((x, i) => `${i ? 'L' : 'M'}${(i * bw + bw / 2).toFixed(1)},${(H - 18 - (x[k] / maxJ) * (H - 40)).toFixed(1)}`).join(' ');
  const labels = days.map((x, i) => i % 2 ? '' : `<text x="${i * bw + bw / 2}" y="${H - 2}" text-anchor="middle" font-size="11" font-family="JetBrains Mono, monospace" fill="#A19E95">${x.day.slice(5).replace('-', '/')}</text>`).join('');
  el.innerHTML = `<div class="stack">
    <div class="kpis six stagger">${kpis.map((k, i) => `<div class="card kpi ${k.hero ? 'hero' : ''}" style="--i:${i};${k.alert ? 'border-color:#F2C2BB;box-shadow:0 0 0 3px var(--bad-bg)' : ''}">${k.href ? `<a class="more" href="${k.href}" aria-label="Open ${esc(k.l)}">${ico('arrow')}</a>` : ''}<div class="l">${esc(k.l)}</div><div class="v">${esc(k.v)}</div><div class="s">${esc(k.s)}</div>${k.spark || ''}</div>`).join('')}</div>
    <div class="status-strip stagger">
      <a href="#/providers" style="--i:1"><div class="card stat"><span class="ic" style="background:${demoKinds.length ? 'var(--warn-bg);color:var(--warn)' : 'var(--good-bg);color:var(--good)'}">${ico('providers')}</span><div><b>${demoKinds.length ? 'AI in demo mode for ' + demoKinds.length + ' job' + (demoKinds.length > 1 ? 's' : '') : 'AI providers are live'}</b><span>${demoKinds.length ? 'Add keys for: ' + demoKinds.join(', ') : 'Every job type has a working provider'}</span></div></div></a>
      <a href="#/methods" style="--i:2"><div class="card stat"><span class="ic" style="background:${d.payments_live ? 'var(--good-bg);color:var(--good)' : 'var(--bad-bg);color:var(--bad)'}">${ico('methods')}</span><div><b>${d.payments_live ? 'Payments are on' : 'No payment method is on'}</b><span>${d.payments_live ? 'Customers can check out' : 'Turn one on so customers can pay'}</span></div></div></a>
      <a href="#/emails" style="--i:3"><div class="card stat"><span class="ic" style="background:${d.email_live ? 'var(--good-bg);color:var(--good)' : 'var(--warn-bg);color:var(--warn)'}">${ico('mail')}</span><div><b>${d.email_live ? 'Emails are sending' : 'Emails are not sending'}</b><span>${d.email_live ? 'Connected to Resend' : 'Set RESEND_API_KEY on the server. Emails print to the server log for now.'}</span></div></div></a>
    </div>
    <div class="grid2">
      <div class="card"><div class="card-h"><div><h3>Revenue</h3><p>Paid checkouts per day, last 14 days</p></div><b class="num mono">${money(days.reduce((a, x) => a + x.revenue, 0))}</b></div>
        <div class="card-b"><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Revenue per day">${bars}${labels}</svg></div></div>
      <div class="card"><div class="card-h"><div><h3>Sign-ups and jobs</h3><p>Per day, last 14 days</p></div><div class="legend"><span><i style="background:var(--ink)"></i>Sign-ups</span><span><i style="background:var(--brand)"></i>Jobs</span></div></div>
        <div class="card-b"><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Sign-ups and jobs per day"><path class="ln" d="${line('signups')}" stroke="#0B0B0A" vector-effect="non-scaling-stroke"/><path class="ln" d="${line('jobs')}" stroke="#FF4A1C" vector-effect="non-scaling-stroke" style="animation-delay:.2s"/>${labels}</svg></div></div>
    </div>
    <div class="card"><div class="card-h"><div><h3>Latest payments</h3><p>Est. AI spend in the last 30 days: <b>${money(d.est_ai_cost_30d)}</b></p></div>${can('payments.view') ? '<a class="btn ghost xs" href="#/payments">See all</a>' : ''}</div>
      ${d.recent_payments.length ? tbl([{ t: 'Customer' }, { t: 'What' }, { t: 'Amount', r: 1 }, { t: 'Status' }, { t: 'When' }], d.recent_payments.map((p) => `<tr><td class="lead" data-l="Customer">${esc(p.email || '—')}</td><td data-l="What">${esc(p.kind === 'plan' ? 'Plan · ' + (p.plan_id || '') : p.kind || '—')}<span class="sub">${esc(p.adapter || '')}</span></td><td class="r num" data-l="Amount">${money(p.amount_usd)}</td><td data-l="Status">${statusPill(p.status)}</td><td data-l="When" class="nowrap">${ago(p.created_at)}</td></tr>`)) : emptyCard('No payments yet', 'They will show up here the moment someone checks out.')}
    </div>
  </div>`;
};

// ---------- Customers ----------
VIEWS.customers = async (el) => {
  const st = { q: '', status: '', offset: 0, rows: [] };
  el.innerHTML = `<div class="card">
    <div class="card-h"><div class="row grow" style="gap:10px">
      <div class="grow" style="position:relative;min-width:200px"><span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);width:17px;color:var(--mut2)">${ico('search')}</span><input class="inp sm" id="q" type="search" placeholder="Search by email or name" style="padding-left:38px"></div>
      <div class="seg" id="stf"><button class="on" data-s="">All</button><button data-s="active">Active</button><button data-s="suspended">Suspended</button><button data-s="banned">Banned</button></div>
    </div><span class="hint" id="tot"></span></div>
    <div id="list"></div><div class="card-b" id="more" hidden style="text-align:center"><button class="btn ghost sm">Load more</button></div></div>`;
  const load = async (append) => {
    if (!append) st.offset = 0;
    const r = await GET(`/api/admin/users?q=${encodeURIComponent(st.q)}&status=${st.status}&limit=50&offset=${st.offset}`);
    st.rows = append ? st.rows.concat(r.users) : r.users;
    $('#tot').textContent = int(r.total) + ' customers in total';
    $('#more').hidden = r.users.length < 50;
    $('#list').innerHTML = st.rows.length ? tbl([{ t: 'Customer' }, { t: 'Plan' }, { t: 'Credits', r: 1 }, { t: 'Status' }, { t: 'Joined' }, { t: 'Last seen' }], st.rows.map((u) => `<tr class="click" data-id="${u.id}"><td class="lead" data-l="Customer"><b>${esc(u.email)}</b><span class="sub">${esc(u.name || 'No name')}${u.country ? ' · ' + esc(u.country) : ''}</span></td>
      <td data-l="Plan">${u.plan_active ? `<span class="pill ink">${esc(u.plan_id)}</span>` : '<span class="pill plain">Free</span>'}</td>
      <td class="r num" data-l="Credits"><b>${int((u.plan_active ? u.plan_credits : 0) + u.topup_credits + u.trial_credits)}</b></td>
      <td data-l="Status">${statusPill(u.status)}</td><td data-l="Joined" class="nowrap">${ago(u.created_at)}</td><td data-l="Last seen" class="nowrap">${ago(u.last_seen_at)}</td></tr>`)) : emptyCard('No customers found', st.q ? 'Try a different search.' : 'Customers appear here after they sign up.');
    $$('#list tr[data-id]').forEach((tr) => tr.onclick = () => customerDrawer(tr.dataset.id, () => load()));
  };
  $('#q').oninput = debounce((e) => { st.q = e.target.value.trim(); load().catch((x) => toast(x.message, true)); });
  $$('#stf button').forEach((b) => b.onclick = () => { $$('#stf button').forEach((x) => x.classList.toggle('on', x === b)); st.status = b.dataset.s; load().catch((x) => toast(x.message, true)); });
  $('#more button').onclick = (e) => { st.offset += 50; act(e.currentTarget, () => load(true)); };
  await load();
};

async function getPlans() {
  if (!can('pricing.view')) return null;
  try { return (await GET('/api/admin/pricing')).pricing.plans; } catch { return null; }
}

async function customerDrawer(id, onChange) {
  const d = openDrawer({ title: 'Loading…', body: '<div class="sk"></div><div class="sk" style="margin-top:12px;width:70%"></div>' });
  let r, plans;
  try { [r, plans] = await Promise.all([GET('/api/admin/users/' + id), getPlans()]); }
  catch (e) { $('.db', d).innerHTML = `<div class="note bad">${esc(e.message)}</div>`; return; }
  const u = r.user, b = u.balance;
  const limit = S.me.role?.limits?.max_credit_grant;
  const planActive = b.planActive;
  const body = `
    <div class="bal stagger"><div style="--i:0"><span>Total</span><b>${int(b.total)}</b></div><div style="--i:1"><span>Plan</span><b>${int(b.plan)}</b></div><div style="--i:2"><span>Top-up</span><b>${int(b.topup)}</b></div><div style="--i:3"><span>Trial</span><b>${int(b.trial)}</b></div></div>
    <div class="row" style="margin-top:12px;gap:6px">${statusPill(u.status)} ${planActive ? `<span class="pill ink">${esc(u.plan_id)} · ${esc(u.plan_period || 'month')}</span><span class="pill plain">renews ${ago(u.plan_expires_at)}</span>` : '<span class="pill plain">No active plan</span>'} ${u.auto_renew ? '<span class="pill good">Auto-renew on</span>' : ''} ${u.voo_id ? '<span class="pill sky">Voo ID</span>' : ''}</div>
    ${u.ban_reason ? `<div class="note warn" style="margin-top:12px"><b>Reason on file:</b> ${esc(u.ban_reason)}</div>` : ''}
    <div class="tabs" style="margin-top:20px" id="ctabs"><button class="on" data-t="acc">Account</button><button data-t="cr">Credits</button><button data-t="jobs">Jobs (${r.jobs.length})</button>${can('payments.view') ? `<button data-t="pay">Payments (${r.payments.length})</button>` : ''}</div>
    <div data-p="acc">
      <div class="fields">
        <div class="fld"><label>Name</label><input class="inp sm" id="c-name" value="${esc(u.name || '')}" ${can('users.edit') ? '' : 'readonly'}></div>
        <div class="fld"><label>Country</label><input class="inp sm" id="c-country" value="${esc(u.country || '')}" maxlength="2" placeholder="NG" ${can('users.edit') ? '' : 'readonly'}></div>
        ${can('users.edit') ? `<div class="fld"><label>Plan</label>${plans ? `<select class="inp sm" id="c-plan"><option value="">No plan</option>${plans.map((p) => `<option value="${esc(p.id)}" ${planActive && u.plan_id === p.id ? 'selected' : ''}>${esc(p.name)} · ${money(p.price_month)}/mo</option>`).join('')}</select>` : `<input class="inp sm" id="c-plan" value="${esc(planActive ? u.plan_id : '')}" placeholder="plan id, or blank">`}<small>Changing the plan starts it today with fresh plan credits.</small></div>
        <div class="fld"><label>Billing period</label><select class="inp sm" id="c-period"><option value="month">Monthly</option><option value="year" ${u.plan_period === 'year' ? 'selected' : ''}>Yearly</option></select></div>
        <div class="full row end"><button class="btn solid sm" id="c-save">Save changes</button></div>` : ''}
      </div>
      <div class="dsec"><h4>Details</h4><div class="list">
        <div class="li"><span class="muted">Customer ID</span><span class="num">#${u.id}</span></div>
        <div class="li"><span class="muted">Joined</span><span>${fdate(u.created_at)}</span></div>
        <div class="li"><span class="muted">Last seen</span><span>${ago(u.last_seen_at)}</span></div>
        <div class="li"><span class="muted">Referral code</span><span class="k">${esc(u.ref_code || '—')}</span></div>
        <div class="li"><span class="muted">Referred by</span><span>${esc(u.referred_by || '—')}</span></div>
        <div class="li"><span class="muted">Marketing emails</span><span>${u.marketing_opt_in ? 'Subscribed' : 'Unsubscribed'}</span></div>
        <div class="li"><span class="muted">People they referred</span><span>${r.referred.length}</span></div>
      </div>${r.referred.length ? `<div class="list">${r.referred.map((x) => `<div class="li"><span>${esc(x.email)}</span><small class="muted">${ago(x.created_at)}</small></div>`).join('')}</div>` : ''}</div>
      ${u.brand ? `<div class="dsec"><h4>Brand kit</h4><pre class="k" style="display:block;white-space:pre-wrap;padding:10px">${esc(JSON.stringify(u.brand, null, 2))}</pre></div>` : ''}
      ${can('users.ban') ? `<div class="dsec"><h4>Account access</h4><div class="row">
        ${u.status !== 'active' ? '<button class="btn ghost sm" data-st="active">Reactivate account</button>' : ''}
        ${u.status !== 'suspended' ? '<button class="btn ghost sm" data-st="suspended">Suspend</button>' : ''}
        ${u.status !== 'banned' ? '<button class="btn dghost sm" data-st="banned">Ban customer</button>' : ''}</div>
        <p class="hint" style="margin-top:8px">Suspend pauses the account while you review it. Ban is permanent and removes all credits.</p></div>` : ''}
    </div>
    <div data-p="cr" hidden>
      ${can('users.credits') ? `<div class="card pad" style="background:var(--soft)"><div class="fields">
        <div class="fld"><label>Credits</label><input class="inp sm" id="g-amt" type="number" step="1" placeholder="e.g. 100 or -50"><small>${limit !== undefined && !can('*') ? 'Your role can give up to ' + int(limit) + ' at a time.' : 'Use a minus number to remove credits.'}</small></div>
        <div class="fld"><label>Bucket</label><select class="inp sm" id="g-bucket"><option value="topup">Top-up (never expires)</option><option value="plan">Plan (resets on renewal)</option><option value="trial">Trial</option></select></div>
        <div class="fld full"><label>Reason</label><input class="inp sm" id="g-reason" maxlength="120" placeholder="e.g. Refund for failed video #123"><small>Saved in the ledger and the activity log.</small></div>
        <div class="full row end"><button class="btn brand sm" id="g-go">${ico('plus')} Apply credits</button></div></div></div>` : ''}
      <div class="dsec"><h4>Credit ledger</h4>${r.ledger.length ? `<div class="list">${r.ledger.map((l) => `<div class="li"><div class="m">${esc(l.reason || '—')}<small>${esc(l.bucket || '')} · ${fdate(l.created_at)}</small></div><span class="${l.delta >= 0 ? 'pos' : 'neg'} num">${l.delta >= 0 ? '+' : ''}${int(l.delta)}</span></div>`).join('')}</div>` : '<p class="muted">No credit movements yet.</p>'}</div>
    </div>
    <div data-p="jobs" hidden>${r.jobs.length ? `<div class="list">${r.jobs.map((j) => `<div class="li"><div class="m"><b>#${j.id} · ${esc(j.type)}</b> ${j.demo ? '<span class="pill warn">demo</span>' : ''}<small>${fdate(j.created_at)}${j.error ? ' · <span style="color:var(--bad)">' + esc(j.error) + '</span>' : ''}</small></div><div class="row" style="gap:8px;flex-wrap:nowrap"><span class="num muted">${int(j.credits)} cr</span>${statusPill(j.status)}</div></div>`).join('')}</div>` : '<p class="muted">No jobs yet.</p>'}</div>
    <div data-p="pay" hidden>${r.payments.length ? `<div class="list">${r.payments.map((p) => `<div class="li"><div class="m"><b>${money(p.amount_usd)}</b> · ${esc(p.kind === 'plan' ? 'Plan ' + (p.plan_id || '') : 'Top-up ' + (p.topup_id || ''))}<small>${esc(p.adapter || '')} · ${fdate(p.created_at)}${p.discount_code ? ' · code ' + esc(p.discount_code) : ''}</small></div>${statusPill(p.status)}</div>`).join('')}</div>` : '<p class="muted">No payments yet.</p>'}</div>`;
  d.querySelector('.dh').innerHTML = `<span class="avatar" style="width:44px;height:44px;border-radius:14px;font-size:15px">${esc(initials(u.name || u.email))}</span><div class="grow"><h2>${esc(u.name || u.email)}</h2><p>${esc(u.email)}</p></div><button class="iconbtn" data-x aria-label="Close">${ico('x')}</button>`;
  $('[data-x]', d).onclick = closeDrawer;
  $('.db', d).innerHTML = body;
  $$('#ctabs button', d).forEach((t) => t.onclick = () => { $$('#ctabs button', d).forEach((x) => x.classList.toggle('on', x === t)); $$('[data-p]', d).forEach((p) => p.hidden = p.dataset.p !== t.dataset.t); });
  window.VooMail?.attachUserTab(d, u.id); // Mail tab: preferences, tags and every email this customer got
  const reload = () => { customerDrawer(id, onChange); onChange?.(); };
  $('#c-save', d) && ($('#c-save', d).onclick = async (e) => {
    const bodyU = { name: $('#c-name', d).value.trim(), country: $('#c-country', d).value.trim() };
    const plan = $('#c-plan', d).value.trim();
    const cur = planActive ? u.plan_id : '';
    if (plan !== cur || (plan && $('#c-period', d).value !== (u.plan_period || 'month'))) { bodyU.plan_id = plan; bodyU.period = $('#c-period', d).value; }
    if (await act(e.currentTarget, () => PUT('/api/admin/users/' + id, bodyU), 'Customer updated')) reload();
  });
  $('#g-go', d) && ($('#g-go', d).onclick = async (e) => {
    const r2 = await act(e.currentTarget, () => POST(`/api/admin/users/${id}/credits`, { amount: Number($('#g-amt', d).value), bucket: $('#g-bucket', d).value, reason: $('#g-reason', d).value.trim() }), (x) => (x.applied >= 0 ? 'Added ' : 'Removed ') + int(Math.abs(x.applied)) + ' credits. New total ' + int(x.balance.total));
    if (r2) { reload(); setTimeout(() => $('#ctabs [data-t=cr]')?.click(), 50); }
  });
  $$('[data-st]', d).forEach((bt) => bt.onclick = () => {
    const s = bt.dataset.st;
    if (s === 'active') return act(bt, () => POST(`/api/admin/users/${id}/status`, { status: 'active' }), 'Account reactivated').then((x) => x && reload());
    const ban = s === 'banned';
    modal({
      title: ban ? 'Ban ' + esc(u.email) + '?' : 'Suspend ' + esc(u.email) + '?',
      body: (ban ? `<div class="note bad"><b>This is permanent.</b> All ${int(b.total)} credits are forfeited and <b>no refund</b> is given, as the Terms say. They are logged out everywhere and get an email with your reason.</div>` : '<p>They can\'t use the studio until you reactivate them. Their credits are kept.</p>')
        + `<div class="fld"><label>Reason (the customer sees this)</label><textarea class="inp" id="m-reason" maxlength="300" rows="3" placeholder="${ban ? 'e.g. Repeated attempts to make prohibited ads' : 'e.g. We are reviewing unusual payment activity'}"></textarea></div>`
        + (ban ? '' : '<label class="chk"><input type="checkbox" id="m-notify" checked><span>Email the customer a warning</span></label>'),
      ok: ban ? 'Ban and forfeit credits' : 'Suspend account', okClass: ban ? 'danger' : 'solid',
      onOk: async (w, btn) => {
        const reason = $('#m-reason', w).value.trim();
        const r3 = await act(btn, () => POST(`/api/admin/users/${id}/status`, { status: s, reason, ...(ban ? {} : { notify: $('#m-notify', w).checked }) }), ban ? 'Customer banned' : 'Account suspended');
        if (!r3) return false; reload();
      },
    });
  });
}

// ---------- Payments ----------
VIEWS.payments = async (el) => {
  const r = await GET('/api/admin/payments?limit=500');
  const st = { f: '', q: '' };
  const counts = r.payments.reduce((a, p) => ((a[p.status] = (a[p.status] || 0) + 1), a), {});
  const paid = r.payments.filter((p) => p.status === 'paid').reduce((a, p) => a + num(p.amount_usd), 0);
  el.innerHTML = `<div class="stack"><div class="kpis stagger">
      <div class="card kpi hero" style="--i:0"><div class="l">Paid (latest 500)</div><div class="v">${money(paid)}</div><div class="s">${int(counts.paid || 0)} payments</div></div>
      <div class="card kpi" style="--i:1"><div class="l">Pending</div><div class="v">${int(counts.pending || 0)}</div><div class="s">Started checkout, not finished</div></div>
      <div class="card kpi" style="--i:2"><div class="l">Refunded</div><div class="v">${int(counts.refunded || 0)}</div><div class="s">Marked by staff</div></div>
      <div class="card kpi" style="--i:3"><div class="l">Failed</div><div class="v">${int(counts.failed || 0)}</div><div class="s">Declined or errored</div></div></div>
    <div id="bsubs"></div>
    <div class="card"><div class="card-h"><div class="seg" id="pf"><button class="on" data-s="">All</button>${Object.keys(counts).map((k) => `<button data-s="${esc(k)}">${esc(k[0].toUpperCase() + k.slice(1))} <span class="muted">${counts[k]}</span></button>`).join('')}</div>
      <input class="inp sm" id="pq" type="search" placeholder="Search email or reference" style="max-width:280px"></div><div id="plist"></div></div></div>`;
  const draw = () => {
    const q = st.q.toLowerCase();
    const rows = r.payments.filter((p) => (!st.f || p.status === st.f) && (!q || String(p.email || '').toLowerCase().includes(q) || String(p.provider_ref || '').toLowerCase().includes(q) || String(p.id) === q));
    $('#plist').innerHTML = rows.length ? tbl([{ t: '#' }, { t: 'Customer' }, { t: 'What' }, { t: 'Amount', r: 1 }, { t: 'Method' }, { t: 'Status' }, { t: 'Date' }, { t: '' }], rows.map((p) => `<tr>
      <td data-l="#" class="num muted">${p.id}</td><td class="lead" data-l="Customer"><b>${esc(p.email || '—')}</b>${p.provider_ref ? `<span class="sub k" style="display:inline-block;margin-top:4px">${esc(p.provider_ref)}</span>` : ''}</td>
      <td data-l="What">${esc(p.kind === 'plan' ? 'Plan · ' + (p.plan_id || '') + (p.period ? ' (' + p.period + ')' : '') : 'Top-up' + (p.topup_id ? ' · ' + p.topup_id : ''))}<span class="sub">${int(p.credits)} credits${p.discount_code ? ' · ' + esc(p.discount_code) : ''}</span></td>
      <td class="r num" data-l="Amount"><b>${money(p.charged_usd || p.amount_usd)}</b>${Number(p.fee_usd) > 0 ? `<br><small class="hint">base ${money(p.amount_usd)} + fee ${money(p.fee_usd)} (${esc(p.fee_pct)}%)</small>` : ''}</td><td data-l="Method">${esc(p.adapter || '—')}</td><td data-l="Status">${statusPill(p.status)}</td>
      <td data-l="Date" class="nowrap">${fdate(p.paid_at || p.created_at)}</td>
      <td data-l="" class="r">${p.status === 'paid' && can('payments.refund') ? `<button class="btn ghost xs" data-ref="${p.id}">Mark refunded</button> <button class="btn ghost xs" data-cb="${p.id}">Chargeback</button>` : p.refund_kind === 'chargeback' ? '<span class="sub">charged back</span>' : ''}</td></tr>`)) : emptyCard('No payments here', 'Try another filter.');
    const ask = (p, kind) => modal({
      title: (kind === 'chargeback' ? 'Record a chargeback on payment #' : 'Mark payment #') + p.id + (kind === 'chargeback' ? '?' : ' refunded?'), ok: kind === 'chargeback' ? 'Record chargeback' : 'Mark refunded', okClass: 'solid',
      body: `<p>${money(p.amount_usd)} from ${esc(p.email || 'unknown')}.${kind === 'chargeback' ? ' Use this when the card issuer or provider took the money back. VooSquare reverses the affiliate commission on it.' : ' This only updates Vooads. <b>Send the money back in the ' + esc(p.adapter || 'payment') + ' dashboard yourself.</b>'}</p><p class="hint">${p.kind === 'plan' ? 'If this payment pays for the current plan, the plan ends now and its remaining credits are removed.' : 'The pack\'s unused credits are removed.'} Credits already used are recorded, never taken below zero.</p>${kind === 'chargeback' ? '<div class="fld"><label>Dispute reference (optional)</label><input class="inp sm" id="m-cbref" maxlength="120"></div>' : ''}`,
      onOk: async (w, btn) => {
        const x = await act(btn, () => POST(`/api/admin/payments/${p.id}/${kind}`, kind === 'chargeback' ? { ref: ($('#m-cbref', w) || {}).value || undefined } : {}), (y) => y.note || (kind === 'chargeback' ? 'Chargeback recorded' : 'Marked refunded'));
        if (!x) return false; p.status = 'refunded'; p.refund_kind = kind; draw();
      },
    });
    $$('[data-ref]').forEach((b) => b.onclick = () => ask(r.payments.find((x) => x.id === Number(b.dataset.ref)), 'refund'));
    $$('[data-cb]').forEach((b) => b.onclick = () => ask(r.payments.find((x) => x.id === Number(b.dataset.cb)), 'chargeback'));
  };
  $$('#pf button').forEach((b) => b.onclick = () => { $$('#pf button').forEach((x) => x.classList.toggle('on', x === b)); st.f = b.dataset.s; draw(); });
  $('#pq').oninput = debounce((e) => { st.q = e.target.value.trim(); draw(); }, 150);
  draw();
  // Bachs card auto-renew: status, next charge, failures and price flags.
  GET('/api/admin/bachs/subscriptions').then((b) => {
    if (!b || (!b.subscriptions.length && !b.unavailable)) return;
    const lm = (c, n) => n === null || n === undefined ? '—' : (c === 'NGN' ? '₦' + Number(n).toLocaleString('en-US') : money(n));
    $('#bsubs').innerHTML = `<div class="card"><div class="card-h"><b>Card auto-renew (Bachs)</b><span class="muted">${b.enabled ? 'On' : 'Off'}${b.unavailable ? ' · Bachs refused recurring: ' + esc(b.unavailable.reason || '') + ' (one-off payments used)' : ''}</span></div>
      ${b.subscriptions.length ? tbl([{ t: 'Customer' }, { t: 'Plan' }, { t: 'Status' }, { t: 'Next charge' }, { t: 'Amount', r: 1 }, { t: 'Failures' }, { t: 'Notes' }], b.subscriptions.map((x) => `<tr>
        <td class="lead" data-l="Customer"><b>${esc(x.email || '—')}</b><span class="sub k">${esc(x.sub_id || '')}</span></td><td data-l="Plan">${esc(x.plan_id)} (${esc(x.period)})</td>
        <td data-l="Status">${statusPill(x.cancel_at_period_end ? 'cancelling' : x.status)}</td><td data-l="Next charge" class="nowrap">${x.cancel_at_period_end ? '—' : fdate(x.next_charge_at)}</td>
        <td class="r num" data-l="Amount">${lm(x.currency, x.amount_local)}${x.next_amount_local ? `<br><small class="hint">next ${lm(x.currency, x.next_amount_local)}</small>` : ''}</td>
        <td data-l="Failures">${int(x.fail_count)}${x.last_failure ? `<span class="sub">${esc(x.last_failure)}</span>` : ''}${x.grace_until ? `<span class="sub">grace until ${fdate(x.grace_until)}</span>` : ''}</td>
        <td data-l="Notes">${esc(x.flag || x.price_move || '')}</td></tr>`)) : ''}
      ${b.flagged.length ? `<p class="hint" style="margin-top:10px"><b>Flagged renewals:</b> ${b.flagged.map((f) => '#' + f.id + ' ' + esc(f.review_flag)).join('<br>')}</p>` : ''}</div>`;
  }).catch(() => {});
};

// ---------- Support inbox (tickets) ----------
const PRIOS = ['urgent', 'high', 'normal', 'low'];
const TSTATUS = { open: 'Open', pending: 'Pending', solved: 'Solved', closed: 'Closed' };
const TCATS = { billing: 'Billing', video: 'Video', account: 'Account', bug: 'Bug', call: 'Callback', other: 'Other' };
const TCHAN = { web: 'In app', email: 'Email', voosquare: 'VooSquare' };
const IVIEWS = [
  { id: 'open', l: 'Open', ic: 'inbox', q: { status: 'open' }, empty: ['Inbox zero', 'Nothing open right now. New tickets appear here on their own.'] },
  { id: 'pending', l: 'Pending', ic: 'clock', q: { status: 'pending' }, empty: ['Nothing pending', 'Tickets waiting on the customer show here.'] },
  { id: 'mine', l: 'Mine', ic: 'user', q: { assignee: 'me' }, active: 1, empty: ['Nothing assigned to you', 'Pick a ticket and set yourself as owner.'] },
  { id: 'unassigned', l: 'Unassigned', ic: 'userplus', q: { assignee: 'none' }, active: 1, empty: ['Everything has an owner', 'New tickets without an owner land here.'] },
  { id: 'overdue', l: 'Overdue', ic: 'alert', q: { overdue: '1' }, active: 1, hot: 1, empty: ['Nothing overdue', 'Every ticket is inside its reply-time target.'] },
  { id: 'solved', l: 'Solved', ic: 'check', q: { status: 'solved' }, empty: ['No solved tickets yet', 'Solved tickets stay here for reference.'] },
  { id: 'calls', l: 'Calls', ic: 'phone', q: { category: 'call' }, active: 1, empty: ['No callback requests', 'When a customer asks for a call, it shows here with their number and best time.'] },
];
const isActiveT = (t) => !['solved', 'closed'].includes(t.status);
const firstName = (n) => String(n || '').trim().split(/[\s@]+/)[0] || 'there';
const durTxt = (m) => m < 60 ? Math.max(1, Math.round(m)) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd';
const isLate = (t) => { const d = parseDate(t.sla_due_at); return !!d && t.status === 'open' && d < Date.now(); };
function tnorm(t) {
  const u = t.user || t.customer || {};
  const lc = parseDate(t.last_customer_at), ls = parseDate(t.last_staff_at);
  return {
    ...t,
    who: t.user_name || t.customer_name || t.name || u.name || t.user_email || t.email || u.email || 'Customer #' + (t.user_id ?? '?'),
    email: t.user_email || t.email || u.email || '',
    assignee: t.assignee_name || t.assignee_staff_name || t.assignee_ext_name || '',
    ext: !t.assignee_staff_id && !!t.assignee_ext_name,
    snippet: t.last_body || (t.last_message && typeof t.last_message === 'object' ? t.last_message.body : t.last_message) || t.preview || t.snippet || '',
    snipBy: t.last_message && typeof t.last_message === 'object' ? t.last_message.author_type : '',
    waiting: t.unread != null ? !!Number(t.unread) || t.unread === true : t.last_message?.author_type ? t.last_message.author_type === 'customer' : !!(lc && (!ls || lc > ls)),
  };
}
function slaBadge(t) {
  if (t.status !== 'open') return '';
  const d = parseDate(t.sla_due_at); if (!d) return '';
  const m = (d - Date.now()) / 60000;
  if (m < 0) return `<span class="sla late" title="Reply-time target passed ${esc(fdate(t.sla_due_at))}">${ico('clock')}Late ${durTxt(-m)}</span>`;
  return `<span class="sla ${m < 120 ? 'soon' : 'ok'}" title="Reply-time target ${esc(fdate(t.sla_due_at))}">${ico('clock')}Due ${durTxt(m)}</span>`;
}
const prBadge = (p) => p ? `<span class="pr ${esc(p)}">${esc(p)}</span>` : '';
const stDot = (s) => `<span class="st-dot st-${esc(s)}">${esc(TSTATUS[s] || s || '—')}</span>`;
const linkify = (h) => h.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const attList = (a) => { let x = a; if (typeof x === 'string') { try { x = JSON.parse(x); } catch { x = []; } } return Array.isArray(x) ? x.map((y) => typeof y === 'string' ? { url: y, name: y.split('/').pop() } : { url: y.url || y.path, name: y.title || y.name || String(y.url || y.path || '').split('/').pop(), kind: y.type }).filter((y) => y.url) : []; };
const dayLabel = (s) => { const d = parseDate(s); if (!d) return ''; const t = new Date(); const y = new Date(Date.now() - 864e5); if (d.toDateString() === t.toDateString()) return 'Today'; if (d.toDateString() === y.toDateString()) return 'Yesterday'; return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
const fillMacro = (body, ctx) => String(body || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => ({ name: ctx.first, first_name: ctx.first, customer: ctx.first, agent: ctx.agent, agent_name: ctx.agent, ticket_id: ctx.id, email: ctx.email, subject: ctx.subject }[k] ?? m));

VIEWS.inbox = async (el, acts) => {
  const first = await tryGet('/api/admin/tickets?status=open&page=1');
  if (!first.ok) {
    if (!first.missing) throw first.error;
    S.ticketsApi = false;
    if (can('support.reply')) return legacySupport(el, acts, true);
    el.innerHTML = naCard('The ticket inbox is not switched on yet', 'Tickets, notes, owners and reply-time targets appear here as soon as the server update lands.');
    return;
  }
  S.ticketsApi = true;
  const me = S.me.staff, lim = S.me.role?.limits || {};
  const scopeAssigned = (first.data.scope || lim.ticket_scope) === 'assigned' && !can('*');
  const st = { view: S.ibxView || 'open', q: '', prio: '', list: [], counts: first.data.counts || {}, cur: null, detail: null, staff: [], macros: null, note: false, drafts: {}, ro: false, seen: new Set() };
  if (scopeAssigned && st.view === 'unassigned') st.view = 'mine';
  const views = IVIEWS.filter((v) => !(scopeAssigned && v.id === 'unassigned'));
  const canReply = can('tickets.reply') || can('tickets.manage');
  const canAssign = can('tickets.assign') || can('tickets.manage');
  let canGive = can('users.credits');
  let grantMax = can('*') ? null : (lim.max_credit_grant ?? null);

  // Read-only when support runs in VooSquare.
  const modeOf = (x) => x && (x.voosquare_mode || x.mode || (x.voosquare && (x.voosquare.enabled === false ? 'vooads' : x.voosquare.mode)));
  let mode = modeOf(first.data);
  if (!mode && first.data.read_only == null) { const ss = await tryGet('/api/admin/support-settings'); if (ss.ok) mode = modeOf(ss.data.settings || ss.data); }
  st.ro = first.data.read_only != null ? !!first.data.read_only : mode === 'voosquare';
  // Staff list for the owner picker.
  if (Array.isArray(first.data.staff || first.data.agents)) st.staff = (first.data.staff || first.data.agents);
  else if (can('staff.view') && canAssign) { const sr = await tryGet('/api/admin/staff'); if (sr.ok) st.staff = sr.data.staff.filter((x) => x.status === 'active'); }
  if (!st.staff.find((x) => x.id === me.id)) st.staff.unshift({ id: me.id, name: me.name, email: me.email });

  acts.innerHTML = `<button class="btn ghost sm hide-sm" id="ikeys" title="Keyboard shortcuts">${ico('keyboard')} Shortcuts</button><button class="btn ghost sm" id="imac">${ico('bolt')} Macros</button><button class="btn ghost sm" id="irf" aria-label="Refresh">${ico('refresh')}<span class="hide-sm">Refresh</span></button>`;
  el.innerHTML = `${st.ro ? `<div class="note" style="margin-bottom:12px;background:#ECEAFB;border-color:#D6D2F5;color:#2A2560"><b style="color:#2A2560">Replies happen in VooSquare.</b> This inbox is read-only while support runs in VooSquare. ${can(['tickets.manage', 'settings.manage']) ? '<a href="#/support-settings">Change it in Support settings</a>.' : ''}</div>` : ''}
  <div class="card ibx ${st.ro ? 'ro' : ''}" id="ibx">
    <aside class="ibx-views" id="iv" aria-label="Ticket views"></aside>
    <section class="ibx-list" aria-label="Tickets">
      <div class="ibx-lh"><div class="vchips" id="ivc"></div>
        <div class="srch">${ico('search')}<input class="inp sm" id="iq" type="search" placeholder="Search subject, customer or #id" aria-label="Search tickets"></div>
        <div class="row between" style="gap:8px;flex-wrap:nowrap"><label class="ctl"><span class="lbl">Priority</span><select id="ipr"><option value="">All</option>${PRIOS.map((p) => `<option value="${p}">${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></label><span class="hint mono" id="icount" style="font-size:11px"></span></div></div>
      <div class="tlist" id="tl"><div style="padding:16px"><div class="sk"></div><div class="sk" style="margin-top:12px;width:70%"></div></div></div>
    </section>
    <section class="ibx-conv" id="cv"><div class="ibx-empty"><div>${FACE()}<b style="display:block;color:var(--ink);font-size:16px;margin-top:14px">Pick a ticket</b><span>Choose one on the left. Use <kbd>j</kbd> and <kbd>k</kbd> to move through the list.</span></div></div></section>
  </div>`;
  const ibx = $('#ibx');

  const countOf = (v) => { const c = st.counts || {}; const n = c[v.id] ?? c[v.id === 'calls' ? 'call' : v.id]; return n == null ? '' : n; };
  const drawViews = () => {
    $('#iv').innerHTML = `<h6>Views</h6>${views.map((v) => { const n = countOf(v); return `<button class="vbtn ${st.view === v.id ? 'on' : ''} ${v.hot && num(n) ? 'hot' : ''}" data-v="${v.id}">${ico(v.ic)}<span>${v.l}</span><span class="n">${n === '' ? '' : int(n)}</span></button>`; }).join('')}
      ${scopeAssigned ? '<p class="hint" style="margin:10px 8px 0;font-size:12px">Your role sees tickets assigned to you.</p>' : ''}
      <div class="ibx-keys"><span>Next / previous <span><kbd>j</kbd> <kbd>k</kbd></span></span><span>Reply <kbd>r</kbd></span><span>Internal note <kbd>n</kbd></span><span>Solve <kbd>e</kbd></span><span>Search <kbd>/</kbd></span></div>`;
    $('#ivc').innerHTML = views.map((v) => { const n = countOf(v); return `<button class="vchip ${st.view === v.id ? 'on' : ''}" data-v="${v.id}">${v.l}${n === '' ? '' : `<b>${int(n)}</b>`}</button>`; }).join('');
    $$('[data-v]', ibx).forEach((b) => b.onclick = () => { if (st.view === b.dataset.v) return; st.view = S.ibxView = b.dataset.v; drawViews(); $('#tl').scrollTop = 0; loadList().catch((e) => toast(e.message, true)); });
  };
  const curView = () => views.find((v) => v.id === st.view) || views[0];

  const loadList = async (quiet) => {
    const v = curView();
    const p = new URLSearchParams({ ...v.q, page: '1' });
    if (st.q) p.set('q', st.q);
    if (st.prio) p.set('priority', st.prio);
    const r = await GET('/api/admin/tickets?' + p);
    if (S.section !== 'inbox') return;
    st.counts = r.counts || st.counts;
    let list = (r.tickets || []).map(tnorm);
    if (v.active) list = list.filter(isActiveT);
    if (v.id === 'calls') list = list.filter((t) => !t.category || t.category === 'call');
    if (v.id === 'overdue') list = list.filter(isLate);
    if (v.id === 'mine') list = list.filter((t) => !t.assignee_staff_id || Number(t.assignee_staff_id) === me.id);
    if (v.id === 'unassigned') list = list.filter((t) => !t.assignee_staff_id && !t.assignee_ext_id && !t.assignee_ext_name);
    if (st.prio) list = list.filter((t) => !t.priority || t.priority === st.prio);
    const fresh = quiet ? new Set(list.filter((t) => !st.seen.has(t.id + ':' + t.updated_at)).map((t) => t.id)) : new Set();
    list.forEach((t) => st.seen.add(t.id + ':' + t.updated_at));
    st.list = list;
    drawViews(); drawList(fresh); refreshBadge(st.counts);
  };
  const drawList = (fresh = new Set()) => {
    const v = curView();
    $('#icount').textContent = st.list.length + (st.list.length === 1 ? ' ticket' : ' tickets');
    if (!st.list.length) { $('#tl').innerHTML = `<div class="empty">${FACE('happy')}<b>${esc(st.q ? 'No tickets match' : v.empty[0])}</b>${esc(st.q ? 'Try a different search.' : v.empty[1])}</div>`; return; }
    $('#tl').innerHTML = st.list.map((t) => `<button class="tk ${t.waiting && isActiveT(t) ? 'wait' : ''} ${st.cur === t.id ? 'on' : ''} ${fresh.has(t.id) ? 'tk-enter' : ''}" data-t="${t.id}">
      <div class="r1"><span class="who">${esc(t.who)}</span><time title="${esc(fdate(t.updated_at))}">${ago(t.updated_at)}</time></div>
      <div class="subj">${t.category === 'call' ? '<span style="color:var(--brand)">Call · </span>' : ''}${esc(t.subject || '(no subject)')}</div>
      ${t.snippet ? `<div class="snip">${t.snipBy && t.snipBy !== 'customer' ? `<span style="color:var(--mut2)">${t.snipBy === 'voosquare' ? 'VooSquare' : t.snipBy === 'system' ? 'Vooads' : 'Team'}: </span>` : ''}${esc(t.snippet)}</div>` : ''}
      <div class="meta">${t.priority && t.priority !== 'normal' ? prBadge(t.priority) : ''}${slaBadge(t)}${v.id === 'solved' || !isActiveT(t) || ['mine', 'unassigned', 'overdue', 'calls'].includes(v.id) ? stDot(t.status) : ''}${t.channel === 'voosquare' ? `<span class="tag2">${ico('globe')}VooSquare</span>` : ''}<span style="flex:1"></span>${t.assignee ? `<span class="mini-av ${t.ext ? 'ext' : ''}" title="Owner: ${esc(t.assignee)}${t.ext ? ' (VooSquare)' : ''}">${esc(initials(t.assignee))}</span>` : ''}</div>
    </button>`).join('');
    $$('#tl .tk').forEach((b) => b.onclick = () => openTicket(Number(b.dataset.t)));
  };

  // ----- thread -----
  const custName = () => st.detail?.user?.name || st.detail?.ticket?.user_name || st.detail?.user?.email || 'the customer';
  const openTicket = async (id, quiet) => {
    if (!quiet && st.cur && st.cur !== id && $('#rp')) st.drafts[st.cur] = $('#rp').value;
    const changed = st.cur !== id;
    st.cur = id; ibx.classList.add('has'); $('#page').classList.add('thread-open');
    $$('#tl .tk').forEach((b) => b.classList.toggle('on', Number(b.dataset.t) === id));
    $('#tl .tk.on')?.scrollIntoView({ block: 'nearest' });
    if (changed && !quiet) $('#cv').innerHTML = `<div class="thread"><div class="th-h"><div class="sk" style="width:50%"></div><div class="sk" style="width:30%"></div></div><div class="msgs"><div class="sk" style="width:60%;height:50px"></div><div class="sk" style="width:40%;height:40px;align-self:flex-end"></div></div></div>`;
    let r;
    try { r = await GET('/api/admin/tickets/' + id); } catch (e) { if (!quiet) toast(e.message, true); return; }
    if (st.cur !== id || S.section !== 'inbox') return;
    const sig = (x) => JSON.stringify([x.ticket?.updated_at, x.ticket?.status, x.ticket?.priority, x.ticket?.assignee_staff_id, (x.messages || []).length]);
    if (quiet && st.detail && sig(st.detail) === sig(r)) return;
    const prevLen = st.detail?.ticket?.id === id ? (st.detail.messages || []).length : -1;
    st.detail = r; r.ticket = tnorm({ ...r.ticket, user: r.ticket.user || r.user });
    if (r.can) { canGive = !!r.can.credits; if ('max_credit_grant' in r.can) grantMax = r.can.max_credit_grant ?? null; }
    if (r.read_only != null && !!r.read_only !== st.ro) { st.ro = !!r.read_only; }
    if (Array.isArray(r.staff) && r.staff.length) { st.staff = r.staff; if (!st.staff.find((x) => x.id === me.id) && canReply) st.staff.unshift({ id: me.id, name: me.name, email: me.email }); }
    if (!quiet || !$('#thh')) drawThread(); else { drawHead(); drawMsgs(prevLen); drawCtx(); }
    const row = st.list.find((x) => x.id === id); if (row && row.waiting && !quiet) { row.waiting = false; $(`#tl .tk[data-t="${id}"]`)?.classList.remove('wait'); }
  };
  const drawThread = () => {
    $('#cv').innerHTML = `<div class="cv-in"><div class="thread"><div id="thh"></div><div class="msgs" id="ms" aria-live="polite"></div><div id="cmpw"></div></div><aside class="ctx" id="ctx" aria-label="Customer"></aside></div>`;
    drawHead(); drawMsgs(-1); drawComposer(); drawCtx();
  };
  const drawHead = () => {
    const t = st.detail.ticket, editable = !st.ro && canReply;
    const staffOpts = st.staff.map((x) => `<option value="${x.id}" ${Number(t.assignee_staff_id) === x.id ? 'selected' : ''}>${x.id === me.id ? 'Me (' + esc(firstName(x.name || x.email)) + ')' : esc(x.name || x.email)}</option>`).join('');
    $('#thh').innerHTML = `<div class="th-h"><div class="t1"><button class="iconbtn back-only" id="tbk" aria-label="Back to list">${ico('back')}</button>
      <div class="grow" style="min-width:0"><h2>${esc(t.subject || '(no subject)')}</h2><div class="sub"><span>#${t.id}</span><span>${esc(TCHAN[t.channel] || t.channel || 'web')}</span><span>opened ${ago(t.created_at)}</span>${t.voo_ticket_id ? `<span>VooSquare ${esc(t.voo_ticket_id)}</span>` : ''}</div></div>
      <button class="btn ghost xs ctx-toggle" id="ctxbtn">${ico('user')}<span class="hide-xs">Customer</span></button></div>
      <div class="th-ctl">
        <label class="ctl"><span class="lbl">Status</span><select id="t-status" ${editable ? '' : 'disabled'}>${Object.entries(TSTATUS).map(([k, l]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="ctl"><span class="lbl">Priority</span><select id="t-prio" ${editable ? '' : 'disabled'}>${PRIOS.map((p) => `<option value="${p}" ${t.priority === p ? 'selected' : ''}>${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></label>
        <label class="ctl"><span class="lbl">Owner</span><select id="t-asg" ${!st.ro && canAssign ? '' : 'disabled'}><option value="">Nobody yet</option>${staffOpts}${!t.assignee_staff_id && t.assignee_ext_name ? `<option selected disabled>${esc(t.assignee_ext_name)} (VooSquare)</option>` : ''}</select></label>
        <label class="ctl"><span class="lbl">Type</span><select id="t-cat" ${editable ? '' : 'disabled'}>${Object.entries(TCATS).map(([k, l]) => `<option value="${k}" ${t.category === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${slaBadge(t)}
        ${editable && isActiveT(t) ? `<button class="btn solid xs" id="t-solve" title="Mark solved (e)">${ico('check')} Solve</button>` : ''}
      </div></div>`;
    $('#tbk').onclick = () => { if ($('#rp')) st.drafts[st.cur] = $('#rp').value; st.cur = null; st.detail = null; ibx.classList.remove('has'); $('#page').classList.remove('thread-open'); $$('#tl .tk').forEach((b) => b.classList.remove('on')); };
    $('#ctxbtn').onclick = () => $('#ctx')?.classList.toggle('open');
    const upd = async (body, msg, sel) => {
      const x = await act(null, () => PUT('/api/admin/tickets/' + t.id, body), msg);
      if (!x) { if (sel) drawHead(); return; }
      await openTicket(t.id, true); loadList(true).catch(() => {});
    };
    $('#t-status').onchange = (e) => upd({ status: e.target.value }, 'Status: ' + TSTATUS[e.target.value], true);
    $('#t-prio').onchange = (e) => upd({ priority: e.target.value }, 'Priority: ' + e.target.value, true);
    $('#t-cat').onchange = (e) => upd({ category: e.target.value }, 'Type: ' + TCATS[e.target.value], true);
    $('#t-asg').onchange = (e) => { const v = e.target.value; upd({ assignee_staff_id: v ? Number(v) : null }, v ? 'Owner: ' + (Number(v) === me.id ? 'you' : e.target.selectedOptions[0].textContent) : 'Owner removed', true); };
    $('#t-solve') && ($('#t-solve').onclick = () => solve());
  };
  const solve = async () => {
    if (!st.detail || st.ro || !canReply) return;
    const t = st.detail.ticket; if (!isActiveT(t)) return toast('This ticket is already ' + t.status + '.');
    const x = await act($('#t-solve'), () => PUT('/api/admin/tickets/' + t.id, { status: 'solved' }), 'Solved #' + t.id);
    if (!x) return;
    const i = st.list.findIndex((y) => y.id === t.id);
    await loadList(true).catch(() => {});
    const nxt = st.list[i] || st.list[i - 1];
    if (nxt && nxt.id !== t.id) openTicket(nxt.id); else openTicket(t.id, true);
  };
  const msgHtml = (m) => {
    const internal = m.internal === true || Number(m.internal) === 1;
    const type = m.author_type || (m.from_staff ? 'staff' : 'customer');
    const when = `<time title="${esc(fdate(m.created_at))}">${ago(m.created_at)}</time>`;
    if (type === 'system') return `<div class="msg sys">${esc(m.body)} · ${when}</div>`;
    const cls = internal ? 'note' : type === 'customer' ? 'u' : type === 'bot' ? 'bot' : type === 'voosquare' ? 'v' : 's';
    const by = internal ? 'Internal note · ' + (m.author_name || 'Staff') : type === 'customer' ? (m.author_name || custName()) : type === 'bot' ? 'Vooads bot' : type === 'voosquare' ? (m.author_name || 'Agent') + ' · via VooSquare' : (m.author_name || 'Staff');
    const ic = internal ? ico('note') : type === 'bot' ? ico('bolt') : type === 'voosquare' ? ico('globe') : '';
    const atts = attList(m.attachments);
    return `<div class="msg ${cls}"><div class="by">${ic}<span>${esc(by)}</span>·${when}</div>${linkify(esc(m.body))}${atts.length ? `<div class="att">${atts.map((a) => `<a class="pill plain" style="white-space:normal;text-decoration:none" href="${esc(a.url)}" target="_blank" rel="noopener" title="${a.kind === 'article' ? 'Help article sent to the customer' : 'Attachment'}">${ico(a.kind === 'article' ? 'note' : 'link').replace('<svg', '<svg style="width:12px;height:12px;flex:none"')}${esc(a.name)}</a>`).join('')}</div>` : ''}</div>`;
  };
  const drawMsgs = (prevLen) => {
    const ms = $('#ms'); if (!ms) return;
    const msgs = st.detail.messages || [];
    const atBottom = ms.scrollHeight - ms.scrollTop - ms.clientHeight < 80;
    let lastDay = '';
    ms.innerHTML = msgs.length ? msgs.map((m, i) => { const dl = dayLabel(m.created_at); const sep = dl && dl !== lastDay ? `<div class="daysep">${esc(dl)}</div>` : ''; lastDay = dl || lastDay; const h = msgHtml(m); return sep + (prevLen >= 0 && i < prevLen ? h.replace('class="msg', 'style="animation:none" class="msg') : h); }).join('') : '<div class="empty">No messages yet.</div>';
    if (prevLen < 0 || atBottom) ms.scrollTop = ms.scrollHeight;
  };
  const setMode = (note) => {
    st.note = note; const c = $('#cmp'); if (!c) return;
    c.classList.toggle('note-mode', note);
    $$('#cmode button', c).forEach((b) => b.classList.toggle('on', (b.dataset.m === 'note') === note));
    $('#rp').placeholder = note ? 'Private note for the team. The customer never sees it.' : 'Reply to ' + firstName(custName()) + '…';
    $('#cmhint').textContent = note ? 'Only staff can see notes.' : 'Goes to the customer in the app and by email · Ctrl/⌘ + Enter';
    $('#sendbtn').firstChild.textContent = note ? 'Add note ' : 'Send ';
    $('#after').closest('.ctl').hidden = note;
  };
  const drawComposer = () => {
    const w = $('#cmpw'); const t = st.detail.ticket;
    if (st.ro) { w.innerHTML = `<div class="ro-banner">${ico('globe')}<div><b>Replies happen in VooSquare.</b> You can read this ticket here. Answer it from VooSquare.com.</div></div>`; return; }
    if (!canReply) { w.innerHTML = `<div class="ro-banner" style="background:var(--soft);color:var(--mut);border-top:1px solid var(--line)">${ico('eye')}<div>Your role can read tickets but not reply. Ask the owner for <b style="color:var(--ink)">Reply to tickets</b>.</div></div>`; return; }
    w.innerHTML = `<form class="composer" id="cmp">
      <div class="bar"><div class="seg" id="cmode"><button type="button" data-m="reply" class="on">Reply</button><button type="button" data-m="note">${ico('note').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"')}Internal note</button></div><span class="grow"></span><div style="position:relative" id="mcwrap"><button type="button" class="btn ghost xs" id="mcbtn" title="Insert a saved reply">${ico('bolt')} Macros</button></div></div>
      <textarea class="inp" id="rp" rows="2" aria-label="Message"></textarea>
      <div class="send-row"><span class="hint" id="cmhint" style="font-size:12.5px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>
        <label class="ctl"><span class="lbl">Then</span><select id="after"><option value="">Keep ${esc(TSTATUS[t.status] || 'status').toLowerCase()}</option><option value="pending">Set pending</option><option value="solved">Set solved</option></select></label>
        <button class="btn brand sm" type="submit" id="sendbtn">Send ${ARR()}</button></div></form>`;
    const rp = $('#rp'); rp.value = st.drafts[t.id] || '';
    setMode(false);
    $$('#cmode button').forEach((b) => b.onclick = () => { setMode(b.dataset.m === 'note'); rp.focus(); });
    rp.oninput = () => { st.drafts[t.id] = rp.value; rp.style.height = 'auto'; rp.style.height = Math.min(220, Math.max(58, rp.scrollHeight)) + 'px'; };
    rp.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#cmp').requestSubmit(); } };
    $('#mcbtn').onclick = () => macroPicker();
    $('#cmp').onsubmit = async (e) => {
      e.preventDefault();
      const body = rp.value.trim(); if (!body) { rp.focus(); return toast('Write something first.', true); }
      const after = st.note ? '' : $('#after').value;
      const x = await act($('#sendbtn'), () => POST('/api/admin/tickets/' + t.id + '/reply', { body, internal: st.note, ...(after ? { status: after } : {}) }), st.note ? 'Note added' : after === 'solved' ? 'Sent and solved' : 'Reply sent');
      if (!x) return;
      rp.value = ''; delete st.drafts[t.id]; rp.style.height = '';
      await openTicket(t.id, true); loadList(true).catch(() => {});
    };
  };
  const macroPicker = async () => {
    const wrap = $('#mcwrap'); if (!wrap) return;
    if ($('.macro-pop', wrap)) { $('.macro-pop', wrap).remove(); return; }
    if (!st.macros) {
      const r = await tryGet('/api/admin/macros');
      if (!r.ok) return toast(r.missing ? 'Saved replies are not available yet.' : r.error.message, true);
      st.macros = r.data.macros || (Array.isArray(r.data) ? r.data : []);
    }
    const pop = document.createElement('div'); pop.className = 'macro-pop';
    pop.innerHTML = `<input class="inp sm" placeholder="Search saved replies" aria-label="Search macros"><div class="ml"></div>`;
    wrap.appendChild(pop);
    let sel = 0, rows = [];
    const ctx = { first: firstName(custName()), agent: firstName(me.name || me.email), id: st.cur, email: st.detail?.user?.email || '', subject: st.detail?.ticket?.subject || '' };
    const draw = () => {
      const q = $('input', pop).value.toLowerCase();
      rows = st.macros.filter((m) => !q || (m.title + ' ' + m.body).toLowerCase().includes(q));
      $('.ml', pop).innerHTML = rows.length ? rows.map((m, i) => `<button type="button" class="${i === sel ? 'on' : ''}" data-i="${i}"><b>${esc(m.title)}</b><span>${esc(fillMacro(m.body, ctx))}</span></button>`).join('') : `<div class="empty" style="padding:22px">${st.macros.length ? 'No match.' : 'No saved replies yet.'}${can('tickets.manage') ? '<br><button type="button" class="linkbtn" id="mcnew">Create one</button>' : ''}</div>`;
      $$('.ml button[data-i]', pop).forEach((b) => b.onclick = () => pick(rows[Number(b.dataset.i)]));
      $('#mcnew', pop) && ($('#mcnew', pop).onclick = () => { pop.remove(); macrosDrawer(() => { st.macros = null; }); });
    };
    const pick = (m) => {
      if (!m) return;
      const rp = $('#rp'), text = fillMacro(m.body, ctx), at = rp.selectionStart ?? rp.value.length;
      rp.value = rp.value.slice(0, at) + (at && !/\s$/.test(rp.value.slice(0, at)) ? '\n' : '') + text + rp.value.slice(rp.selectionEnd ?? at);
      pop.remove(); rp.focus(); rp.oninput(); toast('Inserted "' + m.title + '"');
    };
    $('input', pop).oninput = () => { sel = 0; draw(); };
    $('input', pop).onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(rows[sel]); }
      else if (e.key === 'Escape') { e.stopPropagation(); pop.remove(); $('#rp')?.focus(); }
    };
    const off = (e) => { if (!pop.isConnected) return document.removeEventListener('pointerdown', off, true); if (!wrap.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
    draw(); $('input', pop).focus();
  };
  const drawCtx = () => {
    const c = $('#ctx'); if (!c) return;
    const r = st.detail, t = r.ticket, u = r.user || {};
    const wasOpen = c.classList.contains('open');
    const bal = u.balance?.total ?? u.credits ?? ((u.plan_credits || 0) + (u.topup_credits || 0) + (u.trial_credits || 0));
    const planId = u.plan ?? u.plan_id, planOn = !!planId && (u.plan !== undefined || !u.plan_expires_at || parseDate(u.plan_expires_at) > Date.now());
    const jobs = (r.recent_jobs || []).slice(0, 6), pays = (r.recent_payments || []).slice(0, 5);
    const quick = [25, 50, 100, 250].filter((n) => grantMax == null || n <= Number(grantMax));
    c.innerHTML = `<div class="row between" style="flex-wrap:nowrap"><h5 style="margin:0">Customer</h5><button class="iconbtn ctx-x" id="ctxx" aria-label="Close customer panel">${ico('x')}</button></div>
      <div class="box"><div class="who"><span class="avatar">${esc(initials(u.name || u.email || t.who))}</span><div style="min-width:0"><b>${esc(u.name || t.who)}</b><span>${esc(u.email || t.email || '')}</span></div></div>
        <div class="row" style="gap:6px;margin-top:10px">${planOn ? `<span class="pill ink">${esc(planId)}</span>` : '<span class="pill plain">Free / trial</span>'}${u.status && u.status !== 'active' ? statusPill(u.status) : ''}${u.country ? `<span class="pill plain">${esc(u.country)}</span>` : ''}${u.voo_id ? '<span class="pill sky">Voo ID</span>' : ''}</div>
        <div class="row between" style="margin-top:12px;align-items:flex-end"><div><div class="hint mono" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase">Credits</div><div class="bigcr" id="ctxcr">${int(bal)}</div></div>${can('users.view') && u.id ? '<button class="btn ghost xs" id="cprof">Full profile</button>' : ''}</div></div>
      ${canGive && !st.ro && u.id !== undefined && grantMax !== 0 ? `<div class="box"><h5>Give credits <span>${grantMax != null ? 'up to ' + int(grantMax) : 'no limit'}</span></h5>
        <div class="quick">${quick.map((n) => `<button type="button" class="btn ghost xs" data-q="${n}">+${n}</button>`).join('')}</div>
        <div style="display:grid;grid-template-columns:88px minmax(0,1fr);gap:8px;margin-top:8px"><input class="inp sm" id="gcamt" type="number" min="1" ${grantMax != null ? `max="${esc(grantMax)}"` : ''} placeholder="0" aria-label="Credits"><input class="inp sm" id="gcwhy" maxlength="120" placeholder="Reason, e.g. failed video" aria-label="Reason"></div>
        <button class="btn solid xs" style="margin-top:8px" id="gcgo">${ico('plus')} Give credits</button><p class="hint" style="margin-top:6px;font-size:12px">Added as top-up credits. Logged in the ledger and the activity log.</p></div>` : ''}
      <div class="box"><h5>Ticket</h5>
        <div class="kv"><span>Status</span><span>${stDot(t.status)}</span></div>
        <div class="kv"><span>Type</span><span>${esc(TCATS[t.category] || t.category || '—')}</span></div>
        <div class="kv"><span>From</span><span>${esc(TCHAN[t.channel] || t.channel || 'In app')}</span></div>
        <div class="kv"><span>Opened</span><span title="${esc(fdate(t.created_at))}">${ago(t.created_at)}</span></div>
        <div class="kv"><span>First reply</span><span>${t.first_response_at ? ago(t.first_response_at) : '<span class="muted">Not yet</span>'}</span></div>
        ${t.sla_due_at && isActiveT(t) ? `<div class="kv"><span>Reply due</span><span>${fdate(t.sla_due_at)}</span></div>` : ''}
        ${t.category === 'call' || t.phone ? `<div class="kv"><span>Phone</span><span>${t.phone ? (can('calls.handle') ? `<a href="tel:${esc(String(t.phone).replace(/[^\d+]/g, ''))}" class="mono">${esc(t.phone)}</a>` : `<span class="mono">${esc(t.phone)}</span>`) : '—'}</span></div><div class="kv"><span>Best time</span><span>${esc(t.call_time || 'Any time')}</span></div>` : ''}
      </div>
      ${(r.other_tickets || []).length ? `<div class="box"><h5>Other tickets <span>${r.other_tickets.length}</span></h5>${r.other_tickets.slice(0, 5).map((o) => `<div class="mini"><button class="linkbtn" data-ot="${o.id}" style="text-align:left;font-size:13px;color:var(--ink);text-decoration:none;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">#${o.id} · ${esc(o.subject || '')}</button>${stDot(o.status)}</div>`).join('')}</div>` : ''}
      <div class="box"><h5>Recent jobs <span>${jobs.length}</span></h5>${jobs.length ? jobs.map((j) => `<div class="mini"><div style="min-width:0"><b style="font-size:13px">#${j.id} · ${esc(j.type)}</b><small>${ago(j.created_at)} · ${int(j.credits)} cr</small></div>${statusPill(j.status)}</div>`).join('') : '<p class="hint">No jobs yet.</p>'}</div>
      <div class="box"><h5>Recent payments <span>${pays.length}</span></h5>${pays.length ? pays.map((p) => `<div class="mini"><div style="min-width:0"><b style="font-size:13px">${money(p.amount_usd)}</b><small>${esc(p.kind || '')} · ${esc(p.adapter || '')} · ${ago(p.created_at)}</small></div>${statusPill(p.status)}</div>`).join('') : '<p class="hint">No payments yet.</p>'}</div>`;
    if (wasOpen) c.classList.add('open');
    $('#ctxx').onclick = () => c.classList.remove('open');
    $('#cprof', c) && ($('#cprof', c).onclick = () => customerDrawer(u.id, () => openTicket(t.id, true)));
    $$('[data-q]', c).forEach((b) => b.onclick = () => { $('#gcamt').value = b.dataset.q; $('#gcwhy').focus(); });
    $$('[data-ot]', c).forEach((b) => b.onclick = () => openTicket(Number(b.dataset.ot)));
    $('#gcgo', c) && ($('#gcgo', c).onclick = async (e) => {
      const amount = Math.round(Number($('#gcamt').value)), reason = $('#gcwhy').value.trim();
      if (!(amount > 0)) return toast('Enter how many credits to give.', true);
      if (grantMax != null && amount > Number(grantMax)) return toast('Your role can give at most ' + int(grantMax) + ' credits at a time.', true);
      if (!reason) { $('#gcwhy').focus(); return toast('Add a short reason. It is saved in the activity log.', true); }
      const x = await act(e.currentTarget, () => POST('/api/admin/tickets/' + t.id + '/credits', { amount, reason }), (y) => 'Gave ' + int(y?.applied ?? amount) + ' credits to ' + firstName(u.name || u.email));
      if (x) openTicket(t.id, true).then(() => { st.detail && drawCtx(); });
    });
  };

  // ----- keyboard -----
  const move = (d) => {
    if (!st.list.length) return;
    const i = st.list.findIndex((t) => t.id === st.cur);
    const n = st.list[Math.max(0, Math.min(st.list.length - 1, i < 0 ? 0 : i + d))];
    if (n && n.id !== st.cur) openTicket(n.id);
  };
  const keys = () => modal({ title: 'Keyboard shortcuts', ok: '', cancel: 'Close', body: `<div class="list">${[['j / k', 'Next / previous ticket'], ['r', 'Reply to the customer'], ['n', 'Write an internal note'], ['e', 'Mark solved and go to the next'], ['/', 'Search tickets'], ['Ctrl/⌘ + Enter', 'Send'], ['Esc', 'Leave the text box'], ['?', 'Show this list']].map(([k, l]) => `<div class="li"><span>${l}</span><span>${k.split(' / ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</span></div>`).join('')}</div>` });
  const onKey = (e) => {
    if (S.section !== 'inbox') return;
    const tg = e.target, typing = /^(input|textarea|select)$/i.test(tg.tagName || '') || tg.isContentEditable;
    if (typing) { if (e.key === 'Escape' && !$('.macro-pop')) tg.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || $('.modal-wrap') || $('#dw.on')) return;
    const k = e.key;
    if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if ((k === 'r' || k === 'n') && $('#rp')) { e.preventDefault(); setMode(k === 'n'); $('#rp').focus(); }
    else if (k === 'e') { e.preventDefault(); solve(); }
    else if (k === '/') { e.preventDefault(); $('#iq').focus(); }
    else if (k === '?') { e.preventDefault(); keys(); }
  };
  document.addEventListener('keydown', onKey);
  S.cleanup.push(() => document.removeEventListener('keydown', onKey));

  $('#iq').oninput = debounce((e) => { st.q = e.target.value.trim(); loadList().catch((x) => toast(x.message, true)); }, 250);
  $('#ipr').onchange = (e) => { st.prio = e.target.value; loadList().catch((x) => toast(x.message, true)); };
  $('#irf').onclick = (e) => act(e.currentTarget, async () => { await loadList(true); if (st.cur) await openTicket(st.cur, true); }, 'Inbox up to date');
  $('#imac').onclick = () => macrosDrawer(() => { st.macros = null; });
  $('#ikeys').onclick = keys;

  // First paint: reuse the response we already have when the view is "open".
  if (st.view === 'open' && !st.q) {
    st.list = (first.data.tickets || []).map(tnorm).filter(isActiveT);
    st.list.forEach((t) => st.seen.add(t.id + ':' + t.updated_at));
    drawViews(); drawList(); refreshBadge(st.counts);
  } else { drawViews(); await loadList(); }
  if (st.list[0] && matchMedia('(min-width:761px)').matches) openTicket(st.list[0].id);

  // Live: refresh every 15 seconds while the tab is visible.
  S.timers.push(setInterval(() => {
    if (document.hidden || S.section !== 'inbox') return;
    $('#ph-live') && ($('#ph-live').textContent = 'Live · updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    loadList(true).catch(() => {});
    const typing = document.activeElement && document.activeElement.closest?.('#ctx, #thh');
    if (st.cur && !typing) openTicket(st.cur, true);
  }, 15000));
};

// Saved replies (macros): list, add, edit, delete.
async function macrosDrawer(onChange) {
  const r = await tryGet('/api/admin/macros');
  if (!r.ok) return toast(r.missing ? 'Saved replies are not available yet. They switch on with the server update.' : r.error.message, true);
  let list = r.data.macros || (Array.isArray(r.data) ? r.data : []);
  const manage = can('tickets.manage');
  const d = openDrawer({ title: 'Saved replies', sub: 'Write common answers once and insert them in any reply. Use {{first_name}}, {{agent}} and {{ticket_id}}; they fill in by themselves.', body: '<div id="mlist"></div>', foot: manage ? `<button class="btn brand sm" id="madd">${ico('plus')} New saved reply</button>` : '' });
  const reload = async () => { const x = await tryGet('/api/admin/macros'); if (x.ok) list = x.data.macros || (Array.isArray(x.data) ? x.data : []); draw(); onChange?.(); };
  const form = (m) => `<div class="card pad" style="background:var(--soft);display:grid;gap:10px;animation:up .3s var(--ease) both" data-form="${m?.id || 'new'}"><div class="fld"><label>Title</label><input class="inp sm" data-mt value="${esc(m?.title || '')}" maxlength="80" placeholder="e.g. Refund for a failed video"></div>
    <div class="fld"><label>Reply text</label><textarea class="inp sm" data-mb rows="6" placeholder="Hi {{first_name}}, sorry about that…">${esc(m?.body || '')}</textarea><small>Tip: keep it short and friendly. You can edit it before sending.</small></div>
    <div class="row end"><button class="btn ghost xs" data-mcancel>Cancel</button><button class="btn brand xs" data-msave>${m ? 'Save' : 'Add'}</button></div></div>`;
  const draw = (editing) => {
    $('#mlist', d).innerHTML = (editing === 'new' ? form(null) : '') + (list.length ? `<div class="list">${list.map((m) => editing === m.id ? form(m) : `<div class="li" style="align-items:flex-start"><div class="m"><b>${esc(m.title)}</b><small style="white-space:pre-wrap;margin-top:4px;color:var(--mut)">${esc(String(m.body || '').slice(0, 220))}${String(m.body || '').length > 220 ? '…' : ''}</small></div>${manage ? `<div class="row" style="flex-wrap:nowrap;gap:4px"><button class="iconbtn" data-medit="${m.id}" aria-label="Edit">${ico('edit')}</button><button class="iconbtn" data-mdel="${m.id}" aria-label="Delete">${ico('trash')}</button></div>` : ''}</div>`).join('')}</div>` : editing === 'new' ? '' : emptyCard('No saved replies yet', manage ? 'Add your first one with the button below.' : 'Ask a support lead to add some.'));
    $$('[data-medit]', d).forEach((b) => b.onclick = () => draw(Number(b.dataset.medit)));
    $$('[data-mdel]', d).forEach((b) => b.onclick = () => confirmDel('this saved reply', async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/macros/' + b.dataset.mdel), 'Deleted'); if (!x) return false; reload(); }));
    $$('[data-form]', d).forEach((f) => {
      $('[data-mcancel]', f).onclick = () => draw();
      $('[data-msave]', f).onclick = async (e) => {
        const b = { title: $('[data-mt]', f).value.trim(), body: $('[data-mb]', f).value.trim() };
        if (!b.title || !b.body) return toast('Add a title and the reply text.', true);
        const idv = f.dataset.form;
        const x = await act(e.currentTarget, () => idv === 'new' ? POST('/api/admin/macros', b) : PUT('/api/admin/macros/' + idv, b), idv === 'new' ? 'Saved reply added' : 'Saved reply updated');
        if (x) reload();
      };
      $('[data-mt]', f).focus();
    });
  };
  $('#madd', d) && ($('#madd', d).onclick = () => draw('new'));
  draw();
}

// ---------- Classic support chats (used until the ticket API is live) ----------
async function legacySupport(el, acts, fallback) {
  acts.innerHTML = `<button class="btn ghost sm" id="rf">${ico('refresh')} Refresh</button>`;
  let cur = null, threads = [];
  el.innerHTML = `${fallback ? naCard('Tickets are on their way', 'The new ticket inbox (owners, notes, priorities, reply-time targets) switches on when the server update lands. Until then, answer customer chats here as usual.') + '<div style="height:14px"></div>' : ''}<div class="card inbox" id="ib"><div class="threads" id="th"></div><div class="conv" id="cv"><div class="empty" style="margin:auto">${FACE()}<b>Pick a chat</b>Choose a conversation on the left to read and reply.</div></div></div>`;
  const loadThreads = async () => {
    threads = (await GET('/api/admin/support')).threads;
    $('#th').innerHTML = threads.length ? threads.map((t) => `<button class="th ${cur === t.user_id ? 'on' : ''}" data-u="${t.user_id}"><div class="r1"><span>${t.unread ? '<i class="unread"></i>' : ''}${esc(t.name || t.email)}</span><time>${ago(t.last_at)}</time></div><p>${esc(t.last_body || '')}</p></button>`).join('') : emptyCard('Inbox zero', 'No customer chats yet.');
    $$('#th .th').forEach((b) => b.onclick = () => openThread(Number(b.dataset.u)));
    refreshBadge();
  };
  const openThread = async (uid, quiet) => {
    cur = uid; $('#ib').classList.add('has');
    $$('#th .th').forEach((b) => b.classList.toggle('on', Number(b.dataset.u) === uid));
    const r = await GET('/api/admin/support/' + uid).catch((e) => { toast(e.message, true); return null; });
    if (!r || cur !== uid) return;
    const draft = $('#rp')?.value || '';
    const u = r.user || { email: 'Deleted customer' };
    $('#cv').innerHTML = `<div class="ch"><button class="iconbtn back-only" id="bk" aria-label="Back">${ico('back')}</button><span class="avatar">${esc(initials(u.name || u.email))}</span><div class="grow" style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.name || u.email)}</b><span class="hint">${esc(u.email)} · ${esc(u.plan_id || 'Free')}</span></div>${u.status ? statusPill(u.status) : ''}${can('users.view') && u.id ? `<button class="btn ghost xs" id="vc">Profile</button>` : ''}</div>
      <div class="msgs" id="ms">${r.messages.map((m) => `<div class="msg ${m.from_staff ? 's' : 'u'}">${esc(m.body)}<small>${m.from_staff ? esc(m.staff_name || 'Staff') + ' · ' : ''}${fdate(m.created_at)}</small></div>`).join('')}</div>
      <form class="reply" id="rf2"><textarea class="inp sm grow" id="rp" rows="1" placeholder="Write a reply…" title="Enter to send, Shift+Enter for a new line"></textarea><button class="btn brand sm" type="submit">${ico('send')}<span class="hide-sm">Send</span></button></form>`;
    const ms = $('#ms'); ms.scrollTop = ms.scrollHeight;
    const rp = $('#rp'); rp.value = draft;
    rp.oninput = () => { rp.style.height = 'auto'; rp.style.height = Math.min(160, rp.scrollHeight) + 'px'; };
    rp.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#rf2').requestSubmit(); } };
    $('#bk').onclick = () => { cur = null; $('#ib').classList.remove('has'); loadThreads(); };
    $('#vc') && ($('#vc').onclick = () => customerDrawer(u.id));
    $('#rf2').onsubmit = async (e) => {
      e.preventDefault();
      const body = rp.value.trim(); if (!body) return toast('Write a reply first.', true);
      const ok = await act(e.target.querySelector('button'), () => POST('/api/admin/support/' + uid, { body }), 'Reply sent');
      if (ok) { rp.value = ''; openThread(uid); loadThreads(); }
    };
    if (!quiet) { rp.focus(); loadThreads(); }
  };
  $('#rf').onclick = (e) => act(e.currentTarget, async () => { await loadThreads(); if (cur) await openThread(cur, true); }, 'Inbox refreshed');
  await loadThreads();
  S.timers.push(setInterval(() => { if (document.hidden) return; loadThreads().catch(() => {}); if (cur && !$('#rp')?.value) openThread(cur, true); }, 20000));
}

// ---------- Support settings ----------
const SUPPORT_DEF = { voosquare: { enabled: false, mode: 'both', events_url: '', max_credit_grant: 500 }, sla_hours: { urgent: 1, high: 4, normal: 12, low: 24 }, auto_reply: true, business_hours: '' };
const SUPPORT_MODES = [
  { id: 'both', t: 'Both places', d: 'Tickets show here and in VooSquare. A reply from either place reaches the customer.' },
  { id: 'vooads', t: 'Vooads only', d: 'Your team answers here. VooSquare is not told about tickets.' },
  { id: 'voosquare', t: 'VooSquare only', d: 'Tickets go to VooSquare and are answered there. This inbox becomes read-only.' },
];
const VS_ENDPOINTS = [
  ['GET', '/tickets?status=&updated_since=', 'List tickets, newest changes first'],
  ['GET', '/tickets/:id', 'One ticket with its messages and the customer'],
  ['POST', '/tickets/:id/reply', 'Reply or add an internal note as a VooSquare agent'],
  ['PUT', '/tickets/:id', 'Change status, priority or owner'],
  ['POST', '/tickets/:id/credits', 'Give credits, capped by the limit on this page'],
  ['GET', '/stats', 'Counts for the VooSquare dashboard'],
];
VIEWS['support-settings'] = async (el, acts) => {
  const manage = can(['tickets.manage', 'settings.manage']);
  const r = await tryGet('/api/admin/support-settings');
  if (!r.ok && !r.missing) throw r.error;
  const raw = r.ok ? (r.data.settings || r.data) : {};
  const env = r.ok ? (r.data.env || {}) : {};
  const merge = (x) => ({ ...clone(SUPPORT_DEF), ...x, voosquare: { ...SUPPORT_DEF.voosquare, ...(x.voosquare || {}) }, sla_hours: { ...SUPPORT_DEF.sla_hours, ...(x.sla_hours || {}) } });
  let cfg = merge(raw), saved = JSON.stringify(cfg);
  const base = location.origin + '/api/voosquare/support';
  const ro = manage && r.ok ? '' : 'disabled';
  const envPill = (v) => v === true ? '<span class="pill good">Set</span>' : v === false ? '<span class="pill bad">Not set</span>' : '<span class="pill plain">Check the server</span>';
  const keySet = raw.voosquare?.service_key_set ?? env.service_key_set ?? r.data?.service_key_set;
  const secSet = raw.voosquare?.webhook_secret_set ?? env.webhook_secret_set ?? r.data?.webhook_secret_set;
  const defUrl = raw.voosquare?.events_url_default || 'https://api.voosquare.com/v1/support/events';
  const setupText = () => `Vooads support API\nBase URL: ${base}\nAuth header: Authorization: Bearer <VOO_SERVICE_KEY>\n\nEndpoints:\n${VS_ENDPOINTS.map(([m, p, d]) => `${m.padEnd(5)} ${base}${p.split('?')[0]}  (${d})`).join('\n')}\n\nEvents Vooads sends: ticket.created, ticket.message, ticket.updated\nTo: ${cfg.voosquare.events_url || defUrl}\nHeaders: X-Voo-Signature: sha256=<hex HMAC-SHA256 of the raw body with VOO_WEBHOOK_SECRET>, X-Voo-Tool: vooads\nRetries: 3 times`;
  const draw = () => {
    const v = cfg.voosquare;
    const due = (h) => new Date(Date.now() + num(h) * 3600e3).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<div class="stack">
      ${r.ok ? '' : naCard('Support settings are not switched on yet', 'You can read everything below and share the connection details with VooSquare. Saving works as soon as the server update lands.')}
      <div class="card"><div class="card-h"><div><h3>Where tickets are answered</h3><p>VooSquare.com is the shared support desk for all Voo apps. Pick where your team replies.</p></div>
        <label class="swl">${sw(v.enabled, `id="vs-en" ${ro}`)}<span>Connected to VooSquare</span></label></div>
        <div class="card-b stack" style="gap:16px">
          <div class="rcards" id="vs-mode">${SUPPORT_MODES.map((m) => `<button type="button" class="rcard ${v.mode === m.id ? 'on' : ''}" data-mode="${m.id}" ${ro || (!v.enabled ? 'disabled' : '')}><b><i></i>${m.t}</b><span>${m.d}</span></button>`).join('')}</div>
          ${!v.enabled ? '<p class="hint">VooSquare is off, so everything is answered here. Switch it on to choose another option.</p>' : v.mode === 'voosquare' ? '<div class="note" style="background:#ECEAFB;border-color:#D6D2F5;color:#2A2560"><b style="color:#2A2560">The inbox here is read-only.</b> Your team still sees every ticket, but replies, owners and credits are handled in VooSquare.</div>' : ''}
          <div class="fields">
            <div class="fld"><label for="vs-url">Events URL</label><input class="inp sm mono" id="vs-url" value="${esc(v.events_url || '')}" placeholder="${esc(defUrl)}" ${ro}><small>Where Vooads sends new tickets and replies. Leave empty to use the default.</small></div>
            <div class="fld"><label for="vs-max">Most credits a VooSquare agent can give at once</label><input class="inp sm" id="vs-max" type="number" min="0" value="${esc(v.max_credit_grant ?? '')}" ${ro}><small>VooSquare sets its own agent roles. This is the hard cap Vooads enforces on top.</small></div>
          </div></div></div>
      <div class="grid2">
        <div class="card"><div class="card-h"><div><h3>Reply-time targets</h3><p>How fast a ticket should get a first reply, in hours. Late tickets turn red and move to Overdue.</p></div></div>
          <div class="card-b"><div class="sla-grid">${PRIOS.map((p) => `<div class="fld"><label for="sla-${p}">${prBadge(p)}</label><input class="inp sm num" id="sla-${p}" data-sla="${p}" type="number" min="0.25" step="0.25" value="${esc(cfg.sla_hours[p])}" ${ro}><small class="mono" data-due="${p}">due ${esc(due(cfg.sla_hours[p]))}</small></div>`).join('')}</div>
          <p class="hint" style="margin-top:10px">Example: an urgent ticket opened now is due ${esc(due(cfg.sla_hours.urgent))}.</p></div></div>
        <div class="card"><div class="card-h"><div><h3>Instant answer</h3><p>What the customer sees the moment they open a ticket.</p></div></div>
          <div class="card-b stack" style="gap:14px">
            <div class="row between" style="flex-wrap:nowrap"><div><b>Bot reply with help articles</b><div class="hint">Answers right away with up to 3 matching lessons or FAQs and tells them when to expect a person.</div></div>${sw(cfg.auto_reply, `id="ar" ${ro}`)}</div>
            <div class="fld"><label for="bh">Business hours</label><input class="inp sm" id="bh" value="${esc(cfg.business_hours || '')}" placeholder="Mon–Fri, 9:00–18:00 WAT" ${ro}><small>Shown in the bot reply and on the support page. Plain text.</small></div>
          </div></div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Connection details for VooSquare</h3><p>Send these to whoever sets up the VooSquare side. VooSquare calls this API to read tickets, reply and give credits.</p></div><button class="btn ghost sm" id="cpall">${ico('copy')} Copy all</button></div>
        <div class="card-b stack" style="gap:16px">
          <div class="fld"><label>API base URL</label><div class="copybox"><code>${esc(base)}</code><button class="btn ghost xs" data-copy="${esc(base)}">${ico('copy')} Copy</button></div></div>
          <div class="grid2" style="gap:20px">
            <div><div class="secth" style="margin:0 0 6px"><span>Endpoints</span></div>${VS_ENDPOINTS.map(([m, p, d]) => `<div class="endpoint"><span class="m" style="color:${m === 'GET' ? 'var(--good)' : m === 'POST' ? 'var(--brand-d)' : 'var(--violet)'}">${m}</span><code>${esc(p)}</code><small>${esc(d)}</small></div>`).join('')}</div>
            <div><div class="secth" style="margin:0 0 6px"><span>Set on the Vooads server</span></div>
              <div class="envrow"><div class="grow"><b>VOO_SERVICE_KEY</b><p>VooSquare sends it as <span class="k">Authorization: Bearer …</span>. Without it every call is refused.</p></div>${envPill(keySet)}<button class="iconbtn" data-copy="VOO_SERVICE_KEY" aria-label="Copy name">${ico('copy')}</button></div>
              <div class="envrow"><div class="grow"><b>VOO_WEBHOOK_SECRET</b><p>Signs every event Vooads sends: <span class="k">X-Voo-Signature: sha256=…</span></p></div>${envPill(secSet)}<button class="iconbtn" data-copy="VOO_WEBHOOK_SECRET" aria-label="Copy name">${ico('copy')}</button></div>
              <div class="envrow"><div class="grow"><b>VOO_SUPPORT_EVENTS_URL</b><p>Optional. Default events URL when the field above is empty.</p></div><button class="iconbtn" data-copy="VOO_SUPPORT_EVENTS_URL" aria-label="Copy name">${ico('copy')}</button></div>
            </div>
          </div>
          <div class="note"><b>Full guide:</b> <span class="k">docs/VOOSQUARE-SUPPORT-API.md</span> in the code. It covers the login header, every endpoint with example requests and answers, the three events (<span class="k">ticket.created</span>, <span class="k">ticket.message</span>, <span class="k">ticket.updated</span>) and their data, how to check the signature, retries, and the credit cap. Every VooSquare action is saved in the activity log as <span class="k">voosquare:&lt;agent email&gt;</span>.</div>
        </div></div>
      <div class="card"><div class="card-h"><div><h3>Saved replies</h3><p>Answers your team inserts with one click in the inbox.</p></div><button class="btn ghost sm" id="mmac">${ico('bolt')} Manage saved replies</button></div></div>
    </div>`;
    bind();
  };
  const dirty = () => JSON.stringify(cfg) !== saved;
  const savebar = () => {
    let bar = $('.savebar');
    if (!manage || !r.ok || !dirty()) { bar?.remove(); return; }
    if (bar) return;
    bar = document.createElement('div'); bar.className = 'savebar';
    bar.innerHTML = `<span>Unsaved support settings</span><button class="btn ghost sm" data-d>Discard</button><button class="btn white sm" data-s>Save ${ARR()}</button>`;
    document.body.appendChild(bar);
    $('[data-d]', bar).onclick = () => { cfg = JSON.parse(saved); bar.remove(); draw(); };
    $('[data-s]', bar).onclick = async (e) => {
      const body = clone(cfg); ['events_url_default', 'service_key_set', 'webhook_secret_set'].forEach((k) => delete body.voosquare[k]);
      const x = await act(e.currentTarget, () => PUT('/api/admin/support-settings', body), 'Support settings saved');
      if (x) { cfg = merge(x.settings || (x.voosquare ? x : cfg)); saved = JSON.stringify(cfg); bar.remove(); draw(); }
    };
  };
  const bind = () => {
    $$('[data-copy]', el).forEach((b) => b.onclick = () => copy(b.dataset.copy));
    $('#cpall').onclick = () => copy(setupText());
    $('#mmac').onclick = () => macrosDrawer();
    if (ro) return;
    $('#vs-en').onclick = (e) => { cfg.voosquare.enabled = e.currentTarget.getAttribute('aria-checked') !== 'true'; draw(); savebar(); };
    $$('[data-mode]', el).forEach((b) => b.onclick = () => { cfg.voosquare.mode = b.dataset.mode; draw(); savebar(); });
    $('#vs-url').oninput = (e) => { cfg.voosquare.events_url = e.target.value.trim(); savebar(); };
    $('#vs-max').oninput = (e) => { cfg.voosquare.max_credit_grant = e.target.value === '' ? 0 : Number(e.target.value); savebar(); };
    $$('[data-sla]', el).forEach((f) => f.oninput = () => {
      const p = f.dataset.sla; cfg.sla_hours[p] = Number(f.value) || 0;
      const d = $(`[data-due="${p}"]`, el); if (d) d.textContent = 'due ' + new Date(Date.now() + cfg.sla_hours[p] * 3600e3).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      savebar();
    });
    $('#ar').onclick = (e) => { cfg.auto_reply = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', cfg.auto_reply); savebar(); };
    $('#bh').oninput = (e) => { cfg.business_hours = e.target.value; savebar(); };
  };
  draw();
};


// ---------- AI providers ----------
const ADAPTER_INFO = {
  anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-5-5', key: 'console.anthropic.com → API Keys', color: '#C96442' },
  openai: { label: 'OpenAI-compatible', model: 'gpt-4o-mini', key: 'platform.openai.com, OpenRouter, Groq, Together…', color: '#10A37F' },
  fal: { label: 'fal.ai', model: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', key: 'fal.ai/dashboard/keys', color: '#6D5BFF' },
  elevenlabs: { label: 'ElevenLabs', model: 'eleven_flash_v2_5', key: 'elevenlabs.io → Settings → API keys', color: '#121110' },
  http: { label: 'Custom HTTP API', model: '', key: 'Whatever the API needs. Use {{key}} in headers.', color: '#2AABEE' },
  mock: { label: 'Demo (free, sample results)', model: 'demo', key: 'No key needed', color: '#948F82' },
  pexels: { label: 'Pexels (free stock video)', model: '', key: 'pexels.com/api, then "Your API key" (free)', color: '#05A081', nomodel: 1 },
  pixabay: { label: 'Pixabay (free stock video)', model: '', key: 'log in at pixabay.com/api/docs, the key is shown on that page (free)', color: '#2EC66D', nomodel: 1 },
  elevenlabs_music: { label: 'ElevenLabs Music', model: 'music_v1', key: 'elevenlabs.io → Settings → API keys (same key as voices)', color: '#0B0B0A' },
  library: { label: 'Your music library (free)', model: '', key: 'No key. Upload tracks in Music library.', color: '#A19E95', nomodel: 1 },
};
const CFG_FIELDS = {
  openai: [{ k: 'base_url', l: 'API base URL', ph: 'https://api.openai.com/v1', h: 'Leave blank for OpenAI. OpenRouter: https://openrouter.ai/api/v1', full: 1 }],
  fal: [
    { k: 'image_model', l: 'Photo-to-video model', ph: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', h: 'Video only. Used when a job starts from a photo.', kinds: ['video'], full: 1 },
    { k: 'output_path', l: 'Result path', ph: 'video.url', h: 'Where the file URL is in fal\'s answer. Leave blank for the usual one.' },
    { k: 'extra', l: 'Extra model inputs (JSON)', json: 1, ta: 1, ph: '{ "resolution": "720p" }', h: 'Added to every request. Check the model page on fal.ai.', full: 1 },
  ],
  elevenlabs: [{ k: 'default_voice', l: 'Default voice ID', ph: '21m00Tcm4TlvDq8ikWAM', h: 'Used when a job does not pick a voice. Voices per presenter are in Settings.' }],
  http: [
    { k: 'url', l: 'Request URL', ph: 'https://api.example.com/v1/generate', full: 1 },
    { k: 'method', l: 'Method', sel: ['POST', 'GET', 'PUT'] },
    { k: 'output_path', l: 'Result path', ph: 'data.url or choices.0.message.content' },
    { k: 'headers', l: 'Headers (JSON)', json: 1, ta: 1, ph: '{ "Authorization": "Bearer {{key}}" }', full: 1 },
    { k: 'body', l: 'Body template (JSON)', json: 1, ta: 1, ph: '{ "prompt": "{{prompt}}", "duration": "{{duration}}" }', h: 'Use {{prompt}}, {{text}}, {{duration}}, {{aspect}}, {{image_url}}, {{audio_url}}, {{model}}.', full: 1 },
    { k: 'poll_url', l: 'Status URL (for slow jobs)', ph: 'https://api.example.com/v1/jobs/{{id}}', h: 'Only if the API returns a job id first.', full: 1 },
    { k: 'id_path', l: 'Job id path', ph: 'id' }, { k: 'done_path', l: 'Status path', ph: 'status' },
    { k: 'done_value', l: 'Status when done', ph: 'completed' }, { k: 'fail_value', l: 'Status when failed', ph: 'failed' },
  ],
};
const KIND_LABEL = { text: 'Text', image: 'Images', video: 'Video', ugc: 'UGC presenters', voice: 'Voice', dub: 'Lip-sync (dubbing)', stock: 'Stock footage', music: 'Music', matting: 'Background removal', stt: 'Speech-to-text', autoedit: 'Outside auto-edit' };
const TOOL_PIPES = ['bg_swap', 'auto_edit', 'brand_music'];
// Providers that work without an API key.
const NOKEY = ['mock', 'http', 'library'];
const KIND_GROUPS = [['Writing', ['text']], ['Pictures and video', ['image', 'video', 'ugc', 'stock', 'dub']], ['Editing tools', ['matting', 'stt', 'autoedit']], ['Sound', ['voice', 'music']]];
const KIND_HELP = {
  stock: 'Free. Animated ads (Standard) use real stock clips from here. Pexels key: pexels.com/api, then "Your API key". Pixabay key: log in at pixabay.com/api/docs and the key is shown on that page. Without a key, animated ads use AI images instead.',
  music: 'Recommended: ElevenLabs Music (direct API, about $0.15 per minute, same key as your voices). Do not use the ElevenLabs Music model on fal.ai, it costs about $0.80 per minute. "Music library" plays your own uploaded tracks for free.',
  voice: 'Mark each voice row as Standard or Ultra-realistic. Customers pick the quality; Standard uses the Standard row (e.g. eleven_flash_v2_5), Ultra uses the Ultra row (e.g. eleven_v3).',
};
const tierOfP = (p) => (p?.config?.tier === 'ultra' ? 'ultra' : 'standard');

// ---------- Integrations ----------
const ISTAT = { connected: ['good', 'Connected'], not_connected: ['plain', 'Not connected'], error: ['bad', 'Error'], untested: ['warn', 'Not tested yet'], off: ['plain', 'Off'] };
const istat = (st, t) => { const [c, l] = ISTAT[st] || ISTAT.not_connected; return `<span class="pill ${c}" ${t ? `title="${esc(t.note || '')}"` : ''}><span class="dot${st === 'connected' ? ' live' : ''}"></span>${l}</span>`; };
const inote = (t) => t ? `<div class="hint" style="margin-top:6px">${t.ok ? '✓' : '✗'} ${esc(t.note || '')} <span class="muted">· ${esc(new Date(t.at).toLocaleString())}</span></div>` : '';
VIEWS.integrations = async (el, acts) => {
  const manage = can('settings.manage');
  const d = await GET('/api/admin/integrations');
  const F = d.fields;
  const reload = () => VIEWS.integrations(el, acts);
  acts.innerHTML = `<button class="btn ghost sm" id="irf">${ico('refresh')} Refresh</button>`;
  $('#irf').onclick = reload;
  const field = (k) => { const f = F[k]; if (!f) return ''; const src = f.source === 'env' ? `<span class="pill plain" title="Set as the ${esc(f.env)} variable on the server">from ${esc(f.env)}</span>` : f.source === 'admin' ? '<span class="pill good">saved here</span>' : '';
    return `<div class="fld"><label>${esc(f.label)} ${src}</label><input class="inp sm${f.secret ? ' mono' : ''}" data-if="${k}" ${f.secret ? `type="password" autocomplete="new-password" spellcheck="false" placeholder="${f.set ? 'Saved (' + esc(f.hint) + '). Leave blank to keep it.' : 'Paste it here'}"` : `value="${esc(f.value)}" placeholder="${esc(f.help.split('. ')[0].slice(0, 60))}"`} ${manage ? '' : 'readonly disabled'}>${f.help ? `<small>${esc(f.help)}</small>` : ''}${manage && f.source === 'admin' ? `<button type="button" class="linkbtn" data-iclear="${k}" style="font-size:12px;justify-self:start">Remove the saved value${f.env ? ' (fall back to ' + esc(f.env) + ')' : ''}</button>` : ''}</div>`; };
  const card = (title, sub, status, t, body, test, extra = '') => `<div class="card"><div class="card-h"><div><h3>${title}</h3><p>${sub}</p></div>${istat(status, t)}</div><div class="card-b stack" style="gap:12px">${body}${inote(t)}
    ${manage ? `<div class="row end" style="gap:8px">${extra}${test ? `<button class="btn ghost sm" data-itest="${test}">${ico('bolt')} Test</button>` : ''}${/data-if/.test(body) ? '<button class="btn brand sm" data-isave>Save</button>' : ''}</div>` : ''}</div></div>`;
  const sv = d.server, vs = d.voosquare, st = d.storage;
  const provRows = d.providers.map((p) => `<div class="li" data-pid="${p.id}"><span style="min-width:0"><b>${esc(p.name)}</b><br><span class="hint">${esc(KIND_LABEL?.[p.kind] || p.kind)} · ${esc(ADAPTER_INFO?.[p.adapter]?.label || p.adapter)}${p.key_set ? ' · key ' + esc(p.key_hint) : ''}</span>${p.last_test ? `<br><span class="hint">${p.last_test.ok ? '✓' : '✗'} ${esc(p.last_test.note)}</span>` : ''}</span><span class="row" style="gap:6px;flex-wrap:nowrap">${istat(p.status, p.last_test)}${can('providers.manage') && p.enabled && p.adapter !== 'library' ? `<button class="btn ghost xs" data-ptest="${p.id}">Test</button>` : ''}</span></div>`).join('');
  const payRows = d.payments.map((m) => `<div class="li" data-mid="${m.id}"><span style="min-width:0"><b>${esc(m.name)}</b><br><span class="hint">${esc(m.adapter)}${m.secret_set ? ' · key ' + esc(m.secret_hint) : ''} · webhook ${m.webhook_set ? 'secret set' : 'secret missing'}</span><br><span class="hint k" style="word-break:break-all">${esc(m.webhook_url)}</span>${m.staging_problem ? `<br><span class="hint" style="color:var(--bad,#c62828)">Hidden on staging: ${esc(m.staging_problem)}</span>` : ''}${m.last_test ? `<br><span class="hint">${m.last_test.ok ? '✓' : '✗'} ${esc(m.last_test.note)}</span>` : ''}</span><span class="row" style="gap:6px;flex-wrap:nowrap">${istat(m.status, m.last_test)}${can('payments.manage') ? `<button class="btn ghost xs" data-mtest="${m.id}">Test</button>` : ''}<button class="iconbtn" data-copy="${esc(m.webhook_url)}" title="Copy webhook URL" aria-label="Copy webhook URL">${ico('copy')}</button></span></div>`).join('');
  el.innerHTML = `<div class="stack">
    <div class="card"><div class="card-h"><div><h3>Server</h3><p>On Railway only <span class="k">APP_SECRET</span> is required. Everything else can be set on this page.</p></div>${istat(sv.secret_ok ? 'connected' : 'error')}</div><div class="card-b list">
      <div class="li"><span class="muted">Public URL</span><span class="k">${esc(sv.app_url)}</span></div>
      <div class="li"><span class="muted">Environment</span><span>${(sv.env = sv.env || (sv.production ? 'production' : 'development')) === 'staging' ? '<span class="pill warn">Staging</span> test copy: emails go to staff' + (sv.staging_allowlist?.length ? ' and ' + esc(sv.staging_allowlist.join(', ')) : '') + ' only, payments in test mode' : sv.env === 'production' ? 'Production (live site)' : 'Development (test payments and on-screen login codes are on)'}${sv.railway ? ' · Railway' : ''}</span></div>
      <div class="li"><span class="muted">Version</span><span class="k">${esc(String(sv.version || 'dev').slice(0, 12))}</span></div>
      <div class="li"><span class="muted">APP_SECRET</span>${sv.secret_ok ? '<span class="pill good">Set</span>' : '<span class="pill bad">Not set (development secret)</span>'}</div>
      <div class="li"><span class="muted">Owner email (OWNER_EMAIL)</span><span>${sv.owner_email_set ? 'Set' : 'Not set: the first owner uses the setup link in the server log'}</span></div></div></div>
    <div class="grid2">
      ${card('Site and brand', 'Your public address and the details customers see.', F['site.app_url'].set || sv.railway ? 'connected' : 'untested', null, field('site.app_url') + field('brand.company') + field('brand.support_email'), '')}
      ${card('Email sending (Resend)', 'Login codes, receipts, ticket replies and the email sequences.', d.email.status, d.email.last_test, field('email.resend_key') + field('email.from') + field('email.webhook_secret'), 'email')}
    </div>
    <div class="secth" style="margin:6px 0 -4px"><span>VooSquare</span></div>
    <div class="grid2">
      ${card('Voo ID login', '"Continue with Voo ID" on the login page (shared Zedapex login).', vs.login.status, vs.login.last_test, field('voosquare.issuer') + field('voosquare.client_id') + field('voosquare.client_secret'), 'voosquare-login')}
      ${card('Events to VooSquare', `Dashboard feed and support inbox events, signed with your secret. Support mode: <b>${esc(vs.events.support_mode)}</b>${vs.events.support_enabled ? '' : ' (VooSquare support is off in Support settings)'}.`, vs.events.status, vs.events.last_test, field('voosquare.webhook_secret') + field('voosquare.events_url') + field('voosquare.support_events_url'), 'voosquare-events')}
    </div>
    ${card('VooSquare inbound API', `VooSquare reads your summary and tickets with a service key.${vs.inbound.last_call_at ? ' Last call: ' + esc(new Date(vs.inbound.last_call_at).toLocaleString()) + '.' : ''}`, vs.inbound.status, vs.inbound.last_test, `<div class="list">${vs.inbound.endpoints.map((u) => `<div class="li"><span class="k" style="word-break:break-all">${esc(u)}</span></div>`).join('')}</div><div class="hint">Key: ${F['voosquare.service_key'].set ? esc(F['voosquare.service_key'].hint) + ' (' + (F['voosquare.service_key'].source === 'env' ? 'from VOO_SERVICE_KEY' : 'saved here') + ')' : 'not set'}</div><div id="newkey"></div>`, 'voosquare-inbound', `<button class="btn ghost sm" id="genkey">${ico('refresh')} ${F['voosquare.service_key'].set ? 'Replace key' : 'Generate key'}</button>`)}
    <div class="secth" style="margin:6px 0 -4px"><span>AI providers</span></div>
    <div class="card"><div class="card-h"><div><h3>AI providers</h3><p>Video, images, voice, music, stock footage, dubbing and the script writer. Jobs without a working provider use the free demo.</p></div><a class="btn ghost sm" href="#/providers">Manage</a></div><div class="card-b list">${provRows || '<p class="muted">No providers yet.</p>'}</div></div>
    <div class="secth" style="margin:6px 0 -4px"><span>Payments</span></div>
    <div class="card"><div class="card-h"><div><h3>Payment methods</h3><p>Paste each webhook URL into the provider's dashboard. Tests make a read-only call and never charge anyone.</p></div><a class="btn ghost sm" href="#/methods">Manage</a></div><div class="card-b list">${payRows || '<p class="muted">No payment methods yet.</p>'}</div></div>
    ${card('Storage and media', 'Generated videos, uploads, the music library and website samples.', st.status, st.last_test, `<div class="list">
      <div class="li"><span class="muted">Data folder</span><span class="k">${esc(st.data_dir)}</span></div>
      <div class="li"><span class="muted">Volume</span>${st.volume ? '<span class="pill good">Persistent</span>' : '<span class="pill bad">No Volume: files are lost on redeploy</span>'}</div>
      ${st.disk ? `<div class="li"><span class="muted">Free space</span><span>${st.disk.free_gb} GB of ${st.disk.total_gb} GB</span></div>` : ''}
      <div class="li"><span class="muted">ffmpeg (long videos, animated ads)</span>${st.ffmpeg ? '<span class="pill good">Ready</span>' : '<span class="pill warn">Missing: playlists instead</span>'}</div>
      <div class="li"><span class="muted">Saved media files</span><span>${num(st.media_files).toLocaleString()}</span></div>
      <div class="li"><span class="muted">Website samples copied</span><span>${st.samples_local} of ${st.samples_total}</span></div></div>`, 'storage')}
    ${can('*') ? `<div class="card"><div class="card-h"><div><h3>Database backups</h3><p>A copy of the database is saved before every update (newest 10 kept, in the Volume under <span class="k">backups/</span>). Owners only. Videos in <span class="k">media/</span> are not included: use Railway volume backups for those.</p></div><button class="btn ghost sm" id="bknow">${ico('plus')} Back up now</button></div><div class="card-b list" id="bklist"><p class="muted">Loading…</p></div></div>` : ''}
  </div>`;
  if (can('*')) {
    const fmtB = (n) => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
    const showBk = (list) => { $('#bklist').innerHTML = list.length ? list.map((b) => `<div class="li"><span style="min-width:0"><b class="mono" style="font-size:12.5px;word-break:break-all">${esc(b.name)}</b><br><span class="hint">${esc(new Date(b.created_at).toLocaleString())} · ${fmtB(b.bytes)}</span></span><a class="btn ghost xs" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>Download</a></div>`).join('') : '<p class="muted">No backups yet. One is made automatically at the next deploy, or press Back up now.</p>'; };
    GET('/api/admin/backups').then((x) => showBk(x.backups)).catch(() => { $('#bklist').innerHTML = '<p class="muted">Could not load backups.</p>'; });
    $('#bknow').onclick = async (e) => { const x = await act(e.currentTarget, () => POST('/api/admin/backups'), 'Backup saved'); if (x) showBk(x.backups); };
  }
  $$('[data-copy]', el).forEach((b) => b.onclick = () => copy(b.dataset.copy));
  if (!manage) return;
  $$('[data-isave]', el).forEach((b) => b.onclick = async () => {
    const values = {}; $$('[data-if]', b.closest('.card')).forEach((i) => { if (i.value.trim() && (i.type === 'password' || i.value.trim() !== (F[i.dataset.if].value || ''))) values[i.dataset.if] = i.value.trim(); });
    if (!Object.keys(values).length) return toast('Nothing changed');
    if (await act(b, () => PUT('/api/admin/integrations', { values }), 'Saved')) reload();
  });
  $$('[data-iclear]', el).forEach((b) => b.onclick = async () => { if (await act(null, () => PUT('/api/admin/integrations', { clear: [b.dataset.iclear] }), 'Removed')) reload(); });
  $$('[data-itest]', el).forEach((b) => b.onclick = async () => { const x = await act(b, () => POST('/api/admin/integrations/test/' + b.dataset.itest)); if (x) { toast((x.ok ? 'Working: ' : 'Not working: ') + x.note, !x.ok); reload(); } });
  $$('[data-ptest]', el).forEach((b) => b.onclick = async () => { const x = await act(b, () => POST(`/api/admin/providers/${b.dataset.ptest}/test`)); if (x) { toast((x.ok ? 'Working: ' : 'Not working: ') + (x.note || ''), !x.ok); reload(); } });
  $$('[data-mtest]', el).forEach((b) => b.onclick = async () => { const x = await act(b, () => POST(`/api/admin/payment-methods/${b.dataset.mtest}/test`)); if (x) { toast((x.ok ? 'Working: ' : 'Not working: ') + (x.note || ''), !x.ok); reload(); } });
  $('#genkey').onclick = async (e) => {
    if (F['voosquare.service_key'].set && !confirm('Replace the VooSquare service key? VooSquare stops working until you paste the new key there.')) return;
    const x = await act(e.currentTarget, () => POST('/api/admin/integrations/voosquare/service-key'));
    if (!x) return;
    $('#newkey').innerHTML = `<div class="note brand"><b>Copy this key now.</b> It is shown only once. Paste it into VooSquare as the Vooads service key.<div class="row" style="flex-wrap:nowrap;margin-top:8px"><input class="inp sm mono grow" readonly value="${esc(x.key)}"><button class="btn ghost sm" id="cpk">${ico('copy')} Copy</button></div></div>`;
    $('#cpk').onclick = () => copy(x.key);
  };
};

VIEWS.providers = async (el, acts) => {
  const manage = can('providers.manage');
  const r = await GET('/api/admin/providers');
  const kinds = r.kinds, caps = r.capabilities;
  if (manage) { acts.innerHTML = `<button class="btn brand sm" id="addp">${ico('plus')} Add provider</button>`; $('#addp').onclick = () => providerDrawer(null, r, reload); }
  const reload = () => VIEWS.providers(el, acts);
  // Same order the server uses: default first, then priority, then id.
  const order = (list) => list.slice().sort((a, b) => (b.is_default - a.is_default) || (a.priority - b.priority) || (a.id - b.id));
  const usable = (p) => p.enabled && (p.key_set || p.key_shared || NOKEY.includes(p.adapter));
  el.innerHTML = `<div class="stack">
    <div class="card pad"><div class="flow"><span>How a job picks a provider:</span><span class="chip b">Default</span><span>→</span><span class="chip">Other switched-on providers, lowest priority number first</span><span>→</span><span class="chip">Free demo</span></div>
    <p class="hint" style="margin-top:8px">Providers without an API key are skipped. If one fails, the next one is tried automatically.</p></div>
    ${(() => { const seen = new Set(KIND_GROUPS.flatMap((g) => g[1])); const groups = KIND_GROUPS.map(([g, ks]) => [g, ks.filter((k) => kinds[k])]).filter((g) => g[1].length); const rest = Object.keys(kinds).filter((k) => !seen.has(k)); if (rest.length) groups.push(['Other', rest]); return groups; })().map(([g, ks]) => `<div class="secth" style="margin:10px 0 -4px"><span>${esc(g)}</span></div>` + ks.map((k, i) => {
      const list = order(r.providers.filter((p) => p.kind === k));
      const live = list.filter(usable);
      return `<div class="card kind" style="animation:up .45s var(--ease) both;animation-delay:${i * 50}ms"><div class="card-h"><div class="row" style="gap:12px;flex-wrap:nowrap"><span class="kind-ic">${ico(k)}</span><div><h3>${esc(KIND_LABEL[k] || k)}</h3><p>${esc(kinds[k])}</p></div></div>
        ${S.me.demo?.[k] || !live.length ? `<span class="pill warn"><span class="dot"></span>${S.me.demo?.[k] ? 'Demo mode' : 'Not set up'}</span>` : `<span class="pill good"><span class="dot live"></span>Live · ${esc(live[0]?.name || '')}</span>`}</div>
        ${KIND_HELP[k] ? `<div class="card-b" style="padding-top:12px;padding-bottom:12px;border-bottom:1px solid var(--line);background:var(--soft)"><p class="hint" style="font-size:13px;line-height:1.55">${esc(KIND_HELP[k])}</p>${k === 'music' ? '<a class="linkbtn" href="#/music" style="font-size:13px">Open the music library</a>' : k === 'voice' ? '<a class="linkbtn" href="#/voice" style="font-size:13px">Pronunciation dictionary</a>' : ''}</div>` : ''}
        ${list.length ? list.map((p) => `<div class="prov ${p.is_default ? 'def' : ''} ${p.enabled ? '' : 'off'}" data-id="${p.id}">
          <button class="defbtn ${p.is_default ? 'on' : ''}" data-def ${!manage || p.is_default ? 'disabled' : ''} title="${p.is_default ? 'This is the default' : 'Make this the default'}"><i></i>${p.is_default ? 'Default' : 'Set default'}</button>
          <div style="min-width:0"><h5>${esc(p.name)}</h5><div class="meta">${p.kind === 'voice' ? `<span class="pill ${tierOfP(p) === 'ultra' ? 'violet' : 'plain'}">${tierOfP(p) === 'ultra' ? 'Ultra-realistic' : 'Standard'}</span>` : ''}<span>${esc(ADAPTER_INFO[p.adapter]?.label || p.adapter)}</span>${p.model ? `<span class="k">${esc(p.model)}</span>` : ''}${p.cost_usd ? `<span>${money(p.cost_usd, p.cost_usd < 1 ? 3 : 2)} ${esc(p.cost_unit || '')}</span>` : ''}
            ${NOKEY.includes(p.adapter) ? '' : p.key_set ? `<span class="pill good">Key ${esc(p.key_hint)}</span>` : p.key_shared ? '<span class="pill good" title="fal rows without their own key use the key saved on another fal row">Uses the shared fal key</span>' : '<span class="pill bad">No key · skipped</span>'}${p.config?.level && ['ugc', 'video'].includes(p.kind) ? `<span class="pill ${p.config.level === 'ultra' ? 'ink' : p.config.level === 'pro' ? 'brand' : 'plain'}">${esc({ standard: 'Standard', pro: 'Pro realistic', ultra: 'Ultra cinematic' }[p.config.level] || p.config.level)}</span>` : ''}</div></div>
          <div class="ctl">${manage ? `<label class="hint" title="Lower runs first">Priority <input class="inp sm prio" type="number" min="1" max="1000" value="${p.priority}" data-prio></label>
            <label class="swl" title="${p.enabled ? 'On' : 'Off'}">${sw(p.enabled, 'data-en aria-label="Enabled"')}</label>
            ${p.adapter === 'library' ? '<a class="btn ghost xs" href="#/music">Tracks</a>' : `<button class="btn ghost xs" data-test>${ico('bolt')} Test</button>`}<button class="iconbtn" data-edit title="Edit" aria-label="Edit">${ico('edit')}</button>`
            : `${p.enabled ? '<span class="pill good">On</span>' : '<span class="pill plain">Off</span>'}<span class="pill plain">Priority ${p.priority}</span>`}</div>
          <div class="test-note" hidden></div>
          ${p.notes ? `<div class="hint pnote">${esc(p.notes)}</div>` : ''}
        </div>`).join('') : `<div class="card-b muted">No providers for this job yet. ${manage ? 'Add one with the button above.' : ''}</div>`}
      </div>`;
    }).join('')).join('')}</div>`;
  const byId = (id) => r.providers.find((p) => p.id === Number(id));
  $$('.prov', el).forEach((row) => {
    const p = byId(row.dataset.id);
    const put = (b, msg) => act(null, () => PUT('/api/admin/providers/' + p.id, b), msg).then((x) => { if (x) reload(); return x; });
    $('[data-def]', row) && ($('[data-def]', row).onclick = (e) => { e.currentTarget.disabled = true; put({ is_default: true }, p.name + ' is now the default for ' + (KIND_LABEL[p.kind] || p.kind).toLowerCase()); });
    $('[data-en]', row) && ($('[data-en]', row).onclick = (e) => {
      const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', on);
      put({ enabled: on }, p.name + (on ? ' switched on' : ' switched off'));
    });
    $('[data-prio]', row) && ($('[data-prio]', row).onchange = (e) => put({ priority: Number(e.target.value) }, 'Priority saved'));
    $('[data-edit]', row) && ($('[data-edit]', row).onclick = () => providerDrawer(p, r, reload));
    $('[data-test]', row) && ($('[data-test]', row).onclick = async (e) => {
      const btn = e.currentTarget;
      const x = await act(btn, () => POST(`/api/admin/providers/${p.id}/test`));
      if (!x) return;
      const n = $('.test-note', row); n.hidden = false;
      n.innerHTML = `<span class="pill ${x.ok ? 'good' : 'bad'}">${x.ok ? 'Working' : 'Not working'}</span> <span class="muted">${esc(x.note || '')}</span>`;
      toast((x.ok ? 'Test passed: ' : 'Test failed: ') + (x.note || ''), !x.ok);
    });
  });
};

function providerDrawer(p, meta, done) {
  const isNew = !p;
  const st = { kind: p?.kind || 'text', adapter: p?.adapter || 'anthropic' };
  const cfg = clone(p?.config || {});
  const adaptersFor = (kind) => Object.keys(meta.capabilities).filter((a) => meta.capabilities[a].includes(kind));
  const d = openDrawer({
    title: isNew ? 'Add an AI provider' : esc(p.name),
    sub: isNew ? 'Pick the job, the service, then paste its key.' : esc((KIND_LABEL[p.kind] || p.kind) + ' · ' + (ADAPTER_INFO[p.adapter]?.label || p.adapter)),
    body: '<div id="pf"></div>',
    foot: `${isNew ? '' : '<button class="btn dghost sm" id="pdel" style="margin-right:auto">Delete</button>'}<button class="btn ghost sm" id="pcancel">Cancel</button><button class="btn brand sm" id="psave">${isNew ? 'Add provider' : 'Save changes'}</button>`,
  });
  const draw = () => {
    const info = ADAPTER_INFO[st.adapter] || {};
    const fields = (CFG_FIELDS[st.adapter] || []).filter((f) => !f.kinds || f.kinds.includes(st.kind));
    $('#pf', d).innerHTML = `<div class="fields">
      ${isNew ? `<div class="fld"><label>What job does it do?</label><select class="inp sm" id="pk">${Object.keys(meta.kinds).map((k) => `<option value="${k}" ${k === st.kind ? 'selected' : ''}>${esc(KIND_LABEL[k] || k)}</option>`).join('')}</select><small>${esc(meta.kinds[st.kind])}</small></div>
      <div class="fld"><label>Service</label><select class="inp sm" id="pa">${adaptersFor(st.kind).map((a) => `<option value="${a}" ${a === st.adapter ? 'selected' : ''}>${esc(ADAPTER_INFO[a]?.label || a)}</option>`).join('')}</select></div>` : ''}
      <div class="fld full"><label>Display name</label><input class="inp sm" id="pn" maxlength="60" value="${esc(p?.name || '')}" placeholder="${esc(info.label + ' (' + (KIND_LABEL[st.kind] || st.kind).toLowerCase() + ')')}"></div>
      ${st.adapter === 'mock' || info.nomodel ? '' : `<div class="fld full"><label>Model</label><input class="inp sm mono" id="pm" value="${esc(p?.model || '')}" placeholder="${esc(info.model || 'model id')}"></div>`}
      ${st.kind === 'voice' ? `<div class="fld full"><label>Voice quality</label><div class="rcards" id="ptier" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[['standard', 'Standard', 'The everyday voice. Cheaper, fast. e.g. eleven_flash_v2_5.'], ['ultra', 'Ultra-realistic', 'Used when the customer picks Ultra (paid add-on). e.g. eleven_v3.']].map(([v, l, h]) => `<button type="button" class="rcard ${(cfg.tier === 'ultra' ? 'ultra' : 'standard') === v ? 'on' : ''}" data-tier="${v}"><b><i></i>${l}</b><span>${h}</span></button>`).join('')}</div><small>Have one Standard and one Ultra voice row switched on. The profit guard prices each tier from its row's cost.</small></div>` : ''}
      ${st.adapter === 'mock' || st.adapter === 'library' ? '' : `<div class="fld full"><label>API key</label><div class="row" style="flex-wrap:nowrap"><input class="inp sm mono grow" id="pkey" type="password" autocomplete="new-password" spellcheck="false" placeholder="${p?.key_set ? 'Saved (' + esc(p.key_hint) + '). Leave blank to keep it.' : 'Paste the API key'}"><button type="button" class="iconbtn" id="peye" title="Show" aria-label="Show key">${ico('eye')}</button></div>
        <small>Where to get it: ${esc(info.key || '')}. Keys are stored encrypted and never shown again.</small>
        ${p?.key_set ? '<label class="chk"><input type="checkbox" id="pclear"><span>Remove the saved key</span></label>' : ''}</div>`}
      <div class="fld"><label>Your cost (USD)</label><input class="inp sm" id="pc" type="number" step="0.0001" min="0" value="${esc(p?.cost_usd ?? '')}" placeholder="0.07"></div>
      <div class="fld"><label>Cost unit</label><input class="inp sm" id="pu" value="${esc(p?.cost_unit || '')}" placeholder="per second"></div>
      <div class="fld"><label>Priority</label><input class="inp sm" id="pp" type="number" min="1" max="1000" value="${esc(p?.priority ?? 100)}"><small>Lower runs first after the default.</small></div>
      <div class="fld"><label>Status</label><label class="swl" style="margin-top:6px">${sw(p ? p.enabled : true, 'id="pen"')}<span>Use this provider</span></label></div>
      ${fields.length ? `<div class="full dsec" style="margin-top:6px"><h4>${esc(info.label)} settings</h4></div>` : ''}
      ${fields.map((f) => {
        let v = cfg[f.k]; if (f.json && v && typeof v === 'object') v = JSON.stringify(v, null, 2);
        const input = f.sel ? `<select class="inp sm" data-cfg="${f.k}">${f.sel.map((o) => `<option ${String(v || f.sel[0]) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
          : f.ta ? `<textarea class="inp sm mono" rows="4" data-cfg="${f.k}" ${f.json ? 'data-json' : ''} placeholder="${esc(f.ph || '')}">${esc(v ?? '')}</textarea>`
          : `<input class="inp sm mono" data-cfg="${f.k}" value="${esc(v ?? '')}" placeholder="${esc(f.ph || '')}">`;
        return `<div class="fld ${f.full ? 'full' : ''}"><label>${esc(f.l)}</label>${input}${f.h ? `<small>${esc(f.h)}</small>` : ''}</div>`;
      }).join('')}
      <div class="fld full"><label>Notes for the team</label><textarea class="inp sm" id="pnotes" rows="2" placeholder="e.g. Where the key lives, when to switch">${esc(p?.notes || '')}</textarea></div>
      ${isNew && meta.providers.every((x) => x.kind !== st.kind || !x.is_default) ? '<div class="full note brand">No default for this job yet. After adding, click <b>Set default</b> to make it the first choice.</div>' : ''}
    </div>`;
    $('#pk', d) && ($('#pk', d).onchange = (e) => { st.kind = e.target.value; const a = adaptersFor(st.kind); if (!a.includes(st.adapter)) st.adapter = a[0]; draw(); });
    $('#pa', d) && ($('#pa', d).onchange = (e) => { st.adapter = e.target.value; draw(); });
    $('#peye', d) && ($('#peye', d).onclick = () => { const k = $('#pkey', d); k.type = k.type === 'password' ? 'text' : 'password'; });
    $('#pen', d).onclick = (e) => e.currentTarget.setAttribute('aria-checked', e.currentTarget.getAttribute('aria-checked') !== 'true');
    $$('[data-tier]', d).forEach((b) => b.onclick = () => { cfg.tier = b.dataset.tier; $$('[data-tier]', d).forEach((x) => x.classList.toggle('on', x === b)); });
  };
  draw();
  $('#pcancel', d).onclick = closeDrawer;
  $('#pdel', d) && ($('#pdel', d).onclick = () => confirmDel('"' + esc(p.name) + '"', async (w, btn) => {
    const x = await act(btn, () => DEL('/api/admin/providers/' + p.id), 'Provider deleted'); if (!x) return false; closeDrawer(); done();
  }));
  $('#psave', d).onclick = async (e) => {
    const c = clone(cfg);
    for (const f of $$('[data-cfg]', d)) {
      const k = f.dataset.cfg, v = f.value.trim();
      if (!v) { delete c[k]; continue; }
      if (f.hasAttribute('data-json')) { try { c[k] = JSON.parse(v); } catch { f.focus(); return toast('"' + k + '" is not valid JSON. Check quotes and commas.', true); } }
      else c[k] = v;
    }
    const b = {
      name: $('#pn', d).value.trim() || $('#pn', d).placeholder, model: $('#pm', d)?.value.trim() ?? (p?.model || (st.adapter === 'mock' ? 'demo' : '')), config: st.kind === 'voice' ? { ...c, tier: cfg.tier === 'ultra' ? 'ultra' : 'standard' } : c,
      cost_usd: Number($('#pc', d).value) || 0, cost_unit: $('#pu', d).value.trim(), priority: Number($('#pp', d).value) || 100,
      enabled: $('#pen', d).getAttribute('aria-checked') === 'true', notes: $('#pnotes', d).value.trim(),
    };
    const key = $('#pkey', d)?.value.trim(); if (key) b.api_key = key;
    if ($('#pclear', d)?.checked && !key) b.clear_key = true;
    if (isNew) { b.kind = st.kind; b.adapter = st.adapter; }
    const x = await act(e.currentTarget, () => isNew ? POST('/api/admin/providers', b) : PUT('/api/admin/providers/' + p.id, b), isNew ? 'Provider added' : 'Provider saved');
    if (x) { closeDrawer(); try { S.me = await GET('/api/admin/me'); } catch {} done(); }
  };
}

// ---------- Payment methods ----------
const METHOD_INFO = {
  stripe: { short: 'St', color: '#635BFF', keys: 'dashboard.stripe.com/apikeys (Secret key sk_live_…)', hook: 'Stripe → Developers → Webhooks → Add endpoint. Events: checkout.session.completed, invoice.paid, customer.subscription.deleted. Paste the Signing secret (whsec_…) below.', secret: 'Secret key', wh: 'Webhook signing secret' },
  paystack: { short: 'Ps', color: '#0BA4DB', keys: 'dashboard.paystack.com → Settings → API Keys & Webhooks (sk_live_…)', hook: 'Paste this URL in Paystack → Settings → API Keys & Webhooks. Paystack signs with your secret key, so no extra secret is needed.', secret: 'Secret key', fx: 1 },
  flutterwave: { short: 'Fw', color: '#F5A623', keys: 'app.flutterwave.com → Settings → APIs (FLWSECK-…)', hook: 'Flutterwave → Settings → Webhooks: paste this URL and make up a Secret hash. Paste the same hash below.', secret: 'Secret key', wh: 'Secret hash', fx: 1 },
  nowpayments: { short: 'Np', color: '#26A17B', keys: 'account.nowpayments.io → Store settings (API key + IPN secret)', hook: 'NOWPayments sends payment updates to this URL automatically. Paste your IPN secret key below.', secret: 'API key', wh: 'IPN secret key', crypto: 1 },
  gatevoo: { short: 'Gv', color: '#0B0B0A', keys: 'your Gatevoo dashboard → API keys', hook: 'Set this URL as the webhook of your app inside Gatevoo, then press its Test button. Gatevoo signs every call (X-Gatevoo-Signature over the timestamp and body); Vooads credits only paid invoices, once.', secret: 'Gatevoo API key', wh: 'Webhook secret' },
  bachs: { short: 'Ba', color: '#1F4BFF', keys: 'Bachs → Developer Portal → API keys (sk_live_…) and Webhooks (whsec_…)', hook: 'Bachs → Developer Portal → Webhooks: add this URL. Bachs signs every call (X-Bachs-Signature); Vooads then asks Bachs to confirm the payment before giving credits. Nigeria pays in naira at the rate below, everyone else in US dollars. A sandbox key (sk_sandbox_…) is never shown to customers on the live site.', secret: 'Bachs secret key', wh: 'Webhook signing secret' },
  custom: { short: '{ }', color: '#3A3833', keys: 'the provider\'s dashboard', hook: 'Paste this URL as the webhook or callback URL in the provider. Each custom method has its own URL.', secret: 'API key or secret (optional)', wh: 'Webhook signing secret' },
  test: { short: 'Te', color: '#A19E95', keys: 'No keys. Works only in development.', hook: 'Not used.' },
};
const PH_CHIPS = ['amount_usd', 'amount_local', 'amount_minor', 'currency', 'payment_id', 'reference', 'email', 'name', 'success_url', 'cancel_url', 'webhook_url', 'description'];
// Used when the server does not send config_fields for an adapter yet. Mirrors SPEC §6.
const CFG_FALLBACK = {
  gatevoo: [
    { k: 'base_url', l: 'Gatevoo API address', ph: 'https://gatevoo.com/api/v1', h: 'Leave empty for the default.', full: 1 },
  ],
  custom: [
    { sec: 'Starting a checkout' },
    { k: 'checkout_url', l: 'Checkout API URL', ph: 'https://api.provider.com/v1/payments', h: 'Vooads calls this to create a payment link.', full: 1 },
    { k: 'method', l: 'Method', type: 'select', opts: ['POST', 'PUT', 'GET'], def: 'POST' },
    { k: 'response_url_path', l: 'Where the payment link is in the answer', ph: 'data.link', h: 'Dot path in the JSON answer, e.g. data.link or checkout_url.' },
    { k: 'headers_json', l: 'Headers (JSON)', type: 'json', ph: '{ "Authorization": "Bearer {{secret}}" }', h: 'Use {{secret}} for the API key saved above.', full: 1 },
    { k: 'body_template', l: 'Body template (JSON)', type: 'template', ph: '{\n  "amount": "{{amount_local}}",\n  "currency": "{{currency}}",\n  "reference": "va_{{payment_id}}",\n  "email": "{{email}}",\n  "redirect_url": "{{success_url}}",\n  "callback_url": "{{webhook_url}}",\n  "meta": { "payment_id": "{{payment_id}}" }\n}', h: 'Click a chip to insert it where the cursor is.', full: 1 },
    { k: 'currency', l: 'Charge currency', ph: 'USD', h: 'Three letters, e.g. USD, NGN, KES.' },
    { k: 'usd_rate', l: 'Local units per $1', type: 'number', ph: '1', h: 'Used for {{amount_local}}. 1 for USD.' },
    { sec: 'Confirming the payment (webhook)' },
    { k: 'signature_header', l: 'Signature header', ph: 'x-signature', h: 'Header the provider signs webhooks with. Empty = no check.' },
    { k: 'signature_algo', l: 'Signature type', type: 'select', opts: ['sha256', 'sha512', 'none'], def: 'sha256', h: 'HMAC of the raw body with the webhook secret.' },
    { k: 'signature_prefix', l: 'Signature prefix', ph: 'sha256=', h: 'Text before the hex value, if any.' },
    { k: 'paid_path', l: 'Event field', ph: 'event', h: 'Dot path to the field that says what happened.' },
    { k: 'paid_value', l: 'Value that means paid', ph: 'charge.success' },
    { k: 'payment_id_path', l: 'Where our payment id is', ph: 'data.meta.payment_id', h: 'Dot path to the {{payment_id}} you sent.' },
    { k: 'amount_path', l: 'Where the paid amount is (optional)', ph: 'data.amount', h: 'Lets Vooads check the full amount was paid.' },
  ],
};
// Accepts the adapter's config_fields in any reasonable shape: ["key"], [{key,label,help,...}] or {key:{...}}.
function normCfgFields(cf) {
  if (!cf) return [];
  const arr = Array.isArray(cf) ? cf : Object.entries(cf).map(([k, v]) => (typeof v === 'object' ? { key: k, ...v } : { key: k, label: v }));
  return arr.map((f) => {
    if (typeof f === 'string') return { k: f, l: f.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) };
    if (f.section || f.sec) return { sec: f.section || f.sec };
    const k = f.key || f.k || f.name || f.id;
    const type = f.type === 'textarea' ? (/body|template/.test(k) ? 'template' : /json|headers/.test(k) ? 'json' : 'textarea') : f.type;
    const opts = f.options || f.opts || f.choices || f.enum;
    const ty = opts ? 'select' : (k === 'body_template' ? 'template' : /_json$|^headers/.test(k) ? 'json' : ['password', 'secret'].includes(type) ? '' : type || '');
    return { k, l: f.label || f.l || k, h: f.help || f.hint || f.h || f.description || '', ph: f.placeholder ?? f.ph ?? (f.default != null && typeof f.default !== 'object' ? String(f.default) : ''), type: ty, opts: opts && opts.map((o) => (typeof o === 'object' ? o.value ?? o.id : o)), def: f.default, full: f.full ?? (['template', 'json', 'textarea'].includes(ty) || /url$|template|json/.test(k)), required: !!f.required };
  }).filter((f) => f.k || f.sec);
}
const methodCfgFields = (adapters, adapter) => {
  const n = normCfgFields(adapters[adapter]?.config_fields);
  if (!n.length) return CFG_FALLBACK[adapter] || [];
  const fb = Object.fromEntries((CFG_FALLBACK[adapter] || []).filter((f) => f.k).map((f) => [f.k, f]));
  n.forEach((f) => { if (f.k && fb[f.k]) { if (!f.ph) f.ph = fb[f.k].ph || ''; if (!f.def && fb[f.k].def) f.def = fb[f.k].def; } });
  // Split the long custom form into two plain steps.
  if (adapter === 'custom' && !n.some((f) => f.sec)) {
    const i1 = n.findIndex((f) => f.k === 'checkout_url'); if (i1 >= 0) n.splice(i1, 0, { sec: 'Starting a checkout' });
    const i2 = n.findIndex((f) => f.k === 'signature_header'); if (i2 >= 0) n.splice(i2, 0, { sec: 'Confirming the payment (webhook)' });
  }
  return n;
};
const hookUrl = (m) => {
  const a = typeof m === 'string' ? m : m.adapter;
  if (a === 'custom') { const id = m.id ?? ''; if (m.webhook_url && /\/custom\//.test(m.webhook_url)) return location.origin + new URL(m.webhook_url, location.origin).pathname; return location.origin + '/api/webhooks/custom/' + id; }
  return location.origin + '/api/webhooks/' + a;
};
const SAMPLE_PH = { amount_usd: '49.00', amount_local: '75950.00', amount_minor: '7595000', reference: 'va_1042', name: 'Ada Obi', currency: 'NGN', payment_id: '1042', email: 'customer@example.com', success_url: location.origin + '/app#paid', cancel_url: location.origin + '/app#billing', webhook_url: location.origin + '/api/webhooks/custom/1', description: 'Vooads Pro plan (monthly)', secret: 'sk_live_••••' };
const fillTpl = (s) => String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => SAMPLE_PH[k] ?? m);

VIEWS.methods = async (el, acts) => {
  const manage = can('payments.manage');
  const r = await GET('/api/admin/payment-methods');
  const reload = () => VIEWS.methods(el, acts);
  const hasCustom = !!r.adapters.custom;
  if (manage) {
    acts.innerHTML = `<button class="btn ghost sm" id="addc" ${hasCustom ? '' : 'disabled title="Available once the server update lands"'}>${ico('code')} Add custom method</button><button class="btn brand sm" id="addm">${ico('plus')} Add method</button>`;
    $('#addc').onclick = () => modal({
      title: 'Connect any payment API', ok: 'Create custom method',
      body: `<p>Works with any provider that gives you a payment link and calls a webhook when someone pays. No code needed: you fill in where things are in their API.</p><div class="fld"><label>Name customers see</label><input class="inp" id="c-nm" maxlength="60" placeholder="e.g. Pay with mobile money"></div><p class="hint">It starts switched off so you can set it up first. Each custom method gets its own webhook URL.</p>`,
      onOk: async (w, btn) => { const x = await act(btn, () => POST('/api/admin/payment-methods', { adapter: 'custom', name: $('#c-nm', w).value.trim() || 'Custom checkout' }), 'Custom method created'); if (!x) return false; reload(); setTimeout(() => methodDrawer(x.method, r.adapters, reload), 150); },
    });
    $('#addm').onclick = () => modal({
      title: 'Add a payment method', ok: 'Add method',
      body: `<div class="fld"><label>Provider</label><select class="inp" id="m-ad">${Object.entries(r.adapters).filter(([k]) => k !== 'test').map(([k, a]) => `<option value="${k}">${esc(a.label)}</option>`).join('')}</select></div><div class="fld"><label>Name customers see</label><input class="inp" id="m-nm" maxlength="60" placeholder="e.g. Pay with card"></div><p class="hint">It starts switched off so you can add keys first.</p>`,
      onOk: async (w, btn) => { const x = await act(btn, () => POST('/api/admin/payment-methods', { adapter: $('#m-ad', w).value, name: $('#m-nm', w).value.trim() || undefined }), 'Method added'); if (!x) return false; reload(); setTimeout(() => methodDrawer(x.method, r.adapters, reload), 150); },
    });
  }
  el.innerHTML = `<div class="stack"><div class="note">Customers only see methods that are <b>switched on</b> and allowed in their country (<span class="k">*</span> = every country). Paste each <b>webhook URL</b> into the provider so paid checkouts give credits automatically.</div>
    <div class="grid2">${r.methods.length ? r.methods.map((m, i) => {
      const info = METHOD_INFO[m.adapter] || { short: m.adapter.slice(0, 2), color: '#0B0B0A' };
      const fields = r.adapters[m.adapter]?.fields || [];
      const cfgF = methodCfgFields(r.adapters, m.adapter).filter((f) => f.required || (m.adapter === 'custom' && ['checkout_url', 'response_url_path', 'paid_path', 'payment_id_path'].includes(f.k)));
      const missingCfg = cfgF.filter((f) => !m.config?.[f.k]);
      const keysOk = (!fields.includes('secret') || m.secret_set || m.adapter === 'custom') && (!fields.includes('webhookSecret') || m.webhook_set);
      const ready = keysOk && !missingCfg.length;
      const url = hookUrl(m);
      let host = ''; try { host = m.config?.checkout_url ? new URL(m.config.checkout_url).host : ''; } catch {}
      return `<div class="card mcard" data-id="${m.id}" style="animation:up .45s var(--ease) both;animation-delay:${i * 50}ms">
        <div class="top"><span class="mlogo" style="background:${info.color}">${esc(info.short)}</span><div class="grow" style="min-width:0"><h3 style="font-size:17px;letter-spacing:-.03em">${esc(m.name)}</h3><p class="hint">${esc(r.adapters[m.adapter]?.label || m.adapter)}${host ? ' · ' + esc(host) : ''}</p></div>
          ${manage ? `<label class="swl">${sw(m.enabled, 'data-en aria-label="Enabled"')}</label>` : m.enabled ? '<span class="pill good">On</span>' : '<span class="pill plain">Off</span>'}</div>
        <div class="row" style="gap:6px">${m.enabled ? '<span class="pill good"><span class="dot live"></span>Live</span>' : '<span class="pill plain">Off</span>'}
          ${fields.length || cfgF.length ? ready ? '<span class="pill good">Set up</span>' : `<span class="pill bad">${missingCfg.length ? 'Setup missing' : 'Keys missing'}</span>` : ''}
          ${r.adapters[m.adapter]?.recurring ? '<span class="pill violet">Auto-renew plans</span>' : '<span class="pill plain">One-off payments</span>'}
          ${m.config?.currency ? `<span class="pill plain">${esc(m.config.currency)}${m.config.network ? ' · ' + esc(m.config.network) : ''}${m.config.currency !== 'USD' && m.config.usd_rate ? ' · ' + esc(m.config.usd_rate) + '/USD' : ''}</span>` : ''}</div>
        <div><div class="hint" style="margin-bottom:6px">Countries</div><div class="chips">${!m.countries.length || m.countries.includes('*') ? '<span class="pill ink">All countries</span>' : m.countries.map((c) => `<span class="pill plain">${esc(c)}</span>`).join('')}</div></div>
        ${m.adapter !== 'test' ? `<div><div class="hint" style="margin-bottom:6px">Webhook URL</div><div class="copybox"><code title="${esc(url)}">${esc(url)}</code><button class="btn ghost xs" data-copy="${esc(url)}">${ico('copy')} Copy</button></div></div>` : ''}
        ${manage ? `<div class="row end"><button class="btn solid sm" data-edit>Set up ${ARR()}</button></div>` : ''}
      </div>`;
    }).join('') : `<div class="card">${emptyCard('No payment methods', 'Add Stripe, Paystack, Flutterwave, Gatevoo, crypto or any API to start taking payments.')}</div>`}</div>
    ${!hasCustom || !r.adapters.gatevoo ? naCard('Gatevoo and custom APIs are on their way', 'Your own Gatevoo checkout and the "connect any payment API" option appear in Add method as soon as the server update lands.') : ''}</div>`;
  $$('[data-copy]', el).forEach((b) => b.onclick = () => copy(b.dataset.copy));
  $$('.mcard', el).forEach((c) => {
    const m = r.methods.find((x) => x.id === Number(c.dataset.id));
    $('[data-edit]', c) && ($('[data-edit]', c).onclick = () => methodDrawer(m, r.adapters, reload));
    $('[data-en]', c) && ($('[data-en]', c).onclick = async (e) => {
      const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', on);
      if (await act(null, () => PUT('/api/admin/payment-methods/' + m.id, { enabled: on }), m.name + (on ? ' is on. Customers can use it now.' : ' switched off'))) reload();
    });
  });
};

function methodDrawer(m, adapters, done) {
  const info = METHOD_INFO[m.adapter] || {};
  const fields = adapters[m.adapter]?.fields || [];
  const cfgFields = methodCfgFields(adapters, m.adapter);
  const covered = new Set(cfgFields.map((f) => f.k));
  const url = hookUrl(m);
  const cfgVal = (f) => { const v = m.config?.[f.k]; return v == null ? (f.type === 'select' ? f.def ?? '' : '') : typeof v === 'object' ? JSON.stringify(v, null, 2) : v; };
  const cfgInput = (f) => {
    const v = cfgVal(f);
    if (f.type === 'select') return `<select class="inp sm" data-cfg="${esc(f.k)}">${(f.opts || []).map((o) => `<option ${String(v || f.def || f.opts[0]) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    if (f.type === 'template') return `<div class="phs" data-for="${esc(f.k)}">${PH_CHIPS.map((p) => `<button type="button" data-ph="${p}">{{${p}}}</button>`).join('')}</div><textarea class="inp sm mono" rows="9" data-cfg="${esc(f.k)}" data-tpl placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
    if (f.type === 'json' || f.type === 'textarea') return `<textarea class="inp sm mono" rows="4" data-cfg="${esc(f.k)}" ${f.type === 'json' ? 'data-json' : ''} placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
    return `<input class="inp sm mono" data-cfg="${esc(f.k)}" ${f.type === 'number' ? 'type="number" step="any" min="0" data-num' : ''} value="${esc(v)}" placeholder="${esc(f.ph || '')}">`;
  };
  const d = openDrawer({
    title: esc(m.name), sub: esc(adapters[m.adapter]?.label || m.adapter) + (adapters[m.adapter]?.help ? '<br>' + esc(adapters[m.adapter].help) : ''),
    body: `<div class="fields">
      ${(m.notes || []).map((w) => `<div class="fld full"><div class="hint" style="background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:10px 12px">${esc(w)}</div></div>`).join('')}
      ${(m.warnings || []).map((w) => `<div class="fld full"><div class="hint" style="background:#FFF8E6;border:1px solid #F3DFA8;border-radius:10px;padding:10px 12px;color:#6B4E00">${esc(w)}</div></div>`).join('')}
      <div class="fld full"><label>Name customers see</label><input class="inp sm" id="mn" maxlength="60" value="${esc(m.name)}"></div>
      ${fields.includes('public_key') || fields.includes('publicKey') ? `<div class="fld full"><label>Public key</label><input class="inp sm mono" id="mpk" value="${esc(m.public_key || '')}"></div>` : ''}
      ${fields.includes('secret') || m.adapter === 'custom' || m.adapter === 'gatevoo' ? `<div class="fld full"><label>${esc(info.secret || 'Secret key')}</label><input class="inp sm mono" id="ms" type="password" autocomplete="new-password" placeholder="${m.secret_set ? 'Saved (' + esc(m.secret_hint) + '). Leave blank to keep it.' : 'Paste the key'}"><small>Get it at ${esc(info.keys || '')}. Stored encrypted, never shown again.</small></div>` : ''}
      ${m.adapter !== 'test' ? `<div class="fld full"><label>Webhook URL</label><div class="copybox"><code>${esc(url)}</code><button type="button" class="btn ghost xs" data-copy>${ico('copy')} Copy</button></div><small>${esc(info.hook || '')}</small>${m.webhook_url && !m.webhook_url.startsWith(location.origin) ? `<small style="color:var(--warn)">The server's APP_URL gives ${esc(m.webhook_url)}. Use the address customers actually reach.</small>` : ''}</div>` : ''}
      ${fields.includes('webhookSecret') || m.adapter === 'custom' || m.adapter === 'gatevoo' ? `<div class="fld full"><label>${esc(info.wh || 'Webhook secret')}</label><input class="inp sm mono" id="mw" type="password" autocomplete="new-password" placeholder="${m.webhook_set ? 'Saved. Leave blank to keep it.' : 'Paste the webhook secret'}"></div>` : ''}
      ${info.fx && !covered.has('currency') ? `<div class="fld"><label>Charge currency</label><select class="inp sm" id="mcur">${['NGN', 'GHS', 'KES', 'ZAR', 'XOF', 'XAF', 'UGX', 'TZS', 'RWF', 'USD'].map((c) => `<option ${(m.config.currency || (m.adapter === 'paystack' ? 'NGN' : 'USD')) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        <div class="fld"><label>Rate: local units per $1</label><input class="inp sm" id="mrate" type="number" step="0.01" min="0" value="${esc(m.config.usd_rate ?? '')}" placeholder="1550"><small id="mfx"></small></div>` : ''}
      ${info.crypto && !covered.has('pay_currency') ? `<div class="fld full"><label>Coin to ask for (optional)</label><input class="inp sm mono" id="mpc" value="${esc(m.config.pay_currency || '')}" placeholder="usdttrc20"><small>Leave blank to let the customer choose any coin.</small></div>` : ''}
      ${cfgFields.length ? `<div class="secth"><span>${esc(info.short === '{ }' ? 'How to talk to the API' : (adapters[m.adapter]?.label || 'Provider') + ' settings')}</span></div>` : ''}
      ${cfgFields.map((f) => f.sec ? `<div class="secth"><span>${esc(f.sec)}</span></div>` : `<div class="fld ${f.full ? 'full' : ''}"><label>${esc(f.l)}${f.required ? ' <span style="color:var(--bad)">*</span>' : ''}</label>${cfgInput(f)}${f.h ? `<small>${esc(f.h)}</small>` : ''}</div>`).join('')}
      ${cfgFields.some((f) => f.type === 'template') ? `<div class="fld full"><div class="row between"><label>Check the template</label><button type="button" class="btn ghost xs" id="tplchk">${ico('eye')} Preview with sample data</button></div><div id="tplout" hidden></div></div>` : ''}
      <div class="secth"><span>Who sees it</span></div>
      <div class="fld full"><label>Countries</label><input class="inp sm" id="mc" value="${esc(m.countries.join(', '))}" placeholder="* or NG, GH, KE"><small>Two-letter codes, comma separated. <span class="k">*</span> means every country.</small>
        <div class="chips" style="margin-top:4px"><button type="button" class="btn ghost xs" data-cc="*">Everywhere</button><button type="button" class="btn ghost xs" data-cc="NG, GH, KE, ZA, CM">Africa core</button><button type="button" class="btn ghost xs" data-cc="NG">Nigeria only</button></div></div>
      <div class="fld"><label>Order at checkout</label><input class="inp sm" id="mo" type="number" min="0" max="1000" value="${esc(m.sort)}"><small>Lower shows first.</small></div>
      <div class="fld"><label>Status</label><label class="swl" style="margin-top:6px">${sw(m.enabled, 'id="men"')}<span>Customers can pay with it</span></label></div>
    </div>`,
    foot: `<button class="btn dghost sm" id="mdel" style="margin-right:auto">Delete</button><button class="btn ghost sm" id="mcancel">Cancel</button><button class="btn brand sm" id="msave">Save ${ARR()}</button>`,
  });
  $('[data-copy]', d) && ($('[data-copy]', d).onclick = () => copy(url));
  $$('[data-cc]', d).forEach((b) => b.onclick = () => { $('#mc', d).value = b.dataset.cc; });
  $('#men', d).onclick = (e) => e.currentTarget.setAttribute('aria-checked', e.currentTarget.getAttribute('aria-checked') !== 'true');
  $$('.phs [data-ph]', d).forEach((b) => b.onclick = () => {
    const ta = $(`[data-cfg="${b.closest('.phs').dataset.for}"]`, d), tok = '{{' + b.dataset.ph + '}}';
    const a = ta.selectionStart ?? ta.value.length, z = ta.selectionEnd ?? a;
    const wrapQ = !/"\s*$/.test(ta.value.slice(0, a)) && !/^\s*"/.test(ta.value.slice(z));
    const ins = wrapQ && !/amount/.test(b.dataset.ph) ? '"' + tok + '"' : tok;
    ta.value = ta.value.slice(0, a) + ins + ta.value.slice(z); ta.focus(); ta.selectionStart = ta.selectionEnd = a + ins.length;
  });
  $('#tplchk', d) && ($('#tplchk', d).onclick = () => {
    const out = $('#tplout', d); out.hidden = false;
    const ta = $('[data-tpl]', d), src = ta.value.trim() || ta.placeholder;
    const filled = fillTpl(src);
    try { const j = JSON.parse(filled); ta.classList.remove('jsonbad'); out.innerHTML = `<span class="pill good" style="margin-bottom:6px">Valid JSON</span><div class="tplcheck">${esc(JSON.stringify(j, null, 2))}</div>`; }
    catch (e) { ta.classList.add('jsonbad'); out.innerHTML = `<span class="pill bad" style="margin-bottom:6px">Not valid JSON: ${esc(e.message)}</span><div class="tplcheck">${esc(filled)}</div><small class="hint">Tip: put quotes around text placeholders, e.g. "{{email}}". Numbers like {{amount_usd}} can go without quotes.</small>`; }
  });
  const fx = () => { const rt = Number($('#mrate', d)?.value), c = $('#mcur', d)?.value; if ($('#mfx', d)) $('#mfx', d).textContent = c === 'USD' ? 'USD needs no rate.' : rt ? 'A $49 plan charges ' + c + ' ' + (49 * rt).toLocaleString() : 'Required for non-USD currencies.'; };
  $('#mrate', d) && ($('#mrate', d).oninput = fx); $('#mcur', d) && ($('#mcur', d).onchange = fx); fx();
  $('#mcancel', d).onclick = closeDrawer;
  $('#mdel', d).onclick = () => confirmDel('"' + esc(m.name) + '"', async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/payment-methods/' + m.id), 'Payment method deleted'); if (!x) return false; closeDrawer(); done(); });
  $('#msave', d).onclick = async (e) => {
    const config = clone(m.config || {});
    if ($('#mcur', d)) { config.currency = $('#mcur', d).value; const rt = $('#mrate', d).value; if (rt) config.usd_rate = Number(rt); else delete config.usd_rate; }
    if ($('#mpc', d)) { const pc = $('#mpc', d).value.trim(); if (pc) config.pay_currency = pc; else delete config.pay_currency; }
    for (const f of $$('[data-cfg]', d)) {
      const k = f.dataset.cfg, v = f.value.trim();
      f.classList.remove('jsonbad');
      if (!v) { delete config[k]; continue; }
      if (f.hasAttribute('data-json')) { try { JSON.parse(v); } catch { f.classList.add('jsonbad'); f.focus(); return toast('"' + k + '" is not valid JSON. Check quotes and commas.', true); } }
      if (f.hasAttribute('data-tpl')) { try { JSON.parse(fillTpl(v)); } catch { f.classList.add('jsonbad'); f.focus(); return toast('The body template is not valid JSON once filled in. Use "Preview with sample data" to see why.', true); } }
      config[k] = f.hasAttribute('data-num') ? Number(v) : v;
    }
    const b = { name: $('#mn', d).value.trim(), countries: $('#mc', d).value, sort: Number($('#mo', d).value), enabled: $('#men', d).getAttribute('aria-checked') === 'true', config };
    if ($('#mpk', d)) b.public_key = $('#mpk', d).value.trim();
    const s = $('#ms', d)?.value.trim(); if (s) b.secret = s;
    const w = $('#mw', d)?.value.trim(); if (w) b.webhook_secret = w;
    if (await act(e.currentTarget, () => PUT('/api/admin/payment-methods/' + m.id, b), 'Payment method saved')) { closeDrawer(); done(); }
  };
}

// ---------- Pricing & discounts ----------
const COST_LABEL = { ugc_video_per_second: 'UGC presenter video · per second', video_per_second: 'Product / b-roll video · per second', image_3_sizes: 'Image set (3 Meta sizes)', hook_pack_20: 'Hook pack (20 hooks)', script: 'Full UGC script', voice_per_second: 'Voiceover · per second', remix: 'Remix' };
const PCOST_LABEL = { ugc_video_per_second: 'UGC video, per second', video_per_second: 'Video, per second', image: 'One image', voice_per_1k_chars: 'Voice, per 1,000 characters', claude_script: 'One script (Claude)' };
// What one unit of each credit cost costs us, from provider_cost_usd. Voice assumes ~15 characters per second of speech.
const unitCost = (k, pc) => ({ ugc_video_per_second: pc.ugc_video_per_second, video_per_second: pc.video_per_second, image_3_sizes: pc.image != null ? pc.image * 3 : undefined, script: pc.claude_script, voice_per_second: pc.voice_per_1k_chars != null ? pc.voice_per_1k_chars * 0.015 : undefined }[k]);

// SPEC §4: the LOWEST price a customer can pay per credit (plans monthly and yearly/12, top-ups), minus the biggest active discount code.
// Discount codes only work on monthly billing (same as server/guard.js).
function cheapestCredit(p, discounts = []) {
  const live = (discounts || []).filter((x) => x.active && (!x.expires_at || parseDate(x.expires_at) > Date.now()) && (!x.max_uses || num(x.uses) < num(x.max_uses)));
  const disc = Math.max(0, ...live.map((x) => num(x.percent)));
  const code = live.find((x) => num(x.percent) === disc)?.code;
  const opts = [];
  for (const pl of p.plans || []) {
    if (pl.credits_month > 0) {
      opts.push({ v: pl.price_month / pl.credits_month * (1 - disc / 100), l: pl.name + ' monthly' + (disc ? ' with ' + code + ' (' + disc + '% off)' : '') });
      opts.push({ v: (num(pl.price_year) || pl.price_month * 10) / 12 / pl.credits_month, l: pl.name + ' yearly' });
    }
  }
  for (const t of p.topups || []) if (t.credits > 0) opts.push({ v: t.price / t.credits, l: 'Top-up ' + money(t.price) });
  const best = opts.filter((o) => o.v > 0).sort((a, b) => a.v - b.v)[0] || { v: p.credit_usd_value || 0.01, l: 'credit value' };
  return { v: best.v, disc, code, l: best.l };
}
// Worst-case card fee on a job's revenue (percent only: the fixed fee is per payment, not per job).
const feePct = (P) => num(P.payment_fees?.card_pct);
const ADDON_NAMES = { music: 'Background music', voice_ultra: 'Ultra-realistic voice' };
const marginOf = (credits, cost, perCredit) => { const rev = num(credits) * perCredit; return rev > 0 ? (rev - num(cost)) / rev * 100 : (num(cost) > 0 ? -100 : null); };
const marginStatus = (m, min) => m == null ? '' : m < 0 ? 'loss' : m < min ? 'low' : 'ok';
const MP_LABEL = { ok: 'OK', low: 'Low', loss: 'Loss' };
const mpPill = (s) => s ? `<span class="mp ${s}">${MP_LABEL[s]}</span>` : '<span class="muted">—</span>';
const safeCredits = (cost, min, perCredit) => perCredit > 0 ? Math.ceil(num(cost) / (1 - Math.min(95, min) / 100) / perCredit) : 0;

VIEWS.pricing = async (el) => {
  const manage = can('pricing.manage');
  const [r, mg0, pv0] = await Promise.all([GET('/api/admin/pricing'), tryGet('/api/admin/margins'), can('providers.view') ? tryGet('/api/admin/providers') : null]);
  let LM = mg0.ok ? mg0.data : null; // live guard numbers per quality level (SPEC §13)
  const PROV = pv0 && pv0.ok ? pv0.data.providers : [];
  let P = clone(r.pricing), saved = JSON.stringify(r.pricing);
  P.plans ||= []; P.topups ||= []; P.costs ||= {}; P.free_trial ||= { credits: 0, video_allowed: false }; P.provider_cost_usd ||= {};
  const hasTypes = () => Array.isArray(P.video_types);
  if (r.defaults?.addons && !P.addons) P.addons = clone(r.defaults.addons);
  P.addons ||= {}; P.voice_tiers ||= clone(r.defaults?.voice_tiers || {}); P.payment_fees ||= clone(r.defaults?.payment_fees || {});
  const ro = manage ? '' : 'readonly disabled';
  const inp = (path, val, type = 'num', extra = '') => `<input class="inp sm ${type === 'num' ? 'num' : ''}" data-path="${path}" data-type="${type}" ${type === 'num' ? 'type="number" step="any" min="0"' : ''} value="${esc(val ?? '')}" ${ro} ${extra}>`;
  const minM = () => num(P.min_margin_pct, 60);
  // Same sample the server's guard uses: 15 seconds (or the shortest allowed) for per-second types, one item otherwise; fixed cost per job included.
  const typePrev = (vt) => {
    const cheap = cheapestCredit(P, r.discounts), mm = minM();
    const unit = vt.unit === 'item' ? 'item' : 'second';
    const ex = unit === 'second' ? Math.max(num(vt.min_seconds, 5), 15) : 1;
    const credits = num(vt.credits_per_unit) * ex, cost = num(vt.provider_cost_usd_per_unit) * ex + num(vt.fixed_cost_usd);
    const rev = credits * cheap.v, m = marginOf(credits, cost, cheap.v), s = marginStatus(m, mm);
    const safeUnit = cheap.v > 0 ? Math.ceil(cost / (1 - Math.min(95, mm) / 100) / cheap.v / ex) : 0;
    const segs = unit === 'second' && num(vt.segment_seconds) > 0 ? Math.ceil(ex / num(vt.segment_seconds)) : 1;
    const col = s === 'loss' ? 'var(--bad)' : s === 'low' ? 'var(--warn)' : 'var(--good)';
    return `<div class="row between"><span class="hint mono" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase">${unit === 'second' ? ex + 's video' : 'One item'} · worst-case price</span>${mpPill(s)}</div>
      <div class="row between" style="align-items:flex-end"><div><div class="big" style="color:${col}">${m == null ? '—' : Math.round(m) + '%'}</div><small class="hint">margin</small></div><div style="text-align:right" class="mono"><div>${int(credits)} credits · ${money(rev, 2)} in</div><div class="hint">${money(cost, 2)} AI cost out</div></div></div>
      <div class="mbar"><i style="width:${Math.max(0, Math.min(100, m ?? 0))}%;background:${col}"></i><span class="min" style="left:${Math.min(99, mm)}%" title="Minimum ${mm}%"></span></div>
      <div class="hint" style="font-size:12.5px">${s === 'ok' ? `Safe. You keep at least ${money(rev - cost, 2)} on every ${unit === 'second' ? ex + 's video' : 'item'}.` : `<b style="color:${col}">Below your ${mm}% minimum.</b> Raise to at least <b>${int(safeUnit)}</b> credits per ${unit}. Until then the profit guard raises the price on each job by itself.`}${segs > 1 ? ` <span class="k">${ex}s = ${segs} parts of ${num(vt.segment_seconds)}s, stitched</span>` : ''}</div>`;
  };
  // ----- Add-ons (SPEC §12): music + ultra voice, priced per second, with card fees in the preview -----
  const addonPrev = (key, src) => {
    const a = P.addons[key] || {}, cheap = cheapestCredit(P, r.discounts), mm = minM(), fee = feePct(P);
    const secs = 15, units = key === 'music' ? Math.max(secs, num(a.min_units)) : secs;
    const lib = src === 'library';
    const credits = units * num(lib ? a.library_credits_per_unit : a.credits_per_unit);
    const cost = lib ? units * num(a.library_provider_cost_usd_per_unit) : units * num(a.provider_cost_usd_per_unit) + (key === 'music' ? num(a.fixed_cost_usd) : 0);
    const rev = credits * cheap.v, net = rev * (1 - fee / 100);
    const m = rev > 0 ? (net - cost) / rev * 100 : (cost > 0 ? -100 : null);
    const s = m == null ? '' : marginStatus(m, mm);
    const col = s === 'loss' ? 'var(--bad)' : s === 'low' ? 'var(--warn)' : 'var(--good)';
    return `<div class="row between"><span class="hint mono" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase">${lib ? 'Library track' : 'AI'} · 15s video · worst case</span>${m == null ? '<span class="mp ok">Free</span>' : mpPill(s)}</div>
      <div class="row between" style="align-items:flex-end"><div><div class="big" style="color:${m == null ? 'var(--good)' : col}">${m == null ? '$0' : Math.round(m) + '%'}</div><small class="hint">${m == null ? 'free for you and the customer' : 'margin after ' + fee + '% card fee'}</small></div><div style="text-align:right" class="mono"><div>${int(credits)} credits · ${money(rev, 3)} in</div><div class="hint">−${money(rev - net, 3)} fee · −${money(cost, 3)} AI</div></div></div>
      ${m == null ? '' : `<div class="mbar"><i style="width:${Math.max(0, Math.min(100, m))}%;background:${col}"></i><span class="min" style="left:${Math.min(99, mm)}%"></span></div>`}
      ${s && s !== 'ok' ? `<div class="hint" style="font-size:12.5px"><b style="color:${col}">Below your ${mm}% minimum.</b> Raise to at least <b>${int(Math.ceil(cost / ((1 - fee / 100) - Math.min(95, mm) / 100) / cheap.v / units))}</b> credits per second.</div>` : ''}`;
  };
  const addonsPanel = () => {
    const a = P.addons, mu = a.music || {}, vu = a.voice_ultra || {}, vt = P.voice_tiers || {}, pf = P.payment_fees || {};
    const planIds = P.plans.map((pl) => pl.id).filter(Boolean);
    const planSel = (path, v) => `<select class="inp sm" data-path="${path}" data-type="strnull" ${ro}><option value="">Free trial allowed</option>${planIds.map((p) => `<option value="${esc(p)}" ${v === p ? 'selected' : ''}>${esc(P.plans.find((x) => x.id === p)?.name || p)}</option>`).join('')}</select>`;
    const cheap = cheapestCredit(P, r.discounts);
    return `<div class="stack">
      <div class="note" style="background:var(--soft);border-color:var(--line);color:var(--mut)">Add-ons are extras a customer switches on in the builder, charged per second of video on top of the video type. Previews use the worst-case price per credit (<b class="mono">${money(cheap.v, 4)}</b>, ${esc(cheap.l)}) minus the worst card fee, so they are the least you can earn.</div>
      <div class="grid2">
        <div class="card vt"><div class="head"><span class="kind-ic">${ico('music')}</span><h3>${esc(mu.name || 'Background music')}</h3><span class="k">music</span></div>
          <p class="hint" style="margin-top:-4px">Music under the voiceover, ducked automatically. AI music is made for each ad by the music provider; library music is a random track of the chosen mood from your uploads.</p>
          <div class="fields">
            <div class="fld"><label>AI music: credits per second</label>${inp('addons.music.credits_per_unit', mu.credits_per_unit, 'num', 'data-addonprev="music"')}</div>
            <div class="fld"><label>AI music cost per second ($)</label>${inp('addons.music.provider_cost_usd_per_unit', mu.provider_cost_usd_per_unit, 'num', 'data-addonprev="music"')}<small>ElevenLabs Music is about $0.0025.</small></div>
            <div class="fld"><label>Fixed cost per track ($)</label>${inp('addons.music.fixed_cost_usd', mu.fixed_cost_usd, 'num', 'data-addonprev="music"')}</div>
            <div class="fld"><label>Shortest charge (seconds)</label>${inp('addons.music.min_units', mu.min_units, 'num', 'data-addonprev="music"')}<small>Short videos are charged at least this.</small></div>
            <div class="fld"><label>Library: credits per second</label>${inp('addons.music.library_credits_per_unit', mu.library_credits_per_unit, 'num', 'data-addonprev="music"')}<small>0 = free for customers.</small></div>
            <div class="fld"><label>Library cost per second ($)</label>${inp('addons.music.library_provider_cost_usd_per_unit', mu.library_provider_cost_usd_per_unit, 'num', 'data-addonprev="music"')}</div>
            <div class="fld"><label>Lowest plan</label>${planSel('addons.music.min_plan', mu.min_plan)}</div>
            <div class="fld"><label>Name customers see</label>${inp('addons.music.name', mu.name, 'str')}</div>
          </div>
          <div class="prev" data-aprev="music:ai">${addonPrev('music', 'ai')}</div>
          <div class="prev" data-aprev="music:library">${addonPrev('music', 'library')}</div>
          <a class="linkbtn" href="#/music" style="font-size:13px;justify-self:start">Manage the music library</a></div>
        <div class="card vt"><div class="head"><span class="kind-ic">${ico('voice')}</span><h3>${esc(vu.name || 'Ultra-realistic voice')}</h3><span class="k">voice_ultra</span></div>
          <p class="hint" style="margin-top:-4px">Swaps the standard voice for the ultra-realistic one. The price is on top of the video type; video types that include it (like Animated ad Ultra) already charge for it.</p>
          <div class="fields">
            <div class="fld"><label>Credits per second</label>${inp('addons.voice_ultra.credits_per_unit', vu.credits_per_unit, 'num', 'data-addonprev="voice_ultra"')}</div>
            <div class="fld"><label>Extra cost per second ($)</label>${inp('addons.voice_ultra.provider_cost_usd_per_unit', vu.provider_cost_usd_per_unit, 'num', 'data-addonprev="voice_ultra"')}</div>
            <div class="fld"><label>Lowest plan</label>${planSel('addons.voice_ultra.min_plan', vu.min_plan)}</div>
            <div class="fld"><label>Name customers see</label>${inp('addons.voice_ultra.name', vu.name, 'str')}</div>
          </div>
          <div class="prev" data-aprev="voice_ultra:ai">${addonPrev('voice_ultra', 'ai')}</div>
          <div class="secth"><span>Voice tiers</span></div>
          <div class="fields">${['standard', 'ultra'].map((k) => `<div class="fld"><label>${k === 'ultra' ? 'Ultra' : 'Standard'}: label</label>${inp('voice_tiers.' + k + '.label', vt[k]?.label, 'str')}</div><div class="fld"><label>${k === 'ultra' ? 'Ultra' : 'Standard'}: cost per second ($)</label>${inp('voice_tiers.' + k + '.cost_usd_per_second', vt[k]?.cost_usd_per_second)}<small>${esc(vt[k]?.provider_hint || 'Used when no voice row has a cost.')}</small></div>`).join('')}</div>
          <a class="linkbtn" href="#/providers" style="font-size:13px;justify-self:start">Pick which voice row is Standard or Ultra</a></div>
      </div>
      <div class="card"><div class="card-h"><div><h3>Payment fees</h3><p>The worst fee a payment provider takes. Used in these previews only; the profit guard keeps its own minimum margin, so set that high enough to cover fees.</p></div></div>
        <div class="card-b"><div class="fields" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
          <div class="fld"><label>Card fee (%)</label>${inp('payment_fees.card_pct', pf.card_pct, 'num', 'data-addonprev="all"')}</div>
          <div class="fld"><label>Card fixed fee ($ per payment)</label>${inp('payment_fees.card_fixed_usd', pf.card_fixed_usd)}<small>Per payment, not per job, so not in the previews.</small></div>
          <div class="fld"><label>Crypto fee (%)</label>${inp('payment_fees.crypto_pct', pf.crypto_pct)}</div>
        </div>${pf.note ? `<p class="hint" style="margin-top:10px;font-size:12.5px">${esc(pf.note)}</p>` : ''}</div></div>
    </div>`;
  };
  // ----- Quality levels (SPEC §13): model, credits per unit, lowest plan and the guard's margin per level -----
  const LV_ORDER = ['standard', 'pro', 'ultra'];
  const lvRow = (vt, l) => LM && (LM.rows || []).find((x) => x.kind === 'video_type_level' && x.id === vt.id + ':' + l.id);
  const lvMargin = (vt, l) => {
    const g = lvRow(vt, l);
    if (!g) return { html: '<span class="hint">Save to check the margin.</span>', s: '' };
    const per = num(LM.usd_per_credit), mm = minM();
    const credits = num(g.credits) + (num(l.credits_per_unit) - num(g.credits_per_unit)) * num(g.sample_units, 1);
    const m = marginOf(credits, g.provider_cost_usd, per), s = marginStatus(m, mm);
    const col = s === 'loss' ? 'var(--bad)' : s === 'low' ? 'var(--warn)' : 'var(--good)';
    const safeU = s !== 'ok' && per > 0 ? Math.ceil(num(l.credits_per_unit) + (Math.ceil(num(g.provider_cost_usd) / (1 - Math.min(95, mm) / 100) / per) - credits) / num(g.sample_units, 1)) : null;
    const smp = g.sample?.seconds ? (vt.unit === 'item' ? g.sample.seconds + 's hook' : g.sample.seconds + 's sample') : 'sample';
    return { s, html: `${mpPill(s)}<div class="mbar"><i style="width:${Math.max(0, Math.min(100, m ?? 0))}%;background:${col}"></i><span class="min" style="left:${Math.min(99, mm)}%"></span></div><b style="color:${col}">${m == null ? '—' : Math.round(m) + '%'}</b><span>${int(credits)} cr · AI ${money(g.provider_cost_usd, 2)} on the ${esc(smp)}</span>${safeU ? `<span style="color:${col}">Saving raises it to <b>${int(safeU)}</b></span>` : ''}` };
  };
  const levelsPanel = (vt, i) => {
    if (!Array.isArray(vt.levels) || !vt.levels.length) return '';
    const planIds = P.plans.map((pl) => pl.id).filter(Boolean);
    const unit = vt.unit === 'item' ? 'hook' : 'second';
    const rows = vt.levels.map((l, j) => ({ l, j })).sort((a, b) => LV_ORDER.indexOf(a.l.id) - LV_ORDER.indexOf(b.l.id));
    return `<div class="lvadm"><div class="row between"><span class="hint mono" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase">Quality levels</span><span class="hint" style="font-size:12px">Margins use the worst-case credit price</span></div>
      ${rows.map(({ l, j }) => {
        const opts = PROV.filter((p) => p.kind === vt.provider_kind && (p.config?.level || 'standard') === l.id);
        const cur = opts.find((p) => p.config?.tag === l.provider_tag);
        const mg = lvMargin(vt, l);
        return `<div class="lvr ${l.enabled === false ? 'off' : ''}" data-lvr="${i}:${j}">
          <div class="top"><b>${esc(l.name || l.id)}</b><span class="k">${esc(l.id)}</span>${cur && !cur.enabled ? '<span class="pill warn" title="Switch it on in AI providers">Model off</span>' : ''}<span style="flex:1"></span><label class="swl" title="Customers can pick this level">${sw(l.enabled !== false, `data-lven="${i}:${j}" ${manage ? '' : 'disabled'}`)}</label></div>
          <div class="fields">
            <div class="fld"><label>Model</label>${opts.length ? `<select class="inp sm" data-lvmodel="${i}:${j}" ${ro}>${opts.map((p) => `<option value="${esc(p.config?.tag || '')}" ${p.config?.tag === l.provider_tag ? 'selected' : ''}>${esc(p.name.replace(/ on fal.*$/, ''))} · $${esc(p.cost_usd)}/s${p.enabled ? '' : ' (off)'}</option>`).join('')}</select>` : `<input class="inp sm" value="${esc(l.model_label || '')}" readonly title="Add a ${esc(vt.provider_kind)} provider with level ${esc(l.id)} in AI providers">`}</div>
            <div class="fld"><label>Name customers see</label>${inp(`video_types.${i}.levels.${j}.model_label`, l.model_label, 'str')}</div>
            <div class="fld"><label>Credits per ${unit}</label>${inp(`video_types.${i}.levels.${j}.credits_per_unit`, l.credits_per_unit, 'num', `data-lvprev="${i}:${j}"`)}</div>
            <div class="fld"><label>Lowest plan</label><select class="inp sm" data-path="video_types.${i}.levels.${j}.min_plan" data-type="strnull" ${ro}><option value="">Same as the video type</option>${planIds.map((p) => `<option value="${esc(p)}" ${l.min_plan === p ? 'selected' : ''}>${esc(P.plans.find((x) => x.id === p)?.name || p)}</option>`).join('')}</select></div>
          </div>
          <div class="lvm" data-lvm="${i}:${j}">${mg.html}</div></div>`;
      }).join('')}</div>`;
  };
  // Change background / Auto-edit / Brand music (SPEC §14): their own price fields.
  const toolFields = (vt, i) => {
    if (vt.pipeline === 'bg_swap') return `<div class="fld"><label>AI background extra (credits)</label>${inp(`video_types.${i}.extras.ai_background`, (vt.extras || {}).ai_background)}<small>Added when the customer asks AI to make the scene.</small></div>
      <div class="fld"><label>Our ffmpeg cost per second ($)</label>${inp(`video_types.${i}.compute_cost_usd_per_second`, vt.compute_cost_usd_per_second)}</div>
      <div class="fld"><label>Longest upload (s)</label>${inp(`video_types.${i}.upload.max_seconds`, (vt.upload || {}).max_seconds)}</div><div class="fld"><label>Biggest upload (MB)</label>${inp(`video_types.${i}.upload.max_mb`, (vt.upload || {}).max_mb)}</div>`;
    if (vt.pipeline === 'auto_edit') return `<div class="fld"><label>Minimum credits per edit</label>${inp(`video_types.${i}.min_credits`, vt.min_credits)}<small>Short clips still pay for the transcript and the AI plan.</small></div>
      <div class="fld"><label>Our ffmpeg cost per second ($)</label>${inp(`video_types.${i}.compute_cost_usd_per_second`, vt.compute_cost_usd_per_second)}</div>
      <div class="fld"><label>Longest upload (s)</label>${inp(`video_types.${i}.upload.max_seconds`, (vt.upload || {}).max_seconds)}</div><div class="fld"><label>Biggest upload (MB)</label>${inp(`video_types.${i}.upload.max_mb`, (vt.upload || {}).max_mb)}</div>`;
    if (vt.pipeline === 'brand_music') return `<div class="fld full"><label>Credits per track length</label><div class="planmax">${[15, 30, 60, 120].map((sx) => `<div class="fld"><label>${sx}s</label>${inp(`video_types.${i}.price_by_seconds.${sx}`, (vt.price_by_seconds || {})[sx])}</div>`).join('')}</div><small>The profit guard raises any length that would earn under the minimum margin.</small></div>`;
    return '';
  };
  const updLevelPrev = (i, j) => { const box = $(`[data-lvm="${i}:${j}"]`, el), vt = P.video_types[i]; if (box && vt) box.innerHTML = lvMargin(vt, vt.levels[j]).html; };
  const updAddonPrev = () => $$('[data-aprev]', el).forEach((b) => { const [k, s] = b.dataset.aprev.split(':'); b.innerHTML = addonPrev(k, s); });
  const updTypePrev = (i) => { const box = $(`[data-prev="${i}"]`, el); if (box && P.video_types[i]) box.innerHTML = typePrev(P.video_types[i]); };
  const draw = () => {
    const cheap = cheapestCredit(P, r.discounts);
    const VT = P.video_types || [];
    const planIds = P.plans.map((pl) => pl.id).filter(Boolean);
    el.innerHTML = `<div class="stack">
      <div class="tabs" id="ptabs"><button class="on" data-t="plans">Plans</button><button data-t="types">Video types${hasTypes() ? ' (' + VT.length + ')' : ''}</button><button data-t="addons">Add-ons</button><button data-t="topups">Top-ups</button><button data-t="costs">Credit costs & margin</button><button data-t="disc">Discount codes (${r.discounts.filter((x) => x.active).length})</button></div>
      <div data-p="types" hidden><div class="stack">
        <div class="note brand" style="background:var(--soft);border-color:var(--line);color:var(--mut)">Worst-case price per credit: <b class="mono">${money(cheap.v, 4)}</b> (${esc(cheap.l)}). Every preview below uses it, so margins are the lowest you can ever earn. Minimum margin: <b>${minM()}%</b> <a href="#/guard">change</a>.</div>
        ${!hasTypes() ? naCard('No video types yet', (r.defaults?.video_types ? 'Load the default list to start, then adjust credits and limits.' : 'The video types list arrives with the pricing update. Once it lands you can edit every type here.') + (manage && r.defaults?.video_types ? ' <button class="btn ghost xs" id="vtload" style="margin-top:10px">Load default video types</button>' : '')) : ''}
        <div class="grid2">${VT.map((vt, i) => `<div class="card vt ${vt.enabled === false ? 'off' : ''}" style="animation:up .4s var(--ease) both;animation-delay:${i * 40}ms">
          <div class="head"><h3>${esc(vt.name || 'New video type')}</h3><span class="k">${esc(vt.id || 'no id')}</span>${vt.badge ? `<span class="pill brand">${esc(vt.badge)}</span>` : ''}<span style="flex:1"></span><label class="swl" title="Customers can make this type">${sw(vt.enabled !== false, `data-vten="${i}" ${manage ? '' : 'disabled'}`)}</label>${manage ? `<button class="iconbtn" data-delvt="${i}" aria-label="Remove video type">${ico('trash')}</button>` : ''}</div>
          ${vt.description ? `<p class="hint" style="margin-top:-4px">${esc(vt.description)}</p>` : ''}
          ${vt.pipeline === 'motion_ad' || Array.isArray(vt.addons_allowed) || Array.isArray(vt.includes) ? `<div class="row" style="gap:6px"><span class="hint mono" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase">Add-ons</span>${Object.keys(ADDON_NAMES).map((a) => { const inc = (vt.includes || []).includes(a), on = (vt.addons_allowed || []).includes(a); return inc ? `<span class="pill ink" title="Always included in the price">${ADDON_NAMES[a]} · included</span>` : `<button type="button" class="pill ${on ? 'good' : 'plain'}" style="cursor:${manage ? 'pointer' : 'default'};border:0" data-addon="${i}:${a}" ${manage ? '' : 'disabled'} title="${on ? 'Customers can add this. Click to turn off.' : 'Not offered. Click to offer it.'}">${on ? ico('check').replace('<svg', '<svg style="width:12px;height:12px"') : ''}${ADDON_NAMES[a]}</button>`; }).join('')}${vt.quality ? `<span class="pill ${vt.quality === 'ultra' ? 'violet' : 'plain'}">${vt.quality === 'ultra' ? 'Ultra quality' : 'Standard quality'}</span>` : ''}</div>` : ''}
          <div class="fields">
            <div class="fld"><label>Name</label>${inp(`video_types.${i}.name`, vt.name, 'str')}</div>
            <div class="fld"><label>Badge</label>${inp(`video_types.${i}.badge`, vt.badge, 'str', 'placeholder="e.g. Most used"')}</div>
            <div class="fld"><label>Credits per ${vt.unit === 'item' ? 'item' : 'second'}</label>${inp(`video_types.${i}.credits_per_unit`, vt.credits_per_unit)}</div>
            <div class="fld"><label>Your AI cost per ${vt.unit === 'item' ? 'item' : 'second'} ($)</label>${inp(`video_types.${i}.provider_cost_usd_per_unit`, vt.provider_cost_usd_per_unit)}<small>Used when the provider has no cost set.</small></div>
            <div class="fld"><label>Fixed cost per video ($)</label>${inp(`video_types.${i}.fixed_cost_usd`, vt.fixed_cost_usd)}<small>Voice, script or image costs paid once per video.</small></div>
            ${vt.unit === 'item' || TOOL_PIPES.includes(vt.pipeline) ? '' : `<div class="fld"><label>Seconds per render</label>${inp(`video_types.${i}.segment_seconds`, vt.segment_seconds)}<small>Longer videos are made in parts and stitched.</small></div>`}${vt.unit === 'item' ? '' : `
            <div class="fld"><label>Shortest video (s)</label>${inp(`video_types.${i}.min_seconds`, vt.min_seconds)}</div>`}
            <div class="fld"><label>Lowest plan</label><select class="inp sm" data-path="video_types.${i}.min_plan" data-type="strnull" ${ro}><option value="">Free trial allowed</option>${planIds.map((p) => `<option value="${esc(p)}" ${vt.min_plan === p ? 'selected' : ''}>${esc(P.plans.find((x) => x.id === p)?.name || p)}</option>`).join('')}</select></div>
            <div class="fld"><label>Charged per</label><select class="inp sm" data-path="video_types.${i}.unit" data-type="str" data-redraw ${ro}><option value="second" ${vt.unit !== 'item' ? 'selected' : ''}>Second of video</option><option value="item" ${vt.unit === 'item' ? 'selected' : ''}>Item</option></select></div>
            ${toolFields(vt, i)}
            ${vt.unit === 'item' && vt.pipeline !== 'brand_music' ? '' : `<div class="fld full"><label>${vt.pipeline === 'brand_music' ? 'Longest track per plan (seconds)' : TOOL_PIPES.includes(vt.pipeline) ? 'Longest upload per plan (seconds)' : 'Longest video per plan (seconds)'}</label><div class="planmax">${planIds.map((p) => `<div class="fld"><label>${esc(p)}</label>${inp(`video_types.${i}.max_seconds_by_plan.${p}`, (vt.max_seconds_by_plan || {})[p])}</div>`).join('')}</div></div>`}
          </div>
          <div class="prev" data-prev="${i}">${typePrev(vt)}</div>
          ${levelsPanel(vt, i)}
        </div>`).join('')}
        ${manage && hasTypes() ? `<button class="card plan" id="addvt" style="place-items:center;cursor:pointer;border-style:dashed;min-height:200px;color:var(--mut);font-weight:800;background:transparent">${ico('plus').replace('<svg', '<svg style="width:26px;height:26px"')}Add a video type</button>` : ''}</div>
      </div></div>
      <div data-p="plans"><div class="grid2">${P.plans.map((pl, i) => `<div class="card plan" style="animation:up .4s var(--ease) both;animation-delay:${i * 40}ms">
        ${manage ? `<button class="iconbtn del" data-delplan="${i}" title="Remove plan" aria-label="Remove plan">${ico('trash')}</button>` : ''}
        <div class="row" style="gap:8px;padding-right:40px"><h3 style="font-size:18px;letter-spacing:-.03em">${esc(pl.name || 'New plan')}</h3><span class="k">${esc(pl.id || 'no id')}</span>${pl.popular ? '<span class="pill brand">Most popular</span>' : ''}</div>
        <div class="fields">
          <div class="fld"><label>Name</label>${inp(`plans.${i}.name`, pl.name, 'str')}</div>
          <div class="fld"><label>Plan ID</label>${inp(`plans.${i}.id`, pl.id, 'str', saved.includes('"id":"' + pl.id + '"') && pl.id ? 'readonly title="IDs of existing plans cannot change because customers use them"' : 'placeholder="e.g. growth"')}</div>
          <div class="fld"><label>Price / month ($)</label>${inp(`plans.${i}.price_month`, pl.price_month)}</div>
          <div class="fld"><label>Price / year ($)</label>${inp(`plans.${i}.price_year`, pl.price_year)}<small>${pl.price_month ? Math.round((1 - pl.price_year / (pl.price_month * 12)) * 100) + '% off monthly' : ''}</small></div>
          <div class="fld"><label>Credits / month</label>${inp(`plans.${i}.credits_month`, pl.credits_month)}<small>${pl.credits_month ? money(pl.price_month / pl.credits_month, 4) + ' per credit' : ''}</small></div>
          <div class="fld"><label>Seats</label>${inp(`plans.${i}.seats`, pl.seats)}</div>
          <div class="fld"><label>Max UGC length (s)</label>${inp(`plans.${i}.max_ugc_seconds`, pl.max_ugc_seconds)}</div>
          <div class="fld"><label>Max video length (s)</label>${inp(`plans.${i}.max_video_seconds`, pl.max_video_seconds)}</div>
          <div class="fld full"><label>Features (one per line)</label><textarea class="inp sm" rows="4" data-path="plans.${i}.features" data-type="lines" ${ro}>${esc((pl.features || []).join('\n'))}</textarea></div>
          <label class="chk"><input type="checkbox" data-path="plans.${i}.scripts" data-type="bool" ${pl.scripts ? 'checked' : ''} ${ro}><span>Includes AI script writer</span></label>
          <label class="chk"><input type="checkbox" data-path="plans.${i}.popular" data-type="bool" ${pl.popular ? 'checked' : ''} ${ro}><span>Show "Most popular" badge</span></label>
        </div></div>`).join('')}
        ${manage ? `<button class="card plan" id="addplan" style="place-items:center;cursor:pointer;border-style:dashed;min-height:200px;color:var(--mut);font-weight:800;background:transparent">${ico('plus').replace('<svg', '<svg style="width:26px;height:26px"')}Add a plan</button>` : ''}</div>
        <div class="card pad" style="margin-top:18px"><h3 style="font-size:17px">Free trial</h3><div class="fields" style="margin-top:12px">
          <div class="fld"><label>Free credits on sign-up</label>${inp('free_trial.credits', P.free_trial.credits)}</div>
          <div class="fld"><label>Video on the free trial</label><label class="chk" style="margin-top:8px"><input type="checkbox" data-path="free_trial.video_allowed" data-type="bool" ${P.free_trial.video_allowed ? 'checked' : ''} ${ro}><span>Allow video jobs with trial credits</span></label></div></div></div>
      </div>
      <div data-p="addons" hidden>${addonsPanel()}</div>
      <div data-p="topups" hidden><div class="card"><div class="card-h"><div><h3>Credit top-ups</h3><p>One-off credit packs. Top-up credits never expire.</p></div>${manage ? `<button class="btn ghost sm" id="addtop">${ico('plus')} Add top-up</button>` : ''}</div>
        ${tbl([{ t: 'ID' }, { t: 'Price ($)' }, { t: 'Credits' }, { t: 'Per credit', r: 1 }, { t: 'Bonus vs smallest', r: 1 }, { t: '' }], P.topups.map((t, i) => {
          const base = P.topups[0] && P.topups[0].credits ? P.topups[0].price / P.topups[0].credits : 0;
          const per = t.credits ? t.price / t.credits : 0;
          return `<tr><td data-l="ID">${inp(`topups.${i}.id`, t.id, 'str')}</td><td data-l="Price ($)">${inp(`topups.${i}.price`, t.price)}</td><td data-l="Credits">${inp(`topups.${i}.credits`, t.credits)}</td><td class="r num" data-l="Per credit">${per ? money(per, 4) : '—'}</td><td class="r num" data-l="Bonus">${base && per && i ? '+' + Math.round((base / per - 1) * 100) + '%' : '—'}</td><td class="r" data-l="">${manage ? `<button class="iconbtn" data-deltop="${i}" aria-label="Remove">${ico('trash')}</button>` : ''}</td></tr>`;
        }))}</div></div>
      <div data-p="costs" hidden><div class="stack">
        <div class="note brand" style="background:var(--soft);border-color:var(--line);color:var(--mut)">Lowest price a customer can pay per credit: <b class="mono">${money(cheap.v, 4)}</b> (${esc(cheap.l)}). Margins below use this worst case. These are the older per-job costs; video jobs use the <b>Video types</b> tab.</div>
        <div class="card"><div class="card-h"><div><h3>Credits per job</h3><p>How many credits each action uses.</p></div></div>
        ${tbl([{ t: 'Job' }, { t: 'Credits' }, { t: 'Customer pays (min)', r: 1 }, { t: 'AI cost', r: 1 }, { t: 'Margin', r: 1 }], Object.keys(P.costs).map((k) => {
          const rev = num(P.costs[k]) * cheap.v, cost = unitCost(k, P.provider_cost_usd);
          const m = cost != null && rev ? (rev - cost) / rev : null;
          return `<tr><td class="lead" data-l="Job"><b>${esc(COST_LABEL[k] || k)}</b><span class="sub k" style="display:inline-block">${esc(k)}</span></td><td data-l="Credits">${inp('costs.' + k, P.costs[k])}</td>
            <td class="r num" data-l="Customer pays">${money(rev, 3)}</td><td class="r num" data-l="AI cost">${cost != null ? money(cost, 3) : '<span class="muted">—</span>'}</td>
            <td class="r" data-l="Margin">${m == null ? '<span class="muted">—</span>' : `<span class="margin ${m * 100 >= minM() ? 'good' : m >= 0 ? 'warn' : 'bad'}">${Math.round(m * 100)}%</span>`}</td></tr>`;
        }))}</div>
        <div class="grid2"><div class="card"><div class="card-h"><div><h3>What AI costs you</h3><p>Used only for the margin estimate above.</p></div></div><div class="card-b"><div class="fields">
          ${Object.keys(P.provider_cost_usd).map((k) => `<div class="fld"><label>${esc(PCOST_LABEL[k] || k)} ($)</label>${inp('provider_cost_usd.' + k, P.provider_cost_usd[k])}</div>`).join('')}</div></div></div>
        <div class="card"><div class="card-h"><div><h3>Credit value and minimum margin</h3><p>Credit value estimates AI spend on the overview. The profit guard never lets a job run below the minimum margin.</p></div></div><div class="card-b"><div class="fields"><div class="fld"><label>1 credit is worth ($)</label>${inp('credit_usd_value', P.credit_usd_value)}</div><div class="fld"><label>Minimum margin (%)</label>${inp('min_margin_pct', P.min_margin_pct ?? 60)}</div></div>
          ${manage ? '<button class="btn ghost sm" id="reset" style="margin-top:16px">Load the default pricing</button><p class="hint" style="margin-top:6px">Fills in the original prices. Nothing changes until you save.</p>' : ''}</div></div></div>
      </div></div>
      <div data-p="disc" hidden><div class="stack">
        ${manage ? `<div class="card pad"><h3 style="font-size:17px">New discount code</h3><div class="fields" style="margin-top:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          <div class="fld"><label>Code</label><input class="inp sm mono" id="dc" placeholder="LAUNCH30" style="text-transform:uppercase"></div>
          <div class="fld"><label>Percent off</label><input class="inp sm" id="dp" type="number" min="1" max="90" placeholder="30"></div>
          <div class="fld"><label>Applies to</label><select class="inp sm" id="da"><option value="first_month">First payment only</option><option value="any">Every payment</option></select></div>
          <div class="fld"><label>Expires (optional)</label><input class="inp sm" id="de" type="date"></div>
          <div class="fld"><label>Max uses (optional)</label><input class="inp sm" id="dm" type="number" min="1" placeholder="Unlimited"></div>
          <div class="fld" style="align-self:end"><button class="btn brand sm" id="dadd">${ico('plus')} Create code</button></div></div>
          <p class="hint" style="margin-top:8px">Creating a code that already exists replaces it.</p></div>` : ''}
        <div class="card">${r.discounts.length ? tbl([{ t: 'Code' }, { t: 'Off', r: 1 }, { t: 'Applies to' }, { t: 'Used', r: 1 }, { t: 'Expires' }, { t: 'Status' }, { t: '' }], r.discounts.map((x) => `<tr><td class="lead" data-l="Code"><span class="k" style="font-size:13px;color:var(--ink)">${esc(x.code)}</span>${x.user_id ? '<span class="sub">Personal code · customer #' + x.user_id + '</span>' : ''}</td><td class="r num" data-l="Off"><b>${x.percent}%</b></td><td data-l="Applies to">${x.applies_to === 'any' ? 'Every payment' : 'First payment'}</td><td class="r num" data-l="Used">${int(x.uses)}${x.max_uses ? ' / ' + int(x.max_uses) : ''}</td><td data-l="Expires">${x.expires_at ? fdate(x.expires_at) : 'Never'}</td><td data-l="Status">${x.active ? '<span class="pill good">Active</span>' : '<span class="pill plain">Off</span>'}</td><td class="r" data-l="">${manage && x.active ? `<button class="btn dghost xs" data-off="${esc(x.code)}">Turn off</button>` : ''}</td></tr>`)) : emptyCard('No discount codes', 'Create one above to run a promo.')}</div>
      </div></div>
    </div>`;
    bind();
  };
  let tab = ['plans', 'types', 'addons', 'topups', 'costs', 'disc'].includes(location.hash.split('/')[2]) ? location.hash.split('/')[2] : 'plans';
  const dirty = () => JSON.stringify(P) !== saved;
  const savebar = () => {
    let bar = $('.savebar');
    if (!manage || !dirty()) { bar?.remove(); return; }
    if (bar) return;
    bar = document.createElement('div'); bar.className = 'savebar';
    bar.innerHTML = `<span>Unsaved pricing changes</span><button class="btn ghost sm" data-d>Discard</button><button class="btn brand sm" data-s>Save pricing</button>`;
    document.body.appendChild(bar);
    $('[data-d]', bar).onclick = () => { P = JSON.parse(saved); bar.remove(); draw(); toast('Changes discarded'); };
    $('[data-s]', bar).onclick = async (e) => {
      const x = await act(e.currentTarget, () => PUT('/api/admin/pricing', { pricing: P }), 'Pricing saved. Customers see it right away.');
      if (x) {
        P = x.pricing; saved = JSON.stringify(P); bar.remove();
        const m2 = await tryGet('/api/admin/margins'); if (m2.ok) LM = m2.data;
        draw();
        if (x.raised && x.raised.length) toast('Profit guard raised ' + x.raised.map((z) => `${z.type_name} ${z.level_name} to ${z.to} credits`).join(', ') + ' to keep the minimum margin.');
      }
    };
  };
  const setPath = (path, val) => { const ks = path.split('.'); let o = P; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; };
  const bind = () => {
    $$('#ptabs button', el).forEach((t) => t.onclick = () => { tab = t.dataset.t; showTab(); });
    showTab();
    $$('[data-path]', el).forEach((f) => {
      const ev = f.type === 'checkbox' ? 'change' : 'input';
      f.addEventListener(ev, () => {
        const t = f.dataset.type;
        const v = t === 'bool' ? f.checked : t === 'lines' ? f.value.split('\n').map((s) => s.trim()).filter(Boolean) : t === 'str' ? f.value : t === 'strnull' ? (f.value || null) : (f.value === '' ? 0 : Number(f.value));
        setPath(f.dataset.path, v); savebar();
        const vi = f.dataset.path.match(/^video_types\.(\d+)\./); if (vi) updTypePrev(Number(vi[1]));
        const li = f.dataset.path.match(/^video_types\.(\d+)\.levels\.(\d+)\./); if (li) updLevelPrev(Number(li[1]), Number(li[2]));
        if (/^(addons|payment_fees|voice_tiers)\./.test(f.dataset.path)) updAddonPrev();
        if (f.hasAttribute('data-redraw')) { const y = window.scrollY; draw(); window.scrollTo(0, y); }
      });
      // Redraw derived numbers (per-credit, margins) after an edit, keeping focus where the user moved to.
      if (f.dataset.type === 'num' || f.dataset.type === 'str') f.addEventListener('change', () => setTimeout(() => {
        const ae = document.activeElement?.dataset?.path; const y = window.scrollY; draw(); window.scrollTo(0, y);
        if (ae) $(`[data-path="${ae}"]`, el)?.focus({ preventScroll: true });
      }));
    });
    $$('[data-delplan]', el).forEach((b) => b.onclick = () => { P.plans.splice(Number(b.dataset.delplan), 1); draw(); savebar(); });
    $('#addplan', el) && ($('#addplan', el).onclick = () => { P.plans.push({ id: '', name: 'New plan', price_month: 99, price_year: 990, credits_month: 2000, seats: 1, max_ugc_seconds: 30, max_video_seconds: 10, features: [], scripts: false, popular: false }); draw(); savebar(); });
    $$('[data-deltop]', el).forEach((b) => b.onclick = () => { P.topups.splice(Number(b.dataset.deltop), 1); draw(); savebar(); });
    $$('[data-delvt]', el).forEach((b) => b.onclick = () => { const vt = P.video_types[Number(b.dataset.delvt)]; confirmDel('the "' + esc(vt.name || vt.id) + '" video type', () => { P.video_types.splice(Number(b.dataset.delvt), 1); draw(); savebar(); toast('Removed. Save pricing to apply.'); }); });
    $$('[data-addon]', el).forEach((b) => b.onclick = () => { const [i, a] = b.dataset.addon.split(':'); const vt = P.video_types[Number(i)]; const l = new Set(vt.addons_allowed || []); l.has(a) ? l.delete(a) : l.add(a); vt.addons_allowed = [...l]; const y = window.scrollY; draw(); window.scrollTo(0, y); savebar(); });
    $$('[data-lven]', el).forEach((b) => b.onclick = () => { const [i, j] = b.dataset.lven.split(':').map(Number); const l = P.video_types[i].levels[j]; l.enabled = l.enabled === false; b.setAttribute('aria-checked', l.enabled); b.closest('.lvr').classList.toggle('off', !l.enabled); savebar(); });
    $$('[data-lvmodel]', el).forEach((s2) => s2.onchange = () => { const [i, j] = s2.dataset.lvmodel.split(':').map(Number); const l = P.video_types[i].levels[j], p = PROV.find((x) => x.config?.tag === s2.value && x.kind === P.video_types[i].provider_kind); l.provider_tag = s2.value; if (p) l.model_label = p.name.replace(/ on fal.*$/, '').replace(/\s*\(.*\)\s*$/, ''); const y = window.scrollY; draw(); window.scrollTo(0, y); savebar(); toast('Model changed. Save to recheck the margin.'); });
    $$('[data-vten]', el).forEach((b) => b.onclick = () => { const i = Number(b.dataset.vten); P.video_types[i].enabled = P.video_types[i].enabled === false; b.setAttribute('aria-checked', P.video_types[i].enabled); b.closest('.vt').classList.toggle('off', !P.video_types[i].enabled); savebar(); });
    $('#addvt', el) && ($('#addvt', el).onclick = () => { const n = P.video_types.length + 1; P.video_types.push({ id: 'type_' + n + Date.now().toString(36).slice(-3), name: 'New video type', description: '', pipeline: 'video', provider_kind: 'video', unit: 'second', credits_per_unit: 10, provider_cost_usd_per_unit: 0.07, segment_seconds: 10, min_seconds: 5, max_seconds_by_plan: Object.fromEntries(P.plans.map((pl) => [pl.id, 30])), min_plan: P.plans[0]?.id || null, extras: {}, enabled: false, badge: '' }); draw(); savebar(); toast('Added switched off. Set credits, then switch it on.'); });
    $('#vtload', el) && ($('#vtload', el).onclick = () => { P.video_types = clone(r.defaults.video_types); P.min_margin_pct ??= r.defaults.min_margin_pct; draw(); savebar(); toast('Default video types loaded. Save to apply.'); });
    $('#addtop', el) && ($('#addtop', el).onclick = () => { P.topups.push({ id: 't' + (P.topups.length + 1) + Date.now().toString(36).slice(-2), price: 29, credits: 550 }); draw(); savebar(); });
    $('#reset', el) && ($('#reset', el).onclick = () => { P = clone(r.defaults); draw(); savebar(); toast('Default pricing loaded. Save to apply.'); });
    $('#dadd', el) && ($('#dadd', el).onclick = async (e) => {
      const de = $('#de', el).value;
      const b = { code: $('#dc', el).value.trim(), percent: Number($('#dp', el).value), applies_to: $('#da', el).value, expires_at: de ? new Date(de + 'T23:59:59').toISOString() : null, max_uses: $('#dm', el).value ? Number($('#dm', el).value) : null };
      if (await act(e.currentTarget, () => POST('/api/admin/discounts', b), 'Discount code ' + b.code.toUpperCase() + ' created')) { r.discounts = (await GET('/api/admin/pricing')).discounts; draw(); }
    });
    $$('[data-off]', el).forEach((b) => b.onclick = async () => {
      if (await act(b, () => DEL('/api/admin/discounts/' + encodeURIComponent(b.dataset.off)), 'Code ' + b.dataset.off + ' turned off')) { r.discounts = (await GET('/api/admin/pricing')).discounts; draw(); }
    });
  };
  const showTab = () => { $$('#ptabs button', el).forEach((x) => x.classList.toggle('on', x.dataset.t === tab)); $$('[data-p]', el).forEach((p) => p.hidden = p.dataset.p !== tab); };
  draw();
};

// ---------- Blog ----------
function md(src) {
  const e = (s) => esc(s);
  const inline = (s) => e(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:|#)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out += `<pre><code>${e(buf.join('\n'))}</code></pre>`; continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out += `<blockquote>${inline(buf.join(' '))}</blockquote>`; continue; }
    if (/^\s*[-*+]\s+/.test(l)) { const buf = []; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*+]\s+/, '')); out += `<ul>${buf.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`; continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const buf = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+[.)]\s+/, '')); out += `<ol>${buf.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`; continue; }
    if (/^\|.*\|\s*$/.test(l)) { const buf = []; while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) buf.push(lines[i++]); const rows = buf.filter((x) => !/^\|[\s:|-]+\|\s*$/.test(x)).map((x) => x.slice(1, -1).split('|').map((c) => c.trim())); out += `<table>${rows.map((rw, ri) => `<tr>${rw.map((c) => ri ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table>`; continue; }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s|\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    out += `<p>${inline(buf.join(' '))}</p>`;
  }
  return out;
}

async function uploadImage(file) {
  if (!file) return null;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Upload a PNG, JPG, WebP or GIF image.');
  if (file.size > 8e6) throw new Error('That image is over 8 MB.');
  return (await api('/api/admin/upload', { method: 'POST', raw: file, type: file.type })).url;
}

VIEWS.blog = async (el, acts) => {
  const edit = can('blog.edit');
  const r = await GET('/api/admin/posts');
  const list = () => {
    acts.innerHTML = edit ? `<button class="btn brand sm" id="newp">${ico('plus')} New post</button>` : '';
    $('#newp') && ($('#newp').onclick = () => editor(null));
    const pub = r.posts.filter((p) => p.status === 'published').length;
    el.innerHTML = `<div class="card"><div class="card-h"><div class="seg" id="bf"><button class="on" data-s="">All ${r.posts.length}</button><button data-s="published">Published ${pub}</button><button data-s="draft">Drafts ${r.posts.length - pub}</button></div></div><div id="bl"></div></div>`;
    const draw = (f) => {
      const rows = r.posts.filter((p) => !f || p.status === f);
      $('#bl').innerHTML = rows.length ? tbl([{ t: 'Post' }, { t: 'Status' }, { t: 'Published' }, { t: 'Updated' }], rows.map((p) => `<tr class="click" data-id="${p.id}"><td class="lead" data-l="Post"><div class="row" style="flex-wrap:nowrap"><span class="thumb" style="background-image:url('${esc(p.cover_url || '')}')"></span><div style="min-width:0"><b>${esc(p.title)}</b><span class="sub">/blog/${esc(p.slug)}</span></div></div></td><td data-l="Status">${statusPill(p.status)}</td><td data-l="Published" class="nowrap">${p.published_at ? ago(p.published_at) : '—'}</td><td data-l="Updated" class="nowrap">${ago(p.updated_at)}</td></tr>`)) : emptyCard('No posts here', edit ? 'Write your first one with New post.' : '');
      $$('#bl tr[data-id]').forEach((tr) => tr.onclick = () => editor(Number(tr.dataset.id)));
    };
    $$('#bf button').forEach((b) => b.onclick = () => { $$('#bf button').forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.s); });
    draw('');
  };
  const editor = async (id) => {
    let p = { title: '', slug: '', excerpt: '', tags: [], author: S.me.staff.name || 'Vooads Team', cover_url: '', body_md: '', status: 'draft' };
    if (id) { try { p = (await GET('/api/admin/posts/' + id)).post; } catch (e) { return toast(e.message, true); } }
    acts.innerHTML = `<button class="btn ghost sm" id="bback">${ico('back')} All posts</button>`;
    $('#bback').onclick = () => VIEWS.blog(el, acts);
    const ro = edit ? '' : 'readonly';
    el.innerHTML = `<div class="stack" style="animation:up .35s var(--ease) both">
      <div class="card pad"><div class="fields">
        <div class="fld full"><label>Title</label><input class="inp" id="bt" maxlength="140" value="${esc(p.title)}" placeholder="5 UGC hooks that beat the scroll" style="font-size:20px;font-weight:800;letter-spacing:-.03em" ${ro}></div>
        <div class="fld"><label>URL slug</label><input class="inp sm mono" id="bs" value="${esc(p.slug)}" placeholder="made from the title" ${ro}><small>vooads.com/blog/<span id="bsv">${esc(p.slug || '…')}</span></small></div>
        <div class="fld"><label>Tags</label><input class="inp sm" id="btg" value="${esc((p.tags || []).join(', '))}" placeholder="UGC, Hooks, Meta ads" ${ro}><small>Comma separated, up to 8.</small></div>
        <div class="fld full"><label>Excerpt</label><textarea class="inp sm" id="be" maxlength="300" rows="2" placeholder="One or two lines for the blog list and Google." ${ro}>${esc(p.excerpt || '')}</textarea></div>
        <div class="fld"><label>Author</label><input class="inp sm" id="ba" value="${esc(p.author || '')}" ${ro}></div>
        <div class="fld"><label>Cover image</label><div class="cover"><span class="img" id="bci" style="background-image:url('${esc(p.cover_url || '')}')"></span><div class="grow stack" style="gap:8px"><input class="inp sm" id="bc" value="${esc(p.cover_url || '')}" placeholder="/media/… or https://…" ${ro}>${edit ? `<label class="btn ghost xs" style="justify-self:start">${ico('upload')} Upload image<input type="file" id="bcf" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>` : ''}</div></div></div>
      </div></div>
      <div><div class="row between" style="margin-bottom:10px"><div class="seg etabs" id="et"><button class="on" data-m="w">Write</button><button data-m="p">Preview</button></div><span class="hint">Markdown: # heading, **bold**, *italic*, [link](url), ![image](url), - lists, > quotes</span>
        ${edit ? `<label class="btn ghost xs">${ico('image')} Insert image<input type="file" id="bif" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>` : ''}</div>
        <div class="editor w" id="ed"><textarea class="inp" id="bb" spellcheck="true" placeholder="Write the post in Markdown…" ${ro}>${esc(p.body_md || '')}</textarea><div class="pv prose" id="bp"></div></div></div>
      <div class="card pad row between"><div class="row"><span class="hint">Status</span><div class="seg" id="bst"><button data-s="draft" class="${p.status !== 'published' ? 'on' : ''}">Draft</button><button data-s="published" class="${p.status === 'published' ? 'on' : ''}">Published</button></div><span class="hint" id="bwc"></span></div>
        <div class="row">${id && p.status === 'published' ? `<a class="btn ghost sm" href="/blog/${esc(p.slug)}" target="_blank" rel="noopener">${ico('ext')} View</a>` : ''}${edit && id ? `<button class="btn dghost sm" id="bdel">Delete</button>` : ''}${edit ? `<button class="btn brand sm" id="bsave">${id ? 'Save post' : 'Create post'}</button>` : ''}</div></div>
    </div>`;
    let status = p.status === 'published' ? 'published' : 'draft';
    const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    const pv = () => { $('#bp').innerHTML = md($('#bb').value) || '<p class="muted">The preview shows here.</p>'; const w = $('#bb').value.trim().split(/\s+/).filter(Boolean).length; $('#bwc').textContent = w + ' words · ' + Math.max(1, Math.round(w / 220)) + ' min read'; };
    $('#bb').oninput = debounce(pv, 120); pv();
    let slugTouched = !!p.slug;
    $('#bs').oninput = () => { slugTouched = true; $('#bsv').textContent = slugify($('#bs').value) || '…'; };
    $('#bt').oninput = () => { if (!slugTouched) { $('#bs').value = slugify($('#bt').value); $('#bsv').textContent = $('#bs').value || '…'; } };
    $('#bc').oninput = () => { $('#bci').style.backgroundImage = `url('${$('#bc').value.replace(/'/g, '')}')`; };
    $$('#et button').forEach((b) => b.onclick = () => { $$('#et button').forEach((x) => x.classList.toggle('on', x === b)); $('#ed').className = 'editor ' + b.dataset.m; });
    $$('#bst button').forEach((b) => b.onclick = () => { if (!edit) return; status = b.dataset.s; $$('#bst button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('#bcf') && ($('#bcf').onchange = async (e) => { const url = await act(null, () => uploadImage(e.target.files[0]), 'Cover uploaded'); if (url) { $('#bc').value = url; $('#bc').oninput(); } e.target.value = ''; });
    $('#bif') && ($('#bif').onchange = async (e) => {
      const url = await act(null, () => uploadImage(e.target.files[0]), 'Image uploaded and inserted'); e.target.value = '';
      if (!url) return; const ta = $('#bb'), at = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, at) + `\n![](${url})\n` + ta.value.slice(at); pv();
    });
    $('#bdel') && ($('#bdel').onclick = () => confirmDel('this post', async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/posts/' + id), 'Post deleted'); if (!x) return false; VIEWS.blog(el, acts); }));
    $('#bsave') && ($('#bsave').onclick = async (e) => {
      const b = { title: $('#bt').value.trim(), slug: $('#bs').value.trim(), excerpt: $('#be').value.trim(), tags: $('#btg').value, author: $('#ba').value.trim(), cover_url: $('#bc').value.trim(), body_md: $('#bb').value, status };
      const x = await act(e.currentTarget, () => id ? PUT('/api/admin/posts/' + id, b) : POST('/api/admin/posts', b), status === 'published' ? 'Post published' : 'Draft saved');
      if (x?.post) { const i = r.posts.findIndex((q) => q.id === x.post.id); if (i >= 0) r.posts[i] = x.post; else r.posts.unshift(x.post); editor(x.post.id); }
    });
  };
  list();
};

// ---------- Emails ----------
VIEWS.emails = async (el, acts) => {
  const edit = can('emails.edit');
  const r = await GET('/api/admin/emails');
  const mk = new Set(r.marketing || []);
  const list = (tab = 'tpl') => {
    acts.innerHTML = r.live ? '<span class="pill good"><span class="dot live"></span>Sending via Resend</span>' : '<span class="pill warn">Not sending · printed to server log</span>';
    el.innerHTML = `<div class="tabs" id="etb"><button data-t="tpl" class="${tab === 'tpl' ? 'on' : ''}">Templates (${r.templates.length})</button><button data-t="log" class="${tab === 'log' ? 'on' : ''}">Send log</button></div><div id="eb"></div>`;
    $$('#etb button').forEach((b) => b.onclick = () => list(b.dataset.t));
    if (tab === 'log') {
      $('#eb').innerHTML = `<div class="card">${r.log.length ? tbl([{ t: 'To' }, { t: 'Template' }, { t: 'Due' }, { t: 'Sent' }, { t: 'Tries', r: 1 }, { t: 'Result' }], r.log.map((q) => `<tr><td class="lead" data-l="To">${esc(q.to_email)}</td><td data-l="Template"><span class="k">${esc(q.template)}</span></td><td data-l="Due" class="nowrap">${ago(q.send_at)}</td><td data-l="Sent" class="nowrap">${q.sent_at ? ago(q.sent_at) : '—'}</td><td class="r num" data-l="Tries">${q.attempts}</td><td data-l="Result">${q.error === 'skipped' ? '<span class="pill plain">Skipped</span>' : q.error ? `<span class="pill bad" title="${esc(q.error)}">Error</span><span class="sub">${esc(q.error).slice(0, 80)}</span>` : q.sent_at ? '<span class="pill good">Sent</span>' : '<span class="pill warn">Queued</span>'}</td></tr>`)) : emptyCard('Nothing sent yet', '')}</div>`;
      return;
    }
    const groups = [['Account & billing', r.templates.filter((t) => !mk.has(t.id))], ['Marketing (respects unsubscribe)', r.templates.filter((t) => mk.has(t.id))]];
    $('#eb').innerHTML = `<div class="stack">${groups.filter((g) => g[1].length).map(([g, rows]) => `<div class="card"><div class="card-h"><h3>${g}</h3><span class="hint">${rows.length} emails</span></div>
      ${tbl([{ t: 'Email' }, { t: 'When it sends' }, { t: 'Status' }, { t: 'Edited' }], rows.map((t) => `<tr class="click" data-id="${esc(t.id)}"><td class="lead" data-l="Email"><b>${esc(t.subject)}</b><span class="sub k" style="display:inline-block;margin-top:3px">${esc(t.id)}</span></td><td data-l="When">${esc(t.trigger || '—')}<span class="sub">${esc(t.delay || '')}</span></td><td data-l="Status">${t.enabled ? '<span class="pill good">On</span>' : '<span class="pill plain">Off</span>'}</td><td data-l="Edited" class="nowrap">${ago(t.updated_at)}</td></tr>`))}</div>`).join('')}</div>`;
    $$('#eb tr[data-id]').forEach((tr) => tr.onclick = () => editor(tr.dataset.id));
  };
  const editor = (tid) => {
    const t = r.templates.find((x) => x.id === tid);
    acts.innerHTML = `<button class="btn ghost sm" id="eback">${ico('back')} All emails</button>`;
    $('#eback').onclick = () => list();
    const ro = edit ? '' : 'readonly';
    el.innerHTML = `<div class="mailgrid" style="animation:up .35s var(--ease) both">
      <div class="card"><div class="card-h"><div><h3>${esc(t.id)}</h3><p>${esc(t.trigger || '')}${t.delay ? ' · ' + esc(t.delay) : ''}</p></div>${edit ? `<label class="swl">${sw(t.enabled, 'id="een"')}<span>On</span></label>` : ''}</div>
      <div class="card-b"><div class="fields">
        <div class="fld full"><label>Subject</label><input class="inp sm" id="es" value="${esc(t.subject || '')}" ${ro}></div>
        <div class="fld full"><label>Preview text</label><input class="inp sm" id="eph" value="${esc(t.preheader || '')}" ${ro}><small>Shown next to the subject in the inbox.</small></div>
        <div class="fld full"><label>Heading</label><input class="inp sm" id="eh" value="${esc(t.heading || '')}" ${ro}></div>
        <div class="fld full"><label>Body (HTML)</label><textarea class="inp sm mono" id="ebh" rows="10" ${ro}>${esc(t.body_html || '')}</textarea><small>Variables: <span class="k">{{name}}</span> <span class="k">{{app_url}}</span> <span class="k">{{code}}</span> <span class="k">{{credits}}</span> <span class="k">{{plan}}</span> <span class="k">{{amount}}</span> <span class="k">{{reason}}</span> <span class="k">{{support_email}}</span></small></div>
        <div class="fld"><label>Button text</label><input class="inp sm" id="ecl" value="${esc(t.cta_label || '')}" ${ro}></div>
        <div class="fld"><label>Button link</label><input class="inp sm mono" id="ecu" value="${esc(t.cta_url || '')}" ${ro}></div>
      </div></div>
      ${edit ? `<div class="card-b row end" style="border-top:1px solid var(--line)"><button class="btn ghost sm" id="etest">${ico('send')} Send me a test</button><button class="btn brand sm" id="esave">Save & preview</button></div>` : ''}</div>
      <div class="card" style="position:sticky;top:20px"><div class="card-h"><div><h3>Preview</h3><p>With sample data. Shows the saved version.</p></div><button class="iconbtn" id="erf" title="Refresh preview" aria-label="Refresh preview">${ico('refresh')}</button></div>
      <div class="card-b" style="padding:12px"><iframe class="mailframe" id="ef" title="Email preview" sandbox="allow-popups"></iframe></div></div></div>`;
    const preview = async () => { try { $('#ef').srcdoc = await GET('/api/admin/emails/' + encodeURIComponent(tid) + '/preview'); } catch (e) { toast(e.message, true); } };
    preview();
    $('#erf').onclick = preview;
    $('#een') && ($('#een').onclick = (e) => e.currentTarget.setAttribute('aria-checked', e.currentTarget.getAttribute('aria-checked') !== 'true'));
    $('#esave') && ($('#esave').onclick = async (e) => {
      const b = { subject: $('#es').value, preheader: $('#eph').value, heading: $('#eh').value, body_html: $('#ebh').value, cta_label: $('#ecl').value, cta_url: $('#ecu').value, enabled: $('#een').getAttribute('aria-checked') === 'true' };
      if (await act(e.currentTarget, () => PUT('/api/admin/emails/' + encodeURIComponent(tid), b), 'Email saved')) { Object.assign(t, b, { enabled: b.enabled ? 1 : 0, updated_at: new Date().toISOString() }); preview(); }
    });
    $('#etest') && ($('#etest').onclick = (e) => act(e.currentTarget, () => POST('/api/admin/emails/' + encodeURIComponent(tid) + '/test'), (x) => x.logged ? 'Test built. Email is not set up, so it was printed to the server log.' : 'Test sent to ' + x.to));
  };
  list();
};

// ---------- Team & roles ----------
const PGROUPS = [
  ['Overview', ['dashboard.view']], ['Customers', ['users.view', 'users.edit', 'users.credits', 'users.ban']], ['Payments', ['payments.view', 'payments.refund', 'payments.manage']],
  ['AI providers', ['providers.view', 'providers.manage']], ['Pricing', ['pricing.view', 'pricing.manage']], ['Blog', ['blog.view', 'blog.edit']], ['Emails', ['emails.view', 'emails.edit']], ['Mail', ['mail.view', 'mail.edit', 'mail.send', 'mail.send_all']],
  ['Support tickets', ['tickets.view', 'tickets.reply', 'tickets.assign', 'tickets.manage', 'calls.handle', 'support.reply']], ['Team', ['staff.view', 'staff.manage']], ['Settings', ['settings.view', 'settings.manage']], ['Activity log', ['audit.view']],
];
// Plain-English names used when the server's description is missing or too technical.
const PLAIN = {
  'tickets.view': 'See support tickets', 'tickets.reply': 'Reply to tickets and write internal notes', 'tickets.assign': 'Give tickets to a teammate (set the owner)',
  'tickets.manage': 'Run support: saved replies, support settings, any ticket', 'calls.handle': 'Handle callback requests (see phone numbers)', 'support.reply': 'Answer classic in-app chats',
};
const PRESETS = ['Owner', 'Viewer', 'Support', 'Support (assigned only)', 'Blog editor', 'Manager'];
// One-click starting points. Only permissions the server knows are applied.
const QUICK_ROLES = [
  { n: 'Support agent', d: 'Answers tickets given to them. Small credit refunds.', p: ['dashboard.view', 'users.view', 'tickets.view', 'tickets.reply', 'calls.handle', 'support.reply'], l: { max_credit_grant: 100, ticket_scope: 'assigned' } },
  { n: 'Support lead', d: 'Sees every ticket, assigns work, manages saved replies.', p: ['dashboard.view', 'users.view', 'users.credits', 'payments.view', 'tickets.view', 'tickets.reply', 'tickets.assign', 'tickets.manage', 'calls.handle', 'support.reply'], l: { max_credit_grant: 1000, ticket_scope: 'all' } },
  { n: 'Finance', d: 'Payments, refunds and pricing. No support.', p: ['dashboard.view', 'users.view', 'payments.view', 'payments.refund', 'pricing.view'], l: { max_credit_grant: 0, ticket_scope: 'all' } },
  { n: 'Content', d: 'Blog, emails and the AI brain.', p: ['blog.view', 'blog.edit', 'emails.view', 'emails.edit', 'settings.view'], l: { ticket_scope: 'all' } },
];

VIEWS.team = async (el, acts) => {
  const manage = can('staff.manage');
  const r = await GET('/api/admin/staff');
  const reload = () => VIEWS.team(el, acts);
  const roleOf = (id) => r.roles.find((x) => x.id === id);
  const total = Object.keys(r.all_permissions).length;
  if (manage) { acts.innerHTML = `<button class="btn ghost sm" id="newrole">${ico('plus')} New role</button><button class="btn brand sm" id="inv">${ico('plus')} Invite someone</button>`; }
  const sorted = r.roles.slice().sort((a, b) => { const ia = PRESETS.indexOf(a.name), ib = PRESETS.indexOf(b.name); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id - b.id; });
  el.innerHTML = `<div class="stack">
    <div id="invbox"></div>
    <div class="card"><div class="card-h"><div><h3>People</h3><p>${r.staff.length} on the team</p></div></div>
    ${tbl([{ t: 'Person' }, { t: 'Role' }, { t: 'Status' }, { t: 'Last login' }, { t: '' }], r.staff.map((s) => {
      const self = s.id === S.me.staff.id;
      return `<tr data-id="${s.id}"><td class="lead" data-l="Person"><div class="row" style="flex-wrap:nowrap"><span class="avatar">${esc(initials(s.name || s.email))}</span><div style="min-width:0"><b>${esc(s.name || '—')}${self ? ' <span class="pill plain">You</span>' : ''}</b><span class="sub">${esc(s.email)}</span></div></div></td>
      <td data-l="Role">${manage && !self ? `<select class="inp sm" data-role style="min-width:150px">${sorted.map((x) => `<option value="${x.id}" ${x.id === s.role_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : `<span class="pill ink">${esc(roleOf(s.role_id)?.name || '—')}</span>`}</td>
      <td data-l="Status">${s.status === 'invited' ? '<span class="pill warn">Invite pending</span>' : statusPill(s.status)}</td><td data-l="Last login" class="nowrap">${ago(s.last_login_at)}</td>
      <td class="r nowrap" data-l="">${manage && !self ? `${s.status !== 'invited' ? `<button class="btn ghost xs" data-tog>${s.status === 'active' ? 'Disable' : 'Enable'}</button>` : ''} <button class="iconbtn" data-rm title="Remove" aria-label="Remove">${ico('trash')}</button>` : ''}</td></tr>`;
    }))}</div>
    <div><div class="row between" style="margin-bottom:12px"><div><h3 style="font-size:18px;letter-spacing:-.03em">Roles</h3><p class="hint">Click a role to see or change what it can do.</p></div></div>
    <div class="roles stagger">${sorted.map((x, i) => {
      const full = x.permissions.includes('*'); const n = full ? total : x.permissions.length;
      const people = r.staff.filter((s) => s.role_id === x.id).length;
      return `<button class="card role" data-role-id="${x.id}" style="--i:${i}"><h4>${esc(x.name)} ${x.system ? '<span class="pill plain">Preset</span>' : '<span class="pill violet">Custom</span>'}</h4><p>${esc(x.description || '')}</p>
        <div class="permbar"><i style="width:${Math.round(n / total * 100)}%"></i></div><div class="row between hint"><span>${full ? 'Full access' : n + ' of ' + total + ' permissions'}${x.limits?.max_credit_grant != null ? ' · max ' + int(x.limits.max_credit_grant) + ' credits' : ''}${x.limits?.ticket_scope === 'assigned' ? ' · own tickets only' : ''}</span><span>${people} ${people === 1 ? 'person' : 'people'}</span></div></button>`;
    }).join('')}</div></div></div>`;
  $$('[data-role-id]', el).forEach((b) => b.onclick = () => roleDrawer(roleOf(Number(b.dataset.roleId)), r, reload));
  $('#newrole') && ($('#newrole').onclick = () => roleDrawer(null, r, reload));
  $('#inv') && ($('#inv').onclick = () => { const w = modal({
    title: 'Invite someone to the admin', ok: 'Send invite',
    body: `<div class="fld"><label>Email</label><input class="inp" id="i-em" type="email" placeholder="name@company.com"></div><div class="fld"><label>Name (optional)</label><input class="inp" id="i-nm" maxlength="60"></div>
      <div class="fld"><label>Role</label><select class="inp" id="i-rl">${sorted.filter((x) => can('*') || !x.permissions.includes('*')).map((x) => `<option value="${x.id}" ${x.name === 'Viewer' ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><small id="i-desc"></small></div>`,
    onOk: async (w, btn) => {
      const x = await act(btn, () => POST('/api/admin/staff', { email: $('#i-em', w).value.trim(), name: $('#i-nm', w).value.trim(), role_id: Number($('#i-rl', w).value) }), 'Invite created');
      if (!x) return false;
      await reload();
      $('#invbox').innerHTML = `<div class="card pad invite-link"><div class="row between"><div><h3 style="font-size:17px">Invite link ready</h3><p class="hint">We emailed it${S.me.email_live ? '' : ' (email is not set up, so it was printed to the server log)'}. You can also send it yourself. It works once.</p></div><button class="iconbtn" id="ix" aria-label="Dismiss">${ico('x')}</button></div><div class="copybox" style="margin-top:12px"><code>${esc(x.invite_url)}</code><button class="btn brand xs" id="icp">${ico('copy')} Copy link</button></div></div>`;
      $('#icp').onclick = () => copy(x.invite_url); $('#ix').onclick = () => { $('#invbox').innerHTML = ''; };
    },
  });
  const descUpd = () => { $('#i-desc', w).textContent = roleOf(Number($('#i-rl', w).value))?.description || ''; };
  $('#i-rl', w).onchange = descUpd; descUpd(); });
  $$('tr[data-id]', el).forEach((tr) => {
    const s = r.staff.find((x) => x.id === Number(tr.dataset.id));
    $('[data-role]', tr) && ($('[data-role]', tr).onchange = async (e) => { if (!await act(null, () => PUT('/api/admin/staff/' + s.id, { role_id: Number(e.target.value) }), (s.name || s.email) + ' is now ' + roleOf(Number(e.target.value)).name)) e.target.value = s.role_id; });
    $('[data-tog]', tr) && ($('[data-tog]', tr).onclick = (e) => act(e.currentTarget, () => PUT('/api/admin/staff/' + s.id, { status: s.status === 'active' ? 'disabled' : 'active' }), s.status === 'active' ? 'Access disabled and logged out' : 'Access enabled').then((x) => x && reload()));
    $('[data-rm]', tr) && ($('[data-rm]', tr).onclick = () => modal({ title: 'Remove ' + esc(s.name || s.email) + '?', body: '<p>They lose admin access right away. Their past actions stay in the activity log.</p>', ok: 'Remove', okClass: 'danger', onOk: async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/staff/' + s.id), 'Removed from the team'); if (!x) return false; reload(); } }));
  });
};

function roleDrawer(role, meta, done) {
  const manage = can('staff.manage');
  const isOwner = role && role.permissions.includes('*');
  const editable = manage && !isOwner;
  const perms = new Set(role ? role.permissions : ['dashboard.view']);
  const all = meta.all_permissions;
  const known = new Set(PGROUPS.flatMap((g) => g[1]));
  const groups = PGROUPS.map(([g, ks]) => [g, ks.filter((k) => all[k])]).filter((g) => g[1].length);
  const extra = Object.keys(all).filter((k) => !known.has(k)); if (extra.length) groups.push(['Other', extra]);
  const presets = meta.roles.filter((x) => PRESETS.includes(x.name) && !x.permissions.includes('*'));
  const d = openDrawer({
    title: role ? esc(role.name) : 'New role', sub: isOwner ? 'The Owner role always has full access and cannot be changed.' : role?.system ? 'Preset role. You can edit it, but not delete it.' : 'Pick exactly what this role can see and do.',
    body: `<div class="fields">
      <div class="fld"><label>Role name</label><input class="inp sm" id="rn" maxlength="40" value="${esc(role?.name || '')}" placeholder="e.g. Growth" ${editable ? '' : 'readonly'}></div>
      <div class="fld full"><label>Description</label><input class="inp sm" id="rd" maxlength="200" value="${esc(role?.description || '')}" placeholder="What this person does" ${editable ? '' : 'readonly'}></div></div>
    ${editable ? `<div class="dsec"><h4>Start from a preset</h4><div class="preview-list">${QUICK_ROLES.map((q, i) => `<button class="btn ghost xs" data-quick="${i}" title="${esc(q.d)}">${esc(q.n)}</button>`).join('')}${presets.map((x) => `<button class="btn ghost xs" data-preset="${x.id}" title="Copy the ${esc(x.name)} role">${esc(x.name)}</button>`).join('')}<button class="btn ghost xs" data-preset="none">Clear all</button></div><p class="hint" style="margin-top:6px">Presets fill in the boxes below. Nothing is saved until you press Save.</p></div>` : ''}
    <div class="dsec"><h4>Limits</h4>${isOwner ? '<p class="hint">Owners have no limits.</p>' : `<div class="fields">
      <div class="fld"><label for="rl">Most credits they can give at once</label><input class="inp sm" id="rl" type="number" min="0" value="${esc(role?.limits?.max_credit_grant ?? '')}" placeholder="No limit" ${editable ? '' : 'readonly'}><small>Applies in the inbox and on customer profiles. Empty = no limit, 0 = cannot give credits.</small></div>
      <div class="fld"><label for="rsc">Which tickets they see</label><select class="inp sm" id="rsc" ${editable ? '' : 'disabled'}><option value="all" ${role?.limits?.ticket_scope !== 'assigned' ? 'selected' : ''}>Every ticket</option><option value="assigned" ${role?.limits?.ticket_scope === 'assigned' ? 'selected' : ''}>Only tickets given to them</option></select><small>Good for new agents: they only see their own work.</small></div></div>`}</div>
    <div class="dsec"><h4>Permissions</h4>${isOwner ? '<div class="note brand"><b>Full access.</b> Owners can do everything, including managing other owners.</div>' : groups.map(([g, ks]) => `<div class="pgroup"><h5>${esc(g)}${editable ? `<button class="linkbtn" data-all="${esc(ks.join(','))}" style="font-size:12.5px">Toggle all</button>` : ''}</h5>${ks.map((k) => `<label class="chk"><input type="checkbox" value="${esc(k)}" ${perms.has(k) ? 'checked' : ''} ${editable ? '' : 'disabled'}><span>${esc(PLAIN[k] || all[k])}<small>${esc(k)}</small></span></label>`).join('')}</div>`).join('') + (!all['tickets.view'] ? '<div class="note">Ticket permissions (see, reply, assign, manage, calls) show up here once the server update lands.</div>' : '')}</div>`,
    foot: editable ? `${role && !role.system ? '<button class="btn dghost sm" id="rdel" style="margin-right:auto">Delete role</button>' : ''}<button class="btn ghost sm" id="rcancel">Cancel</button><button class="btn brand sm" id="rsave">${role ? 'Save role' : 'Create role'}</button>` : '',
  });
  if (!editable) return;
  const boxes = () => $$('.pgroup input[type=checkbox]', d);
  $$('[data-preset]', d).forEach((b) => b.onclick = () => { const src = meta.roles.find((x) => x.id === Number(b.dataset.preset)); const set = new Set(src ? src.permissions : []); boxes().forEach((c) => c.checked = set.has(c.value)); if (src && src.limits?.max_credit_grant != null) $('#rl', d).value = src.limits.max_credit_grant; if (src) $('#rsc', d).value = src.limits?.ticket_scope === 'assigned' ? 'assigned' : 'all'; toast(src ? 'Copied permissions from ' + src.name : 'Cleared'); });
  $$('[data-quick]', d).forEach((b) => b.onclick = () => { const q = QUICK_ROLES[Number(b.dataset.quick)]; const set = new Set(q.p); boxes().forEach((c) => c.checked = set.has(c.value)); $('#rl', d).value = q.l.max_credit_grant ?? ''; $('#rsc', d).value = q.l.ticket_scope || 'all'; if (!$('#rn', d).value.trim()) $('#rn', d).value = q.n; if (!$('#rd', d).value.trim()) $('#rd', d).value = q.d; toast(q.n + ' preset applied. Review, then save.'); });
  $$('[data-all]', d).forEach((b) => b.onclick = () => { const ks = b.dataset.all.split(','); const cs = boxes().filter((c) => ks.includes(c.value)); const on = !cs.every((c) => c.checked); cs.forEach((c) => c.checked = on); });
  // Ticking a "change" permission also ticks its "see" permission so the section shows up.
  boxes().forEach((c) => c.onchange = () => { if (c.checked) { const g = c.value.split('.')[0]; const v = boxes().find((x) => x.value === g + '.view'); if (v) v.checked = true; } });
  $('#rcancel', d).onclick = closeDrawer;
  $('#rdel', d) && ($('#rdel', d).onclick = () => confirmDel('the "' + esc(role.name) + '" role', async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/roles/' + role.id), 'Role deleted'); if (!x) return false; closeDrawer(); done(); }));
  $('#rsave', d).onclick = async (e) => {
    const lim = $('#rl', d).value.trim();
    const b = { name: $('#rn', d).value.trim(), description: $('#rd', d).value.trim(), permissions: boxes().filter((c) => c.checked).map((c) => c.value), limits: { max_credit_grant: lim === '' ? '' : Number(lim), ticket_scope: $('#rsc', d).value } };
    if (await act(e.currentTarget, () => role ? PUT('/api/admin/roles/' + role.id, b) : POST('/api/admin/roles', b), role ? 'Role saved' : 'Role created')) { closeDrawer(); done(); }
  };
}

// ---------- Settings ----------
VIEWS.settings = async (el) => {
  const manage = can('settings.manage');
  const r = await GET('/api/admin/settings');
  const site = clone(r.site || {}), ref = clone(r.referral || { tiers: [] }), pres = clone(r.presenters || []), voices = clone(r.voices || {});
  ref.tiers ||= [];
  const ro = manage ? '' : 'readonly disabled';
  const save = (key, value, btn, msg) => act(btn, () => PUT('/api/admin/settings/' + key, { value }), msg);
  const draw = () => {
    el.innerHTML = `<div class="stack">
      <div class="grid2">
      <div class="card"><div class="card-h"><div><h3>Site switches</h3><p>Take effect for every visitor right away.</p></div></div><div class="card-b stack" style="gap:14px">
        ${[['signups_open', 'New sign-ups', 'Let new customers create accounts.'], ['support_chat', 'Support chat', 'Show the chat bubble in the studio.'], ['maintenance', 'Maintenance mode', 'Pause the studio for customers while you fix something.']].map(([k, l, h]) => `<div class="row between" style="flex-wrap:nowrap"><div><b>${l}</b><div class="hint">${h}</div></div>${sw(!!site[k], `data-site="${k}" ${manage ? '' : 'disabled'}`)}</div>`).join('')}
        <div class="fld"><label>Announcement bar</label><input class="inp sm" id="ann" value="${esc(site.announcement || '')}" placeholder="Leave empty to hide it" ${ro}></div>
        ${manage ? '<div class="row end"><button class="btn brand sm" id="ssite">Save switches</button></div>' : ''}</div></div>
      <div class="card"><div class="card-h"><div><h3>Referral programme</h3><p>Commission on what referred customers pay.</p></div></div><div class="card-b">
        <div id="tiers">${ref.tiers.map((t, i) => `<div class="row" style="flex-wrap:nowrap;margin-bottom:8px"><span class="hint" style="width:56px">From</span><input class="inp sm" type="number" min="1" value="${esc(t.min)}" data-tier="${i}.min" ${ro}><span class="hint" style="white-space:nowrap">referrals →</span><input class="inp sm" type="number" min="0" max="100" value="${esc(t.pct)}" data-tier="${i}.pct" ${ro}><span class="hint">%</span>${manage ? `<button class="iconbtn" data-dtier="${i}" aria-label="Remove tier">${ico('trash')}</button>` : ''}</div>`).join('')}</div>
        ${manage ? `<button class="btn ghost xs" id="atier">${ico('plus')} Add tier</button>` : ''}
        <div class="fields" style="margin-top:14px"><div class="fld"><label>Days before commission is final</label><input class="inp sm" id="rsd" type="number" min="0" value="${esc(ref.settle_days ?? '')}" ${ro}></div><div class="fld"><label>Minimum withdrawal ($)</label><input class="inp sm" id="rmw" type="number" min="0" value="${esc(ref.min_withdraw_usd ?? '')}" ${ro}></div></div>
        ${manage ? '<div class="row end" style="margin-top:14px"><button class="btn brand sm" id="sref">Save referral</button></div>' : ''}</div></div>
      </div>
      <div class="card"><div class="card-h"><div><h3>House actors</h3><p>The 45 AI actors customers can pick, their voices, tags and order, live in <a class="linkbtn" href="#/houseactors">House actors</a>.</p></div></div></div>
      <div class="grid2">
      <div class="card"><div class="card-h"><div><h3>Voices</h3><p>ElevenLabs voice IDs, by the name presenters use.</p></div>${manage ? `<button class="btn ghost xs" id="avoice">${ico('plus')} Add</button>` : ''}</div><div class="card-b">
        ${Object.entries(voices).map(([k, v], i) => `<div class="row" style="flex-wrap:nowrap;margin-bottom:8px"><input class="inp sm mono" value="${esc(k)}" data-vk="${i}" style="max-width:45%" ${ro}><input class="inp sm mono" value="${esc(v)}" data-vv="${i}" ${ro}>${manage ? `<button class="iconbtn" data-dvoice="${esc(k)}" aria-label="Remove voice">${ico('trash')}</button>` : ''}</div>`).join('')}
        ${manage ? '<div class="row end" style="margin-top:12px"><button class="btn brand sm" id="svoice">Save voices</button></div>' : ''}</div></div>
      <div class="card"><div class="card-h"><div><h3>Server</h3><p>Change these in <a class="linkbtn" href="#/integrations">Integrations</a>.</p></div></div><div class="card-b list">
        <div class="li"><span class="muted">App URL</span><span class="k">${esc(r.env.app_url)}</span></div>
        <div class="li"><span class="muted">Owner email</span><span>${esc(r.env.owner || 'Not set')}</span></div>
        <div class="li"><span class="muted">Email sending</span>${r.env.email_live ? '<span class="pill good">Resend connected</span>' : '<span class="pill warn">Not set up</span>'}</div>
        <div class="li"><span class="muted">Voo ID login</span>${r.env.voosquare_login ? '<span class="pill good">Connected</span>' : '<span class="pill plain">Off</span>'}</div>
        <div class="li"><span class="muted">Data folder</span><span class="k">${esc(r.env.data_dir)}</span></div></div></div>
      </div></div>`;
    bind();
  };
  const collectPres = () => $$('[data-pres]', el).forEach((f) => { const [i, k] = f.dataset.pres.split('.'); pres[i][k] = f.value.trim(); });
  const collectVoices = () => { const out = {}; $$('[data-vk]', el).forEach((f) => { const k = f.value.trim(); const v = $(`[data-vv="${f.dataset.vk}"]`, el).value.trim(); if (k) out[k] = v; }); Object.keys(voices).forEach((k) => delete voices[k]); Object.assign(voices, out); };
  const collectTiers = () => $$('[data-tier]', el).forEach((f) => { const [i, k] = f.dataset.tier.split('.'); ref.tiers[i][k] = Number(f.value); });
  const bind = () => {
    if (!manage) return;
    $$('[data-site]', el).forEach((b) => b.onclick = () => { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', on); site[b.dataset.site] = on; });
    $('#ssite').onclick = (e) => { site.announcement = $('#ann').value.trim(); save('site', site, e.currentTarget, 'Site switches saved'); };
    $('#atier').onclick = () => { collectTiers(); ref.tiers.push({ min: (ref.tiers.at(-1)?.min || 0) + 10, pct: (ref.tiers.at(-1)?.pct || 10) + 5 }); draw(); };
    $$('[data-dtier]', el).forEach((b) => b.onclick = () => { collectTiers(); ref.tiers.splice(Number(b.dataset.dtier), 1); draw(); });
    $('#sref').onclick = (e) => { collectTiers(); ref.tiers.sort((a, b) => a.min - b.min); ref.settle_days = Number($('#rsd').value) || 0; ref.min_withdraw_usd = Number($('#rmw').value) || 0; save('referral', ref, e.currentTarget, 'Referral settings saved'); };
    $('#avoice').onclick = () => { collectVoices(); voices['voice_' + (Object.keys(voices).length + 1)] = ''; draw(); };
    $$('[data-dvoice]', el).forEach((b) => b.onclick = () => { collectVoices(); delete voices[b.dataset.dvoice]; draw(); });
    $('#svoice').onclick = (e) => { collectVoices(); save('voices', voices, e.currentTarget, 'Voices saved'); };
  };
  draw();
};

// ---------- Profit guard ----------
const LIMIT_DEF = { trial_max_jobs_per_day: 10, max_concurrent_jobs: 3, daily_credit_cap: 0, max_signups_per_ip_per_day: 3, upload_quota_mb: 2000, upload_keep_days: 7 };
const LIMIT_INFO = [
  ['trial_max_jobs_per_day', 'Jobs per day on the free trial', 'Stops people farming free credits. Paid plans are not affected.'],
  ['max_concurrent_jobs', 'Jobs running at once, per customer', 'Extra jobs wait in line instead of piling up provider costs.'],
  ['daily_credit_cap', 'Credits one customer can spend per day', '0 means no cap. Useful if a card is stolen and used to burn credits.'],
  ['max_signups_per_ip_per_day', 'Sign-ups per internet address per day', 'Blocks bulk fake accounts from one place.'],
  ['upload_quota_mb', 'Upload space per customer (MB)', 'Videos uploaded for Change background and Auto-edit. 0 means no limit.'],
  ['upload_keep_days', 'Keep uploads for (days)', 'Uploaded videos are deleted after this many days (finished videos stay in My ads).'],
];
// Accepts the margins API in any reasonable shape and returns { rows, perCredit, min, source }.
function normMargins(d) {
  d = d || {};
  let rows = [];
  const looks = (v) => Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] && ['margin_pct', 'marginPct', 'margin', 'credits', 'status'].some((k) => k in v[0]);
  if (Array.isArray(d)) rows = d;
  else for (const [k, v] of Object.entries(d)) if (looks(v)) rows = rows.concat(v.map((x) => ({ _group: k, ...x })));
  rows = rows.map((x) => ({
    id: x.id || x.type || x.key, name: x.name || x.label || x.id || x.type || x.key || '—',
    group: /\+addons/.test(x.kind || '') ? 'with add-ons' : String(x.kind || x.group || x._group || '').replace(/_/g, ' ').replace(/s$/, ''), unit: x.unit || x.per || '',
    sample: x.sample ? (x.sample.seconds ? x.sample.seconds + 's sample' : x.sample.count ? x.sample.count + ' item' + (x.sample.count > 1 ? 's' : '') : '') : '',
    cost: num(x.provider_cost_usd ?? x.providerCostUsd ?? x.cost_usd ?? x.cost), credits: num(x.credits ?? x.credits_per_unit),
    revenue: num(x.revenue_usd ?? x.revenueUsd ?? x.worst_case_revenue_usd ?? x.revenue),
    margin: x.margin_pct ?? x.marginPct ?? x.margin ?? null, status: x.status, provider: x.provider || x.provider_name || '',
    safe: x.min_safe_credits ?? x.safe_credits ?? x.minSafeCredits, enabled: x.enabled,
  }));
  return { rows, perCredit: num(d.worst_case_usd_per_credit ?? d.usd_per_credit ?? d.worstCaseUsdPerCredit ?? d.per_credit_usd ?? d.worst_case?.usd_per_credit, 0) || null, min: d.min_margin_pct ?? d.minMarginPct ?? null, source: d.worst_case_source || d.worst_case?.label || d.source || (num(d.max_discount_pct) ? 'after the biggest active discount, ' + num(d.max_discount_pct) + '% off' : ''), limits: d.limits || null, ffmpeg: d.ffmpeg };
}
function marginSummary(rows, min = 60) {
  const s = { total: rows.length, ok: 0, low: 0, loss: 0, worst: null, rows };
  rows.forEach((r) => { const st = r.status || marginStatus(r.margin == null ? null : num(r.margin), min); if (s[st] != null) s[st]++; if (r.margin != null && (s.worst == null || num(r.margin) < s.worst)) s.worst = num(r.margin); });
  return s;
}
// Same formula as the server (SPEC §4), used while /api/admin/margins is not there yet.
function estimateMargins(P, discounts) {
  const c = cheapestCredit(P, discounts), rows = [];
  for (const vt of P.video_types || []) rows.push({ id: vt.id, name: vt.name, group: 'video type', unit: vt.unit === 'item' ? 'item' : 'second', cost: num(vt.provider_cost_usd_per_unit), credits: num(vt.credits_per_unit), revenue: num(vt.credits_per_unit) * c.v, margin: marginOf(vt.credits_per_unit, vt.provider_cost_usd_per_unit, c.v), enabled: vt.enabled });
  for (const k of Object.keys(P.costs || {})) { const cost = unitCost(k, P.provider_cost_usd || {}); if (cost == null) continue; rows.push({ id: k, name: COST_LABEL[k] || k, group: 'job', unit: /per_second/.test(k) ? 'second' : 'job', cost, credits: num(P.costs[k]), revenue: num(P.costs[k]) * c.v, margin: marginOf(P.costs[k], cost, c.v) }); }
  return { rows, perCredit: c.v, min: P.min_margin_pct, source: c.l };
}

VIEWS.guard = async (el, acts) => {
  const manage = can('pricing.manage'), setManage = can('settings.manage');
  const [mg, pr, st] = await Promise.all([tryGet('/api/admin/margins'), GET('/api/admin/pricing'), can('settings.view') ? tryGet('/api/admin/settings') : null]);
  if (!mg.ok && !mg.missing) throw mg.error;
  const P = pr.pricing;
  const est = !mg.ok;
  const data = est ? estimateMargins(P, pr.discounts) : normMargins(mg.data);
  const cheap = cheapestCredit(P, pr.discounts);
  const perCredit = data.perCredit || cheap.v;
  let minM = num(P.min_margin_pct ?? data.min, 60), savedMin = minM;
  const limitsRaw = data.limits || (st?.ok ? st.data.limits : null);
  const limits = { ...LIMIT_DEF, ...(limitsRaw || {}) };
  acts.innerHTML = can('pricing.view') ? `<a class="btn ghost sm" href="#/pricing/types">${ico('pricing')} Edit video types</a>` : '';
  el.innerHTML = `<div class="stack">
    ${est ? naCard('Showing an estimate for now', 'The live guard (which also reads each AI provider\'s real cost) switches on with the server update. This estimate uses the credits and costs in Pricing, with the same formula.') : ''}
    <div class="kpis stagger" id="gk"></div>
    <div class="card" style="overflow:hidden"><div class="card-h"><div><h3>Every job, at the worst price</h3><p>Credits a job takes, what the AI costs you, and what you earn if the customer paid the lowest possible price per credit.</p></div><div class="seg" id="gf"><button class="on" data-f="">All</button><button data-f="loss">Loss</button><button data-f="low">Low</button><button data-f="ok">OK</button></div></div><div id="gt"></div></div>
    <div class="grid2">
      <div class="card"><div class="card-h"><div><h3>Minimum margin</h3><p>Jobs below this are not allowed at their price. The guard raises the credits on that job until it is safe.</p></div></div>
        <div class="card-b stack" style="gap:12px"><div class="row" style="flex-wrap:nowrap;gap:14px"><input type="range" class="rng" id="gmr" min="0" max="90" step="1" value="${minM}" ${manage ? '' : 'disabled'} aria-label="Minimum margin"><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="inp sm num" id="gmn" type="number" min="0" max="90" value="${minM}" style="width:76px" ${manage ? '' : 'readonly'}><span class="hint">%</span></div></div>
          <p class="hint" id="gmh"></p>
          ${manage ? `<div class="row end"><button class="btn brand sm" id="gms" disabled>Save minimum ${ARR()}</button></div>` : ''}</div></div>
      <div class="card"><div class="card-h"><div><h3>Abuse limits</h3><p>Caps that stop free-credit farming and runaway spend.</p></div></div>
        <div class="card-b">${st && !st.ok && !st.missing ? `<div class="note bad">${esc(st.error.message)}</div>` : ''}<div class="fields">${LIMIT_INFO.map(([k, l, h]) => `<div class="fld"><label for="lim-${k}">${l}</label><input class="inp sm num" id="lim-${k}" data-lim="${k}" type="number" min="0" step="1" value="${esc(limits[k])}" ${setManage ? '' : 'readonly'}><small>${h}</small></div>`).join('')}</div>
          ${setManage ? `<div class="row end" style="margin-top:14px"><button class="btn brand sm" id="glsave">Save limits ${ARR()}</button></div>` : ''}</div></div>
    </div>
    ${data.ffmpeg != null ? `<div class="note ${data.ffmpeg ? '' : 'warn'}"><b>Long videos:</b> ${data.ffmpeg ? 'ffmpeg is installed, so videos longer than one render are stitched into a single file.' : 'ffmpeg is not installed on the server, so long videos are delivered as a playlist of parts. Add ffmpeg (nixpacks.toml) to get one file.'}</div>` : ''}
    <div class="card pad"><span class="eyebrow">How the guard works</span><p class="explain" style="margin-top:10px">Before any job runs, Vooads works out the <b>lowest price a customer could have paid for one credit</b>: the cheapest of every plan (monthly, and yearly divided by 12) and every top-up, then minus the biggest discount code that is still active. Right now that is <b class="mono">${money(perCredit, 4)}</b>${data.source || cheap.l ? ' (' + esc(data.source || cheap.l) + ')' : ''}. It multiplies the job's credits by that price to get the least you can earn, and compares it with what the AI provider charges for the job (the provider's own cost if you set one, otherwise the video type's cost). If the margin is under your minimum, the job is not run at that price: its credits are raised to the smallest safe number and the customer sees the new price before confirming. Longer videos cost the same per second as short ones, so length can never be used to get around it. Failed jobs refund every credit.</p></div>
  </div>`;
  let filt = '';
  const statusOf = (r) => marginStatus(r.margin == null ? null : num(r.margin), minM);
  const drawK = () => {
    const s = marginSummary(data.rows.map((r) => ({ ...r, status: statusOf(r) })), minM);
    $('#gk').innerHTML = [
      { l: 'Worst-case price per credit', v: money(perCredit, 4), s: data.source || cheap.l, hero: 1 },
      { l: 'Safe', v: int(s.ok), s: 'at or above ' + minM + '%' },
      { l: 'Running low', v: int(s.low), s: 'between 0% and ' + minM + '%' },
      { l: 'At a loss', v: int(s.loss), s: s.loss ? 'The guard is raising these prices' : 'None. Every job pays.', alert: s.loss },
    ].map((k, i) => `<div class="card kpi ${k.hero ? 'hero' : ''}" style="--i:${i};${k.alert ? 'border-color:#F2C2BB;box-shadow:0 0 0 3px var(--bad-bg)' : ''}"><div class="l">${esc(k.l)}</div><div class="v">${esc(k.v)}</div><div class="s">${esc(k.s)}</div></div>`).join('');
    $('#gmh').innerHTML = `With ${minM}%, a job that costs you $1.00 must earn at least <b>${money(1 / Math.max(.05, 1 - minM / 100), 2)}</b>.`;
  };
  const drawT = () => {
    const rows = data.rows.filter((r) => !filt || statusOf(r) === filt).sort((a, b) => num(a.margin, 999) - num(b.margin, 999));
    $('#gt').innerHTML = rows.length ? tbl([{ t: 'Job' }, { t: 'Your cost', r: 1 }, { t: 'Credits', r: 1 }, { t: 'Earned at worst', r: 1 }, { t: 'Margin' }, { t: 'Status' }], rows.map((r) => {
      const s = statusOf(r), m = r.margin == null ? null : num(r.margin), col = s === 'loss' ? 'var(--bad)' : s === 'low' ? 'var(--warn)' : 'var(--good)';
      const safe = r.safe ?? (s && s !== 'ok' && r.cost ? safeCredits(r.cost, minM, perCredit) : null);
      return `<tr><td class="lead" data-l="Job"><b>${esc(r.name)}</b>${r.enabled === false ? ' <span class="pill plain">Off</span>' : ''}<span class="sub">${esc([r.group, r.sample || (r.unit ? 'per ' + r.unit : ''), r.provider].filter(Boolean).join(' · '))}</span></td>
        <td class="r num mono" data-l="Your cost">${money(r.cost, r.cost < 1 ? 4 : 2)}</td><td class="r num mono" data-l="Credits">${int(r.credits)}${safe && s !== 'ok' ? `<span class="sub">safe: ${int(safe)}</span>` : ''}</td><td class="r num mono" data-l="Earned at worst">${money(r.revenue || r.credits * perCredit, 4)}</td>
        <td data-l="Margin"><div class="row" style="flex-wrap:nowrap;gap:10px;justify-content:flex-end"><div class="mbar grow" style="max-width:140px"><i style="width:${Math.max(0, Math.min(100, m ?? 0))}%;background:${col}"></i><span class="min" style="left:${Math.min(99, minM)}%"></span></div><b class="mono" style="color:${col};min-width:44px;text-align:right">${m == null ? '—' : Math.round(m) + '%'}</b></div></td>
        <td data-l="Status">${mpPill(s)}</td></tr>`;
    })) : emptyCard(filt ? 'Nothing here' : 'No jobs to check yet', filt ? 'No job has this status.' : 'Add video types in Pricing and they show up here.');
  };
  $$('#gf button').forEach((b) => b.onclick = () => { $$('#gf button').forEach((x) => x.classList.toggle('on', x === b)); filt = b.dataset.f; drawT(); });
  const setMin = (v) => { minM = Math.max(0, Math.min(90, Math.round(num(v)))); $('#gmr').value = minM; if (document.activeElement !== $('#gmn')) $('#gmn').value = minM; drawK(); drawT(); $('#gms') && ($('#gms').disabled = minM === savedMin); };
  $('#gmr').oninput = (e) => setMin(e.target.value);
  $('#gmn').oninput = (e) => { if (e.target.value !== '') setMin(e.target.value); };
  $('#gms') && ($('#gms').onclick = async (e) => {
    const fresh = (await GET('/api/admin/pricing')).pricing; fresh.min_margin_pct = minM;
    if (await act(e.currentTarget, () => PUT('/api/admin/pricing', { pricing: fresh }), 'Minimum margin set to ' + minM + '%')) { savedMin = minM; $('#gms').disabled = true; }
  });
  $('#glsave') && ($('#glsave').onclick = async (e) => {
    const value = {}; for (const f of $$('[data-lim]', el)) value[f.dataset.lim] = Math.max(0, Math.round(num(f.value)));
    await act(e.currentTarget, () => PUT('/api/admin/settings/limits', { value }).catch((x) => { if (x.status === 400 && /unknown setting/i.test(x.message)) throw new Error('Abuse limits can be saved once the server update lands.'); throw x; }), 'Abuse limits saved');
  });
  drawK(); drawT();
};

// ---------- AI brain ----------
const VERTICAL_TEMPLATE = { id: 'new-niche', name: 'New niche', audiences: '', pains: '', angles: [], hook_examples: [], proof_types: [], ctas: [], banned_claims: [], compliance_notes: '', best_formats: [] };
function checkVerticals(src) {
  let v;
  try { v = JSON.parse(src); } catch (e) {
    const m = String(e.message).match(/position (\d+)/); let where = '';
    if (m) { const pos = Number(m[1]); const pre = src.slice(0, pos).split('\n'); where = ' (line ' + pre.length + ', column ' + (pre[pre.length - 1].length + 1) + ')'; }
    return { error: 'Not valid JSON' + where + '. Check quotes and commas.' };
  }
  if (!Array.isArray(v)) return { error: 'It must be a list: start with [ and end with ].' };
  const ids = new Set();
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { error: 'Item ' + (i + 1) + ' is not an object { … }.' };
    if (!x.id || !x.name) return { error: 'Item ' + (i + 1) + ' needs an "id" and a "name".' };
    if (ids.has(x.id)) return { error: 'The id "' + x.id + '" is used twice.' };
    ids.add(x.id);
  }
  return { value: v };
}
const asList = (x) => Array.isArray(x) ? x : x ? [x] : [];

VIEWS.brain = async (el, acts) => {
  const manage = can('settings.manage');
  const r = await tryGet('/api/admin/ai-brain');
  if (!r.ok) {
    if (r.missing) { el.innerHTML = naCard('The AI brain editor is not switched on yet', 'The playbook, the niche list and the weekly trends become editable here when the server update lands. Until then the AI uses the built-in files.'); return; }
    throw r.error;
  }
  const d = r.data;
  const part = (k) => { const x = d[k] ?? d['ai_' + k]; return x && typeof x === 'object' && !Array.isArray(x) && 'value' in x ? x : { value: x }; };
  let vsrc = part('verticals').value ?? [];
  if (typeof vsrc === 'string') { try { vsrc = JSON.parse(vsrc); } catch {} }
  if (vsrc && !Array.isArray(vsrc) && Array.isArray(vsrc.verticals)) vsrc = vsrc.verticals;
  const from = { playbook: part('playbook').from, verticals: part('verticals').from, trends: part('trends').from };
  const fileOf = { playbook: part('playbook').file, verticals: part('verticals').file, trends: part('trends').file };
  let B = { playbook: String(part('playbook').value ?? ''), verticals: Array.isArray(vsrc) ? vsrc : [], trends: String(part('trends').value ?? '') };
  let saved = JSON.stringify(B), vjson = JSON.stringify(B.verticals, null, 2), vErr = null;
  const testUrl = '/api/admin/ai-brain/preview';
  const srcNote = (k) => `<span class="hint" style="font-size:12.5px">${from[k] === 'setting' ? 'Edited here' : 'Using the built-in file'}${fileOf[k] ? ' <span class="k">' + esc(fileOf[k]) + '</span>' : ''}${manage && from[k] === 'setting' ? ` · <button class="linkbtn" data-reset="${k}" style="font-size:12.5px">Go back to the file</button>` : ''}</span>`;
  let tab = 'playbook', vmode = 'list', vq = '';
  const ro = manage ? '' : 'readonly';
  const editor = (id, val, ph) => `<div class="row between" style="margin-bottom:10px"><div class="seg etabs" data-et="${id}"><button class="on" data-m="w">Write</button><button data-m="p">Preview</button></div><span class="hint mono" style="font-size:11px" data-wc="${id}"></span></div>
    <div class="editor w" data-ed="${id}"><textarea class="inp" data-md="${id}" spellcheck="true" placeholder="${esc(ph)}" ${ro}>${esc(val)}</textarea><div class="pv prose" data-pv="${id}"></div></div>`;
  const draw = () => {
    el.innerHTML = `<div class="stack">
      <div class="tabs" id="btabs"><button data-t="playbook">Playbook</button><button data-t="verticals">Niches (${B.verticals.length})</button><button data-t="trends">Trends</button>${testUrl ? '<button data-t="test">Test the brain</button>' : ''}</div>
      <div data-p="playbook"><div class="row between" style="margin-bottom:12px"><p class="hint">Core ad know-how used in every prompt: hook frameworks, UGC script structure, pacing by length, calls to action, platform rules and what converts. Markdown.</p>${srcNote('playbook')}</div>${editor('playbook', B.playbook, '# Hook frameworks\n- Pattern interrupt…')}</div>
      <div data-p="verticals" hidden>
        <div class="row between" style="margin-bottom:10px"><p class="hint">One entry per niche: who buys, their pains, angles, example hooks, proof, CTAs and claims the AI must never make. The AI picks the niche from the product, or the customer picks it.</p>${srcNote('verticals')}</div>
        <div class="row between" style="margin-bottom:12px"><div class="seg" id="vm"><button data-vm="list" class="${vmode === 'list' ? 'on' : ''}">${ico('list').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"')}List</button><button data-vm="json" class="${vmode === 'json' ? 'on' : ''}">${ico('code').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"')}JSON</button></div>
          <div class="row">${vmode === 'list' ? `<input class="inp sm" id="vq" type="search" placeholder="Search niches" value="${esc(vq)}" style="max-width:220px">` : `<span class="jstate" id="vjs"></span>`}${manage ? `<button class="btn ghost sm" id="vadd">${ico('plus')} Add niche</button>` : ''}</div></div>
        <div id="vbody"></div></div>
      <div data-p="trends" hidden><div class="row between" style="margin-bottom:12px"><div><p class="hint">Dated notes on what is working now. The AI reads the newest first. Update weekly.</p>${srcNote('trends')}</div>${manage ? `<button class="btn ghost sm" id="tadd">${ico('plus')} Add this week</button>` : ''}</div>${editor('trends', B.trends, '## ' + new Date().toISOString().slice(0, 10) + '\n- ')}</div>
      ${testUrl ? `<div data-p="test" hidden><div class="card pad stack" style="gap:14px"><p class="hint">See exactly what the AI is told before it writes: which niche it picks for a product, the full instructions, and the beat plan for the length. Free: nothing is generated and no customer is touched. Uses the saved version.</p>
        <div class="fields"><div class="fld"><label>Product</label><input class="inp sm" id="tprod" placeholder="e.g. Vitamin C serum for dark spots"></div><div class="fld"><label>Niche</label><select class="inp sm" id="tniche"><option value="">Detect from the product</option>${B.verticals.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('')}</select></div>
          <div class="fld"><label>Task</label><select class="inp sm" id="ttask"><option value="hooks">Hook pack</option><option value="script">UGC script</option><option value="angles">Angles</option></select></div><div class="fld"><label>Video length</label><select class="inp sm" id="tsec"><option>15</option><option selected>30</option><option>60</option></select></div></div>
        <div class="row end"><button class="btn brand sm" id="trun">Show what the AI sees ${ARR()}</button></div><div id="tout"></div></div></div>` : ''}
    </div>`;
    bindAll(); showTab(); drawV();
  };
  const showTab = () => { $$('#btabs button', el).forEach((b) => b.classList.toggle('on', b.dataset.t === tab)); $$('[data-p]', el).forEach((p) => p.hidden = p.dataset.p !== tab); };
  const drawV = () => {
    const box = $('#vbody', el); if (!box) return;
    if (vmode === 'json') {
      box.innerHTML = `<textarea class="inp mono" id="vj" rows="24" spellcheck="false" style="font-size:13px;line-height:1.6;min-height:460px" ${ro}>${esc(vjson)}</textarea><p class="hint" style="margin-top:8px">Each niche: <span class="k">id</span>, <span class="k">name</span>, <span class="k">audiences</span>, <span class="k">pains</span>, <span class="k">angles[]</span>, <span class="k">hook_examples[]</span>, <span class="k">proof_types[]</span>, <span class="k">ctas[]</span>, <span class="k">banned_claims[]</span>, <span class="k">compliance_notes</span>, <span class="k">best_formats[]</span>.</p>`;
      const ta = $('#vj', el);
      const val = () => { const c = checkVerticals(ta.value); vjson = ta.value; vErr = c.error || null; ta.classList.toggle('jsonbad', !!vErr); $('#vjs', el).innerHTML = vErr ? `<span style="color:var(--bad)">${esc(vErr)}</span>` : `<span style="color:var(--good)">Valid · ${c.value.length} niches</span>`; if (!vErr) B.verticals = c.value; savebar(); };
      ta.oninput = debounce(val, 200); val();
      return;
    }
    const q = vq.toLowerCase();
    const list = B.verticals.filter((v) => !q || JSON.stringify(v).toLowerCase().includes(q));
    box.innerHTML = list.length ? `<div class="vgrid stagger">${list.map((v, i) => `<button class="card vcard" data-vi="${B.verticals.indexOf(v)}" style="--i:${Math.min(i, 12)}"><h4>${esc(v.name)} <small>${esc(v.id)}</small></h4><p>${esc(Array.isArray(v.audiences) ? v.audiences.join(', ') : v.audiences || v.pains || 'No audience written yet')}</p>
      <div class="cnt"><span class="tag2">${asList(v.angles).length} angles</span><span class="tag2">${asList(v.hook_examples).length} hooks</span><span class="tag2">${asList(v.ctas).length} CTAs</span>${asList(v.banned_claims).length ? `<span class="tag2" style="color:var(--bad)">${asList(v.banned_claims).length} banned claims</span>` : ''}</div></button>`).join('')}</div>` : emptyCard(q ? 'No niche matches' : 'No niches yet', q ? 'Try another word.' : manage ? 'Add one, or switch to JSON and paste a list.' : '');
    $$('[data-vi]', box).forEach((b) => b.onclick = () => vDetail(Number(b.dataset.vi)));
  };
  const vDetail = (i) => {
    const v = B.verticals[i];
    const sec = (t, x) => { const l = asList(x).filter(Boolean); return l.length ? `<div><h6>${t}</h6>${l.length === 1 && typeof l[0] === 'string' && !Array.isArray(x) ? `<p style="font-size:14px">${esc(l[0])}</p>` : `<ul>${l.map((y) => `<li>${esc(typeof y === 'object' ? JSON.stringify(y) : y)}</li>`).join('')}</ul>`}</div>` : ''; };
    modal({ title: esc(v.name) + ' <span class="k" style="font-size:12px;vertical-align:4px">' + esc(v.id) + '</span>', cls: 'wide', ok: manage ? 'Edit as JSON' : '', okClass: 'ghost', cancel: 'Close',
      body: `<div class="vdetail">${sec('Audiences', v.audiences)}${sec('Pains', v.pains)}${sec('Angles', v.angles)}${sec('Hook examples', v.hook_examples)}${sec('Proof that works', v.proof_types)}${sec('Calls to action', v.ctas)}${sec('Never claim', v.banned_claims)}${sec('Compliance notes', v.compliance_notes)}${sec('Best formats', v.best_formats)}</div>`,
      onOk: () => { vmode = 'json'; draw(); setTimeout(() => { const ta = $('#vj', el); const at = ta.value.indexOf('"id": "' + v.id + '"'); if (at >= 0) { ta.focus(); ta.setSelectionRange(at, at); const lines = ta.value.slice(0, at).split('\n').length; ta.scrollTop = Math.max(0, (lines - 3) * 21); } }, 60); } });
  };
  const bindAll = () => {
    $$('#btabs button', el).forEach((b) => b.onclick = () => { tab = b.dataset.t; showTab(); });
    for (const id of ['playbook', 'trends']) {
      const ta = $(`[data-md="${id}"]`, el), pv = $(`[data-pv="${id}"]`, el);
      const upd = () => { pv.innerHTML = md(ta.value) || '<p class="muted">The preview shows here.</p>'; const w = ta.value.trim().split(/\s+/).filter(Boolean).length; $(`[data-wc="${id}"]`, el).textContent = int(w) + ' words'; };
      ta.addEventListener('input', debounce(() => { B[id] = ta.value; upd(); savebar(); }, 150)); upd();
      $$(`[data-et="${id}"] button`, el).forEach((b) => b.onclick = () => { $$(`[data-et="${id}"] button`, el).forEach((x) => x.classList.toggle('on', x === b)); $(`[data-ed="${id}"]`, el).className = 'editor ' + b.dataset.m; });
    }
    $$('#vm button', el).forEach((b) => b.onclick = () => { if (vmode === b.dataset.vm) return; if (vmode === 'json' && vErr) return toast('Fix the JSON first: ' + vErr, true); vmode = b.dataset.vm; if (vmode === 'json') vjson = JSON.stringify(B.verticals, null, 2); draw(); tab = 'verticals'; showTab(); });
    $('#vq', el) && ($('#vq', el).oninput = debounce((e) => { vq = e.target.value.trim(); drawV(); }, 150));
    $('#vadd', el) && ($('#vadd', el).onclick = () => {
      if (vmode === 'json' && vErr) return toast('Fix the JSON first: ' + vErr, true);
      const n = { ...clone(VERTICAL_TEMPLATE), id: 'new-niche-' + (B.verticals.length + 1) };
      B.verticals.push(n); vjson = JSON.stringify(B.verticals, null, 2); vmode = 'json'; draw(); tab = 'verticals'; showTab(); savebar();
      setTimeout(() => { const ta = $('#vj', el); ta.focus(); const at = ta.value.lastIndexOf('"name"'); ta.setSelectionRange(at, at); ta.scrollTop = ta.scrollHeight; }, 60);
    });
    $$('[data-reset]', el).forEach((b) => b.onclick = () => modal({ title: 'Go back to the built-in ' + b.dataset.reset + '?', body: '<p>Your edits here are removed and the AI uses the file in the code again.</p>', ok: 'Go back', okClass: 'danger', onOk: async (w, btn) => { const x = await act(btn, () => PUT('/api/admin/ai-brain', { [b.dataset.reset]: null }), 'Using the built-in file again'); if (!x) return false; route(); } }));
    $('#tadd', el) && ($('#tadd', el).onclick = () => { const ta = $('[data-md="trends"]', el); const h = '## ' + new Date().toISOString().slice(0, 10) + '\n- \n\n'; ta.value = h + ta.value; ta.focus(); ta.setSelectionRange(h.length - 2, h.length - 2); ta.dispatchEvent(new Event('input')); });
    $('#trun', el) && ($('#trun', el).onclick = async (e) => {
      if (!$('#tprod', el).value.trim()) { $('#tprod', el).focus(); return toast('Describe a product first.', true); }
      const x = await act(e.currentTarget, () => POST(testUrl, { task: $('#ttask', el).value, niche: $('#tniche', el).value || '', product: $('#tprod', el).value.trim(), seconds: Number($('#tsec', el).value) }));
      if (!x) return;
      const vname = B.verticals.find((v) => v.id === x.vertical)?.name || x.vertical;
      const plan = x.plan && (x.plan.beats || (Array.isArray(x.plan) ? x.plan : null));
      $('#tout', el).innerHTML = `<div class="stack" style="gap:12px;animation:up .35s var(--ease) both"><div class="row"><span class="hint">Niche used:</span>${x.vertical ? `<span class="pill ink">${esc(vname)}</span>` : '<span class="pill plain">General (no niche matched)</span>'}${x.plan?.name || x.plan?.template ? `<span class="pill plain">Structure: ${esc(x.plan.name || x.plan.template)}</span>` : ''}</div>
        ${plan ? `<div><div class="secth" style="margin:0 0 8px"><span>Beat plan · ${esc($('#tsec', el).value)}s</span></div>${tbl([{ t: 'When' }, { t: 'Beat' }, { t: 'What happens' }], plan.map((b) => `<tr><td class="nowrap mono" data-l="When">${esc(b.from ?? b.start ?? b.at ?? '')}${(b.to ?? b.end) != null ? '–' + esc(b.to ?? b.end) + 's' : b.seconds != null ? esc(b.seconds) + 's' : ''}</td><td data-l="Beat"><b>${esc(b.name || b.beat || b.label || '')}</b></td><td data-l="What">${esc(b.goal || b.text || b.description || b.note || '')}</td></tr>`), '')}</div>` : x.plan ? `<div class="tplcheck">${esc(JSON.stringify(x.plan, null, 2))}</div>` : ''}
        <details><summary style="cursor:pointer;font-weight:700">Full instructions the AI gets (${int(String(x.system || '').length)} characters)</summary><div class="tplcheck" style="margin-top:8px;max-height:420px">${esc(x.system || '')}</div></details></div>`;
    });
  };
  const dirty = () => JSON.stringify(B) !== saved;
  const savebar = () => {
    let bar = $('.savebar');
    if (!manage || !dirty()) { bar?.remove(); return; }
    if (bar) return;
    bar = document.createElement('div'); bar.className = 'savebar';
    bar.innerHTML = `<span>Unsaved AI brain changes</span><button class="btn ghost sm" data-d>Discard</button><button class="btn white sm" data-s>Save ${ARR()}</button>`;
    document.body.appendChild(bar);
    $('[data-d]', bar).onclick = () => { B = JSON.parse(saved); vjson = JSON.stringify(B.verticals, null, 2); vErr = null; bar.remove(); const t0 = tab; draw(); tab = t0; showTab(); };
    $('[data-s]', bar).onclick = async (e) => {
      if (vErr) { tab = 'verticals'; showTab(); return toast('Fix the niches JSON first: ' + vErr, true); }
      const old = JSON.parse(saved), body = {};
      for (const k of ['playbook', 'verticals', 'trends']) if (JSON.stringify(old[k]) !== JSON.stringify(B[k])) body[k] = B[k];
      const x = await act(e.currentTarget, () => PUT('/api/admin/ai-brain', body), 'AI brain saved. New jobs use it right away.');
      if (x) { saved = JSON.stringify(B); bar.remove(); Object.keys(body).forEach((k) => { from[k] = 'setting'; }); const t0 = tab; draw(); tab = t0; showTab(); }
    };
  };
  draw();
};

// ---------- Voice & pronunciation (SPEC §12) ----------
let ttsVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
  const score = (v) => (/natural|neural|premium|enhanced/i.test(v.name) ? 4 : 0) + (/google|microsoft|samantha|daniel|serena|aria|jenny/i.test(v.name) ? 2 : 0) + (/en-(US|GB)/i.test(v.lang) ? 1 : 0);
  return vs.sort((a, b) => score(b) - score(a))[0] || null;
}
function speak(text, onEnd) {
  if (!('speechSynthesis' in window)) { toast('This browser cannot speak. Try Chrome or Safari.', true); return false; }
  speechSynthesis.cancel();
  ttsVoice ||= pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  if (ttsVoice) { u.voice = ttsVoice; u.lang = ttsVoice.lang; }
  u.rate = 1; u.onend = u.onerror = () => onEnd?.();
  speechSynthesis.speak(u);
  return true;
}
VIEWS.voice = async (el, acts) => {
  const manage = can('settings.manage');
  const [r, pv, pr] = await Promise.all([tryGet('/api/admin/pronunciations'), can('providers.view') ? tryGet('/api/admin/providers') : null, can('pricing.view') ? tryGet('/api/admin/pricing') : null]);
  if (!r.ok && !r.missing) throw r.error;
  let rows = r.ok ? clone(r.data.pronunciations || []) : [];
  const defaults = r.ok ? (r.data.defaults || []) : [];
  let saved = JSON.stringify(rows);
  const ro = manage && r.ok ? '' : 'readonly';
  const voices = pv?.ok ? pv.data.providers.filter((p) => p.kind === 'voice') : null;
  const tiers = pr?.ok ? (pr.data.pricing.voice_tiers || {}) : {};
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { ttsVoice = pickVoice(); };
  S.cleanup.push(() => { try { speechSynthesis.cancel(); } catch {} });
  el.innerHTML = `<div class="stack">
    ${r.ok ? '' : naCard('The pronunciation dictionary is not switched on yet', 'It becomes editable here when the server update lands.')}
    <div class="grid2" style="align-items:start">
      <div class="card"><div class="card-h"><div><h3>Pronunciation dictionary</h3><p>Words the voice must say a certain way. Applied to every voiceover: UGC, animated ads, dubs and lesson narration. Whole words, any capitals.</p></div>
        ${manage && r.ok ? `<div class="row"><button class="btn ghost xs" id="prst">Reset to defaults</button><button class="btn ghost xs" id="padd">${ico('plus')} Add word</button></div>` : ''}</div>
        <div id="ptbl"></div></div>
      <div class="stack">
        <div class="card"><div class="card-h"><div><h3>Hear it</h3><p>Type a line. You see what the voice gets, then hear it with your browser's voice. Uses the dictionary as it is now, even before you save.</p></div></div>
          <div class="card-b stack" style="gap:12px">
            <textarea class="inp sm" id="ttext" rows="3">Make 50 ads a day with Vooads. Log in with your VooSquare account, and pay with Gatevoo.</textarea>
            <div><div class="hint mono" style="font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px">The voice reads</div><div class="tplcheck" id="tout" style="background:var(--soft);color:var(--ink);border:1px solid var(--line)">…</div></div>
            <div class="row between"><span class="hint" style="font-size:12.5px">Browser voices are only a rough guide; the real voiceover uses your voice provider.</span><button class="btn brand sm" id="tsay">${ico('volume')} Say it</button></div>
          </div></div>
        <div class="card"><div class="card-h"><div><h3>Voice quality tiers</h3><p>Customers choose Standard or Ultra-realistic. Each tier uses the voice row marked with it in AI providers.</p></div>${can('providers.view') ? `<a class="btn ghost xs" href="#/providers">AI providers ${ARR()}</a>` : ''}</div>
          <div class="card-b">${['standard', 'ultra'].map((tk) => {
            const rowsT = voices ? voices.filter((p) => tierOfP(p) === tk) : [];
            const live = rowsT.filter((p) => p.enabled && (p.key_set || p.key_shared || NOKEY.includes(p.adapter)));
            return `<div class="envrow" style="align-items:flex-start"><span class="pill ${tk === 'ultra' ? 'violet' : 'plain'}" style="margin-top:2px">${tk === 'ultra' ? 'Ultra' : 'Standard'}</span><div class="grow"><b style="font-family:var(--sans);font-size:14px">${esc(tiers[tk]?.label || (tk === 'ultra' ? 'Ultra-realistic voice' : 'Standard voice'))}</b>
              <p>${voices ? (rowsT.length ? rowsT.map((p) => `${esc(p.name)}${p.model ? ' <span class="k">' + esc(p.model) + '</span>' : ''}${p.is_default ? ' (default)' : ''}${p.enabled ? '' : ' · off'}`).join('<br>') : 'No voice row is marked ' + (tk === 'ultra' ? 'Ultra' : 'Standard') + ' yet.') : 'Needs AI providers access to show.'}</p>${tiers[tk]?.provider_hint ? `<p class="hint" style="font-size:12px">Suggested: ${esc(tiers[tk].provider_hint)}</p>` : ''}</div>
              ${voices ? (live.length ? '<span class="pill good">Ready</span>' : `<span class="pill ${tk === 'ultra' ? 'warn' : 'bad'}">${rowsT.length ? 'No key' : 'Missing'}</span>`) : ''}</div>`;
          }).join('')}</div></div>
      </div>
    </div></div>`;
  const dirty = () => JSON.stringify(rows.filter((x) => x.word.trim())) !== saved;
  const savebar = () => {
    let bar = $('.savebar');
    if (!manage || !r.ok || !dirty()) { bar?.remove(); return; }
    if (bar) return;
    bar = document.createElement('div'); bar.className = 'savebar';
    bar.innerHTML = `<span>Unsaved pronunciations</span><button class="btn ghost sm" data-d>Discard</button><button class="btn white sm" data-s>Save ${ARR()}</button>`;
    document.body.appendChild(bar);
    $('[data-d]', bar).onclick = () => { rows = JSON.parse(saved); bar.remove(); drawT(); preview(); };
    $('[data-s]', bar).onclick = async (e) => {
      const clean = rows.map((x) => ({ word: x.word.trim(), say: x.say.trim() })).filter((x) => x.word);
      const dup = clean.map((x) => x.word.toLowerCase()).find((w, i, a) => a.indexOf(w) !== i);
      if (dup) return toast('"' + dup + '" is in the list twice.', true);
      const x = await act(e.currentTarget, () => PUT('/api/admin/pronunciations', { pronunciations: clean }), 'Saved. Every new voiceover uses it.');
      if (x) { rows = clone(x.pronunciations || clean); saved = JSON.stringify(rows); bar.remove(); drawT(); }
    };
  };
  const drawT = () => {
    $('#ptbl').innerHTML = rows.length ? `<div class="tblw"><table class="tbl"><thead><tr><th>Written</th><th>Say it as</th><th></th></tr></thead><tbody>${rows.map((x, i) => `<tr><td><input class="inp sm" data-w="${i}" value="${esc(x.word)}" placeholder="Vooads" ${ro} aria-label="Word"></td><td><input class="inp sm" data-s="${i}" value="${esc(x.say)}" placeholder="Voo-ads" ${ro} aria-label="Say it as"></td><td class="r" style="width:96px;white-space:nowrap"><button class="iconbtn" data-hear="${i}" title="Hear it" aria-label="Hear it">${ico('volume')}</button>${manage && r.ok ? `<button class="iconbtn" data-del="${i}" title="Remove" aria-label="Remove">${ico('trash')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyCard('No words yet', manage ? 'Add your brand names so every voice says them right.' : '');
    $$('[data-w]', el).forEach((f) => f.oninput = () => { rows[f.dataset.w].word = f.value; savebar(); preview(); });
    $$('#ptbl [data-s]', el).forEach((f) => f.oninput = () => { rows[f.dataset.s].say = f.value; savebar(); preview(); });
    $$('[data-del]', el).forEach((b) => b.onclick = () => { rows.splice(Number(b.dataset.del), 1); drawT(); savebar(); preview(); });
    $$('[data-hear]', el).forEach((b) => b.onclick = () => { const x = rows[Number(b.dataset.hear)]; if (x.say.trim()) speak(x.say); });
  };
  const local = (text) => { let out = text; [...rows].filter((x) => x.word.trim()).sort((a, b) => b.word.length - a.word.length).forEach((x) => { out = out.replace(new RegExp('(?<![\\p{L}\\p{N}_])' + x.word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'giu'), () => x.say); }); return out; };
  let lastText = '';
  const preview = debounce(async () => {
    const text = $('#ttext').value;
    let out;
    if (r.ok) { try { out = (await POST('/api/admin/pronunciations/preview', { text, pronunciations: rows.filter((x) => x.word.trim()) })).text; } catch { out = local(text); } }
    else out = local(text);
    lastText = out;
    // Highlight what changed.
    const changed = new Set(rows.map((x) => x.say.trim()).filter(Boolean));
    let h = esc(out); [...changed].sort((a, b) => b.length - a.length).forEach((s) => { h = h.split(esc(s)).join(`<mark style="background:var(--brand-soft);color:var(--brand-dd);border-radius:4px;padding:0 2px">${esc(s)}</mark>`); });
    $('#tout').innerHTML = h || '…';
  }, 250);
  $('#ttext').oninput = preview;
  $('#tsay').onclick = async (e) => { await preview.flush?.(); const b = e.currentTarget; const txt = lastText || local($('#ttext').value); if (speak(txt, () => b.classList.remove('accent'))) b.classList.add('accent'); };
  $('#padd') && ($('#padd').onclick = () => { rows.push({ word: '', say: '' }); drawT(); savebar(); $(`[data-w="${rows.length - 1}"]`, el)?.focus(); });
  $('#prst') && ($('#prst').onclick = () => modal({ title: 'Reset to the default words?', body: `<p>Replaces the list with the ${defaults.length} built-in brand words. Nothing is saved until you press Save.</p>`, ok: 'Reset', onOk: () => { rows = clone(defaults); drawT(); savebar(); preview(); } }));
  drawT(); preview();
};

// ---------- Music library (SPEC §12) ----------
const MOOD_LABEL = { upbeat: 'Upbeat', chill: 'Chill', cinematic: 'Cinematic', corporate: 'Corporate', hiphop: 'Hip-hop', emotional: 'Emotional' };
const fsize = (b) => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
VIEWS.music = async (el, acts) => {
  const manage = can('settings.manage');
  const [r, pv, pr] = await Promise.all([tryGet('/api/admin/music'), can('providers.view') ? tryGet('/api/admin/providers') : null, can('pricing.view') ? tryGet('/api/admin/pricing') : null]);
  if (!r.ok) { if (r.missing) { el.innerHTML = naCard('The music library is not switched on yet', 'Uploading tracks works here as soon as the server update lands.'); return; } throw r.error; }
  let tracks = r.data.tracks || [];
  const moods = r.data.moods || Object.keys(MOOD_LABEL);
  const mu = pr?.ok ? (pr.data.pricing.addons?.music || {}) : null;
  const musicRows = pv?.ok ? pv.data.providers.filter((p) => p.kind === 'music').sort((a, b) => (b.is_default - a.is_default) || (a.priority - b.priority) || (a.id - b.id)) : null;
  const usableP = (p) => p.enabled && (p.key_set || p.key_shared || NOKEY.includes(p.adapter));
  const aiRow = musicRows?.find((p) => p.adapter !== 'library' && usableP(p));
  const libRow = musicRows?.find((p) => p.adapter === 'library');
  let filt = '', audio = null, playing = null, mood = moods[0];
  S.cleanup.push(() => { try { audio?.pause(); } catch {} });
  const perSec = (v) => num(v) ? int(v) + ' credit' + (num(v) === 1 ? '' : 's') + ' per second' : 'free';
  el.innerHTML = `<div class="stack">
    <div class="grid2">
      <div class="card pad" style="display:grid;gap:8px"><div class="row between"><b style="font-size:16px">Library music</b>${libRow ? (usableP(libRow) ? '<span class="pill good"><span class="dot live"></span>On</span>' : '<span class="pill plain">Off</span>') : ''}</div>
        <p class="hint" style="font-size:13.5px">A random track of the mood the customer picks, from the MP3s you upload below. ${mu ? 'Price: <b style="color:var(--ink)">' + perSec(mu.library_credits_per_unit) + '</b>.' : ''} Costs you nothing.</p></div>
      <div class="card pad" style="display:grid;gap:8px"><div class="row between"><b style="font-size:16px">AI music</b>${musicRows ? (aiRow ? `<span class="pill good"><span class="dot live"></span>${esc(aiRow.name)}</span>` : '<span class="pill warn">No AI music provider on</span>') : ''}</div>
        <p class="hint" style="font-size:13.5px">A new track made to fit each ad, as a paid add-on. ${mu ? 'Price: <b style="color:var(--ink)">' + perSec(mu.credits_per_unit) + '</b>' + (num(mu.min_units) ? ', at least ' + int(mu.min_units) + ' seconds' : '') + '.' : ''} ${can('providers.view') ? '<a href="#/providers">Set it up in AI providers</a>.' : ''}</p></div>
    </div>
    ${manage ? `<div class="card"><div class="card-h"><div><h3>Upload tracks</h3><p>MP3, up to 30 MB each. Use music you own or that is licensed for ads. Pick the mood first, then drop files.</p></div></div>
      <div class="card-b stack" style="gap:12px">
        <div class="row" style="gap:6px"><span class="hint">Mood</span><div class="seg" id="umood">${moods.map((m) => `<button type="button" data-m="${esc(m)}" class="${m === mood ? 'on' : ''}">${esc(MOOD_LABEL[m] || m)}</button>`).join('')}</div></div>
        <label class="drop" id="drop"><input type="file" id="ufile" accept="audio/mpeg,.mp3" multiple hidden>${ico('upload')}<b>Drop MP3 files here</b><span>or click to choose. The file name becomes the track name; you can rename it before it uploads.</span></label>
        <div id="uq" class="list"></div></div></div>` : ''}
    <div class="card"><div class="card-h"><div><h3>Tracks</h3><p id="tcount"></p></div><div class="seg" id="mf"></div></div><div id="tl"></div></div>
  </div>`;
  const drawF = () => {
    const c = Object.fromEntries(moods.map((m) => [m, tracks.filter((x) => x.mood === m).length]));
    $('#mf').innerHTML = `<button class="${!filt ? 'on' : ''}" data-f="">All <span class="muted">${tracks.length}</span></button>` + moods.map((m) => `<button class="${filt === m ? 'on' : ''}" data-f="${esc(m)}" ${c[m] ? '' : 'title="No tracks yet for this mood"'}>${esc(MOOD_LABEL[m] || m)} <span class="${c[m] ? 'muted' : ''}" style="${c[m] ? '' : 'color:var(--bad)'}">${c[m]}</span></button>`).join('');
    $$('#mf button').forEach((b) => b.onclick = () => { filt = b.dataset.f; drawF(); drawL(); });
    const empty = moods.filter((m) => !c[m]);
    $('#tcount').innerHTML = `${int(tracks.length)} track${tracks.length === 1 ? '' : 's'} · ${fsize(tracks.reduce((a, x) => a + num(x.bytes), 0))}${empty.length ? ` · <span style="color:var(--warn)">no tracks yet for ${empty.map((m) => MOOD_LABEL[m] || m).join(', ')}</span>` : ''}`;
  };
  const drawL = () => {
    const list = tracks.filter((x) => !filt || x.mood === filt).slice().reverse();
    $('#tl').innerHTML = list.length ? `<div class="list">${list.map((x) => `<div class="li" style="padding:12px 22px"><div class="row" style="flex-wrap:nowrap;gap:12px;min-width:0"><button class="iconbtn" data-play="${esc(x.id)}" aria-label="Play ${esc(x.name)}" style="background:${playing === x.id ? 'var(--ink)' : 'var(--soft)'};color:${playing === x.id ? '#fff' : 'var(--ink)'};border-radius:50%">${ico(playing === x.id ? 'pause' : 'play')}</button><div class="m"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.name)}</b><small>${fsize(num(x.bytes))} · added ${ago(x.created_at)}</small></div></div>
      <div class="row" style="flex-wrap:nowrap;gap:6px"><span class="pill plain">${esc(MOOD_LABEL[x.mood] || x.mood)}</span>${manage ? `<button class="iconbtn" data-del="${esc(x.id)}" aria-label="Delete ${esc(x.name)}">${ico('trash')}</button>` : ''}</div></div>`).join('')}</div>` : emptyCard(filt ? 'No ' + (MOOD_LABEL[filt] || filt).toLowerCase() + ' tracks yet' : 'No tracks yet', manage ? 'Upload a few MP3s for each mood above.' : '');
    $$('[data-play]', el).forEach((b) => b.onclick = () => {
      const t = tracks.find((x) => x.id === b.dataset.play);
      if (playing === t.id) { audio.pause(); playing = null; return drawL(); }
      audio?.pause(); audio = new Audio(t.url); audio.onended = () => { playing = null; drawL(); };
      audio.play().then(() => { playing = t.id; drawL(); }).catch(() => toast('Could not play this file.', true));
    });
    $$('[data-del]', el).forEach((b) => b.onclick = () => { const t = tracks.find((x) => x.id === b.dataset.del); confirmDel('"' + esc(t.name) + '"', async (w, btn) => { const x = await act(btn, () => DEL('/api/admin/music/' + encodeURIComponent(t.id)), 'Track deleted'); if (!x) return false; if (playing === t.id) { audio.pause(); playing = null; } tracks = tracks.filter((y) => y.id !== t.id); drawF(); drawL(); }); });
  };
  // Upload with progress (XHR gives upload progress; fetch does not).
  const upload = (file, row) => new Promise((res) => {
    const name = $('[data-n]', row).value.trim() || file.name.replace(/\.mp3$/i, '');
    const m = row.dataset.mood;
    const x = new XMLHttpRequest();
    x.open('POST', '/api/admin/music?mood=' + encodeURIComponent(m) + '&name=' + encodeURIComponent(name));
    x.setRequestHeader('Content-Type', 'audio/mpeg');
    x.upload.onprogress = (e) => { if (e.lengthComputable) { $('.vbar i', row).style.width = Math.round(e.loaded / e.total * 100) + '%'; $('[data-st]', row).textContent = Math.round(e.loaded / e.total * 100) + '%'; } };
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status < 300 && d.track) { tracks.push(d.track); $('[data-st]', row).innerHTML = '<span class="pill good">Added</span>'; $('.vbar i', row).style.background = 'var(--good)'; drawF(); drawL(); setTimeout(() => row.remove(), 2500); res(true); }
      else { $('[data-st]', row).innerHTML = `<span class="pill bad">${esc(d.error || 'Upload failed')}</span>`; $('.vbar i', row).style.background = 'var(--bad)'; res(false); } };
    x.onerror = () => { $('[data-st]', row).innerHTML = '<span class="pill bad">Network error</span>'; res(false); };
    x.send(file);
  });
  const queue = async (files) => {
    const ok = [...files].filter((f) => /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg');
    if (ok.length < files.length) toast('Only MP3 files can be uploaded.', true);
    for (const f of ok) {
      if (f.size > 30e6) { toast(f.name + ' is over 30 MB.', true); continue; }
      const row = document.createElement('div'); row.className = 'li'; row.dataset.mood = mood; row.style.animation = 'up .3s var(--ease) both';
      row.innerHTML = `<div class="m grow" style="display:grid;gap:6px"><div class="row" style="flex-wrap:nowrap;gap:8px"><input class="inp sm" data-n value="${esc(f.name.replace(/\.mp3$/i, ''))}" maxlength="80" aria-label="Track name"><span class="pill plain">${esc(MOOD_LABEL[mood] || mood)}</span></div><div class="vbar"><i style="width:0"></i></div></div><span class="mono hint" data-st style="min-width:56px;text-align:right">0%</span>`;
      $('#uq').appendChild(row);
    }
    // Small pause so a name can still be edited, then upload one by one.
    await new Promise((x) => setTimeout(x, 400));
    for (const row of $$('#uq .li:not([data-done])')) { row.dataset.done = 1; const f = ok.find((y) => y.name.replace(/\.mp3$/i, '') === $('[data-n]', row).defaultValue); if (f) await upload(f, row); }
  };
  if (manage) {
    $$('#umood button').forEach((b) => b.onclick = () => { mood = b.dataset.m; $$('#umood button').forEach((x) => x.classList.toggle('on', x === b)); });
    const drop = $('#drop');
    $('#ufile').onchange = (e) => { queue(e.target.files); e.target.value = ''; };
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => queue(e.dataTransfer.files));
  }
  drawF(); drawL();
};

// ---------- Training ----------
let trainerLoad = null;
function loadTrainer() {
  if (trainerLoad) return trainerLoad;
  const script = (src) => new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  trainerLoad = fetch('/assets/js/trainer.js', { method: 'HEAD' }).then(async (x) => {
    if (!x.ok) return null;
    if (!document.querySelector('link[href="/assets/css/trainer.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/assets/css/trainer.css'; document.head.appendChild(l); }
    if (!window.VooUI) await script('/assets/js/voo-ui.js');
    await script('/assets/js/trainer.js');
    return window.VooTrainer || null;
  }).catch(() => null);
  return trainerLoad;
}
VIEWS.training = async (el, acts) => {
  const manage = can('settings.manage');
  const [r, T] = await Promise.all([tryGet('/api/training'), loadTrainer()]);
  if (!r.ok) {
    if (r.missing) { el.innerHTML = naCard('Training lessons are not switched on yet', 'The lesson list and the voiceover generator show up here when the server update lands.'); return; }
    throw r.error;
  }
  const lessons = r.data.lessons || (Array.isArray(r.data) ? r.data : []);
  const audio = r.data.audio || {};
  const scenesOf = (l) => l.scenes || [];
  const voiced = (l) => (audio[l.id] || []).filter(Boolean).length;
  const totS = lessons.reduce((a, l) => a + scenesOf(l).length, 0), totV = lessons.reduce((a, l) => a + Math.min(voiced(l), scenesOf(l).length), 0);
  const mins = lessons.reduce((a, l) => a + num(l.minutes), 0);
  acts.innerHTML = manage ? `<button class="btn brand sm" id="genv">${ico('voice')} Generate voiceovers ${ARR()}</button>` : '';
  el.innerHTML = `<div class="stack">
    <div class="kpis stagger">
      <div class="card kpi hero" style="--i:0"><div class="l">Lessons</div><div class="v">${int(lessons.length)}</div><div class="s">${int(mins)} minutes in total</div></div>
      <div class="card kpi" style="--i:1"><div class="l">Scenes</div><div class="v">${int(totS)}</div><div class="s">Each one is a step in the walkthrough</div></div>
      <div class="card kpi" style="--i:2"><div class="l">With a voice</div><div class="v">${int(totV)}<span class="hint" style="font-size:16px"> / ${int(totS)}</span></div><div class="vbar" style="margin-top:10px"><i style="width:${totS ? Math.round(totV / totS * 100) : 0}%"></i></div></div>
      <div class="card kpi" style="--i:3"><div class="l">Player</div><div class="v" style="font-size:22px">${T ? 'Ready' : 'Not yet'}</div><div class="s">${T ? 'Preview any lesson below' : 'The lesson player is still being built'}</div></div>
    </div>
    <div class="card pad genbox" id="gbox" hidden></div>
    <div class="note">Scenes without a voiceover still play: the player reads the narration with the browser's own voice. Generated voices sound much better and use the default <b>Voice</b> provider (ElevenLabs) in AI providers.</div>
    ${lessons.length ? `<div class="lessons stagger">${lessons.map((l, i) => { const n = scenesOf(l).length, v = Math.min(voiced(l), n); return `<div class="card lesson" style="--i:${Math.min(i, 12)}"><div class="row between"><span class="num">${pad2(i + 1)} · ${esc(l.level || 'all levels')}</span><span class="mono hint" style="font-size:11px">${esc(l.minutes || '?')} min</span></div><h4>${esc(l.title)}</h4><p>${esc(l.summary || '')}</p>
      <div><div class="row between hint" style="font-size:12px;margin-bottom:5px"><span>${n} scenes</span><span>${v === n && n ? 'All voiced' : v + ' of ' + n + ' voiced'}</span></div><div class="vbar"><i style="width:${n ? Math.round(v / n * 100) : 0}%;${v === n && n ? 'background:var(--good)' : ''}"></i></div></div>
      <div class="row" style="margin-top:4px"><button class="btn ghost xs" data-sc="${i}">${ico('list')} Scenes</button>${T ? `<button class="btn solid xs" data-pv="${i}">${ico('play')} Preview</button>` : ''}</div></div>`; }).join('')}</div>` : `<div class="card">${emptyCard('No lessons yet', 'Lessons come from content/training/lessons.json.')}</div>`}
  </div>`;
  $$('[data-sc]', el).forEach((b) => b.onclick = () => {
    const l = lessons[Number(b.dataset.sc)], au = audio[l.id] || [];
    modal({ title: esc(l.title), cls: 'wide', ok: '', cancel: 'Close', body: `<p>${esc(l.summary || '')}</p><div class="scenes">${scenesOf(l).map((s, j) => `<div class="scene"><span class="n">${pad2(j + 1)}</span><div><b style="color:var(--ink)">${esc(s.caption || s.screen || '')}</b><div style="margin-top:3px">${esc(s.narration || '')}</div><div class="hint mono" style="font-size:10.5px;margin-top:4px">${esc(s.screen || '')} · ${esc(s.action || '')}${s.target ? ' · ' + esc(s.target) : ''}</div></div>${au[j] ? `<audio controls preload="none" src="${esc(au[j])}"></audio>` : '<span class="pill plain">Browser voice</span>'}</div>`).join('')}</div>` });
  });
  $$('[data-pv]', el).forEach((b) => b.onclick = () => {
    const l = lessons[Number(b.dataset.pv)];
    try { if (typeof T.open !== 'function') throw new Error('unknown player'); T.open({ id: l.id }); }
    catch (e) { toast('The lesson player could not start here. Open the Learn page in the studio instead.', true); }
  });
  $('#genv') && ($('#genv').onclick = (e) => {
    const btn = e.currentTarget;
    modal({ title: 'Generate voiceovers?', ok: 'Generate', body: `<p>Creates an MP3 for every scene (${int(totS)} in total) with the default Voice provider. Scenes that already have a voice are kept unless the server decides to refresh them.</p><p class="hint">Costs a few cents per scene with ElevenLabs. Keep this page open while it runs.</p>`, onOk: () => { run(btn); } });
  });
  const run = async (btn) => {
    const g = $('#gbox'); g.hidden = false; btn.disabled = true;
    const t0 = Date.now();
    g.innerHTML = `<div class="row between"><b>Generating voiceovers</b><span class="timer" id="gtm">00:00 · generating</span></div><div class="indet"><i></i></div><p class="hint">This takes a few seconds per scene. You can keep working in another tab.</p>`;
    const tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); $('#gtm') && ($('#gtm').textContent = clock(s) + ' · generating'); }, 1000);
    S.timers.push(tick);
    let x, err;
    try { x = await POST('/api/admin/training/voice', {}); } catch (e2) { err = e2; }
    clearInterval(tick); btn.disabled = false;
    if (!g.isConnected) return;
    const secs = Math.round((Date.now() - t0) / 1000);
    if (err) { g.innerHTML = `<div class="row between"><b>${isMissing(err) ? 'Not available yet' : 'Voiceovers did not finish'}</b><span class="timer">${clock(secs)}</span></div><p class="hint">${esc(isMissing(err) ? 'The voiceover generator switches on with the server update.' : err.message)}</p>`; return; }
    if (x.demo || (x.ok === false && x.note && !x.errors)) { g.innerHTML = `<div class="row between"><b>No voice provider yet</b><span class="timer">${clock(secs)}</span></div><p class="hint">${esc(x.note || 'Add an ElevenLabs key in AI providers first.')}</p>${can('providers.view') ? `<div class="row end"><a class="btn ghost xs" href="#/providers">Open AI providers ${ARR()}</a></div>` : ''}`; return; }
    const made = x.made ?? x.generated ?? x.created ?? x.count ?? null;
    const errs = asList(x.errors || x.failed).slice(0, 5);
    g.innerHTML = `<div class="row between"><b style="color:${errs.length ? 'var(--warn)' : 'var(--good)'}">${ico(errs.length ? 'alert' : 'check').replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px;margin-right:6px"')}${errs.length ? 'Voiceovers partly done' : 'Voiceovers ready'}</b><span class="timer">${clock(secs)} · done</span></div>
      <p class="hint">${made != null ? int(made) + ' new scene voiceovers' : 'Done'}${made === 0 && !errs.length ? '. Every scene already had one' : ''}${errs.length ? '. ' + (asList(x.errors).length) + ' scenes failed:' : '.'}</p>${errs.length ? `<div class="note warn">${errs.map((y) => esc(typeof y === 'object' ? (y.scene ?? '') + ' ' + (y.error || JSON.stringify(y)) : y)).join('<br>')}</div>` : ''}<div class="row end"><button class="btn ghost xs" id="grl">${ico('refresh')} Refresh list</button></div>`;
    $('#grl').onclick = () => route();
  };
};


// ---------- Audit ----------
const ACTION_LABEL = { 'pronunciations.edit': 'Edited pronunciations', 'music.upload': 'Uploaded a music track', 'music.delete': 'Deleted a music track', 'ticket.reply': 'Replied to ticket', 'ticket.note': 'Added internal note', 'ticket.update': 'Updated ticket', 'ticket.edit': 'Updated ticket', 'ticket.credits': 'Gave credits from a ticket', 'macro.add': 'Added saved reply', 'macro.edit': 'Edited saved reply', 'macro.delete': 'Deleted saved reply', 'support_settings.edit': 'Changed support settings', 'support.settings': 'Changed support settings', 'ai_brain.edit': 'Edited AI brain', 'training.voice': 'Generated lesson voiceovers', 'user.edit': 'Edited customer', 'user.credits': 'Changed credits', 'user.status': 'Changed account status', 'payment.refund': 'Marked refunded', 'payment_method.add': 'Added payment method', 'payment_method.edit': 'Edited payment method', 'payment_method.delete': 'Deleted payment method', 'provider.add': 'Added AI provider', 'provider.edit': 'Edited AI provider', 'provider.delete': 'Deleted AI provider', 'pricing.edit': 'Changed pricing', 'discount.add': 'Created discount', 'discount.off': 'Turned off discount', 'post.add': 'Created post', 'post.edit': 'Edited post', 'post.delete': 'Deleted post', 'email.edit': 'Edited email', 'staff.invite': 'Invited staff', 'staff.edit': 'Changed staff access', 'staff.remove': 'Removed staff', 'role.add': 'Created role', 'role.edit': 'Edited role', 'role.delete': 'Deleted role', 'settings.edit': 'Changed settings' };
VIEWS.audit = async (el) => {
  const r = await GET('/api/admin/audit');
  const areas = [...new Set(r.log.map((x) => String(x.action).split('.')[0]))];
  el.innerHTML = `<div class="card"><div class="card-h"><input class="inp sm" id="aq" type="search" placeholder="Search person, action or target" style="max-width:320px"><div class="seg" id="af"><button class="on" data-a="">All</button>${areas.map((a) => `<button data-a="${esc(a)}">${esc(a.replace('_', ' '))}</button>`).join('')}</div></div><div id="al"></div></div>`;
  const st = { q: '', a: '' };
  const detail = (d) => { const e = Object.entries(d || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''); return e.length ? e.slice(0, 6).map(([k, v]) => `<span class="k">${esc(k)}: ${esc(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 80)}</span>`).join(' ') : ''; };
  const draw = () => {
    const q = st.q.toLowerCase();
    const rows = r.log.filter((x) => (!st.a || x.action.startsWith(st.a + '.')) && (!q || [x.staff_email, x.action, x.target, JSON.stringify(x.detail)].join(' ').toLowerCase().includes(q)));
    $('#al').innerHTML = rows.length ? tbl([{ t: 'When' }, { t: 'Who' }, { t: 'What' }, { t: 'Target' }, { t: 'Details' }], rows.map((x) => `<tr><td data-l="When" class="nowrap" title="${esc(fdate(x.created_at))}">${ago(x.created_at)}</td><td class="lead" data-l="Who">${esc(x.staff_email || 'Removed staff')}</td><td data-l="What"><b>${esc(ACTION_LABEL[x.action] || x.action)}</b></td><td data-l="Target">${esc(x.target || '—')}</td><td data-l="Details" style="max-width:380px">${detail(x.detail) || '<span class="muted">—</span>'}</td></tr>`)) : emptyCard('No activity found', 'Changes made by staff show up here.');
  };
  $('#aq').oninput = debounce((e) => { st.q = e.target.value.trim(); draw(); }, 150);
  $$('#af button').forEach((b) => b.onclick = () => { $$('#af button').forEach((x) => x.classList.toggle('on', x === b)); st.a = b.dataset.a; draw(); });
  draw();
};

// Extensions (public/assets/js/admin-business.js: customer spend, Connect VooSquare, role builder, payment and AI model
// wizards, AI tools builder) get the admin's building blocks before the first render.
(window.VA_EXT || []).forEach((f) => { try { f({ $, $$, esc, S, can, clone, num, money, int, parseDate, ago, fdate, initials, debounce, api, GET, POST, PUT, DEL, tryGet, isMissing, toast, act, copy, IC, ico, FACE, ARR, LOGO, SECTIONS, VIEWS, route, openDrawer, closeDrawer, modal, confirmDel, sw, statusPill, emptyCard, tbl, naCard, customerDrawer, istat, METHOD_INFO, ADAPTER_INFO, KIND_LABEL, uploadImage, ACTION_LABEL, refreshBadge, stopTimers }); } catch (e) { console.error('[admin extension]', e); } });
boot();
})();
