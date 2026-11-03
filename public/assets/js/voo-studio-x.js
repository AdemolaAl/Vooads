/* Studio extensions (Oct 2026): "More tools" (AI tools built in Admin → AI tools) and the bank-transfer sheet.
   app.html exposes its helpers as window.VooStudio and calls VooStudioX at a few points (create page, job viewer, wallet). */
(function () {
'use strict';
var TI = window.VooToolIcons || { svg: function () { return ''; } };
var css = document.createElement('style');
css.textContent = '' +
  '.ty.vt2 .ic2{background:var(--ink);color:#fff}.ty.vt2 .pill.test{background:#ECE9FF;color:#4A3BD1}' +
  '.vtf{display:grid;gap:14px}.vtf .fld textarea.inp{min-height:96px;resize:vertical}' +
  '.vtf .upl2{display:flex;gap:10px;align-items:center;border:1.5px dashed var(--line2);border-radius:16px;padding:12px;cursor:pointer;background:#FBFAF7}' +
  '.vtf .upl2 img{width:52px;height:52px;border-radius:12px;object-fit:cover;background:var(--bg)}' +
  '.vtf .upl2 b{display:block;font-size:14px}.vtf .upl2 small{color:var(--mut);font-size:12.5px}' +
  '.vth{display:flex;gap:12px;align-items:center}.vth .ic2{width:46px;height:46px;border-radius:15px;background:var(--ink);color:#fff;display:grid;place-items:center;flex:none}' +
  '.vth p{color:var(--mut);font-size:14px;margin-top:2px}' +
  '.vtres{display:grid;gap:10px}.vtres ol{margin:0;padding:0;list-style:none;display:grid;gap:8px;counter-reset:v}' +
  '.vtres ol li{counter-increment:v;display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:10px 12px;background:#fff;animation:up .35s var(--ease) both}' +
  '.vtres ol li::before{content:counter(v,decimal-leading-zero);font:500 11.5px var(--mono);color:var(--mut2)}' +
  '.vtres .txt{white-space:pre-wrap;border:1px solid var(--line);border-radius:18px;padding:16px;background:#fff;line-height:1.6}' +
  '.vtres img,.vtres video{width:100%;max-height:70vh;object-fit:contain;border-radius:18px;background:#141413}' +
  '.bank{display:grid;gap:12px}.bank .acct{border-radius:22px;background:var(--ink);color:#fff;padding:18px;display:grid;gap:10px;position:relative;overflow:hidden}' +
  '.bank .acct::after{content:"";position:absolute;right:-60px;top:-60px;width:180px;height:180px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,74,28,.45),transparent)}' +
  '.bank .acct>*{position:relative}.bank .acct small{color:#A9A398;font-size:12.5px;display:block}.bank .acct b{font-size:15px}' +
  '.bank .num2{font-size:26px;font-weight:800;letter-spacing:-.03em;display:flex;gap:10px;align-items:center;flex-wrap:wrap}' +
  '.bank .cp{border:1px solid rgba(255,255,255,.25);background:transparent;color:#fff;border-radius:999px;padding:5px 11px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}' +
  '.bank .rows{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}' +
  '.bank .rows div{border:1px solid var(--line);border-radius:16px;padding:12px;background:#fff}.bank .rows span{display:block;color:var(--mut);font-size:12.5px}.bank .rows b{font-size:17px}' +
  '.bank .state{display:flex;gap:10px;align-items:center;border-radius:16px;padding:12px 14px;background:#FBFAF7;border:1px solid var(--line);font-size:14px}' +
  '.wbanner{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border:1px solid var(--line);border-radius:20px;padding:14px 16px;background:#fff;margin-bottom:14px;animation:up .4s var(--ease) both}' +
  '.wbanner .grow{flex:1;min-width:180px}.wbanner b{display:block}.wbanner small{color:var(--mut)}' +
  '.pm-ic img{width:100%;height:100%;object-fit:cover;border-radius:inherit}';
document.head.appendChild(css);

var V = function () { return window.VooStudio; };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
var ARR = function () { return '<span class="arr">' + (V().I ? V().I('arrow', 16) : '') + '</span>'; };
var TOOLS = [];

// ---------- More tools on the Create page ----------
async function mountTools(grid, group) {
  if (!grid) return;
  try { TOOLS = (await V().api('GET', '/api/tools')).tools || []; } catch (e) { TOOLS = []; }
  if (!grid.isConnected) return;
  group.hidden = !TOOLS.length;
  grid.innerHTML = TOOLS.map(function (t) {
    return '<button class="ty tool vt2' + (t.locked ? ' lk' : '') + '" data-slug="' + esc(t.slug) + '"><span class="ic2">' + TI.svg(t.icon, 22) + '</span><b>' + esc(t.name) + '</b><small>' + esc(t.description || '') + '</small><span class="pr">' + fmt(t.credits) + ' credits</span>' +
      (t.testing ? '<span class="pill test">Testing</span>' : t.locked ? '<span class="pill ink">' + esc((t.min_plan || 'plan').replace(/^./, function (c) { return c.toUpperCase(); })) + '</span>' : '') + '</button>';
  }).join('');
  Array.prototype.forEach.call(grid.querySelectorAll('[data-slug]'), function (b) {
    b.onclick = function () { var t = TOOLS.find(function (x) { return x.slug === b.dataset.slug; }); if (!t) return; if (t.locked) { V().upsell(t.locked_reason, t.name); return; } openTool(t); };
  });
}

function fieldHTML(f) {
  var req = f.required ? '' : ' <small>(optional)</small>';
  if (f.type === 'longtext') return '<div class="fld"><label>' + esc(f.label) + req + '</label><textarea class="inp" data-k="' + esc(f.key) + '" maxlength="' + (f.max || 1200) + '" placeholder="' + esc(f.placeholder || '') + '"></textarea>' + (f.help ? '<small>' + esc(f.help) + '</small>' : '') + '</div>';
  if (f.type === 'choice') return '<div class="fld"><label>' + esc(f.label) + req + '</label><div class="chips" data-ck="' + esc(f.key) + '">' + f.options.map(function (o, i) { return '<button type="button" class="chip' + (i ? '' : ' on') + '" data-v="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div>' + (f.help ? '<small>' + esc(f.help) + '</small>' : '') + '</div>';
  if (f.type === 'image') return '<div class="fld"><label>' + esc(f.label) + req + '</label><label class="upl2" data-uk="' + esc(f.key) + '"><img alt="" hidden><span><b>Upload a photo</b><small>PNG, JPG or WebP</small></span><input type="file" accept="image/png,image/jpeg,image/webp" hidden></label></div>';
  if (f.type === 'number') return '<div class="fld"><label>' + esc(f.label) + req + '</label><input class="inp" type="number" data-k="' + esc(f.key) + '" min="' + f.min + '" max="' + f.max + '" placeholder="' + esc(f.placeholder || String(f.min)) + '">' + (f.help ? '<small>' + esc(f.help) + '</small>' : '') + '</div>';
  return '<div class="fld"><label>' + esc(f.label) + req + '</label><input class="inp" data-k="' + esc(f.key) + '" maxlength="' + (f.max || 120) + '" placeholder="' + esc(f.placeholder || '') + '">' + (f.help ? '<small>' + esc(f.help) + '</small>' : '') + '</div>';
}
function openTool(t) {
  var S = V();
  var bal = (S.me().balance || {}).total || 0;
  var m = S.modal('<div class="mbd vtf"><div class="vth"><span class="ic2">' + TI.svg(t.icon, 22) + '</span><div><b style="font-size:18px;letter-spacing:-.03em">' + esc(t.name) + '</b>' + (t.testing ? ' <span class="pill" style="background:#ECE9FF;color:#4A3BD1">Testing</span>' : '') + '<p>' + esc(t.description || '') + '</p></div></div>' +
    t.fields.map(fieldHTML).join('') +
    '<div class="chips" style="justify-content:space-between;align-items:center"><span class="ml">' + fmt(t.credits) + ' credits · you have ' + fmt(bal) + '</span><button class="btn arrow" id="vtGo">Run ' + ARR() + '</button></div></div>', t.name);
  var vals = {};
  Array.prototype.forEach.call(m.querySelectorAll('[data-ck]'), function (g) {
    vals[g.dataset.ck] = g.querySelector('.chip.on') ? g.querySelector('.chip.on').dataset.v : '';
    Array.prototype.forEach.call(g.querySelectorAll('.chip'), function (c) { c.onclick = function () { Array.prototype.forEach.call(g.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x === c); }); vals[g.dataset.ck] = c.dataset.v; }; });
  });
  Array.prototype.forEach.call(m.querySelectorAll('[data-uk]'), function (lb) {
    var inp = lb.querySelector('input');
    inp.onchange = async function () {
      var f = inp.files[0]; if (!f) return;
      lb.querySelector('b').textContent = 'Uploading…';
      try {
        var r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': f.type }, body: f, credentials: 'same-origin' });
        var d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed');
        vals[lb.dataset.uk] = d.url; var img = lb.querySelector('img'); img.src = d.url; img.hidden = false; lb.querySelector('b').textContent = 'Photo added';
      } catch (e) { S.toast(e.message, true); lb.querySelector('b').textContent = 'Upload a photo'; }
    };
  });
  var first = m.querySelector('[data-k]'); if (first) setTimeout(function () { first.focus(); }, 80);
  m.querySelector('#vtGo').onclick = async function () {
    var bt = this;
    Array.prototype.forEach.call(m.querySelectorAll('[data-k]'), function (i) { vals[i.dataset.k] = i.value; });
    bt.disabled = true; bt.innerHTML = 'Starting <span class="spinner"></span>';
    try {
      var d = await S.api('POST', '/api/tools/' + encodeURIComponent(t.slug) + '/run', { inputs: vals });
      S.me().balance = d.balance; if (S.paintWallet) S.paintWallet();
      if (S.addJob) S.addJob(d.job);
      m._onclose = null; m._close();
      S.openJob(d.job);
    } catch (e) {
      bt.disabled = false; bt.innerHTML = 'Run ' + ARR();
      if (e.status === 402) S.upsell(e.message, t.name); else S.toast(e.message, true);
    }
  };
}

// ---------- Result of a tool job (inside the job viewer) ----------
function result(j) {
  var o = j.output || {}, t = o.tool || {}, h = '<div class="vtres">';
  if (o.items && o.items.length) h += '<div class="chips" style="justify-content:space-between;align-items:center"><b>' + o.items.length + ' results</b><button class="btn ghost sm" data-copy="' + esc(o.items.join('\n')) + '">Copy all</button></div><ol>' + o.items.map(function (x) { return '<li><span>' + esc(x) + '</span><button class="cbtn" data-copy="' + esc(x) + '">Copy</button></li>'; }).join('') + '</ol>';
  else if (o.text) h += '<div class="txt">' + esc(o.text) + '</div><div class="chips"><button class="btn ghost sm" data-copy="' + esc(o.text) + '">Copy</button></div>';
  else if (o.url && (t.output === 'video' || o.video_url)) h += '<div class="player"><video src="' + esc(o.url) + '" controls autoplay playsinline loop></video></div><div class="chips"><a class="btn arrow" href="' + esc(o.url) + '" download>Download ' + ARR() + '</a></div>';
  else if (o.url && (t.output === 'audio' || o.audio_url)) h += '<audio src="' + esc(o.url) + '" controls style="width:100%"></audio><div class="chips"><a class="btn arrow" href="' + esc(o.url) + '" download>Download ' + ARR() + '</a></div>';
  else if (o.url) h += '<a href="' + esc(o.url) + '" target="_blank" download><img src="' + esc(o.url) + '" alt="' + esc(t.name || 'Result') + '"></a><div class="chips"><a class="btn arrow" href="' + esc(o.url) + '" download>Download ' + ARR() + '</a></div>';
  if (j.input && j.input.tool_slug) h += '<div class="chips"><button class="chip" data-vtool-again="' + esc(j.input.tool_slug) + '">Run it again</button></div>';
  return h + '</div>';
}
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-vtool-again]');
  if (!b) return;
  var slug = b.dataset.vtoolAgain;
  var open = function () { var t = TOOLS.find(function (x) { return x.slug === slug; }); if (t) openTool(t); else V().toast('This tool is not available any more.', true); };
  var m = b.closest('.modal'); if (m && m._close) { m._onclose = null; m._close(); }
  if (TOOLS.length) open(); else V().api('GET', '/api/tools').then(function (d) { TOOLS = d.tools || []; open(); }).catch(function () {});
});
// Library card text for text tools.
function libText(j) { var o = j.output || {}; if (o.items && o.items.length) return '“' + esc(o.items[0]) + '”<br><br><span class="ml">+' + Math.max(0, o.items.length - 1) + ' more</span>'; if (o.text) return '“' + esc(String(o.text).slice(0, 120)) + '”'; return ''; }

// ---------- Bank transfer ----------
async function manual(id) {
  var S = V(), d;
  try { d = await S.api('GET', '/api/billing/manual/' + encodeURIComponent(id)); } catch (e) { S.toast(e.message, true); return; }
  var ins = d.instructions, p = d.payment;
  var amt = ins.amount_local && ins.currency !== 'USD' ? ins.currency + ' ' + Number(ins.amount_local).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '$' + Number(ins.amount_usd).toFixed(2);
  var stateHTML = function () {
    if (p.status === 'paid') return '<div class="state"><span class="pill good">Confirmed</span>Your credits are in your wallet.</div>';
    if (p.status === 'failed') return '<div class="state"><span class="pill bad">Not confirmed</span>' + esc(p.review_note || 'We could not match this transfer. Contact support.') + '</div>';
    if (p.status === 'review') return '<div class="state"><span class="pill warn">Receipt received</span>We usually confirm within ' + ins.review_hours + ' hours. You get an email when your credits are in.</div>';
    return '';
  };
  var m = S.modal('<div class="mbd bank"><p class="muted" style="margin:0">Send the exact amount from your bank, with the reference below, then upload your receipt here.</p>' +
    '<div class="acct"><small>' + esc(ins.bank_name || 'Bank') + '</small><b>' + esc(ins.account_name) + '</b><div class="num2">' + esc(ins.account_number) + (ins.account_number ? ' <button class="cp" data-c="' + esc(ins.account_number) + '">Copy</button>' : '') + '</div>' + (ins.extra ? '<small style="white-space:pre-wrap">' + esc(ins.extra) + '</small>' : '') + '</div>' +
    '<div class="rows"><div><span>Amount</span><b>' + esc(amt) + '</b></div><div><span>Reference</span><b>' + esc(ins.reference) + '</b> <button class="cbtn" data-c="' + esc(ins.reference) + '">Copy</button></div></div>' +
    '<div id="bst">' + stateHTML() + '</div>' +
    (p.status === 'pending' || p.status === 'review' ? '<label class="btn arrow" style="cursor:pointer;justify-self:start">' + (p.proof_url ? 'Replace receipt' : 'Upload receipt') + ' ' + ARR() + '<input type="file" id="bproof" accept="image/png,image/jpeg,image/webp" hidden></label><small class="muted">A screenshot or photo of the transfer. PNG, JPG or WebP.</small>' : '') + '</div>', 'Pay by bank transfer');
  Array.prototype.forEach.call(m.querySelectorAll('[data-c]'), function (b) { b.onclick = function () { S.copy(b.dataset.c); }; });
  var f = m.querySelector('#bproof');
  if (f) f.onchange = async function () {
    var file = f.files[0]; if (!file) return;
    var lab = f.parentElement; lab.firstChild.textContent = 'Uploading… ';
    try {
      var r = await fetch('/api/billing/manual/' + encodeURIComponent(id) + '/proof', { method: 'POST', headers: { 'Content-Type': file.type }, body: file, credentials: 'same-origin' });
      var x = await r.json(); if (!r.ok) throw new Error(x.error || 'Upload failed');
      p.status = 'review'; p.proof_url = x.proof_url; m.querySelector('#bst').innerHTML = stateHTML(); lab.firstChild.textContent = 'Replace receipt '; S.toast('Receipt sent. We will confirm it soon.');
    } catch (e) { S.toast(e.message, true); lab.firstChild.textContent = 'Upload receipt '; }
  };
}
function walletBanner(el, pays) {
  var list = (pays || []).filter(function (x) { return x.adapter === 'manual' && (x.status === 'pending' || x.status === 'review'); });
  if (!list.length || !el) return;
  var d = document.createElement('div');
  d.innerHTML = list.slice(0, 3).map(function (x) { return '<div class="wbanner"><span class="pill ' + (x.status === 'review' ? 'warn' : 'plain') + '">' + (x.status === 'review' ? 'Checking' : 'Waiting for transfer') + '</span><div class="grow"><b>Bank transfer VA-' + x.id + ' · $' + Number(x.amount_usd).toFixed(2) + '</b><small>' + (x.status === 'review' ? 'Receipt received. We confirm it soon.' : 'Send the transfer, then upload the receipt.') + '</small></div><button class="btn ghost sm" data-mp="' + x.id + '">' + (x.status === 'review' ? 'View' : 'Bank details') + '</button></div>'; }).join('');
  el.insertBefore(d, el.firstChild);
  Array.prototype.forEach.call(d.querySelectorAll('[data-mp]'), function (b) { b.onclick = function () { manual(b.dataset.mp); }; });
}
function payMark(x) { return x && x.logo_url ? '<img src="' + esc(x.logo_url) + '" alt="">' : null; }

window.VooStudioX = { mountTools: mountTools, result: result, libText: libText, manual: manual, walletBanner: walletBanner, payMark: payMark };
})();
